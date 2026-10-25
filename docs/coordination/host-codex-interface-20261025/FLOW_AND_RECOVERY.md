# 程序初评、准确读回与恢复

此处描述当前消费者和 Host 的实际流程；模型只产候选正文，可信程序固定领取、材料、保存、读回和结束步骤。`PROGRAM_CONTROLLED_V1` 初评只有一次上游生成；确定性初评 Overall 不再发起第二次模型调用。独立的旧 `begin_overall_synthesis` 工具用于其他既有场景，不能把它当作本轮程序初评必经的第二次生成。

## 1. 请求和材料

新请求通过正常用户入口 `POST /api/canonical-host/work-items/:workItemId/initial-analysis/continue` 受理，`operation='EVALUATE_JOBAID'`、`executionMode='PROGRAM_CONTROLLED_V1'` 及受控 `modelRef` 保持与封存 task 一致。浏览器请求不使用队列凭据；模型设置、来源和 actor 仍由 Host 校验。

`begin_dynamic_evaluation` 交付 `availableSources` 目录、`deliveredEvidence`、准确 `documentOverview.original.binding` 与 `programOriginal`。主原文 model evidence 有意不含顶层 `documentVersionId/sourceRefId`；应与目录、完整 `evidenceRef`、单元和 locator 对照，不能按冒号段数拆分引用。含 parseRun 的 sourceRef 本身可以有冒号。

补读使用 `read_assessment_sources`：`sourceRefs` 1..96，`purpose` 非空，`context='EXACT'|'PAGE'`（默认 `PAGE`）。Host 只允许已登记目录，重新验证 source/actor/版本与租约，实际读取并持久记录 read observation 后才加入可引用范围。目录、已有 inline 正文和本轮补读要区分；未读目录不是已验证事实。

已有工作只能按 sealed `previousWork.workRevisionRef` 完整读取，不能以最新工作代替。用于旧基线的 `read_assessment_work({workRevisionRef})` 与用于本次 SAVE 证明的 `read_assessment_work({requestId})` 不可互换。

`record_assessment_program_progress` 的 `MATERIALS_READY` 带完整 `materialSnapshotJson={materials,modelRequest}`。Host 校验 sealed originalInput、准确 previous work、read packet evidence、选定模型和序列化的两消息/函数候选请求，写入既有 artifact 并实际读回字节。CODEX 时这是 `run-program` 传入 `createCodexGateway` 的请求；适配器还会把它封进Codex prompt，再由Codex/bridge转换成真正上游请求，**不能称该快照等于上游HTTP payload**。journal 只存 artifact descriptor。此状态只表示 `PREPARED_NOT_CONFIRMED_SENT`。

五组模型材料和原目录→正文映射见 [示例说明](examples/README.md)。它们是合成数据经实际 producer/reader/parser 的输出，不是手填线上业务内容。

## 2. 一次生成与完整响应

可信程序先保存 `program-model-input` 和 `assessment-round-1.started`，再调用一次选定执行器。`assessment-round-1.result` 必须持久保存完整 `{raw,status,ok}` 及传入适配器请求的 `argsHash` 后才允许 SAVE。该hash绑定已有程序请求，并不单独证明实际Codex prompt、bridge payload或上游原字节相同。Codex 输出由实际适配器转换成原函数候选合同；转换本身不执行业务函数。

成功候选只来自唯一 `return_wiselink_program_assessment({workJson})`，经过原正文类型/语义校验。完整旧问题键必须在 changed issues、`unchangedIssueKeys` 或 `retiredIssues` 中明确交代；允许 `COMPLETE_WITH_OPEN_QUESTIONS`，但 `IN_PROGRESS` 不能结束初评。`MODEL_RESPONSE_SAVED` 只记录消费者已保存完整响应的进度观察；不是 Host 持有原始响应或已正式采用的证明。

## 3. SAVE、准确 READ 与 Overall

