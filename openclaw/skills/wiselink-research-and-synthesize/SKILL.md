---
name: wiselink-research-and-synthesize
description: Orchestrate the single official hosted WiseLink engineering profile through the canonical Host MCP for INITIAL_ANALYSIS and INTERACTIVE_REVIEW. Preserve applicability AST extraction, dynamic N/N tri-state semantics, SourceRef/currentness bindings, candidate-only authority, fenced ResultEnvelope commits including bounded Translation parts, and exact hosted provenance. Read Host-authorized parsed attachments only through the C3 SourceRef path, and fail closed for unavailable search, compare, reevaluation, or resynthesis tools.
---

# WiseLink R10 工程分析与事项讨论

本 Skill 是同名能力从历史 `d3ce25f` 迁移后的 R09 版本，不是第二套 Skill。

固定运行身份：

- hosted app：`app_17c3zn24kv2`
- logical profile：`wiselink-engineering`
- model policy：`official-hosted-profile-config`（任务可绑定已登记的内置或用户授权自定义模型；仍经唯一官方 Hosted profile/Gateway）
- Skill：`wiselink-research-and-synthesize@r09.c40`
- Skill compatibility：`wiselink-research-and-synthesize@r09`（Host 最低接受 `r09.c10`）
- Host MCP：`wiselink-openclaw-engineering-assessment@1.2.0`（既有 20 项能力；兼容新增的只读自动领取查询）
- Host baseline：`6fd2655d27edc3851c745547efaf8796ad22c82c`

app/profile/Skill/MCP 是执行合同，不是允许模型自报的标签。具体模型由官方托管 profile/config 选择；驱动从唯一
profile 的 `agents.list[].model` 读取 string 或 `{primary,fallbacks}`，缺少显式 agent model 时才回退
`agents.defaults.model`，且 fallbacks 必须为空。每次执行优先使用响应中可读的实际 `modelVersion`；响应未提供可读模型
时使用上述 configured provider/model endpoint，再连同 `promptVersion`、`skillVersion` 和 `toolVersions` 由 validator 校验后写入完整
ResultEnvelope。重复 agent、不可读 primary、fallbacks 非数组或非空均停止；Skill 不维护模型版本 allowlist。

c24 接受 Host 在新 TaskEnvelope 中保存的可选 `executionModel`。该非秘密控制元数据包含
`modelRef/displayName/providerKind/settingsRevision/selectedAt`，由既有 inputHash 绑定；Translation 每个
`taskBinding` 也携带相同选择。驱动确认 modelRef 在官方 `agents.defaults.models` 中已登记后，仅通过
`x-openclaw-model` header 选择它；body 的 `openclaw/wiselink-engineering`、原生会话及凭据来源均不变。
模型选择不混入 modelInput，不允许任意 URL 或凭据。登记不存在或路由失败时明确停止，不切换 provider。
任务恢复使用已保存选择，不重新读取全局默认。响应没有可读实际模型时记录 `configured-route:<modelRef>`，
只证明所请求的配置路由，不冒充服务商已回报下游型号；旧任务无该字段时维持原有官方 profile 路径。

`skillVersion` 始终记录实际安装包版本；Task 中的 `skillPolicyRef`（以及 Applicability v1 的历史字段
`runtimePolicy.skillVersion`）表示兼容线 `wiselink-research-and-synthesize@r09`。只改 references、示例或不改变
Task/Result/MCP 语义的 prompt 时可 Skill-only 发布新 c 修订；不兼容 schema、tool 参数、authority 或安全语义
变更必须升级兼容线并与 Host 协同发布。c24 的可选控制元数据保持旧任务兼容，但旧 Skill 不接受新字段，
必须先安装 c24，再发布生成该字段的 Host；不能把新任务交给旧 Skill。

c34 增加以 schema 区分的 Overall v2 与 Matter Review c4，同时完整保留旧 Overall v1、Review c2/c3。
先安装兼容包 c34，再发布生成新任务的 Host/前端。新任务不交给旧 Skill；r09 兼容线不变。

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
- 不使用本地 OpenClaw/Docker、OpenAI/Codex OAuth、未获用户授权或未登记的外部 provider、通用 shell、
  自造直连模型 HTTP、普通 app OpenAPI 伪造 invoke 或旧 0.11 runtime。用户授权的自定义模型只能通过
  妙搭官方模型设置登记并经同一 Hosted Gateway 使用；Codex 模型偏好不改变产品运行模型。
- 本目录不内嵌凭据。validator 只处理本地数据；Hosted driver／消费者从既有官方配置读取连接信息并调用
  已授权 Host 与官方 Gateway，不安装 Skill。历史 ZIP 安装器和 `archive/internal-lab/phase13-ab.mjs` 均不在本版本运行资产中。
- 官方 Hosted Agent 的真实路径是按本文件调用 MCP。Translation 的 sealed ResultEnvelope 必须先落到本轮本地
  `commit-payload.json`，再由本 Skill 的 `commitTranslationPayloadFile` 按原始字节分块读取并调用 MCP；不得让模型
  手工复刻完整 JSON。除这个无凭据的 bundled helper 外，不依赖通用 shell、自造 HTTP 或本地 decoder。

## Mode 1：INITIAL_ANALYSIS

### 新资料自动推进（c24）

