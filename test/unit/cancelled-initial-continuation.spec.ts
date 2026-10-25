import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { SQL } from 'drizzle-orm';
import { actionAttempt, workItem } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CancelledAutoProcessingLeaseInput } from '../../server/modules/work-item/cancelled-auto-processing-lease';
import {
  canonicalJson,
  sealTaskEnvelope,
} from '../../server/modules/action-attempt/action-attempt-envelope';

import {
  assertCancelledInitialContinuation,
  readCancelledInitialContinuation,
} from '../../server/modules/action-attempt/cancelled-initial-continuation';
import { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
import { ActionAttemptRepository } from '../../server/modules/action-attempt/action-attempt.repository';

const NOW = new Date('2026-10-12T00:00:00.000Z');
const TOKEN = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';
const MODEL = {
  modelRef: 'miaoda/glm-5.3',
  displayName: 'GLM 5.3',
  providerKind: 'BUILT_IN' as const,
  settingsRevision: 1,
  selectedAt: NOW.toISOString(),
};

function fixture() {
  const task = sealTaskEnvelope({
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-old',
    operationRef: 'AQ-old',
    taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    priority: 100,
    tenantId: 'tenant-fixture',
    workItemId: 'WI-fixture',
    inputRevision: 3,
    baseRevision: 3,
    documentVersionId: 'DV-fixture',
    sourceRefs: [],
    allowedConnectors: [],
    hostResolvedMissingInputs: [],
    modelInput: { fixture: 'synthetic-control-only' },
    executionModel: MODEL,
    deadline: '2026-10-12T00:30:00.000Z',
    idempotencyKey: 'openclaw-v2:cancelled-fixture',
  });
  const source = {
    documentId: 'DOC-fixture',
    documentVersionId: 'DV-fixture',
    sourceArtifactId: 'ART-fixture',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 1024,
  };
  const owner = {
    ...source,
    tenantId: 'tenant-fixture',
    workItemId: 'WI-fixture',
    requestId: 'REQ-parse',
    revision: 3,
    requestedByUserId: 'actor-fixture',
    actionType: 'PARSE_PDF',
    status: 'CANDIDATE_READBACK_VERIFIED',
    packageId: 'PKG-fixture',
    packageArtifactRef: 'package.json',
    packageArtifactSha256: 'sha256:' + 'c'.repeat(64),
    analysisModelJson: canonicalJson(MODEL) as string | null,
    projectionJson: canonicalJson({
      workItemId: 'WI-fixture',
      requestId: 'REQ-parse',
      revision: 3,
      phase: 'CANDIDATE_READBACK_VERIFIED',
      source,
      package: {
        packageId: 'PKG-fixture',
        artifact: { ref: 'package.json', sha256: 'sha256:' + 'c'.repeat(64) },
      },
    }),
  };
  const target = {
    tenantId: owner.tenantId,
    actorUserId: owner.requestedByUserId,
    workItemId: owner.workItemId,
    documentVersionId: owner.documentVersionId,
    subjectKind: 'WORK_ITEM',
    requestOrigin: 'OPENCLAW_MCP_V1',
    status: 'CANCELLED',
    attemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    actionType: task.taskType,
    attemptNo: 6,
    triggerRequestId: 'REQ-job',
    inputRevision: 3,
    baseRevision: 3,
    taskInputHash: task.inputHash,
    taskEnvelopeJson: canonicalJson(task),
    idempotencyKey: task.idempotencyKey,
    executionModelJson: canonicalJson(MODEL),
    completedAt: NOW,
    createdAt: new Date(NOW.getTime() - 60000),
    projectionApplied: false,
    commitStartedAt: null,
    resultEnvelopeJson: null,
    resultContentHash: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
  };
  const attempts = [target];
  const grant = {
    ...source,
    tenantId: owner.tenantId,
    actorUserId: owner.requestedByUserId,
    workItemId: owner.workItemId,
    requestId: owner.requestId,
    grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
    status: 'BLOCKED',
    leaseOwner: null as string | null,
    leaseToken: null as string | null,
    leaseGeneration: 10,
    completedAt: null,
    leaseExpiresAt: null as Date | null,
    blockedAt: NOW as Date | null,
    blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED' as string | null,
    blockedLeaseTokenHash: 'f'.repeat(64) as string | null,
    blockedLeaseGeneration: 10 as number | null,
  };
  const input: CancelledAutoProcessingLeaseInput = {
    tenantId: owner.tenantId,
    workItemId: owner.workItemId,
    actorUserId: owner.requestedByUserId,
    leaseOwner: 'service:openclaw-main',
    leaseToken: TOKEN,
    leaseGeneration: 10,
    replayOnly: false,
    expectedCancellation: {
      ...source,
      requestId: owner.requestId,
      workItemRevision: 3,
      attemptId: target.attemptId,
      attemptRef: target.operationRef,
      attemptNo: target.attemptNo,
      attemptRequestId: target.triggerRequestId,
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      inputRevision: 3,
      baseRevision: 3,
      inputHash: task.inputHash,
      executionModel: MODEL,
    },
  };
  const sql: { sql: string; params: unknown[] }[] = [];
  const events: string[] = [];
  let beforeLock: (table: unknown) => Promise<void> = async () => {};
  const returning = jest.fn(async () => {
    grant.status = 'WAITING';
    events.push('WAITING');
    return [{ id: grant.workItemId }];
  });
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const builder = drizzle
            .mock()
            .select()
            .from(table as typeof workItem)
            .where(condition);
          const query = {
            limit: (count: number) => {
              builder.limit(count);
              return query;
            },
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(
                table === workItem
                  ? [owner]
                  : table === actionAttempt
                    ? attempts
                    : [grant],
              ).then(resolve),
            for: async (mode: 'update' | 'share') => {
              builder.for(mode);
              sql.push(builder.toSQL());
              events.push(
                table === workItem
                  ? 'WI_LOCK'
                  : table === actionAttempt
                    ? 'ATT_LOCK'
                    : 'GRANT_LOCK',
              );
              await beforeLock(table);
              return table === workItem
                ? [owner]
                : table === actionAttempt
                  ? attempts
                  : [grant];
            },
          };
          return query;
        },
      }),
    }),
    update: jest.fn((table: unknown) => {
      expect(table).toBe(autoWorkItemAuthorization);
      return {
        set: (values: Record<string, unknown>) => {
          expect(Object.keys(values).sort()).toEqual(['status', 'updatedAt']);
          return {
            where: (condition: SQL) => {
              sql.push(
                drizzle
                  .mock()
                  .update(autoWorkItemAuthorization)
                  .set(values)
                  .where(condition)
                  .toSQL(),
              );
              return { returning };
            },
          };
        },
      };
    }),
    transaction: jest.fn(async (perform: (tx: unknown) => Promise<unknown>) =>
      perform(db),
    ),
  };
  const repository = new MiaodaWorkItemRepository(db as never);
  return {
    owner,
    target,
    attempts,
    grant,
    input,
    repository,
    db,
    returning,
    sql,
    events,
    setBeforeLock: (perform: typeof beforeLock) => {
      beforeLock = perform;
    },
  };
}

