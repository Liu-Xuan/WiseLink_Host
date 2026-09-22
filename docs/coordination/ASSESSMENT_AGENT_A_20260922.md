# 评估智能体 A：执行能力接续

## 范围与基线

A负责文档/事项解析后的关联上下文、JobAid动态问题分析、已准入来源按需取数、候选工作增量保存与真实过程可见。系统通用提速由另一管线负责。主控统一集成、同步、发布；可见Luna负责独立测试验收。

本批父提交为 `0ee978c45346a3ecacbf425cc183657562dfef9c`，在既有独立 perf 工作树继续开发。只修改下述OpenClaw执行文件及本记录，不重做活动首切；不包含B的 `aac9bd64ee80fb9a967d64c05aed120b42c12350` UI修复。本批逻辑不依赖该UI修复；整体发布需主控按接受范围组合。未改canonical目录或B工作树。

## 已有执行能力与后续核查

- 已有共同上下文、原文来源目录、JobAid方法、前次完整工作；模型通过 READ_SOURCES / QUERY_KNOWLEDGE / SAVE_WORK / FINISH 选择动态问题组，不新增固定问卷。
- 已有Aily知识查询请求身份、读回和未核原件边界；不能把知识查询记为受控事实，也不能虚构其他数据源已准入。
- 已有同一会话多次保存、Host来源验证与CAS、精确工作回执；Matter逐轮checkpoint和保存响应丢失恢复已存在。
- 活动首切已交付，但不代表完整智能体目标完成。WorkItem运行恢复与当前attempt可见性仍需后续按真实反例推进。
- WorkItem外层model checkpoint尚未接入逐轮assessment checkpoint，且consumer对Host BUSY返回、工具调用回执缓存、失败取消是相关控制路径。不能仅传入一个checkpoint参数就宣称安全恢复；下一批须核对同一请求重新进入、fresh lease/source授权及未知模型结果不重放，再决定实现范围。

## 本批修复：重新评估必须有本轮保存

`run-jobaid-problem-assessment.mjs` 原来对非Matter任务无条件把previousWork作为saved。具有前次已完成工作的EVALUATE_JOBAID若首先FINISH，驱动会返回旧workRef；Host的canonical-jobaid-problem.service既有提交校验要求当前attempt保存，只有Overall一致性允许前次工作，因而真实提交将拒绝。

现在普通重新评估的saved从空开始，前次正文仍完整留在模型上下文；模型直接FINISH会收到现有JOBAID_COMPLETED_WORK_REQUIRED反馈，可继续SAVE_WORK后完成。Overall明确匹配SYNTHESIZE_OVERALL与OVERALL_CONSISTENCY时仍可核对后复用旧工作；Matter已授权resumeSavedWork沿用。没有自动生成工程结论，没有自动复制/保存旧正文，没有修改Host正式采用、来源和版本边界。

## 直接验证

新增反例修改前失败：模型仅调用1次并返回旧引用；预期完成纠正、保存、结束共3次。修改后得到新引用JAWR-4、expectedWorkRevision=3，前次JAWR-3保持不变。

- node --test openclaw/skills/wiselink-research-and-synthesize/tests/jobaid-problem-runtime.test.mjs openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-work-item.test.mjs：68/68通过。
- node --test openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-matter.test.mjs openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-matter-correction.test.mjs：22/22通过。
- git diff --check：通过。

这些是本地受控模型/工具驱动证据，不是实际Hosted模型验收。真实验收应使用明确获准的重新评估任务，确认原工作保留、本轮新保存、准确FINISH与Overall引用关系；不要为测试重放未知在途请求。需要主控部署相应Skill脚本，单独Host发布不会安装此改动。

## 2026-09-23 子批：WorkItem原请求的逐轮接续

父提交 `35a7420c02b399dc9f03fd6540e787433d2138f5`。增加真实consumer接线而不是只传checkpoint：

