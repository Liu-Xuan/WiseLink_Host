# 1aef22db／58d9569b：四文件最小修复独立审查

日期：2026-10-25。本轮为实际修复审查结果，不是新增判据。审查依据是已收到的准确修后源码包、与旧 0b 的四文件差异、补丁自带离线用例，以及仅为补足阶段结束／重复进入证据执行的一项外置诊断。

## 结论：存在一个阻断首测的问题

**暂不能接受 `1aef22db6f1c15378e63206f02b4fd6a81278b5f`／`58d9569bff0df79d39c6a21925de652411c1258b` 为满足既定 W1–W3 边界的修复。唯一实质阻断是 W2：完整匹配的父层响应 checkpoint 已经持久化、模型 pending 尚未清除时，新代码仍无条件重新读取底层 Codex 回执及其全部相关原文件；底层文件不可用会继续阻止 SAVE。** 这增加了已明确不应新增的恢复前提。

其余主要正向行为已有证据：原模型计数保持 1，没有再次生成；在原回执可用时，预算恢复能够继续 SAVE／独立 READ，且本轮补证已经经过公共消费者入口完成阶段 commit；再次消费已完成事项没有新增生成或业务写入。问题不再是“阶段结束完全没有证据”，而是上述一个明确的 W2 分支不符合已定边界。

本轮没有修改产品或原 c48 复现证据，没有重跑全量 schema、原 12 项 Linux、构建或真实模型／Host；没有部署、操作凭据、增加队列或恢复平台。用户已明确批准技术对象升级并继续 A+B+C，本轮不重复索批。实际目标机验证仍由本地主控执行，当前技术阻断交本地主控处理。

## 1. 准确输入与四文件范围

| 对象 | 准确值 |
| --- | --- |
| 上传文件 | `WiseLink_Codex_Client_Source_1aef22db(1).zip`（上传副本名），1,418,417 bytes |
| ZIP SHA-256 | `f4f0e963cb7848d1162783251f9ea3fffa3f5ea9b774e45da9291e1b90fe1053` |
| receipt 源码提交／父提交 | `1aef22db6f1c15378e63206f02b4fd6a81278b5f`／`0b48366e09d25999fa99f707780b4009bd2931f7` |
| receipt 源码树 | `34ca4f1aeaf98df76c4617bda1dbea1b7c469153` |
| receipt Host 对象／父提交 | `58d9569bff0df79d39c6a21925de652411c1258b`／`542edca3432c73eee48818575f8bf11543ceb455` |
| receipt SHA-256 | `fe6c34f8a1906df2e2d7f05a3c2ed2d4c6b2f35a79339f943fd7d471c14d7a01` |
| 包字节核对 | 218 个源文件逐一匹配 receipt 字节数／SHA-256；无缺件、额外文件或不匹配 |

本轮实际可独立核对的是附件和逐文件字节。对上述两个新 SHA 的 GitHub Git commit API 读取均返回 404，未把它们宣称为本轮已独立获取的 Git 对象，也没有因此等待、重打包或阻塞源码审查。版本身份按包 receipt 记录；完整构建与本地 124 项通过属于 receipt 所载本地记录，本轮没有把它们当成重新执行结果。

与原 0b 包相比，仅以下四文件有差异，删除 0，其他文件保持原字节：

| 文件 | 变化 | 核查重点 |
| --- | --- | --- |
| `openclaw/skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs` | 修改 | 定向注入 reconciliation；计数／ordinal／active 校验；先持久化再更新内存状态 |
| `openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs` | 修改 | 原父运行绑定、原响应恢复及预算 verification 的实际调用顺序 |
| `openclaw/codex-evaluator/program-recovery-fixture.mjs` | 修改 | 新预算路径、合成 gateway 回执、SAVE／READ 范围 |
| `openclaw/codex-evaluator/program-budget-recovery.test.mjs` | 新增 | W1／W2 相关恢复、错误绑定拒绝、预算隔离等离线证据 |

