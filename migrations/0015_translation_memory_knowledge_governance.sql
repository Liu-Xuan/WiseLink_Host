-- R09 V1.1/V1.2 candidate-only Translation Memory governance.
--
-- This migration persists imported units from the existing Host bilingual
-- artifact with their exact WorkItem, SourceUnit, SourceRef,
-- TranslationRuleSet and execution provenance. Engineer feedback is an
-- append-only learning event and never activates terminology, creates formal
-- knowledge, approves engineering content, publishes, or changes translation
-- currentness. It creates no translation runtime, RAG, Reader, or second
-- artifact store. Miaoda manages table privileges; this migration contains no
-- DCL and exposes no authenticated/browser table policy.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uk_work_item_tenant_business_id
  ON work_item(tenant_id, work_item_id);

CREATE TABLE IF NOT EXISTS translation_knowledge_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  snapshot_work_item_revision integer NOT NULL,
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
  source_unit_count integer NOT NULL,
  source_ref_count integer NOT NULL,
  source_text text NOT NULL,
  translated_text text NOT NULL,
  engineer_revision_id varchar(96),
  valid_from timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_translation_knowledge_asset
    UNIQUE (tenant_id, work_item_id, asset_id),
  CONSTRAINT uk_translation_knowledge_asset_snapshot
    UNIQUE (
      tenant_id,
      work_item_id,
      asset_id,
      snapshot_work_item_revision
    ),
  CONSTRAINT uk_translation_knowledge_artifact_unit
    UNIQUE (
      tenant_id,
      work_item_id,
      snapshot_work_item_revision,
      source_artifact_sha256,
      source_unit_id
    ),
  CONSTRAINT fk_translation_knowledge_work_item
    FOREIGN KEY (tenant_id, work_item_id)
    REFERENCES work_item(tenant_id, work_item_id),
  CONSTRAINT fk_translation_knowledge_action_attempt
    FOREIGN KEY (action_attempt_id)
    REFERENCES action_attempt(attempt_id),
  CONSTRAINT ck_translation_knowledge_work_item_revision
    CHECK (snapshot_work_item_revision > 0),
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
  CONSTRAINT ck_translation_knowledge_source_counts
    CHECK (source_unit_count > 0 AND source_ref_count > 0),
  CONSTRAINT ck_translation_knowledge_validity
    CHECK (expires_at > valid_from),
  CONSTRAINT ck_translation_knowledge_text
    CHECK (
      length(btrim(source_text)) > 0
      AND length(btrim(translated_text)) > 0
    )
);

CREATE INDEX IF NOT EXISTS idx_translation_knowledge_owner_validity
  ON translation_knowledge_candidate(
    tenant_id,
    work_item_id,
    owner_actor_id,
    expires_at
  );

CREATE TABLE IF NOT EXISTS translation_knowledge_source_ref (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  asset_id varchar(96) NOT NULL,
  source_ref_id text NOT NULL,
  source_ref_ordinal integer NOT NULL,
  CONSTRAINT uk_translation_knowledge_source_ref
    UNIQUE (tenant_id, work_item_id, asset_id, source_ref_id),
  CONSTRAINT uk_translation_knowledge_source_ref_ordinal
    UNIQUE (tenant_id, work_item_id, asset_id, source_ref_ordinal),
  CONSTRAINT fk_translation_knowledge_source_ref_asset
    FOREIGN KEY (tenant_id, work_item_id, asset_id)
    REFERENCES translation_knowledge_candidate(
      tenant_id,
      work_item_id,
      asset_id
    ),
  CONSTRAINT ck_translation_knowledge_source_ref_nonblank
    CHECK (length(btrim(source_ref_id)) > 0),
  CONSTRAINT ck_translation_knowledge_source_ref_ordinal
    CHECK (source_ref_ordinal >= 0)
);

