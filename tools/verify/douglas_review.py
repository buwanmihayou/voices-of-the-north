"""Douglas 評審修復的回歸驗證（12 項意見）。

執行：python tools/verify/douglas_review.py
依賴：requirements.txt（fastapi）＋ requirements-dev.txt（playwright）。
後端使用暫存 DB；前端外部 CDN 一律攔截，因此地圖走降級路徑，
但 DOM、指標、年代軸、抽屜、i18n 與資料契約都可在離線下驗證。
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))
TMP = Path(tempfile.mkdtemp(prefix="vtn-douglas-test-"))
os.environ["VTN_DB_PATH"] = str(TMP / "records.db")
os.environ["VTN_RECORDS_DIR"] = str(TMP / "records")

from fastapi.testclient import TestClient  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

import server  # noqa: E402
from _harness import frontend_server, launch_browser, warn_if_stale  # noqa: E402

CHECKS = 0


def check(label, ok, detail=""):
    global CHECKS
    if not ok:
        raise AssertionError(f"FAIL {label}: {detail}")
    CHECKS += 1
    print(f"  PASS  {label} {detail}".rstrip())


def backend_checks():
    client = TestClient(server.app)
    everything = client.get("/api/stories").json()
    check("4. /api/stories 輸出可見集合",
          everything["visibleCount"] == everything["count"] and
          len(everything["visibleIds"]) == everything["count"],
          str(everything["visibleCount"]))

    bbox = "113.98,22.43,114.03,22.47"
    in_view = client.get("/api/stories?bbox=" + bbox).json()
    answer = client.post("/api/ask-village", json={
        "question": "細個元朗周邊係點㗎？", "bbox": bbox
    }).json()
    check("4. 問答與地圖共用同一視口集合",
          answer["visibleIds"] == [s["id"] for s in in_view["stories"]],
          str(answer["visibleIds"]))
    check("4. 問答來源不超出地圖視口",
          all(src["storyId"] in answer["visibleIds"] for src in answer["sources"]),
          str([s["storyId"] for s in answer["sources"]]))
    no_bbox = client.post("/api/ask-village", json={
        "question": "細個元朗周邊係點㗎？"
    }).json()
    check("4. 無 bbox 時用全域可見集合",
          set(no_bbox["visibleIds"]) == set(everything["visibleIds"]))
    check("4. 問答非法 bbox 亦回 400",
          client.post("/api/ask-village", json={"question": "元朗", "bbox": "abc"}).status_code == 400)


def frontend_checks():
    warn_if_stale()
    html = (ROOT / "frontend" / "voices-of-the-north-app.html").read_text(encoding="utf-8")
    check("6. 地圖點位不再輸出心情角標", "vtn-pin__mood" not in html)
    check("11. 減少動態分支存在",
          "atlas--reduced-motion" in html and "prefers-reduced-motion" in html)
    check("12. 外置波形 JSON 已生成",
          (ROOT / "frontend" / "waveforms.json").is_file())

    with frontend_server() as base, sync_playwright() as p:
        browser = launch_browser(p)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            page.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(3200)

            stops = page.evaluate("() => VTN.stories.eraStops()")
            check("1. 年代刻度由資料分佈產生",
                  stops == [1950, 1960, 1970, 1980, 1990], str(stops))
            counts = page.evaluate("""() => {
              const out = [];
              const n = VTN.stories.eraStops().length;
              for (let i = 0; i < n; i++) { VTN.stories.setEra(i); out.push(VTN.stories.filtered().length); }
              return out;
            }""")
            check("1. 每一格都改變過濾結果",
                  len(set(counts)) == len(counts) and counts[-1] == 8, str(counts))
            legacy = page.evaluate("""() => {
              VTN.stories.applyParams({since: '2026'});
              return VTN.stories.filtered().length;
            }""")
            check("1. 舊連結 since=2026 仍回到全部年代", legacy == 8, str(legacy))
            page.evaluate("() => VTN.stories.clearFilters()")

            funnel = page.evaluate("""() => {
              VTN.metrics.clear();
              VTN.map.trackPinClick('YL-001', 'group');
              const afterGroup = VTN.metrics.funnel();
              VTN.map.trackPinClick('YL-001', 'pin');
              const afterPin = VTN.metrics.funnel();
              VTN.stories.select('YL-001', {source: 'pin'});
              return {afterGroup, afterPin, afterOpen: VTN.metrics.funnel()};
            }""")
            check("2. 同圈氣泡只記 cluster.click",
                  funnel["afterGroup"]["cluster.click"] == 1 and
                  funnel["afterGroup"]["story.open"] == 0,
                  json.dumps(funnel["afterGroup"]))
            check("2. 一般點位記 pin.click、不記 story.open",
                  funnel["afterPin"]["pin.click"] == 1 and
                  funnel["afterPin"]["story.open"] == 0)
            check("2. 真正開啟詳情才記 story.open（分母）",
                  funnel["afterOpen"]["story.open"] == 1,
                  json.dumps(funnel["afterOpen"]))

            list_btn = page.evaluate("""() => {
              const el = document.getElementById('atlasViewBtn');
              return {shown: !!el && el.getBoundingClientRect().width > 44,
                      text: el ? el.textContent.trim() : '',
                      scene: !!document.getElementById('atlasSceneBtn')};
            }""")
            check("10. 列表入口常顯且帶文字",
                  list_btn["shown"] and "列表" in list_btn["text"], json.dumps(list_btn, ensure_ascii=False))
            check("7. 3D 書籤按鈕存在", list_btn["scene"])
            scenes = page.evaluate("() => VTN.map.sceneStops()")
            check("7. 書籤取自有座標的真實故事",
                  len(scenes) == 3 and all(len(s["center"]) == 2 for s in scenes),
                  json.dumps(scenes, ensure_ascii=False))

            wave_json = json.loads((ROOT / "frontend" / "waveforms.json").read_text(encoding="utf-8"))
            baked = page.evaluate("() => window.VTN_WAVEFORMS")
            check("12. waveforms.json 與內嵌快取一致", wave_json == baked)
            check("5. 波形取樣率標明為 8 kHz", page.evaluate("() => VTN.waveform.rate") == 8000)

            en = page.evaluate("""() => {
              VTN.i18n.setLang('en');
              return {market: VTN.i18n.t('storyType.market'),
                      list: document.getElementById('atlasViewBtn').textContent.trim(),
                      wave: VTN.i18n.t('atlas.playerMetaWave', {n: 3, dur: '00:46'})};
            }""")
            check("13. 英文墟市商貿改為 Market & Trade", en["market"] == "Market & Trade", en["market"])
            check("10. 列表按鈕跟隨語言切換", "List" in en["list"], en["list"])
            check("5. UI 標註構建期預計算", "8 kHz" in en["wave"], en["wave"])
            page.evaluate("() => VTN.i18n.setLang('zh-HK')")

            page.evaluate("() => VTN.sheet.open()")
            page.wait_for_timeout(650)
            sheet = page.evaluate("""() => {
              const el = document.getElementById('storySheet');
              const r = el.getBoundingClientRect();
              const parent = el.offsetParent ? el.offsetParent.getBoundingClientRect() : null;
              return {height: r.height, top: r.top, viewport: window.innerHeight,
                      exposed: (parent ? parent.bottom : window.innerHeight) - r.top};
            }""")
            check("8. 抽屜高度改為視口相對",
                  abs(sheet["height"] - sheet["viewport"] * 0.9) < 3,
                  json.dumps(sheet))
            check("8. 390×844 半開露出 55dvh",
                  abs(sheet["exposed"] - sheet["viewport"] * 0.55) < 12,
                  f"exposed={sheet['exposed']:.1f}px")

            small = browser.new_page(viewport={"width": 375, "height": 667})
            small.route("**/*", lambda r: r.continue_() if "127.0.0.1" in r.request.url else r.abort())
            small.goto(base + "#stories", wait_until="domcontentloaded", timeout=60000)
            small.wait_for_timeout(2200)
            small.evaluate("() => VTN.sheet.open()")
            small.wait_for_timeout(650)
            small_top = small.evaluate("""() => {
              const el = document.getElementById('storySheet');
              const r = el.getBoundingClientRect();
              const parent = el.offsetParent ? el.offsetParent.getBoundingClientRect() : null;
              return {exposed: (parent ? parent.bottom : window.innerHeight) - r.top,
                      viewport: window.innerHeight};
            }""")
            check("8. iPhone SE 375×667 半開仍露出 55dvh",
                  abs(small_top["exposed"] - small_top["viewport"] * 0.55) < 12,
                  json.dumps(small_top))
            small.close()
        finally:
            browser.close()


def main() -> None:
    try:
        print("後端：可見故事集合口徑")
        backend_checks()
        print("前端：年代軸／指標／雙編碼／書籤／抽屜／波形／文案")
        frontend_checks()
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"ALL PASSED: {CHECKS} checks")
    sys.exit(0)


if __name__ == "__main__":
    main()
