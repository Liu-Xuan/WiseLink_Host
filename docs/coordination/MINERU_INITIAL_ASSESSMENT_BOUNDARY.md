# MinerU 与初始评估工作边界

日期：2026-09-11。

主控会话：`01a079d1-918d-7af1-a283-75968ec294ea`。
解析/阅读会话：`01a08def-5213-7203-b839-f49cc80ae6fc`。

用户最新要求：开发阶段，全部为测试数据；不要求兼容旧代码/旧数据，允许清理旧数据；初始评估保持简洁、高效、稳定；两会话协调边界，避免频繁打断。

## 建议分工

解析/阅读会话负责 MinerU 3.4.5 运行、完整产物保存、Markdown/版面 JSON/图片消费、来源定位、标题增强和解析/阅读专项测试。新的独立实现集中于 `server/modules/professional-input/mineru/`、对应阅读组件和专项测试。交付包含原件绑定、正文、按需图表资源、来源位置、解析状态和实际版本。

主控负责初始评估的业务入口、提示词/模型运行、上下文选取和结果保存，以及整体数据库清理与 Host 集成发布。评估输入以可读正文和准确来源为主，图表按需获取；不为延续旧测试而保留复杂中间层。

共享入口由主控协调：`shared/api.interface.ts`、`canonical-host-vertical.service.ts`、`canonical-host.controller.ts`、`canonical-host.module.ts`、数据库 schema、`server/app.module.ts`、当前范围/执行计划文档。解析会话在接入前列出拟改字段和消费者，再由单一 owner 集成；不把这当作普通独立模块开发的阻断。

## 当前变更及证据

- 本地完整模型：53 文件、4,923,615,553 bytes，固定清单校验通过；路径配置脚本实测通过。云端模型落盘与正式持久性未验证。
- Host 开发容器已运行 MinerU 3.4.5 CPU pipeline，人工一页 PDF 成功；2 CPU/8 GiB。生产未验证。
- `server/modules/professional-input/mineru/mineru-artifacts.ts`：按 3.4.5 读取 Markdown、按页嵌套的 v2、middle、资源引用；4 项隔离测试通过。当前消费者为离线检查脚本 `scripts/inspect-mineru-artifacts.ts`，尚未接入业务解析入口。
- `server/capabilities/wl-mineru-title-levels.json` 与 package.json 新增的 `@official-plugins/ai-text-to-json@1.0.26`：配置/schema 通过，真实调用尚未执行。
- 此前在 `shared/api.interface.ts`、`unified-reader/frozen2-candidate-reader.service.ts`、`canonical-structured-content-projection.ts`、`StructuredDocumentArticle.tsx` 和其 CSS 中加入层级与段落边界传递，6 项测试通过。用户现要求重写，这些可撤除/替换，不要求主控保留。
- 更早的字体/合段草稿已撤除：两个既有 builder 恢复，本会话新增的 `pdf-reading-structure.ts` 及测试已删除，不需要主控处理。
- `.agents/skills`、AGENTS.md、既有 R10 文档等其他未提交修改不属于本会话，不覆盖。

## 低频沟通

仅在首次分工、共享接口变化、实际阻塞、可集成交付时同步。普通下载进度、每项测试和同一阻塞不反复发送。主控可直接在本文件补充分工意见与接入要求；无需为每次独立改动互相唤醒。

当前通信状态（2026-09-11 更新）：跨线程工具已恢复，已成功向主控发送完整协调请求；等待主控确认具体 owner、接口和真实运行通道。此前仅共享文件、无法发信的记录已过时。成功送达不等于主控已确认。

## 2026-09-11 阅读交付增量

用户补充要求参考 WiseLink 0.11 工作台，重点改善目录和正文分段。已核对旧工作台路由及 `DocumentContentViewer.tsx` 的 full_md 优先、标题章节、原件定位方式。

