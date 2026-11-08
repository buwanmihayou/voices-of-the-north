import json
import os
import socketserver
import threading
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT / "frontend")
try:
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 8000), SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
except OSError:
    server = None
URL = "http://127.0.0.1:8000/voices-of-the-north-app.html#stories"
ALLOWED = {"storyId", "durationMs", "ratio", "zoom", "engine", "view", "source", "count", "event"}

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True,
                                args=["--enable-unsafe-swiftshader", "--no-sandbox",
                                      "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
    errors = []
    page.on("pageerror", lambda e: errors.append("pageerror:" + str(e)))
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
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
    browser.close()
