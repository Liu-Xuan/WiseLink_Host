# 第一批实施与隔离验证 — 2026-10-22

当前状态（2026-10-23）：用户批准的 Estimated E 已普通快进同步 origin/github 原同名 codex 分支，私有 D `062e3ab3d10b29a88add508929625e9a76e4064f` 仅 origin。原 Host release `7699657613396610040` 已 finished/error_logs 空，实际前端 D 与后端 D / SERVER_BUILD_ARTIFACT / PASS 均已确认。同一原获权事项的已保存工作、综合关系、正文和准确版本 PDF 可读；精确结构化引用定位未命中，单次刷新未证实新时间推进，均单列缺项。Native c234 本批未操作，DB preview 空且无 DDL，没有新模型、业务 SAVE 或正式采用。D 不含后续 ACK/Review 候选。下文历史时点原样保留，当前结果以末节为准。

## 实施结果

- 以 v1.6 契约为输入，使用当前实际 Host 源码；没有重做已完成的保存、事务/CAS、恢复及 ACK 协议。
- `DocumentParsingPage` 统一持有 JobAid 读取，正文与薄诊断共用；诊断仅覆盖 JobAid 调查与 Overall 消费关系。保留有限集合、未知状态和正式采用边界。
- 普通刷新保留阅读选择；刷新中保留旧观察并明确显示；暂时错误保留获权快照；对象/身份切换、撤权及晚到响应按父级边界处理。
- 导航校验当前 scope、节点、准确引用与 request/attempt 类型；旧 attempt 事件不导航。现有入口只支持打开复核面板，因此按钮明确说明此限制。
- 从权威记录读出动态尝试的记录、开始、首次保存和执行终态时间。就绪、首次可读持久时间、队列 ACK 时间没有被这些字段替代；不存在的历史时间保持未提供。
- 翻译当前已有部分块保存/检查/选用/阅读、已知失败后复用和 FINISH/RELEASE；补针对性回归，未造运行时改动。独立文档页的浏览器翻译接续写入口仍不在已交付范围，不能把内部 service-scope 凭证接给浏览器。
- Python 日期检查改为稳定 ValueError 类别、CLI 退出码和旧输出不变断言，兼容 3.12.8 与 3.14.7。

## 五项验收

| 项目 | 实际证据与边界 |
| --- | --- |
| 独立读回 | 本次通过已授权官方 CLI 独立读取准确 Host 工作记录、Overall attempt 的持久化实际模型输入及不可变成果文件；来源版本、保存请求、JAWR 和采用关系对应。私有读回报告保留完整身份，未把生产数据放入 Git。 |
| 实际消费 | 数据库 previous_work、原浏览器读回 current、原成果 analysis 全对象相等。模型实际输入是压缩投影，经映射后内容字段一致；所选两项真实暴露条件在实际输入、consistencyCheck 和保存阅读正文中均得到处理，且未核实条件仍保持未知。不能仅据引用相等宣布通过。 |
| 保存与收尾 | 复用已经成立的真实保存/收尾记录；本批新增真实 Host 服务＋本地隔离 PostgreSQL 内容级验收，两次 SAVE 后 Overall 使用准确第二修订，原成果独立读回、ACK 正常。既有 COMMITTING/未知结果恢复测试继续通过，未调整调度结构。 |
| 页面 | 实际 React/custom-element 及父级生命周期测试通过；真实读回数据复放的 4 项组件测试通过。本地预览入口正常打开；Chrome 扩展拒绝自动导入本地文件，故未把真实数据浏览器视觉检查计为通过，也未重跑旧包 29 组检查。生产新页面尚未部署。 |
| 构建 | 集成源码双端类型检查和生产构建通过；相关测试如下。 |

所选条件通过只代表限定链路。已有 SEM-01 严重性判断依据不足及 SEM-02 方法要求处置轨迹缺口仍开放，不能声称全面工程验收或正式采用完成。

## 验证

| 验证对象 | 结果 |
| --- | --- |
| 集成工作树，10 个定向 Jest 测试集 | 122/122，通过 |
| 真实读回数据＋实际诊断 React/custom-element，jsdom | 4/4，通过；不等同完整浏览器视觉测试 |
| 后端独立提交 `357292e26174b69504ee315898609f6ed6beef14`，真实 Host 服务＋隔离 PostgreSQL | 28/28，无跳过；已按原差异集成为 `4cf7f732d76f9c0d535ab1b3f5badddbdbc1c9af` |
| 后端对应单元 | 8/8；集成 122 项已包含对应套件 |
| `npm run type:check` | server/client 均通过 |
| `npm run build:prod` | server/client 均通过；Vite 仍有已有大 chunk 提示 |
| 快照生成器 Python 3.12.8 / 3.14.7 | 分别 32/32，通过 |
| 非作者静态审查 | 前端边界、后端时间查询、真实限定语义核对完成；没有用静态审查冒充运行 |

最终构建对应代码提交 `59f726409aa9791b19d7f4d0baff50e20ce7a5ad`。本报告为其后的文档记录，不要求为报告文字重复构建。

## 本地预览

在候选工作树已有依赖的情况下运行：

```sh
node scripts/preview-runtime-monitor.mjs
```

打开 `http://127.0.0.1:5180/monitor-preview.html`，手动选择准确 JobAidWorkingReadModel v2 JSON 或包含 JSON 字符串 body 的读回文件。入口使用真实产品组件，明确标为本地回放，不请求 Host，不把导入时间充作观察时间。生产 Vite 代理规则不用于此隔离预览。

## 准确提交

基线：`6c073de7b6e1e2ce126cf46f405beade388a3639`。分支：`codex/first-batch-mainline-20261022`。本批无远端同步。

| 提交 | 父提交 | 范围 |
| --- | --- | --- |
| 379ac029765fdab2770012375d68afddef365d91 | 6c073de7b6e1e2ce126cf46f405beade388a3639 | chore(monitor): import v1.6 contract and isolated snapshot checks |
| b45fba115e2e6bcbd47dc62957ce7970e5a6d9d7 | 379ac029765fdab2770012375d68afddef365d91 | test(monitor): make invalid-date rejection checks portable |
| 7d3ad594f3ccc8c0b42d83d536613bf7efc601b3 | b45fba115e2e6bcbd47dc62957ce7970e5a6d9d7 | feat(monitor): wire scoped WorkItem diagnostics to shared reads |
| 3b45e15c7500992589a1935729a71f481e75cb99 | 7d3ad594f3ccc8c0b42d83d536613bf7efc601b3 | test: verify partial translation delivery and saved-block continuation |
| 03fdfeb11869a4b4aead60d0c3e3f4e87cb4ef83 | 3b45e15c7500992589a1935729a71f481e75cb99 | fix(monitor): distinguish event times and validate exact navigation |
| 4cf7f732d76f9c0d535ab1b3f5badddbdbc1c9af | 03fdfeb11869a4b4aead60d0c3e3f4e87cb4ef83 | Expose exact JobAid attempt times and verify Overall content consumption |
| 59f726409aa9791b19d7f4d0baff50e20ce7a5ad | 4cf7f732d76f9c0d535ab1b3f5badddbdbc1c9af | fix(monitor): keep replay observation time unknown and isolate preview |

## 文件范围

- `client/monitor-preview.html`
- `client/src/pages/DocumentParsingPage/DocumentParsingPage.tsx`
- `client/src/pages/DocumentParsingPage/JobAidProblemWorkspace.tsx`
- `client/src/pages/DocumentParsingPage/runtime-monitor/WiseLinkRuntimeMonitor.tsx`
- `client/src/pages/DocumentParsingPage/runtime-monitor/WorkItemRuntimeDiagnostic.tsx`
- `client/src/pages/DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read.ts`
- `client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types.ts`
- `client/src/pages/DocumentParsingPage/runtime-monitor/preview.tsx`
- `client/src/pages/DocumentParsingPage/runtime-monitor/wiselink-monitor.d.ts`
- `client/src/pages/DocumentParsingPage/runtime-monitor/wiselink-monitor.js`
- `client/src/pages/DocumentParsingPage/useJobAidWorkingRead.ts`
- `docs/WISELINK_MAINLINE_GRAPH_CONTRACT.md`
- `scripts/preview-runtime-monitor.mjs`
- `scripts/runtime-monitor/build_verification.py`
- `scripts/runtime-monitor/qa_snapshot.py`
- `server/modules/canonical-host/jobaid-work.repository.ts`
- `shared/jobaid-problem-assessment.interface.ts`
- `test/node/core-p1-host-postgres.test.mjs`
- `test/node/helpers/core-p1-host-postgres.fixture.mjs`
- `test/unit/canonical-translation-v2-quality.spec.ts`
- `test/unit/document-translation-runtime.spec.ts`
- `test/unit/jobaid-current-execution.spec.ts`
- `test/unit/jobaid-read-fallback.spec.ts`
- `test/unit/jobaid-read-lifecycle.spec.ts`
- `test/unit/work-item-runtime-diagnostic.spec.ts`
- `test/unit/workbench-refresh-wiring.spec.ts`

原始验证日志、准确生产身份、输入/输出、独立读回和有限语义报告保存在候选树 `tmp/first-batch-evidence/`，均为本地私有材料，未纳入提交。主检出中的并发修改没有被覆盖。


## P0 接线与进度可视化增量（2026-10-22）

本节接续上述第一批记录，不替换历史测试/生产证据。当前目标代码为 `820410230854cb995e4f023685320070a43369a0`；后续记录与生成产物提交只改变本节和 `docs/runtime-monitor/`，不作为新的运行构建。`1ec900f05ed28e1a0164a084fb3ee7b0f618d9f0` 是 `59f726409aa9791b19d7f4d0baff50e20ce7a5ad` 的直接后继且只加本报告；本轮仅对实际改变的验证显示和生成器补验证。

- M1：三条关键接线已登记生产者/消费者、执行/恢复负责人、权威请求与成果、准确输入、ready/save/current判断、读写入口和 V04/V05/V08/V10/V12。定义仍为 v1.6，节点/关系 ID 不变。
- M2：同一组件生成 `docs/runtime-monitor/WiseLink_Wiring_Verification.html` 与 `verification.snapshot.json`。独立四列、工作包/链路/场景/缺口组合筛选、节点/关系下钻、实际入口、摘要、原始证据和下一动作均已接通。只读导入与刷新不改变业务。
- M3：正式入口已核对为 `/work-items/:workItemId/analysis?panel=overall`，桌面“分析过程”或移动端“动态”进入；共用父级 `GET /api/canonical-host/work-items/:id/assessment-work`，保留 READ_DOCUMENT_PARSING 与保存证据归属检查。当前只观察本事项 JobAid 最新动态尝试、保存工作和 Overall 准确消费，不宣称全系统集合。
- 新候选 client 类型检查、生产构建通过；2套11项组件/UI测试、Python39项生成与拒绝检查通过。独立审查发现并修复模板占位字面量与元数据校验不一致问题。日志在本地 `tmp/p0-evidence/`。
- M2 Chrome实际交互通过：打开生成页；P0/save.finish/V08/runtime交叉筛选；节点与关系到实际binding下钻；准确当前源码、候选未部署、历史6c证据与原时间显示；浏览器warn/error为空。截图在本地 `tmp/p0-evidence/verification-browser.png`。这不替代仍受文件选择权限限制的M3真实私有JSON视觉回放。
- 最新官方发布查询仍为 `7699275636347882791` / `6c073de7b6e1e2ce126cf46f405beade388a3639` / finished。本轮尚未发布或新增生产模型/保存/采用。两端 `refs/heads/codex/0-11` 的一次只读核对均为 `b02395537a948fbe427f232f5a52ab59ba43efe0`。
- 测试列按准确执行SHA保留旧证据；当前候选仅V30有本轮新增直接证明，显示“所选场景部分覆盖”是预期。未变的业务服务/worker仍沿用原范围验证，不通过改写旧SHA或重跑全量凑全绿。记录中的日志复核时间与原执行时间分开，未取得的执行时间为null。

