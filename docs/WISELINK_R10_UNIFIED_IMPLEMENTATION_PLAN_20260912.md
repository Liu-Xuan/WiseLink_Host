# WiseLink R10 统一架构实施计划（2026-09-12 修订）

本文件将 2026-09-11 统一架构确定稿转换为当前可执行计划。附件中的示例 API、SQL、ID 和测试情节是设计参考；代码、数据库、平台发布和真实业务运行必须分别以当前状态为准。

## 当前架构决定

WiseLink 使用妙搭 NestJS Host、PostgreSQL/Drizzle、FileService、React/Reader/Cytoscape、官方 Hosted OpenClaw 和 Aily。Host 是身份、授权、SourceRef、DocumentVersion、事项工作、事务/CAS、候选保存和正式采用的业务控制面；OpenClaw 负责工程分析候选，Aily 负责自由对话。

解析计算采用独立 MinerU Worker。Worker 只处理 Host 明确授权的原件和解析请求，返回可核验状态、产物描述符和诊断；Host 负责来源授权、parseRun、FileService 读回校验、发布 CAS、失败恢复和阅读投影。Host 不再启动本地 MinerU Python 重解析。Worker 就绪、解析成功、标题增强、产物发布和业务阅读分别记录。

翻译是阅读能力。输入从已发布的原文解析产物生成语义单元；工程分析、归集、修订比较和适用性只读取原文/原始记录及来源回执。按实际 Hosted 模型输入与输出预算合批，计入结构化 JSON 和余量，尽量合并完整段落与表格；字符数不能直接当 token，不能固定 6000 字或强制按章节切分。

当前不部署 QMD、LightRAG、Graphiti、KaaS、Basic Memory、额外向量/图平台、本地检索模型、SQLite 知识镜像、第二业务状态机、通用事件总线或自建全局执行器。检索复用现有授权边界和 PostgreSQL 可重建投影。

## W0—W5 交付顺序

**W0 协议和运行边界。** 核对真实 controller、ActionAttempt、模型输入/保存、Reader、前端和 Worker 传输适配器；停用 Host 本地 MinerU 自动恢复/本地派生进程，保留远端任务状态和 parseRun。清理仅限明确属于 WiseLink 的测试数据，先停止派发和在途任务；不删除共享目录原件、其他应用、平台共享表或凭据。

2026-09-12 W0 收敛：Matter JobAid 新任务只接受带完整 `problemWork` 的前次工作，不再生成或消费 `previousWork.legacySummary`。只有旧摘要的历史状态明确返回 `JOBAID_PREVIOUS_WORK_INCOMPLETE`；已发出的旧 v2 保存任务明确返回 `MATTER_JOBAID_LEGACY_WORK_UNSUPPORTED`，避免用兼容补字段继续运行。历史记录保留，未执行数据删除或回填。

