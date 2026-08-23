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
```

重启 DEV Host 后，用错误 WorkItem ID 做一次 404 fail-closed 读回，再用 exact ID 读取成功。

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
    "entries": {
      "g2-action-attempt": {
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
    }
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

## 10. 当前已观察与未完成

已观察：本地 OpenClaw/provider-proxy 容器 healthy；真实 `openclaw agent --local` canary 由 provider `wiselink`、model `wiselink-direct-llm` 在约 14 秒返回指定 JSON；这只证明真实 OpenClaw/model 可达，不证明本 runbook 的 Host/DB/FileService 纵切。

当前本地 Gateway 没有 `g2-action-attempt`，显式 config 中 chat-completions 未开启且 `plugins.allow` 为空，因此共享 `main` 不能用于业务运行。平台/数据库/新容器写入还受当前 Codex 外部审批额度阻断；在 owner 完成第 3、4、6 节目标并恢复外部访问前，真实纵切状态必须保持 **blocked / non-claim**。
