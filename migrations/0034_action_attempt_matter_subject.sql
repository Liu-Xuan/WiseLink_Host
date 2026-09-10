-- Matter execution shares the durable ActionAttempt queue. A Matter never
-- borrows a member WorkItem as its execution identity or CAS owner.
BEGIN;

ALTER TABLE action_attempt
  ALTER COLUMN work_item_id DROP NOT NULL,
  ADD COLUMN subject_kind varchar(32) NOT NULL DEFAULT 'WORK_ITEM',
  ADD COLUMN matter_id varchar(96),
  ADD COLUMN matter_revision_id varchar(96);

ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK (
  (subject_kind = 'WORK_ITEM' AND work_item_id IS NOT NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL
    AND action_type <> 'OPENCLAW_MATTER_ASSESSMENT')
  OR
  (subject_kind = 'ENGINEERING_MATTER' AND work_item_id IS NULL
    AND document_version_id IS NULL AND matter_id IS NOT NULL
    AND matter_revision_id IS NOT NULL
    AND action_type = 'OPENCLAW_MATTER_ASSESSMENT'
    AND input_revision IS NOT NULL AND base_revision IS NOT NULL)
);
ALTER TABLE action_attempt ADD CONSTRAINT fk_action_attempt_matter_basis
  FOREIGN KEY (tenant_id, matter_id, matter_revision_id)
  REFERENCES engineering_matter_revision(tenant_id, matter_id, matter_revision_id);

CREATE UNIQUE INDEX uk_action_attempt_matter_number
  ON action_attempt(tenant_id, matter_id, action_type, attempt_no)
  WHERE subject_kind = 'ENGINEERING_MATTER';
CREATE UNIQUE INDEX uk_action_attempt_active_matter_task
  ON action_attempt(tenant_id, matter_id, action_type)
  WHERE subject_kind = 'ENGINEERING_MATTER'
    AND status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING');

-- Identity cannot be switched to the legacy branch to escape its policy.
-- The composition captured for an in-flight attempt stays frozen; later
-- composition changes create a successor after this attempt terminates.
CREATE FUNCTION action_attempt_preserve_matter_subject() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.subject_kind = 'ENGINEERING_MATTER' OR NEW.subject_kind = 'ENGINEERING_MATTER')
    AND ROW(OLD.subject_kind, OLD.tenant_id, OLD.actor_user_id, OLD.work_item_id,
      OLD.matter_id, OLD.matter_revision_id, OLD.action_type)
      IS DISTINCT FROM ROW(NEW.subject_kind, NEW.tenant_id, NEW.actor_user_id, NEW.work_item_id,
        NEW.matter_id, NEW.matter_revision_id, NEW.action_type) THEN
    RAISE EXCEPTION 'ACTION_ATTEMPT_SUBJECT_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER action_attempt_preserve_matter_subject
  BEFORE UPDATE ON action_attempt FOR EACH ROW
  EXECUTE FUNCTION action_attempt_preserve_matter_subject();

-- Existing WorkItem policies are preserved. A restrictive policy prevents
-- existing broad permissive policies from exposing the new subject branch.
ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
CREATE POLICY action_attempt_matter_subject_boundary ON action_attempt
  AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (
    subject_kind = 'WORK_ITEM' OR (
      actor_user_id = current_setting('app.user_id', true)
      AND engineering_matter_actor_has_tenant(tenant_id)
      AND engineering_matter_owned_by_actor(tenant_id, matter_id)
      AND engineering_matter_all_links_owned_by_actor(tenant_id, matter_revision_id)
      AND EXISTS (
        SELECT 1 FROM engineering_matter m
        WHERE m.tenant_id = action_attempt.tenant_id
          AND m.matter_id = action_attempt.matter_id
          AND engineering_matter_all_links_owned_by_actor(m.tenant_id, m.current_matter_revision_id)
      )
    )
  );

COMMIT;
