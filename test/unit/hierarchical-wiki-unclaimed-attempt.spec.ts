import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import {
  emptyWikiDemand,
  wikiDemandState,
} from '../../server/modules/canonical-host/hierarchical-wiki-demand';
import { reconcileWikiReservations } from '../../server/modules/canonical-host/hierarchical-wiki-attempt-reconciliation';
import type {
  DerivedSummaryRepository,
  SummaryAttempt,
} from '../../server/modules/canonical-host/derived-summary.repository';
import type { WikiRow } from '../../server/modules/canonical-host/hierarchical-wiki.persistence';
import type { SummaryActor } from '../../server/modules/canonical-host/derived-summary-members.service';
import { wikiStatusLabels } from '../../client/src/features/derived-summary/hierarchical-wiki-presentation';

const owner: SummaryActor = {
  tenantId: 'wiki-test-tenant',
  actorUserId: 'wiki-test-actor',
};
const now: string = '2026-10-14T08:00:00.000Z';
const deadline: Date = new Date('2026-10-14T07:16:05.014Z');
const sealedOriginalTask: string = JSON.stringify({ schemaVersion: 'synthetic-wiki-task.v1', modelInput: {} });
const member = {
  kind: 'MATTER_WORK' as const,
  matterId: 'MAT-source',
  workRef: 'MW-source',
  workRevision: 1,
  issueKeys: [],
};

function request(index = 1): SummaryAttempt {
  return {
    id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
    attemptId: `ATT-${index}`,
    operationRef: `AQ-${index}`,
    summaryId: `DS-${index}`,
    ...owner,
    subjectKind: 'DERIVED_SUMMARY',
    actionType: 'OPENCLAW_DERIVED_SUMMARY',
    attemptNo: 1,
    triggerRequestId: `wiki-${index}`,
    requestOrigin: 'MCP_GATEWAY',
    status: 'QUEUED',
    claimCount: 0,
    retryCount: 0,
    maxAttempts: 3,
    leaseGeneration: 0,
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    executorSessionKey: null,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    leaseSlot: null,
    commitStartedAt: null,
    resultEnvelopeJson: null,
    resultContentHash: null,
    projectionApplied: false,
    cancelRequestedAt: null,
    cancelReason: null,
    nextAttemptAt: null,
    terminalReason: null,
    errorCode: null,
    errorMessage: null,
    deadlineAt: deadline,
    createdAt: new Date('2026-10-14T06:16:05.014Z'),
    updatedAt: new Date('2026-10-14T06:16:05.014Z'),
    workItemId: null,
    matterId: null,
    matterRevisionId: null,
    documentVersionId: null,
    producerRunId: null,
    packageArtifactRef: null,
    packageArtifactSha256: null,
    failureArtifactRef: null,
    failureArtifactSha256: null,
    priority: 100,
    inputRevision: 0,
    baseRevision: 0,
    taskEnvelopeJson: sealedOriginalTask,
    taskInputHash: 'a'.repeat(64),
    executionModelJson: '{"modelRef":"miaoda/glm-5.3"}',
    idempotencyKey: `request-${index}`,
    requestCommandJson: 'sealed-original-request',
    delegatedPrincipalId: 'wiki-test-principal',
    reviewActivityJson: null,
    createdBy: null,
    updatedBy: null,
  };
}

function registry(index = 1): WikiRow {
  return {
    wikiId: `WIKI-${index}`,
    summaryId: `DS-${index}`,
    ...owner,
    scope: {
      kind: index === 1 ? 'FLEET' : 'ATA4',
      title: 'B787',
      fleetFamilyId: 'B787',
      fleetModelIds: [],
      ata2: index === 1 ? null : '45',
      ata4: index === 1 ? null : '45-00',
      selectionReason: 'confirmed',
    },
    parentWikiId: index === 1 ? null : 'WIKI-1',
    principalId: 'wiki-test-principal',
    modelRef: 'miaoda/glm-5.3',
    enabled: true,
    lastEventSeq: '0',
    lastInventoryAt: now,
    inventoryCursor: null,
    upstreamDelegations: {},
    state: {
      ...emptyWikiDemand(),
      desiredGeneration: 1,
      firstDirtyAt: '2026-10-14T06:00:00.000Z',
      dueAt: '2026-10-14T06:05:00.000Z',
      versions: { selected: member },
      active: {
        requestId: `wiki-${index}`,
        attemptRef: `AQ-${index}`,
        generation: 1,
        versions: { selected: member },
        waiting: [],
      },
    },
  };
}

