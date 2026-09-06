BEGIN;
ALTER TABLE action_attempt ADD COLUMN IF NOT EXISTS execution_model_json TEXT;
COMMENT ON COLUMN action_attempt.execution_model_json IS
  'Host-selected model metadata captured when the attempt is first queued, before context preparation. No credentials. Existing attempts remain null and retain their historical routing.';
COMMIT;
