# 合成数据的实际服务输出

`producer-cycle.synthetic.json` 来源于独立 `codex-host-program-boundary.spec.ts` 测试，再经明确脱敏。测试用合成身份、合成原文、离线 persistence/authorization dependencies 与离线模型子进程替身，实际调用 Host `begin`、`readSources`、`recordProgramProgress`（包含真实材料 parser）、`saveWork`（真实 materializer）、`readAttemptWork`。没有调用线上 Host、真实模型或读取业务数据。

包内所有例子标记 `SANITIZED_EXAMPLE`。保留完整字段、结构与合成引用关联；可能私有的方法正文、定义、方法标题/定位及原系统提示词已替换。Task inputHash、请求 argsHash、派生 artifact 摘要和字节数按脱敏数据重算，不能当作原始运行回执或原hash证明。原始未脱敏测试证据由主控私有保留，不附本机路径。此后只验证示例schema/关联，不声称脱敏后的内容重新通过真实方法/正文准入。

`overall.status` 和 `attemptCompletion.status` 明确为 `NOT_EXERCISED`。保存 repository、RLS、数据库事务/租约和最终 CAS 尚未因此得到真实数据库证明。fixture 时间和 UUID 为合成数据，不是可使用的活动租约。

目录与正文可沿以下字段逐项核对：

- `started.modelInput.availableSources`：真实 producer 交付的目录。主原文的完整 `ref` 包含 `DOCUMENT_ORIGINAL:...:PRUN:synthetic:source:0`，不能靠固定冒号分段重建引用。
- `started.modelInput.deliveredEvidence`：实际模型 evidence 投影，主文没有顶层 `documentVersionId/sourceRefId`。
- `started.modelInput.programOriginal` 与 `documentOverview.original.binding`：主原文准确版本与结构绑定。
- `result.material.modelInput.continuousOriginal`：实际程序材料准备函数形成的连续正文、span、原文位置和覆盖。
- `result.material.sourceReads` 与 `events[method=sources]`：实际补读 packet，包含 related parseRun、证据正文、引用和 complete scope。
- `events[method=progress]`：对应测试实际进度回报的脱敏形状；材料 JSON 没有被放入进度 journal。
- `result.saveRequest`、`events[method=save]`、`history[0]`：原 SAVE key、CAS、完整候选和 Host materialized 工作正文。
- 两次 `events[method=work]`：原 key 查询先返回空，SAVE 后独立 READ 返回同一准确修订；不是用SAVE ACK作为读取证明。

`mcp-calls.synthetic.json` 是把 trace 中可信调用层省略的公共 fence 补回后的**形状示例**。请求参数由同一 started task/fence 与实际 payload 机械合成，逐条用导出的完整 JSONSchema校验；它不是线上MCP抓包，不伪造网络回执。`queue.synthetic.json` 只展示原shared联合类型的合成CLAIMED/ACK形状，未实际领取或完成队列。

`deterministic-projection.synthetic.json` 单独展示同一 saved revision 与独立 READ observation 经过实际 `exactProgramWorkRead`、`jobAidReadingResult`、`buildJobAidOverallProjection` 纯函数形成的同版 Overall；`execution='PURE_FUNCTIONS_ONLY'`、`commitCasAndFinish='NOT_EXERCISED'`。`baseFixture`/artifact descriptor 是函数的合成输入，不是commit回执；相关摘要也已按脱敏数据重算。

原始跨边界 Jest 验证为8个用例通过，包括v2/v3、96+4补读、原key保存恢复和独立CODEX scope/真实MCP handler。该代码测试结论与脱敏例子校验分别记录，不升级为线上身份、网关、真实数据库、commit/CAS、正常结束或页面验收。
