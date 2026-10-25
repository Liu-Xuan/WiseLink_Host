# ATT5 首次合法保存的取证结论（2026-10-25）

**原ATT5首次SAVE被Host来源交付校验拒绝，纠正读取后遇Gateway HTTP400；该旧轮归档、UNKNOWN保留且不重放。准确c239安装与C136原状态恢复已通过。唯一正常新AD后继第6轮于03:41:59.909Z遇Gateway HTTP400 incomplete_result；Host attempt随后于04:25:10.420Z TIMED_OUT，初评及JobAid阶段FAILED/期限超时，保存0。generation 10到期后generation 11正常收尾归档、activeClaim=null，但Native run-result仍REQUIRES_ATTENTION/UNKNOWN；业务验收未通过，SAVE修复未获实测证成。该WorkItem沿用M3 revision0，不是GLM 5.3运行测试；attention修复仍在本地候选审查，未发布或完成。**

事故版本为 Host b8 / Native c238；当前 fa14 联合发布是另一项已完成技术交付，不能反用新版本解释旧执行。下表均为原运行 UTC 事件时间，北京时间加8小时；本次只读观察发生于次日。

| 边界 | 准确证据与结论 |
| --- | --- |
| 生成与分发 | round12 返回 SAVE_WORK；稳定 SAVE key 到达 Host，日志时间15:07:00.802Z，expectedWorkRevision=0。 |
| 首次保存拒绝 | 同轮 candidate-rejection 为 JOBAID_SOURCE_NOT_DELIVERED；与原代码唯一抛点及调用顺序对应，停在 materialize 的来源校验，尚未进入 repository work.save。HTTP200只代表传输完成。 |
| 引用缺陷 | 完整原模型候选提取本DVI的35个原文引用，对照保存前已交付121个引用，仅1个不匹配：page-3-block-11 的同一 parseRunId 写了三遍；其合法双段标识早在READ4已交付。错引位于第5个问题的第3项措施依据，双段本身合法。 |
| 拒绝后的推进 | round13 返回 READ_SOURCES；READ9在15:07:35.679Z返回11条引用、0新增。round14从15:07:36.562Z到15:15:40.880Z，HTTP400，错误类别 incomplete_result / invalid_request_error。 |
| Native结果 | 最后 round14/segment9，expectedWorkRevision=0、saved=null；run-result为REQUIRES_ATTENTION / UNKNOWN，错误为INCOMPLETE_TERMINAL_RESPONSE。 |
| Host及队列收尾 | Host 15:48:04.804Z TIMED_OUT，15:48:06.467Z BLOCKED/清租约。同身份gen9归档记录consumerStopped及BLOCK replay回执；本次active-claim读为JSON null。该次业务驱动与队列已收尾，上游结果仍UNKNOWN。 |

候选原文引用的比对不是完整业务内容和全部方法来源的 materialize 重放。原MCP receipt及具体拒绝ref字段未保留；来源normalization文件未记录。结合实际发送前代码，三段引用是明确需要修复的缺陷；仍不能声称只改该处就已完成合法保存或整体评估。

修复方向限定为：由实际已交付的准确ref建立唯一映射，纠正已证的额外重复段；合法双段保持原样，未交付或歧义不猜测，Host精确授权和交付校验保留。引用修复与HTTP400分别处理；UNKNOWN不重放，不把约484秒请求时段推断为上下文问题或provider根因。旧候选保留，未来新版重生成/清理另按实际版本与授权处理。

原ATT5取证所对应的图契约继续指引同一条验收链：准确来源交付→候选引用→Host拒绝或持久化→独立READ→Overall准确workRef保存→正常结束→同版阅读。原ATT5可关闭“首次拒绝阶段及错误类别不明”和“Native队列收尾无证”的调查缺口，不能关闭SAVE/Overall/阅读验收；P3、工具目录核查不成为无关联前置。

取证过程保留：获批单次后端指令的开发轮completed，但消息接口只返回空内容，未据此认定读取成功。用户完成原应用登录后，通过现有终端执行固定只读投影取得以上结果；没有再发智能体指令、运行业务模型、重放SAVE、改调度、安装或发布。网关当前连通不解释历史模型错误；文件mtime不作运行时间。

原件索引：private:content-review/att5-first-save-boundary-20261025/ATT5_SAVE_BOUNDARY_REPORT.private.md；TERMINAL_CHECKPOINT_PROJECTION.private.json；TERMINAL_REFERENCE_ARCHIVE_PROJECTION.private.json；REF_COMPARISON.private.json。

## 本地修复与验证

准确补丁 `b50ad31c705dce84acc4562e723d28d5ada602d1`（父 `319e4a7d9567a76242d0e1c8ec28cdbe300ad8c7`）仅修改 Native runner 和对应 runtime test。新增三段误写的唯一已交付映射；合法exact引用和旧UPDATE别名行为保留。独立审查通过，相关runtime/protocol/context回归148/148通过，其中5个定向回归覆盖真实故障字段结构、保存前转换、稳定key/独立读回、未交付/歧义拒绝和UPDATE保留来源。修前新回归可复现失败；公开测试使用合成数据。

