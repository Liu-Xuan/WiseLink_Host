# 当前接线图与历史快照

当前本地页面由同一 `verification.snapshot.json` 与原组件生成／同步，保留用户已接受的 CSS、组件 JS 和交互；它只呈现证据，不派发任务、不写业务或确认正式采用。

**当前观察（2026-10-28 UTC）**：原 Host 的 release `7701743299497266438` 官方 finished、准确 58b；双端实际运行指纹和页面尚未读回，最近的实际双端指纹是 eed 的历史观察。Native 11f2 已完成 272 条目独立安装但未激活；g17 原指针已释放，不是业务 ACK。新 SB 两项存储绑定匹配，fresh 准入／按钮尚未知，stage／model／consumer 为 0，SAVE／独立 READ／同版 Overall／ACK／成果阅读未验。正式浏览器交互能力缺席，不表示用户未登录。

五处原接线、RC1 可信 full／模型 view 和检查单封存／阅读见 [主线图契约](../WISELINK_MAINLINE_GRAPH_CONTRACT.md) §6.6。人类当前 P0 为正常新 SB 真实链，人类 P1 先完成同源进度／结果的真实阅读与验证，再推进在线检查单管理；既有 P0—P7 是历史工作包 ID，含义不同。管理目前只有内置定义只读，编辑／完整不可变新版保存与启用仍为后置准备，不作为本次首条业务前置。

## 图源与版本

准确 `git show 58b:docs/WISELINK_MAINLINE_GRAPH_CONTRACT.md` 为 **v1.9**（blob `8ccdcd82e4164f0696ec5c02fe8a630af04bcdf1`）；58b 自带 README 的“v1.8”是旧文字。已接受本地图源 `10272acdad4b52d0395dd15f9ca8f2a42749d2b5` 的契约为 **v1.9.1**（blob `b4eb0066e3bc823913f4f55c0919eb731721cce1`，SHA256 `40ddcc2d29039bae37deb1e7438f0386243a722a20edb0c2849dcbab9f116d01`），本次以其既有 runtime-monitor 输入快照及原同字节生成器为基础。可读 v1.10 附件只选择吸收 RC1／独立 READ／检查单含义；原作者增量11来自已保存的助手原消息，不声称取得更晚完整 Library 图稿，也不复制其旧 HTML。历史证据保留原观察时间，不以新生成时间替代。

## 历史快照（以下原时点，不代表当前）


当前定义仍为[图契约 v1.9.1](../WISELINK_MAINLINE_GRAPH_CONTRACT.md)：13节点、47关系、58场景，契约和拓扑不改。打开 [WiseLink_Wiring_Verification.html](WiseLink_Wiring_Verification.html) 查看现有样式；HTML与verification.snapshot.json同源生成。本次仅更新原8个文档/进度文件，未提交、推送或发布文档。

当前技术组合为准确Native f8c/224与线上Host42db。03:43:10.442890Z Native安装完成，目标17/17通过；Host release7700817014554561569 finished、无error_logs，04:02:33.087Z页面前后端42db、runtime-probe PASS，reader仍VERIFICATION_PENDING。旧analysis在04:03:34.275Z跳准确DVI且WI保持；03:59:45.208Z获权FTD既有内容重新读取与整页刷新通过、读取200、写0。以上不增加FTD运行范围，也不替代新工程成果阅读验收。

原c1e1已保持FAILED/NOT_PRODUCED正常收尾：过期g7经正常NEXT取得g8，03:39:08.802Z BLOCK并归档、activeClaim清空；03:41:39.041252Z官方Host确认active0/SAVE0、g8租约清空。收尾model/BEGIN/SAVE/commit/ACK均0，11528原件和配置保持。此前工作形状错误已定位为work.listBrief数组，f8c修订约束；旧完整响应、UNKNOWN及失败检查点不覆盖、不重放。BLOCK不是成功ACK。

GLM-5.3 maxTokens于03:47:36.259130Z从现场64000恢复为131072，profile12f；contextWindow200000、其余设置/凭据保持，04:11:46.244935Z启动前再核同值。用户否认主动调低，回退原因未确定；没有实例重建证据，不宣称跨重建持久配置或Hosted绝对输出上限。此前两个131072参数的HTTP200/stop回执仍按原时点保留。

