"""Story-era UI regression: exclusive decade buckets and shared map/query scope.

Run after building: python tools/verify/era_filter.py
Uses only the random-port static harness and in-browser synthetic stories.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from _harness import frontend_server, launch_browser, warn_if_stale

ROOT = Path(__file__).resolve().parents[2]
YEARS = [1950, 1960, 1970, 1980, 1990]
LABELS = ["1950", "1960", "1970", "1980", "1990+"]
CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def snapshot(page):
    return page.evaluate("""() => ({
      ids: VTN.stories.filtered().map(s => s.id).sort(),
      list: Array.from(document.querySelectorAll('#storyList [data-story]'), n => n.dataset.story).sort(),
      context: VTN.stories.queryContext({bbox: null}).storyIds.sort(),
      map: (window.eraMapIds || []).slice().sort(),
      all: document.getElementById('atlasEraAll').getAttribute('aria-pressed'),
      muted: document.getElementById('atlasTimeline').classList.contains('is-all'),
      pressed: Array.from(document.querySelectorAll('#atlasTicks [aria-pressed="true"]'), n => Number(n.dataset.eraIndex)),
      value: Number(document.getElementById('atlasEra').value),
      params: VTN.stories.currentParams()
    })""")


def assert_scope(page, expected, label, index=None):
    state = snapshot(page)
    expected = sorted(expected)
    for surface in ("ids", "list", "context", "map"):
        check(f"{label}: {surface} share the expected stories", state[surface] == expected, state)
    check(f"{label}: all and decade states are exclusive",
          state["all"] == ("true" if index is None else "false") and
          state["muted"] == (index is None) and
          state["pressed"] == ([] if index is None else [index]), state)
    check(f"{label}: map empty state matches current results",
          page.locator("#mapEmpty").is_visible() == (not expected))
    if index is not None:
        check(f"{label}: slider snaps to selected tick", state["value"] == index, state)
    return state


def install_map_observer(page):
    page.evaluate("""() => {
      const update = VTN.map.update;
      VTN.map.update = next => {
        window.eraMapIds = next.stories.map(s => s.id);
        return update(next);
      };
      VTN.map.bbox = () => [[113.8, 22.2], [114.5, 22.6]];
      VTN.stories.render();
    }""")


def open_page(browser, base, width=390, height=844):
    page = browser.new_page(viewport={"width": width, "height": height})
    origin = base.split("/voices-")[0]
    page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(origin) else r.abort())
    page.add_init_script("localStorage.setItem('vtn.v2.onboarded','1')")
    page.goto(base + "#stories", wait_until="domcontentloaded")
    page.wait_for_function("window.VTN_READY === true")
    install_map_observer(page)
    return page


def capture_states(browser, base):
    output = ROOT / "docs" / "audit" / "2026-11-11"
    output.mkdir(parents=True, exist_ok=True)
    for width, height in ((390, 844), (320, 568)):
        page = open_page(browser, base, width=width, height=height)
        page.wait_for_function("""() => {
          const loading = document.getElementById('mapLoading');
          return loading.classList.contains('is-hidden') && Number(getComputedStyle(loading).opacity) === 0;
        }""")
        # The map is intentionally offline; captures verify the controls and card.
        page.locator("#atlasEraAll").screenshot(path=str(output / f"era-pill-{width}.png"))
        page.screenshot(path=str(output / f"era-all-{width}.png"))
        page.locator("#atlasTicks [data-era-index='1']").click()
        page.screenshot(path=str(output / f"era-1960-{width}.png"))
        page.close()
    print(f"Screenshots: {output}", flush=True)


def compact_layout_checks(page):
    layout = page.evaluate("""() => {
      const rect = node => {
        const r = node.getBoundingClientRect();
        return {left:r.left, right:r.right, top:r.top, bottom:r.bottom};
      };
      const timeline = rect(document.getElementById('atlasTimeline'));
      const overlaps = other => timeline.left < other.right && timeline.right > other.left &&
        timeline.top < other.bottom && timeline.bottom > other.top;
      const targets = ['#atlasEraAll', '#atlasEra',
        '#atlasTicks [data-era-index="0"]', '#atlasTicks [data-era-index="4"]'];
      return {
        controls: targets.map(selector => {
          const node = document.querySelector(selector), r = rect(node);
          const hit = document.elementFromPoint((r.left+r.right)/2, (r.top+r.bottom)/2);
          return {selector, reachable:!!hit && (hit === node || node.contains(hit)),
            hit:hit ? hit.id || hit.className : null, rect:r};
        }),
        clashes: ['#atlasLegend', '.atlas__searchrow'].map(selector => ({
          selector, overlaps:overlaps(rect(document.querySelector(selector)))
        })), timeline
      };
    }""")
    for control in layout["controls"]:
        check(f"320×568 center is reachable: {control['selector']}", control["reachable"], control)
    for clash in layout["clashes"]:
        check(f"320×568 timeline does not overlap {clash['selector']}", not clash["overlaps"], layout)


def real_corpus_checks(page):
    stories = json.loads((ROOT / "data" / "stories.json").read_text(encoding="utf-8"))["stories"]
    all_ids = [s["id"] for s in stories]
    expected = [
        [s["id"] for s in stories if s["year"] < 1960],
        [s["id"] for s in stories if 1960 <= s["year"] < 1970],
        [s["id"] for s in stories if 1970 <= s["year"] < 1980],
        [s["id"] for s in stories if 1980 <= s["year"] < 1990],
        [s["id"] for s in stories if s["year"] >= 1990],
    ]
    assert_scope(page, all_ids, "default all")
    check("five chronological tick labels", page.locator("#atlasTicks button").all_text_contents() == LABELS)
    check("range has five equal index positions", page.locator("#atlasEra").get_attribute("max") == "4" and
          page.locator("#atlasEra").get_attribute("step") == "1")
    for index, ids in enumerate(expected):
        page.locator(f"#atlasTicks [data-era-index='{index}']").click()
        assert_scope(page, ids, f"click {LABELS[index]}", index)
    check("modern bucket empty state matches its results", page.locator("#mapEmpty").is_visible() == (not expected[4]))

    page.locator("#atlasEraAll").click()
    assert_scope(page, all_ids, "reset all")
    page.locator("#atlasEra").press("Home")
    assert_scope(page, expected[0], "keyboard Home activates first bucket", 0)
    for index in range(1, 5):
        page.locator("#atlasEra").press("ArrowRight")
        assert_scope(page, expected[index], f"keyboard {LABELS[index]}", index)

    page.locator("#atlasEraAll").click()
    slider = page.locator("#atlasEra").bounding_box()
    page.mouse.move(slider["x"] + slider["width"] / 2, slider["y"] + slider["height"] / 2)
    page.mouse.down()
    page.mouse.move(slider["x"] + slider["width"] - 8, slider["y"] + slider["height"] / 2, steps=10)
    page.mouse.up()
    assert_scope(page, expected[4], "pointer drag selects modern bucket", 4)

    page.locator("#atlasTicks [data-era-index='1']").click()
    state = snapshot(page)
    check("specific era has a shareable decade parameter", str(state["params"].get("decade")) == "1960", state)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("window.VTN_READY === true")
    install_map_observer(page)
    assert_scope(page, expected[1], "reload preserves chosen decade", 1)
    page.locator("#atlasEraAll").click()
    check("all reset removes the decade parameter", "decade" not in snapshot(page)["params"])


def boundary_checks(page):
    # Clone a known-valid authorized story while changing only fixture identity/year.
    page.evaluate("""() => {
      const source = VTN.stories.meta().stories[0];
      const years = [1900, 1959, 1960, 1969, 1970, 1979, 1980, 1989, 1990, 2026];
      const fixtures = years.map(year => Object.assign({}, source, {
        id: 'edge-' + year, title: 'Boundary ' + year, year,
        eraKey: Math.floor(year / 10) * 10 + 's', audio: null
      }));
      const fallback = Object.assign({}, source, {id:'edge-fallback', year:null, eraKey:'1960s', audio:null});
      const unknown = Object.assign({}, source, {id:'edge-unknown', year:null, eraKey:'unknown', audio:null});
      VTN.stories.meta().stories = fixtures.concat([fallback, unknown]);
      VTN.stories.clearFilters();
    }""")
    expected = [
        ["edge-1900", "edge-1959"],
        ["edge-1960", "edge-1969", "edge-fallback"],
        ["edge-1970", "edge-1979"],
        ["edge-1980", "edge-1989"],
        ["edge-1990", "edge-2026"],
    ]
    all_ids = sum(expected, []) + ["edge-unknown"]
    assert_scope(page, all_ids, "all includes unknown years")
    for index, ids in enumerate(expected):
        page.locator(f"#atlasTicks [data-era-index='{index}']").click()
        assert_scope(page, ids, f"exact boundaries {LABELS[index]}", index)
    check("decade buckets are mutually disjoint", len(set(sum(expected, []))) == len(sum(expected, [])))

    page.locator("#atlasTicks [data-era-index='1']").click()
    page.locator("#atlasViewBtn").click()
    check("list view preserves era", page.locator("#atlasList").is_visible())
    assert_scope(page, expected[1], "list parity", 1)
    page.locator("#atlasListBack").click()

    page.evaluate("() => VTN.stories.select('edge-1960', {updateUrl:false, focus:false})")
    check("story initially selected", page.evaluate("() => VTN.stories.selectedId()") == "edge-1960")
    page.evaluate("() => VTN.stories.setEra(2)")
    check("switching buckets clears an excluded selected story", page.evaluate("() => VTN.stories.selectedId()") is None)
    assert_scope(page, expected[2], "selection cannot escape filter", 2)

    requests = []

    def reply(route):
        requests.append(route.request.post_data_json)
        route.fulfill(json={"inScope": False, "answer": "No match", "sources": [],
                            "visibleIds": [], "visibleCount": 0})

    page.route("**/api/ask-village", reply)
    page.evaluate("() => VTN.api.ask('boundary')")
    check("assistant request uses the same decade IDs", bool(requests) and
          sorted(requests[-1]["storyIds"]) == sorted(expected[2]), requests)
    page.unroute("**/api/ask-village", reply)

    page.evaluate("() => VTN.stories.filterStoriesByEra('1990+')")
    assert_scope(page, expected[4], "public era helper", 4)
    page.evaluate("() => VTN.stories.filterStoriesByEra('all')")
    assert_scope(page, all_ids, "public all helper")


def main():
    warn_if_stale()
    with frontend_server() as base, sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            if "--screenshots" in sys.argv:
                capture_states(browser, base)
            page = open_page(browser, base)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            real_corpus_checks(page)
            boundary_checks(page)
            check("no frontend runtime errors", not errors, errors)
            page.close()
            small = open_page(browser, base, width=320, height=568)
            check("320px has no horizontal overflow", small.evaluate(
                "() => document.documentElement.scrollWidth <= window.innerWidth"))
            compact_layout_checks(small)
            small.locator("#atlasTicks [data-era-index='4']").click()
            check("320px modern tick is reachable", small.locator("#atlasEraAll").get_attribute("aria-pressed") == "false")
            small.locator("#atlasEraAll").click()
            check("320px all tab is reachable", small.locator("#atlasEraAll").get_attribute("aria-pressed") == "true")
            small.close()
        finally:
            browser.close()
    print(f"ALL PASSED: {CHECKS} checks")


if __name__ == "__main__":
    main()
