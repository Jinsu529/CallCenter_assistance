import os
import queue
import time
import numpy as np
import sounddevice as sd
import webrtcvad
from concurrent.futures import ThreadPoolExecutor
import io
import json
import asyncio
import websockets
import threading
from pathlib import Path
import requests
import base64
import hmac
import hashlib
from datetime import datetime

# Google API
import google.generativeai as genai

# RAG DB
import chromadb

# 오디오 변환
from pydub import AudioSegment

# HTTP 서버 (요약 요청용)
try:
    from aiohttp import web
    import aiohttp_cors
    HTTP_SERVER_AVAILABLE = True
except ImportError:
    HTTP_SERVER_AVAILABLE = False
    print("⚠️ aiohttp가 설치되지 않았습니다. HTTP 서버 기능이 비활성화됩니다.")

# --- 1. 설정 및 상수 ---
GEMINI_MODEL_NAME = "gemini-2.5-flash"
EMBEDDING_MODEL_NAME = "models/embedding-001"
SAMPLE_RATE = 16000
VAD_FRAME_MS = 30
VAD_FRAME_SIZE = int(SAMPLE_RATE * VAD_FRAME_MS / 1000)
VAD_AGGRESSIVENESS = 3
VAD_SILENCE_TIMEOUT_MS = 800
VAD_MIN_SPEECH_DURATION_MS = 500
VAD_FRAMES_PER_TIMEOUT = VAD_SILENCE_TIMEOUT_MS // VAD_FRAME_MS
VAD_MIN_SPEECH_FRAMES = VAD_MIN_SPEECH_DURATION_MS // VAD_FRAME_MS

WEBSOCKET_PORT = 8766
CONFIG_FILENAME = 'config.json'  # API 키 통합 관리 파일
STYLE_GUIDE_FILENAME = 'ai_style_guide_prompt.txt'  # AI 스타일 가이드 파일
SCRIPT_DIR = Path(__file__).resolve().parent
FFMPEG_PATH = SCRIPT_DIR / 'ffmpeg-8.0' / 'bin' / 'ffmpeg.exe'
CONFIG_PATH = SCRIPT_DIR / CONFIG_FILENAME
STYLE_GUIDE_PATH = SCRIPT_DIR / STYLE_GUIDE_FILENAME

if FFMPEG_PATH.exists():
    AudioSegment.converter = str(FFMPEG_PATH)
    AudioSegment.ffmpeg = str(FFMPEG_PATH)
    AudioSegment.ffprobe = str(FFMPEG_PATH.parent / 'ffprobe.exe')
elif os.getenv('FFMPEG_BINARY'):
    AudioSegment.converter = os.getenv('FFMPEG_BINARY')

# --- 2. 전역 변수 ---
gemini_model = None
rag_collection = None
manual_collection = None  # 매뉴얼 벡터 DB
manuals_data = None  # 매뉴얼 JSON 데이터
style_guide_prompt = None  # AI 스타일 가이드 프롬프트
# API 키 (config.json에서 로드)
naver_stt_client_id = None
naver_stt_client_secret = None
GOOGLE_API_KEY = None  # Gemini API 키 (전역 변수로 추가)
vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
audio_queue = queue.Queue()
executor = ThreadPoolExecutor(max_workers=5)  # 병렬 처리용 워커 증가
conversation_history = []  # 전체 대화 로그 (리스트 형태: [{"speakerId": 1, "text": "..."}, ...])
CONNECTED_CLIENTS = set()
main_asyncio_loop = None

# 스트리밍 STT 관련
STREAMING_CHUNK_MS = 200  # 스트리밍 전송 간격 (ms)
STREAMING_CHUNK_SIZE = int(SAMPLE_RATE * STREAMING_CHUNK_MS / 1000)  # 샘플 수
active_stt_stream = None  # 현재 활성화된 STT 스트리밍 세션
streaming_audio_buffer = queue.Queue()  # 스트리밍용 오디오 버퍼

