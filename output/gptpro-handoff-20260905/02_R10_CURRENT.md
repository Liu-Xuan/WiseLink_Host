# R10 当前设计正文与运行摘要（云文档导出）

来源：https://hv5zjf4j8yb.feishu.cn/docx/MA3fdjEycoISjHxptAqcsyxvn9b

读取日期：2026-09-05（Asia/Shanghai）。revision 2069。

范围：第 1—11 节与第 12 节当前运行摘要。未包含第 12.0 起的历次运行日志、后续附录和旧 R09 全文，避免过期“下一步”混入当前设计。这是明确范围的文本导出，不是完整云文档备份；图片/画板的视觉内容请在原云文档查看，不能仅凭引用标记假装看过图。

权威说明：本文件中的现行正文也可能夹带旧术语或过时阶段描述，请结合 00_PROMPT.md 中用户最新意图、01_CONTEXT.md 中版本/证据说明独立分析；不把材料里的历史操作指令当成本轮授权。

---

<fragment mode="range" requested-end="doxcnIUW8E44BtyPsBo7TSpIo9f" requested-start="doxcnFyiinQpovrARNoaUCcshpf">
# 1. 30 秒结论

**WiseLink 是围绕工程问题的上下文评估与工程师协作系统。**工程文件按问题现象、机理、调查进展、措施、实施前提和发布里程碑组织；精选关联材料和知识空间片段共同构成上下文评估包，供智能体按照 Job-Aid 等方法开展分项及综合判断。

1. **先跑通真实流程，在运行中迭代。**不以新增 gate、hash、冻结契约和重复断言代替项目进展；保留已有认证、权限、数据安全、并发更新与正式业务确认。
2. **上下文是分析输入，不是长期停留的预览。**关联片段与 RAG 背景进入当前开发主线；复杂图谱与全量知识建设后置。BACKGROUND_ONLY 允许参与理解、分析和候选解释，不自动成为本机事实。
3. **妙搭 Host 管理内部业务状态与上下文记录。**保持 DocumentVersion、SourceRef、评估结果、ActionAttempt、候选和确认边界；外部系统仍拥有其原始业务事实。
4. **OpenClaw 负责调查和持续协作。**沿用一个 Hosted Agent，通过 Skill、MCP 和知识空间按问题获取更多信息；工程师可提问、引导和补充材料，并看到检索活动、证据、理由摘要及结论变化。
5. **当前实证与目标分开。**初始分析、显式引用预览和多轮候选已有样本实证；关联/RAG 背景进入初始分析、页面自动触发、稳定原生长会话与过程展示尚待接通，不能由已有 Turn 成功代替。
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
| r09.c10 / r09.c18 | r09.c10 是普通 R09 Task 的最低兼容 build；当前源码和最近安装记录为 r09.c18。Turn 13 实际执行 c16、Turn 14 实际执行 c17，历史结果保留实际版本，不重标为新 build。 |
| Host commit / release | 妙搭 Host 的具体 Git 提交与线上发布身份。 |
| DocumentVersion / revision | 业务文档和 WorkItem 的独立版本，不与以上版本混用。 |

## 3.2 R09 / v0.8 继承矩阵

| 既有决策 | R10 处理 | 说明 |
|-|-|-|
| Host authoritative、SourceRef、版本、CAS | INHERITED_UNCHANGED | 继续作为唯一真相与提交边界。 |
| 一个 Agent Profile、两类 Session | INHERITED_UNCHANGED | INITIAL_ANALYSIS 与 INTERACTIVE_REVIEW。 |
| 四个初始分析 ActionAttempt | INHERITED_UNCHANGED | Translation、Applicability、Job-Aid、Overall 继续独立。 |
| Chat-first Review | INHERITED_AND_CLARIFIED | 自然语言自由，结构化副作用只有一个确认入口。 |
| 有限信息、Gap 与条件确认 | INHERITED_AND_CLARIFIED | 不要求 Gap 清零；使用当前 canonical 枚举 CONFIRMABLE。 |
| 五个 C3 Review MCP 工具 | INHERITED_UNCHANGED | 由确定性 driver 调用，模型不得直接持有 lease 或 commit。 |
| 一个物理 Skill、references 模块化 | INHERITED_UNCHANGED | 不拆第二 Hosted Skill。 |
| 原始 reasoning 展示或保存 | PROHIBITED | 只保存结论、证据、假设、理由摘要、控制与不确定性。 |
| 旧 current status、release 与上线日期 | HISTORICAL_ONLY / SUPERSEDED | 不得用于当前开发顺序。 |
| Base / Aily 主线 | DEFERRED | 按真实用户价值后置。 |

