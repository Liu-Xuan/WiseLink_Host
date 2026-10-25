# Codex ↔ Host 接口契约（源码可证范围）

本文保留上游 `94c54de` 交付时的 legacy 固定源码观察，`PINNED_LEGACY_SOURCE_ONLY` 机器材料不代表当前Host接线。唯一当前接口包为 [host-codex-interface-20261025/README.md](host-codex-interface-20261025/README.md)，含真实SDK完整45工具schema、当前路由/身份、42项对照及恢复边界。当前集成检查使用 `node openclaw/codex-evaluator/check-host-contract.mjs --current-interface`；不把下文旧来源hash改写成当前运行证明。

日期：2026-10-25。此文给接线者一份可核对的客户端预期、固定 Host 源码事实和未验证项。实现基线为 `1155c386`，接线记录基线为 `fc132291`。机器文件为 `openclaw/codex-evaluator/contracts/host-source-interface.json`；`export-host-contract.mjs` 从 MCP service、readonly tools、controller、derived tools、matter tools 和 `shared/api.interface.ts` 六份固定源文件重新导出，不连接业务 Host。`host-input-examples.json` 的 35 个转换 schema 入参可执行 `node openclaw/codex-evaluator/check-host-contract.mjs` 离线核对；它只证明输入形状和本地文件新鲜度，不证明 Host 授权、业务正文有效或运行成功。示例是合成身份与字段投影，不能当成真实 SAVE/READ 回执。

完整、可重新生成的请求响应样例为 [`program-recovery-example.json`](../../openclaw/codex-evaluator/contracts/program-recovery-example.json)，包含实际离线消费者产生的材料、完整生成响应、SAVE 和独立 READ，以及合成的 claim、begin、冻结 result、Overall 与 ACK。配置状态见 [`runtime-configuration-status.json`](../../openclaw/codex-evaluator/contracts/runtime-configuration-status.json)；恢复语义、三类回执与测试结果见 [`RECOVERY_VALIDATION.md`](../../openclaw/codex-evaluator/RECOVERY_VALIDATION.md)。本批没有真实模型调用或真实 Host 调用。

## 证据与状态

| 来源 | 固定版本及 Git blob SHA-1 | 证明内容 |
| --- | --- | --- |
| `server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts` | `fc1322919b1b52433c33086c8db4aeb957f0e982` / `7607bcc337b186b598434c8c5e725ab72db2ceb1` | legacy MCP 身份、工具输入 Zod 定义 |
| `server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts` | 同提交 / `34c4806ce1cb838cace32f917cd7f9678cff8f30` | `get_parse_status`、`get_deep_link` 输入 |
| `server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller.ts` | 同提交 / `d10d756a4a37199710656c1fad7b5edf8bb1715e` | legacy MCP 与队列 REST 路径 |
| `shared/api.interface.ts` | 同提交 / `0cf94ee8bf309808add2d4fe31b1a73dfb12a110` | 队列请求与回执 TypeScript 类型 |
| `server/modules/canonical-host/derived-summary-attempt-mcp-tools.ts`、`matter-attempt-mcp-tools.ts` | 同提交 / `9b223ec11be5b4f95110b8837b4dfe52ca7bd340`、`2d0bf252c26418cdb4d0b202a63aab2aa1b1f69a` | Wiki/事项消费者的独立 Zod 定义，本地可解析 union 已转换，外部依赖保留原表达式 |
| `server/modules/canonical-host/canonical-host-vertical.service.ts` | 同提交 / `7d8886fb37b4863683896c5848d24b9a26b111e4` | `get_parse_status` 实际返回 wrapper |
| `server/modules/canonical-host/canonical-jobaid-problem.service.ts`、`jobaid-problem-work.ts` | 同提交 / `0b80b1c043f705b961d13ff69259619041eb0c15`、`7b7aa6b1089cdb17e8adea0117e714a2431d8cb2` | SAVE、独立 READ 和工作材料化变换 |
| 本工作区 `run-hosted-review-turn.mjs`、`orchestrate-host-mcp.mjs`、`run-program-assessment.mjs`、`validate-payload.mjs`、`consume-hosted-work-item.mjs` | 修改前 94 文件逐一匹配 `fc132291…`；本批变更的准确源码哈希见离线验证记录，client 哈希也在机器契约中 | 消费端路径、绑定、保存/读回、程序综合、正常收尾 |

