-- JobAid problem assessment: append-only substantive work, independent of the
-- WorkItem's adopted/current revision. No new scheduler or formal decision.
BEGIN;

CREATE TABLE IF NOT EXISTS assessment_work_revision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_work_revision_id varchar(96) NOT NULL UNIQUE,
  tenant_id varchar(128) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  work_revision integer NOT NULL CHECK (work_revision > 0),
  request_id varchar(96) NOT NULL,
  action_attempt_id varchar(96) NOT NULL REFERENCES action_attempt(attempt_id),
  based_on_work_item_revision integer NOT NULL CHECK (based_on_work_item_revision > 0),
  document_version_id varchar(96) NOT NULL,
  previous_work_revision_id varchar(96),
  command_json text NOT NULL CHECK (length(btrim(command_json)) > 0),
  content_json text NOT NULL CHECK (length(btrim(content_json)) > 0),
  created_by_user_id varchar(255) NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_assessment_work_revision_number UNIQUE (work_item_id, work_revision),
  CONSTRAINT uk_assessment_work_revision_request UNIQUE (work_item_id, request_id),
  CONSTRAINT uk_assessment_work_revision_scope UNIQUE (tenant_id, work_item_id, assessment_work_revision_id),
  CONSTRAINT fk_assessment_work_revision_owner FOREIGN KEY (tenant_id, work_item_id)
    REFERENCES work_item(tenant_id, work_item_id),
  CONSTRAINT fk_assessment_work_revision_previous FOREIGN KEY (tenant_id, work_item_id, previous_work_revision_id)
    REFERENCES assessment_work_revision(tenant_id, work_item_id, assessment_work_revision_id)
);
CREATE INDEX IF NOT EXISTS idx_assessment_work_revision_attempt
  ON assessment_work_revision(action_attempt_id, work_revision DESC);
ALTER TABLE assessment_work_revision ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assessment_work_revision_actor_select ON assessment_work_revision;
CREATE POLICY assessment_work_revision_actor_select
ON assessment_work_revision FOR SELECT TO authenticated, service_role
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);

DROP POLICY IF EXISTS assessment_work_revision_hosted_candidate_insert ON assessment_work_revision;
CREATE POLICY assessment_work_revision_hosted_candidate_insert
ON assessment_work_revision FOR INSERT TO service_role
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
  AND EXISTS (
    SELECT 1 FROM action_attempt AS attempt
    WHERE attempt.attempt_id = assessment_work_revision.action_attempt_id
      AND attempt.tenant_id = assessment_work_revision.tenant_id
      AND attempt.work_item_id = assessment_work_revision.work_item_id
      AND attempt.document_version_id = assessment_work_revision.document_version_id
      AND attempt.base_revision = assessment_work_revision.based_on_work_item_revision
      AND attempt.request_origin = 'OPENCLAW_MCP_V1'
      AND attempt.action_type IN (
        'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS',
        'OPENCLAW_INTERACTIVE_REVIEW'
      )
      AND attempt.status IN ('RUNNING', 'COMMITTING')
      AND attempt.cancel_requested_at IS NULL
  )
);

COMMENT ON TABLE assessment_work_revision IS
  'Immutable JobAid problem analysis with exact sources and attempt/request identity; never formal adoption.';
COMMIT;
