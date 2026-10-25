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

可信程序先保存 `program-model-input` 和 `assessment-round-1.started`，再调用一次选定执行器。CODEX使用固定`program:<attemptRef>:round-1`身份及已有generation receipt恢复；原runner还在时等待同一回执，已留回执时恢复同一响应，不能另开一次推理。`assessment-round-1.result`必须持久保存完整`{raw,status,ok,codexReceipt}`及传入适配器请求的`argsHash`，并核对receipt请求身份/响应摘要后才允许SAVE。该hash绑定已有程序请求，并不单独证明实际Codex prompt、bridge payload或上游原字节相同。Codex输出由实际适配器转换成原函数候选合同；转换本身不执行业务函数。

成功候选只来自唯一 `return_wiselink_program_assessment({workJson})`，经过原正文类型/语义校验。完整旧问题键必须在 changed issues、`unchangedIssueKeys` 或 `retiredIssues` 中明确交代；允许 `COMPLETE_WITH_OPEN_QUESTIONS`，但 `IN_PROGRESS` 不能结束初评。`MODEL_RESPONSE_SAVED` 只记录消费者已保存完整响应的进度观察；不是 Host 持有原始响应或已正式采用的证明。

## 3. SAVE、准确 READ 与 Overall

| 顺序 | 实际调用与绑定 | 需要保留的证据 |
| --- | --- | --- |
| 1 | 持久保存 `program-save-request`：原 `requestId`、`expectedWorkRevision`、完整 `workJson` | 原 SAVE key 和命令不能因异常而更换 |
| 2 | 先 `read_assessment_work({requestId})` 查询该原 key | 已保存则不重复生成；匹配同 attempt |
| 3 | 若不存在，`save_assessment_work` 发送原 key/CAS/正文与 attempt fence | SAVE 由原 service materializer 和 repository 保存；返回 `workRevisionRef/revision/replayed` |
| 4 | 无论 SAVE ACK 是否正常，独立 `read_assessment_work({requestId,leaseToken,leaseGeneration})` | 完整准确修订，ref、revision、save key、同 attempt/DV/baseRevision；不是 SAVE 响应 |
| 5 | 消费者验证同attempt/WI/DV/baseRevision、revision=`expectedWorkRevision+1`、Host材料化后的正文/问题集合、`overviewStatus='CURRENT'` | `program-work-readback`保存实际读回；Host写`ASSESSMENT_WORK_READ`。Host会trim和补充来源/风险字段，不能要求保存体与原候选JSON逐字相同 |
| 6 | commit前再用授权latest READ定位原SAVE key，随后按该key精确READ，并要求两次完整revision一致 | RUNNING带有效fence记录真实读取；COMMITTING无fence只检查原结果。latest本身不能证明准确保存，也不能代替原key独立READ |
| 7 | `commit_dynamic_evaluation_candidate`，ResultEnvelope `modelOutput`仅为`{"workRevisionRef":"准确已保存ref"}` | task/result字段、contentHash、实际model provenance和fence精确绑定 |
| 8 | Host封存结果为COMMITTING，读取同一saved work和独立READ，确定性投影 | 初评Overall `executionKind='DETERMINISTIC_PROJECTION'`、`modelRequests=0`、`semanticReanalysisPerformed=false` |
| 9 | 同一WorkItem CAS写baseRules与Overall，然后`finishProjectionSuccess` | Overall `sourceAssessment`精确含attemptId、workRef/revision、saveRequestId、readObservedAt |
| 10 | 原阅读面读回准确工作/Overall/状态；自动队列仅在Host完整状态满足后ACK | 队列owner/token/generation与attempt成功分开核对 |

保存并不正式采用、不独立完成 WorkItem。初评 Overall 为 `candidate_only`、`adopted=false`；不制造 Review、审批或放行。准确已保存成果的阅读不调用模型。

