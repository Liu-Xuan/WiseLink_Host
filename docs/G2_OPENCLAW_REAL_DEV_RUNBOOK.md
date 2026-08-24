# G2 OpenClaw 真实 DEV 纵切 Runbook

## 1. 完成口径

唯一可验收链路是：真实 Host 创建并持久化 `ActionAttempt=QUEUED`，PostgreSQL 原子 claim/lease 后进入 `RUNNING`，专用 OpenClaw Gateway agent 调用 `wiselink/wiselink-direct-llm`，executor 提交完整 `ResultEnvelope`，Host 跨过 `COMMITTING` 截止点，Result Gate 校验实际模型字节，最后通过 WorkItem revision CAS 写入 candidate-only projection 并回读 FileService/DB/浏览器。

以下均不算完成：fixture、simulation、loopback executor、直接调用 provider、`main` OpenClaw agent、只跑单测、只看 HTTP 200、只看到容器 healthy、绕过 Host 写 WorkItem、把损坏结果替换为 `{}`。

## 2. 固定基线与代码目标

- canonical baseline：`codex/wl31-mainline@006146b2267e0dc316f9550411c178a292f9b04b`
- 本方向分支：`codex/g2-openclaw-real-chain`
- migration：`migrations/0003_action_attempt_openclaw_v1.sql`
- Host 状态机：`server/modules/action-attempt/`
- OpenClaw worker：`scripts/run-openclaw-action-attempt-worker.mjs`
- 不 push、不合并、不部署生产；只使用一个全新隔离 DEV/UAT DocumentVersion 和其新建 WorkItem。

## 3. 写入目标、owner 与审批点

| 阶段 | exact target | owner | 写入/冲突域 | 开始前条件 |
| --- | --- | --- | --- | --- |
| DB migration | WiseLink 3.1 **DEV/UAT 应用数据库**的 `action_attempt` | 应用 DB owner | 新增列、partial indexes、check constraints；不得指向生产 DB | DB target/tenant 明确；应用 owner 批准 migration 与读回 |
| DEV 输入 | 一个新建、非历史业务对象的 current `DocumentVersion` | DEV 数据 owner | Document catalog/FileService 新资源 | 用户授权的新隔离资源；禁止复用受保护 WorkItem/附件 |
| Host env A | WiseLink 3.1 DEV Host | 应用 runtime owner | 仅 exact DocumentVersion + run token 创建 scope | API Key gateway 已启用；值不写日志/commit |
| Host env B | 同一 DEV Host | 应用 runtime owner | 仅 exact returned WorkItem scope | 创建响应已回读 WorkItem ID；撤销创建开关 |
| OpenClaw | 专用 DEV Gateway state/config | OpenClaw runtime owner | 新增 `g2-action-attempt` agent 和 HTTP endpoint；不改 `main` agent | 独立 Gateway token；Host 端仅走 loopback 或 HTTPS |
| CAS 冲突/回退演练 | 上述唯一 DEV WorkItem 的 `revision` | 应用 DB owner | 仅该行；不得修改其他 WorkItem | 单独批准；先记录原 revision/projection；逐项执行并读回 |

任何 target、tenant、DocumentVersion、WorkItem 或 Gateway 身份不明确时停止，不猜测。

## 4. PostgreSQL migration 与强制读回

在 **DEV/UAT 应用 DB** 应用 migration 后执行文件尾部的 `pg_indexes`/`pg_constraint` 查询，并额外确认：

```sql
SELECT status, count(*)
FROM action_attempt
GROUP BY status
ORDER BY status;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND tablename = 'action_attempt'
ORDER BY indexname;
```

必须观察到：

- `uk_action_attempt_active_work_task` 只约束 active 状态，保证同 WorkItem 同 task 唯一；
- `uk_action_attempt_lease_slot` 只约束 `RUNNING/COMMITTING`，每 tenant/request origin 只有槽 `0..3`；
- terminal row 释放 slot；不同 WorkItem 最多四个并行；第五个保留 `QUEUED` 并返回 bounded 503；
- idempotency、operation ref 与 retry/lease generation 约束存在；
- `executor_session_key` 必须等于 `g2-action-attempt:<operationRef>`，与 Gateway HTTP `user` 路由键一致；
- migration 失败不得启动 worker。

