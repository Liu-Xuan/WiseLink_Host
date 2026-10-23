import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, sql } from 'drizzle-orm';
import type {
  CanonicalExecutionModelSelection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { actionAttempt, workItem } from '../../database/schema';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { canonicalJson, parseTaskEnvelope } from './action-attempt-envelope';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { matchesCancelledAttempt } from '../work-item/cancelled-auto-processing-lease';
import { parseAutomaticWorkItemCancellation } from '../canonical-host/automatic-work-item-cancellation';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';

export const CANCELLED_INITIAL_QUEUE_CODE =
  'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED';
export const FAILED_INITIAL_QUEUE_CODE = 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED';
export interface CancelledInitialContinuationBinding {
  actorUserId: string;
  tenantId: string;
  workItem: CanonicalWorkItemProjection;
  cancelledAttemptId: string;
  terminalStatus: 'CANCELLED' | 'FAILED' | 'TIMED_OUT';
  blockedCode: string;
  blockedAt: string;
  leaseGeneration: number;
  terminalInputHash: string;
  terminalRequestId: string;
  executionModel: CanonicalExecutionModelSelection;
}
export interface CancelledInitialContinuationGuard {
  binding: CancelledInitialContinuationBinding;
  authorize(database: PostgresJsDatabase): Promise<void>;
}

/** Read-only UI eligibility is only a hint; reservation repeats these checks under locks. */
export async function readCancelledInitialContinuation(
  database: PostgresJsDatabase,
  input: {
    actorUserId: string;
    tenantId: string;
    workItem: CanonicalWorkItemProjection;
  },
  lock = false,
) {
  const ownerQuery = database
    .select()
    .from(workItem)
    .where(
      and(
        eq(workItem.tenantId, input.tenantId),
        eq(workItem.workItemId, input.workItem.workItemId),
      ),
    )
    .limit(1);
  const [owner] = await (lock ? ownerQuery.for('update') : ownerQuery);
  if (
    !owner ||
    !input.workItem.package ||
    input.workItem.configurationEvidenceReevaluation ||
    !matchesInitialContinuationOwner(owner, input)
  )
    return null;
  const grantQuery = database
    .select()
    .from(autoWorkItemAuthorization)
    .where(
      and(
        eq(autoWorkItemAuthorization.tenantId, input.tenantId),
        eq(autoWorkItemAuthorization.workItemId, owner.workItemId),
      ),
    )
    .limit(1);
  const [grant] = await (lock ? grantQuery.for('update') : grantQuery);
  if (
    !grant ||
    grant.tenantId !== input.tenantId ||
    grant.workItemId !== owner.workItemId ||
    grant.status !== 'BLOCKED' ||
    ![CANCELLED_INITIAL_QUEUE_CODE, FAILED_INITIAL_QUEUE_CODE].includes(
      grant.blockedCode ?? '',
    ) ||
    !grant.blockedAt ||
    !/^[a-f0-9]{64}$/u.test(grant.blockedLeaseTokenHash ?? '') ||
    grant.blockedLeaseGeneration !== grant.leaseGeneration ||
    grant.leaseGeneration < 1 ||
    grant.leaseOwner !== null ||
    grant.leaseToken !== null ||
    grant.leaseExpiresAt !== null ||
    grant.completedAt !== null ||
    grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
    grant.actorUserId !== owner.requestedByUserId ||
    grant.requestId !== owner.requestId ||
    grant.documentId !== owner.documentId ||
    grant.documentVersionId !== owner.documentVersionId ||
    grant.sourceArtifactId !== owner.sourceArtifactId ||
    grant.sourceFileSha256 !== owner.sourceFileSha256 ||
    Number(grant.sourceByteLength) !== Number(owner.sourceByteLength)
  )
    return null;
  const query = database
    .select()
    .from(actionAttempt)
    .where(
      and(
        eq(actionAttempt.tenantId, input.tenantId),
        eq(actionAttempt.workItemId, owner.workItemId),
      ),
    );
  const rows = await (lock ? query.for('share') : query);
  const target = [...rows].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.attemptNo - a.attemptNo,
  )[0];
  const model = grant.blockedCode === CANCELLED_INITIAL_QUEUE_CODE
    ? readStoredExecutionModel(owner.analysisModelJson)
    : effectiveFailedContinuationModel(owner.analysisModelJson, rows);
  if (
    !target ||
    !model ||
    !(grant.blockedCode === CANCELLED_INITIAL_QUEUE_CODE
      ? matchesCancellation(target, owner, model)
      : matchesFailedAttempt(target, owner, grant.blockedAt)) ||
    rows.some(
      (row) =>
        row.attemptId !== target.attemptId &&
        (row.createdAt.getTime() >= target.createdAt.getTime() ||
          (row.actionType === target.actionType &&
            row.attemptNo > target.attemptNo)),
    ) ||
    rows.some((row) =>
      ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
        row.status,
      ),
    )
  )
    return null;
  return {
    owner,
    grant,
    target,
    binding: {
      ...input,
      cancelledAttemptId: target.attemptId,
      terminalStatus: target.status as 'CANCELLED' | 'FAILED' | 'TIMED_OUT',
      blockedCode: grant.blockedCode,
      blockedAt: grant.blockedAt.toISOString(),
      leaseGeneration: grant.leaseGeneration,
      terminalInputHash: target.taskInputHash!,
      terminalRequestId: target.triggerRequestId!,
      executionModel: model,
    },
  };
}

