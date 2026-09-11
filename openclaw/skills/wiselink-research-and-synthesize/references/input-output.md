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
executionModel?{modelRef,displayName,providerKind,settingsRevision,selectedAt}
deadline / idempotencyKey / inputHash
```

`inputHash` 是对除自身外的 TaskEnvelope 做递归 key-sort canonical JSON 后得到的裸 64 位小写 SHA-256。
TaskEnvelope 是 Host 控制面对象；不能整体发给模型。INITIAL_ANALYSIS 只传 `modelInput`，review 还必须移除
task 中的 actorContextRef 和 context 中的 workItemId。

c24 的可选 executionModel 是非秘密路由元数据，包含在既有 inputHash 中，不进入 modelInput。
Host 在新 ActionAttempt 保留启动时全局默认；已排队、运行或恢复的 ActionAttempt 不重新选模型。
modelRef 必须在官方配置 `agents.defaults.models` 已登记；只通过 Gateway `x-openclaw-model` 使用，
保留原 profile/body/session。旧任务没有该字段时兼容原 profile；字段存在但无效或未登记时明确失败，禁止回退。
Translation 每个 taskBinding 也返回相同的可选 executionModel，仍受每包实际 14,000 bytes 上限约束。

`begin_translation` 不重复返回顶层 `modelInput`，也不把完整 TaskEnvelope 暴露给 Hosted Agent。它以同一工具的
`deliveryPart` 参数返回按实际序列化字节计算的可读批次：

```text
attemptRef/status/leaseToken/leaseGeneration/leaseExpiresAt
recoveryResultContentHash?（仅 COMMITTING）
taskBinding{actionAttemptId,operationRef,taskType,workItemId,revisions,documentVersionId,deadline,inputHash,sourceArtifactSha256}
delivery{partIndex,partCount,sourceUnitStartIndex,sourceUnitEndExclusive,sourceUnitCount,modelInputBase?,sourceUnits[]}
```

第 0 批含 `modelInputBase`，后续批省略；SourceUnits 的 index 区间必须连续覆盖 sourceUnitCount。每次 part 读取必须
保持同一 attempt fence、inputHash 与 partCount。包含 text content wrapper 的完整 MCP tool result 按
`JSON.stringify` 后的 UTF-8 bytes 验证不超过 14,000，
不是按固定 unit 数猜测。translation input 中没有 tenant/actor/credential/sessionKey/FileService locator/raw PDF/full
Fleet；无需 shell、Node、解压或本地脚本。

COMMITTING begin 不重复返回可能较大的完整 `recoveryResult`，只返回其 `contentHash`。编排器随后只读一次
`get_action_attempt_status`，并要求 begin hash、status `resultContentHash` 与 status `recoveryResult.contentHash` 三者一致。

## ResultEnvelope

所有 commit 的逻辑输入都是完整 `wiselink.3_1.openclaw_result_envelope.v1`；Translation 的物理传输先分块再由
Host 组装，其他 operation 仍直接提交：

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
Task.skillPolicyRef = wiselink-research-and-synthesize@r09
ApplicabilityTask.runtimePolicy.skillVersion = wiselink-research-and-synthesize@r09  # v1 历史字段名，语义为兼容线
ResultEnvelope.skillVersion = wiselink-research-and-synthesize@r09.c81       # 实际安装包版本
toolVersions.wiselink-openclaw-engineering-assessment = 1.2.0
promptVersion = 当前实际运行非空版本
```

2026-09-06 读回的原生默认为 `miaoda/minimax-m3`，用户新增已登记路由为 `dli/gpt-5.6-sol`；
此处是配置事实，不是生成健康保证。新任务按 Host executionModel 使用已登记模型，也不把 task policy ref
冒充实际 `modelVersion`。旧无绑定任务从唯一 profile 的 `agents.list[].model` 解析 string 或 `{primary,fallbacks}`；未显式配置时才使用
同形状的 `agents.defaults.model`，并要求 fallbacks 为空。响应有可读实际模型时优先使用响应值；响应缺失或不可读时
绑定任务记录 `configured-route:<modelRef>`，旧任务使用该 configured endpoint，均只作为可证明路由标识，
不得解释为服务商已回报下游具体型号。重复 agent、不可读 primary、fallbacks 非数组或非空均 fail closed。

