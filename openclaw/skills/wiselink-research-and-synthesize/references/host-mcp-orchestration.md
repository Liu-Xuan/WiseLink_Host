# R09 canonical Host MCP 编排

基线：Host `6fd2655d27edc3851c745547efaf8796ad22c82c`，包含 C4 applicability lifecycle 与
C5 unified runtime/status policy。
Endpoint 仍是 Host 提供的 `POST /openapi/wiselink/openclaw-mcp`；Skill 不自造 HTTP。

## 20 个当前工具（MCP 1.2.0）

以下是既有基础能力清单。c19 自动消费者另外识别兼容的只读 `get_pending_review_turn({workItemId})`；它不进入单轮模型工具集、不改变 C3 提交参数。部署顺序与范围见 [页面自动领取](hosted-review-consumer.md)。

只读：

1. `get_parse_status({workItemId})`
2. `query_parsed_package({workItemId, query})`
3. `get_deep_link({workItemId})`

INITIAL_ANALYSIS：

4. `begin_translation({workItemId, deliveryPart?})`
5. `commit_translation_candidate(...)`（小结果兼容 direct result；大结果为 `UPLOAD_PART` / `FINALIZE`）
6. `begin_applicability_evaluation({applicabilityContextRef, requestId})`
7. `commit_applicability_candidate({attemptRef, leaseToken, leaseGeneration, result})`
8. `begin_dynamic_evaluation({workItemId})`
9. `commit_dynamic_evaluation_candidate({attemptRef, leaseToken, leaseGeneration, result})`
10. `record_oem_discovery_run({workItemId, result})`
11. `begin_overall_synthesis({workItemId, providers})`
12. `resume_overall_synthesis({attemptRef})`
13. `commit_overall_candidate({attemptRef, leaseToken, leaseGeneration, result})`

INTERACTIVE_REVIEW：

14. `begin_review_turn({reviewConversationRef, requestId})`
15. `get_review_turn_context({attemptRef})`
16. `read_source_refs({attemptRef, sourceRefIds})`
17. `get_action_attempt_status({attemptRef})`
18. `commit_review_turn_candidate({attemptRef, leaseToken, leaseGeneration, result})`

Attempt 控制面：

19. `heartbeat_action_attempt({attemptRef, leaseToken, leaseGeneration})`
20. `cancel_action_attempt({attemptRef, reason})`

本 Skill 的 INTERACTIVE_REVIEW runtime path 精确只使用 14–18。Heartbeat/cancel 不是 review model 工具，
不用于替代五工具会话合同。

## TaskEnvelope 与 lease fence

除 Translation 外，每个 `begin_*` 直接返回 `attemptRef`、status、`leaseToken`、`leaseGeneration`、lease expiry
和完整 TaskEnvelope。Translation 的同一 begin 工具按实际序列化响应大小返回可读
`wiselink.3_1.openclaw_translation_delivery.v1` 批次：第 0 批含脱敏 taskBinding、modelInputBase 和 SourceUnits，
后续批只含同一绑定下的连续 SourceUnits。官方 Hosted Agent 直接逐批读取，不执行 shell/Node 解码。
COMMITTING 批次另含有界 `recoveryResultContentHash`；完整 recoveryResult 仍只从通用 status 读取并做三方 hash
一致性校验。
`attemptRef` 必须等于 TaskEnvelope `operationRef`。TaskEnvelope 自带：

- Host internal `actionAttemptId` 与 opaque operationRef；
- taskType、WorkItem/baseRevision/DocumentVersion；
- actual artifact `sourceRefs[{ref,sha256}]`；
- authority-free `modelInput`；
- deadline、idempotencyKey、canonical `inputHash`。

Translation delivery 不返回 tenant/actor/ACL、artifact ref/FileService locator、credential、sessionKey、raw PDF 或
full Fleet；只返回必要 attempt fence、脱敏 taskBinding、source artifact SHA 与 authority-free translation input。
其它 TaskEnvelope 自身仍是控制面对象，不能整体发给模型。

