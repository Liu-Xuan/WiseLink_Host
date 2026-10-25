# Codex 消费端持久恢复交付与离线证据

日期：2026-10-25。本文件记录已交付提交 `94c54de74a0d7a0c0d66778a04a161e2017fce28` 的程序初评恢复成果，其实现与接线来源为 `1155c386fff03eeb1753a6af3aab6f337a4413b6`、`fc1322919b1b52433c33086c8db4aeb957f0e982`。这里的 70 项测试及 `offline-validation-results.json` 是该阶段的历史证据，不能代替后续变更的验证。本轮从 94c54de 继续扩展的逐消费者实现、准确边界和新测试见 [`CONSUMER_RECOVERY_VALIDATION.md`](CONSUMER_RECOVERY_VALIDATION.md)。

## 本批实现范围

`PROGRAM_CONTROLLED_V1` 保持原图契约：程序准备材料，一次生成，先持久化完整响应，再以固定请求保存，独立 READ，最后由 Host 确定性投影 Overall。新恢复能力接入该真实消费者，以及共享 Codex generation runner；没有新增业务接口、双消费者调度系统或历史任务迁移。

已实现：

- Codex 客户端只接受准确的新 MCP 配置键、HTTPS `codex-mcp` 路径和独立服务器 name/version。preflight 将旧配置与 Codex 配置分开盘点，不将配置存在当作授权成功。
- 程序初评在派发前记录固定模型请求 ID `program:<attemptRef>:round-1`、材料和完整请求。共享 gateway 对该 ID 创建排他运行目录；原调用的 body、模型选择及 runner 选项必须相同。
- 子 runner 保存完整上游 SSE 事件、结构化候选、transport summary 和回执。父进程即使来不及写入 assessment round 结果就退出，重启仍可读取原回执；正在运行的原子进程可被等待，不会替换成另一个模型调用。
- SAVE 请求 ID、CAS 基线与完整 `workJson` 在 SAVE 前写入 checkpoint。ACK 丢失时按原 requestId READ；保存成功后再次 READ，不以 SAVE ACK 充当独立读回。
- READ 绑定实际 Host 的 attempt、workItem、documentVersion、baseRevision、workRevision 和原请求。Host 会 trim、合并未改动问题并补充来源/风险字段，消费者按准确版本和 authored 正文核对，不对未材料化候选与保存体做错误的整体字节比较。
- 收尾前用现有 unfenced latest READ 取得原 SAVE ID 与 revision，再验证 commit ACK 与嵌套 Overall。收到但不合法的 ACK 直接失败，不会被 `SUCCEEDED` 状态掩盖。丢失 commit ACK 时核对原 result hash 与同版 Overall。COMMITTING 仅重放 Host 冻结的 result，不调用模型或重新 SAVE。
- checkpoint 与新建目录链采用写文件、fsync、rename/link、目录 fsync 的顺序。文件为 0600、私有目录为 0700；唯一临时文件避免崩溃遗留的同 PID 临时名阻塞恢复。

上述“持久”在测试中指同一文件系统上的进程退出与重启。代码执行 fsync，但容器销毁、机器断电和平台卷回收未实测；真实接线必须确认 runRoot 和 checkpointRoot 都位于保留的持久卷。只保留其中一个目录不足以覆盖全部恢复点。

## 三类回执如何关联

| 层级 | 原始文件／身份 | 证明范围 |
| --- | --- | --- |
| 模型请求与响应 | `program-model-input.json`、`assessment-round-1.started.json`、`upstream-response.json`、`adapted-response.json`、`assessment-round-1.result.json` | 原请求、全部响应、模型与 usage；不能证明 Host 保存 |
| Codex 进程 | `generation-binding.json`、`runner-identity.json`、`contract-candidate.json`、`transport-summary.json`、`generation-receipt.json` | 请求绑定、模型派发数量、Codex/进程组结束、完整源响应哈希与候选；不能证明业务成功 |
| Host 保存 | `program-save-request.json`、`program-save-started.json`、`program-save-receipt.json`（若取得 ACK）、`program-work-readback.json` | 原 SAVE ID、CAS、准确保存版本和独立 READ；ACK 丢失时仍保留原请求与真实读回 |
| 关联索引 | `program-receipt-links.json` | attempt/workItem/document/baseRevision → modelRequestId/argsHash/responseSha256/runDirectory → saveRequestId/workRevisionRef/workRevision/独立 READ checkpoint |
| Host 收尾／Overall | 冻结 ResultEnvelope 的 `contentHash`、`get_action_attempt_status`、`get_parse_status.integratedAssessmentSummary` | 同一 result 的提交状态，且 Overall 来自相同 actionAttempt、SAVE ID 和工作版本；`modelRequests=0` |

