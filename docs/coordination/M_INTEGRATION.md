# M 主控集成交接

## 2026-09-17 同源短认识修法提交与部署在途

已接受9文件提交a7835ba27cdcf27444d5f643f51a06cc282e178e（父45c3e525df9e0ac42e695c98560c157b5c6bb744），正常precommit及公开敏感检查通过，origin/github精确同名开发分支均回读该SHA。Host release 7686351180390747366 已由官方release-get确认finished、commit_id精确为a7835ba27、error_logs=[]。新字段接收能力已技术发布，未触发业务生成或改写旧数据。后继Skill版本已在7处现行声明/说明/测试文件推进至c111，源检查53文件与11处声明一致；尚待提交后按标准打包/安装，不能用c110旧包冒充新指导。

后端Luna重新只读核对conversation_4ky0f6r24fz90为streaming=false/queue=0/completed，可作为后继准备入口；未发送安装命令。既有c110包425945字节、53文件及正式安装回执保留。实际安装前仍需现场保存受影响cron完整配置、查在途、官方暂停，验证新包后原位安装并逐文件核对，精确恢复原enabled/schedule/payload/agentId/sessionTarget；不得续跑另一旧会话的5条分片消息。

## 2026-09-17 线上简明认识缺口与同源保存修法（未提交、未安装）

45c发布后，M通过外部Chrome已登录生产资料库实际读到新版五列表格、资料分组、事项快览，以及知识页“工程认识/来源资料、当前/历史、左目录右正文”。SB工作16和FTD工作12均仍以第一条长问题重复充当标题与短摘要；SB快览正确显示综合未覆盖提醒，但没有形成有价值的简明认识，故内容验收未通过，不能将结构上线写成Suite整体完成。知识页准确定位SB工作16 MWREV-75632e5d-e5f4-4cd2-8ace-a254f99f5874，并显示保留综合来自工作14；实际正文仍有过程叙述和大段问题结构，后继仍需按设计改进阅读架构。

M使用官方只读数据库查询精确工作16的schema/headline/listBrief/overviewStatus，确认是已持久v3数据，headline与listBrief确实等于第一条issue.question，overviewStatus=STALE，不是前端缓存或历史v2兼容导致。源码根因是materializeJobAidWork固定生成这两个值。6文件最小修法允许正常work update成对提交headline/listBrief，省略时保留前次保存值，空/类型错/只给一个字段均拒绝；不机械裁切关键条件。模型工作投影与持久重构同步保留这两个字段，仍走同一保存、版本及CAS。Hosted实际消费者导入的guide/shape说明短主题和一句认识随工作一次保存，overview写工程综合、变更过程放changeSummary，不另跑评估转Wiki。

实际验证：保存/状态重构两套Jest共33项通过，更正插件/检索两套Jest共41项通过，Hosted runtime共48项通过（新增短认识与正文同一次SAVE、无额外生成的断言）；受影响ESLint及server typecheck通过，diff check通过。最初误用不存在的server/tsconfig.json未运行类型检查，随后已用项目正式type:check:server成功检查。Astra只读复审限定接受，未发现必须修项；确认成对校验、持久重构、变化检测、同次SAVE一致。初次保存若省略两字段仍会回退首个问题，不能把可选字段支持当成已改善所有结果。批次正在交Git协调员提交；尚未发布/安装，现有线上旧记录没有被改写，仍需后续正常工作和真实内容验收，不能把本地修法当作已消除线上缺口。

## 2026-09-17 Suite 资料库与知识页技术发布、后台旧队列核对

M重新独立读取origin/github的精确同名开发分支，均为45c3e525df9e0ac42e695c98560c157b5c6bb744。仅发布已接受的共享壳、知识阅读与资料库两批，未提交图谱WIP不在本次发布内。Host release 7686346531314109398 已由官方release-get确认finished，commit_id精确为45c3e525df9e0ac42e695c98560c157b5c6bb744，error_logs=[]；发布中读回的旧commit字段不作为终态证据。正在外部Chrome核验已登录生产资料库与知识阅读，技术发布本身不代表完整视觉或线上链路验收。

后台原会话conversation_4ky0f6r24fz90官方读回最新turn7686294291635112907为completed、streaming=false、queue=0；该轮因云端基线及development-work不可见而没有交付。对应correctedWorkRef问题已由Host提交118903524实现、随f1cfb发布，不能因此重复开发或回退。另一旧会话conversation_4kuem6js768t6最新turn7678808736835767515为cancelled、streaming=false，但queue=5；只读核对均为2026-08-27的旧分片上传及清理修订消息（第3至6段及后继任务），不得自动续跑。官方session-get可读队列文本/seq_no，现有CLI未发现单项撤销能力，session-stop只停止运行turn。本次未取消、发送或安装，当前5条状态覆盖此前历史queue=0的报告。

云端代码交接协议已补齐新增文件导出：使用临时index和准确文件清单，避免普通git diff遗漏未跟踪源码/测试；canonical已有早期WIP时先在精确基线的干净临时checkout验证完整patch，再逐项对照集成，不清除现有成果。

## 2026-09-17 恢复妙搭实施与在途成果保留

用户追问确认 Luna 应操作妙搭而非自行本地开发。M 已中断本地 Canvas 实施，前端 View 操作员本地批次已停，后续恢复原妙搭会话唯一操作员；本地只承担审查、验证、集成与必要关键修正，不再派发 Luna 本地功能实现。45c3e525 接受基线保留；未接受图谱差异不删除、不当作完成代码发布。

Luna 已通过官方接口核对 app_17bzc551rsg / conversation_4m1xuavvgyhaz：latest turn 7686309868802804685 completed、is_streaming=false、queued_count=0。该轮回执记录 /home/gem/workspace/code、codex/wl-frontend-revision-reading-view-20260916、b08cc2d15761431d263842f06a869e959adba360，已跟踪文件干净，仅平台记忆目录未跟踪；此 Git 状态是该轮工具回执，下一次操作仍需现场核对。Suite20260917尚未在该云端目录。准备的续修包包含18个新增源码/测试、4文件集成patch、完整新版src/docs/screenshots和计划；不含私有诊断、凭据或线上业务数据。续修材料已上传原应用存储 `/1876547992787031.gz`，大小 8,095,183 字节，SHA256 `657a719785b48b7510d30a5e1292ea7e25d77e4c1dcf1e9792c946746c96aae7`；包内18个快照文件和4文件patch均按manifest复核，含25张参考截图。唯一前端操作员已单次派发该具体批次；M独立通过 app_17bzc551rsg / conversation_4m1xuavvgyhaz 官方查询确认新 turn `7686342154516564960` 为 running、is_streaming=true、queued_count=0（建议30秒轮询）。M随后直接核对消息回执：云端fetch的精确tip为45c3e525，旧分支b08cc2d1已同步且源码干净；正常checkout -b切入同名codex开发分支，下载8,095,183字节材料并得到相同SHA256。云端已解压并读取README、manifest、计划及Graph/GraphCanvas参考，开始检查快照。源码与验证结果仍待交付；repo内tmp材料及平台记忆不进入接受范围。恢复云端后按同一基线继承、检查差异再续修，不整边覆盖。图谱视觉差异、剩余完整交互与真实读取继续保留任务范围。

## 2026-09-17 图谱返程与视觉差异修订（未验收）

新增有界图谱显示状态序列化及原文/Wiki目标身份绑定。Graph→Reader→Graph、Graph→Wiki→Reader→同一Wiki→Graph保留原事项/工作、所选节点、视角、过滤、分页/密度/边模式与相机参数；目标版本、parseRun或工作不符及重复/混合返程参数拒绝。返程与既有目录19项检查、实际容器路由2项检查通过，客户端类型通过；View已接initialState/onStateChange，实际浏览器整链恢复仍待核验。

M随后只读核对返程消费者发现：当前 onStateChange 只写内存 ref，图谱内直接操作后刷新没有持久位置；Reader 返回时带 query 的恢复不能替代这一项。已交唯一操作员作为云端终态核对/必要后继修订项，不在云端在途期间本地并行改写。

M查阅隔离Canvas桌面截图发现默认黑边灰底椭圆与HTML分组重叠、组标题遮挡和边标签黑底，与Suite参考图明显不同，已退回修订。图谱视觉尚未接受，不能以当前截图或纯组件测试替代完整三栏对照。

## 2026-09-17 新版事项图谱消费者接线（未提交、未发布）

`/graph?matterId=…&workRef=…` 已进入新三栏消费者及授权读取 hook，Sidebar 从事项携带准确身份；旧 workItem 图入口仍保留，混合/重复事项身份与空/重复 workRef 明确拒绝。原文回调保留完整 DocumentAssessmentEvidence 的版本/parseRun/sourceRef，Wiki 固定实际保存 workRef。新增路由与已有外壳检查共 6 项通过，客户端类型通过。三栏组件实际可编译，但分组溢出完整阅读、聚合关系明细、图谱自身相机/选择返程、完整工程事件及领域/全景真实读取尚未完成；这些继续作为交付要求，不将当前三栏或四个切换按钮称为 S4 完成。Canvas 正在独立无 Host middleware 的隔离浏览器入口验证。

## 2026-09-17 资料库批次 Git 闭合与图谱真实投影续做

资料库 19 文件已提交 45c3e525df9e0ac42e695c98560c157b5c6bb744（父 5078bb002addfac46e52343ca0a0beeaaf50dad6）；正常 precommit 通过，origin/github 同名开发分支均非强制快进。origin 独立回读曾临时 SSL 失败，随后 M 重试已精确读回同 SHA，github 亦一致。未发布。

新增当前事项图谱读取适配器：明确材料记录、预计取得、保存认识和准确依据，保留前提解释/限制与取得范围；缺材料合同和缺证据均明确报告，未知综合状态不推断 CURRENT。当前工作投影 5 项定向测试通过并已接受。随后扩展精确历史选择与保存输入/继续核对组，6 项投影测试通过；新读取 hook 的 JSDOM 实测覆盖指定旧工作等待、切换后的迟到响应、身份变更与撤权，不以当前工作替代，1 项多断言测试通过；客户端类型与受影响 eslint 通过。历史增量仍待独立复审及实际页面接入。Canvas 与三栏 View 正在独立实施，四视角、完整时间事件和全页视觉验收继续保留范围。临时安装的 HTML 标签插件因 Canvas 使用 React HTML 层而移除，package/lock 回到原状态，避免冗余依赖。

## 2026-09-17 Suite 资料库返程增量接受（尚未发布）

资料库文档/事项表与快览增量完成独立审查。最后两项 P2 已修：完整正文来源链接携带绑定目录上下文，准确工作 Wiki 可继续返回原目录；双面板位置由页面级 Provider 同步合并，避免同一渲染批次的 URL setter 相互覆盖。新增同批列表 450/快览 100 的回归断言，三份定向测试 24/24 通过；客户端类型、受影响源码 eslint 通过。隔离实际组件预览在正常页面高度下滚动快览 60 后刷新恢复 60；该证据不代表真实线上验收。

图谱纯投影层经过独立复审修复 ID/聚合/分页/虚节点问题，16 项定向测试通过；display root 为虚节点且不作为业务关系端点，matter root 保留真实身份。纯层接受，真实页面消费者及全部视觉效果尚待接通。资料库版本解读缺项、完整逐页视觉核验与线上发布仍未完成，不将本批接受等同于 S1 或整体前端完成。

## 2026-09-17 Suite 1.1 共享外壳与知识阅读首批

本批 18 文件已提交 `5078bb002addfac46e52343ca0a0beeaaf50dad6`，父提交 `378bc3236e7c044f39479748749e6f98f015b5da`；正常 precommit 通过，origin/github 的 `codex/wl31-r09-master-handoff-20260903` 均普通快进并读回同一 SHA，未发布。首次 HEAD 源 ref 被既有 pre-push 拒绝后，使用精确同名本地分支 ref 成功，未绕过 hook。

后续 S1 已进入资料库组件迁移；M 补齐只读目录返回的事项模式、所选事项/文档版本、family 展开、密度及双面板滚动，并排除滚动数值参与阅读 scope，避免滚动使恢复键变化。原文仍绑定准确 DV，写入意图及任意 URL 不进入返程。返回/比较两套定向检查 43/43 通过；该后续增量尚未提交，须结合新页面继续验收。

后续实际进展：M 新增绑定事项的目录→Wiki→确切原文→同一 workRef Wiki→原目录返回链，`returnLibraryMatterId` 与嵌套 `returnMatterLibraryQuery` 必须匹配当前事项；拒绝串事项、重复绑定和混合入口。导航/比较/共享壳 49 项测试通过。资料库文档已换为五列表格，历史行紧邻所属 family 且排除当前版本；M 修复历史选择连续两次 URL 更新导致选择被覆盖的问题，并接入精确版本快览，所选版本缺失或重复不替换为 current。事项表首屏保留短认识，快览展示完整决定性条件及覆盖/更正提醒，完整工作折叠下钻；相关 8 项阅读测试、客户端类型和定向 lint 通过。此增量未提交、未发布；尚缺资料库整页同环境预览、事项表完整视觉迁移、双面板滚动实际读写及文件自身短解读，不能称 S1 已完成。

Astra 定向返程审查指出事项列表真实 `workItemId` 筛选未在白名单保留；已修为仅事项模式保留单值合法筛选，完整二级往返断言包含该筛选、选中事项及滚动，文档模式和重复参数不保留。修后两套导航/比较 45/45 通过；另加实际 DocumentDetails 历史版本/缺失/空/重复选择渲染检查，该阅读返程套件最终 15/15 通过。

随后继续实际 S1 实现：事项目录也改为五列表格及分组/主表/快览三栏，默认认识不再重复标题或堆积过程；历史版本行修复旧 grid 样式，原文链接停止行选择冒泡。新增 `useLibraryPaneScroll` 并接入文档/事项列表及快览，URL 分别保存 listY/quicklookY，选择改变清除快览位置、搜索改变清除旧选择与位置；请求未 ready 时不写滚动，读写按 session 与阅读 scope 校验，无延迟回调。24 项定向检查及客户端类型通过；Astra 发现同 scope 只改 URL Y 时未恢复，已令 y 独立触发 layout 恢复并增加该场景断言，复跑通过。以上是实际组件与 JSDOM 证据，真实高度下的钳制、完整整页几何和跨页面视觉仍待隔离预览检查，尚未提交/发布。图谱 S4 真实接口与组件只读映射同步进行。

整页隔离预览 4183 已实际运行：初次 `process is not defined` 来自 toolkit logger，临时 alias 隔离后可读，生产未加 polyfill。M 查看实际截图后将旧受理/上传/帮助收为标题栏操作菜单，搜索与视图收为紧凑工具栏；修复手机树面板宽 780px 被祖先隐藏裁切的问题，不能以根节点无横溢替代可读性。最终 1672/1440 下三栏上边界 y=184、高 800、目录 166、快览 292；390 下主表及快览外框均宽 370，无页面错误，表格内部横向滚动。截图仍为构造资料和临时身份，尚非同数据全页视觉接受或线上验收。新增目录 `overallStatus` 直接取当前保存 problemWork，表格明确 STALE/NOT_AVAILABLE，不从工作修订推断综合覆盖；双端类型和相关 24 测试通过。文档原文链接返程追加准确 selectedDocumentVersionId，15 项返程套件通过。

S4 已取得真实接口映射；新增纯分组展示模型/投影及 11 项测试，支持 1–6 组、隐藏/溢出/分页及真实 relationIds，尚在独立审查、尚未接页面。领域关系与事项级时间聚合缺口保留，不按标题推断关系，不把纯展示模块称为完整图谱。

已完成五份补充附件、12 类页面源码及 25 张参考截图审阅，逐页范围与差异落实到 `docs/WISELINK_FRONTEND_SUITE_PLAN_20260917.md`；Goal 已采用 Suite 1.1 全部页面范围，工程态势保留现有已接受双环。源码和参考图审阅不等同逐控件交互复测。

本批代码：共享壳采用 188px 贴边侧栏、60px 顶栏、独立面包屑/准确返回/全屏及新版导航；保留 Router、身份和主题 Provider。搜索进入真实知识页，暂停动态同时响应系统 reduced-motion 和页面隐藏。知识页采用工程认识/来源资料、当前/含历史/仅历史、左侧保存认识列表与右侧完整正文；有界分页目录及精确工作读取沿用保存内容和原授权 reader，不调用模型。工作当前性与 Overall 覆盖分开；最多检查 200 个候选，耗尽明确失败，不伪装完整空页。URL 保存查询、范围、分页、完整工作身份与滚动，拒绝半套/重复身份，取消请求并阻止迟到正文及跨工作滚动污染；准确原文返程已接入。

验证：32 项定向 Jest 检查通过，服务端/客户端类型检查、相关 ESLint/Stylelint、diff check 与客户端构建通过；构建仍有既有旁支 tsconfig 路径和大 chunk 警告。真实本地 PostgreSQL 隔离测试 1/1 通过、0 跳过，覆盖当前/历史与分页 SQL；授权 reader 为测试替身，不能据此声称生产 RLS 验收。Astra 前后端只读复审均接受本批功能范围。

同组件隔离预览使用生产 Layout/Theme/Knowledge 及样式，只替换身份和只读 API 为明确构造样例。最终截图在 1672×1000、1440×1000、390×844、DPR1 下均无 JavaScript 错误和整页横溢；桌面知识面板上边界 y=260.30、列表宽 370px，与本轮目标几何相符。追加 1440 深色截图已查看，reduced-motion 下 motion=off；全屏按钮进入 is-immersive、Escape 恢复成功。首次脚本错误使用按钮可见文字而非其 aria 名称而超时，修正定位后通过，未改产品代码。预览位于临时 4182，原 4179 仍是旧 Trinity 隔离预览；不能混用其截图。新批尚未发布，完整动效及真实线上视觉未验收。资料库准确版本短解读仍缺接线，Wiki、Reader、换版、图谱/时间轴和后续页面仍按计划继续，不能把本批称为整套前端完成。

妙搭原前端会话最新只读核对 turn `7686309868802804685` 已完成：云端 `/home/gem/workspace/code`、分支 `codex/wl-frontend-revision-reading-view-20260916`、HEAD `b08cc2d15761431d263842f06a869e959adba360`，tracked 干净且无 stash；Suite 新素材未在云端，只有旧 Trinity 材料。同仓存在其他会话的 worktree/交接和共享 memory，尚无独立并行生成证明。因此未新增云端开发会话或重发开发任务，按已授权方案采用本地文件职责分开开发、独立审查和统一提交。

## 2026-09-16 跨事项恢复审计发布与工作12闭合

Host补齐精确attempt的只读审计投影：STATUS在原事项/actor及每个参考事项重新授权后，只返回封存的matter revision、base working revision、prior work、trigger、输入、实际交付模型的referenceWorks及其更正通知、保存回执；不返回lease、executionModel、完整任务或模型载荷。Astra两轮发现并关闭继承参考遗漏及旧任务缺referenceWorks兼容；25项单测、server type、源码eslint/diffcheck通过，隔离PG全套6/6通过，含显式/继承引用、问题/Overall通知、撤权拒绝、失败恢复、保存回执及合法历史封存。提交61caffd00cc78b45790d38eaf4f19a6c030a04da（父3b1d462669d7b3b422a53d1259ee636de65d72e6）精确4文件，正常hook及origin/github同名分支SHA一致；release7686084654881278914最终finished并绑定该提交。发布中一度回读旧SHA，终态已纠正，不将中间态当发布完成。app17c是OpenClaw操作目标，不支持代码release；Host发布面仍为full-stack app17b。

新STATUS准确恢复旧失败跨事项attempt AQ-888ff6f88f984fe797293601dcb96d06：目标事项revision MREV-4cfb4204-2859-4408-8fe4-f6224af10e4f/2、base work7、prior MWREV-c31bd0fa…，两份同family输入为旧document_version_6b998…/PRUN-ea9543…与新document_version_78c6…/PRUN-9e7cd…；唯一参考为787事项MAT-26b208d0…工作16 MWREV-75632e5d…的问题claim_maintenance_disruption_risk_under_win7_hypothesis。该旧attempt无保存回执，未猜测丢失save request。

基于当前work9而非旧work7创建正常后继AQ-0522420dcaeb43aba7a1320f45d82c0d，明确只比较787方法/条件与777自身ONS、BP V17C和已过期目标，不继承对象事实、评级或结论。自然消费者保存work10 MWREV-7273b6f0-df4e-4796-bf48-fce9d2d2cc37/revision10后以JOBAID_INCOMPLETE_TERMINAL_RESPONSE失败；精确保存回执JA-save-aa18ccee-1b2c-4acf-b995-c47e684c1db8可读，证明保存后失败仍可恢复。work10六问题及Overall CURRENT，但跨事项只在文字上下文出现，未持久MATTER_WORK证据，M不接受交叉引用闭合。一次正常全工作后继AQ-ae9a6b…同错误且零保存，未原样继续重试。

随后改用已存在的有界入口。问题更正AQ-a9d0cdf9ea914292bda4a102e2046fb5成功，只改FTD-V18-CROSS-REFERENCES，形成work11 MWREV-95c19b85-e48e-4d2e-ae1c-1a1f00d43e7e/revision11；保留三条777 References原文并新增准确PRIOR_RESULT `MATTER_WORK:MAT-26b208d0-1cc8-486e-a38f-7b9a99f74e7f:MWREV-75632e5d-e5f4-4cd2-8ace-a254f99f5874:claim_maintenance_disruption_risk_under_win7_hypothesis`，正文邻接引用且明确来源Overview STALE未采纳；其他五问题逐字段未变，Host正确将旧Overview标STALE。

首次Overview更正因没有交付旧Overview已引用的完整三条来源而在创建attempt前拒绝，无operationRef和业务副作用；在线trace edaacb7de4086efac412ed0e2c5a017d及本地合同确认这是来源准入而非CAS/权限失败，未放宽校验。按现有Overview精确引用u102:p3、u111:p4、u79:p2及新增MATTER_WORK来源重新受理AQ-c79e0e4bae6e428cbc760ff472dcfd7a并SUCCEEDED，形成work12 MWREV-2ac8099c-04f1-4149-9ccb-6f40120a3b68/revision12。Overview CURRENT，覆盖六问题；787段落邻接准确MATTER_WORK来源并保留STALE/不继承边界；六问题与work11逐字段相同，180条evidence含唯一PRIOR_RESULT。线上WL_ENGINEERING_SEARCH_PROJECTION未设置，知识搜索当前使用授权后的工作表直读而非projection；只读SQL按同一current-work数据源精确命中work12/FTD-V18-CROSS-REFERENCES/CURRENT及三条目标原文+MATTER_WORK来源，空projection表不是索引丢失。

外部 Chrome 控制接通后完成该只读页面验收。先以错误 `MAT-26b… + work12` 组合进入 Wiki，页面准确拒绝并明确不以当前工作替代指定历史版本；线上只读 SQL 随后确认 work12 实际属于 `MAT-d9e6c294-f368-42e4-9a1b-b46c6170be02`。正确 URL 精确读回完整工作修订12、CURRENT Overall、六个问题、11项根来源及邻接的 787 `MATTER_WORK` 引用，明确该引用 Overview STALE 且不继承事实、适用性、评级或决定；浏览器刷新后 URL、workRef 和指定版本提示保持不变。生产 `/knowledge` 以 `Win7` 只读查询同时返回 787 工作16和 777 工作12，分别显示 STALE/CURRENT 覆盖状态、精确问题键与根来源；展开 work12 显示“始终读取所引用的确切版本”及完整 15 项未读参考限制。再按同一代码路由进入 `MAT-26b…?panel=materials&sourceWorkRef=MWREV-75632e5d…&sourceIssueKey=claim_maintenance_disruption_risk_under_win7_hypothesis`，准确读回工作16、Win7测试前提、likelihood=null、NOT_CONNECTED可靠性限制及候选/非正式决定边界；刷新后精确三元身份和正文保持。全程未登记引用比较、未启动模型、未保存或正式采用；这组证据闭合 Wiki/知识页读取与刷新返程，不扩大为后台来源已接通。

## 2026-09-16 c110 正式安装、Trinity 真实读取及精确返程接通

前端Trinity提交3b1d462669d7b3b422a53d1259ee636de65d72e6（父b37ee95f9）已由正常hook提交，origin/github同名codex分支均普通快进并核验同SHA；29文件精确范围，未纳入本文件、私有诊断、根zip或dist。release7686068790493301966已finished，commit_id=3b1d46266，online_url仍为既有17b应用。正式登录线上已读取真实候选：时间轴完整显示10条资料/厂家声明，其余三泳道明确为未接入而非0；从DAS-8f6c4005…进入图谱保留同一statementId，选择引文后准确增加anchor=a73，返回时间轴仍保持同一声明/锚点；再进入原文页定位u75文本“Root Cause Established: N/ A”，返回链接仍携带原candidate/run/parse/DV及timeline视图。该验收证明当前保存候选的时间轴—图谱—原文身份与返程闭合，不扩大为完整三视图业务验收或正式工程结论。

唯一后端Luna回执：c110官方安装turn7686052484787342305 completed/queue0，FileService /1876477642411050.zip与425945字节及SHA一致；53/53文件字节一致，仅额外.source-origin元数据；Ready/model-visible/command-available均true、missingRequirements=0。六cron disable/install/enable后完整配置drift0且后续lastRunStatus ok。报告workspace/wiselink-uat/r09c110-install-report.json。后继只读turn7686060105113013467 completed/queue0：新版777FTD document_version_78c6d0adb612265f85e1d338 当前published PRUN-9e7cd784-92bb-478d-b34f-ae56fd53e087/parseRevision2/semantic1；初始nextActivityRunRef=null。准确section:u73 Milestones，u73 heading+u74-u83，PDF页2。

随后按M接受范围恰好一次ACTIVITY_BEGIN及一次官方Hosted模型调用（miaoda/minimax-m3）：run DAR-32c3dfc2-8d68-49c0-9a80-84d69466eead，selection仅上述u73章节，读取u73-u83共11 units/11 anchors，a71-a81均PDF第2页且unresolvedRanges空；保存SAVED/candidateRevision1/candidateOnly=true，10条statement，errorCode=null。未重复BEGIN、未重跑模型、未换run、未FAIL，也未触发翻译、Overall、正式采用或扩额。最终只读turn7686066953119550413确认两次STATUS/READ整包一致，SHA256 0d9cb5b3a44c166cc2a1ed5105f4b0be0835e8a74725c93497a6675fd800e837；10/10 quote用真实sourceText区间校验通过，time.raw与对应quote一致，11/11 SourceRef可解析至u73-u83/PDF第2页。脱敏文本比较曾给quoteChecks假阴性，已由真实区间校验排除。该结果是候选与来源完整性证明，不是正式工程结论。

M已修F1真实可读与完整范围隔离，并完成参考CSS字阶/几何/材料修订。实际同组件+隔离fixture在同一浏览器标签、DPR1对照：1600主要框架及ringcard 1011×677.4844一致；1440 pagehead x226 y77 w1175 h67.35156、ringcard x226 y322.85156 w851 h609.57031均与静态参考相等；390深色实际scrollWidth390无横溢，主要内容视觉边界约1px差。手机core、导航、列表和双环替代布局已修。共享壳账号/当前路由为隔离mock，不把它当生产验收。之前rawCDP缩放截图无效不作为证据，已clear。

生产态势页已在正式登录会话读取并截图：宏观页显示八业务环、六知识环及中心工程智能体；目录仅取得2个事项时，总体/条件/知识/效果指标保持“—”并说明范围不完整，只有分析与评估显示已取得2项关联。切换聚焦事项进入MAT-d9e6c294-f368-42e4-9a1b-b46c6170be02准确URL，事项标题和问题来自真实保存工作，分析与评估仅显示1项；机型/ATA/复用范围仍保留未核实。该结果证明已发布态势组件与真实读取的范围边界，不代表生命周期后段业务已接入。

同family正式换版只读turn7686070351278050252已terminal/queue0。OLD document_version_6b998c1544aa06b5f20b2be0当前published PRUN-ea9543e4-1c2c-4f21-b989-963ca71e875b/parseRevision2/semantic1，NEW document_version_78c6d0adb612265f85e1d338当前published PRUN-9e7cd784-92bb-478d-b34f-ae56fd53e087/parseRevision2/semantic1；同profile、同family，nextActivityRunRef均null。ftd.revision_description为TEXT_DIFFERENT：标题相同、说明正文从“Update Status, Milestones, and Operator Action Sections.”变为“Update Status and Milestones Sections”；ftd.milestones前6行相同、后5行变化，生产纳入行扩展且三条SB与Parts Available状态/时间文字变化。两端均5页全读，所选SourceRef在PDF page2；覆盖诊断OLD20/NEW21保留为TEXT_CONFLICT/FIGURE_UNINTERPRETED。双向compareWith镜像一致，publicationRelationship仍NOT_VERIFIED、assessmentCoverage仍NOT_RECORDED_BY_THIS_READ。线上/document-revisions以两端DV自动固定上述parse/semantic，实际显示发布方改版说明差异、各端准确原文链接和同样的未验证/未覆盖边界。全程无模型、BEGIN、SAVE、Overall或正式采用。

后继事项准入采用只读而未先生成。最小STATUS turn7686075928338549967确认next_matter_assessment.next=null，当前无待办、在途、排队或恢复中的Matter评估；最新attempt仍为已成功的AQ-45bda7aa04624fcb89d64d766affcba5。空闲STATUS不返回current work/input字段，READ_SAVED_WORK必须使用当次SAVE_WORK的JA-save requestId；触发级wl-work8-overview-citations-20260916精确读取返回null。进一步只限该attempt读取checkpoint、结果与两份官方日志，实际JA-save requestId已不在可用证据中且日志零命中，因此没有猜测或重放。既有线上工作9/MWREV-8a870911-3c66-42e3-9ec4-939f9ce0b8ae及其准确页面读回继续有效，但本轮不能仅靠空闲STATUS重新证明其current inputs/coverage/referenceWorkNotices。因为新版DV此前已作为该事项成员触发真实评估并形成后继工作链，且当前无pending，本轮不为补证强造另一版工程工作；后续参考变化需用可追溯新输入或正式保存入口另行验证。

F2 projectAuthorizedSituation adapter读取真实directory与focus working：仅保存分析可证明assess关联，不推断正式/实施/效果；完整范围未知维持partial，复用数量未知；精确workRevision进入同一保存正文，6测试通过。EngineeringSituationPage保留身份、CurrentObject、分页、实际INCLUDED非EXPECTED来源选择。Astra接受F1/F2。M注册/situation与matter/posture新版页面，Sidebar新增态势/时间轴。

M重写EngineeringTimelinePage，严格DV/parse/run/candidate及session身份栅栏，旧响应不得跨session覆盖；statement/anchor只作同一候选选择，不重读或卸载图谱。日期原词保留不伪造坐标，四业务类中仅材料有本DTO记录，其余未知。/timeline与/activity-graph共享准确读取及返回；目录上下文只放嵌套returnActivityQuery，避免顶层互斥冲突。10项实际mounted测试覆盖session延迟、URL选择、S2/A2双视图往返、同候选零重读及目录返程。图谱节点按DV/parse/run/revision隔离，共享anchor/SourceRef去重但逐quote关系不丢，SourceRef不清空选择，可读明细只显示保存的statement→quote→anchor→SourceRef；headless Cytoscape实际加载验证无ID碰撞。Astra最终接受该代码范围，客户端类型、受影响源码eslint和CSS stylelint通过。时间轴/图谱完整参考视觉及生产真实候选页面验收尚未完成，不能称Trinity整体完成。

## 2026-09-16 c110 接受与 F1 覆盖隔离修订

后端SDK最后差异已修：实际@modelcontextprotocol/client v2采用callTool第二参数，官方fallback v1采用第三参数，由loadMcpSdk确切分支传递，不猜function.length。实际Host MCP HTTP互通追加150ms HB/25ms signal中断回归，明确收到FIXTURE_ABORT；同一options携带75ms timeout，但此断言单独证明signal，不冒称已触发timeout。互通1/1和四消费/模型套件85/85通过，Astra最终定向复审无必须修项。

c110正式提交b37ee95f99e98c50ac29560fd5edeb93af0f4c41（父6a448dda），精确Skill15文件+Host互通1文件，正常hook及双远端同名SHA核对。官方包/private/tmp/wl-c110-accepted/wiselink-research-and-synthesize-r09.c110.zip，425945字节，SHA256 ae4298ac98d3b1f60184ee1d0f9e6bb23030d16281e4d409c45ca644223118bd；53文件，打包内置完整Skill测试passed；manifest SHA256 6f7f093f7c58c5fefcbd4ae310a9e03e0cdf3ef99b9a9d0b6d3d18a4d4882ca0。已交唯一后端Luna按官方路径安装并保护六cron原配置，先核对quiet，再安装逐文件比对；尚未收到安装回执，不得声称已安装或启动真实活动候选。

前端R1仍被独立复审发现data旧focus泄露与独立knowledge/events coverage未执行，M已修可读/完整范围helper、独立数据过滤、partial总数未知、focus拒绝后清内容/候选、高亮及真实来源标签；42项定向测试通过。原Luna继续仅10文件视觉修订。实际同组件本地预览已改用生产index.css/postcss；预览补工具包@/inspector.dev.css确切路径alias（仅临时配置，不修改生产）。M同浏览器1600x1000对照原静态页：固定壳、306右栏、1000/610环几何一致；关注6项应3项，面板730高vs677参考，旧tokens控件边界/圆角/阴影/字阶仍不符。正在按参考精修，尚未视觉接受/注册生产Trinity路由。浏览器临时DPR/viewport需结束前恢复；backend操作原标签不由M并控。


## 2026-09-16 Trinity 框架与后端 B 独立修订

共享壳6文件提交6a448dda6c004c74de0d006cd18b43d7bb8c7c12（父a3680828）正常hook与双远端同名SHA一致，尚未发布。按Trinity框架202px/58px/24px、四档响应式断点和中性主题材料调整；真实内容区独立滚动，useReadingLocation对应恢复/捕获同一容器。client类型、源码eslint、CSS stylelint通过，4项导航及2项实际挂载滚动回归通过；本机CUA隔离实际Layout/Sidebar/TopBar确认1600/1440几何、390无横溢及导航开关，不冒充整页或生产验收。隔离预览/private/tmp/wl-trinity-shell-preview，127.0.0.1:4179；最后server session40943。初始Vite未捕获工作树事件导致品牌旧图，重启后已读回最新SVG/背景#303439；后续采用polling。

F1十文件现成包trinity-source-handoff-aad3937b.tar.gz已取回（21122字节，SHA256 2c02d185807acb36cfac10bdc1a83592ac08bd830609e6fbcb2e34153ded2f8c，cloudbase aad3937b）。原F1因单轮调用上限提前结束，后继仅导出现成代码；最后交接turn7686043387812318136 completed/queue0。Astra确认双环几何/受控组件主干可复用，但需补未知数据仍保留框架及availability、精确token、资料库目标、来源标签和去重。已明确由原前端Luna在本canonical仓仅修10文件，M独占共享壳；不新cloud开发、不扩额，测试改现有JSDOM方式；尚未接受或提交F1。

后端完整8文件增量130043字节/SHA256 dc0fe56b8c2778c2c0171b677c78cc71ad515da573f55a3c199ba7a3db188cb7已核验重建。Astra初审58项原测试通过但5反例证明unknown-model伪成功、期限/HTTP timeout失效、model.result落盘失败误FAIL、READ绑定不足和空声明schema冲突。M已选择性取入canonical openclaw源码并修订，85项定向测试通过，含未知恢复/ENOSPC/挂起heartbeat/过期deadline/请求timeout/schema/MCP选项。独立复审发现实际MCP v2 callTool(params,options)与Hosted v1三参数差异仍需修，不接受安装。新增test/node/document-activity-consumer-interop.test.mjs实际Host来源选择/runtime+SDK MCP/HTTP+gateway HTTP+磁盘checkpoint互通通过，精确12 kPa表格引用、覆盖诊断保留、恢复零第二模型；repository为内存fixture，不称DB或生产验收。后端改动未提交/未安装，17c保持c109运行，未触发真实ACTIVITY_BEGIN。

## 2026-09-16 活动阅读发布与真实空态验证

F2接线实读定位：directory合同shared/api.interface.ts:3097仅分页items/nextCursor，无global total或生命周期；现有useMatterDirectory以matterId去重，但跨页不构成原子全局快照。宏观不得将已加载数改名总体或用updatedAt制造业务事件流量。working合同shared/matter-working.interface.ts中的current包含准确工作修订、createdAt、problemWork、coverage、overviewSourceWork和referenceWorkNotices；可链接已保存工作及核查事项，不能从DONE/保存/正文推断正式颁发、实施或效果。KnowledgeLookupPage当前复用EngineeringIssueSearch，SavedAssessmentReading直接读取AssessmentReadingResult，下一接线应保留同一工作/问题/来源身份，不另建Wiki生成链。这是代码定位，未实施F2。

活动阅读10文件正式提交42758156b9a1c692399a0abab8a796ebffeaf0c5（父916b16b28040afed0002ed8780513990a8c3b2df），正常hook及origin/github同名快进核对通过；发布7686034475856678114最终finished且commit一致。随后4份Trinity对齐文档提交aaf353ffb68a11f7e48d3885ce5e0da715dd92e1并双端核验。

真实登录页面从787-FTD-45-25001_Doc_05082026.pdf进入活动阅读，文档document_version_b83523c2b5ba26a2b1753641与解析PRUN-c537f5bb-cc97-4ce9-855e-ca8d53e15a31绑定保留，正确显示未保存候选；没有启动模型、解析或翻译。缺少runRef的candidateRevision=1查询被拒绝，但线上暴露重复错误卡。M补effect入口早返回，6种非法查询的实际React挂载均断言只出现1个alert且零读取，22项交互测试与Page ESLint通过。2文件正常提交a3680828bf12846cedf49d12332d59ac1e715578（父aaf353ffb），双远端精确同名SHA核对；发布7686038372461104411最终finished且commit一致。线上重载同一非法查询，getByRole(alert)只返回一条准确拒绝提示；恢复有效parseRun查询后，未保存候选空态及family/parse绑定保持正确。

当前仅验证真实入口、空态与非法绑定；真实保存候选往返仍待后端A+B完整材料审查、正式安装及授权运行，Trinity视觉仍待F1结果，不以这些检查冒充完成。

## 2026-09-16 活动阅读本地集成与 Trinity F1 派发

M 已核验并 fetch 前端修复包 aad3937b（父8cdf5098，8040字节，SHA256 d3b87ffebc8c946d52c82ad82bd6d20f2e19365d20260400f3d4d33c08bd58ea），按八文件范围选择性取入。Astra复审确认候选成对参数、实际点击声明/锚点的精确返回和全部锚点展示；M补同时显示页码与unitIds、覆盖诊断使用中性文案，并注册/document-versions/:documentVersionId/activities生产路由。64项定向测试、客户端类型、受影响源码ESLint通过；测试文件受现有lint忽略，不声称测试lint通过。Git协调员准备正常提交与双远端同名同步；尚未发布，不将本地测试算真实往返验收。

Trinity F0已实读当前壳/态势与新设计，确认旧Matter中心认识卡需要职责重构。原17b唯一Luna已收到F1同组件视觉纵切范围与19文件材料包，2670392字节/SHA256 cec65d9251a47d602c7ce57da837e047478363525693dae93f0e7dac6169cfc2，含完整规范、原型、两CSS、几何/状态及6关键截图。共享路由/全局壳/Provider/API由M协调，F只新增展示组件及隔离fixture，实际受理与视觉验证仍待阶段回执。后端17c同一隔离B turn7686018873015798771继续由唯一Luna跟踪，不重复派发、不动c109运行目录。