/** Real installed Drizzle generates the row lock and ActionAttempt CAS SQL.
 * The sink emulates storage/interleavings only; no online database or model is used. */
function setup(count = 1) {
  const attempts: Map<string, SummaryAttempt> = new Map(
    Array.from({ length: count }, (_v: unknown, i: number) => [
      `AQ-${i + 1}`,
      request(i + 1),
    ]),
  );
  const rows: WikiRow[] = Array.from(
    { length: count },
    (_v: unknown, i: number) => registry(i + 1),
  );
  const saved: Set<string> = new Set();
  const calls: Array<{ query: string; params: unknown[] }> = [];
  let onLock: (() => void) | undefined;
  let onRegistryLock: (() => void) | undefined;
  let rejectCas: boolean = false;
  const result = (
    query: string,
    params: unknown[],
  ): Record<string, unknown>[] => {
    calls.push({ query, params });
    if (query.includes('"action_attempt"') && query.includes('for update')) {
      onLock?.();
      return [{ id: params[0] }];
    }
    if (query.includes('from "action_attempt"') && query.includes('automaticWorkItemLease')) {
      const attempt = [...attempts.values()].find(item => params.includes(item.attemptId));
      if (!attempt) return [];
      // Same finite control projection as withAutomaticAttemptLease, in its
      // SELECT order. Return the real synthetic task's subfield, not a bypass.
      const keys: Array<keyof SummaryAttempt> = ['attemptId', 'operationRef', 'tenantId', 'workItemId',
        'actionType', 'requestOrigin', 'documentVersionId', 'leaseOwner', 'leaseToken', 'leaseGeneration',
        'leaseExpiresAt', 'deadlineAt', 'status', 'cancelRequestedAt', 'cancelReason', 'commitStartedAt',
        'projectionApplied', 'terminalReason'];
      const controls = Object.fromEntries(keys.map(key => [key,
        Object.prototype.toString.call(attempt[key]) === '[object Date]'
          ? (attempt[key] as Date).toISOString() : attempt[key]]));
      const task = JSON.parse(attempt.taskEnvelopeJson!);
      return [{ ...controls, automaticLease: task.modelInput?.automaticWorkItemLease === undefined
        ? null : JSON.stringify(task.modelInput.automaticWorkItemLease) }];
    }
    if (query.startsWith('update "action_attempt"')) {
      const attempt: SummaryAttempt | undefined = [...attempts.values()].find(
        (item: SummaryAttempt) => params.includes(item.attemptId),
      );
      if (
        !attempt ||
        rejectCas ||
        attempt.status !== 'QUEUED' ||
        attempt.leaseGeneration !== 0
      )
        return [];
      attempt.status = 'TIMED_OUT';
      attempt.terminalReason ??= 'DERIVED_SUMMARY_DEADLINE_EXCEEDED';
      attempt.errorCode ??= 'DERIVED_SUMMARY_DEADLINE_EXCEEDED';
      attempt.completedAt = new Date(now);
      attempt.updatedAt = new Date(now);
      return [{ attemptId: attempt.attemptId }];
    }
    if (query.includes('"derived_summary_revision"'))
      return params.some(
        (value: unknown) => typeof value === 'string' && saved.has(value),
      )
        ? [{ ref: 'DSR-saved' }]
        : [];
    if (query.includes('hierarchical_wiki_runtime_owners'))
      return rows.some((row) => row.enabled && row.principalId === 'wiki-test-principal')
        ? [{ actorUserId: owner.actorUserId }] : [];
    if (query.includes('UPDATE hierarchical_wiki_scope SET enabled=')) {
      for (const row of rows)
        if (row.wikiId === params[1] || (params[2] === true
          && row.scope.fleetFamilyId === params[5]
          && JSON.stringify(row.scope.fleetModelIds) === params[6])) row.enabled = params[0] as boolean;
      return [];
    }
    if (query.includes('UPDATE hierarchical_wiki_scope SET state_json')) {
      rows.find((row: WikiRow) => row.wikiId === params[1])!.state = JSON.parse(
        params[0] as string,
      );
      return [];
    }
    if (query.includes('FROM hierarchical_wiki_scope')) {
      if (query.includes('FOR UPDATE')) onRegistryLock?.();
      let selected: WikiRow[] = rows.filter((row: WikiRow) =>
        params.includes(row.tenantId),
      );
      // Only the directory WHERE clause narrows the requesting actor; the
      // saved-head JOIN also compares actor_user_id without adding a parameter.
      if (query.includes('AND actor_user_id='))
        selected = selected.filter((row: WikiRow) =>
          params.includes(row.actorUserId),
        );
      if (query.includes("scope_json->>'kind'='FLEET'"))
        selected = selected.filter(
          (row: WikiRow) => row.scope.kind === 'FLEET',
        );
      if (query.includes('WHERE wiki_id='))
        selected = selected.filter((row: WikiRow) =>
          params.includes(row.wikiId),
        );
      return structuredClone(selected);
    }
    if (query.includes('AS allowed')) return [{ allowed: true }];
    if (query.includes('FROM hierarchical_wiki_membership')) return [];
    throw new Error('UNEXPECTED_WIKI_TEST_QUERY');
  };
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: (query: string, params: unknown[]) => {
      const selected: Record<string, unknown>[] = result(query, params);
      return Object.assign(Promise.resolve(selected), {
        values: async () =>
          selected.map((row: Record<string, unknown>) => Object.values(row)),
      });
    },
  };
  // Keep Drizzle's actual transaction and nested-savepoint code. This sink
  // supplies only the driver's local protocol; the repository guard/CAS run.
  const driverTransactions = {
    begin: jest.fn(async (operation: (connection: typeof client) => Promise<unknown>) => operation(client)),
    savepoint: jest.fn(async (operation: (connection: typeof client) => Promise<unknown>) => operation(client)),
  };
  Object.assign(client, driverTransactions);
  const database: PostgresJsDatabase = drizzle(client as never);
  const transaction = jest.fn(
    async (
      _actor: unknown,
      operation: (
        db: PostgresJsDatabase,
        actor: SummaryActor,
      ) => Promise<unknown>,
    ) => {
      const beforeAttempts: Map<string, SummaryAttempt> =
        structuredClone(attempts);
      const beforeRows: WikiRow[] = structuredClone(rows);
      try {
        return await database.transaction(tx => operation(tx as PostgresJsDatabase, owner));
      } catch (error) {
        attempts.clear();
        for (const [key, attempt] of beforeAttempts) attempts.set(key, attempt);
        rows.splice(0, rows.length, ...beforeRows);
        throw error;
      }
    },
  );
  const repository = {
    attempt: jest.fn(async (_summaryId: string, ref: string) =>
      structuredClone(attempts.get(ref)!),
    ),
    head: jest.fn(async (summaryId: string) => ({
      summaryId,
      ...owner,
      currentRevision: 0,
      currentSummaryRef: null,
    })),
    browser: transaction,
    readBrowser: jest.fn(
      async (
        _actor: unknown,
        operation: (
          db: PostgresJsDatabase,
          actor: SummaryActor,
        ) => Promise<unknown>,
      ) => operation(database, { ...owner, readScope: 'TENANT' }),
    ),
  };
  const summaries = {
    reserve: jest.fn(async () => {
      throw new Error('UNEXPECTED_NEW_WIKI_REQUEST');
    }),
  };
  const members = {
    authorizeActor: jest.fn(async () => undefined),
    readAll: jest.fn(async () => []),
  };
  const runtimeTransaction = jest.fn(
    async (
      _actor: string,
      operation: (executor: {
        database: PostgresJsDatabase;
      }) => Promise<unknown>,
    ) => transaction(_actor, db => operation({ database: db })),
  );
  const service = new HierarchicalWikiService(
    database,
    repository as never,
    summaries as never,
    members as never,
    { withActorTransaction: runtimeTransaction } as never,
    {} as never,
    {
      authorizeOpenClawAutoWorkItemQueue: async () => ({
        appId: 'app_17bzc551rsg',
        ...owner,
        principalId: 'wiki-test-principal',
      }),
    } as never,
  );
  Object.assign(service, { refresh: jest.fn(async () => undefined) });
  return {
    attempts,
    rows,
    saved,
    calls,
    database,
    repository,
    service,
    summaries,
    runtimeTransaction,
    driverTransactions,
    expire: () =>
      transaction({}, db =>
        reconcileWikiReservations(
          db,
          repository as unknown as DerivedSummaryRepository,
          owner,
          rows,
          now,
        ),
      ),
    onLock: (action: () => void) => {
      onLock = action;
    },
    onRegistryLock: (action: () => void) => {
      onRegistryLock = action;
    },
    rejectCas: () => {
      rejectCas = true;
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(now));
});
afterEach(() => jest.useRealTimers());

