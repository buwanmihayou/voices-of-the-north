"""Issue #4 contribution, privacy, and reviewer-flow regression tests."""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def check(label: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + label + (f" — {detail}" if detail else ""))
    if not ok:
        raise SystemExit(1)


def synthetic_wav_base64(seconds: float = 0.2) -> str:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        frames = int(8000 * seconds)
        audio.writeframes(b"\x00\x00" * frames)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vtn-contribution-") as tmp:
        root = Path(tmp)
        os.environ["VTN_DB_PATH"] = str(root / "records.db")
        os.environ["VTN_RECORDS_DIR"] = str(root / "audio")
        os.environ["VTN_LAB_DB"] = str(root / "lab.db")
        os.environ["VTN_DEMO_AUTH"] = "1"
        os.environ["VTN_DEMO_ALLOW_ADMIN"] = "1"

        from fastapi.testclient import TestClient

        import server

        client = TestClient(server.app)

        def login(name: str, admin: bool = False):
            response = client.post(
                "/api/auth/verify",
                json={"school_id": name, "password": "demo-pass", "admin": admin},
            )
            check(f"login succeeds for {name}", response.status_code == 200, response.text)
            return response.json()["token"]

        token_a = login("contributor-a")
        token_b = login("contributor-b")
        token_admin = login("reviewer", admin=True)
        auth_a = {"Authorization": "Bearer " + token_a}
        auth_b = {"Authorization": "Bearer " + token_b}
        auth_admin = {"Authorization": "Bearer " + token_admin}

        def create_record(rid: str, requested_scope: str = "public"):
            response = client.post(
                "/api/records",
                headers=auth_a,
                json={
                    "id": rid,
                    "createdAt": 1763000000000,
                    "status": "done",
                    "source": "live",
                    "title": "Synthetic private contribution",
                    "formalText": "A synthetic transcript for review.",
                    "rawText": "A synthetic transcript for review.",
                    "words": [{"word": "synthetic", "start": 0, "end": 0.2, "confidence": None}],
                    "location": {"area": "Yuen Long", "lat": 22.4445, "lng": 114.015, "radiusM": 800},
                    "qaList": [],
                    "consentRef": "CONSENT-2026-11-v2",
                    "contributionFlow": True,
                    "requestedScope": requested_scope,
                    "scope": requested_scope,
                    "mime": "audio/wav",
                    "audioBase64": synthetic_wav_base64(),
                },
            )
            check(f"create {rid}", response.status_code == 200, response.text)
            record = response.json()["record"]
            check("client-requested scope is not published", record["scope"] == "private")
            check("contribution starts ready for submission", record["reviewStatus"] == "ready")
            check("requested scope is retained", record["requestedScope"] == requested_scope)
            return record

        create_record("CON-OWNER-001")
        check(
            "guest cannot read pending private record",
            client.get("/api/records/CON-OWNER-001").status_code == 403,
        )
        check(
            "second contributor cannot read pending private record",
            client.get("/api/records/CON-OWNER-001", headers=auth_b).status_code == 403,
        )
        check(
            "owner can read pending private record",
            client.get("/api/records/CON-OWNER-001", headers=auth_a).status_code == 200,
        )
        check(
            "owner can play private audio",
            client.get("/api/records/CON-OWNER-001/audio", headers=auth_a).status_code == 200,
        )
        check(
            "second contributor cannot play private audio",
            client.get("/api/records/CON-OWNER-001/audio", headers=auth_b).status_code == 403,
        )
        guest_list = client.get("/api/records").json()["records"]
        check("guest cannot discover pending record", all(r["id"] != "CON-OWNER-001" for r in guest_list))

        forged_create = client.post(
            "/api/records",
            headers=auth_a,
            json={
                "id": "CON-FORGED-003",
                "status": "done",
                "source": "live",
                "title": "Forged publication attempt",
                "formalText": "This must stay private.",
                "scope": "public",
                "contributionFlow": False,
                "reviewStatus": "approved",
                "reviewedBy": "attacker@example.test",
            },
        )
        check("forged moderation fields are accepted only as private ready record", (
            forged_create.status_code == 200
            and forged_create.json()["record"]["scope"] == "private"
            and forged_create.json()["record"]["reviewStatus"] == "ready"
        ), forged_create.text)
        check(
            "guest cannot read forged public record",
            client.get("/api/records/CON-FORGED-003").status_code == 403,
        )

        check(
            "submission requires transcript confirmation",
            client.post(
                "/api/contributions/CON-OWNER-001/submit",
                headers=auth_a,
                json={"transcriptConfirmed": False, "requestedScope": "public"},
            ).status_code == 400,
        )
        check(
            "submission requires current consent policy",
            client.post(
                "/api/contributions/CON-OWNER-001/submit",
                headers=auth_a,
                json={
                    "transcriptConfirmed": True,
                    "requestedScope": "public",
                    "policyVersion": "STALE",
                },
            ).status_code == 400,
        )
        check(
            "another contributor cannot submit owner record",
            client.post(
                "/api/contributions/CON-OWNER-001/submit",
                headers=auth_b,
                json={"transcriptConfirmed": True, "requestedScope": "public"},
            ).status_code == 403,
        )
        submitted = client.post(
            "/api/contributions/CON-OWNER-001/submit",
            headers=auth_a,
            json={
                "transcriptConfirmed": True,
                "requestedScope": "public",
                "policyVersion": "CONSENT-2026-11-v2",
            },
        )
        check("owner submits pending story", submitted.status_code == 200, submitted.text)
        check("submitted story remains private", submitted.json()["record"]["scope"] == "private")
        check("submitted review status", submitted.json()["record"]["reviewStatus"] == "submitted")
        submitted_at = submitted.json()["record"]["submittedAt"]
        resync = dict(submitted.json()["record"])
        resync["scope"] = "public"
        resync["contributionFlow"] = False
        resync["reviewStatus"] = "approved"
        resync["reviewedBy"] = "attacker@example.test"
        resync["iconKey"] = "oral"
        resync.pop("audioUrl", None)
        resync["status"] = "pending_review"
        synced = client.post("/api/records", headers=auth_a, json=resync)
        check("generic sync accepts allowed metadata update", synced.status_code == 200, synced.text)
        check("generic sync preserves submitted state", (
            synced.json()["record"]["reviewStatus"] == "submitted"
            and synced.json()["record"]["submittedAt"] == submitted_at
            and synced.json()["record"]["scope"] == "private"
            and synced.json()["record"]["reviewedBy"] is None
        ), synced.text)
        check(
            "non-reviewer cannot inspect submission queue",
            client.get("/api/contributions", headers=auth_b).status_code == 403,
        )
        queue = client.get("/api/contributions", headers=auth_admin)
        check("reviewer still sees pending queue after sync", queue.status_code == 200 and queue.json()["count"] == 1)

        approved = client.post(
            "/api/contributions/CON-OWNER-001/review",
            headers=auth_admin,
            json={"approved": True, "approvedScope": "public", "note": "Synthetic review passed"},
        )
        check("reviewer approves submission", approved.status_code == 200, approved.text)
        check("approval applies requested scope", approved.json()["record"]["scope"] == "public")
        check("approval status recorded", approved.json()["record"]["reviewStatus"] == "approved")
        check(
            "second contributor can read approved story",
            client.get("/api/records/CON-OWNER-001", headers=auth_b).status_code == 200,
        )
        check(
            "guest can read approved public story",
            client.get("/api/records/CON-OWNER-001").status_code == 200,
        )
        check(
            "guest can play approved public audio",
            client.get("/api/records/CON-OWNER-001/audio").status_code == 200,
        )
        catalog = client.get(
            "/api/stories",
            params={"bbox": "113.8,22.2,114.5,22.6"},
        ).json()["visibleIds"]
        check("approved record enters public catalog and map", "CON-OWNER-001" in catalog)
        answer = client.post(
            "/api/ask-village",
            json={
                "question": "Synthetic private contribution",
                "storyIds": ["CON-OWNER-001"],
            },
        ).json()
        check("approved record is searchable by Ask the Village", (
            answer["inScope"] is True
            and answer["storyId"] == "CON-OWNER-001"
            and len(answer["sources"]) >= 1
        ), str(answer))

        withdrawn = client.post(
            "/api/stories/CON-OWNER-001/withdraw",
            headers=auth_admin,
            json={"reason": "Synthetic withdrawal"},
        )
        check("reviewer can withdraw approved record", withdrawn.status_code == 200, withdrawn.text)
        repeated_withdrawal = client.post(
            "/api/stories/CON-OWNER-001/withdraw",
            headers=auth_admin,
            json={},
        )
        check("contribution withdrawal preserves first timestamp", (
            repeated_withdrawal.json()["withdrawnAt"] == withdrawn.json()["withdrawnAt"]
        ))
        check(
            "withdrawn contribution leaves catalog",
            "CON-OWNER-001" not in client.get("/api/stories").json()["visibleIds"],
        )
        check(
            "withdrawn contribution audio is blocked",
            client.get("/api/records/CON-OWNER-001/audio").status_code == 403,
        )

        client.post(
            "/api/records",
            headers=auth_a,
            json={
                "id": "CON-INVALID-004",
                "status": "done",
                "source": "live",
                "title": "Boolean validation",
                "formalText": "Boolean validation",
                "consentRef": "CONSENT-2026-11-v2",
                "contributionFlow": True,
                "requestedScope": "public",
            },
        )
        client.post(
            "/api/contributions/CON-INVALID-004/submit",
            headers=auth_a,
            json={
                "transcriptConfirmed": True,
                "requestedScope": "public",
                "policyVersion": "CONSENT-2026-11-v2",
            },
        )
        check(
            "string false is not accepted as approval",
            client.post(
                "/api/contributions/CON-INVALID-004/review",
                headers=auth_admin,
                json={"approved": "false", "approvedScope": "public"},
            ).status_code == 400,
        )

        client.post(
            "/api/records",
            headers=auth_a,
            json={
                "id": "CON-SCOPE-005",
                "status": "done",
                "source": "live",
                "title": "Private scope",
                "formalText": "Private scope",
                "consentRef": "CONSENT-2026-11-v2",
                "contributionFlow": True,
                "requestedScope": "private",
            },
        )
        client.post(
            "/api/contributions/CON-SCOPE-005/submit",
            headers=auth_a,
            json={
                "transcriptConfirmed": True,
                "requestedScope": "private",
                "policyVersion": "CONSENT-2026-11-v2",
            },
        )
        check(
            "reviewer cannot broaden private intent",
            client.post(
                "/api/contributions/CON-SCOPE-005/review",
                headers=auth_admin,
                json={"approved": True, "approvedScope": "public"},
            ).status_code == 409,
        )

        create_record("CON-REJECT-002", requested_scope="community")
        client.post(
            "/api/contributions/CON-REJECT-002/submit",
            headers=auth_a,
            json={
                "transcriptConfirmed": True,
                "requestedScope": "community",
                "policyVersion": "CONSENT-2026-11-v2",
            },
        )
        rejected = client.post(
            "/api/contributions/CON-REJECT-002/review",
            headers=auth_admin,
            json={"approved": False, "approvedScope": "private", "note": "Needs correction"},
        )
        check("reviewer rejects submission", rejected.status_code == 200, rejected.text)
        check("rejected story remains private", rejected.json()["record"]["scope"] == "private")
        check(
            "guest cannot read rejected story",
            client.get("/api/records/CON-REJECT-002").status_code == 403,
        )

        print("\nALL PASSED: Issue #4 private contribution flow")


if __name__ == "__main__":
    main()
