-- JobAid SAVE_WORK persists candidate work during the lease; FINISH names
-- the exact saved revision. ReviewTurn candidates retain their old uniqueness.
BEGIN;
DROP INDEX uk_engineering_matter_work_revision_attempt;
CREATE UNIQUE INDEX uk_engineering_matter_work_revision_attempt
  ON engineering_matter_work_revision(action_attempt_id)
  WHERE action_attempt_id IS NOT NULL AND review_turn_id IS NOT NULL;

CREATE OR REPLACE FUNCTION engineering_matter_attempt_can_save_work(
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
      AND a.action_type = 'OPENCLAW_MATTER_ASSESSMENT'
      AND a.request_origin = 'OPENCLAW_MCP_V1'
      AND (
        (a.status = 'RUNNING' AND a.lease_token IS NOT NULL
          AND a.lease_expires_at > now() AND a.deadline_at > now()
          AND a.cancel_requested_at IS NULL AND a.commit_started_at IS NULL
          AND a.result_envelope_json IS NULL
          AND target_working_revision > a.base_revision
          AND length(btrim(target_request_id)) > 0)
        OR
        (a.status = 'COMMITTING' AND a.commit_started_at IS NOT NULL
          AND a.result_content_hash IS NOT NULL
          AND a.result_envelope_json::jsonb ->> 'schemaVersion' = 'wiselink.3_1.openclaw_result_envelope.v2'
          AND a.result_envelope_json::jsonb ->> 'status' = 'SUCCEEDED'
          AND a.base_revision + 1 = target_working_revision
          AND a.trigger_request_id = target_request_id)
      )
  );
$$;
COMMIT;