- 现有消费者 `StructuredDocumentArticle` 不再按同页拼接独立正文项；`StructuredContentBrowser` 目录采用真实标题层级缩进、来源页码及聚焦跳转。这部分已接入现有页面，但旧解析产物若本身按行分段，仍须重新解析才能修复来源结构。
- 新增 `MineruMarkdownReader.tsx` 与样式，输入 `markdown` 和 `assets`（bundle 图片路径映射到经 Host 授权的同源资源路径）。从实际渲染标题生成完整目录，支持正文定位与当前章节标识；保留 Markdown 自然段、HTML 表格、图片、列表、公式和字面代码；移动端目录折叠。HTML 经 sanitizer，图片只使用显式资源映射。
- 新阅读器尚未接业务 API。主控需保存 runner 返回的 Markdown/v2/middle/图片与原件绑定，并通过实际读取权限链提供 Markdown 和图片路径映射；用新组件替换旧内容项分页浏览。不要将 `middle` 全量传给前端，不需沿用旧字体行拆分。
- `MineruRunner` 已串起外部 CPU pipeline → 完整产物读取 → 可选严格标题增强 → 原件 SHA256/长度绑定。`scripts/run-mineru-artifacts.ts` 为实际本地调用入口；Host 业务 producer 的异步接入仍由主控负责。
- 验证：4 组 16 项测试通过（包含 fixture 子进程、超时/忙碌释放、标题增强一致性、正文边界）；前后端类型检查通过。`node scripts/verify-mineru-reading.mjs` 实测 Markdown 标题、两个独立段落、HTML 表格、授权图片和脚本/外部图片阻止。发现并修复 Streamdown 默认 harden 提前拦截相对图片的问题，保留 HTML sanitizer 与显式图片映射。实际浏览器交互、真实业务 PDF 全链路、妙搭标题模型在线调用和生产发布未完成。

没有新增跨线程通信能力，仍未得到主控回执。本次仅更新这一共享交付点，不触碰主控 schema、清库或发布入口。

## 2026-09-11 用户追加：持久化与翻译

详见 `docs/MINERU_PERSISTENCE_TRANSLATION.md`。新增交付 `rawArtifacts` 保留未经标题增强改写的原始结果，本地 runner 脚本分别保存原始和派生产物、共享图片。要求 FileService 保存实际文件，数据库保存解析版本/状态与实际 bucket/object 索引，完成读回后事务发布；临时目录和本地 output 不作为业务保存位置。

主控翻译接线需按新解析语义组织大批次，LLM 只收必要文本、短局部 ID 和必要上下文；页码/坐标/路径/来源及版本映射留在 Host。保留有意义的警告、例外、表格和图注，不把“少翻译”变成遗漏正文。自然段对齐与调用批次分开，不按页/行切碎。该要求已形成具体接入方案，尚未改主控翻译共享入口或数据库，未收到双方确认。

最新覆盖要求：页眉/页脚/页码只可用于内部元信息判断，不能进入阅读/翻译产物。归一化模块已从正文及 discarded 列表排除三类块；现有目录移除页码标记。原始解析档案仅供内部元信息/解析诊断，不作为翻译或前端数据源。保留有意义脚注/警告/表格注释，遵守 `docs/MINERU_PERSISTENCE_TRANSLATION.md` 最新补充。

2026-09-11 用户再次要求实际双方沟通、工作切分和运行测试。当前建议切分与逐步接线/验证已集中到 `docs/coordination/MINERU_INTEGRATION_HANDOFF.md`；此文件明确新增解析会话承担独立存储适配器和翻译输入投影实现，主控承担共享业务注册/事务与模型执行端切换，仍待主控一次确认。再次检查无发送工具、CLI 控制 socket 不存在；不能宣称已送达。

## 2026-09-11 已发送主控的具体分工提议（待回执）

解析会话：MinerU 运行与产物整理、独立 FileService 产物保存/读取适配器、Markdown 阅读组件、新翻译纯文本选择/语义批次/短 ID 校验模块，以及专项测试。

主控：DocumentVersion/parseRun 的数据库发布和事务/CAS、共享 schema/DTO/Module/Controller 注册、实际业务 producer 替换、翻译调度/持久化接线、Host/Skill 部署及集成运行。共享入口由主控单一写入，最终分工以回执为准。

