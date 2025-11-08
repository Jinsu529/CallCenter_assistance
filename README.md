# CallCenter AI Demo

실시간 음성 감정 분석 및 상담원 코칭 시스템

## 📋 프로젝트 개요

이 프로젝트는 콜센터 상담원을 위한 실시간 AI 어시스턴트 시스템입니다. 마이크 입력을 통해 실시간으로 음성을 인식하고, 고객의 감정을 분석하며, 상담원에게 최적의 대응 전략을 제안합니다.

## 🏗️ 시스템 아키텍처

```
[마이크 입력]
    ↓
[VAD (음성 감지)] → server.py
    ↓
[Gemini STT] → 텍스트 변환
    ↓
[감정 분석] → Gemini API
    ↓
[RAG 코칭] → ChromaDB + Gemini
    ↓
[WebSocket] → app.js
    ↓
[UI 업데이트] → 실시간 대시보드
```

## 📁 파일 구조

```
callcenter new/
├── index.html          # 메인 HTML 파일 (UI 구조)
├── app.js              # 프론트엔드 JavaScript (WebSocket 클라이언트)
├── server.py           # 백엔드 Python 서버 (WebSocket 서버, STT, AI 분석)
├── styles.css          # CSS 스타일시트
├── api_key.txt         # Google Gemini API 키
└── GCP_key.json        # Google Cloud Platform 서비스 계정 키
```

## 📄 파일별 상세 설명

### 1. index.html

**역할**: 메인 HTML 구조 및 UI 레이아웃

**주요 구성 요소**:
- **헤더 섹션**
  - 콜 ID, 경과 시간, 현재 상태 표시
  - AI 비서 말풍선 (감정 분석 결과 실시간 표시)
  
- **좌측 컬럼**
  - 데모 제어 패널 (시작/정지 버튼)
  - 실시간 음성 신호 시각화 (waveform, dB 미터)
  - STT 전사 목록 (실시간 대화 내용)
  
- **우측 컬럼**
  - 고객 감정 분석 (도넛 차트, 위험도, 톤, 발화 속도)
  - 추천 대응 전략 (AI Copilot 제안)
  - 핵심 키워드 추출
  - 상담원 보호 모니터링 (스트레스 지수, 악성 통화 카운트)
  
- **데이터 흐름 설명 섹션**
  - 실시간 STT 스트리밍 프로세스
  - Gemini 심층 분석 프로세스

**외부 라이브러리**:
- Chart.js 4.4.0 (감정 차트 시각화)

---

### 2. app.js

**역할**: 프론트엔드 JavaScript 로직 및 WebSocket 클라이언트

**주요 기능**:

1. **WebSocket 통신**
   - 서버 연결: `ws://localhost:8765` (⚠️ 포트 불일치 주의)
   - 메시지 수신: `stt`, `analysis` 타입 처리
   - 연결 상태 관리

2. **실시간 오디오 처리**
   - 마이크 입력 캡처 (Web Audio API)
   - Waveform 시각화 (Canvas)
   - dB 레벨 계산 및 표시
   - AudioContext, AnalyserNode 활용

3. **UI 업데이트 함수**
   - `applySTT()`: STT 결과 적용 (전사 추가, 지연시간 표시)
   - `applyAnalysis()`: 분석 결과 적용 (감정, 추천, 키워드, 상담원 상태)
   - `updateEmotionChart()`: Chart.js 도넛 차트 업데이트
   - `updateRisk()`: 위험도 점수 및 색상 업데이트
   - `updateSuggestions()`: 추천 전략 목록 업데이트
   - `updateKeywords()`: 키워드 칩 표시
   - `updateAgentState()`: 상담원 상태 업데이트

4. **타이머 및 상태 관리**
   - 통화 타이머 (경과 시간 표시)
   - 데모 시작/정지 제어
   - UI 초기화 및 리셋

**주요 변수**:
- `ws`: WebSocket 연결 객체
- `audioContext`, `analyser`: 오디오 분석용
- `emotionChart`: Chart.js 차트 인스턴스
- `demoRunning`: 데모 실행 상태 플래그

---

### 3. server.py

**역할**: Python 백엔드 서버 (WebSocket 서버, STT, AI 분석)

**주요 기능**:

1. **WebSocket 서버**
   - 포트: `8766` (⚠️ app.js와 포트 불일치)
   - 클라이언트 연결 관리
   - 메시지 브로드캐스팅

2. **VAD (Voice Activity Detection)**
   - `webrtcvad` 라이브러리 사용
   - 샘플레이트: 16kHz
   - 프레임 크기: 30ms
   - 공격성 레벨: 3 (가장 높음)
   - 침묵 타임아웃: 800ms
   - 최소 음성 길이: 500ms

