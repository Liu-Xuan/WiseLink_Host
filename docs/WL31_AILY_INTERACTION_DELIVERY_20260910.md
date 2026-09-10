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
6. W4 `dialogue-excerpt-selection.ts` 提供来源提示白名单和严格原文选段函数，交 W1 消费者接入。来源提示不接受自报 actor、open_id 或 VERIFIED_EVENT；选段用已保存原文的 UTF-16 坐标，拒绝越界、空段及切断 Unicode 代理对，不以客户端自报引文覆盖原文。

新增数据库需求由主控统一迁移：`message_ref uuid`、`remote_session_id varchar(96)`；`attempt_ref` 可空但与 `message_ref` 恰有一个；每 message 唯一 query；相同租户/用户/Agent/远端 session 的 STARTING/RUNNING/UNKNOWN 唯一占用。旧 attempt 外键、唯一约束、actor/RLS 保留。

W1 必须保留首次组装的上下文及 query 用于同消息重放；新工作版本、新纠正通过新消息进入，不能重写已经生成的输入。

## 能力证据与当前限制

| 项目 | 本轮证据 | 可交付边界 |
| --- | --- | --- |
| 创建对话/session 参数 | 官方 SDK 固定提交定义＋本地传输测试 | 可实现 API 接续，尚非本轮真实两轮实测 |
| GET 同轮结果 | 官方 GET 正文及两条既有测试对话只读回查；实际成功状态为 `Completed`、finish_reason 缺省 | CLI 当前用户可读；Host write-only OAuth 不据此启用 GET，其他终态不猜测 |
| 原生可信身份 | 当前 `canonical-host-mcp.openapi.controller.ts` 仍要求官方 service-scope，默认 unavailable；拒绝自报 header/body 身份的现有测试通过 | 不启用原生对象工具，不将模型填的用户 ID 当授权 |
| 原生回流/编辑/撤回 | 本轮未取得目标实例事件证据 | 采用登录后的 `FEISHU_EXCERPT` 明确摘录；不宣称完整同步 |
| 多人/记忆撤权 | 本轮没有两用户实例实验 | 私人默认；不得以新 session 或删引用宣称脱敏、清除长期记忆 |

本轮已通过 `lark-cli apps +db-execute --as user` 对 `app_17bzc551rsg` online 做一次只读聚合：`review_aily_query` 的 query、remote chat、COMPLETED、UNKNOWN 数均为 0。没有读取正文、token 或私人历史。由此只能确认当前尚无 Host 持久 query 可做恢复验收，不能将历史 CLI SSE 成功当成产品闭环证据。

官方来源：[固定版本 SDK](https://github.com/larksuite/node-sdk/blob/af41737d1e9d0fdb08bdbbbe3019a7c64b3d9513/code-gen/projects/aily.ts)、[GET 文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/aily-v1/agent-agent_chat/get.md)。官方接口存在不代表本租户已授权。

## 验证与尚未完成的流程

传输、流解析、消息登记服务初批三组 40 项测试通过；随后 GET 有界读取、远端 session 错配补 2 项，传输组 12 项通过。W4 来源/选段 16 项通过；服务端 TypeScript 检查、定向 lint 通过。现有原生身份拒绝测试另 3 项通过。这些是隔离本地验证，不是数据库迁移、发布或真实业务验收。

待主控集成验证：W1 HTTP→消息→直接 Aily→本地回答读取；无对象和跨对象归集；纠正后明确重评及下一轮读取新工作版。W4 要核对选段是否来自已保存公开文本、相同提交幂等、相同文字不同提交不合并，以及用户摘录不能伪造 VERIFIED_EVENT。真实 read 权限、E1 多轮/中断回查与 E3 两用户身份验证由主控统一安排。

当前不报告已完成完整用户闭环；goal 保持活动直至负责范围的开发和验证交付。

## 跨层交互复核增量

主控已集成首两批实现（主线 `5cfc6da66`、`8de0c162c`），并接入 W1 的消息/贡献消费者。新增 `dialogue-service-interaction.spec.ts`、`dialogue-context-interaction.spec.ts` 对该实际实现作隔离回归，共 19 项通过。

复核发现并由主控修复：长历史超 60000 字符的输入上限；回答继承的对象权限在早期消息退出分页后丢失；页面没有结算进程中断遗留的 RUNNING；飞书摘录省略 purpose 时会重新生成；孤立确认缺少上一问。修复后实际上下文保存 `contextWorkItemIds` 并复核继承权限，按总预算保留完整历史轮次并记录省略，摘录默认为 CONTRIBUTION_ONLY，读回结算 UNKNOWN，贡献携带必要原问答。

恢复入口回归覆盖：仅补首次 query 尚未创建的投递，沿用首次保存的 generationQuery；已经有 UNKNOWN、FAILED 或 COMPLETED query 时不再 POST；摘录消息不能通过恢复入口变成生成请求。同请求原话改变则拒绝，当前工作版和历史回答版本分别保留。另将直接聊天来源标为 AILY_DIALOGUE，旧检索保持 AILY_RETRIEVAL；GET helper 保留原始 finish_reason，不自行提升为成功。

以上是代码消费者与 mock 外部依赖的验证，未称页面或生产回合已成功。迁移、最小 W6 页面及真实非敏感实例验收由主控联合推进，read scope 与远端状态映射仍待正常授权和实测。

## E1 同轮读取与传输错误增量

使用既有 CLI 用户身份，只读 GET `agent_4km47c77ujwqphg` 的已记录测试 chat：`7683562995163712778` 返回 Completed、3401 字符公开文本；`7683720367274019812`（此前 SSE 连通测试）返回 Completed、7 字符。未创建新对话、未新增权限、未读取其它会话。第二条成功 payload 离线交给编译后的 `readAilyChatResult`，精确解析为“连接测试成功。”。离线解析没有网络调用，真实网络操作仅两次 GET。

该证据证明当前 agent API 可读取同一 SSE chat、Completed 是真实 GET 成功状态；不证明 Host 登录授权已有 read，不证明新的两轮 session、在途断流恢复或长期记忆撤权。CLI 返回成功 payload 已解包，离线校验使用显式成功 envelope，不声称保存了未经处理的原始 HTTP wire。

官方创建接口规定非零 code 为失败。流式请求若收到 HTTP 200 的 JSON 拒绝，现保存 `AILY_API_REJECTED_<code>` 并记 FAILED，避免误报为断流未知。若收到有效异步 chat/session 回执，则先保存远端 ID、保留 UNKNOWN，不能假报收到完整回答或再 POST。新增 3 项对应测试通过，服务/传输两组共 35 项通过。

主控已复制上述 19 项跨层测试，并修复仓库返回类型推断问题；canonical 服务端 TypeScript 检查现已通过。W6 只读复核另发现后台刷新锁草稿、已加载旧页的权限复核、纠正缺少替代旧贡献的入口及 UNKNOWN 文案问题，已交前端 owner 修订，尚未以代码阅读代替页面验收。