## 2026-09-16 后端运行目录隔离与 c109 恢复完成

M 在已登录的原 17c 终端确认六项启用任务均调用开发所用的已安装 Skill 路径，目录内已有 A/B 修改；未执行安装命令不能作为没有运行影响的证据。完整 54 文件开发快照与六项原配置已保存在私有 `tmp/wl-activity-runtime-recovery-ao2p7_xa`。暂停原六项任务后，全部状态无在途且消费者进程为空，再通过官方 `skills install --force` 恢复 c109。恢复包 392025 字节、SHA256 `c105c257d672f3660729644df67e5405d862a1c316788737167f445b3b47d2c9`；48 文件逐字节一致，仅有安装器元数据，336 项 Skill 测试通过。

六项任务已全部恢复原 enabled=true，命令、完整 payload、调度和其他配置逐字段一致；比较排除了更新时间与实际运行状态。一次差异为备份时的 status=running 后变为 ok，已确认是运行状态而非配置变化。保留的开发成果已复制到同一私有临时目录下的 `development-work`，后继仅在此隔离副本实现，安装目录不得作为开发工作区。未触发新业务、模型生成或重做中文。原开发 turn 已 cancelled；登录恢复后已在原会话界面撤销两条过时审计消息，官方读回 queue=0、cancelled。恢复完成不等于后继活动消费者准入。

前端八文件 bundle 已本地取回并核验，Astra 独立审查发现半套候选 pin、来源点击返程选择、未引用锚点遗漏和范围明细缺失四组问题，已交原会话 turn `7686002403955215290` 窄修，尚未纳入 Host 或发布。

## 2026-09-16 活动阅读 T1 云端阶段交付

前端原会话提交 `8cdf5098f77a2d94d9e73fbb32290c16cf153f89`，父提交 `916b16b28040afed0002ed8780513990a8c3b2df`，范围为活动阅读 Page/View/入口参数 helper、原文页和返回参数，以及三份定向测试，共八文件。云端正常 precommit、51项定向测试、client 类型及 lint 通过；依赖清单的意外变化已恢复，最后修正轮 `7685998191481179336` 已完成且队列归零。27104字节增量 bundle 已在云端通过验证，尚未取回本地。传输动作首次遭自动审批拒绝，补充当前协作授权与同一原会话、八文件增量范围后复核已获批准，交接 turn `7685999307493100481` 已受理且队列为零；包 SHA256 为 `eb7e7b83be0d6f020b25df42c0bc9fcf54e7115c3e27d4ec17c5e08fa2b6b340`，正在取回。本地选择性集成、独立审查、路由注册、发布和真实往返均尚未完成。

## 2026-09-16 后端运行目录待核实

准备后继 Skill 安装时发现，A/B 开发目录与历史 c109 安装目录同为 `/home/gem/workspace/agent/workspace/skills/wiselink-research-and-synthesize`；历史六项原生 cron 调用其中消费者。虽然未执行后继安装命令，不能据此认定这些修改没有影响运行。B 生成 turn `7685987918099925994` 已官方停止为 cancelled；路径解析、当前 cron 命令与在途运行尚待现场核对，尚未完成隔离备份或 c109 恢复。唯一后端操作员正在检查原会话 UI，以消费两条已知审计指令；不得继续 B 或追加重复指令。后继开发须使用与运行目录分离的工作副本。M 提供的原开发路径未充分区分运行目录，后续结果以现场核对为准。

## 2026-09-16 改版入口正式发布与真实往返

Host 提交 `916b16b28040afed0002ed8780513990a8c3b2df`（父 `7c86becb`）正常 precommit 通过，精确十文件，origin/github 同名开发分支均核对相同 SHA；发布 `7685984083713919980` finished，最终提交一致。真实登录页面从目录选择 777-FTD-31-21002 的 2025-09-26 与 2026-05-27 版本，发现并固定两端 parseRun 和 semanticRevision=1；修订说明比较为 TEXT_DIFFERENT，旧版原文 u9:p0 打开后返回同一组固定版本、同角色及 before 来源侧。切换 ftd.milestones 保持版本参数，原始日期/状态完整显示，返回目录保留 family 选择。修订说明请求约4秒，里程碑请求约75秒后 HTTP200并完成显示；未重试生成或启动解析。另发现新路由面包屑缺名称，已本地补映射，随下一前端集成发布。

后端 A 最终三份增量已取回，29 项目标测试通过；Astra 接受严格 STATUS/CLAIM/SAVE 回执与完整来源绑定、SAVE未知恢复、明确旧run恢复和非负UTF16坐标。M实际Host runtime互通以构造模型proposal保存真实fixture表格quote通过，属于离线互通，不是正式模型运行。已交 B 真实官方transport、持久checkpoint与全程心跳接线；T1已保存活动候选阅读同步开发。尚未安装后继Skill或执行真实ACTIVITY_BEGIN。

## 2026-09-16 改版生产入口本地准入与消费者合同复审

前端入口 `01cf6c13f7a9b321f5697b55a573185db60376b8` 及修复 `57888579961ddcbf185144187d0af8d7285d90bc` 已核验取回，按七文件范围选择性集成；未整合云端历史或平台无关修改。非法/重复版本参数先拒绝，来源返回要求两端完整版本参数，角色选择持续可见，进入比较前保存目录位置。M 补充发现结果与当前 URL 身份绑定、按版本/角色/会话隐藏旧结果、隔离迟到请求及独立加载态，并注册 `/document-revisions`。Astra 复审通过；31项入口测试和4项真实组件异步交互测试通过，client 类型及定向 lint 通过。云端修复提交使用了 no-verify，正式本地集成必须走正常 hook。当前尚待本地提交、同步、发布及真实页面往返验证。

后端 A 四文件补丁已完整本地取回并校验，以实际 Host runtime 和原文 fixture 完成表格引文候选保存互通；此为离线构造模型输出，不是实际模型运行。Astra 仍要求修复 SAVE 后恢复查询失败误 FAIL、STATUS/CLAIM 早返回执校验不足、显式旧 run 被新 pending 阻断及负引文坐标校验四项。已由 17c 唯一操作员执行窄修；B 批真实 CLI/官方 transport、持久 dispatch/结果 checkpoint 和全程心跳仍待接入。未安装该包或启动真实活动候选请求。

## 2026-09-16 独立来源声明技术发布与线上空态读取

活动运行提交 `7c86becbce15960a9cb9604534f0359591629e28` 已在 origin/github 同名开发分支分别核对一致；Host 发布 `7685958744836279254` 已 finished，最终提交相同。正式登录浏览器读取既有准确文档与解析的 activity-reading 返回 HTTP 200，原件绑定逐字段匹配，返回实际 familyId 与 `candidate: null`。该结果证明新接口在线且未保存候选的读取正常，不代表原文没有活动，也不代表真实模型候选生成已经完成。

OpenClaw 消费者实现与前端生产改版页面仍由对应单一 Luna 操作员跟进；下一批候选阅读先闭合准确候选与原文往返，技术历史及隔离样例不充作真实活动历程。隔离 PostgreSQL 验证实例已正常关闭。

## 2026-09-16 独立来源声明 Host 实现

M/Astra 已实现独立活动声明候选合同、精确原文锚点校验、运行与保存表、显式 `document_work ACTIVITY_*` 动作以及浏览器只读接口。源声明不依附 JobAid/work.v3，不需先生成评估问题；模型没有来源绑定、覆盖或正式关联的写权。来源、租约、CAS、原请求恢复、终态不可变和浏览器读写边界均保持。Astra 独立审查未发现必须修项；M 补充 READ 回执写入行数核验和保存结果数据库绑定约束。

四套定向单测90项、隔离 PostgreSQL 六项（包含父测试）、实际 MCP HTTP 清单兼容与分发测试通过，双端类型、定向 ESLint 及服务端构建通过。0058 已在妙搭开发库事务创建并读回；生成器只保留新活动表到独立 schema 文件，未纳入无关自动差异。官方迁移已应用33项新增表及其约束/策略/触发器/注释；线上读回27列、RLS=true、七条策略、一个业务触发器、外键全部已验证，估计行数零。Host 代码尚待发布，未启动真实候选请求或安装后继 Skill。完整接口及剩余范围见 `docs/WISELINK_DOCUMENT_ACTIVITY_IMPLEMENTATION_20260916.md`。

前端接受组件提交 `934f74e3fd5fa2a03dc60c6fa38c495a0c863ee5` 已双远端同步；Git 协调员因并发后端类型错误跳过了该次 pre-commit，M 已要求后续遇此情况先协调，不自行跳过。该组件此前经 M 独立 client 类型/ESLint 和 Astra 评审通过，后端类型错误现已修复。生产目录与准确版本往返批次已交原 F 会话执行；尚未将纯组件记为完整生产功能。

## 2026-09-16 前后端首阶段审核

17c 原开发会话的 T1 方案调查已完成，官方读回为 completed、无在途及排队；未改变业务、配置或安装，仅在临时目录生成调查报告。M 已直接读取完整方案。接受沿用既有工作受理、保存与原请求读回链的方向，但尚不接受其活动声明字段为实现合同：需拆分时间含义、精度、未定状态与条件；模型 key 仅为候选身份；原文字面和阅读范围由 Host 校验；源声明、评估工作与跨版关联不得混为正式事实。Astra 正结合 Host 实码确定接收及读取位置，尚未实施或安装下一版 Skill。

17c 官方 cron 列表观察到六项 enabled、状态 ok；UI 显示零项的具体数据源仍未核实，不能将迁移文件视图的推断当作根因，也不据此修改调度。

前端两文件初审发现已返回表格被占位替代，以及诊断被混作未解析限制。修复包 `288fc3d37c8eb0cce633034cb874968e7c3f8b7a`（父 `eeb8f53a`）已核验并选择性集成两组件；M 补改复审发现的最后一句选择汇总旧文案。表格正文、单元格合并及段落换行正常保留，诊断/限制/未标注逐项显示；集成后定向 ESLint、client 类型检查通过。该批尚未发布，生产目录选择、准确版本 URL 与来源返回接线继续由 F 实施，不能将纯展示组件视为完整生产交付。

## 2026-09-16 后端/OpenClaw 开发协作调整

按用户最新要求，后端增设 Astra（中等推理）审查/合并/计划角色及 Luna 妙搭操作员，控制目标为既有 `app_17c3zn24kv2`。Luna 首先核对原会话、源码与在途状态并回传，Astra/M 确定实际后续批次后再由 Luna 操作执行；M 继续协调跨端范围。前端 `app_17bzc551rsg` 原有操作/审查链保持独立，Host源码来源和现有运行、权限、发布边界不迁移。

Luna 已核对 17c 原开发会话无在途、无排队任务；Hosted 页面 Gateway Online，但开发源分支/SHA 尚未知，不能借用 Host SHA。Astra 已形成并交给 Luna 首个只读批次：T1 活动声明候选合同、真实受理/生成/保存/读取调用链、持久存储复用证据及最小 patch 计划；同时解释 UI cron 数量与历史记录的差异，不先修改配置。当前尚未派发新的后端实现、安装或业务运行。已有 Host 读取发布和真实验证沿用下文；不自动继续历史排队开发消息或重复评估。阶段结果经审核后按准确文件范围合并，不把平台自动修复当作整批准入。

## 2026-09-16 术语发布与语义索引接入

术语提交 `eeb8f53a963a217eb869bad2636afd0c1f13cfb9` 已双远端同步，Host 发布 `7685933801767619557` finished 且最终提交一致。线上 T1 显示“改版比较”，T2 刷新后显示“SB-A 改版历史”，原 Q4 选择保持。Luna 已接管原前端任务并通过官方原会话接口完成方案派发和结果转交；当前后继为生产结果展示组件。构建页的发布成功提示已按官方历史核对属于 M 的在途发布，没有额外发布记录。

M/Astra 与 F 独立核对一致：目录已提供同 family 候选 DV，解析状态可取得准确已发布 parseRun；浏览器缺少已保存 semanticRevision/roleKey 的发现入口。M 补充只读 semantic-reading 与客户端函数，返回实际 family/binding/coverage/map，未保存语义为 null；可选择准确历史语义修订。沿用浏览器身份/RLS和读取后 ACL，不调用 ensure，不加载所有候选原文、不猜修订1。三套82项测试和双端类型检查通过，定向 ESLint 通过。

索引提交 `010d6356c8d784bbdf21532df5fc5d4340a7d4e8` 已双远端同步，Host 发布 `7685936850897406923` finished 且最终提交一致。正式浏览器对两份真实原文分别发现已保存语义，均返回 HTTP 200、同 family、semanticRevision 1、21 个章节与10类角色；再固定实际返回的修订读取也均为200。逐字段核对语义绑定与原文绑定无差异（JSON 序列化键顺序不同不作为数据差异），准确 SHA/字节数保持原件记录。该证据补齐索引真读，不证明正式版次顺序或工程覆盖；生产入口与来源返回仍由 F 后继接线。

## 2026-09-16 T1 样例接受与前端操作员交接

经 Astra 审阅，M 从前端 `b2de672f6226f08d6b515923df2436c0f7970ab6`（父 `7b176d8e531bc9d201a769a8a5d21aa4dff14301`）选择取入 T1 的四个组件/样例文件及一份定向测试卷，恢复 `/dev-preview/chronology` 路由。没有整分支覆盖，T2、server、平台升级及会话计划均未纳入。已交付读取的说明、比较目标文案、空数据和无效 URL 清理均已修正；M 将 case1 的通用免责声明断言与 case4 的 TEXT_EQUAL 逐字说明分开，避免测试描述与默认样例不一致。

F 实际完成双端类型及六条定向浏览器验证（含三个空数据 fixture）；M 集成后的客户端类型与受影响 ESLint 通过。集成提交 `7df22f4f0709ebb9a2612db814a635b00785d502` 已双远端同步，Host 发布 `7685932065007291328` finished 且最终 SHA 一致。该批是同组件隔离样例，生产视图与真实业务仍未接入。用户指定 Luna 负责原前端构建会话操作与阶段结果回传，M/Astra 负责审查、选择性集成和下一批计划，避免多个执行者并控同一会话。

按用户最新术语要求，主控已统一改用“改版”：14 份源码、文档和测试说明共替换82处中文术语，英文 API/类型标识保持兼容。逐文件核对仅作对应文字替换，JSON 解析与 diffcheck 通过，不因术语修改重跑业务或模型。前端后续方案同样采用新术语。

## 2026-09-16 改版 HTTP 身份修复与真实读取

Host 发布 `7685928474716589252` 已 finished，最终提交为 `8295cd20b0a22b387ecf8b3bbd964a2ebd87db3e`，origin/github 同名开发分支已核对一致。真实浏览器请求原先因共用服务误入 Hosted 专用 SQL actor scope 返回 404；HTTP 已改用经原登录/对象 guard 的浏览器请求身份及 RLS，MCP 仍保留 Hosted actor scope。两端来源授权、精确绑定、同 family 与返回前回查未变。三套17项测试、server 类型及定向 ESLint 通过。

正式登录浏览器按现有客户端 CSRF 规则发起只读请求，发布后 `ftd.status` 返回 HTTP 200 / TEXT_DIFFERENT，`ftd.final_action` 返回 HTTP 200 / TEXT_EQUAL；后者逐项确认两端 DV、parseRun、semanticRevision=1 和原件 SHA/字节数，各端修订说明均为一组。首次发布后调试观察超时，浏览器资源记录确认该请求已经 200；随后完整读取内容，不将观察超时记为业务失败。没有改动页面内容或身份设置。

正式安装 c109 的真实 MCP 三次调用也已通过：Status 不同、Final Action 文本一致、Reference Categories 为 NOT_COMPARED / NON_PLAIN_TEXT_CONTENT。此轮仅验证读取，未新增模型请求、重解析或工作保存。HTTP/MCP 均保留 NOT_VERIFIED 的正式版次关系和 NOT_RECORDED_BY_THIS_READ 的评估覆盖。生产改版视图、完整活动/声明历史及完整改版业务验收仍未完成；T1 修订由 Astra 对接原前端会话，尚未集成。

## 2026-09-16 改版读取修复版技术发布完成

Host 修复版发布已 finished，完成态精确提交 e5cdf5b96b78d2208ac28c6d0d5912051f3f9851，与 origin/github 同名开发分支一致；新增独立工具名已撤回，使用既有 read_document_original 的 compareWith 模式，未修改已安装 c109 或工具清单校验。

官方 online 只读 SELECT 已取得两端精确 parseRun 的已保存 semanticRevision 1，绑定 manifest SHA 与此前下载原文一致；两份保存结构与此前本地派生结构逐字段一致，代入新比较器后各角色比较结果一致。该证据确认当前真实持久数据，仍不是线上 HTTP/MCP 调用验收。Hosted 浏览器刷新后进入飞书扫码登录页，已请用户在原标签登录，未新建/重放评估、未启动旧排队开发消息。待恢复登录后做同一只读调用验证；前端生产改版视图、T1/T2 完整真实流程及后续业务目标仍未完成。

## 2026-09-16 MCP 清单兼容修正

准备真实调用时核对已安装 c109，发现消费者严格校验工具名清单，因此新增 read_document_revision 会造成连接拒绝。已将比较移入既有 read_document_original 的可选 compareWith/roleKey 模式，旧单端调用不变；两端模式要求准确 semanticRevision，拒绝分页或 sectionId 混入。未放宽客户端清单校验、未改安装 Skill。实际 Host MCP 注册经本地 HTTP transport 与 c109 validateHostToolMetadata 联合验证：34 工具清单匹配，单端和两端调用各自正确分发，三类混合/缺失选择拒绝；服务端构建及类型检查通过。此前 57ff 技术发布已完成；需随本修复再次发布，才能恢复该消费者兼容性。当前浏览器 Hosted 登录过期，真实 MCP 读回等待用户扫码；此处不声称线上业务验收。

## 2026-09-16 改版读取接入工程消费者（本地已验证，未发布）

在已双远端同步的 a69260e3c 基础上，同一 DocumentRevisionReadingService 接入既有 DocumentWorkRuntimeService 和既有只读 MCP `read_document_original` 的 `compareWith` 模式。MCP 对 before/after 分别执行 authorizeDocumentWork，要求实际 tenant/actor 一致及授权 DV 精确匹配，再走统一服务的原文、语义和返回前权限复查。HTTP 与工程读取共用实现；没有第二套比较器、模型调用或业务保存。三组 15 项定向测试、服务端类型和接线 ESLint 通过，含双授权身份不一致拒绝；原客户端类型已通过。

## 2026-09-16 同 family 两端原文读取（本地已验证，未发布）

新增共享改版读取合同、纯比较器和 Host Service，接入现有受登录保护的文档 Controller 与客户端读取函数。before/after 都要求准确 DV、parseRun、semanticRevision；分别读取原文及已保存语义，校验同 family 不同 DV，并在返回前再次核验两端权限。GET 不生成语义、不调模型、不选择当前正式版、不写评估覆盖。返回两端各自的出版者修订说明、所选角色及父级条件、未选单元和原始覆盖限制；不把旧版自身说明误作本次两端的 diff。

系统比较只处理所选纯文本及父级条件的空白归一化相等性。表格、角色缺失/重复、结构歧义和相关未读文字保持 NOT_COMPARED。全局图示未解读限制继续返回，不伪装图文完整相同，也不禁止已有明确范围的纯文本比较。厂家最新、相邻版次、修订跨度和正式采用没有由本接口证明；本次读取不产生新版评估覆盖。

基于已下载真实两版原文、本地派生语义图的算法核对与 P 的逐页文本核对一致：修订说明/Status/Milestones 文本不同；Applicability/Description/Interim/Final Action/Operator Action 所比文本相同；参考表保留结构，系统不作纯文本相等判断。该核对不是线上接口读回，也不是已保存语义版本验收。8 项定向测试、两端类型检查、定向 ESLint 通过；Luna 只读审阅未发现注册、准确绑定、权限或本批公开内容阻塞。生产改版视图接入、Host 发布后真实读取及完整改版业务验收仍未完成，F 接线参数已补在前端对齐文档。

## 2026-09-16 T2 与引用修正发布及线上交互

8710aff7cb1190d1ee6497e7a67d605e216619a7 已分别普通快进同步 origin/github 同名开发分支并核对远端SHA。Host发布7685899993270570254已finished，完成态commit与源码一致。线上 `/dev-preview/graph` 正常渲染；主控实际打开2025-Q4来源示意并返回，URL与选中声明均保留Q4，截图确认关系图节点/连线/高亮显示正常。此处仅验收隔离交互，不代表真实来源读取或活动关联合同已交付。

发布后，以仍为工作8、事项修订2、无在途为基础，正常MCP受理新请求wl-work8-overview-citations-20260916，AQ-45bda7aa04624fcb89d64d766affcba5由原cron于23:13:43.362Z领取。沿用同一准确来源与更正目的，新Host明确引用规则；旧AQ-6bc及AQ-350不重放。23:14:55.977Z正常结束SUCCEEDED，事件为STARTED→GENERATED→MATTER_JOBAID_WORK_SAVED，保存工作9（MWREV-8a870911-3c66-42e3-9ec4-939f9ce0b8ae）。主控比较工作8/9：六个问题逐字段完全相同、完成状态相同，综合CURRENT；其他参考统一为15项，FAA LN1825不再断言仅该架次完成，删除无实质变化的轮次叙述，三处完整引用均为本次交付的确切原文。完成说明同步更正。真实页面精确workRef读取显示工作9与对应overviewSourceWork，后续保存链接准确；未作正式采用。

## 2026-09-16 综合生成引用失败与 T2 选择性集成

新 AQ-6bc32de118ce4891a4bc22e8baa9397e 于22:55:00.163Z终止FAILED，terminalReason=ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED，仅STARTED、无GENERATED/SAVE。官方插件日志确认textToJson正常返回（40,022ms），输出日志本身被平台截断，无法据此恢复完整候选。旧错误码同时覆盖零引用与引用未交付来源，不能断言具体是哪一种。实际封存输入的综合/完成说明没有引用，问题正文有46个引用，其中43个不在本次3段已交付来源内。输入已说明问题是待核对认识；本次进一步明确仅evidence中的完整引用可用，并须在更正事实旁提供引用。Host保持来源集合校验，将零引用单独记为CITATION_REQUIRED，未增加重试或放行。26项单测、服务端类型、定向ESLint通过；旧失败不重放。

前端9fb的7个client文件及必要chronology-samples依赖已选择性集成，排除服务端schema/浅转换和平台升级。修复条目+声明URL恢复、图节点保留具体声明、隔离来源示意准确返回；不以假ID调用真实Reader，也不写生产readingReturnTarget。500飞行小时条件标为TARGET。3项React DOM/MemoryRouter交互测试、client类型和定向ESLint通过；主控补充JSDOM 26.1.0为锁定开发依赖，避免测试依赖临时NODE_PATH而在正常安装后失败。主控审阅完成，本地浏览器访问被ERR_BLOCKED_BY_CLIENT拦截，视觉验收仍待完成。T2真实来源/关系合同和T1活动声明生产仍未完成；样例不冒充业务验收。

## 2026-09-16 Host 获授权发布完成，新综合更正已领取

用户明确授权后，原Host发布7685891700875627460已finished，实际commit为8fb9cd7d7f86c41501e5506c3e795166e90bf73f，与origin待发布分支一致。发布中的旧commit字段不作完成依据；完成后才确认新版本。真实页面新读模型显示当前保留综合最后明确保存于工作8，并跳转准确MWREV。只读核对当前事项修订2、工作8、零在途后，经已安装c109与现有MCP正常begin登记wl-work8-overview-plugin-20260916；未重放旧失败AQ、未直接写工作或改动模型配置。新AQ-6bc32de118ce4891a4bc22e8baa9397e / ATT-ceccabe0-ff1b-444d-b1c5-9bcddb03abad于2026-09-15T22:54:14.628Z被原调度领取，首个事件MATTER_ISSUE_CORRECTION_STARTED，当前RUNNING。三段已交付原文与工作8已重新核对；尚不声称生成或保存完成。

用户转交的前端9fb472c074d069de2d2520dfae5bbc9c208ffb87已取得。其所在分支已被平台升级至636f72afc7381697f975625c2f5697e9cc02fd3c，M授权保留现有历史以同名普通快进转交到妙搭origin，实际远端已核对。云端注入的双URL中凭据URL被原钩子拒绝、清洁URL通过原钩子并更新；未跳过钩子或移动分支指针。代码接受独立于转交：不接受该提交中schema再生成、服务端浅类型转换或后继平台升级，仅审阅指定前端和必要依赖。原样例缺少具体声明选择与实际返回入口，且会以假ID进入真实API读取；medium子任务正在作有界修复，M负责后续浏览器核验。

## 2026-09-16 c109 自然运行读回与 T1 实际接线核对

Hosted终端连接中断后，页面自动重连失败；按提示重新加载窗口后恢复原应用访问。2026-09-15T18:30:42.203815Z官方cron只读返回六项原job全部enabled=true、lastStatus=ok、consecutiveErrors=0、runningAtMs=null，nextRun正常推进。未重新安装、启停调度、强制run或创建业务。这证明安装后的原调度实际执行正常，不证明未发布Host的新idle/来源边界已生效，也不把cron ok解释成新工程内容保存成功。

P按medium完成有界只读核对；M同时核对当前服务实现。正式解析产物与DocumentSemanticMap目前只有来源绑定、章节/角色、单元及覆盖；milestones是章节，CanonicalTimelineProjection仍是技术事件。没有可直接复用的已保存活动/预计声明或跨版本活动身份。现有DocumentSourceProjectionService.step有授权原文读取与纯结构ensure，DocumentSemanticRevisionRepository有原文绑定/CAS修订存储；但ensure已存在即返回，不能靠修改builder宣称旧产物自动升级，更不能在普通索引重试或GET中偷偷增加模型抽取。后续T1需显式、有回执的生产/补产入口与窄声明合同，再接真实消费者；保留原文字面、section/unit/SourceRef、时间含义和精度、已读范围及身份关联依据，季度/TBD/后版未提均不能补成推断事实。当前仍未完成T1生产与持久化，HTML样例不作真实证据；P本轮未取得可复查的真实同活动版本链。

## 2026-09-16 改版处理指导接入实际任务（本地，未发布）

补充隔离验证：实际 JobAid 保存命令→工作状态校验→序列化读取串联构造R1/R2/R3。旧版读取记录不能满足新版NO_MATERIAL_CHANGE处置；新版实际读取和明确比较后保存新版绑定与有限覆盖，旧正文、旧SourceRef及结果保持不变；第三版仍产生新的pending。原状态未被修改。`jobaid-problem-work.spec.ts` 9项通过，其中扩展了现有完整保存场景；不证明厂家修订说明读取质量或真实两版评估完成。

继续核对第二批发现：现有 `sourceChanges.covered/current` 已携带前后来源绑定，同family材料延续也已有隔离PG场景；不能重复认定这两项缺失。但实际 Matter JobAid 输入尚未明确本版修订说明→新版完整条件→历史评估影响→新版覆盖的处理顺序。已在既有来源阅读指导中补齐，并要求通过实际读取的目录身份辨别正式版次，不把documentVersionId、parseRun或semantic变化直接认定为厂家改版；参考更新不能改写另一文件条款，结论不变仍须记录新版比较与覆盖，旧SourceRef不能直接换绑。两项现有任务协议测试与定向ESLint通过。该增量尚未提交、未纳入待确认的8fb9cd7d7发布；真实两版材料、跨版本声明/活动及业务比较验收仍未完成。

## 2026-09-16 c109 安装完成，原调度恢复，Host 发布待确认

c109 已通过官方 `openclaw skills install` 更新唯一同名 Skill；安装后48个文件与 manifest 的字节数及 SHA256 全部一致，消费者10项测试通过。安装前保存六项原生调度完整配置，在无在途消费者时暂停；Host 发布受阻后已逐项恢复原启用状态。终端返回 `WL_C109_RESTORED_VERIFIED 6 enabled 6`，配置比对仅排除运行状态和更新时间，其余与安装前备份完全一致。未强制 cron run、创建业务请求或重放 AQ-350。

拟发布源码为 `8fb9cd7d7f86c41501e5506c3e795166e90bf73f`，origin/github 同名开发分支已分别核对一致。自动审批拒绝 Host `release-create`，理由是未识别到本次 Host 应用发布授权；命令没有执行，线上仍为此前版本。已向用户请求该准确提交到既有 Host 应用的发布与读取验证授权。c109 安装成功不代表 Host 修复或真实综合内容已经线上验收。

## 2026-09-16 登录已恢复，准备 c109 与 Host 协同发布

用户扫码恢复登录后，原Hosted终端于2026-09-15T17:46:53Z返回新时钟。原两个Matter job均enabled=true、runningAtMs=null，最近lastStatus=ok；未重启系统或唤醒业务。准确原回执 `assessment-round-1.result.json` 现已读到：AQ-350于16:48:01.594Z取得HTTP400、142字节，error.type=invalid_request_error、code=incomplete_result，message为“miaoda/minimax-m3 ended with an incomplete terminal response”，choices为空。该证据确认Gateway错误，不证明长度截断或底层为何没有完整终态；没有可恢复候选，不重复生成该请求。

准确综合来源前端已接受66aff31cc（F原1561fd84b，父40797136d），工作/历史、快览、态势和Matter知识命中/展开使用同一overviewSourceWork；缺失未知，NOT_AVAILABLE不显示，保留STALE说明。M集成后14项测试及前端类型通过，F四套27项及检查通过。源读取限制修复d8d179d90同步待发布。c109包及清单已上传原Hosted应用存储，尚未安装；计划核对空闲后暂停原调度、原位安装并校验、发布Host，然后恢复原调度及配置，不新建业务测试代替发布验证。

## 2026-09-16 综合来源工作读取与 Hosted 登录恢复

当前准确工作读取新增 `overviewSourceWork`，直接使用同事项、同租户和所有者的持久 SAVE 收据及确切工作行，记录当前保留综合最后一次明确保存所在的 workRef/workingRevision。历史读取不取未来综合，也不越过不同正文回捞恰好同文的旧记录；缺少收据返回null。它是保存来源，不代表已批准或当前生成状态。问题更正后的STALE工作保留原综合来源，新综合保存切换至新来源。知识搜索/精读及后续Matter输入传递同一引用；不增加数据库表、模型生成或自动回填旧记录。

本地验证：更正/搜索36项单测、服务端类型与定向ESLint通过；6项隔离PG场景均通过（首轮3过，其余3因搜索新增字段列表断言更新后通过）。包含原综合→问题更正→新综合→无变化保存的来源读回、历史不指向未来、无收据不推断及既有撤权/CAS/跨事项回归。前端由原F任务以medium推理强度继续消费该字段；不派高强度子任务。

Hosted 故障页刷新后跳到官方飞书扫码登录页，当前缺失登录态是继续访问的明确前置，已请求用户恢复登录并显示原页面。刷新前的“系统启动失败”和AQ-350的业务失败仍各自保留，不能据此倒推两者同一根因。没有点重启、重复受理或业务run。

同时修复独立原文运行读取入口：复用既有 `documentOriginalReadingCoverage`，semanticMap和coverage统一返回实际阅读限制，findings不再附带已明确标为DIAGNOSTIC的解析观察；不可读页及表格重建不确定仍保留，原manifest不改写。6项运行入口测试、服务端类型及定向ESLint通过；未重做解析、中文或模型抽取。这是T1读取接缝修复，尚未建立跨版本活动/声明合同。

## 2026-09-16 显式综合更正接入有界官方插件（本地完成，未发布）

新显式综合更正使用已安装官方 ai-text-to-json 1.0.26 的独立实例 `wl-engineering-overview-correction`，沿用现有配置的 modelID 2015/temperature 0.5/maxTokens 8192，不扩大模型配置或来源范围。Host 传准确工作、当前问题及其风险/措施/分类限制、已交付来源，只接受完整综合、对应完成说明与变更说明。原问题、完成状态、正式采用边界保留；生成收据、幂等保存、租约/CAS和精确读取接回现有协议。旧已封存 Hosted 总览任务及恢复不自动改道；失败 AQ-350 保留，不自动受理后继。

本地验证：38项生产者/信封单测、10项消费者测试、服务端类型和受影响 ESLint通过；隔离PG六项场景均已通过（首次全套5过、旧路线断言需更新；将旧任务明确构造成既有内部门径封存后，该跨事项/恢复场景单独通过）。定向PG包含新总览生成一次、重复保存、问题和完成状态保留、总览及lead一致、无变化无新工作；另验证旧Hosted路线恢复、引用侧通知与撤权。均使用本机55449专用测试库及合成候选，不代表线上生成质量。消费者版本提升c109并通过打包一致性检查，尚未安装。

Hosted控制页再次读取仍显示系统启动失败，因此暂不能核对原生错误响应、在途状态或安装消费者。未发布Host、未触发新业务、未重跑原件中文。下一步需恢复该环境，先核对原任务及空闲，再协调c109安装与Host发布，最后按真实输入/生成/保存/读取验收。前端V1已审阅并集成：084ea202b（来源5fb9e1fb7）及983c582b8（文案增量71ea0aedb）。集成后9项态势页测试和前端类型通过；来源版本与返回准确工作链接保留。c109包已生成（源码983c582b85affd56f463f3ed265ae3bdfd4bc4c6，sha256 c105c257d672f3660729644df67e5405d862a1c316788737167f445b3b47d2c9，392025字节），打包器全套Skill测试通过；未安装。

## 2026-09-16 后继更正失败，原生取证受 Hosted 启动故障阻断

后继 `AQ-3506768ac9aa42f5832a635978a737da` 的官方只读记录确认：00:44:53.347 开始、00:48:02.732 完成，ATT `ATT-dec0fc1b-6998-4dea-b294-92763393c5e6` 已 FAILED，终态原因为 `JOBAID_INCOMPLETE_TERMINAL_RESPONSE`。没有新保存工作，工作8保留且概述更正尚未通过验收。持久化结果为 NOT_PRODUCED，耗时187201毫秒；Host没有具体错误详情、模型正文或可关联失败产物，不能据此断言上游没有响应、JSON截断或缺少某个字段。

原 Hosted 控制页随后明确显示“系统启动失败”，原终端只读时钟命令未得到新输出；通过该终端的“重试”入口重连一次，经历“正在启动系统”后再次失败。尚未取得本次原生响应或会话终态，不能将页面故障直接认定为上述模型失败的原因。没有再唤醒业务、创建后继、修改检查点或重启网关。下一步先恢复现有环境访问并读取准确原响应；T1源语义等不依赖该环境的工作继续。

此前文档提交 `ff0d3c185cc3ed35d8417c04669425f403b23ded` 已在 origin/github 同名开发分支分别核对一致；线上仍为下述已完成的前端发布，本记录不触发新发布。

## 2026-09-16 首轮网关重启中断已定位并正常收尾

上一条运行记录中的“仍在生成”已被原生运行历史纠正：777 job 的首个运行于 `2026-09-15T16:09:35.069Z` 开始，28.896 秒后明确报 `cron: job interrupted by gateway restart`。随后三次正常调度均因 `REVIEW_ASSESSMENT-ROUND-1_OUTCOME_UNKNOWN` 退出，没有再次生成；Host 的 RUNNING 及后续领取心跳不能证明模型调用仍存活。原生会话没有助手输出或完成事件，检查点只有首轮 started，没有 result，也没有新保存工作。尚无证据说明网关为何重启，不归因于模型、输入长度或身份授权。

M 经正常 Host MCP STATUS 再确认无结果，随后以明确中断理由 CANCEL 原 AQ `AQ-9e52b732c3f54a56919d6d5c62180a68`，实际读回 CANCELLED；保留工作8、原请求及原生证据。没有改 checkpoint、租约或 deadline，也没有重放未知生成。后继需沿正常受理创建准确工作8基线的新请求，不能把原请求写成已成功或恢复了不存在的输出。

已确认两个原 Matter job enabled 且无在途，开始发布已接受的纯前端资料标识修复：release `7685801309664693231`，目标提交 `573454e689ea3754f7f20a7fd646e84e22b1f425`。发布现已 finished，error_logs为空，线上读到“本页资料为：777-FTD-31-21002”及旧聊天范围提示。未安装 Skill。

随后正常受理一次后继 `wl-work8-overview-after-gateway-restart-20260916`，AQ `AQ-3506768ac9aa42f5832a635978a737da`、ATT `ATT-dec0fc1b-6998-4dea-b294-92763393c5e6`，仍使用工作8及原三个证据引用；没有宣称恢复原调用结果。原job因旧错误退避一小时，读回后继QUEUED、零在途后，M通过官方 cron run 唤醒原job一次，回执 `manual:355f0161-15c1-45c4-9060-0336f1bfaf5f:1789490689865:1` enqueued=true。未改调度配置；这次算手动恢复，不算自然领取证明。后续仅观察该运行并验收保存正文。

## 2026-09-16 保存摘要与身份入口已发布

官方 release `7685792528452390154` 已 finished，精确提交 `218de67b335f221ba146d29563f31fc3da404e24`，error_logs为空；origin/github 同名开发分支均读回此 SHA。发布前两个原 Matter job 均空闲，完整配置备份后经原生入口暂停；完成后恢复 enabled=true，除 state/updatedAtMs 外逐字段相同，无遗留暂停。Skill c108 保持，未重装。

线上复核页已真实显示身份连接恢复入口及原事项返回路径；进入原授权流程后，页面返回同一777事项，401消失，能够读取复核页。M未点击授权页的最终授权按钮，不推定自动返回的具体操作来源。恢复后发现聊天主资料降成“当前资料”；只读代码定位为 Matter 页未传已有主资料身份，F 窄修复 `e8b39b00c` 已接受为 `41ae29290`：唯一PRIMARY已有编号/版次/DV传入讨论展示及现有customParams，旧WorkItem调用保留；明确原生聊天可包含其他资料历史。M相关四项测试通过，F类型/检查已通过，尚未发布。原生聊天出现其他资料旧会话，当前SDK未提供按Matter选择会话的合同，不能由显示历史断定Host复核记录串范围，也不宣称聊天已按事项隔离。

已按工作8准确基线受理一次 `wl-work8-overview-exact-20260916`，AQ `AQ-9e52b732c3f54a56919d6d5c62180a68`、ATT `ATT-a37507f9-afff-491c-8611-936bc799d12c`。输入列出(4)、(7)错误原句及(5)矛盾，要求删除虚假的核对轮次叙述并更新受影响简报和完成说明；三条原文绑定不变。官方只读记录确认实际任务输入，原任务自然领取。本记录时仍在生成，未保存或接受新工作，不重复受理或手动运行。

## 2026-09-16 综合更正读回与保存摘要修复

777 的概述定向请求已由原 Hosted 任务自然领取并成功保存工作 8；三条准确原文来源与工作 7 基线进入实际任务输入。生成、保存及页面读回一致，但正文仍把包含本文件自身的十六条参考写成十六项关联文件，并把 FAA LN 1825 (completed) 过度解释为仅该架次完成。M 未接受本次内容；成功状态和新工作编号不代表更正通过。六个问题内容未变，综合追加了一段声称无需修改的轮次叙述。

