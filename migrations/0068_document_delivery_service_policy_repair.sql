-- C199 correction for 17b dev after 0067 C198. The platform rewrote the
-- generic service_role target to the exact workspace service role, causing
-- its RESTRICTIVE false policy to block the intended SELECT and UPDATE.
-- Apply after 0067 where that policy exists. The fixed 0067 omits it, so
-- this correction is also safe to run after the fixed migration on online.
BEGIN;
DO $$
BEGIN
  IF current_schema() IS DISTINCT FROM 'workspace_aadkpkjef3slu'
      OR to_regclass('workspace_aadkpkjef3slu.auto_document_delivery_authorization') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_roles
        WHERE rolname='service_role_workspace_aadkpkjef3slu'
          AND NOT rolsuper AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'DOCUMENT_DELIVERY_APP_SCHEMA_OR_ROLE_MISMATCH'
      USING ERRCODE='42501';
  END IF;
END;
$$;
DROP POLICY IF EXISTS auto_document_delivery_no_generic_service
  ON auto_document_delivery_authorization;
COMMIT;