# 4. Host、OpenClaw 与外部系统边界

| 组件 | 拥有 | 不得拥有 |
|-|-|-|
| 妙搭 Host | 身份、ACL、文档版本、SourceRef、评估结果、候选 current、ActionAttempt、确认记录、审计 | 不得把未校验模型输出伪装成业务事实 |
| Hosted OpenClaw | 自然语言交互、候选解释、候选证据、WorkingAssessment、ReviewActionDraft | 正式适用性裁决、业务主键、current 修改、工程师确认、正式动作 |
| 飞书 Docs / Drive / Wiki 与其他知识源 | 被授权读取的材料及其源版本 | 对当前目标文档的最终判断 |
| 外部 owner system | 正式审批、正式发布、正式执行及其记录 | 不由 WiseLink 自动替代 |
| 前端 | 展示、筛选、追溯、触发受控动作 | 文档关系、适用性或权限推断 |

![图 A｜R10 总体架构与权威边界](https://feishu.cn/file/Q1CZbgMtaoVlBSxdJk8c8SnKngh)

图 A 的关键边：工程师通过妙搭交互；Host 向 OpenClaw 发受控任务包并只接收候选；授权上下文先进入 Host；只有工程师确认的 WiseLink candidate 才能移交外部 owner system，后者负责正式审批、发布和执行。

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

不新增 CONDITIONALLY_CONFIRMABLE 别名，避免文档与当前 shared contract 分叉；R10 明确 CONFIRMABLE 的语义就是“在已披露剩余不确定性与处置下可确认”。

## 5.4 Decision Snapshot

工程师确认包至少包含 assessmentAsOf、evidenceHorizon、currentBestJudgment、alternativeJudgments、decisiveFacts、assumptions、residualUncertainties、uncertaintyDispositions、controlsAndMitigations、monitoringPlan、validUntil、reviewBy、reopenTriggers、whatWouldChangeDecision 和 candidateOnly=true。

系统只持久化这些可审计产物和有限理由摘要，不展示或保存模型原始 chain-of-thought。新事实到达后形成新 revision，不能覆盖旧判断。

# 6. OpenClaw 原生 Review 执行模型

## 6.1 一个 Agent、两类 Session

首版只有一个 Hosted Agent Profile：wiselink-engineering，以及一个物理 Skill：wiselink-research-and-synthesize。它支持两种明确模式：

- **INITIAL_ANALYSIS：**Translation、Applicability、Job-Aid、Overall 四个独立 ActionAttempt；每项有独立 begin/commit、Result Gate、版本与 CAS，不把整条链塞进一个 Session 或一个 attempt。
- **INTERACTIVE_REVIEW：**长期 ReviewConversation / OpenClaw Review Session；工程师以自然语言多轮讨论，WorkingAssessment 和 ReviewActionDraft 可反复变化、追加和 supersede。

![图 D｜初始分析、长期 Review 与关联上下文模式](https://feishu.cn/file/XeVmbQegaomm49xaqIAcsX1Xnog)

## 6.2 Chat-first 与结构化副作用分离

Review 可自由回答、追问、引用 SourceRef、解释 Gap、形成 CandidateEvidence、预览 affected items 或提出 ReviewActionDraft。自然语言对话本身不改变 revision/current/STALE。唯一结构化副作用入口是：

```text
ReviewActionDraft candidate
→ 工程师在妙搭明确确认
→ expectedRevision
→ Host fresh-read Gap / evidence / affected items
→ Host CAS
→ 更新 WiseLink current candidate
```

任一 revision、Gap、queryability、证据、权限或 affected items 漂移都 fail closed。正式审批、发布和执行仍由外部 owner system 完成。

## 6.3 当前 C3 五个 Host MCP 工具

```text
begin_review_turn
get_review_turn_context
read_source_refs
get_action_attempt_status
commit_review_turn_candidate
```

这五个生命周期工具由 scripts/run-hosted-review-turn.mjs 的确定性 driver 调用，模型不得直接调用、保存 lease 或执行 commit。OpenClaw 的原生性体现在长期对话、自然语言判断、按意图选择允许的只读/候选能力和停止取证，而不是把业务状态机交给模型。REVIEW_ON_DEMAND 阶段可扩展 Host 授权的高层读取意图，但仍由 driver 机械执行并校验。

## 6.4 持续会话、可见分析与工程师干预

**目标：**同一 ReviewConversation 关联稳定的 OpenClaw 会话，承接此前问题、工作假设、方向和新增材料；每轮同步 Host 当前业务状态及上下文变化。新增 Turn/requestId 用于记录当次操作，不应等同于清空讨论重新开始。

工程师能看到当前关注问题、检索/阅读活动、精选片段、关键依据、可核对的理由摘要、方案差异、不确定性，以及补充信息对分项和综合判断的影响。展示面向用户的过程说明，不保存或展示模型私有原始思维链。

提问、纠正方向和附件首先进入讨论及 WorkingAssessment；Agent 可按问题继续调用已授权的只读能力。先接通追加消息、补材料和下一轮承接；运行中 steering 按平台实际支持的入口接入，尚未接通时如实标明，不伪装为已打断运行。

**2026-09-05 代码盘点：**当前 driver 按 requestId 生成 sessionDiscriminator，以当前 prompt 发起一次模型调用，强制单次结构化返回且 stream=false。已保存多轮记录不等于原生持续会话、动态多步取证和活动展示已实现。后续复用平台支持的持续会话入口与现有 Host 候选提交边界，不新建业务状态机。

- 每轮读取当前 WorkItem、权限、评估与新增材料；Session memory 不代表 current 或授权。
- 保留现有请求身份、候选持久化和恢复机制；不重放已完成的业务提交，不用新 Skill 版本改写旧 attempt 的执行记录。
- 读取、调用或提交失败需说明具体阶段和可用恢复方式；普通讨论不代替正式业务确认。

## 6.5 Skill 组织、适度解耦与 Publish Lite

保持一个物理 Skill，内部 references 按核心边界、交互复核、关联上下文、RAG、适用性感知召回、Issue Thread、Job-Aid、风险评估和厂商文档体系模块化。Skill 不保存 WorkItem current、ACL、文档目录、构型事实、正式 Criterion、CAS 或正式批准。

| 变化 | 发布单元 | 约束 |
|-|-|-|
| 提示词、references、关键词、示例、fixture、纯编排或模型输出格式约束 | Skill-only | 不得改变 wire、authority、ACL、current 或 ReviewAction 语义；ResultEnvelope 回传实际 Skill 版本。 |
| Host 内部生命周期、租约恢复或错误投影，且 wire shape 不变 | Host-only | 保持向后兼容；上线后用独立 UAT 验证。 |
| Task／Result／tool shape、RelatedContext Artifact、ACL 或权威边界变化 | Host + Skill 协同 | 需要兼容窗口和联合验收。 |
| 前端候选态呈现、SourceRef 导航、运行指纹 | Host App 前端发布 | 只消费 Host 真值，不自行推断采纳、current 或失败终态。 |
| 新增外部检索源或 Connector | Host tool／配置发布 | 保持最小权限、来源标识与外部发现非证据边界。 |

日常 Skill 发布采用 Publish Lite：本地测试 → 确定性 ZIP → manifest／SHA-256 → 企业私有飞书云盘 → 固定 slug 原位安装 → source／installed 测试与 digest 回读 → 全新 Session／Turn smoke。当前不建设完整 Skill 发布平台。

<callout id="doxcnLV1KfdQkLHT1tV6tmxbt7d" emoji="🔀">
**兼容与独立发布决策（2026-09-04）：**Host 声明兼容线 **wiselink-research-and-synthesize@r09**；普通 R09 任务最低接受 r09.c10，P0B 与 INTERACTIVE_REVIEW 必须回传实际执行包版本。纯 Skill 修订可独立发布，Host 内部修复可独立发布；只有 wire／authority／安全语义变化才协同发布。技术发布按用户持续授权直接执行并回报证据；不可逆删除、权限扩大、正式业务采纳，以及 ReviewAction 的确认／批准／发布仍保留独立边界。
</callout>

**当前实证（更新至 2026-09-04 15:07）：**Host release `7681534118325046546` 仍以 exact commit `171691ab3e22461b8b37a52a8c212975ce115f22` 承载前端与解析器集成；Skill-only successor `wiselink-research-and-synthesize@r09.c16` 已由 source commit `857db8f9f43c1d3c30a4941c7dd247d4869eb737` 生成确定性 ZIP，153524 bytes，SHA-256 `bcc736a5bd7e0e921dbe2bf300bb2e14886935c6cde432f8dd8015b7ede5f4a7`，并经目标 Hosted Agent `app_17c3zn24kv2` 的私有应用存储原位覆盖为唯一安装。安装轮 `7681567973316496356` completed；源包与安装后测试均 98/98，Ready／Visible／Command 均通过，source／installed SKILL.md SHA 相等，业务与模型调用均为 0。c16 不改变 Host、C3 或 MCP wire：模型请求只声明并强制唯一无副作用 serialization function `return_wiselink_review_candidate`，设置 `parallel_tool_calls=false`、`n=1`、`stream=false`，移除 `response_format`；响应必须是单 choice、单 function call、空白 content、direct strict JSON object arguments，函数不执行且不发送 tool result。运行 provenance 记录可证明的 configured endpoint；当前为 `miaoda/miaoda-model-auto`，不得冒充平台未暴露的下游 concrete model。

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

表达材料相对于某个明确判断或主张的证据立场：SUPPORTS、CONTRADICTS、NEUTRAL。立场必须绑定被支持/反驳的 assertionRef，不能脱离主张独立出现。

## 7.5 TargetApplicability

表达“该关联文档自身”对当前目标的适用性：APPLICABLE、NOT_APPLICABLE、UNKNOWN、NOT_EVALUATED、NOT_APPLICABILITY_BEARING。主文档的 Applicability 绝不能直接复制给关联文档。

- 关联文档已有独立 Host Applicability 结果：绑定该结果及版本；
- 材料只承担背景作用：NOT_APPLICABILITY_BEARING；
- 需要评估但尚未评估：NOT_EVALUATED；
- 事实不足：UNKNOWN。

## 7.6 Currentness、SourceAuthority 与召回指标

- currentness：CURRENT、SUPERSEDED、HISTORICAL、UNKNOWN；
- sourceAuthority：CONTROLLED_PRIMARY、CONTROLLED_SECONDARY、REFERENCE_ONLY、UNKNOWN；
- retrievalPriority：决定先解析或先展示谁；
- relationshipConfidence：决定关系解释可信度；
- assessmentAsOf：记录判断时间。

显式引用具有最高解析优先级和关系可解释性，但不天然具有最高事实权威性；来源权威性、有效版本、证据立场和目标适用性必须独立判断。

## 7.7 候选与接受值

所有多值字段使用复数：contributionRoleCandidates[] / acceptedContributionRoles[]，relationTypeCandidates[] / acceptedRelationTypes[]。候选值带 candidateOnly=true、confidence、reasonCodes、SourceRefs 与 provenance；Host 校验后才能形成 accepted 值。旧 acceptedRelationRole 单数写法废止。

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

## 8.2 RAG 默认边界

```text
retrievalChannel = KNOWLEDGE_RAG
contextUse = BACKGROUND_ONLY
authority = REFERENCE_ONLY
```

BACKGROUND_ONLY / REFERENCE_ONLY 允许 RAG 片段参与机理理解、方法选择、措施比较和候选判断，不要求先正式采纳后才能分析。保留实际检索来源、片段、问题关联和可见版本信息；知识源不可达或未接通时说明原因，不用其他搜索冒充知识空间 RAG。

RAG 命中不自动证明当前构型、当前文件适用、措施已执行或正式批准。需要改变这些受控事实时，仍由既有 Host 入口确认来源身份、版本、权限、目标关系和适用事实。背景帮助推理与正式事实采用是两个不同过程。

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

## 10.1 ReferenceMention

表达“当前主 DocumentVersion 在某个明确 SourceRef 位置提到了某个对象”，不直接表达该对象与主文档的已接受关系，也不直接表达主文档或目标文档的适用性。正式字段包括 `mentionRef`、`primaryDocumentVersionRef`、`mentionSourceRef`、受控 `citationText`、`normalizedIdentity`（documentNumber／title／publisher）、`documentTypeCandidate`、`extractionMethod`、`relationCue`、`relationRoleCandidates`、`resolutionState`、`resolvedDocumentVersionRef`、`permissionState`、`sourceAuthority`、`evidenceStance`、`candidateOnly` 与 provenance。UI 别名和兼容投影字段不得取代这些正式语义。

resolutionState 至少区分：

- RESOLVED_EXACT；
- RESOLVED_MULTIPLE；
- UNRESOLVED；
- DOCUMENT_NOT_INGESTED；
- UNAVAILABLE；
- ACCESS_DENIED；
- UNSUPPORTED_DOCUMENT。

`resolutionState`、`permissionState`、资料类型、关系作用、目标适用性、来源权威与证据立场必须分别表达，不得相互推导。`RESOLVED_EXACT` 只表示受控编号已唯一解析到可读目标；正式标题源缺失时 `normalizedIdentity.title=null` 是合法状态，不得用文件名或模型猜测补齐。所有 Mention 在本阶段始终为只读候选，不进入评估 inputVector，也不等于已接受的 Relation。

## 10.2 RelatedContextItem

包含 contextItemRef、primaryDocumentVersionRef、mentionRefs、relatedDocumentRef/authorizedExternalRef、精确版本、DocumentType、候选与已接受的 ContributionRoles/RelationTypes、EvidenceStance、TargetApplicability、Currentness、SourceAuthority、retrievalChannel、SourceRefs、assessmentAsOf、availability、candidateOnly、confidence、reasonCodes 与 provenance。

## 10.3 RelatedContextSnapshot

固定某个 `primaryDocumentVersionRef` 在指定 WorkItem revision 与 `assessmentAsOf` 下实际可见的关联上下文。正式快照包含 `schemaVersion`、独立 UUID URI 形式的 `snapshotRef`、mode、policyVersion、workItemRef、inputRevision、primaryDocumentVersionRef、assessmentTargetContextRef、assessmentAsOf、完整 referenceMentions、聚合 items、unresolvedMentions、retrievalReceipts、authorization、availability、downgradeReasons，以及恒定的 `candidateOnly=true`、`readOnly=true`、`includedInAssessmentInput=false`。持久化 Artifact JSON 与 API 返回必须是同一个快照对象并使用同一 `snapshotRef`。第一阶段作为 JSON Artifact 与独立投影落地，不重载现有 CanonicalRelatedDocumentProjection；后者仍只表达 WorkItem 到 Reader／Review／Overall／AEO 的工作流关系。

首阶段复用既有主键、版本、事务、唯一约束和 CAS；不新增内容 hash 或 frozen.3。只有出现普通机制无法定位的具体并发或篡改失败场景时才重新评估。

## 10.4 上下文评估包、片段选择与按需展开

上下文评估包逻辑上包括：当前文件和评估对象；问题脉络及关联片段；真实 RAG / 外部检索背景；Job-Aid 方法和当前工作结果；工程师提问、纠正、补充材料及讨论摘要。优先复用现有 EvaluationContext、Snapshot、SourceRef、WorkItem、Review 和产物存储，不为每部分建立新的数据库或 hash。

Context Card 说明材料身份、来源位置、内容片段、业务贡献、选择理由、相关问题/评估点、版本信息和仍未知的限制。同一片段可服务多个评估点；背景材料可以在目标适用性未知时帮助理解机理，但不能冒充本机适用依据。

Host 保留完整材料索引；模型按当前任务或问题接收相关片段。原有 12 张/任务、5 张/评估点、每张 2—5 个 SourceRef 仅作可调整的起始预算，不是达到数量就报错的 gate；全文按需要展开。

显式引用优先解析身份，但不自动占满模型预算。按对当前问题的帮助程度选择显式引用、问题脉络、RAG 和工程师补充信息；不相关施工步骤可留在索引里。未加载、未找到和读取失败要区分，并在影响判断时说明。

Job-Aid 评估点从 Host 当前规则读取，Skill 维护评估方法与领域调查能力。下一增量先让一份真实事项的背景进入实际分项和综合分析，再按运行反馈调节选择和预算。

## 10.5 最小 Host 接口

- 读取某 DocumentVersion 的 RelatedContextSnapshot；
- 触发显式引用快照构建并返回状态、解析歧义和未导入项；
- 在 Review 中按 contextItemRef 与 SourceRef 请求受控展开；
- 接受或拒绝 ContributionRole / RelationType 候选；
- 回读每项的版本、权限、currentness、适用性和降级原因。

# 11. 当前实施顺序与运行反馈（2026-09-05 修订）

本节替代此前 P0A 至 P7 的串行解锁顺序。已有代码、样本结果和安全措施继续复用；不要重跑已通过的旧 Turn 只为增加记录。交付单位是一条能由工程师使用的真实事项流程。

## 11.1 第一条上下文分析纵切

选一份现有真实工程文件，组织问题、机理、措施和发布脉络；从可访问关联资料中选有解释价值的片段，并接入实际知识空间检索返回的背景。组成同一事项的上下文评估包，真正供 Job-Aid 和 Overall 使用，结果可点击回原文并解释材料贡献。

不等待全部文档族、关联文件或外部事实完备。如果某知识源尚未接通，显示真实状态并继续可做的分析，但不能将其他检索或测试样例冒充该知识空间 RAG 已接通。

## 11.2 同步接通持续 Review

从页面发送到 Hosted 自动执行、稳定会话、按需读取/检索、面向用户的活动和理由摘要、候选回写。用连续提问和一次新增材料验证上下文承接；再按平台实际能力接入运行中 steering，不用主控人工启动 driver 代替自助运行。

## 11.3 按真实使用修订

工程师完成摄入、初始分析、追问、引导、补材料和再次综合。检查的是：有用背景确实影响分析；无关施工内容不挤占上下文；来源能定位；新增信息后的结论变化可解释；失败可见且可恢复。

针对出现的具体故障定位系统性原因、修复并做必要普通测试，然后回到真实流程。默认不新增 gate、hash、冻结契约、baseline 或层层断言；不删除已有认证、权限、数据安全、事务并发和正式业务确认措施。

## 11.4 可并行的支线

- Host / 执行：复用已有上下文、任务与候选机制，接通真实输入和持续会话。
- 前端：连续对话、材料贡献与来源、活动进度、理由摘要、补充材料和变化说明；消费 Host 状态，不自行推断事实。
- 数据：构型证据薄适配器和采用后的既有重算路径；未齐不阻断其他能力试用。
- 文档 / 方法：按真实样本补充解析和业务语义，持续丰富专业 Skill、MCP 和知识空间。

独立 worktree 并行开发，主控收敛共享接口和发布；开发并行不要求增加业务 Agent。Host 与 Skill 保持适度解耦，兼容的技术修订按既有持续授权分别发布。

## 11.5 明确后置的内容

全量知识图谱、知识镜像、额外向量数据库、完整 Skill 发布平台以及非必要 Base/Aily 入口后置。最小问题脉络、授权 RAG 背景和持续 Review 不再整体后置。

**状态说明：**本次是设计与实施顺序修订，不代表上述接线已经上线。当前运行事实见第 12 节；历史记录中的“下一唯一动作”只代表记录时刻，不覆盖本节当前顺序。

# 12. 当前运行摘要与历史记录（2026-09-05）

**本日只读盘点：**最近核实 Host release 为 7681752312452730071，finished、无发布错误，对应 c79c17eae1d11bb91e9a930b82d8e6b0822975dc。主事项 WI-2c1902db-c2cd-427d-b0d4-1f8f70fe6597 仍 revision 11；适用性 CURRENT/APPLICABLE、Job-Aid 150 项、综合候选就绪、unresolvedCount=124。124 是不确定性计数，不是必须清零的代码任务。

ReviewConversation ACTIVE，lastTurnNo=14；Turn 13/14 均未采用，分别保留 2/10 个 SourceRef，实际 Skill 分别为 c16/c17。配置查询 NOT_CONNECTED，configurationEvidenceCurrent 与 reevaluation 均为空；不能声称真实构型采用后重算已验证。

显式关联预览和 Review 背景读取已有实证；初始 Job-Aid/Overall 尚未消费关联/RAG 片段。页面自动触发、稳定原生长会话和活动展示仍待接通。第 11 节是当前实施顺序，本次文档修订不代表功能已上线。

以下保留各阶段的原始运行记录。条目里的“当前”“下一唯一动作”和版本仅对应其记录时刻，不覆盖以上摘要或第 11 节。
</fragment>
