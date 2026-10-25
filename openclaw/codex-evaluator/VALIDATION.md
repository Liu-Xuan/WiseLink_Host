# 妙搭模型驱动 Codex 评估循环：实现与验证记录

验证日期：2026-10-25 UTC。

## 当前程序消费者与 Wiki 实跑（合成 Host）

本次迁移使用新应用自身已配置的妙搭 `miaoda/glm-5.3`，由 `codex-cli 0.164.0` 执行。隔离运行目录为 `/home/gem/workspace/agent/workspace/wiselink-codex-migration-20261025-0812`；65 个运行文件的传输载荷 SHA-256 为 `684285f290ffe959be3c19e6c4b35955f4eef6de60734e723878e27b1b8d8dfa`。完整脱敏机器回执见 [consumer-validation-evidence.json](consumer-validation-evidence.json)，其 SHA-256 为 `4792c13352d42b6064d3fcf973211c40acd50905304fad8ef5e47df1825f956b`。

| 合成材料运行 | 上游 `glm-5.3` 请求 | 结果 | 用时 |
| --- | ---: | --- | ---: |
| 程序消费者：初评、翻译 GENERATE/CHECK、文件解读 | 4（分别为 1、1、1、1） | 退出码 0；初评 SAVE 后以同一 requestId 独立 READ；译文校核完成；文件解读准确复制引文 | 48.474 秒 |
| 分层 Wiki：选定两子层和共同根来源 | 2 | 退出码 0；生成父层候选，Codex 子进程回执闭合；候选未保存到 Host | 18.204 秒 |

六次请求均有正常完成的 Codex 进程和 `glm-5.3` 上游模型记录，执行前后来源配置哈希相同。这些运行使用虚构材料和内存合成 Host，`realHostCalled: false`；程序的确定性 Overall 输入仅为准确已保存、独立读回的合成工作修订，不是正式 Host Overall 提交。它们不验证真实业务授权、Host 持久化、正式采用或产品阅读入口。

真实 Host IDE 的只读观察显示工作目录 `/home/gem/workspace/code`、分支 `sprint/default`、HEAD `2565662e45c679605aacd318d873d41d73d262c7`，工作区状态有 1,124 项。没有修改 Host 文件；发布版本是否包含本次变更未经核实。当前 Host 仍需独立的 Codex 运行身份、授权和任务分配，才可允许 CODEX 消费者领取真实任务。

以下记录的是**早期自主评估 fixture**：九次模型请求、两次合成工作保存及 Overall 模拟提交。它与当前 `PROGRAM_CONTROLLED_V1` 一次模型生成的默认路线分开，不应合并计数或当成这次六请求消费者实跑。

## 早期自主评估交付状态（历史，非当前默认路线）

已实现可注入现有 Host 编排器的 Codex 评估回调，并在独立妙搭测试实例内完成真实模型的端到端运行。实际模型为实例已有的 `miaoda/glm-5.3`，执行器为官方 `codex-cli 0.164.0`。运行不依赖 OpenAI 账号或 OpenAI API key。

本次运行的 Host 是明确标注的内存模拟实现，材料是运行时生成的虚构测试台泵记录。它验证模型、Codex、MCP、保存回读及结束协议；不证明正式 Host 已授权、已持久保存或已在产品阅读入口展示。机器证据见 [validation-evidence.json](validation-evidence.json)。

## 实现与复用

源码基线为 `Liu-Xuan/WiseLink_Host` 的 `94c24efa746984a7edbf8b76719e1ffcfa549bed`，来自 `codex/native-assessment-delivery-20261024`。本交付仅新增 `openclaw/codex-evaluator/`，不改现有默认执行路线。

复用现有 JobAid 指导、工作稿类型校验、确切工作版本投影以及 `evaluateDynamicRules` / `synthesizeOverall` 回调契约。指导和工作稿结构文件与旧应用已安装 c239 的对应文件一致；源码基线本身声明 c235，不能据此声称已迁移整个 c239 安装或已取得 c240 生产身份。

模型续接由 Codex 管理。适配层仅转换 Miaoda Chat Completions 与 Codex Responses 的文本/函数调用协议、暴露一个受绑定的 `assessment_step` MCP 工具，并校验其业务意图。现有 Host 编排器继续负责身份、租约、CAS、事务、候选提交与采用边界。

共享对话链接受浏览器来源限制，未取得其正文。实现依据独立取得的评估交接材料及实际源码契约，不能称为对未读对话的逐项复刻。

## 最终实跑结果