# --- 3. 설정 파일 로드 ---
def load_config():
    """config.json에서 API 키 로드"""
    global naver_stt_client_id, naver_stt_client_secret
    try:
        if not CONFIG_PATH.exists():
            print(f"🚨 설정 파일({CONFIG_PATH})을 찾을 수 없습니다.")
            return None
        
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            config = json.load(f)
        
        naver_stt_client_id = config.get('naver_clova_stt', {}).get('client_id')
        naver_stt_client_secret = config.get('naver_clova_stt', {}).get('client_secret')
        gemini_api_key = config.get('gemini_api_key')
        
        if not gemini_api_key:
            print(f"🚨 config.json에 gemini_api_key가 없습니다.")
            print(f"💡 config.json 파일에 다음 형식으로 추가하세요:")
            print(f'   {{"gemini_api_key": "YOUR_API_KEY_HERE"}}')
            return None
        
        # API 키 앞뒤 공백 제거
        gemini_api_key = gemini_api_key.strip()
        
        if len(gemini_api_key) == 0:
            print(f"🚨 config.json의 gemini_api_key가 비어있습니다.")
            return None
        
        if not naver_stt_client_id or not naver_stt_client_secret:
            print(f"⚠️ config.json에 Naver CLOVA STT API 키가 없습니다.")
        
        print(f"✅ 설정 파일 로드 완료")
        return gemini_api_key
    except json.JSONDecodeError as e:
        print(f"🚨 설정 파일 JSON 파싱 실패: {e}")
        print(f"💡 config.json 파일의 JSON 형식이 올바른지 확인하세요.")
        return None
    except Exception as e:
        print(f"🚨 설정 파일 로드 실패: {e}")
        import traceback
        traceback.print_exc()
        return None

def load_style_guide():
    """ai_style_guide_prompt.txt 파일 로드"""
    global style_guide_prompt
    try:
        if not STYLE_GUIDE_PATH.exists():
            print(f"⚠️ 스타일 가이드 파일({STYLE_GUIDE_PATH})을 찾을 수 없습니다.")
            return None
        
        with open(STYLE_GUIDE_PATH, 'r', encoding='utf-8') as f:
            style_guide_prompt = f.read()
        
        print(f"✅ 스타일 가이드 로드 완료")
        return style_guide_prompt
    except Exception as e:
        print(f"🚨 스타일 가이드 로드 실패: {e}")
        return None

def load_manuals():
    """manuals.json 데이터 로드"""
    global manuals_data
    manuals_json_path = SCRIPT_DIR / 'manuals.json'
    try:
        if manuals_json_path.exists():
            with open(manuals_json_path, 'r', encoding='utf-8') as f:
                manuals_data = json.load(f)
            # manuals.json 구조 변환 (카테고리별 중첩 → 리스트)
            manuals_list = []
            for category, manuals in manuals_data.items():
                for manual_id, manual in manuals.items():
                    manual['id'] = manual_id
                    manual['category'] = category
                    manuals_list.append(manual)
            manuals_data = {'manuals': manuals_list}
            print(f"✅ 매뉴얼 데이터 로드 완료: {len(manuals_data.get('manuals', []))}개")
            return manuals_data
        else:
            print(f"⚠️ 매뉴얼 파일({manuals_json_path})을 찾을 수 없습니다.")
            return None
    except Exception as e:
        print(f"🚨 매뉴얼 로드 실패: {e}")
        return None

