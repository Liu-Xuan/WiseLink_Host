# 新客户端 94c54de 与当前 Host 的对照

新执行器上游 `94c54de74a0d7a0c0d66778a04a161e2017fce28` 的父提交为 `fc1322919b1b52433c33086c8db4aeb957f0e982`。其 `contracts/host-source-interface.json` 是固定旧 Host 源码盘点，明确标记 `PINNED_LEGACY_SOURCE_ONLY`；本地实际 Host 的唯一当前完整接口仍是本目录的官方 SDK 45 工具导出。上游旧盘点保持原样，不将历史观察改写成当前或线上证明。

## 1. 42 项与 45 项

上游记录 42 个工具名：35 项机械转换 JSONSchema，7 项仅有准确 Zod 表达式与未解析依赖。当前包的全部 45 项由生产注册函数和官方 SDK 离线 `tools/list` 生成，7 项均已有完整输入 schema，直接按名称读取本包 `mcp/tools/<name>.json`，无需继续手写转换或制造第二份工具清单。

| 上游只有表达式的工具 | 当时未解析依赖 | 当前来源 |
| --- | --- | --- |
| `read_assessment_sources` | `tdmsNativeReferenceMcpSchema` | 本包同名 SDK schema |
| `commit_translation_candidate` | 结果分片常量/union绑定 | 本包同名 SDK schema |
| `translation_workspace` | `translationWorkspaceCommandSchemaV2` | 本包同名 SDK schema |
| `document_work` | `documentActivityActionSchemas` | 本包同名 SDK schema |
| `document_reading` | `documentReadingActionSchemas` | 本包同名 SDK schema |
| `document_translation` | `translationWorkspaceCommandSchemaV2` | 本包同名 SDK schema |
| `derived_summary_attempt` | `tdmsNativeReferenceMcpSchema` | 本包同名 SDK schema |

当前另外 3 项是 `record_assessment_consumer_stopped`、`get_pending_review_turn`、`read_review_native_sources`。它们只是未被上游42项选择盘点，不是新增缺失工具，也不能据其存在推断首批CODEX业务范围扩大。完整的逐工具来源、差异指针和schema引用见 [机器对照](mcp/client-94c54de-comparison.json)。

35份机械schema都缺少当前SDK的dialect等metadata，因此不能说“完整文件逐字相同”。忽略注解并归一化required/enum/union顺序后，15项验证关键词一致，20项仍有关键词差异，主要包括：

- SDK为整数保留 `Number.MAX_SAFE_INTEGER` 上限；上游机械转换部分未带该上限。当前模式的负例已验证超上限输入会被完整SDK schema拒绝。
- SDK UUID带实际pattern（包含Zod允许的nil/max形式），上游机械schema只声明format，原自制checker又仅接受普通版本UUID；不等于实际Zod接受集合。
- 正整数的 `exclusiveMinimum:0` 与 `minimum:1` 在整数域等价，但须同时保留其他上限。
- 空required数组/省略、const对应type、普通JSON键的 `propertyNames:{type:'string'}` 是表达差异；Matter前缀的pattern和自定义format也须分别说明，不能把所有差异统称业务不兼容。

完整SDK JSONSchema仍不表达所有Zod trim/default/refinement，也不证明Host授权或业务有效。TDMS原生引用refiner等运行校验继续有效，补齐schema不等于删除这些约束。

## 2. 当前检查方式

```sh
node openclaw/codex-evaluator/check-host-contract.mjs --current-interface
node openclaw/codex-evaluator/current-interface.test.mjs
```

显式当前模式固定引用本目录，不接受另一份tools-list路径；按42名称读取完整SDK文件，核对独立CODEX身份、5条Codex路径、文件来源及源文件摘要。它用完整schema校验上游35个机械示例及1个原表达式示例；其余6项尚无正例，结果逐项列明。`format`插件未启用，schema中实际pattern照常验证，format-only语义不宣称已测。7个正反例覆盖身份、Codex路由、唯一源引用、缺失完整schema、safe-integer边界与覆盖说明。

不带参数的检查保留上游pinned模式及其来源边界。上游artifact的client源码hash固定于其原提交，不能拿它要求已集成且保留本地修复的客户端全文仍相同；遇到 `client-source-stale` 应识别检查对象，不应重写旧artifact伪通过。当前集成验证使用显式当前模式。

## 3. 路由、身份和封存合同

94上游的旧源码盘点与其queue URL构造仍指向无Codex前缀的历史控制路径。本地选择性集成保留 `/codex-mcp` 及四条 `codex-*` 队列路径；不能从新MCP URL再落到已停用的旧queue路由。完整路径见 [INTERFACE.md](INTERFACE.md)。

服务发现身份是 `wiselink-codex-engineering-assessment@1.2.0`。首批实际运行类型是 `CODEX`，目标运行应用由 `WL_CODEX_RUNTIME_APP_ID` 提供；独立principal与准确单新intake scope由Host解析。Task/Result仍保留已封存的OpenClaw envelope、taskType、shared历史app literal与旧MCP provenance key。这些是合法历史wire名，不能据此把新运行端冒充成旧OpenClaw身份。

首批只承接程序初评。Applicability与Review的CODEX业务入口明确拒绝；45项metadata保留完整通用工具面，不代表所有入口已迁移或获权。Discovery可记录CODEX来源；历史记录缺少runtimeAppId时不从当前配置回填。

## 4. 恢复进展与验证层级

94已实现固定程序modelRequestId、排他generation目录、runner进程身份/闭合、generation receipt、完整解析后上游事件、确定性adapted response、codexReceipt和program receipt links。SAVE/READ、commit ACK丢失、错误ACK与COMMITTING重放也增加准确身份/同版Overall核对。详细关联见 [RECEIPTS_AND_CONFIGURATION.md](RECEIPTS_AND_CONFIGURATION.md)。

剩余边界是实际Codex prompt与bridge上游payload未独立完整落盘，`upstream-response.json`保存解析后的SSE JSON事件而非原始HTTP/SSE字节。已有请求body/prompt摘要和响应/runner索引不能被说成零关联，也不能冒称原字节完整留存。

上游70项离线测试与本地当前模式7项测试、旧Host服务合成例、SDK metadata验证各有不同范围；没有真实模型、网络认证、真实业务SAVE、页面或线上正常结束的新增验收。准确本地集成测试由主控记录，不把上游测试数自动升级为本地全链成功。
