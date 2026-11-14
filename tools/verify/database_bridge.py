"""Verify completed-record persistence from the frontend API contract to storage."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + label + (f" — {detail}" if detail else ""))
    if not ok:
        raise SystemExit(1)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vtn-db-bridge-") as tmp:
        root = Path(tmp)
        os.environ["VTN_DB_PATH"] = str(root / "records.db")
        os.environ["VTN_RECORDS_DIR"] = str(root / "audio")
        os.environ["VTN_DEMO_AUTH"] = "1"
        os.environ["VTN_DEMO_ALLOW_ADMIN"] = "1"

        from fastapi.testclient import TestClient

        import server

        client = TestClient(server.app)

        def login(name: str) -> dict:
            response = client.post(
                "/api/auth/verify",
                json={"school_id": name, "password": "demo-pass"},
            )
            check(f"login succeeds for {name}", response.status_code == 200, response.text)
            return {"Authorization": "Bearer " + response.json()["token"]}

        user_a = login("db-bridge-a")
        user_b = login("db-bridge-b")
        record = {
            "id": "REC-DB-BRIDGE",
            "createdAt": 1762999999000,
            "updatedAt": 1762999999000,
            "status": "done",
            "source": "demo",
            "scope": "private",
            "title": "Database bridge verification",
            "rawText": "frontend to sqlite",
            "formalText": "frontend to sqlite",
            "words": [],
            "qaList": [],
        }

        health = client.get("/api/health").json()
        check("health reports database storage ready", health.get("storage_ready") is True)
        created = client.post("/api/records", headers=user_a, json=record)
        check("frontend-style POST /api/records succeeds", created.status_code == 200, created.text)
        check("created record keeps scope", created.json()["record"]["scope"] == "private")

        db = sqlite3.connect(root / "records.db")
        try:
            row = db.execute(
                "SELECT owner, scope, data_json FROM records WHERE id=?",
                ("REC-DB-BRIDGE",),
            ).fetchone()
        finally:
            db.close()
        check("record exists as a physical SQLite row", row is not None)
        check("server derives owner from signed identity", row[0] == "db-bridge-a@school.demo")
        check("scope is persisted in SQLite", row[1] == "private")
        check("record JSON is persisted", json.loads(row[2])["title"] == record["title"])

        own_list = client.get("/api/records", headers=user_a).json()
        check("frontend-style GET returns the saved record", own_list.get("count") == 1)
        check(
            "private record is readable by owner",
            client.get("/api/records/REC-DB-BRIDGE", headers=user_a).status_code == 200,
        )
        check(
            "private record is blocked for another visitor",
            client.get("/api/records/REC-DB-BRIDGE", headers=user_b).status_code == 403,
        )
        updated = dict(record, scope="public", updatedAt=1763000000000)
        check("metadata update succeeds", client.post("/api/records", headers=user_a, json=updated).status_code == 200)
        check(
            "ordinary sync cannot publish a private record",
            client.get("/api/records/REC-DB-BRIDGE", headers=user_a).json()["scope"] == "private",
        )
        check("backend-first delete succeeds", client.delete("/api/records/REC-DB-BRIDGE", headers=user_a).status_code == 200)
        check(
            "record is removed from database",
            client.get("/api/records/REC-DB-BRIDGE", headers=user_a).status_code == 404,
        )

        api_js = (ROOT / "frontend/src/js/15-api.js").read_text(encoding="utf-8")
        store_js = (ROOT / "frontend/src/js/10-store.js").read_text(encoding="utf-8")
        recorder_js = (ROOT / "frontend/src/js/40-recorder.js").read_text(encoding="utf-8")
        recordings_js = (ROOT / "frontend/src/js/45-recordings.js").read_text(encoding="utf-8")
        stories_js = (ROOT / "frontend/src/js/30-stories.js").read_text(encoding="utf-8")
        init_js = (ROOT / "frontend/src/js/99-init.js").read_text(encoding="utf-8")
        bundled = (ROOT / "frontend/voices-of-the-north-app.html").read_text(encoding="utf-8")
        check("frontend create/pull/delete API exists", all(
            marker in api_js for marker in ("/api/records", "syncIfSynced", "pullRecords", "deleteRecord")
        ))
        check("record mutations emit sync event", "vtn:record-updated" in store_js)
        check(
            "server acknowledgements suppress accidental resync",
            "{ suppressSync: true }" in recordings_js
            and "detail.suppressSync" in init_js,
        )
        check(
            "completed and demo records trigger sync",
            "syncToServer(updated)" in recorder_js and "syncToServer(saved.record)" in recorder_js,
        )
        check("approved stories can refresh from the server", "refreshFromServer" in bundled)
        check(
            "reviewer queue uses the contribution API",
            "contributions.list('submitted')" in recordings_js
            and "reviewOnly: !!rec._reviewOnly" in recordings_js,
        )
        check(
            "empty server catalog clears local stories",
            "if (!Array.isArray(stories)) return false;" in stories_js,
        )
        check("startup pulls remote database records", "pullRemoteRecords" in init_js)
        check("bundled frontend contains database bridge", "syncIfSynced" in bundled and "/api/records" in bundled)
        print("\nALL PASSED: completed-record frontend ↔ database bridge")


if __name__ == "__main__":
    main()