Host 的 `codex/executor-transition-host-20261025` / `1eb9bcc8` 是用户报告的 Host 接线分支；当前无法从公开 GitHub 取到并核对（ref/commit 返回 404/422）。本文件不把 legacy 源码冒充该分支实现，不声称线上 `initialize`、`tools/list`、认证或业务调用成功。`host-source-interface.json` 的 `serverSource` 是固定 legacy 源码事实，`client` 是 Codex 消费端要求。

## 发现、身份与授权

消费端在 `modelExecutor=CODEX` 时构造 MCP client `wiselink-codex-assessment-driver@1.0.0`，连接配置的 `/openapi/wiselink/codex-mcp`，先核对服务器 `wiselink-codex-engineering-assessment@1.2.0`，再读取 `tools/list` 并校验工具元数据；身份不符直接报 `CODEX_HOST_MCP_BINDING_UNAVAILABLE`，不得领取队列。固定 Host 源码只注册 `/openapi/wiselink/openclaw-mcp`，其服务器身份为 `wiselink-openclaw-engineering-assessment@1.2.0`。这是精确未闭合的接线差异。`probe-host-mcp.mjs` 只探测 legacy 元数据，结果明确 `runtimeIdentityIndependentlyBound:false`，不是 Codex 授权证明。

本批消费端的 Codex 路径在 SDK/网络动作之前要求 HTTPS、无 URL 用户名/密码/query/hash、准确以 `/openapi/wiselink/codex-mcp` 结尾；运行配置只匹配命名为 `wiselink-codex-engineering-assessment` 的 MCP 项（或其 `name` 精确值），不回退旧配置键。现有显式环境路由 `WL_REVIEW_HOST_MCP_URL` / `WL_REVIEW_HOST_MCP_HEADERS_JSON` 仍须符合相同 Codex endpoint 校验。上述是**客户端预期**，不是固定 Host 服务器已有的新 endpoint。

队列是独立 REST POST：`/openapi/wiselink/next-work-item`、`ack-work-item`、`block-work-item`；不是 MCP tools。客户端从 MCP URL 派生它们，Host 的 controller 各自检查队列 transport。Host 保有租户、actor、来源、版本、lease、事务/CAS 与正式采用权。身份、令牌和服务端授权不可由 Codex 模型生成；认证头只能在私有运行配置中提供，此契约不保存值。

接线配置/状态可公开显示的字段：`modelExecutor=CODEX`、MCP endpoint 的 origin/path、所选任务或任务种类、预期和实得服务器 name/version、工具名清单、配置是否存在、`hostAuthenticationVerified`、`hostRuntimeRegistrationVerified`、`businessToolsCalled`、`queueAccessed`。不得把“配置存在”写成“认证成功”，也不得输出授权头、leaseToken、完整业务正文。当前源码预检的 `readyForBusinessExecution:false` 是配置盘点结果，不是现场失败回执。

## 工具与模式

机器文件列全客户端要求的 41 个工具，并补充 `record_assessment_program_progress`，共 42 项。其中 35 项 `inputSchema` 已由固定 Zod 源码机械转换为 JSON Schema，包括本地可解析的 `matter_action_attempt` discriminated union 与层级 Wiki 别名；每项标记 `MECHANICAL_ZOD_INPUT_SHAPE` 和语义限制。JSON Schema 表达输入结构，不声称包含 Zod trim 变换、完整业务验证或授权规则。

以下 7 项保留准确 Zod 表达式和未解析依赖，不提供放宽后的近似 schema：`read_assessment_sources`、`commit_translation_candidate`、`translation_workspace`、`document_work`、`document_reading`、`document_translation`、`derived_summary_attempt`。`otherUnexportedClientToolNames` 已为空。因此本文件**不是所有消费者均已具完整 JSON Schema 的兼容性证明**；实际上线清单仍需经 Codex endpoint `initialize`/`tools/list` 取得并比对。`query_assessment_knowledge` 是**补充知识检索**，不是查询原 SAVE/request 终态的控制工具；固定源码没有独立的 `query_save_status` 工具。保存响应不确定时，以原 `requestId` 调 `read_assessment_work` 作幂等核对，不新造请求。

