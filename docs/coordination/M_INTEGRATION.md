# M 主控集成交接

## 当前运行窗口（2026-09-13，M 负责）

按用户最新意见，以英文解析字面精度、章节/表格/条件语义及实际工程消费为主线；中文仅作同源匹配阅读辅助，不再以翻译完成率作为主验收。前端改版继续暂缓。下表覆盖后续历史记录中的旧阻塞说法。

| 项目 | 当前事实 / 下一动作 |
| --- | --- |
| Host / Skill | Host 5915860c1 已发布，release 7684897153136085952 finished、错误日志空（包含3f3826c72译块接续/表格修复）。c92 已官方安装，ZIP 380677B/SHA256 d09fed44a7f15099533bdc5260df6ed4f6fcaf2ca2320bac57255203c3ff0908，正式目录47/47文件与校验ZIP逐字节匹配。三个原生job安装窗口暂停且确认无活动运行；c92安装文件47/47与校验ZIP匹配（C92_MATCH 47）；c91已核对Host连接，三个原生job均已按原配置恢复enabled；没有强制run |
| online RLS | 用户授权后完成dev诊断及恢复；正式0054差异仅旧名DROP+新名CREATE，官方迁移2项。online旧policy已不存在，新policy支持DOCUMENT_VERSION，独立文档/actor/tenant/原生禁写保留。旧策略阻塞已解除；正常START已实际QUEUED：DTQ-6eae3abb-fdad-4dbd-8649-72ef2faef3f4，workspace TW-f9b7e6dc-ded2-49ee-988f-3c78212fac3f，errorCode=null |
| FTD rev6 | DV document_version_b83523c2b5ba26a2b1753641，parseRun PRUN-c537f5bb-cc97-4ce9-855e-ca8d53e15a31。c8/c88自然PUBLISHED，原件/manifest字节与SHA、2表/编号/条件/页脚实件核对保留，SOURCE41条、pending0。不能用此证明e9/c89或新语义补丁已运行 |
| 语义持久结构 | 0055正式dev→online迁移16项，仅新表/约束/索引/RLS/不可变触发器。online读回RLS=true、4policy、1不可变trigger、1已验证FK。正常INDEX已保存rev6语义修订1，boeing.ftd.sections.v1、12章节。正常read_document_original确切读回，Final Action返回u28/u29及两个SourceRef；原文manifest SHA保持d8237d00…不变 |
| 本批接线 | 已实现INDEX保存首个来源绑定语义修订、确切章节读取；Matter新任务输入固定semantic revision/profile，旧任务不附加latest。JobAid任务含原文语义map。真实PG发现并修复JSONB键顺序导致的假覆盖错误。Host/Skill已部署；c90还修复消费端丢map并拒绝语义修订漂移。实际工程保存待自然调度验收 |
| 运行剩余 | 最新只读：AQ-0f66976d469840b29a457945cfa0949c 已 FAILED / JOBAID_INCOMPLETE_TERMINAL_RESPONSE，c92已按原生调度完成已知协议失败收尾，实际40个原文单元/semantic1读取保留，无新FTD工程workRef。中文恢复请求DTQ-735a6f5d-1da5-4875-8ddc-7b54a548e86b已SUCCEEDED / REMAINING_LIMITATIONS；22个不同译块、26条历史修订，21块选入已保存阅读产物，b20未选入：TABLE_CELL_MISSING检查认为Revision Number列对应缺失（包含原文空单元格）；需对原表/候选核对，不能直接认定是真漏译或检查误报 |
| 验证与界限 | 新语义RLS/CAS/不可变/准确读回真实PG通过；Matter真实PG4组通过；章节/Reader/JobAid续接45项通过；server类型通过。原PDF每步读取与最终整包组装仍有成本；真实SB/H2、语义更正后的业务续接和首份新工程工作仍待完成；首批中文已保存并经Reader实际阅读，完整中文仍未完成 |


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

共享运行范围：目前仅本地隔离测试与只读现状核验；尚未启用本批新业务运行或清理。旧任务先查在途和身份再处理。只向 origin 明确单一引用非强制推送，公开 GitHub 仅只读。

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

真实 PG 发现浏览器入队不能调用 Hosted 专属 actor scope，已用独立的请求读取入口沿用当前浏览器 SQL 身份/RLS，并保留 owned WorkItem、tenant、DocumentVersion 核对；没有给浏览器服务角色或身份切换。45 项续评测试（含入队后出现新 parseRun、准备结果换版拒绝）、12 项真实 PostgreSQL 测试及 server types 通过。尚未创建自动原文变化后继，未发布本增量；下一接线仍需正常 Hosted 消费入口、基于确切发布版本的幂等受理及在途/失败保护。

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