- 新JobAid/Overall problem-v2调用持久化当前claim及逐轮assessment状态。旧版本只有外层model.started的任务不自动迁移或重放。
- Host报告BUSY时，只对同一事项/文档版本/操作/明确request及attempt、无run-result/commit-started、在Host原deadline内的已过期本地claim做候选检查。本地文件不证明停止；fresh begin必须重新通过Host来源授权，并返回完全相同task及更高leaseGeneration，才继续。若旧worker已续租而返回原代际，保持BUSY，不调用模型、不取消它。
- 当前轮模型started但没有result时返回明确的INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN，不claim、不重新请求模型。已完成模型响应与稳定save requestId由原driver恢复。自然调度仍以每subject唯一native job为前提，不新增第二执行者或强抢活跃租约。
- problem-v2的心跳、来源读取、知识查询/精确读回与工作保存直接经Host，不重放旧工具回执；保存和查询幂等身份仍由逐轮driver和Host控制。最终commit沿用原unknown处理，不进入模型接续分支。
- WorkItem现在和Matter一样，在存在真实Host绝对deadline时按已持久模型执行时长计原模型预算，排除维护/租约等待时间，但不延后Host绝对deadline，不增加模型预算。无deadline仍沿用原墙钟预算。

本批文件：consumer、恢复资格/新claim辅助模块、JobAid driver、恢复测试、driver测试及本记录。没有修改Host协议、数据库或权限。

直接验证：5个Node测试文件共100/100通过，含8个恢复检查/consumer接线用例、WorkItem与Matter实际driver的停机预算/已完成响应复用/未知响应拒绝反例；定向ESLint通过。consumer测试的Host与runInitial/model为受控替身，driver测试使用受控gateway；没有实际杀死托管进程、真实Host领取/PG租约竞争或真实模型恢复证据，不把本地通过表述为托管验收完成。

主控交Luna独立验收时重点核对：新版本正常JobAid保存后运行中断、等待原lease失效且deadline尚未过时同一request重新领取；已保存正文不退回或重复保存，后续模型只调用未完成轮；授权撤回、原代际仍活跃、模型响应未知、commit已开始均不重放。相应Skill需按主控发布流程安装后才可验证。本批不自行发布，完整评估智能体目标保持未完成。

## 2026-09-23 子批：当前执行与保存正文分开读取

父提交 `47adbcd09a10a16fda3b942b4cb7466276b44243`。原readBrowser从最新正文的actionAttemptId读取状态，导致下一轮尚未保存时仍展示上一轮成功/失败，无正文时完全没有状态。本批改为授权与fresh permission snapshot通过后，按tenant、WorkItem、当前DocumentVersion、WORK_ITEM主体和既有OpenClaw requestOrigin，读取JobAid/Overall的真实持久任务状态；活跃任务优先，其余按createdAt/attemptId确定最近项。只select status，不读取任务载荷、原始活动、租约或模型正文。原历史正文与证据授权保持独立，前端首次保存前也显示该状态。它是Host持久状态快照，不声称证明模型进程当前存活。

文件范围：jobaid-work.repository.ts、canonical-jobaid-problem.service.ts、JobAidProblemWorkspace.tsx、jobaid-current-execution.spec.ts、jobaid-problem-reading-ui.spec.ts及本记录。旧的按保存任务查状态方法已无消费者，随替换删除。无协议/数据库/配置变更。

直接验证：3套Jest共40项通过（新查询条件及确定性排序、实际服务授权前置、未保存/已有旧正文两条读取分支、界面首次保存前状态和既有continuation）；标准双端typecheck exit0、5文件ESLint及diffcheck通过。首次测试发现测试actor缺appId，补齐真实类型后复跑通过。SQL是Drizzle编译查询与受控repository证据，不是实际PostgreSQL/线上验收；source evidence分支沿原校验，旧正文测试用受控授权回执，不宣称新证明了其全部安全性。

当前仍待完成：WorkItem来源读取/分次保存事件的安全可见投影、与真实运行配套的终态/隐藏页面读取策略，以及Luna对已交付执行接续与本状态读取的托管验收。本批没有将状态标签当作完整执行过程，也未改6秒全文读取策略。主控负责接受范围与实际发布，A未推送/发布。

## 2026-09-23 子批：JobAid正文读取生命周期

父提交 `301cb3633c1cf2e1249ce9c888e05d6f36eb59ef`。在前批真实当前执行状态基础上，既有useJobAidWorkingRead仅对QUEUED/RUNNING/RETRY_SCHEDULED/COMMITTING继续6秒读取；终态、无任务和未知状态不持续读取。浏览器隐藏或retained工作台panel失活时清除定时器并AbortSignal取消在途GET；重新显示按需读取当前状态。没有引入新全局缓存或改变保存/评估入口。

