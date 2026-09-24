# 工程知识目录读取优化职责与验收

## 当前证据

代码基线 d1858281bd5af864192facdeb352090fe1d971a3，父 c5445dfec677b911957f2753bf8103566dcea519。d185 的上线状态尚未取得权威回执；主控读取工具本轮返回空 items，不能据此判定已发布。

c544 ALL 的单次样本：20条返回、21条可见含lookahead，candidate_query 123ms，matter_exact_read 21次累计52121ms，read_group_wait 6次累计14742ms，app_server 14873.07ms、275 SQL spans。并行和递归阶段嵌套，不能相加，单次样本不代表p95。旧 def68384 样本保留历史用途。

## 函数职责表

| 实际路径 | 责任与保留边界 | 优化机会 |
| --- | --- | --- |
| EngineeringIssueSearchService.catalogue | actor校验，关键词/当前性筛选，40/5/4限制，拒绝继续扫描，错误传播，20+1游标 | 现有尾组裁剪保留；仅从授权结果生成entry |
| CanonicalJobAidProblemService.readBrowserRevision | 对象入口授权、确切修订加载、assertEvidenceOwned | 暂保留全部；不跨请求复用授权 |
| EngineeringMatterWorkingService.readWorkingRevision | 当前成员授权、确切保存读取、历史保留成员freshRead | current稳定性确认和历史成员复核不可命中旧缓存 |
| authorizedMatter | loadCurrent、freshRead、再次loadCurrent确认版本 | 可研究同窗口批量事实，但两次版本读取不可合成同一旧结果 |
| repository.readByRef / readModel | tenant/matter/workRef定位，命令/状态解析及一致性校验 | 完整状态仍是核验事实来源；不只抽标题绕过损坏 |
| authorizedReadModel / assertOwnedSources | 保存来源及原始文档所有权 | 保留；有证据后考虑同窗口逐根独立结果的批量化 |
| authorizedReadModel 的 overview_origin | 概述确切来源和receipt绑定，发现损坏 | 不因列表不展示来源就跳过 |
| authorizedReadModel 的 PRIOR_RESULT递归 | 当前/历史links授权、确切修订、循环及每条边内容绑定 | 可共享确切节点取数，但不能共享引用边结论或跳过递归上下文 |
| noticeAttempts / noticeSaves | 更正匹配、receipt保存绑定和通知数据合法性 | 已合并通知类型和保存查询；不能重复声称解决原有逐条查询 |
| knowledgeFromWork / jobAidReadingResult | entry外的阅读对象、问题正文映射、证据克隆 | 本批将entry独立投影，目录不再构造WorkItem详情对象 |

## 本批实际减少的工作及限制

目录改调用 knowledgeEntryFromWork；详情继续调用 knowledgeFromWork，并共享entry投影。WorkItem目录不再遍历issues生成issueArticles，也不再structuredClone evidence。全套reader与授权仍执行，Matter不再构造顶层详情包装，但其数据库工作未减少。因此本批只是A的可核验第一步，不能宣称解决21次Matter exact的主要瓶颈，也不能将完整读取改名算作完成A。

验证使用固定entry预期，检查目录不克隆详情证据而详情仍独立克隆；保留现有分页、拒绝、数据错误、并发上限和确切历史读取测试。测试对象由现有隔离fixture提供，不改线上业务。

## 下一项决策与完成标准

先取得d185细分日志，选择占比高且语义明确的事实读取做B。只补改变决策的缺口；不要求先部署本批投影再开始设计B。数据库或权限的动态事实不做跨请求缓存。最终新鲜复核与每条引用边验证保持独立。持续核对相同用户、scope、search、cursor和数据集；对照前根据重复基线样本约定延迟收益门槛。报告样本数、实际调用/解析减少及并发资源影响，不用SQL spans冒充往返数。

验收仍需完成主要Matter读取工作量下降、固定预期的授权/来源/错误/分页回归，以及真实平台重复对照收益。仅此代码拆分、单测通过或新增观测均不足以关闭Goal。C仅在A+B后大型静态状态解析仍占主要成本时评估。

