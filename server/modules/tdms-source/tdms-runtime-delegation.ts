import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import { actionAttempt, workItem } from '../../database/schema';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import type { CanonicalServiceScopeAuthorizationPort } from '../canonical-host/canonical-service-scope.authorization';
import type {
  TdmsRuntimePrincipal,
  TdmsRuntimeTaskBinding,
} from './tdms-runtime-reader.port';
import type { TdmsPublicActor } from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import { assertPublicActor } from './tdms-source.authorization';
import { canonical } from './tdms-source.validation';
import { assertAutomaticWorkItemAttemptLease } from '../action-attempt/automatic-work-item-attempt-lease';
import { assertTdmsSummarySourceActor, type TdmsSummaryDelegatedActor } from './tdms-summary-delegation';
import { assertTdmsRecoverySourceActor, type TdmsRecoveryDelegatedActor } from './tdms-recovery-delegation';
import { authenticateTdmsReviewDelegation, tdmsReviewBinding, assertTdmsReviewSourceActor, type TdmsReviewDelegatedActor } from './tdms-review-delegation';

/** A delegated owner is never a browser FINAL_USER or a browser session. */
export interface TdmsRuntimeDelegatedActor {
  readonly principalKind: 'SERVICE_DELEGATE';
  readonly transport: 'HOST_VERIFIED_SERVICE';
  readonly identityProvenance: 'HOST_SERVICE_SCOPE_DELEGATION';
  readonly canonicalSubject: {
    readonly namespace: 'MIAODA_USER_ID';
    readonly id: string;
  };
  readonly tenantId: string;
  readonly applicationScopeId: string;
  readonly servicePrincipalId: string;
  readonly workItemId: string;
  readonly authorityExpiresAt: number;
}
export type TdmsSourceActor = TdmsPublicActor | TdmsRuntimeDelegatedActor | TdmsSummaryDelegatedActor | TdmsRecoveryDelegatedActor | TdmsReviewDelegatedActor;
const minted = new WeakSet<object>();

export function assertTdmsSourceActor(actor: TdmsSourceActor): void {
  if (actor?.principalKind === 'FINAL_USER') return assertPublicActor(actor);
  if (actor?.principalKind === 'SUMMARY_SERVICE_DELEGATE') return assertTdmsSummarySourceActor(actor);
  if (actor?.principalKind === 'RECOVERY_SERVICE_DELEGATE') return assertTdmsRecoverySourceActor(actor);
  if (actor?.principalKind === 'REVIEW_SERVICE_DELEGATE') return assertTdmsReviewSourceActor(actor);
  if (!actor || !minted.has(actor))
    throw tdmsError('TDMS_VERIFIED_SERVICE_DELEGATION_REQUIRED', 401);
}

/** Only the supplied transaction is touched. It already runs under Host's verified
 * service role and owner SQL context; this does not manufacture either identity. */
