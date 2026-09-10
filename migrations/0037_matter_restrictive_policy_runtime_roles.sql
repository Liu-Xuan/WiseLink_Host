-- Miaoda maps PUBLIC to authenticated only and does not apply ALTER POLICY.
-- Recreate both restrictive policies atomically with explicit runtime roles.
BEGIN;
DROP POLICY action_attempt_matter_subject_boundary ON action_attempt;
CREATE POLICY action_attempt_matter_subject_boundary ON action_attempt
  AS RESTRICTIVE FOR ALL TO authenticated, service_role
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
DROP POLICY engineering_matter_work_real_attempt_boundary ON engineering_matter_work_revision;
CREATE POLICY engineering_matter_work_real_attempt_boundary
  ON engineering_matter_work_revision AS RESTRICTIVE FOR INSERT TO authenticated, service_role
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
COMMIT;
