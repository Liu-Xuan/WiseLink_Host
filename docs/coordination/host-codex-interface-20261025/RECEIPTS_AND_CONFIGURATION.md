# 执行回执与配置状态

## 1. 已有的请求—响应绑定

程序初评已有持久入口，并非只有模型原型。`assessment-enabled.binding` 固定 operation、准确 modelInput、session discriminator、executionModel，以及 CODEX 时的 `modelExecutor`。`program-model-input` 保存 `run-program` 传入 `createCodexGateway` 的完整两消息/函数候选请求。`assessment-round-1.started` 与 `.result` 都保存原 `argsHash=canonicalSha256({body,executionModel})`，结果记录完整 `{raw,status,ok}`；不匹配拒绝。`program-save-request` 固定原保存 key、CAS 和正文，`program-work-readback` 固定准确保存修订。

CODEX适配器实际把这份请求封装进新的Codex prompt，随后Codex/bridge转换为上游HTTP请求。材料快照不等于真正上游payload；`PREPARED_NOT_CONFIRMED_SENT`仍表示程序准备证据，不能推断已发出或实际服务已接收。

这些现有绑定可以把程序收到的完整适配器响应、候选和 SAVE/READ 连回该 task；不能据此声称 Host 已持有所有上游原始字节或 Codex 子进程回执。

## 2. 本轮已补齐的回执与恢复

94c54de已把固定 `program:<attemptRef>:round-1` 请求身份接入既有gateway恢复。`generation-binding.json`绑定原请求body摘要、prompt摘要、选定模型及runner选项，排他目录避免另开同请求推理。原runner仍存活时等待其回执，只有派发标记且无有效闭合证据时保持UNKNOWN，不启动第二个模型请求。

runner除原events/final/candidate/audit外，新增实际`runner-identity.json`、`upstream-response.json`与`generation-receipt.json`。回执绑定运行目录、binding摘要、transport和候选；成功还要求唯一模型派发、进程组确已闭合、原上游事件文件存在且摘要一致。适配器可从同一回执确定性恢复`adapted-response.json`，返回实际`codexReceipt={requestId,runDirectory,responseSha256,transportSummaryRef,recovered}`；它随原`assessment-round-1.result`持久保存，不再依赖可选的onRunCompleted回调才有运行关联。

程序新增`program-save-started`和`program-receipt-links`，后者把准确attempt/WI/DV/baseRevision、modelRequestId/argsHash/响应摘要/run目录、SAVE key及准确workRef/revision/独立READ检查点连起来。它是现有消费者本地索引，不是新Host API或授权对象。文件与目录按既有原子写/同步方式持久化；真实宿主卷、容器回收和断电耐久性仍需现场确认。

新恢复还核对完整READ身份、Host材料化后的authored正文和问题集合；保存ACK丢失只按原key查询。commit前先由授权latest读取定位该原SAVE key，再对该key准确读取并要求完整revision一致：RUNNING用有效fence形成真实读取观察，COMMITTING只读检查原结果，不制造新的RUNNING观察。错误ACK直接失败；丢失ACK才按原结果hash、attempt状态和嵌套同版Overall核对；COMMITTING不生成、不SAVE，仅重放原封存结果。

仍需区分三种实际内容：

1. `program-model-input`是传入适配器的请求。19d必要增量另保存实际`codex-prompt.txt`，父`assessment-round-1.codex-run`在spawn前持久绑定runRoot/runDirectory/requestId/argsHash及gateway/prompt摘要；bridge先fsync准确`upstream-request.json`字节，再将同一bytes交给HTTPSConnection。恢复核这些文件与原绑定；不把摘要当原文。
2. `upstream-response.json`格式为`chat-completions-sse-events-v1`，保存解析后的完整JSON事件序列及摘要。它已补齐原先缺失的上游事件内容，但没有保存原HTTP头、SSE分隔/编码/原始字节；不能称为原字节封存。
3. `result.value.raw`仍是确定性重建的`chat.completion`，是程序实际收到的完整适配器响应，不能替代前两者。

本次沿已有回执链接入prompt、bridge请求和启动前父run关联；仍不保存HTTP头/认证信息或逐字节SSE framing。完整解析后上游事件与程序收到的完整响应已分别定位；真实运行、目录持久性与恢复效果仍需现场证明，Host材料artifact不充当原始响应上传仓。

Host 的 `record_assessment_program_progress(MODEL_RESPONSE_SAVED)` 当前只接受 phase/checkpointRef，作用是记录消费者观察。Host 不是通用原始响应上传仓。`readBrowserProgramMaterials` 可读取实际材料 artifact 和观察状态，不能从进度标签重建丢失响应。