新3db9于04:10:47.408Z正常受理、04:12:35.148810Z准确f8c单worker/g9启动。材料883271B和模型输入509890B已保留；在模型前record_assessment_program_progress(MATERIALS_READY)失败。官方04:12:47.659009–04:12:49.002688Z同轮日志/trace已定位材料快照storage preUpload连接超时ETIMEDOUT，进度SQL未写；这不是整存储模块未开发，也不是旧work形状拒绝或已知500002593页面错误。日志不含工具返回正文，不补造精确工具错误码。

04:14:43.250264Z Native已停止、consumerStopped=true、本地UNKNOWN，但无generation或实际上游请求；3db本轮实际模型0，本单累计实际模型仍4、SAVE0。04:15:10.820675Z官方Host仍RUNNING/active1/g9 LEASED/programProgress空。后续先查原请求，以Host内层租约04:42:46.637Z自然到期为准，不提前采用本地04:42:44.816Z；原deadline05:10:47.408Z不延长，外层租约05:12:39.109Z不代替内层。仅在身份、材料、期限及实际模型未派发条件仍成立时走现有正常恢复。SAVE、独立READ、同版Overall、正常ACK与新成果阅读均未验，V55—V58仍未通过。

公开3c5167ab/Host7d07d656是独立小修：公开origin/github、Host仅origin的准确同步已核，04:17:10.191933Z记录仍未发布，线上仍42db。它仅把HTTP200平台错误k_func_ec_500002593转为可重试读取提示、保留草稿并待fresh成功恢复动作；身份/版本及真正401/403/404边界保持。它不修复本轮材料上传连接超时；待当前业务请求安全结束后安排发布。

## 历史观察（截至2026-10-26T01:54:42Z）

以下记录保留此前时点的原结论和时间，其中“当前”“最新”“未执行”等均指该历史观察；当前状态以上述新增事实为准。证据JSON中原431条完整保留，新增事实另记，不用新的生成时间覆盖旧证据。

当前Native为准确c3f07a7c（父617d）：公开同名origin/github已核同SHA，01:11:26.125579Z在17gr隔离安装224源码文件；新Linux目标52/52通过且224文件前后hash/mode一致，01:13:00.752902Z原身份/工具metadata握手PASS、业务调用0。Host继续保持68e1dcef，原release7700762570365717530及前后端同版PASS事实保留，本次未重发Host。c3f是Native窄修后继，不称同tree Host新发布。

首次安装器因重建roots漏了原保存map单独加入的g5归档，在创建目标/validation之前安全拒绝；原5650map逐项hash全一致，未发生产品或模型失败。原脚本/证据保留，v2按真实map集合、逐hash及mode前后保护核验，同一ZIP成功安装；没有删除guard或猜改总数，旧af38、原artifact、配置/凭据保持。

历史安装事实：准确Native af38ca26（父378d33e1）已在origin/github同名codex分支读回同SHA，2026-10-25T23:44:25.370313Z于17gr安装222源码文件；旧安装、原5645取证文件及凭据保持，未改全局runtime指针。安装后Linux目标16/16通过，执行前后222文件hash/mode一致；原身份与工具metadata握手于23:46:24.493143Z退出0、业务调用0。目标16包含预算6、长度终态3、skills新增5和Python配置2；原Linux12未重跑，不与既有验证重复累计或记作业务完成。

输出预算已从实际OpenClaw配置中唯一的miaoda/glm-5.3模型元数据接入，移除适配器16k默认及32k硬上限，保留显式较低业务预算和旧16k恢复绑定。用户已移除本单人为模型调用次数上限；2026-10-25T23:39:28.948080Z只将该模型maxTokens由64000设为131072，contextWindow仍200000，其余设置/凭据不变，配置动作未调模型。131072最初仅为配置值；上一b13请求已带该参数获HTTP200/stop、实际输出35498；新c1e1再次带131072获HTTP200/stop、输出27056。其中b13的35498已跨越旧16/32K适配器上限。该事实证明本次参数请求被接受，不声称Hosted绝对最大输出容量；不由context声明的算式推断必然拒绝。

