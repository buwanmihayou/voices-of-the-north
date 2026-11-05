# Zheng — Nov 5 交付说明：测试版录音存储 / 存取 / 删除

- 日期：2026-11-05（HKT）
- 对应任务：`D:/GenAI Hackathon/GenAI hackathon.docx` →「Nov 5 - build and prepare test material / Zheng: implement the agreed storage/access/deletion changes in a test version」，以及该文档「优先级总结：今天到 11/5 的行动顺序」中 Zheng 的 P0 `/api/ask-village`、P1 后端存储与前端接入、P1 关于页。
- 状态：**代码已完成并通过本地验证；未部署到 Render，未提交 Git，未更新 shared doc，未发群消息。**

## 1. 完成项

| 优先级 | 文档任务 | 结果 |
|---|---|---|
| P1 | 后端存储 API（SQLite + 文件系统） | ✅ `POST /api/records`、`GET /api/records`、`GET /api/records/{id}`、`GET /api/records/{id}/audio`、`DELETE /api/records/{id}` |
| P1 | 前端 `record.js` 连接后端存储 | ✅ 单文件 HTML 内 `VTNRecords` 增加后端同步；保存 → 服务端、重新打开 → 启动拉取/合并、删除 → 服务端实体删除；localStorage 保留为离线缓存 |
| P0 | 实现 `/api/ask-village` 端点 | ✅ 后端同构语料 `story_corpus.py`，输出形状与前端 `retrieveAnswer()` 一致；前端可用 `?qa=backend` 切换验证，失败自动回退本地 |
| P1 | 关于页（如有余力） | ✅ 「我的 → 關於」由「準備中」改为真实 `<dialog>` 页面 |
| — | consent 与隐私文案对齐实际行为（Dat 的 Nov 5 检查项） | ✅ 同意书改为「测试版暂存 + 可随时实体删除 + 勿录入真实长者资料」，与代码一致；「更正/撤回」入口改为指向已实现的删除功能 |

## 2. 改动文件

| 文件 | 说明 |
|---|---|
| `server.py` | 新增存储层、5 个 records 端点、`/api/ask-village`；`/api/health` 增加 `storage_ready / storage_mode / records_count / ask_village_ready`；原有 `/api/process` 与 STT/Gemini 逻辑**未改动** |
| `story_corpus.py` | 新增：后端同构语料库（YL-001 段落 + 关键词组 + `retrieve_answer()`），与前端 `lib/storyCorpus.js` 一一对应 |
| `frontend/voices-of-the-north-app.html` | 存储层同步、删除回执、离线墓碑、consent 文案、关于页、我的页文案、助手后端开关 |
| `tools/test_records_api.py` | 新增：38 项 API 自动化验收（隔离临时 DB，不碰项目运行数据） |
| `tools/check_frontend_syntax.py` | 新增：校验单文件 HTML 内嵌脚本语法（需 `pip install esprima`） |
| `docs/audit/2026-11-05/zheng-nov-05-delivery.md` | 本文件 |

运行数据 `records.db` / `records/` 已在 `.gitignore` 中，未纳入版本控制。

## 3. API 契约

- `POST /api/records`：JSON 为整笔前端 record + `audioBase64`（也兼容 `audioDataURL`）。回传 `{ok, id, savedAt, record}`，`record.audioUrl = /api/records/{id}/audio`。同一 id 重复提交为更新，未带音频时保留既有音频档。
- `GET /api/records` → `{records: [...], count, mode}`；按 `createdAt` 倒序，含服务端 `audioUrl` 与 `sync: "server"`。
- `GET /api/records/{id}` → 单笔完整 record（重新打开）。
- `GET /api/records/{id}/audio` → 音频档（FileResponse）。
- `DELETE /api/records/{id}` → 实体删除音频档 + 数据库列 + 出处索引，写入不含个人资料的 `deletion_events` 稽核纪錄，回传 `{ok, serverHad, audioRemoved, textRemoved, deletedAt, deletionLogId}`；重复删除幂等。
- `POST /api/ask-village`：`{"question": "..."}` → `{inScope, answer, sources, demo, storyId}`，无命中回标准拒答句。
- `GET /api/health`：`storage_ready / storage_mode / records_count / ask_village_ready` 供前端判断在线/降级。

环境变量（可选）：`VTN_DB_PATH`、`VTN_RECORDS_DIR`、`VTN_RECORDS_TOKEN`。设置 token 后，所有 `/api/records` 请求需 `X-VTN-Token` 头；前端设 `window.VTN_RECORDS_TOKEN`（音频 URL 自动带 `?token=`）。

## 4. 验证证据

```
python tools/test_records_api.py        → ALL PASSED: 38 checks
python tools/check_frontend_syntax.py  → 2/2 script blocks parsed
uvicorn server:app --port 8124
  /api/health                        → status=ok storage_ready=True mode=test-no-auth records=0 qa=True
  /voices-of-the-north-app.html      → 200, 207,266 bytes（含 aboutDialog / initBackend() / qa=backend）
  /                                  → 307 → /voices-of-the-north-app.html
```

