# 执行器切换与 Host 配合（2026-10-25）

状态：本地任务已重排，准确代码及调用点已盘点。没有部署新载荷、清库、停生产调度、改 Goal 或运行新模型。已完成的技术事实与旧 UNKNOWN 保留；它们不再是新执行器上线必须逐个救回的对象。

## 当前接续：94c54 程序恢复与图契约 v1.8

先更新[图契约2.3/3.6](../WISELINK_MAINLINE_GRAPH_CONTRACT.md)，再在4e8a39b1上吸收准确94c54de（父fc132）27文件增量。程序恢复已具原runner闭合回执、完整解析后SSE事件、codexReceipt与原SAVE/READ绑定；不再把这些列为全部缺失。仍需执行器owner补实际prompt、最终bridge payload及父检查点启动前预定run定位，不把hash或转换后的response冒充完整上游字节。

本地保留固定codex-*队列路由，修复COMMITTING消费者许可表漏READ的真实阻断，并在定位后按原SAVE key核对完整修订。首批CODEX显式拒绝仍封存旧运行app身份的Applicability/Review及关联入口；新app/principal/准确scope与旧合法wire名分开。完整42↔45工具、路由、Task/Result和配置差异只维护在[现有接口包](host-codex-interface-20261025/CLIENT_DELTA.md)。

官方dev/online只读catalog确认三活动partial index与四槽CHECK正确，schema.ts缺WHERE是声明漂移，本轮没有DDL。新消费者实际持续唤起、异常重启、checkpointRoot/runRoot持久卷及跨重启读回仍未证；配置与切换方案不得冒充现场已设置。旧目录图保留，当前[实施树图](../runtime-monitor/WiseLink_Wiring_Verification.html)及[阅读指向说明](../runtime-monitor/README.md)已更新。新增代码测试、源码导出和实际业务验收继续分开。

## 历史接续记录：1155 / fc132291

本节替代下文以0b33原型判断“程序入口尚未实现”的当前安排；下文保留此前盘点来源。已从准确f821基线选择性吸收1155c386实现及fc132291文档的41文件增量，未整树覆盖。主要消费者显式CODEX路径、程序初评、响应检查点、SAVE/独立READ及确定性Overall已有实现；默认HOSTED没有切换。六次GLM运行仍是合成Host验证，不记真实业务完成。

当前本地接线集中在固定Codex MCP身份及专用队列入口、独立服务授权、一个新事项/原请求的准确范围，以及拒绝旧执行者迟到写入。旧消费者不能通过新入口，缺配置拒绝；首批不开放全租户旧任务扫描，不救回旧UNKNOWN。复用当前官方MCP SDK，不建立第二执行内核或第二成果真源。

机器接口包位于 [host-codex-interface-20261025](host-codex-interface-20261025/README.md)。它从真实Host注册离线导出完整工具Schema，区分服务版本、工具Schema和既有wire协议。新执行器负责客户端与进程恢复；本地负责Host真实合同、材料身份连接、保存/阅读及集成验证。

官方只读查询已再次确认最近Host发布为a65a8092、release 7700499229508799768 finished。所报云端IDE `/home/gem/workspace/code` 的sprint/default/2565662e与本地集成树不同；其准确提交也不是当前origin的sprint/default，远端不提供该提交，因此不能推断1,124项未提交内容或线上回退。本地继续唯一集成分支codex/executor-transition-host-20261025，不覆盖云端工作区。

dev/online仅查到原WL_OPENCLAW配置名称，没有WL_CODEX或WL_MODEL_EXECUTOR；现有七个API凭证的授权范围均不含Codex路径。新应用的官方详情查询因应用类型不受支持返回40002，不视为登录失效。旧开发预览失败与整个API选择列表为空的具体平台原因尚未取得运行错误证据；本轮未重复重启、重新登录或创建宽权限凭证。新Codex路径尚未部署，不能在凭证界面视为已登记可用。

完整响应仍需精确区分：现有程序检查点已按输入/模型摘要保存本次转换后的结果，且可在SAVE不确定时查原key；Codex子进程回执尚未嵌入该结果，上游原始响应字节也不是bridge元数据日志。接口包将这两项交给执行器owner窄补，不再写成缺少整个程序入口。