test.each(['QUEUED', 'FAILED', 'TIMED_OUT', 'SUCCEEDED'])(
  'repeated GET keeps the actual %s attempt and reservation byte-for-byte without entering a writer', async status => {
    const f = setup();
    f.attempts.get('AQ-1')!.status = status;
    // Native structuredClone(Map) crosses Jest's VM realm. Compare the entire
    // persisted data (all keys/fields and ISO dates), not Map constructors.
    const attempts = JSON.stringify([...f.attempts]), rows = JSON.stringify(f.rows);
    await f.service.list({ userId: owner.actorUserId } as never);
    await f.service.list({ userId: owner.actorUserId } as never);
    expect(JSON.stringify([...f.attempts])).toBe(attempts);
    expect(JSON.stringify(f.rows)).toBe(rows);
    expect(f.repository.browser).not.toHaveBeenCalled();
    expect(f.calls.every(call => !/\b(?:update|insert|delete)\b|for\s+update/iu.test(call.query))).toBe(true);
    expect(f.summaries.reserve).not.toHaveBeenCalled();
  },
);

test('explicit owner pause records the original unclaimed hard deadline and releases only that reservation', async () => {
  const f = setup(),
    original: SummaryAttempt = structuredClone(f.attempts.get('AQ-1')!);
  const listing = await f.service.update('DS-1', { enabled: false }, { userId: owner.actorUserId } as never);
  expect(f.attempts.get('AQ-1')).toEqual({
    ...original,
    status: 'TIMED_OUT',
    terminalReason: 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
    errorCode: 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
    completedAt: new Date(now),
    updatedAt: new Date(now),
  });
  expect(f.rows[0]!.state).toMatchObject({
    active: null,
    retryCount: 1,
    dueAt: '2026-10-14T08:05:00.000Z',
    lastAttemptErrorCode: 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
  });
  expect(listing.items[0]).toMatchObject({
    state: 'PENDING',
    errorCode: 'DERIVED_SUMMARY_DEADLINE_EXCEEDED',
  });
  expect(f.summaries.reserve).not.toHaveBeenCalled();
  const cas = f.calls.find((call) =>
    call.query.startsWith('update "action_attempt"'),
  )!;
  expect(cas.query).toContain('"status" =');
  expect(cas.query).toContain('"lease_generation" =');
  expect(cas.params).toEqual(
    expect.arrayContaining(['QUEUED', 0, 'TIMED_OUT', original.attemptId]),
  );
  expect(
    f.calls.find((call) => call.query.includes('for update'))!.params,
  ).toEqual([original.attemptId, owner.tenantId, owner.actorUserId]);
  expect(f.driverTransactions.begin).toHaveBeenCalledTimes(1);
  expect(f.driverTransactions.savepoint).toHaveBeenCalledTimes(1);
  const guardRead = f.calls.findIndex(call => call.query.includes('automaticWorkItemLease'));
  expect(guardRead).toBeGreaterThanOrEqual(0);
  expect(guardRead)
    .toBeLessThan(f.calls.findIndex(call => call.query.startsWith('update "action_attempt"')));
});

