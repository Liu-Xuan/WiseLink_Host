# 官方托管 R10 c39 发布与 UAT runbook

c39 为真实 DLI c38 候选的未登记依据 ID 失败增加同一原生会话内的有界纠正。Turn8 已正确返回三个字符串字段，
但 6 个不同依据 ID 漏掉 `document:1`（共 8 个 premise 引用）；目录和实际已读来源映射一致，旧候选不修补、不重放。
驱动在提交前执行现有完整 c4/来源/增量校验，将安全错误码及本轮已读或已提供的 evidenceRef 反馈给模型，最多纠正
两次，共享原操作总时限，每次请求仍续租原 Host attempt。模型自行重新输出完整候选，通过后仅提交一次；不改写文本、
缩写映射、补字段或放宽允许范围。安全拒绝记录保存在 0600 checkpoint，未知错误、超时或租约失效停止。
本版无需 Host 更新；暂停唯一消费者并核对无在途后原位安装同名 Skill，再以正常新页面请求实测。

前序 c38 按用户要求，为明确选择 M3 的初始分析与每轮 Review 请求申请官方最大 524288 completion tokens，
来源为 [MiniMax Chat Completions 参数说明](https://platform.minimax.io/docs/api-reference/text-chat-openai)（2026-09-08）。
真实 c37 Matter 回合先读取 77 条
来源，随后两次以 `length` 用尽 16000 输出额度、没有候选载荷，Gateway 返回 `incomplete_result`；不把它
误判为候选参数校验错误。额度写入安全 output-shape，原输入、会话、总时限和全部校验保持。安装前等待当前
回合结束并暂停唯一消费者，再用正常新回合核对实际额度、来源读回和候选保存；旧失败不重放。
c38 已确认全局配置与两次真实请求为 524288；但 Turn7 的第二请求在原生三次尝试中仍分别 length/output=16000，
实际调用链的剩余限制仍需定位。wiselink-engineering 的本地模型目录另声明 32000，与全局不一致，但这不能单独解释
16000。不得把任一配置读回或简单 clamp 计算当成最终上游生效证据；不覆盖其他会话的新配置。
DLI 的 c37 Matter 回合两轮均 HTTP 200/tool_calls，候选 JSON carrier 成功，但 listBrief 返回 array[4]，在
候选校验时失败。c38 明确 headline/listBrief/lead 为非空字符串；校验继续拒绝错误类型，不手工修补旧候选。

c35 为 M3 JobAid 显式申请 32000 completion tokens：c34 的真实 150 项调用未设置该请求参数，上游
以 `length` 结束且无可用候选，Gateway 返回 `incomplete_result`。全部准则、输入、校验、原操作时限与模型
选择保留，是否完成仍须正常新请求实测。统一消费者同时优先处理工程师明确排队的 Review；Matter Review
可基于已解析材料独立执行，初始失败及已有 checkpoint 保留，未排队时不调用模型或重放失败。
本修订兼容已发布 c34 Host，暂停并核对唯一消费者空闲后，只更新同名 Skill，再恢复自然调度。

c34 同批接入 Overall v2 保存阅读结果、Matter c4 连续工作增量和翻译收敛尾段逐单元纠正。保留旧任务合同，
先安装兼容 c34，再迁移 0023、发布 Host/前端，最后用正常新请求恢复唯一消费者自然调度。
真实验证应覆盖同一个保存结果的列表/简报/多前提详情、返回讨论草稿、解释不变、局部纠正、新材料未读仍 pending
以及实际覆盖但不改结论。版本/CAS 冲突不能覆盖新认识，所有产物保持候选。M3/DLI 原有完整初始分析及各两轮
连续 Review 目标继续，不把本地模拟、安装或发布完成记为真实流程通过。

c19 新增页面自动领取，先安装兼容 Skill，再发布 Host，最后启用原生 command cron 与页面自动发送；本批具体步骤见 [页面自动领取](hosted-review-consumer.md)。下列历史五工具 UAT 保留给单轮 driver，不把它的手工启动结果当作页面自助闭环。

c20 兼容读取 JobAid / Overall / Review 的可选共同背景，并区分普通工作判断修改与正式采用。仍先安装 Skill，再发布提供新背景的 Host；旧任务、现有 cron 和候选提交入口保持。存储不可读期间只完成安装与代码验证，不重放失败 Turn，不把它们记为页面 UAT。

c21 在相同 C3/MCP/ResultEnvelope 上改为模型按需取证，不增加 Host 工具或业务写入口。
同轮复用原生 session，先发最小上下文与目录，随后仅传新增 tool exchange；跨 Turn 仍隔离。
必须分别记录本地协议测试、安装读回与真实新 Turn 验证，不以安装代替 UAT。

c22 增加 Host 可选控制面会话路由，承接同一授权范围下连续成功 Turn 的原生讨论。两侧保留旧逐轮路径的兼容，
先安装 c22，再发布返回 `nativeSessionKey` 的 Host；不更改 cron、模型配置、C3 输出或正式采用入口。
只有同一真实事项的两个新页面 Turn 均自动返回候选并承接工程师补充，才记为页面跨轮验证通过。

c23 增加新资料自动初始分析统一入口：先发布返回 `initialAnalysis` 的兼容 Host，再将既有 cron 切换到新入口及
同一获准事项。四个 operation 与 Review 候选提交合同不变；只有实际新资料完成初始候选及两个新页面回合，
其中一次承接方向纠正或新材料并解释判断变化，才记为真实连续使用通过。安装与本地测试不能替代它。

c24 接通任务启动时绑定全局模型、全文上下文紧凑翻译与必要的同会话续写，并在一个自然 tick 中有序推进
多个已就绪阶段。先安装 c24，再迁移新增非秘密设置表/任务列并发布 Host，最后从正常页面创建新任务。
分别以 M3 和用户登记的 DLI GPT 5.6 Sol 验证真实初始分析及至少两个连续 Review 回合；没有真实候选与
provenance 读回时只记录“已登记”或“已部署”，不能宣称某个模型跑通。全局默认切换必须由获授权的模型
管理角色通过页面完成，不用 CLI 数据写入绕过角色；旧任务在切换后保留自己的启动选择。

c25 针对 M3 真实首轮 length / incomplete_result 失败，在生成前明确限定连续输出窗口，仍向同一原生
会话提供完整文档；不让模型自行猜测何时收尾，不重放已失败 attempt。它不改变 Host wire/权限/提交合同，
可在 c24 Host 上 Skill-only 安装。使用新请求与 successor attempt 验证完整覆盖、跨章节一致性和总耗时；
本地窗口测试不等于该真实样本已成功，也不把保守字符/单元预算说成上游 token 限制。

c26 修复已实际观察的 M3 输出序列化差异：87 条完整连续结果以 item/index/text 对象包装返回，而非旧二元数组。
工具 schema 现明确定义 index/text 行；驱动只无损识别已声明的精确格式，原文本、索引、数字及来源校验不变。
此为 Skill-only 兼容修订；旧失败记录保留，使用正常新请求验证，不从旧会话取译文补造候选。

c27 修复 c26 实跑中的输出通道误判：Gateway 原生 length 后续写最终产生一个合法函数调用及 99 字附带说明，
严格 JSON 中的 87 行/索引均正确，却被旧的“content 必须空白”假设拒绝。按官方工具响应协议，只验证/消费
函数参数，附带文本仅作安全形态记录、不成为候选或证据；纯文本结果、analysis、未知/多个函数和无效参数仍拒绝。
当时全文续写总预算设为 20 分钟；c32 按下述真实长文失败证据修订，其他 operation 默认预算不变。
依据：[官方非流式工具响应形态](https://docs.openclaw.ai/gateway/openai-http-api#non-streaming-tool-response-shape)。

c32 修复 437 单元 DLI 在第 4 窗口纠正等待时耗尽 20 分钟总预算的失败：前 8 轮均成功响应，最终仅通过
275/437 单元。全文总预算为 45 分钟、单响应最多 15 分钟；每轮通过原 Host heartbeat 续租，续租失败即停止。
原 30 分钟 lease 与 60 分钟 attempt deadline 保留。暂停且核对唯一消费者空闲后，用官方 CLI 将其 timeout
设为 3600 秒，安装 c32 并读回，然后对正常新请求恢复自然 tick。完整覆盖、候选提交和连续 Review 仍须实跑。

c33 修复 M3 全文 437/437 已提交后，JobAid 在约 300 秒等待响应头时中断的问题。已安装 OpenClaw 的
agent 默认运行时限实读为 172800 秒；日志中通用 timeout 文案不足以认定它是 300 秒。消费者 fetch 有独立
300 秒响应头上限，客户端断开后 Gateway 取消 agent。Initial/Review 共用 Node 核心 HTTP/HTTPS 单次连接，
让已有操作 AbortSignal 控制响应头和正文，接收时限制 4 MiB，不改变全局配置或添加重试。先通过本地真实 HTTP
延迟、取消、超量、中断和不跟随重定向检查，再在唯一消费者暂停且空闲时安装；保留已成功翻译和失败 attempt，
用正常新请求验证后续候选与连续 Review。安装成功仍不等于真实循环完成。
依据：[Undici Client 超时](https://raw.githubusercontent.com/nodejs/undici/main/docs/docs/api/Client.md)、
[Node HTTP request 与 AbortSignal](https://nodejs.org/api/http.html#httprequesturl-options-callback)。

c28 同步修订 Host/Skill 的日期、中文数字及显式 ATA 识别，并在新的全文生成过程中对具体失败索引最多纠正两次；
沿用原模型、同一全文会话和总时间预算，完整保真校验仍在最终提交前执行。暂停且核对唯一 consumer 空闲后，
安装 c28 并发布 Host 对应算法，再用正常新请求恢复自然 tick；旧失败 attempt 保留。验收要分别核实纠正次数、
完整覆盖、候选保存及后续初始分析/连续 Review，不能将本地回归或日期样例通过记为业务已跑通。

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
不兼容 Task/Result schema、MCP tool 形状、authority 或安全语义改变时升级 compatibility ref，走 Host + Skill 协同发布。
c24 可选控制元数据兼容旧任务，但旧 Skill 不接受新字段，因此必须遵守先 Skill 后 Host 的协同顺序。

## 前置读回

必须从妙搭官方托管 UI/官方能力读回并记录：

1. app 精确为 `app_17c3zn24kv2`；
2. 唯一逻辑 profile 为 `wiselink-engineering`；
3. 模型经官方托管 profile/config 路由；新任务记录 Host executionModel，确认其 modelRef 已登记并通过
   `x-openclaw-model` 使用，未绑定旧任务才使用原配置默认。2026-09-06 配置读回为默认
   `miaoda/minimax-m3` 与已登记 `dli/gpt-5.6-sol`；不以登记替代生成实测。驱动先解析 `agents.list[]` 中当前 profile 的
   string 或 `{primary,fallbacks}` model，未显式配置时才回退 `agents.defaults.model`，并要求 fallbacks 为空。每个 turn
   优先读回非空、可识别的实际 `modelVersion`；响应未提供时，绑定任务记录 `configured-route:<modelRef>`，旧任务才使用唯一 configured endpoint。它们只证明路由，不解释为未暴露的下游具体模型。重复 agent、
   不可读 primary、fallbacks 非数组或非空均在调用模型前停止；
4. 同名 Skill 只有一个，安装版本精确
   `wiselink-research-and-synthesize@r09.c66`；
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
   `read_wiselink_review_sources` 与 `return_wiselink_review_candidate`，`tool_choice=required`、`parallel_tool_calls=false`
   和 `n=1`；前者按需调用现有 Host 读取，后者仅作为最终序列化通道且永不执行。每次响应只有一个 choice 和一个合法 function call，
   arguments 为 direct strict JSON object。附带纯文本说明不解析为结果、不写入候选/证据或驱动后续 exchange，
   只记录安全形态。纯文本结果、非文本 content、其他函数、多 tool call、fence/prose/array/null arguments 或任何 analysis
   均 fail closed，不从旁文本抽取或修复参数。
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