P0实现与页面增量已完成，部署和M3真实浏览器待验项仍开放。P1正在补严重性依据与方法处置的实际消费者；P2正在补本人已有上传交付的正常浏览器身份翻译接续。它们不作为当前候选已完成的内容。

### 重建本批验证页

```sh
python3 scripts/runtime-monitor/build_verification.py --contract docs/WISELINK_MAINLINE_GRAPH_CONTRACT.md --bindings docs/runtime-monitor/verification.bindings.json --evidence docs/runtime-monitor/verification.evidence.json --selection docs/runtime-monitor/verification.selection.json --work-packages docs/runtime-monitor/verification.work-packages.json --source-revision 820410230854cb995e4f023685320070a43369a0 --environment host:app_17bzc551rsg:online --output docs/runtime-monitor/verification.snapshot.json
python3 scripts/runtime-monitor/build_previews.py --snapshot docs/runtime-monitor/verification.snapshot.json --output docs/runtime-monitor/WiseLink_Wiring_Verification.html
```

证据 JSON 仅含脱敏摘要、代码位置和私有报告引用，不包含生产正文、真实对象ID或凭据。生成快照时间不是业务观察时间。后续每批更新同一组记录和本报告，按新源码/环境保留历史证据。


## P1—P6 当前候选与 M1/M2/M3（2026-10-22）

本节是当前实施状态；前文第一批和 P0 回执保留其原范围。当前业务代码提交为 `a04c59db668b5162f0e7499bb21ff09732b6307b`，仍在 `codex/first-batch-mainline-20261022`。本节及生成快照的后继提交只记录证据，不改变这个业务代码基线。当前未推送、未发布、未安装 Native；技术准备、真实运行和工程问题解决分别成立。

| 范围 | 已实施及可用入口 | 保留缺口 |
| --- | --- | --- |
| P1 | 新任务按 `jobaid-semantic.v1` 核对严重性定义、业务后果/事件依据及方法要求处置；相关内容进入工作和 Overall。旧封存恢复保持原协议。修复方法快照兼容和 Overall 定义数组按值比较。 | 真实 SEM-01/SEM-02 尚缺的低严重性定义和工程事实不因产品修复自动解决；需准确新资料/获准内容验收。 |
| P2 | 独立文档页已有本人 UPLOAD/ZH_FULL 翻译的 GET 准备与 POST 原请求续接；真实 SQL 身份桥、来源与 actor/tenant 重核。中文阅读区有译文运行图、准确选用块导航和原续接入口。 | 未进行本候选生产浏览器 GET/POST；其他来源按其原授权入口，不扩大本人上传范围。 |
| P3/P4 AEO | 修复同编号状态表的准确工程 owner 校验；来源详情展示原生单机状态窗口及本范围运行图，共用父级读取。 | 缺逐要求身份、完整目标集合及更正/替代关系，不计算整份完成率。真实 TDMS 来源与运行提供方未装配。 |
| P4 LCM | 原矩阵与单机页面加入当前获权快照运行诊断；只使用同一读取集/六字段 binding，沿用父刷新、撤权及旧响应清理。 | 候选快照、有限覆盖、原生值与时间保持其含义；不推断实时全机队或 AEO 完成。真实新图浏览器验收待发布。 |
| P5 | ATA2 直接保存成员进入准确层级，保留 ATA4 子层与根证据去重；Wiki 目录可展开范围诊断，跳转准确成员/原活跃尝试。 | 目录没有确切当前正文 summaryRef，阅读边保持 unknown；全部批准/措施变化消费策略尚需 P3 来源与正文。 |
| P6 | ACK 与 WorkItem 写者、迟到配置入口的真实 `40P01` 均已复现并统一 WorkItem→grant 锁序；保持 CAS、token/generation、配置重放和幂等回执。 | 没有依据扩容量或改队列。当前不存在仅清本地 pointer 的正常释放代码；原外层清理依赖 Host ACK/BLOCK，额外 DEFER 能力未在本批新增。 |

### 接线、运行图与验证范围

M1/M2 仍为同一 v1.6 目录及现有生成器，当前记录六条实际链路：`research.overall`、`translation.reading`、`save.finish`、`feedback.reading`、`wiki.saved-reading`、`configuration.reading`。工作包 P0—P6、链路、场景和缺口筛选共用一套记录；当前源码、环境、证据观察时间与快照生成时间独立。当前与历史证据按原执行源码区分，未将旧测试改写为新候选实际执行。

应用入口均复用父级实际获权读取：事项分析中的 JobAid/Overall、文档中文阅读中的译文运行图、TDMS 准确来源详情中的单机图、LCM 矩阵/单机页面中的范围诊断、Wiki 目录中的范围诊断。展开和刷新不新增模型任务；请求/资源缺失保持“未提供”，不虚构零占用。私有 JSON 浏览器回放仍受原本地文件选择权限限制，未改变权限或另开私有数据服务。

本批验证按实际改动执行，不把以下不同范围相加作全产品通过数：

- P1：隔离 Host PostgreSQL 29/29及协议升级恢复；重要事件依据21项；方法定义实际 Overall 消费3套87项（先红后绿）。
- P2：浏览器身份续接30项单元、12项真实隔离PG、2项消费者传输；译文图18项。
- P3/P4：准确来源读取/批准正文/原生表3套89项；单机运行图4套23项；LCM图和原矩阵相关6套31项。
- P5：ATA2实际层级/输入90项单元、15项Native、7项隔离PG；目录诊断和原客户端17项。该组保留原始执行工具回执，没有独立日志文件，未补造日志路径。
- P6：两条死锁真实基线；修复后4项PG竞争回归、配置与dispatch套件通过、ACK原回执定向2/2。一次扩大到仓库解析用例的初测为89通过/8失败；8项未改解析用例因测试Python缺`jsonschema`，不计为通过，也不因此重复扩大验证或修改产品。
- 集成monitor：6套34项通过，覆盖JobAid、翻译、TDMS、Wiki及验证页；这是React/custom-element范围，不替代生产浏览器视觉。
- 各批受影响类型/ESLint检查通过；最终干净候选构建记录在本节后续回执。

### 真实时间与工程边界

P6复用准确历史生产对象及持久化时间：JobAid受理到开始 **2764.990秒**，开始到首次保存 **283.821秒**，保存到尝试完成 **42.076秒**；Overall等待 **2.123秒**、执行至完成 **83.231秒**。它们是旧生产版本的样本，不是本候选优化后的生产测量。Ready、首次可读、生产ACK、人工补救与全局未知/提交积压未取得，不能倒填或推算。官方同窗13:20—14:25(+08)聚合为1196请求、6错误；CPU/memory/latency回包未给单位和容量上限，不能据此宣称有或没有容量瓶颈。

P3来源代码及隔离验证不等于运行接入：AppModule的TDMS来源授权为Unconfigured，artifact store缺省；分析TDMS_RUNTIME_READER和TDMS_NATIVE_EVIDENCE_VERIFIER仍未装配，还依赖真实TdmsRuntimeAuthority及ProcessingSet来源/对象授权。已批准意见已有typed READ→SAVE→Overall代码；独立ENGINEERING_FILE没有已核措施正文/条款定位、目标/条件/期限及准确任务来源关系。CompleteOwned仅保留原字段，不能把通用字符串或元数据当公司措施证据，也不能把候选acquisition当正式DocumentVersion登记。继续条件是准确获权版本、正文及定位、关系和真实运行权限；正式原件登记另需独立留存许可与原件身份依据。

### 待执行的具体技术包

- Host：当前业务候选及其后继纯记录提交，原应用 `app_17bzc551rsg`；分支仅 `refs/heads/codex/first-batch-mainline-20261022`，origin/github各一条同名普通快进，不触碰main或其他ref。官方DB预览本轮返回changes=[]；发布前若预览变化须重新核对实际差异。
- Native：`wiselink-research-and-synthesize@r09.c229`；包源提交 `ddc5940825edc44572a59699cdd9bebb34b8915c`，技能Git tree `8dfef37c1a4c47b5738a6f26da1bbe05f38b848b`，与本候选技能子树一致。130文件，978592字节，ZIP SHA256 `7e33341a2675618c5b93c7b39c03d11c071a3f0e885fcf8f62adf96b6cb99165`。既有打包器全Skill自测与2项包验证通过，文件集合及逐文件清单核对通过；未改Hosted profile、endpoint或旧任务兼容线。包位于本地忽略的 `tmp/native-package-c229/`。
- Native原会话一次只读元数据：active、streaming=false、queued=0、最新轮completed；这不能替代安装前消费者/调度状态核对。实际安装应由当前原会话单一操作者执行，保持原调度状态，不主动创建新业务请求。
- 本包执行仍按现有[当前Goal](WISELINK_CURRENT_GOAL_20261020.md)的新增推送/发布/Native授权条款，先交具体包后集中确认。技术发布后先核对部署指纹及已有获权对象的只读入口；生产模型、真实SAVE和正式采用仍分别按其实际授权。

### 本批选择性集成提交

| 集成提交 | 父提交 | 范围 |
| --- | --- | --- |
| `52e3a75044f3f761d90e50a79e3576268d0b95a1` | `574b41585c950390c839b770f8eaa8e8c84fd8b1` | fix(tdms): bind reused execution status to its exact engineering owner |
| `2ba97727b51da69a494c2791b07fb7c2e79c6eea` | `52e3a75044f3f761d90e50a79e3576268d0b95a1` | feat: continue owned upload translations from document reader |
| `799fbc6c9c418914a97198f753dad31e6a69581c` | `2ba97727b51da69a494c2791b07fb7c2e79c6eea` | feat(monitor): project exact document translation reading and attempts |
| `935bdf99302190cdba1347e9b85bdfdb1693a6f5` | `799fbc6c9c418914a97198f753dad31e6a69581c` | fix: authorize browser translation continuation under verified SQL scope |
| `a8f41e13f7445af0f98cc446c9abdf0786582f43` | `935bdf99302190cdba1347e9b85bdfdb1693a6f5` | fix(jobaid): version semantic evidence and method disposition checks |
| `7a1c44ecc8522fe441e6858fbd666aa62ba4bd66` | `a8f41e13f7445af0f98cc446c9abdf0786582f43` | feat(tdms): read native engineering execution rows in source details |
| `4ed6d6e7475bdf38c59f3ee2bcd0c7e2f18dac4d` | `7a1c44ecc8522fe441e6858fbd666aa62ba4bd66` | fix(jobaid): require business evidence for important events |
| `69135ef94e6aa4be62f983a65f493517daaaac3a` | `4ed6d6e7475bdf38c59f3ee2bcd0c7e2f18dac4d` | fix(wiki): consume confirmed ATA2 members at their actual scope |
| `42cebfaec2d4bf90d134bbe88254b532f0e188b6` | `69135ef94e6aa4be62f983a65f493517daaaac3a` | feat(monitor): project exact engineering execution source reads |
| `6584fdafd2942554e5a056360d79bbb05736c7a7` | `42cebfaec2d4bf90d134bbe88254b532f0e188b6` | feat(wiki): expose scoped runtime diagnostics from directory reads |
| `3036fac24b0bbcca90f50cc52bbcadb159dea524` | `6584fdafd2942554e5a056360d79bbb05736c7a7` | chore(openclaw): declare reviewed Native skill package c229 |
| `3c07a680fa2c81a33bce7dd040ecd376eb0c089a` | `3036fac24b0bbcca90f50cc52bbcadb159dea524` | fix(runtime): serialize automatic ACK with WorkItem writers |
| `55e4b7cf037383d4007f240dad075a73bade06e8` | `3c07a680fa2c81a33bce7dd040ecd376eb0c089a` | fix(runtime): align configuration and ACK lock ordering |
| `090ab2679a655c2678b03e70cced255b6fae5d6a` | `55e4b7cf037383d4007f240dad075a73bade06e8` | fix(overall): compare classification definitions by value |
| `a04c59db668b5162f0e7499bb21ff09732b6307b` | `090ab2679a655c2678b03e70cced255b6fae5d6a` | feat(lcm): diagnose the current authorized matrix read set |

作者提交及原执行源码保留在 `verification.evidence.json`；不能由选择性合入后的新SHA推断作者测试在新SHA重跑。私有读回、原始日志及准确身份继续只在忽略的本地证据目录，公开记录不含真实对象ID、正文或凭据。

