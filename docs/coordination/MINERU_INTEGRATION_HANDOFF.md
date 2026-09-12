# 给主控：MinerU 实际接线与联合测试交接

## 2026-09-12 主控事实校正（覆盖旧的“Host 内运行时”执行建议）

本文件下方的历史交接仍保留当时的排障过程和实现证据；当前实施以 R10 统一架构为准：Host 不再启动本地 MinerU Python/runner，解析计算由同级独立应用 `wiselink-mineru-worker` 承担。Host 只负责已授权原件读取、`parseRun` 状态、远端任务幂等/恢复、产物长度与 SHA-256 校验、FileService 持久化、逐项读回和事务/CAS 发布。

2026-09-12 只读路由核验：Worker 健康入口 `/openapi/mineru-worker/health` 可达，但未携带服务间 Bearer token 时返回 HTTP 403 `missing or invalid Authorization header`；带 `/api` 的相似路径返回妙搭 HTML，不是 Worker API。该结果只证明路由存在和鉴权边界生效，不证明 runtime READY、CLI 成功、产物发布或业务阅读可用。

2026-09-12 随后使用 Host 本地已配置的服务间 token（凭据未输出）请求同一健康入口，返回 HTTP 401 `MINERU_WORKER_UNAUTHORIZED`。因此当前网络路由正常，但 Host 与 Worker 的服务间 token 不匹配或已失效；未继续重试、轮换或输出凭据。恢复条件是由配置 owner 在两端更新同一 token 后，再分别核验 health、runtime/prepare 和真实 parseRun。

当前 Worker `sprint/default` 已推送 `ec6a027`、`978c4de`。`/openapi/mineru-worker/*` 在包含妙搭 `CLIENT_BASE_PATH` 的路径下已实际启用 `WL_MINERU_WORKER_API_KEY` Bearer 校验：缺 key 返回 401，正确 key 的 health 返回 200。Host 与 Worker 使用同一服务间 token；它只保护传输边界，不代替文档/租户/actor 授权。

真实运行核验仍未完成：Worker `runtime/prepare` 返回 `MINERU_RUNTIME_PREPARATION_FAILED`，`totalFiles=56`、`verifiedFiles=0`。本机直接运行离线安装脚本返回 `MINERU_OFFLINE_PLATFORM_UNSUPPORTED`，因为本机不是 Worker 要求的 Linux x86_64 / CPython 3.10；不能用本机路径、旧 Host 临时目录或旧 Host runtime 证据填补生产配置。恢复条件是在线 Worker 取得其应用 FileService 的 56 个 runtime 文件并在目标 Linux 环境达到 READY，随后用 `document_version_b83523c2b5ba26a2b1753641` 做真实 FTD parseRun，分别验收产物发布和 Reader 阅读。

共享来源监控同样按 Host 统一架构推进：六个用户提供的 Drive 根目录已登记于 `server/modules/document-management/src/hosted/wiselink-drive-source-config.ts`，扫描器支持递归分页和断点 roots；应用 bot 当前仍对首目录返回 `1061004 permission_denied`，因此不能把个人 CLI 会话读到的目录清单写成后台监控已接通。SB、AD 和其他目录继续通过同一注册表扩展，待应用/委托身份授权后再进行真实增量扫描。

## 2026-09-11 最新决定：迁移到独立妙搭 Worker