| 关联 | 当前真实依据 | 当前限制 |
| --- | --- | --- |
| intake → queue lease | Host 原受理 requestId、准确 WI、源/actor 与 owner | 与 stage begin requestId 不同 |
| stage → task/attempt | Host sealed task、operationRef、actionAttemptId、inputHash、mode/model | wire 名仍含 OpenClaw；不改变运行身份 |
| 传入适配器请求 → 程序收到的响应 | checkpoint binding/argsHash、固定modelRequestId、完整adapted raw及codexReceipt | 实际prompt与bridge body已独立留存并核摘要；原HTTP头/SSE framing未封存，不能扩大为原传输字节证明 |
| 子进程 → 上游内容 → 业务保存 | generation receipt/transport/解析后事件摘要、program-receipt-links | 已有机器关联；真实持久卷/调度宿主未验证，不做跨远端exactly-once承诺 |
| 响应 → SAVE | 候选检查点 + 原 program-save-request | 不能因SAVE异常换key/丢弃完整响应 |
| SAVE → 独立 READ | 同 attempt、saveRequestId、workRef/revision、有效 fence | SAVE ACK 或 latest 读取不能替代 |
| READ → 初评 Overall | `sourceAssessment` + Host `ASSESSMENT_WORK_READ` | 确定性投影，不代表模型再次综合或正式采用 |
| Overall → attempt → queue结束 | Host CAS、`finishProjectionSuccess`、完整 initial-analysis 状态、原队列 ACK | 元数据离线导出不证明真实闭合 |

## 3. 已配置、待配置和未知

名称级状态来自主控在 2026-10-25 的官方只读 CLI 结果；已取到的变量只有名称，没有值。详细安全摘要在 [observed-status.json](configuration/observed-status.json)，全部源码配置名称见 [source-names.json](configuration/source-names.json)。变量名存在只能证明名称登记，不能证明值正确、授权有效或运行健康。

| 项目 | 当前可确认状态 |
| --- | --- |
| 本地 Codex MCP/四条队列控制路由及身份 | 已实现；45工具 schema 离线导出并通过消费者 metadata 检查 |
| 本批 Host 技术部署 | 未部署本批本地接线 |
| dev / online `WL_MODEL_EXECUTOR` | 观察时名称不存在；新源码缺省 HOSTED |
| dev / online `WL_CODEX_*` | 观察时全部名称不存在 |
| Codex 精确路由 API Key 授权 | 观察时未配置；未读取任何 key 值或导出 key ID |
| 既有 `WL_OPENCLAW_*` 名称 | 部分已登记，安全摘要保留名称；值未读取，新CODEX不继承 |
| 新运行端客户端路径、私有配置和认证注入 | 实际宿主/调度、两个持久目录及卷耐久性未验证；不提供用户路径、凭据或外发地址 |
| 新 WI、intake/stage 请求、来源/actor授权、活动队列租约 | 待按实际新事项精确选定；包内只有合成例子 |
| 新Codex真实模型→Host SAVE/READ→Overall→页面→ACK | 尚未验收；合成服务测试不能升级为线上成功 |

首批最小配置名称如下；表中的常量仅为代码要求，不包含私有值：

| 名称 | 代码要求/用途 |
| --- | --- |
| `WL_MODEL_EXECUTOR` | `CODEX`，服务端唯一活动路线 |
| `WL_CODEX_RUNTIME_APP_ID` | 本批目标运行应用为`app_17gr74pbere`，由此配置读取；这是已定目标身份，不是配置值已现场验证的声明 |
| `WL_CODEX_SERVICE_SCOPE_ENABLED` | `1` |
| `WL_CODEX_GATEWAY_AUTH_MODE` | `API_KEY` |
| `WL_CODEX_SERVICE_SCOPE_ENV` | `DEV` 或 `UAT` |
| `WL_CODEX_SERVICE_PRINCIPAL_ID` | 独立 `service:` 身份；不得是 `service:openclaw-main`，也不得等于已配旧 principal |
| `WL_CODEX_SERVICE_TENANT_ID` | 获准准确 tenant，值不在本包 |
| `WL_CODEX_SERVICE_WORK_ITEM_ID` | 首个新事项准确 WI |
| `WL_CODEX_SERVICE_REQUEST_ID` | 原 intake requestId；不是stage begin key或SAVE key |
| `WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED` | `1`；业务仍须真实活动租约 |

首批队列只扫描该准确新 WI。旧 owner 租约、旧已领取 WAITING 项不因过期或换名而转交 Codex。附加文档/Matter/Review 配置名在源码里可映射，不表示本批已经迁移或获准执行这些入口。API Key 的授权必须覆盖精确 Codex MCP及所需四条控制路径，不能沿用仅有旧路径的 key 冒充新接线。

客户端接收Host task时要求显式配置的非旧runtime app与封存runtimePolicy精确匹配；任意app格式匹配不授予权限，也不把本批目标ID写成通用信任。首批scope显式拒绝CODEX Applicability、Review、待办Review发现、后继Review Overall与相关attempt入口，错误为`CANONICAL_CODEX_OPERATION_NOT_SUPPORTED`（403）。实际runtime是CODEX，shared历史app literal、Task/Result和旧MCP provenance key仍按原封存合同保留；Host另校验结果执行器标记与活动执行路线，不以旧wire名冒充新运行身份。Discovery接受CODEX来源，历史缺失appId不从当前配置回填。

宿主配置、旧入口停止新增领取和迟到写隔离的操作顺序及未验证项集中在 [ROLLOUT_AND_ISOLATION.md](ROLLOUT_AND_ISOLATION.md)。
