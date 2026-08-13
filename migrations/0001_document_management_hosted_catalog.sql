-- Local migration handoff for the sole CanonicalMiaodaApp host owner.
-- Do not execute from this module repository. The host owner first verifies an
-- empty DEV target, runs this once through `lark-cli apps +db-execute`, and then
-- regenerates server/database/schema.ts with `npm run gen:db-schema`.

BEGIN;

CREATE TABLE dm_source_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_artifact_id varchar(96) NOT NULL,
  sha256 varchar(64) NOT NULL,
  byte_length bigint NOT NULL,
  media_type varchar(160) NOT NULL,
  bucket_id varchar(255) NOT NULL,
  file_path text NOT NULL,
  provider_object_id varchar(255) NOT NULL,
  provider_version_id varchar(255) NOT NULL,
  readback_verified boolean NOT NULL,
  created_at timestamp(3) with time zone NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_source_artifact_business_id UNIQUE (source_artifact_id),
  CONSTRAINT uk_dm_source_artifact_content UNIQUE (sha256, byte_length),
  CONSTRAINT uk_dm_source_artifact_locator UNIQUE (bucket_id, file_path),
  CONSTRAINT ck_dm_source_artifact_sha CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_dm_source_artifact_size CHECK (byte_length > 0),
  CONSTRAINT ck_dm_source_artifact_readback CHECK (readback_verified = TRUE)
);

CREATE TABLE dm_acquisition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acquisition_id varchar(96) NOT NULL,
  source_artifact_id varchar(96) NOT NULL,
  document_version_id varchar(96),
  source_channel varchar(96) NOT NULL,
  source_ref text NOT NULL,
  selection_bucket_id varchar(255) NOT NULL,
  selection_file_path text NOT NULL,
  provider_object_id varchar(255) NOT NULL,
  provider_version_id varchar(255) NOT NULL,
  acquired_by varchar(255) NOT NULL,
  acquired_at timestamp(3) with time zone NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  source_descriptor_json text NOT NULL,
  status varchar(96) NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_acquisition_business_id UNIQUE (acquisition_id),
  CONSTRAINT uk_dm_acquisition_idempotency UNIQUE (idempotency_key)
);
CREATE INDEX idx_dm_acquisition_source_artifact ON dm_acquisition(source_artifact_id);
CREATE INDEX idx_dm_acquisition_document_version ON dm_acquisition(document_version_id);

CREATE TABLE dm_publication_family (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id varchar(96) NOT NULL,
  canonical_identity_key varchar(512) NOT NULL,
  document_family varchar(32) NOT NULL,
  issuer_authority varchar(255) NOT NULL,
  canonical_document_number varchar(255) NOT NULL,
  current_document_version_id varchar(96),
  current_generation integer NOT NULL DEFAULT 0,
  status varchar(64) NOT NULL,
  created_at timestamp(3) with time zone NOT NULL,
  updated_at timestamp(3) with time zone NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_publication_family_business_id UNIQUE (family_id),
  CONSTRAINT uk_dm_publication_family_identity UNIQUE (canonical_identity_key),
  CONSTRAINT ck_dm_publication_family_generation CHECK (current_generation >= 0)
);
CREATE INDEX idx_dm_publication_family_current ON dm_publication_family(current_document_version_id);

CREATE TABLE dm_document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id varchar(96) NOT NULL,
  family_id varchar(96) NOT NULL,
  document_family varchar(32) NOT NULL,
  status varchar(64) NOT NULL,
  created_at timestamp(3) with time zone NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_document_business_id UNIQUE (document_id),
  CONSTRAINT uk_dm_document_family UNIQUE (family_id)
);

CREATE TABLE dm_document_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_version_id varchar(96) NOT NULL,
  document_id varchar(96) NOT NULL,
  family_id varchar(96) NOT NULL,
  revision_id varchar(96) NOT NULL,
  canonical_revision_identity varchar(255) NOT NULL,
  business_revision varchar(96) NOT NULL,
  revision_date varchar(16) NOT NULL,
  source_generated_date varchar(16) NOT NULL,
  original_filename text NOT NULL,
  source_artifact_id varchar(96) NOT NULL,
  acquisition_id varchar(96) NOT NULL,
  pdf_sha256 varchar(64) NOT NULL,
  byte_length bigint NOT NULL,
  media_type varchar(160) NOT NULL,
  lifecycle_status varchar(64) NOT NULL,
  committed_at timestamp(3) with time zone NOT NULL,
  committed_by varchar(255) NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_document_version_business_id UNIQUE (document_version_id),
  CONSTRAINT uk_dm_document_version_revision UNIQUE (family_id, canonical_revision_identity),
  CONSTRAINT ck_dm_document_version_sha CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_dm_document_version_size CHECK (byte_length > 0)
);
CREATE INDEX idx_dm_document_version_content ON dm_document_version(pdf_sha256, byte_length);
CREATE INDEX idx_dm_document_version_acquisition ON dm_document_version(acquisition_id);

