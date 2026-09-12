BEGIN;
-- Miaoda rewrites PUBLIC to its authenticated role when applying DDL.
-- Explicit roles retain the restrictive document boundary for Hosted service
-- requests as well as browser requests after platform deployment.
ALTER POLICY translation_workspace_document_boundary ON translation_workspace
  TO authenticated, service_role;
ALTER POLICY translation_block_document_boundary ON translation_block_revision
  TO authenticated, service_role;
ALTER POLICY action_attempt_document_subject_boundary ON action_attempt
  TO authenticated, service_role;
COMMIT;
