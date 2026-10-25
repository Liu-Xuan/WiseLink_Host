# Codex 模型预算最小修复：修后审查判据

日期：2026-10-25。用途：在收到本地主控的准确修后文件后，独立审查 c48f570 已确认的模型 pending 阻挡 SAVE 问题。本文件只整理判据、证据范围及交接附记；没有产品修改、测试执行、目标机操作或新的模型／Host 调用。

## 1. 当前状态与保留基线

- 原缺陷证据固定为 `c48f570952a5098d4fba13c018c64bd6d85d0f7b`，父提交 `4b49725a4d7a2429bcaed0fb720e91fbff1adb58`。其报告、evidence JSON、`repro.mjs`、`run.sh` 四个文件原字节保留；本文件是后续附记，不改写历史记录。
- 被审源码固定为附件 `WiseLink_Codex_Client_Source_0b48366e.zip`，1,412,244 bytes，SHA-256 `6fffdc91af8bc5afda5376f4e9a55511bbc2916ba4ed6bdfa8e6d5cd50e885d2`。receipt 所列客户端提交 `0b48366e09d25999fa99f707780b4009bd2931f7`，Host 后继 `542edca3432c73eee48818575f8bf11543ceb455`。不重打该包、不替换基线。
- 当前尚未收到本地准确修后提交、完整窄 diff 和测试证据，状态为**待收修后材料，尚未形成修复接受结论**；这不等于已判修复失败。
- 用户本轮明确：**原 0b／542 的 A+B+C 已获批准**。当前授权状态以此为准。修后客户端／Host 的准确版本须更新对应批准对象，不自行套用旧对象；技术审查结论本身不替代对象更新。

原报告与证据：

- [0b 恢复核查报告](WISELINK_CODEX_0B_RECOVERY_CHECK_20261025.md)
- [0b 原始执行证据](WISELINK_CODEX_0B_RECOVERY_CHECK_20261025.evidence.json)
- [原离线复现脚本](wiselink-codex-0b-repro-20261025/repro.mjs)
- [原复现运行脚本](wiselink-codex-0b-repro-20261025/run.sh)

## 2. 三个修后窗口

适用对象仍为原明确范围：`PROGRAM_CONTROLLED_V1`／`CODEX` 的程序初评，显式预算模型／SAVE／阶段结束为 `1/1/1`，原模型调用已登记在途。每个窗口均沿实际消费者、程序初评、预算和 checkpoint 调用边界验证，复用已有离线 fixture；不另写替代预算实现来证明原产品。

| 窗口 | 进入时已存在的证据 | 修后必须达到的结果 | 最少观察记录 |
| --- | --- | --- | --- |
| W1：原完整响应恢复成功 | 原 started、`active=modelRequests`、模型计数 1；既有 receipt-only 链可取回同请求完整响应 | 完成既有准确绑定验证并持久化响应后，仅结束匹配的模型 pending；原模型计数保持 1，随后合法 SAVE 和阶段结束能够继续 | 原请求 ID／argsHash／响应 SHA、原响应与落盘结果一致、预算前后、原生成总数与恢复次数分开记录、SAVE／阶段结束结果 |
| W2：响应已落盘，pending 未清又退出 | 完整且有效的父层 response checkpoint 已存在；同一模型 pending 和计数 1 仍在 | 新进程直接复用既有完整匹配结果，完成原 pending 的结束；不能依赖“首次从 gateway 恢复返回”这个瞬时回调；不重新生成、不手改 checkpoint | 中断位置确在 response 持久化之后、pending 结束持久化之前；重启前后相同响应／请求绑定、预算变化及后续 SAVE／结束结果 |
| W3：重复恢复 | W1 或 W2 的同请求完成证据；第一次 reconciliation 已完成，或业务 SAVE／结束已由原请求确认 | 再次进入保持幂等：模型计数仍为 1，恢复新增生成 0；不会重新计费、误清其他 pending 或重复已确认的业务写入 | 至少两次进入同恢复边界的记录；计数／selection／ordinal 不漂移；已有 SAVE key／revision 与阶段结果保持原身份 |

### 共同通过条件

1. **原模型消费计数始终为 1，恢复新增 generation 为 0。** `recoverOnly` 请求／读回次数与新的模型生成次数分开计数。应用计数或桥接审计计数为 0 不能证明请求未发送，不能据此释放 pending 或再生成。
2. 不退款、不归零、不改 limits／selection／ordinal、不产生第二个模型 reservation。允许的变化是：在完成证据准确匹配后，原模型 pending 由在途变为已结束。
3. W1／W2 的合法新 SAVE 和阶段结束能够继续，完成后预算模型／SAVE／阶段结束为 `1/1/1`、active=null。这里是初评阶段结果，不将它等同于真实 Host 整体业务闭环或目标机验收。
4. 若中断前尚未生成 SAVE request，允许正常首次创建；**一旦原 SAVE key、payload 和 CAS 基线已持久化，就必须复用**。不得为绕过恢复问题创建新 key、改原 payload 或改基线。
5. Host 当前 fence、权限、租约、CAS 与准确 READ 继续生效。不能因为已取得模型响应，就把旧 fence 带入新的 RUNNING SAVE。
6. 重复恢复不得重复已确认的 SAVE／阶段结束；ACK 未知时继续使用原查询路径。**既有 COMMITTING 对原冻结结果的受控恢复／重放仍按原契约处理**，不把这种恢复误判为一次新生成或任意新写入，也不能将它改为重新生成或 SAVE。

