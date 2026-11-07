"""把 frontend/src 的模組合併成單一交付檔（frontend/voices-of-the-north-app.html）。

用法：
    python tools/build_frontend.py                      # 驗證＋建置（波形內嵌單檔）
    python tools/build_frontend.py --check             # 只驗證資料，不寫檔
    python tools/build_frontend.py --external-waveforms # 波形改由 waveforms.json 按需載入

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

import array
import json
import math
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
    "story-map.css",
]
JS_FIRST = ["generated/stories.gen.js"]

SCOPES = {"private", "family", "community", "public"}

# 地圖一級資訊（見 docs 的 PRD 辯證：六類之外補「墟市商貿」，因為北區故事
# 大量圍繞趁墟、米舖、蠔田買賣，硬塞進「其他」會令地圖失去辨識度）。
STORY_TYPES = {"festival", "farming", "migration", "architecture", "oral", "market", "other"}
MOODS = {"wistful", "joyful", "reflective", "heavy", "proud"}


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


def validate(data: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    stories = data.get("stories")
    if not isinstance(stories, list) or not stories:
        return ["data/stories.json 缺少 stories 陣列"], warnings

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

        # 地圖一級資訊：缺欄位只警告（舊資料向後兼容），枚舉錯值即失敗。
        story_type = story.get("storyType")
        if story_type is None:
            warnings.append(f"{label}: 缺少 storyType，地圖暫以 other 呈現")
        elif story_type not in STORY_TYPES:
            errors.append(f"{label}: storyType={story_type!r} 不在 {sorted(STORY_TYPES)}")
        mood = story.get("mood")
        if mood is None:
            warnings.append(f"{label}: 缺少 mood，詳情頁不顯示心情標籤")
        elif mood not in MOODS:
            errors.append(f"{label}: mood={mood!r} 不在 {sorted(MOODS)}")
        year = story.get("year")
        if year is None:
            warnings.append(f"{label}: 缺少 year，年代軸會略過此故事")
        elif not isinstance(year, int) or not (1900 <= year <= 2026):
            errors.append(f"{label}: year={year!r} 必須是 1900–2026 的整數")

        if story.get("scope") != "private":
            loc = story.get("location") or {}
            lat, lng = loc.get("lat"), loc.get("lng")
            radius = loc.get("radiusM")
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
                errors.append(f"{label}: 非私人故事必須有 location.lat / location.lng")
            elif not (22.1 <= lat <= 22.7 and 113.8 <= lng <= 114.5):
                errors.append(f"{label}: location 不在香港範圍內（{lat}, {lng}）")
            if not isinstance(radius, (int, float)) or radius < 100:
                errors.append(f"{label}: location.radiusM 必須 ≥100，模糊定位不可收窄")

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
    return errors, warnings


WAVE_BARS = 60
WAVE_TARGET_RATE = 8000
WAVE_JSON_NAME = "waveforms.json"
WAVE_FILE = ROOT / "frontend" / WAVE_JSON_NAME


def _pcm_channel0(handle) -> tuple[list[float], int] | None:
    """讀單聲道（第 0 聲道）正規化 PCM，與前端 getChannelData(0) 對齊。"""
    width = handle.getsampwidth()
    channels = handle.getnchannels()
    rate = handle.getframerate()
    raw = handle.readframes(handle.getnframes())
    if width not in (1, 2) or channels < 1 or not rate or not raw:
        return None
    if width == 2:
        pcm = array.array("h")
        pcm.frombytes(raw[: len(raw) // 2 * 2])
        if sys.byteorder != "little":
            pcm.byteswap()
        values = [pcm[i] / 32768.0 for i in range(0, len(pcm) - channels + 1, channels)]
    else:
        values = [(raw[i] - 128.0) / 128.0
                  for i in range(0, len(raw) - channels + 1, channels)]
    return values, rate


def waveform_peaks(path: Path) -> list[float] | None:
    """由 WAV 實測振幅；與前端 28-waveform.js 共用 8 kHz 重採樣網格。

    兩條路徑都先把各自取樣率的 PCM 線性插值到 8 kHz，再切成 60 柱算
    RMS + 峰值，因此相關係數接近 1，不再受 AudioContext 取樣率影響。
    """
    try:
        with wave.open(str(path), "rb") as handle:
            pcm = _pcm_channel0(handle)
    except Exception:
        return None
    if pcm is None:
        return None
    values, rate = pcm
    total = len(values)
    if total < WAVE_BARS:
        return None

    count = max(WAVE_BARS, round(total / rate * WAVE_TARGET_RATE))
    ratio = rate / WAVE_TARGET_RATE
    samples: list[float] = []
    for i in range(count):
        pos = i * ratio
        lo = int(pos)
        frac = pos - lo
        a = values[lo] if lo < total else 0.0
        b = values[lo + 1] if lo + 1 < total else a
        samples.append(a + (b - a) * frac)

    bars: list[float] = []
    for bar in range(WAVE_BARS):
        start = bar * count // WAVE_BARS
        end = min(count, max(start + 1, (bar + 1) * count // WAVE_BARS))
        square_sum = 0.0
        peak = 0.0
        n = 0
        for i in range(start, end):
            v = samples[i]
            square_sum += v * v
            av = abs(v)
            if av > peak:
                peak = av
            n += 1
        rms = math.sqrt(square_sum / n) if n else 0.0
        bars.append(0.6 * rms + 0.4 * peak)

    maximum = max(bars) if bars else 0.0
    if maximum <= 0:
        return None
    return [round(min(1.0, (v / maximum) ** 0.85), 3) for v in bars]


def waveform_payload(
    data: dict, external: bool = False, write_json: bool = True
) -> tuple[str, int, int]:
    """把實測振幅內嵌進單檔，或改為按需載入外置 waveforms.json。

    回傳 (JS 片段, 故事數, JSON 位元組數)。JSON 一律輸出，方便部署切換。
    """
    baked: dict[str, list[float]] = {}
    for story in data.get("stories") or []:
        audio = story.get("audio")
        if not audio:
            continue
        path = resolve_audio(str(audio))
        if not path or path.suffix.lower() != ".wav":
            continue
        peaks = waveform_peaks(path)
        if peaks:
            baked[str(story.get("id"))] = peaks
    raw = json.dumps(baked, ensure_ascii=False, separators=(",", ":"))
    if write_json:
        WAVE_FILE.write_text(raw, encoding="utf-8", newline="\n")
    size = len(raw.encode("utf-8"))
    if external:
        return ("window.VTN_WAVEFORMS = {};\n"
                "window.VTN_WAVEFORMS_URL = '" + WAVE_JSON_NAME + "';\n",
                len(baked), size)
    return "window.VTN_WAVEFORMS = " + raw + ";\n", len(baked), size


def js_payload(data: dict, external: bool = False, write_json: bool = True) -> tuple[str, int, int]:
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    raw = raw.replace("</", "<\\/").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    waves, count, size = waveform_payload(data, external, write_json)
    return "window.VTN_STORY_DATA = " + raw + ";\n" + waves, count, size


def read_modules(external: bool = False, write_json: bool = True) -> tuple[str, str, int, int]:
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

    payload, wave_count, wave_bytes = js_payload(load_data(), external, write_json)
    js_parts = [payload]
    for path in js_files:
        text = path.read_text(encoding="utf-8")
        if "</script" in text.lower():
            raise SystemExit(f"{path} 含有 </script>，會破壞單檔輸出")
        rel = path.relative_to(SRC).as_posix()
        js_parts.append(f"/* ===== src/{rel} ===== */\n{text.strip(chr(10))}")
    js = "\n\n".join(js_parts) + "\n"
    return css, js, wave_count, wave_bytes


def build(check_only: bool = False, external_waveforms: bool = False) -> int:
    data = load_data()
    errors, warnings = validate(data)
    if warnings:
        print("資料提醒：")
        for warn in warnings:
            print("  ! " + warn)
    if errors:
        print("資料驗證失敗：")
        for err in errors:
            print("  - " + err)
        return 1

    css, js, wave_count, wave_bytes = read_modules(external_waveforms, not check_only)
    mode = "外置按需載入" if external_waveforms else "內嵌單檔"
    print(f"波形快取：{wave_count} 則故事 / {wave_bytes:,} bytes（8 kHz 統一取樣・{mode}）")
    if not check_only:
        print(f"已輸出 frontend/{WAVE_JSON_NAME}（{wave_bytes:,} bytes，供大規模部署切換）")
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
    sys.exit(build("--check" in sys.argv, "--external-waveforms" in sys.argv))
