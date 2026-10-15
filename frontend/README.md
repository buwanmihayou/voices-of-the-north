# Voices of the North — 北部都會區・鄉村故事館（Frontend）

> 發展可以重建一個地方，但只有人能記住它。
>
> *Before development erases the memories of the Northern Metropolis, use AI to turn elders' stories into a living map anyone can talk to.*

香港跨大學生**生成式 AI × 可持續發展目標黑客松 2026**（Smart Living, Culture & Belonging）參賽作品前端。長者講一分鐘粵語村落故事，系統即時轉寫、標出時間戳出處，任何人可向故事檔案提問——**答案永遠指向來源錄音，唔會維基、唔會估**。

本文件夾為可直接放上 GitHub 的前端完整程式碼，包含兩個共用同一份故事語料（`lib/storyCorpus.js`）的前端形態，以及配套的 GitHub 專案文件。

---

## 1. 檔案結構

```
frontend/
├─ README.md                 ← 本檔
├─ LICENSE                   ← MIT
├─ .gitignore
├─ .env.example              ← Next.js 環境變數範本（複製成 .env.local 使用）
│
├─ index.html                ┐
├─ recording.html            │  四頁純靜態行動原型（Bootstrap 5.3 + 原生 JS）
├─ stories.html              │  主頁 / 錄音 / 故事 / 我的
├─ my.html                   ┘
├─ demo.html                 ← 評審演示台（手機殼投影片＋單頁引導）
├─ ai-assistant-preview.html ← Ask the Village 元件獨立預覽頁
│
├─ css/                      ← 原型樣式
│  ├─ styles.css             ← 設計令牌、佈局（app-shell 三段式、底導航）
│  ├─ record-flow.css        ← 錄音 BottomSheet、分頁、結果卡
│  └─ assistant.css          ← Ask the Village 彈層、FAB、氣泡
├─ js/                       ← 原型行為（無框架、無建置步驟）
│  ├─ main.js  my.js  stories.js  recording.js
│  ├─ record.js              ← 錄音彈層、上傳 /api/process、結果渲染
│  ├─ demo-audio.js          ← 示範音軌播放器
│  ├─ vtn-map.js             ← Leaflet 真實地圖（OSM → Esri → 手繪圖降級）
│  └─ ask-assistant.js       ← Ask the Village 彈層（掛載於 App 殼內）
├─ lib/                      ← 原型與 Next.js 共用
│  ├─ storyCorpus.js         ← 示範故事語料、座標、誠實檢索 retrieveAnswer()
│  └─ askVillageApi.js       ← 問答 API 客戶端
├─ assets/                   ← 原型素材（背景、插畫、吉祥物、示範音軌 m4a）
│
├─ app/                      ┐
├─ components/               │  Next.js 14 App Router 應用（React 18 + Tailwind）
├─ public/assets/            │  展示首頁＋服務端問答路由 /api/ask-village
├─ package.json              │
├─ next.config.mjs           │
├─ postcss.config.mjs        │
├─ tailwind.config.js        │  設計令牌與靜態原型保持一致
├─ jsconfig.json             ┘
└─ docs/
   └─ PRD-Voices-of-the-North.md   ← 產品需求文件 v1.0
```

> 後端轉寫服務（FastAPI `tools/server.py`，埠 8000）屬獨立服務，不在此前端文件夾內。前端在無後端時自動進入**離線示範模式**，所有流程仍可試跑。

---

## 2. 快速開始

### 2.1 純靜態原型（推薦評審／快速預覽）

只需任何靜態檔案伺服器，**無需 npm、無需建置**：

```bash
# Python（本專案開發使用 Python 3.14）
python -m http.server 8421
```

開啟：

| 頁面 | 網址 |
|---|---|
| App 原型入口（主頁） | http://127.0.0.1:8421/index.html |
| 評審演示台 | http://127.0.0.1:8421/demo.html |
| AI 助手元件預覽 | http://127.0.0.1:8421/ai-assistant-preview.html |

