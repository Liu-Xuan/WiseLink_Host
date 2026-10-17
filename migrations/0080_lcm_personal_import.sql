-- Apply after 0072_lcm_configuration_store.sql. No startup DDL.
-- Personal Excel imports keep using the existing candidate artifact/snapshot/observation tables.
CREATE TABLE lcm_personal_source (
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
CREATE POLICY lcm_personal_source_owner ON lcm_personal_source
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true))
  WITH CHECK (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true));
CREATE POLICY lcm_personal_import_owner ON lcm_personal_import_request
  USING (tenant_id=current_setting('app.lcm_tenant_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true))
  WITH CHECK (tenant_id=current_setting('app.lcm_tenant_id',true)
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