2026-09-12 实施进度：Host `DocumentParsingHostedService` 已移除本地 MinerU runtime/runner 派发，改经 `MineruRemoteWorkerClient` 发送已授权原件；未配置远端凭据会返回明确的 `MINERU_REMOTE_WORKER_NOT_CONFIGURED`。仅收到 Worker 排队回执时不会进入 stage/publish，而会记录 `MINERU_REMOTE_WORKER_ARTIFACT_TRANSFER_PENDING`，等待后续带有可核验产物描述符的传输协议。该改动已通过服务端、客户端类型检查及既有 18 项定向测试；Worker 真实产物回传、Host FileService 读回和 parseRun 发布仍未验收。
Worker 现有 `tasks/:taskId` 与 `tasks/:taskId/result` 接口已接入 Host 客户端并增加任务/产物响应校验；Host 侧仍需完成签名产物下载、重新写入 Host FileService、逐项读回及 parseRun CAS 发布，当前不把 Worker 自有 bucket 直接当作 Host 来源。
2026-09-12 进一步完成代码接线：Host 按 `PRUN-*` 派生幂等 `MW-*` taskId，轮询 Worker 到终态，校验每个签名产物的 URL、长度和 SHA-256，将受控结果转换为现有 MineruParseResult，再复用 Host `MineruArtifactStore`、逐项读回和 parseRun stage/publish CAS。服务端类型检查、生产构建及远程 Worker wiring 测试通过；Worker `sprint/default` 已推送提交 `ec6a027`、`978c4de`，并在带妙搭路径前缀的 `/openapi/mineru-worker/*` 入口实际启用 `WL_MINERU_WORKER_API_KEY` Bearer 校验（缺 key 默认拒绝），Host 继续使用同一 token；密钥不入库。真实 FTD parseRun 仍待带用户会话的业务验收。
本轮运行核验：Worker 带 `CLIENT_BASE_PATH=/app/app_17bzc551rsg` 启动后，无 key 请求返回 401，正确 Bearer key 的 health 返回 200；调用 `runtime/prepare` 后状态由 `PREPARING/FILES` 进入 `FAILED`，错误码 `MINERU_RUNTIME_PREPARATION_FAILED`，`totalFiles=56`、`verifiedFiles=0`。这是 Worker runtime 包/部署环境未就绪的真实阻塞，Host 解析闭环代码和鉴权已验证，但不能据此宣称 FTD parseRun 成功。
本机直接运行同一离线安装脚本返回 `MINERU_OFFLINE_PLATFORM_UNSUPPORTED`（当前 macOS/本机架构不满足 Worker 要求的 Linux x86_64 CPython 3.10）；因此不能用本机结果替代 Linux Worker 部署验收，也不修改离线 runtime 包绕过检查。

**W1 完整工作依据。** 共用 collectEvidenceUses 按类型收集主张、风险、措施、分类、方法/要求、依赖和前提引用，保留位置与作用。阅读不等于分析；已读但未用于工作的材料记录 `READ_ONLY`，只比较本轮范围且确认没有实质变化的材料记录 `NO_MATERIAL_CHANGE`，部分核查仍保留未覆盖范围。保存事务同时写完整工作、依据使用、输入处置、影响范围和 CAS；当已有工作完全没有实质变化时，只保存本轮 coverage，不生成新的 substantive result 或 problemWork；请求结果不确定时按原 request 回读。

**W2 统一上下文和 Reader。** WORK_ITEM 与 ENGINEERING_MATTER 共用来源、target/asOf、适用性、方法版本、变化和精确旧工作装配，Overall 读取指定修订。事项新任务使用当前登记方法包，恢复/Review 从精确 `problemWork.methodBinding` 取快照，不以进程默认常量覆盖历史版本。Reader 保留段落、警告、列表、表格、脚注、跨页条件、图像状态和原生记录 selector；未读、未找到、无权限、未接通和部分结果分开呈现。

**W3 授权检索投影。** 复用 EngineeringIssueSearchService 精确读取和 ACL，建立可重建的语义段、原生记录和完整问题投影及 GIN 索引，保留 tenant、owner、精确 revision、locator、上下文、原文和索引版本。中文使用 Intl.Segmenter 词级分词和 PostgreSQL simple 配置；文号、件号、软件版本走精确匹配。查询参数化，结果带精确引用、命中理由、根来源、hasMore 和限制；全文命中不等于权限或适用性。
工作投影失败现可按 tenant/精确 revision 批量恢复：授权读取由调用方注入，单项失败继续留在 pending，不能以重建结果替代原始记录。

2026-09-12 实施进度：现有问题候选查询已改为参数化 PostgreSQL `to_tsvector('simple')`/`plainto_tsquery`，并保留规范化文号、件号、软件版本的精确匹配；命中后仍逐项调用现有完整工作读取和 actor/tenant ACL。独立持久化 projection 表、GIN 迁移、来源语义段和原生记录消费者尚未完成，当前不宣称全量检索。

