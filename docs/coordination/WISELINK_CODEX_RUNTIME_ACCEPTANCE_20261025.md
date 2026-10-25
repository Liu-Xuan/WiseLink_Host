# CODEX 消费者宿主与分阶段验收

这是本地实施与切换准备说明，不更改 R10 主计划，也不代表配置、发布或业务运行批准。首测树为 `program-initial-925-core-candidate`，分支 `codex/initial-assessment-925-core-20261025`。先前f57核心由974bedfa选择性集成925deb；本次在f57上选择925→19d589首测必要增量，准确最终组合以新交付回执为准；接口以[当前完整包](host-codex-interface-20261025/README.md)为准，约束以[图契约 v1.9](../WISELINK_MAINLINE_GRAPH_CONTRACT.md)为准。

## 已知事实和缺口

| 对象 | 已有事实 | 仍需实际证据 |
| --- | --- | --- |
| Host 入口 | 固定五个 CODEX 入口、独立 principal/runtime、明确新事项与 intake scope；旧入口按活动执行器互斥 | 新线上准确代码、非秘密配置读回、可信身份与 scope；当前本地代码不代表线上 |
| 任务和消费者 | `consumeAutomaticWorkItemQueueBatch` 使用现成 Host 队列，逐项 await，默认最多4项；单批15分钟只在项间判断 | 现成宿主的单次唤起或service/cron、启动命令、owner和恢复方式；一次首测不要求先建常驻框架 |
| 检查点 | 显式 `--checkpoint-root`；默认 home 下目录不是持久卷证明。endpoint namespace 有本地 flock | 实际绝对路径、私有权限、持久卷挂载/生命周期、重启后同绑定读回 |
| 子进程结果 | 显式绝对 `--codex-run-root`/`WL_CODEX_RUN_ROOT`；generation recovery 保留完整解析响应及原进程闭合记录 | 实际私有持久 root、与父检查点同一恢复生命周期及真实重启读回；本次19d增量的prompt/bridge payload/启动前run关联代码与离线范围另记 |
| 数据库槽位 | 官方dev/online只读catalog已证：同tenant/request_origin非空槽位RUNNING/COMMITTING最多4个，三partial unique index有效；源码声明缺WHERE另列漂移 | 首批真实新业务是否完整遵守该范围、提交恢复占用及实际worker释放；不改DDL |
| 模型与运行资源 | 既有6次GLM合成Host调用只证该fixture；Codex子代理数量独立于业务worker | Hosted profile 的真实并发、RPM/TPM、超时和进程/内存/DB连接容量，均未取得 |

来源：现有 `queue-runtime-evidence` 官方只读记录（2026-10-25 09:47 UTC）、准确源码及本地恢复测试。历史 4e8 的随机run目录描述不覆盖94之后的稳定generation recovery实现；两者都不证明宿主卷持久。现有CLI一次调用执行有界批次然后关闭连接，脚本存在不代表已常驻。

## 最小配置与受控切换准备

1. 先只读确认新宿主的现成 service/cron、唯一 owner、准确执行文件版本及参数；若尚无注册，就列出待配置对象，不并设第二套调度。保留原owner的暂停/恢复责任，未知在途交易不中断。
2. 拟用现成 `consume-hosted-work-item.mjs --auto-queue`，固定 `--model-executor CODEX`、准确Host MCP路由和独立服务身份，显式两个私有绝对root；首批 `--queue-max-items 1`。参数中不写密钥值。实际路径/服务名当前未取得，不伪造可执行命令。
3. 采用原宿主秘密管理方式配置凭据，普通交接包仅给字段名和是否已配置。Host的 `WL_MODEL_EXECUTOR`、`WL_CODEX_*` 只按准确新事项范围启用；不得复用旧app身份、扩大tenant扫描或新增request_origin躲避槽位。
4. 切换前记录旧入口的领取状态与原状态；停领新任务、在途保存处理和旧fence拒绝是三项独立检查。不能只停进程就宣称旧写者被隔离，也不能为切换重派原UNKNOWN。
5. 两个root必须留在同一任务可恢复的私有持久存储上；保存准确run/receipt定位，实际重启后按原绑定读回。未取得持久性证据前不启动首个正式新事项。
6. 保留期覆盖未终态、UNKNOWN、COMMITTING及所依赖完整回执；不按TTL删除这些目录。已完成任务在Host成果、独立READ和队列ACK核对后才进入归档候选，具体保留期与清理机制待明确，不默认无限存储或自动删除。

实际prompt、最终上游bridge payload与启动前预定run关联已由19d必要客户端增量接入现有检查点，按本地准确组合另列验证；不另造记录平台。文件fsync和本机SIGKILL恢复不足以代替真实宿主重启验收。现场只读事实、缺口和owner见[首次真实运行准备](WISELINK_CODEX_FIRST_LIVE_READINESS_20261025.md)。

## 业务并发按1→2→4推进

