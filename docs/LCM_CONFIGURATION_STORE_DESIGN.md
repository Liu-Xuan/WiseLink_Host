# LCM 构型快照与跨来源查询

状态：设计及本地实现边界，不是生产迁移回执。用户于 2026-10-08 明确要求持久化构型快照，并关联 TDMS、WiseLink 和机队数据，支持图谱、时间轴和智能体查询。独立本地迁移、导入repository、history/asOf/neighborhood结构化查询和隔离PostgreSQL验证/恢复脚本已落盘；实际验收结果以verification.json和恢复查询回执为准。

## 已核实的现有基础

本地基线 e428b704 的 server/database/schema.ts 已有 configuration_evidence_snapshot_version、configuration_evidence_fact_version、configuration_evidence_event_version、configuration_evidence_predicate_trace_version 与 configuration_evidence_work_item_head。它们绑定工程工作项。每日全机队来源快照需要独立的来源层，不自动创建工作项、安装事件或正式采用。

已只读核对 canonical-fleet-master-data.repository.ts：readCurrentForAircraft 按 tenant 读取当前 canonical_fleet_scope_head，并返回 sourceSnapshotId、sourceRevisionKey、authorityRevision、sourceAsOf，以及 assetVersionId 和事实 factVersionId 的来源引用。其 asOf 只筛选当前 head 中资产与事实的有效范围，不选择历史 head，也不重建当时已知的机队。历史关联须保留本次实际读取的这些版本；若需要过去机队快照，应另增受控的精确版本读取，不能把当前数据加上过去日期冒充历史。

现有 GetInstallationEventsPort 要求受控来源事件及 effectiveAt，LCM 矩阵状态不满足该事件契约。TDMS HistoricalAssessmentSnapshot 明确为 HISTORICAL_OPINION、usableAsCurrentFact=false。shared/library-graph.interface.ts 的现行语义为 CLASSIFICATION_AND_CONTAINMENT_ONLY，不能将其现有分类边直接解释为构型证据或执行关系。

## 关系数据库模型

使用 Host 现有 PostgreSQL 体系。先在本地隔离数据库运行迁移和验收，再交主控评审生产迁移；不手工修改生成的 server/database/schema.ts。

| 实体 | 保存内容与约束 |
| --- | --- |
| source_collection | tenant、来源实例、collectionId、查询范围、机型、状态筛选、开始/完成/观察时刻、成功/失败/部分/待确认、预期与已取得分片。tenant+来源实例+collectionId+分片唯一；重复请求参数不同时报冲突。 |
| source_artifact | 原始不可变文件引用、SHA256、字节数、格式；原件按租户及存储授权域去重，不因相同字节扩大可见范围。 |
| collection_artifact | 每次采集与原件关系、原始文件名、原始路径或来源定位、来源导出时间及其证据。相同字节的新采集仍有独立记录。 |
| configuration_snapshot | tenant、来源实例、固定查询范围、collection、原始文件、解析器及业务解释版本、前序快照、校验状态。历史追加；A→B→A仍保留三次观测。缺失机型或不完整批次不推进完整批次状态。 |
| configuration_observation | snapshot、sheet/row/cell、机型、机尾号、ATA、系统、类型、原始软件名称、原始软件件号、矩阵原值、允装/实装三值、原始EO及其他字段。保留原始字符串，不由名称推定身份。 |
| external_identity_binding | tenant、来源实例、外部实体种类和精确键、目标Host实体及版本、匹配依据、候选/已核实/冲突/已撤销、创建/确认/撤销证据。矛盾映射不得择首，历史不覆盖。 |
| evidence_relation | source observation、目标TDMS记录或Host文件版本/机队身份、关系类型、原始引用、确定性匹配或人工确认依据、授权范围。只陈述来源实际支持的关系，不凭共同飞机号推定因果。 |

快照及观测使用带tenant的外键和唯一约束；关联两端的授权均须满足。原件保留策略沿Host文件服务，不把所有二进制重复塞入业务行。原始EO文本即使未解析也必须保留；识别出多个EO时分别保留原始区间，不能随意拆掉版本后缀。

## 业务解释

用户确认：矩阵1表示该件号允装且实装；2表示允装但未实装；空白及未定义值保留未知。同时保存原值和语义解释版本。来源观测不等于已验证安装事件、放行或适航批准。

本批为用户确认的15份全机队导出。其中7个机型在固定五列后还有第六列“FIN号”；解析器须识别表头后确定机尾列起点。FIN原值与单元格引用保留，参与行上下文区分；不同FIN的同PN不合并为同一位置，也不由FIN文本制造Host受控位置身份。原始坐标数与内容去重后的记录数分别统计。

软件身份至少保留精确PN及其来源命名空间，名称仅显示/检索。机尾号只能作为精确匹配线索，核对机型和Host资产身份；来源没有MSN时不能补造。文件必须定位documentId+documentVersionId，不能以模糊EO名任选现行版。软件PN中的后缀不能未经依据拆成正式版次。

