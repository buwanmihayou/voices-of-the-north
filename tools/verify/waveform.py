"""驗證烘焙波形：window.VTN_WAVEFORMS 的內容、播放器畫出的波形、
以及建置期烘出的振幅與執行期解碼 WAV 的相關性。

執行：python tools/verify/waveform.py
依賴：requirements-dev.txt（playwright）＋已建置的單檔前端。
外部請求一律封鎖，因此驗證的是本機 assets/ 內的音檔；
被攔截的 CDN／靜態伺服器的 404、501 屬預期，不計入錯誤。
"""

import json
import sys

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale


def main() -> None:
    warn_if_stale()
    failures = []
    errors = []
    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())

            def on_console(message):
                if message.type != "error" or "Failed to load resource" in message.text:
                    return
                errors.append("console:" + message.text)

            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("console", on_console)
            page.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(8500)

            baked = page.evaluate("""() => ({
              len: window.VTN_WAVEFORMS['YL-001'] ? window.VTN_WAVEFORMS['YL-001'].length : 0,
              ids: Object.keys(window.VTN_WAVEFORMS || {}),
              spread: Math.max(...window.VTN_WAVEFORMS['YL-001']) - Math.min(...window.VTN_WAVEFORMS['YL-001']),
              rate: VTN.waveform.rate
            })""")
            print("baked", json.dumps(baked, ensure_ascii=False))
            if baked["len"] != 60 or baked["rate"] != 8000:
                failures.append("波形柱數或取樣率不符")

            page.evaluate("() => VTN.stories.select('YL-001')")
            page.wait_for_timeout(1200)
            wave = page.evaluate("""() => ({
              bars: document.querySelectorAll('.player__waveSvg rect').length,
              wave: document.querySelector('[data-role="track"]').getAttribute('data-wave'),
              debug: VTN.waveform.debug(),
              note: document.querySelector('[data-role="note"]').textContent
            })""")
            print("wave", json.dumps(wave, ensure_ascii=False))
            if wave["wave"] != "measured" or wave["bars"] != 120:
                failures.append("播放器未使用實測波形")
            if wave["debug"]["runtimeDecodes"]:
                failures.append("執行期不應再解碼 WAV")

            compare = page.evaluate("""() => {
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
                  n, corr: Number((num / Math.sqrt(db * dr)).toFixed(4)),
                  bakedFirst5: baked.slice(0, 5),
                  runtimeFirst5: runtime.slice(0, 5).map(v => Number(v.toFixed(3))),
                  debug: VTN.waveform.debug()
                };
              });
            }""")
            print("compare", json.dumps(compare, ensure_ascii=False))
            corr = compare.get("corr") or 0
            # 統一 8 kHz 取樣後，兩條路徑應是同一條波形（舊版為 0.918）
            if corr < 0.98:
                failures.append(f"相關係數過低：{corr}")

            print("errors", errors[-8:])
        finally:
            browser.close()

    if errors or failures:
        print("FAIL waveform", failures)
        sys.exit(1)
    print("OK waveform — 相關係數 >= 0.98")
    sys.exit(0)


if __name__ == "__main__":
    main()
