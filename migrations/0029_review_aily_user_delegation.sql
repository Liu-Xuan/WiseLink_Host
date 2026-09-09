-- Short-lived, session-bound Aily user delegation and durable read-only queries.
-- No bearer token is stored in plaintext or exposed to the model/browser.
BEGIN;
ALTER TABLE identity_session ADD COLUMN aily_access_token_sealed text;
ALTER TABLE identity_session ADD COLUMN aily_access_token_expires_at timestamptz(3);

CREATE POLICY identity_session_hosted_aily_read ON identity_session
FOR SELECT TO service_role USING (
  revoked_at IS NULL AND expires_at > statement_timestamp()
  AND aily_access_token_expires_at > statement_timestamp()
  AND EXISTS (
    SELECT 1 FROM identity_subject_mapping AS mapping
    WHERE mapping.id = subject_mapping_id
      AND mapping.miaoda_user_id = current_setting('app.user_id', true)
      AND mapping.status = 'ACTIVE'
  )
);

CREATE TABLE review_aily_query (
  query_ref uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_ref varchar(96) NOT NULL REFERENCES action_attempt(attempt_id),
  tenant_id varchar(255) NOT NULL,
  actor_id varchar(255) NOT NULL,
  session_id uuid NOT NULL REFERENCES identity_session(id),
  agent_id varchar(96) NOT NULL,
  request_key varchar(200) NOT NULL,
  query_text text NOT NULL,
  chat_id varchar(96),
  status varchar(32) NOT NULL DEFAULT 'STARTING',
  answer_text text,
  error_code varchar(96),
  _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _created_by user_profile,
  _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  _updated_by user_profile,
  CONSTRAINT review_aily_query_attempt_request UNIQUE(attempt_ref, request_key),
  CONSTRAINT review_aily_query_status CHECK(status IN ('STARTING','RUNNING','COMPLETED','FAILED','UNKNOWN'))
);
ALTER TABLE review_aily_query ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_aily_query_hosted_read ON review_aily_query FOR SELECT TO service_role USING (
  actor_id = current_setting('app.user_id', true)
  AND EXISTS (SELECT 1 FROM action_attempt AS attempt
    WHERE attempt.attempt_id = review_aily_query.attempt_ref AND attempt.actor_user_id = review_aily_query.actor_id
      AND attempt.tenant_id = review_aily_query.tenant_id AND attempt.action_type = 'OPENCLAW_INTERACTIVE_REVIEW')
);
CREATE POLICY review_aily_query_hosted_insert ON review_aily_query FOR INSERT TO service_role WITH CHECK (
  actor_id = current_setting('app.user_id', true)
  AND EXISTS (SELECT 1 FROM action_attempt AS attempt
    WHERE attempt.attempt_id = review_aily_query.attempt_ref AND attempt.actor_user_id = review_aily_query.actor_id
      AND attempt.tenant_id = review_aily_query.tenant_id AND attempt.action_type = 'OPENCLAW_INTERACTIVE_REVIEW')
);
CREATE POLICY review_aily_query_hosted_update ON review_aily_query FOR UPDATE TO service_role USING (
  actor_id = current_setting('app.user_id', true)
  AND EXISTS (SELECT 1 FROM action_attempt AS attempt
    WHERE attempt.attempt_id = review_aily_query.attempt_ref AND attempt.actor_user_id = review_aily_query.actor_id
      AND attempt.tenant_id = review_aily_query.tenant_id AND attempt.action_type = 'OPENCLAW_INTERACTIVE_REVIEW')
) WITH CHECK (
  actor_id = current_setting('app.user_id', true)
  AND EXISTS (SELECT 1 FROM action_attempt AS attempt
    WHERE attempt.attempt_id = review_aily_query.attempt_ref AND attempt.actor_user_id = review_aily_query.actor_id
      AND attempt.tenant_id = review_aily_query.tenant_id AND attempt.action_type = 'OPENCLAW_INTERACTIVE_REVIEW')
);
COMMIT;