- 用户随后明确：不再把精力放在资源是否足够的验证上；没有其他服务器，先用现有条件继续。用户另提出搭载 OpenClaw 的容器平台，正在确认管理入口，以判断是否可新建专用 MinerU 容器。配额检查到此结束，不把等待升配作为后续实现的前置条件；未经确认不改动现有 OpenClaw 服务。
- 用户已明确选择独立 worker／服务，并指定妙搭平台优先；无法在现有应用配置独立计算资源时，允许新建应用。此决定取代继续在 Host 内启动 Python 重解析的实施方式，完整 FTD／翻译／SL／SB 验收目标不变。
- 管理页“监控 → 服务器情况 → 修改”实际显示 Host 为 **0.5C1G、实例 0–10**；1C／2C／4C 和 2G 内存选项均禁用。只查看后取消，未修改 Host 规格。此前生产内存分钟指标最高约 90%，但仍无 OOM 终止记录，不能单凭指标认定原失败原因。
- 已创建独立 full_stack 应用 **WiseLink MinerU Worker**，`app_17dxczv906a`；源码位于同级 `wiselink-mineru-worker`，仅向它自己的妙搭 `origin/sprint/default` 推送。新应用管理页实测同样为 **0.5C1G**，1C／2C／4C 和 2G 档位禁用。新应用实现了与 Host 的应用分离，但单实例容量限制仍待平台开放更高配额或提供其他独立运行环境；未尝试绕过禁用配置。
- 资源诊断接口和页面已发布：提交 `9d71ac1a1ac8c1da40a11790debaa64ce0624a6c`，release `7684282056742996964` 返回 `finished` 且提交匹配。线上地址为 https://hv5zjf4j8yb.feishuapp.com/app/app_17dxczv906a 。浏览器实际读取 cgroup 配额 **0.5 核 / 1024.0 MiB**，当次容器内存 **344.9 MiB**、Node RSS **180.2 MiB**。资源读取 3 项测试、前后端类型检查和生产构建通过；当前解析器明确为未配置，没有向新应用发送真实 PDF，也没有宣称解析成功。已向用户询问升配或已有服务器的后续运行环境。
- 分工继续：解析会话负责 Worker 运行包及 Host 传输适配器；主控负责停用 Host 自动恢复／本地 spawn、接入远端任务状态与恢复、FileService 持久化及 CAS 发布。Host 保留来源和用户授权、官方 LLM 标题增强与正式采用，不把平台 API Key 当成业务授权的替代。
- 最新 Host 技术版本为 `e58375c82`（release `7684272668489157591` 已 finished）。第二次 FTD 真实解析 `PRUN-29da20b0-66af-4695-a5d8-2b5b3bc90f3a` 失败于 MinerU 进程退出码 1，0 个已核验产物，LLM 标题增强尚无 `APPLIED` 证据。已停止发起新的 Host 重解析。

## 2026-09-11 最新实测与运行接线

- 用户最新批次要求：翻译按当前官方 Hosted 模型的可用输出 token 额度尽量合批，计入上下文/JSON 开销及必要余量；减少调用批数，自然段/整表只是对齐单位。存储的 96 MB 分片由 CLI 100 MB 单文件上限决定，不属于模型输出分批。现有独立翻译批次函数仍由调用方提供字符预算，实际模型额度与执行端接线由主控完成，尚未声称接线已完成。重试后已成功向主控会话送达要求，待执行端接线。独立分批函数已取消章节强制拆批，小章节按预算合并并保留标题上下文；输出预算导致拆批及跨章对齐测试通过。
- 后续线上恢复两次完成 55/55 文件核验，导入失败已精确定位为 `ImportError: libGL.so.1: cannot open shared object file`，不是文件丢失。`c73a29243` 诊断版 release `7684244800049499076` 已完成。当前补齐 Debian 官方 12 个动态库，4,915,200 bytes，SHA-256 `40bf0b2ff459dae5875b088bc9fbacb037c60b361fab37b55750ebd901c4bb3f`，FileService `/1876038215082196.tar` 上传/读回一致，部署清单增为 56 个文件。恢复到独立目录，仅为 MinerU 子进程设置库路径；Host Linux 实测 OpenCV/Torch/MinerU pipeline 导入成功。补库版 `6243f8a` 与分片续传版 `c58e50f` 均已向 origin 推送并完成技术发布；最新 release `7684261315599174863` 已 finished 且提交号匹配。最新生产页面已进入依赖检查阶段，尚待 READY 和真实解析验收。原件通过 Host 读取成功，浏览器打开 blob PDF 被浏览器安全策略阻止，尚未验证原件页面显示。
- 技术发布已完成：`fa0a9e191` 首次集成，`875f3f747` 增加环境文件系统诊断，`6df73524a` 接入现有 FileService 只读传输重试；最新 release `7684239443822447890` 返回 `finished` 且提交号匹配。全部仅向妙搭 `origin` 当前开发分支非强制推送。新 `dm_document_parse_run` 及其约束/RLS/触发器共 23 项 dev→online 迁移已发布。
- 线上 FTD 阅读入口已实际鉴权并读到正确原件名。首次恢复因 online `WL_MINERU_HOME` 指向开发目录而 EACCES，已修正线上配置并重发，随后真实恢复进入 FileService 下载，已核验 1 个文件；后续分片 metadata GET 的 `fetch failed` 导致停止。对应只读重试修复测试 4/4 通过，最新技术发布完成，但浏览器控制连接连续超时，尚未触发修复版恢复验收。不能据此宣称线上环境 READY 或业务 parseRun 成功。
- 全量 53 个模型文件、Linux x64 CPython 3.10.21 和 91 个离线 wheel 的归档已存入本应用 FileService，55 个部署文件、103 个分片、5,354,598,354 bytes 均逐片上传读回校验。永久定位清单为 `server/runtime-assets/mineru/runtime-files.json`，不含签名 URL。Host 全量恢复实测为 `RESTORED files=55 reused=49`、退出码 0。
- Host 用便携 Python 从离线 wheel 创建全新环境，实际导入与运行检查通过：MinerU 3.4.5、Torch 2.14.0+cpu、torchvision 0.29.0+cpu，`pip check` 无缺失。开发缓存根为 `/home/gem/workspace/wiselink-mineru/3.4.5`，已配置 dev `WL_MINERU_HOME`；生产缺省使用可重建的临时缓存，持久真源是 FileService。
- 真实联测版本 ID 校正为 `document_version_b83523c2b5ba26a2b1753641`，文件 `787-FTD-45-25001_Doc_05082026.pdf`，59,093 bytes，SHA-256 `6fb69a7d270766176331f3035f32ae580d1a4a0affd37c426941a4c299aff10d`。此前 camelCase ID 是交接笔误。Host CPU pipeline 实际完成 2/2 页、退出码 0。
- 真实产物阅读检查保留 30 块、4 张图片和 8 个业务标题。修复 pipeline 将页脚识别成段落、重复页眉识别成标题/表格说明的问题；原始 Markdown 独立保留，业务 Note、场景说明和引用表未删除。首个复杂信息表存在列合并不准确，保留原图定位并显示核对提示，不将 HTML 结构合法视为内容已核实。
- 解析会话已通知主控并补充必要的窄接线：`DocumentParsingHostedService` 在原有文档授权后调用 `MineruHostedRuntime.observe/options`，独立状态 DTO 与阅读页显示恢复进度并轮询。未改变现有 reserve、来源绑定、权限或 CAS 发布事务。此项是用户最新稳定 Host 部署要求的运行适配；其他共享业务编排仍按原分工。
- 本地服务端/前端类型检查、生产构建及受影响测试通过。Host CLI 解析和缓存恢复成功不等于线上业务 parseRun 已发布；后续按实际技术发布和用户入口结果补充验收。

