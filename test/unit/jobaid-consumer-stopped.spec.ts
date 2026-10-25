import * as envelopes from '../../server/modules/action-attempt/action-attempt-envelope';
import * as tasks from '../../server/modules/canonical-host/jobaid-problem-task';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';
import type { JobAidConsumerStoppedReport } from '@shared/jobaid-activity.interface';

const requestId = '00000000-0000-4000-8000-000000000219';
const report: JobAidConsumerStoppedReport = {
  requestId, documentVersionId: 'DV-stop', inputRevision: 2, modelRound: 6,
  errorCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE', upstreamOutcome: 'UNKNOWN',
};
function row() {
  return {
    attemptId: 'ATT-stop', operationRef: 'AQ-stop', tenantId: 'tenant-stop', workItemId: 'WI-stop',
    documentVersionId: 'DV-stop', inputRevision: 2, baseRevision: 2,
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION', taskInputHash: 'task-hash',
    idempotencyKey: ['openclaw-v2', 'dynamic', 'WI-stop', 'DV-stop', requestId].join(':'),
    taskEnvelopeJson: JSON.stringify({ modelInput: {} }), resultEnvelopeJson: null, reviewActivityJson: '[]',
    status: 'RUNNING', leaseOwner: 'worker', leaseToken: 'private-token', leaseGeneration: 2,
    leaseExpiresAt: new Date(Date.now() + 60_000), deadlineAt: new Date(Date.now() + 120_000),
    cancelRequestedAt: null,
  };
}

function serviceHarness() {
  const attempt = row();
  const task = { actionAttemptId: attempt.attemptId, operationRef: attempt.operationRef,
    workItemId: attempt.workItemId, documentVersionId: attempt.documentVersionId,
    inputRevision: attempt.inputRevision, idempotencyKey: attempt.idempotencyKey };
  const taskInput = { actorUserId: 'original-owner', sourceCatalog: ['authorized-source'], sourceBindings: ['bound-source'] };
  jest.spyOn(envelopes, 'parseTaskEnvelope').mockReturnValue(task as never);
  jest.spyOn(tasks, 'parseJobAidProblemTask').mockReturnValue(taskInput as never);
  const scope = { appId: 'app_17bzc551rsg', tenantId: attempt.tenantId,
    workItemId: attempt.workItemId, principalId: 'worker' };
  const authorizeOpenClawAttempt = jest.fn().mockResolvedValue(scope);
  const readScoped = jest.fn().mockResolvedValue(attempt);
  const recordConsumerStopped = jest.fn().mockResolvedValue({
    status: 'RECORDED', attemptRef: attempt.operationRef,
    observedAt: '2026-10-25T00:00:00.000Z', upstreamOutcome: 'UNKNOWN', replayed: false,
  });
  const service = new CanonicalJobAidProblemService({} as never, {} as never,
    { authorizeOpenClawAttempt } as never, {} as never, {} as never, { readScoped } as never,
    {} as never, {} as never, {} as never, { recordConsumerStopped } as never);
  const assertNativeTaskAuthorized = jest.fn().mockResolvedValue(undefined);
  const assertSourcesAuthorized = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, { assertNativeTaskAuthorized, assertSourcesAuthorized });
  const input = { ...report, attemptRef: attempt.operationRef, workItemId: attempt.workItemId,
    leaseToken: attempt.leaseToken, leaseGeneration: attempt.leaseGeneration };
  return { service, input, attempt, task, taskInput, scope, authorizeOpenClawAttempt, readScoped,
    assertNativeTaskAuthorized, assertSourcesAuthorized, recordConsumerStopped };
}
afterEach(() => jest.restoreAllMocks());

it('uses original attempt control, task/source authorization and task actor for the observation', async () => {
  const h = serviceHarness();
  await h.service.recordConsumerStopped(h.input);
  expect(h.authorizeOpenClawAttempt).toHaveBeenCalledWith({
    attemptRef: 'AQ-stop', operation: 'HEARTBEAT_ATTEMPT', workItemId: 'WI-stop',
  });
  expect(h.readScoped).toHaveBeenCalledWith({ attemptRef: 'AQ-stop', tenantId: 'tenant-stop', workItemId: 'WI-stop' });
  expect(h.assertNativeTaskAuthorized).toHaveBeenCalledWith(h.taskInput, h.scope);
  expect(h.assertSourcesAuthorized).toHaveBeenCalledWith(h.taskInput.sourceCatalog, h.taskInput, 'tenant-stop', 'WI-stop', h.scope);
  expect(h.recordConsumerStopped).toHaveBeenCalledWith({
    row: h.attempt, actorUserId: 'original-owner', sourceBindings: h.taskInput.sourceBindings, report,
    fence: { principalId: 'worker', leaseToken: 'private-token', leaseGeneration: 2, automaticLeaseRequired: false },
  });
});

