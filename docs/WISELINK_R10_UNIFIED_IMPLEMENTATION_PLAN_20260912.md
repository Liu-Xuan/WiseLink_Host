# WiseLink R10 统一架构实施计划（2026-09-12 修订）

本文件将 2026-09-11 统一架构确定稿转换为当前可执行计划。附件中的示例 API、SQL、ID 和测试情节是设计参考；代码、数据库、平台发布和真实业务运行必须分别以当前状态为准。

## 当前架构决定

WiseLink 使用妙搭 NestJS Host、PostgreSQL/Drizzle、FileService、React/Reader/Cytoscape、官方 Hosted OpenClaw 和 Aily。Host 是身份、授权、SourceRef、DocumentVersion、事项工作、事务/CAS、候选保存和正式采用的业务控制面；OpenClaw 负责工程分析候选，Aily 负责自由对话。

文档处理主线修订（2026-09-12，2026-09-13 执行）：默认由 Host 直接调用官方插件，配合 PDF.js 原文对照、确定性结构整理和按需视觉；当前小实例 MinerU 模型恢复退出本批关键路径。Host 保留来源授权、parseRun、FileService 读回、发布 CAS 和持久恢复。插件配置、目标 Host 实际调用、内容质量和业务发布分别验收；旧 Worker 探针与历史失败不替代这些证据。

Translation V2 继续使用语义块、来源 anchors、GenerationRequest、局部检查与块恢复。普通正文接 ai-translate，结构内容接 ai-text-to-json 专用实例；中文独立于工程原文分析，不继承 M3/DLI 工程模型的生产者身份。工程分析、归集、修订比较和适用性只读取原文/原始记录及有根来源的工程工作。未知范围随输入保留，无强制人工逐块核对。

M 负责 F1—F6、工程工作、检索、来源监控、共享身份/调度与最终集成；P 负责 Host 内解析、Translation V2 和局部 Reader。公共模块、依赖/锁文件和集中迁移由 M 单写，文档专用类型和实现由 P 单写。实际任务与接缝记录见 [M 集成交接](coordination/M_INTEGRATION.md)。

当前交付按 H0/H1/H2 汇合：H0 确定唯一原文适配、实际身份/lease/云端消费端口及发布同事务 pending；H1 完成一份获准文字 PDF 的确切原文、首批中文、Reader 和无需等待翻译的工程输入；H2 验证原文纠正/新来源、局部中断恢复、准确工作修订及页面后统一技术交付。后台自动发现与正常上传分别验收。复杂视觉、其他未接通来源与高配 MinerU 不作为普通资料统一前置。

F1—F6 按当前代码修复，已修项不重做；F7 改为插件真实能力状态与持久恢复。先保存正文与确切 pending，再在提交后独立重建投影；原文发布的 pending 同事务登记，译文变化不触发工程重评。共享环境先核对在途，再停止旧 MinerU/旧 OpenClaw 翻译新派发，不停有效工程评估，不先清库。

当前不部署 QMD、LightRAG、Graphiti、KaaS、Basic Memory、额外向量/图平台、本地检索模型、SQLite 知识镜像、第二业务状态机、通用事件总线或自建全局执行器。检索复用现有授权边界和 PostgreSQL 可重建投影。

## W0—W5 工作范围与历史实施证据

以下 2026-09-12 记录保留当时事实。旧 Worker 实现与恢复路线、异步事务内索引、仅完整扫描才输出正向变化等描述是本轮待纠偏的历史实现，不作为当前目标；执行顺序以上述 H0/H1/H2 为准。

**W0 协议和运行边界。** 核对真实 controller、ActionAttempt、模型输入/保存、Reader、前端和 Worker 传输适配器；停用 Host 本地 MinerU 自动恢复/本地派生进程，保留远端任务状态和 parseRun。清理仅限明确属于 WiseLink 的测试数据，先停止派发和在途任务；不删除共享目录原件、其他应用、平台共享表或凭据。

2026-09-12 W0 收敛：Matter JobAid 新任务只接受带完整 `problemWork` 的前次工作，不再生成或消费 `previousWork.legacySummary`。只有旧摘要的历史状态明确返回 `JOBAID_PREVIOUS_WORK_INCOMPLETE`；已发出的旧 v2 保存任务明确返回 `MATTER_JOBAID_LEGACY_WORK_UNSUPPORTED`，避免用兼容补字段继续运行。历史记录保留，未执行数据删除或回填。