function eligibility(f: Pick<ReturnType<typeof fixture>, 'owner'>) {
  return {
    tenantId: f.owner.tenantId,
    actorUserId: f.owner.requestedByUserId,
    workItem: JSON.parse(f.owner.projectionJson),
  };
}

function failJobAid<F extends Pick<ReturnType<typeof fixture>, 'target' | 'grant' | 'owner'>>(
  f: F, status = 'TIMED_OUT',
): F {
  f.target.status = status;
  f.grant.blockedCode = 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED';
  // The persisted blocking lease may be later than the failed task's lease.
  return f;
}
beforeEach(() =>
  jest
    .spyOn(MiaodaDocumentVersionSourceResolver.prototype, 'resolve')
    .mockResolvedValue({
      version: {
        documentId: 'DOC-fixture',
        sourceArtifactId: 'ART-fixture',
        pdfSha256: 'a'.repeat(64),
        byteLength: 1024,
      },
    } as never),
);
afterEach(() => jest.restoreAllMocks());

test.each(['FAILED', 'TIMED_OUT'])(
  'allows only an exact %s successor and inherits the stored initial model without changing history',
  async (terminalStatus) => {
    const f = failJobAid(fixture(), terminalStatus);
    f.owner.analysisModelJson = null;
    const before = canonicalJson({ owner: f.owner, attempts: f.attempts });
    const value = await readCancelledInitialContinuation(f.db as never, eligibility(f));
    expect(value!.binding).toMatchObject({
      terminalStatus, blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED',
      leaseGeneration: 10, executionModel: MODEL,
    });
    const release = await assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding, authorize: async () => {},
    });
    await release();
    expect(f.grant.status).toBe('WAITING');
    expect(f.grant.blockedCode).toBe('AUTO_WORK_ITEM_STAGE_JOBAID_FAILED');
    expect(canonicalJson({ owner: f.owner, attempts: f.attempts })).toBe(before);
  },
);

