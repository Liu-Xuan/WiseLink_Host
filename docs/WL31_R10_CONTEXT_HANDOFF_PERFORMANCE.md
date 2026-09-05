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

Host 已在本地实现：

1. query 从同一次 readback 获取来源类型；SourceRef 使用同一次读取/校验/解析返回 metadata 与 units。
2. 完整校验结论在一个 Python validator 实例中有限复用（最多 32 项），同内容并发合并。复用的是证明，不是文件内容、用户权限或业务状态。每次仍核对既有 manifest 与实际字节；新内容、新实例重新校验，失败不保留。
3. pageContext 并行读取不同材料，同次组合只读取一次 ledger；附件从同一份已读字节解析。原有条目、附件和版本匹配条件未删除，只有重复 I/O 被合并。

未改变 shared/browser DTO、数据库 schema、MCP 或 Skill，不创建业务 Turn、不正式采用、不改变 WorkItem revision/current/STALE。旧文件如果仍不可读，Reader 在缓存校验之前就返回真实存储错误；不会用缓存复活缺失来源。

前端第一批 A+B 已交给 [WiseLink 前端与 v0.6 接续](codex://threads/01a06014-5282-7f90-91bf-12759224d211)，范围为同对象刷新保留已显示内容、消费 Overall 已完成的 fresh read、一次性使用入场 handoff。面板保活属于下一批；不让首屏同时加载所有面板。

## 本轮核对范围

- 既有 Reader/vertical/U0 普通测试 3 suites / 34 tests 通过。
- 本批校验复用、vertical、engineer-review 普通测试 3 suites / 36 tests 通过；随后增加单次 ledger 及实际来源失效用例，对应 2 suites / 16 tests 通过。测试集有重叠，不相加冒充独立覆盖数量。
- Server type-check、server build 通过。
- 使用真实本地 Python `/Users/liuxuan/miniconda3/bin/python3` 和已有 FTD 包 `test/fixtures/real-ftd-frozen2.unified-package.json`（662441 bytes），首次完整校验 440.18 ms；复制同内容字节的两次复用分别 0.57 ms、0.39 ms，均返回真实完整校验成功结论。这是本地单次小样本，只包含校验段，不包含线上存储、网络、前端渲染，也不使用 Hosted 的 Linux vendored runtime；不据此宣称页面已经秒开。

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
