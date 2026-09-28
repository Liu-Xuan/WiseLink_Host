-- Document translation can now record the selected Hosted execution model.
-- Legacy official-plugin attempts retain a NULL execution_model_json.
BEGIN;
ALTER TABLE action_attempt DROP CONSTRAINT ck_action_attempt_subject;
ALTER TABLE action_attempt ADD CONSTRAINT ck_action_attempt_subject CHECK (
  (subject_kind = 'WORK_ITEM' AND work_item_id IS NOT NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL
    AND action_type NOT IN ('OPENCLAW_MATTER_ASSESSMENT', 'DOCUMENT_TRANSLATE'))
  OR (subject_kind = 'ENGINEERING_MATTER' AND work_item_id IS NULL
    AND document_version_id IS NULL AND matter_id IS NOT NULL AND matter_revision_id IS NOT NULL
    AND action_type = 'OPENCLAW_MATTER_ASSESSMENT'
    AND input_revision IS NOT NULL AND base_revision IS NOT NULL)
  OR (subject_kind = 'DOCUMENT_VERSION' AND work_item_id IS NULL
    AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NOT NULL
    AND producer_run_id IS NOT NULL AND input_revision IS NOT NULL AND input_revision > 0
    AND action_type = 'DOCUMENT_TRANSLATE'
    AND (execution_model_json IS NULL OR (
      jsonb_typeof(execution_model_json::jsonb) = 'object'
      AND jsonb_exists_all(execution_model_json::jsonb,
        ARRAY['modelRef','displayName','providerKind','settingsRevision','selectedAt']::text[])
      AND execution_model_json::jsonb ->> 'modelRef' = 'm3probe/minimax-m3'
      AND execution_model_json::jsonb ->> 'providerKind' = 'CUSTOM'
      AND jsonb_typeof(execution_model_json::jsonb -> 'displayName') = 'string'
      AND execution_model_json::jsonb ->> 'displayName' <> ''
      AND jsonb_typeof(execution_model_json::jsonb -> 'settingsRevision') = 'number'
      AND (execution_model_json::jsonb ->> 'settingsRevision')::numeric >= 0
      AND jsonb_typeof(execution_model_json::jsonb -> 'selectedAt') = 'string'
    )))
);
COMMIT;
