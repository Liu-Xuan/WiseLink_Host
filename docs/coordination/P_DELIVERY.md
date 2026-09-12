# P 解析与翻译交付

## H0（2026-09-13，构造资料）

- 角色：P；目标是 Host 官方插件原文、V2 翻译和文档 Reader。主控任务 `01a09678-7f38-7b92-b280-85b32d950066`。
- 基底：`9cd596d1642c996dce3f895f579201a0fbdb908b`。独立分支 `codex/wl-r10-document-plugin-20260913`；可见路径 `/private/tmp/wl-r10-document-plugin-20260913`。
- 当前交付：`shared/document-original.interface.ts`、`document-original-adapter.ts`、`test/unit/document-parsing/`。复用 TranslationStructuredSource，不伪造 frozen.2 或 MinerU 中间文件。适配要求完整 binding 精确相等，保留覆盖缺口，页级定位不生成精确框。
- fixture 明确为构造资料，含长正文、三列表格、页级 SourceRef、结构疑点和未读页。未进行真实插件调用，未复测附件两页 PDF。

### M 聚合需求与接缝

1. 依赖：保留现有 pdfjs-dist/parse5，无新增普通 npm 包。请 M 按平台 actionPlugins 机制装配 ai-doc-parser、ai-translate（附件版本 1.0.16/1.0.11；需目标 Host 实际 manifest 核对）。保留 ai-text-to-json 1.0.26。P 在取得实际 manifest 后编写专用实例和调用，不推测平台 action schema。
2. 类型：M 可直接 import `DocumentOriginalResult` / `DocumentOriginalBinding`，并消费 `documentOriginalStructuredSource(result, expectedBinding)`。几何 sidecar 明示 PDF viewport 坐标；通用旧 locator 只传页位置。结构正文在 source 中，无译文。
3. 持久存储：计划在现有 parseRun 的 JSONB 产物列保存中立文档 descriptor，复用原字段与唯一键；需要 M 将 `server/database/document-parsing.schema.ts` 的 MineruStoredArtifact 类型换成中立类型（P 后续提交具体类型），不需要为了改 TS 类型单独迁移。若 M 的领取/lease 需要数据库字段，由 M 管理迁移。
4. 发布事务：现 `DocumentParsingRepository.publish` 已有短事务和版本 CAS，但缺少原文 pending。请提供在同一 tx 内 await 的窄登记操作，输入 tenant/documentVersionId/parseRunId/parseRevision/原文 manifest descriptor；P 不在 tx 内调用插件或重建索引。
5. 运行入口：P 将暴露有界 `executeStep`，不再靠 detached Promise/Map 作为恢复证明。请 M 提供现有持久消费者的领取/有效性端口和 provider 注册落点。取消、lease 失效、授权收缩必须在写入 current 前复核；不借 `service:openclaw` 身份。
6. 请 M 在首次集成提供获准真实文字 PDF、身份/记录范围和插件预算；P 可在范围内独立完成内容及局部恢复测试，复用 M 同一次云端运行证据。当前未占用共享测试记录、未发布、未推送任何远端。

下一步：P 独立推进确定性原文对照、插件适配、V2 和 Reader。H0 并非所有功能完成；H1/H2 尚未运行。

### 本地契约核对（非目标 Host 运行证明）

独立临时目录通过 `lark-cli apps +plugin-install --as user` 安装 doc-parser 1.0.16 / translate 1.0.11，并复制至 P 自有 node_modules；没有改 M 配置或发布环境。M 已另行确认 canonical 安装同版。

Schema 摘录卡（实际 manifest + `plugin-hydrate.js`）：

| 实例 | action / 输出模式 | 输入 | 输出 |
| --- | --- | --- | --- |
| wl-document-parser | parseDocToMarkdown / unary | fileUrl: string[]，恰好一个 Host URL | content: string |
| wl-document-translate | translate / stream | content: string；实例固定 zh-CN | translation: string |
| wl-document-structured-translate | textToJson / unary | itemsJson: string | items: array，Host 验证 id/translation/顺序 |

全部服务端调用。已读安装的 nestjs-capability `call` 实现及 ai-translate `aggregate`：服务端支持自动聚合，translation 是各 chunk.translation 拼接。text-to-json 实际字段为 paramType（不是 type）。P 不伪造模型名、tokens、provider request id；具体模型保持 null。`DocumentOfficialPluginService` 需要 M 在文档模块注册；每次调用前后均通过实际 assertActive 回调核验，不宣称能取消远端执行。

