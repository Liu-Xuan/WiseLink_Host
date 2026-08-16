# Aily Skill 与 WiseLink 只读 MCP 交接

状态：`SKILL_FIRST / SINGLE_READONLY_MCP / NO_COMPLEX_WORKFLOW`

## 当前决定

Aily 使用一个面向用户的 Skill 组织理解、查询和结果解释，不再以可视化 Workflow 编排
WiseLink 主流程。Skill 只调用一个 owner-only 的只读 MCP 服务；解析、评估、重综合、
AEO 写入和 WorkItem 状态仍由妙搭服务端拥有。

这不是另一套系统：MCP 只是现有妙搭 read model 的薄协议入口，没有自己的队列、worker、
数据库、状态账本或业务决策。

## 单一 MCP 入口与三个工具

| tool | 输入 | 用途 |
| --- | --- | --- |
| `get_parse_status` | `workItemId` | 读取状态、failure、frozen.2 package 摘要和服务端深链 |
| `query_parsed_package` | `workItemId`, `query` | 查询同一 Unified Reader 的 source-bound units |
| `get_deep_link` | `workItemId` | 获取服务端生成的妙搭 WorkItem 深链 |

传输入口固定为 `POST /openapi/wiselink/mcp`。服务端使用官方 MCP TypeScript SDK v2，按请求
创建 server，返回 JSON；不提供 SSE、session、resource、prompt、queue 或 store。工具输入为
严格结构化对象，不接受任意 URL、header、actor、authority，也不暴露 `start_parse` 或其他
mutation。三个既有固定 GET 继续保留用于普通 OpenAPI 只读调用。

三个工具复用同一个 `CanonicalHostVerticalService`、同一个普通妙搭 WorkItem repository、
同一个 FileService ArtifactStore 和同一个 Unified Reader。`requestId`、`DocumentVersion`、
permission snapshot、artifact ref 与 deep link 均由服务端 fresh-read，不由 Aily 补造。

## Skill 职责

Skill 可以：

1. 让用户提供或确认 `workItemId`；
2. 读取 WorkItem 当前状态；
3. 按用户问题调用 source-bound query；
4. 解释 candidate、stale、warning 和 source reference；
5. 返回同一 WorkItem 的妙搭深链，提醒用户在妙搭执行需要认证的写动作。

Skill 不可以：

- 在 Prompt 中重建 Job Aid、综合评估或 AEO 状态；
- 根据搜索 snippet 自动形成适用性或工程结论；
- 直写 WorkItem、DocumentVersion、FileService、Assessment、AEO 或 currentness；
- 代表工程师批准、发布或发送正式产物；
- 调用任意网址或把 OpenAPI credential 暴露给模型输入。

## OpenClaw 关系

OpenClaw 是 OEM 网站发现工具，不是 Parser、Reader、Assessment 或第二 WorkItem owner。
当 Aily Skill 需要 Boeing/Airbus/COMAC 外部资料时，可委托 OpenClaw 执行只读发现；返回的
SearchRun/candidate 先进入飞书原生候选清单。只有完整、非受限、直接官方来源且经人工选择的
实际文件，才进入既有 DM ingest。ZERO_RESULT、ACCESS_DENIED、PARTIAL、TRUNCATED 和未采纳
snippet 不创建 DocumentVersion 或 WorkItem。

若 Aily 不能原生调用 OpenClaw，只允许在 OpenClaw 已存在的正式 server operation 之上增加
只读 MCP 映射；不得自建第二爬虫、调度器或数据账本。

## 已完成验证

真实 WorkItem `WI-c2943f5a-d023-46ac-9cf5-9480de0aabaf` 的三条固定 GET 已在 hosted DEV
使用受限 key 各调用一次并通过：

- status：`CANDIDATE_READBACK_VERIFIED`，311 units / 239 refs，frozen.2 strict validation PASS；
- `software` query：38/38 results 均有 sourceRefs；
- deep link：由妙搭服务端生成并指向同一 WorkItem。

源码 OpenAPI spec 为 [openapi.json](openapi.json)，保留三个 GET，并登记一个 MCP JSON POST
传输入口；MCP 内部 mutation tool 为 0。

真实 Aily TEST 已证明：上传 Skill 不会把“自定义连接器”自动注册到新版自定义智能体的 MCP
工具表，因此连接器不能作为当前 Agent 的直接工具。平台集成生成 MCP 因账号缺“业务集成”
权限暂不可用，本 endpoint 是同一服务的最小协议适配，不是第二套业务实现。

## 已废止方案

- 三个独立 Workflow Skill；
- 在 Workflow HTTP 节点中手工拼 `{{workItemId}}`/`{{query}}`；
- 由 Aily Workflow 串联解析、评估、AEO 或文件写入；
- 让 Aily 持有浏览器 Cookie、关闭 CSRF，或使用任意 URL HTTP 节点。

平台上若仍存在旧 Workflow 草稿，只能作为未发布历史草稿；不得绑定到当前 Agent、连接器或
Skill，也不得作为验收证据。删除平台资产属于独立线上清理动作，不由本源码提交代替。

## 下一平台动作

1. 发布包含 `/openapi/wiselink/mcp` 的 DEV revision；
2. 单独授权后，把 `allow_all=false` 的专用 key 增加精确 `POST /openapi/wiselink/mcp`
   scope；当前只含三个 GET 的 key 在更新前不能调用 MCP；
3. 在 Aily 当前 Agent 的“工具 / MCP 服务”中登记该固定 URL 和受限 Bearer credential；
4. 工具清单必须精确读回上述三个工具，且不出现资源、prompt 或写工具；
5. 用真实 WorkItem 验证 initialize → tools/list → status → query → deep-link；
6. 不发布旧 Workflow，不开放写 operation。