export async function assertCancelledInitialContinuation(
  database: PostgresJsDatabase,
  guard: CancelledInitialContinuationGuard,
) {
  const value = await readCancelledInitialContinuation(
    database,
    guard.binding,
    true,
  );
  if (
    !value ||
    value.target.attemptId !== guard.binding.cancelledAttemptId ||
    value.binding.terminalStatus !== guard.binding.terminalStatus ||
    value.binding.blockedCode !== guard.binding.blockedCode ||
    value.binding.blockedAt !== guard.binding.blockedAt ||
    value.binding.leaseGeneration !== guard.binding.leaseGeneration ||
    value.binding.terminalInputHash !== guard.binding.terminalInputHash ||
    value.binding.terminalRequestId !== guard.binding.terminalRequestId ||
    canonicalJson(value.binding.executionModel) !==
      canonicalJson(guard.binding.executionModel)
  )
    throw cancelledContinuationConflict();
  const source = await new MiaodaDocumentVersionSourceResolver(
    database,
  ).resolve(value.owner.documentVersionId, {
    requireCurrent: true,
    expectedCreatorUserId: guard.binding.actorUserId,
  });
  if (
    source.version.documentId !== value.owner.documentId ||
    source.version.sourceArtifactId !== value.owner.sourceArtifactId ||
    source.version.pdfSha256 !== value.owner.sourceFileSha256 ||
    Number(source.version.byteLength) !== Number(value.owner.sourceByteLength)
  )
    throw cancelledContinuationConflict();
  await guard.authorize(database);
  return async () => {
    const rows = await database
      .update(autoWorkItemAuthorization)
      .set({
        status: 'WAITING',
        updatedAt: sql`clock_timestamp()`,
        // Preserve the terminal receipt and original grant; the next normal claim clears blockedCode.
      })
      .where(
        and(
          eq(autoWorkItemAuthorization.tenantId, guard.binding.tenantId),
          eq(autoWorkItemAuthorization.workItemId, value.owner.workItemId),
          eq(autoWorkItemAuthorization.actorUserId, value.owner.requestedByUserId),
          eq(autoWorkItemAuthorization.requestId, value.owner.requestId),
          eq(autoWorkItemAuthorization.documentId, value.owner.documentId),
          eq(autoWorkItemAuthorization.documentVersionId, value.owner.documentVersionId),
          eq(autoWorkItemAuthorization.sourceArtifactId, value.owner.sourceArtifactId),
          eq(autoWorkItemAuthorization.sourceFileSha256, value.owner.sourceFileSha256),
          eq(autoWorkItemAuthorization.sourceByteLength, value.owner.sourceByteLength),
          eq(autoWorkItemAuthorization.status, 'BLOCKED'),
          eq(
            autoWorkItemAuthorization.blockedCode,
            guard.binding.blockedCode,
          ),
          eq(
            autoWorkItemAuthorization.leaseGeneration,
            value.grant.leaseGeneration,
          ),
          eq(autoWorkItemAuthorization.blockedAt, value.grant.blockedAt!),
          eq(autoWorkItemAuthorization.blockedLeaseGeneration, value.grant.blockedLeaseGeneration!),
          eq(autoWorkItemAuthorization.blockedLeaseTokenHash, value.grant.blockedLeaseTokenHash!),
        ),
      )
      .returning({ id: autoWorkItemAuthorization.workItemId });
    if (rows.length !== 1) throw cancelledContinuationConflict();
  };
}

