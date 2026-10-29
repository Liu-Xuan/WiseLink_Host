-- OFFLINE REVIEW DRAFT ONLY. Do not execute as part of B or startup.
-- Apply only to the approved database after its exact scope is authorized,
-- then regenerate schema.ts through the existing approved schema workflow.
ALTER TABLE action_attempt ADD COLUMN executor_run_json jsonb;
COMMENT ON COLUMN action_attempt.executor_run_json IS
  'Private enterprise executor dispatch/observation facts; business state, task/result envelopes, lease and deadlines remain on the original attempt.';