`scripts/consume-hosted-work-item.mjs` 是既有原生 command cron 的统一入口。它先读 Host
`get_parse_status.initialAnalysis`，一次 tick 默认最多连续运行四个已就绪阶段。每阶段成功写回后 fresh-read，
只继续 `nextOperation` 指定的未执行阶段；满 15 分钟后不再启动新阶段，给在途调用与提交留出原生 cron
预算。c35 在材料就绪且无 BUSY 时先检查工程师明确排队的 Review；有请求则复用原有 Review 消费者，
由 Host 继续校验该回合的实际范围和前提。Matter 可以基于已解析材料形成认识，不要求先完成 JobAid/Overall。
没有待执行 Review 时才推进初始阶段；初始失败状态仍保留在回执，Review 成功不修复或重放失败初始阶段。
该状态来自现有 projection 与 ActionAttempt，
不是消费者另建业务状态机。独立资料读取可有限并行；依赖分析与同一 WorkItem 的 CAS 写回保持有序。
`NOT_READY/BUSY` 不调用模型，`FAILED/CONFLICT` 不自动重试，未知结果停止并报告。普通 applicability 的
`WAITING_INPUT` 保持缺口，可继续 Host 指定的 JobAid/Overall；它不自动启动 P0B 重算。
新 Host 未提供该字段时统一入口明确停止，原有单 operation 与 Review 入口仍兼容。
运行范围只取已授权的 `--work-item-id`；新事项尚无 applicability context 时使用与 Host 配置一致的
`--applicability-context-ref`，该控制引用和本轮 requestId 不进入模型。部署见
[Hosted 自动领取](references/hosted-review-consumer.md)。

### 共同背景（兼容增量）

c35 曾针对 M3 JobAid 的 `length/incomplete_result` 失败申请 32000 输出额度。c38 按用户后续要求统一
将明确选择 M3 的初始分析和 Review 请求设为官方最大 524288，并配套更新同一 M3 条目的 maxTokens。
仍返回全部 N 项并通过原校验；保留完整评估输入、全部准则、模型路由和原时间预算。

Host 可在 JobAid / Overall 输入的 `commonContext`，以及 Review 的 `context.commonContext` 中提供评估前
共同背景：主文件身份与章节目录、关联资料作用与实际读取片段、此前普通讨论及工作回答。旧任务没有该字段时仍按原输入执行。
优先理解当前问题、技术机理、措施演进和工程师纠正的方向。`PROCEDURAL_REFERENCE` 是施工或操作引用，
不表示其全文有助于理解问题；不能把目录、选入或历史引用说成本轮已读。

`discussion` 是可继续修改的工作过程，不是正式采用；按时间承接后续纠正，`fromCurrentRevision=false`
的旧判断要对照当前资料。`omittedEarlierTurns` 非零时不能声称已读全部历史。历史附件仅列文件名，不表示已读取其正文。
`knowledgeRetrieval.status=NOT_CONNECTED` 表示尚未接通 RAG，不是检索零结果，也不阻断已有资料分析。
背景片段不替代受控机队事实，不扩展 JobAid 本行引用或 Overall 当前主文件引用边界；Review 引用仍须本轮
通过既有 `read_source_refs` 实际读取。新增背景字段不改变 TaskEnvelope、候选输出、MCP 参数或正式采用入口。

每次只路由一个 Host 授权 operation：

| Operation               | 当前工具路径                                                                                | 状态   |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------ |
| `TRANSLATE`             | `begin_translation` → model → 同一 `commit_translation_candidate` 分块上传并 finalize       | 可执行 |
| `EXTRACT_APPLICABILITY` | `begin_applicability_evaluation` → AST model → `commit_applicability_candidate`             | 可执行 |
| `EVALUATE_JOBAID`       | `begin_dynamic_evaluation` → model → `commit_dynamic_evaluation_candidate`                  | 可执行 |
| `SYNTHESIZE_OVERALL`    | `begin_overall_synthesis` / `resume_overall_synthesis` → model → `commit_overall_candidate` | 可执行 |

`EXTRACT_APPLICABILITY` 只能走专用 applicability begin/commit；禁止把 `EVALUATE_JOBAID`、Reader 命中或
overall 中的文字解释成适用性结果。

Applicability model input 兼容旧 Host 缺少 `configurationEvidenceReevaluation`，也接受该字段为 `null`；
P0B 时只接受 Host 给出的精确协调绑定
`{triggerSnapshotId,triggerConfigurationRevision,adoptionWorkItemRevision,applicabilityRetryNo}`。该绑定仅用于
校验本轮协调上下文，不进入 applicability candidate，也不授权模型改变 Host 的重算状态。

### 通用 begin / commit

1. `get_parse_status({workItemId})` fresh-read 当前状态。
2. 调对应 `begin_*`。Translation begin 第 0 包直接返回可读的 attempt control、脱敏 taskBinding、
   `modelInputBase` 与第一批 SourceUnits；若 `partCount > 1`，官方 Hosted Agent 用同一工具按 `deliveryPart=1..N-1`
   顺序读取剩余可读 SourceUnits。每个完整 MCP tool result 按实际 JSON UTF-8 bytes 限在 14,000 内，不从托管
   日志恢复截断 JSON。
3. 若 status 为 `COMMITTING`，只调用一次 `get_action_attempt_status`，校验 Host 已持久化
   `recoveryResult.contentHash == resultContentHash == begin.recoveryResultContentHash` 后返回；不调用模型、不再次
   commit。begin 只返回该有界 hash，完整 recoveryResult 由既有 status 工具读取。
4. 若 status 为 `RUNNING`，只使用 `delivery.modelInputBase + delivery.sourceUnits` 组成的 authority-free translation
   输入；attempt control/taskBinding 不混入翻译输入。收齐输入后 heartbeat，生成完成、commit 前再 heartbeat；生成期间
   不要求短周期回调，Host 的长租约覆盖该段运行。
5. 模型执行必须返回 `{output, provenance}`；provenance 必须是实际读数，实际模型非空可读，并通过固定
   Skill/MCP/prompt validator。
6. 先验证 operation input/output pair，再构造完整
   `wiselink.3_1.openclaw_result_envelope.v1`。Applicability、Dynamic、Overall、Review 仍使用精确的单次 commit 参数：

```json
{
  "attemptRef": "AQ-opaque",
  "leaseToken": "host-issued-uuid",
  "leaseGeneration": 1,
  "result": { "schemaVersion": "wiselink.3_1.openclaw_result_envelope.v1" }
}
```

