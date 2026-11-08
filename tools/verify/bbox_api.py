"""驗證 /api/stories 的 bbox 視口查詢與 /api/audit 的 meta 白名單。

執行：python tools/verify/bbox_api.py
依賴：requirements.txt（fastapi）。全程使用暫存目錄的資料庫與錄音目錄，
不會寫入專案的 records/ 或 records.db。
"""

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT))

TMP = Path(tempfile.mkdtemp(prefix="vtn-bbox-test-"))
os.environ["VTN_DB_PATH"] = str(TMP / "records.db")
os.environ["VTN_RECORDS_DIR"] = str(TMP / "records")

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

CHECKS = 0


def check(label, ok, detail=""):
    global CHECKS
    if not ok:
        raise AssertionError(f"FAIL {label}: {detail}")
    CHECKS += 1
    print(f"  PASS  {label} {detail}".rstrip())


def main() -> None:
    client = TestClient(server.app)
    total = len(json.loads((ROOT / "data" / "stories.json").read_text(encoding="utf-8"))["stories"])

    all_stories = client.get("/api/stories").json()
    check("no bbox returns all", all_stories["count"] == total, f"(got {all_stories['count']}, want {total})")
    check("no bbox has no bbox echo", "bbox" not in all_stories)

    near = client.get("/api/stories?bbox=113.98,22.43,114.03,22.47").json()
    print("  near ids", [s["id"] for s in near["stories"]])
    check("bbox filters", 0 < near["count"] < total, f"(got {near['count']})")
    check("bbox echoed", near["bbox"] == [113.98, 22.43, 114.03, 22.47], str(near.get("bbox")))

    far = client.get("/api/stories?bbox=120,30,121,31").json()
    check("empty bbox", far["count"] == 0, str(far["count"]))

    check("bad bbox 400", client.get("/api/stories?bbox=abc").status_code == 400)
    check("reversed bbox 400", client.get("/api/stories?bbox=114,22,113,21").status_code == 400)
    check("three parts 400", client.get("/api/stories?bbox=113,22,114").status_code == 400)

    res = client.post("/api/audit", json={
        "action": "metric.pin.click",
        "meta": {"storyId": "YL-001", "zoom": 12.5, "engine": "maplibre",
                 "durationMs": 1234, "ratio": 0.75,
                 "title": "SHOULD_BE_DROPPED", "note": "allowed-existing"}
    })
    check("audit accepts metrics", res.status_code == 200, str(res.status_code))
    conn = sqlite3.connect(os.environ["VTN_DB_PATH"])
    row = conn.execute("SELECT meta_json FROM audit_log ORDER BY at DESC LIMIT 1").fetchone()
    conn.close()
    meta = json.loads(row[0])
    print("  stored meta", meta)
    check("metric keys stored", meta.get("storyId") == "YL-001" and meta.get("zoom") == 12.5)
    check("free text dropped", "title" not in meta and "SHOULD_BE_DROPPED" not in json.dumps(meta))
    check("existing note kept", meta.get("note") == "allowed-existing")
    print(f"ALL PASSED: {CHECKS} checks")


if __name__ == "__main__":
    try:
        main()
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
