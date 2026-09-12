BEGIN;
-- The ordinary authorized document publish path may register only its own
-- exact published parseRun. Processing/deleting pending remains service-only.
CREATE POLICY engineering_search_projection_pending_document_publish
ON engineering_search_projection_pending FOR INSERT TO authenticated
WITH CHECK (
  owner_kind = 'SOURCE'
  AND owner_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_document_owned_by_actor(tenant_id, subject_id)
  AND EXISTS (
    SELECT 1 FROM dm_document_parse_run r
    WHERE r.tenant_id = engineering_search_projection_pending.tenant_id
      AND r.document_version_id = engineering_search_projection_pending.subject_id
      AND r.parse_run_id = engineering_search_projection_pending.exact_revision_ref
      AND r.actor_user_id = engineering_search_projection_pending.owner_id
      AND r.status = 'PUBLISHED'
  )
);
COMMIT;
