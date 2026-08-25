-- WiseLink 3.1 official OAuth RLS correction.
--
-- Hosted final-user requests execute as authenticated_<workspace> with
-- app.user_id set transaction-locally by nestjs-datapaas. Migration 0004
-- granted only service_role_<workspace>, so the official OAuth path could not
-- persist its pre-auth state. Keep RLS enabled and grant only operation-
-- specific access bound to the initiating Hosted actor and OAuth invariants.

BEGIN;

ALTER TABLE identity_oauth_state
  ALTER COLUMN _created_by SET DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  ALTER COLUMN _updated_by SET DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  );

ALTER TABLE identity_subject_mapping
  ALTER COLUMN _created_by SET DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  ALTER COLUMN _updated_by SET DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  );

ALTER TABLE identity_session
  ALTER COLUMN _created_by SET DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  ),
  ALTER COLUMN _updated_by SET DEFAULT (
    CASE
      WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
      ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile
    END
  );

-- 0004 exposed all three identity tables through an unconstrained service
-- policy. Official OAuth always runs in a final-user Hosted request, so those
-- broad policies are neither required nor an acceptable fallback.
DROP POLICY IF EXISTS identity_oauth_state_service
  ON identity_oauth_state;
DROP POLICY IF EXISTS identity_subject_mapping_service
  ON identity_subject_mapping;
DROP POLICY IF EXISTS identity_session_service
  ON identity_session;

-- Replay-safe replacement when a DEV migration is re-applied after review.
DROP POLICY IF EXISTS identity_oauth_state_authenticated_issue
  ON identity_oauth_state;
DROP POLICY IF EXISTS identity_oauth_state_authenticated_read
  ON identity_oauth_state;
DROP POLICY IF EXISTS identity_oauth_state_authenticated_consume
  ON identity_oauth_state;
DROP POLICY IF EXISTS identity_subject_mapping_authenticated_oauth_read
  ON identity_subject_mapping;
DROP POLICY IF EXISTS identity_session_authenticated_issue
  ON identity_session;
DROP POLICY IF EXISTS identity_session_authenticated_read
  ON identity_session;
DROP POLICY IF EXISTS identity_session_authenticated_update
  ON identity_session;

CREATE POLICY identity_oauth_state_authenticated_issue
  ON identity_oauth_state
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_setting('app.user_id', TRUE) <> ''
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND state_hash ~ '^[0-9a-f]{64}$'
    AND code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'
    AND consumed_at IS NULL
    AND expires_at > statement_timestamp()
    AND expires_at <= statement_timestamp() + interval '5 minutes'
  );

CREATE POLICY identity_oauth_state_authenticated_read
  ON identity_oauth_state
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    current_setting('app.user_id', TRUE) <> ''
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND state_hash ~ '^[0-9a-f]{64}$'
    AND code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'
    AND expires_at > statement_timestamp()
  );

CREATE POLICY identity_oauth_state_authenticated_consume
  ON identity_oauth_state
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    current_setting('app.user_id', TRUE) <> ''
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND state_hash ~ '^[0-9a-f]{64}$'
    AND code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'
    AND consumed_at IS NULL
    AND expires_at > statement_timestamp()
  )
  WITH CHECK (
    current_setting('app.user_id', TRUE) <> ''
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND state_hash ~ '^[0-9a-f]{64}$'
    AND code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'
    AND consumed_at IS NOT NULL
    AND consumed_at >= _created_at
    AND consumed_at <= statement_timestamp() + interval '5 seconds'
    AND expires_at > statement_timestamp()
  );

CREATE POLICY identity_subject_mapping_authenticated_oauth_read
  ON identity_subject_mapping
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    current_setting('app.user_id', TRUE) <> ''
    AND miaoda_user_id = current_setting('app.user_id', TRUE)
    AND status = 'ACTIVE'
  );

CREATE POLICY identity_session_authenticated_issue
  ON identity_session
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_setting('app.user_id', TRUE) <> ''
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND session_token_hash ~ '^[0-9a-f]{64}$'
    AND revision = 1
    AND revoked_at IS NULL
    AND expires_at > statement_timestamp()
    AND expires_at <= statement_timestamp() + interval '30 minutes'
    AND last_seen_at >= statement_timestamp() - interval '1 minute'
    AND last_seen_at <= statement_timestamp() + interval '5 seconds'
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping AS mapping
      WHERE mapping.id = subject_mapping_id
        AND mapping.miaoda_user_id = current_setting('app.user_id', TRUE)
        AND mapping.status = 'ACTIVE'
    )
  );

CREATE POLICY identity_session_authenticated_read
  ON identity_session
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (
    current_setting('app.user_id', TRUE) <> ''
    AND session_token_hash ~ '^[0-9a-f]{64}$'
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping AS mapping
      WHERE mapping.id = subject_mapping_id
        AND mapping.miaoda_user_id = current_setting('app.user_id', TRUE)
        AND mapping.status = 'ACTIVE'
    )
  );

CREATE POLICY identity_session_authenticated_update
  ON identity_session
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (
    current_setting('app.user_id', TRUE) <> ''
    AND session_token_hash ~ '^[0-9a-f]{64}$'
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping AS mapping
      WHERE mapping.id = subject_mapping_id
        AND mapping.miaoda_user_id = current_setting('app.user_id', TRUE)
        AND mapping.status = 'ACTIVE'
    )
  )
  WITH CHECK (
    current_setting('app.user_id', TRUE) <> ''
    AND session_token_hash ~ '^[0-9a-f]{64}$'
    AND revision > 0
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping AS mapping
      WHERE mapping.id = subject_mapping_id
        AND mapping.miaoda_user_id = current_setting('app.user_id', TRUE)
        AND mapping.status = 'ACTIVE'
    )
  );

COMMIT;
