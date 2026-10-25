# Codex 逐消费者持久恢复与接口闭合

**历史交付范围：** 本文件保留 `925deb2d148a9eb8ed508300d7132fce55bc665c` 的逐消费者恢复与 166 项离线证据，不作为后续增量的重新验收记录。新路径/身份、COMMITTING 精确 key READ、私有输入与启动前 run 关联见 [本轮交付](CODEX_HOST_ALIGNMENT_VALIDATION.md)，对应结果单独留存；94c54de 的恢复框架继续复用。

日期：2026-10-25。实现父基线为 `94c54de74a0d7a0c0d66778a04a161e2017fce28`；其程序初评恢复、完整模型响应持久化和确定性 Overall 继续使用。此前实现 `1155c386`、接线记录 `fc132291` 仅作为已继承历史。本次没有从旧原型重新实现，也没有修改本地主控的 Host 集成工作树。

本报告区分消费者代码接入、实际消费者的离线中断测试，以及真实 Host 尚未提供的能力。测试使用真实 Node 消费者、模型适配器和 94c54de 的 `createCodexGateway`，由合成 Python runner 和合成 Host 提供外部响应。没有新增真实妙搭模型调用、真实 Host 保存或页面阅读；既有六次 GLM 实跑仍是合成 Host 证据。

## 按真实入口接入

| 流程 | 实际调用链 | 持久绑定与恢复结果 |
| --- | --- | --- |
| WorkItem 翻译 | `consumeHostedWorkItem` → `runHostedInitialStage` → `runSemanticTranslation` → `invokeHostedInitialModel` → 翻译 adapter → gateway | workItem、文档版本、stage requestId、attempt、workspace、generationRequestRef、purpose、准确 blockIds、材料摘要和 executionModel。主入口可识别本轮 CODEX 翻译的 BUSY 检查点，重新以原 stage requestId BEGIN；当前 Host 仍授权原 fence 时恢复原模型响应。 |
| 文档翻译 | `consumeHostedWorkItem` 的文档分支 → `runDocumentSemanticTranslationStep` → 翻译 adapter → gateway | documentVersionId、parseRunId、attempt、workspace、generationRequestRef、purpose、blockIds、材料摘要和 executionModel。持久保存原 NEXT clientRequestId。已接入回执消费，但当前 Host 的重新 CLAIM 行为阻断真实进程重启续存，详见下一节。 |
| 文件阅读 | `consumeHostedDocumentReading` → `invokeHostedDocumentReadingModel` → gateway | documentVersionId、runRef、parseRunId、semanticRevision、expectedRevision、sourceBinding、完整来源摘要及 executionModel。恢复原模型结果后继续原候选 SAVE；ACK 丢失先查 READING_STATUS，再独立读取并核对原候选与来源。 |
| 普通 Review | `consumePendingReviewTurn` → `runHostedReviewTurn` → `invokeHostedReviewModel` → gateway | review request/turn、attempt、Host task/inputHash、模型请求序号和完整请求。重启用原请求 BEGIN，同一任务的新 fence 必须先通过心跳和绑定验证；每轮只恢复原响应。 |
| Wiki SUMMARY | `consumeHierarchicalWikiIdle` → `consumeHostedDerivedSummary` → summary adapter → gateway session | summaryId、attemptRef、taskInputHash、固定 invocation、每个模型轮次及首次 timeout。SAVE_SUMMARY 使用原 task.requestId；丢 ACK 后 READ_SAVED_SUMMARY 核对准确版本，再 FINISH。 |
| Wiki MATTER | `consumeHierarchicalWikiIdle` → `consumeHostedMatter` → MATTER 专属 assessment round 分支 → gateway session | matterId、attemptRef、原任务、invocation、模型轮次、SAVE request key。新标记的 round.started 可以到达回执恢复；旧无标记 UNKNOWN 保持拒绝。现有 Matter CLAIM、SAVE 和读回机制继续使用。 |

