-- WiseLink V1.1 Host-owned Job-Aid RuleSet lifecycle.
--
-- Snapshot rows are immutable rule payloads. Activation rows are an
-- append-only current ledger: the greatest activation_revision is current,
-- and the unique revision is the CAS boundary. A promotion or rollback is one
-- insert, so current selection and its audit fact cannot diverge.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_rule_set_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  rule_set_key varchar(64) NOT NULL,
  criterion_set_id varchar(96) NOT NULL,
  criterion_set_hash varchar(71) NOT NULL,
  member_identity_hash varchar(71) NOT NULL,
  criteria_count integer NOT NULL,
  rule_pack_version varchar(96) NOT NULL,
  rule_pack_json text NOT NULL,
  artifact_ref text NOT NULL,
  artifact_digest varchar(71) NOT NULL,
  artifact_version varchar(255) NOT NULL,
  canonical_criteria_hash varchar(71) NOT NULL,
  source_job_aid_document_version_id varchar(96),
  source_job_aid_version_status varchar(32) NOT NULL,
  created_by_engineering_owner_user_id varchar(255) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_canonical_rule_set_snapshot
    UNIQUE (tenant_id, rule_set_key, criterion_set_id),
  CONSTRAINT ck_canonical_rule_set_key
    CHECK (rule_set_key = 'JOB_AID'),
  CONSTRAINT ck_canonical_rule_set_criterion_hash
    CHECK (criterion_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_rule_set_member_hash
    CHECK (member_identity_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_rule_set_artifact_digest
    CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_rule_set_criteria_hash
    CHECK (canonical_criteria_hash ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT ck_canonical_rule_set_criteria_count
    CHECK (criteria_count > 0),
  CONSTRAINT ck_canonical_rule_set_source_status
    CHECK (
      source_job_aid_version_status IN (
        'CONFIRMED',
        'VERSION_UNCONFIRMED'
      )
    ),
  CONSTRAINT ck_canonical_rule_set_source_version
    CHECK (
      (
        source_job_aid_version_status = 'CONFIRMED'
        AND source_job_aid_document_version_id IS NOT NULL
      )
      OR
      (
        source_job_aid_version_status = 'VERSION_UNCONFIRMED'
        AND source_job_aid_document_version_id IS NULL
      )
    ),
  CONSTRAINT ck_canonical_rule_set_payload
    CHECK (length(rule_pack_json) > 0)
);

CREATE INDEX IF NOT EXISTS idx_canonical_rule_set_snapshot_created
  ON canonical_rule_set_snapshot(tenant_id, rule_set_key, created_at);

CREATE TABLE IF NOT EXISTS canonical_rule_set_activation (
  activation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  rule_set_key varchar(64) NOT NULL,
  activation_revision integer NOT NULL,
  expected_revision integer NOT NULL,
  action varchar(32) NOT NULL,
  from_criterion_set_id varchar(96),
  active_criterion_set_id varchar(96) NOT NULL,
  engineering_owner_user_id varchar(255) NOT NULL,
  required_role_id varchar(96) NOT NULL,
  reason text NOT NULL,
  activated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_canonical_rule_set_activation_revision
    UNIQUE (tenant_id, rule_set_key, activation_revision),
  CONSTRAINT fk_canonical_rule_set_activation_target
    FOREIGN KEY (tenant_id, rule_set_key, active_criterion_set_id)
    REFERENCES canonical_rule_set_snapshot(
      tenant_id,
      rule_set_key,
      criterion_set_id
    ),
  CONSTRAINT fk_canonical_rule_set_activation_previous
    FOREIGN KEY (tenant_id, rule_set_key, from_criterion_set_id)
    REFERENCES canonical_rule_set_snapshot(
      tenant_id,
      rule_set_key,
      criterion_set_id
    ),
  CONSTRAINT ck_canonical_rule_set_activation_key
    CHECK (rule_set_key = 'JOB_AID'),
  CONSTRAINT ck_canonical_rule_set_activation_revision
    CHECK (
      expected_revision >= 0
      AND activation_revision = expected_revision + 1
    ),
  CONSTRAINT ck_canonical_rule_set_activation_action
    CHECK (action IN ('PROMOTE', 'ROLLBACK')),
  CONSTRAINT ck_canonical_rule_set_activation_change
    CHECK (
      from_criterion_set_id IS NULL
      OR from_criterion_set_id <> active_criterion_set_id
    ),
  CONSTRAINT ck_canonical_rule_set_activation_reason
    CHECK (length(btrim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_canonical_rule_set_activation_target
  ON canonical_rule_set_activation(
    tenant_id,
    rule_set_key,
    active_criterion_set_id,
    activation_revision
  );

ALTER TABLE canonical_rule_set_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE canonical_rule_set_activation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS canonical_rule_set_snapshot_service_role_read
  ON canonical_rule_set_snapshot;
CREATE POLICY canonical_rule_set_snapshot_service_role_read
  ON canonical_rule_set_snapshot
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS canonical_rule_set_snapshot_service_role_insert
  ON canonical_rule_set_snapshot;
CREATE POLICY canonical_rule_set_snapshot_service_role_insert
  ON canonical_rule_set_snapshot
  AS PERMISSIVE
  FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS canonical_rule_set_activation_service_role_read
  ON canonical_rule_set_activation;
CREATE POLICY canonical_rule_set_activation_service_role_read
  ON canonical_rule_set_activation
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS canonical_rule_set_activation_service_role_insert
  ON canonical_rule_set_activation;
CREATE POLICY canonical_rule_set_activation_service_role_insert
  ON canonical_rule_set_activation
  AS PERMISSIVE
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION reject_canonical_rule_set_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS canonical_rule_set_snapshot_immutable
  ON canonical_rule_set_snapshot;
CREATE TRIGGER canonical_rule_set_snapshot_immutable
  BEFORE UPDATE OR DELETE ON canonical_rule_set_snapshot
  FOR EACH ROW EXECUTE FUNCTION reject_canonical_rule_set_row_mutation();

DROP TRIGGER IF EXISTS canonical_rule_set_snapshot_no_truncate
  ON canonical_rule_set_snapshot;
CREATE TRIGGER canonical_rule_set_snapshot_no_truncate
  BEFORE TRUNCATE ON canonical_rule_set_snapshot
  FOR EACH STATEMENT EXECUTE FUNCTION reject_canonical_rule_set_row_mutation();

DROP TRIGGER IF EXISTS canonical_rule_set_activation_append_only
  ON canonical_rule_set_activation;
CREATE TRIGGER canonical_rule_set_activation_append_only
  BEFORE UPDATE OR DELETE ON canonical_rule_set_activation
  FOR EACH ROW EXECUTE FUNCTION reject_canonical_rule_set_row_mutation();

DROP TRIGGER IF EXISTS canonical_rule_set_activation_no_truncate
  ON canonical_rule_set_activation;
CREATE TRIGGER canonical_rule_set_activation_no_truncate
  BEFORE TRUNCATE ON canonical_rule_set_activation
  FOR EACH STATEMENT EXECUTE FUNCTION reject_canonical_rule_set_row_mutation();

COMMENT ON TABLE canonical_rule_set_snapshot IS
  'Immutable Host-owned Job-Aid rule payload and existing CriterionSet identity.';
COMMENT ON TABLE canonical_rule_set_activation IS
  'Append-only promotion/rollback ledger; greatest revision is current and each row is its audit fact.';
COMMENT ON COLUMN canonical_rule_set_activation.engineering_owner_user_id IS
  'Final-user identity resolved by the Host; never accepted from AI/provider input.';

COMMIT;

-- REQUIRED PRE-TRAFFIC STEP (integration/deploy owner only):
-- npm run bootstrap:canonical:rule-set-v0-2 -- \
--   --owner-map <exact-existing-tenant-owner-map.json> --apply
-- Do not serve application traffic until that command returns every existing
-- tenant with the exact legacy v0.2 snapshot as its read-back active head.
-- Required post-apply database readback:
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname LIKE 'canonical_rule_set_%' ORDER BY relname;
-- SELECT tenant_id, rule_set_key, max(activation_revision)
-- FROM canonical_rule_set_activation GROUP BY tenant_id, rule_set_key;