当前重建命令：

```sh
python3 scripts/runtime-monitor/build_verification.py --contract docs/WISELINK_MAINLINE_GRAPH_CONTRACT.md --bindings docs/runtime-monitor/verification.bindings.json --evidence docs/runtime-monitor/verification.evidence.json --selection docs/runtime-monitor/verification.selection.json --work-packages docs/runtime-monitor/verification.work-packages.json --source-revision a04c59db668b5162f0e7499bb21ff09732b6307b --environment host:app_17bzc551rsg:online --output docs/runtime-monitor/verification.snapshot.json
python3 scripts/runtime-monitor/build_previews.py --snapshot docs/runtime-monitor/verification.snapshot.json --output docs/runtime-monitor/WiseLink_Wiring_Verification.html
```

本批M2浏览器实测：六条接线/四列证据显示；P5+V18+运行及P4+LCM链+V38+部署组合筛选、LCM节点到实际binding下钻通过，warn/error为空。截图为本地 `tmp/p1-p6-evidence/verification-browser.png`，不等同生产业务图验收。

### 最终构建与执行准备回执

干净候选 `20f2a7b5df1158f24bac31c7d4fb367cdd3ac327` 的生产构建通过，内嵌指纹为同一提交，构建时间 `2026-10-22T15:27:19.348Z`。该提交相对业务代码 `a04c59db668b5162f0e7499bb21ff09732b6307b` 仅改变上述协调记录和六个验证记录/生成产物。本节后继提交只补本回执，沿用该构建证据，不重复纯文档构建。日志位于本地 `tmp/p1-p6-evidence/final-build.log`。

发布准备的官方只读回执仍为 release `7699275636347882791`、`finished`、提交 `6c073de7b6e1e2ce126cf46f405beade388a3639`、`error_logs=[]`。数据库 dev→main 预览 `changes=[]`，本批没有独立DDL。两端准确新分支查询均为空，尚未创建远端引用。新增提交范围的文件/文本静态检查未发现本地私有证据目录、真实业务对象ID、私钥或凭据字面量；该检查仅覆盖本批公开同步范围。

拟执行次序为：

1. 在本隔离候选检出配置已获准的精确 remote URL：`origin=https://miaoda-git.feishu.cn/apaas4.0/-/t_mx8LiKO6/code_T0OCUEHo3all.git`，`github=https://github.com/Liu-Xuan/WiseLink_Host.git`；保留 `.githooks/pre-push`。两个 remote 分别单次普通推送同一 `refs/heads/codex/first-batch-mainline-20261022:refs/heads/codex/first-batch-mainline-20261022`，逐端核对完整SHA。
2. 原 Host `app_17bzc551rsg` 使用官方 `apps +release-create --branch codex/first-batch-mainline-20261022 --as user`；发起前重核官方数据库差异仍在本包范围。读回同一 release 的准确提交、最终状态、运行指纹及既有获权对象，不以本机构建替代部署证明。
3. 通过原私有 Native 应用 `app_17c3zn24kv2` 的官方文件存储传输上述准确 `c229` ZIP及manifest；在原会话 `conversation_4m2mw7ny0dbns` 由单一操作者核对安装版本、消费者及调度在途。先保存原安装和配置，只在无在途消费者时通过官方同名 Skill 安装；若需短暂暂停当前启用调度，安装后仅恢复安装前准确启用集合，不启用原已停用调度。
4. 安装后逐文件核对130文件、版本/Ready及安装目录的受影响验证，保留安装器元数据。调度配置与安装前逐项比较，不创建业务请求、不清pending或活动指针、不重启未知调用。若原会话存在在途执行，等待既有执行正常结束，不强制接管。

该技术包不包含新生产模型调用、真实业务SAVE、来源权限扩展或正式采用。真实TDMS措施正文/准确关系、完整AEO要求与目标，以及SEM工程资料缺项分别保留继续条件；技术发布成功也不关闭这些业务缺口。

### 2026-10-23 来源口径纠正与交付预检

用户已于 2026-10-22 23:48 批准 `25c7faa108b14c1e991bca4704087365505a5340` 整批技术交付。`origin` 的 `codex/first-batch-mainline-20261022` 已普通推送并读回同一 SHA；Host 发布尚未发起。本节更新当前执行状态，前文的“尚未创建远端引用”保留为当时准备记录。

实际 Native 已安装 `r09.c233`（源码 `cebfcf6340d15c92d0f6e3cba05383935e4c2eaf`）。原 c229 包不含该安装版本的恢复、预算及 Wiki 保护，因此停止使用该旧包，已重组并审查 c234：源码 `d1725e182277ea504f697b5e0fbd872f9837a0e7`，技能 tree `1bfa433c969b1885742db94bdf2a51120d9c18f3`，132 文件、1002345 字节，ZIP SHA256 `d4e9bc284cf387da1cd013d8dc6e60034712908179a9d6226838f8bf4b05d317`。完整 Skill 打包校验及422项定向 Native 验证通过；原 c233 消费者文件保持一致。只读核对真实16项调度，仅原 C136 启用；尚未暂停、安装或新增业务执行。替换包已向用户单独提交确认。

公开同步检查扩大到 GitHub 所有现有分支/标签的未公开历史后，发现原25c祖先含未公开生产对象记录，故未向 GitHub 推送该历史。已准备公开替代分支 `codex/mainline-public-delivery-20261023`，提交 `12693186d0f07b7b0e815b4d9ff1a47372895d8d`，父提交为已公开 `b37f69caaa00979f79a9633023a38649534dae2b`；4365个路径与25c比较，4364个相同，仅 `docs/coordination/M_INTEGRATION.md` 保持已公开的脱敏内容。原私有历史保留。该新分支双远端同名同步与c234替换已一并提交确认，尚未执行。

用户明确公司意见来自**已批准评估单意见及关联工程文件**，无需再找独立“公司措施”文档；工程文件关联本身不证明其正文已经READ。当前不解析AEO正文，适用飞机号使用反馈单页面，未来接入AEO结构化文件。因此前文把“完整AEO正文解析/独立公司措施正文”作为当前核心前提的描述已撤回。

后续隔离候选 `codex/source-clarification-20261023` 集成了三项已审查变更：c234整合 `882d4d94`、反馈页适用对象 `3cbe6ebb`、元数据SQL正文隔离 `e4d72e22`。反馈页使用准确owner/version的AC、ENG、APU原列值，去重编号但保留重复原行、空值及截断未知；覆盖源读取、页面和运行图92项验证通过。元数据查询在PG返回前去除content、opaque rawFields和附件获取载荷，显式正文READ保留；真实PG修复前失败/修复后通过，74项单元、类型与生产lint通过。它们不在原25c发布源中，后续候选尚未发布。

2026-10-23 00:16(+08)官方只读核对确认线上9张TDMS来源/授权/关系/receipt表存在，当前CLI身份可见计数均0；`tdms_processing_revision_set` / `tdms_processing_set_head` 不在完整表清单中。此处只报告CLI可见结果。已有cebfcf代码具有可复用receiver/grant及精确身份核验，当前实现仍需补齐后台服务委托Source context、真实retained processing set/批准意见事实生产以及reader/verifier装配。没有创建新grant、导入材料、触发模型/SAVE或正式采用。

后续集成源码 `e4d72e22c3283fed77e1763ad66243298c1b2417` 实际执行4套110项相关回归与1项隔离PG验证均通过，双端类型通过；记录于 `tmp/source-clarification-evidence/`。这是本地集成证据，尚无部署或真实业务运行证据。

### 2026-10-23 当前来源授权与浏览器读取接入

后续候选在 `067fd8053269675085b4301f19c55d53e90b11c0` 之后选择性合入真实保留数据读取 `e6dda9bd`（作者 `0777fd37`，仅元数据和现有明确关系）与 Host 委托基础层 `49295937`（作者 `d2fd697c`）。后者分开实际服务执行者和最终用户，复用当前 WorkItem/自动授权/租约及已封存任务的准确身份；只读 receiver 使用真实 SQL actor、受控部署身份、当前映射与独立 Source grant。没有创建或迁移生产数据。

浏览器来源读取提交 `38fb3de8f2eec3523e4ab6b9b75a16a23dde1a84`（父 `49295937`）将 AppModule 的实际 Source 读入口接到 `TdmsBrowserSourceAuthorization`。该 provider 每次返回有界的 record/artifact/relation 成员和最早有效期；本批仅支持既有 Miaoda Gateway 浏览器身份及空上下文/准确 DocumentVersion 上下文，其他对象上下文明示拒绝。IMPORT 及附件获取仍无绑定，不因读授权扩展写权限。已保存来源的成员范围按 recordKind/sourceRecordId 确定，附件另核准确身份和版本；这不是额外创造的一份逐版本记录授权。

来源目录与文档关联目录在 SQL DISTINCT/seek/LIMIT 前按授权成员过滤；详情、附件获取事实与关系两端在释放前分别核对，权限版本、成员内容或有效期漂移都阻止返回。现有明确 whole-scope 的测试/Host provider 仍保持原语义，显式空成员集为 deny-all。原批准前正文隔离及独立文档读取策略保留。

实际验证：新增6项有界成员单测通过；真实模块组合测试通过（只替换平台基础设施，不替换新授权 provider）；真实非 superuser/non-bypass PostgreSQL 下新7项结果通过、0跳过，验证来源正文/真实receipt、56个同scope隐藏记录在分页前排除、DVI独立读取策略、关系及双端权限、写receipt期间受控撤权导致无正文返回并回滚receipt。另3套37项历史/返回/文档读取回归通过，原 service-behavior 中无关关系fixture使用未被现有正文策略接受的CEO-S类型，改为同类AEO关系fixture后28项通过；未放宽生产正文策略。服务端类型和受影响生产文件lint通过。原始日志保留在本地 `tmp/source-clarification-evidence/browser-source-*.log` 与 `browser-bounded-tests.log`。

这些证据属于本地实现及隔离验证。真实来源表、grant和processing set的生产状态仍以上节官方只读观察为准；本批未进行Host发布、Native安装、来源导入、新模型或业务SAVE。

### 2026-10-23 Native 实际消费者与历史 READ 图集成

本节更新当前实现。业务代码为 `5f753f3f06a63ffa9a669474d2ccee344c82bbbc`，本地分支 `codex/source-clarification-20261023`。它是原已批准 `25c7faa1` 之后的后续候选，未推送或发布，不替换已批准包。M1/M2新增第七条 `company.approved-opinion`，保留开发接线、测试、部署、实际运行四列；M3接入父读取中实际保存的TDMS证据。

| 集成提交 | 父提交 | 作者提交与范围 |
| --- | --- | --- |
| `a0869bd7f86768f7b19c0ca1b4dbb77a20286cdf` | `38fb3de8f2eec3523e4ab6b9b75a16a23dde1a84` | `ab725712ece1f726c1754de19932cd4da1b17844`，真实browser/summary caller与保存证据校验；经P1中转c9c8639c |
| `d22caef316d8bce5fffa20d3bee82bcd2bdd69fc` | `a0869bd7f86768f7b19c0ca1b4dbb77a20286cdf` | `e16e62096d5508ebf2aacb24fd1d7c6ba064a87e`，真实Summary完整消费测试；经P1中转1a7059e0 |
| `961221a5d792b99ce16b1bc4700433c40a647260` | `d22caef316d8bce5fffa20d3bee82bcd2bdd69fc` | `3cdcd5479e9bdbe107fa69f30b7d82168d6428b3`，真实运行reader、同事务receipt/原件来源及Host消费者/恢复接线 |
| `c971254dc0ffcd0f88f4b006aa09ddaa83d3fab6` | `961221a5d792b99ce16b1bc4700433c40a647260` | `57d13c0da94bd1c1f2f330167b18daed93a71718`，M3保存来源图和详情 |
| `5f753f3f06a63ffa9a669474d2ccee344c82bbbc` | `c971254dc0ffcd0f88f4b006aa09ddaa83d3fab6` | 集成审查修正新边为v1.6准确ID `company.research`，补入已有断言 |

