# 执行回执与配置状态

## 1. 已有的请求—响应绑定

程序初评已有持久入口，并非只有模型原型。`assessment-enabled.binding` 固定 operation、准确 modelInput、session discriminator、executionModel，以及 CODEX 时的 `modelExecutor`。`program-model-input` 保存 `run-program` 传入 `createCodexGateway` 的完整两消息/函数候选请求。`assessment-round-1.started` 与 `.result` 都保存原 `argsHash=canonicalSha256({body,executionModel})`，结果记录完整 `{raw,status,ok}`；不匹配拒绝。`program-save-request` 固定原保存 key、CAS 和正文，`program-work-readback` 固定准确保存修订。

CODEX适配器实际把这份请求封装进新的Codex prompt，随后Codex/bridge转换为上游HTTP请求。材料快照不等于真正上游payload；`PREPARED_NOT_CONFIRMED_SENT`仍表示程序准备证据，不能推断已发出或实际服务已接收。

这些现有绑定可以把程序收到的完整适配器响应、候选和 SAVE/READ 连回该 task；不能据此声称 Host 已持有所有上游原始字节或 Codex 子进程回执。

## 2. 当前 Codex 回执边界与剩余缺口

`codex-generation.mjs` 创建独立 generation run，调用 `run_codex_generation.py`。runner 保留 `codex.events.jsonl`、`codex.stderr.log`、`final.txt`、`contract-candidate.json`、`bridge.audit.jsonl` 和 `transport-summary.json`。summary 记录实际进程退出、超时/错误、上游请求数、模型、token 计量、终态事件、闭合、源配置未变和转换检查；适配器只在相应实际检查通过后返回候选。

但当前有三条不能抹平的差异：

1. `run-program` 的 `result.value.raw` 在 CODEX 路线是适配器重新构建的 `chat.completion`。它是程序实际收到并保存的完整响应，含转换标记 `codex-structured-final-to-function-contract-v1`；不是上游原始 SSE/HTTP 字节。
2. generation 的 `onRunCompleted({runDirectory,transport})` 是可选回调，当前消费者尚未绑定。重建的响应中没有 child run/transport receipt；`transport-summary.json` 自身没有 attemptRef、stage requestId 或 SAVE key。因此不能把一次成功进程摘要自动归属某个 Host attempt。
3. `bridge.audit.jsonl` 保存请求/响应 metadata；本次源码没有把完整原始上游 SSE 响应写入该日志。Codex events/final 与转换后的 raw 不能替代原字节。

这不是要求重建执行内核。若首条真实验收要求“执行回执可机器关联、完整响应是原字节”，应由执行器 owner 在既有适配器窄补：把真实 `executorReceipt` 连同响应返回，使其随现有 argsHash/result 检查点落盘；在原 run 目录保存实际Codex prompt、bridge上游payload、完整上游响应及准确引用，连回原adapter请求argsHash、task/attempt。沿同一现有回执链交接，不再造一套业务协议。此包只记录审查结果，没有替 owner 修改生成器或伪造回执。

Host 的 `record_assessment_program_progress(MODEL_RESPONSE_SAVED)` 当前只接受 phase/checkpointRef，作用是记录消费者观察。Host 不是通用原始响应上传仓。`readBrowserProgramMaterials` 可读取实际材料 artifact 和观察状态，不能从进度标签重建丢失响应。

| 关联 | 当前真实依据 | 当前限制 |
| --- | --- | --- |
| intake → queue lease | Host 原受理 requestId、准确 WI、源/actor 与 owner | 与 stage begin requestId 不同 |
| stage → task/attempt | Host sealed task、operationRef、actionAttemptId、inputHash、mode/model | wire 名仍含 OpenClaw；不改变运行身份 |
| 传入适配器请求 → 程序收到的响应 | 已有 checkpoint binding + argsHash + 完整适配器 raw | 不能等同真正上游HTTP payload；缺prompt/bridge payload/child receipt内联关联及上游原字节 |
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
| 新运行端客户端路径、私有配置和认证注入 | 本包未知/未配置证明；不提供用户路径、凭据或外发地址 |
| 新 WI、intake/stage 请求、来源/actor授权、活动队列租约 | 待按实际新事项精确选定；包内只有合成例子 |
| 新Codex真实模型→Host SAVE/READ→Overall→页面→ACK | 尚未验收；合成服务测试不能升级为线上成功 |

首批最小配置名称如下；表中的常量仅为代码要求，不包含私有值：

| 名称 | 代码要求/用途 |
| --- | --- |
| `WL_MODEL_EXECUTOR` | `CODEX`，服务端唯一活动路线 |
| `WL_CODEX_RUNTIME_APP_ID` | 新运行端，格式 `app_...`，不借用旧运行端 |
| `WL_CODEX_SERVICE_SCOPE_ENABLED` | `1` |
| `WL_CODEX_GATEWAY_AUTH_MODE` | `API_KEY` |
| `WL_CODEX_SERVICE_SCOPE_ENV` | `DEV` 或 `UAT` |
| `WL_CODEX_SERVICE_PRINCIPAL_ID` | 独立 `service:` 身份；不得是 `service:openclaw-main`，也不得等于已配旧 principal |
| `WL_CODEX_SERVICE_TENANT_ID` | 获准准确 tenant，值不在本包 |
| `WL_CODEX_SERVICE_WORK_ITEM_ID` | 首个新事项准确 WI |
| `WL_CODEX_SERVICE_REQUEST_ID` | 原 intake requestId；不是stage begin key或SAVE key |
| `WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED` | `1`；业务仍须真实活动租约 |

首批队列只扫描该准确新 WI。旧 owner 租约、旧已领取 WAITING 项不因过期或换名而转交 Codex。附加文档/Matter/Review 配置名在源码里可映射，不表示本批已经迁移或获准执行这些入口。API Key 的授权必须覆盖精确 Codex MCP及所需四条控制路径，不能沿用仅有旧路径的 key 冒充新接线。
