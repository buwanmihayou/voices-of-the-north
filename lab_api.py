"""Voices of the North — 測試線（lab）API。

對應 Google 文檔《準備好Techathon了嗎》末尾已指派給 Zheng 的 4 條方案：

  1. 強化互動感 → 「問答廣場」：只有「問題」一種結構化互動（無 feed / 點讚 / 追蹤 / 留言）；
  2. 升級地圖動態感 → 「清拆時鐘」示意資料層（明確標記未核實，非官方依據）；
  3. 問題卡片 → 12 張生活記憶卡，長者唔使諗題目、唔使碰手機；
  4. 故事細分與人工兜底 → 第 1 層自動匹配 + 第 2 層義工確認，兩層狀態嚴格分離。

紅線紀律：
  * 自動匹配結果一律標 ``machineGuess: true`` / ``reviewStatus: "pending"``，
    不得直接成為可公開事實；Gemini 未設定時用關鍵詞規則降級並如實標明，絕不冒充 LLM。
  * 問答廣場嘅聲音回答必須關聯一條已保存嘅錄音，並附 ``Source: [id] at mm:ss`` 出處。
  * 不收集身份資料（無帳號、無顯示名、無 cookie、不記錄 IP）。
  * 「清拆時鐘」全部為示意資料，``verified: false``、``illustrative: true``，
    不含任何聲稱來自政府的具體日期或文件編號。

掛載方式（server.py）：``app.include_router(lab_router)``
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request

from storage import connect as db_connect, is_postgres, safe_error

router = APIRouter(prefix="/api/lab", tags=["lab-test-line"])

_lock = threading.Lock()
lab_storage_ready = False
lab_storage_reason = ""

QUESTION_CARDS = [
    {"id": "C01", "category": "暖身", "prompt": "你細個最記得屋企邊件物件？", "hint": "可以係一張櫈、一個碗、一張相"},
    {"id": "C02", "category": "暖身", "prompt": "細個屋企附近，最常聽到咩聲？", "hint": "雀仔、火車、叫賣聲都得"},
    {"id": "C03", "category": "暖身", "prompt": "細個你喺邊度玩得多？", "hint": "唔使講門牌，講大概地方就得"},
    {"id": "C04", "category": "生活", "prompt": "過年最記得食咩、做咩？", "hint": "味道同儀式都可以講"},
    {"id": "C05", "category": "生活", "prompt": "以前點樣去墟市或者買餸？", "hint": "行路、單車、巴士？"},
    {"id": "C06", "category": "生活", "prompt": "後生嗰陣一日通常點過？", "hint": "由朝早講起都得"},
    {"id": "C07", "category": "生活", "prompt": "以前返學或者有咩好玩嘅回憶？", "hint": "同學、遊戲、路上見聞"},
    {"id": "C08", "category": "生活", "prompt": "有冇一個節慶或者習俗特別深刻？", "hint": "唔涉及人名都得"},
    {"id": "C09", "category": "地方", "prompt": "村口以前係點嘅樣？", "hint": "樹、橋、舖頭、榕樹下"},
    {"id": "C10", "category": "地方", "prompt": "附近嘅田、魚塘或者河，以前點用？", "hint": "農事、灌溉、捉魚"},
    {"id": "C11", "category": "地方", "prompt": "由細到大，出入交通有咩唔同？", "hint": "單車、巴士、小路"},
    {"id": "C12", "category": "地方", "prompt": "你最想後生一代記住呢度嘅咩？", "hint": "一個畫面或者一句說話"},
]

CARD_GUARDRAILS = [
    "一卡一問，長者可以揀、可以跳過、可以隨時停。",
    "題目只問生活記憶；唔問征地補償、地界產權、家族糾紛，亦唔評價在世第三人。",
    "由義工／青年持機，長者只係自然講嘢，唔使註冊、唔使睇地圖、唔使㩒私隱設定。",
]

TOPIC_RULES = {
    "童年與成長": ["細個", "童年", "後生", "讀書", "返學", "同學", "玩"],
    "農事與土地": ["農田", "耕作", "稻田", "魚塘", "菜", "收割", "灌溉", "田"],
    "交通與出行": ["單車", "踩車", "巴士", "交通", "行路", "墟市", "渡船"],
    "節慶與飲食": ["過年", "新年", "節慶", "習俗", "食", "餸", "糕", "團年"],
    "自然與聲音": ["雀", "鳥", "蟲鳴", "草叢", "樹", "河", "溪", "蛙"],
    "村落變遷": ["起樓", "樓宇", "發展", "轉變", "變化", "消失", "而家", "近年"],
    "家族與鄰里": ["屋企", "隔籬", "鄰居", "阿爺", "阿婆", "家人"],
}

PLACE_RULES = {
    "元朗": ["元朗"], "粉嶺": ["粉嶺"], "上水": ["上水"],
    "古洞": ["古洞"], "新田": ["新田"], "錦田": ["錦田"],
}

ERA_PATTERNS = [
    (r"(19[3-9]\d|20[0-2]\d)\s*年", "literal"),
    (r"(戰前|戰後|六十年代|七十年代|八十年代|九十年代)", "decade"),
    (r"(近年|近排|而家|舊時|舊陣)", "relative"),
]

ILLUSTRATIVE_TIMELINE = {
    "illustrative": True,
    "verified": False,
    "source": "【待驗證】北部都會區公開發展範圍與清拆時間表；本時間軸只係採集優先度示意，不代表官方資料或任何實際工程時間表。",
    "licenseNote": "【待驗證】OSM 底圖與政府地理資料嘅使用條款、署名要求，核實前只可用作示意 mock。",
    "warning": "示意資料，未經核實，不可作官方依據；亦不涉及任何長者精確位置。",
    "privacy": "只用村級約 800 米模糊範圍，不下鑽至門牌或 GPS 座標。",
    "years": [2026, 2028, 2030, 2032],
    "villages": [
        {
            "id": "VILLAGE-DEMO", "area": "元朗（示意）", "lat": 22.4445, "lng": 114.015,
            "radiusM": 800, "note": "對應唯一一則角色扮演示範故事 YL-001，並非真實村落檔案。",
            "phases": [
                {"year": 2026, "label": "現況・示範故事", "urgency": "low", "illustrative": True},
                {"year": 2028, "label": "記憶採集優先（示意）", "urgency": "medium", "illustrative": True},
                {"year": 2030, "label": "待核實（示意）", "urgency": "medium", "illustrative": True},
                {"year": 2032, "label": "待核實（示意）", "urgency": "high", "illustrative": True},
            ],
        }
    ],
}


# ---------------------------------------------------------------------------
# 儲存層
# ---------------------------------------------------------------------------

def _connect():
    return db_connect()


def _init():
    conn = _connect()
    try:
        conn.execute("""CREATE TABLE IF NOT EXISTS card_selections (
            id TEXT PRIMARY KEY, card_id TEXT NOT NULL, village TEXT,
            created_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS metadata_reviews (
            record_id TEXT PRIMARY KEY, suggested_json TEXT NOT NULL,
            confirmed_json TEXT, status TEXT NOT NULL, classifier TEXT NOT NULL,
            reviewer TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS questions (
            id TEXT PRIMARY KEY, village TEXT NOT NULL, question TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL,
            answer_record_id TEXT, answer_timestamp REAL, answer_citation TEXT,
            answered_at TEXT)""")
        if is_postgres():
            for table in ("card_selections", "metadata_reviews", "questions"):
                conn.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        conn.commit()
    finally:
        conn.close()


try:
    _init()
    lab_storage_ready = True
except Exception as exc:
    lab_storage_reason = safe_error(exc)


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _body(request: Request) -> dict:
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="請求必須為 JSON")
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="資料格式錯誤")
    return data


def _record_exists(record_id: str) -> bool:
    try:
        conn = _connect()
        try:
            return conn.execute(
                "SELECT 1 FROM records WHERE id=?", (record_id,)
            ).fetchone() is not None
        finally:
            conn.close()
    except Exception:
        return False


def _fmt_ts(sec: float) -> str:
    safe = max(0, int(sec or 0))
    return f"{safe // 60:02d}:{safe % 60:02d}"


# ---------------------------------------------------------------------------
# 方案 3：問題卡片
# ---------------------------------------------------------------------------

@router.get("/cards")
async def get_cards():
    return {
        "cards": QUESTION_CARDS,
        "count": len(QUESTION_CARDS),
        "guardrails": CARD_GUARDRAILS,
        "usage": "義工持機揀卡，長者只係自然講嘢；揀卡結果可隨錄音一併存入 /api/records 嘅 questionCard 欄位。",
    }


@router.post("/cards/select")
async def select_card(request: Request):
    data = await _body(request)
    card_id = str(data.get("cardId") or "")
    card = next((c for c in QUESTION_CARDS if c["id"] == card_id), None)
    if not card:
        raise HTTPException(status_code=400, detail="無效嘅問題卡 ID")
    selection_id = uuid.uuid4().hex
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO card_selections (id, card_id, village, created_at) VALUES (?, ?, ?, ?)",
                (selection_id, card_id, str(data.get("village") or ""), _now()),
            )
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "selectionId": selection_id, "card": card}


@router.get("/cards/selections")
async def list_card_selections():
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, card_id, village, created_at FROM card_selections ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
    finally:
        conn.close()
    return {"selections": [
        {"id": r[0], "cardId": r[1], "village": r[2], "createdAt": r[3]} for r in rows
    ], "count": len(rows)}


# ---------------------------------------------------------------------------
# 方案 4：故事細分 — 第 1 層自動匹配 + 第 2 層義工兜底
# ---------------------------------------------------------------------------

def _rule_suggest(text: str) -> dict:
    lowered = str(text or "")
    topics = [name for name, kws in TOPIC_RULES.items() if any(kw in lowered for kw in kws)]
    places = [name for name, kws in PLACE_RULES.items() if any(kw in lowered for kw in kws)]
    era = None
    for pattern, kind in ERA_PATTERNS:
        match = re.search(pattern, lowered)
        if match:
            era = {"value": match.group(0), "kind": kind}
            break
    return {
        "topicTags": topics,
        "place": places[0] if places else None,
        "eraOrYear": era["value"] if era else None,
        "eraKind": era["kind"] if era else None,
        "dialect": "yue-Hant-HK" if re.search(r"[\u4e00-\u9fff]", lowered) else None,
        "confidence": 0.5 if topics or places else 0.2,
    }


def _gemini_suggest(text: str):
    """Gemini 可用時用 LLM；任何失敗都降級，並如實回報 classifier。"""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None, "keyword-fallback"
    try:
        from google import genai

        client = genai.Client(api_key=api_key)
        prompt = (
            "你是口述歷史檔案管理員。只根據以下逐字稿，抽取主題標籤、地點、年代、方言，"
            "嚴禁添加原文冇提及嘅任何資料；唔確定嘅欄位留 null。"
            "直接輸出 JSON：{\"topicTags\":[],\"place\":null,\"eraOrYear\":null,\"dialect\":null,\"confidence\":0.0}\n"
            f"逐字稿：「{text[:1500]}」"
        )
        raw = client.models.generate_content(model="gemini-2.5-flash", contents=prompt).text
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("not a dict")
        return parsed, "gemini"
    except Exception:
        return None, "keyword-fallback"


@router.post("/classify")
async def classify_record(request: Request):
    """第 1 層：機器猜測，永遠係 pending，唔可以直接對外公開。"""
    data = await _body(request)
    record_id = str(data.get("recordId") or "")
    if not record_id:
        raise HTTPException(status_code=400, detail="需要 recordId")
    text = str(data.get("text") or "")

    suggested, classifier = _gemini_suggest(text)
    if suggested is None:
        suggested = _rule_suggest(text)
    suggested = {
        "topicTags": suggested.get("topicTags") or [],
        "place": suggested.get("place"),
        "eraOrYear": suggested.get("eraOrYear"),
        "dialect": suggested.get("dialect"),
        "confidence": suggested.get("confidence", 0.2),
    }

    now = _now()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """INSERT INTO metadata_reviews
                   (record_id, suggested_json, confirmed_json, status, classifier, reviewer, created_at, updated_at)
                   VALUES (?, ?, NULL, 'pending', ?, NULL, ?, ?)
                   ON CONFLICT(record_id) DO UPDATE SET
                     suggested_json=excluded.suggested_json,
                     status=excluded.status,
                     classifier=excluded.classifier,
                     created_at=excluded.created_at,
                     updated_at=excluded.updated_at""",
                (record_id, json.dumps(suggested, ensure_ascii=False), classifier, now, now),
            )
            conn.commit()
        finally:
            conn.close()

    return {
        "ok": True,
        "recordId": record_id,
        "suggested": suggested,
        "classifier": classifier,
        "machineGuess": True,
        "reviewStatus": "pending",
        "note": "機器猜測，未確認。捐工／義工必須喺第 2 層覆核先可以作為可公開嘅分類。"
                if classifier == "gemini" else
                "Gemini 未設定或不可用，本輪為關鍵詞規則降級（唔係 LLM 輸出）；機器猜測，未確認，需義工覆核。",
    }


@router.post("/confirm")
async def confirm_metadata(request: Request):
    """第 2 層：義工／志願者確認或修正；之後先係 human_confirmed。"""
    data = await _body(request)
    record_id = str(data.get("recordId") or "")
    if not record_id:
        raise HTTPException(status_code=400, detail="需要 recordId")
    reviewer = str(data.get("reviewer") or "義工（未署名）")
    raw_topics = data.get("topicTags") or []
    if isinstance(raw_topics, str):
        raw_topics = [t.strip() for t in re.split(r"[,，、]", raw_topics) if t.strip()]
    confirmed = {
        "topicTags": [str(t).strip() for t in raw_topics if str(t).strip()][:12],
        "place": data.get("place") or None,
        "eraOrYear": data.get("eraOrYear") or None,
        "dialect": data.get("dialect") or None,
    }
    now = _now()
    with _lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT suggested_json, classifier, created_at FROM metadata_reviews WHERE record_id=?",
                (record_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="未搵到自動建議，請先執行第 1 層")
            conn.execute(
                """UPDATE metadata_reviews
                   SET confirmed_json=?, status='human_confirmed', reviewer=?, updated_at=?
                   WHERE record_id=?""",
                (json.dumps(confirmed, ensure_ascii=False), reviewer, now, record_id),
            )
            conn.commit()
        finally:
            conn.close()
    return {
        "ok": True,
        "recordId": record_id,
        "metadata": confirmed,
        "reviewStatus": "human_confirmed",
        "reviewer": reviewer,
        "confirmedAt": now,
        "note": "已由義工確認；前端會把 metadata 回寫到 /api/records，主應用錄音卡會顯示標籤。",
    }


@router.get("/reviews")
async def list_reviews():
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT record_id, suggested_json, confirmed_json, status, classifier, reviewer, updated_at
               FROM metadata_reviews ORDER BY updated_at DESC"""
        ).fetchall()
    finally:
        conn.close()
    return {"reviews": [{
        "recordId": r[0], "suggested": json.loads(r[1]),
        "confirmed": json.loads(r[2]) if r[2] else None,
        "status": r[3], "classifier": r[4], "reviewer": r[5], "updatedAt": r[6],
    } for r in rows], "count": len(rows)}


# ---------------------------------------------------------------------------
# 方案 1：問答廣場（只有「問題」一種結構化互動）
# ---------------------------------------------------------------------------

@router.get("/questions")
async def list_questions():
    conn = _connect()
    try:
        rows = conn.execute(
            """SELECT id, village, question, status, created_at, answer_record_id,
                      answer_timestamp, answer_citation, answered_at
               FROM questions ORDER BY created_at DESC"""
        ).fetchall()
    finally:
        conn.close()
    return {"questions": [{
        "id": r[0], "village": r[1], "question": r[2], "status": r[3],
        "createdAt": r[4], "answerRecordId": r[5], "answerTimestamp": r[6],
        "answerCitation": r[7], "answeredAt": r[8],
    } for r in rows], "count": len(rows),
        "rules": ["只有「問題」一種互動", "無資訊流／點讚／追蹤／留言", "聲音回答必須附錄音出處"]}


@router.post("/questions")
async def create_question(request: Request):
    data = await _body(request)
    question = str(data.get("question") or "").strip()
    village = str(data.get("village") or "").strip() or "未指定村落"
    if len(question) < 4 or len(question) > 200:
        raise HTTPException(status_code=400, detail="問題需為 4–200 字")
    qid = "Q-" + uuid.uuid4().hex[:10]
    now = _now()
    with _lock:
        conn = _connect()
        try:
            conn.execute(
                """INSERT INTO questions (id, village, question, status, created_at)
                   VALUES (?, ?, ?, 'open', ?)""",
                (qid, village, question, now),
            )
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "question": {"id": qid, "village": village, "question": question,
                                     "status": "open", "createdAt": now}}


