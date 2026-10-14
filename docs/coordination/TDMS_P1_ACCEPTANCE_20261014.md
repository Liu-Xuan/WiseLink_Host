# TDMS / LCM 一期独立验收（2026-10-14）

## 结论与证据边界

一期真实业务尚未通过。可交付的是受审查的读取、版本隔离、目录和安全代码候选；来源接收、原件绑定、生产来源授权、同租户双真实用户及真实 LCM 构型仍须分别验收。代码、安装、真实业务和正式采用不相互替代。

本记录以用户 **2026-10-14 修订版**为准（附件 SHA256 `e3dc1012f8e74ecb0560ed901c8992d7684bd1b95a47663ce6a059f0ffa953be`）。每张评估单自身确认 `Estimated` 后才能采集、保存和展示正文；`Estimating`、未批准或未知只保留身份、元数据和状态。原版“未批准正文只读展示”建议及其通过记录已撤销，不能作为本批准入证据。

QA 仅修改新验收文件，不修改生产代码、产品权限、原生 Goal、采集器、调度、生产数据库或正式采用。组合快照只用于隔离测试；主线合并、push、发布均为零，最终集成由指定协调聊天负责。

## 精确版本

| 来源 | 版本及用途 |
| --- | --- |
| 起点 | `76646b9ec621b8d293767c85f45d74a259ae02f2`，QA 分支 parent |
| root 最终 | `59070d17b21344ddfe0dddcb28db0b3ef597a655`，parent `854b46c6f03a9e682e8eddfc8c5b0d4c7c88e18c`；共享合同、LCM 读取、body policy、精读返回 |
| Host 第一批 | `5bfbd537197361ac6c60f32d50699895a7eb9fa6`，精确版本读取及 SQL 分页 |
| Host 安全/历史 | `2f0bb3d5b1724ca7260bfc54d3f40d12e6300f03`，parent `5bfbd537197361ac6c60f32d50699895a7eb9fa6` |
| 前端第一批 | `55f753ed0545d84588accdc0d08d8bfc448439ab`，parent `76646b9ec621b8d293767c85f45d74a259ae02f2` |
| 前端状态说明 | `3ce18fd95db9efa61d3c60da9e4ea49710be1aa9`，parent `55f753ed0545d84588accdc0d08d8bfc448439ab` |
| Host 最终 | `6fa764c3ca313514a5dcba05f687708941b4a4c4`，parent `fe702846caacfe2ae669b3985511b862757a1952`；目录实 SQL 修复与普通父字段专用策略 |
| 前端最终 | `d32e004fc466b501387f43bac0c3e7a40fda2dd4`，parent `3ce18fd95db9efa61d3c60da9e4ea49710be1aa9`；目录实际消费者与原版本读取 |
| QA 测试 | `347175c5ec38eb268a63048aec84721a437e0ae5`，parent 起点 `76646b9ec621b8d293767c85f45d74a259ae02f2`；仅新增四个 Node 文件与一个 Jest 文件 |
| TEST_OVERLAY_ONLY | `e80fe615733a30cf43a19ca5bb8506917750b8f0`，parent root `59070d17b21344ddfe0dddcb28db0b3ef597a655`；仅独立本地测试快照 |

测试依赖由 root 临时复制的 shared、package/alias、reading-return 文件不纳入 QA 提交。组合使用独立 `/private/tmp/wiselink-tdms-p1-acceptance-overlay-20261014` 本地 clone，以各路精确 Git blob 覆盖，78 个来源文件逐字节核对后正常提交。来源 vector 和每文件 SHA256 保存于 `/private/tmp/tdms-p1-acceptance-overlay-source-vector.json`。构建指纹实际绑定上述快照，`buildTime=2026-10-14T05:27:40.502Z`，最终 Git clean；没有放宽检查或注入 HEAD。

快照不是主线接受、部署、安装或采集来源版本，也不能作为主线 merge 输入。最终报告提交只新增本 Markdown，parent 为 QA 测试提交；其独立 SHA 由正常提交回执与交付清单给出。报告变化不改变已验收的生产向量或测试文件，不重复冻结树的通过集。

## 独立发现、修复与复测

