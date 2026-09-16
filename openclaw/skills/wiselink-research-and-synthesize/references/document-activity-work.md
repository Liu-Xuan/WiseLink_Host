# 离线活动消费契约（17c）

## 权威来源

Host 合同以公开 GitHub 仓库 `Liu-Xuan/WiseLink_Host` 的精确提交
`7c86becbce15960a9cb9604534f0359591629e28` 为准，离线对齐只读以下四个真实文件：

- `server/modules/canonical-host/document-activity-runtime.service.ts`（`documentActivityActionSchemas`、`summary()`、ACTIVITY_READ/CLAIM 响应结构）
- `server/modules/canonical-host/document-work-runtime.service.ts`（`document_work` STATUS 的 `nextActivityRunRef`）
- `server/modules/canonical-host/document-activity-candidate.ts`（proposalSchema、校验与物化规则）
- `shared/document-activity.interface.ts`（全部接口形状与常量）

禁止按旧离线包或 mock 猜字段。注意：任何"伪 nextActivityRunRef"或顶层 `original` 的 READ 回执都按契约违规拒绝。

## 工具与动作

唯一 Host 工具是 `document_work`。活动动作的请求字段逐字段来自
`documentActivityActionSchemas`（strictObject）：

| 动作 | 字段 |
| ---- | ---- |
| ACTIVITY_STATUS | documentVersionId, runRef |
| ACTIVITY_CLAIM | documentVersionId, runRef, leaseOwner |
| ACTIVITY_HEARTBEAT | documentVersionId, runRef, leaseOwner, leaseToken, leaseGeneration |
| ACTIVITY_READ | ACTIVITY_HEARTBEAT + sectionId, offset, limit(1..50) |
| ACTIVITY_SAVE | ACTIVITY_HEARTBEAT + candidate, producer{skillVersion,modelVersion} |
| ACTIVITY_FAIL | ACTIVITY_HEARTBEAT + errorCode |
| ACTIVITY_BEGIN/CANCEL | 归显式受理方/所有方路径，消费者不发送 |

约束：`documentVersionId/runRef` 匹配 `^[A-Za-z0-9_-]{1,96}$`；`leaseOwner`
匹配 `^[A-Za-z0-9:_-]{1,160}$`；`leaseToken` 为 UUID；`leaseGeneration`
为正整数；`errorCode` 匹配 `^[A-Z0-9_:-]{1,160}$`。

## 消费顺序（本 consumer 的固定流程）

1. `document_work {action:'STATUS', documentVersionId}` —— 只有返回的
   `nextActivityRunRef` 代表一个已被显式 BEGIN 的现有 run。为 `null` 时
   零模型调用，直接 IDLE。`runRef:null` 永远不得用于 ACTIVITY_STATUS。
2. `ACTIVITY_STATUS` 携带精确 runRef，返回本 run 的 `summary()`：
   `{runRef, requestId, documentVersionId, parseRunId, semanticRevision,
   selection:{sectionIds}, expectedRevision, status, deadline,
   candidateRevision, result, errorCode}`。若 `result` 已持久则零模型返回
   已存回执，不得伪造任何 next 字段。
3. `ACTIVITY_CLAIM` 返回 `{...summary, fence}`。只使用真实返回的 fence
   （允许 `null`；`null` 时不得继续 READ/model/SAVE/FAIL）。sectionIds 取
   `claim.selection.sectionIds`，deadline 取 Host 返回值（固定 1 小时）。
   租约 2 分钟，由 ACTIVITY_HEARTBEAT 续租。
4. `ACTIVITY_READ` 按 sectionId 逐页（`offset`+`limit`），翻页只认
   `range.nextOffset`（`null` 为本节完成）。回执为：
   `{runRef, sourceBinding:{original, semanticRevision}, selection, units,
   anchors, range:{sectionId, offset, unitIds, anchorIds, nextOffset},
   sourceCoverage}` —— 不含顶层 `original`，原文只来自
   `sourceBinding.original`。跨页 `sourceBinding`/`sourceCoverage` 必须
   deep-equal。
5. 模型只返回 proposal：`schemaVersion='wiselink.document.activity-candidate.v1'`
   与 `statements`，每条仅 `statementKey, label, quotes(anchorId,start,end,text),
   time(role,precision,expression,raw,quoteIndex)|null, statusRaw, limitations`。
   Host 绑定、anchors、coverage、statementId、candidateRevision、producer
   不得由模型回填（strictObject 下多余字段即 `SHAPE_INVALID`）。校验镜像
   Host：引用必须是已交付 anchor 的精确 slice；time.raw/statusRaw 必须被
   引文覆盖；非 CALENDAR 表达式要求 precision=UNKNOWN。
6. `ACTIVITY_SAVE` 的 candidate 恰为 proposal 本身；producer.skillVersion 为
   当前 skill 版本，producer.modelVersion 必须来自真实配置路由/运行时来源。
   保存回执为 `DocumentActivityRevision`；缺 runRef 或身份/revision/
   sourceBinding/producer 不匹配必须拒绝。SAVE 结果未知只查原
   `ACTIVITY_STATUS.result`；未确认保持待恢复状态，不得 FAIL、不得假成功、
   不得新开 run。

## 批次范围

当前为 A 批（离线合同对齐）：`scripts/consume-hosted-document-activity.mjs`
只做上述契约，`callTool`/`invokeModel` 由测试注入；对应测试
`tests/consume-hosted-document-activity.test.mjs` 的 Host mock 逐字段取自
上述四个文件。真实 CLI 入口、transport、持久 checkpoint、CLAIM 到终态的
全程 HEARTBEAT/中止、`scripts/consume-hosted-work-item.mjs` 的
documentVersion 分支接线属后续 B 批，未在本批冒充完成。

## 验证

```
cd workspace/skills/wiselink-research-and-synthesize
node --test tests/consume-hosted-document-activity.test.mjs   # 20/20 通过
```
