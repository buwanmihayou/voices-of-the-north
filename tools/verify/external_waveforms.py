"""驗證 --external-waveforms 建置模式：單檔不含波形，前端按需 fetch JSON。

執行前先跑：python tools/build_frontend.py --external-waveforms
"""

import json
import sys

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale


def main() -> None:
    warn_if_stale()
    failures = []
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            page.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(2600)
            state = page.evaluate("""() => ({
              inline: Object.keys(window.VTN_WAVEFORMS || {}).length,
              url: window.VTN_WAVEFORMS_URL || null
            })""")
            print("state", json.dumps(state, ensure_ascii=False))
            if state["inline"] != 0 or state["url"] != "waveforms.json":
                failures.append("單檔仍內嵌波形或未設定外置 URL")

            result = page.evaluate("""() => VTN.waveform.get('assets/Demo Story.wav', 'YL-001').then(peaks => ({
              length: peaks ? peaks.length : 0,
              debug: VTN.waveform.debug(),
              cached: Object.keys(window.VTN_WAVEFORMS || {})
            }))""")
            print("loaded", json.dumps(result, ensure_ascii=False))
            if result["length"] != 60:
                failures.append("外置 JSON 未載入 60 柱波形")
            if result["cached"] != ["YL-001"]:
                failures.append("載入後未寫回 VTN_WAVEFORMS 快取")
            if result["debug"]["runtimeDecodes"]:
                failures.append("不應退化為執行期解碼 WAV")

            page.evaluate("() => VTN.stories.select('YL-001')")
            page.wait_for_timeout(900)
            bars = page.evaluate("() => document.querySelectorAll('.player__waveSvg rect').length")
            print("player bars", bars)
            if bars != 120:
                failures.append("播放器未畫出實測波形")
        finally:
            browser.close()
    if failures:
        print("FAIL external waveforms", failures)
        sys.exit(1)
    print("OK external waveforms")
    sys.exit(0)


if __name__ == "__main__":
    main()