test('keeps the failed task model self-consistent while inheriting the earliest initial selection', async () => {
  const f = failJobAid(fixture());
  f.owner.analysisModelJson = null;
  const inherited = { ...MODEL, selectedAt: '2026-10-11T00:00:00.000Z' };
  f.attempts.push({ ...f.target, attemptId: 'ATT-earliest',
    createdAt: new Date(NOW.getTime() - 120000), attemptNo: 5,
    executionModelJson: canonicalJson(inherited) });
  const value = await readCancelledInitialContinuation(f.db as never, eligibility(f));
  expect(value?.binding.executionModel).toEqual(inherited);
  f.target.executionModelJson = canonicalJson(inherited);
  expect(await readCancelledInitialContinuation(f.db as never, eligibility(f))).toBeNull();
});

test.each([
  { status: 'CONFLICT' }, { status: 'OBSOLETE' }, { status: 'CANCELLED' },
  { actionType: 'OPENCLAW_OVERALL_SYNTHESIS' }, { documentVersionId: 'DV-other' },
  { inputRevision: 2 }, { baseRevision: 2 }, { completedAt: null },
  { commitStartedAt: NOW }, { projectionApplied: true },
  { resultEnvelopeJson: '{}' }, { resultContentHash: 'b'.repeat(64) },
  { leaseOwner: 'stale-owner' }, { taskInputHash: 'changed' },
  { triggerRequestId: '' },
])('rejects a failed successor outside the exact terminal binding: %j', async change => {
  const f = failJobAid(fixture());
  Object.assign(f.target, change);
  expect(await readCancelledInitialContinuation(f.db as never, eligibility(f))).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

test.each([
  { blockedCode: 'AUTO_WORK_ITEM_STAGE_OVERALL_FAILED' },
  { status: 'COMPLETED' }, { blockedAt: null },
  { blockedAt: new Date(NOW.getTime() - 1) },
  { blockedLeaseTokenHash: 'invalid' }, { blockedLeaseGeneration: 11 },
  { leaseToken: TOKEN }, { leaseExpiresAt: NOW }, { completedAt: NOW },
])('requires the complete current failure receipt: %j', async change => {
  const f = failJobAid(fixture());
  Object.assign(f.grant, change);
  expect(await readCancelledInitialContinuation(f.db as never, eligibility(f))).toBeNull();
});

test.each(['generation', 'blockedAt'])(
  'rechecks the original %s under lock instead of accepting a replaced block', async field => {
    const f = failJobAid(fixture());
    const value = await readCancelledInitialContinuation(f.db as never, eligibility(f));
    if (field === 'generation') {
      f.grant.leaseGeneration += 1; f.grant.blockedLeaseGeneration = f.grant.leaseGeneration;
    } else f.grant.blockedAt = new Date(NOW.getTime() + 1);
    await expect(assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding, authorize: async () => {},
    })).rejects.toThrow('BINDING_CHANGED');
    expect(f.db.update).not.toHaveBeenCalled();
  },
);