2026-09-12 实施进度：Host `DocumentParsingHostedService` 已移除本地 MinerU runtime/runner 派发，改经 `MineruRemoteWorkerClient` 发送已授权原件；未配置远端凭据会返回明确的 `MINERU_REMOTE_WORKER_NOT_CONFIGURED`。仅收到 Worker 排队回执时不会进入 stage/publish，而会记录 `MINERU_REMOTE_WORKER_ARTIFACT_TRANSFER_PENDING`，等待后续带有可核验产物描述符的传输协议。该改动已通过服务端、客户端类型检查及既有 18 项定向测试；Worker 真实产物回传、Host FileService 读回和 parseRun 发布仍未验收。
Worker 现有 `tasks/:taskId` 与 `tasks/:taskId/result` 接口已接入 Host 客户端并增加任务/产物响应校验；Host 侧仍需完成签名产物下载、重新写入 Host FileService、逐项读回及 parseRun CAS 发布，当前不把 Worker 自有 bucket 直接当作 Host 来源。
2026-09-12 进一步完成代码接线：Host 按 `PRUN-*` 派生幂等 `MW-*` taskId，轮询 Worker 到终态，校验每个签名产物的 URL、长度和 SHA-256，将受控结果转换为现有 MineruParseResult，再复用 Host `MineruArtifactStore`、逐项读回和 parseRun stage/publish CAS。服务端类型检查、生产构建及远程 Worker wiring 测试通过；Worker `sprint/default` 已推送提交 `ec6a027`、`978c4de`，并在带妙搭路径前缀的 `/openapi/mineru-worker/*` 入口实际启用 `WL_MINERU_WORKER_API_KEY` Bearer 校验（缺 key 默认拒绝），Host 继续使用同一 token；密钥不入库。真实 FTD parseRun 仍待带用户会话的业务验收。
本轮运行核验：Worker 带 `CLIENT_BASE_PATH=/app/app_17bzc551rsg` 启动后，无 key 请求返回 401，正确 Bearer key 的 health 返回 200；调用 `runtime/prepare` 后状态由 `PREPARING/FILES` 进入 `FAILED`，错误码 `MINERU_RUNTIME_PREPARATION_FAILED`，`totalFiles=56`、`verifiedFiles=0`。这是 Worker runtime 包/部署环境未就绪的真实阻塞，Host 解析闭环代码和鉴权已验证，但不能据此宣称 FTD parseRun 成功。
本机直接运行同一离线安装脚本返回 `MINERU_OFFLINE_PLATFORM_UNSUPPORTED`（当前 macOS/本机架构不满足 Worker 要求的 Linux x86_64 CPython 3.10）；因此不能用本机结果替代 Linux Worker 部署验收，也不修改离线 runtime 包绕过检查。

**W1 完整工作依据。** 共用 collectEvidenceUses 按类型收集主张、风险、措施、分类、方法/要求、依赖和前提引用，保留位置与作用。阅读不等于分析；已读但未用于工作的材料记录 `READ_ONLY`，只比较本轮范围且确认没有实质变化的材料记录 `NO_MATERIAL_CHANGE`，部分核查仍保留未覆盖范围。保存事务同时写完整工作、依据使用、输入处置、影响范围和 CAS；当已有工作完全没有实质变化时，只保存本轮 coverage，不生成新的 substantive result 或 problemWork；请求结果不确定时按原 request 回读。

**新原文适用性接线（2026-09-13 实码核对后的实施边界）。** 当前 `CanonicalHostApplicabilityInputProducer` 的受控目标选择、提交前复核，以及 `CanonicalHostOpenClawApplicabilityService.buildTaskContract` 都读取 frozen.2；既有输入/候选投影及任务、结果声明也强制包含 package 身份。因此不能只把正文替换为 parseRun，或用 parseRun 冒充 packageId。后续同批修改这两个真实消费者和其来源类型：新任务显式绑定 DocumentOriginalBinding 与已验证原文产物，旧已发任务继续按其确切来源恢复；新无 package 文档不构造 frozen 兼容包。

