# R10 前端 B：执行记录与本次材料

分支：`codex/wl31-r10-review-materials-b-20260905`

基于前端 A `c3b7733e1ade9a5453436eda6c4f68e333d26219`，执行字段按主控 Host 提交 `c1bfead9e` 逐项核对。此提交仅含 client、普通前端测试和本交付记录。

## 已实现

- 持续复核读取 Host execution 状态、操作引用、真实时间与失败原因。旧 Host 缺字段、明确 null 和未知状态均不会显示为正在运行。
- 仅 REQUESTED、QUEUED、RUNNING、RETRY_SCHEDULED、COMMITTING 触发四秒只读刷新。检查讨论中的全部回合，避免新保存回合覆盖旧回合的运行状态。失败读取后停止自动刷新，可显式重新读取。
- SUCCEEDED 与候选已读回分开；已有候选不会因执行状态刷新而清空。当前执行中的补充明确为下一轮输入。
- 同一复核页面内提供按需展开的“本次材料”：主文件、工程师输入、附件引用、正文关联线索和候选 SourceRef。展开前不请求关联线索。
- 复用 Host snapshot 的目标分组，合并同一目标的多处引用，保留每一处可定位来源；打开关联文件同时要求明确授权、精确匹配与一致目标版本。
- 精确去重附件引用和候选 SourceRef，并保留每个回合及输入版本。SourceRef 数不当作独立文档数。
- 临时读取失败保留已读回内容与未提交草稿；权限失效清除讨论与材料。材料展开及小屏下输入器回到正常文档流，避免 sticky 输入器覆盖材料。

## 验证

- 定向 Jest：4 suites / 36 tests 通过，覆盖活动/终止状态、旧 Host、未知状态、历史回合仍运行、执行成功但候选未返回、来源聚合、授权边界与权限失效。
- 客户端类型检查、stylelint 与生产构建通过；提交执行项目既有 pre-commit。
- 实际生产组件的本地样例交互：延迟关联读取、两处引用聚合及 P10 定位、保存下一轮输入、请求中不带 executionMode、503 保留内容/草稿并停止轮询、403 清除记录、成功后停止轮询均验证通过。
- 本地 1440×900 / 390×844 验证；390 材料区域宽度与 scrollWidth 同为 334px，修复后输入器 position 为 relative。

以上浏览器证明仅适用于明确标注的本地样例，未使用真实 Hosted 业务数据。主控负责线上发布和端到端验证。

## 现有数据的使用范围

| 来源 | 可以显示 | 尚不能据此声称 |
| --- | --- | --- |
| WorkItem 主文件身份 | 当前绑定文档与来源版本、打开 Reader | 本轮已经读取全文、发布源最新版 |
| ReviewTurn engineerSuppliedInput | 已保存文字与所属回合 | 被当前候选使用或已正式采用 |
| ReviewTurn attachmentRefs | 已保存的附件引用、所属回合 | 文件名、解析结果、实际读取、可定位正文 |
| explicit-preview / snapshot | 发现的线索、授权及精确目标、主文件引用位置 | 已选入评估、目标正文已读、角色接受等于采用 |
| assistantCandidate.sourceRefs | 候选实际引用的来源 ID 与回合/版本 | 整份文件已读、独立材料数量、正式采用 |

## 后续最小缺口

自动发送需要主控在既有 ReviewConversationReadModel 提供 `automaticExecutionAvailable?: boolean`，由 Host 按当前用户与对象支持范围派生。B 批尚未附带 `executionMode`；后续接线保持独立提交。

材料仍缺附件名称/DocumentVersion/正文 SourceRef 对应关系，以及逐材料的选入、读取和采用回执。本轮仅清晰显示缺项，没有新增投影框架、状态机、共享合同或业务表。