完整窄 diff、四文件前后哈希、原始执行输出与阶段补证见同目录 `WISELINK_CODEX_1AEF22DB_NARROW_REVIEW_20261025.evidence.json`。既有 c48 与 f8aa6e9 文档／脚本不改写。

## 2. 唯一实质阻断：W2 把底层原文件变成新增前提

下面源码行号均属于已核 1aef22db 包。

### 2.1 实际生产路径

`run-program-assessment.mjs` 108–109 行读取已有 `assessment-round-1.result` 并核对 `argsHash`；162–165 行核对原 Codex requestId 及完整 raw 的响应 SHA。即使这些父层结果已存在且通过校验，166–188 行仍在 pending 模型预算的 verification callback 中无条件调用 `requestModelGateway(...recoverOnly:true)`。

171–179 行的注释和实现明确要求重新读取原子回执，174 行还要求原 `assessment-round-1.codex-run` 绑定存在。原 gateway 本身未修改，但该新增调用会重新要求：

| 原文件／约束 | `codex-generation.mjs` 原检查位置 |
| --- | --- |
| run 目录和 `generation-binding.json` | 294–314 |
| `codex-prompt.txt`、私有权限 | 315–327 |
| `generation-receipt.json` | 342–347 |
| `transport-summary.json`、`contract-candidate.json` | 350–355 |
| 成功 transport 对应的 `upstream-request.json`、`upstream-response.json` | 361–378 |

这些检查用于尚无父层完整结果时的原 receipt-only 恢复链是合理的；**本次问题是将它们新增到已经具有完整有效父层结果的恢复分支**。因此在以下条件下仍会保持模型 pending 并阻止 SAVE：父层完整 raw、原请求／输入绑定及 reservation 均有效，只是底层原文件已不可用。

### 2.2 补丁自己的用例已验证这个行为

`program-budget-recovery.test.mjs` 46–56 行先制造模型 pending，然后再次实际 SIGKILL 于完整 round result 写入之后，确保父 result 已有、预算仍未清。

- 142–154 行的正例证明：**底层文件仍完整时**，W2 能继续 SAVE／READ；152 行还明确断言增加一次 gateway recovery 读取。
- 203–256 行的 cached-result 组，在上述父层 result 已存在后删除底层 `synthetic-model/response.json`；205 行定义此例，249–251 行要求其返回 UNKNOWN。
- 61–77 行的检查明确要求：预算保持原样、模型总数 1、SAVE 0、没有新的 SAVE／结束 reservation。

本轮执行该新增测试文件，以上用例按它们当前写下的预期全部通过。这证明系统确实拒绝了该场景；**“cached result 有效，但底层原回执不可用仍必须拒绝”这一用例预期本身与既定 W2 边界相反**，所以不能用全文件通过来宣布修复可接受。

这个判断不把缺失／损坏必需父层证据、错误 requestId／argsHash／响应 SHA 等应拒绝的情况当作问题。阻断仅针对当前分支已经具备原合同要求的完整可信结果，却新增了另一套底层文件存活前提。

### 2.3 本地主控所需的最小收口

将“父 result 尚无，需走既有 receipt-only 验证”与“父 result 已完整且满足既有准确绑定校验”分开。后者应据其准确原请求与 reservation 匹配证据完成 pending reconciliation，不无条件重新进入底层 gateway。保留计数、ordinal、原输入／请求／响应绑定，不以直接清 active、删校验、退款、重置或重新生成代替修复。

对应补证只需覆盖这一已有反例：完整有效父 result、原 pending、底层 receipt 不可用时仍可合法继续；父 result 本身损坏或错绑时仍拒绝。无需追加全量 schema、Linux 集合、队列或长期回收平台。本轮不提供另一套产品补丁。

## 3. 已确认保持的边界