| 阶段 | 准入及安排 | 通过证据 / 停止条件 |
| --- | --- | --- |
| 1 worker | 一个获准新事项，准确模型与封存输入，现成单owner；完整处理一次 | 完整响应持久→合法SAVE→按原key独立READ→同revision确定性Overall实际commit→attempt终态→queueACK→原UI/图同版。任一步未知停止新增派发，保留原结果 |
| 2 workers | 第1阶段通过并另行确认实际provider/宿主容量，两个独立业务请求、同tenant/request_origin | 每个请求独立绑定、检查点和run；无串receipt/来源/ACK，旧fence拒绝，能够恢复单个失败；只做相应容量核对 |
| 4 workers | 第2阶段通过并确认真实限额/资源足够；四个独立业务请求，仍共用原数据库范围 | 验证0..3槽竞争、提交恢复积压、worker和provider占用分别可见；不靠换origin扩容，不把CLI子代理数当业务容量 |

当前Host首批CODEX配置只绑定一个WorkItem与intake request；不能仅把worker数量改为2或4就取得其他事项授权。扩大到多个新事项须先明确逐请求授权入口及范围，并单独审查。当前endpoint flock与active pointer串行保护整批；不能直接开4个相同CLI并宣称4并发，也不能换4个root绕锁。扩到2/4前须在现有消费者中明确按请求分配owner和检查点，保留数据库fence并审查恢复定位。若现成宿主做不到，阶段保持1，先完成窄实现。单个程序初评仍由程序安排步骤和一次受控模型生成，不拆成子代理池。

## 状态证据与处置

| 状态 | 实际证据 | 不能据此推导 |
| --- | --- | --- |
| queued | Host准入与准确intake/task绑定 | 已开始模型 |
| inflight | 外层/内层lease、owner、child run与心跳，分别记录 | 已有可保存正文或provider已结束 |
| saved | Host SAVE receipt及work/block revision，独立原key READ内容一致 | Overall已更新、attempt已完成 |
| projection | Host确定性Overall的实际消费引用与commit/current revision | 队列已ACK、原UI已读同版 |
| ACK | 原claim准确ACK回执及终态/指针释放 | 工程内容已获正式采用 |

图从同一bindings/evidence/work-packages生成；当前实施树唯一，旧目录保留历史索引。过期接口和演示不继续增加兼容分支；旧成果处置见图契约2.4：可重生/清理的记录先核依赖，未知与在途保留取证。上述实际业务证据当前均未因本地离线测试而新增通过状态。

## 旧内容处置清单

| 类别与定位 | 新版处理方式 | 当前处理 / 后续动作 |
| --- | --- | --- |
| `openclaw/codex-evaluator/contracts/host-source-interface.json`及其固定来源 | 仅作为925历史来源与比较证据，不据它给当前Host扩兼容；当前实际接口为`host-codex-interface-20261025/` | 明确来源版本和当前包；待外部owner接收准确包后，可在后继删除已无消费者的旧导出与测试副本，先核引用 |
| `tmp/wiring-progress-revision-20261023/`等旧图目录 | 历史快照，不与当前图互相同步；当前摘要不再重复所有旧批次 | 旧文件保持；当前README和图明确实施树。后续可归档/清理旧预览，保留必要证据索引 |
| 旧协议保存的工程/翻译成果 | 不要求新版继续生成旧形状；有真实需要时按新版新请求重生成 | 清理前列准确版本、当前指针及Wiki/阅读/Overall依赖；本次未读业务表建立对象清单，未删除或重生成 |
| 旧无完整绑定/无Host封存的执行检查点 | 不迁为新恢复协议，不新建请求冒充原结果恢复 | 显式pending/UNKNOWN，保留原件；新版新任务走新协议 |
| ATT5等UNKNOWN、COMMITTING和在途记录 | 保留取证与原正常收尾规则，不能按TTL或“旧版可清理”自动重放/删除 | 不阻塞新版新事项验收；需处置时按准确原对象和实际状态另列动作 |

兼容不是前置要求，处置也不是完成新版第一条闭环的前置要求；两者分别跟踪，不能遗漏或默默迁移。


## 分开交付与运行前置

- 首测核心交付检查：准确组合/当前接口与图定稿、标准构建，结果以准确交接回执为准。运行剩余项：实际宿主唤起、两个私有持久root、可信身份/单事项范围和新输入/run持久关联的现场证明；之后仅在明确批准下做一次新事项完整链。
- 翻译并行：独立Host封存恢复候选和接口交接，云端客户端接入；技术切换与真实恢复单列。首测包不含新增 READ_GENERATION / SEAL_CANDIDATE / RECOVER_SAVE，当前P1代码不会成为本次首测交付依赖。

先前f57接口ZIP已定稿，974保留为历史；本次准确接口包由新组合导出。所有包均不以本地存在冒充部署，也不包含并行翻译扩展。本地文件路径不是已经完成的跨会话附件传递。
