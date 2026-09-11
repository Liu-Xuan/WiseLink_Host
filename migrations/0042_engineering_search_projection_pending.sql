BEGIN;
CREATE TABLE engineering_search_projection_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  exact_revision_ref varchar(160) NOT NULL,
  owner_kind varchar(32) NOT NULL,
  owner_id varchar(255) NOT NULL,
  subject_id varchar(255),
  last_error text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_engineering_search_projection_pending_revision UNIQUE (tenant_id, exact_revision_ref)
);
ALTER TABLE engineering_search_projection_pending ENABLE ROW LEVEL SECURITY;
CREATE POLICY engineering_search_projection_pending_tenant ON engineering_search_projection_pending
  FOR ALL TO authenticated, service_role
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
COMMIT;
