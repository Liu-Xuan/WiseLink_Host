# Aily 交互支线开发与验收记录

日期：2026-09-10。基线 `eaa12070e`；设计依据为用户提供的同日《WiseLink Aily 持续对话与工程评估协作完整方案》及《开发工作与能力验收计划》。附件里的执行示例是设计资料，不额外授权生产变更或读取私人历史。

## 分工与真实消费者

- 交互支线 `01a0897d-9072-78f3-8318-78113cdca692`：W2 Aily 传输、消息调用、同轮恢复及交互测试；W4 渠道能力核验与受控摘录复核。
- 主控 `01a079d1-918d-7af1-a283-75968ec294ea`：W1/W3/W5、共享类型、数据库迁移、HTTP 消费者、集成与发布。迁移 0030 为统一入口。
- 前端 `01a06014-5282-7f90-91bf-12759224d211`：页面归属保持该会话；本支线不覆盖当前视觉改动。

基线实际链路为 `canonical-host-openclaw-review.service.ts` → `ReviewAilyService.start/result` → Aily SSE；query 受 `ActionAttempt` 外键约束。新 `startMessage` 直接绑定 `dialogue_message`，不创建分析 attempt。迁移及 W1 消费者完成之前，不能将传输拆分描述成已上线直接聊天。

## 本地代码实现

1. `aily-chat-client.ts` 从原服务抽出，原消费者已接回。流式传输支持 Host 绑定的远端 session，早期公开进度包含平台返回的 chat/session ID。只保留公开正文，远端诊断、推理及工具载荷不进入结果。
2. `startMessage(actor,{messageRef,requestKey,query,remoteSessionId?})` 先验证已保存消息的 owner、tenant、`CHAT/AILY` 和请求身份，再登记唯一 query，事务外发送。重复/UNKNOWN 回放不重新 POST，另一条消息占用远端 session 时明确拒绝。
3. 远端 session 复用仅接受相同用户/租户/当前登录、相同 dialogue thread 的已完成 query 绑定。Host 登录 session UUID 与 Aily 远端 session 分列；换 session 不宣称清除了平台长期记忆。
4. `resultMessage(actor,messageRef,queryRef)` 只读本地授权记录。OAuth 到期不删除本人已保存正文；新远端生成仍须当前有效授权。进程丢失超过现行流式窗口后保留正文并记 UNKNOWN，不重生成。
5. 明确 HTTP 参数/权限拒绝记 FAILED；连接或生成状态不明继续记 UNKNOWN。GET helper 只读取同一个远端 chat 的快照，保留原始状态字符串，不猜测成功终态。尚未启用 GET 恢复调度或扩大 OAuth scope。

新增数据库需求由主控统一迁移：`message_ref uuid`、`remote_session_id varchar(96)`；`attempt_ref` 可空但与 `message_ref` 恰有一个；每 message 唯一 query；相同租户/用户/Agent/远端 session 的 STARTING/RUNNING/UNKNOWN 唯一占用。旧 attempt 外键、唯一约束、actor/RLS 保留。

W1 必须保留首次组装的上下文及 query 用于同消息重放；新工作版本、新纠正通过新消息进入，不能重写已经生成的输入。

## 能力证据与当前限制

| 项目 | 本轮证据 | 可交付边界 |
| --- | --- | --- |
| 创建对话/session 参数 | 官方 SDK 固定提交定义＋本地传输测试 | 可实现 API 接续，尚非本轮真实两轮实测 |
| GET 同轮结果 | 官方 GET 正文已读取；需要 `aily:agent_chat:read`，响应为 `data.content/status/finish_reason` | helper 可测；当前 write-only 授权下不自动调用，不映射未经实例证实的终态 |
| 原生可信身份 | 当前 `canonical-host-mcp.openapi.controller.ts` 仍要求官方 service-scope，默认 unavailable；拒绝自报 header/body 身份的现有测试通过 | 不启用原生对象工具，不将模型填的用户 ID 当授权 |
| 原生回流/编辑/撤回 | 本轮未取得目标实例事件证据 | 采用登录后的 `FEISHU_EXCERPT` 明确摘录；不宣称完整同步 |
| 多人/记忆撤权 | 本轮没有两用户实例实验 | 私人默认；不得以新 session 或删引用宣称脱敏、清除长期记忆 |

官方来源：[固定版本 SDK](https://github.com/larksuite/node-sdk/blob/af41737d1e9d0fdb08bdbbbe3019a7c64b3d9513/code-gen/projects/aily.ts)、[GET 文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/aily-v1/agent-agent_chat/get.md)。官方接口存在不代表本租户已授权。

## 验证与尚未完成的流程

传输、流解析、消息登记服务三组 40 项测试通过；服务端 TypeScript 检查通过。现有原生身份拒绝测试另 3 项通过。这些是隔离本地验证，不是数据库迁移、发布或真实业务验收。

待主控集成验证：W1 HTTP→消息→直接 Aily→本地回答读取；无对象和跨对象归集；纠正后明确重评及下一轮读取新工作版。W4 要核对选段是否来自已保存公开文本、相同提交幂等、相同文字不同提交不合并，以及用户摘录不能伪造 VERIFIED_EVENT。真实 read 权限、E1 多轮/中断回查与 E3 两用户身份验证由主控统一安排。

当前不报告已完成完整用户闭环；goal 保持活动直至负责范围的开发和验证交付。
