-- R09 V1.1/V1.2 candidate-only Translation Memory governance.
--
-- This migration persists imported units from the existing Host bilingual
-- artifact with their exact SourceUnit, SourceRef, TranslationRuleSet and
-- execution provenance. It creates no translation runtime, RAG, Reader,
-- terminology activation, formal-knowledge promotion, or browser write path.
-- Miaoda manages table privileges; this migration contains no DCL.

BEGIN;

CREATE TABLE IF NOT EXISTS translation_knowledge_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  asset_id varchar(96) NOT NULL,
  knowledge_kind varchar(48) NOT NULL,
  candidate_only boolean NOT NULL DEFAULT true,
  usage_policy varchar(48) NOT NULL DEFAULT 'SUGGESTION_ONLY',
  owner_actor_id varchar(255) NOT NULL,
  imported_by_actor_id varchar(255) NOT NULL,
  source_artifact_ref text NOT NULL,
  source_artifact_sha256 varchar(64) NOT NULL,
  source_document_id varchar(96) NOT NULL,
  source_revision_id varchar(96) NOT NULL,
  source_sbd_package_id text NOT NULL,
  source_sbd_content_hash text NOT NULL,
  source_tcp_package_id text,
  source_tcp_content_hash text,
  action_attempt_id varchar(96) NOT NULL,
  result_content_hash varchar(64) NOT NULL,
  model_version varchar(160) NOT NULL,
  prompt_version varchar(160) NOT NULL,
  skill_version varchar(160) NOT NULL,
  rule_set_id varchar(160) NOT NULL,
  rule_set_version varchar(96) NOT NULL,
  source_locale varchar(32) NOT NULL,
  target_locale varchar(32) NOT NULL,
  source_unit_id varchar(160) NOT NULL,
  source_unit_kind varchar(48) NOT NULL,
  source_text text NOT NULL,
  translated_text text NOT NULL,
  engineer_revision_id varchar(96),
  valid_from timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_translation_knowledge_asset
    UNIQUE (tenant_id, asset_id),
  CONSTRAINT uk_translation_knowledge_artifact_unit
    UNIQUE (tenant_id, source_artifact_sha256, source_unit_id),
  CONSTRAINT fk_translation_knowledge_action_attempt
    FOREIGN KEY (action_attempt_id)
    REFERENCES action_attempt(attempt_id),
  CONSTRAINT ck_translation_knowledge_kind
    CHECK (knowledge_kind = 'TRANSLATION_MEMORY'),
  CONSTRAINT ck_translation_knowledge_candidate_only
    CHECK (candidate_only = true),
  CONSTRAINT ck_translation_knowledge_usage
    CHECK (usage_policy = 'SUGGESTION_ONLY'),
  CONSTRAINT ck_translation_knowledge_artifact_sha256
    CHECK (source_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_translation_knowledge_result_hash
    CHECK (result_content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_translation_knowledge_tcp_lineage
    CHECK (
      (source_tcp_package_id IS NULL AND source_tcp_content_hash IS NULL)
      OR
      (source_tcp_package_id IS NOT NULL AND source_tcp_content_hash IS NOT NULL)
    ),
  CONSTRAINT ck_translation_knowledge_validity
    CHECK (expires_at > valid_from),
  CONSTRAINT ck_translation_knowledge_text
    CHECK (
      length(btrim(source_text)) > 0
      AND length(btrim(translated_text)) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_translation_knowledge_owner_validity
  ON translation_knowledge_candidate(tenant_id, owner_actor_id, expires_at);

CREATE TABLE IF NOT EXISTS translation_knowledge_source_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  asset_id varchar(96) NOT NULL,
  source_ref_id text NOT NULL,
  source_ref_ordinal integer NOT NULL,
  CONSTRAINT uk_translation_knowledge_source_ref
    UNIQUE (tenant_id, asset_id, source_ref_id),
  CONSTRAINT uk_translation_knowledge_source_ref_ordinal
    UNIQUE (tenant_id, asset_id, source_ref_ordinal),
  CONSTRAINT fk_translation_knowledge_source_ref_asset
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES translation_knowledge_candidate(tenant_id, asset_id),
  CONSTRAINT ck_translation_knowledge_source_ref_nonblank
    CHECK (length(btrim(source_ref_id)) > 0),
  CONSTRAINT ck_translation_knowledge_source_ref_ordinal
    CHECK (source_ref_ordinal >= 0)
);

CREATE TABLE IF NOT EXISTS translation_knowledge_governance_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  event_id varchar(96) NOT NULL,
  asset_id varchar(96) NOT NULL,
  event_type varchar(48) NOT NULL,
  expected_revision integer NOT NULL,
  resulting_revision integer NOT NULL,
  actor_kind varchar(24) NOT NULL,
  actor_id varchar(255) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_translation_knowledge_event
    UNIQUE (tenant_id, event_id),
  CONSTRAINT uk_translation_knowledge_event_revision
    UNIQUE (tenant_id, asset_id, resulting_revision),
  CONSTRAINT fk_translation_knowledge_event_asset
    FOREIGN KEY (tenant_id, asset_id)
    REFERENCES translation_knowledge_candidate(tenant_id, asset_id),
  CONSTRAINT ck_translation_knowledge_event_type
    CHECK (event_type IN ('HUMAN_CONFIRMED', 'INVALIDATED')),
  CONSTRAINT ck_translation_knowledge_event_actor
    CHECK (actor_kind IN ('HUMAN', 'SYSTEM')),
  CONSTRAINT ck_translation_knowledge_human_confirmation
    CHECK (event_type <> 'HUMAN_CONFIRMED' OR actor_kind = 'HUMAN'),
  CONSTRAINT ck_translation_knowledge_event_revision
    CHECK (
      expected_revision >= 0
      AND resulting_revision = expected_revision + 1
    ),
  CONSTRAINT ck_translation_knowledge_event_reason
    CHECK (length(btrim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_translation_knowledge_event_history
  ON translation_knowledge_governance_event(
    tenant_id,
    asset_id,
    resulting_revision
  );

ALTER TABLE translation_knowledge_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_knowledge_source_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_knowledge_governance_event ENABLE ROW LEVEL SECURITY;

-- No authenticated policies are created: server-side governance is the only
-- write/read path for this local candidate. Product ACL/API wiring is separate.

COMMIT;
