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

## 2026-09-23 验收修订：换轮读取的一致快照

父提交 `786bd094be6e2eb168d43deac1217b57de4f4daa`。专属Luna独立验收发现P2：原三次独立读取可先取得旧attempt的SUCCEEDED，再取得刚启动新attempt的正文，最后仍读取旧attempt回执；前端因此按旧终态停止轮询。主控要求修复后再验收，原786未按无缺陷接受。

本次将原assessment-work GET的execution/current/savedActivity放入同一个只读、repeatable-read事务，沿用仓库configuration-evidence既有事务用法和注入的数据库连接。三个repository SELECT均显式使用该事务执行器，tenant/WorkItem/documentVersion/精确attempt过滤不变；不进入Hosted service actor、不改RLS或数据库结构、不加缓存、循环重试或新状态。对象授权与fresh permission仍在读取前，正文evidence仍在返回前校验；任一读取或授权失败直接拒绝，不退回独立读取。

同一快照允许“新轮运行但尚未保存、仍展示旧正文”的合法组合；不允许跨快照拼接旧终态与新正文。SUCCEEDED快照已包含其之前提交的最终保存。快照建立后才启动的其他客户端任务将在下一次实际读取时可见；本次不把终态停止轮询改成跨客户端实时订阅。

确定性反例在修复前失败（已保存新轮时实际返回new-work而非old-work）；修复后同一请求保持旧轮一致快照，下一次读取显示新轮RUNNING，并分别验证新轮已保存/尚未保存两种情形。另验证三个真实repository查询都走同一事务执行器、数据库失败无降级，以及来源撤权拒绝。4套Jest共55项通过（current-execution/activity/read-lifecycle/continuation），3文件ESLint及diff-check通过。client typecheck通过；server首次只因沙箱不能写dist/tsconfig.node.tsbuildinfo失败，按同命令在获准A工作树写权限下复验exit 0。没有真实PostgreSQL并发、托管UI或模型运行证据；此处事务语义使用受控连接验证，仍须主控部署后按对应范围验收。

范围仅canonical-jobaid-problem.service.ts、jobaid-work.repository.ts、jobaid-current-execution.spec.ts和本记录，不触碰B consumer区域。A不推送、不发布；完成提交后向专属Luna与主控交付准确SHA。

## 2026-09-23 后续子批：知识工具实际状态可见

父提交 `0c350f04c2da8f6e2257689092bf8b312497d342`。继续完整评估管线，主控独立负责e812部署。本次补足“按需来源取数→用户可见工具状态”的真实缺口：原queryKnowledge已有持久检索回执，但浏览器仅看材料数量，无法区分工具运行、失败和结果未知。

不放开review_aily_query的service-role RLS，也不让浏览器读取查询/回答。复用已有ActionAttempt活动通道，queryKnowledge在调用前登记REQUESTED，收到真实工具回执后登记STARTING/RUNNING/COMPLETED/FAILED/UNKNOWN；无连接或授权过期登记UNAVAILABLE；异常只登记UNKNOWN再传播原异常，不断言远端失败、不新增重试。REQUESTED意为已登记调用，不证明远端已接收；观察不是另一份检索真源，也不证明当前进程仍存活。

活动写入复用原recordSourceRead的来源锁、actor事务、任务输入hash/事项revision绑定和fresh lease fence，独立知识方法只接受枚举状态；时间由Host写入。原来源读取保留sourceRefs/purpose供既有来源授权使用。返回的知识事件仅投影原序号、已有时间、白名单状态，不输出queryRef、查询正文、回答、错误文本、token、session或私有推理。现有快照GET和JobAidExecutionActivity直接消费，activity-only变化继续触发更新；与读取/保存共用尾50原始记录窗口，损坏和省略计数保持真实。

知识工具UI明确说明是观察记录，完成不代表原件已核实；无记录不等于已完成。新字段可选，旧Host无此字段时不假装存在工具记录。未加数据库表/迁移、新MCP工具、模型调用、原件缓存或全局调度；不碰B原件读取区域。已受控返回的查询内容仍仅经原授权来源及保存正文流程传递。

直接验证：5套45项Jest通过（新增真实repository写入路径与source/binding/lease/cancel拒绝反例、原来源事件兼容；queryKnowledge实际回执状态/异常不重试/不可用/调用前再授权失败；projector白名单/缺时间/窗口/损坏；真实UI与activity-only更新；既有当前执行快照和读取生命周期）。server typecheck通过；client首次仅沙箱写tsbuildinfo EPERM，获准独立工作树写权限后同命令复验exit 0。受影响TS/TSX定向lint及diff-check通过。未运行真实PG/Hosted知识检索和浏览器自然调度；其部署与全链验收仍由主控协调，不把本批UI或单测视为完整Goal完成。

