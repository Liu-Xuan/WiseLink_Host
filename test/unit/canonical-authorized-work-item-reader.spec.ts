import { authorizeAndLoadCanonicalWorkItem } from '../../server/modules/canonical-host/canonical-authorized-work-item-reader';

const actor = {
  userId: 'user-outsider',
  tenantId: 'tenant-a',
  appId: 'app_17bzc551rsg',
  roles: [] as string[],
  env: 'test',
};

describe('authorizeAndLoadCanonicalWorkItem', () => {
  it('does not load a full projection when object authorization is denied', async () => {
    const authorization = {
      authorize: jest.fn().mockRejectedValue(
        Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
          statusCode: 404,
        }),
      ),
    };
    const permissionSnapshots = { freshRead: jest.fn() };
    const registrar = { getTenantScopedByWorkItemId: jest.fn() };

    await expect(
      authorizeAndLoadCanonicalWorkItem({
        authorization: authorization as never,
        permissionSnapshots: permissionSnapshots as never,
        registrar: registrar as never,
        actor,
        action: 'RUN_AEO_CANDIDATE_LOOP',
        workItemId: 'WI-DIRECT-ID',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(permissionSnapshots.freshRead).not.toHaveBeenCalled();
    expect(registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });

  it('fresh-reads the permission snapshot before the full projection', async () => {
    const order: string[] = [];
    const decision = {
      action: 'RECORD_ENGINEER_REVIEW' as const,
      allowed: true,
      actorFingerprint: 'actor',
      decisionId: 'decision',
      decisionHash: 'hash',
      permissionSnapshotVersion: 'permission-1',
    };
    const authorization = {
      authorize: jest.fn(async () => {
        order.push('authorize');
        return decision;
      }),
    };
    const permissionSnapshots = {
      freshRead: jest.fn(async () => {
        order.push('snapshot');
        return { permissionSnapshotVersion: 'permission-1' };
      }),
    };
    const registrar = {
      getTenantScopedByWorkItemId: jest.fn(async () => {
        order.push('projection');
        return { workItemId: 'WI-1' };
      }),
    };

    await authorizeAndLoadCanonicalWorkItem({
      authorization: authorization as never,
      permissionSnapshots: permissionSnapshots as never,
      registrar: registrar as never,
      actor,
      action: 'RECORD_ENGINEER_REVIEW',
      workItemId: 'WI-1',
    });

    expect(order).toEqual(['authorize', 'snapshot', 'projection']);
  });

  it('rechecks a changed grant from the beginning before loading content', async () => {
    const order: string[] = [];
    const authorization = {
      authorize: jest.fn().mockImplementation(async () => {
        order.push('authorize');
        const version = order.filter(step => step === 'authorize').length;
        return {
          action: 'READ_DOCUMENT_PARSING',
          allowed: true,
          permissionSnapshotVersion: `permission-${version}`,
        };
      }),
    };
    const permissionSnapshots = {
      freshRead: jest.fn().mockImplementation(async () => {
        order.push('snapshot');
        return { permissionSnapshotVersion: 'permission-2' };
      }),
    };
    const registrar = {
      getTenantScopedByWorkItemId: jest.fn().mockImplementation(async () => {
        order.push('projection');
        return { workItemId: 'WI-1' };
      }),
    };

    const result = await authorizeAndLoadCanonicalWorkItem({
      authorization: authorization as never,
      permissionSnapshots: permissionSnapshots as never,
      registrar: registrar as never,
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: 'WI-1',
    });

    expect(order).toEqual(['authorize', 'snapshot', 'authorize', 'snapshot', 'projection']);
    expect(result.permissionSnapshotVersion).toBe('permission-2');
  });

  it('rejects a persistent grant mismatch without loading content', async () => {
    const authorization = {
      authorize: jest.fn().mockResolvedValue({
        action: 'READ_DOCUMENT_PARSING',
        allowed: true,
        permissionSnapshotVersion: 'permission-1',
      }),
    };
    const permissionSnapshots = {
      freshRead: jest.fn().mockResolvedValue({
        permissionSnapshotVersion: 'permission-2',
      }),
    };
    const registrar = { getTenantScopedByWorkItemId: jest.fn() };

    await expect(authorizeAndLoadCanonicalWorkItem({
      authorization: authorization as never,
      permissionSnapshots: permissionSnapshots as never,
      registrar: registrar as never,
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: 'WI-1',
    })).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });

    expect(authorization.authorize).toHaveBeenCalledTimes(2);
    expect(permissionSnapshots.freshRead).toHaveBeenCalledTimes(2);
    expect(registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });

  it('does not load content if permission is revoked before the second check', async () => {
    const authorization = {
      authorize: jest.fn()
        .mockResolvedValueOnce({
          action: 'READ_DOCUMENT_PARSING',
          allowed: true,
          permissionSnapshotVersion: 'permission-1',
        })
        .mockRejectedValueOnce(Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
          code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
          statusCode: 404,
        })),
    };
    const permissionSnapshots = {
      freshRead: jest.fn().mockResolvedValue({
        permissionSnapshotVersion: 'permission-2',
      }),
    };
    const registrar = { getTenantScopedByWorkItemId: jest.fn() };

    await expect(authorizeAndLoadCanonicalWorkItem({
      authorization: authorization as never,
      permissionSnapshots: permissionSnapshots as never,
      registrar: registrar as never,
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: 'WI-1',
    })).rejects.toMatchObject({ code: 'CANONICAL_WORK_ITEM_NOT_FOUND' });

    expect(registrar.getTenantScopedByWorkItemId).not.toHaveBeenCalled();
  });
});
