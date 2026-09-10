-- Explicitly organized materials use the same verified actor/source boundary
-- as default intake. Legacy Matters without materials retain lock-only access.
BEGIN;
DROP POLICY engineering_matter_direct_update ON engineering_matter;
CREATE POLICY engineering_matter_direct_update ON engineering_matter
  FOR UPDATE TO service_role USING (
    EXISTS (SELECT 1 FROM engineering_matter_material_link material
      WHERE material.tenant_id = engineering_matter.tenant_id
        AND material.matter_revision_id = engineering_matter.current_matter_revision_id)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, current_matter_revision_id)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM engineering_matter_material_link material
      WHERE material.tenant_id = engineering_matter.tenant_id
        AND material.matter_revision_id = engineering_matter.current_matter_revision_id)
    AND engineering_matter_actor_has_tenant(tenant_id)
    AND engineering_matter_owned_by_actor(tenant_id, matter_id)
    AND engineering_matter_all_links_owned_by_actor(tenant_id, current_matter_revision_id)
  );
COMMIT;
