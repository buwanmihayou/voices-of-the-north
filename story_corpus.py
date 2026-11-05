"""Voices of the North — 已錄製故事語料庫（後端同構版）。

單一資料來源：``data/stories.json``（前端建置時亦由同一檔案內嵌）。
本模組只做三件事：
  1. 讀取並按「授權 + 分享範圍 + 未撤回」過濾故事；
  2. 用段落關鍵詞檢索（中文無空格，故關鍵詞最少兩字）；
  3. 以段落原文組答案，並附時間戳出處；無命中即標準拒答。

誠實性紅線：
  * 答案只可由已授權逐字稿的段落原文組合而成，不呼叫外部知識；
  * 在範圍的答案必附至少一個帶時間戳的出處；
  * 時間戳一律不超出該故事的實測／標示時長；
  * 範圍外回傳對應介面語言的標準拒答句。
"""

from __future__ import annotations

import json
import os
import re
import threading
from collections import defaultdict
from pathlib import Path

DATA_PATH = Path(
    os.environ.get("VTN_STORY_DATA", str(Path(__file__).resolve().parent / "data" / "stories.json"))
)

DEFAULT_OUT_OF_SCOPE = {
    "zh-HK": "抱歉，錄製的故事中未包含此資訊。",
    "zh-CN": "抱歉，录制的故事中未包含此信息。",
    "en": "Sorry, the recorded stories do not contain this information.",
}

_PUNCT = re.compile(r"[？?！!。，,、：:；;（）()「」『』・·\s\"']")

_cache: dict = {"mtime": None, "data": None}
_lock = threading.Lock()


def load_data() -> dict:
    """讀取資料檔；檔案更新時自動重載（方便新增故事後重啟以外亦可生效）。"""
    global _cache
    try:
        mtime = DATA_PATH.stat().st_mtime
    except OSError:
        mtime = None
    with _lock:
        if _cache["data"] is not None and _cache["mtime"] == mtime:
            return _cache["data"]
        data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
        _cache = {"mtime": mtime, "data": data}
        return data


def out_of_scope_message(lang: str = "zh-HK") -> str:
    messages = load_data().get("outOfScopeMessage") or {}
    return messages.get(lang) or messages.get("zh-HK") or DEFAULT_OUT_OF_SCOPE["zh-HK"]


def all_stories() -> list[dict]:
    return list(load_data().get("stories") or [])


def normalize(text: str) -> str:
    return _PUNCT.sub("", str(text or "").lower())


def format_timestamp(sec: float) -> str:
    safe = max(0, int(float(sec or 0)))
    return f"{safe // 60:02d}:{safe % 60:02d}"


def _audio_url(story: dict):
    audio = story.get("audio")
    if not audio:
        return None
    return "/" + str(audio).lstrip("/")


def is_visible(
    story: dict,
    viewer_user: str | None = None,
    role: str = "visitor",
    excluded: set[str] | None = None,
) -> bool:
    """伺服器端的分享範圍過濾 —— 不只是前端隱藏。"""
    if not story or story.get("authorized") is not True:
        return False
    story_id = str(story.get("id") or "")
    if excluded and story_id in excluded:
        return False
    if role == "admin":
        return True

    scope = story.get("scope") or "private"
    owner = str(story.get("owner") or "").lower()
    viewer = str(viewer_user or "").lower()
    if owner and viewer and owner == viewer:
        return True
    if scope in ("public", "community"):
        return True
    if scope == "family" and owner and viewer and owner == viewer:
        return True
    return False


def visible_stories(
    viewer_user: str | None = None,
    role: str = "visitor",
    excluded: set[str] | None = None,
) -> list[dict]:
    return [s for s in all_stories() if is_visible(s, viewer_user, role, excluded)]


def make_citation(story: dict, segment: dict) -> dict:
    duration = float(story.get("durationSec") or 0)
    start = max(0.0, min(float(segment.get("start") or 0), duration or float("inf")))
    end = min(float(segment.get("end") or start), duration or float("inf"))
    return {
        "storyId": story["id"],
        "title": story.get("title") or "",
        "teller": story.get("teller") or "",
        "start": start,
        "end": end,
        "label": "Source: [" + str(story["id"]) + "] at " + format_timestamp(start),
    }


