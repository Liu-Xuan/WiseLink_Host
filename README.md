# WiseLink 3.1｜工程资料与综合评估

本仓库是 WiseLink 3.1 的唯一妙搭业务宿主：

- 妙搭应用：`app_17bzc551rsg`
- 分支：`codex/v3-1-canonical-host-candidate`
- 业务状态真源：本应用数据库中的同一 `WorkItem` 与 `ActionAttempt`
- 文件真源：本应用 FileService 中的不可变实际字节
- 智能入口：Aily Skill + 一个只读 MCP 服务

Parser Lab、DM Lab、Assessment Workbench、AEO owner 仓库和历史 Hub 都只是模块来源或验收来源，
不是第二个产品、第二个 WorkItem Store 或第二条业务主线。

## 当前主线

```text
工程师在妙搭选择受控文件
  → DM 生成 exact DocumentVersion/currentness
  → 同一 WorkItem 创建或复用
  → Parser 生成 frozen.2 ParsedPackage
  → FileService actual-byte readback
  → U0 full Validator + Unified Reader
  → Job Aid / 综合评估 candidate
  → 工程师修改后 stale，显式重综合
  → 当前累计 Assessment 进入 AEO
  → working copy / Draft / Word candidate
  → 妙搭页面与 Aily Skill 读取同一 WorkItem
```

真实 737 本地循环已经覆盖 Job Aid `N=150`、两次累计工程师修改、显式重综合，以及 AEO
`ADOPT / ADAPT / REFERENCE_ONLY / IGNORE` 到 Word candidate。真实 FTD hosted 循环已经覆盖
DocumentVersion、WorkItem、不可变 ParsedPackage、U0、Reader 和页面 fresh-read。

## Aily 最小入口

Aily 不保存解析、评估或 AEO 状态，也不运行复杂可视化 Workflow。一个面向用户的 Skill
负责理解问题、按需调用只读 MCP 工具，并解释同一 WorkItem 的现有结果。

MCP 只有一个无状态 JSON POST 入口 `/openapi/wiselink/mcp`，只注册三个工具：

- `get_parse_status`
- `query_parsed_package`
- `get_deep_link`

三个既有固定 GET 继续保留并与 MCP 复用同一服务。MCP 工具只接受 `workItemId`（查询工具再
接受 `query`），不接受 URL、header、actor、authority 或 mutation。解析、评估、重综合和
AEO 写动作继续由登录态妙搭服务端执行。

OpenClaw 只负责 Boeing、Airbus、COMAC 等外部来源发现。搜索结果和 snippet 不是工程证据；
只有完整、非受限、人工选中的官方文件进入现有 DM ingest 后，才可能产生 DocumentVersion 和
后续 WorkItem。

详见 [Aily Skill 与只读 MCP 交接](docs/AILY_MINIMAL_ENTRY_HANDOFF_20260814.md)。

## 保留的安全边界

- 妙搭业务写操作使用 `@NeedLogin` actor、服务端 authorization、permission fresh-read；
- WorkItem 更新复用业务唯一键、state revision 和 compare-and-set；
- package、Assessment、AEO、Word 与 FailureReport 都要求实际字节、长度和 SHA-256 readback；
- Aily/OpenClaw 不直写 WorkItem、DocumentVersion、FileService、Assessment 或 AEO；
- 不自动形成适用性、工程批准、正式 Draft/Word 或发布结论；
- 正式发布、不可逆操作和权限变更仍按项目授权执行。

## 已清理的旧方案

以下内容不再属于当前源码或构建产物：

- 未装配的 Assessment Hosted Registrar / detached activation 路线；
- 绑定旧三表 Base 的 `feishu-bitable` Registrar capability 文件；
- 专用 Open Platform Base writer 试验；
- “三个 Aily Workflow Skill”配置方案。

当前 ordinary `MiaodaCanonicalWorkItemRegistrarAdapter` 仍保留；它只是同一妙搭数据库
WorkItem 的服务端适配器，不是被删除的历史 Base Registrar。Unified Reader、U0 Validator、
FailureReport、认证、CAS 和 actual-byte 校验也全部保留。

## 文档入口

- [当前架构与装配边界](docs/CANONICAL_HOST_CANDIDATE_ASSEMBLY.md)
- [真实 FTD hosted 纵切](docs/FIRST_REAL_FTD_WORKITEM_VERTICAL_ACCEPTANCE_20260814.md)
- [737 累计评估](docs/PHASE7_737_ASSESSMENT_CUMULATIVE_RESYNTHESIS_ACCEPTANCE_20260815.md)
- [当前 Assessment 到 AEO/Word](docs/PHASE8_AEO_CURRENT_RESYNTHESIS_LOCAL_ACCEPTANCE_20260815.md)
- [文档索引与历史归档说明](docs/README.md)