`get_parse_status`是`{entry,...,integratedAssessmentSummary,initialAnalysis?}`包装；同版baseRules/overallSynthesis位于`integratedAssessmentSummary`。`entry`没有workItemRevision，不能把状态wrapper冒充commit ACK或补造revision。收到但非法的commit ACK直接失败；只有ACK未取得时才按原ResultEnvelope hash、attempt状态及嵌套同版Overall恢复。COMMITTING consumer wrapper先绑定原attempt/WI和已保存key，随后仅允许该key READ，不允许SAVE或模型请求。

## 4. 错误和恢复

完整可检索源码错误清单见 [errors/source-catalog.json](errors/source-catalog.json)。它包含准确 code、模板、源文件和行号；不是把每个内部错误猜成一个 HTTP 状态。REST HTTP 状态说明直接来自 [OpenAPI](rest/openapi.paths.json)。MCP 严格参数检查和业务异常由实际 SDK/Host 处理；消费者应同时保留 RPC 错误及 tool result `isError`，不能只看 HTTP 200。

| 情况 | 已有错误/状态例 | 允许的下一步 |
| --- | --- | --- |
| 模式/运行端/授权未配置 | `CANONICAL_EXECUTOR_ENDPOINT_INACTIVE`、`CANONICAL_CODEX_RUNTIME_CONFIG_REQUIRED`、`CANONICAL_SERVICE_SCOPE_UNAVAILABLE` | 配齐获准身份/路径/scope后重做 metadata 和准确任务检查；不借旧配置放行 |
| begin 已终态或 busy | `ACTION_ATTEMPT_ALREADY_<status>`、既有 active request | 读取原请求状态；不重复创建/更换模型 |
| 原件、来源或 actor 变化 | `JOBAID_SOURCE_AUTHORIZATION_CHANGED`、`JOBAID_ORIGINAL_REQUEST_CHANGED` | 保留原任务，取得正确授权/版本后按 Host 合同处理；不改引用过关 |
| 已开始但父程序尚无完整响应记录 | 原固定CODEX request/runner receipt；无有效回执时`CODEX_GENERATION_OUTCOME_UNKNOWN` | 先等待/恢复原runner回执；没有闭合证据则保留UNKNOWN，不能再调一次模型或报告零派发 |
| SAVE ACK 丢失/技术失败 | 原 SAVE key 查询 | 先按原 key READ；存在则核对准确 revision；不存在也不证明模型没执行，不换 key/正文 |
| fence/CAS 漂移 | lease 或工作 revision 冲突 | 保留完整响应、原 key 和错误；由 Host 原租约/版本恢复，不把 JOBAID 前缀当正文错误丢弃结果 |
| 独立读回缺失或不匹配 | `JOBAID_PROGRAM_INDEPENDENT_READ_REQUIRED`、`JOBAID_PROGRAM_READ_BINDING_INVALID` | 用同 attempt/原 SAVE key/有效 fence 完成准确 READ，不用 latest 或旧基线 READ 替代 |
| 定位和原key读回漂移 | `HOST_MCP_PROGRAM_ASSESSMENT_EXACT_READBACK_MISMATCH` | 停止收尾并保留两次读回；不改原SAVE key或用其他最新版本替代 |
| Overall artifact/CAS 后中断 | `COMMITTING` + 原 `recoveryResult` | 只重放原 commit；Host 恢复投影或 finish，不再次生成 |
| 消费者已停止但上游未知 | `record_assessment_consumer_stopped` + `upstreamOutcome='UNKNOWN'` | 只追加安全元数据；不改 provider终态、attempt终态、租约、保存工作或队列 |
| 队列任务尚未完整完成 | `AUTO_WORK_ITEM_INITIAL_ANALYSIS_NOT_COMPLETE` | 先核对 Host 状态，不强行 ACK |
| 不能确认终态失败 | `AUTO_WORK_ITEM_FAILURE_NOT_CONFIRMED` | 不 BLOCK UNKNOWN；只对 Host 确认 FAILED/CONFLICT使用正常 BLOCK |

本包没有执行任何旧请求恢复、重放、清理或配置修改。
