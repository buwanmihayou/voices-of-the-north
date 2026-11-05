# Zheng — Nov 5 測試線執行報告：Google 文檔 4 條已指派方案

- 日期：2026-11-05（HKT）
- 觸發：`https://docs.google.com/document/d/14FC-HMG4XN_1__UsnZWDY3Oc1w0eP-351RwGAsLaifo/edit?tab=t.0`
  第二次抓取顯示文檔末尾由 `_Assigned to zhengboxuan27@gmail.com_` 改為 **`_已指派給zhengboxuan27@gmail.com_`**，其餘正文不變；快照已同步至 `docs/AI压力测试/2026-11-05/背景_Ready_for_Techathon_plus_GoogleDoc_2026-11-05.txt`。
- 依據：`docs/AI压力测试/2026-11-05/99_执行说明与跨模型对比.md` 第 3 節嘅評估與依賴鏈。
- 定位：**測試線／支線原型**，按文檔「Dat 版本為主線，此文檔為測試線；若方案合適，支線匯流主線」嘅紀律實作，**未經 WhatsApp 團體確認前不匯流主線、不改動主線既有 demo 資料**。

## 1. 四條方案對照

| # | 文檔方案 | 本次實作 | 紅線處理 |
|---|---|---|---|
| 1 | 強化互動感，避免孤立使用 App | `frontend/lab.html`「問答廣場」：`POST/GET/DELETE /api/lab/questions` + `POST /api/lab/questions/{id}/answer`；訪客留一個問題，聲音回答必須關聯一條已保存錄音並附 `Source: [id] at mm:ss` | 只有「問題」一種結構化互動；**無資訊流／點讚／追蹤／留言**；答案只由已錄製內容組成，不收集身份資料 |
| 2 | 升級地圖，讓城市變化更有動態感 | `GET /api/lab/timeline` + lab 頁時間軸滑桿與 SVG 模糊圈優先度着色 | 全部 `illustrative: true` / `verified: false`，不含任何聲稱來自政府嘅具體日期或文件編號；只用村級 800m 模糊圈；公開資料與 OSM license 標【待驗證】 |
| 3 | 問題卡片／社交卡／故事卡 | `GET /api/lab/cards` 12 張生活記憶卡（暖身／生活／地方）；`POST /api/lab/cards/select`；**主應用錄音準備頁可揀卡、錄音頁顯示題目、卡片 id/category/prompt 隨錄音存入 `/api/records`**；lab 頁「帶呢張卡去主應用錄音」可無縫跳轉 | 一卡一問、可跳過可隨時停；題目避開征地補償、地界產權、家族糾紛、在世第三人；義工持機，長者唔使碰手機 |
| 4 | 故事細分 + 1 層 LLM 自動匹配 + 2 層義工兜底 | `POST /api/lab/classify`（第 1 層）→ `POST /api/lab/confirm`（第 2 層）→ `GET /api/lab/reviews`；確認後由 lab 頁把 `metadata` 回寫 `/api/records`，主應用錄音卡顯示主題／地點／年代與「義工已確認分類」 | 第 1 層一律 `machineGuess: true` / `reviewStatus: "pending"`；Gemini 未設定時用關鍵詞規則降級並如實標 `classifier: "keyword-fallback"`，**絕不冒充 LLM**；未確認結果不作可公開事實、不改寫原音或逐字稿 |

**依賴鏈落實**：先完成 11/5 主線嘅 `/api/records`（SQLite + 實體刪除）作為地基 → 方案 4 的 `metadata` 回寫 → 方案 3 的 `questionCard` 入庫 → 方案 1 的回答關聯錄音 → 方案 2 只做示意層，不碰真實地理資料。

## 2. 檔案清單

| 檔案 | 說明 |
|---|---|
| `lab_api.py` | 新增：測試線 `APIRouter`，12 張卡片、兩層分類、問題隊列、示意時間軸、匯總；獨立 `lab.db` |
| `server.py` | 只加 2 行（`import` + `app.include_router`）；主線 `/api/process`、`/api/records`、`/api/ask-village` 未改動 |
| `frontend/lab.html` | 新增：實驗支線頁面，4 個可操作模組，Oat × Sage 設計、無外部 JS 依賴 |
| `frontend/voices-of-the-north-app.html` | 主應用接入：採錄問題卡片、錄音卡顯示義工確認標籤與問題卡、關於頁加入測試線入口；同時修正準備頁「唔會永久儲存」與測試版實際暫存不一致嘅舊文案 |
| `.gitignore` | 加 `lab.db` |
| `tools/test_lab_api.py` | 新增：48 項測試線驗收（隔離暫存 DB） |
| `tools/check_frontend_syntax.py` | 既有工具，本輪用於校驗主應用與 lab 頁腳本 |
| `docs/audit/2026-11-05/zheng-nov-05-lab-execution.md` | 本報告 |

`lab.db`、`records.db`、`records/` 皆為運行資料，已被 `.gitignore` 忽略。

## 3. API 摘要

```
GET    /api/lab/cards                     12 張卡片 + 使用守則
POST   /api/lab/cards/select             記錄選卡
GET    /api/lab/cards/selections         最近選卡
POST   /api/lab/classify                 第 1 層自動建議（pending / machineGuess）
POST   /api/lab/confirm                  第 2 層義工確認（human_confirmed）
GET    /api/lab/reviews                  覆核紀錄
GET    /api/lab/questions                問題隊列（含紅線聲明）
POST   /api/lab/questions                留一個問題
POST   /api/lab/questions/{id}/answer    關聯已保存錄音 + 時間戳出處
DELETE /api/lab/questions/{id}           移除問題
GET    /api/lab/timeline                 示意時間軸（verified:false）
GET    /api/lab/summary                  統計與模式
```

