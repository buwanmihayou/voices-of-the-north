# Voices of the North（北區之聲）

以生成式 AI 保存香港鄉村長者口述歷史的示範平台：錄音 → 逐字稿 → 可核對的問答 → 四級私隱分享。示範資料以北區為主，另加赤柱、九龍城、大澳三則北區外故事，以及谷埔、荔枝窩兩則東北鄉郊故事；涵蓋粵語、華語（國語）與 English。

> **黑客松示範聲明**：13 則故事全部標記為「角色扮演示範故事」，由團隊撰寫，並非真實長者訪談。
> 唯一真實音軌為 `frontend/assets/Demo Story.wav`（實測 46.7 秒）。介面會如實標示「未附音檔」「未能取得置信度」。

## 1. 目錄結構

```
data/stories.json              單一資料來源：故事、逐字稿段落、授權、分享範圍、時長
frontend/src/                  前端原始碼（CSS / JS / HTML 模板，開發時只看這裡）
  css/*.css                    樣式模組（story-map.css = 地圖主視圖與抽屜）
  js/00-config.js              版本、API 位址解析、共用工具
  js/05-i18n.js                三語翻譯表（zh-HK / zh-CN / en）
  js/10-store.js               統一儲存層（localStorage + 記憶體回退）
  js/15-api.js                 後端 API 封裝（含 Bearer token）
  js/20-audio.js               音訊播放與跳秒
  js/25-ui.js                  toast / 對話框 / 狀態徽章
  js/27-metrics.js             指標事件（story.open 為分母；本機緩衝 + /api/audit）
  js/28-waveform.js            8 kHz 實測振幅（內嵌快取／外置 JSON／執行期解碼三級）
  js/30-stories.js             故事地圖／列表、篩選、年代軸、二級頁內容、波形播放器、來源跳轉
  js/32-sheet.js               半拉抽屜（拖拽、展開、關閉與焦點管理）
  js/33-onboarding.js         地圖首次進入 3 步引導＋「?」重看
  js/35-map.js                 地圖引擎：MapLibre GL JS 3D ＋ Leaflet／手繪圖三層回退
  js/40-recorder.js            錄音流程（草稿 → 待轉寫 → 已完成）
  js/45-recordings.js          錄音管理三個分頁
  js/50-assistant.js           助手（檢索、來源、拒答）
  js/55-settings.js            設定頁
  js/60-about.js               關於頁
  js/65-account.js             帳戶、私隱、更正、撤回、匯出
  js/70-router.js              Hash 路由
  js/99-init.js                初始化與健康輪詢
  html/app.template.html       全部視圖骨架（含 data-i18n 標記）
frontend/voices-of-the-north-app.html   交付用單檔（由建置腳本產生，請勿手改）
frontend/waveforms.json        波形按需載入用（--external-waveforms 時由單檔 fetch）
frontend/js, frontend/lib      舊版副本，僅供對照（已不參與建置）
docs/voice-scripts/voice-scripts.md  每則故事的配音文字腳本與時間線
docs/voice-scripts/Voices_of_the_North_Story_Scripts.docx  供真人補錄的 Word 腳本（13 則）
server.py                      FastAPI 後端（同時託管 frontend/ 靜態檔）
story_corpus.py                語料檢索與拒答邏輯（讀 data/stories.json）
tools/build_frontend.py        建置腳本：驗證資料 → 合併成單檔 → 波形快取
tools/export_voice_scripts.py  由已授權逐字稿匯出配音腳本
tools/export_story_scripts_docx.py  由逐字稿產生 Word 補錄腳本（含登記表）
tools/check_frontend_syntax.py 單檔語法檢查
tools/audit_frontend.mjs       前端自我檢查（可選）
```

## 2. 建置

```bash
python tools/build_frontend.py                     # 驗證 + 產出單檔（波形內嵌）
python tools/build_frontend.py --check             # 只驗證資料
python tools/build_frontend.py --external-waveforms # 波形改為按需載入 waveforms.json
python tools/export_voice_scripts.py               # 匯出每則故事的配音文字腳本（Markdown）
python tools/export_story_scripts_docx.py          # 匯出 Word 補錄腳本（含真實錄音登記表）
python tools/check_frontend_syntax.py              # 檢查單檔內嵌 JS 語法
```

建置時會硬性檢查（不通過即失敗）：

- 故事 ID 唯一、`scope` 只能是 `private / family / community / public`
- 每則故事必須有 `authorized: true` 與 `consentRef`
- `languageKey` ∈ `yue / zh / en`（粵語、華語、English）
- 地圖一級資訊：`storyType` ∈ `festival / farming / migration / architecture / oral / market / other`、`mood` ∈ `wistful / joyful / reflective / heavy / proud`、`year` 為 1900–2026 整數；缺欄位只警告（舊資料向後兼容），枚舉錯值即失敗
- 非私人故事的 `location.lat/lng` 必須在香港範圍，`location.radiusM` 必須 ≥100（模糊範圍不可收窄）
- 逐字稿段落時間遞增、不重疊，且 `end` 不可超出 `durationSec`
- 有音檔者 `durationSource` 必須是 `measured`，且 `durationSec` 必須與**音檔實測長度**一致（±0.5 秒）
- 逐字稿結尾不可超出音檔實測長度（否則「可溯源」會跳到不存在的秒數）