这些关联使用已有业务身份。新增 `program-receipt-links.json` 是消费者本地索引，不是新的 Host API 或授权对象。认证头不进入模型/请求快照或关联索引；业务材料与完整模型响应仍是私有运行产物，不应加入公开 Git。

## 崩溃点和恢复结果

| 断点／故障 | 恢复动作 | 离线断言 |
| --- | --- | --- |
| 父进程退出，原 runner 仍在执行 | 识别原 runner 并等待原回执；取消等待只停止观察 | 一个模型派发，不启动第二个 runner |
| runner 已留完整回执，消费者尚未写 round result | 仅恢复原回执，确定性重建完整适配响应 | response 字节相同、原请求身份不变 |
| 完整 round response 已保存，SAVE 前进程退出 | 使用原响应与原 SAVE 请求继续 | 模型一次、SAVE 一次、保存一次 |
| Host 已保存，SAVE ACK 前进程退出 | 原 requestId READ 找到保存版本 | 模型一次、SAVE 调用一次、保存一次 |
| SAVE 成功后抛出 ACK 丢失异常 | 原 requestId 独立 READ | 不生成新 SAVE 请求 ID |
| 独立 READ 后进程退出 | 重新核对稳定 revision，保留首次完整 read packet | 允许 observation/preparation 元数据更新，不重复 SAVE |
| 只有派发标记，没有有效子进程回执 | 保持 `CODEX_GENERATION_OUTCOME_UNKNOWN` | 不重新推理，不伪造完成 |
| READ 失败／跨 attempt／正文或 SAVE payload 变化 | 明确失败，保留原响应和请求 | 不收尾，不悄悄更换绑定 |
| commit ACK 丢失，attempt 为 SUCCEEDED | 核对 result hash，再读同版嵌套 Overall | 缺失/错误 Overall 不能通过 |
| 收到错误 ACK | 在 RPC catch 外校验并失败 | 不用之后的状态掩盖错误 ACK |
| Host 为 COMMITTING | 精确 READ 原保存，重放原冻结 result，再读 Overall | 模型零新增、SAVE 零新增 |

这不是跨进程、数据库和远端模型之间无条件的 exactly-once 承诺。可恢复的已完成记录复用原身份；没有完成证据的派发不确定态保持 UNKNOWN。Host 自身仍必须保证相同 requestId/payload 的幂等性与事务 CAS。

## 可复用离线验证

以下命令从仓库根目录执行，不需要真实凭据。直接执行每个 Node 测试文件可以看到该文件的子测试数量；部分托管运行环境的 `node --test` 外层只汇报文件数量，不能把那个数字当作子测试总数。

```sh
node openclaw/codex-evaluator/codex-generation.test.mjs
node openclaw/codex-evaluator/codex-generation-recovery.test.mjs
node openclaw/codex-evaluator/program-recovery.test.mjs
node openclaw/codex-evaluator/program-finish-recovery.test.mjs
node openclaw/codex-evaluator/preflight.test.mjs
node openclaw/codex-evaluator/assessment-session.test.mjs
node openclaw/skills/wiselink-research-and-synthesize/scripts/model-executor-consumers.test.mjs
node openclaw/skills/wiselink-research-and-synthesize/scripts/derived-summary-codex-gateway.test.mjs
python3 -m unittest discover -s openclaw/codex-evaluator -p 'test_*recovery.py'
python3 -m unittest discover -s openclaw/codex-evaluator -p 'test_miaoda_responses_bridge.py'
node openclaw/codex-evaluator/check-host-contract.mjs
```

