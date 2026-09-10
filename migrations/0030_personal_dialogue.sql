-- Personal cross-object dialogue. Existing review turns and attempts are retained.
BEGIN;

CREATE TABLE dialogue_thread (
  thread_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar(255) NOT NULL,
  actor_id varchar(255) NOT NULL,
  request_key varchar(200) NOT NULL,
  request_json text NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  audience varchar(16) NOT NULL DEFAULT 'PRIVATE' CHECK (audience = 'PRIVATE'),
  focus_json text NOT NULL DEFAULT '[]',
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile,
  UNIQUE (tenant_id, actor_id, request_key),
  UNIQUE (tenant_id, actor_id, thread_ref)
);
ALTER TABLE dialogue_thread ENABLE ROW LEVEL SECURITY;
CREATE POLICY dialogue_thread_read ON dialogue_thread FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
);
CREATE POLICY dialogue_thread_insert ON dialogue_thread FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
);
CREATE POLICY dialogue_thread_update ON dialogue_thread FOR UPDATE TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
) WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
);
CREATE POLICY dialogue_thread_delete ON dialogue_thread FOR DELETE TO service_role USING (false);

CREATE TABLE dialogue_message (
  message_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_ref uuid NOT NULL,
  tenant_id varchar(255) NOT NULL,
  actor_id varchar(255) NOT NULL,
  request_key varchar(200) NOT NULL,
  thread_revision integer NOT NULL CHECK (thread_revision > 0),
  user_text text NOT NULL CHECK (length(btrim(user_text)) > 0),
  origin varchar(32) NOT NULL CHECK (origin IN ('HOST','FEISHU_EXCERPT')),
  origin_json text NOT NULL DEFAULT '{}',
  focus_json text NOT NULL DEFAULT '[]',
  context_json text NOT NULL DEFAULT '{}',
  purpose varchar(32) NOT NULL CHECK (purpose IN ('CHAT','CONTRIBUTION_ONLY')),
  executor varchar(16) NOT NULL CHECK (executor IN ('AILY','NONE')),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile,
  UNIQUE (thread_ref, request_key),
  UNIQUE (thread_ref, thread_revision),
  UNIQUE (tenant_id, actor_id, message_ref),
  UNIQUE (tenant_id, actor_id, thread_ref, message_ref),
  FOREIGN KEY (tenant_id, actor_id, thread_ref) REFERENCES dialogue_thread(tenant_id, actor_id, thread_ref),
  CHECK ((purpose = 'CHAT' AND executor = 'AILY') OR (purpose = 'CONTRIBUTION_ONLY' AND executor = 'NONE'))
);
CREATE INDEX idx_dialogue_message_thread ON dialogue_message(thread_ref, _created_at, message_ref);
ALTER TABLE dialogue_message ENABLE ROW LEVEL SECURITY;
CREATE POLICY dialogue_message_read ON dialogue_message FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
);
CREATE POLICY dialogue_message_insert ON dialogue_message FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
);
CREATE POLICY dialogue_message_update ON dialogue_message FOR UPDATE TO service_role USING (false) WITH CHECK (false);
CREATE POLICY dialogue_message_delete ON dialogue_message FOR DELETE TO service_role USING (false);

CREATE TABLE discussion_contribution (
  contribution_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_ref uuid NOT NULL,
  message_ref uuid NOT NULL,
  tenant_id varchar(255) NOT NULL,
  actor_id varchar(255) NOT NULL,
  request_key varchar(200) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_part varchar(16) NOT NULL CHECK (source_part IN ('USER','ASSISTANT')),
  selected_text text NOT NULL CHECK (length(btrim(selected_text)) > 0),
  selection_json text NOT NULL,
  kind varchar(32) NOT NULL CHECK (kind IN ('QUESTION','HYPOTHESIS','CORRECTION','CONSTRAINT','CLARIFICATION')),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','WITHDRAWN')),
  audience varchar(16) NOT NULL DEFAULT 'PRIVATE' CHECK (audience = 'PRIVATE'),
  supersedes_ref uuid REFERENCES discussion_contribution(contribution_ref),
  withdraw_request_key varchar(200),
  used_by_json text NOT NULL DEFAULT '[]',
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile,
  UNIQUE (thread_ref, request_key),
  FOREIGN KEY (tenant_id, actor_id, thread_ref) REFERENCES dialogue_thread(tenant_id, actor_id, thread_ref),
  FOREIGN KEY (tenant_id, actor_id, thread_ref, message_ref) REFERENCES dialogue_message(tenant_id, actor_id, thread_ref, message_ref),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_item(tenant_id, work_item_id)
);
CREATE INDEX idx_discussion_contribution_target ON discussion_contribution(tenant_id, actor_id, work_item_id, status);
ALTER TABLE discussion_contribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY discussion_contribution_read ON discussion_contribution FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);
CREATE POLICY discussion_contribution_insert ON discussion_contribution FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);
CREATE POLICY discussion_contribution_update ON discussion_contribution FOR UPDATE TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
) WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);
CREATE POLICY discussion_contribution_delete ON discussion_contribution FOR DELETE TO service_role USING (false);

