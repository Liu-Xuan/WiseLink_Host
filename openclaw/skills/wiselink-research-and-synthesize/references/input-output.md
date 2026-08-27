# R09 输入输出合同

本参考描述 Skill 与 Host MCP 1.2.0/exact20 的交换对象，不定义第二套产品合同、权限、状态机或持久化。

## TaskEnvelope

Host begin/resume 返回完整 `wiselink.3_1.openclaw_task_envelope.v1`：

```text
schemaVersion
actionAttemptId / operationRef / taskType / priority
tenantId / workItemId / inputRevision / baseRevision / documentVersionId
sourceRefs[{ref,sha256}]
allowedConnectors
hostResolvedMissingInputs[{code,message}]
modelInput
deadline / idempotencyKey / inputHash
```

`inputHash` 是对除自身外的 TaskEnvelope 做递归 key-sort canonical JSON 后得到的裸 64 位小写 SHA-256。
TaskEnvelope 是 Host 控制面对象；不能整体发给模型。INITIAL_ANALYSIS 只传 `modelInput`，review 还必须移除
task 中的 actorContextRef 和 context 中的 workItemId。

`begin_translation` 不重复返回顶层 `modelInput`，也不把完整 TaskEnvelope 暴露给 Hosted Agent。它以同一工具的
`deliveryPart` 参数返回按实际序列化字节计算的可读批次：

```text
attemptRef/status/leaseToken/leaseGeneration/leaseExpiresAt
taskBinding{actionAttemptId,operationRef,taskType,workItemId,revisions,documentVersionId,deadline,inputHash,sourceArtifactSha256}
delivery{partIndex,partCount,sourceUnitStartIndex,sourceUnitEndExclusive,sourceUnitCount,modelInputBase?,sourceUnits[]}
```

第 0 批含 `modelInputBase`，后续批省略；SourceUnits 的 index 区间必须连续覆盖 sourceUnitCount。每次 part 读取必须
保持同一 attempt fence、inputHash 与 partCount。包含 text content wrapper 的完整 MCP tool result 按
`JSON.stringify` 后的 UTF-8 bytes 验证不超过 14,000，
不是按固定 unit 数猜测。translation input 中没有 tenant/actor/credential/sessionKey/FileService locator/raw PDF/full
Fleet；无需 shell、Node、解压或本地脚本。

## ResultEnvelope

所有 commit 使用完整 `wiselink.3_1.openclaw_result_envelope.v1`：

```text
schemaVersion
actionAttemptId / operationRef / taskType / workItemId / baseRevision
status / businessOutcome / candidateStatus / modelOutput
outputArtifactRefs / sourceRefs
factsConsidered / missingInputs / conflicts / warnings
modelVersion / promptVersion / skillVersion / toolVersions
runMetrics{durationMs,inputUnits,outputUnits}
contentHash
errorCode / errorDetail
```

成功候选固定：

```text
status=SUCCEEDED
businessOutcome=CANDIDATE_READY
candidateStatus=null
modelOutput=<operation-specific JSON string>
errorCode=null
errorDetail=null
```

`contentHash` 使用与 Task 相同的 canonical SHA-256 算法，对除自身外完整 ResultEnvelope 计算。ResultEnvelope
绑定必须与 Task 的 actionAttemptId/operationRef/taskType/workItemId/baseRevision 精确一致，sourceRefs 必须是
Task artifact allowlist 子集。

当前 task runtime policy 与 result provenance：

```text
runtimePolicy.modelPolicyRef = official-hosted-profile-config
ResultEnvelope.modelVersion = 官方托管 profile/config 本轮选择后的非空、可读实际模型
skillVersion = wiselink-research-and-synthesize@r09.c4
toolVersions.wiselink-openclaw-engineering-assessment = 1.2.0
promptVersion = 当前实际运行非空版本
```

官方 profile 当前可选 `GLM-5.3`，但 Skill 不维护具体模型 allowlist，也不把 task policy ref 冒充实际
`modelVersion`。缺失、空、仅 `fallback`/`unknown` 或只回显 policy ref 的模型 provenance 不能 commit。