Translation 不使用上述单次大参数：将 sealed ResultEnvelope 写为本轮 `commit-payload.json`，通过下文
`UPLOAD_PART → FINALIZE` 形态提交。7. commit/finalize 后 fresh-read `get_parse_status`。Host 才负责 ResultGate、实际字节 persist/readback 和 WorkItem
CAS；Skill 不声称这些步骤由模型完成。8. commit 响应未知时只调用一次 `get_action_attempt_status`。仅当同一 attempt 的
`resultContentHash` 与本次 sealed ResultEnvelope `contentHash` 精确一致时返回只读恢复；否则 outcome unknown，
绝不 blind retry。

### Translation

- `begin_translation({workItemId, deliveryPart?})` 首次返回第 0 批；`partCount > 1` 时只用同一工具、同一
  WorkItem 顺序读取其余批。每次返回的 attemptRef、leaseToken/generation、taskBinding.inputHash 与 partCount
  必须一致，否则停止。重复读取 active attempt 不创建新 attempt、不换 lease。
- 第 0 批的 `delivery.modelInputBase` 保存 schema、rulePack 与 taskStartBinding；所有批次的
  `delivery.sourceUnits` 按 start/end index 连续拼成完整 196/N 个输入单元。它们是可读结构化 JSON，不需要
  shell、Node、解压或本地脚本。
- 输入/输出分别使用 Host 当前
  `wiselink.3_1.translation_task.v0.candidate` 与
  `wiselink.3_1.translation_result.v0.candidate`。
- c26 初始适配器先给模型完整 sourceUnits 与术语上下文，工具 schema 明确要求紧凑 `translatedUnits:[{index,text},...]`；
  unitKey、SourceRefs、rulePack 和 taskStartBinding 由驱动从未改变的 Host 输入机械还原。因实际网关在 length
  终态不返回可解析前缀，驱动在首次生成前就指定输出窗口：最多 96 个单元、约 6000 原文字符；单个长单元
  保持完整，不裁切原文。这是保守工作预算，不是声称模型的 token 上限。短文可一次完成，其余在同一原生
  session 中承接全文与已有译文继续输出；模型返回更短的有效连续前缀时也从实际已收齐位置继续。全部收齐前
  不封印、不提交、不显示为翻译完成；不把全文切成互不知情的独立小任务，也不修补截断 JSON。
- c26 驱动在完整 JSON 解析后识别三种精确定义的传输形态：上述 index/text 行、旧 index/text 二元数组、
  真实 M3 返回的 `translatedUnits:{item:[{index:"0",text:...},...]}`。只把规范十进制整数索引和明确字段无损映射，
  不猜索引、不重排、不丢行、不改译文；未知包装、额外字段、重复/跳号、超出请求窗口仍失败。
  output-shape 记录实际传输形态、条数和首尾索引，不保存原文、译文或私有推理。Host 输出合同不变。
- c27 按官方 Gateway 工具响应协议区分函数参数与附带说明文本；唯一合法函数的严格 JSON 参数才进入候选校验。
  附带的纯文本不解析为结果、不写入候选、不由驱动带入后续 exchange，也不作为证据；仅记录类型、长度和
  `FUNCTION_ARGUMENTS_WITH_COMMENTARY` 安全形态。纯文本结果、多个调用、未知函数、analysis/reasoning 字段、
  非文本 content 和不完整参数仍拒绝。该处理同样用于 Review，不改变 Host 的来源、数字保真、授权或提交校验。
  全文多窗的当前预算与续租行为见 c32；超时不自动重放。
- c29 每轮翻译保真校验都会在私有 checkpoint 保存规则编号、单元索引、错误码与有长度上限的确定性校验说明。
  在取消 attempt 前保留失败明细；诊断文件不保存原文、译文或模型思考，不改变既有纠正次数及提交边界。
- c31 针对已观察到的 M3 两次耗尽默认 16,000 输出 token 且无候选的失败，在绑定 M3 的翻译请求中显式设置
  `max_completion_tokens=32000`，并记录请求额度（c38 按用户要求提升为官方最大 524288）。全文输入和输出窗口沿用 c29；c30 输入精简暂缓安装。
  该 Gateway 会按模型条目的 `maxTokens` 夹限，请求值必须与已核实的托管配置配套；参数本身不修改配置。
  原时间预算、模型选择、保真校验和候选提交边界继续生效。
- c32 修复实跑 DLI 在 20 分钟到期时仅通过 275/437 单元的问题：全文生成和纠正共享 45 分钟总预算，
  单次响应最多 15 分钟。确定性适配器在每轮请求前以原 attempt/lease 调用 Host heartbeat，续租失败即停止后续
  模型调用和提交；模型不接触租约。既有 30 分钟租约及 60 分钟 attempt deadline 不变。原生唯一消费者须配置
  60 分钟 timeout；运行超过 15 分钟后将后续初始阶段留给下一次自然 tick。总预算或单响应超时保留具体错误码，
  不重放已失败 attempt，不改变全文输入、模型、输出窗口、纠正次数或最终保真校验。
- c33 将 Initial 与 Review 的非流式 Gateway 请求改为 Node 核心 HTTP/HTTPS 单次连接，避免 `fetch` 的
  独立 300 秒响应头上限先于操作预算断开。请求仍由已有 AbortSignal 限定整个响应，接收时执行 4 MiB 上限；
  连接中断、超量或操作超时直接失败。端点、认证头、模型和原生 session 路由保持；无重定向、传输重试、
  全局 dispatcher/agent timeout 修改或额外依赖。HTTPS 使用默认证书校验。旧失败记录保留，用正常新请求验证。
- c28 在每个输出窗口收齐后按同一 rulePack 检查实际内容；具体失败单元可在原全文会话、原模型中定向纠正，
  每窗口最多两次且共用该次全文总预算。纠正响应只能包含请求的索引，完整匹配后以模型实返文本替换这些单元；
  未失败单元保持原文，驱动不编造、删改或补齐译文。各单元翻译自身片段，全文和相邻单元只帮助理解，不挪动内容。
  耗尽预算或纠正仍失败时停止；不重放已经失败的 Host attempt，不执行上传或提交。
