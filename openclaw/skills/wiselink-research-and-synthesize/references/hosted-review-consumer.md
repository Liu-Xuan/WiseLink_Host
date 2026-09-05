# 页面自动领取

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

## 状态和当前边界

脚本返回 IDLE、BUSY、CANDIDATE_SAVED 或 REQUIRES_ATTENTION；后者及异常以非零退出码交给原生 cron 运行记录。不能把本地脚本通过或 cron 已安装当作 Hosted 闭环验收。

c19 本次仅新增自动领取；后续 c20 兼容共同背景，c21 在同一原生 session 内接通按需 SourceRef client-function 循环。
c22 在 Host 提供 `nativeSessionKey` 时承接相同授权范围的跨轮模型讨论，消费者不增加会话注册表或更改 cron。
旧 Host 无该字段时报告逐轮隔离，不能宣称已经承接原生历史。原生运行中 steering、知识空间 RAG 与秒级唤醒仍未接通。
现有 driver 遇到不确定提交仍保留既有只读恢复规则，并明确报告需继续处理；不把“恢复待处理”显示为候选成功。
