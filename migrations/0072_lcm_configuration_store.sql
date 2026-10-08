-- Isolated local candidate store. Production integration needs generated schema
-- and existing authenticated Host wiring; this migration is not deployed here.
CREATE TABLE lcm_source_artifact (
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  artifact_ref text NOT NULL,
  PRIMARY KEY (tenant_id, owner_actor_id, sha256)
);

CREATE TABLE lcm_source_collection (
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

-- App callers must supply their authenticated scope. Local tests verify these
-- policies under a NOSUPERUSER/NOBYPASSRLS role as well as repository filters.
ALTER TABLE lcm_source_artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_source_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_configuration_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_configuration_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_evidence_relation ENABLE ROW LEVEL SECURITY;
CREATE POLICY lcm_artifact_actor_scope ON lcm_source_artifact
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_source_artifact.tenant_id
      AND s.owner_actor_id=lcm_source_artifact.owner_actor_id AND s.artifact_sha256=lcm_source_artifact.sha256))
  WITH CHECK (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true));
CREATE POLICY lcm_collection_actor_scope ON lcm_source_collection
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb ? source_instance_id);
CREATE POLICY lcm_snapshot_actor_scope ON lcm_configuration_snapshot
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb ? source_instance_id);
CREATE POLICY lcm_observation_actor_scope ON lcm_configuration_observation
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND EXISTS (SELECT 1 FROM lcm_configuration_snapshot s WHERE s.tenant_id=lcm_configuration_observation.tenant_id
      AND s.owner_actor_id=lcm_configuration_observation.owner_actor_id AND s.snapshot_id=lcm_configuration_observation.snapshot_id));
CREATE POLICY lcm_relation_actor_scope ON lcm_evidence_relation
  USING (tenant_id = current_setting('app.lcm_tenant_id', true) AND owner_actor_id = current_setting('app.lcm_actor_id', true)
    AND COALESCE(NULLIF(current_setting('app.lcm_source_ids',true),''),'[]')::jsonb ? target_source_instance_id
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
