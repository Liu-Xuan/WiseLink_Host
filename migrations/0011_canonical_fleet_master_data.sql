-- WiseLink V1.0 R09 Host-owned FleetMasterData authority.
--
-- This serial migration restores versioned aircraft identity data into the
-- canonical Miaoda PostgreSQL owner. It deliberately creates no evaluator,
-- parser, browser write API, or AircraftConfigSnapshot data.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_fleet_source_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  source_snapshot_id varchar(96) NOT NULL,
  source_kind varchar(96) NOT NULL,
  logical_source_key varchar(160) NOT NULL,
  source_revision_key varchar(255) NOT NULL,
  source_content_hash varchar(71) NOT NULL,
  source_as_of varchar(10) NOT NULL,
  snapshot_as_of timestamptz(3) NOT NULL,
  fleet_snapshot_digest varchar(64) NOT NULL,
  upstream_lineage_json text NOT NULL,
  aircraft_asset_count integer NOT NULL,
  identity_alias_count integer NOT NULL,
  configuration_fact_count integer NOT NULL DEFAULT 0,
  imported_by_actor_id varchar(255) NOT NULL,
  imported_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_canonical_fleet_source_snapshot
    UNIQUE (tenant_id, source_snapshot_id),
  CONSTRAINT ck_canonical_fleet_source_content_hash
    CHECK (source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_fleet_snapshot_digest
    CHECK (fleet_snapshot_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_fleet_source_as_of
    CHECK (source_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT ck_canonical_fleet_source_counts
    CHECK (
      aircraft_asset_count > 0
      AND identity_alias_count >= 0
      AND configuration_fact_count >= 0
    )
);

CREATE TABLE IF NOT EXISTS canonical_fleet_scope_head (
  tenant_id varchar(128) PRIMARY KEY,
  current_source_snapshot_id varchar(96) NOT NULL,
  authority_revision integer NOT NULL,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_canonical_fleet_scope_head_snapshot
    FOREIGN KEY (tenant_id, current_source_snapshot_id)
    REFERENCES canonical_fleet_source_snapshot(tenant_id, source_snapshot_id),
  CONSTRAINT ck_canonical_fleet_authority_revision
    CHECK (authority_revision > 0)
);

CREATE TABLE IF NOT EXISTS canonical_fleet_asset_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  source_snapshot_id varchar(96) NOT NULL,
  asset_id varchar(96) NOT NULL,
  asset_version_id varchar(96) NOT NULL,
  aircraft_number varchar(64) NOT NULL,
  fleet_family varchar(64),
  aircraft_model varchar(64),
  series varchar(64),
  msn varchar(64),
  line_number integer,
  delivery_date varchar(10),
  valid_from timestamptz(3) NOT NULL,
  valid_to timestamptz(3),
  status varchar(32) NOT NULL,
  source_record_id varchar(128) NOT NULL,
  record_hash varchar(71) NOT NULL,
  source_record_hash varchar(71) NOT NULL,
  CONSTRAINT uk_canonical_fleet_asset_version
    UNIQUE (tenant_id, asset_version_id),
  CONSTRAINT uk_canonical_fleet_asset_snapshot
    UNIQUE (tenant_id, source_snapshot_id, asset_id),
  CONSTRAINT fk_canonical_fleet_asset_snapshot
    FOREIGN KEY (tenant_id, source_snapshot_id)
    REFERENCES canonical_fleet_source_snapshot(tenant_id, source_snapshot_id),
  CONSTRAINT ck_canonical_fleet_asset_status
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_canonical_fleet_asset_record_hash
    CHECK (record_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_fleet_asset_source_record_hash
    CHECK (source_record_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_fleet_asset_delivery_date
    CHECK (
      delivery_date IS NULL
      OR delivery_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
  CONSTRAINT ck_canonical_fleet_asset_validity
    CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_canonical_fleet_asset_identifier
  ON canonical_fleet_asset_version(
    tenant_id,
    source_snapshot_id,
    aircraft_number
  );

CREATE TABLE IF NOT EXISTS canonical_fleet_alias_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  source_snapshot_id varchar(96) NOT NULL,
  alias_version_id varchar(96) NOT NULL,
  alias_id varchar(96) NOT NULL,
  asset_id varchar(96) NOT NULL,
  alias_type varchar(64) NOT NULL,
  alias_value varchar(128) NOT NULL,
  status varchar(32) NOT NULL,
  record_hash varchar(71) NOT NULL,
  CONSTRAINT uk_canonical_fleet_alias_version
    UNIQUE (tenant_id, alias_version_id),
  CONSTRAINT uk_canonical_fleet_alias_snapshot
    UNIQUE (tenant_id, source_snapshot_id, alias_id),
  CONSTRAINT fk_canonical_fleet_alias_asset
    FOREIGN KEY (tenant_id, source_snapshot_id, asset_id)
    REFERENCES canonical_fleet_asset_version(
      tenant_id,
      source_snapshot_id,
      asset_id
    ),
  CONSTRAINT ck_canonical_fleet_alias_status
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_canonical_fleet_alias_record_hash
    CHECK (record_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_canonical_fleet_alias_identifier
  ON canonical_fleet_alias_version(
    tenant_id,
    source_snapshot_id,
    alias_value
  );

CREATE TABLE IF NOT EXISTS canonical_fleet_configuration_fact_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  source_snapshot_id varchar(96) NOT NULL,
  fact_id varchar(96) NOT NULL,
  fact_version_id varchar(96) NOT NULL,
  asset_id varchar(96) NOT NULL,
  fact_type varchar(64) NOT NULL,
  property varchar(96) NOT NULL,
  qualifier varchar(255),
  value_json text NOT NULL,
  valid_as_of varchar(10),
  status varchar(32) NOT NULL,
  source_record_id varchar(128) NOT NULL,
  record_hash varchar(71) NOT NULL,
  CONSTRAINT uk_canonical_fleet_fact_version
    UNIQUE (tenant_id, fact_version_id),
  CONSTRAINT uk_canonical_fleet_fact_snapshot
    UNIQUE (tenant_id, source_snapshot_id, fact_id),
  CONSTRAINT fk_canonical_fleet_fact_asset
    FOREIGN KEY (tenant_id, source_snapshot_id, asset_id)
    REFERENCES canonical_fleet_asset_version(
      tenant_id,
      source_snapshot_id,
      asset_id
    ),
  CONSTRAINT ck_canonical_fleet_fact_type
    CHECK (
      fact_type IN (
        'fleet_configuration',
        'sb_incorporation',
        'data_quality_issue'
      )
    ),
  CONSTRAINT ck_canonical_fleet_fact_status
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_canonical_fleet_fact_valid_as_of
    CHECK (
      valid_as_of IS NULL
      OR valid_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    ),
  CONSTRAINT ck_canonical_fleet_fact_record_hash
    CHECK (record_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_canonical_fleet_fact_lookup
  ON canonical_fleet_configuration_fact_version(
    tenant_id,
    source_snapshot_id,
    asset_id,
    property,
    qualifier
  );

ALTER TABLE canonical_fleet_source_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_fleet_scope_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_fleet_asset_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_fleet_alias_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_fleet_configuration_fact_version
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY canonical_fleet_source_snapshot_authenticated_select
  ON canonical_fleet_source_snapshot FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          canonical_fleet_source_snapshot.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  );

CREATE POLICY canonical_fleet_scope_head_authenticated_select
  ON canonical_fleet_scope_head FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          canonical_fleet_scope_head.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  );

CREATE POLICY canonical_fleet_asset_authenticated_select
  ON canonical_fleet_asset_version FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          canonical_fleet_asset_version.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  );

CREATE POLICY canonical_fleet_alias_authenticated_select
  ON canonical_fleet_alias_version FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          canonical_fleet_alias_version.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  );

CREATE POLICY canonical_fleet_fact_authenticated_select
  ON canonical_fleet_configuration_fact_version
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          canonical_fleet_configuration_fact_version.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  );

GRANT SELECT ON canonical_fleet_source_snapshot TO authenticated;
GRANT SELECT ON canonical_fleet_scope_head TO authenticated;
GRANT SELECT ON canonical_fleet_asset_version TO authenticated;
GRANT SELECT ON canonical_fleet_alias_version TO authenticated;
GRANT SELECT ON canonical_fleet_configuration_fact_version TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON canonical_fleet_source_snapshot
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON canonical_fleet_scope_head
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON canonical_fleet_asset_version
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON canonical_fleet_alias_version
  FROM authenticated;
REVOKE INSERT, UPDATE, DELETE
  ON canonical_fleet_configuration_fact_version FROM authenticated;

COMMIT;

-- Required post-apply readback:
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname LIKE 'canonical_fleet_%' ORDER BY relname;
-- SELECT schemaname, tablename, policyname, roles, cmd
-- FROM pg_policies WHERE tablename LIKE 'canonical_fleet_%'
-- ORDER BY tablename, policyname;