> 必須以 HTTP 伺服器開啟，不要直接雙擊 html（ESM 的絕對路徑 `import … from '/lib/…'` 需 HTTP 來源）。

### 2.2 Next.js 應用

```bash
npm install
cp .env.example .env.local     # Windows: copy .env.example .env.local
npm run dev                    # http://localhost:3000
```

環境變數：

| 變數 | 預設 | 說明 |
|---|---|---|
| `NEXT_PUBLIC_ASK_MOCK` | `false` | `true` 時改用瀏覽器端 Mock 問答，不需服務端 |
| `NEXT_PUBLIC_PROTOTYPE_URL` | `http://127.0.0.1:8421/demo.html` | 首頁「開啟完整原型」按鈕連結 |

### 2.3（可選）接上真實轉寫後端

原型的錄音上傳指向 `http://127.0.0.1:8000`（可用 `window.VTN_API_BASE` 覆寫）。未啟動後端或未設定 Google Cloud 憑證時：

- `GET /api/health` 回報離線示範模式，UI 顯示黃色提示條；
- 現場錄音會**誠實標示為「待轉寫」**，絕不冒充辨識結果；
- 「用示範故事試跑完整流程」可離線體驗完整時間戳問答。

---

## 3. 功能一覽

- **四頁行動 App 原型**：主頁、錄音、故事、我的；固定底導航＋App 殼內唯一滾動區，390px 手機視口與桌面手機框皆適配。
- **錄音 BottomSheet**：App 內彈層（不跳頁、不脫離手機框、不遮擋底導航），含半透明遮罩、X／遮罩／Esc 關閉、背景滾動鎖、麥克風權限與錄音時長狀態、上傳轉寫結果卡。
- **Ask the Village 問答助手**：FAB 入口上浮於底導航之上；全寬 BottomSheet、獨立訊息滾動區、鍵盤彈起自動托起；答案附 `Source: [YL-001] at 00:17` 時間戳來源卡。
- **真實地圖**：Leaflet＋OpenStreetMap 圖磚（Esri 街道圖二級後備、斷網回退手繪 SVG）；只畫「方圓約 800 米」虛線模糊圈，**不設 GPS 標記**。
- **離線示範模式**：無雲端憑證亦可跑通「一個故事的旅程」。

### 誠實性紅線（產品核心設計）

1. 答案只來自已錄製並授權的內容；
2. 在範圍的答案必附時間戳出處；
3. 超出故事範圍一律回答「抱歉，錄製故事中未包含此資訊」；
4. 未轉寫錄音只存為「待轉寫」，不偽造結果；
5. 現場錄音只作暫時處理，不會永久儲存；示範故事為範例媒體。

---

## 4. 設計與無障礙

- **Direction B「Oat × Sage」**：ivory `#F6F1E6`、cream `#FDFBF4`、forest `#2C5742`、jade `#7FA68C`、gold `#83632B`；字體 Noto Sans TC / Noto Serif TC。
- 繁體中文（香港用語）；正文字級照顧長者，觸控目標 ≥44px。
- 尊重 `prefers-reduced-motion`；面板具 `role="dialog"`、`aria-modal`、Esc 關閉與焦點管理；安全區使用 `env(safe-area-inset-bottom)`。

## 5. 技術棧與第三方資源

- 靜態原型：HTML／CSS／原生 JavaScript（ES Modules）、Bootstrap 5.3（CDN）、Font Awesome 6（CDN）、Google Fonts。
- Next.js 應用：Next.js 14（App Router）、React 18、Tailwind CSS 3。
- 地圖：[Leaflet](https://leafletjs.com/) 1.9.4、[OpenStreetMap](https://www.openstreetmap.org/copyright) 圖磚、Esri World Street Map（後備）。
- 示範音軌為 Boris Lau 真實示範錄音（非合成人聲）；插畫為專案自訂素材。

## 6. 授權

[MIT License](./LICENSE) © 2026 Voices of the North contributors。圖磚與字體版權歸各自權利方所有。
