"""Voices of the North — FastAPI 後端。

本次升級重點（對應修復清單第 13 項與相關驗收）：
  * CORS 由 ``*`` 改為環境變數白名單（``VTN_ALLOWED_ORIGINS``）；
  * 加入每 IP 滑動視窗限流（轉寫、登入、問答分開額度）；
  * 音訊上傳改為分塊讀取並強制 10MB 上限，不再一次讀入無上限；
  * ``/api/records`` 與音訊端點按「擁有者 + 分享範圍」在伺服器端過濾；
  * 新增帳戶（電郵驗證碼／學校帳號）、更正審核、撤回、同意與稽核端點；
  * 健康檢查回傳 online / degraded / offline 三態，前端不再猜；
  * 刪除逐詞置信度的 0.92 假數值：取不到就回 null。

環境變數：
  VTN_ALLOWED_ORIGINS   逗號分隔的允許來源（預設本機 8421/5500/8000）
  VTN_MAX_AUDIO_BYTES   音訊上限，預設 10MB
  VTN_DEMO_AUTH         1 = 回傳示範驗證碼／接受示範學校帳號（預設 1，僅供黑客松）
  VTN_DEMO_ALLOW_ADMIN  1 = 允許以示範管理員登入（預設 1）
  VTN_ADMIN_EMAILS      逗號分隔的管理員電郵
  VTN_SECRET            token 簽名密鑰（未設定則每次啟動隨機）
  VTN_RECORDS_TOKEN     額外的維運存取令牌（可選）
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from google.cloud import speech_v1p1beta1 as speech
from starlette.middleware.base import BaseHTTPMiddleware

from lab_api import router as lab_router
from story_corpus import load_data, retrieve_answer, visible_stories

APP_VERSION = "2026.11.05"
DATA_DIR = Path(os.environ.get("VTN_DATA_DIR", "data"))

DEMO_AUTH = os.environ.get("VTN_DEMO_AUTH", "1") == "1"
DEMO_ALLOW_ADMIN = os.environ.get("VTN_DEMO_ALLOW_ADMIN", "1") == "1"
ADMIN_EMAILS = {
    item.strip().lower()
    for item in os.environ.get("VTN_ADMIN_EMAILS", "").split(",")
    if item.strip()
}
SECRET = os.environ.get("VTN_SECRET") or secrets.token_hex(24)
RECORDS_TOKEN = os.environ.get("VTN_RECORDS_TOKEN", "")

MAX_AUDIO_BYTES = int(os.environ.get("VTN_MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))
MAX_RECORD_JSON = 512 * 1024
MAX_QUESTION_LEN = 300

DEFAULT_ORIGINS = [
    "http://localhost:8421",
    "http://127.0.0.1:8421",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]
ALLOWED_ORIGINS = [
    item.strip().rstrip("/")
    for item in os.environ.get("VTN_ALLOWED_ORIGINS", ",".join(DEFAULT_ORIGINS)).split(",")
    if item.strip()
]

app = FastAPI(title="Voices of the North API", version=APP_VERSION)

# ---------------------------------------------------------------------------
# 限流（先加者為內層，故先加限流、後加 CORS，讓 429 亦帶 CORS 標頭）
# ---------------------------------------------------------------------------
RATE_LIMITS = [
    (re.compile(r"^/api/process$"), 10),
    (re.compile(r"^/api/auth/request-code$"), 5),
    (re.compile(r"^/api/ask-village$"), 30),
    (re.compile(r"^/api/"), 90),
]
RATE_WINDOW = 60.0


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[tuple[str, str], deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def _limit_for(self, path: str) -> int:
        for pattern, limit in RATE_LIMITS:
            if pattern.match(path):
                return limit
        return 0

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS" or not path.startswith("/api/"):
            return await call_next(request)

        limit = self._limit_for(path)
        if not limit:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        if os.environ.get("VTN_TRUST_PROXY") == "1":
            forwarded = request.headers.get("x-forwarded-for", "")
            if forwarded:
                client_ip = forwarded.split(",")[0].strip()

        now = time.monotonic()
        key = (client_ip, path)
        with self._lock:
            bucket = self._hits[key]
            while bucket and now - bucket[0] > RATE_WINDOW:
                bucket.popleft()
            if len(bucket) >= limit:
                retry = max(1, int(RATE_WINDOW - (now - bucket[0])) + 1)
                return JSONResponse(
                    status_code=429,
                    content={"detail": "請求太頻繁，請稍後再試。", "code": "RATE_LIMITED", "retry_after": retry},
                    headers={"Retry-After": str(retry)},
                )
            bucket.append(now)
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-VTN-User", "X-VTN-Role", "X-VTN-Token"],
    max_age=600,
)

app.include_router(lab_router)


@app.get("/")
async def root_redirect():
    return RedirectResponse(url="/voices-of-the-north-app.html")


# ---------------------------------------------------------------------------
# STT / LLM 客戶端
# ---------------------------------------------------------------------------
stt_client = None
stt_reason = ""
try:
    stt_client = speech.SpeechClient()
except Exception as exc:  # 凭證缺失不應拖垮整個服務
    stt_client = None
    stt_reason = str(exc)[:300]

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

# ---------------------------------------------------------------------------
# SQLite：錄音、帳戶、更正、撤回、同意、稽核
# ---------------------------------------------------------------------------
RECORDS_DIR = Path(os.environ.get("VTN_RECORDS_DIR", "records"))
DB_PATH = Path(os.environ.get("VTN_DB_PATH", "records.db"))
RECORD_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
STORAGE_MODE = "token" if RECORDS_TOKEN else "scoped"
_db_lock = threading.Lock()
storage_ready = False
storage_reason = ""

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    status TEXT,
    source TEXT,
    has_audio INTEGER NOT NULL DEFAULT 0,
    audio_path TEXT,
    data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deletion_events (
    log_id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    audio_removed INTEGER NOT NULL,
    text_removed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at REAL NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT,
    school TEXT,
    role TEXT,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS corrections (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    target_kind TEXT,
    field TEXT,
    current_text TEXT,
    proposed_text TEXT,
    reason TEXT,
    status TEXT NOT NULL,
    submitted_by TEXT,
    submitted_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    new_version INTEGER
);
CREATE TABLE IF NOT EXISTS story_versions (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    formal_text TEXT,
    previous_text TEXT,
    reason TEXT,
    approved_by TEXT,
    approved_at TEXT
);
CREATE TABLE IF NOT EXISTS withdrawals (
    story_id TEXT PRIMARY KEY,
    withdrawn_at TEXT,
    by_user TEXT,
    reason TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
    log_id TEXT PRIMARY KEY,
    at TEXT,
    action TEXT,
    actor TEXT,
    role TEXT,
    meta_json TEXT
);
CREATE TABLE IF NOT EXISTS consent_log (
    id TEXT PRIMARY KEY,
    at TEXT,
    action TEXT,
    target_id TEXT,
    actor TEXT,
    policy_version TEXT,
    detail_json TEXT
);
"""