RUNNING attempt 的默认 deadline 为 60 分钟、lease 为 30 分钟。INITIAL_ANALYSIS 在每次模型调用前与返回后
调用 heartbeat；模型生成期间不要求短周期回调。WAITING_INPUT 零模型路径、COMMITTING 只读恢复与 review 五工具
路径不插入 heartbeat。

所有 commit 使用 Host 返回的 exact attemptRef、leaseToken、leaseGeneration 和逻辑完整 ResultEnvelope。旧
`{attemptRef, output}` 已废止。Translation 大 ResultEnvelope 使用同一工具分块传输；工具总数仍为 exact20。

## INITIAL_ANALYSIS

### Translation

```text
get_parse_status
→ begin_translation deliveryPart 0..N（可读 SourceUnit 批次）
→ heartbeat
→ 官方 Hosted Agent 按 modelInputBase + 连续 SourceUnits 执行翻译
→ heartbeat
→ translation-pair validator
→ sealed ResultEnvelope 写入本轮本地 commit-payload.json
→ commit_translation_candidate(UPLOAD_PART × N，每 part 6144 raw bytes)
→ commit_translation_candidate(FINALIZE, receipts)
→ get_parse_status + get_deep_link
```

Skill helper 从文件按 canonical UTF-8 bytes 读取，Base64 后每次 arguments 小于 12,000 bytes。Host 对每一 part
重新校验 owner/attempt/lease fence 与当前 WorkItem revision/DocumentVersion，并用同一 FileService owner 的确定性
attempt path 做 actual-byte readback；相同 part 精确重放，冲突 bytes 明确失败。UPLOAD_PART 不改 WorkItem/current、
不产生可见 candidate。FINALIZE 要求 0..N-1 receipt 完整唯一，组装后才进入既有 exact TranslationRuleSet
deterministic ResultGate、final artifact actual bytes readback 与一次 CAS。

任一明确失败停止；part/finalize 响应未知或 attempt 已为 COMMITTING 时只读一次通用 ActionAttempt status。仅当
`resultContentHash` 精确等于本次 sealed ResultEnvelope `contentHash` 才返回恢复，禁止自动 retry finalize。

### Applicability

```text
begin_applicability_evaluation(applicabilityContextRef, requestId)
→ Host modelInput（frozen SourceExpressions/SourceRefs + bilingual SourceUnits + controlled aircraft facts）
→ heartbeat
→ 官方托管 profile 当前选定模型只生成 source-condition AST candidate
→ heartbeat
→ Skill 组装完整 applicability_candidate.v1 + ResultEnvelope
→ commit_applicability_candidate(attemptRef, leaseToken, leaseGeneration, result)
→ Host target binding + Fleet/Kleene + ResultGate + actual bytes + CAS/current
```

若 Task `hostResolvedMissingInputs` 非空，不调用模型，只原样提交 WAITING_INPUT。模型不输出
`applicabilityLevel/contentRef` 或飞机适用结论；`query_parsed_package`、dynamic、overall 仍不能代替此 operation。
该 WAITING_INPUT 只终结 applicability attempt，不终结 INITIAL_ANALYSIS；Host 后续允许的 dynamic/Job-Aid/overall
继续执行，且 UNKNOWN 保持不变。

### Dynamic N/N

```text
get_parse_status
→ begin_dynamic_evaluation
→ heartbeat
→ dynamic-rules-input + dynamic-rules-pair validator
→ heartbeat
→ full ResultEnvelope
→ commit_dynamic_evaluation_candidate
→ get_parse_status [+ query_parsed_package] + get_deep_link
```

未知 commit 只读一次 `get_action_attempt_status`，以 `resultContentHash` 精确绑定本次 ResultEnvelope；否则
outcome unknown。

### Overall

默认无 discovery：

```text
get_parse_status（dynamic N/N 已持久）
→ begin_overall_synthesis(workItemId, [])
→ heartbeat
→ synthesis-input（含 Host selectiveResynthesis）+ synthesis-pair validator
→ heartbeat
→ full ResultEnvelope
→ commit_overall_candidate
→ get_parse_status + get_deep_link
```

