import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { JobAidWorkRepository } from '../../server/modules/canonical-host/jobaid-work.repository';
import { CanonicalJobAidProblemService } from '../../server/modules/canonical-host/canonical-jobaid-problem.service';
import { ACTION_ATTEMPT_REQUEST_ORIGIN } from '../../server/modules/action-attempt/action-attempt.types';

it('reads only the current document assessment status, prioritizing active attempts with deterministic ordering', async () => {
  const limit = jest.fn().mockResolvedValue([{ status: 'RUNNING' }]);
  const orderBy = jest.fn((..._orders: SQL[]) => ({ limit }));
  const where = jest.fn((_condition: SQL) => ({ orderBy }));
  const select = jest.fn((_fields: unknown) => ({ from: () => ({ where }) }));
  const repository = new JobAidWorkRepository(
    { select } as never,
    {} as never,
    {} as never,
  );
  expect(
    await repository.readCurrentExecution({
      tenantId: 'tenant-one',
      workItemId: 'WI-one',
      documentVersionId: 'DV-one',
    }),
  ).toEqual({ status: 'RUNNING' });
  expect(Object.keys(select.mock.calls[0][0] as object)).toEqual([
    'status',
    'attemptId',
    'attemptRef',
    'activityJson',
  ]);
  const dialect = new PgDialect();
  expect(dialect.sqlToQuery(where.mock.calls[0][0]).params).toEqual([
    'tenant-one',
    'WI-one',
    'DV-one',
    'WORK_ITEM',
    ACTION_ATTEMPT_REQUEST_ORIGIN,
    'OPENCLAW_DYNAMIC_EVALUATION',
    'OPENCLAW_OVERALL_SYNTHESIS',
  ]);
  const ordering = orderBy.mock.calls[0]
    .map((order) => dialect.sqlToQuery(order).sql)
    .join(' ');
  expect(ordering).toContain(
    "'QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'",
  );
  expect(ordering).toContain('"created_at" desc');
  expect(ordering).toContain('"attempt_id" desc');
  expect(limit).toHaveBeenCalledWith(1);
  limit.mockResolvedValueOnce([]);
  expect(
    await repository.readCurrentExecution({
      tenantId: 'tenant-two',
      workItemId: 'WI-other',
      documentVersionId: 'DV-other',
    }),
  ).toBeNull();
});

function harness() {
  const authorize = jest.fn().mockResolvedValue({
    allowed: true,
    action: 'READ_DOCUMENT_PARSING',
    permissionSnapshotVersion: 'fresh-1',
  });
  const freshRead = jest
    .fn()
    .mockResolvedValue({ permissionSnapshotVersion: 'fresh-1' });
  const registrar = {
    getTenantScopedByWorkItemId: jest.fn().mockResolvedValue({
      source: { documentVersionId: 'DV-current' },
      revision: 3,
    }),
  };
  const database = { snapshot: true };
  const transaction = jest.fn(async (operation: (db: unknown) => Promise<unknown>) => operation(database));
  const repository = new JobAidWorkRepository({ transaction } as never, {} as never, {} as never);
  const work = Object.assign(repository, {
    latest: jest.fn().mockResolvedValue(null),
    readCurrentExecution: jest.fn().mockResolvedValue({
      status: 'QUEUED', attemptId: 'current-attempt', attemptRef: 'current-ref', activityJson: null,
    }),
    readSavedActivity: jest.fn().mockResolvedValue([]),
  });
  const service = new CanonicalJobAidProblemService(
    registrar as never,
    {} as never,
    {} as never,
    { authorize } as never,
    { freshRead } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    work as never,
  );
  const actor = {
    appId: 'app-test',
    tenantId: 'tenant-one',
    userId: 'owner',
    roles: [],
    env: 'test',
  };
  return { service, actor, work, authorize, freshRead, transaction, database };
}

