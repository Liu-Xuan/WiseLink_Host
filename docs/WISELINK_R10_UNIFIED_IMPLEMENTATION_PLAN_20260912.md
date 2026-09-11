# WiseLink R10 统一架构实施计划（2026-09-12 修订）

本文件将 2026-09-11 统一架构确定稿转换为当前可执行计划。附件中的示例 API、SQL、ID 和测试情节是设计参考；代码、数据库、平台发布和真实业务运行必须分别以当前状态为准。

## 当前架构决定

WiseLink 使用妙搭 NestJS Host、PostgreSQL/Drizzle、FileService、React/Reader/Cytoscape、官方 Hosted OpenClaw 和 Aily。Host 是身份、授权、SourceRef、DocumentVersion、事项工作、事务/CAS、候选保存和正式采用的业务控制面；OpenClaw 负责工程分析候选，Aily 负责自由对话。

解析计算采用独立 MinerU Worker。Worker 只处理 Host 明确授权的原件和解析请求，返回可核验状态、产物描述符和诊断；Host 负责来源授权、parseRun、FileService 读回校验、发布 CAS、失败恢复和阅读投影。Host 不再启动本地 MinerU Python 重解析。Worker 就绪、解析成功、标题增强、产物发布和业务阅读分别记录。

翻译是阅读能力。输入从已发布的原文解析产物生成语义单元；工程分析、归集、修订比较和适用性只读取原文/原始记录及来源回执。按实际 Hosted 模型输入与输出预算合批，计入结构化 JSON 和余量，尽量合并完整段落与表格；字符数不能直接当 token，不能固定 6000 字或强制按章节切分。

当前不部署 QMD、LightRAG、Graphiti、KaaS、Basic Memory、额外向量/图平台、本地检索模型、SQLite 知识镜像、第二业务状态机、通用事件总线或自建全局执行器。检索复用现有授权边界和 PostgreSQL 可重建投影。

## W0—W5 交付顺序

**W0 协议和运行边界。** 核对真实 controller、ActionAttempt、模型输入/保存、Reader、前端和 Worker 传输适配器；停用 Host 本地 MinerU 自动恢复/本地派生进程，保留远端任务状态和 parseRun。清理仅限明确属于 WiseLink 的测试数据，先停止派发和在途任务；不删除共享目录原件、其他应用、平台共享表或凭据。

2026-09-12 实施进度：Host `DocumentParsingHostedService` 已移除本地 MinerU runtime/runner 派发，改经 `MineruRemoteWorkerClient` 发送已授权原件；未配置远端凭据会返回明确的 `MINERU_REMOTE_WORKER_NOT_CONFIGURED`。仅收到 Worker 排队回执时不会进入 stage/publish，而会记录 `MINERU_REMOTE_WORKER_ARTIFACT_TRANSFER_PENDING`，等待后续带有可核验产物描述符的传输协议。该改动已通过服务端、客户端类型检查及既有 18 项定向测试；Worker 真实产物回传、Host FileService 读回和 parseRun 发布仍未验收。

**W1 完整工作依据。** 共用 collectEvidenceUses 按类型收集主张、风险、措施、分类、方法/要求、依赖和前提引用，保留位置与作用。阅读不等于分析；已读但未用于工作的材料记录 READ_ONLY 或部分核查。保存事务同时写完整工作、依据使用、输入处置、影响范围和 CAS；请求结果不确定时按原 request 回读。

**W2 统一上下文和 Reader。** WORK_ITEM 与 ENGINEERING_MATTER 共用来源、target/asOf、适用性、方法版本、变化和精确旧工作装配，Overall 读取指定修订。Reader 保留段落、警告、列表、表格、脚注、跨页条件、图像状态和原生记录 selector；未读、未找到、无权限、未接通和部分结果分开呈现。

**W3 授权检索投影。** 复用 EngineeringIssueSearchService 精确读取和 ACL，建立可重建的语义段、原生记录和完整问题投影及 GIN 索引，保留 tenant、owner、精确 revision、locator、上下文、原文和索引版本。中文使用 Intl.Segmenter 词级分词和 PostgreSQL simple 配置；文号、件号、软件版本走精确匹配。查询参数化，结果带精确引用、命中理由、根来源、hasMore 和限制；全文命中不等于权限或适用性。

2026-09-12 实施进度：现有问题候选查询已改为参数化 PostgreSQL `to_tsvector('simple')`/`plainto_tsquery`，并保留规范化文号、件号、软件版本的精确匹配；命中后仍逐项调用现有完整工作读取和 actor/tenant ACL。独立持久化 projection 表、GIN 迁移、来源语义段和原生记录消费者尚未完成，当前不宣称全量检索。

**W4 共享目录和变化。** 首批接技术资料目录 Q6uSfDwcDlBrUldWvZccoje8nXf 与每日运行目录 Oy1vfy8nslGZeUdBBkoczv0Fnxh，其余目录、SB、AD、会议和问题表复用同一配置机制。后台使用真实获准应用/委托身份。扫描采用递归分页、可恢复 frontier/游标和周期对账，事件只作加速；文件、期次、报道和原生记录分别建模，同名、token 或字节相同不能替代业务身份。

**W5 跨事项复用和用户接续。** Wiki、动态记录和关系图读取同一工作与来源关系。B 可复用 A 的完整论点和根来源，但比较自身目标事实、条件和受众，不继承 A 的适用性或构型结论。Aily 只读取 Host 保存且当前授权可见的工作；普通对话不自动正式采用。

## 验收顺序

第一批完成 W0/W1/W2 和最小原文阅读/检索消费者；第二批完成 W3/W4 两个真实后台来源及一次无需聊天的增量接续；第三批完成 W5 跨事项复用、Aily 新工作回读、矩阵和通知。每批按风险运行类型检查、定向单测、必要 PostgreSQL 事务/索引测试和真实页面到 Hosted 流程。

完成报告分别说明代码、安装、技术发布和业务运行，并回答删除的旧路径、复用的职责、真实用户结果、实际用于判断的输入、失败接续和未接通来源。历史失败保留；不自动确认 ReviewAction、正式采用、审批或实施。
