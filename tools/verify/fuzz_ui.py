"""驗證 800m 模糊分組的 UI：地圖 pin、分組角標、選擇對話框、視口提示。

執行：python tools/verify/fuzz_ui.py [--out PATH]
依賴：requirements-dev.txt（playwright）＋已建置的單檔前端。
注意：這一支需要 MapLibre CDN，網路不可用時會直接 SKIP（結束碼 0）；
截圖預設寫到系統暫存目錄，只有明確給 --out 才會寫進專案，
避免覆蓋 docs/audit 下已提交的審計截圖。
"""

import argparse
import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the 800m fuzz-group UI.")
    parser.add_argument("--out", type=Path, default=None,
                        help="screenshot path (default: a file under the system temp directory)")
    args = parser.parse_args()

    out = args.out or Path(tempfile.mkdtemp(prefix="vtn-fuzz-ui-")) / "fuzz-group.png"
    out.parent.mkdir(parents=True, exist_ok=True)

    warn_if_stale()
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
            page.goto(base + "#stories", wait_until="commit", timeout=30000)
            status = "unknown"
            try:
                page.wait_for_function("window.VTN && VTN.map && VTN.map.status() === 'maplibre'", timeout=25000)
                status = "maplibre"
            except PWTimeout:
                try:
                    status = page.evaluate("() => window.VTN && VTN.map ? VTN.map.status() : 'no-VTN'")
                except Exception:
                    status = "no-VTN"
            print("mapStatus", status)
            if status != "maplibre":
                print("SKIP UI: MapLibre CDN unavailable in this network")
                return

            page.evaluate("""() => {
              const base = window.VTN_STORY_DATA.stories[0];
              window.VTN_STORY_DATA.stories.push(Object.assign({}, base, {
                id: 'TEST-SAME', title: '同圈測試故事',
                location: {lat: base.location.lat, lng: base.location.lng, radiusM: 800}
              }));
              VTN.stories.render();
            }""")
            page.wait_for_timeout(1200)
            print("pins", json.dumps(page.evaluate("""() => ({
              total: document.querySelectorAll('.vtn-pin').length,
              grouped: document.querySelectorAll('.vtn-pin--group').length,
              counts: Array.from(document.querySelectorAll('.vtn-pin__count')).map(n => n.textContent),
              viewport: document.getElementById('atlasViewportText').textContent,
              viewportHidden: document.getElementById('atlasViewport').hidden
            })"""), ensure_ascii=False))

            page.evaluate("() => document.querySelector('[data-story=\"YL-001\"]').click()")
            page.wait_for_timeout(700)
            print("dialog", json.dumps(page.evaluate("""() => ({
              open: !!document.querySelector('.vtn-modal'),
              title: document.querySelector('.vtn-modal__title') ? document.querySelector('.vtn-modal__title').textContent : null,
              choices: Array.from(document.querySelectorAll('.vtn-group-choice')).map(n => n.textContent)
            })"""), ensure_ascii=False))
            page.screenshot(path=str(out))
            print("screenshot", out)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