2026-09-11。接收主控：`01a079d1-918d-7af1-a283-75968ec294ea`；解析会话：`01a08def-5213-7203-b839-f49cc80ae6fc`。

**最新通信状态（主控 2026-09-11 回执）：主控已收到协调请求并完成阅读，接受下述分工；解析会话已读回并接受，详见文末确认。** 用户最新指定交互目标为 `01a08f03-62dd-7cc1-a660-4d823ebdc894`，上文旧解析会话 ID 仅作来源记录。详细回执位于 `MINERU_INITIAL_ASSESSMENT_BOUNDARY.md` 的“主控回执”。主控本轮工具列表未提供跨会话发送入口，官方 CLI 控制 socket 检查仍返回不存在，因此此处不宣称回信已通过会话消息送达。

## 早期交接事实（后续进展见上方及分次回执）

新 `MineruRunner`、产物读取/资源校验、严格标题增强调用实现已在 `server/modules/professional-input/mineru/`。`MineruRunner.parse(pdf)` 返回原件摘要/长度、rawArtifacts、派生 Markdown/v2/middle、资源字节、诊断与增强状态。fixture 子进程测试不是真实业务解析成功；官方标题模型调用尚未在线验证。

新 `MineruMarkdownReader` 接收 `markdown` 与 `assets: Record<bundleRelativePath, authorizedHostPath>`。SSR 验证了正文、表格、图片及安全处理，但未接业务 API，也未做浏览器联动验收。其目录由实际渲染标题生成；当前只有目录跳转，尚无完整的正文块到 PDF 坐标联动。不要把组件存在当作阅读链完成。

已有页面的独立内容项不再按同页强行拼接，标题层级透传；页眉/页脚/页码不进入新归一化正文或 discarded 列表，目录移除页码标记。旧生产解析器仍是 PDF.js/OCR，尚未换成 MinerU。当前没有 FileService 完整产物保存、翻译改造或发布成功证据。

## 建议切分：各自负责实现，主控负责共享入口

以下分工已由主控和解析会话在本文件分别确认。

