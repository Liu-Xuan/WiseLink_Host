# 2026-09-08 事项评估与阅读工作区设计评审

本评审对应用户本轮“分析新的设计，按需调用子会话负责长期可并行支线”的请求。输入为 9 月 8 日综合报告、后续开发文件及 Matter Reading Workspace 静态包；Word/PDF 与 Markdown 为同一报告的不同格式。附件中的主控指令作为待评审方案，不单独构成实施、发布或修改云端数据的指令。此前同范围开发、origin 推送和技术发布授权继续有效。

核对源码为 canonical Host `db1c65125d446098a72b68fd735d8db8cf8f8c60`。报告使用的 `2bf3d482a7df1c7e02ef5b8e54a5d6cb8893afd3` 是其祖先；其主要语义问题仍存在，c32/c33 的后续运行修复应保留。本文完成设计评审与首批分工，未实现或发布新业务能力。

## 评审结论

新设计把当前交付收敛为有依据、可核对、可持续修正的工程认识，符合现有 Host/候选/正式采用的边界，建议作为下一批增量的产品依据。成功流程允许结束于“本轮评估完成，仍有待复看问题，尚未形成实施决定”。有待核因素不等于无有用认识，任务完成也不等于事项关闭。

最有价值的变化是三项：首屏先提供有实质内容的认识；列表、快览与展开内容读取同一保存结果；普通解释、关键纠正、新材料及正式采用各自具有清楚的保存效果。Silver/Carbon Satin、连续阅读面与句子直达依据的视觉方向可以继承，无需把十个静态页面逐页搬入产品。

首次交付应将 W1/W2/W3/W4 接成同一条流程。只修改 Overall 提示词、只放宽主文档引用要求，或只重做首屏，都不足以交付新设计。W5 的已证实预算不一致要纳入修复安排；W6 的外部检索按实际授权和可用性接入，不作为已有材料分析的前置。

## 当前代码支持与缺口

下列定位均来自上述 HEAD；行号用于定位该时点实现。

| 主题 | 已核实的现状 | 下一批应改变的行为 |
|---|---|---|
| Overall 真正的来源 | `openclaw-overall-synthesis.processor.ts:124–128,194,262` 的合法引用由主包与有效工程师评审补充构成；关联正文另放 `commonContext`，未进入同一合法集合。 | 注册本次实际授权并提供给模型的前提，允许关联文档独立支撑相应判断。目录中的 available ID 不等于已经阅读、可以引用的内容。 |
| Summary 语义 | 同文件 `:630–777` 强制 v1 字段、每句含主文档引用，实施影响/优先级/下一步均至少一项。`shared/api.interface.ts:1548` 与 Skill 方法、适配器、校验重复此要求。 | 新版本结果表达问题、范围、价值、限制与决定性待核因素；实施相关字段按业务需要允许为空，必要动作来自真实问题。历史 v1 保留原义。 |
| 叙述校验 | 同文件 `:925–950` 以关键词排除越权叙述，无法区分否定。 | 保留正式批准等结构化边界，配合方法与正反例校验，修正否定和来源立场被误判的问题；不得通过换一个柔和动词暗示默认实施。 |
| Matter | `engineering-matter.service.ts:47–175` 已有创建/关联/稳定读取；repository `:122–266` 按成员目录修订复制成员快照；`shared/api.interface.ts:2862–2888` 仅为跨 WorkItem 目录。 | 独立保存事项工作内容和事项结果引用，工作记录不产生新成员快照，不覆盖成员文档的结果。 |
| 连续工作记忆 | `canonical-host-common-context.service.ts:499–588` 仅取最近 12 轮，早期内容只计数；Review 候选已持久化，但无事项工作状态。 | Host 保存关键纠正、被否定假设、仍成立判断、待核问题和复看条件；短工作记录与近期原始对话一起进入后续输入。 |
| Review 执行范围 | `review-persistence/review-conversation.repository.ts:110–176` 以 tenant/actor/WorkItem 建会话；`canonical-host-openclaw-review.service.ts:167–244,333–395` 领取并保存该 WorkItem 的回合候选。 | 复用运行器，但任务、取证、会话续接与提交均显式绑定 Matter 业务范围，不能只在页面或结果末尾补一个 matterId。 |
| 首屏与一致性 | 快览已读保存结果；`contextual-navigation.ts:206` 映射丢失结果身份并截取/去重判断。`OverallAssessmentHero.tsx:84,232` 把范围与未知放入默认关闭区域，主 CTA 仍导向批准。 | 保留同一 resultRef/revision，关键否定、条件、冲突与已核实期限直接可见；正式采用与工程师处置使用独立入口。 |
| 依据与返回 | Hero `:29` 显示多个依据却只传第一条 SourceRef；当前 EvidencePanel 展示 Reader units，未携带被点击的判断。已有保活面板、滚动与焦点恢复。 | 按 resultRef/claimId 取得原句及全部前提，展示角色、限制和真实定位；关闭、跨成员往返后保留位置、焦点与未发送草稿。 |
| 首屏读取 | 目录/快览已是数据库读取；`WorkItemOverviewPage.tsx:125` 仍调用 document-parsing，服务 `canonical-host-vertical.service.ts:627` 会检查主包等。 | 补首屏轻量投影；展开依据/原文时按需读取，页面 GET 不调用模型。无需重建目录或缓存平台。 |
| 方法与取证 | Host JobAid 总预算 60,000 UTF-8 bytes、行预算 400；Skill 另硬拒绝传输结果 ≥28,000 bytes。Review 已有多批来源读取；Initial 模型接口只提供候选返回工具。 | 对齐真实传输预算并保留检查点覆盖；按明确问题复用既有取证能力，不预设每次必须多跑检索或生成新摘要。 |