## Translation

输入 `wiselink.3_1.translation_task.v0.candidate`：

- frozen `sourceUnits[]`；
- exact versioned `rulePack`；
- Host currentness `taskStartBinding`。

输出 `wiselink.3_1.translation_result.v0.candidate`：

- exact `rulePackId + rulePackVersion`；
- 原样 `taskStartBinding`；
- `candidateUnits[]` 与 source units 数量、顺序、unitKey、SourceRef 集精确一致；
- translated text 和可空 engineerRevision metadata。

Skill 做结构和绑定预检；Host 继续拥有术语、编号、数值、单位、ATA/件号、表格/警示层级和 currentness 的
确定性 ResultGate、actual-byte persist/readback 与 CAS。

## Dynamic N/N

输入仍是 Host 当前 authority-free dynamic seam：

```text
purpose=EVALUATE_DYNAMIC_RULES
callerCorrelationRef
operatorInstruction / subjectContext / jobAidContext
expectedSelfCheck / responseInstruction
```

关键表：`criterionTable`、同 N 的 `resourceTable`、受控 `sourceEvidenceCatalog`。真实历史 fixture 仍为 N=150，
但 runtime N 必须动态读取。

输出：

- 原样 `callerCorrelationRef`；
- `authorityLevel=candidate_only`、`engineeringConclusion=null`；
- 不改变 Host `applicabilityOverall`；
- `ruleResults={columns,rows}`，rows 恰好 N/N、唯一同序；
- `overallSelfCheck`、gap-driven `nextRoundChecklist`、`completionSelfCheck`。

每行 SourceRef 只能来自该 criterion allowlist；FALSE/UNKNOWN/TRUE 语义见 SKILL.md。`SEC-*` 是 Host evidence
candidate ID 时只能原样回显，不能生成 Unified URN 映射。

## Applicability

`begin_applicability_evaluation` 只接收 opaque `applicabilityContextRef + requestId`。Host 返回的专属 modelInput
绑定 current DV/frozen.2、current bilingual、source expressions/refs、飞机号/asOf、窄受控 aircraft/facts 和
runtimePolicy。

模型输出只含：

```text
schemaVersion=wiselink.3_1.applicability_ast_candidate.v1
expressions[{expressionId,sourceRefIds,extractionStatus=extracted,expressionAst}]
```

Skill 从 Host modelInput 组装 `wiselink.3_1.applicability_candidate.v1`；模型不输出 target level/contentRef、Fleet
decision 或 current。Host commit 使用唯一 FleetMasterData + Kleene evaluator，并负责 ResultGate、actual bytes、
CAS/current。Host 已冻结 missing input 时，ResultEnvelope 为 WAITING_INPUT、`modelOutput=null`，missing 原样传播。
该 WAITING_INPUT 只终结 applicability ActionAttempt；INITIAL_ANALYSIS 继续使用 Host 后续 begin 返回的受控输入运行
Dynamic N/N、Job-Aid 与 overall，UNKNOWN 不得改写成 TRUE/FALSE。

## Reader

`query_parsed_package` 返回：

```text
resultCount
results[{unitId,kind,text,sourceRefIds[]}]
```

Reader 命中不是 applicability assignment；只有上面的专用 Host applicability lifecycle 能形成候选。

## Discovery

Discovery 输入只在明确 gap 后构造：

```json
{
  "operation": "DISCOVER_PUBLIC_OEM",
  "provider": "BOEING",
  "query": "737-34-3830 applicability",
  "targetIdentifiers": ["737-34-3830"],
  "maxCandidates": 20
}
```

provider 必须是 `BOEING|AIRBUS|COMAC`；官方域策略由实现内置，调用方不能提交 URL/domain/headers/profile 或
凭据。输出使用 HostedOpenClawDiscoveryResult：provider/query/status/observedAt/candidates/flags/error。

状态保真：