## 5. Host 两阶段 exact scope

阶段 A 只允许创建一个新 DEV WorkItem：

```text
WL_OPENCLAW_SERVICE_SCOPE_ENABLED=1
WL_OPENCLAW_GATEWAY_AUTH_MODE=API_KEY
WL_OPENCLAW_SERVICE_SCOPE_ENV=DEV
WL_OPENCLAW_SERVICE_PRINCIPAL_ID=service:openclaw-g2-dev
WL_OPENCLAW_SERVICE_TENANT_ID=<exact-dev-tenant>
WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED=1
WL_OPENCLAW_DEVELOPMENT_DOCUMENT_VERSION_ID=<exact-new-current-document-version>
WL_OPENCLAW_DEVELOPMENT_RUN_TOKEN=<new-uuid>
```

用 API Key 调用一次：

```http
POST /api/openapi/wiselink/development-work-items
Content-Type: application/json

{
  "documentVersionId": "<exact-new-current-document-version>",
  "developmentRunToken": "<same-new-uuid>",
  "query": "applicability"
}
```

fresh-read 响应、WorkItem status、DocumentVersion currentness 与 FileService artifact；保存 returned `WI-...`，不得输出 API key。

阶段 B 撤销创建能力并绑定唯一 WorkItem：

```text
WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED=0
WL_OPENCLAW_SERVICE_WORK_ITEM_ID=<returned-WI-id>
WL_LOCAL_U0_PYTHON=<absolute-python3-path-with-jsonschema>
```

重启 DEV Host 后，用错误 WorkItem ID 做一次 404 fail-closed 读回，再用 exact ID 读取成功。
`NODE_ENV=development` 且 `MIAODA_LOCAL_DEV=1` 时，Host 必须显式设置
`WL_LOCAL_U0_PYTHON`；缺失即以 `FULL_U0_VALIDATOR_UNAVAILABLE:LOCAL_PYTHON_REQUIRED`
停止启动，不得回退到 partial validator。妙搭本地路由前缀为
`/app/<app-id>/openapi/wiselink/openclaw-mcp`，托管 DEV 路由仍以部署返回的
`/api/openapi/wiselink/openclaw-mcp` 为准，不得互相猜测替换。

## 6. 专用 OpenClaw Gateway

不得使用当前共享 `main` agent。专用配置至少满足下列形状：

```json
{
  "plugins": { "allow": ["wiselink"] },
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  },
  "agents": {
    "list": [
      {
        "id": "g2-action-attempt",
        "model": {
          "primary": "wiselink/wiselink-direct-llm",
          "fallbacks": []
        },
        "skills": [],
        "tools": {
          "profile": "minimal",
          "allow": ["session_status"]
        }
      }
    ]
  }
}
```

Gateway 必须使用独立 token；token 只放 secret/env，不进 argv、日志、证据或 Git。Host worker 的配置为：

```text
WL_OPENCLAW_HOST_MCP_URL=<dev-host>/api/openapi/wiselink/openclaw-mcp
WL_OPENCLAW_HOST_API_KEY=<secret>
WL_OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
WL_OPENCLAW_GATEWAY_TOKEN=<secret>
WL_OPENCLAW_CONTAINER_NAME=<dedicated-dev-openclaw-container>
```

worker 会在 RUNNING claim 后验证 agent/model/fallback/tools/skills/endpoint/plugin allowlist；不满足即提交显式 `FAILED ResultEnvelope`，不会降级到 CLI、provider 直连或 simulation。模型输入只进入 HTTPS/loopback HTTP body，不进入进程 argv。若 Host 读到同 attempt 已在 `COMMITTING`，begin 会返回 DB 中重新校验过 hash/binding 的 `recoveryResult`；worker 只重放 Host commit，不再调用 OpenClaw。

