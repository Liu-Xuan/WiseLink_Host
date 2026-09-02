-- WiseLink V1.0 R09 supervised configuration-evidence query seam.
--
-- A query attempt persists a read-only CandidateEvidence snapshot without
-- moving WorkItem current or revision. Only a later, actor-authorized adoption
-- may bind that exact candidate to the existing configuration snapshot store
-- and advance the WorkItem through one CAS.

BEGIN;

CREATE TABLE IF NOT EXISTS configuration_evidence_query_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  query_attempt_ref varchar(160) NOT NULL,
  candidate_evidence_ref varchar(160) NOT NULL,
  request_id varchar(96) NOT NULL,
  input_revision integer NOT NULL,
  round_no integer NOT NULL,
  query_count integer NOT NULL,
  query_fingerprint varchar(64) NOT NULL,
  request_json text NOT NULL,
  projections_json text,
  candidate_snapshot_json text,
  terminal_status varchar(32) NOT NULL,
  source_record_count integer NOT NULL DEFAULT 0,
  adoption_status varchar(32) NOT NULL DEFAULT 'CANDIDATE_UNADOPTED',
  adopted_snapshot_id varchar(160),
  adopted_work_item_revision integer,
  recorded_by_actor_id varchar(255) NOT NULL,
  started_at timestamptz(3) NOT NULL,
  deadline_at timestamptz(3) NOT NULL,
  completed_at timestamptz(3),
  adopted_at timestamptz(3),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  CONSTRAINT uk_configuration_evidence_query_attempt
    UNIQUE (tenant_id, work_item_id, query_attempt_ref),
  CONSTRAINT uk_configuration_evidence_candidate
    UNIQUE (tenant_id, work_item_id, candidate_evidence_ref),
  CONSTRAINT uk_configuration_evidence_query_request
    UNIQUE (tenant_id, work_item_id, request_id),
  CONSTRAINT uk_configuration_evidence_query_fingerprint
    UNIQUE (tenant_id, work_item_id, input_revision, query_fingerprint),
  CONSTRAINT fk_configuration_evidence_query_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_configuration_evidence_query_revision
    CHECK (input_revision > 0),
  CONSTRAINT ck_configuration_evidence_query_budget
    CHECK (round_no BETWEEN 1 AND 2 AND query_count BETWEEN 1 AND 5),
  CONSTRAINT ck_configuration_evidence_query_fingerprint
    CHECK (query_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_configuration_evidence_query_status
    CHECK (
      terminal_status IN (
        'RUNNING',
        'SUCCEEDED_EVIDENCE',
        'SUCCEEDED_NO_RECORD',
        'NOT_CONNECTED',
        'ACCESS_DENIED',
        'CONFLICT',
        'FAILED_VALIDATION',
        'TIMEOUT',
        'CANCELED'
      )
    ),
  CONSTRAINT ck_configuration_evidence_query_source_count
    CHECK (source_record_count >= 0),
  CONSTRAINT ck_configuration_evidence_query_adoption
    CHECK (
      (
        adoption_status = 'CANDIDATE_UNADOPTED'
        AND adopted_snapshot_id IS NULL
        AND adopted_work_item_revision IS NULL
        AND adopted_at IS NULL
      )
      OR (
        adoption_status = 'ADOPTED'
        AND terminal_status IN ('SUCCEEDED_EVIDENCE', 'SUCCEEDED_NO_RECORD')
        AND adopted_snapshot_id IS NOT NULL
        AND adopted_work_item_revision = input_revision + 1
        AND adopted_at IS NOT NULL
      )
    ),
  CONSTRAINT ck_configuration_evidence_query_timestamps
    CHECK (
      deadline_at > started_at
      AND (
        (terminal_status = 'RUNNING' AND completed_at IS NULL)
        OR (terminal_status <> 'RUNNING' AND completed_at IS NOT NULL)
      )
    ),
  CONSTRAINT ck_configuration_evidence_query_payload
    CHECK (
      length(btrim(request_json)) > 0
      AND (
        (terminal_status = 'RUNNING'
          AND projections_json IS NULL
          AND candidate_snapshot_json IS NULL)
        OR (terminal_status <> 'RUNNING'
          AND projections_json IS NOT NULL
          AND candidate_snapshot_json IS NOT NULL
          AND length(btrim(projections_json)) > 0
          AND length(btrim(candidate_snapshot_json)) > 0)
      )
    )
);

COMMENT ON TABLE configuration_evidence_query_attempt IS
  'WorkItem-scoped read-only evidence query attempts and CandidateEvidence adoption binding.';
COMMENT ON COLUMN configuration_evidence_query_attempt.request_json IS
  '@type ResolvedConfigurationEvidenceRequest';
COMMENT ON COLUMN configuration_evidence_query_attempt.projections_json IS
  '@type InstallationEventEvidenceProjection[]';
