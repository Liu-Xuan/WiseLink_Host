BEGIN;
-- The Hosted SQL context supplies app.user_id, not app.tenant_id. Resolve
-- tenant membership through the existing trusted identity mapping.
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'workspace_aadkpkjef3slu'
      OR to_regprocedure('workspace_aadkpkjef3slu.engineering_matter_actor_has_tenant(character varying)') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_roles
        WHERE rolname = 'authenticated_workspace_aadkpkjef3slu'
          AND NOT rolsuper AND NOT rolbypassrls)
      OR NOT EXISTS (SELECT 1 FROM pg_roles
        WHERE rolname = 'service_role_workspace_aadkpkjef3slu'
          AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'TRANSLATION_GLOSSARY_APP_SCHEMA_OR_ROLE_MISMATCH'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
CREATE TABLE translation_glossary (
  tenant_id varchar(128) PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  entries_json jsonb NOT NULL CHECK (jsonb_typeof(entries_json) = 'array'),
  updated_by varchar(255) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT CASE
    WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT CASE
    WHEN current_setting('app.user_id', true) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END
);
ALTER TABLE translation_glossary ENABLE ROW LEVEL SECURITY;
CREATE POLICY translation_glossary_user_read ON translation_glossary
  FOR SELECT TO authenticated_workspace_aadkpkjef3slu
  USING (engineering_matter_actor_has_tenant(tenant_id));
CREATE POLICY translation_glossary_user_insert ON translation_glossary
  FOR INSERT TO authenticated_workspace_aadkpkjef3slu
  WITH CHECK (engineering_matter_actor_has_tenant(tenant_id));
CREATE POLICY translation_glossary_user_update ON translation_glossary
  FOR UPDATE TO authenticated_workspace_aadkpkjef3slu
  USING (engineering_matter_actor_has_tenant(tenant_id))
  WITH CHECK (engineering_matter_actor_has_tenant(tenant_id));
CREATE POLICY translation_glossary_service_read ON translation_glossary
  FOR SELECT TO service_role_workspace_aadkpkjef3slu
  USING (tenant_id = current_setting('app.wiselink.translation_glossary_tenant', true));
-- Entry deletion is a revisioned update. TRUNCATE bypasses row security and
-- could erase other tenants, so deny it for every runtime role.
CREATE FUNCTION translation_glossary_reject_truncate() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'TRANSLATION_GLOSSARY_TRUNCATE_DENIED' USING ERRCODE='42501';
END;
$$;
CREATE TRIGGER translation_glossary_no_truncate
BEFORE TRUNCATE ON translation_glossary FOR EACH STATEMENT
EXECUTE FUNCTION translation_glossary_reject_truncate();
COMMENT ON COLUMN translation_glossary.entries_json IS '@type { Array<{ entryId: string; kind: "TERM" | "NO_TRANSLATE"; sourceText: string; targetRenderings: string[]; note: string | null }> }';
COMMIT;
