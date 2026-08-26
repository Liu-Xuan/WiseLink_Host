-- WiseLink V1.0 R09 C1 Review persistence.
--
-- Scope is deliberately narrow: durable text-only ReviewConversation turns
-- and unadopted engineer input. This migration does not create an OpenClaw
-- invocation path and does not change WorkItem revision/current projections.

BEGIN;

CREATE TABLE IF NOT EXISTS review_conversation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_conversation_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  actor_id varchar(255) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  openclaw_agent_id varchar(96) NOT NULL,
  openclaw_session_key varchar(1024) NOT NULL,
  started_at_revision integer NOT NULL,
  last_synced_revision integer NOT NULL,
  last_turn_no integer NOT NULL DEFAULT 0,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_active_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at timestamptz(3),
  CONSTRAINT uk_review_conversation_business_id
    UNIQUE (review_conversation_id),
  CONSTRAINT uk_review_conversation_openclaw_session
    UNIQUE (openclaw_session_key),
  CONSTRAINT fk_review_conversation_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_review_conversation_agent
    CHECK (openclaw_agent_id = 'wiselink-engineering'),
  CONSTRAINT ck_review_conversation_revisions
    CHECK (
      started_at_revision >= 0
      AND last_synced_revision >= started_at_revision
    ),
  CONSTRAINT ck_review_conversation_last_turn
    CHECK (last_turn_no >= 0),
  CONSTRAINT ck_review_conversation_status
    CHECK (status IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT ck_review_conversation_closed_state
    CHECK (
      (status = 'ACTIVE' AND closed_at IS NULL)
      OR (status = 'CLOSED' AND closed_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_review_conversation_live
  ON review_conversation(tenant_id, actor_id, work_item_id)
  WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_review_conversation_work_item
  ON review_conversation(work_item_id, status, last_active_at);
CREATE INDEX IF NOT EXISTS idx_review_conversation_actor
  ON review_conversation(tenant_id, actor_id, status, last_active_at);

CREATE TABLE IF NOT EXISTS review_turn (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_turn_id varchar(96) NOT NULL,
  review_conversation_id varchar(96) NOT NULL,
  engineer_supplied_input_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  actor_id varchar(255) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  turn_no integer NOT NULL,
  request_id varchar(96) NOT NULL,
  input_revision integer NOT NULL,
  user_message text NOT NULL,
  input_type varchar(32) NOT NULL,
  adoption_status varchar(32) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_review_turn_business_id UNIQUE (review_turn_id),
  CONSTRAINT uk_review_turn_engineer_input
    UNIQUE (engineer_supplied_input_id),
  CONSTRAINT uk_review_turn_request
    UNIQUE (review_conversation_id, request_id),
  CONSTRAINT uk_review_turn_number
    UNIQUE (review_conversation_id, turn_no),
  CONSTRAINT fk_review_turn_conversation
    FOREIGN KEY (review_conversation_id)
    REFERENCES review_conversation(review_conversation_id),
  CONSTRAINT fk_review_turn_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_review_turn_number CHECK (turn_no > 0),
  CONSTRAINT ck_review_turn_revision CHECK (input_revision >= 0),
  CONSTRAINT ck_review_turn_request CHECK (length(btrim(request_id)) > 0),
  CONSTRAINT ck_review_turn_message CHECK (length(btrim(user_message)) > 0),
  CONSTRAINT ck_review_turn_input_type
    CHECK (input_type = 'ENGINEER_TEXT'),
  CONSTRAINT ck_review_turn_adoption_status
    CHECK (adoption_status = 'CANDIDATE_UNADOPTED')
);

CREATE INDEX IF NOT EXISTS idx_review_turn_conversation
  ON review_turn(review_conversation_id, turn_no);
CREATE INDEX IF NOT EXISTS idx_review_turn_work_item
  ON review_turn(work_item_id, created_at);

CREATE TABLE IF NOT EXISTS engineer_supplied_input (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engineer_supplied_input_id varchar(96) NOT NULL,
  review_conversation_id varchar(96) NOT NULL,
  review_turn_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  actor_id varchar(255) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  request_id varchar(96) NOT NULL,
  input_revision integer NOT NULL,
  input_type varchar(32) NOT NULL,
  adoption_status varchar(32) NOT NULL,
  candidate_text text NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_engineer_supplied_input_business_id
    UNIQUE (engineer_supplied_input_id),
  CONSTRAINT uk_engineer_supplied_input_turn UNIQUE (review_turn_id),
  CONSTRAINT uk_engineer_supplied_input_request
    UNIQUE (review_conversation_id, request_id),
  CONSTRAINT fk_engineer_supplied_input_conversation
    FOREIGN KEY (review_conversation_id)
    REFERENCES review_conversation(review_conversation_id),
  CONSTRAINT fk_engineer_supplied_input_turn
    FOREIGN KEY (review_turn_id) REFERENCES review_turn(review_turn_id),
  CONSTRAINT fk_engineer_supplied_input_work_item
    FOREIGN KEY (work_item_id) REFERENCES work_item(work_item_id),
  CONSTRAINT ck_engineer_supplied_input_revision
    CHECK (input_revision >= 0),
  CONSTRAINT ck_engineer_supplied_input_type
    CHECK (input_type = 'ENGINEER_TEXT'),
  CONSTRAINT ck_engineer_supplied_input_adoption_status
    CHECK (adoption_status = 'CANDIDATE_UNADOPTED'),
  CONSTRAINT ck_engineer_supplied_input_text
    CHECK (length(btrim(candidate_text)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_engineer_supplied_input_conversation
  ON engineer_supplied_input(review_conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_engineer_supplied_input_work_item
  ON engineer_supplied_input(work_item_id, created_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'review_turn'::regclass
      AND conname = 'fk_review_turn_engineer_input'
  ) THEN
    ALTER TABLE review_turn
      ADD CONSTRAINT fk_review_turn_engineer_input
      FOREIGN KEY (engineer_supplied_input_id)
      REFERENCES engineer_supplied_input(engineer_supplied_input_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION review_turn_c1_allocate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE review_conversation
  SET
    last_turn_no = last_turn_no + 1,
    last_synced_revision = NEW.input_revision,
    last_active_at = NEW.created_at
  WHERE review_conversation_id = NEW.review_conversation_id
    AND tenant_id = NEW.tenant_id
    AND actor_id = NEW.actor_id
    AND work_item_id = NEW.work_item_id
    AND status = 'ACTIVE'
  RETURNING last_turn_no INTO NEW.turn_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_CONVERSATION_CLOSED_OR_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION review_conversation_c1_guard_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.review_conversation_id IS DISTINCT FROM OLD.review_conversation_id
    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
    OR NEW.work_item_id IS DISTINCT FROM OLD.work_item_id
    OR NEW.openclaw_agent_id IS DISTINCT FROM OLD.openclaw_agent_id
    OR NEW.openclaw_session_key IS DISTINCT FROM OLD.openclaw_session_key
    OR NEW.started_at_revision IS DISTINCT FROM OLD.started_at_revision
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_CONVERSATION_IMMUTABLE_BINDING';
  END IF;

  IF OLD.status = 'CLOSED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_CONVERSATION_CLOSED';
  END IF;
  IF NEW.status NOT IN (OLD.status, 'CLOSED') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_CONVERSATION_STATUS_TRANSITION_INVALID';
  END IF;
  IF NEW.last_synced_revision < OLD.last_synced_revision THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_CONVERSATION_REVISION_REGRESSION';
  END IF;
  IF NEW.last_turn_no <> OLD.last_turn_no THEN
    IF NEW.last_turn_no <> OLD.last_turn_no + 1
      OR pg_trigger_depth() < 2
    THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'REVIEW_CONVERSATION_TURN_COUNTER_DIRECT_WRITE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION review_turn_c1_persist_engineer_input()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO engineer_supplied_input (
    engineer_supplied_input_id,
    review_conversation_id,
    review_turn_id,
    tenant_id,
    actor_id,
    work_item_id,
    request_id,
    input_revision,
    input_type,
    adoption_status,
    candidate_text,
    created_at
  ) VALUES (
    NEW.engineer_supplied_input_id,
    NEW.review_conversation_id,
    NEW.review_turn_id,
    NEW.tenant_id,
    NEW.actor_id,
    NEW.work_item_id,
    NEW.request_id,
    NEW.input_revision,
    NEW.input_type,
    NEW.adoption_status,
    NEW.user_message,
    NEW.created_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS review_turn_c1_allocate_trigger ON review_turn;
CREATE TRIGGER review_turn_c1_allocate_trigger
  BEFORE INSERT ON review_turn
  FOR EACH ROW EXECUTE FUNCTION review_turn_c1_allocate();

DROP TRIGGER IF EXISTS review_turn_c1_engineer_input_trigger ON review_turn;
CREATE TRIGGER review_turn_c1_engineer_input_trigger
  AFTER INSERT ON review_turn
  FOR EACH ROW EXECUTE FUNCTION review_turn_c1_persist_engineer_input();

DROP TRIGGER IF EXISTS review_conversation_c1_guard_update_trigger
  ON review_conversation;
CREATE TRIGGER review_conversation_c1_guard_update_trigger
  BEFORE UPDATE ON review_conversation
  FOR EACH ROW EXECUTE FUNCTION review_conversation_c1_guard_update();

ALTER TABLE review_conversation ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_turn ENABLE ROW LEVEL SECURITY;
ALTER TABLE engineer_supplied_input ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_conversation_service_role
  ON review_conversation;
DROP POLICY IF EXISTS review_conversation_authenticated_actor
  ON review_conversation;
DROP POLICY IF EXISTS review_conversation_authenticated_select
  ON review_conversation;
CREATE POLICY review_conversation_authenticated_select
  ON review_conversation FOR SELECT TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          review_conversation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_conversation.work_item_id
        AND owned_work_item.tenant_id = review_conversation.tenant_id
        AND owned_work_item.requested_by_user_id = review_conversation.actor_id
    )
  );
DROP POLICY IF EXISTS review_conversation_authenticated_insert
  ON review_conversation;
CREATE POLICY review_conversation_authenticated_insert
  ON review_conversation FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          review_conversation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_conversation.work_item_id
        AND owned_work_item.tenant_id = review_conversation.tenant_id
        AND owned_work_item.requested_by_user_id = review_conversation.actor_id
    )
  );
DROP POLICY IF EXISTS review_conversation_authenticated_update
  ON review_conversation;
CREATE POLICY review_conversation_authenticated_update
  ON review_conversation FOR UPDATE TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          review_conversation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_conversation.work_item_id
        AND owned_work_item.tenant_id = review_conversation.tenant_id
        AND owned_work_item.requested_by_user_id = review_conversation.actor_id
    )
  )
  WITH CHECK (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          review_conversation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_conversation.work_item_id
        AND owned_work_item.tenant_id = review_conversation.tenant_id
        AND owned_work_item.requested_by_user_id = review_conversation.actor_id
    )
  );

DROP POLICY IF EXISTS review_turn_service_role ON review_turn;
DROP POLICY IF EXISTS review_turn_authenticated_actor ON review_turn;
DROP POLICY IF EXISTS review_turn_authenticated_select ON review_turn;
CREATE POLICY review_turn_authenticated_select
  ON review_turn FOR SELECT TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id = review_turn.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_turn.work_item_id
        AND owned_work_item.tenant_id = review_turn.tenant_id
        AND owned_work_item.requested_by_user_id = review_turn.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        review_turn.review_conversation_id
        AND bound_conversation.tenant_id = review_turn.tenant_id
        AND bound_conversation.actor_id = review_turn.actor_id
        AND bound_conversation.work_item_id = review_turn.work_item_id
    )
  );
