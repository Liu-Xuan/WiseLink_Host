import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../../server/modules/action-attempt/action-attempt.types';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CanonicalAutoProcessingCompletionReceipt } from '@shared/api.interface';

const execution = { actionType: 'OPENCLAW_DYNAMIC_EVALUATION' as const, status: 'RUNNING',
  attemptId: 'attempt', attemptRef: 'ref', activityJson: null,
  createdAt: '2026-09-23T08:00:00+08:00', startedAt: null, completedAt: null };
const saved = { workRevisionRef: 'saved', workRevision: 2, createdAt: '2026-09-23T00:00:00Z' };
const rawWork = { assessmentWorkRevisionId: 'saved', workItemId: 'WI', workRevision: 2,
  previousWorkRevisionId: 'previous', requestId: 'request', actionAttemptId: 'attempt',
  basedOnWorkItemRevision: 3, documentVersionId: 'DV', createdAt: saved.createdAt,
  contentJson: JSON.stringify({ schemaVersion: 'wiselink.jobaid-problem-work.v3', issues: [], evidence: [] }) };

it('reads execution/body/bounded receipts in one parameterized statement without changing transaction type', async () => {
  const execute = jest.fn((_query: SQL) => Promise.resolve([{ execution, latestAttempt: { attemptId: 'attempt', status: 'RUNNING', inputRevision: 3, createdAt: '2026-09-23T08:00:00+08:00', startedAt: null, completedAt: null, firstSavedAt: saved.createdAt }, current: rawWork, savedActivity: [saved] }]));
  const transaction = jest.fn(() => { throw new Error('Switch transaction type failed'); });
  const repository = new JobAidWorkRepository({ execute, transaction } as never, {} as never, {} as never);
  const result = await repository.readBrowserSnapshot({ tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(transaction).not.toHaveBeenCalled();
  expect(result.execution).toEqual({ ...execution, createdAt: '2026-09-23T00:00:00.000Z' });
  expect(result.latestAttempt).toEqual({ attemptId: 'attempt', status: 'RUNNING', inputRevision: 3, createdAt: '2026-09-23T00:00:00.000Z', startedAt: null, completedAt: null, firstSavedAt: '2026-09-23T00:00:00.000Z' });
  expect(result.current).toMatchObject({ workRevisionRef: 'saved', actionAttemptId: 'attempt', documentVersionId: 'DV' });
  expect(result.savedActivity).toEqual([{ ...saved, createdAt: new Date(saved.createdAt) }]);
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
  expect(query.params).toEqual(['tenant', 'WI', 'DV', ACTION_ATTEMPT_REQUEST_ORIGIN, 'tenant', 'WI', 'DV', 'tenant', 'WI', 'DV', ACTION_ATTEMPT_REQUEST_ORIGIN, 'tenant', 'WI', 'tenant', 'WI', 'DV', 51]);
  expect(query.sql).not.toMatch(/\b(?:set transaction|begin|commit)\b/iu);
  expect(query.sql).toContain('"subject_kind" = \'WORK_ITEM\'');
  expect(query.sql).toContain("'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS'");
  expect(query.sql).toContain("= 'OPENCLAW_DYNAMIC_EVALUATION'");
  expect(query.sql).toContain("'QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'");
  expect(query.sql).toContain('"action_attempt_id" = (SELECT "attemptId" FROM selected_execution)');
  expect(query.sql).toContain('jsonb_agg(to_jsonb(s) ORDER BY s."workRevision" DESC)');
});

it('distinguishes a genuinely empty snapshot from missing data, invalid history and a query failure', async () => {
  const execute = jest.fn().mockResolvedValue([{ execution: null, latestAttempt: null, current: null, savedActivity: [] }]);
  const repository = new JobAidWorkRepository({ execute } as never, {} as never, {} as never);
  const input = { tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' };
  await expect(repository.readBrowserSnapshot(input)).resolves.toEqual({ execution: null, latestAttempt: null, current: null, savedActivity: [] });
  execute.mockResolvedValueOnce([]);
  await expect(repository.readBrowserSnapshot(input)).rejects.toThrow('JOBAID_SNAPSHOT_READBACK_MISSING');
  execute.mockResolvedValueOnce([{ execution, current: { ...rawWork, contentJson: '{}' }, savedActivity: [] }]);
  await expect(repository.readBrowserSnapshot(input)).rejects.toThrow('JOBAID_STORED_WORK_INVALID');
  execute.mockRejectedValueOnce(new Error('DATABASE_UNAVAILABLE'));
  await expect(repository.readBrowserSnapshot(input)).rejects.toThrow('DATABASE_UNAVAILABLE');
  expect(execute).toHaveBeenCalledTimes(4);
});

function harness() {
  const authorize = jest.fn().mockResolvedValue({ allowed: true, action: 'READ_DOCUMENT_PARSING', permissionSnapshotVersion: 'fresh' });
  const freshRead = jest.fn().mockResolvedValue({ permissionSnapshotVersion: 'fresh' });
  const projection = { workItemId: 'WI', requestId: 'outer-request', revision: 3,
    source: { documentId: 'DOC', documentVersionId: 'DV', sourceArtifactId: 'SOURCE',
      sourceFileSha256: `sha256:${'a'.repeat(64)}`, sourceByteLength: 100 } };
  const registrar = { getTenantScopedByWorkItemId: jest.fn().mockResolvedValue(projection) };
  const workItems = new MiaodaWorkItemRepository({} as never);
  const completionRead = jest.spyOn(workItems, 'readReadableAutoProcessingCompletion');
  const completionLoad = jest.spyOn(workItems, 'loadTenantScopedProjection').mockResolvedValue(null);
  const work = { readBrowserSnapshot: jest.fn().mockResolvedValue({ execution, latestAttempt: { attemptId: 'attempt', status: 'RUNNING', inputRevision: 3 }, current: null, savedActivity: [] }) };
  const service = new CanonicalJobAidProblemService(registrar as never, {} as never, {} as never,
    { authorize } as never, { freshRead } as never, {} as never, workItems, {} as never, {} as never, work as never);
  const assertEvidenceOwned = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, { assertEvidenceOwned });
  const actor = { appId: 'app-test', tenantId: 'tenant', userId: 'owner', roles: [], env: 'test' };
  return { service, actor, work, authorize, freshRead, assertEvidenceOwned,
    projection, completionRead, completionLoad };
}

it('reports the authorized current attempt before a first save', async () => {
  const f = harness();
  const result = await f.service.readBrowser('WI', f.actor);
  expect(f.work.readBrowserSnapshot).toHaveBeenCalledWith({ tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' });
  expect(result.current).toBeNull(); expect(result.executionStatus).toBe('RUNNING');
  expect(result.latestAttempt).toEqual({ attemptId: 'attempt', status: 'RUNNING', inputRevision: 3 });
  expect(result.activity?.attemptRef).toBe('ref');
});

it('keeps the latest dynamic evaluation distinct from a selected overall run', async () => {
  const f = harness();
  f.work.readBrowserSnapshot.mockResolvedValue({
    execution: { ...execution, actionType: 'OPENCLAW_OVERALL_SYNTHESIS', attemptId: 'overall-attempt',
      attemptRef: 'exact-persisted-overall-ref', status: 'RUNNING', activityJson: '[]' },
    latestAttempt: { attemptId: 'dynamic-attempt', status: 'SUCCEEDED', inputRevision: 2 },
    current: null,
    savedActivity: [],
  });
  const result = await f.service.readBrowser('WI', f.actor);
  expect(result.executionStatus).toBe('RUNNING');
  expect(result.latestAttempt).toEqual({ attemptId: 'dynamic-attempt', status: 'SUCCEEDED', inputRevision: 2 });
  expect(result.selectedExecution).toEqual({ actionType: 'OPENCLAW_OVERALL_SYNTHESIS', attemptId: 'overall-attempt',
    executionMode: null, executionModel: null, programMaterialsAvailable: false, programProgress: null,
    attemptRef: 'exact-persisted-overall-ref', status: 'RUNNING', createdAt: execution.createdAt, startedAt: null, completedAt: null });
  expect(result.selectedExecution).not.toHaveProperty('activityJson');
  expect(result.selectedExecution).not.toHaveProperty('requestId');
});

it.each(['permission', 'snapshot'])('does not read the database on %s denial', async mode => {
  const f = harness();
  if (mode === 'permission') f.authorize.mockResolvedValue({ allowed: false });
  else f.freshRead.mockResolvedValue({ permissionSnapshotVersion: 'changed' });
  await expect(f.service.readBrowser('WI', f.actor)).rejects.toThrow();
  expect(f.work.readBrowserSnapshot).not.toHaveBeenCalled();
  expect(f.completionRead).not.toHaveBeenCalled();
});

function completedReceipt(f: ReturnType<typeof harness>, change: Partial<CanonicalAutoProcessingCompletionReceipt> = {}) {
  const receipt: CanonicalAutoProcessingCompletionReceipt = {
    tenantId: f.actor.tenantId, actorUserId: f.actor.userId, workItemId: 'WI', requestId: 'outer-request',
    ...f.projection.source, sourceFileSha256: 'a'.repeat(64), completedAt: '2026-09-22T00:00:00Z', ...change,
  };
  f.completionLoad.mockResolvedValue({
    row: { ...receipt, revision: 3, requestedByUserId: f.actor.userId,
      actionType: 'PARSE_PDF', status: 'CANDIDATE_READBACK_VERIFIED', packageId: 'PACKAGE' },
    projection: { revision: 3, autoProcessingCompletionReceipt: receipt },
  } as never);
  return receipt;
}

it.each(['RUNNING', 'COMMITTING'])('reads the validated original ACK once alongside a newer %s attempt', async status => {
  const f = harness(), receipt = completedReceipt(f);
  f.work.readBrowserSnapshot.mockResolvedValue({ execution: { ...execution, status },
    latestAttempt: { attemptId: 'later-attempt', status, inputRevision: 3 }, current: null, savedActivity: [] });
  const result = await f.service.readBrowser('WI', f.actor);
  expect(result.autoProcessingAcknowledgement).toEqual({ workItemId: 'WI', requestId: 'outer-request',
    documentVersionId: 'DV', acknowledgedAt: receipt.completedAt });
  expect(Object.keys(result.autoProcessingAcknowledgement!)).toHaveLength(4);
  expect(result.latestAttempt).toMatchObject({ attemptId: 'later-attempt', status });
  expect(result.executionStatus).toBe(status);
  expect(f.completionRead).toHaveBeenCalledTimes(1);
  expect(f.completionRead).toHaveBeenCalledWith({ tenantId: 'tenant', actorUserId: 'owner', workItemId: 'WI', revision: 3 });
  expect(f.completionLoad).toHaveBeenCalledTimes(1);
});

const changedTuple: Array<[string, Partial<CanonicalAutoProcessingCompletionReceipt>]> = [
  ['request', { requestId: 'later-request' }], ['document', { documentId: 'later-document' }],
  ['document version', { documentVersionId: 'later-version' }], ['source artifact', { sourceArtifactId: 'later-artifact' }],
  ['hash', { sourceFileSha256: 'b'.repeat(64) }], ['bytes', { sourceByteLength: 101 }],
];
it.each(changedTuple)('does not expose a valid fresh-row ACK when the authorized %s tuple differs', async (_name, change) => {
  const f = harness(); completedReceipt(f, change);
  // The new row and its receipt agree; it is the prior authorized projection that differs.
  const result = await f.service.readBrowser('WI', f.actor);
  expect(result.autoProcessingAcknowledgement).toBeNull();
  expect(result.executionStatus).toBe('RUNNING');
  expect(f.completionLoad).toHaveBeenCalledTimes(1);
});

it('accepts a bare or sha256-prefixed authorized hash but no different or malformed value', async () => {
  const f = harness(); completedReceipt(f);
  for (const hash of ['a'.repeat(64), `sha256:${'a'.repeat(64)}`]) {
    f.projection.source.sourceFileSha256 = hash;
    expect((await f.service.readBrowser('WI', f.actor)).autoProcessingAcknowledgement).not.toBeNull();
  }
  for (const hash of ['invalid', `sha256:${'b'.repeat(64)}`]) {
    f.projection.source.sourceFileSha256 = hash;
    expect((await f.service.readBrowser('WI', f.actor)).autoProcessingAcknowledgement).toBeNull();
  }
});

it('returns null on a concurrent revision and propagates completion-read database errors', async () => {
  const f = harness(); completedReceipt(f); f.projection.revision = 4;
  expect((await f.service.readBrowser('WI', f.actor)).autoProcessingAcknowledgement).toBeNull();
  f.completionLoad.mockRejectedValue(new Error('DATABASE_UNAVAILABLE'));
  await expect(f.service.readBrowser('WI', f.actor)).rejects.toThrow('DATABASE_UNAVAILABLE');
});

it.each(['RUNNING', 'SUCCEEDED'])('retains the coherent saved body for %s and still rejects revoked evidence', async status => {
  const f = harness();
  const current = { workRevisionRef: 'saved', basedOnWorkItemRevision: 2, content: { evidence: [] } };
  f.work.readBrowserSnapshot.mockResolvedValue({ execution: { ...execution, status }, current, savedActivity: [] });
  const result = await f.service.readBrowser('WI', f.actor);
  expect(result.current).toBe(current); expect(result.executionStatus).toBe(status);
  expect(f.assertEvidenceOwned).toHaveBeenCalledWith([], 'tenant', 'owner', 'WI');
  f.assertEvidenceOwned.mockRejectedValue(new Error('SOURCE_REVOKED'));
  await expect(f.service.readBrowser('WI', f.actor)).rejects.toThrow('SOURCE_REVOKED');
});
