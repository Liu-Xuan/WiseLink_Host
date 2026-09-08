-- R10 Hosted Matter Review uses the existing platform service_role with the
-- Host-resolved actor bound through the official per-query SQL context.
-- Browser policies, role membership, grants and RLS settings remain unchanged.
BEGIN;

CREATE POLICY engineering_matter_hosted_actor_select
ON engineering_matter FOR SELECT TO service_role
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(tenant_id, current_matter_revision_id)
);

-- The existing CAS implementation locks this parent row before appending a
-- working revision. USING permits that SELECT FOR UPDATE; WITH CHECK false
-- forbids actual parent updates by the Hosted runtime.
CREATE POLICY engineering_matter_hosted_actor_lock
ON engineering_matter FOR UPDATE TO service_role
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(tenant_id, current_matter_revision_id)
)
WITH CHECK (false);

CREATE POLICY engineering_matter_revision_hosted_actor_select
ON engineering_matter_revision FOR SELECT TO service_role
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_revision_owned_by_actor(tenant_id, matter_id, matter_revision_id)
  AND engineering_matter_all_links_owned_by_actor(tenant_id, matter_revision_id)
);

CREATE POLICY engineering_matter_link_hosted_actor_select
ON engineering_matter_revision_work_item FOR SELECT TO service_role
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_revision_owned_by_actor(tenant_id, matter_id, matter_revision_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);

CREATE POLICY engineering_matter_work_revision_hosted_actor_select
ON engineering_matter_work_revision FOR SELECT TO service_role
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(tenant_id, based_on_matter_revision_id)
);

CREATE POLICY engineering_matter_work_revision_hosted_candidate_insert
ON engineering_matter_work_revision FOR INSERT TO service_role
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_owned_by_actor(tenant_id, matter_id)
  AND engineering_matter_all_links_owned_by_actor(tenant_id, based_on_matter_revision_id)
  AND EXISTS (
    SELECT 1 FROM action_attempt AS bound_attempt
    JOIN review_turn AS bound_turn
      ON bound_turn.review_turn_id = engineering_matter_work_revision.review_turn_id
      AND bound_turn.tenant_id = bound_attempt.tenant_id
      AND bound_turn.actor_id = bound_attempt.actor_user_id
      AND bound_turn.work_item_id = bound_attempt.work_item_id
      AND bound_turn.input_revision = bound_attempt.input_revision
      -- The working revision is appended before the candidate updates the
      -- turn's action_attempt_id, within the same Host transaction. Bind the
      -- attempt by its existing exact Turn idempotency key at this point.
      AND bound_attempt.idempotency_key = concat(
        'openclaw-v1:review:', bound_turn.review_conversation_id,
        ':', bound_turn.review_turn_id, ':', bound_turn.input_revision
      )
      AND (
        bound_turn.action_attempt_id IS NULL
        OR bound_turn.action_attempt_id = bound_attempt.attempt_id
      )
    WHERE bound_attempt.attempt_id = engineering_matter_work_revision.action_attempt_id
      AND bound_attempt.tenant_id = engineering_matter_work_revision.tenant_id
      AND bound_attempt.actor_user_id = engineering_matter_work_revision.created_by_user_id
      AND bound_attempt.action_type = 'OPENCLAW_INTERACTIVE_REVIEW'
      AND bound_attempt.request_origin = 'OPENCLAW_MCP_V1'
      AND bound_attempt.status = 'COMMITTING'
      AND bound_turn.review_scope_json ->> 'kind' = 'ENGINEERING_MATTER'
      AND bound_turn.review_scope_json ->> 'matterId' = engineering_matter_work_revision.matter_id
      AND bound_turn.review_scope_json ->> 'basedOnMatterRevisionId' = engineering_matter_work_revision.based_on_matter_revision_id
  )
);

COMMIT;
