-- INACTIVE additive DDL. Only the owned temporary PG test runner executes this.
-- No backfill, source reads, body copies, policy activation or production execution.
CREATE TABLE tdms_processing_revision_set (
  tenant_id text NOT NULL, source_key text NOT NULL,
  source_instance_id text NOT NULL, scope_id text NOT NULL,
  set_revision_ref text NOT NULL, processing_family_ref text NOT NULL,
  cohort_ref text, processing_observation_ref text NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (tenant_id,set_revision_ref),
  UNIQUE (tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,set_revision_ref),
  FOREIGN KEY (tenant_id,processing_observation_ref)
    REFERENCES tdms_record_revision(tenant_id,source_revision_ref),
  CHECK (jsonb_typeof(data)='object'),
  CHECK (data ?& ARRAY['schemaVersion','scope','members','setRevisionRef','processingFamilyRef','cohortRef','processingObservationRef']),
  CHECK (jsonb_typeof(data->'scope')='object'),
  CHECK (jsonb_typeof(data->'members')='array'),
  CHECK (jsonb_array_length(data->'members')<=1024),
  CHECK (octet_length(data::text)<=524288),
  CHECK (data->>'schemaVersion' IS NOT DISTINCT FROM 'wiselink.tdms-processing-set.v1'),
  CHECK (data->>'setRevisionRef' IS NOT DISTINCT FROM set_revision_ref),
  CHECK (data->>'processingObservationRef' IS NOT DISTINCT FROM processing_observation_ref),
  CHECK (data->>'processingFamilyRef' IS NOT DISTINCT FROM processing_family_ref),
  CHECK (data->>'cohortRef' IS NOT DISTINCT FROM cohort_ref),
  CHECK (data#>>'{scope,tenantId}' IS NOT DISTINCT FROM tenant_id),
  CHECK (data#>>'{scope,sourceKey}' IS NOT DISTINCT FROM source_key),
  CHECK (data#>>'{scope,sourceInstanceId}' IS NOT DISTINCT FROM source_instance_id),
  CHECK (data#>>'{scope,scopeId}' IS NOT DISTINCT FROM scope_id)
);
CREATE TABLE tdms_processing_set_head (
  tenant_id text NOT NULL, source_key text NOT NULL,
  source_instance_id text NOT NULL, scope_id text NOT NULL,
  processing_family_ref text NOT NULL, selected_set_revision_ref text NOT NULL,
  generation integer NOT NULL CHECK (generation>0), data jsonb NOT NULL,
  PRIMARY KEY (tenant_id,source_key,source_instance_id,scope_id,processing_family_ref),
  FOREIGN KEY (tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref)
    REFERENCES tdms_processing_revision_set(tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,set_revision_ref),
  CHECK (jsonb_typeof(data)='object'),
  CHECK (data ?& ARRAY['scope','processingFamilyRef','selectedSetRevisionRef','generation']),
  CHECK (jsonb_typeof(data->'scope')='object'),
  CHECK (data->>'selectedSetRevisionRef' IS NOT DISTINCT FROM selected_set_revision_ref),
  CHECK ((data->>'generation')::integer IS NOT DISTINCT FROM generation),
  CHECK (data->>'processingFamilyRef' IS NOT DISTINCT FROM processing_family_ref),
  CHECK (data#>>'{scope,tenantId}' IS NOT DISTINCT FROM tenant_id),
  CHECK (data#>>'{scope,sourceKey}' IS NOT DISTINCT FROM source_key),
  CHECK (data#>>'{scope,sourceInstanceId}' IS NOT DISTINCT FROM source_instance_id),
  CHECK (data#>>'{scope,scopeId}' IS NOT DISTINCT FROM scope_id)
);
CREATE INDEX tdms_processing_set_family_cohort
  ON tdms_processing_revision_set(tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,cohort_ref,set_revision_ref);
CREATE INDEX tdms_processing_set_observation
  ON tdms_processing_revision_set(tenant_id,processing_observation_ref);
CREATE INDEX tdms_record_revision_scope_history
  ON tdms_record_revision(tenant_id,source_key,source_instance_id,scope_id,record_ref,source_revision_ref);
CREATE FUNCTION tdms_processing_set_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'TDMS_PROCESSING_SET_IMMUTABLE'; END $$;
CREATE TRIGGER tdms_processing_set_immutable BEFORE UPDATE OR DELETE
  ON tdms_processing_revision_set FOR EACH ROW EXECUTE FUNCTION tdms_processing_set_immutable();
ALTER TABLE tdms_processing_revision_set ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_processing_revision_set FORCE ROW LEVEL SECURITY;
ALTER TABLE tdms_processing_set_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE tdms_processing_set_head FORCE ROW LEVEL SECURITY;
-- Intentionally NO policies or grants. Production remains default-deny/unconfigured.