`CanonicalHostModule` 的 runtime reader 与 native verifier 已注册真实 `TdmsProductionRuntimeReader`。普通非TDMS来源在明确标记发现前退出，不因新Native配置影响原BEGIN/SAVE/读取。TDMS来源从真实已登记DM acquisition/nativeRetention及准确附件/来源关系定位，不按标题或内容hash猜身份。服务执行者、最终用户、真实SQL role、当前Source audience、选定对象、WorkItem/自动授权/attempt租约在原事务核对；元数据发现不读取journal正文，不计为READ。

JobAid READ先落准确回执，SAVE、Overall消费、浏览器读回及Summary再核原journal、receipt、集合成员和保留内容。Summary以自身实际request/attempt租约核验；已完成结果只用准确持久化结果的SAVED_RESULT条件，不借用无关WorkItem lease。真实并发测试复现的Summary收尾锁序已修正为先head后attempt。既有过期COMMITTING恢复只核验封存结果指向的准确已保存工作；后续未消费READ不能改变原结果，不增加READ、模型调用或执行租约。

M3的`business.company_records → assessment.research`使用已保存父响应中的evidence、sourceRevision、原READ receipt及workRevision完整身份；详情明确历史READ时间、来源观察时间和父页面读回时间。旧Overall仍指向原workRef时显示unknown及当前工作pending，不能把新TDMS依据配给旧Overall。临时刷新错误保留获权观察，撤权/会话或事项切换清理；组件无新fetch。

验证按原执行范围登记，不合计为全产品通过：

- 作者134项单元、Native/恢复9项和原Host COMMITTING6项真实PG使用最终未提交工作树；其后仅排版/注释变化再提交，行为与3cdcd相同，不能称为该提交完整树原地执行。
- authority7项真实PG在较早工作树阶段运行；完整Summary消费4项在独立clone复制对应消费者后运行，包含finish锁序先红后绿。保留原日志及上述执行范围，不将它们的执行SHA倒填为最终提交。
- M3作者3套15项通过；集成契约边ID修正后2套11项通过。后者包括真实adapter/React/custom-element行为，不等于线上浏览器视觉。
- 集成c971的双端类型检查通过；实际Nest Source组合和有界成员2套7项通过。生产构建首次因未提交协调文档被`SERVER_BUILD_FINGERPRINT:GIT_WORKTREE_DIRTY`保护拒绝，未绕过；干净提交后的构建另记结果。
- 原日志统一保留于本地忽略目录 `tmp/source-clarification-evidence/`，包括 `native-runtime-unit.log`、`native-authority-postgres.log`、`native-recovery-postgres.log`、`native-summary-consumer-postgres.log`、`native-core-recovery-postgres.log`、`native-monitor-author.log`、`integrated-source-composition.log` 和 `integrated-native-monitor.log`。

当时实现回执（已由末节 Estimated 修正取代）：retained provider 曾固定给出 `validity=UNKNOWN`，成员为 `QUALIFIED + APPROVAL_VALIDITY_UNKNOWN`，批准正文 READ 返回 `TDMS_RUNTIME_OPINION_NOT_APPROVED`。这是旧实现的行为，不再作为需要另找批准业务规则的当前结论。Review/successor 及 OAuth Native 未接通、关联工程文件未自动取得 PDF、V44 获取/解析/恢复未验的范围继续单列。当轮没有线上 DDL、grant、来源导入、Native 安装、新模型、业务 SAVE 或正式采用。

最终构建回执：干净候选 `2a5b36eed33713f93e326f4f3e11a8b5fe903ff3` 生产构建通过，服务端内嵌同一SHA，构建时间 `2026-10-22T17:26:17.738Z`；Vite保留已有大chunk提示。该提交相对业务5f只改7个协调/验证记录文件，本回执后继仍为纯记录。快照QA首次误传JSON作为契约参数被明确拒绝，改用实际Markdown契约后39/39通过；没有修改校验逻辑。Chrome实测第七条接线、P3+company+V44+运行组合筛选及准确下钻，保留UNKNOWN与PDF缺口，warn/error为空；截图为本地 `tmp/source-clarification-evidence/native-wiring-browser.png`。此证据仅为M2离线验证页，真实业务与M3私有JSON视觉回放仍未验。本节记录不要求重跑未改业务或再次构建。

### 2026-10-23 三组事项阅读与已授权到期回查

本轮业务代码为 `66e70d1d9fe3ec76407ce6a12f72b84906c88603`，后继协调记录和验证快照不改变此代码。继续使用来源澄清隔离候选，未修改主检出；本轮没有外部同步、发布、Native安装或生产业务写入。

| 集成提交 | 父提交 | 范围与作者提交 |
| --- | --- | --- |
| `91b96a2a424fd88320bc61b9aaeeeeb9c5eaa23c` | `c0fc9a968571b63d0597e33e76aab655445ccdcc` | 3个模块文件；共享TdmsReceiverIdentityModule消除重复provider注册，身份和来源策略不变 |
| `6d4809f7e5232222ec3efc8bf653d88661e366d8` | `91b96a2a424fd88320bc61b9aaeeeeb9c5eaa23c` | Wiki service及真实PG测试2文件；作者 `46c091e598cdc1d858160effb48da350cec3b4da` |
| `66e70d1d9fe3ec76407ce6a12f72b84906c88603` | `6d4809f7e5232222ec3efc8bf653d88661e366d8` | 事项页面/组件、CSS、已有catalog投影、shared类型及定向测试12文件；作者 `b898573bebffa3571597c211fcf0cf6ea36e02bf` |

事项首屏按“当前判断与范围、公司安排与落实、变化与下一步”组织。真实页面传入准确`displayedRevision`，复用保存工作、未决项、复核条件及原依据导航；长清单可展开，首项完整条件和下一步保持可见。历史工作不叠加当前适用性或待纳入资料，更正和引用过期提示保留在折叠外，引用影响按本版问题范围显示。公司正式意见/工程文件/AEO清单本次仍未取得，页面明确读取缺项，系统候选建议单独显示。

适用性只复用原获权WorkItem的模块投影，返回有限字段及原对象、时间和STALE含义。若投影来源与该资料不符，只返回`null + SOURCE_MISMATCH`，不释放旧DVI、机号或结论，其他已获权资料和事项仍可读。原Matter、WorkItem、Source授权链未放宽；没有新增全机队结论、审批或采用。

Wiki原自动入口只遍历waiting MATTER，会漏掉“输入均已覆盖、但保存的DUE_AT条件已到期”。本轮只把当前enabled FLEET上的显式enabled upstreamDelegations准确ID合入候选，随后继续原SQL principal/ACTIVE用户/CONFIRMED成员授权、actor一致、nextForRuntime与持久化occurrence幂等。没有遍历全部Matter或启用新策略。

实际验证与归属：

- 共享身份模块的真实Source Nest composition 1/1通过。正常公开候选precommit曾报告重复provider，修复后代码相同的公开 `84af274858b624afa3449beaed4399298d5b7753` 全eslint、双端tsc、stylelint通过；没有绕过hook。
- Wiki作者提交的真实PG先红后绿，7/7（6个子测试和父测试）、0跳过；未来条件、关闭delegation、非CONFIRMED成员、inactive用户、重复原attempt和终态不重开均覆盖。相关3套单测16/16与类型/lint/语法通过。
- 额外旧`hierarchical-wiki-unclaimed-attempt`套件7失败/15通过，在纯`c0fc9a9`基线同样复现，原因是测试client缺`begin`。本次没有修改该生命周期，也没有将这项检查记为通过。
- 首屏作者分阶段共30个不同测试通过，不能称为最终完整树统一运行：最后首屏6项在全部修改完成后运行并原样提交；服务6/reference7对应文件之后未改；Wiki mount8后首屏依赖仍改局部提示，问题阅读2/历史稳定1为阶段回归。server类型和CSS对应最终文件；client类型与scoped ESLint后仍有候选标签、断言和空行修改。主控只补受这一后续修改影响的实际mount验证，另由最终正常提交检查覆盖静态检查。
- 主控Chrome使用集成代码和纯合成fixture核对三组同屏、候选与正式缺项、历史不叠加当前适用性、保存依据展开，warn/error为空。静态预览首次因平台CSS的开发期inspector引用失败，改用仓库现有隔离预览主题后成功；只提供编译后的合成静态资源，没有提供私有业务JSON服务。截图为`tmp/source-clarification-evidence/matter-reading-browser.png`，不替代生产事项或M3私有数据视觉验收。

M1增加`matter.saved-reading`实际接线，复用v1.6的`artifact.reading`及现有节点；Wiki补充到期回查的原入口与边界，不改稳定契约ID。M2共8条接线，源码、测试、部署、运行分别保留实际范围；Chrome的P2＋事项阅读＋V24＋运行组合筛选/下钻显示准确入口及正式清单缺口，warn/error为空，截图为`tmp/source-clarification-evidence/reading-wiring-browser.png`。M3仍为原Host读取的投影，本轮未增加第二状态或调度器。

此段原为技术授权前的阶段记录，已由后续 b561 整批授权和末节状态更正：旧 b561 技术授权有效；新私有发布源更正仍在准备。真正待项为实际 Source/grant/processing set、OAuth 新设备/offline 授权、未结构化撤销/取代解码、SEM 工程事实及真实内容级模型/SAVE 验收，三类生产变化的实际最小更新范围和 M3 私有 JSON 视觉回放仍未验。Estimated 的批准语义已确认，不再列作待业务规则。AEO 本期不解析正文，继续按反馈页飞机号口径，未来接结构化文件。

主控集成 `66e70d1d` 的真实Wiki页面/read hook mount已补验8/8通过，涵盖准确修订、历史、更正/引用提示与401/403/404撤权清除；日志为`tmp/source-clarification-evidence/p2-integrated-mount.log`。测试仅有既有React Router v7 future flag提示；Chrome实际预览无warn/error。


### 本轮公开交付候选与最终构建回执

公开候选 `453cb7ef5aef6a8a0549980b7bf26a85b9d2019c` 位于 `codex/source-clarification-public-20261023`，父提交 `84af274858b624afa3449beaed4399298d5b7753`，后者继承已审查公开基线 `12693186d0f07b7b0e815b4d9ff1a47372895d8d`。主控独立比较其完整Git树与来源候选 `97a2f500a105d21adc14a59d10acf338320e5871`：4402个路径中4401个blob/mode一致，唯一差异是`docs/coordination/M_INTEGRATION.md`保留原公开脱敏版本；业务代码等同`66e70d1d`。公开仓库未引入原私有祖先提交对象，新增内容检查未发现凭据、真实业务对象记录或私有日志。后继记录提交仅同步本节及生成的验证记录。

正常pre-commit的完整ESLint、双端TypeScript和Stylelint通过。该精确公开候选完整`npm run build`于`2026-10-22T18:09:46.709179Z`成功；服务端指纹内嵌完整`453cb7ef`提交，构建时间`2026-10-22T18:09:24.063Z`；前端内嵌同一完整提交。前后端构建和最终477/477依赖裁剪通过，工作树干净。仅保留已有模块类型、静态/动态混用和大chunk提示。本机第一次构建因npm缓存写入权限失败，第二次编译成功后因依赖软链接越出候选目录被prune拒绝；改为私有临时缓存和树内真实依赖副本后第三次正常构建通过，没有修改或绕过构建规则。失败日志分开归档，构建开始前已有子日志未计入本轮证据。日志和指纹保留于本地`tmp/source-clarification-evidence/build-453cb7ef*`及`453cb7ef-build-fingerprint.json`；纯记录后继不重复构建。

2026-10-23 02:06(+08)左右重新只读核对：原Host正式release仍为`7699275636347882791`、`finished`、提交`6c073de7b6e1e2ce126cf46f405beade388a3639`、无error logs；数据库dev→main预览`changes=[]`。双远端拟用同名`refs/heads/codex/source-clarification-public-20261023`尚不存在。本次没有外部推送、发布、Native上传/安装或生产业务写入。官方CLI凭据刷新曾被沙箱本地存储限制阻断，经正常权限审批后只读查询成功。

