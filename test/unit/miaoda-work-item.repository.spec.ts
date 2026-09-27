import type { CanonicalWorkItemProjection } from '@shared/api.interface';

import { actionAttempt, workItem } from '../../server/database/schema';
import { autoWorkItemAuthorization } from '../../server/database/auto-work-item-authorization.schema';
import { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';

function projection(): Omit<CanonicalWorkItemProjection, 'revision'> {
  return {
    workItemId: 'WI-AUDIT-1',
    requestId: 'REQ-AUDIT-1',
    phase: 'CANDIDATE_READBACK_VERIFIED',
    classification: {
      status: 'CONFIRMED',
      normalizedFamily: 'SB',
    },
    source: {
      documentVersionId: 'document-version-audit-1',
    },
    package: null,
    failure: null,
    recordingFailure: null,
  } as unknown as Omit<CanonicalWorkItemProjection, 'revision'>;
}

function repository() {
  const returning = jest.fn().mockResolvedValue([{ workItemId: 'WI-AUDIT-1' }]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const target = new MiaodaWorkItemRepository({ update } as never);
  const syncPrimaryAttempt = jest
    .spyOn(target as never, 'updatePrimaryAttempt' as never)
    .mockResolvedValue(undefined as never);
  return { target, syncPrimaryAttempt };
}

describe('MiaodaWorkItemRepository assessment CAS audit isolation', () => {
  it('does not rewrite the primary parse ActionAttempt for an assessment-only CAS', async () => {
    const target = repository();

    await target.target.compareAndSet({
      workItemId: 'WI-AUDIT-1',
      expectedRevision: 3,
      next: projection(),
      syncPrimaryAttempt: false,
    });

    expect(target.syncPrimaryAttempt).not.toHaveBeenCalled();
  });

  it('keeps primary parse attempt synchronization as the default', async () => {
    const target = repository();

    await target.target.compareAndSet({
      workItemId: 'WI-AUDIT-1',
      expectedRevision: 2,
      next: projection(),
    });

    expect(target.syncPrimaryAttempt).toHaveBeenCalledTimes(1);
  });

  it('reads a durable OPENCLAW_MCP_V1 dynamic row through the legacy domain port', async () => {
    const createdAt = new Date('2026-08-24T10:00:00.000Z');
    const limit = jest.fn().mockResolvedValue([
      {
        attemptId: 'ATT-DURABLE-DYNAMIC',
        workItemId: 'WI-AUDIT-1',
        actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
        attemptNo: 2,
        triggerRequestId: 'REQ-DURABLE-DYNAMIC',
        requestOrigin: 'OPENCLAW_MCP_V1',
        status: 'SUCCEEDED',
        actorUserId: 'service:openclaw-main',
        tenantId: 'tenant-audit',
        createdAt,
      },
    ]);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });
    const target = new MiaodaWorkItemRepository({ select } as never);

    await expect(
      target.getDynamicEvaluationActionByAttemptId('ATT-DURABLE-DYNAMIC'),
    ).resolves.toEqual({
      attemptId: 'ATT-DURABLE-DYNAMIC',
      workItemId: 'WI-AUDIT-1',
      actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
      attemptNo: 2,
      triggerRequestId: 'REQ-DURABLE-DYNAMIC',
      requestOrigin: 'OPENCLAW',
      status: 'SUCCEEDED',
      actorUserId: 'service:openclaw-main',
      tenantId: 'tenant-audit',
      createdAt,
    });
  });
});

