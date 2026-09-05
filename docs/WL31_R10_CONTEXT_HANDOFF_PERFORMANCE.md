# R10 评估包交接与响应优化

日期：2026-09-05。用户要求：评估包等信息交接和使用要稳定、高效，常用前端路径达到秒级响应、尽量没有可见加载。

Git 同步授权更新：本页前两批历史推送不符合当时的 main-only 限制；用户随后明确长期允许向 `Liu-Xuan/WiseLink_Host` 非强制推送项目相关 `codex/*`。第三批 c22 的 `7a9b9c4b7` 已在该授权下使用单一同名 refspec 快进两个远端；main 分叉只暂停 main 镜像。详见 [授权记录](WL31_GITHUB_SYNC_BOUNDARY_20260905.md)。未删除分支、触碰 main 或使用强推。

当前设计要求已写入 [R10 §10.6](https://hv5zjf4j8yb.feishu.cn/docx/MA3fdjEycoISjHxptAqcsyxvn9b#doxcnABcGL9dWjaOu9ogEAbWzje)。这些是迭代目标，不是新 gate，也不是当前已达标声明。

## 已有真实耗时与原因

旧文件仍可读时，2026-09-05 13:57 的成功请求 Trace `5fa0e6824ca52cb357084f6d5d635d5f`：

| 范围 | 观测值 |
| --- | --- |
| 浏览器 app_web 的 document-parsing 请求 | 7955 ms |
| 网关 | 5696.56 ms |
| app_server | 5662.86 ms |
| 4 次已记录 SQL SELECT 合计 | 27.55 ms |
| 文件操作 | 3 次元数据 + 3 次下载 |

第一次下载结束至下一次元数据开始间隔约 4.35 秒。Trace 没有为这段细分 U0/Python 子进程跨度，不能把全部间隔直接归因于单一函数；实际源码确认页面在这一链路执行完整 U0 校验，校验器会启动 Python 环境核对及完整解析校验进程。这是一条成功样本，不是 p95 数据，也不是 14:01 之后旧文件不可读请求的健康证明。

源码中的确定性额外工作：

- `CanonicalHostVerticalService.page` 原先先 inspect 整包，再为 query/SourceRef 再读同一整包。
- `PythonU0FullPackageValidatorAdapter` 原先每次重新启动严格校验，即便同一部署中刚验证过完全相同的内容。
- `CanonicalHostEngineerReviewService.pageContext` 原先经 dynamic items 检查 ledger，再次读取 ledger；每次 ledger 又把附件字节先读一次、再读一次解析。
- 前端普通刷新清空 pageData 并卸载整个工作台；Overall 成功回调忽略已 fresh-read 的 response 后再次整包读取。tab 切换本身不总是重拉整包，不能笼统归罪所有切换。

## 第一批实现

Host 优化 `72b9c156f` 与前端 A+B 已集成到 `3903eb6c1`，发布 `7681981887993253150` 已 finished，精确 commit 为 `3903eb6c1789e9aace2b3aed1187f3d29bba01f8`，error_logs 为空；origin 与 github 同步。Host 本批实现：

1. query 从同一次 readback 获取来源类型；SourceRef 使用同一次读取/校验/解析返回 metadata 与 units。
2. 完整校验结论在一个 Python validator 实例中有限复用（最多 32 项），同内容并发合并。复用的是证明，不是文件内容、用户权限或业务状态。每次仍核对既有 manifest 与实际字节；新内容、新实例重新校验，失败不保留。
3. pageContext 并行读取不同材料，同次组合只读取一次 ledger；附件从同一份已读字节解析。原有条目、附件和版本匹配条件未删除，只有重复 I/O 被合并。

未改变 shared/browser DTO、数据库 schema、MCP 或 Skill，不创建业务 Turn、不正式采用、不改变 WorkItem revision/current/STALE。旧文件如果仍不可读，Reader 在缓存校验之前就返回真实存储错误；不会用缓存复活缺失来源。

前端第一批 A+B 由 [WiseLink 前端与 v0.6 接续](codex://threads/01a06014-5282-7f90-91bf-12759224d211) 交付为独立提交 `8373a369b`，主控集成为 `3903eb6c1` 并发布：

- 同身份、同事项 pending refresh 保留现有内容、草稿和滚动位置，标明尚未确认最新状态；身份/对象/权限变化或读取失败仍清除，旧原文错误不视作缓存成功。确认、采纳与 Overall 写入在刷新期间禁用，草稿仍可编辑。
- Overall 已完成的 fresh DTO 在当前事项、query、无 SourceRef 选择且版本不倒退时直接复用；不匹配时读取当前路由对应内容，不加入变更前的 pending GET。
- 入场 handoff 仅在 lazy 初始状态解析，原 5 秒有效期不延长，不因随后本地渲染而重新应用/失效重拉。
- 保留挂载的复核和适用性面板在实际 revision 变化时重读。跨节点已访问面板的保活 C 在后续第二批发布，见下节；不在首屏挂载所有重型面板。

## 第二批：已访问面板保活与同轮按需取证

Host release `7682008054367685902` 已 finished，精确提交 `73561af4d37c8d6b8624f1bda9bbfb9587f86216`，error_logs 为空；origin 与 github 已同步。该提交包含前端主控 C 源提交 `e7733a175` 的集成 `1d65d01cd`：

- 首次访问才挂载正文、Reader/PDF、适用性、复核；返回已访问页保留 DOM、PDF 文档对象、页码/缩放、材料展开、草稿及滚动位置。隐藏面板暂停轮询、observer 与 PDF 渲染，不在首屏预挂载所有重型面板。
- 同一事项离开 Reader 不清空来源选择、不因此再次整包 GET；实际来源、身份、事项和版本变化仍按既有规则更新，授权/来源失败不靠保活掩盖。
- 主控 client type-check、面板/刷新 2 suites / 10 tests、前后端生产构建通过。前端独立临时 Chrome 组件运行 16 项检查通过；它使用真实组件及计数测试子项，不包含真实 Hosted 数据或 PDF 网络，不是线上 SLO。
- 本次生产主 JS gzip 为 590.11 kB，PDF 库已是独立 chunk 98.61 kB；既有构建警告保留。前端主控继续按实际入口依赖检查首屏拆分，不重复实施已有 PDF 动态加载。
- 发布后主控在已登录 Chrome 重新载入同一 SB 页面，仍为原文不可读、讨论版本 11、Turn 17 FAILED 和历史候选；未新建回合。正常面板路径和秒级首显仍不能用此故障样本验收。

同一提交的 Skill `r09.c21` 已通过既有 Publish Lite 流程原位安装到官方 Hosted，安装轮次 `7682008775905299661` completed。唯一同名、Ready/Visible，23/23 文件与源包一致；安装器额外 `.openclaw/source-origin.json` 单列。installed validation 105/105、consumer 3/3，通过范围均为离线测试，没有业务模型或新 Turn。ZIP 为 165803 bytes，既有 archive SHA-256 为 `1e696a3a2be4518c192386c20f12ebc8a44a6ccaa86b68ec2aa146a80d6e5203`。

c21 先交接最小上下文和允许的资料目录，由模型通过 `read_wiselink_review_sources` 选择相关片段；驱动委托现有 `read_source_refs`，把实际结果回传相同原生 session 后继续分析，最终仍通过既有候选 commit。每轮不再默认预读全部来源，同轮重复引用复用已读取值，后续请求只含新 tool exchange，不重复发送整包。model.result 保存实读批次，使中断恢复仍能复用原 checkpoint 的已读集合而不重跑模型。未改变 Host Task/Result/MCP、正式采用、权限或业务版本规则；不新增 hash、表、gate、队列或缓存框架。跨 Turn 原生 session 仍按 requestId 隔离，稳定跨轮会话与页面真实活动尚未完成。

## 前两批核对范围

- 既有 Reader/vertical/U0 普通测试 3 suites / 34 tests 通过。
- 本批校验复用、vertical、engineer-review 普通测试 3 suites / 36 tests 通过；随后增加单次 ledger 及实际来源失效用例，对应 2 suites / 16 tests 通过。测试集有重叠，不相加冒充独立覆盖数量。
- Server type-check、server build 通过。
- 集成 `3903eb6c1` 后 6 suites / 74 tests、client type-check、前后端生产构建通过；不是在前述测试数量上累加。生产主 JS gzip 约 589.56 kB，存在 chunk-size、模块类型和仓库外 tsconfig 扫描警告，未屏蔽，也未在本批扩改构建框架。
- 发布后在真实已登录 Chrome 重新加载 SB 页面，仍可读取版本 11、Turn 17 FAILED 及历史候选，旧原文依然不可读。因此本次线上观察只证明已保存内容/错误展示没有回退；正常 Reader 路径及 A+B 的线上时延尚无可用来源样本证明，不能写成已达到首屏 SLO。
- 使用真实本地 Python `/Users/liuxuan/miniconda3/bin/python3` 和已有 FTD 包 `test/fixtures/real-ftd-frozen2.unified-package.json`（662441 bytes），首次完整校验 440.18 ms；复制同内容字节的两次复用分别 0.57 ms、0.39 ms，均返回真实完整校验成功结论。这是本地单次小样本，只包含校验段，不包含线上存储、网络、前端渲染，也不使用 Hosted 的 Linux vendored runtime；不据此宣称页面已经秒开。

## 原生会话交接的核查结果

2026-09-05 官方 Hosted 管理核查轮次 `7681978437267442866` 读取了本机已安装 OpenClaw `2026.6.6 (8c802aa)` 的代码及自带文档。代码位于该 Hosted 实例的 `/home/gem/.npm-global/lib/node_modules/openclaw/`：

- `dist/http-utils-leZWdpma.js` 的 `resolveSessionKey` 优先取显式 `x-openclaw-session-key`，其次按稳定 `user` 派生，均无则随机；`openai-http-DJ7nlIMd.js` 将结果交给原生 `agentCommandFromIngress`。不是仅靠名字保存的伪会话。
- `buildAgentPrompt` 将 client `assistant.tool_calls` 和 `role:tool` 结果转成当前 run 的文本消息；工具结果必须真实回传。它是同一原生会话的新 run，不是服务端替客户端执行外部 Host 工具。
- 默认 Gateway 的纯合成测试轮次 `7681982751164517363` 三次有效请求分别为 11.08 s、5.70 s、4.31 s；第一轮调用合成只读工具，第二轮回传工具结果，第三轮只发一条新 user 消息仍准确回忆两个随机合成值，原生 sessionId 一致。模型耗时不等于前端响应时延。
- 该测试实际使用 `model=openclaw/default`、`agent:main:r10-native-diagnostic`，并非指定的 `wiselink-engineering`；只算 Gateway 能力证据，不算业务 profile 验收。首次脚手架把 CLI 告警当成凭据而得到 401，之后修正并重新运行；不能称全程无重试。未新建 Host ReviewTurn。
- 纠正核查 `7681985071637597370` 发现配置只有 `agents.defaults`、未显式配置 `agents.list`；命名的 `wiselink-engineering` 目录存在。不能由目录等同正式路由，也不能据此推断旧业务成功调用实际用了 main；还需核对命名 agent 的默认配置继承行为。运行目录相对旧 HEAD 有此前安装及运行状态差异，本轮有意写入仅合成测试文件；没有本轮前后文件快照，不能把旧 HEAD 差异都算成本轮改动，也不能声称独立证明所有业务文件零变化。

后续只读轮次 `7681987988713032924` 核对实际 `resolveAgentIdFromModel`、`buildAgentCommandInput` 与 session agent 解析：`openclaw/wiselink-engineering` 在 agents.list 缺省时仍解析为命名 agent，继承 defaults 并使用独立工作区/session store；不是回退 main。显式 session key 的 agent 段决定 OpenAI ingress 的实际执行 agent，因此 key 与 profile 必须一致。此轮未发模型请求或改运行配置；此前 main 合成测试的原因是选用了 default alias 与 main key，不是版本不支持命名 agent。

上述核查时 `c21` 已接通同轮按需取证，但不同 Turn 仍隔离；第三批现已按下面的 Host 授权映射接通跨轮延续，仍待真实页面验证。原生 wake/订阅接口存在，不自动意味着 Host 已能从云端安全到达 Gateway；60 秒领取路径尚未替换。

## 第三批：c22 跨轮授权会话已发布

功能提交 `7a9b9c4b784841af6e415eb71ac698ecc89a485f` 已分别非强制同步 origin 与 github 的同名 Codex 分支。Host release `7682054671425031353` 已 finished，精确 commit 相同，error_logs 为空；无数据库迁移。

- Host 复用现有 ReviewTurn/ActionAttempt，查询最近前序任务并保留 owner/tenant/actor/WI 范围。Drizzle 单语句 actor CTE 使用独立别名 `previous_review_actor_id`，不建立新连接、不降低 RLS，也不跳过最近失败回合寻找更早的成功会话。
- 只有前序 SUCCEEDED、同一讨论/事项版本且新核实的 SourceRef 与产物引用范围一致时，延续既有授权上下文。版本、材料范围或前序状态不适合延续时，从当前 Turn 主键派生新引用，再承接 Host 保存的讨论；不新增 hash 或表。
- `begin_review_turn` 的可选 `nativeSessionKey` 是控制面字段，仅由 driver 放入 Gateway header，明确绑定 `wiselink-engineering`，不进入模型/前端。每轮交接当前问题与上下文，引用仍须本轮实读，原生记忆不替代持久评估包或当前权限。
- c22 对新 Host 报告 `HOST_SCOPED`；旧 Host 缺少字段时保留兼容并明确记录 `TURN_ISOLATED_LEGACY_HOST`。新 Host 与旧 Skill 仍兼容，双方升级才获得延续能力。既有单轮 tool exchange、独立 Turn/request/checkpoint、候选 exact-once 和不确定结果恢复保持。

同名 Skill 先原位安装，管理轮次 `7682052334020758506` completed，再发布配套 Host；未改 Gateway、cron 或业务配置。唯一安装 Ready/Visible，23/23 源文件与 manifest 一致；安装器生成的 `.openclaw/source-origin.json` 单列。ZIP `wiselink-research-and-synthesize-r09.c22.zip` 为 168283 bytes，既有 archive SHA-256 `6c944988549fa6c85841b4deb6ea746d33b140c52363deef10615f2799ea7dd7`；私有飞书文件 token `KzUwbJJT3ojj5GxD5iwcyxzOn7g`，未设置公共分享或覆盖旧 ZIP。

验证范围：Host server type-check、4 suites / 51 tests、前后端生产构建通过；Skill 本地与 installed validation 均 107/107，consumer 均 3/3；技能结构检查通过。现有构建警告保留，主 JS gzip 仍 590.11 kB。独立子智能体复核被平台安全系统阻止，未产出结论，不算通过；未绕过或重复派发该复核。

浏览器扩展连接超时后，经原生界面读到原文不可读、版本 11、Turn 17 FAILED 与历史候选；刷新被用户切换窗口中断，未宣称新版页面完整重载或跨轮 UAT 通过。22:23 真实日志进一步确认三个旧事项均在文件元数据读取处失败。本轮对原桶既有新测试文档再次读取元数据并下载 498 bytes，未再次与最初文件逐字节比较；旧 PDF 名称查询为空。详见 [存储记录](WL31_HOSTED_STORAGE_INCIDENT_20260905.md)。无新业务 Turn、正式采用或 WorkItem 版本变更。

## 后续交接与读取形态

| 使用者/阶段 | 应交接内容 | 不应进入该路径的重活 |
| --- | --- | --- |
| 保存材料/工作判断 | 已完成写入的持久标识、版本、状态、结果引用 | 将临时签名 URL 或 Agent 会话作为唯一副本 |
| 工作台首屏 | 授权后的事项、版本、已有摘要/判断、真实执行状态 | 下载原文、重组评估包、等待模型或全部历史 |
| 阅读/定位 | 章节或 SourceRef 片段、必要译文/坐标 | 重读无关评估、timeline 和全部讨论 |
| JobAid/Overall/Review | 共同背景 + 本次任务视图 + 必要变化/摘要 | 每轮预读全部资料、重复发送所有历史 |
| 讨论更新 | 实际变化的 Turn/执行状态，历史另按需读取 | 每 4 秒重新拉完整历史或整个工作台 |

先复用数据库已有 `projection_json`、ReviewTurn、ActionAttempt 和 Reader 分页能力。需要持久化轻量阅读投影时，由现有 Host 写入路径同步维护、绑定已有版本，不做第二套前端真值或平行评估包状态机。短期预览凭据按需签发，与持久文件引用分开。权限/对象变化清除不可用内容，普通刷新保留旧内容时明确其状态。

正常已登录网络下目标：冷开核心内容 p50 ≤1 秒、p95 ≤2 秒；已加载同事项切换 p95 ≤100 ms；轻量状态读取 p95 ≤1 秒；普通刷新无整页空白。首次认证、首次 PDF、解析、云端领取等待、模型调查分别记录，不用假活动补齐等待时间。

本批不以性能工程取代 R10 连续评估主线。稳定授权会话及按问题取证已接线发布，旧对象恢复、真实页面候选往返与活动/材料回执仍须完成；当前 60 秒领取周期也不等于秒级启动。