主應用入口：`/voices-of-the-north-app.html` →「我的 → 關於 Voices of the North → 測試線・方案實驗室」或直接 `/lab.html`。

## 4. 驗證證據

```
python -m py_compile server.py lab_api.py                 → COMPILE_OK
python tools/check_frontend_syntax.py                    → 2/2 script blocks parsed（主應用 101,870 chars）
python tools/check_frontend_syntax.py frontend/lab.html  → 1/1 script blocks parsed（15,464 chars）
python tools/test_records_api.py                         → ALL PASSED: 38 checks（主線回歸）
python tools/test_lab_api.py                             → ALL PASSED: 48 checks
```

本機 uvicorn（重啟後）：

```
GET /api/lab/summary  → cardsAvailable=12, timelineVerified=false,
                        geminiConfigured=false, mode="測試線／支線，未匯流主線"
GET /lab.html         → 200
GET /voices-of-the-north-app.html → 200, 213,114 bytes
   （含「問題卡片（可選）」「lab.html」「義工已確認分類」「questionCard」）
```

48 項測試線檢查包含：主線回歸、卡片守則、無效卡 400、**Gemini 未設定時如實降級且不冒充 LLM**、機器猜測標記、義工修正生效、未做第 1 層不可確認、未保存錄音不可作答、回答必須附 `Source: [id] at mm:ss`、時間軸全部標示意、匯總與刪除冪等。

## 5. 誠實披露：限制與未做的事

1. **未匯流主線**：4 條方案全部喺 `lab.html` 測試線；主應用只接入咗最成熟嘅問題卡片與義工確認標籤。按文檔流程，仍需 Douglas 歸納、WhatsApp 同步確認，先可以決定邊啲功能正式併入主線。
2. **示意資料不可當真**：清拆時鐘嘅年份、優先度全部係示意，未核實任何政府公開資料或 OSM / 地理資料 license；頁面有大字警示。唔好攞去 pitch 當官方時間表。
3. **Gemini 未設定**：第 1 層目前行關鍵詞規則降級，已如實標示 `classifier: keyword-fallback`；設定 `GEMINI_API_KEY` 後會自動改用 LLM，但仍需義工覆核。
4. **測試版無鑑權**：`lab.db` 與 `records.db` 都無登入保護，問題隊列與錄音只可作團隊內部測試，勿錄入真實長者資料。
5. **零真實長者數據**：仍只有 YL-001 角色扮演示範故事；Boris 嘅 3–5 段粵語測試音訊未到位。
6. **未做**：手機／電腦跨裝置全流程測試（Nov 6）、Dat 嘅文案覆核、Boris 轉錄比對、shared doc 更新、群消息、Git 提交／推送、Render 部署。
7. **問答廣場嘅「聲音回答」**目前係關聯已保存錄音 + 時間戳出處，未實作新錄音即時上傳回答嘅工作流（避免喺未確認方案前擴大範圍）。

## 6. 建議下一步

1. Nov 6：用 `lab.html` 四個模組各跑一次，「留問題 → 用示範錄音回答 → 檢查出處」與「自動建議 → 義工修正 → 主應用錄音卡見到標籤」兩條鏈路要完整截圖做 evidence。
2. Dat 覆核：同意書／關於頁／測試線聲明係咪同實際功能一致；特別係「測試版暫存」同「示意資料」兩處。
3. Douglas／WhatsApp 確認：邊啲方案值得匯流主線；確認後先移除「測試線」標籤、補正式鑑權與資料保留期。
4. 若確認匯流，方案 2 必須先完成公開數據與 license 核實，否則只可保留為標明「示意」嘅設計稿。

## 7. Thẻ 17 日報補充（Nov 5，待貼 shared doc）

**Nov 5 (Thursday) — Zheng（測試線補充）**

- Built a test-line prototype for the four proposals assigned in the Ready for Techathon+ doc: question cards (12, wired into the main recording flow), two-stage story classification with volunteer confirmation (auto suggestions are explicitly marked as machine guesses; keyword fallback is labelled as such when Gemini is off), a question queue / "Ask the Village" style intergenerational Q&A with no feed/likes/follows, and an illustrative "demolition clock" timeline clearly marked unverified.
- Kept it as a side branch (`lab.html` + `lab_api.py`); the main app only received the question-card picker, confirmed-metadata tags and an About-page link. No main-line demo data was changed.
- Evidence: 48/48 lab API checks, 38/38 main-line regression checks, both pages pass JS syntax checks, local server smoke test (lab summary / lab page 200 / main page 200). Report: `docs/audit/2026-11-05/zheng-nov-05-lab-execution.md`.
- Blocked: no team confirmation yet on merging into the main line; timeline data is illustrative and unverified; Gemini not configured; test build has no auth; no real elder recordings used.

## 8. 待確認

1. 是否把本輪與上一輪（主線存儲）嘅改動一併提交並推送 GitHub？目前全部未提交。
2. 是否部署測試線到 Render？（需先處理無鑑權問題與平台磁碟持久化。）
3. 是否由我代為更新 shared doc 或發群消息？本輪未做任何對外發送。
