-- WiseLink V1.0 R09 OpenClaw Review candidate persistence under the
-- authenticated owner context established by the Host.
--
-- Public OpenAPI requests arrive without an end-user app.user_id. The Host
-- first authorizes its exact configured WorkItem, derives requested_by_user_id
-- from that WorkItem, and sets that actor only for the current DB transaction.
-- This policy does not grant the public (-1) actor or service_role access.
-- The existing review_turn_c2_guard_update trigger remains the final binding,
-- currentness, COMMITTING ActionAttempt and result-content fence.

BEGIN;

DROP POLICY IF EXISTS review_turn_authenticated_candidate_update
  ON review_turn;
CREATE POLICY review_turn_authenticated_candidate_update
  ON review_turn FOR UPDATE TO authenticated
  USING (
    actor_id = current_setting('app.user_id', true)
    AND current_setting('app.user_id', true) NOT IN ('', '-1')
    AND assistant_response IS NULL
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
    actor_id = current_setting('app.user_id', true)
    AND current_setting('app.user_id', true) NOT IN ('', '-1')
    AND assistant_response IS NOT NULL
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

COMMIT;

