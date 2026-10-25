# WiseLink Codex：部署前独立审查与最小离线验证准备

日期：2026-10-25（北京时间）  
交付范围：最小验证步骤、明确发现及证据、必要补件。  
配套证据：[WISELINK_CODEX_PREDEPLOYMENT_AUDIT_20261025.evidence.json](WISELINK_CODEX_PREDEPLOYMENT_AUDIT_20261025.evidence.json)。

## 1. 结论和版本范围

**当前收到的源码能证明：每个完整保留恢复绑定的程序初评 run，bridge 最多向妙搭上游派发一次应用层 POST；不能据此证明 Codex 到 loopback 的全部 HTTP 请求、妙搭内部推理或计费恰好一次。**

本轮还发现一个具体的恢复衔接缺口：启用消费者预算时，首次模型调用留下的 `active.kind=modelRequests`，在原回执恢复成功后可能仍阻止 SAVE。该问题在已核云端源码中静态可定位；没有最终本地字节，不能断言它存在于 `0b48366/542edca3`。这是后续窄审的具体项目，本轮未改产品。

| 工作 | 本轮结果 | 尚未成立的结论 |
| --- | --- | --- |
| 既有 12 项 Linux 专项的最小包 | 已核环境前提、候选测试源、离线边界、写入范围、判据；原 12 项名单和选择命令未收到 | 不能宣称已形成准确的 12 项可执行包，更不能登记通过 |
| “一次模型请求”审查 | 程序、恢复、runner、bridge 的调用与计数已核；复用相关现有离线测试 | 不能宣称准确 CLI 0.164.0 所有内部重试分支已实测，不能证明平台内部派发数 |
| 最终组合／图／批准窄审 | 缺件已具体到文件和用途 | `0b48366`、`542edca3`、v1.9.1 图和 A/B/C 批准范围尚未验定 |

冻结状态仍按用户提供的信息记录：本地首测组合 `0b48366`、同树 Host 后继 `542edca3`，完整构建通过，12 项 Linux 专项未验证。该构建状态没有在本云端重新执行。

本次实际源码取自 GitHub 的准确提交：

- 仓库：`Liu-Xuan/WiseLink_Host`。
- 分支：`codex/miaoda-codex-evaluation-loop-20261025`。
- 源码观察提交：`53a42d98d20e0616c5a58b19ac80ce8a38b82e78`。
- tree：`5fad81ea68727c537d79f5553bde70ec00c93b26`，完整递归清单 5,034 项，未截断。
- 独立审读快照的 156 个已有文件逐项计算 Git blob，全部匹配该树，0 差异。
- `53a42d9` 为既有对照文档提交，产品源码基线仍为 `19d58915982c740690080b8db3e355828810ff38`。本交付只新增审查文件，不覆盖产品或本地主控工作树。

检索结果：本轮 GitHub 对 `0b48366`、`542edca3` 均返回 422／未找到提交；可见最新附件仍为 `WiseLink_Host_Codex_Interface_f57d8863.zip`，原 ZIP SHA256 为 `c67a519d46341499e95cb320725b5b759ba5631e71b42ad01e5306cd594f67d3`。这是“本轮未取得最终字节”的依据，不能推断本地提交不存在。旧 f57 对照成果沿用，不重新做全量 schema 比较，也不把旧包当最终版本。

## 2. 一次请求的逐层结论

本次核查的是程序初评的 CODEX 路径：

`run-program-assessment → requestModelGateway → createCodexGateway → run_codex_generation.py → loopback bridge → 妙搭上游`。

| 层 | 实际约束与观察 | 证据 |
| --- | --- | --- |
| 程序初评 | generationPolicy 固定 maxModelRequests=1；恢复键为 `program:${attemptRef}:round-1`；先落 started，已 started 时 `recoverOnly=true`；不完整输出和错误 JSON 终止，没有修复模型轮次 | P1，15、45、86–143、174–192 行 |
| 消费者预算 | dispatch 前持久预留 ordinal 和 active；异常不返还。其字段是 dispatchReservations，upstreamDispatchCount 明确为 null | P6，2189–2256 行 |
| 执行器选择 | 明确 CODEX 才进入 Codex gateway；该分支无自动 HOSTED 回退或本层重试 | P2，37–45 行 |
| 恢复 gateway | 同 requestId 派生固定目录；排他 claim；已有 run 只核对并读／等原 receipt，不再次启动 runner；缺失、损坏、超时退出 | P3，263–264、294–344、345–387 行 |
| Codex runner | 生成 provider 配置的 request_max_retries、stream_max_retries 都为 0；一次 exec；超时关闭，不重新启动 | P4，132–175、234–272 行 |
| bridge | `max_requests=1`；锁内先消耗预算，再调用唯一的 HTTPSConnection.request；任何失败都不归还，不重试 | P4，234–238 行；P5，298、346–358、399–414 行 |
| 妙搭服务内部 | 当前客户端看不到其内部重试、模型派发与计费明细 | 不作推断 |

