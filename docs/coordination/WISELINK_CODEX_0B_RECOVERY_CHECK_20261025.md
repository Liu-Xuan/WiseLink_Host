# 准确 0b：模型预算恢复与原 12 项 Linux 专项核查

日期：2026-10-25。审查基线为用户本轮提供的准确客户端源码包；本轮只增加本文件、证据 JSON 和两个离线复现脚本，不修改冻结产品、Host 工作树、图、配置或批准范围。

## 结论

**确认存在一个有条件的恢复缺口：程序初评显式启用 `jobAidRunLimits` 时，进程在模型预算登记后退出；下次已成功恢复同一请求的完整响应，仍因 `active=modelRequests` 未结束而在 SAVE 前返回 `JOBAID_RUN_OUTCOME_UNKNOWN`。** 正常对照完成 SAVE 和阶段 commit；中断对照的合成生成总数始终为 1，SAVE 为 0。该结论需要本地主控做最小修复，不能通过退款、重置预算或重新调用模型解决。

准确原 12 项是 **9 项 Node Linux 专项 + 3 项 Python `RunnerRecoveryTests`**，本云端 Linux 全部通过，目标项跳过为 0。它们验证 gateway/runner 的恢复与进程边界，没有覆盖上述“消费者预算 + 程序初评恢复”的组合。两项结论并不矛盾。它们也不能代替实际妙搭宿主 Linux 验收。

适用范围限定为显式启用预算且产生在途 `modelRequests` 的恢复路径；未启用该预算的默认消费者不在本次缺陷证明范围内。没有运行真实 Codex CLI、真实模型或 Host 业务闭环。

## 1. 输入身份与文件边界

| 对象 | 本轮准确值／证据性质 |
| --- | --- |
| 附件 | `WiseLink_Codex_Client_Source_0b48366e.zip`，1,412,244 字节 |
| ZIP SHA-256 | `6fffdc91af8bc5afda5376f4e9a55511bbc2916ba4ed6bdfa8e6d5cd50e885d2` |
| receipt 所列源码提交 | `0b48366e09d25999fa99f707780b4009bd2931f7` |
| receipt 所列源码树 | `4c3ca0bec908d23dc78b15d683f27e6dccf4649b` |
| receipt 所列 Host 后继 | `542edca3432c73eee48818575f8bf11543ceb455` |
| `DELIVERY_RECEIPT.json` SHA-256 | `4818ab0b5b01c688dbdaa9fccf5c9d948646fbce08ba14887eea8e8b0ad09945` |
| 包内校验 | 217 个源文件逐一核对字节数与 SHA-256，0 缺件、0 额外文件、0 不匹配；全部执行后再次核对，原 217 文件未变 |
| 云端审查材料父提交 | `4b49725a4d7a2429bcaed0fb720e91fbff1adb58` |

Git 提交／树身份来自附件 receipt；本轮独立验证的是收到的完整包字节和逐文件清单，不宣称已从 GitHub 拉取本地 0b 或 542 的完整 Git 树。receipt 中“完整构建通过”是本地交付记录，本轮没有重跑构建。用户所述图提交 `db8638e` 和 A/B/C 请求不是本轮重新审查的文件，本文不替它们给出批准。

可复用交付文件仅为：

- `docs/coordination/WISELINK_CODEX_0B_RECOVERY_CHECK_20261025.md`（本文件）。
- `docs/coordination/WISELINK_CODEX_0B_RECOVERY_CHECK_20261025.evidence.json`（包身份、源码定位、原始执行输出和检查点证据）。
- `docs/coordination/wiselink-codex-0b-repro-20261025/repro.mjs`（导入原包的离线故障复现）。
- `docs/coordination/wiselink-codex-0b-repro-20261025/run.sh`（正常对照、实际 SIGKILL、同请求恢复及前后文件采集）。

这两个脚本是独立审查工具，不属于产品运行入口，不需整包合入 Host 或加入正式业务启动命令。上轮材料中的“未收到准确 0b 字节／未确定原 12 项”在本轮已解决。

