import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { actionAttempt, workItem } from '../../database/schema';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import type { CanonicalServiceScopeAuthorizationPort } from '../canonical-host/canonical-service-scope.authorization';
import type {
  TdmsNativeEvidenceActor,
  TdmsNativeRecoveryCaller,
} from '../canonical-host/tdms-native-evidence-verifier.port';
import { canonical } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';

/** A queue may recheck a durable result without reviving its departed executor. */
export interface TdmsRecoveryDelegatedActor {
  readonly principalKind: 'RECOVERY_SERVICE_DELEGATE';
  readonly transport: 'HOST_VERIFIED_SERVICE';
  readonly identityProvenance: 'HOST_COMMIT_RECOVERY_DELEGATION';
  readonly canonicalSubject: {
    readonly namespace: 'MIAODA_USER_ID';
    readonly id: string;
  };
  readonly tenantId: string;
  readonly applicationScopeId: string;
  readonly servicePrincipalId: string;
  readonly workItemId: string;
  readonly attemptRef: string;
}
const minted = new WeakSet<object>();
export function assertTdmsRecoverySourceActor(
  actor: TdmsRecoveryDelegatedActor,
): void {
  if (!actor || !minted.has(actor)) deny();
}

/** All reads use the callback's held WorkItem -> grant -> attempt transaction.
 * This proof authorizes only existing saved carriers, never a native READ or SAVE. */
