# 实际接口与身份

## 1. 地址、传输和发现

对外地址为获准 Host origin 与应用 base path，再接下列路径。包内故意不填写实际域名、应用 URL 或任何密钥。所有 MCP/控制队列入口都是 `POST`，请求内容为 JSON；可信消费者使用官方 `StreamableHTTPClientTransport`，Host 复用官方 `createMcpHandler`/`toNodeHandler`，`legacy: 'stateless'`、`responseMode: 'json'`。

| 用途 | 新 Codex 路径 | 历史 Hosted 路径 |
| --- | --- | --- |
| MCP | `/openapi/wiselink/codex-mcp` | `/openapi/wiselink/openclaw-mcp` |
| 领取/恢复精确自动队列项 | `/openapi/wiselink/codex-next-work-item` | `/openapi/wiselink/next-work-item` |
| 已完成队列项 ACK | `/openapi/wiselink/codex-ack-work-item` | `/openapi/wiselink/ack-work-item` |
| Host 已确认失败项 BLOCK | `/openapi/wiselink/codex-block-work-item` | `/openapi/wiselink/block-work-item` |
| 已登记待生效模型配置 | `/openapi/wiselink/codex-apply-pending-model-configuration` | `/openapi/wiselink/apply-pending-model-configuration` |

这些路径已存在于本地 controller 和 [实际 OpenAPI 摘录](rest/openapi.paths.json)。地址“存在于源码”不表示已经部署、授权或可调用。队列控制保留在可信程序的 REST 侧，不暴露为模型业务工具。模型配置入口只处理既有待生效事项，不是自由修改模型的接口。

服务端只按 `WL_MODEL_EXECUTOR` 选择一种活动路线，缺省 `HOSTED`；无效值报 `CANONICAL_EXECUTOR_CONFIG_INVALID`，非活动 endpoint 报 `CANONICAL_EXECUTOR_ENDPOINT_INACTIVE`。调用方不能用 header、appId 或工具参数选择模式。`CODEX` 只读取 `WL_CODEX_*`；不会借用旧 `WL_OPENCLAW_*` 的授权。

| 发现项目 | 新客户端 CODEX 模式必须得到 | 历史 Hosted |
| --- | --- | --- |
| MCP `serverInfo.name` | `wiselink-codex-engineering-assessment` | `wiselink-openclaw-engineering-assessment` |
| MCP `serverInfo.version` | `1.2.0` | `1.2.0` |
| 客户端身份 | `wiselink-codex-assessment-driver@1.0.0` | `wiselink-hosted-review-driver@1.0.0` |
| 发现后动作 | `tools/list`，再运行现有 `validateHostToolMetadata` | 同一 metadata 检查 |
| 不匹配时 | `CODEX_HOST_MCP_BINDING_UNAVAILABLE`，在业务领取前拒绝 | `REVIEW_HOST_MCP_IDENTITY_MISMATCH` |

新客户端原始导入版本已要求新身份；旧 Host 只返回 OpenClaw 身份，二者确实不兼容。本批本地薄接线为固定 Codex endpoint 提供独立身份；它不是把旧在线服务的 metadata 改名，也不代表新运行端的授权已经配置。

完整原始握手在 [Codex initialize](mcp/codex.initialize.response.json) 与 [Hosted initialize](mcp/hosted.initialize.response.json)。全部 45 个工具的输入 schema 在 [tools/list](mcp/codex.tools-list.json)，逐工具独立文件在 `mcp/tools/`。两种服务的工具 schema 当前完全相同；运行模式、身份与授权仍分别校验。

## 2. 身份与授权

MCP 服务名是协议发现身份，不是租户或工程师身份。网关验证 API Key，Host 仍通过已配置的 service principal、运行应用、环境与 tenant scope，解析准确 WorkItem/attempt，再回到原 actor 和当前来源权限。不能由模型自由提供 `tenantId`、`actorUserId`、来源 grant 或 lease owner。

`WL_CODEX_RUNTIME_APP_ID` 是必填的新运行端身份，缺失/格式无效报 `CANONICAL_CODEX_RUNTIME_CONFIG_REQUIRED`。基础 scope 还要求明确启用、`API_KEY` 模式、`DEV|UAT`、合法 `service:` principal 和非空 tenant。自动队列还要求独立启用，静态 WorkItem、文档、Matter、附加目标和后继 Review 各有范围；只配基础字段不自动放开所有工具。

本批独立运行目标为`CODEX / app_17gr74pbere`，应用值由配置读取且拒绝旧运行应用；目标已定不等于配置已认证。首批只承接程序初评，Applicability/Review/待办Review及后继Review Overall和相关attempt入口显式返回`CANONICAL_CODEX_OPERATION_NOT_SUPPORTED`（403）。相应工具仍保留通用schema，不能用metadata存在绕过scope。

首批 Codex 接线进一步固定一个准确 `WL_CODEX_SERVICE_WORK_ITEM_ID` 和原 intake `WL_CODEX_SERVICE_REQUEST_ID`，并强制该请求的活动队列租约。队列只查询该 WI，不扫描租户、文档或 Review；即使旧消费者租约已经过期，也不能接管旧 owner 的租约。附加 scope 名称的同形映射不代表本批验证了所有文档/翻译/Wiki/Review 入口。