test('the real terminal guard rejects malformed stored automatic lease before CAS and rolls back', async () => {
  const f = setup();
  f.attempts.get('AQ-1')!.taskEnvelopeJson = JSON.stringify({ modelInput: {
    automaticWorkItemLease: { requestId: 'synthetic-missing-generation' },
  } });
  const original = structuredClone(f.attempts.get('AQ-1')!);
  await expect(f.expire()).rejects.toThrow('AUTO_WORK_ITEM_TASK_LEASE_BINDING_INVALID');
  expect(f.attempts.get('AQ-1')).toEqual(original);
  expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
  expect(f.calls.some(call => call.query.startsWith('update "action_attempt"'))).toBe(false);
});

test('normal next commits expiration and uses the existing retry window rather than re-reserving in the same tick', async () => {
  const f = setup();
  f.rows[0]!.state.dueAt = '2026-10-15T08:00:00.000Z';
  expect(await f.service.next(now)).toEqual({ status: 'IDLE' });
  expect(f.attempts.get('AQ-1')!.status).toBe('TIMED_OUT');
  expect(f.rows[0]!.state.active).toBeNull();
  expect(f.runtimeTransaction).toHaveBeenCalledWith(
    owner.actorUserId,
    expect.any(Function),
  );
  expect(f.summaries.reserve).not.toHaveBeenCalled();
});

