"""11/5 測試版驗收：錄音保存 → 列表 → 重新打開 → 音訊讀取 → 實體刪除，
以及 /api/ask-village 的輸出契約。

執行：python tools/test_records_api.py
使用隔離的暫存 SQLite / 音訊目錄，不會碰觸專案的 records.db 或 records/。
"""

from __future__ import annotations

import base64
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

TMP = Path(tempfile.mkdtemp(prefix="vtn-records-test-"))
os.environ["VTN_DB_PATH"] = str(TMP / "records.db")
os.environ["VTN_RECORDS_DIR"] = str(TMP / "records")

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402
from story_corpus import OUT_OF_SCOPE_MESSAGE  # noqa: E402

client = TestClient(server.app)
PASSED = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"FAIL: {label} {detail}")
    PASSED += 1
    print(f"  PASS  {label}")


def main() -> None:
    try:
        print("[1] health")
        health = client.get("/api/health").json()
        check("storage_ready", health.get("storage_ready") is True, str(health))
        check("ask_village_ready", health.get("ask_village_ready") is True)
        check("storage_mode 標示", health.get("storage_mode") == "test-no-auth")

        print("[2] POST /api/records — 保存")
        audio_bytes = b"RIFF" + bytes(range(64))
        rec = {
            "id": "test-rec-001",
            "createdAt": 1730000000000,
            "durationSec": 3,
            "mime": "audio/webm",
            "source": "live",
            "mode": "online",
            "status": "done",
            "title": "測試錄音",
            "rawText": "測試逐字稿",
            "words": [{"word": "測試", "start": 0.0, "end": 1.0, "confidence": 0.9}],
            "formalText": "測試逐字稿。",
            "qaList": [{"question": "測試?", "answer": "測試答案", "timestamp": 1.0}],
            "audioBase64": base64.b64encode(audio_bytes).decode("ascii"),
            "audioDataURL": None,
        }
        r = client.post("/api/records", json=rec)
        check("HTTP 200", r.status_code == 200, r.text)
        saved = r.json()
        check("回傳 audioUrl", saved["record"]["audioUrl"].endswith("/audio"))
        check("不回存 base64", "audioBase64" not in saved["record"])
        check("檔案例項已寫入", (Path(os.environ["VTN_RECORDS_DIR"]) / "test-rec-001.webm").is_file())

        print("[3] GET /api/records — 列表與重新打開")
        listing = client.get("/api/records").json()
        check("count = 1", listing["count"] == 1, str(listing))
        check("sync 標記", listing["records"][0]["sync"] == "server")
        check("文字稿完整", listing["records"][0]["formalText"] == "測試逐字稿。")
        single = client.get("/api/records/test-rec-001")
        check("單條讀取 200", single.status_code == 200)
        check("qaList 保留", single.json()["qaList"][0]["timestamp"] == 1.0)
        audio_resp = client.get("/api/records/test-rec-001/audio")
        check("音訊 200", audio_resp.status_code == 200)
        check("音訊位元組一致", audio_resp.content == audio_bytes)

        print("[4] 更新同一 id（轉寫重試情境）")
        rec2 = dict(rec)
        rec2.pop("audioBase64")
        rec2["status"] = "done"
        rec2["formalText"] = "更新後文字稿"
        r2 = client.post("/api/records", json=rec2)
        check("更新 200", r2.status_code == 200, r2.text)
        check("文字稿已更新", client.get("/api/records/test-rec-001").json()["formalText"] == "更新後文字稿")
        check("音訊未被清空", client.get("/api/records/test-rec-001/audio").status_code == 200)

        print("[5] POST /api/ask-village — 同構問答契約")
        hit = client.post("/api/ask-village", json={"question": "細個元朗周邊係點㗎？"}).json()
        check("命中 inScope", hit["inScope"] is True, str(hit))
        check("必附出處", len(hit["sources"]) >= 1)
        check("出處含時間戳", "at " in hit["sources"][0]["label"])
        check("storyId", hit["storyId"] == "YL-001")
        check("角色扮演標記", hit["demo"] is True)
        miss = client.post("/api/ask-village", json={"question": "月球離地球幾遠？"}).json()
        check("超範圍拒答", miss["inScope"] is False)
        check("標準拒答句", miss["answer"] == OUT_OF_SCOPE_MESSAGE)
        check("無出處", miss["sources"] == [])
        empty = client.post("/api/ask-village", json={"question": ""}).json()
        check("空問題拒答", empty["inScope"] is False)

        print("[6] DELETE /api/records/{id} — 實體刪除與稽核")
        deleted = client.delete("/api/records/test-rec-001").json()
        check("ok", deleted["ok"] is True, str(deleted))
        check("音訊已實體移除", deleted["audioRemoved"] is True)
        check("文字已移除", deleted["textRemoved"] is True)
        check("檔案不存在", not (Path(os.environ["VTN_RECORDS_DIR"]) / "test-rec-001.webm").exists())
        check("單條 404", client.get("/api/records/test-rec-001").status_code == 404)
        check("音訊 404", client.get("/api/records/test-rec-001/audio").status_code == 404)
        check("列表清空", client.get("/api/records").json()["count"] == 0)
        conn = sqlite3.connect(os.environ["VTN_DB_PATH"])
        try:
            row = conn.execute(
                "SELECT record_id, audio_removed, text_removed FROM deletion_events"
            ).fetchone()
        finally:
            conn.close()
        check("刪除稽核紀錄存在", row is not None)
        check("稽核紀錄不含逐字稿", row == ("test-rec-001", 1, 1), str(row))
        check("重複刪除冪等", client.delete("/api/records/test-rec-001").json()["ok"] is True)

        print("[7] 輸入驗證")
        check("非法 ID 400", client.post("/api/records", json={"id": "../etc/passwd"}).status_code == 400)
        check("壞 base64 400", client.post(
            "/api/records", json={"id": "bad-b64", "audioBase64": "!!!"}
        ).status_code == 400)

        print(f"\nALL PASSED: {PASSED} checks")
    finally:
        shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