@router.post("/questions/{qid}/answer")
async def answer_question(qid: str, request: Request):
    """聲音回答：只可關聯一條已保存嘅錄音，並附時間戳出處。"""
    data = await _body(request)
    record_id = str(data.get("recordId") or "")
    if not record_id:
        raise HTTPException(status_code=400, detail="需要 recordId")
    if not _record_exists(record_id):
        raise HTTPException(
            status_code=404,
            detail="回答必須來自已保存並授權嘅錄音；搵唔到呢條 recordId。",
        )
    timestamp = max(0.0, float(data.get("timestamp") or 0))
    citation = f"Source: [{record_id}] at {_fmt_ts(timestamp)}"
    now = _now()
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute(
                """UPDATE questions SET status='answered', answer_record_id=?,
                   answer_timestamp=?, answer_citation=?, answered_at=? WHERE id=?""",
                (record_id, timestamp, citation, now, qid),
            )
            conn.commit()
        finally:
            conn.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="搵唔到呢條問題")
    return {"ok": True, "id": qid, "citation": citation,
            "note": "回答仍然只由已錄製逐字稿組成，並附原音出處；未新增任何社交功能。"}


@router.delete("/questions/{qid}")
async def delete_question(qid: str):
    with _lock:
        conn = _connect()
        try:
            cur = conn.execute("DELETE FROM questions WHERE id=?", (qid,))
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "id": qid, "removed": cur.rowcount > 0}