公开基线Native子树与原c238包141/141文件一致，准确补丁可应用到c238源码；没有连带其他Native功能。本地补丁交付时尚未分配新包版本或打包，当时未安装、推送或发布，也未启动新模型/SAVE；后续准确包与已获准技术切换见下节。新合法保存链按本次真实结果验收；原ATT5 UNKNOWN及旧检查点保持。HTTP400原因仍独立未解，不把引用修复测试当作消除了模型响应异常。

本地实现及验证回执：private:att5-source-reference-repair-delivery/LOCAL_VERIFICATION.private.json；独立审查：private:content-review/att5-first-save-boundary-20261025/LOCAL_FIX_REVIEW.private.md。

## 准确 Native 包与已获准技术切换

准确后继 `c9441561e4363db69f4d9b313a6b824ab6859cb2`（父 b50）仅更新6处当前版本声明，包为 `wiselink-research-and-synthesize@r09.c239`；Native 子树 `409dc2ddaa9d345fa741ce991e760b76272ed472`。相对 c238 共8个 Native 文件；b50 的业务脚本与回归保持，Host fa14 无需重复发布。

标准 ZIP 为 1,056,858 bytes、141个文件，SHA256 `b99b9b730569815f844d6f19ca77432ec25726caa29bdbc0ce537ee6070b6feb`。标准打包首轮因本机沙箱 loopback listen EPERM 失败，保留原失败；在允许本地监听的上下文唯一重跑同一标准 CLI 成功，强制全套检查与版本对齐通过，没有跳过测试或修改 packager。141个文件逐项对照 manifest、准确 Git blob 与本地源码一致；新 extract 按 manifest 恢复权限后亦逐项一致。ZIP多数条目未编码 Unix mode，安装执行材料已明确恢复后验盘。包与安装顺序独审接受。

技术状态为**准确c239已获准一次同名安装并核验，C136按本窗口原enabled=true恢复；这两项通过结论保持**。安装后141/141文件bytes/hash/mode与准确包一致，实际入口/runner指纹吻合，skills list/info Ready及check无缺项；原ATT5获批固定20项未变（附带核对的g8仍缺失）。恢复C136时静态差异0，随后既有自然tick结束，错误/跳过均0；没有手动tick、第二consumer或模型配置变更。平台报告已提交，SHA范围未给，未见push/release；不扩大为已知额外Git变更或Host发布。Host runtime target仍为fa14，c944仅为本次Native包源码。

正常入口的一次新后继在2026-10-25T03:24:34.054Z捕获POST201/QUEUED、replayed=false、candidateOnly回执，并关联新request/AQ/ATT。随后同新attempt的正常用户GET HTTP200确认RUNNING，Host startedAt为03:25:17.745Z；截至03:27:09.769Z读回current=null、Overall NOT_AVAILABLE。此为较早的准确观察时点，保留为历史证据；后续新失败见下节。SAVE→独立READ→Overall准确修订与正文→正常结束→同版阅读尚未证成；不把入队或运行中写成已保存/业务通过。原ATT5 UNKNOWN、旧key和固定档案不重放、不改写；各阶段成功独立保留。

准确材料：private:att5-native-package-delivery/INSTALL_PREPARATION.private.md；LOCAL_PACKAGE_VERIFICATION.private.json；INSTALL_SEQUENCE_REVIEW.private.md。技术安装与调度恢复已独立核验，新业务验收未通过；Gateway HTTP400原因仍独立未解。

本次切换与新链私有回执：private:att5-native-package-delivery/execution-20261025/STAGE2_READBACK.private.json；STAGE3_READBACK.private.json；NEW_AD_SUCCESSOR.private.json；host-ui/11-new-successor-response.private.json、13-new-successor-document-parsing.private.json、14-new-successor-assessment-work.private.json、monitor-001-assessment-work.private.json。公开图仅保留精简事实及索引，不含账号、签名链接、业务正文或私有操作指令。

## 唯一新后继的本轮失败与当前边界

准确c239安装后的唯一新AD后继，第6轮在2026-10-25T03:33:48.839Z开始，03:41:59.909Z收到HTTP400；安全错误字段为 `incomplete_result` / `invalid_request_error`，输出形状为 `TERMINAL_RESPONSE_MISSING`，上游结果 `UNKNOWN`。该新链run-result为 `REQUIRES_ATTENTION / UNKNOWN`，错误为 `JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE`。这确认本轮模型调用未取得完整终态响应，不能据此定位Gateway内部根因或推断provider已终止。

