# f57 与 19d：最后必要集成及现场接线交接

日期：2026-10-25，Asia/Shanghai。范围：单个新事项的 `PROGRAM_CONTROLLED_V1` 初评。仅进行收到的实际接口包对照与集成取舍；本交付不修改产品源代码，不重新开发路径、恢复、输入留存，也未配置、部署或发起真实业务。

## 1. 已取得的准确版本

| 对象 | 准确身份／证据 |
| --- | --- |
| 原附件 | `WiseLink_Host_Codex_Interface_f57d8863.zip`，213758 bytes |
| **原包 SHA-256** | **`c67a519d46341499e95cb320725b5b759ba5631e71b42ad01e5306cd594f67d3`** |
| Host 源提交 | `f57d886352d32f93dbdd10df6b362edbf82d4aeb`，由外层 `DELIVERY_RECEIPT.json` 登记 |
| Host 源分支 | `codex/initial-assessment-925-core-20261025` |
| 云端客户端源提交 | `19d58915982c740690080b8db3e355828810ff38`，父 `925deb2d148a9eb8ed508300d7132fce55bc665c` |
| SDK tools/list SHA-256 | `0fc8c8fe28ff4bac26b2f3d30bbb82e2c8dd916d4a9859fca865519bff3aeeca` |
| 包内逐文件核验 | 77 个包文件的大小及 SHA-256 全部与回执一致；加外层回执共 78 文件 |
| 最终运行版本 | 待本地主控在 f57 上选择性吸收 19d 初评必需增量后给出；本对照提交不充当最终运行版本 |

工具列表本身是官方 SDK 原样导出，没有提交号。`source-manifest.sourceHead` 和包内历史比较的 `localPacket.commit` 为 `974bedfa`，表示导出祖先／旧比较记录；**最终 f57 身份取外层回执**。本轮没有假定 f57 已推到 GitHub，也没有取得其完整 Git 树；77 文件逐字节核验与回执记载的标准构建通过分别报告，原始构建日志不在包中。

实际包代替原 `PENDING_LOCAL_PACKET`。机器报告为 [host-packet-comparison.json](../../openclaw/codex-evaluator/contracts/host-packet-comparison.json)，保存原始结构差异、逐工具复核、包哈希和集成文件摘要。原固定 `fc132291` schema 继续作为来源证据，未改写为 f57。

## 2. 对照结论：保留 f57 三处既有窄修

45 项 metadata 已直接交给 **19d 实际 `validateHostToolMetadata`**，检查通过。五条 Codex 路径、服务 `wiselink-codex-engineering-assessment@1.2.0`、目标 app `app_17gr74pbere` 和保留 OPENCLAW wire/provenance 的要求对齐。这里证明源码导出的 metadata 可被客户端识别，尚未验证 HTTP 网关、凭据、业务 scope 或真实 Host。

首次初评的具体差异在以下三个位置。它们是 f57 已交付的本地修复，应在合并中保留；不要为云端旧假设修改 Host 材料或放宽恢复权限。

| 位置 | 19d 实际情况与影响 | 最小集成决定 |
| --- | --- | --- |
| `program-assessment-materials.mjs` | 从 delivered evidence 顶层取 `documentVersionId/sourceRefId`；f57 producer 有意不交付这两个顶层字段。将原包完整合成 producer input 和原 sources 回执送入实际 19d 函数，得到 `PROGRAM_ASSESSMENT_MATERIALS_ORIGINAL_EVIDENCE_MISMATCH`，尚未调用模型 | 保留 f57 的 catalog／完整 evidenceRef／原文单元／locator 精确映射。sourceRefId 可含冒号，不按固定段数拆引用。此文件未在925→19d变化，尤其不能从云端整树覆盖 |
| `orchestrate-host-mcp.mjs` RUNNING 收尾 | 19d 此处只有一次无 fence 的 latest READ；早先原 SAVE key 独立 READ 仍存在，不能据此断言每个正常成功流程都失败，但会移除 f57 已补的收尾精确核对 | 保留 f57：当前 action fence 的 latest 定位原 key → 当前 fence 的原 key READ → 完整 revision 相同。COMMITTING 仍只读原冻结结果，不生成、不 SAVE |
| `consume-hosted-work-item.mjs` COMMITTING 包装器 | 19d queueCommitRecovery 的白名单拒绝其下层恢复所需的 `read_assessment_work`，触发 `AUTO_WORK_ITEM_COMMITTING_RECOVERY_TOOL_REJECTED` | 保留 f57 对原 attempt／WI／SAVE key 的窄 READ 放行；禁止一般性扩大白名单，继续禁止生成和 SAVE |