已补充 `engineering_search_projection` 的 Drizzle 结构和 0039 迁移：保存租户、owner、精确 revision、entry/locator、原文、分词文本和索引版本，数据库生成加权 `search_vector` 并建立 GIN/标识索引；RLS 只允许当前租户 owner 读取。WorkItem 与 EngineeringMatter 成功保存后都会异步重建对应问题投影；若重建失败，新增 0042 的租户/精确 revision 待重建标识，成功重建后删除，正文保存不回滚。`listPending` 提供租户范围的精确待重建清单，供后续原生任务/触发器恢复；Hosted 数据库迁移和真实索引查询仍待运行验收。
本轮通过妙搭 `lark-cli` 用户身份通道取得有效开发库连接并实际执行 0039；随后执行 0042 待重建表。在线核验确认表、GIN/唯一索引、生成 `search_vector` 列和 RLS 均存在；三张新增表当前均为 0 行，尚无真实工作投影或待重建记录。`.env.local` 直连仍返回 PostgreSQL `28P01`，不能以本地连接替代 Hosted 通道。
检索服务增加 `WL_ENGINEERING_SEARCH_PROJECTION=1` 受控切换；开启后先查投影，再按精确 revision 回读完整工作和 ACL，未开启仍使用现有路径，避免迁移未发布时静默断链。
投影写入现在优先复用 WorkItem/Matter 保存事务的数据库句柄，保留平台设置的 tenant/actor RLS 上下文；无事务句柄的重建任务才开启独立事务。相关保存与 continuation 测试共 36 项通过。
本轮审查修正事项投影的身份映射：`owner_id` 继续保存创建者用于 ACL，`parent_context_ref` 保存真实 `matterId`，投影命中回读事项工作时不再把创建者误当事项 ID。新增隔离测试覆盖该边界；类型检查及 3 项投影/迁移测试通过。数据库迁移仍未执行，待有效开发库连接。
随后修正候选覆盖边界：事项成员的现有 `authorizedMatter`/输入授权不能由投影的创建者列预筛掉。0039 的 RLS 现在只限定当前租户，查询只返回投影身份元数据，命中正文仍必须逐项通过现有完整工作读取和 ACL；迁移未执行前不启用投影开关。

检索返回协议已补齐 `kind`、`matchedRange`、`reason`、`rootRefs` 和 `limitations`。当前已接通的消费者只返回 `WORK` 问题工作；命中理由区分精确问题标识和全文，正文仍需按精确 revision 与现有 ACL 展开，不能把命中元数据当作授权或全量统计。投影路径将持久化 `USER/MATTER` owner 映射为公开的 `WORK_ITEM/ENGINEERING_MATTER` subject kind，避免投影写入语义与读取协议不一致；仍尚未接入来源语义段和原生记录类型。

投影搜索现在也根据 `identifiers` 命中分支返回 `EXACT_IDENTIFIER`，其余返回 `FULL_TEXT`；两条路径都继续按精确 revision 和现有 ACL 回读正文。

事项检索界面已展示检索限制、命中方式、命中范围和根来源数量；用户可据此判断结果边界，再展开确切工作版本。界面没有把搜索候选自动加入当前事项。

**W4 共享目录和变化。** 首批接技术资料目录 Q6uSfDwcDlBrUldWvZccoje8nXf 与每日运行目录 Oy1vfy8nslGZeUdBBkoczv0Fnxh，其余目录、SB、AD、会议和问题表复用同一配置机制。后台使用真实获准应用/委托身份。扫描采用递归分页、可恢复 frontier/游标和周期对账，事件只作加速；文件、期次、报道和原生记录分别建模，同名、token 或字节相同不能替代业务身份。

2026-09-12 平台只读核验：六个用户提供的链接均解析为 `folder`。当前用户身份可以列举全部六个根目录；“工程分析报告”首层已返回 200 项且 `has_more=true`，证明必须保存分页游标，“运行信息”首层返回 42 个文件，“TFU/ISI/FTD/FTAR”返回 4 个子目录，“安全生产会工程部汇报材料”返回 4 个子目录，“LE例行报告汇总-综合 安全 可靠性”返回 3 个子目录，“与空客团队月度技术例会”返回 3 个子目录、2 个文件和 1 个在线表格。以 bot 身份读取首个目录返回 Feishu `1061004 permission_denied`；因此后台监控目前不能借用用户会话，必须先给 Host 使用的应用/委托身份授予这些共享目录的读取权限，再做递归扫描和真实增量验收。该核验未修改任何文件夹或权限。

