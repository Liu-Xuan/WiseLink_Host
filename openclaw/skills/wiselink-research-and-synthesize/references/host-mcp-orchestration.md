# R09 canonical Host MCP 编排

基线：`00b8febe927b7bbfbdb43ced36863e5188464a76`，ancestry
`3ace17fe49ba0d952a463bf5eb3ce8898a8ed2cc → 688d23063e418a55e8793e77087800b9c2d99084 → 00b8febe`。
Endpoint 仍是 Host 提供的 `POST /openapi/wiselink/openclaw-mcp`；Skill 不自造 HTTP。

## 18 个当前工具

只读：

1. `get_parse_status({workItemId})`
2. `query_parsed_package({workItemId, query})`
3. `get_deep_link({workItemId})`

INITIAL_ANALYSIS：

4. `begin_translation({workItemId})`
5. `commit_translation_candidate({attemptRef, leaseToken, leaseGeneration, result})`
6. `begin_dynamic_evaluation({workItemId})`
7. `commit_dynamic_evaluation_candidate({attemptRef, leaseToken, leaseGeneration, result})`
8. `record_oem_discovery_run({workItemId, result})`
9. `begin_overall_synthesis({workItemId, providers})`
10. `resume_overall_synthesis({attemptRef})`
11. `commit_overall_candidate({attemptRef, leaseToken, leaseGeneration, result})`

INTERACTIVE_REVIEW：

12. `begin_review_turn({reviewConversationRef, requestId})`
13. `get_review_turn_context({attemptRef})`
14. `read_source_refs({attemptRef, sourceRefIds})`
15. `get_action_attempt_status({attemptRef})`
16. `commit_review_turn_candidate({attemptRef, leaseToken, leaseGeneration, result})`

Attempt 控制面：

17. `heartbeat_action_attempt({attemptRef, leaseToken, leaseGeneration})`
18. `cancel_action_attempt({attemptRef, reason})`

本 Skill 的 INTERACTIVE_REVIEW runtime path 精确只使用 12–16。Heartbeat/cancel 不是 review model 工具，
不用于替代五工具会话合同。

## TaskEnvelope 与 lease fence

每个 `begin_*` 返回 `attemptRef`、status、`leaseToken`、`leaseGeneration`、lease expiry 和完整 TaskEnvelope。
`attemptRef` 必须等于 TaskEnvelope `operationRef`。TaskEnvelope 自带：

- Host internal `actionAttemptId` 与 opaque operationRef；
- taskType、WorkItem/baseRevision/DocumentVersion；
- actual artifact `sourceRefs[{ref,sha256}]`；
- authority-free `modelInput`；
- deadline、idempotencyKey、canonical `inputHash`。

Skill 不接收或构造 tenant/actor/ACL。TaskEnvelope 自身是控制面对象，不能整体发给模型。

所有 commit 使用 Host 返回的 exact attemptRef、leaseToken、leaseGeneration 和完整 ResultEnvelope。旧
`{attemptRef, output}` 已废止。

## INITIAL_ANALYSIS

### Translation

```text
get_parse_status
→ begin_translation
→ translation-pair validator
→ full ResultEnvelope
→ commit_translation_candidate
→ get_parse_status + get_deep_link
```

Host commit 才执行 exact TranslationRuleSet deterministic ResultGate、FileService actual bytes readback 与 CAS。
当前 status projection 没有能把 translation commit 精确绑定回 operationRef/correlationRef 的字段；若 commit
响应丢失，只读 status 一次后保持 outcome unknown，禁止自动 retry。

### Applicability blocker

18-tool 包没有 `begin_applicability` / `commit_applicability_candidate` 或等价专用工具。

```text
EXTRACT_APPLICABILITY
→ INITIAL_ANALYSIS_EXTRACT_APPLICABILITY_HOST_MCP_UNAVAILABLE
```

`query_parsed_package`、dynamic 或 overall 都不能代替此 operation。

### Dynamic N/N