f57 对这些修复的实现／验证描述来自包内 `FLOW_AND_RECOVERY.md`、`CLIENT_DELTA.md`、`ROLLOUT_AND_ISOLATION.md` 和 producer 例。最终集成仍由主控核对实际源文件；本会话不修改其工作树。

以下已有实现继续复用：stage requestId 从 `initial.stages.jobAid.requestId` 经 `continuationRequestId` 传入 begin；同版确定性 Overall；嵌套 `integratedAssessmentSummary` 的状态读取；原 SAVE key／完整响应／独立 READ；丢失 ACK 与收到非法 ACK 的区分。首次必须走已登记的明确 stage，不能把 intake key 当 begin key，也不能给直接入口只填一个不会被读取的顶层 requestId。

## 3. 19d 应吸收的最小增量

对 f57 包的 source manifest 与实际925／19d文件摘要进行了逐项比较。以下六个文件在 **f57 快照**仍与925逐字节一致，19d已交付所需增量；主控先核对当前文件未另行变化，再应用原增量：

| 文件 | 复用的现有19d增量 |
| --- | --- |
| `openclaw/codex-evaluator/codex-generation.mjs` | 完整实际 prompt、既有 run binding 校验、启动前回调 |
| `openclaw/codex-evaluator/miaoda_responses_bridge.py` | 发送前保存与实际 HTTP request 相同的最终 JSON body 字节 |
| `openclaw/codex-evaluator/run_codex_generation.py` | prompt／上游请求留存与回执摘要 |
| `openclaw/codex-evaluator/preflight.mjs` | 新运行应用配置检查 |
| `openclaw/skills/wiselink-research-and-synthesize/scripts/model-executor.mjs` | 原 checkpoint 上的 `codexParentRunRecorder` |
| `openclaw/skills/wiselink-research-and-synthesize/scripts/run-program-assessment.mjs` | 初评 `assessment-round-1` 启动前父关联 |

`run-hosted-review-turn.mjs`、`validate-payload.mjs`、`consume-hosted-work-item.mjs` 在 f57 已不同于925和19d：只合并首次程序初评所需的 transport／runtime 配置与来源校验调用点，保留本地 scope 和上述窄修。`orchestrate-host-mcp.mjs` 的19d COMMITTING补读与本地实现去重；不能整文件覆盖。本包 source manifest 未列出该 orchestrator 的单文件摘要，不能把缺失条目当作文件相同。

程序恢复的现有 CODEX provenance 传递按实际调用点核对并复用19d增量；冻结结果不重标。`initial-assessment-recovery.mjs` 在 f57 摘要仍等于925，其19d变更只是既有新建失败收尾的执行器标记。App适用性／Review identity 的扩展、翻译／Wiki逐消费者关联和多worker工作不扩大到本次首测。

包内“完整prompt／bridge payload尚未留存”的描述截至925。19d已补齐，按上表复用；本轮不再开发，也不追加原HTTP/SSE字节采集。既有 `upstream-response.json` 是解析后的SSE事件；该边界继续如实标注。

受影响验证只需针对最终合并后的实际代码：材料映射及引用拒绝边界、RUNNING双读/fence、COMMITTING窄包装器与原冻结结果、19d已有启动前关联/私有输入证据，以及准确配置和metadata。沿已有测试做受影响验证与标准构建，不以增加总测试数为目标。

## 4. 实际逐工具 schema 对照

复用19d比较器读取原始tools-list，没有自构工具包。原始比较为1项完整形状一致、41项结构差异；CLI返回2同时反映原始SDK列表不带revision。外层回执补足准确版本证据，**不把41个结构差异解释为41个业务不兼容，也不伪造全绿**。