新增原文对照测试覆盖重复句/页缺口/负号件号、合法键值表/额外列/缺列；源计划长章节按完整句边界调度，未完成句跨片段保留。上述为本地构造测试。

### 本次验证与接线状态

- `node node_modules/jest/bin/jest.js --runInBand test/unit/document-parsing/`：4 suites / 14 tests 通过（全部构造/隔离输入）。
- `node node_modules/jest/bin/jest.js --runInBand test/unit/canonical-translation-source-plan.spec.ts`：5 tests 通过，含既有真实 737 来源 fixture 的 Reader 保留检查；没有新线上模型运行。
- `npm run type:check:server`：通过；前序提交 hook 中 client 类型与 stylelint 也通过。
- 使用 jsPDF 构造两页 PDF 后，真实 `pdfjs-dist` 异步读取成功，读到 `A-12`、`-0.25`，pageCount=2；不是厂家 PDF 或插件运行证明。
- 已在 `DocumentParsingRepository.publish` CAS 后同事务 await M 提供的 `registerPublishedDocumentOriginal(tx, result)`。M 的 `document-original-pending.ts` 仅复制到 P 进行类型检查，属于 M，P 补丁不重复交付。
- 首次 git commit 未成功：基底全库 ESLint 扫描 `server/modules/document-management/src/hosted/wiselink-drive-source-config.spec.ts` 时不属于 parserOptions.project。未跳过 hook、未改 M 根配置。交付改为 `/private/tmp/wl-document-P-H0-20260913.patch`，以 9cd596d16 为基底，排除 M 文件，方便 M 按所有权集成。
- `document-original-compose.ts` 采用唯一原文匹配的插件结构，保留未匹配 PDF 文本及明确限制；表格所有实际列进入既有 V2。`document-original-pdf.ts` 直接异步加载已安装 PDF.js，无 MinerU 子进程，页范围有界，逐页 cleanup 并 destroy。

仍未完成：中立 FileService 产物保存/回读及原 Host 解析执行替换、M 持久 lease 消费接线、V2 官方 producer 持久保存接线、局部 Reader 接入、H1 真实获准 PDF、H2 实际中断恢复与来源变化。当前新调用/组合器是经本地验证的可集成组件，不宣称已完成 Host 正常业务流程。下一批继续这些内容；不因单测成功关闭 goal。

## H0 后原文执行增量（2026-09-13）

交付 `/private/tmp/wl-document-P-original-step-20260913.patch`，仅相对已集成 H0 的原文执行/Reader变化；V2 producer 正在 P 工作树继续开发，不包含于此补丁。

- `start` 只 reserve。主控消费者调用 `executeStep(parseRunId, {documentVersionId, tenantId, actorUserId, roles}, fence)`，每次最多提取8页；M负责租约续租/release/重试调度。
- 仓储 `stage/progress/publish/fail` 均新增最后一个 `DocumentStepFence` 参数，事务内调用 M `assertValid`。`recordStepFailure(scope,fence,code)` 保留现有 STAGING/进度供续接，租约失效时不借旧身份写失败。
- FileService 用固定 `raw/document.md`、`original/pages-N.json`、`original/manifest.json`。无 upsert，上传响应丢失后先核对精确路径/metadata/bytes。角色沿现 JSONB 已支持的 RAW_MARKDOWN/MANIFEST，页面文件是真实 PDF.js 页组 JSON，不伪造 MinerU middle/content-list。
- `loadPublished(DV, parseRunId, context)` 返回 `{run, original, structuredSource}`；必须给确切 parseRun。新 `read` 返回 `DocumentParsedReading.original`，文档页已用 DocumentOriginalReader 展示原文表格、覆盖限制、真实页链接。历史 MinerU 仅保留已发布产物读取。
- `DocumentParsingHostedService` 构造依赖替换 remoteWorker 为 `DocumentOfficialPluginService` + `DocumentStepLeaseRepository`；M已注册两者。状态区分 NOT_CONFIGURED/CONFIGURED_UNVERIFIED/CALL_SUCCEEDED/FAILED；配置存在不宣称实际已成功。
- 原文 producer.extractedAt 允许 null；恢复时未知具体调用完成时间如实保留 null，不能以重新组装时间伪装初始提取时间。

验证：P 自有 PG `/private/tmp/wl-P-document-pg-20260913`，仅127.0.0.1:55440，数据库 wiselink_document_parse_test。应用0038/0039/0042/0043/0044/0045；`DOCUMENT_PARSING_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55440/wiselink_document_parse_test node --test test/node/document-parsing-postgres.test.mjs` 通过。验证pending失败使publish回滚、成功登记确切parseRun/DV/actor、旧token进度拒绝、CAS/回读/跨actor与tenant边界。