it.each(['request', 'attempt', 'tenant', 'document', 'revision', 'fence', 'authority', 'source', 'native'] as const)(
  'rejects changed %s before recording a stopped observation', async change => {
    const h = serviceHarness();
    if (change === 'request') h.input.requestId = '00000000-0000-4000-8000-000000000218';
    if (change === 'attempt') h.attempt.operationRef = 'AQ-other';
    if (change === 'tenant') h.scope.tenantId = 'other-tenant';
    if (change === 'document') h.input.documentVersionId = 'DV-other';
    if (change === 'revision') h.input.inputRevision = 1;
    if (change === 'fence') h.input.leaseGeneration = 1;
    if (change === 'authority') h.authorizeOpenClawAttempt.mockRejectedValue(new Error('DENIED'));
    if (change === 'source') h.assertSourcesAuthorized.mockRejectedValue(new Error('SOURCE_REVOKED'));
    if (change === 'native') h.assertNativeTaskAuthorized.mockRejectedValue(new Error('NATIVE_REVOKED'));
    const expected = { request: 'JOBAID_CONSUMER_STOPPED_BINDING_CHANGED',
      attempt: 'JOBAID_ATTEMPT_NOT_FOUND', tenant: 'JOBAID_ATTEMPT_NOT_FOUND',
      document: 'JOBAID_CONSUMER_STOPPED_BINDING_CHANGED', revision: 'JOBAID_CONSUMER_STOPPED_BINDING_CHANGED',
      fence: 'JOBAID_WORK_LEASE_FENCE_REJECTED', authority: 'DENIED',
      source: 'SOURCE_REVOKED', native: 'NATIVE_REVOKED' }[change];
    await expect(h.service.recordConsumerStopped(h.input)).rejects.toThrow(expected);
    expect(h.recordConsumerStopped).not.toHaveBeenCalled();
  },
);

it('accepts the exact automatic Overall namespace with no explicit request, but rejects an injected old UUID', async () => {
  const h = serviceHarness();
  Object.assign(h.attempt, { actionType: 'OPENCLAW_OVERALL_SYNTHESIS',
    idempotencyKey: 'openclaw-v1:overall:WI-stop:2:problem-v2' });
  Object.assign(h.task, { idempotencyKey: h.attempt.idempotencyKey });
  await h.service.recordConsumerStopped({ ...h.input, requestId: null });
  expect(h.recordConsumerStopped).toHaveBeenCalledWith(expect.objectContaining({
    report: expect.objectContaining({ requestId: null }),
  }));
  h.recordConsumerStopped.mockClear();
  await expect(h.service.recordConsumerStopped(h.input)).rejects.toThrow('JOBAID_CONSUMER_STOPPED_BINDING_CHANGED');
  expect(h.recordConsumerStopped).not.toHaveBeenCalled();
});

it.each(['raw error with private text', 'UNKNOWN\nprivate'])('rejects unsafe error metadata before authority lookup: %s', async errorCode => {
  const h = serviceHarness();
  await expect(h.service.recordConsumerStopped({ ...h.input, errorCode })).rejects.toThrow('JOBAID_CONSUMER_STOPPED_REPORT_INVALID');
  expect(h.authorizeOpenClawAttempt).not.toHaveBeenCalled();
  expect(h.recordConsumerStopped).not.toHaveBeenCalled();
});

function repositoryHarness() {
  const attempt = row();
  const locked = jest.fn().mockImplementation(async () => [attempt]);
  const returning = jest.fn().mockResolvedValue([{ attemptId: attempt.attemptId }]);
  const set = jest.fn((values: { reviewActivityJson: string }) => {
    attempt.reviewActivityJson = values.reviewActivityJson;
    return { where: () => ({ returning }) };
  });
  const update = jest.fn(() => ({ set }));
  const database = { select: () => ({ from: () => ({ where: () => ({ for: locked }) }) }), update };
  const withActorTransaction = jest.fn(async (_actor: string, operation: (context: unknown) => Promise<unknown>) => operation({ database }));
  const repository = new JobAidWorkRepository({} as never, { withActorTransaction } as never, {} as never);
  const lockSources = jest.fn().mockResolvedValue({ revision: 2 });
  Object.assign(repository, { lockSources });
  const input = { row: attempt as never, actorUserId: 'original-owner', sourceBindings: [],
    fence: { principalId: 'worker', leaseToken: 'private-token', leaseGeneration: 2 }, report: { ...report } };
  return { repository, attempt, input, database, withActorTransaction, lockSources, locked, update, set };
}

it('atomically appends only safe metadata once and preserves RUNNING/deadline/lease/result', async () => {
  const h = repositoryHarness();
  const before = { ...h.attempt };
  const first = await h.repository.recordConsumerStopped(h.input);
  const second = await h.repository.recordConsumerStopped(h.input);
  expect(first).toMatchObject({ status: 'RECORDED', upstreamOutcome: 'UNKNOWN', replayed: false });
  expect(second).toEqual({ ...first, replayed: true });
  expect(h.withActorTransaction).toHaveBeenCalledWith('original-owner', expect.any(Function));
  expect(h.lockSources).toHaveBeenCalledWith(h.database, h.attempt, 'original-owner', []);
  expect(h.locked).toHaveBeenCalledWith('update');
  expect(h.update).toHaveBeenCalledTimes(1);
  const records = JSON.parse(h.attempt.reviewActivityJson);
  expect(records).toEqual([{ kind: 'ASSESSMENT_CONSUMER_STOPPED', ...report, observedAt: first.observedAt }]);
  expect(JSON.stringify(records)).not.toContain('private-token');
  const { reviewActivityJson: _before, ...controlBefore } = before;
  const { reviewActivityJson: _after, ...controlAfter } = h.attempt;
  expect(controlAfter).toEqual(controlBefore);
});