| 顺序 | 实际调用与绑定 | 需要保留的证据 |
| --- | --- | --- |
| 1 | 持久保存 `program-save-request`：原 `requestId`、`expectedWorkRevision`、完整 `workJson` | 原 SAVE key 和命令不能因异常而更换 |
| 2 | 先 `read_assessment_work({requestId})` 查询该原 key | 已保存则不重复生成；匹配同 attempt |
| 3 | 若不存在，`save_assessment_work` 发送原 key/CAS/正文与 attempt fence | SAVE 由原 service materializer 和 repository 保存；返回 `workRevisionRef/revision/replayed` |
| 4 | 无论 SAVE ACK 是否正常，独立 `read_assessment_work({requestId,leaseToken,leaseGeneration})` | 完整准确修订，ref、revision、save key、同 attempt/DV/baseRevision；不是 SAVE 响应 |
| 5 | 消费者验证 revision=`expectedWorkRevision+1`、正文 roundCompletion/understanding、`overviewStatus='CURRENT'` | `program-work-readback` 保存实际读回；Host 写 `ASSESSMENT_WORK_READ` |
| 6 | `commit_dynamic_evaluation_candidate`，ResultEnvelope `modelOutput` 仅为 `{"workRevisionRef":"准确已保存ref"}` | task/result 字段、contentHash、实际 model provenance 和 fence 精确绑定 |
| 7 | Host 封存结果为 COMMITTING，读取同一 saved work 和独立 READ，确定性投影 | 初评 Overall `executionKind='DETERMINISTIC_PROJECTION'`、`modelRequests=0`、`semanticReanalysisPerformed=false` |
| 8 | 同一 WorkItem CAS 写 baseRules 与 Overall，然后 `finishProjectionSuccess` | Overall `sourceAssessment` 精确含 attemptId、workRef/revision、saveRequestId、readObservedAt |
| 9 | 原阅读面读回准确工作/Overall/状态；自动队列仅在 Host 完整状态满足后 ACK | 队列 owner/token/generation 与 attempt 成功分开核对 |

保存并不正式采用、不独立完成 WorkItem。初评 Overall 为 `candidate_only`、`adopted=false`；不制造 Review、审批或放行。准确已保存成果的阅读不调用模型。

## 4. 错误和恢复

完整可检索源码错误清单见 [errors/source-catalog.json](errors/source-catalog.json)。它包含准确 code、模板、源文件和行号；不是把每个内部错误猜成一个 HTTP 状态。REST HTTP 状态说明直接来自 [OpenAPI](rest/openapi.paths.json)。MCP 严格参数检查和业务异常由实际 SDK/Host 处理；消费者应同时保留 RPC 错误及 tool result `isError`，不能只看 HTTP 200。

| 情况 | 已有错误/状态例 | 允许的下一步 |
| --- | --- | --- |
| 模式/运行端/授权未配置 | `CANONICAL_EXECUTOR_ENDPOINT_INACTIVE`、`CANONICAL_CODEX_RUNTIME_CONFIG_REQUIRED`、`CANONICAL_SERVICE_SCOPE_UNAVAILABLE` | 配齐获准身份/路径/scope后重做 metadata 和准确任务检查；不借旧配置放行 |
| begin 已终态或 busy | `ACTION_ATTEMPT_ALREADY_<status>`、既有 active request | 读取原请求状态；不重复创建/更换模型 |
| 原件、来源或 actor 变化 | `JOBAID_SOURCE_AUTHORIZATION_CHANGED`、`JOBAID_ORIGINAL_REQUEST_CHANGED` | 保留原任务，取得正确授权/版本后按 Host 合同处理；不改引用过关 |
| 已开始但没有完整响应记录 | `PROGRAM_ASSESSMENT_MODEL_OUTCOME_UNKNOWN` | 保留检查点和 UNKNOWN；不能再调一次模型或报告零派发 |
| SAVE ACK 丢失/技术失败 | 原 SAVE key 查询 | 先按原 key READ；存在则核对准确 revision；不存在也不证明模型没执行，不换 key/正文 |
| fence/CAS 漂移 | lease 或工作 revision 冲突 | 保留完整响应、原 key 和错误；由 Host 原租约/版本恢复，不把 JOBAID 前缀当正文错误丢弃结果 |
| 独立读回缺失或不匹配 | `JOBAID_PROGRAM_INDEPENDENT_READ_REQUIRED`、`JOBAID_PROGRAM_READ_BINDING_INVALID` | 用同 attempt/原 SAVE key/有效 fence 完成准确 READ，不用 latest 或旧基线 READ 替代 |
| Overall artifact/CAS 后中断 | `COMMITTING` + 原 `recoveryResult` | 只重放原 commit；Host 恢复投影或 finish，不再次生成 |
| 消费者已停止但上游未知 | `record_assessment_consumer_stopped` + `upstreamOutcome='UNKNOWN'` | 只追加安全元数据；不改 provider终态、attempt终态、租约、保存工作或队列 |
| 队列任务尚未完整完成 | `AUTO_WORK_ITEM_INITIAL_ANALYSIS_NOT_COMPLETE` | 先核对 Host 状态，不强行 ACK |
| 不能确认终态失败 | `AUTO_WORK_ITEM_FAILURE_NOT_CONFIRMED` | 不 BLOCK UNKNOWN；只对 Host 确认 FAILED/CONFLICT使用正常 BLOCK |

本包没有执行任何旧请求恢复、重放、清理或配置修改。