## 7. 唯一真实运行顺序

```bash
node scripts/run-openclaw-action-attempt-worker.mjs \
  --task dynamic \
  --work-item-id <returned-WI-id>

node scripts/run-openclaw-action-attempt-worker.mjs \
  --task overall \
  --work-item-id <same-WI-id>
```

overall 首次使用 `providers=[]`；只有 Host 已存在明确 gap 时才按需传 `--providers AIRBUS,BOEING,COMAC` 的相关子集。

## 8. 故障与恢复验收矩阵

每项都只使用同一隔离 DEV WorkItem；需要直接 DB 写的项目必须按第 3 节单独批准。

1. **重复 begin/投递**：相同 WorkItem/revision 再运行同 task，必须返回同 attempt/fence 或明确 terminal receipt，不创建第二个 active 同类 attempt。
2. **Host 5xx/断连**：在 begin 与 commit 响应路径各注入一次 bounded 502/503/504；worker 最多三次退避重试，Host 最终只有一次 projection CAS。
3. **worker 重启**：在 `RUNNING` 杀 worker；60 秒 lease 到期后重启同命令，必须 `RETRY_SCHEDULED→RUNNING`、generation 递增、旧 fence commit 被拒绝。
4. **服务重启**：在 `RUNNING` 重启 Host，再 heartbeat/commit；DB lease 是权威，内存丢失不影响恢复。
5. **取消**：在 `RUNNING` 调 `cancel_action_attempt`，row 进入 `CANCELLED`、slot 清空、旧 executor 不能提交。
6. **COMMITTING/cancel race**：观察到 `COMMITTING` 后取消必须返回 too-late；不得回滚已越过的 durable cutoff。
7. **COMMITTING recovery**：在 `COMMITTING` 后、terminalize 前终止 Host 或 worker；重启 Host 后重新执行同一 worker 命令。重复 begin 必须返回 DB 中同一 fence 与 `recoveryResult`，worker 的 transport proof 为 `HOST_DURABLE_RESULT_REPLAY` 且 OpenClaw 调用计数不增加。若 projection 已 CAS，则按 actionAttemptId 对账并终态成功；若未 CAS，则使用同一完整 ResultEnvelope 继续一次真实 Host Result Gate/projection。
8. **CAS conflict**：在模型运行后用另一个合法 DEV 动作把 revision 提升 1，commit 必须 `CONFLICT`；提升超过 1 必须 `OBSOLETE`。
9. **revision regression**：经单独 DB owner 批准，仅把隔离行 revision 临时设为 `< baseRevision`；commit 必须 `FAILED/WORK_ITEM_REVISION_REGRESSED`，projectionApplied=false。随后按审计记录恢复该测试行。
10. **损坏 ResultEnvelope**：缺字段、额外字段、错误 hash、错误 WorkItem/base revision、损坏 stored JSON 各提交一次，必须明确 4xx/409；DB 不得出现 `{}` 替代结果。
11. **并发槽**：五个不同隔离 WorkItem 同 tenant 同时 claim；只有四个进入 `RUNNING/COMMITTING`，第五个保持可重试队列状态。相同 WorkItem 同类 task 始终只有一个 active row。
12. **deadline**：超过 deadline 的 claim、heartbeat、commit 均必须终态 `TIMED_OUT`，slot 释放，迟到结果被 fence 拒绝。

## 9. 可观测验收证据

最终证据包只含 ID/hash/status/时间/计数，不含 prompt、原文、token 或 API key：

- DB：attemptId、operationRef、executor session key、status transition、claim/retry count、lease generation/slot、base/current revision、terminal reason、projectionApplied、ResultEnvelope hash；
- OpenClaw：dedicated agent ID、configured provider/model、HTTP run 成功、stop reason、duration；
- Host：MCP begin/heartbeat/commit 的 request correlation 与 CAS result；
- FileService：动态和 overall 实际 artifact ref、sha256、byte length 及 readback hash；
- 浏览器：同一 WorkItem fresh projection 显示 `BASE_RULE_CANDIDATE_READY` 与 `OVERALL_CANDIDATE_READY`，刷新后仍存在；
- non-claims：candidate-only；没有工程批准、AEO 确认、current selection 改动、发布、生产部署或适航结论。