## 2026-09-23 线上修复：任务目录快照的Datapaas兼容

父提交 `b10e6e570744169c5c057a806ccad2637414eab1`。Luna在ef258aa7正常身份两次读取 `/library?mode=tasks` 失败；A通过官方只读日志证实 `GET /api/canonical-host/library/tasks?search=&limit=24` 两次HTTP500。trace为 `935e8aa76e80edb44092eb03c369cc1d`、`5a433570c4f145feb6edc055063e7c0e`；服务链listTasks→readBrowser失败于 `set transaction isolation level repeatable read read only`，Postgres code25000，原错误“Switch transaction type failed, please terminate the current transaction.”。原始私有日志留在 `/private/tmp/wiselink-a-recent-errors.json`，不写入仓库。本缺陷来自A的0c350显式快照事务和平台数据库执行层不兼容，不是任务为空，也未证明历史业务数据损坏。

本次以单条参数化CTE SELECT读取current execution、latest saved work和所选attempt的最近51条保存回执，单条语句具有同一MVCC快照，不调用db.transaction或SET TRANSACTION。仍使用原注入数据库、原native认证上下文和RLS，不自建产品连接、不改平台SDK、不改数据库结构。原tenant/WorkItem/current DocumentVersion/WORK_ITEM/requestOrigin/actionType条件、active优先和确定性排序不变；latest旧正文的合法保留语义不变，保存活动精确attempt限定不变。JSON中的时间显式转回Date，当前正文仍经原历史解析和返回前fresh evidence校验。数据库失败/无响应行/坏历史仍明确抛错，不能空态降级；不触发模型、生成或重解析。

前述0c350的三读事务实现由本节单语句实现替代；其本地mock通过不构成平台兼容证据。补充真实本机PostgreSQL测试，加载项目真实SqlExecutionContextMiddleware和Datapaas Drizzle patch，在专用合成库使用authenticated角色/RLS；覆盖空快照、正确身份/跨tenant/错误actor、文档版本选择、Date转换、确定性并发换轮（RLS内advisory lock确认读取已进入DB快照，然后另一连接提交新轮与新保存，首读保留旧一致快照，次读看到新轮）、活跃新轮无保存时保留旧正文。该测试不修改生产数据库，不证明线上代理已经复验。

验证：4套Jest34项通过（current-execution、activity、read-lifecycle、canonical-library.service），真实PG集成1/1通过无skip，server typecheck、3文件lint、diffcheck通过。首次单测正则误将COMMITTING枚举识别为COMMIT语句，修正为词边界后通过；生产SQL无需为此变化。测试仅临时本机127.0.0.1:55447/wiselink_snapshot_test_a，可通过JOBAID_SNAPSHOT_TEST_DATABASE_URL运行test/node/jobaid-browser-snapshot-postgres.test.mjs；新库路径检查限制localhost及wiselink_snapshot_test_*前缀，fixture结束清理专用表/角色。

本批仅repository、对应单测、新PG测试及本记录4文件。未动B的图谱、知识页、原件或Matter服务区域，未自行push/release。主控部署后Luna须用正常身份只读复验任务目录和单WorkItem assessment-work，保留knowledge16/activity正常证据；技术发布前不能称线上已恢复。

## 2026-09-23 增量评估：保留未受影响来源的分析覆盖

父提交 `a89d76741599e089d5295ec67dcd2012ecb3ff50`。本批无需 Hosted 安装；修复完整评估链“保留未受影响认识并增量更新”中的实际缺口。原 materializeMatterJobAidCommand 仅在全部 issues 完全不变时保留既有 SUBSTANTIVE 覆盖。来源 A、B 均已分析，下一批只修改 B 的问题，且 A 仍在本轮已交付/已读范围中时，A 正文虽被保留，其覆盖却被降为 READ_ONLY，engineeringMatterPendingInputs 因而重新列出 A 的 READ_NOT_PROCESSED。

修复按旧问题的实际变化及来源血缘确定受影响范围：对被替换或撤回的旧问题，收集结构化来源使用并沿 PRIOR_RESULT 追溯根来源；其余来源在准确 input binding 相同、仍有正文引用且没有显式 disposition 时保留原 SUBSTANTIVE 覆盖、范围及理由。受影响问题即使还有另一条存活引用，也不能因此沿用旧覆盖；无法解析的受影响血缘仍采取保守处理。来源版本、解析/语义修订变化及显式 READ_ONLY 不沿用；新增实质分析仍走原 SUBSTANTIVE 判定。本批不自动升级 NO_MATERIAL_CHANGE，不认证工程结论，也不改变来源授权、租约、CAS、数据结构或模型调用。