## 2. 预算缺口：实际源码与离线反证

### 2.1 真实调用链

下列行号均属于上述哈希绑定的 0b 包。`scripts/` 指 `openclaw/skills/wiselink-research-and-synthesize/scripts/`。

| 文件与行号 | 行为与本问题的关系 |
| --- | --- |
| `scripts/consume-hosted-work-item.mjs` 1712–1715、1927 | 加载阶段预算，并把模型调用包装为 `jobAidBudget.dispatch('modelRequests', perform)` |
| 同文件 2211–2251 | 无预算且无历史预算时返回 null；启用后先持久化计数和 `active={kind:'modelRequests'}`；任何已有 active 会阻止下一次 dispatch |
| 同文件 2253–2273 | 正常 perform 返回后清除 active；已有 reconcile 仅识别原 SAVE 读回和阶段结束状态，没有模型响应恢复的完成分支 |
| `scripts/run-program-assessment.mjs` 97–124、131 | 看到同请求 started 后走 `recoverOnly`，有意绕过新模型预算登记，避免再消耗一次模型额度 |
| 同文件 140–149 | 保存完整恢复响应，核对原 requestId 和原响应 SHA-256 |
| 同文件 203–233 | 确定候选和原 SAVE 请求，按原 key READ；未保存时进入 SAVE |
| `scripts/consume-hosted-work-item.mjs` 1782–1789、2238 | SAVE 再经过预算 dispatch；仍在途的 `modelRequests` 直接抛 `JOBAID_RUN_OUTCOME_UNKNOWN`，尚未调用 Host SAVE |

外层没有阻止这个组合进入：`initial-assessment-recovery.mjs` 19–27、70–97 识别准确绑定、旧租约过期、deadline 未过期、原 started 和无 result 的 Codex 恢复候选；103–114 核对续租后同 task/attempt 和更高 generation。消费者 1722–1725 允许恢复 prior UNKNOWN，1941–1943 复用已有 assessment marker。复现走这些原函数，不摘取函数另写预算实现。

### 2.2 实际执行结果

测试导入原 `consumeHostedWorkItem` → `invokeHostedInitialModel` → `run-program-assessment`，复用已有 `programRecoveryData`。固定一个 WI、`EVALUATE_JOBAID`、一个阶段、`PROGRAM_CONTROLLED_V1`、`modelExecutor=CODEX`，预算为模型／SAVE／结束 `1/1/1`。

| 观察 | 正常对照 | 实际中断后同请求恢复 |
| --- | --- | --- |
| 公共消费者结果 | `INITIAL_STAGE_SAVED` | `REQUIRES_ATTENTION` |
| 错误 | 无 | `JOBAID_RUN_OUTCOME_UNKNOWN` |
| 合成生成总数 | 1 | 1 |
| 恢复原响应次数 | 0 | 1 |
| SAVE 回调次数 | 1 | 0 |
| 阶段 commit／FINISH 回调次数 | 1 | 0 |
| 预算模型／SAVE／FINISH 计数 | `1/1/1` | `1/0/0` |
| 最终 active | null | `{"kind":"modelRequests"}` |

中断由测试进程对自身实际发出 SIGKILL，shell 记录退出码 137。合成 gateway 已把原请求 body、requestId 和完整 response 写入文件，消费者尚未来得及结束模型预算。旧租约在第一次执行时有效；脚本等待 2 秒后才恢复，合成 Host 对同 task/attempt 发放更高 generation 的新租约。没有靠“首次就过期的 begin”人为制造恢复入口。

恢复结果已经满足以下事实：

- 原模型 requestId 始终为 `program:AQ-fixture-program-recovery:round-1`；gateway 强制同 body、同 ID、`recoverOnly=true`，拒绝第二次生成。
- 原响应与程序实际写下的 `assessment-round-1.result.value.raw` 完全相同；完整 raw SHA-256 为 `9bd760ebb59d967f75e1c6893b6785914a63fef849caee9d883e5a06ff5cd103`。
- 原程序已经生成 `program-save-request`，但 Host SAVE 回调次数仍为 0。
- 恢复前后 `jobaid-run-budget.json` 逐字节相同，SHA-256 都是 `6ff8963202982c4f76e3b0022ed62ba6518cec2a2b4de137f1f403e29de1f04f`；测试没有修改／退还额度或手工清除 active。

