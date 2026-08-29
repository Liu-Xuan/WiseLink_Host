import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { actionAttempt } from '../../database/schema';
import {
  canonicalJson,
  parseResultEnvelope,
  parseStoredResultEnvelope,
  parseTaskEnvelope,
  sealTaskEnvelope,
} from './action-attempt-envelope';
import type {
  ActionAttemptStatus,
  OpenClawLeaseClaim,
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from './action-attempt-envelope.types';
import { ActionAttemptRepository } from './action-attempt.repository';
import {
  ACTION_ATTEMPT_COMMIT_RECOVERY_MS,
  ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
  ACTION_ATTEMPT_LEASE_MS,
  ACTION_ATTEMPT_MAX_PARALLEL,
  ACTION_ATTEMPT_REQUEST_ORIGIN,
  type ActionAttemptFence,
  type ActionAttemptRow,
  type ActionAttemptTerminalProjection,
  type NewActionAttemptIdentity,
  type PreparedActionAttemptCommit,
  type ReserveActionAttemptInput,
  type ReserveActionAttemptResult,
  type ReserveAndClaimInput,
  type ReserveAndClaimResult,
} from './action-attempt.types';

const DEFAULT_PRIORITY = 100;
const DEFAULT_MAX_ATTEMPTS = 3;

@Injectable()
export class ActionAttemptLifecycleService {
  constructor(private readonly repository: ActionAttemptRepository) {}

  async reserve(
    input: ReserveActionAttemptInput,
  ): Promise<ReserveActionAttemptResult> {
    return this.reserveAt(input, new Date());
  }

  private async reserveAt(
    input: ReserveActionAttemptInput,
    now: Date,
  ): Promise<ReserveActionAttemptResult> {
    assertReservationInput(input);
    const binding = await this.repository.readWorkItemBinding({
      workItemId: input.workItemId,
      tenantId: input.tenantId,
    });
    if (!binding) throw actionAttemptNotFound();
    if (
      binding.documentVersionId !== input.documentVersionId ||
      binding.revision !== input.inputRevision ||
      binding.revision !== input.baseRevision
    ) {
      throw revisionConflict('ACTION_ATTEMPT_RESERVATION_BINDING_CHANGED');
    }

    const existing = await this.repository.readByIdempotency({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      assertReplay(existing, input);
      return {
        row: existing,
        task: validatedTask(existing),
        created: false,
      };
    }

    const attemptNo = await this.repository.nextAttemptNo({
      workItemId: input.workItemId,
      actionType: input.taskType,
    });
    const identity: NewActionAttemptIdentity = {
      attemptId: `ATT-${randomUUID()}`,
      operationRef: `AQ-${randomUUID().replaceAll('-', '')}`,
      triggerRequestId: `REQ-${randomUUID()}`,
      attemptNo,
      createdAt: now,
    };
    const deadlineAt =
      input.deadlineAt ??
      new Date(now.getTime() + ACTION_ATTEMPT_DEFAULT_DEADLINE_MS);
    const priority = input.priority ?? DEFAULT_PRIORITY;
    const modelInput = await input.buildModelInput(identity);
    const task = parseTaskEnvelope(
      canonicalJson(
        sealTaskEnvelope({
          schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
          actionAttemptId: identity.attemptId,
          operationRef: identity.operationRef,
          taskType: input.taskType,
          priority,
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          inputRevision: input.inputRevision,
          baseRevision: input.baseRevision,
          documentVersionId: input.documentVersionId,
          sourceRefs: [...(input.sourceRefs ?? [])],
          allowedConnectors: [...(input.allowedConnectors ?? [])],
          hostResolvedMissingInputs: [
            ...(input.hostResolvedMissingInputs ?? []),
          ],
          modelInput: structuredClone(modelInput),
          deadline: deadlineAt.toISOString(),
          idempotencyKey: input.idempotencyKey,
        }),
      ),
    );
    const reservation = await this.repository.reserve({
      attemptId: identity.attemptId,
      operationRef: identity.operationRef,
      workItemId: input.workItemId,
      actionType: input.taskType,
      attemptNo,
      triggerRequestId: identity.triggerRequestId,
      requestOrigin: ACTION_ATTEMPT_REQUEST_ORIGIN,
      status: 'QUEUED',
      actorUserId: input.actorUserId,
      tenantId: input.tenantId,
      priority,
      inputRevision: input.inputRevision,
      baseRevision: input.baseRevision,
      documentVersionId: input.documentVersionId,
      taskEnvelopeJson: canonicalJson(task),
      taskInputHash: task.inputHash,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: now,
      deadlineAt,
      createdAt: now,
      updatedAt: now,
    } satisfies typeof actionAttempt.$inferInsert);
    assertReplay(reservation.row, input);
    return {
      row: reservation.row,
      task: validatedTask(reservation.row),
      created: reservation.created,
    };
  }

  async reserveAndClaim(
    input: ReserveAndClaimInput,
  ): Promise<ReserveAndClaimResult> {
    if (!input.leaseOwner.trim()) {
      throw new Error('ACTION_ATTEMPT_RESERVATION_INPUT_INVALID');
    }
    const now = new Date();
    const reservation = await this.reserveAt(input, now);
    const claimed = await this.claimExisting(reservation.row, input, now);
    return {
      ...claimed,
      created: reservation.created,
      triggerRequestId: reservation.row.triggerRequestId,
    };
  }

  async readExactIdempotency(input: {
    tenantId: string;
    workItemId: string;
    taskType: OpenClawTaskEnvelope['taskType'];
    baseRevision: number;
    documentVersionId: string;
    idempotencyKey: string;
  }): Promise<ActionAttemptRow | null> {
    if (
      !input.tenantId.trim() ||
      !input.workItemId.trim() ||
      !input.documentVersionId.trim() ||
      !input.idempotencyKey.trim() ||
      input.idempotencyKey.trim() !== input.idempotencyKey ||
      input.idempotencyKey.length > 255 ||
      !Number.isSafeInteger(input.baseRevision) ||
      input.baseRevision < 0
    ) {
      throw new Error('ACTION_ATTEMPT_READ_INPUT_INVALID');
    }
    const row = await this.repository.readLatestByExactIdempotency({
      tenantId: input.tenantId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!row) return null;
    const task = validatedTask(row);
    if (
      row.workItemId !== input.workItemId ||
      row.actionType !== input.taskType ||
      row.baseRevision !== input.baseRevision ||
      row.documentVersionId !== input.documentVersionId ||
      task.idempotencyKey !== input.idempotencyKey
    ) {
      throw conflict('ACTION_ATTEMPT_IDEMPOTENCY_BINDING_INVALID');
    }
    return row;
  }

  async heartbeat(
    input: ActionAttemptFence & {
      tenantId: string;
      workItemId: string;
      principalId: string;
    },
  ): Promise<{ leaseExpiresAt: string }> {
    const row = await this.requiredScoped(input.attemptRef, input);
    if (row.leaseOwner !== input.principalId) {
      throw leaseConflict('ACTION_ATTEMPT_LEASE_OWNER_MISMATCH');
    }
    const now = new Date();
    assertFence(row, input);
    if (row.deadlineAt && row.deadlineAt <= now) {
      const timedOut = await this.repository.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'TIMED_OUT',
        terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        now,
      });
      if (!timedOut) {
        throw leaseConflict('ACTION_ATTEMPT_TIMEOUT_FENCE_REJECTED');
      }
      throw conflict('ACTION_ATTEMPT_TIMED_OUT');
    }
    const updated = await this.repository.heartbeat({
      attemptId: row.attemptId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      now,
      leaseMs: ACTION_ATTEMPT_LEASE_MS,
    });
    if (!updated)
      throw leaseConflict('ACTION_ATTEMPT_HEARTBEAT_FENCE_REJECTED');
    return {
      leaseExpiresAt: new Date(
        now.getTime() + ACTION_ATTEMPT_LEASE_MS,
      ).toISOString(),
    };
  }

  async prepareCommit(
    input: ActionAttemptFence & {
      tenantId: string;
      workItemId: string;
      principalId: string;
      result: unknown;
      failClosedWithoutRejectionMutation?: boolean;
    },
  ): Promise<PreparedActionAttemptCommit> {
    let row = await this.requiredScoped(input.attemptRef, input);
    const task = validatedTask(row);
    const result = parseResultEnvelope({ value: input.result, task });

    if (row.status === 'COMMITTING') {
      if (row.leaseOwner !== input.principalId) {
        throw leaseConflict('ACTION_ATTEMPT_LEASE_OWNER_MISMATCH');
      }
      assertFence(row, input);
      assertStoredResultMatches(row, task, result);
      assertCommittingCancelBoundary(row);
      return { row, task, result, recovery: true };
    }
    if (isTerminal(row.status)) {
      if (!row.resultEnvelopeJson) {
        throw conflict(`ACTION_ATTEMPT_ALREADY_${row.status}`);
      }
      assertStoredResultMatches(row, task, result);
      return { row, task, result, recovery: true };
    }
    if (row.status !== 'RUNNING') {
      throw leaseConflict('ACTION_ATTEMPT_NOT_RUNNING');
    }
    if (row.leaseOwner !== input.principalId) {
      throw leaseConflict('ACTION_ATTEMPT_LEASE_OWNER_MISMATCH');
    }
    assertFence(row, input);
    const now = new Date();
    if (row.deadlineAt && row.deadlineAt <= now) {
      if (input.failClosedWithoutRejectionMutation) {
        throw conflict('ACTION_ATTEMPT_TIMED_OUT');
      }
      const timedOut = await this.repository.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'TIMED_OUT',
        terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        now,
      });
      if (!timedOut) {
        throw leaseConflict('ACTION_ATTEMPT_TIMEOUT_FENCE_REJECTED');
      }
      throw conflict('ACTION_ATTEMPT_TIMED_OUT');
    }
    if (!row.leaseExpiresAt || row.leaseExpiresAt <= now) {
      if (!input.failClosedWithoutRejectionMutation) {
        await this.repository.recoverExpiredRunning({
          attemptId: row.attemptId,
          now,
        });
      }
      throw leaseConflict('ACTION_ATTEMPT_LEASE_EXPIRED');
    }
    if (row.cancelRequestedAt) {
      if (input.failClosedWithoutRejectionMutation) {
        throw conflict('ACTION_ATTEMPT_CANCELLED');
      }
      await this.repository.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'CANCELLED',
        terminalReason: 'CANCELLED_BEFORE_COMMIT',
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        result,
        now,
      });
      throw conflict('ACTION_ATTEMPT_CANCELLED');
    }

    if (result.status !== 'SUCCEEDED') {
      const status =
        result.status === 'WAITING_INPUT' ? 'WAITING_INPUT' : 'FAILED';
      await this.repository.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status,
        terminalReason:
          status === 'WAITING_INPUT'
            ? 'HOST_RESOLVED_INPUT_REQUIRED'
            : (result.errorCode ?? 'OPENCLAW_EXECUTOR_FAILED'),
        leaseToken: input.leaseToken,
        leaseGeneration: input.leaseGeneration,
        result,
        now,
      });
      row = requiredRow(await this.repository.readByAttemptId(row.attemptId));
      return { row, task, result, recovery: false };
    }

    const binding = await this.repository.readWorkItemBinding({
      workItemId: row.workItemId,
      tenantId: row.tenantId,
    });
    if (!binding) throw actionAttemptNotFound();
    if (binding.documentVersionId !== task.documentVersionId) {
      if (input.failClosedWithoutRejectionMutation) {
        throw conflict('ACTION_ATTEMPT_DOCUMENT_VERSION_CHANGED');
      }
      await this.terminalizeRevisionDrift(row, input, result, 'OBSOLETE', now);
      throw conflict('ACTION_ATTEMPT_DOCUMENT_VERSION_CHANGED');
    }
    if (binding.revision < task.baseRevision) {
      if (input.failClosedWithoutRejectionMutation) {
        throw conflict('WORK_ITEM_REVISION_REGRESSED');
      }
      await this.terminalizeRevisionDrift(row, input, result, 'FAILED', now);
      throw conflict('WORK_ITEM_REVISION_REGRESSED');
    }
    if (binding.revision > task.baseRevision) {
      const status =
        binding.revision === task.baseRevision + 1 ? 'CONFLICT' : 'OBSOLETE';
      if (input.failClosedWithoutRejectionMutation) {
        throw conflict(
          status === 'CONFLICT'
            ? 'WORK_ITEM_REVISION_CONFLICT'
            : 'WORK_ITEM_RESULT_OBSOLETE',
        );
      }
      await this.terminalizeRevisionDrift(row, input, result, status, now);
      throw conflict(
        status === 'CONFLICT'
          ? 'WORK_ITEM_REVISION_CONFLICT'
          : 'WORK_ITEM_RESULT_OBSOLETE',
      );
    }
    const committing = await this.repository.markCommitting({
      attemptId: row.attemptId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      result,
      now,
      recoveryLeaseMs: ACTION_ATTEMPT_COMMIT_RECOVERY_MS,
    });
    if (!committing) {
      throw leaseConflict('ACTION_ATTEMPT_COMMIT_CUTOFF_LOST');
    }
    return { row: committing, task, result, recovery: false };
  }

  async finishProjectionSuccess(
    prepared: PreparedActionAttemptCommit,
  ): Promise<ActionAttemptTerminalProjection> {
    if (prepared.row.status === 'SUCCEEDED')
      return terminalProjection(prepared.row);
    if (prepared.row.status !== 'COMMITTING') {
      throw conflict('ACTION_ATTEMPT_NOT_COMMITTING');
    }
    const leaseToken = requiredLeaseToken(prepared.row);
    const updated = await this.repository.finishTerminal({
      attemptId: prepared.row.attemptId,
      fromStatus: 'COMMITTING',
      status: 'SUCCEEDED',
      terminalReason: prepared.recovery
        ? 'COMMIT_RECONCILED_FROM_PROJECTION'
        : 'PROJECTION_CAS_APPLIED',
      leaseToken,
      leaseGeneration: prepared.row.leaseGeneration,
      result: prepared.result,
      projectionApplied: true,
      now: new Date(),
    });
    if (!updated) throw conflict('ACTION_ATTEMPT_TERMINALIZATION_LOST');
    return terminalProjection(
      requiredRow(
        await this.repository.readByAttemptId(prepared.row.attemptId),
      ),
    );
  }

  /**
   * Complete an accepted candidate whose deterministic Host evaluation found
   * missing controlled facts. This reuses the existing COMMITTING cutoff and
   * durable result; it does not create a second queue or let the executor
   * self-declare WAITING_INPUT after returning a candidate.
   */
  async finishProjectionWaitingInput(
    prepared: PreparedActionAttemptCommit,
  ): Promise<ActionAttemptTerminalProjection> {
    if (prepared.row.status === 'WAITING_INPUT') {
      return terminalProjection(prepared.row);
    }
    if (prepared.row.status !== 'COMMITTING') {
      throw conflict('ACTION_ATTEMPT_NOT_COMMITTING');
    }
    if (prepared.result.status !== 'SUCCEEDED') {
      throw conflict('ACTION_ATTEMPT_WAITING_INPUT_RESULT_INVALID');
    }
    const updated = await this.repository.finishTerminal({
      attemptId: prepared.row.attemptId,
      fromStatus: 'COMMITTING',
      status: 'WAITING_INPUT',
      terminalReason: prepared.recovery
        ? 'HOST_MISSING_FACTS_RECONCILED_FROM_PROJECTION'
        : 'HOST_MISSING_CONTROLLED_FACTS',
      leaseToken: requiredLeaseToken(prepared.row),
      leaseGeneration: prepared.row.leaseGeneration,
      result: prepared.result,
      projectionApplied: true,
      now: new Date(),
    });
    if (!updated) throw conflict('ACTION_ATTEMPT_TERMINALIZATION_LOST');
    return terminalProjection(
      requiredRow(
        await this.repository.readByAttemptId(prepared.row.attemptId),
      ),
    );
  }

  async finishCandidatePersistenceSuccess(
    prepared: PreparedActionAttemptCommit,
  ): Promise<ActionAttemptTerminalProjection> {
    if (prepared.row.status === 'SUCCEEDED') {
      return terminalProjection(prepared.row);
    }
    if (prepared.row.status !== 'COMMITTING') {
      throw conflict('ACTION_ATTEMPT_NOT_COMMITTING');
    }
    const updated = await this.repository.finishTerminal({
      attemptId: prepared.row.attemptId,
      fromStatus: 'COMMITTING',
      status: 'SUCCEEDED',
      terminalReason: prepared.recovery
        ? 'REVIEW_TURN_CANDIDATE_RECONCILED'
        : 'REVIEW_TURN_CANDIDATE_PERSISTED',
      leaseToken: requiredLeaseToken(prepared.row),
      leaseGeneration: prepared.row.leaseGeneration,
      result: prepared.result,
      projectionApplied: false,
      now: new Date(),
    });
    if (!updated) throw conflict('ACTION_ATTEMPT_TERMINALIZATION_LOST');
    return terminalProjection(
      requiredRow(
        await this.repository.readByAttemptId(prepared.row.attemptId),
      ),
    );
  }

  async finishProjectionConflict(input: {
    prepared: PreparedActionAttemptCommit;
    currentRevision: number;
  }): Promise<ActionAttemptTerminalProjection> {
    const { prepared } = input;
    if (prepared.row.status !== 'COMMITTING') {
      return terminalProjection(prepared.row);
    }
    if (input.currentRevision < prepared.task.baseRevision) {
      return this.finishPreparedFailure(
        prepared,
        'FAILED',
        'WORK_ITEM_REVISION_REGRESSED',
      );
    }
    const status =
      input.currentRevision === prepared.task.baseRevision + 1
        ? 'CONFLICT'
        : 'OBSOLETE';
    return this.finishPreparedFailure(
      prepared,
      status,
      status === 'CONFLICT'
        ? 'WORK_ITEM_CAS_CONFLICT_AFTER_COMMIT_START'
        : 'WORK_ITEM_RESULT_OBSOLETE_AFTER_COMMIT_START',
    );
  }

  async finishResultGateFailure(
    prepared: PreparedActionAttemptCommit,
    cause: unknown,
  ): Promise<ActionAttemptTerminalProjection> {
    if (prepared.row.status !== 'COMMITTING') {
      return terminalProjection(prepared.row);
    }
    const errorMessage = boundedFailureMessage(cause);
    const updated = await this.repository.finishResultGateFailure({
      attemptId: prepared.row.attemptId,
      leaseToken: requiredLeaseToken(prepared.row),
      leaseGeneration: prepared.row.leaseGeneration,
      result: prepared.result,
      errorCode: resultGateErrorCode(errorMessage),
      errorMessage,
      now: new Date(),
    });
    if (!updated) throw conflict('ACTION_ATTEMPT_TERMINALIZATION_LOST');
    return terminalProjection(
      requiredRow(
        await this.repository.readByAttemptId(prepared.row.attemptId),
      ),
    );
  }

  async requestCancel(input: {
    attemptRef: string;
    tenantId: string;
    workItemId: string;
    reason: string;
  }): Promise<ActionAttemptTerminalProjection> {
    const row = await this.requiredScoped(input.attemptRef, input);
    const result = await this.repository.requestCancel({
      attemptId: row.attemptId,
      reason: input.reason,
      now: new Date(),
    });
    if (result === 'TOO_LATE') throw conflict('ACTION_ATTEMPT_CANCEL_TOO_LATE');
    if (result === 'NOT_ACTIVE') throw conflict('ACTION_ATTEMPT_NOT_ACTIVE');
    return terminalProjection(
      requiredRow(await this.repository.readByAttemptId(row.attemptId)),
    );
  }

  async readScoped(input: {
    attemptRef: string;
    tenantId: string;
    workItemId: string;
  }): Promise<ActionAttemptRow> {
    return this.requiredScoped(input.attemptRef, input);
  }

  projectTerminal(row: ActionAttemptRow): ActionAttemptTerminalProjection {
    if (!isTerminal(row.status)) {
      throw conflict('ACTION_ATTEMPT_NOT_TERMINAL');
    }
    return terminalProjection(row);
  }

  private async claimExisting(
    initial: ActionAttemptRow,
    input: ReserveAndClaimInput,
    now: Date,
  ): Promise<OpenClawLeaseClaim> {
    let row = initial;
    assertReplay(row, input);
    if (
      row.deadlineAt &&
      row.deadlineAt <= now &&
      ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED'].includes(row.status)
    ) {
      const timedOut = await this.repository.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: row.status,
        status: 'TIMED_OUT',
        terminalReason: 'ACTION_ATTEMPT_DEADLINE_EXCEEDED',
        leaseToken:
          row.status === 'RUNNING' ? requiredLeaseToken(row) : undefined,
        leaseGeneration:
          row.status === 'RUNNING' ? row.leaseGeneration : undefined,
        now,
      });
      if (timedOut) throw conflict('ACTION_ATTEMPT_TIMED_OUT');
      row = requiredRow(await this.repository.readByAttemptId(row.attemptId));
    }
    if (
      row.status === 'RUNNING' &&
      row.leaseOwner === input.leaseOwner &&
      row.leaseToken &&
      row.leaseExpiresAt &&
      row.leaseExpiresAt > now
    ) {
      return leaseClaim(row);
    }
    if (row.status === 'RUNNING') {
      await this.repository.recoverExpiredRunning({
        attemptId: row.attemptId,
        now,
      });
      row = requiredRow(await this.repository.readByAttemptId(row.attemptId));
    }
    if (row.status === 'COMMITTING') {
      if (row.leaseOwner !== input.leaseOwner) {
        throw leaseConflict('ACTION_ATTEMPT_LEASE_OWNER_MISMATCH');
      }
      return committingRecoveryClaim(row);
    }
    if (isTerminal(row.status)) {
      throw conflict(`ACTION_ATTEMPT_ALREADY_${row.status}`);
    }
    if (!['QUEUED', 'RETRY_SCHEDULED'].includes(row.status)) {
      throw conflict('ACTION_ATTEMPT_NOT_CLAIMABLE');
    }
    const task = validatedTask(row);
    const binding = await this.repository.readWorkItemBinding({
      workItemId: row.workItemId,
      tenantId: row.tenantId,
    });
    if (!binding) throw actionAttemptNotFound();
    if (binding.revision !== task.baseRevision) {
      const status =
        binding.revision < task.baseRevision
          ? 'FAILED'
          : binding.revision === task.baseRevision + 1
            ? 'CONFLICT'
            : 'OBSOLETE';
      await this.repository.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: row.status,
        status,
        terminalReason:
          status === 'FAILED'
            ? 'WORK_ITEM_REVISION_REGRESSED'
            : status === 'CONFLICT'
              ? 'WORK_ITEM_REVISION_CONFLICT_BEFORE_CLAIM'
              : 'WORK_ITEM_RESULT_OBSOLETE_BEFORE_CLAIM',
        now,
      });
      throw conflict(`ACTION_ATTEMPT_${status}`);
    }
    for (
      let leaseSlot = 0;
      leaseSlot < ACTION_ATTEMPT_MAX_PARALLEL;
      leaseSlot += 1
    ) {
      const claimed = await this.repository.claimExact({
        attemptId: row.attemptId,
        expectedStatus: row.status as 'QUEUED' | 'RETRY_SCHEDULED',
        expectedClaimCount: row.claimCount,
        expectedLeaseGeneration: row.leaseGeneration,
        operationRef: requiredOperationRef(row),
        startedAt: row.startedAt,
        leaseOwner: input.leaseOwner,
        leaseSlot,
        now,
        leaseMs: ACTION_ATTEMPT_LEASE_MS,
      });
      if (claimed) return leaseClaim(claimed);
    }
    const readback = requiredRow(
      await this.repository.readByAttemptId(row.attemptId),
    );
    if (
      readback.status === 'RUNNING' &&
      readback.leaseOwner === input.leaseOwner &&
      readback.leaseToken &&
      readback.leaseExpiresAt &&
      readback.leaseExpiresAt > now
    ) {
      return leaseClaim(readback);
    }
    throw Object.assign(
      new Error('All OpenClaw execution slots are occupied.'),
      {
        code: 'ACTION_ATTEMPT_CONCURRENCY_SLOTS_EXHAUSTED',
        statusCode: 503,
      },
    );
  }

  private async terminalizeRevisionDrift(
    row: ActionAttemptRow,
    fence: ActionAttemptFence,
    result: OpenClawResultEnvelope,
    status: 'FAILED' | 'CONFLICT' | 'OBSOLETE',
    now: Date,
  ): Promise<void> {
    const updated = await this.repository.finishTerminal({
      attemptId: row.attemptId,
      fromStatus: 'RUNNING',
      status,
      terminalReason:
        status === 'FAILED'
          ? 'WORK_ITEM_REVISION_REGRESSED'
          : status === 'CONFLICT'
            ? 'WORK_ITEM_REVISION_CONFLICT'
            : 'WORK_ITEM_RESULT_OBSOLETE',
      leaseToken: fence.leaseToken,
      leaseGeneration: fence.leaseGeneration,
      result,
      now,
    });
    if (!updated) {
      throw leaseConflict('ACTION_ATTEMPT_REVISION_TERMINALIZATION_LOST');
    }
  }

  private async finishPreparedFailure(
    prepared: PreparedActionAttemptCommit,
    status: 'FAILED' | 'CONFLICT' | 'OBSOLETE',
    reason: string,
  ): Promise<ActionAttemptTerminalProjection> {
    const updated = await this.repository.finishTerminal({
      attemptId: prepared.row.attemptId,
      fromStatus: 'COMMITTING',
      status,
      terminalReason: reason,
      leaseToken: requiredLeaseToken(prepared.row),
      leaseGeneration: prepared.row.leaseGeneration,
      result: prepared.result,
      now: new Date(),
    });
    if (!updated) throw conflict('ACTION_ATTEMPT_TERMINALIZATION_LOST');
    return terminalProjection(
      requiredRow(
        await this.repository.readByAttemptId(prepared.row.attemptId),
      ),
    );
  }

  private async requiredScoped(
    attemptRef: string,
    scope: { tenantId: string; workItemId: string },
  ): Promise<ActionAttemptRow> {
    const row = await this.repository.readByOperationRef(attemptRef);
    if (
      !row ||
      row.requestOrigin !== ACTION_ATTEMPT_REQUEST_ORIGIN ||
      row.tenantId !== scope.tenantId ||
      row.workItemId !== scope.workItemId
    ) {
      throw actionAttemptNotFound();
    }
    return row;
  }
}