`resume_overall_synthesis` 只接既有 RUNNING attempt 并返回同一 Task/modelInput/lease；它不创建 attempt、
不执行 dynamic/discovery。`COMMITTING` 不走 resume，而走只读 recovery。

未知 overall commit 同样只按通用 ActionAttempt `resultContentHash` 一次恢复。

若 Host 输入表明当前文档的 source-bound 适用性条件缺少受控构型事实，仍调用 overall 模型形成 candidate-only
初步工程综合；输出明确保持 `UNKNOWN/WAITING_INPUT`，只列当前 SourceRef/effectivity 所需缺口和人工/后续
数据确认要求，不得带入其它文档的设备/软件名称，也不得最终批准或发布。

### Gap-driven discovery

Discovery 不是 INITIAL_ANALYSIS 前置步骤。只有 dynamic/overall 暴露明确、可陈述且需要外部事实的 gap 时，
才调用当前真正存在并与发布方相关的官方来源能力，再只记录实际执行的 provider。禁止固定遍历三家 OEM。

`record_oem_discovery_run` 响应未知时无精确 readback，所以 outcome unknown、no retry。SearchRun/snippet 永远
不是 evidence；Host/DM 未采纳前不改变 EvaluationContext/current。

### Configuration-evidence P0B

`runConfigurationEvidenceReevaluation` 是现有 INITIAL_ANALYSIS 编排器上的顺序协调层，不新增 MCP
tool。它首先 fresh-read `get_parse_status.configurationEvidenceReevaluation`，再严格跟随 Host
`nextStage`：

```text
APPLICABILITY -> fresh status
JOB_AID       -> fresh status
OVERALL       -> fresh status
```

每个阶段内部仍复用原 begin/heartbeat/commit/status 路径。恢复时，已为 `SUCCEEDED` 的前序阶段
不再调用；`WAITING_INPUT|FAILED|CONFLICT` 不在同一运行中自动重试。阶段间必须保持同一
snapshot/configuration revision 触发绑定且不回退。Overall 不检查旧 serving baseRules，只要求
Host 脱敏状态确认已进入 `OVERALL`；真正 staged 输入由 Host begin 从内部 shadow WorkItem 派生。

旧 Host 不返回该状态字段时，P0B 入口返回 `HOST_P0B_STATUS_UNAVAILABLE`，原有
`runInitialAnalysis` 单操作路由保持不变。

## INTERACTIVE_REVIEW C3

入口只有 C1 已持久对象引用：

```text
begin_review_turn({reviewConversationRef, requestId})
```

Host 从 OAuth subject mapping、ReviewConversation/Turn、owner-bound WorkItem 和 current revision 派生 actor、
tenant、WorkItem、session binding 与 opaque actorContextRef。调用方不能提交这些字段。

RUNNING 正常路径由 `scripts/run-hosted-review-turn.mjs` 外部驱动执行；对话模型不得直接持有五工具控制面：

1. begin Task 的 `attachmentRefs` 允许为空或非空；非空时必须全部是非空唯一字符串，且是同一 Task
   `resourceRefs.sourceRefId` 的子集。随后 `get_review_turn_context({attemptRef})`，校验
   conversation/turn/revision/allowedOperations/executionPolicy 与 Task 完全一致，并精确核对 context 返回的
   resource metadata；跨 resource、重复或未知附件引用在模型前停止。
2. 仅对本轮明确需要且属于 Task allowlist 的 IDs 调
   `read_source_refs({attemptRef, sourceRefIds})`；每批 1–100，去重。Host 授权的 current-turn attachment ref 也只走
   这条路径，返回 Host 已从 actual bytes 绑定并解析的 `ENGINEER_ATTACHMENT` value，不直接读取附件 locator/bytes。
