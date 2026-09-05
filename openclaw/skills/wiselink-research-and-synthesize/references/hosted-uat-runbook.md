# 官方托管 R09 c22 发布与 UAT runbook

c19 新增页面自动领取，先安装兼容 Skill，再发布 Host，最后启用原生 command cron 与页面自动发送；本批具体步骤见 [页面自动领取](hosted-review-consumer.md)。下列历史五工具 UAT 保留给单轮 driver，不把它的手工启动结果当作页面自助闭环。

c20 兼容读取 JobAid / Overall / Review 的可选共同背景，并区分普通工作判断修改与正式采用。仍先安装 Skill，再发布提供新背景的 Host；旧任务、现有 cron 和候选提交入口保持。存储不可读期间只完成安装与代码验证，不重放失败 Turn，不把它们记为页面 UAT。

c21 在相同 C3/MCP/ResultEnvelope 上改为模型按需取证，不增加 Host 工具或业务写入口。
同轮复用原生 session，先发最小上下文与目录，随后仅传新增 tool exchange；跨 Turn 仍隔离。
必须分别记录本地协议测试、安装读回与真实新 Turn 验证，不以安装代替 UAT。

c22 增加 Host 可选控制面会话路由，承接同一授权范围下连续成功 Turn 的原生讨论。两侧保留旧逐轮路径的兼容，
先安装 c22，再发布返回 `nativeSessionKey` 的 Host；不更改 cron、模型配置、C3 输出或正式采用入口。
只有同一真实事项的两个新页面 Turn 均自动返回候选并承接工程师补充，才记为页面跨轮验证通过。

本 runbook 只定义 Host C4+C5 accepted 后的真实验证顺序；本地实现不执行安装、发布、Session 创建、模型调用或
云配置修改。

## Publish Lite（唯一发布路径）

本版本不建立通用 Skill 发布平台。只保留一条可重复、可读回的私有覆盖安装路径：

1. 在干净 Git 提交上运行 `npm run check:openclaw:skill-publish`，确认 Host 与 Skill 的兼容线一致，且 Skill
   validator、`agents/openai.yaml`、runbook 和 fixtures 中的实际包版本声明一致。
2. 运行 `npm run package:openclaw:skill`。脚本必须先通过 Skill 自测，然后只从当前提交的
   `openclaw/skills/wiselink-research-and-synthesize` Git 子树生成单根 ZIP、manifest 和 SHA-256 文件。
   ZIP 条目时间必须固定为源 Git commit 时间，不得使用打包当下的墙上时钟；同一 commit 跨时间构建必须逐字节
   一致。Skill 子树、Host policy 或 Publish Lite 脚本有未提交变更时必须停止，不包装工作区近似内容。
3. 只在用户明确批准发布后，才将该 ZIP 上传到妙搭私有存储。托管端下载后必须重新校验
   manifest 中的字节数、archive SHA-256、唯一根目录、普通文件集合及每文件 SHA-256，不输出签名 URL。
4. 首次迁移先发布一次 Host 兼容策略：`skillCompatibilityRef=wiselink-research-and-synthesize@r09`、
   `minimumCompatibleSkillVersion=r09.c10`。它依然严格校验 Task/Result schema、MCP 1.2.0、app/profile、
   SourceRef 和 CAS，但不再把每个兼容 c 修订与 Host release 绑定。迁移后，本次 c12 及以后不改变合同的
   c 修订可用官方 `openclaw skills install <verified-root> --as wiselink-research-and-synthesize --force`
   独立覆盖唯一同名 Skill。不创建第二份、不绑定模型、不手工修改 installed 文件。
5. 安装后 fresh-read `openclaw skills list/info/check`，复跑 installed tests，并将 installed 递归文件摘要与
   manifest 比较；安装器允许额外的 `.openclaw/source-origin.json` 必须单独报告，不当作 source 包内文件。
6. 只用新 Host Turn/requestId 和 successor attempt 执行 smoke/UAT；后续新 Turn 可按 Host 返回的 key 延续
   本次获授权的原生讨论。历史 attempt、requestId、checkpoint 不得重试、删除或改写。

ZIP 的 SHA-256 只用于证明“私有存储中的实际字节”与“安装时验证的字节”相同；Git 提交无法跨越该
上传/下载边界，因此不能用 Git SHA 替代 archive SHA。该 manifest 不是新的业务 contract、baseline 或 gate。

