"""驗證埋點：事件是否產生、meta 是否只含白名單欄位、重整後緩衝的行為。

執行：python tools/verify/metrics.py
依賴：requirements-dev.txt（playwright）＋已建置的單檔前端。
腳本自己起靜態服務（隨機埠），外部請求一律封鎖，跑到的是本機建置。
"""

import json
import sys

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

ALLOWED = {"storyId", "durationMs", "ratio", "zoom", "engine", "view", "source", "count", "event"}


def main() -> None:
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            errors = []
            page.on("pageerror", lambda e: errors.append("pageerror:" + str(e)))
            page.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(8500)

            page.evaluate("() => VTN.metrics.clear()")
            print("startMode", page.evaluate("() => ({mode: VTN.stories.mode(), view: document.body.getAttribute('data-view')})"))

            print("mapStatus", page.evaluate("() => VTN.map.status()"))
            page.evaluate("() => VTN.map.trackPinClick('YL-001')")
            page.wait_for_timeout(900)

            page.evaluate("() => VTN.audio.playStory('YL-001', 0)")
            page.wait_for_timeout(2600)
            page.evaluate("() => VTN.audio.pauseStory()")
            page.wait_for_timeout(500)

            page.evaluate("() => VTN.audio.playStory('YL-001', 45)")
            page.wait_for_timeout(2800)

            page.evaluate("() => VTN.router.go('home')")
            page.wait_for_timeout(700)

            data = page.evaluate("() => VTN.metrics.debug()")
            events = [e["event"] for e in data["recent"]]
            print("count", data["count"])
            print("recent", json.dumps(data["recent"], ensure_ascii=False))
            print("eventsSeen", sorted(set(events)))
            bad = [e for e in data["recent"] if not set(e["meta"]).issubset(ALLOWED)]
            print("metaWhitelistViolations", len(bad))

            page.reload(wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(1200)
            print("afterReload", page.evaluate("() => VTN.metrics.debug().count"))
            print("errors", errors[-6:])
        finally:
            browser.close()

    failed = bool(bad) or bool(errors)
    print("FAIL" if failed else "OK", "metrics")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
