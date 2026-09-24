# 工程知识目录窗口时序：观测批次

## 范围与基线

基于发布提交 `61b77ec4e0e642ec8a978a30768627d9956513b3`，发布
`7688949346146356153`。本批只提供解释窗口等待的证据，不计作性能优化完成。
不修改 SQL、取数策略、授权、当前/历史检查时点、错误优先级、重试和分页。

## 输出与采样

沿用 `ENGINEERING_KNOWLEDGE_CATALOGUE_PHASES`。每次调用的 finally 输出一次
摘要，包含 status、durationMs、candidateBatches、visibleEntries 和原 phases。
同步 logger 故障尝试发固定告警，不替换返回结果或原业务异常。平台强制终止进程
或请求时不能保证 finally 执行，不宣称失败摘要涵盖此类中断。

仅服务端环境变量 `WISELINK_CATALOGUE_TIMELINE=1` 开启详细 timeline；默认关闭。
启用窗口由发布 owner 控制，用于少量只读采样，采样结束关闭。不是客户端参数，
不改变任何授权模式。同一请求派生 scope 继承一次确定的采样选择。

时间采用同一请求的 performance.now 相对毫秒；不是 UTC，不与另一进程时钟相减。
context 只允许 windowIndex/rootSlot/readInstance/parentReadInstance/attempt/depth/
memberGroup 数字序号。实际读取分配 readInstance；缓存命中只产生 root_reuse，
其消费者槽位引用原 readInstance，不算第二次执行。批量查询只使用 window scope，
不归属于最后到达的根。递归实例通过 parentReadInstance 关联。

原 phases 的 count/totalMs/maxMs 继续累计（包括失败）。详细事件采用紧凑表：

- names：固定阶段名称字典。
- scopes：不可变序号上下文字典。
- events：`[phaseIndex, scopeIndex, startMs, endMs, outcome, participants?, skipped?]`。
- outcome 是 ok/error/skip/reuse，表示所观测调用或标记的结果，不等同业务授权结论。
- maxEvents 默认1024、最高2048；详细数据预算48000字节，超限记录 droppedEvents。
- windows 在详细事件预算外保留最多200个 `[windowIndex,start,end,waitOutcome]`。
  waitOutcome=ok 表示 allSettled 等待正常结束，不代表各根都可读。

日志不包含用户、对象、workRef、正文、SQL及原始错误文字。完整日志还包含 phases
和窗口摘要，48000不是整个日志的上限。平台是否进一步截断须在发布后实际读回验证；
无法解析的日志不能作为完整样本。

## 如何解释

current snapshot 前读、grant、identity、snapshot confirm 分别计时，重试有独立
attempt。saved member 阶段与 current 阶段分开，保留新鲜读取。通知 attempts、
saves 查询与同步 projection 分开；无 saves 查询不造数据库事件。

对 B1/B2/B4 分别记录参与/跳过到达、到齐、真实查询、分发；root 到达与跳过事件
关联根序号。首个 slot 到达至最后 slot 到达才是本阶段到齐等待，不能从创建 batch
时刻计算（其中混入了上游处理）。根 await 已包含到齐、查询和结果分发的等待，
不能再把共享查询耗时重复加到各根。

时间线只是已观测区间与依赖线索。没有覆盖的时间标为未归因；不能把端点时长减
SQL span 累计直接命名为网络成本，也不能相减两组中位数推定某阶段成本。
truncated=true 的请求保留在统计中，但不用于声称完整关键路径已解释。

## 发布后决策与验收

1. 核对发布回执、实际读取日志与详细开关。先取少量 ALL/空关键词/首页只读样本，
   确认21个根及少量递归的日志未被截断、窗口/根/查询关联完整；保留失败样本。
2. 查看阻止各窗口完成的阶段。当前成员身份若主导，才试验授权后原始行跨根合批；
   若通知、快照或已有到齐屏障主导，转向对应最小改动。历史复核保持独立。
3. 候选与基线使用相同观测、相同其他修改，只切换一个读取策略，交错采样。
   核对用户/租户、scope/search/cursor、确切返回工作与动态数据；数据变化单列。
4. 在候选对照前，利用新基线分布预定实用收益门槛和停止条件。报告逐请求或配对
   差值、样本数与分布，不能称少量样本为p95，也不承诺固定SQL数量降幅对应耗时。
