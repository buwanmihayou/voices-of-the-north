"""驗證「只提供淺色＋地圖引導＋故事擴充＋Word 腳本」這批改動。

執行：python tools/verify/light_onboarding.py
只檢查來源／資料：python tools/verify/light_onboarding.py --static
前置：python tools/build_frontend.py && python tools/export_story_scripts_docx.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "verify"))

DATA = json.loads((ROOT / "data" / "stories.json").read_text(encoding="utf-8"))
TEMPLATE = (ROOT / "frontend" / "src" / "html" / "app.template.html").read_text(encoding="utf-8")
SETTINGS = (ROOT / "frontend" / "src" / "js" / "55-settings.js").read_text(encoding="utf-8")
I18N = (ROOT / "frontend" / "src" / "js" / "05-i18n.js").read_text(encoding="utf-8")
DOCX = ROOT / "docs" / "voice-scripts" / "Voices_of_the_North_Story_Scripts.docx"
FAILURES: list[str] = []
CHECKS = 0


class Markup(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__()
        self.elements: list[tuple[str, dict[str, str | None]]] = []
        self.by_id: dict[str, tuple[str, dict[str, str | None]]] = {}
        self.feed(source)

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        attrs = dict(attributes)
        self.elements.append((tag, attrs))
        if attrs.get("id"):
            self.by_id[str(attrs["id"])] = (tag, attrs)

    handle_startendtag = handle_starttag


def check(label: str, ok: bool, detail: str = "") -> None:
    global CHECKS
    CHECKS += 1
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(label)


def static_checks() -> None:
    print("[static] 淺色／引導／故事／腳本")
    check("首頁預設淺色", '<html lang="zh-Hant-HK" data-theme="light"' in TEMPLATE)
    check("設定頁已移除主題入口", 'id="setTheme"' not in TEMPLATE)
    check("設定不再跟隨系統深色", "prefers-color-scheme" not in SETTINGS)
    check("舊深色設定會收回淺色", "prefs.theme = 'light'" in
          (ROOT / "frontend" / "src" / "js" / "10-store.js").read_text(encoding="utf-8"))
    check("離線文案改為「只檢索、無 AI 生成」", "離線模式：只從本機故事庫檢索" in I18N)
    # Check each translated step, rather than matching unrelated map copy.
    for key, samples in (
        ("onboard.step1Title", ("地圖", "地图", "Explore the story map")),
        ("onboard.step2Title", ("類型", "类型", "type")),
        ("onboard.step3Title", ("年代", "年代", "Try the era slider")),
    ):
        titles = re.findall(r"'" + re.escape(key) + r"'\s*:\s*'((?:\\.|[^'])*)'", I18N)
        check(f"三語引導步驟 {key}", len(titles) == 3 and
              all(sample.lower() in title.lower() for sample, title in zip(samples, titles)),
              str(titles))
    markup = Markup(TEMPLATE)
    card = markup.by_id.get("onboardCard", ("", {}))
    check("引導為可聚焦的非模態對話框", card[1].get("role") == "dialog" and
          card[1].get("aria-modal") == "false" and card[1].get("tabindex") == "-1")
    check("保留鍵盤可操作的上一步／跳過／下一步", all(
        markup.by_id.get(control, ("", {}))[0] == "button" and
        markup.by_id[control][1].get("type") == "button"
        for control in ("onboardBack", "onboardSkip", "onboardNext")))
    check("遮罩有真實透明目標孔", markup.by_id.get("onboardMask", ("", {}))[0] == "mask" and
          markup.by_id.get("onboardHole", ("", {}))[1].get("fill") == "black" and
          any(attrs.get("mask") == "url(#onboardMask)" for _, attrs in markup.elements))
    check("箭頭連接目標並有箭頭端點", markup.by_id.get("onboardArrow", ("", {}))[0] == "path" and
          markup.by_id["onboardArrow"][1].get("marker-end") == "url(#onboardArrowHead)" and
          markup.by_id.get("onboardArrowHead", ("", {}))[0] == "marker")
    check("四邊遮罩留出可操作區域", {
        attrs.get("data-onboard-block") for _, attrs in markup.elements
        if "data-onboard-block" in attrs
    } == {"top", "bottom", "left", "right"})

    stories = DATA["stories"]
    check("原有故事與新增九十年代故事齊全", len(stories) >= 14, str(len(stories)))
    modern = next((story for story in stories if story["id"] == "FL-014"), None)
    check("九十年代示範有可見年代與授權", bool(modern) and
          modern["year"] >= 1990 and modern["eraKey"] == "1990s" and
          modern["authorized"] is True and modern["scope"] == "community")
    check("新增故事如實標示虛構且沒有假音檔", bool(modern) and
          modern["rolePlayed"] is True and modern["audio"] is None and
          modern["confidence"] is None and
          "虛構" in modern["title"] and "Fictional" in modern["titleEn"] and
          "虛構" in modern["sourceNote"] and
          all("虛構" in segment["text"] and segment["confidence"] is None
              for segment in modern["segments"]))
    languages = {story.get("languageKey") for story in stories}
    check("三種故事語言", {"yue", "zh", "en"} <= languages, str(sorted(languages)))
    villages = {story.get("villageKey") for story in stories}
    expected = {"stanley", "kowloon-city", "tai-o", "kuk-po", "lai-chi-wo"}
    check("新增五個村落", expected <= villages, str(sorted(expected - villages)))
    outside = [story for story in stories if story.get("villageKey") in {"stanley", "kowloon-city", "tai-o"}]
    check("北區之外的示範故事有三則", len(outside) == 3, str(len(outside)))
    check("英語故事存在", any(story.get("languageKey") == "en" for story in stories))
    check("華語故事存在", any(story.get("languageKey") == "zh" for story in stories))
    check("3D 書籤包含谷埔、荔枝窩",
          "SCENE_VILLAGES = ['kuk-po', 'lai-chi-wo'" in
          (ROOT / "frontend" / "src" / "js" / "35-map.js").read_text(encoding="utf-8"))
    check("Word 腳本存在", DOCX.is_file(), str(DOCX.relative_to(ROOT)))

    if DOCX.is_file():
        from docx import Document
        document = Document(DOCX)
        headings = [p.text for p in document.paragraphs if p.style.name == "Heading 1"]
        story_headings = [h for h in headings if "·" in h]
        check("歷史 Word 補錄批次仍保留 13 則", len(story_headings) == 13, str(len(story_headings)))
        check("Word 腳本含總表與登記表", len(document.tables) >= 20, str(len(document.tables)))


def browser_checks() -> None:
    from playwright.sync_api import sync_playwright
    from _harness import frontend_server, launch_browser, warn_if_stale

    print("[browser] 390×844 淺色、引導、故事")
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            context = browser.new_context(viewport={"width": 390, "height": 844},
                                          device_scale_factor=2)
            page = context.new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            page.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_function("window.VTN && VTN.stories && VTN.map", timeout=30000)
            page.wait_for_timeout(2200)

            check("頁面主題為 light",
                  page.evaluate("() => document.documentElement.getAttribute('data-theme')") == "light")
            check("沒有主題下拉", page.locator("#setTheme").count() == 0)
            check("首次進地圖自動顯示引導", page.is_visible("#vtnOnboard"))
            check("引導第一步標題", "地圖" in page.inner_text("#onboardTitle"))
            check("引導進度 1/3", "1" in page.inner_text("#onboardProgress"))
            check("引導不阻止底層控制的鍵盤操作",
                  page.get_attribute("#onboardCard", "aria-modal") == "false")
            check("目標孔與箭頭已定位",
                  float(page.get_attribute("#onboardHole", "width") or 0) > 0 and
                  float(page.get_attribute("#onboardHole", "height") or 0) > 0 and
                  bool(page.get_attribute("#onboardArrow", "d")))

            page.click("#onboardNext")
            page.wait_for_timeout(120)
            check("第二步為故事類型", "類型" in page.inner_text("#onboardTitle"))
            page.click("#onboardBack")
            check("上一步返回地圖", "1" in page.inner_text("#onboardProgress"))
            page.click("#onboardNext")
            page.locator("#atlasLegend .legend-chip:not([disabled])").first.click()
            page.wait_for_function("document.getElementById('vtnOnboard').dataset.step === 'era'",
                                   timeout=5000)
            check("點真實類型控制會進入第三步", "年代" in page.inner_text("#onboardTitle"))
            check("最後一步按鈕為開始探索", "開始探索" in page.inner_text("#onboardNext"))
            page.locator("#atlasEra").focus()
            page.keyboard.press("ArrowRight")
            page.wait_for_function("document.getElementById('vtnOnboard').hidden", timeout=5000)
            check("操作真實年代控制會完成引導", page.is_hidden("#vtnOnboard"))
            check("已記錄看過引導",
                  page.evaluate("() => localStorage.getItem('vtn.v2.onboarded')") == "1")
            # The interactive tour intentionally changes filters. Reset this
            # test fixture before the unrelated full-corpus assertions below.
            page.evaluate("""() => {
                VTN.stories.applyParams({});
                VTN.stories.render();
                VTN.router.replace('stories', {});
            }""")

            page.reload(wait_until="domcontentloaded")
            page.wait_for_function("window.VTN && VTN.stories && VTN.map", timeout=30000)
            page.wait_for_timeout(2200)
            check("重載後不自動彈出", page.is_hidden("#vtnOnboard"))

            page.click("#atlasHelpBtn")
            page.wait_for_timeout(200)
            check("? 可重看引導", page.is_visible("#vtnOnboard"))
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)
            check("Esc 可關閉引導", page.is_hidden("#vtnOnboard"))

            page.evaluate("() => VTN.i18n.setLang('en')")
            page.click("#atlasHelpBtn")
            page.wait_for_function("""() => document.getElementById('onboardTitle').textContent ===
                (VTN.map.status() === 'failed' ? 'Map unavailable' : 'Explore the story map')
            """, timeout=5000)
            expected_title = ("Map unavailable" if page.evaluate("() => VTN.map.status()") == "failed"
                              else "Explore the story map")
            check("引導跟隨介面語言與地圖降級狀態", page.inner_text("#onboardTitle") == expected_title)
            page.click("#onboardNext")
            page.click("#onboardNext")
            check("英文第三步為年代控制", page.inner_text("#onboardTitle") == "Try the era slider")
            page.click("#onboardSkip")

            check("英文介面故事標題",
                  page.evaluate("() => VTN.stories.storyTitle(VTN.stories.get('STN-009'))")
                  == "Stanley · Market by the Sea")
            count = page.evaluate("() => VTN.stories.filtered().length")
            expected_count = sum(story.get("authorized") is True and story.get("scope") != "private"
                                 for story in DATA["stories"])
            check("地圖可見故事與目前資料一致", count == expected_count, str(count))
            check("英語故事可讀取",
                  page.evaluate("() => VTN.stories.get('STN-009').segments[0].text.startsWith('I grew up in Stanley')"))
            check("華語故事可讀取",
                  page.evaluate("() => VTN.stories.get('KLC-010').languageKey === 'zh'"))
            check("故事語言標籤三語",
                  page.evaluate("() => [VTN.stories.languageLabel('yue'), VTN.stories.languageLabel('zh'), VTN.stories.languageLabel('en')]")
                  == ["Cantonese (Hong Kong)", "Mandarin", "English"])
            check("地圖引擎正常", page.evaluate("() => VTN.map.status()") in ("maplibre", "leaflet", "failed"),
                  str(page.evaluate("() => VTN.map.status()")))
            check("無前端錯誤", not errors, str(errors[:3]))
            context.close()

            context2 = browser.new_context(viewport={"width": 390, "height": 844})
            page2 = context2.new_page()
            page2.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            page2.add_init_script("try{localStorage.setItem('vtn.v2.onboarded','1')}catch(e){}")
            page2.goto(base, wait_until="domcontentloaded", timeout=60000)
            page2.wait_for_function("window.VTN && VTN.stories", timeout=30000)
            page2.wait_for_timeout(1200)
            page2.evaluate("() => { const p=document.querySelector('.page[data-view=\"home\"]'); p.scrollTop=p.scrollHeight; }")
            page2.wait_for_timeout(250)
            check("已看過引導時首頁不彈出", page2.is_hidden("#vtnOnboard"))
            check("關閉的助手面板不可見",
                  page2.evaluate("() => getComputedStyle(document.querySelector('.vtn-ai-panel')).visibility") == "hidden")
            check("首頁底部沒有殘留森林綠塊",
                  page2.evaluate("""() => {
                    const nav = document.querySelector('.bottom-nav').getBoundingClientRect().top;
                    return !Array.from(document.querySelectorAll('body *')).some(node => {
                      const rect = node.getBoundingClientRect();
                      const bg = getComputedStyle(node).backgroundColor;
                      return bg === 'rgb(44, 87, 66)' && rect.width > 200 && rect.height > 8
                        && rect.bottom > nav - 20 && rect.top < nav;
                    });
                  }"""))
            context2.close()

            context3 = browser.new_context(viewport={"width": 320, "height": 640})
            page3 = context3.new_page()
            page3.add_init_script("try{localStorage.setItem('vtn.v2.onboarded','1')}catch(e){}")
            page3.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            page3.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page3.wait_for_function("window.VTN && VTN.stories && VTN.map", timeout=30000)
            page3.wait_for_timeout(2200)
            check("320px 沒有橫向溢出",
                  page3.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
            page3.click("#filterToggle", timeout=5000)
            check("320px 篩選鍵不被地圖控制鍵遮擋",
                  page3.get_attribute("#filterToggle", "aria-expanded") == "true")
            check("320px 縮放鍵讓位", page3.is_hidden("#atlasRecenter"))
            context3.close()
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--static", action="store_true", help="只檢查來源／資料，不啟動瀏覽器")
    args = parser.parse_args()
    static_checks()
    if not args.static:
        browser_checks()
    print()
    if FAILURES:
        print(f"FAILED {len(FAILURES)}/{CHECKS}: " + "; ".join(FAILURES))
        return 1
    print(f"OK light_onboarding — {CHECKS} check(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
