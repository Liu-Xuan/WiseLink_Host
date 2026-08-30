-- WiseLink V1.2 R09 Host-owned batch applicability candidate persistence.
--
-- One immutable run row owns the candidate matrix/clusters JSON produced by
-- the canonical evaluator. Confirmation receipts are append-only and remain
-- candidate-only. This migration does not update WorkItem applicability,
-- Fleet facts, ReviewAction, engineering approval, or publication state.

BEGIN;

CREATE TABLE IF NOT EXISTS batch_applicability_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  actor_id varchar(255) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  request_id varchar(96) NOT NULL,
  request_payload_json text NOT NULL,
  work_item_revision integer NOT NULL,
  document_version_id varchar(96) NOT NULL,
  source_package_id text NOT NULL,
  source_expression_id varchar(160) NOT NULL,
  source_condition_id varchar(160) NOT NULL,
  source_ref_ids_json text NOT NULL,
  fleet_source_snapshot_id varchar(96) NOT NULL,
  fleet_source_revision_key varchar(255) NOT NULL,
  fleet_authority_revision varchar(96) NOT NULL,
  fleet_source_as_of varchar(10) NOT NULL,
  host_binding_status varchar(32) NOT NULL,
  candidate_set_json text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_batch_applicability_run_id UNIQUE (run_id),
  CONSTRAINT uk_batch_applicability_run_request
    UNIQUE (tenant_id, work_item_id, request_id),
  CONSTRAINT fk_batch_applicability_run_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_batch_applicability_run_revision
    CHECK (work_item_revision >= 0),
  CONSTRAINT ck_batch_applicability_run_request
    CHECK (length(btrim(request_id)) > 0),
  CONSTRAINT ck_batch_applicability_run_payload
    CHECK (
      length(btrim(request_payload_json)) > 0
      AND length(btrim(candidate_set_json)) > 0
      AND length(btrim(source_ref_ids_json)) > 0
    ),
  CONSTRAINT ck_batch_applicability_run_fleet_as_of
    CHECK (fleet_source_as_of ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  CONSTRAINT ck_batch_applicability_run_host_status
    CHECK (host_binding_status IN ('CURRENT', 'STALE', 'CONFLICT', 'UNVERIFIED'))
);

CREATE INDEX IF NOT EXISTS idx_batch_applicability_run_work_item
  ON batch_applicability_run(work_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS batch_applicability_confirmation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id varchar(96) NOT NULL,
  run_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  actor_id varchar(255) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  request_id varchar(96) NOT NULL,
  request_payload_json text NOT NULL,
  work_item_revision integer NOT NULL,
  candidate_cluster_id varchar(255) NOT NULL,
  decision varchar(48) NOT NULL,
  reason text NOT NULL,
  confirmed_at timestamptz(3) NOT NULL,
  valid_until timestamptz(3) NOT NULL,
  confirmation_candidate_json text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_batch_applicability_confirmation_receipt
    UNIQUE (receipt_id),
  CONSTRAINT uk_batch_applicability_confirmation_request
    UNIQUE (tenant_id, work_item_id, request_id),
  CONSTRAINT uk_batch_applicability_confirmation_cluster
    UNIQUE (run_id, candidate_cluster_id),
  CONSTRAINT fk_batch_applicability_confirmation_run
    FOREIGN KEY (run_id) REFERENCES batch_applicability_run(run_id),
  CONSTRAINT fk_batch_applicability_confirmation_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_batch_applicability_confirmation_revision
    CHECK (work_item_revision >= 0),
  CONSTRAINT ck_batch_applicability_confirmation_decision
    CHECK (
      decision IN (
        'CONFIRM_CLUSTER_CANDIDATE',
        'REJECT_CLUSTER_CANDIDATE'
      )
    ),
  CONSTRAINT ck_batch_applicability_confirmation_reason
    CHECK (length(btrim(reason)) > 0),
  CONSTRAINT ck_batch_applicability_confirmation_payload
    CHECK (
      length(btrim(request_payload_json)) > 0
      AND length(btrim(confirmation_candidate_json)) > 0
    ),
  CONSTRAINT ck_batch_applicability_confirmation_validity
    CHECK (valid_until > confirmed_at)
);

CREATE INDEX IF NOT EXISTS idx_batch_applicability_confirmation_run
  ON batch_applicability_confirmation(run_id, created_at);