普通新任务顺序为：队列准确 claim → `get_parse_status` → `begin_dynamic_evaluation`（准确 workItemId；可带当前初评阶段的 continuation requestId，此值来自准确 stage 状态，不能拿队列 claim.requestId 代替）→ 绑定 attempt/lease → 材料读 → 一次程序生成及完整响应先行持久化 → 原 SAVE requestId 的保存 → 独立 READ → `commit_dynamic_evaluation_candidate` → 状态/深链只读核验 → `ack-work-item`。只有已确认终止且符合原控制绑定时才走 `block-work-item`。程序模式 `PROGRAM_CONTROLLED_V1` 的确定性 Overall 投影由 dynamic commit 在 Host 内完成，回执须同一 `workRevisionRef`、`sourceAssessment.saveRequestId`、`sourceAssessment.readObservedAt`、`executionKind=DETERMINISTIC_PROJECTION`、`modelRequests=0`；**不**为该初评另发 `begin_overall_synthesis` 或第二篇模型报告。后续独立 Overall 才按自身请求走 `begin_overall_synthesis` / `commit_overall_candidate`。

`get_parse_status` 的实际 Host `openApiStatus` 输出是 `{entry,packageSummary,assessmentSummary,integratedAssessmentSummary,configurationEvidenceReevaluation,initialAnalysis?}`。工作与综合投影位于 `integratedAssessmentSummary.status/baseRules/overallSynthesis`，不是顶层 commit 回执；`entry` 含 workItemId、requestId、documentVersionId、phase 等，但**不含** workItemRevision。保存读回后若 dynamic commit ACK 丢失，先按原 attempt 用 `get_action_attempt_status` 查实际 attempt 状态，再用 `get_parse_status` 检查 `entry.workItemId` 及嵌套的同版工作/确定性 Overall 投影；不能把状态 wrapper 原样传入 commit 回执校验器，也不能从该只读状态捏造 revision 值。上述状态形状见固定 Host `canonical-host-vertical.service.ts::openApiStatus` 与 `shared/api.interface.ts::AilyWorkItemStatusResponse`。

材料由 `program-assessment-materials.mjs` 分成五组：任务/范围、连续原文及准确 spans/locators、当前对象与公司事实、相关方法、既有理解与变化。`read_assessment_sources` 一次至多 96 个 sourceRefs；`context=EXACT|PAGE`，程序准备使用 `EXACT`，必须保存实际读回与完整范围。既有工作用 `read_assessment_work({workRevisionRef})` 按准确修订读取。响应中 `availableSources[].ref` 才能作为准确引用身份，短别名或未交付正文不构成引用。

Host 将 `workJson` 解析后经 `materializeJobAidWork` 保存：它对正文、标题、问题、措施等文字执行 trim；将 `overview` 保存为 `content.understanding`；完整更新的问题与先前未变问题合并，退休问题删除；补充 `issueRef`、来源依赖和确定性风险分级字段。风险、措施与依据数组经校验重建。独立 READ 返回 `schemaVersion=wiselink.jobaid-work-read.v2`、`attemptId`、`inputWorkRevision`、`revision`、`executionStatus`、`preparation`；保存后应核对同一 requestId、actionAttemptId、修订号、准确工作身份及结构化正文，而不能要求 `revision.content` 与未材料化的候选 JSON 字节相同。

固定 Host `saveAttemptWork` 的 SAVE 回执字段为 `{schemaVersion:"wiselink.jobaid-work-saved.v2",workRevisionRef,workRevision,replayed,roundCompletion,issueKeys,currentUnderstanding,preparation}`；`preparation` 是 Host 当前准备状态。离线 fixture 的 SAVE ACK 只返回消费者依赖的 revision 投影，因此其完整性不能替代此服务端形状。独立 READ 才含完整 `revision`；`get_parse_status` 则是另一种包含 `entry` 和 `integratedAssessmentSummary` 的 wrapper，三者不能混用。