### Translation ResultEnvelope 分块传输

sealed ResultEnvelope 先写入本轮本地 `commit-payload.json`。Skill helper 解析 direct ResultEnvelope 或旧
`{attemptRef,leaseToken,leaseGeneration,result}` wrapper；wrapper fence 必须与 begin 精确一致。helper 对 ResultEnvelope
做 canonical JSON UTF-8 序列化，以 6144 原始 bytes 分块并 Base64；每个
`commit_translation_candidate(phase=UPLOAD_PART)` arguments 必须小于 12,000 UTF-8 bytes，partCount 为 1–64。

Host receipt 精确为：

```text
schemaVersion=wiselink.3_1.translation_result_part_receipt.v1
attemptRef/resultContentHash/partIndex/partCount
sha256/byteLength/replayed
```

同一 attempt、lease generation、resultContentHash、partCount、partIndex 的相同 actual bytes 重放返回
`replayed=true`；不同 bytes fail closed。上传阶段不调用 ResultGate、不产生 candidate、不改变 WorkItem/current。

收齐全部 receipt 后，同一工具使用
`phase=FINALIZE + resultContentHash + partCount + parts[{partIndex,sha256,byteLength}]`。Host 接受 receipt 乱序但要求
排序后索引完整且唯一，从 FileService readback actual bytes 后组装并验证 UTF-8/JSON/contentHash，再把完整对象交给
原有 ResultEnvelope preflight、TranslationRuleSet ResultGate、final artifact actual-byte readback 和 CAS。缺 part 在
prepareCommit 前明确失败。

## Translation v2

输入以 `wiselink.3_1.translation_task.v2` 明确区分，运行协议见 [语义块翻译](semantic-translation-work.md)。工作批次使用 `translation_semantic_batch.v2`；最终结果使用 `translation_final_result.v2`，只含 Host 产物引用、manifest 和完成范围。原文片段与新阅读段落分别保留，不转换成旧 candidateUnits。下述内容仅适用于旧任务。

## 历史 Translation v0/v1

输入 `wiselink.3_1.translation_task.v0.candidate`：

- frozen `sourceUnits[]`；
- exact versioned `rulePack`；
- Host currentness `taskStartBinding`。

输出 `wiselink.3_1.translation_result.v0.candidate`：

- exact `rulePackId + rulePackVersion`；
- 原样 `taskStartBinding`；
- `candidateUnits[]` 与 source units 数量、顺序、unitKey、SourceRef 集精确一致；
- translated text 和可空 engineerRevision metadata。

c25 模型侧只输出紧凑的 index/text，驱动从完整原输入还原上述字段。全文与术语上下文在同一原生 session
保留；首次请求附加输出窗口，后续只传新 tool exchange 与下一窗口，不把完整输入改成片段。窗口按最多 96
个单元、约 6000 原文字符安排，在完整单元边界结束，不依赖模型自行预判 length 截断；单个长单元不会被切开。
这些数字是保守工作预算而非实际 token 容量。仍接受更短的有效连续前缀，并从已收齐位置继续；所有单元收齐、
完整 pair 校验通过后才形成唯一候选，不保存部分完成结果。安全 output-shape 额外记录窗口位置与字符数，
不记录原文或私有推理。既有 Task/Result/MCP 形状、来源和提交边界不变。

c26 的模型工具 schema 明确给出 `translatedUnits:[{index:integer,text:string}]`，按本次窗口约束索引和数量。
驱动同时识别旧二元数组，以及实际 M3 的 `translatedUnits:{item:[{index:"0",text:...}]}` 包装；规范十进制
字符串索引可无损转为安全整数。只允许这些精确形态，保留全部文本字节、顺序和来源；不修复不完整 JSON，
不接受额外字段或模糊索引。安全观察记录格式/条数/首尾索引，错误不再只能依靠计数码猜测；完整 Host 输出仍由原绑定器生成。