def _connect():
    return sqlite3.connect(DB_PATH, timeout=5)


def _init_storage():
    RECORDS_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = _connect()
    try:
        conn.executescript(SCHEMA)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(records)")}
        if "owner" not in columns:
            conn.execute("ALTER TABLE records ADD COLUMN owner TEXT DEFAULT ''")
        if "scope" not in columns:
            conn.execute("ALTER TABLE records ADD COLUMN scope TEXT DEFAULT 'private'")
        conn.commit()
    finally:
        conn.close()


try:
    _init_storage()
    storage_ready = True
except Exception as exc:
    storage_reason = str(exc)[:300]


def _records_count() -> int:
    if not storage_ready:
        return 0
    try:
        conn = _connect()
        try:
            return conn.execute("SELECT COUNT(*) FROM records").fetchone()[0]
        finally:
            conn.close()
    except Exception:
        return 0


def _check_token(request: Request):
    if not RECORDS_TOKEN:
        return
    supplied = request.headers.get("X-VTN-Token") or request.query_params.get("token")
    if supplied != RECORDS_TOKEN:
        raise HTTPException(status_code=401, detail="RECORDS_TOKEN_REQUIRED")


# ---------------------------------------------------------------------------
# 身份：Bearer token（HMAC 簽名）；無 token 者一律訪客
# ---------------------------------------------------------------------------
def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def make_token(email: str, role: str, name: str = "", school: str = "") -> str:
    payload = {
        "email": email,
        "role": role,
        "name": name,
        "school": school,
        "exp": int(time.time()) + 7 * 24 * 3600,
    }
    body = _b64(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()
    return body + "." + signature


def verify_token(token: str) -> dict | None:
    if not token or "." not in token:
        return None
    body, signature = token.rsplit(".", 1)
    expected = hmac.new(SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_unb64(body))
    except Exception:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    if payload.get("role") not in ("member", "admin"):
        payload["role"] = "member"
    return payload


def viewer(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        payload = verify_token(auth[7:].strip())
        if payload:
            return {"email": str(payload.get("email") or "").lower(),
                    "role": payload.get("role") or "member",
                    "name": payload.get("name") or ""}
    user = request.headers.get("x-vtn-user", "")
    if not re.match(r"^visitor-[a-z0-9]{4,32}$", user):
        user = ""
    return {"email": user.lower() if user else "", "role": "visitor", "name": ""}


def _email_hash(code: str) -> str:
    return hmac.new(SECRET.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------------------------------------------------------------------------
# 共用：分享範圍與紀錄擁有權
# ---------------------------------------------------------------------------
SCOPES = {"private", "family", "community", "public"}


def _can_read_record(owner: str, scope: str, who: dict) -> bool:
    if who["role"] == "admin":
        return True
    owner = (owner or "").lower()
    if owner and who["email"] and owner == who["email"]:
        return True
    return scope in ("community", "public")


def _withdrawn_ids() -> set[str]:
    if not storage_ready:
        return set()
    conn = _connect()
    try:
        return {row[0] for row in conn.execute("SELECT story_id FROM withdrawals")}
    except Exception:
        return set()
    finally:
        conn.close()


def _story_versions() -> dict[str, list[dict]]:
    if not storage_ready:
        return {}
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT story_id, version, formal_text, previous_text, reason, approved_by, approved_at "
            "FROM story_versions ORDER BY story_id, version"
        ).fetchall()
    except Exception:
        return {}
    finally:
        conn.close()
    versions: dict[str, list[dict]] = defaultdict(list)
    for story_id, version, text, previous, reason, by, at in rows:
        versions[story_id].append({
            "version": version,
            "formalText": text,
            "previousText": previous,
            "reason": reason,
            "approvedBy": by,
            "at": at,
        })
    return versions


def _ext_of_mime(mime: str) -> str:
    m = (mime or "").lower()
    if "webm" in m:
        return ".webm"
    if "ogg" in m:
        return ".ogg"
    if "mp4" in m or "m4a" in m:
        return ".m4a"
    if "mp3" in m or "mpeg" in m:
        return ".mp3"
    if "wav" in m:
        return ".wav"
    return ".bin"


def _media_type_of_path(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
        ".mp3": "audio/mpeg", ".wav": "audio/wav",
    }.get(ext, "application/octet-stream")


def _row_to_record(data_json: str, has_audio: int, rid: str, owner: str = "", scope: str = "private") -> dict:
    try:
        rec = json.loads(data_json)
    except Exception:
        rec = {"id": rid}
    if has_audio:
        rec["audioUrl"] = "/api/records/" + rid + "/audio"
    rec["sync"] = "synced"
    rec["owner"] = owner or ""
    rec["scope"] = scope or "private"
    return rec


# ---------------------------------------------------------------------------
# 錄音端點（伺服器端按分享範圍過濾）
# ---------------------------------------------------------------------------
@app.post("/api/records")
async def create_record(request: Request):
    _check_token(request)
    if not storage_ready:
        raise HTTPException(status_code=503, detail="STORAGE_UNAVAILABLE: " + storage_reason)

    raw = await request.body()
    if len(raw) > MAX_RECORD_JSON + MAX_AUDIO_BYTES * 2:
        raise HTTPException(status_code=413, detail="錄音資料過大")
    try:
        payload = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=400, detail="請求必須為 JSON")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="錄音資料格式錯誤")

    who = viewer(request)
    rid = str(payload.get("id") or uuid.uuid4().hex)
    if not RECORD_ID_RE.match(rid):
        raise HTTPException(status_code=400, detail="無效的錄音 ID")

    audio_data_url = payload.pop("audioDataURL", None)
    audio_b64 = payload.pop("audioBase64", None) or ""
    if not audio_b64 and isinstance(audio_data_url, str) and ";base64," in audio_data_url:
        audio_b64 = audio_data_url.split(";base64,", 1)[1]

    audio_bytes = b""
    if audio_b64:
        try:
            audio_bytes = base64.b64decode(audio_b64, validate=True)
        except Exception:
            raise HTTPException(status_code=400, detail="音訊 base64 解碼失敗")
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"音訊超過 {MAX_AUDIO_BYTES // (1024 * 1024)}MB 上限",
            )

    scope = str(payload.get("scope") or "private")
    if scope not in SCOPES:
        scope = "private"
    # 擁有者一律由伺服器決定，避免前端偽造
    owner = who["email"]

    clean = {k: v for k, v in payload.items() if k not in ("audioDataURL", "audioBase64", "owner")}
    clean["id"] = rid
    clean["owner"] = owner
    clean["scope"] = scope
    clean["sync"] = "synced"
    created_at = int(payload.get("createdAt") or time.time() * 1000)
    updated_at = int(time.time() * 1000)
    mime = str(clean.get("mime") or "audio/webm")
    status = str(clean.get("status") or "done")
    source = str(clean.get("source") or "live")

    conn = _connect()
    try:
        with _db_lock:
            existing = conn.execute(
                "SELECT audio_path, has_audio, owner FROM records WHERE id=?", (rid,)
            ).fetchone()
            if existing and existing[2] and who["role"] != "admin" and existing[2] != owner:
                raise HTTPException(status_code=403, detail="此錄音屬於其他帳戶")
            audio_path, has_audio = "", 0
            if audio_bytes:
                audio_path = str(RECORDS_DIR / (rid + _ext_of_mime(mime)))
                tmp = Path(audio_path + ".tmp")
                tmp.write_bytes(audio_bytes)
                tmp.replace(audio_path)
                has_audio = 1
            elif existing and existing[0]:
                audio_path, has_audio = existing[0], existing[1]
            conn.execute(
                """INSERT OR REPLACE INTO records
                   (id, created_at, updated_at, status, source, has_audio, audio_path, data_json, owner, scope)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (rid, created_at, updated_at, status, source, has_audio, audio_path,
                 json.dumps(clean, ensure_ascii=False), owner, scope),
            )
            conn.commit()
    finally:
        conn.close()

    result = dict(clean)
    if has_audio:
        result["audioUrl"] = "/api/records/" + rid + "/audio"
    return {"ok": True, "id": rid, "savedAt": updated_at, "record": result}


@app.get("/api/records")
async def list_records(request: Request):
    _check_token(request)
    if not storage_ready:
        raise HTTPException(status_code=503, detail="STORAGE_UNAVAILABLE: " + storage_reason)
    who = viewer(request)
    conn = _connect()
    try:
        if who["role"] == "admin":
            rows = conn.execute(
                "SELECT id, data_json, has_audio, owner, scope FROM records ORDER BY created_at DESC"
            ).fetchall()
        elif who["email"]:
            rows = conn.execute(
                "SELECT id, data_json, has_audio, owner, scope FROM records "
                "WHERE owner=? OR scope IN ('community','public') ORDER BY created_at DESC",
                (who["email"],),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, data_json, has_audio, owner, scope FROM records "
                "WHERE scope IN ('community','public') ORDER BY created_at DESC"
            ).fetchall()
    finally:
        conn.close()
    records = [
        _row_to_record(data_json, has_audio, rid, owner, scope)
        for rid, data_json, has_audio, owner, scope in rows
    ]
    return {"records": records, "count": len(records), "mode": STORAGE_MODE}


@app.get("/api/records/{rid}/audio")
async def get_record_audio(rid: str, request: Request):
    _check_token(request)
    if not RECORD_ID_RE.match(rid):
        raise HTTPException(status_code=400, detail="無效的錄音 ID")
    if not storage_ready:
        raise HTTPException(status_code=503, detail="STORAGE_UNAVAILABLE")
    # <audio> 無法帶 Authorization，允許以 ?token= 簽名播放自己範圍內的音訊
    token_q = request.query_params.get("token")
    payload = verify_token(token_q) if token_q else None
    who = ({"email": str(payload.get("email") or "").lower(),
            "role": payload.get("role") or "member",
            "name": payload.get("name") or ""} if payload else viewer(request))
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT audio_path, has_audio, owner, scope FROM records WHERE id=?", (rid,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="音訊檔不存在")
    if not _can_read_record(row[2], row[3], who):
        raise HTTPException(status_code=403, detail="未獲授權收聽此錄音")
    if not row[1] or not row[0] or not Path(row[0]).is_file():
        raise HTTPException(status_code=404, detail="音訊檔不存在")
    return FileResponse(row[0], media_type=_media_type_of_path(row[0]))


@app.get("/api/records/{rid}")
async def get_record(rid: str, request: Request):
    _check_token(request)
    if not RECORD_ID_RE.match(rid):
        raise HTTPException(status_code=400, detail="無效的錄音 ID")
    if not storage_ready:
        raise HTTPException(status_code=503, detail="STORAGE_UNAVAILABLE")
    who = viewer(request)
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT data_json, has_audio, owner, scope FROM records WHERE id=?", (rid,)
        ).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="找不到該錄音")
    if not _can_read_record(row[2], row[3], who):
        raise HTTPException(status_code=403, detail="未獲授權查看此錄音")
    return _row_to_record(row[0], row[1], rid, row[2], row[3])


@app.delete("/api/records/{rid}")
async def delete_record(rid: str, request: Request):
    """實體刪除：音訊檔 + 資料庫列，並留下不含個人資料的刪除稽核紀錄。"""
    _check_token(request)
    if not RECORD_ID_RE.match(rid):
        raise HTTPException(status_code=400, detail="無效的錄音 ID")
    if not storage_ready:
        raise HTTPException(status_code=503, detail="STORAGE_UNAVAILABLE: " + storage_reason)

    who = viewer(request)
    deleted_at = datetime.now(timezone.utc).isoformat()
    log_id = uuid.uuid4().hex
    conn = _connect()
    try:
        with _db_lock:
            row = conn.execute(
                "SELECT audio_path, owner FROM records WHERE id=?", (rid,)
            ).fetchone()
            if not row:
                return {"ok": True, "id": rid, "serverHad": False, "deletedAt": deleted_at}
            if row[1] and who["role"] != "admin" and row[1] != who["email"]:
                raise HTTPException(status_code=403, detail="只可刪除自己的錄音")

            audio_removed = False
            if row[0]:
                path = Path(row[0])
                if path.is_file():
                    path.unlink()
                    audio_removed = True
            conn.execute("DELETE FROM records WHERE id=?", (rid,))
            conn.execute(
                """INSERT INTO deletion_events
                   (log_id, record_id, deleted_at, audio_removed, text_removed)
                   VALUES (?, ?, ?, ?, ?)""",
                (log_id, rid, deleted_at, int(audio_removed), 1),
            )
            conn.commit()
    finally:
        conn.close()
    return {
        "ok": True,
        "id": rid,
        "serverHad": True,
        "audioRemoved": audio_removed,
        "textRemoved": True,
        "deletedAt": deleted_at,
        "deletionLogId": log_id,
    }


# ---------------------------------------------------------------------------
# 故事庫（按授權＋分享範圍＋未撤回過濾）與問答
# ---------------------------------------------------------------------------
def parse_bbox(raw: str | None):
    """解析 west,south,east,north；無參數代表不过滤，格式错误返回 400。"""
    if raw is None or raw == "":
        return None
    parts = str(raw).split(",")
    if len(parts) != 4:
        raise HTTPException(status_code=400, detail="bbox 需為 west,south,east,north")
    try:
        west, south, east, north = (float(part.strip()) for part in parts)
    except ValueError:
        raise HTTPException(status_code=400, detail="bbox 必須是四個數字")
    if not (-180 <= west <= 180 and -180 <= east <= 180 and
            -90 <= south <= 90 and -90 <= north <= 90 and west < east and south < north):
        raise HTTPException(status_code=400, detail="bbox 範圍不合法")
    return (west, south, east, north)


def clip_to_bbox(stories: list[dict], bbox) -> list[dict]:
    """視口裁剪：地圖與問答都用這一份結果，不各寫一套。"""
    if not bbox:
        return list(stories)
    result = []
    for story in stories:
        loc = story.get("location") or {}
        lat, lng = loc.get("lat"), loc.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            continue
        if bbox[0] <= lng <= bbox[2] and bbox[1] <= lat <= bbox[3]:
            result.append(story)
    return result


def current_visible_stories(request: Request) -> list[dict]:
    """全站唯一的可見故事集合。

    授權／分享範圍／撤回由 story_corpus.visible_stories 判定；這裡只補上
    audioUrl、transcriptOnly 與更正版本等顯示欄位。地圖與問答都從這一份
    出發，避免「問答說找到 3 則、地圖只有 1 個點」的口徑分叉。
    """
    who = viewer(request)
    excluded = _withdrawn_ids()
    versions = _story_versions()
    result = []
    for story in visible_stories(
        viewer_user=who["email"], role=who["role"], excluded=excluded
    ):
        item = dict(story)
        item["audioUrl"] = ("/" + str(story["audio"]).lstrip("/")) if story.get("audio") else None
        item["transcriptOnly"] = not bool(story.get("audio"))
        if versions.get(story["id"]):
            item["versions"] = versions[story["id"]]
            item["correctedText"] = versions[story["id"]][-1]["formalText"]
        result.append(item)
    return result


@app.get("/api/stories")
async def list_stories(request: Request):
    bbox = parse_bbox(request.query_params.get("bbox"))
    visible = current_visible_stories(request)
    stories = clip_to_bbox(visible, bbox)
    data = load_data()
    result = {
        "stories": stories,
        "count": len(stories),
        "visibleCount": len(visible),
        "visibleIds": [str(s["id"]) for s in visible],
        "contentVersion": data.get("contentVersion"),
        "consentPolicyVersion": data.get("consentPolicyVersion"),
    }
    if bbox:
        result["bbox"] = list(bbox)
    return result


@app.post("/api/ask-village")
async def ask_village(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    question = str(body.get("question") or body.get("query") or "")[:MAX_QUESTION_LEN]
    lang = str(body.get("lang") or "zh-HK")
    if lang not in ("zh-HK", "zh-CN", "en"):
        lang = "zh-HK"
    who = viewer(request)
    bbox = parse_bbox(body.get("bbox"))
    scope = clip_to_bbox(current_visible_stories(request), bbox)
    result = retrieve_answer(question, lang=lang, stories=scope)
    result["rank"] = who["role"]
    result["visibleCount"] = len(scope)
    result["visibleIds"] = [str(s["id"]) for s in scope]
    if bbox:
        result["bbox"] = list(bbox)
    return result


# ---------------------------------------------------------------------------
# 帳戶：電郵驗證碼 / 學校帳號
# ---------------------------------------------------------------------------
@app.post("/api/auth/request-code")
async def request_code(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    email = str(body.get("email") or "").strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="請輸入有效電郵地址")
    if not storage_ready:
        raise HTTPException(status_code=503, detail="信箱驗證暫不可用（儲存層未就緒）")

    code = f"{secrets.randbelow(1000000):06d}"
    now = time.time()
    conn = _connect()
    try:
        with _db_lock:
            conn.execute(
                "INSERT OR REPLACE INTO auth_codes (email, code_hash, expires_at, attempts, created_at) "
                "VALUES (?, ?, ?, 0, ?)",
                (email, _email_hash(code), now + 600, now),
            )
            conn.commit()
    finally:
        conn.close()

    response = {"ok": True, "expires_in": 600}
    if DEMO_AUTH:
        # 黑客松示範：未接 SMTP，直接把驗證碼回傳並在介面標明「不會寄出電郵」
        response["dev_code"] = code
        response["demo"] = True
    return response


@app.post("/api/auth/verify")
async def verify_login(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    email = str(body.get("email") or "").strip().lower()
    school_id = str(body.get("school_id") or "").strip()
    password = str(body.get("password") or "")
    code = str(body.get("code") or "").strip()
    wants_admin = bool(body.get("admin"))

    if not email and school_id:
        email = school_id if "@" in school_id else f"{re.sub(r'[^a-zA-Z0-9._-]', '', school_id)}@school.demo"

    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="請輸入有效電郵地址")

    demo_path = False
    if code:
        if not storage_ready:
            raise HTTPException(status_code=503, detail="驗證服務未就緒")
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT code_hash, expires_at, attempts FROM auth_codes WHERE email=?", (email,)
            ).fetchone()
            if row and row[1] < int(time.time()):
                raise HTTPException(status_code=400, detail="驗證碼已過期，請重新發送")
            if row and row[2] >= 5:
                raise HTTPException(status_code=429, detail="嘗試次數過多，請重新發送驗證碼")
            if not row or not hmac.compare_digest(row[0], _email_hash(code)):
                if row:
                    with _db_lock:
                        conn.execute("UPDATE auth_codes SET attempts=attempts+1 WHERE email=?", (email,))
                        conn.commit()
                raise HTTPException(status_code=400, detail="驗證碼不正確")
            with _db_lock:
                conn.execute("DELETE FROM auth_codes WHERE email=?", (email,))
                conn.commit()
        finally:
            conn.close()
    elif school_id and password:
        if not DEMO_AUTH:
            raise HTTPException(status_code=401, detail="學校帳號登入未啟用")
        demo_path = True
    else:
        raise HTTPException(status_code=400, detail="請提供驗證碼或學校帳號")

    role = "admin" if email in ADMIN_EMAILS else "member"
    if wants_admin and DEMO_AUTH and DEMO_ALLOW_ADMIN and role != "admin":
        role = "admin"
        demo_path = True

    name = school_id or email.split("@")[0]
    school = "示範學校" if school_id else ""

    if storage_ready:
        conn = _connect()
        try:
            with _db_lock:
                conn.execute(
                    "INSERT OR REPLACE INTO users (email, name, school, role, created_at) VALUES (?, ?, ?, ?, ?)",
                    (email, name, school, role, datetime.now(timezone.utc).isoformat()),
                )
                conn.commit()
        finally:
            conn.close()

    return {
        "token": make_token(email, role, name, school),
        "email": email,
        "role": role,
        "name": name,
        "school": school,
        "demo": demo_path or DEMO_AUTH,
    }


# ---------------------------------------------------------------------------
# 更正（申請 → 審核 → 新版本；原文保留）
# ---------------------------------------------------------------------------
@app.post("/api/corrections")
async def create_correction(request: Request):
    if not storage_ready:
        raise HTTPException(status_code=503, detail="更正服務未就緒")
    try:
        body = await request.json()
    except Exception:
        body = {}
    target_id = str(body.get("target_id") or "").strip()
    proposed = str(body.get("proposed_text") or "").strip()
    if not target_id or len(proposed) < 2:
        raise HTTPException(status_code=400, detail="請提供更正對象與建議內容")
    if len(proposed) > 2000:
        raise HTTPException(status_code=413, detail="建議內容過長")

    who = viewer(request)
    entry_id = uuid.uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    try:
        with _db_lock:
            conn.execute(
                """INSERT INTO corrections
                   (id, target_id, target_kind, field, current_text, proposed_text, reason,
                    status, submitted_by, submitted_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)""",
                (
                    entry_id, target_id, str(body.get("target_kind") or "story"),
                    str(body.get("field") or "other"), str(body.get("current_text") or "")[:4000],
                    proposed, str(body.get("reason") or "")[:400],
                    who["email"] or "visitor", now,
                ),
            )
            conn.commit()
    finally:
        conn.close()
    return {"ok": True, "id": entry_id, "status": "submitted", "submittedAt": now}


@app.get("/api/corrections")
async def list_corrections(request: Request):
    if not storage_ready:
        raise HTTPException(status_code=503, detail="更正服務未就緒")
    who = viewer(request)
    conn = _connect()
    try:
        if who["role"] == "admin":
            rows = conn.execute(
                "SELECT id, target_id, target_kind, field, current_text, proposed_text, reason, "
                "status, submitted_by, submitted_at, reviewed_by, reviewed_at, new_version "
                "FROM corrections ORDER BY submitted_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, target_id, target_kind, field, current_text, proposed_text, reason, "
                "status, submitted_by, submitted_at, reviewed_by, reviewed_at, new_version "
                "FROM corrections WHERE submitted_by=? ORDER BY submitted_at DESC",
                (who["email"] or "visitor",),
            ).fetchall()
    finally:
        conn.close()
    keys = ["id", "target_id", "target_kind", "field", "current_text", "proposed_text",
            "reason", "status", "submitted_by", "submitted_at", "reviewed_by",
            "reviewed_at", "new_version"]
    return {"corrections": [dict(zip(keys, row)) for row in rows]}


@app.post("/api/corrections/{correction_id}/review")
async def review_correction(correction_id: str, request: Request):
    if not storage_ready:
        raise HTTPException(status_code=503, detail="更正服務未就緒")
    who = viewer(request)
    if who["role"] != "admin":
        raise HTTPException(status_code=403, detail="只有管理員可以審核更正")

    try:
        body = await request.json()
    except Exception:
        body = {}
    approve = bool(body.get("approve"))
    note = str(body.get("note") or "")[:400]
    now = datetime.now(timezone.utc).isoformat()

    conn = _connect()
    try:
        row = conn.execute(
            "SELECT target_id, target_kind, current_text, proposed_text, reason, status "
            "FROM corrections WHERE id=?", (correction_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="找不到此更正申請")
        if row[5] != "submitted":
            raise HTTPException(status_code=409, detail="此申請已審核")

        new_version = None
        if approve:
            new_version = conn.execute(
                "SELECT COUNT(*) FROM story_versions WHERE story_id=?", (row[0],)
            ).fetchone()[0] + 2
            with _db_lock:
                conn.execute(
                    """INSERT INTO story_versions
                       (story_id, version, formal_text, previous_text, reason, approved_by, approved_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (row[0], new_version, row[3], row[2], row[4], who["email"], now),
                )
                conn.execute(
                    "UPDATE records SET data_json=json_set(data_json, '$.formalText', ?), updated_at=? WHERE id=?",
                    (row[3], int(time.time() * 1000), row[0]),
                )
                conn.execute(
                    "UPDATE corrections SET status='approved', reviewed_by=?, reviewed_at=?, new_version=? WHERE id=?",
                    (who["email"], now, new_version, correction_id),
                )
                conn.commit()
        else:
            with _db_lock:
                conn.execute(
                    "UPDATE corrections SET status='rejected', reviewed_by=?, reviewed_at=? WHERE id=?",
                    (who["email"], now, correction_id),
                )
                conn.commit()
    finally:
        conn.close()

    return {"ok": True, "id": correction_id, "approved": approve,
            "newVersion": new_version, "note": note}


# ---------------------------------------------------------------------------
# 撤回 / 同意 / 稽核
# ---------------------------------------------------------------------------
@app.post("/api/stories/{story_id}/withdraw")
async def withdraw_story(story_id: str, request: Request):
    if not re.match(r"^[A-Za-z0-9_-]{1,64}$", story_id):
        raise HTTPException(status_code=400, detail="無效的故事 ID")
    if not storage_ready:
        raise HTTPException(status_code=503, detail="撤回服務未就緒")
    try:
        body = await request.json()
    except Exception:
        body = {}
    who = viewer(request)
    now = datetime.now(timezone.utc).isoformat()
    conn = _connect()
    try:
        with _db_lock:
            conn.execute(
                "INSERT OR REPLACE INTO withdrawals (story_id, withdrawn_at, by_user, reason) VALUES (?, ?, ?, ?)",
                (story_id, now, who["email"] or "visitor", str(body.get("reason") or "")[:400]),
            )
            conn.commit()
    finally:
        conn.close()
    return {"ok": True, "id": story_id, "withdrawnAt": now}


@app.post("/api/audit")
async def write_audit(request: Request):
    if not storage_ready:
        raise HTTPException(status_code=503, detail="稽核服務未就緒")
    try:
        body = await request.json()
    except Exception:
        body = {}
    who = viewer(request)
    log_id = uuid.uuid4().hex
    # 指標事件只允許數值／ID／模式欄位，拒絕逐字稿、標題等自由文字。
    metric_keys = ("storyId", "durationMs", "ratio", "zoom", "engine",
                   "view", "source", "count", "event")
    meta = {k: v for k, v in (body.get("meta") or {}).items()
            if k in ("from", "to", "note", "targetId", "version", "synced") + metric_keys}
    conn = _connect()
    try:
        with _db_lock:
            conn.execute(
                "INSERT INTO audit_log (log_id, at, action, actor, role, meta_json) VALUES (?, ?, ?, ?, ?, ?)",
                (log_id, datetime.now(timezone.utc).isoformat(), str(body.get("action") or "")[:80],
                 who["email"] or "visitor", who["role"], json.dumps(meta, ensure_ascii=False)),
            )
            conn.commit()
    finally:
        conn.close()
    return {"ok": True, "id": log_id}


@app.post("/api/consent")
async def write_consent(request: Request):
    if not storage_ready:
        raise HTTPException(status_code=503, detail="同意記錄服務未就緒")
    try:
        body = await request.json()
    except Exception:
        body = {}
    who = viewer(request)
    entry_id = uuid.uuid4().hex
    conn = _connect()
    try:
        with _db_lock:
            conn.execute(
                "INSERT INTO consent_log (id, at, action, target_id, actor, policy_version, detail_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entry_id, datetime.now(timezone.utc).isoformat(),
                 str(body.get("action") or "")[:80], str(body.get("targetId") or "")[:64],
                 who["email"] or "visitor", str(body.get("policyVersion") or "")[:64],
                 json.dumps({k: body.get(k) for k in ("to", "from", "reason") if body.get(k) is not None},
                            ensure_ascii=False)),
            )
            conn.commit()
    finally:
        conn.close()
    return {"ok": True, "id": entry_id}


