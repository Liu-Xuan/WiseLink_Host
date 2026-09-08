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