c27 修复已实测的 Gateway 附带说明文本与函数参数共存：只消费一个合法函数的严格 JSON 参数，纯文本说明不
解析为结果、不进入候选或证据、不由驱动转发；仅记录安全形态。初始输出观察复用已有通道/类型/长度/计数观察，
不保存原始 content/arguments。单响应的其他 operation 仍保持八分钟默认预算。没有超时重放或 provider fallback。

c32 根据实跑 437 单元 DLI 在 20 分钟时仅完成 275 单元的证据，将全文生成/纠正总预算设为 45 分钟
（可显式缩短），单响应最多 15 分钟。每轮请求前经确定性适配器续租原 Host attempt，续租失败即停止；
模型输入不含租约。原 30 分钟 lease 与 60 分钟 attempt deadline 不变，唯一原生 cron 配置为 60 分钟 timeout。
超时分别报告 INITIAL_MODEL_TIMEOUT 或 INITIAL_MODEL_RESPONSE_TIMEOUT；不重放已开始或失败的模型步骤。

c33 的 Initial/Review Gateway 传输使用无额外依赖的 Node HTTP/HTTPS 单次连接；已有 AbortSignal 覆盖
等待响应头及正文的全过程，避免内置 fetch 另行施加 300 秒响应头上限。接收正文时即执行 4 MiB 上限，
拒绝连接中断和超量响应，不跟随重定向、不重试请求，不改全局超时或 dispatcher。Review 到期明确报告
REVIEW_MODEL_TIMEOUT。既有端点、凭据、模型、原生 session 和候选解析合同不变；HTTPS 使用默认 TLS 校验。

c31 对绑定 `miaoda/minimax-m3` 的翻译请求显式设置 `max_completion_tokens=32000`，
用于修复已实测的默认 16000 输出额度耗尽；`model.output-shape` 记录请求额度以便和实际 usage 核对。
全文输入继续沿用 c29，c30 的输入精简暂缓；该参数不修改全局配置、其他模型或 Review 请求。
Gateway 会将请求额度夹到模型条目的 `maxTokens`，运行前须核实该配置已允许请求值。

c28 在当前窗口内按具体 findings 要求原模型重新输出失败索引，最多两次，原全文会话与总时间预算不变；
纠正返回必须与请求索引一一匹配，其他单元保留，驱动不自动改写文本。中文紧邻数字纳入识别，完整无歧义日期
按同一日历值比较，连写标识仍逐字保留，ATA 只识别显式章节引用。真实漏译、串译和数值/日期变化仍拒绝。

Skill 做结构和绑定预检，并在封印/分块提交前依据同一 Host-frozen rulePack 镜像数字/日期/标识 occurrence
multiset 与 ATA token 逐字保真检查；纠正耗尽后的失败诊断包含 `unitKey`。Host 继续拥有术语、编号、
数值、单位、ATA/件号、表格/警示层级和 currentness 的最终确定性 ResultGate、actual-byte persist/readback
与 CAS。

## Dynamic N/N

输入仍是 Host 当前 authority-free dynamic seam：

