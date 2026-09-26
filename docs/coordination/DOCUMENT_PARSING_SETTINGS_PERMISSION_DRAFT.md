# 文档解析设置：待授权的精确管理能力草案

状态：2026-09-26 用户已明确选择“暂不增加权限，保留实现”。以下权限方案仅保留备查，不得据此执行；只有用户后续明确重新授权才继续权限部署。本文件不是生产迁移。没有创建角色、授予成员、设置生产环境变量或修改生产策略。两个开关默认 false；用户显式保存后只影响新受理的本地解析，已有 run 使用原快照。

## 官方身份到 RLS 的现成路径

本地安装的 `@lark-apaas/nestjs-datapaas@1.0.21` 的 `dist/index.js:692–708` 从 `req.userContext.roles` 自动生成事务内 `SET LOCAL app.role_ids`，从当前用户身份切换为 `authenticated_<schema>`；`:738–763` 在同一连接先执行身份上下文再执行 Drizzle 查询。`@lark-apaas/fullstack-nestjs-core/dist/index.js:34453–34467` 从妙搭网关身份构建 userContext；`:36550–36552` 按先身份、后数据库上下文的顺序注册中间件。本项目 `server/app.module.ts:49` 使用 `PlatformModule.forRoot()`。

因此无须增加角色 SQL 查询函数或自建角色表；RLS 可以精确读取官方注入的 `app.role_ids`。这沿用现有 Hosted 网关可信边界：网关必须替换外部身份头，本机伪造 header、客户端参数、自行 SET app.roles 均不构成角色授权。当前 browser ingress 已拒绝直接本机身份。这里未声称角色 GUC 能防御已获得直接 SQL 执行能力的攻击者。

## 需要用户额外批准的范围

- 在应用 `app_17bzc551rsg` 创建一个真实平台“解析设置管理”专用角色，唯一成员为当前用户 Liu Xuan；创建前核对其真实平台用户 ID，不以显示名直接授权。角色及成员均须回读。
- 把返回的真实 role_id 绑定到 `WL_DOCUMENT_PARSING_SETTINGS_MANAGER_ROLE_ID`，不绑定全局模型管理角色。服务同时核对 Host actor 与网关 platformRoles。
- 执行单独的两列 DDL（`server/database/document-parsing-settings.ddl.sql`）；不把本草案夹带到已有发布动作。
- 仅为 `canonical_model_setting` 增加下方 INSERT/UPDATE 条件与字段保护。前端请求只接受两 boolean + expectedRevision，不增加 OpenAPI key 权限、DELETE 路径或其他表权限。

生产只读事实：表当前无行；`authenticated` 与 `authenticated_workspace_aadkpkjef3slu` 已有表级 SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/TRUNCATE。列权限视图投影出同样的全列权限，单独授予部分列不能收窄已有表级 UPDATE。当前 RLS 只允许 tenant SELECT，其余写策略 false。

本草案因此使用该表的普通 SECURITY INVOKER trigger 保护不可变字段，不新增 SECURITY DEFINER、不提升服务角色、不增加角色框架。保留现有 service_role 边界。INSERT 只能初始化现有隐式默认模型 `m3probe/minimax-m3`；UPDATE 不能改变 model_ref、tenant、id 或创建审计字段。未来若要开启全局模型管理，需要单独审阅其写入合同。

既存 TRUNCATE 等权限不在本次整改范围；本草案没有 REVOKE 或新 TRUNCATE guard，也不宣称修复所有直接数据库能力。RLS 不覆盖 TRUNCATE，但本次浏览器 API 不提供执行任意 SQL 的路径。

## 不可直接执行的 SQL 草案

必须取得上述精确授权、核实当前 schema/继承关系与已发布 SDK 后，才将占位符替换为回读的真实 role_id。占位符检查会主动阻止原样执行。新增策略与 trigger 名若已存在，应先只读核对，不使用 DROP/覆盖来绕过冲突。现 tenant SELECT 策略保留。