每个新模型请求都使用已有业务身份产生固定 Codex requestId。共享 gateway 的原始请求绑定仍校验准确请求字节、模型和 runner 参数，`recoverOnly` 不允许创建第二次推理。输入对象在新的 CODEX 路径中使用规范 JSON，避免检查点重读改变键顺序；Wiki 的首次 timeout 也被冻结，不能因剩余时间变短而改变原请求绑定。

普通 Review 在 Host 报 BUSY 时继续等待。固定 Host 的 `get_pending_review_turn` 在 RUNNING 租约有效时返回 `next:null`；离线端到端测试先验证这一分支，再模拟租约到期后 Host 允许同一任务重新 BEGIN。恢复并不绕过队列或租约授权。

## 翻译的准确 Host 边界

这些结论来自 `fc132291` 的固定 Host 源码，不能冒充尚未取得的本地主控定稿接口包。相关代码是 `canonical-host-openclaw-translation.service.ts`、`canonical-translation-v2.service.ts`、`document-translation-runtime.service.ts` 和 `document-translation-attempt.repository.ts`。

### WorkItem 翻译

同一原请求、同一 owner 且原租约仍有效时，`begin_translation` 可以返回同一 attempt 和 fence。新客户端先完成这一授权核对，再恢复对应块的模型回执。若 Host 已签发不同 token 或 leaseGeneration，客户端返回 `TRANSLATION_RECOVERY_LEASE_CHANGED`，保留原材料与回执，不重推理、不用旧 lease 保存。

新 CODEX 翻译的 `READ`、`READ_BATCH` 和原请求 `NEXT` 都实际查询 Host，不再重放过时的通用 remoteStep 结果。保存等写步骤以 attempt、phase、原 generationRequestRef 命名，避免 REQUEST_RECONCILED 改变调用顺序后检查点串位。Host 已保存而 SAVE ACK 丢失时，同一 fence 下的原 NEXT 可返回 REQUEST_RECONCILED；消费者继续处理剩余批次和收尾，不再次 SAVE。如果只有写前标记、Host 仍显示 REGISTERED，则保持待确认；没有证据就不能判断该写入必然没有发出。

每个已完成批次的 execution/provenance 在 Host 写入前持久保存，按原 generation、task.inputHash 和执行模型绑定。恢复时跳过已保存批次，也仍将这些模型版本与用量计入最终出处。最终 ResultEnvelope 在 commit 前完整冻结，并按任务、attempt 与组装 artifact 核对复用；重启不会重新计算时间和用量而改变 contentHash。

如果 commit 只有 started 标记，消费者必须重新查询原 Host attempt。只有精确 taskType/attempt、`RUNNING`、`resultContentHash=null`、`commitStartedAt=null`、`projectionApplied=false`、`recoveryAvailable=false` 同时成立，才允许用原 fence 和同一冻结 Result 重试。缺失或矛盾字段不授权重试。已提交而 ACK 丢失时按原结果哈希查询，不能再次写入。SAVE/CHECK 的模糊 ACK 也只接受原请求的 `SAVED`；`FAILED` 和 `SUPERSEDED` 不被当作保存成功。

### 文档翻译

当前固定 Host 的文档 CLAIM 每次成功都产生新的 token 和递增的 leaseGeneration。如果存在上一代 fence 下仍为 REGISTERED 的 generation，CLAIM 直接返回 `REQUIRES_ATTENTION` / `DOCUMENT_TRANSLATION_GENERATION_OUTCOME_UNKNOWN`。这使“模型完成、消费者进程退出、重新 CLAIM、继续原 SAVE”在现有 Host 协议下无法完成。

即使 SAVE 实际成功、只丢失 ACK，原 NEXT 的幂等判断也先检查 leaseGeneration，再判断 request 是否已 SAVED。因此新 lease 使用原 clientRequestId 仍会冲突；现有 workspace READ 不等于按原 generationRequestRef 查询完整 SAVE 回执。客户端将此保留为 `DOCUMENT_TRANSLATION_ORIGINAL_GENERATION_LEASE_CHANGED` 或相应待确认状态。

