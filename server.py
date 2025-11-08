import os
import getpass # (getpass는 이제 사용하지 않지만, 혹시 모를 호환성을 위해 남겨둘 수 있습니다)
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

# Google API
import google.generativeai as genai

# RAG DB
import chromadb

# 오디오 변환
from pydub import AudioSegment

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
API_KEY_FILENAME = 'api_key.txt' # <-- Gemini API 키 파일 이름
NAVER_CLOVA_API_FILENAME = 'naver_clova_api.txt' # <-- Naver CLOVA STT API 키 파일 이름
SCRIPT_DIR = Path(__file__).resolve().parent
FFMPEG_PATH = SCRIPT_DIR / 'ffmpeg-8.0' / 'bin' / 'ffmpeg.exe'
API_KEY_PATH = SCRIPT_DIR / API_KEY_FILENAME
NAVER_CLOVA_API_PATH = SCRIPT_DIR / NAVER_CLOVA_API_FILENAME

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
# Naver CLOVA STT API 키 (하드코딩)
naver_stt_client_id = "lifnuyqd4c"
naver_stt_client_secret = "n9rHvgTBhk8d4judQehhfsJEkOiumANkNkxKauv5"
vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
audio_queue = queue.Queue()
executor = ThreadPoolExecutor(max_workers=3)
cumulative_transcript = ""
CONNECTED_CLIENTS = set()
main_asyncio_loop = None

# --- 3. 매뉴얼 데이터 로드 ---
def load_manuals():
    global manuals_data
    manuals_json_path = SCRIPT_DIR / 'manuals.json'
    try:
        with open(manuals_json_path, 'r', encoding='utf-8') as f:
            manuals_data = json.load(f)
        print(f"✅ 매뉴얼 데이터 로드 완료!")
        return manuals_data
    except Exception as e:
        print(f"🚨 매뉴얼 데이터 로드 실패: {e}")
        return {}

# --- 4. 매뉴얼 벡터 DB 구축 ---
def setup_manual_vector_db(genai_module, embedding_model_name, manuals_data):
    print("\n매뉴얼 Vector DB 구축 시작...")
    manual_documents = []
    
    for category, items in manuals_data.items():
        for manual_id, manual in items.items():
            # 매뉴얼 제목, 키워드, 단계 내용을 하나의 텍스트로 결합
            manual_text = f"제목: {manual['title']}\n카테고리: {manual['category']}\n키워드: {', '.join(manual['keywords'])}\n"
            for step in manual.get('steps', []):
                manual_text += f"\n{step['title']}:\n{step['content']}\n"
            
            manual_documents.append({
                "id": f"{category}_{manual_id}",
                "text": manual_text,
                "manual": manual
            })
    
    if not manual_documents:
        print("⚠️ 매뉴얼 문서가 없습니다.")
        return None
    
    client = chromadb.EphemeralClient()
    collection = client.get_or_create_collection(name="manuals")
    all_texts = [doc["text"] for doc in manual_documents]
    all_ids = [doc["id"] for doc in manual_documents]
    
    response = genai_module.embed_content(
        model=embedding_model_name,
        content=all_texts,
        task_type="RETRIEVAL_DOCUMENT"
    )
    collection.add(
        embeddings=response['embedding'],
        documents=all_texts,
        ids=all_ids,
        metadatas=[{"manual": json.dumps(doc["manual"], ensure_ascii=False)} for doc in manual_documents]
    )
    print(f"✅ 매뉴얼 Vector DB 구축 완료! (총 {collection.count()}개 매뉴얼 저장)")
    return collection

# --- 5. RAG DB 구축 (변경 없음) ---
def setup_vector_db(genai_module, embedding_model_name):
    print("\nVector DB 구축 시작...")
    # [지식] CS 핵심 매뉴얼
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