COMMENT ON COLUMN configuration_evidence_query_attempt.candidate_snapshot_json IS
  '@type ConfigurationSnapshot';

CREATE UNIQUE INDEX IF NOT EXISTS uk_configuration_evidence_query_running
  ON configuration_evidence_query_attempt(tenant_id, work_item_id)
  WHERE terminal_status = 'RUNNING';
CREATE INDEX IF NOT EXISTS idx_configuration_evidence_query_cycle
  ON configuration_evidence_query_attempt(
    tenant_id,
    work_item_id,
    input_revision,
    round_no
  );
CREATE INDEX IF NOT EXISTS idx_configuration_evidence_query_candidate
  ON configuration_evidence_query_attempt(
    tenant_id,
    work_item_id,
    candidate_evidence_ref
  );

CREATE OR REPLACE FUNCTION configuration_evidence_query_attempt_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.tenant_id,
    OLD.work_item_id,
    OLD.query_attempt_ref,
    OLD.candidate_evidence_ref,
    OLD.request_id,
    OLD.input_revision,
    OLD.round_no,
    OLD.query_count,
    OLD.query_fingerprint,
    OLD.request_json,
    OLD.recorded_by_actor_id,
    OLD.started_at,
    OLD.deadline_at
  ) IS DISTINCT FROM ROW(
    NEW.tenant_id,
    NEW.work_item_id,
    NEW.query_attempt_ref,
    NEW.candidate_evidence_ref,
    NEW.request_id,
    NEW.input_revision,
    NEW.round_no,
    NEW.query_count,
    NEW.query_fingerprint,
    NEW.request_json,
    NEW.recorded_by_actor_id,
    NEW.started_at,
    NEW.deadline_at
  ) THEN
    RAISE EXCEPTION 'CONFIGURATION_EVIDENCE_QUERY_BINDING_IMMUTABLE';
  END IF;

  IF OLD.terminal_status = 'RUNNING' THEN
    IF NEW.terminal_status = 'RUNNING'
      OR NEW.completed_at IS NULL
      OR NEW.adoption_status <> 'CANDIDATE_UNADOPTED'
      OR NEW.adopted_snapshot_id IS NOT NULL
      OR NEW.adopted_work_item_revision IS NOT NULL
      OR NEW.adopted_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'CONFIGURATION_EVIDENCE_QUERY_TERMINAL_TRANSITION_INVALID';
    END IF;
  ELSE
    IF NEW.terminal_status <> OLD.terminal_status
      OR NEW.projections_json IS DISTINCT FROM OLD.projections_json
      OR NEW.candidate_snapshot_json IS DISTINCT FROM OLD.candidate_snapshot_json
      OR NEW.source_record_count <> OLD.source_record_count
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
    THEN
      RAISE EXCEPTION 'CONFIGURATION_EVIDENCE_QUERY_RESULT_IMMUTABLE';
    END IF;
    IF OLD.adoption_status = 'ADOPTED'
      OR NEW.adoption_status <> 'ADOPTED'
      OR NEW.adopted_snapshot_id IS NULL
      OR NEW.adopted_work_item_revision <> NEW.input_revision + 1
      OR NEW.adopted_at IS NULL
    THEN
      RAISE EXCEPTION 'CONFIGURATION_EVIDENCE_QUERY_ADOPTION_TRANSITION_INVALID';
    END IF;
  END IF;

  NEW._updated_at = CURRENT_TIMESTAMP;
  NEW._updated_by = CASE
    WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS configuration_evidence_query_attempt_guard
  ON configuration_evidence_query_attempt;
CREATE TRIGGER configuration_evidence_query_attempt_guard
BEFORE UPDATE ON configuration_evidence_query_attempt
FOR EACH ROW
EXECUTE FUNCTION configuration_evidence_query_attempt_guard_update();

ALTER TABLE configuration_evidence_query_attempt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS configuration_evidence_query_authenticated_select
  ON configuration_evidence_query_attempt;
CREATE POLICY configuration_evidence_query_authenticated_select
  ON configuration_evidence_query_attempt FOR SELECT TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_query_authenticated_insert
  ON configuration_evidence_query_attempt;
CREATE POLICY configuration_evidence_query_authenticated_insert
  ON configuration_evidence_query_attempt FOR INSERT TO authenticated
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_query_authenticated_update
  ON configuration_evidence_query_attempt;
CREATE POLICY configuration_evidence_query_authenticated_update
  ON configuration_evidence_query_attempt FOR UPDATE TO authenticated
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  )
  WITH CHECK (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

DROP POLICY IF EXISTS configuration_evidence_query_hosted_runtime_select
  ON configuration_evidence_query_attempt;
CREATE POLICY configuration_evidence_query_hosted_runtime_select
  ON configuration_evidence_query_attempt FOR SELECT TO service_role
  USING (
    configuration_evidence_actor_owns_work_item(
      tenant_id,
      work_item_id,
      recorded_by_actor_id
    )
  );

COMMIT;
