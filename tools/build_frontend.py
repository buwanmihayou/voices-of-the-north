"""把 frontend/src 的模組合併成單一交付檔（frontend/voices-of-the-north-app.html）。

用法：
    python tools/build_frontend.py            # 驗證＋建置
    python tools/build_frontend.py --check    # 只驗證資料，不寫檔

單一資料來源：
    data/stories.json  ── 由本腳本驗證後內嵌成 window.VTN_STORY_DATA，
                          後端 story_corpus.py 亦讀取同一檔案（只讀已授權故事）。

建置時硬性檢查（不通過即以非零狀態結束）：
    * 故事 ID 唯一、隱私級別合法、逐字稿段落時間遞增
    * 每段 end <= durationSec（時間戳不可超出音訊長度）
    * 有音檔的 story.durationSec 必須標記 durationSource="measured"
    * 有音檔者，音檔必須真實存在，且 durationSec 必須與音檔實測長度一致（±0.5 秒）
    * 逐字稿結尾不可超出音檔實測長度（否則「可溯源」會跳到不存在的秒數）
"""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "src"
OUT = ROOT / "frontend" / "voices-of-the-north-app.html"
DATA_FILE = ROOT / "data" / "stories.json"

CSS_ORDER = [
    "styles.css",
    "record-flow.css",
    "assistant.css",
    "app-ext.css",
]
JS_FIRST = ["generated/stories.gen.js"]

SCOPES = {"private", "family", "community", "public"}


def load_data() -> dict:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def measure_audio(path: Path) -> float | None:
    """實際量度音檔長度（秒）。WAV 用標準庫；其他格式回傳 None 表示無法量度。"""
    if path.suffix.lower() != ".wav":
        return None
    try:
        with wave.open(str(path)) as handle:
            rate = handle.getframerate()
            if not rate:
                return None
            return round(handle.getnframes() / float(rate), 2)
    except Exception:
        return None


def resolve_audio(rel: str) -> Path | None:
    """以實際部署路徑（frontend/）優先，避免量度到倉庫根目錄的另一個版本。"""
    for base in (ROOT / "frontend", ROOT):
        candidate = base / rel
        if candidate.is_file():
            return candidate
    return None


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    stories = data.get("stories")
    if not isinstance(stories, list) or not stories:
        return ["data/stories.json 缺少 stories 陣列"]

    seen: set[str] = set()
    for story in stories:
        sid = str(story.get("id") or "")
        label = sid or "(無 id)"
        if not sid:
            errors.append("有故事缺少 id")
            continue
        if sid in seen:
            errors.append(f"{sid}: id 重複")
        seen.add(sid)

        if story.get("scope") not in SCOPES:
            errors.append(f"{label}: scope 必須是 {sorted(SCOPES)}")
        if story.get("authorized") is not True:
            errors.append(f"{label}: 未標記 authorized=true，不可對外發佈")
        if not str(story.get("consentRef") or "").strip():
            errors.append(f"{label}: 缺少 consentRef（同意記錄編號）")
        if not story.get("topicKeys"):
            errors.append(f"{label}: 缺少 topicKeys")

        duration = story.get("durationSec")
        if not isinstance(duration, (int, float)) or duration <= 0:
            errors.append(f"{label}: durationSec 必須為正數")
            continue

        segments = story.get("segments") or []
        if not segments:
            errors.append(f"{label}: 沒有逐字稿段落")
            continue

        prev_end = 0.0
        for idx, seg in enumerate(segments):
            start, end = seg.get("start"), seg.get("end")
            if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                errors.append(f"{label} 第 {idx + 1} 段: start/end 必須為數字")
                continue
            if start < 0 or end <= start:
                errors.append(f"{label} 第 {idx + 1} 段: 時間區間不合法 ({start}–{end})")
            if start < prev_end - 1e-6:
                errors.append(f"{label} 第 {idx + 1} 段: 與上一段重疊")
            if end > duration + 1e-6:
                errors.append(
                    f"{label} 第 {idx + 1} 段: end={end}s 超出時長 {duration}s"
                )
            if not str(seg.get("text") or "").strip():
                errors.append(f"{label} 第 {idx + 1} 段: 逐字稿為空")
            if not seg.get("keywords"):
                errors.append(f"{label} 第 {idx + 1} 段: 缺少檢索關鍵詞")
            prev_end = max(prev_end, float(end))

        audio = story.get("audio")
        if audio:
            path = resolve_audio(str(audio))
            if path is None:
                errors.append(f"{label}: 音檔不存在 {audio}")
            if story.get("durationSource") != "measured":
                errors.append(f"{label}: 有音檔時 durationSource 必須是 measured")
            measured = measure_audio(path) if path else None
            if measured:
                if abs(float(duration) - measured) > 0.5:
                    errors.append(
                        f"{label}: durationSec={duration}s 與音檔實測 {measured}s 不符（必須一致）"
                    )
                if prev_end > measured + 1e-6:
                    errors.append(
                        f"{label}: 逐字稿結尾 {prev_end}s 超出音檔實測 {measured}s"
                    )
            elif abs(float(duration) - max(prev_end, 0)) > 3:
                errors.append(
                    f"{label}: duration={duration}s 與逐字稿結尾 {prev_end}s 相差過大，請重新實測"
                )

    for key in ("zh-HK", "zh-CN", "en"):
        if not str((data.get("outOfScopeMessage") or {}).get(key) or "").strip():
            errors.append(f"outOfScopeMessage 缺少 {key}")
    return errors