describe('MiaodaWorkItemRepository parse retry recovery', () => {
  const authorization = {
    action: 'PARSE_PDF' as const,
    actorFingerprint: `sha256:${'1'.repeat(64)}`,
    decisionId: 'decision-fresh-retry',
    decisionHash: `sha256:${'2'.repeat(64)}`,
    permissionSnapshotVersion: `sha256:${'3'.repeat(64)}`,
  };

  it('rebinds a fresh authorization onto the exact pending retry without inserting Attempt 3', async () => {
    const fixture = pendingRetryRepository({ status: 'PENDING' });

    await expect(
      fixture.target.reopenRetryableParseFailure({
        ...retryIdentity(),
        authorization,
      }),
    ).resolves.toEqual({ attemptId: 'ATT-RETRY-2', attemptNo: 2 });

    expect(fixture.insert).not.toHaveBeenCalled();
    expect(fixture.update).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(
      fixture.set.mock.calls[0][0].projectionJson,
    ) as CanonicalWorkItemProjection;
    expect(persisted).toMatchObject({
      workItemId: 'WI-RETRY-1',
      phase: 'PARSE_REQUESTED',
      revision: 5,
      permissionSnapshotVersion: authorization.permissionSnapshotVersion,
      parseAuthorization: authorization,
    });
  });

  it('does not reuse a retry attempt that has already started', async () => {
    const fixture = pendingRetryRepository({
      status: 'RUNNING',
      startedAt: new Date('2026-08-26T01:00:00.000Z'),
    });

    await expect(
      fixture.target.reopenRetryableParseFailure({
        ...retryIdentity(),
        authorization,
      }),
    ).resolves.toBeNull();

    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['attempt 1', { attemptNo: 1 }],
    [
      'a completed attempt',
      { completedAt: new Date('2026-08-26T01:01:00.000Z') },
    ],
    ['an attempt with an error', { errorCode: 'PRE_PARSE_FAILURE' }],
  ])('does not reuse %s', async (_label, attempt) => {
    const fixture = pendingRetryRepository({
      status: 'PENDING',
      ...attempt,
    });

    await expect(
      fixture.target.reopenRetryableParseFailure({
        ...retryIdentity(),
        authorization,
      }),
    ).resolves.toBeNull();

    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it('fails the authorization rebind on a WorkItem revision race before producer execution', async () => {
    const fixture = pendingRetryRepository({
      status: 'PENDING',
      updatedRows: [],
    });

    await expect(
      fixture.target.reopenRetryableParseFailure({
        ...retryIdentity(),
        authorization,
      }),
    ).rejects.toThrow('WORK_ITEM_CAS_CONFLICT');

    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it('reopens a completed candidate on the same WorkItem and DV with a new Attempt while retaining the old artifact', async () => {
    const fixture = completedReparseRepository();

    const result = await fixture.target.reopenCompletedParse({
      ...retryIdentity(),
      expectedRevision: 4,
      authorization,
    });

    expect(result).toMatchObject({ attemptNo: 2 });
    expect(result?.attemptId).toMatch(/^ATT-/u);
    const persisted = JSON.parse(
      fixture.set.mock.calls[0][0].projectionJson,
    ) as CanonicalWorkItemProjection;
    expect(persisted).toMatchObject({
      workItemId: 'WI-RETRY-1',
      revision: 5,
      phase: 'PARSE_REQUESTED',
      source: { documentVersionId: 'document-version-retry' },
      package: {
        packageId: 'PKG-OLD',
        artifact: {
          ref: 'artifact://old-package',
          sha256: 'b'.repeat(64),
        },
      },
      parseAuthorization: authorization,
    });
    expect(fixture.set.mock.calls[0][0]).toMatchObject({
      packageId: 'PKG-OLD',
      packageArtifactRef: 'artifact://old-package',
      packageArtifactSha256: 'b'.repeat(64),
    });
    expect(fixture.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        workItemId: 'WI-RETRY-1',
        actionType: 'PARSE_PDF',
        attemptNo: 2,
        status: 'PENDING',
        actorUserId: 'user-retry',
        tenantId: 'tenant-retry',
        inputRevision: 4,
        baseRevision: 4,
        documentVersionId: 'document-version-retry',
      }),
    );
  });

  it('creates no reparse Attempt when the completed WorkItem revision drifts', async () => {
    const fixture = completedReparseRepository({ updatedRows: [] });

    await expect(
      fixture.target.reopenCompletedParse({
        ...retryIdentity(),
        expectedRevision: 4,
        authorization,
      }),
    ).resolves.toBeNull();

    expect(fixture.insert).not.toHaveBeenCalled();
  });

  it('creates no reparse Attempt when the projection is not bound to the current DV', async () => {
    const fixture = completedReparseRepository({
      projectionDocumentVersionId: 'document-version-drifted',
    });

    await expect(
      fixture.target.reopenCompletedParse({
        ...retryIdentity(),
        expectedRevision: 4,
        authorization,
      }),
    ).resolves.toBeNull();

    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.insert).not.toHaveBeenCalled();
  });
});

describe('MiaodaWorkItemRepository automatic processing enrollment', () => {
  it('persists the explicit grant in the same reservation transaction for a new WorkItem', async () => {
    const fixture = reservationFixture(true);

    const reservation = await fixture.target.reserve(
      automaticReservationInput(),
    );
    expect(reservation.created).toBe(true);

    const enrollment = fixture.insertCalls.find(
      (call) => call.table === autoWorkItemAuthorization,
    );
    expect(enrollment?.values).toMatchObject({
      tenantId: 'tenant-auto',
      workItemId: reservation.workItemId,
      requestId: reservation.requestId,
      actorUserId: 'actor-auto',
      documentVersionId: 'DV-AUTO',
      grantKind: 'MIAODA_CANONICAL_PARSE_REQUEST',
      status: 'WAITING',
    });
    expect(fixture.db.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.insertCalls.map((call) => call.table)).toEqual([
      workItem,
      autoWorkItemAuthorization,
      actionAttempt,
    ]);
  });

  it('does not enroll an existing WorkItem when the reservation key conflicts', async () => {
    const fixture = reservationFixture(false);

    await expect(
      fixture.target.reserve(automaticReservationInput()),
    ).resolves.toMatchObject({
      created: false,
      workItemId: 'WI-AUTO-LEGACY',
    });

    expect(
      fixture.insertCalls.some(
        (call) => call.table === autoWorkItemAuthorization,
      ),
    ).toBe(false);
  });
});

function automaticReservationInput() {
  return {
    tenantId: 'tenant-auto',
    actorUserId: 'actor-auto',
    documentId: 'DOC-AUTO',
    documentVersionId: 'DV-AUTO',
    sourceArtifactId: 'ART-AUTO',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 4096,
    normalizedFamily: 'FTD',
    requestOrigin: 'MIAODA' as const,
    runKey: 'canonical',
    autoProcessingGrant: 'MIAODA_CANONICAL_PARSE_REQUEST' as const,
  };
}

function reservationFixture(created: boolean) {
  const insertCalls: Array<{ table: unknown; values: unknown }> = [];
  let storedWorkItem: Record<string, unknown> | null = null;
  const transaction = {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          insertCalls.push({ table, values });
          if (table === workItem) {
            const workItemId = created
              ? String(values.workItemId)
              : 'WI-AUTO-LEGACY';
            storedWorkItem = {
              ...values,
              workItemId,
              requestId: created ? values.requestId : 'REQ-AUTO-LEGACY',
              analysisModelJson: null,
            };
            return {
              onConflictDoNothing: jest.fn().mockReturnValue({
                returning: jest
                  .fn()
                  .mockResolvedValue(
                    created ? [{ workItemId: storedWorkItem.workItemId }] : [],
                  ),
              }),
            };
          }
          if (table === autoWorkItemAuthorization) {
            return Promise.resolve(undefined);
          }
          return {
            onConflictDoNothing: jest.fn().mockResolvedValue(undefined),
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockImplementation(async () =>
                table === workItem
                  ? [storedWorkItem]
                  : [
                      {
                        attemptId: 'ATT-AUTO',
                        workItemId: storedWorkItem?.workItemId,
                      },
                    ],
              ),
            }),
          };
        },
      };
    },
  };
  const db = {
    transaction: jest.fn(
      async (operation: (value: typeof transaction) => unknown) =>
        operation(transaction),
    ),
  };
  return {
    target: new MiaodaWorkItemRepository(db as never),
    db,
    insertCalls,
  };
}

