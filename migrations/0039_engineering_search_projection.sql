BEGIN;
CREATE TABLE engineering_search_projection (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id varchar(160) NOT NULL,
  tenant_id varchar(128) NOT NULL,
  owner_kind varchar(32) NOT NULL CHECK (owner_kind IN ('USER', 'MATTER', 'SOURCE')),
  owner_id varchar(255) NOT NULL,
  exact_revision_ref varchar(160) NOT NULL,
  entry_kind varchar(32) NOT NULL CHECK (entry_kind IN ('SOURCE', 'RECORD', 'WORK')),
  locator_ref varchar(255),
  parent_context_ref varchar(255),
  title text NOT NULL DEFAULT '',
  identifiers text[] NOT NULL DEFAULT ARRAY[]::text[],
  original_or_work_text text NOT NULL,
  tokenized_text text NOT NULL,
  search_vector tsvector NOT NULL GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(tokenized_text, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(original_or_work_text, '')), 'C')
  ) STORED,
  indexed_version integer NOT NULL DEFAULT 1,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_engineering_search_projection_entry UNIQUE (tenant_id, entry_id),
  CONSTRAINT uk_engineering_search_projection_revision_locator UNIQUE (tenant_id, exact_revision_ref, locator_ref)
);
CREATE INDEX idx_engineering_search_projection_vector ON engineering_search_projection USING GIN (search_vector);
CREATE INDEX idx_engineering_search_projection_owner_revision ON engineering_search_projection (tenant_id, owner_kind, owner_id, exact_revision_ref);
CREATE INDEX idx_engineering_search_projection_identifiers ON engineering_search_projection USING GIN (identifiers);
ALTER TABLE engineering_search_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY engineering_search_projection_select ON engineering_search_projection FOR SELECT TO authenticated, service_role USING (
  tenant_id = current_setting('app.tenant_id', true)
);
CREATE POLICY engineering_search_projection_write ON engineering_search_projection FOR ALL TO service_role USING (
  tenant_id = current_setting('app.tenant_id', true)
) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
COMMIT;
