import type { CanonicalObjectAccessPort } from '../../server/modules/work-item/canonical-object-access.port';
import type { MiaodaWorkItemRepository } from '../../server/modules/work-item/miaoda-work-item.repository';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { EngineeringMatterWorkingRepository } from '../../server/modules/canonical-host/engineering-matter-working.repository';
import { EngineeringMatterWorkingService } from '../../server/modules/canonical-host/engineering-matter-working.service';
import type {
  EngineeringMatterRepository,
  EngineeringMatterSnapshot,
} from '../../server/modules/canonical-host/engineering-matter.repository';

const snapshot: EngineeringMatterSnapshot = {
  matterId: 'MAT-1',
  tenantId: 'tenant-A',
  title: 'Matter',
  status: 'ACTIVE',
  currentRevisionNo: 2,
  currentMatterRevisionId: 'MREV-2',
  changeKind: 'WORK_ITEM_LINKED',
  changeSummary: 'Linked.',
  revisionCreatedAt: new Date('2026-09-08T00:00:00.000Z'),
  links: [
    {
      workItemId: 'WI-A',
      ordinal: 1,
      relationRole: 'PRIMARY',
      linkedAtWorkItemRevision: 4,
    },
    {
      workItemId: 'WI-B',
      ordinal: 2,
      relationRole: 'RELATED',
      linkedAtWorkItemRevision: 7,
    },
  ],
};

