# 官方托管 R09 c4 UAT runbook

本 runbook 只定义 Host C4+C5 accepted 后的真实验证顺序；本地实现不执行安装、发布、Session 创建、模型调用或
云配置修改。

## 前置读回

必须从妙搭官方托管 UI/官方能力读回并记录：

1. app 精确为 `app_17c3zn24kv2`；
2. 唯一逻辑 profile 为 `wiselink-engineering`；
3. 模型由官方托管 profile/config 选择，当前 UI 可选 `GLM-5.3`；每个 turn 必须读回非空、可识别的实际
   `modelVersion`，智能选择/fallback 只有在实际模型仍逐 turn 可见时才可继续；
4. 同名 Skill 只有一个，安装版本精确
   `wiselink-research-and-synthesize@r09.c4`；
5. Host MCP package/version 为
   `wiselink-openclaw-engineering-assessment@1.2.0`，exact 20 tools 可见；
6. C2 successor 已进入 current Hosted release；只凭 Git commit 不等于 deployed readback；
7. 凭据已轮换，托管日志/trace 不回显 Bearer、cookie、token、API key 或 FileService locator。

任一项无法读回则停止，不猜 app/spring 映射，不用普通 app OpenAPI 伪造 invoke。

## INITIAL_ANALYSIS UAT

选择一个 owner-bound、actual DocumentVersion/frozen.2 已准备的非生产 WorkItem。

### Positive：TRANSLATE

1. Host 创建 INITIAL_ANALYSIS Session/ActionAttempt；记录 Session key 的 Host-side binding，但不暴露 tenant/actor。
2. 观察 `begin_translation` 逐批返回可读结构化 SourceUnits；第 0 批含 modelInputBase，后续批按连续 index 覆盖
   全部 SourceUnits。每个完整 MCP tool result 不超过 14,000 UTF-8 bytes，attempt fence/inputHash/partCount 稳定，
   输出中没有第二份 modelInput、tenant 或 FileService locator。
3. 模型前 heartbeat；执行一次托管 profile 当前选定模型；模型返回后再 heartbeat，并记录实际
   model/prompt/Skill/tool versions 和 run metrics。模型生成期间不要求短周期回调。
4. 验证 translation pair 与完整 ResultEnvelope，写入本轮 `commit-payload.json`；用同一
   `commit_translation_candidate` 上传 6144-byte raw parts（每次 arguments <12,000 UTF-8 bytes），再用 receipts
   调 `FINALIZE`。不得把完整 JSON 手工放入单次模型工具参数。
5. 核对所有 UPLOAD_PART 期间 WorkItem revision/current/candidate 均不变；FINALIZE 后 Host 只增加一次 revision、
   只产生一个 bilingual artifact，并读回完整 unit 数、rule-set validation、candidate-only projection 与同一
   DocumentVersion/currentness。

### Positive：EVALUATE_JOBAID

1. fresh-read 后 begin dynamic；确认 N 来自当前 CriterionSet。
2. 逐项核对至少一个 FALSE、一个 Host-missing UNKNOWN、一个 source-bound TRUE。
3. validator 确认 N/N、同序唯一、criterion-local SourceRefs、gap checklist、28KB transport target。
4. 单次 full ResultEnvelope commit；Host 读回 actual bytes、N/N projection 与 current revision。

### Positive：EXTRACT_APPLICABILITY

1. 使用 Host 生成的 opaque `applicabilityContextRef + requestId` 调 dedicated begin；核对模型只收到 frozen
   SourceExpressions/SourceRefs、bilingual SourceUnits 与窄受控 aircraft facts。
2. profile 当前选定模型只生成 source-condition AST candidate，不输出 target level/contentRef 或飞机适用结论。
3. 单次 full ResultEnvelope commit；Host 读回 target binding、Fleet/Kleene 结果、actual bytes 与 current
   applicability candidate。
4. 选择一个 Host 缺事实样本，确认零模型调用、missing 原样 WAITING_INPUT。
5. 确认该 WAITING_INPUT 不终止 INITIAL_ANALYSIS，随后 Dynamic N/N、Job-Aid 与 overall 仍实际执行。

### Positive：SYNTHESIZE_OVERALL

1. fresh-read dynamic N/N 已持久；先 `providers=[]`。
2. overall input 绑定 frozen.2、完整 N/N、adopted DVs、review history/effective、Host
   `selectiveResynthesis` 和 SourceRefs。