| 风险 | 独立发现及结果 |
| --- | --- |
| 无界来源读取 | 旧 SQL limit=4 实取 90；新查询在 SQL 内 seek/limit，非法 limit 明确拒绝 |
| 版本串读 | 旧 `documentVersionId` 目录过滤无效，R01 页混入 R02 和未知目标；新接口只返回明确目标绑定 |
| 读取先决权限 | 旧所选 DV 拒绝未在查询前执行；新版本先核所选 DV，授权改变时拒绝释放 |
| 历史意见丢失 | stable source 同版修订后改绑 R02，R01 必须仍读取最近合法保留观察；迟到旧观察不冒充新状态 |
| 草稿入口绕过 | Complete1 / bounded / visible 早返回绕过自身 `Estimated`。新增拒收在数据库事务、文件取得前执行 |
| 父批准借用 | 已 `Estimated` 的父处理单含无子批准证据的“专业评估意见”曾成功入库；已交 Host 修复并独立复测 |
| 旧数据投影 | 实际 raw response mapper 对未资格的保留专业正文返回 metadata-only；预览不读取草稿 getter 后再过滤 |
| 错误 NON_OPINION policy | 已知评估单、COMMENT、PROCESSING_SHEET 不能借错误 non-opinion 标记绕过门槛；缺 policy / 错 ref 均拒正文 |
| 目录节点 | 旧版新 `ata2` / `ata4` 参数被忽略；最终实 PG 验证父级独立去重、ATA2 本级、未知/raw、显式 current 分类、fleet/model 交集及精确 leaf |
| 目录真实 SQL | `fe702846` 的聚合请求实际 PostgreSQL 报 `42P18`，`jsonb_build_object` 的 level 参数无类型；修订为两处 `::text`，最终组合实 PG 10/10 通过 |
| 普通父字段被误隐藏 | generic non-opinion 策略继续拒 PROCESSING_SHEET；新专用 `OWN_PROCESSING_FIELDS` 仅容明确 SB/SL 父单普通字段。实际预览/render 正例通过，评估/AD分处理/矛盾类型/错 ref 负例 getter0，子专业意见仍不得借父批准 |

## 本地验证记录

| 执行范围 | 已完成结果 | 限制 |
| --- | --- | --- |
| 766 基线定向 Jest | 9 suites / 235 tests，通过 | 历史现状；涉及旧草稿展示的正例不再作为新规则通过证据 |
| 766 意见/处理集合 Jest | 3 suites / 177 tests，通过 | 授权及来源为显式 doubles，不是真实批准或真实登录 |
| 766 既有 owned PostgreSQL | 4 文件 / 28 tests，通过，无 skip | 实际 SQL、事务、CAS、RLS；身份及政策为隔离 fixture |
| 独立 TDMS PG 新测试 | 10 tests，通过 | 两 scope 180 synthetic 记录、R01/R02/未知、幂等、分页、权限拒绝、历史/迟到 |
| 独立 LCM 服务边界 | 8 tests，通过 | default503、实际 Nest 默认模块、actor/tenant/app、scope/ref、二次授权、时间/unknown；store 为 double |
| 独立严格正文准入 | 11 tests，通过 | Complete1、合法 bounded/visible 形状、父/子、替代通道、批准补取、legacy mapper、preview/model getter0、专用父字段正负例 |
| 独立执行前端新测试 | 4 suites / 19 tests，通过 | body/API/version/ATA；仍为本地 UI/API doubles |
| 独立目录新物理 SQL | 10 tests，通过 | 实际正式资料 SQL 的去重、current/历史、分页前过滤、直接本级及未知；表和身份为 synthetic，未证明真实 audience |
| 独立精读返回 | 1 suite / 3 tests，通过 | ATA2/ATA4 保留、缓存范围隔离、错版/重复节点/写意图负例；源为 root 最终 helper |

最终组合的实际执行回执（全部针对 `e80fe615`，不是仅采信开发者报告）：