据此修正实际消费者 `materializeMatterJobAidCommand`：保存摘要按真实前后字段差异生成，分别报告综合、简报、完成说明、问题新增/更新/撤回、证据、覆盖及复核条件。模型原说明仍保留在问题工作和变化原因中，不再充作 Host 的字段差异事实。不使用关键词判断工程正确性，不改旧工作，也不通过摘要修复宣称上述内容已纠正。回归覆盖模型声称未变但实际追加综合、纯问题撤回以及仅说明文字变化；相关两套十六项通过，服务端类型检查通过。

同时接受 F 的复核身份恢复修复 `ed8b6f2ab`（集成为 `db60eaebc`）。精确 OAuth 会话缺失时，原提前返回分支现在展示既有身份连接入口并保留原工作返回路径；403/404仍按不可访问处理，讨论与草稿清除边界保留。M 将面向用户的提示收敛为重新连接指引；两套二十四项通过。F 的隔离浏览器点击证明入口及返回链接，尚不构成真实 OAuth 恢复证明。

此记录时两项修复尚未发布。线上仍为 `735dbdf`，Skill c108 保持；本次没有新解析、翻译、正式采用或手工业务数据修改。后续在受控 Host 技术窗口后，以工作 8 为基线明确指出两处错误及需替换的段落，再验收实际正文。

## 2026-09-15 F1 发布与真实阅读往返

官方 Host release `7685779738674269395` 已 finished，精确提交 `735dbdf40737b9f1f0cead53dd69745cd0e50761`，error_logs 为空。此次仅发布已接受的前端阅读三批及文档/测试，无后台、数据库、模型配置或 Skill 改动；未新增模型请求、解析或翻译。

使用原账户真实页面完成：资料库事项快览展开完整问题及 STALE 说明；依据进入准确 DV、parseRun 与 SourceRef；“返回原工作简报”保持工作修订 16 并明确历史只读。工程知识以 Win7 检索命中三项当前已保存问题，展开完整条件、风险、未知及来源，同时显示综合尚未覆盖本次问题更新；原文无匹配时明确当前授权及索引范围，不宣称全文无此内容。

文档目录按编号筛选后选择同一 family，打开准确文档版本，Reader 显示已发布解析修订 2 及 5/5 页；返回保留筛选词、列表视图、原文档选择和三个版本入口。未重解析、未重译、未登记引用比较。真实往返验证不扩展为撤权/迟到响应或缺页情景的线上证明，这些仍对应已有隔离验证。

777 当前工作 7 仍保留；两次失败请求的在线 ActionAttempt 仍为 `JOBAID_INCOMPLETE_TERMINAL_RESPONSE`，不能把本次阅读发布当作综合更正成功。M 继续核对真实输入与生成结果；T1/V1/T2 及后续业务内容按现行计划推进。

## 2026-09-15 F1b 只读知识检索已集成

M 审阅并普通快进接受 `31af53c33d7d85bd218e0b051316c835c05ad2a8`，仅四个前端/测试文件。`/knowledge` 复用现有工程工作与原文检索，显式只读分支无需 Matter，不初始化引用登记或状态读取；原 Matter 内功能保留。解析单元查询独立按需展开，不阻塞全局读取。准确工作展开沿用既有 subject/workRef/issue 校验，全文和更正/引用通知继续可读，来源跳转保留 DV、parseRun、SourceRef 与已有返回绑定；身份变化清理结果并使迟到响应失效。

F 完整 lint、客户端构建、正常 pre-commit 及五套二十八项相关测试通过；M 集成后独立运行检索和返回两套十三项，通过。F 隔离浏览器用实际页面/搜索组件验证只发只读请求、完整问题及更正提示、准确来源跳转，以及身份切换后迟到响应不能回填；请求数据均为构造样例，不是生产身份或真实正文验收。

本轮 F1 三个代码批次已集成，未新增后端端点、索引重建或模型请求；尚未发布，线上仍为既有 `067494c`。真实权限、真实关键词命中、准确正文以及前序返回回路的组合验收仍待完成；跨页检索命中不新增持久缓存。T1/V1/T2 的工程历程、比较和态势合同与功能仍按设计对齐说明单列，不能据此宣布全部新设计完成。

## 2026-09-15 F1b 阅读返回已集成，真实身份验收待完成

M 审阅并普通快进接受 `8d7f8790dc4b4a2c98c9843a0abcf0bf5adc0fde`，十七个前端/测试文件。Matter 来源导航固定离开时实际 workRef，独立 DV 与旧 Reader 共享类型化内部返回解析；位置按 session、Matter 和准确工作区分，撤权与旧 session 清理沿用现有机制。目录行保留准确 family 与安全筛选、树/列表视图和展开位置，不带关联写入意图，不缓存正文。

F 完整 lint、最终客户端构建、正常 pre-commit 通过；五套相关测试在最后增量后合计二十八项通过，最后改动已补测。M 集成后独立运行返回链与目录两套十五项，通过。F 另用实际 Link、Reader 和位置 hook 在隔离浏览器中点击往返，验证目录筛选/滚动和历史工作/来源/展开位置；Reader 数据为构造样例，未将该结果当作真实身份内容验收。

多页目录返回保留原选择，但不缓存已读页全集；原行未在当前集合时明确提示“原选择尚未在当前读取范围内加载”，不改选首行、不判不存在。精确 workRef 随 URL 保留；滚动/展开元数据仍是会话内存，不承诺整页刷新后恢复位置。本批未发布、未调用模型或生产业务，线上仍为 `067494c`。后续真实身份验收须覆盖两条返回回路及缺页提示；完整工程工作检索仍为下一小批。

## 2026-09-15 F1a 快览与准确文档版本已集成

F 本地提交 `c34c192baabd33fa283a45d4aef076507c06266d` 经 M 审阅，择取为主控 `473fe56df`，保留设计对齐文档。仅六个前端/测试文件：快览复用已保存问题阅读，NOT_AVAILABLE 不挂成综合意见，STALE 与失败分开，更正及引用工作通知可见；准确来源复用既有 matterDocumentRoute，保留 locator，不再产生 WorkItem undefined；知识页版本选项只使用响应明确的业务 DV，不再使用结构节点 ID 或擅自切换 currentness 指向的其他版本。

F 回传四套二十项定向测试、完整 lint（含双端类型检查）、客户端生产构建及正常 pre-commit 通过。M 在集成代码上独立运行两套九项快览/版本测试，通过；源码差异无 server/shared/身份、依赖或生产数据改动。未重复全套已通过检查。原八项本机敏感诊断未纳入提交。

本批尚未发布、未真实页面验收；线上仍为既有 `067494c`，不能用继承的导航验收证明新快览交互。F1b 的 Reader 返回与完整工作检索、T1/V1/T2 的新工程读取及视图继续按设计对齐说明推进。

## 2026-09-15 最新前端设计对齐与 F1a 继续

M 与原妙搭 F 任务分别核对用户十份设计附件及接受产品代码 `067494c`，共同确认：业务理解已对齐，工程时间轴、改版比较、工程态势和跨图条目联动的完整合同及功能尚未交付。M 已实际查看静态态势、时间轴、改版及时间条目进入图谱的声明上下文；仅算独立样例证据，不是生产 React 或真实数据验收。

[设计对齐说明](../WISELINK_FRONTEND_DESIGN_ALIGNMENT_20260915.md)已接入现行执行计划，保留 F0→前端 F1→T1/V1→T2 次序与共享文件单写者。代码核实技术 Timeline 不能充作工程历程；现有语义 map 仅承载章节与来源，尚无稳定活动/预计声明读取。问题工作的 substantiveResult 是阅读投影，其存在不证明综合已形成；输入 coverage 也不等价综合基于哪份历史工作。

F 已开始窄 F1a：修 LibraryMatterQuicklook 的问题正文、更正/覆盖展示和准确来源跳转，以及 KnowledgeLookup 将结构节点 ID 当真实 DV 的版本选项错误。复用当前类型/组件，不改 server/shared；先完成本地实现及相关检查，回 M 接受再处理同步。此刻尚无新修复提交或线上验收。Reader 返回与完整工作搜索为 F1b；新的工程投影由 M/P 对应实际源产物补窄接缝，不等待整个大 goal，也不复制静态数据进生产。

本次仅核对设计和代码、更新文档及继续前端开发；未新增模型请求、解析、生产业务写入或发布。既有导航线上验收继续有效，既有综合疑点及跨事项比较仍按原记录保留。

## 2026-09-15 登录恢复后发布与真实历史工作读取

用户完成原妙搭账户登录后，Host release `7685743975865584847` 已由官方接口读回 finished，精确提交 `06db495cf7d8fe76dcc016645ab6570e995466c4`，error_logs为空。发布前两项原Matter任务均enabled且无在途，完整配置备份后短暂停用；发布完成已恢复enabled=true，除state/updatedAtMs外全配置逐字段一致。无遗留暂停、无新DDL、c108未重装、未调用模型。

正常线上页面实测 `?workRef=MWREV-11e45f18-c6b1-473a-9ce7-232dbfece8a4` 准确读取777工作3，正文与“指定工作版本”侧栏一致，复核/材料入口禁用；“返回当前工作”回到工作7。原跨事项请求 `AQ-888ff6f88f984fe797293601dcb96d06` 仍显示“本次处理失败：模型没有返回完整结果。已保存工作仍可阅读。”，未新增请求或修改旧工作。

实际验收发现前端导航回归：Matter正文读取正常，但当前版和历史版的面包屑均误标“页面未找到”，侧栏均误称“尚未选择事项”；当前版对象Provider本身正确。F据此完成纯导航修复 `067494c031da96d051484f5eb2ce6ce75b88fce5`，仅5个前端/测试文件，识别Matter、历史workRef及独立文档版本，保留WorkItem原入口，不把Matter当作WorkItem传参。4项路径/SSR回归、完整lint、前端生产构建和正常pre-commit通过，主控已普通快进并在origin/github核验相同SHA。

后继纯前端 Host release `7685749198655294723` finished，精确提交 `067494c031da96d051484f5eb2ce6ce75b88fce5`，error_logs为空。线上当前Matter的名称、面包屑和三个真实入口已正确显示；历史工作3显示准确历史身份，主内容写入口仍禁用，侧栏“返回当前事项简报”实际回到工作7。本轮导航回归已闭合。第二次发布未修改后台代码、任务配置或业务数据；无新模型请求，无遗留暂停。综合内容两处误读和真实跨事项比较仍列后继，未以导航验收替代业务内容验收。

## 2026-09-15 综合核对前后端已接受，发布等待托管登录恢复

前端提交 `c12ab42fe409ce4e3fb4f222c8e1e8f5a8e35bf4` 直接承接后端 `3e2068d5393a5ce5e2bea23df6b3d94f2709e489`，已普通快进接入主控 `codex/wl31-r09-master-handoff-20260903`。origin/github 主控同名分支及前端独立集成分支分别核验为同一接受 SHA。本批10个前端/测试文件，无未提交业务改动；原8项敏感本机诊断仍未跟踪、未同步。

综合核对通知已在事项问题工作、工程工作检索列表/展开和实际引用来源中消费，来源综合为 CURRENT 时也保留明确核对记录。真实请求状态与实际保存事实分别显示，原工作与后续保存工作链接使用各自精确 workRef；失败可以同时有保存，成功或保存不表示已消除错误或正式采用。

补齐既有授权精确工作读取端点的客户端封装及响应范围检查。指定历史工作读不到时明确失败，不回退当前工作；迟到请求不能替换新目标。历史页限定只读，侧栏显示指定修订，不把当前工作上下文送作历史对象。M提出并核对了侧栏混版、状态未区分及成功回调迟到覆盖的修复。专项2 suites / 8 tests、完整lint（含双端类型检查）、前端生产构建和正常pre-commit均通过；这些是本地工程证据。

官方 Host release `7685722535677381591` 本轮再次读回 finished，实际仍为 `eb9979f2e28585a899deb8798befa9bb25044e17`，error_logs为空。新前后端尚未发布。托管控制页刷新后实际为过期扫码登录页，已请求用户完成原账户登录；未暂停任何cron、未启动发布、未重装c108、未调用模型。登录恢复后先核对实际消费者空闲，再按原发布窗口流程部署与恢复，并验证正常页面；当前不能把本地通过视作线上通过。

777工作7的两处实际综合误读及真实跨事项比较仍未完成。旧普通FAILED请求不会被追溯猜测成结构化综合核对记录，本批通知也不证明两次网关失败已修复。长SB新增处理范围仍待授权。前端已交还M后端/共享窗口；后续F1承接c12ab42fe，共同文件继续窄范围串行集成，T1/V1投影另行明确，不复用旧bfa/37b分支覆盖现行实现。

## 2026-09-15 前端 checkpoint 已接入，综合更正通知后端补齐

前端 `bb4423d3e09fcbbd578adb706575c29a85a34bf0` 已从 `2aa465fd` 快进接入主控分支，origin/github 主控同名开发分支分别核验一致。此次仅13个前端文件：导航外壳、限定范围的知识查询和关系图；保留当前身份/对象 Provider、真实资料库和 Reader，不纳入旧整页覆盖、空态环形图或旧共享合同。前端完整 lint 与客户端生产构建通过。M指出并核对了迟到查询串版本、来源深链遗漏选中版本和身份错误伪空态的源码修复；尚未将该前端提交作为线上验收。

原两次777请求的持久输入均有明确综合更正说明，但 `knownCorrections=[]`，原因是既有通知仅收录专用问题更正。新 `overviewCorrection` 显式绑定准确旧工作、疑点和已交付依据，走原普通事项消费者；没有综合或工作/证据不匹配时拒绝预留，幂等与失败恢复保留同一用途，不从自由文本或普通失败猜测更正范围。

新增 `overviewCorrectionNotices` 是精确目标工作的核对请求记录，包含请求状态和通过实际工作行/ActionAttempt关联查出的保存引用。失败但已保存可同时表示；保存或成功均不被解释成“错误已消除”。当前读取保留针对本版及旧版的明确请求，旧版读取排除针对更新工作登记的请求；后续普通保存不会擦除历史请求。通知已接入授权工作读取、工程工作检索/展开、实际引用方读回和后续模型输入，旧不可变正文保持不变。

隔离PG覆盖准确工作/来源预检、幂等、失败不改旧工作、恢复用途、保存后失败仍可读、旧版范围、A→B通知与后续普通保存；同事项普通FAILED不产生内容更正通知。定向MCP/搜索25项与工作输入/引用7项单测、双端类型检查、生产构建和diff检查通过。Luna已只读复核权限/状态/恢复边界。本批没有新DDL、未重装c108、未调用模型；线上仍为此前已核实的 `eb9979f2`。前端消费新增通知与后续部署/真实更正尚待完成，不将后端检查冒充完整业务闭环。

## 2026-09-15 本批收口，前端集成可开始

接受的业务基线为 `eb9979f2e28585a899deb8798befa9bb25044e17`，origin/github 的 `codex/wl31-r09-master-handoff-20260903` 已分别核对同一 SHA。官方 Host release `7685722535677381591` finished，实际 commit 精确匹配、error_logs 为空。本节后续提交仅更新交接事实，业务代码保持该基线；无需再次发布文档提交。

线上原生页面已读取上一节真实引用请求的终态，显示“本次处理失败：模型没有返回完整结果。已保存工作仍可阅读。”，工作修订仍为7；本次仅 GET 核验，未新建比较请求。两个原有事项任务已恢复 enabled=true，发布窗口前后全配置除 state/updatedAtMs 外完全一致。c108 未重装，无未完成发布或遗留暂停。

跨事项 PG 流程、伪造引用正文拒绝、原生状态同事项与撤权检查、实时更正提示及 SSR、相关工作/搜索/MCP 单测、两端类型检查和生产构建均通过。无未提交业务改动；原有8项本机敏感诊断未跟踪资料不属于交付，未纳入公开同步。

M 本轮在此结束。可开始前端集成：从接受基线及本交接文档提交建立独立 `codex/miaoda-frontend-integration-20260915` worktree，选择性迁入前端增量。M 冻结 `server/**`、`shared/**`、`client/src/**`、`migrations/**`、`package.json`、lockfile 与 `tsconfig*`，集成窗口仅允许协调文档事实更新；保留当前身份/租户、来源、事务/CAS、精确引用和状态回读接口。

未完成业务另列后继：真实跨事项比较未产生候选；777工作7综合两处已知误读尚未纠正；长SB仅完成原件只读核验，新增处理范围尚待用户授权。大 Goal 未完成，不作为本次前端集成的等待条件。

## 2026-09-15 跨事项准确引用已发布，真实页面请求已登记

提交 `0ce31ec82c0dc7152912a8fdbc0cdd4d9abea515` 已在 origin/github 同名开发分支分别核验。官方 Host release `7685714384761621700` finished，commit 精确一致、error_logs 为空；c108 未重装。0057 经官方 CLI 在 dev 事务应用并读回，发布后 online 只读查询确认相同 SELECT/tenant mapping 策略。发布前两个事项任务无在途时短暂停用，发布后均恢复 enabled=true，除 state/updatedAtMs 外全配置逐字段相等。

真实777页面从授权搜索展开787工作16 `MWREV-75632e5d-e5f4-4cd2-8ace-a254f99f5874` 的 Win7 条件性判断，明确其综合未覆盖新问题。正常“引用并比较本事项”成功登记 `AQ-888ff6f88f984fe797293601dcb96d06`，基线为777工作7。正常请求用途要求比较条件方法与777自身ONS构型/BP V17C前置/过期目标，并禁止迁移787对象事实或评分；同时核对工作7两处已知综合误读。Host回读确切A工作、问题、用途、evidenceRef与correctionNotices已进入任务输入。

该请求已由原355任务自然领取并正常收尾 FAILED：第一轮 HTTP400 / incomplete_result / INCOMPLETE_TERMINAL_RESPONSE，142字节响应、167668ms、inputUnits293439、outputUnits0；round1/corrections0/saved=null，NOT_PRODUCED、无SAVE文件。工作7保留，未原样重跑，不按登记与领取成功宣称跨事项业务实证通过。

实际失败暴露页面只显示登记时QUEUED而无状态回读。后续本地补齐已认证同事项/来源范围的状态只读接口和URL绑定的请求状态页，支持刷新页面后继续读取失败/完成状态；不自行重试生成。同时补齐B对已保存A引用的实时综合/更正提示，进入事项、搜索和后续模型输入，不改写旧工作或自动替换引用。隔离PG验证A更正登记后B原state保持完全相等，受影响issue、搜索命中和下一B请求能读取同一通知；状态回读验证QUEUED→FAILED、原因及撤权拒绝。此后续补丁尚未发布。

本批收口还要求整条 PRIOR_RESULT 与 Host 从确切 A 工作构建的引用完全相等，拒绝根来源未变但摘录被伪造的情况；隔离 PG 反例通过。后续补丁两端 typecheck、生产构建、来源/搜索/MCP 单测、旧/更正精确链接与 unchanged 提示的 SSR 验证通过。

前端集成无需等待整个大 Goal。当前批次接受提交后，M 在集成窗口冻结 `server/**`、`shared/**`、`client/src/**`、`migrations/**`、`package.json`、lockfile 与 `tsconfig*`；仅更新协调文档的部署/验收事实。前端在独立 integration worktree 按接受 SHA 选择性迁入视觉增量，保留本批引用、权限、状态和来源合同。工程 chronology、Matter/global overview、文件改版比较读模型和图谱后端增量均另排后继批次，不与本窗口共同文件双写。

新增浏览器“引用并比较本事项”及 MCP 可选 referenceWorks：Host 按当前 actor/tenant/service scope 读取 A 的确切工作和完整问题，向 B 交付候选、用途、综合覆盖状态、已知更正及根来源。B 只保存实际使用的引用；不继承 A 的构型、实施状态、概率或风险等级，不把引用摘要当作独立来源。历史链接直达所引工作，原文定位保留。每次领取/读取/保存及检索均重新校验来源权限；引用未首次保存就失败的请求，正常恢复保留同一来源和用途。

原生页面登记保留 authenticated SQL 身份。实际 PG 验证发现模型配置表没有原生读取策略，新增迁移 0057 仅允许已核验身份映射读取本租户非秘密 modelRef 配置；未增加管理写权限、角色成员或 Hosted 来源范围。隔离 PostgreSQL 6 条完整流程通过，其中新流程验证原生登记、幂等回读、失败恢复、A→B→A 根来源去重、精确旧版保留及撤权拒绝；双租户模型配置隔离和普通用户修改拒绝通过。相关 49 项工作/MCP 单测、10 项搜索测试、两端类型检查及 c108 发布一致性检查通过。旧 PG fixture 的 statements 改为现行 body 引用、补齐原文定位，保留原授权/版本断言；搜索断言显式核对已上线 overviewStatus。

以上测试是本地工程证据，未冒充模型实际比较。生产构建通过（既有外围 tsconfig 扫描及 chunk 体积警告保留）；777 工作7综合两处错误及长 SB 新处理授权仍未闭合，后续以真实请求保存/读取结果更新。

## 2026-09-15 工作7及覆盖修复已上线，定向综合更正未产生候选

Host release `7685693975533718722` 已由官方接口读回 finished，精确提交 `921d68d4cdfc16a427516a25ab3ad6ef81931193`，error_logs 为空。只发布 Host，c108 Skill 未重装。两个受影响 Matter job 已按发布窗口前完整配置恢复 enabled=true，除运行状态和更新时间外逐字段一致。

777 专用更正 `AQ-4908c010ab4d4dc98c2f9382d9739ede` 正常保存工作6；后继综合 `AQ-2fb5d233c1c1430488442e78632ba7d7` 正常保存工作7 `MWREV-c31bd0fa-6349-4697-b170-e37a5cc51f5d`，overviewStatus=CURRENT。正常 READ_SAVED_WORK 与实际页面一致；六个问题正文完整保留，两个准确输入均维持 SUBSTANTIVE/85 条来源，页面不再显示无依据的待纳入面板或旧综合占位标题。这证明覆盖继承修复在线生效，不代表综合全部内容准确。

工作7综合仍有两处已定位错误：末段及摘要把含本文的16条引用误写为16份其他未读文件（正确为15份其他文件）；把原文 `FAA LN1825 (completed)` 解释为仅一架完成，原文不足以支持该范围推断。以精确工作7登记的 `AQ-6613c0b66c8444d899cccaafa66179cd` 已自然结束为 FAILED。实际第一轮 HTTP502、gatewayFailure=TOOL_CHOICE_NOT_SATISFIED、响应142字节，Host终态 JOBAID_INCOMPLETE_TERMINAL_RESPONSE；round1/corrections0/saved=null，业务 NOT_PRODUCED，没有 SAVE 文件。工作7保留，未原样重试，未改模型或额度。此处仍待处理，不能按 CURRENT 标签宣称内容已验收。

用户另明确授权《737-34-3830 Original.pdf》原件只读核验。正常版本页面读取受旧租户归属限制；随后通过已有官方开发者文件下载入口取得用户点名原件，1060204字节、SHA256与目录匹配，未绕过产品鉴权或迁移旧数据。Astra核验22页，确认 Original Issue 2026-05-13、封面2.0不是修订号；技术表格脚注、跨页警告和图示编号关系必须保留。完整受理、原文解析、索引、必要首次辅助中文及新增精确文档后台范围已具体提出，尚待用户答复，未执行。

## 2026-09-15 777比较专用更正与综合更新覆盖修复

正常综合请求 `AQ-357d22530f164456bfd47aa639a7a8a5` 成功保存工作2 `MWREV-b2b87c86-2bba-4489-9550-4b08c17fa6d3`，overviewStatus=CURRENT，6问题正文保留；页面实际读取5段综合。综合明确目标日期已过，但仍存在将改装窗口对齐到May 2026的矛盾措辞，尚未作为准确综合验收。

专用更正请求 `AQ-e7d6043de8ee485dbb914c212ea4c1ea` 已由原355自然消费者完成，正常保存工作3 `MWREV-11e45f18-c6b1-473a-9ce7-232dbfece8a4` 并FINISH为SUCCEEDED。保存正文区分旧版已有Final GADSS追加改动与合并FAA/EASA SB背景，以及新版新增监管审查迭代、政府停摆、FAA批准和EASA协调；明确不能用已过的May 2026目标安排当前改装，也不能将LN1825 completed扩大为全部飞机实施。旧综合标为STALE。参考表16条含本文自身，不能称为16份未读其他文件；已通过同一专用入口受理计数更正 `AQ-04f9fd2a7f6444c78218eb28b7f2f1a8`，结果待核。其他受影响问题及综合仍需保持一致，未作正式采用。

实际工作2暴露两个Host读取/物化缺口：初始focus保存了“综合尚未形成”的占位文字，形成综合后页头仍显示占位；overview-only保存将同准确输入既有分析降为READ_ONLY。最小修复改页头使用已存问题headline、首次focus使用真实问题；仅在问题完整保留、仍引用同binding来源且无显式处置时继承旧SUBSTANTIVE，新增读取单独标为未新增分析，来源/语义改版或显式处置不继承。真实materializer回归8项、工作状态回归23项及两端类型检查通过；Luna已审阅，尚待提交发布。本次只改Host，不重装未变化c108 Skill。

## 2026-09-15 派生原文发布与耗尽候选准确收尾

Host release `7685661875049253842` 已finished，精确提交 `2f07b78a3e97518e84c7e166d0f65c4bdacbe154`，包含2.0合格中文候选保留文本后重新检查。两份777已由正常产品入口受理派生修订2，旧运行 `ea9543e4-1c2c-4f21-b989-963ca71e875b` 在约15秒完成，新运行 `9e7cd784-92bb-478d-b34f-ae56fd53e087` 也已发布并进入原INDEX/中文消费者。旧rev1/rev2实际manifest中Markdown（16434字节）与PDF.js items（546963字节）的SHA完全一致，新PRUN下存储路径不同；证实内容复用，不能仅凭manifest断言插件调用次数。新rev2实际manifest尚未独立下载核对。Reader真样本发现Operator Action跨页括号断句仍分两段，最小阅读层修复通过真实manifest渲染与14项正反测试，提交 `7ade6334d2d38a187681fddd5daf1e0343be0e78` 已双远端同步；Host release `7685668252044217305` finished，精确提交 `c822dded2e5411ca03e76d67cad6f5e5ba4977c6`。线上原文页确认跨页句子已连续、保留两个原件定位入口；无需再次重解析。

新777事项由来源变化自然建立 `AQ-716d03c8a38d466383b78f496e530d20`。其第5、7轮完整外层工具响应中的workJson语法不完整，第6轮语法正确但存在合同未声明字段；两次纠正耗尽且未保存。不是max-token截断，也不修补候选或增加额度。c107最小修复将已持久化且未到SAVE的JSON解析失败按正常FINISH报FAILED，并保留已有保存/历史。59项runtime和消费者测试通过，覆盖零SAVE、两次纠正限制，以及保存后失败回执丢失可读回且无额外生成。c107已正式同名安装，391137字节及48个文件摘要一致，托管335项测试通过，官方info为原目录、eligible=true、disabled=false。原六任务仅在零在途窗口短暂停用，随后enabled及其他完整配置精确恢复。原355任务的自然tick已FINISH同AQ为FAILED；实际assessment-state仍round7/corrections2/saved=null，round结果只有1—7，无新增模型轮次。未重新申请业务评估。旧777双语页已可读610/11594字符（5.2%），中文仍自然处理，尚非完整交付。

直接版本关联入口的实际缺口：现有“从资料库加入材料”只列WorkItem，新777快照已完成原文却没有独立任务，不能正常关联。最小前端接线改为先选工程文档/具体版本，复用现有材料修订表单和Host `materials` 保存服务；同family默认成员、其他family默认参考，可填写参与范围/作用/原因。旧WorkItem输入与原材料继续保留，新材料未读不冒充已覆盖。客户端读回新增核对确切family和documentVersionId，错版本即拒绝导航。17项相关材料/工作读取/客户端测试、client类型及lint通过；隔离PG原有直接材料/重放/全源授权用例1pass0skip；待发布后通过正常页面关联新快照。未增加受理接口、上传原件或更改后台权限。

精确版本入口已发布：release `7685676850110319568` finished，实际提交 `3182b7b507c71020ad367c12c754ceadf53d36df`。通过正常页面选择 `777-FTD-31-21002_Doc_05272026.pdf` 并单次保存为同事项成员，客户端读回核对准确DV/family后返回事项；页面显示2项材料关系，新版范围/作用及旧版主要来源均保留，均未冒充已覆盖。原355自然任务已因该输入变化建立 `AQ-12a860e69177443b8763ea1305ebc0bf`，7轮/2次纠正后FAILED、saved=null；第五轮openQuestions字符串类型错误，第六轮JSON语法错误，第七轮新增未声明references字段，未形成保存结果。该运行c107，实际持续243803ms；不将关联成功写成版本比较完成。

查实际模型指导发现workJson内的openQuestions四字段对象结构未说明（原函数的work schema已由字符串传输替代），只在被拒后才提供类型诊断。c108补齐首次指导中的准确对象字段、问题对象允许字段、正文引用与原文定位ID的区别。仅补传输说明，不改候选、Host校验、模型、纠正次数和额度。提交 `8636ed75fd38a5db6119d29b050454c2d45ab6a9` 已双远端同步；391411字节安装包及48个文件摘要核验，正式同名安装后托管335项测试通过，六任务完整配置恢复且eligible=true。按原失败请求受理一次正常恢复 `AQ-82b107ebe3604a3ba9009e95a66f52ed`，由原355自然任务执行；模型自行纠正未交付u45:p2引用为已交付u45:p1，经Host正常SAVE取得工作1 `MWREV-48771b40-ec15-4c74-a696-f3138ee22a25`（6问题、COMPLETE_WITH_OPEN_QUESTIONS），随后FINISH为SUCCEEDED。页面已实际阅读问题正文；尚无overview，不能将consistencyCheck回执冒充综合正文。后续正常请求 `AQ-357d22530f164456bfd47aa639a7a8a5` 已受理，以工作1为基线补综合并核对日期有效性及实际变化，结果待核。

## 2026-09-15 777 原文及事项任务已建立，真实失败转入定向修复

两份777 FTD均经正常产品入口首次预约、原生文档任务自然完成原文：旧 `document_version_6b998c1544aa06b5f20b2be0` / `PRUN-1af7733a-28c8-4daf-a954-037af4c96c5f`，新 `document_version_78c6d0adb612265f85e1d338` / `PRUN-131965dd-0239-4050-ab55-01c63f5aca4e`；均PUBLISHED、解析修订1、5页，INDEX为NO_PENDING、semanticRevision1。已取得文本不代表结构质量已验收：本次777存在伪表、跨页组织和诊断扩散反例，不能由旧787样本的成功替代。

两个文档任务为 `8a3f02cf-7432-45a9-9c0b-328bcfc8e3f1` / `5c430aac-b355-4ec2-8ff1-73d7b9e10673`。首次中文 `DTQ-a47b8225-2605-4ca3-a5c1-3a504fc6e486` / `DTQ-e56aa45f-724a-4a9b-a234-baa39a2d2de8` 均已转REQUIRES_ATTENTION，错误为 `DOCUMENT_TRANSLATION_CHECK_SCOPE_INVALID`。代码中该错误表示检查插件返回的blockId或anchorId不属于当前输入，不是后台授权失败，也不能仅据此归因日期格式。保留已保存译块，未盲目重翻或延长额度；原文仍可正常读取。

用户已明确批准新777事项范围与任务。可选严格Matter列表支持在提交 `bb43b5ddd551b5b242ed6dee375d2f76bb339043` 实现，scope/MCP接线43项和server typecheck通过；origin/github同名开发分支分别核验。环境列表只含原B787与新 `MAT-d9e6c294-f368-42e4-9a1b-b46c6170be02`，精确读回且旧单值、actor/tenant保留。Host release `7685642481807691048` 已finished、实际为该提交、无发布错误。

正常创建新事项原生任务 `355f0161-15c1-45c4-9060-0336f1bfaf5f`，沿用原Matter消费者、native session store、cwd、每分钟计划和3600秒单次期限。创建前去重；原五个任务的enabled、schedule、payload、agentId、sessionTarget逐项确认不变。首次自然评估 `AQ-5c2ed8ff8a9d4c488f2a35042b1e2b86` 正常读取旧FTD的original偏移0/20/40，最终 `JOBAID_WORK_VALIDATION_FAILED`，未保存工作。三次候选分别暴露多余title、openQuestions类型错误和未交付的u22:p0引用；末次仍猜错openQuestions结构。没有重新受理同一失败。

M定向修复纠错反馈：保留来源拒绝与字段类型两段说明，错误对象附当前合同的expectedProperties，不替模型改写内容、补引用或增加纠错次数。候选版本c106的46项runtime测试、206项版本/协议/错误码检查及发布源一致性检查通过，Luna只读审阅无阻塞问题。提交 `127d21e28cb85b4424a7e926553d655beb281f1d` 已在origin/github同名开发分支核验；c106已通过官方安装器覆盖唯一同名Skill，托管下载390923字节与48文件摘要一致，安装后333项测试通过、官方list/info/check成功。仅在零在途时短暂暂停原六个任务，已恢复全部原启用及配置，当前调度状态均ok；未重试失败业务。Host STATUS另补读取已存terminalReason，避免FAILED但errorCode空掩盖具体原因，12项MCP测试通过；尚未部署该小修。

用户最新要求由一个Astra子会话执行《解析质量与工程阅读修订执行书》。已接管原文结构、诊断范围、日期校验、Reader与复制和真实消费者，保持独立前端最小改动边界。通过正常授权存储读取旧777保存的manifest、PDF.js items及插件Markdown，核对bytes/SHA；另经产品版本页正常下载原PDF并确认与manifest相同SHA，供同一反例视觉核对。Astra本批34文件实现已完成，本地14套90项定向测试、两端类型及lint检查通过；原始PDF SHA与manifest一致，重组前后非空白字符守恒，Reference各16行，诊断保留且真实限制单独投影。连同M两处事项阅读/过期提示入口修复，37文件提交 `6e202a09b93e054fc36a10108213dbcdf014e18c` 已双远端同步。Host release `7685659513999543248` 已finished，官方精确读回为 `6e202a09b93e054fc36a10108213dbcdf014e18c` 且无发布错误，尚未触发派生重解析。

正常产品双语页只读证实旧工作区7个保存块、994/15432原文字符，新工作区5个保存块、533/15862字符；可读覆盖分别1.4%及0.6%。保存块不等于合格复用块。检查版本由2.0升级2.1后，跨派生版本的旧合格候选还需要保留文本并重新检查的迁移路径，最小三文件补丁已完成：明确2.0合格文本满足原有全部来源/结构/上下文依赖后以PENDING、空check、不selected迁入，再走LOCAL_CHECK及必要官方CHECK；2.1原有复用保持。实际repository写入与调度15项测试、server类型和lint通过，待单独提交发布；本批未重翻已保存文本。

本family快照生成日期与LastRevised（2025-07-28、2026-02-04）分别记录，尚不代表今天最新有效或正式采用。新事项仍只有旧版主要来源；后续新快照加入、同family变化、准确综合及跨事项候选保存待完成。A的工作16正常可被B精确搜索与展开，但STALE综合后继仍失败，未重试未改变的输入。

## 2026-09-15 两版FTD文档范围已授权配置并发布，原文任务尚待建立

官方 Host 开发页可以到达，但当前要求飞书扫码登录；已向用户请求扫码。发布回执的线上URL经普通未认证HTTP检查返回404，不将其误报为整个Host不可达。页面解析接口只创建预约，后台 `document_work` 才执行原文步骤，因此未在没有可用消费者权限的情况下先创建预约。

本地最小实现新增 `WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS`：可选JSON非空数组，显式提供时替代原单值，仅允许列出的完整版本ID，统一使用原配置actor/tenant。非法或重复列表报配置不可用，不静默退回单值；未提供时保留原单文档行为。每次原文/中文工具调用仍经过服务范围和既有来源权限复核，STEP保留lease与事务边界；不会从文档列表取得Matter或WorkItem权限。这只是DEV/UAT的明确对象范围，不代表第四批正式后台委托身份已经实现。

准备的实际范围为原787 FTD `document_version_b83523c2b5ba26a2b1753641` 加两份777 FTD快照 `document_version_6b998c1544aa06b5f20b2be0`（导出2025-09-26）及 `document_version_78c6d0adb612265f85e1d338`（导出2026-05-27）。设置完整列表将保留原文档，使用原文档actor/tenant，不改原三个job；新增每份777 FTD各一个精确DV文档任务。现有消费者首次发布原文后会走INDEX和首次辅助中文，已可用结果按原状态复用。具体版本的parseRun仍须由正式用户经正常页面受理。

验证：服务范围及接线21项、原文/中文runtime9项、server typecheck及diff check通过。用户随后明确回复“同意新增这两份文档范围和任务”，覆盖以上两份既有快照的原文解析、读取、首次辅助中文和各一个精确版本原生文档任务。经官方CLI设置ONLINE环境的三项完整列表并精确读回，原DEV身份环境、actor/tenant及原单值均保留。此授权持续有效，无须重复确认。

Host release `7685632496361770231` 已由官方CLI读回 `finished`、无错误日志，实际提交 `318440c53abc8ec246e2f3de94aa24adb2bd2402`，与本次实现一致；该提交已分别在origin/github同名开发分支核对。Skill仍为c105，本次无需重装。发布完成后的Hosted终端浏览器连接先无响应，随后浏览器清单读取失败；本轮只尝试读取cron新增帮助，未执行任何新增命令。因此两个新原生任务、正常MCP新范围回读以及两个parseRun均尚未完成；原三个任务未修改。恢复Hosted连接后先核对当前任务列表，再建立两个精确DV任务；解析预约继续通过已登录正常产品入口受理。技术发布完成不代表原文/中文真实运行已经完成。

## 2026-09-15 c105 与 Host 输入状态修复已发布

Host release `7685625262247840716` 已 `finished`，精确提交 `83db3f56f044357cee6752132f6fe2070180dbdf`。本批补齐新任务及保存恢复的 `previousWork.overviewStatus`，明确旧综合为 STALE 时，即使问题正文无需更改，仍应核对并保存新综合。Host 定向27项、消费者11项和服务端类型检查通过。

c105 经官方同名安装更新：ZIP 390488字节、SHA256 `8591f2afc8d93eb7ca8420cf7d268097aecfba613e4a0b1b3d9f985d02dcc843`、来源同一提交，48/48安装文件与清单匹配，仅多出官方安装器元数据。安装目录332项测试通过、0失败、0跳过；官方 skills info/check 均退出0，Ready、Visible to model、Available as command 均为真。验证脚本曾有一次换行转义错误，修正后检查通过，未重复安装。

维护窗口先确认原三个任务无在途并保存完整配置，官方暂停后安装；完成后恢复原 enabled，schedule、payload、agentId、sessionTarget 逐项一致。原失败综合 `AQ-7a13e67cefb446a98b48870cf6e5056f` 经正常 Host STATUS 确认为 FAILED。随后以精确工作16、事项修订3及固定新 requestId 正常受理 `AQ-567130c431ee418883fc9c32767b7e3d`，初始QUEUED，由原调度自然执行。恢复后首次自然运行分别返回 Matter IDLE、WorkItem NOT_READY、Document DOCUMENT_READY，均为 scheduler ok。新综合请求已自然领取，实际 assessment-invocation 读回 previousWork.overviewStatus=STALE、workRevision=16；新综合随后再次失败：HTTP400、JOBAID_INCOMPLETE_TERMINAL_RESPONSE，round1、saved=null，FINISH正常记录FAILED；原调度已无在途，未产生新工作。输入修复已线上证实，但没有解决托管不完整终态，不原样继续重试。

