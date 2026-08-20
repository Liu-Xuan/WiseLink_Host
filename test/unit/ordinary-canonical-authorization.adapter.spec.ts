import {
  OrdinaryCanonicalAuthorizationAdapter,
  OrdinaryCanonicalPermissionSnapshotAdapter,
} from '../../server/modules/canonical-host/ordinary-canonical-authorization.adapter';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type { WorkItemAuthorizationBinding } from '../../server/modules/work-item/miaoda-work-item.repository';

const creator: CanonicalHostActor = {
  userId: 'user-creator',
  tenantId: 'tenant-a',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'test',
};

const binding: WorkItemAuthorizationBinding = {
  workItemId: 'WI-1',
  tenantId: creator.tenantId,
  requestId: 'REQ-1',
  documentId: 'DOC-1',
  documentVersionId: 'DV-1',
  requestedByUserId: creator.userId,
  runKey: 'RUN-1',
};

function target(result: WorkItemAuthorizationBinding | null = binding) {
  const repository = {
    loadAuthorizationBinding: jest.fn().mockResolvedValue(result),
  };
  return {
    repository,
    authorization: new OrdinaryCanonicalAuthorizationAdapter(
      repository as never,
    ),
    snapshots: new OrdinaryCanonicalPermissionSnapshotAdapter(
      repository as never,
    ),
  };
}

describe('ordinary canonical object authorization', () => {
  it('allows the creator and binds the decision and snapshot to object facts', async () => {
    const { repository, authorization, snapshots } = target();
    const decision = await authorization.authorize({
      actor: creator,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: binding.workItemId,
      requestId: binding.requestId,
      documentVersionId: binding.documentVersionId,
    });
    const fresh = await snapshots.freshRead({
      actor: creator,
      decision,
      workItemId: binding.workItemId,
      requestId: binding.requestId,
      documentVersionId: binding.documentVersionId,
    });

    expect(decision.allowed).toBe(true);
    expect(fresh.permissionSnapshotVersion).toBe(
      decision.permissionSnapshotVersion,
    );
    expect(repository.loadAuthorizationBinding).toHaveBeenNthCalledWith(1, {
      workItemId: binding.workItemId,
      tenantId: creator.tenantId,
      actorUserId: creator.userId,
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['cross-tenant actor', { ...creator, tenantId: 'tenant-b' }],
    ['same-tenant outsider', { ...creator, userId: 'user-outsider' }],
    [
      'development-role outsider',
      {
        ...creator,
        userId: 'user-outsider',
        roles: ['wiselink_development'],
      },
    ],
  ])('returns the same not-found boundary for %s', async (_label, actor) => {
    const { repository, authorization } = target(null);

    await expect(
      authorization.authorize({
        actor,
        action: 'READ_DOCUMENT_PARSING',
        workItemId: binding.workItemId,
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledWith({
      workItemId: binding.workItemId,
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
    });
  });

  it('rejects actor tenant drift during snapshot fresh-read', async () => {
    const { repository, authorization, snapshots } = target();
    const decision = await authorization.authorize({
      actor: creator,
      action: 'READ_LIBRARY_INDEX',
      workItemId: binding.workItemId,
    });
    repository.loadAuthorizationBinding.mockResolvedValueOnce(null);

    await expect(
      snapshots.freshRead({
        actor: { ...creator, tenantId: 'tenant-drifted' },
        decision,
        workItemId: binding.workItemId,
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('changes the fresh snapshot when object authorization facts change', async () => {
    const { repository, authorization, snapshots } = target();
    const decision = await authorization.authorize({
      actor: creator,
      action: 'READ_LIBRARY_INDEX',
      workItemId: binding.workItemId,
    });
    repository.loadAuthorizationBinding.mockResolvedValueOnce({
      ...binding,
      requestId: 'REQ-CHANGED',
    });
    const fresh = await snapshots.freshRead({
      actor: creator,
      decision,
      workItemId: binding.workItemId,
    });

    expect(fresh.permissionSnapshotVersion).not.toBe(
      decision.permissionSnapshotVersion,
    );
  });
});