- 表达等价：整数域的 `minimum:1` 与 `exclusiveMinimum:0`；字符串const旁的type；空required与省略；普通JSON对象的字符串propertyNames；此处未锚定结尾的MAT前缀模式。8个union的全部现有分支均明确为object，新增根type:object仅为冗余限制，已逐项核对分支数。
- 真实限制：机械转换遗漏的安全整数上限 **9007199254740991**；SDK明确UUID pattern的接受集合。保留下限、严格对象和动作分支，不放宽检查。
- UUID pattern接受正常v1–v8与正确variant、NIL和小写MAX；正常UUID的十六进制可大小写，空白／错误variant／错误版本／大写MAX不被该pattern接受。机械format和旧自制checker不证明同集合；不能由通常样例推断边界等价。
- Zod／Host语义：SDK缺少x-zodTrim不代表删除trim；dialect和自定义format继续登记；refine、来源／actor权限、版本、租约、fence、CAS和保存/结束条件单独保留。
- 未发现 required成员、additionalProperties、默认值或动作／phase成员变化。首次程序链所需字段未变化；安全整数及UUID边界属于真实限制，实际参数应来自Host原租约和原请求，不合成替代值。

表中“初评”表示现有首测调用链，“条件”表示仅保留已有条件路径，“后置”表示不作为本次初评执行前置。metadata完整暴露不代表这些业务入口已获权；f57首批显式拒绝CODEX Applicability/Review等业务。

| 工具 | 范围 | 实际差异结论 |
| --- | --- | --- |
| `begin_applicability_evaluation` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `begin_dynamic_evaluation` | 初评 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `begin_matter_assessment` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `begin_overall_synthesis` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `begin_review_turn` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `begin_translation` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `cancel_action_attempt` | 条件 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `commit_applicability_candidate` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `commit_dynamic_evaluation_candidate` | 初评 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `commit_overall_candidate` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `commit_review_turn_candidate` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `commit_translation_candidate` | 后置 | 新增顶层type:object在现有3个均要求object的分支上冗余；未删除严格对象或动作分支。 |
| `derived_summary_attempt` | 后置 | 新增顶层type:object在现有10个均要求object的分支上冗余；未删除严格对象或动作分支。 |
| `document_reading` | 后置 | 新增顶层type:object在现有9个均要求object的分支上冗余；未删除严格对象或动作分支。 |
| `document_translation` | 后置 | 新增顶层type:object在现有12个均要求object的分支上冗余；未删除严格对象或动作分支。 |
| `document_work` | 后置 | 新增顶层type:object在现有11个均要求object的分支上冗余；未删除严格对象或动作分支。 |
| `get_action_attempt_status` | 初评 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `get_deep_link` | 初评 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `get_parse_status` | 初评 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `get_review_turn_context` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `heartbeat_action_attempt` | 初评 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `hierarchical_wiki_cleanup` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `hierarchical_wiki_matter_action_attempt` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 新增顶层type:object在现有13个均要求object的分支上冗余；未删除严格对象或动作分支。 ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `hierarchical_wiki_next_matter_assessment` | 后置 | ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `hierarchical_wiki_read_matter_current_work` | 后置 | ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `matter_action_attempt` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 新增顶层type:object在现有13个均要求object的分支上冗余；未删除严格对象或动作分支。 ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `next_hierarchical_wiki` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 空required数组与省略在此等价。 |
| `next_matter_assessment` | 后置 | ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `next_original_assessment` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `query_assessment_knowledge` | 条件 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `query_parsed_package` | 条件 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `query_review_aily` | 后置 | SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `read_assessment_sources` | 初评 | 完整JSONSchema一致，TDMS原生引用refine仍单列保留。 |
| `read_assessment_work` | 初评 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `read_document_original` | 条件 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `read_matter_current_work` | 后置 | ^MAT-与^MAT-.*在此未锚定结尾的匹配中等价；自定义format另行保留。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `read_source_refs` | 条件 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `record_assessment_program_progress` | 初评 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `record_oem_discovery_run` | 后置 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `resume_overall_synthesis` | 后置 | 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `save_assessment_work` | 初评 | SDK明确保留安全整数上限9007199254740991；不得删除原下限/正数约束。 SDK UUID pattern与机械format及旧自制checker不等价；须保留版本/variant/NIL/小写MAX/大小写/空白接受边界。 显式dialect、trim或自定义format元数据差异不作为删除Zod或Host业务校验的理由。 |
| `translation_workspace` | 后置 | 新增顶层type:object在现有8个均要求object的分支上冗余；未删除严格对象或动作分支。 |

