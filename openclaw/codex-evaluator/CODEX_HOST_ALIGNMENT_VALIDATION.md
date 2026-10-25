# Codex 客户端对齐、私有输入留存与启动前关联

日期：2026-10-25，业务时区 Asia/Shanghai。唯一父基线为 **`925deb2d148a9eb8ed508300d7132fce55bc665c`**。继续复用 94c54de 程序初评恢复、925 逐消费者恢复及七项真实 Zod 导出；没有另建恢复框架或队列。

本次改动仅限 `openclaw/codex-evaluator/`、`openclaw/skills/wiselink-research-and-synthesize/scripts/` 和三份协调文档。本地主控 `974bedfa8edb03ba94c4991a2c6a3c63a1145eb4`、标准构建通过及图契约 v1.8 来自用户说明；该本地树未由我方读取、修改、推送或部署。76 文件／45 工具的版本化接口包尚未实际收到。

## 1. 路径、服务身份与 wire 契约

| 项目 | 当前客户端约定 | 服务端证据状态 |
| --- | --- | --- |
| MCP | `/openapi/wiselink/codex-mcp` | 用户给定本地约定；未调用实际服务 |
| 队列 NEXT | `/openapi/wiselink/codex-next-work-item` | 修正 925 客户端的无前缀路径；调用测试使用录制 transport |
| 队列 ACK | `/openapi/wiselink/codex-ack-work-item` | 同上 |
| 队列 BLOCK | `/openapi/wiselink/codex-block-work-item` | 同上 |
| 待用模型配置控制 | `/openapi/wiselink/codex-apply-pending-model-configuration` | 同上；本轮只测构造，不调用生产配置入口 |
| initialize serverInfo | `wiselink-codex-engineering-assessment` / `1.2.0` | 客户端精确核对；实际回执待取得 |
| runtime app | `WL_CODEX_RUNTIME_APP_ID=app_17gr74pbere` | CODEX 配置及任务身份精确校验；实际配置未读取或修改 |
| Task/Result wire 类型 | 合法 `OPENCLAW_*` 类型继续使用 | 不做全局改名 |
| provenance 版本键 | `wiselink-openclaw-engineering-assessment: 1.2.0` 继续使用；执行器单独标记 `model-executor: CODEX` | 新服务名称不自动改写历史 wire 键 |

`mcpServerName`／`toolPolicyRef` 等任务内部 policy 字段暂保留已知 wire 规则，必须再用实际本地包核对；不能将 initialize 身份、policy 引用和 provenance 版本键视为同一个字段。客户端按明确执行器上下文校验新 app，不采用同时接受旧/新 app 的宽校验。旧封存 result、旧 app 任务和未决 UNKNOWN 不被重新标记为新执行器。

现有动态评估和翻译 TaskEnvelope 没有 runtime app 字段；这些路径通过选定的 Codex transport、服务身份以及结果的执行器标记绑定。实际 principal、任务归属与队列授权仍由 Host 决定，不能从客户端标记推导已经取得权限。新鲜零模型的保存工作核对、翻译装配与失败收尾从当前明确上下文写入执行器标记，模型调用数仍为零；既有封存结果不重标。

`export-host-contract.mjs` 通过真实队列客户端和无网络的录制 transport 导出四条客户端预期路径。机器文件的 `serverSource` 仍只代表固定 `fc132291` 旧源码，旧路径/名称是历史事实，不代表新服务绑定成功。客户端预期与服务端固定源码分开保存。

## 2. COMMITTING 的窄恢复

正常 RUNNING 分支仍使用当前 Host 授予的 fence。程序初评的 COMMITTING 分支按以下顺序处理：

1. 按原 `attemptRef` 和 `workItemId` READ，核对执行状态、同一 actionAttempt/WI、封存结果的 workRevisionRef、版本与内容结构，取得原 `revision.requestId`。
2. 以相同 attempt/WI 加上该 `requestId` 再次 READ，核对同一完整修订；两次 `revision` 必须规范化后完全一致。
3. 仅恢复 Host 原冻结的 ResultEnvelope，沿原 commit/投影恢复入口收尾，并核对同版 Overall。**不调用模型，不重新 SAVE。**

请求形状均来自既有 `read_assessment_work`：

```json
{"attemptRef":"<原 attempt>","workItemId":"<原 WI>"}
```

```json
{"attemptRef":"<原 attempt>","workItemId":"<原 WI>","requestId":"<上次 SAVE 的原 key>"}
```

