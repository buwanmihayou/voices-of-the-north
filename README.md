# Voices of the North（北區之聲）

以生成式 AI 保存新界鄉村長者粵語口述歷史的示範平台：錄音 → 逐字稿 → 可核對的問答 → 四級私隱分享。

> **黑客松示範聲明**：8 則故事全部標記為「角色扮演示範故事」，由團隊撰寫，並非真實長者訪談。
> 唯一真實音軌為 `frontend/assets/Demo Story.wav`（實測 46.7 秒）。介面會如實標示「未附音檔」「未能取得置信度」。

## 1. 目錄結構

```
data/stories.json              單一資料來源：故事、逐字稿段落、授權、分享範圍、時長
frontend/src/                  前端原始碼（CSS / JS / HTML 模板，開發時只看這裡）
  css/*.css                    樣式模組
  js/00-config.js              版本、API 位址解析、共用工具
  js/05-i18n.js                三語翻譯表（zh-HK / zh-CN / en）
  js/10-store.js               統一儲存層（localStorage + 記憶體回退）
  js/15-api.js                 後端 API 封裝（含 Bearer token）
  js/20-audio.js               音訊播放與跳秒
  js/25-ui.js                  toast / 對話框 / 狀態徽章
  js/30-stories.js             故事列表、篩選、詳情、來源跳轉
  js/35-map.js                 模糊範圍地圖（Leaflet + 圖磚回退）
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
frontend/js, frontend/lib      舊版副本，僅供對照（已不參與建置）
server.py                      FastAPI 後端（同時託管 frontend/ 靜態檔）
story_corpus.py                語料檢索與拒答邏輯（讀 data/stories.json）
tools/build_frontend.py        建置腳本：驗證資料 → 合併成單檔 → 語法檢查
tools/check_frontend_syntax.py 單檔語法檢查
tools/audit_frontend.mjs       前端自我檢查（可選）
```

## 2. 建置

```bash
python tools/build_frontend.py          # 驗證 + 產出 frontend/voices-of-the-north-app.html
python tools/build_frontend.py --check  # 只驗證資料
python tools/check_frontend_syntax.py   # 檢查單檔內嵌 JS 語法
```

建置時會硬性檢查（不通過即失敗）：

- 故事 ID 唯一、`scope` 只能是 `private / family / community / public`
- 每則故事必須有 `authorized: true` 與 `consentRef`
- 逐字稿段落時間遞增、不重疊，且 `end` 不可超出 `durationSec`
- 有音檔者 `durationSource` 必須是 `measured`，且 `durationSec` 必須與**音檔實測長度**一致（±0.5 秒）
- 逐字稿結尾不可超出音檔實測長度（否則「可溯源」會跳到不存在的秒數）

新增故事只需改 `data/stories.json`，不必改頁面程式碼。

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
- **地圖**：只顯示約 800 米模糊範圍，不設精確 GPS 標記。

## 6. AI 行為紅線

- 只根據**已授權**逐字稿回答，答案必附可點擊時間戳（`#stories?story=YL-001&t=17`）。
- 範圍外一律回覆「錄製的故事中未包含此資訊」，不引用外部知識。
- 取不到逐詞置信度時回傳 `null`，介面顯示「未能取得置信度」，不造假數字。
- AI 狀態（在線 / 降級 / 離線）在介面明示，不再靜默降級；降級時答案會標明「只用本機已授權語料產生」。

## 7. 測試

```bash
python tools/test_records_api.py    # 錄音 API 與權限
python tools/test_lab_api.py        # 實驗室 API
python tools/audit_frontend.mjs     # 前端靜態檢查（需 node）
```

手動驗證要點：三語切換後重整仍保持、錄音停止即存草稿、斷網上傳變「待轉寫」且可重試、來源按鈕跳轉並從指定秒數播放、撤回後來源按鈕變灰。

## 8. 授權與致謝

- 地圖圖磚：© OpenStreetMap 貢獻者；字型：Noto Sans HK（SIL Open Font License）。
- 示範故事由團隊撰寫，僅供黑客松演示；收錄真實訪談前必須先取得書面同意。
