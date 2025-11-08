(() => {
  const elements = {
    startBtn: document.getElementById('start-demo'),
    stopBtn: document.getElementById('stop-demo'),
    callId: document.getElementById('call-id'),
    callTimer: document.getElementById('call-timer'),
    callState: document.getElementById('call-state'),
    transcriptList: document.getElementById('transcript-list'),
    latencyBadge: document.getElementById('stt-latency'),
    suggestionList: document.getElementById('suggestion-list'),
    keywordList: document.getElementById('keyword-list'),
    assistantBubble: document.querySelector('.assistant-bubble')
  };

  let demoRunning = false;
  let callStartTime = null;
  let callTimerInterval = null;

  // --- (신규) WebSocket ---
  let ws = null;
  const WEBSOCKET_URL = "ws://localhost:8766"; // Python 서버 주소 (포트 수정)

  // --- (신규) 화자 분석(Diarization) 상태 관리 ---
  let speakerMap = {}; // API의 숫자 ID(예: 1, 2)를 실제 태그(예: '상담원', '고객')와 매핑
  let isSpeakerMapConfirmed = false; // 화자 2명이 모두 확인되었는지 여부
  let messageCounter = 0; // DOM ID 부여용 카운터
  let messageDataMap = {}; // 메시지 ID별 데이터 저장: {messageId: {speakerId, text, timestamp}}
  let conversation_history = []; // 대화 로그 (서버와 동기화)
  let customerIntentKeywords = []; // 고객 의도 키워드 누적 저장

  function generateCallId() {
    // 하드코딩으로 고정된 콜 ID 반환
    return 'Hack-2025';
  }

  function setBadgeClass(el, badgeClass) {
    if (el) el.className = `badge ${badgeClass}`;
  }

  function resetBadge(el) {
    if (el) el.className = 'badge badge-neutral';
  }

  function updateCallTimer() {
    if (!callStartTime) return;
    const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const seconds = (elapsedSec % 60).toString().padStart(2, '0');
    if (elements.callTimer) elements.callTimer.textContent = `${minutes}:${seconds}`;
  }


  // --- (신규) WebSocket 메시지 처리 ---
  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(WEBSOCKET_URL);

    ws.onopen = () => {
      console.log("[WebSocket] 서버에 연결되었습니다.");
      if (elements.callState) elements.callState.textContent = '통화 중';
      startDemo();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[WebSocket] 메시지 수신:", msg);

        // 수신된 메시지 유형에 따라 UI 업데이트
        switch (msg.type) {
          // ----------------------------------------------------
          // [STT/화자분석] VAD가 확정한 말풍선 즉시 표시
          // ----------------------------------------------------
          case "stt_final":
            handleSTTFinal(msg);
            break;
          
          // ----------------------------------------------------
          // [AI 분석] 백그라운드 분석 결과 비동기 업데이트
          // ----------------------------------------------------
          case "analysis_result":
            handleAnalysisResult(msg);
            break;
          
          // ----------------------------------------------------
          // [STT 중간] (선택 사항) 타이핑 효과
          // ----------------------------------------------------
          case "stt_partial":
            handleSTTPartial(msg);
            break;
          
          // ----------------------------------------------------
          // [Task C 결과] AI 자동 요약 결과 수신
          // ----------------------------------------------------
          case "task_c_result":
            handleTaskCResult(msg);
            break;
          
          // ----------------------------------------------------
          // [LAG 결과] 15초 후 고객 의도 키워드 생성 결과 수신
          // ----------------------------------------------------
          case "lag_intent_result":
            handleLagIntentResult(msg);
            break;
        }
      } catch (e) {
        console.error("[WebSocket] 잘못된 JSON 수신:", event.data);
      }
    };

    ws.onclose = () => {
      console.log("[WebSocket] 연결이 종료되었습니다.");
      if (demoRunning) {
        stopDemo(false); // 재연결 시도 없이 중지
        if (elements.callState) elements.callState.textContent = '연결 끊김';
      }
    };

    ws.onerror = (err) => {
      console.error("[WebSocket] 오류:", err);
      if (elements.callState) elements.callState.textContent = '연결 오류';
      stopDemo(false);
    };
  }
  
  function disconnectWebSocket() {
      if (ws) {
          ws.close();
          ws = null;
      }
  }

  // --- (신규) UI 업데이트 함수 분리 (이벤트 기반) ---
  // stt_final: 최종 문장 확정 시 즉시 말풍선 표시
  function handleSTTFinal(msg) {
    // msg: { type: "stt_final", text: "...", speakerId: 1, latency: 123 }
    const messageId = `msg-${messageCounter++}`;
    const speakerId = msg.speakerId;
    const text = msg.text;
    const latency = msg.latency || 0;
    
    // 메시지 데이터 저장
    messageDataMap[messageId] = {
      speakerId: speakerId,
      text: text,
      timestamp: Date.now()
    };
    
    // conversation_history에 추가 (서버와 동기화)
    conversation_history.push({
      speakerId: speakerId,
      text: text
    });
    const textPreview = text.length > 50 ? text.substring(0, 50) + '...' : text;
    console.log(`[handleSTTFinal] conversation_history에 추가: 화자${speakerId}: ${textPreview} (총 ${conversation_history.length}개)`);
    
    // Phase 1: 태그 없는 말풍선 우선 렌더링
    renderBubble(messageId, text, speakerId, null); // `tag`는 null로 전달
    
    if (!isSpeakerMapConfirmed) {
      // Phase 1: 화자 매핑 시도
      if (!speakerMap[speakerId]) {
        if (Object.keys(speakerMap).length === 0) {
          speakerMap[speakerId] = '상담원'; // 첫 화자를 '상담원'으로 가정
          console.log(`[화자 분석] 첫 번째 화자 ID ${speakerId} → '상담원'으로 매핑`);
        } else {
          speakerMap[speakerId] = '고객';
          console.log(`[화자 분석] 두 번째 화자 ID ${speakerId} → '고객'으로 매핑`);
          
          // Phase 2: 화자 2명 확인됨
          isSpeakerMapConfirmed = true;
          console.log('[화자 분석] 화자 2명 확인 완료. 모든 말풍선에 태그 적용 시작.');
          
          // Phase 3: 기존 모든 말풍선 재-렌더링(태그 업데이트)
          updateAllBubbleTags(speakerMap);
        }
      }
    }
    
    // Phase 3: 이미 화자가 확정된 경우
    if (isSpeakerMapConfirmed) {
      const tag = speakerMap[speakerId];
      updateBubbleTag(messageId, tag); // `tag`만 업데이트
    }
    
    updateLatency(latency);
    scrollToBottom();
  }

  // stt_partial: 중간 텍스트 (타이핑 효과)
  function handleSTTPartial(msg) {
    // msg: { type: "stt_partial", text: "..." }
    const partialText = msg.text || '';
    
    // partial 말풍선이 없으면 생성
    let partialBubble = elements.transcriptList.querySelector('.transcript-item.partial');
    
    if (!partialBubble) {
      // placeholder 제거
      if (elements.transcriptList.querySelector('.placeholder')) {
        elements.transcriptList.innerHTML = '';
      }
      
      // 새로운 partial 말풍선 생성
      partialBubble = document.createElement('div');
      partialBubble.className = 'transcript-item partial';
      const content = document.createElement('p');
      content.textContent = partialText;
      partialBubble.appendChild(content);
      elements.transcriptList.appendChild(partialBubble);
    } else {
      // 기존 partial 말풍선 업데이트
      const content = partialBubble.querySelector('p');
      if (content) {
        content.textContent = partialText;
      }
    }
    
    scrollToBottom();
  }

  // analysis_result: AI 분석 결과 업데이트 (초경량 형식)
  function handleAnalysisResult(msg) {
    // msg: { type: "analysis_result", customer_intent_keyword: "...", relevant_manuals: [...] }
    console.log("[handleAnalysisResult] analysis_result 메시지 수신:", msg);
    
    const customerIntentKeyword = msg.customer_intent_keyword || "";
    const relevantManuals = msg.relevant_manuals || [];
    
    console.log("[handleAnalysisResult] customer_intent_keyword:", customerIntentKeyword);
    console.log("[handleAnalysisResult] relevant_manuals:", relevantManuals);
    
    // 고객 의도 키워드 표시
    updateCustomerIntent(customerIntentKeyword);
    
    // 대응 매뉴얼만 렌더링 (키워드, 추천 스크립트 제거됨)
    updateManualSuggestions(relevantManuals);
  }
  
  // 고객 의도 업데이트 함수 (키워드 누적 표시)
  function updateCustomerIntent(intentText) {
    const intentEl = document.getElementById('customer-intent');
    if (!intentEl) {
      console.warn("[updateCustomerIntent] customer-intent 요소를 찾을 수 없습니다.");
      return;
    }
    
    console.log("[updateCustomerIntent] 고객 의도 업데이트:", intentText);
    
    if (intentText && intentText.trim()) {
      // customer_intent_keyword를 파싱하여 키워드 배열로 변환
      const newKeywords = intentText.split(/\s+/)
        .map(kw => kw.trim())
        .filter(kw => kw.length > 0);
      
      console.log("[updateCustomerIntent] 파싱된 키워드:", newKeywords);
      
      // 기존 키워드 배열에 새 키워드 추가 (중복 제거)
      newKeywords.forEach(keyword => {
        if (!customerIntentKeywords.includes(keyword)) {
          customerIntentKeywords.push(keyword);
        }
      });
      
      // 최대 키워드 개수 제한 (10개)
      if (customerIntentKeywords.length > 10) {
        customerIntentKeywords = customerIntentKeywords.slice(-10);
      }
      
      console.log("[updateCustomerIntent] 누적된 키워드:", customerIntentKeywords);
      
      // 키워드 칩 렌더링
      renderIntentKeywords(intentEl);
    } else {
      // 빈 값이면 placeholder 표시
      intentEl.innerHTML = '<span class="placeholder">고객 의도 분석 중...</span>';
    }
  }
  
  // 키워드 칩 렌더링 함수
  function renderIntentKeywords(containerEl) {
    if (!containerEl) return;
    
    // 기존 내용 제거
    containerEl.innerHTML = '';
    
    if (customerIntentKeywords.length === 0) {
      containerEl.innerHTML = '<span class="placeholder">고객 의도 분석 중...</span>';
      return;
    }
    
    // 키워드 칩 생성
    customerIntentKeywords.forEach(keyword => {
      const chip = document.createElement('span');
      chip.className = 'keyword-chip';
      chip.textContent = keyword;
      containerEl.appendChild(chip);
    });
    
    console.log("[renderIntentKeywords] 키워드 칩 렌더링 완료:", customerIntentKeywords.length, "개");
  }
  
  // LAG 결과 처리 함수 (신규)
  function handleLagIntentResult(msg) {
    // msg: { type: "lag_intent_result", customer_intent_keyword: "..." }
    const intentKeyword = msg.customer_intent_keyword || "";
    
    console.log("[WebSocket] lag_intent_result 수신:", intentKeyword);
    
    if (intentKeyword && intentKeyword.trim()) {
      // 고객 의도 키워드 업데이트
      updateCustomerIntent(intentKeyword);
      console.log("[LAG] 고객 의도 키워드 업데이트 완료:", intentKeyword);
    } else {
      console.warn("[LAG] 고객 의도 키워드가 비어있습니다.");
    }
  }
  
  // Task C 결과 처리 함수 (신규)
  function handleTaskCResult(msg) {
    // msg: { type: "task_c_result", data: {...요약 JSON...} }
    const summaryData = msg.data || {};
    
    console.log("[WebSocket] task_c_result 수신:", summaryData);
    
    // 데이터 검증
    if (!summaryData || Object.keys(summaryData).length === 0) {
      console.warn("[handleTaskCResult] 요약 데이터가 비어있습니다.");
    }
    
    // 4단계: localStorage에 전체 요약 JSON 저장
    localStorage.setItem('callSummaryData', JSON.stringify(summaryData));
    console.log("[handleTaskCResult] localStorage에 callSummaryData 저장 완료");
    
    // conversation_history를 텍스트로 변환하여 localStorage에 저장 (화자 구별 제거, 텍스트만)
    const historyText = conversation_history.map(item => item.text).join('\n');
    localStorage.setItem('conversationHistoryText', historyText);
    console.log("[handleTaskCResult] localStorage에 conversationHistoryText 저장 완료");
    
    // 콜 ID와 통화 시간 저장
    const callId = elements.callId ? elements.callId.textContent : 'Hack-2025';
    const callDuration = elements.callTimer ? elements.callTimer.textContent : '00:00';
    localStorage.setItem('callId', callId);
    localStorage.setItem('callDuration', callDuration);
    console.log("[handleTaskCResult] localStorage에 callId, callDuration 저장 완료:", callId, callDuration);
    
    // 5단계: debriefing.html로 이동
    console.log("[handleTaskCResult] debriefing.html로 이동");
    window.location.href = 'debriefing.html';
  }
  
  // 헬퍼 함수: 말풍선 렌더링 (색깔있는 사각형으로 뭉쳐서 표시)
  function renderBubble(messageId, text, speakerId, tag) {
    if (!elements.transcriptList) return;
    
    if (elements.transcriptList.querySelector('.placeholder')) {
      elements.transcriptList.innerHTML = '';
    }
    
    const item = document.createElement('div');
    item.id = messageId;
    item.className = 'transcript-item';
    // 색깔있는 사각형 스타일 적용
    item.style.cssText = 'background: rgba(199, 93, 44, 0.15); border: 1px solid rgba(199, 93, 44, 0.3); border-radius: 8px; padding: 12px; margin-bottom: 8px;';
    
    // 시간만 표시 (화자 태그 제거)
    const meta = document.createElement('div');
    meta.className = 'transcript-meta';
    meta.style.cssText = 'font-size: 0.75rem; color: rgba(63, 42, 32, 0.6); margin-bottom: 6px;';
      const elapsed = elements.callTimer ? elements.callTimer.textContent : '00:00';
    meta.textContent = elapsed;
      item.appendChild(meta);
    
    const content = document.createElement('p');
    content.style.cssText = 'margin: 0; line-height: 1.5; color: #3f2a20;';
    content.textContent = text;
    item.appendChild(content);
    
    elements.transcriptList.appendChild(item);
  }
  
  // 헬퍼 함수: 말풍선 태그 업데이트 (화자 구별 제거, 사용하지 않음)
  function updateBubbleTag(messageId, tag) {
    // 화자 구별 제거로 인해 이 함수는 더 이상 사용되지 않음
    // 시간만 표시하도록 renderBubble에서 처리
    return;
  }
  
  // 헬퍼 함수: 모든 말풍선 태그 업데이트 (화자 구별 제거, 사용하지 않음)
  function updateAllBubbleTags(speakerMap) {
    // 화자 구별 제거로 인해 이 함수는 더 이상 사용되지 않음
    return;
  }
  
  // 헬퍼 함수: 스크롤 맨 아래로
  function scrollToBottom() {
    setTimeout(() => {
      if (elements.transcriptList) {
        elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
      }
    }, 10);
  }
  
  // 헬퍼 함수: AI 솔루션 카드 업데이트 (초경량: 매뉴얼만 표시)
  // 참고: 키워드와 추천 스크립트는 제거됨
  function updateSolutionCard(ragResults) {
    // 대응 매뉴얼만 렌더링
    updateManualSuggestions(ragResults.relevant_manuals || []);
  }
  
  // 헬퍼 함수: 감정 UI 업데이트
  function updateEmotionUI(emotionResult) {
    if (Object.keys(emotionResult).length > 0) {
      console.log("[감정 분석]", emotionResult);
      // 감정 지표 업데이트 로직 추가 가능
    }
  }



  // 원격지원 UI 표시/숨김 함수
  function showRemoteSupportUI() {
    const remoteSection = document.getElementById('remote-support-section');
    if (remoteSection) {
      remoteSection.style.display = 'block';
      // 원격지원 UI 이벤트 리스너 초기화
      initRemoteSupportUI();
    }
  }

  function hideRemoteSupportUI() {
    const remoteSection = document.getElementById('remote-support-section');
    if (remoteSection) {
      remoteSection.style.display = 'none';
      // 원격지원 상태 초기화
      resetRemoteSupportState();
      // 초기화 플래그 리셋 (다음에 다시 표시될 때 이벤트 리스너 재등록)
      remoteSupportInitialized = false;
    }
  }

  // 원격지원 상태 초기화
  function resetRemoteSupportState() {
    const connectBtn = document.getElementById('remote-connect-btn-index');
    const unlockBtn = document.getElementById('remote-unlock-btn-index');
    const lockBtn = document.getElementById('remote-lock-btn-index');
    const statusBtn = document.getElementById('remote-status-btn-index');
    const connectionStatus = document.getElementById('remote-connection-status-index');
    const resultArea = document.getElementById('remote-result-area-index');
    
    if (connectBtn) {
      connectBtn.textContent = '원격지원 연결';
      connectBtn.disabled = false;
    }
    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.textContent = '문 열기';
    }
    if (lockBtn) {
      lockBtn.disabled = true;
      lockBtn.textContent = '문 잠그기';
    }
    if (statusBtn) {
      statusBtn.disabled = true;
      statusBtn.textContent = '차량 상태 확인';
    }
    if (connectionStatus) {
      connectionStatus.textContent = '연결 안 됨';
      connectionStatus.style.color = '#dc3545';
    }
    if (resultArea) {
      resultArea.style.display = 'none';
    }
    remoteConnectedIndex = false;
  }

  // 원격지원 상태 관리 (index.html용)
  let remoteConnectedIndex = false;
  let vehicleStatusIndex = {
    doorLocked: true,
    engineOn: false,
    batteryLevel: 85
  };

  // 원격지원 UI 이벤트 리스너 초기화 (이벤트 위임 방식 사용)
  let remoteSupportInitialized = false;
  
  function initRemoteSupportUI() {
    const remoteSection = document.getElementById('remote-support-section');
    if (!remoteSection) return; // UI가 없으면 초기화하지 않음
    
    // 이미 초기화되었으면 중복 등록 방지
    if (remoteSupportInitialized) return;
    remoteSupportInitialized = true;
    
    // 이벤트 위임: 원격지원 섹션에 클릭 이벤트 리스너 등록
    remoteSection.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || !target.id) return;
      
      // 원격지원 연결 버튼
      if (target.id === 'remote-connect-btn-index') {
        e.preventDefault();
        e.stopPropagation();
        
        const connectBtn = target;
        if (!remoteConnectedIndex) {
          // 연결 시뮬레이션
          connectBtn.textContent = '연결 중...';
          connectBtn.disabled = true;
          
    setTimeout(() => {
            remoteConnectedIndex = true;
            connectBtn.textContent = '연결 해제';
            connectBtn.disabled = false;
            const connectionStatus = document.getElementById('remote-connection-status-index');
            if (connectionStatus) {
              connectionStatus.textContent = '연결됨';
              connectionStatus.style.color = '#28a745';
            }
            
            // 제어 버튼 활성화
            const unlockBtn = document.getElementById('remote-unlock-btn-index');
            const lockBtn = document.getElementById('remote-lock-btn-index');
            const statusBtn = document.getElementById('remote-status-btn-index');
            if (unlockBtn) unlockBtn.disabled = false;
            if (lockBtn) lockBtn.disabled = false;
            if (statusBtn) statusBtn.disabled = false;
            
            showRemoteResult('원격지원이 연결되었습니다. 차량 제어가 가능합니다.');
          }, 1500);
        } else {
          // 연결 해제
          remoteConnectedIndex = false;
          connectBtn.textContent = '원격지원 연결';
          const connectionStatus = document.getElementById('remote-connection-status-index');
          if (connectionStatus) {
            connectionStatus.textContent = '연결 안 됨';
            connectionStatus.style.color = '#dc3545';
          }
          
          // 제어 버튼 비활성화
          const unlockBtn = document.getElementById('remote-unlock-btn-index');
          const lockBtn = document.getElementById('remote-lock-btn-index');
          const statusBtn = document.getElementById('remote-status-btn-index');
          if (unlockBtn) unlockBtn.disabled = true;
          if (lockBtn) lockBtn.disabled = true;
          if (statusBtn) statusBtn.disabled = true;
          
          const resultArea = document.getElementById('remote-result-area-index');
          if (resultArea) resultArea.style.display = 'none';
        }
        return;
      }
      
      // 문 열기 버튼
      if (target.id === 'remote-unlock-btn-index') {
        e.preventDefault();
        e.stopPropagation();
        
        if (!remoteConnectedIndex) return;
        
        const unlockBtn = target;
        unlockBtn.disabled = true;
        unlockBtn.textContent = '처리 중...';
        
        setTimeout(() => {
          vehicleStatusIndex.doorLocked = false;
          unlockBtn.disabled = false;
          unlockBtn.textContent = '문 열기';
          showRemoteResult('✅ 문이 성공적으로 열렸습니다. 고객님께 확인해 주세요.');
        }, 2000);
        return;
      }
      
      // 문 잠그기 버튼
      if (target.id === 'remote-lock-btn-index') {
        e.preventDefault();
        e.stopPropagation();
        
        if (!remoteConnectedIndex) return;
        
        const lockBtn = target;
        lockBtn.disabled = true;
        lockBtn.textContent = '처리 중...';
        
        setTimeout(() => {
          vehicleStatusIndex.doorLocked = true;
          lockBtn.disabled = false;
          lockBtn.textContent = '문 잠그기';
          showRemoteResult('🔒 문이 성공적으로 잠겼습니다. 고객님께 확인해 주세요.');
        }, 2000);
        return;
      }
      
      // 차량 상태 확인 버튼
      if (target.id === 'remote-status-btn-index') {
        e.preventDefault();
        e.stopPropagation();
        
        if (!remoteConnectedIndex) return;
        
        const statusBtn = target;
        statusBtn.disabled = true;
        statusBtn.textContent = '확인 중...';
        
        setTimeout(() => {
          const statusText = `
            <div class="status-item">
              <strong>문 상태:</strong> ${vehicleStatusIndex.doorLocked ? '🔒 잠김' : '🔓 열림'}
            </div>
            <div class="status-item">
              <strong>시동 상태:</strong> ${vehicleStatusIndex.engineOn ? '🟢 켜짐' : '⚫ 꺼짐'}
            </div>
            <div class="status-item">
              <strong>배터리 잔량:</strong> ${vehicleStatusIndex.batteryLevel}%
            </div>
            <div class="status-item">
              <strong>차량 위치:</strong> 서울시 강남구 테헤란로 123
            </div>
          `;
          statusBtn.disabled = false;
          statusBtn.textContent = '차량 상태 확인';
          showRemoteResult(statusText);
        }, 1500);
        return;
      }
    });
  }

  // 원격지원 결과 표시 함수
  function showRemoteResult(message) {
    const resultArea = document.getElementById('remote-result-area-index');
    const resultContent = document.getElementById('remote-result-content-index');
    if (resultArea && resultContent) {
      resultContent.innerHTML = message;
      resultArea.style.display = 'block';
      
      // 5초 후 자동 숨김
      setTimeout(() => {
        resultArea.style.display = 'none';
      }, 5000);
    }
  }

  function updateManualSuggestions(manuals) {
    const manualList = document.getElementById('manual-list');
    if (!manualList) return;
    
    manualList.innerHTML = '';
    
    // 의미있는 말이 없을 때 솔루션 표시하지 않기 (conversation_history 길이 체크)
    if (conversation_history.length < 2) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '고객 의도에 맞는 대응 매뉴얼이 표시됩니다.';
      manualList.appendChild(li);
      return;
    }
    
    if (!manuals || manuals.length === 0) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '고객 의도에 맞는 대응 매뉴얼이 표시됩니다.';
      manualList.appendChild(li);
      return;
    }
    
    // 가장 적절한 1개만 표시 (경량화)
    const displayManuals = manuals.slice(0, 1);
    displayManuals.forEach((manual, idx) => {
      const li = document.createElement('li');
      li.className = 'solution-item manual-accordion';
      
      // 아코디언 헤더
      const header = document.createElement('div');
      header.className = 'manual-accordion-header';
      header.innerHTML = `
        <strong>${manual.title || '매뉴얼'}</strong>
        <span class="manual-accordion-toggle">▼</span>
      `;
      
      // 아코디언 내용 (steps 표시)
      const content = document.createElement('div');
      content.className = 'manual-accordion-content';
      content.style.display = 'none';
      
      let stepsHtml = '';
      if (manual.steps && Array.isArray(manual.steps)) {
        manual.steps.forEach((step, stepIdx) => {
          stepsHtml += `
            <div style="margin-top: ${stepIdx > 0 ? '16px' : '8px'};">
              <div style="font-weight: 600; color: #c75d2c; margin-bottom: 6px;">${step.title || ''}</div>
              <div style="white-space: pre-line; line-height: 1.6;">${step.content || ''}</div>
            </div>
          `;
        });
      }
      content.innerHTML = stepsHtml;
      
      // 클릭 이벤트: 아코디언 토글
      header.addEventListener('click', () => {
        const isOpen = content.style.display !== 'none';
        content.style.display = isOpen ? 'none' : 'block';
        const toggle = header.querySelector('.manual-accordion-toggle');
        toggle.textContent = isOpen ? '▼' : '▲';
      });
      
      li.appendChild(header);
      li.appendChild(content);
      manualList.appendChild(li);
      
      // 2.1. 스마트키 오류 매뉴얼일 때 원격지원 UI 표시
      if (manual.title && manual.title.includes('스마트키')) {
        showRemoteSupportUI();
      } else {
        hideRemoteSupportUI();
      }
    });
    
    // 비서 말풍선 업데이트
    if (elements.assistantBubble && displayManuals.length > 0) {
      const firstManual = displayManuals[0];
      const suggestionText = firstManual.title || '대응 매뉴얼';
      elements.assistantBubble.innerHTML = `고객 의도를 분석하여 최적의 솔루션을 추천합니다.<br>${suggestionText}`;
    }
  }

  function updateRecommendedScript(script) {
    const scriptContent = document.getElementById('script-content');
    if (!scriptContent) return;
    
    scriptContent.innerHTML = '';
    if (!script || script.trim() === '') {
      const placeholder = document.createElement('div');
      placeholder.className = 'placeholder';
      placeholder.textContent = '추천 스크립트가 표시됩니다.';
      scriptContent.appendChild(placeholder);
      return;
    }
    
    const scriptDiv = document.createElement('div');
    scriptDiv.className = 'solution-item';
    scriptDiv.style.whiteSpace = 'pre-line';
    scriptDiv.style.lineHeight = '1.6';
    scriptDiv.textContent = script;
    scriptContent.appendChild(scriptDiv);
  }

  function updateKeywords(keywords) {
    const keywordList = document.getElementById('keyword-list');
    if (!keywordList) return;
    
    keywordList.innerHTML = '';
    if (!keywords || keywords.length === 0) {
      const span = document.createElement('span');
      span.className = 'placeholder';
      span.textContent = '아직 키워드가 없습니다.';
      keywordList.appendChild(span);
      return;
    }
    keywords.forEach((keyword) => {
      const chip = document.createElement('span');
      chip.className = 'keyword-chip';
      chip.textContent = keyword;
      keywordList.appendChild(chip);
    });
  }


  function updateLatency(latency) {
    if (!elements.latencyBadge) return;
    elements.latencyBadge.textContent = `Latency ${latency} ms`;
    resetBadge(elements.latencyBadge);
    if (latency > 800) setBadgeClass(elements.latencyBadge, 'badge-danger');
    else if (latency > 400) setBadgeClass(elements.latencyBadge, 'badge-warning');
    else setBadgeClass(elements.latencyBadge, 'badge-success');
  }

  // --- (삭제) playNextSegment() ---

  function startCallTimer() {
    callStartTime = Date.now();
    updateCallTimer();
    callTimerInterval = setInterval(updateCallTimer, 1000);
  }
  
  function stopIntervals() {
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = null;
  }

  function resetTranscript() {
    if (elements.transcriptList) elements.transcriptList.innerHTML = '<p class.placeholder">대화가 시작되면 여기에 텍스트가 표시됩니다.</p>';
  }

  function resetUI() {
    if (elements.callState) elements.callState.textContent = '대기 중';
    if (elements.callTimer) elements.callTimer.textContent = '00:00';
    callStartTime = null; // 통화 시작 시간 초기화
    resetBadge(elements.latencyBadge);
    if (elements.latencyBadge) elements.latencyBadge.textContent = 'Latency -- ms';
    
    // 고객 의도 초기화
    const customerIntentEl = document.getElementById('customer-intent');
    if (customerIntentEl) customerIntentEl.innerHTML = '<span class="placeholder">고객 의도 분석 중...</span>';
    
    // 대응 매뉴얼 초기화
    const manualList = document.getElementById('manual-list');
    if (manualList) manualList.innerHTML = '<li class="placeholder">고객 의도에 맞는 대응 매뉴얼이 표시됩니다.</li>';
    
    if (elements.assistantBubble) elements.assistantBubble.innerHTML = "고객 의도를 분석하여 최적의 솔루션을 추천합니다.<br>제시된 대응 매뉴얼을 선택하여 즉시 활용하세요.";
    
    // 화자 분석 상태 초기화
    speakerMap = {};
    isSpeakerMapConfirmed = false;
    messageCounter = 0;
    messageDataMap = {};
    conversation_history = [];
    customerIntentKeywords = []; // 고객 의도 키워드 초기화
    
    // 원격지원 UI 숨기기
    hideRemoteSupportUI();
    
    resetTranscript();
  }

  // (수정) WebSocket 연결 시작 및 STT 시작
  function startDemo() {
    if (demoRunning) return;
    
    resetUI();
    if(elements.callId) elements.callId.textContent = generateCallId();
    if(elements.callState) elements.callState.textContent = '연결 중...';
    demoRunning = true;
    
    if(elements.startBtn) elements.startBtn.disabled = true;
    if(elements.stopBtn) elements.stopBtn.disabled = false;
    
    startCallTimer();
    
    // (신규) WebSocket 연결
    connectWebSocket(); 
    
    // WebSocket 연결 후 "start_demo" 메시지 전송 (STT 시작)
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const startMessage = {
          type: "start_demo"
        };
        ws.send(JSON.stringify(startMessage));
        console.log("[WebSocket] start_demo 메시지 전송: STT 시작");
        if (elements.callState) elements.callState.textContent = '통화 중';
      }
    }, 500); // WebSocket 연결 대기 (500ms)
    
    // 15초 후 LAG로 "고객 의도" 업데이트 (Gemini API 호출)
    setTimeout(() => {
      if (demoRunning && ws && ws.readyState === WebSocket.OPEN) {
        // 서버에 LAG 요청 전송
        const lagMessage = {
          type: "lag_intent_request"
        };
        ws.send(JSON.stringify(lagMessage));
        console.log("[LAG] 15초 후 lag_intent_request 메시지 전송: Gemini API 호출 요청");
      }
    }, 15000); // 15초 후 실행
  }

  // (수정) WebSocket 연결 종료 및 Task C 요청
  function stopDemo(manual = true) {
    if (!demoRunning && manual) return; // 이미 중지됨
    
    demoRunning = false;
    stopIntervals();
    
    if (manual) {
        // 1단계: STT/VAD 중단 (active_stt_stream은 서버에서 관리)
        // 서버에 "stop_demo" 메시지 전송 (Task C 실행 요청)
        if (ws && ws.readyState === WebSocket.OPEN) {
          // 2단계: Task C 실행 요청
          const stopMessage = {
            type: "stop_demo"
          };
          ws.send(JSON.stringify(stopMessage));
          console.log("[WebSocket] stop_demo 메시지 전송: Task C 실행 요청");
          
          // 3단계: UI에 "요약 중..." 스피너 표시
          if (elements.callState) {
            elements.callState.textContent = '요약 중...';
          }
          
          // 4단계: task_c_result 메시지 수신 대기 (이미 ws.onmessage에서 처리됨)
          // task_c_result 핸들러에서 localStorage 저장 및 페이지 이동 처리
        } else {
          // WebSocket이 연결되지 않은 경우 직접 이동
          console.warn("[WebSocket] 연결이 없어 Task C를 실행할 수 없습니다.");
        window.location.href = 'debriefing.html';
        }
    }

    if(elements.startBtn) elements.startBtn.disabled = false;
    if(elements.stopBtn) elements.stopBtn.disabled = true;
  }

  // 데모 데이터 수집 함수
  function collectDemoData() {
    const transcriptItems = elements.transcriptList ? Array.from(elements.transcriptList.querySelectorAll('.transcript-item')) : [];
    const transcript = transcriptItems.map(item => {
      const meta = item.querySelector('.transcript-meta')?.textContent || '';
      const text = item.querySelector('p')?.textContent || '';
      const speaker = meta.includes('고객') ? 'customer' : 'agent';
      return { speaker, text, meta };
    });

    // 감정 분석 데이터 (간단한 예시)
    const emotionData = {
      difficulty: calculateCallDifficulty(transcript),
      stressLevel: 0, // 상담원 보호 카드 삭제로 인해 기본값 사용
      escalations: 0 // 상담원 보호 카드 삭제로 인해 기본값 사용
    };

    return {
      callId: elements.callId ? elements.callId.textContent : 'Hack-2025',
      duration: elements.callTimer ? elements.callTimer.textContent : '00:00',
      transcript: transcript,
      emotion: emotionData,
      timestamp: new Date().toISOString()
    };
  }

  // 콜 난이도 계산 (간단한 예시)
  function calculateCallDifficulty(transcript) {
    let difficulty = 1; // 기본 1단계
    const allText = transcript.map(t => t.text).join(' ').toLowerCase();
    
    // 키워드 기반 난이도 계산
    if (allText.includes('불만') || allText.includes('화나') || allText.includes('짜증')) {
      difficulty = 3;
    }
    if (allText.includes('환불') || allText.includes('보상') || allText.includes('불만')) {
      difficulty = Math.max(difficulty, 4);
    }
    if (allText.includes('폭언') || allText.includes('욕설') || allText.includes('고성')) {
      difficulty = 5;
    }
    
    return difficulty;
  }


  // 탭 전환 기능 제거됨 (Part 2: 예상 질문 탭 삭제)

  // --- (신규) 검색 기능 (데모) ---
  function initSearch() {
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('knowledge-search');
    const searchResults = document.getElementById('search-results');

    if (!searchBtn || !searchInput || !searchResults) return;

    const demoSearchResults = [
      { title: "환불 정책", content: "고객이 환불을 요청할 경우, 주문일로부터 7일 이내에만 환불이 가능합니다. 단, 상품이 사용되었거나 손상된 경우 환불이 제한될 수 있습니다." },
      { title: "배송 지연 처리", content: "배송이 지연된 경우, 즉시 배송 조치를 취하고 고객에게 사과 및 배송비 환불을 제안합니다. 추가로 배송 상태를 실시간으로 안내합니다." },
      { title: "불만 고객 응대", content: "불만을 표시하는 고객에게는 먼저 공감 표현을 하고, 문제의 원인을 파악한 후 즉각적인 해결책을 제시합니다." }
    ];

    function performSearch(query) {
      if (!query.trim()) {
        searchResults.innerHTML = '<p class="placeholder">검색어를 입력하세요.</p>';
        return;
      }

      const filtered = demoSearchResults.filter(item => 
        item.title.toLowerCase().includes(query.toLowerCase()) || 
        item.content.toLowerCase().includes(query.toLowerCase())
      );

      if (filtered.length === 0) {
        searchResults.innerHTML = '<p class="placeholder">검색 결과가 없습니다.</p>';
        return;
      }

      searchResults.innerHTML = filtered.map(item => `
        <div class="search-result-item">
          <h4>${item.title}</h4>
          <p>${item.content}</p>
        </div>
      `).join('');
    }

    searchBtn.addEventListener('click', () => {
      performSearch(searchInput.value);
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performSearch(searchInput.value);
      }
    });
  }

  // --- (신규) 매뉴얼 검색 기능 ---
  function initManualSearch() {
    const searchBtn = document.getElementById('manual-search-btn');
    const searchInput = document.getElementById('manual-search');
    const searchResults = document.getElementById('manual-search-results');

    if (!searchBtn || !searchInput || !searchResults) return;

    const allManuals = [
      { title: "1.1. 교통사고 발생 시 대응 매뉴얼", category: "긴급/사고", link: "manual-detail.html?category=emergency&id=1" },
      { title: "1.2. 차량 고장 및 견인 매뉴얼", category: "긴급/사고", link: "manual-detail.html?category=emergency&id=2" },
      { title: "1.3. 법규 위반 인지 시 매뉴얼", category: "긴급/사고", link: "manual-detail.html?category=emergency&id=3" },
      { title: "2.1. 스마트키 (도어) 오류 매뉴얼", category: "차량 이용 중", link: "manual-detail.html?category=usage&id=1" },
      { title: "2.2. 차량 상태 불량 매뉴얼", category: "차량 이용 중", link: "manual-detail.html?category=usage&id=2" },
      { title: "2.3. 주유/충전 카드 문제 매뉴얼", category: "차량 이용 중", link: "manual-detail.html?category=usage&id=3" },
      { title: "3.1. 예약 변경 및 취소/환불 매뉴얼", category: "예약/결제", link: "manual-detail.html?category=payment&id=1" },
      { title: "3.2. 과금 및 요금 이의제기 매뉴얼", category: "예약/결제", link: "manual-detail.html?category=payment&id=2" },
      { title: "3.3. 분실물 처리 매뉴얼", category: "예약/결제", link: "manual-detail.html?category=payment&id=3" },
      { title: "4.1. 회원 가입 및 면허 인증 매뉴얼", category: "가입/기타", link: "manual-detail.html?category=other&id=1" },
      { title: "4.2. 주차존 관련 매뉴얼", category: "가입/기타", link: "manual-detail.html?category=other&id=2" }
    ];

    function performManualSearch(query) {
      if (!query.trim()) {
        searchResults.innerHTML = '<p class="placeholder">검색어를 입력하세요.</p>';
        return;
      }

      const filtered = allManuals.filter(manual => 
        manual.title.toLowerCase().includes(query.toLowerCase()) || 
        manual.category.toLowerCase().includes(query.toLowerCase())
      );

      if (filtered.length === 0) {
        searchResults.innerHTML = '<p class="placeholder">검색 결과가 없습니다.</p>';
        return;
      }

      searchResults.innerHTML = filtered.map(manual => `
        <a href="${manual.link}" class="search-result-item" style="display: block; text-decoration: none; color: inherit;">
          <h4>${manual.title}</h4>
          <p>카테고리: ${manual.category}</p>
        </a>
      `).join('');
    }

    searchBtn.addEventListener('click', () => {
      performManualSearch(searchInput.value);
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        performManualSearch(searchInput.value);
      }
    });
  }

  // --- (신규) 의도 분석 하이라이팅 (데모) ---
  function highlightIntent() {
    const transcriptList = document.getElementById('transcript-list');
    const intentList = document.getElementById('intent-list');
    
    if (!transcriptList || !intentList) return;

    // 데모 의도 데이터
    const demoIntents = [
      { text: '환불 요청', highlight: true },
      { text: '배송 문의', highlight: false },
      { text: '불만 표시', highlight: true }
    ];

    // 의도 칩 표시
    intentList.innerHTML = demoIntents.map(intent => {
      const chipClass = intent.highlight ? 'intent-chip highlight' : 'intent-chip';
      return `<span class="${chipClass}">${intent.text}</span>`;
    }).join('');

    // 전사본에서 키워드 하이라이팅 (데모)
    const transcriptItems = transcriptList.querySelectorAll('.transcript-item p');
    transcriptItems.forEach(item => {
      const text = item.textContent;
      const highlighted = text.replace(/(환불|배송|불만)/g, '<mark style="background: rgba(255, 152, 82, 0.3); padding: 2px 4px; border-radius: 4px;">$1</mark>');
      if (highlighted !== text) {
        item.innerHTML = highlighted;
      }
    });
  }

  // --- (신규) AI 솔루션 추천 초기화 (데모 데이터 제거, 실제 데이터는 WebSocket으로 받음) ---
  function initSolutionDemo() {
    // 실제 데이터는 WebSocket을 통해 받아오므로 초기화만 수행
    const manualList = document.getElementById('manual-list');
    const scriptContent = document.getElementById('script-content');
    const keywordList = document.getElementById('keyword-list');

    if (manualList && manualList.querySelector('.placeholder')) {
      // 이미 placeholder가 있으면 그대로 유지
    }
    if (scriptContent && scriptContent.querySelector('.placeholder')) {
      // 이미 placeholder가 있으면 그대로 유지
    }
    if (keywordList && keywordList.querySelector('.placeholder')) {
      // 이미 placeholder가 있으면 그대로 유지
    }
  }

  // --- (수정) init 함수에 새 기능 추가 ---
  function init() {
    resetUI();
    if(elements.startBtn) elements.startBtn.addEventListener('click', startDemo);
    if(elements.stopBtn) elements.stopBtn.addEventListener('click', stopDemo);
    
    // 신규 기능 초기화
    initSearch();
    initManualSearch();
    // highlightIntent() 제거: 하드코딩된 데이터 대신 WebSocket으로 받은 실제 데이터 사용
    initSolutionDemo();
  }

  document.addEventListener('DOMContentLoaded', init);
})();