本批不修改原任务清单或工程知识主文，不改Goal、不公开推送、不部署、不改凭据/调度、不清库、不调用真实模型。新业务验收仍只记实际Host保存、同版阅读和正常终态。

## 当前准确来源与撤下的任务

- 已发布 Host 对应公开源 `f821bfe3447367e4d4bc9e140723c92230fc82ed`、私有 Host `a65a80925073e4b88aba6d84413a77aa3c814ff6`。本次只继承已有准确发布回执，不声称重新查询了生产状态。
- 新执行器准确源 `0b33e8bf814d6b6eefebae70c956f556a4db3246`，父 `94c24efa746984a7edbf8b76719e1ffcfa549bed`；已实际 fetch 并核对 GitHub 同名分支 `codex/miaoda-codex-evaluation-loop-20261025`。只新增 `openclaw/codex-evaluator/` 13 文件，旧父分支不能整树覆盖当前 Host。
- 本地 c241 Native 修复提交 `2fa31820b63783baef3eae7457493c159ffe7459`（父 f821）及 146 文件标准包作为资产保留；标准测试通过，不再作为待安装交付。Host 12文件补丁单独保留，未合入或部署。
- 撤下仅为 ATT5、787、M3 和现存失败请求服务的恢复、迁移、兼容及复演；不继续运输安装旧消费者专用补救，不构建双写或长期双执行器回退。不开展大规模删代码。
- 用户允许旧数据再生或清理是新的设计取舍；实际清理须列明准确库、表、对象、保留记录和执行范围。本次没有执行清理。保留 UNKNOWN 作为历史，不补写成功。

## 已有资产按真实边界选择性复用

以下 Native 路径均相对 `openclaw/skills/wiselink-research-and-synthesize/`，来源为准确 2fa31820；它们不要求作为整个 skill 安装。

| 资产 | 准确文件与验证 | 去留 |
| --- | --- | --- |
| 来源目录→正文身份连接 | `scripts/program-assessment-materials.mjs`；`tests/program-assessment.test.mjs`，另有真实 Host begin/readSources→Native→Host snapshot 往返测试 | 保留当前DVI/parse、完整sourceRefId/locator/carrier绑定及正文投影连接；在新程序材料入口接用，不依赖正文重复携带顶层身份 |
| 连续材料和准确旧工作 | 同上；130原文单元、跨页句、结构表、单位、否定脚注；96+4真实Host批量及inline/v2/v3场景 | 保留完整原文、覆盖与限制、准确旧工作READ；不因切执行器重写解析或丢弃条件 |
| 完整响应→SAVE→独立READ | `scripts/run-program-assessment.mjs` 与 `tests/program-assessment.test.mjs` | 复用响应落盘在SAVE之前、原请求key、CAS、独立READ/丢ACK检查等原则及测试；由新执行器适配现有持久存储，不强制旧本地目录布局 |
| 新任务的失败/未知区分 | `scripts/program-assessment-response.mjs`、`scripts/validate-payload.mjs`、程序测试 | 保留有证据的零调用与提交未知区分；具体旧 `PROGRAM_PRE_DISPATCH_FAILURE` envelope 仅在新入口确实采用时移植，不成为新入口固定前置 |
| 旧恢复和消费者接线 | `scripts/initial-assessment-recovery.mjs`、`scripts/consume-hosted-work-item.mjs`、`scripts/orchestrate-host-mcp.mjs` 的旧重入分支；恢复测试 | 停留原分支供历史追溯，撤出首批关键路径；不恢复旧任务证明新方案 |
| 打包版本声明 | `SKILL.md`、`agents/openai.yaml`、`references/input-output.md`、`references/hosted-uat-runbook.md`、`tests/validation.test.mjs` 的c241声明 | 不作为新执行器安装要求或冒用的运行身份 |
| Host事务与终态补丁 | `server/modules/canonical-host/jobaid-work.repository.ts`、`canonical-jobaid-problem.service.ts`；`server/modules/action-attempt/action-attempt.repository.ts`、`action-attempt-lifecycle.service.ts` | 通用来源排序→租约→attempt锁、Actor作用域直至CAS保留价值；当前补丁挂在旧零派发分支，先核新入口实际落点再选择性集成 |
| Host旧失败类型专用 | `action-attempt-envelope.ts`、`action-attempt-envelope.types.ts`、`program-pre-dispatch-failure.ts`、`canonical-host-openclaw-runtime-policy.ts` | 不整批合入新执行器，按新失败/未知结果的真实需要选择 |
| Host验证资产 | `test/unit/action-attempt-envelope.spec.ts`、`canonical-jobaid-problem-continuation.spec.ts`、`jobaid-work-lease-fence.spec.ts`、`test/support/program-pre-dispatch-transaction.ts` | 197项定向检查通过；保留真实producer往返、CAS与权限反例。锁序测试替身不能单独宣称真实PostgreSQL并发验收 |

