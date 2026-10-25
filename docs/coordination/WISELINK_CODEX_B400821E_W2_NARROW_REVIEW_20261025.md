# b400821e：W2 两文件窄复核结论

日期：2026-10-25（北京时间）。本报告是收到准确后继文件后的最终窄复核结果，不是新一轮修后判据。

## 结论：可接受，前轮唯一 W2 阻断已关闭

**接受执行端 `b400821ef943feb9c3520a54f8c89c3a43b768ee` 相对 `1aef22db6f1c15378e63206f02b4fd6a81278b5f` 的这次两文件修订。** 在所审差异及直接调用边界内，未发现阻断首测的问题。

完整、准确绑定的父响应已落盘而模型 pending 未清时，当前实现直接校验原父层证据并结束对应 reservation，不再重新要求子 runner、prompt、transport 或上游响应原文件齐备；没有父层完整结果时，原 recoverOnly 验证仍保留。模型计数维持 1，没有退款、重置预算或新增生成。原 SAVE key、当前 fence 与 COMMITTING 窄修保持。

本轮只实际执行受影响的一个测试文件一次，结果 **53/53 通过，fail 0、skip 0、exit 0**。包 receipt 中本地主控报告的 **63/63** 是另一条记录：receipt 未列出该总数的命令与组合清单，本轮没有独立复跑这个集合，也没有推定差出的 10 项是什么。该统计口径区别不构成本次 W2 的技术阻断，不为凑数追加测试。

本报告与原始证据交给本地主控用于已经提出的 Native 差异确认和安装核对；原 B/C 范围不重新申请。本轮没有安装、发布 Host、操作凭据或发起真实模型／Host 请求。

## 1. 准确对象与两文件边界

| 对象 | 本轮核对结果 |
| --- | --- |
| 上传副本 | `WiseLink_Codex_Client_Source_b400821e(1).zip`，1,418,707 bytes |
| ZIP SHA-256 | `e733c864f615e626028ac3d592c44a00f23e179876c63a9eb02d8e1aa34f9cf0` |
| 源码提交／父提交 | `b400821ef943feb9c3520a54f8c89c3a43b768ee`／`1aef22db6f1c15378e63206f02b4fd6a81278b5f` |
| 源码树 | `a805691bf687557e67f239c51bfa538845bd96e8` |
| 保留的兼容 Host | `58d9569bff0df79d39c6a21925de652411c1258b` |
| receipt SHA-256 | `308356728f43763a78d31706cfc01fa1ef4ccbfd9baabbe377202ca15e2d6051` |
| 包完整性 | 218 个源文件逐一核对字节数与 SHA-256；无缺件、额外文件或不匹配 |
| 差异完整性 | 仅下述两文件修改，新增 0、删除 0；其余 216 个源文件保持原字节 |
| 执行后完整性 | 218 个源文件再次核对全部不变，无执行产物写入包内 |

源码／树／Host 提交身份来自准确包 receipt；本轮独立核验的是上传 ZIP、逐文件字节和与旧包的窄 diff，没有把 receipt 身份写成另外已读取的远端 Git 对象。无需重打包或等待额外源码才能形成此次结论。

两项修改的共同根为 `openclaw/`：

| 文件 | 角色 | 修后 SHA-256 |
| --- | --- | --- |
| `skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs` | 唯一产品脚本变更 | `7811dcebe8f3318f987565579d49a8e9cf2224091c7efb35bb63b8414958de16` |
| `codex-evaluator/program-budget-recovery.test.mjs` | 对应定向测试 | `8945653a1564081fe6c8a2a9a1308777956c76a86fe03ca91906fd8294970906` |

Host 实现、消费者、预算实现、原 SAVE／COMMITTING 客户端及 gateway／runner／bridge 均无本轮产品差异。这是执行端小补丁，不产生重新发布 Host、创建新凭据或扩授权的代码需求。

## 2. W2 已关闭的直接证据

下述行号均针对已核的 b400821e 包。

`run-program-assessment.mjs` 51–56、66–74、90–96 行先读取已保留父结果，要求原 `assessment-enabled`、材料和原请求快照存在且准确匹配；已有父结果时，不允许补造缺失的必要输入证据。

123–125 行有父结果即跳过请求分支。177–181 行验证完整 raw、准确模型 requestId 和响应 SHA；182–197 行的 reconciliation callback 只检查原 started、原 `.codex-run` 链接以及返回状态、运行位置和 transport 引用之间的对应关系，**不再调用 `requestModelGateway` 或读取子运行目录**。

`program-budget-recovery.test.mjs` 46–56 行通过两次实际 SIGKILL，先留下模型 pending，再使恢复进程退出于父 result 已写入、pending 尚未清除的窗口。142–154 行验证随后能合法继续；203–228 行分别再删除整个子目录、损坏子 receipt、改变子 raw/request，三种情况均继续 SAVE／独立 READ，并明确断言 gateway recovery 次数没有增加、父 result 保持原值。以上用例本轮均实际通过。

对尚无完整父结果的分支，125–174 行仍使用原 `originalRunRecorder` 与 `recoverOnly:true`；底层 gateway 的原请求、prompt、transport 和完整响应验证代码未改。测试 157–201 行仍验证该分支中的缺失／损坏／错绑回执会保持 UNKNOWN，没有 SAVE 或新生成。

## 3. 拒绝边界及预算／SAVE 规则保持

