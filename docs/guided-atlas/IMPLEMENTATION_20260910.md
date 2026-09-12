# Guided Atlas 1.0 本地实现与交接

2026-09-10。以用户本轮“从一份文件，看清一件事；从每项认识，了解机队技术全貌”说明为准。设计包是设计输入，不是生产审计或执行授权。包内 tours.json 仍是旧路线，因此本实现重新编写共享讲解内容；不执行原型 prepare()，不导入原型 app.js/tour.js。

## 分工

本会话负责 `client/src/features/atlas/`、图谱只读投影、独立示例、导览、分类原值和相关测试。Jest 配置仅补齐客户端 JSON 模块读取，以便新测试可走默认测试命令。共享入口只在 `client/src/components/Layout.tsx` 添加一个懒加载 AtlasLauncher 按钮。现有 Reader、Review、WorkspaceHomePage 不修改。

项目主控：`01a079d1-918d-7af1-a283-75968ec294ea`，继续拥有 Host/模型运行、共享接口、集成及发布。前端主控：`01a06014-5282-7f90-91bf-12759224d211`，继续拥有阅读页、资料库和事项页面。本轮用户新增“资料库没有达到设计文档和静态页面”反馈，已将实际设计核对、事项优先布局、背景/措施/前提/认识/进展、三类状态区分和真实数据展示要求发送给前端主控，待其独立交付；前端主控已交付资料库三列速览补丁，由项目主控负责整合与发布；本目录不重复应用或代替其真实验收。

## U0 / U1 已核对与接线

| 能力 | 当前源码与消费者 | 本轮处理 |
| --- | --- | --- |
| 文档族、DocumentVersion | `getCanonicalLibraryDocuments`，GET `/api/canonical-host/library/documents`，授权目录分页 | 按实际 familyId / documentVersionId 画族与版本，20 族一页；不按标题或同号创建关系 |
| 同版已保存结果 | `getCanonicalLibraryQuicklook`，GET `/api/canonical-host/work-items/:id/quicklook` | 使用现有版本/结果身份核对；复用 `SavedAssessmentReading`；无读取时模型生成 |
| 显式引用、SourceRef | `getRelatedContextPreview`，GET `/api/canonical-host/work-items/:id/related-context/explicit-preview` | 核对 workItemRef、revision、primaryDocumentVersionRef；只有 Host RESOLVED_EXACT + AUTHORIZED 才显示目标阅读入口；保留逐次来源出现位置 |
| 原文定位 | 现有 `/work-items/:id/documents?node=reader&sourceRef=...&documentVersionId=...` | 跳转确切版本与原文；未取得目标正文时仅展示引用方位置，不承诺正文已读 |
| Matter 与工作意见 | 现有 `getEngineeringMatterWorkspace` | 展示已登记成员关系与当前保存工作结果，沿用授权、输入修订和结果身份检查 |
| Review | 现有事项/工作台路由与持久 ReviewConversation | 本轮不修改、不启动；示例复核只是预置快照 |
| 反向引用、版本附件、真实跨事项/技术域聚合 | 当前没有对应完整只读 API | 界面明确未接线；不扫全库、不静默回退示例、不创建新图数据库 |

Cytoscape 已存在于当前 lockfile/node_modules 3.34.0，但不是 package.json 直接依赖。本轮显式登记该实际版本；不是按包内 3.33.1 假称当前版本。只用原生样式、布局、选择、事件、相机和 PNG 导出。原型预计算全景和文档关系网布局作为独立示例的 preset 坐标使用。

## U2 / U3 分类与示例

`data/ata-catalog.json` 原样复制设计包；包括章目录、标准源表、展开工作表，身份包含来源命名空间、附件快照日期、文件、表和原行。日期表示本包快照，不宣称标准的正式修订版。`sources/` 保存两份原始工作簿，未修改中文原值。

iSpec 展开表 45-45 的两处原行分别是 `ATA_4位展开!A200:R200` 和 `A205:R205`，对应 CMS/Airframe Systems 与 Central Maintenance System；不互相覆盖。34-60、章 42 跨来源差异保留，iSpec 无独立 34-61。源表与展开表中相同代码继续是不同来源记录，代码筛选不推导实际关系。分类页显示“附件分类原值”，不把分类附件误标成机队事实或构造事实。

