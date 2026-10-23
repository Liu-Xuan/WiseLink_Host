import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import { canonical, object } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
import { assertTdmsRuntimeTaskContext, type TdmsRuntimeTaskBinding } from './tdms-runtime-reader.port';
import { assertTdmsReviewRuntimeContext } from '../canonical-host/tdms-review-saved-context';

/** Historical provenance only. This decoder never authenticates a current caller
 * or revives a lease. Only finite metadata paths leave PostgreSQL; journals and
 * saved/turn/native bodies stay behind the current caller's own-approval gate. */
export async function storedTdmsRuntimeContext(database: PostgresJsDatabase, input: {
  taskContextRef: string;
  tenantId: string;
  workItemId?: string;
  documentVersionId?: string;
  actorUserId?: string;
}) {
  const [row] = await database.execute<{
    id:string; attemptId:string; actionType:string; tenantId:string; workItemId:string;
    documentVersionId:string; actorUserId:string; owner:string; inputRevision:number;
    taskInputHash:string; inputHash:string; taskType:string; metadata:unknown;
  }>(sql`SELECT a.id,a.attempt_id AS "attemptId",a.action_type AS "actionType",
    a.tenant_id AS "tenantId",a.work_item_id AS "workItemId",a.document_version_id AS "documentVersionId",
    a.actor_user_id AS "actorUserId",a.input_revision AS "inputRevision",a.task_input_hash AS "taskInputHash",
    a.task_envelope_json::jsonb->>'inputHash' AS "inputHash",
    a.task_envelope_json::jsonb->>'taskType' AS "taskType",w.requested_by_user_id AS owner,
    jsonb_build_object(
      'ordinary',a.task_envelope_json::jsonb#>'{modelInput,tdmsContext}',
      'ordinaryOwner',a.task_envelope_json::jsonb#>'{modelInput,actorUserId}',
      'rootReviewAddon',a.task_envelope_json::jsonb#>'{modelInput,tdmsReviewContext}',
      'reviewSchema',a.task_envelope_json::jsonb#>'{modelInput,schemaVersion}',
      'reviewPurpose',a.task_envelope_json::jsonb#>'{modelInput,context,purpose}',
      'reviewConversationRef',a.task_envelope_json::jsonb#>'{modelInput,reviewConversationRef}',
      'reviewTurnRef',a.task_envelope_json::jsonb#>'{modelInput,reviewTurnRef}',
      'requestId',a.task_envelope_json::jsonb#>'{modelInput,requestId}',
      'inputRevision',a.task_envelope_json::jsonb#>'{modelInput,inputRevision}',
      'reviewOwner',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,actorUserId}',
      'reviewModelPurpose',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,modelInput,purpose}',
      'reviewOrdinary',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsContext}',
      'reviewOrdinaryModel',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,modelInput,tdmsContext}',
      'reviewAddon',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext}',
      'reviewModelAddon',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,modelInput,tdmsReviewContext}',
      'contextAddon',a.task_envelope_json::jsonb#>'{modelInput,context,problemAssessment,tdmsReviewContext}',
      'previousWorkRef',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,previousWork,workRevisionRef}',
      'previousWorkRevision',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,previousWork,workRevision}',
      'expectedWorkRevision',a.task_envelope_json::jsonb#>'{modelInput,jobAidContext,modelInput,expectedWorkRevision}',
      'successorTurnRef',a.task_envelope_json::jsonb#>'{modelInput,successorReviewTurnRef}',
      'successorBinding',a.task_envelope_json::jsonb#>'{modelInput,successorOverallBinding}',
      'overallPreviousRef',a.task_envelope_json::jsonb#>'{modelInput,previousWork,workRevisionRef}',
      'overallPreviousRevision',a.task_envelope_json::jsonb#>'{modelInput,previousWork,workRevision}') AS metadata
    FROM action_attempt a JOIN work_item w ON w.tenant_id=a.tenant_id AND w.work_item_id=a.work_item_id
      AND w.document_version_id=a.document_version_id
    WHERE a.tenant_id=${input.tenantId} AND a.operation_ref=${input.taskContextRef}
      ${input.workItemId ? sql`AND a.work_item_id=${input.workItemId}` : sql``}
      ${input.documentVersionId ? sql`AND a.document_version_id=${input.documentVersionId}` : sql``}`);
  if(!row||!row.owner||row.owner.startsWith('service:')||(input.actorUserId&&input.actorUserId!==row.owner)) invalid();
  const m=object(decode(row.metadata));
  let context;
  if(row.actionType==='OPENCLAW_INTERACTIVE_REVIEW') {
    const addon=assertTdmsReviewRuntimeContext(m.reviewAddon);
    if(!row.taskInputHash||row.inputHash!==row.taskInputHash||row.taskType!==row.actionType||
      row.actorUserId!==row.owner||m.ordinary!==null||m.rootReviewAddon!==null||m.reviewOrdinary!==null||
      m.reviewOrdinaryModel!==null||m.reviewSchema!=='wiselink.3_1.review_turn_task.v1.c5'||
      m.reviewPurpose!=='UPDATE_ASSESSMENT'||m.reviewModelPurpose!=='PROBLEM_REVIEW'||m.reviewOwner!==row.owner||
      canonical(addon)!==canonical(m.reviewModelAddon)||canonical(addon)!==canonical(m.contextAddon)||
      addon.reviewConversationRef!==m.reviewConversationRef||addon.reviewTurnRef!==m.reviewTurnRef||
      addon.requestId!==m.requestId||addon.inputRevision!==row.inputRevision||m.inputRevision!==row.inputRevision||
      addon.workRevisionRef!==m.previousWorkRef||addon.workRevision!==m.previousWorkRevision||
      addon.workRevision!==m.expectedWorkRevision) invalid();
    const [turn]=await database.execute<{matches:boolean}>(sql`SELECT (
      t.review_conversation_id=${addon.reviewConversationRef} AND t.request_id=${addon.requestId}
      AND t.input_revision=${addon.inputRevision} AND t.review_scope_json IS NULL
      AND left(t.user_message,5)='WLR7:'
      AND substring(t.user_message from 6)::jsonb->>'purpose'='UPDATE_ASSESSMENT'
      AND substring(t.user_message from 6)::jsonb->'executionRequested'='true'::jsonb
      AND EXISTS(SELECT 1 FROM assessment_work_revision r WHERE r.tenant_id=t.tenant_id AND r.work_item_id=t.work_item_id
        AND r.document_version_id=${row.documentVersionId} AND r.created_by_user_id=${row.owner}
        AND r.assessment_work_revision_id=${addon.workRevisionRef} AND r.work_revision=${addon.workRevision})) AS matches
      FROM review_turn t WHERE t.tenant_id=${row.tenantId} AND t.work_item_id=${row.workItemId}
        AND t.actor_id=${row.owner} AND t.review_turn_id=${addon.reviewTurnRef}`);
    if(!turn?.matches) invalid();
    context=addon.runtimeContext;
  } else if(['OPENCLAW_DYNAMIC_EVALUATION','OPENCLAW_OVERALL_SYNTHESIS'].includes(row.actionType)) {
    if(row.actorUserId!=='service:openclaw-main'||m.ordinaryOwner!==row.owner||m.rootReviewAddon!==null||m.reviewAddon!==null)
      invalid();
    context=assertTdmsRuntimeTaskContext(m.ordinary);
    if(m.successorTurnRef!==null) {
      if(row.actionType!=='OPENCLAW_OVERALL_SYNTHESIS'||typeof m.successorTurnRef!=='string') invalid();
      const successor=object(m.successorBinding);
      if(Object.keys(successor).sort().join(',')!==['reviewConversationRef','requestId','inputRevision','workRevisionRef','workRevision','workItemRevision'].sort().join(',')||
        successor.workRevisionRef!==m.overallPreviousRef||successor.workRevision!==m.overallPreviousRevision||
        successor.workItemRevision!==row.inputRevision) invalid();
      const [turn]=await database.execute<{matches:boolean}>(sql`SELECT (
        t.review_conversation_id=${String(successor.reviewConversationRef)} AND t.request_id=${String(successor.requestId)}
        AND t.input_revision=${Number(successor.inputRevision)} AND t.assistant_response IS NOT NULL
        AND t.result_provenance_json::jsonb#>>'{jobAidWorkingUpdate,status}'='APPLIED'
        AND t.result_provenance_json::jsonb#>>'{jobAidWorkingUpdate,workRevisionRef}'=${String(successor.workRevisionRef)}
        AND (t.result_provenance_json::jsonb#>>'{jobAidWorkingUpdate,workRevision}')::integer=${Number(successor.workRevision)}
        AND substring(t.user_message from 6)::jsonb->>'purpose'='UPDATE_ASSESSMENT'
        AND substring(t.user_message from 6)::jsonb->'overallRequested'='true'::jsonb) AS matches
        FROM review_turn t WHERE t.tenant_id=${row.tenantId} AND t.work_item_id=${row.workItemId}
          AND t.actor_id=${row.owner} AND t.review_turn_id=${m.successorTurnRef}`);
      if(!turn?.matches) invalid();
    } else if(m.successorBinding!==null) invalid();
  } else invalid();
  const expected:TdmsRuntimeTaskBinding={tenantId:row.tenantId,workItemId:row.workItemId,
    documentVersionId:row.documentVersionId,actorUserId:row.owner,taskContextRef:input.taskContextRef};
  if(canonical(context.binding)!==canonical(expected)) invalid();
  return {id:row.id,attemptId:row.attemptId,actionType:row.actionType,owner:row.owner,context};
}
function decode(value:unknown):unknown{return typeof value==='string'?JSON.parse(value):value;}
function invalid():never{throw tdmsError('TDMS_RUNTIME_SAVED_RECEIPT_MISMATCH',409);}
