# B 系统提速：关系图画布 2C.1

## 范围与基线

独立工作树 `/private/tmp/wiselink-perf-b-graph-20260922`，分支 `codex/perf-b-graph-20260922`；父提交 `d58615c5a7c65412645c908bfe674b78dbeba2ee`。只改 SuiteGraphCanvas、对应测试及本记录，不与 A 的 JobAid/OpenClaw 文件重叠。主控唯一集成、同步、发布；Luna 独立验收。

沿用 H0/T0/PDF 候选，不重复其已有验收。先前 B 活动错误重挂载修复 `aac9bd64ee80fb9a967d64c05aed120b42c12350` 与审查记录 `28d87908285ac4dce780fcb83955b91dfb07a9c2` 仍须由主控按范围接收，本分支不包含它们。

## 实现与证据

原画布在每次 render/resize/pan/zoom 都读取全部节点，重复 setState 并回传相同 camera。本批将这些事件按 requestAnimationFrame 合并，复制可变 data/position/pan 快照，浅比较覆盖层数据和精确比较坐标；无变化不触发 React 更新或重复视口回调。首次装载、presentation 替换及窄屏显式聚焦仍立即同步；卸载取消 pending frame，并阻止已排队回调访问销毁实例。拓扑布局、业务选择、来源与权限不变；没有实现完整图谱增量更新或缓存。

性能反例来自真实 React 组件的受控 Cytoscape 事件夹具：同帧100个事件，父提交读取节点100次；本批帧前0次、帧内1次，最终视口回调1次；下一帧100个未改变事件，读取1次、React Profiler提交0次、视口回调0次。原实现跑新增反例退出1，实际100次；改后通过。该证据是事件处理工作量变化，不是生产帧率或端到端耗时结论。

另用实际 Cytoscape headless core 验证 pan/zoom 事件、渲染坐标、data/position原位变化以及presentation替换后卡片更新；仍不等同于浏览器Canvas像素或真实业务验收。

## 验证

- Jest：suite-graph-canvas、suite-graph-view-camera、suite-graph-return、suite-graph-presentation、suite-graph-appearance，共5套52项通过，正常退出；包括原有拖动/取消/halo/reset、窄屏聚焦、精确相机恢复、关系边选择。
- `npm run type:check:client`：通过。
- 两个修改TS/TSX文件定向ESLint：通过。
- `git diff --check`：通过。
- `npm run build:client`：通过，13.61秒，保留既有大chunk警告。正常提交前检查结果见交付回执。
- 本独立树没有运行中的devserver或对应日志；检查本批Jest/typecheck/lint/build输出。真实Cytoscape沿用已有wheelSensitivity提示，不改变该设置。

临时日志前缀 `/private/tmp/wiselink-perf-b-graph-`：before.log、test.log、regression.log、types.log、lint.log、build.log。

## 独立验收与发布条件

交由Luna针对准确提交检查按帧合并、相同状态不提交、数据变更/拖动仍更新、卸载清理及视角恢复。主控接受并集成到最终候选后，真实浏览器可验证图谱初始展示、连续拖动/缩放、切换视角及返回；应核对实际发布SHA，并测量真实帧率/耗时。未发布，未调用Hosted业务，未发起AssessmentRun，不声称线上提速已验收。