5. 保持独立固定预期与隔离撤权/版本变化/损坏测试。采样只读，集成/发布交主控。

目标仍是授权语义保持、实际工作下降、关键路径与端点改善。仅观测上线或减少SQL
span数不足以完成Goal。页面可交互时间与端点延迟另计；持久化投影C仍须由关键路径
上的静态数据处理成本证据支持。

## 本批本地验证

- 四个相关 Jest 文件共83项通过：collector、catalogue/search、saved-row batch、working service。
- 服务端 TypeScript 检查通过；改动生产文件 ESLint 无错误，两个既有 disable 指令警告；
  测试文件被仓库 ESLint 配置忽略，其编译和行为由 Jest 验证。
- SQL tagged template 核对：repository 19处、search 14处与基线逐字一致。
- 独立审查发现并修复详细事件截断丢失窗口终点、递归前置读取归属父实例两项观测问题。
- 这些是本地验证，不代表已发布或已测得性能收益。未运行本批 PostgreSQL 集成测试。
- 集成后的 service 独立静态审查无阻断问题，批量方法保留 this、allSettled 与异常顺序、
  重试参数和历史复核独立性；仓库 `npm run precommit` 通过。

## 平台单条日志截断后的分段格式（2026-09-24 增量）

真实妙搭采样已证明启用详细观测后，旧格式的单条日志会在约10KB处被平台截断，
`log-get` 返回的 `body` 不能解析。新版保留一次 `ENGINEERING_KNOWLEDGE_CATALOGUE_PHASES`
摘要，内含 `timelineManifest`，并另外输出数条
`ENGINEERING_KNOWLEDGE_CATALOGUE_TIMELINE_SEGMENT`。默认关闭时不输出详细时间线段。
最多5批、每批40候选且尾组按可见缺口缩小的情况下，先有20条可见、
后续180条拒绝可产生185个窗口。若窗口汇总使摘要超过5000 UTF-8字节，
摘要改带 `windowManifest`，窗口数组由
`ENGINEERING_KNOWLEDGE_CATALOGUE_WINDOWS_SEGMENT` 记录；开关关闭时仍保留
这些必要的窗口汇总段。普通少窗口请求保持原摘要内联 `windows`。

同一个请求的日志按平台 `trace_id` 归组。manifest 记录格式版本、UTF-8 原文总字节、
段总数、SHA-256，以及对应的 `truncated`/`droppedEvents` 或 `droppedWindows`。
每段记录从0开始的
`segmentIndex`、同一段总数/哈希/截断状态，以及 JSON UTF-8 的连续字节片段的
base64。片段原始上限3072字节；按平台原有 `{"0":日志对象,"1":Logger上下文}`
包装后，本地最坏夹具要求每条小于8192 UTF-8字节，为平台10240字节留余量。

重组时先核对同一 `trace_id` 的摘要与段总数，检查每个序号恰好出现一次、总字节
及 SHA-256 一致，再按序连接 base64 解码后的**字节**，最后解析 JSON。缺摘要、
缺段、重复序号、混入另一请求或哈希不符都使时间线不可用；不能把已有部分当成完整
关键路径。`timelineManifest.truncated=true` 表示采集器自身已丢事件，即使日志段
全部齐全，也只能作为不完整时间线。摘要窗口时长及阶段累计仍可单独使用。

分段日志属于请求内观测，不含用户/对象身份或正文。多条日志会增加受控采样期间
的日志量；性能对照必须让基线和候选采用相同观测策略，不能将分段输出成本只计入
其中一侧。

本地增量验证（隔离基线 `636e6279376f7073083bc52251a60f4d64a0c1a4`）：
两个相关 Jest 文件41项通过；服务端类型检查、定向 ESLint 与仓库 precommit 通过。
测试包括代表性21根与两次递归事件的分段/重组、真实目录调度的20可见+180拒绝
形成185窗、200窗六位相对时间的保守上界、段缺失和内容损坏、默认开关关闭及段日志
失败时保留原业务错误。模拟事件验证日志格式和容量，不冒充真实Matter递归业务链验收；
平台10KB上限及同请求trace关联还需发布后读回验证。
