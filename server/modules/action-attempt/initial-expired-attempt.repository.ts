import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { and, eq, getTableColumns, isNull, lte, sql } from 'drizzle-orm';
import type { CanonicalInitialAttemptRead, CanonicalInitialAttemptReconcileRequest } from '@shared/api.interface';
import { actionAttempt, assessmentWorkRevision, workItem } from '../../database/schema';
import { autoWorkItemAuthorization } from '../../database/auto-work-item-authorization.schema';
import { canonicalJson, parseTaskEnvelope } from './action-attempt-envelope';
import { automaticWorkItemTaskLease } from './automatic-work-item-attempt-lease';

type Owner = typeof workItem.$inferSelect;
type Attempt = typeof actionAttempt.$inferSelect & { hasPersistedResult: boolean };
type Grant = typeof autoWorkItemAuthorization.$inferSelect;
type Source = { workItemId: string; documentVersionId: string; artifactRef: string; artifactSha256: string; kind?: string };
export interface InitialAttemptScope { tenantId: string; actorUserId: string; workItemId: string }
export interface InitialAttemptTarget { attemptId: string; attemptRef: string }
export type InitialAttemptAuthorize = (database: PostgresJsDatabase, owners: readonly Owner[]) => Promise<void>;

const TIMEOUT = 'ACTION_ATTEMPT_DEADLINE_EXCEEDED';
const columns = { ...getTableColumns(actionAttempt),
  // Presence is enough. The complete persisted response never enters this read path.
  resultEnvelopeJson: sql<null>`NULL`,
  hasPersistedResult: sql<boolean>`${actionAttempt.resultEnvelopeJson} IS NOT NULL OR ${actionAttempt.resultContentHash} IS NOT NULL`,
};

/** Existing owner RLS, source WI -> grant -> attempt order; no machine lease bypass. */
export class InitialExpiredAttemptRepository {
  constructor(private readonly db: PostgresJsDatabase) {}

  async read(scope: InitialAttemptScope, target: InitialAttemptTarget, authorize: InitialAttemptAuthorize) {
    const row = await this.attempt(this.db, scope, target);
    const binding = this.binding(row, scope);
    const owners = await this.sources(this.db, scope, binding.sources, false);
    await authorize(this.db, owners);
    const coverage = await this.coverage(this.db, scope, row);
    const grant = await this.grant(this.db, scope, false);
    const facts = this.facts(row, owners, binding, grant, coverage);
    await authorize(this.db, owners);
    return facts;
  }

  async reconcile(scope: InitialAttemptScope, input: CanonicalInitialAttemptReconcileRequest,
    authorize: InitialAttemptAuthorize) {
    // This first read is discovery only. Every mutable fact is read again under locks.
    const seed = await this.attempt(this.db, scope, input);
    const sealed = this.binding(seed, scope);
    return this.db.transaction(async database => {
      const owners = await this.sources(database, scope, sealed.sources, true);
      const grant = await this.grant(database, scope, true);
      const row = await this.attempt(database, scope, input, true);
      const binding = this.binding(row, scope);
      if (row.taskInputHash !== seed.taskInputHash ||
          canonicalJson(binding.sources) !== canonicalJson(sealed.sources) ||
          binding.requestId !== input.stageRequestId || row.leaseGeneration !== input.expectedLeaseGeneration)
        throw initialAttemptConflict('BINDING_CHANGED');
      await authorize(database, owners);
      const coverage = await this.coverage(database, scope, row);
      const facts = this.facts(row, owners, binding, grant, coverage);
      if (facts.reconciliation === 'ALREADY_TIMED_OUT')
        return { operation: 'RECONCILE_EXPIRED' as const, changed: false, attempt: facts };
      if (facts.workItemRevision !== input.expectedRevision)
        throw initialAttemptConflict('WORK_ITEM_CHANGED');
      if (facts.reconciliation !== 'ELIGIBLE')
        throw initialAttemptConflict(facts.protectionCode ?? 'STATE_UNKNOWN');
      const now = new Date(facts.observedAt);
      const updated = await database.update(actionAttempt).set({
        status: 'TIMED_OUT', terminalReason: TIMEOUT, completedAt: now, updatedAt: now,
        leaseOwner: null, leaseToken: null, leaseExpiresAt: null, leaseSlot: null,
      }).where(and(eq(actionAttempt.tenantId, scope.tenantId), eq(actionAttempt.workItemId, scope.workItemId),
        eq(actionAttempt.attemptId, input.attemptId), eq(actionAttempt.operationRef, input.attemptRef),
        eq(actionAttempt.taskInputHash, row.taskInputHash!), eq(actionAttempt.leaseGeneration, input.expectedLeaseGeneration),
        eq(actionAttempt.status, 'RUNNING'), lte(actionAttempt.deadlineAt, now), lte(actionAttempt.leaseExpiresAt, now),
        isNull(actionAttempt.commitStartedAt), isNull(actionAttempt.resultEnvelopeJson), isNull(actionAttempt.resultContentHash),
        eq(actionAttempt.projectionApplied, false), isNull(actionAttempt.completedAt), isNull(actionAttempt.cancelRequestedAt),
      )).returning({ attemptId: actionAttempt.attemptId });
      if (updated.length !== 1) throw initialAttemptConflict('CAS_REJECTED');
      // Recheck authorization and the policy coverage before completing the write.
      await authorize(database, owners);
      await this.coverage(database, scope, row);
      return { operation: 'RECONCILE_EXPIRED' as const, changed: true,
        attempt: { ...facts, observedAt: new Date().toISOString(), status: 'TIMED_OUT', completedAt: now.toISOString(),
          terminalReason: TIMEOUT, reconciliation: 'ALREADY_TIMED_OUT' as const, protectionCode: null } };
    });
  }