以上“保留”表示保存代码和测试、在新实际消费者处选择接入，不表示已经完成合并。Native独审及Host锁序/Actor两项修订已完成有限复核，旧整包审批路径终止。

## 主控与新执行器的最小交互

Host 继续持有真实用户/租户、来源授权、准确版本、请求与有效租约、CAS、持久成果和正式采用。新执行器会话负责 Codex/Miaoda 协议与模型进程；主控不再实现一套执行内核。现有 MCP SDK 与业务服务可复用，不为切换新建第二数据真源或通用平台。新运行实例的后台服务身份与用户页面登录是两件事：用户继续使用原飞书身份，不新增评估页登录。

| 顺序 | 现有业务接口/产物 | 谁负责下一步 |
| --- | --- | --- |
| 受理与独占执行 | 新真实用户请求→现有 begin/claim，封存任务、来源、执行模型和有效租约 | Host绑定实际新运行实例；不能复制旧凭据或虚报旧应用/skill；新任务只能一个有效写者 |
| 准确材料 | Host `read_assessment_sources` / `read_assessment_work` 及 programOriginal/source directory | 程序准备连续原文、公司事实、相关方法、准确旧工作及限制，使用实际Host输出测试；模型不补身份 |
| 内容生成 | 新执行器的Codex/妙搭协议适配，输出完整工程workJson及实际模型信息 | 新执行器按程序入口生成；完整响应和本次准确输入在SAVE前持久保留；不得以9次请求作为目标 |
| 保存与确认 | `save_assessment_work`→独立 `read_assessment_work`（原key/准确ref） | 程序固定key和expectedWorkRevision，Host授权并CAS；不确定时只查原key，不另造保存；精确读取不能用任意latest替代 |
| 综合与结束 | 已有 `commit_dynamic_evaluation_candidate` 的合法初评确定性Overall及原生命周期 | Host只消费已独立读回的准确修订，正常提交/结束；首批不另跑模型生成Overall，不能把本地FINISH当Host已结束 |
| 页面与图 | 原评估页、已保存阅读、Wiki引用及既有运行图 | 同一个DVI/workRef/revision/Overall依据可核对；普通页面GET不调用模型，图只记实际证据 |

新0b33原型目前仍由模型选择 READ/SAVE/FINISH、另起Overall回调，`assessment-session.mjs` 的 pendingSave 仅驻内存；`codex-assessment.mjs` 在会话结束才保存汇总，协议日志不是SAVE之前的完整模型响应持久证明。它还未绑定Host封存模型的通用入口、真实身份和新单请求执行权。可复用 `miaoda_responses_bridge.py`、`run_codex.py`、`mcp_stdio.py` 及受绑定业务钩子，但程序控制入口与持久恢复仍由其owner补齐。不要直接将示例两回调注入生产，或借用c235/c239/c240版本声明宣称接入完成。

接入实现先关闭三个已定位差异：`CANONICAL_EXECUTOR_SERVICE_SCOPE_AUTHORIZATION` 虽已存在，实际provider仍是旧 OpenClaw scope，须映射实际新服务身份；`server/modules/canonical-host/program-assessment-materials.ts` 目前核对旧Chat Completions两消息body，须适配新程序入口实际发送的材料视图，不能伪造已发送载荷；Host当前没有完整原始响应上传接口，`MODEL_RESPONSE_SAVED`只是观察，所以完整响应必须由新执行器持久保留并提供准确引用，若选择Host留存则复用现有artifact存储作窄适配。以上分别是身份、材料、持久证据的真实接入工作，不由增加一个MCP名称或复制旧token完成。