以下为授权前准备记录；用户后续已批准 b561 整批技术交付，实际结果见末节。当时拟提交的技术范围为：最终公开候选分别普通推送到已授权`origin`和`github`的上述单条同名分支、原Host `app_17bzc551rsg`正式发布、原Native `app_17c3zn24kv2`按已有受控脚本安装原样c234包。c234的132个文件、源码`d1725e182277ea504f697b5e0fbd872f9837a0e7`、Skill tree `1bfa433c969b1885742db94bdf2a51120d9c18f3`和ZIP SHA256 `d4e9bc284cf387da1cd013d8dc6e60034712908179a9d6226838f8bf4b05d317`均未变。安装及恢复仍分两阶段；只临时暂停原启用调度、等原消费者自然空闲、安装后保持暂停，待原Host精确交付提交正式发布并核验运行指纹后，才恢复原启用集合。最终精确提交与脚本SHA由本地私有准备回执记录，执行前再次只读核对在途状态。该准备不扩展此前25c/c229的精确授权。

该段原把 Estimated 之外的批准证明列作前提，现由用户明确“就是 estimated”更正：自身准确 Estimated 就是批准/当前有效状态，稳定版本仍不能替代自身状态；本地映射已完成。真正剩余依赖为实际 TDMS 来源/grant/processing set、线上状态刷新、未结构化撤销/取代解码、工程附件准确字节与版本关系、SEM 两项工程事实和内容级模型/SAVE 验收；三类变化仍需真实变化验证。公司意见继续按用户指定的已批准评估单意见及关联工程文件取得，AEO本期不解析正文，反馈页提供适用飞机号。真实M3私有JSON视觉回放仍保持待验。整体持续Goal未完成，本次只交付已完成的独立代码与可审阅技术包。


### 2026-10-23 Estimated 映射集成与技术交付（C 发布前记录）

本节替代前文把技术包授权、Estimated 业务语义列作当前缺口的结论。用户明确公司意见来自已批准评估单意见及关联工程文件，并确认评估单自身 `Estimated` 就是批准/当前有效状态；不再要求第三方有效性证明。当前后续候选仍仅本地，没有推送、发布、来源导入、模型、业务 SAVE 或正式采用。

| 准确提交 | 父提交 | 范围及审查 |
| --- | --- | --- |
| `ff0d89cbaaa7fcd91dfe7f11999644fd828ec142` | `07dcd5efce6716f08b5ae881b23bc528cca69e3e` | 独立 clone 的 2 个产品文件和 1 个 PG 测试；非作者 Astra 接受，无必需修正 |
| `761568ec2462e36a97f79cca989104011c464c59` | `07dcd5efce6716f08b5ae881b23bc528cca69e3e` | 正常 cherry-pick ff0，完整 Git tree `56c5c9875e98c71c7da7943b9ba29b7c89212795` 相同；未覆盖根检出或公开 b561 |

实际消费者已接线：`TdmsRetainedRuntimeFacts.readProjectionFacts` 在原授权事务重读准确 `ENGINEER_ASSESSMENT` 自身状态，复用 `isEstimatedState`。符合 Estimated 时映射 `ACTIVE`，依据引用就是该真实 `sourceRevisionRef`；缺状态、Estimating 或冲突 rawCode 仍 `UNKNOWN/null`。现有 projector、RuntimeReader、native verifier、before/after、准确 source/owner/version/actor、正文、保存/CAS 及正式采用门槛保持。多份批准意见可以并存，新草稿不覆盖旧批准；明确撤销及 SOURCE_EXPLICIT 取代规则保留。不从父单、同 ATA、标题或稳定版本推断批准，不另造有效性证书、关系平台或 DDL。

| 原验证与源码时点 | 实际结果 |
| --- | --- |
| ff0 最终源码，真实自有隔离 PostgreSQL | 19/19，fail/skip 0；provider→projector→真实 reader→持久 receipt，两条意见准确 a/b 引用，discover 无正文泄漏；状态、owner/version、before/after、cohort/mapping/body 负例通过 |
| ff0 最终源码，5 个关联单测套件 | 244/244，含原显式撤销、取代、新草稿及 actor/Source 撤权边界；正常提交钩子通过 |
| 集成 761 | 与 ff0 完整 Git tree 相同，明确复用原日志，不改写执行 SHA、不重跑业务测试；本轮 M1/M2 与最终候选构建单独记录 |

首轮隔离库因 sandbox 禁止 SysV shared memory 在 initdb 阶段停止，获准仅本机测试提权后完成先红后绿：旧 provider + 新断言 19 项中 6 通过/13 失败，修正后 19/19；不曾连接生产数据库。原日志保留在 `/private/tmp/wiselink-tdms-estimated-validity-20261023/tmp/estimated-evidence/`，本轮集成证据放在候选 `tmp/estimated-integration-evidence/`。

M1 仍是 v1.6，B.5 明确已确认语义，E.3 记录实际生产者/消费者与验证；原节点和关系 ID 不变。M2 更新 `company.approved-opinion` 的 own-state/receipt 接线、P0/P3/P5 下一动作、实际缺口和八条接线当前部署记录，生成同一可筛选下钻 HTML 与 snapshot。旧证据保留原源码/时间，19PG/244unit 显式记录原执行版本及 tree 相同的适用范围，不自动继承为线上通过。M3 继续只投影父响应已经保存的真实 READ；本轮没有手写运行状态或新增请求。

技术交付授权与实际结果分别如下：用户已批准准确 `b56133d45f507129e81fb3250370250808594bad` 整批，origin/github 均已读回。原 Host release create 一次被平台 `400002552` 拒绝，`release_id=null`；最近正式 release `7699275636347882791` 仍为 `6c073de7b6e1e2ce126cf46f405beade388a3639`。新私有发布源及安装恢复目标更正已完成准备与独立审查，等待用户唯一更正确认，不在本轮执行；C 产品 tree 仍只含原 b561，不包含本地 Estimated。原 Native c234 的 132 文件、Ready 和安装自测 422/422 已由主控确认，16 条 cron 全部暂停；不重装、不伪填 Host 目标，不把 Native 安装说成 Estimated 上线。

仍需完成的是实际 TDMS 在线状态刷新与 Source/grant/processing set、未结构化撤销/取代解码、准确原文 V44、OAuth 新设备/offline 授权、真实 SEM 工程事实和内容级模型/SAVE，以及三类生产变化和 M3 私有 JSON 视觉回放。新私有技术更正与这些实际业务动作各按准确范围准备和授权；旧 b561 授权不失效，Estimated 语义也不再重新求证。

本轮展示验证：现有 Python 快照 QA 39/39 通过；实际生成 HTML 的 jsdom 核对八条接线、P3＋company＋V53＋runtime 联合筛选及节点到准确 binding 下钻，四列状态与原 ff0 测试身份正确，diagnostics 为空。该检查是离线生成页交互，不冒充 Chrome 视觉或生产业务验收。原日志为 `tmp/estimated-integration-evidence/snapshot-qa.log` 与 `generated-m2-check.log`。


本轮最终构建回执：记录提交 `81baa5a7f843e9fe232d6c45f195c1ab579ce05e` 直接父 `761568ec2462e36a97f79cca989104011c464c59`，仅改 9 个 M1/M2/执行记录文件，正常完整提交钩子通过。已在独立实体目录 `/private/tmp/wiselink-estimated-final-build-20261023` 对准确干净 81 执行一次正常 `npm run build`，开始 `2026-10-22T21:23:43.885834Z`，结束 `2026-10-22T21:24:26.073744Z`，exit0，约42.188秒。复制既有完整依赖，使用已获准缓存 `/private/tmp/wiselink-public-build-npm-cache-20261023`，没有重新 install/解析依赖，也没有修改构建或裁剪保护。最终依赖477/477、失败0，构建后工作树干净。

服务端 immutable `build-fingerprint.json.sourceCommit` 和前端编译产物中绑定 `sourceCommit` getter 的不可变常量均为完整 `81baa5a7f843e9fe232d6c45f195c1ab579ce05e`；两端构建时间分别 `2026-10-22T21:24:02.315Z` 与 `2026-10-22T21:23:51.393Z`。前端只保留已有 MODULE_TYPELESS、静态/动态混用和大chunk提示。初次产物校验尝试用 Node 导入前端浏览器模块遇 `window is not defined`，原失败日志保留；之后用编译产物 AST 核对实际常量及 getter 绑定通过，未执行浏览器应用、未追加构建或业务测试。

本轮四个固定子日志在主控确认的独占构建窗口生成，全部按新mtime归档，没有将旧日志计为本次证明。原日志和实体目录、构建归属、双端指纹、裁剪与警告记录在 `tmp/estimated-integration-evidence/final-build-result.json`、`final-build-verification.json`、`final-build*.log`、`final-gen-*.log`；初次校验失败在 `final-build-verification-initial-node-import.log`。本回执后的提交仅更新这些事实和生成的M2快照，沿用准确81构建，不重复业务测试或构建。当前本地展示为 `docs/runtime-monitor/WiseLink_Wiring_Verification.html`，源码目标明确为81；M3未增加或伪造运行数据。

### 2026-10-23 C 实际发布、运行与后续 Estimated 本地候选（历史时点）

本节保留 C 交付时点，前文 C 发布前的拒绝、准备、待授权与暂停观察仍是其原时点事实；后续 Estimated D 已发布的当前结果见下一节。用户已批准 origin-only C 更正源及原应用的 device/offline 授权。C 只是让原 b561 产品接入准确 origin main 的私有发布源，产品 tree `dbb579e435ed879481cfb38760744a69dd35ac2d` 与 b561 相同；不含本地 Estimated。已审核的公开 Estimated 候选 E 与后续私有 D 仍是下一批本地准备，未推送、未发布。

| 已取得的原始证据 | 准确结果与范围 |
| --- | --- |
| 官方 C 发布 | release `7699611310187924507`，准确提交 `de091c3ba6f9f201d60e1f6bf1f781e11662fa39`；单次 create 返回后只跟踪同 ID。官方 GET `2026-10-22T22:06:34.956627Z` 为 finished、error_logs 空；`22:07:15.622655Z` 的 latest 同 ID/同提交。原 b561 的 `400002552` / 无 release_id 保留为前次失败，不是本次 C 结果。 |
| 实际前端执行 | `2026-10-22T22:19:54.852Z` 原 Host 已登录浏览器的实际 DOM 显示完整 C 提交；不是本地产物或静态文件推断。技术运行 PASS 与 candidate reader `VERIFICATION_PENDING` / 7 个 blockers 分别成立。 |
| 实际后端 Response | `2026-10-22T22:18:46.552Z` 完整复制的原 Response 显示 C、`SERVER_BUILD_ARTIFACT`、PASS，server build time `2026-10-22T21:59:39.801Z`。实际 XHR 网络状态是 HTTP 304 Not Modified，属于缓存协商，未改写为 200。直接导航 API 曾因缺 CSRF header 被拒绝，未改安全策略。 |
| 原应用 OAuth | 用户已批准 device/offline 范围，单次授权后 `loginActuallyVerified=true`，后续同一登录 session 完成实际 C 运行页面核对；追加授权点击 0。不把这次登录扩义为全部 Native/Review 调用者已接通。 |
| 原获权对象独立读回 | 官方 CLI user/RLS 的两次准确单 SELECT 分别于 `2026-10-22T22:22:24.430431Z`、`22:22:24.581662Z` 返回，各 1 行，全部选出字段与发布前原获权对象一致。准确工作/版本/修订、Overall 消费与不可变 artifact 对应；正式采用 false。无新模型、SAVE、持久化成果或业务写入。 |
| Native 恢复 | 原 c234 安装 132 文件/Ready/必需自测 422/422 的原回执保留。已审原样 helper 单次恢复成功，状态 `ORIGINAL_ENABLEMENT_RESTORED_WITH_EXACT_HOST_SUBSTITUTION`，精确 C/release；原安装仍记原 b561。`2026-10-22T22:27:45.950Z` 完整 16 项读回仅 C136 enabled，其余 15 项 disabled，全部 running=false。原脚本/helper、配置与备份一致，单次 enable exit0。未重装或重跑产品测试，不以恢复代替业务验收。 |
| M3 实际页面 | `2026-10-22T22:25:50.013Z`—`22:29:53.994Z` 原 Host 已登录同一事项，分析过程/动态→流程实际 3 节点、2 条 SVG 路径（JobAid 调查、综合建议、TDMS 公司记录）；工作修订 1、SUCCEEDED。准确保存工作/资料版本与原获权对象一致，Overall 实际输入指向同一当前工作，两个原引用导航均进入综合评估。仅 1 次正常只读刷新，Host client readback `22:28:31.607Z`，无诊断读取错误。该页源 C 由稳定真实 runtime proof 绑定，不声称页面另有独立指纹。 |