test('GET projects actual child progress and only an explicit child update exposes its expiration', async () => {
  const f = setup(2);
  f.rows[0]!.state.active = null;
  f.rows[0]!.state.waiting = [
    {
      kind: 'SUMMARY',
      subjectId: 'DS-2',
      requestId: 'wiki-2',
      documentVersionId: null,
      status: 'RUNNING',
    },
  ];
  f.rows[0]!.state.lastCheckedAt = '2026-10-14T07:41:24.322Z';
  const before = await f.service.list({ userId: owner.actorUserId } as never);
  expect(before.items[0]!.waiting[0]).toMatchObject({ status: 'QUEUED', requestId: 'wiki-2' });
  expect(f.repository.browser).not.toHaveBeenCalled();
  const listing = await f.service.update('DS-2', { enabled: false }, { userId: owner.actorUserId } as never);
  expect(listing.items[0]!.waiting[0]).toMatchObject({
    status: 'PENDING',
    requestId: null,
  });
  expect(listing.items[0]!.lastCheckedAt).toBe('2026-10-14T07:41:24.322Z');
  expect(f.rows[0]!.state.waiting[0]!.status).toBe('RUNNING');
});

test.each(['disabled', 'other-principal'])(
  '%s reservation stays outside next but its owner can explicitly maintain it without changing its principal', async condition => {
    const f = setup();
    if (condition === 'disabled') f.rows[0]!.enabled = false;
    else {
      f.rows[0]!.principalId = 'original-other-principal';
      f.attempts.get('AQ-1')!.delegatedPrincipalId = 'original-other-principal';
    }
    const original = structuredClone(f.attempts.get('AQ-1')!);
    await f.service.list({ userId: owner.actorUserId } as never);
    expect(await f.service.next(now)).toEqual({ status: 'IDLE' });
    expect(f.attempts.get('AQ-1')).toEqual(original);
    expect(f.repository.browser).not.toHaveBeenCalled();
    await f.service.update('DS-1', { enabled: condition === 'disabled' }, { userId: owner.actorUserId } as never);
    expect(f.attempts.get('AQ-1')!.status).toBe('TIMED_OUT');
    expect(f.attempts.get('AQ-1')!.delegatedPrincipalId).toBe(original.delegatedPrincipalId);
    expect(f.rows[0]!.state).toMatchObject({ active: null, retryCount: 1, dueAt: '2026-10-14T08:05:00.000Z' });
    expect(f.rows[0]!.enabled).toBe(condition === 'disabled');
    expect(f.summaries.reserve).not.toHaveBeenCalled();
  },
);