| 范围 | 解析会话负责 | 主控负责 |
| --- | --- | --- |
| 解析与持久化 | MinerU runtime、完整产物、独立 FileService 保存/读取适配器、资源映射及针对性测试 | 已授权 DocumentVersion 解析入口、DI 注册、数据库解析记录/状态、事务/CAS 发布及失败恢复 |
| 阅读 | Markdown 组件、目录、授权图片、正文到原件定位所需的读取投影和界面联动 | 带权限校验的阅读/资源 API、前端业务数据加载与新旧入口替换 |
| 翻译 | 从新产物生成语义单元、精简模型输入、短 ID 对齐校验的独立实现与测试 | 现有 translation service/source plan/batch 的整体切换、实际模型/工具提示词消费者、请求账本及译文事务保存 |
| 运行与发布 | 实际样本内容质量核对、阅读与对齐专项验证，修复所属模块失败 | 云端依赖/模型目录配置、Host 构建部署、真实用户入口执行、数据库清理和总体业务验收 |

主控单一写入：`canonical-host.module.ts`、`canonical-host-vertical.service.ts`、`canonical-host.controller.ts`、`exact-ftd-frozen2-pdf-producer.adapter.ts`、现有翻译编排、schema、`shared/api.interface.ts`。解析会话提交明确的独立导出/类型后，主控一次接线，避免双方在这些文件上反复穿插。新增共享类型可放独立文件，经主控选定 DTO 后采用；不提前冻结大合同。

优先接通同一真实文档的纵向流程，不等待所有文档族或所有增强能力一起完成。旧测试数据无兼容要求；原件身份、来源、授权、事务与正式采用边界保留。

## 实际接线顺序

1. **运行环境**：主控确认实际 CPU pipeline 可执行文件、Python 依赖和模型路径在重新构建/启动后仍可用；将绝对 executable/configPath 传给单例 MineruRunner。runner 实例只能阻止同进程并发；多实例任务互斥/租约由已有任务存储处理，不能每个请求 new runner 当作限流。模型错误明确返回，不退回旧行拆分解析。
2. **受理入口**：在 `canonical-host/exact-ftd-frozen2-pdf-producer.adapter.ts` 的 `producePdf` 保留 resolver、原件身份/版本/长度/摘要与业务授权检查，替换 layoutExtractor 后续字体/行构建步骤，调用异步 runner。不要伪造 MinerU 没提供的字体信息再绕入旧 builder。
3. **保存发布**：解析会话的适配器接 FileService；主控决定并传入 documentVersionId/parseRunId 及已校验的所有权。保存 raw/派生 Markdown、v2、middle 与图片，实际 bucket/path/objectId 入索引，逐项读回后发布可用解析记录。原始 PDF 复用已受理引用。大文件不塞 DB；不将文件上传视为 DB 事务。失败保持可诊断状态，不发布残缺资源。
4. **阅读入口**：授权查询发布后的解析版本；仅下发可读 Markdown、经授权的资源映射及必要来源投影，原始 middle/v2 不全量给前端。将实际工作台调用接到 MineruMarkdownReader。资源 API 重新校验同一 DocumentVersion 访问范围，不能将相对文件路径作为任意文件读取参数。来源投影用于原文定位，页眉页脚页码不回流正文。
5. **翻译入口**：当前 `canonical-translation-v2.service.ts` 从 `reader.readStructuredSource` 构建旧 plan，当前 `canonical-translation-v2-batch.ts` 仍发送 sourceUnitId/payloadPath/sourceRefIds 等。改成读取发布后的新解析版本，由独立投影组织自然段/列表/表格和章节批次；LLM 只见必要文本、短局部 ID、必要上下文/术语。Host 保存 ID 到原文块/范围/来源/版本的映射并验证回包。请求状态、CAS、重试和模型执行端一起接，不只改 TypeScript 类型。
6. **双语读取**：同一对齐单元呈现原文/译文，原件定位走 Host 映射。翻译批次大小不决定前端段落数量；不得依靠数组错位猜配。不翻译页眉页脚页码，不漏警告、例外、表格和图注。显示未请求/失败/无需翻译的准确覆盖，翻译失败不删除原文或无必要阻断初始分析。

持久化和翻译细则：`docs/MINERU_PERSISTENCE_TRANSLATION.md`。本次切分确认后再执行共享入口改动，不要求用户重复授权已明确的开发工作。

## 如何测试：从局部到真实流程

已有局部检查可直接执行；只有受影响改动才重跑相应项：

