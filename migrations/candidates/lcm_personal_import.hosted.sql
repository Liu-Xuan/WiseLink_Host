-- REVIEW CANDIDATE ONLY: complete seven-table Host schema on an empty LCM schema.
-- Supersedes applying local-only 0072 + 0080 separately on the platform.
-- No migration/startup runner executes this file. Root authorizes platform execution separately.
-- Existing platform user_profile type and authenticated SDK roles are prerequisites.
-- Exact candidate tables/keys/history remain those of 0072 + 0080; no existing source identity is rewritten.
BEGIN;
CREATE TABLE lcm_source_artifact (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  artifact_ref text NOT NULL,
  PRIMARY KEY (tenant_id, owner_actor_id, sha256)
);

CREATE TABLE lcm_source_collection (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  source_instance_id text NOT NULL,
  collection_id text NOT NULL,
  request_id text NOT NULL,
  request_hash text NOT NULL,
  scope_key text NOT NULL,
  context_json jsonb NOT NULL,
  source_observed_at timestamptz,
  source_observed_date date,
  source_time_zone text,
  source_time_precision text NOT NULL CHECK (source_time_precision IN ('day','instant','unknown')),
  acquisition_sequence bigint GENERATED ALWAYS AS IDENTITY,
  imported_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, owner_actor_id, source_instance_id, collection_id),
  UNIQUE (tenant_id, owner_actor_id, source_instance_id, request_id)
);

CREATE TABLE lcm_configuration_snapshot (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  snapshot_id text NOT NULL,
  source_instance_id text NOT NULL,
  collection_id text NOT NULL,
  scope_key text NOT NULL,
  previous_snapshot_id text,
  artifact_sha256 text NOT NULL,
  original_file_name text NOT NULL,
  local_source_path text NOT NULL,
  source_exported_at text,
  export_timezone text CHECK (export_timezone IS NULL),
  imported_at timestamptz NOT NULL,
  content_digest text NOT NULL,
  record_count integer NOT NULL CHECK (record_count > 0),
  coordinate_count integer NOT NULL CHECK (coordinate_count >= record_count),
  diagnostics_json jsonb NOT NULL,
  parser_version text NOT NULL DEFAULT 'wiselink.lcm.local_export.v1',
  candidate_only boolean NOT NULL DEFAULT true CHECK (candidate_only),
  PRIMARY KEY (tenant_id, owner_actor_id, snapshot_id),
  UNIQUE (tenant_id, owner_actor_id, source_instance_id, collection_id),
  FOREIGN KEY (tenant_id, owner_actor_id, source_instance_id, collection_id)
    REFERENCES lcm_source_collection (tenant_id, owner_actor_id, source_instance_id, collection_id),
  FOREIGN KEY (tenant_id, owner_actor_id, artifact_sha256)
    REFERENCES lcm_source_artifact (tenant_id, owner_actor_id, sha256),
  FOREIGN KEY (tenant_id, owner_actor_id, previous_snapshot_id)
    REFERENCES lcm_configuration_snapshot (tenant_id, owner_actor_id, snapshot_id)
);

CREATE TABLE lcm_configuration_observation (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  snapshot_id text NOT NULL,
  record_id text NOT NULL,
  identity_key text NOT NULL,
  aircraft_model text NOT NULL,
  tail_number text NOT NULL,
  part_number text,
  original_eo text,
  observed_allowed boolean,
  observed_installed boolean,
  semantic_basis text NOT NULL,
  observation text NOT NULL,
  effective_at timestamptz CHECK (effective_at IS NULL),
  executed_at timestamptz CHECK (executed_at IS NULL),
  record_json jsonb NOT NULL,
  PRIMARY KEY (tenant_id, owner_actor_id, snapshot_id, record_id),
  FOREIGN KEY (tenant_id, owner_actor_id, snapshot_id)
    REFERENCES lcm_configuration_snapshot (tenant_id, owner_actor_id, snapshot_id)
);
CREATE INDEX lcm_observation_aircraft_lookup
  ON lcm_configuration_observation (tenant_id, owner_actor_id, tail_number, part_number, snapshot_id);

CREATE TABLE lcm_evidence_relation (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  snapshot_id text NOT NULL,
  source_record_id text NOT NULL,
  relation_id text NOT NULL,
  target_source_instance_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('TDMS_RECORD', 'WISELINK_DOCUMENT_VERSION', 'FLEET_ASSET_VERSION')),
  target_id text NOT NULL,
  target_version_id text NOT NULL,
  relation text NOT NULL CHECK (relation = 'EXPLICIT_REFERENCE_CANDIDATE'),
  evidence text NOT NULL,
  candidate_only boolean NOT NULL DEFAULT true CHECK (candidate_only),
  PRIMARY KEY (tenant_id, owner_actor_id, relation_id),
  FOREIGN KEY (tenant_id, owner_actor_id, snapshot_id, source_record_id)
    REFERENCES lcm_configuration_observation (tenant_id, owner_actor_id, snapshot_id, record_id)
);