3. 输出保持 candidate-only、external discovery non-evidence；当前文档适用性所需构型事实未接入时，仍给出
   source-bound 初步工程综合，只列本资料实际需要的事实，并明确条件性 UNKNOWN、人工/后续数据确认要求和不可
   最终批准/发布。
4. 单次 commit；Host 读回 actual bytes/current overall r1。

### Required negative

- Task hash、artifact SHA、baseRevision、leaseGeneration 或 SourceRef 任一漂移，Host fail closed。
- commit response unknown：只读一次通用 status，匹配 resultContentHash，不重复 commit。
- COMMITTING：只读一次通用 status 并匹配 recoveryResult/contentHash，不第二次调用模型。
- Translation 任一批缺失、错序、超限或 attempt fence 改变：Agent 在翻译/commit 前停止，不从 session log 恢复
  残缺输入。
- Translation 重复相同 part 返回 `replayed=true` 且不重复写；同 index 冲突 bytes、缺 part receipt、staged actual-byte
  mismatch 在 prepareCommit 前明确失败，WorkItem revision/current 不变。receipt 可乱序提交，Host 按 partIndex
  排序后仍须完整唯一。
- 非 owner/跨 tenant/旧 revision/过期 lease：统一 fail closed，不泄露对象存在性。

## INTERACTIVE_REVIEW UAT

前置：C1 ReviewConversation/Turn API 正向回环已由真实已登录浏览器或官方入口验证；不要用 CLI 管理角色替代
authenticated user。

### Positive：解释 + SourceRef

1. 在同一 active ReviewConversation 新增一条用户 turn，取得 `reviewConversationRef + requestId`。
2. `begin_review_turn`；确认 Host 派生 actor/tenant/WorkItem/session，调用参数中没有这些字段。
3. `get_review_turn_context` fresh-read current；确认 executionPolicy exact C2。
4. 只读取本轮所需 SourceRef；生成 SOURCE_LINK/ANSWER candidate。
5. 检查 ResultEnvelope 实际 provenance 与 SourceRef artifact ref/SHA；单次 commit。
6. Host 读回原 ReviewTurn assistant candidate 和 provenance；WorkItem revision/current/STALE 均未变化。

### Positive：ReviewActionDraft

1. 选择 allowed evaluation item；按需读 exact SourceRefs。
2. 生成 baseRevision=current、items/inputs/refs 全在 allowlist 的 ReviewActionDraft candidate。
3. commit 后只读回 Draft；确认没有 ReviewAction、current 切换或 STALE mutation。

### Required negative

- 错 conversation/request、cross actor/tenant/workItem、closed conversation、旧 revision：not-found/conflict 且零 mutation。
- 未 read 的 SourceRef、越界 item/adopted ref、错误 Skill/tool version、空或不可读实际模型 provenance、非官方
  runtime/profile、hash drift：commit 前或 Host gate 拒绝。
- attachment/search/compare/reevaluate/resynthesize：明确 unsupported，零伪造工具调用。
- COMMITTING：只调用 status，模型调用数 0、commit 数 0。
- commit 响应丢失：status 只读一次，commit 数仍为 1，不把 terminal status 冒充 exact candidate readback。

## 每轮证据

保留脱敏证据：

- Hosted release/Host MCP version、Skill version、profile、Session mode/key hash；
- attemptRef、taskType、input/base revision、Task inputHash；
- tool name/sequence、status、lease generation（不保留 lease token）；
- Result contentHash、candidate type、SourceRef IDs 与 artifact SHA；
- 实际 `modelVersion/promptVersion/skillVersion/toolVersions`；
- mutation summary（candidate persisted 与五个 authority false flags）；
- 日志凭据扫描结果。

不得保存 leaseToken、credential、tenant/actor raw identity、ACL rows、FileService locator、原始 PDF 或完整 Fleet。

## Non-claims

本地 tests/lint/commit 只能证明 Skill 包合同。没有以上真实读回时，不宣称：Skill 已安装/发布、官方 profile 已
使用此版本、20 tools 已在托管 UI 可见、Session create/resume 已跑通、profile 实际选择了哪个模型、fallback
路径是否仍提供可读实际 provenance、Applicability 端到端 Host/Hosted 路径、附件/search/compare/reevaluate/
resynthesize 或端到端 UAT 完成。
