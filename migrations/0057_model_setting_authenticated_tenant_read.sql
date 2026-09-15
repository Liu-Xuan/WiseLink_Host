BEGIN;

-- Native task reservation snapshots the tenant's non-secret model choice.
-- Reuse the verified identity mapping; this grants no settings management,
-- role membership, document access or Hosted execution authority.
CREATE POLICY canonical_model_setting_authenticated_tenant_read
ON canonical_model_setting FOR SELECT TO authenticated
USING (engineering_matter_actor_has_tenant(tenant_id));

COMMIT;
