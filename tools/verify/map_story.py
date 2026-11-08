"""驗證地圖故事頁的資料邏輯：inBbox、800m 模糊分組、三語文案、視口節點。

執行：python tools/verify/map_story.py
依賴：requirements-dev.txt（playwright）＋已建置的單檔前端。
外部請求一律封鎖，因此驗證的是 Leaflet/插畫回退路徑，不依賴 CDN。
"""

import json
import sys

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale


def main() -> None:
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_function("window.VTN && VTN.stories && VTN.map", timeout=20000)
            page.wait_for_timeout(1500)

            print("inBbox", json.dumps(page.evaluate("""() =>
              VTN.stories.inBbox([[113.98,22.43],[114.03,22.47]]).map(s => s.id)""")))
            print("groupsDefault", json.dumps(page.evaluate("""() =>
              VTN.stories.fuzzGroups().map(g => g.count)""")))

            page.evaluate("""() => {
              const base = window.VTN_STORY_DATA.stories[0];
              window.VTN_STORY_DATA.stories.push(Object.assign({}, base, {
                id: 'TEST-SAME', title: '同圈測試故事',
                location: {lat: base.location.lat, lng: base.location.lng, radiusM: 800}
              }));
              VTN.stories.render();
            }""")
            print("groupsInjected", json.dumps(page.evaluate("""() => ({
              merged: VTN.stories.fuzzGroups().filter(g => g.count > 1).map(g => g.ids),
              mapGroup: VTN.map.groupMap()['YL-001'],
              geoGroupSize: VTN.map.status()
            })"""), ensure_ascii=False))

            print("i18n", json.dumps(page.evaluate("""() => {
              const out = {};
              ['zh-HK','zh-CN','en'].forEach(lang => {
                VTN.i18n.setLang(lang);
                out[lang] = {
                  inView: VTN.i18n.t('atlas.inView', {n: 3}),
                  groupTitle: VTN.i18n.t('atlas.groupTitle', {n: 2}),
                  groupAria: VTN.i18n.t('atlas.groupAria', {n: 2})
                };
              });
              return out;
            }"""), ensure_ascii=False))

            print("viewportNode", page.evaluate("""() => ({
              exists: !!document.getElementById('atlasViewport'),
              hidden: document.getElementById('atlasViewport').hidden,
              text: document.getElementById('atlasViewportText').textContent
            })"""))
            print("errors", errors[-6:])
        finally:
            browser.close()

    print("FAIL" if errors else "OK", "map_story")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
