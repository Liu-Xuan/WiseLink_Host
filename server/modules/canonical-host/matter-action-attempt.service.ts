import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { actionAttempt, engineeringMatter } from '../../database/schema';
import {
  ActionAttemptRepository,
  isLeaseSlotConflict,
} from '../action-attempt/action-attempt.repository';
import {
  canonicalJson,
  parseMatterTaskEnvelope,
  sealMatterTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import type {
  EngineeringMatterAttemptTrigger,
  OpenClawMatterTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import {
  ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
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

/** Subject adapter for the existing durable queue, lease slots and cancellation. */
@Injectable()
export class MatterActionAttemptService {
  constructor(
    private readonly working: EngineeringMatterWorkingRepository,
    private readonly models: CanonicalModelSettingsService,
  ) {}

  reserve(input: ReserveMatterAttempt): Promise<{
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
        const row = await scopedRow(queue, input, existing.operationRef ?? '');
        const task = checkedTask(row);
        if (
          task.subject.matterRevisionId !== input.expectedMatterRevisionId ||
          task.inputRevision !== input.expectedMatterRevision ||
          task.baseRevision !== input.expectedWorkingRevision ||
          canonicalJson(task.trigger) !== canonicalJson(input.trigger) ||
          canonicalJson(task.modelInput) !== canonicalJson(input.modelInput) ||
          canonicalJson(task.sourceRefs) !== canonicalJson(input.sourceRefs)
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
            priority: 100,
            inputRevision: input.expectedMatterRevision,
            baseRevision: input.expectedWorkingRevision,
            sourceRefs: structuredClone(input.sourceRefs),
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: structuredClone(input.modelInput),
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
        row: await scopedRow(queue, input, task.operationRef),
        task,
        created: true,
      };
    });
  }

  read(
    input: MatterAttemptScope & { attemptRef: string },
  ): Promise<MatterActionAttemptRow> {
    return this.authorized(input, (_executor, queue) =>
      scopedRow(queue, input, input.attemptRef),
    );
  }

  async claim(
    input: MatterAttemptScope & { attemptRef: string; principalId: string },
  ) {
    if (!input.principalId?.trim())
      throw failure('ACTION_ATTEMPT_LEASE_OWNER_REQUIRED', 400);
    const outcome = await this.authorized(input, async (executor, queue) => {
      let row = await scopedRow(queue, input, input.attemptRef);
      const now = new Date();
      if (
        row.status === 'RUNNING' &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt <= now
      ) {
        await queue.recoverExpiredRunning({ attemptId: row.attemptId, now });
        row = await scopedRow(queue, input, input.attemptRef);
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
        return runningClaim(row);
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
      if ((current?.workingRevision ?? 0) !== row.baseRevision) {
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
          return runningClaim(await scopedRow(queue, input, input.attemptRef));
      }
      return { error: 'ACTION_ATTEMPT_CLAIM_UNAVAILABLE' };
    });
    if ('error' in outcome) throw failure(outcome.error);
    return outcome;
  }

  heartbeat(
    input: MatterAttemptScope & ActionAttemptFence & { principalId: string },
  ) {
    return this.authorized(input, async (_executor, queue) => {
      const row = await scopedRow(queue, input, input.attemptRef);
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
    return this.authorized(input, async (_executor, queue) => {
      const row = await scopedRow(queue, input, input.attemptRef);
      const result = await queue.requestCancel({
        attemptId: row.attemptId,
        reason: input.reason,
        now: new Date(),
      });
      if (result !== 'CANCELLED')
        throw failure(`ACTION_ATTEMPT_CANCEL_${result}`);
      return scopedRow(queue, input, input.attemptRef);
    });
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

async function scopedRow(
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
  checkedTask(row);
  return row;
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

function runningClaim(row: MatterActionAttemptRow) {
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