  private async attempt(database: PostgresJsDatabase, scope: InitialAttemptScope, target: InitialAttemptTarget, lock = false) {
    const query = database.select(columns).from(actionAttempt).where(and(
      eq(actionAttempt.tenantId, scope.tenantId), eq(actionAttempt.workItemId, scope.workItemId),
      eq(actionAttempt.attemptId, target.attemptId), eq(actionAttempt.operationRef, target.attemptRef),
      eq(actionAttempt.subjectKind, 'WORK_ITEM'), eq(actionAttempt.requestOrigin, 'OPENCLAW_MCP_V1'),
      eq(actionAttempt.actionType, 'OPENCLAW_DYNAMIC_EVALUATION'),
    )).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw initialAttemptNotFound();
    return row;
  }

  private binding(row: Attempt, scope: InitialAttemptScope) {
    if (!row.taskEnvelopeJson) throw initialAttemptConflict('BINDING_UNKNOWN');
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    const input = task.modelInput;
    const model = input.modelInput;
    const prefix = `openclaw-v2:dynamic:${scope.workItemId}:${row.documentVersionId}:`;
    const requestId = row.idempotencyKey?.startsWith(prefix) ? row.idempotencyKey.slice(prefix.length) : '';
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(requestId) ||
        !['wiselink.jobaid-problem-task.v2', 'wiselink.jobaid-problem-task.v3'].includes(String(input.schemaVersion)) ||
        !model || typeof model !== 'object' || Array.isArray(model) ||
        !('purpose' in model) || model.purpose !== 'INITIAL_PROBLEM_ASSESSMENT' ||
        input.savedWorkReconciliation || input.tdmsReviewContext ||
        input.actorUserId !== scope.actorUserId ||
        ![scope.actorUserId, 'service:openclaw-main'].includes(row.actorUserId) ||
        task.actionAttemptId !== row.attemptId || task.operationRef !== row.operationRef ||
        task.taskType !== row.actionType || task.workItemId !== row.workItemId || task.tenantId !== row.tenantId ||
        task.documentVersionId !== row.documentVersionId || task.inputRevision !== row.inputRevision ||
        task.baseRevision !== row.baseRevision || task.idempotencyKey !== row.idempotencyKey ||
        task.inputHash !== row.taskInputHash || task.deadline !== row.deadlineAt?.toISOString())
      throw initialAttemptConflict('BINDING_UNKNOWN');
    // Do not re-parse historical model policy against today's model limits. The
    // original envelope/hash and finite control/source binding remain exact.
    if (!Array.isArray(input.sourceBindings) || !input.sourceBindings.length)
      throw initialAttemptConflict('SOURCE_BINDING_UNKNOWN');
    const sources: Source[] = input.sourceBindings.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw initialAttemptConflict('SOURCE_BINDING_UNKNOWN');
      const item = value as Record<string, unknown>;
      if (['workItemId','documentVersionId','artifactRef','artifactSha256'].some(key => typeof item[key] !== 'string' || !item[key]) ||
          (item.kind !== undefined && item.kind !== 'SOURCE_FILE'))
        throw initialAttemptConflict('SOURCE_BINDING_UNKNOWN');
      return {workItemId: String(item.workItemId), documentVersionId: String(item.documentVersionId),
        artifactRef: String(item.artifactRef), artifactSha256: String(item.artifactSha256),
        ...(item.kind === undefined ? {} : {kind: String(item.kind)})};
    });
    if (new Set(sources.map(item => item.workItemId)).size !== sources.length ||
        !sources.some(item => item.workItemId === scope.workItemId && item.documentVersionId === row.documentVersionId))
      throw initialAttemptConflict('SOURCE_BINDING_UNKNOWN');
    return { requestId, sources, automatic: automaticWorkItemTaskLease(input.automaticWorkItemLease) };
  }

  private async sources(database: PostgresJsDatabase, scope: InitialAttemptScope, bindings: readonly Source[], lock: boolean) {
    const owners: Owner[] = [];
    for (const binding of [...bindings].sort((a,b) => a.workItemId < b.workItemId ? -1 : a.workItemId > b.workItemId ? 1 : 0)) {
      const query = database.select().from(workItem).where(and(eq(workItem.tenantId, scope.tenantId),
        eq(workItem.workItemId, binding.workItemId), eq(workItem.requestedByUserId, scope.actorUserId))).limit(1);
      const [owner] = await (lock ? query.for('update') : query);
      if (!owner?.projectionJson || owner.documentVersionId !== binding.documentVersionId) throw initialAttemptNotFound();
      const projection = JSON.parse(owner.projectionJson);
      const ref = binding.kind === 'SOURCE_FILE' ? projection.source?.sourceArtifactId : projection.package?.artifact?.ref;
      const hash = binding.kind === 'SOURCE_FILE' ? projection.source?.sourceFileSha256 : projection.package?.artifact?.sha256;
      if (ref !== binding.artifactRef || String(hash).replace(/^sha256:/u, '') !== binding.artifactSha256.replace(/^sha256:/u, ''))
        throw initialAttemptConflict('SOURCE_CHANGED');
      owners.push(owner);
    }
    return owners;
  }

  private async grant(database: PostgresJsDatabase, scope: InitialAttemptScope, lock: boolean) {
    const query = database.select().from(autoWorkItemAuthorization).where(and(
      eq(autoWorkItemAuthorization.tenantId, scope.tenantId), eq(autoWorkItemAuthorization.workItemId, scope.workItemId))).limit(1);
    return (await (lock ? query.for('update') : query))[0] ?? null;
  }

  private async coverage(database: PostgresJsDatabase, scope: InitialAttemptScope, row: Attempt) {
    // The same statement/snapshot proves the exact owner SELECT-policy predicate
    // and reads all matching revisions (no creator filter, latest-only or LIMIT).
    // RLS invisibility must never become evidence of an empty save set.
    const [proof] = await database.execute<{ covered: boolean; saved: CanonicalInitialAttemptRead['savedWorks']; otherActive: boolean }>(sql`
      SELECT current_setting('app.user_id',true) = ${scope.actorUserId}
        AND engineering_matter_actor_has_tenant(${scope.tenantId})
        AND engineering_matter_work_item_owned_by_actor(${scope.tenantId},${scope.workItemId}) AS covered,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('workRevisionRef',r.assessment_work_revision_id,
          'workRevision',r.work_revision,'saveRequestId',r.request_id) ORDER BY r.work_revision)
          FROM ${assessmentWorkRevision} r WHERE r.tenant_id=${scope.tenantId} AND r.work_item_id=${scope.workItemId}
            AND r.action_attempt_id=${row.attemptId}), '[]'::jsonb) AS saved,
        EXISTS(SELECT 1 FROM ${actionAttempt} a WHERE a.tenant_id=${scope.tenantId} AND a.work_item_id=${scope.workItemId}
          AND a.attempt_id<>${row.attemptId} AND (a.status IN ('QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING')
            OR (a.action_type=${row.actionType} AND a.attempt_no>${row.attemptNo}))) AS "otherActive"`);
    if (proof?.covered !== true || !Array.isArray(proof.saved) || typeof proof.otherActive !== 'boolean')
      throw initialAttemptConflict('SAVE_COVERAGE_UNKNOWN');
    return proof;
  }

  private facts(row: Attempt, owners: Owner[], binding: ReturnType<InitialExpiredAttemptRepository['binding']>,
    grant: Grant | null, coverage: {saved: CanonicalInitialAttemptRead['savedWorks']; otherActive: boolean}): CanonicalInitialAttemptRead {
    const primary = owners.find(owner => owner.workItemId === row.workItemId)!;
    const now = new Date();
    const projected = JSON.parse(primary.projectionJson!).integratedAssessment;
    const activity: unknown = JSON.parse(row.reviewActivityJson ?? '[]');
    if (!Array.isArray(activity)) throw initialAttemptConflict('ACTIVITY_UNKNOWN');
    const activityUnknown = activity.some(item => !item || typeof item !== 'object' || Array.isArray(item) ||
      !['ASSESSMENT_SOURCES_READ','ASSESSMENT_WORK_READ','ASSESSMENT_KNOWLEDGE_OBSERVED',
        'ASSESSMENT_PROGRAM_PROGRESS','ASSESSMENT_CONSUMER_STOPPED'].includes(String(item.kind)));
    const projectionReferencesAttempt = projected?.baseRules?.actionAttemptId === row.attemptId ||
      projected?.overallSynthesis?.actionAttemptId === row.attemptId ||
      projected?.overallSynthesis?.sourceAssessment?.actionAttemptId === row.attemptId;
    const savedOrCommitting = coverage.saved.length > 0 || row.hasPersistedResult || row.commitStartedAt !== null ||
      row.projectionApplied || projectionReferencesAttempt || activity.some(item => item?.kind === 'ASSESSMENT_WORK_READ');
    const alreadyTimedOut = row.status === 'TIMED_OUT' && row.terminalReason === TIMEOUT && !!row.completedAt &&
      !!row.deadlineAt && row.deadlineAt <= row.completedAt && !savedOrCommitting;
    const bound = binding.automatic;
    const grantMatches = !bound || !!grant && grant.status === 'LEASED' && grant.grantKind === 'MIAODA_CANONICAL_PARSE_REQUEST' &&
      grant.requestId === bound.requestId && grant.requestId === primary.requestId && grant.leaseGeneration === bound.leaseGeneration &&
      grant.leaseOwner === row.leaseOwner && grant.actorUserId === primary.requestedByUserId &&
      grant.documentId === primary.documentId && grant.documentVersionId === primary.documentVersionId &&
      grant.sourceArtifactId === primary.sourceArtifactId && grant.sourceFileSha256 === primary.sourceFileSha256 &&
      Number(grant.sourceByteLength) === Number(primary.sourceByteLength) && !!grant.leaseExpiresAt && grant.leaseExpiresAt <= now &&
      !grant.completedAt && !grant.blockedAt;
    const protectionCode = savedOrCommitting ? 'SAVED_OR_COMMITTING' : activityUnknown ? 'ACTIVITY_UNKNOWN' : row.status !== 'RUNNING' ? 'NOT_RUNNING' :
      !row.deadlineAt || row.deadlineAt > now ? 'DEADLINE_NOT_EXPIRED' :
      !row.leaseExpiresAt || row.leaseExpiresAt > now || !row.leaseToken || !row.leaseOwner ? 'LEASE_NOT_EXPIRED' :
      row.completedAt || row.cancelRequestedAt || row.cancelReason ? 'STATE_UNKNOWN' :
      row.baseRevision !== primary.revision || row.inputRevision !== primary.revision ? 'WORK_ITEM_CHANGED' :
      !grantMatches ? 'GRANT_CHANGED_OR_ACTIVE' : coverage.otherActive ? 'SUCCESSOR_PRESENT' : null;
    return {schemaVersion:'wiselink.initial-attempt-control.v1',observedAt:now.toISOString(),workItemId:primary.workItemId,
      workItemRevision:primary.revision,documentVersionId:primary.documentVersionId,attemptId:row.attemptId,
      attemptRef:row.operationRef!,stageRequestId:binding.requestId,intakeRequestId:primary.requestId,
      inputRevision:row.inputRevision!,baseRevision:row.baseRevision!,deadline:row.deadlineAt!.toISOString(),
      leaseGeneration:row.leaseGeneration,status:row.status,commitStartedAt:row.commitStartedAt?.toISOString() ?? null,
      completedAt:row.completedAt?.toISOString() ?? null,terminalReason:row.terminalReason,
      hasPersistedResult:row.hasPersistedResult,projectionApplied:row.projectionApplied,savedWorks:coverage.saved,
      consumerOutcome:activity.some(item => item?.kind==='ASSESSMENT_CONSUMER_STOPPED' && item.upstreamOutcome==='UNKNOWN') ? 'UNKNOWN' : null,
      reconciliation:alreadyTimedOut?'ALREADY_TIMED_OUT':protectionCode?'PROTECTED':'ELIGIBLE',
      protectionCode:alreadyTimedOut?null:protectionCode};
  }
}

export function initialAttemptConflict(suffix: string) {
  const code = `INITIAL_EXPIRED_${suffix}`;
  return Object.assign(new Error(code), {code,statusCode:409});
}
export function initialAttemptNotFound() {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {code:'CANONICAL_WORK_ITEM_NOT_FOUND',statusCode:404});
}
