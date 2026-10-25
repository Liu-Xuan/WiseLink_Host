# Host ↔ Codex 非秘密机器接口包

本包用于转交 ChatGPT 审阅当前实际接线，日期为 2026-10-25。它来自本地 Host 工作源码及已导入的新执行器客户端；准确 HEAD、源文件及内容摘要见 [source-manifest.json](source-manifest.json)。它不是新协议，也不是线上运行证明。

**状态：本地源码已实现独立 Codex MCP 身份和路由；未部署本批接线，未执行真实业务或模型。** 官方名称级只读观察显示开发、线上环境均尚无 `WL_MODEL_EXECUTOR`、`WL_CODEX_*`，也没有 Codex 精确路由的 API Key 授权。未查询或导出配置值；运行端凭据、目标租户/actor、来源授权和新事项均不在此包。观察时间和限制见 [configuration/observed-status.json](configuration/observed-status.json)。

建议按以下顺序阅读：

1. [INTERFACE.md](INTERFACE.md)：实际/期望 endpoint、身份发现、两层租约和字段传递。
2. [FLOW_AND_RECOVERY.md](FLOW_AND_RECOVERY.md)：材料→一次生成→原 key SAVE→独立 READ→同版初评 Overall→结束及未知结果恢复。
3. [RECEIPTS_AND_CONFIGURATION.md](RECEIPTS_AND_CONFIGURATION.md)：执行回执的真实关联和配置状态。
4. [mcp/codex.initialize.response.json](mcp/codex.initialize.response.json)、[mcp/codex.tools-list.json](mcp/codex.tools-list.json)：官方 SDK 实际离线握手与完整工具 metadata/JSONSchema；[mcp/tool-index.json](mcp/tool-index.json) 提供逐工具索引。
5. [rest/openapi.paths.json](rest/openapi.paths.json)、[types/source-declarations.json](types/source-declarations.json)、[errors/source-catalog.json](errors/source-catalog.json)：当前源码的 HTTP 合同、完整原始类型声明和错误定位。
6. [examples/README.md](examples/README.md)：合成业务数据经过真实 Host 服务后脱敏的字段/关联示例，以及纯函数 Overall 投影；不含线上业务内容或可能私有的方法正文。

`1.2.0` 是 MCP **服务版本**。当前 45 个工具没有各自独立的版本声明，也没有声明 `outputSchema`；索引中逐工具 `toolVersion: null` 如实表示未声明。输入 JSONSchema 是完整 `tools/list` 原样输出，不能把 `1.2.0` 填成每个工具的 schema 版本。Task/Result/工作正文各自的 `schemaVersion`，以及 `result.toolVersions` 中的协议/执行器来源字段，是另外的维度。

导出运行只做两次真实生产 `createServer(executor)` 注册与官方 `InMemoryTransport` 的 `initialize`、`tools/list`，所有业务 provider 均为一经调用便报错的守卫。导出证明源码能生成这些 metadata；没有运行 HTTP 网关、认证、业务读取/领取、数据库或模型。可选 provider 以“存在”方式导出完整模块工具面，不能据此推断运行范围已经获权。

本包不含凭据值、线上业务 ID、人员信息、用户绝对路径、原件或私有业务正文。OpenAPI 自带示例和 `examples/` 全部是合成形状。后者显式标记 `SANITIZED_EXAMPLE`，方法正文/定义、原系统提示词已替换，既有摘要与字节数重算；不能作为原始运行回执，也不宣称脱敏文本通过 Host 正文准入。源码路径均相对于仓库；只保留必要的非秘密服务身份、配置名称及技术版本。

在仓库根目录离线重建及校对：

```sh
node scripts/export-host-codex-contract.mjs
node scripts/export-host-codex-contract.mjs --check
node docs/coordination/host-codex-interface-20261025/validate-package.mjs
```

导出脚本不更新观察事实或业务示例。源文件变化后应重新导出；平台配置/部署变化后由持有官方只读证据的人单独刷新观察。`--check` 沿用导出时HEAD并核对它仍为当前祖先，实际比较源文件内容，提交本包不触发自指hash循环。示例脱敏器不附私有原始输入。验证默认只检查，需要更新稳定摘要时才加 `--write-result`。测试与限制见 [VALIDATION.md](VALIDATION.md)，跨端待修项见 [CROSS_END_FOLLOWUP.md](CROSS_END_FOLLOWUP.md)。