# --- 4. RAG DB 구축 ---
def setup_vector_db(genai_module, embedding_model_name):
    GUIDELINE_DOCUMENTS = [
        {"id": "doc1", "text": "## 1. 기본 응대 원칙: 첫인사\n* 신속하게(전화벨 3회 이내) 응대. \"감사합니다. [회사명] [상담원 이름]입니다.\""},
        {"id": "doc2", "text": "## 1. 기본 응대 원칙: 경청\n* 고객의 말을 끊지 않고, 핵심 용어를 복창하며(예: \"아, OO 상품 배송 건이시군요.\"), 적절한 맞장구(예: \"네, 네\")로 듣고 있음을 알림."},
        {"id": "doc3", "text": "## 1. 기본 응대 원칙: 쿠션 언어 (Cushion Language)\n* 고객에게 요청, 질문, 거절 시 반드시 사용.\n* (요청) \"실례지만, 성함을 말씀해 주시겠습니까?\"\n* (거절) \"죄송합니다만, 해당 부분은 처리가 어렵습니다.\"\n* (시간 소요) \"번거로우시겠지만, 잠시만 기다려 주시겠습니까?\""},
        {"id": "doc4", "text": "## 1. 기본 응대 원칙: 마무리 인사\n* 추가 문의 사항 확인. \"더 궁금하신 점은 없으십니까?\", \"소중한 시간을 내어주셔서 감사합니다.\""},
        {"id": "doc5", "text": "## 2. 불만 고객 응대 5단계: 1. 경청 및 공감 (Listen & Empathize)\n* 고객의 감정을 충분히 표현하도록 끝까지 듣기.\n* 적극적 공감 표현 (예: \"많이 속상하셨겠습니다.\", \"저라도 정말 답답했을 것 같습니다.\")\n* (금지!) \"진정하세요\", \"화내지 마세요\", \"그건 저희 정책이라서요.\""},
        {"id": "doc6", "text": "## 2. 불만 고객 응대 5단계: 2. 즉각적 사과 (Immediate Apology)\n* 원인 규명 전, 고객이 겪은 '불편함' 자체에 대해 즉시 사과.\n* (예: \"배송이 늦어져 이용에 불편을 드린 점 진심으로 사과드립니다.\")"},
        {"id": "doc7", "text": "## 2. 불만 고객 응대 5단계: 3. 원인 파악 및 사실 확인 (Identify & Confirm)\n* 문제 해결을 위한 구체적 정보 질문 (예: \"정확한 확인을 위해 주문번호를 말씀해 주시겠습니까?\")\n* 고객이 말한 사실을 재확인."},
        {"id": "doc8", "text": "## 2. 불만 고객 응대 5단계: 4. 신속한 해결책/대안 제시 (Propose Solution)\n* 즉시 해결 가능 시 또는 시간 소요 시, 명확히 안내.\n* 요구 수용 불가 시: 거절(No)이 아닌 **대안(Alternative)** 제시."},
        {"id": "doc9", "text": "## 2. 불만 고객 응대 5단계: 5. 확인 및 감사 (Confirm & Thank)\n* 제시한 해결책에 고객이 동의했는지 확인하고 감사 표현."},
        {"id": "doc10", "text": "## 3. 특이 상황별 응대 (상담원 보호)\n* **폭언/욕설/성희롱 시:**\n* 1차 경고: \"고객님, 욕설을 하시면 상담을 계속하기 어렵습니다.\"\n* 2차 경고: \"반복적으로 욕설을 하실 경우, 관련 법령에 따라 통화가 강제 종료될 수 있습니다.\"\n* 종료: \"경고에도 불구하고 폭언이 계속되어 상담을 종료하겠습니다.\""}
    ]
    client = chromadb.EphemeralClient()
    collection = client.get_or_create_collection(name="cs_guidelines")
    all_texts = [doc["text"] for doc in GUIDELINE_DOCUMENTS]
    all_ids = [doc["id"] for doc in GUIDELINE_DOCUMENTS]
    response = genai_module.embed_content(
        model=embedding_model_name,
        content=all_texts,
        task_type="RETRIEVAL_DOCUMENT"
    )
    collection.add(
        embeddings=response['embedding'],
        documents=all_texts,
        ids=all_ids
    )
    print(f"✅ Vector DB 구축 완료! (총 {collection.count()}개 문서 저장)")
    return collection

# --- 4. WebSocket 핸들러 (변경 없음) ---
async def register_client(websocket):
    print(f"[WebSocket] 클라이언트 연결: {websocket.remote_address}")
    CONNECTED_CLIENTS.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        print(f"[WebSocket] 클라이언트 연결 종료: {websocket.remote_address}")
        CONNECTED_CLIENTS.remove(websocket)

async def broadcast_message(message_json):
    if CONNECTED_CLIENTS:
        message_str = json.dumps(message_json, ensure_ascii=False)
        await asyncio.gather(
            *[client.send(message_str) for client in CONNECTED_CLIENTS]
        )

def send_message_to_loop(message_json):
    if main_asyncio_loop:
        asyncio.run_coroutine_threadsafe(
            broadcast_message(message_json), 
            main_asyncio_loop
        )

# --- 5. Naver CLOVA STT API (기존 REST API - 호환성 유지) ---
def recognize_speech_from_data(client_id, client_secret, audio_data, lang="Kor"):
    """(API 1) 네이버 CLOVA STT API를 호출하여 오디오 바이트를 텍스트로 변환합니다."""
    # Naver CLOVA Speech Recognition API 엔드포인트
    # 참고: https://guide.ncloud-docs.com/docs/csr-application
    url = f"https://naveropenapi.apigw.ntruss.com/recog/v1/stt?lang={lang}"
    
    headers = {
        "X-NCP-APIGW-API-KEY-ID": client_id,
        "X-NCP-APIGW-API-KEY": client_secret,
        "Content-Type": "application/octet-stream"
    }
    
    try:
        response = requests.post(url, headers=headers, data=audio_data, timeout=10)
        
        if response.status_code == 200:
            try:
                result = response.json()
                # 응답 형식: {"text": "인식된 텍스트"}
                text = result.get("text", "")
                if text:
                    return text.strip()
                else:
                    print(f"[STT Warning] 빈 텍스트 반환. 응답: {result}")
                    return ""
            except json.JSONDecodeError as e:
                print(f"[STT Error] JSON 파싱 실패: {response.text}")
                return ""
        else:
            print(f"[STT Error] HTTP {response.status_code}: {response.text}")
            return ""
    except requests.exceptions.RequestException as e:
        print(f"[STT Error] 요청 실패: {e}")
        return ""

