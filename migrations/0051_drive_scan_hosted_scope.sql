BEGIN;
-- Scheduled scans use the official Hosted actor context. app.tenant_id is not
-- populated by that runtime. Source fetch authorization remains independently required.
DROP POLICY wiselink_drive_scan_checkpoint_tenant ON wiselink_drive_scan_checkpoint;
CREATE POLICY wiselink_drive_scan_checkpoint_hosted ON wiselink_drive_scan_checkpoint
  FOR ALL TO service_role
  USING (engineering_matter_actor_has_tenant(tenant_id))
  WITH CHECK (engineering_matter_actor_has_tenant(tenant_id));
COMMIT;
