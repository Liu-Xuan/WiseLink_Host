-- REVIEW CANDIDATE ONLY. Root owns migration preparation and deployment.
-- 0026 currently admits only OPENCLAW_MCP_V1 + three known leased actions in
-- RUNNING/COMMITTING. A manual producer cannot use that policy or fake a lease.
-- Add one disjoint INSERT branch; do not replace the original 0026 policy,
-- grant roles, change a runtime fence, or create a second work/audit store.
BEGIN;
DO $$
BEGIN
  IF to_regclass('assessment_work_revision') IS NULL
      OR to_regclass('action_attempt') IS NULL
      OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname=current_schema()
        AND tablename='assessment_work_revision'
        AND policyname='assessment_work_revision_hosted_candidate_insert') THEN
    RAISE EXCEPTION 'JOBAID_MANUAL_CORRECTION_ORIGINAL_POLICY_REQUIRED';
  END IF;
END;
$$;
CREATE POLICY assessment_work_revision_manual_correction_insert
ON assessment_work_revision FOR INSERT TO service_role
WITH CHECK (
  created_by_user_id = current_setting('app.user_id', true)
  AND engineering_matter_actor_has_tenant(tenant_id)
  AND engineering_matter_work_item_owned_by_actor(tenant_id, work_item_id)
  AND EXISTS (
    SELECT 1 FROM action_attempt a JOIN work_item w
      ON w.tenant_id=a.tenant_id AND w.work_item_id=a.work_item_id
    JOIN assessment_work_revision b
      ON b.tenant_id=assessment_work_revision.tenant_id
      AND b.work_item_id=assessment_work_revision.work_item_id
      AND b.assessment_work_revision_id=assessment_work_revision.previous_work_revision_id
    WHERE a.attempt_id=assessment_work_revision.action_attempt_id
      AND a.subject_kind='WORK_ITEM' AND a.matter_id IS NULL AND a.matter_revision_id IS NULL
      AND a.action_type='HOST_JOBAID_MANUAL_CORRECTION'
      AND a.request_origin='HOST_BROWSER_CORRECTION' AND a.status='COMMITTING'
      AND a.actor_user_id=assessment_work_revision.created_by_user_id
      AND a.tenant_id=assessment_work_revision.tenant_id
      AND a.work_item_id=assessment_work_revision.work_item_id
      AND a.document_version_id=assessment_work_revision.document_version_id
      AND w.requested_by_user_id=a.actor_user_id
      AND w.document_version_id=a.document_version_id
      AND w.revision=a.base_revision AND a.input_revision=a.base_revision
      AND a.base_revision=assessment_work_revision.based_on_work_item_revision
      AND a.trigger_request_id=assessment_work_revision.request_id
      AND a.cancel_requested_at IS NULL
      AND a.lease_owner IS NULL AND a.lease_token IS NULL AND a.lease_expires_at IS NULL
      AND a.lease_generation=0 AND a.lease_slot IS NULL
      AND a.task_envelope_json IS NULL AND a.execution_model_json IS NULL
      AND a.result_envelope_json IS NULL
      AND a.review_activity_json::jsonb->>'schemaVersion'='wiselink.jobaid-manual-correction-execution.v1'
      AND a.review_activity_json::jsonb->>'executionKind'='HOST_MANUAL_CORRECTION'
      AND a.review_activity_json::jsonb->'modelRequests'='0'::jsonb
      AND a.review_activity_json::jsonb->'semanticReanalysisPerformed'='false'::jsonb
      AND a.review_activity_json::jsonb->'request'=assessment_work_revision.command_json::jsonb
      AND a.review_activity_json::jsonb->'request'->>'schemaVersion'='wiselink.jobaid-work-correction.v1'
      AND a.review_activity_json::jsonb->'request'->>'requestId'=a.trigger_request_id
      AND a.review_activity_json::jsonb->'request'->>'baseWorkRef'=b.assessment_work_revision_id
      AND (a.review_activity_json::jsonb->'request'->>'baseWorkRevision')::integer=b.work_revision
      AND (a.review_activity_json::jsonb->'request'->>'expectedWorkItemRevision')::integer=w.revision
      AND b.created_by_user_id=a.actor_user_id AND b.document_version_id=a.document_version_id
      AND b.work_revision+1=assessment_work_revision.work_revision
      AND NOT EXISTS (SELECT 1 FROM assessment_work_revision n
        WHERE n.tenant_id=b.tenant_id AND n.work_item_id=b.work_item_id AND n.work_revision>b.work_revision)
  )
);
COMMIT;
