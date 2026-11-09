"""把 data/stories.json 的逐字稿匯出成 Word 腳本，供真人補錄使用。

用法：
    python tools/export_story_scripts_docx.py

輸出：
    docs/voice-scripts/Voices_of_the_North_Story_Scripts.docx

紅線：腳本只重排 segments[].text，不改寫、不新增台詞；沒有音檔的故事如實
標示「未附音檔」，不合成假音檔。
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "data" / "stories.json"
OUT = ROOT / "docs" / "voice-scripts" / "Voices_of_the_North_Story_Scripts.docx"

FOREST = RGBColor(0x2C, 0x57, 0x42)
MUTED = RGBColor(0x5D, 0x70, 0x63)

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
LANG_LABEL = {"yue": "粵語", "zh": "華語（國語）", "en": "English"}


def stamp(seconds: float) -> str:
    safe = max(0, int(float(seconds)))
    return f"{safe // 60:02d}:{safe % 60:02d}"


def set_cell_shading(cell, hex_color: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    tc_pr.append(shd)


def set_cell_text(cell, text: str, bold: bool = False, size: int = 9) -> None:
    cell.text = ""
    paragraph = cell.paragraphs[0]
    run = paragraph.add_run(str(text))
    run.bold = bold
    run.font.size = Pt(size)
    run.font.name = "Arial"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")


def add_table(document: Document, headers: list[str], rows: list[list[str]], widths: list[float]):
    table = document.add_table(rows=1, cols=len(headers))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for index, header in enumerate(headers):
        cell = table.rows[0].cells[index]
        set_cell_text(cell, header, bold=True, size=9)
        set_cell_shading(cell, "EAF0E5")
        cell.width = Cm(widths[index])
    header_props = table.rows[0]._tr.get_or_add_trPr()
    repeat_header = OxmlElement("w:tblHeader")
    repeat_header.set(qn("w:val"), "true")
    header_props.append(repeat_header)
    for row in rows:
        cells = table.add_row().cells
        for index, value in enumerate(row):
            set_cell_text(cells[index], value)
            cells[index].width = Cm(widths[index])
    for row in table.rows:
        row_props = row._tr.get_or_add_trPr()
        cant_split = OxmlElement("w:cantSplit")
        row_props.append(cant_split)
    return table


def style_document(document: Document) -> None:
    normal = document.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.35

    for name, size in (("Title", 24), ("Heading 1", 16), ("Heading 2", 12.5)):
        style = document.styles[name]
        style.font.name = "Arial"
        style.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
        style.font.size = Pt(size)
        style.font.color.rgb = FOREST
        style.font.bold = True

    section = document.sections[0]
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.1)
    section.right_margin = Cm(2.1)


def add_footer(document: Document) -> None:
    paragraph = document.sections[0].footer.paragraphs[0]
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run("Voices of the North・北區之聲　｜　示範腳本，非真實長者訪談")
    run.font.size = Pt(8)
    run.font.color.rgb = MUTED
    run.font.name = "Arial"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")


def build() -> Document:
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    stories = data.get("stories") or []
    with_audio = sum(1 for story in stories if story.get("audio"))
    languages = {}
    for story in stories:
        key = story.get("languageKey") or "other"
        languages[key] = languages.get(key, 0) + 1

    document = Document()
    style_document(document)
    add_footer(document)

    title = document.add_heading("「北區之聲」故事文字腳本", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.LEFT
    subtitle = document.add_paragraph()
    run = subtitle.add_run(
        f"共 {len(stories)} 則示範故事　｜　{len(languages)} 種語言　｜　"
        f"已附音檔 {with_audio} 則、待補錄 {len(stories) - with_audio} 則"
    )
    run.font.size = Pt(11)
    run.font.color.rgb = MUTED
    run.font.name = "Arial"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")
    meta = document.add_paragraph(
        f"資料版本：{data.get('contentVersion', '—')}　｜　"
        f"生成日期：{date.today().isoformat()}　｜　"
        f"來源：data/stories.json（單一資料來源）"
    )
    meta.runs[0].font.size = Pt(9)
    meta.runs[0].font.color.rgb = MUTED

    warning = document.add_paragraph()
    warning.paragraph_format.space_before = Pt(6)
    warning.paragraph_format.space_after = Pt(10)
    warning_text = warning.add_run(
        "誠實聲明：以下全部是團隊撰寫的「角色扮演示範故事」，不是真實長者訪談，"
        "也不代表任何真實人物。補錄時請依照逐字稿原句錄音，不要為了遷就音檔而改寫台詞；"
        "若真實長者受訪，必須先簽署知情同意，並另行建立 consentRef。"
    )
    warning_text.font.size = Pt(9.5)
    warning_text.font.bold = True
    warning_text.font.color.rgb = RGBColor(0x8E, 0x3B, 0x2E)

    document.add_heading("一、故事總表", level=1)
    rows = []
    for index, story in enumerate(stories, 1):
        rows.append([
            str(index),
            story.get("id", ""),
            story.get("title", ""),
            story.get("location", {}).get("area", story.get("villageKey", "")),
            str(story.get("year", "")),
            LANG_LABEL.get(story.get("languageKey"), story.get("languageKey", "")),
            f"{float(story.get('durationSec') or 0):.1f}s",
            "已附音檔" if story.get("audio") else "未附音檔（待補錄）",
        ])
    add_table(
        document,
        ["#", "ID", "標題", "村落／地區", "年份", "語言", "時長", "音檔"],
        rows,
        [0.7, 1.8, 4.6, 2.2, 1.1, 2.0, 1.4, 2.8],
    )

    stat = document.add_paragraph()
    stat.paragraph_format.space_before = Pt(6)
    lang_text = "、".join(
        f"{LANG_LABEL.get(key, key)} {count} 則" for key, count in sorted(languages.items())
    )
    stat.add_run(f"語言分佈：{lang_text}。").font.size = Pt(9.5)
    stat.add_run("所有故事均為 community 示範範圍，已標記 authorized 與 consentRef。").font.size = Pt(9.5)

    document.add_heading("二、逐則腳本", level=1)

    for index, story in enumerate(stories, 1):
        duration = float(story.get("durationSec") or 0)
        has_audio = bool(story.get("audio"))
        heading = document.add_heading(
            f"{index:02d} · {story.get('id', '')}　{story.get('title', '')}", level=1
        )
        heading.paragraph_format.space_before = Pt(10)
        heading.paragraph_format.keep_with_next = True
        if story.get("titleEn"):
            english = document.add_paragraph()
            english_run = english.add_run(story["titleEn"])
            english_run.italic = True
            english_run.font.size = Pt(10)
            english_run.font.color.rgb = MUTED
            english_run.font.name = "Arial"
            english_run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft JhengHei")

        add_table(
            document,
            ["村落／地區", "年代", "類型", "心情", "語言", "時長", "音檔狀態"],
            [[
                str(story.get("location", {}).get("area", story.get("villageKey", ""))),
                f"{story.get('year', '')}（{story.get('eraKey', '')}）",
                TYPE_LABEL.get(story.get("storyType"), str(story.get("storyType", ""))),
                MOOD_LABEL.get(story.get("mood"), str(story.get("mood", ""))),
                LANG_LABEL.get(story.get("languageKey"), str(story.get("languageKey", ""))),
                f"{duration:.1f}s",
                "已附音檔" if has_audio else "未附音檔（待補錄）",
            ]],
            [2.4, 2.2, 2.4, 2.8, 2.0, 1.3, 3.3],
        )

        detail = document.add_paragraph()
        detail.paragraph_format.space_before = Pt(4)
        detail.add_run("講者（角色扮演示範）：").bold = True
        detail.add_run(str(story.get("teller", "")))
        detail.add_run("　｜　授權：").bold = True
        detail.add_run(str(story.get("consentRef", "")))
        detail.add_run("　｜　分享範圍：").bold = True
        detail.add_run(str(story.get("scope", "")))
        if has_audio:
            detail.add_run("　｜　音檔：").bold = True
            detail.add_run(str(story.get("audio")))
        for run in detail.runs:
            run.font.size = Pt(9)

        segment_rows = []
        for seg_index, segment in enumerate(story.get("segments") or [], 1):
            start = float(segment.get("start") or 0)
            end = float(segment.get("end") or 0)
            segment_rows.append([
                str(seg_index),
                f"{stamp(start)}–{stamp(end)}",
                f"{end - start:.1f}s",
                str(segment.get("text") or ""),
            ])
        add_table(
            document,
            ["段", "時間軸", "長度", "台詞（照稿錄音）"],
            segment_rows,
            [0.8, 2.4, 1.3, 12.0],
        )

        note = document.add_paragraph()
        note.paragraph_format.space_before = Pt(4)
        mood_note = MOOD_LABEL.get(story.get("mood"), "語速自然")
        note.add_run("錄音提示：").bold = True
        note.add_run(
            f"{mood_note}；全段目標 {duration:.1f} 秒，段與段之間依時間軸留白。"
            "關鍵詞保留原音，不要另加旁白。"
        )
        for run in note.runs:
            run.font.size = Pt(9)
            run.font.color.rgb = MUTED

    document.add_heading("三、補錄與同意驗收清單", level=1)
    checklist = [
        "確認講者已閱讀並簽署知情同意書，consentRef 已寫入 data/stories.json。",
        "錄音前說明用途、分享範圍（私人／家人／社區／公開）與撤回權利。",
        "使用同一支麥克風、同一環境音量；每則分開錄，避免剪接。",
        "照稿錄音；如講者自然改口，以講者原話為準，並同步更新逐字稿，不可事後改寫。",
        "錄好後實測 WAV 長度，更新 durationSec 與 durationSource=measured。",
        "重跑 python tools/build_frontend.py，確認時間戳沒有超出音檔長度。",
        "只有在取得真實授權後，才把故事由「角色扮演示範」改為真實訪談標記。",
    ]
    for item in checklist:
        paragraph = document.add_paragraph(item, style="List Bullet")
        for run in paragraph.runs:
            run.font.size = Pt(10)

    document.add_heading("四、真實錄音登記表", level=1)
    register_rows = []
    for story in stories:
        register_rows.append([
            story.get("id", ""),
            story.get("title", ""),
            "",
            "",
            "",
            "",
        ])
    add_table(
        document,
        ["故事 ID", "標題", "錄音日期", "講者／見證人", "實測長度", "備註"],
        register_rows,
        [1.9, 4.8, 2.1, 3.1, 1.9, 2.6],
    )
    note = document.add_paragraph(
        "此表只作現場登記；完成後把資料回填 data/stories.json，並重新建置單檔。"
    )
    note.runs[0].font.size = Pt(9)
    note.runs[0].font.color.rgb = MUTED

    return document


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    document = build()
    document.save(OUT)

    check = Document(OUT)
    headings = [p.text for p in check.paragraphs if p.style.name == "Heading 1"]
    story_headings = [h for h in headings if "·" in h]
    data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    expected = len(data.get("stories") or [])
    if len(story_headings) != expected:
        raise SystemExit(f"DOCX 故事章節數 {len(story_headings)} 與資料 {expected} 不符")
    print(f"已產生 {OUT.relative_to(ROOT)} — {expected} 則故事、{len(check.tables)} 個表格")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
