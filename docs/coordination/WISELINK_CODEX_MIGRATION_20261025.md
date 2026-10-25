# Codex 消费者迁移与真实 Host 接线

日期：2026-10-25。来源基线：程序控制评估 `f821bfe3447367e4d4bc9e140723c92230fc82ed`；既有 Codex 评估循环 `0b33e8bf814d6b6eefebae70c956f556a4db3246`。本记录区分源码、隔离运行和真实 Host 业务运行。

## 交付边界

新应用为 `app_17gr74pbere`；真实 Host 为 `app_17bzc551rsg`；旧执行应用为 `app_17c3zn24kv2`。新执行器是 Codex CLI 0.164.0，模型仍为新应用自身已配置的妙搭 `miaoda/glm-5.3`。不需要 OpenAI 账号或 OpenAI API key。读取新应用现有模型配置只为使用其获准模型路由，不复制旧应用凭证或修改该配置。

本批添加显式 `modelExecutor: 'CODEX'`；未指定时保留现有 Hosted 路线。共同的有界生成适配器将一次 Codex 最终 JSON 转换为一次既有函数候选，候选仍由原领域代码校验和保存。每次适配器调用只有一次上游请求；程序初评调用一次，Review/Wiki 的原程序循环可以按自身预算安排多次。适配器不替 Host 执行业务工具。

## 实际消费者清单

| 工作 | 接入点 | Codex 候选状态 |
| --- | --- | --- |
| 程序初评 | `run-program-assessment.mjs` | 接入；保留一次模型请求、完整响应、正常 SAVE、独立 READ |
| 适用性、初始生成 | `invoke-hosted-initial-model.mjs` | 接入；保留原输入与结果校验 |
| JobAid、后继评估、事项 | `run-jobaid-problem-assessment.mjs`、`consume-hosted-matter.mjs` | 接入；保留完整工作、CAS 与原请求恢复 |
| 翻译生成、更正、检查 | `invoke-hosted-translation-block.mjs` | 接入；保留分块、锚点还原、术语和检查结果校验 |
| 文件解读 | `invoke-hosted-document-reading-model.mjs` | 接入；引用文本由准确原文还原 |
| 活动建议、引文选择 | `invoke-hosted-document-activity-model.mjs` | 接入；保留来源和候选约束 |
| 工作台 CHAT/UPDATE | `run-hosted-review-turn.mjs` | 普通程序工具循环接入；读取、Aily 查询和最终候选仍由程序安排 |
| 派生摘要、分层 Wiki | `invoke-hosted-derived-summary-model.mjs`、`consume-hierarchical-wiki-queue.mjs` | 接入；保留成员/根来源、候选与检查点，采用独立 Codex 进程回执 |
| 初评 Overall | 现有程序投影 | 保持确定性投影，不额外调用模型 |
| 隔离 Native Review 模式 | `native-temporary-review-gateway.mjs` | Hosted 专用；CODEX 明确拒绝，不伪造 Native 关闭回执 |
| 早期 v1 action worker | `scripts/run-openclaw-action-attempt-worker.mjs` | 历史 Hosted 专用；CODEX 在 claim 前明确拒绝，未宣称迁移 |

主消费者、Review CLI、Wiki idle 均传递显式执行器配置。已有 CODEX 检查点不能被 Hosted 消费；无执行器标记的旧检查点只兼容 Hosted。UNKNOWN/COMMITTING 不因安装新包被重放或迁移。Wiki 活动指针同样绑定执行器，只有各真实子进程闭合证据满足时才能释放。

另有 Host 直接使用官方能力的标题增强、备用 Translation V2 插件、定点更正、Aily 对话和原文解析。它们并非 OpenClaw 推理调用。本批保留其真实生产者和已有权限；确定性章节映射、原系统事实、正式采用及阅读也不改为模型调用。不能通过全局替换名字来改变这些工作。

## 图契约

沿用 v1.7 的 13 个 nodeId。`document.reading`、`document.translation`、`assessment.applicability`、`assessment.research`、`knowledge.wiki` 改变的是内部生成后端。`assessment.overall` 在程序初评中仍消费准确保存并独立读回的同版工作。译文只服务阅读，工程判断仍使用原文；任一已保存成果不等待 Overall 才可读。运行图从原请求、保存、读回和收尾记录投影，不增加第二调度器或静态完成开关。