这里是已有请求字段的示意，不是新 Host 接口。测试拒绝同 key 但 attempt/WI/修订内容变化、原 key 变化、错误执行状态或不相关 Overall。读取同一最新版本不足以跳过按原 key 独立核对。本次客户端增量不覆盖本地主控同类窄修；最终集成须核对双方实现。

## 3. 私有输入和进程关联

| 私有文件 | 内容与时点 | 与已有恢复证据的关联 |
| --- | --- | --- |
| 父检查点 `<step>.codex-run.json` | runner 启动前写入；requestId、原 argsHash、规范化 runRoot/runDirectory、gateway binding hash、prompt hash | 与同 step 的 started/result、消费者 SAVE/READ 回执并存，不替代它们 |
| `generation-binding.json` | 原确定性 requestId、请求 body hash、prompt hash、执行参数 | 沿原 gateway 的 run 占用和恢复检查 |
| `codex-prompt.txt` | 实际给 CLI stdin 的完整 UTF-8 prompt；启动前私有落盘 | promptSha256；恢复时验证内容和私有权限 |
| `upstream-request.json` | bridge 完成转换及限额设置后的最终 JSON body，保存**实际传给 HTTPSConnection.request 的相同字节**；发送前 fsync | 既有 transport summary / generation receipt 增加 upstream_request_sha256 |
| `upstream-response.json` | 既有完整解析后 Chat Completions SSE 事件数组 | 原 receipt 的 upstream_response_sha256；不是原始 SSE、HTTP 或 TLS 字节 |
| `contract-candidate.json` / `adapted-response.json` | 原结构化候选及完整适配响应 | 原结果校验、response hash、消费者结果记录继续使用 |
| `transport-summary.json` / `generation-receipt.json` | 进程退出、终止事件、模型调用/模型名、关闭事实及完整回执 | 不能替代 Host 保存、投影或 ACK |

父关联记录通过现有 checkpoint 的原子持久写入，gateway 必须等待写入成功后才启动 runner。落盘失败或原关联不一致时不启动新进程。若进程在创建 run 后、父关联发布前死亡，尚未启动模型；原 deterministic requestId 仍对应原目录，恢复遵守已有 UNKNOWN 规则，不猜测性重发。该窄补没有构建另一套恢复状态机。

实际接入程序初评、WorkItem 翻译、文档翻译、文件阅读、普通 Review、Wiki SUMMARY 和 MATTER。每轮或每块使用原请求身份；不会把共用 gateway 当作每个消费者已验收。即使某个显式 CODEX 调用没有启用持久恢复索引，runner 也保存完整 prompt 和最终上游 body；这不自动赋予该消费者恢复能力。

私有目录/文件沿 0700/0600、原子写及文件/目录 fsync。认证头、连接密钥不进入新增请求体文件或父关联记录；完整业务正文不输出到公开验证报告。新成功回执要求新输入证据齐全；旧缺失证据不补造、不触发重发，本轮不添加旧任务兼容。

## 4. 42 项与未取得的 45 工具本地包

`contracts/host-packet-comparison.json` 保持 **`PENDING_LOCAL_PACKET`**，42 项逐项 pending。没有从 GitHub 猜取本地未推送 SHA，也没有生成一个假“本地包”代替交付。比较器收到真实版本化工具包后复用原逐名称对照逻辑；额外工具仅登记，不能据此扩大现有客户端授权。

新增的差异分类为：

| 分类 | 判断与保留 |
| --- | --- |
| `EXPRESSION_EQUIVALENCE` | 仅在无 schema 引用的前提下规范化已知不改变约束的集合/union 顺序和纯说明注释；保留实例 const/enum 内实际数据。带 `$ref`、`$id` 或 anchor 的 schema 除对象 key 顺序外保持原形，避免位置引用因排序改变含义 |
| `REAL_INPUT_RESTRICTION` | 数值/长度上下界、required、严格对象、动作/phase 分支、pattern 等约束结构的变化；不能为了匹配而删除限制 |
| `ZOD_HOST_BUSINESS_SEMANTICS` | format 接受语义、dialect/ref/default、`x-*` refine 信息以及必须由 Zod/Host 证明的语义；权限、版本、fence 等不因 schema 相同而通过 |

安全整数上/下界、UUID 的版本/variant/NIL/MAX/大小写/空白接受集合、严格对象及全部动作分支列入重点核对。比较器保留原 sourceSchemaStatus、semanticLimitations 和 runtimeRefinements；所有形状结论都明确**不证明授权或 Host 业务接受**。七项真实 Zod 4.6.5 的 54 分支／56 接受／184 拒绝证据继续复用；另外 35 项仍是受限机械转换。

