-- Local DEV handoff. Apply through Miaoda's native database migration path,
-- then regenerate server/database/schema.ts. Never run against production.
BEGIN;

CREATE TABLE identity_subject_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feishu_open_id varchar(255) NOT NULL,
  feishu_tenant_key varchar(255) NOT NULL,
  feishu_user_id varchar(255),
  miaoda_user_id varchar(255) NOT NULL,
  miaoda_tenant_id varchar(128) NOT NULL,
  expected_client_id varchar(128) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  revision integer NOT NULL DEFAULT 1,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT uk_identity_subject_feishu_app UNIQUE
    (feishu_tenant_key, feishu_open_id, expected_client_id),
  CONSTRAINT ck_identity_subject_status CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT ck_identity_subject_revision CHECK (revision > 0)
);
CREATE INDEX idx_identity_subject_miaoda
  ON identity_subject_mapping(miaoda_tenant_id, miaoda_user_id);

CREATE TABLE identity_oauth_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash varchar(64) NOT NULL,
  code_verifier varchar(128) NOT NULL,
  expires_at timestamp(3) with time zone NOT NULL,
  consumed_at timestamp(3) with time zone,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT uk_identity_oauth_state_hash UNIQUE (state_hash)
);
CREATE INDEX idx_identity_oauth_state_expiry ON identity_oauth_state(expires_at);

CREATE TABLE identity_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash varchar(64) NOT NULL,
  subject_mapping_id uuid NOT NULL,
  feishu_user_id varchar(255),
  revision integer NOT NULL DEFAULT 1,
  expires_at timestamp(3) with time zone NOT NULL,
  revoked_at timestamp(3) with time zone,
  last_seen_at timestamp(3) with time zone NOT NULL,
  _created_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamp(3) with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT uk_identity_session_token_hash UNIQUE (session_token_hash),
  CONSTRAINT fk_identity_session_subject_mapping FOREIGN KEY (subject_mapping_id)
    REFERENCES identity_subject_mapping(id),
  CONSTRAINT ck_identity_session_revision CHECK (revision > 0)
);
CREATE INDEX idx_identity_session_subject
  ON identity_session(subject_mapping_id, expires_at);

ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_oauth_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_session ENABLE ROW LEVEL SECURITY;

CREATE POLICY identity_subject_mapping_service ON identity_subject_mapping
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY identity_oauth_state_service ON identity_oauth_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY identity_session_service ON identity_session
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