CREATE TABLE IF NOT EXISTS translation_knowledge_import_request_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  request_id varchar(96) NOT NULL,
  snapshot_work_item_revision integer NOT NULL,
  source_artifact_sha256 varchar(64) NOT NULL,
  source_unit_id varchar(160) NOT NULL,
  source_unit_ordinal integer NOT NULL,
  expected_unit_count integer NOT NULL,
  asset_id varchar(96) NOT NULL,
  valid_from timestamptz(3) NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  created_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_translation_knowledge_import_request_unit
    UNIQUE (tenant_id, work_item_id, request_id, source_unit_id),
  CONSTRAINT uk_translation_knowledge_import_request_asset
    UNIQUE (tenant_id, work_item_id, request_id, asset_id),
  CONSTRAINT uk_translation_knowledge_import_request_ordinal
    UNIQUE (tenant_id, work_item_id, request_id, source_unit_ordinal),
  CONSTRAINT fk_translation_knowledge_import_request_asset
    FOREIGN KEY (
      tenant_id,
      work_item_id,
      asset_id,
      snapshot_work_item_revision
    )
    REFERENCES translation_knowledge_candidate(
      tenant_id,
      work_item_id,
      asset_id,
      snapshot_work_item_revision
    ),
  CONSTRAINT ck_translation_knowledge_import_request
    CHECK (length(btrim(request_id)) > 0),
  CONSTRAINT ck_translation_knowledge_import_count
    CHECK (
      expected_unit_count > 0
      AND source_unit_ordinal >= 0
      AND source_unit_ordinal < expected_unit_count
    ),
  CONSTRAINT ck_translation_knowledge_import_hash
    CHECK (source_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_translation_knowledge_import_validity
    CHECK (expires_at > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_translation_knowledge_import_request
  ON translation_knowledge_import_request_item(
    tenant_id,
    work_item_id,
    request_id,
    source_unit_id
  );

CREATE TABLE IF NOT EXISTS translation_knowledge_governance_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  snapshot_work_item_revision integer NOT NULL,
  event_id varchar(96) NOT NULL,
  request_id varchar(96),
  asset_id varchar(96) NOT NULL,
  event_type varchar(48) NOT NULL,
  feedback_decision varchar(64),
  expected_revision integer NOT NULL,
  resulting_revision integer NOT NULL,
  actor_kind varchar(24) NOT NULL,
  actor_id varchar(255) NOT NULL,
  reason text NOT NULL,
  created_at timestamptz(3) NOT NULL,
  CONSTRAINT uk_translation_knowledge_event
    UNIQUE (tenant_id, work_item_id, event_id),
  CONSTRAINT uk_translation_knowledge_event_revision
    UNIQUE (
      tenant_id,
      work_item_id,
      asset_id,
      resulting_revision
    ),
  CONSTRAINT fk_translation_knowledge_event_asset
    FOREIGN KEY (
      tenant_id,
      work_item_id,
      asset_id,
      snapshot_work_item_revision
    )
    REFERENCES translation_knowledge_candidate(
      tenant_id,
      work_item_id,
      asset_id,
      snapshot_work_item_revision
    ),
  CONSTRAINT ck_translation_knowledge_event_type
    CHECK (
      event_type IN (
        'HUMAN_CONFIRMED',
        'INVALIDATED',
        'ENGINEER_ADOPTED',
        'ENGINEER_REJECTED'
      )
    ),
  CONSTRAINT ck_translation_knowledge_event_actor
    CHECK (actor_kind IN ('HUMAN', 'SYSTEM')),
  CONSTRAINT ck_translation_knowledge_human_event
    CHECK (
      event_type NOT IN (
        'HUMAN_CONFIRMED',
        'ENGINEER_ADOPTED',
        'ENGINEER_REJECTED'
      )
      OR actor_kind = 'HUMAN'
    ),
  CONSTRAINT ck_translation_knowledge_feedback_binding
    CHECK (
      (
        event_type = 'ENGINEER_ADOPTED'
        AND request_id IS NOT NULL
        AND feedback_decision = 'ADOPTED_AS_CANDIDATE_SUGGESTION'
      )
      OR
      (
        event_type = 'ENGINEER_REJECTED'
        AND request_id IS NOT NULL
        AND feedback_decision = 'REJECTED'
      )
      OR
      (
        event_type IN ('HUMAN_CONFIRMED', 'INVALIDATED')
        AND request_id IS NULL
        AND feedback_decision IS NULL
      )
    ),
  CONSTRAINT ck_translation_knowledge_event_revision
    CHECK (
      snapshot_work_item_revision > 0
      AND expected_revision >= 0
      AND resulting_revision = expected_revision + 1
    ),
  CONSTRAINT ck_translation_knowledge_event_reason
    CHECK (length(btrim(reason)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_translation_knowledge_feedback_request
  ON translation_knowledge_governance_event(
    tenant_id,
    work_item_id,
    request_id
  )
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_translation_knowledge_event_history
  ON translation_knowledge_governance_event(
    tenant_id,
    work_item_id,
    asset_id,
    resulting_revision
  );

CREATE OR REPLACE FUNCTION translation_knowledge_assert_current_work_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM work_item current_work_item
  WHERE current_work_item.tenant_id = NEW.tenant_id
    AND current_work_item.work_item_id = NEW.work_item_id
    AND current_work_item.revision = NEW.snapshot_work_item_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'TRANSLATION_KNOWLEDGE_WORK_ITEM_CAS_CONFLICT';
  END IF;

  IF TG_TABLE_NAME = 'translation_knowledge_candidate' THEN
    PERFORM 1
    FROM action_attempt current_attempt
    WHERE current_attempt.attempt_id = NEW.action_attempt_id
      AND current_attempt.tenant_id = NEW.tenant_id
      AND current_attempt.work_item_id = NEW.work_item_id
      AND current_attempt.document_version_id = NEW.source_revision_id
      AND current_attempt.action_type = 'OPENCLAW_TRANSLATE'
      AND current_attempt.status = 'SUCCEEDED'
      AND current_attempt.projection_applied = true
      AND current_attempt.result_content_hash = NEW.result_content_hash;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'TRANSLATION_KNOWLEDGE_ACTION_ATTEMPT_SCOPE_CONFLICT';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS translation_knowledge_candidate_current_trigger
  ON translation_knowledge_candidate;
CREATE TRIGGER translation_knowledge_candidate_current_trigger
  BEFORE INSERT ON translation_knowledge_candidate
  FOR EACH ROW EXECUTE FUNCTION translation_knowledge_assert_current_work_item();

DROP TRIGGER IF EXISTS translation_knowledge_import_current_trigger
  ON translation_knowledge_import_request_item;
CREATE TRIGGER translation_knowledge_import_current_trigger
  BEFORE INSERT ON translation_knowledge_import_request_item
  FOR EACH ROW EXECUTE FUNCTION translation_knowledge_assert_current_work_item();

DROP TRIGGER IF EXISTS translation_knowledge_event_current_trigger
  ON translation_knowledge_governance_event;
CREATE TRIGGER translation_knowledge_event_current_trigger
  BEFORE INSERT ON translation_knowledge_governance_event
  FOR EACH ROW EXECUTE FUNCTION translation_knowledge_assert_current_work_item();

ALTER TABLE translation_knowledge_candidate ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_knowledge_source_ref ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_knowledge_import_request_item
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_knowledge_governance_event ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS translation_knowledge_candidate_service_select
  ON translation_knowledge_candidate;
CREATE POLICY translation_knowledge_candidate_service_select
  ON translation_knowledge_candidate FOR SELECT TO service_role
  USING (true);
DROP POLICY IF EXISTS translation_knowledge_candidate_service_insert
  ON translation_knowledge_candidate;
CREATE POLICY translation_knowledge_candidate_service_insert
  ON translation_knowledge_candidate FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS translation_knowledge_source_ref_service_select
  ON translation_knowledge_source_ref;
CREATE POLICY translation_knowledge_source_ref_service_select
  ON translation_knowledge_source_ref FOR SELECT TO service_role
  USING (true);
DROP POLICY IF EXISTS translation_knowledge_source_ref_service_insert
  ON translation_knowledge_source_ref;
CREATE POLICY translation_knowledge_source_ref_service_insert
  ON translation_knowledge_source_ref FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS translation_knowledge_import_request_service_select
  ON translation_knowledge_import_request_item;
CREATE POLICY translation_knowledge_import_request_service_select
  ON translation_knowledge_import_request_item FOR SELECT TO service_role
  USING (true);
DROP POLICY IF EXISTS translation_knowledge_import_request_service_insert
  ON translation_knowledge_import_request_item;
CREATE POLICY translation_knowledge_import_request_service_insert
  ON translation_knowledge_import_request_item FOR INSERT TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS translation_knowledge_event_service_select
  ON translation_knowledge_governance_event;
CREATE POLICY translation_knowledge_event_service_select
  ON translation_knowledge_governance_event FOR SELECT TO service_role
  USING (true);
DROP POLICY IF EXISTS translation_knowledge_event_service_insert
  ON translation_knowledge_governance_event;
CREATE POLICY translation_knowledge_event_service_insert
  ON translation_knowledge_governance_event FOR INSERT TO service_role
  WITH CHECK (true);

COMMIT;
