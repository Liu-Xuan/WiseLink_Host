BEGIN;
-- v1 history stays byte-for-byte intact. DDL default records only the version
-- already guaranteed by 0058; unrecorded historical producer provenance is null.
ALTER TABLE dm_document_activity_run
  ADD COLUMN candidate_schema_version varchar(64) NOT NULL DEFAULT 'wiselink.document.activity-candidate.v1',
  ADD COLUMN production_contract_json jsonb;
ALTER TABLE dm_document_activity_run ADD CONSTRAINT document_activity_schema_pin_allowed
  CHECK (candidate_schema_version IN ('wiselink.document.activity-candidate.v1','wiselink.document.activity-candidate.v2'));
ALTER TABLE dm_document_activity_run ADD CONSTRAINT document_activity_production_contract_shape CHECK (
  ((candidate_schema_version='wiselink.document.activity-candidate.v1' AND production_contract_json IS NULL) OR
   (jsonb_typeof(production_contract_json)='object'
    AND production_contract_json - ARRAY['promptVersion','toolSchemaSha256','sourceContextVersion','quoteTransportVersion']::text[]='{}'::jsonb
    AND jsonb_typeof(production_contract_json->'promptVersion')='string' AND length(btrim(production_contract_json->>'promptVersion')) BETWEEN 1 AND 160
    AND jsonb_typeof(production_contract_json->'toolSchemaSha256')='string'
    AND jsonb_typeof(production_contract_json->'sourceContextVersion')='string'
    AND jsonb_typeof(production_contract_json->'quoteTransportVersion')='string'
    AND production_contract_json->>'toolSchemaSha256' ~ '^[a-f0-9]{64}$'
    AND production_contract_json->>'sourceContextVersion'='wiselink.document.activity-source-context.v1'
    AND production_contract_json->>'quoteTransportVersion' IN ('wiselink.document.activity-quote-offsets.v1','wiselink.document.activity-quote-selection.v1'))) IS TRUE);
-- 0058's unnamed CHECK is located by its full distinctive contract predicates,
-- never a guessed PostgreSQL-generated name. Stop if catalogue is unexpected.
DO $$
DECLARE old_name text; matched integer;
BEGIN
  SELECT count(*),min(c.conname) INTO matched,old_name
  FROM pg_constraint c WHERE c.conrelid='dm_document_activity_run'::regclass AND c.contype='c'
    AND pg_get_constraintdef(c.oid) LIKE '%wiselink.document.activity-candidate.v1%'
    AND pg_get_constraintdef(c.oid) LIKE '%candidateOnly%'
    AND pg_get_constraintdef(c.oid) LIKE '%runRef%'
    AND pg_get_constraintdef(c.oid) LIKE '%sourceBinding%'
    AND pg_get_constraintdef(c.oid) LIKE '%semanticRevision%';
  IF matched<>1 THEN RAISE EXCEPTION 'DOCUMENT_ACTIVITY_LEGACY_SAVED_CHECK_UNEXPECTED:%',matched; END IF;
  EXECUTE format('ALTER TABLE dm_document_activity_run DROP CONSTRAINT %I',old_name);
END $$;
ALTER TABLE dm_document_activity_run
  ADD CONSTRAINT document_activity_saved_contract_v2 CHECK (status<>'SAVED' OR ((result_json->>'schemaVersion'=candidate_schema_version
    AND result_json->>'candidateOnly'='true' AND result_json->>'runRef'=run_ref
    AND (result_json->>'candidateRevision')::integer=candidate_revision
    AND result_json->'sourceBinding'->'original'->>'documentVersionId'=document_version_id
    AND result_json->'sourceBinding'->'original'->>'parseRunId'=parse_run_id
    AND (result_json->'sourceBinding'->'original'->>'parseRevision')::integer=parse_revision
    AND (result_json->'sourceBinding'->>'semanticRevision')::integer=semantic_revision) IS TRUE));
CREATE OR REPLACE FUNCTION document_activity_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.status IN ('SAVED','FAILED','CANCELLED','EXPIRED') THEN
    RAISE EXCEPTION 'DOCUMENT_ACTIVITY_TERMINAL_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.run_ref,NEW.tenant_id,NEW.actor_user_id,NEW.request_id,NEW.document_version_id,
      NEW.parse_run_id,NEW.parse_revision,NEW.semantic_revision,NEW.original_manifest_sha256,
      NEW.selection_json,NEW.expected_revision,NEW.deadline_at,NEW.candidate_schema_version,NEW.production_contract_json)
    IS DISTINCT FROM ROW(OLD.run_ref,OLD.tenant_id,OLD.actor_user_id,OLD.request_id,OLD.document_version_id,
      OLD.parse_run_id,OLD.parse_revision,OLD.semantic_revision,OLD.original_manifest_sha256,
      OLD.selection_json,OLD.expected_revision,OLD.deadline_at,OLD.candidate_schema_version,OLD.production_contract_json) THEN
    RAISE EXCEPTION 'DOCUMENT_ACTIVITY_REQUEST_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON COLUMN dm_document_activity_run.candidate_schema_version IS 'Immutable run contract; historical rows remain v1';
COMMENT ON COLUMN dm_document_activity_run.production_contract_json IS 'Immutable explicitly recorded producer pins; null for unrecorded legacy provenance';
-- No RLS, roles, grants, source ACL, lease, deadline, CAS or result JSON changes.
COMMIT;