`program-recovery.test.mjs` 在子进程内执行真实程序消费者和真实 checkpoint 实现，以 SIGKILL 注入断点，再启动新进程。模型与 Host 是明确的文件持久化 fake。`codex-generation-recovery.test.mjs` 执行实际 Node gateway 与 fake runner；Python 的两项 runner 测试执行真实 `run_codex_generation.py`，使用 fake Codex 与本地 bridge stub，验证完整回执以及残留子进程不能算 transport 成功。它们不等同于真实妙搭模型或真实 Host 测试。

本批稳定代码共 **70/70 项离线测试通过**，另有 **35/35 个 schema 输入样例通过**。其中 gateway 恢复 7 项、程序消费者崩溃恢复 9 项、结束/Overall/COMMITTING 13 项、配置预检 4 项、真实 Python runner 配合 fake Codex 的恢复 2 项；其余 35 项为已有 adapter、assessment session、消费者路由、Wiki 和 bridge 回归测试。测试数包含既有回归，不表示新增了 70 项测试。

机器结果及受测文件 SHA-256 见 `offline-validation-results.json`。完整可复用接口样例见 `contracts/program-recovery-example.json`，可重新生成：

```sh
node openclaw/codex-evaluator/export-program-recovery-example.mjs
```

样例中的模型请求、响应、SAVE、查询和 READ 来自离线 fixture 的实际执行；claim/begin/commit/Overall/queue ACK 是经客户端校验的合成协议示例。两类证据在文件中明确区分。测试材料不代表真实工程结论，UUID 不是凭据。

## Host 必须补齐的具体信息

1. 主控集成树的可核对完整 SHA 和实际产品代码。用户报告 `1eb9bcc8` 仅为文档/计划调整；本轮不能从公开 ref 取到该树，固定 legacy Host 源码不替代它。
2. `/openapi/wiselink/codex-mcp` 实际服务地址、initialize 的 serverInfo、tools/list 原始结果，以及新服务 principal 对应的 tenant/actor/runtime 注册范围。旧 endpoint/name 不能用来通过 Codex 绑定检查。
3. 当前共享 Task/Result/provenance 契约的准确处理方案：`validate-payload.mjs` 保留 `app_17c3zn24kv2` 运行时常量、OpenClaw 命名的 envelope/taskType 和 provenance key。新应用 `app_17gr74pbere` 不会因此自动成为旧身份；需双方对准确 Host 验证规则修改并测试，不能仅放宽校验或全局字符串替换。
4. 新任务的 claim/begin/materials/SAVE/READ/Overall 实际返回样例；尤其是 stage requestId 与 queue requestId 的区别、服务端 SAVE 幂等与 CAS、授权的 unfenced latest READ，以及独立 READ 的记录行为。
5. 新应用的 Codex 二进制、已有妙搭模型配置引用、两个持久目录，以及单一业务入口的启停/登记状态。配置清单见 `contracts/runtime-configuration-status.json`，不需要回报凭据值。
6. 在准确新任务范围确认后，另行配置凭据/切换入口并进行一次真实保存、页面阅读与 Overall 对照。新代码本轮未部署到妙搭，未新增真实调用。

## 94c54de 当时未覆盖的消费者范围

94c54de 的完整“派发标记 → 原子进程回执重新接续”恢复接入聚焦程序初评；其他消费者当时没有同等的逐入口中断证据。本轮已按用户要求扩展翻译、文件阅读、普通 Review 和 Wiki，分别记录真实调用链测试与尚受 Host 协议约束的分支，见上述新报告。文档活动等未在本轮单独验证的流程，不因共享 gateway 被算作已完成恢复。旧任务和旧 UNKNOWN 不迁移。

历史六次 GLM 实跑仍为 synthetic Host 证据，原证据文件保持不变。本轮离线通过不等于真实 Host 已接线、产品代码已集成、业务已保存或页面已经读到结果。
