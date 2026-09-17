BEGIN;
-- File reading is an independent candidate, never an activity or fleet assessment.
-- A SAVED run is its immutable reading revision in the existing Host database.
CREATE TABLE dm_document_reading_run (
  run_ref varchar(96) PRIMARY KEY,
  tenant_id varchar(128) NOT NULL,
  actor_user_id varchar(255) NOT NULL,
  request_id varchar(160) NOT NULL,
  document_version_id varchar(96) NOT NULL,
  parse_run_id varchar(96) NOT NULL,
  parse_revision integer NOT NULL,
  semantic_revision integer NOT NULL CHECK (semantic_revision > 0),
  original_manifest_sha256 varchar(64) NOT NULL,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  reading_revision integer CHECK (reading_revision > 0),
  status varchar(16) NOT NULL CHECK (status IN ('QUEUED','RUNNING','SAVED','FAILED','CANCELLED','EXPIRED')),
  lease_owner varchar(160),
  lease_token uuid,
  lease_generation integer NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at timestamptz,
  deadline_at timestamptz NOT NULL,
  delivered_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_json jsonb,
  save_command_json jsonb,
  producer_json jsonb,
  error_code varchar(160),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  UNIQUE (tenant_id, actor_user_id, request_id),
  UNIQUE (tenant_id, document_version_id, parse_run_id, semantic_revision, reading_revision),
  FOREIGN KEY (tenant_id, document_version_id, parse_run_id)
    REFERENCES dm_document_parse_run(tenant_id, document_version_id, parse_run_id),
  CHECK (jsonb_typeof(delivered_json)='array'),
  CHECK ((status='SAVED') = (reading_revision IS NOT NULL AND result_json IS NOT NULL AND save_command_json IS NOT NULL)),
  CHECK (status<>'SAVED' OR ((result_json->>'schemaVersion'='wiselink.document.reading.v1'
    AND result_json->>'candidateOnly'='true' AND result_json->>'readingRunRef'=run_ref
    AND (result_json->>'readingRevision')::integer=reading_revision
    AND result_json->'sourceBinding'->'original'->>'documentVersionId'=document_version_id
    AND result_json->'sourceBinding'->'original'->>'parseRunId'=parse_run_id
    AND (result_json->'sourceBinding'->'original'->>'parseRevision')::integer=parse_revision
    AND (result_json->'sourceBinding'->>'semanticRevision')::integer=semantic_revision) IS TRUE)),
  CHECK (status='RUNNING' OR (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))
);
COMMENT ON COLUMN dm_document_reading_run.delivered_json IS '@type { Array<{ offset: number; unitIds: string[]; anchorIds: string[]; nextOffset: number | null }> }';
COMMENT ON COLUMN dm_document_reading_run.result_json IS '@type { Record<string, unknown> }';
COMMENT ON COLUMN dm_document_reading_run.save_command_json IS '@type { Record<string, unknown> }';
COMMENT ON COLUMN dm_document_reading_run.producer_json IS '@type { { skillVersion: string; modelVersion: string } }';
ALTER TABLE dm_document_reading_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_reading_source_boundary ON dm_document_reading_run AS RESTRICTIVE
FOR ALL TO authenticated, service_role USING (
  document_translation_attempt_owned(tenant_id, current_setting('app.user_id',true)::varchar,
    document_version_id, parse_run_id, parse_revision)
  AND EXISTS (SELECT 1 FROM dm_document_parse_run p WHERE p.tenant_id=dm_document_reading_run.tenant_id
    AND p.parse_run_id=dm_document_reading_run.parse_run_id
    AND p.manifest_artifact->>'sha256'=original_manifest_sha256)
);
-- Browser readers never receive active producer leases. Saved results are still
-- filtered by the original document authorization above.
CREATE POLICY document_reading_saved_read ON dm_document_reading_run FOR SELECT
TO authenticated, service_role USING (status='SAVED');
CREATE POLICY document_reading_producer_read ON dm_document_reading_run FOR SELECT
TO service_role USING (actor_user_id=current_setting('app.user_id',true));
CREATE POLICY document_reading_producer_insert ON dm_document_reading_run FOR INSERT
TO service_role WITH CHECK (actor_user_id=current_setting('app.user_id',true));
CREATE POLICY document_reading_producer_update ON dm_document_reading_run FOR UPDATE
TO service_role USING (actor_user_id=current_setting('app.user_id',true))
WITH CHECK (actor_user_id=current_setting('app.user_id',true));
CREATE POLICY document_reading_no_native_insert ON dm_document_reading_run AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY document_reading_no_native_update ON dm_document_reading_run AS RESTRICTIVE
FOR UPDATE TO authenticated USING (false);
CREATE FUNCTION document_reading_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('SAVED','FAILED','CANCELLED','EXPIRED') THEN
    RAISE EXCEPTION 'DOCUMENT_READING_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.run_ref,NEW.tenant_id,NEW.actor_user_id,NEW.request_id,NEW.document_version_id,
      NEW.parse_run_id,NEW.parse_revision,NEW.semantic_revision,NEW.original_manifest_sha256,
      NEW.expected_revision,NEW.deadline_at)
    IS DISTINCT FROM ROW(OLD.run_ref,OLD.tenant_id,OLD.actor_user_id,OLD.request_id,OLD.document_version_id,
      OLD.parse_run_id,OLD.parse_revision,OLD.semantic_revision,OLD.original_manifest_sha256,
      OLD.expected_revision,OLD.deadline_at) THEN
    RAISE EXCEPTION 'DOCUMENT_READING_REQUEST_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER document_reading_run_guard BEFORE UPDATE OR DELETE ON dm_document_reading_run
FOR EACH ROW EXECUTE FUNCTION document_reading_run_guard();
COMMIT;
