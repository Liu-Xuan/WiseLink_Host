# Aily Skill 与 WiseLink 只读连接器交接

状态：`SKILL_FIRST / SINGLE_READONLY_CONNECTOR / NO_COMPLEX_WORKFLOW`

## 当前决定

Aily 使用一个面向用户的 Skill 组织理解、查询和结果解释，不再以可视化 Workflow 编排
WiseLink 主流程。Skill 只调用一个 owner-only 的只读自定义连接器；解析、评估、重综合、
AEO 写入和 WorkItem 状态仍由妙搭服务端拥有。

这不是另一套系统：连接器只是现有妙搭 read model 的薄入口，没有自己的队列、worker、
数据库、状态账本或业务决策。

## 单一连接器 operation

| operation | 固定妙搭 OpenAPI | 输入 | 用途 |
| --- | --- | --- | --- |
| `get_parse_status` | `GET /openapi/wiselink/work-items/status` | `workItemId` | 读取状态、failure、frozen.2 package 摘要和服务端深链 |
| `query_parsed_package` | `GET /openapi/wiselink/work-items/parsed-units` | `workItemId`, `query` | 查询同一 Unified Reader 的 source-bound units |
| `get_deep_link` | `GET /openapi/wiselink/work-items/deep-link` | `workItemId` | 获取服务端生成的妙搭 WorkItem 深链 |

每个 operation 的 path 固定，`workItemId`/`query` 是结构化 query 参数。连接器不接受任意
URL、header、body 或 method，不暴露 `start_parse` 或其他 mutation。

三个路由复用同一个 `CanonicalHostVerticalService`、同一个普通妙搭 WorkItem repository、
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
一个只读 connector/MCP 映射；不得自建第二爬虫、调度器或数据账本。

## 已完成验证

真实 WorkItem `WI-c2943f5a-d023-46ac-9cf5-9480de0aabaf` 的三条固定 GET 已在 hosted DEV
使用受限 key 各调用一次并通过：

- status：`CANDIDATE_READBACK_VERIFIED`，311 units / 239 refs，frozen.2 strict validation PASS；
- `software` query：38/38 results 均有 sourceRefs；
- deep link：由妙搭服务端生成并指向同一 WorkItem。

源码 OpenAPI spec 为 [openapi.json](openapi.json)，只含三个 GET path，mutation route 为 0。

## 已废止方案

- 三个独立 Workflow Skill；
- 在 Workflow HTTP 节点中手工拼 `{{workItemId}}`/`{{query}}`；
- 由 Aily Workflow 串联解析、评估、AEO 或文件写入；
- 让 Aily 持有浏览器 Cookie、关闭 CSRF，或使用任意 URL HTTP 节点。

平台上若仍存在旧 Workflow 草稿，只能作为未发布历史草稿；不得绑定到当前 Agent、连接器或
Skill，也不得作为验收证据。删除平台资产属于独立线上清理动作，不由本源码提交代替。

## 下一平台动作

1. 在 Aily 创建或复用一个 owner-only 自定义连接器并导入 `openapi.json`；
2. 只保留上述三个 operation，使用现有受限 Bearer credential；
3. 创建一个用户可理解的 WiseLink 查询/评估 Skill，工具仅选择该连接器；
4. 用真实 WorkItem 验证 status → query → deep-link；
5. 不发布旧 Workflow，不开放写 operation。
