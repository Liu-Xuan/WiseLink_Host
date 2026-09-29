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
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE translation_glossary ENABLE ROW LEVEL SECURITY;
CREATE POLICY translation_glossary_tenant ON translation_glossary
  FOR ALL TO authenticated_workspace_aadkpkjef3slu,
    service_role_workspace_aadkpkjef3slu
  USING (engineering_matter_actor_has_tenant(tenant_id))
  WITH CHECK (engineering_matter_actor_has_tenant(tenant_id));
COMMENT ON COLUMN translation_glossary.entries_json IS '@type { Array<{ entryId: string; kind: "TERM" | "NO_TRANSLATE"; sourceText: string; targetRenderings: string[]; note: string | null }> }';
COMMIT;
