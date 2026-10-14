BEGIN;

-- The admission is the immutable actor-authored parse row, not a synthetic
-- WorkItem completion or a service assertion of source access. Only locators
-- leave this definer; all source/ACL/lease operations re-enter ordinary actor RLS.
-- Platform SQL rejects GRANT/REVOKE. PUBLIC EXECUTE remains safe because every
-- invocation first validates the actual PostgreSQL SDK service role, never a
-- caller JSON/JWT/app-role claim. No table grants or RLS policies are changed.
CREATE FUNCTION local_mineru_browser_admissions(t varchar, exact_run varchar, after_run varchar, page_limit integer)
RETURNS TABLE(tenant_id varchar,parse_run_id varchar,actor_user_id varchar,document_version_id varchar)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
  IF NOT derived_summary_sql_role_allowed(true) THEN
    RAISE EXCEPTION 'LOCAL_MINERU_SERVICE_ROLE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF t IS NULL OR btrim(t)='' OR page_limit IS NULL OR page_limit<1 OR page_limit>100
    OR (exact_run IS NOT NULL AND (exact_run !~ '^PRUN-[A-Za-z0-9-]{1,90}$' OR after_run IS NOT NULL))
    OR (after_run IS NOT NULL AND after_run !~ '^PRUN-[A-Za-z0-9-]{1,90}$') THEN
    RAISE EXCEPTION 'LOCAL_MINERU_DISPATCH_ARGUMENT_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN QUERY SELECT r.tenant_id,r.parse_run_id,r.actor_user_id,r.document_version_id
    FROM dm_document_parse_run r
    WHERE r.tenant_id=t AND (exact_run IS NULL OR r.parse_run_id=exact_run)
      AND (after_run IS NULL OR r.parse_run_id>after_run)
      AND r.source_binding->'parserInput'->>'mode'='LOCAL_MINERU_WORKER'
      AND r.source_binding->'parserInput'->'settings'->'localMineruFallbackEnabled'='true'::jsonb
      AND NOT (r.source_binding ? 'automaticWorkItem')
      AND r.source_binding->>'documentVersionId'=r.document_version_id
      AND EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_tenant_id=t
        AND m.miaoda_user_id=r.actor_user_id AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE')
      AND (exact_run IS NOT NULL OR (r.status IN ('RUNNING','STAGING')
        AND r.deadline_at>CURRENT_TIMESTAMP AND r.cancel_requested_at IS NULL AND r.error_code IS NULL
        AND (r.lease_expires_at IS NULL OR r.lease_expires_at<=CURRENT_TIMESTAMP)))
    ORDER BY r.parse_run_id LIMIT page_limit;
END $$;

COMMENT ON FUNCTION local_mineru_browser_admissions(varchar,varchar,varchar,integer) IS
  'SDK service-only metadata discovery of real browser parse admissions; no source, lease or actor authority. Exact lookup retains terminal result idempotence.';
COMMIT;