这是对消费者预算衔接的实际离线复现。Host、模型网关与 Codex 回执为显式替身；该复现没有启动真正的 `createCodexGateway`、Codex CLI 或上游传输。因此合成生成次数 1 不是本轮真实上游 HTTP 请求数证明。原 12 项中的 Node/Python 测试分别执行真实 gateway/runner 搭配 fake runner/CLI，它们的证明范围见第 3 节。原始执行记录和源码／脚本哈希均在配套 evidence JSON 中。

### 2.3 为什么已有测试没有关闭此问题

`program-recovery.test.mjs` 39–53 走程序初评恢复 fixture，未接消费者的预算包装；`jobaid-run-limits.test.mjs` 229–244 的预算 UNKNOWN 用例走旧的非程序 Hosted 路径；`program-assessment.test.mjs` 514–529 检查首次预算拒绝。SAVE 丢 ACK 的预算恢复覆盖 `active=saves`。这些用例分别有效，不能推出 `active=modelRequests` 加上程序恢复的组合已被验证。

### 2.4 交本地主控的最小修复条件

本轮不提交产品补丁。修复应在确认**原在途模型调用已有准确完成证据**之后，结束该 reservation 的 pending 状态，保留既有消费计数。需要保持：

1. 只接受同 task/attempt/checkpoint、同 argsHash、原 requestId、原 response SHA 的完整持久响应／回执；不得用“任意恢复成功”结束预算。
2. 模型计数仍为 1，不退款、不归零、不增加额度、不改 selection／ordinal、不启动另一模型调用。
3. 缺失、损坏或绑定不符的回执仍为 UNKNOWN；begin、heartbeat 或无关 READ 成功不构成模型调用完成证据。
4. SAVE 继续经过自身预算、Host 当前 fence／权限／CAS 和原 key 精确查询；原有 COMMITTING 只读核对及原冻结结果恢复规则保持有效。
5. 若在完整 response 已落盘、预算 pending 尚未结束之间再次退出，下次也能用该完成证据继续；不能只在首次收到 recovery 返回值时临时解锁。

当前 `active=modelRequests` 本身不存完整请求绑定，修复必须复用原 program/checkpoint/receipt 绑定验证，不能只按 active 的 kind 泛化清除。该窄修在离线组合中应得到：原生成总数 1、SAVE 1、阶段结束 1、预算 `1/1/1`、active=null；失败分支仍保留 UNKNOWN。由本地主控交准确后继版本和受影响验证，本文不宣称问题已修复。

## 3. 原 12 项 Linux：准确名单、命令与边界

receipt 原记录为 `nodeLinuxSkipped=9`、`pythonLinuxSkipped=3`。准确名称从本轮包中 Linux skip wrapper／class 导出，并逐项对照本轮输出。没有用 32 个候选测试或另一批 12 个 Python 测试代替。

### 3.1 名单

Node 文件 `openclaw/codex-evaluator/codex-generation-recovery.test.mjs`，Linux wrapper 为 10–12 行，文件 SHA-256 `98559703a2dd31048a3a4315a5e6f83dd460db0b3692362597be03ffaa2c1235`：

| 行 | 原测试名 | 本轮 |
| --- | --- | --- |
| 82 | `restart after runner receipt and before caller checkpoint returns exact stable response once` | PASS |
| 138 | `creates nested runRoot parent chain before making its exclusive recovery claim` | PASS |
| 148 | `an existing live runner is joined without a second dispatch` | PASS |
| 164 | `killed parent with a live runner resumes its completed receipt without redispatch` | PASS |
| 176 | `aborting a recovery wait leaves the active runner available for a later retry` | PASS |
| 191 | `missing claim, dead runner and mismatched or malformed receipts never dispatch` | PASS |
| 211 | `a changed original upstream response fails the recovery receipt hash` | PASS |
| 220 | `a changed final upstream request fails the recovery receipt hash` | PASS |
| 229 | `changed or exposed private prompt is rejected before parent linkage and never redispatched` | PASS |