3. **STT (Speech-to-Text)**
   - Google Gemini API 사용 (`gemini-2.5-flash`)
   - 오디오 → WAV 변환 (pydub)
   - 텍스트 추출 및 화자 태깅

4. **감정 분석**
   - Gemini API 호출
   - 5가지 감정 점수 반환:
     - `anger` (분노)
     - `frustration` (불만)
     - `sadness` (슬픔)
     - `neutral` (중립)
     - `joy` (긍정)
   - JSON 형식 응답

5. **RAG 기반 코칭**
   - ChromaDB 벡터 데이터베이스 사용
   - CS 매뉴얼 문서 임베딩 저장
   - 쿼리 기반 유사 문서 검색
   - Gemini API로 코칭 제안 생성
   - 추천 전략 및 키워드 추출

6. **CS 매뉴얼 (RAG DB)**
   - 기본 응대 원칙 (첫인사, 경청, 쿠션 언어, 마무리)
   - 불만 고객 응대 5단계
   - 상담원 보호 가이드라인

**주요 함수**:
- `setup_vector_db()`: ChromaDB 벡터 DB 구축
- `recognize_gemini_stt()`: STT 수행
- `get_emotion_from_text()`: 감정 분석
- `get_agent_coaching_RAG()`: RAG 기반 코칭
- `process_speech_segment()`: 음성 구간 처리 (STT → 감정 → 코칭)
- `vad_loop()`: VAD 메인 루프

**데이터 흐름**:
1. 마이크 입력 → `audio_callback()` → `audio_queue`
2. VAD 루프 → 음성 구간 감지 → `process_speech_segment()`
3. STT → 감정 분석 → RAG 코칭
4. 결과를 WebSocket으로 프론트엔드 전송

**설정 파일**:
- API 키: `api_key.txt`에서 로드
- FFmpeg 경로: `ffmpeg-8.0/bin/ffmpeg.exe` (로컬 경로)

---

### 4. styles.css

**역할**: 전체 UI 스타일링

**디자인 특징**:
- **색상 테마**: 따뜻한 오렌지/베이지 톤
  - 배경: 그라데이션 (노란색 → 오렌지)
  - 카드: 반투명 베이지 배경
  - 강조색: 오렌지, 빨강 (위험), 초록 (안정)
  
- **레이아웃**:
  - 2컬럼 그리드 (대시보드)
  - 반응형 디자인 (1140px 이하에서 1컬럼)
  - 카드 기반 UI
  
- **컴포넌트 스타일**:
  - 배지 (badge): neutral, success, warning, danger
  - 버튼: 그라데이션 배경, 호버 효과
  - 차트: 도넛 차트 스타일
  - 전사 목록: 고객/상담원 구분 색상
  - 진행 바: 그라데이션 필

---

### 5. api_key.txt

**역할**: Google Gemini API 키 저장

**내용**: 
- 단일 라인에 API 키 문자열 저장
- `server.py`에서 읽어서 `genai.configure()`에 사용

**보안 주의사항**:
- ⚠️ 이 파일은 `.gitignore`에 추가해야 함
- 공개 저장소에 업로드하지 말 것

---

### 6. GCP_key.json

**역할**: Google Cloud Platform 서비스 계정 키

**내용**:
- 프로젝트 ID: `loyal-operation-477604-s8`
- 서비스 계정 이메일: `gcp-ku-ang@loyal-operation-477604-s8.iam.gserviceaccount.com`
- Private Key (암호화된 형식)

**현재 사용 여부**:
- ⚠️ 현재 코드에서는 직접 사용하지 않음
- Gemini API는 `api_key.txt`의 API 키 사용
- 향후 GCP 서비스 연동 시 필요할 수 있음

**보안 주의사항**:
- ⚠️ 절대 공개 저장소에 업로드하지 말 것
- `.gitignore`에 추가 필수

---

## 🚀 실행 방법

### 1. 의존성 설치

```bash
# Python 패키지
pip install google-generativeai chromadb sounddevice webrtcvad pydub numpy websockets asyncio

# FFmpeg 설치 (로컬 경로 또는 환경 변수 설정)
# Windows: ffmpeg-8.0/bin/ffmpeg.exe 경로 확인
```

### 2. API 키 설정

1. `api_key.txt` 파일에 Google Gemini API 키 입력
2. 파일이 비어있지 않은지 확인

### 3. 서버 실행

```bash
python server.py
```

서버가 시작되면:
- WebSocket 서버: `ws://localhost:8766`
- VAD 루프 시작
- RAG DB 구축

### 4. 프론트엔드 실행

1. `index.html`을 웹 브라우저에서 열기
2. 또는 로컬 웹 서버 사용:
   ```bash
   python -m http.server 8000
   # 브라우저에서 http://localhost:8000 접속
   ```

### 5. 데모 시작