# ---------------------------------------------------------------------------
# 方案 2：清拆時鐘（示意資料層）
# ---------------------------------------------------------------------------

@router.get("/timeline")
async def get_timeline():
    return ILLUSTRATIVE_TIMELINE


@router.get("/summary")
async def get_summary():
    conn = _connect()
    try:
        cards = conn.execute("SELECT COUNT(*) FROM card_selections").fetchone()[0]
        pending = conn.execute(
            "SELECT COUNT(*) FROM metadata_reviews WHERE status='pending'"
        ).fetchone()[0]
        confirmed = conn.execute(
            "SELECT COUNT(*) FROM metadata_reviews WHERE status='human_confirmed'"
        ).fetchone()[0]
        open_q = conn.execute("SELECT COUNT(*) FROM questions WHERE status='open'").fetchone()[0]
        answered_q = conn.execute("SELECT COUNT(*) FROM questions WHERE status='answered'").fetchone()[0]
    finally:
        conn.close()
    return {
        "cardsAvailable": len(QUESTION_CARDS), "cardSelections": cards,
        "metadataPending": pending, "metadataConfirmed": confirmed,
        "questionsOpen": open_q, "questionsAnswered": answered_q,
        "timelineVerified": False,
        "geminiConfigured": bool(os.environ.get("GEMINI_API_KEY")),
        "mode": "測試線／支線，未匯流主線",
    }