test('explicit child maintenance does not reconcile another branch or turn a tenant read into owner authority', async () => {
  const f = setup(2), original = structuredClone(f.attempts.get('AQ-1')!);
  await f.service.update('DS-2', { enabled: false }, { userId: owner.actorUserId } as never);
  expect(f.attempts.get('AQ-2')!.status).toBe('TIMED_OUT');
  expect(f.attempts.get('AQ-1')).toEqual(original);
  expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
  await expect(f.service.update('DS-unowned', { enabled: false }, {} as never)).rejects.toThrow('WIKI_UNAVAILABLE');
  expect(f.attempts.get('AQ-1')).toEqual(original);
});

test('an inactive owner can read without maintenance but the original owner writer still rejects', async () => {
  const f = setup(), original = structuredClone(f.attempts.get('AQ-1')!);
  f.repository.browser.mockRejectedValue(new Error('DERIVED_SUMMARY_ACTOR_UNAVAILABLE'));
  expect((await f.service.list({ userId: owner.actorUserId } as never)).items[0]!.state).toBe('QUEUED');
  expect(f.repository.browser).not.toHaveBeenCalled();
  await expect(f.service.update('DS-1', { enabled: false }, {} as never)).rejects.toThrow('DERIVED_SUMMARY_ACTOR_UNAVAILABLE');
  expect(f.attempts.get('AQ-1')).toEqual(original);
});

test('a normal QUEUED request remains unchanged and renders as waiting for execution', async () => {
  const f = setup();
  f.attempts.get('AQ-1')!.deadlineAt = new Date('2026-10-14T09:00:00.000Z');
  const original: SummaryAttempt = structuredClone(f.attempts.get('AQ-1')!);
  const listing = await f.service.list({ userId: owner.actorUserId } as never);
  expect(listing.items[0]!.state).toBe('QUEUED');
  expect(wikiStatusLabels[listing.items[0]!.state]).toBe('排队等待执行');
  expect(f.attempts.get('AQ-1')).toEqual(original);
  expect(await f.service.next(now)).toEqual({
    status: 'SUMMARY_PENDING',
    summaryId: 'DS-1',
    attemptRef: 'AQ-1',
  });
  expect(
    f.calls.some((call) => call.query.startsWith('update "action_attempt"')),
  ).toBe(false);
});

test('a competing CLAIM observed after the row lock prevents timeout and registry cleanup', async () => {
  const f = setup();
  f.onLock(() =>
    Object.assign(f.attempts.get('AQ-1')!, {
      status: 'RUNNING',
      claimCount: 1,
      leaseGeneration: 1,
      startedAt: new Date(now),
      lastHeartbeatAt: new Date(now),
      executorSessionKey: 'existing-executor',
    }),
  );
  await f.expire();
  expect(f.attempts.get('AQ-1')!.status).toBe('RUNNING');
  expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
  expect(
    f.calls.some((call) => call.query.startsWith('update "action_attempt"')),
  ).toBe(false);
});

