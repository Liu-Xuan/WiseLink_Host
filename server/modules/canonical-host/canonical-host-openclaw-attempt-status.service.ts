import { Inject, Injectable } from '@nestjs/common';

import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import type {
  ActionAttemptStatus,
  OpenClawActionTaskType,
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type { ActionAttemptRow } from '../action-attempt/action-attempt.types';
import {
  parseCanonicalHostOpenClawAttemptTask,
  parseCanonicalHostOpenClawStoredResult,
} from './canonical-host-openclaw-runtime-policy';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
} from './canonical-service-scope.authorization';

const TERMINAL_STATUSES = new Set<ActionAttemptStatus>([
  'SUCCEEDED',
  'WAITING_INPUT',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
  'CONFLICT',
  'OBSOLETE',
]);

const ALL_STATUSES = new Set<ActionAttemptStatus>([
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
  ...TERMINAL_STATUSES,
]);

const REVIEW_SUCCESS_REASONS = new Set([
  'REVIEW_TURN_CANDIDATE_PERSISTED',
  'REVIEW_TURN_CANDIDATE_RECONCILED',
]);

export interface CanonicalHostOpenClawAttemptStatusResult {
  attemptRef: string;
  taskType: OpenClawActionTaskType;
  status: ActionAttemptStatus;
  recoveryAvailable: boolean;
  commitStartedAt: string | null;
  projectionApplied: boolean;
  terminalReason: string | null;
  resultContentHash: string | null;
  recoveryResult?: OpenClawResultEnvelope;
}

@Injectable()
export class CanonicalHostOpenClawAttemptStatusService {
  constructor(
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  async status(
    attemptRef: string,
  ): Promise<CanonicalHostOpenClawAttemptStatusResult> {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'GET_ACTION_ATTEMPT_STATUS',
      attemptRef,
    });
    assertAttemptScope(scope, attemptRef);
    const row = await this.attempts.readScoped({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    const task = parseCanonicalHostOpenClawAttemptTask(row);
    const taskType = explicitTaskType(row, task);
    const status = actionAttemptStatus(row.status);
    const recoveryResult = readRecoveryResult(row, task, status);
    assertStatusSemantics(row, taskType, status, recoveryResult);
    return {
      attemptRef,
      taskType,
      status,
      recoveryAvailable: recoveryResult !== undefined,
      commitStartedAt: row.commitStartedAt?.toISOString() ?? null,
      projectionApplied: row.projectionApplied,
      terminalReason: row.terminalReason,
      resultContentHash: row.resultContentHash,
      ...(recoveryResult
        ? { recoveryResult: structuredClone(recoveryResult) }
        : {}),
    };
  }
}

function explicitTaskType(
  row: ActionAttemptRow,
  task: OpenClawTaskEnvelope,
): OpenClawActionTaskType {
  switch (row.actionType) {
    case 'OPENCLAW_TRANSLATE':
    case 'OPENCLAW_APPLICABILITY_EVALUATION':
    case 'OPENCLAW_DYNAMIC_EVALUATION':
    case 'OPENCLAW_OVERALL_SYNTHESIS':
    case 'OPENCLAW_INTERACTIVE_REVIEW':
      if (task.taskType !== row.actionType) throw statusCorrupt();
      return row.actionType;
    default:
      throw statusCorrupt();
  }
}

function readRecoveryResult(
  row: ActionAttemptRow,
  task: OpenClawTaskEnvelope,
  status: ActionAttemptStatus,
): OpenClawResultEnvelope | undefined {
  const hasEnvelope = row.resultEnvelopeJson !== null;
  const hasHash = row.resultContentHash !== null;
  if (hasEnvelope !== hasHash) throw statusCorrupt();
  if (status === 'COMMITTING') {
    if (!hasEnvelope) throw statusCorrupt();
    return parseCanonicalHostOpenClawStoredResult({ row, task });
  }
  return undefined;
}

function assertStatusSemantics(
  row: ActionAttemptRow,
  taskType: OpenClawActionTaskType,
  status: ActionAttemptStatus,
  result: OpenClawResultEnvelope | undefined,
): void {
  if (status === 'COMMITTING') {
    if (
      !result ||
      !row.commitStartedAt ||
      row.terminalReason !== null ||
      row.projectionApplied
    ) {
      throw statusCorrupt();
    }
    return;
  }
  if (!TERMINAL_STATUSES.has(status)) {
    if (
      row.resultEnvelopeJson !== null ||
      row.resultContentHash !== null ||
      row.commitStartedAt ||
      row.terminalReason !== null ||
      row.projectionApplied
    ) {
      throw statusCorrupt();
    }
    return;
  }
  if (!row.terminalReason) throw statusCorrupt();
  if (status === 'SUCCEEDED') {
    if (taskType === 'OPENCLAW_INTERACTIVE_REVIEW') {
      if (
        row.projectionApplied ||
        !REVIEW_SUCCESS_REASONS.has(row.terminalReason)
      ) {
        throw statusCorrupt();
      }
    } else if (!row.projectionApplied) {
      throw statusCorrupt();
    }
  }
  if (
    row.projectionApplied &&
    status !== 'SUCCEEDED' &&
    status !== 'WAITING_INPUT'
  ) {
    throw statusCorrupt();
  }
}

function actionAttemptStatus(value: string): ActionAttemptStatus {
  if (!ALL_STATUSES.has(value as ActionAttemptStatus)) throw statusCorrupt();
  return value as ActionAttemptStatus;
}

function assertAttemptScope(
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attemptRef: string,
): void {
  if (
    scope.attemptRef !== attemptRef ||
    !scope.principalId.trim() ||
    !scope.tenantId.trim() ||
    !scope.workItemId.trim() ||
    !scope.authorizationFingerprint.trim()
  ) {
    throw statusNotFound();
  }
}

function statusNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Canonical ActionAttempt not found.'), {
    code: 'CANONICAL_ACTION_ATTEMPT_NOT_FOUND',
    statusCode: 404,
  });
}

function statusCorrupt(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Canonical ActionAttempt is corrupt.'), {
    code: 'CANONICAL_ACTION_ATTEMPT_CORRUPT',
    statusCode: 409,
  });
}