- c34 在上述两次批量纠正均严格减少 findings、失败单元数未增加且只剩至多 8 个单元时，允许逐单元尾段纠正。
  每个单元最多两次，每次仍须严格减少自身 findings；停滞、增加、数量超限或原总预算到期立即失败。
  模型返回该完整单元，驱动只原样替换其文本并重跑同一 rulePack；不自行搬动相邻编号或内容。
- c28 与 Host 同步修正保真识别：完整、无歧义日期按日期值比较，允许 `24 Sep 2020` 与 `2020年9月24日`
  等价；日期变化、无效日期和次数变化仍失败。中文紧邻数字正常识别，连写的字母数字标识仍逐字保留。
  ATA 只匹配明确的 ATA 引用，不把普通日期或数值误称为章节；既有编号、术语、来源及最终提交校验保留。
- `rulePackId + rulePackVersion`、taskStartBinding、unit 数量/顺序、unitKey 与 SourceRef 集必须逐项一致。
- Host TranslationRuleSet ResultGate 仍是编号、数值、单位、ATA/件号、表格和警示层级的最终权威。模型
  生成后、封印或上传前，Skill validator 读取同一 Host-frozen rulePack：`numericFidelity` 使用与 Host 相同的
  数字/日期/连写标识 token occurrence multiset，`preserveAtaChapterNumbers` 使用与 Host 相同的 ATA 逐字规则。
  本轮有界纠正后仍失败时返回 `unitKey` 和具体 finding 并停止；该预检不取代 Host ResultGate。
- 翻译必须原样保留 Host 识别的数字 token 及出现次数，并逐字保留匹配的 ATA token。不得把字母或 OCR
  连写中的数字拆成新的独立数字（如把 `OCRX123` 改为 `OCRX 123`），不得拆分 leading-zero token（如
  `007`），也不得“修复”、分隔或重排会改变 Host tokenization 的 OCR 连写 decimal/table 字符串（如
  `40.512.7`）。不自动改写模型译文；预检失败后按 `unitKey` 重新生成候选。
- 校验与封印成功后，将 ResultEnvelope（或旧 fenced wrapper）写入本轮本地 `commit-payload.json`，调用
  `commitTranslationPayloadFile({begin,payloadPath,callTool})`。helper 使用 canonical UTF-8 bytes，每 6144 bytes
  一个 part；Base64 后每次 MCP arguments 明显小于 12,000 bytes，最大 64 parts。
- 每个 part 仍调用同一个 `commit_translation_candidate`：

```json
{
  "attemptRef": "TRN-opaque",
  "leaseToken": "host-issued-uuid",
  "leaseGeneration": 1,
  "phase": "UPLOAD_PART",
  "resultContentHash": "64-lower-hex",
  "partIndex": 0,
  "partCount": 12,
  "payloadBase64": "bounded-base64"
}
```

- `UPLOAD_PART` 只接受同一 attempt/owner/lease generation 的实际字节并返回 receipt；相同 part 可精确重放，冲突
  bytes 明确失败。它不创建可见 candidate，不改 WorkItem revision/current。收齐 receipts 后调用同一工具的
  `phase=FINALIZE`，参数只含 `resultContentHash + partCount + parts[{partIndex,sha256,byteLength}]`；Host 排序、完整性
  检查、实际字节 readback、组装后才进入原有 ResultEnvelope→ResultGate→FileService→CAS/current。
- 任一 part/finalize 明确失败立即停止；未知或进入 COMMITTING 时只读一次通用 status，不盲重放 finalize。

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
- `aircraftNumber/asOf` 是 Host 冻结的评估对象与时点，不是工程师对适用性的确认。初始分析可由 Host 自动冻结
  current 受控目标；前端手动输入仅用于切换目标或回溯时点，缺少手动选择不得被解释为“尚未确认适用性”。
- `modelInput.astVocabulary` 是本 attempt 唯一合法 AST 词表。属性、operator、qualifier、value shape 与复杂度必须
  逐项遵守；例如数值区间只能使用词表声明的 `range` + `{min,max}`，不得猜测 `between` 或其他近义写法。
- 适用性条件不限于飞机号或生产线号。只要词表已发布且 Host 提供 current 受控事实，可表达注册号/MSN/line/
  variable number、部件 P/N/S/N、设备号/FIN、软件 P/N/S/N/version、改装与修理状态；缺失 qualifier 对应事实时
  必须保持 UNKNOWN/WAITING_INPUT，不得从文档原文或常识补成 TRUE/FALSE。
- 模型只返回 `applicability_ast_candidate.v1` 的 `expressionId + sourceRefIds + expressionAst`；不返回
  `applicabilityLevel`、`contentRef`、飞机匹配结论或 current。
- Skill 用 Host modelInput 组装专属 `applicability_candidate.v1`；Host 才负责 target level/contentRef、唯一
  FleetMasterData、Kleene evaluator、ResultGate、实际字节 readback、CAS/current。
- Applicability 必须走本 Skill 的 `runApplicabilityEvaluation` 编排，不得手工拼 ResultEnvelope；
  `factsConsidered` 只可由 `modelInput.controlledFacts[].factId` 派生。业务校验拒绝后停止，不得重提 commit；只有
  明确的传输响应丢失才按既有只读 status recovery 路径恢复。
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
  timeline/effective、Host `selectiveResynthesis` 摘要、Unified SourceRefs，以及 Host 当前
  `applicabilityResult`（没有当前候选时为 null）。Overall 必须逐字遵循 Host 派生的适用性终态：
  `APPLICABLE`、`NOT_APPLICABLE` 或 `UNKNOWN/WAITING_INPUT`，不得降级为笼统人工复核。