# --- 5. Naver CLOVA STT API ---
def load_naver_clova_api_keys():
    """Naver CLOVA STT API 키 로드"""
    global naver_stt_client_id, naver_stt_client_secret
    try:
        if not NAVER_CLOVA_API_PATH.exists():
            print(f"⚠️ Naver CLOVA API 키 파일({NAVER_CLOVA_API_PATH})을 찾을 수 없습니다.")
            return False
        
        with open(NAVER_CLOVA_API_PATH, 'r', encoding='utf-8') as f:
            content = f.read()
            # CLIENT_ID와 CLIENT_SECRET 파싱
            for line in content.split('\n'):
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                # CLIENT_ID = "value" 또는 CLIENT_ID="value" 형식 지원
                if 'CLIENT_ID' in line.upper():
                    if '=' in line:
                        parts = line.split('=', 1)
                        if len(parts) == 2:
                            naver_stt_client_id = parts[1].strip().strip('"').strip("'")
                elif 'CLIENT_SECRET' in line.upper():
                    if '=' in line:
                        parts = line.split('=', 1)
                        if len(parts) == 2:
                            naver_stt_client_secret = parts[1].strip().strip('"').strip("'")
        
        if naver_stt_client_id and naver_stt_client_secret:
            print(f"✅ Naver CLOVA STT API 키 로드 완료 (CLIENT_ID: {naver_stt_client_id[:8]}...)")
            return True
        else:
            print(f"⚠️ Naver CLOVA API 키가 제대로 로드되지 않았습니다.")
            print(f"   CLIENT_ID: {'있음' if naver_stt_client_id else '없음'}, CLIENT_SECRET: {'있음' if naver_stt_client_secret else '없음'}")
            return False
    except Exception as e:
        print(f"🚨 Naver CLOVA API 키 로드 실패: {e}")
        import traceback
        traceback.print_exc()
        return False

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
    """Naver CLOVA STT API를 사용하여 음성을 텍스트로 변환"""
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
        print(f"[Emotion API Error] {e} / Response: {response.text}")
        return {"anger": 0.0, "frustration": 0.0, "sadness": 0.0, "neutral": 1.0, "joy": 0.0}

def find_relevant_manuals(text, top_n=3):
    """고객 발화에서 관련 매뉴얼을 찾는 함수"""
    global manual_collection, manuals_data
    if not manual_collection or not manuals_data:
        return []
    
    try:
        query_embedding = genai.embed_content(
            model=EMBEDDING_MODEL_NAME, content=text, task_type="RETRIEVAL_QUERY"
        )['embedding']
        results = manual_collection.query(query_embeddings=[query_embedding], n_results=top_n)
        
        relevant_manuals = []
        for i, manual_id in enumerate(results['ids'][0]):
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

