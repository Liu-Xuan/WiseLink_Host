BEGIN;
-- Register a derived-work refresh in the same ordinary authorized save.
-- Referenced revisions retain their own RLS; no body write or processing grant.
CREATE POLICY engineering_search_projection_pending_work_save
ON engineering_search_projection_pending FOR INSERT TO authenticated
WITH CHECK (
  owner_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND (
    (owner_kind = 'MATTER' AND EXISTS (
      SELECT 1 FROM engineering_matter_work_revision r
      WHERE r.tenant_id = engineering_search_projection_pending.tenant_id
        AND r.matter_id = engineering_search_projection_pending.subject_id
        AND r.matter_work_revision_id = engineering_search_projection_pending.exact_revision_ref
        AND r.created_by_user_id = engineering_search_projection_pending.owner_id
    ))
    OR (owner_kind = 'USER' AND EXISTS (
      SELECT 1 FROM assessment_work_revision r
      WHERE r.tenant_id = engineering_search_projection_pending.tenant_id
        AND r.work_item_id = engineering_search_projection_pending.subject_id
        AND r.assessment_work_revision_id = engineering_search_projection_pending.exact_revision_ref
        AND r.created_by_user_id = engineering_search_projection_pending.owner_id
    ))
  )
);
COMMIT;