Host 原始包在本地忽略的 `tmp/source-clarification-evidence/host-de091c3-release/`，operator attestation SHA256 为 `0fc898be8990bd566e7cab66cf75be8e6a64c5b3850c405cd9074b30dc6fdcc0`；官方跟踪记录在其 `readonly-release-followup/`，两个对象的私有摘要为 `existing-authorized-readback/summary.private.json`。Git 仅登记脱敏结果、准确技术提交和证据路径，不含真实业务对象或正文。独立 P2 已接受本批 C 运行包；Native 单次恢复及完整调度读回的安全摘要由原唯一 operator 回传，原会话已 completed、is_streaming=false、queue=0，未追加验证或操作，不等待后续自然业务运行。Native 最终索引为 `tmp/source-clarification-evidence/native-c234-host-de091c3-restore/actual-restore/16-restore-terminal.json`（SHA256 `920360662e4d049c9fd5eb43284f40f8e2f87a71e0df64fb2022d6e484d85d97`），原 complete 与完整 cron 读回分别为同目录 `13-complete.readback.json`、`13-cron16.readback.json`，只保留私有原件。M3 脱敏摘要 `m3-existing-object-browser/technical-summary.public-safe.json` 的 SHA256 为 `a2ff90046e3396ff7fb1894e9e95e2b6f4578270acfddaaeb2f697c6601cc486`。实际视口截图存在于原 operator 工具回执，私有 DOM 已持久保存；没有另行 PNG 文件，不补造截图路径。

M3 本次验收只覆盖同一存量事项的读取、准确引用与导航/刷新，不证明新生成或新保存。Overall 尝试集合未由读模型提供；TDMS 节点当前有效性 UNKNOWN，最新性/全覆盖未提供，当前工作可核对的已保存原生证据为 0（不证明从未读取）；Ready、首次可读与 ACK 时刻未提供。runtime reader 原有 VERIFICATION_PENDING/7 blockers 保留。这些缺项与 C 技术发布、M3 只读技术验收分别成立，不能用新鲜页面时间补造历史业务时间。

本地 Estimated 的实现仍为 761 / 作者 ff0，真实隔离 PG 19/19、关联单测 244/244 与非作者 Astra 接受范围保持；准确 81 的正常完整生产构建及双端 immutable sourceCommit 继续沿用。本轮在 0bc 之后只更新记录与生成快照，不重复已通过的业务测试或构建。M1 v1.6 稳定 ID 不变；M2 明确区分已运行 C 与未部署 Estimated，旧证据保留原 source/time，M3 只登记实际父响应投影与真实浏览器观察。

剩余工程范围仍是实际 TDMS Source/grant/processing set 与在线状态刷新、未结构化撤销/取代解码、准确工程原文 V44、独立 Review/Native 调用入口、真实 SEM 工程事实和内容级模型/SAVE，以及三类真实变化的最小消费范围。原 b561 技术授权、Estimated 批准语义和本次已完成的原应用 OAuth 不再列作待用户确认。


本次 C 收尾只在准确 `0bc2d1cc920d0ce2b7193e3abf17c9278d287a74` 之后更新 9 个记录/生成文件；未改产品、测试、依赖或构建输入，沿用准确 81 构建。受影响快照 QA 39/39、实际生成 HTML 的 jsdom 八条接线/P3＋company＋V53＋runtime 联合筛选和节点下钻通过，diagnostics 空；M1 的 13 节点/47 关系/54 场景/10 规则目录完全不变。旧 115 条 evidence 的字段、source 和时间逐条保持，新增 C/OAuth/Native/M3 证据不冒充本地 Estimated 的线上结果。生成页检查首轮脚本误用不存在的 `snapshot.contractRevision` 字段而停在断言，改为真实 `snapshot.contract.sourceRevision` 后通过；原失败日志保留，没有改产品校验或重跑业务测试。日志为 `tmp/estimated-integration-evidence/c-closeout-snapshot-qa.log`、`c-closeout-generated-m2-check.log`、`c-closeout-generated-m2-initial-wrong-contract-path.log`。

### 2026-10-23 Estimated E/D 实际交付、运行与限定 M3 读回

用户已明确批准本批 Estimated 技术交付；以下均为实际动作或观察，不把官方发布、双端运行、存量阅读和新业务运行相互替代。

| 证据 | 准确结果与范围 |
| --- | --- |
| 公开 E 同步 | 准确 `800af5fc41b0d1d05048937fa8a0c79acd2a8c16`，原同名 `codex/source-clarification-public-20261023` 单条普通快进。origin `2026-10-23T00:46:23.565947Z`、github `00:46:50.543099Z` 分别 ls-remote 读回精确 E。没有推 main、force 或其他 ref。 |
| 私有 D 同步 | 准确 `062e3ab3d10b29a88add508929625e9a76e4064f`，只向 origin 原同名 `codex/host-estimated-release-20261023` 普通推送，`00:47:22.342322Z` 读回。D parents 为 E 和当时核对的 origin main，完整 tree `de51001b79b422456a99fc9ec5043ac1ac79d7e9` 与 E 相同；私有 main/D 历史没有进入公开对象库。 |
| 数据库边界 | 官方发布前 dev→main preview `changes=[]`。本批没有迁移或 DDL；后续 Review 的本地 lock-only policy 不在 D 中。 |
| 官方 release | 只创建一次 `7699657613396610040`，`00:47:39.842958Z` 返回 publishing；随后只跟踪同 ID。`00:50:41.421538Z` exact GET 为 finished、准确 D、error_logs 空，`00:51:00.751345Z` latest 同 ID/finished。发布期间曾返回旧 C commit_id，仅终态用于 D 证明。 |
| 实际前端 | 原已登录 tab 在正常重载后，`00:51:36.125Z` 实际 DOM 显示完整 D，frontend build time `00:48:12.647Z`；不是本地静态产物推断。原 UI 的 release/API 字段仍未知，不填入假值。 |
| 实际后端 | `00:52:02.562Z` 原生 Chrome DevTools 的实际 `/api/runtime-probe` XHR Response：D、`SERVER_BUILD_ARTIFACT`、PASS，server build time `00:48:35.102Z`，HTTP 200。没有直接导航 API、改 CSRF 或复制凭据。candidate reader 仍 VERIFICATION_PENDING/7 blockers。 |
| M3 与旧正文 | `00:54:12.233Z` 同一原获权事项显示 JobAid、综合、TDMS 三节点；工作修订 1 SUCCEEDED，综合明确消费同一当前工作。`00:55:12.538Z` 点击准确保存工作引用后进入综合评估，原工作修订 1/原保存时间及四问题正文可读，45 输入依据/45 已读来源引用可见；无新生成或保存。 |
| 单引用定位 PARTIAL | `00:55:26.933Z` 一条已保存依据显示原 sourceRef 与解析修订 6；`00:55:40.851Z` 导航到准确文档版本，`00:55:53.249Z` 两页受控 PDF 可读。页面显示“当前查询未返回这条依据”，当前渲染 units 未命中原 ref；后台请求/响应未取得，精确结构化定位未通过；未清除定位、扩大或重新执行来源查询。 |
| 刷新观察 INCONCLUSIVE | 单次“重新读取”后的观察超时；`00:57:07.185Z` 仍可见已读回、work 1 SUCCEEDED 与同版综合，显示客户端读回时间 `00:55:43.435Z`。没有证明点击后时间推进，没有重复点击，也不把该时间当历史业务事件。现成 Network 未捕获该源查询，参数/响应元数据未取得，不补造 HTTP 状态。 |
| Native 与业务边界 | 本批没有暂停、安装、恢复、重启或重新查询 Native；原 c234/C136 历史恢复证据保持其原时间。没有新业务任务、模型、TDMS READ、SAVE 或正式采用。D 不包含后续 ACK 浏览器读模型及 Review 两段本地候选。 |

原始官方/Git/运行回执与单引用私有诊断在忽略目录 `tmp/source-clarification-evidence/host-estimated-d062-release/`；M3 脱敏摘要 `m3-existing-object-browser/technical-summary.refined.public-safe.json` SHA256 `9b1d58c47f7f2a62c6fc6e48b2a55698a86356ed94b84608a02ed2cbbf2858c0`。准确 sourceRef、业务对象、原文、导航 query 与未捕获项仅在 private receipt 中；真实截图在原操作工具回执，没有补造 PNG 路径。浏览器观察超时仅作观察诊断，不等同授权失败、发布失败或未知动作被重复执行。

接线、测试、部署、运行继续分列：Estimated 产品沿用已接受作者 ff0/集成 761、19 个真实隔离 PG 与 244 个单测；准确 81 的唯一完整构建及双端 immutable 构建归属保留，477/477 为依赖处理数、不是测试数。本批产品/测试/构建输入未改变，不重复产品测试或构建。M2 快照目标是实际部署 D，旧证据 source/time/hash 原样保留，新证据只覆盖其真实技术范围；冻结 HTML 的组件逻辑不改，后续 M2 测试显示小修不混入 D。

TDMS 节点当前 UNKNOWN、最新性/完整覆盖未提供，0 条可核对保存 native 不证明从未读取；Overall 尝试集合与 Ready/首次可读/浏览器 ACK 字段仍不可得。本批不证明 Estimated 路径已处理真实 Source/grant/processing set 或状态刷新，也不证明原文 V44、原生未结构化撤销/取代、SEM 工程事实、新模型/SAVE 或正式采用通过。精确结构化引用缺口交有限代码分析，不能被准确 PDF 可读掩盖。

本次记录校验：仅 9 个 docs/JSON/生成 HTML 文件；M1 的 13 节点/47 关系/54 场景/10 规则目录和原 125 条 evidence 值均保持，新增 8 条只覆盖本批实际范围。快照 QA 39/39；实际生成 HTML 的 P3＋company＋V53＋runtime 和 P0＋research/Overall＋V12＋runtime 联合筛选、节点/关系到准确 binding 下钻通过，diagnostics 空；公司真实运行仍“尚未核对”，调查/综合按实际显示“失败 / 通过并存”。冻结组件源码和嵌入快照一致，没有混入后续 M2 显示修复。私有检查首两次分别误期望旧失败标签和未展示的类名，原断言失败保留；仅校正为真实混合标签与既有 consumer 字段后通过，未改产品或证据来迎合检查。原始 QA/生成页日志在同一私有发布证据目录。


### 2026-10-23 资料库评估融合 UI-only 可审候选

本节接续生产 D062 的真实记录，不覆盖前文。当前只准备本地下一批：公开安全基线 `c8a27a22dd21286e7078d4992ea40776bb81031c`，产品组合 `bd6e5b3cb110d19635c7d537672f7d8f346db14e`。按顺序正常选择 locator `62540a75130d31458f2aed3c7348d4280f5d7bcd`（等价已审7673，不重复引入）、UI `139c0a842d1b791d3c79d7e656d416fa09229e2e`、最小修正 `26f505db3558ccca16cc04b43037145a212d2b6b`、CSS `3e790ffffd42c9af0c781557ae516164ba70fbd1`，再选 M2 显示 `be986c0f4800281afdff40b714486f87140406eb`。原父2ed6私有历史不进入公开对象库；正常cherry在私有中间clone完成，再只按公开可达分支正常clone。公开组合的21个UI blob与3e790、M2两文件与be986完全相同。

