# Aily 原生对话补充写入：最小接入方案

状态：接入设计，尚未启用平台 JWT、读取或保存密钥、增加 MCP 工具、发布配置。默认汇集修复已由 `6580193d3`、`a70c007e7` 提交；本方案是其后续输入通路，不能表述为原生 Aily 消息已经自动同步。

目标是让指定 WiseLink Agent 把讨论产生的补充保存到当前用户、当前事项的待用贡献中。随后由用户明确点击“更新评估”，走现有请求快照、来源读取与工作版本保存流程。该工具不发起评估，不执行正式采用。

## 官方依据与尚待核实的信息

官方[新版 MCP 使用](https://aily.feishu.cn/hc/1u7kleqg/73ahi33a)说明：自定义 MCP 开启 JWT 身份令牌后，每次请求携带 `x-aily-jwt`；平台提供 `identityJWTSecret`，算法为 HS256，密钥按原字符串使用，服务端验证签名与 `exp`；有效期 24 小时。载荷包含用户、租户和 Agent 标识。平台文档同时要求不记录 JWT 原文与密钥。

**ID 类型仍有明确歧义**：同一文档把 `user_id` 称作 open ID，但类型及例子是超过 JavaScript 安全整数范围的数字；`tenant_id` 也是数字。现有 Host 映射依赖 `feishuOpenId + feishuTenantKey + expectedClientId`，不是任意数字 ID。需要官方说明确认这两个字段的命名空间、应用作用域及与现有映射字段的对应关系，再通过已验证身份做一次精确核对。不能按外观猜测、借邮箱匹配，或把数字 `tenant_id` 当作 `tenant_key`。

官方[三方系统工作身份](https://aily.feishu.cn/hc/1u7kleqg/gnrssu2a)另有对话用户授权和 OAuth2Code 连接方式，但没有证据表明它会向自定义 MCP 转发用户访问令牌。本方案不依赖这种推断。

## 最小代码范围

1. **独立 Agent 入口与验签器。** 新建仅服务此工具的 MCP 路由，保留现有 `/openapi/wiselink/mcp` 的只读语义。拒绝缺失、重复或畸形 JWT；限定 HS256，用平台密钥验证原始签名输入；验证有效期、预期 Agent 与预期租户。先验签，再无损解析身份数字；ID 全程使用字符串。`exp` 单独按合法时间戳校验。不臆造官方未规定的 `aud/iss/scope` 字段，也不接受客户端提供的 actor、角色、cookie 或服务身份作为替代。

2. **可信映射与对象 ACL。** 验签结果仅证明调用者身份，不赋予事项权限。ID 命名空间官方确证后，复用 Host 当前、有效、租户及应用受限的 canonical subject 映射；缺失或歧义直接拒绝。现有 `CanonicalAilyFinalUserActorContext` 和 hosted object-access adapter 有旧的签名身份分支，但其 `AuthNPaas user_id` 假设不能直接当作本次证明，须按已确证合同调整并测试。保持 `sessionId/sessionRevision=null`，不创建 `wl_session`、不伪装 OAuth provenance。每次工具调用重新执行当前事项写权限校验，并在事务内核对事项及文档版本。

3. **目标绑定。** 工具必须收到 Host 可解析的当前事项绑定和明确文档版本。绑定来自已授权 Host 上下文或 Host 签发的目标引用，不能从同名资料猜测，也不能把标签文案当主键。目标引用仅用于定位，每次仍须核对调用者 ACL。当前仅传资料名称、版本、类型的 SDK 参数本身不构成唯一事项绑定；具体新增绑定参数由主控随配置变更审阅。

4. **仅保存候选贡献。** 建议工具名 `save_candidate_contribution`。最小输入为 `requestId`、目标绑定、预期文档版本、补充内容及性质（补充/假设/纠正），可附来源说明。复用 `dialogue_thread/message` 与 `discussion_contribution` 存储和事务、主键、修订及幂等约束，不另建状态机。服务端需增加清晰的 Agent 来源类型，必要时同步现有 origin 校验约束；不得把 Agent 传入文本写成 `HOST_USER_INPUT` 或“用户已验证原话”。

5. **来源可回溯。** 原样保存 Agent 传入正文、性质、目标版本、已验证 Agent/调用者标识和接收时间，界面统一称“Agent 传入补充”。Agent 声称的用户原话、消息 ID 或来源 URL仅作来源声明；只有独立核验的原始消息 receipt 才可标为已验证原话。模型候选、假设、纠正和摘录在后继 sourceCatalog 中保持原性质。JWT 与密钥不进入业务记录或日志。

6. **接入默认汇集。** 保存成功仅返回贡献引用、修订、当前目标和待用状态。贡献随后进入 `ALL_PENDING` 快照；原文经已有 `read_source_refs` 分批读取。请求关联、实际读取、工作版本使用分别留痕。不得在工具保存成功时声称工作判断已更新。

## 本地验证与上线前核对

本地采用生成的测试密钥和合成 token：有效签名、错误签名、`none`/其他算法、过期、缺失字段、错误 Agent/租户、重复 Header、畸形 token、19 位整数精确保留。身份映射需覆盖未知用户、失效映射和跨租户；业务层覆盖对象不可写、文档换版、目标不匹配、重复请求精确回放以及相同 requestId 不同正文冲突。端到端本地用已验证测试 actor 保存贡献，读回来源与修订，再验证集合快照/分批读取；不使用真实 JWT 或业务事实作为测试夹具。

主控协调的实际变更应先列出以下清单并审阅：

| 变更 | 影响与核对 |
| --- | --- |
| 指定 Agent 新增专用 MCP 连接/工具 | 可见范围限定到目标 Agent；只开放候选贡献保存 |
| 开启平台 JWT 身份令牌 | 获取平台生成密钥；确认真实请求 Header 与 ID 合同一致 |
| Host 安全配置密钥、预期 Agent/租户 | 密钥仅服务端保存，不回显，不写日志；未配置时明确不可用 |
| Host 技术发布与真实小范围验证 | 同一用户、同一事项、明确版本保存一条已授权补充，读回并撤销测试贡献；不自动评估或正式采用 |

当前仍需补齐：官方 ID 命名空间说明、真实请求精确映射证据、可审阅的上述配置值和目标绑定方案。这些条件只限制原生写入启用，不阻断已完成的 Host 默认汇集改动。

## 原生会话 API 的只读实测补充

2026-09-10 使用已有 CLI 用户授权，对指定 Agent 成功执行以下原生接口。未增加 scope、读取密钥、发送消息或修改 Agent 配置。此结果仅证明该 CLI 调用身份可读，不代表 Host OAuth 应用已经获得相同授权。

| 官方原生路径（统一前缀 `/open-apis/aily/v1`） | 实际返回字段 |
| --- | --- |
| `GET /agents/{agent_id}/sessions` | `sessions`、`has_more`、`next_page_token`；会话项为 `created_at`、`last_chat_at`、`name`、`session_id`、`status` |
| `GET /agents/{agent_id}/sessions/{session_id}` | 上述会话字段及 `turns`；轮次项为 `agent_chat_id`、`created_at`、`status` |
| `GET /agents/{agent_id}/chats/{agent_chat_id}` | `content[{type,text}]`、`status`，即 Agent 回复 |

[官方获取对话结果文档](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/aily-v1/agent-agent_chat/get.md)规定读取权限为 `aily:agent_chat:read`，实际路径是 `/chats/{agent_chat_id}`；帮助概览中的 `/agent_chats` 不能代替详细接口合同。[原生 OpenAPI 概览](https://aily.feishu.cn/hc/1u7kleqg/t973w36g)列出上述会话列表和详情能力。这里没有调用旧工作流的 `aily_session` 接口。

实测结构没有返回用户原始输入、SDK `customParams` 或 Host 任务绑定。已存在的 Host 请求可以用其持久化引用精确关联；没有 Host 记录的原生会话，不能靠名称、时间或同名资料推断归属。因此，读取 Agent 答复尚不能完成 SDK 用户原话的自动保存，当前缺口是内容与关联合同，不是把成功读取误报为缺权限。

安全恢复条件是：取得官方支持的用户原始消息读取合同及可信 Host 目标关联方式，并在当前用户权限内验证二者；或者在前述 JWT 命名空间确证后启用独立候选贡献入口，明确保留“Agent 传入补充”的来源性质。仅增加读取 scope 不能补出接口未返回的字段。正式业务更新仍需当前事项的真实补充、纠正或待核实问题，以及相应材料；旧测试假设不能改写成新事实，也不能用安装或单测替代两轮业务验收。
