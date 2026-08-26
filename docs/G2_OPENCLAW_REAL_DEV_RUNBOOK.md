# G2 OpenClaw 真实 DEV 纵切 Runbook

## 1. 完成口径

唯一可验收链路是：真实 Host 创建并持久化 `ActionAttempt=QUEUED`，PostgreSQL 原子 claim/lease 后进入 `RUNNING`，专用 OpenClaw Gateway agent 调用 OpenClaw 2026.3.13 内置的 `openai-codex/gpt-5.4`，executor 如实记录 provider/model 并提交完整 `ResultEnvelope`，Host 跨过 `COMMITTING` 截止点，Result Gate 校验实际模型字节，最后通过 WorkItem revision CAS 写入 candidate-only projection 并回读 FileService/DB/浏览器。

以下均不算完成：fixture、simulation、loopback executor、直接调用 provider、`main` OpenClaw agent、只跑单测、只看 HTTP 200、只看到容器 healthy、绕过 Host 写 WorkItem、把损坏结果替换为 `{}`。

## 2. 固定基线与代码目标（R08 revision 692）

- 当前 Hosted exact release：`a160d7d3a221a3dda58d59b4374c8cf26543fa62`；server/execution 语义等同其 `637090e02efa67f4ddf76bc194452c7f272badec` lineage
- 本 OAuth provenance 变更直接基于：`a160d7d3a221a3dda58d59b4374c8cf26543fa62`
- accepted DEV integration parent（历史证据）：`77f2a56d4eacecd31e4a501630ee5fe3985fb25a`
- G2 历史证据链（只作 lineage/evidence）：`367e2fd8d8bc95699381a173ad1144089c6817b2 → d74049cc483e98f889fc756ef2eb865cb2019d30 → ca56193727e8d2284665aa749f12598c573afb2d`
- 当前 OAuth provenance 候选分支：`codex/wl31-openclaw-oauth-provenance-20260826`
- migration：`migrations/0003_action_attempt_openclaw_v1.sql`
- Host 状态机：`server/modules/action-attempt/`
- OpenClaw worker：`scripts/run-openclaw-action-attempt-worker.mjs`
- 不 push、不合并、不部署生产；只使用一个全新隔离 DEV/UAT DocumentVersion 和其新建 WorkItem。

### 2.1 新 WI/DV 专业产物的强制边界

`ExactFtdFrozen2PdfProducerAdapter` 不再保留任何固定 DocumentVersion/package asset fallback。每一次运行都必须先由 Host 从 FileService fresh-read 新 DocumentVersion 的实际 PDF bytes 并核验 source hash/length/provider object；随后通过私有 `ScopedProfessionalArtifactCorrelationPort` 定位同一 `workItemId + documentVersionId` 授权域内新迁入登记的 frozen.2 专业产物。Host 再按 correlation 的 FileService locator fresh-read 专业产物实际 bytes，并核验 scope owner、scope-bound artifact ref、provider object、hash/length、完整 classification 与 frozen.2/U0。

当前唯一生产者是 Host-native PDF pipeline：它从上述 source actual bytes 生成 frozen.2，并先通过 strict U0。`MiaodaScopedProfessionalArtifactCorrelationAdapter` 随后把这些已验证的相同 bytes 写入 exact `workItemId + documentVersionId` FileService 路径并登记 correlation；Host 再独立 fresh-read professional bytes，逐项核验 scope/ref/provider/hash/length、完整 classification 和与 pipeline 输出的 byte identity。lineage 不拥有或授权 artifact。若显式配置 unavailable provider，仍精确返回 `PDF_PRODUCER_CORRELATION_UNAVAILABLE`；任何配置都不会从 fixture、本地资产、历史 binding、simulation 或第二 producer/parser 继续运行。

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

阶段 A 必须先跨过 G0：浏览器只走官方 OAuth `state + PKCE → token → user_info(open_id + tenant_key) → Host mapping/session`，再以 Host session/ActorContext/ACL 创建并读回一个全新隔离 DEV DocumentVersion/WorkItem。`user_id` 缺失不阻断，不接受自造 `x-aily-jwt`，App Secret 只可存在于隔离 DEV 受控 env，不进入 Git、日志或证据。

阶段 A 的具体 HTTP 路径以 Hosted release 暴露的 OAuth session-backed Host route 为准；当前 API-key `/development-work-items` route 不能替代最终用户 OAuth 创建/读取，也不得作为 G0 通过证据。必须 fresh-read WorkItem status、DocumentVersion currentness 与 source FileService artifact，保存 returned `WI-...`，且不输出 OAuth token、App Secret 或 API key。