## 10. 2026-08-24 隔离 DEV 实跑证据

唯一新建资源为 `document_version_f4813607b91ee1a20e754e2d` 和
`WI-5e2e17a2-0b47-44c9-b5e6-38e4acd4db27`；Document catalog current generation
为 1，WorkItem 最终 revision 为 5。专用容器 `wiselink-g2-openclaw-dev` 的 Gateway
为 `127.0.0.1:18791`，agent 为 `g2-action-attempt`，provider/model 为
`wiselink/wiselink-direct-llm`；没有使用共享 `main`、provider 直连、simulation 或
loopback executor。

- dynamic：`ATT-1e15d705-28c1-4de1-b62a-0e512d26d855`，ResultEnvelope hash
  `46f9978e08c3d4dd9a1bf1a26d169abca6e0b2fcbf2576585451dfd4a8ead9b7`，
  `SUCCEEDED/PROJECTION_CAS_APPLIED`，revision `3→4`；FileService artifact
  `f614137da74dedf00f4289982d05b0d11d245307d4360b4b1006512dfd16e9da`，
  32606 bytes，下载后 hash/length 一致。
- overall：`ATT-2805df1a-b0d3-47fb-bd24-41760fb4a429`，ResultEnvelope hash
  `52ce3b1a88203f63ec2fc92294b26992fba8f0d1323112a556113c454acb30be`，
  `SUCCEEDED/PROJECTION_CAS_APPLIED`，revision `4→5`；FileService artifact
  `fdcd12620395c5a79731bcc6cae5822af5a5a404ce0a940658cac8925dbc44a0`，
  5098 bytes，下载后 hash/length 一致。
- 同一用户 fresh-read 显示 `BASE_RULE_CANDIDATE_READY` 与
  `OVERALL_CANDIDATE_READY`；两者均为 candidate-only，未产生 AEO/工程批准。
- 真实故障项：重复 begin 返回同 attempt/fence；RUNNING cancel 进入
  `CANCELLED_BY_REQUEST` 且不改 revision；60 秒 lease 过期后同 operation ref
  `claimCount 1→2`、`retryCount 0→1`、`leaseGeneration 1→2`；Host 进程重启后
  仍从 PostgreSQL 完成相同恢复，取消后 token/slot 均清空；另有真实 deadline
  超时与 late-commit fence 拒绝。多种实际损坏模型输出均明确终态
  `FAILED/HOST_RESULT_GATE_REJECTED`，完整 ResultEnvelope hash 保留，未静默写成 `{}`。

尚未宣称真实 DEV 通过的矩阵项：注入 Host 5xx、五 WorkItem 并发槽、
`COMMITTING/cancel` too-late 竞态、合法 revision 变更引发的
`CAS CONFLICT/OBSOLETE`、`currentRevision < baseRevision` 以及人为损坏 stored JSON。
其中 5xx bounded retry 与 durable COMMITTING replay 已由 worker HTTP 测试覆盖；其余只保留
focused state-machine/Result Gate 测试证据，不能替代后续单独批准的真实 DEV 演练。

## 11. Native/Open-source reuse audit

### 11.1 已核验的原生能力与处置