- `COMPLETE`：有官方 direct candidate 且无访问/截断/部分标志；
- `ZERO_RESULT`：完整查询零候选；
- `ZERO_RESULTS_FOR_TARGET_IDENTIFIER`：可有旁相关候选但 direct=0；
- `ACCESS_DENIED`：零候选、accessRestricted=true、有 error；
- `PARTIAL`：partialOnly=true；
- `TRUNCATED`：truncated=true。

Host record 时不接收模型给出的 runtimeAppId/observedAt；Host 派生真实时间和 SearchRun ref。所有 discovery
保持未采纳、非证据。

## Overall

输入：

```text
operation=SYNTHESIZE_OVERALL_CANDIDATE
outputCorrelationRef
baseRuleResult（完整 dynamic N/N 兼容投影）
unifiedSourceContext（同一 frozen.2 + SourceRefs）
adoptedDocumentVersions
engineerReviewContext{revision,artifactSha256,reviewCount,history,effective}
externalDiscoveryResults
selectiveResynthesis（Host 现有选择性重综合摘要）
```

同 criterion 多条 engineer review 必须保留连续 history，effective 为最后一条。它们是受控人工输入，不自动
成为工程事实或批准。

输出必须绑定 input correlation、DocumentVersion/package、dynamic revision/artifact 和 review
revision/artifact，保持：

```text
authorityLevel=candidate_only
externalDiscoveryIsEvidence=false
adopted=false
usableAsEvidence=false
engineeringReviewRequired=true
```

并返回 overallCandidate、findings、missingInputs、applicabilityStatus、provider status 和计数。缺 FleetFacts/
predicates 时 applicability 保持 `UNKNOWN/WAITING_INPUT`，但仍形成初步工程综合候选。飞机身份/机型已知而
AIMS-2 构型数据未接入时，候选必须明确说明条件性未知、需工程师或后续受控数据确认，且不得最终批准或发布。

## INTERACTIVE_REVIEW task

Host task schema：`wiselink.3_1.review_turn_task.v1.c2`。

```text
mode=INTERACTIVE_REVIEW
reviewConversationRef / reviewTurnRef / requestId
actorContextRef（控制面，不送模型）
inputRevision / selectedEvaluationItemId / userMessage
allowedOperations（exact C2 six）
resourceRefs[{sourceRefId,resourceArtifactRef,resourceArtifactSha256,value}]
allowedEvaluationItemIds / allowedAdoptedInputRefs
attachmentRefs=[]
context
executionPolicy{runtimeAppId,profileRef,modelPolicyRef,skillPolicyRef,toolPolicyRef}
```

`get_review_turn_context` 返回不含 actorContextRef 的最小 context 和 resource metadata；模型实际输入再移除
workItemId，只保留本轮必要业务内容。`read_source_refs` 只按 task allowlist 读取 exact values。

## INTERACTIVE_REVIEW candidate

模型输出 schema：`wiselink.3_1.review_turn_candidate.v1.c2`。

```text
mode=INTERACTIVE_REVIEW
reviewConversationRef / reviewTurnRef
responseType / answer
sourceRefs / missingInputs / candidateEvidenceRefs
reviewActionDraft|null
affectedItemIds / warnings
runtime{runtimeAppId=app_17c3zn24kv2,profileRef=wiselink-engineering}
```

允许 responseType：ANSWER、CLARIFYING_QUESTION、SOURCE_LINK、CANDIDATE_EVIDENCE、
REVIEW_ACTION_DRAFT、INPUT_REQUEST、AFFECTED_ITEMS_PREVIEW、TASK_STATUS。C2 不允许 RESYNTHESIS_RESULT。

ReviewActionDraft 字段：

```text
baseRevision
evaluationItemId / proposedStatus
adoptedInputRefs / sourceRefs / assumptions
affectedItemIds / overallImpact
```

baseRevision/item/input/source 必须属于 Task allowlist。主 evaluationItemId 必须出现在 affectedItemIds；candidate
affectedItemIds 与 draft 完全一致。Draft 只被 Host 追加保存，不执行。
