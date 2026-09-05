# R10 前端：按 Host 支持范围发送自动复核请求

依赖主控 Host 提交 `f776e52d9` 的 `ReviewConversationReadModel.automaticExecutionAvailable?: boolean`，以及前端 B `9d29e86fcb7c2bbba16e5257cfeb6c52a52cc90a` 的 execution 展示与只读轮询。

- 当前讨论处于 ACTIVE 且 Host 明确返回 true 时，新输入携带 `executionMode: 'AUTOMATIC'`，按钮显示“发送并分析”。
- false、字段缺失或非布尔值保持普通保存，明确提示当前对象未开放自动分析。未硬编码任何 tenant 或 WorkItem。
- 运行中补充显示“下一轮指示”，明确下一轮才处理，不声称改变当前执行。
- 新请求在第一次提交时固定 requestId 和执行模式；丢失响应后的重试保持二者原样。可用范围变化不能将原普通保存自动升级为执行。
- 历史回合不重放；仅用户点击新输入发送按钮时提交。候选、正式采用和确认动作继续独立。
- 服务端拒绝范围外的自动请求时显示明确原因并保留输入，不显示为已保存或已入队。

本提交仅包含客户端接线、普通定向测试及本记录。客户端类型检查、相关 Jest、生产构建和项目 pre-commit 用于验证代码；主控负责发布并用真实 Hosted 页面完成自助连续分析验证。