export async function authenticateTdmsRuntimeDelegation(input: {
  database: PostgresJsDatabase;
  authorization: CanonicalServiceScopeAuthorizationPort;
  principal: TdmsRuntimePrincipal;
  binding: TdmsRuntimeTaskBinding;
  stage?: 'METADATA' | 'EXECUTION' | 'SAVED_VERIFICATION';
}): Promise<TdmsRuntimeDelegatedActor> {
  const { database, authorization, principal, binding } = input;
  const scope = principal.scope;
  if (!authorization.assertOpenClawWorkItemTransport)
    throw tdmsError('TDMS_RUNTIME_TRANSPORT_AUTHORITY_UNAVAILABLE', 503);
  await authorization.assertOpenClawWorkItemTransport(scope);
  if (
    scope.tenantId !== binding.tenantId ||
    scope.workItemId !== binding.workItemId ||
    principal.actorUserId !== binding.actorUserId ||
    !binding.taskContextRef
  )
    deny();
  const [identity] = await database.execute<{
    roleName: string;
    actorId: string | null;
  }>(
    sql`SELECT current_user AS "roleName", current_setting('app.user_id',true) AS "actorId"`,
  );
  if (
    identity?.roleName !== 'service_role_workspace_aadkpkjef3slu' ||
    identity.actorId !== binding.actorUserId
  )
    deny();
  // The same order as source consumers: WorkItem, queue grant, action attempt.
  const [owner] = await database
    .select({
      requestedByUserId: workItem.requestedByUserId,
      requestId: workItem.requestId,
      documentId: workItem.documentId,
      documentVersionId: workItem.documentVersionId,
      sourceArtifactId: workItem.sourceArtifactId,
      sourceFileSha256: workItem.sourceFileSha256,
      sourceByteLength: workItem.sourceByteLength,
    })
    .from(workItem)
    .where(
      and(
        eq(workItem.tenantId, binding.tenantId),
        eq(workItem.workItemId, binding.workItemId),
      ),
    )
    .limit(1)
    .for('update');
  if (
    !owner ||
    owner.requestedByUserId !== binding.actorUserId ||
    owner.documentVersionId !== binding.documentVersionId
  )
    deny();
  let expiresAt = Number.POSITIVE_INFINITY;
  const automatic = scope.automaticWorkItemLease;
  if (automatic) {
    const [grant] = await database
      .select()
      .from(autoWorkItemAuthorization)
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, binding.tenantId),
          eq(autoWorkItemAuthorization.workItemId, binding.workItemId),
        ),
      )
      .limit(1)
      .for('share');
    if (
      !grant ||
      grant.status !== 'LEASED' ||
      grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
      grant.leaseOwner !== scope.principalId ||
      !grant.leaseExpiresAt ||
      grant.leaseExpiresAt <= new Date() ||
      grant.leaseGeneration !== automatic.leaseGeneration ||
      grant.requestId !== automatic.requestId ||
      grant.requestId !== owner.requestId ||
      grant.actorUserId !== owner.requestedByUserId ||
      grant.documentId !== owner.documentId ||
      grant.documentVersionId !== owner.documentVersionId ||
      grant.sourceArtifactId !== owner.sourceArtifactId ||
      grant.sourceFileSha256 !== owner.sourceFileSha256 ||
      Number(grant.sourceByteLength) !== Number(owner.sourceByteLength) ||
      automatic.actorUserId !== owner.requestedByUserId ||
      automatic.documentId !== owner.documentId ||
      automatic.documentVersionId !== owner.documentVersionId ||
      automatic.sourceArtifactId !== owner.sourceArtifactId ||
      automatic.sourceFileSha256 !== owner.sourceFileSha256 ||
      Number(automatic.sourceByteLength) !== Number(owner.sourceByteLength)
    )
      deny();
    expiresAt = Math.min(expiresAt, grant.leaseExpiresAt!.getTime());
  }
  // Current execution and historical saved task are different identities. A saved
  // SUCCEEDED task may be checked by a new admission; its old lease is not renewed.
  if ('attemptRef' in scope) {
    if (typeof scope.attemptRef !== 'string' || !scope.attemptRef) deny();
    const [observed] = await database
      .select(attemptMetadata)
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, binding.tenantId),
          eq(actionAttempt.operationRef, scope.attemptRef),
          eq(actionAttempt.workItemId, binding.workItemId),
        ),
      )
      .limit(1);
    if (!observed) deny();
    const historicalObserved =
      input.stage !== 'EXECUTION' && observed.status === 'SUCCEEDED';
    if (!historicalObserved)
      await assertAutomaticWorkItemAttemptLease(
        database,
        observed,
        scope.principalId,
        automatic !== undefined,
      );
    const [attempt] = await database
      .select(attemptMetadata)
      .from(actionAttempt)
      .where(eq(actionAttempt.id, observed.id))
      .limit(1)
      .for('update');
    const historical =
      input.stage !== 'EXECUTION' && attempt?.status === 'SUCCEEDED';
    if (
      !attempt ||
      attempt.actorUserId !== 'service:openclaw-main' ||
      attempt.ownerUserId !== binding.actorUserId ||
      attempt.documentVersionId !== binding.documentVersionId ||
      attempt.cancelRequestedAt ||
      (!historical &&
        (attempt.leaseOwner !== scope.principalId ||
          !['RUNNING', 'COMMITTING'].includes(attempt.status) ||
          !attempt.leaseToken ||
          !attempt.leaseExpiresAt ||
          attempt.leaseExpiresAt <= new Date() ||
          !attempt.deadlineAt ||
          attempt.deadlineAt <= new Date())) ||
      attempt.taskInputHash !== observed.taskInputHash
    )
      deny();
    if (!historical)
      expiresAt = Math.min(
        expiresAt,
        attempt.leaseExpiresAt!.getTime(),
        attempt.deadlineAt!.getTime(),
      );
  } else if (input.stage === 'EXECUTION') deny();
  if (expiresAt <= Date.now()) deny();
  const actor: TdmsRuntimeDelegatedActor = Object.freeze({
    principalKind: 'SERVICE_DELEGATE',
    transport: 'HOST_VERIFIED_SERVICE',
    identityProvenance: 'HOST_SERVICE_SCOPE_DELEGATION',
    canonicalSubject: Object.freeze({
      namespace: 'MIAODA_USER_ID',
      id: binding.actorUserId,
    }),
    tenantId: binding.tenantId,
    applicationScopeId: scope.appId,
    servicePrincipalId: scope.principalId,
    workItemId: binding.workItemId,
    authorityExpiresAt: expiresAt,
  });
  minted.add(actor);
  return actor;
}

