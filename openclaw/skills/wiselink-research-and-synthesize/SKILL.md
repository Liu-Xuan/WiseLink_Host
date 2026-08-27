---
name: wiselink-research-and-synthesize
description: Orchestrate the single official hosted WiseLink engineering profile through the canonical Host MCP for INITIAL_ANALYSIS and INTERACTIVE_REVIEW. Preserve applicability AST extraction, dynamic N/N tri-state semantics, SourceRef/currentness bindings, candidate-only authority, full fenced ResultEnvelope commits, and exact hosted provenance. Fail closed for missing attachment, search, compare, reevaluation, or resynthesis tools.
---

# WiseLink R09 工程分析与交互复核

本 Skill 是同名能力从历史 `d3ce25f` 迁移后的 R09 版本，不是第二套 Skill。

固定运行身份：

- hosted app：`app_17c3zn24kv2`
- logical profile：`wiselink-engineering`
- model policy：`GLM-5.1`
- Skill：`wiselink-research-and-synthesize@r09.c4`
- Host MCP：`wiselink-openclaw-engineering-assessment@1.2.0`（exact 20 tools）
- Host baseline：`df4bd1a5c0698c5fd56912fba1329a9283d990c6`

上述值是执行合同，不是允许模型自报的标签。每次执行必须从托管运行时取得实际
`modelVersion`、`promptVersion`、`skillVersion` 和 `toolVersions`，由 validator 校验后写入完整
ResultEnvelope。任何值缺失、fallback 不可见或与固定策略不符，都停止 commit。

## 不变边界

- 妙搭是业务入口；Host 是 actor/ACL、业务对象、FileService、revision、current、CAS、实际字节和产物真源。
- OpenClaw 只生成 `candidate_only`。不得批准、发布、执行 ReviewAction、修改 WorkItem revision、切换
  current 或标记 STALE。
- 不把 actor、tenant、ACL、credential、OAuth/session cookie、FileService bucket/path/locator、原始 PDF、
  完整 Fleet 或其它 WorkItem 内容发送给模型。
- `workItemId` 只用于 INITIAL_ANALYSIS 的 Host MCP 控制面。INTERACTIVE_REVIEW 入口只接收
  `reviewConversationRef` 和 `requestId`；Host 派生其余身份和业务绑定。Host review context 中的
  `workItemId` 在送模型前移除。
- TaskEnvelope 中的 `actorContextRef` 是 Host 控制面引用，不发送给模型，也不视为凭据或 ACL 替代品。
- 不使用本地 OpenClaw/Docker、OpenAI/Codex OAuth、外部 provider、通用 shell、自造 HTTP、普通 app
  OpenAPI 伪造 invoke 或旧 0.11 runtime。
- 本目录脚本是无凭据的编排/validator 模块，不连接 Host、不调用模型、不安装 Skill。历史 ZIP 安装器和
  `archive/internal-lab/phase13-ab.mjs` 均不在本版本运行资产中。

## Mode 1：INITIAL_ANALYSIS

每次只路由一个 Host 授权 operation：

| Operation               | 当前工具路径                                                                                | 状态   |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------ |
| `TRANSLATE`             | `begin_translation` → model → `commit_translation_candidate`                                | 可执行 |
| `EXTRACT_APPLICABILITY` | `begin_applicability_evaluation` → AST model → `commit_applicability_candidate`             | 可执行 |
| `EVALUATE_JOBAID`       | `begin_dynamic_evaluation` → model → `commit_dynamic_evaluation_candidate`                  | 可执行 |
| `SYNTHESIZE_OVERALL`    | `begin_overall_synthesis` / `resume_overall_synthesis` → model → `commit_overall_candidate` | 可执行 |

`EXTRACT_APPLICABILITY` 只能走专用 applicability begin/commit；禁止把 `EVALUATE_JOBAID`、Reader 命中或
overall 中的文字解释成适用性结果。

### 通用 begin / commit

1. `get_parse_status({workItemId})` fresh-read 当前状态。
2. 调对应 `begin_*`。校验 TaskEnvelope 的 schema、`inputHash`、taskType、operationRef、actual artifact
   ref/SHA、baseRevision 和 deadline。
3. 若 status 为 `COMMITTING`，只调用一次 `get_action_attempt_status`，校验 Host 已持久化
   `recoveryResult.contentHash == resultContentHash` 后返回；不调用模型、不再次 commit。
4. 若 status 为 `RUNNING`，只把 authority-free `modelInput` 交给托管模型。
5. 模型执行必须返回 `{output, provenance}`；provenance 必须是实际读数并通过固定版本 validator。
6. 先验证 operation input/output pair，再构造完整
   `wiselink.3_1.openclaw_result_envelope.v1`。commit 参数精确为：

```json
{
  "attemptRef": "AQ-opaque",
  "leaseToken": "host-issued-uuid",
  "leaseGeneration": 1,
  "result": { "schemaVersion": "wiselink.3_1.openclaw_result_envelope.v1" }
}
```

