"""Era changes must update stories without moving either supported map camera.

Run after build: python tools/verify/era_camera.py
The real app and engine integration run with deterministic, intercepted CDN engine
doubles. This catches camera API calls independently of tile/CDN availability;
it does not claim to validate real WebGL rendering or animation behavior.
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

FIXTURE = (Path(__file__).parent / "fixtures" / "map_engines.js").read_text(encoding="utf-8")
CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def open_page(browser, base, engine):
    page = browser.new_page(viewport={"width": 390, "height": 844}, reduced_motion="reduce")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    origin = base.split("/voices-")[0]

    def route(request):
        url = request.request.url
        if url.startswith(origin):
            request.continue_()
        elif "maplibre-gl.js" in url and engine == "maplibre":
            request.fulfill(content_type="application/javascript", body=FIXTURE)
        elif "leaflet.min.js" in url and engine == "leaflet":
            request.fulfill(content_type="application/javascript", body=FIXTURE)
        else:
            request.abort()

    page.route("**/*", route)
    page.add_init_script("localStorage.setItem('vtn.v2.onboarded','1')")
    page.add_init_script(f"window.__cameraEngine = '{engine}'")
    page.goto(base + "#stories", wait_until="domcontentloaded")
    page.wait_for_function("window.VTN_READY === true")
    page.wait_for_function("engine => VTN.map.status() === engine", arg=engine)
    return page, errors


def snapshot(page):
    return page.evaluate("() => window.__cameraFixture.snapshot()")


def seed(page, zoom, tilted=False):
    page.evaluate("""camera => window.__cameraFixture.seed(camera)""", {
        "center": [114.104321, 22.481234], "zoom": zoom,
        "pitch": 53 if tilted else 0, "bearing": -27 if tilted else 0,
    })


def unchanged(page, label, action):
    before = snapshot(page)
    action()
    after = snapshot(page)
    check(label + " preserves center/zoom/orientation", after["camera"] == before["camera"], after)
    check(label + " calls no camera method", after["calls"] == before["calls"], after)


def era_actions(page, engine, zoom):
    prefix = f"{engine} zoom={zoom}"
    page.evaluate("() => VTN.stories.clearFilters()")
    seed(page, zoom, tilted=engine == "maplibre")
    for index in range(5):
        unchanged(page, f"{prefix} decade {index}",
                  lambda index=index: page.locator(f"#atlasTicks [data-era-index='{index}']").click())
    unchanged(page, prefix + " All eras", lambda: page.locator("#atlasEraAll").click())
    for key in ("Home", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "End"):
        unchanged(page, prefix + " slider " + key, lambda key=key: page.locator("#atlasEra").press(key))
    page.locator("#atlasEraAll").click()

    def drag_slider():
        box = page.locator("#atlasEra").bounding_box()
        y = box["y"] + box["height"] / 2
        page.mouse.move(box["x"] + 9, y)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] - 9, y, steps=10)
        page.mouse.up()

    unchanged(page, prefix + " pointer slider", drag_slider)
    check(prefix + " pointer selects modern bucket", page.evaluate(
        "() => VTN.stories.currentParams().decade") == 1990)
    unchanged(page, prefix + " public helper with legacy fit flag", lambda: page.evaluate(
        "() => VTN.stories.filterStoriesByEra(1960, {fit:true})"))
    unchanged(page, prefix + " setEra with legacy fit flag", lambda: page.evaluate(
        "() => VTN.stories.setEra(2, {fit:true})"))
    unchanged(page, prefix + " open filter panel", lambda: page.locator("#filterToggle").click())
    unchanged(page, prefix + " year filter chip", lambda: page.locator("#filterEra button").first.click())
    unchanged(page, prefix + " finish year filters", lambda: page.locator("#filterDone").click())
    page.locator("#filterToggle").click()
    unchanged(page, prefix + " clear year filters", lambda: page.locator("#filterClear").click())
    unchanged(page, prefix + " close filter panel", lambda: page.locator("#filterClose").click())


def edge_actions(page, engine):
    page.evaluate("() => VTN.stories.clearFilters()")
    page.locator("#storySearch").fill("__no_matching_story_camera_test__")
    page.wait_for_function("VTN.stories.filtered().length === 0")
    seed(page, 16.5, tilted=engine == "maplibre")
    unchanged(page, engine + " empty results decade", lambda: page.locator(
        "#atlasTicks [data-era-index='4']").click())
    unchanged(page, engine + " empty results All", lambda: page.locator("#atlasEraAll").click())
    check(engine + " empty results stay explicit", page.locator("#mapEmpty").is_visible())

    page.evaluate("""() => {
      VTN.stories.clearFilters();
      const story = VTN.stories.visible().find(story => story.year < 1990);
      VTN.stories.select(story.id, {updateUrl:false});
    }""")
    seed(page, 17, tilted=engine == "maplibre")
    unchanged(page, engine + " excluding selected story", lambda: page.evaluate(
        "() => VTN.stories.filterStoriesByEra(1990, {fit:true})"))
    check(engine + " excluded selection cleared", page.evaluate("VTN.stories.selectedId()") is None)

    page.evaluate("() => VTN.stories.clearFilters()")
    seed(page, 16.5)
    before = snapshot(page)["camera"]
    page.locator("#atlasZoomIn").click()
    check(engine + " explicit zoom in works", snapshot(page)["camera"]["zoom"] == before["zoom"] + 1)
    page.locator("#atlasZoomOut").click()
    check(engine + " explicit zoom out works", snapshot(page)["camera"]["zoom"] == before["zoom"])
    page.locator("#atlasRecenter").click()
    check(engine + " explicit recenter still works", snapshot(page)["camera"] != before)
    check(engine + " explicit recenter fits stories", "fitBounds" in snapshot(page)["calls"])


def main():
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            for engine in ("maplibre", "leaflet"):
                page, errors = open_page(browser, base, engine)
                for zoom in (8, 12, 17):
                    era_actions(page, engine, zoom)
                edge_actions(page, engine)
                check(engine + " no runtime errors", not errors, errors)
                page.close()
        finally:
            browser.close()
    print(f"ALL PASSED: {CHECKS} checks")


if __name__ == "__main__":
    main()
