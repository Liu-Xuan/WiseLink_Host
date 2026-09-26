-- DRAFT: apply only after the deployment owner approves the migration.
-- Adds no role, permission, policy or executable security-definer function.
BEGIN;
ALTER TABLE canonical_model_setting
  ADD COLUMN IF NOT EXISTS local_mineru_fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS title_enhancement_enabled BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN canonical_model_setting.local_mineru_fallback_enabled IS
  'Explicit tenant opt-in for new local MinerU fallback runs; captured with settings revision.';
COMMENT ON COLUMN canonical_model_setting.title_enhancement_enabled IS
  'Explicit tenant opt-in for external LLM title hierarchy enhancement on new local runs.';
COMMIT;
