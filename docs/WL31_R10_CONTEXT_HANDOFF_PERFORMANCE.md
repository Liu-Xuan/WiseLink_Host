# R10 评估包交接与响应优化

日期：2026-09-05。用户要求：评估包等信息交接和使用要稳定、高效，常用前端路径达到秒级响应、尽量没有可见加载。

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
- 保留挂载的复核和适用性面板在实际 revision 变化时重读。跨节点已访问面板的保活 C 另批由前端主控实施，尚未发布；不在首屏挂载所有重型面板。

## 本轮核对范围

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

当前 `c20` driver 仍以 requestId 派生调用标识，程序预读资料并强制一次候选输出；能力存在不代表产品已经使用。下一实现复用 Host 持久化的 `openClawSessionKey`（仅控制面，不入模型提示）、当前授权及既有 `read_source_refs`，按任务需要读取片段并回传实际结果；权限/材料范围收缩时不能携带已无权读取的旧会话内容。原生 wake/订阅接口存在，也不自动意味着 Host 已能从云端安全到达 Gateway；60 秒领取路径尚未替换。

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

本批不以性能工程取代 R10 连续评估主线。旧对象恢复、稳定授权会话、按问题取证和实际页面候选往返仍须完成；当前 60 秒领取周期也不等于秒级启动。