test('locks WI then original grant then latest cancelled attempts; exact source and fresh ACL precede WAITING without changing history', async () => {
  const f = fixture();
  const before = canonicalJson({ owner: f.owner, attempts: f.attempts });
  const value = await readCancelledInitialContinuation(
    f.db as never,
    eligibility(f),
  );
  expect(value).not.toBeNull();
  const authorize = jest.fn(async () => {});
  const release = await assertCancelledInitialContinuation(f.db as never, {
    binding: value!.binding,
    authorize,
  });
  expect(f.events).toEqual(['WI_LOCK', 'GRANT_LOCK', 'ATT_LOCK']);
  expect(f.db.update).not.toHaveBeenCalled();
  await release();
  expect(f.events).toEqual(['WI_LOCK', 'GRANT_LOCK', 'ATT_LOCK', 'WAITING']);
  expect(authorize).toHaveBeenCalledWith(f.db);
  expect(f.grant.status).toBe('WAITING');
  expect(f.grant.blockedCode).toBe('AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED');
  expect(canonicalJson({ owner: f.owner, attempts: f.attempts })).toBe(before);
  expect(f.sql[2].sql).toMatch(/for share$/u);
  expect(f.sql[3].params).toContain('BLOCKED');
});
test.each([
  { revision: 4 },
  { requestedByUserId: 'other' },
  { documentVersionId: 'DV-new' },
  { sourceFileSha256: 'b'.repeat(64) },
  { packageArtifactSha256: 'sha256:' + 'd'.repeat(64) },
  { analysisModelJson: canonicalJson({ ...MODEL, settingsRevision: 2 }) },
])('rejects fresh owner/source/package/model drift %j', async (change) => {
  const f = fixture(),
    input = eligibility(f);
  Object.assign(f.owner, change);
  expect(
    await readCancelledInitialContinuation(f.db as never, input),
  ).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});
test.each(['FAILED', 'COMMITTING', 'RUNNING', 'SUCCEEDED'])(
  'rejects non-cancelled %s',
  async (status) => {
    const f = fixture();
    f.target.status = status;
    expect(
      await readCancelledInitialContinuation(f.db as never, eligibility(f)),
    ).toBeNull();
  },
);
test.each(['FAILED', 'CANCELLED', 'QUEUED', 'COMMITTING'])(
  'rejects any newer %s attempt',
  async (status) => {
    const f = fixture();
    f.attempts.push({
      ...f.target,
      attemptId: 'ATT-new',
      status,
      createdAt: NOW,
    });
    expect(
      await readCancelledInitialContinuation(f.db as never, eligibility(f)),
    ).toBeNull();
  },
);
test.each([
  { blockedCode: 'DIFFERENT' },
  { status: 'COMPLETED' },
  { leaseOwner: 'service:other' },
  { blockedLeaseGeneration: 9 },
])('rejects grant outside exact parked scope %j', async (change) => {
  const f = fixture();
  Object.assign(f.grant, change);
  expect(
    await readCancelledInitialContinuation(f.db as never, eligibility(f)),
  ).toBeNull();
});
test('changed sealed task, revoked ACL and changed current source cannot requeue', async () => {
  const f = fixture();
  const value = await readCancelledInitialContinuation(
    f.db as never,
    eligibility(f),
  );
  await expect(
    assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding,
      authorize: async () => {
        throw new Error('REVOKED');
      },
    }),
  ).rejects.toThrow('REVOKED');
  expect(f.db.update).not.toHaveBeenCalled();
  jest
    .mocked(MiaodaDocumentVersionSourceResolver.prototype.resolve)
    .mockResolvedValueOnce({ version: { documentId: 'DOC-other' } } as never);
  await expect(
    assertCancelledInitialContinuation(f.db as never, {
      binding: value!.binding,
      authorize: async () => {},
    }),
  ).rejects.toThrow('BINDING_CHANGED');
  const task = JSON.parse(f.target.taskEnvelopeJson);
  task.modelInput = { changed: true };
  f.target.taskEnvelopeJson = JSON.stringify(task);
  expect(
    await readCancelledInitialContinuation(f.db as never, eligibility(f)),
  ).toBeNull();
  expect(f.db.update).not.toHaveBeenCalled();
});