准确0b33的 `VALIDATION.md` / `validation-evidence.json` 报告真实 Codex CLI + 妙搭 GLM-5.3、虚构材料、内存Host：9次成功响应、7对工具往返、两修订及准确Overall。`realHostCalled=false`、`hostMcpConfigured=false`、`readyForBusinessExecution=false`；进程重启持久恢复未接。它是执行器实现证据，尚非正式业务验收。

## 翻译、Wiki及其他调用点

以下调用点已按f821源码核对，保留业务能力与替换执行接线分开。详细身份/工具授权映射在Host盘点继续落实。

| 能力 | 已有真实调用点 | 首批安排 |
| --- | --- | --- |
| 程序初评/原自主初评 | `scripts/invoke-hosted-initial-model.mjs` 分派 `run-program-assessment.mjs` / `run-jobaid-problem-assessment.mjs`；Host `canonical-jobaid-problem.service.ts` | 首先替换执行适配；保留材料、保存与同版综合的业务契约 |
| WorkItem翻译 | Host `canonical-host-openclaw-translation.service.ts`、`canonical-translation-v2.service.ts`；MCP `begin_translation` / `translation_workspace` / `commit_translation_candidate`；Native `invoke-hosted-translation-block.mjs` | 独立替换模型/调度接线，保留完整语义批次、规则、保存校验；原文初评不等全文中文 |
| 独立文档翻译 | `document-translation-runtime.service.ts` 的 `document_translation`；Native `consumeHostedDocument` / `run-document-semantic-translation.mjs` | 区分Host官方插件STEP与Hosted模型分支，逐条接线，不因文件名openclaw便重做解析/翻译业务 |
| 文件解读与来源声明 | `consume-hosted-document-reading.mjs`、`consume-hosted-document-activity.mjs`、相应invoke模型；Host `document_reading` / `document_work` | 独立业务消费者，按需更换执行端，保留原文、版本、候选及lease边界 |
| 分层Wiki生成 | `consume-hierarchical-wiki-queue.mjs`→`next_hierarchical_wiki`→`consume-hosted-derived-summary.mjs` 或 `consume-hosted-matter.mjs`；Host `hierarchical-wiki.service.ts` / `derived-summary-runtime.service.ts` | 更换发现/领取/生成执行接线；继续消费已保存准确成员版本，不扩大到所有关系验收 |
| Wiki保存阅读 | Host `derived-summary.service.ts::read/readRevision`、`derived-summary.controller.ts`；前端 `DerivedSummaryReadingPage.tsx` / `HierarchicalWikiDirectory.tsx` | 保留原GET/准确summaryRef和memberRef读链；页面不调模型，不因执行器迁移重建Wiki真源 |
| 交互Review、事项、适用性 | `run-hosted-review-turn.mjs`、`consume-hosted-matter.mjs`、`orchestrate-host-mcp.mjs` /对应Host服务 | 另批按实际业务接续；首条新事项不等所有入口迁移；TDMS/LCM/AEO按需参与 |

## 同一个新真实事项的验收与切换

1. 选定一个新获权事项和准确原件，不复用旧UNKNOWN请求；核对材料版本、页段、条件、否定、脚注、权限与覆盖限制，准备准确五组材料。
2. 新执行器取得该请求唯一有效执行权，程序持久化准确输入与完整模型响应，核实际GLM路由；本地模拟成功不能替代该证据。
3. 沿Host同一保存服务提交一次合法workJson；原key、expected revision、完整问题与概览一致；独立READ返回同一workRef/revision和可独立阅读正文。
4. Host初评Overall确定性消费该准确修订；原页面和图均读该版保存工作与综合依据，引用展开准确来源；普通阅读无模型调用。
5. 读回正常任务终态与租约收尾。新任务的派发未知、SAVE回执丢失、版本冲突、撤权仍需可区分与恢复；不以救旧任务证明新恢复。
6. 技术切换另列实际新实例身份、旧写者隔离、准确Host候选/执行器载荷、调度范围和验证步骤后按既有授权边界执行。隔离须证明旧token/generation不能迟到写新业务；不以迁完旧数据或完成所有旧请求为前置。

图契约、接线验证HTML和运行图继续同一套对象/状态；本次只调整目标接线、下一步与证据分类，没有建立第二状态体系。代码可用、模拟运行、技术切换和真实业务完成分别登记。