服务文件位于 `server/modules/canonical-host/` 和 `server/modules/review-persistence/`，前端文件位于 `client/src/features/`；具体前端分工见后文。

当前 Overall 装配已经创建同一个 `UnifiedArtifactReadScope`，传给主包、dynamic candidate 与 commonContext 的读取（`canonical-host-openclaw-overall.service.ts:489–557`），不能把它重新列为“尚未接线”。Review 也已有 Host 会话键、多批来源读取及授权材料变化时重建会话的机制。新 Matter 调用链应接入这些能力。JobAid 的 60,000/28,000 字节不一致是另外的代码问题；当前 M3 的已观测失败是约 300 秒断连，不能将其追认为输出预算失败，c30 输入精简仍按原要求暂缓。

## 对方案的必要收敛

1. **把推理性质与来源载体分开。** 一句判断可以同时引用文档片段、受控事实、查询覆盖回执和工程师陈述。`SOURCE_FACT / CONDITIONAL_INFERENCE` 描述陈述性质；来源类型描述前提载体。两者不可合并成一个互斥枚举。查询没有命中仅证明所查范围内无结果；工程师陈述不等于受控完成记录；历史模型意见不算新的独立事实。首批实现真实样本用到的载体，未运行的查询不补造回执。
2. **区分三种版本。** 成员目录修订记录关联变化；工作修订记录问题、纠正、输入覆盖等变化；分析结果引用标识实质判断。无关材料真实阅读后可以更新覆盖、保留同一分析结果。普通解释只保存对话；纠正产生相关工作更新；正式采用另走现有入口。
3. **“最新”必须带范围。** 文档族、文档版本、针对某对象的 WorkItem 结果和 Matter 综合认识不得混用。某文档存在多次任务时，列表不能选第一条结果代表所有对象。事项工作 current 与正式采用 current 独立，继续保留 `matterCreatesAssessmentCurrent: false` 对成员评估的原有承诺，并明确另有 candidate working result。
4. **材料的加入、已读和被引用分别记录。** 新材料加入后旧认识继续可读，标明尚未覆盖；阅读不相关材料允许认识不变。加入目录不证明模型读过，引用原文中的文献名称不证明读过该文献正文。复看条件可以保存，只有实际已配置的监测才能显示为持续监测。
5. **局部更新由 Host 落实。** 模型给出受影响判断及候选变化；Host 根据稳定判断 ID 和已保存版本应用增量，未受影响部分原样保留。迟到候选不能覆盖较新纠正或新材料范围。不得由前端从最后一条 answer、关键词或静态状态脚本推导新认识。

## 首批交付与长期支线