## 3. 必须保留的拒绝边界

只有当前恢复分支依照既有合同所需的准确完成证据，才能结束对应模型 pending。以下情况不得单独触发结束：

- begin 成功、heartbeat 成功、与原模型请求无关的 READ 成功。
- 预算／审计／bridge 计数为 0，或某份日志中没有记录到上游 POST。
- 仅有 started 标记、候选正文、某个成功字段、任意文件存在或 `active.kind=modelRequests`。
- 缺失、损坏、截断或请求／响应绑定不符的必需回执和 checkpoint。
- 当前在途条目并非该准确原模型请求，或实际是 SAVE／阶段结束等其他 pending。

必需完成证据缺失、损坏或绑定不符时，仍按既有 UNKNOWN／拒绝语义保留在途结果，不继续 SAVE／阶段结束；不要求把已有准确错误码统一改成一个新错误码。反例可以复用已有测试和本地新增证据；只有本次修复引入、且现有证据未覆盖的实质分支才补最小离线用例。

### 不增加新的历史文件存活要求

两条已有恢复分支需分别审：

- **父层完整 response checkpoint 尚未形成：** 仍沿已有 receipt-only 链核验原回执及该链原本要求的文件，再持久化完整响应。
- **父层完整 response checkpoint 已形成：** 复用其原有合同校验，包括原输入／请求绑定、完整 raw、Codex receipt 的 requestId 和响应 SHA 等。若这些既有校验已满足，应能据此结束准确模型 pending；不能因这次修预算新增“所有底层 runner、transport、prompt、上游原文件必须继续存在”的要求。

这不是放宽原校验。缺失／损坏／不匹配所针对的是**当前分支原本必需的完成证据**；不删除原有约束，也不把另一分支的所有底层文件变成新的共同前提。

## 4. 收到修订后的审查范围与结论

### 只审受影响文件及调用边界

按实际 diff 定位预算结束入口、请求匹配条件、响应和 pending 的持久化顺序、重复进入行为，以及消费者→程序初评→gateway／checkpoint 的实际调用关系。特别审清：

- 完成预算的依据来自哪里，是否能对应原 reservation，而非泛化的工具成功回调。
- W2 是否也能走到 reconciliation，还是只处理首次 receipt 恢复返回。
- 已完成 reconciliation 重入时是否不再计数、不误清其他条目。
- 原 SAVE key／payload、当前 fence／权限／CAS、原 key READ 和 COMMITTING 原冻结结果恢复规则是否保持。
- 变更是否确实局限于这个缺口；无关 schema、队列、旧任务迁移、长期恢复平台或并行扩容不纳入本轮。

本地若已给出覆盖 W1–W3 和相关拒绝边界的准确证据，直接复核并复用；不为了数量另跑测试。需要补测时，先指出一个具体未覆盖风险，再执行对应最小离线用例。原 12 项云端结果继续复用，不重跑全量 schema，不扩大 Linux 集合。

### 最终报告只形成一个技术结论

收件并完成审查后，报告明确写下以下之一：

- **可接受。** 指明准确修后客户端／Host 对象，列出三个窗口与拒绝边界的证据，说明原生成 1／恢复新增 0、SAVE 和阶段结束可继续；注明真实目标机验收仍由本地主控执行。
- **存在阻断首测的问题。** 只列实质缺口，每项给准确文件／分支或反例、预期与实际差异、业务后果及最小补救／补证据。比如匹配完成后仍卡住、无准确完成证据就释放 pending、W2 不可恢复、重复生成或重复业务写入、丢失原 key／当前 fence／COMMITTING 边界。

缺件期间只列准确缺件，不预判修复通过或失败。若缺少能够判定上述核心路径的必要证据，也应明确是哪一项无法判定，不把“测试总数不够”作为阻断理由。可接受结论不自动批准、安装、部署或启动真实业务。

### 原脚本的 `cmp` 不作修后通过条件

保留 c48 的 `run.sh` 原字节：其末尾 `cmp` 证明原 0b 缺陷下预算文件没有变化。修复正确结束 pending 后预算文件应发生相应变化，因此这个 `cmp` 不再是修后通过条件。下一轮看的是准确的状态变化和计数／绑定不变式；不能通过修改或跳过断言掩盖实际失败，也不在本轮提前改造另一套脚本。

## 5. 需要本地主控提供的最小补件

