-- WiseLink V1.0 R09 finite configuration-evidence persistence.
--
-- The six tables below persist only WorkItem-scoped sparse observations,
-- temporal facts, event/evidence bindings, predicate traces and their current
-- pointer. They do not create an applicability evaluator, a generic graph, a
-- connector, or a global aircraft-configuration current table.

BEGIN;

CREATE TABLE IF NOT EXISTS configuration_evidence_snapshot_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  snapshot_id varchar(160) NOT NULL,
  request_id varchar(96) NOT NULL,
  request_json text NOT NULL,
  aircraft_asset_id varchar(96) NOT NULL,
  assessment_as_of timestamptz(3) NOT NULL,
  configuration_revision integer NOT NULL,
  work_item_revision_before integer NOT NULL,
  work_item_revision_after integer NOT NULL,
  source_completeness varchar(16) NOT NULL,
  requested_target_count integer NOT NULL,
  true_count integer NOT NULL,
  false_count integer NOT NULL,
  unknown_count integer NOT NULL,
  conflict_count integer NOT NULL,
  snapshot_json text NOT NULL,
  recorded_by_actor_id varchar(255) NOT NULL,
  recorded_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_configuration_evidence_snapshot
    UNIQUE (tenant_id, work_item_id, snapshot_id),
  CONSTRAINT uk_configuration_evidence_snapshot_revision_binding
    UNIQUE (
      tenant_id,
      work_item_id,
      snapshot_id,
      configuration_revision
    ),
  CONSTRAINT uk_configuration_evidence_request
    UNIQUE (tenant_id, work_item_id, request_id),
  CONSTRAINT uk_configuration_evidence_revision
    UNIQUE (tenant_id, work_item_id, configuration_revision),
  CONSTRAINT uk_configuration_evidence_work_item_revision
    UNIQUE (work_item_id, work_item_revision_after),
  CONSTRAINT fk_configuration_evidence_snapshot_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_configuration_evidence_snapshot_revisions
    CHECK (
      configuration_revision > 0
      AND work_item_revision_before > 0
      AND work_item_revision_after = work_item_revision_before + 1
    ),
  CONSTRAINT ck_configuration_evidence_snapshot_completeness
    CHECK (
      source_completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN', 'CONFLICT')
    ),
  CONSTRAINT ck_configuration_evidence_snapshot_counts
    CHECK (
      requested_target_count > 0
      AND true_count >= 0
      AND false_count >= 0
      AND unknown_count >= 0
      AND conflict_count >= 0
      AND true_count + false_count + unknown_count + conflict_count =
        requested_target_count
    ),
  CONSTRAINT ck_configuration_evidence_snapshot_payloads
    CHECK (
      length(btrim(request_json)) > 0
      AND length(btrim(snapshot_json)) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_configuration_evidence_snapshot_history
  ON configuration_evidence_snapshot_version(
    tenant_id,
    work_item_id,
    configuration_revision DESC
  );
CREATE INDEX IF NOT EXISTS idx_configuration_evidence_snapshot_aircraft_asof
  ON configuration_evidence_snapshot_version(
    tenant_id,
    aircraft_asset_id,
    assessment_as_of
  );

CREATE TABLE IF NOT EXISTS configuration_evidence_event_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  snapshot_id varchar(160) NOT NULL,
  config_event_id text NOT NULL,
  evidence_record_id text NOT NULL,
  event_kind varchar(32) NOT NULL,
  aircraft_asset_id varchar(96) NOT NULL,
  position_id varchar(160),
  effective_at timestamptz(3) NOT NULL,
  source_recorded_at timestamptz(3) NOT NULL,
  evidence_json text NOT NULL,
  event_json text NOT NULL,
  recorded_by_actor_id varchar(255) NOT NULL,
  persisted_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_configuration_evidence_event
    UNIQUE (tenant_id, work_item_id, snapshot_id, config_event_id),
  CONSTRAINT fk_configuration_evidence_event_snapshot
    FOREIGN KEY (tenant_id, work_item_id, snapshot_id)
    REFERENCES configuration_evidence_snapshot_version(
      tenant_id,
      work_item_id,
      snapshot_id
    ),
  CONSTRAINT ck_configuration_evidence_event_kind
    CHECK (
      event_kind IN (
        'INSTALL',
        'REMOVE',
        'REPLACE',
        'SOFTWARE_LOAD',
        'MODIFICATION_EMBODIMENT',
        'REPAIR_ACCOMPLISHMENT'
      )
    ),
  CONSTRAINT ck_configuration_evidence_event_payloads
    CHECK (
      length(btrim(evidence_json)) > 0
      AND length(btrim(event_json)) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_configuration_evidence_event_aircraft_time
  ON configuration_evidence_event_version(
    tenant_id,
    aircraft_asset_id,
    effective_at
  );
CREATE INDEX IF NOT EXISTS idx_configuration_evidence_event_source
  ON configuration_evidence_event_version(
    tenant_id,
    evidence_record_id
  );

CREATE TABLE IF NOT EXISTS configuration_evidence_fact_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  snapshot_id varchar(160) NOT NULL,
  fact_assertion_id text NOT NULL,
  target_key text NOT NULL,
  property varchar(96) NOT NULL,
  truth varchar(16) NOT NULL,
  value_json text NOT NULL,
  status varchar(32) NOT NULL,
  authority varchar(32) NOT NULL,
  assessment_as_of timestamptz(3) NOT NULL,
  valid_from timestamptz(3),
  valid_through_as_of timestamptz(3) NOT NULL,
  source_slice_ref text NOT NULL,
  fact_json text NOT NULL,
  recorded_by_actor_id varchar(255) NOT NULL,
  persisted_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_configuration_evidence_fact
    UNIQUE (tenant_id, work_item_id, snapshot_id, fact_assertion_id),
  CONSTRAINT fk_configuration_evidence_fact_snapshot
    FOREIGN KEY (tenant_id, work_item_id, snapshot_id)
    REFERENCES configuration_evidence_snapshot_version(
      tenant_id,
      work_item_id,
      snapshot_id
    ),
  CONSTRAINT ck_configuration_evidence_fact_truth
    CHECK (truth IN ('TRUE', 'FALSE', 'UNKNOWN', 'CONFLICT')),
  CONSTRAINT ck_configuration_evidence_fact_status
    CHECK (status IN ('SUPPORTED', 'WAITING_INPUT', 'CONFLICT')),
  CONSTRAINT ck_configuration_evidence_fact_authority
    CHECK (authority IN ('CONTROLLED_SOURCE', 'NONE')),
  CONSTRAINT ck_configuration_evidence_fact_temporal
    CHECK (valid_through_as_of = assessment_as_of),
  CONSTRAINT ck_configuration_evidence_fact_payloads
    CHECK (
      length(btrim(value_json)) > 0
      AND length(btrim(fact_json)) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_configuration_evidence_fact_lookup
  ON configuration_evidence_fact_version(
    tenant_id,
    work_item_id,
    snapshot_id,
    property
  );

CREATE TABLE IF NOT EXISTS configuration_evidence_predicate_trace_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  snapshot_id varchar(160) NOT NULL,
  predicate_trace_id text NOT NULL,
  fact_assertion_id text NOT NULL,
  target_key text NOT NULL,
  truth varchar(16) NOT NULL,
  status varchar(32) NOT NULL,
  assessment_as_of timestamptz(3) NOT NULL,
  source_slice_ref text NOT NULL,
  trace_json text NOT NULL,
  recorded_by_actor_id varchar(255) NOT NULL,
  persisted_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_configuration_evidence_trace
    UNIQUE (tenant_id, work_item_id, snapshot_id, predicate_trace_id),
  CONSTRAINT fk_configuration_evidence_trace_snapshot
    FOREIGN KEY (tenant_id, work_item_id, snapshot_id)
    REFERENCES configuration_evidence_snapshot_version(
      tenant_id,
      work_item_id,
      snapshot_id
    ),
  CONSTRAINT ck_configuration_evidence_trace_truth
    CHECK (truth IN ('TRUE', 'FALSE', 'UNKNOWN', 'CONFLICT')),
  CONSTRAINT ck_configuration_evidence_trace_status
    CHECK (status IN ('EVALUATED', 'WAITING_INPUT', 'CONFLICT', 'STALE')),
  CONSTRAINT ck_configuration_evidence_trace_payload
    CHECK (length(btrim(trace_json)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_configuration_evidence_trace_dependency
  ON configuration_evidence_predicate_trace_version(
    tenant_id,
    work_item_id,
    target_key,
    assessment_as_of
  );

CREATE TABLE IF NOT EXISTS configuration_evidence_trace_staleness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  staleness_id text NOT NULL,
  prior_snapshot_id varchar(160) NOT NULL,
  predicate_trace_id text NOT NULL,
  incoming_snapshot_id varchar(160) NOT NULL,
  incoming_configuration_revision integer NOT NULL,
  previous_status varchar(32) NOT NULL,
  stale_reason_json text NOT NULL,
  recorded_by_actor_id varchar(255) NOT NULL,
  recorded_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_configuration_evidence_trace_staleness
    UNIQUE (
      tenant_id,
      work_item_id,
      prior_snapshot_id,
      predicate_trace_id,
      incoming_snapshot_id
    ),
  CONSTRAINT fk_configuration_evidence_stale_prior_snapshot
    FOREIGN KEY (tenant_id, work_item_id, prior_snapshot_id)
    REFERENCES configuration_evidence_snapshot_version(
      tenant_id,
      work_item_id,
      snapshot_id
    ),
  CONSTRAINT fk_configuration_evidence_stale_incoming_snapshot
    FOREIGN KEY (tenant_id, work_item_id, incoming_snapshot_id)
    REFERENCES configuration_evidence_snapshot_version(
      tenant_id,
      work_item_id,
      snapshot_id
    ),
  CONSTRAINT ck_configuration_evidence_stale_revision
    CHECK (incoming_configuration_revision > 1),
  CONSTRAINT ck_configuration_evidence_stale_previous_status
    CHECK (
      previous_status IN ('EVALUATED', 'WAITING_INPUT', 'CONFLICT', 'STALE')
    ),
  CONSTRAINT ck_configuration_evidence_stale_payload
    CHECK (length(btrim(stale_reason_json)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_configuration_evidence_trace_stale_read
  ON configuration_evidence_trace_staleness(
    tenant_id,
    work_item_id,
    prior_snapshot_id,
    incoming_configuration_revision DESC
  );

CREATE TABLE IF NOT EXISTS configuration_evidence_work_item_head (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  current_snapshot_id varchar(160) NOT NULL,
  configuration_revision integer NOT NULL,
  updated_by_actor_id varchar(255) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_configuration_evidence_work_item_head
    UNIQUE (tenant_id, work_item_id),
  CONSTRAINT fk_configuration_evidence_head_snapshot
    FOREIGN KEY (
      tenant_id,
      work_item_id,
      current_snapshot_id,
      configuration_revision
    )
    REFERENCES configuration_evidence_snapshot_version(
      tenant_id,
      work_item_id,
      snapshot_id,
      configuration_revision
    ),
  CONSTRAINT ck_configuration_evidence_head_revision
    CHECK (configuration_revision > 0)
);

CREATE OR REPLACE FUNCTION configuration_evidence_actor_owns_work_item(
  scoped_tenant_id text,
  scoped_work_item_id text,
  scoped_actor_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    scoped_actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id = scoped_tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = scoped_work_item_id
        AND owned_work_item.tenant_id = scoped_tenant_id
        AND owned_work_item.requested_by_user_id = scoped_actor_id
    );
$$;

ALTER TABLE configuration_evidence_snapshot_version
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_evidence_event_version
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_evidence_fact_version
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_evidence_predicate_trace_version
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_evidence_trace_staleness
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_evidence_work_item_head
  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS configuration_evidence_snapshot_authenticated_select
  ON configuration_evidence_snapshot_version;
CREATE POLICY configuration_evidence_snapshot_authenticated_select
  ON configuration_evidence_snapshot_version FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_snapshot_authenticated_insert
  ON configuration_evidence_snapshot_version;
CREATE POLICY configuration_evidence_snapshot_authenticated_insert
  ON configuration_evidence_snapshot_version FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_event_authenticated_select
  ON configuration_evidence_event_version;
CREATE POLICY configuration_evidence_event_authenticated_select
  ON configuration_evidence_event_version FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_event_authenticated_insert
  ON configuration_evidence_event_version;
CREATE POLICY configuration_evidence_event_authenticated_insert
  ON configuration_evidence_event_version FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_fact_authenticated_select
  ON configuration_evidence_fact_version;
CREATE POLICY configuration_evidence_fact_authenticated_select
  ON configuration_evidence_fact_version FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_fact_authenticated_insert
  ON configuration_evidence_fact_version;
CREATE POLICY configuration_evidence_fact_authenticated_insert
  ON configuration_evidence_fact_version FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_trace_authenticated_select
  ON configuration_evidence_predicate_trace_version;
CREATE POLICY configuration_evidence_trace_authenticated_select
  ON configuration_evidence_predicate_trace_version
  FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_trace_authenticated_insert
  ON configuration_evidence_predicate_trace_version;
CREATE POLICY configuration_evidence_trace_authenticated_insert
  ON configuration_evidence_predicate_trace_version
  FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_stale_authenticated_select
  ON configuration_evidence_trace_staleness;
CREATE POLICY configuration_evidence_stale_authenticated_select
  ON configuration_evidence_trace_staleness FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_stale_authenticated_insert
  ON configuration_evidence_trace_staleness;
CREATE POLICY configuration_evidence_stale_authenticated_insert
  ON configuration_evidence_trace_staleness FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_head_authenticated_select
  ON configuration_evidence_work_item_head;
CREATE POLICY configuration_evidence_head_authenticated_select
  ON configuration_evidence_work_item_head FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      updated_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_head_authenticated_insert
  ON configuration_evidence_work_item_head;
CREATE POLICY configuration_evidence_head_authenticated_insert
  ON configuration_evidence_work_item_head FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      updated_by_actor_id
    )
  );
DROP POLICY IF EXISTS configuration_evidence_head_authenticated_update
  ON configuration_evidence_work_item_head;
CREATE POLICY configuration_evidence_head_authenticated_update
  ON configuration_evidence_work_item_head FOR UPDATE TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      updated_by_actor_id
    )
  )
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      updated_by_actor_id
    )
  );

-- Miaoda manages table privileges. No service-role bypass or browser DELETE
-- policy is introduced; version, Fact, event/evidence and STALE rows remain
-- append-only for ordinary authenticated product traffic.

COMMIT;