正常程序执行在提交前还通过 `read_assessment_work({attemptRef,workItemId})` 做一次**无 lease fence 的只读最新工作核对**：Host 只允许以 `workRevisionRef` 指定旧工作基线，不能用它选择刚生成的新修订；带 fence 却不带原 SAVE requestId 的程序读取也会被 Host 拒绝。客户端要求最新读回的 workRevisionRef、actionAttemptId、workItemId、documentVersionId、basedOnWorkItemRevision、workRevision 与本轮任务/输出一致，并从该真实 revision 取得原 SAVE requestId。正常 RUNNING 与合法 COMMITTING replay 分别核对对应的 `executionStatus`；后者先核验原 sealed ResultEnvelope 与 attempt 状态，再做同一只读工作核对，随后只重放原 commit，不重发模型或 SAVE。commit ACK 和嵌套 Overall 投影的 `sourceAssessment.saveRequestId/workRevision` 必须与该读回一致。此附加只读核对不代替程序执行者先前按原 SAVE requestId 完成的独立 READ 记录。

## 配置与运行身份的具体差异

| 配置 | 客户端已实现 | 真实接线状态 |
| --- | --- | --- |
| `modelExecutor` / `--model-executor` / `WL_MODEL_EXECUTOR` | 显式 `CODEX` 选择已有消费者路径 | 待确认正式单一入口 |
| `--codex-binary`、`--codex-config`，及对应 `WL_CODEX_*` | 接受绝对路径；沿用已验证的 Codex 0.164.0 和妙搭 GLM 5.3 route | 既有六次模型实跑只证明测试应用路线；本批未部署新代码 |
| `--codex-run-root` / `WL_CODEX_RUN_ROOT` | 原 runner 和完整响应持久记录 | 待确认实际持久卷与保留期 |
| `--checkpoint-root` | 原 SAVE、独立 READ 与恢复状态持久记录 | 待明确新执行器专用绝对路径；不复用旧 UNKNOWN |
| 命名 MCP 项或 `WL_REVIEW_HOST_MCP_URL` | 只接受 Codex 命名配置和准确新路径 | 新 Host endpoint/name 未验证 |
| 私有 headers 或 `WL_REVIEW_HOST_MCP_HEADERS_JSON` | 现有 header 输入通道可用，回执不记录凭据值 | principal/tenant/actor/runtime 注册与配置存在状态待主控核对 |
| serverInfo、tools/list | 精确身份与工具元数据检查已实现 | 实际返回和 7 项外部依赖 schema 待提供 |

`preflight.mjs` 会分开返回 `legacyHostMcpConfigPresent`、`codexHostMcpConfigPresent`、`codexHostMcpEndpointValid`；没有配置 toolFilter 时 `missingHostTools=null`，必须通过真实发现核对，不能写成零缺失。`hostAuthenticationVerified`、`hostRuntimeRegistrationVerified`、`readyForBusinessExecution` 均保持 false。

共享验证器仍保留 `WISELINK_RUNTIME_APP_ID=app_17c3zn24kv2`、OpenClaw 命名的 Task/Result envelope、taskType 和 provenance tool key。新服务名通过 initialize 不会自动修改这些业务约定，也不证明新应用 `app_17gr74pbere` 已注册。主控需提供准确的 runtime/provenance 验证规则，双方再做有针对性的改动；本批未擅自放宽它们。

## 合成调用节选（字段关联，不是真实运行证据）

下表中的 `WI-DEMO`、`REQ-DEMO`、`ATT-DEMO`、`JAWR-DEMO`、UUID 与正文均为占位。`workJson` 必须是通过既有 JobAid v3 类型/语义校验的**完整 JSON 字符串**；下表用 `<完整工作 JSON 字符串>` 代替，因此不能直接提交。MCP `tools/call` 返回的业务 JSON 位于单个 `content[{type:"text",text:"<JSON>"}]`，客户端解析该 `text`。