it('reports the current attempt before the first save using the authorized document version', async () => {
  const f = harness();
  const result = await f.service.readBrowser('WI-one', f.actor);
  expect(result.current).toBeNull();
  expect(result.executionStatus).toBe('QUEUED');
  expect(f.work.readSavedActivity).toHaveBeenCalledWith({
    tenantId: 'tenant-one',
    workItemId: 'WI-one',
    documentVersionId: 'DV-current',
    actionAttemptId: 'current-attempt',
  }, f.database);
  expect(result.activity?.attemptRef).toBe('current-ref');
  expect(f.work.readCurrentExecution).toHaveBeenCalledWith({
    tenantId: 'tenant-one',
    workItemId: 'WI-one',
    documentVersionId: 'DV-current',
  }, f.database);
});

it('does not read attempt state when object permission or its fresh snapshot is denied', async () => {
  for (const mode of ['permission', 'snapshot']) {
    const f = harness();
    if (mode === 'permission')
      f.authorize.mockResolvedValue({ allowed: false });
    else
      f.freshRead.mockResolvedValue({ permissionSnapshotVersion: 'changed' });
    await expect(f.service.readBrowser('WI-one', f.actor)).rejects.toThrow();
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.work.latest).not.toHaveBeenCalled();
    expect(f.work.readCurrentExecution).not.toHaveBeenCalled();
    expect(f.work.readSavedActivity).not.toHaveBeenCalled();
  }
});

it('a new run status does not replace or derive from the previous saved work', async () => {
  const f = harness();
  const previous = {
    workRevisionRef: 'saved-old',
    actionAttemptId: 'old-failed',
    basedOnWorkItemRevision: 2,
    content: { evidence: [] },
  };
  f.work.latest.mockResolvedValue(previous);
  const checkEvidence = jest.fn().mockResolvedValue(undefined);
  Object.assign(f.service, { assertEvidenceOwned: checkEvidence });
  f.work.readCurrentExecution.mockResolvedValue({
    status: 'RUNNING',
    attemptId: 'current-attempt',
    attemptRef: 'current-ref',
    activityJson: null,
  });
  const result = await f.service.readBrowser('WI-one', f.actor);
  expect(checkEvidence).toHaveBeenCalledWith(
    [],
    'tenant-one',
    'owner',
    'WI-one',
  );
  expect(result.current).toBe(previous);
  expect(result.executionStatus).toBe('RUNNING');
  expect(result.currentInputChanged).toBe(true);
});

it('reads only bounded save receipts for the selected attempt and document scope', async () => {
  const limit = jest.fn().mockResolvedValue([]);
  const orderBy = jest.fn((..._orders: SQL[]) => ({ limit }));
  const where = jest.fn((_condition: SQL) => ({ orderBy }));
  const select = jest.fn((_fields: unknown) => ({ from: () => ({ where }) }));
  const repository = new JobAidWorkRepository(
    { select } as never,
    {} as never,
    {} as never,
  );
  await repository.readSavedActivity({
    tenantId: 'tenant',
    workItemId: 'WI',
    documentVersionId: 'DV',
    actionAttemptId: 'exact-attempt',
  });
  expect(Object.keys(select.mock.calls[0][0] as object)).toEqual([
    'workRevisionRef',
    'workRevision',
    'createdAt',
  ]);
  expect(new PgDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual([
    'tenant',
    'WI',
    'DV',
    'exact-attempt',
  ]);
  expect(limit).toHaveBeenCalledWith(51);
});

it('reads saved work after terminal status so the final save cannot be missed when polling stops', async () => {
  const f = harness();
  const finalWork = {
    workRevisionRef: 'final-work',
    basedOnWorkItemRevision: 3,
    content: { evidence: [] },
  };
  Object.assign(f.service, {
    assertEvidenceOwned: jest.fn().mockResolvedValue(undefined),
  });
  f.work.readCurrentExecution.mockImplementation(async () => {
    f.work.latest.mockResolvedValue(finalWork);
    return {
      status: 'SUCCEEDED',
      attemptId: 'current-attempt',
      attemptRef: 'current-ref',
      activityJson: null,
    };
  });
  const result = await f.service.readBrowser('WI-one', f.actor);
  expect(result.executionStatus).toBe('SUCCEEDED');
  expect(result.current).toBe(finalWork);
});


it.each([false, true])('keeps an old terminal snapshot coherent when a new run appears between reads (saved=%s)', async (saved) => {
  const f = harness();
  const oldWork = { workRevisionRef: 'old-work', actionAttemptId: 'old', basedOnWorkItemRevision: 3, content: { evidence: [] } };
  const newWork = { ...oldWork, workRevisionRef: 'new-work', actionAttemptId: 'new' };
  const oldExecution = { status: 'SUCCEEDED', attemptId: 'old', attemptRef: 'old-ref', activityJson: null };
  const newExecution = { ...oldExecution, status: 'RUNNING', attemptId: 'new', attemptRef: 'new-ref' };
  let liveWork = oldWork;
  let liveExecution = oldExecution;
  let snapshotWork = oldWork;
  let snapshotExecution = oldExecution;
  f.transaction.mockImplementation(async (operation) => {
    snapshotWork = liveWork;
    snapshotExecution = liveExecution;
    return operation(f.database);
  });
  f.work.readCurrentExecution.mockImplementation(async (_input, db) => {
    const observed = db === f.database ? snapshotExecution : liveExecution;
    // Another client starts the next run just after this SELECT.
    liveExecution = newExecution;
    if (saved) liveWork = newWork;
    return observed;
  });
  f.work.latest.mockImplementation(async (_input, db) => db === f.database ? snapshotWork : liveWork);
  Object.assign(f.service, { assertEvidenceOwned: jest.fn().mockResolvedValue(undefined) });
  const first = await f.service.readBrowser('WI-one', f.actor);
  expect(first.current).toBe(oldWork);
  expect(first.executionStatus).toBe('SUCCEEDED');
  expect(first.activity?.attemptRef).toBe('old-ref');
  expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: 'repeatable read', accessMode: 'read only',
  });
  expect(f.work.readSavedActivity).toHaveBeenLastCalledWith(expect.objectContaining({ actionAttemptId: 'old' }), f.database);
  const next = await f.service.readBrowser('WI-one', f.actor);
  expect(next.executionStatus).toBe('RUNNING');
  expect(next.current).toBe(saved ? newWork : oldWork);
  expect(next.activity?.attemptRef).toBe('new-ref');
  expect(f.work.readSavedActivity).toHaveBeenLastCalledWith(expect.objectContaining({ actionAttemptId: 'new' }), f.database);
});

