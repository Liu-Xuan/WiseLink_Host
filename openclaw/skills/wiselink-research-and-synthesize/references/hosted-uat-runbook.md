# 官方托管 C3 UAT runbook

本 runbook 只定义 C2 accepted/deployed 后的真实验证顺序；本地实现不执行安装、发布、Session 创建、模型调用或
云配置修改。

## 前置读回

必须从妙搭官方托管 UI/官方能力读回并记录：

1. app 精确为 `app_17c3zn24kv2`；
2. 唯一逻辑 profile 为 `wiselink-engineering`；
3. 当前实际模型策略为 `GLM-5.1`，智能选择/fallback 关闭或逐 turn 可见；
4. 同名 Skill 只有一个，安装版本精确
   `wiselink-research-and-synthesize@r09.interactive-review.c2`；
5. Host MCP package/version 为
   `wiselink-openclaw-engineering-assessment@1.1.0`，18 tools 可见；
6. C2 successor 已进入 current Hosted release；只凭 Git commit 不等于 deployed readback；
7. 凭据已轮换，托管日志/trace 不回显 Bearer、cookie、token、API key 或 FileService locator。

任一项无法读回则停止，不猜 app/spring 映射，不用普通 app OpenAPI 伪造 invoke。

## INITIAL_ANALYSIS UAT

选择一个 owner-bound、actual DocumentVersion/frozen.2 已准备的非生产 WorkItem。

### Positive：TRANSLATE

1. Host 创建 INITIAL_ANALYSIS Session/ActionAttempt；记录 Session key 的 Host-side binding，但不暴露 tenant/actor。
2. 观察 `begin_translation` 返回 RUNNING、TaskEnvelope exact inputHash/artifact ref+SHA/current revision。
3. 执行一次托管 GLM-5.1，记录实际 model/prompt/Skill/tool versions 和 run metrics。
4. 验证 translation pair 与完整 ResultEnvelope；单次 commit。
5. Host 读回 bilingual actual bytes、rule-set validation、candidate-only projection、same DocumentVersion/currentness。

### Positive：EVALUATE_JOBAID

1. fresh-read 后 begin dynamic；确认 N 来自当前 CriterionSet。
2. 逐项核对至少一个 FALSE、一个 Host-missing UNKNOWN、一个 source-bound TRUE。
3. validator 确认 N/N、同序唯一、criterion-local SourceRefs、gap checklist、28KB transport target。
4. 单次 full ResultEnvelope commit；Host 读回 actual bytes、N/N projection 与 current revision。

### Positive：SYNTHESIZE_OVERALL

1. fresh-read dynamic N/N 已持久；先 `providers=[]`。
2. overall input 绑定 frozen.2、完整 N/N、adopted DVs、review history/effective 和 SourceRefs。
3. 输出保持 candidate-only、external discovery non-evidence、适用性缺事实时 UNKNOWN。
4. 单次 commit；Host 读回 actual bytes/current overall r1。

### Required negative

- `EXTRACT_APPLICABILITY` 返回 exact blocker，且零 dynamic/overall/applicability mutation。
- Task hash、artifact SHA、baseRevision、leaseGeneration 或 SourceRef 任一漂移，Host fail closed。
- commit response unknown：只读一次；不重复 commit。
- COMMITTING：只读 recovery，不第二次调用模型。
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
- 未 read 的 SourceRef、越界 item/adopted ref、错误 Skill/model/tool version、hash drift：commit 前或 Host gate 拒绝。
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
使用此版本、18 tools 已在托管 UI 可见、Session create/resume 已跑通、GLM-5.1 每轮实际执行/no fallback、
EXTRACT_APPLICABILITY、附件/search/compare/reevaluate/resynthesize 或端到端 UAT 完成。
