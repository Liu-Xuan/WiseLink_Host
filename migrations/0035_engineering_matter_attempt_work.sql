-- Persist Matter candidates against their real attempt, without a fake turn.
BEGIN;
ALTER TABLE engineering_matter_work_revision
  DROP CONSTRAINT ck_engineering_matter_work_revision_source;
ALTER TABLE engineering_matter_work_revision
  ADD CONSTRAINT ck_engineering_matter_work_revision_source
  CHECK (review_turn_id IS NULL OR action_attempt_id IS NOT NULL);

CREATE FUNCTION engineering_matter_attempt_can_save_work(
  target_attempt_id varchar, target_tenant_id varchar, target_actor_id varchar,
  target_matter_id varchar, target_revision_id varchar,
  target_working_revision integer, target_request_id varchar
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM action_attempt a
    WHERE a.attempt_id = target_attempt_id
      AND a.tenant_id = target_tenant_id
      AND a.actor_user_id = target_actor_id
      AND a.actor_user_id = current_setting('app.user_id', true)
      AND a.subject_kind = 'ENGINEERING_MATTER'
      AND a.matter_id = target_matter_id
      AND a.matter_revision_id = target_revision_id
      AND a.base_revision + 1 = target_working_revision
      AND a.trigger_request_id = target_request_id
      AND a.action_type = 'OPENCLAW_MATTER_ASSESSMENT'
      AND a.request_origin = 'OPENCLAW_MCP_V1'
      AND a.status = 'COMMITTING'
      AND a.commit_started_at IS NOT NULL
      AND a.result_content_hash IS NOT NULL
      AND a.result_envelope_json::jsonb ->> 'schemaVersion' = 'wiselink.3_1.openclaw_result_envelope.v2'
      AND a.result_envelope_json::jsonb ->> 'status' = 'SUCCEEDED'
  );
$$;

-- Restrict native inserts too: their existing broad insert policy must not
-- permit a fabricated Matter attempt binding. Legacy/native corrections and
-- real ReviewTurn candidates keep their existing authorization paths.
CREATE POLICY engineering_matter_work_real_attempt_boundary
  ON engineering_matter_work_revision AS RESTRICTIVE FOR INSERT TO PUBLIC
  WITH CHECK (
    action_attempt_id IS NULL
    OR (review_turn_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM action_attempt a
      WHERE a.attempt_id = engineering_matter_work_revision.action_attempt_id
        AND a.subject_kind = 'WORK_ITEM'
    ))
    OR (review_turn_id IS NULL AND engineering_matter_attempt_can_save_work(action_attempt_id, tenant_id,
      created_by_user_id, matter_id, based_on_matter_revision_id,
      working_revision, request_id))
  );

CREATE POLICY engineering_matter_work_real_attempt_insert
  ON engineering_matter_work_revision FOR INSERT TO service_role
  WITH CHECK (
    action_attempt_id IS NOT NULL AND review_turn_id IS NULL
    AND created_by_user_id = current_setting('app.user_id', true)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, based_on_matter_revision_id)
    AND engineering_matter_attempt_can_save_work(action_attempt_id, tenant_id,
      created_by_user_id, matter_id, based_on_matter_revision_id,
      working_revision, request_id)
  );
COMMIT;
