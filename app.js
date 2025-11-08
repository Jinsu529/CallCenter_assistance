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
    agentStateLabel: document.getElementById('agent-state-label'),
    stressBar: document.getElementById('stress-bar'),
    stressValue: document.getElementById('stress-value'),
    escalationCount: document.getElementById('escalation-count'),
    agentHint: document.getElementById('agent-hint'),
    assistantBubble: document.querySelector('.assistant-bubble')
  };

  let demoRunning = false;
  let callStartTime = null;
  let callTimerInterval = null;

  // --- (신규) WebSocket ---
  let ws = null;
  const WEBSOCKET_URL = "ws://localhost:8766"; // Python 서버 주소 (포트 수정)

  function generateCallId() {
    const prefix = ['R', 'T', 'W'][Math.floor(Math.random() * 3)];
    const number = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${number}`;
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
      if (elements.agentHint) elements.agentHint.textContent = "백엔드 AI 서버에 연결되었습니다. 마이크에 말씀하세요.";
      startDemo();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("[WebSocket] 메시지 수신:", msg);

        // 수신된 메시지 유형에 따라 UI 업데이트
        if (msg.type === 'stt') {
          applySTT(msg.data);
        } else if (msg.type === 'analysis') {
          applyAnalysis(msg.data);
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
        if (elements.agentHint) elements.agentHint.textContent = "백엔드 서버와 연결이 끊겼습니다. 서버를 확인하세요.";
      }
    };

    ws.onerror = (err) => {
      console.error("[WebSocket] 오류:", err);
      if (elements.callState) elements.callState.textContent = '연결 오류';
      if (elements.agentHint) elements.agentHint.textContent = "백엔드 서버에 연결할 수 없습니다. (Python 서버 실행 확인)";
      stopDemo(false);
    };
  }
  
  function disconnectWebSocket() {
      if (ws) {
          ws.close();
          ws = null;
      }
  }

  // --- (신규) UI 업데이트 함수 분리 ---
  function applySTT(data) {
    appendTranscript(data); // data: { speaker, text, latency }
    updateLatency(data.latency);
  }

  function applyAnalysis(data) {
    // data: { suggestions, expected_questions, recommended_scripts, keywords, relevant_manuals, ... }
    updateManualSuggestions(data.suggestions || []);
    updateExpectedQuestions(data.expected_questions || []);
    updateRecommendedScripts(data.recommended_scripts || []);
    updateKeywords(data.keywords || []);
    updateAgentState(data); // agentStress, agentState, escalations, alert 포함
    
    // 비서 말풍선 업데이트
    if(elements.assistantBubble) {
        const firstSuggestion = data.suggestions && data.suggestions[0];
        const suggestionText = firstSuggestion ? `${firstSuggestion.title}: ${firstSuggestion.step}` : "고객의 말을 경청하세요.";
        elements.assistantBubble.innerHTML = `고객 의도를 분석하여 최적의 솔루션을 추천합니다.<br>${suggestionText}`;
    }
  }

  // --- 기존 UI 업데이트 함수 (변경 없음) ---
  function appendTranscript(entry) {
    if (!elements.transcriptList) return;
    if (elements.transcriptList.querySelector('.placeholder')) {
      elements.transcriptList.innerHTML = '';
    }
    const item = document.createElement('div');
    item.className = `transcript-item ${entry.speaker === '고객' ? 'customer' : 'agent'}`;
    const meta = document.createElement('div');
    meta.className = 'transcript-meta';
    const elapsed = elements.callTimer.textContent;
    meta.textContent = `${entry.speaker} · ${elapsed}`;
    const content = document.createElement('p');
    content.textContent = entry.text;
    item.appendChild(meta);
    item.appendChild(content);
    elements.transcriptList.appendChild(item);
    elements.transcriptList.scrollTop = elements.transcriptList.scrollHeight;
  }


  function updateManualSuggestions(suggestions) {
    const manualList = document.getElementById('manual-list');
    if (!manualList) return;
    
    manualList.innerHTML = '';
    if (!suggestions || suggestions.length === 0) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '고객 의도에 맞는 대응 매뉴얼이 표시됩니다.';
      manualList.appendChild(li);
      return;
    }
    
    suggestions.forEach((suggestion, idx) => {
      const li = document.createElement('li');
      li.className = 'solution-item';
      li.innerHTML = `
        <strong>${suggestion.title || '매뉴얼'}</strong>
        <span style="display: block; margin-top: 6px; font-weight: 600; color: #c75d2c;">${suggestion.step || ''}</span>
        <span style="display: block; margin-top: 8px; white-space: pre-line;">${suggestion.content || ''}</span>
      `;
      manualList.appendChild(li);
    });
  }

  function updateExpectedQuestions(questions) {
    const questionsList = document.getElementById('questions-list');
    if (!questionsList) return;
    
    questionsList.innerHTML = '';
    if (!questions || questions.length === 0) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '예상 질문이 표시됩니다.';
      questionsList.appendChild(li);
      return;
    }
    
    questions.forEach((question, idx) => {
      const li = document.createElement('li');
      li.className = 'solution-item';
      li.innerHTML = `<span>${question}</span>`;
      questionsList.appendChild(li);
    });
  }

  function updateRecommendedScripts(scripts) {
    const scriptList = document.getElementById('script-list');
    if (!scriptList) return;
    
    scriptList.innerHTML = '';
    if (!scripts || scripts.length === 0) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '추천 스크립트가 표시됩니다.';
      scriptList.appendChild(li);
      return;
    }
    
    scripts.forEach((script, idx) => {
      const li = document.createElement('li');
      li.className = 'solution-item';
      li.innerHTML = `<span style="white-space: pre-line;">${script}</span>`;
      scriptList.appendChild(li);
    });
  }

  function updateKeywords(keywords) {
    if (!elements.keywordList) return;
    elements.keywordList.innerHTML = '';
    if (!keywords || keywords.length === 0) {
      const span = document.createElement('span');
      span.className = 'placeholder';
      span.textContent = '표시할 키워드가 없습니다.';
      elements.keywordList.appendChild(span);
      return;
    }
    keywords.forEach((keyword) => {
      const chip = document.createElement('span');
      chip.className = 'keyword-chip';
      chip.textContent = keyword;
      elements.keywordList.appendChild(chip);
    });
  }

  function updateAgentState(entry) {
    if (elements.agentStateLabel && entry.agentState) {
        setBadgeClass(elements.agentStateLabel, entry.agentState.badge);
        elements.agentStateLabel.textContent = entry.agentState.text;
    }
    if(elements.stressBar) {
        const stressPercent = Math.round(entry.agentStress * 100);
        elements.stressBar.style.width = `${stressPercent}%`;
        elements.stressValue.textContent = `${stressPercent} / 100`;
    }
    if(elements.escalationCount) elements.escalationCount.textContent = `${entry.escalations}건`;
    if(elements.agentHint) elements.agentHint.textContent = entry.alert;
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
    resetBadge(elements.latencyBadge);
    if (elements.latencyBadge) elements.latencyBadge.textContent = 'Latency -- ms';
    resetBadge(elements.agentStateLabel);
    if (elements.agentStateLabel) elements.agentStateLabel.textContent = '대기 중';
    if (elements.stressBar) elements.stressBar.style.width = '0%';
    if (elements.stressValue) elements.stressValue.textContent = '--';
    if (elements.escalationCount) elements.escalationCount.textContent = '0건';
    if (elements.agentHint) elements.agentHint.textContent = '데모를 시작하려면 ▶ 버튼을 눌러주세요.';
    if (elements.suggestionList) elements.suggestionList.innerHTML = '<li class="placeholder">고객 의도가 인식되면 솔루션이 안내됩니다.</li>';
    if (elements.keywordList) elements.keywordList.innerHTML = '<span class="placeholder">아직 키워드가 없습니다.</span>';
    if (elements.assistantBubble) elements.assistantBubble.innerHTML = "고객 의도를 분석하여 최적의 솔루션을 추천합니다.<br>제시된 대응 매뉴얼을 선택하여 즉시 활용하세요.";
    
    resetTranscript();
  }

  // (수정) WebSocket 연결 시작
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
  }

  // (수정) WebSocket 연결 종료
  function stopDemo(manual = true) {
    if (!demoRunning && manual) return; // 이미 중지됨
    
    demoRunning = false;
    stopIntervals();
    
    if (manual) {
        disconnectWebSocket();
        if(elements.callState) elements.callState.textContent = '데모 중지';
        if(elements.agentHint) elements.agentHint.textContent = '데모가 중단되었습니다. 다시 시작하려면 ▶ 버튼을 눌러주세요.';
    }

    if(elements.startBtn) elements.startBtn.disabled = false;
    if(elements.stopBtn) elements.stopBtn.disabled = true;
  }


  // --- (신규) 탭 전환 기능 ---
  function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        // 모든 탭 버튼 비활성화
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // 모든 탭 콘텐츠 숨김
        document.querySelectorAll('.tab-content').forEach(content => {
          content.classList.remove('active');
        });
        // 선택된 탭 콘텐츠 표시
        const targetContent = document.getElementById(`${tabName}-content`);
        if (targetContent) targetContent.classList.add('active');
      });
    });
  }

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
      { title: "4.2. 쏘카존 관련 매뉴얼", category: "가입/기타", link: "manual-detail.html?category=other&id=2" }
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
    const questionsList = document.getElementById('questions-list');
    const scriptList = document.getElementById('script-list');

    if (manualList && manualList.querySelector('.placeholder')) {
      // 이미 placeholder가 있으면 그대로 유지
    }
    if (questionsList && questionsList.querySelector('.placeholder')) {
      // 이미 placeholder가 있으면 그대로 유지
    }
    if (scriptList && scriptList.querySelector('.placeholder')) {
      // 이미 placeholder가 있으면 그대로 유지
    }
  }

  // --- (수정) init 함수에 새 기능 추가 ---
  function init() {
    resetUI();
    if(elements.startBtn) elements.startBtn.addEventListener('click', startDemo);
    if(elements.stopBtn) elements.stopBtn.addEventListener('click', stopDemo);
    
    // 신규 기능 초기화
    initTabs();
    initSearch();
    initManualSearch();
    highlightIntent();
    initSolutionDemo();
  }

  document.addEventListener('DOMContentLoaded', init);
})();