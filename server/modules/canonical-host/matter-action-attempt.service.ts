import type { EngineeringMatterWorkingRevisionCommand, EngineeringMatterWorkingInputBinding } from '@shared/matter-working.interface';
import { addMatterDeliveredEvidence, buildMatterJobAidTask, MATTER_JOBAID_TASK_SCHEMA, matterJobAidSourceRegistry, type MatterIssueCorrectionPurpose, type MatterOverviewCorrectionPurpose } from './matter-jobaid-task';
import { materializeMatterJobAidCommand } from './matter-jobaid-save';
import { buildEngineeringIssueCorrectionContext, buildEngineeringOverviewCorrectionContext, summarizeEngineeringIssueCorrection } from './engineering-issue-correction-context';
import { EngineeringIssueCorrectionPluginService } from './engineering-issue-correction-plugin.service';
import { buildMatterWorkReference, type MatterWorkReferenceRequest } from './matter-work-reference';
import type { CanonicalHostActor } from './canonical-host.types';
import { isHostedCanonicalFinalUserActor } from '../work-item/miaoda-hosted-canonical-object-access.adapter';
import { engineeringMatterPendingInputs } from './engineering-matter-working-state';
import { readMatterDocumentIdentities } from './matter-document-identity';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { JOBAID_PROBLEM_WORK_SCHEMA } from '@shared/jobaid-problem-assessment.interface';
import type { MatterCurrentWorkActiveAttempt, MatterCurrentWorkReadModel } from '@shared/matter-current-work.interface';
import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { DocumentSemanticService } from './document-semantic.service';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DocumentSourceReading } from '@shared/document-source-reading.interface';
import { dmDocumentParseRun } from '../../database/document-parsing.schema';
import { documentOriginalEngineeringReading, type DocumentOriginalEngineeringReading } from './document-original-engineering-reading';
import { dueMatterRevisits } from './matter-revisit';
import type { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import { documentSourcePageRange } from '../document-management/src/hosted/nest/document-source-reading';
import {
  actionAttempt,
  engineeringMatter,
  engineeringMatterWorkRevision,
} from '../../database/schema';
import {
  ActionAttemptRepository,
  isLeaseSlotConflict,
} from '../action-attempt/action-attempt.repository';
import {
  canonicalJson,
  canonicalSha256,
  parseMatterTaskEnvelope,
  parseMatterResultEnvelope,
  sealMatterTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import type {
  EngineeringMatterAttemptTrigger,
  OpenClawMatterTaskEnvelope,
  OpenClawMatterResultEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import {
  ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
  ACTION_ATTEMPT_COMMIT_RECOVERY_MS,
  ACTION_ATTEMPT_LEASE_MS,
  ACTION_ATTEMPT_MAX_PARALLEL,
  ACTION_ATTEMPT_REQUEST_ORIGIN,
  type ActionAttemptFence,
  type MatterActionAttemptRow,
} from '../action-attempt/action-attempt.types';
import { CanonicalModelSettingsService } from '../model-settings/canonical-model-settings.service';
import {
  EngineeringMatterWorkingRepository,
  type EngineeringMatterWorkingTransactionExecutor,
} from './engineering-matter-working.repository';

export interface MatterAttemptScope {
  tenantId: string;
  matterId: string;
  actorUserId: string;
  /** Supplied by the authenticated transport, never by request JSON or a model. */
  authorizeReferenceMatter?: (matterId: string) => Promise<void>;
}

export interface ReserveMatterAttempt extends MatterAttemptScope {
  idempotencyKey: string;
  expectedMatterRevisionId: string;
  expectedMatterRevision: number;
  expectedWorkingRevision: number;
  trigger: EngineeringMatterAttemptTrigger;
  modelInput: Record<string, unknown>;
  sourceRefs: OpenClawMatterTaskEnvelope['sourceRefs'];
}

export type ReserveMatterJobAidAttempt = Omit<ReserveMatterAttempt, 'modelInput' | 'sourceRefs'> & {
  expectedInputs?: EngineeringMatterWorkingInputBinding[];
  recoveryAttemptRef?: string;
  correction?: MatterIssueCorrectionPurpose;
  overviewCorrection?: MatterOverviewCorrectionPurpose;
  referenceWorks?: MatterWorkReferenceRequest[];
};

/** Subject adapter for the existing durable queue, lease slots and cancellation. */
@Injectable()
export class MatterActionAttemptService {
  constructor(
    private readonly working: EngineeringMatterWorkingRepository,
    private readonly models: CanonicalModelSettingsService,
    @Optional() private readonly semantics?: DocumentSemanticService,
    @Optional() private readonly issueCorrection?: EngineeringIssueCorrectionPluginService,
  ) {}

  reserve(input: ReserveMatterAttempt) {
    return this.reserveInternal(input);
  }

  /** Host builds the entire JobAid context; callers supply only the request and CAS. */
  reserveJobAid(input: ReserveMatterJobAidAttempt) {
    this.validateJobAidRequest(input);
    return this.reserveInternal(input);
  }

  /** Native browser ingress retains its authenticated SQL context; it never impersonates the Hosted actor. */
  reserveJobAidForBrowser(input: ReserveMatterJobAidAttempt, actor: CanonicalHostActor) {
    this.validateJobAidRequest(input);
    return this.reserveInternal(input, actor);
  }

  private validateJobAidRequest(input: ReserveMatterJobAidAttempt) {
    if ('modelInput' in input || 'sourceRefs' in input)
      throw failure('MATTER_JOBAID_HOST_CONTEXT_REQUIRED', 400);
    if (input.correction && (input.recoveryAttemptRef || input.correction.kind !== 'ENGINEERING_ISSUE_CORRECTION' ||
        !input.correction.expectedWorkRef.trim() || !input.correction.issueKey.trim() ||
        !input.correction.correctionReason.trim() || !input.correction.evidenceRefs.length ||
        input.correction.evidenceRefs.some(ref => !ref.trim()) ||
        new Set(input.correction.evidenceRefs).size !== input.correction.evidenceRefs.length))
      throw failure('ENGINEERING_CORRECTION_REQUEST_INVALID', 400);
    if (input.overviewCorrection && (input.correction || input.overviewCorrection.kind !== 'ENGINEERING_OVERVIEW_CORRECTION' ||
        !input.overviewCorrection.expectedWorkRef.trim() || input.overviewCorrection.expectedWorkRef.length > 200 ||
        !input.overviewCorrection.correctionReason.trim() || input.overviewCorrection.correctionReason.length > 4000 ||
        !input.overviewCorrection.evidenceRefs.length || input.overviewCorrection.evidenceRefs.length > 96 ||
        input.overviewCorrection.evidenceRefs.some(ref => !ref.trim() || ref.length > 512) ||
        new Set(input.overviewCorrection.evidenceRefs).size !== input.overviewCorrection.evidenceRefs.length))
      throw failure('ENGINEERING_OVERVIEW_CORRECTION_REQUEST_INVALID', 400);
    if (input.referenceWorks && (input.referenceWorks.length > 8 ||
        input.referenceWorks.some(ref => ref.matterId === input.matterId ||
          [ref.matterId, ref.workRef, ref.issueKey, ref.purpose].some(value => typeof value !== 'string' || !value.trim()) ||
          ref.purpose.length > 4000 || [ref.matterId, ref.workRef, ref.issueKey].some(value => value.length > 255)) ||
        new Set(input.referenceWorks.map(ref => canonicalJson([ref.matterId,ref.workRef,ref.issueKey]))).size !== input.referenceWorks.length))
      throw failure('MATTER_REFERENCE_REQUEST_INVALID', 400);
  }

  /** One existing consumer tick observes source changes; the Host decides whether work is needed. */
  async nextForRuntime(input: MatterAttemptScope) {
    const observed = await this.authorized(input, async (executor, queue) => {
      const [active] = await executor.database.select({ ref: actionAttempt.operationRef }).from(actionAttempt)
        .where(and(eq(actionAttempt.tenantId, input.tenantId), eq(actionAttempt.matterId, input.matterId),
          inArray(actionAttempt.status, ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'])))
        .orderBy(desc(actionAttempt.createdAt)).limit(1);
      if (active?.ref) {
        const row = await this.scopedRow(executor, queue, input, active.ref);
        return { next: { attemptRef: active.ref, status: row.status } };
      }
      const [matter] = await executor.database.select().from(engineeringMatter)
        .where(and(eq(engineeringMatter.tenantId, input.tenantId), eq(engineeringMatter.matterId, input.matterId))).limit(1);
      if (!matter) throw failure('ENGINEERING_MATTER_NOT_FOUND', 404);
      const current = await executor.loadCurrent(input);
      const bindings = (await executor.authorizeRuntimeInputs(input)).currentInputs;
      const pending = engineeringMatterPendingInputs(current?.state ?? null, bindings);
      const compositionChanged = current && current.basedOnMatterRevisionId !== matter.currentMatterRevisionId;
      let failedRevisit: { attemptRef: string; status: string } | null = null;
      if (current) for (const occurrence of dueMatterRevisits(current.state.reviewConditions, bindings, new Date())) {
        // The same explicit schedule/event is one occurrence even after work is
        // saved again. Editing prose does not rearm an overdue condition.
        const idempotencyKey = `matter-revisit:${input.matterId}:${canonicalSha256(occurrence)}`;
        const [existing] = await executor.database.select({ ref: actionAttempt.operationRef }).from(actionAttempt)
          .where(and(eq(actionAttempt.tenantId,input.tenantId),eq(actionAttempt.idempotencyKey,idempotencyKey))).limit(1);
        if (existing) {
          const row = await this.scopedRow(executor,queue,input,existing.ref);
          if (row.status !== 'SUCCEEDED') failedRevisit ??= { attemptRef: existing.ref, status: row.status };
          continue;
        }
        return { reservation: { ...input,
          trigger: { kind: 'REVISIT' as const, workRef: current.matterWorkRevisionId, conditionIds: [occurrence.conditionId] },
          expectedMatterRevisionId: matter.currentMatterRevisionId, expectedMatterRevision: matter.currentRevisionNo,
          expectedWorkingRevision: current.workingRevision, expectedInputs: bindings, idempotencyKey } };
      }
      if (!pending.length && !compositionChanged) return { next: failedRevisit };
      const trigger: EngineeringMatterAttemptTrigger = pending.length
        ? { kind: 'SOURCE_CHANGE', inputIds: pending.map(item => item.inputId) }
        : { kind: 'COMPOSITION_CHANGE', previousMatterRevisionId: current?.basedOnMatterRevisionId ?? null };
      // A partial save is not a new source event and must not reset a failed
      // automatic request. New source versions produce a different key.
      const idempotencyKey = `matter-auto:${input.matterId}:${canonicalSha256({
        matterRevisionId: matter.currentMatterRevisionId, inputs: bindings })}`;
      const [existing] = await executor.database.select({ ref: actionAttempt.operationRef }).from(actionAttempt)
        .where(and(eq(actionAttempt.tenantId, input.tenantId), eq(actionAttempt.idempotencyKey, idempotencyKey))).limit(1);
      if (existing?.ref) {
        const row = await this.scopedRow(executor, queue, input, existing.ref);
        if (row.status === 'SUCCEEDED') return { next: failedRevisit };
        return { next: failedRevisit ?? { attemptRef: existing.ref, status: row.status } };
      }
      return { reservation: { ...input, trigger,
        expectedMatterRevisionId: matter.currentMatterRevisionId, expectedMatterRevision: matter.currentRevisionNo,
        expectedWorkingRevision: current?.workingRevision ?? 0,
        expectedInputs: bindings,
        // The source roster can exceed the request-key column limit. Reuse the
        // existing canonical digest; include changing WorkItem/result versions too.
        idempotencyKey } };
    });
    if ('next' in observed) return { matterId: input.matterId, next: observed.next };
    const reserved = await this.reserveJobAid(observed.reservation);
    return { matterId: input.matterId, next: { attemptRef: reserved.task.operationRef, status: reserved.row.status } };
  }

  /**
   * Read-only current work view for an authorized Hosted client. Reuses the
   * same actor transaction, runtime authorization and retained-reference
   * re-authorization as dispatch, but never reserves, claims, saves, finishes
   * or recovers anything.
   */
  async readCurrentWork(input: MatterAttemptScope): Promise<MatterCurrentWorkReadModel> {
    return this.authorized(input, async (executor) => {
      const readMatterRevision = async () => {
        const [matter] = await executor.database.select().from(engineeringMatter)
          .where(and(eq(engineeringMatter.tenantId, input.tenantId), eq(engineeringMatter.matterId, input.matterId))).limit(1);
        if (!matter) throw failure('ENGINEERING_MATTER_NOT_FOUND', 404);
        return matter;
      };
      const firstInputs = (await executor.authorizeRuntimeInputs(input)).currentInputs;
      const firstMatter = await readMatterRevision();
      const firstCurrent = await executor.loadCurrent(input);
      if (firstCurrent && firstCurrent.basedOnMatterRevisionId !== firstMatter.currentMatterRevisionId)
        await executor.authorizeRuntimeInputs({ ...input, basedOnMatterRevisionId: firstCurrent.basedOnMatterRevisionId });

      const { sourceCatalog, eligibleEvidenceRefs } = matterJobAidSourceRegistry(firstCurrent);
      const retainedEvidence = [...(firstCurrent?.state.problemWork?.evidence ?? [])];
      const overviewSource = firstCurrent?.overviewSourceWork ?? null;
      if (firstCurrent && overviewSource) {
        const overviewRevision = await this.working.readByRef(
          { tenantId: input.tenantId, matterId: input.matterId, workRef: overviewSource.workRef },
          executor.database,
        );
        if (!overviewRevision) throw failure('MATTER_REFERENCE_WORK_NOT_FOUND', 404);
        if (overviewRevision.workingRevision !== overviewSource.workingRevision)
          throw failure('MATTER_REFERENCE_WORK_BINDING_CHANGED');
        await executor.authorizeRuntimeInputs({ ...input, basedOnMatterRevisionId: overviewRevision.basedOnMatterRevisionId });
        retainedEvidence.push(...(overviewRevision.state.problemWork?.evidence ?? []));
      }
      await this.authorizeReferenceEvidence(executor, input, retainedEvidence);

      // One READ COMMITTED transaction does not by itself give every statement
      // the same snapshot: re-read the versioned identity and fail closed on
      // any drift instead of returning a mixed version.
      const secondInputs = (await executor.authorizeRuntimeInputs(input)).currentInputs;
      const secondMatter = await readMatterRevision();
      const secondCurrent = await executor.loadCurrent(input);
      if (
        secondMatter.currentMatterRevisionId !== firstMatter.currentMatterRevisionId ||
        secondMatter.currentRevisionNo !== firstMatter.currentRevisionNo ||
        (secondCurrent?.matterWorkRevisionId ?? null) !== (firstCurrent?.matterWorkRevisionId ?? null) ||
        (secondCurrent?.workingRevision ?? 0) !== (firstCurrent?.workingRevision ?? 0) ||
        canonicalJson(secondInputs) !== canonicalJson(firstInputs)
      )
        throw failure('MATTER_CURRENT_WORK_READ_CONFLICT');

      const activeRows = await executor.database
        .select({ ref: actionAttempt.operationRef, status: actionAttempt.status })
        .from(actionAttempt)
        .where(and(
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.actorUserId, input.actorUserId),
          eq(actionAttempt.matterId, input.matterId),
          eq(actionAttempt.requestOrigin, ACTION_ATTEMPT_REQUEST_ORIGIN),
          inArray(actionAttempt.status, ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING']),
        ))
        .orderBy(actionAttempt.createdAt);
      const activeAttempts: MatterCurrentWorkActiveAttempt[] = [];
      for (const row of activeRows) {
        if (!row.ref) continue;
        activeAttempts.push({ attemptRef: row.ref, status: row.status as MatterCurrentWorkActiveAttempt['status'] });
      }
      return {
        matterId: input.matterId,
        matterRevisionId: firstMatter.currentMatterRevisionId,
        matterRevision: firstMatter.currentRevisionNo,
        workRef: firstCurrent?.matterWorkRevisionId ?? null,
        workingRevision: firstCurrent?.workingRevision ?? 0,
        current: firstCurrent,
        currentInputs: firstInputs,
        sourceCatalog,
        eligibleEvidenceRefs,
        activeAttempts,
      };
    });
  }

  private reserveInternal(input: ReserveMatterAttempt | ReserveMatterJobAidAttempt, nativeActor?: CanonicalHostActor): Promise<{
    row: MatterActionAttemptRow;
    task: OpenClawMatterTaskEnvelope;
    created: boolean;
  }> {
    if (!input.idempotencyKey?.trim() || input.idempotencyKey.length > 255)
      throw failure('ACTION_ATTEMPT_RESERVATION_INPUT_INVALID', 400);
    return this.authorized(input, async (executor, queue) => {
      const [matter] = await executor.database
        .select()
        .from(engineeringMatter)
        .where(
          and(
            eq(engineeringMatter.tenantId, input.tenantId),
            eq(engineeringMatter.matterId, input.matterId),
          ),
        )
        .limit(1)
        .for('update');
      if (!matter) throw failure('ENGINEERING_MATTER_NOT_FOUND', 404);
      const [existing] = await executor.database
        .select({ operationRef: actionAttempt.operationRef })
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.tenantId, input.tenantId),
            eq(actionAttempt.idempotencyKey, input.idempotencyKey),
          ),
        )
        .orderBy(desc(actionAttempt.createdAt))
        .limit(1);
      if (existing) {
        const row = await this.scopedRow(
          executor,
          queue,
          input,
          existing.operationRef ?? '',
        );
        const task = checkedTask(row);
        if (
          task.subject.matterRevisionId !== input.expectedMatterRevisionId ||
          task.inputRevision !== input.expectedMatterRevision ||
          task.baseRevision !== input.expectedWorkingRevision ||
          ('expectedInputs' in input && input.expectedInputs !== undefined &&
            canonicalJson(task.workingBasis.inputs) !== canonicalJson(input.expectedInputs)) ||
          canonicalJson(task.trigger) !== canonicalJson(input.trigger) ||
          ('modelInput' in input
            ? canonicalJson(task.modelInput) !== canonicalJson(input.modelInput) ||
              canonicalJson(task.sourceRefs) !== canonicalJson(input.sourceRefs)
            : task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA ||
              canonicalJson((task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction ?? null) !==
                canonicalJson((task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction?.kind === 'ENGINEERING_OVERVIEW_CORRECTION'
                  ? input.overviewCorrection ?? null : input.correction ?? null) ||
              ((!input.recoveryAttemptRef || input.overviewCorrection !== undefined) &&
                canonicalJson((task.modelInput as ReturnType<typeof buildMatterJobAidTask>).overviewCorrection ?? null) !== canonicalJson(input.overviewCorrection ?? null)) ||
              ((!input.recoveryAttemptRef || input.referenceWorks !== undefined) &&
                canonicalJson((task.modelInput as ReturnType<typeof buildMatterJobAidTask>).referenceWorks ?? []) !== canonicalJson(input.referenceWorks ?? [])) ||
              ((task.modelInput as ReturnType<typeof buildMatterJobAidTask>).recovery?.attemptRef ?? null) !==
                (input.recoveryAttemptRef ?? null))
        )
          throw failure('ACTION_ATTEMPT_IDEMPOTENCY_REPLAY_MISMATCH');
        return { row, task, created: false };
      }
      const current = await executor.loadCurrent(input);
      if (
        matter.currentMatterRevisionId !== input.expectedMatterRevisionId ||
        matter.currentRevisionNo !== input.expectedMatterRevision ||
        (current?.workingRevision ?? 0) !== input.expectedWorkingRevision
      )
        throw failure('ACTION_ATTEMPT_RESERVATION_BINDING_CHANGED');
      let recoveryRow: MatterActionAttemptRow | null = null;
      let recoveryTask: OpenClawMatterTaskEnvelope | null = null;
      if ('recoveryAttemptRef' in input && input.recoveryAttemptRef) {
        recoveryRow = await this.scopedRow(executor, queue, input, input.recoveryAttemptRef);
        if (recoveryRow.status === 'RUNNING' && recoveryRow.deadlineAt && recoveryRow.deadlineAt <= new Date()) {
          await queue.finishTerminal({ attemptId: recoveryRow.attemptId, fromStatus: 'RUNNING', status: 'TIMED_OUT',
            terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED', leaseToken: recoveryRow.leaseToken ?? undefined,
            leaseGeneration: recoveryRow.leaseGeneration, now: new Date() });
          recoveryRow = await this.scopedRow(executor, queue, input, input.recoveryAttemptRef);
        }
        if (recoveryRow.status === 'RUNNING' && recoveryRow.leaseExpiresAt && recoveryRow.leaseExpiresAt <= new Date()) {
          await queue.recoverExpiredRunning({ attemptId: recoveryRow.attemptId, now: new Date() });
          recoveryRow = await this.scopedRow(executor, queue, input, input.recoveryAttemptRef);
        }
        if (!['FAILED', 'TIMED_OUT'].includes(recoveryRow.status)) throw failure('MATTER_RECOVERY_REQUIRES_FAILED_ATTEMPT');
        recoveryTask = checkedTask(recoveryRow);
        if (!recoveryTask.executionModel || recoveryTask.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA ||
            recoveryTask.modelInput.actorUserId !== input.actorUserId ||
            recoveryTask.subject.matterRevisionId !== matter.currentMatterRevisionId ||
            recoveryTask.baseRevision !== (current?.workingRevision ?? 0) ||
            recoveryTask.workingBasis.priorWorkRef !== (current?.matterWorkRevisionId ?? null))
          throw failure('MATTER_RECOVERY_BASIS_CHANGED');
      }
      const [active] = await executor.database
        .select({ id: actionAttempt.attemptId })
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.tenantId, input.tenantId),
            eq(actionAttempt.matterId, input.matterId),
            inArray(actionAttempt.status, [
              'QUEUED',
              'RUNNING',
              'RETRY_SCHEDULED',
              'COMMITTING',
            ]),
          ),
        )
        .limit(1);
      if (active) throw failure('ACTION_ATTEMPT_ACTIVE_CONFLICT');
      const [latest] = await executor.database
        .select({ number: actionAttempt.attemptNo })
        .from(actionAttempt)
        .where(
          and(
            eq(actionAttempt.tenantId, input.tenantId),
            eq(actionAttempt.matterId, input.matterId),
          ),
        )
        .orderBy(desc(actionAttempt.attemptNo))
        .limit(1);
      const now = new Date();
      const authorizedInputs = (await executor.authorizeRuntimeInputs(input)).currentInputs;
      if (recoveryTask && canonicalJson(recoveryTask.workingBasis.inputs) !== canonicalJson(authorizedInputs))
        throw failure('MATTER_RECOVERY_BASIS_CHANGED');
      if ('expectedInputs' in input && input.expectedInputs !== undefined &&
        canonicalJson(authorizedInputs) !== canonicalJson(input.expectedInputs))
        throw failure('ACTION_ATTEMPT_RESERVATION_BINDING_CHANGED');
      const modelInput = 'modelInput' in input ? input.modelInput : buildMatterJobAidTask({
        matterId: input.matterId, matterRevisionId: input.expectedMatterRevisionId,
        actorUserId: input.actorUserId, title: matter.title,
        inputs: authorizedInputs, trigger: input.trigger, previous: current,
      });
      const correction = 'correction' in input ? input.correction : undefined;
      const recoveredOverviewCorrection = (recoveryTask?.modelInput as ReturnType<typeof buildMatterJobAidTask> | undefined)?.overviewCorrection ?? null;
      if (recoveryTask && 'overviewCorrection' in input && input.overviewCorrection !== undefined &&
          canonicalJson(input.overviewCorrection) !== canonicalJson(recoveredOverviewCorrection))
        throw failure('MATTER_RECOVERY_BASIS_CHANGED');
      const overviewCorrection = recoveryTask ? recoveredOverviewCorrection : ('overviewCorrection' in input ? input.overviewCorrection : undefined);
      const recoveredReferences = (recoveryTask?.modelInput as ReturnType<typeof buildMatterJobAidTask> | undefined)?.referenceWorks ?? [];
      if (recoveryTask && 'referenceWorks' in input && input.referenceWorks !== undefined &&
          canonicalJson(input.referenceWorks) !== canonicalJson(recoveredReferences))
        throw failure('MATTER_RECOVERY_BASIS_CHANGED');
      const referenceWorks = recoveryTask ? recoveredReferences : ('referenceWorks' in input ? input.referenceWorks ?? [] : []);
      if (referenceWorks.length) {
        const jobAid = modelInput as ReturnType<typeof buildMatterJobAidTask>;
        jobAid.referenceWorks = structuredClone(referenceWorks);
        for (const reference of referenceWorks) {
          const revision = await this.authorizedReference(executor, input, reference);
          const evidence = buildMatterWorkReference(reference, revision);
          addMatterDeliveredEvidence(jobAid, evidence);
          jobAid.modelInput.referenceWorks = jobAid.modelInput.referenceWorks.filter(item => item.evidenceRef !== evidence[0]!.evidenceRef);
          jobAid.modelInput.referenceWorks.push({ ...reference, evidenceRef: evidence[0]!.evidenceRef, overviewStatus: revision.state.problemWork!.overviewStatus,
            correctionNotices: structuredClone(revision.correctionNotices?.filter(notice => notice.issueKey === reference.issueKey) ?? []),
            overviewCorrectionNotices: structuredClone(revision.overviewCorrectionNotices ?? []) });
        }
      }
      // Retained references are reauthorized too; a new B request cannot launder A's revoked scope.
      await this.authorizeReferenceEvidence(executor, input,
        (modelInput as ReturnType<typeof buildMatterJobAidTask>).sourceCatalog ?? []);
      if (overviewCorrection) {
        if (current?.matterWorkRevisionId !== overviewCorrection.expectedWorkRef ||
            !current.state.problemWork?.understanding.trim() || current.state.problemWork.overviewStatus === 'NOT_AVAILABLE')
          throw failure('ENGINEERING_OVERVIEW_CORRECTION_WORK_BINDING_CHANGED');
        const jobAid = modelInput as ReturnType<typeof buildMatterJobAidTask>;
        if (overviewCorrection.evidenceRefs.some(ref => !jobAid.initiallyDeliveredRefs.includes(ref)))
          throw failure('ENGINEERING_OVERVIEW_CORRECTION_SOURCE_NOT_DELIVERED');
        jobAid.overviewCorrection = structuredClone(overviewCorrection);
        jobAid.modelInput.overviewCorrection = structuredClone(overviewCorrection);
        // New explicit overview corrections use the bounded official plugin. A sealed
        // legacy investigation/recovery keeps its original execution route.
        if (!recoveryTask) {
          buildEngineeringOverviewCorrectionContext({ current, ...overviewCorrection,
            expectedWorkRevision: input.expectedWorkingRevision,
            deliveredEvidence: overviewCorrection.evidenceRefs.map(ref => jobAid.sourceCatalog.find(item => item.evidenceRef === ref)!),
            limitations: [] });
          jobAid.correction = structuredClone(overviewCorrection);
        }
      }
      if (correction) {
        if (current?.matterWorkRevisionId !== correction.expectedWorkRef ||
            !current.state.problemWork?.issues.some(issue => issue.issueKey === correction.issueKey))
          throw failure('ENGINEERING_CORRECTION_WORK_BINDING_CHANGED');
        // This dedicated consumer generates immediately after CLAIM. Reject an
        // incomplete source selection before creating a durable runnable task.
        const jobAid = modelInput as ReturnType<typeof buildMatterJobAidTask>;
        const delivered = new Map(jobAid.sourceCatalog
          .filter(item => jobAid.initiallyDeliveredRefs.includes(item.evidenceRef))
          .map(item => [item.evidenceRef, item]));
        buildEngineeringIssueCorrectionContext({ current, ...correction,
          expectedWorkRevision: input.expectedWorkingRevision,
          deliveredEvidence: correction.evidenceRefs.map(ref => {
            const evidence = delivered.get(ref);
            if (!evidence) throw failure('ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED');
            return evidence;
          }), limitations: [] });
        (modelInput as ReturnType<typeof buildMatterJobAidTask>).correction = structuredClone(correction);
      }
      if (recoveryTask && recoveryRow) {
        const jobAid = modelInput as ReturnType<typeof buildMatterJobAidTask>;
        jobAid.recovery = { attemptRef: recoveryTask.operationRef, inputHash: recoveryTask.inputHash };
        const reads: AssessmentEvidence[] = [];
        for (const event of JSON.parse(recoveryRow.reviewActivityJson ?? '[]')) {
          if (event.kind === 'MATTER_REGISTERED_SOURCES_READ') reads.push(...event.evidence);
          if (event.kind === 'MATTER_SOURCE_PAGES_READ') {
            const reading = event.reading as DocumentSourceReading;
            if (!jobAid.modelInput.availableDocuments.some(item => item.documentVersionId === reading.documentVersionId))
              throw failure('MATTER_RECOVERY_BASIS_CHANGED');
            reads.push(...reading.pages.flatMap(page => page.evidence ? [page.evidence] : []));
          }
          if (event.kind === 'MATTER_ORIGINAL_READ') {
            const reading = event.reading as DocumentOriginalEngineeringReading;
            if (!jobAid.modelInput.availableDocuments.some(item => item.documentVersionId === reading.documentVersionId))
              throw failure('MATTER_RECOVERY_BASIS_CHANGED');
            reads.push(...reading.evidence);
          }
        }
        addMatterDeliveredEvidence(jobAid, reads);
      }
      const task = parseMatterTaskEnvelope(
        canonicalJson(
          sealMatterTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2',
            taskType: 'OPENCLAW_MATTER_ASSESSMENT',
            actionAttemptId: `ATT-${randomUUID()}`,
            operationRef: `AQ-${randomUUID().replaceAll('-', '')}`,
            tenantId: input.tenantId,
            subject: {
              kind: 'ENGINEERING_MATTER',
              matterId: input.matterId,
              matterRevisionId: input.expectedMatterRevisionId,
            },
            trigger: structuredClone(input.trigger),
            workingBasis: {
              inputs: authorizedInputs,
              priorWorkRef: current?.matterWorkRevisionId ?? null,
            },
            priority: 100,
            inputRevision: input.expectedMatterRevision,
            baseRevision: input.expectedWorkingRevision,
            sourceRefs: 'sourceRefs' in input ? structuredClone(input.sourceRefs) : [],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: structuredClone(modelInput),
            ...(!(modelInput as ReturnType<typeof buildMatterJobAidTask>).correction ? { executionModel: recoveryTask?.executionModel ?? await this.models.captureForNewTask(
              input.tenantId,
              now,
              executor.database,
            ) } : {}),
            deadline: new Date(
              now.getTime() + ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
            ).toISOString(),
            idempotencyKey: input.idempotencyKey,
          }),
        ),
      );
      await executor.database.insert(actionAttempt).values({
        attemptId: task.actionAttemptId,
        operationRef: task.operationRef,
        subjectKind: 'ENGINEERING_MATTER',
        workItemId: null,
        documentVersionId: null,
        matterId: input.matterId,
        matterRevisionId: input.expectedMatterRevisionId,
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        actionType: task.taskType,
        attemptNo: (latest?.number ?? 0) + 1,
        triggerRequestId: `REQ-${randomUUID()}`,
        requestOrigin: ACTION_ATTEMPT_REQUEST_ORIGIN,
        status: 'QUEUED',
        inputRevision: task.inputRevision,
        baseRevision: task.baseRevision,
        taskEnvelopeJson: canonicalJson(task),
        taskInputHash: task.inputHash,
        executionModelJson: canonicalJson(task.executionModel ?? null),
        reviewActivityJson: recoveryRow ? canonicalJson(
          (JSON.parse(recoveryRow.reviewActivityJson ?? '[]') as Array<Record<string, unknown>>)
            .filter(event => event.kind === 'MATTER_ORIGINAL_BOUND' || event.kind === 'MATTER_ORIGINAL_READ'),
        ) : '[]',
        idempotencyKey: task.idempotencyKey,
        nextAttemptAt: now,
        deadlineAt: new Date(task.deadline),
        createdAt: now,
        updatedAt: now,
      });
      return {
        row: await this.scopedRow(executor, queue, input, task.operationRef),
        task,
        created: true,
      };
    }, nativeActor);
  }

  read(
    input: MatterAttemptScope & { attemptRef: string },
  ): Promise<MatterActionAttemptRow> {
    return this.authorized(input, (executor, queue) =>
      this.scopedRow(executor, queue, input, input.attemptRef),
    );
  }

  /**
   * Read the immutable execution basis needed to audit or recover one exact
   * attempt.  This deliberately projects identities and save receipts only;
   * leases, the execution model and the model payload remain private.  The
   * scoped row read re-authorizes every referenced work before any reference
   * identity is returned, so revocation still closes this view.
   */
  readStatus(input: MatterAttemptScope & { attemptRef: string }) {
    return this.authorized(input, async (executor, queue) => {
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const task = checkedTask(row);
      const jobAid = task.modelInput as ReturnType<typeof buildMatterJobAidTask>;
      const events = JSON.parse(row.reviewActivityJson ?? '[]') as Array<Record<string, unknown>>;
      const savedWorkReceipts = events.flatMap((event) => {
        if (
          event.kind !== 'MATTER_JOBAID_WORK_SAVED' ||
          typeof event.requestId !== 'string' ||
          typeof event.workRevisionRef !== 'string' ||
          !Number.isSafeInteger(event.expectedWorkRevision)
        ) return [];
        return [{
          requestId: event.requestId,
          expectedWorkRevision: event.expectedWorkRevision as number,
          workRevisionRef: event.workRevisionRef,
        }];
      });
      return {
        row,
        audit: {
          matterRevisionId: task.subject.matterRevisionId,
          matterRevision: task.inputRevision,
          baseWorkingRevision: task.baseRevision,
          trigger: structuredClone(task.trigger),
          priorWorkRef: task.workingBasis.priorWorkRef,
          inputs: structuredClone(task.workingBasis.inputs),
          referenceWorks: (jobAid.modelInput.referenceWorks ?? []).map((reference) => ({
              matterId: reference.matterId,
              workRef: reference.workRef,
              issueKey: reference.issueKey,
              purpose: reference.purpose,
              evidenceRef: reference.evidenceRef,
              overviewStatus: reference.overviewStatus,
              correctionNotices: structuredClone(reference.correctionNotices),
              overviewCorrectionNotices: structuredClone(reference.overviewCorrectionNotices),
            })),
          savedWorkReceipts,
        },
      };
    });
  }

  readForBrowser(input: MatterAttemptScope & { attemptRef: string }, actor: CanonicalHostActor) {
    return this.authorized(input, (executor, queue) => this.scopedRow(executor, queue, input, input.attemptRef), actor);
  }

  async claim(
    input: MatterAttemptScope & { attemptRef: string; principalId: string },
  ) {
    if (!input.principalId?.trim())
      throw failure('ACTION_ATTEMPT_LEASE_OWNER_REQUIRED', 400);
    const outcome = await this.authorized(input, async (executor, queue) => {
      let row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const now = new Date();
      if (row.status === 'COMMITTING') {
        if (row.leaseOwner !== input.principalId)
          throw failure('ACTION_ATTEMPT_LEASE_OWNER_MISMATCH');
        return recoveryClaim(row);
      }
      if (
        row.status === 'RUNNING' &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt <= now
      ) {
        await queue.recoverExpiredRunning({ attemptId: row.attemptId, now });
        row = await this.scopedRow(executor, queue, input, input.attemptRef);
      }
      if (row.status === 'RUNNING' && row.deadlineAt && row.deadlineAt <= now) {
        await queue.finishTerminal({
          attemptId: row.attemptId,
          fromStatus: 'RUNNING',
          status: 'TIMED_OUT',
          terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
          leaseToken: row.leaseToken ?? undefined,
          leaseGeneration: row.leaseGeneration,
          now,
        });
        return { error: 'ACTION_ATTEMPT_TIMED_OUT' };
      }
      if (
        row.status === 'RUNNING' &&
        row.leaseOwner === input.principalId &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt > now
      )
        return this.runningClaim(executor, row);
      if (!['QUEUED', 'RETRY_SCHEDULED'].includes(row.status))
        return { error: `ACTION_ATTEMPT_${row.status}` };
      if (row.deadlineAt && row.deadlineAt <= now) {
        await queue.finishTerminal({
          attemptId: row.attemptId,
          fromStatus: row.status,
          status: 'TIMED_OUT',
          terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
          now,
        });
        return { error: 'ACTION_ATTEMPT_TIMED_OUT' };
      }
      const current = await executor.loadCurrent(input);
      if (
        (current?.workingRevision ?? 0) !== row.baseRevision &&
        current?.source?.actionAttemptId !== row.attemptId
      ) {
        await queue.finishTerminal({
          attemptId: row.attemptId,
          fromStatus: row.status,
          status: 'CONFLICT',
          terminalReason: 'MATTER_WORKING_REVISION_CHANGED_BEFORE_CLAIM',
          now,
        });
        return { error: 'MATTER_WORKING_REVISION_CHANGED_BEFORE_CLAIM' };
      }
      for (
        let leaseSlot = 0;
        leaseSlot < ACTION_ATTEMPT_MAX_PARALLEL;
        leaseSlot++
      ) {
        // The common primitive enforces slot uniqueness and the full lease CAS.
        let claimed = false;
        try {
          claimed = await executor.database.transaction(async (transaction) =>
            Boolean(
              await new ActionAttemptRepository(transaction).claimExact({
                attemptId: row.attemptId,
                expectedStatus: row.status as 'QUEUED' | 'RETRY_SCHEDULED',
                expectedClaimCount: row.claimCount,
                expectedLeaseGeneration: row.leaseGeneration,
                operationRef: input.attemptRef,
                startedAt: row.startedAt,
                leaseOwner: input.principalId,
                leaseSlot,
                now,
                leaseMs: ACTION_ATTEMPT_LEASE_MS,
                propagateSlotConflict: true,
              }),
            ),
          );
        } catch (error) {
          if (!isLeaseSlotConflict(error)) throw error;
        }
        if (claimed)
          return this.runningClaim(
            executor,
            await this.scopedRow(executor, queue, input, input.attemptRef),
          );
      }
      return { error: 'ACTION_ATTEMPT_CLAIM_UNAVAILABLE' };
    });
    if ('error' in outcome) throw failure(outcome.error);
    return outcome;
  }

  heartbeat(
    input: MatterAttemptScope & ActionAttemptFence & { principalId: string },
  ) {
    return this.authorized(input, async (executor, queue) => {
      const row = await this.scopedRow(
        executor,
        queue,
        input,
        input.attemptRef,
      );
      assertLease(row, input);
      const now = new Date();
      if (
        !(await queue.heartbeat({
          attemptId: row.attemptId,
          leaseToken: input.leaseToken,
          leaseGeneration: input.leaseGeneration,
          now,
          leaseMs: ACTION_ATTEMPT_LEASE_MS,
        }))
      )
        throw failure('ACTION_ATTEMPT_HEARTBEAT_FENCE_REJECTED');
      return {
        leaseExpiresAt: new Date(
          now.getTime() + ACTION_ATTEMPT_LEASE_MS,
        ).toISOString(),
      };
    });
  }

  /** Reader is a Host service, never a model-supplied evidence payload. */
  readRegisteredSources(input: MatterAttemptScope & ActionAttemptFence & { principalId: string; sourceRefs: string[]; purpose: string }) {
    if (!input.sourceRefs.length || input.sourceRefs.length > 96 || new Set(input.sourceRefs).size !== input.sourceRefs.length ||
      !input.purpose.trim() || input.purpose.length > 4000) throw failure('JOBAID_SOURCE_SELECTION_INVALID', 400);
    return this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef)).for('update');
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      assertRunningSourceLease(row, input);
      const task = checkedTask(row);
      if (task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA) throw failure('MATTER_JOBAID_TASK_REQUIRED');
      const taskInput = task.modelInput as ReturnType<typeof buildMatterJobAidTask>;
      const evidence = input.sourceRefs.map(ref => {
        const item = taskInput.sourceCatalog.find(item => item.evidenceRef === ref);
        if (!item || (item.kind === 'DOCUMENT_PASSAGE' && !taskInput.initiallyDeliveredRefs.includes(ref)))
          throw failure('JOBAID_SOURCE_NOT_REGISTERED', 404);
        return item;
      });
      const receipt = { kind: 'MATTER_REGISTERED_SOURCES_READ', sourceRefs: input.sourceRefs,
        purpose: input.purpose, evidence, observedAt: new Date().toISOString() };
      await executor.database.update(actionAttempt).set({
        reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${canonicalJson([receipt])}::jsonb)::text`,
      }).where(eq(actionAttempt.attemptId, row.attemptId));
      return { evidence, sourceRefs: input.sourceRefs };
    });
  }

  async readSourcePages(input: MatterAttemptScope & ActionAttemptFence & {
    principalId: string; documentVersionId: string; pageStart: number; pageEnd?: number; purpose: string;
  }, reader: (documentVersionId: string, range: { pageStart: number; pageEnd: number }) => Promise<DocumentSourceReading>) {
    const range = documentSourcePageRange({ pageStart: input.pageStart, pageEnd: input.pageEnd });
    if (!input.purpose.trim() || input.purpose.length > 4000) throw failure('JOBAID_SOURCE_PURPOSE_REQUIRED', 400);
    const initial = await this.authorized(input, async (executor, queue) => {
      const initial = await this.scopedRow(executor, queue, input, input.attemptRef);
      const task = checkedTask(initial);
      assertRunningSourceLease(initial, input);
      const priorWork = task.workingBasis.priorWorkRef ? await this.working.readByRef({
        tenantId: input.tenantId, matterId: input.matterId, workRef: task.workingBasis.priorWorkRef,
      }, executor.database) : null;
      const priorEvidence = priorWork?.state.problemWork?.evidence ?? priorWork?.state.substantiveResult?.evidence ?? [];
      if (task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA ||
          !(task.workingBasis.inputs.some((binding) => binding.documentVersionId === input.documentVersionId) ||
            priorEvidence.some((item) => item.kind === 'DOCUMENT_PASSAGE' && item.documentVersionId === input.documentVersionId)))
        throw failure('JOBAID_SOURCE_NOT_REGISTERED', 404);
      return initial;
    });
    // The document reader performs its own authorized database and file reads.
    // Release the transaction first so those reads and lease heartbeats can run
    // on a bounded connection pool; recheck authorization and the fence below.
    const reading = await reader(input.documentVersionId, range);
    if (reading.documentVersionId !== input.documentVersionId || reading.extractionScope !== 'NATIVE_TEXT_LAYER' ||
        reading.pages.length !== range.pageEnd - range.pageStart + 1 || reading.pages.some((page, index) =>
          page.page !== range.pageStart + index || page.sourceRefId !== `DOCUMENT_VERSION:${input.documentVersionId}:page:${page.page}` ||
          Boolean(page.text) !== (page.evidence !== null) ||
          (page.evidence !== null && (page.evidence.documentVersionId !== input.documentVersionId ||
            page.evidence.workItemId !== null || page.evidence.sourceRefId !== page.sourceRefId ||
            page.evidence.evidenceRef !== page.sourceRefId || page.evidence.excerpt !== page.text))))
      throw failure('MATTER_SOURCE_READ_BINDING_MISMATCH');
    return this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.attemptId, initial.attemptId)).for('update');
      const current = await this.scopedRow(executor, queue, input, input.attemptRef);
      assertRunningSourceLease(current, input);
      if (current.taskInputHash !== initial.taskInputHash) throw failure('MATTER_SOURCE_READ_BINDING_MISMATCH');
      const events: unknown[] = JSON.parse(current.reviewActivityJson ?? '[]');
      for (const event of events) {
        if (!event || typeof event !== 'object' || !('kind' in event) || event.kind !== 'MATTER_SOURCE_PAGES_READ' || !('reading' in event)) continue;
        const prior = event.reading as DocumentSourceReading;
        if (prior.documentVersionId !== reading.documentVersionId) continue;
        if (prior.sourceSha256 !== reading.sourceSha256 || prior.sourceByteLength !== reading.sourceByteLength ||
          reading.pages.some((page) => prior.pages.some((old) => old.sourceRefId === page.sourceRefId && canonicalJson(old) !== canonicalJson(page))))
          throw failure('MATTER_SOURCE_READ_IDENTITY_CHANGED');
      }
      const activity = { kind: 'MATTER_SOURCE_PAGES_READ', observedAt: new Date().toISOString(),
        purpose: input.purpose, reading };
      await executor.database.update(actionAttempt).set({
        reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${canonicalJson([activity])}::jsonb)::text`,
      }).where(eq(actionAttempt.attemptId, current.attemptId));
      return reading;
    });
  }

  async readOriginal(input: MatterAttemptScope & ActionAttemptFence & {
    principalId: string; documentVersionId: string; offset: number; limit: number; purpose: string;
  }, reader: UnifiedReaderService) {
    if (!input.purpose.trim() || input.purpose.length > 4000 || !Number.isSafeInteger(input.offset) || input.offset < 0 ||
        !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) throw failure('DOCUMENT_ORIGINAL_RANGE_INVALID',400);
    const binding = await this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef,input.attemptRef)).for('update');
      const row = await this.scopedRow(executor,queue,input,input.attemptRef);
      assertRunningSourceLease(row,input);
      const task = checkedTask(row);
      const priorWork = task.workingBasis.priorWorkRef ? await this.working.readByRef({
        tenantId: input.tenantId, matterId: input.matterId, workRef: task.workingBasis.priorWorkRef,
      }, executor.database) : null;
      const priorEvidence = priorWork?.state.problemWork?.evidence ?? priorWork?.state.substantiveResult?.evidence ?? [];
      if (task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA ||
          !(task.workingBasis.inputs.some(item => item.documentVersionId === input.documentVersionId) ||
            priorEvidence.some(item => item.kind === 'DOCUMENT_PASSAGE' && item.documentVersionId === input.documentVersionId)))
        throw failure('JOBAID_SOURCE_NOT_REGISTERED',404);
      const events = JSON.parse(row.reviewActivityJson ?? '[]') as Array<Record<string, unknown>>;
      const existing = events.find(event => event.kind === 'MATTER_ORIGINAL_BOUND' && event.documentVersionId === input.documentVersionId);
      const frozenOriginal = task.workingBasis.inputs.find(item => item.documentVersionId === input.documentVersionId)?.original;
      if (existing) {
        if (frozenOriginal && frozenOriginal.parseRunId !== existing.parseRunId) throw failure('MATTER_SOURCE_READ_BINDING_MISMATCH');
        return { parseRunId: String(existing.parseRunId), taskInputHash: row.taskInputHash,
          semantic: frozenOriginal?.semantic ?? null };
      }
      const [published] = await executor.database.select().from(dmDocumentParseRun)
        .where(and(eq(dmDocumentParseRun.tenantId,input.tenantId),eq(dmDocumentParseRun.documentVersionId,input.documentVersionId),
          eq(dmDocumentParseRun.status,'PUBLISHED'), ...(frozenOriginal ? [eq(dmDocumentParseRun.parseRunId,frozenOriginal.parseRunId),
            eq(dmDocumentParseRun.parseRevision,frozenOriginal.parseRevision)] : []))).orderBy(desc(dmDocumentParseRun.parseRevision)).limit(1);
      if (!published || published.manifestArtifact?.relativePath !== 'original/manifest.json')
        throw failure('DOCUMENT_ORIGINAL_NOT_PUBLISHED',409);
      await executor.database.update(actionAttempt).set({ reviewActivityJson: canonicalJson([...events,
        { kind:'MATTER_ORIGINAL_BOUND',documentVersionId:input.documentVersionId,parseRunId:published.parseRunId }]) })
        .where(eq(actionAttempt.attemptId,row.attemptId));
      return { parseRunId:published.parseRunId,taskInputHash:row.taskInputHash,
        semantic: frozenOriginal?.semantic ?? null };
    });
    const reading = await this.working.withActorScope(input.actorUserId, async () => {
      const scope = {tenantId:input.tenantId,actorUserId:input.actorUserId,documentVersionId:input.documentVersionId,roles:[]};
      const loaded = await reader.readDocumentOriginal(input.documentVersionId,binding.parseRunId,scope);
      if (binding.semantic && !this.semantics) throw failure('DOCUMENT_SEMANTIC_READER_UNAVAILABLE');
      // Old running work remains unorganized; never attach a later latest map to its frozen input.
      const map = binding.semantic ? await this.semantics!.read(scope,loaded,binding.semantic.revision) : null;
      if (binding.semantic && map?.profileRef !== binding.semantic.profileRef)
        throw failure('MATTER_SEMANTIC_BINDING_MISMATCH');
      return documentOriginalEngineeringReading(loaded,input.offset,input.limit,map);
    });
    return this.authorized(input,async (executor,queue) => {
      await executor.database.select({ id:actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef,input.attemptRef)).for('update');
      const row = await this.scopedRow(executor,queue,input,input.attemptRef);
      assertRunningSourceLease(row,input);
      if (row.taskInputHash !== binding.taskInputHash || reading.binding.parseRunId !== binding.parseRunId ||
          reading.documentVersionId !== input.documentVersionId) throw failure('MATTER_SOURCE_READ_BINDING_MISMATCH');
      const events = JSON.parse(row.reviewActivityJson ?? '[]') as Array<Record<string, unknown>>;
      for (const event of events.filter(event => event.kind === 'MATTER_ORIGINAL_READ')) {
        const prior = event.reading as DocumentOriginalEngineeringReading;
        if (prior.documentVersionId !== reading.documentVersionId) continue;
        if (prior.artifactSha256 !== reading.artifactSha256 || canonicalJson(prior.binding) !== canonicalJson(reading.binding) ||
            prior.evidence.some(old => reading.evidence.some(now => now.evidenceRef === old.evidenceRef && canonicalJson(old) !== canonicalJson(now))))
          throw failure('MATTER_SOURCE_READ_IDENTITY_CHANGED');
      }
      const [documentIdentity] = await readMatterDocumentIdentities(executor.database, input.tenantId, [input.documentVersionId]);
      const delivered = { ...reading, documentIdentity };
      await executor.database.update(actionAttempt).set({ reviewActivityJson:canonicalJson([...events,
        {kind:'MATTER_ORIGINAL_READ',purpose:input.purpose,observedAt:new Date().toISOString(),reading:delivered}]) })
        .where(eq(actionAttempt.attemptId,row.attemptId));
      return delivered;
    });
  }

  cancel(input: MatterAttemptScope & { attemptRef: string; reason: string }) {
    return this.authorized(input, async (executor, queue) => {
      const row = await this.scopedRow(
        executor,
        queue,
        input,
        input.attemptRef,
      );
      const result = await queue.requestCancel({
        attemptId: row.attemptId,
        reason: input.reason,
        now: new Date(),
      });
      if (result !== 'CANCELLED')
        throw failure(`ACTION_ATTEMPT_CANCEL_${result}`);
      return this.scopedRow(executor, queue, input, input.attemptRef);
    });
  }

  /** Receives a Host-materialized JobAid command; the model cannot set input bindings. */
  saveWorkingDraft(
    input: MatterAttemptScope &
      ActionAttemptFence & {
        principalId: string;
        command: EngineeringMatterWorkingRevisionCommand;
      },
  ) {
    return this.authorized(input, async (executor, queue) => {
      // Keep the same lock order as commit and working append: Matter, then attempt.
      await executor.database
        .select({ id: engineeringMatter.matterId })
        .from(engineeringMatter)
        .where(
          and(
            eq(engineeringMatter.tenantId, input.tenantId),
            eq(engineeringMatter.matterId, input.matterId),
          ),
        )
        .limit(1)
        .for('update');
      await executor.database
        .select({ id: actionAttempt.attemptId })
        .from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef))
        .limit(1)
        .for('update');
      const row = await this.scopedRow(
        executor,
        queue,
        input,
        input.attemptRef,
      );
      const task = checkedTask(row);
      const source = {
        kind: 'ENGINEERING_MATTER' as const,
        actionAttemptId: row.attemptId,
        reviewTurnId: null,
      };
      const priorSave = await this.working.findBySource(
        { ...input, source, requestId: input.command.requestId },
        executor.database,
      );
      if (!priorSave) {
        assertLease(row, input);
        const now = new Date();
        if (
          row.status !== 'RUNNING' ||
          !row.leaseExpiresAt ||
          row.leaseExpiresAt <= now ||
          !row.deadlineAt ||
          row.deadlineAt <= now ||
          row.cancelRequestedAt
        )
          throw failure('ACTION_ATTEMPT_SAVE_FENCE_REJECTED');
      }
      // Repository replay compares the complete command and the exact save request.
      return executor.appendWorkingRevision({
        tenantId: input.tenantId,
        matterId: input.matterId,
        actorUserId: input.actorUserId,
        command: input.command,
        currentInputs: task.workingBasis.inputs,
        source,
      });
    });
  }

  /** Explicit targeted generation, never an automatic fallback from a failed Hosted call. */
  async executeIssueCorrection(input: MatterAttemptScope & ActionAttemptFence & { principalId: string; requestId: string }) {
    const row = await this.read(input);
    const task = checkedTask(row);
    const purpose = (task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction;
    if (!purpose) throw failure('ENGINEERING_CORRECTION_PURPOSE_MISMATCH');
    const generated = await this.generateIssueCorrection({ ...input, ...purpose, expectedWorkRevision: task.baseRevision });
    return { requestId: generated.requestId, producer: generated.producer, replayed: generated.replayed, persisted: true };
  }

  async generateIssueCorrection(input: MatterAttemptScope & ActionAttemptFence & {
    principalId: string; requestId: string; expectedWorkRef: string; expectedWorkRevision: number;
    kind?: 'ENGINEERING_ISSUE_CORRECTION' | 'ENGINEERING_OVERVIEW_CORRECTION';
    issueKey?: string; correctionReason: string; evidenceRefs: string[];
  }) {
    if (!this.issueCorrection) throw failure('ENGINEERING_CORRECTION_PLUGIN_NOT_CONFIGURED');
    if (!input.requestId.trim() || input.requestId.length > 255 || !input.correctionReason.trim() ||
        ((input.kind ?? 'ENGINEERING_ISSUE_CORRECTION') === 'ENGINEERING_ISSUE_CORRECTION' && !input.issueKey?.trim()) || !input.evidenceRefs.length ||
        new Set(input.evidenceRefs).size !== input.evidenceRefs.length)
      throw failure('ENGINEERING_CORRECTION_REQUEST_INVALID', 400);
    const request = { purpose: input.kind ?? 'ENGINEERING_ISSUE_CORRECTION', requestId: input.requestId,
      expectedWorkRef: input.expectedWorkRef, expectedWorkRevision: input.expectedWorkRevision,
      issueKey: input.issueKey, correctionReason: input.correctionReason, evidenceRefs: input.evidenceRefs };
    type Generated = Awaited<ReturnType<EngineeringIssueCorrectionPluginService['generate'] | EngineeringIssueCorrectionPluginService['generateOverview']>>;
    const prepared = await this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef)).for('update');
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const task = checkedTask(row);
      if (task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA) throw failure('MATTER_JOBAID_TASK_REQUIRED');
      const events: Array<Record<string, unknown>> = JSON.parse(row.reviewActivityJson ?? '[]');
      const purpose = (task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction;
      if (!purpose || purpose.kind !== request.purpose || purpose.expectedWorkRef !== input.expectedWorkRef ||
          (purpose.kind === 'ENGINEERING_ISSUE_CORRECTION' && purpose.issueKey !== input.issueKey) ||
          purpose.correctionReason !== input.correctionReason || canonicalJson(purpose.evidenceRefs) !== canonicalJson(input.evidenceRefs) ||
          task.baseRevision !== input.expectedWorkRevision)
        throw failure('ENGINEERING_CORRECTION_PURPOSE_MISMATCH');
      const started = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_STARTED' && event.requestId === input.requestId);
      if (started) {
        if (canonicalJson(started.request) !== canonicalJson(request)) throw failure('ENGINEERING_CORRECTION_REPLAY_MISMATCH');
        const completed = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_GENERATED' && event.requestId === input.requestId);
        if (!completed) throw failure('ENGINEERING_CORRECTION_RESULT_UNCONFIRMED');
        return { result: completed.result as Generated, context: null };
      }
      if (events.some(event => event.kind === 'MATTER_ISSUE_CORRECTION_STARTED'))
        throw failure('ENGINEERING_CORRECTION_REQUEST_ALREADY_STARTED');
      assertRunningSourceLease(row, input);
      const current = await executor.loadCurrent(input);
      if (!current) throw failure('ENGINEERING_CORRECTION_CURRENT_BODY_REQUIRED');
      const taskInput = task.modelInput as ReturnType<typeof buildMatterJobAidTask>;
      const registry = new Map<string, AssessmentEvidence>();
      const add = (item: AssessmentEvidence) => {
        const prior = registry.get(item.evidenceRef);
        if (prior && canonicalJson(prior) !== canonicalJson(item)) throw failure('MATTER_SOURCE_READ_IDENTITY_CHANGED');
        registry.set(item.evidenceRef, item);
      };
      // Only actual delivery is eligible. A catalog entry alone is not evidence read by this task.
      taskInput.sourceCatalog.filter(item => taskInput.initiallyDeliveredRefs.includes(item.evidenceRef)).forEach(add);
      for (const event of events) {
        if (event.kind === 'MATTER_REGISTERED_SOURCES_READ') (event.evidence as AssessmentEvidence[]).forEach(add);
        if (event.kind === 'MATTER_ORIGINAL_READ') (event.reading as DocumentOriginalEngineeringReading).evidence.forEach(add);
        if (event.kind === 'MATTER_SOURCE_PAGES_READ')
          (event.reading as DocumentSourceReading).pages.forEach(page => { if (page.evidence) add(page.evidence); });
      }
      const evidence = input.evidenceRefs.map(ref => {
        const item = registry.get(ref);
        if (!item) throw failure('ENGINEERING_CORRECTION_SOURCE_NOT_DELIVERED');
        return item;
      });
      const identities = await readMatterDocumentIdentities(executor.database, input.tenantId,
        evidence.flatMap(item => 'documentVersionId' in item ? [item.documentVersionId] : []));
      const limitations = identities.map(identity => `本次来源目录身份核对：${canonicalJson(identity)}`);
      const context = purpose.kind === 'ENGINEERING_OVERVIEW_CORRECTION'
        ? buildEngineeringOverviewCorrectionContext({ current, ...request, deliveredEvidence: evidence, limitations })
        : buildEngineeringIssueCorrectionContext({ current, ...request, issueKey: purpose.issueKey, deliveredEvidence: evidence,
          limitations: ['本操作更正指定问题正文、要求处理及未决问题；其他风险、措施、分类保持原值，受影响但无法在本操作修改的判断须保留明确未知。总体认识仍须核对，不代表正式采用。', ...limitations] });
      await executor.database.update(actionAttempt).set({ reviewActivityJson: canonicalJson([...events, {
        kind: 'MATTER_ISSUE_CORRECTION_STARTED', requestId: input.requestId, request, context,
        observedAt: new Date().toISOString(),
      }]) }).where(eq(actionAttempt.attemptId, row.attemptId));
      return { result: null, context };
    });
    if (prepared.result) return { ...prepared.result, requestId: input.requestId, replayed: true };
    const assertActive = () => this.authorized(input, async (executor, queue) => {
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      assertRunningSourceLease(row, input);
      const current = await executor.loadCurrent(input);
      if (current?.matterWorkRevisionId !== input.expectedWorkRef || current.workingRevision !== input.expectedWorkRevision)
        throw failure('ENGINEERING_CORRECTION_WORK_BINDING_CHANGED');
    });
    // Outside the transaction. An uncertain response leaves STARTED, never a permission to regenerate.
    let result: Generated;
    try {
      result = 'overview' in prepared.context!
        ? await this.issueCorrection.generateOverview(prepared.context!, assertActive)
        : await this.issueCorrection.generate(prepared.context!, assertActive);
    } catch (error) {
      // Only the invocation owner terminalizes its ended call. Concurrent observers of STARTED
      // fail above and cannot cancel a generation that is still running.
      const reason = error instanceof Error && /^ENGINEERING_CORRECTION_[A-Z_]+$/.test(error.message)
        ? error.message : 'ENGINEERING_CORRECTION_GENERATION_UNCONFIRMED';
      await this.authorized(input, async (executor, queue) => {
        const row = await this.scopedRow(executor, queue, input, input.attemptRef);
        assertRunningSourceLease(row, input);
        if (!await queue.finishTerminal({ attemptId: row.attemptId, fromStatus: 'RUNNING', status: 'FAILED',
          terminalReason: reason, leaseToken: input.leaseToken, leaseGeneration: input.leaseGeneration, now: new Date() }))
          throw failure('ENGINEERING_CORRECTION_TERMINALIZATION_LOST');
      });
      throw error;
    }
    await this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef)).for('update');
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      assertRunningSourceLease(row, input);
      await executor.database.update(actionAttempt).set({
        reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${canonicalJson([{
          kind: 'MATTER_ISSUE_CORRECTION_GENERATED', requestId: input.requestId, result, observedAt: new Date().toISOString(),
        }])}::jsonb)::text`,
      }).where(eq(actionAttempt.attemptId, row.attemptId));
    });
    return { ...result, requestId: input.requestId, replayed: false };
  }

  /** The caller selects a persisted generation; it cannot replace it with hand-written work. */
  async saveIssueCorrection(input: MatterAttemptScope & ActionAttemptFence & {
    principalId: string; requestId: string; generationRequestId: string;
  }) {
    const savedInput = await this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef)).for('update');
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const events: Array<Record<string, unknown>> = JSON.parse(row.reviewActivityJson ?? '[]');
      const started = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_STARTED' && event.requestId === input.generationRequestId);
      const completed = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_GENERATED' && event.requestId === input.generationRequestId);
      if (!started || !completed) throw failure('ENGINEERING_CORRECTION_GENERATION_REQUIRED');
      if (correctionReceiptUnchanged(started, completed)) {
        const request = started.request as { expectedWorkRef: string; expectedWorkRevision: number };
        const prior = events.find(event => event.kind === 'MATTER_CORRECTION_UNCHANGED' && event.requestId === input.requestId);
        if (prior && prior.generationRequestId !== input.generationRequestId)
          throw failure('ENGINEERING_CORRECTION_REPLAY_MISMATCH');
        if (!prior) {
          assertRunningSourceLease(row, input);
          const current = await executor.loadCurrent(input);
          if (current?.matterWorkRevisionId !== request.expectedWorkRef || current.workingRevision !== request.expectedWorkRevision)
            throw failure('ENGINEERING_MATTER_WORKING_CAS_CONFLICT');
          await executor.database.update(actionAttempt).set({ reviewActivityJson: canonicalJson([...events, {
            kind: 'MATTER_CORRECTION_UNCHANGED', requestId: input.requestId,
            generationRequestId: input.generationRequestId, workRevisionRef: request.expectedWorkRef,
            workRevision: request.expectedWorkRevision, observedAt: new Date().toISOString(),
          }]) }).where(eq(actionAttempt.attemptId, row.attemptId));
        }
        return { unchanged: true as const, workRevisionRef: request.expectedWorkRef,
          workRevision: request.expectedWorkRevision, replayed: Boolean(prior) };
      }
      return correctionProposalFromReceipts(started, completed);
    });
    if ('unchanged' in savedInput) return savedInput;
    // Reuses the exact same authorization, lease, CAS, materialization, pending index and replay transaction.
    return this.saveJobAidWork({ ...input, ...savedInput });
  }

  saveJobAidWork(input: MatterAttemptScope & ActionAttemptFence & {
    principalId: string; requestId: string; expectedWorkRevision: number; workJson: string;
  }) {
    if (!input.requestId.trim() || input.requestId.length > 255 || !Number.isSafeInteger(input.expectedWorkRevision) ||
      input.expectedWorkRevision < 0 || input.workJson.length > 1_000_000) throw failure('MATTER_JOBAID_SAVE_INPUT_INVALID', 400);
    const proposal: unknown = JSON.parse(input.workJson);
    return this.authorized(input, async (executor, queue) => {
      await executor.database.select({ id: engineeringMatter.matterId }).from(engineeringMatter)
        .where(and(eq(engineeringMatter.tenantId, input.tenantId), eq(engineeringMatter.matterId, input.matterId))).for('update');
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef)).for('update');
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const task = checkedTask(row);
      if (task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA) throw failure('MATTER_JOBAID_TASK_REQUIRED');
      const taskInput = task.modelInput as ReturnType<typeof buildMatterJobAidTask>;
      const source = { kind: 'ENGINEERING_MATTER' as const, actionAttemptId: row.attemptId, reviewTurnId: null };
      const events: Array<Record<string, unknown>> = JSON.parse(row.reviewActivityJson ?? '[]');
      if (taskInput.correction) {
        const started = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_STARTED');
        const completed = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_GENERATED');
        if (!started || !completed || started.requestId !== completed.requestId)
          throw failure('ENGINEERING_CORRECTION_GENERATION_REQUIRED');
        const expected = correctionProposalFromReceipts(started, completed);
        if (expected.expectedWorkRevision !== input.expectedWorkRevision || expected.workJson !== canonicalJson(proposal))
          throw failure('ENGINEERING_CORRECTION_SAVE_MISMATCH');
      }
      const replay = events.find(event => event.kind === 'MATTER_JOBAID_WORK_SAVED' && event.requestId === input.requestId);
      if (replay) {
        if (replay.expectedWorkRevision !== input.expectedWorkRevision || canonicalJson(replay.proposal) !== canonicalJson(proposal))
          throw failure('MATTER_JOBAID_SAVE_REPLAY_MISMATCH');
        const revision = await this.working.findBySource({ ...input, source, requestId: input.requestId }, executor.database);
        if (!revision || revision.matterWorkRevisionId !== replay.workRevisionRef) throw failure('MATTER_JOBAID_SAVE_READBACK_MISMATCH');
        return { workRevisionRef: revision.matterWorkRevisionId, workRevision: revision.workingRevision,
          roundCompletion: revision.state.problemWork?.roundCompletion, replayed: true };
      }
      assertRunningSourceLease(row, input);
      const previous = await executor.loadCurrent(input);
      if ((previous?.workingRevision ?? 0) !== input.expectedWorkRevision) throw failure('ENGINEERING_MATTER_WORKING_CAS_CONFLICT');
      const registry = new Map<string, AssessmentEvidence>();
      const add = (evidence: AssessmentEvidence) => {
        const prior = registry.get(evidence.evidenceRef);
        if (prior && canonicalJson(prior) !== canonicalJson(evidence)) throw failure('MATTER_SOURCE_READ_IDENTITY_CHANGED');
        registry.set(evidence.evidenceRef, evidence);
      };
      taskInput.sourceCatalog.forEach(add);
      if (taskInput.modelInput.previousWork && 'legacySummary' in taskInput.modelInput.previousWork)
        throw failure('MATTER_JOBAID_LEGACY_WORK_UNSUPPORTED', 409);
      previous?.state.problemWork?.evidence.forEach(add);
      const readRefs = new Set([...taskInput.initiallyDeliveredRefs,
        ...(previous?.state.problemWork?.readSourceRefs ?? [])]);
      for (const event of events.filter(item => item.kind === 'MATTER_REGISTERED_SOURCES_READ')) {
        for (const item of event.evidence as AssessmentEvidence[]) { add(item); readRefs.add(item.evidenceRef); }
      }
      for (const event of events.filter(item => item.kind === 'MATTER_SOURCE_PAGES_READ')) {
        const reading = event.reading as DocumentSourceReading;
        for (const page of reading.pages) if (page.evidence) { add(page.evidence); readRefs.add(page.evidence.evidenceRef); }
      }
      for (const event of events.filter(item => item.kind === 'MATTER_ORIGINAL_READ')) {
        for (const item of (event.reading as DocumentOriginalEngineeringReading).evidence) { add(item); readRefs.add(item.evidenceRef); }
      }
      const command = materializeMatterJobAidCommand({ matterId: input.matterId, matterRevisionId: task.subject.matterRevisionId,
        attemptRef: input.attemptRef, requestId: input.requestId, expectedWorkRevision: input.expectedWorkRevision,
        previous, inputs: task.workingBasis.inputs, proposal, evidence: [...registry.values()], readSourceRefs: [...readRefs], currentReadSourceRefs: [
          ...taskInput.initiallyDeliveredRefs,
          ...events.filter(item => item.kind === 'MATTER_ORIGINAL_READ').flatMap(item => (item.reading as DocumentOriginalEngineeringReading).sourceRefs),
          ...events.filter(item => item.kind === 'MATTER_REGISTERED_SOURCES_READ').flatMap(item => (item.evidence as AssessmentEvidence[]).map(value => value.evidenceRef)),
          ...events.filter(item => item.kind === 'MATTER_SOURCE_PAGES_READ').flatMap(item => (item.reading as DocumentSourceReading).pages.flatMap(page => page.evidence ? [page.evidence.evidenceRef] : [])),
        ],
        capabilities: taskInput.modelInput.capabilities, history: taskInput.modelInput.historyReview,
        methodBinding: taskInput.modelInput.methodBinding });
      const saved = await executor.appendWorkingRevision({ tenantId: input.tenantId, matterId: input.matterId,
        actorUserId: input.actorUserId, command, currentInputs: task.workingBasis.inputs, source });
      const receipt = { kind: 'MATTER_JOBAID_WORK_SAVED', requestId: input.requestId,
        expectedWorkRevision: input.expectedWorkRevision, proposal, workRevisionRef: saved.revision.matterWorkRevisionId };
      await executor.database.update(actionAttempt).set({
        reviewActivityJson: sql`(COALESCE(${actionAttempt.reviewActivityJson}::jsonb, '[]'::jsonb) || ${canonicalJson([receipt])}::jsonb)::text`,
      }).where(eq(actionAttempt.attemptId, row.attemptId));
      return { workRevisionRef: saved.revision.matterWorkRevisionId, workRevision: saved.revision.workingRevision,
        roundCompletion: saved.revision.state.problemWork?.roundCompletion, replayed: saved.replayed };
    });
  }

  readSavedWork(
    input: MatterAttemptScope & { attemptRef: string; requestId: string },
  ) {
    if (!input.requestId.trim())
      throw failure('MATTER_SAVE_REQUEST_REQUIRED', 400);
    return this.authorized(input, async (executor, queue) => {
      const row = await this.scopedRow(
        executor,
        queue,
        input,
        input.attemptRef,
      );
      return this.working.findBySource(
        {
          ...input,
          requestId: input.requestId,
          source: {
            kind: 'ENGINEERING_MATTER',
            actionAttemptId: row.attemptId,
            reviewTurnId: null,
          },
        },
        executor.database,
      );
    });
  }

  /** Durable cutoff. Result replay is checked before any candidate is written. */
  async finishIssueCorrection(input: MatterAttemptScope & ActionAttemptFence & { principalId: string; requestId: string }) {
    const result = await this.authorized(input, async (executor, queue) => {
      // Serialize concurrent finishes with saves before observing terminal state.
      await executor.database.select({ id: engineeringMatter.matterId }).from(engineeringMatter)
        .where(and(eq(engineeringMatter.tenantId, input.tenantId), eq(engineeringMatter.matterId, input.matterId))).for('update');
      await executor.database.select({ id: actionAttempt.attemptId }).from(actionAttempt)
        .where(eq(actionAttempt.operationRef, input.attemptRef)).for('update');
      const row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const task = checkedTask(row);
      if (!(task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction)
        throw failure('ENGINEERING_CORRECTION_PURPOSE_MISMATCH');
      const events: Array<Record<string, unknown>> = JSON.parse(row.reviewActivityJson ?? '[]');
      const generated = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_GENERATED');
      const started = events.find(event => event.kind === 'MATTER_ISSUE_CORRECTION_STARTED');
      const saved = events.find(event => ['MATTER_JOBAID_WORK_SAVED', 'MATTER_CORRECTION_UNCHANGED'].includes(String(event.kind)) && event.requestId === input.requestId);
      if (!generated || !started || !saved) throw failure('ENGINEERING_CORRECTION_SAVED_RECEIPT_REQUIRED');
      if (row.resultEnvelopeJson && saved.kind !== 'MATTER_CORRECTION_UNCHANGED') {
        const stored = checkedResult(row);
        if (finishWorkRef(stored) !== saved.workRevisionRef) throw failure('ENGINEERING_CORRECTION_SAVE_MISMATCH');
        return stored;
      }
      const output = generated.result as Awaited<ReturnType<EngineeringIssueCorrectionPluginService['generate']>>;
      const overviewCorrection = (task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction?.kind === 'ENGINEERING_OVERVIEW_CORRECTION';
      const envelope: Omit<OpenClawMatterResultEnvelope, 'contentHash'> = {
        schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v2', taskType: task.taskType,
        subject: task.subject, actionAttemptId: task.actionAttemptId, operationRef: task.operationRef,
        baseRevision: task.baseRevision, status: 'SUCCEEDED', businessOutcome: 'CANDIDATE_READY', candidateStatus: null,
        modelOutput: canonicalJson({ workRevisionRef: saved.workRevisionRef }),
        outputArtifactRefs: [], sourceRefs: task.sourceRefs, factsConsidered: [], missingInputs: [], conflicts: [],
        warnings: [overviewCorrection ? '指定综合及完成说明的候选更正已保存；问题工作未改写，未构成正式采用。' : '指定问题正文更正已保存；整体工作仍需继续核对，未构成正式采用。'],
        modelVersion: null, skillVersion: null, producer: output.producer,
        promptVersion: overviewCorrection ? 'wl-engineering-overview-correction.v1' : 'wl-engineering-issue-correction.v1',
        toolVersions: { [output.producer.instanceId]: output.producer.pluginVersion },
        runMetrics: { durationMs: Date.parse(String(generated.observedAt)) - Date.parse(String(started.observedAt)),
          inputUnits: null, outputUnits: null }, errorCode: null, errorDetail: null,
      };
      if (saved.kind === 'MATTER_CORRECTION_UNCHANGED') {
        envelope.modelOutput = canonicalJson({ workRevisionRef: saved.workRevisionRef, unchanged: true });
        envelope.warnings = [overviewCorrection ? '本次核对没有改变综合及完成说明；保留原工作及覆盖状态，未形成新工作或正式采用。' : '本次核对没有改变目标问题；保留原工作及原综合覆盖状态，未形成新工作或正式采用。'];
        const sealed = parseMatterResultEnvelope({ task, value: { ...envelope, contentHash: canonicalSha256(envelope) } });
        if (row.status !== 'SUCCEEDED') {
          assertRunningSourceLease(row, input);
          const current = await executor.loadCurrent(input);
          if (current?.matterWorkRevisionId !== saved.workRevisionRef || current.workingRevision !== saved.workRevision)
            throw failure('ENGINEERING_MATTER_WORKING_CAS_CONFLICT');
          if (!await queue.finishTerminal({ attemptId: row.attemptId, fromStatus: 'RUNNING', status: 'SUCCEEDED',
            terminalReason: 'MATTER_CORRECTION_NO_CHANGE', result: sealed, projectionApplied: false,
            leaseToken: input.leaseToken, leaseGeneration: input.leaseGeneration, now: new Date() }))
            throw failure('ACTION_ATTEMPT_TERMINALIZATION_LOST');
        } else if (checkedResult(row).contentHash !== sealed.contentHash) throw failure('RESULT_ENVELOPE_REPLAY_MISMATCH');
        return { unchanged: true as const, attemptRef: input.attemptRef, status: 'SUCCEEDED' as const,
          workRevisionRef: String(saved.workRevisionRef), workRevision: Number(saved.workRevision) };
      }
      return { ...envelope, contentHash: canonicalSha256(envelope) };
    });
    if ('unchanged' in result) return result;
    return this.finishJobAid({ ...input, result });
  }

  async finishJobAid(input: MatterAttemptScope & ActionAttemptFence & { principalId: string; result: unknown }) {
    if (input.result && typeof input.result === 'object' && 'status' in input.result && input.result.status === 'SUCCEEDED') {
      const output: unknown = 'modelOutput' in input.result && typeof input.result.modelOutput === 'string'
        ? JSON.parse(input.result.modelOutput) : null;
      if (!output || typeof output !== 'object' || !('workRevisionRef' in output) ||
        typeof output.workRevisionRef !== 'string' || !output.workRevisionRef.trim())
        throw failure('JOBAID_FINISH_EXACT_COMPLETED_WORK_REQUIRED');
    }
    const prepared = await this.prepareCommit(input);
    if (prepared.result.status !== 'SUCCEEDED') return { attemptRef: input.attemptRef, status: prepared.row.status };
    const finished = await this.finish(input);
    return { attemptRef: input.attemptRef, status: finished.row.status,
      workRevisionRef: finished.work.matterWorkRevisionId, workRevision: finished.work.workingRevision };
  }

  async prepareCommit(
    input: MatterAttemptScope &
      ActionAttemptFence & { principalId: string; result: unknown },
  ) {
    const outcome = await this.authorized(input, async (executor, queue) => {
      let row = await this.scopedRow(executor, queue, input, input.attemptRef);
      const task = checkedTask(row);
      const result = parseMatterResultEnvelope({ task, value: input.result });
      if (
        row.status === 'COMMITTING' ||
        ['SUCCEEDED', 'FAILED', 'WAITING_INPUT'].includes(row.status)
      ) {
        const stored = checkedResult(row);
        if (stored.contentHash !== result.contentHash)
          throw failure('RESULT_ENVELOPE_REPLAY_MISMATCH');
        if (row.status === 'COMMITTING') assertLease(row, input);
        return { row, task, result: stored, recovery: true };
      }
      if (row.status !== 'RUNNING')
        throw failure(`ACTION_ATTEMPT_${row.status}`);
      assertLease(row, input);
      const now = new Date();
      if (row.deadlineAt && row.deadlineAt <= now) {
        if (
          !(await queue.finishTerminal({
            attemptId: row.attemptId,
            fromStatus: 'RUNNING',
            status: 'TIMED_OUT',
            terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
            leaseToken: input.leaseToken,
            leaseGeneration: input.leaseGeneration,
            now,
          }))
        )
          throw failure('ACTION_ATTEMPT_TIMEOUT_FENCE_REJECTED');
        return { error: 'ACTION_ATTEMPT_TIMED_OUT' };
      }
      if (!row.leaseExpiresAt || row.leaseExpiresAt <= now) {
        await queue.recoverExpiredRunning({ attemptId: row.attemptId, now });
        return { error: 'ACTION_ATTEMPT_LEASE_EXPIRED' };
      }
      if (row.cancelRequestedAt) throw failure('ACTION_ATTEMPT_CANCELLED');
      if (result.status !== 'SUCCEEDED') {
        if (
          !(await queue.finishTerminal({
            attemptId: row.attemptId,
            fromStatus: 'RUNNING',
            status:
              result.status === 'WAITING_INPUT' ? 'WAITING_INPUT' : 'FAILED',
            terminalReason: result.errorCode ?? 'HOST_RESOLVED_INPUT_REQUIRED',
            result,
            leaseToken: input.leaseToken,
            leaseGeneration: input.leaseGeneration,
            now,
          }))
        )
          throw failure('ACTION_ATTEMPT_TERMINALIZATION_LOST');
        return {
          row: await this.scopedRow(executor, queue, input, input.attemptRef),
          task,
          result,
          recovery: false,
        };
      }
      // Serialize the work-version check against every Matter working append.
      await executor.database
        .select({ id: engineeringMatter.matterId })
        .from(engineeringMatter)
        .where(
          and(
            eq(engineeringMatter.tenantId, input.tenantId),
            eq(engineeringMatter.matterId, input.matterId),
          ),
        )
        .limit(1)
        .for('update');
      const current = await executor.loadCurrent(input);
      const targetWorkRef = finishWorkRef(result);
      const savedByThisAttempt =
        targetWorkRef !== null &&
        current?.matterWorkRevisionId === targetWorkRef &&
        current.source?.actionAttemptId === row.attemptId &&
        current.workingRevision > row.baseRevision!;
      if (
        targetWorkRef &&
        (!savedByThisAttempt ||
          !current?.state.problemWork ||
          (current.state.problemWork.roundCompletion === 'IN_PROGRESS' &&
            !(task.modelInput as ReturnType<typeof buildMatterJobAidTask>).correction))
      )
        throw failure('JOBAID_FINISH_EXACT_COMPLETED_WORK_REQUIRED');
      if (
        (current?.workingRevision ?? 0) !== row.baseRevision &&
        !savedByThisAttempt
      ) {
        if (
          !(await queue.finishTerminal({
            attemptId: row.attemptId,
            fromStatus: 'RUNNING',
            status: 'CONFLICT',
            terminalReason: 'MATTER_WORKING_REVISION_CHANGED_BEFORE_COMMIT',
            result,
            leaseToken: input.leaseToken,
            leaseGeneration: input.leaseGeneration,
            now,
          }))
        )
          throw failure('ACTION_ATTEMPT_TERMINALIZATION_LOST');
        return { error: 'MATTER_WORKING_REVISION_CHANGED_BEFORE_COMMIT' };
      }
      if (
        !(await queue.markCommitting({
          attemptId: row.attemptId,
          leaseToken: input.leaseToken,
          leaseGeneration: input.leaseGeneration,
          result,
          now,
          recoveryLeaseMs: ACTION_ATTEMPT_COMMIT_RECOVERY_MS,
        }))
      )
        throw failure('ACTION_ATTEMPT_COMMIT_CUTOFF_LOST');
      row = await this.scopedRow(executor, queue, input, input.attemptRef);
      return { row, task, result: checkedResult(row), recovery: false };
    });
    if ('error' in outcome) throw failure(outcome.error);
    return outcome;
  }

  /** Finish only after the exact candidate work is durably present and authorized. */
  finish(
    input: MatterAttemptScope & ActionAttemptFence & { principalId: string },
  ) {
    return this.authorized(input, async (executor, queue) => {
      let row = await this.scopedRow(executor, queue, input, input.attemptRef);
      if (!['COMMITTING', 'SUCCEEDED'].includes(row.status))
        throw failure('ACTION_ATTEMPT_NOT_COMMITTING');
      if (row.status === 'COMMITTING') assertLease(row, input);
      const result = checkedResult(row);
      if (result.status !== 'SUCCEEDED')
        throw failure('ACTION_ATTEMPT_RESULT_NOT_CANDIDATE');
      const targetWorkRef = finishWorkRef(result);
      const [stored] = await executor.database
        .select()
        .from(engineeringMatterWorkRevision)
        .where(
          and(
            eq(engineeringMatterWorkRevision.tenantId, input.tenantId),
            eq(engineeringMatterWorkRevision.matterId, input.matterId),
            eq(engineeringMatterWorkRevision.actionAttemptId, row.attemptId),
            ...(targetWorkRef
              ? [
                  eq(
                    engineeringMatterWorkRevision.matterWorkRevisionId,
                    targetWorkRef,
                  ),
                ]
              : []),
          ),
        )
        .limit(1);
      if (!stored) throw failure('MATTER_ATTEMPT_WORK_NOT_SAVED');
      if (
        stored.reviewTurnId !== null ||
        stored.createdByUserId !== input.actorUserId ||
        stored.basedOnMatterRevisionId !== row.matterRevisionId ||
        (targetWorkRef
          ? stored.workingRevision <= row.baseRevision!
          : stored.workingRevision !== row.baseRevision! + 1 ||
            stored.requestId !== row.triggerRequestId)
      )
        throw failure('MATTER_ATTEMPT_SAVED_WORK_MISMATCH');
      const work = await this.working.readByRef(
        {
          tenantId: input.tenantId,
          matterId: input.matterId,
          workRef: stored.matterWorkRevisionId,
        },
        executor.database,
      );
      if (!work) throw failure('MATTER_ATTEMPT_WORK_NOT_SAVED');
      const recovered = row.status === 'SUCCEEDED';
      if (!recovered) {
        if (
          !(await queue.finishTerminal({
            attemptId: row.attemptId,
            fromStatus: 'COMMITTING',
            status: 'SUCCEEDED',
            terminalReason: 'MATTER_WORK_CANDIDATE_PERSISTED',
            result,
            projectionApplied: false,
            leaseToken: input.leaseToken,
            leaseGeneration: input.leaseGeneration,
            now: new Date(),
          }))
        )
          throw failure('ACTION_ATTEMPT_TERMINALIZATION_LOST');
        row = await this.scopedRow(executor, queue, input, input.attemptRef);
      }
      return { row, work, recovered };
    });
  }

  private async runningClaim(
    executor: EngineeringMatterWorkingTransactionExecutor,
    row: MatterActionAttemptRow,
  ) {
    if (
      row.status !== 'RUNNING' ||
      !row.leaseToken ||
      !row.leaseExpiresAt ||
      row.executorSessionKey !== `g2-action-attempt:${row.operationRef}`
    )
      throw failure('ACTION_ATTEMPT_CLAIM_READBACK_INVALID');
    return {
      attemptRef: row.operationRef!,
      status: 'RUNNING' as const,
      leaseToken: row.leaseToken,
      leaseGeneration: row.leaseGeneration,
      leaseExpiresAt: row.leaseExpiresAt.toISOString(),
      task: checkedTask(row),
      savedWork: await this.working.findBySource(
        {
          tenantId: row.tenantId,
          matterId: row.matterId,
          source: {
            kind: 'ENGINEERING_MATTER',
            actionAttemptId: row.attemptId,
            reviewTurnId: null,
          },
        },
        executor.database,
      ),
    };
  }

  private async scopedRow(
    executor: EngineeringMatterWorkingTransactionExecutor,
    queue: ActionAttemptRepository,
    scope: MatterAttemptScope,
    ref: string,
  ): Promise<MatterActionAttemptRow> {
    const row = await queue.readMatterByOperationRef(ref);
    if (
      !row ||
      row.tenantId !== scope.tenantId ||
      row.actorUserId !== scope.actorUserId ||
      row.matterId !== scope.matterId ||
      row.requestOrigin !== ACTION_ATTEMPT_REQUEST_ORIGIN
    )
      throw failure('ACTION_ATTEMPT_NOT_FOUND', 404);
    const task = checkedTask(row);
    await this.working.authorizeAttemptWorkingBasis(
      {
        ...scope,
        basedOnMatterRevisionId: task.subject.matterRevisionId,
        baseRevision: task.baseRevision,
        basis: task.workingBasis,
      },
      executor.database,
    );
    await this.authorizeReferenceEvidence(executor, scope,
      (task.modelInput as ReturnType<typeof buildMatterJobAidTask>).sourceCatalog ?? []);
    return row;
  }

  private async authorizedReference(executor: EngineeringMatterWorkingTransactionExecutor,
    scope: MatterAttemptScope, reference: Pick<MatterWorkReferenceRequest, 'matterId' | 'workRef' | 'issueKey'>) {
    if (!scope.authorizeReferenceMatter) throw failure('MATTER_REFERENCE_SERVICE_SCOPE_UNAVAILABLE', 403);
    await scope.authorizeReferenceMatter(reference.matterId);
    const input = { tenantId: scope.tenantId, actorUserId: scope.actorUserId, matterId: reference.matterId };
    await executor.authorizeRuntimeInputs(input);
    const revision = await this.working.readByRef({ ...input, workRef: reference.workRef }, executor.database);
    if (!revision || !revision.state.problemWork?.issues.some(issue => issue.issueKey === reference.issueKey))
      throw failure('MATTER_REFERENCE_WORK_NOT_FOUND', 404);
    await executor.authorizeRuntimeInputs({ ...input, basedOnMatterRevisionId: revision.basedOnMatterRevisionId });
    return revision;
  }

  private async authorizeReferenceEvidence(executor: EngineeringMatterWorkingTransactionExecutor,
    scope: MatterAttemptScope, evidence: AssessmentEvidence[]) {
    const checked = new Set<string>();
    const pending = [...evidence];
    for (const item of pending) {
      if (item.kind !== 'PRIOR_RESULT' || !item.sourceWork) continue;
      const ref = item.sourceWork;
      const key = canonicalJson(ref);
      if (checked.has(key)) continue;
      checked.add(key);
      const revision = await this.authorizedReference(executor, scope,
        { matterId: ref.subjectId, workRef: ref.workRef, issueKey: ref.issueKey });
      if (revision.workingRevision !== item.resultRevision || ref.workRef !== item.resultRef)
        throw failure('MATTER_REFERENCE_WORK_BINDING_CHANGED');
      pending.push(...(revision.state.problemWork?.evidence ?? []).filter(source => source.kind === 'PRIOR_RESULT' && source.sourceWork));
    }
  }

  private authorized<T>(
    scope: MatterAttemptScope,
    operation: (
      executor: EngineeringMatterWorkingTransactionExecutor,
      queue: ActionAttemptRepository,
    ) => Promise<T>,
    nativeActor?: CanonicalHostActor,
  ): Promise<T> {
    const run = async (executor: EngineeringMatterWorkingTransactionExecutor) => {
        await executor.authorizeRuntimeInputs(scope);
        return operation(
          executor,
          new ActionAttemptRepository(executor.database),
        );
    };
    if (nativeActor) {
      const identity = nativeActor.objectAccessActor;
      if (!identity || !isHostedCanonicalFinalUserActor(identity) || nativeActor.appId !== 'app_17bzc551rsg' ||
          identity.tenantId !== scope.tenantId || nativeActor.tenantId !== scope.tenantId ||
          identity.canonicalSubject.id !== scope.actorUserId || nativeActor.userId !== scope.actorUserId)
        throw failure('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', 403);
      return this.working.withTransaction(run);
    }
    return this.working.withActorTransaction(scope.actorUserId, run);
  }
}

function checkedTask(row: MatterActionAttemptRow): OpenClawMatterTaskEnvelope {
  const task = parseMatterTaskEnvelope(row.taskEnvelopeJson ?? '');
  if (
    task.actionAttemptId !== row.attemptId ||
    task.operationRef !== row.operationRef ||
    task.taskType !== row.actionType ||
    task.tenantId !== row.tenantId ||
    task.subject.matterId !== row.matterId ||
    task.subject.matterRevisionId !== row.matterRevisionId ||
    task.inputRevision !== row.inputRevision ||
    task.baseRevision !== row.baseRevision ||
    task.inputHash !== row.taskInputHash ||
    task.idempotencyKey !== row.idempotencyKey ||
    canonicalJson(task.executionModel ?? null) !==
      (row.executionModelJson ?? 'null')
  )
    throw failure('TASK_ENVELOPE_ROW_BINDING_MISMATCH');
  return task;
}

function finishWorkRef(result: OpenClawMatterResultEnvelope): string | null {
  if (result.status !== 'SUCCEEDED' || !result.modelOutput) return null;
  const output: unknown = JSON.parse(result.modelOutput);
  if (
    typeof output !== 'object' ||
    output === null ||
    !('workRevisionRef' in output)
  )
    return null;
  if (
    typeof output.workRevisionRef !== 'string' ||
    !output.workRevisionRef.trim()
  )
    throw failure('JOBAID_FINAL_OUTPUT_INVALID');
  return output.workRevisionRef;
}

function checkedResult(
  row: MatterActionAttemptRow,
): OpenClawMatterResultEnvelope {
  if (!row.resultEnvelopeJson) throw failure('RESULT_ENVELOPE_MISSING');
  const result = parseMatterResultEnvelope({
    task: checkedTask(row),
    value: JSON.parse(row.resultEnvelopeJson),
  });
  if (result.contentHash !== row.resultContentHash)
    throw failure('RESULT_ENVELOPE_ROW_HASH_MISMATCH');
  if (
    row.cancelRequestedAt &&
    (!row.commitStartedAt || row.cancelRequestedAt <= row.commitStartedAt)
  )
    throw failure('ACTION_ATTEMPT_CANCELLED_BEFORE_COMMIT');
  return result;
}

function recoveryClaim(row: MatterActionAttemptRow) {
  if (
    !row.leaseToken ||
    !row.leaseExpiresAt ||
    row.executorSessionKey !== `g2-action-attempt:${row.operationRef}`
  )
    throw failure('ACTION_ATTEMPT_COMMIT_RECOVERY_READBACK_INVALID');
  return {
    attemptRef: row.operationRef!,
    status: 'COMMITTING' as const,
    leaseToken: row.leaseToken,
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    task: checkedTask(row),
    recoveryResult: checkedResult(row),
  };
}

function assertLease(
  row: MatterActionAttemptRow,
  input: ActionAttemptFence & { principalId: string },
): void {
  if (
    row.leaseOwner !== input.principalId ||
    row.leaseToken !== input.leaseToken ||
    row.leaseGeneration !== input.leaseGeneration
  )
    throw failure('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
}

function failure(
  code: string,
  statusCode = 409,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}

function assertRunningSourceLease(row: MatterActionAttemptRow, input: ActionAttemptFence & { principalId: string }): void {
  assertLease(row, input);
  const now = new Date();
  if (row.status !== 'RUNNING' || !row.leaseExpiresAt || row.leaseExpiresAt <= now ||
    !row.deadlineAt || row.deadlineAt <= now || row.cancelRequestedAt)
    throw failure('MATTER_SOURCE_READ_FENCE_REJECTED');
}

function correctionProposalFromReceipts(started: Record<string, unknown>, completed: Record<string, unknown>) {
      if ((started.request as { purpose?: string }).purpose === 'ENGINEERING_OVERVIEW_CORRECTION') {
        const request = started.request as { expectedWorkRevision: number };
        const context = started.context as ReturnType<typeof buildEngineeringOverviewCorrectionContext>;
        const result = completed.result as Awaited<ReturnType<EngineeringIssueCorrectionPluginService['generateOverview']>>;
        return { expectedWorkRevision: request.expectedWorkRevision, workJson: canonicalJson({
          schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA, issues: [], overview: result.overview,
          roundCompletion: context.roundCompletion, completionReason: result.completionReason,
          changeSummary: result.changeSummary,
        }) };
      }
      const request = started.request as { expectedWorkRevision: number; issueKey: string; correctionReason: string };
      const context = started.context as ReturnType<typeof buildEngineeringIssueCorrectionContext>;
      const result = completed.result as Awaited<ReturnType<EngineeringIssueCorrectionPluginService['generate']>>;
      const structured = structuredClone(context.structuredContext);
      // Replace only the explicitly generated collections. Other judgments remain intact;
      // a local correction cannot certify the overall work as current.
      structured.requirementHandling = structuredClone(result.requirementHandling);
      structured.openQuestions = structuredClone(result.openQuestions);
      const proposal = { schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
        issues: [{ issueKey: request.issueKey, question: context.question, body: result.body,
          ...structured, riskScenarios: structured.riskScenarios.map(({ gradeMeaning: _meaning, ...risk }) => risk) }],
        roundCompletion: 'IN_PROGRESS',
        completionReason: '指定问题正文、要求处理及未决问题已更正；其他关联判断与总体认识仍需完成一致性核对。',
        changeSummary: summarizeEngineeringIssueCorrection(context, result),
      };
      return { expectedWorkRevision: request.expectedWorkRevision, workJson: canonicalJson(proposal) };
}

function correctionReceiptUnchanged(started: Record<string, unknown>, completed: Record<string, unknown>): boolean {
  if ((started.request as { purpose?: string }).purpose === 'ENGINEERING_OVERVIEW_CORRECTION') {
    const context = started.context as ReturnType<typeof buildEngineeringOverviewCorrectionContext>;
    const generated = completed.result as Awaited<ReturnType<EngineeringIssueCorrectionPluginService['generateOverview']>>;
    return context.overview === generated.overview && context.completionReason === generated.completionReason;
  }
  const context = started.context as ReturnType<typeof buildEngineeringIssueCorrectionContext>;
  const generated = completed.result as Awaited<ReturnType<EngineeringIssueCorrectionPluginService['generate']>>;
  return context.body === generated.body &&
    canonicalJson(context.structuredContext.requirementHandling) === canonicalJson(generated.requirementHandling) &&
    canonicalJson(context.structuredContext.openQuestions) === canonicalJson(generated.openQuestions);
}
