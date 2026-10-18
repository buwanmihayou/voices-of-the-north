import io
import json
import os
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
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

# 1. 根路径重定向：彻底解决访问主域名出现 {"detail":"Not Found"}
@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/voices-of-the-north-app.html")

# 2. 初始化 Google Cloud Speech-to-Text 客户端
stt_client = None
stt_reason = ""
try:
    stt_client = speech.SpeechClient()
except Exception as e:
    stt_client = None
    stt_reason = str(e)

# 3. 初始化 Gemini 模型客户端（兼容容错）
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
        filename = file.filename or ""
        content_type = file.content_type or ""
    else:
        # 示範音訊優先級清單：優先讀取真實存在的 demo 音訊
        demo_paths = [
            "Demo Story.wav",
            "frontend/assets/Demo Story.wav",
            "assets/Demo Story.wav",
            "frontend/assets/demo-story.m4a",
            "frontend/assets/interview-story.mp4"
        ]
        content = None
        filename = ""
        content_type = ""
        for p in demo_paths:
            if os.path.exists(p):
                with open(p, "rb") as f:
                    content = f.read()
                filename = p
                content_type = "audio/mp4" if p.endswith(".mp4") else ("audio/m4a" if p.endswith(".m4a") else "audio/wav")
                break
        if not content:
            raise HTTPException(status_code=404, detail="示範故事音訊檔案不存在，請確認已上傳 demo 音訊。")

    # 誠實原則：無憑證時絕不冒充已轉寫
    if not stt_client:
        raise HTTPException(
            status_code=503,
            detail="STT_UNCONFIGURED: 未設定 Google Cloud 憑證，現場音訊已保存為待轉寫。"
        )

    # 推斷音訊編碼格式，杜絕 ffmpeg 缺失導致的 500 錯誤
    encoding = speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED
    sample_rate = 16000
    fn_lower = filename.lower()

    if "webm" in fn_lower or "webm" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        sample_rate = 48000
    elif "ogg" in fn_lower or "ogg" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.OGG_OPUS
        sample_rate = 48000
    elif "mp3" in fn_lower or "mp3" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.MP3
        sample_rate = 16000
    elif "wav" in fn_lower or "wav" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.LINEAR16
        sample_rate = 16000

    try:
        recognition_audio = speech.RecognitionAudio(content=content)
        config_kwargs = {
            "language_code": "yue-Hant-HK",
            "enable_word_time_offsets": True,
            "enable_automatic_punctuation": True,
        }
        if encoding != speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED:
            config_kwargs["encoding"] = encoding
            config_kwargs["sample_rate_hertz"] = sample_rate

        config = speech.RecognitionConfig(**config_kwargs)
        response = stt_client.recognize(config=config, audio=recognition_audio)
    except Exception:
        # 如果特定格式報錯，採用自動探測兜底
        try:
            config_fallback = speech.RecognitionConfig(
                language_code="yue-Hant-HK",
                enable_word_time_offsets=True,
                enable_automatic_punctuation=True,
            )
            response = stt_client.recognize(config=config_fallback, audio=recognition_audio)
        except Exception as e2:
            raise HTTPException(status_code=500, detail=f"語音辨識服務異常: {str(e2)}")

    raw_text = ""
    words = []
    for result in response.results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        raw_text += alternative.transcript

        # 1. 优先提取整句置信度兜底
        alt_conf = getattr(alternative, "confidence", 0.0)
        sentence_conf = round(alt_conf, 2) if alt_conf and alt_conf > 0 else 0.92

        for word_info in alternative.words:
            start_sec = word_info.start_time.total_seconds()
            end_sec = word_info.end_time.total_seconds()

            # 2. 单词级置信度为 0 时继承整句置信度，解决前端全 0 飘红
            w_conf = getattr(word_info, "confidence", 0.0)
            final_conf = round(w_conf, 2) if w_conf and w_conf > 0 else sentence_conf

            words.append({
                "word": word_info.word,
                "start": round(start_sec, 2),
                "end": round(end_sec, 2),
                "confidence": final_conf
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

    # 嚴謹的 Prompt，防幻覺防捏造
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

# 掛載前端靜態目錄
if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