- 若当前文档的 source-bound 适用性条件缺少受控机队事实，且 Host `applicabilityResult` 为 null 或 UNKNOWN，
  仍执行 overall 模型并形成初步工程综合候选；只允许
  列出当前 SourceRef/effectivity 实际要求的缺失事实，保持适用性为条件性 UNKNOWN，并说明需要工程师或后续受控
  数据确认。不得引入当前文档、dynamic 缺口和 Host missingInputs 中不存在的设备、软件或构型名称。
- 新任务有 `evidenceRegistry` 时，`engineeringSummary.schemaVersion` 必须为
  `wiselink.3_1.overall_engineering_summary.v2`，正文为 `headline/listBrief/lead/claims/decisiveClaimIds`。
  `overallCandidate` 与 `lead` 完全一致。列表、简报和详情读取同一保存结果，不由 GET 重新生成。
- 每条 claim 有稳定 claimId、正文、SOURCE_FACT/CONDITIONAL_INFERENCE 及全部实际前提。每项 premise 指向
  本轮 evidenceRegistry 的 evidenceRef，注明 SUPPORTS/LIMITS/CONTEXT/CONFLICTS、解释和 limitation。
  多来源推断要列出全部必要前提；关联材料可以独立支撑判断，不强制每条都引用主文档。
  原文、工程师陈述、Host事实、查询回执和既有结果保留自己的载体类型；既有候选不成为独立新事实。
- 用 decisiveClaimIds 标记会改变结论的条件、否定和冲突，阅读层必须完整显示。无需为完成评估强行给出实施、
  优先级或固定数量的动作。制造商建议与工程师假设应归属其来源，均不自动成为批准或放行。
  无 evidenceRegistry 的历史任务继续输出原 v1 结构并遵守其来源合同。
- 工程师 review 的同 criterion 多次记录由 Host 保留 history，并以最后一条为 effective；Skill 不重写
  ledger 或把 review 自动升级为批准。
- 只在一个明确 gap 需要外部事实时，选择直接相关且已实现的官方 provider；不固定遍历三家 OEM。
- discovery 永远 `adopted=false`、`usableAsEvidence=false`、
  `externalDiscoveryIsEvidence=false`。`ACCESS_DENIED`、`PARTIAL`、`TRUNCATED` 和 zero result 不互换。
- 未采纳 discovery 不改变 EvaluationContext。只有 Host/DM 采纳形成 DocumentVersion 后，新的 overall
  输入才消费它。
- `resume_overall_synthesis` 只恢复既有 RUNNING attempt；不新建 attempt、不重跑 dynamic/discovery。

### P0B：配置证据采纳后全量重算

只有 Host `get_parse_status` 返回唯一脱敏字段
`configurationEvidenceReevaluation` 时，才允许调用
`runConfigurationEvidenceReevaluation`。旧 Host 没有该字段时，新入口必须以
`HOST_P0B_STATUS_UNAVAILABLE` 停止；原有单 operation `runInitialAnalysis` 保持兼容。

协调器仅复用 exact20 中的现有工具，并严格以 Host `nextStage` 为准：

```text
get_parse_status
→ Applicability 既有 begin/commit
→ get_parse_status
→ Dynamic N/N 既有 begin/commit
→ get_parse_status
→ Overall 既有 begin/commit
→ get_parse_status
```

- `nextStage=APPLICABILITY|JOB_AID|OVERALL|null`；已成功阶段必须跳过，不重放模型或 commit。
- 每阶段后 fresh-read 必须保持同一 `triggerSnapshotId + triggerConfigurationRevision`，不得回退阶段。
- `WAITING_INPUT` / `FAILED` / `CONFLICT` 只返回 Host 终态，不在同一运行自动重试。重试必须由 Host
  状态与新 ActionAttempt 授权。
- 协调器不读、不要求、不推断 Host 内部 staged bundle，也不根据 serving
  Applicability/Job-Aid/Overall 判断阶段。旧 serving current 可在最终 Host CAS 前保持不变。
- Overall 的本地 preflight 在 P0B 模式下只核对 Host 脱敏状态已进入 `OVERALL`；真正的 staged
  Applicability/baseRules 绑定、ResultGate、actual-byte readback 与最终单次 CAS 仍全由 Host 执行。

## Mode 2：INTERACTIVE_REVIEW

### R10 Matter Review（c34）

Host 的 `review_turn_task.v1.c4` 仍经同一驱动、原生会话和五个 MCP 工具执行。`matterContext` 是封存的 Host
业务绑定，不进入模型；模型只接收 `context.matterWorking` 中的当前保存结果、工作版本、焦点、待解问题、
复核条件、输入是否待处理及脱敏依据目录。该路径不要求主文档已有 JobAid，不生成 ReviewActionDraft。

- 输出 `review_turn_candidate.v1.c4`，必须有 `matterWorkingDelta`；普通解释为 null，`reviewActionDraft=null`、
  `affectedItemIds=[]`。根据实际新信息提出 INITIAL_SYNTHESIS、CORRECTION 或 MATERIAL_INCORPORATION，
  不是每轮聊天都另写一个结果。
- 非 null delta 精确包含 `updateKind/changeSummary/nextFocus/claimDelta/readingPresentation/`
  `openQuestionDelta/reviewConditionDelta/coverageUpdates`。claimDelta 按稳定 claimId 添加、替换、撤销或明确保持，
  写出 changedBecause；readingPresentation 与新的 claims 一起构成同一阅读结果。局部纠正保留未变化正文和依据。
- DOCUMENT_PASSAGE 目录不包含正文；任何答复引用、变化 claim 的文档前提与 coverage 都必须本轮实际读取。
  使用本轮 task-local source key，不能用另一个文档的同名原 SourceRef；工程师陈述只可用 Host 已提供的文本。