Python 文件 `openclaw/codex-evaluator/test_run_codex_generation_recovery.py`，Linux-only class 为 41–42 行，文件 SHA-256 `25cd7948a033e807c39f0a16a60dfcfdba07270ee7e8908b59aa8436b6322989`：

| 行 | `RunnerRecoveryTests` 原方法名 | 本轮 |
| --- | --- | --- |
| 102 | `test_completed_runner_atomically_records_full_source_and_closed_receipt` | PASS |
| 122 | `test_live_descendant_prevents_successful_transport_even_after_turn_completed` | PASS |
| 132 | `test_unindexed_generation_still_captures_complete_private_request_and_prompt` | PASS |

### 3.2 最小运行前提与目录

- Linux，能读取 `/proc` 的本机进程身份，能创建并终止自己的子进程／进程组。TMPDIR 所在卷允许执行测试创建的 Python wrapper／fake CLI，并支持测试依赖的文件权限和原子操作。
- 已核源码包、Bash、coreutils、Node、Python 3。本轮版本为 Linux 6.18.55 x86_64、Node v24.22.1、Python 3.12.14，工作／输出卷为 overlayfs；其它版本兼容性未在此推断。
- 这些指定测试使用 Node 内置模块和 Python 标准库及仓库本地模块；不需安装真实 Codex CLI、配置凭据或连接 Host／模型。
- 指定一个新的、可写的离线输出目录。`TMPDIR` 指向其 `tmp/`；`PYTHONDONTWRITEBYTECODE=1` 避免写入源码。部分 Node fixture 会保留临时文件，应保留到证据采集完成；Python TemporaryDirectory 会回收自身部分临时内容。

### 3.3 最小准确命令

把下方三个变量替换成现场已核的绝对路径。`WL_0B_SOURCE_ROOT` 应含 `DELIVERY_RECEIPT.json` 与 `openclaw/`。先核包／receipt／文件哈希；对改后版本，先记录准确新版本及这两份测试是否变化，不能仍标为原 0b 运行。

```bash
WL_0B_SOURCE_ROOT='/absolute/path/to/wiselink-codex-client'
WL_LINUX_OUTPUT='/absolute/path/to/new-offline-linux12-output'
WL_REPRO_OUTPUT='/absolute/path/to/new-offline-budget-repro-output'
umask 077
mkdir -p "$WL_LINUX_OUTPUT/tmp"
export TMPDIR="$WL_LINUX_OUTPUT/tmp"
export PYTHONDONTWRITEBYTECODE=1
cd "$WL_0B_SOURCE_ROOT"
node --test-name-pattern='^(restart after runner receipt and before caller checkpoint returns exact stable response once|creates nested runRoot parent chain before making its exclusive recovery claim|an existing live runner is joined without a second dispatch|killed parent with a live runner resumes its completed receipt without redispatch|aborting a recovery wait leaves the active runner available for a later retry|missing claim, dead runner and mismatched or malformed receipts never dispatch|a changed original upstream response fails the recovery receipt hash|a changed final upstream request fails the recovery receipt hash|changed or exposed private prompt is rejected before parent linkage and never redispatched)$' openclaw/codex-evaluator/codex-generation-recovery.test.mjs > "$WL_LINUX_OUTPUT/node.stdout.txt" 2> "$WL_LINUX_OUTPUT/node.stderr.txt"
WL_NODE_EXIT=$?
printf '%s\n' "$WL_NODE_EXIT" > "$WL_LINUX_OUTPUT/node.exit-code"
cd "$WL_0B_SOURCE_ROOT/openclaw/codex-evaluator"
python3 -m unittest -v test_run_codex_generation_recovery.RunnerRecoveryTests > "$WL_LINUX_OUTPUT/python.stdout.txt" 2> "$WL_LINUX_OUTPUT/python.stderr.txt"
WL_PYTHON_EXIT=$?
printf '%s\n' "$WL_PYTHON_EXIT" > "$WL_LINUX_OUTPUT/python.exit-code"
```

