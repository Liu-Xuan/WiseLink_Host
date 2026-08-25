-- WiseLink 3.1 isolated DEV one-time official identity mapping bootstrap.
--
-- The application supplies Feishu subject fields only after the official
-- user_info call. The Hosted database transaction supplies app.user_id.
-- This policy does not accept caller/body/header identity and does not widen
-- SELECT/UPDATE/DELETE access. Remove/disable the runtime bootstrap switch as
-- soon as the single DEV mapping and session have been proven.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uk_identity_subject_active_miaoda_app
  ON identity_subject_mapping(miaoda_user_id, expected_client_id)
  WHERE status = 'ACTIVE';

DROP POLICY IF EXISTS identity_subject_mapping_authenticated_dev_bootstrap
  ON identity_subject_mapping;

CREATE POLICY identity_subject_mapping_authenticated_dev_bootstrap
  ON identity_subject_mapping
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    current_setting('app.user_id', TRUE) <> ''
    AND miaoda_user_id = current_setting('app.user_id', TRUE)
    AND ((_created_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND ((_updated_by).user_id)::text = current_setting('app.user_id', TRUE)
    AND expected_client_id = 'cli_aadde8b579f95bc9'
    AND miaoda_tenant_id <> ''
    AND status = 'ACTIVE'
    AND revision = 1
  );

COMMIT;