03:51:38.808302Z的固定队列读回匹配同一新request/AQ，`consumerStopped=true`。而03:50:50.957Z及03:50:50.961Z正常用户GET均为HTTP200，初始分析仍BUSY，评估执行仍RUNNING、`current=null`、Overall NOT_AVAILABLE。Native停止消费与Host回显未闭合是这组时点的实际断点；不将该新队列写成已归档，也不推断其后的Host终态。当前0保存成果不证明SAVE从未派发。

**本轮业务验收未通过；c239安装与调度恢复仍通过，引用修复尚未被真实合法SAVE证成。** 独立READ、Overall准确workRef与正文、正常结束、同版阅读尚未完成验收。此前该时点失败读回证据保留；其后Host期限终态与generation11正常归档见本文件末节。原ATT5 UNKNOWN、旧key与固定档案保持，当前新链UNKNOWN也不重放。一次正常新AD后继的获批创建已执行；后续限该新链原回执与本地修订准备，不据此再建请求或扩大业务授权，Host fa14保持。

本轮私有原件：private:att5-native-package-delivery/execution-20261025/NEW_RUN_ROUND6_TERMINAL.private.json；NEW_RUN_STOPPED_READBACK.private.json；host-ui/monitor-016-document-parsing.private.json；host-ui/monitor-016-assessment-work.private.json。事件finishedAt、Native读回及Host读回分别标时，不以文件mtime替代，也不将上游UNKNOWN解释为provider终止。

## 唯一新后继的Host期限收尾、generation 11归档与模型绑定

本段更新03:50—03:51Z时Host仍BUSY/RUNNING的历史观察；不改写当时证据。准确新请求为 `6538a059-2038-47b3-ac65-5f38a4ada16c`，同一WI `WI-9c1ec1d6-bb3d-46ad-9dcd-db41e15fa274`、AQ `AQ-eb39bc28147e4ab6a31267e89166ced7`、ATT `ATT-6c8f46e2-7317-4bf8-bd42-0d788ee08f99`，inputRevision=3。round6在03:41:59.909Z返回Gateway HTTP400 `incomplete_result` / `invalid_request_error`，Native `run-result`仍为 `REQUIRES_ATTENTION / UNKNOWN`，错误码 `JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE`。这仍是Gateway完整终态响应缺失，不据此推断provider终止。

04:25:46.715Z document-parsing GET与04:25:46.719Z assessment-work GET均HTTP200。Host attempt于04:25:10.420Z完成并显示 `TIMED_OUT`；selectedExecution同一ATT/AQ为 `OPENCLAW_DYNAMIC_EVALUATION / TIMED_OUT`，last sourceReads=5，firstSavedAt=null，current=null，assessment-work Overall为NOT_AVAILABLE。document-parsing工作项revision3为 `initialAnalysis=FAILED`、`JobAid=FAILED/ACTION_ATTEMPT_DEADLINE_EXCEEDED`、Overall阶段仍PENDING。此为Host期限终态，不能称Gateway timeout；没有保存成果，业务链未通过。

generation 10正常到期后，自动队列正常续领generation 11并于04:25:13.185Z形成BLOCKED归档；04:26:47.295483Z固定读回activeClaim=null、consumerStopped=true、attentionCode仍为上述Gateway HTTP400。该generation 11归档证明队列收尾，不证明业务成功或Gateway已终态；同次只读投影中的原请求run-result仍 `REQUIRES_ATTENTION / UNKNOWN`。不要把归档手工降写成generation 10，不重放新请求，也不触碰原ATT5/g9档案。

模型来源另行区分：当前全局已保存模型为GLM 5.3 / settings revision 1；该新后继所属WorkItem阶段模型是M3 Probe Large (`m3probe/minimax-m3`，settingsRevision=0，selectedAt 2026-10-10T10:16:16.438Z)，新请求继承既有WorkItem模型，不是c239运行时回退。故本轮M3请求的HTTP400与Host到期不能记为GLM失败，也不是GLM 5.3的运行实测；后续如做GLM实测，须以准确新绑定为依据。attention修复仍只在本地候选审查，未发布、未完成。

本次在既有370条证据后追加四条记录：Host期限终态、generation 11队列正常收尾、模型继承来源，以及收尾后原ATT5固定20项未变；旧ATT5和原370条证据不改。私有输入为 `private:att5-native-package-delivery/execution-20261025/NEW_RUN_G11_NORMAL_CLOSE.private.json`、`host-ui/monitor-018-assessment-work.private.json`、`host-ui/monitor-018-document-parsing.private.json` 和 `MODEL_SELECTION_FINDING.private.md`、`ORIGINAL_ATT5_FINAL_METADATA.private.json`。04:29:38.311168Z原ATT5 20项bytes/hash再次比对changed=[]/errors=[]/allUnchanged=true，确认新请求收尾未改旧检查点。公开投影只记录状态和索引，不含业务正文或凭据。