| 边界 | 证据与准确结论 |
| --- | --- |
| 定向接入 | `consume-hosted-work-item.mjs` 1928–1930 仅对有预算、`EVALUATE_JOBAID`、CODEX、`PROGRAM_CONTROLLED_V1` 注入新 hook |
| 不退款／不重计数 | 2279–2289 要求模型计数正好为 1、active 形状准确、原 first ordinal reservation 匹配，成功后只结束 pending |
| 不误清其他操作 | 非 `modelRequests` active 直接返回；新增 pending SAVE／FINISH 反例保持原在途状态 |
| 计数 0 不能解锁 | `state.counts.modelRequests !== 1` 直接拒绝；没有按审计 0 或“未看到 POST”推定未派发的分支 |
| 工具成功不等于模型完成 | begin、heartbeat、无关 READ 未接入新的模型 reconciliation；原 READ／结束状态 reconcile 仍只处理各自的 SAVE／FINISH pending |
| 持久化顺序 | 2233–2236 先成功写入 completed checkpoint，再更新内存 state，避免写失败后仅内存清除 pending |
| 不新增生成 | 新 gateway 调用带 `recoverOnly:true`；原 gateway 的禁止再次 dispatch 路径未改；本轮离线观察原 generation 总数始终为 1 |
| 原 SAVE 身份 | 后续 SAVE key／payload／CAS 逻辑未改；补证中原保存请求 key 与实际保存记录一致，完成后重复进入没有改变 |
| 当前 fence | 公共消费者补证中，恢复后的 SAVE 和阶段 commit 参数均使用 `synthetic-fence-2`／generation 2，与原 task／attempt 对应；这是合成 Host 下的客户端参数证据 |
| COMMITTING | 原只读核对、原 SAVE key 查询和冻结结果受控恢复代码未被四文件 diff 改写；本轮没有另做新的 COMMITTING 业务实测 |

## 4. 本轮离线验证：准确区分 SAVE／READ 与阶段结束

### 4.1 仅执行补丁新增的一个测试文件

运行 `openclaw/codex-evaluator/program-budget-recovery.test.mjs` 一次，采用清空后仅保留必要环境变量的 `env -i`、隔离 HOME／TMPDIR。Node v24.22.1，Linux 6.18.55 x86_64。逐项原始输出统计为 **tests 44／pass 44／fail 0／skip 0，exit 0**，stderr 为空；计数包含 Node 的父测试和子用例，不代表增加了 44 个独立业务场景。

范围是原程序评估与预算代码，加合成 Host／gateway。fixture 200–220 行注入 `runInitial`，仅 begin → program → SAVE／READ，返回 `SYNTHETIC_SAVE_READ_ONLY`；没有阶段 commit 映射。成功 helper 在测试 85–92 行明确断言预算 `1/1/0`。其中 `committedWrites=1` 是合成 SAVE 的持久化计数，不是阶段结束。

没有重新执行 receipt 所载完整 124 项，没有重跑原 12 项 Linux 或全量 schema。

### 4.2 只补缺失的阶段结束与重复进入证据

原 c48 `repro.mjs` 的 synthetic gateway 没有调用 `onRunPrepared`，不能直接满足新补丁要求的原父运行链接。为避免把旧诊断替身缺字段误判成产品问题，本轮保留原脚本原字节，在外置副本 `wiselink-codex-1aef22db-review-20261025/repro-stage.mjs` 中**仅增加 7 行合成 `onRunPrepared` 字段回调**，复用新包 fixture 的同一 prepared 字段形状；没有修改任何产品／包内测试文件，也没有使用原 `run.sh` 末尾的旧 `cmp` 作为修后门禁。

该副本仍导入原公共 `consumeHostedWorkItem`、`invokeHostedInitialModel` 及新包程序实现，未覆盖实际 `runInitial`。Host 与 gateway 仍为本地合成依赖；没有启动真实 CLI／runner、模型或 Host 网络请求。