def get_agent_coaching_RAG(transcript, emotion_json, customer_text=""):
    global gemini_model, rag_collection, manual_collection
    try:
        # 1. 관련 매뉴얼 찾기
        relevant_manuals = find_relevant_manuals(customer_text or transcript, top_n=2)
        
        # 2. 매뉴얼에서 추천 스크립트 및 단계 추출
        manual_suggestions = []
        expected_questions = []
        recommended_scripts = []
        
        for manual in relevant_manuals:
            # 대응 매뉴얼
            for step in manual.get('steps', []):
                manual_suggestions.append({
                    "title": manual['title'],
                    "step": step['title'],
                    "content": step['content']
                })
            
            # 추천 스크립트
            if manual.get('script'):
                recommended_scripts.append(manual['script'])
        
        # 3. Gemini로 예상 질문 생성
        query_text = f"대화 내용: {transcript}\n고객 최근 발화: {customer_text}\n고객 감정: {json.dumps(emotion_json)}"
        
        if relevant_manuals:
            manual_context = "\n".join([f"- {m['title']}: {', '.join(m.get('keywords', []))}" for m in relevant_manuals])
            query_text += f"\n관련 매뉴얼:\n{manual_context}"
        
        query_embedding = genai.embed_content(
            model=EMBEDDING_MODEL_NAME, content=query_text, task_type="RETRIEVAL_QUERY"
        )['embedding']
        results = rag_collection.query(query_embeddings=[query_embedding], n_results=3)
        retrieved_guidelines = "\n\n".join(results['documents'][0])

        COACHING_PROMPT_RAG_JSON = f"""
        [SYSTEM]
        당신은 '신입 상담원 교육'을 담당하는 CS(Customer Service) 전문 코치입니다.
        [REFERENCE_GUIDELINES]
        {retrieved_guidelines}
        [CONTEXT]
        {query_text}
        [TASK]
        위 [CONTEXT]와 [REFERENCE_GUIDELINES]를 근거로:
        1. 고객이 다음에 물어볼 수 있는 예상 질문 3개를 생성하세요.
        2. 고객 의도를 분석하여 핵심 키워드를 추출하세요.
        *응답은 반드시 JSON 형식이어야 합니다.*
        JSON 객체는 'expected_questions' (문자열 리스트)와 'keywords' (문자열 리스트) 2개 키를 가져야 합니다.
        JSON:
        """
        
        safety_settings = {k: 'BLOCK_NONE' for k in ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']}
        response = gemini_model.generate_content(COACHING_PROMPT_RAG_JSON, safety_settings=safety_settings)
        
        json_str = response.text.strip().lstrip("```json").rstrip("```").strip()
        ai_response = json.loads(json_str)
        
        # 매뉴얼에서 추출한 키워드 추가
        all_keywords = set(ai_response.get('keywords', []))
        for manual in relevant_manuals:
            all_keywords.update(manual.get('keywords', []))
        
        return {
            "suggestions": manual_suggestions,
            "expected_questions": ai_response.get('expected_questions', []) + expected_questions,
            "recommended_scripts": recommended_scripts,
            "keywords": list(all_keywords),
            "relevant_manuals": relevant_manuals
        }
    except Exception as e:
        print(f"[RAG API Error] {e}")
        import traceback
        traceback.print_exc()
        return {"suggestions": [], "expected_questions": [], "recommended_scripts": [], "keywords": [], "relevant_manuals": []}

# --- 6. VAD 및 마이크 처리 (변경 없음) ---
def audio_callback(indata, frames, time, status):
    if status: print(status, flush=True)
    if frames == VAD_FRAME_SIZE:
        try:
            audio_bytes = indata.tobytes()
            is_speech = vad.is_speech(audio_bytes, SAMPLE_RATE)
            audio_queue.put((is_speech, indata[:, 0].copy()))
        except Exception as e: print(f"[Callback Error] {e}")

def process_speech_segment(audio_frames_int16):
    global cumulative_transcript
    
    if len(audio_frames_int16) < VAD_MIN_SPEECH_FRAMES:
        print("[VAD] 0.5초 미만 발화 (무시됨)")
        return
        
    full_audio_np = np.concatenate(audio_frames_int16)
    audio_bytes_data = full_audio_np.tobytes()
    
    start_time = time.time()
    
    # --- 1. STT (Naver CLOVA) ---
    print("[1/3] STT API (Naver CLOVA) 호출 중...")
    new_transcription = recognize_naver_stt(audio_bytes_data)
    if not new_transcription:
        print("[STT] 빈 결과 (무시됨)")
        return
    
    latency = int((time.time() - start_time) * 1000)
    print(f"🎙️ STT: {new_transcription} (Latency: {latency}ms)")
    
    stt_payload = {
        "type": "stt",
        "data": { "speaker": "고객", "text": new_transcription, "latency": latency }
    }
    send_message_to_loop(stt_payload)
    
    cumulative_transcript += f"고객: {new_transcription}\n"

    # --- 2. 감정 분석 (Gemini) ---
    print("[2/3] Emotion API (Gemini) 호출 중...")
    emotion_json = get_emotion_from_text(new_transcription)
    print(f"😮 Emotion: {emotion_json}")

    # --- 3. RAG 코칭 및 매뉴얼 추천 (Gemini) ---
    print("[3/3] RAG Coaching & Manual Recommendation (Gemini) 호출 중...")
    coaching_json = get_agent_coaching_RAG(cumulative_transcript, emotion_json, new_transcription)
    print(f"👩‍🏫 Coaching: {coaching_json}")

    # 매뉴얼에서 추출한 데이터 정리
    manual_items = []
    for suggestion in coaching_json.get("suggestions", []):
        manual_items.append({
            "title": suggestion.get("title", ""),
            "step": suggestion.get("step", ""),
            "content": suggestion.get("content", "")
        })

    analysis_payload = {
        "type": "analysis",
        "data": {
            "emotions": emotion_json,
            "suggestions": manual_items,  # 매뉴얼 기반 추천
            "expected_questions": coaching_json.get("expected_questions", []),
            "recommended_scripts": coaching_json.get("recommended_scripts", []),
            "keywords": coaching_json.get("keywords", []),
            "relevant_manuals": coaching_json.get("relevant_manuals", []),
            "risk": emotion_json.get('anger', 0.0) + emotion_json.get('frustration', 0.0),
            "tone": "격앙" if (emotion_json.get('anger', 0) > 0.5) else "보통",
            "wpm": 130 + int(np.random.rand() * 20),
            "agentStress": 0.5 + (emotion_json.get('anger', 0) * 0.3),
            "agentState": {"text": "주의", "badge": "badge-warning"} if (emotion_json.get('anger', 0) > 0.5) else {"text": "안정", "badge": "badge-success"},
            "escalations": 1 if (emotion_json.get('anger', 0) > 0.3) else 0,
            "alert": "강한 불만 감지. 톤을 낮추세요." if (emotion_json.get('anger', 0) > 0.5) else "안정적인 응대입니다."
        }
    }
    send_message_to_loop(analysis_payload)
    print("--- [WebSocket] 분석 결과 전송 완료 ---")

def vad_loop():
    print("🎤 [VAD 스레드] 마이크 입력을 시작합니다.")
    speech_audio_buffer = []
    silence_frames_count = 0
    
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
                
                if is_speech:
                    silence_frames_count = 0
                    speech_audio_buffer.append(audio_frame_int16)
                else:
                    silence_frames_count += 1
                
                if not is_speech and silence_frames_count > VAD_FRAMES_PER_TIMEOUT:
                    if speech_audio_buffer:
                        print(f"\n[VAD] 0.8초 침묵 감지. (총 {len(speech_audio_buffer) * VAD_FRAME_MS}ms 음성)")
                        executor.submit(process_speech_segment, speech_audio_buffer.copy())
                    speech_audio_buffer = []
                    silence_frames_count = 0
    except Exception as e:
        print(f"\n❌ VAD 루프 오류 발생: {e}")

# --- 7. 메인 실행 (수정됨) ---
async def main_async():
    global main_asyncio_loop
    main_asyncio_loop = asyncio.get_running_loop()
    
    print(f"--- WebSocket 서버를 시작합니다 (ws://localhost:{WEBSOCKET_PORT}) ---")
    async with websockets.serve(register_client, "localhost", WEBSOCKET_PORT):
        await asyncio.Future()

if __name__ == "__main__":
    
    # --- (수정됨) API 키 파일에서 로드 ---
    try:
        # 1. API 키 파일에서 로드
        if not API_KEY_PATH.exists():
            print(f"🚨 API 키 파일({API_KEY_PATH})을 찾을 수 없습니다.")
            print(f"   파일을 생성하고, 그 안에 Gemini API 키를 저장하세요.")
            exit() # 프로그램 종료
        
        with open(API_KEY_PATH, 'r', encoding='utf-8') as f:
            GOOGLE_API_KEY = f.read().strip()
        
        if not GOOGLE_API_KEY:
            print(f"🚨 {API_KEY_FILENAME} 파일이 비어있습니다. API 키를 입력하세요.")
            exit()

        # 2. Naver CLOVA STT API 키 확인
        print("Naver CLOVA STT API 키 확인 중...")
        if naver_stt_client_id and naver_stt_client_secret:
            print(f"✅ Naver CLOVA STT API 키 설정 완료 (CLIENT_ID: {naver_stt_client_id[:8]}...)")
        else:
            print("⚠️ Naver CLOVA STT API 키가 설정되지 않았습니다. STT 기능이 동작하지 않을 수 있습니다.")
        
        # 3. API 및 RAG DB 초기화
        print("API 키 로드 완료. Gemini API 초기화 중...")
        genai.configure(api_key=GOOGLE_API_KEY)
        gemini_model = genai.GenerativeModel(GEMINI_MODEL_NAME)
        gemini_model.generate_content("test") # API 테스트
        print(f"✅ Gemini API ({GEMINI_MODEL_NAME}) 키 설정 및 모델 로드 완료.")
        
        # 4. 매뉴얼 데이터 로드
        manuals_data = load_manuals()
        
        # 5. RAG DB 및 매뉴얼 벡터 DB 구축
        rag_collection = setup_vector_db(genai, EMBEDDING_MODEL_NAME)
        manual_collection = setup_manual_vector_db(genai, EMBEDDING_MODEL_NAME, manuals_data)
        
        # 6. VAD 루프를 별도 스레드에서 시작
        vad_thread = threading.Thread(target=vad_loop, daemon=True)
        vad_thread.start()
        
        # 7. 메인 스레드에서 WebSocket 서버 시작
        asyncio.run(main_async())
        
    except KeyboardInterrupt:
        print("\n🛑 서버를 종료합니다.")
    except Exception as e:
        print(f"🚨 초기화 실패: {e}")