正式改版下一步的实时只读核验：`document_version_6b998c1544aa06b5f20b2be0` 与 `document_version_78c6d0adb612265f85e1d338` 同属 `family_4aa6b72b084efa83410651ad`，均 COMMITTED_IMMUTABLE；canonicalRevisionIdentity 分别为 GENERATED:2025-09-26、GENERATED:2026-05-27，businessRevision/revisionDate 均空，两个版本均没有 dm_document_parse_run。P/M已完成原PDF的修订说明和全文实际对比，但尚未形成产品原文读取回执与正式版本工作覆盖。Host产品线上URL本轮浏览器打开返回 ERR_CONNECTION_CLOSED；不能由开发侧SQL读取替代正常业务actor授权。跨事项搜索/精确展开代码与已有测试可复用，真实B→A→B保存尚缺。

## 2026-09-15 工作16更正已保存，后继综合失败及输入缺口修复

本次从 Host online 持久工作与正常 Hosted MCP `READ_SAVED_WORK` 读回同一工作15后，M与Luna核对了要求标题与条件解释的矛盾、三个结构化开放问题与旧综合“四项”的差异，以及历史轮次说明。正常 `begin_matter_assessment` 以工作15、事项修订3及28条完整目标引用受理 `AQ-add317d43ab142e79ed593ed31546411`；原 Matter cron 自然领取，专用官方更正插件完成生成，Host 正常保存及结束为 `SUCCEEDED`。

工作16为 `MWREV-75632e5d-e5f4-4cd2-8ace-a254f99f5874`。M核对持久 GENERATED 与保存结果：目标正文、要求处理、未决问题三组字段完全相同，其他四个问题完全保留。要求标题已由绝对结论改为待核对的关联判断，正文明确参考不修订SB受控要求、不从未改版推出事项安排绝不变化、不把普通引用或构型能力未连接自动变为整个SB判断的强制前置。真实条件未知仍保留；未形成正式采用或执行决定。Host差异摘要为“目标问题实际更新：正文、要求处理、未决问题。”

正常产品回读工作16仍为 `overviewStatus=STALE`，旧综合未被冒充为已覆盖。本次随后以精确工作16受理综合核对 `AQ-7a13e67cefb446a98b48870cf6e5056f`，原调度自然运行后以 `JOBAID_INCOMPLETE_TERMINAL_RESPONSE` 失败，未执行 SAVE_WORK，工作16保留。原生 session 显示两次 assistant 消息均无正文或工具调用，第二次 stopReason=length、output=16000；网关返回 HTTP 400 incomplete_result。此次不属于成功综合，也不重放半截响应。

失败输入另外暴露可修复的传递缺口：持久工作为 STALE，但 `previousWork` 只有旧正文。现已在 Host 两条任务构建路径和消费者 savedWork 恢复路径补传 `overviewStatus`，并明确 STALE 综合即使问题正文不变也须检查并保存新的 overview。局部输入修复不等于已解决托管模型截断。定向 Host 测试27项、消费者测试11项及服务端类型检查通过；上述修改尚未发布。

旧 WorkItem `WI-d09b7acc…` 的 `NOT_READY` 已定位：其对应文档版本有历史解析包，但没有 `dm_document_parse_run` 原件记录，当前原件模式因此不就绪。该旧任务状态不阻断本次事项的正常更正领取；未为清除状态重做有效资料。Host仍为下述 `18353c2d…`、Skill c104，本段没有新的技术发布。

## 2026-09-15 c104 与 Host 协同切换完成

Host release `7685608780734729182` 已 `finished`，官方读回精确提交 `18353c2d0d0b4f796b575929d8bca9677d127e47`。同一 Hosted 安装目录已由官方 `openclaw skills install <verified-root> --as wiselink-research-and-synthesize --force` 单次从 c103 更新为 c104；包 source commit 仍为 `cb30964e3f5030d563ce87524f195bb78ef096f0`，不因后续操作员文档提交重打包。

ZIP 390044 字节、SHA `9fe0bc55ffb0aca82f64eaba7c3f45feea818b415f8f77c8220aaafb60c4a8be`；Hosted 校验与安装后逐文件比较均为 48/48 匹配，仅安装器增加 `.openclaw/source-origin.json`。安装目录测试 331 pass、0 fail、0 skip；官方 skills list/info/check 均退出 0，Ready、Visible to model、Available as command 均为真，实际版本仅 c104。47 个 DOS ZIP 条目仍如实报告缺少 Unix mode，不将其计为模式校验成功。

三个共用 Skill 的原生任务均在完整配置快照和零消费者进程确认后暂停；安装及 Host 发布完成后均恢复原 enabled=true。schedule、完整 payload、agentId、sessionTarget 与窗口前逐项一致。恢复后的自然 tick 均为 scheduler ok：文档任务 `DOCUMENT_READY` 且 errorCode=null，Matter `IDLE`，原 WorkItem `NOT_READY`、nextOperation=null、completedStages=[]。这证明本次安装、发布、调度恢复和 Matter idle 运行路径；不等于 WorkItem 初评或新的工程更正已完成。

本次实际执行者为 M 的官方 CLI / Hosted 终端，Luna 核对阶段回执。CodeM 已实际读取操作员 Skill 并完成包验证，其后计划仍引用旧隔离基线，未作为部署执行依据，也未冒称 CodeM 在运行安装。页面“系统启动失败”经用户授权整页刷新恢复；凭据脚本上传被自动审批拒绝后，改用该应用文件管理直接上传同一 ZIP、manifest 和无凭据校验器，未转交签名凭据。未新建业务请求、手工 cron run 或重做有效原件中文。

## 2026-09-15 操作员 Skill 已持久化并完成只读使用验证

最终操作员 Skill 已保存到 `operator-skills/wiselink-hosted-operations/`，包含 `SKILL.md`、`scripts/verify-package.py` 和 `tests/test_verify_package.py`。旧豆包原件已确认删除；本目录是基于当前 Publish Lite 与实际 CLI/Hosted 入口重建的操作员 Skill，不是旧文件恢复。CodeM 通过显式读取 Skill 后，对现成 c104 ZIP/manifest 完成只读验证：`verified=true`、版本 `wiselink-research-and-synthesize@r09.c104`、48 files、archive SHA `9fe0bc55ffb0aca82f64eaba7c3f45feea818b415f8f77c8220aaafb60c4a8be`、source commit `cb30964e3f5030d563ce87524f195bb78ef096f0`；47 个 DOS ZIP 条目没有可读 Unix mode，已如实标记，不扩展为模式验证通过。

本次只做本地 Skill 读取与包校验，未执行 Hosted 发布、安装、job 启停或业务请求。Skill 目录尚未作为妙搭线上安装结果宣称；实际容器控制入口和后续 c104 配套切换仍需在获准 Hosted 窗口中由具备可读回命令回执的执行者完成。

## 2026-09-15 CodeM 操作员技能接续：原件与入口已定位

用户已告知Hosted登录恢复，并要求CodeM适配此前豆包生成的部署/测试操作技能。豆包原任务的交付附件现明确显示SKILL.md已删除；不能将产品工程分析Skill当成该操作技能原件，也不能把旧脚本的bash语法检查记作执行验证。按交付记录和现有Publish Lite重建，保留CLI能力识别、任务完整配置备份/恢复、指定分支发布、包完整性和安装读回；旧30b安装wrapper未被后续部署采用，不直接继承为已验证路径。

Luna已通过既有机制替换失效CodeM会话并完成一次实际能力核对；操作员Skill重建稿已生成于隔离工作区，但其后续纠偏任务因ACP超时未形成完整回执，不能将该稿视为已接受版本。隔离工作区仍是旧基线，产品版本声明须先对齐当前接受范围；本次仅推进canonical当前分支的c104机械声明。官方CLI最新发布列表仍为release 7685407198491872522；本批尚未执行线上暂停、安装或发布。M的浏览器provider连接仍报错，不能据此否定用户已恢复登录；后续由具备实际控制入口的获准执行者完成Host/Skill配套切换。

## 2026-09-15 两个真实FTD快照：原件与本地比较已完成

P已取得并核验两份原PDF；M重新核对SHA并阅读全部5页，完成章节文字比较和全页视觉核对。原件缺失不再是本次比较的阻塞。页脚导出日期与正文Last Revised Date确实不同，不能将GENERATED日期称为厂家修订日期；现行目录未被改写。

本地比较已区分发布方修订说明、实际变化、未变章节及分页移动，详细来源、页定位和候选影响分析保留在私有报告中。该成果不代表Host已形成新版阅读回执、工作覆盖或综合，也未验证厂家此刻最新有效性。线上精确绑定已确认工作15使用的是另一组来源，没有引用本次比较快照；不据此触发工作15更正。本报告仅作为同family真实改版比较样本。未新解析、翻译、上传、业务保存或部署；Hosted登录仍未恢复。

## 2026-09-15 来源目录身份与后继更正状态：本地接线完成

原文读取回执和更正上下文现从既有目录取得准确文号、businessRevision、源生成日期、生命周期、当前选择及其决定时间；仍明确未核实发布方最新有效状态，空版次不由parseRun或日期补造。读取保留已有事项/actor授权并按tenant family前缀过滤，不更改原文Evidence身份；更正上下文随STARTED持久保存。后继任务同时收到更正attemptStatus与unchanged，区分已完成的无变化核对和未处理请求。

线上只读发现FTD 777-FTD-31-21002有三个不可变目录版本，源生成日期分别为2025-07-04、2025-09-26、2026-05-27；当前目录选择为2026-05-27。其business_revision/revision_date均为空，身份由实际PDF前三页确认并登记为GENERATED日期，不能转述成厂家Rxx修订标签。三个版本均没有dm_document_parse_run记录，真实两版本正文比较尚未完成，也未发起新解析。线上service_role已有dm_currentness_decision的SELECT权限，未作生产授权变更。

本地定向PG验证1 pass/0 fail/0 skip，包含真实数据库目录投影进入更正输入、另一租户不返回目录信息、后继无变化状态及原保存/并发回放；server typecheck和diff check通过。测试初次发现服务端别名配置与隔离角色缺少该表SELECT，已对齐服务端tsconfig和已核实的既有平台只读权限；等待生成的测试在前置失败时会直接报错，不再悬挂。隔离PG已停止。尚未发布；Hosted管理页面仍需登录恢复。

## 2026-09-15 无变化更正：本地实现与验证完成，待发布

Host 对持久生成的正文、要求处理与未决问题做实际比较：全部相同时记录无变化回执并正常结束任务，保留原工作引用、版本及综合覆盖状态，不创建新工作。保存和结束继续验证租约与当前版本，重复请求读取同一结果。历史工作读取将其显示为 unchanged，不虚构 correctedWorkRef；Hosted 消费者已接入该结果。变更摘要仍由实际字段差异生成，原模型理由保留在生成事件中。

最新验证：更正与知识读取单测 32 pass；消费者 9 pass；隔离 PostgreSQL 定向保存/回放测试 1 pass、0 fail、0 skip，含无变化成功、重复保存/结束、错误租约拒绝、历史通知及零新增工作断言。日志位于私有临时目录，测试实例已停止。浏览器连接仍返回 nodeRepl.fetch request failed；本段不代表线上发布、自然调度或工程内容已验收。

本批已提交并同步双远端至 2e1dce9dd；随后补齐结束操作的 matter→attempt 行锁顺序，双连接同时 FINISH 均正常成功回放，定向 PG 1 pass/0 skip，服务端类型检查通过。官方 CLI 最新核对线上仍为 81ad5e476 / release 7685407198491872522。Chrome 原生控制可用，但 Hosted 管理页转飞书扫码登录并显示429，已请求恢复登录。Host与Skill的无变化结果合同需协调切换，未独立部署新Host。

## 2026-09-15 接续9月16日设计稿：持久生成证据核对与本地修法

本轮通过官方CLI只读核对工作15的持久STARTED/GENERATED记录：原始生成body与requirementHandling均等于输入，只有openQuestions改变；模型changeSummary却声称修改了treatment。保存后的三组字段均与GENERATED一致，overviewStatus为STALE。因此本次没有保存遗漏的证据，不据此扩大更正schema，也不认定引用即强制工程依赖。源文件现行性和页面实际展示尚待核对，不从解析rev6推厂家版次。

本地已将全文现行文档与实际插件/Skill指导统一为有效依据、参考与事项认识边界。新增Host实际字段差异摘要，模型原始理由继续留在GENERATED记录；更正上下文明确附带综合STALE时不得继承为当前已核实结论。22项更正单测通过，服务端类型检查通过（摘要修法后）；隔离PG初次因55439未启动失败；随后在独立55449新实例执行同一保存/回放用例，1 pass/0 fail/0 skip，实例已停止。知识检索与精确展开现已返回保存的overviewStatus，避免附带旧综合没有覆盖标识；对应10项测试及最新服务端类型检查通过。页面呈现与线上接口尚未验证。未发布、未创建新的工程工作。旧临时文件缺失不代表持久生成产物丢失。

CodeM C0因ACP_TIMEOUT及未完成的执行权限请求未取得报告；主控已以官方只读查询接续，不等待CodeM恢复。前端继续独立重构。前次origin同步f0504d05d已核验；下方旧“本地待同步/代理阻塞”保留当时记录，不代表本次同步状态。Git由Luna按接受范围处理。

## 2026-09-14 更正受理前来源完整性复核：本地待同步

本轮在更正任务进入可运行状态前复核目标问题的完整来源集合：缺少已登记的 `method:applicability` 时立即拒绝，未创建 `action_attempt`、未调用生成；合法完整请求的保存与回放链保持通过。定向 PostgreSQL 子测试 `targeted correction uses real PostgreSQL fences, durable generation and exact work replay` 1 pass/0 skip，server typecheck 退出0，diff check 通过。

该修复仅涉及 Host `matter-action-attempt.service.ts` 与对应 PostgreSQL 测试，尚未发布；当前线上 Host 为 `81ad5e47633758a85ceb1c9220e7263604b15222` / release `7685407198491872522`、Skill c103。它用于避免领取后因漏引用进入 RUNNING 重试，不改变来源权限、解析、额度或正式采用边界。网络同步仍受本机代理 `127.0.0.1:7897` 阻塞。

## 2026-09-14 工作15已保存；内容综合仍未闭合

新的正常后继已 `SUCCEEDED` 并保存工作15 `MWREV-850e2caa-3f39-4602-9993-587f3959c502`；其他四个问题保持相同，过程性 `openQuestions` 已清理。requirement 标题仍保留绝对表述，`changeSummary` 仍误称本轮才修改 treatment，因此 M 不接受内容完成，整体一致性仍待后续更正。

当前运行基线为 Host `81ad5e47633758a85ceb1c9220e7263604b15222` / release `7685407198491872522`、Skill c103。新的正常后继 `AQ-01ded20ff4f3451a888c273cc3771c93`（attempt `ATT-395fe166`，requestId `rev6-work14-official-consistency-fullrefs-20260914`）为本次恢复运行；本地 nextForRuntime idle 修复尚未发布，不能混称为线上已生效。前端仍由妙搭独立重构，本分支未改前端。

## 2026-09-14 nextForRuntime 成功终态回放修复：本地待发布

已接受本轮最小修复：自动幂等命中既有 `SUCCEEDED` attempt 时返回 idle（`next=null`），不再将成功终态映射为 `REQUIRES_ATTENTION`，也不创建新 attempt。定向子测试 `Matter commits frozen inputs while later material remains pending` 实际执行通过（1 pass/0 fail/0 skip）；为适配当前 v3 canonical 校验，测试 fixture 做了局部字段对齐。该修复仍是本地待发布候选，未计入线上 Host。

线上基线为 Host `81ad5e47633758a85ceb1c9220e7263604b15222` / release `7685407198491872522`，Skill c103 未变，前端未改。AQ-84c70 因准备遗漏 `method:applicability` 未生成/保存，已按正常路径 `CANCELLED`；旧 AQ-5e58c5abe46a4420878d164cec4206a6 的 `RUNNING` 记录已更正为实际 `FAILED`，工作14保留。

历史记录：新的正常后继 `AQ-01ded20ff4f3451a888c273cc3771c93`（attempt `ATT-395fe166`，requestId `rev6-work14-official-consistency-fullrefs-20260914`，deadline 2026-09-15 00:28:45）已完成并形成工作15；此前“正在恢复/尚无新 workRef”仅适用于受理时点，已由顶部工作15结果取代。

## 2026-09-14 更正契约候选：Host-only，前端发布边界已核对

本批更正契约补丁已完成定向验证：插件单元 19 项、server typecheck、改动文件 lint 通过；隔离 PostgreSQL 目标场景 1 pass/0 skip，日志保存在私有临时目录。补丁仅涉及 Host 更正插件、上下文/回执映射与相关测试，未修改数据库/RLS、Skill 或前端。

官方 release-list/get 只读仍为 Host `8b706172a97a83d837b869bec6ab4d8def24e519` / release `7685315995439729883`。相对该 Host 基线，当前候选在 `client`、`shared`、`package.json`、`package-lock.json` 无差异；本轮不合入 sprint、不发布。前端已有线上版本与开发中 `sprint/default` 的 49 项旧冲突属于独立集成边界，不阻止本 Host-only 候选按 M 的官方窗口发布，但发布前仍需保持前端 owner 的分支归属。

## 历史记录：2026-09-14 工作14一致性后继曾受理（已FAILED）

针对 online 事项3/工作14的正常后继 `AQ-5e58c5abe46a4420878d164cec4206a6`（`rev6-work14-content-consistency-20260914`），曾因 cron 退避执行单次恢复；后续实际 `FAILED`，工作14保留。该历史记录不代表当前运行状态。

前端 `origin/sprint/default` 已成功取得最新 SHA `247cfee384a1d299bee00848ce93e5ce604dc12f`；相对旧 `2926a9cb` 仅有 26 个 client/e2e 文件变化（3977 additions/1039 deletions），未发现 server/shared/database/schema/API/package 变化，非 client 风险结论未改变。此前“新 SHA fetch 未取得”的记录属于网络失败时点，已由该只读 fetch 更新；旧 49 冲突结论仍仅适用于旧 `2926a9cb` 范围。

## 2026-09-14 工作13/14 原生 session 回执已核实

工作12一致性后继的固定原生 session 已完成核对：连续三轮按 `SAVE_WORK`、`FINISH`、`FINISH` 运行，第一轮和第三轮均有保存回执，工作13与工作14均已读回。此前“没有同一原生 session 回执”的限制已由本次证据更新，不再适用。

内容边界仍保持：工作12→13仅目标 FTD 问题变化，13→14问题正文全部相等，仅总体字段与完成状态更新；requirement 标题的绝对表述、openQuestion 的一致性核对要求及 `understanding` 不完整仍待修正，不能宣称整体工程验收完成。报告 `output=27694` 与业务请求 `16000` 不等价，不据此扩展额度实验。当前 Host/Skill 仍为 `8b706172a97a83d837b869bec6ab4d8def24e519` / c103，idle 修复尚未部署。

前端 `origin/sprint/default` 最新只读 SHA 为 `247cfee384a1d299bee00848ce93e5ce604dc12f`；本次 fetch 未取得该新对象，故旧的 49 冲突结论仅适用于已核对的 `2926a9cb`，不得外推到新 SHA。证据详见私有 `/private/tmp/wiselink-offload-20260914/M/WORK13_14_SESSION_EVIDENCE.md`。

## 2026-09-14 工作12一致性后继：工作13/14已保存，整体仍待核对

此前受理的 `AQ-5402de7e4d054f3e895c58e52f512633`（attempt `ATT-f7fa86d0-6a5f-428a-be4a-285a32caac02`）已由正常 Hosted 调度完成：状态 `SUCCEEDED`、`errorCode=null`。同一 attempt 保存并读回工作13 `MWREV-38802de2-d9cb-4fa2-b4e0-51be49eafba5`（`IN_PROGRESS/CURRENT`）及工作14 `MWREV-356ec3e8-2c29-4872-9dab-4a6bb4887384`（`COMPLETE_WITH_OPEN_QUESTIONS/CURRENT`）。工作12→13仅目标 FTD 问题变化；13→14问题正文全部相等，仅总体字段与完成状态更新。

更正已将目标 `requirementHandling` treatment 调整为 `CONDITIONS_UNCONFIRMED`，并明确未知不等于无影响或必须提高优先级。仍有未闭合问题：requirement 标题保留绝对表述，openQuestion 仍要求一致性核对，`understanding` 还偏向变更说明而非完整综合。因此本次证明正文更正与保存读回链成功，不宣称整体 H2 或工程综合验收完成；当时尚未取得原生 session 回执的限制，已由顶部后续核验更新。

本次受理前 online 事项3/工作12无变更、活动 attempt 为0；未执行额外 cron run、未发布 Host、未修改前端。原自动化已暂停。当前 Host/Skill 仍为 `8b706172a97a83d837b869bec6ab4d8def24e519` / c103；此前记录的 idle 修复仍未部署。证据保留在私有 `/private/tmp/wiselink-offload-20260914/M/`，不纳入仓库。

## 2026-09-14 后端证据投影修复与前端并行集成限制

提交 `ee094fb6d0cf8b8d09e15a57f1260683ea89f69b` 已接受为后端阅读投影修复候选：保留历史 `substantiveResult` 依据并合并 problemWork 依据，冲突引用拒绝；定向状态测试 23/23、server typecheck、两个改动文件 ESLint 与 diff check 已通过。该提交尚未部署，不能覆盖当前线上 Host/Skill 事实。

妙搭前端正在独立 `origin/sprint/default`（当前只读核验 SHA `2926a9cb36bcf92d09ff219a3c6875b8fc76bf68`）进行重构，与 codex 共同祖先为 `77f2a56d4eacecd31e4a501630ee5fe3985fb25a`。隔离合入试算产生 49 个冲突，其中 43 个为 client，另有 package 与 3 个后端重叠文件；前端基线和 Host 后端不能整边覆盖。发布前需由双方 owner 接受准确前端/后端组合；本记录不表示前端已发布或本批修复已上线。

schema 集成审查已确认：sprint 的 `schema.ts` 虽包含五个文档/搜索表声明，当前 Host 已将它们拆分在专用 schema 文件并由现有服务实际消费，不能整段覆盖。两项明确风险是 `uk_dm_parse_active` 在 sprint 版本为无条件唯一、会限制终态历史行；当前版本按 `RUNNING/STAGING` 使用部分唯一约束，必须保留。另一个是 sprint 将 `search_vector` 声明为普通 text，而当前 Host 使用生成的 PostgreSQL `tsvector` 加权列，搜索语义不等价。前端通过稳定 API 接入这些能力，不直接依赖表对象；后续以当前拆分 schema 为准，逐项对齐 API，不复制表或降低约束。

## 2026-09-14 工作12：正文更正链成功，整体综合仍待一致性核对

19:40:19 单次获准的官方 operator cron run `manual:efc2b938-2bab-4f6d-ab8d-14ca3de9fa70:1789386019695:4` accepted/enqueued；未修改 schedule 或退避。后继 `AQ-8d7d6201397c4f7f832ef6a785c6283d` 已 `SUCCEEDED`、`errorCode=null`。正常 Matter 页面 HTTP 200 读回工作12 `MWREV-e7147367-025f-4d85-9fc3-9038530a1f92`（保存时间 `2026-09-14T11:41:43.980Z`）。

工作11与工作12逐问题比较，五个问题中仅 `claim_ftd_787_45_25001_unrelated` 发生变化，其余四个问题 JSON 相等；更正正文明确未知依赖不能推导完全无影响或必须提高优先级。旧 `understanding` 和 `requirementHandling` 仍含绝对“无影响”表述，页面已标注相关判断与总体认识仍需一致性核对、现有综合尚未覆盖。因此本次仅接受正文更正保存链成功，不能认定整体工程验收完成。Host `8b706172a97a83d837b869bec6ab4d8def24e519` / release `7685315995439729883`、Skill c103 不变。

## 历史记录：2026-09-14 c103 安装窗口（已完成；业务更正结果见顶部工作12）

本批仅调整 Skill 侧更正生成的请求边界：读取 Host 下发的任务 `deadline`，在调用 `GENERATE_ISSUE_CORRECTION` 前拒绝无效或已过期 deadline，并将有效剩余时间限制在现有 30 分钟范围内；通过 MCP SDK 第三参数只向该生成操作传递 timeout，其他 Host 操作继续使用默认请求选项。没有修改 Host、数据库、RLS、模型配置或业务数据，也没有触发新的业务任务。

本地定向验证由 M 报告为更正测试 7 项、消费者测试 17 项通过；本提交只记录该验证结果，不重复全套测试。Skill 源码及版本声明从 c102 推进为 c103，c103 已按授权窗口官方安装。当前 Hosted 基线仍为 Host commit `8b706172a97a83d837b869bec6ab4d8def24e519` / release `7685315995439729883` 与已安装 c103；三个 job 安装前已暂停且无活动消费者，随后已逐项恢复。安装与恢复不等于业务更正验收。

## 历史记录：2026-09-14 更正候选 c102

本批围绕工作11的工程问题更正接线，新增 Host 的来源绑定上下文、官方插件生成、持久回执、SAVE/FINISH 与事项消费者分支；Skill 从 c101 原位推进为 c102，继续使用显式更正目的和同一事项 ActionAttempt。新增/修改内容均仍是技术候选，尚未发布 Host 或安装 Skill，不代表线上已具备这些入口。

本地验证已完成：服务端 typecheck 退出0；目标真实 PostgreSQL 场景退出0（两连接并发下单次生成、事务外调用与心跳、SAVE/回放/CAS、目标问题替换及其他问题保留、定点更正任务 SUCCEEDED、完整工作仍 IN_PROGRESS/综合 STALE、插件失败后旧工作保留且不重生成、producer/model/usage 边界）；此前相关契约、读取、插件、消费者和 Matter 测试继续通过。测试使用合成插件与本地数据库，不是线上业务运行，也不代表 H1/H2 全部完成。

现场安装回执已确认：Hosted 当前仍为 Host commit `8b706172` / release `7685315995439729883`；c103 官方安装成功，48 个包文件一致，仅额外存在安装器生成的顶层 `.openclaw/source-origin.json`。三个既有 job 安装前已禁用且无活动消费者，安装后已恢复并与备份逐项一致。当前 Matter 页面仍可读工作11，既有矛盾待 M 按正常入口继续处理。

安装后、19:40 恢复前的历史状态：曾创建唯一正常后继 `AQ-8d7d6201397c4f7f832ef6a785c6283d`，requestId 为 `rev6-work11-official-correction-c103-20260914`，当时为 `QUEUED`，绑定事项3/工作11，尚无新的 workRef。未强制 cron、未修改退避；该历史状态不代表工程更正完成。近期 Matter job 第10次失败及约19:47:27的自然 nextRunAt，trace 已收窄至旧自动请求/绑定 prior work 读取路径，具体根因仍未知，不能与独立 file metadata 失败混同。后续工作12已在顶部记录。

## 2026-09-14 工作11有界更正后继仍在生成层停止（13:24）

补读上次AQ-bc2ed930c12240c68399e30fb9c85499的原生会话ab64f754-c2a4-4e0c-aeaa-c11fe4fb1e71，仅核对停止/用量/内容类型：04:36:43.785Z、04:38:23.953Z两条均length/output16000/contentTypes=[]。因此该次400现在已有原生预算耗尽证据；此前仅HTTP回执时保留未知的记录不反向改写。没有读取或保存原始推理正文。

用户继续后，正常begin基于事项3/工作11建立AQ-49bc8763a4734c9e991150704aa1eaa1，requestId rev6-work11-bounded-correction-20260914，recoveryAttemptRef指向上述已FAILED请求。保留完整证据上下文，仅要求FTD问题与必要综合的一致性更正，明确不重抄原文和历史列表、不重发其他四个问题。原cron仍在next_matter_assessment失败退避且无活动，通过既有cron run单次领取（manual:efc2b938-2bab-4f6d-ab8d-14ca3de9fa70:1789363256865:3），实际SOURCE_CONTEXT_ONLY，未重放失败载荷。

本次首轮仍HTTP400/incomplete_result/142B，HTTP无finishReason/usage。原生会话816fd6c9-f2ca-4cdb-b8fe-1fc38d2fe2a8于05:22:45.482Z、05:24:21.175Z均length/output16000/contentTypes=[]；对应输入计量input84429/cache1396及input41411/cache85808。两条原生生成不等于一份32000正文；申请16000用尽不证明所有入口统一硬上限。未到SAVE、未生成完整候选，13:24:22+08正常FAILED/JOBAID_INCOMPLETE_TERMINAL_RESPONSE，scopeAdjustments=0。online工作仍11/MWREV-80e00698-98ce-42c9-998a-5b073e2d960e，已保存内容未丢失。

本轮不再原样重试、不扩额度、不改解析/翻译或权限，不宣布FTD判断矛盾已修复。后续需在能交付完整载荷的运行条件下继续该更正；现有工作和确切来源继续可读。Host仍2fc3190b、Skill仍c99；正文拒绝引用反馈补丁已在源码但尚未安装。空闲next_matter_assessment退避问题独立保留，未用放宽来源权限处理。

## 2026-09-14 rev6实际工程正文工作11已保存；定向内容和引用验收

后继AQ-ccf484fd55cc4b2fa6c978e4335df615由自然调度运行，原文读取后首次SAVE因SOURCE_NOT_DELIVERED被拒；自动更正后按JA-save-47c18b20-330f-469a-8f2b-bc586e229e77保存工作11 / MWREV-80e00698-98ce-42c9-998a-5b073e2d960e，于12:27:26+08正常SUCCEEDED。已按原request读回并在现有页面读到正文及rev6引用。FTD段落现在包含触发条件、Scenario1/2恢复、预防建议、Final Action无固定日期、TBD里程碑；未变四个问题保留。这是实际工程消费，不再只是读取数量；仍是候选，不是正式采用。

验收发现正文仍同时说工程依赖未确认和FTD绝不影响SB优先级，已通过正常后继进行局部一致性核对，禁止用厂家未收到报告推断零风险。首个FTD工作已落库，不因此认定全部内容质量通过。页面FTD待覆盖项已消失，其他材料仍有各自未覆盖范围。

真实引用点击暴露旧Matter页码阅读器不支持parseRun来源，错误从第1页浏览。最小前端适配改为根据已保存locator中的parseRunId/sourceRefId进入现有精确DocumentVersion Reader，不猜页码、不切latest；6项目录/路由测试及client生产构建通过。Host2fc3190b已发布，release7685244300590975936 finished/errors=[]/commit匹配；线上从工作11点击来源，实际进入rev6/u6:p0的确切URL并加载原文，不再进入旧页码弹窗。另发现Skill仅识别独立引用字段，正文内[[ref]]的精确拒绝反馈被遗漏；已定向修复，4项错误边界测试通过，尚未安装，不用于证明本次自动更正。

工作11内容一致性后继：AQ-bc2ed930c12240c68399e30fb9c85499，requestId rev6-work11-consistency-correction-20260914，CAS事项3/工作11。自然运行后于12:38:25+08正常FAILED；首轮HTTP400、142B、无完整函数参数，finishReason/inputTokens/outputTokens均未提供，JOBAID_INCOMPLETE_TERMINAL_RESPONSE，scopeAdjustments=0。申请16000不是本次截断证据。未到SAVE，工作11完整保留；正文中“工程依赖未确认”与绝对优先级结论并存的问题仍待有界更正，不宣称质量全部通过，不立即原样重试。

## 2026-09-14 撤限后真实正文保存成功；FTD实质覆盖继续

Host6995d8a / Skill c99，经既有Matter cron正常恢复（manual:efc2b938-2bab-4f6d-ab8d-14ca3de9fa70:1789359508786:2），复用round2完整载荷及原SAVE requestId JA-save-bb7f30aa-11e5-4a15-b748-76ec5be874ed。1316字符摘要未缩写、正文未截断，保存工作10：MWREV-3d93ee31-85c9-45ce-9544-6b3fe5237d9e。READ_SAVED_WORK按原request准确读回，现有事项页面显示工作10及正文。AQ-94dd26cde9be4c01893e930023663780于12:19:02+08正常SUCCEEDED，保存后自动第三轮FINISH。此次证明保存与回执恢复，不计为两次新增工作保存。

内容核对：工作10主要完成历史SB/SL/Win7候选更正，FTD问题未引用rev6实际原文；页面仍正确显示FTD“已读片段，尚未保存分析或比较处置”。摘要数据库阻塞已关闭，但不能以work10冒充首份新FTD实质分析。未改变正式采用状态。

正常后继AQ-ccf484fd55cc4b2fa6c978e4335df615（requestId rev6-substantive-work10-followup-20260914），CAS事项3/工作10，明确处理rev6/semantic1的FTD问题、措施条件及限制；历史第14轮指令不是本轮请求。要求使用正常读取的确切引用、完整更正FTD问题、保留其他有效工作，正常SAVE。初始QUEUED，后续真实回执待核对；不重解析、不重翻译、不改模型额度。

## 2026-09-14 用户决定取消摘要长度上限（c101）

用户明确要求“不需要限制”，替代上一节c100精简至1000字符方案。撤销尚未部署的c100上限与缩写反馈；Host正文物化、事项资料接口/Repository和Skill契约均取消摘要字符上限，仅保留非空。0056迁移将事项修订及工作修订两个摘要CHECK改为非空，dev→online审查仅6条成对约束变更，正式migrated/changes_applied=6；online精确读回两者均CHECK(length(btrim(change_summary))>0)、convalidated=true。无数据删除、权限或RLS变更。321 Skill测试、8正文物化测试及server build通过。已安装c99本身没有摘要长度上限，c100未发布/未安装，不应再使用其安装包。Host发布已完成：release7685237857560497122 finished/errors=[]/commit6995d8a3349c0d70ec33833882b2ad57aa23ba19；线上摘要CHECK已仅非空且validated。当前Skill仍c99，无需为本条撤限重复安装c101。

## 2026-09-14 c99 实际保存失败已定位；c100 定向修复

c99正常后继 AQ-94dd26cde9be4c01893e930023663780 已QUEUED；原Matter cron存在next_matter_assessment连续7次错误退避。本轮在用户相关操作授权内，通过官方cron run对该既有任务执行一次（不改schedule），runId manual:efc2b938-2bab-4f6d-ab8d-14ca3de9fa70:1789357533773:1。实际进入RUNNING、COMPLETE_CANDIDATE，精确反馈旧候选顶层openQuestions/reviewConditions。round2返回HTTP200/tool_calls、37295B函数参数，报告input91297/output11555。此轮是实际新更正；round1为旧完整候选复用，不计为新生成。

实际SAVE requestId JA-save-bb7f30aa-11e5-4a15-b748-76ec5be874ed，trace c85765bff037ecba41c52e26bb22b184。数据库INSERT拒绝 ck_engineering_matter_work_revision_summary（change_summary去空白长度1—1000；c99 round2候选去空白后实际1316字符）；程序先前未表达该上限，故未作为明确JOBAID字段错误反馈。按原request两次查回null，工作仍9，无新workRef。相邻文档调度manifest元数据fetch failed不作为此次SAVE根因。旧c98终态不改；当前c99保存没有被伪造成功。

c100将既有数据库摘要上限原位对齐到Host物化校验、模型字段shape与精确反馈，按Unicode字符计数；仅要求精简变更摘要，不截断正文，不放宽数据库约束，不新增迁移或增加更正次数。Skill321项与Host正文物化8项通过，构建/发布安装待完成。本次修复按code-fix、coding-guide执行。

## 2026-09-14 c99 已安装，完整候选后继验收

用户明确授权本轮相关操作后，c99 安装包通过原 Host 存储的 600 秒链接进入原 Hosted 应用；包大小 385769B、SHA256 03a7afdf238f829563e448de0a6a51c5481c96697c255b70655b52362220a833 一致。链接首次因存储应用与接收应用的授权对应被自动审批拒绝；补齐只读文件元数据和相同接收方证据后通过，随后一次网络 EOF，原操作有界重试成功。未改变接收方或时长。

仅暂停三个明确既有 job，确认均 disabled、runningAtMs=null、活动消费者0后，经官方 skills install 更新；47文件匹配、installed320项全部通过。三个 job 的 enabled/schedule/payload/agentId/sessionTarget 已与安装前逐项比较一致，THREE_JOBS_RESTORED_EXACT。Host仍8cc425b，无业务源码变更，不重复发布。

当前线上读回：c98 AQ-3c1ae0cba08a41c881311c7176bf9147 已于2026-09-14 10:00:57+08进入TIMED_OUT，并非本轮c99将其FAILED；工作仍9。既有 reserveJobAid 允许 FAILED/TIMED_OUT 的准确绑定恢复，完整候选保留。c99 后继已通过正常 begin 创建：AQ-94dd26cde9be4c01893e930023663780，requestId `rev6-complete-candidate-c99-20260914`，状态 QUEUED，正在验证字段更正、SAVE 和确切读回；尚不能宣称已有新workRef。

## 2026-09-14 c99 字段反馈及明确拒绝收尾（待安装）

c98真实后继成功进入SOURCE_CONTEXT_ONLY，并取得完整函数载荷：round1 FINISH未保存被拒，round2 SAVE_WORK约39669B参数，round3再次SAVE。Host拒绝JOBAID_UNDECLARED_FIELD：顶层openQuestions/reviewConditions/workRevision不属于更新契约，round3仅去掉workRevision。未产生新workRef。c98反馈只报告泛化错误，类型诊断未枚举未知字段；更正耗尽后普通异常也未进入任务终态。

c99精确返回未知字段路径及该层allowedFields，要求模型将实际未知/复看含义放回正确字段或正文，不由程序删字段或修补候选；达到原有更正上限且明确Host工作校验拒绝时，正常FINISH FAILED/JOBAID_WORK_VALIDATION_FAILED，未知SAVE响应仍不判终态。320项通过，未增加纠正次数、不改模型/额度/Host，待官方安装后先正常收尾旧在途，再按完整候选后继路径更正并保存。 c99源码5f32ae8c已双远端同步，包385769B/SHA256 03a7afdf238f829563e448de0a6a51c5481c96697c255b70655b52362220a833已生成上传。自动审批拒绝按快照暂停任务，认为可能无差别禁用未授权任务；未执行该暂停、未安装c99，已请求仅三项既有任务的升级窗口暂停/原样恢复授权，不换方式绕过。实际安装仍c98/Host8cc425b。

## 2026-09-14 c98 已取证后继恢复（已安装，正常后继运行中）

在现有正常后继中增加 SOURCE_CONTEXT_ONLY：旧精确回执必须是已明确结束的函数通道失败，模型/输入/请求哈希一致；不重放错误或半成品，由 Host 已有 reserveJobAid 重新授权并复制实际读取证据，后继以当前完整工作与这些证据生成。完整候选仍走原恢复分支。一般502、响应未知、来源/模型/绑定变化不放宽。新后继保留正常SAVE、CAS及完成条件，旧任务不复活，不改模型预算。Skill c98 318项通过（含后继使用Host证据、正常保存和同会话FINISH、未知响应/绑定拒绝）；源码8453ea6c已同步两远端；c98官方安装47文件匹配、installed318项通过，原三job恢复。包384941B/SHA256 09ba4e488702b4660cbd7690332aff998ab6d0ebf951fab2733adf540c8c218b。本次仅Skill改动，Host8cc425b未重新发布。正常begin recoveryAttemptRef指向已FAILED c97任务，创建AQ-3c1ae0cba08a41c881311c7176bf9147，requestId rev6-source-context-c98-20260914，CAS事项3/工作9，created=true/QUEUED，自然调度实际选择SOURCE_CONTEXT_ONLY，输入含56条Host授权deliveredEvidence，未重放旧失败输出。首次等待来自原事项job此前next_matter_assessment四次失败后的既有退避；到期后已正常领取RUNNING。真实正文保存仍待回执。