-- LCM source/tenant filters are combined with the authenticated owner boundary below.
ALTER TABLE lcm_source_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_source_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_configuration_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_configuration_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_evidence_relation ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcm_artifact_actor_scope_select ON lcm_source_artifact FOR SELECT
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_source_artifact.tenant_id
      AND s.owner_actor_id=lcm_source_artifact.owner_actor_id AND s.artifact_sha256=lcm_source_artifact.sha256));
CREATE POLICY lcm_artifact_actor_scope_insert ON lcm_source_artifact FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true));
CREATE POLICY lcm_artifact_actor_scope_update ON lcm_source_artifact FOR UPDATE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_source_artifact.tenant_id
      AND s.owner_actor_id=lcm_source_artifact.owner_actor_id AND s.artifact_sha256=lcm_source_artifact.sha256))
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true));
CREATE POLICY lcm_artifact_actor_scope_delete ON lcm_source_artifact FOR DELETE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_source_artifact.tenant_id
      AND s.owner_actor_id=lcm_source_artifact.owner_actor_id AND s.artifact_sha256=lcm_source_artifact.sha256));
CREATE POLICY lcm_collection_actor_scope_select ON lcm_source_collection FOR SELECT
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_collection_actor_scope_insert ON lcm_source_collection FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_collection_actor_scope_update ON lcm_source_collection FOR UPDATE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id))
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_collection_actor_scope_delete ON lcm_source_collection FOR DELETE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_snapshot_actor_scope_select ON lcm_configuration_snapshot FOR SELECT
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_snapshot_actor_scope_insert ON lcm_configuration_snapshot FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_snapshot_actor_scope_update ON lcm_configuration_snapshot FOR UPDATE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id))
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_snapshot_actor_scope_delete ON lcm_configuration_snapshot FOR DELETE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, source_instance_id));
CREATE POLICY lcm_observation_actor_scope_select ON lcm_configuration_observation FOR SELECT
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_configuration_observation.tenant_id
      AND s.owner_actor_id=lcm_configuration_observation.owner_actor_id AND s.snapshot_id=lcm_configuration_observation.snapshot_id));
CREATE POLICY lcm_observation_actor_scope_insert ON lcm_configuration_observation FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_configuration_observation.tenant_id
      AND s.owner_actor_id=lcm_configuration_observation.owner_actor_id AND s.snapshot_id=lcm_configuration_observation.snapshot_id));
CREATE POLICY lcm_observation_actor_scope_update ON lcm_configuration_observation FOR UPDATE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_configuration_observation.tenant_id
      AND s.owner_actor_id=lcm_configuration_observation.owner_actor_id AND s.snapshot_id=lcm_configuration_observation.snapshot_id))
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_configuration_observation.tenant_id
      AND s.owner_actor_id=lcm_configuration_observation.owner_actor_id AND s.snapshot_id=lcm_configuration_observation.snapshot_id));
CREATE POLICY lcm_observation_actor_scope_delete ON lcm_configuration_observation FOR DELETE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_configuration_observation.tenant_id
      AND s.owner_actor_id=lcm_configuration_observation.owner_actor_id AND s.snapshot_id=lcm_configuration_observation.snapshot_id));
CREATE POLICY lcm_relation_actor_scope_select ON lcm_evidence_relation FOR SELECT
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, target_source_instance_id)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_evidence_relation.tenant_id
      AND s.owner_actor_id=lcm_evidence_relation.owner_actor_id AND s.snapshot_id=lcm_evidence_relation.snapshot_id));
CREATE POLICY lcm_relation_actor_scope_insert ON lcm_evidence_relation FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, target_source_instance_id)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_evidence_relation.tenant_id
      AND s.owner_actor_id=lcm_evidence_relation.owner_actor_id AND s.snapshot_id=lcm_evidence_relation.snapshot_id));
CREATE POLICY lcm_relation_actor_scope_update ON lcm_evidence_relation FOR UPDATE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, target_source_instance_id)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_evidence_relation.tenant_id
      AND s.owner_actor_id=lcm_evidence_relation.owner_actor_id AND s.snapshot_id=lcm_evidence_relation.snapshot_id))
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, target_source_instance_id)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_evidence_relation.tenant_id
      AND s.owner_actor_id=lcm_evidence_relation.owner_actor_id AND s.snapshot_id=lcm_evidence_relation.snapshot_id));