```text
purpose=EVALUATE_DYNAMIC_RULES
callerCorrelationRef
operatorInstruction / subjectContext / jobAidContext
commonContext?（评估前共享背景，兼容旧输入）
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
runtimePolicy，并包含本 attempt 唯一合法的 `astVocabulary`（属性、operator、qualifier、value shape、节点与
集合上限）。模型不得根据自然语言猜操作符；数值区间只能按词表使用 `range:{min,max}`，集合使用 `in:[...]`。
飞机号/asOf 是 Host 冻结的评估目标，不是人工适用性确认；初始分析可使用 Host 自动冻结目标。词表可覆盖飞机身份、
MSN/line/variable number、部件或软件 P/N/S/N、设备号/FIN、软件版本、改装与修理状态，但模型只能使用本 attempt
实际发布的属性与 controlledFacts；缺少事实时保持 UNKNOWN/WAITING_INPUT。

模型输出只含：

```text
schemaVersion=wiselink.3_1.applicability_ast_candidate.v1
expressions[{expressionId,sourceRefIds,extractionStatus=extracted,expressionAst}]
```

Skill 从 Host modelInput 组装 `wiselink.3_1.applicability_candidate.v1`；模型不输出 target level/contentRef、Fleet
decision 或 current。Host commit 使用唯一 FleetMasterData + Kleene evaluator，并负责 ResultGate、actual bytes、
CAS/current。Applicability 必须通过 `runApplicabilityEvaluation` 组装 ResultEnvelope；`factsConsidered` 精确取
`controlledFacts[].factId`，业务拒绝不得重复 commit。Host 已冻结 missing input 时，ResultEnvelope 为
WAITING_INPUT、`modelOutput=null`，missing 原样传播。
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

## Configuration-evidence P0B status

`get_parse_status` 可选返回唯一脱敏字段
`configurationEvidenceReevaluation`：

```text
schemaVersion=wiselink.3_1.configuration_evidence_reevaluation_status.v1
triggerSnapshotId
triggerConfigurationRevision
mode=FULL_APPLICABILITY_JOB_AID_OVERALL
status=REQUIRED|RUNNING|WAITING_INPUT|FAILED|CONFLICT|SUCCEEDED
nextStage=APPLICABILITY|JOB_AID|OVERALL|null
stages{
  applicability{status,retryNo}
  jobAid{status,retryNo}
  overall{status,retryNo}
}
servingCurrentPreserved
candidateOnly=true
```

阶段 status 可为 `PENDING|RUNNING|COMMITTING|SUCCEEDED|WAITING_INPUT|FAILED|CONFLICT`。
`COMMITTING` 为前向兼容读值；Host 当前可仅公开其余状态。非 `SUCCEEDED` 时
`servingCurrentPreserved` 必须为 true。此投影不包含 staged bundle、actor/tenant、lease、凭据或
FileService 位置。Skill 只用它选择/恢复下一阶段，不用 serving current 反推阶段。旧 Host
缺少该字段时，仅 P0B 协调入口 fail closed，既有单 operation 不受影响。

## Overall

输入：

```text
operation=SYNTHESIZE_OVERALL_CANDIDATE
outputCorrelationRef
applicabilityResult（Host 当前适用性候选；含 source/result binding 与 APPLICABLE/NOT_APPLICABLE/UNKNOWN，缺失为 null）
baseRuleResult（完整 dynamic N/N 兼容投影）
unifiedSourceContext（同一 frozen.2 + SourceRefs）
adoptedDocumentVersions
engineerReviewContext{revision,artifactSha256,reviewCount,history,effective}
externalDiscoveryResults
selectiveResynthesis（Host 现有选择性重综合摘要）
commonContext?（文件章节、关联背景、普通讨论；不替代 current 来源和正式采用记录）
evidenceRegistry?（新任务：仅模型可见的证据元数据、实读文字和 evidenceRef，不含 Host 身份/存储绑定）
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

并返回 overallCandidate、engineeringSummary、findings、missingInputs、applicabilityStatus、provider status 和
计数。有 evidenceRegistry 的新任务使用 engineeringSummary v2：headline、listBrief、lead、claims、decisiveClaimIds；
overallCandidate 精确等于 lead。每条 claim 具有 claimId、text、SOURCE_FACT/CONDITIONAL_INFERENCE 和全部
premises[{evidenceRef,role,explanation,limitation}]。role 为 SUPPORTS/LIMITS/CONTEXT/CONFLICTS；只能引用本轮
registry。关联材料可独立支持判断，前提保留自己的真实载体身份；条件、否定和冲突用 decisiveClaimIds 保持可见。
没有 registry 的历史任务保留 v1 字段。v2 不强制实施决定或固定动作数量。`applicabilityStatus` 必须与 Host
`applicabilityResult` 一致；Host 已求值为 APPLICABLE/NOT_APPLICABLE 时不得改回人工复核或 UNKNOWN。缺当前
候选或其 decision=UNKNOWN 时 applicability 保持 `UNKNOWN/WAITING_INPUT`，但仍形成初步工程综合候选；只列当前来源条件实际要求的缺失事实，不从其它文档带入
设备、软件或构型名称，不得最终批准或发布。

