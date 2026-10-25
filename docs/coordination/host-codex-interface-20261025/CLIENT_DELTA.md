# 新客户端 925deb 与当前 Host 的组合对照

新执行器上游`925deb2d148a9eb8ed508300d7132fce55bc665c`的父提交为`94c54de74a0d7a0c0d66778a04a161e2017fce28`。其`contracts/host-source-interface.json`固定于旧Host `fc132291`，明确标记`PINNED_LEGACY_SOURCE_ONLY`。唯一当前接口是本目录实际生产注册函数经官方SDK导出的initialize/tools-list及同源文件；旧源码材料只用于来源和差异审查，不承担新版兼容承诺。

## 1. 42 项与 45 项

上游仍记录42个工具名。35项保留机械转换的JSONSchema，另外7项已用固定源和真实Zod 4.6.5补齐，不再是未解析依赖。当前完整45项直接按名称读取`mcp/tools/<name>.json`，比较器复用925实现，不另存第二套当前工具清单。

| 925补齐的真实Zod工具 | 固定源顶层分支 | 接受/拒绝样例 |
| --- | ---: | ---: |
| `read_assessment_sources` | 1 | 2/6 |
| `commit_translation_candidate` | 3 | 3/12 |
| `translation_workspace` | 8 | 8/27 |
| `document_work` | 11 | 11/36 |
| `document_reading` | 9 | 9/30 |
| `document_translation` | 12 | 12/38 |
| `derived_summary_attempt` | 10 | 11/35 |

当前另外3项是`record_assessment_consumer_stopped`、`get_pending_review_turn`、`read_review_native_sources`，只是未被上游选择盘点。完整42项与当前SDK的组合差异见 [机器对照](mcp/client-source-comparison.json)；7项样例再由当前生产注册的真实Zod执行，结果见 [当前Zod正反例](mcp/pinned-zod-cases-on-current-host.json)。这不执行任何业务handler或授权操作。

35份机械schema不能称为完整接受语义相同。比较仍保留15项验证关键词一致、20项有差异的分组，并将差异逐项分类：

- SDK为整数保留 `Number.MAX_SAFE_INTEGER` 上限；上游机械转换部分未带该上限。当前模式的负例已验证超上限输入会被完整SDK schema拒绝。
- SDK UUID带实际pattern（包含Zod允许的nil/max形式），上游机械schema只声明format，原自制checker又仅接受普通版本UUID；不等于实际Zod接受集合。
- 正整数的 `exclusiveMinimum:0` 与 `minimum:1` 在整数域等价，但须同时保留其他上限。
- 空required数组/省略、const对应type、普通JSON键的 `propertyNames:{type:'string'}` 是表达差异；Matter前缀的pattern和自定义format也须分别说明，不能把所有差异统称业务不兼容。

比较器不把已知等价表达改成SHAPE_MATCH，也不吞掉真实限制；有差异时仍报告`SHAPE_DIFFERENCE`且CLI返回2。运行转换/精化metadata另外保留。完整SDK JSONSchema不表达所有Zod trim/default/refinement；实际Zod的56接受、184拒绝样例单独验证，不能用放宽JSONSchema代替TDMS原生引用等检查。

7项真实Zod中1项schema呈现一致、6项仍有顶层`type:'object'`的呈现差异；另2项机械schema也有该差异。比较器保守保留为未声明等价的限制差异，不把240个固定样例通过推成所有输入集合相等。

本首测包只导出独立CORE实际schema，不含并行P1的`READ_GENERATION`、`SEAL_CANDIDATE`、`RECOVER_SAVE`。925消费者中相关恢复准备不等于本包Host具有跨lease封存/恢复能力；旧无Host封存或结果不明的文档翻译保持pending，不能退回替换候选或重派生成。P1完成后独立交接，不等待它来交付程序初评首测包。

## 2. 当前检查方式

```sh
node openclaw/codex-evaluator/check-host-contract.mjs --current-interface
node openclaw/codex-evaluator/current-interface.test.mjs
node openclaw/codex-evaluator/compare-host-interface-packet.mjs --current-interface
```

当前模式固定引用本目录，核对42名称的完整SDK文件、独立身份、5条Codex路径、来源摘要、35机械示例和1既有示例。另7项由真实生产Zod执行240个正反例；这些固定样例不自动覆盖新Host动作。JSONSchema的format插件未启用，实际pattern照常验证；7项Zod样例的format/transform/refinement验证与该限制分开报告。当前引用及证据有11项、比较器有11项、artifact反篡改有4项正反例，保留缺失工具、真实限制和等价分类的严格失败边界。

默认pinned模式保留925的依赖blob、schema/cases摘要等反篡改校验。client源码从已存在的925 Git对象取出核同一hash，并明确返回`PINNED_GIT_OBJECT`、`workingClientSourceVerified:false`；不会把当前集成文件冒充旧字节。当前模式另外核对本地manifest，两者不互相替代。

## 3. 路由、身份和封存合同

上游固定源码盘点指向历史控制路径。本地选择性集成保留`/codex-mcp`及四条`codex-*`队列路径；不能从新MCP URL再落到已停用的旧queue路由。完整路径见 [INTERFACE.md](INTERFACE.md)。

服务发现身份是 `wiselink-codex-engineering-assessment@1.2.0`。首批实际运行类型是 `CODEX`，目标运行应用由 `WL_CODEX_RUNTIME_APP_ID` 提供；独立principal与准确单新intake scope由Host解析。Task/Result仍保留已封存的OpenClaw envelope、taskType、shared历史app literal与旧MCP provenance key。这些是合法历史wire名，不能据此把新运行端冒充成旧OpenClaw身份。

首批只承接程序初评。Applicability与Review的CODEX业务入口明确拒绝；45项metadata保留完整通用工具面，不代表所有入口已迁移或获权。Discovery可记录CODEX来源；历史记录缺少runtimeAppId时不从当前配置回填。

## 4. 恢复进展与验证层级

94的程序恢复、原SAVE/READ与同版Overall保留；925新增逐消费者恢复，当前集成又修正外层UNKNOWN、执行器来源和队列/收尾边界。详细关联见 [RECEIPTS_AND_CONFIGURATION.md](RECEIPTS_AND_CONFIGURATION.md)。原解析后响应、实际prompt/bridge payload与原字节仍须区分。

剩余边界是实际Codex prompt与bridge上游payload未独立完整落盘，`upstream-response.json`保存解析后的SSE JSON事件而非原始HTTP/SSE字节。已有请求body/prompt摘要和响应/runner索引不能被说成零关联，也不能冒称原字节完整留存。

Review 19项、translation 28项、queue 23项及Host preflight 12项由主控在相应集成范围验证，接口/反篡改/分类测试另列；这些消费者测试不证明本包没有包含的P1 Host动作。宿主原文源路径为`docs/coordination/WISELINK_CODEX_RUNTIME_ACCEPTANCE_20261025.md`，其包内摘要见 [ROLLOUT_AND_ISOLATION.md](ROLLOUT_AND_ISOLATION.md)。

## 5. 旧包处置

974的76文件ZIP已按原摘要、逐文件字节、内部路径和脱敏内容只读核对，作为私有历史证据保留；本定稿替代其交付地位。旧`client-94c54de-comparison.json`已移除，由当前组合差异替代，不继续增加旧协议兼容分支。925固定源、副本及测试暂因当前比较/审计仍被引用而保留，明确只作证据；无消费者引用后可另批移除。旧成果或检查点的清理/重生成按准确对象与依赖处理，UNKNOWN/COMMITTING不因旧包退役而自动删除或重放。