function assertReservationInput(input: ReserveActionAttemptInput): void {
  for (const value of [
    input.workItemId,
    input.tenantId,
    input.actorUserId,
    input.documentVersionId,
    input.idempotencyKey,
  ]) {
    if (!value.trim())
      throw new Error('ACTION_ATTEMPT_RESERVATION_INPUT_INVALID');
  }
  if (
    input.idempotencyKey.length > 255 ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    !Number.isSafeInteger(input.inputRevision) ||
    input.inputRevision < 0 ||
    !Number.isSafeInteger(input.baseRevision) ||
    input.baseRevision < 0 ||
    input.inputRevision !== input.baseRevision
  ) {
    throw new Error('ACTION_ATTEMPT_RESERVATION_INPUT_INVALID');
  }
  if (
    (input.priority !== undefined &&
      (!Number.isSafeInteger(input.priority) ||
        input.priority < 0 ||
        input.priority > 1000)) ||
    (input.maxAttempts !== undefined &&
      (!Number.isSafeInteger(input.maxAttempts) ||
        input.maxAttempts < 1 ||
        input.maxAttempts > 100)) ||
    (input.deadlineAt !== undefined &&
      (!(input.deadlineAt instanceof Date) ||
        !Number.isFinite(input.deadlineAt.getTime())))
  ) {
    throw new Error('ACTION_ATTEMPT_RESERVATION_INPUT_INVALID');
  }
}

