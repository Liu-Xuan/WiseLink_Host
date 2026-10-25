# 供本地主控纳入图契约 v1.8 的 Codex 增量

日期：2026-10-25，业务时区 Asia/Shanghai。**这是节点/边变更建议与证据边界，不是对本地主控图契约的直接修改。** 我方源码基线 `925deb2d148a9eb8ed508300d7132fce55bc665c` 中图文件为 v1.7；用户告知本地 `974bedfa8edb03ba94c4991a2c6a3c63a1145eb4` 已到 v1.8，但其版本化包尚未收到。以下复用已知稳定 ID；由 dot 与本地主控核对 v1.8 并统一纳入。

## 节点下的执行细节

| 既有 nodeId | 本次可补充的内部步骤 | 不能标为已完成的部分 |
| --- | --- | --- |
| `document.reading` | 任务/parseRun/semanticRevision/源绑定 → 原 requestId → 启动前父检查点/run 关联 → 私有 prompt/上游请求/响应 → SAVE 查询和独立读回 | 新服务真实认证、真实阅读保存与页面可读 |
| `document.translation` | WorkItem 翻译按 attempt/任务/轮次/块绑定；文档翻译保留原 generation、原 NEXT/SAVE 意图、完整响应与 run 引用 | 文档 generation 跨租约恢复；原 SAVE 精确查询与新恢复授权未取得，UNKNOWN 不盲重发 |
| `assessment.research` | 复用程序初评一次模型调用；普通 Review、Wiki MATTER 按现有任务和轮次保留 run 关联；COMMITTING 同 attempt/WI 找 key、按 key READ 完整修订，只恢复冻结结果 | 本地新 Host 契约部署/真实保存；来源和内容质量仍按准确材料单独验收 |
| `assessment.overall` | 沿 94c54de 的同版工作确定性投影和独立核对；恢复不新增模型 | 不能仅凭模型完成或 worker 退出认定 Overall/ACK 已完成 |
| `knowledge.wiki` | SUMMARY/MATTER 每轮实际 gateway 关联、原 SAVE key 查询、READ 与 FINISH；父层沿准确已保存成员 | 真实成员读写、层级内容和新 Host 跨租约实际结果 |
| `surface.reading` | 展示原请求、run 引用、模型/进程/业务回执的分开状态；正文仍由已有成果读取入口提供 | 本轮没有页面实测，不能从离线测试推导可读 |

## 既有边及消费证据

| edgeId | 建议补充的证据字段/含义 |
| --- | --- |
| `original.reading` | 准确源绑定和请求 hash → 实际 prompt/上游请求私有引用；只证明本次交付输入，不能替代内容质量验收 |
| `original.translation` | 原文/workspace/块集合/batchHash/generationRequestRef/clientRequestId → 原 run/response；跨租约授权缺失保留待核 |
| `original.research` | 已有程序材料与 argsHash → 启动前 run 关联 → 完整响应；单次初评仍一次模型调用 |
| `research.overall` | 同 attempt/WI 的原 SAVE key、完整 workRevisionRef、按 key 独立 READ、原冻结 result hash与同版投影 |
| `reading.wiki`、`research.wiki`、`wiki.parent` | 按既有 scope、invocation 和 round 关联输入、生成、原保存回执及读回；层级成员不因共用 gateway 自动验收 |
| `artifact.reading` | 使用 Host 已保存准确成果及权限内读取；本次客户端离线证据不能将此边设为真实页面通过 |

运行输入和运行目录是既有节点的内部证据，不新增同级业务节点，不新增工作流队列。MCP/REST 路由和服务身份登记在接线元数据：`/openapi/wiselink/codex-mcp`、同 `/openapi/wiselink/` 前缀的四个 `codex-*` 控制入口、`wiselink-codex-engineering-assessment@1.2.0`、配置项 `WL_CODEX_RUNTIME_APP_ID=app_17gr74pbere`。合法 OPENCLAW Task/Result wire 类型和旧 provenance 版本键继续保留；它们不表示旧应用获得新请求执行权。

## 状态及场景标注

对 R04/R08/R09/R10 补充：父检查点/run 关联先于进程启动；prompt 是实际 CLI stdin 的 UTF-8 全文；上游请求是实际发出的 JSON body 字节；现有响应日志为**解析后的 SSE 事件对象**，不是原始 SSE/TLS/HTTP 字节。模型响应、进程关闭、SAVE、独立 READ、Overall、结束/ACK 分别验收。

COMMITTING 的反例包括原 key 不一致、attempt/WI 不一致、完整修订变化、当前 fence 被误用于封存保存、以及试图重新生成/SAVE。文档翻译的跨租约反例继续保留，不用 `synthetic-authorized-same-fence` 关闭它。PENDING_LOCAL_PACKET 的 42 项是客户端对照范围，Host 包额外三项仅登记，不自动扩大调用授权。

并行状态引用 [有界 worker 方案](WISELINK_CODEX_BOUNDED_WORKERS_20261025.md)：当前 batch 4 为串行；独立 worker 的 1→2→同组4按真实闭环和准确授权推进，CLI 内部子代理关闭。本轮不登记并行已实现/已启用/已验证。既有图文件和本地主控工作树均未由我方修改。