| 补件 | 最少内容 | 无需另做的内容 |
| --- | --- | --- |
| 准确修订对象 | 修后完整提交 SHA、父提交、与 0b 的关系；对应客户端／Host 版本，哪些对象保持不变 | 不要求先推送／部署；不假定本地 SHA 可从 GitHub 获取 |
| 完整窄 diff 与文件字节 | 本次修复的完整 diff、受影响文件清单；修后源文件及新增／修改测试或 fixture 的准确字节和 SHA-256，或可实际读取到同样内容的准确 Git 提交 | 不重打原 0b ZIP，不要求再交整库或全量 schema 包 |
| 受影响离线证据 | 准确命令、运行版本、用例名、退出码、原始输出；W1–W3 的断点与预算前后记录；原请求／响应绑定、原 generation 与恢复次数、SAVE／阶段结束的 key 和结果；相关拒绝边界可复用的证据 | 不需要真实凭据、真实 Host／模型试错、全量测试或新增恢复平台 |
| 批准对象更新说明 | 将准确修后客户端／Host 对象及变化范围对应到已批准的 A／B／C；由负责批准和现场执行的一方明确其适用性 | 不把本审查当作替用户批准新版本，也不重提旧版本是否获批 |

需要提供的都是这次最小修复的实际材料。证据中的身份／fence 可用合成值；不提交机器秘密、生产 token 或真实业务材料。本轮不要求接收部署凭据或目标机器访问权。

## 6. 原 12 项交接附记与更正

用户补充的原 12 项保持为 N1–N9 和 P1–P3。本轮只读对照源文件，确认准确用例名、冻结源行及下列五个文件 SHA-256 与已核 0b 包一致，未执行测试：

| 文件（均在 `openclaw/codex-evaluator/`） | SHA-256 |
| --- | --- |
| `codex-generation-recovery.test.mjs` | `98559703a2dd31048a3a4315a5e6f83dd460db0b3692362597be03ffaa2c1235` |
| `test_run_codex_generation_recovery.py` | `25cd7948a033e807c39f0a16a60dfcfdba07270ee7e8908b59aa8436b6322989` |
| `codex-generation.mjs` | `fd0d77f118d312292db8580a7f1f153be712029a98e5c0774c7ca8e0bebb31fe` |
| `run_codex_generation.py` | `4596a24630cfbdf96006aed8f06aa26d2c534111313b0890e3b00c3a912682ef` |
| `miaoda_responses_bridge.py` | `52e9b093ba293bab7479a3b1105d4db750605b49143054ec5a5133111ba3a632` |

**更正 c48 的排除数量表述：** 同一 Node 文件被准确名称筛选排除的普通 `test` 共 4 项，不是报告所写的 2 项：

| 原源行 | 排除的普通用例 |
| --- | --- |
| 97 | `prelaunch parent checkpoint can name the private prompt directory without dispatch` |
| 125 | `failed parent checkpoint publication blocks runner launch` |
| 279 | `portable exact receipt recovery validates request and response bytes with zero spawn` |
| 294 | `portable recovery rejects changed prompt or public prompt permissions with zero spawn` |

c48 evidence 的“两项 portable 用例被排除”只覆盖其中两项，不能当作所有排除项的完整计数。本附记补齐该表述，原 N1–N9 实际逐名输出及 9/9、P1–P3 的 3/3 通过结论均不变；本轮没有改写原日志、脚本或结果。

证据性质分开记录：

| 记录 | 准确性质 |
| --- | --- |
| 用户补充的本地原 skip 日志 | `node-targeted-final.log`：10,755 bytes，SHA-256 `60631d656d315dc0d4d67dfde4123f5023981891875945b52b8737cae8e90628`；`python-targeted-final.log`：2,577 bytes，SHA-256 `5f0a61a7f8450fed5d00b9ec7f180c9c5d52530d92404b586f88c9d389c2558c`。本轮接收的是交接摘要，未独立读取这两份原日志字节；其原 Linux guard skip 表示当时未执行，不证明 Linux pass 或具体 OS 版本 |
| c48 云端原始执行输出 | 已核准确 N1–N9、P1–P3 实际运行并通过，9+3，目标 Linux guard skip 为 0；继续复用本环境结果 |
| 妙搭实际目标 Linux | 尚待本地主控按获批 A 现场验收，不由本云端结果替代 |

现场沿用用户本轮交接的精确筛选和已批准 A 的隔离环境：9 项 Node 名称，3 个 Python 完整方法名；私有 TMPDIR／logs；隔离的 `validation/bin/python3` 只执行 Python `-B`。部分子进程重建环境，因此不能只靠外层 `PYTHONDONTWRITEBYTECODE=1`。本轮没有创建启动辅件、安装目录或真实配置，也没有运行这些命令。

采用 `node --test` 时，未选中的四项可能显示 name-filter skip；它们不属于原 12 项的平台 skip。验收看 N1–N9、P1–P3 逐名实际执行／通过，不能仅看退出码或要求总 skip 数必为 0。若目标用例仍因 Linux guard 跳过，则该目标用例仍未验。目标执行回报需包含十二个准确名称、平台、退出码、逐项 pass/fail/skip 和原日志。

本轮到此收口：保留 c48 缺陷复现；准备上述修后判据；待本地准确补件到达后，仅审最小修复。