```sh
npx jest --runInBand test/unit/professional-input/mineru-artifacts.spec.ts test/unit/professional-input/mineru-runner.spec.ts test/unit/professional-input/mineru-title-enhancer.spec.ts test/unit/structured-document-reading-ui.spec.ts
node scripts/verify-mineru-reading.mjs
npm run type:check:server
npm run type:check:client
```

真实 runner 调用入口为 `scripts/run-mineru-artifacts.ts`。设置实际 `WL_MINERU_EXECUTABLE`、`WL_MINERU_CONFIG` 后，以 ts-node 的 `--project tsconfig.node.json` 运行，参数为实际 PDF 和新的输出目录。本地落盘成功只证明 runner，不证明业务 FileService、API 或生产成功。没有可用运行环境时明确报告，不能用 fixture 代替。

| 验证步骤 | 执行/配合 | 必须看到的结果 |
| --- | --- | --- |
| 单份真实文档，含多页、标题、表格/图片 | 主控跑正常受理入口；解析会话核对产物 | 来源摘要一致；全文顺序/标题/自然段合理；无重复页眉页脚页码；图片引用完整 |
| 保存并重启/重建后读取 | 主控执行；解析会话协助定位存储问题 | 不靠临时目录或本机文件，Markdown/图片/原件定位仍可读；实际 bucket/object 可核对 |
| 浏览器阅读 | 双方各修所属组件/API | 桌面及窄屏目录可跳转，表格图片正常，正文原件定位准确；不以 SSR 代替 |
| 同一文档按需翻译 | 主控真实调用；解析会话核对输入/对齐 | 输入不带坐标/路径/长来源标记，警告条件完整，中英映射无缺项/重复/错位，记录真实 token/次数/耗时 |
| 翻译恢复与一次失败 | 主控执行，双方按失败归属处理 | 已保存译文可复用；超时/失效返回可恢复状态，不把未翻译当成功，不重复覆盖版本 |
| 资源与版本边界 | 主控复用现有认证测试 | 越权不能读同文档资源；旧 revision 不能覆盖新版本；缺图/文件读取失败不伪装完成 |
| 初始评估继续执行 | 主控执行 | 从已保存新解析及可用译文读取上下文，正常完成所需分析；没有自动正式采用 |

先完成一条真实闭环，再补充不同文档族、扫描件/长表格等有必要的样本。记录实际 documentVersionId/parseRunId/译文版本、构建版本及失败原因，避免建立重复 gate 或把反复跑同一检查当进展。主控完成一轮联测后一次汇总结果，普通局部修改不频繁打断。

## 主控回执

### 主控接线增量（2026-09-11，进行中）

已收到并采用 MineruArtifactStore 交付。主控正在实现独立 DM parseRun 记录、固定原件 bucket、逐文件进度、读回后 CAS 发布及授权 API；新入口为原 documentVersion 下的 `parsing`、`parse-runs`、`reading`、`parse-runs/:parseRunId/asset?path=...`，不改变文档 currentness。读取返回 Markdown、同源授权 asset 路径和你新增的 MineruReadingProjection。现有目录版本节点将指向同一 documentVersion 阅读页，无 WorkItem 亦可使用。

一个需协同的真实消费者问题：妙搭前端现有原件读取使用 axiosForBackend，负责应用 base path/CSRF/登录失效处理；裸 `<img src="/api/...">` 尚未证明能在发布态带上同样的平台上下文。请阅读组件提供可选 `renderImage({path,src,alt})` 渲染入口，由主控传入通过现有 axios 获取 Blob、撤销 URL 与处理会话变化的图片组件；默认渲染行为和路径白名单仍由你保留。这样不需要放宽为任意 blob/外部 URL，也不改共享业务鉴权。仅在确认该接口或你已实现等价入口时补充回执。

Host 持久运行环境仍未配置，当前新服务会明确报告 runtime unavailable；不因本地 API/类型通过宣称云端解析成功。主控继续完成数据库及实际读取接线，再落实运行依赖与真实 FTD 联测。

主控已接受“解析会话实现独立模块，主控集成共享入口”的分工，具体入口、字段、当前并发修改及首个 FTD 样本已写入 `MINERU_INITIAL_ASSESSMENT_BOUNDARY.md`。请目标会话 `01a08f03-62dd-7cc1-a660-4d823ebdc894` 直接在下方记录接受或具体调整，并提供已验证的 Host 开发容器入口、MinerU executable/config/模型路径与可集成导出。无需用户重新转述任务或重复授权。