def recognize_naver_stt(audio_data_bytes):
    """Naver CLOVA STT API를 사용하여 음성을 텍스트로 변환 (기존 방식 - 호환성 유지)"""
    global naver_stt_client_id, naver_stt_client_secret
    
    if not naver_stt_client_id or not naver_stt_client_secret:
        print("[Naver CLOVA STT] API 키가 설정되지 않았습니다.")
        return ""
    
    try:
        # 오디오를 WAV 형식으로 변환 (16kHz, 16bit, Mono)
        # Naver CLOVA STT API 요구사항에 맞춤
        audio = AudioSegment(
            data=audio_data_bytes, 
            sample_width=2,  # 16bit
            frame_rate=SAMPLE_RATE,  # 16kHz
            channels=1  # Mono
        )
        
        # WAV 형식으로 내보내기
        # Naver CLOVA STT API는 16kHz, 16bit, Mono WAV 형식을 요구
        wav_io = io.BytesIO()
        audio.export(wav_io, format="wav")
        wav_data = wav_io.getvalue()
        
        # Naver CLOVA STT API 호출
        text = recognize_speech_from_data(naver_stt_client_id, naver_stt_client_secret, wav_data, lang="Kor")
        return text.strip() if text else ""
    except Exception as e:
        print(f"[Naver CLOVA STT Error] {e}")
        import traceback
        traceback.print_exc()
        return ""

# --- 5-1. Naver CLOVA STT 스트리밍 클라이언트 ---
class StreamingSTTClient:
    """Naver Clova STT 스트리밍 클라이언트 (시뮬레이션 방식)
    
    참고: Naver Clova STT의 공식 스트리밍 API가 명확하지 않으므로,
    짧은 간격으로 REST API를 호출하여 partial/final 결과를 시뮬레이션합니다.
    """
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self.audio_buffer = []  # 누적 오디오 버퍼
        self.is_active = False
        self.last_partial_text = ""
        self.last_partial_time = 0
        self.streaming_thread = None
        self.stop_event = threading.Event()
        
    def start_streaming(self):
        """스트리밍 세션 시작"""
        if self.is_active:
            return
        
        self.is_active = True
        self.audio_buffer = []
        self.last_partial_text = ""
        self.last_partial_time = time.time()
        self.stop_event.clear()
        
        # 스트리밍 처리 스레드 시작
        self.streaming_thread = threading.Thread(target=self._streaming_loop, daemon=True)
        self.streaming_thread.start()
        print("[STT Streaming] 스트리밍 세션 시작")
        
    def stop_streaming(self):
        """스트리밍 세션 종료"""
        if not self.is_active:
            return
        
        self.is_active = False
        self.stop_event.set()
        
        if self.streaming_thread:
            self.streaming_thread.join(timeout=2.0)
        
        # 최종 결과 처리
        if self.audio_buffer:
            final_text = self._get_final_result()
            if final_text:
                self._handle_final_result(final_text)
        
        print("[STT Streaming] 스트리밍 세션 종료")
        
    def add_audio_chunk(self, audio_data_int16):
        """오디오 청크 추가 (200ms 단위)"""
        if not self.is_active:
            return
        
        self.audio_buffer.append(audio_data_int16.copy())
        
    def _streaming_loop(self):
        """스트리밍 루프: 주기적으로 partial 결과 생성"""
        while self.is_active and not self.stop_event.is_set():
            time.sleep(STREAMING_CHUNK_MS / 1000.0)  # 200ms 대기
            
            if not self.is_active or not self.audio_buffer:
                continue
            
            # 누적된 오디오로 partial 결과 생성
            partial_text = self._get_partial_result()
            
            if partial_text and partial_text != self.last_partial_text:
                self._handle_partial_result(partial_text)
                self.last_partial_text = partial_text
                self.last_partial_time = time.time()
    
    def _get_partial_result(self):
        """누적된 오디오로 partial 결과 생성 (시뮬레이션)"""
        if not self.audio_buffer:
            return ""
        
        try:
            # 누적된 오디오를 하나로 합치기
            full_audio_np = np.concatenate(self.audio_buffer)
            audio_bytes_data = full_audio_np.tobytes()
            
            # STT API 호출 (partial 결과 시뮬레이션)
            text = recognize_naver_stt(audio_bytes_data)
            return text.strip() if text else ""
        except Exception as e:
            print(f"[STT Streaming Error] Partial 결과 생성 실패: {e}")
            return ""
    
    def _get_final_result(self):
        """최종 결과 생성"""
        if not self.audio_buffer:
            return ""
        
        try:
            # 누적된 오디오를 하나로 합치기
            full_audio_np = np.concatenate(self.audio_buffer)
            audio_bytes_data = full_audio_np.tobytes()
            
            # STT API 호출 (최종 결과)
            text = recognize_naver_stt(audio_bytes_data)
            return text.strip() if text else ""
        except Exception as e:
            print(f"[STT Streaming Error] Final 결과 생성 실패: {e}")
            return ""
    
    def _handle_partial_result(self, text):
        """Partial 결과 처리 (UI에 타이핑 효과로 표시)"""
        if not text:
            return
        
        payload = {
            "type": "stt_partial",
            "text": text
        }
        send_message_to_loop(payload)
        print(f"[STT Streaming] Partial: {text}")
    
    def _handle_final_result(self, text):
        """Final 결과 처리 (감정 분석 및 RAG 실행)"""
        global conversation_history
        
        if not text:
            return
        
        start_time = time.time()
        latency = int((time.time() - start_time) * 1000)
        print(f"🎙️ STT Final: {text} (Latency: {latency}ms)")
        
        # 화자 분석 (Diarization) - 간단한 휴리스틱으로 구현
        speaker_id = 1 if len(conversation_history) % 2 == 0 else 2
        
        # stt_final 메시지 즉시 전송 (UI에 말풍선 표시)
        stt_final_payload = {
            "type": "stt_final",
            "text": text,
            "speakerId": speaker_id,
            "latency": latency
        }
        send_message_to_loop(stt_final_payload)
        
        # 대화 로그에 추가
        conversation_history.append({
            "speakerId": speaker_id,
            "text": text
        })
        
        # Task A (감정 분석)와 Task B (RAG)를 병렬로 실행
        def run_emotion_analysis():
            """Task A: 감정 분석"""
            try:
                print("[Task A] 감정 분석 시작...")
                emotion_json = get_emotion_from_text(text)
                print(f"😮 Emotion: {emotion_json}")
                return emotion_json
            except Exception as e:
                print(f"[Task A Error] {e}")
                return {}
        
        def run_rag_analysis():
            """Task B: RAG 분석 (conversation_history 포함)"""
            try:
                print("[Task B] RAG 분석 시작...")
                history_text = "\n".join([f"화자{item['speakerId']}: {item['text']}" for item in conversation_history])
                coaching_json = get_agent_coaching_RAG(history_text, {}, text)
                print(f"👩‍🏫 RAG: {coaching_json}")
                return coaching_json
            except Exception as e:
                print(f"[Task B Error] {e}")
                return {}
        
        # 병렬 실행
        emotion_future = executor.submit(run_emotion_analysis)
        rag_future = executor.submit(run_rag_analysis)
        
        # 결과 대기 및 조합
        def combine_results():
            emotion_json = emotion_future.result()
            rag_json = rag_future.result()
            
            analysis_payload = {
                "type": "analysis_result",
                "emotion": emotion_json,
                "rag": {
                    "keywords": rag_json.get("keywords", []),
                    "recommended_script": rag_json.get("recommended_script", ""),
                    "relevant_manuals": rag_json.get("relevant_manuals", [])
                }
            }
            send_message_to_loop(analysis_payload)
            print("--- [WebSocket] analysis_result 전송 완료 ---")
        
        executor.submit(combine_results)

