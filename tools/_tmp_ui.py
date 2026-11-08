import json
import os
import socketserver
import threading
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT / "frontend")
try:
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 8000), SimpleHTTPRequestHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
except OSError:
    server = None
URL = "http://127.0.0.1:8000/voices-of-the-north-app.html#stories"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True,
                                args=["--enable-unsafe-swiftshader", "--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page.goto(URL, wait_until="commit", timeout=30000)
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
        browser.close()
        raise SystemExit(0)

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
    page.screenshot(path=str(ROOT / "docs/audit/2026-11-07/fuzz-group.png"))
    browser.close()