`document-original-execute.spec.ts` 隔离执行测试通过：9页两步（0/8），已有raw插件不重调，最终原文经正常read可读。FileService恢复3测试通过：丢失上传响应不重复上传、同长字节篡改拒绝、后页失败保留前页、禁止任意路径。6 suites/19相关单测通过（尚不含随后新增的execute测试）；server/client类型均待本次最后回读结果登记。

尚未运行：真实目标Host插件调用、真实FTD读取/首译块、真实页面浏览器验证、中断/来源变化线上H2。M正在核实既有FTD授权与在途。此增量不是H1真实业务完成声明。

## V2 官方插件执行增量（2026-09-13）

交付 `/private/tmp/wl-document-P-v2-plugin-20260913.patch`，相对已交 H0+original-step；不重复包含 M 的源索引/lease/schema/迁移。

- 新 provider `CanonicalTranslationV2PluginService` 依赖现有 workspace repo、DocumentOfficialPluginService、CanonicalTranslationV2Service，需 M 注册/导出。
- `prepareOriginal({tenantId, workItemId, original, artifact, assertAuthorized})`：original来自已授权且读回的loadPublished，artifact是M映射的同一已保存manifest描述；plan绑定DV/parseRun/精确artifact，repo仍检查真实workItem.packageId/ref/hash。没有frozen.2兼容伪造。本入口当前仍要求真实WorkItem；独立文档翻译的主体/调度由M接线，不能用假WorkItem绕开该CAS。
- `taskInput(workspace)` 返回既有translation_task.v2及 `documentProducer: 'OFFICIAL_PLUGIN'`，只能由Host封入已授权任务。
- `executeStep({fence, requestId, assertAuthorized})` 每步处理一个完整语义块或局部检查；先按已有GenerationRequest和块修订读回，已存块不重调模型。正文ai-translate、表格/列表按单元格或条目合并片段后textToJson，保留全部anchorIds。必要的同文档上下文、术语和纠正问题作为参考单独传入，不全篇再译。
- SAVE响应丢失会查询实际块；已提交的块继续局部检查，不错误标为未知生成。原有同attempt换租约时旧REGISTERED请求被明确supersede，保留其已保存块。实际不明的上游生成仍保持NEEDS_RECOVERY，不伪造远端取消或新成功。
- 真实producer写入原V2 provenance JSON；modelVersion/executionModel/skillVersion/usage未报告时null。仓储要求任务声明OFFICIAL_PLUGIN和匹配实例版本/action；旧MCP SAVE schema不接受伪造的插件actualExecution。语义检查也绑定确切修订和官方检查producer。
- DONE走现有V2的同一组装/回读/saveFinalArtifact逻辑，返回实际result；剩余限制明确返回REMAINING_LIMITATIONS。组件显示官方文档翻译与未知具体模型，不伪造工程Skill。

实际本机PG：21 tests 全通过（既有回归+新官方插件生成/语义检查/组装、SAVE响应丢失不重译、取消）。命令 `TRANSLATION_WORKSPACE_TEST_DATABASE_URL=postgres://liuxuan@127.0.0.1:55440/wiselink_translation_v2_test_p node --test test/node/translation-workspace-postgres.test.mjs`；日志 `/private/tmp/wl-P-v2-pg-20260913.log`。修复同测试fixture缺失initial_aily_session_id列，未修改业务策略。8 suites/36单元测试通过；server/client类型通过。PG插件返回为明确隔离替身，不是实际Host模型证据。

仍待：M真实来源与主体接线、获准FTD的Host实际运行、浏览器验证、来源纠正后仅相关块复用/重译、实际H2中断和变化。原文变化比较正在下一小边界，尚未纳入此V2补丁。上述未完事项不因本地绿色检查关闭。

## 独立 DocumentVersion 翻译增量（2026-09-13）

`prepareOriginal` 不传 workItemId 即为独立 DV，直接沿真实 `document-original://<DV>/<parseRun>` 清单映射准备工作区；没有占位 WI、frozen.2 或伪装 OpenClaw task。`TranslationWorkspaceScope/Fence` 的独立文档调用为 `{tenantId,workItemId:null,documentVersionId,workspaceId,...lease}`。taskInput 返回的 source 包含原文 originalBinding。使用 M 的 `document-translation-task-envelope.ts`、DOCUMENT_TRANSLATE / DOCUMENT_VERSION ActionAttempt、0047/0048；共享 schema/migrations 不在 P 补丁中。

