import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { CanonicalServiceScopeAuthorizationPort } from '../canonical-host/canonical-service-scope.authorization';
import type { TdmsReviewBinding, TdmsReviewIngress, TdmsReviewNativeMetadata } from './tdms-review-delegation';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../action-attempt/action-attempt.types';
import { canonical, object } from './tdms-source.validation';
import { tdmsReviewSavedMetadata } from './tdms-review-saved-metadata';
import { tdmsError } from './tdms-source.types';

/** Exact successor provenance and its own execution authority. The completed
 * Review and initial grant are facts, never the successor's execution lease. */
export async function readTdmsSuccessorBinding(database:PostgresJsDatabase,
  authorization:CanonicalServiceScopeAuthorizationPort,ingress:TdmsReviewIngress):Promise<TdmsReviewBinding> {
  const scope=ingress.scope,delegation=scope.successorReviewDelegation;
  if(!authorization.assertOpenClawReviewTransport||!delegation||scope.automaticWorkItemLease||
      scope.appId!=='app_17bzc551rsg'||!ingress.successorOverall||ingress.preparation||
      ingress.successorOverall.reviewTurnRef!==delegation.reviewTurnRef||!delegation.overallRequested) deny();
  await authorization.assertOpenClawReviewTransport(scope);
  const [identity]=await database.execute<{roleName:string;actorId:string}>(sql`SELECT current_user AS "roleName",
    current_setting('app.user_id',true) AS "actorId"`);
  if(identity?.roleName!=='service_role_workspace_aadkpkjef3slu'||identity.actorId!==delegation.actorUserId) deny();
  const [work]=await database.execute<{actorUserId:string;revision:number;requestId:string;documentId:string;
    documentVersionId:string;sourceArtifactId:string;sourceFileSha256:string;sourceByteLength:number;status:string;actionType:string}>(sql`
    SELECT requested_by_user_id AS "actorUserId",revision,request_id AS "requestId",document_id AS "documentId",
      document_version_id AS "documentVersionId",source_artifact_id AS "sourceArtifactId",
      source_file_sha256 AS "sourceFileSha256",source_byte_length AS "sourceByteLength",status,action_type AS "actionType"
    FROM work_item WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId} FOR UPDATE`);
  if(!work||work.actorUserId!==delegation.actorUserId||work.status!=='CANDIDATE_READBACK_VERIFIED'||work.actionType!=='PARSE_PDF'||
      work.documentId!==delegation.documentId||work.documentVersionId!==delegation.documentVersionId||
      work.sourceArtifactId!==delegation.sourceArtifactId||work.sourceFileSha256!==delegation.sourceFileSha256||
      Number(work.sourceByteLength)!==delegation.sourceByteLength||!work.requestId) deny();
  const [grant]=await database.execute<{matches:boolean}>(sql`SELECT (status='COMPLETED' AND completed_at IS NOT NULL
    AND grant_kind='MIAODA_CANONICAL_PARSE_REQUEST' AND request_id=${work.requestId} AND actor_user_id=${work.actorUserId}
    AND document_id=${work.documentId} AND document_version_id=${work.documentVersionId}
    AND source_artifact_id=${work.sourceArtifactId} AND source_file_sha256=${work.sourceFileSha256}
    AND source_byte_length=${Number(work.sourceByteLength)}) AS matches FROM auto_work_item_authorization
    WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId} FOR SHARE`);
  if(!grant?.matches) deny();
  const [conversation]=await database.execute<{sessionKey:string}>(sql`SELECT openclaw_session_key AS "sessionKey"
    FROM review_conversation WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
      AND actor_id=${work.actorUserId} AND review_conversation_id=${delegation.reviewConversationRef}
      AND openclaw_agent_id='wiselink-engineering' AND status='ACTIVE' AND closed_at IS NULL
      AND last_synced_revision=${delegation.inputRevision} FOR SHARE`);
  // Completed turns are immutable under 0010/0023. No impossible completed-row
  // FOR SHARE policy is introduced; all live states have their own locks.
  const [turn]=await database.execute<{matches:boolean;workRevisionRef:string;workRevision:number;
    resultHash:string;reviewAttemptId:string}>(sql`SELECT (
      request_id=${delegation.requestId} AND input_revision=${delegation.inputRevision} AND review_scope_json IS NULL
      AND assistant_response IS NOT NULL AND assistant_completed_at IS NOT NULL
      AND result_content_hash IS NOT NULL AND action_attempt_id IS NOT NULL AND left(user_message,5)='WLR7:'
      AND substring(user_message from 6)::jsonb->>'purpose'='UPDATE_ASSESSMENT'
      AND substring(user_message from 6)::jsonb->'executionRequested'='true'::jsonb
      AND substring(user_message from 6)::jsonb->'overallRequested'='true'::jsonb
      AND result_provenance_json::jsonb#>>'{jobAidWorkingUpdate,status}'='APPLIED') AS matches,
      result_provenance_json::jsonb#>>'{jobAidWorkingUpdate,workRevisionRef}' AS "workRevisionRef",
      (result_provenance_json::jsonb#>>'{jobAidWorkingUpdate,workRevision}')::integer AS "workRevision",
      result_content_hash AS "resultHash",action_attempt_id AS "reviewAttemptId"
    FROM review_turn WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
      AND actor_id=${work.actorUserId} AND review_conversation_id=${delegation.reviewConversationRef}
      AND review_turn_id=${delegation.reviewTurnRef}`);
  if(!conversation?.sessionKey||!turn?.matches||!turn.workRevisionRef||!Number.isSafeInteger(turn.workRevision)) deny();
  const saved=await tdmsReviewSavedMetadata(database,{tenantId:scope.tenantId,workItemId:scope.workItemId,
    actorUserId:work.actorUserId,documentVersionId:work.documentVersionId,workRevisionRef:turn.workRevisionRef});
  const [latest]=await database.execute<{ref:string;attemptId:string}>(sql`SELECT assessment_work_revision_id AS ref,
    action_attempt_id AS "attemptId" FROM assessment_work_revision WHERE tenant_id=${scope.tenantId}
      AND work_item_id=${scope.workItemId} ORDER BY work_revision DESC LIMIT 1`);
  if(!saved||!['COMPLETE','COMPLETE_WITH_OPEN_QUESTIONS'].includes(saved.roundCompletion)||saved.workRevision!==turn.workRevision||latest?.ref!==saved.workRevisionRef||latest.attemptId!==turn.reviewAttemptId) deny();
  const [prior]=await database.execute<{matches:boolean}>(sql`SELECT (action_type='OPENCLAW_INTERACTIVE_REVIEW'
    AND actor_user_id=${work.actorUserId} AND status IN ('COMMITTING','SUCCEEDED') AND result_content_hash=${turn.resultHash}
    AND result_envelope_json::jsonb->>'contentHash'=${turn.resultHash}) AS matches FROM action_attempt
    WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId} AND attempt_id=${turn.reviewAttemptId}`);
  if(!prior?.matches) deny();
  const nativeMetadata=decode(saved.nativeMetadata) as TdmsReviewNativeMetadata[];
  if(!Array.isArray(nativeMetadata)||nativeMetadata.length>4096) deny();
  let attempt:TdmsReviewBinding['attempt']=null;
  const prep=ingress.successorOverall.preparation;
  if(prep) {
    if(ingress.attemptRef||work.revision!==delegation.inputRevision||!/^ATT-/u.test(prep.attemptId)||
        !/^AQ-[a-f0-9]{32}$/u.test(prep.operationRef)||!Number.isFinite(prep.createdAt.getTime())||
        prep.createdAt.getTime()>Date.now()||Date.now()-prep.createdAt.getTime()>15*60_000) deny();
    attempt={attemptId:prep.attemptId,attemptRef:prep.operationRef,createdAt:prep.createdAt.toISOString(),
      taskInputHash:null,status:'PREPARATION',phase:'PREPARATION',leaseOwner:null,leaseToken:null,leaseGeneration:0,
      leaseExpiresAt:null,deadlineAt:new Date(prep.createdAt.getTime()+15*60_000).toISOString(),resultContentHash:null};
  } else if(ingress.attemptRef) {
    const [row]=await database.execute<{attemptId:string;attemptRef:string;actorUserId:string;documentVersionId:string;
      inputRevision:number;baseRevision:number;actionType:string;status:string;requestOrigin:string;cancelRequestedAt:unknown;
      leaseOwner:string|null;leaseToken:string|null;leaseGeneration:number;leaseExpiresAt:Date|null;deadlineAt:Date;
      createdAt:Date;taskInputHash:string;resultContentHash:string|null;idempotencyKey:string;metadata:unknown}>(sql`
      SELECT attempt_id AS "attemptId",operation_ref AS "attemptRef",actor_user_id AS "actorUserId",
        document_version_id AS "documentVersionId",input_revision AS "inputRevision",base_revision AS "baseRevision",
        action_type AS "actionType",status,request_origin AS "requestOrigin",cancel_requested_at AS "cancelRequestedAt",
        lease_owner AS "leaseOwner",lease_token AS "leaseToken",lease_generation AS "leaseGeneration",
        lease_expires_at AS "leaseExpiresAt",deadline_at AS "deadlineAt",created_at AS "createdAt",
        task_input_hash AS "taskInputHash",result_content_hash AS "resultContentHash",idempotency_key AS "idempotencyKey",
        jsonb_build_object('taskType',task_envelope_json::jsonb->'taskType','inputHash',task_envelope_json::jsonb->'inputHash',
          'owner',task_envelope_json::jsonb#>'{modelInput,actorUserId}',
          'purpose',task_envelope_json::jsonb#>'{modelInput,modelInput,purpose}',
          'turn',task_envelope_json::jsonb#>'{modelInput,successorReviewTurnRef}',
          'binding',jsonb_build_object(
            'reviewConversationRef',task_envelope_json::jsonb#>'{modelInput,successorOverallBinding,reviewConversationRef}',
            'requestId',task_envelope_json::jsonb#>'{modelInput,successorOverallBinding,requestId}',
            'inputRevision',task_envelope_json::jsonb#>'{modelInput,successorOverallBinding,inputRevision}',
            'workRevisionRef',task_envelope_json::jsonb#>'{modelInput,successorOverallBinding,workRevisionRef}',
            'workRevision',task_envelope_json::jsonb#>'{modelInput,successorOverallBinding,workRevision}',
            'workItemRevision',task_envelope_json::jsonb#>'{modelInput,successorOverallBinding,workItemRevision}'),
          'bindingKeys',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(
            task_envelope_json::jsonb#>'{modelInput,successorOverallBinding}') AS key),
          'workRef',task_envelope_json::jsonb#>'{modelInput,previousWork,workRevisionRef}',
          'workRevision',task_envelope_json::jsonb#>'{modelInput,previousWork,workRevision}',
          'hasRuntime',task_envelope_json::jsonb#>'{modelInput,tdmsContext}' IS NOT NULL,
          'runtimeTaskRef',task_envelope_json::jsonb#>'{modelInput,tdmsContext,binding,taskContextRef}',
          'resultHash',result_envelope_json::jsonb->'contentHash','resultStatus',result_envelope_json::jsonb->'status') AS metadata
      FROM action_attempt WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
        AND operation_ref=${ingress.attemptRef} FOR UPDATE`);
    if(!row) deny();
    const m=object(decode(row.metadata)),b=object(m.binding);
    const expected={reviewConversationRef:delegation.reviewConversationRef,requestId:delegation.requestId,
      inputRevision:delegation.inputRevision,workRevisionRef:saved.workRevisionRef,workRevision:saved.workRevision,
      workItemRevision:row.inputRevision};
    const expiry=row.leaseExpiresAt?new Date(row.leaseExpiresAt).getTime():NaN,deadline=new Date(row.deadlineAt).getTime();
    const sealedRecovery=row.status==='COMMITTING' && m.hasRuntime===true && m.runtimeTaskRef===row.attemptRef &&
      Math.min(expiry,deadline)<=Date.now();
    if(row.actorUserId!=='service:openclaw-main'||row.actionType!=='OPENCLAW_OVERALL_SYNTHESIS'||
        row.requestOrigin!==ACTION_ATTEMPT_REQUEST_ORIGIN||row.documentVersionId!==work.documentVersionId||
        row.inputRevision!==delegation.inputRevision||row.baseRevision!==row.inputRevision||row.cancelRequestedAt||
        !['RUNNING','COMMITTING','SUCCEEDED'].includes(row.status)||!row.taskInputHash||
        row.idempotencyKey!==`openclaw-successor-overall:${scope.workItemId}:${delegation.reviewTurnRef}`||
        m.taskType!==row.actionType||m.inputHash!==row.taskInputHash||m.owner!==work.actorUserId||
        m.purpose!=='OVERALL_CONSISTENCY'||m.turn!==delegation.reviewTurnRef||canonical(b)!==canonical(expected)||
        canonical(m.bindingKeys)!==canonical(Object.keys(expected).sort())||
        m.workRef!==saved.workRevisionRef||m.workRevision!==saved.workRevision||
        !Number.isSafeInteger(row.leaseGeneration)||row.leaseGeneration<1||!Number.isFinite(deadline)||
        (row.status==='SUCCEEDED' ? row.leaseOwner!==null||row.leaseToken!==null||row.leaseExpiresAt!==null :
          row.leaseOwner!==scope.principalId||!row.leaseToken||!Number.isFinite(expiry)||(!sealedRecovery&&Math.min(expiry,deadline)<=Date.now()))||
        (row.status!=='RUNNING'&&(!row.resultContentHash||m.resultHash!==row.resultContentHash||m.resultStatus!=='SUCCEEDED'))) deny();
    if(work.revision!==row.inputRevision) {
      const [applied]=await database.execute<{matches:boolean}>(sql`SELECT (
        projection_json::jsonb#>>'{integratedAssessment,overallSynthesis,actionAttemptId}'=${row.attemptId}
        AND projection_json::jsonb#>>'{integratedAssessment,overallSynthesis,basedOnJobAidWorkRevisionRef}'=${saved.workRevisionRef}) AS matches
        FROM work_item WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}`);
      if(!['COMMITTING','SUCCEEDED'].includes(row.status)||work.revision!==row.inputRevision+1||!applied?.matches) deny();
    }
    attempt={attemptId:row.attemptId,attemptRef:row.attemptRef,createdAt:new Date(row.createdAt).toISOString(),
      taskInputHash:row.taskInputHash,status:row.status,phase:row.status==='SUCCEEDED'?'SAVED_VERIFICATION':sealedRecovery?'SEALED_RECOVERY':'EXECUTION',
      leaseOwner:row.leaseOwner,leaseToken:row.leaseToken,leaseGeneration:row.leaseGeneration,
      leaseExpiresAt:row.leaseExpiresAt?new Date(row.leaseExpiresAt).toISOString():null,
      deadlineAt:new Date(row.deadlineAt).toISOString(),resultContentHash:row.resultContentHash};
  } else if(work.revision!==delegation.inputRevision) deny();
  return {kind:'SUCCESSOR_OVERALL',scope,tenantId:scope.tenantId,actorUserId:work.actorUserId,workItemId:scope.workItemId,
    documentId:work.documentId,documentVersionId:work.documentVersionId,sourceArtifactId:work.sourceArtifactId,
    sourceFileSha256:work.sourceFileSha256,sourceByteLength:Number(work.sourceByteLength),sourceRequestId:work.requestId,
    reviewConversationRef:delegation.reviewConversationRef,reviewTurnRef:delegation.reviewTurnRef,requestId:delegation.requestId,
    inputRevision:delegation.inputRevision,workItemRevision:work.revision,openClawSessionKey:conversation.sessionKey,targetIssueKeys:null,
    selectedEvaluationItemId:null,overallRequested:true,workRevisionRef:saved.workRevisionRef,workRevision:saved.workRevision,
    nativeMetadata,attempt};
}
function decode(value:unknown):unknown{return typeof value==='string'?JSON.parse(value):value;}
function deny():never{throw tdmsError('TDMS_SUCCESSOR_DELEGATION_REJECTED',403);}