## B：窗口事实批量候选（2026-09-24 后续核对）

主控回执：d185 已选择性集成为 d6811c4b4d77c34bfdf359eefe7b1dccfb91073b；release 7688916995013954763 回报 publishing。该回执尚不是发布完成或子阶段性能证据。

### 先批量、暂不跨窗口缓存授权结果

迁移0023的 authenticated SELECT 和0024的 hosted SELECT 均检查 tenant、matter owner、based_on_matter_revision_id 的所有links归属。没有发现服务代码直接update/delete工作修订，但这并不能证明数据库层所有写者都不可修改。更重要的是，固定正文不代表SELECT可见性固定。因此首个B候选不缓存原始行的长期可见结论，不缓存动态owner/links/来源检查；同请求后续窗口仍重新读取。实际平台policy是否与迁移一致仍需只读核对。

### 可独立度量的增量与调用数

设每个已消费窗口中通过当前入口授权、且需查找确切Matter修订的不同根身份数为 n_g（0至4），N为其总和，G为 n_g>0 的窗口数。下表只计算Host显式调用，不包含RLS函数内SQL和平台跨度；不预测毫秒。

| 增量候选 | 现有调用 | 批量目标 | 21个全Matter、无拒绝且无递归的根工作例子 | 决策条件 |
| --- | --- | --- | --- | --- |
| B1 确切保存行查询 | N次select | G次按复合身份select | 21→6，减少15次；解析次数21不变 | saved_row_await占比及平台批量SQL/RLS验证 |
| B2 根工作来源集合核验 | N次assertOwnedSources | G次带候选序号的来源谓词查询 | 21→6，减少15次；各候选allowed仍独立 | saved_sources_await占比；先保留其前面的解析/错误优先级 |
| B3 概述来源查找 | 每个有概述的根1次 | 每窗口1次相关子查询/LATERAL | 若21个都有概述，21→6；底层扫描不保证减少 | overview_origin_await显著且执行计划没有成本反转 |
| 当前成员freshRead、末尾历史成员freshRead | 按现有成员数 | 首批不变 | 不宣称减少 | 是动态访问边界，平台能力尚未证明可批量 |
| PRIOR_RESULT递归与绑定 | 按每条边及递归路径 | 首批不变 | 不宣称减少 | 节点重合率、递归时长取得后再评估 |
| noticeAttempts/noticeSaves | 已按工作合并 | 首批不变 | 不重复计算已有收益 | 仅未来跨工作批量才是新改动 |

B1与B2同时实施时，示例最多少30次Host显式根查询；不能从275个SQL spans机械减成245，也不能推导总延迟下降比例。实际存在拒绝、递归、混合WorkItem窗口时按n_g实测。即使B1可做，若仅占小比例也不先为它扩展复杂接口。

### B1 的最小实际接入结构

catalogue仍按最多4个根身份建立窗口，按原输入顺序消费settled结果。Matter service新增仅目录使用的窗口入口，先对每个根独立执行authorizedMatter并保留其成功/拒绝/错误结果；只把通过者交给repository批量读取。SQL严格用(tenantId,matterId,workRef)复合键条件，执行器仍为同一浏览器actor上下文中的现有db，不创建runtime service身份。完整行不通过额外JOIN吞掉；批量结果按复合键映射，每个缺失键沿用原readByRef null→matterNotFound路径。

取得行后逐候选沿用authorizedReadModel和历史成员freshRead。可抽出共享的“已取得确切行后核验”私有函数，不能由调用方传入任意伪造行跳过repository权限边界。工作流仍以最多4个根为界；新增取数屏障会让快根等慢根的入口授权，必须计入端点实测而不是只看查询数。

动态一致性的变化需明确：原有4次语句可看到不同提交状态，合并后是一条语句的快照。原有当前版本前后复查以及末尾freshRead保持；如产品要求根间逐语句时间点也完全相同，B1不能使用批量语句。请求期间撤权/版本变化测试应验证既有拒绝与冲突要求，不能以固定数据对照替代。

