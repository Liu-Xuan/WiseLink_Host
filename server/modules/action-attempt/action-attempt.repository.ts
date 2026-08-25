import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  DRIZZLE_DATABASE,
  type PostgresJsDatabase,
} from '@lark-apaas/fullstack-nestjs-core';
import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  max,
  or,
  sql,
} from 'drizzle-orm';

import { actionAttempt, workItem } from '../../database/schema';
import { canonicalJson } from './action-attempt-envelope';
import type { OpenClawResultEnvelope } from './action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ActionAttemptWorkItemBinding,
} from './action-attempt.types';

const ACTIVE_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
] as const;
const CLAIMABLE_STATUSES = ['QUEUED', 'RETRY_SCHEDULED'] as const;
const CANCELLABLE_STATUSES = ['QUEUED', 'RUNNING', 'RETRY_SCHEDULED'] as const;

export interface ActionAttemptReservation {
  row: ActionAttemptRow;
  created: boolean;
}

@Injectable()
export class ActionAttemptRepository {
  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  async readWorkItemBinding(input: {
    workItemId: string;
    tenantId: string;
  }): Promise<ActionAttemptWorkItemBinding | null> {
    const [row] = await this.db
      .select({
        workItemId: workItem.workItemId,
        tenantId: workItem.tenantId,
        documentVersionId: workItem.documentVersionId,
        revision: workItem.revision,
        projectionJson: workItem.projectionJson,
      })
      .from(workItem)
      .where(
        and(
          eq(workItem.workItemId, input.workItemId),
          eq(workItem.tenantId, input.tenantId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async nextAttemptNo(input: {
    workItemId: string;
    actionType: string;
  }): Promise<number> {
    const [row] = await this.db
      .select({ maximum: max(actionAttempt.attemptNo) })
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, input.workItemId),
          eq(actionAttempt.actionType, input.actionType),
        ),
      );
    return Number(row?.maximum ?? 0) + 1;
  }

  async readByIdempotency(input: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<ActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.tenantId, input.tenantId),
          eq(actionAttempt.idempotencyKey, input.idempotencyKey),
          inArray(actionAttempt.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(actionAttempt.createdAt)
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async readByOperationRef(
    operationRef: string,
  ): Promise<ActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(eq(actionAttempt.operationRef, operationRef))
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async readByAttemptId(attemptId: string): Promise<ActionAttemptRow | null> {
    const [row] = await this.db
      .select()
      .from(actionAttempt)
      .where(eq(actionAttempt.attemptId, attemptId))
      .limit(1);
    return (row as ActionAttemptRow | undefined) ?? null;
  }

  async reserve(
    attempt: typeof actionAttempt.$inferInsert,
  ): Promise<ActionAttemptReservation> {
    const inserted = await this.db
      .insert(actionAttempt)
      .values(attempt)
      .onConflictDoNothing()
      .returning({ attemptId: actionAttempt.attemptId });
    const storedByIdempotency = await this.readByIdempotency({
      tenantId: String(attempt.tenantId),
      idempotencyKey: String(attempt.idempotencyKey),
    });
    if (storedByIdempotency) {
      return { row: storedByIdempotency, created: inserted.length === 1 };
    }
    const [active] = await this.db
      .select()
      .from(actionAttempt)
      .where(
        and(
          eq(actionAttempt.workItemId, String(attempt.workItemId)),
          eq(actionAttempt.actionType, String(attempt.actionType)),
          inArray(actionAttempt.status, [...ACTIVE_STATUSES]),
        ),
      )
      .limit(1);
    if (active) throw activeAttemptConflict();
    throw new Error('ACTION_ATTEMPT_RESERVATION_READBACK_FAILED');
  }

  async claimExact(input: {
    attemptId: string;
    expectedStatus: 'QUEUED' | 'RETRY_SCHEDULED';
    expectedClaimCount: number;
    expectedLeaseGeneration: number;
    operationRef: string;
    startedAt: Date | null;
    leaseOwner: string;
    leaseSlot: number;
    now: Date;
    leaseMs: number;
  }): Promise<ActionAttemptRow | null> {
    try {
      const [claimed] = await this.db
        .update(actionAttempt)
        .set({
          status: 'RUNNING',
          claimCount: input.expectedClaimCount + 1,
          leaseOwner: input.leaseOwner,
          leaseToken: randomUUID(),
          leaseGeneration: input.expectedLeaseGeneration + 1,
          leaseSlot: input.leaseSlot,
          executorSessionKey: `g2-action-attempt:${input.operationRef}`,
          leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          lastHeartbeatAt: input.now,
          nextAttemptAt: null,
          startedAt: input.startedAt ?? input.now,
          errorCode: null,
          errorMessage: null,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(actionAttempt.attemptId, input.attemptId),
            eq(actionAttempt.status, input.expectedStatus),
            eq(actionAttempt.claimCount, input.expectedClaimCount),
            eq(
              actionAttempt.leaseGeneration,
              input.expectedLeaseGeneration,
            ),
            eq(actionAttempt.operationRef, input.operationRef),
            isNull(actionAttempt.leaseToken),
            or(
              isNull(actionAttempt.nextAttemptAt),
              lte(actionAttempt.nextAttemptAt, input.now),
            ),
            or(
              isNull(actionAttempt.deadlineAt),
              gt(actionAttempt.deadlineAt, input.now),
            ),
            isNull(actionAttempt.cancelRequestedAt),
          ),
        )
        .returning();
      return (claimed as ActionAttemptRow | undefined) ?? null;
    } catch (cause) {
      if (isLeaseSlotConflict(cause)) return null;
      throw cause;
    }
  }

  async heartbeat(input: {
    attemptId: string;
    leaseToken: string;
    leaseGeneration: number;
    now: Date;
    leaseMs: number;
  }): Promise<boolean> {
    const updated = await this.db
      .update(actionAttempt)
      .set({
        lastHeartbeatAt: input.now,
        leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          eq(actionAttempt.status, 'RUNNING'),
          eq(actionAttempt.leaseToken, input.leaseToken),
          eq(actionAttempt.leaseGeneration, input.leaseGeneration),
          gt(actionAttempt.leaseExpiresAt, input.now),
          or(
            isNull(actionAttempt.deadlineAt),
            gt(actionAttempt.deadlineAt, input.now),
          ),
          isNull(actionAttempt.cancelRequestedAt),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    return updated.length === 1;
  }

  async markCommitting(input: {
    attemptId: string;
    leaseToken: string;
    leaseGeneration: number;
    result: OpenClawResultEnvelope;
    now: Date;
    recoveryLeaseMs: number;
  }): Promise<ActionAttemptRow | null> {
    const [updated] = await this.db
      .update(actionAttempt)
      .set({
        status: 'COMMITTING',
        resultEnvelopeJson: canonicalJson(input.result),
        resultContentHash: input.result.contentHash,
        commitStartedAt: input.now,
        leaseExpiresAt: new Date(input.now.getTime() + input.recoveryLeaseMs),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          eq(actionAttempt.status, 'RUNNING'),
          eq(actionAttempt.leaseToken, input.leaseToken),
          eq(actionAttempt.leaseGeneration, input.leaseGeneration),
          gt(actionAttempt.leaseExpiresAt, input.now),
          or(
            isNull(actionAttempt.deadlineAt),
            gt(actionAttempt.deadlineAt, input.now),
          ),
          isNull(actionAttempt.cancelRequestedAt),
        ),
      )
      .returning();
    return (updated as ActionAttemptRow | undefined) ?? null;
  }

  async finishTerminal(input: {
    attemptId: string;
    fromStatus: string;
    status:
      | 'SUCCEEDED'
      | 'WAITING_INPUT'
      | 'FAILED'
      | 'TIMED_OUT'
      | 'CANCELLED'
      | 'CONFLICT'
      | 'OBSOLETE';
    terminalReason: string;
    now: Date;
    leaseToken?: string;
    leaseGeneration?: number;
    result?: OpenClawResultEnvelope;
    projectionApplied?: boolean;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<boolean> {
    const predicates = [
      eq(actionAttempt.attemptId, input.attemptId),
      eq(actionAttempt.status, input.fromStatus),
    ];
    if (input.leaseToken !== undefined) {
      predicates.push(eq(actionAttempt.leaseToken, input.leaseToken));
    }
    if (input.leaseGeneration !== undefined) {
      predicates.push(eq(actionAttempt.leaseGeneration, input.leaseGeneration));
    }
    const updated = await this.db
      .update(actionAttempt)
      .set({
        status: input.status,
        terminalReason: input.terminalReason.slice(0, 160),
        resultEnvelopeJson: input.result
          ? canonicalJson(input.result)
          : undefined,
        resultContentHash: input.result?.contentHash,
        projectionApplied: input.projectionApplied ?? false,
        errorCode: input.errorCode?.slice(0, 160),
        errorMessage: input.errorMessage,
        completedAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseSlot: null,
        updatedAt: input.now,
      })
      .where(and(...predicates))
      .returning({ attemptId: actionAttempt.attemptId });
    return updated.length === 1;
  }

  async recoverExpiredRunning(input: {
    attemptId: string;
    now: Date;
  }): Promise<boolean> {
    const row = await this.readByAttemptId(input.attemptId);
    if (
      !row ||
      row.status !== 'RUNNING' ||
      !row.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt > input.now
    ) {
      return false;
    }
    if (row.cancelRequestedAt) {
      return this.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'CANCELLED',
        terminalReason: 'CANCELLED_BEFORE_COMMIT',
        leaseToken: row.leaseToken,
        leaseGeneration: row.leaseGeneration,
        now: input.now,
      });
    }
    if (row.deadlineAt && row.deadlineAt <= input.now) {
      return this.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'TIMED_OUT',
        terminalReason: 'DEADLINE_EXCEEDED_DURING_LEASE',
        leaseToken: row.leaseToken,
        leaseGeneration: row.leaseGeneration,
        now: input.now,
      });
    }
    if (row.claimCount >= row.maxAttempts) {
      return this.finishTerminal({
        attemptId: row.attemptId,
        fromStatus: 'RUNNING',
        status: 'FAILED',
        terminalReason: 'LEASE_EXPIRED_MAX_ATTEMPTS',
        leaseToken: row.leaseToken,
        leaseGeneration: row.leaseGeneration,
        now: input.now,
      });
    }
    const updated = await this.db
      .update(actionAttempt)
      .set({
        status: 'RETRY_SCHEDULED',
        retryCount: row.retryCount + 1,
        nextAttemptAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        leaseSlot: null,
        errorCode: 'LEASE_EXPIRED_RECOVERED',
        errorMessage:
          'Executor lease expired before the durable commit boundary.',
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, row.attemptId),
          eq(actionAttempt.status, 'RUNNING'),
          eq(actionAttempt.leaseToken, row.leaseToken),
          eq(actionAttempt.leaseGeneration, row.leaseGeneration),
          eq(actionAttempt.retryCount, row.retryCount),
          lte(actionAttempt.leaseExpiresAt, input.now),
          lt(actionAttempt.claimCount, actionAttempt.maxAttempts),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    return updated.length === 1;
  }

  async requestCancel(input: {
    attemptId: string;
    reason: string;
    now: Date;
  }): Promise<'CANCELLED' | 'TOO_LATE' | 'NOT_ACTIVE'> {
    const updated = await this.db
      .update(actionAttempt)
      .set({
        status: 'CANCELLED',
        cancelRequestedAt: input.now,
        cancelReason: input.reason.slice(0, 4000),
        terminalReason: 'CANCELLED_BY_REQUEST',
        completedAt: input.now,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        leaseSlot: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(actionAttempt.attemptId, input.attemptId),
          inArray(actionAttempt.status, [...CANCELLABLE_STATUSES]),
        ),
      )
      .returning({ attemptId: actionAttempt.attemptId });
    if (updated.length === 1) return 'CANCELLED';
    const row = await this.readByAttemptId(input.attemptId);
    if (row?.status === 'COMMITTING' || row?.commitStartedAt) return 'TOO_LATE';
    return 'NOT_ACTIVE';
  }

  async finishResultGateFailure(input: {
    attemptId: string;
    leaseToken: string;
    leaseGeneration: number;
    result: OpenClawResultEnvelope;
    errorCode: string;
    errorMessage: string;
    now: Date;
  }): Promise<boolean> {
    return this.finishTerminal({
      attemptId: input.attemptId,
      fromStatus: 'COMMITTING',
      status: 'FAILED',
      terminalReason: 'HOST_RESULT_GATE_REJECTED',
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      result: input.result,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      now: input.now,
    });
  }
}

function isLeaseSlotConflict(cause: unknown): boolean {
  let current = cause;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    const value = current as Record<string, unknown>;
    if (
      value.code === '23505' &&
      (value.constraint === 'uk_action_attempt_lease_slot' ||
        value.constraint_name === 'uk_action_attempt_lease_slot')
    ) {
      return true;
    }
    current = value.cause;
  }
  return false;
}

function activeAttemptConflict(): Error & { code: string; statusCode: number } {
  return Object.assign(
    new Error('An active attempt already exists for this WorkItem and task.'),
    { code: 'ACTION_ATTEMPT_ACTIVE_CONFLICT', statusCode: 409 },
  );
}