it('runs all three real repository SELECTs on the same read-only snapshot connection', async () => {
  const execution = { status: 'RUNNING', attemptId: 'one', attemptRef: 'ref-one', activityJson: null };
  const receipt = { workRevisionRef: 'saved-one', workRevision: 1, createdAt: new Date('2026-09-23T00:00:00Z') };
  const limit = jest.fn().mockResolvedValueOnce([execution]).mockResolvedValueOnce([]).mockResolvedValueOnce([receipt]);
  const select = jest.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit }) }) }) }));
  const database = { select };
  const transaction = jest.fn(async (operation: (db: unknown) => Promise<unknown>) => operation(database));
  const outsideSelect = jest.fn(() => { throw new Error('READ_ESCAPED_SNAPSHOT'); });
  const repository = new JobAidWorkRepository({ transaction, select: outsideSelect } as never, {} as never, {} as never);
  const input = { tenantId: 'tenant', workItemId: 'WI', documentVersionId: 'DV' };
  await expect(repository.readBrowserSnapshot(input)).resolves.toEqual({ execution, current: null, savedActivity: [receipt] });
  expect(select).toHaveBeenCalledTimes(3);
  expect(outsideSelect).not.toHaveBeenCalled();
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), { accessMode: 'read only', isolationLevel: 'repeatable read' });
  limit.mockRejectedValueOnce(new Error('SNAPSHOT_READ_FAILED'));
  await expect(repository.readBrowserSnapshot(input)).rejects.toThrow('SNAPSHOT_READ_FAILED');
  expect(outsideSelect).not.toHaveBeenCalled();
});

it('still rejects saved evidence that is no longer authorized after the snapshot read', async () => {
  const f = harness();
  f.work.latest.mockResolvedValue({ content: { evidence: [] } });
  Object.assign(f.service, { assertEvidenceOwned: jest.fn().mockRejectedValue(new Error('SOURCE_REVOKED')) });
  await expect(f.service.readBrowser('WI-one', f.actor)).rejects.toThrow('SOURCE_REVOKED');
  expect(f.transaction).toHaveBeenCalledTimes(1);
});