扫描核心已实现为可注入的 `scanDriveFolders`：每个目录独立维护游标，按 `type:token` 去重，递归加入子目录 frontier，达到批次限制返回 continuation，缺失分页 token 记录 blocker；候选身份快照与 frontier 分开保存，只有无 continuation 且无 blocker 的完整扫描才替换快照，避免中断扫描把旧版本误判为未发现。尚未绑定平台凭据或定时任务。
已补充版本化 `DriveFolderScanCheckpoint` 编解码，断点只保存根目录、递归 frontier、分页 token 和更新时间，不保存用户凭据或文件正文；非法/不完整状态明确拒绝。它为事务内保存和进程退出后的恢复提供了稳定数据边界，但当前仍未接入 Host 持久化表、应用身份凭据或原生定时触发，因此不能宣称后台自动扫描已运行。
扫描器现支持 `onPage` 逐页回调，并新增 `runDriveFolderScan` 协调器：按 `sourceKey` 读取上一断点、以授权 fetcher 执行有界扫描、每页保存 continuation，结束时再次保存最终 frontier。权限拒绝（403/1061004）会返回 `DRIVE_AUTHORIZATION_DENIED` blocker 并保留原 frontier，等待授权恢复后可重试；网络或未知错误仍抛出，不能伪装为空目录。该协调器已用内存 checkpoint store 验证恢复形状；真实 Host 数据库表、平台 Drive fetcher 和定时入口仍未接通。
已增加 Host 侧 `wiselink_drive_scan_checkpoint` Drizzle 定义、RLS 迁移草案（0040）及按租户封装的 `DriveScanCheckpointRepository`，用于承载上述 checkpoint；该表只存扫描状态，不保存凭据或文件内容。迁移尚未执行，Repository 尚未被定时任务调用，仍需有效开发库连接、应用/委托 Drive 权限和平台触发器后再做真实增量验收。
2026-09-12 再次核验六个根目录：`--as user` 均可读，且首层均返回 `has_more=true` 与独立 `next_page_token`；`--as bot` 六个目录均返回 Feishu `1061004 permission_denied`。因此用户会话可见性没有转化为后台监控授权，当前不能把这些目录接入自动扫描，也不能借用户 token 运行。
Host 已新增 `DriveSourceScanService` 作为来源扫描业务入口：按登记的 `sourceKey` 和租户绑定 checkpoint，调用外部注入的授权分页 fetcher；未知来源在调用 fetcher 前拒绝。服务不创建用户会话、不内置定时器，便于后续接入获准的应用/委托身份和平台原生触发器。当前仍未形成真实来源文件登记或增量工作，因此不宣称监控运行。
服务级测试已覆盖登记来源的真实调用形状（operations 根目录 token、租户 checkpoint、文件条目返回）及未知来源 fail-closed；测试使用内存替身，不能替代飞书应用身份、数据库迁移或 Hosted 定时任务验收。
生产服务构建已通过并收录新增扫描 schema、Repository 与模块注册；构建只证明代码产物可编译，不代表 0040 已执行或后台扫描已运行。
受影响范围综合验证：Drive 扫描器、checkpoint 编解码、扫描协调器、Host 来源服务和 0040 迁移契约共 5 个测试套件、8 项测试通过；服务端与客户端类型检查均通过。
Hosted Document Management 公共入口已导出 `DriveSourceScanService`、`AuthorizedDrivePageFetcher` 和 `DriveScanCheckpointRepository`，后续平台原生触发器可通过模块公开接口接入，不需依赖内部文件路径；全量类型检查和服务测试再次通过。
Host 来源服务测试新增两次扫描恢复场景：首批仅处理第一页并保存 `next_page_token`，下一次同租户同来源直接从该 token 请求第二页，未从根目录重扫；服务端类型检查通过。该证据仍使用替身 checkpoint/fetcher，未替代真实平台运行。
扫描结果现可转换为仅含来源身份的 `DriveSourceCandidate`（sourceKey、provider object/version、类型、路径、修改时间）；文件夹被排除，候选不会自动进入分析。该映射及测试用于后续真实来源登记，仍不替代平台授权和业务受理。
`DriveSourceScanService.scanCandidates` 已将扫描结果与身份候选作为 Host 公开服务结果返回；服务测试覆盖候选生成、版本标识和“不自动受理”边界，共 4 项通过。真实候选写入 DocumentVersion/family 或触发分析仍未接通。