### B2 的关键映射与错误顺序

每个候选先完成与基线相同的readModel解析。批量输入包括候选序号、各自workItemIds/documentVersionIds；每个候选分别执行原NOT EXISTS与所有权函数，返回独立allowed，不把来源全集的一个布尔值套到所有候选。拒绝候选只影响自身。后续overview、递归与notice校验顺序不提前；若共享批量查询发生基础设施错误，整个调用报错，不能伪造某个allowed=false。空来源集合、缺失来源和null谓词必须保持原IS NOT TRUE行为。

### 接入前应通过的固定预期测试

- 批量SQL返回乱序、重复输入、相同workRef不同subject以及缺失行：按确切复合键映射，输出顺序不变。
- 同窗口允许/拒绝/损坏混合：入口拒绝不读取其保存正文；保存状态损坏不被drop；按根输入顺序消费错误。
- B2一候选来源拒绝、一候选允许：不能全放行或全拒绝；同节点不同引用边仍独立校验。
- 后续请求撤权：不得复用上次结论；当前与历史成员检查均仍实际调用；最终版本复查不使用首读结果。
- 20+1、末组1个、跨40候选批、5批扫描上限、拒绝分布、关键词和当前版本判定保持固定预期。
- 构造21个无递归根，断言被选中的批量事实调用确实21→6；同时断言授权、逐边验证和新鲜复查次数未被意外减少。

这是一份可实施候选清单；取得子阶段日志后选择最重且规则明确的一项实现，不预先同时重写三个阶段。

### 子阶段发布后证据（主控回报）

release 7688916995013954763 完成当时为 finished、d6811c4b4d77c34bfdf359eefe7b1dccfb91073b、error_logs=[]。ALL空查询首批trace 5121e84fd2d56ca73f16628fce264a31、release_commit=d681：app_server6577.57ms/275SQL；candidate132ms；21 Matter exact累计22693ms；6组等待6441ms。当前授权21/6552ms、保存读取21/12601ms、历史成员复核21/3541ms；保存内部saved_row21/2102ms、saved_sources23/1665ms、overview_origin22/2335ms，PRIOR递归2次。层级及并行计时重叠；与c544单样本差异不构成提速证据。

下一实现选择B1：其21次根行读取可用6个窗口查询替代，保留完整保存状态、RLS和所有后续核验。来源和概述累计含递归，不按21根简单合并；递归仅2次，当前证据不支持优先引入复杂递归缓存。B1的主要价值是先验证批量确切事实读链路与错误映射，后续能复用该窗口结构做B2；不会将15次调用减少承诺成端点收益。完整平台验收仍待实现后进行。

## B1 代码候选与验证口径

分支 codex/perf-catalogue-batched-rows-20260924 基于94d0f980。目录的每个最多4根窗口在至少2个新Matter身份时创建请求内batch；入口授权完成后通过原数据库执行器按(tenantId,matterId,workRef)复合键一次SELECT，返回结果按键映射。入口授权拒绝占一个已结算槽位，不装载其保存正文。结果随后仍调用authorizedReadModel、历史成员freshRead和原目录排序/错误消费。单根窗口走原读取。新增saved_row_batch_query计时只代表合并查询，saved_row_await包含等待其余入口授权的屏障时间，不能直接与旧阶段按毫秒比较。

固定预期单测覆盖21个全Matter候选的5次四根batch+1次单根查询组织及第20条游标；repository测试核对所用表、复合身份SQL、乱序映射、跨租户同身份不会错误归位、缺失与数据库错误；service测试核对授权拒绝后释放槽位、通过者仍调用原精确读取。另已修复A投影发现的issues:[null]历史损坏语义差异：目录仍抛TypeError，详情仍抛TypeError，合法目录不克隆正文证据。本地无ENGINEERING_MATTER_TEST_DATABASE_URL，未运行真实PostgreSQL/RLS夹具，单测不能替代平台授权与性能验收；待受控环境验证后才能判断收益。