## INTERACTIVE_REVIEW task

c34 新增 `wiselink.3_1.review_turn_task.v1.c4`，toolPolicyRef 为
`wiselink-openclaw-engineering-assessment@1.2.0#interactive-matter-review-c4`。新增必需 `matterContext` 封存
Host 的 scope、title、workingState、readingEvidence、evidenceSources；其全部私有绑定都不转发模型。
模型只接收 context.matterWorking 的 title、workingRevision、membershipRevisionRef、targetClaimId、currentResult、
focus、openQuestions、reviewConditions、inputs、evidenceCatalog。输入别名 matter-input:N，读来源别名
matter-source:N:N；DOCUMENT_PASSAGE providedText=null，必须调用读工具取得原文。非文档前提只有 Host 已提供
providedText 才可使用。Host 仍返回相同 c2 context response envelope，因此 MCP 工具参数不变。

对应 candidate 为 `wiselink.3_1.review_turn_candidate.v1.c4`，原字段保留并增加必需 matterWorkingDelta：

```text
null | {
  updateKind: INITIAL_SYNTHESIS | CORRECTION | MATERIAL_INCORPORATION,
  changeSummary,
  nextFocus: {question,targetRefs} | null,
  claimDelta: {changedBecause,additions,replacements,retirements,explicitlyUnchangedClaimIds} | null,
  readingPresentation: {headline,listBrief,lead,decisiveClaimIds} | null,
  openQuestionDelta: {upserts,retirements,explicitlyUnchangedItemIds} | null,
  reviewConditionDelta: {upserts,retirements,explicitlyUnchangedItemIds} | null,
  coverageUpdates: [{inputRef,checkedSourceRefIds,checkedScope,contribution,reason}]
}
```

c4 的 reviewActionDraft 必须 null，affectedItemIds 必须 []；普通解释 delta=null。claimDelta 和
readingPresentation 同时存在或同时 null。Host 用原文身份替换 task-local checked keys，按实际读记录核对范围，
并在 COMMITTING 后同事务保存候选与事项工作版本。解释不推进版本；过时输入返回 BASIS_CHANGED 回执，不覆盖结果。
覆盖记录按输入替换；新结果使用的全部文档前提必须在该输入的已核查范围内，保持的 claim 也适用。
驱动提交前核对 SUBSTANTIVE 输入、文档身份及每个已引用片段，并把拒绝交给已有模型修订回合；实读记录不能替代
模型对检查范围的准确声明。MCP 错误只保留脱敏错误码，commit.error.json 不构成重放或正式采用的授权。
required 工作内容不能来自私有 matterContext；外层 ResultEnvelope provenance 包含答复、变化 claim 和 coverage
真正使用的 artifact ref/SHA。下面原 c2/c3 合同保持历史兼容。

Host task schema：`wiselink.3_1.review_turn_task.v1.c2`。

```text
mode=INTERACTIVE_REVIEW
reviewConversationRef / reviewTurnRef / requestId
actorContextRef（控制面，不送模型）
inputRevision / selectedEvaluationItemId / userMessage
allowedOperations（exact six）
resourceRefs[{sourceRefId,resourceArtifactRef,resourceArtifactSha256,value}]
allowedEvaluationItemIds / allowedAdoptedInputRefs
attachmentRefs[]（非空唯一字符串，且 attachmentRefs ⊆ resourceRefs.sourceRefId）
context（`evaluation.gapLedger` 为 Host 派生只读投影，包含 gapRef、missingInputId、影响项、
materiality/queryability/resolutionStatus 与 candidate-only authority）
executionPolicy{runtimeAppId,profileRef,modelPolicyRef,skillPolicyRef,toolPolicyRef}
```