阶段 B 才为这个已由同一 OAuth session 创建并读回的 exact WorkItem 开启专用 executor service scope：

```text
WL_OPENCLAW_SERVICE_SCOPE_ENABLED=1
WL_OPENCLAW_GATEWAY_AUTH_MODE=API_KEY
WL_OPENCLAW_SERVICE_SCOPE_ENV=DEV
WL_OPENCLAW_SERVICE_PRINCIPAL_ID=service:openclaw-g2-dev
WL_OPENCLAW_SERVICE_TENANT_ID=<exact-dev-tenant>
WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED=0
WL_OPENCLAW_DEVELOPMENT_DOCUMENT_VERSION_ID=<exact-new-current-document-version>
WL_OPENCLAW_DEVELOPMENT_RUN_TOKEN=<new-uuid>
```

随后保持创建能力关闭并绑定唯一 WorkItem：

```text
WL_OPENCLAW_DEVELOPMENT_CREATE_ENABLED=0
WL_OPENCLAW_SERVICE_WORK_ITEM_ID=<returned-WI-id>
WL_LOCAL_U0_PYTHON=<absolute-python3-path-with-jsonschema>
```

重启 DEV Host 后，用错误 WorkItem ID 做一次 404 fail-closed 读回，再用 exact ID 读取成功。
`NODE_ENV=development` 且 `MIAODA_LOCAL_DEV=1` 时，Host 必须显式设置
`WL_LOCAL_U0_PYTHON`；缺失即以 `FULL_U0_VALIDATOR_UNAVAILABLE:LOCAL_PYTHON_REQUIRED`
停止启动，不得回退到 partial validator。妙搭本地路由前缀为
`/app/<app-id>/openapi/wiselink/openclaw-mcp`。2026-08-26 对当前 Hosted release
的真实 API-key 预检证明：同域 `/app/<app-id>/api/openapi/...` 会进入用户登录重定向，
而 `/app/<app-id>/openapi/...` 才进入妙搭 OpenAPI Key 网关并到达 Host。后续仍应以
部署应用的真实 401/403/503/JSON-RPC 读回确认，不得凭路径名称互相猜测替换。

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
          "primary": "openai-codex/gpt-5.4",
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

### 6.1 隔离 DEV 的官方 ChatGPT/Codex OAuth

OpenClaw 2026.3.13 已内置 `openai-codex` provider、PKCE OAuth 与
`openai-codex/gpt-5.4` catalog；该路径由 OpenClaw 的 `pi-ai` transport 执行，不启动
Codex CLI，不接入 ACP/CodeM，也不需要安装 provider plugin。`plugins.allow` 仍只包含
WiseLink 工具插件，因为 `openai-codex` 是内置 model provider，不是外部 OpenClaw plugin。

OAuth state 不得继续放在易失的 `/private/tmp`。runtime owner 应先创建一个不受 Git 管理、
目录权限为 `0700` 的稳定 state root，并整体绑定到 `/home/node/.openclaw`；推荐 DEV 路径为：

```text
/Volumes/SSD/LLM/WiseLink/private/runtime/openclaw/wl31-g2-dev/state:/home/node/.openclaw
```

OpenClaw 将同 agent 的 OAuth profile 写入
`agents/g2-action-attempt/agent/auth-profiles.json`；该文件必须保持 `0600`，不得进入日志、
证据、备份或 Git。OAuth access/refresh token 是 provider mint/rotate 的会话凭据，不属于
OpenClaw static SecretRef 支持面；不得复制到 env/file SecretRef，也不得挂载或导入现有
`~/.codex/auth.json`。

runtime/config 准备完成后，用户唯一一次交互动作是在本机专用 TTY 中运行：

```bash
docker exec -it wiselink-g2-openclaw-dev \
  node openclaw.mjs models auth \
  --agent g2-action-attempt \
  login --provider openai-codex
```

用户在浏览器选择明确授权的 ChatGPT workspace。若容器不能接收 loopback callback，只能在
该 TTY 中粘贴 redirect URL/code；不得将其发到聊天、文档或 shell 日志。登录后先只读执行：

```bash
docker exec wiselink-g2-openclaw-dev \
  node openclaw.mjs models status \
  --agent g2-action-attempt \
  --json --check --probe --probe-provider openai-codex
```

probe 与 Gateway `/v1/chat/completions` 真实 canary 均成功后，才允许 claim 新 DEV
ActionAttempt。订阅 entitlement、rate limit、workspace RBAC/retention/residency 均以用户所选
ChatGPT workspace 为准；本授权只适用于单用户隔离 DEV，不能提升为 Hosted、CI 或无人值守
生产服务。第二个 OAuth token sink 还可能轮换 refresh token 并使既有 Codex CLI 会话需要重新
登录，因此必须由用户明确执行这一动作。

