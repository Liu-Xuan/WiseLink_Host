# 新资料初始分析与页面自动领取

c19 在单轮 driver 外增加薄消费者，不建立第二个队列或常驻自制进程。

- Host 在现有 Turn 的输入记录中保存显式 `AUTOMATIC` 意图；普通历史 Turn 不加入自动执行。
- `get_pending_review_turn({workItemId})` 先走现有 exact WorkItem service scope，再按 owner、官方身份映射和 ACTIVE 会话查询，先进先出。
- 原生 OpenClaw command cron 每次运行一次消费者；空闲或正在执行时直接退出，不消耗模型轮次。
- 消费者复用 `run-hosted-review-turn.mjs` 的配置读取、官方 Gateway、候选提交和私有 checkpoint。
- 单轮所需来源超过 MCP 每批 100 项时按既有 API 上限分批读取，保持完整来源集合，不因总数超过单批上限而拒绝讨论。
- 上下文准备前先持久化 ActionAttempt。准备失败由 Host 写成 FAILED；模型／本地处理失败且尚未触发 commit 时，消费者通过既有 cancel 工具停止该 exact attempt，页面可见原因。commit 结果不确定时不取消、不盲重提。
- 成功只保存候选；正式采用依然由工程师进入原有确认入口。

## 部署顺序

1. 原位安装 c19。它兼容原有 20 工具，也接受新增只读 `get_pending_review_turn`；单轮 C3 与 ResultEnvelope 语义不变。
2. 发布带自动领取查询的 Host。读取工具清单及一次空闲查询，确认官方身份映射和 RLS 实际工作。
3. 用 Hosted 运行时实际返回的 `openclaw cron add --help` 创建原生 command cron；使用 `--command-argv` 调用已安装脚本，`--work-item-id` 只配置已授权的事项。凭据继续来自既有官方配置，不放入 cron 命令或日志。
4. 页面启用 AUTOMATIC 后，以新 Turn 验证自动领取、实际候选回写和继续提问。既有 Turn、requestId 和 checkpoint 不作为新测试数据。

脚本入口：

```text
node <installed-skill-path>/scripts/consume-hosted-review-turn.mjs --work-item-id <authorized-work-item-id>
```

`--checkpoint-root` 可指定持久私有目录；默认使用 Hosted 用户的 `.openclaw/wiselink-review-runs`，每个 Host ReviewTurn 主键对应一个目录。

## c23 新资料统一入口

在配套 Host 已发布并实际返回 `initialAnalysis` 后，将既有 cron 的 command argv 改为：

```text
node <installed-skill-path>/scripts/consume-hosted-work-item.mjs --work-item-id <authorized-work-item-id> --applicability-context-ref <Host-configured-context-ref>
```

保留原 cron、官方 profile、凭据来源与运行记录；不在开发者电脑运行常驻消费者，不创建第二队列。迁移事项时先确认
当前无在途任务，再使 Host 的 exact WorkItem scope 与 argv 指向同一获准新事项。批量测试也按获准事项逐个切换，
不能据此扩大 owner/tenant 权限。按运行时官方 CLI 的实际 help 操作，不手工改 cron 文件。

c24 每个 tick 默认最多连续执行 Host 指定的四个已就绪初始阶段；每次写回后 fresh-read，再开始下一阶段。
满 15 分钟后不再启动新阶段，已执行步骤不重放；c32 要求原生唯一 cron 的 timeout 为 60 分钟，以容纳
有界 45 分钟全文翻译及提交。翻译每轮通过原 Host heartbeat 续租；原 lease/deadline 不变。依赖计算与同一事项的
CAS 写回仍有序，独立资料读取有限并行。c35 在非 BUSY/NOT_READY 时先检查工程师显式排队的 Review，
有请求即交给原 Review 消费者，并由 Host 验证其实际范围与前提；无请求才推进初始阶段。
Matter Review 可以独立使用已解析材料，不以 JobAid/Overall 完成为前提。初始失败状态和阶段摘要继续返回，
既有失败与 checkpoint 保留，不因 Review 成功而重放或改写初始阶段。
Host 缺少受控适用性事实时，保留 WAITING_INPUT 并允许后续 JobAid/Overall 形成条件性候选。BUSY/NOT_READY
零模型调用；FAILED/CONFLICT 不自动重试，阶段状态漂移或不确定结果均停止报告。阶段 requestId 及已有
remote-step checkpoint 保存在 `.openclaw/wiselink-work-item-runs/<WorkItem>/initial/<operation>`，权限沿用
0700/0600；已开始的模型步骤不会因原生 tick 或重启再次运行。完成记录与 Host 当前投影不一致时报告漂移，不覆盖旧记录。

初始模型适配器只接收既有 operation modelInput，调用唯一官方 Gateway/profile，并只返回该 operation 的候选。
它不执行 Host 工具、不拼 Task/ResultEnvelope、不把本轮控制引用或物理 locator 发给模型。四种输入输出校验、
ResultEnvelope、Translation parts、Host readback/CAS 均复用现有实现。初始候选由 Host 按原有规则更新 revision；
后续普通 Review 候选仍保持 revision/current/STALE 不变，二者都不代表正式采用。

