-- Persistent semantic translation work in the existing Host database.
-- Candidate content is immutable; reading selection does not adopt engineering results.
BEGIN;

CREATE TABLE IF NOT EXISTS translation_workspace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id varchar(96) NOT NULL UNIQUE,
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  document_version_id varchar(96) NOT NULL,
  package_id text NOT NULL,
  parsed_artifact_ref text NOT NULL,
  parsed_artifact_sha256 varchar(64) NOT NULL,
  target_locale varchar(32) NOT NULL,
  plan_revision integer NOT NULL DEFAULT 1,
  context_revision integer NOT NULL DEFAULT 1,
  source_plan_json text NOT NULL,
  method_version varchar(96) NOT NULL,
  active_attempt_id varchar(96),
  generation_requests_json text NOT NULL DEFAULT '[]',
  row_version integer NOT NULL DEFAULT 1,
  result_artifact_json text,
  result_manifest_json text,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN nullif(current_setting('app.user_id', true), '') IS NULL THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END
  ),
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN nullif(current_setting('app.user_id', true), '') IS NULL THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END
  ),
  CONSTRAINT uk_translation_workspace_scope UNIQUE (tenant_id, work_item_id, workspace_id),
  CONSTRAINT uk_translation_workspace_source UNIQUE (
    tenant_id, work_item_id, document_version_id, parsed_artifact_sha256, target_locale
  ),
  CONSTRAINT fk_translation_workspace_work_item FOREIGN KEY (tenant_id, work_item_id)
    REFERENCES work_item(tenant_id, work_item_id),
  CONSTRAINT fk_translation_workspace_attempt FOREIGN KEY (active_attempt_id)
    REFERENCES action_attempt(attempt_id),
  CONSTRAINT ck_translation_workspace_revisions CHECK (
    plan_revision > 0 AND context_revision > 0 AND row_version > 0
  ),
  CONSTRAINT ck_translation_workspace_source_hash CHECK (parsed_artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_translation_workspace_plan CHECK (length(btrim(source_plan_json)) > 0),
  CONSTRAINT ck_translation_workspace_result CHECK (
    (result_artifact_json IS NULL AND result_manifest_json IS NULL)
    OR (result_artifact_json IS NOT NULL AND result_manifest_json IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS translation_block_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_revision_id varchar(96) NOT NULL UNIQUE,
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  workspace_id varchar(96) NOT NULL,
  block_id varchar(96) NOT NULL,
  plan_revision integer NOT NULL,
  content_revision integer NOT NULL,
  generation_request_ref varchar(160) NOT NULL,
  origin_attempt_id varchar(96),
  author_kind varchar(24) NOT NULL,
  author_user_id varchar(255) NOT NULL,
  candidate_json text NOT NULL,
  dependencies_json text NOT NULL,
  provenance_json text NOT NULL,
  generated_at timestamptz(3),
  saved_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  check_status varchar(24) NOT NULL DEFAULT 'PENDING',
  check_json text,
  checked_at timestamptz(3),
  selected_for_reading boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile DEFAULT (
    CASE WHEN nullif(current_setting('app.user_id', true), '') IS NULL THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END
  ),
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile DEFAULT (
    CASE WHEN nullif(current_setting('app.user_id', true), '') IS NULL THEN NULL
    ELSE concat('(', current_setting('app.user_id', true), ')')::user_profile END
  ),
  CONSTRAINT fk_translation_block_workspace FOREIGN KEY (tenant_id, work_item_id, workspace_id)
    REFERENCES translation_workspace(tenant_id, work_item_id, workspace_id),
  CONSTRAINT fk_translation_block_attempt FOREIGN KEY (origin_attempt_id)
    REFERENCES action_attempt(attempt_id),
  CONSTRAINT uk_translation_block_content_revision UNIQUE (workspace_id, block_id, content_revision),
  CONSTRAINT uk_translation_block_generation UNIQUE (workspace_id, generation_request_ref, block_id),
  CONSTRAINT ck_translation_block_revisions CHECK (plan_revision > 0 AND content_revision > 0 AND row_version > 0),
  CONSTRAINT ck_translation_block_author CHECK (
    (author_kind = 'MODEL' AND origin_attempt_id IS NOT NULL)
    OR author_kind = 'ENGINEER'
  ),
  CONSTRAINT ck_translation_block_candidate CHECK (length(btrim(candidate_json)) > 0),
  CONSTRAINT ck_translation_block_check CHECK (
    (check_status = 'PENDING' AND check_json IS NULL AND checked_at IS NULL AND selected_for_reading = false)
    OR (check_status = 'CHECKED' AND check_json IS NOT NULL AND checked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_translation_block_selected
  ON translation_block_revision(workspace_id, block_id) WHERE selected_for_reading;
CREATE INDEX IF NOT EXISTS idx_translation_block_workspace
  ON translation_block_revision(tenant_id, work_item_id, workspace_id, block_id, content_revision DESC);

CREATE OR REPLACE FUNCTION translation_block_guard_content_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.block_revision_id, NEW.tenant_id, NEW.work_item_id, NEW.workspace_id,
    NEW.block_id, NEW.plan_revision, NEW.content_revision, NEW.generation_request_ref,
    NEW.origin_attempt_id, NEW.author_kind, NEW.author_user_id, NEW.candidate_json,
    NEW.dependencies_json, NEW.provenance_json, NEW.generated_at, NEW.saved_at)
    IS DISTINCT FROM
    ROW(OLD.block_revision_id, OLD.tenant_id, OLD.work_item_id, OLD.workspace_id,
    OLD.block_id, OLD.plan_revision, OLD.content_revision, OLD.generation_request_ref,
    OLD.origin_attempt_id, OLD.author_kind, OLD.author_user_id, OLD.candidate_json,
    OLD.dependencies_json, OLD.provenance_json, OLD.generated_at, OLD.saved_at)
  THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'TRANSLATION_BLOCK_CONTENT_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER translation_block_guard_content_immutable_trigger
  BEFORE UPDATE ON translation_block_revision
  FOR EACH ROW EXECUTE FUNCTION translation_block_guard_content_immutable();

ALTER TABLE translation_workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE translation_block_revision ENABLE ROW LEVEL SECURITY;

-- Follow the existing Host service-scope boundary; no anonymous policies or grants.
CREATE POLICY translation_workspace_service_select ON translation_workspace
  FOR SELECT TO service_role USING (true);
CREATE POLICY translation_workspace_service_insert ON translation_workspace
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY translation_workspace_service_update ON translation_workspace
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY translation_block_service_select ON translation_block_revision
  FOR SELECT TO service_role USING (true);
CREATE POLICY translation_block_service_insert ON translation_block_revision
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY translation_block_service_update ON translation_block_revision
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE POLICY translation_workspace_owned_read ON translation_workspace
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM work_item owned
      WHERE owned.work_item_id = translation_workspace.work_item_id
        AND owned.tenant_id = translation_workspace.tenant_id
        AND owned.requested_by_user_id = current_setting('app.user_id', true)
    ) AND EXISTS (
      SELECT 1 FROM identity_subject_mapping actor
      WHERE actor.miaoda_user_id = current_setting('app.user_id', true)
        AND actor.miaoda_tenant_id = translation_workspace.tenant_id
        AND actor.expected_client_id = 'cli_aadde8b579f95bc9'
        AND actor.status = 'ACTIVE'
    )
  );
CREATE POLICY translation_block_owned_read ON translation_block_revision
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM translation_workspace owned
      WHERE owned.workspace_id = translation_block_revision.workspace_id
        AND owned.tenant_id = translation_block_revision.tenant_id
        AND owned.work_item_id = translation_block_revision.work_item_id
    )
  );

COMMENT ON TABLE translation_workspace IS
  'Host-owned semantic translation work for one exact parsed source; ActionAttempt owns scheduling and cancellation.';
COMMENT ON TABLE translation_block_revision IS
  'Immutable candidate block bodies with separately versioned checks and one reading selection; never engineering adoption.';
COMMENT ON COLUMN translation_workspace.source_plan_json IS
  'Canonical JSON of the complete translation_source_plan.v2, including exact anchors and document context.';
COMMENT ON COLUMN translation_workspace.generation_requests_json IS
  'Host-registered bounded generation requests; superseded requests cannot select late content.';
COMMENT ON COLUMN translation_block_revision.candidate_json IS
  'Actual complete block candidate text and anchor relations; a validation log is not a candidate.';
COMMENT ON COLUMN translation_block_revision.dependencies_json IS
  'Exact source/context dependencies actually delivered for this content revision.';
COMMENT ON COLUMN translation_block_revision.provenance_json IS
  'Actual model/Skill or engineer author, originating attempt, request and available usage.';

COMMIT;
