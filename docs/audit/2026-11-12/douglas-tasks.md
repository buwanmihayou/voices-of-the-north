# Douglas 待办执行 — 2026-11-12

来源：[Ready for Techathon+ → 2026.11.12 Douglas_待完成](https://docs.google.com/document/d/14FC-HMG4XN_1__UsnZWDY3Oc1w0eP-351RwGAsLaifo/edit?tab=t.sfixgxecksyo)。本次执行该标签页的三项要求。

## 结果

1. 新增 `FL-014`，1994 年粉岭的 AI 虚构角色扮演示范。标题、来源、讲述者和正文均标明虚构；没有添加音档，置信度保留 `null`。故事共 14 则，五个年代区间分布为 **4 / 5 / 3 / 1 / 1**。三语年代标签、Markdown 配音稿和 README 已同步。原有 Word 配音稿保留为 13 则的历史批次，README 明确其范围。
2. 年代按钮、全部年代、滑块输入不再调用自动适配故事视角；清除筛选、完成或关闭筛选面板也保留视角。只更新故事集合与选中状态，用户仍可主动缩放、拖动、重新置中或选择故事定位。
3. “我的”仅保留设定入口；按用户最新截图要求，设定主页直接呈现“显示”“播放”分组，移除“一般”标题及顶部“一般／语言”切换条。语言与字级、高对比平级，只从显示组内的设置行进入。行内显示当前语言，支持点击及 Enter/Space；语言详情地址仍为 `#settings?tab=language`，繁中、简中和 English 即时生效并保存。详情返回设定主页并聚焦语言行，再次返回进入“我的”；刷新、浏览器前进后退及旧 `account.openLanguage()` 入口保持可用。页面切换后焦点进入可见标题，隐藏区域不保留焦点。

已重新生成 `frontend/voices-of-the-north-app.html`。用户随后要求同步 GitHub；本提交收录这三项改动、截图与复现检查。未手动触发生产部署，没有修改 Google 文档完成状态。

## 验证

以下命令均通过，使用 `-X utf8` 避免本机 Windows GBK 控制台输出失败：

```powershell
python -X utf8 tools/build_frontend.py
python -X utf8 tools/check_frontend_syntax.py
python -X utf8 tools/verify/era_filter.py
python -X utf8 tools/verify/era_camera.py
python -X utf8 tools/verify/era_camera_real.py
python -X utf8 tools/verify/settings_language.py
python -X utf8 tools/verify/fix_1108.py
python -X utf8 tools/verify/story_scope.py
python -X utf8 tools/verify/light_onboarding.py
python -X utf8 tools/verify/douglas_review.py
python -X utf8 tools/verify/story_sheet_layout.py
```

- 年代集合／边界／URL／列表与助手一致性：184 项。
- 确定性地图集成：272 项，涵盖 MapLibre／Leaflet、缩放 8／12／17、中心／缩放／俯仰／朝向、滑块拖动与键盘、筛选面板、空结果、选中故事被排除、显式缩放及重新置中。以测试内存恢复原有自动适配调用后，检查会失败。
- 实际固定版本地图引擎：MapLibre 4.7.1 和 Leaflet 1.9.4，共 52 项。使用本地空白样式、不加载远端底图瓦片；验证视角和交互独立性，不据此声称线上底图或生产环境已验收。
- 设置层级及语言入口：最终修正后的 79 项，覆盖 320×568、390×844 和 1280×800 下无“一般”标题及重复标签、三语当前值、同级结构、保存、重载、历史记录、Enter/Space、返回焦点及 44px 触控目标；另检查 320px 特大字号下的语言名称换行与可读性。最终截图使用本目录 `settings-final-*`；此前含“一般”标题或顶部切换条的截图为旧版本记录。短屏使用正常滚动和点击操作，截图前关闭可关闭的助手提示。
- 现有回归：`fix_1108` 48 项、`story_scope` 25 项、`light_onboarding` 47 项、`douglas_review` 25 项、`story_sheet_layout` 68 项。

静态测试会拦截外部 CDN，截图里的图标字体可能未加载。真实地图引擎测试另外加载实际地图 JavaScript。未修改现有录音数据库或音档。