比较器的合成包测试只证明比较工具行为，包括额外三项的范围控制，不是对实际本地包的验收。

## 5. 文档翻译尚待 Host 的明确契约

客户端继续保留原 NEXT 请求、generationRequestRef、原 attempt/fence、workspace、任务/版本、purpose、块集合、batchHash、完整响应及保存意图。现有已知 Host 行为下，新 CLAIM 换 fence，原 REGISTERED/SAVED generation 无法由客户端自行换绑。

Host 需给出原 generation 的精确状态/原 SAVE 回执查询，以及未保存时受控恢复授权。契约应明确查询的真实工具/动作/参数、完整保存修订与结果摘要、旧/新 fence 的授权关系、tenant/actor/版本/CAS 检查和拒绝码。客户端取得契约后再补成功与拒绝用例；本轮不虚构字段或新动作。

已保存只查询并读回；未保存须取得 Host 明确新授权；UNKNOWN 不盲目重发。`synthetic-authorized-same-fence` 保留为局部历史测试名称，不能代表真实文档翻译恢复完成。既有默认 Host 行为的阻断测试继续保留。

## 6. 离线验证及文件边界

最终命令、计数、返回码和受测源码 SHA-256 见 [`host-alignment-validation-results.json`](host-alignment-validation-results.json)。前轮 166 项报告和 94c54de 历史报告保留原样；新结果不改写历史。测试使用实际 Node 消费者/gateway、真实 Python runner/bridge 的离线替身，无新增真实模型或业务 Host 调用。进程 SIGKILL 测试不等于断电、磁盘/容器/持久卷丢失验证。

最终冻结验证为 **20/20 条命令、200/200 个实际子测试通过**，没有超时或输出截断；104 个代码/测试/契约文件的前后 SHA-256 相同。另对原七项执行真实 Zod 导出复核，仍为 54 分支／56 接受／184 拒绝，35 项机械输入样例也通过；schema 用例不重复计入 200。先前集成检查中临时缺失导出的 import 失败已修复，最终完整验证重新运行并保留了此前观察，不把修复前结果算作通过。提交前补入位置 `$ref` 与 union 重排的反例，防止错误判为表达等价。

| 验证组 | 实际子测试数 |
| --- | ---: |
| gateway / runner / bridge（含完整输入与原回执） | 25 |
| 程序初评恢复与 COMMITTING 收尾 | 26 |
| 翻译/阅读恢复及启动前关联 | 31 |
| Review/Wiki SUMMARY 与 MATTER 恢复 | 30 |
| 路径/身份、零模型、适用性实际 adapter、配置预检 | 14 |
| 接口包比较器与 artifact 证据 | 18 |
| 既有 assessment session、model executor、summary gateway、Review 消费者回归 | 56 |
| **合计** | **200** |

新增验证重点是四条队列调用、明确 runtime app/旧封存拒绝、同 key 的完整 COMMITTING READ、逐消费者启动前关联及中断不重发、完整输入字节留存和篡改拒绝，以及比较器不吞掉 refine/strict/边界差异。代码与测试的准确文件清单随机器结果提供。

## 7. 本地主控接续项

1. 交付 **实际** 76 文件／45 工具包，连同准确 manifest、文件 hash、Host commit/version、initialize 和 tools/list。取得后运行 `node openclaw/codex-evaluator/compare-host-interface-packet.mjs <packet.json> <report.json>`；若该包是目录，使用其中真实版本化 tools/list，不能自构等价替代包。
2. 核对四条控制路由、serverInfo、新 runtime app、principal/tenant/actor/enrollment 和上述任务 policy 字段。只报告配置项和是否具备，不发送凭据值；本次没有配置或调用生产入口。
3. 合并核对 Host COMMITTING 窄修与本客户端两次 READ、完整修订比较；取得文档翻译原 generation 查询及受控跨租约恢复契约。
4. 确认私有持久 checkpointRoot/runRoot、监管与目录保留后，按已准确授权的新任务范围安排首个真实 SAVE、独立 READ、Overall/ACK 和页面阅读闭环。
5. 由本地主控统一纳入 [图契约节点/边增量](../../docs/coordination/WISELINK_CODEX_GRAPH_DELTA_20261025.md)，再按 [有界 worker 方案](../../docs/coordination/WISELINK_CODEX_BOUNDED_WORKERS_20261025.md) 规划 1→2→同组4。当前 batch 4 仍串行；本轮未启用并行 worker 或 CLI 子代理。
