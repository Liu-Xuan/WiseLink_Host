BEGIN;

-- Apply as the existing table owner in this application's verified workspace.
-- No table grant, write policy, role membership or parsing authority is added.
DO $preflight$
BEGIN
  IF current_schema() IS DISTINCT FROM 'workspace_aadkpkjef3slu'
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS setting
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = setting.relnamespace
      WHERE namespace.nspname = 'workspace_aadkpkjef3slu'
        AND setting.relname = 'canonical_model_setting'
        AND setting.relkind = 'r'
        AND setting.relrowsecurity
        AND pg_catalog.pg_get_userbyid(setting.relowner) = current_user
    )
  THEN
    RAISE EXCEPTION 'MODEL_SETTINGS_RPC_WORKSPACE_OWNER_REQUIRED';
  END IF;
END;
$preflight$;

CREATE FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(
  p_tenant_id varchar,
  p_model_ref varchar,
  p_expected_revision integer
)
RETURNS TABLE (
  tenant_id varchar,
  model_ref varchar,
  revision integer,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, workspace_aadkpkjef3slu, pg_temp
AS $function$
DECLARE
  actor_user_id text := nullif(pg_catalog.current_setting('app.user_id', true), '');
BEGIN
  -- SET LOCAL ROLE and both GUCs are supplied by the platform's trusted
  -- userContext middleware. current_user here is the function owner, not actor.
  IF pg_catalog.current_setting('role', true)
       IS DISTINCT FROM 'authenticated_workspace_aadkpkjef3slu'
    OR actor_user_id IS NULL
    OR pg_catalog.btrim(actor_user_id) = ''
    OR pg_catalog.length(actor_user_id) > 255
    OR NOT ('wiselink_model_settings_manager' = ANY (
      pg_catalog.string_to_array(
        coalesce(pg_catalog.current_setting('app.role_ids', true), ''), ','
      )
    ))
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MODEL_SETTINGS_MANAGER_REQUIRED';
  END IF;

  IF p_tenant_id IS NULL OR pg_catalog.btrim(p_tenant_id) = ''
    OR pg_catalog.length(p_tenant_id) > 128
    OR p_expected_revision IS NULL OR p_expected_revision < 0
    OR p_expected_revision >= 2147483647
    OR p_model_ref IS NULL
    -- Keep this registered-model allowlist in sync with canonical-model-catalog.ts.
    OR NOT (p_model_ref = ANY (ARRAY[
      'miaoda/minimax-m3',
      'miaoda/miaoda-model-auto',
      'miaoda/miaoda-model-flash',
      'miaoda/miaoda-auto-multimodal',
      'miaoda/glm-5.3',
      'dli/gpt-5.6-sol',
      'm3probe/minimax-m3'
    ]::varchar[]))
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MODEL_SETTINGS_INPUT_INVALID';
  END IF;

  -- Use the existing tenant helper's identical ACTIVE/client/actor predicate,
  -- fully qualified here. Do not call that legacy helper: its search_path can
  -- resolve a caller's temporary view and execute it as the definer owner.
  IF NOT EXISTS (
      SELECT 1
      FROM workspace_aadkpkjef3slu.identity_subject_mapping AS current_mapping
      WHERE current_mapping.miaoda_user_id = actor_user_id
        AND current_mapping.miaoda_tenant_id = p_tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MODEL_SETTINGS_TENANT_FORBIDDEN';
  END IF;

  IF p_expected_revision = 0 THEN
    RETURN QUERY
      INSERT INTO workspace_aadkpkjef3slu.canonical_model_setting AS setting (
        tenant_id, model_ref, revision, changed_by_user_id,
        _created_by, _updated_by
      ) VALUES (
        p_tenant_id, p_model_ref, 1, actor_user_id,
        ROW(actor_user_id)::workspace_aadkpkjef3slu.user_profile,
        ROW(actor_user_id)::workspace_aadkpkjef3slu.user_profile
      )
      ON CONFLICT DO NOTHING
      RETURNING setting.tenant_id, setting.model_ref, setting.revision, setting._updated_at;
  ELSE
    RETURN QUERY
      UPDATE workspace_aadkpkjef3slu.canonical_model_setting AS setting
      SET model_ref = p_model_ref,
          revision = p_expected_revision + 1,
          changed_by_user_id = actor_user_id,
          _updated_at = CURRENT_TIMESTAMP,
          _updated_by = ROW(actor_user_id)::workspace_aadkpkjef3slu.user_profile
      WHERE setting.tenant_id = p_tenant_id AND setting.revision = p_expected_revision
      RETURNING setting.tenant_id, setting.model_ref, setting.revision, setting._updated_at;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(
  varchar, varchar, integer
) FROM PUBLIC, anon_workspace_aadkpkjef3slu, service_role_workspace_aadkpkjef3slu;
GRANT EXECUTE ON FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(
  varchar, varchar, integer
) TO authenticated_workspace_aadkpkjef3slu;

-- Fail atomically if an unexpected default privilege gave another role access.
DO $acl$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS rpc,
      LATERAL pg_catalog.aclexplode(coalesce(rpc.proacl, pg_catalog.acldefault('f', rpc.proowner))) AS acl
    WHERE rpc.oid = 'workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(varchar,varchar,integer)'::regprocedure
      AND acl.grantee NOT IN (
        rpc.proowner,
        'authenticated_workspace_aadkpkjef3slu'::regrole::oid
      )
  ) THEN
    RAISE EXCEPTION 'MODEL_SETTINGS_RPC_UNEXPECTED_EXECUTE_GRANT';
  END IF;
END;
$acl$;

COMMIT;