首个垂直链：真实 PDF 上传 → MinerU 一次解析 → FileService 完整读回 → 发布解析版本 → Markdown/授权图片/原件定位。随后接一个章节的精简翻译及准确中英映射，验证重启后恢复；再扩大到 FTD/SL/SB 多页、表格和扫描样本。

已请主控明确：实际 producer/解析发布/读取 DTO/翻译执行入口及字段、正在并发修改的文件、开发容器与浏览器运行通道、首个真实样本和集成运行 owner。只在首次分工、接口变更、阻塞或可集成交付时沟通。

## 主控回执

2026-09-11 主控已阅读本文件、持久化/翻译要求及 INTEGRATION_HANDOFF，并接受最新分工：解析会话继续独立 runner、FileService 保存/读取适配器、Markdown 阅读/来源投影、翻译语义单元/批次/短 ID 校验及专项测试；主控负责共享业务注册、数据库记录与事务/CAS 发布、授权读取 API、翻译调度/模型消费者/保存，以及集成部署和真实验收。

已核对实际入口：`ExactFtdFrozen2PdfProducerAdapter.producePdf` 仍负责 resolver 与实际 FileService 原件读取；`CanonicalHostVerticalService` 调用 producer 并执行持久化读回；`Frozen2CandidateReaderService.readStructuredSource` 是现有读取入口；`CanonicalTranslationV2Service.prepare/execute/loadFinalForCommit` 与 `canonical-translation-v2-batch.ts` 是翻译接线处。主控单一写入这些共享入口及 Module/Controller/schema/shared DTO；独立模块可继续开发，不等待共享入口完成。

适配器请返回实际上传描述符（bucketId/filePath/providerObjectId、字节长度/摘要）、原始与派生产物的角色和版本、相对图片路径映射及逐文件读回结果。输入采用 Host 已校验的 documentVersionId/parseRunId 与 runner 结果；不自建业务授权、不自行发布数据库版本。中途失败保留已上传描述符供状态登记，不盲删文件。翻译独立模块返回 Host 对齐映射和仅含必要文本/短局部 ID 的模型输入，页眉/页脚/页码不进入正文或翻译。

主控当前 c84 修改已经提交发布，未改解析会话的未提交文件；现有 shared/api.interface.ts 和阅读投影增量保留，后续共享接口接线由主控整合。首个样本选择现有 FTD-787-45-25001 原件（documentVersion_b83523c2b5ba26a2b1753641），沿用原件身份创建独立 parseRun；不在当前 Matter 恢复过程中改写其有效来源版本。先完成单份真实 PDF 的持久化/阅读闭环，再接一个章节翻译和重启恢复。

运行通道：主控可使用妙搭 Host 开发/技术发布和已打开浏览器；OpenClaw 技能运行应用与 Host 开发容器是两个环境，不能混用路径。请解析会话在本文件补充其已验证的 Host 容器入口、MinerU executable/config/模型绝对路径及重启持久性事实；主控负责最终配置与正常业务入口联测。当前尚无新解析业务接线或成功验收结论。后续仅接口变化、实际阻塞或可集成交付时同步。

### 解析会话已读回确认

2026-09-11，解析会话 `01a08f03-62dd-7cc1-a660-4d823ebdc894` 已读回并接受本文件“主控回执”，双方通过共享文件完成分工确认。具体运行环境事实及现有导出已补充到 `MINERU_INTEGRATION_HANDOFF.md` 文末：先前 Host 成功仅为临时开发环境单页探针，未提供可直接接线的持久 executable/config/模型路径；本机模型路径不能用作 Host 路径。独立模块继续实现，主控保持共享入口单一 owner。此确认不代表实现、接线或真实验收已经完成。

存储适配器已交付 `MineruArtifactStore.persist/read`（详见 INTEGRATION_HANDOFF 文末），6 项隔离测试及服务端类型检查通过。用户追加“匹配当前文档管理及目录树”：输入绑定真实 DM 文档版本/原件身份，输出保留 family/document/version/sourceArtifact；主控接现有文档库版本节点和工作台目录树的状态/阅读入口，不建立平行文档目录或重复原件。尚无 WorkItem 的受理版本也应可按文档版本阅读。真实 FileService/目录链尚待集成。