独立示例完整保留设计包 graph nodes/edges、来源文字、图标和全景布局。真实空间与示例空间由用户明确切换；Host 请求失败保留失败状态。效果只有默认、最高、兼容，不切换资料空间。导览依照用户许可进入示例，不注入真实工作状态、不写业务。

## U4 导览与恢复

讲解单一来源 `guide-content.ts`，同时供使用介绍、逐幕列表和字幕使用：13 幕 / 243 秒、16 幕 / 297 秒、12 幕 / 205 秒。时间仅为字幕预设停留。

`GuideController` 持有 active / playing / currentScene / epoch / remaining / preEntrySnapshot；适配器只开放 capture、open、ready、restore、speak、stop。页面挂载、读取与 layoutstop 就绪后计时。切幕、暂停、用户输入、后台、接管与卸载取消旧计时和语音，epoch 忽略迟到准备完成。缺目标停止并显示原因；语音用户自选，中文语音可用性与失败单独处理。不会点击保存/采用或启动 Agent。

面板使用既有 Dialog 和 React，打开时底层 Reader/资料库保持挂载。退出演示恢复空间、视图、确切焦点、选择、筛选、浅深主题、效果、侧栏/详情面板、相机、主体/检查器滚动、来源面板与未发送示例笔记；底层真实草稿不被接触。在此探索保留当前位置并停止计时。

## 验证与限制

- `npm run type:check:client`、定向 ESLint 与 `npm run build:client` 通过。构建仍有仓库既存的外围 worktree tsconfig 扫描、模块类型和 chunk-size 提示。图谱代码及样例只在打开面板后加载，不进入首页同步包。
- `npx jest --runInBand test/unit/guided-atlas-controller.spec.ts test/unit/guided-atlas-data.spec.ts`：24 项定向测试，覆盖确切引用、未授权目标、版本漂移、逐次来源、分类原行、路线时间、异步迟到、暂停、丢失目标、恢复、接管和恢复失败。
- `test/atlas/browser.cjs` 使用真正 React/Cytoscape/Router/Dialog，但业务响应明确由隔离 fixture 拦截。三路线 41 幕逐幕就绪；检查快速跳转、暂停、后台、缺目标、退出恢复、主题恢复、快捷键、重开、范围待核筛选、兼容模式、390 px 页面与底层草稿，业务写入为零。完整结果与截图放在 `/private/tmp/wiselink-atlas/`，最终四张截图及两份验证结果已归档至 `visual-verification/`。
- 本地标准开发入口因后端未启动返回 Bad Gateway。未伪造登录访问生产；真实 Host 材料链、授权状态和浏览器原文跳转尚待主控在已有获准环境完成验收。隔离 fixture 和截图不是这条真实链的验收证据。
- 本轮未推送、部署、写入真实业务记录或正式采用。资料库页面改版属于前端主控的独立交付。

复验：先在空闲端口启动现有 `dev:client`，以 `ATLAS_TEST_URL` 指向该入口，并通过 `PLAYWRIGHT_MODULE` 指定已安装的 Playwright 后运行 `node test/atlas/browser.cjs`。harness 仅存在于 test/atlas，无生产路由。

## 本次 Goal 补齐的视觉与探索能力

本地入口仍是既有页头“打开图谱与自动演示”。全窗工作台采用左侧导航轨、主视角、观察范围侧栏、画布标题、可收起详情与底部播放器。浅色使用纸白／暖灰，深色使用石墨；主题继承现有 ThemeProvider。默认、最高、兼容保留为视觉选项，兼容关闭原生渐变，减少动态效果偏好禁用相机动画。普通阅读内容保持实底，不给正文铺透明材质。