# ---------------------------------------------------------------------------
# 健康檢查
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    llm_ready = gemini_client is not None
    stt_ready = stt_client is not None
    try:
        story_count = len(load_data().get("stories") or [])
    except Exception:
        story_count = 0
    if stt_ready and llm_ready:
        ai_status = "online"
    elif stt_ready or llm_ready or storage_ready:
        ai_status = "degraded"
    else:
        ai_status = "offline"
    return {
        "status": "ok",
        "version": APP_VERSION,
        "ai_status": ai_status,
        "stt_ready": stt_ready,
        "stt_reason": stt_reason,
        "gemini_ready": llm_ready,
        "llm_ready": llm_ready,
        "storage_ready": storage_ready,
        "storage_reason": storage_reason,
        "storage_mode": STORAGE_MODE,
        "records_count": _records_count(),
        "ask_village_ready": story_count > 0,
        "story_count": story_count,
        "allowed_origins": len(ALLOWED_ORIGINS),
    }


# ---------------------------------------------------------------------------
# 轉寫
# ---------------------------------------------------------------------------
@app.post("/api/process")
async def process_audio(request: Request, file: UploadFile = File(None)):
    is_live_upload = file is not None

    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_AUDIO_BYTES + 1024 * 1024:
        raise HTTPException(status_code=413, detail="音訊超過大小上限")

    if is_live_upload:
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = await file.read(512 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_AUDIO_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"音訊超過 {MAX_AUDIO_BYTES // (1024 * 1024)}MB 上限，請縮短錄音。",
                )
            chunks.append(chunk)
        content = b"".join(chunks)
        if not content:
            raise HTTPException(status_code=400, detail="未收到有效的現場音訊內容。")
        filename = file.filename or ""
        content_type = file.content_type or ""
    else:
        demo_paths = [
            "frontend/assets/Demo Story.wav",
            "assets/Demo Story.wav",
            "Demo Story.wav",
        ]
        content = b""
        filename = ""
        content_type = ""
        for path in demo_paths:
            if os.path.exists(path):
                with open(path, "rb") as handle:
                    content = handle.read(MAX_AUDIO_BYTES + 1)
                filename = path
                content_type = "audio/wav"
                break
        if not content:
            raise HTTPException(status_code=404, detail="示範故事音訊檔案不存在。")
        if len(content) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="示範音訊超過大小上限。")

    # 誠實原則：無憑證時絕不冒充已轉寫
    if not stt_client:
        raise HTTPException(
            status_code=503,
            detail="STT_UNCONFIGURED: 未設定 Google Cloud 憑證，錄音已保存為待轉寫。",
        )

    encoding = speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED
    sample_rate = 16000
    name_lower = filename.lower()
    if "webm" in name_lower or "webm" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        sample_rate = 48000
    elif "ogg" in name_lower or "ogg" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.OGG_OPUS
        sample_rate = 48000
    elif "mp3" in name_lower or "mp3" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.MP3
    elif "wav" in name_lower or "wav" in content_type:
        encoding = speech.RecognitionConfig.AudioEncoding.LINEAR16

    recognition_audio = speech.RecognitionAudio(content=content)
    try:
        config_kwargs = {
            "language_code": "yue-Hant-HK",
            "enable_word_time_offsets": True,
            "enable_automatic_punctuation": True,
        }
        if encoding != speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED:
            config_kwargs["encoding"] = encoding
            config_kwargs["sample_rate_hertz"] = sample_rate
        response = stt_client.recognize(
            config=speech.RecognitionConfig(**config_kwargs), audio=recognition_audio
        )
    except Exception:
        try:
            response = stt_client.recognize(
                config=speech.RecognitionConfig(
                    language_code="yue-Hant-HK",
                    enable_word_time_offsets=True,
                    enable_automatic_punctuation=True,
                ),
                audio=recognition_audio,
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"語音辨識服務異常: {str(exc)[:200]}")

    raw_text = ""
    words: list[dict] = []
    max_end = 0.0
    for result in response.results:
        if not result.alternatives:
            continue
        alternative = result.alternatives[0]
        raw_text += alternative.transcript
        for word_info in alternative.words:
            start_sec = word_info.start_time.total_seconds()
            end_sec = word_info.end_time.total_seconds()
            max_end = max(max_end, end_sec)
            # 第 11 項：取不到逐詞置信度就回 None，不再繼承或寫死 0.92
            word_conf = getattr(word_info, "confidence", 0.0)
            words.append({
                "word": word_info.word,
                "start": round(start_sec, 2),
                "end": round(end_sec, 2),
                "confidence": round(float(word_conf), 2) if word_conf and word_conf > 0 else None,
            })
    raw_text = raw_text.strip()
    duration_sec = round(max_end, 2)

    if not raw_text:
        return {
            "mode": "online",
            "source": "live" if is_live_upload else "demo",
            "raw_text": "",
            "words": [],
            "duration_sec": duration_sec,
            "confidence_available": False,
            "llm_result": {
                "formal_text": "（未偵測到清晰語音或錄音時長過短，請重新嘗試講述故事。）",
                "qa_list": [],
            },
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
                res = gemini_client.models.generate_content(model="gemini-2.5-flash", contents=prompt)
                text = res.text
            else:
                res = gemini_client.generate_content(prompt)
                text = res.text
            cleaned = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            parsed = json.loads(cleaned)
            if isinstance(parsed, dict) and isinstance(parsed.get("formal_text"), str):
                qa_list = []
                for qa in parsed.get("qa_list") or []:
                    if not isinstance(qa, dict):
                        continue
                    try:
                        stamp = float(qa.get("timestamp") or 0)
                    except (TypeError, ValueError):
                        stamp = 0.0
                    if duration_sec:
                        stamp = max(0.0, min(stamp, duration_sec))
                    qa_list.append({
                        "question": str(qa.get("question") or "")[:200],
                        "answer": str(qa.get("answer") or "")[:1000],
                        "timestamp": round(stamp, 2),
                    })
                llm_result = {"formal_text": parsed["formal_text"], "qa_list": qa_list[:3]}
        except Exception:
            llm_result = {"formal_text": raw_text, "qa_list": []}

    return {
        "mode": "online",
        "source": "live" if is_live_upload else "demo",
        "raw_text": raw_text,
        "words": words,
        "duration_sec": duration_sec,
        "confidence_available": any(w["confidence"] is not None for w in words),
        "llm_result": llm_result,
    }


# 掛載前端靜態目錄（必須最後，否則會攔截 /api）
if os.path.exists("frontend"):
    app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")