候选变化分类已补充为 `NEW`、`CHANGED`、`UNCHANGED`：同一 provider object/version 的重复投递和分页重扫标记为 `UNCHANGED`，仅 provider version 变化标记为 `CHANGED`，新对象标记为 `NEW`。该分类只表达来源身份变化，尚未接入 DocumentVersion/family 受理或自动分析触发；当前验证仍是替身服务测试，不代表真实飞书后台监控已运行。

`DriveSourceScanService.scanCandidates` 现在可接收调用方保存的上一候选快照，并在同一响应中返回 `changes`；未提供快照时全部当前候选为 `NEW`。服务仍不持久化候选、不自动受理或派发分析，快照保存与 `DocumentVersion/family` 受理必须由后续授权事务消费者完成。
数据库增量核验：通过妙搭 `lark-cli` 用户身份通道在开发环境执行并提交 0040/0041；在线核验确认 checkpoint 表、候选快照列、唯一索引和 RLS 均存在，当前 checkpoint/候选快照均为 0 行。应用 bot 尚未获得 Drive 目录权限，因此尚无真实扫描写入。`.env.local` 直连仍返回 `28P01`，不作为线上连接凭据。
已新增 `wiselink-drive-source-config.ts`，将用户提供的六个根目录登记为独立来源定义，并统一声明应用/委托身份读取要求；扫描根状态由配置转换，不把用户会话写入来源身份。SB、AD 及后续目录继续通过同一注册表扩展，当前仍未取得应用身份读取授权或启动真实定时扫描。

**W5 跨事项复用和用户接续。** Wiki、动态记录和关系图读取同一工作与来源关系。B 可复用 A 的完整论点和根来源，但比较自身目标事实、条件和受众，不继承 A 的适用性或构型结论。Aily 只读取 Host 保存且当前授权可见的工作；普通对话不自动正式采用。

2026-09-12 阅读链路核对：`DocumentVersionReadingPage` 只读取指定 `documentVersionId` 的已发布 `parseRunId`，并将该精确 run 传给 `readParsedDocument`、图片资源读取和原文定位；Host 端图片接口再次执行文档读取授权、发布状态和已核验 IMAGE 描述符检查，未授权或非发布产物返回明确错误。`MineruMarkdownReader` 使用完整 Markdown、表格/列表/脚注与 `MineruReadingProjection` 绑定来源，无法唯一绑定时保留“部分内容尚无精确定位”，不伪造页码。事项快览和目录读取 `working.current` 及 `currentWorkingRevision`，并明确待覆盖输入、实际核查范围和“关联不代表已读取”。客户端类型检查已通过；尚未完成一次带真实用户会话的 Hosted 页面验收，Wiki 图谱与 Aily 的真实回流仍待运行证据。

## 验收顺序

第一批完成 W0/W1/W2 和最小原文阅读/检索消费者；第二批完成 W3/W4 两个真实后台来源及一次无需聊天的增量接续；第三批完成 W5 跨事项复用、Aily 新工作回读、矩阵和通知。每批按风险运行类型检查、定向单测、必要 PostgreSQL 事务/索引测试和真实页面到 Hosted 流程。

完成报告分别说明代码、安装、技术发布和业务运行，并回答删除的旧路径、复用的职责、真实用户结果、实际用于判断的输入、失败接续和未接通来源。历史失败保留；不自动确认 ReviewAction、正式采用、审批或实施。
