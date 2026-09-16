# 前端新设计与 Host 接缝对齐

日期：2026-09-15。承接现行 R10 计划及用户本轮提供的五份 Markdown、四个页面样例和完整设计 HTML；本页补充执行差异，不替换原设计，不新增生产业务授权。

## 当前结论

M 与妙搭 F 已分别核对实际代码，业务含义和推进次序一致；工程时间轴、换版比较和工程态势的完整读取合同及功能尚未交付。因此“理解已对齐”不能写成“前后端已完整实现”。

当前产品发布提交为 `573454e689ea3754f7f20a7fd646e84e22b1f425`，包含 F1 三批阅读、复核身份恢复入口、实际保存摘要及讨论主资料身份修复；官方 release `7685801309664693231` 已完成。真实阅读验收见 [M 集成记录](coordination/M_INTEGRATION.md)。附件所述旧分支、解析等待、旧工作号及历史类型错误不替代此接受点，也不要求重做已验收导航。

本轮静态浏览已确认：六区环形态势围绕工程认识；时间轴区分业务与信息时间；同一活动保留 Q3→Q4→TBD 来源历史；时间条目进入图谱后仍保留所选声明；换版页区分说明、正文比较和影响。这些是独立 HTML 设计证据，尚非生产 React 同组件或真实读取证据。样例中的相邻版比较也不证明跨版 R1→R3 覆盖完整。

## 已统一的产品含义

- 默认入口保留资料库；环形页面是独立的工程态势入口，中心展示已保存认识、范围和限制，六区不展示模型处理流水线。
- 问题工作、事项综合及其实际覆盖、生成或更正请求、正式采用分别呈现。STALE 不等于生成失败，有保存不等于疑点已解决。
- 当前有效文件由 Host 已核实记录决定；库内最新、取得时间、GENERATED 导出身份、解析修订和厂家正式版次不得互代。
- FTD 新信息可能改变事项理解，但不改写 SB 自身条款。旧评估 R1 至当前 R3 的比较，必须说明实际跨度和缺失中间范围。
- 时间保留发生或目标、来源发布、生效、系统取得等不同含义及原精度；季度、TBD、飞行小时和条件期限不补成日历日期。
- 同一活动保留稳定身份与各来源声明；新版未提不等于取消，预计已过而未取得结果不等于延期或违规，晚收到旧事件不等于新发生。
- Wiki、资料库、工程态势和图谱共享条目身份、准确来源、声明选择、查询范围和覆盖；图只有来源节点时，在详情保留原活动/声明并支持准确返回。
- parent、成员、引用和实际 USED 分开；没有保存依据的支持、因果、执行或效果关系不制造。
- 列表及态势读轻量保存投影，不逐份读取完整解析包、PDF或调用模型；无可靠全局聚合时明确当前授权范围，不下载全库凑数。

## 代码核对与最小读取接缝

| 阅读职责 | 当前实际能力 | 缺口与下一步 |
| --- | --- | --- |
| Matter quicklook | `useEngineeringMatter` 已读工作与综合；资料库快览主要消费 `substantiveResult` | F 先复用已有问题正文、更正及覆盖组件；修准确来源跳转。未来全局态势的轻量摘要/聚合归 M，不把完整 workspace GET 当全局聚合 |
| exact work + overview | 已有准确 workRef 读取、历史只读、问题正文、overviewStatus 及更正通知 | F 补齐消费者差异；M 核实综合覆盖的既有等价绑定。无法证实的覆盖或普通生成状态显示未知，不猜字段或时间关系 |
| document original + comparison | 独立 DV Reader、准确 parseRun/SourceRef、语义章节及原文比较能力已有 | Reader 不重建；换版页尚未接统一读取。M/P 核对两端身份、说明自身跨度、实际比较与未比范围、有效性及影响记录，不能把解析纠正比较直接称厂家换版 |
| engineering chronology | `CanonicalTimelineProjection` 的生产者拼装工作修订、绑定、解析/读取等技术状态，许多 occurredAt 为空 | 保留技术历史用途。`DocumentSemanticMap` 目前只有章节/角色/来源定位，milestones 角色不是已保存活动/预计声明。M/P 从真实源绑定产物补窄读取语义，F 不以日期正则或另一次模型抽取填充 |
| authorized relations | 当前关系页消费 LibraryIndex 的 parentId 层级及文档/WorkItem 视角 | 不能宣称完整工程图。M 提供实际关系与来源范围；F 实现共享选择及返回上下文，未加载与不存在分开 |

知识检索已有两个真实后端 GET：工程工作检索和原文检索，并已有精确工作读取。当前 `/knowledge` 只接解析单元查询，不是缺整个后端搜索。先修其版本选项将结构节点 ID 当 DV 的错误，再复用 `EngineeringIssueSearch` 的只读搜索/展开部分；不为阅读验收触发“引用并比较”写动作。