1. 브라우저에서 "▶ 데모 시작" 버튼 클릭
2. 마이크 권한 허용
3. 마이크에 말하기
4. 실시간으로 STT, 감정 분석, 코칭 제안 확인

---

## ⚠️ 알려진 이슈

### 포트 불일치

- `app.js`: WebSocket URL이 `ws://localhost:8765`
- `server.py`: 실제 서버 포트는 `8766`

**해결 방법**:
- `app.js`의 `WEBSOCKET_URL`을 `"ws://localhost:8766"`으로 수정
- 또는 `server.py`의 `WEBSOCKET_PORT`를 `8765`로 변경

---

## 🔧 기술 스택

### 프론트엔드
- **HTML5**: 구조
- **JavaScript (ES6+)**: 로직
- **Chart.js 4.4.0**: 차트 시각화
- **WebSocket API**: 실시간 통신
- **Web Audio API**: 오디오 처리

### 백엔드
- **Python 3.x**: 서버 로직
- **asyncio**: 비동기 처리
- **websockets**: WebSocket 서버
- **sounddevice**: 마이크 입력
- **webrtcvad**: 음성 활동 감지 (VAD)
- **pydub**: 오디오 변환
- **numpy**: 수치 연산
- **threading**: 스트리밍 처리

### AI/ML
- **Naver Clova STT API**: 
  - 실시간 스트리밍 STT (200ms 간격)
  - Partial/Final 결과 반환
- **Google Gemini API**: 
  - 감정 분석
  - 텍스트 생성 (코칭)
- **ChromaDB**: 벡터 데이터베이스 (RAG)

---

## 📊 데이터 흐름 상세

### 1부: 실시간 스트리밍 STT

1. **마이크 입력** (`server.py`)
   - `sounddevice`가 30ms 단위로 오디오 프레임 캡처
   - `audio_queue`로 전송

2. **VAD 처리 (음성 시작 감지)**
   - `webrtcvad`로 음성/침묵 구분
   - **음성 시작 감지 시 즉시 STT 스트리밍 세션 시작**
   - 오디오를 200ms 단위로 스트리밍 세션에 전송

3. **실시간 STT 스트리밍**
   - `StreamingSTTClient`가 200ms 간격으로 누적 오디오를 STT API에 전송
   - **Partial 결과 (중간 텍스트)**: 실시간으로 UI에 타이핑 효과로 표시
   - **Final 결과 (최종 텍스트)**: 800ms 침묵 감지 시 최종 결과 확정

4. **WebSocket 전송**
   - `{"type": "stt_partial", "text": "..."}` - 중간 결과 (타이핑 효과)
   - `{"type": "stt_final", "text": "...", "speakerId": 1, "latency": 123}` - 최종 결과
   - 프론트엔드에서 실시간으로 말풍선 업데이트

### 2부: Gemini 심층 분석 (Final 결과 후)

1. **감정 분석** (Task A)
   - STT Final 텍스트 → Gemini API
   - 5가지 감정 점수 반환 (anger, frustration, sadness, neutral, joy)

2. **RAG 코칭** (Task B)
   - 대화 맥락 + 감정 → ChromaDB 검색
   - 관련 CS 매뉴얼 문서 검색
   - Gemini API로 코칭 제안 생성

3. **병렬 처리 및 결과 통합**
   - Task A와 Task B를 병렬로 실행
   - 감정, 추천, 키워드, 위험도, 상담원 상태 통합
   - `{"type": "analysis_result", "emotion": {...}, "rag": {...}}` 메시지 전송
   - 프론트엔드 대시보드 업데이트

---

## 🎯 주요 기능

### 실시간 스트리밍 음성 인식
- 마이크 입력 실시간 캡처 (30ms 프레임)
- VAD 기반 음성 시작 즉시 감지
- Naver Clova STT 스트리밍으로 실시간 텍스트 변환
- Partial 결과 (중간 텍스트)를 타이핑 효과로 즉시 표시
- Final 결과 (최종 텍스트)는 침묵 감지 시 확정

### 감정 분석
- 5가지 감정 분류 (분노, 불만, 슬픔, 중립, 긍정)
- 위험도 점수 계산
- 음성 톤 및 발화 속도 분석

### AI 코칭
- RAG 기반 CS 매뉴얼 검색
- 상황별 추천 전략 생성
- 핵심 키워드 추출

### 상담원 보호
- 스트레스 지수 모니터링
- 악성 통화 카운트
- 상태 알림 및 경고

### 실시간 시각화
- Waveform 그래프
- 감정 도넛 차트
- dB 레벨 미터
- 진행 바 및 배지

---

## 📝 라이선스

이 프로젝트는 데모 목적으로 제작되었습니다.

---

## 👥 기여

프로젝트 개선 제안 및 버그 리포트는 언제든 환영합니다.

---

**버전**: v0.1.0  
**최종 업데이트**: 2024

