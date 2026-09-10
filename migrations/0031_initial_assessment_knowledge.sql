-- Bind NEW normal tasks to the exact already-authorized browser session.
-- Existing tasks remain NULL. No credential, fallback session or new OAuth scope.
BEGIN;
ALTER TABLE work_item ADD COLUMN initial_aily_session_id uuid;
ALTER TABLE work_item ADD CONSTRAINT work_item_initial_aily_session_fkey
  FOREIGN KEY (initial_aily_session_id) REFERENCES identity_session(id);

-- Initial attempts use the service executor; the WorkItem still belongs to the
-- requesting engineer. Keep existing Review/private-message policies intact.
CREATE POLICY review_aily_query_initial_read ON review_aily_query
FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true)
  AND EXISTS (
    SELECT 1 FROM action_attempt AS initial_attempt
    JOIN work_item AS initial_work ON initial_work.work_item_id = initial_attempt.work_item_id
      AND initial_work.tenant_id = initial_attempt.tenant_id
    WHERE initial_attempt.attempt_id = review_aily_query.attempt_ref
      AND initial_attempt.tenant_id = review_aily_query.tenant_id
      AND initial_attempt.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS')
      AND initial_work.requested_by_user_id = review_aily_query.actor_id
      AND initial_work.initial_aily_session_id = review_aily_query.session_id
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,sessionId}' = review_aily_query.session_id::text
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,agentId}' = review_aily_query.agent_id
      AND initial_attempt.task_envelope_json::jsonb -> 'allowedConnectors' @> '["feishu-aily-user"]'::jsonb
  )
);
CREATE POLICY review_aily_query_initial_insert ON review_aily_query
FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true)
  AND message_ref IS NULL AND remote_session_id IS NULL
  AND EXISTS (
    SELECT 1 FROM action_attempt AS initial_attempt
    JOIN work_item AS initial_work ON initial_work.work_item_id = initial_attempt.work_item_id
      AND initial_work.tenant_id = initial_attempt.tenant_id
    WHERE initial_attempt.attempt_id = review_aily_query.attempt_ref
      AND initial_attempt.tenant_id = review_aily_query.tenant_id
      AND initial_attempt.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS')
      AND initial_attempt.status = 'RUNNING'
      AND initial_work.requested_by_user_id = review_aily_query.actor_id
      AND initial_work.initial_aily_session_id = review_aily_query.session_id
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,sessionId}' = review_aily_query.session_id::text
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,agentId}' = review_aily_query.agent_id
      AND initial_attempt.task_envelope_json::jsonb -> 'allowedConnectors' @> '["feishu-aily-user"]'::jsonb
  )
);
CREATE POLICY review_aily_query_initial_update ON review_aily_query
FOR UPDATE TO service_role USING (
  actor_id = current_setting('app.user_id', true)
  AND EXISTS (
    SELECT 1 FROM action_attempt AS initial_attempt
    JOIN work_item AS initial_work ON initial_work.work_item_id = initial_attempt.work_item_id
      AND initial_work.tenant_id = initial_attempt.tenant_id
    WHERE initial_attempt.attempt_id = review_aily_query.attempt_ref
      AND initial_attempt.tenant_id = review_aily_query.tenant_id
      AND initial_attempt.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS')
      AND initial_work.requested_by_user_id = review_aily_query.actor_id
      AND initial_work.initial_aily_session_id = review_aily_query.session_id
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,sessionId}' = review_aily_query.session_id::text
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,agentId}' = review_aily_query.agent_id
      AND initial_attempt.task_envelope_json::jsonb -> 'allowedConnectors' @> '["feishu-aily-user"]'::jsonb
  )
) WITH CHECK (
  actor_id = current_setting('app.user_id', true)
  AND message_ref IS NULL
  AND EXISTS (
    SELECT 1 FROM action_attempt AS initial_attempt
    JOIN work_item AS initial_work ON initial_work.work_item_id = initial_attempt.work_item_id
      AND initial_work.tenant_id = initial_attempt.tenant_id
    WHERE initial_attempt.attempt_id = review_aily_query.attempt_ref
      AND initial_attempt.tenant_id = review_aily_query.tenant_id
      AND initial_attempt.action_type IN ('OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS')
      AND initial_work.requested_by_user_id = review_aily_query.actor_id
      AND initial_work.initial_aily_session_id = review_aily_query.session_id
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,sessionId}' = review_aily_query.session_id::text
      AND initial_attempt.task_envelope_json::jsonb #>> '{modelInput,knowledgeBinding,agentId}' = review_aily_query.agent_id
      AND initial_attempt.task_envelope_json::jsonb -> 'allowedConnectors' @> '["feishu-aily-user"]'::jsonb
  )
);
COMMIT;
