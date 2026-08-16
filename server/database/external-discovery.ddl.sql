-- Current Canonical Host / Document Management migration for the sole hosted
-- external OEM discovery store. Apply only after separate schema authorization.
-- Execute this entire transaction in DEV first, independently read back both
-- empty tables and their constraints, regenerate server/database/schema.ts,
-- then review and separately confirm the DEV-to-online migration.

BEGIN;

CREATE TABLE external_search_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(128) NOT NULL,
  search_run_ref VARCHAR(255) NOT NULL,
  source_system VARCHAR(128) NOT NULL,
  query TEXT NOT NULL,
  result_status VARCHAR(64) NOT NULL,
  failure_code VARCHAR(96),
  observed_at TIMESTAMPTZ(3) NOT NULL,
  access_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  truncated BOOLEAN NOT NULL DEFAULT FALSE,
  partial_only BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_by_user_id VARCHAR(255) NOT NULL,
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_external_search_run_tenant_ref
    UNIQUE (tenant_id, search_run_ref),
  CONSTRAINT ck_external_search_run_status CHECK (
    result_status IN (
      'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
      'ACCESS_DENIED',
      'PARTIAL_RESULTS',
      'TRUNCATED',
      'CANDIDATES_FOUND'
    )
  )
);

CREATE INDEX idx_external_search_run_observed
  ON external_search_run (tenant_id, observed_at DESC);

CREATE TABLE external_discovery_candidate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(128) NOT NULL,
  search_run_ref VARCHAR(255) NOT NULL,
  candidate_ref VARCHAR(255) NOT NULL,
  publisher VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  disposition VARCHAR(96) NOT NULL,
  review_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  review_decision VARCHAR(64),
  reviewed_by_user_id VARCHAR(255),
  reviewed_at TIMESTAMPTZ(3),
  _created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  _updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
    ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END
  ),
  CONSTRAINT uk_external_candidate_tenant_ref
    UNIQUE (tenant_id, candidate_ref),
  CONSTRAINT fk_external_candidate_search_run
    FOREIGN KEY (tenant_id, search_run_ref)
    REFERENCES external_search_run (tenant_id, search_run_ref),
  CONSTRAINT ck_external_candidate_publisher CHECK (
    publisher IN ('AIRBUS', 'BOEING', 'COMAC')
  ),
  CONSTRAINT ck_external_candidate_review_status CHECK (
    review_status IN ('PENDING', 'HUMAN_SELECTED', 'REJECTED')
  ),
  CONSTRAINT ck_external_candidate_review_group CHECK (
    (
      review_status = 'PENDING'
      AND review_decision IS NULL
      AND reviewed_by_user_id IS NULL
      AND reviewed_at IS NULL
    ) OR (
      review_status = 'HUMAN_SELECTED'
      AND review_decision = 'HUMAN_SELECTED_FOR_INGEST'
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    ) OR (
      review_status = 'REJECTED'
      AND review_decision = 'HUMAN_REJECTED'
      AND reviewed_by_user_id IS NOT NULL
      AND reviewed_at IS NOT NULL
    )
  )
);

CREATE INDEX idx_external_candidate_run
  ON external_discovery_candidate (tenant_id, search_run_ref);
CREATE INDEX idx_external_candidate_review
  ON external_discovery_candidate (tenant_id, review_status, _updated_at DESC);

ALTER TABLE external_search_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_discovery_candidate ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_bypass_policy ON external_search_run
  TO service_role USING (true);
CREATE POLICY "修改全部数据" ON external_search_run
  AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON external_search_run
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON external_search_run
  AS PERMISSIVE FOR ALL TO authenticated USING (
    current_setting('app.user_id'::text) = ((_created_by).user_id)::text
  );

CREATE POLICY service_role_bypass_policy ON external_discovery_candidate
  TO service_role USING (true);
CREATE POLICY "修改全部数据" ON external_discovery_candidate
  AS PERMISSIVE FOR ALL TO authenticated USING (true);
CREATE POLICY "查看全部数据" ON external_discovery_candidate
  AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY "修改本人数据" ON external_discovery_candidate
  AS PERMISSIVE FOR ALL TO authenticated USING (
    current_setting('app.user_id'::text) = ((_created_by).user_id)::text
  );

COMMENT ON TABLE external_search_run IS
  'External OEM discovery run; may exist with zero candidates.';
COMMENT ON TABLE external_discovery_candidate IS
  'Discovery-only OEM candidate and its single human selection state.';

COMMIT;
