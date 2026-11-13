"""Verify the Supabase storage adapter and portable backend behavior."""

from __future__ import annotations

import os
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
    for key in ("DATABASE_URL", "SUPABASE_DB_URL", "VTN_DATABASE_URL"):
        os.environ.pop(key, None)
    os.environ["VTN_DATABASE_REQUIRED"] = "0"
    with tempfile.TemporaryDirectory(prefix="vtn-storage-") as tmp:
        os.environ["VTN_ENV_FILE"] = str(Path(tmp) / "missing.env")
        os.environ["VTN_DB_PATH"] = str(Path(tmp) / "records.db")
        import storage

        check("development fallback is explicit SQLite", storage.backend_name() == "sqlite")
        conn = storage.connect()
        try:
            conn.execute("CREATE TABLE check_one (id TEXT PRIMARY KEY, value TEXT)")
            conn.execute(
                "INSERT INTO check_one (id, value) VALUES (?, ?) "
                "ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                ("one", "first"),
            )
            conn.execute(
                "INSERT INTO check_one (id, value) VALUES (?, ?) "
                "ON CONFLICT(id) DO UPDATE SET value=excluded.value",
                ("one", "updated"),
            )
            conn.commit()
            row = conn.execute("SELECT value FROM check_one WHERE id=?", ("one",)).fetchone()
        finally:
            conn.close()
        check("portable upsert works", row[0] == "updated")

        os.environ["VTN_RECORDS_DIR"] = str(Path(tmp) / "records")
        from fastapi.testclient import TestClient

        import server

        client = TestClient(server.app)
        headers = {"X-VTN-User": "visitor-supatest", "X-VTN-Role": "visitor"}
        done = {
            "id": "REC-SUPA-TEST",
            "status": "done",
            "source": "demo",
            "scope": "private",
            "createdAt": 1763000000000,
            "words": [],
            "qaList": [],
        }
        draft = dict(done, id="REC-SUPA-DRAFT", status="draft")
        check("completed record is accepted", client.post("/api/records", headers=headers, json=done).status_code == 200)
        check("draft is not persisted", client.post("/api/records", headers=headers, json=draft).status_code == 400)

    migration = (ROOT / "supabase/migrations/202611130001_vtn_backend.sql").read_text(encoding="utf-8")
    server = (ROOT / "server.py").read_text(encoding="utf-8")
    lab = (ROOT / "lab_api.py").read_text(encoding="utf-8")
    check("migration contains all core tables", all(
        table in migration
        for table in (
            "records", "corrections", "withdrawals", "audit_log",
            "consent_log", "card_selections", "metadata_reviews", "questions",
        )
    ))
    check("Supabase schema enables RLS", "ENABLE ROW LEVEL SECURITY" in migration)
    check("server uses shared storage adapter", "from storage import" in server)
    check("lab API uses shared storage adapter", "from storage import" in lab)
    check(
        "frontend never references DATABASE_URL",
        "DATABASE_URL" not in (ROOT / "frontend/voices-of-the-north-app.html").read_text(encoding="utf-8"),
    )
    print("\nALL PASSED: Supabase storage adapter")


if __name__ == "__main__":
    main()