CREATE OR REPLACE FUNCTION batch_applicability_run_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BATCH_APPLICABILITY_RUN_APPEND_ONLY';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM work_item owned_work_item
    JOIN canonical_fleet_scope_head fleet_head
      ON fleet_head.tenant_id = owned_work_item.tenant_id
    JOIN canonical_fleet_source_snapshot fleet_snapshot
      ON fleet_snapshot.tenant_id = fleet_head.tenant_id
      AND fleet_snapshot.source_snapshot_id =
        fleet_head.current_source_snapshot_id
    WHERE owned_work_item.work_item_id = NEW.work_item_id
      AND owned_work_item.tenant_id = NEW.tenant_id
      AND owned_work_item.requested_by_user_id = NEW.actor_id
      AND owned_work_item.revision = NEW.work_item_revision
      AND owned_work_item.document_version_id = NEW.document_version_id
      AND owned_work_item.package_id = NEW.source_package_id
      AND fleet_head.current_source_snapshot_id =
        NEW.fleet_source_snapshot_id
      AND fleet_head.authority_revision::text =
        NEW.fleet_authority_revision
      AND fleet_snapshot.source_revision_key =
        NEW.fleet_source_revision_key
      AND fleet_snapshot.source_as_of = NEW.fleet_source_as_of
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BATCH_APPLICABILITY_RUN_BINDING_NOT_CURRENT';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION batch_applicability_confirmation_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BATCH_APPLICABILITY_CONFIRMATION_APPEND_ONLY';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM batch_applicability_run run
    JOIN work_item owned_work_item
      ON owned_work_item.work_item_id = run.work_item_id
    JOIN canonical_fleet_scope_head fleet_head
      ON fleet_head.tenant_id = run.tenant_id
    JOIN canonical_fleet_source_snapshot fleet_snapshot
      ON fleet_snapshot.tenant_id = fleet_head.tenant_id
      AND fleet_snapshot.source_snapshot_id =
        fleet_head.current_source_snapshot_id
    WHERE run.run_id = NEW.run_id
      AND run.tenant_id = NEW.tenant_id
      AND run.actor_id = NEW.actor_id
      AND run.work_item_id = NEW.work_item_id
      AND run.work_item_revision = NEW.work_item_revision
      AND run.host_binding_status = 'CURRENT'
      AND owned_work_item.tenant_id = NEW.tenant_id
      AND owned_work_item.requested_by_user_id = NEW.actor_id
      AND owned_work_item.revision = NEW.work_item_revision
      AND fleet_head.current_source_snapshot_id =
        run.fleet_source_snapshot_id
      AND fleet_head.authority_revision::text =
        run.fleet_authority_revision
      AND fleet_snapshot.source_revision_key =
        run.fleet_source_revision_key
      AND fleet_snapshot.source_as_of = run.fleet_source_as_of
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'BATCH_APPLICABILITY_CONFIRMATION_RUN_NOT_CURRENT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM batch_applicability_run candidate_run
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(
          candidate_run.candidate_set_json::jsonb -> 'candidateClusters'
        ) = 'array'
        THEN candidate_run.candidate_set_json::jsonb -> 'candidateClusters'
        ELSE '[]'::jsonb
      END
    ) candidate_cluster
    WHERE candidate_run.run_id = NEW.run_id
      AND candidate_cluster ->> 'candidateClusterId' =
        NEW.candidate_cluster_id
      AND candidate_cluster ->> 'status' = 'EVALUATED'
      AND candidate_cluster ->> 'truth' IN ('TRUE', 'FALSE')
      AND jsonb_typeof(
        candidate_cluster -> 'memberMatrixItemIds'
      ) = 'array'
      AND jsonb_array_length(
        candidate_cluster -> 'memberMatrixItemIds'
      ) > 0
      AND (
        SELECT count(*)
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(
              candidate_run.candidate_set_json::jsonb ->
                'candidateClusters'
            ) = 'array'
            THEN candidate_run.candidate_set_json::jsonb ->
              'candidateClusters'
            ELSE '[]'::jsonb
          END
        ) cluster_identity
        WHERE cluster_identity ->> 'candidateClusterId' =
          NEW.candidate_cluster_id
      ) = 1
      AND NEW.confirmation_candidate_json::jsonb ->> 'status' =
        'HUMAN_CLUSTER_REVIEW_CANDIDATE_READY'
      AND NEW.confirmation_candidate_json::jsonb ->> 'candidateSetId' =
        candidate_run.candidate_set_json::jsonb ->> 'candidateSetId'
      AND NEW.confirmation_candidate_json::jsonb ->> 'candidateClusterId' =
        NEW.candidate_cluster_id
      AND NEW.confirmation_candidate_json::jsonb ->> 'decision' =
        NEW.decision
      AND NEW.confirmation_candidate_json::jsonb ->
        'reviewedCluster' ->> 'truth' = candidate_cluster ->> 'truth'
      AND NEW.confirmation_candidate_json::jsonb ->
        'reviewedCluster' -> 'memberMatrixItemIds' =
        candidate_cluster -> 'memberMatrixItemIds'
      AND NEW.confirmation_candidate_json::jsonb ->
        'audit' ->> 'workItemId' = NEW.work_item_id
      AND NEW.confirmation_candidate_json::jsonb ->
        'audit' ->> 'workItemRevision' = NEW.work_item_revision::text
      AND NEW.confirmation_candidate_json::jsonb ->
        'audit' ->> 'confirmedByActorId' = NEW.actor_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
          candidate_cluster -> 'memberMatrixItemIds'
        ) member_matrix_item(matrix_item_id)
        WHERE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(
                candidate_run.candidate_set_json::jsonb -> 'matrix'
              ) = 'array'
              THEN candidate_run.candidate_set_json::jsonb -> 'matrix'
              ELSE '[]'::jsonb
            END
          ) matrix_item
          WHERE matrix_item ->> 'matrixItemId' =
              member_matrix_item.matrix_item_id
            AND matrix_item ->> 'candidateClusterId' =
              NEW.candidate_cluster_id
            AND matrix_item ->> 'status' = 'EVALUATED'
            AND matrix_item ->> 'truth' = candidate_cluster ->> 'truth'
            AND matrix_item ->> 'truth' IN ('TRUE', 'FALSE')
            AND matrix_item ->> 'clusterEligibility' =
              CASE candidate_cluster ->> 'truth'
                WHEN 'TRUE' THEN 'ELIGIBLE_EVALUATED_TRUE'
                WHEN 'FALSE' THEN 'ELIGIBLE_EVALUATED_FALSE'
              END
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(
              candidate_run.candidate_set_json::jsonb -> 'matrix'
            ) = 'array'
            THEN candidate_run.candidate_set_json::jsonb -> 'matrix'
            ELSE '[]'::jsonb
          END
        ) matrix_item
        WHERE matrix_item ->> 'candidateClusterId' =
            NEW.candidate_cluster_id
          AND NOT (
            candidate_cluster -> 'memberMatrixItemIds' ?
              (matrix_item ->> 'matrixItemId')
          )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'BATCH_APPLICABILITY_CONFIRMATION_CLUSTER_NOT_CONFIRMABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS batch_applicability_run_guard_trigger
  ON batch_applicability_run;
