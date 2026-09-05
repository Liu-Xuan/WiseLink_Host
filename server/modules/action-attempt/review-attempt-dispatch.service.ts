import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

import type { ReviewTurnExecutionReadModel } from '@shared/api.interface';
import { parseTaskEnvelope, sealTaskEnvelope } from './action-attempt-envelope';
import { ActionAttemptLifecycleService } from './action-attempt-lifecycle.service';
import { ActionAttemptRepository } from './action-attempt.repository';
import {
  ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
  ACTION_ATTEMPT_REQUEST_ORIGIN,
} from './action-attempt.types';
import type {
  ActionAttemptRow,
  ReserveAndClaimResult,
} from './action-attempt.types';
import type { ActionEnvelopeArtifactRef } from './action-attempt-envelope.types';

const REVIEW_TASK_TYPE = 'OPENCLAW_INTERACTIVE_REVIEW';
export const REVIEW_ACTIVE_EXECUTION_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
] as const;

export interface ReviewExecutionBinding {
  tenantId: string;
  workItemId: string;
  actorId: string;
  reviewConversationId: string;
  reviewTurnId: string;
  inputRevision: number;
}

/** Keeps pre-model failures in the existing attempt, not a second queue. */
@Injectable()
export class ReviewAttemptDispatchService {
  private readonly logger = new Logger(ReviewAttemptDispatchService.name);

  constructor(
    private readonly repository: ActionAttemptRepository,
    private readonly lifecycle: ActionAttemptLifecycleService,
  ) {}

  async readExecution(
    input: ReviewExecutionBinding,
  ): Promise<ActionAttemptRow | null> {
    const row = await this.repository.readLatestByExactIdempotency({
      tenantId: input.tenantId,
      idempotencyKey: reviewTurnIdempotencyKey(input),
    });
    if (
      row &&
      (row.tenantId !== input.tenantId ||
        row.workItemId !== input.workItemId ||
        row.actorUserId !== input.actorId ||
        row.actionType !== REVIEW_TASK_TYPE ||
        row.inputRevision !== input.inputRevision ||
        row.requestOrigin !== ACTION_ATTEMPT_REQUEST_ORIGIN)
    )
      throw dispatchConflict('REVIEW_EXECUTION_BINDING_MISMATCH');
    return row;
  }

  async isBusy(input: ReviewExecutionBinding): Promise<boolean> {
    const row = await this.repository.readActiveReviewForWorkItem(input);
    if (!row) return false;
    const now = new Date();
    if (row.status !== 'COMMITTING' && row.deadlineAt && row.deadlineAt <= now)
      return false;
    if (row.idempotencyKey !== reviewTurnIdempotencyKey(input)) {
      return (
        row.status !== 'RUNNING' ||
        !row.leaseExpiresAt ||
        row.leaseExpiresAt > now
      );
    }
    return (
      row.status === 'RUNNING' &&
      !!row.leaseExpiresAt &&
      row.leaseExpiresAt > new Date()
    );
  }

  async executionProjection(
    input: ReviewExecutionBinding & {
      executionRequested?: boolean;
      createdAt: Date;
    },
  ): Promise<ReviewTurnExecutionReadModel | null> {
    const row = await this.readExecution(input);
    if (!row && !input.executionRequested) return null;
    return {
      status: row ? executionStatus(row.status) : 'REQUESTED',
      attemptRef: row?.operationRef ?? null,
      requestedAt: input.executionRequested
        ? input.createdAt.toISOString()
        : null,
      startedAt: row?.startedAt?.toISOString() ?? null,
      updatedAt: (row?.updatedAt ?? input.createdAt).toISOString(),
      completedAt: row?.completedAt?.toISOString() ?? null,
      error:
        row &&
        (row.errorCode ||
          ['FAILED', 'TIMED_OUT', 'CANCELLED', 'CONFLICT', 'OBSOLETE'].includes(
            row.status,
          ))
          ? {
              code:
                row.errorCode ??
                row.terminalReason ??
                `REVIEW_EXECUTION_${row.status}`,
              message:
                row.errorMessage ??
                row.cancelReason ??
                row.errorCode ??
                row.terminalReason ??
                `REVIEW_EXECUTION_${row.status}`,
            }
          : null,
    };
  }

