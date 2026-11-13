"""Local recording isolation, withdrawal and retrieval regression checks.

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
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

TMP = Path(tempfile.mkdtemp(prefix="vtn-records-test-"))
os.environ["VTN_DB_PATH"] = str(TMP / "records.db")
os.environ["VTN_RECORDS_DIR"] = str(TMP / "records")
os.environ["VTN_RECORDS_TOKEN"] = ""

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402
from story_corpus import out_of_scope_message  # noqa: E402

client = TestClient(server.app)
PASSED = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if not condition:
        raise AssertionError(f"FAIL: {label} {detail}")
    PASSED += 1
    print(f"  PASS  {label}")


def main() -> None:
    owner_token = server.make_token("owner@example.test", "member")
    owner = {"Authorization": "Bearer " + owner_token}
    other = {"Authorization": "Bearer " + server.make_token("other@example.test", "member")}
    reviewer = {"Authorization": "Bearer " + server.make_token("reviewer@example.test", "admin")}
    try:
        print("[1] health")
        health = client.get("/api/health").json()
        check("storage_ready", health.get("storage_ready") is True, str(health))
        check("ask_village_ready", health.get("ask_village_ready") is True)
        check("storage_mode 標示", health.get("storage_mode") == "scoped")

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
        check("guest cannot upload", client.post("/api/records", json=rec).status_code == 403)
        r = client.post("/api/records", headers=owner, json=rec)
        check("HTTP 200", r.status_code == 200, r.text)
        saved = r.json()
        check("回傳 audioUrl", saved["record"]["audioUrl"].endswith("/audio"))
        check("不回存 base64", "audioBase64" not in saved["record"])
        check("檔案例項已寫入", (Path(os.environ["VTN_RECORDS_DIR"]) / "test-rec-001.webm").is_file())

        print("[3] GET /api/records — 列表與重新打開")
        listing = client.get("/api/records", headers=owner).json()
        check("count = 1", listing["count"] == 1, str(listing))
        check("sync 標記", listing["records"][0]["sync"] == "synced")
        check("文字稿完整", listing["records"][0]["formalText"] == "測試逐字稿。")
        single = client.get("/api/records/test-rec-001", headers=owner)
        check("單條讀取 200", single.status_code == 200)
        check("qaList 保留", single.json()["qaList"][0]["timestamp"] == 1.0)
        audio_resp = client.get("/api/records/test-rec-001/audio", params={"token": owner_token})
        check("音訊 200", audio_resp.status_code == 200)
        check("音訊位元組一致", audio_resp.content == audio_bytes)

        print("[4] 更新同一 id（轉寫重試情境）")
        rec2 = dict(rec)
        rec2.pop("audioBase64")
        rec2["status"] = "pending_review"
        rec2["scope"] = "public"
        rec2["formalText"] = "更新後文字稿"
        r2 = client.post("/api/records", headers=owner, json=rec2)
        check("更新 200", r2.status_code == 200, r2.text)
        check("文字稿已更新", client.get("/api/records/test-rec-001", headers=owner).json()["formalText"] == "更新後文字稿")
        check("音訊未被清空", client.get("/api/records/test-rec-001/audio", headers=owner).status_code == 200)
        check("guest list hides unapproved records", client.get("/api/records").json()["count"] == 0)
        check("other account list hides unapproved records", client.get("/api/records", headers=other).json()["count"] == 0)
        check("guest cannot open unapproved record", client.get("/api/records/test-rec-001").status_code == 403)
        check("other account cannot open unapproved record", client.get("/api/records/test-rec-001", headers=other).status_code == 403)
        check("guest cannot play unapproved audio", client.get("/api/records/test-rec-001/audio").status_code == 403)
        check("other account cannot play unapproved audio", client.get("/api/records/test-rec-001/audio", headers=other).status_code == 403)
        check("reviewer can play unapproved audio", client.get("/api/records/test-rec-001/audio", headers=reviewer).status_code == 200)
        forged = {"X-VTN-User": "owner@example.test", "X-VTN-Role": "admin"}
        check("client role headers cannot grant access", client.get("/api/records/test-rec-001/audio", headers=forged).status_code == 403)
        check("other account cannot overwrite a recording", client.post("/api/records", headers=other, json=rec2).status_code == 403)
        check("other account cannot delete a recording", client.delete("/api/records/test-rec-001", headers=other).status_code == 403)
        reviewed = client.post("/api/records", headers=reviewer, json=rec2)
        check("reviewer update retains the owner", reviewed.json()["record"]["owner"] == "owner@example.test")
        check("owner retains access after reviewer update", client.get("/api/records/test-rec-001/audio", headers=owner).status_code == 200)

        print("[5] POST /api/ask-village — 同構問答契約")
        hit = client.post("/api/ask-village", json={"question": "細個元朗周邊係點㗎？"}).json()
        check("命中 inScope", hit["inScope"] is True, str(hit))
        check("必附出處", len(hit["sources"]) >= 1)
        check("出處含時間戳", "at " in hit["sources"][0]["label"])
        check("storyId", hit["storyId"] == "YL-001")
        check("角色扮演標記", hit["demo"] is True)
        miss = client.post("/api/ask-village", json={"question": "月球離地球幾遠？"}).json()
        check("超範圍拒答", miss["inScope"] is False)
        check("標準拒答句", miss["answer"] == out_of_scope_message())
        check("無出處", miss["sources"] == [])
        empty = client.post("/api/ask-village", json={"question": ""}).json()
        check("空問題拒答", empty["inScope"] is False)

        print("[6] DELETE /api/records/{id} — 實體刪除與稽核")
        deleted = client.delete("/api/records/test-rec-001", headers=owner).json()
        check("ok", deleted["ok"] is True, str(deleted))
        check("音訊已實體移除", deleted["audioRemoved"] is True)
        check("文字已移除", deleted["textRemoved"] is True)
        check("檔案不存在", not (Path(os.environ["VTN_RECORDS_DIR"]) / "test-rec-001.webm").exists())
        check("單條 404", client.get("/api/records/test-rec-001").status_code == 404)
        check("音訊 404", client.get("/api/records/test-rec-001/audio").status_code == 404)
        check("列表清空", client.get("/api/records", headers=owner).json()["count"] == 0)
        conn = sqlite3.connect(os.environ["VTN_DB_PATH"])
        try:
            row = conn.execute(
                "SELECT record_id, audio_removed, text_removed FROM deletion_events"
            ).fetchone()
        finally:
            conn.close()
        check("刪除稽核紀錄存在", row is not None)
        check("稽核紀錄不含逐字稿", row == ("test-rec-001", 1, 1), str(row))
        check("重複刪除冪等", client.delete("/api/records/test-rec-001", headers=owner).json()["ok"] is True)

        print("[7] 輸入驗證")
        check("非法 ID 400", client.post("/api/records", headers=owner, json={"id": "../etc/passwd"}).status_code == 400)
        check("壞 base64 400", client.post(
            "/api/records", headers=owner, json={"id": "bad-b64", "audioBase64": "!!!"}
        ).status_code == 400)

        print("[8] Story withdrawal and old audio links")
        withdrawal_url = "/api/stories/YL-001/withdraw"
        question = {"question": "細個元朗周邊係點㗎？", "storyIds": ["YL-001"]}
        bbox = {"bbox": "113.8,22.2,114.5,22.6"}
        catalog = client.get("/api/stories").json()["stories"]
        story_audio = next(story["audioUrl"] for story in catalog if story["id"] == "YL-001")
        audio = client.get(story_audio, headers={"Range": "bytes=0-31"})
        check("published audio supports seeking", audio.status_code == 206 and len(audio.content) == 32)
        check("published audio is not cached", audio.headers.get("cache-control") == "no-store")
        audio_aliases = []
        if os.name == "nt":
            audio_aliases = [story_audio + ".", story_audio + "%20"]
            for alias in audio_aliases:
                check("Windows alias resolves to published audio", client.get(
                    alias, headers={"Range": "bytes=0-3"}
                ).content == b"RIFF")
        check("guest cannot withdraw", client.post(withdrawal_url, json={}).status_code == 403)
        check("member cannot withdraw", client.post(withdrawal_url, headers=owner, json={}).status_code == 403)
        check("client role headers cannot grant withdrawal", client.post(withdrawal_url, headers=forged, json={}).status_code == 403)
        check("unknown story withdrawal returns 404", client.post("/api/stories/unknown/withdraw", headers=reviewer, json={}).status_code == 404)
        check("invalid withdrawal body returns 400", client.post(withdrawal_url, headers=reviewer, json=[]).status_code == 400)
        check("story still visible after denied withdrawals", "YL-001" in client.get("/api/stories", params=bbox).json()["visibleIds"])
        withdrawn = client.post(withdrawal_url, headers=reviewer, json={})
        check("reviewer can withdraw", withdrawn.status_code == 200)
        repeat = client.post(withdrawal_url, headers=reviewer, json={})
        check("withdrawal retry preserves timestamp", repeat.json()["withdrawnAt"] == withdrawn.json()["withdrawnAt"])
        check("withdrawn story removed from catalog", "YL-001" not in client.get("/api/stories").json()["visibleIds"])
        check("withdrawn story removed from map results", "YL-001" not in client.get("/api/stories", params=bbox).json()["visibleIds"])
        result = client.post("/api/ask-village", json=question).json()
        check("withdrawn story no longer cited", result["inScope"] is False and result["sources"] == [])
        check("old URL blocked", client.get(story_audio).status_code == 404)
        check("old URL blocked for ranges", client.get(story_audio, headers={"Range": "bytes=0-31"}).status_code == 404)
        for alias in audio_aliases:
            denied_alias = client.get(alias, headers={"Range": "bytes=0-3"})
            check("Windows alias cannot restore withdrawn audio", denied_alias.status_code == 404)
            check("Windows alias denial is not cached", denied_alias.headers.get("cache-control") == "no-store")
        check("conditional requests cannot restore withdrawn audio", client.get(
            story_audio, headers={"If-None-Match": audio.headers["etag"]}
        ).status_code == 404)
        check("withdrawn demo cannot be reprocessed", client.post("/api/process").status_code == 404)
        with patch.object(server, "storage_ready", False):
            check("catalog fails closed without storage", client.get("/api/stories").status_code == 503)
            check("answers fail closed without storage", client.post("/api/ask-village", json=question).status_code == 503)
            check("old audio fails closed without storage", client.get(story_audio).status_code == 503)
        with patch.object(server, "_connect", side_effect=sqlite3.OperationalError("test outage")):
            check("catalog fails closed on database errors", client.get("/api/stories").status_code == 503)
            check("answers fail closed on database errors", client.post("/api/ask-village", json=question).status_code == 503)
            check("audio fails closed on database errors", client.get(story_audio).status_code == 503)

        print(f"\nALL PASSED: {PASSED} checks")
    finally:
        shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
