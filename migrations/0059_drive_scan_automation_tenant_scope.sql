BEGIN;
-- A cron automation has no end-user actor. The repository binds every scan
-- transaction to the single configured tenant before touching this table.
DROP POLICY IF EXISTS wiselink_drive_scan_checkpoint_hosted
  ON wiselink_drive_scan_checkpoint;
CREATE POLICY wiselink_drive_scan_checkpoint_automation_tenant
  ON wiselink_drive_scan_checkpoint
  FOR ALL TO service_role
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
COMMIT;