当前官方配置参考将 `request_max_retries` 定义为 provider HTTP 请求重试次数，将 `stream_max_retries` 定义为 SSE 中断重试次数。该说明支持配置意图，但它是当前文档，并非固定 0.164.0 的源码或故障注入证明：[官方配置参考](https://developers.openai.com/codex/config-reference/)。

### 2.1 真正阻止上游再次派发的位置

P5 的 346–358 行在同一把锁中检查并递增预算，之后才保存上游请求 bytes、建立连接并发送 POST。并发 loopback 请求也只有一个能通过。异常路径没有重试循环，也没有 count 回退。

所以即便 CLI 内部又向该 bridge 发出合法 POST，也会得到 `request_budget_exhausted`／429，不会变成该 bridge 的第二次上游 POST。此保护独立于两个 retry 参数。

范围是同一 bridge／同一保留恢复绑定的 run。更换 attempt、变更请求键、删除原检查点或换一个全新 runRoot，不属于同请求恢复的证明范围，不能用它们处理 UNKNOWN。

### 2.2 四种“次数”不能混用

| 字段或计数 | 准确含义 |
| --- | --- |
| 应用 modelCallCount | 调用 initial model executor 的次数；一次回执恢复也可使其增加 |
| 消费者 dispatchReservations.modelRequests | 执行前的保守预算预留数；不是物理 HTTP 计数 |
| transport.model_requests | 已写入 bridge audit、且在 request 调用前标记 upstream_attempted=true 的条目数 |
| 妙搭实际接收／模型推理／计费数 | 当前资料未给出；不能从前三者换算 |

P4 的 279–280 行按 audit 汇总；P5 的 357 行在 request 前设 attempted，413–414 行在 finally 追加 audit。因此：

- request 内 DNS、TLS 或 socket 失败时，attempted 可为 1，但服务端可能尚未收到。
- 构造连接之前失败时，预算已消耗，attempted 仍可能为 0。
- POST 发出后，若进程在 audit 落盘之前死亡，记录可能缺失。
- **异常或缺失回执中的 model_requests=0，不能作为重新派发授权。**

成功闭合还有更强约束：P4 的 324–334 行要求 `model_requests==1`、`len(audit)==1`、唯一记录 HTTP 200、准确模型、stop、无工具调用／bridge 错误、完整最终对象与工件、进程组关闭。若 CLI 第二次合法 POST 被 429 拒绝，新增 audit 会使成功条件失败。

但未通过鉴权的 POST 在 P5 的 312–313 行提前返回，GET 也不计入这种 audit，所以即使 len(audit)=1，也不能写成“所有 HTTP 流量恰好一次”。

### 2.3 超时、断流和输出错误

| 场景 | 当前源码动作 | 再次模型派发 |
| --- | --- | --- |
| started 已写，runner 尚未建立，父进程退出 | recoverOnly 查不到原 run，报 UNKNOWN | 无 |
| 原 runner 仍存活 | 等待原 receipt | 无 |
| 父进程退出，原 runner 已完成 | 读取并校验原 receipt，恢复稳定响应 | 无；启用消费者预算时另见第 3 节 |
| gateway 超时或 abort | 停止／退出等待；保留恢复绑定，后续只恢复 | 无 |
| 上游 non-200、连接异常 | bridge 失败，预算已消耗 | 无 |
| 流缺少合法结束、length、非法工具输出 | bridge 或最终解析拒绝，不修复生成 | 无 |
| 最终 JSON 不合法 | 本地记录 final_error／候选拒绝 | 无 |
| receipt 或原请求／响应／prompt 哈希不匹配 | 拒绝恢复 | 无 |
| SAVE ACK 丢失 | 查 Host 原 SAVE key，独立 READ | 不调用模型 |
| 换新 attempt、删除检查点、另建 runRoot | 已离开原请求恢复边界 | 本轮未授权这种处理 |

### 2.4 模型原请求与 Host SAVE 原请求

**模型恢复键**是 `program:${attemptRef}:round-1`，用于本地 run 目录和回执索引。当前 bridge 没有妙搭 provider 的原请求状态查询接口，GET 一律拒绝。完整回执丢失时，查询本地工件不能自动证明 provider 的结果。（P1、P3、P5。）

**Host SAVE key**由程序写入 `program-save-request`。SAVE 前先按原 key 读，ACK 不明后仍按同一个 key 独立 READ；这查询的是 Host 业务保存结果。（P1，205–246 行；P7，239–250 行。）

本轮保留原完整响应、argsHash、父 run 关联和原请求查询实现。既有 `upstream-response.json` 保存的是通过解析的 SSE JSON 事件；它不是原始传输字节，也没有承诺留存每种失败情况下的半截网络流。

## 3. 具体发现 F2：预算与回执恢复之间有未覆盖衔接

**状态：已在收到的云端源码静态定位，未做该组合全链故障复现；最终本地是否已补齐待准确文件。**

适用条件：首测开启了 `jobAidRunLimits`，首次模型 dispatch 的预算完成步骤尚未成功，而原 Codex run 随后存在可恢复的完整回执。

实际路径：

1. P6 的 1909 行把程序请求接入 `jobAidBudget.dispatch('modelRequests', perform)`。
2. 2231–2234 行先持久保存 `active.kind='modelRequests'`。
3. 请求抛错或父进程在 complete 前死亡；2236–2244 行保留 active。
4. 重启后，P1 的 97–131 行发现已有 started，以 recoverOnly 直接 perform，避免再预留一次模型额度。
5. 原完整回执恢复，P1 将完整响应写回。
6. SAVE 进入 P6 的 1776–1778 行，再调用预算 dispatch。
7. P6 的 2221 行见 active 仍非空，抛 `JOBAID_RUN_OUTCOME_UNKNOWN`，SAVE 被阻止。
8. 2249–2256 行 reconcile 只处理 saves 和 finishes，没有处理“已由原回执核定完成的 modelRequests”。

**影响是恢复后无法继续保存，不是暗中第二次生成。** 不能通过清空预算、增大上限或换新请求来掩盖它。

现有程序恢复测试 T3 与 fixture 没有接入消费者预算；现有预算测试 T5 验证 UNKNOWN 保留，但没有 CODEX 程序回执恢复与 SAVE 的组合。两边分别通过不足以证明这一衔接。

最终文件到齐后，只需定点核 `consume-hosted-work-item.mjs` 与 `run-program-assessment.mjs`：若本地已补，核对准确绑定和原额度不增加；若未补，把这一个具体差异交本地主控决定。任何修订都须基于已核原回执，保持 UNKNOWN 不盲重发。本轮不修改冻结实现。

## 4. 既有 12 项 Linux 专项：已准备什么、缺什么

### 4.1 原 12 项还不能准确识别

已核两份相关现有文件：

- L1：`automatic-work-item-finalization.test.mjs`，27 个 owner 实例，另有 1 个普通 CLI 参数测试。
- L2：`automatic-work-item-queue.test.mjs`，5 个 realOwnerTest 实例。
- 合计 32 个 owner 相关实例。**这是定位候选，不是本轮新增验证清单，也不是用户的 12 项。**

L1 的 24–27、55–78 行及 L2 的 1793–1822 行显示：非 Linux 上这些用例会改名为 `non-Linux owner rejection contract: ...`，验证拒绝逻辑。因此 macOS 同名文件通过不等于 Linux 锁、FD、进程死亡释放通过。原“12 项未验证”究竟来自哪个筛选或另一文件，尚缺原命令／名单，当前状态保持 `PENDING_EXACT_12_TEST_SELECTION`。

### 4.2 已核的运行前提

可复用的只读检查：

```bash
node --version
node -p 'process.platform'
command -v flock
flock --version
```

本云端实际检查结果是 Linux 6.18.55 x86_64、Node v24.22.1、Python 3.12.14、util-linux flock 2.39.3。这里只证明本环境有这些入口，不证明妙搭实际宿主、生产挂载或监管已验收。

需使用一份准确版本的独立审读／测试目录，并将 TMPDIR 指向专用临时根。测试需要能写文件、fsync、持有 flock 和启动／终止自己创建的子进程。不要指向真实 checkpointRoot 或 runRoot。

已完成两个生产模块的纯 import 检查，退出 0；没有调用 client factory 或 consumer。静态扫描中的 `shared/assessment-reading.interface` 是 JSDoc 类型引用；`@modelcontextprotocol/client` 是实际创建客户端时才动态加载，定点替身测试不调用该工厂。无需为这项离线准备安装或登录外部服务。

### 4.3 写入目录与隔离事实

| 对象 | 现有测试写入范围 | 清理与约束 |
| --- | --- | --- |
| finalization | TMPDIR 下 `wl-queue-finalization-*` | 测试 finally 删除自己的目录 |
| queue 实例 | TMPDIR 下 `wiselink-invocation-race-*`、`wiselink-invocation-live-race-*`、`wiselink-invocation-two-failures-*` | 各测试 finally 清理 |
| checkpoint | 合成 active-claim、归档、failure receipt、`active-claim.owner.lock` | 目录 0700、锁文件 0600，不接真实持久目录 |
| 进程死亡验证 | 仅测试自行启动的 Node 子进程 | 观察 OWNER_HELD，杀该子进程，再核原 lock inode 和重取锁 |
| flock 缺失验证 | 仅测试进程暂改 PATH 并 finally 恢复 | 不写用户／系统配置 |

L1 的 dependencies 把 BLOCK 换成内存回执，领取／ACK／模型默认 assert.fail；L2 的目标实例也用合成状态和注入回调。生产 `finishBlockedAutomaticClaim` 则确实会发 BLOCK 并写归档（P6，1107–1125 行）。**不得直接执行生产 `--finish-blocked-claim` 或 `--auto-queue` 来充作离线测试。**

### 4.4 可复用命令入口及判据

以下是当前两份候选文件的既有运行入口，**本轮未执行，也未把它们作为 12 项替代方案**。收到原 12 项名单后应复用其原选择，不追加这 32 项作为新门槛。

```bash
node --test --test-concurrency=1 \
  openclaw/skills/wiselink-research-and-synthesize/tests/automatic-work-item-finalization.test.mjs

node --test --test-concurrency=1 \
  --test-name-pattern='^real checkpoint: ' \
  openclaw/skills/wiselink-research-and-synthesize/tests/automatic-work-item-queue.test.mjs
```

若独立使用上述入口，第一条对应 27 owner + 1 普通参数测试，第二条对应 5 个目标实例；名称不匹配的 skip 不算通过。其数量说明不能换写成“12 项全绿”。

原 12 项到齐后的最小执行步骤只有：

1. 将原命令／选择表达式与准确最终测试 bytes 绑定，确认确实选中原 12 项。
2. 在 Linux 的专用临时目录执行同一命令，保留实际环境、stdout/stderr、退出码和目标用例结果。
3. 逐项按既有断言判定；目标无 fail、cancelled 或 skip 才可登记为该环境通过。
4. 现场宿主仍由本地主控验证对应文件系统、监管和持久目录；本云端结果只写本云端。

失败判据：非 Linux 只走拒绝分支；缺 flock、权限或 fsync/锁语义不支持、导入缺件、超时，均不能记为 Linux 验证成功。竞争者进入消费回调、claim 被迟到响应覆盖、归档／回执不符、进程死亡后锁不能重取，是实际失败，应保留原结果。不得修改校验或用同名非 Linux 结果补齐。

## 5. 本轮实际运行的现有离线验证

本轮只运行与请求派发／回执恢复问题直接相关的既有用例，没有执行上面的 32 项候选集合，也没有确定或执行原 12 项 Linux 专项。

| 命令 | 工作目录 | 实际结果与范围 |
| --- | --- | --- |
| `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest test_miaoda_responses_bridge test_run_codex_generation_recovery` | 源码根／openclaw/codex-evaluator | 12 个 Python unittest 通过，0.258 秒；fake server／HTTPSConnection 与 fake Codex CLI |
| `node --test openclaw/codex-evaluator/program-recovery.test.mjs openclaw/codex-evaluator/codex-generation-recovery.test.mjs` | 源码根 | 输出汇总为 2 个测试文件通过、0 fail，3.383 秒；不把文件数当场景数 |
| 两个生产入口模块的纯 import | 独立审读根 | 退出 0；没有调用客户端工厂或业务入口 |

**这里的“12 个 Python unittest”与用户所说的“12 项 Linux 专项”没有对应关系。** 本轮没有据相同数字进行替代。

T1 验证预算在上游连接构造失败后仍消耗、后续被挡；T2 使用伪 CLI 的版本串与合成工件，不验证真实 CLI 的内部重试。T3/T4 覆盖原响应恢复、SAVE ACK 丢失后原 key 查询、started/receipt 异常不重发、父关联写失败、活 runner 等待和请求／响应／prompt 哈希核对。它们没有覆盖第 3 节的消费者预算组合。

本环境未发现所需准确 Codex CLI 0.164.0 可执行文件；PATH 无 codex，已有其他版本不作为替代。本轮未启动真实 Codex CLI、真实模型或 Host，也未读取运行凭据。

## 6. 最终组合独立复核只待这些补件

| 补件 | 最小内容 | 解决的具体问题 |
| --- | --- | --- |
| M1：原 Linux 12 项 | 原始执行命令／选择参数、准确 12 个名称、未验证／skip 日志、对应冻结测试文件 bytes 或 SHA | 将第 4 节准备收口为准确 12 项包 |
| M2：最终代码边界 | `0b48366`、`542edca3` 完整 commit/tree 身份，准确范围 diff 或文件及哈希；可提供这些范围文件，无需重交全量 schema 包 | 证明最终本地实际吸收了哪些云端增量，哪些本地窄修仍在 |
| M3：图与批准文件 | v1.9.1 图准确 bytes／SHA256；A/B/C 拟批准文本的版本、bytes／SHA256 | 对齐同一首测范围和异常查询边界，不凭标题判断 |
| M4：实际 CLI 身份 | 本地主控正在核查的可执行入口、version、可执行文件／安装包身份；生成的 provider 配置字段，不含密钥值 | 核对部署选择能满足当前 runner 的 0.164.0 要求；不会因此自行新增 CLI 试验 |

M2 的客户端最小关注文件：

- `program-assessment-materials.mjs`：保留实际 availableSources／evidenceRef／unit／locator 映射，不能按冒号固定位置拆 identity。
- `orchestrate-host-mcp.mjs`：RUNNING 当前 fence 下定位原 SAVE key 并再次精确读回；COMMITTING 只读核对冻结结果。
- `consume-hosted-work-item.mjs`：保留 COMMITTING 原 attempt/WI/SAVE key 绑定的必要 READ；核本次发现的预算恢复衔接。
- `run-program-assessment.mjs`、`model-executor.mjs`、`codex-generation.mjs`、`run_codex_generation.py`、`miaoda_responses_bridge.py`：完整响应、实际 prompt、最终上游 body、预启动父关联及原 run 恢复一致。
- Host 侧实际发生变化的 service-scope、begin/claim、SAVE、原请求查询、独立 READ 与结束入口；未变化者可用准确 byte equality 证明，不重做整套 schema。

收到后只给“保留／具体差异／缺件”结论。重点仍是三处本地修复未丢、授权范围未扩大、原完整响应与原 key 查询一致。图和 A/B/C 批准的编写、最终批准和现场执行继续由本地主控负责。

批准文本中“一次模型请求”宜准确写为：

> 单个新事项、单个 worker、一次程序生成；保留同一恢复绑定时，客户端 bridge 最多向妙搭派发一次上游请求。模型 UNKNOWN 先查原 run 回执，Host 保存 UNKNOWN 按原 SAVE key 查询；没有完整证据不更换请求重跑。妙搭内部模型派发与计费次数以平台可提供的实际证据为准。

该句是本轮审查得到的范围表述，不构成部署、凭据配置、业务切换或单事项实测批准。

## 7. 可复核源码索引

下列链接全部固定到本次审查提交；SHA256 来自实际读取的文件字节。行号在正文中用于定位，不能代替文件版本。

| 代号 | 固定源码 | SHA256 |
| --- | --- | --- |
| P1 | [run-program-assessment.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs) | `1b729324e759099e4070f49b5faa2edca326a96f1db6e7b67bbadbee92772cc9` |
| P2 | [model-executor.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/scripts/model-executor.mjs) | `02d4f44236f5b8e659edaa9d88cf1688d7008e5acebe52d0bd3e54b94c34865c` |
| P3 | [codex-generation.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/codex-generation.mjs) | `fd0d77f118d312292db8580a7f1f153be712029a98e5c0774c7ca8e0bebb31fe` |
| P4 | [run_codex_generation.py](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/run_codex_generation.py) | `4596a24630cfbdf96006aed8f06aa26d2c534111313b0890e3b00c3a912682ef` |
| P5 | [miaoda_responses_bridge.py](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/miaoda_responses_bridge.py) | `52e9b093ba293bab7479a3b1105d4db750605b49143054ec5a5133111ba3a632` |
| P6 | [consume-hosted-work-item.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs) | `8d7e282a53d6a904e21fdfaf7d45f87942740ebe7d77e3444704da1714f692ad` |
| P7 | [initial-assessment-recovery.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs) | `9b2f3a53735a56faaa6aa7c266c43e05daabec8178d21f5809df27d6754d778e` |
| L1 | [automatic-work-item-finalization.test.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/tests/automatic-work-item-finalization.test.mjs) | `0b47bd80cf0437000c1fed5000192e631522ec7ec6091e6005729f2207dd38fd` |
| L2 | [automatic-work-item-queue.test.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/tests/automatic-work-item-queue.test.mjs) | `7af96f7e9915a564a9e836eb9f10c31cbaf575fcf68da36a66901c7a7e9e056a` |
| L3 | [run-hosted-review-turn.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs) | `644329c74c8332a906e5830d5f7a0d6c3b39ea8307c8547c4050d0ef3ca114fd` |
| T1 | [test_miaoda_responses_bridge.py](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/test_miaoda_responses_bridge.py) | `bbb7d18c4b16f9fe57fe0817edf5082573341e165caee152d66516e64570b04a` |
| T2 | [test_run_codex_generation_recovery.py](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/test_run_codex_generation_recovery.py) | `039923fb934b8109000671224d52e5b0b264c7b529ff152590f5044d0f1888b2` |
| T3 | [program-recovery.test.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/program-recovery.test.mjs) | `1e331b15b2a747257da89376fdb230526c15b45df4e370b1aaa54f1c3fd47823` |
| T4 | [codex-generation-recovery.test.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/codex-evaluator/codex-generation-recovery.test.mjs) | `2f81e6537e33ada90471b2721d84772bcff5a92e5530ccd75ecf9e44e0ca25e6` |
| T5 | [jobaid-run-limits.test.mjs](https://github.com/Liu-Xuan/WiseLink_Host/blob/53a42d98d20e0616c5a58b19ac80ce8a38b82e78/openclaw/skills/wiselink-research-and-synthesize/tests/jobaid-run-limits.test.mjs) | `01f2113e783cf09a1b7aa472d3af65323208b8fa6861ab9a284d5a8c072c9155` |

## 附：Linux 候选定位表（未执行，非原 12 项）

此表用于本地主控快速找到既有用例，不要求增加验证范围；最终原 12 项名单优先。

| 源码 | 行区间 | 静态展开实例数 | 既有内容 |
| --- | --- | ---: | --- |
| L1 | 81-100 | 1 | 精确BLOCK回执和claim归档后释放 |
| L1 | 102-112 | 6 | 准确claim字段变化拒绝 |
| L1 | 114-125 | 7 | 无效BLOCK回执拒绝 |
| L1 | 127-134 | 1 | BLOCK传输未知不重发 |
| L1 | 136-141 | 1 | 归档写失败保留claim |
| L1 | 143-154 | 1 | 归档成功、clear失败后的重入 |
| L1 | 156-168 | 3 | 重复结束不覆盖新generation、新事项或空claim |
| L1 | 170-175 | 1 | 归档缺失或篡改拒绝 |
| L1 | 177-186 | 1 | 竞争finish拒绝 |
| L1 | 188-199 | 1 | 等待替身期间持锁防止ABA |
| L1 | 201-230 | 2 | 迟到ACK或attention仍受owner保护 |
| L1 | 232-261 | 1 | 异常及子进程死亡释放内核锁 |
| L1 | 263-271 | 1 | flock缺失时拒绝执行 |
| L2 | 1824-1853 | 3 | 迟到失败不覆盖新generation、新事项或空claim |
| L2 | 1855-1875 | 1 | 同租约竞争消费者拒绝 |
| L2 | 1877-1902 | 1 | 两次失败保留独立回执 |

总计 32 个 owner 实例；L1 的 273–282 行另有 1 个普通 CLI 参数测试，不纳入上述数量。

