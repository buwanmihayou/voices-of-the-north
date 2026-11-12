"""Settings → Language navigation, persistence and mobile regression checks.

Run after building: python tools/verify/settings_language.py
Uses a random-port static server with third-party requests blocked.
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

ROOT = Path(__file__).resolve().parents[2]
CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def selected_tab(page):
    return page.locator('[data-settings-tab][aria-selected="true"]').get_attribute("data-settings-tab")


def wait_for_toast(page):
    page.wait_for_function("""() => {
      const toast = document.querySelector('#appToast');
      return !toast.classList.contains('is-show') && getComputedStyle(toast).opacity === '0';
    }""")


def language_row(page):
    return page.locator('.settings-group[aria-labelledby="setDisplay"] > .setting-row').filter(
        has=page.locator('[data-i18n="settings.language"]'))


def check_display_language_row(page, prefix):
    structure = language_row(page).evaluate("""row => {
      const group = row.parentElement;
      const font = group.querySelector('[data-font-size]');
      const contrast = group.querySelector('#setContrast');
      return {displayGroup: group.getAttribute('aria-labelledby') === 'setDisplay',
        fontPeer: font && font.closest('.setting-row').parentElement === group,
        contrastPeer: contrast && contrast.closest('.setting-row').parentElement === group};
    }""")
    check(prefix + ": Language is a peer of text size and contrast in Display",
          all(structure.values()), structure)


def run():
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            for width, height in ((390, 844), (320, 568), (1280, 800)):
                context = browser.new_context(viewport={"width": width, "height": height})
                origin = base.split("/voices-")[0]
                context.route("**/*", lambda route: route.continue_()
                              if route.request.url.startswith(origin) else route.abort())
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto(base + "#me", wait_until="domcontentloaded")
                page.wait_for_function("window.VTN_READY === true")
                prefix = f"{width}px"
                if page.locator(".vtn-ai-hint-close").is_visible():
                    page.click(".vtn-ai-hint-close")
                check(prefix + ": helper teaser can be dismissed", not page.locator(".vtn-ai-hint").is_visible())
                check(prefix + ": Language is removed from Me", page.locator("#meEntryLanguage").count() == 0)
                page.click("#meEntrySettings")
                check(prefix + ": Settings opens General", selected_tab(page) == "general")
                check(prefix + ": only General panel is visible", page.locator("#settingsPanelGeneral").is_visible()
                      and not page.locator("#settingsPanelLanguage").is_visible())
                check_display_language_row(page, prefix)
                page.click("#setLanguageEntry")
                check(prefix + ": Display Language row opens the existing Language subpage",
                      page.url.endswith("#settings?tab=language") and selected_tab(page) == "language")
                check(prefix + ": Language is a Settings subpage", page.url.endswith("#settings?tab=language")
                      and selected_tab(page) == "language"
                      and page.locator('main[data-view="settings"]').is_visible())
                check(prefix + ": only Language panel is visible", page.locator("#settingsPanelLanguage").is_visible()
                      and not page.locator("#settingsPanelGeneral").is_visible())
                check(prefix + ": nested settings keeps My navigation selected",
                      page.locator('[data-nav="me"]').get_attribute("aria-current") == "page")

                for code, label in (("zh-CN", "语言"), ("en", "Language"), ("zh-HK", "語言")):
                    if width == 320:
                        page.mouse.move(160, 300)
                        page.mouse.wheel(0, 180)
                    page.click(f'#settingsLanguageOptions [data-lang="{code}"]')
                    state = page.evaluate("""() => ({
                      lang: VTN.i18n.lang(), stored: VTN.store.getPref('lang'),
                      selected: Array.from(document.querySelectorAll('#settingsLanguageOptions [aria-pressed="true"]'),
                                           b => b.dataset.lang),
                      checks: Array.from(document.querySelectorAll('#settingsLanguageOptions .lang-option__check'),
                                         n => n.textContent).filter(t => t === '✓').length,
                      missing: VTN.i18n.missing()
                    })""")
                    check(prefix + f": {code} applies and persists immediately", state["lang"] == code
                          and state["stored"] == code and state["selected"] == [code] and state["checks"] == 1, state)
                    check(prefix + f": {code} translates nested title", page.locator("#setLanguage").inner_text() == label)
                    check(prefix + f": {code} stays in Language", selected_tab(page) == "language")
                    check(prefix + f": {code} has no untranslated keys", not state["missing"], state["missing"])
                    expected_current = page.evaluate("() => VTN.i18n.t('lang.name.' + VTN.i18n.lang())")
                    check(prefix + f": {code} updates Display current-language value",
                          page.locator("#setLanguageCurrent").inner_text() == expected_current)
                    page.click("#settingsTabGeneral")
                    check(prefix + f": {code} current value is visible in General",
                          page.locator("#setLanguageCurrent").is_visible())
                    page.click("#setLanguageEntry")
                    check(prefix + f": {code} row normally opens Language",
                          selected_tab(page) == "language")

                page.click('#settingsLanguageOptions [data-lang="en"]')
                page.reload(wait_until="domcontentloaded")
                page.wait_for_function("window.VTN_READY === true")
                check(prefix + ": reload keeps language and nested route", selected_tab(page) == "language"
                      and page.locator("#settingsTabLanguage").inner_text() == "Language"
                      and page.locator('#settingsLanguageOptions [data-lang="en"]').get_attribute("aria-pressed") == "true")
                page.locator("#settingsTabLanguage").focus()
                page.keyboard.press("ArrowLeft")
                check(prefix + ": ArrowLeft selects and focuses General", selected_tab(page) == "general"
                      and page.locator("#settingsTabGeneral").evaluate("el => el === document.activeElement"))
                page.keyboard.press("End")
                check(prefix + ": End selects and focuses Language", selected_tab(page) == "language"
                      and page.locator("#settingsTabLanguage").evaluate("el => el === document.activeElement"))
                page.go_back()
                check(prefix + ": browser Back restores previous subpage", selected_tab(page) == "general")
                page.go_forward()
                check(prefix + ": browser Forward restores Language", selected_tab(page) == "language")
                page.click('[data-view="settings"] [data-back="me"]')
                check(prefix + ": Settings back returns to My", page.locator('main[data-view="me"]').is_visible())
                page.click("#meEntrySettings")
                check(prefix + ": re-entering Settings starts at General", selected_tab(page) == "general")
                page.evaluate("() => VTN.account.openLanguage()")
                check(prefix + ": existing language entry API opens nested tab", selected_tab(page) == "language"
                      and page.get_by_role("dialog").count() == 0)
                layout = page.evaluate("""() => {
                  const panel = document.querySelector('#settingsPanelLanguage');
                  const targets = [...panel.querySelectorAll('button'), ...document.querySelectorAll('[data-settings-tab]')];
                  return {width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
                    outside: targets.some(el => { const r = el.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth; }),
                    tooSmall: targets.some(el => el.getBoundingClientRect().height < 44)};
                }""")
                check(prefix + ": tabs and language choices fit viewport", not layout["overflow"]
                      and not layout["outside"] and not layout["tooSmall"], layout)
                check(prefix + ": no browser errors", not errors, errors)
                output = ROOT / "docs" / "audit" / "2026-11-12"
                output.mkdir(parents=True, exist_ok=True)
                wait_for_toast(page)
                page.screenshot(path=str(output / f"settings-language-{width}-en.png"), full_page=True)
                if width == 320:
                    page.mouse.move(160, 300)
                    page.mouse.wheel(0, 180)
                    page.wait_for_function("""() => document.querySelector('#settingsLanguageOptions [data-lang="en"]')
                      .getBoundingClientRect().bottom <= document.querySelector('.bottom-nav').getBoundingClientRect().top""")
                    check(prefix + ": normal scroll reveals the complete English choice", True)
                    page.screenshot(path=str(output / "settings-language-320-en-scrolled.png"), full_page=True)
                page.click('#settingsLanguageOptions [data-lang="zh-HK"]')
                wait_for_toast(page)
                page.screenshot(path=str(output / f"settings-language-{width}-zh.png"), full_page=True)
                for code, suffix in (("zh-HK", "zh"), ("en", "en")):
                    page.click(f'#settingsLanguageOptions [data-lang="{code}"]')
                    wait_for_toast(page)
                    page.click("#settingsTabGeneral")
                    page.mouse.move(width // 2, 280)
                    page.mouse.wheel(0, -2000)
                    page.wait_for_function("document.querySelector('main[data-view=\"settings\"]').scrollTop === 0")
                    page.screenshot(path=str(output / f"settings-general-{width}-{suffix}.png"), full_page=True)
                    language_row(page).scroll_into_view_if_needed()
                    geometry = page.locator("#setLanguageEntry").evaluate("""button => {
                      const r = button.getBoundingClientRect();
                      const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
                      return {height: r.height, left: r.left, right: r.right, width: innerWidth,
                        reachable: r.top >= 0 && r.bottom <= nav.top};
                    }""")
                    check(prefix + f": {code} Language row fits and is reachable by scrolling",
                          geometry["height"] >= 44 and geometry["left"] >= 0
                          and geometry["right"] <= geometry["width"] and geometry["reachable"], geometry)
                    page.screenshot(path=str(output / f"settings-general-display-{width}-{suffix}.png"), full_page=True)
                    page.click("#setLanguageEntry")
                    check(prefix + f": {code} visible Display row accepts normal click", selected_tab(page) == "language")
                if width == 320:
                    page.click('#settingsLanguageOptions [data-lang="zh-HK"]')
                    wait_for_toast(page)
                    page.click("#settingsTabGeneral")
                    page.click('[data-font-size="xl"]')
                    language_row(page).scroll_into_view_if_needed()
                    large_layout = page.locator("#setLanguageEntry").evaluate("""row => {
                      const value = row.querySelector('#setLanguageCurrent');
                      const r = row.getBoundingClientRect(), v = value.getBoundingClientRect();
                      return {rowOverflow: row.scrollWidth > row.clientWidth,
                        valueOverflow: value.scrollWidth > value.clientWidth,
                        outsideRow: v.left < r.left || v.right > r.right || v.bottom > r.bottom,
                        pageOverflow: document.documentElement.scrollWidth > innerWidth};
                    }""")
                    check(prefix + ": extra-large text keeps current language fully readable",
                          not any(large_layout.values()), large_layout)
                    wait_for_toast(page)
                    page.screenshot(path=str(output / "settings-general-display-320-zh-xl.png"), full_page=True)
                context.close()
        finally:
            browser.close()
    print(f"\n{CHECKS} checks passed.")


if __name__ == "__main__":
    run()
