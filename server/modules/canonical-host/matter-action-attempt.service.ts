import type { EngineeringMatterWorkingRevisionCommand } from '@shared/matter-working.interface';
import { buildMatterJobAidTask, MATTER_JOBAID_TASK_SCHEMA } from './matter-jobaid-task';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
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

export type ReserveMatterJobAidAttempt = Omit<ReserveMatterAttempt, 'modelInput' | 'sourceRefs'>;

/** Subject adapter for the existing durable queue, lease slots and cancellation. */
@Injectable()
export class MatterActionAttemptService {
  constructor(
    private readonly working: EngineeringMatterWorkingRepository,
    private readonly models: CanonicalModelSettingsService,
  ) {}

  reserve(input: ReserveMatterAttempt) {
    return this.reserveInternal(input);
  }

  /** Host builds the entire JobAid context; callers supply only the request and CAS. */
  reserveJobAid(input: ReserveMatterJobAidAttempt) {
    if ('modelInput' in input || 'sourceRefs' in input)
      throw failure('MATTER_JOBAID_HOST_CONTEXT_REQUIRED', 400);
    return this.reserveInternal(input);
  }

  private reserveInternal(input: ReserveMatterAttempt | ReserveMatterJobAidAttempt): Promise<{
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
          canonicalJson(task.trigger) !== canonicalJson(input.trigger) ||
          ('modelInput' in input
            ? canonicalJson(task.modelInput) !== canonicalJson(input.modelInput) ||
              canonicalJson(task.sourceRefs) !== canonicalJson(input.sourceRefs)
            : task.modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA)
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
      const modelInput = 'modelInput' in input ? input.modelInput : buildMatterJobAidTask({
        matterId: input.matterId, matterRevisionId: input.expectedMatterRevisionId,
        actorUserId: input.actorUserId, title: matter.title,
        inputs: authorizedInputs, trigger: input.trigger, previous: current,
      });
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
            executionModel: await this.models.captureForNewTask(
              input.tenantId,
              now,
            ),
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
        executionModelJson: canonicalJson(task.executionModel),
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
    });
  }

  read(
    input: MatterAttemptScope & { attemptRef: string },
  ): Promise<MatterActionAttemptRow> {
    return this.authorized(input, (executor, queue) =>
      this.scopedRow(executor, queue, input, input.attemptRef),
    );
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
          current.state.problemWork.roundCompletion === 'IN_PROGRESS')
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
    return row;
  }

  private authorized<T>(
    scope: MatterAttemptScope,
    operation: (
      executor: EngineeringMatterWorkingTransactionExecutor,
      queue: ActionAttemptRepository,
    ) => Promise<T>,
  ): Promise<T> {
    return this.working.withActorTransaction(
      scope.actorUserId,
      async (executor) => {
        await executor.authorizeRuntimeInputs(scope);
        return operation(
          executor,
          new ActionAttemptRepository(executor.database),
        );
      },
    );
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