test.each(['RUNNING', 'COMMITTING'])(
  'an expired %s request retains unknown provider and original commit recovery',
  async (status: string) => {
    const f = setup();
    Object.assign(f.attempts.get('AQ-1')!, {
      status,
      claimCount: 1,
      leaseGeneration: 1,
      startedAt: new Date('2026-10-14T06:30:00Z'),
      executorSessionKey: 'existing-executor',
    });
    const original: SummaryAttempt = structuredClone(f.attempts.get('AQ-1')!);
    const listing = await f.service.list({
      userId: owner.actorUserId,
    } as never);
    expect(listing.items[0]!.state).toBe('RUNNING');
    expect(f.attempts.get('AQ-1')).toEqual(original);
    expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
    await f.service.update('DS-1', { enabled: false }, { userId: owner.actorUserId } as never);
    expect(f.attempts.get('AQ-1')).toEqual(original);
    expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
    expect(
      f.calls.some((call) => call.query.startsWith('update "action_attempt"')),
    ).toBe(false);
  },
);

test.each([
  'claimCount',
  'leaseGeneration',
  'startedAt',
  'lastHeartbeatAt',
  'executorSessionKey',
  'commitStartedAt',
])(
  'a QUEUED row with prior %s evidence cannot be treated as never claimed',
  async (field: string) => {
    const f = setup();
    Object.assign(f.attempts.get('AQ-1')!, {
      [field]: field.endsWith('At') ? new Date(now) : 1,
    });
    await f.expire();
    expect(f.attempts.get('AQ-1')!.status).toBe('QUEUED');
    expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
    expect(
      f.calls.some((call) => call.query.startsWith('update "action_attempt"')),
    ).toBe(false);
  },
);

test.each(['QUEUED', 'SUCCEEDED', 'FAILED'])(
  'an exact saved request in %s is preserved without a replacement attempt',
  async (status: string) => {
    const f = setup();
    f.attempts.get('AQ-1')!.status = status;
    f.saved.add('wiki-1');
    const original: SummaryAttempt = structuredClone(f.attempts.get('AQ-1')!);
    await f.expire();
    await f.service.update('DS-1', { enabled: false }, { userId: owner.actorUserId } as never);
    expect(f.attempts.get('AQ-1')).toEqual(original);
    expect(f.rows[0]!.state.active?.requestId).toBe('wiki-1');
    expect(f.summaries.reserve).not.toHaveBeenCalled();
    if (status !== 'QUEUED') {
      f.rows[0]!.enabled = true;
      expect(await f.service.next(now)).toEqual({
        status: 'ATTENTION',
        errorCodes: ['WIKI_SAVED_RESERVATION_PENDING'],
      });
      expect(f.rows[0]!.state.retryCount).toBe(0);
    }
  },
);

test('a rejected timeout CAS fails explicitly and the owner transaction retains the original reservation', async () => {
  const f = setup(),
    original: SummaryAttempt = structuredClone(f.attempts.get('AQ-1')!);
  f.rejectCas();
  await expect(f.expire()).rejects.toThrow('WIKI_ATTEMPT_TIMEOUT_CAS_REJECTED');
  expect(f.attempts.get('AQ-1')).toEqual(original);
  expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
  expect(await f.service.next(now)).toEqual({
    status: 'ATTENTION',
    errorCodes: ['WIKI_ATTEMPT_TIMEOUT_CAS_REJECTED'],
  });
  expect(f.attempts.get('AQ-1')).toEqual(original);
});

test('every attempt row lock precedes the shared Wiki root lock for multiple expired reservations', async () => {
  const f = setup(2);
  await f.service.update('DS-1', { enabled: false }, { userId: owner.actorUserId } as never);
  const locks = f.calls
    .map((call, index: number) => ({ ...call, index }))
    .filter((call) => call.query.includes('for update'));
  expect(
    locks
      .filter((call) => call.query.includes('"action_attempt"'))
      .map((call) => call.params[0]),
  ).toEqual(['ATT-1', 'ATT-2']);
  const firstRegistryLock: number = f.calls.findIndex(
    (call) =>
      call.query.includes('FROM hierarchical_wiki_scope') &&
      call.query.includes('FOR UPDATE'),
  );
  expect(locks.every((call) => call.index < firstRegistryLock)).toBe(true);
  expect(f.calls[firstRegistryLock]!.query).toContain('ORDER BY wiki_id FOR UPDATE');
  expect(f.calls[firstRegistryLock]!.params).toEqual([owner.tenantId, owner.actorUserId]);
});

