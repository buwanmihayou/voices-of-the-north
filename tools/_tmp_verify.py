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

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True,
                                args=["--enable-unsafe-swiftshader", "--no-sandbox"])
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
    page.goto(URL, wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(8500)

    print("baked", json.dumps(page.evaluate("""() => ({
      len: window.VTN_WAVEFORMS['YL-001'] ? window.VTN_WAVEFORMS['YL-001'].length : 0,
      ids: Object.keys(window.VTN_WAVEFORMS || {}),
      spread: Math.max(...window.VTN_WAVEFORMS['YL-001']) - Math.min(...window.VTN_WAVEFORMS['YL-001'])
    })"""), ensure_ascii=False))

    page.evaluate("() => VTN.stories.select('YL-001')")
    page.wait_for_timeout(1200)
    print("wave", json.dumps(page.evaluate("""() => ({
      bars: document.querySelectorAll('.player__waveSvg rect').length,
      wave: document.querySelector('[data-role="track"]').getAttribute('data-wave'),
      debug: VTN.waveform.debug(),
      note: document.querySelector('[data-role="note"]').textContent
    })"""), ensure_ascii=False))

    print("compare", json.dumps(page.evaluate("""() => {
      const baked = window.VTN_WAVEFORMS['YL-001'].slice();
      window.VTN_WAVEFORMS = {};
      return VTN.waveform.get('assets/Demo Story.wav', 'YL-001').then(runtime => {
        window.VTN_WAVEFORMS = { 'YL-001': baked };
        if (!runtime) return {runtime: null};
        const n = Math.min(baked.length, runtime.length);
        const mean = a => a.slice(0, n).reduce((x, y) => x + y, 0) / n;
        const mb = mean(baked), mr = mean(runtime);
        let num = 0, db = 0, dr = 0;
        for (let i = 0; i < n; i++) {
          const x = baked[i] - mb, y = runtime[i] - mr;
          num += x * y; db += x * x; dr += y * y;
        }
        return {
          n, corr: Number((num / Math.sqrt(db * dr)).toFixed(3)),
          bakedFirst5: baked.slice(0, 5),
          runtimeFirst5: runtime.slice(0, 5).map(v => Number(v.toFixed(3))),
          debug: VTN.waveform.debug()
        };
      });
    }"""), ensure_ascii=False))

    print("errors", errors[-8:])
    browser.close()