| 检查 | 证据与结论 |
| --- | --- |
| 必需父证据缺失 | enabled、materials、model-input、started、codex-run 缺失时拒绝；不通过重建它们清 pending。测试 230–282 行实际通过 |
| 输入或响应错绑／损坏 | 请求 body、argsHash、started requestId、parent 位置、raw/hash、receipt requestId/runDirectory/transportRef 等不符时拒绝，原预算不变、SAVE 0、新增生成 0 |
| 精确模型 reservation | 未改的 `consume-hosted-work-item.mjs` 2279–2289 行要求 model count 恰为 1、active 结构准确及 first ordinal 准确，验证成功后才 complete |
| 不误清 pending | begin、heartbeat、无关 READ、审计计数 0 都没有清除模型 pending 的新入口；非 modelRequests 的 pending 不由此处理 |
| 持久化与幂等 | 未改的 2233–2236 行先持久化再更新内存；已无模型 pending 时直接返回，不再计费或验证 gateway。pending SAVE／FINISH 反例通过 |
| 已完整收到但业务无效的响应 | 完整且绑定、hash 有效的 HTTP 错误或非法 JSON 响应，结清已知模型请求后进入原错误路径；模型计数仍为 1、SAVE 0。不能与持久回执损坏／错绑混为一类 |
| SAVE key | 脚本 252–261 行保持原逻辑：已有 `program-save-request` 复用原 key；尚无则允许正常首次创建；仍检查 revision/workJson |
| 独立 READ | 262–303 行保持原 key 查询、必要 SAVE、SAVE 后独立 READ及准确身份／修订检查 |
| 当前 fence／COMMITTING | 消费者、`initial-assessment-recovery.mjs` 与 `orchestrate-host-mcp.mjs` 字节均与父版相同；COMMITTING 的受限查询、原 key、冻结结果和禁止重新生成／SAVE规则未改 |

这不是删除底层校验来接受损坏回执，而是按已有明确边界区分“已持久化的可信完整父结果”与“尚须从底层取得原结果”。所有新通过的 W2 情形均具备必需父证据；其完整性失败时仍在清 pending 前拒绝。

## 4. 本轮实际执行与复用证据的边界

实际命令、隔离环境、stdout、stderr 和退出码完整写入同目录 evidence JSON。本轮在 Linux 6.18.55 x86_64、Node v24.22.1 下，用 `env -i` 和独立 HOME／TMPDIR，仅直接执行 `program-budget-recovery.test.mjs` 一次；53 为 11 个顶层测试与 42 个子用例的 Node 汇总，不代表 53 个独立业务闭环。用时 18,564.906747 ms，stderr 为空。

| 窗口／能力 | 本轮结论及证据范围 |
| --- | --- |
| W1：原完整响应恢复 | 当前单文件重新验证恢复成功，模型计数 1，SAVE 1，独立 READ 通过；原 gateway 恢复仅一次，不再为清预算重复调用 |
| W2：父响应已落盘、pending 未清再次退出 | 当前实际通过双中断及子文件不可用反例；父响应不变，新增 gateway 调用 0，模型计数 1，SAVE／READ 可继续 |
| W3：重复恢复／已完成状态 | 未改的 budget active-null 幂等逻辑及当前“已完成模型 reservation”用例通过；前轮公共消费者完成后重入无新增生成／SAVE／commit 的证据继续复用 |
| 阶段结束 | 本轮该 fixture 明确止于 `SYNTHETIC_SAVE_READ_ONLY`，预算 `1/1/0`，没有把合成 SAVE 当作阶段 commit。前轮 c0b1831 的公共消费者证据已证明 `INITIAL_STAGE_SAVED`、预算 `1/1/1` 和完成后重入无新写入；按其原合成范围复用，本轮未重新运行 |
| 原 Linux 12 | 两份原测试与 gateway／runner／bridge 五文件仍与 0b、1aef 字节一致，未重跑，原云端结果保留；目标机结果由本地主控负责 |

复用阶段结束证据有直接差异依据：消费者及预算实现不变；程序从 `let payload;`（新 199 行）到文件结尾完全同字节，该尾段 SHA-256 为 `05bf87bbbf2e5eab6dddc923fa5fda38f0cd2180577d092f4f4d082a1324665c`。本次改变的是进入该既有后续流程前的 W2 pending 核销条件，当前用例已证明该入口可以继续。没有将前轮证据冒称为新版完整真实业务实测，也不重新把已补齐的阶段结束列为缺件。

## 5. 交接与停止边界

**没有新的产品修复项或必需补件。** 两文件窄复核到此结束，前轮 c0b1831 报告的唯一 W2 阻断关闭。保留 c48f570 原复现、f8aa6e9 判据与 c0b1831 原始日志，不重写其历史结论。

本轮仅新增本报告和配套 evidence JSON，不改任何产品文件、既有测试或原复现脚本，也未新增测试平台。未执行全量 schema、构建、原 Linux 12、翻译扩展、多 worker 或真实业务。

按用户最新转述，已发布 Host 58d 保留、旧 C136 已停领、凭据已落地、目标原 12 项已通过；这些属于本地主控现场回报，本轮没有再次访问现场核验。b400821e 的准确安装回执尚未提供。

下一步仍由本地主控沿已提出的 Native 差异确认，只同步安装该执行端补丁、核新脚本／测试哈希及对应恢复验证回执，然后按原 B/C 继续。**本独审结论不替代 Native 安装差异确认；不重新申请原 B/C，不重复发布 Host、创建凭据或执行原 Linux 12。**

完整窄 diff、manifest、执行原日志、未改文件哈希、前轮阶段证据引用与审查范围见 `WISELINK_CODEX_B400821E_W2_NARROW_REVIEW_20261025.evidence.json`。