CREATE TABLE dm_ingress_preflight (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preflight_id varchar(96) NOT NULL,
  acquisition_id varchar(96) NOT NULL,
  decision varchar(96) NOT NULL,
  branch varchar(64) NOT NULL,
  execution_authorized boolean NOT NULL DEFAULT FALSE,
  observed_current_generation integer NOT NULL,
  observed_current_document_version_id varchar(96),
  normalized_descriptor_json text NOT NULL,
  decision_payload_json text NOT NULL,
  status varchar(64) NOT NULL,
  document_version_id varchar(96),
  commit_idempotency_key varchar(255),
  created_at timestamp(3) with time zone NOT NULL,
  committed_at timestamp(3) with time zone,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_ingress_preflight_business_id UNIQUE (preflight_id),
  CONSTRAINT uk_dm_ingress_preflight_commit_key UNIQUE (commit_idempotency_key),
  CONSTRAINT ck_dm_ingress_preflight_authority CHECK (execution_authorized = FALSE),
  CONSTRAINT ck_dm_ingress_preflight_generation CHECK (observed_current_generation >= 0)
);
CREATE INDEX idx_dm_ingress_preflight_acquisition ON dm_ingress_preflight(acquisition_id);

CREATE TABLE dm_currentness_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currentness_decision_id varchar(96) NOT NULL,
  family_id varchar(96) NOT NULL,
  previous_document_version_id varchar(96),
  next_document_version_id varchar(96) NOT NULL,
  previous_generation integer NOT NULL,
  next_generation integer NOT NULL,
  reason varchar(96) NOT NULL,
  decided_at timestamp(3) with time zone NOT NULL,
  decided_by varchar(255) NOT NULL,
  preflight_id varchar(96) NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_dm_currentness_decision_business_id UNIQUE (currentness_decision_id),
  CONSTRAINT uk_dm_currentness_decision_generation UNIQUE (family_id, next_generation),
  CONSTRAINT ck_dm_currentness_generation CHECK (next_generation = previous_generation + 1)
);
CREATE INDEX idx_dm_currentness_decision_next_version ON dm_currentness_decision(next_document_version_id);

ALTER TABLE dm_source_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_acquisition ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_publication_family ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_document_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_ingress_preflight ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_currentness_decision ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_bypass_policy ON dm_source_artifact TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_source_artifact AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_source_artifact AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_source_artifact AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON dm_acquisition TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_acquisition AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_acquisition AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_acquisition AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON dm_publication_family TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_publication_family AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_publication_family AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_publication_family AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON dm_document TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_document AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_document AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_document AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON dm_document_version TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_document_version AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_document_version AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_document_version AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON dm_ingress_preflight TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_ingress_preflight AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_ingress_preflight AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_ingress_preflight AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE POLICY service_role_bypass_policy ON dm_currentness_decision TO service_role USING (true);
CREATE POLICY "修改全部数据" ON dm_currentness_decision AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON dm_currentness_decision AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON dm_currentness_decision AS PERMISSIVE FOR ALL TO authenticated USING (
  current_setting('app.user_id'::text) = ((_created_by).user_id)::text
);

CREATE FUNCTION dm_reject_immutable_row_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable Document Management row cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dm_document_version_immutable
  BEFORE UPDATE OR DELETE ON dm_document_version
  FOR EACH ROW EXECUTE FUNCTION dm_reject_immutable_row_mutation();

CREATE TRIGGER dm_currentness_decision_immutable
  BEFORE UPDATE OR DELETE ON dm_currentness_decision
  FOR EACH ROW EXECUTE FUNCTION dm_reject_immutable_row_mutation();

COMMIT;
