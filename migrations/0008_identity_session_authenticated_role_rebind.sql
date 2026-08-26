-- Rebind the identity-session INSERT policy through CREATE POLICY so Miaoda
-- expands the portable `authenticated` role alias to the workspace-scoped
-- runtime role. Migration 0007 used ALTER POLICY ... TO authenticated, which
-- left the policy bound to the unscoped PostgreSQL role in online while all
-- other authenticated policies remained workspace-scoped.
--
-- The replacement is atomic and keeps every seven-day session invariant from
-- 0007 unchanged.

BEGIN;

DROP POLICY IF EXISTS identity_session_authenticated_issue
  ON identity_session;

DROP POLICY IF EXISTS identity_session_authenticated_issue_runtime
  ON identity_session;

CREATE POLICY identity_session_authenticated_issue_runtime
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