| 检查及实际命令 | exit / 结果 | 原始日志 |
| --- | --- | --- |
| 正常 `git commit` → `npm run precommit` → `npm run lint` | 0；实际调用全量 ESLint、`type:check:server` 与 `type:check:client` | `/private/tmp/tdms-p1-acceptance-overlay-commit.log` |
| `npm run build:prod` | 0；Nest + Vite 成功，客户端 14.87s；仅既有 chunk 大小告警 | `/private/tmp/tdms-p1-acceptance-overlay-build.log` |
| 定向 `jest --runInBand`：前端9新 suites、Host policy/精确版/目录3 suites、QA返回及原生模块各1 | 0；14 suites / 74 tests；47.352s | `/private/tmp/tdms-p1-acceptance-overlay-jest.log` |
| `node --test --test-concurrency=1`：QA4文件 + `lcm-snapshot-browser-postgres.test.mjs` | 0；45/45，0 skip；20.840s；其中 TDMS PG10、目录 PG10、strict11、LCM服务8、LCM实际隔离 PG6（synthetic） | `/private/tmp/tdms-p1-acceptance-overlay-node.log` |

目录修复前失败原始日志 `/private/tmp/tdms-p1-acceptance-directory-fe702846.log` 保留。最终通过针对新 `6fa764c3` 字节，复制清单和构建指纹均可追溯，未重跑旧 `fe702846` 冒充修复验收。

真实规模、首屏和 PDF 就绪时延没有当前数据，不能填达标；临时 PostgreSQL 的查询时间不是业务 SLO。草稿四通道的本地证明包括入库拒绝/错误诊断不回显、API mapper、预览/render 和模型审批 getter0；不是实际采集器、线上日志或网络的零正文证明。

PostgreSQL 引擎首次因 sandbox 的 SysV shared-memory `shmget` 被拒而未执行业务 SQL，随后工具自动审查允许运行随机 loopback 临时实例。同一组检查完成后实例已清理；没有采用生产 URL、固定共享端口或放宽产品 RLS。

独立可运行命令（在 QA 工作树，`WISELINK_TDMS_P1_TEST_ROOT` 指向精确候选或最终测试快照）：

```sh
WISELINK_TDMS_P1_TEST_ROOT="$CANDIDATE" node --test test/node/tdms-p1-acceptance-pagination.test.mjs
WISELINK_TDMS_P1_TEST_ROOT="$CANDIDATE" node --test test/node/tdms-p1-acceptance-directory.test.mjs
WISELINK_TDMS_P1_TEST_ROOT="$CANDIDATE" node --test test/node/tdms-p1-acceptance-lcm-boundaries.test.mjs
WISELINK_TDMS_P1_TEST_ROOT="$CANDIDATE" WISELINK_TDMS_P1_FRONTEND_TEST_ROOT="$CANDIDATE" node --test test/node/tdms-p1-acceptance-draft-gate.test.mjs
```

日志及原始失败回执独立保存在 `/private/tmp/tdms-p1-acceptance-*.log`；组合来源 vector、文件哈希和最终构建日志另存私有验收记录。拒收用的草稿 marker 仅为 synthetic；未回显真实身份、草稿或意见原文。

## 真实证据与恢复条件

已独立只读核对 TDMS 八项清单（记录时刻 `2026-10-14T00:43:20.751509+00:00`）：八项 `complete=false`，原 `actualAcceptance` 保存各项中文未验收原因；本记录独立结论八项均为 `NOT_ACCEPTED`。`SourceReady`、`BaselineComplete`、`WatermarkAdvanced`、`HostReceived`、`SchedulerEnabled` 和正式调度全为 false。开发修复和测试数据不写回此原源清单。

| 来源能力 | 独立真实业务判定 |
| --- | --- |
| 已确认范围的目录发现、筛选与覆盖 | NOT_ACCEPTED |
| 对象自身身份、技术版本、业务版本及正文 | NOT_ACCEPTED |
| 关系分页、树枚举、原始语义及关联目标 | NOT_ACCEPTED |
| 必需原件、附件归属与版本绑定 | NOT_ACCEPTED |
| 该版工程文件适用飞机完成情况及独立状态表变化发现 | NOT_ACCEPTED |
| 完整性判定、持久化及 Host 最小接收绑定 | NOT_ACCEPTED |
| 扩展基线生成、核对与收口 | NOT_ACCEPTED |
| 增量、去重、恢复、水位及调度接续 | NOT_ACCEPTED |

