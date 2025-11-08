# CallCenter AI Demo

실시간 음성 인식 및 AI 기반 상담원 어시스턴트 시스템

## ✨ 주요 기능

- 🎤 **실시간 STT**: Naver Clova STT API 기반 스트리밍 음성 인식 (100ms 간격)
- 🧠 **경량화된 RAG**: Query Rewrite + Vector Search로 최적 매뉴얼 추천
- 💬 **고객 의도 분석**: 실시간 키워드 추출 및 15초 후 LAG 분석
- 📊 **AI 자동 요약**: 통화 종료 후 전체 대화 내용 분석 및 요약
- 🎨 **원격지원 UI**: 스마트키 오류 시 차량 원격 제어 인터페이스

## 🏗️ 아키텍처

```
[마이크] → [VAD] → [STT 스트리밍] → [RAG 분석] → [WebSocket] → [실시간 UI]
                                                      ↓
[통화 종료] → [AI 요약] → [debriefing.html]
```

## 🚀 빠른 시작

### 1. 의존성 설치

```bash
pip install google-generativeai chromadb sounddevice webrtcvad pydub numpy websockets aiohttp aiohttp-cors requests
```

### 2. API 키 설정

`config.json` 파일에 API 키를 입력하세요:

```json
{
  "gemini_api_key": "your-gemini-api-key",
  "naver_clova_stt": {
    "client_id": "your-client-id",
    "client_secret": "your-client-secret"
  }
}
```

### 3. 실행

**서버 시작:**
```bash
python server.py
```

**프론트엔드 실행:**
```bash
# 방법 1: 브라우저에서 직접 열기
open index.html

# 방법 2: 로컬 서버 사용
python -m http.server 8000
# 브라우저에서 http://localhost:8000 접속
```

### 4. 데모 사용

1. "▶ 데모 시작" 버튼 클릭
2. 마이크에 말하기 (200ms 이상 발화)
3. 실시간 STT 및 매뉴얼 추천 확인
4. "■ 정지" 버튼으로 통화 종료 및 요약 확인

## 📁 프로젝트 구조

```
├── index.html          # 실시간 상담 대시보드
├── debriefing.html     # 통화 종료 후처리 페이지
├── manual.html         # 매뉴얼 모음
├── manual-detail.html  # 매뉴얼 상세 (원격지원 UI 포함)
├── app.js              # 프론트엔드 로직
├── server.py           # 백엔드 서버 (STT, RAG, AI 분석)
├── styles.css          # UI 스타일
├── config.json         # API 키 설정
└── manuals.json        # 매뉴얼 데이터베이스
```

## 🔧 기술 스택

**프론트엔드**
- HTML5, JavaScript (ES6+), WebSocket API

**백엔드**
- Python 3.x, asyncio, websockets
- sounddevice, webrtcvad (VAD)
- pydub (오디오 처리)

**AI/ML**
- **Naver Clova STT**: 실시간 스트리밍 음성 인식
- **Google Gemini 2.5 Flash**: 경량화된 LLM (Query Rewrite, 요약)
- **ChromaDB**: 벡터 데이터베이스 (RAG)
- **Google Embedding API**: 텍스트 임베딩

## ⚙️ 핵심 설정

### VAD (Voice Activity Detection)
- **침묵 타임아웃**: 300ms (국제 표준)
- **최소 발화 길이**: 200ms
- **스트리밍 간격**: 100ms

### RAG 파이프라인
- **Task B**: Query Rewrite → Vector Search (1개 매뉴얼)
- **Generator 제거**: 지연 시간 최소화
- **의미 필터**: 대화 길이 < 2일 때 솔루션 미표시

### Task 구성
- **Task B**: 실시간 RAG 분석 (STT Final 후)
- **Task C**: 통화 종료 후 AI 자동 요약
- **LAG**: 15초 후 고객 의도 키워드 생성

## 📊 데이터 흐름

1. **음성 입력** → VAD 감지 → STT 스트리밍 시작
2. **STT Partial/Final** → WebSocket 전송 → UI 업데이트
3. **STT Final** → Task B (RAG) → 매뉴얼 추천
4. **15초 경과** → LAG → 고객 의도 키워드 업데이트
5. **통화 종료** → Task C → AI 요약 → debriefing.html

## 🎯 주요 기능 상세

### 실시간 STT
- 100ms 간격 스트리밍으로 즉각적인 반응성
- Partial 결과를 타이핑 효과로 표시
- 300ms 침묵 감지 시 Final 결과 확정

### 경량화된 RAG
- 단일 LLM 호출로 검색어 생성
- ChromaDB 벡터 검색으로 최적 매뉴얼 1개 추천
- Generator 단계 제거로 지연 시간 최소화

### 원격지원
- 스마트키 오류 매뉴얼 표시 시 자동 활성화
- 차량 원격 제어 (문 열기/잠그기, 상태 확인)
- 실시간 제어 결과 표시

## 📝 라이선스

이 프로젝트는 데모 목적으로 제작되었습니다.

---

**버전**: v0.2.0  
**최종 업데이트**: 2025.11.09