本hook通过既有client session订阅响应身份代际变化，以session+WorkItem绑定当前本地读取状态；切换时立即隐藏旧内容，取消原请求且忽略迟到结果。网络/读取失败保留当前对象已读正文但停止自动读取；401/403/404清除正文；隐藏/retained切换不自动解除失败，手动刷新才恢复。此停止状态属于已挂载hook，完整卸载后的新访问会重新鉴权读取，不宣称跨完整卸载持久缓存。当前scope只保留一份本地读状态，未做跨多个组件的请求合并。

文件：client API增加可选AbortSignal并传入既有request helper、useJobAidWorkingRead、jobaid-read-lifecycle.spec.ts及本记录。直接验证2套17项Jest（真实React挂载、fake timer/受控API、终态停止、隐藏取消/迟到返回、失败与权限拒绝、retained切换、会话/对象隔离）、client typecheck、3文件ESLint及diffcheck通过。未运行真实浏览器HAR/线上页面或模型，不作线上提速量化结论。

安全活动投影与真实托管验收仍未完成；本批只减少不必要全文读取并使读取行为符合当前执行状态，不能替代来源/保存过程展示。主控负责集成发布，A未推送或发布。

## 2026-09-23 子批：WorkItem真实读取与保存过程投影

父提交 `60ec3a359f81b293fb46ba141a2d8dcdec145d67`。在原assessment-work GET及真实JobAidProblemWorkspace中接入本轮过程：复用同一已授权current attempt的reviewActivityJson与assessment_work_revision，不增加事件真源或模型调用。

- 活动投影逐字段构造，只公开attemptRef、真实读取的引用数量/原数组序号/已有时间，以及真实保存workRef/版本/时间。来源标识、purpose、原文、查询文本、task/checkpoint和租约不输出。读取记录表示Host登记了读取，不证明模型已理解或响应一定送达；实际材料内容及引用仍通过既有授权正文入口查看。
- 原始活动取尾50条，保留原序号与实际重复读取；未知类别、损坏条目、较早省略数分别提示，缺时间明确为空不补造。整个活动JSON损坏只影响读取记录，保存回执与已保存正文继续保留。
- 保存查询限定tenant/WorkItem/当前DocumentVersion/精确attempt，仅读版本ID、版本号、时间，最多取51条判断是否还有较早保存，显示最近50次。读取与保存两组分别排序，不伪造统一事件顺序；这是有界窗口而非全部历史分页，UI明确显示范围。
- 活动变化即使尚无新正文/任务状态变化也更新当前页面，不触发额外模型或业务更新。前批可见性/终态/失败停止策略保留。
- 修正终态停轮询竞态：先选任务状态，再读取正文；如果状态已终结，正文查询不会早于它的最终保存。活动日志仍可能整行读入；未宣称数据库活动分页或整次读取成为窄字段查询。

文件范围11个：shared/jobaid-activity.interface.ts、shared/jobaid-problem-assessment.interface.ts；server的jobaid-activity.ts、jobaid-work.repository.ts、canonical-jobaid-problem.service.ts；client的JobAidExecutionActivity.tsx、JobAidProblemWorkspace.tsx、useJobAidWorkingRead.ts；jobaid-activity.spec.ts、jobaid-current-execution.spec.ts；本记录。

直接验证：最终5套58项Jest通过，覆盖字段白名单/隐私标记不外泄、原序号与重复读取、损坏与保存分离、窗口省略、真实组件展示、活动更新、查询范围、fresh权限前置和终态最终保存竞态；双端typecheck、10文件ESLint及diffcheck通过。一次编译检查发现unknown时间字段在项目非strict-null设置下无法收窄，已用显式类型分支构造安全字段；新测试初次直接导入SDK ESM导致Jest加载失败，已mock未调用的客户端API依赖，无修改SDK或放宽Jest配置。证据仍是受控gateway/repository/React测试，未真实PG或托管UI验收。

至此已有Matter与WorkItem的读取/保存过程本地实现，活动首切不再仅限Matter。完整业务Goal仍需对实际上下文、动态问题分组、已准入取数、增量保存与接续作Luna独立验收并修复确认问题；状态与过程UI不能替代真实运行证据。主控统一集成发布，A未推送或发布。