CREATE POLICY lcm_relation_actor_scope_delete ON lcm_evidence_relation FOR DELETE
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND jsonb_exists(COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb, target_source_instance_id)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_evidence_relation.tenant_id
      AND s.owner_actor_id=lcm_evidence_relation.owner_actor_id AND s.snapshot_id=lcm_evidence_relation.snapshot_id));

CREATE FUNCTION lcm_candidate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'LCM candidate history is append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER lcm_artifact_immutable BEFORE UPDATE OR DELETE ON lcm_source_artifact
  FOR EACH ROW EXECUTE FUNCTION lcm_candidate_immutable();
CREATE TRIGGER lcm_collection_immutable BEFORE UPDATE OR DELETE ON lcm_source_collection
  FOR EACH ROW EXECUTE FUNCTION lcm_candidate_immutable();
CREATE TRIGGER lcm_snapshot_immutable BEFORE UPDATE OR DELETE ON lcm_configuration_snapshot
  FOR EACH ROW EXECUTE FUNCTION lcm_candidate_immutable();
CREATE TRIGGER lcm_observation_immutable BEFORE UPDATE OR DELETE ON lcm_configuration_observation
  FOR EACH ROW EXECUTE FUNCTION lcm_candidate_immutable();
CREATE TRIGGER lcm_relation_immutable BEFORE UPDATE OR DELETE ON lcm_evidence_relation
  FOR EACH ROW EXECUTE FUNCTION lcm_candidate_immutable();
-- Personal Excel imports keep using the existing candidate artifact/snapshot/observation tables.
CREATE TABLE lcm_personal_source (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  application_scope_id text NOT NULL,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  source_instance_id text NOT NULL,
  authority_revision integer NOT NULL DEFAULT 1 CHECK (authority_revision > 0),
  read_enabled boolean NOT NULL DEFAULT true,
  created_from_sha256 text NOT NULL CHECK (created_from_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, owner_actor_id, source_instance_id),
  UNIQUE (application_scope_id, tenant_id, owner_actor_id)
);
CREATE TABLE lcm_personal_import_request (
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END,
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  source_instance_id text NOT NULL,
  request_id text NOT NULL,
  payload_key text NOT NULL,
  selection_bucket_id text NOT NULL,
  selection_file_path text NOT NULL,
  selection_provider_object_id text NOT NULL,
  original_sha256 text NOT NULL CHECK (original_sha256 ~ '^[a-f0-9]{64}$'),
  original_byte_length bigint NOT NULL CHECK (original_byte_length > 0),
  snapshot_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, owner_actor_id, source_instance_id, request_id),
  FOREIGN KEY (tenant_id, owner_actor_id, source_instance_id)
    REFERENCES lcm_personal_source (tenant_id, owner_actor_id, source_instance_id),
  FOREIGN KEY (tenant_id, owner_actor_id, snapshot_id)
    REFERENCES lcm_configuration_snapshot (tenant_id, owner_actor_id, snapshot_id)
);
ALTER TABLE lcm_personal_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_personal_import_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcm_personal_source_owner_select ON lcm_personal_source FOR SELECT
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_source_owner_insert ON lcm_personal_source FOR INSERT
  WITH CHECK (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_source_owner_update ON lcm_personal_source FOR UPDATE
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true))
  WITH CHECK (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_source_owner_delete ON lcm_personal_source FOR DELETE
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_import_owner_select ON lcm_personal_import_request FOR SELECT
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_import_owner_insert ON lcm_personal_import_request FOR INSERT
  WITH CHECK (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_import_owner_update ON lcm_personal_import_request FOR UPDATE
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true))
  WITH CHECK (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_import_owner_delete ON lcm_personal_import_request FOR DELETE
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE FUNCTION lcm_personal_source_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.application_scope_id<>OLD.application_scope_id OR NEW.tenant_id<>OLD.tenant_id
    OR NEW.owner_actor_id<>OLD.owner_actor_id OR NEW.source_instance_id<>OLD.source_instance_id
    OR NEW.created_from_sha256<>OLD.created_from_sha256 OR NEW.created_at<>OLD.created_at
    OR NEW.authority_revision<=OLD.authority_revision THEN
    RAISE EXCEPTION 'LCM personal source identity/revision conflict' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lcm_personal_source_identity BEFORE UPDATE ON lcm_personal_source
  FOR EACH ROW EXECUTE FUNCTION lcm_personal_source_identity();

COMMENT ON COLUMN lcm_source_collection.context_json IS '@type { { schemaVersion: string; collectionId: string; sourceOrigin: string; pageUrl: string | null; filters: Record<string, string | null>; observedAt: string | null; systemStateDate?: string; systemStateTimeZone?: string; systemStateDateBasis?: string; sourceEvidence: string } }';
COMMENT ON COLUMN lcm_configuration_snapshot.diagnostics_json IS '@type { Array<{ code: string; recordIds: string[] }> }';
COMMENT ON COLUMN lcm_configuration_observation.record_json IS '@type { { recordId: string; identityKey: string; aircraftModel: string; tailNumber: string; partNumber: string | null; fields: Record<string, string | null>; observation: string; allowed: boolean | null; installed: boolean | null; semanticBasis: string; effectiveAt: null; executedAt: null; originalEo: string | null; sourceRows: Array<{ sheet: string; row: number; cells: Record<string, { sheet: string; row: number; column: number; address: string; rawValue: string | number | boolean | null; formula: string | null }> }> } }';

-- Restrictive policies remain effective if the platform adds another permissive policy.
-- The SDK, not this SQL or application code, sets request app.user_id and LOCAL ROLE.
-- A service account or anonymous request cannot use the manual personal-import path.
ALTER TABLE lcm_source_artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_source_artifact_request_owner ON lcm_source_artifact AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_source_artifact.tenant_id
      AND p.owner_actor_id=lcm_source_artifact.owner_actor_id AND p.read_enabled))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_source_artifact.tenant_id
      AND p.owner_actor_id=lcm_source_artifact.owner_actor_id AND p.read_enabled));
