import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { sql } from 'drizzle-orm';
import type { CanonicalServiceScopeAuthorizationPort } from '../canonical-host/canonical-service-scope.authorization';
import type {
  TdmsNativeEvidenceActor,
  TdmsNativeSummaryCaller,
} from '../canonical-host/tdms-native-evidence-verifier.port';
import { canonical, identifier } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';

/** A real summary invocation has no WorkItem service scope and is never a browser. */
export interface TdmsSummaryDelegatedActor {
  readonly principalKind: 'SUMMARY_SERVICE_DELEGATE';
  readonly transport: 'HOST_VERIFIED_SERVICE';
  readonly identityProvenance: 'HOST_SUMMARY_SCOPE_DELEGATION';
  readonly canonicalSubject: {
    readonly namespace: 'MIAODA_USER_ID';
    readonly id: string;
  };
  readonly tenantId: string;
  readonly applicationScopeId: string;
  readonly servicePrincipalId: string;
  readonly summaryId: string;
  readonly attemptRef: string;
}
const minted = new WeakSet<object>();
export function assertTdmsSummarySourceActor(
  actor: TdmsSummaryDelegatedActor,
): void {
  if (!actor || !minted.has(actor)) deny();
}

/** The caller already owns the transaction and SQL role. Do not open a pool
 * connection, set an identity, mint a lease or accept a fingerprint as transport. */
export async function authenticateTdmsSummaryDelegation(input: {
  database: PostgresJsDatabase;
  authorization: CanonicalServiceScopeAuthorizationPort;
  caller: Extract<TdmsNativeSummaryCaller, { kind: 'RUNTIME' }>;
  actor: TdmsNativeEvidenceActor;
}): Promise<{ actor: TdmsSummaryDelegatedActor; validUntil: number }> {
  const { database, authorization, caller, actor } = input;
  identifier(caller.summaryId);
  identifier(caller.attemptRef);
  identifier(actor.actorUserId);
  identifier(actor.tenantId);
  if (
    caller.purpose !== undefined &&
    caller.purpose !== 'EXECUTION' &&
    caller.purpose !== 'SAVED_RESULT'
  )
    deny();
  await authorization.assertAutoWorkItemQueueTransport();
  const current = await authorization.authorizeOpenClawAutoWorkItemQueue();
  if (
    canonical(current) !== canonical(caller.scope) ||
    current.appId !== 'app_17bzc551rsg' ||
    current.tenantId !== actor.tenantId ||
    !current.principalId ||
    !current.authorizationFingerprint
  )
    deny();
  const [identity] = await database.execute<{
    actorId: string | null;
    roleName: string;
    schemaName: string;
  }>(sql`
    SELECT current_setting('app.user_id',true) AS "actorId",current_user AS "roleName",current_schema() AS "schemaName"`);
  if (
    identity?.actorId !== actor.actorUserId ||
    identity.roleName !== 'service_role_workspace_aadkpkjef3slu' ||
    identity.schemaName !== 'workspace_aadkpkjef3slu'
  )
    deny();
  // Match existing summary transactions: head before attempt. These locks survive
  // the final native check and are released by the caller's actual commit/rollback.
  const heads = await database.execute<{ actorUserId: string }>(sql`
    SELECT actor_user_id AS "actorUserId" FROM derived_summary
    WHERE tenant_id=${actor.tenantId} AND summary_id=${caller.summaryId} FOR SHARE`);
  if (heads.length !== 1 || heads[0]!.actorUserId !== actor.actorUserId) deny();
  const rows = await database.execute<{
    attemptId: string;
    requestId: string;
    actorUserId: string;
    delegatedPrincipalId: string | null;
    subjectKind: string;
    actionType: string;
    workItemId: string | null;
    matterId: string | null;
    documentVersionId: string | null;
    status: string;
    leaseOwner: string | null;
    leaseToken: string | null;
    leaseGeneration: number;
    leaseExpiresAt: string | null;
    deadlineAt: string | null;
    cancelRequestedAt: string | null;
  }>(sql`SELECT attempt_id AS "attemptId", trigger_request_id AS "requestId", actor_user_id AS "actorUserId",summary_delegated_principal_id AS "delegatedPrincipalId",
    subject_kind AS "subjectKind",action_type AS "actionType",work_item_id AS "workItemId",matter_id AS "matterId",
    document_version_id AS "documentVersionId",status,lease_owner AS "leaseOwner",lease_token AS "leaseToken",
    lease_generation AS "leaseGeneration",lease_expires_at::text AS "leaseExpiresAt",deadline_at::text AS "deadlineAt",
    cancel_requested_at::text AS "cancelRequestedAt" FROM action_attempt
    WHERE tenant_id=${actor.tenantId} AND summary_id=${caller.summaryId} AND operation_ref=${caller.attemptRef} FOR UPDATE`);
  const row = rows[0],
    now = Date.now();
  if (
    rows.length !== 1 ||
    !row ||
    row.actorUserId !== actor.actorUserId ||
    row.delegatedPrincipalId !== current.principalId ||
    row.subjectKind !== 'DERIVED_SUMMARY' ||
    row.actionType !== 'OPENCLAW_DERIVED_SUMMARY' ||
    row.workItemId !== null ||
    row.matterId !== null ||
    row.documentVersionId !== null ||
    row.cancelRequestedAt !== null
  )
    deny();
  let validUntil = Number.POSITIVE_INFINITY;
  if (caller.purpose === 'SAVED_RESULT') {
    identifier(caller.requestId);
    if (row.status !== 'SUCCEEDED' || row.requestId !== caller.requestId)
      deny();
    // An ended lease cannot authorize new execution. A genuine saved-result read
    // instead proves its exact durable revision without returning any body bytes.
    const saved = await database.execute<{ summaryRef: string }>(sql`
      SELECT summary_ref AS "summaryRef" FROM derived_summary_revision
      WHERE tenant_id=${actor.tenantId} AND actor_user_id=${actor.actorUserId}
        AND summary_id=${caller.summaryId} AND attempt_id=${row.attemptId} AND request_id=${caller.requestId}
        AND content_json->>'attemptRef'=${caller.attemptRef} AND content_json->>'requestId'=${caller.requestId}
      FOR SHARE`);
    if (saved.length !== 1) deny();
  } else {
    if (
      !['RUNNING', 'COMMITTING'].includes(row.status) ||
      row.leaseOwner !== current.principalId ||
      !row.leaseToken ||
      !Number.isSafeInteger(row.leaseGeneration) ||
      row.leaseGeneration < 1 ||
      !row.leaseExpiresAt ||
      !row.deadlineAt
    )
      deny();
    validUntil = Math.min(
      Date.parse(row.leaseExpiresAt),
      Date.parse(row.deadlineAt),
    );
    if (!Number.isFinite(validUntil) || validUntil <= now) deny();
  }
  const delegated: TdmsSummaryDelegatedActor = Object.freeze({
    principalKind: 'SUMMARY_SERVICE_DELEGATE',
    transport: 'HOST_VERIFIED_SERVICE',
    identityProvenance: 'HOST_SUMMARY_SCOPE_DELEGATION',
    canonicalSubject: Object.freeze({
      namespace: 'MIAODA_USER_ID',
      id: actor.actorUserId,
    }),
    tenantId: actor.tenantId,
    applicationScopeId: current.appId,
    servicePrincipalId: current.principalId,
    summaryId: caller.summaryId,
    attemptRef: caller.attemptRef,
  });
  minted.add(delegated);
  return { actor: delegated, validUntil };
}
function deny(): never {
  throw tdmsError('TDMS_SUMMARY_DELEGATION_REJECTED', 403);
}