- coverage 按 inputRef 记录实际读过的 source keys、明确检查范围、SUBSTANTIVE 或 NO_MATERIAL_CHANGE 及理由。
  未读、仅登记或仅命中的材料保持 pending；覆盖一个片段不代表全文检查。新材料没有改变判断时允许只更新覆盖记录。
  更新同一输入的 coverage 会替换原范围；所得结果全部文档前提（含保持的 claim）必须落在该输入的覆盖记录中，
  不能只列代表性片段。支持结果的输入须有 SUBSTANTIVE 覆盖，未用于结果的输入不能这样标记。
  驱动在提交前检查这项要求，错误交给同轮模型修订；不得自动补齐范围或删掉有效 claim 来通过校验。
- Host 核对全成员及历史依据访问、版本和真实读取后，在同一事务追加候选答复与工作记录；冲突保存
  BASIS_CHANGED 回执，不能覆盖新结果。解释 null 不推进工作版本。工作结果与正式采用、审批、实施决定分离。
- 工作版本因本事项上一轮正常保存而递增，不单独重置原生会话；换事项、输入范围/版本/权限变化或上一轮失败会
  重新建立会话。所有保存仍由 Host 完成；模型不可回传 actor、tenant、WI、artifact、租约或 CAS 控制字段。

以下 C3 规则继续适用于普通 WorkItem Review；其中“不写工作记录”和禁止 resynthesis 的限制不覆盖上面的 c4
候选工作记录路径。两条路径都不执行正式 ReviewAction。

### 页面自动执行（c19）

页面以 `executionMode=AUTOMATIC` 保存新 Turn 后，官方 Hosted OpenClaw 原生 command cron 可执行
`scripts/consume-hosted-review-turn.mjs`。消费者只读 `get_pending_review_turn` 返回的下一轮，继而复用现有
driver；没有待办或已有运行中的租约时不调用模型。历史普通保存、已完成的 Turn 不自动重放。
这里的工作判断／讨论保存不是正式采用，消费者不确认 ReviewAction。部署与已知范围见
[Hosted 自动领取](references/hosted-review-consumer.md)。

以下五工具约束针对模型外的业务候选流程；自动领取查询、续租与运行进度、失败后停止 attempt 属于消费者控制面，均不交给模型。

c36 在交互 Review 内对明确的 429/502/503/504 或连接建立前失败最多短重试两次（1 秒、3 秒），
共享原回合总时限与原生会话。每次请求和重试均由外部适配器经 `heartbeat_action_attempt` 核对当前
租约/授权，并以可选 `reviewProgress` 保存 MODEL_REQUEST/MODEL_RETRY；进度不含模型思考或来源正文。
Host 以同一次续租 CAS 追加记录，页面将运行进度与实际取证分开。认证、输入、来源校验错误不重试；
已送达状态不确定的网络中断/超时与候选提交不盲重放，仍使用原状态回读规则。
Host 已记录的业务失败或 exact attempt 已确认取消，返回 REQUIRES_ATTENTION 且消费器正常退出，
避免旧业务失败触发 cron 的一小时退避并阻断新交互。未确认的取消或消费器故障仍明确报错。
先发布支持此可选进度输入与回读的 Host，再安装 c36；完整部署步骤见自动领取参考。

当前精确 C3 复核合同仍只使用以下五个工具：

```text
begin_review_turn
get_review_turn_context
read_source_refs
get_action_attempt_status
commit_review_turn_candidate
```