补充实际保存合同：`validateMatterProblemWork` 要求问题工作对应的 `substantiveResult` 存在，且其 lead 与 understanding 一致；因此 `substantiveResult` 存在不证明综合已形成，NOT_AVAILABLE 可以携带“问题正文已保存；综合认识尚未形成”的阅读投影。`overviewStatus` 由是否提交新综合及问题变动派生；工作 coverage 表达输入绑定及阅读贡献，不能冒充综合所基于的历史 workRef。现响应未核到等价精确综合工作引用，先保留该缺口，不由 F 猜测。

## 在原计划中继续

以下“前端 F1”指本轮阅读批次，与 R10 第 10 章工作可靠性的 F1—F6 编号分开。

| 批次 | owner / 文件边界 | 完成标准 |
| --- | --- | --- |
| F0 接受基线 | M 集成，F 维护已接受导航与 Provider | 沿用已通过导航证据；不恢复旧整页覆盖、WorkItem-only Reader 或另一套主题/HTTP 客户端 |
| F1a 当前窄修复 | F：LibraryMatterQuicklook、KnowledgeLookup 及必要既有组件和定向测试；不改 server/shared | 快览读已保存问题，综合/更正/覆盖不混淆；来源能进入准确 DV；版本列表不含结构节点伪 ID |
| F1b 阅读闭环 | F：现有 Reader、阅读位置和只读搜索消费者，逐文件移交 | 文档行与问题来源两条入口准确读取、返回原工作/位置；保留身份失效清理、迟到请求保护；工程工作与原文搜索均可阅读 |
| T1 最小工程语义及换版 | M 主写共享合同/读取，P 主写源语义/定位，F 主写视图 | 可核对的源绑定活动/声明、当前选择、时间精度、比较跨度与覆盖；没有真实结果时明确未完成 |
| V1 工程态势 | F 视图，M 轻量摘要/授权聚合 | 选中 Matter 先有准确工程内容；全局只显示真实可得范围与覆盖，不造数、不隐去关键缺口 |
| T2 图谱联动 | F 交互，M 真实关系读取 | 同文件多时间条目仍能准确往返；USED 有实际使用主体及来源版；计划、发布、执行、效果不互代 |

