BEGIN;

CREATE TABLE work_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id VARCHAR(96) NOT NULL,
  tenant_id VARCHAR(128) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  document_id VARCHAR(96) NOT NULL,
  document_version_id VARCHAR(96) NOT NULL,
  source_artifact_id VARCHAR(96) NOT NULL,
  source_file_sha256 VARCHAR(64) NOT NULL,
  source_byte_length BIGINT NOT NULL,
  normalized_family VARCHAR(64) NOT NULL,
  request_id VARCHAR(96) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'reserved',
  revision INTEGER NOT NULL DEFAULT 0,
  projection_json TEXT,
  package_id TEXT,
  package_artifact_ref TEXT,
  package_artifact_sha256 VARCHAR(64),
  failure_code VARCHAR(160),
  failure_artifact_ref TEXT,
  failure_artifact_sha256 VARCHAR(64),
  requested_by_user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_key VARCHAR(96) NOT NULL DEFAULT 'canonical',
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT uk_work_item_business_id UNIQUE (work_item_id),
  CONSTRAINT uk_work_item_document_parse UNIQUE (
    tenant_id,
    action_type,
    document_version_id,
    run_key
  ),
  CONSTRAINT ck_work_item_source_byte_length CHECK (source_byte_length > 0),
  CONSTRAINT ck_work_item_source_sha CHECK (source_file_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE INDEX idx_work_item_status ON work_item (status, updated_at);
CREATE INDEX idx_work_item_document ON work_item (document_id, document_version_id);

CREATE TABLE action_attempt (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id VARCHAR(96) NOT NULL,
  work_item_id VARCHAR(96) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  trigger_request_id VARCHAR(96) NOT NULL,
  request_origin VARCHAR(32) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'pending',
  producer_run_id VARCHAR(96),
  package_artifact_ref TEXT,
  package_artifact_sha256 VARCHAR(64),
  failure_artifact_ref TEXT,
  failure_artifact_sha256 VARCHAR(64),
  error_code VARCHAR(160),
  error_message TEXT,
  actor_user_id VARCHAR(255) NOT NULL,
  tenant_id VARCHAR(128) NOT NULL,
  started_at TIMESTAMPTZ(3),
  completed_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT uk_action_attempt_business_id UNIQUE (attempt_id),
  CONSTRAINT uk_action_attempt_primary UNIQUE (
    work_item_id,
    action_type,
    attempt_no
  ),
  CONSTRAINT fk_action_attempt_work_item FOREIGN KEY (work_item_id)
    REFERENCES work_item (work_item_id),
  CONSTRAINT ck_action_attempt_no CHECK (attempt_no > 0)
);

CREATE INDEX idx_action_attempt_status ON action_attempt (status, updated_at);
CREATE INDEX idx_action_attempt_work_item ON action_attempt (work_item_id, attempt_no);

ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_bypass_policy ON work_item TO service_role USING (true);
CREATE POLICY "修改全部数据" ON work_item AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON work_item AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON work_item AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON action_attempt TO service_role USING (true);
CREATE POLICY "修改全部数据" ON action_attempt AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON action_attempt AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON action_attempt AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

COMMENT ON TABLE work_item IS
  'WiseLink 3.1 ordinary authenticated business WorkItem; parsed content remains in FileService.';
COMMENT ON COLUMN work_item.projection_json IS
  'Thin status/ref projection only; never stores full parsed package content.';
COMMENT ON COLUMN work_item.run_key IS
  'Server-scoped idempotency key: canonical for ordinary processing; dev:<uuid> for explicit repeatable development runs.';
COMMENT ON TABLE action_attempt IS
  'Explicit user-triggered action attempts; the primary parse attempt is unique per WorkItem.';

COMMIT;