新增故事只需改 `data/stories.json`，不必改頁面程式碼。

補充契約：

- **波形**：建置腳本用標準庫 `wave` 實測 PCM，與 `28-waveform.js` 執行期解碼共用 **8 kHz 重採樣網格 + 60 柱 RMS／峰值**，兩條路徑相關係數 **1.000**（舊版 0.918）；播放器標明「構建期 8kHz 取樣」。預設內嵌 `window.VTN_WAVEFORMS`，快取缺失、外置載入失敗或瀏覽器不支援 Web Audio 時回退細進度條，**不生成假波形**。
- **波形體積**：目前 1 則 × 60 柱 = 358 bytes；故事量增大時用 `--external-waveforms`，單檔只留 `window.VTN_WAVEFORMS_URL`，前端按需 fetch `frontend/waveforms.json` 並寫回快取（50 則約 18 KB，屆時建議切換）。
- **可見故事集合**：`GET /api/stories?bbox=west,south,east,north` 與 `POST /api/ask-village`（可帶同一 `bbox`）都從 `server.current_visible_stories()` 出發；`visibleCount` / `visibleIds` 描述裁剪後的結果。問答可另帶 `storyIds` 收窄至前端類型／年代等篩選後的故事，空陣列表示無故事，省略才用全域；後端始終先做授權／分享範圍／撤回過濾。前端在提問時擷取篩選及視口快照，網路失敗後的本機檢索沿用同一範圍；服務端拒答不會被本機全庫故事搜尋覆蓋。首頁與列表不套用隱藏地圖的視口。參數格式錯誤回 400。
- **指標口徑**：`story.open`（真正打開詳情）才是北極星指標分母；`pin.click`（單點）、`cluster.click`（同圈氣泡／低縮放聚合）只作診斷；另有 `map.view`、`audio.complete`、`audio.progress`、`scene.view`。只記錄數值與故事 ID，送往 `/api/audit`；後端 meta 白名單會丟棄逐字稿、標題等自由文字，離線時僅留本機緩衝。
- **版位與無障礙**：列表入口在地圖右上角常顯（帶文字，不是降級才出現）；首次進入地圖有 3 步引導，右上角 `?` 可重看，Esc／遮罩／跳過都會關閉並記住；半拉抽屜半開露出 `55dvh`；`prefers-reduced-motion` 下模糊圈呼吸填充降級為靜態虛線圈；3D 書籤輪播谷埔、荔枝窩、粉嶺、上水、大埔五個已有真實故事座標的視角。**本階段只提供淺色主題**，設定頁不再有深色／跟隨系統入口，舊的本機深色設定會自動收回淺色。
- **配音腳本**：`docs/voice-scripts/voice-scripts.md` 與 `Voices_of_the_North_Story_Scripts.docx` 由 `tools/export_voice_scripts.py`／`tools/export_story_scripts_docx.py` 從已授權逐字稿匯出每則故事的台詞、時間線、補錄驗收與真實錄音登記表。13 則中 12 則仍待真人補錄，介面如實顯示「未附音檔」；**不合成示範音檔、不改寫逐字稿**。

## 3. 本地運行

安裝依賴：

```bash
pip install -r requirements.txt
```

啟動（前後端同源，最接近部署環境）：

```bash
python -m uvicorn server:app --host 127.0.0.1 --port 8000
# 開啟 http://127.0.0.1:8000/voices-of-the-north-app.html
```

只用靜態伺服器預覽（`file://` 亦可開，但音訊跳秒需要支援 Range 的伺服器）：

```bash
python -m http.server 8421 --directory frontend
# 開啟 http://127.0.0.1:8421/voices-of-the-north-app.html
```

### API 位址解析順序

1. 網址參數 `?api=https://your-api`（即場切換用）
2. `window.VTN_API_BASE = 'https://your-api'`（部署時覆寫）
3. `localStorage['vtn.api-base']`（偵錯用）
4. 靜態預覽埠（8421 / 5500 / 5173 / 3000 / 8080 / 8081 / 4173）→ `http://127.0.0.1:8000`
5. 其他 http(s) 來源 → 同源；`file://` → `http://127.0.0.1:8000`