  async prepareAndClaim(
    input: ReviewExecutionBinding & {
      documentVersionId: string;
      leaseOwner: string;
      buildInput(): Promise<{
        modelInput: Record<string, unknown>;
        sourceRefs: ActionEnvelopeArtifactRef[];
      }>;
    },
  ): Promise<ReserveAndClaimResult> {
    const now = new Date();
    let row = await this.readExecution(input);
    if (row && !isReviewExecutionActive(row.status)) {
      throw dispatchConflict('REVIEW_TURN_EXECUTION_ALREADY_FINISHED');
    }
    if (!row) {
      await this.repository.terminalizeExpiredActiveForSuccessor({
        workItemId: input.workItemId,
        tenantId: input.tenantId,
        actionType: REVIEW_TASK_TYPE,
        now,
      });
      const attemptNo = await this.repository.nextAttemptNo({
        workItemId: input.workItemId,
        actionType: REVIEW_TASK_TYPE,
      });
      const reserved = await this.repository.reserve({
        attemptId: `ATT-${randomUUID()}`,
        operationRef: `AQ-${randomUUID().replaceAll('-', '')}`,
        triggerRequestId: `REQ-${randomUUID()}`,
        workItemId: input.workItemId,
        actionType: REVIEW_TASK_TYPE,
        tenantId: input.tenantId,
        actorUserId: input.actorId,
        inputRevision: input.inputRevision,
        baseRevision: input.inputRevision,
        documentVersionId: input.documentVersionId,
        idempotencyKey: reviewTurnIdempotencyKey(input),
        attemptNo,
        requestOrigin: ACTION_ATTEMPT_REQUEST_ORIGIN,
        status: 'QUEUED',
        priority: 100,
        maxAttempts: 3,
        nextAttemptAt: now,
        deadlineAt: new Date(
          now.getTime() + ACTION_ATTEMPT_DEFAULT_DEADLINE_MS,
        ),
        createdAt: now,
        updatedAt: now,
      });
      row = reserved.row;
    }
    if (!row.taskEnvelopeJson) {
      try {
        const prepared = await input.buildInput();
        const task = sealTaskEnvelope({
          schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
          actionAttemptId: row.attemptId,
          operationRef: row.operationRef!,
          taskType: REVIEW_TASK_TYPE,
          priority: row.priority,
          tenantId: input.tenantId,
          workItemId: input.workItemId,
          inputRevision: input.inputRevision,
          baseRevision: input.inputRevision,
          documentVersionId: input.documentVersionId,
          sourceRefs: prepared.sourceRefs,
          allowedConnectors: [],
          hostResolvedMissingInputs: [],
          modelInput: prepared.modelInput,
          deadline: row.deadlineAt!.toISOString(),
          idempotencyKey: reviewTurnIdempotencyKey(input),
        });
        await this.repository.prepareReviewInput(row.attemptId, task);
      } catch (cause: unknown) {
        const errorCode = reviewPreparationErrorCode(cause);
        this.logger.error(
          errorCode,
          cause instanceof Error ? cause.stack : undefined,
        );
        await this.repository.failReviewPreparation(row.attemptId, errorCode);
        throw cause;
      }
      row = await this.readExecution(input);
    }
    if (!row?.taskEnvelopeJson)
      throw dispatchConflict('REVIEW_INPUT_PREPARATION_INCOMPLETE');
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    return this.lifecycle.reserveAndClaim({
      workItemId: input.workItemId,
      taskType: REVIEW_TASK_TYPE,
      actorUserId: input.actorId,
      tenantId: input.tenantId,
      documentVersionId: input.documentVersionId,
      inputRevision: input.inputRevision,
      baseRevision: input.inputRevision,
      idempotencyKey: reviewTurnIdempotencyKey(input),
      leaseOwner: input.leaseOwner,
      sourceRefs: task.sourceRefs,
      allowedConnectors: task.allowedConnectors,
      buildModelInput: async () => structuredClone(task.modelInput),
    });
  }
}

export function reviewTurnIdempotencyKey(
  input: Pick<
    ReviewExecutionBinding,
    'reviewConversationId' | 'reviewTurnId' | 'inputRevision'
  >,
): string {
  return [
    'openclaw-v1',
    'review',
    input.reviewConversationId,
    input.reviewTurnId,
    input.inputRevision,
  ].join(':');
}

export function isReviewExecutionActive(status: string): boolean {
  return REVIEW_ACTIVE_EXECUTION_STATUSES.some((value) => value === status);
}

function reviewPreparationErrorCode(cause: unknown): string {
  const value =
    cause && typeof cause === 'object' && 'code' in cause
      ? cause.code
      : cause instanceof Error
        ? cause.message
        : null;
  return typeof value === 'string' && /^[A-Z][A-Z0-9_:.-]{0,159}$/u.test(value)
    ? value
    : 'REVIEW_CONTEXT_PREPARATION_FAILED';
}

function dispatchConflict(
  code: string,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}

function executionStatus(
  value: string,
): ReviewTurnExecutionReadModel['status'] {
  switch (value) {
    case 'QUEUED':
    case 'RUNNING':
    case 'RETRY_SCHEDULED':
    case 'COMMITTING':
    case 'SUCCEEDED':
    case 'FAILED':
    case 'TIMED_OUT':
    case 'CANCELLED':
    case 'CONFLICT':
    case 'OBSOLETE':
    case 'WAITING_INPUT':
      return value;
    default:
      throw dispatchConflict('REVIEW_EXECUTION_STATUS_UNSUPPORTED');
  }
}
