# LCM 本地构型快照数据库

本模块把用户授权的本地 LCM XLS/XLSX 原件解析、归档并导入隔离 PostgreSQL。它提供历史、按日/时刻和邻接查询消费者；没有接入生产 HTTP、智能体工具或前端。Host 继续掌握身份、权限和正式采用。

## 来源和解释

- 原始文件按 SHA256 保存，保留采集、文件名、来源路径和 sheet/行/列坐标。相同原件可对应不同采集；同请求重放幂等，参数改变报冲突。
- 矩阵 `1` 表示实装且允装，`2` 表示仅允装；空白及未定义值保持未知。可选 `FIN号` 是软件位置元数据，不是机尾列。
- 身份保留机型、飞机号、ATA、系统、类型、名称、精确件号及 FIN。相同飞机+件号的不同位置不能合并成一个状态。
- 用户确认的系统状态日保存为 `systemStateDate`、`Asia/Shanghai`、日精度；精确观察时间可为空。导出/导入时间不等于安装、执行或业务生效时间。
- 文件引用和外部关系均保留精确版本，匹配冲突不择首。真实关联须由 Host 提供已授权版本；测试引用不能当作真实 TDMS/文件/机队数据。

## 本地执行

从仓库根目录运行；需现有 Node 依赖及本机 PostgreSQL 工具。只使用 owned-postgres-cluster 创建的临时本机随机端口实例，不读取生产连接 URL。证据目录应位于私有存储，不能提交到公开仓库。

本次幂等修正仅验收新建候选存储：显式采集的本地重放身份是 `scopeKey + collectionId`，路径只保留为首次采集的来源证据；数据库请求摘要保留 tenant、actor、来源和请求内容，不包含可变授权列表。每次导入仍独立验证当前来源及引用两端的授权。

旧算法生成的 staging 观察文件名及数据库 `request_hash` 与新算法不兼容。本次没有实现原地升级或旧 collection/request 的幂等兼容。原交付的 15 份快照 staging/dump 保持只读，不迁移、不覆盖、不自动重新导入。新写入必须使用新的空 staging 目录和新建空数据库；`verify` 使用新的空证据目录，不复用旧证据目录中的 staging。不得将旧观察文件或数据库行复制到新存储后继续写入。

旧备份仍可用下述 `query` 模式恢复到新的隔离实例，以只读角色查询；该路径不重新导入采集，也不更新旧备份。后续真实 Host 接线前，旧存储的兼容迁移须另行设计和验证，本次不扩展数据库 schema。

```sh
TDMS_PG_BIN_DIRECTORY=/path/to/postgresql/bin \
node scripts/run-lcm-local-postgres.mjs verify \
  --manifest /private/path/manifest.json \
  --evidence-dir /private/path/verification
```

manifest 包含 `tenantId`、`actorId`、`sourceInstanceId`、`expectedAircraftModels` 和 `inputs`。每项 input 有 `inputPath`、`aircraftModel` 以及 `context`。context 的 schemaVersion 是 `wiselink.lcm.collection_context.v1`，包含唯一 collectionId、sourceOrigin、pageUrl、filters、observedAt、sourceEvidence；日级来源另加 systemStateDate、systemStateTimeZone、systemStateDateBasis。未知筛选值必须保留 null。类型定义见 shared/lcm-export-staging.interface.ts。

verify 测试幂等、历史变化、迟到快照、权限与回滚，再导入 manifest。成功后输出 verification.json、原件归档、查询请求和 lcm-local-db.dump（附 SHA256）。提供 manifest 时备份前移除模拟数据。临时实例退出时清理，数据库交付物是可恢复备份；并非常驻服务。

```sh
TDMS_PG_BIN_DIRECTORY=/path/to/postgresql/bin \
node scripts/run-lcm-local-postgres.mjs query \
  --restore /private/path/verification/lcm-local-db.dump \
  --request /private/path/verification/query-day.request.json \
  --output /private/path/verification/restored-query.json
```

query 在新的隔离实例恢复备份，并使用非超级用户、无 RLS 绕过权的只读角色执行固定操作 `history`、`as-of` 或 `neighborhood`。单次最多 500 条；truncated=true 时结果不完整。请求中的身份/来源范围只适用于本地可信操作者；接入生产必须从 Host 服务授权派生，不能直接相信客户端传入值。

按日查询不伪造午夜观察时间。同日没有精确时序时，以采集顺序选择，不能据此推断实际安装时序。有日级材料时精确时刻 as-of 可能返回 SOURCE_TIME_PRECISION_INSUFFICIENT。快照缺行不代表卸载，也不会回退补入更旧快照中的记录。

## 集成与验收边界

迁移是 migrations/0072_lcm_configuration_store.sql；未修改生成的 server/database/schema.ts。该迁移尚未在生产执行，编号与主线迁移冲突应由集成主控核对。

最新实际测试结果以私有 evidence 中的 verification.json 和恢复查询回执为准。解析通过、模拟关系通过、真实来源关联和生产运行是独立结论。

每日全机型获取尚未启用。当前浏览器导出存在不安全下载提示，未修改或绕过浏览器安全设置；需验证安全的 HTTPS/正式导出接口、登录续期和状态筛选范围，核对现有任务后才能启用。当前 run-once/verify 可供授权的手动文件交付流程使用。
