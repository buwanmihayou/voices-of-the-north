"""Check the advertised English question against the API and offline retriever.

Run after building: python -X utf8 tools/verify/english_retrieval.py
Uses temporary backend storage and Node.js (no browser or external services).
The offline harness runs the real assistant module with explicit visibility and
query-scope inputs; it does not replace the retrieval/scoring implementation.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
QUESTIONS = (
    "What was Yuen Long like when you were a child?",
    "細個元朗周邊係點㗎？",
    "WHAT WAS YUEN LONG LIKE WHEN YOU WERE A CHILD?!",
)
UNSUPPORTED = "What was your childhood like?"
CHECKS = 0


def check(label, condition, detail=None):
    global CHECKS
    if not condition:
        raise AssertionError(f"{label}: {detail}")
    CHECKS += 1
    print(f"PASS {label}", flush=True)


def is_expected_answer(result, expected_text):
    sources = result.get("sources") or []
    return (result.get("inScope") is True and result.get("answer") == expected_text
            and len(sources) == 1 and sources[0].get("storyId") == "YL-001"
            and sources[0].get("start") == 0)


def is_refusal(result):
    return result.get("inScope") is False and not result.get("sources")


def backend_checks(data):
    from fastapi.testclient import TestClient
    import server

    story = next(s for s in data["stories"] if s["id"] == "YL-001")
    with TestClient(server.app) as client:
        def ask(question=QUESTIONS[0], **scope):
            response = client.post("/api/ask-village", json={
                "question": question, "lang": "en", **scope,
            })
            response.raise_for_status()
            return response.json()

        for question in QUESTIONS:
            result = ask(question)
            check(f"API returns YL-001 00:00: {question}",
                  is_expected_answer(result, story["segments"][0]["text"]), result)
        unsupported = ask(UNSUPPORTED)
        check("API refuses unsupported generic English question",
              is_refusal(unsupported) and
              unsupported["answer"] == data["outOfScopeMessage"]["en"], unsupported)
        for label, scope in (
            ("empty story selection", {"storyIds": []}),
            ("selection excluding YL-001", {"storyIds": ["KT-002"]}),
            ("viewport excluding YL-001", {"bbox": "120,30,121,31"}),
        ):
            result = ask(**scope)
            check(f"API refuses {label}", is_refusal(result), result)

        for label, replacement in (
            ("unauthorized", {**story, "authorized": False}),
            ("private", {**story, "scope": "private", "owner": "other@example.test"}),
        ):
            with patch("story_corpus.all_stories", return_value=[replacement]):
                result = ask(storyIds=["YL-001"])
                check(f"API cannot restore {label} YL-001 by ID",
                      is_refusal(result) and result["visibleIds"] == [], result)
        with patch.object(server, "_withdrawn_ids", return_value={"YL-001"}):
            result = ask(storyIds=["YL-001"])
            check("API cannot restore withdrawn YL-001 by ID",
                  is_refusal(result) and result["visibleIds"] == [], result)


NODE_HARNESS = r"""
const fs = require('fs');
const vm = require('vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const data = input.data;
let visible = data.stories;
let selected = data.stories.map(story => story.id);
const VTN = {
  util: {fmtTime: value => String(Math.floor(value / 60)).padStart(2, '0') + ':' +
                          String(Math.floor(value % 60)).padStart(2, '0')},
  i18n: {lang: () => 'en', t: () => ''},
  stories: {
    visible: () => visible,
    queryContext: () => ({storyIds: selected, includeRecords: false})
  },
  store: {records: {list: () => []}}
};
const context = vm.createContext({window: {VTN, VTN_STORY_DATA: data}});
vm.runInContext(input.code, context, {filename: '50-assistant.js'});
const answer = question => VTN.assistant.localAnswer(question);
const results = input.questions.map(answer);
results.push(answer(input.unsupported));
selected = [];
results.push(answer(input.questions[0]));
selected = ['KT-002'];
results.push(answer(input.questions[0]));
selected = ['YL-001'];
visible = data.stories.map(story => story.id === 'YL-001'
  ? {...story, authorized: false} : story);
results.push(answer(input.questions[0]));
// Upstream visibility excludes private/withdrawn stories; keep the requested ID
// to ensure the offline retriever cannot restore unavailable corpus content.
visible = data.stories.filter(story => story.id !== 'YL-001');
results.push(answer(input.questions[0]));
process.stdout.write(JSON.stringify(results));
"""


def offline_checks(data):
    html = (ROOT / "frontend" / "voices-of-the-north-app.html").read_text(encoding="utf-8")
    payload = re.search(r"window\.VTN_STORY_DATA = (\{[^\n]+\});", html)
    check("built offline corpus matches data/stories.json",
          payload is not None and json.loads(payload.group(1)) == data)
    code = (ROOT / "frontend" / "src" / "js" / "50-assistant.js").read_text(encoding="utf-8")
    check("built page contains the current assistant module", code.strip() in html)
    run = subprocess.run(
        ["node", "-e", NODE_HARNESS], cwd=ROOT,
        input=json.dumps({"data": json.loads(payload.group(1)), "code": code,
                          "questions": QUESTIONS, "unsupported": UNSUPPORTED}),
        text=True, encoding="utf-8", capture_output=True, check=True,
    )
    results = json.loads(run.stdout)
    story = next(s for s in data["stories"] if s["id"] == "YL-001")
    for question, result in zip(QUESTIONS, results[:3]):
        check(f"offline returns YL-001 00:00: {question}",
              is_expected_answer(result, story["segments"][0]["text"]), result)
    for label, result in zip(
        ("unsupported generic English question", "empty story selection",
         "selection excluding YL-001", "unauthorized YL-001",
         "YL-001 absent from visible corpus"), results[3:],
    ):
        check(f"offline refuses {label}", is_refusal(result), result)


if __name__ == "__main__":
    data = json.loads((ROOT / "data" / "stories.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="vtn-english-retrieval-") as tmp:
        os.environ["VTN_DATA_DIR"] = str(Path(tmp) / "data")
        os.environ["VTN_STORY_DATA"] = str(ROOT / "data" / "stories.json")
        os.environ["VTN_DB_PATH"] = str(Path(tmp) / "records.db")
        os.environ["VTN_LAB_DB"] = str(Path(tmp) / "lab.db")
        os.environ["VTN_RECORDS_DIR"] = str(Path(tmp) / "records")
        backend_checks(data)
        offline_checks(data)
    print(f"ALL PASSED: {CHECKS} checks")
