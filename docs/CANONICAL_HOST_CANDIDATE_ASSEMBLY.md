# Canonical Host 当前架构与装配边界

更新时间：2026-08-15

## 产品边界

`app_17bzc551rsg` 是 WiseLink 3.1 的唯一妙搭业务宿主。当前设计只保留：

- 一个妙搭 DB WorkItem/ActionAttempt 真源；
- 一个妙搭 FileService 不可变 artifact store；
- 一套 DM DocumentVersion/currentness；
- 一套 frozen.2 U0 Validator、Unified Reader 和 FailureReport authority；
- 一个妙搭页面；
- 一个 Aily Skill 和一个只读 MCP 服务。

Parser、Assessment、AEO 和 external discovery 以内部模块接入；它们不拥有第二个 WorkItem、
第二个 Reader、第二个 ArtifactStore 或用户产品入口。

## AppModule 实际装配

生产 `AppModule` 当前装配：

- `CanonicalHostModule`：普通 WorkItem、授权、permission snapshot、PDF producer、failure path；
- `DocumentManagementRuntimeModule`：exact DocumentVersion/currentness；
- `UnifiedReaderModule`：ordinary FileService adapter、U0 full Validator、frozen.2 FailureReport；
- `AssessmentHostConsumerModule`：Job Aid/整体评估的 host-consumable provider；
- `ExternalDiscoveryModule`：飞书原生 SearchRun/candidate 记录与人工选择边界；
- `RuntimeProbeModule`：隐藏的、登录态、只读运行环境探针；
- `ViewModule`：最后注册的页面 fallback。

`AeoAuthoringModule` 仍未装配到生产 `AppModule`。Phase 8 只在本地验收上下文中注入 owner
provider，证明当前累计 Assessment 到 working/Draft/Word 的同 WorkItem 链路；没有线上 AEO
路由或 authority。

## 当前业务主线

1. 登录态妙搭动作读取 server-owned actor、authorization 与 permission snapshot；
2. DM 生成或复用 immutable DocumentVersion；
3. ordinary repository 以业务唯一键创建或复用 WorkItem；
4. producer 生成 frozen.2 package；
5. FileService persist 后实际字节/长度/SHA-256 readback；
6. U0 full Validator 通过后 Unified Reader 才可查询；
7. Job Aid/整体评估生成 candidate，工程师修改使旧结果 stale，显式重综合；
8. 只有当前累计 resynthesis 可进入 AEO candidate；
9. 页面和 Aily Skill 都读取同一 WorkItem projection。

WorkItem 写入复用现有 state revision/CAS 和 ActionAttempt。没有队列、worker、租约平台或
Base 镜像。

## Aily 与 OpenClaw

Aily 使用 Skill，不使用复杂 Workflow。Skill 只调用单一无状态 MCP 的 status、source-bound
query、deep-link 三个工具；MCP 进程内复用现有服务，三个固定 GET 继续保留。需要写入或人工
确认时返回妙搭 deep link。

OpenClaw 只负责 OEM 网站发现。搜索 run/candidate 持久化在飞书原生候选层；snippet/URL 不进入
DM。只有完整、非受限、直接官方来源且经人工选择的实际文件，才调用既有 DM ingest。

## 已删除的 superseded 源码

以下未被 `AppModule`、运行时模块或当前验收主线引用，已从源码和构建 assets 删除：

- `server/modules/assessment-registrar/` detached activation/Hosted Registrar 试验；
- `server/capabilities/wl-v31-*-registrar.json` 旧三表 Base capability；
- 对应的 dedicated Open Platform Base transport 和仅验证这些试验的单元测试。

它们曾是 activation-first 路线的 local evidence，但普通妙搭 WorkItem 主线已经 supersede
该方案。历史结论仍可从 Git 和标记为 archived 的验收文档追溯。

需要特别区分：当前 `MiaodaCanonicalWorkItemRegistrarAdapter` 是 ordinary WorkItem service 的
服务端适配器，仍在生产装配并保留认证、CAS 和 ActionAttempt；它不是旧 Hosted Registrar。

## 保留的模块来源

- Unified 的 unconfigured adapters/public factories：用于默认 fail-closed 和组合测试；
- AEO owner source snapshot：用于同 WorkItem AEO 本地验收，生产未装配；
- Runtime probe/validation closure：用于已授权的托管环境验证；
- 历史 acceptance 文档：作为证据归档，不是当前实现说明。

这些内容不得被解释为第二套产品或激活路线。

## 验收入口

- hosted FTD：`FIRST_REAL_FTD_WORKITEM_VERTICAL_ACCEPTANCE_20260814.md`
- 737 累计评估：`PHASE7_737_ASSESSMENT_CUMULATIVE_RESYNTHESIS_ACCEPTANCE_20260815.md`
- Assessment → AEO/Word：`PHASE8_AEO_CURRENT_RESYNTHESIS_LOCAL_ACCEPTANCE_20260815.md`
- Aily Skill/MCP：`AILY_MINIMAL_ENTRY_HANDOFF_20260814.md`
- 外部 OEM discovery：`PHASE6C_EXTERNAL_DISCOVERY_CANDIDATE_STORE_HANDOFF_20260815.md`

## Non-claims

- 本地 AEO 通过不等于 hosted AEO、正式 Draft/Word 或工程批准；
- Aily 只读接口不授权解析、评估、重综合或发布；
- OpenClaw discovery 不形成适用性或工程证据；
- 本装配说明不授权 push、release、线上写、权限变化或 current switch。
