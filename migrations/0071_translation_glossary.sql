BEGIN;
CREATE TABLE translation_glossary (
  tenant_id varchar(128) PRIMARY KEY,
  revision integer NOT NULL CHECK (revision > 0),
  entries_json jsonb NOT NULL CHECK (jsonb_typeof(entries_json) = 'array'),
  updated_by varchar(255) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE translation_glossary ENABLE ROW LEVEL SECURITY;
CREATE POLICY translation_glossary_tenant ON translation_glossary
  FOR ALL TO authenticated, service_role
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
COMMENT ON COLUMN translation_glossary.entries_json IS '@type { Array<{ entryId: string; kind: "TERM" | "NO_TRANSLATE"; sourceText: string; targetRenderings: string[]; note: string | null }> }';
COMMIT;