| 阶段 | 请求 arguments 或 REST body | 必核对的响应投影 |
| --- | --- | --- |
| 领取 `next-work-item` | `{}`；恢复既有 claim 时 `{"resumeWorkItemId":"WI-DEMO"}` | `{"status":"CLAIMED","workItemId":"WI-DEMO","requestId":"REQ-DEMO","documentVersionId":"DVI-DEMO","workItemRevision":7,"leaseToken":"<UUID>","leaseGeneration":1,"leaseExpiresAt":"<ISO>"}`。`IDLE`、`DOCUMENT_PENDING`、`REVIEW_PENDING`、`OVERALL_PENDING` 是其他明确分支。 |
| 开始 `begin_dynamic_evaluation` | `{"workItemId":"WI-DEMO","requestId":"<当前初评阶段的准确 requestId>"}`；无阶段续接时只传 `workItemId` | `status=RUNNING|COMMITTING`，`attemptRef=ATT-DEMO`、lease token/generation、`task.taskType=OPENCLAW_DYNAMIC_EVALUATION`、`task.operationRef=ATT-DEMO`；程序任务 `modelInput.executionMode=PROGRAM_CONTROLLED_V1`。`COMMITTING` 必有 `recoveryResult`，不可重生成。 |
| 材料 `read_assessment_sources` | `{"attemptRef":"ATT-DEMO","leaseToken":"<UUID>","leaseGeneration":1,"sourceRefs":["<availableSources[0].ref>"],"purpose":"Prepare authorized assessment scope","context":"EXACT"}` | 准确 refs 对应的实际正文与读回回执；未读范围不能说已覆盖。 |
| 进展 `record_assessment_program_progress` | `{"attemptRef":"ATT-DEMO","workItemId":"WI-DEMO","leaseToken":"<UUID>","leaseGeneration":1,"phase":"MATERIALS_READY","checkpointRef":"initial:DEMO:program-materials","materialSnapshotJson":"<已持久化材料及模型请求快照>"}` | 只记录材料已准备；完整原始模型响应先持久化后，另以 `phase=MODEL_RESPONSE_SAVED` 报告。 |
| 保存 `save_assessment_work` | `{"attemptRef":"ATT-DEMO","leaseToken":"<UUID>","leaseGeneration":1,"requestId":"<固定 saveRequest.requestId>","expectedWorkRevision":3,"workJson":"<完整工作 JSON 字符串>"}` | SAVE ACK 不是独立读回；保存身份、CAS 基线和原文字节必须保持。 |
| 请求核对及独立 READ `read_assessment_work` | `{"attemptRef":"ATT-DEMO","requestId":"<同一个 saveRequest.requestId>","leaseToken":"<UUID>","leaseGeneration":1}`；既有基线则传 `workRevisionRef` | `revision.requestId` 等于 SAVE 请求，`workRevision=4`，`workRevisionRef=JAWR-DEMO`，`content.roundCompletion` 与正文匹配，`content.overviewStatus=CURRENT`。保存 ACK 丢失时仍用原 requestId 读；没有读到不能假定未保存并重造请求。 |
| 初评收尾 `commit_dynamic_evaluation_candidate` | `{"attemptRef":"ATT-DEMO","leaseToken":"<UUID>","leaseGeneration":1,"result":{ "<由 sealResultEnvelope 产生的完整冻结任务结果>": "…" }}` | 实际 `result` 由 `sealResultEnvelope` 生成，不能采用表中的示意对象。程序回执 `status=OVERALL_CANDIDATE_READY`，`baseRules.workRevisionRef=JAWR-DEMO`，`overallSynthesis.basedOnJobAidWorkRevisionRef=JAWR-DEMO`，`sourceAssessment.saveRequestId` 等于原 SAVE 身份。 |
| 正常结束 `ack-work-item` | `{"workItemId":"WI-DEMO","leaseToken":"<UUID>","leaseGeneration":1}` | `status=ACKNOWLEDGED`，同一 workItemId，`replayed` 与 `acknowledgedAt`。 |

若模型结果为 UNKNOWN，只保留原 request/检查点/停止观察；不可借此重放旧请求或替旧 UNKNOWN 换新的 Codex 执行。保存响应不确定、投影结果不确定与已完成收尾分别用各自原身份读回或协议恢复。新 Codex 验收应使用明确分配的**新**任务；不迁移旧数据、不接管历史在途任务。

## 接线验收

1. 从实际 Codex endpoint `initialize` 核对独立 name/version，再 `tools/list` 核对客户端需要的确切工具名和 schema；与机器文件中的 legacy 源值分别记录。
2. 只用已授权的新任务核对 claim/begin 的 request、workItem、attempt、lease、文档版本及 input revision；证据中令牌脱敏。
3. 留存准确材料快照与完整响应，再按原 SAVE `requestId` 做独立 READ；按同一 workRevisionRef 核验确定性 Overall 与正常阅读。
4. 核验正常 ACK/BLOCK 收尾以及准确失败态。技术检查、线上身份接通、真实业务运行与正式采用分别记载，不互相代替。
