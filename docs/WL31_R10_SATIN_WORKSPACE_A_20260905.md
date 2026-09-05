# WiseLink R10 Satin Workspace · Frontend A 交付记录

日期：2026-09-05

基线：`99d63086837f9c419c228a529a5dbf58b7dbda25`

分支：`codex/wl31-r10-satin-workspace-a-20260905`

## 实际完成范围

- 将生产前端的框架材质收敛为 Silver / Carbon Satin：磨砂框架、实纸阅读面、凹入协作区、悬浮输入区。
- 浅色与深色框架主色保持中性灰，绿色、琥珀色和红色仅用于真实业务状态。
- 左侧单轨导航收窄到 80px；“任务”在真实 `/tasks` 接通前改为“事项”，避免入口名称与行为不一致。
- 未返回真实 Matter 身份时，不再用“文档编号 + 事项”拼接伪造业务身份，统一显示“工程评估”。
- 左栏仅保留需要关注的 Job-Aid 进度徽标，不再把普通统计数冒充待处理状态。
- 资料库选中对象时采用对象目录 + 324px 工程快览；未选中对象时只保留目录主面，避免预览与快览重复。
- 工作台桌面端证据/助手区默认约 326px；小屏只显示一个主面板并使用底部导航。
- 结构化内容改为连续文档：章节、段落、表格、条件、例外和警告共享同一阅读面，SourceRef 仍可进入 PDF 证据。
- 综合评估 Hero 改为稳定实纸阅读面；候选、正式、过期等状态只通过细线语义表达。
- 持续复核区采用凹入协作区和悬浮输入器；候选未读回时明确显示“下一轮指示”，不再用创建时间或“候选缺失”推断系统正在运行。
- 兼容模式关闭框架、面板与遮罩模糊；reduced-motion 停止环境动效并将过渡缩至近零。

## 验证结果

- `npm run type:check:client`：通过。
- `npm run stylelint`：通过。
- 目标 Jest：6 suites / 42 tests，通过。
- `npm run build:client`：通过。
- `git diff --check`：通过。
- 本地浏览器：1440×900 浅色、1440×900 深色、390×844 小屏完成视觉核验。
- 兼容模式读回：应用框架与导航 `backdrop-filter: none`。
- reduced-motion 读回：媒体查询生效，动效与过渡时长缩至 `0.00001s`，环境光层不可见。

## 验证边界

本地 Host 没有建立飞书登录态，因此本轮只对新前端壳层、空目录态和响应式布局完成浏览器验收；没有声称完成 Hosted、真实资料、真实 SourceRef 或真实复核执行时序的业务 UAT，也没有发布。

## 仍需 Host 提供的真实字段

- `LibraryCatalogProjection`、责任范围、服务端筛选/分页、负责人和时限。
- 真实 `CurrentObjectIdentityProjection`，包括 Matter ID、编号、标题、revision 和父对象。
- 独立 `EngineeringQuicklookProjection`，包括 `generatedAt`、`dataAsOf`、页码/章节级 SourceRef、资料族与附件数量。
- `TaskCenterProjection` 与匿名系统 Lane 指标。
- `AnalysisProcessProjection`、`AnalysisActivityEvent`、`ActionAttempt` / `ReviewOperation` 审计记录。
- Review turn 的真实 `execution` 状态。Host 完成提交和消费者链路前，前端不启用 `AUTOMATIC`，也不以计时器伪造运行态。

## 未触碰范围

本轮未修改 `shared`、`server`、Host 合同、云文档和聚合入口文件，也未进行 Hosted 发布。
