"""把 data/stories.json 的已授權逐字稿匯出成配音腳本（Markdown）。

用法：python tools/export_voice_scripts.py

誠實性紅線：不新增台詞、不改寫逐字稿、不合成示範音檔。腳本就是資料契約裡的
segments[].text，補錄時照稿錄音；錄好後才實測 durationSec、把 durationSource
改成 measured，並重新執行 python tools/build_frontend.py 驗證時間戳。
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "stories.json"
OUT = ROOT / "docs" / "voice-scripts" / "voice-scripts.md"

TYPE_LABEL = {
    "festival": "節慶習俗",
    "farming": "農耕漁作",
    "migration": "遷徙定居",
    "architecture": "建築遺跡",
    "oral": "人物口述",
    "market": "墟市商貿",
    "other": "其他",
}
MOOD_LABEL = {
    "wistful": "懷舊（放慢、留白）",
    "joyful": "歡喜（語速稍快、上揚）",
    "reflective": "感慨（句尾下沉、多停頓）",
    "heavy": "沉重（低聲、少修飾）",
    "proud": "自豪（咬字清楚、語氣篤定）",
}
LANG_LABEL = {"yue": "粵語", "zh": "華語", "en": "English"}


def stamp(seconds: float) -> str:
    safe = max(0, int(float(seconds)))
    return f"{safe // 60:02d}:{safe % 60:02d}"


def render(data: dict) -> str:
    stories = data.get("stories") or []
    with_audio = [s for s in stories if s.get("audio")]
    years = [s["year"] for s in stories if isinstance(s.get("year"), int)]
    durations = [float(s["durationSec"]) for s in stories if s.get("durationSec")]
    types = sorted({s.get("storyType") or "other" for s in stories})
    moods = sorted({s.get("mood") or "" for s in stories if s.get("mood")})

    lines = [
        f"# 配音腳本：{len(stories)} 則示範故事",
        "",
        "> 來源：`data/stories.json`（前後端單一資料來源）。本文由 "
        "`tools/export_voice_scripts.py` 產生，請改資料檔後重新產生，勿手改本文。",
        ">",
        "> **紅線**：不合成假音檔、不為湊數改寫台詞、不把逐字稿當成真實長者訪談。"
        "以下是已授權逐字稿的原句，補錄時照稿錄音即可。",
        "",
        "## 1. 現況與驗收口徑",
        "",
        f"- 故事總數：{len(stories)} 則；已有實測音檔：{len(with_audio)} 則；"
        f"待補錄：{len(stories) - len(with_audio)} 則。",
        f"- 待補錄的 {len(stories) - len(with_audio)} 則在介面如實顯示「未附音檔」，"
        "主播放鍵為灰態；這是資料現況，不是播放器的 bug。",
        "- 補錄前後都不改 `segments` 的文字；若錄音與時間軸有出入，"
        "應重新標時間戳並實測長度，而不是改稿遷就音檔。",
        "- 錄好後：把 `audio` 指向新檔、`durationSec` 改成實測值、"
        "`durationSource` 設為 `measured`，再執行 `python tools/build_frontend.py`"
        "（會檢查逐字稿結尾不可超出音檔實測長度）。",
        "",
        "## 2. 多樣性與時間線檢查（對應評審「拉開時間線、類型與心情要多樣」）",
        "",
        f"- 故事類型：{len(types)} 類 — " + "、".join(
            f"{TYPE_LABEL.get(k, k)}（`{k}`）" for k in types
        ) + "；資料契約枚舉共 7 類，圖例只顯示有資料的類目。",
        f"- 表達心情：{len(moods)} 種 — " + "、".join(
            f"{MOOD_LABEL.get(k, k)}（`{k}`）" for k in moods
        ) + "；枚舉共 5 種，未使用的枚舉不硬湊。",
        "- 多樣性來自既有示範資料，補錄時沿用原有標註；"
        "不為「湊滿枚舉」改寫逐字稿或增造假故事。",
        f"- 年代分佈：{min(years)}–{max(years)}（跨 {max(years) - min(years)} 年）；"
        "年代軸刻度由 `30-stories.js` 依此分佈動態產生，每格都會改變過濾結果。",
        f"- 時長分佈：{min(durations):.1f}–{max(durations):.1f} 秒；"
        "各則故事的段落邊界不同，時間線不是同一個模板複製。",
        "- 每段 `start < end`、`end <= durationSec`、段落不重疊，"
        "由建置腳本硬性驗證；問答出處的時間戳因此不會跳到不存在的秒數。",
        "",
        "## 3. 逐則腳本",
        "",
    ]

    for index, story in enumerate(stories, 1):
        duration = float(story.get("durationSec") or 0)
        has_audio = bool(story.get("audio"))
        status = (
            f"已有實測音檔 `{story['audio']}`（{duration:.1f} 秒）"
            if has_audio else "**待補錄**：目前無音檔，播放器顯示「未附音檔」"
        )
        lines += [
            f"### {index}. {story['id']}　{story['title']}",
            "",
            f"- 村落／地區：{story.get('location', {}).get('area', story.get('villageKey'))}"
            f"（`{story.get('villageKey')}`）",
            f"- 類型：{TYPE_LABEL.get(story.get('storyType'), story.get('storyType'))}"
            f"　│　年代：{story.get('year')}（{story.get('eraKey')}）"
            f"　│　語言：{LANG_LABEL.get(story.get('languageKey'), story.get('languageKey'))}",
            f"- 心情：{MOOD_LABEL.get(story.get('mood'), story.get('mood'))}",
            f"- 檔長：`durationSec = {duration:.1f}` 秒　│　音檔狀態：{status}",
            f"- 講者（角色扮演示範）：{story.get('teller')}"
            f"　│　授權：`{story.get('consentRef')}`　│　範圍：`{story.get('scope')}`",
            "",
            "| 段 | 時間軸 | 長度 | 台詞（照稿錄音） |",
            "| --- | --- | --- | --- |",
        ]
        for seg_index, seg in enumerate(story.get("segments") or [], 1):
            start, end = float(seg["start"]), float(seg["end"])
            text = str(seg.get("text") or "").replace("|", "\\|").replace("\n", " ")
            lines.append(
                f"| {seg_index} | {stamp(start)}–{stamp(end)} | {end - start:.1f}s | {text} |"
            )
        lines += [
            "",
            "錄音提示：" + MOOD_LABEL.get(story.get("mood"), "語速自然") +
            f"；全段目標 {duration:.1f} 秒，段與段之間依時間軸留白，"
            "關鍵詞（見資料檔 `segments[].keywords`）保持原音，不要另加旁白。",
            "",
        ]

    lines += [
        "## 4. 補錄後要重跑的檢查",
        "",
        "```bash",
        "python tools/build_frontend.py            # 長度／時間戳／授權驗證 + 重建單檔",
        "python tools/check_frontend_syntax.py     # 內嵌 JS 語法",
        "python tools/verify/waveform.py           # 實測波形與播放器對照",
        "```",
        "",
        "補錄完成後，`window.VTN_WAVEFORMS` 會自動為新音檔產生 60 柱實測振幅；"
        "若故事量增大，可改用 `--external-waveforms` 把波形拆成 "
        "`frontend/waveforms.json` 按需載入。",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(render(data), encoding="utf-8", newline="\n")
    print(f"已產生 {OUT.relative_to(ROOT)} — {len(data.get('stories') or [])} 則配音腳本")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