`get_review_turn_context` 返回不含 actorContextRef 的最小 context 和 resource metadata；模型实际输入再移除
workItemId，只保留本轮必要业务内容。无附件时 `attachmentRefs=[]`，保持既有路径兼容。Host 已对当前
ReviewTurn 完成 DM/DV/FileService actual-byte 绑定与解析时，可把对应 opaque attachment ref 同时放入
`attachmentRefs` 和 `resourceRefs.sourceRefId`；Skill 先校验唯一性与子集关系，再只通过
`read_source_refs({attemptRef,sourceRefIds})` 读取其 `ENGINEER_ATTACHMENT` parsed value。模型只看到 opaque ref、
文件显示 metadata 与解析页内容，不接触 raw FileService locator/bytes、actor、tenant 或 sessionKey；Task 中的
resource artifact ref/SHA 也不进入模型输入。
`begin_review_turn` 可额外返回控制面 `nativeSessionKey`，形如
`agent:wiselink-engineering:review:<Host actorContextRef>`。c22 核对它与 Task 的 profile、actorContextRef 绑定后，
仅作为 Gateway `x-openclaw-session-key` header 使用，不放进模型输入、浏览器 DTO 或用户报告。
Host 在相同 ReviewConversation、revision 和 fresh 授权来源目录下延续上一成功 Turn 的原生讨论；首次、旧任务、
上一轮未成功或材料范围变化时使用现有 Turn 主键派生新引用。requestId 仍标识独立请求和 checkpoint；只有旧 Host
未提供该字段时使用既有 request 派生的隔离 session，并明确报告 `TURN_ISOLATED_LEGACY_HOST`。
新 Host 配旧 Skill 仍逐轮隔离；新 Skill 配旧 Host 也保持原路径。两侧升级后才启用该增量，Task/Result schema、
MCP 入参、认证和候选提交语义不变。

## INTERACTIVE_REVIEW candidate

模型输出 schema：`wiselink.3_1.review_turn_candidate.v1.c3`。

