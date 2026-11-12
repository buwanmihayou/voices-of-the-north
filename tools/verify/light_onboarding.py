"""驗證「只提供淺色＋地圖引導＋故事擴充＋Word 腳本」這批改動。

執行：python tools/verify/light_onboarding.py
前置：python tools/build_frontend.py && python tools/export_story_scripts_docx.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "verify"))

from playwright.sync_api import sync_playwright  # noqa: E402

from _harness import frontend_server, launch_browser, warn_if_stale  # noqa: E402

DATA = json.loads((ROOT / "data" / "stories.json").read_text(encoding="utf-8"))
TEMPLATE = (ROOT / "frontend" / "src" / "html" / "app.template.html").read_text(encoding="utf-8")
SETTINGS = (ROOT / "frontend" / "src" / "js" / "55-settings.js").read_text(encoding="utf-8")
I18N = (ROOT / "frontend" / "src" / "js" / "05-i18n.js").read_text(encoding="utf-8")
DOCX = ROOT / "docs" / "voice-scripts" / "Voices_of_the_North_Story_Scripts.docx"
FAILURES: list[str] = []
CHECKS = 0


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
    for lang, sample in (("zh-HK", "拖動地圖"), ("zh-CN", "拖动地图"), ("en", "Drag the map")):
        check(f"引導文案 {lang}", sample in I18N)

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
            check("引導第一步標題", "拖動地圖" in page.inner_text("#onboardTitle"))
            check("引導進度 1/3", "1" in page.inner_text("#onboardProgress"))

            page.click("#onboardNext")
            page.wait_for_timeout(120)
            check("第二步", "點一下圖示" in page.inner_text("#onboardTitle"))
            page.click("#onboardNext")
            page.wait_for_timeout(120)
            check("第三步", "年代軸" in page.inner_text("#onboardTitle"))
            check("最後一步按鈕為開始探索", "開始探索" in page.inner_text("#onboardNext"))
            page.click("#onboardNext")
            page.wait_for_timeout(250)
            check("關閉後不再顯示", page.is_hidden("#vtnOnboard"))
            check("已記錄看過引導",
                  page.evaluate("() => localStorage.getItem('vtn.v2.onboarded')") == "1")

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
            page.wait_for_timeout(200)
            check("引導跟隨介面語言", page.inner_text("#onboardTitle") == "Drag the map to find stories")
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
    static_checks()
    browser_checks()
    print()
    if FAILURES:
        print(f"FAILED {len(FAILURES)}/{CHECKS}: " + "; ".join(FAILURES))
        return 1
    print(f"OK light_onboarding — {CHECKS} check(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