| 观察 | 正常对照 | 实际 SIGKILL 后恢复 | 已完成目录再次进入 |
| --- | --- | --- | --- |
| 结果 | `INITIAL_STAGE_SAVED` | `INITIAL_STAGE_SAVED` | `INITIAL_EXPECTED_OPERATION_MISMATCH` 安全拒绝 |
| generation 总数 | 1 | 1 | 仍为 1 |
| 原回执恢复读取 | 0 | 2 | 仍为 2 |
| SAVE 次数 | 1 | 1 | 仍为 1 |
| 阶段 commit 次数 | 1 | 1 | 仍为 1 |
| 预算模型／SAVE／结束 | `1/1/1` | `1/1/1` | 逐字节保持该结果 |
| active | null | null | null |

中断为实际 SIGKILL，退出码 137；中断时预算为 `1/0/0`、active=modelRequests。恢复保持原 task、attempt、requestId、body 和完整 raw，并取得新的 lease generation／fence。`recoveries=2` 表示第一次取回原响应、随后补丁再次验证原回执，**不是两次模型生成或两次真实上游 POST**。

W3 的实际观察边界是：完整阶段完成后，再进入同一明确初评请求，被公共入口既有阶段检查安全拒绝，前后 generation／SAVE／commit／已保存内容／原响应／预算均不变。对内部 reconciliation，源码还显示 active 已结束时直接返回。没有把这个观察扩大为所有未知终态或所有中断点的并发恢复验证。

### 4.3 W1–W3 汇合结果

| 窗口 | 本轮结果 |
| --- | --- |
| W1：取回原完整响应并结束匹配 pending | **已离线验证通过，且补齐阶段结束证据。** 原生成 1，新增生成 0，SAVE 1，阶段 commit 1 |
| W2：父响应已落盘、pending 未清又退出 | **有实质阻断。** 底层文件仍在时可继续 SAVE／READ；但完整父结果不能独立于新增底层文件要求解除 pending，违反既定边界 |
| W3：重复恢复幂等 | **已验证完成后的重复消费无新增生成／写入；内部 active 已清时的幂等分支由源码确认。** 不声称覆盖全部中断位置或真实 Host |

## 5. 证据留存与审查停止边界

本轮交付仅新增：

- `docs/coordination/WISELINK_CODEX_1AEF22DB_NARROW_REVIEW_20261025.md`（本报告）。
- `docs/coordination/WISELINK_CODEX_1AEF22DB_NARROW_REVIEW_20261025.evidence.json`（包／差异身份、代码片段、原始测试输出、阶段结束与重复进入快照）。
- `docs/coordination/wiselink-codex-1aef22db-review-20261025/repro-stage.mjs`（外置离线补证副本）。

副本 SHA-256：`a5a5b66bd12dd617b2cd0b3b1557b7f7991d353a7e47f5cc1eae23b993f84b4d`。c48 原脚本 SHA-256 仍为 `35e75132cac76fed4b7a4a240098a7e32d4bcbbbc7d0a5a69c18f89ce870c355`。

阶段补证的首次成功恢复原文保存在 `recover.stdout.log`。后续 W3 重入会写同名的 `interrupted/recover-result.json`，因此不能把后者当成首次恢复结果；证据文件明确使用首次成功日志和 `state.completed.json`／`budget.completed.json`，并分别记录重入日志／快照。此前用未补父链接的旧诊断脚本产生的前置记录不用于本结论。

原 12 项的两份测试和 gateway／runner／bridge 共五个文件与 0b 字节相同，继续复用 c48 已核的云端 9＋3 结果，不把它们升级为目标妙搭宿主验收。包内全部 218 个文件在本轮执行后再次核对，保持原字节。

**本轮窄审到此结束。** 交本地主控的唯一产品收口项是 W2 已有完整父层结果分支；阶段结束证据已补齐，不再作为额外缺件。后续针对该分支的准确后继修订及其对应反例关闭问题，目标机验证按本地主控的现场流程继续安排。
