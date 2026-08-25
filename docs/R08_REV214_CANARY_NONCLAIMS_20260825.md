# R08 rev214 canary 事实与非断言（canary non-claims）

状态：`CANDIDATE_ONLY`。本文档只登记 G0 身份语义所依赖的 canary 观测事实，
并显式声明**不据此断言**的内容。按保密要求，不记录任何具体数值身份、
token、session/message/run ID。

## Canary 事实（R08 rev214 观测）

1. `spring_6bc16cad05__c` 当前**缺少** Host 侧 `whoami`、`list_my_workitems`、
   `get_attempt_status` 能力。因此 cannot 用 spring 侧探测来证明或否定
   Host final-user identity；Host 身份语义只能在 Host 边（本仓库代码）验证。
2. 一次性的 Aily OpenAPI run 已完成，但**未能枚举** Host 工具清单。
   该 run 不构成 Host 工具面或身份面的证据，也不证明 agent -> spring app 映射。
3. 该 run 观测到的 sender 是 Aily 内部身份，**不是** 飞书 user_id / open_id。
   因此 Aily OpenAPI session sender 不能作为 final-user 身份来源；
   `X-Aily-BizUserID`、bot/application 身份同理，均被拒绝。
4. Miaoda 侧 `require_login` / scope 通过**不是** Host ACL 证明。require_login
   只约束 Miaoda 入口登录，与 Host WorkItem owner 关系（fresh-read
   `HOST_WORK_ITEM_REQUESTED_BY`）属不同层，不能互相替代。

## 非断言（non-claims）

- **不**断言 agent -> spring app 映射已被证明。`agent_4km47c77ujwqphg`
  仅作为 entrance/provenance 保留，绝不进入 Actor 或 ACL 输入。
- **不**吸收 legacy attachment/session 实现；`READ_ATTACHMENT` /
  `ISSUE_ATTACHMENT_INTAKE` / `COMMIT_ATTACHMENT_INTAKE` 维持 fail-closed。
- **不**把上述 canary 观测当作 G0 已验证证据；真实 signed JWT 上的
  Host/MCP transport 端到端验证仍缺（见下方外部 blocker）。

## G0 身份语义（已在 Host 边实现并单测覆盖）

- 唯一的 final-user Actor 来源：Host 验证 native signed `x-aily-jwt`
  （HS256）后，取其 `user_id` + `tenant_id`，经官方 `AuthNPaasService`
  将 Feishu user_id 映射为 Miaoda userId。
- 签名缺失、过期、claims 非法、agent 非允许入口（含已废弃的旧 entrance）、
  open_id 自报、映射无结果：全部 fail-closed（401/503），且在任何 ID 转换或
  repository I/O 之前拒绝。
- 每次受保护读取前 fresh-read Host owner；owner 缺失或冲突即 404。

## 外部 blocker（如实登记）

本地无真实 signed `x-aily-jwt`（需要 hosted secret
`WL_AILY_IDENTITY_JWT_SECRET` 与真实 Aily 入口签发），也无已授权 DEV route。
因此 G0 端到端身份证明未完成；本地验证仅覆盖：

- 单元级正/负语义（签名、claims、映射、owner fresh-read、fail-closed）；
- 本地真实 MCP transport 上的身份边（脚本
  `scripts/verify-aily-identity-mcp.mjs`：无 token/坏 token 被拒；hosted
  secret 存在时签名 token 才放行）。

**绝不**以伪造 JWT 冒充 G0 证明。