这五个 Host 工具只能由 `scripts/run-hosted-review-turn.mjs` 的确定性外部驱动调用，不得由对话模型直接调用。
驱动先从官方 OpenClaw 配置确认 `gateway.http.endpoints.chatCompletions.enabled=true`，未明确启用时在任何
Host business begin 之前停止。完整 MCP 结果写入权限为 `0600` 的持久 checkpoint，目录限制为 `0700`：已完成
步骤只从 checkpoint 恢复；model response 在 strict parse 前只额外写入不含原文的 `model.output-shape` v2 0600
write-once checkpoint；同轮后续响应按序号保存。驱动向模型提供 `read_wiselink_review_sources` 与
`return_wiselink_review_candidate` 两个 client function：前者只委托驱动读取当前 Host 已授权来源，后者仅序列化最终候选。
使用原生 `tool_choice=required` 要求本次返回读取或候选工具调用。c37 的 Matter 输出函数只有 `candidateJson`
字符串参数：其中是完整候选 JSON，保留真正的嵌套数组与 null；驱动只作严格 JSON 解析，再执行完整候选、来源、
事项增量及 ResultEnvelope 校验，不能修补 `{item:[...]}`、缺字段或错误来源。普通 WorkItem Review 保留直接对象参数。
c38 按用户要求，对明确选择的 M3 初始分析和 Review 在每轮请求中申请 `max_completion_tokens=524288`。
这是 [MiniMax 官方参数说明](https://platform.minimax.io/docs/api-reference/text-chat-openai) 于 2026-09-08
列出的最大输出额度；安全 output-shape 记录申请值。完整输入、原生会话、原总时限和候选校验保持，实际能否
经 Hosted 生效及完成候选仍须实测，不把申请额度当成实际用量，也不要求模型用满额度。
`readingPresentation` 的 headline、listBrief、lead 均为非空字符串；listBrief 是列表行上的短文本，不能返回
项目数组。c38 明确这三个字段的类型，修复真实 DLI 候选将 listBrief 返回为数组的问题；类型错误仍不得提交。
c39 在 Matter 候选返回后、任何 Host commit 前执行现有完整校验；将安全错误码及本轮已读或已提供的
evidenceRef 作为工具结果反馈给同一原生会话，最多纠正两次，共享原操作总时限，每次请求仍续租同一 attempt。
模型重新输出完整候选，驱动不得修补引用、补字段、删减实质内容或放宽来源与正式采用边界。拒绝记录写入私有
`candidate-rejection-N.json`，只保存错误码、轮次和绑定摘要。次数耗尽、超时、租约失效或未知错误立即停止；
仅通过全部校验的候选进入一次 Host commit。已失败的旧回合和不确定的提交不因此重放。
每次响应只有一个 choice、一个上述 function，arguments 为 direct strict JSON object。assistant content 优先为 null
或空白；官方 Gateway 附带的纯文本说明只记录安全形态，不解析、不进入候选/证据或驱动的后续 exchange。
其他函数、多 choice、多 tool call、纯文本结果、analysis/reasoning、非文本 content，以及 fence/prose/array/null
arguments 仍拒绝。begin/context/SourceRef/model
的结果一旦不确定即停止且不重试；只有 commit 响应
丢失时允许恰好一次只读 status 恢复。唯一例外是有 c8 原始日志严格证明 HTTP 404 在路由层未触达模型时，c12
可将旧 `model.started` 原样归档并只恢复一次 model/commit，不重放任何已完成 Host 读取。模型只收到移除
conversation/turn/request/attempt/lease/WorkItem 控制面值的生成输入。c22 使用 Host begin 返回的可选
`nativeSessionKey` 路由原生讨论；它只放在 Gateway header，不进入模型或浏览器。旧 Host 没有该字段时保留
request 派生的逐轮隔离，并在报告中明确 `TURN_ISOLATED_LEGACY_HOST`。当前驱动允许模型在用户明确意图和 Host allowlist 内返回只读答复、CandidateEvidence、
affected-items preview 或完整 ReviewActionDraft proposal；候选绑定、ResultEnvelope 和 commit 仍均由驱动
机械完成，模型永远不能确认或执行草案。

正常轮次：

```text
begin_review_turn({reviewConversationRef, requestId})
→ get_review_turn_context({attemptRef})
→ 驱动把最小上下文与可用资料目录交给托管 profile 当前选定模型
→ 模型请求 read_wiselink_review_sources({sourceRefIds})
→ 驱动执行 read_source_refs({attemptRef, sourceRefIds}) 并返回实际片段 [按需重复]
→ 模型调用 return_wiselink_review_candidate 返回最终候选
→ 驱动绑定 review_turn_candidate.v1.c3
→ validator + full ResultEnvelope
→ commit_review_turn_candidate({attemptRef, leaseToken, leaseGeneration, result})
```

约束：

- 每轮由 Host fresh-read ReviewConversation、ReviewTurn、current revision、evaluation、bilingual、
  applicability 和 adopted inputs；不能依赖 session memory 判断 current 或权限。
- 不得用普通对话 Session 承载 begin/lease/commit 状态；Session compaction、重启或重放不能再次发起任何已开始的
  Host 调用。同轮取证循环复用原生 session 与既有总超时；后续请求只传新增 tool exchange，不重传整包与完整历史。
  模型决定读取哪些相关来源，每批至多 100 项；重复读取同一来源复用本轮已授权实读值。没有需要时允许零读取，
  但不能引用未读来源。跨 Turn 由 Host 根据上一条成功 Turn 的持久任务、本轮版本及授权来源目录决定是否
  延续；首次、旧任务、上一轮失败或材料范围变化时重新建立上下文。新 Turn 仍有独立 request、checkpoint 和
  候选提交；每轮带入当前 Host 上下文，旧会话记忆不代替本轮实读依据。原生运行中 steering 仍未接通。
- model.result 保存实际读取批次；恢复已完成模型结果时，按原批次从已有 SourceRef checkpoint 注册已读集合，
  不重跑模型、不把候选自报的引用当作读取证据。最终候选仍只有一次既有 commit。
- `context.evaluation.gapLedger` 是 Host 从 current dynamic artifact、active CriterionSet 和 effective
  engineer-review ledger 机械派生的只读缺口账本。优先按 `gapRef` 解释相同受控输入影响的全部
  `affectedCriterionIds`，不得把逐项 `missingInputs` 重复扩写成多个新缺口，也不得自行关闭 Gap。
- `gapLedger` 的 `REVIEW_QUERYABLE` 只表示本轮可通过既有 Review 输入／附件路径补充候选证据，
  不表示存在自动查询工具；`HUMAN_DECISION_ONLY` 不得触发查询。任何补充仍先形成
  CandidateEvidence／ReviewActionDraft，未经工程师确认不得改变 current。
- ReviewActionDraft 仅可在 `resolvedGapRefs` 中引用本轮 Host `gapLedger` 已列出的
  `REVIEW_QUERYABLE` 且未完全关闭的 Gap；其 `affectedItemIds` 必须等于这些 Gap 的 Host
  `affectedCriterionIds` 并集，并且必须采用本轮工程师文本或附件证据。模型不能提交
  `missingInputId` 作为关闭依据，也不能仅凭旧 SourceRef 声称缺口已解决。
- `allowedOperations` 必须精确是六项：`GET_WORKITEM_CONTEXT`、`GET_EVALUATION_ITEM`、
  `READ_SOURCE_REFS`、`DRAFT_REVIEW_ACTION`、`PREVIEW_AFFECTED_ITEMS`、`GET_OPERATION_STATUS`。
- candidate 使用的每个 SourceRef 必须属于 Task allowlist，并在本轮实际通过 `read_source_refs` 读取；当问题
  同时涉及 selected Criterion 和附件时，模型应读取二者的相关 SourceRef，不因 Criterion 原文优先而遗漏附件；外层
  ResultEnvelope 绑定其 actual resource artifact ref/SHA。
- 工程师明确要求定位、引用或返回 SourceRef 时，候选必须使用 `SOURCE_LINK`，并至少返回一个本轮实读的
  `candidate.sourceRefs`；`SOURCE_LINK + sourceRefs=[]` 在 Skill 与 Host 两侧均 fail closed，不能只在回答正文中
  描述来源而让浏览器失去可点击定位入口。
- `attachmentRefs` 可以非空，但每项必须是非空唯一字符串且属于同一 Task `resourceRefs`。附件正文只能按
  `read_source_refs` 读取 Host 已解析、已脱敏的 value；不得读取或推导 raw FileService locator/bytes，也不得把
  Task 中的 resource artifact ref/SHA 送给模型。
- 只允许 answer、clarifying question、source link、candidate evidence、ReviewActionDraft candidate、
  affected-items preview 与 task status。所有输出仍为候选。
- Host commit 只追加 assistant candidate、candidateEvidence 和 ReviewActionDraft；不执行 ReviewAction，
  不改 revision/current/STALE。
- 后续工程师显式确认 ReviewActionDraft 时，Host 会 fresh-read current Gap Ledger，以
  `resolvedGapRefs` 重新派生 `resolvedMissingInputs` 和受影响 Criterion，再进入既有 Review ledger／CAS；
  任一 revision、Gap、queryability、证据或受影响项漂移均 fail closed。
- 独立 `ANALYZE_ATTACHMENT` operation/tool、附件上传、knowledge search、revision compare、affected
  reevaluation 和 overall resynthesis 当前没有 C3 工具授权；请求这些扩展能力必须 fail closed，不虚构调用或
  结果。Host 已在当前 ReviewTurn 授权并解析的附件仍可按上一条 SourceRef 路径读取和形成候选分析。
- begin/status 为 `COMMITTING` 时只调用 `get_action_attempt_status` 读取 recovery ResultEnvelope；不调用模型、
  不重放 commit。commit 响应未知时也只读 status 一次，不因 status=SUCCEEDED 就猜测 exact candidate 已落账。

Review candidate 精确使用：

```text
schemaVersion = wiselink.3_1.review_turn_candidate.v1.c3
mode = INTERACTIVE_REVIEW
reviewConversationRef / reviewTurnRef = Task exact binding
responseType / answer
sourceRefs / missingInputs / candidateEvidenceRefs
reviewActionDraft | null
affectedItemIds / warnings
runtime = {runtimeAppId, profileRef}
```

ReviewActionDraft 只能引用 Task 中允许的 evaluation items、adopted input refs 和 SourceRefs，且
`baseRevision` 必须等于 Task inputRevision。C3 Draft 还必须带
`uncertaintyDispositions[]` 与 `decisionSnapshot`：每个 disposition 只能绑定 Host 当前 Gap；
`RESOLVED_BY_EVIDENCE` 必须与 `resolvedGapRefs` 精确一致；`CONFIRMABLE` 只允许在全部 P0/P1 未知已有
证据、假设、保守边界、控制、专业判断或监控处置时产生。Decision Snapshot 始终
`candidateOnly=true`，模型不生成 Host draft/snapshot ref，也不执行 ReviewAction。

## ResultEnvelope 与 provenance

所有 commit 一律提交完整 ResultEnvelope；禁止旧 `{attemptRef, output}`。内容包括 task/workItem/baseRevision
绑定、candidate outcome、modelOutput、artifact/source refs、missing/conflict/warning、实际模型/Prompt/Skill/
tool 版本、run metrics、错误字段和 canonical SHA-256 `contentHash`。

Interactive Review 的复杂 ResultEnvelope 必须由 `sealResultEnvelope` 生成，并通过
`commit_review_turn_candidate.resultJson` 发送 canonical JSON 字符串；不得让托管模型逐字段手写嵌套
`result` 参数。Host 会解析 `resultJson` 后进入同一个 ResultEnvelope、provenance、SourceRef 和 lease gate。

注意两个同名字段的不同类型，不得直接复制：

- `candidate.sourceRefs` 是本轮已通过 `read_source_refs` 实读的 `sourceRefId[]`；
- 外层 `ResultEnvelope.sourceRefs` 是这些 ID 对应的 actual resource artifact `[{ref,sha256}]`，必须由
  `reviewCandidateArtifactRefs(task, candidate)` 从 `task.modelInput.resourceRefs` 机械派生；
- 严禁把 `{sourceRefId}` 或 `sourceRefId[]` 写入外层 `ResultEnvelope.sourceRefs`；
- 必须先让 `sealResultEnvelope` 本地验证成功，再发起唯一一次 commit。本地验证失败不消耗 commit 机会。

当前 validator 强制：

- `modelVersion` 优先取响应中可读实际模型；绑定任务未回报实际模型时使用 `configured-route:<modelRef>`，旧无绑定任务使用无 fallback 的 configured endpoint。后两者只证明路由，不代表已暴露下游具体模型，也不做具体版本等值判断
- `skillVersion=wiselink-research-and-synthesize@r09.c40`
- `toolVersions.wiselink-openclaw-engineering-assessment=1.2.0`
- `promptVersion` 非空并来自当前运行
- task/result exact binding、SourceRef allowlist 和 canonical hash 一致

这些字段只证明提交数据符合合同。直到官方托管 UAT 逐轮读回实际执行 provenance，不能把本地测试、UI
可选模型显示或自报字符串写成 Hosted runtime 已跑通。

## 本地合同核验

```bash
node scripts/validate-payload.mjs dynamic-rules-input tests/fixtures/dynamic-rules-evaluation-737.input.json
node scripts/validate-payload.mjs applicability-input tests/fixtures/applicability-task.c4.json
node scripts/validate-payload.mjs applicability-ast-candidate tests/fixtures/applicability-ast-candidate.c4.json
node scripts/validate-payload.mjs discovery-output references/discovery-access-denied.example.json
node scripts/validate-payload.mjs synthesis-output references/synthesis-output.example.json
node scripts/validate-payload.mjs review-task tests/fixtures/review-turn-task.c2.json
node scripts/validate-payload.mjs review-task tests/fixtures/review-turn-task-attachment.c2.json
node --test tests/validation.test.mjs
```

真实托管 UAT 步骤和 non-claims 见
[Hosted UAT runbook](references/hosted-uat-runbook.md)。详细工具/恢复语义见
[Host MCP 编排](references/host-mcp-orchestration.md)，交换字段见
[输入输出](references/input-output.md)。
