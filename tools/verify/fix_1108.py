"""11.08「Voices of the North 修復與升級」自動化回歸。

執行前先重建：
    python tools/build_frontend.py
    python tools/verify/fix_1108.py

檢查範圍：
    1. 三語字典鍵齊全、模板沒有寫死中文讀屏標籤
    2. 字級下限 --fs-min（CSS 無任何 < 0.875rem 的 font-size）
    3. 間距變數、底導航安全留白、不再用負 margin 做裝飾
    4. 關於頁數字由 stories.json 計算
    5. 瀏覽器實測：披露卡 320/360/390/430 × 三語 × 三主題共 36 組不溢出
    6. 瀏覽器實測：頁面間距、字級、讀屏標籤語言、彈層語言同步、隱私預設與例外
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "frontend" / "src"
TEMPLATE = SRC / "html" / "app.template.html"
I18N = SRC / "js" / "05-i18n.js"
UI = SRC / "js" / "25-ui.js"
ACCOUNT = SRC / "js" / "65-account.js"
ABOUT = SRC / "js" / "60-about.js"
CSS_DIR = SRC / "css"
DATA = ROOT / "data" / "stories.json"

FAILURES: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'OK  ' if ok else 'FAIL'} {label}" + (f" — {detail}" if detail else ""))
    if not ok:
        FAILURES.append(label)


def dict_sections(text: str) -> dict[str, str]:
    hk = text.index("'zh-HK': {")
    cn = text.index("'zh-CN': {")
    en = text.index("'en': {")
    end = text.index("\n  };", en)
    return {
        "zh-HK": text[hk:cn],
        "zh-CN": text[cn:en],
        "en": text[en:end],
    }


def static_checks() -> None:
    print("[static] 原始碼 / 字典 / CSS")
    i18n = I18N.read_text(encoding="utf-8")
    html = TEMPLATE.read_text(encoding="utf-8")
    sections = dict_sections(i18n)
    keys = {
        lang: set(re.findall(r"'([A-Za-z][\w.-]*)'\s*:", section)) - set(sections)
        for lang, section in sections.items()
    }
    check("三語字典鍵一致", keys["zh-HK"] == keys["zh-CN"] == keys["en"],
          f"keys={len(keys['zh-HK'])}/{len(keys['zh-CN'])}/{len(keys['en'])}")

    used = set(re.findall(r'data-i18n(?:-aria|-ph|-title|-alt)?="([^"]+)"', html))
    missing = sorted(used - keys["zh-HK"])
    check("模板翻譯鍵全部存在", not missing, f"used={len(used)}, missing={missing[:6]}")

    hardcoded = re.findall(r'(?:aria-label|title|alt)="[^"]*[\u4e00-\u9fff][^"]*"', html)
    check("模板無寫死中文讀屏標籤", not hardcoded, f"found={len(hardcoded)}")

    css_text = "\n".join(p.read_text(encoding="utf-8") for p in CSS_DIR.glob("*.css"))
    small = [m.group(1) for m in re.finditer(r"font-size:\s*(0?\.\d+)rem", css_text)
             if float(m.group(1)) < 0.875]
    check("CSS 字級皆 >= 0.875rem", not small, f"violations={small[:6]}")
    check("--fs-min 已定義", "--fs-min:" in css_text)
    check("三種間距變數已定義",
          all(f"--{name}:" in css_text for name in ("space-section", "space-block", "nav-safe")))
    check("精選卡下內距使用 --space-block",
          bool(re.search(r"\.featured\s*\{[^}]*var\(--space-block\)", css_text)))
    check("頁面底部統一使用 --nav-safe", css_text.count("var(--nav-safe)") >= 3,
          f"uses={css_text.count('var(--nav-safe)')}")
    check("me-list 不再用負 margin",
          not re.search(r"\.me-list\s*\{[^}]*margin-top:\s*-\d", css_text, re.S))
    check("stat-row 下外距為 --space-section",
          bool(re.search(r"\.stat-row\s*\{[^}]*var\(--space-section\)", css_text)))
    check("披露卡不再 nowrap",
          "white-space: nowrap" not in re.search(
              r"\.disclosure-card__zh\s*\{[^}]*\}", css_text, re.S).group(0))

    ui = UI.read_text(encoding="utf-8")
    check("dialog 具備 i18nRefresh", "opts.i18nRefresh" in ui)
    check("refreshOpenDialogs 已匯出", "refreshOpenDialogs: refreshOpenDialogs" in ui)
    check("關閉按鈕 aria-label 可重繪", "'data-i18n-aria': 'common.close'" in ui)
    account = ACCOUNT.read_text(encoding="utf-8")
    check("隱私彈層為預設 + 例外清單",
          all(token in account for token in ("privacy.preset", "privacy.exceptions",
                                             "privacy.applyAll", "privacy.resetExceptions")))
    check("文案已拆成兩句",
          all(token in i18n for token in ("privacy.defaultNote", "privacy.demoNote")))

    about = ABOUT.read_text(encoding="utf-8")
    check("關於頁由 stories.json 計算", "VTN.stories.meta" in about and "storyStats" in about)
    for lang, section in sections.items():
        match = re.search(r"'about\.dataBody':\s*'([^']*)'", section)
        body = match.group(1) if match else ""
        check(f"about.dataBody 模板 {lang}", all(p in body for p in ("{n}", "{audio}", "{duration}")))


def browser_checks() -> None:
    print("[browser] 單檔前端實測")
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", lambda route: (
            route.continue_() if "127.0.0.1" in route.request.url else route.abort()
        ))

        page.goto(base + "#home")
        page.wait_for_function("() => !!window.VTN_READY")
        check("啟動無 pageerror", not errors, str(errors[:2]))
        check("無缺失翻譯鍵", page.evaluate("() => VTN.i18n.missing().length") == 0)

        # ---- 關於頁數字與 stories.json 一致（三語） ----
        page.goto(base + "#about")
        page.wait_for_timeout(400)
        for lang in ("zh-HK", "zh-CN", "en"):
            page.evaluate("(lang) => VTN.i18n.setLang(lang)", lang)
            result = page.evaluate("""() => {
                const data = VTN.stories.meta() || {};
                const stories = data.stories || [];
                const audio = stories.filter(s => !!s.audio);
                const seconds = audio.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0);
                return {
                    actual: document.getElementById('aboutDataBody').textContent,
                    expected: VTN.i18n.t('about.dataBody', {
                        n: stories.length,
                        audio: audio.length,
                        duration: (Math.round(seconds * 10) / 10).toFixed(1)
                    }),
                    n: stories.length,
                    duration: (Math.round(seconds * 10) / 10).toFixed(1)
                };
            }""")
            check(f"關於頁數字 {lang} (n={result['n']}, {result['duration']}s)",
                  result["actual"] == result["expected"])

        # ---- 讀屏標籤隨語言切換 ----
        for lang in ("zh-HK", "zh-CN", "en"):
            page.evaluate("(lang) => VTN.i18n.setLang(lang)", lang)
            mismatched = page.evaluate("""() => Array.from(
                document.querySelectorAll('[data-i18n-aria]')
            ).filter(el => el.getAttribute('aria-label') !== VTN.i18n.t(el.getAttribute('data-i18n-aria')))
             .map(el => [el.id || el.className, el.getAttribute('aria-label')]).slice(0, 8)""")
            check(f"讀屏標籤語言 {lang}", not mismatched, str(mismatched))

        # ---- 字級下限（320px + 特大字級） ----
        page.set_viewport_size({"width": 320, "height": 720})
        page.evaluate("() => document.documentElement.setAttribute('data-font-size', 'xl')")
        for view in ("home", "me", "stories"):
            page.goto(base + "#" + view)
            page.wait_for_timeout(250)
            small = page.evaluate("""() => {
                const bad = [];
                document.querySelectorAll('.vtn-view.is-active *').forEach(el => {
                    const cs = getComputedStyle(el);
                    if (cs.display === 'none' || cs.visibility === 'hidden') return;
                    if (!el.getClientRects().length) return;
                    const hasText = Array.from(el.childNodes).some(
                        n => n.nodeType === 3 && n.textContent.trim());
                    if (!hasText) return;
                    const size = parseFloat(cs.fontSize);
                    if (size < 14) bad.push([el.tagName, String(el.className).slice(0, 40), size]);
                });
                return bad.slice(0, 8);
            }""")
            check(f"字級 >= 14px / {view} / 320px / xl", not small, str(small))
        page.evaluate("() => document.documentElement.setAttribute('data-font-size', 'md')")

        # ---- 頁面間距與底部安全留白 ----
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(base + "#home")
        page.wait_for_timeout(300)
        gaps = page.evaluate("""() => {
            const featured = document.querySelector('#featuredStory .story-card') ||
                             document.getElementById('featuredStory');
            const trust = document.querySelector('[data-view="home"] .trust-bar');
            return {
                gap: trust.getBoundingClientRect().top - featured.getBoundingClientRect().bottom,
                bottoms: ['home', 'stories', 'me'].map(v => ({
                    view: v,
                    pad: parseFloat(getComputedStyle(
                        document.querySelector('.page[data-view="' + v + '"]')).paddingBottom)
                }))
            };
        }""")
        check("精選卡到下一區塊 >= 28px", gaps["gap"] >= 28, f"gap={gaps['gap']:.1f}px")
        check("三頁底部留白 >= --space-block",
              all(item["pad"] >= 28 for item in gaps["bottoms"]), str(gaps["bottoms"]))

        me_layout = page.evaluate("""() => {
            const list = document.querySelector('.me-list');
            const title = document.querySelector('.page--me .me-section-title');
            return {
                marginTop: parseFloat(getComputedStyle(list).marginTop),
                title: title ? title.textContent : '',
                expected: VTN.i18n.t('aria.meList')
            };
        }""")
        check("me-list 無負 margin 且有小標題",
              me_layout["marginTop"] >= 0 and me_layout["title"] == me_layout["expected"],
              str(me_layout))

        # ---- 披露卡：320/360/390/430 × 3 語 × 3 主題 = 36 組 ----
        page.goto(base + "#stories")
        page.wait_for_timeout(500)
        if page.evaluate("() => document.getElementById('atlasList').hidden"):
            page.click("#atlasViewBtn")
            page.wait_for_timeout(350)
        overflow = []
        for width in (320, 360, 390, 430):
            page.set_viewport_size({"width": width, "height": 844})
            for lang in ("zh-HK", "zh-CN", "en"):
                for theme in ("light", "dark", "system"):
                    page.evaluate("""([l, t]) => {
                        VTN.i18n.setLang(l);
                        document.documentElement.setAttribute('data-theme', t);
                    }""", [lang, theme])
                    box = page.evaluate("""() => {
                        const card = document.querySelector('.disclosure-card');
                        const body = card.querySelector('.disclosure-card__body');
                        const zh = card.querySelector('.disclosure-card__zh');
                        const en = card.querySelector('.disclosure-card__en');
                        const cr = card.getBoundingClientRect();
                        const zr = zh.getBoundingClientRect();
                        return {
                            card: card.scrollWidth - card.clientWidth,
                            body: body.scrollWidth - body.clientWidth,
                            zh: zh.scrollWidth - zh.clientWidth,
                            en: en.scrollWidth - en.clientWidth,
                            outside: zr.right - cr.right,
                            nowrap: getComputedStyle(zh).whiteSpace
                        };
                    }""")
                    bad = (box["card"] > 1 or box["body"] > 1 or box["zh"] > 1 or
                           box["en"] > 1 or box["outside"] > 1 or box["nowrap"] != "normal")
                    if bad:
                        overflow.append((width, lang, theme, box))
        check("披露卡 36 組不溢出", not overflow,
              f"combinations=36, overflow={len(overflow)}, first={overflow[:1]}")
        page.evaluate("() => VTN.i18n.setLang('zh-HK')")
        page.evaluate("() => document.documentElement.setAttribute('data-theme', 'light')")

        # ---- 設定內語言分頁：勾選 / 樣式 / aria-pressed / 即時翻譯 ----
        page.goto(base + "#me")
        page.wait_for_timeout(350)
        page.click("#meEntrySettings")
        page.click("#settingsTabLanguage")
        page.wait_for_timeout(250)
        states = page.evaluate("""() => Array.from(document.querySelectorAll('.lang-option')).map(b => ({
            lang: b.dataset.lang,
            pressed: b.getAttribute('aria-pressed'),
            selected: b.classList.contains('is-selected'),
            check: b.querySelector('.lang-option__check').textContent.trim()
        }))""")
        active = page.evaluate("() => VTN.i18n.lang()")
        check("語言分頁初始狀態正確",
              len([s for s in states if s["pressed"] == "true"]) == 1 and
              next(s for s in states if s["pressed"] == "true")["lang"] == active and
              len([s for s in states if s["check"] == "✓"]) == 1,
              str(states))
        page.click('.lang-option[data-lang="zh-CN"]')
        page.wait_for_timeout(250)
        switched = page.evaluate("""() => ({
            lang: VTN.i18n.lang(),
            pressed: Array.from(document.querySelectorAll('.lang-option'))
                .map(b => [b.dataset.lang, b.getAttribute('aria-pressed')]),
            title: document.querySelector('#setLanguage').textContent,
            expected: VTN.i18n.t('settings.language')
        })""")
        check("切換簡中後勾選與分頁標籤同步",
              switched["lang"] == "zh-CN" and
              ["zh-CN", "true"] in switched["pressed"] and
              ["zh-HK", "false"] in switched["pressed"] and
              switched["title"] == switched["expected"], str(switched))
        page.evaluate("() => VTN.i18n.setLang('en')")
        page.wait_for_timeout(200)
        en_state = page.evaluate("""() => ({
            pressed: Array.from(document.querySelectorAll('.lang-option'))
                .map(b => [b.dataset.lang, b.getAttribute('aria-pressed')]),
            title: document.querySelector('#setLanguage').textContent,
            note: document.querySelector('#settingsPanelLanguage .settings-foot').textContent
        })""")
        check("切換英文後語言分頁內容同步",
              ["en", "true"] in en_state["pressed"] and
              en_state["title"] == "Language" and
              "interface switches instantly" in en_state["note"], str(en_state))
        page.click('[data-view="settings"] [data-back="me"]')
        page.wait_for_timeout(300)

        # ---- 隱私彈層：預設 / 例外 / 套用全部 / 重設 ----
        page.evaluate("() => VTN.i18n.setLang('zh-HK')")
        page.evaluate("""() => {
            const item = VTN.stories.visible()[0];
            if (item) VTN.store.setScope(item, 'public');
        }""")
        page.click("#meEntryPrivacy")
        page.wait_for_timeout(250)
        privacy = page.evaluate("""() => ({
            preset: document.getElementById('privacyPreset').value,
            summary: document.querySelector('.privacy-exceptions__summary').textContent,
            maxHeight: parseFloat(getComputedStyle(
                document.querySelector('.privacy-exceptions__list')).maxHeight),
            viewportHalf: window.innerHeight * 0.5,
            actions: Array.from(document.querySelectorAll('.vtn-modal__foot .vtn-btn'))
                .map(b => b.textContent),
            hasDefaultNote: document.querySelector('.vtn-modal').textContent
                .includes(VTN.i18n.t('privacy.defaultNote')),
            hasDemoNote: document.querySelector('.vtn-modal').textContent
                .includes(VTN.i18n.t('privacy.demoNote'))
        })""")
        check("隱私預設為私人且兩句文案齊全",
              privacy["preset"] == "private" and privacy["hasDefaultNote"] and privacy["hasDemoNote"],
              str(privacy["preset"]))
        check("例外清單正確顯示 N=1", "(1)" in privacy["summary"], privacy["summary"])
        check("例外列表限高 50dvh",
              abs(privacy["maxHeight"] - privacy["viewportHalf"]) < 2,
              f"{privacy['maxHeight']} vs {privacy['viewportHalf']}")
        check("底部有套用到全部 / 重設所有例外",
              "套用到全部" in privacy["actions"] and "重設所有例外" in privacy["actions"],
              str(privacy["actions"]))

        page.click(".vtn-modal__foot .vtn-btn:has-text('重設所有例外')")
        page.wait_for_timeout(250)
        check("重設所有例外後 N=0",
              "(0)" in page.evaluate(
                  "() => document.querySelector('.privacy-exceptions__summary').textContent"))

        page.evaluate("() => VTN.i18n.setLang('en')")
        page.wait_for_timeout(200)
        en_privacy = page.evaluate("""() => ({
            text: document.querySelector('.vtn-modal').textContent,
            title: document.querySelector('.vtn-modal__title').textContent,
            close: document.querySelector('.vtn-modal__close').getAttribute('aria-label')
        })""")
        check("隱私彈層語言同步",
              "Default sharing scope" in en_privacy["text"] and
              en_privacy["title"] == "Privacy & sharing" and
              en_privacy["close"] == "Close", str(en_privacy["title"]))
        page.evaluate("() => VTN.ui.closeAll()")
        page.wait_for_timeout(300)

        # ---- 更正 / 匯出彈層語言同步 ----
        for entry, expected_zh, expected_en in (
            ("meEntryCorrection", "更正對象", "Target"),
            ("meEntryExport", "匯出我的音訊與逐字稿", "Export my audio & transcript"),
        ):
            page.evaluate("() => VTN.i18n.setLang('zh-HK')")
            page.click("#" + entry)
            page.wait_for_timeout(200)
            zh_text = page.evaluate("() => document.querySelector('.vtn-modal').textContent")
            page.evaluate("() => VTN.i18n.setLang('en')")
            page.wait_for_timeout(200)
            en_text = page.evaluate("() => document.querySelector('.vtn-modal').textContent")
            check(f"{entry} 語言同步",
                  expected_zh in zh_text and expected_en in en_text,
                  f"zh={expected_zh in zh_text}, en={expected_en in en_text}")
            page.evaluate("() => VTN.ui.closeAll()")
            page.wait_for_timeout(300)

        check("全程無 pageerror", not errors, str(errors[:3]))
        browser.close()


def main() -> None:
    static_checks()
    browser_checks()
    failed = len(FAILURES)
    print(f"\n{'FAIL' if failed else 'OK'} fix_1108 — {failed} failed check(s)")
    if failed:
        print("  - " + "\n  - ".join(FAILURES))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
