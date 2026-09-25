BEGIN;

-- A row is written only by the authenticated Host intake path for a newly
-- accepted ordinary WorkItem. Existing rows are intentionally not backfilled.
CREATE TABLE auto_work_item_authorization (
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  request_id varchar(96) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  document_id varchar(96) NOT NULL,
  document_version_id varchar(96) NOT NULL,
  source_artifact_id varchar(96) NOT NULL,
  source_file_sha256 varchar(64) NOT NULL
    CHECK (source_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_byte_length bigint NOT NULL CHECK (source_byte_length > 0),
  grant_kind varchar(48) NOT NULL
    CHECK (grant_kind = 'MIAODA_CANONICAL_PARSE_REQUEST'),
  status varchar(16) NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'LEASED', 'BLOCKED', 'COMPLETED')),
  lease_owner varchar(160),
  lease_token uuid,
  lease_generation integer NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz(3),
  blocked_code varchar(120),
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_auto_work_item_authorization
    PRIMARY KEY (tenant_id, work_item_id),
  CONSTRAINT fk_auto_work_item_authorization_work_item
    FOREIGN KEY (tenant_id, work_item_id)
    REFERENCES work_item (tenant_id, work_item_id),
  CONSTRAINT ck_auto_work_item_authorization_lease
    CHECK ((status = 'LEASED') =
      (lease_owner IS NOT NULL AND lease_token IS NOT NULL
        AND lease_expires_at IS NOT NULL))
);

CREATE INDEX idx_auto_work_item_authorization_due
  ON auto_work_item_authorization
  (tenant_id, status, created_at, lease_expires_at);

ALTER TABLE auto_work_item_authorization ENABLE ROW LEVEL SECURITY;
CREATE POLICY auto_work_item_authorization_service_only
  ON auto_work_item_authorization
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE auto_work_item_authorization IS
  'Per-WorkItem Host grant created by authenticated ordinary intake; no legacy backfill.';
COMMENT ON COLUMN auto_work_item_authorization.grant_kind IS
  'Server-selected intake route; request payloads cannot assign this value.';

COMMIT;