发布分级固定为：Skill references/prompt/fixture 的兼容改进走 Skill-only；Host 业务逻辑、Connector/config 走 Host-only；
Task/Result schema、MCP tool 形状、authority 或安全语义改变时升级 compatibility ref，走 Host + Skill 协同发布。

## 前置读回

必须从妙搭官方托管 UI/官方能力读回并记录：

1. app 精确为 `app_17c3zn24kv2`；
2. 唯一逻辑 profile 为 `wiselink-engineering`；
3. 模型由官方托管 profile/config 选择，当前 configured provider/model endpoint 为
   `miaoda/miaoda-model-auto`，下游具体模型未暴露；驱动先解析 `agents.list[]` 中当前 profile 的
   string 或 `{primary,fallbacks}` model，未显式配置时才回退 `agents.defaults.model`，并要求 fallbacks 为空。每个 turn
   优先读回非空、可识别的实际 `modelVersion`；响应未提供可读模型时才使用上述唯一 configured endpoint 作为可证明执行标识，不把它解释为未暴露的下游具体模型。重复 agent、
   不可读 primary、fallbacks 非数组或非空均在调用模型前停止；
4. 同名 Skill 只有一个，安装版本精确
   `wiselink-research-and-synthesize@r09.c22`；
5. Host MCP package/version 为
   `wiselink-openclaw-engineering-assessment@1.2.0`，exact 20 tools 可见；
6. C3 successor 已进入 current Hosted release；只凭 Git commit 不等于 deployed readback；
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

## P0B 配置证据全量重算 UAT

1. 在既有 serving Applicability/Job-Aid/Overall 可读的 WorkItem 上采纳一个新配置证据快照。
2. 确认 `get_parse_status` 只暴露脱敏 `configurationEvidenceReevaluation`，不暴露 staged bundle；
   重算未成功前旧 serving current 保持可用。
3. 运行 `runConfigurationEvidenceReevaluation`，核对 exact20 清单没有增加工具，且顺序为
   Applicability → fresh status → Dynamic N/N → fresh status → Overall → fresh status。
4. 在 Applicability 或 Dynamic 已成功后重启协调器，确认从 Host `nextStage` 恢复，已成功阶段的
   begin/model/commit 调用数均为 0。
5. 注入 `WAITING_INPUT`、`FAILED` 和 `CONFLICT`，确认仅 marker/retry 状态前进，旧 serving current
   不变，不自动重放 commit。
6. 仅在三阶段都成功且 Host 重新校验 snapshot/configuration/WorkItem 绑定后，核对一次最终
   CAS 同时替换 serving Applicability、Job-Aid baseRules 和 Overall，marker 为 `SUCCEEDED`。
7. 对不含 P0B 状态的旧 Host，新协调入口必须明确停止，同时原有单 operation UAT 继续通过。

## INTERACTIVE_REVIEW UAT

前置：C1 ReviewConversation/Turn API 正向回环已由真实已登录浏览器或官方入口验证；不要用 CLI 管理角色替代
authenticated user。

### Positive：解释 + SourceRef

1. 在同一 active ReviewConversation 新增一条用户 turn，取得 `reviewConversationRef + requestId`。
2. 先确认官方 OpenClaw 配置已明确启用 `gateway.http.endpoints.chatCompletions`；未启用则在任何 business tool
   之前停止。随后只启动一次 `scripts/run-hosted-review-turn.mjs` 外部驱动；不得让对话模型直接调用五个 Host 工具。
3. 驱动执行一次 `begin_review_turn`；确认 Host 派生 actor/tenant/WorkItem/session，调用参数中没有这些字段。
4. 驱动执行一次 `get_review_turn_context` fresh-read current，并只读取本轮所需 SourceRef；确认模型输入不含
   conversation/turn/request/attempt/lease/WorkItem 控制面值。确认 c22 的会话 key 仅在 Gateway header；连续成功、
   相同版本与材料范围的新 Turn 使用 Host 同一 key，而旧 Host 明确走逐轮隔离路径。新 Turn 不复用旧 checkpoint。
