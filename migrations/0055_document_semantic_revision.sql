BEGIN;
CREATE TABLE dm_document_semantic_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  document_version_id varchar(96) NOT NULL,
  parse_run_id varchar(96) NOT NULL,
  parse_revision integer NOT NULL,
  semantic_revision integer NOT NULL CHECK (semantic_revision > 0),
  actor_user_id varchar(255) NOT NULL,
  profile_ref varchar(160) NOT NULL,
  original_manifest_sha256 varchar(64) NOT NULL,
  map_json jsonb NOT NULL,
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  UNIQUE (tenant_id, document_version_id, parse_run_id, semantic_revision),
  FOREIGN KEY (tenant_id, document_version_id, parse_run_id)
    REFERENCES dm_document_parse_run(tenant_id, document_version_id, parse_run_id),
  CHECK ((map_json->>'schemaVersion' = 'wiselink.document.semantic-map.v1'
    AND map_json->>'profileRef' = profile_ref
    AND (map_json->>'semanticRevision')::integer = semantic_revision
    AND map_json->'binding'->>'documentVersionId' = document_version_id
    AND map_json->'binding'->>'parseRunId' = parse_run_id
    AND (map_json->'binding'->>'parseRevision')::integer = parse_revision) IS TRUE)
);
ALTER TABLE dm_document_semantic_revision ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_semantic_source_boundary ON dm_document_semantic_revision AS RESTRICTIVE
FOR ALL TO authenticated, service_role USING (
  document_translation_attempt_owned(tenant_id, current_setting('app.user_id',true)::varchar,
    document_version_id, parse_run_id, parse_revision)
  AND EXISTS (SELECT 1 FROM dm_document_parse_run p WHERE p.tenant_id=dm_document_semantic_revision.tenant_id
    AND p.parse_run_id=dm_document_semantic_revision.parse_run_id
    AND p.manifest_artifact->>'sha256'=original_manifest_sha256)
);
CREATE POLICY document_semantic_read ON dm_document_semantic_revision FOR SELECT
TO authenticated, service_role USING (true);
CREATE POLICY document_semantic_write ON dm_document_semantic_revision FOR INSERT
TO service_role WITH CHECK (actor_user_id=current_setting('app.user_id',true));
CREATE POLICY document_semantic_no_native_write ON dm_document_semantic_revision AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (false);
CREATE FUNCTION document_semantic_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'DOCUMENT_SEMANTIC_REVISION_IMMUTABLE' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER document_semantic_revision_immutable BEFORE UPDATE OR DELETE ON dm_document_semantic_revision
FOR EACH ROW EXECUTE FUNCTION document_semantic_revision_immutable();
COMMIT;