## 2026-09-14 正文 v3 / c97 集成窗口（已部署，真实后继已失败且未保存）

本批将问题正文直接作为工作保存：`issueKey/question/body` 与确切正文引用，专业结构按用途提供；未变问题保留、同问题完整替换，综合 CURRENT/STALE/NOT_AVAILABLE 分开。Host SAVE、Review、Reader、搜索和恢复消费者已改用正文；不再生成假的旧 statement。历史 v2 仅只读投影并标注，线上工作修订9的5个问题、14条原主张已用新读取代码验证，旧工作引用与数据库记录保持。

本地证据：Host/Client production build 通过；Skill 316 项通过；正文/历史/搜索14项、读取UI相关16项（含重叠）、现有Matter消费者/工作状态25项及JobAid续接29项通过；隔离真实PostgreSQL12项通过，覆盖CAS、回执丢失回读、索引失败后恢复、actor/tenant与来源权限、取消迟到写入及Review原子保存。测试是构造/本地验证，不代表新的线上工程认识。Review相关检查额外发现并修复正文覆盖仍遍历 statements、body@位置被错误过滤的问题。

部署证据：用户恢复登录后，三个既有 job 的原配置已保存在 Hosted 临时文件；官方暂停并确认 runningAtMs 均为空、无活动消费者后，发布 Host `8cc425b23457f0c1b39ff4f3c57564b8ddfe7175`，release `7685179634351295687` 最终 finished / errors=[] / commit 一致。publishing 中间回执曾显示旧96d，不作最终版本。c97包382955B、SHA256 `1e73b71decf6a665038b0cfaa5b297eb2ca3f634a6622342cfb95f0abe1ca682`，经用户已授权600秒链接进入原Hosted、下载校验后官方安装；47文件全部匹配，installed316项通过，Host MCP身份及工具合同验证成功。三个job已恢复原enabled/schedule/payload/agentId/sessionTarget，无强制run。

正常 begin 后继 `AQ-4ccad3195a404a1db23c0bdeda1ba8c4`，requestId `rev6-body-first-c97-20260914`，CAS事项3/工作9，created=true / QUEUED，由自然调度处理。保持rev6/semantic1，不复活旧任务、不改模型配置、不重跑原件或中文。本次最终 FAILED，工作仍9/MWREV-19bb8855-40ce-4017-a349-6b9c62debcd4，无新FTD workRef，技术部署不能代替真实保存验收。

本次运行：自然调度实际使用c97/continuous-body-batches-v3，前两轮HTTP200/tool_calls，实际两次MATTER_ORIGINAL_READ；第三轮HTTP502/TOOL_CHOICE_NOT_SATISFIED，142B错误回执，无完整函数参数，未到SAVE。原生会话 `fe217ed7-7864-4a91-8197-ec3f5abd5dfe` 最后一条2026-09-14T00:33:12.266Z为 stopReason=error、content=[]、报告用量0，errorCode=`RateLimitExceeded.EndpointTPMExceeded`、errorType=rate_limit_exceeded、errorMessage“系统开小差了，请稍后重试”；已确认端点TPM限流，本次未观察到length，不归因16000截断。0仅为错误记录中的报告值，不证明上游无消耗。适配器记录JOBAID_INCOMPLETE_TERMINAL_RESPONSE，online error_code为null。保持旧任务终态，不重复发起相同生成、不改额度、不修补部分JSON。恢复前核对发现：Host会复制已授权实际读取证据，但Skill `readMatterRecoveryCandidate` 要求旧回执ok且完整SAVE_WORK/FINISH载荷，当前错误回执不满足；因此尚未创建恢复请求。下一修复应在现有后继中区分可重用完整候选与仅已取证的失败，仍拒绝未知保存结果及绑定/模型/来源变化，不引入新调度器。

后续未完成：首份FTD正文、同会话连续保存及最终综合；跨事项Hosted检索/准确旧工作引用/双向使用与来源更正完整消费尚未接通。本批正文索引和页面可读只解决其基础，不作为跨事项知识复用验收。


## 当前运行窗口（2026-09-13，M 负责）

按用户最新意见，以英文解析字面精度、章节/表格/条件语义及实际工程消费为主线；中文仅作同源匹配阅读辅助，不再以翻译完成率作为主验收。前端改版继续暂缓。下表覆盖后续历史记录中的旧阻塞说法。

| 项目 | 当前事实 / 下一动作 |
| --- | --- |
| Host / Skill | Host96d01a81d / release7684974107020594155已finished，Skill c96已官方安装，47/47文件匹配、installed315项通过。原三个job在安装窗口短暂停用后已恢复enabled/原payload/原schedule，未强制run |
| online RLS | 用户授权后完成dev诊断及恢复；正式0054差异仅旧名DROP+新名CREATE，官方迁移2项。online旧policy已不存在，新policy支持DOCUMENT_VERSION，独立文档/actor/tenant/原生禁写保留。旧策略阻塞已解除；正常START已实际QUEUED：DTQ-6eae3abb-fdad-4dbd-8649-72ef2faef3f4，workspace TW-f9b7e6dc-ded2-49ee-988f-3c78212fac3f，errorCode=null |
| FTD rev6 | DV document_version_b83523c2b5ba26a2b1753641，parseRun PRUN-c537f5bb-cc97-4ce9-855e-ca8d53e15a31。c8/c88自然PUBLISHED，原件/manifest字节与SHA、2表/编号/条件/页脚实件核对保留，SOURCE41条、pending0。不能用此证明e9/c89或新语义补丁已运行 |
| 语义持久结构 | 0055正式dev→online迁移16项，仅新表/约束/索引/RLS/不可变触发器。online读回RLS=true、4policy、1不可变trigger、1已验证FK。正常INDEX已保存rev6语义修订1，boeing.ftd.sections.v1、12章节。正常read_document_original确切读回，Final Action返回u28/u29及两个SourceRef；原文manifest SHA保持d8237d00…不变 |
| 本批接线 | 已实现INDEX保存首个来源绑定语义修订、确切章节读取；Matter新任务输入固定semantic revision/profile，旧任务不附加latest。JobAid任务含原文语义map。真实PG发现并修复JSONB键顺序导致的假覆盖错误。Host/Skill已部署；c90还修复消费端丢map并拒绝语义修订漂移。实际工程保存待自然调度验收 |
| 运行剩余 | c96正常后继AQ-002cd57f3b644a99960cde8244a1d50b已FAILED；两轮READ_SOURCES成功，第三次HTTP内部两次length/output16000，被网关遮为502。无SAVE，线上仍工作修订9，无新FTD workRef；已停止扩大拆分。中文21块及b20局部补丁范围不变 |
| 验证与界限 | 新语义RLS/CAS/不可变/准确读回真实PG通过；Matter真实PG4组通过；章节/Reader/JobAid续接45项通过；server类型通过。原PDF每步读取与最终整包组装仍有成本；真实SB/H2、语义更正后的业务续接和首份新工程工作仍待完成；首批中文已保存并经Reader实际阅读，完整中文仍未完成 |


### 2026-09-13 实际容量测试（覆盖此前短探针的能力界限）

同一官方Hosted M3路由、独立诊断会话、thinkingLevel=low、纯构造数据：382372输入token的六处随机值与六项条件判断全部正确；893180输入token请求成功，但随机值仅2/6、条件4/6，内容未通过。长输出申请65536，三次原生生成各length/output16000，HTTP400且无完整函数载荷。配置修改不是完全无效，但不能认定百万可靠上下文或高生成上限已实现。

工程Agent目录models.json仍保留false/16000/256000，与官方config及网关目录不同；实际输入超过256000，因此不能只凭该文件认定唯一根因。本轮不改配置/部署、不读业务来源、不SAVE、不创建工程业务请求。测试方法、会话、用量和限制见 [实际容量报告](M_MODEL_CAPACITY_TEST_20260913.md)。首份新FTD工作仍未产生，下一步回到实际工程交付，避免继续扩大压力测试。

### 2026-09-13 用户调整模型配置后的实测（当前有效状态）

用户调整界面后，官方config读回M3 reasoning=true/maxTokens=1000000/contextWindow=1000000；gateway models.list（首次10秒超时，30秒只读重查成功）同样返回reasoning=true/contextWindow=1000000。此前false/16000/256000仅为调整前事实，不再代表当前。

独立诊断会话7e7e1c23-8e66-40e6-b258-98fcba126078接受thinkingLevel=low；同一官方Hosted工程路由发出一次32768预算的纯构造算术请求。HTTP200/finish_reason=tool_calls，configuration_probe_result返回value703（37×19），prompt41478/completion93。原生会话确认provider=miaoda/model=minimax-m3/stopReason=toolUse，内容类型thinking+toolCall；仅检查类型与用量，不读取或展示内部推理正文。无工程资料读取、无Host SAVE、未创建工程业务请求。

结论：界面设置已写入并影响运行态，Low从拒绝变为接受，实际M3函数通道成功。短请求不能证明真实生成超过16000或上下文承载100万；请求32768被接受也不等于上游最终有效预算已实测。WiseLink JobAid代码仍显式申请16000，界面上限变大不会自动提高其单次申请，后续业务验证须分别记录。

### 2026-09-13 单会话参数入口核验（设置被拒，未生成）

官方安装版支持 sessions.patch 的 thinkingLevel；原计划只对正常后继设置low，保持部署c96/模型/16000预算与工程方法。短暂停用事项job且确认无活动后，经正常begin建立 AQ-eea0568bfd344e64b747d4ad07bbab4c（requestId rev6-session-low-20260913，CAS事项3/工作9）。网关明确拒绝 `thinkingLevel "low" is not supported for miaoda/minimax-m3 (use off)`。未启动模型；新请求已正常CANCELLED，原事项job恢复enabled。未修改全局参数、未复活旧任务、无新SAVE。

随后官方config get models.providers.miaoda.models读回当前定义：minimax-m3，reasoning=false、maxTokens=16000、contextWindow=256000。这与此前另一模型目录524288/1000000的观察不同；不反向改写历史请求事实。当前本地配置本身存在上限及推理能力禁用，不能继续将该现象全部归到不可见平台上限。安装版额外参数可按agents.list参数覆盖，但实际配置及网关config.get均无agents.list，未为试验新增/更改默认Agent路由。

调度曾返回历史成功AQ-4ea1f8287e434772a85b4d74a791ebe1为REQUIRES_ATTENTION；正常STATUS确认SUCCEEDED、deadline06:55:37Z，早于c96失败，不能冒充新FTD工作。nextForRuntime现有同来源幂等键可返回历史终态，此处不是新的模型调用。

### 2026-09-13 生成路径诊断与本地修正（未部署、未重发业务）

本次经官方 `openclaw logs` 取得关联日志，空响应重试已由推测转为确认：UTC 11:15:29.473，runId `chatcmpl_0339bc81-698e-4da4-b42e-cdb2a254dda5`、session `af81f3b0-3d53-43ec-bd75-8435b7aeb9f9`、provider `miaoda/minimax-m3`，记录 `empty response detected ... retrying 1/1 with visible-answer continuation`。安装版本 OpenClaw 2026.6.6 (8c802aa)，embedded-agent 的空响应重试上限固定为1；该次重复归属于托管内部，不是新工作批次。网关函数约束失败返回502时未携带原生停止原因/用量。

WiseLink 本地把同一 HTTP 响应中已有的单一 `choices[0].finish_reason=length` 判断移到 HTTP 错误之前；不解析部分函数、不用错误文本猜 length。当前生成策略 v2 禁止自动缩小范围重试（maxScopeAdjustments=0），连续上下文和正常 SAVE 后继续保持。尚无平台新增错误元数据合同，不虚构字段适配。44项定向测试通过，覆盖200/502明确length、无原因502、空文本有效函数以及A已保存后B截断不重放；未部署该修正。

有效上游请求、原始响应到归一化记录的字段转换仍未闭合。c96申请16000，不作为硬上限证据；c93大额度另查。不更改RLS/解析/翻译/Host保存，不修改安装版打包JS，不重跑FTD。取消平台支持入口和支持契约作为前置条件；仅核对安装代码中可确认、可控制的路径，未知上游信息如实保留。后续依据本地证据选择单变量验证。

### 2026-09-13 c96：连续会话与动态问题组（已部署，真实后继失败已核验）

按用户最新方案，限制单次交付量而非工程理解范围。同会话已有初始材料只发送一次、后续使用工具回执的路径保留，问题组数量由 Agent 选择，SAVE 后自动继续，最终只更新综合和必要纠正。Host 允许后续批次省略未变化 headline/listBrief/understanding/decisiveIssueKeys；仅省略时保留确切已有值，显式 null/空值继续校验，首次工作仍需完整主旨。轮次状态、完成说明和本批变化仍明确提交。同 issue 完整替换、权限/SourceRef/CAS/原 request 回读保留。

删除 JobAid 旧 checkpoint 的 524288 兼容预算分支；策略不一致拒绝原地续跑，使用正常后继，不复活失败任务。当前策略 continuous-issue-batches-v1，请求16000、载荷软目标2000–4000；可靠length只减少本批交付，不要求最小化工程问题。未知502仍不猜测。

本地：连续多批与最终综合/同会话不重发初始材料等41项；Host物化18项；Skill完整315项及server build通过。新测试覆盖两问题首批、第三问题后续、稀疏综合、无原工作拒绝、null拒绝、退役决定性问题须更新引用、不完整同issue替换拒绝。Luna已将96d01a81d同步双远端。Host release7684974107020594155 finished/errors=[]/commit一致。c96包385092B，SHA256 69bf580e33af451de0c164f6520930cf6bb0aae99ff8edae2a2ed0bdd5f56b2a，47文件；官方安装315项通过，三job完整恢复。用户明确批准本次及后续同类安装包短期链接操作。正常begin新后继AQ-002cd57f3b644a99960cde8244a1d50b / requestId rev6-continuous-batches-c96-20260913，基于事项3/工作9，created=true/QUEUED，由自然调度推进。真实后继：同一session af81f3b0-3d53-43ec-bd75-8435b7aeb9f9，前两轮HTTP200/tool_calls/READ_SOURCES，completion701/433；第三次HTTP调用内部两次原生length/output16000，UTC11:15:26.610及11:17:11.460。前者公开文字为空，后者只有准备保存说明，均无工具载荷；HTTP仍502。MCP STATUS确认FAILED/errorCode=null，deadline12:12:37.906Z；online工作仍9/MWREV-19bb8855-40ce-4017-a349-6b9c62debcd4，无新SAVE。三job最终enabled=true/runningAtMs=null。

安装入口源码有max_completion_tokens映射，未直接出现reasoning_effort/thinking/thinkLevel；官方config get agents.defaults.thinkingDefault返回path not found。没有据此推断全部平台不支持，也没有猜参数、全局禁用推理或再拆问题。原生length被502覆盖及任务级有效配置仍需平台契约/实现证据；本机平台材料已追加本次精确复现，尚未发送/受理。真实多次保存、最终综合和保存后恢复仍未验收，未删除线上测试数据。

### 2026-09-13 c94/c95：有界生成与实际参数传输修复

按用户新设计完成有界问题生成、简短SAVE回执、同会话同版本完全相同metadata去重；原文、units、SourceRef及变化限制保持。新增策略随assessment-enabled和每轮参数持久化；旧checkpoint缺策略时保留524288。可靠length不执行部分JSON，最多两次范围调整并计入既有总预算；耗尽走Matter既有FAILED收尾，已保存工作保留。Review同类函数缺失502不作瞬时HTTP重试。后继恢复读取同步识别策略参数，拒绝length载荷作为可恢复候选。

提交a0a702c2c已同步双远端。本地JobAid 39项、Host物化17项通过；正式安装后Skill 313项通过，47/47文件与包一致。ZIP383985B，SHA256 aadd0a0614e3f2b987c1b39c2b1b0d04252665f46904192574dcfa68b4b84f19。仅Skill更新，Host无需重复发布。三个job无活动时通过官方CLI短暂停用，安装完成后已执行恢复；旧c93经官方MCP STATUS仍FAILED。c94正常后继[内部引用已脱敏]已由原生调度运行。首轮HTTP502无函数，原生实际多次READ_SOURCES sourceRefs={item:单个引用}未通过工具schema，末次stop而非length；因此不得追认为16000截断。本轮未到Host读取/SAVE，scopeAdjustments=0，无新FTD workRef。c95定点允许sourceRefs单元素包装，无损转数组，其他字段/来源权限保持；提交7cd0c10d5已双远端同步。官方安装后47/47文件匹配、314项测试通过；包384247B，SHA256 7e8a44c8208138feb97d38e031153aa70a495ddef092fe578e01d17692b50dc2。原三个job已执行恢复。c95正常后继[内部引用已脱敏]已QUEUED，requestId=[已脱敏]，基于事项修订3/工作修订9；正常调度实际两轮READ_SOURCES成功，报告completion2732/4390；第三轮2026-09-13T09:18:08.556Z原生length/output16000（input15692/cacheRead95292），仅公开准备保存说明，无workJson。sessionId=[已脱敏]。普通HTTP仍502且finishReason/usage为空，因此scopeAdjustments保持0，未猜测根因或重试。MCP STATUS已FAILED，online只读最新工作仍修订9/[内部引用已脱敏]。两个读取轮次同版metadataCount=1。未证明实际分次保存成功；仅本地/安装测试证明保存A后生成B失败保留A、原request丢回执可查回及最终空issues综合物化。

### 2026-09-13 c93 后续诊断：原生截断被网关函数错误覆盖

继续只读核查同一AQ-8bb65240，而非发起新业务。实际会话位于Hosted工程profile的sessions目录，sessionId为18c4daea-ad64-46ec-9809-78e622d75811；默认CLI只列main且sessionKey已小写化，先前默认列表无结果不代表记录不存在。

原生最后assistant记录（2026-09-13T07:27:49.788Z）明确provider=miaoda、model=minimax-m3、stopReason=length、usage.output=16000，input=11985、cacheRead=121766。公开text仅为准备形成并保存工作的说明，没有SAVE载荷；不读取或输出thinking/analysis。trajectory同轮aborted/externalAbort/timedOut/idleTimedOut均false、compactionCount=0。故此次失败应进一步认定为原生生成截断，不再仅称完整返回但不合协议。网关先检查toolChoiceConstraint，未满足便502退出，因此没有把原生length和usage送回调用方。

实际已安装网关入口将max_completion_tokens转streamParams.maxTokens；工程模型目录maxTokens=524288、contextWindow=1000000、compat.maxTokensField=max_tokens。这些代码/配置仍不能证明最后上游请求额度；16000限制实际落点尚未确认，不再次增大同一配置或把旧公开text手工写成工作。继续核对attempt-execution、embedded-agent和extra-params，均保留streamParams/maxTokens传递；已安装miaoda/miaoda-coding扩展的文本相关搜索未找到16000常量或额度覆盖（仅发现无关视觉32000）。全局M3模型配置只有alias，无专属params覆盖。以上为源码检查，不冒充本轮最终线上请求抓取。

现有有界网关日志保留本轮上游请求关联，但没有最终token参数；下一项所需证据是该请求的有效max_tokens/max_completion_tokens及平台实际限额。平台核查材料已在本机/private/tmp/wiselink-c93-upstream-diagnostic.md整理，尚未发送，不称为平台已受理。本轮未修改Hosted配置、暂停job或发起后继请求。

另已量化重复输入：最后仅读u41页脚时，响应仍有semanticMap约14813B、findings9864B、coverage6522B（按本机ensure_ascii=False JSON统计）。这是重复传输成本证据，尚不是本次输出截断的因果证明，不能通过删掉必要条件与来源来凑小输入。rev6/semantic1及工作修订9保持，不复活失败任务。

### 2026-09-13 c93：结构化返回通道与新 FTD 工程保存

用户最新优先级已写入执行计划：当前首要交付是有效取证后的普通工程工作保存与确切读回。8c947e64e已同名开发分支非强制推送origin及GitHub；只修改Skill，不据此重复Host发布。

实际Hosted OpenClaw 2026.6.6安装源码确认：HTTP入口读取payload.tool_choice，指定函数会筛选工具、加入必须调用该函数的运行约束，并检查实际pendingToolCalls；未匹配时HTTP502明确错误。c93将JobAid请求从auto改为指定return_wiselink_assessment_step，仍由模型选择READ/QUERY/SAVE/FINISH；不增加纠正轮数、预算或模型路由。既有形态回执新增requestedToolChoice，精确的已知502无匹配函数错误走现有失败终态；未知传输和截断保持原边界。35项定向测试及完整Skill打包通过，保存回执丢失可查回、未保存不得结束均保留。

新请求经正常begin_matter_assessment建立：AQ-8bb65240af8f4166a761933ffd9ecce5，requestId rev6-semantic-named-channel-20260913，基于Matter修订3和工作修订9；旧AQ-0f669仍FAILED不复活。正常调度前三轮均HTTP200/finishReason=tool_calls，实际回执带指定函数channel；Host保存的READ_ORIGINAL回执为20+20+1单元，offset0/20/40、最后nextOffset=null，每次semanticRevision1及同一profile。第四轮2026-09-13T07:27:52.670Z返回HTTP502 / TOOL_CHOICE_NOT_SATISFIED，原始响应明确未产生所要求的函数调用，142字节，无可用工作正文或token计数。未到SAVE_WORK。正常消费者已将任务收尾为FAILED，assessment-execution.failureCode=JOBAID_INCOMPLETE_TERMINAL_RESPONSE，配置路由miaoda/minimax-m3；online error_code列为null，不冒充该列持久化了此码。online工作仍修订9、SAVE回执0，无新FTD workRef。旧成果保持，未追加重试或新建第三次业务请求。

P已对b20做局部实件诊断：rev6原表与source_plan一致，2行5列、空格/列位/跨度保留，8个非空anchors对应8个候选元素；旧检查把表头a57误当下方空格来源，本地确定性检查0BLOCK。检查传入sourceStructure及空格契约的最小补丁已交付，尚未集成发布或真实插件重查，原BLOCK不删、21块成果保留。证据为本机/private/tmp/wiselink-b20-P-QA.md；此支线不阻挡工程任务。

### 2026-09-13 本次状态整理与 Git 双远端同步

用户已明确将 GitHub 规则改为可与飞书同步推送。Luna负责持久规则/hook修订及本次同分支非强制推送；origin仍为妙搭开发来源，GitHub同名分支同步源码与交接记录，不自动main镜像、不修改可见性。技术发布独立于Git同步：当前Host仍5915860c1，Skill为c92。

本次通过平台只读查询重新核对Host release7684897153136085952 finished/errors=[]、工程终态和中文产物。主要未完成项：新英文语义已被实际读取但模型未提交可保存工作；同一真实FTD已通过部分内容检查，复杂图示/更广版式、真实SB长文资源表现及H2变化影响/恢复验收仍未完成。后续按用户最新要求优先英文精度、结构和语义还原，再验证工程工作保存；中文保留同源对应阅读，不扩展翻译流程。

### 当前明确剩余：工程输出提交（2026-09-13）

AQ-0f66976d469840b29a457945cfa0949c已通过正常原生消费者两次READ_ORIGINAL取得40单元，每次都携带rev6/semantic1和真实SourceRef。后三轮网关均HTTP200/finishReason=stop，实际没有保存函数；形态回执outputTokens均16000、responseBytes分别1011/743/606，不能据此断言具体模型资源根因。已用尽两次有界纠正，没有新工作保存，不将旧SB/SL工作修订9冒充新FTD成果。

fa91c0904/c92修正已知协议失败的生命周期：三次已完整持久化的text-only响应仍不提交时，通过既有JOBAID_INCOMPLETE_TERMINAL_RESPONSE失败结果收尾，不让RUNNING反复恢复同一响应；截断/未知调用/超时仍不冒充确定终态。33项定向测试及完整打包检查通过。只更新Skill，Host仍5915860c1；当前任务交由正常调度读既有回执收尾，不手工STEP、不再发相同工程请求。c92安装后3个job均已恢复enabled；Matter既有退避nextRunAtMs=1789281782330，未强制run或清除退避。本次最新online读回已FAILED / JOBAID_INCOMPLETE_TERMINAL_RESPONSE，证明已通过正常消费完成终态收尾；不再作为在途等待。

中文已在同一workspace持续至12个已保存块/11个可读块，Reader最近实读16%/829字符；这些只证明接续有效，不作为英文质量指标。英文实际工程消费已达到“真读取”，尚未达到“真保存”；后续优先解决此提交缺口，并按同一原件核对结构效果，不扩展翻译能力。

### 本轮后续真实回执（2026-09-13 14:15 前后）

- Host59c修复ActionAttempt durable envelope第二处semantic字段白名单；真实Matter PG在后续semantic2/parse3出现后仍读固定semantic1并保存，四组通过。正常next创建AQ-4ea1f8287e434772a85b4d74a791ebe1，DB输入固定rev6/semantic1。但该实际模型只读取旧SB/SL并保存MWREV-cdab3c87-48d6-41bc-8198-97cc27df7e23，后续任务SUCCEEDED、当前工作修订9；未读新FTD，不能冒充语义消费完成。
- 由此发现实际Skill系统提示仍只引导page文本，历史纠正说明压过本轮来源变更。591/c91把既有pending差异送入sourceChanges，并明确trigger优先、boundOriginal使用originalReadRef及semanticMap、其他必要范围继续读。没有强迫工程结论或伪造读取。正常begin_matter_assessment另提交一次明确的新FTD工程消费请求（requestId rev6-semantic-engineering-consumption-20260913），已QUEUED：AQ-0f66976d469840b29a457945cfa0949c；自然运行DB回执已记录MATTER_ORIGINAL_READ，实际20单元与boeing.ftd.sections.v1语义修订1共同返回，实际工作保存待完成。
- 中文原请求DTQ-6eae…已保存3块后因TRANSLATION_GENERATION_SUPERSEDED停住；P按真实CHECK lease9读取lease8已保存候选复现。3f3826c72只允许当前fence继续检查既有immutable候选；旧lease和旧generation新SAVE仍拒绝。M真实PG定向2项、Reader构造2项、前后端types通过。正式发布7684896096305908667 finished。
- 正常START新恢复请求translation-rev6-generation-recovery-20260913成功：DTQ-735a6f5d-1da5-4875-8ddc-7b54a548e86b，原workspace TW-f9b7e6dc-ded2-49ee-988f-3c78212fac3f不变，deadline2026-09-13T07:07:47.787Z。自然执行后Reader实读7.4%，382/5150原文字符已保存，新增“目前暂无更新”“适用性”“所有787型飞机。”；双语表格实际正常显示，不再报原表结构不可显示。完整中文尚未完成；该workspace建于semantic1前，不能追认其使用新语义上下文。


### 历史：本轮较早本地实施（部署状态以顶部为准）

- P后续两文件增量已合入：按artifactProgress只读取末组并恢复确切下一路径，普通STAGING不再compose全前缀；发布时一次全组装。构造25页正常/上传回执丢失场景验证，原PDF每步读取与最终全量内存仍在，不称为计算卸载。

- M 将翻译 reserve 的明确 PostgreSQL 42501 转换为安全的 DOCUMENT_TRANSLATION_ADMISSION_DENIED，不暴露 SQL/参数，不将连接未知归为权限拒绝。云端 consumer 在已有 checkpoint 根下按 Host endpoint、DV 与显式 recovery ID 保存 START 阻塞；后继 tick 仍检查原文/索引，阻塞原始 parseRun 保留，新 parseRun 不被吞掉。正常原生 job 输出 REQUIRES_ATTENTION，不冒充 DOCUMENT_READY。
- 修复准入后，通过原 job 官方 edit 设置新的 `--document-translation-recovery <ID>` 才恢复该操作；原阻塞记录不删、不自动改 epoch。它只控制消费端重试，不是 Host 任务、业务进度或授权真源；来源权限仍每次由 Host 验证。未知错误仍进入失败路径。
- 验证：文档 consumer 8项、既有工作 consumer/安全错误20项、Host runtime4项通过，相关服务 ESLint 通过；未安装新 Skill/发布新 Host，不能声称线上退避已解除。
- 同一 schema `workspace_aadkpkjef3slu` 的最新 dev/online 读回再次证实 roles/cmd/RESTRICTIVE/WITH CHECK 一致，只有 matter policy USING 缺 DOCUMENT_VERSION；独立 document policy 两边保持。证据位于本机 /private/tmp/wiselink-policy-{dev,online}-20260913-current.json，未向平台外发。
- P 已交付且M合入 /private/tmp/wl-document-P-semantic-map-20260913.patch，五文件；M集成server类型/相关lint通过。包含FTD平级栏目修复、完整成员/来源校验、范围选择、语义变化比较和V2上下文planner；真实rev6候选尚未保存。接口方向：从属 semanticRevision/profileRef、章节原题/角色/父级/成员/sourceRefs/显式空值与未知范围，M 负责集中持久化与真实消费者。云端终端随后自行恢复；已取得rev6自然PUBLISHED回执，不重启环境。

### 0054正式迁移与本轮组合部署准备

用户明确授权相关操作后，dev同义策略改名诊断返回准确两项diff（旧名DROP、新名CREATE），诊断结束已恢复并读回原名。随后正式登记0054，真实PG验证合法服务写入、原生/错误actor拒绝及旧策略不存在；正式diff再次只有同样两项，没有夹带其他schema。官方db-env-migrate实际应用2项，online读回旧名已不存在、新名 `action_attempt_matter_or_document_subject_boundary` 支持DOCUMENT_VERSION，独立文档和三项原生禁写策略保留。此前零差异阻塞已解除，不声称所有平台迁移问题普遍解决。

待部署Skill c89将中文准入阻塞按Host endpoint/DV/parseRun/START及recovery ID隔离，避免旧修订永久阻断新原文；同run明确拒绝不重复START，运维修复后更换原job recovery ID接续，旧记录保留。记录在Host失败事务回滚后的独立消费端checkpoint保存，写入失败仍失败，不冒充成功。Host/Skill组合必须实际安装发布后另验收；rev6成功仍只证明c8/c88。

P定点反馈已合入：FTD平级修复保留作者问题范围，两个Issue下同名栏目不串；祖先条件成员变化已覆盖后代正文比较，子树有内容时直接body空仍CONTENT。未新增视觉/helper或UI任务。语义持久化与实际工程接线仍由M负责，未因基础补丁通过而标完成。


## 历史：启动基线与早期交接

角色与本批目标：M 按 2026-09-12 主控执行书负责 F1—F6、共同身份/调度、原文下游和 H0/H1/H2 集成；不等待 MinerU 恢复。

基底：`9cd596d1642c996dce3f895f579201a0fbdb908b`，`codex/wl31-r09-master-handoff-20260903`；启动时工作树干净。尚无本批新增提交。

实际角色：M 任务 `01a09678-7f38-7b92-b280-85b32d950066`；P 任务 `01a09679-862a-7762-8330-19212ad61c08`，依据当前任务列表中的附件与角色核实，未使用旧重复链接猜测。已向 P 发送独立工作区与文件所有权交接。

已完成：当前路线原位修订。源码确认 F1 未等待索引携带正文事务、F2 遗漏纯退役及顶层变化、F3 不变问题引用自动认定已比较、F4 WorkItem subject 回退创建者、F5 原文 255 字符限制仍存在。其余项继续核对，未记为完成。

H0 未完成：核实实际云端消费者/lease 和原文发布同事务 pending 端口；P 类型/样本/依赖交付后集中接线。插件未安装、本批真实业务未运行，不借 CLI 用户身份冒充应用来源授权。

文件所有权：M 修改工程工作/检索/扫描、公共 Reader/身份/任务派发、根依赖与集中迁移；P 修改解析、V2 翻译、文档专用类型/插件声明与局部 Reader，P 不发布共享环境。