it.each(['source', 'request', 'attempt', 'revision', 'fence', 'cancel'] as const)(
  'rechecks %s inside the original actor transaction before appending', async change => {
    const h = repositoryHarness();
    if (change === 'source') h.lockSources.mockRejectedValue(new Error('SOURCE_REVOKED'));
    if (change === 'request') h.input.report.requestId = '00000000-0000-4000-8000-000000000218';
    if (change === 'attempt') h.locked.mockResolvedValue([{ ...h.attempt, operationRef: 'AQ-other' }]);
    if (change === 'revision') h.lockSources.mockResolvedValue({ revision: 3 });
    if (change === 'fence') h.input.fence.leaseGeneration = 1;
    if (change === 'cancel') h.locked.mockResolvedValue([{ ...h.attempt, cancelRequestedAt: new Date() }] as never);
    const expected = { source: 'SOURCE_REVOKED', request: 'JOBAID_CONSUMER_STOPPED_BINDING_CHANGED',
      attempt: 'JOBAID_CONSUMER_STOPPED_BINDING_CHANGED', revision: 'JOBAID_CONSUMER_STOPPED_BINDING_CHANGED',
      fence: 'JOBAID_WORK_LEASE_FENCE_REJECTED', cancel: 'JOBAID_WORK_LEASE_FENCE_REJECTED' }[change];
    await expect(h.repository.recordConsumerStopped(h.input)).rejects.toThrow(expected);
    expect(h.update).not.toHaveBeenCalled();
  },
);

it('rejects a changed repeat report without replacing the original UNKNOWN observation', async () => {
  const h = repositoryHarness();
  await h.repository.recordConsumerStopped(h.input);
  const original = h.attempt.reviewActivityJson;
  await expect(h.repository.recordConsumerStopped({
    ...h.input, report: { ...h.input.report, modelRound: 7 },
  })).rejects.toThrow('JOBAID_CONSUMER_STOPPED_CONFLICT');
  expect(h.attempt.reviewActivityJson).toBe(original);
  expect(h.update).toHaveBeenCalledTimes(1);
});

it.each([true, false])('reads stopped metadata through the original browser authorization; allowed=%s', async allowed => {
  const authorize = jest.fn().mockResolvedValue({ allowed, action: 'READ_DOCUMENT_PARSING', permissionSnapshotVersion: 'fresh' });
  const freshRead = jest.fn().mockResolvedValue({ permissionSnapshotVersion: 'fresh' });
  const workItem = { workItemId: 'WI-stop', requestId: 'outer', revision: 2,
    source: { documentId: 'DOC-stop', documentVersionId: 'DV-stop', sourceArtifactId: 'ART-stop',
      sourceFileSha256: 'a'.repeat(64), sourceByteLength: 100 } };
  const readBrowserSnapshot = jest.fn().mockResolvedValue({ execution: {
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION', attemptId: 'ATT-stop', attemptRef: 'AQ-stop', status: 'RUNNING',
    createdAt: '2026-10-25T00:00:00Z', startedAt: '2026-10-25T00:00:00Z', completedAt: null,
    activityJson: JSON.stringify([{ kind: 'ASSESSMENT_CONSUMER_STOPPED', ...report,
      observedAt: '2026-10-25T00:01:00.000Z' }]),
  }, current: null, savedActivity: [], latestAttempt: { attemptId: 'ATT-stop', status: 'RUNNING', inputRevision: 2 } });
  const service = new CanonicalJobAidProblemService({
    getTenantScopedByWorkItemId: jest.fn().mockResolvedValue(workItem),
  } as never, {} as never, {} as never, { authorize } as never, { freshRead } as never, {} as never,
  { readReadableAutoProcessingCompletion: jest.fn().mockResolvedValue(null) } as never,
  {} as never, {} as never, { readBrowserSnapshot } as never);
  const actor = { appId: 'app-test', tenantId: 'tenant-stop', userId: 'original-owner', roles: [], env: 'test' };
  if (!allowed) {
    await expect(service.readBrowser('WI-stop', actor)).rejects.toThrow();
    expect(readBrowserSnapshot).not.toHaveBeenCalled();
    return;
  }
  const result = await service.readBrowser('WI-stop', actor);
  expect(authorize).toHaveBeenCalled();
  expect(freshRead).toHaveBeenCalled();
  expect(result.executionStatus).toBe('RUNNING');
  expect(result.selectedExecution?.status).toBe('RUNNING');
  expect(result.activity?.consumerStopped).toMatchObject({ upstreamOutcome: 'UNKNOWN', modelRound: 6 });
  expect(result.current).toBeNull();
  expect(JSON.stringify(result)).not.toContain(requestId);
});