文档测试中的 `synthetic-authorized-same-fence` 明确表示人为提供相同授权 fence，只用于验证消费者局部的回执与块绑定。默认 fixture 则遵循当前 Host 的新 lease 行为并验证阻断。两者不合并为“真实文档翻译恢复通过”。

本地主控需对同一原 generation 明确提供恢复授权或精确状态查询语义。应保留 tenant、actor、attempt、workspace、block revision、候选内容和 CAS 校验，不允许客户端任意更换 generation 或重绑定 lease。具体工具名称和参数应从其实际代码导出，本轮没有另造接口。

## 三类回执的关联

| 层级 | 本次新增消费者使用的记录 | 证明范围 |
| --- | --- | --- |
| 消费者任务与请求 | reading 的 model.started；翻译的 codex-translation started/pending-next；Review 的 model.started 与 review-codex-round started；Wiki 的 summary-codex started/round started、MATTER assessment-round started | 准确任务、材料、轮次或翻译块，以及对应固定 Codex requestId。 |
| 模型及进程 | 原 94c54de 的 generation-binding、runner-identity、upstream-response、contract-candidate、transport-summary、generation-receipt、adapted-response | 完整源响应、确定性适配、原进程完成和真实模型派发数。模型完成不是 Host 保存成功。 |
| Host 业务 | 原 generation/clientRequestId、reading run/revision、Review attempt/sealed result、summary task.requestId、Matter SAVE key 与独立 READ | 原请求保存、准确内容和版本。使用真实查询或准确幂等协议恢复 ACK，不把进程 closed 当作业务终态。 |

Wiki 队列保留已启动 Codex 的 active pointer，不能因为模型进程已关闭就 CANCEL 原业务任务或切到下一项。独立 Summary CLI 的 CODEX 分支也直接传递 Codex 配置，不再准备 Hosted native gateway。恢复过程中若某一轮已全部从 checkpoint 取出，session 仍从逐轮进程回执重建 aggregate receipt，不能伪造一次新的运行或遗漏关闭证明。

## 原程序初评成果保留

`codex-generation.mjs`、`run_codex_generation.py`、`miaoda_responses_bridge.py`、`run-program-assessment.mjs` 和 `initial-assessment-recovery.mjs` 保持 94c54de 的内容。MATTER 的新增恢复条件仅匹配 `wiselink.matter-jobaid-task.v2` 与 CODEX；没有替换或复制程序初评实现。程序初评的完整响应 → 固定 SAVE → 独立 READ → 确定性 Overall → 正常 ACK 继续按原图契约运行。最终离线记录包含这些文件相对于父基线的校验结果。

旧标记、旧任务和旧 UNKNOWN 不迁移。未单独测试的其他消费者也不能因共用 gateway 获得恢复验收状态。

## 可复用验证

完整命令、逐文件测试计数、退出状态及受测源码 SHA-256 见 [`consumer-recovery-validation-results.json`](consumer-recovery-validation-results.json)。原 `offline-validation-results.json` 保留为 94c54de 阶段记录，不覆盖历史。

最终统一验证为 **17 条命令全部成功、166/166 个子测试通过**。其中 70 项是原有回归，32 项是另行加入本轮验收的既有 Review 消费者回归，64 项来自五个新增测试文件。另执行真实 Zod 的 56 个接受／184 个拒绝用例，以及原 35 个机械转换输入样例；这些 Schema 用例不重复计入 166。

| 新增测试文件 | 子测试数 | 重点 |
| --- | ---: | --- |
| `translation-reading-recovery.test.mjs` | 28 | 阅读、WorkItem 翻译、文档翻译的局部能力与实际 Host 阻断；SAVE/commit ACK、逐块出处、最终密封结果、矛盾状态拒绝 |
| `review-wiki-recovery.test.mjs` | 18 | 普通 Review 完整入口与多轮来源、Wiki SUMMARY 完整消费者、租约更新、提交回执、队列 pointer |
| `wiki-matter-recovery.test.mjs` | 9 | Wiki MATTER 的多轮子进程恢复、原 SAVE 查询、最后一轮回执与任务漂移拒绝 |
| `host-packet-comparison.test.mjs` | 5 | 逐工具比较器的合成包匹配、缺失与差异、版本缺失、重复名称 |
| `host-contract-artifact.test.mjs` | 4 | schema 和用例证据绑定，防止 `{}`、放宽范围或改反例仍通过 |