## 真实 Host 交互与 MCP

Host 已用官方 `@modelcontextprotocol/server` 和 `@modelcontextprotocol/node` 实现标准 MCP，可信消费者使用官方 `StreamableHTTPClientTransport`。继续复用该实现。SDK 负责协议、schema 和传输；Host 继续负责身份、来源授权、请求归属、租约、幂等、事务/CAS、独立读回和正式采用。关闭网络连接不能证明模型、SAVE 或外部事务已经撤销。

推荐分工：可信消费者领取准确任务、读取材料、调用有界 Codex、验证候选并通过 Host 既有服务保存；模型不拿队列凭证。自主评估模式另通过受限 assessment broker 暴露业务意图，Host 仍掌握控制字段。长任务以持久请求、状态和结果恢复，不能把 MCP 会话是否仍在线当作恢复协议。

可用的开源实现：

- 官方 TypeScript SDK：<https://github.com/modelcontextprotocol/typescript-sdk>。与当前 Node/Nest Host 最匹配，本批无需更换框架。
- 官方 Python SDK：<https://github.com/modelcontextprotocol/python-sdk>。适合以后将本地 Python stdio 适配器标准化。
- FastMCP：<https://github.com/PrefectHQ/fastmcp>、<https://gofastmcp.com/getting-started/whats-new>。可简化独立 Python 服务，但不替代 Host 的业务持久化与授权。
- Codex MCP 文档：<https://developers.openai.com/codex/mcp>。

## 并存与接线状态

旧连接不必先解除。两套进程和配置可以并存；当前不能同时开启两个无分流的自动领取器。现有 Host API key 网关使用统一系统身份，业务授权适配器由单组环境变量提供一个 service principal，不能根据调用方随意填写的 appId/header 区分执行器。现有 discovery 记录还固定旧 runtime app ID。租约/CAS 防过期写入，但不等于任务已经按执行器分配。

本批真实 CLI 在 CODEX 模式要求 Host 返回独立 MCP 身份 `wiselink-codex-engineering-assessment`、版本 `1.2.0`；当前旧身份不能通过，因此在业务 claim/queue 之前拒绝。这里是未完成的 Host 集成边界，不把新客户端配置当成授权证据。

### 推荐迁移方式：进程可并存，业务保持单一活动执行器

本次目标是替换 OpenClaw，推荐先让 Codex 做隔离实测，旧执行器继续承担业务；正式切换时停止旧消费者的新领取，核清原请求，然后一次切换 Host 的规范执行器配置、凭证绑定、MCP/discovery 身份，只启动 Codex 业务消费者。现有进程级配置可以支撑这种有序替换，不必为了隔离验证先建设长期双执行器平台。

旧 UNKNOWN/COMMITTING 必须得到权威终态，或通过明确排除和原 owner 恢复路径处理。停止旧进程本身不能证明未知写入已经结束；当前按租户查询的队列也没有自动排除这些旧任务。只有要求两套执行器长期同时处理真实任务时，才必须进一步实现请求级双主体授权，以及持久化的执行器分配与领取隔离。这些切换能力目前尚未在真实 Host 实施。

以下是同时提供独立 Codex 入口时的最小可信接线；单一执行器切换可复用现有授权对象与配置结构，无需保留两个同时活动的业务主体：

1. 在准确获准 Host 发布分支加入独立 `/openapi/wiselink/codex-mcp`，路由选择服务端固定的 Codex runtime 身份和授权适配器，不改变旧 endpoint/principal。
2. 在妙搭为新应用签发独立凭证，仅允许该精确路径。凭证路径限制必须实际回读和正反访问验证，不能只看 UI 选项存在。
3. 业务调用用现有 request-local 上下文方式选择真实授权；明确绑定允许的新任务和 runtime attribution。缺配置时拒绝，不能回退旧身份。
4. 先连接与 tools/list，再验证一个准确分配的新任务及其保存、独立读回和收尾。之后才开放按任务种类或任务 ID 分配的队列入口。
5. 旧在途继续由旧 owner 恢复；停旧消费者时先停止新领取并核清原租约、UNKNOWN 和 COMMITTING，不清检查点或借 TTL 宣称旧进程已停。