/** The ordinary transport/actor algorithm above remains unchanged. Review
 * authority comes only from the private handle and current handed-TX binding. */
export async function authenticateTdmsPrincipal(input: Parameters<typeof authenticateTdmsRuntimeDelegation>[0]) {
  const caller=input.principal.reviewCaller;
  if(!caller) return authenticateTdmsRuntimeDelegation(input);
  const bound=tdmsReviewBinding(caller), {binding,principal}=input;
  if(canonical(principal.scope)!==canonical(bound.scope)||principal.actorUserId!==bound.actorUserId ||
      binding.tenantId!==bound.tenantId||binding.workItemId!==bound.workItemId||
      binding.documentVersionId!==bound.documentVersionId||binding.actorUserId!==bound.actorUserId ||
      (input.stage==='EXECUTION'&&(bound.attempt?.phase!=='EXECUTION'||bound.attempt.status!=='RUNNING'))) deny();
  return (await authenticateTdmsReviewDelegation({database:input.database,authorization:input.authorization,
    caller,actor:{tenantId:binding.tenantId,actorUserId:binding.actorUserId}})).actor;
}

export function assertTdmsRuntimeReadContext(
  actor: TdmsSourceActor,
  context: unknown,
): void {
  assertTdmsSourceActor(actor);
  if (
    !['SERVICE_DELEGATE','REVIEW_SERVICE_DELEGATE'].includes(actor.principalKind) ||
    canonical(context) !== canonical({ workItemId: 'workItemId' in actor ? actor.workItemId : null })
  )
    throw tdmsError('TDMS_RUNTIME_READ_CONTEXT_MISMATCH', 403);
}
function deny(): never {
  throw tdmsError('TDMS_RUNTIME_DELEGATION_REJECTED', 403);
}

// Finite projection: task journals/results/previousWork can contain native bodies.
// Authentication and metadata discovery must never fetch those columns or payloads.
const attemptMetadata = {
  id: actionAttempt.id,
  tenantId: actionAttempt.tenantId,
  workItemId: actionAttempt.workItemId,
  documentVersionId: actionAttempt.documentVersionId,
  actorUserId: actionAttempt.actorUserId,
  ownerUserId: sql<string>`${actionAttempt.taskEnvelopeJson}::jsonb#>>'{modelInput,actorUserId}'`,
  status: actionAttempt.status,
  leaseOwner: actionAttempt.leaseOwner,
  leaseToken: actionAttempt.leaseToken,
  leaseGeneration: actionAttempt.leaseGeneration,
  leaseExpiresAt: actionAttempt.leaseExpiresAt,
  deadlineAt: actionAttempt.deadlineAt,
  cancelRequestedAt: actionAttempt.cancelRequestedAt,
  taskInputHash: actionAttempt.taskInputHash,
  taskEnvelopeJson: sql<string>`(CASE WHEN ${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,automaticWorkItemLease}' IS NULL
    THEN '{}'::jsonb ELSE jsonb_build_object('modelInput',jsonb_build_object('automaticWorkItemLease',
      ${actionAttempt.taskEnvelopeJson}::jsonb#>'{modelInput,automaticWorkItemLease}')) END)::text`,
};