3. 模型只能看到移除 workItemId、conversation、turn、request、attempt、lease 与 executionPolicy 后的最小
   context、用户消息、允许的 operation/item/input/source IDs；附件只额外暴露 opaque `attachmentRefs` 与按需
   读取的 parsed value。模型看不到 actorContextRef、tenant、ACL、resource artifact ref/SHA、FileService
   locator 或 raw bytes，也不能调用 Host 工具。
   `context.evaluation.gapLedger` 是 current revision 的 Host 派生只读投影；同一 `missingInputId` 已合并其
   origin／affected Criterion。模型只按列出的 `gapRef` 解释或起草候选动作，不能创建、重命名或关闭 Gap。
   若起草缺口证据动作，`resolvedGapRefs` 只能选择 `REVIEW_QUERYABLE` 且未完全关闭的 Host Gap，
   `affectedItemIds` 必须等于选中 Gap 的影响项并集，并必须采用当前工程师文本或附件；Draft 同时携带
   不确定性处置和 candidate-only Decision Snapshot；确认时 Host 再次
   fresh-read 并派生 missingInputId，模型不得提交该内部映射。
4. review candidate 只能引用本轮实际 read 的 SourceRefs。内层 `candidate.sourceRefs` 是
   `sourceRefId[]`；其外层 `ResultEnvelope.sourceRefs` 必须由
   `reviewCandidateArtifactRefs(task, candidate)` 机械映射成对应 resource artifact `{ref,sha256}`。
   两者同名但类型不同，严禁把 sourceRefId 写入外层字段。
5. 单次 `commit_review_turn_candidate`。成功回执必须显示 candidate persisted，同时五个 authority flag 精确：
   `reviewActionExecuted=false`、`workItemRevisionChanged=false`、`currentChanged=false`、`staleMarked=false`。

驱动在私有 `0700` 目录中以 `0600` 持久化每步 started/result。重启只读已完成 checkpoint；非 commit 步骤的
started-without-result 一律停止且不重试。commit started-without-result 触发且只触发一次 status readback，不再
提交 commit。c21 通过 Gateway client functions 允许模型按需请求 `read_wiselink_review_sources`，
驱动委托既有 `read_source_refs` 取回实际片段；模型最终调用仅序列化的 `return_wiselink_review_candidate`。
不向模型暴露 Host MCP、begin/lease/commit。每次响应只接一个合法 function call；同轮后续只传新 tool exchange，
使用相同原生 session 和既有总超时，不重传完整评估上下文。c22 通过 begin 的可选控制面 `nativeSessionKey`
承接同一授权范围下的跨轮讨论；Host 比较上一条成功 Turn 的任务与当前 revision/来源目录后决定延续或重建。
该 key 只进入 Gateway header，不成为模型可写字段。每个新 Turn 仍重新同步当前 Host 输入并独立提交候选，
引用来源仍须本轮读取。旧 Host 无 key 时明确报告旧逐轮隔离路径；失败或权限变化不携带未获授权的旧记忆。

COMMITTING：

```text
begin/status = COMMITTING
→ get_action_attempt_status({attemptRef})
→ validate begin.recoveryResultContentHash == recoveryResult.contentHash == resultContentHash
→ return COMMITTING_RECOVERY_READ_ONLY
```

不调用模型、不重放 commit。commit 响应未知时同样只读 status 一次；terminal status 也必须精确匹配本次
sealed ResultEnvelope 的 `contentHash` 才能返回恢复。

## 当前未授权 review operations

独立 attachment analysis operation、knowledge search、revision compare、affected reevaluation、overall
resynthesis 在 R09 目标合同中存在，但 C3 没有对应 MCP 工具。因此以下扩展 operation 仍全部 fail closed：

- `ANALYZE_ATTACHMENT`
- `SEARCH_ALLOWED_KNOWLEDGE`
- `COMPARE_REVISIONS`
- `REEVALUATE_AFFECTED`
- `RESYNTHESIZE_OVERALL`

不得把 `read_source_refs`、dynamic 或普通 app OpenAPI 冒充这些能力。

这不禁止读取 Host 已授权、已解析的 current-turn attachment。该窄路径仍属于现有 `READ_SOURCE_REFS`：
`attachmentRefs ⊆ resourceRefs.sourceRefId`，模型只能通过 `read_source_refs` 获取 parsed value，并且输出保持
candidate-only。它不增加附件上传、搜索、raw FileService 读取或 ReviewAction 直写能力。
