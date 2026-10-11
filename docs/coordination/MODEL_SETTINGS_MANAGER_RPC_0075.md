# 模型设置保存：0075 受控 CAS RPC

模型管理员通过现有 API 保存模型时，平台 authenticated 数据库角色受原表写拒绝 RLS 约束，INSERT 返回 SQLSTATE 42501。0075 仅提供模型选择 CAS 函数；Repository 的该操作调用它，API 双角色鉴权、目录校验和冲突 409 保持原样。

函数只接受 tenant、modelRef、expectedRevision。它要求平台 `SET LOCAL ROLE authenticated_workspace_aadkpkjef3slu`、可信 `app.user_id`、`app.role_ids` 中精确成员 `wiselink_model_settings_manager`，以及真实 `workspace_aadkpkjef3slu.identity_subject_mapping` 的 ACTIVE、当前 actor、目标 tenant、`expected_client_id = cli_aadde8b579f95bc9` 映射。该谓词与现有租户 helper 相同，但不调用旧 helper，避免其旧 search_path 解析临时 view 并以 owner 执行副作用。

函数由现有表 owner 创建并执行，固定 `pg_catalog, workspace_aadkpkjef3slu, pg_temp` 搜索路径，表和复合类型均完全限定。函数 ACL 由平台管理：实际默认权限允许 workspace authenticated、anon、service_role，以及全局 authenticated、service_role 执行函数；普通 PostgreSQL 还默认允许 PUBLIC。0075 不改变这些授权。入口的第一个独立判定只接受 `current_setting('role') = authenticated_workspace_aadkpkjef3slu`，其他角色即使有 EXECUTE 也在读取 actor/manager 和访问表之前被拒绝。已核验这些其他平台角色不是目标 SQL role 的成员。

角色判定通过后，再核验可信 actor、精确模型管理员角色和真实租户映射。函数不接受 actor 或解析字段，INSERT 使用现有解析默认值，UPDATE 仅更改模型、版本和审计。表授权、RLS policy、角色成员及解析设置管理员配置均不改变。

上线顺序由集成 owner 审查后执行：

1. dev 和 online 已核验存在同名 `workspace_aadkpkjef3slu` schema，变更前官方 `+db-env-diff` 为 `changes: []`。执行前重新确认 dev 数据库会话 schema 与现有表 owner，模型管理 env 仍绑定已核验的 `wiselink_model_settings_manager`。
2. 通过官方数据库入口在 dev 执行 `migrations/0075_canonical_model_setting_manager_rpc.sql`，再读取 dev 的 `pg_proc` 核验函数定义、owner、SECURITY DEFINER、search_path 和平台默认 ACL。脚本包含事务和 owner/RLS 断言，异常即整笔回滚，不改变业务模型值。
3. 通过官方 `+db-env-diff` 确认 dev→online 的结构差异仅涉及该三参数函数，再按正式应用发布链路 `+release-create` 发布接受的 Host 分支。dev 结构随应用发布上线；不单独执行 `+db-env-migrate`，不执行 online DDL。
4. 同一 release 完成后核对精确提交，并读取 online `pg_proc` 确认函数存在且定义、owner、search_path、ACL 符合接受的实现。dev 执行成功不代表 online 已生效。由已授权管理员在 UI 保存一次模型，再读取版本与选择；普通用户不能管理，旧任务模型快照保持原值。

回滚时准备使用旧 Repository 的 Host，在 dev 执行 `migrations/rollback/0075_canonical_model_setting_manager_rpc.sql`，用官方 `+db-env-diff` 确认只删除该函数，然后沿同一应用发布链路上线并读取 online 元数据。它保留所有已保存模型、版本、审计、解析字段和原有 policy/授权。旧实现重新受原写拒绝 RLS 约束，因此模型保存会恢复原先的拒绝行为；读取与既有任务选择不变。

本地验证使用 `node --test test/node/canonical-model-settings-manager-rpc-postgres.test.mjs`，要求 PATH 中有现存 PostgreSQL `initdb`/`postgres`，不安装引擎，也不接受外部数据库 URL。测试为随机 loopback 端口、随机新数据库，使用现有 DDL 与生产单字段 `user_profile(user_id varchar)`，以非 owner、非 superuser、NOBYPASSRLS authenticated 角色调用真实 Repository。测试镜像已核验的平台默认函数授权，确认其他角色实际拥有 EXECUTE 却收到函数自定义拒绝；非事务 sequence canary 证明它们以合法 actor/manager 调用时仍在表访问前拒绝。覆盖模型保存和 audit、直接 DML 拒绝、解析字段隔离、角色/租户/输入负例、两个连接的 CAS 竞争、临时对象副作用 canary 与迁移回滚；finally 清理实例。
