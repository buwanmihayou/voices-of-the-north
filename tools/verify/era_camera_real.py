"""Check era camera independence with the actual pinned map libraries.

Uses CDN JavaScript, a local blank MapLibre style, and no remote map tiles.
Run after building: python -X utf8 tools/verify/era_camera_real.py
"""
from __future__ import annotations

import json

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def camera(page, engine):
    return page.evaluate("""engine => {
      const map = window.eraRealMap, center = map.getCenter();
      return [center.lng, center.lat, map.getZoom()].concat(engine === 'maplibre' ?
        [map.getPitch(), map.getBearing(), map.getPadding()] : []);
    }""", engine)


def exercise(browser, base, engine):
    page = browser.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    origin = base.split("/voices-")[0]

    def route_request(route):
        url = route.request.url
        if url.startswith(origin):
            route.continue_()
        elif engine == "maplibre" and url.endswith("/maplibre-gl.js"):
            response = route.fetch(timeout=30000)
            route.fulfill(response=response, body=response.text() + """
              ;maplibregl.Map = class extends maplibregl.Map {
                constructor(options) { super(options); window.eraRealMap = this; }
              };
            """)
        elif engine == "leaflet" and url.endswith("/leaflet.min.js"):
            response = route.fetch(timeout=30000)
            route.fulfill(response=response, body=response.text() + """
              ;const originalMap = L.map;
              L.map = function(...args) {
                window.eraRealMap = originalMap.apply(this, args);
                return window.eraRealMap;
              };
            """)
        else:
            route.abort()

    page.route("**/*", route_request)
    page.add_init_script("""localStorage.setItem('vtn.v2.onboarded','1');
      window.VTN_MAP_STYLE = {version:8, sources:{}, layers:[
        {id:'blank', type:'background', paint:{'background-color':'#e8eddf'}}]};
    """)
    page.goto(base + "#stories", wait_until="domcontentloaded")
    page.wait_for_function("engine => window.VTN_READY && VTN.map.status() === engine",
                           arg=engine, timeout=45000)
    if engine == "maplibre":
        page.wait_for_function("() => !eraRealMap.isMoving()")
    version = page.evaluate(
        "engine => engine === 'maplibre' ? maplibregl.getVersion() : L.version", engine)
    check(f"{engine}: actual library loaded", version ==
          ("4.7.1" if engine == "maplibre" else "1.9.4"), version)

    for zoom in (8, 12, 17):
        page.evaluate("""({engine,zoom}) => {
          const map = window.eraRealMap;
          if (engine === 'maplibre') map.jumpTo({center:[114.127,22.496], zoom,
            pitch:zoom === 17 ? 52 : 0, bearing:zoom === 17 ? -18 : 0});
          else map.setView([22.496,114.127],zoom,{animate:false});
        }""", {"engine": engine, "zoom": zoom})
        before = camera(page, engine)
        for index in (0, 1, 2, 3, 4):
            page.locator(f"#atlasTicks [data-era-index='{index}']").click()
            # Camera fitting animates asynchronously; wait through its duration.
            page.wait_for_timeout(850)
            after = camera(page, engine)
            check(f"{engine} zoom {zoom}: decade {index} preserves camera", before == after, after)
        page.locator("#atlasEraAll").click()
        page.wait_for_timeout(850)
        check(f"{engine} zoom {zoom}: All preserves camera", before == camera(page, engine))
        page.locator("#atlasEra").press("Home")
        page.locator("#atlasEra").press("End")
        page.wait_for_timeout(850)
        check(f"{engine} zoom {zoom}: keyboard slider preserves camera", before == camera(page, engine))

    # An empty decade must keep the view instead of falling back to HK_CENTER.
    page.evaluate("""() => {
      VTN.stories.meta().stories = VTN.stories.meta().stories.filter(s => s.year < 1990);
      VTN.stories.filterStoriesByEra('all');
    }""")
    before = camera(page, engine)
    page.locator("#atlasTicks [data-era-index='4']").click()
    page.wait_for_timeout(850)
    check(f"{engine}: empty era preserves camera", page.locator("#mapEmpty").is_visible()
          and before == camera(page, engine))
    page.locator("#atlasEraAll").click()
    page.locator("#atlasZoomIn").click()
    page.wait_for_timeout(500)
    zoomed = camera(page, engine)
    check(f"{engine}: explicit zoom still works", zoomed[2] > before[2])
    page.locator("#atlasRecenter").click()
    page.wait_for_timeout(1000)
    check(f"{engine}: explicit recenter still works", camera(page, engine) != zoomed)
    check(f"{engine}: no runtime errors", not errors, errors)
    print(json.dumps({"engine": engine, "finalCamera": camera(page, engine)}), flush=True)
    page.close()


def main():
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            for engine in ("maplibre", "leaflet"):
                exercise(browser, base, engine)
        finally:
            browser.close()
    print(f"ALL PASSED: {CHECKS} checks")


if __name__ == "__main__":
    main()
