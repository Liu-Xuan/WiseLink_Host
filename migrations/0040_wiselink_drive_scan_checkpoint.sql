BEGIN;
CREATE TABLE wiselink_drive_scan_checkpoint (
  id varchar(160) PRIMARY KEY,
  tenant_id varchar(128) NOT NULL,
  source_key varchar(128) NOT NULL,
  checkpoint_json text NOT NULL,
  checkpoint_version integer NOT NULL DEFAULT 1,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_wiselink_drive_scan_checkpoint_source UNIQUE (tenant_id, source_key)
);
ALTER TABLE wiselink_drive_scan_checkpoint ENABLE ROW LEVEL SECURITY;
CREATE POLICY wiselink_drive_scan_checkpoint_tenant ON wiselink_drive_scan_checkpoint
  FOR ALL TO authenticated, service_role
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
COMMIT;