5. 模型经 Gateway HTTP 仅生成 SOURCE_LINK/ANSWER 内容；本用例要求 `SOURCE_LINK` 且至少一个
   `sourceRefs` 来自本轮实读 allowlist，`sourceRefs=[]` 必须在 commit 前 fail closed。c21 请求暴露
   `read_wiselink_review_sources` 与 `return_wiselink_review_candidate`，`tool_choice=auto`、`parallel_tool_calls=false`
   和 `n=1`；前者按需调用现有 Host 读取，后者仅作为最终序列化通道且永不执行。每次响应只有一个 choice 和一个合法 function call，assistant content 为 null 或仅空白，
   arguments 为 direct strict JSON object。其他函数、多 tool call、fence/prose/array/null arguments 或任何 analysis
   均 fail closed，不抽取、不修复、不归一化。
   strict parse 前的 `model.output-shape` v2 0600 write-once checkpoint 只保存 provider/model、HTTP/finish、choice/tool
   call 数量、assistant content 类型/长度/空白状态与 hash、function 名称匹配、arguments 类型/长度/JSON parse 分类与
   hash，不保存原始 content 或 arguments。
6. 驱动检查 ResultEnvelope 实际 provenance 与 SourceRef artifact ref/SHA，并单次 commit。
7. 用同一 checkpoint 目录再次启动驱动，确认 Host/模型远程调用数均不增加。
8. Host 读回原 ReviewTurn assistant candidate 和 provenance；WorkItem revision/current/STALE 均未变化。浏览器必须
   把每个非空 `candidate.sourceRefs` 显示为可点击“原文依据”，点击后进入当前 WorkItem Reader 并定位同一 SourceRef。

### Positive：ReviewActionDraft

1. 先用本轮 Host 已授权附件形成 CandidateEvidence，确认附件与 selected Criterion SourceRef 均被实读，
   且 revision/current/STALE 不变。
2. 工程师在后续自然语言 turn 明确要求采用证据或修改判断；选择 allowed evaluation item，按需读 exact SourceRefs。
3. 生成 baseRevision=current、items/inputs/refs 全在 allowlist，并带 Gap dispositions 与 candidate-only
   Decision Snapshot 的 ReviewActionDraft candidate。
4. commit 后只读回 Draft；确认没有 ReviewAction、current 切换或 STALE mutation，不调用 confirm 接口。

### Required negative

- 错 conversation/request、cross actor/tenant/workItem、closed conversation、旧 revision：not-found/conflict 且零 mutation。
- 未 read 的 SourceRef、越界 item/adopted ref、低于最低版本或跨兼容线的 Skill、错误 tool version、空或不可读实际模型 provenance、非官方
  runtime/profile、hash drift：commit 前或 Host gate 拒绝。
- 未在本轮 Host Task 中授权的 attachment，以及独立 search/compare/reevaluate/resynthesize：明确 unsupported，
  零伪造工具调用。本轮已授权并解析的附件只通过 `read_source_refs` 读取。
- COMMITTING：只调用 status，模型调用数 0、commit 数 0。
- commit 响应丢失：status 只读一次，commit 数仍为 1，不把 terminal status 冒充 exact candidate readback。
- begin/context/SourceRef/model 已写 started 但没有 result checkpoint：重启后停止并报告 outcome unknown，绝不重试；
  commit 是唯一允许通过一次 status 消除响应不确定性的步骤。唯一受控例外仅限 c8 遗留的
  `REVIEW_GATEWAY_INVALID_JSON_HTTP_404`：必须由原始短日志同时证明该错误和 `FIRST_RUN_EXIT=1`、model result 与
  commit 均不存在，并用 c12 保留的受控 recovery flag 把原 `model.started` 归档后恢复一次；不得删除 checkpoint 或重放
  begin/context/SourceRef，第二次 recovery 若仍无 model result 必须停止。

## 每轮证据

保留脱敏证据：

- Hosted release/Host MCP version、Skill version、profile、Session mode/key hash；
- attemptRef、taskType、input/base revision、Task inputHash；
- tool name/sequence、status、lease generation（不保留 lease token）；
- checkpoint 文件仅在私有 `0700` 目录中以 `0600` 保存；`model.output-shape` v2 必须 write-once 且不含模型
  原始 content/arguments；对外报告只保留绑定 hash 和调用计数；
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
