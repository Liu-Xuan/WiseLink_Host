-- Additive candidate only. Existing snapshots/observations/artifacts/hashes are never rewritten.
BEGIN;
CREATE TABLE lcm_native_matrix_snapshot (
  tenant_id text NOT NULL,
  owner_actor_id text NOT NULL,
  snapshot_id text NOT NULL,
  format_version text NOT NULL CHECK (format_version='wiselink.lcm.native_matrix.v1'),
  source_row_count integer NOT NULL CHECK (source_row_count>0),
  aircraft_column_count integer NOT NULL CHECK (aircraft_column_count>0),
  matrix_json jsonb NOT NULL CHECK (jsonb_typeof(matrix_json)='object'
    AND matrix_json->>'schemaVersion'='wiselink.lcm.native_matrix.v1'
    AND jsonb_array_length(matrix_json->'rows')=source_row_count
    AND jsonb_array_length(matrix_json->'aircraft')=aircraft_column_count),
  _created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL
    THEN NULL ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  _updated_by user_profile DEFAULT CASE WHEN nullif(current_setting('app.user_id',true),'') IS NULL
    THEN NULL ELSE concat('(',current_setting('app.user_id',true),')')::user_profile END,
  PRIMARY KEY(tenant_id,owner_actor_id,snapshot_id),
  FOREIGN KEY(tenant_id,owner_actor_id,snapshot_id)
    REFERENCES lcm_configuration_snapshot(tenant_id,owner_actor_id,snapshot_id)
);
ALTER TABLE lcm_native_matrix_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE lcm_native_matrix_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY lcm_native_matrix_select ON lcm_native_matrix_snapshot FOR SELECT USING
  (tenant_id=current_setting('app.lcm_tenant_id',true) AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND EXISTS(SELECT 1 FROM lcm_configuration_snapshot s
      WHERE s.tenant_id=lcm_native_matrix_snapshot.tenant_id AND s.owner_actor_id=lcm_native_matrix_snapshot.owner_actor_id
        AND s.snapshot_id=lcm_native_matrix_snapshot.snapshot_id));
CREATE POLICY lcm_native_matrix_insert ON lcm_native_matrix_snapshot FOR INSERT WITH CHECK
  (tenant_id=current_setting('app.lcm_tenant_id',true) AND owner_actor_id=current_setting('app.lcm_actor_id',true)
    AND EXISTS(SELECT 1 FROM lcm_configuration_snapshot s
      WHERE s.tenant_id=lcm_native_matrix_snapshot.tenant_id AND s.owner_actor_id=lcm_native_matrix_snapshot.owner_actor_id
        AND s.snapshot_id=lcm_native_matrix_snapshot.snapshot_id));
CREATE POLICY lcm_native_matrix_update ON lcm_native_matrix_snapshot FOR UPDATE USING(false) WITH CHECK(false);
CREATE POLICY lcm_native_matrix_delete ON lcm_native_matrix_snapshot FOR DELETE USING(false);
CREATE POLICY lcm_native_matrix_request_owner ON lcm_native_matrix_snapshot AS RESTRICTIVE FOR ALL TO PUBLIC
  USING(left(current_user,14)='authenticated_' AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true) AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS(SELECT 1 FROM lcm_configuration_snapshot s JOIN lcm_personal_source p
      ON p.tenant_id=s.tenant_id AND p.owner_actor_id=s.owner_actor_id AND p.source_instance_id=s.source_instance_id
      WHERE s.tenant_id=lcm_native_matrix_snapshot.tenant_id AND s.owner_actor_id=lcm_native_matrix_snapshot.owner_actor_id
        AND s.snapshot_id=lcm_native_matrix_snapshot.snapshot_id AND p.read_enabled))
  WITH CHECK(left(current_user,14)='authenticated_' AND owner_actor_id=current_setting('app.user_id',true)
    AND owner_actor_id=current_setting('app.lcm_actor_id',true) AND tenant_id=current_setting('app.lcm_tenant_id',true)
    AND EXISTS(SELECT 1 FROM lcm_configuration_snapshot s JOIN lcm_personal_source p
      ON p.tenant_id=s.tenant_id AND p.owner_actor_id=s.owner_actor_id AND p.source_instance_id=s.source_instance_id
      WHERE s.tenant_id=lcm_native_matrix_snapshot.tenant_id AND s.owner_actor_id=lcm_native_matrix_snapshot.owner_actor_id
        AND s.snapshot_id=lcm_native_matrix_snapshot.snapshot_id AND p.read_enabled));
CREATE TRIGGER lcm_native_matrix_immutable BEFORE UPDATE OR DELETE ON lcm_native_matrix_snapshot
  FOR EACH ROW EXECUTE FUNCTION lcm_candidate_immutable();
COMMENT ON COLUMN lcm_native_matrix_snapshot.matrix_json IS '@type { { schemaVersion: string; kind: string; aircraftModel: string; sheet: string; rawSha256: string; range: { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number }; fixedColumns: Array<{ name: string; sourceColumn: number; rawValue: string | number | boolean | null }>; aircraft: Array<{ tailNumber: string; sourceColumn: number; rawValue: string | number | boolean | null }>; rows: Array<{ sourceRow: number; fixed: Array<string | number | boolean | null>; states: Array<string | number | boolean | null> }> } }';
COMMIT;