7. commit 后 fresh-read `get_parse_status`。Host 才负责 ResultGate、实际字节 persist/readback 和 WorkItem
   CAS；Skill 不声称这些步骤由模型完成。
8. commit 响应未知时只调用一次 `get_action_attempt_status`。仅当同一 attempt 的
   `resultContentHash` 与本次 sealed ResultEnvelope `contentHash` 精确一致时返回只读恢复；否则 outcome unknown，
   绝不 blind retry。

### Translation

- 输入/输出分别使用 Host 当前
  `wiselink.3_1.translation_task.v0.candidate` 与
  `wiselink.3_1.translation_result.v0.candidate`。
- `rulePackId + rulePackVersion`、taskStartBinding、unit 数量/顺序、unitKey 与 SourceRef 集必须逐项一致。
- 编号、数值、单位、ATA/件号、表格和警示层级的最终确定性校验由 Host TranslationRuleSet ResultGate
  执行；Skill 不绕过或复制成第二规则真源。

### Dynamic N/N

按 Host `criterionTable` 原顺序处理全部 N 项；N 由当前 CriterionSet 决定，不固定为 150。

- `FALSE`：必须 `NOT_APPLICABLE`，且 sourceRefs/missingInputs 为空、human review=false。
- `UNKNOWN`：仅当 Host 本行存在 `missingPredicateKeys`；必须
  `UNKNOWN/WAITING_INPUT`，原样回显缺口并 human review=true。
- `TRUE`：不得降级为 UNKNOWN/WAITING_INPUT；有本行来源候选时必须保留本行 SourceRef 绑定。
- `sourceRefs` 只可来自本 criterion 的 allowlist，不能跨 criterion、补造或重复。
- `ruleResults.rows` 必须完整 N/N、唯一且同序；`nextRoundChecklist` 只聚合 Host 已声明缺口。
- `authorityLevel=candidate_only`、`engineeringConclusion=null`，不在此步骤产生 overall。
- 完整输出目标小于 28,000 UTF-8 bytes；不能在保持 N/N 与语义的前提下满足时 fail closed。

### Applicability AST + Host evaluator

- 入口只接收 Host opaque `applicabilityContextRef + requestId`；Host 派生 tenant/WorkItem/ACL 并冻结 current
  DocumentVersion、frozen.2 SourceExpressions/SourceRefs、current bilingual SourceUnits、飞机号/asOf 与窄受控
  Fleet facts。
- begin 后只使用 Host `modelInput`；TaskEnvelope 中的 tenant/workItem/lease 等控制面字段不进入模型。
- 模型只返回 `applicability_ast_candidate.v1` 的 `expressionId + sourceRefIds + expressionAst`；不返回
  `applicabilityLevel`、`contentRef`、飞机匹配结论或 current。
- Skill 用 Host modelInput 组装专属 `applicability_candidate.v1`；Host 才负责 target level/contentRef、唯一
  FleetMasterData、Kleene evaluator、ResultGate、实际字节 readback、CAS/current。
- Host 冻结 `hostResolvedMissingInputs` 时不调用模型，只原样提交 WAITING_INPUT；不得补造、删减或改写 missing/
  conflict。
- Applicability 的 WAITING_INPUT 只终结当前 applicability ActionAttempt，不终结整个 INITIAL_ANALYSIS。保持
  UNKNOWN 后继续 Host 授权的 Dynamic N/N、Job-Aid 与 overall；不得把 UNKNOWN 改成 TRUE/FALSE，也不得用
  dynamic/overall 文字冒充 applicability 结论。

### Reader 与 SourceRef

`query_parsed_package` 当前使用顶层 `resultCount` 与 `results[]`；每条至少含 `unitId`、`kind`、`text`、
`sourceRefIds[]`。Reader/source-bound 命中仅是定位，不是 applicability assignment。

即使出现 `737-8`、`737-9`、`737-8200` 或大量命中，也只有专用 Applicability Host 路径能形成候选；Reader
结果、dynamic 或 overall 文字不能替代它。

### Overall 与 gap-driven discovery

- 先确认 Host 已落账完整 dynamic N/N，再以 `providers=[]` 运行无 discovery overall。
- 输入必须包含同一 frozen.2 package、完整 N/N、当前 adopted DocumentVersions、脱敏 engineer-review
  timeline/effective、Host `selectiveResynthesis` 摘要和 Unified SourceRefs。
- 若飞机身份/机型已知但 AIMS-2 等受控构型事实未接入，仍执行 overall 模型并形成初步工程综合候选；候选必须
  明示构型数据未接入、适用性为条件性 UNKNOWN、需要工程师或后续受控数据确认，且不得形成最终批准或发布。
- 工程师 review 的同 criterion 多次记录由 Host 保留 history，并以最后一条为 effective；Skill 不重写
  ledger 或把 review 自动升级为批准。
- 只在一个明确 gap 需要外部事实时，选择直接相关且已实现的官方 provider；不固定遍历三家 OEM。
- discovery 永远 `adopted=false`、`usableAsEvidence=false`、
  `externalDiscoveryIsEvidence=false`。`ACCESS_DENIED`、`PARTIAL`、`TRUNCATED` 和 zero result 不互换。