每次 fenced 写入锁定同一 DM version 行（与 parse publish 串行），再核对最新 PUBLISHED parseRun、revision、不可变 PDF 来源、原文 manifest 精确 hash/bytes/mediaType，以及封存任务的完整 source。读取不要求仍为最新原文，历史译文可读。独立 DV 不开放已有 WI 工程师修订入口，中文候选纠错仍由现有插件请求/检查流程执行。

实际 PostgreSQL 测试使用隔离本地55440、构造文档/授权函数与插件返回。全22项通过，包括无WI翻译/检查/组装、保存响应丢失后复用已存块、service actor边界、跨DV隔离、旧token拒绝、原文更新后禁止保存但历史可读。运行的是 M 的0047/0048正式迁移内容；不声称正式上游授权或真实官方插件已运行。前后端类型检查通过。

原文增量识别现支持 LOCATOR_ONLY、CONTENT_CHANGED、IMPACT_UNRESOLVED：忽略解析生成的行/单元格身份变化，用完整文本/结构与覆盖情况比较；唯一内容的插入不会污染所有后续单元，重排/重复歧义不冒充定位改进。结果持久在原文bundle，stepResult返回受影响单元/SourceRef和previousParseRunId。原文store加载重新校验全部PDF分段工件。四项分类测试及四项执行/存储测试通过。跨解析版本的实际译文选择性复用尚待实现，不把变化报告冒充复用完成。

剩余：M接入真实调度后的H1完整原文与首批中文阅读；H2真实质量纠错、跨原文版本依赖复用与恢复；复杂跨页表格/图示覆盖仍需明确验证。

## 跨解析版本的译文复用（2026-09-13 后续增量）

`executeStep` 已接入 `reusePreviousOriginal`：仅首次进入尚无请求/译文的新独立文档工作区，比较上一解析工作区的已选且检查通过的候选。必须为同一租户/DV/源PDF，方法和质量检查版本一致；语义块文本、原文表格结构、所有实际提供的source/context依赖、上下文顺序、章节/条件/定义/引用均须精确映射，重复文本歧义不按猜测匹配。受影响或条件变化的范围继续原有生成/检查流程。

复用在原有fence短事务内写入同一V2 block表与工作区请求记录，purpose为明确的`REUSE`（只允许Host内部创建且持久状态为SAVED）；没有伪造新模型执行。provenance保留实际原作者/模型/插件/生成时间，并以reusedFrom关联旧workspace/blockRevision/generationRequest/parseRun及本次导入attempt/time。Reader显示“复用此前译文”；新原文的anchor/定位来自新source plan。复用失败事务回滚，成功后回执丢失不会重复复制。

验证：8项针对性单测覆盖定位变化、局部正文及邻近依赖、全局条件、重复歧义、源PDF/方法变化、旧检查器、同数字集合不同对象关系、源顺序变化。原22项真实PostgreSQL测试扩展到第二个解析版本/工作区/独立ActionAttempt，证明两块实际保存译文复用、生成调用计数不变、读取与最终artifact组装成功且重入不重复复制。使用构造数据/插件返回，仍非真实上游H1/H2运行。前后端类型检查通过。

## HTML原文表格与阅读页后续（2026-09-13）

确定性HTML表格已沿现有parse5依赖接入compose→original adapter→V2；保留caption、thead单元格、实体/换行、空白与N/A、rowSpan/colSpan、实际columnIndex。rowspan=0限定于原row group；不把无效跨度或嵌套表猜成可靠表。行宽不一致保留所有实际单元格并附STRUCTURE_UNCERTAIN。只有与同一PDF文本层唯一对齐才采用；冲突仍保留PDF读取结果。含合并单元格的派生Markdown使用转义后HTML，避免GFM表示丢失合并关系。原文Reader显示表题、真实合并与表头。

9项HTML/compose测试通过，覆盖结构→V2消费者、负号/件号/所有非空单元文本、不丢多余列、跨度边界及内容冲突；前后端类型检查通过。没有声称跨页逻辑续表或实际两页历史PDF已复测。

独立文档Reader已另以单文件补丁交M：精确parseRun读取、原文/中英对照切换、部分保存/失败状态、页级来源Dialog；本地浏览器以隔离PG构造译文验证切换及第2页来源。无execution时最多6次读取（25秒），随后提示手动刷新；active任务继续读取进度。共享API由M拥有，不包含在P补丁中。

## 插件输出失败分类（2026-09-13）