CODEX文档交付还要求 `deliveryRef='work-item:<配置WI>'`，并经该WI的活动lease、intake、DV、intent request/actor、artifact/hash/bytes精确核对；无deliveryRef、`acquisition:`或其他WI均拒绝。工具通用schema保留这些历史形状，不代表当前CODEX scope接受它们。

新 Codex 路线保留数据库事务、RLS、逐来源 fresh grant、稳定锁序、精确版本、attempt fencing 和 WorkItem CAS。某个工具出现在 `tools/list` 中不代表任意来源或任意对象可读。

## 3. begin 与两层 claim

自动队列 `next` 请求类型是 `NextAutomaticWorkItemRequest`：可省略 body，或提供 `resumeWorkItemId`、`reviewAfterWorkItemId`、`documentAfterRef`。完整返回联合类型 `AutomaticWorkItemClaimResult` 在 [原始类型声明](types/source-declarations.json)：

- `IDLE`：无本次可运行项；不调用模型。
- `DOCUMENT_PENDING`、`REVIEW_PENDING`、`OVERALL_PENDING`：既有其他消费者入口的精确指针，不能当作程序初评 `CLAIMED`。
- `CLAIMED`：含 `workItemId`、原受理 `requestId`、`documentVersionId`、`workItemRevision`、队列 `leaseToken/generation/expiresAt`。

程序初评随后调用 `begin_dynamic_evaluation`，输入完整 schema 见 [工具文件](mcp/tools/begin_dynamic_evaluation.json)。这里的 `requestId` 来自已授权的 initial-analysis stage/request；**不是** `CLAIMED.requestId` 或 `WL_CODEX_SERVICE_REQUEST_ID` 的 intake key。首条新事项传准确 stage request，不省略后让程序猜最新任务。

| 输入/输出 | 实际语义 |
| --- | --- |
| 输入 `workItemId` | 本次准确事项，Host 重验授权与当前源 |
| 输入 `requestId` | 已登记的评估 stage 请求；与 intake/queue requestId 分开，工具层可选不等于新业务可任意省略 |
| 输出 `attemptRef` | 当前准确操作指针 |
| 输出 `status` | `RUNNING` 或 `COMMITTING` |
| 输出 attempt `leaseToken/generation/expiresAt` | ActionAttempt 的独立租约；不等于队列租约 |
| 输出 `task` | Host 密封 TaskEnvelope；含来源、输入/基础修订、期限、幂等身份、`inputHash`、封存 `executionModel` |
| 输出 `modelInput` | 按该 task schema 交付的模型视图；不是整个 trusted task wrapper |
| 输出 `selectedDiscoveryRefs` | 准确已选发现结果；不证明新的调查已经执行 |
| `COMMITTING.recoveryResult` | 已持久化并经绑定校验的原结果；只重放同一 commit，不再次生成 |

完整 `BeginJobAidProblemResult`、`OpenClawTaskEnvelope`、`OpenClawLeaseClaim` 及 ResultEnvelope 原始类型见 `types/source-declarations.json`；实际合成服务输出见 `examples/`。当前 MCP 不声明输出 JSONSchema，因此不能把示例当成比源码更窄的响应 schema。

队列租约只用于 queue 控制；attempt 租约用于 `read_assessment_sources`、进度、SAVE、准确 READ、heartbeat 和 commit。两者必须分别保留；租约、认证头和 trusted wrapper 不进入模型材料。

## 4. 版本与兼容层

`result.toolVersions` 仍沿既有 wire 合同保存服务协议版本、JobAid 协议/方法版本与执行器标记。新生成器的 `model-executor: 'CODEX'` 是实际执行路线；历史键 `wiselink-openclaw-engineering-assessment: '1.2.0'` 当前仍被候选 validator 使用，它表示复用的旧 wire 协议检查，不能被解释为模型由旧 OpenClaw 运行。Task/Result 的 `openclaw_*_envelope.v1`、`OPENCLAW_DYNAMIC_EVALUATION` 也仍是持久 wire 名称；不可按名字擅改旧请求。

程序初评来源字段还包括 `program-controlled-assessment: '1'`、`jobaid-problem-protocol: '2'|'3'` 和有 TDMS 时的 `tdms-native-context: '1'`。准确值从封存 task 及当前实现取得，不能为了通过 policy 伪造旧 skill/model provenance。独立服务发现版本与这些来源字段不互相替代。

当前Host还核对Result的`model-executor`标记与服务端活动执行路线；不以shared旧app literal或wire命名代替真实运行身份。完整非秘密绑定见 [runtime-identity.json](configuration/runtime-identity.json)。上游94的legacy-source盘点与当前SDK完整45项的差异见 [CLIENT_DELTA.md](CLIENT_DELTA.md)。

新Codex队列REST四条均由未覆盖HttpCode的Nest POST方法返回，正常状态为201；MCP为SDK自行写出的200/202。已用项目实际安装的RouterResponseController核对POST默认值。原Hosted三条队列OpenAPI历史仍标200，与该默认值存在文档差异；包保留原登记并明确此限制，消费者按成功2xx处理，不用旧文档状态推断实际网关回执。