LCM 既有线上只读回执 `ok=true`，但 configuration-evidence snapshot/fact/event 总数及 LCM 标记均为零；所列七张表为旧 configuration-evidence 层，不能证明 0072 独立来源快照已部署或真实导入。回执没有采集/源截止/生效时间数据。15 份真实导出、manifest 与原件抽检仍须定位并合法接入；`effectiveAt=null` 与新生效未知不补猜。

仍须实现或接线的代码与数据路径是：缺原件状态仍保留身份的正式 Document/DocumentVersion 对象与后补绑定；Host 决定的 TDMS 原生目标→正式版本映射、来源 current audience / 文件读取 provider。Complete1 不能通过来源包自填正式 DV 声称 Host 已绑定。本批 source-only retained identities 和精确 DV read endpoint 没有闭合这些路径。

LCM 当前 repository 仍读 0072 `owner_actor_id` 隔离候选，service grant 的 actor 必须等于当前 viewer，第二个同租户用户会被既有隔离范围排除。因此仅注入 provider 不构成同租户共享；还需现任 Host owner 实现正式共享来源/store 路径及真实 audience。保留当前 RLS 是正确边界，不能用改 actor 或扩大候选权限代替共享模型。

真实一期恢复条件是：先由现任 Host owner 闭合以上代码路径，再采用受支持且实际安装的逐单 `Estimated` 采集器；少量获准处理单、两个专业评估单（一个 Estimated，一个 Estimating）、附件、历史版和缺件补齐样本；两个获准同租户登录会话及跨租户/匿名/只读负例身份；合法接入的 LCM 原件、范围/时间、当前与历史快照。这里不新开登录、不伪造身份或手改数据过验收。

真实浏览需同时记录页面网络和 Host 前后任务/模型计数，确认无模型、无隐式评估；仅查前端 GET 或本地组件不等于服务器零调用。源端采集包、传输、数据库、应用日志、检索及模型上下文还须用真实未批准对象证明正文从未被读取或留下，而不是先读取再过滤。

## 一期清单

| 分类 | 结论 |
| --- | --- |
| 可交付的代码候选 | 正式资料库分层独立去重/叶节点过滤、精确版本原文入口、TDMS retained source 分页/历史、逐单正文门槛与普通父字段预览、缺 provider 明确错误、LCM 候选只读及时间/unknown；组合检查通过 |
| 代码尚需实现 / 接线 | 缺件正式对象及后补同一身份模型、Host 原生目标→正式 DV 绑定、TDMS current/file audience provider；LCM 正式共享来源/store 和真实 audience。当前 owner 隔离 store 不是同租户共享 |
| 真实业务阻断 | TDMS 正式基线/版本/原件绑定、插件安装与 Host 接收未成立；两个真实用户读取链及草稿源端零读取未验证 |
| 真实业务阻断 | LCM 独立来源 store 未生产验证，真实授权未接；实际三类构型及真实历史差异未验收，原件仍 local-reference-only |
| 未覆盖 | collector 分页中断/水位/子对象独立变化真实运行；处理单/评估单/附件/机型全覆盖；真实规模、时延及网络/任务计数；错版和补件真实读回 |

## 二期清单

| 分类 | 结论 |
| --- | --- |
| 已有基础代码 | 现有普通文档解析、保存工作、Wiki/事项路径；TDMS 批准意见 runtime 合同与 LCM history/asOf 本地候选查询 |
| 未启用 / 未接线 | TDMS/LCM 到自动解析与局部评估、意见撤销脏标记、LCM 依赖冻结/精准变更重评，以及本批资料到模型的真实自动入口 |
| 待真实验收 | 新对象端到端→解析→模型→SAVE→同版 Wiki，重复通知、并发旧任务、撤销、语义冲突/holdout、LCM 陈旧/无匹配/部分覆盖、ATA 同版子项集 |
| 正式采用 | 本批没有正式采用、批准、放行或执行确认；模型/来源文字均不自动形成工程决定 |