CREATE TABLE dialogue_assessment_request (
  request_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_ref uuid NOT NULL,
  tenant_id varchar(255) NOT NULL,
  actor_id varchar(255) NOT NULL,
  request_key varchar(200) NOT NULL,
  work_item_id varchar(96) NOT NULL,
  request_json text NOT NULL,
  input_json text NOT NULL,
  user_message text NOT NULL,
  review_conversation_id varchar(96) NOT NULL REFERENCES review_conversation(review_conversation_id),
  review_turn_id varchar(96) REFERENCES review_turn(review_turn_id),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_by user_profile,
  UNIQUE (thread_ref, request_key),
  FOREIGN KEY (tenant_id, actor_id, thread_ref) REFERENCES dialogue_thread(tenant_id, actor_id, thread_ref),
  FOREIGN KEY (tenant_id, work_item_id) REFERENCES work_item(tenant_id, work_item_id)
);
ALTER TABLE dialogue_assessment_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY dialogue_assessment_request_read ON dialogue_assessment_request FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);
CREATE POLICY dialogue_assessment_request_insert ON dialogue_assessment_request FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);
CREATE POLICY dialogue_assessment_request_update ON dialogue_assessment_request FOR UPDATE TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
) WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
);
CREATE POLICY dialogue_assessment_request_delete ON dialogue_assessment_request FOR DELETE TO service_role USING (false);
COMMENT ON TABLE dialogue_assessment_request IS 'Explicit user selection frozen before requesting the existing review executor; not adoption.';

ALTER TABLE review_aily_query ALTER COLUMN attempt_ref DROP NOT NULL;
ALTER TABLE review_aily_query ADD COLUMN message_ref uuid REFERENCES dialogue_message(message_ref);
ALTER TABLE review_aily_query ADD COLUMN remote_session_id varchar(96);
ALTER TABLE review_aily_query ADD CONSTRAINT review_aily_query_subject CHECK ((attempt_ref IS NOT NULL) <> (message_ref IS NOT NULL));
ALTER TABLE review_aily_query ADD CONSTRAINT review_aily_query_message_unique UNIQUE (message_ref);
CREATE UNIQUE INDEX review_aily_query_remote_active ON review_aily_query(tenant_id, actor_id, agent_id, remote_session_id)
  WHERE remote_session_id IS NOT NULL AND status IN ('STARTING','RUNNING','UNKNOWN');
-- Add an alternative message-bound branch; the old attempt policies remain.
CREATE POLICY review_aily_query_message_read ON review_aily_query FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND attempt_ref IS NULL AND EXISTS (SELECT 1 FROM dialogue_message m WHERE m.message_ref = review_aily_query.message_ref
    AND m.tenant_id = review_aily_query.tenant_id AND m.actor_id = review_aily_query.actor_id AND m.purpose = 'CHAT' AND m.executor = 'AILY')
);
CREATE POLICY review_aily_query_message_insert ON review_aily_query FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND attempt_ref IS NULL AND EXISTS (SELECT 1 FROM dialogue_message m WHERE m.message_ref = review_aily_query.message_ref
    AND m.tenant_id = review_aily_query.tenant_id AND m.actor_id = review_aily_query.actor_id AND m.purpose = 'CHAT' AND m.executor = 'AILY'
    AND m.request_key = review_aily_query.request_key)
);
CREATE POLICY review_aily_query_message_update ON review_aily_query FOR UPDATE TO service_role USING (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND attempt_ref IS NULL AND EXISTS (SELECT 1 FROM dialogue_message m WHERE m.message_ref = review_aily_query.message_ref
    AND m.tenant_id = review_aily_query.tenant_id AND m.actor_id = review_aily_query.actor_id AND m.purpose = 'CHAT' AND m.executor = 'AILY')
) WITH CHECK (
  actor_id = current_setting('app.user_id', true) AND engineering_matter_actor_has_tenant(tenant_id)
  AND attempt_ref IS NULL AND EXISTS (SELECT 1 FROM dialogue_message m WHERE m.message_ref = review_aily_query.message_ref
    AND m.tenant_id = review_aily_query.tenant_id AND m.actor_id = review_aily_query.actor_id AND m.purpose = 'CHAT' AND m.executor = 'AILY')
);
COMMENT ON TABLE dialogue_thread IS 'Personal dialogue across explicitly authorized work items; not a shared model session or assessment.';
COMMENT ON TABLE dialogue_message IS 'Immutable public user input or explicitly submitted excerpt. Public Aily response remains in review_aily_query.';
COMMENT ON TABLE discussion_contribution IS 'Versioned private use of an exact message selection; withdrawal and supersession never rewrite assessment history.';
COMMENT ON COLUMN review_aily_query.remote_session_id IS 'Aily agent session ID; distinct from Host identity_session UUID.';
COMMIT;