test('a changed active generation observed under the Wiki lock cannot be released by old attempt maintenance', async () => {
  const f = setup();
  f.onRegistryLock(() => {
    f.rows[0]!.state.active = { ...f.rows[0]!.state.active!, attemptRef: 'AQ-new', requestId: 'wiki-new', generation: 2 };
  });
  await f.expire();
  expect(f.attempts.get('AQ-1')!.status).toBe('TIMED_OUT');
  expect(f.rows[0]!.state.active).toMatchObject({ attemptRef: 'AQ-new', requestId: 'wiki-new', generation: 2 });
  expect(f.rows[0]!.state.retryCount).toBe(0);
});

test('tenant reading cannot reconcile another actor or tenant reservation', async () => {
  const f = setup();
  f.rows[0]!.actorUserId = 'other-actor';
  f.attempts.get('AQ-1')!.actorUserId = 'other-actor';
  const listing = await f.service.list({ userId: owner.actorUserId } as never);
  expect(listing.items[0]!.state).toBe('QUEUED');
  expect(f.repository.browser).not.toHaveBeenCalled();
  expect(f.attempts.get('AQ-1')!.status).toBe('QUEUED');
  await expect(
    reconcileWikiReservations(
      f.database,
      f.repository as unknown as DerivedSummaryRepository,
      { ...owner, readScope: 'TENANT' },
      f.rows,
      now,
    ),
  ).rejects.toThrow('WIKI_OWNER_WRITE_SCOPE_REQUIRED');
  f.rows[0]!.tenantId = 'other-tenant';
  await f.expire();
  expect(f.attempts.get('AQ-1')!.status).toBe('QUEUED');
});

test('RLS-hidden attempt metadata reports a blocked row without expiring it or hiding other readable rows', async () => {
  const f = setup(2);
  f.rows[1]!.state.active = null;
  f.repository.attempt.mockRejectedValue(new Error('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE'));
  const listing = await f.service.list({ userId: owner.actorUserId } as never);
  expect(listing.items[0]).toMatchObject({ state: 'BLOCKED', errorCode: 'DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE',
    coveredMembers: [], waiting: [] });
  expect(listing.items[1]!.state).toBe('PENDING');
  expect(f.repository.browser).not.toHaveBeenCalled();
  expect(f.attempts.get('AQ-1')!.status).toBe('QUEUED');
});

test('an RLS-hidden reservation remains explicit while another authorized reservation can expire', async () => {
  const f = setup(2);
  f.repository.attempt.mockImplementation(async (_id: string, ref: string) => {
    if (ref === 'AQ-1') throw new Error('DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE');
    return structuredClone(f.attempts.get(ref)!);
  });
  expect(await f.expire()).toEqual(['DERIVED_SUMMARY_ATTEMPT_UNAVAILABLE']);
  expect(f.attempts.get('AQ-1')!.status).toBe('QUEUED');
  expect(f.rows[0]!.state.active?.attemptRef).toBe('AQ-1');
  expect(f.attempts.get('AQ-2')!.status).toBe('TIMED_OUT');
  expect(f.rows[1]!.state.active).toBeNull();
});

test('original failure code and sealed model/input remain intact through the existing retry backoff', async () => {
  const f = setup();
  f.attempts.get('AQ-1')!.errorCode = 'ORIGINAL_DIAGNOSTIC';
  await f.expire();
  expect(f.attempts.get('AQ-1')!).toMatchObject({
    errorCode: 'ORIGINAL_DIAGNOSTIC',
    executionModelJson: '{"modelRef":"miaoda/glm-5.3"}',
    taskEnvelopeJson: sealedOriginalTask,
    deadlineAt: deadline,
  });
  expect(f.rows[0]!.state.lastAttemptErrorCode).toBe('ORIGINAL_DIAGNOSTIC');
  expect(wikiDemandState(f.rows[0]!.state)).toBe('PENDING');
});