官方插件适配对已完成返回的schema/ID/scope错误抛出明确DocumentPluginOutputError，仅暴露稳定错误码，不把原始返回内容放进错误消息。V2执行器先读回实际保存状态；已有块或已SAVED请求仍按已存事实处理。尚未保存且属于该明确输出错误的请求登记OUTPUT_CONTRACT / KNOWN_FAILURE / FAILED；网络超时及其他结果未知仍为GENERATION_UNKNOWN / REGISTERED，下一步返回NEEDS_RECOVERY而不盲目重发。

6项插件单测与23项真实PostgreSQL测试通过，新增验证坏格式结果允许后续有界请求、未知超时第二次进入调用计数仍为1；已有保存响应丢失、取消、无WI、原文换版和复用路径保持通过。server类型检查通过。测试使用隔离55440与构造插件响应，仍不作为真实插件H1运行证据。

## PDF图片覆盖范围（2026-09-13）

PDF.js逐页读取增加实际image-paint operator检查，不渲染整页画布、不新增视觉服务。计数是绘制操作数（含组/重复操作），不冒充图片个数或图内理解。每页仍及时cleanup；读取/检测后重验活动授权。含图片、检测失败以及旧检查点未检查分别保留具体FIGURE_UNINTERPRETED说明；文字提取成功不因可选图片检测失败而丢失。覆盖限制区提供确切原件页预览入口，图片页不必依赖某个文字单元才能导航。

实际Node/PDF.js测试使用构造两页PDF：首图文页在无Markdown图片链接情况下识别出图片绘制，第二纯文字页计数0；件号A-12、负号-0.25及页面范围保留。compose额外测试检测失败仍保留文字与显式限制；HTML与执行测试通过，前后端types通过。这里只检测栅格图片绘制，矢量图理解、视觉转录、裁剪及真实Host内存峰值仍未验证，不能把该结果当H1真实厂商原件证据。

## 语义纠错、跨片段句子与跨页表验证（2026-09-13）

纠错调用现在把既有batch.previousCandidate与已记录correctionIssues一起实际送入正文/结构插件上下文；不附整个历史会话。真实PG新增注入的VALUE_OBJECT_BINDING语义报告：相同数字集合被交换给两个阀门时，旧候选完整保留，只纠正该块，再经检查后选用新修订；标题不重译。该测试证明Host消费检查结果和持久修订，不证明真实模型已能检出所有语义错误。

原官方插件PG场景进一步使用三个提取片段构成同一句话，证明一次完整正文调用、一段自然中文和三个来源anchors；不按译文长度剪回碎片。后续块超时场景现先保存可读标题，再验证unknown请求不盲目重发且标题仍可读。全部24项真实PG测试通过。

实际PDF.js构造跨页表测试通过：同一逻辑GFM表的4行8格完整保留，并映射两个真实物理页，仍只承诺页级定位。与此前图片检测合计2项Node/PDF.js测试通过。该样本无重复表头/复杂续表歧义，不能据此宣称所有跨页表已解决；真实历史两页问题PDF、真实SB与Host插件H1仍缺对应运行证据。server类型检查通过。

## 精确检索导航与插件调用观测（2026-09-13 后续增量）

- Reader 接收可选 query `parseRunId`、`sourceRef`，固定经正常读取接口读指定 run；刷新不会换最新，历史解析明确标记，显式“查看最新版本”才取消固定。指定版本读取失败不回退；来源不属于该 run 时明确提示，不替换；真实 location 定位段落并显示物理页。navigation identity 包含 DV/run/ref，保留 session epoch、Abort 和返回绑定检查，避免同 DV 导航晚响应覆盖。
- 每次刷新重新读取原文接口以执行正常 ACL。未添加旁路 API 或伪造历史数据。
- 官方插件调用记录 STARTED/RETURNED/ERROR、随机 invocationId、实例/action、elapsedMs、调用前后 RSS 和进程生命周期 maxRSS；不记录输入、输出、签名 URL、异常正文。RETURNED 只说明 SDK 返回，不代表校验/保存/业务成功；进程高水位不是本次文档峰值。
- 验证：插件适配 8 tests 通过，server/client TypeScript 通过；构造浏览器页面验证版本 1 历史链接、刷新保留、显式切到最新版本 2、指定版本 404 不回退、无效 sourceRef 明确提示。未触发真实原件预览网络，仍不作为 H1/H2 云端证据。
- 本批未改 `document-parsing-postgres.test.mjs`，保留 M 添加 0050 迁移列表差异。
