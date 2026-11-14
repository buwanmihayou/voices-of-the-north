# Doc Tab — Voices of the North（2026-11-14 交付）

> 纯前端 Web 应用（localStorage，无强制后端）；入口 `voices-of-the-north-app.html`；本地服务器 `http://127.0.0.1:8421`。
> 约束红线：三套置信度阈值数值（0.75 / 0.5 / 0.8-0.5）、移动端 UI 瘦身规则、底部白边、缩略图角标 14px/-6px **一律未改动**。

## 交付状态
- **分支**：`fix/demo-labels-a11y-confidence`（基于 main，已 `git push origin`）
- **PR**：https://github.com/phatdat220707/voices-of-the-north/pull/new/fix/demo-labels-a11y-confidence
  （`gh` CLI 未安装，走网页开；标题 `Demo confidence labels + a11y fixes + confidence unavailable fallback`，本文件内容可整段粘贴为 body）
- 所有代码改动已 **commit + push** 到该分支；**尚未 merge main**（即全部修复仍 local 于分支 / 待合并 PR）。

---

## 1. 手机 + 桌面测试证据
**Done** — `scripts/evidence.mjs` 在 390×844 与 820×900 两视口各截 4 张（stories / media / recording / settings）= 8 张，并录 30s 操作 `walkthrough.webm`；`.gitignore` 忽略 `evidence/`（仅 README 入库）。`node scripts/evidence.mjs` 可复现。

- **proof（本地路径，未入库，见 Drive）**：
  `evidence/{mobile,desktop}-{stories,media,recording,settings}.png`（8 张）、
  `evidence/walkthrough.webm`、`evidence/task2-filter-touch-390.png`、
  `evidence/task4-media-overlay.png`、`evidence/task4-stories-list.png`、`evidence/README.md`
- **Drive 合集**：[待补 Drive 链接]
- **每项证明什么**：
  - `*-stories` = 地图铺满至 tab bar / pin 可见 / 无底部白边 / UI 已瘦身
  - `*-media` = 媒体弹窗在 430 外壳内 + footer「示範」标签
  - `*-recording` = 录音卡片展开 + 图标选择器（7 类）可见
  - `*-settings` = 设置页正常
  - `task2-filter-touch-390` = 44×44 触控热区（红虚线）包住 34×34 视觉按钮（绿框），蓝框搜索框间距 16px **不重叠**

---

## 2. Contributor States（工作中 vs 占位符）
**Done（只读盘点，未改任何代码）**。状态机归一化：`10-store.js:214`（`['draft','pending','done']`）。

### A. 录音三态
| 状态 | 触发（src:行） | 渲染（45-recordings.js） | 真实数据流 | 判定 |
|---|---|---|---|---|
| 草稿 draft | 新录存本地 `status:'draft'`（40-recorder.js:495） | `renderDraftBody` / `tab-drafts`（:169 / :69） | localStorage 真实 + `/api/process` | 🟢 工作中 |
| 待转写 pending | 上传失败 → `status:'pending'`（40-recorder.js:665） | `renderPendingBody` / `tab-pending`（:186 / :69） | localStorage + 重试后端 | 🟢 工作中（需后端才转写） |
| 已完成 done | 上传成功 STT 回写（40-recorder.js:640, :960） | `renderDoneBody` / `tab-done`（:208 / :69） | 后端在线则真 STT；离线仅 draft | 🟢 工作中（需后端） |

### B. 置信度四档
| 档 | 阈值（src:行） | 渲染 | 真实数据流 | 判定 |
|---|---|---|---|---|
| 高 | ≥0.8（30-stories.js:869；40-recorder.js:797） | `confidenceBadge`（30-stories.js:868） / `recConfidenceBadge`（40-recorder.js:918） | 故事=Mock（`confLevels` 30-stories.js:28）；录音=真 STT | 🔴 故事占位符 / 🟢 录音工作中 |
| 中 | ≥0.5 | 同上 | 同上 | 🔴 / 🟢 |
| 低 | <0.5 | 同上 | 同上 | 🔴 / 🟢 |
| 无数据 | `null` | 同上 → `conf.unavailable`（任务 3） | 演示数据显式 null / STT 无字段 | 🟢 已处理（显 unavailable） |

⚠️ 三套阈值数值（0.75 / 0.5 / 0.8-0.5）**未改动**（硬约束）。

### C. 其他状态（贡献者身份 / 权限）
| 状态 | src:行 | 数据流 | 判定 |
|---|---|---|---|
| 贡献者身份 `author='me'` | 30-stories.js:27（`MINE`）、:35 注入、:304 / :883「我的录音」开关 | 演示注入 3 笔（YL-001 / FL-003 / STN-009） | 🔴 占位符 |
| 权限 `scope` | 10-store.js:216 / 387-398 / 431 | localStorage 真实可读写 | 🟢 工作中 |
| 角色 `role` | 10-store.js:124 / :103 | session 真实 | 🟢 工作中 |
| 纠错 `correction` | 10-store.js:522（`addCorrection`）、:554（`approve`） | localStorage（`K.corrections`）本地可提交 / 批准 | 🟢 工作中（本地） |
| 撤回 / 授权 `withdrawn` / `authorized` | 10-store.js:617 / :651；stories.json `authorized:false` | 预置（未授权） | 🔴 占位符 |
| 同步 `sync` | 40-recorder.js:628（patch 后端）、10-store.js:404（`patchRecord`） | 本地优先，后端可选 | 🟢 本地 / 🟡 后端可选 |