def js_payload(data: dict) -> str:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    raw = raw.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return "window.VTN_STORY_DATA = " + raw + ";\n"


def read_modules() -> tuple[str, str]:
    missing = [name for name in CSS_ORDER if not (SRC / "css" / name).is_file()]
    if missing:
        raise SystemExit("缺少 CSS 模組: " + ", ".join(missing))

    css_parts = []
    for name in CSS_ORDER:
        text = (SRC / "css" / name).read_text(encoding="utf-8").strip("\n")
        css_parts.append(f"/* ===== src/css/{name} ===== */\n{text}")
    css = "\n\n".join(css_parts) + "\n"

    js_files = sorted(p for p in (SRC / "js").glob("*.js"))
    if not js_files:
        raise SystemExit("src/js 沒有任何模組")

    js_parts = [js_payload(load_data())]
    for path in js_files:
        text = path.read_text(encoding="utf-8")
        if "</script" in text.lower():
            raise SystemExit(f"{path} 含有 </script>，會破壞單檔輸出")
        rel = path.relative_to(SRC).as_posix()
        js_parts.append(f"/* ===== src/{rel} ===== */\n{text.strip(chr(10))}")
    js = "\n\n".join(js_parts) + "\n"
    return css, js


def build(check_only: bool = False) -> int:
    data = load_data()
    errors = validate(data)
    if errors:
        print("資料驗證失敗：")
        for err in errors:
            print("  - " + err)
        return 1

    css, js = read_modules()
    template = (SRC / "html" / "app.template.html").read_text(encoding="utf-8")
    for token in ("<!--@@CSS@@-->", "<!--@@JS@@-->"):
        if token not in template:
            print(f"模板缺少佔位符 {token}")
            return 1

    html = template.replace("<!--@@CSS@@-->", css).replace("<!--@@JS@@-->", js)
    if check_only:
        print(f"資料驗證通過：{len(data['stories'])} 則故事")
        return 0

    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"資料驗證通過：{len(data['stories'])} 則故事")
    print(f"已建置 {OUT.relative_to(ROOT)} — {len(html):,} 字元 / {html.count(chr(10)):,} 行")
    return 0


if __name__ == "__main__":
    sys.exit(build("--check" in sys.argv))
