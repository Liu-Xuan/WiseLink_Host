-- TEST FIXTURE ONLY: exact offline renderer output for explicit synthetic T/C.
-- Renderer SHA256 80c10e13c0e7d8f838298b33aea7773b3bdb7a540a0c27a933da7da58ae4ff5e
-- This legacy driver keeps reduced identity tables and local_native_scope;
-- it is not evidence for the complete production identity or nine-table RLS.
-- This is profile consistency, not a Gateway tenant/app or Source grant.
-- identity_subject_mapping retains its existing RLS, including self-bootstrap.
CREATE FUNCTION workspace_aadkpkjef3slu.tdms_act_bound_identity(target_tenant text, target_client text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $tdms_bound_identity$
 SELECT (current_user IN ('authenticated_workspace_aadkpkjef3slu','service_role_workspace_aadkpkjef3slu')
  AND target_tenant='tenant-a' AND target_client='synthetic-client'
  AND NULLIF(pg_catalog.current_setting('app.user_id',true),'') IS NOT NULL
  AND (SELECT count(*)=1 AND bool_and(m.miaoda_tenant_id::text=target_tenant)
   FROM workspace_aadkpkjef3slu.identity_subject_mapping m
   WHERE m.miaoda_user_id::text=pg_catalog.current_setting('app.user_id',true)
    AND m.expected_client_id::text=target_client AND m.status::text='ACTIVE')) IS TRUE
$tdms_bound_identity$;
