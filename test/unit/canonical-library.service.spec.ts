import { CanonicalLibraryService } from '../../server/modules/canonical-host/canonical-library.service';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import { syntheticMiaodaActorFixture } from '../fixtures/synthetic-development-canonical-object-access.adapter';
import {
  libraryDocument,
  libraryFamily,
  libraryQuicklook,
} from './fixtures/canonical-library';

const identity = syntheticMiaodaActorFixture('reader-a', 'tenant-a');
identity.env = 'preview';
identity.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
const actor: CanonicalHostActor = {
  userId: 'reader-a',
  tenantId: 'tenant-a',
  appId: 'app_17bzc551rsg',
  env: 'preview',
  roles: [],
  objectAccessActor: identity,
};
function row(id: string) {
  const {
    sourceReadability: _unread,
    createdAt,
    updatedAt,
    ...rest
  } = libraryDocument(id);
  return {
    ...rest,
    createdAt: new Date(createdAt),
    updatedAt: new Date(updatedAt),
  };
}
function target() {
  const repository = {
    listTasks: jest
      .fn()
      .mockResolvedValue([row('WI-C'), row('WI-B'), row('WI-A')]),
    listDocuments: jest.fn().mockResolvedValue([
      {
        totalCount: 3,
        familyCounts: { SB: 3 },
        ataCounts: {},
        aircraftModelCounts: {},
        rows: ['family-c', 'family-b', 'family-a'].map((id) => {
          const item = libraryFamily(id);
          return {
            ...item,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          };
        }),
      },
    ]),
    quicklook: jest.fn().mockResolvedValue({
      ...row('WI-B'),
      result: libraryQuicklook('WI-B').result,
    }),
  };
  const authorization = {
    authorize: jest.fn().mockResolvedValue({
      action: 'READ_LIBRARY_INDEX',
      allowed: true,
      permissionSnapshotVersion: 'p-1',
    }),
  };
  const permissions = {
    freshRead: jest
      .fn()
      .mockResolvedValue({ permissionSnapshotVersion: 'p-1' }),
  };
  const fleet = {
    readLibraryCatalog: jest.fn().mockResolvedValue({
      status: 'AVAILABLE',
      asOf: '2026-09-10',
      source: { sourceSnapshotId: 'fleet-1', authorityRevision: '1' },
      families: [{ fleetFamily: '787', models: ['787-9', '787-10'] }],
    }),
  };
  return {
    fleet,
    repository,
    authorization,
    permissions,
    service: new CanonicalLibraryService(
      repository as never,
      authorization as never,
      permissions as never,
      undefined,
      fleet as never,
    ),
  };
}