38 项覆盖：保存、列表、单笔重开、音频字节一致、转写重试更新（音频不清空）、问答命中/拒答/空问题契约、实体删除、稽核纪錄、幂等删除、非法 ID 与坏 base64 的 400。语法检查同时跑过改动前版本，确认没有新增语法错误。

## 5. 诚实披露：限制与阻塞

1. **测试版无鉴权**（`storage_mode: test-no-auth`）：`GET /api/records` 会列出测试服务器上所有录音。因此**不得录入真实长者资料**；已在同意书与关于页明确写出。正式采集前必须换正式鉴权、保留期政策与正式同意书。
2. **零真实长者数据**：仍只有 YL-001 角色扮演示范故事；Boris 的 3–5 段粤语测试音频未到位，故未录入 `storyCorpus`。
3. **Gemini 线上未就绪**（`gemini_ready=false`）：`qaList` 为空，助手第二语料层仍靠前端本地；后端 `/api/ask-village` 本次只迁移已发布故事语料，用户录音层仍在前端 `honestAnswer()`，避免前后端答案漂移。
4. **关键词检索，不是向量 RAG**：与 11/3 审计一致，未在本次范围内升级。
5. **跨设备删除一致性**：前端用 `vtn-deleted-v1` 墓碑 + 连线后补发 DELETE；若设备长期离线，服务端副本会保留到该设备下次连线。
6. **未部署**：本次只在本地验证，Render 上的 `/api/health` 仍不会显示 `storage_ready`。部署需先确认平台磁盘持久化策略（重启可能清空 `records/`）。
7. **未做**：真实手机/电脑端全流程测试（Nov 6 任务）、Steven 的加载/错误态联调、Boris 的转录比对、Dat 的文案复核、shared doc 与群消息（见第 7 节草稿）。

## 6. Nov 6 建议测试清单（给 Zheng + Steven）

1. 手机与电脑分别录一段 → 转写 → 保存 → 刷新 → 在另一装置打开同一页面，确认记录与音频都在。
2. 在其中一台删除 → 另一台刷新，确认记录**没有复活**（墓碑 + 补发 DELETE）。
3. 断网录一段 → 恢复网络 → 确认 `pendingPush` 自动补传。
4. 用 `?qa=backend` 问「細個元朗周邊係點㗎？」与一个无关问题，确认命中附出处、无关问题标准拒答；停掉后端再问，确认自动回退本地。
5. 检查删除后的 toast 回执与 `deletion_events`，确认不含任何逐字稿内容。
6. 逐项截图作为 evidence 贴到 shared doc。

## 7. Thẻ 17 日报（Nov 5 段落草稿，待贴到 shared doc）

**Nov 5 (Thursday) — Zheng**

- Implemented the agreed recording → transcript review → save → reopen → delete flow in a test version: SQLite metadata + local audio files, with `POST /api/records`, `GET /api/records`, `GET /api/records/{id}`, `GET /api/records/{id}/audio` and `DELETE /api/records/{id}`. Deletion is physical (audio + text + citation index) and writes an audit log with no personal data.
- Connected the deployed single-file frontend: saves push to the server, the list pulls/merges on load, deletes call the server API, and localStorage remains as an offline cache with tombstones so deleted items do not reappear on another device.
- Implemented `/api/ask-village` with a backend corpus (`story_corpus.py`) that mirrors the frontend `storyCorpus.js` output shape; `?qa=backend` exercises it, with automatic local fallback.
- Replaced the "preparing" About page with real content, and updated the consent wording to match what this test build actually does (temporary server storage, deletion at any time, do not use real elder recordings).
- Evidence: `python tools/test_records_api.py` → 38/38 checks passed; frontend script syntax check 2/2; local uvicorn smoke test (health / page 200 / root redirect 307).
- Blocked / not done: not deployed to Render, no authentication in this test build (must not be used with real elder data), Gemini still not configured, Boris's Cantonese clips not yet available, phone/computer cross-device testing is scheduled for Nov 6.

**群消息草稿（未发送）**：

> Nov 5 done: test-version storage/access/deletion is working — recordings now survive a browser change, and delete physically removes audio + transcript with an audit log. Also added `/api/ask-village` and a real About page; consent wording now matches the build. Evidence: `docs/audit/2026-11-05/zheng-nov-05-delivery.md`, 38/38 automated checks passed, plus local smoke test. Blocked: not deployed yet, no auth in the test build (internal test data only), Gemini still off, waiting on Boris's clips for Nov 6 cross-device testing.

## 8. 待确认

1. 是否把这批改动提交并推送到 GitHub？（当前未提交；工作区另有 `Ready_for_Techathon_plus.txt`、`docs/AI压力测试/`、`wechat_export/`、`wechat_tools/` 未跟踪，均未擅自处理。）
2. 是否部署到 Render？部署前需确认磁盘持久化与是否启用 `VTN_RECORDS_TOKEN`。
3. 是否由我把日报与群消息草稿写入 shared doc / 发出？（本轮未做任何对外发送。）