a2旧请求的已知长度失败已正常收尾：对应上游finish_reason=length、输入169583/输出16384，无可采用完整候选；Host于23:30:32.859Z终结FAILED/NOT_PRODUCED，terminalReason为JOBAID_MODEL_OUTPUT_LENGTH。原g5于23:33:26.995Z正常BLOCK，Native最终BLOCKED_CLAIM_FINALIZED、activeClaim已清及g5归档均已核；该收尾模型/SAVE/ACK均0，原UNKNOWN与5645取证文件保持。BLOCK是正常失败收尾，绝非成功ACK或工程成果闭环。

上一b13先通过正常页面接续为WAITING g5并正常领g6。首次launcher仅在worker前PREFLIGHT_EXPIRED_BEFORE_WORKER，模型0；独立retry1于00:28:37Z启动本单第三次真实模型。原131072参数请求获HTTP200/stop、输入169575/输出35498、完整response持久及Codex exit0/turn.completed事实保持，但invalid_structured_final使Native UNKNOWN/CODEX_GENERATION_INCOMPLETE、SAVE0。c3f只对严格证明的“仅根对象EOF缺一ASCII }”提供派生规范化/恢复凭据，不覆盖原raw/summary/receipt/UNKNOWN，也不替代工程schema和Host采用决定。

b13的原attempt lease超过其原硬期限，既有receipt-only重新认领没有合法窗口；未用安装绕过。deadline后按原参数恰一次正常BEGIN完成TIMED_OUT核对，再于01:02:53.027Z正常BLOCK g6，独立回读后以既有finish-blocked-claim replay归档并清activeClaim。11173旧文件及配置不变，完整上游响应/本地UNKNOWN保留；该收尾model/SAVE/commit/ACK均0，不能称成功ACK或工程成果闭环。

最新新请求c1e1于01:15:46.034Z正常受理，原截止02:15:46.034Z与同WI/intake/DVI/revision3/PROGRAM/GLM保持。01:24:24.535704Z正常启动唯一worker并领取g7；本单第四次实际模型请求max_tokens131072获HTTP200/stop、输入169591/输出27056，完整response持久。原始final和transport保留，c3f生成独立EOF派生规范化及恢复凭据，流程已进入工作结构校验；但PROGRAM_WORK_SHAPE使本轮在SAVE前被拒。Host于01:28:22.142Z正常终结FAILED/NOT_PRODUCED，无modelOutput/projection/SAVE，累计实际模型4、SAVE0。旧11415文件与配置前后不变。

最新官方读回为2026-10-26T09:54:42.177431+08:00：active0、SAVE0、attempt租约已清，g7仍LEASED。g7正常BLOCK/finish模板已准备并独审接受，尚未执行；失败收尾也不等于成功ACK。原17gr Chrome页面暂加载失败，没有新Native boot、文件丢失或重建证据；先恢复原现场只读访问并查本轮具体字段，不因浏览器故障断言实例已丢失、重装或重派。旧请求/原UNKNOWN与当前完整响应保持；V55—V58仍未通过，合法工作结构、SAVE、独立READ、同版Overall、正常ACK和成果阅读继续待实证。

历史2636那次GLM5.3尝试仍保留原UNKNOWN：有限SSE见模型标识，随后桥本地502/bridge_internal_error，无完成finish、usage或完整response；不把未知usage写成0，不以旧exception确称socket.timeout。其g4正常失败收尾与后来的a2长度失败/g5归档分列，不改写原文件，也不因安装或新请求重置、迁移旧身份。

用户此前指定目录、CORE产品树的同名HTML及旧候选保留为历史快照，不覆盖用户修改或自动重定向。既有历史事实保留，只按授权将完整历史业务标识缩短、私有绝对路径替换为逻辑引用；原路径映射仅存私有报告。图生成时间不替代各原件观察时间，证据条数不是完成率，Host保有业务真值与正式采用权；当前页不派发任务、不改租约、不保存正文或确认正式采用。长期实例回收/未SAVE响应恢复等范围继续独立保留。