| 项目 | 初始评估 | Overall |
| --- | ---: | ---: |
| 妙搭模型请求 | 7 | 2 |
| 成功上游响应 | 7 | 2 |
| 完整工具调用/返回对 | 6 | 1 |
| 业务工具成功 | 5 | 1 |
| 业务工具拒绝后纠正 | 1 | 0 |
| 正常结束 | 是 | 是 |
| 阶段用时 | 40.046 秒 | 11.713 秒 |

工具返回次数与业务成功次数分开统计。唯一一次业务拒绝为 `WORK_BASELINE_READ_REQUIRED`：模型试图在未读取基线时更新 overview，工具拒绝；模型随后读取准确已保存版本，再提交修订成功。没有放宽校验或由程序代填模型参数。

实际链路为：

1. 读取实际生成的虚构来源记录。
2. 保存工作修订 1，并通过同一 requestId 独立回读确认。
3. 根据校验反馈读取工作修订 1 的基线。
4. 保存工作修订 2，并通过该次 requestId 独立回读确认。
5. 初始评估对已验证修订执行 FINISH。
6. Overall 检查已有工作，并由工具再次独立读取准确修订。
7. 模拟 Host 的 Overall commit 使用相同 workRevisionRef，随后正常结束。

两次真实执行的保存钩子均有独立回读。总计 4 次读取工作，其中 3 次带 requestId（包含一次额外基线读取），另一次是 Overall 的确切版本回读。

最终状态：2 个问题，`workRevision=2`，`overviewStatus=CURRENT`，`roundCompletion=COMPLETE_WITH_OPEN_QUESTIONS`。初始结果、Overall 输出及模拟提交的引用完全一致：

`fixture-work-revision-2-c4b366e8-ea77-4481-aa15-7364dd7375cb`

Overall 保留已完成且 CURRENT 的工作，没有为制造保存次数额外创建修订。该行为符合既有契约；Overall 候选提交与创建新工作修订是不同事件。

## 模型、凭据与执行范围

两个阶段上游均报告 `glm-5.3`。没有产生 Codex `auth.json`，Codex 子进程环境未提供 OpenAI 凭据，原应用配置文件执行前后相同。平台 SecretRef 只在实例内解析，Codex 只接收临时本地回环能力。

测试明确设置 `reasoning_effort=low` 和每请求 16,384 输出 token 上限。在此前诊断中，默认推理设置曾耗尽 8,192 输出 token，因此本次采用有界的软件验证设置。供应商文档说明 GLM-5.3 支持 low/high/max 且不能关闭推理；代理接收参数不单独证明后端内部怎样落实该档位。[供应商说明](https://docs.z.ai/guides/capabilities/thinking)

本次最终两阶段累计上游报告输入 135,314 token、输出 2,743 token。输入统计包含每次请求的上下文重传，不是不同资料的净 token 数，也不是账单金额。该单一虚构样本不构成质量或性能基准。

没有执行完整网络出站审计；不据此承诺进程绝无其他网络行为。运行日志留在实例的私有运行目录，公开交付仅包含代码与虚构数据的运行元信息。

## 本地检查

- `assessment-session.test.mjs`：10 项通过，覆盖确切回读、版本和绑定冲突、未知保存结果不重复提交、明确拒绝后的修正、提前结束拒绝、CURRENT overview、准确基线与缺失参数反馈。
- `test_miaoda_responses_bridge.py`：8 项通过，覆盖工具白名单、namespace 双向转换、调用 ID、SSE、重复 JSON 键、预算和截断响应、推理档位转发。
- 本地 HTTP 测试采用模拟上游/处理器；真实网络、MCP 注册和工具执行由上述妙搭实跑验证。

## 真实业务接入仍需完成

目标实例的配置盘点结果为 `hostMcpConfigured=false`、`readyForBusinessExecution=false`。没有复制旧应用的 Host 凭据或冒用旧运行身份。

真实接入需由 Host 为实际执行实例建立合法运行绑定和所选业务任务权限，并核对 skill/provenance 策略。然后在完整既有 Host 消费者中注入这两个回调，执行真实 SAVE、独立 READ、Overall commit，再检查资料库、Wiki、知识入口读取同一版本。

未知 SAVE 结果的 requestId 在本次活动回调内保留，不会重复提交；进程或容器重启后的自动恢复尚未接入既有持久 checkpoint/reconciliation。完成这项接入前，不应自动重启一个可能已经写入的新尝试。

现有飞书、浏览器、记忆等 OpenClaw 插件不会自动变成 Codex 工具；本版只注册评估业务工具。需要其他能力时应按实际需求接入相应适配器及既有授权。

执行和集成入口见 [README.md](README.md)。