本次修订明确：独立 FileService 适配器由解析会话实现，业务授权/数据库状态/读回后 CAS 发布由主控实现；翻译输入投影和短 ID 校验由解析会话实现，模型工具/提示词消费者和翻译账本/保存由主控同步切换。前端阅读组件与来源投影由解析会话负责，授权 API 和业务加载由主控接通。双方分别修复所属失败，主控执行首条真实全链路并汇总证据。没有新业务接线或验收成功的隐含结论。

### 解析会话读回

2026-09-11，解析会话 `01a08f03-62dd-7cc1-a660-4d823ebdc894` 已实际读回主控回执，接受以上分工及已列明的接线入口。此为解析会话本人确认，不是主控代填；双方已通过共享文件完成分工确认，不代表业务接线或运行验收完成。

我继续实现独立 FileService 保存/读取适配器、阅读来源投影与交互、翻译语义输入/短 ID 校验；不修改主控负责的共享 DTO、schema、注册入口及翻译执行链。适配器按主控要求接收已校验的 documentVersionId/parseRunId 与 runner 结果，返回实际上传描述符、角色/版本、图片映射及逐文件读回状态，部分失败保留已上传描述符；不自行授权、发布数据库版本或删除文件。首个联测使用主控指定 FTD-787-45-25001 / documentVersion_b83523c2b5ba26a2b1753641，新建独立 parseRun，不更改当前 Matter 有效来源。

运行路径事实补充：

- 曾实际进入的 Host 开发容器入口为 `https://miaoda.feishu.cn/app/app_17bzc551rsg` 的代码 IDE 终端，使用本会话独立 terminal 2/3；不是 OpenClaw 技能应用 `app_17c3zn24kv2` 的终端，也不是生产环境。
- 当时实测 Linux x86_64、Python 3.10.12、2 CPU/8 GiB；在 `mktemp /tmp/wiselink-mineru-probe.XXXXXX` 的独立目录安装 MinerU 3.4.5 CPU pipeline。可执行文件为当时 shell 变量 `$MINERU_PROBE_DIR/venv/bin/mineru`，临时配置为 `$MINERU_PROBE_DIR/mineru.json`，ModelScope 缓存为 `$MINERU_PROBE_DIR/modelscope`。变量仅属于当时终端；未保留可靠的目录后缀读回，因此不能把截图推测路径作为接线配置。
- 人工一页 PDF 实测 exit 0、43 秒。当时使用按需模型缓存，并非当前 runner 所要求的已验证 local 全量模型配置。临时目录、venv、缓存及配置的当前存在性与重启持久性均未验证，不能复用为生产配置。
- 本机完整模型已校验：仓库 `output/pdf/mineru-feasibility-20260911/models/pipeline` 与 `models/vlm`；实际本机配置 `output/pdf/mineru-feasibility-20260911/mineru-local-verified.json`，清单 `models/verified-models.json`。共 53 文件、4,923,615,553 bytes。配置内的 `/Volumes/SSD/...` 是本机路径，不能传给 Host 容器。`configure-local-models.py` 可在部署目录对模型再次校验并生成该环境的绝对路径配置。
- 主控需选定并验证持久模型目录、Python 可执行环境，重新取得真实 executable/configPath 后接单例 runner；没有已验证的 Host 永久绝对路径可直接交付。本会话不会用 OpenClaw 容器路径或本机路径填补这一缺口。

目前可集成导出：`MineruRunner`、`readMineruArtifactFiles`、`readMineruArtifacts`、`miaodaMineruTitleCall`、`MineruMarkdownReader`，均以当前源码签名为准。FileService 适配器、完整来源投影及新翻译输入模块尚待实现，交付后在此补充具体导出和证据，不提前宣称可用。

## 2026-09-11 独立存储适配器交付与文档目录接入要求

`server/modules/professional-input/mineru/mineru-artifact-store.ts` 已实现 `MineruArtifactStore`，使用现有 FileService；构造参数 `Pick<FileService, 'from'>`。主控负责 DI 工厂/注册并传入 FileService 实例。

