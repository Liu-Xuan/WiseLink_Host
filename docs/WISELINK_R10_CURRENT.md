# WiseLink R10 当前正文

同步日期：2026-09-05（Asia/Shanghai）。

来源：[R10 云文档](https://hv5zjf4j8yb.feishu.cn/docx/MA3fdjEycoISjHxptAqcsyxvn9b)，revision 2140。

本文件是现行第 1–11 节、第 12 节当前摘要及第 13–14 节的读取镜像，便于代码开发引用；历史运行记录和附录保留在云文档。图示保留原云资源链接，少量 callout 保留导出的 DocxXML。当前执行进度见 [执行计划](WISELINK_R10_EXECUTION_PLAN.md)。原 GPT Pro 交接包不回写、不改写。

# 1. 30 秒结论

**WiseLink 是围绕工程问题的上下文评估与工程师协作系统。**工程文件按问题现象、机理、调查进展、措施、实施前提和发布里程碑组织；精选关联材料和知识空间片段共同构成上下文评估包，供智能体按照 Job-Aid 等方法开展分项及综合判断。

1. **先跑通真实流程，在运行中迭代。**不以新增 gate、hash、冻结契约和重复断言代替项目进展；保留已有认证、权限、数据安全、并发更新与正式业务确认。
2. **上下文是分析输入，不是长期停留的预览。**关联片段与 RAG 背景进入当前开发主线；复杂图谱与全量知识建设后置。BACKGROUND_ONLY 允许参与理解、分析和候选解释，不自动成为本机事实。
3. **妙搭 Host 管理内部业务状态与上下文记录。**保持 DocumentVersion、SourceRef、评估结果、ActionAttempt、候选和确认边界；外部系统仍拥有其原始业务事实。
4. **OpenClaw 负责调查和持续协作。**沿用一个 Hosted Agent，通过 Skill、MCP 和知识空间按问题获取更多信息；工程师可提问、引导和补充材料，并看到检索活动、证据、理由摘要及结论变化。
5. **当前实证与目标分开。**初始分析、多轮候选、材料来源跳转、页面保存并自动领取已有样本实证；关联/RAG 背景进入初始分析、稳定原生长会话与取证活动仍待接通，完整连续运行以第 12 节当前记录为准，不能由历史 Turn 成功代替。
6. **信息不完整仍可分析。**明确未知对哪些判断有影响，继续能够完成的工作；Gap Ledger 不要求清零。正式采用与批准继续走原有业务入口。
7. **继承语义与可用实现，不恢复旧单体。**旧 WiseLink 的规则、语义和真实样例按价值迁移；旧 R09 的时间、当前状态和下一步仅作历史参考。当前实施顺序以第 11 节为准。

# 2. 当前开发范围与非目标

## 2.1 当前要跑通的用户流程

一份真实工程文件 → 按业务语义组织信息 → 精选关联片段与真实知识检索背景 → 上下文评估包 → Job-Aid 与综合候选 → 工程师持续提问、引导、补材料 → 更新工作判断与说明。

初始分析、Reader、显式关联预览和 Review 候选是已有起点。首先打通背景进入真实分析、页面触发 Hosted、持续会话与可见进展；构型证据接入和采纳后重算并行推进，不因全部外部数据未齐停止已有能力试用。

## 2.2 实现模式与材料用途分开

现有 EXPLICIT_PREVIEW 已实现并有运行记录；OFF 是历史起点，不再描述当前生产。旧 Snapshot 的 includedInAssessmentInput=false 仍准确描述当前实现，不能只改标签便宣称已接通。

下一增量将精选背景实际加入 Job-Aid、Overall 和 Review 使用的上下文并记录来源，不等待完整图谱或独立 EVALUATION_BOUND 项目。BACKGROUND_ONLY / REFERENCE_ONLY 可用于机理理解、假设、比较和候选判断；不自动证明本机适用性、措施已执行或正式批准。

会改变受控适用性事实、构型或正式采用状态的材料仍由现有 Host 入口处理。缺少关键事实时说明具体影响，保留 UNKNOWN；缺少可选背景不阻断其余分析。读取失败、未接通和未加载必须可见，不能伪装成功。

REVIEW_ON_DEMAND、知识空间检索与最小问题脉络属于当前主线；LIMITED_GRAPH 等是按真实需求扩展的能力，不再使用只能逐级解锁的整体模式作为开发阻断。

## 2.3 非目标与保留边界

- 不建设第二业务数据库、第二业务状态机或直接同步模型 Provider 主入口；Session memory 不代替 Host 当前记录。
- 不将 150 条 Criterion 复制成 150 份 Skill，也不要求把每份引用文件全文装进模型。
- 不先建设全量知识镜像、图谱、额外向量数据库或完整 Skill 发布平台。
- 不让前端根据标题、文件类型或空结果自行推断适用性、权限或已采纳状态。
- 不把 WiseLink 候选等同于正式批准、正式业务发布和执行；保留已有认证、权限、数据安全和不可逆操作边界。
- 默认不新增 hash、冻结契约、baseline 或 gate；只有具体失败场景证明现有 Git、版本、主键、事务、唯一约束、类型和普通测试不足时再讨论。

# 3. 版本术语与继承规则

## 3.1 版本命名

| 术语 | 含义 |
|-|-|
| R10 | 本云文档中的当前开发契约版本。 |
| WiseLink v0.9 | 产品/架构阶段标签，不等于 Skill build。 |
| r09.c10 / r09.c20 | r09.c10 是普通 R09 Task 的最低兼容 build；当前源码和官方 Hosted 最近安装记录为 r09.c20。Turn 13 实际执行 c16、Turn 14 实际执行 c17，历史结果保留实际版本，不重标为新 build。 |
| Host commit / release | 妙搭 Host 的具体 Git 提交与线上发布身份。 |
| DocumentVersion / revision | 业务文档和 WorkItem 的独立版本，不与以上版本混用。 |

## 3.2 R09 / v0.8 继承矩阵

| 继承项 | R10 修订后的边界 |
|-|-|
| Host、SourceRef、版本与 CAS | 继续管理业务真值和正式采用；普通材料、讨论、工作判断和候选可正常持久化，不因此变成正式业务事实。外部系统拥有原始事实。 |
| 一个 Agent、两类 Session | 保留 INITIAL_ANALYSIS 与 INTERACTIVE_REVIEW；持久 ReviewConversation 与 OpenClaw 运行会话分开标识并按授权范围稳定映射。 |
| 四个初始 ActionAttempt | Translation、Applicability、JobAid、Overall 保留现有生命周期，共享同一事项的评估前上下文和已有真实结果，不重复建设。 |
| Chat-first Review | 聊天、材料和候选更新无需先正式采纳；ReviewAction 确认只负责明确的正式采用与相应 current 变更。 |
| 有限信息与判断成熟度 | Gap 不要求清零。区分方法覆盖、决定性未知及正式采用就绪；CONFIRMABLE 不等于信息完整或自动批准。 |
| C3 五工具 | begin、status、commit 由确定性适配器控制；get_review_turn_context、read_source_refs 属于授权读取，Agent 可按问题选择读取意图；模型不持有 lease。 |
| 一个物理 Skill | 内部 references 模块化，方法/提示独立演进；兼容变更可与 Host 分别发布，不把 150 个 Criterion 拆成 150 个 Skill。 |
| 可见分析过程 | 保存真实调查活动、证据、假设、理由摘要和判断变化，不保存或展示模型私有原始思维链。 |
| 旧状态、日期、当前动作 | HISTORICAL_ONLY；不覆盖第 11 节实施顺序及第 12 节当前摘要。 |
| Base / Aily / 全量图谱 | 保留既有资产，后置；不成为当前连续评估闭环的前置。 |

# 4. Host、OpenClaw 与外部系统边界

| 组件 | 拥有 | 不得拥有 |
|-|-|-|
| 妙搭 Host | 身份、ACL、文档与来源版本、评估前共同上下文、材料/讨论/工作判断、真实评估结果、候选与正式采用记录、ActionAttempt 和运行状态。普通上下文版本与正式采用的 WorkItem revision 分开。 | 不得把未校验模型输出伪装成业务事实 |
| Hosted OpenClaw | 基于共同上下文的持续调查、按需授权读取、自然语言交互、候选判断、理由摘要、WorkingAssessment 与 ReviewActionDraft；通过 Host 保存工作产物。 | 正式适用性裁决、业务主键、current 修改、工程师确认、正式动作 |
| 飞书 Docs / Drive / Wiki 与其他知识源 | 被授权读取的材料及其源版本 | 对当前目标文档的最终判断 |
| 外部 owner system | 正式审批、正式发布、正式执行及其记录 | 不由 WiseLink 自动替代 |
| 前端 | 展示、筛选、追溯、触发受控动作 | 文档关系、适用性或权限推断 |

![图 A｜R10 总体架构与权威边界](https://feishu.cn/file/Q1CZbgMtaoVlBSxdJk8c8SnKngh)

图 A 表达逻辑数据流，不限定网络调用方向：可由 Host 使用已核实的应用级入口派发，也可由 Hosted 云端消费者通过现有 Host MCP 领取已保存任务。消费者必须运行于明确的云端载体，不能依赖开发者电脑或应用开发 CLI。Host 先管理授权材料与共同上下文；普通工作记录可保存，正式采用及向外部 owner system 移交仍走现有确认入口。

# 5. 有限信息、剩余不确定性与判断成熟度

## 5.1 Gap Ledger 的含义

Gap Ledger 是“剩余不确定性与证据需求台账”，不是必须清零的缺陷清单。一个 missingInput 只是某条 Criterion 的局部未知，不自动生成必须完成的任务。证据循环只处理同时满足以下条件的 Gap：

- 当前解决它可能改变判断或控制措施；
- 存在当前授权、可执行的获取路径；
- 解决成本与工程风险相称；
- 不是只能由外部 owner 或未来生命周期事件回答的问题。

## 5.2 不确定性处置

当前 canonical 处置类型包括 RESOLVE_NOW、ACCEPT_WITH_ASSUMPTION、APPLY_CONSERVATIVE_BOUND、MITIGATE_AND_MONITOR、DEFER_TO_REVIEW_DATE、PROFESSIONAL_JUDGMENT、OUT_OF_CURRENT_SCOPE、LIFECYCLE_NOT_REACHED、RESOLVED_BY_EVIDENCE、NOT_APPLICABLE。每个处置绑定 Host gapRef，并包含理由、假设、控制、证据、reviewBy 与 reopenTriggers。

## 5.3 判断成熟度

| 状态 | 含义 |
|-|-|
| PRELIMINARY | 已有初步方向，但决定性事实或关键不确定性处置不足。 |
| REVIEWABLE | 可供工程师复核，主要事实、来源与缺口已经结构化。 |
| CONFIRMABLE | 当前 canonical 枚举。它允许剩余未知，但所有 P0/P1 未知必须已有证据、假设、保守边界、控制、专业判断或监控处置；不表示信息完整。 |
| DEFERRED_WITH_MONITORING | 当前不能确认，但已有监控、reviewBy 和 reopenTriggers。 |

沿用 CONFIRMABLE，不新增同义状态。判断成熟度需说明评估方法覆盖、决定性事实、剩余未知和处置；150 条结果齐全不等于正式规则源已绑定，124 条 UNKNOWN 也不等于 124 个独立问题。共享缺口可合并说明，但不能据此忽略影响安全判断的决定性未知。

## 5.4 Decision Snapshot

Decision Snapshot 是结果侧的判断快照，承接共同上下文与实际分项结果；工作阶段可保存候选，不必先进入工程师确认包。按实际存在的信息记录 assessmentAsOf、当前判断、替代方案、决定性事实、假设、剩余不确定性与处置、必要控制、复核条件、whatWouldChangeDecision 和 candidateOnly=true；不要求每次普通对话填齐所有字段。

问题、材料、讨论摘要、工作判断与候选均可持久化并保留版本，既不覆盖旧记录，也不自动改变正式采用的 current/STALE。仅显式采用动作进入原有 expectedRevision 与并发更新逻辑。保存用户可核对的活动和理由摘要，不保存模型私有原始思维链。

# 6. OpenClaw 原生 Review 执行模型

## 6.1 一个 Agent、两类 Session

首版只有一个 Hosted Agent Profile：wiselink-engineering，以及一个物理 Skill：wiselink-research-and-synthesize。它支持两种明确模式：

- **INITIAL_ANALYSIS：**Translation、Applicability、Job-Aid、Overall 四个独立 ActionAttempt；每项有独立 begin/commit、Result Gate、版本与 CAS，不把整条链塞进一个 Session 或一个 attempt。
- **INTERACTIVE_REVIEW：**长期 ReviewConversation / OpenClaw Review Session；工程师以自然语言多轮讨论，WorkingAssessment 和 ReviewActionDraft 可反复变化、追加和 supersede。

![图 D｜初始分析、长期 Review 与关联上下文模式](https://feishu.cn/file/XeVmbQegaomm49xaqIAcsX1Xnog)

## 6.2 普通工作记录与正式采用分离

工程师提问、补材料、纠正方向，Agent 读取、记录讨论摘要、更新 WorkingAssessment 或保存候选，都属于普通工作流程，可正常持久化。它们不以确认 ReviewAction 为前提，也不自动修改正式采用的业务事实。

正式采用时，工程师在妙搭确认具体 ReviewActionDraft；Host 按现有身份、权限、当前证据与 expectedRevision 核对，执行既有 CAS/采用与重算。正式审批、业务发布和执行仍由外部 owner system 完成。

普通讨论遇到业务 revision 变化，应刷新当前上下文并说明变化；保留当前已保存材料和讨论，不因与正式采用无关的漂移永久禁用发送。影响授权或正式提交的冲突仍执行现有保护并明确原因。

## 6.3 当前 C3 五个 Host MCP 工具

```text
begin_review_turn
get_review_turn_context
read_source_refs
get_action_attempt_status
commit_review_turn_candidate
```

五工具分两类：begin_review_turn、get_action_attempt_status、commit_review_turn_candidate 由确定性运行适配器负责；get_review_turn_context 与 read_source_refs 是授权读取能力，调查时可由 Agent 按问题选择并经适配器执行。模型不持有 lease、不代替工程师确认。允许按真实需要增补高层只读检索；新来源在 Host 授权读取后登记，再允许候选引用，不把首轮静态来源清单当成永久上限。driver 不固定“预读全部一次→生成一次”的调查顺序。

## 6.4 持续会话、自动执行与可见调查

同一 ReviewConversation 在相同授权范围内映射稳定 OpenClaw 会话；Turn/requestId 标识一次请求而非重新开始讨论。每轮同步当前问题、选中评估点、当前 Host 事实、共同上下文、新增材料和必要历史摘要。授权收缩或参与范围改变时，只重新检查工具权限不足以消除旧会话记忆，应以仍获授权的材料重建运行上下文。

页面发送后先持久化 Turn 与可恢复执行意图，云端消费者通过已核实入口启动 Agent，回写状态及候选，页面短轮询展示。可选择 Host 派发或 Hosted 主动领取；复用 Turn/ActionAttempt 的主键、幂等与恢复机制，解决“Turn 已保存、进程在派发前退出”的具体缺口，不新建通用调度平台。

driver 收窄为运行适配器：任务领取、会话映射、上下文交接、真实运行状态/活动、结果序列化及现有候选提交。Agent 可多次读取资料，最终结构化输出在调查收尾生成。新增授权来源经 Host 登记，不向模型暴露控制面 lease 或凭据。

前端展示当前问题、已读取的具体材料、决定性依据、理由摘要、未知及结论变化；诊断细节放入折叠区，不伪造进度百分比。支持继续提问、补材料与下一轮承接；运行中 steering 未接通时显示“下一轮指示”，不能把已排队说成已干预当前运行。

2026-09-05 当前实证：页面 append 已保存自动执行意图，官方 Hosted 原生 command cron 每 60 秒消费一次，Turn 15/16/17 已自动领取；三个自动回合均未产出候选，17 因旧原文文件不可读在上下文准备阶段失败。共同背景与历史讨论的任务输入增量 90b05aa8f 已随 Host d5ffbf4c9 发布，c20 已官方原位安装，尚待真实新分析验证。原文失败下的独立历史讨论及执行状态已在发布后页面读回。现行 driver 仍按 requestId 派生调用标识、程序预选来源后强制生成一次候选；稳定跨轮会话、按问题继续取证和真实活动展示尚待接通。此判断依据实际编排，不由 Chat Completions 或 stream=false 两个参数推断 OpenClaw 本身的能力。

上游依据：[OpenClaw HTTP API](https://docs.openclaw.ai/gateway/openai-http-api) 支持稳定 user 的会话映射；[Agent loop](https://docs.openclaw.ai/concepts/agent-loop) 描述运行与活动输出。上游能力不等于当前 Hosted 版本和平台入口已开放，具体部署必须现场验证。

## 6.5 Skill 组织、适度解耦与 Publish Lite

保持一个物理 Skill，内部 references 按核心边界、交互复核、关联上下文、RAG、适用性感知召回、Issue Thread、Job-Aid、风险评估和厂商文档体系模块化。Skill 不保存 WorkItem current、ACL、文档目录、构型事实、正式 Criterion、CAS 或正式批准。

| 变化 | 发布单元 | 约束 |
|-|-|-|
| 提示词、references、关键词、示例、fixture、纯编排或模型输出格式约束 | Skill-only | 不得改变 wire、authority、ACL、current 或 ReviewAction 语义；ResultEnvelope 回传实际 Skill 版本。 |
| Host 内部生命周期、租约恢复或错误投影，且 wire shape 不变 | Host-only | 保持向后兼容；上线后用独立 UAT 验证。 |
| Task／Result／tool shape、RelatedContext Artifact、ACL 或权威边界变化 | Host + Skill 协同 | 需要兼容窗口和联合验收。 |
| 前端候选态呈现、SourceRef 导航、运行指纹 | Host App 前端发布 | 只消费 Host 真值，不自行推断采纳、current 或失败终态。 |
| 新增外部检索源或 Connector | Host tool／配置发布 | 保持最小权限、来源标识与外部发现非证据边界。 |

沿用现有 Publish Lite 打包、传输完整性校验与原位安装，不新增签名平台、冻结步骤或重复 gate。兼容变更可以 Skill-only / Host-only 发布；新增协同字段先由 Host 兼容接收，再由 Skill 消费，随后启用页面。前端与后端属于同一 Host App 发布单元，不宣称完全独立部署。旧版本忽略了新字段时不能声称已使用其内容；安装和普通测试不能替代页面真实往返。

<callout id="doxcnLV1KfdQkLHT1tV6tmxbt7d" emoji="🔀">
**兼容与独立发布决策（2026-09-04）：**Host 声明兼容线 **wiselink-research-and-synthesize@r09**；普通 R09 任务最低接受 r09.c10，P0B 与 INTERACTIVE_REVIEW 必须回传实际执行包版本。纯 Skill 修订可独立发布，Host 内部修复可独立发布；只有 wire／authority／安全语义变化才协同发布。技术发布按用户持续授权直接执行并回报证据；不可逆删除、权限扩大、正式业务采纳，以及 ReviewAction 的确认／批准／发布仍保留独立边界。
</callout>

# 7. 工程问题语义与关联上下文组织

## 7.0 问题脉络与片段贡献

先围绕工程问题组织信息：现象与影响范围、机理分析、调查进展、临时措施、最终措施、实施前提、运营影响、文档发布与改版里程碑。文件类型只是材料身份，具体片段在该问题中的贡献才决定如何使用。

以用户描述的 Boeing 问题演进为业务示例：航司问答邮件可能提供早期信号，FTD 跟踪问题确认、分析和措施进展，后续说明性文件介绍问题及方案、改装文件给出措施，维护提示和手册改版体现运行与出版影响。按实际文档识别类型、关系与时间，不把这一示例固化为所有事项必须走完的线性发布顺序。

同一文件可以贡献多种信息；问题可以分支、回溯或与其他问题交叉。首版用已有文档身份、SourceRef、关系候选和时间线表达即可，不先建设全量图谱。

选择的是能回答当前问题的具体片段，而非整个文件列表。纯施工操作型 AMM 工卡通常不自动进入机理背景；涉及施工条件、工具、接近、停场或维修要求的评估点，再按需展开相关内容。保留引用索引，不要求所有引用都导入或进入模型。

关联资料和 RAG 片段共同作为理解背景。每条说明来源、帮助理解什么、与哪个问题或评估点相关，以及版本/可用性限制；工程师补充的线索同样可进入工作上下文。业务背景的使用不以先正式采纳为前提。

![图 C｜关联文档语义模型：各轴不可互相推导](https://feishu.cn/file/IIbVbR5G0o9F40xsSGOcqTDynkc)

## 7.1 DocumentType

只表达材料的实体类型，不混入贡献作用。候选范围：

EMAIL、MOM、OIC、OIT、FTD、TFU、FTAR、FIX、SL、SIL、SB、VSB、AOT、AD、AMM、IPC、WDM、CMM、AFM、MEL、MT、OT、MRO、AEO、PEO、CEO、CAMP、RELIABILITY_REPORT、COMPLETION_RECORD、OTHER。

## 7.2 ContributionRoles[]

表达该资料在当前工程问题中的贡献作用，可多选：

ISSUE_SIGNAL、INVESTIGATION_UPDATE、TECHNICAL_BACKGROUND、TEMPORARY_MEASURE、FINAL_MEASURE、IMPLEMENTATION_INSTRUCTION、PUBLICATION_IMPACT、OPERATOR_ACTION、COMPLETION_FEEDBACK、GENERAL_BACKGROUND。

## 7.3 RelationTypes[]

表达文档之间的结构关系，可多选：

REFERS_TO、REVISES、SUPERSEDES、REQUIRES_BEFORE、REQUIRES_CONCURRENT、ALTERNATIVE_TO、TERMINATES、IMPLEMENTED_BY、AFFECTS_PUBLICATION。

## 7.4 EvidenceStance

EvidenceStance 表达某段材料对明确主张的 SUPPORTS / CONTRADICTS / NEUTRAL，可绑定普通稳定的 claim/assertion 标识，不要求另建断言平台。没有明确主张时可留空；不能将 SUPPORTS/CONTRADICTS 混作文档结构关系。材料贡献、关系与立场分别记录。

## 7.5 TargetApplicability

关联文档自身对当前目标的适用性独立记录为 APPLICABLE、NOT_APPLICABLE、UNKNOWN、NOT_EVALUATED 或 NOT_APPLICABILITY_BEARING。主文档适用性不得复制给关联资料。

已存在独立 Host 适用性结果时绑定该结果及其目标、版本与时间；需要评估但尚未评估用 NOT_EVALUATED，事实不足用 UNKNOWN。只有材料本身确实不承载适用性主张时才使用 NOT_APPLICABILITY_BEARING，不能由“此次仅作背景”推导。SB 即使只用于机理背景，仍可能承载独立适用范围。

资料解释机理的价值与其措施是否适用于本机是两个问题；缺少关联资料的独立适用性不阻断背景分析，也不能据此宣称本机适用。

## 7.6 Currentness、SourceAuthority 与召回指标

- currentness：CURRENT、SUPERSEDED、HISTORICAL、UNKNOWN；
- sourceAuthority：CONTROLLED_PRIMARY、CONTROLLED_SECONDARY、REFERENCE_ONLY、UNKNOWN；
- retrievalPriority：决定先解析或先展示谁；
- relationshipConfidence：决定关系解释可信度；
- assessmentAsOf：记录判断时间。

明确 currentness 的核验范围：资料库当前受控记录与发布源现行最新版分开表达。RESOLVED_EXACT 只证明身份解析，不能推出发布源 CURRENT；未核实发布源时明确 UNKNOWN/未核实。较新日期不自动取代整份旧资料，修订与替代必须有关系及范围依据；历史版本仍可解释问题演进。显式引用优先解析身份，但来源权威、版本、证据立场和适用性必须独立判断。

## 7.7 候选与接受值

语义字段按实际需要稀疏保存，允许候选值附选择理由、来源和 provenance；不要求每张背景卡片先经工程师逐项采纳。ContributionRoles[]、RelationTypes[]、EvidenceStance 分开，旧混合 relationRole 字段仅兼容读取，逐步映射而不硬推导。语义标签接受、材料选入、实际读取、结果引用和正式业务采用是不同事件，不能混为一个 accepted 状态。

# 8. 显式引用、Issue Thread、RAG 与有限图谱

![图 B｜关联上下文分层与权威升级](https://feishu.cn/file/QnpobkIdwojRB4xUUFmcdDIqnyb)

## 8.1 互补信息渠道

以下是可用渠道清单，不是必须逐级完成的调用顺序。先处理工程师当前问题与明确给出的线索；显式引用优先解析身份，再按对当前评估的帮助程度选择问题脉络、RAG、附件和历史材料。显式引用数量不能自动挤占全部上下文预算。

1. EXPLICIT_REFERENCE：当前文档结构字段或正文中的显式引用；
2. ISSUE_THREAD：问题信号、调查、临时措施、最终措施、实施与反馈；
3. KNOWLEDGE_RAG：当前用户、租户和项目授权范围内的语义检索；
4. LIMITED_GRAPH：有限深度、可解释的邻居召回；
5. ENGINEER_ATTACHMENT：工程师显式添加并经 Host 解析的附件；
6. HOST_HISTORY：与当前版本和 WorkItem 关联的既有 Host 产物。

## 8.2 RAG 与来源权威分别表达

KNOWLEDGE_RAG 是检索渠道，不是来源权威等级。片段初次进入工作上下文默认为 BACKGROUND_ONLY；来源身份或版本未核实时明确未知，保留已经能够核实的原始来源属性，不因经 RAG 返回就抹掉受控原始资料身份。

记录实际知识空间、问题、返回片段、来源、可见版次/时间及授权范围。现有 Drive 文件搜索和读取不等于知识空间 RAG；真实接口未接通时显示 NOT_CONNECTED，继续已有资料分析，不伪装为 RAG 成功。

RAG 背景可帮助机理理解、方法选择和候选判断；不能仅凭相似片段证明当前构型、措施适用或已执行。正式采用仍走既有 Host 入口。来自同一原始来源的摘要、历史 AI 意见与再次召回片段不能当作多份独立证据重复计权。

## 8.3 显式引用与 RAG 的关系

显式引用未解析时保留原 SourceRef 和精确失败状态，不能用模糊 RAG 命中冒充该引用。RAG 可以补充背景或发现候选当前版本，但必须明确说明它不是原显式引用的自动替代。

# 9. 初始分析与 Review 流程

## 9.1 当前基础与下一条运行主线

当前已运行：DocumentVersion / 解析产物 → Translation → Applicability → Job-Aid → Overall → Review 候选。四个初始分析操作继续使用现有独立 ActionAttempt。

下一增量：主文件语义 + 有价值的关联片段 + 真实知识空间背景 + 当前事项条件 → 统一上下文评估包 → 按评估点使用相关材料 → 分项判断与综合候选。记录实际使用的片段和理由，需要更多信息时继续调用授权能力。

## 9.2 复用已有显式关联预览

现有 ReferenceMention、目标解析、RelatedContextSnapshot、Reader 与 SourceRef 作为起点。保留所有显式引用的可追溯索引，但只选有助于当前问题的内容进入模型；无需先导入所有关联文件。

现阶段 Snapshot 的只读预览与未进入初始输入是实现状态，不是永久限制。新增背景装配应走实际任务输入和来源读取链，不直接篡改旧快照标签来宣称完成。

## 9.3 背景推理与受控事实采用

Job-Aid / Overall 可使用背景来理解问题、解释候选、比较措施和识别待补事实，不要求每个背景来源先完成目标适用性求值。资料是否对本机具有措施适用性与它是否能解释机理是两个问题。

涉及本机效应、前置措施、当前构型或已执行状态的确定性输入仍需真实来源及既有 Host 专业处理。保留原有权限、SourceRef、版本和正式采用边界；不能用一段相似 RAG 摘要直接覆盖受控事实。

## 9.4 持续 INTERACTIVE_REVIEW

页面发送 → 保存新 Turn/requestId → 自动到达同一持续会话 → 同步当前上下文和新增信息 → 按需读取/检索并显示活动与理由摘要 → Host 保存候选 → 页面持续展示。工程师可继续追问、引导或补材料，下一轮承接此前讨论。

以上是待补齐并实际验证的用户流程。普通聊天与候选保存不自动确认 ReviewAction，不改变正式采纳状态；工程师正式采用仍沿用已有入口。

## 9.5 配置证据采用与重算支线

复用现有配置证据端口、采纳入口和 Applicability → Job-Aid → Overall 重算；三阶段成功后提升新结果，失败时保留上一可用候选并显示恢复方式。该真实数据支线并行推进，不再作为其他上下文分析与交互试用的统一前置条件。

# 10. 数据对象、Context Card 与接口

## 10.1 ReferenceMention：引用位置与目标身份

ReferenceMention 表达“主 DocumentVersion 在明确位置提到了某个对象”。保留 mentionRef、主文档版本、mentionSourceRef、citationText、normalizedIdentity、提取方式、关系线索、解析状态与目标版本、权限和 provenance。类型/关系的候选说明可按需附加，不把所有语义轴变成每条 Mention 的必填字段。

同一目标被多处提及时可聚合展示，但保留各个 mention 与原文位置，不能只用第一条引用的语义覆盖全部。需要持久引用时使用现有主键或普通 UUID，不使用列表序号身份，也不新增内容 hash。mentionSourceRef 是提及位置，不是关联资料正文；真正阅读的目标段落必须记录自己的 SourceRef。

解析状态区分 RESOLVED_EXACT、RESOLVED_MULTIPLE、UNRESOLVED、DOCUMENT_NOT_INGESTED、UNAVAILABLE、ACCESS_DENIED、UNSUPPORTED_DOCUMENT；标题源缺失允许 title=null。解析成功不等于发布源现行、内容已读或业务关系已接受。Mention 索引可进入共同上下文作为线索，但引用内容只有实际读取后才能声称参与分析。

## 10.2 RelatedContextItem

RelatedContextItem 复用 contextItemRef、主文档/mention 关联、目标文档或授权外部来源、来源版本、实际段落 SourceRefs、选择理由与 availability。DocumentType、ContributionRoles、RelationTypes、EvidenceStance、TargetApplicability、Currentness 与 SourceAuthority 独立且可稀疏；不存在的事实不补造。区分发现、选入、已读、被候选引用、正式采用，不统一为 accepted。相关资料授权应落在 DocumentVersion/来源范围，不要求为了读取背景先创建一个虚假的评估 WorkItem；现有 owner 检查不得直接移除，改由明确文档级授权接替。

## 10.3 RelatedContextSnapshot

现有 RelatedContextSnapshot v1 记录 EXPLICIT_PREVIEW 时可见的引用索引和解析结果，保持其 candidateOnly=true、readOnly=true、includedInAssessmentInput=false 的历史事实；Artifact 与返回投影使用同一 snapshotRef。下一增量不篡改旧快照：由共同上下文保存真正选入/读取的片段，并在任务视图记录其实际消费。保留 primaryDocumentVersion、目标、时间、版本、授权、未解析项、检索来源与不可用原因；不与 Reader/Review/Overall/AEO 工作流关系投影混用。

首阶段复用既有主键、版本、事务、唯一约束和 CAS；不新增内容 hash 或 frozen.3。只有出现普通机制无法定位的具体并发或篡改失败场景时才重新评估。

## 10.4 共同上下文：评估前材料与评估后结果

共同上下文是同一工程事项可持续更新的工作记录，先于评估存在。评估前包括：问题、目标、主文件业务语义、完整材料索引、选入及实际读取的相关片段、真实检索背景、工程师补充、讨论摘要与工作假设。评估后再附加实际 JobAid 分项、Overall、候选和变化说明的引用。

复用 WorkItem、DocumentVersion、SourceRef、Review、已有 JSON 产物存储和版本；优先一个共享装配服务及任务视图，不为每个概念建表。现有 EvaluationContextService 是结果侧投影，不能直接把它作为首次评估的必要输入而形成循环依赖。

JobAid、Overall、Review 使用同一共同上下文的不同任务视图。Overall 保留实际分项结果，不独立重建缺少背景的替代结果；材料变更仅重算受影响分析，正式采用另行执行。规则方法从当前 RuleSet/JobAid 来源绑定读取，Skill 维护方法与调查能力。

主文件保留原有结构、条件、例外和限定语；按业务语义做导航而不是仅留关键词摘要。完整解析保存不等于已完整分析。Context Card 标明身份、实际片段、贡献、选择理由、相关问题/评估点及版本限制。

按当前问题与选中 Criterion 选择有用来源；保留全量索引，必要时按页/批次展开。不再默认读取全部 availableSourceRefIds；超过 100 条来源通过相关性选择和分批传输处理，不因总量导致整轮失败。12 张/任务、5 张/评估点等仅为可调预算，不是阻断条件。

未知、未加载、未找到、无权限、接口未接通和读取失败分别展示。纯施工工卡按评估问题按需展开，不自动挤占机理背景；可选 RAG 不可用仍继续现有材料分析。新增授权来源登记后可加入同轮调查与候选引用。

## 10.5 最小接线范围

沿用现有 Review 输入、回读、ActionAttempt 与 MCP：持久化问题/选中评估点/附件及待执行意图；授权领取尚未执行的 Turn；读回运行状态和面向用户的活动；读取共同上下文及按需来源；通过原有入口提交候选。具体字段先在 shared DTO 与对应服务中落地，不把本节当作接口已经存在的声明。

来源读取复用已有 Reader/SourceRef/DocumentVersion，按文档权限明确授权；补充检索只做真实知识空间薄适配。语义标签的接受/拒绝是可选修订能力，不作为每张卡片使用的前置。正式 ReviewAction 确认与配置证据采用保持既有入口。

# 11. 当前实施顺序与运行反馈（独立评审后修订）

交付单位是同一真实事项的连续使用流程。以下为开发步骤，不是逐级解锁的 gate；自动执行与共同上下文必须在同一轮用户闭环验收，不能各自以 mock 或主控手工运行宣称完成。

## 11.1 第一步：修订契约并建立可执行目标

完成本次正文、第 12 节当前摘要和第 14 节完成定义的冲突修订；仓库记录执行计划，保留原始 GPT Pro 交接快照与旧版本历史。目标：工程师从页面提问、补材料和纠正方向后自动得到基于共同上下文的候选回答与变化说明。

## 11.2 第二步：自动运行与共同上下文接线

复用 Turn/ActionAttempt 保存执行意图，官方 Hosted 原生 command cron 沿用既有每 60 秒配置和唯一 Skill 安装路径，该 Skill 已更新为 c20。Turn 15/16/17 均有页面保存和自动领取实证，自动候选及连续往返尚未完成，重启恢复未单独验证。既有授权下独立读取历史讨论及 ActionAttempt 终态已发布并在真实页面通过；原文错误单独呈现。共同语义背景及历史讨论任务输入已发布，完整材料 read model、稳定会话、按需调查和真实活动仍待接通。旧文件恢复并行推进；新文件在同桶写入及发布前后读回正常。消费者不依赖开发者电脑或手动 CLI，不增加第二业务状态机；真实页面新回合及追问仍是自动闭环的完成依据。

首条样本沿用已成功的 SB 777-34-0425 事项及可访问关联资料，保留已有 150 项结果；新增受影响候选，不重跑已成功初始操作来增加记录。其他文档族先作背景，不先全量改造评估引擎。

## 11.3 第三步：连续调查与页面体验

稳定授权会话映射，传递当前问题和选中评估点，按需读取多来源；工程师补材料/纠正后，下一轮承接并说明改变了哪些判断。前端短轮询真实状态、候选和活动；运行中 steering 未实现时明示下一轮处理。Host 与 Skill 按兼容窗口分别发布，不以新字段存在冒充已消费。

### 11.3.1 Silver / Carbon Satin 前端设计（UI-N02）

采用用户于 2026-09-05 提供的 UI-N02「Silver / Carbon Satin」作为当前前端材质与交互实施依据，不另起业务契约或产品真源。业务语义仍以本 R10 当前正文为准，原型所依据旧导出的开头预览/P5 冲突已在 revision 2110 修正，不能回写旧口径。

视觉分为四个整体表面：银灰/炭黑磨砂框架，白色/石墨实体阅读面，略退后的工程助手，以及有限悬浮的输入器与弹层。基础中性色 R=G=B，黑白主操作，状态色仅表达真实状态；正文不透明，不把段落、条件、例外或表格拆成发光卡片，PDF 保持真实原色。

A 批次由既有前端主控立即并行实施：复用 tokens/glass/motion、Layout、资料库/快览、工程简报、连续文档和工程助手；单左栏，1440 下助手约 326px、快览约 324px，主阅读面可伸展，390 下单主面板。保留浅/深与默认/最高/兼容三档，兼容关闭弹层 blur，降低动效不隐藏业务信息。先交付资料库→工程简报→连续文档→来源→同一对话的真实页面纵切，不等全部后台和外部数据齐备。

B 批次与 Host/Agent 同轮接通：同一事项的本次问题和材料、已保存工作判断、已采用意见、真实运行/取证/失败及下一轮指示。发现、选入、实际读取、被结果引用和正式采用分别表达；普通保存不触发 ReviewAction。未实现运行中 steering 时，补充消息明示下一轮承接，不伪造已读、暂停回执或进度。

以下两张是用户设计包的静态示意，使用虚构材料，只解释材质和信息层次；不是当前线上页面、真实候选或自动运行证明。

![UI-N02 深色工作台设计样例：实体阅读面与略后退协作区（非线上截图）](https://feishu.cn/file/TGHgbqJURo60NTxM0gecUMEEnSe)

![UI-N02 浅色资料库设计样例：银灰框架与白色阅读面（非线上截图）](https://feishu.cn/file/Un7Qb6vmvoevjcxHFKucgDoJnpc)

原始完整包：WiseLink_R10_Satin_Workspace_20260905/（本机 Downloads）；start.html 提供十个产品页、设计文档与前后对照。仓库 docs/design/r10-satin/ 保留原设计说明、实施建议、来源说明及 CSS 参考，生产不导入 prototype.js、fixtures 或虚构飞机资料。原型 136 项离线检查不计作 Hosted 验收。

## 11.4 第四步：真实样本往返与迭代

实际完成页面提问→云端自动执行→候选回写→连续追问→新增材料或纠正→回答与判断变化。核对有用背景确实被读取/引用、来源能定位、失败可见及普通讨论与正式采用分离。保留未改变结论的合理情况及原因，不能为展示强迫模型改判。

出现具体故障时定位系统性原因、做必要普通测试并回到真实流程；安装、mock、主控手动 driver 与测试数量均不能替代上述证据。不新增缺乏具体失败场景的 gate、hash、baseline 或冻结契约，不删除已有安全措施。

## 11.5 并行支线与后置范围

前端主控并行实施 UI-N02 Silver / Carbon Satin：A 批次先完成既有页面材质、布局、连续正文和来源导航，B 批次按 shared DTO 接本次材料、工作判断与真实状态。Host/Agent 负责共同上下文与自动运行接线；方法/解析负责规则源绑定及真实样本语义；数据支线负责真实 RAG 薄适配、构型证据及原有重算。共享 DTO、数据库变化、集成和发布由项目主控统一收敛。A 批次不等待全部 B 字段，前端不以原型脚本替代业务实现。

规则源硬编码先据实改为派生状态；未确认的正式 JobAid 来源不阻断边界明确的候选分析，但不能声称规则来源核验或正式采用已就绪。RAG/构型数据未接通不挂起已有材料分析。全量图谱、知识镜像、额外向量库、通用队列、完整 Skill 发布平台和第二业务 Agent 后置。

# 12. 当前运行摘要与历史记录（2026-09-05）

**最近功能发布与页面核实：**Host release 7681965597551529166 已 finished，commit d5ffbf4c939a6c3a929dafb8d626ab01eecd629c，error_logs 为空；包含共同任务背景 90b05aa8f 与独立历史讨论读取 100709797。官方 Hosted c20 已先安装，唯一同名、Ready、模型可见，installed validation.test.mjs 为 103 pass / 0 fail。前端增量在主控集成后 2 suites / 50 tests 与前后端生产构建通过。发布后真实登录页冷刷新已显示事项版本 11、Turn 17 FAILED 及 ARTIFACT_READBACK_MISMATCH:METADATA、历史 Turn 13/14 候选；来源入口禁用且无提交/采用操作。当前已恢复历史讨论与真实状态的只读使用，旧原文/PDF 和新模型执行仍未恢复。无数据库迁移，未新建业务回合，未正式采用；共同背景的真实新分析效果仍待验证。

ReviewConversation ACTIVE，lastTurnNo=17；Turn 13/14 均未采用，分别保留 2/10 个 SourceRef，实际 Skill 分别为 c16/c17。Turn 15/16/17 均由页面保存、原生 cron 自动领取；15/16 在模型前失败，其上下文修复已发布；17 在上下文准备阶段因原文包元数据不可读而 FAILED，尚未产生新的模型候选。事项 revision 仍为 11，未确认 ReviewAction、未正式采用。配置查询与真实知识空间仍 NOT_CONNECTED，不能声称完整连续评估或真实构型采用后重算已验证。

**当前开发状态：**“页面自助连续评估闭环” Goal 为 ACTIVE，完整分析仍不可用，但原文失败不再遮住已保存讨论和真实终态。Satin A/B、焦点同步、页面自动发送、Host 授权领取、原生消费者、草稿编辑修复、共同任务背景和独立讨论读取均已发布，c20 已官方安装。新文档在同一原桶即时、约 5 分钟后及本次发布后均可读回，旧对象仍不可访问，需平台文件级原因与恢复证据；不能认定用户删除或物理删除。下一步恢复旧材料并验证新回合自动候选及追问，同时继续完整共同上下文页面、稳定原生会话、按需调查及真实活动。安装、发布和历史只读恢复均不等同完整连续评估。

**存储运行异常与深入定位：**2026-09-05 13:57:33 原文包仍可读取，14:01:23 起同一路径元数据不可读；15:38 原始 PDF 也返回“File not found or no access”。成功与失败的真实页面 Trace 均运行 4edb3a376，期间未发生新发布，同一工程师及服务调用均受影响。管理台实际请求仍查询原桶 bucket_aadkprardjghu，请求体仅 limit=200，无过滤返回 attachments=[]、hasMore=false；单纯管理端切错桶或 UI 缓存已基本排除。官方 SDK 会将“不存在或无访问权”归一为 null，故尚不能判定物理删除、索引异常或全局可见性变化。用户确认未进行相关操作，现有日志未找到文件删除证据；需妙搭存储侧依据原桶、文件 ID 1875042263478407 / 1875042252601353 和成功/失败 Trace 核查文件级记录及恢复可能。应用还将原文读取作为整页返回前置，致已保存 Review 讨论与 FAILED 状态也被遮住，正在修复此加载依赖。Turn 17 保持 FAILED，未重放，事项 revision 11 不变；未发现完整匹配备份，不从片段重造原件、不放宽完整性校验、不重解析覆盖既有事项。

**新文档存储对照测试（2026-09-05 16:36）：**应用户要求，在同一 Host app_17bzc551rsg 的原桶 bucket_aadkprardjghu 上传独立测试文档 WiseLink-storage-test-20260905-1614.txt，498 bytes，路径 /1875478528545995.txt。16:15:37 上传成功，立即、约 5 分钟后及 16:36 本次 Host 发布后均可读取元数据和下载，三次下载与本地内容逐字节一致；无过滤列表仅显示该新文件，用量为 1 文件 / 498 bytes。同时对照的旧 PDF 仍返回 400000034，日志定位 20260905161609ACB44DE5F28820635F77。因此当前不是全桶无法读写，问题已收敛为旧对象不可见或不可访问；尚不能区分删除、索引或对象级授权异常。此测试只证明官方文件存储链路，不代表完整上传解析评估已恢复，也不证明更长期持久性。新测试文件暂留作复查，未覆盖旧文件、未建立事项、未触发评估。

**前端设计接入（2026-09-05）：**UI-N02 Silver / Carbon Satin 已纳入第 11.3.1 节及 docs/design/r10-satin/。既有前端主控已交付 A、B、自动发送与规则焦点同步，分别集成为 453be9d4f、51ef9361c、f66a643dc、8fd75218d，并随最新 Host 功能版本发布。真实已登录页面已观察浅/深材质；本次材料按需聚合 10 处正文引用为 6 个目标，点击候选来源已定位受控 PDF 第 5 页。保存、选入、实际读取、候选引用和正式采用分开，未接 steering 时明确下一轮指示。两张设计图和原型 136 项检查仍是静态参考，不代表 Hosted 验收；稳定会话、逐材料使用记录和真实取证活动尚待接通。

**独立评审后代码核实：**SOURCE_IDENTITY_MISMATCH 是历史固定占位；正式 JobAid DocumentVersion 当前为 null / VERSION_UNCONFIRMED，并非实证来源不匹配。该常量不阻止 Hosted dynamic/overall 候选，且 blocks 字段不等于所有正式采用路径实际执行限制；下一增量从真实来源绑定派生状态，不直接改成匹配。

早期运行入口检查（2026-09-05、部署消费者之前）：Hosted 管理会话只读检查 7681886217462189043 已 completed；当时实际 OpenClaw 2026.6.6 (8c802aa)、Node 22.22.1，Gateway 可达；cron add 支持无需模型的 command/command-argv，当时 jobs=0。本段仅保留初次只读检查，不代表当前任务数量；此后 c19 原生消费者已部署并自动处理 Turn 15/16/17，当前见上文。重启恢复尚未单独验证；Host 运行时代码不得调用开发 CLI。

以下保留各阶段的原始运行记录。条目里的“当前”“下一唯一动作”和版本仅对应其记录时刻，不覆盖以上摘要或第 11 节。

# 13. No-Go 与安全边界

- 不得跨 Skill 策略恢复或改写旧 ActionAttempt；
- 不得把 Host 控制面标识、lease、raw locator 或未脱敏附件交给模型；
- 不得把 RAG 命中、显式引用、DocumentType 或 SourceAuthority 互相推导；
- 不得把主文档 Applicability 复制给关联文档；
- 不得保存或展示模型原始 reasoning；
- 不得让前端在后端空数据时产生业务 fallback；
- 不得在 EXPLICIT_PREVIEW 悄悄改变 inputVector；
- 不得以“完成 R10”为理由扩大到全量图谱、第二运行时或第二知识仓库；
- 不得删除既有认证、数据安全、SourceRef、权限、版本、CAS 或正式动作边界。

# 14. 完成定义

## 14.1 当前目标：工程师可自行连续使用

在既有真实 SB 事项上，由页面发送触发云端执行、读取共同上下文并回写候选；继续提问和补充材料/纠正方向后，后续回答承接讨论并说明影响。全过程不依赖 Codex 手工启动 driver 或开发者电脑常驻。

有用关联内容确实进入分析且可定位；可选 RAG 不可用如实提示并继续。活动展示来自真实读取/运行事件，不伪造已读、已干预或进度。保留既有权限、安全、并发恢复与正式采用边界；不自动确认 ReviewAction、正式审批、发布或执行。

分别交代代码完成、实际运行证明、工程师能够独立完成的步骤以及未接通的数据/平台能力。Host/Skill 安装、单次 candidate commit、普通测试和文档修订都不是上述完整完成证明；构型证据真实采用后重算是并行目标，不再阻断其他连续分析能力。

## 14.2 保留：EXPLICIT_PREVIEW 的既有完成记录

真实 DocumentVersion 的引用索引和 RelatedContextSnapshot 能构建/回读，Reader 能定位引用位置，页面区分解析歧义、不可用、未知和历史版本；旧 v1 includedInAssessmentInput=false 保持不变。新开发通过共同上下文及任务输入实际消费选定片段，不改写旧快照来制造通过。资料库当前与发布源现行分开，背景用途不推导 NOT_APPLICABILITY_BEARING。
