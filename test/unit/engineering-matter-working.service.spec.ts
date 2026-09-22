import type { CanonicalObjectAccessPort } from '../../server/modules/work-item/canonical-object-access.port';
import type { MiaodaDocumentVersionSourceResolver } from '../../server/modules/work-item/miaoda-document-version-source.resolver';
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

  it('checks member source identity without loading unused source records', async () => {
    const documentVersions = {
      resolveIdentity: jest.fn(async (id: string) => ({ version: documentVersion(id).version })),
      resolve: jest.fn(() => { throw new Error('UNUSED_FULL_SOURCE_READ'); }),
    };
    const service = serviceWith({ documentVersions });
    const basis = await service.resolveWorkingBasis('MAT-1', actor());
    expect(basis.currentInputs).toHaveLength(2);
    expect(documentVersions.resolveIdentity).toHaveBeenCalledTimes(2);
    expect(documentVersions.resolve).not.toHaveBeenCalled();
  });

  it('overlaps source and tenant reads only after fresh access and settles both', async () => {
    jest.useFakeTimers();
    try {
      const events: string[] = [];
      const objectAccess = { freshRead: jest.fn(async ({ accessRoot }) => {
        await new Promise(resolve => setTimeout(resolve, 20));
        events.push(`authorized:${accessRoot.id}`);
        return { allowed: true, workItemId: accessRoot.id,
          documentVersionId: accessRoot.id === 'WI-A' ? 'DV-A' : 'DV-B' };
      }) };
      const workItems = { loadTenantScopedProjection: jest.fn(async (id: string, tenant: string) => {
        expect(tenant).toBe('tenant-A');
        expect(events).toContain(`authorized:${id}`);
        events.push(`projection:${id}`);
        await new Promise(resolve => setTimeout(resolve, 60));
        events.push(`projection-done:${id}`);
        return workItem(id);
      }) };
      const documentVersions = { resolveIdentity: jest.fn(async (id: string) => {
        expect(events).toContain(`authorized:${id === 'DV-A' ? 'WI-A' : 'WI-B'}`);
        events.push(`source:${id}`);
        await new Promise(resolve => setTimeout(resolve, 80));
        events.push(`source-done:${id}`);
        return documentVersion(id);
      }) };
      const service = serviceWith({ objectAccess, workItems, documentVersions });
      const start = Date.now();
      const pending = service.resolveWorkingBasis('MAT-1', actor());
      await jest.runAllTimersAsync();
      expect((await pending).currentInputs).toHaveLength(2);
      expect(Date.now() - start).toBe(100); // ACL + max(projection, source), not their sum
      expect(events.filter(event => event.includes('-done:'))).toHaveLength(4);
    } finally { jest.useRealTimers(); }
  });

  it('does not launch either dependent read after fresh access is denied', async () => {
    const workItems = { loadTenantScopedProjection: jest.fn() };
    const documentVersions = { resolveIdentity: jest.fn() };
    const service = serviceWith({ workItems, documentVersions,
      objectAccess: { freshRead: jest.fn().mockResolvedValue({ allowed: false, code: 'REVOKED', statusCode: 403 }) } });
    await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({ code: 'REVOKED' });
    expect(workItems.loadTenantScopedProjection).not.toHaveBeenCalled();
    expect(documentVersions.resolveIdentity).not.toHaveBeenCalled();
  });

  it('settles a slower source failure before returning the original tenant lookup failure', async () => {
    jest.useFakeTimers();
    try {
      let activeSources = 0;
      const documentVersions = { resolveIdentity: jest.fn(async () => {
        activeSources++;
        await new Promise(resolve => setTimeout(resolve, 80));
        activeSources--;
        throw new Error('DOCUMENT_VERSION_NOT_FOUND');
      }) };
      const service = serviceWith({ documentVersions,
        matters: { loadCurrent: jest.fn().mockResolvedValue({ ...snapshot, links: snapshot.links.slice(0, 1) }) },
        workItems: { loadTenantScopedProjection: jest.fn().mockRejectedValue(new Error('TENANT_READ_FAILED')) } });
      const pending = service.readWorking('MAT-1', actor()).catch(error => ({ error, activeSources }));
      await jest.runAllTimersAsync();
      expect(await pending).toMatchObject({ error: new Error('TENANT_READ_FAILED'), activeSources: 0 });
    } finally { jest.useRealTimers(); }
  });

  it.each(['missing', 'changed-version', 'projection-mismatch', 'source-mismatch', 'source-missing']) (
    'still rejects %s after independent reads settle', async kind => {
      const scoped = workItem('WI-A');
      if (kind === 'changed-version') scoped.row.documentVersionId = 'DV-CHANGED';
      if (kind === 'projection-mismatch') scoped.projection.source.documentVersionId = 'DV-OTHER';
      const source = documentVersion('DV-A');
      if (kind === 'source-mismatch') source.version.documentId = 'DOC-OTHER';
      const documentVersions = { resolveIdentity: kind === 'source-missing'
        ? jest.fn().mockRejectedValue(new Error('DOCUMENT_VERSION_NOT_FOUND'))
        : jest.fn().mockResolvedValue(source) };
      const service = serviceWith({ documentVersions,
        matters: { loadCurrent: jest.fn().mockResolvedValue({ ...snapshot, links: snapshot.links.slice(0, 1) }) },
        workItems: { loadTenantScopedProjection: jest.fn().mockResolvedValue(kind === 'missing' ? null : scoped) } });
      const code = kind === 'missing' || kind === 'changed-version'
        ? 'CANONICAL_WORK_ITEM_NOT_FOUND' : kind === 'source-missing'
          ? 'DOCUMENT_VERSION_NOT_FOUND' : 'ENGINEERING_MATTER_WORK_ITEM_DOCUMENT_CONFLICT';
      await expect(service.readWorking('MAT-1', actor())).rejects.toMatchObject({ code });
      expect(documentVersions.resolveIdentity).toHaveBeenCalledWith('DV-A');
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
    documentVersions?: Record<string, jest.Mock>;
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
      loadTenantScopedProjection: jest
        .fn()
        .mockImplementation((workItemId: string) =>
          Promise.resolve(workItem(workItemId)),
        ),
    } as const);
  const documentVersions =
    overrides.documentVersions ??
    ({
      resolveIdentity: jest
        .fn()
        .mockImplementation((documentVersionId: string) =>
          Promise.resolve(documentVersion(documentVersionId)),
        ),
    } as const);
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
    documentVersions as unknown as MiaodaDocumentVersionSourceResolver,
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
    },
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
