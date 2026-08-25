-- WiseLink 3.1 G2 durable OpenClaw ActionAttempt queue.
-- Additive and replay-safe. Apply only to the exact application DB branch,
-- then verify definitions with pg_indexes/pg_constraint before activation.

BEGIN;

ALTER TABLE action_attempt
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS operation_ref varchar(128),
  ADD COLUMN IF NOT EXISTS input_revision integer,
  ADD COLUMN IF NOT EXISTS base_revision integer,
  ADD COLUMN IF NOT EXISTS document_version_id varchar(96),
  ADD COLUMN IF NOT EXISTS task_envelope_json text,
  ADD COLUMN IF NOT EXISTS task_input_hash varchar(64),
  ADD COLUMN IF NOT EXISTS result_envelope_json text,
  ADD COLUMN IF NOT EXISTS result_content_hash varchar(64),
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(255),
  ADD COLUMN IF NOT EXISTS claim_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS lease_owner varchar(160),
  ADD COLUMN IF NOT EXISTS lease_token varchar(96),
  ADD COLUMN IF NOT EXISTS lease_generation integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_slot integer,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS deadline_at timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS cancel_requested_at timestamp(3) with time zone,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS terminal_reason varchar(160),
  ADD COLUMN IF NOT EXISTS projection_applied boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS executor_session_key varchar(512),
  ADD COLUMN IF NOT EXISTS commit_started_at timestamp(3) with time zone;

DROP INDEX IF EXISTS uk_action_attempt_idempotency;
DROP INDEX IF EXISTS idx_action_attempt_due_queue;
DROP INDEX IF EXISTS idx_action_attempt_lease;
DROP INDEX IF EXISTS uk_action_attempt_active_work_task;
DROP INDEX IF EXISTS uk_action_attempt_operation_ref;
DROP INDEX IF EXISTS uk_action_attempt_lease_slot;
CREATE UNIQUE INDEX IF NOT EXISTS uk_action_attempt_idempotency
  ON action_attempt(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING');

CREATE INDEX IF NOT EXISTS idx_action_attempt_due_queue
  ON action_attempt(status, next_attempt_at, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS idx_action_attempt_lease
  ON action_attempt(status, lease_expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS uk_action_attempt_active_work_task
  ON action_attempt(work_item_id, action_type)
  WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING');

CREATE UNIQUE INDEX IF NOT EXISTS uk_action_attempt_operation_ref
  ON action_attempt(operation_ref)
  WHERE operation_ref IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uk_action_attempt_lease_slot
  ON action_attempt(tenant_id, request_origin, lease_slot)
  WHERE status IN ('RUNNING', 'COMMITTING') AND lease_slot IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'action_attempt'::regclass
      AND conname = 'ck_action_attempt_priority'
  ) THEN
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_priority
      CHECK (priority >= 0 AND priority <= 1000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'action_attempt'::regclass
      AND conname = 'ck_action_attempt_input_revision'
  ) THEN
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_input_revision
      CHECK (input_revision IS NULL OR input_revision >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'action_attempt'::regclass
      AND conname = 'ck_action_attempt_base_revision'
  ) THEN
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_base_revision
      CHECK (base_revision IS NULL OR base_revision >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'action_attempt'::regclass
      AND conname = 'ck_action_attempt_retry_counts'
  ) THEN
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_retry_counts
      CHECK (
        claim_count >= 0 AND retry_count >= 0 AND max_attempts > 0
        AND retry_count < max_attempts AND lease_generation >= 0
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'action_attempt'::regclass
      AND conname = 'ck_action_attempt_lease_slot'
  ) THEN
    ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_lease_slot
      CHECK (lease_slot IS NULL OR (lease_slot >= 0 AND lease_slot < 4));
  END IF;
END $$;

COMMIT;

-- Required post-apply readback:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname = current_schema() AND tablename = 'action_attempt'
--   AND indexname IN (
--     'uk_action_attempt_idempotency', 'idx_action_attempt_due_queue',
--     'idx_action_attempt_lease', 'uk_action_attempt_active_work_task',
--     'uk_action_attempt_operation_ref', 'uk_action_attempt_lease_slot'
--   ) ORDER BY indexname;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'action_attempt'::regclass
--   AND conname LIKE 'ck_action_attempt_%' ORDER BY conname;
