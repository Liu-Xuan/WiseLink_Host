import {
  canonicalJson,
  sealResultEnvelope,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';
import type {
  OpenClawActionTaskType,
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope.types';
import type { ActionAttemptRow } from '../../server/modules/action-attempt/action-attempt.types';
import { CanonicalHostOpenClawAttemptStatusService } from '../../server/modules/canonical-host/canonical-host-openclaw-attempt-status.service';
import {
  CANONICAL_HOST_OPENCLAW_APPLICABILITY_PROMPT_VERSION,
  CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY,
} from '../../server/modules/canonical-host/canonical-host-openclaw-runtime-policy';

const TASK_TYPES: OpenClawActionTaskType[] = [
  'OPENCLAW_TRANSLATE',
  'OPENCLAW_APPLICABILITY_EVALUATION',
  'OPENCLAW_DYNAMIC_EVALUATION',
  'OPENCLAW_OVERALL_SYNTHESIS',
  'OPENCLAW_INTERACTIVE_REVIEW',
];

const PUBLIC_STATUS_KEYS = [
  'attemptRef',
  'commitStartedAt',
  'projectionApplied',
  'recoveryAvailable',
  'resultContentHash',
  'status',
  'taskType',
  'terminalReason',
];

describe('CanonicalHostOpenClawAttemptStatusService', () => {
  it.each(TASK_TYPES)(
    'reads RUNNING, COMMITTING, and terminal %s without leaking scope or lease fields',
    async (taskType) => {
      const task = taskEnvelope(taskType);
      const result = resultEnvelope(task);
      const running = actionAttemptRow(task, 'RUNNING');
      const committing = actionAttemptRow(task, 'COMMITTING', result);
      const terminal = actionAttemptRow(task, 'SUCCEEDED', result);
      terminal.projectionApplied = taskType !== 'OPENCLAW_INTERACTIVE_REVIEW';
      terminal.terminalReason =
        taskType === 'OPENCLAW_INTERACTIVE_REVIEW'
          ? 'REVIEW_TURN_CANDIDATE_PERSISTED'
          : 'PROJECTION_CAS_APPLIED';
      terminal.completedAt = new Date('2026-08-27T01:03:00.000Z');
      const harness = statusHarness(running);

      const runningStatus = await harness.service.status(task.operationRef);
      expect(Object.keys(runningStatus).sort()).toEqual(PUBLIC_STATUS_KEYS);
      expect(runningStatus).toMatchObject({
        attemptRef: task.operationRef,
        taskType,
        status: 'RUNNING',
        recoveryAvailable: false,
        commitStartedAt: null,
        projectionApplied: false,
        terminalReason: null,
        resultContentHash: null,
      });

      harness.setRow(committing);
      const committingStatus = await harness.service.status(task.operationRef);
      expect(Object.keys(committingStatus).sort()).toEqual(
        [...PUBLIC_STATUS_KEYS, 'recoveryResult'].sort(),
      );
      expect(committingStatus.recoveryResult).toEqual(result);
      expect(committingStatus.resultContentHash).toBe(result.contentHash);

      harness.setRow(terminal);
      const terminalStatus = await harness.service.status(task.operationRef);
      expect(Object.keys(terminalStatus).sort()).toEqual(PUBLIC_STATUS_KEYS);
      expect(terminalStatus.recoveryAvailable).toBe(false);
      expect(terminalStatus.resultContentHash).toBe(
        committingStatus.resultContentHash,
      );
      expect(terminalStatus.projectionApplied).toBe(
        taskType !== 'OPENCLAW_INTERACTIVE_REVIEW',
      );

      for (const sensitive of [
        'actorUserId',
        'tenantId',
        'executorSessionKey',
        'leaseToken',
        'leaseOwner',
        'leaseGeneration',
        'leaseExpiresAt',
      ]) {
        expect(sensitive in runningStatus).toBe(false);
        expect(sensitive in committingStatus).toBe(false);
        expect(sensitive in terminalStatus).toBe(false);
      }
    },
  );

  it('preserves exact Applicability COMMITTING and terminal resultContentHash readback', async () => {
    const task = taskEnvelope('OPENCLAW_APPLICABILITY_EVALUATION');
    const result = resultEnvelope(task);
    const committing = actionAttemptRow(task, 'COMMITTING', result);
    const terminal = actionAttemptRow(task, 'SUCCEEDED', result);
    terminal.projectionApplied = true;
    terminal.terminalReason = 'PROJECTION_CAS_APPLIED';
    terminal.completedAt = new Date('2026-08-27T01:03:00.000Z');
    const harness = statusHarness(committing);

    const before = await harness.service.status(task.operationRef);
    harness.setRow(terminal);
    const after = await harness.service.status(task.operationRef);

    expect(before.recoveryResult?.promptVersion).toBe(
      CANONICAL_HOST_OPENCLAW_APPLICABILITY_PROMPT_VERSION,
    );
    expect(before.resultContentHash).toBe(result.contentHash);
    expect(after.resultContentHash).toBe(result.contentHash);
    expect(after.recoveryResult).toBeUndefined();
  });

  it('keeps historical terminal metadata readable without exposing or recovering an old-policy result', async () => {
    const task = taskEnvelope('OPENCLAW_TRANSLATE');
    const current = resultEnvelope(task);
    const { contentHash: _contentHash, ...unsealed } = current;
    const historical = sealResultEnvelope({
      ...unsealed,
      skillVersion: 'wiselink-research-and-synthesize@r09.c3',
    });
    const terminal = actionAttemptRow(task, 'SUCCEEDED', historical);
    terminal.projectionApplied = true;
    terminal.terminalReason = 'PROJECTION_CAS_APPLIED';
    terminal.completedAt = new Date('2026-08-27T01:03:00.000Z');
    const harness = statusHarness(terminal);

    await expect(harness.service.status(task.operationRef)).resolves.toEqual({
      attemptRef: task.operationRef,
      taskType: task.taskType,
      status: 'SUCCEEDED',
      recoveryAvailable: false,
      commitStartedAt: null,
      projectionApplied: true,
      terminalReason: 'PROJECTION_CAS_APPLIED',
      resultContentHash: historical.contentHash,
    });
  });

  it('authorizes GET_ACTION_ATTEMPT_STATUS before any scoped read', async () => {
    const task = taskEnvelope('OPENCLAW_TRANSLATE');
    const harness = statusHarness(actionAttemptRow(task, 'RUNNING'));
    const denied = Object.assign(new Error('denied'), {
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    harness.scope.authorizeOpenClawAttempt.mockRejectedValueOnce(denied);

    await expect(harness.service.status(task.operationRef)).rejects.toBe(
      denied,
    );
    expect(harness.attempts.readScoped).not.toHaveBeenCalled();
    expect(harness.scope.authorizeOpenClawAttempt).toHaveBeenCalledWith({
      operation: 'GET_ACTION_ATTEMPT_STATUS',
      attemptRef: task.operationRef,
    });
  });

  it('fails closed when the authorized tenant/WorkItem scoped read cannot see the attempt', async () => {
    const task = taskEnvelope('OPENCLAW_APPLICABILITY_EVALUATION');
    const harness = statusHarness(actionAttemptRow(task, 'RUNNING'));
    const notFound = Object.assign(new Error('not found'), {
      code: 'CANONICAL_ACTION_ATTEMPT_NOT_FOUND',
      statusCode: 404,
    });
    harness.attempts.readScoped.mockRejectedValueOnce(notFound);

    await expect(harness.service.status(task.operationRef)).rejects.toBe(
      notFound,
    );
    expect(harness.attempts.readScoped).toHaveBeenCalledWith({
      attemptRef: task.operationRef,
      tenantId: 'tenant-c5',
      workItemId: 'WI-C5',
    });
  });

  it('fails closed for an unknown action type', async () => {
    const task = taskEnvelope('OPENCLAW_TRANSLATE');
    const row = actionAttemptRow(task, 'RUNNING');
    row.actionType = 'OPENCLAW_UNKNOWN';
    const harness = statusHarness(row);

    await expect(harness.service.status(task.operationRef)).rejects.toThrow();
  });

  it('fails closed for a corrupt TaskEnvelope binding', async () => {
    const task = taskEnvelope('OPENCLAW_DYNAMIC_EVALUATION');
    const row = actionAttemptRow(task, 'RUNNING');
    row.taskEnvelopeJson = '{bad-json';
    const harness = statusHarness(row);

    await expect(harness.service.status(task.operationRef)).rejects.toThrow();
  });

  it('fails closed for a corrupt stored ResultEnvelope/hash binding', async () => {
    const task = taskEnvelope('OPENCLAW_OVERALL_SYNTHESIS');
    const result = resultEnvelope(task);
    const row = actionAttemptRow(task, 'COMMITTING', result);
    row.resultContentHash = 'f'.repeat(64);
    const harness = statusHarness(row);

    await expect(harness.service.status(task.operationRef)).rejects.toThrow(
      'OPENCLAW_RESULT_CONTENT_HASH_BINDING_MISMATCH',
    );
  });

  it('accepts only the explicit Review candidate-persistence terminal reason', async () => {
    const task = taskEnvelope('OPENCLAW_INTERACTIVE_REVIEW');
    const result = resultEnvelope(task);
    const row = actionAttemptRow(task, 'SUCCEEDED', result);
    row.projectionApplied = false;
    row.terminalReason = 'PROJECTION_CAS_APPLIED';
    row.completedAt = new Date('2026-08-27T01:03:00.000Z');
    const harness = statusHarness(row);

    await expect(
      harness.service.status(task.operationRef),
    ).rejects.toMatchObject({ code: 'CANONICAL_ACTION_ATTEMPT_CORRUPT' });
  });
});

function statusHarness(initialRow: ActionAttemptRow) {
  let row = initialRow;
  const attempts = {
    readScoped: jest.fn(async () => structuredClone(row)),
  };
  const scope = {
    authorizeOpenClawAttempt: jest.fn(async ({ attemptRef }) => ({
      principalId: 'service:openclaw-hosted',
      appId: 'app_17bzc551rsg',
      tenantId: 'tenant-c5',
      workItemId: 'WI-C5',
      authorizationFingerprint: 'sha256:scope-c5',
      attemptRef,
    })),
  };
  return {
    attempts,
    scope,
    service: new CanonicalHostOpenClawAttemptStatusService(
      attempts as never,
      scope as never,
    ),
    setRow(next: ActionAttemptRow) {
      row = next;
    },
  };
}

function taskEnvelope(taskType: OpenClawActionTaskType): OpenClawTaskEnvelope {
  return sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: `ATT-${taskType}`,
    operationRef: `AQ-${taskType}`,
    taskType,
    priority: 100,
    tenantId: 'tenant-c5',
    workItemId: 'WI-C5',
    inputRevision: 7,
    baseRevision: 7,
    documentVersionId: 'DV-C5',
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: {},
    deadline: '2026-08-27T02:00:00.000Z',
    idempotencyKey: `c5:${taskType}`,
  });
}

function resultEnvelope(task: OpenClawTaskEnvelope): OpenClawResultEnvelope {
  const policy = CANONICAL_HOST_OPENCLAW_RUNTIME_POLICY;
  return sealResultEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: '{}',
    outputArtifactRefs: [],
    sourceRefs: [],
    factsConsidered: [],
    missingInputs: [],
    conflicts: [],
    warnings: [],
    modelVersion: 'GLM-5.3',
    promptVersion:
      task.taskType === 'OPENCLAW_APPLICABILITY_EVALUATION'
        ? CANONICAL_HOST_OPENCLAW_APPLICABILITY_PROMPT_VERSION
        : `prompt:${task.taskType}`,
    skillVersion: policy.skillVersion,
    toolVersions: { [policy.mcpServerName]: policy.mcpServerVersion },
    runMetrics: { durationMs: 10, inputUnits: 20, outputUnits: 30 },
    errorCode: null,
    errorDetail: null,
  });
}