```sql
-- DRAFT: the real platform role and member are NOT authorized or created.
BEGIN;
DO $$ BEGIN
  IF '__PARSING_MANAGER_ROLE_ID__' LIKE '\_\_%' ESCAPE '\' THEN
    RAISE EXCEPTION 'DRAFT_ROLE_ID_NOT_BOUND';
  END IF;
END $$;

CREATE FUNCTION canonical_parsing_settings_write_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
DECLARE
  actor text := nullif(current_setting('app.user_id', true), '');
  manager_role constant text := '__PARSING_MANAGER_ROLE_ID__';
BEGIN
  IF manager_role = '__' || 'PARSING_MANAGER_ROLE_ID__' THEN
    RAISE EXCEPTION 'DRAFT_ROLE_ID_NOT_BOUND';
  END IF;
  IF NOT pg_has_role(current_user, 'authenticated', 'member') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'PARSING_SETTINGS_DELETE_DENIED'; END IF;
  IF actor IS NULL OR NOT (manager_role = ANY(string_to_array(coalesce(current_setting('app.role_ids', true), ''), ','))) THEN
    RAISE EXCEPTION 'PARSING_SETTINGS_MANAGER_REQUIRED';
  END IF;
  IF NEW.changed_by_user_id IS DISTINCT FROM actor OR (NEW._updated_by).user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'PARSING_SETTINGS_AUDIT_ACTOR_MISMATCH';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision <> 1 OR NEW.model_ref IS DISTINCT FROM 'm3probe/minimax-m3'
       OR (NEW._created_by).user_id IS DISTINCT FROM actor THEN
      RAISE EXCEPTION 'PARSING_SETTINGS_INSERT_INVALID';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['local_mineru_fallback_enabled','title_enhancement_enabled','revision','changed_by_user_id','_updated_at','_updated_by'])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['local_mineru_fallback_enabled','title_enhancement_enabled','revision','changed_by_user_id','_updated_at','_updated_by']) THEN
      RAISE EXCEPTION 'PARSING_SETTINGS_IMMUTABLE_COLUMN';
    END IF;
    IF NEW.revision <> OLD.revision + 1 THEN RAISE EXCEPTION 'PARSING_SETTINGS_REVISION_INVALID'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER canonical_parsing_settings_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON canonical_model_setting
FOR EACH ROW EXECUTE FUNCTION canonical_parsing_settings_write_guard();

CREATE POLICY parsing_settings_manager_insert ON canonical_model_setting
FOR INSERT TO authenticated WITH CHECK (
  engineering_matter_actor_has_tenant(tenant_id)
  AND '__PARSING_MANAGER_ROLE_ID__' = ANY(string_to_array(coalesce(current_setting('app.role_ids', true), ''), ','))
);
CREATE POLICY parsing_settings_manager_update ON canonical_model_setting
FOR UPDATE TO authenticated USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND '__PARSING_MANAGER_ROLE_ID__' = ANY(string_to_array(coalesce(current_setting('app.role_ids', true), ''), ','))
) WITH CHECK (
  engineering_matter_actor_has_tenant(tenant_id)
  AND '__PARSING_MANAGER_ROLE_ID__' = ANY(string_to_array(coalesce(current_setting('app.role_ids', true), ''), ','))
);
CREATE POLICY parsing_settings_no_authenticated_delete ON canonical_model_setting
AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
COMMIT;
```

## CAS 与验证

Host 的 UPDATE 在同一 SQL 使用 `WHERE tenant_id = actor.tenantId AND revision = expectedRevision`，只更新两开关、revision + 1 和正常审计。零行统一返回 revision conflict；trigger 额外要求 revision 逐次加一。INSERT 期望 revision 0，以 tenant 唯一约束 / ON CONFLICT DO NOTHING 保证并发只有一个赢家；数据库实际新行 revision 为 1。

在用户已指定的本机隔离 PostgreSQL 16 中，以独立 schema 和临时 NOLOGIN 角色模拟现有宽表级 UPDATE grant，验证 10 项通过：占位符拒绝、非管理 INSERT 拒绝、跨租户 INSERT 拒绝、管理双开关 INSERT、非管理 UPDATE 零行、跨租户 UPDATE 零行、管理双开关 CAS UPDATE、旧 revision 零行、model_ref 修改拒绝、DELETE 零行。测试结束已删除独立 schema 与临时角色。没有触及原有工程测试表或生产数据。

隔离测试脚本保留于 `/tmp/wl-test-parsing-permission.cjs`，SQL 临时文件 `/tmp/wl-parsing-permission-draft.sql`；这些为本机会话验证材料，不是已授权生产部署产物。