## 4. 環境變數（僅伺服器端）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `VTN_ALLOWED_ORIGINS` | `localhost:8421, localhost:5500, 127.0.0.1:8000` 等 6 個 | CORS 白名單，逗號分隔；不在名單的網站一律拒絕 |
| `VTN_SECRET` | 隨機產生 | 簽發 Bearer token 的 HMAC 金鑰；正式環境必須固定 |
| `VTN_MAX_AUDIO_BYTES` | `10485760`（10MB） | 單次上傳上限，超過即 413 |
| `VTN_ADMIN_EMAILS` | 空 | 管理員電郵，逗號分隔（審核更正、撤回故事、看稽核） |
| `VTN_DEMO_AUTH` | `1` | 示範用驗證碼登入（驗證碼會回傳在回應中，正式環境請設 `0`） |
| `VTN_DEMO_ALLOW_ADMIN` | `1` | 示範用學校帳號可取得管理員角色 |
| `VTN_TRUST_PROXY` | `0` | 設 `1` 時信任 `X-Forwarded-For`（放在反向代理後才開） |
| `VTN_DATA_DIR` / `VTN_STORY_DATA` | `data` / `data/stories.json` | 故事資料位置 |
| `VTN_DB_PATH` / `VTN_RECORDS_DIR` | `records.db` / `records` | SQLite 與音檔存放位置 |
| `VTN_RECORDS_TOKEN` | 空 | 舊版共用 token（相容用途） |
| `GEMINI_API_KEY` | 空 | 有金鑰才啟用語言模型整理；只放伺服器 |

前端不含任何 API 金鑰。

## 5. 私隱與安全

- **四級分享範圍**：私人（預設）/ 家人 / 社區 / 公開；每則故事可獨立設定，改動會寫入同意記錄與稽核日誌。
- **伺服器端過濾**：`/api/records`、`/api/records/{id}`、`/api/records/{id}/audio`、`/api/stories` 都會按檢視者身分重新過濾，不是只在前端隱藏。
- **撤回**：故事會同時從列表、地圖、篩選、建議問題、助手快取、搜尋與分享連結移除；本機端以軟刪除記錄，伺服器端記錄撤回事件。
- **更正**：申請 → 審核 → 產生新版本，原文保留並在詳情頁標示「已更正（原文保留）」。
- **限流**：`/api/process` 10 次、`/api/auth/request-code` 5 次、`/api/ask-village` 30 次、其他 `/api/*` 90 次（每分鐘每 IP）。
- **上傳**：分塊讀取，累計超過 10MB 立即中止，不把整個檔案讀入記憶體。
- **地圖**：只顯示約 800 米模糊範圍，不設精確 GPS 標記；`private` 故事在地圖、聚合數字、圖例計數與搜尋中都不會出現（前端 store 與後端 `/api/stories` 雙重過濾）。
- **地圖失敗**：MapLibre → Leaflet → 手繪示意圖三層回退；3D 不可用時按鈕會禁用並說明，不會靜默假裝成功。

## 6. AI 行為紅線

- 只根據**已授權**逐字稿回答，答案必附可點擊時間戳（`#stories?story=YL-001&t=17`）。
- 範圍外一律回覆「錄製的故事中未包含此資訊」，不引用外部知識。
- 取不到逐詞置信度時回傳 `null`，介面顯示「未能取得置信度」，不造假數字。
- AI 狀態（在線 / 降級 / 離線）在介面明示，不再靜默降級；降級時答案會標明「只用本機已授權語料產生」。

## 7. 測試

```bash
python tools/test_records_api.py    # 錄音 API 與權限（歷史腳本，與現行分享範圍契約待對齊）
python tools/test_lab_api.py        # 實驗室 API
python tools/audit_frontend.mjs     # 前端靜態檢查（需 node）
```

評審修復的回歸腳本放在 `tools/verify/`（`douglas_review.py`、`waveform.py`、`bbox_api.py`、`external_waveforms.py`）。地圖／問答的視口、篩選、空集合、授權、拒答與離線降級另以 `python tools/verify/story_scope.py` 驗證；淺色主題、首次引導、13 則故事／三語與 Word 腳本以 `python tools/verify/light_onboarding.py` 驗證。測試使用隔離資料庫，不改動現有錄音。

手動驗證要點：三語切換後重整仍保持、錄音停止即存草稿、斷網上傳變「待轉寫」且可重試、來源按鈕跳轉並從指定秒數播放、撤回後來源按鈕變灰；地圖首次進入自動顯示 3 步引導、`?` 可重看、Esc 可關閉，重整後不再自動彈出；設定頁已無深色入口。

## 8. 授權與致謝

- 地圖：MapLibre GL JS（BSD-3-Clause）、OpenFreeMap 圖資（無需 API key）、© OpenStreetMap 貢獻者；Leaflet（BSD-2-Clause）作 2D 回退。字型：Noto Sans HK（SIL Open Font License）。
- 示範故事由團隊撰寫，僅供黑客松演示；收錄真實訪談前必須先取得書面同意。