export async function authenticateTdmsRecoveryDelegation(input: {
  database: PostgresJsDatabase;
  authorization: CanonicalServiceScopeAuthorizationPort;
  caller: TdmsNativeRecoveryCaller;
  actor: TdmsNativeEvidenceActor;
}) {
  const { database, authorization, caller, actor } = input;
  await authorization.assertAutoWorkItemQueueTransport();
  const scope = await authorization.authorizeOpenClawAutoWorkItemQueue();
  if (
    canonical(scope) !== canonical(caller.scope) ||
    scope.appId !== 'app_17bzc551rsg' ||
    scope.tenantId !== actor.tenantId
  )
    deny();
  const [identity] = await database.execute<{
    roleName: string;
    actorId: string;
  }>(sql`
    SELECT current_user AS "roleName",current_setting('app.user_id',true) AS "actorId"`);
  if (
    identity?.roleName !== 'service_role_workspace_aadkpkjef3slu' ||
    identity.actorId !== actor.actorUserId
  )
    deny();
  const [owner] = await database
    .select({
      requestId: workItem.requestId,
      actorUserId: workItem.requestedByUserId,
      documentId: workItem.documentId,
      documentVersionId: workItem.documentVersionId,
      sourceArtifactId: workItem.sourceArtifactId,
      sourceFileSha256: workItem.sourceFileSha256,
      sourceByteLength: workItem.sourceByteLength,
    })
    .from(workItem)
    .where(
      and(
        eq(workItem.tenantId, actor.tenantId),
        eq(workItem.workItemId, caller.workItemId),
      ),
    )
    .limit(1)
    .for('update');
  if (
    !owner ||
    owner.actorUserId !== actor.actorUserId ||
    owner.documentVersionId !== caller.documentVersionId
  )
    deny();
  const [grant] = await database
    .select()
    .from(autoWorkItemAuthorization)
    .where(
      and(
        eq(autoWorkItemAuthorization.tenantId, actor.tenantId),
        eq(autoWorkItemAuthorization.workItemId, caller.workItemId),
      ),
    )
    .limit(1)
    .for('update');
  const now = new Date();
  if (
    !grant ||
    grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
    grant.status !== 'LEASED' ||
    grant.leaseOwner !== scope.principalId ||
    !grant.leaseToken ||
    !grant.leaseExpiresAt ||
    grant.leaseExpiresAt > now ||
    grant.requestId !== owner.requestId ||
    grant.actorUserId !== owner.actorUserId ||
    grant.documentId !== owner.documentId ||
    grant.documentVersionId !== owner.documentVersionId ||
    grant.sourceArtifactId !== owner.sourceArtifactId ||
    grant.sourceFileSha256 !== owner.sourceFileSha256 ||
    Number(grant.sourceByteLength) !== Number(owner.sourceByteLength)
  )
    deny();
  const [attempt] = await database
    .select({
      attemptId: actionAttempt.attemptId,
      actorUserId: actionAttempt.actorUserId,
      documentVersionId: actionAttempt.documentVersionId,
      actionType: actionAttempt.actionType,
      status: actionAttempt.status,
      leaseOwner: actionAttempt.leaseOwner,
      leaseToken: actionAttempt.leaseToken,
      leaseExpiresAt: actionAttempt.leaseExpiresAt,
      commitStartedAt: actionAttempt.commitStartedAt,
      cancelRequestedAt: actionAttempt.cancelRequestedAt,
      taskInputHash: actionAttempt.taskInputHash,
      resultContentHash: actionAttempt.resultContentHash,
      sealed: sql<
        Record<string, unknown>
      >`jsonb_build_object('attemptId',${actionAttempt.taskEnvelopeJson}::jsonb->>'actionAttemptId',
      'operationRef',${actionAttempt.taskEnvelopeJson}::jsonb->>'operationRef','tenantId',${actionAttempt.taskEnvelopeJson}::jsonb->>'tenantId',
      'workItemId',${actionAttempt.taskEnvelopeJson}::jsonb->>'workItemId','documentVersionId',${actionAttempt.taskEnvelopeJson}::jsonb->>'documentVersionId',
      'inputHash',${actionAttempt.taskEnvelopeJson}::jsonb->>'inputHash','owner',${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,actorUserId}',
      'requestId',${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,automaticWorkItemLease,requestId}',
      'generation',${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,automaticWorkItemLease,leaseGeneration}',
      'contentHash',${actionAttempt.resultEnvelopeJson}::jsonb->>'contentHash','resultStatus',${actionAttempt.resultEnvelopeJson}::jsonb->>'status')`,
    })
    .from(actionAttempt)
    .where(
      and(
        eq(actionAttempt.tenantId, actor.tenantId),
        eq(actionAttempt.workItemId, caller.workItemId),
        eq(actionAttempt.operationRef, caller.attemptRef),
      ),
    )
    .limit(1)
    .for('update');
  if (
    !attempt ||
    attempt.actorUserId !== 'service:openclaw-main' ||
    attempt.status !== 'COMMITTING' ||
    !['OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS'].includes(
      attempt.actionType,
    ) ||
    attempt.documentVersionId !== caller.documentVersionId ||
    attempt.leaseOwner !== scope.principalId ||
    !attempt.leaseToken ||
    !attempt.leaseExpiresAt ||
    attempt.leaseExpiresAt > now ||
    !attempt.commitStartedAt ||
    attempt.cancelRequestedAt ||
    attempt.taskInputHash !== caller.taskInputHash ||
    attempt.resultContentHash !== caller.resultContentHash
  )
    deny();
  if (
    canonical(attempt.sealed) !==
    canonical({
      attemptId: attempt.attemptId,
      operationRef: caller.attemptRef,
      tenantId: actor.tenantId,
      workItemId: caller.workItemId,
      documentVersionId: caller.documentVersionId,
      inputHash: caller.taskInputHash,
      owner: actor.actorUserId,
      requestId: grant.requestId,
      generation: grant.leaseGeneration,
      contentHash: caller.resultContentHash,
      resultStatus: 'SUCCEEDED',
    })
  )
    deny();
  const delegated: TdmsRecoveryDelegatedActor = Object.freeze({
    principalKind: 'RECOVERY_SERVICE_DELEGATE',
    transport: 'HOST_VERIFIED_SERVICE',
    identityProvenance: 'HOST_COMMIT_RECOVERY_DELEGATION',
    canonicalSubject: Object.freeze({
      namespace: 'MIAODA_USER_ID',
      id: actor.actorUserId,
    }),
    tenantId: actor.tenantId,
    applicationScopeId: scope.appId,
    servicePrincipalId: scope.principalId,
    workItemId: caller.workItemId,
    attemptRef: caller.attemptRef,
  });
  minted.add(delegated);
  return { actor: delegated, validUntil: Number.POSITIVE_INFINITY };
}
function deny(): never {
  throw tdmsError('TDMS_COMMIT_RECOVERY_DELEGATION_REJECTED', 403);
}