Gateway 必须使用独立 token；token 只放 secret/env，不进 argv、日志、证据或 Git。Host worker 的配置为：

```text
WL_OPENCLAW_HOST_MCP_URL=https://<host>/app/<app-id>/openapi/wiselink/openclaw-mcp
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

## 10. 2026-08-24 隔离 DEV 历史实跑证据（受保护、禁止复用）

本节对象只证明 `ca561937` 当时的 OpenClaw HTTP/Result Gate/CAS 能力，不能作为新 WI/DV 的输入、artifact owner、correlation 正例或授权来源；即使 source/package SHA 与 bytes 完全相同，也禁止跨 WorkItem 复用。

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
| OpenClaw 2026.3.13：专用 Gateway `healthz=live`，原生 catalog/CLI 只读核验已包含 `openai-codex/gpt-5.4` 与 `models auth login --provider openai-codex`；agent 必须为 `g2-action-attempt`、fallbacks=`[]`、plugin allowlist=`[wiselink]` | `REUSE_NATIVE / AUTH_PENDING` | `scripts/run-openclaw-action-attempt-worker.mjs` 只做 TaskEnvelope/ResultEnvelope 适配，通过标准 `@modelcontextprotocol/client@2.0.0`（MIT）调用 Host MCP、通过 OpenClaw 原生 Gateway HTTP 调模型；不启动 Codex CLI/ACP/CodeM，禁止 provider 直连、共享 `main` 和 simulation。当前未发起 OAuth、未产生 auth profile、未跑该 provider 的真实 canary。 |
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

## 12. Job-Aid 原生 section window 重放（SSOT revision 197）

Host 只消费 Frozen-2 已有的 `SECTION_ANCHOR/SECTION_WINDOW` 与 SourceRef，不重新解析 PDF：

- Effectivity 页 6、Concurrent Requirements 页 13、Work Instructions 页 20 被映射到既有
  `StructuredAssessmentContext`；完整 Frozen-2 包和页 21–22 仍保留，但没有伪称已完成 7 个
  独立 work step 的结构化提取。
- OpenClaw packet 保持小于 45,000 bytes；仅 APP-001、APP-002、CLS-001、GOV-003、
  IMP-001、IMP-005 六项得到 source-bounded candidate。candidate 不是 EvidenceRef，也不证明
  Fleet applicability。
- Host 对边界 U+FEFF/U+200B 做窄清理；predicate、missing key 和 UNKNOWN 人工复核标志由
  Host 机械归一化。单行预算为 400 bytes，总输出仍为 60,000 bytes。唯一允许的位置 ID 修复是：
  恰好一个非 Criterion ID 与该行 result 单元格相同；合法 Criterion ID 交换、缺行、多处损坏
  仍 fail-closed。

同一隔离 WorkItem revision 5 上的四次真实重放均经过专用 OpenClaw Gateway HTTP，agent/model
均为 `g2-action-attempt` / `wiselink/wiselink-direct-llm`，没有 simulation 或 provider 直连：

| Attempt | ResultEnvelope hash | Host 观察 |
| --- | --- | --- |
| `ATT-b8e67cbd-504f-414f-8f57-5e1e6f884ab7` | `423a2aca7454f74ed2bdee30386939acebd4004f3eb421a217f69f1354111b1c` | 前导 U+200B；`FAILED/BASE_ONE_SHOT_OUTPUT_JSON_INVALID` |
| `ATT-792f8892-a987-455a-8951-9ed19d343f19` | `75828740ea9e39c9578990238ccd3d6c0f445e6ff8bfe48c1cb01a508d3b753a` | GOV-003 373/360 bytes，且模型自造 missing key；`FAILED` |
| `ATT-e7ac6e6c-19d3-45a1-bc88-1db088d51d2c` | `87d806e2ed7359cb23988033f4859aabc4d15429d39e6e65697aff7ac8cff20b` | DEC-005 ruleId 单格误写为 result；`FAILED` |
| `ATT-17e36d96-5bdc-46d1-892e-4fdd7703dba5` | `07e9492c400375a3dab85fecfcf225fa2b8b235c671a688ffed54981d03eacf1` | 顶层缺一个结束 `}`；`FAILED/BASE_ONE_SHOT_OUTPUT_JSON_INVALID` |

第二、三轮真实模型字节在相应窄修复后均通过完整离线 consumer；第三轮为 150/150、124 个
Host-bound 缺口、149 项人工复核、33,159 bytes 规范化 artifact。但没有用离线结果回写 DB。
第四轮是新的实质损坏，Host 正确保留完整 ResultEnvelope/hash、释放 lease/slot、
`projectionApplied=false`，WorkItem revision 仍为 5。因此本轮 **不宣称** 新 Job-Aid context 已跨过
Result Gate/CAS，也没有运行新的 overall；历史第 10 节 dynamic/overall 成功证据仍有效。

精确外部阻断是 `wiselink-direct-llm` 在同一严格 JSON 合同上的非确定性结构损坏。下一步应优先
验证 OpenClaw/模型原生 structured-output/JSON-schema 能力或可观测的同 Attempt bounded regeneration；
不得在 Host 继续增加任意 JSON 修补，也不得把损坏内容替换为 `{}`。

## 13. Feishu evidence research 候选的 TaskEnvelope seam（只读审查）

只读核验候选 `ec1885a057514aee62ae67afbe4da1f092e01163` 的
`server/modules/feishu-evidence-research/**`。处置为 `ADAPT_EXISTING`：其 frozen binding、locator/version
核对、private candidate-only session、显式 adoption receipt/CAS 边界可复用；当前没有接入 runtime，
没有真实飞书读取，不能计入 G2 完成。

最窄 Host 集成应是：

1. Host 以 `transport=OPENCLAW_MCP` fresh-authorize WorkItem/Attempt，并在 Host 内构造
   `FeishuEvidenceServicePrincipal`；principal、tenant、authorization fingerprint 不进入 MCP schema
   或 TaskEnvelope model input。
2. Host 在 ActionAttempt begin 内调用 `beginResearch`，把 frozen query/bindings/read plan 作为
   TaskEnvelope 的 candidate-only source/connector 输入；OpenClaw 只用飞书原生只读工具执行窄查询。
3. OpenClaw 将 exact readback 放入 ResultEnvelope；Host Result Gate 校验 attempt/fence 后在内部调用
   `commitReadback`。OpenClaw 不直接持 ACL、不直接创建 EvidenceRef、不写 WorkItem/current。
4. `adoptCandidates` 不注册为 OpenClaw MCP 写工具。只有工程师显式 ReviewAction(expectedRevision)
   才能调用 adoption port，形成 input revision+1、STALE 和受影响项重评。

给 integration planner 的唯一共享接口依赖是 transport-aware composite service-scope：WorkItem 和
Attempt authorize 输入必须显式包含 `transport: 'OPENCLAW_MCP' | 'AILY'`，并返回现有 verified
principal/tenant/workItem scope；研究 readback 复用 Attempt authorize，不新增以 `researchRef` 为 ACL
真源的接口。`9350` 的旧身份接口不得被本候选吸收，`package.json`、
`verify-canonical-mcp.mjs` 不在本提交修改范围；`canonical-host.module.ts` 只注册由 Host-native PDF 输出驱动的 scoped professional correlation provider，不接入 Feishu evidence candidate。

## 14. revision 293 后的可执行 post-G0 顺序与唯一阻断

1. 官方 OAuth session 创建并读回全新 DEV DocumentVersion/WorkItem；观察 HTTP correlation、ActorContext mapping、tenant/workItem ACL、DocumentVersion currentness 与 source FileService actual-byte receipt。
2. Host-native PDF pipeline 从该新 DV 的 actual source bytes 生成不可变 frozen.2，strict U0 通过后才写入 exact `workItemId + documentVersionId` FileService 路径并登记 `ScopedProfessionalArtifactCorrelation`。Host 独立 fresh-read professional bytes；登记绑定 source artifact/provider/hash/length、完整 classification、专业 artifact identity/owner/locator/hash/length，并要求其与 pipeline 输出 byte-identical。
3. Host 重新运行 canonical PDF vertical：source bytes 与专业 artifact bytes 均由 Host FileService fresh-read；scope/ref/hash/length/classification/package source/U0 任一不一致即停止。通过后才允许创建/claim ActionAttempt。
4. 专用 `g2-action-attempt` 依次运行 dynamic/overall；观察 DB `QUEUED→RUNNING→COMMITTING→terminal`、HTTP begin/heartbeat/commit、Trace attempt/operation correlation、ResultEnvelope hash、FileService candidate actual-byte readback、WorkItem revision CAS/current fresh-read。

当前代码已接通第 2 步的生产与持久化 owner，但本地验收只证明真实 FTD/parser/U0/Reader，以及有界 FileService/DB doubles 下的双 actual-byte/scope 校验。尚未在新 OAuth DEV WorkItem 上执行托管 FileService/DB、ActionAttempt、OpenClaw 与 CAS，因此不得把本地通过冒充为第 3–4 步真实 DEV 纵切完成。