| 能力/真实证据 | 处置 | 理由与精确实现 |
| --- | --- | --- |
| 妙搭应用原生 FileService：`lark-cli 1.0.87 apps +file-get` 对隔离对象 `/1874368159994884.pdf` 实际读回 `application/pdf`、1060204 bytes | `REUSE_NATIVE` | 浏览器上传应直接使用已安装的 `@lark-apaas/dataloom@0.1.4` storage；其本地官方 SDK 实现走 runtime `pre_upload → object uploadUrl → callback`，不再增加 WiseLink 分片协议。Host 只注入 `@lark-apaas/fullstack-nestjs-core@1.1.57` 的 `FileService`。 |
| `MiaodaFileServiceArtifactStore` 的 `FileService.download(...).asStream()`、locator/version 校验、流式 byte count、SHA-256、immutable readback；本次 source 与 canonical artifact 均实际 hash/length 一致 | `ADAPT_EXISTING` | 复用 `server/modules/document-management/src/hosted/miaodaFileServiceArtifactStore.js` 和 `documentManagementHostedCore.js`，只保留 DocumentVersion/acquisition/correlation 薄适配。当前原生入口上限按 100 MiB 处理；更大文件是 backlog，非主链 blocker。 |
| 妙搭 DEV PostgreSQL/Dataloom：CLI 实际读回 `action_attempt` 的 49 个业务列、平台 4 个审计列、FK/unique 约束和 11 个索引；运行时使用 `DRIZZLE_DATABASE` | `REUSE_NATIVE` | 复用官方 `@lark-apaas/fullstack-nestjs-core` DB provider、`drizzle-orm@0.44.6`（Apache-2.0）和平台 transaction；不自建数据库、连接池或存储服务。 |
| `@NeedLogin`、`UserContextMiddleware`、`RequestContextService`、service-scope API key/tenant/workItem scope | `REUSE_NATIVE` | 身份与请求上下文继续由妙搭 SDK/Host 注入；`server/modules/identity/` 和 `canonical-service-scope.authorization.ts` 只做 WiseLink ACL/scope fail-closed，不另建登录/session。 |
| OpenClaw 2026.3.13：专用 Gateway `healthz=live`，原生 agents list 读回 `g2-action-attempt`，chat-completions 已启用，provider/model=`wiselink/wiselink-direct-llm`，plugin allowlist=`[wiselink]` | `REUSE_NATIVE` | `scripts/run-openclaw-action-attempt-worker.mjs` 只做 TaskEnvelope/ResultEnvelope 适配，通过标准 `@modelcontextprotocol/client@2.0.0`（MIT）调用 Host MCP、通过 OpenClaw 原生 Gateway HTTP 调模型；禁止 provider 直连、共享 `main` 和 simulation。 |
| 妙搭 automation CLI 原生提供 cron/record-change/webhook/审批 trigger；实际 `automation-list` 返回当前应用 0 项 | `ADAPT_EXISTING` | 生产唤醒/调度优先使用托管 automation 与已发布 handler，不新增自建 supervisor。它只能作为 wake-up hint；投递语义尚未实跑，不能替代 ActionAttempt idempotency/fence/Result Gate。当前 DEV worker 命令保留为有界验收入口，不宣称生产守护进程。 |
| 妙搭原生日志/trace/requests/latency/CPU/memory/PV/UV CLI | `REUSE_NATIVE` | 后续部署只接平台观测，不新建监控栈。本次命令只支持 online；因禁止生产访问未调用，当前证据来自隔离 Host/DB/FileService/Gateway readback。 |
| 飞书开放平台提供 Aily 智能体/机器人发布能力；但当前 `lark-cli 1.0.87` 无 `aily` typed command，仓库 `UnavailableAilyObjectAccessAdapter` 仍显式 fail-closed | `HOLD_CUSTOM` | 本专项不把 Aily 当成已验证 transport，也不另造 Aily session/skill wrapper。获得官方可调用合同并完成真实同用户 handoff 前保持 non-claim。 |

### 11.2 WiseLink 必须保留的领域逻辑

以下统一为 `KEEP_DOMAIN_LOGIC`，不能交给 provider、OpenClaw、automation 或通用队列直接写
`current`：

- `server/modules/action-attempt/`：WorkItem/task 唯一、ActionAttempt/operation correlation、
  TaskEnvelope/ResultEnvelope hash 与 binding、terminal receipt、cancel/deadline、COMMITTING
  durable cutoff、`projectionApplied`；