function actionAttemptRow(
  task: OpenClawTaskEnvelope,
  status: ActionAttemptRow['status'],
  result?: OpenClawResultEnvelope,
): ActionAttemptRow {
  const active = ['RUNNING', 'COMMITTING'].includes(status);
  return {
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    triggerRequestId: 'REQ-C5',
    workItemId: task.workItemId,
    actionType: task.taskType,
    attemptNo: 1,
    status,
    requestOrigin: 'OPENCLAW_MCP_V1',
    tenantId: task.tenantId,
    actorUserId: 'service:openclaw-main',
    priority: task.priority,
    inputRevision: task.inputRevision,
    baseRevision: task.baseRevision,
    documentVersionId: task.documentVersionId,
    taskEnvelopeJson: canonicalJson(task),
    taskInputHash: task.inputHash,
    resultEnvelopeJson: result ? canonicalJson(result) : null,
    resultContentHash: result?.contentHash ?? null,
    idempotencyKey: task.idempotencyKey,
    claimCount: active ? 1 : 0,
    retryCount: 0,
    maxAttempts: 3,
    leaseOwner: active ? 'service:openclaw-hosted' : null,
    leaseToken: active ? '00000000-0000-4000-8000-000000000001' : null,
    leaseGeneration: active ? 1 : 0,
    leaseExpiresAt: active ? new Date('2026-08-27T01:30:00.000Z') : null,
    lastHeartbeatAt: active ? new Date('2026-08-27T01:00:00.000Z') : null,
    nextAttemptAt: null,
    deadlineAt: new Date('2026-08-27T02:00:00.000Z'),
    cancelRequestedAt: null,
    cancelReason: null,
    terminalReason: null,
    projectionApplied: false,
    executorSessionKey: active ? `analysis:${task.actionAttemptId}` : null,
    commitStartedAt:
      status === 'COMMITTING' ? new Date('2026-08-27T01:02:00.000Z') : null,
    leaseSlot: active ? 0 : null,
    startedAt: active ? new Date('2026-08-27T01:00:00.000Z') : null,
    completedAt: null,
    createdAt: new Date('2026-08-27T00:59:00.000Z'),
    updatedAt: new Date('2026-08-27T01:02:00.000Z'),
  };
}