`probe-host-mcp.mjs` 可对合法新凭证做旧 endpoint 的 initialize/tools/list 兼容性核验，不构造队列客户端、不调用业务工具，并明确输出 `runtimeIdentityIndependentlyBound: false`。它不把旧服务器元数据包装成新身份。

本次 UI 观察：发布版 Host 页面可加载；开发预览显示启动失败。凭证页存在旧专用凭证与按 API 限权界面，但新建凭证的指定 API 列表为空；一次正常开发服务重启后仍显示失败。未创建全 API 凭证，未复制旧 key，未更改旧凭证或业务消费者。独立 Host 身份、凭证路径和真实业务接线尚未完成。

随后对真实 Host IDE 作只读核对：工作目录为 `/home/gem/workspace/code`，分支为 `sprint/default`，HEAD 为 `2565662e45c679605aacd318d873d41d73d262c7`，工作区状态列出 1,124 项。没有修改 Host 文件，也没有核实其发布版本包含本批源码。本次审查的 Host 源码仍使用旧 MCP 服务器身份和单一 service principal/租户授权配置；自动队列按租户查询候选，尚未按执行器分配。真正区分执行器的服务端身份与任务分配仍是启用 CODEX 业务消费者的前提，不能从客户端自报的 appId 或请求头推断授权。这是源码审查结论，未以真实凭证调用线上 MCP。

## 校验与限制

本地已通过 26 项 Node 测试、9 项 Python bridge 测试，以及两个合成材料 fixture 的 dry-run。覆盖结构化候选转换、非指定模型拒绝、未闭合进程、Wiki 指针保留、双向执行器切换、旧 COMMITTING 隔离、准确引用及旧评估 broker 的保存/读回规则。没有用本地测试声称真实 Host 已保存。

真实模型隔离验证已完成，机器回执见 [consumer-validation-evidence.json](../../openclaw/codex-evaluator/consumer-validation-evidence.json)（SHA-256 `4792c13352d42b6064d3fcf973211c40acd50905304fad8ef5e47df1825f956b`）。在新应用 `app_17gr74pbere` 的隔离目录 `/home/gem/workspace/agent/workspace/wiselink-codex-migration-20261025-0812` 安装并核对 65 个运行文件，传输载荷 SHA-256 为 `684285f290ffe959be3c19e6c4b35955f4eef6de60734e723878e27b1b8d8dfa`。执行器为 `codex-cli 0.164.0`，六次上游请求均报告 `glm-5.3`，每次运行正常闭合且来源配置前后哈希相同。

`run-consumer-fixture.mjs` 用时 48.474 秒、退出码 0：程序初评一次模型请求，程序保存一份合成工作后以同一 requestId 独立读回；确定性 Overall 的输入指向该准确已读回修订。翻译 GENERATE 和 CHECK 各一次，文件解读一次并准确还原来源引文，共四次请求。`run-wiki-fixture.mjs` 用时 18.204 秒、退出码 0：两次请求读取选定的合成子层/共同根来源并生成父层 Wiki 候选，Codex 进程回执闭合；Wiki 候选**未保存到 Host**。两项运行均只使用合成 Host 材料，`realHostCalled: false`，不证明真实业务授权、保存、正式采用或产品阅读。早期自主评估的九次请求记录是另一项历史 fixture，不属于当前程序控制默认路线。

输入与 prompt 受现有 bridge 约 1 MiB 上限约束，超限在发起模型前明确失败，不静默截断。默认输出上限 16,384 tokens，硬上限 32,768，调用方更小的预算继续生效。此版本只支持明确的 `miaoda/glm-5.3` 路由并核对实际返回模型；其他已注册模型不能被默默替换。自主 assessment broker 的跨进程持久恢复仍应另行完善，当前程序消费者的已有检查点与不确定结果边界继续保留。
