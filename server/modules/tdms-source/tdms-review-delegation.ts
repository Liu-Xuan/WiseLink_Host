import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type {
  CanonicalServiceScopeAuthorizationPort,
  CanonicalVerifiedServiceScope,
} from '../canonical-host/canonical-service-scope.authorization';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../action-attempt/action-attempt.types';
import { canonical, object } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';
import { tdmsReviewSavedMetadata } from './tdms-review-saved-metadata';
import { readTdmsSuccessorBinding } from './tdms-successor-delegation';
import type { AssessmentTdmsProcessingSetBinding } from '@shared/assessment-reading.interface';
import { assertTdmsReviewSavedContext } from '../canonical-host/tdms-review-saved-context';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import { parseStoredResultEnvelope, parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';

class ReviewCallerHandle {
  declare private readonly opaque: never;
  private constructor() {}
  static create(): ReviewCallerHandle {
    const value = new ReviewCallerHandle();
    Object.freeze(value);
    return value;
  }
}
/** Request-local identity only. No serialized representation carries authority. */
export type TdmsReviewCaller = ReviewCallerHandle;

export interface TdmsReviewIngress {
  scope: CanonicalVerifiedServiceScope;
  reviewConversationRef?: string;
  requestId?: string;
  attemptRef?: string;
  /** Locator only; the handed transaction verifies the real unprepared queue row. */
  preparation?: { attemptId: string; operationRef: string; createdAt: Date };
  successorOverall?: { reviewTurnRef:string; preparation?:{attemptId:string;operationRef:string;createdAt:Date} };
}
interface ReviewAttemptBinding {
  attemptId: string;
  attemptRef: string;
  taskInputHash: string | null;
  status: string;
  createdAt: string;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseGeneration: number;
  deadlineAt: string;
  leaseExpiresAt: string | null;
  resultContentHash: string | null;
  phase: 'PREPARATION' | 'EXECUTION' | 'SEALED_RECOVERY' | 'SAVED_VERIFICATION';
}
export interface TdmsReviewBinding {
  readonly kind:'REVIEW'|'SUCCESSOR_OVERALL';
  readonly scope: CanonicalVerifiedServiceScope;
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly workItemId: string;
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly sourceArtifactId: string;
  readonly sourceFileSha256: string;
  readonly sourceByteLength: number;
  readonly sourceRequestId: string;
  readonly reviewConversationRef: string;
  readonly reviewTurnRef: string;
  readonly requestId: string;
  readonly inputRevision: number;
  /** Current locked WorkItem revision, including an exact successor's own CAS. */
  readonly workItemRevision: number;
  readonly openClawSessionKey: string;
  readonly targetIssueKeys: readonly string[] | null;
  readonly selectedEvaluationItemId: string | null;
  readonly overallRequested: boolean;
  readonly workRevisionRef: string;
  readonly workRevision: number;
  readonly nativeMetadata: readonly TdmsReviewNativeMetadata[];
  readonly attempt: Readonly<ReviewAttemptBinding> | null;
}
/** Finite saved-carrier columns; no excerpt, saved narrative or task journal. */
export interface TdmsReviewNativeMetadata {
  kind: 'TDMS_NATIVE_RECORD';
  evidenceRef: string;
  nativeScope: { processingSetBinding: AssessmentTdmsProcessingSetBinding };
  nativeReadReceipt: { taskContextRef: string; receiptRef: string };
}
export interface TdmsReviewDelegatedActor {
  readonly principalKind: 'REVIEW_SERVICE_DELEGATE';
  readonly transport: 'HOST_VERIFIED_SERVICE';
  readonly identityProvenance: 'HOST_EXPLICIT_REVIEW_DELEGATION';
  readonly canonicalSubject: { readonly namespace: 'MIAODA_USER_ID'; readonly id: string };
  readonly tenantId: string;
  readonly applicationScopeId: string;
  readonly servicePrincipalId: string;
  readonly workItemId: string;
  readonly authorityExpiresAt: number;
}

const bindings = new WeakMap<TdmsReviewCaller, Readonly<TdmsReviewBinding>>();
const actors = new WeakSet<object>();

export function tdmsReviewBinding(caller: TdmsReviewCaller): Readonly<TdmsReviewBinding> {
  const binding = caller && bindings.get(caller);
  if (!binding) deny();
  return binding;
}

/** A freshly admitted capability may finish only this exact persisted result.
 * Its old token is an identity fence, never a renewed execution permission. The
 * consumer holds the same transaction's current Source/own-approval locks. */
export function assertTdmsSealedResultFence(caller:TdmsReviewCaller,row:ActionAttemptRow,
  fence:{principalId:string;leaseToken:string;leaseGeneration:number},kind:TdmsReviewBinding['kind']) {
  const b=tdmsReviewBinding(caller),a=b.attempt;
  if(b.kind!==kind || !a || a.phase!=='SEALED_RECOVERY' || a.status!=='COMMITTING' || row.status!=='COMMITTING' ||
    row.tenantId!==b.tenantId || row.workItemId!==b.workItemId || row.documentVersionId!==b.documentVersionId ||
    row.actorUserId!==(kind==='REVIEW'?b.actorUserId:'service:openclaw-main') ||
    row.actionType!==(kind==='REVIEW'?'OPENCLAW_INTERACTIVE_REVIEW':'OPENCLAW_OVERALL_SYNTHESIS') ||
    row.attemptId!==a.attemptId || row.operationRef!==a.attemptRef || row.taskInputHash!==a.taskInputHash ||
    row.resultContentHash!==a.resultContentHash || row.inputRevision!==b.inputRevision || row.baseRevision!==b.inputRevision ||
    row.requestOrigin!==ACTION_ATTEMPT_REQUEST_ORIGIN || row.cancelRequestedAt ||
    fence.principalId!==b.scope.principalId || row.leaseOwner!==a.leaseOwner || row.leaseOwner!==fence.principalId ||
    row.leaseToken!==a.leaseToken || row.leaseToken!==fence.leaseToken || row.leaseGeneration!==a.leaseGeneration ||
    row.leaseGeneration!==fence.leaseGeneration || row.leaseExpiresAt?.toISOString()!==a.leaseExpiresAt ||
    row.deadlineAt?.toISOString()!==a.deadlineAt || !row.taskEnvelopeJson || !row.resultEnvelopeJson) deny();
  const task=parseTaskEnvelope(row.taskEnvelopeJson);
  const result=parseStoredResultEnvelope({value:row.resultEnvelopeJson,task});
  if(task.inputHash!==a.taskInputHash || result.contentHash!==a.resultContentHash || result.status!=='SUCCEEDED') deny();
  return result;
}
export function assertTdmsReviewSourceActor(actor: TdmsReviewDelegatedActor): void {
  if (!actor || !actors.has(actor)) deny();
}

/** Called only by the authenticated Host Review ingress, before loading bodies.
 * The returned handle is not released to the caller until the Source metadata
 * gate also succeeds. All authoritative reads here use the supplied transaction. */
export async function admitTdmsReviewCaller(input: {
  database: PostgresJsDatabase;
  authorization: CanonicalServiceScopeAuthorizationPort;
  ingress: TdmsReviewIngress;
}): Promise<TdmsReviewCaller> {
  const scope = freezeCopy(input.ingress.scope);
  const binding = await (input.ingress.successorOverall ? readTdmsSuccessorBinding : readBinding)(
    input.database, input.authorization, { ...input.ingress, scope });
  const handle = ReviewCallerHandle.create();
  bindings.set(handle, freezeCopy(binding));
  return handle;
}

/** No root-pool authorization, resolver or new transaction is allowed here. */
export async function authenticateTdmsReviewDelegation(input: {
  database: PostgresJsDatabase;
  authorization: CanonicalServiceScopeAuthorizationPort;
  caller: TdmsReviewCaller;
  actor: { tenantId: string; actorUserId: string };
}): Promise<{ actor: TdmsReviewDelegatedActor; validUntil: number }> {
  const expected = tdmsReviewBinding(input.caller);
  if (input.actor.tenantId !== expected.tenantId || input.actor.actorUserId !== expected.actorUserId) deny();
  const fresh = await (expected.kind==='SUCCESSOR_OVERALL'?readTdmsSuccessorBinding:readBinding)(input.database, input.authorization, {
    scope: expected.scope,
    reviewConversationRef: expected.reviewConversationRef,
    requestId: expected.requestId,
    ...(expected.kind==='SUCCESSOR_OVERALL' ? {successorOverall:{reviewTurnRef:expected.reviewTurnRef,
      ...(expected.attempt?.phase==='PREPARATION'?{preparation:{attemptId:expected.attempt.attemptId,
        operationRef:expected.attempt.attemptRef,createdAt:new Date(expected.attempt.createdAt)}}:{})},
      ...(expected.attempt?.phase!=='PREPARATION'&&expected.attempt?{attemptRef:expected.attempt.attemptRef}:{})} :
      expected.attempt?.phase === 'PREPARATION' ? {preparation:{attemptId:expected.attempt.attemptId,
      operationRef:expected.attempt.attemptRef,createdAt:new Date(expected.attempt.createdAt)}} :
      expected.attempt ? { attemptRef: expected.attempt.attemptRef } : {}),
  });
  // A same-generation heartbeat may extend the live deadline but does not extend
  // this handle's original validity. No caller-provided field changes the binding.
  const compared = { ...fresh, attempt: fresh.attempt && {
    ...fresh.attempt, leaseExpiresAt: expected.attempt?.leaseExpiresAt,
  } };
  if (canonical(compared) !== canonical(expected)) deny();
  const validUntil = expected.attempt?.phase === 'EXECUTION'
    ? Math.min(Date.parse(expected.attempt.leaseExpiresAt ?? ''), Date.parse(expected.attempt.deadlineAt))
    : expected.attempt?.phase === 'PREPARATION' ? Date.parse(expected.attempt.deadlineAt)
    : Number.POSITIVE_INFINITY;
  if (validUntil <= Date.now()) deny();
  const actor: TdmsReviewDelegatedActor = Object.freeze({
    principalKind: 'REVIEW_SERVICE_DELEGATE',
    transport: 'HOST_VERIFIED_SERVICE',
    identityProvenance: 'HOST_EXPLICIT_REVIEW_DELEGATION',
    canonicalSubject: Object.freeze({ namespace: 'MIAODA_USER_ID', id: expected.actorUserId }),
    tenantId: expected.tenantId,
    applicationScopeId: expected.scope.appId,
    servicePrincipalId: expected.scope.principalId,
    workItemId: expected.workItemId,
    authorityExpiresAt: validUntil,
  });
  actors.add(actor);
  return { actor, validUntil };
}

interface WorkMetadata extends Record<string, unknown> {
  actorUserId: string; documentId: string; documentVersionId: string;
  sourceArtifactId: string; sourceFileSha256: string; sourceByteLength: number;
  requestId: string; revision: number; status: string; actionType: string; packageId: string;
}
interface TurnMetadata extends Record<string, unknown> {
  reviewConversationRef: string; reviewTurnRef: string; requestId: string;
  inputRevision: number; sessionKey: string; metadata: unknown;
  resultContentHash: string | null; actionAttemptId: string | null;
  assistantCompletedAt: Date | string | null; hasCandidate: boolean;
}
interface AttemptMetadata extends Record<string, unknown> {
  attemptId: string; attemptRef: string; actorUserId: string; documentVersionId: string;
  inputRevision: number; baseRevision: number; actionType: string; status: string;
  requestOrigin: string; leaseOwner: string; leaseToken: string; leaseGeneration: number;
  leaseExpiresAt: Date | string; deadlineAt: Date | string; cancelRequestedAt: Date | null;
  taskInputHash: string; resultContentHash: string | null; contract: unknown;
  createdAt: Date | string; claimCount: number; hasTask: boolean; idempotencyKey: string;
}

async function readBinding(
  database: PostgresJsDatabase,
  authorization: CanonicalServiceScopeAuthorizationPort,
  ingress: TdmsReviewIngress,
): Promise<TdmsReviewBinding> {
  const scope = ingress.scope;
  if (!authorization.assertOpenClawReviewTransport || scope.appId !== 'app_17bzc551rsg' ||
      scope.automaticWorkItemLease) deny();
  await authorization.assertOpenClawReviewTransport(scope);
  const [identity] = await database.execute<{ roleName: string; actorId: string }>(sql`
    SELECT current_user AS "roleName",current_setting('app.user_id',true) AS "actorId"`);
  if (identity?.roleName !== 'service_role_workspace_aadkpkjef3slu') deny();
  // Match WorkItem writers first. All subsequent session/Source locks remain in
  // this same actor transaction, including the last check before its commit.
  const [work] = await database.execute<WorkMetadata>(sql`
    SELECT requested_by_user_id AS "actorUserId",document_id AS "documentId",
      document_version_id AS "documentVersionId",source_artifact_id AS "sourceArtifactId",
      source_file_sha256 AS "sourceFileSha256",source_byte_length AS "sourceByteLength",
      request_id AS "requestId",revision,status,action_type AS "actionType",package_id AS "packageId"
    FROM work_item WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId} FOR UPDATE`);
  if (!work || identity.actorId !== work.actorUserId || work.actorUserId.startsWith('service:') ||
      work.status !== 'CANDIDATE_READBACK_VERIFIED' || work.actionType !== 'PARSE_PDF' || !work.packageId ||
      !work.documentVersionId || !work.documentId || !work.sourceArtifactId ||
      !/^[0-9a-f]{64}$/u.test(work.sourceFileSha256) || Number(work.sourceByteLength) < 1) deny();
  const delegation = scope.successorReviewDelegation;
  if (delegation) {
    const [grant] = await database.execute<{ matches: boolean }>(sql`
      SELECT (grant_kind='MIAODA_CANONICAL_PARSE_REQUEST' AND status='COMPLETED'
        AND completed_at IS NOT NULL AND request_id=${work.requestId} AND actor_user_id=${work.actorUserId}
        AND document_id=${work.documentId} AND document_version_id=${work.documentVersionId}
        AND source_artifact_id=${work.sourceArtifactId} AND source_file_sha256=${work.sourceFileSha256}
        AND source_byte_length=${Number(work.sourceByteLength)}) AS matches
      FROM auto_work_item_authorization WHERE tenant_id=${scope.tenantId}
        AND work_item_id=${scope.workItemId} FOR SHARE`);
    if (!grant?.matches || delegation.actorUserId !== work.actorUserId ||
        delegation.documentId !== work.documentId || delegation.documentVersionId !== work.documentVersionId ||
        delegation.sourceArtifactId !== work.sourceArtifactId ||
        delegation.sourceFileSha256 !== work.sourceFileSha256 ||
        delegation.sourceByteLength !== Number(work.sourceByteLength) ||
        delegation.inputRevision !== work.revision) deny();
  }
  if (ingress.attemptRef && ingress.preparation) deny();
  const attemptRef = ingress.preparation?.operationRef ?? ingress.attemptRef;
  let attempt = attemptRef ? await attemptMetadata(database, scope, attemptRef) : null;
  let contract = attempt?.hasTask ? object(decode(attempt.contract)) : null;
  const conversation = ingress.reviewConversationRef ?? contract?.reviewConversationRef;
  const requestId = ingress.requestId ?? contract?.requestId;
  if (typeof conversation !== 'string' || typeof requestId !== 'string' || !conversation || !requestId) deny();
  const [session] = await database.execute<{ sessionKey: string }>(sql`
    SELECT openclaw_session_key AS "sessionKey" FROM review_conversation
    WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
      AND actor_id=${work.actorUserId} AND review_conversation_id=${conversation}
      AND status='ACTIVE' AND closed_at IS NULL AND openclaw_agent_id='wiselink-engineering'
      AND last_synced_revision=${work.revision} FOR SHARE`);
  if (!session?.sessionKey) deny();
  const turnQuery = sql`
    SELECT review_conversation_id AS "reviewConversationRef",review_turn_id AS "reviewTurnRef",
      request_id AS "requestId",input_revision AS "inputRevision",
      result_content_hash AS "resultContentHash",action_attempt_id AS "actionAttemptId",
      assistant_completed_at AS "assistantCompletedAt",assistant_response IS NOT NULL AS "hasCandidate",
      jsonb_build_object('purpose',substring(user_message from 6)::jsonb->'purpose',
        'executionRequested',substring(user_message from 6)::jsonb->'executionRequested',
        'expectedInputRevision',substring(user_message from 6)::jsonb->'expectedInputRevision',
        'overallRequested',substring(user_message from 6)::jsonb->'overallRequested',
        'targetIssueKeys',substring(user_message from 6)::jsonb->'targetIssueKeys',
        'selectedEvaluationItemId',substring(user_message from 6)::jsonb->'selectedEvaluationItemId') AS metadata
    FROM review_turn WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
      AND actor_id=${work.actorUserId} AND review_conversation_id=${conversation} AND request_id=${requestId}
      AND left(user_message,5)='WLR7:' AND review_scope_json IS NULL`;
  let [turn] = await database.execute<TurnMetadata>(turnQuery);
  let lockedAttempt: AttemptMetadata | undefined;
  if (turn && !turn.hasCandidate) {
    // The existing 0021 policy locks only a pending candidate. If a concurrent
    // candidate won first, re-locate its now immutable completed metadata.
    const [pending] = await database.execute<TurnMetadata>(sql`${turnQuery} FOR SHARE`);
    if (pending) turn = pending;
    else [turn] = await database.execute<TurnMetadata>(turnQuery);
  }
  if (turn?.hasCandidate) {
    // Normal begin receives only conversation/request. A completed immutable
    // turn supplies its exact original attempt pointer before any body is read.
    if(!attempt && !ingress.preparation && turn.actionAttemptId) {
      const [pointer]=await database.execute<{operationRef:string}>(sql`SELECT operation_ref AS "operationRef"
        FROM action_attempt WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
          AND actor_user_id=${work.actorUserId} AND action_type='OPENCLAW_INTERACTIVE_REVIEW'
          AND attempt_id=${turn.actionAttemptId}`);
      if(pointer?.operationRef) {
        attempt=await attemptMetadata(database,scope,pointer.operationRef);
        contract=attempt.hasTask?object(decode(attempt.contract)):null;
      }
    }
    if (!attempt || !turn.assistantCompletedAt) deny();
    lockedAttempt = await attemptMetadata(database,scope,attempt.attemptRef,true);
    if (canonical(lockedAttempt)!==canonical(attempt) ||
      !['COMMITTING','SUCCEEDED'].includes(lockedAttempt.status) || !lockedAttempt.resultContentHash ||
      lockedAttempt.resultContentHash!==turn.resultContentHash || lockedAttempt.attemptId!==turn.actionAttemptId) deny();
    const [completed] = await database.execute<TurnMetadata>(turnQuery);
    if (!completed || canonical(completed)!==canonical(turn)) deny();
    // 0010 freezes the entire completed row; 0023 additionally freezes scope.
    // The active conversation, mapping and exact attempt keep their live locks.
    turn = completed;
  }
  if (!turn || turn.inputRevision !== work.revision) deny();
  const metadata = object(decode(turn.metadata));
  if (metadata.purpose !== 'UPDATE_ASSESSMENT' || metadata.executionRequested !== true ||
      metadata.expectedInputRevision !== turn.inputRevision || typeof metadata.overallRequested !== 'boolean') deny();
  const selected = metadata.selectedEvaluationItemId;
  const targets = metadata.targetIssueKeys ?? null;
  if ((selected !== null && selected !== undefined && typeof selected !== 'string') ||
      (targets !== null && (!Array.isArray(targets) || !targets.length || targets.length>20 ||
        targets.some((key: unknown) => typeof key !== 'string' || !key.trim() || key.length>96) ||
        new Set(targets).size !== targets.length))) deny();
  if (delegation && (delegation.reviewConversationRef !== conversation ||
      delegation.reviewTurnRef !== turn.reviewTurnRef || delegation.requestId !== requestId ||
      delegation.overallRequested !== metadata.overallRequested)) deny();
  const savedContext = contract?.savedContext ? contextHeader(contract.savedContext) : undefined;
  const saved=await tdmsReviewSavedMetadata(database,{tenantId:scope.tenantId,workItemId:scope.workItemId,
    documentVersionId:work.documentVersionId,actorUserId:work.actorUserId,
    ...(savedContext?{workRevisionRef:savedContext.workRevisionRef}:{})});
  if (!saved) deny();
  const nativeMetadata = decode(saved.nativeMetadata) as TdmsReviewNativeMetadata[];
  if (!Array.isArray(nativeMetadata) || nativeMetadata.length > 4096 ||
      (savedContext && (savedContext.workRevision !== saved.workRevision ||
        savedContext.reviewConversationRef !== conversation || savedContext.reviewTurnRef !== turn.reviewTurnRef ||
        savedContext.requestId !== requestId || savedContext.inputRevision !== work.revision ||
        canonical([...savedContext.evidenceRefs].sort()) !== canonical(nativeMetadata.map(
          (item: TdmsReviewNativeMetadata) => item.evidenceRef).sort())))) deny();
  let execution: ReviewAttemptBinding | null = null;
  if (ingress.preparation) {
    if (!attempt || contract) deny();
    const prepared = ingress.preparation;
    const locked = await attemptMetadata(database, scope, prepared.operationRef, true);
    if (canonical(locked)!==canonical(attempt) || attempt.attemptId!==prepared.attemptId ||
        new Date(attempt.createdAt).toISOString()!==prepared.createdAt.toISOString() ||
        attempt.actorUserId!==work.actorUserId || attempt.documentVersionId!==work.documentVersionId ||
        attempt.inputRevision!==work.revision || attempt.baseRevision!==work.revision ||
        attempt.actionType!=='OPENCLAW_INTERACTIVE_REVIEW' || attempt.requestOrigin!==ACTION_ATTEMPT_REQUEST_ORIGIN ||
        attempt.status!=='QUEUED' || attempt.hasTask || attempt.taskInputHash!==null || attempt.claimCount!==0 ||
        attempt.cancelRequestedAt || attempt.leaseOwner!==null || attempt.leaseToken!==null ||
        attempt.leaseGeneration!==0 || attempt.leaseExpiresAt!==null ||
        attempt.idempotencyKey!==['openclaw-v1','review',conversation,turn.reviewTurnRef,work.revision].join(':') ||
        !Number.isFinite(Date.parse(String(attempt.deadlineAt))) || new Date(attempt.deadlineAt).getTime()<=Date.now()) deny();
    execution = {attemptId:attempt.attemptId,attemptRef:attempt.attemptRef,taskInputHash:null,
      status:attempt.status,createdAt:new Date(attempt.createdAt).toISOString(),leaseOwner:null,leaseToken:null,
      leaseGeneration:0,deadlineAt:new Date(attempt.deadlineAt).toISOString(),leaseExpiresAt:null,
      resultContentHash:null,phase:'PREPARATION'};
  } else if (attempt && contract) {
    const deadline = Date.parse(String(attempt.deadlineAt));
    const expiry = Date.parse(String(attempt.leaseExpiresAt));
    const persisted = !!attempt.resultContentHash && turn.resultContentHash === attempt.resultContentHash &&
      turn.actionAttemptId === attempt.attemptId;
    const sealedRecovery=attempt.status==='COMMITTING' && !persisted &&
      !!contract.savedContext && object(contract.savedContext).mode==='BOUNDED_NATIVE_READ' && Math.min(expiry,deadline)<=Date.now();
    const savedVerification = attempt.status === 'SUCCEEDED' ||
      (attempt.status === 'COMMITTING' && Math.min(expiry, deadline) <= Date.now());
    // Re-read and lock after conversation/turn, never load task or journal bodies.
    const locked = lockedAttempt ?? await attemptMetadata(database, scope, attempt.attemptRef, true);
    if (canonical(locked) !== canonical(attempt) || attempt.actorUserId !== work.actorUserId ||
        attempt.documentVersionId !== work.documentVersionId || attempt.inputRevision !== work.revision ||
        attempt.baseRevision !== work.revision || attempt.requestOrigin !== ACTION_ATTEMPT_REQUEST_ORIGIN ||
        attempt.actionType !== 'OPENCLAW_INTERACTIVE_REVIEW' || attempt.cancelRequestedAt ||
        !['RUNNING', 'COMMITTING', 'SUCCEEDED'].includes(attempt.status) ||
        (attempt.status !== 'SUCCEEDED' && (attempt.leaseOwner !== scope.principalId || !attempt.leaseToken)) ||
        (attempt.status === 'SUCCEEDED' && (attempt.leaseOwner !== null || attempt.leaseToken !== null || attempt.leaseExpiresAt !== null)) ||
        !Number.isSafeInteger(attempt.leaseGeneration) || attempt.leaseGeneration < 1 ||
        !Number.isFinite(deadline) ||
        (attempt.status !== 'SUCCEEDED' && !Number.isFinite(expiry)) ||
        (sealedRecovery ? false : savedVerification ? !persisted : Math.min(expiry, deadline) <= Date.now()) ||
        contract.reviewConversationRef !== conversation || contract.reviewTurnRef !== turn.reviewTurnRef ||
        contract.requestId !== requestId || contract.inputRevision !== work.revision ||
        contract.inputHash !== attempt.taskInputHash || contract.matterContext !== null ||
        contract.purpose !== 'UPDATE_ASSESSMENT' ||
        canonical(contract.targetIssueKeys ?? null) !== canonical(targets) ||
        (attempt.status !== 'RUNNING' && (!attempt.resultContentHash ||
          contract.resultContentHash !== attempt.resultContentHash || contract.resultStatus !== 'SUCCEEDED'))) deny();
    execution = {
      attemptId: attempt.attemptId, attemptRef: attempt.attemptRef, taskInputHash: attempt.taskInputHash,
      status:attempt.status,createdAt:new Date(attempt.createdAt).toISOString(),
      leaseOwner: attempt.leaseOwner, leaseToken: attempt.leaseToken, leaseGeneration: attempt.leaseGeneration,
      leaseExpiresAt: attempt.leaseExpiresAt === null ? null : new Date(attempt.leaseExpiresAt).toISOString(),
      deadlineAt: new Date(attempt.deadlineAt).toISOString(), resultContentHash: attempt.resultContentHash,
      phase: sealedRecovery ? 'SEALED_RECOVERY' : savedVerification ? 'SAVED_VERIFICATION' : 'EXECUTION',
    };
  } else if (attempt) deny();
  return {
    kind:'REVIEW',scope, tenantId: scope.tenantId, actorUserId: work.actorUserId, workItemId: scope.workItemId,
    documentId: work.documentId, documentVersionId: work.documentVersionId,
    sourceArtifactId: work.sourceArtifactId, sourceFileSha256: work.sourceFileSha256,
    sourceByteLength: Number(work.sourceByteLength), sourceRequestId: work.requestId,
    reviewConversationRef: conversation, reviewTurnRef: turn.reviewTurnRef, requestId,
    inputRevision: turn.inputRevision, workItemRevision:work.revision, openClawSessionKey: session.sessionKey,
    targetIssueKeys: targets as string[] | null, selectedEvaluationItemId: selected as string | null ?? null,
    overallRequested: metadata.overallRequested, workRevisionRef: saved.workRevisionRef,
    workRevision: saved.workRevision, nativeMetadata, attempt: execution,
  };
}

async function attemptMetadata(database: PostgresJsDatabase, scope: CanonicalVerifiedServiceScope,
  ref: string, lock = false): Promise<AttemptMetadata> {
  const [row] = await database.execute<AttemptMetadata>(sql`
    SELECT attempt_id AS "attemptId",operation_ref AS "attemptRef",actor_user_id AS "actorUserId",
      created_at AS "createdAt",claim_count AS "claimCount",idempotency_key AS "idempotencyKey",
      task_envelope_json IS NOT NULL AS "hasTask",
      document_version_id AS "documentVersionId",input_revision AS "inputRevision",base_revision AS "baseRevision",
      action_type AS "actionType",status,request_origin AS "requestOrigin",lease_owner AS "leaseOwner",
      lease_token AS "leaseToken",lease_generation AS "leaseGeneration",lease_expires_at AS "leaseExpiresAt",
      deadline_at AS "deadlineAt",cancel_requested_at AS "cancelRequestedAt",task_input_hash AS "taskInputHash",
      result_content_hash AS "resultContentHash",jsonb_build_object(
        'inputHash',task_envelope_json::jsonb->'inputHash',
        'reviewConversationRef',task_envelope_json::jsonb#>'{modelInput,reviewConversationRef}',
        'reviewTurnRef',task_envelope_json::jsonb#>'{modelInput,reviewTurnRef}',
        'requestId',task_envelope_json::jsonb#>'{modelInput,requestId}',
        'inputRevision',task_envelope_json::jsonb#>'{modelInput,inputRevision}',
        'purpose',task_envelope_json::jsonb#>'{modelInput,context,purpose}',
        'savedContext',CASE WHEN task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext}' IS NULL
          THEN NULL ELSE jsonb_build_object(
          'keys',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(
            task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext}') AS key),
          'schemaVersion',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,schemaVersion}',
          'mode',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,mode}',
          'reviewConversationRef',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,reviewConversationRef}',
          'reviewTurnRef',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,reviewTurnRef}',
          'requestId',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,requestId}',
          'inputRevision',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,inputRevision}',
          'workRevisionRef',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,workRevisionRef}',
          'workRevision',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,workRevision}',
          'evidenceRefs',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,evidenceRefs}',
          'savedEvidenceRefs',task_envelope_json::jsonb#>'{modelInput,jobAidContext,tdmsReviewContext,savedEvidenceRefs}') END,
        'targetIssueKeys',task_envelope_json::jsonb#>'{modelInput,context,issueEditScope,targetIssueKeys}',
        'matterContext',task_envelope_json::jsonb#>'{modelInput,matterContext,scope}',
        'resultContentHash',result_envelope_json::jsonb->'contentHash',
        'resultStatus',result_envelope_json::jsonb->'status') AS contract
    FROM action_attempt WHERE tenant_id=${scope.tenantId} AND work_item_id=${scope.workItemId}
      AND operation_ref=${ref} ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!row) deny();
  return row;
}
function freezeCopy<T>(input: T): T {
  const value: T = structuredClone(input);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(value);
  return value;
}
function decode(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value; }
function deny(): never { throw tdmsError('TDMS_REVIEW_DELEGATION_REJECTED', 403); }

/** Header only: no runtime projection, narrative, native body or journal is
 * fetched while admission is still establishing the current Source gate. */
function contextHeader(value:unknown) {
  const header=object(decode(value));
  const bounded=header.schemaVersion==='wiselink.tdms-review-runtime-context.v1';
  const common=['schemaVersion','mode','reviewConversationRef','reviewTurnRef','requestId',
    'inputRevision','workRevisionRef','workRevision'];
  const expected=[...common,...(bounded?['savedEvidenceRefs','runtimeContext']:['evidenceRefs'])].sort();
  if(canonical(header.keys)!==canonical(expected)) deny();
  const data=Object.fromEntries(common.map(key=>[key,header[key]]));
  if(!bounded) return assertTdmsReviewSavedContext({...data,evidenceRefs:header.evidenceRefs});
  if(header.mode!=='BOUNDED_NATIVE_READ' || !Array.isArray(header.savedEvidenceRefs) ||
      header.savedEvidenceRefs.length>4096 || new Set(header.savedEvidenceRefs).size!==header.savedEvidenceRefs.length ||
      header.savedEvidenceRefs.some((ref:unknown)=>typeof ref!=='string'||!ref.trim()) ||
      common.slice(2,5).concat('workRevisionRef').some(key=>typeof header[key]!=='string'||!String(header[key]).trim()) ||
      !Number.isSafeInteger(header.inputRevision)||Number(header.inputRevision)<1 ||
      !Number.isSafeInteger(header.workRevision)||Number(header.workRevision)<1) deny();
  return {...data,evidenceRefs:header.savedEvidenceRefs} as {reviewConversationRef:string;reviewTurnRef:string;
    requestId:string;inputRevision:number;workRevisionRef:string;workRevision:number;evidenceRefs:string[]};
}
