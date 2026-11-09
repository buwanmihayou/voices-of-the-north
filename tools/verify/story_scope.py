"""Regression checks for the story-map / assistant query scope.

Run after building: python tools/verify/story_scope.py
All backend state uses a temporary directory; browser requests stay local.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def backend_checks():
    from fastapi.testclient import TestClient
    import server

    with TestClient(server.app) as client:
        box = "113.98,22.43,114.03,22.47"
        mapped = client.get("/api/stories", params={"bbox": box}).json()
        answer = client.post("/api/ask-village", json={
            "question": "元朗", "bbox": box,
        }).json()
        ids = [s["id"] for s in mapped["stories"]]
        check("map metadata describes the clipped set",
              mapped["visibleIds"] == ids and mapped["visibleCount"] == len(ids), mapped)
        check("map and assistant report identical scope",
              answer["visibleIds"] == ids and answer["visibleCount"] == len(ids))
        for payload in ({"bbox": "120,30,121,31"}, {"storyIds": []},
                        {"storyIds": ["unknown"]}, {"storyIds": ["KT-002"], "bbox": box}):
            result = client.post("/api/ask-village", json={"question": "元朗", **payload}).json()
            check(f"empty intersection refuses: {payload}",
                  result["visibleIds"] == [] and not result["inScope"] and not result["sources"])
        scoped = client.post("/api/ask-village", json={
            "question": "元朗", "storyIds": ["YL-001", "YL-001", "unknown"], "bbox": box,
        }).json()
        check("IDs only narrow the authorized set", scoped["visibleIds"] == ["YL-001"])
        check("authorized matching stories still answer", scoped["inScope"] and
              {s["storyId"] for s in scoped["sources"]} == {"YL-001"})
        for invalid in ("YL-001", [None], [123], {}):
            response = client.post("/api/ask-village", json={"question": "元朗", "storyIds": invalid})
            check(f"malformed ID selection returns 400: {invalid}", response.status_code == 400)

        # A client-supplied ID must never restore unauthorized or withdrawn content.
        from unittest.mock import patch
        stories = server.load_data()["stories"]
        private = {**stories[0], "scope": "private", "owner": "someone@example.test"}
        unauthorized = {**stories[1], "authorized": False}
        with patch("story_corpus.all_stories", return_value=[private, unauthorized]):
            denied = client.post("/api/ask-village", json={
                "question": "元朗", "storyIds": [private["id"], unauthorized["id"]],
            }).json()
            check("requested IDs cannot bypass authorization", denied["visibleIds"] == [])
        with patch.object(server, "_withdrawn_ids", return_value={"YL-001"}):
            withdrawn = client.post("/api/ask-village", json={
                "question": "元朗", "storyIds": ["YL-001"],
            }).json()
            check("requested IDs cannot restore withdrawn stories", withdrawn["visibleIds"] == [])


def frontend_checks():
    from playwright.sync_api import sync_playwright
    from _harness import frontend_server, launch_browser

    with frontend_server() as base, sync_playwright() as playwright:
        browser = launch_browser(playwright)
        try:
            page = browser.new_page(viewport={"width": 390, "height": 844})
            page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(base.split("/voices-")[0]) else r.abort())
            page.goto(base + "#stories", wait_until="domcontentloaded")
            page.wait_for_function("window.VTN_READY === true")
            # Stub bounds, not the retrieval implementation; CDN maps are blocked.
            outside = page.evaluate("""() => {
              VTN.map.bbox = () => [[120, 30], [121, 31]];
              return VTN.assistant.localAnswer('元朗');
            }""")
            check("offline answers respect empty map viewport", not outside["inScope"], outside)
            filtered = page.evaluate("""() => {
              VTN.map.bbox = () => [[113.8, 22.2], [114.5, 22.6]];
              VTN.stories.applyParams({storyType: 'festival'});
              return {answer: VTN.assistant.localAnswer('元朗'),
                      context: VTN.stories.queryContext()};
            }""")
            check("offline answers respect story filters", not filtered["answer"]["inScope"])
            expected = filtered["context"]["storyIds"]
            check("query scope contains only selected types", expected == ["KT-002"], expected)

            requests = []

            def refuse(route):
                requests.append(route.request.post_data_json)
                route.fulfill(json={"inScope": False, "answer": "No match", "sources": [],
                                    "visibleIds": [], "visibleCount": 0})

            page.route("**/api/ask-village", refuse)
            page.evaluate("() => VTN.api.ask('元朗')")
            check("API sends the same filtered story IDs", set(requests[-1]["storyIds"]) == set(expected))

            # Authoritative server refusal must survive even when the local corpus matches.
            page.evaluate("""() => {
              VTN.stories.clearFilters();
              VTN.api.aiState = () => ({state: 'degraded'});
              VTN.assistant.open(false);
              VTN.assistant.ask('元朗');
            }""")
            page.wait_for_function("!document.querySelector('.vtn-ai-input').disabled")
            message = page.evaluate("() => VTN.store.chat.load().messages.slice(-1)[0]")
            check("server refusal is not overridden by global local search", not message["sources"], message)

            def reply(route):
                route.fulfill(json={"inScope": True, "answer": "Authorized server answer", "sources": [
                    {"storyId": "YL-001", "start": 0, "end": 17.5},
                ], "visibleIds": ["YL-001"]})

            page.unroute("**/api/ask-village", refuse)
            page.route("**/api/ask-village", reply)
            page.evaluate("() => VTN.assistant.ask('元朗')")
            page.wait_for_function("!document.querySelector('.vtn-ai-input').disabled")
            message = page.evaluate("() => VTN.store.chat.load().messages.slice(-1)[0]")
            check("valid server answers and citations still display",
                  message["content"] == "Authorized server answer" and
                  message["sources"][0]["storyId"] == "YL-001", message)

            def mixed_reply(route):
                route.fulfill(json={"inScope": True, "answer": "Answer containing an invalid source", "sources": [
                    {"storyId": "YL-001", "start": 0}, {"storyId": "unknown", "start": 0},
                ], "visibleIds": ["YL-001"]})

            page.unroute("**/api/ask-village", reply)
            page.route("**/api/ask-village", mixed_reply)
            page.evaluate("() => VTN.assistant.ask('元朗')")
            page.wait_for_function("!document.querySelector('.vtn-ai-input').disabled")
            message = page.evaluate("() => VTN.store.chat.load().messages.slice(-1)[0]")
            check("mixed invalid sources discard the entire server answer",
                  message["content"] != "Answer containing an invalid source" and
                  {s["storyId"] for s in message["sources"]} == {"YL-001"}, message)

            # Context is captured before the async request, including an empty ID selection.
            page.unroute("**/api/ask-village", mixed_reply)
            pending = []
            page.route("**/api/ask-village", lambda route: pending.append(route))
            with page.expect_request("**/api/ask-village"):
                page.evaluate("""() => {
                  VTN.map.bbox = () => [[120, 30], [121, 31]];
                  VTN.assistant.ask('元朗');
                }""")
            page.evaluate("() => { VTN.map.bbox = () => [[113.8,22.2],[114.5,22.6]]; }")
            check("request captures empty map selection", pending[0].request.post_data_json["storyIds"] == [])
            pending[0].abort()
            page.wait_for_function("!document.querySelector('.vtn-ai-input').disabled")
            message = page.evaluate("() => VTN.store.chat.load().messages.slice(-1)[0]")
            check("failed requests retain their original scope", not message["sources"], message)

            page.evaluate("() => VTN.router.go('home')")
            home = page.evaluate("() => VTN.assistant.localAnswer('元朗')")
            check("home assistant ignores stale hidden-map bounds", home["inScope"], home)
            page.evaluate("() => VTN.router.go('stories', {view: 'list'})")
            listed = page.evaluate("""() => {
              VTN.map.bbox = () => [[120, 30], [121, 31]];
              return VTN.assistant.localAnswer('元朗');
            }""")
            check("list assistant ignores hidden map bounds", listed["inScope"], listed)
        finally:
            browser.close()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="vtn-story-scope-") as tmp:
        os.environ["VTN_DB_PATH"] = str(Path(tmp) / "records.db")
        os.environ["VTN_LAB_DB"] = str(Path(tmp) / "lab.db")
        os.environ["VTN_RECORDS_DIR"] = str(Path(tmp) / "records")
        backend_checks()
        frontend_checks()
    print(f"ALL PASSED: {CHECKS} checks")