CREATE TRIGGER batch_applicability_run_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON batch_applicability_run
  FOR EACH ROW EXECUTE FUNCTION batch_applicability_run_guard();

DROP TRIGGER IF EXISTS batch_applicability_confirmation_guard_trigger
  ON batch_applicability_confirmation;
CREATE TRIGGER batch_applicability_confirmation_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON batch_applicability_confirmation
  FOR EACH ROW EXECUTE FUNCTION batch_applicability_confirmation_guard();

ALTER TABLE batch_applicability_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_applicability_confirmation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batch_applicability_run_authenticated_select
  ON batch_applicability_run;
CREATE POLICY batch_applicability_run_authenticated_select
  ON batch_applicability_run FOR SELECT TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          batch_applicability_run.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        batch_applicability_run.work_item_id
        AND owned_work_item.tenant_id = batch_applicability_run.tenant_id
        AND owned_work_item.requested_by_user_id =
          batch_applicability_run.actor_id
    )
  );

DROP POLICY IF EXISTS batch_applicability_run_authenticated_insert
  ON batch_applicability_run;
CREATE POLICY batch_applicability_run_authenticated_insert
  ON batch_applicability_run FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          batch_applicability_run.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        batch_applicability_run.work_item_id
        AND owned_work_item.tenant_id = batch_applicability_run.tenant_id
        AND owned_work_item.requested_by_user_id =
          batch_applicability_run.actor_id
        AND owned_work_item.revision =
          batch_applicability_run.work_item_revision
        AND owned_work_item.document_version_id =
          batch_applicability_run.document_version_id
    )
  );

DROP POLICY IF EXISTS batch_applicability_confirmation_authenticated_select
  ON batch_applicability_confirmation;
CREATE POLICY batch_applicability_confirmation_authenticated_select
  ON batch_applicability_confirmation FOR SELECT TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          batch_applicability_confirmation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        batch_applicability_confirmation.work_item_id
        AND owned_work_item.tenant_id =
          batch_applicability_confirmation.tenant_id
        AND owned_work_item.requested_by_user_id =
          batch_applicability_confirmation.actor_id
    )
  );

DROP POLICY IF EXISTS batch_applicability_confirmation_authenticated_insert
  ON batch_applicability_confirmation;
CREATE POLICY batch_applicability_confirmation_authenticated_insert
  ON batch_applicability_confirmation FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          batch_applicability_confirmation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        batch_applicability_confirmation.work_item_id
        AND owned_work_item.tenant_id =
          batch_applicability_confirmation.tenant_id
        AND owned_work_item.requested_by_user_id =
          batch_applicability_confirmation.actor_id
        AND owned_work_item.revision =
          batch_applicability_confirmation.work_item_revision
    )
    AND EXISTS (
      SELECT 1
      FROM batch_applicability_run run
      WHERE run.run_id = batch_applicability_confirmation.run_id
        AND run.tenant_id = batch_applicability_confirmation.tenant_id
        AND run.actor_id = batch_applicability_confirmation.actor_id
        AND run.work_item_id =
          batch_applicability_confirmation.work_item_id
        AND run.work_item_revision =
          batch_applicability_confirmation.work_item_revision
    )
  );

COMMIT;

-- Required post-apply readback:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename IN (
--   'batch_applicability_run',
--   'batch_applicability_confirmation'
-- ) ORDER BY tablename, indexname;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid IN (
--   'batch_applicability_run'::regclass,
--   'batch_applicability_confirmation'::regclass
-- ) ORDER BY conrelid::regclass::text, conname;
-- SELECT tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename IN (
--   'batch_applicability_run',
--   'batch_applicability_confirmation'
-- ) ORDER BY tablename, policyname;
