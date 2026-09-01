-- WiseLink V1.0 R09 Hosted OpenClaw Review SELECT applicability.
--
-- The managed Hosted runtime role is neither `authenticated` nor
-- `service_role`. It already receives only the table-level privileges needed
-- by the platform, and Host establishes app.user_id locally in the exact
-- Review begin statement. These permissive SELECT policies let that role
-- participate in the existing actor-bound row predicates without granting
-- PUBLIC any table privilege or widening Review writes.

BEGIN;

DROP POLICY IF EXISTS review_conversation_hosted_runtime_actor_select
  ON public.review_conversation;
CREATE POLICY review_conversation_hosted_runtime_actor_select
  ON public.review_conversation
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM public.identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          review_conversation.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM public.work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_conversation.work_item_id
        AND owned_work_item.tenant_id = review_conversation.tenant_id
        AND owned_work_item.requested_by_user_id =
          review_conversation.actor_id
    )
  );

DROP POLICY IF EXISTS review_turn_hosted_runtime_actor_select
  ON public.review_turn;
CREATE POLICY review_turn_hosted_runtime_actor_select
  ON public.review_turn
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM public.identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id = review_turn.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM public.work_item owned_work_item
      WHERE owned_work_item.work_item_id = review_turn.work_item_id
        AND owned_work_item.tenant_id = review_turn.tenant_id
        AND owned_work_item.requested_by_user_id = review_turn.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.review_conversation bound_conversation
      WHERE bound_conversation.review_conversation_id =
        review_turn.review_conversation_id
        AND bound_conversation.tenant_id = review_turn.tenant_id
        AND bound_conversation.actor_id = review_turn.actor_id
        AND bound_conversation.work_item_id = review_turn.work_item_id
    )
  );

DROP POLICY IF EXISTS engineer_supplied_input_hosted_runtime_actor_select
  ON public.engineer_supplied_input;
CREATE POLICY engineer_supplied_input_hosted_runtime_actor_select
  ON public.engineer_supplied_input
  AS PERMISSIVE
  FOR SELECT
  TO PUBLIC
  USING (
    actor_id = pg_catalog.current_setting('app.user_id', true)
    AND EXISTS (
      SELECT 1
      FROM public.identity_subject_mapping current_mapping
      WHERE current_mapping.miaoda_user_id =
        pg_catalog.current_setting('app.user_id', true)
        AND current_mapping.miaoda_tenant_id =
          engineer_supplied_input.tenant_id
        AND current_mapping.expected_client_id = 'cli_aadde8b579f95bc9'
        AND current_mapping.status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1
      FROM public.work_item owned_work_item
      WHERE owned_work_item.work_item_id =
        engineer_supplied_input.work_item_id
        AND owned_work_item.tenant_id = engineer_supplied_input.tenant_id
        AND owned_work_item.requested_by_user_id =
          engineer_supplied_input.actor_id
    )
    AND EXISTS (
      SELECT 1
      FROM public.review_conversation bound_conversation
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
-- WHERE schemaname = 'public'
--   AND policyname LIKE '%_hosted_runtime_actor_select'
-- ORDER BY tablename, policyname;
--
-- No GRANT is intentionally present. The platform-managed runtime must retain
-- its own least-privilege table SELECT; PUBLIC receives no table privilege.
