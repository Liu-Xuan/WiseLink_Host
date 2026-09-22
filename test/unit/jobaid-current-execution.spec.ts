import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../../server/modules/action-attempt/action-attempt.types';

const execution = { status: 'RUNNING', attemptId: 'attempt', attemptRef: 'ref', activityJson: null };
const saved = { workRevisionRef: 'saved', workRevision: 2, createdAt: '2026-09-23T00:00:00Z' };
const rawWork = { assessmentWorkRevisionId: 'saved', workItemId: 'WI', workRevision: 2,
  previousWorkRevisionId: 'previous', requestId: 'request', actionAttemptId: 'attempt',
  basedOnWorkItemRevision: 3, documentVersionId: 'DV', createdAt: saved.createdAt,
  contentJson: JSON.stringify({ schemaVersion: 'wiselink.jobaid-problem-work.v3', issues: [], evidence: [] }) };

it('reads execution/body/bounded receipts in one parameterized statement without changing transaction type', async () => {
  const execute = jest.fn((_query: SQL) => Promise.resolve([{ execution, current: rawWork, savedActivity: [saved] }]));
  const transaction = jest.fn(() => { throw new Error('Switch transaction type failed'); });
  const repository = new JobAidWorkRepository({ execute, transaction } as never, {} as never, {} as never);
  const result = await repository.readBrowserSnapshot({ tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(transaction).not.toHaveBeenCalled();
  expect(result.execution).toEqual(execution);
  expect(result.current).toMatchObject({ workRevisionRef: 'saved', actionAttemptId: 'attempt', documentVersionId: 'DV' });
  expect(result.savedActivity).toEqual([{ ...saved, createdAt: new Date(saved.createdAt) }]);
  const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
  expect(query.params).toEqual(['tenant', 'WI', 'DV', ACTION_ATTEMPT_REQUEST_ORIGIN, 'tenant', 'WI', 'tenant', 'WI', 'DV', 51]);
  expect(query.sql).not.toMatch(/\b(?:set transaction|begin|commit)\b/iu);
  expect(query.sql).toContain('"subject_kind" = \'WORK_ITEM\'');
  expect(query.sql).toContain("'OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS'");
  expect(query.sql).toContain("'QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'");
  expect(query.sql).toContain('"action_attempt_id" = (SELECT "attemptId" FROM selected_execution)');
  expect(query.sql).toContain('jsonb_agg(to_jsonb(s) ORDER BY s."workRevision" DESC)');
});

it('distinguishes a genuinely empty snapshot from missing data, invalid history and a query failure', async () => {
  const execute = jest.fn().mockResolvedValue([{ execution: null, current: null, savedActivity: [] }]);
  const repository = new JobAidWorkRepository({ execute } as never, {} as never, {} as never);
  const input = { tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' };
  await expect(repository.readBrowserSnapshot(input)).resolves.toEqual({ execution: null, current: null, savedActivity: [] });
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
  const registrar = { getTenantScopedByWorkItemId: jest.fn().mockResolvedValue({ source: { documentVersionId: 'DV' }, revision: 3 }) };
  const work = { readBrowserSnapshot: jest.fn().mockResolvedValue({ execution, current: null, savedActivity: [] }) };
  const service = new CanonicalJobAidProblemService(registrar as never, {} as never, {} as never,
    { authorize } as never, { freshRead } as never, {} as never, {} as never, {} as never, {} as never, work as never);
  const assertEvidenceOwned = jest.fn().mockResolvedValue(undefined);
  Object.assign(service, { assertEvidenceOwned });
  const actor = { appId: 'app-test', tenantId: 'tenant', userId: 'owner', roles: [], env: 'test' };
  return { service, actor, work, authorize, freshRead, assertEvidenceOwned };
}

it('reports the authorized current attempt before a first save', async () => {
  const f = harness();
  const result = await f.service.readBrowser('WI', f.actor);
  expect(f.work.readBrowserSnapshot).toHaveBeenCalledWith({ tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' });
  expect(result.current).toBeNull(); expect(result.executionStatus).toBe('RUNNING');
  expect(result.activity?.attemptRef).toBe('ref');
});

it.each(['permission', 'snapshot'])('does not read the database on %s denial', async mode => {
  const f = harness();
  if (mode === 'permission') f.authorize.mockResolvedValue({ allowed: false });
  else f.freshRead.mockResolvedValue({ permissionSnapshotVersion: 'changed' });
  await expect(f.service.readBrowser('WI', f.actor)).rejects.toThrow();
  expect(f.work.readBrowserSnapshot).not.toHaveBeenCalled();
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
