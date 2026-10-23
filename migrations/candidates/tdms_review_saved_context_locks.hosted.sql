-- Prepared local candidate only. No production DDL is executed by this change.
-- PostgreSQL row marks also require UPDATE RLS. Reuse the existing 0024
-- lock-only pattern for the exact roles below; never combine false CHECK with
-- another applicable permissive UPDATE/ALL policy. Recheck a fresh catalog
-- before any separately authorized deployment.
BEGIN;

DO $$
DECLARE target record;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('review_conversation','service_role_workspace_aadkpkjef3slu','review_conversation_tdms_review_lock'),
    ('identity_subject_mapping','service_role_workspace_aadkpkjef3slu','identity_subject_tdms_reader_lock'),
    ('identity_subject_mapping','authenticated_workspace_aadkpkjef3slu','identity_subject_tdms_reader_lock'),
    ('assessment_work_revision','service_role_workspace_aadkpkjef3slu','assessment_work_tdms_review_lock')
  ) AS targets(table_name,role_name,policy_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=target.role_name)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
        WHERE oid=to_regclass(target.table_name) AND relrowsecurity)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
        WHERE to_regclass(format('%I.%I',p.schemaname,p.tablename))=to_regclass(target.table_name)
          AND p.cmd IN ('UPDATE','ALL') AND p.permissive='PERMISSIVE'
          AND NOT (p.policyname=target.policy_name AND p.cmd='UPDATE' AND p.with_check='false')
          AND EXISTS (SELECT 1 FROM unnest(p.roles) r(role_name)
            LEFT JOIN pg_catalog.pg_roles concrete ON concrete.rolname=r.role_name
            WHERE r.role_name='public' OR (concrete.oid IS NOT NULL AND
              pg_catalog.pg_has_role(target.role_name,concrete.oid,'USAGE'))))
    THEN RAISE EXCEPTION 'TDMS_REVIEW_LOCK_POLICY_PRECONDITION_FAILED: %.%',target.table_name,target.role_name;
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS review_conversation_tdms_review_lock ON review_conversation;
CREATE POLICY review_conversation_tdms_review_lock ON review_conversation
FOR UPDATE TO service_role_workspace_aadkpkjef3slu
USING (
  actor_id=current_setting('app.user_id',true)
  AND current_setting('app.user_id',true) NOT IN ('','-1')
  AND EXISTS (SELECT 1 FROM identity_subject_mapping m WHERE m.miaoda_user_id=review_conversation.actor_id
    AND m.miaoda_tenant_id=review_conversation.tenant_id AND m.expected_client_id='cli_aadde8b579f95bc9' AND m.status='ACTIVE')
  AND EXISTS (SELECT 1 FROM work_item w WHERE w.work_item_id=review_conversation.work_item_id
    AND w.tenant_id=review_conversation.tenant_id AND w.requested_by_user_id=review_conversation.actor_id)
) WITH CHECK (false);

DROP POLICY IF EXISTS identity_subject_tdms_reader_lock ON identity_subject_mapping;
CREATE POLICY identity_subject_tdms_reader_lock ON identity_subject_mapping
FOR UPDATE TO service_role_workspace_aadkpkjef3slu,authenticated_workspace_aadkpkjef3slu
USING (
  miaoda_user_id=current_setting('app.user_id',true)
  AND current_setting('app.user_id',true) NOT IN ('','-1')
  AND miaoda_tenant_id<>'' AND expected_client_id='cli_aadde8b579f95bc9' AND status='ACTIVE'
) WITH CHECK (false);

DROP POLICY IF EXISTS assessment_work_tdms_review_lock ON assessment_work_revision;
CREATE POLICY assessment_work_tdms_review_lock ON assessment_work_revision
FOR UPDATE TO service_role_workspace_aadkpkjef3slu
USING (
  engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id,work_item_id)
  AND created_by_user_id=current_setting('app.user_id',true)
) WITH CHECK (false);

COMMIT;