/** Fresh browser ownership check, including its exact persisted projection. */
export function matchesInitialContinuationOwner(
  owner: typeof workItem.$inferSelect,
  input: {
    actorUserId: string;
    tenantId: string;
    workItem: CanonicalWorkItemProjection;
  },
) {
  const expected = input.workItem;
  try {
    return (
      owner.tenantId === input.tenantId &&
      owner.workItemId === expected.workItemId &&
      owner.requestedByUserId === input.actorUserId &&
      !input.actorUserId.startsWith('service:') &&
      owner.revision === expected.revision &&
      owner.requestId === expected.requestId &&
      owner.actionType === 'PARSE_PDF' &&
      owner.status === 'CANDIDATE_READBACK_VERIFIED' &&
      expected.phase === 'CANDIDATE_READBACK_VERIFIED' &&
      (owner.packageId ?? null) === (expected.package?.packageId ?? null) &&
      (owner.packageArtifactRef ?? null) === (expected.package?.artifact.ref ?? null) &&
      (owner.packageArtifactSha256 ?? null) === (expected.package?.artifact.sha256 ?? null) &&
      owner.documentId === expected.source.documentId &&
      owner.documentVersionId === expected.source.documentVersionId &&
      owner.sourceArtifactId === expected.source.sourceArtifactId &&
      owner.sourceFileSha256 ===
        expected.source.sourceFileSha256.replace(/^sha256:/u, '') &&
      Number(owner.sourceByteLength) === expected.source.sourceByteLength &&
      canonicalJson(JSON.parse(owner.projectionJson!)) ===
        canonicalJson(expected)
    );
  } catch {
    return false;
  }
}
function matchesFailedAttempt(
  target: typeof actionAttempt.$inferSelect,
  owner: typeof workItem.$inferSelect,
  blockedAt: Date,
): boolean {
  if (
    target.tenantId !== owner.tenantId ||
    target.workItemId !== owner.workItemId ||
    target.subjectKind !== 'WORK_ITEM' ||
    target.requestOrigin !== 'OPENCLAW_MCP_V1' ||
    (target.actorUserId !== owner.requestedByUserId &&
      target.actorUserId !== 'service:openclaw-main') ||
    target.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
    target.documentVersionId !== owner.documentVersionId ||
    target.inputRevision !== owner.revision ||
    target.baseRevision !== owner.revision ||
    !target.triggerRequestId?.trim() ||
    !['FAILED', 'TIMED_OUT'].includes(target.status) ||
    !target.completedAt ||
    blockedAt.getTime() < target.completedAt.getTime() ||
    target.commitStartedAt !== null ||
    target.projectionApplied ||
    target.resultEnvelopeJson !== null ||
    target.resultContentHash !== null ||
    target.leaseOwner !== null ||
    target.leaseToken !== null ||
    target.leaseExpiresAt !== null
  )
    return false;
  try {
    const task = parseTaskEnvelope(String(target.taskEnvelopeJson));
    const targetModel = readStoredExecutionModel(target.executionModelJson);
    return (
      !!targetModel &&
      task.actionAttemptId === target.attemptId &&
      task.operationRef === target.operationRef &&
      task.taskType === target.actionType &&
      task.workItemId === owner.workItemId &&
      task.tenantId === owner.tenantId &&
      task.documentVersionId === owner.documentVersionId &&
      task.inputRevision === target.inputRevision &&
      task.baseRevision === target.baseRevision &&
      task.idempotencyKey === target.idempotencyKey &&
      task.inputHash === target.taskInputHash &&
      canonicalJson(task.executionModel) === canonicalJson(targetModel)
    );
  } catch {
    return false;
  }
}
function effectiveFailedContinuationModel(
  ownerModel: string | null,
  rows: readonly (typeof actionAttempt.$inferSelect)[],
): CanonicalExecutionModelSelection | null {
  if (ownerModel !== null) return readStoredExecutionModel(ownerModel);
  // Match readWorkItemModel: legacy objects inherit their first real initial
  // model, never the current global preference or a later Review override.
  const first = [...rows].filter((row) =>
    ['OPENCLAW_TRANSLATE', 'OPENCLAW_APPLICABILITY_EVALUATION',
      'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS'].includes(row.actionType) &&
    row.executionModelJson !== null,
  ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() ||
    a.attemptId.localeCompare(b.attemptId))[0];
  return readStoredExecutionModel(first?.executionModelJson);
}
function matchesCancellation(
  target: typeof actionAttempt.$inferSelect,
  owner: typeof workItem.$inferSelect,
  model: CanonicalExecutionModelSelection,
) {
  if (
    target.inputRevision !== owner.revision ||
    target.baseRevision !== owner.revision
  )
    return false;
  try {
    const expectedCancellation = parseAutomaticWorkItemCancellation({
      requestId: owner.requestId,
      workItemRevision: owner.revision,
      documentId: owner.documentId,
      documentVersionId: owner.documentVersionId,
      sourceArtifactId: owner.sourceArtifactId,
      sourceFileSha256: owner.sourceFileSha256,
      sourceByteLength: Number(owner.sourceByteLength),
      attemptId: target.attemptId,
      attemptRef: target.operationRef,
      attemptNo: target.attemptNo,
      attemptRequestId: target.triggerRequestId,
      actionType: target.actionType,
      inputRevision: target.inputRevision,
      baseRevision: target.baseRevision,
      inputHash: target.taskInputHash,
      executionModel: model,
    });
    return matchesCancelledAttempt(target, owner, {
      tenantId: owner.tenantId,
      workItemId: owner.workItemId,
      expectedCancellation,
    });
  } catch {
    return false;
  }
}
export function cancelledContinuationConflict() {
  return Object.assign(
    new Error('INITIAL_CONTINUATION_CANCELLED_BINDING_CHANGED'),
    { statusCode: 409 },
  );
}