describe('database-backed canonical library', () => {
  it('resolves parent/child classifications from the tenant catalog and binds cursors to its revision', async () => {
    const { service, repository, fleet } = target();
    const parent = await service.list(
      { fleetFamily: ' 787 ', limit: 2 },
      actor,
    );
    expect(fleet.readLibraryCatalog).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      asOf: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
    });
    expect(
      repository.listDocuments.mock.calls[0][0].fleetMentionValues,
    ).toEqual(['787', '787-9', '787-10']);
    await service.list({ fleetFamily: '787', fleetModel: '787-9' }, actor);
    expect(
      repository.listDocuments.mock.calls[1][0].fleetMentionValues,
    ).toEqual(['787-9']);
    await expect(service.list({ fleetFamily: '737' }, actor)).rejects.toThrow(
      'LIBRARY_FLEET_FILTER_INVALID',
    );
    await expect(service.list({ fleetModel: '787-9' }, actor)).rejects.toThrow(
      'LIBRARY_FLEET_FILTER_INVALID',
    );
    fleet.readLibraryCatalog.mockResolvedValue({
      status: 'AVAILABLE',
      asOf: '2026-09-10',
      source: { sourceSnapshotId: 'fleet-2', authorityRevision: '2' },
      families: [{ fleetFamily: '787', models: ['787-9'] }],
    });
    await expect(
      service.list({ fleetFamily: '787', cursor: parent.nextCursor! }, actor),
    ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
  });

  it('distinguishes missing and failed catalog reads without blocking all documents or bypassing identity', async () => {
    const { service, fleet, repository } = target();
    fleet.readLibraryCatalog.mockResolvedValue({
      status: 'MISSING',
      source: null,
      families: [],
    });
    expect(await service.fleetCatalog(actor)).toMatchObject({
      status: 'MISSING',
    });
    await expect(
      service.list({ fleetFamily: '787' }, actor),
    ).rejects.toMatchObject({
      response: { code: 'LIBRARY_FLEET_CATALOG_MISSING' },
    });
    fleet.readLibraryCatalog.mockRejectedValue(new Error('database down'));
    await expect(service.fleetCatalog(actor)).rejects.toMatchObject({
      response: { code: 'LIBRARY_FLEET_CATALOG_READ_FAILED' },
    });
    await service.list({}, actor);
    expect(repository.listDocuments).toHaveBeenCalledTimes(1);
    fleet.readLibraryCatalog.mockClear();
    await expect(
      service.fleetCatalog({ ...actor, tenantId: 'other' }),
    ).rejects.toThrow('CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE');
    expect(fleet.readLibraryCatalog).not.toHaveBeenCalled();
  });
  it('paginates a fresh owner-scoped database directory without any file dependencies', async () => {
    const { service, repository } = target();
    const first = await service.listTasks({ search: '737', limit: 2 }, actor);
    expect(repository.listTasks).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      search: '737',
      cursor: null,
      limit: 2,
      familyId: '',
    });
    expect(first.items.map((item) => item.workItemId)).toEqual([
      'WI-C',
      'WI-B',
    ]);
    expect(first.fileReadPerformed).toBe(false);
    expect(
      first.items.every((item) => item.sourceReadability === 'NOT_CHECKED'),
    ).toBe(true);
    await service.listTasks(
      { search: '737', limit: 2, cursor: first.nextCursor! },
      actor,
    );
    expect(repository.listTasks.mock.calls[1][0].cursor).toEqual({
      createdAt: '2026-09-05T09:00:00.000Z',
      itemId: 'WI-B',
    });
    await expect(
      service.listTasks(
        { search: 'changed', cursor: first.nextCursor! },
        actor,
      ),
    ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
  });

  it('pages DM families with their complete visible version history, independently of task results', async () => {
    const { service, repository } = target();
    const first = await service.list({ search: 'old.pdf', limit: 2 }, actor);
    expect(first.scope).toBe('CURRENT_USER_DOCUMENT_CATALOG');
    expect(first.items.map((item) => item.familyId)).toEqual([
      'family-c',
      'family-b',
    ]);
    expect(first.items[0]).toEqual(libraryFamily('family-c'));
    expect(first.items[0]).not.toHaveProperty('phase');
    expect(first.items[0]).not.toHaveProperty('workItemId');
    expect(repository.listTasks).not.toHaveBeenCalled();
    await service.list(
      { search: 'old.pdf', limit: 2, cursor: first.nextCursor! },
      actor,
    );
    expect(repository.listDocuments.mock.calls[1][0]).toMatchObject({
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      cursor: { itemId: 'family-b', createdAt: first.items[1].createdAt },
    });
    await expect(
      service.listTasks(
        { search: 'old.pdf', cursor: first.nextCursor! },
        actor,
      ),
    ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
  });

  it('keeps task cursors bound to the selected family', async () => {
    const { service, repository } = target();
    const first = await service.listTasks(
      { familyId: 'family-a', limit: 2 },
      actor,
    );
    expect(repository.listTasks.mock.calls[0][0].familyId).toBe('family-a');
    await expect(
      service.listTasks(
        { familyId: 'family-b', cursor: first.nextCursor! },
        actor,
      ),
    ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
    await expect(
      service.list({ cursor: first.nextCursor! }, actor),
    ).rejects.toThrow('LIBRARY_CURSOR_INVALID');
    expect(repository.listDocuments).not.toHaveBeenCalled();
  });

  it('returns a version-bound saved result only after the existing fresh authorization', async () => {
    const { service, repository, authorization, permissions } = target();
    const result = await service.quicklook('WI-B', actor);
    expect(authorization.authorize).toHaveBeenCalledWith({
      actor,
      workItemId: 'WI-B',
      action: 'READ_LIBRARY_INDEX',
    });
    expect(permissions.freshRead).toHaveBeenCalledTimes(1);
    expect(repository.quicklook).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      actorUserId: 'reader-a',
      workItemId: 'WI-B',
    });
    expect(result.result?.sourceResultId).toBe('result-2');
    expect(result.document).not.toHaveProperty('result');
    expect(result.fileReadPerformed).toBe(false);
  });

  it('rejects identity/owner drift before querying rows, regardless of platform roles', async () => {
    const { service, repository } = target();
    await expect(
      service.list(
        {},
        { ...actor, userId: 'reader-b', roles: ['unrelated-role'] },
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
    await expect(
      service.listTasks({}, { ...actor, tenantId: 'tenant-b' }),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(repository.listDocuments).not.toHaveBeenCalled();
    expect(repository.listTasks).not.toHaveBeenCalled();
  });

  it('uses the same missing/denied boundary and never reads a denied quicklook', async () => {
    const { service, repository, authorization } = target();
    authorization.authorize.mockResolvedValueOnce({
      action: 'READ_LIBRARY_INDEX',
      allowed: false,
      permissionSnapshotVersion: 'p-1',
    });
    await expect(service.quicklook('WI-OTHER', actor)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(repository.quicklook).not.toHaveBeenCalled();
  });

  it('rejects invalid paging and permission drift without reading source data', async () => {
    const { service, repository, permissions } = target();
    await expect(service.list({ limit: 51 }, actor)).rejects.toThrow(
      'LIBRARY_LIMIT_INVALID',
    );
    await expect(service.list({ cursor: 'invalid' }, actor)).rejects.toThrow(
      'LIBRARY_CURSOR_INVALID',
    );
    expect(repository.listDocuments).not.toHaveBeenCalled();
    permissions.freshRead.mockResolvedValueOnce({
      permissionSnapshotVersion: 'p-2',
    });
    await expect(service.quicklook('WI-B', actor)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(repository.quicklook).not.toHaveBeenCalled();
  });
});
