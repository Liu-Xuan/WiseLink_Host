-- WiseLink V1.0 R09 Hosted OpenClaw Review candidate persistence.
--
-- Hosted OpenClaw requests execute through the workspace-scoped service_role.
-- The Host establishes the exact WorkItem owner as app.user_id inside the
-- same database call that persists the candidate. This policy mirrors the
-- authenticated candidate-update predicate. A SECURITY INVOKER function
-- establishes the local actor before PostgreSQL evaluates the UPDATE RLS
-- policy. Its first executable guard requires the hosted service_role; the
-- platform continues to own all database privileges.

BEGIN;

DROP POLICY IF EXISTS review_turn_hosted_runtime_actor_candidate_update
  ON review_turn;
CREATE POLICY review_turn_hosted_runtime_actor_candidate_update
  ON review_turn
  AS PERMISSIVE
  FOR UPDATE
  TO service_role
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND pg_catalog.current_setting('app.user_id', true) NOT IN ('', '-1')
    AND assistant_response IS NULL
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
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
        AND owned_work_item.revision = review_turn.input_revision
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        review_turn.review_conversation_id
        AND bound_conversation.tenant_id = review_turn.tenant_id
        AND bound_conversation.actor_id = review_turn.actor_id
        AND bound_conversation.work_item_id = review_turn.work_item_id
        AND bound_conversation.last_synced_revision =
          review_turn.input_revision
        AND bound_conversation.status = 'ACTIVE'
    )
  )
  WITH CHECK (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND pg_catalog.current_setting('app.user_id', true) NOT IN ('', '-1')
    AND assistant_response IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
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
        AND owned_work_item.revision = review_turn.input_revision
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        review_turn.review_conversation_id
        AND bound_conversation.tenant_id = review_turn.tenant_id
        AND bound_conversation.actor_id = review_turn.actor_id
        AND bound_conversation.work_item_id = review_turn.work_item_id
        AND bound_conversation.last_synced_revision =
          review_turn.input_revision
        AND bound_conversation.status = 'ACTIVE'
    )
  );

CREATE OR REPLACE FUNCTION review_turn_hosted_runtime_persist_candidate(
  p_actor_id text,
  p_review_turn_id text,
  p_review_conversation_id text,
  p_tenant_id text,
  p_work_item_id text,
  p_input_revision integer,
  p_response_type text,
  p_assistant_response text,
  p_source_refs_json text,
  p_missing_inputs_json text,
  p_candidate_evidence_refs_json text,
  p_review_action_draft_json text,
  p_affected_item_ids_json text,
  p_warnings_json text,
  p_result_provenance_json text,
  p_result_content_hash text,
  p_action_attempt_id text,
  p_assistant_completed_at timestamptz
)
RETURNS TABLE (
  candidate_inserted boolean,
  actor_context text,
  turn_row jsonb,
  input_row jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  stored_turn review_turn%ROWTYPE;
  stored_input engineer_supplied_input%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS hosted_policy
    CROSS JOIN LATERAL pg_catalog.unnest(hosted_policy.roles)
      AS hosted_role(role_name)
    LEFT JOIN pg_catalog.pg_roles AS concrete_role
      ON concrete_role.rolname = hosted_role.role_name
    WHERE hosted_policy.tablename = 'review_turn'
      AND hosted_policy.policyname =
        'review_turn_hosted_runtime_actor_candidate_update'
      AND hosted_policy.cmd = 'UPDATE'
      AND hosted_policy.permissive = 'PERMISSIVE'
      AND to_regclass(
        format(
          '%I.%I',
          hosted_policy.schemaname,
          hosted_policy.tablename
        )
      ) = to_regclass('review_turn')
      AND hosted_role.role_name <> 'public'
      AND (
        hosted_role.role_name = current_user
        OR (
          concrete_role.oid IS NOT NULL
          AND pg_catalog.pg_has_role(
            current_user,
            concrete_role.oid,
            'USAGE'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'REVIEW_HOSTED_RUNTIME_ROLE_REQUIRED';
  END IF;

  IF p_actor_id IS NULL OR btrim(p_actor_id) IN ('', '-1') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'REVIEW_OPENCLAW_ACTOR_CONTEXT_INVALID';
  END IF;

  PERFORM pg_catalog.set_config('app.user_id', p_actor_id, TRUE);

  UPDATE review_turn AS candidate_turn
  SET
    response_type = p_response_type,
    assistant_response = p_assistant_response,
    source_refs_json = p_source_refs_json,
    missing_inputs_json = p_missing_inputs_json,
    candidate_evidence_refs_json = p_candidate_evidence_refs_json,
    review_action_draft_json = p_review_action_draft_json,
    affected_item_ids_json = p_affected_item_ids_json,
    warnings_json = p_warnings_json,
    result_provenance_json = p_result_provenance_json,
    result_content_hash = p_result_content_hash,
    action_attempt_id = p_action_attempt_id,
    assistant_completed_at = p_assistant_completed_at
  WHERE candidate_turn.review_turn_id = p_review_turn_id
    AND candidate_turn.review_conversation_id = p_review_conversation_id
    AND candidate_turn.tenant_id = p_tenant_id
    AND candidate_turn.actor_id = p_actor_id
    AND candidate_turn.work_item_id = p_work_item_id
    AND candidate_turn.input_revision = p_input_revision
    AND candidate_turn.assistant_response IS NULL
  RETURNING candidate_turn.* INTO stored_turn;

  candidate_inserted := FOUND;
  IF NOT candidate_inserted THEN
    SELECT candidate_turn.*
    INTO stored_turn
    FROM review_turn AS candidate_turn
    WHERE candidate_turn.review_turn_id = p_review_turn_id
      AND candidate_turn.review_conversation_id = p_review_conversation_id
      AND candidate_turn.tenant_id = p_tenant_id
      AND candidate_turn.actor_id = p_actor_id
      AND candidate_turn.work_item_id = p_work_item_id
      AND candidate_turn.input_revision = p_input_revision
    LIMIT 1;
  END IF;

  IF stored_turn.review_turn_id IS NULL THEN
    RETURN;
  END IF;

  SELECT candidate_input.*
  INTO stored_input
  FROM engineer_supplied_input AS candidate_input
  WHERE candidate_input.engineer_supplied_input_id =
      stored_turn.engineer_supplied_input_id
    AND candidate_input.actor_id = p_actor_id
  LIMIT 1;

  IF stored_input.engineer_supplied_input_id IS NULL THEN
    RETURN;
  END IF;

  actor_context := pg_catalog.current_setting('app.user_id', TRUE);
  turn_row := pg_catalog.to_jsonb(stored_turn);
  input_row := pg_catalog.to_jsonb(stored_input);
  RETURN NEXT;
END;
$$;

COMMIT;

-- Required post-apply readback:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd,
--        qual, with_check
-- FROM pg_catalog.pg_policies
-- WHERE policyname =
--   'review_turn_hosted_runtime_actor_candidate_update';
-- SELECT p.oid::regprocedure, p.prosecdef,
--        pg_get_functiondef(p.oid)
-- FROM pg_catalog.pg_proc p
-- WHERE p.oid = to_regprocedure(
--   'review_turn_hosted_runtime_persist_candidate('
--   'text,text,text,text,text,integer,text,text,text,text,text,text,text,text,'
--   'text,text,text,timestamp with time zone)'
-- );
-- Expected: one PERMISSIVE UPDATE policy and one SECURITY INVOKER function
-- whose first executable guard requires service_role. No database privilege
-- is changed by this migration.