def get_emotion_from_text(text):
    try:
        prompt = f"""
        다음 문장에서 화자의 주된 감정을 분석해줘.
        *응답은 반드시 JSON 형식이어야 합니다.*
        JSON 객체는 'anger', 'frustration', 'sadness', 'neutral', 'joy' 5개 키를 가져야 하며,
        값은 0.0에서 1.0 사이의 수치여야 합니다.
        
        문장: "{text}"
        JSON:
        """
        response = gemini_model.generate_content(prompt)
        json_str = response.text.strip().lstrip("```json").rstrip("```").strip()
        return json.loads(json_str)
    except Exception as e:
        print(f"[Emotion API Error] {e}")
        return {"anger": 0.0, "frustration": 0.0, "sadness": 0.0, "neutral": 1.0, "joy": 0.0}

def setup_manual_vector_db(genai_module, embedding_model_name, manuals_data):
    if not manuals_data or not manuals_data.get('manuals'):
        print("⚠️ 매뉴얼 데이터가 없어 벡터 DB를 구축할 수 없습니다.")
        return None
    
    try:
        client = chromadb.EphemeralClient()
        collection = client.get_or_create_collection(name="manuals")
        
        all_texts = []
        all_ids = []
        all_metadatas = []
        
        for manual in manuals_data['manuals']:
            # 각 매뉴얼의 단계별 내용을 텍스트로 변환
            manual_text = f"{manual.get('title', '')}\n{manual.get('subtitle', '')}\n"
            for step in manual.get('steps', []):
                manual_text += f"{step.get('title', '')}: {step.get('content', '')}\n"
            
            all_texts.append(manual_text)
            manual_id = f"{manual.get('category', 'other')}_{manual.get('id', 0)}"
            all_ids.append(manual_id)
            all_metadatas.append({"manual": json.dumps(manual, ensure_ascii=False)})
        
        response = genai_module.embed_content(
            model=embedding_model_name,
            content=all_texts,
            task_type="RETRIEVAL_DOCUMENT"
        )
        
        collection.add(
            embeddings=response['embedding'],
            documents=all_texts,
            ids=all_ids,
            metadatas=all_metadatas
        )
        
        print(f"✅ 매뉴얼 벡터 DB 구축 완료! (총 {collection.count()}개 매뉴얼 저장)")
        return collection
    except Exception as e:
        print(f"🚨 매뉴얼 벡터 DB 구축 실패: {e}")
        import traceback
        traceback.print_exc()
        return None