function retryIdentity() {
  return {
    tenantId: 'tenant-retry',
    actorUserId: 'user-retry',
    documentId: 'document-retry',
    documentVersionId: 'document-version-retry',
    sourceArtifactId: 'artifact-retry',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 25556,
    normalizedFamily: 'FTD',
    requestOrigin: 'MIAODA' as const,
    runKey: 'dev:22222222-2222-4222-8222-222222222222',
    workItemId: 'WI-RETRY-1',
    requestId: 'REQ-RETRY-1',
  };
}

function pendingRetryRepository(input: {
  status: string;
  attemptNo?: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  errorCode?: string | null;
  updatedRows?: Array<{ workItemId: string }>;
}) {
  const projection: CanonicalWorkItemProjection = {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-RETRY-1',
    requestId: 'REQ-RETRY-1',
    revision: 4,
    phase: 'PARSE_REQUESTED',
    permissionSnapshotVersion: `sha256:${'0'.repeat(64)}`,
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: `sha256:${'9'.repeat(64)}`,
      decisionId: 'decision-original-development-run',
      decisionHash: `sha256:${'8'.repeat(64)}`,
      permissionSnapshotVersion: `sha256:${'0'.repeat(64)}`,
    },
    source: { documentVersionId: 'document-version-retry' } as never,
    classification: {
      status: 'CANDIDATE',
      normalizedFamily: 'FTD',
    } as never,
    package: null,
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
  const workItemRow = {
    workItemId: 'WI-RETRY-1',
    tenantId: 'tenant-retry',
    requestId: 'REQ-RETRY-1',
    documentId: 'document-retry',
    documentVersionId: 'document-version-retry',
    sourceArtifactId: 'artifact-retry',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 25556,
    normalizedFamily: 'FTD',
    requestedByUserId: 'user-retry',
    runKey: 'dev:22222222-2222-4222-8222-222222222222',
    revision: 4,
    projectionJson: JSON.stringify(projection),
  };
  const attemptRow = {
    attemptId: 'ATT-RETRY-2',
    attemptNo: input.attemptNo ?? 2,
    status: input.status,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    errorCode: input.errorCode ?? null,
  };
  let selectNo = 0;
  const select = jest.fn().mockImplementation(() => {
    const rows = selectNo++ === 0 ? [workItemRow] : [attemptRow];
    const limit = jest.fn().mockResolvedValue(rows);
    const where = jest.fn().mockReturnValue({
      limit,
      orderBy: jest.fn().mockReturnValue({ limit }),
    });
    return { from: jest.fn().mockReturnValue({ where }) };
  });
  const returning = jest
    .fn()
    .mockResolvedValue(input.updatedRows ?? [{ workItemId: 'WI-RETRY-1' }]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const insert = jest.fn();
  const transaction = { select, update, insert };
  const db = {
    transaction: jest.fn(
      async (operation: (value: typeof transaction) => unknown) =>
        operation(transaction),
    ),
  };
  return {
    target: new MiaodaWorkItemRepository(db as never),
    insert,
    update,
    set,
  };
}

function completedReparseRepository(input?: {
  updatedRows?: Array<{ workItemId: string }>;
  projectionDocumentVersionId?: string;
}) {
  const projection: CanonicalWorkItemProjection = {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId: 'WI-RETRY-1',
    requestId: 'REQ-RETRY-1',
    revision: 4,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: `sha256:${'0'.repeat(64)}`,
    parseAuthorization: {
      action: 'PARSE_PDF',
      actorFingerprint: `sha256:${'9'.repeat(64)}`,
      decisionId: 'decision-original-development-run',
      decisionHash: `sha256:${'8'.repeat(64)}`,
      permissionSnapshotVersion: `sha256:${'0'.repeat(64)}`,
    },
    source: {
      documentVersionId:
        input?.projectionDocumentVersionId ?? 'document-version-retry',
    } as never,
    classification: {
      status: 'CANDIDATE',
      normalizedFamily: 'FTD',
    } as never,
    package: {
      packageId: 'PKG-OLD',
      artifact: {
        ref: 'artifact://old-package',
        sha256: 'b'.repeat(64),
      },
    } as never,
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
  const workItemRow = {
    workItemId: 'WI-RETRY-1',
    tenantId: 'tenant-retry',
    requestId: 'REQ-RETRY-1',
    documentId: 'document-retry',
    documentVersionId: 'document-version-retry',
    sourceArtifactId: 'artifact-retry',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 25556,
    normalizedFamily: 'FTD',
    requestedByUserId: 'user-retry',
    runKey: 'dev:22222222-2222-4222-8222-222222222222',
    revision: 4,
    projectionJson: JSON.stringify(projection),
  };
  const attemptRow = {
    attemptId: 'ATT-SUCCEEDED-1',
    attemptNo: 1,
    status: 'SUCCEEDED',
    startedAt: new Date('2026-08-26T00:59:00.000Z'),
    completedAt: new Date('2026-08-26T01:00:00.000Z'),
    errorCode: null,
    packageArtifactRef: 'artifact://old-package',
    packageArtifactSha256: 'b'.repeat(64),
  };
  let selectNo = 0;
  const select = jest.fn().mockImplementation(() => {
    const rows = selectNo++ === 0 ? [workItemRow] : [attemptRow];
    const limit = jest.fn().mockResolvedValue(rows);
    const where = jest.fn().mockReturnValue({
      limit,
      orderBy: jest.fn().mockReturnValue({ limit }),
    });
    return { from: jest.fn().mockReturnValue({ where }) };
  });
  const returning = jest
    .fn()
    .mockResolvedValue(input?.updatedRows ?? [{ workItemId: 'WI-RETRY-1' }]);
  const where = jest.fn().mockReturnValue({ returning });
  const set = jest.fn().mockReturnValue({ where });
  const update = jest.fn().mockReturnValue({ set });
  const insertReturning = jest.fn().mockResolvedValue([{ attemptId: 'new' }]);
  const insertValues = jest
    .fn()
    .mockReturnValue({ returning: insertReturning });
  const insert = jest.fn().mockReturnValue({ values: insertValues });
  const transaction = { select, update, insert };
  const db = {
    transaction: jest.fn(
      async (operation: (value: typeof transaction) => unknown) =>
        operation(transaction),
    ),
  };
  return {
    target: new MiaodaWorkItemRepository(db as never),
    insert,
    insertValues,
    update,
    set,
  };
}

describe('MiaodaWorkItemRepository readable completion receipt', () => {
  const now = new Date('2026-09-27T00:00:00.000Z');
  const grant = {
    tenantId: 'tenant-A',
    workItemId: 'WI-A',
    requestId: 'REQ-A',
    actorUserId: 'actor-A',
    documentId: 'DOC-A',
    documentVersionId: 'DV-A',
    sourceArtifactId: 'SA-A',
    sourceFileSha256: 'a'.repeat(64),
    sourceByteLength: 200,
    completedAt: now,
  };
  function setup(receiptRows: Array<{ workItemId: string }>) {
    const returning = jest
      .fn()
      .mockResolvedValueOnce([grant])
      .mockResolvedValueOnce(receiptRows);
    const where = jest.fn().mockReturnValue({ returning });
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    const executor = { update };
    const transaction = jest.fn(async (run: (db: typeof executor) => unknown) =>
      run(executor),
    );
    const target = new MiaodaWorkItemRepository({ transaction } as never);
    return { target, transaction, update, set };
  }
  const input = {
    tenantId: 'tenant-A',
    workItemId: 'WI-A',
    leaseOwner: 'service:worker',
    leaseToken: '15b5fa83-83f7-41ba-9414-9062bc180b1b',
    leaseGeneration: 1,
    expectedWorkItemRevision: 9,
    now,
  };
  it('writes the readable receipt inside the completion transaction', async () => {
    const fixture = setup([{ workItemId: 'WI-A' }]);
    await expect(
      fixture.target.acknowledgeAutoProcessingLease(input),
    ).resolves.toEqual({ acknowledgedAt: now, replayed: false });
    expect(fixture.transaction).toHaveBeenCalledTimes(1);
    expect(fixture.update.mock.calls.map(([table]) => table)).toEqual([
      autoWorkItemAuthorization,
      workItem,
    ]);
    expect(fixture.set.mock.calls[1][0]).toEqual({
      projectionJson: expect.anything(),
    });
  });
  it('fails the transaction when the exact revision cannot receive the receipt', async () => {
    const fixture = setup([]);
    await expect(
      fixture.target.acknowledgeAutoProcessingLease(input),
    ).rejects.toThrow('AUTO_PROCESSING_COMPLETION_RECEIPT_WRITE_FAILED');
  });
});