实际消费者为 MatterActionAttemptService.saveWork 的 materializeMatterJobAidCommand → appendWorkingRevision 链，既有 state.coverage 和 engineeringMatterPendingInputs 直接消费，无新入口。回归经过真实 command/state materializer、序列化读回及 pending-input 计算。先仅加入回归时 1 failed / 11 passed，失败精确显示 A 从 SUBSTANTIVE 变成 READ_ONLY；修复后 3 套 27 项通过（jobaid-problem-work、matter-work-reference、matter-jobaid-task），包含独立 B 更新后 A 不待处理、直接/间接来源分析撤回、问题改引另一来源、显式 READ_ONLY、语义修订变化及既有正式版本/解析修订反例。server typecheck、生产文件 ESLint、diff-check 通过；测试文件被现行 ESLint ignore，未把它算作 lint 通过。已查看 canonical 可用日志尾部，无该补丁运行记录（server 为 9 月20日旧日志），不能作为此补丁运行证明。

范围仅 matter-jobaid-save.ts、jobaid-problem-work.spec.ts、本记录。A 未推送/发布/操作 Hosted 终端；本批 Host 逻辑不需要更新 Skill 包。独立验收交现有可见 Luna：检查保留准确绑定的未受影响 A，并验证撤回/换源/新版本仍为待核查；主控择机集成发布。本地合成回归不替代发布后真实事项连续两批保存验收，完整 Goal 不因此完成。

## 2026-09-23 取数上下文：知识能力与已授权绑定一致

父提交 `f329bd997784c050e6a1001860535eedb7500aab`。实际 BEGIN 在已有知识授权/绑定时给出 knowledgeAccess.available=true、knowledgeRetrieval=NOT_REQUESTED，但 buildJobAidProblemTask 的默认 capabilities.knowledge_retrieval 仍为 NOT_CONNECTED。模型同一输入自相矛盾；后续 materializeJobAidWork 又复制这份能力列表到已保存工作，用户仍会看到“未接通”。

在原 buildInput 的知识绑定组装段同步现有能力条目：有授权绑定为 AVAILABLE，USER_REAUTHORIZATION_REQUIRED 为 ACCESS_DENIED，其余未配置/未连接为 NOT_CONNECTED。影响说明明确是“本轮准备时”的能力，AVAILABLE 不代表已取得检索结果或核实原文；实际调用仍需有效授权。未修改 knowledgeAccess、allowedConnectors、session/agent 绑定、fresh grant、QUERY_KNOWLEDGE 行为或检索回执，不自动发起查询；contextPackage 仍为 NOT_REQUESTED/UNAVAILABLE 且 fragments 为空。已封存旧任务仍按原身份恢复，不重写历史快照。

通过真实 service.begin 的原 harness 复现 2 failed/29 passed：可用连接被标为 NOT_CONNECTED、重新授权需求也被标为 NOT_CONNECTED。修复后 continuation + knowledge-observation 2套37项通过；包含服务绑定留在 Host envelope、模型输入不泄露 session/actor/tenant/lease、未授权不准入 connector，以及既有检索调用观察/授权变化处理。server typecheck、生产文件 ESLint、diff-check 通过。没有新增接口或数据库修改；测试与受控服务不替代真实 Hosted 查询。仅 canonical-jobaid-problem.service.ts 的知识绑定段、continuation 测试、本记录；不碰 B 的原文分页实现。

### 剩余真实运行验收（主控安装回执后串行安排）

1. 以主控确认的安装包、Host 发布提交及新鲜 cron/在途状态为起点，在既有授权样本上执行正常新任务；不要重放历史 FAILED 请求。记录准确 attempt、来源版本、parse/semantic revision 和基线工作。
2. 正常运行中核对关联材料/前次工作与本轮触发一致，原文读取范围准确，JobAid 形成完整问题批次并及时保存；实际需要知识时再 QUERY_KNOWLEDGE，核对真实回执及不可用/未知限制，不把检索完成当作原件核实。
3. 连续两批保存后核对准确 workRef/工作修订：未受影响问题及来源覆盖保留，改动/撤回/新版本需相应处理；浏览器读取/知识/保存活动与真实回执一致，Overall 消费确切已完成工作。
4. 在主控安排的中断窗口验证接续：fresh Host lease/授权/输入绑定、完成轮的 checkpoint 与保存响应丢失读回；未知模型结果不得重放，旧任务/旧来源或失效授权不得越过拒绝边界。以真实恢复后的工作与活动结束本轮，不以进程重新启动作为成功。

本轮仅识别并修复已复现的两处衔接缺口；未宣称穷尽所有缺陷。以上运行项依赖主控安装和实际运行协调，A 不并发操作已交接终端，不增加运行预算或数据源权限。