function reservationFixture() {
  const f = fixture();
  const events: string[] = [];
  let tail = Promise.resolve();
  const database = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const params = drizzle
            .mock()
            .select()
            .from(table as typeof workItem)
            .where(condition)
            .toSQL().params;
          let limited = false;
          const rows = () =>
            table === workItem
              ? [
                  {
                    ...f.owner,
                    id: f.owner.workItemId,
                    initialAilySessionId: null,
                  },
                ]
              : table === autoWorkItemAuthorization
                ? [f.grant]
                : limited
                  ? f.attempts.filter(
                      (row) =>
                        params.includes(row.idempotencyKey) ||
                        ([
                          'QUEUED',
                          'RUNNING',
                          'RETRY_SCHEDULED',
                          'COMMITTING',
                        ].includes(row.status) &&
                          params.includes(row.status)),
                    )
                  : f.attempts;
          const query = {
            limit: () => {
              limited = true;
              return query;
            },
            orderBy: () => query,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(rows()).then(resolve),
            for: async (mode: string) => {
              events.push(
                table === workItem
                  ? 'WI:' + mode
                  : table === autoWorkItemAuthorization
                    ? 'GRANT:' + mode
                    : 'ATT:' + mode,
              );
              return rows();
            },
          };
          void fields;
          return query;
        },
      }),
    }),
    update: f.db.update,
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const count = f.attempts.length,
        status = f.grant.status;
      try {
        return await run(database);
      } catch (error) {
        f.attempts.splice(count);
        f.grant.status = status;
        throw error;
      } finally {
        release();
      }
    },
  };
  const repository = new ActionAttemptRepository(database as never);
  const insert = jest
    .spyOn(repository as never, 'insertReservation' as never)
    .mockImplementation((async (attempt: unknown) => {
      f.attempts.push(attempt as typeof f.target);
      return { row: attempt, created: true };
    }) as never);
  const attempt = {
    ...f.target,
    attemptId: 'ATT-new',
    operationRef: 'AQ-new',
    attemptNo: 7,
    status: 'QUEUED',
    completedAt: null,
    createdAt: NOW,
    idempotencyKey: 'openclaw-v2:dynamic:WI-fixture:DV-fixture:request-new',
  };
  return { ...f, repository, insert, attempt, events, database };
}
test.each(['CANCELLED', 'FAILED', 'TIMED_OUT'])('same request concurrent %s reserve queues one successor atomically; different request is rejected and old JA/attempt/source stay unchanged', async status => {
  const f = reservationFixture();
  if (status !== 'CANCELLED') failJobAid(f, status);
  const before = canonicalJson(f.target);
  const value = await readCancelledInitialContinuation(
    f.database as never,
    eligibility(f),
  );
  const guard = { binding: value!.binding, authorize: jest.fn(async () => {}) };
  const results = await Promise.all([
    f.repository.reserve(f.attempt as never, undefined, guard),
    f.repository.reserve(f.attempt as never, undefined, guard),
  ]);
  expect(results.map((row) => row.created)).toEqual([true, false]);
  expect(f.insert).toHaveBeenCalledTimes(1);
  expect(f.grant.status).toBe('WAITING');
  expect(f.attempts).toHaveLength(2);
  expect(canonicalJson(f.target)).toBe(before);
  expect(f.events.slice(0, 4)).toEqual([
    'WI:update',
    'WI:update',
    'GRANT:update',
    'ATT:share',
  ]);
  await expect(
    f.repository.reserve(
      {
        ...f.attempt,
        attemptId: 'ATT-different',
        idempotencyKey: 'openclaw-v2:request-other',
      } as never,
      undefined,
      guard,
    ),
  ).rejects.toMatchObject({ code: 'ACTION_ATTEMPT_ACTIVE_CONFLICT' });
  expect(f.attempts).toHaveLength(2);
});
test.each(['CANCELLED', 'FAILED', 'TIMED_OUT'])('failed grant CAS rolls back the %s reservation and does not change the parked grant/history', async status => {
  const f = reservationFixture();
  if (status !== 'CANCELLED') failJobAid(f, status);
  const value = await readCancelledInitialContinuation(
    f.database as never,
    eligibility(f),
  );
  f.returning.mockResolvedValueOnce([]);
  await expect(
    f.repository.reserve(f.attempt as never, undefined, {
      binding: value!.binding,
      authorize: async () => {},
    }),
  ).rejects.toThrow('BINDING_CHANGED');
  expect(f.grant.status).toBe('BLOCKED');
  expect(f.attempts).toHaveLength(1);
  expect(f.target.status).toBe(status);
});