def find_relevant_manuals(query_text, top_n=2):
    global manual_collection
    if not manual_collection:
        return []
    
    try:
        query_embedding = genai.embed_content(
            model=EMBEDDING_MODEL_NAME,
            content=query_text,
            task_type="RETRIEVAL_QUERY"
        )['embedding']
        
        results = manual_collection.query(query_embeddings=[query_embedding], n_results=top_n)
        
        relevant_manuals = []
        for i in range(len(results['ids'][0])):
            manual_id = results['ids'][0][i]
            try:
                manual_meta = json.loads(results['metadatas'][0][i]['manual'])
                relevant_manuals.append({
                    "title": manual_meta['title'],
                    "category": manual_meta['category'],
                    "steps": manual_meta.get('steps', []),
                    "script": manual_meta.get('script', ''),
                    "keywords": manual_meta.get('keywords', []),
                    "link": f"manual-detail.html?category={manual_id.split('_')[0]}&id={manual_id.split('_')[1]}"
                })
            except:
                continue
        
        return relevant_manuals
    except Exception as e:
        print(f"[Manual Search Error] {e}")
        return []

def get_agent_coaching_RAG(conversation_history_text, emotion_json, latest_text=""):
    """RAG 분석 함수 - ai_style_guide_prompt.txt를 사용하여 호출"""
    global gemini_model, manual_collection, style_guide_prompt
    try:
        # 1. 관련 매뉴얼 찾기 (최신 발화 기준)
        relevant_manuals = find_relevant_manuals(latest_text or conversation_history_text, top_n=2)
        
        # 2. 스타일 가이드 프롬프트 로드 확인
        if not style_guide_prompt:
            print("[RAG Warning] 스타일 가이드가 로드되지 않았습니다. 기본 프롬프트 사용.")
            style_guide_prompt = "당신은 쏘카(Socar)의 최우수 전문 상담사입니다."
        
        # 3. 매뉴얼 데이터를 JSON 문자열로 변환
        retrieved_manuals_json = json.dumps(relevant_manuals, ensure_ascii=False, indent=2) if relevant_manuals else "[]"
        
        # 4. 스타일 가이드 프롬프트에 변수 치환
        prompt = style_guide_prompt.replace("{conversation_history}", conversation_history_text)
        prompt = prompt.replace("{latest_text}", latest_text)
        prompt = prompt.replace("{retrieved_manuals}", retrieved_manuals_json)
        
        # 5. Gemini API 호출
        safety_settings = {k: 'BLOCK_NONE' for k in ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']}
        response = gemini_model.generate_content(prompt, safety_settings=safety_settings)
        
        # 6. JSON 응답 파싱
        json_str = response.text.strip().lstrip("```json").rstrip("```").strip()
        ai_response = json.loads(json_str)
        
        # 7. 결과 반환 (ai_style_guide_prompt.txt 형식에 맞춤)
        keywords = ai_response.get('keywords', [])
        recommended_script = ai_response.get('recommended_script', '')
        relevant_manuals_result = ai_response.get('relevant_manuals', [])
        
        # keywords나 recommended_script가 null이면 빈 값으로 처리
        if keywords is None:
            keywords = []
        if recommended_script is None:
            recommended_script = ''
        
        return {
            "keywords": keywords,
            "recommended_script": recommended_script,
            "relevant_manuals": relevant_manuals_result
        }
    except Exception as e:
        print(f"[RAG API Error] {e}")
        import traceback
        traceback.print_exc()
        return {"keywords": [], "recommended_script": "", "relevant_manuals": []}

def get_call_summary(conversation_history_text):
    """Task C: AI 상담 자동 요약"""
    global gemini_model
    try:
        summary_prompt = f"""SYSTEM:
당신은 콜센터 상담 내용을 분석하는 QA 매니저입니다.

다음 상담 통화 로그 전체를 읽고, 두 가지 항목으로 요약해 주세요.

1. **"주요 문의"**: 고객이 처음 제기한 핵심 문제가 무엇이었는지 1~2줄로 요약하세요.

2. **"처리 결과"**: 상담사가 어떤 해결책을 제시했으며, 어떻게 통화가 종결되었는지 1~2줄로 요약하세요.

[전체 통화 로그]

{conversation_history_text}

[출력 형식 (JSON)]

{{
  "inquiry_summary": "(주요 문의 요약 텍스트)",
  "result_summary": "(처리 결과 요약 텍스트)"
}}
"""
        safety_settings = {k: 'BLOCK_NONE' for k in ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']}
        response = gemini_model.generate_content(summary_prompt, safety_settings=safety_settings)
        
        json_str = response.text.strip().lstrip("```json").rstrip("```").strip()
        summary_result = json.loads(json_str)
        
        return {
            "inquiry_summary": summary_result.get("inquiry_summary", ""),
            "result_summary": summary_result.get("result_summary", "")
        }
    except Exception as e:
        print(f"[Summary API Error] {e}")
        import traceback
        traceback.print_exc()
        return {"inquiry_summary": "", "result_summary": ""}

# --- 6. VAD 및 마이크 처리 (실시간 스트리밍 STT) ---
def audio_callback(indata, frames, time, status):
    if status: print(status, flush=True)
    if frames == VAD_FRAME_SIZE:
        try:
            audio_bytes = indata.tobytes()
            is_speech = vad.is_speech(audio_bytes, SAMPLE_RATE)
            audio_queue.put((is_speech, indata[:, 0].copy()))
        except Exception as e: print(f"[Callback Error] {e}")

def vad_loop():
    """VAD 루프: 음성 시작 감지 시 즉시 STT 스트리밍 시작"""
    global active_stt_stream, naver_stt_client_id, naver_stt_client_secret
    
    print("🎤 [VAD 스레드] 마이크 입력을 시작합니다. (실시간 스트리밍 STT 모드)")
    
    silence_frames_count = 0
    was_speaking = False  # 이전 프레임에서 말하고 있었는지
    
    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            blocksize=VAD_FRAME_SIZE,
            channels=1,
            dtype='int16', 
            callback=audio_callback
        ):
            while True:
                (is_speech, audio_frame_int16) = audio_queue.get()
                
                # 음성 시작 감지: 이전에는 침묵이었는데 지금은 음성
                if is_speech and not was_speaking:
                    # 즉시 STT 스트리밍 세션 시작
                    if active_stt_stream is None:
                        if naver_stt_client_id and naver_stt_client_secret:
                            active_stt_stream = StreamingSTTClient(naver_stt_client_id, naver_stt_client_secret)
                            active_stt_stream.start_streaming()
                            print("[VAD] 음성 시작 감지 → STT 스트리밍 세션 시작")
                        else:
                            print("[VAD] STT API 키가 없어 스트리밍을 시작할 수 없습니다.")
                    was_speaking = True
                    silence_frames_count = 0
                
                # 음성 중: 오디오 청크를 스트리밍 세션에 추가
                if is_speech and active_stt_stream and active_stt_stream.is_active:
                    active_stt_stream.add_audio_chunk(audio_frame_int16)
                    silence_frames_count = 0
                
                # 침묵 감지
                if not is_speech:
                    silence_frames_count += 1
                    
                    # 침묵이 시작되었을 때 (이전에는 말하고 있었음)
                    if was_speaking:
                        was_speaking = False
                    
                    # 800ms 침묵 감지: 스트리밍 세션 종료
                    if silence_frames_count > VAD_FRAMES_PER_TIMEOUT:
                        if active_stt_stream and active_stt_stream.is_active:
                            print(f"[VAD] 0.8초 침묵 감지 → STT 스트리밍 세션 종료")
                            active_stt_stream.stop_streaming()
                            active_stt_stream = None
                        silence_frames_count = 0
                        
    except Exception as e:
        print(f"\n❌ VAD 루프 오류 발생: {e}")
        if active_stt_stream:
            active_stt_stream.stop_streaming()
            active_stt_stream = None

# --- 7. HTTP 서버 (요약 요청 처리) ---
async def handle_summarize(request):
    """HTTP POST 요청으로 요약 처리"""
    try:
        data = await request.json()
        conversation_history_text = data.get('conversation_history', '')
        
        if not conversation_history_text:
            return web.json_response({"error": "conversation_history가 없습니다."}, status=400)
        
        # 요약 생성
        summary = get_call_summary(conversation_history_text)
        
        return web.json_response(summary)
    except Exception as e:
        print(f"[요약 요청 오류] {e}")
        return web.json_response({"error": str(e)}, status=500)

# --- 8. 메인 실행 (수정됨) ---
async def main_async():
    global main_asyncio_loop
    main_asyncio_loop = asyncio.get_event_loop()
    
    # HTTP 서버 시작 (요약 요청용)
    if HTTP_SERVER_AVAILABLE:
        app = web.Application()
        cors = aiohttp_cors.setup(app, defaults={
            "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
                allow_methods="*"
            )
        })
        app.router.add_post('/summarize', handle_summarize)
        
        # CORS 설정
        for route in list(app.router.routes()):
            cors.add(route)
        
        # HTTP 서버 시작
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, 'localhost', 8767)
        await site.start()
        print(f"✅ HTTP 서버 시작: http://localhost:8767/summarize")
    else:
        print("⚠️ HTTP 서버가 비활성화되었습니다. 요약 기능을 사용하려면 aiohttp를 설치하세요.")
    
    # WebSocket 서버 시작
    async with websockets.serve(register_client, "localhost", WEBSOCKET_PORT):
        print(f"✅ WebSocket 서버 시작: ws://localhost:{WEBSOCKET_PORT}")
        await asyncio.Future()  # 무한 대기