| Owner | 本批职责与接线点 | 交付物 |
|---|---|---|
| [WiseLink R10 项目主控（2026-09-07 接管）](codex://threads/01a079d1-918d-7af1-a283-75968ec294ea) | W0/W1 与共享接线：`shared/api.interface.ts`、Overall processor/service、Review contract/service、Skill 方法/适配器/校验、API 与路由聚合。 | 一个带业务范围、输入版本、结果身份及合法前提的阶段结果；同轮接入候选保存和前端消费者。保留 c33 传输、翻译保真、现有 ActionAttempt 与正式采用保护。 |
| [R09 Engineering Matter 与跨事项目录](codex://threads/01a050bc-1d6c-7ce1-ba31-d4d0f781fdae) | W2/W4 的 Host 持久化：Matter repository/service、追加工作修订、短工作状态、输入覆盖、全成员授权、CAS/幂等及相关事务。 | 当前事项工作状态与历史，可读回变化/不变、未覆盖输入及精确结果引用；不复制成员、不推进成员 Overall。 |
| [WiseLink 前端与 v0.6 接续](codex://threads/01a06014-5282-7f90-91bf-12759224d211) | W3/W4 前端：WorkspaceHomePage、workitem/workbench/review、依据与 Reader 组件。共享 DTO 和 `app.tsx` 由主控集成。 | 资料库要点 → 同版简报 → 判断依据 → 原位返回/带引用讨论 → 局部更新。接入真正 Matter 身份，保留 DM family/document/version 和最近任务。 |

两条既有任务已实际接收并完成首轮只读差距评审，保留为长期 owner；没有新建重复任务。实现时先由主控给出最小 shared 输入/读回字段，两条支线据同一版本开发，前后端与 Skill 在同一批业务增量中集成。W5/W6 由主控按实际失败点与可用接口拆出有界工作，当前不额外建立空闲支线。

建议按以下顺序形成第一条可运行纵向路径，过程中前端和持久化可并行：

1. 选定一个已授权、可读的真实事项及第二份确实相关材料。现有 SB 787 的真实来源与 c33 运行记录保留；静态包的 X/Y/M、WT 系列资料只作界面和方法案例。未读第二份真实材料前不声称已形成跨资料综合。
2. W1 交付版本化结果与前提登记，W2 同时补工作状态保存/读取；一份结果包含可用于列表、简报和展开的阅读内容。简短文本在生成/保存时形成或从明确的结果项确定性派生，GET 不再次摘要。
3. W3 展示同一结果，点击具体判断展开全部实际前提与限制，按真实引用进入连续原文；关键条件不因折叠、截断或按第一条 SourceRef 去重而消失。
4. W4 接通普通页面 Review → 当前执行链 → 真实读取 → 候选校验/保存 → 工作更新回读。解释不改结果；纠正自动经候选完成链保存相关工作认识，无需再次确认正式 ReviewAction；采用入口保持独立。
5. 新材料先显示未覆盖，复核后保存其实际贡献。相关材料只改应改判断；无关材料记录已读及不变原因。最后保存待复看问题，允许仍无实施决定。

W2 的最小存储建议是一张独立追加工作修订表，保存基于哪个成员修订、工作版本、请求身份、范围、短工作状态与结果/材料引用。沿用现有主键、唯一约束、事务与 RLS，不为每条观察复制成员。精确重放返回原结果；同 requestId 不同命令报冲突；工作或输入版本已变时保留候选但不替换 current。字段名与具体端点由上述实际调用链收敛，本文不冻结一个尚未接入消费者的协议。

### W4 接入现有执行链

Matter 分支追加核对了页面提交、自动领取、来源读取、候选提交和 COMMITTING 恢复，确认可以复用当前消费者。最小方案保留主 WorkItem 作为调度与 ActionAttempt 的锚点，在 ReviewTurn 持久化 Host 解析的业务 scope，并将其随新版本 Review task 的 `modelInput` 保存。主 WorkItem 的 Overall 仅是成员输入，不能充任 Matter 当前结果；Matter 构建分支也不能沿用“主 WorkItem 必须已有 baseRules/Overall”的入口条件。

1. **保存输入时解析范围。** 页面随正常发送提交 matterId、当前工作版本与选中判断/材料等意图；Host 核实锚点及所有成员权限，绑定成员、来源、工作与结果版本。浏览器不提供 actor、合法引用集合或权威版本。历史无 scope 的回合继续按 WORK_ITEM 读取；同一会话中的历史展示、模型上下文和上一轮选择必须按 scope 隔离。
2. **取证保持原来源身份。** 当前 Review 以单一 sourceRefId 建 map（`canonical-host-openclaw-review.service.ts:906–947`）。跨成员时需要任务内无歧义的引用键，同时保留 workItemId、documentVersionId、原 SourceRef 和实际产物绑定；前端据原绑定导航。沿用 exact allowlist 与读取复用，不开放任意 URL 或把所有成员放入未经授权的包。
3. **完成候选时原子保存工作更新。** `prepareCommit` 先保存结果为 COMMITTING；随后同一数据库事务核对 Matter/工作/输入版本，保存 Review 候选，并在有实质变化或有效覆盖记录时追加工作修订。正常解释只有 answer；实质 delta 更新相关判断；只有读取回执与明确核查范围、资料贡献/不变理由相互吻合，才记录该范围已考虑。不能以模型自报或一次片段读取宣称整份材料已读。正式 ReviewAction 不在此事务执行。
4. **恢复先核对自己的已提交记录。** 工作修订按 actionAttemptId/reviewTurnId 唯一关联。业务事务已提交但响应/terminalization 丢失时，恢复先精确读回原提交，再结束 attempt；不能把自己造成的 N→N+1 当成他人冲突。若该 attempt 尚未写入而依据已变，保存的 ResultEnvelope 留作追溯，业务更新不应用。回执分别表达 workingRevision、substantiveResultRef、resultChanged、coverageChanged，保留 WorkItem/正式采用未改变的原有含义。
5. **保持自然讨论与可恢复续接。** 意图是输入提示，不要求用户每次先选一种聊天模式；前端不以关键词判断是否换意见。工作修订变化本身不等于权限变化，不必每次纠正都重建原生会话。续接时按同一 Matter/actor、已成功回合、当前授权材料和提交回执核对，再同步 Host 工作状态；范围或授权材料变化、失败会话等仍按既有规则重建上下文。

主要新增接线落在 `review-persistence/review-conversation.*`、`canonical-host-openclaw-review.contract.ts/service.ts`、Matter service/repository 及共享 DTO；generic TaskEnvelope、原队列和 WorkItem 轮询可以复用。Skill validator/driver 先兼容新合同，再由 Host 发出 Matter task，最后启用对应页面；历史 WorkItem c2/c3 结果继续可读。实际迁移、合同和消费者实现由主控与 W2 owner 同批核对，不在本次分析中单独发布。

实现新增迁移前有一个已复核的具体问题：`server/database/schema.ts:639–643` 的 Matter current revision 复合 FK 列映射与 `migrations/0014_engineering_matter_catalog.sql:104–112` 不一致，前者把 currentMatterRevisionId 对应至 matterId。应先核对实际数据库约束并修正声明，避免新表照抄；本轮没有连接数据库，不能据此宣称线上约束已损坏。

## 验证与当前运行边界

本轮以合成输入直接调用当前 TypeScript `consumeOpenClawOverallSynthesisOutput`，没有网络、模型调用或数据库写入。9 个探针结果为：正常基线接受；未登记关联来源报 `OVERALL_UNKNOWN_SOURCE_REF`；已登记但仅关联来源报 `OVERALL_CONCLUSION_CURRENT_DOCUMENT_SOURCE_REF_REQUIRED`；三个实施相关数组分别置空均报 `COUNT_INVALID`；中文“未批准执行”和英文“not approved”均被拒绝；真正声称“已批准执行”的对照也被拒绝。这证明现有机制的具体行为，不是新版语义测试已经通过。

实现后的普通定向回归集中验证：同一 resultRef 在各阅读层一致；解释保持结果、纠正只改相关判断且跨 12 轮仍保留；相关/无关新材料覆盖正确；多前提均可核对且文档/Matter 不串范围；迟到结果、幂等与权限变化处理正确；关闭依据和往返成员保留阅读/草稿，失权清除；首屏不调用模型或读取主包。通过后走一条真实页面流程，不用静态包自报的 81 项检查代替云端与业务验证。

运行实证仍按[执行计划的 05:40 记录](WISELINK_R10_EXECUTION_PLAN.md)分别记账：c33 已官方安装，M3 已成功提交 437/437 翻译候选，但后续 JobAid 失败；DLI 旧翻译未完成。两模型完整初始分析与连续 Review 尚未验收。唯一消费者暂停，正常页面验证停在上次 Mac 锁定处，恢复时需重新核对设备状态。本次设计分析不改变 scope、模型、调度、失败历史或云端数据，原运行目标继续保留，并采用“有用认识可无实施决定”的成功标准。外部 RAG 当前仍为 `NOT_CONNECTED`；旧存储事故继续独立跟进。
