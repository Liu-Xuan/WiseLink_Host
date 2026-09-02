-- WiseLink V1.0 R09 Hosted OpenClaw Review SELECT applicability.
--
-- The managed APaaS adapter can route raw execute statements through the
-- scoped `anon` role even when adjacent ORM reads use another pooled role.
-- The platform already grants this role table-level SELECT, while RLS remains
-- enabled. Host establishes app.user_id locally in the exact Review begin
-- statement. These permissive SELECT policies expose only the official actor
-- mapping, actor-owned WorkItem, and actor-bound Review rows needed by that
-- statement. They add no GRANT and do not widen Review writes.

BEGIN;

DROP POLICY IF EXISTS identity_subject_mapping_hosted_runtime_actor_select
  ON identity_subject_mapping;
CREATE POLICY identity_subject_mapping_hosted_runtime_actor_select
  ON identity_subject_mapping
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (
    pg_catalog.current_setting('app.user_id', true) <> ''
    AND miaoda_user_id =
      pg_catalog.current_setting('app.user_id', true)
    AND expected_client_id = 'cli_aadde8b579f95bc9'
    AND status = 'ACTIVE'
  );

DROP POLICY IF EXISTS work_item_hosted_runtime_actor_select
  ON work_item;
CREATE POLICY work_item_hosted_runtime_actor_select
  ON work_item
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (
    requested_by_user_id =
      pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id = work_item.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS review_conversation_hosted_runtime_actor_select
  ON review_conversation;
CREATE POLICY review_conversation_hosted_runtime_actor_select
  ON review_conversation
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          review_conversation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_conversation.work_item_id
        AND owned_work_item.tenant_id = review_conversation.tenant_id
        AND owned_work_item.requested_by_user_id =
          review_conversation.actor_id
    )
  );

DROP POLICY IF EXISTS review_turn_hosted_runtime_actor_select
  ON review_turn;
CREATE POLICY review_turn_hosted_runtime_actor_select
  ON review_turn
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id = review_turn.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_turn.work_item_id
        AND owned_work_item.tenant_id = review_turn.tenant_id
        AND owned_work_item.requested_by_user_id = review_turn.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        review_turn.review_conversation_id
        AND bound_conversation.tenant_id = review_turn.tenant_id
        AND bound_conversation.actor_id = review_turn.actor_id
        AND bound_conversation.work_item_id = review_turn.work_item_id
    )
  );

DROP POLICY IF EXISTS engineer_supplied_input_hosted_runtime_actor_select
  ON engineer_supplied_input;
CREATE POLICY engineer_supplied_input_hosted_runtime_actor_select
  ON engineer_supplied_input
  AS PERMISSIVE
  FOR SELECT
  TO anon
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          engineer_supplied_input.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        engineer_supplied_input.work_item_id
        AND owned_work_item.tenant_id = engineer_supplied_input.tenant_id
        AND owned_work_item.requested_by_user_id =
          engineer_supplied_input.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        engineer_supplied_input.review_conversation_id
        AND bound_conversation.tenant_id = engineer_supplied_input.tenant_id
        AND bound_conversation.actor_id = engineer_supplied_input.actor_id
        AND bound_conversation.work_item_id =
          engineer_supplied_input.work_item_id
    )
  );

COMMIT;

-- Required post-apply readback:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
-- FROM pg_catalog.pg_policies
-- WHERE policyname LIKE '%_hosted_runtime_actor_select'
--   AND to_regclass(format('%I.%I', schemaname, tablename)) =
--     to_regclass(tablename)
-- ORDER BY tablename, policyname;
--
-- Expected: exactly five PERMISSIVE SELECT policies on the scoped `anon` role.
-- No GRANT is intentionally present. The platform-managed runtime retains its
-- existing least-privilege table SELECT; no table privilege is widened.