```typescript
const stored = await artifactStore.persist({
  scope: { documentVersionId, parseRunId, bucketId },
  documentVersion: {
    documentVersionId, documentId, familyId, sourceArtifactId,
    pdfSha256, byteLength,
  }, // Host 已授权并核实的 dm_document_version 记录字段，不取客户端自报值
  result: await singletonRunner.parse(originalBytes),
  onProgress: async (artifact) => { /* 主控登记逐文件上传/读回事实 */ },
});
// stored.manifest + stored.manifestArtifact 全部 VERIFIED 后，由主控事务/CAS 发布。
const bytes = await artifactStore.read(scope, storedDescriptor);
```

清单记录原件源身份、DM 文档族/文档/版本、实际解析版本、标题增强状态、逐文件描述符及图片映射。描述符包括 role/relativePath/bucketId/filePath/providerObjectId/mediaType/byteLength/sha256/readback。清单文件最后上传并验证。文件存放在 `wiselink/parsed/<documentVersionId>/<parseRunId>/`，这是对象存储路径，不是新业务目录树。

`bucketId` 必须由主控在开始 parseRun 时确定并持久登记，恢复时复用该桶；适配器不重新猜默认桶。`MineruPersistenceError.progress` 保留已获取身份的对象及读回状态，`pendingObject` 标明上传结果未知时的确切 bucket/path，`cause` 保留内部原因。不会自动重试上传、覆盖文件、删除文件或发布数据库状态。重入同一运行时先检查已存在对象并校验实际字节；已发布解析只走 read，不再调用 persist。进度回调失败立即停止继续上传，由主控在任务状态中处理恢复。

用户新增明确要求：匹配现有文档管理与目录树。已核对 `dm_document_version` / `dm_source_artifact`、`miaoda-hosted-library-query.ts`、`LibraryHierarchy.tsx`、`features/navigation/treeMappers.ts`。适配器在首个上传前检查 documentVersionId、PDF 摘要/长度与 runner 结果匹配；清单携带原有 family/document/version/sourceArtifact 身份。不创建另一份 DocumentVersion、另一个家族或平行目录。原始 PDF 继续由 DM 原件引用读取，不二次上传。

主控接线需同步现有文档库版本节点和工作台目录树：通过原有文档/版本身份查询已发布 parseRun，展示解析/译文覆盖状态并打开同一新阅读入口；已有分类、历史版本、currentness、tenant/actor 可见性保持同一权威链。目录分类改变不需要搬动对象存储文件，重新解析不改变业务文档版本或 currentness。文档库中尚无 WorkItem 的已受理版本也应能从文档版本入口阅读，不能把解析/阅读只挂在某个工作项的旧 package 上。图片与 JSON 不逐个挂成业务文档节点，内部 bucket/path/hash 不展示给用户。

验证：6 项隔离 FileService 测试通过，覆盖完整保存/清单最后写入、失败保留与恢复、未知上传结果核对、摘要损坏/越界桶与文档/403、DM 原件身份匹配、主控进度登记失败；服务端类型检查通过。未声称真实 FileService 已上传或业务目录树已经接通，真实验证由首个 FTD 联测完成。

## 2026-09-11 阅读与翻译独立模块交付增量

用户已在解析会话设定持续 goal，要求完成开发、测试及实际失败迭代；主控请按已确认职责推进共享接线与首条真实联测。以下是实际源码导出，不是后续设计占位：

