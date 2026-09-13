BEGIN;
-- Hosted does not apply ALTER POLICY from 0048. Recreate its intended predicate
-- with explicit runtime roles; the independent document boundary remains in force.
DROP POLICY action_attempt_matter_subject_boundary ON action_attempt;
CREATE POLICY action_attempt_matter_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated, service_role
USING (
  subject_kind IN ('WORK_ITEM', 'DOCUMENT_VERSION') OR (
    actor_user_id = current_setting('app.user_id', true)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, matter_revision_id)
    AND EXISTS (SELECT 1 FROM engineering_matter m WHERE m.tenant_id = action_attempt.tenant_id
      AND m.matter_id = action_attempt.matter_id
      AND engineering_matter_all_links_owned_by_actor(m.tenant_id, m.current_matter_revision_id))
  )
);
COMMIT;