依赖核对：c8→作者父基线仅有 WorkItemRuntimeDiagnostic、useJobAidWorkingRead 和 shared JobAid 接口的可选ACK差异；新UI所用API/props已在c8，完全不依赖ACK。server/shared/openclaw相对c8字节不变；不夹带后续Host Review/Native、有界READ、c235或ACK新读模型。生产仍D062 / release `7699657613396610040`，其实际引用定位PARTIAL和刷新新时间未证实保持，不能用本地合成结果关闭。

|已接受验证|原执行源码/环境|本批适用范围|
|---|---|---|
|UI65：关联19＋真实新组件20＋原reader/Wiki壳层/返回26|139c0a，隔离React/JSDOM；原三个日志独立|四业务签、授权/撤权/late、真实草稿/动作门槛及壳层；不是65条端到端链。|
|UI最小修正5|26f505，隔离React/JSDOM，仅新增命名用例|Overall自身状态、原文pending→ready、保存3→4保留真实实例与合法Wiki guide来源返回；不冒称浏览器驱动了两个转换。|
|locator19＋原reader3|原7673正常hook；隔离React/JSDOM|实际已保存正文按钮/callback与固定旧run/unknownref/foreignrun。旧401/403/404三例未到断言，不计通过，不修旧mock扩范围。|
|M2显示25|be986，隔离JSDOM|测试实际环境与部署目标分开，source/contract仍严格；applicableProductRevision仅解释，不自动点绿。原失败和中性物理目录修正日志保留。|
|独立实际合成浏览器|26f505四签/草稿/M3/历史来源返回；3e790仅CSS受影响33..40；最后观察02:51:14.024Z|桌面1280×720、窄屏390×844、真实工程师说明草稿、准确旧run命中、受限返回及长正文滚动。原11排版FAIL经CSS修正后通过；原Vite旧serve和长rawCDP等待均保留为环境事实。|

合成浏览器完整交接 `private:/private/tmp/wiselink-document-assessment-integration-evidence-20261023/browser-review/42-final-browser-handoff.json`，SHA256 `96c8d0c316f8a8bf70adeb3980dca733592b0246f8771a6053845955ff6e216c`。真实源码指纹是3e790/treee53d，API与外部Aily/PDF wrapper隔离；不是真实线上运行。IAB全屏能力缺失、独立Chrome一次普通按钮not granted仍未验，不forceAPI/改权限/重试；原文pending→ready/保存3→4只有组件用例，不充浏览器观察；动态撤权、真实PDF/Aily与新业务动作未验。各计数按不同范围分别保留，不相加为整体覆盖。

M1保持v1.6稳定目录，在E.6及既有bindings增加准确 `document.assessment-reading` 消费记录；M2继续同一生成器、四列、工作包/接线/场景/缺口筛选与下钻，旧133条证据字段/source/time逐值保留。M3只挂现有父读取投影；生产Ready/首次可读/ACK缺项不回填。本轮新public组合只需正常hook、一次完整最终build及实际生成页筛选/下钻；旧受影响测试不无因重跑，原SHA/契约/环境与适用说明独立展示。

fresh origin main于 `2026-10-23T03:51:56.859360+00:00` 实际读回 `2bc6ac71b29720d622da4a6fcc11e14a027ff170`（准确时间见私有原回执）；其parents为旧02f和已批准D062，tree与D062/E800同为de51001b，无额外产品修改。首次只读ls-remote仅因sandbox拒绝既有凭据helper锁文件而未到远端；正常require_escalated续用同一已登录helper后成功，没有新增OAuth/身份/角色或远端写。最终私有D只增加该准确main祖先并保留公开完整tree。当前未构造最终D、未推送/发布；完整构建和收口回执将在后续纯记录提交补齐。需要发布的具体技术范围仅Host/UI＋M2显示，无Native、DDL、模型/SAVE/正式采用。


本批准确构建与记录收口：公开组合的首个9记录提交 `9d82629277a7f131ad42984119d6709b02fee060`，父 `bd6e5b3cb110d19635c7d537672f7d8f346db14e`，normal hook exit0 / 20.096s；配置内 ESLint、client/server类型和stylelint均按原机制执行，未跳过。实际公开目录 `/private/tmp/wiselink-document-assessment-public-20261023` 使用树内真实完整 node_modules，复制既有依赖、不重新install或解析；缓存 `/private/tmp/wiselink-public-build-npm-cache-20261023`，沿用 `/usr/bin/python3`。一次正常 `npm run build` 开始 `2026-10-23T04:01:25.170583+00:00`，结束 `2026-10-23T04:02:12.382451+00:00`，exit0，约47.212s。四固定子日志均本轮新mtime，分别原样归档到本批私有 evidence，无并发build混写。

双端 immutable sourceCommit 精确为 `9d82629277a7f131ad42984119d6709b02fee060`：后端 JSON buildTime `2026-10-23T04:01:49.898Z`，前端编译 AST 中不可变配置常量与 sourceCommit getter 绑定、buildTime `2026-10-23T04:01:39.790Z`；没有用Node执行浏览器模块或把静态产物当线上运行。依赖裁剪477/477成功、失败0，是依赖包数；构建后工作树干净。Vite既有MODULE_TYPELESS、大chunk及静态/动态混合import提示按原日志保留，无编译错误。原始 `11-build.log`、四子日志、`11-build-result.json` 与 `12-build-verification.json` 位于私有 `/private/tmp/wiselink-document-assessment-release-evidence-20261023/`。

本回执后只修改记录/快照/生成HTML，沿用该准确9d构建，不重复产品测试或build。M2目标为本地构建输入9d，目标Host环境用于未来部署；当前候选 deployment/runtime明确not_run，旧D062的真实证据保持原source/time/状态。新增原source测试的适用说明由已接受M2显示修复转义展示，不计入新SHA覆盖；构建只支持V30，所选多场景仍为部分覆盖。M1稳定目录及旧133条evidence逐值不变。本批仍没有推送、release、线上SQL/DBpreview、Native包/安装、模型/SAVE或正式采用。


本批记录校验实际通过：现有快照 QA 39/39；实际生成 HTML 的 JSDOM 载入原组件，9条接线，P2＋document.assessment-reading＋V03＋runtime、P0＋同接线＋V30＋deployment 联合筛选及节点→准确binding下钻通过，diagnostics空。当前接线为准确源码范围匹配，测试仍所选场景部分覆盖，部署尚未执行、真实运行尚未核对。准确9d本地build的环境与Host目标不同仍按新M2规则正确匹配；原139c UI证据保持其他提交/契约说明，applicability只显示不补覆盖，筛选不缩小7场景分母。13节点/47关系/54场景/10规则、原8条bindings及133条evidence逐值不变，新增document接线与11条本批限定证据。原始日志 `14-final-records-2.log`、`15-generated-m2-check.log` 及结构化检查回执保存在同一本批私有evidence目录。

公开后继仅记录上述实际结果；未执行新的Chrome/业务浏览器动作，直接复用独立最终42交接。公开E与私有D完整SHA/parent/tree/文件清单和同树、公私历史、敏感检查在最终私有handoff给出；公开历史不包含2ed6或private main对象。审批准备仅指这份准确Host-only代码及必要正式发布前读回，不代表已经得到本批推送/发布授权。上一批D062正式CLI回执作为历史参照保留，不能代替新批次的dev→main预览或实际运行。


### 2026-10-23 UI技术发布、持久恢复与定向只读诊断

用户04:32:44Z批准本批UI技术交付后，准确公开E `4dec7c64f4b91013615244049a38458e98507c37` 分别同步origin/github同名 `codex/document-assessment-public-20261023`；私有D `e1d2d92a2e58fe752ed3f70f472619f4373ef8d5` 仅同步origin同名 `codex/host-document-assessment-release-20261023`。两者完整tree相同。官方release `7699717588535888913` 的原get在04:41:03.899610Z确认finished/D/error_logs空；恢复时05:45:06.526161Z仅查同ID一次，仍相同。原真实前端D build04:39:09.945Z，原生Network实际XHR200的后端Response为D/build04:39:31.016Z、SERVER_BUILD_ARTIFACT。未重复发布。

原真实只读观察04:49–04:54Z：四业务签、3个调查问题和独立Wiki可读；M3显示真实JobAid/Overall/TDMS三节点、保存工作1/SUCCEEDED与Overall同work消费。输入修订5不冒称保存工作5，TDMS UNKNOWN/0条可核对已保存原生证据不等于从未读。10→11→12保持准确历史parseRun/full SourceRef，到结构化原文第8页再回investigation/assessmentScroll686与受限任务快览query。原11右栏HTTP500和13 Aily灰白是独立未通过项；结构化原文定位/返回成功不将它们点绿。适用性/config局部OFFICIAL_OAUTH_SESSION_REQUIRED及暂无法核对已保存评估继续保留。

恢复时原系统tmp目录不见，按项目持久目录 `tmp/wl-ui-delivery-restore-20261023/` 重建独立检出。公有E只从公开GitHub单分支取对象，未复用私有对象/alternates；私有D由origin单分支depth2恢复，准确parent/tree核对。D首轮HTTP/2流断连exit128原回执保留，确认失败后仅命令局部HTTP/1.1重试成功。原Codex持久日志逐行复制128条UI/根工具事件、134个文本块和6个图像块（含重复13）；6份JSON仅恢复原终端显示的内容，不能声称丢失原文件字节已还原。原PNG/DOM/AX仍缺失，工具JPEG显示副本与来源行号/哈希已独立记入私有索引，不用摘要冒充原件。

新定向只读诊断不重做已通过链路。05:56:50.939Z同一批准AD正常GET original，实际200/application/pdf、208087字节、%PDF-1.5，05:58:05.541Z受控PDF reader11页/第1页canvas截图可读；历史500原因未获，不归因OAuth。Aily保持ENV_UNVERIFIED；05:58:31.820Z挂载1355×661.75 iframe并GET，05:59:01.822Z确切console报SDK非阻断Iframe ready timeout，05:59:11.521Z读回该警告，原生AX/截图仍灰白。后续同次请求CDP在06:00:14.923Z遭Browser Use paused-document-response工具guard，未获iframe终态，不能归因网络/CSP/权限或排除工具混杂。SDK0.0.12的resolve不是ready，沿用既有SDK/授权，不造新协议或自动登录。06:03:03.838Z工具提示用户改变Chrome状态后停止操作；未追加加载、聊天、模型、SAVE或正式采用。

此后仅更新8个协调/验证记录及由既有生成器导出的同一M2 HTML/snapshot。原9d正常hook/完整build、70/19/3/25测试保持原source/contract/执行时间，没有重跑产品测试/build；原144条证据逐值保留，新增本批发布、历史观察、恢复与定向诊断，失败/inconclusive独立。M1稳定ID与旧接线不变，M3继续父读模型投影。私有业务对象、原响应、trace和像素仅在恢复证据目录，不进入公有记录。当前UI正式发布与这些records后继的Git同步分别记账。

### 2026-10-23 ACK、Review、Native 源码恢复与新制品准备

当前正常新源码 `16b727a3a440d9c164cbbc6c29a97836229709dc` 的父提交为持久 Source126 `1261762d45f41b148d21d20775427fb70f3c3a6a`，tree `93c76d13637de125f9ea128e5a8f5da287ef8123`，107个产品/测试/迁移变更文件。正常pre-commit按原配置执行lint/类型/stylelint，未旁路。本记录以已接受UI E2/D2最新八文件及其M1基线串接；已发布De1d的正式release、四签/M3/Wiki、原文定位与后续PDF、Aily失败范围不变，155条原evidence逐值保留。E2/D2只记录Git同步，实际线上仍De1d/release7699717588535888913。

恢复逐条使用原成功FileChange、可证明纯文件文本写入和原binary diff，未执行旧shell/DB/网络/测试来冒充原运行。ACK e9全树相等；SAVED ab5a在原Native02d投影后全树相等；BOUNDED 47文件原diff SHA256 `6e6998582a070aac5b9286bfff7728f3793df305dbe142588c991d999405000e`、status三文件 `c11ce5ca4eecd615df0a706d388e9736e0e3a82521e050095e782327a70f478e`、最终ae025两文件 `154819376538ac772c6aa57f8a734fb0f3dcda32a00f8ceda7d0b717a9f79a05` 均与原输出逐字节相等。Native141文件精确子树 `f9bece5ba22765af5f24bd5f6798607355a94bf4`；UI21和M2两文件等于已接受blob，并保留e9的两个客户端/一个shared ACK变化。Root独立复核107物理文件hash/bytes/blob/mode。旧53d整树及其九记录没有伪造恢复，当前是准确源码上的新提交映射。