```sh
node openclaw/codex-evaluator/translation-reading-recovery.test.mjs
node openclaw/codex-evaluator/review-wiki-recovery.test.mjs
node openclaw/codex-evaluator/wiki-matter-recovery.test.mjs
node openclaw/codex-evaluator/host-packet-comparison.test.mjs
node openclaw/codex-evaluator/host-contract-artifact.test.mjs
node openclaw/skills/wiselink-research-and-synthesize/tests/consume-hosted-review-turn.test.mjs
```

另复跑 94c54de 已有的 generation、程序恢复/结束、preflight、assessment session、消费者路由、Wiki gateway 和 Python bridge/runner 用例。Node 测试逐文件直接执行以取得真实子测试数量，不把 `node --test` 某些环境中的文件计数当作子测试总数。

SIGKILL 测试覆盖同一文件系统上进程终止与重启。没有模拟机器断电、持久卷回收或容器迁移；真实部署仍需确认 checkpointRoot 与 codexRunRoot 都位于保留的私有持久卷。

## 七项接口 Schema 与本地包对照

完整清单 42 项；原 35 项受限机械转换保持其原有语义限制，本次 7 项以真实 Zod 4.6.5 执行固定源表达式和依赖，0 项继续停留在 SOURCE_EXPRESSION_ONLY。覆盖 54 个动作分支、56 个接受和 184 个拒绝用例。TDMS 的规范编码、原子长度、安全整数等精化条件使用源判定函数执行；非空译文、strict、必填、枚举和边界均未放宽。

导出器检查 15 份源输入的 Git blob SHA 和 Zod 版本。JSON Schema 不能完整表达 trim 和自定义 refine，所以保留原 Zod 表达式与运行语义说明，不把标准 JSON Schema 当作完整业务 validator。生成时实际执行用例，普通 check 则核对已生成 schema、用例与独立证据摘要；篡改 schema 为 `{}`、放宽嵌套上限或修改反例都不能仅凭旧计数通过。

入口文件与命令见 [`host-contract/README.md`](host-contract/README.md)。`compare-host-interface-packet.mjs` 对完整 42 项逐工具输出差异，记录包版本、完整 commit 或版本号以及文件摘要。当前 [`contracts/host-packet-comparison.json`](contracts/host-packet-comparison.json) 保持 `PENDING_LOCAL_PACKET`：尚未取得本地主控带准确版本的可读取定稿包。自构包测试只验证对照器自身，不作为真实对齐证据。

## 本地主控仍需补齐

1. **准确本地接口包。** 提供与实际产品代码对应的完整 Host 提交 SHA、可读取包路径或附件、initialize/serverInfo 与 tools/list 原始 JSON。用户报告的 `1eb9bcc8` 仅文档/计划调整；本轮没有把它当成已合入产品代码。
2. **新服务身份与配置状态。** 核对 `/openapi/wiselink/codex-mcp` 与 `wiselink-codex-engineering-assessment@1.2.0`，以及 principal、tenant/actor、runtime/provenance 的准确授权。旧 openclaw-mcp 和旧服务身份不能通过新客户端绑定。只需回报字段和是否已配置，不提供凭据值。
3. **翻译原生成请求恢复。** 明确新 lease 对原 generation 的授权及已保存请求的精确查询方式，补实际 Host 测试。当前客户端已经保留原 NEXT、块和模型回执，但不能替 Host 改变 fence 约束。
4. **运行与验收。** 确认单一执行器入口、两个持久目录、准确新任务范围，再进行正式凭据配置、切换、真实 SAVE/独立 READ/页面阅读和 Overall 对照。本轮未执行这些动作。

