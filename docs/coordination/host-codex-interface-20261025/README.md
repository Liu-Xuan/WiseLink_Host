# Host ↔ Codex 非秘密机器接口包

本包是程序初评首测P0交付，来自独立CORE树：以准确f57d8863为基线，选择性吸收925deb→19d589的首测必要客户端增量，保留Host授权、材料、COMMITTING及原SAVE key双READ边界。准确来源见 [source-version.json](source-version.json) 和 [source-manifest.json](source-manifest.json)。父checkpoint启动前关联、完整prompt与实际上游请求已接入；现场目录、安装与真实业务仍待验。文档跨lease Host扩展在并行P1另包，本包不含`READ_GENERATION`、`SEAL_CANDIDATE`、`RECOVER_SAVE`。原f57 ZIP保留原字节作前次交付证据，本定稿另有准确回执。

**状态：本地已实现独立Codex MCP/路由、单新事项程序初评scope、原请求恢复与准确双读收尾；本轮未部署、未执行真实业务或模型。** 目标运行应用从`WL_CODEX_RUNTIME_APP_ID`读取并拒绝旧应用身份；首批Applicability/Review等CODEX业务入口显式拒绝。官方名称级历史观察当时尚无`WL_MODEL_EXECUTOR`、`WL_CODEX_*`及新路径Key授权，不等于实时配置检查；未查询或导出其值。实际宿主/调度、两个持久目录所在卷与新事项授权仍待现场核对。观察时间见 [configuration/observed-status.json](configuration/observed-status.json)。

建议按以下顺序阅读：

1. [INTERFACE.md](INTERFACE.md)：实际/期望 endpoint、身份发现、两层租约和字段传递。
2. [FLOW_AND_RECOVERY.md](FLOW_AND_RECOVERY.md)：材料→一次生成→原 key SAVE→独立 READ→同版初评 Overall→结束及未知结果恢复。
3. [RECEIPTS_AND_CONFIGURATION.md](RECEIPTS_AND_CONFIGURATION.md)：执行回执的真实关联和配置状态。
4. [mcp/codex.initialize.response.json](mcp/codex.initialize.response.json)、[mcp/codex.tools-list.json](mcp/codex.tools-list.json)：官方 SDK 实际离线握手与完整工具 metadata/JSONSchema；[mcp/tool-index.json](mcp/tool-index.json) 提供逐工具索引。
5. [rest/openapi.paths.json](rest/openapi.paths.json)、[types/source-declarations.json](types/source-declarations.json)、[errors/source-catalog.json](errors/source-catalog.json)：当前源码的 HTTP 合同、完整原始类型声明和错误定位。
6. [examples/README.md](examples/README.md)：合成业务数据经过真实 Host 服务后脱敏的字段/关联示例，以及纯函数 Overall 投影；不含线上业务内容或可能私有的方法正文。
7. [CLIENT_DELTA.md](CLIENT_DELTA.md)：上游42项（35机械/7真实Zod）与当前SDK45项的组合分类、正反例及旧包处置。宿主与受控切换见 [ROLLOUT_AND_ISOLATION.md](ROLLOUT_AND_ISOLATION.md)；其原文源路径为`docs/coordination/WISELINK_CODEX_RUNTIME_ACCEPTANCE_20261025.md`，不在ZIP中制造外部不可用链接。

`1.2.0` 是 MCP **服务版本**。当前 45 个工具没有各自独立的版本声明，也没有声明 `outputSchema`；索引中逐工具 `toolVersion: null` 如实表示未声明。输入 JSONSchema 是完整 `tools/list` 原样输出，不能把 `1.2.0` 填成每个工具的 schema 版本。Task/Result/工作正文各自的 `schemaVersion`，以及 `result.toolVersions` 中的协议/执行器来源字段，是另外的维度。

导出运行只做两次真实生产 `createServer(executor)` 注册与官方 `InMemoryTransport` 的 `initialize`、`tools/list`，所有业务 provider 均为一经调用便报错的守卫。导出证明源码能生成这些 metadata；没有运行 HTTP 网关、认证、业务读取/领取、数据库或模型。可选 provider 以“存在”方式导出完整模块工具面，不能据此推断运行范围已经获权。

本包不含凭据值、线上业务 ID、人员信息、用户绝对路径、原件或私有业务正文。OpenAPI 自带示例和 `examples/` 全部是合成形状。后者显式标记 `SANITIZED_EXAMPLE`，方法正文/定义、原系统提示词已替换，既有摘要与字节数重算；不能作为原始运行回执，也不宣称脱敏文本通过 Host 正文准入。源码路径均相对于仓库；只保留必要的非秘密服务身份、配置名称及技术版本。

在仓库根目录离线重建及校对：

```sh
node scripts/export-host-codex-contract.mjs
node scripts/export-host-codex-contract.mjs --check
node openclaw/codex-evaluator/check-host-contract.mjs --current-interface
node docs/coordination/host-codex-interface-20261025/validate-package.mjs
```

导出脚本不更新观察事实或业务示例。源文件变化后应重新导出；平台配置/部署变化后由持有官方只读证据的人单独刷新观察。`--check` 沿用导出时HEAD并核对它仍为当前祖先，实际比较源文件内容，提交本包不触发自指hash循环。示例脱敏器不附私有原始输入。验证默认只检查，需要更新稳定摘要时才加 `--write-result`。测试与限制见 [VALIDATION.md](VALIDATION.md)，跨端待修项见 [CROSS_END_FOLLOWUP.md](CROSS_END_FOLLOWUP.md)。

最终ZIP在正常提交和构建后另附`DELIVERY_RECEIPT.json`，给出准确最终sourceCommit、parent、branch和包文件清单摘要；归档摘要在ZIP外回执。仓库内export observedHead只表示源码观察祖先，不能误认最终组合提交。