- 未采纳 discovery 不改变 EvaluationContext。只有 Host/DM 采纳形成 DocumentVersion 后，新的 overall
  输入才消费它。
- `resume_overall_synthesis` 只恢复既有 RUNNING attempt；不新建 attempt、不重跑 dynamic/discovery。

## Mode 2：INTERACTIVE_REVIEW

当前精确 C2 工具集只有：

```text
begin_review_turn
get_review_turn_context
read_source_refs
get_action_attempt_status
commit_review_turn_candidate
```

正常轮次：

```text
begin_review_turn({reviewConversationRef, requestId})
→ get_review_turn_context({attemptRef})
→ read_source_refs({attemptRef, sourceRefIds}) [仅按本轮明确需要]
→ 托管 GLM-5.1 生成 review_turn_candidate.v1.c2
→ validator + full ResultEnvelope
→ commit_review_turn_candidate({attemptRef, leaseToken, leaseGeneration, result})
```

约束：

- 每轮由 Host fresh-read ReviewConversation、ReviewTurn、current revision、evaluation、bilingual、
  applicability 和 adopted inputs；不能依赖 session memory 判断 current 或权限。
- `allowedOperations` 必须精确是 C2 六项：`GET_WORKITEM_CONTEXT`、`GET_EVALUATION_ITEM`、
  `READ_SOURCE_REFS`、`DRAFT_REVIEW_ACTION`、`PREVIEW_AFFECTED_ITEMS`、`GET_OPERATION_STATUS`。
- candidate 使用的每个 SourceRef 必须属于 Task allowlist，并在本轮实际通过 `read_source_refs` 读取；外层
  ResultEnvelope 绑定其 actual resource artifact ref/SHA。
- 只允许 answer、clarifying question、source link、candidate evidence、ReviewActionDraft candidate、
  affected-items preview 与 task status。所有输出仍为候选。
- Host commit 只追加 assistant candidate、candidateEvidence 和 ReviewActionDraft；不执行 ReviewAction，
  不改 revision/current/STALE。
- attachment、knowledge search、revision compare、affected reevaluation 和 overall resynthesis 当前没有
  C2 工具授权；请求这些能力必须 fail closed，不虚构调用或结果。
- begin/status 为 `COMMITTING` 时只调用 `get_action_attempt_status` 读取 recovery ResultEnvelope；不调用模型、
  不重放 commit。commit 响应未知时也只读 status 一次，不因 status=SUCCEEDED 就猜测 exact candidate 已落账。

Review candidate 精确使用：

```text
schemaVersion = wiselink.3_1.review_turn_candidate.v1.c2
mode = INTERACTIVE_REVIEW
reviewConversationRef / reviewTurnRef = Task exact binding
responseType / answer
sourceRefs / missingInputs / candidateEvidenceRefs
reviewActionDraft | null
affectedItemIds / warnings
runtime = {runtimeAppId, profileRef}
```

ReviewActionDraft 只能引用 Task 中允许的 evaluation items、adopted input refs 和 SourceRefs，且
`baseRevision` 必须等于 Task inputRevision。它不是 ReviewAction。

## ResultEnvelope 与 provenance

所有 commit 一律提交完整 ResultEnvelope；禁止旧 `{attemptRef, output}`。内容包括 task/workItem/baseRevision
绑定、candidate outcome、modelOutput、artifact/source refs、missing/conflict/warning、实际模型/Prompt/Skill/
tool 版本、run metrics、错误字段和 canonical SHA-256 `contentHash`。

当前 validator 强制：

- `modelVersion=GLM-5.1`
- `skillVersion=wiselink-research-and-synthesize@r09.c4`
- `toolVersions.wiselink-openclaw-engineering-assessment=1.2.0`
- `promptVersion` 非空并来自当前运行
- task/result exact binding、SourceRef allowlist 和 canonical hash 一致

这些字段只证明提交数据符合合同。直到官方托管 UAT 逐轮读回实际执行 provenance 且证明 no-fallback，不能把
本地测试、UI 模型显示或自报字符串写成 Hosted runtime 已跑通。

## 本地合同核验

```bash
node scripts/validate-payload.mjs dynamic-rules-input tests/fixtures/dynamic-rules-evaluation-737.input.json
node scripts/validate-payload.mjs applicability-input tests/fixtures/applicability-task.c4.json
node scripts/validate-payload.mjs applicability-ast-candidate tests/fixtures/applicability-ast-candidate.c4.json
node scripts/validate-payload.mjs discovery-output references/discovery-access-denied.example.json
node scripts/validate-payload.mjs synthesis-output references/synthesis-output.example.json
node scripts/validate-payload.mjs review-task tests/fixtures/review-turn-task.c2.json
node --test tests/validation.test.mjs
```

真实托管 UAT 步骤和 non-claims 见
[Hosted UAT runbook](references/hosted-uat-runbook.md)。详细工具/恢复语义见
[Host MCP 编排](references/host-mcp-orchestration.md)，交换字段见
[输入输出](references/input-output.md)。
