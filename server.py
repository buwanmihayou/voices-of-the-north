import io
import json
import os
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google.cloud import speech_v1p1beta1 as speech

app = FastAPI(title="Voices of the North API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

stt_client = None
stt_reason = ""
try:
    stt_client = speech.SpeechClient()
except Exception as e:
    stt_client = None
    stt_reason = str(e)

gemini_client = None
gemini_api_key = os.environ.get("GEMINI_API_KEY")
if gemini_api_key:
    try:
        from google import genai
        gemini_client = genai.Client(api_key=gemini_api_key)
    except Exception:
        try:
            import google.generativeai as gai
            gai.configure(api_key=gemini_api_key)
            gemini_client = gai.GenerativeModel("gemini-1.5-flash")
        except Exception:
            gemini_client = None

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "stt_ready": stt_client is not None,
        "stt_reason": stt_reason,
        "gemini_ready": gemini_client is not None,
    }

@app.post("/api/process")
async def process_audio(file: UploadFile = File(None)):
    is_live_upload = file is not None

    if is_live_upload:
        content = await file.read()
        if not content or len(content) == 0:
            raise HTTPException(status_code=400, detail="未收到有效的現場音訊內容。")
    else:
        demo_paths = ["Demo Story.wav", "assets/demo-story.m4a", "frontend/assets/demo-story.m4a"]
        content = None
        for p in demo_paths:
            if os.path.exists(p):
                with open(p, "rb") as f:
                    content = f.read()
                break
        if not content:
            raise HTTPException(status_code=404, detail="示範故事音訊檔案不存在。")

    if not stt_client:
        raise HTTPException(
            status_code=503,
            detail="STT_UNCONFIGURED: 未設定 Google Cloud 憑證，現場音訊已保存為待轉寫。"
        )

    pcm_data = content
    try:
        from pydub import AudioSegment
        audio_seg = AudioSegment.from_file(io.BytesIO(content))
        audio_seg = audio_seg.set_frame_rate(16000).set_channels(1)
        out_buf = io.BytesIO()
        audio_seg.export(out_buf, format="wav")
        pcm_data = out_buf.getvalue()
    except Exception:
        pcm_data = content

    try:
        recognition_audio = speech.RecognitionAudio(content=pcm_data)
        config = speech.RecognitionConfig(
            encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
            sample_rate_hertz=16000,
            language_code="yue-Hant-HK",
            enable_word_time_offsets=True,
            enable_automatic_punctuation=True,
        )
        response = stt_client.recognize(config=config, audio=recognition_audio)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"語音辨識服務異常: {str(e)}")

    raw_text = ""
    words = []
    for result in response.results:
        alternative = result.alternatives[0]
        raw_text += alternative.transcript
        for word_info in alternative.words:
            start_sec = word_info.start_time.total_seconds()
            end_sec = word_info.end_time.total_seconds()
            words.append({
                "word": word_info.word,
                "start": round(start_sec, 2),
                "end": round(end_sec, 2),
                "confidence": round(word_info.confidence, 2)
            })

    raw_text = raw_text.strip()

    if not raw_text:
        return {
            "mode": "online",
            "source": "live" if is_live_upload else "demo",
            "raw_text": "",
            "words": [],
            "llm_result": {
                "formal_text": "（未偵測到清晰語音或錄音時長過短，請重新嘗試講述故事。）",
                "qa_list": []
            }
        }

    prompt = f"""你是一位嚴謹的口述歷史檔案整理員。
以下是用戶現場口述的原始粵語辨識結果（raw_text）：
「{raw_text}」

請嚴格遵守以下誠實性原則進行處理：
1. formal_text：將上面的口述文字進行標點修整及適度書面化，但【絕對嚴禁添加、編造、擴寫】任何原文未提及的情節、地點、時間或人物。原文只有一句話，整理結果也必須只有一句話！
2. qa_list：根據口述內容提取最多 2~3 個問答。每個問答必須指定該內容在口述中大概出現的秒數 timestamp（秒）。如果口述內容過短（例如少於10個字）無法提煉問答，qa_list 請直接返回空數組 []，嚴禁捏造問答！
3. 請直接輸出 JSON 格式：
{{
  "formal_text": "整理後文字",
  "qa_list": [
    {{"question": "問題", "answer": "回答", "timestamp": 0.0}}
  ]
}}"""

    llm_result = {"formal_text": raw_text, "qa_list": []}
    if gemini_client:
        try:
            if hasattr(gemini_client, "models"):
                res = gemini_client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=prompt
                )
                txt = res.text
            else:
                res = gemini_client.generate_content(prompt)
                txt = res.text
            
            clean_txt = txt.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            llm_result = json.loads(clean_txt)
        except Exception:
            llm_result = {"formal_text": raw_text, "qa_list": []}

    return {
        "mode": "online",
        "source": "live" if is_live_upload else "demo",
        "raw_text": raw_text,
        "words": words,
        "llm_result": llm_result
    }

if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
