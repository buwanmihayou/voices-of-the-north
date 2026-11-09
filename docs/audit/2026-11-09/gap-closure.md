# 兩個文檔的缺口收口記錄（2026-11-09）

來源：

- Ready for Techathon+ →「二、新功能建議（非社區類）」（tab `t.n7vlvugvce8`）
- 同一文檔 →「待完成」頁（tab `t.7iqwhuyu30d`）

## 一、逐項結果

| # | 缺口 | 狀態 | 落地方式 |
| --- | --- | --- | --- |
| 1 | 首頁底部殘留淺綠色區塊／深色下信任條看不清 | 已修 | 移除深色模式後 `--forest` 不再翻成淺綠；所有關閉中的彈層加 `visibility: hidden`，收起後不留一幀；信任條在淺色下對比正常 |
| 2 | 預設淺色、移除深色入口 | 已做 | `<html data-theme="light">`、設定頁刪除主題下拉、`prefs.theme='light'` 強制收回舊設定、移除 `prefers-color-scheme` 監聽 |
| 3 | 離線助手文案誤導 | 已做 | 三語改為「只從本機故事庫檢索，冇 AI 生成，亦冇上網」 |
| 4 | 首次進入地圖引導 | 已做 | `33-onboarding.js` 3 步浮層＋右上角 `?` 重看；Esc／遮罩／跳過可關；`localStorage` 記住；焦點管理與三語 |
| 5 | 故事擴到北區之外 | 已做 | 新增赤柱、九龍城、大澳（北區外）及谷埔、荔枝窩（東北鄉郊）5 則，總數 13 |
| 6 | 1 則英語＋1 則華語故事 | 已做 | `STN-009`（English）、`KLC-010`（華語）；語言標籤補 `lang.zh` / `lang.en` |
| 7 | 所有故事文字腳本 DOCX | 已做 | `docs/voice-scripts/Voices_of_the_North_Story_Scripts.docx`，13 則、28 個表格；md 同步重生成 |
| 8 | 年代軸聯動歷史影像 | 未做（外部阻塞） | 只保留「故事年代」過濾與標籤，沒有 LandsD 授權與切片就不加假圖層 |
| 9 | 3D 書籤谷埔／荔枝窩 | 已做 | `SCENE_VILLAGES` 改為谷埔、荔枝窩、粉嶺、上水、大埔；只取真實故事座標 |

## 二、主要檔案

- 前端：`frontend/src/js/33-onboarding.js`（新）、`55-settings.js`、`10-store.js`、`30-stories.js`、`35-map.js`、`05-i18n.js`、`00-config.js`、`99-init.js`
- 樣式：`app-ext.css`（引導＋彈層收起守衛）、`assistant.css`、`story-map.css`、`record-flow.css`、`styles.css`
- 資料：`data/stories.json`（13 則、三語、`contentVersion 2026.11.09`）
- 腳本：`tools/export_story_scripts_docx.py`（新）、`tools/export_voice_scripts.py`
- 驗證：`tools/verify/light_onboarding.py`（新）、`douglas_review.py`（改為資料驅動）

## 三、驗證

```bash
python tools/build_frontend.py
python tools/check_frontend_syntax.py
python tools/verify/fix_1108.py          # 全部通過
python tools/verify/douglas_review.py    # 25 項通過；年代軸 [1,4,9,12,13]
python tools/verify/story_scope.py       # 25 項通過
python tools/verify/bbox_api.py          # 12 項通過
python tools/test_lab_api.py             # 48 項通過
python tools/verify/waveform.py          # 相關係數 1.000
python tools/verify/light_onboarding.py  # 45 項通過
```

截圖：`onboarding.png`、`onboarding-320.png`、`story-map-13.png`、`story-map-320.png`、`home-bottom-light.png`（同目錄）。
Word 腳本另以 LibreOffice 渲染檢查 1、2、8 頁：標題、總表、逐則腳本、英文逐字稿均正常；12 頁、28 個表格，表格跨頁會重複表頭且不切斷列。

## 四、仍需外部條件

1. **LandsD 歷史航照**：需要授權條款、年份覆蓋與切片／配準；未取得前不做「假歷史底圖」，避免路演載入失敗或誤導。接入時只需換 `VTN_MAP_STYLE` 或加 raster layer，年代軸互動不用改。
2. **真人音檔**：13 則中只有 1 則有實測音檔；其餘 12 則如實標「未附音檔」。補錄後把 `durationSource` 改 `measured` 並重跑建置。
3. **2026 年後真實長者訪談**：所有新增故事仍是團隊撰寫的角色扮演示範，不是真實訪談。