采用现有 `RECOVERY_VALIDATION.md` 53 行说明的直接 Node 文件调用，输出逐项名称；不把外层 `node --test` 汇总的文件数误计为测试数。本轮另两个普通可移植 Node 用例被名称筛选排除；Python `PreDispatchPersistenceTests` 类未选中。

**通过判据：** 两个退出码均为 0；Node 输出准确以上 9 个名称并显示 tests=9/pass=9/fail=0/skipped=0；Python 输出准确以上 3 个方法并显示 Ran 3、OK、无 skip。**失败或未验证判据：** 任一非零退出、断言失败、目标用例 skip、名称／数量不符、超时、`/proc` 或子进程权限不可用，都不能标为这 12 项通过；禁止关闭原校验或扩大筛选凑数。

本轮实际结果为 Node 9/9（1,422.121657 ms）、Python 3/3（0.274 s），两命令退出 0。evidence JSON 保留命令、完整 stdout/stderr 和退出码。此处是本云端环境离线通过；实际宿主 OS、进程监管、持久卷保留、目标 Codex 入口和真实服务接线仍由本地主控现场验收。

## 4. 有界复现的重用方法

在同一 Linux 环境，审查目录中的脚本只导入提供的 source root；新建输出目录且保留其文件。执行：

```bash
WL_AUDIT_ROOT='/absolute/path/to/audit-checkout'
bash "$WL_AUDIT_ROOT/docs/coordination/wiselink-codex-0b-repro-20261025/run.sh" "$WL_0B_SOURCE_ROOT" "$WL_REPRO_OUTPUT"
```

输出包含 normal／interrupted 两套 checkpoint、原 synthetic state、正常和恢复结果、SIGKILL 退出码、恢复前后预算／state、脚本及导入源码哈希。脚本仅向自身测试子进程发出 SIGKILL，不针对宿主进程。要求新输出目录，避免把历史状态混入本次；读入旧输出不是复现初始条件。

`repro.mjs` SHA-256：`35e75132cac76fed4b7a4a240098a7e32d4bcbbbc7d0a5a69c18f89ce870c355`。

`run.sh` SHA-256：`5bbd693bc7bd93e1ba118d461d41db1cb951fff6487dccf85bbb88d280c43471`。

**脚本用于复现原 0b 缺陷，不是修复后的通用通过门禁。** 它最后的 `cmp` 断言原缺陷下预算文件不变；修复后正确结束 pending 会使这个比较失败，不能把该失败误判为修复错误。修复后的验收按 2.4 节结果判断；不为此另造执行器或测试平台。配套 evidence JSON 的 `observations` 是对本轮原始文件的核对汇总，不是 run.sh 自动产生的业务回执。

## 5. 收口与下一步

本轮已关闭“是否拿到准确 0b”“原 12 项究竟是什么”“预算缺口是否只是推测”三个证据问题。**尚未关闭的是本地产品中的该恢复缺口。** 下一步只需本地主控提交最小修复的准确版本与相应离线组合证据，并同步既有批准请求中的版本对象；若实际首测入口没有显式预算，还需以准确命令／配置说明其适用性，不能据此把已证实的显式预算路径说成无缺陷。

随后按已确定的次序与实际批准推进：先 A 的安装和目标 Linux 验证，再发布；B 的身份／路径切换、C 的单事项实测分别依批准执行。本文没有批准、安装、部署、修改生产配置、操作凭据或开展真实业务测试。没有要求救回旧 UNKNOWN、迁移旧任务、增加 worker、前置翻译扩展或等待完整长期回收能力。

4b49725 的“每个完整保留绑定的 run，bridge 最多一次应用层上游 POST”结论与本次发现分属不同层：不重复派发不会自动结束消费者预算。本次没有增加真实模型请求，也没有用审计计数 0 推导“请求未发送”。
