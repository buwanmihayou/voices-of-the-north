"""11/5 測試線驗收：4 條指派方案的後端端點 + 主線回歸。

執行：python tools/test_lab_api.py
使用隔離暫存資料庫，不碰專案的 lab.db / records.db / records/。
"""

from __future__ import annotations

import base64
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)

TMP = Path(tempfile.mkdtemp(prefix="vtn-lab-test-"))
os.environ["VTN_LAB_DB"] = str(TMP / "lab.db")
os.environ["VTN_DB_PATH"] = str(TMP / "records.db")
os.environ["VTN_RECORDS_DIR"] = str(TMP / "records")
os.environ.pop("GEMINI_API_KEY", None)  # 本輪應如實走關鍵詞降級

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402

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
        print("[0] 主線回歸")
        health = client.get("/api/health").json()
        check("health storage_ready", health["storage_ready"] is True)
        check("主線 /api/records 仍在", client.get("/api/records").status_code == 200)
        qa = client.post("/api/ask-village", json={"question": "細個元朗周邊係點㗎？"}).json()
        check("主線問答仍附出處", qa["inScope"] and len(qa["sources"]) >= 1)

        print("[1] 方案 3：問題卡片")
        cards = client.get("/api/lab/cards").json()
        check("卡片 12 張", cards["count"] == 12, str(cards["count"]))
        check("含使用守則", len(cards["guardrails"]) >= 3)
        check("卡片一卡一問", all("prompt" in c and "category" in c for c in cards["cards"]))
        sel = client.post("/api/lab/cards/select", json={"cardId": "C04", "village": "元朗"})
        check("選卡 200", sel.status_code == 200, sel.text)
        check("回傳卡片內容", sel.json()["card"]["category"] == "生活")
        check("無效卡 400", client.post("/api/lab/cards/select", json={"cardId": "XXX"}).status_code == 400)
        check("選卡紀錄可查", client.get("/api/lab/cards/selections").json()["count"] == 1)

        print("[2] 方案 4：第 1 層自動匹配（不得冒充 LLM）")
        text = "細個我住喺元朗一帶，周圍好多農田，大家出入多數都係踩單車。近年好多農田起咗密集樓宇。"
        cls = client.post("/api/lab/classify", json={
            "recordId": "lab-rec-001", "text": text
        }).json()
        check("classify ok", cls["ok"] is True, str(cls))
        check("Gemini 未設定時如實降級", cls["classifier"] == "keyword-fallback", cls["classifier"])
        check("標為機器猜測", cls["machineGuess"] is True)
        check("狀態為 pending", cls["reviewStatus"] == "pending")
        check("抽出主題", "農事與土地" in cls["suggested"]["topicTags"], str(cls["suggested"]))
        check("抽出交通主題", "交通與出行" in cls["suggested"]["topicTags"])
        check("抽出變遷主題", "村落變遷" in cls["suggested"]["topicTags"])
        check("抽出地點", cls["suggested"]["place"] == "元朗")
        check("註明需義工覆核", "未確認" in cls["note"])
        check("空逐字稿不崩", client.post("/api/lab/classify", json={
            "recordId": "lab-rec-empty", "text": ""
        }).status_code == 200)

        print("[3] 方案 4：第 2 層義工兜底")
        conf = client.post("/api/lab/confirm", json={
            "recordId": "lab-rec-001",
            "topicTags": "農事與土地, 交通與出行, 義工修正主題",
            "place": "元朗", "eraOrYear": "六十年代", "dialect": "yue-Hant-HK",
            "reviewer": "測試義工 A"
        }).json()
        check("confirm ok", conf["ok"] is True, str(conf))
        check("狀態 human_confirmed", conf["reviewStatus"] == "human_confirmed")
        check("義工修正生效", "義工修正主題" in conf["metadata"]["topicTags"])
        check("記錄覆核者", conf["reviewer"] == "測試義工 A")
        check("未做第 1 層不可確認", client.post("/api/lab/confirm", json={
            "recordId": "never-classified", "topicTags": []
        }).status_code == 404)
        reviews = client.get("/api/lab/reviews").json()
        check("覆核列表可查", reviews["count"] == 2, str(reviews["count"]))
        check("已確認記錄在列", any(
            r["recordId"] == "lab-rec-001" and r["status"] == "human_confirmed"
            for r in reviews["reviews"]
        ))

        print("[4] 方案 1：問答廣場（只有問題，無社交功能）")
        rules = client.get("/api/lab/questions").json()["rules"]
        check("聲明無 feed/點讚/追蹤", any("無資訊流" in r for r in rules))
        q = client.post("/api/lab/questions", json={
            "village": "元朗", "question": "以前村口最熱鬧係咩時候？"
        }).json()["question"]
        check("留問題成功", q["status"] == "open", str(q))
        check("過短問題 400", client.post("/api/lab/questions", json={"question": "咩"}).status_code == 400)
        check("未保存錄音不可作答", client.post(
            f"/api/lab/questions/{q['id']}/answer", json={"recordId": "不存在", "timestamp": 3}
        ).status_code == 404)

        # 用主線 API 建立一條真實已保存錄音，才可作為聲音回答
        rec = {
            "id": "lab-answer-001", "createdAt": 1730000000000, "status": "done",
            "source": "live", "mode": "online", "mime": "audio/webm",
            "title": "問答廣場回答用錄音", "rawText": "村口以前好熱鬧",
            "formalText": "村口以前好熱鬧。", "words": [], "qaList": [],
            "audioBase64": base64.b64encode(b"RIFF-fake-audio").decode("ascii"),
        }
        check("主線保存錄音 200", client.post("/api/records", json=rec).status_code == 200)
        ans = client.post(f"/api/lab/questions/{q['id']}/answer", json={
            "recordId": "lab-answer-001", "timestamp": 17.5
        }).json()
        check("已保存錄音可作答", ans["ok"] is True, str(ans))
        check("回答附時間戳出處", ans["citation"] == "Source: [lab-answer-001] at 00:17", ans["citation"])
        listing = client.get("/api/lab/questions").json()
        check("問題狀態 answered", listing["questions"][0]["status"] == "answered")

        print("[5] 方案 2：清拆時鐘（全部標示為示意）")
        tl = client.get("/api/lab/timeline").json()
        check("illustrative", tl["illustrative"] is True)
        check("verified = false", tl["verified"] is False)
        check("有醒目警示", "不可作官方依據" in tl["warning"])
        check("來源標待驗證", "【待驗證】" in tl["source"])
        check("保留 800m 模糊範圍", "800" in tl["privacy"])
        check("每個階段都標示意", all(
            p["illustrative"] for v in tl["villages"] for p in v["phases"]
        ))

        print("[6] 匯總與清理")
        s = client.get("/api/lab/summary").json()
        check("統計卡片數", s["cardsAvailable"] == 12)
        check("統計待覆核", s["metadataPending"] == 1, str(s))
        check("統計已確認", s["metadataConfirmed"] == 1, str(s))
        check("統計已回答", s["questionsAnswered"] == 1, str(s))
        check("標明時間軸未核實", s["timelineVerified"] is False)
        check("標明 Gemini 未設定", s["geminiConfigured"] is False)
        check("刪除問題冪等", client.delete(f"/api/lab/questions/{q['id']}").json()["removed"] is True)

        print(f"\nALL PASSED: {PASSED} checks")
    finally:
        shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