c24 使用 Host 为每个新 ActionAttempt 保存的 executionModel；Translation 从 taskBinding 读取，其他初始分析
及 Review 从 task 读取。两类适配器都只经同一官方 Gateway 的 x-openclaw-model header 路由到已登记模型，
恢复仍使用本任务选择，不跟随之后的全局默认。模型失败明确显示，不改用另一 provider。

## 状态和当前边界

脚本返回 IDLE、BUSY、CANDIDATE_SAVED 或 REQUIRES_ATTENTION。c36 中，Host 已记录的业务失败，
或通过原取消工具精确读回同一 attempt 为 CANCELLED 的失败，返回明确的 REQUIRES_ATTENTION JSON，
以零退出码表示本次消费已处理完毕；它不代表候选成功。未能确认取消、未知提交结果、认证或消费者本身异常
仍以非零退出。旧初始阶段失败不会反复累积 cron 退避并阻断工程师的新 Review。

c36 的交互 Review 对明确的 HTTP 429/502/503/504，或连接建立前的临时网络失败，在本轮原总时限内
最多重试两次，等待 1 秒、3 秒。每次请求和重试均通过 Host heartbeat 重新授权、核对原租约并记录运行进度；
原模型、原生 session、完整消息及来源范围保持。权限、输入、来源错误和可能已送达的断连/超时不盲重放；
提交响应丢失仍只查原结果。运行进度与取证活动分别显示，不能用重试事件满足 SourceRef 引用。
部署 c36 前先发布支持 heartbeat.reviewProgress 和页面回读的兼容 Host。更新期间保持原消费者暂停，
完成后可通过实际官方 Gateway cron.update 的 patch.state.consecutiveErrors 清除该消费者的旧退避计数，
保留最后失败状态和全部历史 run；再调整同一 job 的自然读取间隔。不得直接修改 cron 原始存储或全局退避策略。
不能把本地脚本通过或 cron 已安装当作 Hosted 闭环验收。

c19 本次仅新增自动领取；后续 c20 兼容共同背景，c21 在同一原生 session 内接通按需 SourceRef client-function 循环。
c22 在 Host 提供 `nativeSessionKey` 时承接相同授权范围的跨轮模型讨论，消费者不增加会话注册表或更改 cron。
旧 Host 无该字段时报告逐轮隔离，不能宣称已经承接原生历史。原生运行中 steering、知识空间 RAG 与秒级唤醒仍未接通。
现有 driver 遇到不确定提交仍保留既有只读恢复规则，并明确报告需继续处理；不把“恢复待处理”显示为候选成功。

JobAid v2 复核在驱动提供逐请求 Host 续租回调时，使用与初始问题分析一致的 30 分钟总模型预算，单响应最多 15 分钟；显式更短预算仍生效，续租失败停止后续请求。未绑定续租的直接调用和其他复核沿用原预算。Host 的 30 分钟 lease、60 分钟 deadline 及原生全局/provider 超时均不因此改变。网关以 HTTP 200 返回已确认的公开 idle-timeout 提示时，报告 `REVIEW_GATEWAY_MODEL_IDLE_TIMEOUT` 并停止，不把它当候选或自动重试指令。

JobAid v2 的模型 candidate 只生成答复、引用、问题与工作更新。`reviewActionDraft` 和 `affectedItemIds` 不属于模型函数参数，若模型显式提供则拒绝；驱动在既有完整候选契约中绑定固定的 `null` 与 `[]`。无工作变化时模型可省略 `jobAidWorkingDelta`，驱动按协议绑定 `null`。正文来源放在 `sourceRefs` 或工作认识的依据字段；`candidateEvidenceRefs` 仅限本轮已读取的工程师附件，无附件时必须为空。完整候选仍经过原校验与 Host 事务。

JobAid 复核的答复字段直接位于函数参数根部，不再包裹 `candidate`；工作字段仅放入 `jobAidWorkingDelta`，问题字段仅放入其 `issues`。旧包装、错位字段、额外字段和缺少必填字段均拒绝，不合并或丢弃模型数据。初始分析和复核的函数参数使用标准 JSON Schema `anyOf` 声明可空值，避免原生校验将内部 `nullable` 标注下的合法 `null` 误判为空字符串；空字符串、错误类型和无效枚举仍被拒绝。

明确的 Host MCP 提交拒绝不会被当作成功：只有同一 attempt 的只读结果确认 RUNNING、commitStartedAt/resultContentHash 均为空、projectionApplied/recoveryAvailable 均为 false 时，消费者才调用现有原子取消接口，保存失败原因并结束本候选。网络结果不明、状态读回失败、身份不符或已进入提交阶段均不取消、不重放；Host 的 COMMITTING 截止点继续防止竞争取消。

