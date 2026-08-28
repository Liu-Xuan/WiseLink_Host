-- WiseLink V1.0 R09 canonical FleetMasterData service read correction.
--
-- Official Host server-service requests execute as the Miaoda-managed
-- service_role without an end-user app.user_id. Keep the browser policies
-- from 0011 unchanged and expose only SELECT on the five Fleet authority
-- tables to that platform role.

BEGIN;

DROP POLICY IF EXISTS canonical_fleet_source_snapshot_service_role_select
  ON canonical_fleet_source_snapshot;
CREATE POLICY canonical_fleet_source_snapshot_service_role_select
  ON canonical_fleet_source_snapshot
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS canonical_fleet_scope_head_service_role_select
  ON canonical_fleet_scope_head;
CREATE POLICY canonical_fleet_scope_head_service_role_select
  ON canonical_fleet_scope_head
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS canonical_fleet_asset_service_role_select
  ON canonical_fleet_asset_version;
CREATE POLICY canonical_fleet_asset_service_role_select
  ON canonical_fleet_asset_version
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS canonical_fleet_alias_service_role_select
  ON canonical_fleet_alias_version;
CREATE POLICY canonical_fleet_alias_service_role_select
  ON canonical_fleet_alias_version
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

DROP POLICY IF EXISTS canonical_fleet_fact_service_role_select
  ON canonical_fleet_configuration_fact_version;
CREATE POLICY canonical_fleet_fact_service_role_select
  ON canonical_fleet_configuration_fact_version
  AS PERMISSIVE
  FOR SELECT
  TO service_role
  USING (true);

-- Miaoda owns workspace table privileges and expands the base platform role.
-- Do not add GRANT/REVOKE or any service INSERT/UPDATE/DELETE policy here.

COMMIT;