function assertReplay(
  row: ActionAttemptRow,
  input: ReserveActionAttemptInput,
): void {
  const task = validatedTask(row);
  if (
    row.actionType !== input.taskType ||
    row.workItemId !== input.workItemId ||
    row.tenantId !== input.tenantId ||
    row.actorUserId !== input.actorUserId ||
    task.taskType !== input.taskType ||
    task.workItemId !== input.workItemId ||
    task.tenantId !== input.tenantId ||
    task.documentVersionId !== input.documentVersionId ||
    task.inputRevision !== input.inputRevision ||
    task.baseRevision !== input.baseRevision ||
    task.idempotencyKey !== input.idempotencyKey ||
    task.priority !== (input.priority ?? DEFAULT_PRIORITY) ||
    row.maxAttempts !== (input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS) ||
    canonicalJson(task.sourceRefs) !== canonicalJson(input.sourceRefs ?? []) ||
    canonicalJson(task.allowedConnectors) !==
      canonicalJson(input.allowedConnectors ?? []) ||
    canonicalJson(task.hostResolvedMissingInputs) !==
      canonicalJson(input.hostResolvedMissingInputs ?? []) ||
    (input.deadlineAt !== undefined &&
      task.deadline !== input.deadlineAt.toISOString())
  ) {
    throw conflict('ACTION_ATTEMPT_IDEMPOTENCY_PAYLOAD_MISMATCH');
  }
}

