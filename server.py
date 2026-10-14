import os
import io
import json
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import speech
from google import genai
from google.genai import types

try:
    from pydub import AudioSegment
    HAS_PYDUB = True
except ImportError:
    HAS_PYDUB = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

stt_client = speech.SpeechClient()

GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
gemini_client = genai.Client(api_key=GEMINI_KEY) if GEMINI_KEY else None

def ensure_wav_bytes(raw_bytes: bytes) -> bytes:
    if not HAS_PYDUB:
        return raw_bytes
    try:
        segment = AudioSegment.from_file(io.BytesIO(raw_bytes))
        segment = segment.set_channels(1).set_frame_rate(16000)
        out_buf = io.BytesIO()
        segment.export(out_buf, format="wav")
        return out_buf.getvalue()
    except Exception as e:
        return raw_bytes

def transcribe_audio_bytes(audio_bytes: bytes):
    audio = speech.RecognitionAudio(content=audio_bytes)
    config = speech.RecognitionConfig(
        language_code="yue-Hant-HK",
        enable_word_time_offsets=True,
        enable_word_confidence=True,
    )
    
    response = stt_client.recognize(config=config, audio=audio)
    
    words = []
    full_text = ""
    for result in response.results:
        alt = result.alternatives[0]
        full_text += alt.transcript
        for w in alt.words:
            words.append({
                "word": w.word,
                "confidence": round(w.confidence, 3),
                "start": round(w.start_time.total_seconds(), 2),
                "end": round(w.end_time.total_seconds(), 2)
            })
    return full_text, words

def analyze_with_gemini(raw_text: str):
    if not raw_text.strip():
        return {
            "formal_text": "未檢測到有效語音內容。",
            "qa_list": []
        }
    
    if not gemini_client:
        return {
            "formal_text": f"規整文本（未配置 GEMINI_API_KEY，返回原稿）：{raw_text}",
            "qa_list": [
                {
                    "question": "口述核心內容",
                    "answer": raw_text[:35] + "...",
                    "timestamp": 0.0
                }
            ]
        }
    
    prompt = f"""
你是一個專業的香港口述歷史整理與數字人文專家。
請對以下香港粵語口述轉錄稿進行分析整理：
原始口述文本: "{raw_text}"

請務必返回合法的 JSON 格式，嚴格包含以下兩個字段：
1. "formal_text": 書面化與口誤修正後的通順中文段落。
2. "qa_list": 提取 2-3 個核心問答條目，每個元素包含:
   - "question": 問題描述（例如：童年元朗的生活景況？）
   - "answer": 簡明摘要回答
   - "timestamp": 該問題在音頻中大概對應的起始秒數（根據內容估算，如 0.0、17.5 等浮點數）
"""
    try:
        response = gemini_client.models.generate_content(
            model='gemini-3.8-flash',
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        return json.loads(response.text)
    except Exception as e:
        return {
            "formal_text": f"規整文本（模型暫時繁忙，顯示轉錄原稿）：{raw_text}",
            "qa_list": [
                {
                    "question": "口述重點內容",
                    "answer": raw_text[:35] + "...",
                    "timestamp": 0.0
                }
            ]
        }

@app.post("/api/process")
async def process_audio(file: UploadFile = File(None)):
    try:
        if file is not None:
            raw_audio_bytes = await file.read()
            audio_bytes = ensure_wav_bytes(raw_audio_bytes)
        else:
            default_path = "./Demo Story.wav"
            if not os.path.exists(default_path):
                raise HTTPException(status_code=400, detail="未上傳文件且默認音頻不存在")
            with open(default_path, "rb") as f:
                audio_bytes = f.read()

        raw_text, words = transcribe_audio_bytes(audio_bytes)
        llm_result = analyze_with_gemini(raw_text)

        return {
            "status": "success",
            "raw_text": raw_text,
            "words": words,
            "llm_result": llm_result
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)