# 過於通用的詞：單獨命中不足以證明相關（否則「細個」會命中全部故事）
GENERIC_KEYWORDS = {
    "細個", "童年", "以前", "而家", "近排", "近年", "後來", "變化", "轉變",
    "生活", "朋友", "記憶", "特別", "環境", "鄉村", "鄉郊", "地方", "時間",
    "香港", "村民", "街坊", "傳統", "節慶", "故事", "聲音",
}


def _score_segment(question_norm: str, keywords: list[str]) -> float:
    """命中分數：具體關鍵詞 2 分，通用詞 0.5 分；只有通用詞時須命中兩個才算數。"""
    matched: list[str] = []
    score = 0.0
    for keyword in keywords or []:
        key = normalize(keyword)
        if len(key) < 2 or key not in question_norm:
            continue
        matched.append(key)
        score += 0.5 if key in GENERIC_KEYWORDS else 2.0
    if not matched:
        return 0.0
    if all(key in GENERIC_KEYWORDS for key in matched) and len(set(matched)) < 2:
        return 0.0
    return score


def retrieve_segments(question: str, stories: list[dict] | None = None) -> list[dict]:
    """段落關鍵詞命中；回傳 [{story, segment}]，時間戳先夾在時長之內。

    相關性：以具體關鍵詞為主；只命中通用詞的段落會被丟棄，免得「細個」
    這類詞令不相干的故事全部浮上來。多故事時只保留分數接近最高分的那些。
    """
    q = normalize(question)
    if not q:
        return []

    hits: list[dict] = []
    for story in stories if stories is not None else all_stories():
        duration = float(story.get("durationSec") or 0)
        for index, segment in enumerate(story.get("segments") or []):
            score = _score_segment(q, segment.get("keywords") or [])
            if score <= 0:
                continue
            if duration and float(segment.get("end") or 0) > duration + 0.001:
                continue
            hits.append({"story": story, "segment": segment, "score": score,
                         "index": index})

    if not hits:
        return []

    best = max(hit["score"] for hit in hits)
    threshold = max(1.0, best * 0.45)
    hits = [hit for hit in hits if hit["score"] >= threshold]

    # 同一故事只保留得分最高的段落群，避免答非所問的長篇拼接
    top_story = max(hits, key=lambda h: h["score"])["story"].get("id")
    if not any(normalize(s.get("title") or "") in q for s in all_stories()):
        story_scores: dict[str, float] = defaultdict(float)
        for hit in hits:
            story_scores[hit["story"]["id"]] += hit["score"]
        top_story = max(story_scores, key=story_scores.get)
        if story_scores[top_story] > 0:
            runner_up = sorted(story_scores.values(), reverse=True)
            if len(runner_up) > 1 and runner_up[0] > runner_up[1] * 1.6:
                hits = [hit for hit in hits if hit["story"]["id"] == top_story]

    # 同一故事內只保留最相關的段落（差距太大就不再拼接）
    grouped: dict[str, list[dict]] = defaultdict(list)
    for hit in hits:
        grouped[hit["story"]["id"]].append(hit)
    refined: list[dict] = []
    for group in grouped.values():
        top = max(hit["score"] for hit in group)
        refined.extend(hit for hit in group if hit["score"] >= top * 0.75)

    refined.sort(key=lambda h: (str(h["story"].get("id")), float(h["segment"].get("start") or 0)))
    return refined


def retrieve_answer(
    question: str,
    lang: str = "zh-HK",
    viewer_user: str | None = None,
    role: str = "visitor",
    excluded: set[str] | None = None,
) -> dict:
    stories = visible_stories(viewer_user, role, excluded)
    hits = retrieve_segments(question, stories)

    if not hits:
        return {
            "inScope": False,
            "answer": out_of_scope_message(lang),
            "sources": [],
            "demo": any(s.get("rolePlayed") for s in stories),
            "storyId": None,
            "mode": "server",
        }

    return {
        "inScope": True,
        "answer": " ".join(h["segment"]["text"] for h in hits),
        "sources": [make_citation(h["story"], h["segment"]) for h in hits],
        "demo": any(bool(h["story"].get("rolePlayed")) for h in hits),
        "storyId": hits[0]["story"]["id"],
        "mode": "server",
    }