```text
get_parse_status
→ begin_dynamic_evaluation
→ dynamic-rules-input + dynamic-rules-pair validator
→ full ResultEnvelope
→ commit_dynamic_evaluation_candidate
→ get_parse_status [+ query_parsed_package] + get_deep_link
```

未知 commit 只读 status 一次。只有同一 WorkItem 的
`baseRules.sourceResultId=openclaw-dynamic://<modelInput.callerCorrelationRef>`、candidate status 和 N/N 完整，
才能认定 commit 已到 Host；否则 outcome unknown。

### Overall

默认无 discovery：

```text
get_parse_status（dynamic N/N 已持久）
→ begin_overall_synthesis(workItemId, [])
→ synthesis-input + synthesis-pair validator
→ full ResultEnvelope
→ commit_overall_candidate
→ get_parse_status + get_deep_link
```

`resume_overall_synthesis` 只接既有 RUNNING attempt 并返回同一 Task/modelInput/lease；它不创建 attempt、
不执行 dynamic/discovery。`COMMITTING` 不走 resume，而走只读 recovery。

未知 overall commit 只有在 status 中读到
`overallSynthesis.sourceResultId=<modelInput.outputCorrelationRef>` 和 candidate-only 边界时才可恢复确认。

### Gap-driven discovery

Discovery 不是 INITIAL_ANALYSIS 前置步骤。只有 dynamic/overall 暴露明确、可陈述且需要外部事实的 gap 时，
才调用当前真正存在并与发布方相关的官方来源能力，再只记录实际执行的 provider。禁止固定遍历三家 OEM。

`record_oem_discovery_run` 响应未知时无精确 readback，所以 outcome unknown、no retry。SearchRun/snippet 永远
不是 evidence；Host/DM 未采纳前不改变 EvaluationContext/current。

## INTERACTIVE_REVIEW C2

入口只有 C1 已持久对象引用：

```text
begin_review_turn({reviewConversationRef, requestId})
```

Host 从 OAuth subject mapping、ReviewConversation/Turn、owner-bound WorkItem 和 current revision 派生 actor、
tenant、WorkItem、session binding 与 opaque actorContextRef。调用方不能提交这些字段。

RUNNING 正常路径：

1. `get_review_turn_context({attemptRef})`；校验 conversation/turn/revision/allowedOperations/executionPolicy 与
   Task 完全一致。
2. 仅对本轮明确需要且属于 Task allowlist 的 IDs 调
   `read_source_refs({attemptRef, sourceRefIds})`；每批 1–100，去重。
3. 模型只能看到移除 workItemId 后的最小 context、用户消息、允许的 operation/item/input/source IDs 和
   executionPolicy；看不到 actorContextRef、tenant、ACL 或 FileService locator。
4. review candidate 只能引用本轮实际 read 的 SourceRefs。其外层 ResultEnvelope sourceRefs 绑定对应 resource
   artifact ref/SHA。
5. 单次 `commit_review_turn_candidate`。成功回执必须显示 candidate persisted，同时五个 authority flag 精确：
   `reviewActionExecuted=false`、`workItemRevisionChanged=false`、`currentChanged=false`、`staleMarked=false`。

COMMITTING：

```text
begin/status = COMMITTING
→ get_action_attempt_status({attemptRef})
→ validate recoveryResult
→ return COMMITTING_RECOVERY_READ_ONLY
```

不调用模型、不重放 commit。commit 响应未知时同样只读 status 一次；即使 status 已 terminal，也不能在缺少
exact result/candidate readback 时猜测落账内容。

## 当前未授权 review operations

附件、knowledge search、revision compare、affected reevaluation、overall resynthesis 在 R09 目标合同中存在，
但 C2 没有对应 MCP 工具，且 Task attachmentRefs 固定为空。因此当前全部 fail closed：

- `ANALYZE_ATTACHMENT`
- `SEARCH_ALLOWED_KNOWLEDGE`
- `COMPARE_REVISIONS`
- `REEVALUATE_AFFECTED`
- `RESYNTHESIZE_OVERALL`

不得把 `read_source_refs`、dynamic 或普通 app OpenAPI 冒充这些能力。
