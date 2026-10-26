BEGIN;

-- Number 0084 avoids the already-prepared CHAT migrations 0082/0083.
-- Apply as the existing table owner, then use the official app release.
-- This draft is unexecuted and does not depend on the CHAT objects.
-- No table grant, write policy, role membership or parsing authority is added.
-- The platform manages function ACLs; authorization is enforced inside the RPC.
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

-- DRAFT ONLY: not executed. Regenerate schema.ts from the authorized dev DB
-- after this migration is accepted. Existing three-argument RPC is retained
-- for the current Host; no model budget or request is silently initialized.
ALTER TABLE workspace_aadkpkjef3slu.canonical_model_setting
  ADD COLUMN output_budgets_json jsonb DEFAULT '{}'::jsonb,
  ADD CONSTRAINT canonical_model_setting_output_budgets_object
    CHECK (pg_catalog.jsonb_typeof(output_budgets_json) = 'object');

-- Online already has a settings row. Keep the new column nullable for the
-- platform's additive release; SQL NULL means no configured model budgets.
-- Agent admission still requires an explicitly saved positive model budget.
COMMENT ON COLUMN workspace_aadkpkjef3slu.canonical_model_setting.output_budgets_json
  IS '@type { Record<string, number> }';

CREATE FUNCTION workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set_with_output_budget(
  p_tenant_id varchar,
  p_model_ref varchar,
  p_expected_revision integer,
  p_max_output_tokens bigint DEFAULT NULL
)
RETURNS TABLE (
  tenant_id varchar,
  model_ref varchar,
  revision integer,
  updated_at timestamptz,
  output_budgets_json jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, workspace_aadkpkjef3slu, pg_temp
AS $function$
DECLARE
  actor_user_id text;
BEGIN
  -- Platform default ACLs allow other roles to invoke functions. Reject those
  -- roles first, before actor/manager processing or any table access. The role
  -- GUC retains SET LOCAL ROLE inside SECURITY DEFINER; current_user is owner.
  IF pg_catalog.current_setting('role', true)
       IS DISTINCT FROM 'authenticated_workspace_aadkpkjef3slu'
  THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MODEL_SETTINGS_MANAGER_REQUIRED';
  END IF;

  -- SET LOCAL ROLE and both GUCs come from trusted platform userContext.
  actor_user_id := nullif(pg_catalog.current_setting('app.user_id', true), '');
  IF actor_user_id IS NULL
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

  IF p_max_output_tokens IS NOT NULL AND
      (p_max_output_tokens < 1 OR p_max_output_tokens > 9007199254740991)
  THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MODEL_OUTPUT_BUDGET_INPUT_INVALID';
  END IF;

  IF p_expected_revision = 0 THEN
    RETURN QUERY
      INSERT INTO workspace_aadkpkjef3slu.canonical_model_setting AS setting (
        tenant_id, model_ref, revision, changed_by_user_id, output_budgets_json,
        _created_by, _updated_by
      ) VALUES (
        p_tenant_id, p_model_ref, 1, actor_user_id,
        CASE WHEN p_max_output_tokens IS NULL THEN '{}'::jsonb
             ELSE pg_catalog.jsonb_build_object(p_model_ref, p_max_output_tokens) END,
        ROW(actor_user_id)::workspace_aadkpkjef3slu.user_profile,
        ROW(actor_user_id)::workspace_aadkpkjef3slu.user_profile
      )
      ON CONFLICT DO NOTHING
      RETURNING setting.tenant_id, setting.model_ref, setting.revision, setting._updated_at, setting.output_budgets_json;
  ELSE
    RETURN QUERY
      UPDATE workspace_aadkpkjef3slu.canonical_model_setting AS setting
      SET model_ref = p_model_ref,
          revision = p_expected_revision + 1,
          changed_by_user_id = actor_user_id,
          output_budgets_json = CASE WHEN p_max_output_tokens IS NULL
            THEN coalesce(setting.output_budgets_json, '{}'::jsonb)
            ELSE pg_catalog.jsonb_set(coalesce(setting.output_budgets_json, '{}'::jsonb),
              ARRAY[p_model_ref]::text[], pg_catalog.to_jsonb(p_max_output_tokens), true) END,
          _updated_at = CURRENT_TIMESTAMP,
          _updated_by = ROW(actor_user_id)::workspace_aadkpkjef3slu.user_profile
      WHERE setting.tenant_id = p_tenant_id AND setting.revision = p_expected_revision
      RETURNING setting.tenant_id, setting.model_ref, setting.revision, setting._updated_at, setting.output_budgets_json;
  END IF;
END;
$function$;

COMMIT;
