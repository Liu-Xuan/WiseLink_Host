-- Align the authenticated Host session issuance policy with the fixed
-- seven-day absolute TTL used by the application. All actor, mapping, token,
-- revision, revocation, and timing checks remain unchanged.

BEGIN;

ALTER POLICY identity_session_authenticated_issue
  ON identity_session
  TO authenticated
  WITH CHECK (
    current_setting('app.user_id', TRUE) <> ''
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND session_token_hash ~ '^[0-9a-f]{64}$'
    AND revision = 1
    AND revoked_at IS NULL
    AND expires_at > statement_timestamp()
    AND expires_at <= statement_timestamp() + interval '7 days'
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

COMMIT;
