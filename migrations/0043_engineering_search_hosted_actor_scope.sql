BEGIN;
-- Hosted SQL scopes app.user_id for each statement. Reuse the authoritative
-- identity mapping rather than relying on an unset app.tenant_id variable.
DROP POLICY engineering_search_projection_pending_tenant ON engineering_search_projection_pending;
CREATE POLICY engineering_search_projection_pending_read ON engineering_search_projection_pending
  FOR SELECT TO authenticated, service_role
  USING (engineering_matter_actor_has_tenant(tenant_id));
CREATE POLICY engineering_search_projection_pending_write ON engineering_search_projection_pending
  FOR ALL TO service_role
  USING (engineering_matter_actor_has_tenant(tenant_id) AND owner_id = current_setting('app.user_id', true))
  WITH CHECK (engineering_matter_actor_has_tenant(tenant_id) AND owner_id = current_setting('app.user_id', true));
DROP POLICY engineering_search_projection_select ON engineering_search_projection;
DROP POLICY engineering_search_projection_write ON engineering_search_projection;
CREATE POLICY engineering_search_projection_select ON engineering_search_projection
  FOR SELECT TO authenticated, service_role
  USING (engineering_matter_actor_has_tenant(tenant_id));
CREATE POLICY engineering_search_projection_write ON engineering_search_projection
  FOR ALL TO service_role
  USING (engineering_matter_actor_has_tenant(tenant_id) AND owner_id = current_setting('app.user_id', true))
  WITH CHECK (engineering_matter_actor_has_tenant(tenant_id) AND owner_id = current_setting('app.user_id', true));
COMMIT;
