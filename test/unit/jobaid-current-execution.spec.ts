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
  const work = {
    latest: jest.fn().mockResolvedValue(null),
    readCurrentExecution: jest.fn().mockResolvedValue({
      status: 'QUEUED',
      attemptId: 'current-attempt',
      attemptRef: 'current-ref',
      activityJson: null,
    }),
    readSavedActivity: jest.fn().mockResolvedValue([]),
  };
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
  return { service, actor, work, authorize, freshRead };
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
  });
  expect(result.activity?.attemptRef).toBe('current-ref');
  expect(f.work.readCurrentExecution).toHaveBeenCalledWith({
    tenantId: 'tenant-one',
    workItemId: 'WI-one',
    documentVersionId: 'DV-current',
  });
});

it('does not read attempt state when object permission or its fresh snapshot is denied', async () => {
  for (const mode of ['permission', 'snapshot']) {
    const f = harness();
    if (mode === 'permission')
      f.authorize.mockResolvedValue({ allowed: false });
    else
      f.freshRead.mockResolvedValue({ permissionSnapshotVersion: 'changed' });
    await expect(f.service.readBrowser('WI-one', f.actor)).rejects.toThrow();
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