- lease token/generation 虽有通用队列形态，但在这里也是 stale executor 的 Host commit fence；
  即便以后由托管 automation 或开源队列唤醒，也必须保留并由 Host 终结；
- `server/modules/canonical-host/canonical-host-openclaw-dynamic-evaluation.service.ts` 与
  `canonical-host-openclaw-overall.service.ts`：Result Gate、candidate-only、
  `currentRevision < baseRevision` fail-closed、CAS `APPLIED/CONFLICT/OBSOLETE`；
- DocumentVersion currentness、ACL、FileService actual-byte receipt、WorkItem revision 与同一用户
  fresh-read。

`priority/nextAttemptAt` 调度、四槽扫描、heartbeat 续租与 worker 退避属于“领域 fence 周边的
通用任务机制”。当前仅保留真实纵切所需最小实现；禁止继续扩成 dashboard、通用 scheduler、
worker fleet manager 或通知系统。若托管 automation 能稳定唤醒，则由它负责唤醒，DB row 只负责
领域状态和 fence。

### 11.3 成熟开源候选（未引入）

平台 automation 尚未证明精确的 sub-minute retry/cancel/lease/commit-fence，因此只比较、不安装：

| 候选 | 维护/license/兼容性 | 取舍 |
| --- | --- | --- |
| [pg-boss](https://www.npmjs.com/package/pg-boss) | 2026-08-24 为 12.27.0、17 天内发布、MIT，PostgreSQL `SKIP LOCKED`，已有 Drizzle adapter、retry/backoff/cancel/dead-letter | PostgreSQL/Node 栈兼容，若托管 handler 的唤醒/恢复真实失败，列为第一替换候选；但会新增独立 schema、maintenance worker，并且仍不能替代 Result Gate/CAS，当前不引入。 |
| [Graphile Worker](https://worker.graphile.org/docs) | MIT，PostgreSQL 12+、Node 22.18+，LISTEN/NOTIFY、retry/backoff、`job_key` dedupe | 技术兼容；locked job 的 `job_key` 默认可能产生第二 job，且要新增 `graphile_worker` schema/worker，替换成本高于当前四槽窄链，当前不引入。 |
| [BullMQ](https://docs.bullmq.io/) | MIT，成熟的 retry/concurrency/dedup，但依赖 Redis | 妙搭现有 PostgreSQL/FileService/automation 已足够，不为本链新增 Redis 运维面，拒绝进入当前集成。 |

### 11.4 暂缓/移除重复与集成影响

- `8a7a664eae0bb0369b9d2c4d4fc6c8af37701a59`（34 files、7411 insertions）的
  `server/modules/large-pdf-upload/`、`client/src/api/large-pdf-upload.ts`、
  `client/src/pages/LargePdfUploadPage/` 及自建 8 MiB upload session/chunk 协议统一为
  `HOLD_CUSTOM`，不得进入 canonical mainline；其中与 Dataloom direct upload 重复的上传/session
  层为 `REMOVE_DUPLICATE`。可复用的 DM actual-byte 校验思想只通过现有 FileService adapter
  实现，不 cherry-pick 该候选。
- 当前 G2 候选没有上述 large-pdf 文件，也没有 pg-boss/Graphile Worker/BullMQ 依赖；其 parent
  仍为 `006146b2267e0dc316f9550411c178a292f9b04b`。
- canonical 集成顺序：先合入本 G2 的 Result Gate/claim 修复与真实 runbook；再在独立候选中用
  Dataloom 原生直传替换上传 UI；生产 worker 唤醒优先做妙搭 automation disabled 配置、同名
  handler、release 与真实 DEV/UAT probe。只有该 probe 给出可复现的投递/恢复缺口，才评估
  pg-boss；不得反向恢复 8 MiB 分片或直接让 provider 写 current。
- non-claims：未创建/启用 automation，未发布 handler，未调用 Aily 会话，未查询 online
  observability，未验证 >100 MiB，未安装任何新队列库，未 push/部署/触碰生产或历史对象。