当前 Gateway transport 不依赖 `response_format`。c21 声明两个 client function：
`read_wiselink_review_sources({sourceRefIds})` 只委托驱动读取本轮已授权来源；
`return_wiselink_review_candidate` 仍是无实现、不执行的最终序列化通道。
Matter Review 使用 `{candidateJson: "<完整候选 JSON>"}` 参数承载嵌套数组和 null；此字符串只允许严格 JSON 对象，
解析后继续使用同一 c4 候选及来源校验。此传输形式不适用于纯文本回答，不改写模型内容或自动补齐字段。
`readingPresentation.headline/listBrief/lead` 各为一个非空字符串，`decisiveClaimIds` 才是 claimId 字符串数组。
listBrief 是供列表行显示的短文本，不能按字段名误解为项目数组。
c39 在提交前以现有完整候选与实际来源校验检查 Matter 输出。模型需要纠正时，驱动向同一原生工具会话返回
`candidateAccepted=false`、安全 `validationError` 和仅包含本轮已读/已提供依据的 `availableEvidenceRefs`；
最多两次纠正，共享原总时限，每次模型请求照常续租与重新授权。模型重新输出，驱动不改写或自动补齐候选。
安全拒绝记录写入私有 `candidate-rejection-N.json`（modelRound/correctionNo/errorCode 与绑定摘要），不作业务
结果或来源证明。未知错误、预算耗尽及租约失效停止；通过全部校验后仍只有一次 Host commit。
CHAT/Matter 使用 `tool_choice=required`，JobAid c5 使用 `auto`；均为 `parallel_tool_calls=false`、`n=1`。每次响应只有一个 choice 和一个上述 function call，
arguments 为 strict JSON object。assistant content 可为 null、空白或官方 Gateway 附带的纯文本说明；只有工具参数
被消费，附带文本不解析、不进入候选/证据或驱动的后续 exchange。其它函数、多个调用、纯文本结果、非文本
content、analysis/reasoning 与参数中的包裹文本仍拒绝。
同轮读取循环只传新增 tool exchange；实际读取批次随 model.result 保存，以便恢复原已读集合而不重跑模型。
明确选择 M3 时，初始分析与每轮 Review 请求申请 `max_completion_tokens=524288`，按用户要求采用
[官方最大输出额度](https://platform.minimax.io/docs/api-reference/text-chat-openai)；完整输入、原生会话和总操作时限保持。
output-shape 的可选 `requestedMaxCompletionTokens` 只记录申请额度，不能当成实际 token 用量或网关生效证明。

驱动在业务 strict parse 前先写 `model.output-shape.json` v2：只含 input argsHash、provider/model、HTTP/finish、
choice/tool-call 数量、assistant content 类型/长度/空白状态与 SHA、function 名称匹配、arguments 类型/长度、raw JSON
parse 分类、接受状态与 SHA；不含原始 content 或 arguments。该 checkpoint 在私有 `0700` 目录中以 `0600` 原子
write-once 保存，不参与 replay 或业务状态判定。
合法工具参数附带非空说明时，既有 `outputChannel` 记录 `FUNCTION_ARGUMENTS_WITH_COMMENTARY`；历史
`FUNCTION_ARGUMENTS` / `REJECTED` 仍可读，业务 Task/ResultEnvelope 不增加字段。

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
REVIEW_ACTION_DRAFT、INPUT_REQUEST、AFFECTED_ITEMS_PREVIEW、TASK_STATUS。C3 不允许 RESYNTHESIS_RESULT。

ReviewActionDraft 字段：

```text
baseRevision
evaluationItemId / proposedStatus
resolvedGapRefs
adoptedInputRefs / sourceRefs / assumptions
affectedItemIds / overallImpact
uncertaintyDispositions[]
decisionSnapshot
```

baseRevision/item/input/source 必须属于 Task allowlist。主 evaluationItemId 必须出现在 affectedItemIds；candidate
affectedItemIds 与 draft 完全一致。`resolvedGapRefs=[]` 表示本 Draft 不关闭缺口；非空时只能引用 current
`gapLedger` 中 `REVIEW_QUERYABLE` 且未完全关闭的 Gap，affectedItemIds 必须等于 Host 影响项并集，并采用本轮
工程师文本或附件证据。Draft 只被 Host 追加保存，不执行；工程师显式确认时 Host 重新 fresh-read Gap Ledger，
由 Gap 派生 resolvedMissingInputs，模型不得直接提交缺失输入键或自行关闭 Gap。

`uncertaintyDispositions[]` 每项包含 `gapRef/disposition/rationale/assumptions/controlsAndMitigations/
evidenceRefs/reviewBy/reopenTriggers`。`decisionSnapshot` 包含评估时点、证据边界、当前最佳与备选判断、
成熟度、决定性事实、假设、剩余未知及其处置、控制/监控、有效期/复核日、重开与结论改变条件，并保持
`candidateOnly=true`。只有所有 P0/P1 未知均有受控处置时可标记 `CONFIRMABLE`；remaining unknowns 可继续存在。

JobAid c5 模型函数只要求 answer；未提出条目的 sourceRefs、missingInputs、candidateEvidenceRefs、warnings 可省略，驱动表达为 []，不替换实际提供的任何值。完整 Host 候选仍包含这些字段并执行原校验。工作增量 retiredIssues 可按 Host 既有语义省略；unchangedIssueKeys 省略时仍要求更新与退役集合覆盖所有旧问题，不默认为自动保留。

显式 `context.purpose=UPDATE_ASSESSMENT` 必须返回非空 `jobAidWorkingDelta` 或 `matterWorkingDelta`，将相关讨论实际写入候选工作更新并保留未知项。仅在 answer 中描述“已更新”不构成更新；Host 与驱动均拒绝缺少增量的成功候选。普通复核答复的无增量语义不变。

JobAid 显式更新若返回引用本轮未读来源的候选，驱动可按该候选的来源声明，通过现有 Host 读取回调取得最多 100 个本轮授权片段，作为拒绝反馈交给模型重新核对和提交。包含越界引用时整批不读；读取失败或回读不完整时停止。读取不代表接受旧候选，不改写模型内容，不放宽最终来源校验，仍使用同一回合、租约、期限与最多两次纠正。