条件提取使用原文及真实单元/定位目录，不能把所有段落预标为 source_asserted 条件，也不能把机型提及直接映射为全篇适用性。沿现有 EXTRACT_APPLICABILITY 模型调用返回候选条件、原文引句/SourceRef 与候选作用范围；Host 按已读取的源目录核实引用、解析目标关联，并用受控目标/asOf/Fleet 与现有 Kleene 引擎求值。范围不明确、决定性未读或条件无法可靠映射时保持 UNKNOWN/WAITING_INPUT；普通无影响内容继续可用于 JobAid。提交前同时复核原文版本、目标选择和原有 CAS，不能因重建输入而静默替换在途任务。后继必须用已发布原文版本形成的持久幂等请求，不用浏览器轮询补造请求，不重放失败历史。此段是下一实现约束，尚未证明上述迁移已完成；当前已完成的仅是 WorkItem 原文变化状态识别。

**W2 统一上下文和 Reader。** WORK_ITEM 与 ENGINEERING_MATTER 共用来源、target/asOf、适用性、方法版本、变化和精确旧工作装配，Overall 读取指定修订。事项新任务使用当前登记方法包，恢复/Review 从精确 `problemWork.methodBinding` 取快照，不以进程默认常量覆盖历史版本。Reader 保留段落、警告、列表、表格、脚注、跨页条件、图像状态和原生记录 selector；未读、未找到、无权限、未接通和部分结果分开呈现。

**W3 授权检索投影。** 复用 EngineeringIssueSearchService 精确读取和 ACL，建立可重建的语义段、原生记录和完整问题投影及 GIN 索引，保留 tenant、owner、精确 revision、locator、上下文、原文和索引版本。中文使用 Intl.Segmenter 词级分词和 PostgreSQL simple 配置；文号、件号、软件版本走精确匹配。查询参数化，结果带精确引用、命中理由、根来源、hasMore 和限制；全文命中不等于权限或适用性。
工作投影失败现可按 tenant/精确 revision 批量恢复：授权读取由调用方注入，单项失败继续留在 pending，不能以重建结果替代原始记录。
Canonical Host 现提供受登录和对象入口保护的 `POST /api/canonical-host/engineering-issues/projection/rebuild` 受控恢复入口；limit 仅允许 1–100，恢复仍沿用当前 actor/tenant 精确读取，不新增队列或执行器。

2026-09-12 实施进度：现有问题候选查询已改为参数化 PostgreSQL `to_tsvector('simple')`/`plainto_tsquery`，并保留规范化文号、件号、软件版本的精确匹配；命中后仍逐项调用现有完整工作读取和 actor/tenant ACL。独立持久化 projection 表及其 `search_vector` 生成列、GIN/租户范围/标识符索引已在迁移和 Drizzle schema 对齐；已增加只接受调用方已授权 Reader 文本的 SOURCE/RECORD 投影写入原语，但尚未接入真实来源消费者，当前不宣称全量检索。