共享运行范围：目前仅本地隔离测试与只读现状核验；尚未启用本批新业务运行或清理。旧任务先查在途和身份再处理。按当前同步规则，明确同名 codex/* 开发分支可分别向 origin 与 GitHub 非强制推送；不自动同步 main、标签或其他分支。

验证：读取当前 Git 状态及相关源码；尚未运行本批测试/构建/发布。下一步先修具体保存与检索缺陷，补适当本地与隔离 PostgreSQL 证据，同时落实 H0 消费端口。

## 2026-09-13 主控本地进展

- 当前未提交修改：F2 完整阅读内容比较（含纯退役、headline/understanding/完成说明）；F5 长原文与问题限制/未知/要求索引；F1 正文同事务 await enqueuePending、取消事务内 detached 索引；F4 WorkItem subject 与 owner 分离，恢复/命中禁止 owner 回退；默认投影查询联结真正当前修订。F3、F6、SOURCE 消费和统一持久恢复仍待实施。
- 实际验证：31 项定向 Jest 通过；隔离 PostgreSQL JobAid 11 项通过，包括真实 trigger 引发 P0001、正文/pending 存在、修复后重建、两轮 Review 原子回滚与重放、真实身份 RLS/取消。错误记录改为底层错误码，避免 Drizzle 包装消息保存正文 SQL 参数。F4/current SQL 还需专门 PG 查询证据，不能因类型通过关闭。
- 隔离 PG：`/private/tmp/wiselink-m-r10-pg-20260913`，本机 `127.0.0.1:55439`，库 `wiselink_jobaid_test_m_r10`；已实际启动。命令 `JOBAID_WORK_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55439/wiselink_jobaid_test_m_r10 node --test test/node/jobaid-work-postgres.test.mjs`；日志 `/private/tmp/wiselink-m-r10-jobaid-pg.log`。仅合成隔离数据。
- 新迁移 `0043_engineering_search_hosted_actor_scope.sql` 只在隔离库测试；修正索引/待处理表依赖不存在 app.tenant_id 的问题，沿用 engineering_matter_actor_has_tenant 与真实 app.user_id，写入仍仅 service_role 且 owner=actor；未变更云端权限或发布。需要继续核对 Matter/SOURCE 消费主体的写入授权，不得扩大为无身份写入。
- 平台本地装配已成功：ai-doc-parser 1.0.16、ai-translate 1.0.11，manifest 在 canonical/node_modules/@official-plugins/<key>/manifest.json；package.json 仅增加 actionPlugins，已消除 CLI 重排带来的无关差异。尚未发布、未实际调用插件。
- P H0：独立 `/private/tmp/wl-r10-document-plugin-20260913`、`codex/wl-r10-document-plugin-20260913`，以可见文件交付 document-original.interface.ts、documentOriginalStructuredSource 和 fixture，详见该树 P_DELIVERY；基底 ESLint 阻止提交，未绕 hook。未合入 P 文件。
- M 发布窄端口：`server/modules/document-management/src/hosted/nest/document-original-pending.ts::registerPublishedDocumentOriginal(tx, publishedRun)`；P 已收到同发布事务 await 指示。SOURCE pending 复用现表，绑定确切 parseRun/DV，后续消费者尚待接通；WORK 重建明确不消费 SOURCE。
- 下一步：完成具体文档持久 lease/消费者端口与测试范围给 P；补 current/历史和 Matter 持久测试，F3 稀疏真实处置与复看，F6 正向对象/意图/游标一致性；核对真实云端旧在途和获准来源后 H1。不得把本地 PG/插件安装冒充真实 Host 文档闭环。

### H0 文档执行租约端口

M 新增 `DocumentStepLeaseRepository`，在现有 parseRun 保存 leaseOwner/token/generation/expiresAt/cancelRequestedAt，集中 schema 与 0044 迁移，Hosted module 已注册/导出。`claim` 原子领取过期空闲 run，`assertValid(tx,scope,fence)` 在保存事务内锁行核验，`check/renew/release/cancel` 处理有界执行，旧 token 不得释放新租约。已向 P 交付接口并要求 executeStep/progress/publish 接 fence；未改 P 专属 repository/service。

真实 PostgreSQL `test/node/document-step-lease-postgres.test.mjs` 通过：并发仅一领取、进程替换后世代递增、旧 token 拒绝、跨租户拒绝、续租、旧 release 不破坏新租约、取消阻止迟到写入/重新领取。仅本地执行控制证据，云端消费者仍未接通。

测试库 `wiselink_document_step_test` 在同一隔离 PG 端口 55439；命令 `DOCUMENT_STEP_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55439/wiselink_document_step_test node --test test/node/document-step-lease-postgres.test.mjs`。下一步 M 接实际授权的持久消费者 route 和原文待处理消费；P 按已交端口实现有界处理。

### H0 首次合入（未提交/未发布）

已核验并应用 `/private/tmp/wl-document-P-H0-20260913.patch`（17 文件），M 注册 DocumentOfficialPluginService；已通知 P 后续只交 H0 之后差异。包含原文 DTO/适配、PDF.js 对照/组合、插件实例与服务，以及 P repository.publish 同事务 await M 原文 pending。合入后 4 suites/14 文档测试通过、server 类型检查通过；这仍是 fixture/本地接线。

新增 M 迁移 0045：普通 authenticated 发布只能 INSERT 自己获准文档的确切已 PUBLISHED parseRun SOURCE pending；处理/删除依然由 service_role 完成。已要求 P 专属文档发布 PostgreSQL 测试带 0039/0042/0043/0044/0045 验证。M 不修改 P 专属测试。0044/0045 尚未云端应用，0045 尚待真实 SQL 验证。

F6 本轮已读 scanner/coordinator/service/repository，尚未改：onPage 只存游标，候选在扫描完成后另写；一个失败子树直接 return。下一增量应将每页取得对象、待受理意图与游标同一短事务/CAS保存，保持跨批 A/B/C 全部持久，并让失败子树之外的正向对象继续处理。不要用可选回调回退到只存游标，不能仅在接口中增加字段却无真实持久消费者。

### F3/F6 本地增量（2026-09-13）

F6 已修改 scanner/coordinator/DriveScanCheckpointRepository/DriveSourceScanService：每页必须调用 savePage，在同一事务锁/CAS 下保存观测对象快照、pendingCandidatesJson 和游标；集中新增0046字段，移除旧单独覆盖候选快照写法。部分扫描现在返回已取得的正向变化，失败子目录保留 frontier 而其他目录继续。现快照是累计已观察身份，不宣称完整负向缺失判断；pending intake 的真实业务消费仍待接通。

实测：3套扫描/协调/服务测试21项通过，新增失败子树外的正向读取测试通过；`test/node/drive-scan-persistence-postgres.test.mjs` 真实PG通过A/B/C跨批、第二页SQL约束失败回滚、同游标重试、旧CAS拒绝。隔离库 `wiselink_drive_scan_test` 端口55439；命令 `DRIVE_SCAN_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55439/wiselink_drive_scan_test node --test test/node/drive-scan-persistence-postgres.test.mjs`。这不证明自动受理、来源正式授权或后台运行已完成。

F3 已修改 Matter SAVE_WORK：新增可选稀疏 inputDispositions（inputId、NO_MATERIAL_CHANGE/READ_ONLY、本轮checkedEvidenceRefs、checkedScope、reason），按真实输入/本轮读取验证；旧引用或未修改问题只算READ_ONLY，不再推断比较无影响；历史读取不自动进入本轮coverage。MatterActionAttemptService传递本轮sourceCatalog/读取回执，保留历史来源用于完整工作。同步工程Skill work shape/guidance。15项JobAid测试、对应node runtime测试及server类型检查通过；到期/事件reviewConditions真实消费仍未完成。

ESLint基底故障已修复：presets覆盖Nest源码src却丢默认test/spec排除，扫描测试落在排除测试的tsconfig.node项目导致崩溃。eslint.config.js恢复源码扫描默认filter并将server parser项目加入tsconfig.jest；不禁用规则。四个受影响源文件lint通过，已核实动态register providers并沿仓库惯例逐处标注。未声称全库lint/hook通过，未提交或发布。

下一主线仍为：真实授权/旧在途核验、云端持久文档消费、SOURCE索引与影响消费、工程输入/初评取消翻译前置、F3复看消费者、F4/F5 current/history实际查询、F6待受理业务接线、P H1/H2增量集成与真实页面。不要重复仅跑已有通过测试。

### 原文步骤消费者与 SOURCE 跨批修复（2026-09-13）

已应用 P `/private/tmp/wl-document-P-original-step-20260913.patch`，并通知 P 后续只交未应用增量。原文 start 只预留 parseRun，executeStep 按持久 PDF 页进度推进、逐次 fence 验证与同事务发布 pending。M schema 兼容 DocumentOriginalArtifact 与历史 MineruStoredArtifact 联合，历史 IMAGE 只读保留，未恢复 MinerU 执行。集成后 server/client 类型通过，文档相关 8 suites/35 项通过。

M 新增 `DocumentWorkRuntimeService` 并注册到 CanonicalHostModule，通过既有 MCP 的 `document_work` 提供 STATUS/STEP/CANCEL。授权采用独立精确 DV/actor/tenant 服务配置；每次操作重新校验正常来源权限。STEP 使用120秒租约、30秒续租，await P 的一个步骤，最终释放；插件调用不跨数据库事务。EngineeringMatterWorkingRepository 新增 withActorScope，保留真实 service_role_schema 验证及 actor AsyncLocal 上下文，withActorTransaction 复用它进入短事务。

既有 Hosted Skill consumer 新增单一主体 `--document-version-id`，不调用工程模型；只读状态后推进同一 parseRun 的一个步骤，失败保留具体状态供处理，不自动重生 run。独立作用域9项测试通过；document runtime3项通过来源权限撤销/旧run拒绝、BUSY、失败释放与长步骤续租停止；消费者18项回归通过。修改的5个服务/授权源文件 ESLint 通过，git diff --check 通过。这是本地实现，文档原生 cron 尚未云端配置或证明运行。

`indexAuthorizedSourceEntries` 已改成按精确条目 upsert，避免第二批读取删除同revision第一批。身份冲突明确抛错并回滚整个批次；不能借同entryId改owner/revision/locator/kind。真实PG新增A/B/C跨批、长原文、重复A修订和冲突批回滚，JobAid套件12项全通过，日志 `/private/tmp/wiselink-m-r10-source-batches-pg.log`。SOURCE发布pending的索引/工程影响消费者尚未接通，不因writer通过而关闭F5。

云端：app_17c3zn24kv2 的活跃session conversation_4ky0f6r24fz90 已发送一次只读诊断，要求读取实际Skill、native cron、进程、官方profile，不启动业务/不改配置。当前latest_turn仍旧cancelled（7684132210174332115），queued_count=3，is_streaming=false；新诊断尚无执行turn。一次状态查询EOF后重试恢复，但队列仍无进展。没有重复发送，也没有据旧cancelled推断cron停用或擅自重启。后续需解读确切queued_messages身份与平台运行状态；目前不能声称已清除旧在途或已验证新运行时。

P 已报告 V2 官方plugin executor 接口 prepareOriginal/executeStep，保留既有workspace fence及ActionAttempt，正在生成第三份增量。M 下一步建立真实原文manifest ref/hash/DV/parseRun映射与实际工程读取消费者，不能把新原文标为 frozen.2。所有0043–0046迁移仍未上云；未提交、推送或技术发布。

### V2第三次增量与统一原文读取（2026-09-13）

已核验并应用 `/private/tmp/wl-document-P-v2-plugin-20260913.patch`（12文件），M注册 CanonicalTranslationV2PluginService 并导出 DocumentOfficialPluginService，类型检查通过，结构翻译测试通过。实际核对发现 prepareOriginal 仍依赖 WorkItem.package，因此未宣称独立文档中文链路完成；已交 P 继续修复同一workspace的 DOCUMENT_VERSION 主体，不造假WI。

M 在 UnifiedReaderService 增加 readDocumentOriginal，普通文档服务通过 DOCUMENT_ORIGINAL_READER/useExisting 在真实AppModule配置中注册。document runtime的 readOriginal 由此读取正常授权的确切 PUBLISHED parseRun，MCP `read_document_original` 已接入真实消费者。返回逻辑 `document-original://<DV>/<parseRun>`、同一持久manifest实际sha256/byteLength/mediaType、完整原文单元（含表格payload）、SourceRef定位、coverage/producer和nextOffset；没有 translated 内容，不截短单元，不将其称作frozen.2。此入口尚需接工程任务的已登记读取回执/来源绑定和SOURCE索引影响消费者，不能仅凭新增工具关闭端到端集成。

4项document runtime测试通过，包括原文确切绑定/coverage、身份漂移拒绝、续租与旧run/source权限边界。修改的统一Reader/模块/runtime/task envelope ESLint通过。新增独立 `document-translation-task-envelope.ts`：schema `wiselink.document.translation_task.v1`，严格封存真实DV/parseRun/parseRevision/workspace与插件taskInput，不含假WI、executionModel或OPENCLAW执行声明；复用已有输入摘要验证。P已收到同路径导出。

双方已确定独立翻译主体：复用ActionAttempt现有nullable workItemId/subjectKind/documentVersionId，DOCUMENT_VERSION主体、actionType DOCUMENT_TRANSLATE、producerRunId=真实parseRun；现有租约/取消字段继续使用。P编写workspace nullable WI、subjectKind、DV partial unique及FK/RLS草案，M集中登记0047并接真实Actor授权与调度；草案未收到前未提前更改共享数据库。仍未上云/发布。

### 独立文档V2端到端本地接线（2026-09-13）

已应用 P `/private/tmp/wl-document-P-independent-v2-20260913.patch`，M集中登记0047/0048与Drizzle主体/nullable/索引/FK。0047保留旧WI约束、增加DV source唯一和block主体校验；M补restrictive文档actor/DV边界，服务侧宽策略也不能跨文档。0048只对DOCUMENT_VERSION检查确切PUBLISHED parseRun，不对承载旧producer身份的整列producer_run_id增加错误通用FK；真实doc主体不可切换、每tenant/DV只一活跃翻译任务、authenticated只读，写入仍是fresh授权下的service scope。

M `DocumentTranslationAttemptRepository` 复用ActionAttempt执行reserve/readRequest/latest/claim/renew/release/cancel/expire/finish/fail。`DocumentTranslationRuntimeService` 已注册并由MCP `document_translation` START/STATUS/STEP/CANCEL实际调用P的prepareOriginal/executeStep。独立任务不含WI或模型配置；原文binding必须与task DV/parseRun/revision一致。120秒lease、30秒续租、原文权限每步重验；到期明确失败，失败不会自动重生尝试。保存结果为真实document translation result，不伪装OpenClaw envelope。

原生文档consumer在PUBLISHED后调用独立translation STATUS，IDLE时START、活动时推进一个STEP、失败保留attention、成功不重译。19项文档/原有消费者回归通过。主控runtime3项测试通过无WI准备、请求重放、确切文档fence、失败释放/来源拒绝和旧attempt拒绝；独立task严格解析2项通过。

主控实跑P的完整22项PG套件通过（`TRANSLATION_WORKSPACE_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55439/wiselink_translation_v2_test_m_independent node --test test/node/translation-workspace-postgres.test.mjs`；日志 `/private/tmp/wiselink-m-independent-translation-pg.log`），包括无WI生成/检查/组装、保存响应丢失恢复、来源变更拒绝新写且历史可读。M新增 `test/node/document-translation-attempt-postgres.test.mjs` 在隔离库wiselink_document_attempt_test通过实际迁移、角色RLS、活跃唯一、已发布源、主体不可变、旧WI兼容及lease替换/旧token/取消。授权函数为隔离合成测试，不证明上游正式委托。

剩余明确缺口：原文纠正后的旧翻译attempt收尾/新workspace自动接续、独立中文Reader外层入口、工程任务原文来源登记/读取回执、SOURCE索引与影响消费、F3复看/F4历史查询/F6正向受理真实消费，以及真实来源授权和云端H1/H2。0043–0048尚未上云，仍未提交、推送或发布；不要将本地端口/PG通过记为真实业务闭环。

### 原文变化接续与独立中文读取入口（2026-09-13）

M reserve现锁真实DV后重验最新PUBLISHED parseRun/revision及manifest hash/bytes；若旧活跃翻译绑定更早原文，在创建successor的同事务内取消旧attempt，终止原因DOCUMENT_ORIGINAL_SUPERSEDED，不删除已保存译文。STATUS对另一个parseRun返回IDLE及旧attempt摘要，原生consumer据此START新的精确原文任务。真实PG已验证：注入新任务insert失败时旧取消一并回滚、成功后新旧状态正确、同请求重放、旧原文不能预留。日志可由document-translation-attempt-postgres测试复现。

已核验合入P `/private/tmp/wl-document-P-reuse-v2-20260913.patch`（9文件）。仅确切PDF/文本/结构/已用上下文依赖合格时复用，保存reusedFrom来源与真实producer；不把旧生成冒充本次插件执行。M重新实跑22项PG通过，含新原文workspace复用/重入/组装，日志 `/private/tmp/wiselink-m-reuse-translation-pg.log`；8项复用单测通过。这是构造场景，不替代H1实际质量。

新增正常authenticated GET `/api/document-management/document-versions/:documentVersionId/translation-reading?parseRunId=...`，通过UnifiedReader验证原文、按确切manifest ref/hash读取DV workspace，读后再次校验来源权限；返回既有CanonicalReaderTranslationProjection及该parseRun执行状态，历史译文不被当前run遮盖。2项controller测试通过准确源查询/不展示其他run执行/权限撤销拒绝。M API `readDocumentTranslationReading`加入会话代数和AbortSignal保护；前端type通过。P已收到页面挂载任务，仍待页面增量合入和实际渲染验证。

再次核验云端诊断：conversation_4ky0f6r24fz90仍is_streaming=false，latest cancelled仍旧turn7684132210174332115；三个排队消息时间分别2026-09-11T04:48:52Z、04:53:27Z和本次只读诊断2026-09-12T17:11:46Z。新诊断没有执行handle，不重发，不依据观察超时重启云端。上游正式授权/旧在途/原生cron仍未核实，当前继续不受阻的本地集成。

### F4/F5 当前与历史检索实证（2026-09-13）

工程问题检索新增显式scope CURRENT/HISTORY，默认只取当前保存版本；controller/API/事项搜索界面均已接入“当前版本／包含历史”，历史结果明确标记范围并继续按当前来源权限逐条展开。正文SQL与投影SQL均按真实WI/Matter subject、数值工作修订筛选，不用actor owner代替主体；投影孤儿版本不能成为当前命中。

实际PG测试首次揭示旧代码的真实失败：Drizzle模板直接嵌入exactIdentifierCandidates数组被展开成普通字符串，PostgreSQL报22P02 malformed array literal。已统一改为逐值参数化的ARRAY[...]::text[]，不拼接用户字面量。该错误不曾被先前mock SQL单测发现。

`test/node/engineering-search-current-postgres.test.mjs` 已通过真实查询：正文与projection两路各验证旧词默认不命中、显式历史返回WI/Matter旧版本、当前词只返回最新版本、孤儿projection排除、subject不是actor，以及确切读取端拒绝后不再返回命中。使用隔离55439/wiselink_search_current_test，命令ENGINEERING_SEARCH_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55439/wiselink_search_current_test node --test test/node/engineering-search-current-postgres.test.mjs。读取端在此测试为可撤销的模拟授权端口；真实RLS/来源授权仍依据之前专属测试与后续H1验证，不扩大该测试结论。原9项搜索单测和前后端types通过。

继续定位发现初评状态服务仍以WL_JOBAID_PROBLEM_V2_ENABLED条件决定翻译排序，且任一BUSY阶段会挡工程推进；当前独立文档翻译路径未解决旧WI初评编排中的隐藏前置。后续须与原文package/SourceRef实际输入接线一起修复，不能仅改状态显示绕过真实原文要求。SOURCE原文索引/影响消费、F3复看、F6正向受理仍未完成。

### 独立Reader合入与本轮读取口径收紧（2026-09-13）

已核验应用P `/private/tmp/wl-document-P-reader-20260913.patch`（仅DocumentVersionReadingPage.tsx），接入M正常authenticated读取API、原文/中英对照切换、保存块进展与SourceRef页级原件弹窗，保留会话epoch/AbortController/DV/parseRun检查。P报告已在隔离PG构造译文页面测试壳验证原文→中文→来源第2页；M尚未在真实Host页面复核，不把该报告写成H1实际文档证据。发现无execution时页面无限5秒轮询，已要求P改有界等待/明确未启动；活跃任务才持续轮询。

M收紧Matter SAVE_WORK的currentReadSourceRefs：只计taskInput.initiallyDeliveredRefs及本轮实际读取回执，不再把整个sourceCatalog（包括未交付正文的历史来源）视作本轮已读。旧证据仍保留用于历史完整工作，但不能凭目录项产生本轮覆盖。31项相关JobAid/任务/页面epoch测试通过。

M生产server构建通过（npm run build:server），包括现插件服务/独立任务/统一Reader装配代码与文档运行资产复制；这仅证明构建，不是Nest启动、线上发布或插件调用成功。

工程输入下一明确实现点：MatterActionAttemptService.readSourcePages当前只接受NATIVE_TEXT_LAYER并在reviewActivityJson保存MATTER_SOURCE_PAGES_READ；consumer只把DOCUMENT_VERSION:DV:page:N转换为该接口。新增插件原文不能伪装此原始PDF页协议，必须在同一Matter任务授权/fence/来源范围下冻结确切parseRun并登记原文阅读回执，随后SAVE_WORK才可采用相应SourceRef。当前独立read_document_original工具尚未完成该接线，不能算工程实际消费已完成。

### 事项原文回执、恢复与真实 SQL 补缺（2026-09-13）

上述事项接线已在本地实现：Matter MCP新增READ_ORIGINAL，沿用确切事项/actor/principal/租约授权；首次读取在短事务锁任务并绑定最新已发布parseRun，释放事务后调用UnifiedReader正常文档授权，再重查来源范围/任务hash/租约并登记MATTER_ORIGINAL_READ。原文分页返回完整语义单元、真实SourceRef定位、coverage/findings；同一SourceRef跨多个单元时证据保持完整一致。SAVE_WORK使用Host读取回执登记证据与本轮阅读，恢复任务继承绑定和已读证据；native消费originalReadRef及下一页句柄。原PDF页工具保持现有协议，未把译文或目录当原文证据。

真实事项PG测试现在注入实际EngineeringSearchProjectionWriter，应用0038/0039/0042/0043/0044/0049。发现并修复浏览器保存正文同事务pending缺少INSERT策略：0049只允许自己的可读确切Matter/WorkItem工作修订登记，伪造owner/subject/revision全部42501；无新增处理/删除权限。另修正文搜索未启用投影时完整中文问题分词不匹配，增加参数化原文子串匹配。修复旧测试在legacy拒绝后提前return且未恢复fixture、致后续真实SAVE_WORK未执行的问题。

隔离库`wiselink_engineering_matter_test`（127.0.0.1:55439）4个真实SQL综合测试全过：正文/pending、RLS/CAS、实际保存/finish/后继恢复、原文首次选择修订2、发布修订3后续读仍绑定2、旧租约/读完过期/manifest漂移不登记、恢复带回原文证据与绑定。文档发布行/正文为构造数据，Reader以fixture替代真实插件FileService；不能代表原文发布全链或上游正式授权。日志`/private/tmp/wiselink-m-original-matter-pg.log`。23项搜索/原文适配/MCP测试、native事项10项、15项P HTML/输出契约测试通过；前后端类型通过。

已应用并告知P四份增量：reader-poll、html-table、output-recovery、image-coverage（`/private/tmp/wl-document-P-<name>-20260913.patch`）。无execution的Reader轮询有界；HTML表格保留表题/跨度/异常不猜；确定输出错误与超时未知分别处理；检测PDF栅格绘制仍标记图内信息未读，不宣称视觉理解。M实际运行`node --test test/node/document-original-pdf.test.mjs`通过Node/PDF.js构造两页图片检测；无线上模型调用。

本批仍未提交、未推送、未发布；goal保持active。下一主线：SOURCE pending索引/影响消费、扫描pending真实受理/ack、F3到期事件消费者、WorkItem原文工程输入及取消翻译前置、云端队列诊断和原生持久消费/正式来源scope、H1/H2真实原文中文工程流程及技术交付。事项原文读取本地通过不代表这些剩余范围完成。

### SOURCE 分批索引、检索与确切阅读导航（2026-09-13）

新增DocumentSourceProjectionService和集中0050迁移：SOURCE pending记录sourceNextOffset/sourceIndexComplete，document_work INDEX在精确文档service scope内每次处理20个原文单元。正常UnifiedReader授权后，短事务重新通过parseRun RLS校验，锁pending、检查旧offset、upsert确切SourceRef条目并推进offset；失败记录安全错误码，整批回滚。原文复合标识按真实拼写提取为查找候选，不形成业务身份或版本合并。索引完成只标记，不删除仍待工程影响处理的pending。

native文档tick在已发布原文上并行await索引和独立中文步骤，两者均settle再返回；索引失败明确REQUIRES_ATTENTION而中文可继续保存，不以译文为索引输入。5项native文档测试通过。新增schema字段已同步M事项/JobAid及P解析PG测试迁移列表，P已获通知。

新增DocumentSourceSearchService、正常浏览器GET engineering-issues/sources、客户端API和事项检索UI：以SOURCE返回原文、确切DV/parseRun/SourceRef、命中原因/范围/rootRefs及coverage；与已有WORK检索共同呈现。候选先联结实际PUBLISHED run、按CURRENT/HISTORY筛选，再由UnifiedReader重新读取获准原文核对索引正文，不把索引当授权凭据。超过授权命中上限才返回hasMore；403/404候选不暴露。P已交付navigation-telemetry增量并已应用：可按query固定历史parseRun/sourceRef、显示历史状态，刷新不替换最新，无效引用不回退；P报告构造浏览器实测，M未冒充真实Host浏览器验证。

实际证据：事项PG4项综合测试全过，新增26条原文分两批、第二批触发P0001时offset仍20/仅20条、重试26条/幂等/保留pending；原文精确A-12标识、表格12 kPa、多租户与读取撤权过滤、发布修订3后修订2仅HISTORY出现。日志`/private/tmp/wiselink-m-source-projection-pg.log`；JobAid PG12项与文档发布PG1项通过；原文运行/适配12项、工程索引/插件15项测试通过；server build通过。全部在隔离PG/构造原文完成，不等于真实插件结果质量或生产流程。

本轮另应用P semantic-quality及navigation-telemetry增量，P输出模型语义质量仍只由注入报告/隔离数据库证明状态机，未声称真实模型能力。重新查询云端conversation_4ky0f6r24fz90：is_active=true/is_streaming=false、queued_count=3、latest_turn仍旧cancelled 7684132210174332115；本次诊断尚未成为新turn，未重发/停止/重启会话。后续CLI只投影状态字段，不输出完整历史。

下一主线仍缺SOURCE工程影响确认/ack、F3到期事件消费者、F6实际受理、WorkItem原文输入与取消翻译前置，以及真实scope/消费者/H1/H2/交付。没有提交、推送或发布本批代码，goal继续active。

### F6 元数据漏检、跨批候选读取与 Hosted RLS（2026-09-13）

当前读取证据：DriveSourceScanService只有调用方提供AuthorizedDrivePageFetcher，没有注册的应用/委托Drive fetch+正式受理适配；DocumentManagementHostedCore现有受理入口是已授权FileService selection，不能把扫描文件名、token或用户CLI可读性直接当作此来源授权。未用占位receipt或清空pending假装正常受理。

已修两个具体漏点：classifyDriveSourceCandidates在providerVersionId不变时也检查类型/名称/路径/modifiedTime，元数据变化进入受理检查，仍不是工程内容变化；scanCandidates返回仓储中跨批次所有pendingCandidates，而不只返回本轮刚读到的对象。旧候选不会因A轮后退出、B轮恢复而在返回值中丢失。

发现0040策略依赖Hosted没有设置的app.tenant_id，旧隔离测试的管理员连接未覆盖此问题。新增0051：仅service_role通过已有engineering_matter_actor_has_tenant读写扫描状态，无browser写入；正式上游fetch权限仍须独立核验。真实PG测试加入服务/浏览器角色、正确/错误actor与跨tenant访问，构造tenant映射以验证SQL策略，不能代表真实委托授权。A/B/C、SQL失败回滚、CAS及pending跨批读回仍通过；候选/服务共14项定向Jest、server types通过。动态module已实际注册DriveSourceScanService，按既有惯例局部标注lint装配扫描误报。

已定位下一原文影响缺口，尚未修改：EngineeringMatterWorkingInputBinding只有DV/WI/result修订，没有parseRun；loadCurrentInputBindings与浏览器workingService各自构造，pendingInputs只比较这些旧字段；readOriginal在首次读取才绑定parseRun。因此同DV的新解析修订尚不能自行触发待处理输入。后续需同时更新真实构造消费者、任务/状态验证、冻结旧来源读取和原文变化提示，不能只增加一个DTO字段。原文纠正变化不应撤销已绑定历史任务的授权，也不能把译文变化作为重评触发。

### 原文修订进入事项输入和既有后继消费（2026-09-13）

上述缺口已接入真实消费者：共享事项输入可携带original {parseRunId,parseRevision}；bindMatterOriginalInputs在已有授权后读取确切DV的最新已发布官方原文，仓储/runtime与浏览器workingService都使用它。任务与工作状态验证原文身份，pendingInputs加入DOCUMENT_ORIGINAL_CHANGED及中文页面说明；boundOriginal交付模型，变化只提示核查，不认定实质变化。

已领取任务的冻结input保留旧原文；authorizeAttemptWorkingBasis重新授权并验证旧PUBLISHED run存在，但不会因有新原文就替换/拒绝旧任务。readOriginal优先使用任务捕获的确切run，旧任务未捕获才在首次读取冻结；保存使用原任务input。既有next_matter_assessment依照当前原文与已保存coverage比较，沿原SOURCE_CHANGE/幂等登记后继，不引入新业务任务表或模型运行时。

SOURCE marker语义已收敛：工程变化可从持久PUBLISHED版本与coverage重新比较，因此索引完成在同一事务确认pending，事务失败仍保留。0050仍未发布，现仅增加source_next_offset，去掉暂存的source_index_complete字段。没有依赖进程内通知或模型调用登记变化。document_work STATUS返回有权处理的nextSourceProjectionRunId，INDEX支持确切历史PUBLISHED run；按尝试次数/修订选择积压，避免新原文出现后旧索引无人消费。native同时处理该待索引run与最新中文，各自身份核验。

真实PG4项综合测试通过（`/private/tmp/wiselink-m-original-impact-pg.log`）：预留/恢复任务绑定修订2；3发布后浏览器显示原文变化，任务仍读2并按2保存；next_matter实际登记绑定3的后继，重复轮询返回同一ref；索引批次失败回滚/完成确认及历史检索继续通过。构造parse与Reader正文，非真实插件/生产来源授权。状态/任务/服务定向测试通过，含伪造原文字段和非法修订拒绝；native文档6项、文档runtime4项、前后端types与server构建通过。

尚未完成：独立WorkItem初评的原文替换与取消翻译前置、F3到期/事件reviewConditions、F6正式Drive身份受理、真实云端运行与H1/H2、提交/技术发布。上述事项后继仅证明其自身链路，不扩张为全部工程入口已完成。

### 明确复看条件进入既有消费者（2026-09-13）

reviewConditions新增可选when：DUE_AT明确带时区时间、ORIGINAL_CHANGED指定真实inputId及当前捕获的afterParseRunId（尚无发布原文时可为null）。SAVE_WORK接受稀疏reviewConditionDelta，保留未修改条件；普通文本不推断时间或外部事件。模型入口及仓储浏览器保存入口均拒绝新条件使用伪造原文基线，旧条件保持原基线。

nextForRuntime在已有队列中登记REVISIT，使用当前已保存workRef与conditionIds；到期使用Host时间，原文变化使用有权读取的已发布绑定。发生项幂等键不依赖工作修订或说明文字，等价时区时间归一化。既有成功发生项跳过，失败/取消项保留可见且不自动重跑；其他新发生项仍可继续。未新增定时进程，也未证明云端消费者正在运行。

验证发现旧读回可能错误覆盖新原文修订，已按绑定的确切parseRun限定coverage及NO_MATERIAL_CHANGE证据。Runtime仍保留全部读取收据；工作正文保留旧证据与实际引用，未引用且不匹配绑定的新增旧读回不冒充工程覆盖。保留既有证据无需重新证明为新修订；未覆盖的新引用仍拒绝。

实际PG4项综合测试通过（/private/tmp/wiselink-m-revisit-pg.log）：条件单独保存/结束、明确到期登记、重复轮询幂等、取消不重跑、修订4发布触发第二个指定原文复看、最终恰好两项REVISIT；浏览器与模型伪造基线均拒绝。单元18项、native33项通过，前后端types通过，定向lint无error（已有一条unused-disable warning），diff检查通过。测试使用构造parse与本地PG，非真实业务完成或生产发布。

尚未完成：独立WorkItem初评原文输入及取消翻译前置、F6正式Drive身份受理、真实云端诊断/运行与H1/H2、提交/技术发布。明确时间和原文事件之外的外部条件仍为人工判断；本批次保持未提交、未推送、未发布，goal继续。

### WorkItem原文接线前的版本身份修正（2026-09-13）

当前代码核对：canonical-jobaid-problem.service.buildModelInput仍从旧package读取主证据，commonContext仍以旧package展开关联材料，初评status仍保留翻译状态及英文分析开关。因此不能宣称独立WorkItem初评已完成官方原文接线。

已修正实际任务构造器的必要版本边界：stableJobAidEvidence保留DOCUMENT_ORIGINAL引用并验证DV、parseRun及sourceRef组成，防止同文件不同解析修订被压成同一source引用。PAGE展开按确切解析修订隔离，即使相同locator也不跨修订；章节sourceRefs只取本次输入目录，避免后加入的历史证据覆盖当前章节链接。任务可同时保留旧、新原文，历史已读不冒充当前已读。

39项JobAid任务/工作测试通过，含实际buildJobAidProblemTask→assertJobAidProblemTaskBinding的新旧原文并存、章节身份和已读区分；服务端types通过，定向lint及diff检查通过。尚未接线的新输入消费者不由这些测试替代证明。

同一云端诊断会话再次只读核对：conversation_4ky0f6r24fz90 is_active=true、is_streaming=false、queued_count=3，latest_turn仍为cancelled。未重启或再次投递诊断。P任务快照latestTurn=inProgress，继续保留当前分工，不重复派发。所有前述完整交付缺口仍有效。

### WorkItem初评实际正文改为已发布原文（2026-09-13）

CanonicalJobAidProblemService.buildInput已接入JobAidWorkRepository.publishedOriginalBinding：先按真实owner核对官方actor mapping/WorkItem归属，再在actor scope查询已发布parseRun。释放短事务后，通过UnifiedReader正常文件授权读取确切原文；无发布原文、无原文Reader或无可读证据时明确失败，不退回旧package正文。按原文分页生成完整证据目录，保留确切解析修订、coverage及findings；读取收据仍按真实选择登记，不预先声明全文已读。

CommonContext获得同一份原文units用于章节和关联资料识别，不重新读取主文件旧package。原文中图表结构及原始payload直接传递，没有伪造MinerU产物。关联资料自己的历史读取路径仍存在，尚未完成其全部官方原文迁移。BEGIN/读/保存/完成等既有assertSourcesAuthorized路径先重新核验owner及sourceBindings，再按确切parseRun执行文件授权与正文比对；历史任务不会替换为最新解析修订。

验证：30项初评延续与commonContext测试通过，含缺失发布原文拒绝、恢复时正文变化/权限撤销拒绝、章节不读取legacy package；另16项JobAid工作测试此前通过。真实本地PG12项通过（/private/tmp/wiselink-m-jobaid-original-pg.log），使用实际0038解析表/RLS和原文版本选择SQL，构造原文Reader，验证入队不读取、claim时构造、恢复只核验冻结原文及官方actor撤销；不证明真实插件或文件存储访问。服务端types、构建、定向lint与diff检查通过。

当前边界：全局初评status/适用性仍有翻译与英文模式门槛，begin/sourceBindings仍保留旧package存在与版本元数据检查，尚未完成无旧package的新文档到WorkItem的全入口接线。新任务正文已改接原文，但不能据此关闭完整初评迁移。尚未提交/推送/发布。

P已明确澄清其inProgress仅为Goal等待，已交付代码全部合入，无待实现批次或正在运行的业务调用；H1/H2需要M提供实际可运行Host及获准scope/已保存产物，不应继续等待P新实现。前一段活跃快照仅是当时工具状态，不代表P还有实现依赖。

### 工程完成不再自动串行旧WorkItem翻译（2026-09-13）

再次核对实际编排：WL_JOBAID_PROBLEM_V2_ENABLED已使原文分析优先，适用性新任务也有原文模式；剩余的一处串行关系是工程阶段后仍自动派发旧WorkItem TRANSLATE，且native initialComplete强制要求translation=SUCCEEDED。

已修改新模式deriveProgression：未明确请求的中文不加入工程阶段顺序，历史翻译失败/冲突继续保留在translation阶段读模型，但不把完成的工程工作改成失败。原生consumeHostedWorkItem按Host整体状态及实际适用性/JobAid/Overall完成状态进入Review，不再以中文完成为附加前置。已有明确排队翻译及BUSY翻译仍保留其执行/CAS所有权；没有取消、重启或改写在途任务。旧模式投影兼容其已绑定流程。

28项初评状态测试、15项原生消费者测试通过；新增验证中文PENDING/FAILED/CONFLICT仍能在工程完成后进入Review，而不调用旧翻译执行器，适用性缺少飞机输入仍明确WAITING_INPUT。已有明确排队翻译、BUSY及失败不隐式重试测试保持通过。

未完成范围：旧package就绪/版本元数据检查、适用性及关联资料的完整已发布原文接线、独立中文入口的生产切换窗口、正式Drive受理、真实云端运行与H1/H2、技术交付。本改动不是云端已切换的证据，仍未提交/推送/发布。

### JobAid服务解除旧package身份依赖（2026-09-13）

新JobAid任务的sourceRefs与sourceBindings现绑定真实源文件sourceArtifactId/sourceFileSha256，kind=SOURCE_FILE；源文件身份来自有权读取的WorkItem投影，解析正文还必须与该文件artifact/hash/byteLength一致。历史未带kind的任务继续按原package身份核验，不改写其已冻结输入。仓储保存事务对SOURCE_FILE核验artifact及摘要，普通授权查询不再要求旧package存在。

JobAid begin、enqueueContinuation和enqueueOverall移除package非空前置，保留tenant、owner、DV、lease/CAS与确切原文授权；CommonContext在已提供原文units时也不要求旧package。无可读发布原文仍明确拒绝。31项延续/commonContext单元测试通过；实际PG12项通过（/private/tmp/wiselink-m-sourcefile-pg.log），构造的queued WorkItem package=null仍能在Hosted begin形成原文任务，旧package摘要变化不替换已冻结源文件，源文件摘要变化拒绝旧任务。服务端types、定向lint及diff检查通过。

适用性迁移的具体缺口已定位：旧readFrozenApplicabilitySourceBinding要求源解析器提供sourceExpressions、assignments、normalizedCandidates及明确的表达式—适用对象映射；新原文仅有正文/结构/定位，不提供工程谓词。不能把普通段落伪装成source_asserted条件来绕过该边界。仍需真实的候选提取与Host对象映射方案，并接入受控Fleet评价。全局初评状态及外层入口仍有package就绪判断，故上述服务验证不等于完整入口已支持无旧package。

本轮属于实际实现进展，goal继续。全部变更仍未提交/推送/发布，云端H1/H2和正式Drive受理等既有缺口不变。

### 全局状态与JobAid外层路由采用原文就绪（2026-09-13）

新模式的InitialAnalysisStatus不再只以旧package判断就绪：按tenant/DV查询PUBLISHED且original/manifest.json的原文，并核对源文件artifact、hash、byteLength。浏览器使用当前角色的原文RLS；Hosted角色先由有权访问的WorkItem解析真实owner，再通过既有withActorScope查询，scope结束后恢复，未把服务身份冒充用户。无匹配原文时NOT_READY，不能因为旧package存在就继续新任务。

动态评估外层允许明确JobAid请求/已启用新模式转交不含旧package的WorkItem；进入legacy执行分支仍检查旧package。Overall在当前baseRules属于JobAid时保留已成功基础任务核验，但不要求旧package。已提供原文却缺少旧适用性映射时返回WAITING_INPUT/ORIGINAL_APPLICABILITY_MAPPING_REQUIRED；不编造工程条件或认定机队适用。已有配置重评周期的控制边界保留。

验证：状态29项、动态/Overall路由62项单元测试通过（其中新增无package转交）；实际PG12项通过（/private/tmp/wiselink-m-original-entry-pg.log），覆盖Hosted与浏览器就绪读回、无package任务及源文件摘要不符返回NOT_READY。服务端types、定向lint和diff检查通过。本地原文/控制台fixture不代替真实FileService授权和H1/H2。

剩余事项包括：新适用性候选提取及Host对象映射；同DV原文修订变化进入独立WorkItem的实际续评（Matter已接线不自动证明WorkItem完成）；完整新文件受理/创建入口与正式Drive身份；真实云端消费/技术发布及H1/H2。当前仍未提交/推送/发布，goal继续。

### 跨模块集成检查与实际装配修复（2026-09-13）

本轮运行前后端生产构建及完整test/unit。首轮构建通过；单元结果为268套件通过、14套件失败、18套件跳过，2359项通过、27项失败、76项跳过（/private/tmp/wiselink-m-integrated-unit.log）。没有把跳过项算作完成，也未因失败改成宽松验证。

实际产品缺陷已修复：server/database/schema.ts中Matter当前修订复合FK列映射错误，按既有0023迁移恢复tenant/matter/revision对应；EngineeringMatterModule未注册EngineeringMatterWorkingRepository依赖的EngineeringSearchProjectionWriter，补齐真实provider，Nest模块装配测试通过。结构阅读区恢复单一滚动归属及窄屏控件触控高度；保留P新的连续语义article。文档版本页加入OAuth返回白名单，匹配原流程state后恢复parseRunId/sourceRef历史位置，不改变服务端OAuth/PKCE及权限。

其余失败是过期测试夹具或运行依赖：legacy工程结果测试显式收窄联合类型；Reader标题夹具提供真实level；Reader消费测试按实际axes分支收窄；库树测试改为确切DV链接；语义article测试替换旧卡片选择器；模块平台fixture提供现有Capability/SQL上下文依赖。OAuth测试允许既有导航state/path存储，但仍禁止页面记录或直接持久化回调参数。S1000D诊断进程与验证器统一尊重已有WL_TEST_U0_PYTHON配置。

系统python3为3.14且mac_ver返回空，缺少jsonschema，创建临时venv/ensurepip也因该安装问题失败；提权未解决，未降低TLS或验证规则。本机/Users/liuxuan/miniconda3/bin/python为3.12.8，已有仓库固定jsonschema 4.25.1；仅通过WL31_U0_PYTHON和WL_TEST_U0_PYTHON选择该本地测试解释器。旧PDF/XML严格兼容验证通过，未把旧解析器恢复为产品主线。

最终定向复查：原14个失败套件均通过；合并复查先有101项通过、2项跳过，最后模块装配修复后其1项单独通过（/private/tmp/wiselink-m-integration-failed-suites-rechecked.log、/private/tmp/wiselink-m-runtime-composition-fixed.log）。新文档OAuth返回用例也通过。生产前后端构建通过（/private/tmp/wiselink-m-integration-final-build.log）；构建仍提示大chunk及历史worktree的tsconfig发现警告，非构建失败。没有重复跑整轮529秒的已通过套件。

这是本地集成进展，不是云端运行或H1/H2证据；此前全部未完成业务与技术交付事项仍有效。未提交/推送/发布，goal继续。
# 技术交付前现状核对（2026-09-13）

只读核对：妙搭 origin 的同名开发分支为 `373e475fee0edfaf9f4adffd27773ed93cf2eb8f`，是本地 HEAD 的祖先（本地领先 6 提交）；`sprint/default` 为 `62497b87b39b8ad3d8f10b63868a3cfeca699fc5`，与本地左右差为 774/2，不覆盖或强推。明确同名分支的 release-create dry-run 生成了正确 branch 请求。未调用实际 release-create。

最近发布 `7684334373449239540` 失败于远端缺失 `jobaid-evidence-uses` 和 `engineering-search-text` 导致 TS2307；这两个文件当前已被 Git 跟踪，本地构建已通过。前一成功发布为 `7684272668489157591`。两次 release-get 的 commit_id 均返回 `e58375c82a97d348e6ad24492c56870bf370cab7`，仅记录平台回读，不推断两次产物相同。

db-env-diff 实际返回 engineering_search_projection、pending 和 drive_scan_checkpoint 等待发布结构，仍含旧 app.tenant_id 策略；0043–0051 本地修订尚未应用云端。必须先核对 dev 的确切结构并落实必要迁移，再发布，不能把本地 PG 通过当作云端已经迁移。Hosted 原诊断会话仍 is_active=true、latest_turn=cancelled、queued_count=3；未追加聊天、未重放或运行业务。当前只完成交付准备，H1/H2 仍待真实执行。

## 云端开发迁移与发布准备（2026-09-13）

集成提交 `ac6cdd8cc` 已通过原有 pre-commit（ESLint、Stylelint、前后端 types）并以单一非强制 refspec 推送妙搭 origin 同名开发分支；未推送 GitHub。云端 dev 表结构实读证明 0043–0051 尚未应用，随后将这九个迁移合并为单事务，经 dry-run 后执行并返回 COMMIT 成功，无业务数据清理。

平台 dev→online 差异暴露 TO PUBLIC 被转换为仅 authenticated 的行为。新增 0052 显式指定 authenticated/service_role，用于三个新文档 restrictive policy；隔离 PG 的独立文档翻译测试验证三条策略角色集合与拒绝错误主体/旧来源的流程，1 项通过。0052 已在 dev 单事务应用。发布前再次读回平台差异核对实际角色，不能依赖原始 SQL 中 PUBLIC 的假设。

线上只读查询：parseRun 为 2 个 FAILED、无活动解析；活动 ActionAttempt 为 Overall 2 RUNNING、1 QUEUED，均无未到期租约。未重写这些历史任务、未取消或重放。迁移保留 WORK_ITEM 的已有约束语义。Hosted 诊断队列未因此新增请求。技术发布、实际插件运行及 H1/H2 必须分别记账。

0052 实际平台修订：初版 ALTER POLICY … TO 虽返回 COMMIT，但 dev→online 回读仍仅 authenticated，不能记作边界修复完成。已改为单事务 DROP/CREATE 三条同名 restrictive policy，原谓词不变，明确两个平台角色；重跑独立文档 PG 测试通过，dev 返回实际 DDL/COMMIT。后续以平台差异的角色集合读回为准。

## c85 私有包与单文档 scope 准备（2026-09-13）

Host release `7684739961284201424` 返回 finished / `928924c074abc0b93b0f053b00cbbc371846b4a5` / 错误列表空，发布后 dev→online 差异为 0。真实已登录页面打开独立文档原文页并通过正常 FileService 路径读出原件；历史 MINERU_PROCESS_FAILED 保留，未发新解析。

单文档 scope 已在现有 Host online 环境设置文档、actor、最后启用开关三个变量，并回读确认；owner 来自现有 WI，正式身份映射 ACTIVE，现有 tenant/principal/API-key 模式未改。CLI SQL 没有 app.user_id 上下文，直接调用授权函数返回 false，不能拿 CLI 管理查询代替真实 Host 服务调用成功；真实调用仍待验证。

Skill c85 源提交 `58653b973f43f18c0ce345239547fc2e2a9f115c` 已推送妙搭 origin，兼容线 r09 未变。私有应用存储 ZIP `/1876158435627129.zip`，manifest `/1876156861653124.json`；ZIP 已下载回读，371535 字节、SHA-256 `18b0ac0be3934d8a07a518151bdc30df35c0d57c4d4b3b6aa05137aefe386bdb` 与本地 manifest 相同。包内自测通过，不代表 Hosted 已安装。未生成或记录签名分享 URL。

工程 Hosted 原诊断句柄仍 active=true、streaming=false、queued_count=3，旧 latest_turn cancelled 不作为队列终止证明；未重启或追加诊断。apps +get 明确不支持该 Hosted 应用类型（40002），不能从这个管理 API 取得运行环境。继续寻找官方可用管理入口，保留原句柄。

## 独立 WorkItem 原文修订状态边界（2026-09-13，本地增量）

实际缺口：initial-analysis status 只检查存在已发布原文，未与保存评估的任务原文绑定比较；P 的 change 信息保存在不可变 bundle，而 loadPublished 公共返回不含 change。本轮不修改 P 文件，复用正常 Reader 读取确切旧/新原文及既有 compareDocumentOriginal。在有旧评估且原文 parseRun 不同时才读取二者；相同 parseRun 不增加原文件下载。查询最新发布显式按 parseRevision 降序。

纯定位/内容覆盖相同保留原状态；正文或覆盖变化、旧评估缺少原文绑定时，已完成的适用性/JobAid/Overall 状态显示 DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED，保留历史结果和正在运行的后继，不标记新原文已评。真实 Reader 读取失败继续报错，不降级成可评/无影响。翻译状态不因工程状态变化被改写。

31 项状态测试（包含 exact old/new Reader 调用、纯定位、内容变化）、真实模块装配、12 项 JobAid PostgreSQL 测试与 server types/ESLint 通过。PG 测试仍只覆盖已有身份/事务/状态入口，不宣称新增变化的自动续评已通过。剩余仍是：将真实内容变化接入持久续评、从新原文提取适用性候选并由 Host 映射/求值、真实 Hosted 安装消费、F6 正式来源权限和 H1/H2。此增量尚未发布。

## 原文受理 JSON 与初评查询错配修复（2026-09-13）

跨消费者核对发现实际 start() 持久化 source_binding 使用 pdfSha256/byteLength，而 M 的初评状态查询误用 DocumentOriginalBinding 的 sourceSha256/sourceByteLength；会把已发布原文判为 NOT_READY。原 PG 夹具直接保存 original.binding，掩盖了这个错误。先把夹具改为真实受理格式，PG 实际复现 nextOperation=null 而非 EVALUATE_JOBAID；再修正查询两个 JSON key，12 项真实 PG 测试和 31 项状态测试、server types 通过。没有改历史行或增加兼容字段回退；start() 与原文产物各自保留真实字段语义。

后续发布读回：Host release `7684747758318423336` finished，实际提交 `b2890cad040d8066f41c6c7ebb003b4d4423388b`，error_logs 为空。包含上述字段修复及上一节原文修订状态增量，取代上一节“尚未发布”状态；不代表已完成自动续评或 H1/H2。

回归夹具进一步改为调用真实 DocumentParsingHostedService.start()，捕获 reserve 的 sourceBinding 后写入实际 PostgreSQL 已发布运行，再通过初评状态消费者验证；FileService 若被 reservation 调用则直接测试失败。测试显式使用 server tsconfig，12 项全部通过、无跳过。解析结果发布仍由夹具模拟，此项证明入口/消费者字段契约及数据库读取，不证明官方插件执行。

## 各评估阶段独立原文基准（2026-09-13，本地增量）

继续接线时发现仅按 baseRules 的原文基准投影所有阶段，不能独立表示旧 Overall 或旧适用性。本轮改为按当前执行投影（含活动配置重评的 shadow）各自保存的 ActionAttempt 读取精确原文绑定，查询限定 tenant、WorkItem、DocumentVersion 和保存 attempt IDs。分别比较适用性、JobAid、Overall；Overall 还继承其 JobAid 原文过时状态。缺少原文绑定不能作为已评证明，运行中后继与失败历史不自动重放。

同一旧 parseRun 去重读取，新旧 run 相同无需下载原文；纯定位变化保持结果。35 项状态测试覆盖新 JobAid/旧 Overall、旧 JobAid/新 Overall、相同原文、缺少绑定及纯定位变化，12 项真实 PostgreSQL 测试、server types 通过。该检查为持久后继接入提供真实阶段状态，尚未创建自动续评请求；本节代码尚未发布。

## 续评入队时保存确切原文（2026-09-13，本地增量）

续评原先只存 requestId，首次 Hosted claim 才读取最新 parseRun，排队期间发布解析修订会静默改变请求输入。本轮在新 JobAid/Overall 初评请求中保存 originalParseRunId；Host 准备时读取确切 run，公共 ActionAttempt 准备校验也检查实际任务原文绑定相同。已准备任务、旧无该字段请求按原有恢复规则处理，不改写已有记录。

真实 PG 发现浏览器入队不能调用 Hosted 专属 actor scope，已用独立的请求读取入口沿用当前浏览器 SQL 身份/RLS，并保留 owned WorkItem、tenant、DocumentVersion 核对；没有给浏览器服务角色或身份切换。45 项续评测试（含入队后出现新 parseRun、准备结果改版拒绝）、12 项真实 PostgreSQL 测试及 server types 通过。尚未创建自动原文变化后继，未发布本增量；下一接线仍需正常 Hosted 消费入口、基于确切发布版本的幂等受理及在途/失败保护。

## Hosted 原文变化后继受理（2026-09-13，本地增量）

新增实际 MCP `next_original_assessment`，沿既有 BEGIN_DYNAMIC（Overall 额外 BEGIN_OVERALL）服务授权、确认 SB 的现有入口和普通原文 Reader 工作。c86 WorkItem 消费器仅遇到 Host 返回原文影响代码时调用，之后重读 Host 状态并使用已有 begin/claim/save 流程。状态查询本身不创建请求。

受理先捕获解析版本，状态比较核对同一 run，入队再次检查该版本。幂等 requestId 为 `original-<parseRevision>`，既有键同时限定 WorkItem、DocumentVersion、操作；复用 ActionAttempt 对 WorkItem 的行锁、版本校验和所有初评在途检查。真实 PG 并发受理只创建一个请求，失败后同一版本回读仍为原失败，不产生随机后继。每个请求保存确切原文，JobAid 更新后旧 Overall 的原文影响仍可继续受理。

活动配置重评、在途任务、普通失败、适用性原文映射缺口不会被跳过。当前只接通符合既有受理边界的 JobAid/Overall 后继；原文适用性条件提取/Host 目标映射、非 SB 普通文档评估入口仍需完成，不能把该增量写成全流程闭环。81 项状态/受理/动态服务测试、12 项真实 PG 测试通过；c86 发布声明检查通过，云端安装与实际消费尚未完成。

本批技术发布读回：Host release `7684755212175903949` finished，提交 `b0ff1f51025dacf3429bc07e21972f1b053cf253`，error_logs 为空；包含前述各阶段原文基准、入队固定原文和自动后继入口。c86 的 205 项消费器/载荷测试及包内自测通过，私有 ZIP `/1876158131942419.zip`、manifest `/1876161709842555.json`；下载回读 372252 字节及 SHA-256 `492b34c34397d8b08eae4255deedc03969aedc0651a3407a15a6010fd5a9eab9` 匹配本地清单。该包尚未安装到官方 Hosted，旧 c85 上传记录不是 c86 安装证明。

既有官方 Hosted 诊断句柄最新只读仍为 active=true、streaming=false、queued_count=3；latest_turn cancelled 为旧状态，未追加、重启或取消。当前技术发布不等于官方消费实际执行、插件实跑或 H1/H2 完成。

## 非 SB 文档的原文工程入口（2026-09-13，本地增量）

实际 Hosted begin、浏览器续评选项和续评受理三处残留 SB-only 条件。本轮让新原文问题分析接收非 SB 文档的真实分类（含 FTD/SL/AMM），不将其改写或确认成 SB；继续由 CanonicalJobAidProblemService 检查原件、发布原文、真实 owner 和当前来源。旧逐项规则引擎保留确认 SB 与 parsed package 边界，不因开关或既有任务而回落为非 SB 的旧规则评估；SB 自身的已有确认逻辑保留。

124 项入口/续评/状态/原文问题测试通过，12 项实际 PostgreSQL 测试使用 FTD 初评及无 package 续评记录，验证同一身份、请求、来源与恢复边界；server types 通过。此增量尚未发布，不作为线上 FTD 模型评估成功证明。原文适用性提取/范围映射、官方 Hosted 安装消费、F6 正式来源接通及 H1/H2 仍未完成。

## 适用性来源解释未知的真实提交路径（2026-09-13，本地增量）

迁移检查确认当前候选契约只能表示 extracted，提交后还拒绝一切非 Fleet 事实未知；这会把原文无法可靠解释逼成错误，而不是明确 UNKNOWN。本轮沿实际 native AST 候选→Host 候选解析→Kleene→候选持久化路径允许 extraction_failed/not_supported 且 AST 必须为 null。条件 ID 与 SourceRef 仍须逐项等于 Host 已绑定来源，非法属性/操作符、伪造引用、失败状态夹带 true/false AST 继续拒绝，不接受 no_rule_found 擦除既有条件。

Host 只接受与该候选状态、fragmentId 和原因吻合的 interpretation_unknown，保存 WAITING_INPUT/UNKNOWN/pass=false。跟进策略标记 READ_ORIGINAL_SOURCE，不继承引擎旧 grill_me 标签来强制人工逐条确认。72 项 Host 契约/提交服务测试、191 项 native 载荷测试、server types 和 c87 版本声明检查通过。

这修正的是已经接线的来源解释未知提交语义；任务输入/受控选择仍未从 frozen.2 迁移到独立原文，不声称新原文条件发现、作用范围绑定已实现。c87 源码增量尚未打包、安装或发布，已验证私有交付包仍为上一节 c86。

## 原文适用性输入生产与复核（2026-09-13，迁移中）

新增 CanonicalHostApplicabilityInputProducer.produceOriginalAuthorized，复用受控 Fleet/目标选择和原有 CAS，按真实 WorkItem owner 通过正常 Reader 读取确切已发布原文。输入投影 v2 保存 DocumentOriginalBinding 及已验证 manifest 的真实 document-original 引用；三个旧 package 字段为 null，不补造包或 Candidate storeRole。原有 targetBindingHash 在此模式采用实际 manifest SHA，未新增全局哈希机制。

既有 resolveCurrent/readCurrentOwnerValidated/readCurrentSelectionValidated 已支持该投影：提交前正常读取并比较原文，发布后恢复只复核保存绑定与当前选择，不增加 FileService 调用。授权失败不 CAS，原文版本变化不静默改写当前输入，重复生产相同输入不增加修订。58 项生产者/既有提交服务测试及前后端类型检查通过。

当前 begin_applicability_evaluation 仍未切换到新生产方法；实际新原文任务、候选条件发现/作用范围与提交结果的 v3 接线必须完成后再切换。此段是迁移进展，尚非运行入口完成，也未发布；旧任务继续使用现有 frozen.2 绑定路径。下一步修改任务/候选及其 native 消费者，以真实原文 catalog 和候选引句建立 Host 来源/作用范围，而非把所有原文单元预标为 source_asserted 条件。

## 原文适用性 v3 任务构建（2026-09-13，迁移中）

任务构建已消费上一节 v2 原文输入，经生产者重新核对确切来源和 tenant 后构造 applicability_task.v3。任务 sourcePackage=null，originalInput 保存实际 binding/manifest、完整结构单元/表格、原定位及 coverage；sourceExpressions 为空，表示尚待发现条件，不把单元虚构成已声明适用性。保留真实受控 Aircraft/Fleet 和现有 AST 词汇；不用中文或旧包补充工程来源。幂等键绑定原文与受控输入，沿用原有有限长度键哈希，不伪造 packageSha256。

79 项生产者/契约/服务测试通过，包括实际 begin 构建 v3、无旧包读取、完整 coverage 和真实来源引用；前后端类型检查通过。任务版本恢复识别 v3，来源模式不一致直接拒绝。新生产方法尚未在普通新请求入口启用：下一步仍须实现 v3 native 条件发现及 Host 候选引句/作用范围、结果投影与恢复校验，再整体切换。未发布、未调用模型，不将任务构建测试当作适用性求值完成证明。

## 原文条件候选 v2 校验（2026-09-13，迁移中）

Host 已接受仅供原文任务 v3 使用的候选 v2：确切原文绑定、逐单元阅读结论、条件引句及范围提议。旧候选仍按原契约校验。Host 比较真实 payload text/caption（含表格嵌套文本），拒绝伪造/空白引句、错误来源、遗漏单元和错绑条件；不把空条件集解释成适用。范围只在实际标题层级和节边界内处理，缺失文档级 Effectivity/Applicability、跨节目标、未决单元及未读页保持 UNKNOWN。多个实际目标展开为各自的评估片段，不再错误使用引句单元作为所有目标。

82 项相关契约/服务/新来源校验测试和服务端类型检查通过。本实现仅验证候选的来源及结构边界，不证明模型语义抽取正确；文档级识别目前限于顶层明确标题，其余结构保守 UNKNOWN。普通入口仍未切换，native v3 候选输出、结果投影/恢复及真实业务验证待继续接通；未发布，不据此宣称 H1/H2 完成。

## native 原文条件发现与候选组装（2026-09-13，迁移中）

现有官方 Hosted 初始模型适配器已按 applicability_task.v3 选择完整原文条件发现提示词，返回 AST candidate v2；既有任务继续使用 v1。native 校验 exact 原文 binding/manifest 与 sourceContext、一单元一阅读结论、真实 payload 引句、来源及候选目标 ID，拒绝伪造或遗漏。Aircraft/Fleet/runtime 与 originalBinding 从 Host 输入回填，模型不能提供控制字段；输出 applicability_candidate.v2 可由上一批 Host 契约接收。未读单元、解释失败与空条件集原样保留给 Host UNKNOWN 判定，不补造 true AST。

201 项 native 验证测试通过，包含实际模型适配器分支及候选组装、旧契约回归；Skill 发布检查通过。测试使用构造数据和注入响应，未调用真实模型。c87 源码与说明已更新但尚未打包/安装；普通入口仍未切换，结果投影、提交恢复及真实 H1/H2 待继续完成。上一已发布 c86 不代表具备此次能力。

## 原文适用性结果持久化与恢复（2026-09-13，迁移中）

Host artifact/projection v3 保存实际 originalSource binding/manifest，旧 package 字段为 null；产物保存经过 Host 结构校验的逐目标绑定。提交前重建补齐真实 row.tenantId，修复此前只验证 begin 未覆盖的原文租户传递遗漏。APPLICABLE 与 UNKNOWN 均完成实际 service 提交、产物 readback、CAS 和幂等 replay；更改原文输入后拒绝旧结果恢复且不再 CAS。旧 v1/v2 结果继续按原任务版本与来源校验。

状态投影已识别 v3 原文来源，逐阶段原文比较读取 applicability_task.v3 的实际 originalInput 路径；旧 JobAid/Overall 路径保留。112 项契约、提交恢复、状态测试及前后端类型检查通过，未据此声称线上业务完成。普通入口尚未切换；下游工程/相关上下文对原文适用性结果的消费、源变化重新触发及真实 H1/H2 仍需验证和接通。未发布。

## 原文适用性下游消费（2026-09-13，迁移中）

相关上下文已支持无旧包的 v2 原文评估目标及 v3 适用性结果，仍只复用相关文档自己的当前结果。复用须匹配该文档来源、受控选择、Fleet 修订及结果三值一致性，不把主文档的适用性复制给相关文档。原文比较 helper 只比较已提供的绑定，不声称查询最新发布或完成授权。

JobAid 实际 buildInput 以正常 Reader 本次读取的确切原文 binding 复核 v3 结果；来源或 Fleet 修订变化时传入 hostApplicability=null，保留存储的历史结果。新 Overall 保存时同样只采用与其确切任务原文匹配的 v3 decision，否则 UNKNOWN。42 项相关上下文/JobAid 任务及既有续接测试与前后端类型检查通过，含真实 begin 构建三种来源/Fleet 情形。普通入口尚未切换；旧包 Overall processor 仍保留原任务路径，源变化重触发、受控目标配置及全流程 H1/H2 还需接通和验证。本批未发布。

## 原文路径的受控目标端口（2026-09-13，入口迁移准备）

发现生产 MiaodaApplicabilityControlledSelectionAdapter 在读取 Fleet 前仍强制 frozen.2 条件映射，导致原文输入生产虽实现、实际端口仍不可用。已由服务端私有 selection port 增加明确 ORIGINAL 模式；新原文生产及 v2 输入的提交/恢复读均传入该模式。原文发布及字节来源验证仍由输入生产者执行；端口继续核对 tenant/WorkItem/DV，只读取既有 Host 配置或保存的受控目标和 Fleet，不接受模型目标、不开放新的浏览器写入口。

14 项目标适配器/生产者测试及服务端类型检查通过：无旧包时可读取已配置 Host 目标，缺少配置和错误 DV 仍拒绝，旧路径保留 frozen.2 检查。普通 begin 仍未切换：须先把既有任务幂等查询和活动任务保护放到输入迁移前，避免先 CAS 新输入而破坏已经发出的旧任务。本批未发布。

## 适用性预留事务边界（2026-09-13，入口迁移准备）

实际检查发现 action_attempt.reserve 原先只对 openclaw-v2 键获取 WorkItem 行锁，原文适用性 openclaw-v3 和既有适用性键未进入该分支。现对 OPENCLAW_APPLICABILITY_EVALUATION 统一获取同一 WorkItem 锁，在锁内查精确幂等、重新核对 DV/revision、排除其他活动适用性任务再预留。适用性只排除同类活动任务，不新增等待翻译完成的条件；原有 openclaw-v2 JobAid/Overall 活动检查保持不变。

真实 PostgreSQL/RLS 12 项测试通过，其中新增在真实 lifecycle.buildModelInput 期间改变 WI 修订后拒绝预留、同请求双并发只建一条、另一请求不越过活动适用性任务的断言；服务端类型检查通过。此变更补齐输入迁移需依赖的预留锁，尚未实现输入 CAS 的活动任务保护或切换普通 begin，不宣称整个迁移已原子化。本批未发布。

## 输入迁移 CAS 与任务预留互斥（2026-09-13，入口迁移准备）

输入生产者的实际 compareAndSet 已传入服务端租户作用域的 applicabilityInputGuard。MiaodaWorkItemRepository 在同一事务内锁 WorkItem、核对 tenant/DV/revision、检查 QUEUED/RUNNING/RETRY_SCHEDULED/COMMITTING 适用性任务后才更新输入投影；锁与上一节适用性预留共用。保护仅用于 syncPrimaryAttempt=false 的输入更新，不改写或取消已有任务，也不影响其他普通 CAS。

真实 PostgreSQL 测试新增活动任务阻止输入 CAS 和 CAS/新任务预留双并发互斥断言，12 项通过；60 项输入生产/提交恢复测试及服务端类型检查通过。两条并发路径不可能同时基于同一修订成功。普通 begin 尚未切换：下一步在新输入生产之前读取旧任务幂等绑定，确定沿用旧版本还是迁移原文输入。本批未发布。

## 普通 begin 的原文新请求接入（2026-09-13）

begin_applicability_evaluation 现在先读取授权后的只读 admission snapshot，并用当前输入计算精确旧幂等键。找到已有任务时不调用输入生产/CAS，按其封存 schemaVersion 重建；找不到时，现有 WL_JOBAID_PROBLEM_V2_ENABLED=1 或已原文输入的新请求调用 produceOriginalAuthorized，普通未启用历史模式保留旧生产方法。原文生产失败不回退旧包。生产后重新读取 owner/受控输入，并查迁移后的幂等键，沿用前两批的 CAS/预留事务保护。

61 项生产/提交测试通过，新增“先查旧键→新原文生产→查 v3 键→构建 v3”顺序和旧 v1 任务不迁移断言；38 项状态测试通过，已具备有效原文输入但尚未求值时可推进 EXTRACT_APPLICABILITY，不再要求 frozen.2 映射。服务端类型检查通过。测试中的生产者替身负责构造服务测试输入，生产者本身另有真实方法测试；未宣称已跑线上模型。

普通 begin 已接新原文路径，但实际 INITIAL_ANALYSIS 对尚无 applicabilityInput 的原文 WI 仍需配置/发现授权 opaque context 与 Host 受控目标，当前保留 WAITING_INPUT 而非虚构目标；原文变化自动重新触发与完整真实 H1/H2 继续实施。本批未发布、c87 未安装。

## 首次原文适用性入口发现（2026-09-13）

对于已有真实原文发布、尚无 applicabilityInput 的 WI，状态服务现调用输入生产者的只读 admission discovery：读取已配置 opaque context，经原有 BEGIN_APPLICABILITY 服务授权精确核对 tenant/WI，再通过生产受控选择端口读取 Host 目标/Fleet。成功后返回 context 并将原先 APPLICABILITY_SELECTION_REQUIRED 推进为 PENDING/EXTRACT_APPLICABILITY，由 native 原有 begin 流程生产真实输入；不把所有源单元预声明成条件。

发现过程不读文件正文、不写 CAS、不创建目标或业务结论。未配置/未授权/已知受控目标不可用以具体 terminalCode 保留 WAITING_INPUT，未知运行错误继续抛出，不静默降级。45 项生产者与状态测试、服务端类型检查通过，覆盖只读/跨租户拒绝和首次入口状态。真实环境是否已配置对应 context 与 Fleet 仍需运行核验；原文变化后的自动重新评估及 H1/H2 继续推进。本批未发布。

## 真实运行核对（2026-09-13，首次入口接线后）

官方 Hosted conversation_4ky0f6r24fz90 新鲜读回 is_active=true、is_streaming=false、queued_count=3；latest_turn 仍为旧 cancelled，不代表会话结束。未新建/重启/追加消息。P 的“解析”任务新鲜读回仍 inProgress，未发送被阻止的跨任务交接。

线上环境只读核对：WL_JOBAID_PROBLEM_V2_ENABLED=1；适用性 context APCTX-R09-777-4-7f4e2db6c8a941c1b763a0f5、目标 B-1266、asOf 2026-06-05，服务 WorkItem 仍 WI-d09b7acc-2221-4e51-addd-e040ce3c68f4。它不是 FTD 样例 WI-990d6e76-78d4-440a-a419-1b2e37b94ac9，不将既有 777 配置推定为 FTD 的授权目标。两项 WI 的线上 revision 均为 3、status=CANDIDATE_READBACK_VERIFIED；按这两项 WI 查询 QUEUED/RUNNING/RETRY_SCHEDULED/COMMITTING 返回空集。

最新 Host release 仍 7684755212175903949/finished，确切 commit_id=b0ff1f51025dacf3429bc07e21972f1b053cf253。之后的原文适用性改动未上线，c87 未安装。以上只是新鲜状态/配置证据，不证明原文插件 H1 或真实工程 H2 成功。需继续完成变化重评与配套交付，再按各自来源/目标授权推进运行；未修改环境或业务数据。

## UNKNOWN 结果的原文变化失效（2026-09-13）

修复状态投影仅将 SUCCEEDED 结果标记原文影响、遗漏已持久化 WAITING_INPUT/UNKNOWN 适用性结果的分支。现在已保存 UNKNOWN 在逐阶段原文比较确认影响后同样成为 DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED，保留历史 candidate 原值，不修改为 TRUE/FALSE。不把尚无输入的配置等待视为旧结果，也不覆盖 BUSY 活动后继。

38 项状态测试通过，新增 CANDIDATE_ONLY/WAITING_INPUT 两种原文结果在影响标志下均进入重评冲突且历史不变的断言。现有 compareDocumentOriginal 已将 coverage 变化区分于 LOCATOR_ONLY；本批修复消费该影响的状态分支。自动预留/消费适用性后继仍需继续接通，未发布。

## 原文适用性后继队列接通（2026-09-13）

next_original_assessment 在已确认适用性原文影响时，现优先调用 applicability.enqueueOriginal；该入口重新执行原有 BEGIN_APPLICABILITY 授权，精确比对 tenant/WI/principal 和 parseRun/revision。共享 prepareAdmission 与普通 begin，原文版本不符在输入 CAS 前拒绝；后继仅 reserve 为 QUEUED，不抢先 claim 或调用模型，复用既有事务锁和活动任务保护。

后继使用 original-<parseRevision> 请求 ID，原有有限长度幂等哈希保留，键中只补充可读请求段供状态投影恢复。状态读回该请求后，native 既有 next_original_assessment→get_parse_status→runInitial 和每请求 checkpoint 路径可领取 EXTRACT_APPLICABILITY；不另建消费者或绕过工具提交。缺少 context 仍明确等待。

72 项预留/提交/输入生产/后继测试、17 项 native 消费测试及服务端类型检查通过，含不 claim 的队列预留、精确原文和身份传递、源变更在 CAS 前拒绝，以及 native 领取适用性后继。原文与数据库并发边界沿用已通过的真实 PG 验证，本批测试没有触发线上模型；c87 配套交付、真实 H1/H2 仍待完成。本批未发布。

## c87 私有交付准备（2026-09-13）

干净提交 684446e4d68f50998c1a3e4b6bdf906fc746dec7 已生成 wiselink-research-and-synthesize@r09.c87，47 文件、377332 字节；打包器全部 native tests 与版本声明检查通过。SHA-256=fc64063ca3388238a2580947380ec4b0a237706e17a8b46602f1275c81f41a92。私有 Host ZIP=/1876162620589140.zip，manifest=/1876162620589156.json；从私有存储下载 c87-readback.zip 后实际字节长度/哈希与清单一致。

本地目录 /private/tmp/wiselink-c87-package。代码已按单一显式引用非强制推送到飞书 origin/codex/wl31-r09-master-handoff-20260903（5f5df357a→684446e4d），未向 GitHub 推送。c87 尚未安装，不将文件上传视为运行交付；Host 线上仍为前次核实的 b0ff1f510，需配套安装/技术发布与真实原文调用验证。未新增或重启受阻 Hosted 会话。

### 2026-09-13：真实语义读回与首批中文后的定点收尾

- 原生doc job在Host688/c90组合下自然推进，初次数据库快照3块保存、2块selected_for_reading；现有DV Reader中英对照实际显示中文标题和“修订说明”，约6.8%可读，界面显示已保存371/5150原文字符。已保存量与可读覆盖率是不同指标。随后出现TRANSLATION_GENERATION_SUPERSEDED，旧块保留。P已接收真实generation/块修订记录定向修复；另外两处表格消费显示“原表结构暂无法显示”，不修改已发布原文，修现有payload适配。
- Matter正常next准入尚未形成新任务，M定位第二层ActionAttempt严格信封未允许semantic字段，59c125b14已推origin并进入release7684893036418534372；发布完成待核对。追加真实Matter测试使用确切语义1建立任务、后继语义2与新parse3并存，旧任务继续按语义1读取并保存，4组PG通过；信封10项通过。早前688已修外层绑定验证与跨parse关联查询，不能拿它代替59c运行结果。
- 目前没有创建额外消费者、强制cron run、删除失败记录或将用户侧只读会话用于代跑模型；三个原有job已恢复。正式采用仍由工程师确认。

### c95 后续边界

本批不再以解除16000作为编码前置；有界策略及Host增量消费已实现/安装。但实际生成仍未形成首个可执行工作增量。当前安装HTTP入口未见reasoning_effort/thinking/thinkLevel直接读取，不据此伪造任务级透传能力；未全局关闭推理、切模型、修改托管网关或把半个JSON保存。剩余是可靠停止原因进入实际消费者、任务级有效推理/输出行为的核对及首份实质工作，不能以本地测试代替。三个原生job均已恢复enabled=true；未保留暂停、未新增调度。

本轮完整内部标识及读回材料保留于本机/private/tmp/wiselink-c95-internal-integration.md；公开增量不包含新增任务/会话/工作引用。


## 2026-09-16 登录恢复后的队列清理与前端修复交接

后端原会话登录已恢复；M 在原 UI 展开 AI 开发面板，使用每条待执行消息的撤销按钮撤销两条过时审计指令，未点击继续执行。随后官方 session-get 精确回读 queued_count=0、latest_turn.status=cancelled、turn_id=null；界面短暂“工作中”不作为在途证据。c109 的已核验恢复及六项原任务配置保持此前证据，本次没有再次安装、运行 consumer、cron run 或 BEGIN。

前端 Luna 报告四项修复完成：提交 aad3937b9cd1d08535aa5cfef8fcf7ff1598b466，父提交 8cdf5098f77a2d94d9e73fbb32290c16cf153f89；7 文件均在授权 8 文件范围，DocumentVersionReadingPage.tsx 未改。报告 64/64 定向测试、client typecheck、定向 ESLint、build:client 和正常 precommit 通过。以上尚待 M 取回实际对象及 Astra 复审，未集成、推送或发布。

云端另有超范围 document-management-hosted.service.ts 修复，不能随工作树或后续 HEAD 合并。交接明确限定上述前端精确提交相对其父提交的最小 Git bundle，排除附加 server 改动。该交接被自动审批以私有源码跨环境传输为由拒绝，尚无本地修复 bundle；需用户对此指定提交/原妙搭会话到本机 /tmp 的具体取回授权。未绕过拒绝或改走另一传输渠道。


## 2026-09-16 用户代码跨环境传输持续授权

用户明确回复：“授权所有代码跨环境传输，以及后续的相关授权”。该授权解除此前前端 aad3937b 最小 bundle 从原妙搭会话取回本机 /tmp 的传输阻塞，并持续适用于本项目后续相关代码跨环境交接、审查与同步，无须对同范围代码传输重复确认。已通知前端唯一 Luna 操作员继续原精确提交取回。代码传输授权不自动接受超范围实现；仍按准确提交、父提交、文件范围选择性审查和集成，保留原双远端同名 codex/* 非强制同步以及身份、来源和正式采用边界。

## 2026-09-16 真实长 SB、旧测试数据处置与 OCR 图示边界

用户明确旧版 599 单元中文及现有测试数据可抛弃，不要求兼容，优先系统稳定、简洁与效率。后续不再以旧 599 单元形状约束新包，也不重跑该旧中文成果。精确删除了一条已被旧发布卡在 PARSING 的测试 WorkItem 及其两条 attempt；保留实际 DocumentVersion、Document、SourceArtifact、family 和原 PDF。旧无租户 family key 与当前 tenant-scoped family 并存，暂不对复杂旧链做宽泛删除。

真实 737-34-3830 Original Issue 已登记为 `document_version_ca86dbb2e9ec250e3aa66283`，实际源 SHA-256 `add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a`、1,060,204 字节、22 页。OCR 运行时默认打包提交 `26fb96916`、同 WorkItem 重试提交 `c84823dec`、失败报告存储中断终态化提交 `2418ea741` 均已分别发布；最新 Host release `7686123622041455589` 精确对应 `2418ea741ba6e3068efcb22953e1d85d8e1f8740`。

新建 WorkItem `WI-9eef1ca3-33fa-4e2d-9d99-a56d8d16d60d` 已正常终态 FAILED，而非卡在 PARSING。失败报告实际写入并严格读回，证明失败记录链修复生效。失败参数显示部署内 OCR provider 已运行，p7/p21 两张约 56.733% 页面面积的线描图均为 `OCR_LOW_CONFIDENCE`；不是运行时缺失。页面实际核对显示图示含 FMC/E5-2 位置及替换关系，不能把绘图噪声 OCR 冒充正文。

当前最小修法将仅限已有 native text 页面的低置信 raster region 保留为 source-bound `figure`，引用原 PDF 页级 SourceRef；拒绝的 OCR token 不进入正文。空白扫描页、语言/运行时、空结果、冲突与几何错误继续失败关闭。旧 599 预期改为真实 SB 新结构 601 content units（新增 p7/p21 两个 figure）；针对性 15 项测试、前后端类型检查和 precommit 通过，真实文件本地用例因未设置 env 明确 skip，不作为验收。待同名分支提交/双远端同步、技术发布后，在同一 DocumentVersion 上重试并以 Hosted frozen.2 严格校验及实际包读回接受。

后台来源仍未接通：`technical-library` 与 `operations` 均为 `UNKNOWN/NO_AUTHORIZED_DRIVE_FETCH_CHANNEL`，无 cursor/receipt；不制造 adapter 或 receipt。Luna 的隔离 dry-run 只证明本地分页协议，不是正式来源接入。

后续实际提交与发布已完成：`ea6bb7d27` 保留两处低置信线描图为 source-bound figure，release `7686129416049478614`；第一次线上重试到达 frozen.2 语义校验并以 `PACKAGE_SEMANTIC_VALIDATION_FAILED` 正常失败。定位为 figure 未绑定资产后，`1df8c4fc2` 为每个 figure 建立 `pdf_figure_region` 资产及指向原 PDF 的 `source_original` rendition，release `7686133223253167085`；`a99f4fa13` 将该语义校验失败纳入修复后可重试策略，release `7686135667398773730` 已 finished，精确 commit `a99f4fa138b48a2be134be42fa2c56c85cab47ab`，error_logs 为空。三项提交均已同步 origin/github 同名 `codex/wl31-r09-master-handoff-20260903`，远端 SHA 一致。

发布后的同一 WorkItem 仍为 revision 6/FAILED，线上日志没有收到新的重试请求；多次浏览器控制在请求送达前超时，不能把工具超时冒充重试。旧 22:08 的 409 明确发生在 retry-policy 发布前。当前不通过 SQL 改状态，也不轮换/启用已停用开发 OpenAPI Key；后者按 lark-apps 技能属于需显式确认的高风险密钥操作。恢复条件是已登录页面能实际发出一次 retry，或用户明确授权临时轮换并启用精确 scoped 的 `wiselink-s1-development-acceptance` Key，调用后立即停用。成功后继续以 Hosted 包严格读回核对 601 units、600 SourceRefs、p7/p21 两个 figure 及两项 source_original 资产绑定。

外部 Chrome 控制随后已实际接通：精确导航到线上固定版本 `/document-versions/document_version_ca86dbb2e9ec250e3aa66283`，辅助功能树读回文件名 `737-34-3830 Original.pdf`、按钮“解析文档”及“尚无已发布的解析内容”，证明登录、版本身份和入口均正确。WorkItem 数据库仍为 revision 6/FAILED/`PACKAGE_SEMANTIC_VALIDATION_FAILED`，没有新 POST。点击“解析文档”被自动审批以“此前仅只读授权、线上解析会产生处理副作用”为由拒绝；未改用 API、SQL 或密钥绕过。恢复条件收敛为用户明确授权对该固定版本发起一次线上解析；该授权不包含重跑旧 599 中文。

等待该明确授权期间，已用实际原 PDF 路径运行 `host-native-real-737-sb.spec.ts`，1/1 通过（约 4.6 秒）：真实字节 SHA/长度、pdfjs→SPP→U0 frozen.2→Unified Reader 全链成立，严格读回 601 content units、600 SourceRefs、两项 figure、22 页全页来源及禁止自动采用策略。本地结果不替代 Hosted 包读回；线上重试成功后仍须检查两项 figure 的资产与 `source_original` rendition 实际持久化。

用户随后明确“授权线上解析”。外部 Chrome 在同一固定版本上经键盘激活实际发出 `POST .../parse-runs`，HTTP 202，requestId `parse-e2ec8c85-1107-42b7-8d5a-2c81b002b254`，新运行 `PRUN-b2709813-d9a7-4fec-ae73-f67aec95bc5b`、parseRevision 1，deadline 01:30:04。页面读回“正在解析…”，证明预约成功；旧 revision 6 WorkItem 没有被误当新结果。多次线上数据库读回该运行保持 `RUNNING`、artifactProgress=0、leaseOwner=null、leaseGeneration=0、无 errorCode，证明尚无消费者领取，不是已有 STEP 正在执行。

后台妙搭智能体的“去对话”尝试连接 OpenClaw 后返回，未发送运行指令。随后通过外部 Chrome 准确打开 Hosted 终端；终端停在旧 `Display all 1242 possibilities?` 自动补全询问。拟运行已安装 `consume-hosted-work-item.mjs --document-version-id document_version_ca86dbb2e9ec250e3aa66283`，只在每次 STEP 后 fresh-read，PUBLISHED 后停止以避免进入翻译分支。但自动审批将 RUNNING 预约误判为同一步骤正在执行，以重复处理风险拒绝提交；命令未进入终端，线上状态仍为零租约/零产物。终端输入的进一步回车也被审批拒绝；没有绕过。恢复条件为用户在获知该具体风险后，再明确允许对上述现有 parseRun 由 Hosted 消费者执行逐步 STEP；每步仍由 Host lease/CAS 保护，发布即停，不启动翻译、评估、中文或正式采用。

## 2026-09-17：真实长 SB 线上解析发布与来源索引

用户明确授权线上解析后，沿用固定 `DocumentVersion document_version_ca86dbb2e9ec250e3aa66283` 和 `WorkItem WI-9eef1ca3-33fa-4e2d-9d99-a56d8d16d60d`。旧 parse revision 1 `PRUN-b2709813-d9a7-4fec-ae73-f67aec95bc5b` 已按实际过期状态原子终态化为 `FAILED/DOCUMENT_PARSE_INTERRUPTED`；没有沿用其零产物 RUNNING 状态。新 parse revision 2 为 `PRUN-b64c2778-5401-4403-89a5-92fb69a53543`。

新运行最初未被 Hosted 消费者接受，具体原因为 `WL_OPENCLAW_SERVICE_DOCUMENT_VERSION_IDS` 缺少当前精确 DV。保留原 3 个 ID，仅追加当前 DV 后发布后端/OpenClaw 应用；release `7686195813340646329` 已 finished，精确 commit `a99f4fa138b48a2be134be42fa2c56c85cab47ab`。随后由 Hosted 消费者按 Host lease/CAS 逐步推进，解析于 `2026-09-17T02:14:41.182+08:00` 进入 `PUBLISHED`，`error_code=null`。

线上持久化 5 个产物且逐项 `readback=VERIFIED`：`raw/document.md` 37,806 字节、`original/pages-0.json` 59,595 字节、`original/pages-8.json` 126,794 字节、`original/pages-16.json` 55,193 字节，以及 `original/manifest.json` 538,069 字节；主 manifest SHA-256 为 `a549c85780fa1f5e13dc6316cb6e1c1c56be52f0cbf9ace22dbbc2561f40a5cf`。发布绑定保持真实源文件 SHA-256 `add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a`、1,060,204 字节和 22 页。

使用正式 `read_document_original` 对发布物分页读取，22 页均可读。当前线上 `wiselink.document.original.v1` 的准确形状为 366 个阅读单元、406 个互异 SourceRef/locator，其中 344 个 paragraph、19 个 heading、3 个 table；普通工程读取保留 26 项 `STRUCTURE_UNCERTAIN` 限制。该合同由 `composeDocumentOriginal` 按物理文本范围组织、去除页眉页脚等重复项并连接连续表格，图示覆盖以诊断记录表达。因此此前本地 U0 `ProfessionalInput` 对同一 PDF 的 601 content units、600 SourceRefs、2 个 figure 是另一层测试包合同，不能写成这次线上发布物的读回结果，也不再作为旧中文数据的兼容目标。

来源投影通过 `document_work INDEX` 每批 20 条推进，终态返回 `INDEXED`；后续返回 `NO_PENDING`。线上数据库复核 `engineering_search_projection` 为 406 行、406 个互异 locator，`engineering_search_projection_pending` 为 0。索引是可重建派生状态，不改变原文发布物或工程结论。

本轮在 `PUBLISHED` 后没有再次调用会同时推进翻译的 Hosted consumer。线上 `action_attempt` 按该 DV、`DOCUMENT_TRANSLATE` 和当前 producer run 精确查询为 0，证明没有启动旧 599/601 单元中文重跑。未运行事项评估、未生成或采用工程结论，也未把本地 U0 测试冒充线上验收。尚需后续在获准范围内处理 26 项结构限制、后台来源和真实长 SB 的进一步阅读/评估；这些不影响本轮解析发布与来源索引已经完成的事实。

## 2026-09-17：工程态势总数与生命周期覆盖口径分离上线

前端提交 `f9ba7bd22111dcc0c9c4f8c6b05e30b358ccdba5` 将目录是否已穷尽的 `matterTotal` 覆盖与生命周期分布的 `lifecycle` 覆盖分开。当前授权目录已穷尽时可以显示去重事项总数；各阶段分布、知识工作和效果观察仍按各自未完整取得的事实显示部分范围或破折号，不再用一个 coverage 标志把已知总数一并隐藏，也不因目录完整而虚构完整生命周期、知识或效果结论。49 项定向测试、client typecheck、受影响源码 ESLint 和 client build 通过；提交已非强制同步到 origin/github 同名开发分支。

前端 release `7686202075360807894` 已 `finished`，精确 `commit_id=f9ba7bd22111dcc0c9c4f8c6b05e30b358ccdba5`，`error_logs=[]`。外部 Chrome 刷新生产 `/situation` 后读回：`可见工程事项=2`、`有条件需继续核对=0`、`已有知识工作=—`、`有关效果观察=—`；“分析与评估”为“已取得 2 项关联 · 部分范围”，其他阶段保持“阶段关联尚未完整取得”，页脚明确“本次目录已取得 2 个事项；生命周期分布、全量知识和业务时间记录尚未完整接入”。其中 0 是当前目录投影结果，尚未据此生成工程判断；后续需核对该关注指标的来源字段语义。

继续核对确认上述 `0` 仍过度确定：目录 `result.roundCompletion` 为可选字段，当前事项缺失该分类不能等同“没有待核条件”。最小后继提交 `48ee03054f5bb6cd03bb3429af78dfb7c310f777` 将事项关注分类改为 `boolean | null`；只有目录已穷尽且每项都明确分类时才计算关注数量，`COMPLETE` 可得 false、`COMPLETE_WITH_OPEN_QUESTIONS` 可得 true，缺失或不足以判定时保持未知。51 项定向测试、client typecheck、受影响源码 ESLint 和 client build 通过；正常 precommit 与 diff check 通过，origin/github 同名开发分支均回读该 SHA。

前端 release `7686203693624118217` 已 `finished`，精确 `commit_id=48ee03054f5bb6cd03bb3429af78dfb7c310f777`，`error_logs=[]`。外部 Chrome 再次刷新生产 `/situation` 并等待授权目录加载后读回：`可见工程事项=2`，`有条件需继续核对=—`，`已有知识工作=—`，`有关效果观察=—`；“分析与评估”仍准确保留“已取得 2 项关联 · 部分范围”。这完成了已知目录总数与未知关注/生命周期/知识/效果口径的分离，未制造零值或工程结论。

## 2026-09-17：真实同 family 两端读取与正式版本边界复核

线上当前只有一个多版本 family：`family_4aa6b72b084efa83410651ad`，共有 3 个 `COMMITTED_IMMUTABLE` DocumentVersion；family 为 `ACTIVE`、`current_generation=2`，当前指向 `document_version_78c6d0adb612265f85e1d338`。三份登记的 canonical identity 分别是 `GENERATED:2025-09-26`、`GENERATED:2025-07-04`、`GENERATED:2026-05-27`，但 `business_revision` 与 `revision_date` 均为空。因此它们证明同 family 版本登记和当前指针，不足以单独证明发布方正式修订顺序或正式采用关系。

选取已有已发布语义的两端：before `document_version_6b998c1544aa06b5f20b2be0` / `PRUN-ea9543e4-1c2c-4f21-b989-963ca71e875b` / semantic 1，after `document_version_78c6d0adb612265f85e1d338` / `PRUN-9e7cd784-92bb-478d-b34f-ae56fd53e087` / semantic 1。两端 parse revision 2 均为 `PUBLISHED`，profile 均为 `boeing.ftd.sections.v1`。线上日志 `LOG7686073295054900212`、trace `07d138a935b96d0047c147dc37b478a0` 记录生产 `/revision-reading` 精确请求 HTTP 200、无 error；请求 identity、role `ftd.milestones` 与以上两端一致。

从线上私有存储下载两端 manifest 后，SHA-256 分别严格等于数据库记录 `1c0fdc7800d9a5ee6bb699bb2e261b3bbad2c25e3134a36283c241f8b35b2b8a` 和 `7e94474dfc5ef5a2be50636da2a1616a17f5b3c95753acd1a16ec2501d201375`。两端均 5/5 页可读、91 单元、120 locator；分别保留 20/21 项读取限制。语义图中两端各有唯一 `ftd.revision_description`（标题加正文 2 单元）和唯一 `ftd.milestones`（标题、正文及父级条件共 11 单元、11 locator）。用当前生产确定性实现对这些真实线上对象重放：两种 role 均为 `TEXT_DIFFERENT`、reasons 为空；两端文本摘要哈希分别为 revision description `26de7623…` / `537f5ab9…`，milestones `e43afa82…` / `0e876059…`。结果继续明确 `publicationRelationship=NOT_VERIFIED`、`assessmentCoverage=NOT_RECORDED_BY_THIS_READ`，不将系统文本差异写成工程影响、版本相邻或覆盖完成。

定向 revision reading、页面交互和入口测试 43 项通过，client/server typecheck 通过。外部 Chrome 在本轮导航时因 macOS 已锁屏而未取得新的可见页面读回；没有把锁屏当作接口失败。解锁后仍需补同一 URL 的当前可见页面核对。更重要的是，当前材料缺少发布方正式 revision 标识，故“正式换版验收”保持未完成；需要取得并登记真实正式版次/修订说明来源后，才能继续历史评估影响、新版覆盖与必要 Overall，而不能用 GENERATED 日期或当前指针代替。

## 2026-09-17：当前工作、Overall 来源与跨事项引用线上复核

线上当前两个事项均有可追溯工作。SB 事项 `MAT-26b208d0-1cc8-486e-a38f-7b9a99f74e7f` 当前为 `MWREV-75632e5d-e5f4-4cd2-8ace-a254f99f5874` / working revision 16，问题工作已连续从 revision 14 经两次成功更正保存至 15、16；另一个取消尝试没有保存工作。revision 16 的 `overviewStatus=STALE`，保留 Overall 的确切保存来源是 `MWREV-356ec3e8-2c29-4872-9dab-4a6bb4887384` / revision 14，保存回执内 submitted overview 与当前保留正文严格相同。系统没有把问题正文更正静默写进旧 Overall，也没有因文本仍保留而猜测来源。

FTD 事项 `MAT-d9e6c294-f368-42e4-9a1b-b46c6170be02` 当前为 `MWREV-2ac8099c-04f1-4149-9ccb-6f40120a3b68` / revision 12，`overviewStatus=CURRENT`；其 Overall 的确切保存来源就是 revision 12，保存回执匹配。历史问题更正和 Overall 核对请求分别保留成功、失败、取消状态；只有确实由对应 attempt 保存的工作才出现 saved work identity。界面现有 `OverviewSourceWork`、`OverviewCorrectionNotices`、`ReferenceWorkNotices` 及检索命中/展开均读取这些字段，明确区分保存、生成运行和正式采用。

FTD revision 12 还精确引用 SB revision 16 的问题 `claim_maintenance_disruption_risk_under_win7_hypothesis`。`PRIOR_RESULT` 保存 source matter、source work、issue key 和 result revision 16，并声明 8 个根来源；线上逐项比较显示 8/8 在源工作中存在、8/8 在引用方中保留、8/8 JSON 完全相同，缺失/替换为 0。源 SB 的 Overall 仍为 `STALE`，引用读模型会随该问题结果携带来源工作状态及通知，不把连通关系提升为归属、批准或工程结论。

线上没有配置 `WL_ENGINEERING_SEARCH_PROJECTION`，所以当前用户检索走获授权的权威保存工作读取；`engineering_search_projection_pending` 的存量待重建行不构成当前检索空窗。派生投影仍可经受 actor scope 与正常 guard 保护的 `/engineering-issues/projection/rebuild` 重建，但本轮没有绕过浏览器身份直接写数据库，也没有把派生待办解释为业务数据丢失。

`overview-source-work`、`engineering-issue-search`、`library-atlas-reading`、`matter-work-reference` 四组定向测试共 31 项通过。既有真实 PostgreSQL 测试已覆盖带回执来源、连续更正后 `STALE`、历史版本读取、检索命中与展开 identity 一致以及跨事项根来源授权变化。此次线上复核未发现需要代码修补的缺口，因此没有为制造提交而改动实现；下一步仍是解锁后补可见页面读回，并在取得真实正式版次依据后推进正式换版影响与必要 Overall。

## 2026-09-17：后台 Drive 来源正式应用身份与持久阻塞上线

首批范围仍严格限定已登记的 `technical-library` 与 `operations`。用户身份读取两根目录成功；原 lark-cli bot 属于另一应用 `cli_aadf4264f3391bd1`，不能作为 WiseLink 后台身份。已用目录所有者身份把 WiseLink 产品应用 `cli_aadde8b579f95bc9` 以 `appid/view` 精确加入两个根目录，未授予编辑权限、未开放公开链接。线上 OAuth 会话聚合显示 5 个活动会话均没有仍有效的委托令牌；现有会话只保存短期 Aily grant 且不保存 refresh token，因此没有复制个人/浏览器凭据或把 Aily token 改作 Drive token。

提交 `6a08d73dd9c69fc4e1b518f0b55bee276d57a6d6` 增加产品应用 tenant token fetcher、正式 Drive files 分页、`wiselinkDriveSourceScan` automation 及权限错误持久化；提交 `067150180c520ee670dcad1689550c06f106653e` 修正 Fetcher 的 Nest 构造方式并增加真实 TestingModule 装配测试。第一次候选 release 暴露该线上 DI 缺陷且未上线；修复后 release `7686215072277089232` 已 finished，精确 commit 为 `067150180c520ee670dcad1689550c06f106653e`。

第一次真实 cron 于 03:36 触发，产品应用已能取得 tenant token，Drive 读取被拒；同时 checkpoint 写入被旧 policy 的 end-user actor 条件拒绝。触发器立即停用。提交 `c9bd5a9f270e192a355f6b7721fa8cfa5f135581` 将 service-role 每个 checkpoint 事务显式绑定 `app.tenant_id`，RLS 只允许该事务租户，不引入 `USING (true)`；并将飞书 `99991672`/missing scope 精确记录为 `DRIVE_SCOPE_MISSING`，与目录权限拒绝分开。dev→online schema diff 只有删除旧 policy、创建 tenant-bound policy 两项，正式 migrate 返回 `changes_applied=2`；release `7686218760584661980` 已 finished，精确 commit 为 `c9bd5a9f270e192a355f6b7721fa8cfa5f135581`。

第二次真实 cron 于 03:49 完成且没有 ERROR 日志。线上准确保存两行 checkpoint：两项来源均 `complete=false`、`observed=0`、`pending=0`、`continuation=1`，blocker 均为 `DRIVE_SCOPE_MISSING`；对应 trace `9d254099ce2be6f1481ba850d5f58ada`，日志 `LOG7686222712889576628` 与 `LOG7686222712889756852`。这证明产品应用正式身份、调度、tenant-scoped 持久续接和准确失败分类已上线；不证明来源内容已经取得。触发器随后恢复 `0 */2 * * *` / `Asia/Shanghai` 并保持 disabled。恢复条件是飞书开放平台为 `cli_aadde8b579f95bc9` 开通 `drive:drive.metadata:readonly` 后再启用一次真实验证；外部 Chrome 仍因 macOS 锁屏超时，无法在本轮完成该控制台动作。`search:bot` 也未授权给另一 CLI 应用，未扩大其 scope 来旁路查找产品 bot。

定向扫描、错误分类、automation、Nest 装配及 migration 测试通过；完整 precommit 和 server production build 通过。隔离 PostgreSQL 用例因本机 Docker 未运行而明确 skip，已用线上两次真实 cron、policy diff/migrate 和 checkpoint 读回覆盖本轮实际风险。未启动文件下载、资料受理、DocumentVersion 创建、解析、中文、评估或正式采用。

## 2026-09-17：Trinity F1 固定视口 React 几何复核

使用现行 React 路由 `/situation`、当前共享外壳与明确隔离构造的事项目录响应，在 Chromium、DPR 1、`prefers-reduced-motion=reduce` 下分别按 1600×1000 与 390×844 渲染；没有把静态 HTML 放入 iframe，也没有调用生产业务、模型或保存接口。1600px 读回中指标区为 `x=226, y=220.34, width=1350, height=86`，参考为 `226, 220.34, 1350, 87`；双环卡片宽度均为 1026，当前组件高度 686.63、参考 688.63。环板、八个业务节点、六个知识节点、中心智能体和右侧关注栏均由生产组件实际渲染。

390px 读回确认桌面环板隐藏，移动中心卡与 2 列八阶段卡生效；指标区 `x=14, width=362`，双环卡 `x=14, width=362`，与参考结构一致。当前真实投影只能证明目录总数，生命周期、知识和效果仍为部分范围，所以页面准确增加一行“当前仅取得部分范围”说明，使环卡相对完整 fixture 参考下移约 32px；未为追求截图位置而隐藏未知范围。主内容几何、阅读层级与响应式结构本轮未发现需要修改的差异；材质像素验收仍需在已登录线上同环境完成，以上只算本地生产组件复核。

外部浏览器控制再次因 macOS 锁屏在状态读取前超时；当前 lark-cli 用户令牌刷新也受锁定钥匙串影响。只读查询显示应用目录 OpenAPI 不接受当前 user access token，未发现可替代开发者控制台的正式 scope 写接口。`wiselinkDriveSourceScan` 保持 disabled，cron 仍为 `0 */2 * * *` / `Asia/Shanghai`；未尝试以另一应用、个人 token 或扩大权限旁路。解锁后下一动作仍是为产品应用精确启用 `drive:drive.metadata:readonly`，随后单次真实扫描读回两个根目录，再按结果决定是否保持正式定时任务启用。

## 2026-09-17：Trinity F3 工程时间轴结构对齐

现行 React `/timeline` 原先把四类记录排成四列卡片，和 2026-09-16 Trinity 设计中“上方四泳道时间坐标、下方事件列表、右侧同一事件检查器”的职责不一致。本轮只改时间轴组件与样式：保留准确 DocumentVersion、ParseRun、候选 revision、声明、锚点和图谱跳转；上方改为四泳道横向时间图，下方保持可读事件列表，右侧继续核对原词、时间性质、限制和准确来源。

日期表达按保存合同保真：`DAY` 画为日期点，`QUARTER` 画为带端点的季度范围，不伪装成季度中某日；`TBD`、相对时间和无可靠坐标的声明不进入日期图，统一进入“日期未定／尚无可计算时间”。“信息取得”因当前合同没有系统取得时间而禁用并说明原因。当前候选也没有跨版本活动身份，页面明确不把相似标题自动拼成同一活动的预计历史；因此构造样例中的 Q3、Q4、TBD 只证明显示边界，不构成真实同活动版本关系。

定向 Jest 2 个 suite、12 项通过；client typecheck、受影响源码 ESLint/stylelint、client production build、完整 precommit 与 diff check 通过。1600×1000、DPR 1、reduced-motion 的固定视口读回确认 Q3/Q4 为范围线，2026-09-16 为点，TBD 只在未定区，选中声明与右侧检查器仍准确联动。该截图使用隔离构造候选验证生产组件，不是线上业务或视觉验收；线上发布后仍需在登录环境核对真实候选。

前端提交 `4df464ee182ad398c8a426fcbbd9ecf8b60c61d0`（父提交 `93fe29a5921e052e924e8fbcb651ef26c76f8c49`）只包含时间轴 TSX、CSS、对应测试和本集成记录，已普通非强制同步 origin/github 同名开发分支且两端 SHA 一致。release `7686233982300048312` 已 `finished`，精确 `commit_id=4df464ee182ad398c8a426fcbbd9ecf8b60c61d0`，`error_logs=[]`。发布后再次尝试外部浏览器控制，仍在获取浏览器清单时 30 秒超时并重置；因此发布事实成立，已登录线上页面的可见读回仍待 macOS 解锁后补做。

## 2026-09-17：Trinity F3 保存关系图结构对齐

现行生产合同尚未提供事项级、技术域或全景关系，也没有跨版本活动身份。本轮没有复制静态样例中的事项、工作、技术主题或同活动预计历史，而是在已有 `DocumentActivityReading` 的准确范围内，将图谱重排为 Trinity 的画布工具栏、关系画布、节点图例和右侧选中对象检查器。当前唯一启用范围是“保存候选”；“工程事项／技术领域／全景”明确禁用并说明合同缺口。

图中关系仍只有可验证的 `声明 → 逐条引文 → 来源锚点 → SourceRef`，并分别显示“引用／定位／来源”边类型。右侧检查器读取同一声明的时间原词、状态、限制和精确 DocumentVersion/ParseRun，返回时间轴时保留同一 statement/anchor；锚点选择读取实际 source unit、payload path 和 SourceRef。图形底部同时给出节点与关系数量，并明确距离、布局和连通性不推断跨版本事件、归属、风险或因果。

图谱与时间轴定向 Jest 2 个 suite、14 项通过；client typecheck、受影响 TS/TSX ESLint 和 CSS stylelint 通过。1600×1000 与 390×844、DPR 1、reduced-motion 的固定视口渲染确认桌面为左画布右检查器，手机按画布、图例、检查器纵向排列；选中的 `ST-TBD/A-TBD` 在图节点、引文卡和检查器中保持一致。以上仍是隔离构造候选的生产组件验证，不冒充真实线上业务或跨版本关系验收。

前端提交 `74f2e0ca8e5be449e8ca9b2534dffb259d123a42`（父提交 `df6236f74776914480d9c3e67b069a930fcb9419`）仅包含图谱组件、模型、样式、定向测试和本记录，origin/github 同名开发分支已回读相同 SHA。release `7686234968155425724` 已 `finished`，精确 `commit_id=74f2e0ca8e5be449e8ca9b2534dffb259d123a42`，`error_logs=[]`。发布完成证明代码已部署，不替代仍待解锁后执行的登录态线上可见页面核对。

## 2026-09-17：Trinity F3 文件自身换版阅读结构对齐

现行 `/document-revisions` 页面继续只比较 URL 固定的 before/after DocumentVersion、ParseRun、semantic revision 和 role，不重新解释两端身份。本轮将页面结构对齐 2026-09-16 Trinity 的“本版修订说明与对应原文差异／每份文件保留自身有效依据／两端原文并排／已比较的未变范围”，同时保留现有确定性比较实现、角色审计和逐端准确来源链接。

页面继续显示 `publicationRelationship=NOT_VERIFIED` 与 `assessmentCoverage=NOT_RECORDED_BY_THIS_READ`，不把文本不同写成发布方正式换版、覆盖采用或工程影响。`TEXT_EQUAL` 时只声明已选角色的纯文本与父级上下文相同，明确排除未选择内容、表格、图示和工程含义；其他结果则明确没有独立确认的未变段落范围，不能把局部比较扩大为“其余未变”。桌面将 before/after 两端并排，移动端按同一顺序折叠为单列；角色选择收敛为紧凑分段控件。

1600×1000 与 390×844、DPR 1、reduced-motion 的固定视口渲染使用隔离构造的同 family R02/R03 响应，仅验证生产 React 组件、响应式结构和差异边界；没有调用线上保存、评估或正式采用，也不证明当前线上材料已经具备正式版次。当前真实 family 仍缺 `business_revision` 与 `revision_date`，所以正式换版验收保持未完成，后续仍需取得并登记发布方正式版本依据。

前端提交 `5b66a65ac6c3a15ff41d621acc7b453204a4f487`（父提交 `b0ce025acb32e107d0c2bd0a56b15c98cdc03d0e`）只包含换版阅读页面、视图、两端面板、专用样式、两项定向测试和本记录，origin/github 同名开发分支已回读相同 SHA。定向 Jest 3 个 suite、14 项、client typecheck、受影响源码 ESLint/CSS stylelint、client production build、完整 precommit 与 diff check 通过。release `7686242020415458277` 已 `finished`，精确 `commit_id=5b66a65ac6c3a15ff41d621acc7b453204a4f487`，`error_logs=[]`。该发布事实不替代登录态线上可见页面核对，也不改变正式版本依据尚缺的边界。

## 2026-09-17：Trinity F3 独立文档精读结构对齐

现行 `/document-versions/:documentVersionId` 保持独立按 DocumentVersion 进入、可固定 `parseRunId` 和 `sourceRef`、无需先建立 Matter/WorkItem 的读取语义。本轮把已发布 `DocumentOriginalResult` 组织为 Trinity 的 198px 作者目录、三种阅读模式、可调原文／原件双栏、全屏、准确返回和手机单阅读面；原文内页级 SourceRef 可直接切换同一 DocumentVersion 的 PDF 页。PDF 继续通过既有授权读取接口按需获取并在内嵌阅读面显示，没有持久化 blob URL 或改用公开链接。

当前原文合同能够提供作者标题和页级来源，但没有独立的“业务主题目录”，所以该标签明确禁用并说明未取得，不由英文标题或文本相似度猜测。中英对照继续读取已保存翻译及其缺项、版本与来源；本轮没有触发中文生成，也没有把译文提升为根证据。解析、刷新和独立原件入口收进“文档处理”折叠区，固定解析版本、读取覆盖与限制仍直接可见。

1600×1000 与 390×844、DPR 1、reduced-motion 的固定视口使用隔离构造的准确 DocumentVersion/ParseRun/SourceRef 响应和构造 PDF，只验证生产 React 布局、作者目录、双栏、页切换和响应式结构；不作为线上原件、中文或视觉验收。桌面实际为左目录、中央连续原文和右侧受控 PDF，手机默认只显示原文并提供“查看原件”切换；分隔条支持指针及左右方向键，目录和全屏均有键盘可用入口。

前端提交 `57da93d0f2f7bf2935ec2c06d945ff7571d17ab9`（父提交 `0b33532bbc3db281a5b23699389812cada75a783`）只包含独立精读页面、原文阅读器、受控原件预览、专用工作台、样式、定向测试和本记录，origin/github 同名开发分支已回读相同 SHA。定向 Jest 2 个 suite、16 项、client typecheck、受影响源码 ESLint/CSS stylelint、client production build、完整 precommit 与 diff check 通过。release `7686244726098037741` 已 `finished`，精确 `commit_id=57da93d0f2f7bf2935ec2c06d945ff7571d17ab9`，`error_logs=[]`。该技术发布不替代登录态线上真实原件、译文和返回位置核对。

## 2026-09-17：Trinity F3 事项 Wiki 阅读结构对齐

现行 `/matters/:matterId` 已经以确切保存工作作为事项正文，历史 `workRef` 不会被当前工作替换，`MatterProblemWork`、`OverviewSourceWork`、纠正通知和参考变化通知也已分别表达问题工作、Overall 保存来源及当前性。本轮没有再生成一份 Wiki 正文，也没有改变保存、来源、跨事项引用或正式采用语义；只把“事项简报”调整为稳定实底的连贯文章与右侧工作／证据检查器，材料页沿用同一主从布局，窄屏收为单列。

文章区保留已保存候选、决定性条件、其余判断、精确依据入口和问题工作；右侧继续显示当前或指定历史工作修订及其基于事项修订。导航保持工程态势、事项简报、继续核对与讨论、关联资料四个层次，历史工作继续禁用不能准确复现的讨论和资料操作。正文与检查器不再使用大面积动态玻璃，功能导航仍可使用适度模糊材质。

定向 Jest 3 个 suite、12 项、client typecheck、受影响源码 ESLint/CSS stylelint、client production build、完整 precommit 与 diff check 通过。固定视口脚本在独立生产预览中因妙搭 `__platform__` 模板变量未注入而未挂载 React，故没有把该次尝试记录为视觉通过；发布后仍需在登录态真实运行环境核对桌面与手机页面。

前端提交 `732a734e2623c49337c6cd75847328087c04ab84`（父提交 `9fd1bf99d671c64ca0cc5b6d433781a48a7a880b`）只包含事项 Wiki 页面、专用样式、定向测试和本记录，origin/github 同名开发分支已回读相同 SHA。release `7686252831901207530` 已 `finished`，精确 `commit_id=732a734e2623c49337c6cd75847328087c04ab84`，`error_logs=[]`。发布后外部浏览器状态读取仍因 macOS 锁屏超时并重置，故没有把技术发布冒充登录态线上可见验收。

## 2026-09-17：Trinity F2 统一知识读取结构对齐

现行 `/knowledge` 继续复用 `EngineeringIssueSearch`，同时检索有权读取的已保存工程工作和已发布原文；展开工作继续读取确切 `workRef`，保留 Overall 保存来源、更正通知、参考变化、根来源和准确原文入口。本轮为只读知识入口增加“统一知识查阅”主表与右侧详情检查器，窄屏收为单列；Matter 内部的引用比较搜索仍保持原布局和写入边界。

当前 Host 没有授权范围内的完整知识目录或可证明穷尽的治理统计，因此没有复制静态样例中的 6／1／11 数量，也没有为视觉填充构造知识行。顶部只陈述读取口径；真实列表在用户提交关键词、Host 返回获授权的保存工作或原文后出现。当前／历史由显式范围切换控制，命中、相似或连通不自动建立归属、复用或正式采用。

定向 Jest 2 个 suite、10 项、client typecheck、受影响源码 ESLint/CSS stylelint、client production build、完整 precommit 与 diff check 通过。本轮未取得可用的登录态外部浏览器状态，仍不声明线上视觉验收。

前端提交 `4083820648a179c46cfe0998ce8670e2e510bf4a`（父提交 `81fa8c40b6a56578838244911e53d19cb458ca98`）只包含共享知识检索的只读目录呈现、知识页结构与样式、定向测试和本记录，origin/github 同名开发分支已回读相同 SHA。release `7686254565267917769` 已 `finished`，精确 `commit_id=4083820648a179c46cfe0998ce8670e2e510bf4a`，`error_logs=[]`。该部署不补齐当前不存在的全量知识目录、责任字段或治理统计，也不替代登录态线上可见页面核对。

## 2026-09-17：真实长 SB 空定位结构限制更正

从已发布运行 `PRUN-b64c2778-5401-4403-89a5-92fb69a53543` 只读下载原 manifest、三份分页文本层和原始插件 Markdown 后逐项核对。线上 26 项 `STRUCTURE_UNCERTAIN` 中有 17 项同时没有 `pageIndexes` 和 `unitIds`；这些记录来自无法与 PDF 文本层对齐、也没有标题区域可定位的插件表格建议，不能称为“此处结构尚未可靠重建”，更不能作为原文阅读限制。

最小修法只调整该空定位分支：仍拒绝插件表格结构，保留 PDF 文本层，并以 `TEXT_CONFLICT/DIAGNOSTIC` 记录“未采用其结构建议”。凡能由文本匹配或标题区域定位的结构不确定仍保持 `STRUCTURE_UNCERTAIN/LIMITATION`，HTML/Markdown 表格本身的行宽问题与跨页首行关系也不变。新增构造回归测试证明无定位插件表格不产生阅读限制；原有布局测试继续证明有定位而未重建的真实表格仍是限制。

使用上述已发布只读产物在本地按当前实现重组，仍得到 366 个阅读单元和 406 个 source location；限制从 26 项收敛为 9 项且每项至少有页或单元定位，另有 49 项 `TEXT_CONFLICT` 诊断和 2 项图示未解释。该重组没有改写线上产物、没有重跑解析或中文，也不等同于线上验收；现有已发布 manifest 保持不可变。

提交 `52b43396300f38943eeecde3a609913e426bdc88`（父提交 `4099b257267d0ee2a292dd0aae74e98c5af5548b`）仅含生成逻辑、对应回归测试和本记录，正常 precommit、2 个定向 suite 共 16 项、server typecheck、受影响源码 ESLint 与 diff check 通过；origin/github 同名开发分支均回读该 SHA。Host release `7686259511887776730` 已 `finished`，精确 `commit_id=52b43396300f38943eeecde3a609913e426bdc88`，`error_logs=[]`。该发布只影响后续解析；没有重跑当前长 SB，因此当前线上不可变 manifest 仍准确保留原 26 项，直到有独立业务需要的新解析运行产生新版本。

## 2026-09-17：Trinity F2/F3 全局关系图谱观察尺度与检查器闭合

全局 `/graph` 的真实读取仍来自当前 WorkItem 的 `CanonicalLibraryIndexReadResponse`，没有复制离线样例对象或把 activity graph 的声明关系混入 LibraryIndex。本轮补齐 Trinity 规定的四种观察尺度：工程文档、工程事项、技术领域和全景；前两项继续渲染 Host 已保存投影，后两项因真实合同未接通而进入明确 `NOT_CONNECTED` 面板，不显示伪造节点。节点数与边数分别按当前模式的实际投影计算，边界文字明确父子投影、布局、距离和连通性不证明归属、因果、风险或正式采用。

生产节点点击由“立即跳走”改为先在右侧 306px 检查器选中，显示对象类型、稳定标识、保存状态、确切 DocumentVersion 和当前投影说明；只有真实 `getLibraryIndex` 读取路径才显示“打开准确对象”，并沿既有 `buildNodeDeepLink` 进入对应 Host 工作台。隔离预览继续调用外部 `onNodeSelect`，显式标为“查看样例对象”，不把构造 ID 带入生产路由；没有回调的注入投影也不提供生产深链。窄屏及中等宽度按画布、图例、检查器顺序纵向排列，避免全局侧栏后剩余空间挤压画布。

定向图谱与活动图测试 2 个 suite、9 项通过，其中新增覆盖四尺度、未接通态不发网络请求、隔离样例不外跳，以及真实读取后的生产节点选择和显式深链；client typecheck、受影响源码 ESLint/CSS stylelint、client production build、完整 precommit 与 diff check 通过。固定视口本地预览因妙搭 `AppContainer` 缺平台注入未挂载 React，故不记录视觉通过；登录态线上视觉仍需外部浏览器解锁后核对。

实现提交 `789bf2a9500a60586a071e9de324c8350f104641`（父提交 `e9a796130d83d5e536c2e1d36cca77ca1ce5cc5c`）仅含上述关系图谱 4 个实现/测试文件与本记录，origin/github 同名开发分支均回读该 SHA。Host release `7686267875095301052` 已 `finished`，精确 `commit_id=789bf2a9500a60586a071e9de324c8350f104641`，`error_logs=[]`。这证明代码已技术发布；未执行登录态生产视觉验收，也未据图布局生成工程关系或结论。

## 2026-09-17：妙搭云端代码交接固化与 F3 准确时间窗

妙搭云端会话的隔离工作树不是本机 Git worktree；这一差异只影响云端仍有未推送代码的交接，不是每次开发的必经步骤。本轮先从前端原会话按精确基线 `3b38da01422588cabd041758206a5a7a59fd0628` 取回 F3 patch：61,802 字节，SHA-256 `a1fa5768ab5cd1e7d77d93bf8f10350606dbeb117c9a8d94b7936f24972422e3`，云端声明的 9 个文件与实际 diff 一致且本机 `git apply --check --whitespace=error-all` 通过。云端测试只作为交接证据；补丁恢复到 canonical 后才由 Astra 阅读实际代码并进行本地验收。

为避免后续重复进行裸 patch 人工分块，提交 `9362b476ad2d0d2b02da2b8b04506a06b57ce67d`（父提交 `3b38da01422588cabd041758206a5a7a59fd0628`）固化 `MIAODA_CLOUD_CODE_HANDOFF.md` 和本地验证器。新协议要求精确 base SHA、原 patch 与 gzip payload 双 SHA-256、字节数、有序文件清单和带序号压缩分块；本地只在分块完整一致、当前 HEAD 等于基线、路径与文件清单安全、哈希/字节数相符且 patch 可干净应用时写出仓库外临时文件。验证器不自动 apply、提交、同步或发布。3 项 Node 测试覆盖准确重建、缺块拒绝和基线拒绝。

F3 实现提交 `d0009e6958bb18f6877e4b6d6701bca09769965e`（父提交 `9362b476ad2d0d2b02da2b8b04506a06b57ce67d`）将明确年份的 DAY/MONTH/QUARTER/YEAR 解析为真实 UTC 闭区间并按跨年连续坐标显示；缺年份、TBD、RELATIVE 和 UNKNOWN 继续保留原词但不猜日期。`all/current-year` 是受控 URL 时间窗，窗口外已选声明保留为上下文且不进入窗口内计数；时间窗不进入候选读取 identity，因此合法切窗不重读同一候选。timeline、activity graph、原文精读和返回链保持确切 DocumentVersion、ParseRun、candidate revision、runRef、statement、anchor 与 window；非法、空或重复 window 在活动入口即零请求拒绝。

Astra 首轮复审发现并闭合三项实码问题：单年月份刻度偏移一月、未固定候选的迟到发现会覆盖用户刚切换的窗口、活动详情入口会在读取后静默删除非法窗口。修正后 7 个相关 Jest suite 共 91 项、client typecheck、定向 ESLint/CSS stylelint、client production build、完整 precommit 与 diff check 均通过；Astra 最终准入。两个提交已分别以普通非强制快进同步到 origin/github 同名 `codex/wl31-r09-master-handoff-20260903`，两端均回读 `d0009e6958bb18f6877e4b6d6701bca09769965e`。

Host release `7686289702877760745` 已 `finished`，精确 `commit_id=d0009e6958bb18f6877e4b6d6701bca09769965e`，`error_logs=[]`。这证明交接协议和 F3 代码已技术发布；本轮未取得登录态生产页面的视觉与真实内容往返读回，不能据此宣布线上视觉验收或跨版本活动身份已经接通。系统取得时间、跨版本同一活动身份及其他业务泳道仍以当前合同未提供为准。

## 2026-09-17：Trinity F4 已保存复看条件与更正保存引用一致性

前端原妙搭会话按固化交接协议交回 F4 补丁：原 patch 17,305 字节、SHA-256 `f8254f47dc6c7eeb20d378f635aa4b284c929babe655c5fd6af862730c35fc8e`，gzip payload 4,729 字节、SHA-256 `ac4e999e76da4de3dbd0537bb06ed4302ce36b185b614219ebb24d44356a117d`。声明的 6 个文件与实际 diff 一致，本机在精确基线 `64f85201f0ab093fe47c5ed1d715f85fd2272585` 上通过 `git apply --check --whitespace=error-all` 后才应用和审查；云端口头测试结果没有代替本地验收。

工程态势的“改进与复看”现在逐项读取当前已保存工作的 `reviewConditions`，保留条件正文、触发口径、依据引用标识和准确 `matterWorkRevisionId`，并可打开所属工作修订。`undefined`、`null` 和空数组分别保留未投影、没有当前保存工作、当前工作未保存复看条件的差异。该读取没有改变 `activeStages`、事件、事项数、生命周期覆盖或状态推导；页面明确把条件保持为候选，不判断已触发、逾期或已经形成正式改进。现行 Host 仍没有计划与准备、实施与记录、效果与验证的正式记录合同，本批没有用样例或页面位置补造这些状态。

后端同时修正针对性更正的保存读取差异：旧实现只从完成结果的 `modelOutput` 投影 `correctedWorkRef`，导致 SAVE 已持久成功而 FINISH 随后失败或取消时，历史工作、Overall、检索及后续引用看不到真实保存工作。新实现只接受同租户、事项、actor、attempt 的实际 `engineering_matter_work_revision`，并要求匹配的 `MATTER_JOBAID_WORK_SAVED` 持久回执；真实保存优先于后续结果文本。`unchanged` 也只读取与目标 `workRef`/revision 精确匹配的 `MATTER_CORRECTION_UNCHANGED` 回执，不再相信模型输出。attempt 的实际失败或取消状态仍保留，未修改旧工作正文、Overall、正式采用或审批。

定向前后端 Jest、client/server typecheck、受影响源码 ESLint、client production build、完整 precommit 和 diff check 均通过。另在本机隔离 PostgreSQL 实例上执行真实 repository 路径，覆盖“保存成功后 FINISH 失败仍读到准确新工作”“结果声称 unchanged 不能覆盖真实保存”“只有伪造 modelOutput 且没有保存行/回执时不得产生 correctedWorkRef”，目标用例 1/1 通过；该隔离实例随后正常停止，不涉及线上业务数据。

后端提交 `118903524ca81e40b853bcfdcf951b827c952e82`（父提交 `64f85201f0ab093fe47c5ed1d715f85fd2272585`）和前端提交 `f1cfb43147885d96476fb7acad91c7ff80e1a5e1`（父提交 `118903524ca81e40b853bcfdcf951b827c952e82`）已分别按精确文件范围提交；origin/github 同名开发分支均回读 `f1cfb43147885d96476fb7acad91c7ff80e1a5e1`。Host release `7686300155057933252` 已 `finished`，精确 `commit_id=f1cfb43147885d96476fb7acad91c7ff80e1a5e1`，`error_logs=[]`。

发布后通过已登录外部 Chrome 读取线上生产页面：FTD revision 12 在“改进与复看”准确显示 0 项及“当前已保存工作未单独保存复看条件”；SB revision 16 显示 2 条已保存条件、完整条件正文和各自保存的依据引用标识，并继续标明候选内容未必已经触发或逾期。点击“打开所属工作修订”实际进入同一 SB 事项的 `MWREV-75632e5d-e5f4-4cd2-8ace-a254f99f5874` / revision 16，页面明确说明指定版本不会被最新工作替换。该读回验证已发布读取与准确导航，不证明条件真实触发，也不补齐计划、实施或效果合同。