| 页面 / 交互 | 本地交付 |
| --- | --- |
| 工程文档 | 原生中心关系图、向外／反向观察、历史／附属／派生阅读表示／缺失资料开关、搜索等价对象、确切版本重新设中心、来源位置 |
| 文档族与关系网 | 原始成员版本和附件；文档族连线只作显示聚合，每条可展开 memberEdgeRefs 返回原始版本对，不创造 DocumentVersion |
| 技术领域 | FMC／显示可切换；领域、系列／软件标准、当前中心分别保存；待核范围保留／排除、展开资料、发现线索、初始／复核后预置快照 |
| 工程事项与依据 | 支持任意样例事项；保留共享资料；依据页同时呈现 SUPPORTS / LIMITS 等支持与限制，复核后图中认识与复核后阅读共用同一预置文本 |
| 全景 | 设计包原生预计算位置；主事项标签、类型图标与形状、双环事项、待核虚线、邻域局部对比；全部标签可显式开启 |
| 分类骨架 | 按来源命名空间、章节、原值检索；来源清单、原生分类图、同码对照；原行身份与完整定位可读；相同记录的重复列表表示仅显示一次，异行同号仍分别保留 |
| 框架之外的锚点 | 分类、技术对象、功能问题、业务依据的区别；不推导构型或同因关系 |
| 初评／复核后综合／速览 | 复用产品 AssessmentReadingBrief；初始与复核后是明确标记的预置快照，依据详情从该同一结果读取，不发 Host 或模型请求 |
| 交互复核 | 复用产品 ReviewConversationTurn 的 readOnly 分支，标明预置对话、未执行；本地探索笔记与真实表单隔离 |
| 工作线 | 原生 Cytoscape 十二阶段流程图，可点选和前后回放；解释图示事件，不模拟真实运行进度 |
| 图谱工具 | 原生全屏、缩放、全图适配、邻域聚焦、同心／环形／层级／力导向／网格布局、PNG 导出、等价对象／关系列表与图例 |
| 播放器 | 41 幕、章节切换、上一幕／下一幕、暂停／继续、0.75／1／1.5／2 倍速、可选中文语音、字幕进度、在此探索、Esc 恢复；来源幕等待实际来源面板 |
| 状态恢复 | 进入前快照包含视图、范围与中心、分类条件、主题、效果、侧栏、选择、来源、相机、滚动和笔记；按当前会话＋底层路由保留重开位置，底层页面持续挂载 |

## 本地可验收范围与剩余集成边界

这里交付的是已接入现有 React 应用的本地工作台与示例流程，不是将静态原型嵌入 iframe，也不声称与每张原型截图逐像素相同。原型组织方式已按产品的主题、阅读组件与现有 Dialog 做适配。导览与人工探索操作同一组件；示例不注入真实工作状态。

实际只读 API 已接文档目录、同版保存意见、显式引用预览与事项成员。真实反向引用、版本附件、跨事项／技术域和全景聚合没有完整对应 API，仍显示“未接线”，不以独立示例充当真实数据。标准开发入口缺少本地后端的事实不由 fixture 登录掩盖；真实浏览器认证、完整材料链与正式 Host 原文跳转仍属项目主控后续验收。此边界不影响本轮本地视觉与独立示例验收。

资料库改版由前端主控交付、项目主控整合；本任务没有推送或发布 Atlas，也没有正式采用、审批或执行任何措施。

## 视觉验收截图

以下截图来自隔离本地浏览器中的实际 React / Cytoscape 页面，不是设计原图，也不是真实机队运行证据。

- [浅色工程文档](visual-verification/documents-light.png)
- [石墨技术领域](visual-verification/domain-dark.png)
- [石墨全景](visual-verification/panorama-dark.png)
- [390 px 复核答复与播放器](visual-verification/mobile-review.png)
- [完整浏览器结果：17 项检查，含 41 幕，5 个 GET，0 写入](visual-verification/browser-results.json)
- [定向视觉结果：全屏、桌面主题、手机、关闭恢复](visual-verification/visual-results.json)

`ATLAS_VISUAL_ONLY=1` 可运行最后一项定向视觉检查；普通模式继续运行完整浏览器流程。复核纠正一幕定位现有只读答复正文，字幕与实际页面目标对应。