DROP POLICY IF EXISTS review_turn_authenticated_insert ON review_turn;
CREATE POLICY review_turn_authenticated_insert
  ON review_turn FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id = review_turn.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_turn.work_item_id
        AND owned_work_item.tenant_id = review_turn.tenant_id
        AND owned_work_item.requested_by_user_id = review_turn.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        review_turn.review_conversation_id
        AND bound_conversation.tenant_id = review_turn.tenant_id
        AND bound_conversation.actor_id = review_turn.actor_id
        AND bound_conversation.work_item_id = review_turn.work_item_id
    )
  );

DROP POLICY IF EXISTS engineer_supplied_input_service_role
  ON engineer_supplied_input;
DROP POLICY IF EXISTS engineer_supplied_input_authenticated_actor
  ON engineer_supplied_input;
DROP POLICY IF EXISTS engineer_supplied_input_authenticated_select
  ON engineer_supplied_input;
CREATE POLICY engineer_supplied_input_authenticated_select
  ON engineer_supplied_input FOR SELECT TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          engineer_supplied_input.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        engineer_supplied_input.work_item_id
        AND owned_work_item.tenant_id = engineer_supplied_input.tenant_id
        AND owned_work_item.requested_by_user_id =
          engineer_supplied_input.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        engineer_supplied_input.review_conversation_id
        AND bound_conversation.tenant_id = engineer_supplied_input.tenant_id
        AND bound_conversation.actor_id = engineer_supplied_input.actor_id
        AND bound_conversation.work_item_id =
          engineer_supplied_input.work_item_id
    )
  );
DROP POLICY IF EXISTS engineer_supplied_input_authenticated_insert
  ON engineer_supplied_input;
CREATE POLICY engineer_supplied_input_authenticated_insert
  ON engineer_supplied_input FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          engineer_supplied_input.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        engineer_supplied_input.work_item_id
        AND owned_work_item.tenant_id = engineer_supplied_input.tenant_id
        AND owned_work_item.requested_by_user_id =
          engineer_supplied_input.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        engineer_supplied_input.review_conversation_id
        AND bound_conversation.tenant_id = engineer_supplied_input.tenant_id
        AND bound_conversation.actor_id = engineer_supplied_input.actor_id
        AND bound_conversation.work_item_id =
          engineer_supplied_input.work_item_id
    )
  );

COMMIT;

-- Required post-apply readback:
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename IN (
--   'review_conversation', 'review_turn', 'engineer_supplied_input'
-- ) ORDER BY tablename, indexname;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid IN (
--   'review_conversation'::regclass,
--   'review_turn'::regclass,
--   'engineer_supplied_input'::regclass
-- ) ORDER BY conrelid::regclass::text, conname;
