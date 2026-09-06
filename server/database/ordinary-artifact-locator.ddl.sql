BEGIN;

CREATE TABLE ordinary_artifact_locator (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_ref TEXT NOT NULL UNIQUE,
  sha256 VARCHAR(64) NOT NULL,
  byte_length BIGINT NOT NULL,
  media_type VARCHAR(160) NOT NULL,
  bucket_id VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  provider_object_id VARCHAR(255) NOT NULL,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE ROW(current_setting('app.user_id', TRUE))::user_profile END
  ),
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE ROW(current_setting('app.user_id', TRUE))::user_profile END
  ),
  UNIQUE (bucket_id, file_path)
);

ALTER TABLE ordinary_artifact_locator ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_policy ON ordinary_artifact_locator TO service_role USING (true);
CREATE POLICY "修改全部数据" ON ordinary_artifact_locator AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON ordinary_artifact_locator AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON ordinary_artifact_locator AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

COMMENT ON TABLE ordinary_artifact_locator IS
  'Storage-internal immutable logical-ref to SDK-returned location; authorization stays at the existing Host action. No anonymous access, package content, or recovery replicas.';
COMMENT ON COLUMN ordinary_artifact_locator.sha256 IS
  'Existing artifact content identity, not a new hash or contract.';

COMMIT;