describe('EngineeringMatterWorkingService', () => {
  it('keeps an ordinary explanation read-only and reports every uncovered member', async () => {
    const matters = { loadCurrent: jest.fn().mockResolvedValue(snapshot) };
    const working = {
      loadCurrent: jest.fn().mockResolvedValue(null),
      commit: jest.fn(),
    };
    const service = serviceWith({ matters, working });

    const result = await service.applyWorkingUpdate('MAT-1', null, actor());

    expect(result).toMatchObject({
      mutated: false,
      working: {
        matterId: 'MAT-1',
        currentMatterRevisionId: 'MREV-2',
        currentWorkingRevision: 0,
        current: null,
        pendingInputs: [
          { inputId: 'WI-A', reasons: ['NOT_COVERED'] },
          { inputId: 'WI-B', reasons: ['NOT_COVERED'] },
        ],
      },
    });
    expect(working.commit).not.toHaveBeenCalled();
  });

  it('prefers a saved readingResult identity and falls back to legacy Overall identity', async () => {
    const service = serviceWith();

    const basis = await service.resolveWorkingBasis('MAT-1', actor());

    expect(basis.currentInputs).toEqual([
      expect.objectContaining({
        inputId: 'WI-A',
        resultRef: 'READING-A',
        resultRevision: 5,
      }),
      expect.objectContaining({
        inputId: 'WI-B',
        resultRef: 'OVERALL-B',
        resultRevision: 3,
      }),
    ]);
  });

  it('loads the combined tenant/source identity only after fresh access', async () => {
    const events: string[] = [];
    const objectAccess = { freshRead: jest.fn(async ({ accessRoot }) => {
      events.push(accessRoot.id);
      return { allowed: true, workItemId: accessRoot.id,
        documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B' };
    }) };
    const workItems = { loadTenantScopedMemberIdentity: jest.fn(async (id: string, tenant: string, dv: string) => {
      expect(events).toContain(id);
      expect(tenant).toBe('tenant-A');
      expect(dv).toBe(workItem(id).row.documentVersionId);
      return workItem(id);
    }) };
    expect((await serviceWith({ objectAccess, workItems }).resolveWorkingBasis('MAT-1', actor())).currentInputs).toHaveLength(2);
    expect(workItems.loadTenantScopedMemberIdentity).toHaveBeenCalledTimes(2);
  });

  it('waits for every fresh grant before issuing one bounded tenant batch', async () => {
    let releaseSecond!: () => void;
    const secondDecision = new Promise<void>(resolve => { releaseSecond = resolve; });
    const objectAccess = { freshRead: jest.fn(async ({ accessRoot }) => {
      if (accessRoot.id === 'WI-B') await secondDecision;
      return { allowed: true, workItemId: accessRoot.id,
        documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B' };
    }) };
    const batch = jest.fn(async (inputs: { workItemId: string; documentVersionId: string }[], tenantId: string) => {
      expect(tenantId).toBe('tenant-A');
      expect(inputs).toEqual([
        { workItemId: 'WI-A', documentVersionId: 'DV-A' },
        { workItemId: 'WI-B', documentVersionId: 'DV-B' },
      ]);
      return new Map(inputs.map(input => [input.workItemId, workItem(input.workItemId)]));
    });
    const service = serviceWith({ objectAccess, workItems: {
      loadTenantScopedMemberIdentity: jest.fn(),
      loadTenantScopedMemberIdentities: batch,
    } });
    const pending = service.readWorking('MAT-1', actor());
    await Promise.resolve();
    expect(batch).not.toHaveBeenCalled();
    releaseSecond();
    expect((await pending).pendingInputs).toHaveLength(2);
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-row', 'changed-version', 'source-mismatch'])(
    'rejects a %s in the second authorized batch member', async kind => {
      const batch = jest.fn(async () => {
        const second = workItem('WI-B');
        if (kind === 'changed-version') second.row.documentVersionId = 'DV-CHANGED';
        if (kind === 'source-mismatch') second.sourceIdentity.version.documentId = 'DOC-OTHER';
        const rows = new Map<string, ReturnType<typeof workItem>>();
        rows.set('WI-A', workItem('WI-A'));
        if (kind !== 'missing-row') rows.set('WI-B', second);
        return rows;
      });
      const service = serviceWith({ workItems: {
        loadTenantScopedMemberIdentity: jest.fn(),
        loadTenantScopedMemberIdentities: batch,
      } });
      const code = kind === 'source-mismatch'
        ? 'ENGINEERING_MATTER_WORK_ITEM_DOCUMENT_CONFLICT'
        : 'CANONICAL_WORK_ITEM_NOT_FOUND';
      await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({ code });
      expect(batch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not issue a batch when one fresh member is denied', async () => {
    const batch = jest.fn();
    const objectAccess = { freshRead: jest.fn(async ({ accessRoot }) =>
      accessRoot.id === 'WI-B'
        ? { allowed: false, code: 'REVOKED', statusCode: 403 }
        : { allowed: true, workItemId: accessRoot.id, documentVersionId: 'DV-A' },
    ) };
    const service = serviceWith({ objectAccess, workItems: {
      loadTenantScopedMemberIdentity: jest.fn(),
      loadTenantScopedMemberIdentities: batch,
    } });
    await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({ code: 'REVOKED' });
    expect(objectAccess.freshRead).toHaveBeenCalledTimes(2);
    expect(batch).not.toHaveBeenCalled();
  });

  it('does not launch the combined read after fresh access is denied', async () => {
    const workItems = { loadTenantScopedMemberIdentity: jest.fn() };
    const service = serviceWith({ workItems,
      objectAccess: { freshRead: jest.fn().mockResolvedValue({ allowed: false, code: 'REVOKED', statusCode: 403 }) } });
    await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({ code: 'REVOKED' });
    expect(workItems.loadTenantScopedMemberIdentity).not.toHaveBeenCalled();
  });

  it('preserves a combined repository failure', async () => {
    const service = serviceWith({ workItems: { loadTenantScopedMemberIdentity: jest.fn().mockRejectedValue(new Error('TENANT_READ_FAILED')) } });
    await expect(service.readWorking('MAT-1', actor())).rejects.toThrow('TENANT_READ_FAILED');
  });

  it.each(['missing', 'changed-version', 'projection-mismatch', 'source-mismatch', 'source-missing', 'source-invalid']) (
    'still rejects %s and gives projection validation precedence over source identity', async kind => {
      const scoped = workItem('WI-A');
      if (kind === 'changed-version') scoped.row.documentVersionId = 'DV-CHANGED';
      if (kind === 'projection-mismatch') scoped.projection.source.documentVersionId = 'DV-OTHER';
      if (kind === 'source-mismatch') scoped.sourceIdentity.version.documentId = 'DOC-OTHER';
      if (kind === 'source-invalid' || kind === 'projection-mismatch') scoped.sourceIdentity.artifact.sha256 = 'bad';
      const workItems = { loadTenantScopedMemberIdentity: jest.fn().mockResolvedValue(kind === 'missing' ? null
        : kind === 'source-missing' ? { ...scoped, sourceIdentity: null } : scoped) };
      const service = serviceWith({ workItems,
        matters: { loadCurrent: jest.fn().mockResolvedValue({ ...snapshot, links: snapshot.links.slice(0, 1) }) } });
      const code = kind === 'missing' || kind === 'changed-version'
        ? 'CANONICAL_WORK_ITEM_NOT_FOUND' : kind === 'source-missing'
          ? 'DOCUMENT_VERSION_NOT_FOUND' : kind === 'source-invalid'
            ? 'DOCUMENT_VERSION_SOURCE_IDENTITY_INVALID' : 'ENGINEERING_MATTER_WORK_ITEM_DOCUMENT_CONFLICT';
      const failure = await service.readWorking('MAT-1', actor()).catch(error => error);
      expect(failure.code ?? failure.message).toBe(code);
      expect(workItems.loadTenantScopedMemberIdentity).toHaveBeenCalledWith('WI-A', 'tenant-A', 'DV-A');
    },
  );

  it('fails closed when any current Matter member loses fresh access', async () => {
    const objectAccess = {
      freshRead: jest.fn().mockImplementation(({ accessRoot }) =>
        Promise.resolve(
          accessRoot.id === 'WI-B'
            ? {
                allowed: false,
                code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
                statusCode: 404,
              }
            : {
                allowed: true,
                workItemId: 'WI-A',
                documentVersionId: 'DV-A',
              },
        ),
      ),
    };
    const service = serviceWith({ objectAccess });

    await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('bounds saved-member reads while retaining every fresh check and the exact revision', async () => {
    jest.useFakeTimers();
    try {
      let active = 0, peak = 0;
      const savedIds = ['WI-A', 'WI-B', ...Array.from({ length: 7 }, (_, i) => `WI-H${i}`)];
      const revision = { matterId: 'MAT-1', matterWorkRevisionId: 'MWREV-OLD',
        state: { substantiveInputs: savedIds.map(workItemId => ({ workItemId })),
          coverage: [{ binding: { workItemId: 'WI-A' } }] } };
      const working = { readByRef: jest.fn().mockResolvedValue(revision) };
      const objectAccess = { freshRead: jest.fn(async ({ accessRoot }) => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 20));
        active--;
        return { allowed: true, workItemId: accessRoot.id,
          documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B' };
      }) };
      const service = serviceWith({ working, objectAccess });
      const start = Date.now();
      const pending = service.readWorkingRevision('MAT-1', 'MWREV-OLD', actor());
      await jest.runAllTimersAsync();
      expect(await pending).toBe(revision);
      expect(Date.now() - start).toBe(80); // current group + three saved groups
      expect(peak).toBe(4);
      expect(active).toBe(0);
      expect(working.readByRef).toHaveBeenCalledWith({ tenantId: 'tenant-A', matterId: 'MAT-1', workRef: 'MWREV-OLD' });
      expect(objectAccess.freshRead.mock.calls.map(([input]) => input.accessRoot.id)).toEqual(['WI-A', 'WI-B', ...savedIds]);
      // A new request must recheck every source, even for an identical saved work.
      const second = service.readWorkingRevision('MAT-1', 'MWREV-OLD', actor());
      await jest.runAllTimersAsync(); await second;
      expect(objectAccess.freshRead).toHaveBeenCalledTimes(22);
    } finally { jest.useRealTimers(); }
  });

  it('settles a denied historical group before failing and never starts later groups', async () => {
    jest.useFakeTimers();
    try {
      const ids = ['WI-REMOVED', 'WI-H1', 'WI-H2', 'WI-H3', 'WI-NEXT'];
      const working = { readByRef: jest.fn().mockResolvedValue({
        state: { substantiveInputs: ids.map(workItemId => ({ workItemId })), coverage: [] },
      }) };
      let active = 0;
      const objectAccess = { freshRead: jest.fn(async ({ accessRoot }) => {
        active++;
        await new Promise(resolve => setTimeout(resolve, accessRoot.id === 'WI-REMOVED' ? 5 : 20));
        active--;
        return accessRoot.id === 'WI-REMOVED'
          ? { allowed: false, code: 'REVOKED', statusCode: 403 }
          : { allowed: true, workItemId: accessRoot.id, documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B' };
      }) };
      const service = serviceWith({ working, objectAccess });
      const pending = service.readWorkingRevision('MAT-1', 'MWREV-OLD', actor()).catch(error => ({ error, activeAtReturn: active }));
      await jest.runAllTimersAsync();
      expect(await pending).toMatchObject({ error: { code: 'REVOKED', statusCode: 403 }, activeAtReturn: 0 });
      expect(objectAccess.freshRead.mock.calls.map(([input]) => input.accessRoot.id)).toEqual(['WI-A', 'WI-B', ...ids.slice(0, 4)]);
    } finally { jest.useRealTimers(); }
  });

  it('does not read a saved body if a current member is denied', async () => {
    const working = { readByRef: jest.fn() };
    const service = serviceWith({ working, objectAccess: { freshRead: jest.fn().mockResolvedValue({ allowed: false, code: 'REVOKED', statusCode: 403 }) } });
    await expect(service.readWorkingRevision('MAT-1', 'MWREV-OLD', actor())).rejects.toMatchObject({ statusCode: 403 });
    expect(working.readByRef).not.toHaveBeenCalled();
  });

  it('reads saved original bindings without hydrating unrelated current parse state', async () => {
    const revision = { state: { substantiveInputs: [{ workItemId: 'WI-A', original: { parseRunId: 'SAVED-PARSE', parseRevision: 2 } }], coverage: [] } };
    const bindOriginalInputs = jest.fn(async (_tenant, inputs) => inputs);
    const service = serviceWith({ working: { readByRef: jest.fn().mockResolvedValue(revision), bindOriginalInputs } });
    expect(await service.readWorkingRevision('MAT-1', 'MWREV-OLD', actor())).toBe(revision);
    expect(bindOriginalInputs).not.toHaveBeenCalled();
    expect(revision.state.substantiveInputs[0].original.parseRunId).toBe('SAVED-PARSE');
  });

  it('preserves saved-read hydration choice across a current matter revision retry', async () => {
    const changed = { ...snapshot, currentMatterRevisionId: 'MATREV-NEXT' };
    const matters = { loadCurrent: jest.fn().mockResolvedValueOnce(snapshot).mockResolvedValue(changed) };
    const revision = { state: { substantiveInputs: [], coverage: [] } };
    const bindOriginalInputs = jest.fn(async (_tenant, inputs) => inputs);
    const working = { readByRef: jest.fn().mockResolvedValue(revision), bindOriginalInputs };
    const service = serviceWith({ matters, working });
    expect(await service.readWorkingRevision('MAT-1', 'MWREV-OLD', actor())).toBe(revision);
    expect(matters.loadCurrent).toHaveBeenCalledTimes(4);
    expect(bindOriginalInputs).not.toHaveBeenCalled();
    expect(working.readByRef).toHaveBeenCalledTimes(1);
  });

  it('still binds current parse state when building a current working basis', async () => {
    const bindOriginalInputs = jest.fn(async (_tenant, inputs) => inputs.map(input => ({ ...input, original: { parseRunId: 'CURRENT-PARSE', parseRevision: 3 } })));
    const service = serviceWith({ working: { loadCurrent: jest.fn().mockResolvedValue(null), bindOriginalInputs } });
    const basis = await service.resolveWorkingBasis('MAT-1', actor());
    expect(bindOriginalInputs).toHaveBeenCalledTimes(1);
    expect(basis.currentInputs.every(input => input.original?.parseRunId === 'CURRENT-PARSE')).toBe(true);
  });

  it('rejects a missing exact saved work without loading the current work as fallback', async () => {
    const working = { readByRef: jest.fn().mockResolvedValue(null), loadCurrent: jest.fn() };
    const service = serviceWith({ working });
    await expect(service.readWorkingRevision('MAT-1', 'MWREV-MISSING', actor())).rejects.toThrow();
    expect(working.loadCurrent).not.toHaveBeenCalled();
  });

});

function serviceWith(
  overrides: {
    matters?: Record<string, jest.Mock>;
    working?: Record<string, jest.Mock>;
    workItems?: Record<string, jest.Mock>;
    objectAccess?: Record<string, jest.Mock>;
  } = {},
): EngineeringMatterWorkingService {
  const matters =
    overrides.matters ??
    ({ loadCurrent: jest.fn().mockResolvedValue(snapshot) } as const);
  const working =
    overrides.working ??
    ({ loadCurrent: jest.fn().mockResolvedValue(null) } as const);
  if (!('bindOriginalInputs' in working)) Object.assign(working, { bindOriginalInputs: jest.fn(async (_tenant, inputs) => inputs) });
  const workItems =
    overrides.workItems ??
    ({
      loadTenantScopedMemberIdentity: jest
        .fn()
        .mockImplementation((workItemId: string) =>
          Promise.resolve(workItem(workItemId)),
        ),
    } as const);
  if (!('loadTenantScopedMemberIdentities' in workItems)) {
    Object.assign(workItems, {
      loadTenantScopedMemberIdentities: jest.fn(async (
        inputs: { workItemId: string; documentVersionId: string }[],
        tenantId: string,
      ) => new Map(await Promise.all(inputs.map(async input => [
        input.workItemId,
        await workItems.loadTenantScopedMemberIdentity(
          input.workItemId, tenantId, input.documentVersionId,
        ),
      ] as const)))),
    });
  }
  const objectAccess =
    overrides.objectAccess ??
    ({
      freshRead: jest.fn().mockImplementation(({ accessRoot }) =>
        Promise.resolve({
          allowed: true,
          workItemId: accessRoot.id,
          documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B',
        }),
      ),
    } as const);
  return new EngineeringMatterWorkingService(
    matters as unknown as EngineeringMatterRepository,
    working as unknown as EngineeringMatterWorkingRepository,
    workItems as unknown as MiaodaWorkItemRepository,
    objectAccess as unknown as CanonicalObjectAccessPort,
  );
}

function workItem(workItemId: string) {
  const first = workItemId === 'WI-A';
  const documentVersionId = first ? 'DV-A' : 'DV-B';
  const overall = first
    ? {
        sourceResultId: 'LEGACY-A',
        revision: 4,
        readingResult: { resultRef: 'READING-A', resultRevision: 5 },
      }
    : { sourceResultId: 'OVERALL-B', revision: 3 };
  return {
    row: {
      workItemId,
      tenantId: 'tenant-A',
      documentId: first ? 'DOC-A' : 'DOC-B',
      documentVersionId,
      revision: first ? 4 : 7,
    },
    sourceIdentity: documentVersion(documentVersionId),
    projection: {
      source: { documentVersionId },
      integratedAssessment: { overallSynthesis: overall },
    },
  };
}

function documentVersion(documentVersionId: string) {
  const first = documentVersionId === 'DV-A';
  return {
    version: {
      documentId: first ? 'DOC-A' : 'DOC-B',
      documentVersionId,
      lifecycleStatus: 'COMMITTED_IMMUTABLE', pdfSha256: 'valid', byteLength: 42,
    },
    artifact: { readbackVerified: true, sha256: 'valid', byteLength: 42 },
  };
}

function actor(): CanonicalHostActor {
  return {
    userId: 'actor-A',
    tenantId: 'tenant-A',
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'runtime',
    objectAccessActor: {} as NonNullable<
      CanonicalHostActor['objectAccessActor']
    >,
  };
}
