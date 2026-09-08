-- WiseLink R10 W2 Host-owned Engineering Matter working state.
--
-- Work revisions are independent of Matter membership revisions and remain
-- candidate-only. They retain exact member/result bindings without copying
-- WorkItem projections, document bytes, SourceRefs, or formal adoption state.

BEGIN;

ALTER TABLE review_turn
  ADD COLUMN IF NOT EXISTS review_scope_json jsonb;

COMMENT ON COLUMN review_turn.review_scope_json IS
  'Nullable Host-validated Review business scope; legacy null rows remain WorkItem-scoped.';

CREATE OR REPLACE FUNCTION review_turn_r10_guard_scope_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.review_scope_json IS DISTINCT FROM OLD.review_scope_json THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'REVIEW_TURN_R10_SCOPE_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS review_turn_r10_guard_scope_immutable_trigger
  ON review_turn;
CREATE TRIGGER review_turn_r10_guard_scope_immutable_trigger
  BEFORE UPDATE ON review_turn
  FOR EACH ROW EXECUTE FUNCTION review_turn_r10_guard_scope_immutable();

CREATE TABLE IF NOT EXISTS engineering_matter_work_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_work_revision_id varchar(96) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  matter_id varchar(96) NOT NULL,
  working_revision integer NOT NULL,
  request_id varchar(96) NOT NULL,
  based_on_matter_revision_id varchar(96) NOT NULL,
  update_kind varchar(32) NOT NULL,
  command_json text NOT NULL,
  state_json text NOT NULL,
  substantive_result_ref text,
  substantive_result_revision integer,
  change_summary text NOT NULL,
  action_attempt_id varchar(96),
  review_turn_id varchar(96),
  created_by_user_id varchar(255) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_engineering_matter_work_revision_business_id
    UNIQUE (matter_work_revision_id),
  CONSTRAINT uk_engineering_matter_work_revision_scope
    UNIQUE (tenant_id, matter_id, matter_work_revision_id),
  CONSTRAINT uk_engineering_matter_work_revision_number
    UNIQUE (matter_id, working_revision),
  CONSTRAINT uk_engineering_matter_work_revision_request
    UNIQUE (matter_id, request_id),
  CONSTRAINT fk_engineering_matter_work_revision_matter
    FOREIGN KEY (tenant_id, matter_id)
    REFERENCES engineering_matter(tenant_id, matter_id),
  CONSTRAINT fk_engineering_matter_work_revision_basis
    FOREIGN KEY (tenant_id, matter_id, based_on_matter_revision_id)
    REFERENCES engineering_matter_revision(
      tenant_id,
      matter_id,
      matter_revision_id
    ),
  CONSTRAINT fk_engineering_matter_work_revision_attempt
    FOREIGN KEY (action_attempt_id) REFERENCES action_attempt(attempt_id),
  CONSTRAINT fk_engineering_matter_work_revision_turn
    FOREIGN KEY (review_turn_id) REFERENCES review_turn(review_turn_id),
  CONSTRAINT ck_engineering_matter_work_revision_number
    CHECK (working_revision > 0),
  CONSTRAINT ck_engineering_matter_work_revision_kind
    CHECK (
      update_kind IN (
        'INITIAL_SYNTHESIS',
        'CORRECTION',
        'MATERIAL_INCORPORATION'
      )
    ),
  CONSTRAINT ck_engineering_matter_work_revision_command
    CHECK (length(btrim(command_json)) > 0),
  CONSTRAINT ck_engineering_matter_work_revision_state
    CHECK (length(btrim(state_json)) > 0),
  CONSTRAINT ck_engineering_matter_work_revision_result
    CHECK (
      (substantive_result_ref IS NULL AND substantive_result_revision IS NULL)
      OR (
        substantive_result_ref IS NOT NULL
        AND length(btrim(substantive_result_ref)) > 0
        AND substantive_result_revision > 0
      )
    ),
  CONSTRAINT ck_engineering_matter_work_revision_summary
    CHECK (length(btrim(change_summary)) BETWEEN 1 AND 1000),
  CONSTRAINT ck_engineering_matter_work_revision_source
    CHECK (
      (action_attempt_id IS NULL AND review_turn_id IS NULL)
      OR (action_attempt_id IS NOT NULL AND review_turn_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_engineering_matter_work_revision_attempt
  ON engineering_matter_work_revision(action_attempt_id)
  WHERE action_attempt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uk_engineering_matter_work_revision_turn
  ON engineering_matter_work_revision(review_turn_id)
  WHERE review_turn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_engineering_matter_work_revision_history
  ON engineering_matter_work_revision(matter_id, working_revision DESC);

ALTER TABLE engineering_matter_work_revision ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS engineering_matter_work_revision_authenticated_select
  ON engineering_matter_work_revision;
CREATE POLICY engineering_matter_work_revision_authenticated_select
ON engineering_matter_work_revision FOR SELECT TO authenticated
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(
    tenant_id,
    based_on_matter_revision_id
  )
);

DROP POLICY IF EXISTS engineering_matter_work_revision_authenticated_insert
  ON engineering_matter_work_revision;
CREATE POLICY engineering_matter_work_revision_authenticated_insert
ON engineering_matter_work_revision FOR INSERT TO authenticated
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(
    tenant_id,
    based_on_matter_revision_id
  )
);

COMMENT ON TABLE engineering_matter_work_revision IS
  'Immutable Matter candidate working revisions; membership and member currents remain owned by their existing aggregates.';
COMMENT ON COLUMN engineering_matter_work_revision.command_json IS
  'Canonical Host-validated command used for exact idempotent replay.';
COMMENT ON COLUMN engineering_matter_work_revision.state_json IS
  'Fully materialized short working state after stable-claim local patching.';

COMMIT;