## 时间与变化

分别保存sourceExportedAt、observedAt、importedAt、effectiveAt和executedAt；保留原始时区/精度/未知。文件名时间最多作为文件名解析提示，不作为执行时间。

用户明确确认本批15份反映2026-10-08系统当日实装/允装状态：systemStateDate=2026-10-08、systemStateTimeZone=Asia/Shanghai、precision=day，依据为user-confirmed-system-state。日级状态可查询，不能继续标成全部状态日期未知；具体观察瞬间和执行时刻仍未知，不能补成上海零点或导出时间。当前instant asOf遇已授权范围内截至该日的day精度来源会明确报SOURCE_TIME_PRECISION_INSUFFICIENT，改用asOfDate；该保守限制不意味着来源日期完全未知。日级与瞬间记录混用时须保留精度和选取依据，不能把采集先后说成已知的业务发生顺序。

2→1是两次已知观测间的状态差异；实际安装发生时刻仍未知。缺行、空白、失败分片、不同筛选和机队列变化不推定卸载/撤销。比较限定同一来源实例、机型与明确查询范围；按来源时序显示，不能让迟到导入覆盖较新观测。

## 统一只读查询

先提供受权限控制的确定性查询服务和结构化结果，再接智能体工具。工具不执行任意SQL，不直接写入或确认关联。

- aircraftConfigurationAsOf：飞机身份、来源、观察截止时刻；返回各来源最近可用观测、原件及单元格引用、数据年龄和未知/冲突。
- configurationHistory：飞机/件号、时间窗、分页；返回观测时间轴与真实来源事件，明确区分二者。
- compareSnapshots：两个兼容范围的精确快照；返回1/2/未知变化、缺失及不可比原因。
- evidenceNeighborhood：从飞机、软件、EO/文件版本或TDMS记录出发的有界一至两跳图谱；节点与边携带来源/版本/可见性，不使用不可见资料扩大结果。
- collectionCoverage：每日预期机型/筛选与已取得、失败、缺失、待人工处理分片；不以已有文件数量宣称全机队完成。

图谱和时间轴是关系数据库的查询投影，不新建第二业务真源。业务采用继续走现有Host授权、事务/CAS和工作项构型证据路径。TDMS采集许可与LCM采集许可分别核对，不由已有登录推定批量权限。

## 本地接线与验收边界

先以独立来源层 repository 连接本地隔离 PostgreSQL，解析结果、采集记录和查询投影形成一个可测试的端到端流程。复用 test/pg/owned-postgres-cluster.mjs 的现有隔离引擎能力：临时数据目录、随机 loopback 端口与数据库、实例归属核验及清理；它的 TDMS 命名不赋予 LCM 任何 TDMS 来源权威。测试不得回退到生产连接变量或固定端口的已有数据库。实际 DDL 与本地测试保持同源；生成 schema、生产角色和 RLS 迁移经主控确认后接入。

本地 SQL、repository 或结构化查询测试通过，只证明对应本地数据路径。HTTP/API、智能体工具注册、真实 Host/TDMS/机队读取、生产迁移、图谱与时间轴 UI、每日全机型采集分别验收。未接前端时不得称图谱 UI 已完成；仅有查询函数时不得称 HTTP/API 或智能体已接通。模拟授权身份的测试也不代表生产租户及 actor 授权链已经验证。

当前0072迁移包含artifact、collection、snapshot、observation、evidence relation五表；采集与原件关系保存在snapshot，尚无独立external_identity_binding采用生命周期。compareSnapshots和collectionCoverage是目标接口，不因查询类存在而视为全部实现。外部关联目前只保存显式候选引用，未完成真实TDMS/Host/机队接入。dump恢复查询使用独立只读角色；数据库dump不包含原件字节，仍须保留staging原件及其校验和。

## 必须完成的验证

1. 本批15份LCM导出逐一核对manifest、原件SHA256、五/六固定列及FIN布局、1/2/空白和单元格定位；日级状态依据为用户确认的2026-10-08，坐标数与去重记录数分别读回。
2. 重复请求幂等、同字节不同采集、同ID不同参数冲突、A→B→A、迟到快照、同范围机尾减少。
3. Host同主键矛盾、多个精确候选、文件版次冲突及跨租户不可见。
4. 数据库迁移在隔离库执行，唯一约束、事务失败不产生半批次，重跑无重复。
5. 图谱、时间轴、智能体查询对同一数据集返回一致来源、日期与未知状态。
6. TDMS、Host、机队真实导出/接口取得前，模拟测试与真实系统验收分别报告。

每日所有机型的获取需求已明确，但状态筛选待确认。Chrome不安全下载提示不由自动化绕过；当前来源尚未具备经验证的无人值守下载路径，数据库完成不等于每日采集已启用。
