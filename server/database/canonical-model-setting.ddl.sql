BEGIN;

CREATE TABLE canonical_model_setting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(128) NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  model_ref VARCHAR(255) NOT NULL,
  changed_by_user_id VARCHAR(255) NOT NULL,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE ROW(current_setting('app.user_id', TRUE))::user_profile END
  ),
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE ROW(current_setting('app.user_id', TRUE))::user_profile END
  )
);

ALTER TABLE canonical_model_setting ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON canonical_model_setting TO service_role USING (true);
CREATE POLICY "修改全部数据" ON canonical_model_setting AS PERMISSIVE FOR ALL TO authenticated USING (false);
CREATE POLICY "查看全部数据" ON canonical_model_setting AS PERMISSIVE FOR SELECT TO authenticated USING (false);
CREATE POLICY "修改本人数据" ON canonical_model_setting AS PERMISSIVE FOR ALL TO authenticated USING (false);

COMMENT ON TABLE canonical_model_setting IS
  'Tenant-wide WiseLink default model ref only. Host validates configured platform model-manager authority and catalog membership. New ActionAttempts capture the choice; existing tasks are unchanged. No credentials or document data.';

COMMIT;