|范围|实际消费者与验证边界|
|---|---|
|ACK e9|可信receipt一次读、授权projection准确tuple/hash/bytes；四字段独立原请求ACK，父hook出现/替换/null；旧ACK可与较新inner状态并列，无历史首次可读回填。|
|SAVED Review ab5a|真实UPDATE_ASSESSMENT、正文前Source/own-approval、opaque caller/handed TX；原保存carrier复用，工作与Review receipt原子APPLIED/UNCHANGED，browser/summary同版工作。|
|BOUNDED Review 2e4d及status0d13|真实operationRef冻结十键context；READ审计receipt/准确journal先于packet，后继Overall自己的attempt/lease与准确Review work；COMMITTING拒普通迟到活动。|
|Native b972/c235与最终ae025|正常consumePendingReviewTurn/driver封存恢复，无替代runTurn；ae025仅使新Host READ响应保留strict raw carrier，通用registry及Native guard不改。|

|原验证|原实际结果与范围|
|---|---|
|unit005/006/007/008|分别3suite/39pass、13pass/78显式skip、3suite/60pass、1pass/61显式skip；范围重叠，不累计为互异案例。status修正另19pass，非重复PG。|
|PG021|17子场景加外层18pass；BOUNDED READ/journal/APPLIED/UNCHANGED/browser/summary/admission/status/control/current-source/cutoff/max=1，早于sealed-expiry扩展。|
|PG024/025|各5pass/3fail；各自已接受的UNCHANGED及SAVE/丢响应恢复子场景保留，旧失败不删，fixture问题后续修正。|
|PG026|6子场景加外层7pass；真实进程内注册handler/受限角色/handed max=1，自有隔离PG，合成Gateway；原receipt跨permissionRevision拒绝、后继CAS前后构造过期、准确fence/journal且无续租。|
|PG027→028→ae025|027未到过期恢复便REQUIRES_ATTENTION；028真实READ已成功，原Native guard拒raw/display形状额外locator:null，不能称恢复通过；ae025是该新endpoint的窄修复。失败日志SHA分别60e6537a1f3d0c85260934560e2fde61122ba4a06429144c8284490ab3dd9594、9cb5a36907c5e1688ea770c4644d6ede77c2f72579d8df32f838c6eee9b2f136。|
|最终PG029|5子例加外层6pass/0fail，日志SHA a0f790a06dd9a951ad0155b042299799445b99ae7fa8a7541d3c1a32fc5a6742。真实正常consumer和handler、自有受限隔离PG与合成模型边界；原回滚→同checkpoint后续trigger一次准确封存SAVE落地/终态响应丢失→再一trigger同payload对账SUCCEEDED→IDLE。|

PG029初次模型wrapper1、合成Gateway2、Native READ1；commit共3次，分别原调用和两个后续独立获权trigger各至多一次，不在单trigger内重复。三个resultJson逐字节一致并匹配封存hash；原回滚不留新工作/Review receipt，最终只一份新工作。恢复不再模型/READ/context-body/heartbeat/cancel，receipt/journal不增长。原17个checkpoint准确字节曾由实际P2核对；现共37个原文件本体丢失，仅保留原manifest与校验输出，不建同名假原件。较早handoff的“normal consume pending”只代表较早时点。

PG024/025/026/029的expired由隔离fixture管理员UPDATE既有lease_expires_at/deadline_at到过去构造，未等待生产30/60分钟自然TTL。55.662/85.902/54.666秒和PG029 82.848216958秒是整用例耗时。lease/token/generation/deadline/journal/hash不变断言从fixture UPDATE以后算；原终态清理可以清token/lease expiry。原Source撤权后重授权改变permissionRevision，旧receipt保持拒绝。原测试不重跑、不移植执行SHA/时刻/契约到16b；未知原执行时间或精确执行commit在新索引保持null，以已审源字节及独立适用说明连接。

丢失旧dist/ZIP后，在clean16b一次正常 `npm run build`，开始2026-10-23T06:30:37.019266+00:00，结束06:31:26.761553+00:00，exit0；wrapper49.744秒，脚本打印46.142秒。真实完整node_modules只从既有依赖复制，没有install/重新解析；缓存沿原npm配置。四固定子日志均本轮新mtime，依赖裁剪477required/477copied/0failed，是包数。后端immutable sourceCommit16b/buildTime06:30:58.379Z；前端编译AST确认不可变配置常量及getter绑定16b/buildTime06:30:47.383Z，没有执行浏览器模块冒充真实运行。22条非致命tsconfig-paths诊断都指向候选外历史工作区，连同MODULE_TYPELESS、chunk/annotation/import提示保留，未压警告、改配置或重build。

同一clean16b正常 `node scripts/package-wiselink-openclaw-skill.mjs`，06:34:49.538706–06:35:04.086048Z，exit0，含publisher自身必需skill检查；不凭无输出推算测试条数。新 `wiselink-research-and-synthesize@r09.c235` 包1,050,216bytes、141文件、SHA256 `992f83b0bdf3338ee0db27dfc99a1c8bbfa69b3db06d8fdb71f079b09ef538d9`，manifest/source/git subtree相符，Root独立逐项bytes/SHA及CRC通过。ZIP本身未编码Unix mode，Git/物理source mode另由恢复证明；首次额外核验误要求ZIP属性mode而失败的检查保留，没有改包。旧53d包94e924c4…仅留历史核验，不能把新包冒称旧原件。本轮不重复产品全套测试。

三policy原SQL `migrations/candidates/tdms_review_saved_context_locks.hosted.sql` 仍未实施：review_conversation、identity_subject_mapping、assessment_work_revision的UPDATE USING复用actor/tenant/active mapping，WITH CHECK(false)，无新增GRANT/ALL/definer。一次正式CLI只读catalog06:32:26–06:32:29Z成功，四个目标角色/表组合存在、三表RLS=true/FORCE=false、目标policy全缺、对应可组合permissive UPDATE/ALL=0；没有读取业务行、加锁或执行DDL。SQL自身保留相同前提检查，实际DDL须独立授权。

Native最后已证实安装c234；当前安装/cron/inflight尚未完整获准预检，开发会话streaming=false/queue0不等于runtime空闲。交付前需正常取得这些当前读回，再明确收尾在途和一次跨端切换，保留真实工作、原件与检查点，不改别的job或直接写业务JSON。新Host后端推送/发布、Native安装、调度写、DDL、真实模型/READ/SAVE未获本批授权；准备及本地检查不算实际动作。P1 SEM工程事实、P3真实Source/grant/set/在线刷新和未结构化撤销取代/V44、P4真实反馈、P5真实变化与内容验收仍按既有缺口继续。正式采用/Review确认始终由Host决定。

恢复与新制品证据仅位于项目忽略目录 `private:tmp/recovery-20261023/host/`：FINAL_RECOVERY_HANDOFF、原阶段diff/manifest、原日志抽取索引、正常source hook、new-artifacts-16b727以及preflight-17b。新时间只表示本轮恢复/记录/构建/打包或真实只读查询；旧观察原时间/source/状态不变。M1附录E.7只补实际链路职责，M2继续九binding/四列和原155证据，M3不把客户端观察时刻当队列ACK或首次可读事件。

本轮仅针对记录变更验证：既有snapshot QA 39/39；实际生成HTML在JSDOM载入177条证据/9条接线，P3＋company＋V53＋deployment、P0＋save.finish＋V08＋runtime交叉筛选及节点/关系到准确binding下钻均通过，diagnostics空。接线显示源码范围匹配；旧测试缺执行版本/契约和新build的执行时契约差异可见，适用说明不计当前覆盖；部署/真实运行仍分别尚未部署/尚未核对。筛选不改selection，13/47/54/10目录及155旧证据逐值不变。正常生成时间是本轮时间，不替换原观察。产品套件与build没有为该记录变化重跑。具体回执在private:tmp/recovery-20261023/host/records-preparation/，当前九文件差异先交Root审阅，尚未提交或同步。


### 2026-10-23 已获权 OpenClaw CHAT 的主线集成与构建

产品提交 `251941f4fda4d515909208efd842610246661adc`，父 `8d0ff7f5f5bacc86ecbe1aae3e802312b207a833`，tree `142c2636f555d5c0a1b8d31675954820657f285d`，正常 hook 通过且构建输入干净。已接受作者 `0fd28f3d5514a9187fa67c39cd1e19e4d0854492` 的 6 个 Review 前端文件和 4 个测试用完整 binary diff 选择性移植；git apply --check、最终十文件 blob 逐字节一致。client/server/shared/test/scripts 及构建配置与作者原基线对象一致，实际消费者无需接口适配；作者私有提交对象没有进入公开检出。

资料库 `DocumentAssessmentReview` 与既有获权 WorkItem/Matter 进入同一 `ContinuousReviewPanel/ReviewChatComposer`，普通 CHAT/AUTOMATIC 和更新评估分开，保留 HTTP 短轮询、准确来源和历史。未知发送仅按原 requestId、正文、会话和范围对账；同会话 STALE_CONTEXT 仍需 Host 当前 owner/OAuth/executor 能力。CLOSED/空/换会话通过显式操作保留结果未知记录，不复制、自动重发或自动创建新会话；草稿仍仅页面内存，身份/对象切换隔离迟到响应。

初版 fdf 的原 59 个不同定向用例按原三次日志解释保留，原首轮措辞断言失败及后续修正不删；后继 0fd 的 31/31、3 套件于 07:43:03.541821–07:43:13.999794Z 通过。两批范围重叠、非相加，未重跑或移植执行时间/未知执行 SHA、契约。原报告以最终作者提交映射受测文件；本次只在全部接受 blob 和未变消费者一致的范围附适用说明，不计为新提交测试覆盖。

本次正常 `npm run build` 最终于 2026-10-23T08:38:50.595713+00:00–2026-10-23T08:39:33.655043+00:00 exit 0，wrapper 43.066 秒；四子日志均 fresh，477 required/477 copied/0 failed 是包数。server immutable sourceCommit 为产品提交，buildTime 2026-10-23T08:39:08.049Z；client 编译 AST 的不可变常量及 getter 同 SHA，buildTime 2026-10-23T08:38:57.777Z。22 条候选外历史 tsconfig 诊断连同其余非致命提示原样留日志，不压警告。首次沙箱 DNS 在 init 失败；获准联网后第二次在 NFT 检查拒绝树外依赖 symlink；将原已备依赖 APFS 复制成检出内真实目录后，第三次正常全量完成。两次失败分别保留，未改 pipeline 或削弱检查。

只更新 M1 E.8/E.9、本记录、M_INTEGRATION 顶段和六份既有 runtime-monitor 输入/生成文件；原 184 个 evidence 对象逐值保留，新增八条限定的源码、两批原测试适用、本次技术构建、未部署和未运行记录；当前目标下新Aily的源码适配/测试仍显式not_run。M1 目录仍 13/47/54/10，新 Aily binding 仍 planned/null；历史 Aily 失败保留原时间范围。另按本次只读观察，在现有对话方案补充官方连接器、工作身份 HTTP 与 MCP 渠道的能力/限制一段，实际能力仍未连接。生成 HTML 初次核对发现目标源码/契约更新后旧 Aily not_run 显示为历史范围，失败回执保留；补两条当前范围 not_run 并关联当前未部署/未运行记录后，仅重生成改变的输入，同一 JSDOM 筛选与节点/关系下钻检查通过、diagnostics 空，不称浏览器视觉验证。192 条是证据目录条数，不是完成度。M3 继续实际父级投影，不由记录或本地构建造业务状态。旧 16b build/c235 包保持原来源，没有重打包、推送、发布、远端安装/DDL 或真实模型/READ/SAVE。
