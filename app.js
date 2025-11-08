(() => {
  const elements = {
    startBtn: document.getElementById('start-demo'),
    stopBtn: document.getElementById('stop-demo'),
    callId: document.getElementById('call-id'),
    callTimer: document.getElementById('call-timer'),
    callState: document.getElementById('call-state'),
    audioDb: document.getElementById('audio-db'),
    audioFill: document.getElementById('audio-level-fill'),
    voiceCanvas: document.getElementById('voice-wave'),
    transcriptList: document.getElementById('transcript-list'),
    latencyBadge: document.getElementById('stt-latency'),
    primaryEmotion: document.getElementById('primary-emotion'),
    riskScore: document.getElementById('risk-score'),
    toneScore: document.getElementById('tone-score'),
    wpmScore: document.getElementById('wpm-score'),
    suggestionList: document.getElementById('suggestion-list'),
    keywordList: document.getElementById('keyword-list'),
    agentStateLabel: document.getElementById('agent-state-label'),
    stressBar: document.getElementById('stress-bar'),
    stressValue: document.getElementById('stress-value'),
    escalationCount: document.getElementById('escalation-count'),
    agentHint: document.getElementById('agent-hint')
  };

  const scenario = [
    {
      speaker: '고객',
      text: '왜 이렇게 처리 속도가 느린가요? 벌써 3일째 기다리고 있어요.',
      latency: 320,
      audioDb: 78,
      wpm: 148,
      tone: '격앙 · Pitch +18%',
      emotions: { anger: 0.78, frustration: 0.64, sadness: 0.12, neutral: 0.18, joy: 0.04 },
      risk: 0.86,
      keywords: ['배송 지연', '환불', '불만'],
      suggestions: [
        '먼저 불편에 대해 진심으로 사과하세요.',
        '현재 처리 현황과 예상 완료 시간을 명확하게 설명하세요.',
        '보상 옵션(쿠폰 등)과 즉시 조취 가능 여부를 안내하세요.'
      ],
      agentStress: 0.52,
      agentState: { text: '주의', badge: 'badge-warning' },
      escalations: 1,
      alert: '강한 불만 감지. 톤을 낮추고 확실한 해결책을 제안하세요.',
      delay: 4200
    },
    {
      speaker: '상담원',
      text: '불편을 드려 정말 죄송합니다. 주문 상태를 확인해 즉시 처리하겠습니다.',
      latency: 190,
      audioDb: 62,
      wpm: 125,
      tone: '차분 · Pitch -6%',
      emotions: { anger: 0.35, frustration: 0.28, sadness: 0.08, neutral: 0.49, joy: 0.12 },
      risk: 0.62,
      keywords: ['사과', '확인', '즉시 처리'],
      suggestions: [
        '문제 원인을 빠르게 확인하고, 구체적 조치를 약속하세요.',
        '단계별로 처리 현황을 안내하며 고객의 불안을 낮춰주세요.'
      ],
      agentStress: 0.48,
      agentState: { text: '안정', badge: 'badge-success' },
      escalations: 1,
      alert: '안정적인 응대입니다. 진행 상황을 주기적으로 공유하세요.',
      delay: 3800
    },
    {
      speaker: '고객',
      text: '지난번에도 확인해준다고 했는데 결국 연락이 없었어요. 이번엔 확실한가요?',
      latency: 310,
      audioDb: 74,
      wpm: 142,
      tone: '의심 · Pitch +10%',
      emotions: { anger: 0.68, frustration: 0.7, sadness: 0.18, neutral: 0.16, joy: 0.02 },
      risk: 0.8,
      keywords: ['확실한가요', '지난번', '불신'],
      suggestions: [
        '과거 이슈를 인정하고 개선된 절차를 설명하세요.',
        '확약 가능한 조치를 구체적 시간과 함께 제시하세요.',
        '추가 확인을 위해 상급자 지원 옵션을 안내하세요.'
      ],
      agentStress: 0.6,
      agentState: { text: '주의', badge: 'badge-warning' },
      escalations: 1,
      alert: '신뢰 회복이 필요합니다. 보증 문구와 후속 연락 약속을 강화하세요.',
      delay: 4400
    },
    {
      speaker: '상담원',
      text: '이번에는 처리 완료 시까지 실시간으로 알림을 드리겠습니다. 2시간 내 결과를 공유드리겠습니다.',
      latency: 210,
      audioDb: 60,
      wpm: 118,
      tone: '확신 · Pitch -4%',
      emotions: { anger: 0.28, frustration: 0.22, sadness: 0.05, neutral: 0.58, joy: 0.19 },
      risk: 0.52,
      keywords: ['실시간 알림', '2시간 내 결과', '확약'],
      suggestions: [
        '재발 방지 조치(전담 매니저 배정 등)를 언급하세요.',
        '필요 시 추가 보상 정책을 사전에 안내하세요.'
      ],
      agentStress: 0.55,
      agentState: { text: '안정', badge: 'badge-success' },
      escalations: 1,
      alert: '확신 있는 톤 유지. 약속한 시간 내 후속 조치를 반드시 이행하세요.',
      delay: 3600
    },
    {
      speaker: '고객',
      text: '알겠습니다. 이번엔 꼭 처리 부탁드려요. 안내 기다릴게요.',
      latency: 260,
      audioDb: 58,
      wpm: 110,
      tone: '진정 · Pitch -2%',
      emotions: { anger: 0.22, frustration: 0.34, sadness: 0.1, neutral: 0.54, joy: 0.18 },
      risk: 0.45,
      keywords: ['처리 부탁', '기다릴게요', '진정'],
      suggestions: [
        '감사 인사를 전하고 후속 안내 시점을 재확인하세요.',
        '문의 번호 또는 셀프 트래킹 링크를 제공하세요.'
      ],
      agentStress: 0.47,
      agentState: { text: '안정', badge: 'badge-success' },
      escalations: 0,
      alert: '감정이 진정되었습니다. 마무리 케어와 재확인 메시지를 준비하세요.',
      delay: 3200
    },
    {
      speaker: '상담원',
      text: '믿고 기다려주셔서 감사합니다. 2시간 내 결과를 문자와 앱 알림으로 보내드리겠습니다.',
      latency: 180,
      audioDb: 56,
      wpm: 112,
      tone: '마무리 · Pitch -5%',
      emotions: { anger: 0.12, frustration: 0.18, sadness: 0.04, neutral: 0.62, joy: 0.32 },
      risk: 0.32,
      keywords: ['감사', '알림', '마무리'],
      suggestions: [
        '후속 만족도 조사를 위한 사전 동의를 요청하세요.',
        '필요 시 추가 연락 방법(카카오 알림 등)을 제안하세요.'
      ],
      agentStress: 0.42,
      agentState: { text: '안정', badge: 'badge-success' },
      escalations: 0,
      alert: '콜 종료 준비. 상담 후 케어 메시지와 내부 리포트 생성을 진행하세요.',
      delay: 2800
    }
  ];

  let emotionChart;
  let riskTrendChart;
  let demoRunning = false;
  let callStartTime = null;
  let callTimerInterval = null;
  let audioInterval = null;
  let segmentTimeout = null;
  let waveformAnimationId = null;
  let currentScenarioIndex = 0;
  let targetAudioDb = 55;
  let currentAudioDb = 48;
  let riskHistory = [];
  let waveformPhase = 0;

  function generateCallId() {
    const prefix = ['A', 'B', 'C'][Math.floor(Math.random() * 3)];
    const number = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${number}`;
  }

  function setBadgeClass(el, badgeClass) {
    el.className = `badge ${badgeClass}`;
  }

  function resetBadge(el) {
    el.className = 'badge badge-neutral';
  }

  function updateCallTimer() {
    if (!callStartTime) return;
    const elapsedSec = Math.floor((Date.now() - callStartTime) / 1000);
    const minutes = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
    const seconds = (elapsedSec % 60).toString().padStart(2, '0');
    elements.callTimer.textContent = `${minutes}:${seconds}`;
  }

  function updateAudioMeter(db) {
    const clampedDb = Math.max(35, Math.min(90, db));
    const normalized = (clampedDb - 35) / (90 - 35);
    elements.audioFill.style.width = `${(normalized * 100).toFixed(1)}%`;

    elements.audioDb.textContent = `${Math.round(clampedDb)} dB`;
    resetBadge(elements.audioDb);
    if (clampedDb >= 75) {
      setBadgeClass(elements.audioDb, 'badge-danger');
    } else if (clampedDb >= 65) {
      setBadgeClass(elements.audioDb, 'badge-warning');
    }
  }

  function drawWaveform() {
    const canvas = elements.voiceCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();

    const amplitude = Math.max(18, Math.min(48, 12 + (currentAudioDb - 45)));
    const frequency = 0.015 + (currentAudioDb / 4000);

    for (let x = 0; x <= width; x++) {
      const progress = x / width;
      const base = Math.sin((x + waveformPhase) * frequency) * amplitude;
      const noise = (Math.random() - 0.5) * 8;
      const y = height / 2 + base + noise;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = 'rgba(125, 162, 255, 0.65)';
      ctx.lineWidth = 2;
    ctx.stroke();

    waveformPhase += 6 + targetAudioDb * 0.08;

    if (demoRunning) {
      waveformAnimationId = requestAnimationFrame(drawWaveform);
    }
  }

  function resizeWaveformCanvas() {
    const canvas = elements.voiceCanvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = canvas.getAttribute('height') || 140;
  }

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

  function updateEmotionChart(emotions) {
    const dataset = emotionChart.data.datasets[0];
    dataset.data = [
      Math.round(emotions.anger * 100),
      Math.round(emotions.frustration * 100),
      Math.round(emotions.sadness * 100),
      Math.round(emotions.neutral * 100),
      Math.round(emotions.joy * 100)
    ];
    emotionChart.update();

    const emotionEntries = Object.entries(emotions);
    emotionEntries.sort((a, b) => b[1] - a[1]);
    const [primary, score] = emotionEntries[0];
    const labelMap = {
      anger: '분노',
      frustration: '불만',
      sadness: '슬픔',
      neutral: '중립',
      joy: '긍정'
    };

    resetBadge(elements.primaryEmotion);
    let badge = 'badge-neutral';
    if (primary === 'anger' || primary === 'frustration') badge = 'badge-danger';
    else if (primary === 'sadness') badge = 'badge-warning';
    else if (primary === 'joy') badge = 'badge-success';
    setBadgeClass(elements.primaryEmotion, badge);
    elements.primaryEmotion.textContent = `${labelMap[primary]} ${Math.round(score * 100)}%`;
  }

  function updateRisk(risk) {
    const riskPercent = Math.round(risk * 100);
    elements.riskScore.textContent = `${riskPercent}%`;

    if (riskPercent >= 75) {
      elements.riskScore.style.color = '#ff8098';
    } else if (riskPercent >= 55) {
      elements.riskScore.style.color = '#ffd27f';
  } else {
      elements.riskScore.style.color = '#9ae6b4';
    }

    if (riskTrendChart) {
      const elapsedSec = callStartTime ? (Date.now() - callStartTime) / 1000 : 0;
      riskHistory.push({ time: elapsedSec, value: riskPercent });
      if (riskHistory.length > 12) riskHistory.shift();

      riskTrendChart.data.labels = riskHistory.map((entry) => `${Math.round(entry.time)}s`);
      riskTrendChart.data.datasets[0].data = riskHistory.map((entry) => entry.value);
      riskTrendChart.update();
    }
  }

  function updateSuggestions(suggestions) {
    elements.suggestionList.innerHTML = '';
    if (!suggestions || suggestions.length === 0) {
      const li = document.createElement('li');
      li.className = 'placeholder';
      li.textContent = '추천 전략이 없습니다.';
      elements.suggestionList.appendChild(li);
    return;
  }
  
    suggestions.forEach((suggestion, idx) => {
      const li = document.createElement('li');
      li.className = 'suggestion-item';
      li.innerHTML = `<strong>전략 ${idx + 1}</strong><span>${suggestion}</span>`;
      elements.suggestionList.appendChild(li);
    });
  }

  function updateKeywords(keywords) {
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
    setBadgeClass(elements.agentStateLabel, entry.agentState.badge);
    elements.agentStateLabel.textContent = entry.agentState.text;
    const stressPercent = Math.round(entry.agentStress * 100);
    elements.stressBar.style.width = `${stressPercent}%`;
    elements.stressValue.textContent = `${stressPercent} / 100`;
    elements.escalationCount.textContent = `${entry.escalations}건`;
    elements.agentHint.textContent = entry.alert;
  }

  function updateLatency(latency) {
    elements.latencyBadge.textContent = `Latency ${latency} ms`;
    resetBadge(elements.latencyBadge);
    if (latency > 400) setBadgeClass(elements.latencyBadge, 'badge-danger');
    else if (latency > 250) setBadgeClass(elements.latencyBadge, 'badge-warning');
    else setBadgeClass(elements.latencyBadge, 'badge-success');
  }

  function applyEntry(entry) {
    appendTranscript(entry);
    updateLatency(entry.latency);
    elements.wpmScore.textContent = `${entry.wpm} WPM`;
    elements.toneScore.textContent = entry.tone;
    updateEmotionChart(entry.emotions);
    updateRisk(entry.risk);
    updateSuggestions(entry.suggestions);
    updateKeywords(entry.keywords);
    updateAgentState(entry);
    targetAudioDb = entry.audioDb;
  }

  function playNextSegment() {
    if (!demoRunning) return;

    const entry = scenario[currentScenarioIndex];
    applyEntry(entry);
    currentScenarioIndex += 1;

    if (currentScenarioIndex < scenario.length) {
      segmentTimeout = setTimeout(playNextSegment, entry.delay || 4000);
    } else {
      segmentTimeout = setTimeout(() => finishDemo(), 3500);
    }
  }

  function startCallTimer() {
    callStartTime = Date.now();
    updateCallTimer();
    callTimerInterval = setInterval(updateCallTimer, 1000);
  }

  function startAudioLoop() {
    audioInterval = setInterval(() => {
      currentAudioDb += (targetAudioDb - currentAudioDb) * 0.2 + (Math.random() - 0.5) * 5;
      updateAudioMeter(currentAudioDb);
    }, 240);
    waveformAnimationId = requestAnimationFrame(drawWaveform);
  }

  function stopIntervals() {
    if (callTimerInterval) clearInterval(callTimerInterval);
    if (audioInterval) clearInterval(audioInterval);
    if (segmentTimeout) clearTimeout(segmentTimeout);
    if (waveformAnimationId) cancelAnimationFrame(waveformAnimationId);
    callTimerInterval = audioInterval = segmentTimeout = waveformAnimationId = null;
  }

  function resetTranscript() {
    elements.transcriptList.innerHTML = '<p class="placeholder">대화가 시작되면 여기에 텍스트가 표시됩니다.</p>';
  }

  function resetCharts() {
    emotionChart.data.datasets[0].data = [0, 0, 0, 0, 0];
    emotionChart.update();
    riskHistory = [];
    if (riskTrendChart) {
      riskTrendChart.data.labels = [];
      riskTrendChart.data.datasets[0].data = [];
      riskTrendChart.update();
    }
  }

  function resetUI() {
    elements.callState.textContent = '대기 중';
    elements.callTimer.textContent = '00:00';
    resetBadge(elements.primaryEmotion);
    elements.primaryEmotion.textContent = '대기 중';
    elements.riskScore.textContent = '--';
    elements.riskScore.style.color = '#e4e7ff';
    elements.wpmScore.textContent = '-- WPM';
    elements.toneScore.textContent = '--';
    resetBadge(elements.latencyBadge);
    elements.latencyBadge.textContent = 'Latency -- ms';
    resetBadge(elements.agentStateLabel);
    elements.agentStateLabel.textContent = '대기 중';
    elements.stressBar.style.width = '0%';
    elements.stressValue.textContent = '--';
    elements.escalationCount.textContent = '0건';
    elements.agentHint.textContent = '데모를 시작하면 보호 시나리오가 활성화됩니다.';
    elements.suggestionList.innerHTML = '<li class="placeholder">고객 감정이 인식되면 전략이 안내됩니다.</li>';
    elements.keywordList.innerHTML = '<span class="placeholder">아직 키워드가 없습니다.</span>';
    resetTranscript();
    resetCharts();
    targetAudioDb = 55;
    currentAudioDb = 48;
    updateAudioMeter(currentAudioDb);
  }

  function finishDemo() {
    if (!demoRunning) return;
    elements.callState.textContent = '콜 종료';
    demoRunning = false;
    stopIntervals();
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.agentHint.textContent = '콜이 종료되었습니다. 자동 리포트가 생성됩니다.';
    setBadgeClass(elements.agentStateLabel, 'badge-info');
    elements.agentStateLabel.textContent = '정리 중';
  }

  function startDemo() {
    if (demoRunning) return;
    resetUI();
    resizeWaveformCanvas();
    elements.callId.textContent = generateCallId();
    elements.callState.textContent = '통화 중';
    demoRunning = true;
    currentScenarioIndex = 0;
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
    startCallTimer();
    startAudioLoop();
    playNextSegment();
  }

  function stopDemo() {
    if (!demoRunning) return;
    demoRunning = false;
    stopIntervals();
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
    elements.callState.textContent = '중단됨';
    elements.agentHint.textContent = '데모가 중단되었습니다. 다시 시작하려면 ▶ 버튼을 눌러주세요.';
  }

function initCharts() {
    const emotionCtx = document.getElementById('emotion-chart').getContext('2d');
    emotionChart = new Chart(emotionCtx, {
      type: 'doughnut',
    data: {
        labels: ['분노', '불만', '슬픔', '중립', '긍정'],
        datasets: [
          {
            data: [0, 0, 0, 0, 0],
            backgroundColor: [
              'rgba(255, 99, 132, 0.75)',
              'rgba(255, 159, 64, 0.75)',
              'rgba(155, 129, 255, 0.75)',
              'rgba(99, 179, 237, 0.75)',
              'rgba(129, 222, 164, 0.8)'
            ],
            borderWidth: 0,
            hoverOffset: 8
          }
        ]
      },
      options: {
      plugins: {
        legend: {
            position: 'bottom',
            labels: {
              usePointStyle: true,
              color: '#d0d4ff'
            }
          }
        },
        cutout: '58%'
      }
    });

    const riskCanvas = document.getElementById('risk-trend-chart');
    if (riskCanvas) {
      const riskCtx = riskCanvas.getContext('2d');
      riskTrendChart = new Chart(riskCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              data: [],
              tension: 0.32,
              borderColor: '#ff7b94',
              backgroundColor: 'rgba(255, 123, 148, 0.18)',
              fill: true,
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: {
              suggestedMin: 0,
              suggestedMax: 100,
              ticks: {
                color: '#94a3ff',
                callback: (value) => `${value}%`
              },
              grid: {
                color: 'rgba(130, 140, 210, 0.15)'
              }
            },
            x: {
              ticks: { color: '#94a3ff' },
              grid: { color: 'rgba(130, 140, 210, 0.1)' }
            }
          }
        }
      });
    } else {
      riskTrendChart = null;
    }
}

  function init() {
    resizeWaveformCanvas();
  initCharts();
    updateAudioMeter(currentAudioDb);
    resetUI();
    elements.startBtn.addEventListener('click', startDemo);
    elements.stopBtn.addEventListener('click', stopDemo);
    window.addEventListener('resize', () => {
      resizeWaveformCanvas();
      if (demoRunning && !waveformAnimationId) {
        waveformAnimationId = requestAnimationFrame(drawWaveform);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
