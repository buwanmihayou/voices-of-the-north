# 故事年代筛选改造 — 2026-11-11

需求来源：[Ready for Techathon+ → 2026.11.10 Douglas → .md](https://docs.google.com/document/d/14FC-HMG4XN_1__UsnZWDY3Oc1w0eP-351RwGAsLaifo/edit?tab=t.n5hkbfbipxy1)。本次仅执行该标签页中的时间轴需求。

默认选择独立的“全部年代”胶囊，时间轴和年份弱化。点击年份或拖动滑块后，取消“全部年代”并高亮所选年份；点击“全部年代”恢复全部年代。

五个固定档位：1950（year < 1960）、1960（1960–1969）、1970（1970–1979）、1980（1980–1989）、1990+（year ≥ 1990）。其他现有筛选继续与年代取交集。当前 13 则故事分布为 4 / 5 / 3 / 1 / 0，最后一档为空时如实显示空状态。

保留米白、森林绿和圆角悬浮卡片；同步更新三语引导与无障碍状态。年代写入新的 `decade` URL 参数，重载保留选择；旧 `since=2026` 链接仍进入全部年代。修复空状态遮挡控件，以及地图降级后重置仍残留空提示的问题。

320×568 短屏使用紧凑顶栏：装饰标题仅视觉隐藏，保留读屏可访问性及全部操作按钮；时间轴不再与搜索、图例重叠，胶囊、滑块和年份按钮仍保留 44px 操作区域。

验证命令：

```powershell
python -X utf8 tools/build_frontend.py
python -X utf8 tools/check_frontend_syntax.py
python -X utf8 tools/verify/era_filter.py --screenshots
python -X utf8 tools/verify/story_scope.py
python -X utf8 tools/verify/light_onboarding.py
python -X utf8 tools/verify/douglas_review.py
```

年代专项覆盖真实点击、原生滑块键盘/拖动、边界年份、空结果重置、URL 重载、列表/地图/助手请求集合一致性及短屏操作。边界语料仅替换测试浏览器内的数据，不修改真实故事。截图见同目录 `era-all-390.png`、`era-1960-390.png`、`era-all-320.png`、`era-1960-320.png`。

结果：构建与语法检查通过；年代专项 184 项通过，320×568 英文界面额外 6 项布局检查通过；现有 `story_scope` 25 项、`light_onboarding` 45 项、`douglas_review` 25 项均通过。

浏览器回归拦截外部 CDN，验证的是地图降级模式与传给地图的数据集合；未据此声称第三方在线底图或生产部署已验证。成果包含源码、重新生成的单文件前端与验收截图。用户随后要求同步 GitHub，本次提交包含这些成果；是否已推送以远端提交记录为准，未主动触发或验证生产部署。
