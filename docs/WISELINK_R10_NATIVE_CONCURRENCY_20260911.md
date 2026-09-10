# R10 原生并发修订（2026-09-11）

用户明确要求充分利用妙搭与 OpenClaw 原生框架，独立工作尽可能并行。本修订澄清 v5 §15.3：“统一消费者”指统一执行、身份、持久任务及恢复机制，不是全局串行队列，也不是全系统只能配置一个 cron。无需新建调度服务或第二业务队列。

## 已核实的能力

现有 Hosted 管理会话 `conversation_4ky0f6r24fz90` 的只读核实回合 `7684028800950520762`，从本实例 OpenClaw 2026.6.6 / 8c802aa 的 CLI help、配置 schema 和已安装代码得到：

| 机制 | 当前值/行为 | 原生依据 |
|---|---|---|
| cron 跨 job 并发 | `cron.maxConcurrentRuns=8`；同 job 的 runningAtMs 排除重叠 | `server-cron-BUhoP9it.js` 1554–1565、1655 |
| 模型全局主 lane | `agents.defaults.maxConcurrent=4` | `applyGatewayLaneConcurrency`、`agent-limits-DGV0ALs8.js` |
| 原生 subagent lane | `agents.defaults.subagents.maxConcurrent=8`；业务执行无需为此增加推理 Agent | 同上 |
| 会话隔离 | 不同 sessionKey 可以并行，同一 session lane 默认串行；仍共享 main 限额 | `embedded-agent-L9tQiaO-.js` 2199–2227、`command-queue-DGvXlE4p.js` |
| HTTP 会话选择 | 已配置 Gateway 支持 `x-openclaw-session-key`；现有驱动已有独立任务会话绑定 | `http-utils-leZWdpma.js`、现有 `run-hosted-review-turn.mjs` |
| Host 并发执行 | ActionAttempt 已有 4 个共享租约槽，WorkItem 与 Matter 复用同一机制 | `action-attempt.types.ts`、`matter-action-attempt.service.ts` |

这些是当前实例证据，不是全局默认值承诺。未核实的上游配额和其他限流不视为不存在；不通过增加 job 或切换会话绕过额度。OpenClaw 进程内 lane JS 函数不是稳定外部接口，不从业务代码直接调用。应用继续复用妙搭数据库/RLS/FileService 和已配置官方 Hosted profile。

## 实现方式

每个原生 command job 只绑定一个明确授权目标，调用同一消费者脚本：WorkItem 使用 `--work-item-id`；Matter 使用 `--matter-id`。同时给出两种目标明确拒绝，防止将 Matter 隐藏在文档初评之后。不同 job 的调度、公平领取和并发由原生平台管理；同一目标不配置重复 job。旧 WorkItem 已有初始阶段依赖和显式 Review 语义保留。

Matter 通过当前来源身份、版本和 coverage 发现增量，使用真实 Matter subject 领取同一 ActionAttempt；运行中出现新资料是后继工作，不重启当前生成。没有待办不调用模型。取消不复活，生成未知与提交未知仍按同一请求和已存结果回查。

独立来源读取使用既有 Host 范围接口：每次合并最多 8 个连续且实际请求的物理页，每批最多 4 个范围并发。整批句柄先校验，所有已开始的读取结束后才继续；任一失败向调用方明确报告，不返回虚假的完整读取。授权、原件身份、读取回执仍由 Host 执行。共享工作保存与最终提交保持事务/CAS顺序。

## 实际安装与调度状态

用户明确批准更新并继续后，2026-09-11 维护回合 `7684034052894231835` 已通过官方命令安装 c76。42 个文件逐字节与摘要一致，265 项安装后测试通过，实际 Host MCP initialize/tools/list 核对通过：29 个必需工具加 pending 工具，共 30 项。Host 在线 `0b134c9e4` 与该安装兼容；Skill 源码为 `46fa461f0`。

恢复回合 `7684035369997765615` 已将原 job `8db789fa-4fe9-4e58-850c-97b4cd70eb46` 恢复 enabled=true。目标仍为 `WI-d09b7acc-2221-4e51-addd-e040ce3c68f4`，每 60 秒、原 anchor、cwd、timeout 和历史均保持。官方 API 不支持独立清除旧失败退避，未修改状态文件；读回 nextRunAtMs=1789080817892。06:24 已在普通页面“继续问题评估”受理新请求 `ATT-42f35eff-c60e-4312-b130-2fde15f4ae4c`，事项模型仍为 GPT 5.6 Sol。旧失败请求保持取消，不重放。

当前服务配置仍为单 WorkItem 和单独显式 Matter/actor 绑定，不能凭本修订将可执行范围扩大为同租户全部对象。第二个原生 job 尚未启用；拟绑定现有工程事项及其原 actor 的具体授权仍待确认。

真实验收必须同时观察两个独立 subject 的运行重叠、同目标不重叠、错误隔离，并完成原目标的完整初评和一次来源变化后自动续接。安装校验、代码异步测试和原生能力核实不替代该业务验收。