已补充 `engineering_search_projection` 的 Drizzle 结构和 0039 迁移：保存租户、owner、精确 revision、entry/locator、原文、分词文本和索引版本，数据库生成加权 `search_vector` 并建立 GIN/标识索引；RLS 只允许当前租户 owner 读取。WorkItem 与 EngineeringMatter 成功保存后都会异步重建对应问题投影；若重建失败，新增 0042 的租户/精确 revision 待重建标识，成功重建后删除，正文保存不回滚。`listPending` 提供租户范围的精确待重建清单，供后续原生任务/触发器恢复；开发数据库已执行并核验 0039/0042，Hosted 真实索引查询和恢复任务仍待运行验收。
投影搜索为授权展开预留最多 101 个候选，`hasMore` 只由实际可读的第 51 个命中决定，不能由被拒绝投影行制造分页提示。
本轮通过妙搭 `lark-cli` 用户身份通道取得有效开发库连接并实际执行 0039；随后执行 0042 待重建表。在线核验确认表、GIN/唯一索引、生成 `search_vector` 列和 RLS 均存在；三张新增表当前均为 0 行，尚无真实工作投影或待重建记录。`.env.local` 直连仍返回 PostgreSQL `28P01`，不能以本地连接替代 Hosted 通道。
检索服务增加 `WL_ENGINEERING_SEARCH_PROJECTION=1` 受控切换；开启后先查投影，再按精确 revision 回读完整工作和 ACL，未开启仍使用现有路径，避免迁移未发布时静默断链。
投影写入现在优先复用 WorkItem/Matter 保存事务的数据库句柄，保留平台设置的 tenant/actor RLS 上下文；无事务句柄的重建任务才开启独立事务。相关保存与 continuation 测试共 36 项通过。
历史审查曾修正事项投影的身份映射：`owner_id` 继续保存创建者用于 ACL，`parent_context_ref` 保存真实 `matterId`，投影命中回读事项工作时不再把创建者误当事项 ID。新增隔离测试覆盖该边界；类型检查及 3 项投影/迁移测试通过。随后已通过妙搭 Hosted 通道执行并核验数据库迁移；当前仍不启用投影开关，直到真实工作投影和授权展开完成运行验收。
随后修正候选覆盖边界：事项成员的现有 `authorizedMatter`/输入授权不能由投影的创建者列预筛掉。0039 的 RLS 现在只限定当前租户，查询只返回投影身份元数据，命中正文仍必须逐项通过现有完整工作读取和 ACL；在真实工作投影和授权展开验收前不启用投影开关。

检索返回协议已补齐 `kind`、`matchedRange`、`reason`、`rootRefs` 和 `limitations`。当前已接通的消费者只返回 `WORK` 问题工作；命中理由区分精确问题标识和全文，正文仍需按精确 revision 与现有 ACL 展开，不能把命中元数据当作授权或全量统计。投影路径将持久化 `USER/MATTER` owner 映射为公开的 `WORK_ITEM/ENGINEERING_MATTER` subject kind，避免投影写入语义与读取协议不一致；仍尚未接入来源语义段和原生记录类型。

投影搜索现在也根据 `identifiers` 命中分支返回 `EXACT_IDENTIFIER`，其余返回 `FULL_TEXT`；两条路径都继续按精确 revision 和现有 ACL 回读正文。

事项检索界面已展示检索限制、命中方式、命中范围和根来源数量；用户可据此判断结果边界，再展开确切工作版本。界面没有把搜索候选自动加入当前事项。

**W4 共享目录和变化。** 首批接技术资料目录 Q6uSfDwcDlBrUldWvZccoje8nXf 与每日运行目录 Oy1vfy8nslGZeUdBBkoczv0Fnxh，其余目录、SB、AD、会议和问题表复用同一配置机制。后台使用真实获准应用/委托身份。扫描采用递归分页、可恢复 frontier/游标和周期对账，事件只作加速；文件、期次、报道和原生记录分别建模，同名、token 或字节相同不能替代业务身份。
候选身份比较按 `sourceKey + providerObjectId` 隔离；不同共享根即使返回相同 token 也不会互相覆盖或误判为不变。供应方没有版本号时，以授权返回的 `modifiedTime` 识别变化；两者都缺失时保守标为需复核的变化，不宣称内容未变。

2026-09-12 平台只读核验：六个用户提供的链接均解析为 `folder`。当前用户身份可以列举全部六个根目录；“工程分析报告”首层已返回 200 项且 `has_more=true`，证明必须保存分页游标，“运行信息”首层返回 42 个文件，“TFU/ISI/FTD/FTAR”返回 4 个子目录，“安全生产会工程部汇报材料”返回 4 个子目录，“LE例行报告汇总-综合 安全 可靠性”返回 3 个子目录，“与空客团队月度技术例会”返回 3 个子目录、2 个文件和 1 个在线表格。以 bot 身份读取首个目录返回 Feishu `1061004 permission_denied`；因此后台监控目前不能借用用户会话，必须先给 Host 使用的应用/委托身份授予这些共享目录的读取权限，再做递归扫描和真实增量验收。该核验未修改任何文件夹或权限。

扫描核心 `scanDriveFolders` 与 `runDriveFolderScan` 已实现递归 frontier、独立分页游标、页内 `entryOffset` 和有界恢复。缺失或重复分页 token 会记录 blocker；权限拒绝（403/1061004）保留断点并记录 `DRIVE_AUTHORIZATION_DENIED`，网络或未知错误直接抛出。扫描不完整不代表已观察到的新增或变化无效，也不能据此推断未出现的旧对象已删除。

