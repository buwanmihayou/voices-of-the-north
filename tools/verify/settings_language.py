"""Settings → Display → Language navigation, persistence and mobile checks.

Run after building: python -X utf8 tools/verify/settings_language.py
Uses a random-port static server with third-party requests blocked.
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs" / "audit" / "2026-11-12"
CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def is_general(page):
    return (page.locator("#settingsPanelGeneral").is_visible()
            and not page.locator("#settingsPanelLanguage").is_visible())


def is_language(page):
    return (page.locator("#settingsPanelLanguage").is_visible()
            and not page.locator("#settingsPanelGeneral").is_visible())


def focused(page, selector):
    return page.locator(selector).evaluate("el => el === document.activeElement")


def wait_for_toast(page):
    page.wait_for_function("""() => {
      const toast = document.querySelector('#appToast');
      return !toast.classList.contains('is-show') && getComputedStyle(toast).opacity === '0';
    }""")


def capture_general(page, width, suffix):
    wait_for_toast(page)
    page.mouse.move(width // 2, 260)
    page.mouse.wheel(0, -2000)
    page.wait_for_function("document.querySelector('main[data-view=\"settings\"]').scrollTop === 0")
    page.screenshot(path=str(OUTPUT / f"settings-final-display-{width}-{suffix}.png"), full_page=True)


def run():
    warn_if_stale()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            for width, height in ((390, 844), (320, 568), (1280, 800)):
                prefix = f"{width}px"
                context = browser.new_context(viewport={"width": width, "height": height})
                origin = base.split("/voices-")[0]
                context.route("**/*", lambda route: route.continue_()
                              if route.request.url.startswith(origin) else route.abort())
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base + "#me", wait_until="domcontentloaded")
                page.wait_for_function("window.VTN_READY === true")
                if page.locator(".vtn-ai-hint-close").is_visible():
                    page.click(".vtn-ai-hint-close")
                page.click("#meEntrySettings")
                check(prefix + ": Settings opens Display directly", is_general(page)
                      and page.locator("#setDisplay").is_visible()
                      and page.locator("#settingsGeneralTitle").count() == 0)
                check(prefix + ": no duplicate top language tab or Me language entry",
                      page.locator('main[data-view="settings"] [role="tablist"]').count() == 0
                      and page.locator("#meEntryLanguage").count() == 0)
                structure = page.locator("#setLanguageEntry").evaluate("""row => {
                  const group = row.parentElement;
                  const font = group.querySelector('[data-font-size]');
                  const contrast = group.querySelector('#setContrast');
                  return {row: row.classList.contains('setting-row'),
                    displayGroup: group.getAttribute('aria-labelledby') === 'setDisplay',
                    fontPeer: font && font.closest('.setting-row').parentElement === group,
                    contrastPeer: contrast && contrast.closest('.setting-row').parentElement === group};
                }""")
                check(prefix + ": Display Language is a peer of text size and contrast", all(structure.values()), structure)
                capture_general(page, width, "zh")
                page.click("#setLanguageEntry")
                check(prefix + ": row opens Language and focuses its heading", is_language(page)
                      and page.url.endswith("#settings?tab=language") and focused(page, "#setLanguage"))
                check(prefix + ": Language retains My navigation selection",
                      page.locator('[data-nav="me"]').get_attribute("aria-current") == "page")

                for code, label in (("zh-CN", "语言"), ("en", "Language"), ("zh-HK", "語言")):
                    if width == 320:
                        page.mouse.move(160, 280)
                        page.mouse.wheel(0, 160)
                    page.click(f'#settingsLanguageOptions [data-lang="{code}"]')
                    state = page.evaluate("""() => ({
                      lang: VTN.i18n.lang(), stored: VTN.store.getPref('lang'),
                      selected: Array.from(document.querySelectorAll('#settingsLanguageOptions [aria-pressed="true"]'),
                                           b => b.dataset.lang),
                      checks: Array.from(document.querySelectorAll('#settingsLanguageOptions .lang-option__check'),
                                         n => n.textContent).filter(t => t === '✓').length,
                      current: document.querySelector('#setLanguageCurrent').textContent,
                      expected: VTN.i18n.t('lang.name.' + VTN.i18n.lang()), missing: VTN.i18n.missing()
                    })""")
                    check(prefix + f": {code} applies, persists and selects exactly one choice",
                          state["lang"] == code and state["stored"] == code
                          and state["selected"] == [code] and state["checks"] == 1, state)
                    check(prefix + f": {code} translates heading and current language", state["current"] == state["expected"]
                          and page.locator("#setLanguage").inner_text() == label and not state["missing"], state)
                    page.click("#settingsBack")
                    check(prefix + f": {code} Back returns to General and restores row focus",
                          is_general(page) and focused(page, "#setLanguageEntry")
                          and page.locator("#setLanguageCurrent").is_visible())
                    page.keyboard.press("Space" if code == "en" else "Enter")
                    check(prefix + f": {code} row opens by keyboard", is_language(page)
                          and focused(page, "#setLanguage"))

                page.click('#settingsLanguageOptions [data-lang="en"]')
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("window.VTN_READY === true")
                check(prefix + ": reload keeps English and Language route", is_language(page)
                      and page.url.endswith("#settings?tab=language")
                      and page.locator('#settingsLanguageOptions [data-lang="en"]').get_attribute("aria-pressed") == "true")
                if width == 390:
                    wait_for_toast(page)
                    page.screenshot(path=str(OUTPUT / "settings-final-language-390-en.png"), full_page=True)
                page.click("#settingsBack")
                check(prefix + ": Language Back returns to General with row focus", is_general(page)
                      and focused(page, "#setLanguageEntry"))
                capture_general(page, width, "en")
                page.keyboard.press("Space")
                check(prefix + ": Space reopens Language", is_language(page))
                page.go_back()
                check(prefix + ": browser Back restores General", is_general(page))
                page.go_forward()
                check(prefix + ": browser Forward restores Language", is_language(page))
                page.click("#settingsBack")
                page.click("#settingsBack")
                check(prefix + ": General Back returns to My", page.locator('main[data-view="me"]').is_visible())
                page.click("#meEntrySettings")
                page.evaluate("() => VTN.account.openLanguage()")
                check(prefix + ": existing language API opens the same subpage", is_language(page)
                      and page.get_by_role("dialog").count() == 0)
                layout = page.locator("#settingsLanguageOptions").evaluate("""panel => {
                  const targets = [...panel.querySelectorAll('button')];
                  return {overflow: document.documentElement.scrollWidth > innerWidth,
                    outside: targets.some(el => {const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth;}),
                    tooSmall: targets.some(el => el.getBoundingClientRect().height < 44)};
                }""")
                check(prefix + ": language choices fit viewport with accessible targets", not any(layout.values()), layout)
                if width == 320:
                    page.click('#settingsLanguageOptions [data-lang="zh-HK"]')
                    page.click("#settingsBack")
                    page.click('[data-font-size="xl"]')
                    page.locator("#setLanguageEntry").scroll_into_view_if_needed()
                    large = page.locator("#setLanguageEntry").evaluate("""row => {
                      const value = row.querySelector('#setLanguageCurrent');
                      const r = row.getBoundingClientRect(), v = value.getBoundingClientRect();
                      return {rowOverflow: row.scrollWidth > row.clientWidth,
                        valueOverflow: value.scrollWidth > value.clientWidth,
                        outsideRow: v.left < r.left || v.right > r.right || v.bottom > r.bottom,
                        pageOverflow: document.documentElement.scrollWidth > innerWidth};
                    }""")
                    check(prefix + ": extra-large text keeps current language fully readable", not any(large.values()), large)
                    capture_general(page, width, "zh-xl")
                check(prefix + ": no browser errors", not errors, errors)
                context.close()
        finally:
            browser.close()
    print(f"\n{CHECKS} checks passed.")


if __name__ == "__main__":
    run()
