-- WiseLink V1.0 R09 C2 INTERACTIVE_REVIEW candidate persistence.
--
-- This serial migration extends the accepted C1 ReviewTurn and the existing
-- Host-owned ActionAttempt. It does not create ReviewAction, mutate WorkItem
-- revision/current, mark assessment projections STALE, or add another queue.

BEGIN;

ALTER TABLE review_turn
  ADD COLUMN IF NOT EXISTS response_type varchar(48),
  ADD COLUMN IF NOT EXISTS assistant_response text,
  ADD COLUMN IF NOT EXISTS source_refs_json text,
  ADD COLUMN IF NOT EXISTS missing_inputs_json text,
  ADD COLUMN IF NOT EXISTS candidate_evidence_refs_json text,
  ADD COLUMN IF NOT EXISTS review_action_draft_json text,
  ADD COLUMN IF NOT EXISTS affected_item_ids_json text,
  ADD COLUMN IF NOT EXISTS warnings_json text,
  ADD COLUMN IF NOT EXISTS result_provenance_json text,
  ADD COLUMN IF NOT EXISTS result_content_hash varchar(64),
  ADD COLUMN IF NOT EXISTS action_attempt_id varchar(96),
  ADD COLUMN IF NOT EXISTS assistant_completed_at timestamptz(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'review_turn'::regclass
      AND conname = 'fk_review_turn_action_attempt'
  ) THEN
    ALTER TABLE review_turn
      ADD CONSTRAINT fk_review_turn_action_attempt
      FOREIGN KEY (action_attempt_id)
      REFERENCES action_attempt(attempt_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'review_turn'::regclass
      AND conname = 'uk_review_turn_action_attempt'
  ) THEN
    ALTER TABLE review_turn
      ADD CONSTRAINT uk_review_turn_action_attempt UNIQUE (action_attempt_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'review_turn'::regclass
      AND conname = 'ck_review_turn_c2_candidate_state'
  ) THEN
    ALTER TABLE review_turn
      ADD CONSTRAINT ck_review_turn_c2_candidate_state CHECK (
        (
          response_type IS NULL
          AND assistant_response IS NULL
          AND source_refs_json IS NULL
          AND missing_inputs_json IS NULL
          AND candidate_evidence_refs_json IS NULL
          AND review_action_draft_json IS NULL
          AND affected_item_ids_json IS NULL
          AND warnings_json IS NULL
          AND result_provenance_json IS NULL
          AND result_content_hash IS NULL
          AND action_attempt_id IS NULL
          AND assistant_completed_at IS NULL
        )
        OR
        (
          response_type IN (
            'ANSWER',
            'CLARIFYING_QUESTION',
            'SOURCE_LINK',
            'CANDIDATE_EVIDENCE',
            'REVIEW_ACTION_DRAFT',
            'INPUT_REQUEST',
            'AFFECTED_ITEMS_PREVIEW',
            'RESYNTHESIS_RESULT',
            'TASK_STATUS'
          )
          AND length(btrim(assistant_response)) > 0
          AND source_refs_json IS NOT NULL
          AND missing_inputs_json IS NOT NULL
          AND candidate_evidence_refs_json IS NOT NULL
          AND review_action_draft_json IS NOT NULL
          AND affected_item_ids_json IS NOT NULL
          AND warnings_json IS NOT NULL
          AND result_provenance_json IS NOT NULL
          AND result_content_hash ~ '^[0-9a-f]{64}$'
          AND length(btrim(action_attempt_id)) > 0
          AND assistant_completed_at IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION review_turn_c2_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.review_turn_id IS DISTINCT FROM OLD.review_turn_id
    OR NEW.review_conversation_id IS DISTINCT FROM OLD.review_conversation_id
    OR NEW.engineer_supplied_input_id IS DISTINCT FROM
      OLD.engineer_supplied_input_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id
    OR NEW.turn_no IS DISTINCT FROM OLD.turn_no
    OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.input_revision IS DISTINCT FROM OLD.input_revision
    OR NEW.user_message IS DISTINCT FROM OLD.user_message
    OR NEW.input_type IS DISTINCT FROM OLD.input_type
    OR NEW.adoption_status IS DISTINCT FROM OLD.adoption_status
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_TURN_C2_IMMUTABLE_INPUT';
  END IF;

  IF OLD.assistant_response IS NOT NULL THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'REVIEW_TURN_C2_CANDIDATE_APPEND_ONLY';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.assistant_response IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_TURN_C2_PARTIAL_UPDATE_REJECTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM review_conversation conversation
    JOIN work_item owned_work_item
      ON owned_work_item.work_item_id = conversation.work_item_id
    JOIN action_attempt attempt
      ON attempt.attempt_id = NEW.action_attempt_id
    WHERE conversation.review_conversation_id = NEW.review_conversation_id
      AND conversation.tenant_id = NEW.tenant_id
      AND conversation.actor_id = NEW.actor_id
      AND conversation.work_item_id = NEW.work_item_id
      AND conversation.status = 'ACTIVE'
      AND owned_work_item.tenant_id = NEW.tenant_id
      AND owned_work_item.requested_by_user_id = NEW.actor_id
      AND owned_work_item.revision = NEW.input_revision
      AND attempt.work_item_id = NEW.work_item_id
      AND attempt.tenant_id = NEW.tenant_id
      AND attempt.actor_user_id = NEW.actor_id
      AND attempt.action_type = 'OPENCLAW_INTERACTIVE_REVIEW'
      AND attempt.input_revision = NEW.input_revision
      AND attempt.base_revision = NEW.input_revision
      AND attempt.status = 'COMMITTING'
      AND attempt.result_content_hash = NEW.result_content_hash
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_TURN_C2_BINDING_OR_CURRENT_REJECTED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS review_turn_c2_guard_update_trigger ON review_turn;
CREATE TRIGGER review_turn_c2_guard_update_trigger
  BEFORE UPDATE ON review_turn
  FOR EACH ROW EXECUTE FUNCTION review_turn_c2_guard_update();

COMMIT;

-- Required post-apply readback:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename IN ('action_attempt', 'review_turn')
-- ORDER BY tablename, indexname;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'review_turn'::regclass ORDER BY conname;