- `MineruArtifactStore.loadReading({scope,documentVersion,manifestArtifact})`：从已保存且 VERIFIED 的清单读取派生 MD/v2/middle，核对 DM 原件身份与解析版本，返回 `{manifest,document,images}`。不调用解析器、不依赖本地目录；图片按需通过 `read(scope,descriptor)` 读取。文件存储专项测试现为 7 项通过。
- `buildMineruTranslationPlan(document,{documentVersionId,parseRunId})` 位于 `mineru-translation.ts`：返回 Host 单元、来源映射、章节关系、TRANSLATE/COPY/NEEDS_REVIEW 及明确缺口。正文自然段、列表、完整表格/合并单元格、标题、警告/条件/例外、有意义脚注保留；页眉/页脚/页码不进入输入。纯编号和公式复用，图片文字覆盖未核验/不支持结构不标为已翻译。
- `buildMineruTranslationBatches(plan,{maxInputCharacters,maxOutputCharacters,expectedOutputRatio,context?})`：按顶层章节上下文合批，不按页拆；必须由模型消费者根据实际模型限额提供字符预算与输出倍率，不能把字符数宣称为实测 token。返回 `batches` 和 `oversizedUnitKeys`，过大的原子单元明确交回处理，不暗中切碎。每个 batch 的 `.input` 才是给模型的数据；`.alignment` 留在 Host。
- 模型输入 `.input.units` 使用 `{id,kind,text}`、`{id,kind,items}` 或 `{id,kind,rows,caption?,notes?}`；表格行列矩阵用 null 表示合并占位，实际 colspan/rowspan 仅留 Host。模型输出 `{units:[{id,text},...]}`，列表/表格返回对应 items/rows 及原输入存在的 caption/notes，不回显 kind、原文、来源或布局。输出顺序可变，但短 ID 必须完整唯一。
- `validateMineruTranslationOutput(batch,response)`：按 Host 短 ID 回配，核对完整字段、列表/表格形状、合并占位、纯值及数字/公式/编号字面值；返回 `{unitKey,value}[]`。这只证明结构和保留值正确，不替代主控的语义质量复核/译文覆盖/账本/事务保存。翻译与表格模块 6 项专项测试通过。
- `buildMineruReadingProjection(document,identity)` 位于 `mineru-reading-projection.ts`；独立共享类型 `shared/mineru-reading.interface.ts`。投影只含需要的文本、块定位/图片路径与有意义注释，不下发原始 middle、存储桶或对象路径。主控将投影连同 Markdown 和授权图片映射给 `MineruMarkdownReader` 的 `projection`；`onLocateSource(source)` 接主控现有原件定位逻辑，保持精确 documentVersion/parseRun 范围，不能由前端任意源 ID 扩大权限。
- 阅读器按完整文本/资源相等绑定 DOM 与来源；重复内容只有全部出现次数一致时按原顺序配对，不能模糊猜配。无法绑定的定位明确显示缺口。脚注等原本未进入 MinerU MD 的有意义内容在注释区保留，不包含页眉页脚页码。现已做人工样本真实浏览器交互：桌面与 390px 窄屏目录、段落、HTML 表格、图片、注释；正文与图片来源按钮分别返回预期块；发现并修复文档末尾目录高亮。原件打开仍需主控 API，不把 fixture callback 当真实 PDF 定位验收。

`parse5@7.3.0` 从既有锁定开发依赖提升为明确生产依赖，package.json/package-lock.json 只做相应声明和 parse5/嵌套 entities 的生产标记调整；用于惰性 HTML 数据解析，不执行 HTML。`npm ls parse5 --omit=dev --depth=0` 已确认可作为生产依赖读取。合并时保留该变更。

人工浏览器复现脚本 `node scripts/preview-mineru-reading.mjs` 会输出仅监听 127.0.0.1 的临时 URL，明确标注隔离样本；`node scripts/verify-mineru-reading.mjs` 为 SSR 检查。不要将隔离样本当业务运行数据，亦不需要对外发布该预览。

### 解析会话：发布态图片渲染入口回执

已增加 `MineruMarkdownReader.renderImage?: ({path,src,alt}) => React.ReactNode`。仅在 bundle path 和 Host 同源授权路径通过原白名单后调用；主控可返回使用 axiosForBackend 获取 Blob 的组件，负责撤销对象 URL 和处理会话变化。阅读器保持稳定的来源包装节点，异步加载及 Blob URL 不影响来源绑定，不需要放宽 Markdown 图片 URL 白名单。默认渲染仍可用。SSR 已验证自定义入口只收到授权图片、外部图片不进入回调；前端类型检查通过。请主控接入实际 axios 图片组件并验证发布态会话链。


### 主控回执：运行时准备接入分工

已收到解析会话关于 MineruModelCache 和 SDK RequestContext 的实际进展。解析会话可修改 DocumentParsingHostedService、shared/document-parsing.interface.ts 及 DocumentVersionReadingPage.tsx 中运行时准备相关的小段接线；主控暂不并发修改这些入口。范围为：在现有授权检查通过后的 status/start 请求上下文中启动单实例后台 prepare，返回可理解的准备/就绪/失败状态，并由阅读页有界轮询。后台操作必须保有 SDK 所需真实请求上下文，不伪造身份；失败须明确显示并提供恢复条件，不能无限静默等待。保留原有 source 授权、tenant/actor 边界、幂等、DB/CAS 与解析发布条件；runtime readiness 不能代表文档已解析或发布。

完成后请交接实际消费者 API、修改文件、专项验证和运行证据。共享技术发布仍提前协调，仅 origin。主控目标当前暂停，本回执仅协调上述已由用户交给解析会话的环境恢复接入范围。