F6 的逐页持久化已接入 `DriveScanCheckpointRepository`：同一租户、来源的 checkpoint CAS、已观察对象快照和 pending 受理意图在同一数据库事务内保存。对象按 `sourceKey + providerObjectId` 合并，不以当前批次替换全量快照；本页写入失败时游标和对象一起回滚，重启从原页恢复。`DriveSourceScanService.scanCandidates` 即使 `complete=false` 也返回本批已观察对象的 `NEW/CHANGED/UNCHANGED`，并返回跨批保留的 `pendingCandidates`。`complete` 仅表示配置的 frontier 已扫完且没有 blocker，不能当作正向增量进入后续处理的前置条件。

变化分类同时比较 provider version 与名称、路径、类型、修改时间；相同版本号下的元数据变化仍为 `CHANGED`，版本号和修改时间都缺失时保守要求复核。此分类只生成来源受理意图，不直接认定工程内容变化。数据库 schema、0040/0041/0046/0051 迁移及服务注册已存在；本地 PostgreSQL 测试覆盖 A 页提交、B 页写入失败回滚、从 B 恢复至 C、旧 checkpoint 冲突拒绝，以及 service_role 与 authenticated 的 RLS 边界。测试中的构造身份和分页 fetcher 不证明真实 Drive 授权或线上扫描成功。

`wiselink-drive-source-config.ts` 已登记六个共享根，`DriveSourceScanService` 拒绝未登记来源并仅接受外部注入的授权分页 fetcher。2026-09-12 六根复核中，用户 CLI 均可读并返回独立分页 token，bot 均返回 `1061004 permission_denied`；该记录只证明当时可见性，不授予后台访问权。SB、AD 仍以显式未接通来源族保留，不能伪造根目录。

W4 尚未闭环：真实获准的应用/委托 Drive fetcher、下载到普通资料受理的事务消费者、pending 成功确认和平台原生定时入口仍需接通并实测。现有 pending 持久化不能替代 DocumentVersion/family 登记或自动分析；当前不能宣称后台监控已运行。上游授权未恢复时，继续独立验证普通资料上传、原文解析、中文阅读和工程处理，不以共享目录权限阻塞普通文档流程。

**W5 跨事项复用和用户接续。** Wiki、动态记录和关系图读取同一工作与来源关系。B 可复用 A 的完整论点和根来源，但比较自身目标事实、条件和受众，不继承 A 的适用性或构型结论。Aily 只读取 Host 保存且当前授权可见的工作；普通对话不自动正式采用。

2026-09-12 阅读链路核对：`DocumentVersionReadingPage` 只读取指定 `documentVersionId` 的已发布 `parseRunId`，并将该精确 run 传给 `readParsedDocument`、图片资源读取和原文定位；Host 端图片接口再次执行文档读取授权、发布状态和已核验 IMAGE 描述符检查，未授权或非发布产物返回明确错误。`MineruMarkdownReader` 使用完整 Markdown、表格/列表/脚注与 `MineruReadingProjection` 绑定来源，无法唯一绑定时保留“部分内容尚无精确定位”，不伪造页码。事项快览和目录读取 `working.current` 及 `currentWorkingRevision`，并明确待覆盖输入、实际核查范围和“关联不代表已读取”。客户端类型检查已通过；尚未完成一次带真实用户会话的 Hosted 页面验收，Wiki 图谱与 Aily 的真实回流仍待运行证据。

## 验收顺序

依 H0/H1/H2 顺序验收 F1—F6、目标 Host 插件与真实原文消费、增量及恢复。上游正式授权与插件质量并行推进；授权未接通时以获准正常上传验证文档与工程链路，并明确不是后台自动发现。每批按风险运行类型检查、定向单测、必要 PostgreSQL 事务/索引测试和真实页面到 Hosted 流程。

完成报告分别说明代码、安装、技术发布和业务运行，并回答删除的旧路径、复用的职责、真实用户结果、实际用于判断的输入、失败接续和未接通来源。历史失败保留；不自动确认 ReviewAction、正式采用、审批或实施。
