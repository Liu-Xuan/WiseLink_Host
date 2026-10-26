import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { AutomaticWorkItemCancellationBinding, CanonicalExecutionModelSelection } from '@shared/api.interface';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { actionAttempt, workItem } from '../../database/schema';
import { canonicalJson, parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';
import type { OpenClawTaskEnvelope } from '../action-attempt/action-attempt-envelope.types';
import { INITIAL_ANALYSIS_REQUEST_SCHEMA, readInitialAnalysisRequestInput } from '../action-attempt/initial-analysis-request';
import { readStoredExecutionModel } from '../model-settings/canonical-execution-model';
import { CANCELLED_AUTOMATIC_WORK_ITEM_CODE } from '../canonical-host/automatic-work-item-cancellation';
import { isJobAidProblemTask, parseJobAidProblemTask } from '../canonical-host/jobaid-problem-task';
import { isProgramAssessmentMode } from '../canonical-host/program-agent-policy';

export interface CancelledAutoProcessingLeaseInput {
  tenantId: string;
  workItemId: string;
  actorUserId: string;
  leaseOwner: string;
  leaseToken: string;
  leaseGeneration: number;
  expectedCancellation: AutomaticWorkItemCancellationBinding;
  replayOnly: boolean;
}

/** WI first, then authorization and all its attempts. No attempt/JA is changed. */
export async function parkCancelledAutoProcessingLease(
  db: PostgresJsDatabase,
  input: CancelledAutoProcessingLeaseInput,
): Promise<{ blockedAt: Date; blockedCode: string; replayed: boolean } | null> {
  return db.transaction(async transaction => {
    // This is also the initial reserve/SAVE lock. FOR UPDATE conflicts with the
    // work_item FK's KEY SHARE lock for every new WI attempt, even legacy ones.
    // Query attempts only after acquiring it; no earlier snapshot may authorize PARK.
    const [owner] = await transaction.select().from(workItem).where(and(
      eq(workItem.tenantId, input.tenantId), eq(workItem.workItemId, input.workItemId),
    )).limit(1).for('update');
    const expected = input.expectedCancellation;
    if (!owner || owner.tenantId !== input.tenantId || owner.workItemId !== input.workItemId ||
        owner.requestedByUserId !== input.actorUserId || owner.requestId !== expected.requestId ||
        owner.revision !== expected.workItemRevision || owner.documentId !== expected.documentId ||
        owner.documentVersionId !== expected.documentVersionId ||
        owner.sourceArtifactId !== expected.sourceArtifactId ||
        owner.sourceFileSha256 !== expected.sourceFileSha256 ||
        Number(owner.sourceByteLength) !== expected.sourceByteLength ||
        owner.actionType !== 'PARSE_PDF' || owner.status !== 'CANDIDATE_READBACK_VERIFIED' ||
        !owner.packageId || !matchesCurrentProjection(owner) ||
        expected.inputRevision !== owner.revision || expected.baseRevision !== owner.revision) return null;
    const [grant] = await transaction.select().from(autoWorkItemAuthorization).where(and(
      eq(autoWorkItemAuthorization.tenantId, input.tenantId),
      eq(autoWorkItemAuthorization.workItemId, input.workItemId),
    )).limit(1).for('update');
    if (!grant || grant.grantKind !== 'MIAODA_CANONICAL_PARSE_REQUEST' ||
        grant.tenantId !== input.tenantId || grant.workItemId !== input.workItemId ||
        grant.actorUserId !== input.actorUserId || grant.requestId !== owner.requestId ||
        grant.documentId !== owner.documentId || grant.documentVersionId !== owner.documentVersionId ||
        grant.sourceArtifactId !== owner.sourceArtifactId ||
        grant.sourceFileSha256 !== owner.sourceFileSha256 ||
        Number(grant.sourceByteLength) !== Number(owner.sourceByteLength)) return null;

    const attempts = await transaction.select().from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, input.tenantId), eq(actionAttempt.workItemId, input.workItemId),
    )).for('update');
    const target = attempts.find(row => row.attemptId === expected.attemptId);
    if (!target || !matchesCancelledAttempt(target, owner, input) ||
        attempts.some(row => row.attemptId !== target.attemptId && (
          row.createdAt.getTime() >= target.createdAt.getTime() ||
          (row.actionType === target.actionType && row.attemptNo > target.attemptNo))) ||
        attempts.some(row => ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(row.status))) return null;

    const tokenHash = createHash('sha256').update(input.leaseToken).digest('hex');
    if (grant.status === 'BLOCKED') {
      if (grant.blockedCode !== CANCELLED_AUTOMATIC_WORK_ITEM_CODE ||
          grant.blockedLeaseTokenHash !== tokenHash ||
          grant.blockedLeaseGeneration !== input.leaseGeneration || !grant.blockedAt) return null;
      return { blockedAt: grant.blockedAt, blockedCode: grant.blockedCode, replayed: true };
    }
    if (input.replayOnly || grant.status !== 'LEASED' || grant.leaseOwner !== input.leaseOwner ||
        grant.leaseToken !== input.leaseToken || grant.leaseGeneration !== input.leaseGeneration) return null;
    const [blocked] = await transaction.update(autoWorkItemAuthorization).set({
      status: 'BLOCKED', leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
      blockedCode: CANCELLED_AUTOMATIC_WORK_ITEM_CODE, blockedLeaseTokenHash: tokenHash,
      blockedLeaseGeneration: input.leaseGeneration,
      blockedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()`,
    }).where(and(
      eq(autoWorkItemAuthorization.tenantId, input.tenantId),
      eq(autoWorkItemAuthorization.workItemId, input.workItemId),
      eq(autoWorkItemAuthorization.status, 'LEASED'),
      eq(autoWorkItemAuthorization.leaseOwner, input.leaseOwner),
      eq(autoWorkItemAuthorization.leaseToken, input.leaseToken),
      eq(autoWorkItemAuthorization.leaseGeneration, input.leaseGeneration),
      // Wall clock after locks, not transaction start or service preflight time.
      gt(autoWorkItemAuthorization.leaseExpiresAt, sql`clock_timestamp()`),
    )).returning({ blockedAt: autoWorkItemAuthorization.blockedAt,
      blockedCode: autoWorkItemAuthorization.blockedCode });
    return blocked?.blockedAt && blocked.blockedCode
      ? { blockedAt: blocked.blockedAt, blockedCode: blocked.blockedCode, replayed: false } : null;
  });
}

function matchesCurrentProjection(owner: typeof workItem.$inferSelect): boolean {
  try {
    const projection = JSON.parse(String(owner.projectionJson));
    return projection.workItemId === owner.workItemId && projection.requestId === owner.requestId &&
      projection.phase === 'CANDIDATE_READBACK_VERIFIED' && projection.revision === owner.revision &&
      projection.package?.packageId === owner.packageId &&
      projection.source?.documentId === owner.documentId &&
      projection.source.documentVersionId === owner.documentVersionId &&
      projection.source.sourceArtifactId === owner.sourceArtifactId &&
      projection.source.sourceFileSha256.replace(/^sha256:/u, '') === owner.sourceFileSha256 &&
      projection.source.sourceByteLength === Number(owner.sourceByteLength);
  } catch { return false; }
}

export function matchesCancelledAttempt(
  target: typeof actionAttempt.$inferSelect,
  owner: typeof workItem.$inferSelect,
  input: Pick<CancelledAutoProcessingLeaseInput, 'tenantId' | 'workItemId' | 'expectedCancellation'>,
): boolean {
  const expected = input.expectedCancellation;
  if (target.tenantId !== input.tenantId || target.workItemId !== input.workItemId ||
      target.subjectKind !== 'WORK_ITEM' || target.requestOrigin !== 'OPENCLAW_MCP_V1' ||
      // Canonical JobAid continuations are reserved by this service actor;
      // the engineer remains bound separately by the WI, source grant and
      // active-lease authorization. Preserve owner-created historical attempts.
      (target.actorUserId !== owner.requestedByUserId && target.actorUserId !== 'service:openclaw-main') ||
      target.documentVersionId !== owner.documentVersionId ||
      target.operationRef !== expected.attemptRef || target.attemptNo !== expected.attemptNo ||
      target.actionType !== expected.actionType || target.triggerRequestId !== expected.attemptRequestId ||
      target.inputRevision !== expected.inputRevision || target.baseRevision !== expected.baseRevision ||
      target.taskInputHash !== expected.inputHash || target.status !== 'CANCELLED' ||
      !target.completedAt || target.commitStartedAt !== null || target.projectionApplied ||
      target.resultEnvelopeJson !== null || target.resultContentHash !== null ||
      target.leaseOwner !== null || target.leaseToken !== null || target.leaseExpiresAt !== null) return false;
  try {
    const task = parseTaskEnvelope(String(target.taskEnvelopeJson));
    return task.actionAttemptId === target.attemptId && task.operationRef === target.operationRef &&
      task.taskType === target.actionType && task.workItemId === owner.workItemId &&
      task.tenantId === owner.tenantId && task.documentVersionId === owner.documentVersionId &&
      task.inputRevision === target.inputRevision && task.baseRevision === target.baseRevision &&
      task.idempotencyKey === target.idempotencyKey && task.inputHash === expected.inputHash &&
      canonicalJson(task.executionModel) === canonicalJson(expected.executionModel) &&
      canonicalJson(readStoredExecutionModel(target.executionModelJson)) === canonicalJson(expected.executionModel) &&
      canonicalJson(cancelledAttemptExecutionModel(task, target, owner)) === canonicalJson(expected.executionModel);
  } catch { return false; }
}

/** Select a historical snapshot only. Callers still validate the terminal row,
 * current owner/source authorization, latest attempt and queue receipt/fence. */
export function readCancelledAttemptExecutionModel(
  target: typeof actionAttempt.$inferSelect,
  owner: typeof workItem.$inferSelect,
): CanonicalExecutionModelSelection | null {
  try {
    return cancelledAttemptExecutionModel(parseTaskEnvelope(String(target.taskEnvelopeJson)), target, owner);
  } catch { return null; }
}

function cancelledAttemptExecutionModel(
  task: OpenClawTaskEnvelope,
  target: typeof actionAttempt.$inferSelect,
  owner: typeof workItem.$inferSelect,
): CanonicalExecutionModelSelection | null {
  const model = readStoredExecutionModel(target.executionModelJson);
  if (!model || canonicalJson(task.executionModel) !== canonicalJson(model)) return null;
  const input = task.modelInput;
  const nested = input.modelInput;
  // A malformed/unknown program wrapper must never inherit the legacy branch.
  const declaresProgram = ['executionMode', 'modelRef', 'requestedModelRef', 'agentPolicy']
    .some(key => Object.hasOwn(input, key)) ||
    (!!nested && typeof nested === 'object' &&
      ['executionMode', 'programOriginal'].some(key => Object.hasOwn(nested, key)));
  let explicitProgram = false;
  if (input.schemaVersion === INITIAL_ANALYSIS_REQUEST_SCHEMA) {
    explicitProgram = isProgramAssessmentMode(readInitialAnalysisRequestInput(task)?.executionMode);
  } else if (isJobAidProblemTask(input)) {
    const prepared = parseJobAidProblemTask(task);
    explicitProgram = isProgramAssessmentMode(prepared.executionMode);
    if (explicitProgram) {
      const original = prepared.modelInput.programOriginal!.binding;
      if (prepared.actorUserId !== owner.requestedByUserId ||
          original.documentVersionId !== owner.documentVersionId ||
          original.sourceArtifactId !== owner.sourceArtifactId ||
          original.sourceSha256 !== owner.sourceFileSha256 ||
          original.sourceByteLength !== Number(owner.sourceByteLength)) return null;
    }
  }
  if (explicitProgram) {
    if (task.taskType !== 'OPENCLAW_DYNAMIC_EVALUATION' || task.sourceRefs.length !== 1 ||
        canonicalJson(task.sourceRefs[0]) !== canonicalJson({ref:owner.sourceArtifactId,sha256:owner.sourceFileSha256})) return null;
    // Explicit programs were captured independently of the intake model pin.
    // Preserve every field, including selectedAt, settingsRevision and budget.
    return model;
  }
  if (declaresProgram) return null;
  return readStoredExecutionModel(owner.analysisModelJson);
}