F1a 已由原妙搭前端任务完成本地提交 `c34c192`，M 审阅后择取为 `473fe56df`，保留本轮文档。F 四套二十项测试、完整 lint 与客户端构建通过；M 集成后两套九项测试通过。本批尚未发布或真实页面验收。M 按既有同名 codex/* 双远端规则处理同步，技术发布与真实业务运行分别记录；F1b 继续由 F 主写阅读消费者，M 不并写这些文件。

F1b 阅读返回小批已普通快进接受 `8d7f8790d`：准确工作返回、位置隔离及安全目录上下文已接入，M 两套十五项集成测试通过，F 有隔离浏览器组件往返证据。真实身份及线上验收尚未完成；多页目录未加载原行明确提示，整页刷新不持久恢复滚动。完整工程工作检索仍待接入，不能据此将全部 F1b 标为完成。

后继只读知识检索已普通快进接受 `31af53c33`，现有工作/原文读取接入 `/knowledge`，解析单元查询保留独立入口，M 两套十三项测试通过。F1 三个代码小批已集成；真实身份、准确正文和组合线上验收仍未完成。以上进度不覆盖 T1/V1/T2。

后续发布与实测已推进上述待验范围：真实账户的快览完整问题、准确 DV/parseRun/SourceRef 与历史工作返回、目录筛选/原选择往返、知识当前问题命中及全文/STALE 说明均已验证。缺页、撤权及迟到响应仍按已有隔离测试记录，不扩大为本次线上实测；综合更正及 T1/V1/T2 仍未完成。

T1/V1 可在各自文件内用同组件隔离样例推进，不等整个大 goal；真实字段缺口不能通过生产占位数据补齐。共同文件始终由指定单写者串行集成，不新建事件数据库、通用版本平台或审批平台。

## 验收与后继边界

每项分别记代码实现、同组件样例、真实读取、当前线上四层。独立 HTML 不算同组件测试，HTTP 200 或空壳不算有内容路径。未改动且已验收路径沿用记录；新增行为只补相关检查。

F1a 先覆盖“有问题无综合、旧综合未覆盖新工作、更正请求与保存事实分离、独立 DV 来源、伪版本 ID”实际风险。随后验证文档行→独立 Reader 与 Matter 问题→精确来源→原工作两条路径。T1 再验证 Q3→Q4→TBD、未提、跨版缺口、条件期限和参考跨文件边界。最终以同一版本的一条跨页流程验收，样例和真实结果分列。

本说明未新增模型请求、解析或业务保存，也没有将既有综合疑点或跨事项比较的失败宣布解决。它们继续按 M 集成记录的准确状态推进。


## 2026-09-16 换版两端读取增量（本地实现，待发布联调）

M 新增 `readDocumentRevisionReading` 客户端函数与共享 `DocumentRevisionReadingRequest/Response`，走现有文档路径 `GET /api/document-management/document-versions/:documentVersionId/revision-reading`。路径 ID 是 after，查询需提供 after 的 `parseRunId/semanticRevision`、before 的 `beforeDocumentVersionId/beforeParseRunId/beforeSemanticRevision` 和 `roleKey`。两端均须精确版本；Host 分别校验 ACL，并限制为同 family 不同 DV。不会建立新事项、选择有效版、重新解析或记录评估覆盖。

F 可在换版视图调用该函数：两侧 `publisherRevisionDescriptions` 保留各版本自身说明和原文定位；空数组仅表示未定位到支持的说明角色。`selectedSections` 包含该角色实际内容及父级条件，`sections` 可供选择，`unselectedUnitIds` 表示本次未比较范围。`systemComparison` 仅比较标题、段落及父级条件的空白归一化文本；表格、重复或缺失角色、结构/文字限制返回 `NOT_COMPARED` 与原因。`TEXT_EQUAL` 不表示工程影响不变；图示限制继续保留在 `coverage`。各来源链接使用各自 binding 和 SourceRef，不能共用 after 身份。

`publicationRelationship=NOT_VERIFIED` 明确没有证明最新、相邻或完整修订跨度；`assessmentCoverage=NOT_RECORDED_BY_THIS_READ` 明确尚未记录新版评估。正式身份/有效性仍由现有准确目录读取与本轮工作给出，不能由本接口的 DV/parseRun/semanticRevision 推导。本增量只交付读取合同、后端路由和客户端函数；生产视图接入、线上两端读取与完整换版业务验收仍待完成。


同一读取服务也由既有工程 MCP `read_document_original` 消费，after 使用原工具的 `documentVersionId/parseRunId/semanticRevision`，before 放入 `compareWith`，同时指定 `roleKey`；该模式不接受分页或 `sectionId`，不复制 HTTP 逻辑。MCP 分别取得两端实际来源授权，要求同一 tenant/actor，再执行统一读取。该入口仍为只读，不创建评估任务或覆盖记录。


本轮读取实现已随 e5cdf5b96b 的 Host 技术发布完成。两端已保存语义修订已由官方只读查询核对；登录恢复后的真实 HTTP/MCP 调用和前端生产视图仍待联调，不能用技术发布或本地比较结果代替业务验收。

2026-09-16 登录恢复后，M 已通过正式安装的 c109 `createHostMcpConnection` 执行真实 MCP 两端读取：`ftd.status` 返回 `TEXT_DIFFERENT`，`ftd.final_action` 返回 `TEXT_EQUAL`，`ftd.reference_categories` 返回 `NOT_COMPARED / NON_PLAIN_TEXT_CONTENT`。三次调用均校验两端精确 DV、parseRun 与 semanticRevision=1；各端各保留一组厂家修订说明，并分别返回未选择单元。连接及既有工具清单兼容检查通过。本轮只读，不触发模型、重解析或工作保存。

上述证据补齐真实 MCP 读取，仍不证明正式版本次序、完整换版跨度或评估覆盖；返回值继续为 `publicationRelationship=NOT_VERIFIED`、`assessmentCoverage=NOT_RECORDED_BY_THIS_READ`。HTTP 浏览器身份读取、生产视图接入与完整换版业务验收仍待完成。T1 隔离样例不得将本次文本比较结果映射为工程影响不变。

真实浏览器 HTTP 联调已定位一处入口错误：裸地址导航先被平台 CSRF 拒绝；按现有客户端规则携带同源 CSRF 头后，请求到达 Host，返回 `ENGINEERING_MATTER_RUNTIME_AUTHORIZATION_UNAVAILABLE`。原因是共用读取服务无条件进入仅供 Hosted SQL 身份使用的 `withActorScope`。本地修复将 HTTP 路由接入 `readForBrowser`，沿用已经过登录及对象入口 guard 的请求身份与 RLS；MCP 继续使用原 Hosted scope。两端原文授权、准确语义修订、同 family 检查及返回前来源回查仍共用。三套十七项定向测试及 server 类型检查通过；此修复待技术发布和相同浏览器请求复测，不将 MCP 成功视为 HTTP 已通过。
