# 第一批实施与隔离验证 — 2026-10-22

本批已完成实际代码、隔离验证和存量真实对象的独立只读核对。尚未发布本批代码；生产环境仍为 `6c073de7b6e1e2ce126cf46f405beade388a3639`，已由官方发布查询确认。没有新增生产模型调用、保存、审批或正式采用。

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