function validatedTask(row: ActionAttemptRow): OpenClawTaskEnvelope {
  if (!row.taskEnvelopeJson) throw conflict('TASK_ENVELOPE_MISSING');
  const task = parseTaskEnvelope(row.taskEnvelopeJson);
  if (
    task.actionAttemptId !== row.attemptId ||
    task.operationRef !== row.operationRef ||
    task.taskType !== row.actionType ||
    task.workItemId !== row.workItemId ||
    task.tenantId !== row.tenantId ||
    task.baseRevision !== row.baseRevision ||
    task.inputRevision !== row.inputRevision ||
    task.documentVersionId !== row.documentVersionId ||
    task.inputHash !== row.taskInputHash ||
    task.idempotencyKey !== row.idempotencyKey
  ) {
    throw conflict('TASK_ENVELOPE_ROW_BINDING_MISMATCH');
  }
  return task;
}

function assertStoredResultMatches(
  row: ActionAttemptRow,
  task: OpenClawTaskEnvelope,
  incoming: OpenClawResultEnvelope,
): void {
  if (!row.resultEnvelopeJson) throw conflict('RESULT_ENVELOPE_MISSING');
  const stored = parseStoredResultEnvelope({
    value: row.resultEnvelopeJson,
    task,
  });
  if (
    stored.contentHash !== incoming.contentHash ||
    row.resultContentHash !== incoming.contentHash
  ) {
    throw conflict('RESULT_ENVELOPE_REPLAY_MISMATCH');
  }
}