ALTER TABLE lcm_source_collection FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_source_collection_request_owner ON lcm_source_collection AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_source_collection.tenant_id
      AND p.owner_actor_id=lcm_source_collection.owner_actor_id AND p.read_enabled AND p.source_instance_id=lcm_source_collection.source_instance_id))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_source_collection.tenant_id
      AND p.owner_actor_id=lcm_source_collection.owner_actor_id AND p.read_enabled AND p.source_instance_id=lcm_source_collection.source_instance_id));
ALTER TABLE lcm_configuration_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_configuration_snapshot_request_owner ON lcm_configuration_snapshot AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_configuration_snapshot.tenant_id
      AND p.owner_actor_id=lcm_configuration_snapshot.owner_actor_id AND p.read_enabled AND p.source_instance_id=lcm_configuration_snapshot.source_instance_id))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_configuration_snapshot.tenant_id
      AND p.owner_actor_id=lcm_configuration_snapshot.owner_actor_id AND p.read_enabled AND p.source_instance_id=lcm_configuration_snapshot.source_instance_id));
ALTER TABLE lcm_configuration_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_configuration_observation_request_owner ON lcm_configuration_observation AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_configuration_observation.tenant_id
      AND p.owner_actor_id=lcm_configuration_observation.owner_actor_id AND p.read_enabled))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_configuration_observation.tenant_id
      AND p.owner_actor_id=lcm_configuration_observation.owner_actor_id AND p.read_enabled));
ALTER TABLE lcm_evidence_relation FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_evidence_relation_request_owner ON lcm_evidence_relation AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_evidence_relation.tenant_id
      AND p.owner_actor_id=lcm_evidence_relation.owner_actor_id AND p.read_enabled))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_evidence_relation.tenant_id
      AND p.owner_actor_id=lcm_evidence_relation.owner_actor_id AND p.read_enabled));
ALTER TABLE lcm_personal_source FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_personal_source_request_owner ON lcm_personal_source AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true));
ALTER TABLE lcm_personal_import_request FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_personal_import_request_request_owner ON lcm_personal_import_request AS RESTRICTIVE
  FOR ALL TO PUBLIC USING (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_personal_import_request.tenant_id
      AND p.owner_actor_id=lcm_personal_import_request.owner_actor_id AND p.read_enabled AND p.source_instance_id=lcm_personal_import_request.source_instance_id))
  WITH CHECK (left(current_user,14)='authenticated_'
    AND nullif(current_setting('app.user_id',true),'') IS NOT NULL
    AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS (SELECT 1 FROM lcm_personal_source p WHERE p.tenant_id=lcm_personal_import_request.tenant_id
      AND p.owner_actor_id=lcm_personal_import_request.owner_actor_id AND p.read_enabled AND p.source_instance_id=lcm_personal_import_request.source_instance_id));

CREATE FUNCTION lcm_personal_audit_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW._updated_at := CURRENT_TIMESTAMP;
  NEW._updated_by := CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL THEN NULL
    ELSE ROW(current_setting('app.user_id',true))::user_profile END;
  RETURN NEW;
END $$;
CREATE TRIGGER lcm_personal_source_audit BEFORE UPDATE ON lcm_personal_source
  FOR EACH ROW EXECUTE FUNCTION lcm_personal_audit_update();
CREATE TRIGGER lcm_personal_import_audit BEFORE UPDATE ON lcm_personal_import_request
  FOR EACH ROW EXECUTE FUNCTION lcm_personal_audit_update();
COMMIT;