---

## 3. Mock / Demo 标签状态
**Done — 已加统一「示範」标识（清晰可见，非隐蔽小字、非仅 tooltip）**。
- **现状**：`augmentMockData`（30-stories.js:23-43）运行期注入示例媒体（i=0,1→BigBuckBunny 视频、i=2→picsum 图，其余音频）；`confLevels`（30-stories.js:28）确定性注入置信度。
- **标识**：三语 `badge.demo`（05-i18n.js:155 / 818 / 1481）+ 媒体弹窗 footer（33-media.js:118）+ 故事置信度徽章旁（30-stories.js:868-879）低调灰标签；**录音**置信度（真实 STT）**不标**。
- **proof**：`evidence/task4-media-overlay.png`、`evidence/task4-stories-list.png`；`fix_1108` **0 failed**、lint 0。

---

## 4. 录音置信度来源核查结论 + unavailable 改前改后
- **核查结论（任务 6）**：已验证来自**真实 STT**，**不改代码**。完整链路：
  录音上传 → `POST /api/process`（40-recorder.js:620）→ 后端 `server.py:1280` 解析 Google Speech 词级置信度（server.py:1292-1297 `word_conf = getattr(word_info,"confidence",0.0)`，无字段则 `None`）→ 前端 `normalizeWords(data.words)`（40-recorder.js:638 / 698）取 `word.confidence` → `confidenceSource`（40-recorder.js:648）= `'provider'` → `recConfidenceBadge`（40-recorder.js:918）显示词级平均（40-recorder.js:799）。**无任何写死 / mock**；若 STT 无 `confidence` 字段 → `null` → `'unavailable'` 兜底（已实现）。
- **unavailable 改前改后（任务 3）**：
  - 改前：`none` 档渲染 `conf.none` → 「無數據 / 无数据 / No data」
  - 改后：映射 `conf.unavailable` → 「無法取得 / 无法获取 / unavailable」
  - src：30-stories.js:871、40-recorder.js:920、05-i18n.js:154 / 817 / 1480；lint 0、`fix_1108` 0 failed。**阈值未动**。
- **proof**：commit `26ff477` / `b5afe37`；重建产物 `voices-of-the-north-app.html`。

---

## 5. Filter button a11y + touch size 改前改后
- **accessible name（已含）**：改前 `#filterToggle` 无 accessible name（图标 `aria-hidden`）；改后 `data-i18n-aria="stories.filterAria"`（app.template.html:228）+ 三语（05-i18n.js:256 / 919 / 1583）→ `aria-label="篩選 / 筛选 / Filter"`。commit `d8158e1`。
- **touch size（今日新增）**：改前命中区 = 34×34（WCAG 2.5.5 不达标）；改后用 `.page--stories .atlas__filter::before { inset:-5px }` 扩至 **44×44**，视觉维持 34×34、不位移、不动 UI 瘦身。app-ext.css（新增 `::before`）。commit `8864586`。
- **proof**：`evidence/task2-filter-touch-390.png`（红虚线 44×44 包绿框 34×34，蓝框搜索框间距 16px 不重叠）；几何实测 `btnW/H=34`、`gapToSearch=16`、`hitAreaLeft > searchRight`；`fix_1108` 0 failed。

---

## 6. Assistant 语言刷新 改前改后
- **改前**：切语言 → assistant 悬浮按钮（fab）文案不变，需 reload 才更新。
- **根因**：`99-init.js:73-79` 的 `vtn:lang-changed` 监听只刷新 stories / recordings / about，**未调 `assistant.refresh()`**；fab 的 `aria-label` 在 `build()`（50-assistant.js:287）一次性设置。
- **改后**：assistant 模块内自监听 `vtn:lang-changed` 调 `refresh`（50-assistant.js:365）；`refresh`（50-assistant.js:669-672）即时更新 fab `aria-label` + hint。**未动全局 i18n 架构、未影响其他模块**。commit `680a107`。
- **proof**：Playwright 实测切语言（不 reload）fab `aria-label` 即时变（「開啟村落問答助手」→「Open the village Q&A assistant」）；`fix_1108` 0 failed、lint 0。

---

## Next（待办，非阻塞）
1. 在 GitHub 网页打开 PR（链接见上），body 可整段粘贴本文件。
2. 上传 `evidence/` 截图 + `walkthrough.webm` 至 Drive，替换 README 的 `[待补 Drive 链接]`。
3. （可选）删除冗余旧分支 `fix/demo-labels-and-a11y`（内容同新分支、未开 PR）。

## Blocked
- **无**。全部 9 任务均可交付；仅 PR 合并需 reviewer，证据 Drive 链接待补（不阻塞代码交付）。

## 群消息文案（≤3 行）
```
【Voices of the North 11/14 收尾】filter 按钮补 aria-label + 44×44 触控热区、置信度无数据显示 unavailable、
示例素材/Mock 标签、助手按钮语言即时刷新均已完成；双视口截图+录屏见 Drive[待补]。
代码已推分支 fix/demo-labels-a11y-confidence，PR 待开/合并。
```
