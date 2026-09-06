-- Non-secret task choice; legacy rows keep their existing attempt provenance.
ALTER TABLE work_item ADD COLUMN IF NOT EXISTS analysis_model_json TEXT;
COMMENT ON COLUMN work_item.analysis_model_json IS 'Host-captured non-secret model selection for this WorkItem; immutable across initial analysis stages and same-request retries.';
