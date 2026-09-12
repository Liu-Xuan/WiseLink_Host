BEGIN;
-- Platform ALTER POLICY TO returns success without updating roles.
-- Recreate the same restrictive predicates atomically with explicit roles.
DROP POLICY translation_workspace_document_boundary ON translation_workspace;
CREATE POLICY translation_workspace_document_boundary ON translation_workspace AS RESTRICTIVE FOR ALL TO authenticated, service_role
  USING (subject_kind <> 'DOCUMENT_VERSION' OR (
    engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_document_owned_by_actor(tenant_id, document_version_id)));
DROP POLICY translation_block_document_boundary ON translation_block_revision;
CREATE POLICY translation_block_document_boundary ON translation_block_revision AS RESTRICTIVE FOR ALL TO authenticated, service_role
  USING (work_item_id IS NOT NULL OR EXISTS (SELECT 1 FROM translation_workspace w
    WHERE w.tenant_id=translation_block_revision.tenant_id AND w.workspace_id=translation_block_revision.workspace_id
      AND w.subject_kind='DOCUMENT_VERSION' AND w.work_item_id IS NULL
      AND engineering_matter_actor_has_tenant(w.tenant_id)
      AND engineering_matter_document_owned_by_actor(w.tenant_id,w.document_version_id)));
DROP POLICY action_attempt_document_subject_boundary ON action_attempt;
CREATE POLICY action_attempt_document_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO authenticated, service_role
  USING (subject_kind <> 'DOCUMENT_VERSION' OR
    document_translation_attempt_owned(tenant_id,actor_user_id,document_version_id,producer_run_id,input_revision));
COMMIT;