进程重启后，如已存在明确 Host 拒绝的 commit.error，先核对其与原 commit.started 的调用摘要，以及原 begin.result 与当前请求的绑定，再实时读取同一 attempt。只有当前仍明确未进入提交阶段时才结束失败候选；保留原始检查点，追加本次状态读回，不用新 Skill 版本重新生成旧 ResultEnvelope，也不重放模型或提交。旧状态快照不能授权取消。

来源读取只接受本轮 availableSourceRefIds。已随上下文交付的方法条款和工程师陈述的 evidenceRef 可用于工作依据，但不是读取句柄。整批请求不合法时不读取其中任何片段，也不替换、过滤或映射模型标识；由同一模型在原会话/租约/总时限内纠正，来源请求与候选内容合计最多两次纠正，超限保留失败。

JobAid 的 `responseType` 是可选展示分类。省略时，驱动按是否附带工作更新分别绑定 `RESYNTHESIS_RESULT` 或 `ANSWER`；显式提供的值仍须通过原枚举校验，不覆盖无效值、不改变正文或工作更新、不获得任何正式动作权限。候选仍经过完整校验后才提交 Host。

原生函数先校验参数，再交给驱动。JobAid 的函数 JSON Schema 与现有解码器同时接受声明数组位置的普通数组和精确 `{item:[...]}` 封套；两条分支保留相同元素规则及数量限制。封套多键、item 非数组、单对象替代数组、错误嵌套和未知枚举仍拒绝。这里只解开传输封套，不补工程内容或修改旧失败候选。

JobAid c5 可省略没有新增条目的 sourceRefs、missingInputs、candidateEvidenceRefs、warnings；省略只表达空集合，已提供的 null、空字符串、错误类型不会被修复或替换。工作增量的 retiredIssues 和 unchangedIssueKeys 省略语义与 Host 一致，旧问题仍须完整分区。带已知结果函数失败横幅的原生 idle-timeout 文本也按超时失败收尾，不自动重试。

### 原生并发与 Matter 持续评估接线

每个原生 command cron 只绑定一个获授权 subject：`--work-item-id WI-...` 或 `--matter-id MAT-...` 二选一。同时指定会在连接 MCP 前明确拒绝，不能把 Matter 排在文档初评之后。不同 subject 使用不同原生 job，由 OpenClaw 自带 cron/lane 并发与同 job 不重叠机制管理；“统一消费者”指复用同一执行实现、Host ActionAttempt 和恢复协议，不是全局单线程，也不限制只能配置一个 cron。

本实例于 2026-09-11 只读核实：OpenClaw 2026.6.6 的 `cron.maxConcurrentRuns=8`、`agents.defaults.maxConcurrent=4`、`agents.defaults.subagents.maxConcurrent=8`；不同 sessionKey 使用独立 session lane，同一 sessionKey 串行。上述为实际当前值而非应用硬编码目标；不调用进程内私有队列 API，不为独立业务任务额外创建推理 Agent。Host 现有 ActionAttempt 共享 4 个租约槽，仍由原子领取/CAS约束实际工作。其他平台或模型额外限流需要按实际响应处理。

作业配置必须与 Host 精确目标授权一致；目前 WorkItem 和 Matter 仍分别只有一个显式配置绑定，这不是允许扫描或消费同租户所有事项。多个目标的范围扩展必须接入真实授权后再启用，不能只复制 cron。一个目标不要配置重复 job，避免绕过原生同 job 不重叠；初始化、明确重评和自动来源续接仍遵守该 subject 的依赖和租约。

Matter 独立原文读取沿用 Host 每次最多 8 页的范围接口，仅合并实际请求的连续页，不跨未请求的空隙。每轮最多 4 个独立范围并发，已启动读取全部结束后才进入模型下一步或报告失败；失败不伪装成完整结果，后续未启动范围不继续派发。来源授权、版本、原件检查和读取回执仍由 Host 执行；共享工作保存和最终提交不并发。

安装共享 Skill 前要识别所有使用它的原生 job，并在获授权的维护窗口等待这些 job 空闲；保留各 job 的目标、参数、运行历史及原启用状态。当前 c76 仅完成代码和本地验证，不代表线上作业、并发参数或范围已经迁移。

`next_matter_assessment` 由 Host 根据当前材料版本、覆盖记录和精确前次工作登记来源变化任务。已有活动任务直接读回；相同版本条件下已取消或失败的自动请求不会更换 requestId 重跑。登记依赖单独启用的精确 Matter/actor 服务范围，原 WorkItem allowlist 不授予 Matter 权限。

Matter 使用相同官方 Hosted profile 和 JobAid 模型循环，按物理页读取文本层，并通过 Host `SAVE_WORK` 保存完整工作、按精确 workRef `FINISH`。原件图像、扫描和未读页不声明已核实。提交响应丢失时先读 Host 状态并仅重放已保存的同一结果；模型响应未知时保留 checkpoint 并要求处理，不重复模型请求。这些代码接线不代表安装、启用或真实业务验收已经完成。