function assertCommittingCancelBoundary(row: ActionAttemptRow): void {
  if (!row.cancelRequestedAt) return;
  if (!row.commitStartedAt || row.cancelRequestedAt <= row.commitStartedAt) {
    throw conflict('ACTION_ATTEMPT_COMMITTING_CANCEL_INVARIANT_VIOLATION');
  }
  // A cancellation recorded after COMMITTING is beyond the durable cutoff.
}

function assertFence(row: ActionAttemptRow, input: ActionAttemptFence): void {
  if (
    row.leaseToken !== input.leaseToken ||
    row.leaseGeneration !== input.leaseGeneration
  ) {
    throw leaseConflict('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
  }
}

function leaseClaim(row: ActionAttemptRow): OpenClawLeaseClaim {
  const task = validatedTask(row);
  assertExecutorSessionBinding(row, task);
  if (row.status !== 'RUNNING' || !row.leaseExpiresAt) {
    throw leaseConflict('ACTION_ATTEMPT_CLAIM_READBACK_INVALID');
  }
  return {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseToken: requiredLeaseToken(row),
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    task,
  };
}

function committingRecoveryClaim(row: ActionAttemptRow): OpenClawLeaseClaim {
  const task = validatedTask(row);
  assertExecutorSessionBinding(row, task);
  if (
    row.status !== 'COMMITTING' ||
    !row.leaseExpiresAt ||
    !row.resultEnvelopeJson
  ) {
    throw leaseConflict('ACTION_ATTEMPT_COMMIT_RECOVERY_READBACK_INVALID');
  }
  const recoveryResult = parseStoredResultEnvelope({
    value: row.resultEnvelopeJson,
    task,
  });
  if (row.resultContentHash !== recoveryResult.contentHash) {
    throw conflict('RESULT_ENVELOPE_ROW_HASH_MISMATCH');
  }
  assertCommittingCancelBoundary(row);
  return {
    attemptRef: task.operationRef,
    status: 'COMMITTING',
    leaseToken: requiredLeaseToken(row),
    leaseGeneration: row.leaseGeneration,
    leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    task,
    recoveryResult,
  };
}

function assertExecutorSessionBinding(
  row: ActionAttemptRow,
  task: OpenClawTaskEnvelope,
): void {
  if (row.executorSessionKey !== `g2-action-attempt:${task.operationRef}`) {
    throw conflict('ACTION_ATTEMPT_EXECUTOR_SESSION_BINDING_MISMATCH');
  }
}

function requiredLeaseToken(row: ActionAttemptRow): string {
  if (!row.leaseToken)
    throw leaseConflict('ACTION_ATTEMPT_LEASE_TOKEN_MISSING');
  return row.leaseToken;
}

function requiredOperationRef(row: ActionAttemptRow): string {
  if (!row.operationRef) throw conflict('ACTION_ATTEMPT_OPERATION_REF_MISSING');
  return row.operationRef;
}

function boundedFailureMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.trim().slice(0, 4_000) || 'Host Result Gate rejected output.';
}

function resultGateErrorCode(message: string): string {
  return (
    message
      .split(':', 1)[0]
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9._-]+/gu, '_')
      .slice(0, 160) || 'HOST_RESULT_GATE_REJECTED'
  );
}

function requiredRow(row: ActionAttemptRow | null): ActionAttemptRow {
  if (!row) throw actionAttemptNotFound();
  return row;
}

function terminalProjection(
  row: ActionAttemptRow,
): ActionAttemptTerminalProjection {
  return {
    attemptRef: row.operationRef ?? row.attemptId,
    status: row.status as ActionAttemptStatus,
    projectionApplied: row.projectionApplied,
    terminalReason: row.terminalReason,
  };
}

function isTerminal(status: string): boolean {
  return [
    'SUCCEEDED',
    'WAITING_INPUT',
    'FAILED',
    'TIMED_OUT',
    'CANCELLED',
    'CONFLICT',
    'OBSOLETE',
  ].includes(status);
}

function actionAttemptNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Canonical ActionAttempt not found.'), {
    code: 'CANONICAL_ACTION_ATTEMPT_NOT_FOUND',
    statusCode: 404,
  });
}

function revisionConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function leaseConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