另外3项 `get_pending_review_turn`、`read_review_native_sources`、`record_assessment_consumer_stopped` 只登记原始metadata和文件摘要，本轮不增加其业务调用授权。

原七项真实Zod证据继续复用。核对包内safeParse记录与客户端原用例文件SHA一致，包内记载56接受／184拒绝／0不符；本会话没有重新执行该套用例。它不证明35项机械工具的全部UUID/整数边界，也不证明Host业务授权。未新增真实模型或Host调用；原200项只保留为19d离线历史。

## 5. 现场汇合与批准清单

不另建运行架构。dot继续安排既有宿主、持久目录和配置核查。本会话没有新的现场配置观察；包内17:07（北京时间）的名称级观察只是历史，不能据此断言当前仍未配置。

| 必须汇合的项目 | 准确内容／责任 |
| --- | --- |
| 最终代码 | 本地主控给出f57加选择性19d增量后的唯一准确commit、受影响验证和标准构建结果；实际客户端同样来自该组合，不能只填独立19d |
| 宿主与启动 | 已确认的运行主机/容器/应用、唯一进程监管和唤起入口、固定Codex二进制及版本、私有配置引用；沿现有核查完成 |
| 持久目录 | 明确`checkpointRoot`和`runRoot`，各自持久卷、权限和重启后原路径保留；不借旧OpenClaw默认目录或旧UNKNOWN记录 |
| Host连接与身份 | 准确Host origin/base path/环境；Codex MCP和四条控制路径；独立principal、tenant、runtime app `app_17gr74pbere` |
| 首条新业务 | 一个准确新WI、原intake requestId、另行登记的EVALUATE_JOBAID stage requestId、DV/parse版本、当前actor/来源授权、封存模型选择 |
| 配置版本 | 已确认的非秘密配置状态快照；认证材料用受控引用，不把凭据值写入本包或普通消息 |

固定上述值后，向用户提交一次具体批准范围：

1. **技术部署：**准确最终Host／客户端版本、目标应用与DEV或UAT环境、实际宿主和启动入口。
2. **受控配置及业务切换：**独立新principal和精确路径凭据、单新WI/intake scope、唯一活动CODEX路线及旧入口停止新增领取的准确范围；不接管旧owner或清理未知记录。
3. **单个新事项实测：**既有材料→一次有界模型生成→原key SAVE→独立准确READ→Host确定性Overall→原阅读面→正常结束/ACK；使用已选妙搭模型及其既有限额，不另拆CLI子代理。

所需Host配置名称来自原包：`WL_MODEL_EXECUTOR`、`WL_CODEX_RUNTIME_APP_ID`、`WL_CODEX_SERVICE_SCOPE_ENABLED`、`WL_CODEX_GATEWAY_AUTH_MODE`、`WL_CODEX_SERVICE_SCOPE_ENV`、`WL_CODEX_SERVICE_PRINCIPAL_ID`、`WL_CODEX_SERVICE_TENANT_ID`、`WL_CODEX_SERVICE_WORK_ITEM_ID`、`WL_CODEX_SERVICE_REQUEST_ID`、`WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED`。授权路径为 `/openapi/wiselink/codex-mcp` 及同前缀的 `codex-next-work-item`、`codex-ack-work-item`、`codex-block-work-item`、`codex-apply-pending-model-configuration`；最后一项只处理既有待生效配置。

本轮尚未发起上述批准或执行这些动作：最终集成版本、宿主/目录及单新事项准确范围仍待主控汇合。翻译独立恢复契约和1→2→4多worker计划保持后置，不挡首次程序初评。

## 6. 图契约应登记的最小状态

由本地主控在现有v1.8统一更新，不新增节点：`assessment.research`下登记“f57实际包已核、材料映射保留、一次生成及19d输入关联待最终合并”；`research.overall`边保留原SAVE key、带当前fence的RUNNING双读和COMMITTING冻结恢复；`assessment.overall`保持确定性零模型投影；`artifact.reading`／`surface.reading`保持真实页面待验。接线元数据绑定原包SHA、Host/client最终版本和配置状态。翻译跨租约与并行不因该包到达而标为完成。

证据来源均为本次原附件、19d实际客户端和925→19d已有差异。没有读取/修改本地主控工作树，没有把源代码导出、合成producer例、进程回执或metadata成功提升为真实业务完成。
