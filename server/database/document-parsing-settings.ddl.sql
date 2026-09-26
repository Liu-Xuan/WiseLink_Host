-- C159: two additive settings columns for the authorized local MinerU worker release.
-- Adds no role, permission, policy or executable security-definer function.
BEGIN;
ALTER TABLE canonical_model_setting
  ADD COLUMN IF NOT EXISTS local_mineru_fallback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS title_enhancement_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Existing saved tenant choices are preserved. This changes only future row defaults.
ALTER TABLE canonical_model_setting ALTER COLUMN local_mineru_fallback_enabled SET DEFAULT TRUE;
COMMENT ON COLUMN canonical_model_setting.local_mineru_fallback_enabled IS
  'Local MinerU is the default for new runs; an explicit tenant choice is captured with settings revision.';
COMMENT ON COLUMN canonical_model_setting.title_enhancement_enabled IS
  'Explicit tenant opt-in for external LLM title hierarchy enhancement on new local runs.';
COMMIT;