if __name__ == "__main__":
    try:
        # 1. 설정 파일 로드 (config.json)
        print("설정 파일 로드 중...")
        loaded_api_key = load_config()
        if not loaded_api_key:
            print(f"🚨 config.json에서 API 키를 로드할 수 없습니다.")
            print(f"💡 config.json 파일에 'gemini_api_key' 필드가 있는지 확인하세요.")
            exit(1)
        
        # 전역 변수에 저장
        GOOGLE_API_KEY = loaded_api_key
        print(f"✅ Gemini API 키 로드 완료 (길이: {len(GOOGLE_API_KEY)} 문자)")
        
        # 2. 스타일 가이드 로드
        print("스타일 가이드 로드 중...")
        load_style_guide()
        
        # 3. Naver CLOVA STT API 키 확인
        print("Naver CLOVA STT API 키 확인 중...")
        if naver_stt_client_id and naver_stt_client_secret:
            print(f"✅ Naver CLOVA STT API 키 설정 완료 (CLIENT_ID: {naver_stt_client_id[:8]}...)")
        else:
            print("⚠️ Naver CLOVA STT API 키가 설정되지 않았습니다. STT 기능이 동작하지 않을 수 있습니다.")
        
        # 4. API 및 RAG DB 초기화
        print("API 키 로드 완료. Gemini API 초기화 중...")
        
        # API 키 유효성 검사
        if not GOOGLE_API_KEY:
            print("🚨 Gemini API 키가 로드되지 않았습니다.")
            exit(1)
        
        if len(GOOGLE_API_KEY.strip()) == 0:
            print("🚨 Gemini API 키가 비어있습니다.")
            exit(1)
        
        print(f"🔑 Gemini API 키 확인: {GOOGLE_API_KEY[:10]}...{GOOGLE_API_KEY[-5:] if len(GOOGLE_API_KEY) > 15 else '***'}")
        
        try:
            genai.configure(api_key=GOOGLE_API_KEY)
            gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
            # API 테스트 (간단한 요청)
            test_response = gemini_model.generate_content("test")
            print(f"✅ Gemini API ({GEMINI_MODEL_NAME}) 키 설정 및 모델 로드 완료.")
        except Exception as api_error:
            print(f"🚨 Gemini API 초기화 실패: {api_error}")
            print(f"💡 해결 방법:")
            print(f"   1. config.json의 gemini_api_key가 유효한지 확인하세요.")
            print(f"   2. Google AI Studio (https://aistudio.google.com/)에서 API 키를 생성하세요.")
            print(f"   3. API 키에 Gemini API 사용 권한이 있는지 확인하세요.")
            exit(1)
        
        # 5. 매뉴얼 데이터 로드
        manuals_data = load_manuals()
        
        # 6. RAG DB 및 매뉴얼 벡터 DB 구축
        rag_collection = setup_vector_db(genai, EMBEDDING_MODEL_NAME)
        manual_collection = setup_manual_vector_db(genai, EMBEDDING_MODEL_NAME, manuals_data)
        
        # 7. VAD 루프를 별도 스레드에서 시작
        vad_thread = threading.Thread(target=vad_loop, daemon=True)
        vad_thread.start()
        
        # 8. 메인 스레드에서 WebSocket 서버 시작
        asyncio.run(main_async())
        
    except KeyboardInterrupt:
        print("\n🛑 서버를 종료합니다.")
    except Exception as e:
        print(f"\n❌ 서버 오류: {e}")
        import traceback
        traceback.print_exc()
