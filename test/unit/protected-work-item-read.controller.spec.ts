import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return { ...actual, Controller: noOp, Get: noOp, Inject: noOp, Param: noOp, Req: noOp };
});

import { ProtectedWorkItemReadController } from '../../server/modules/identity/protected-work-item-read.controller';

const actor = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'miaoda-user-1' },
  tenantId: 'tenant-1',
  identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  feishuOpenId: 'ou_valid_001',
  sessionProvenance: 'SERVER_OPAQUE_SESSION',
};
const request = {
  headers: { cookie: 'wl_session=opaque-cookie', 'x-user-id': 'forged' },
  body: { userId: 'forged', tenantId: 'forged', agentId: 'agent_4km47c77ujwqphg' },
};

describe('ProtectedWorkItemReadController session-only ACL', () => {
  it('rejects list_my_workitems without a valid session', async () => {
    const { controller } = makeController(null);
    await expect(controller.listMyWorkItems(request as never)).rejects.toMatchObject({ status: 401 });
  });

  it('fresh-lists only the session actor owner/tenant and ignores caller identity fields', async () => {
    const { controller, workItems } = makeController({ actor });
    workItems.listOwnedWorkItems.mockResolvedValue([]);
    await controller.listMyWorkItems(request as never);
    expect(workItems.listOwnedWorkItems).toHaveBeenCalledWith({ tenantId: 'tenant-1', actorUserId: 'miaoda-user-1' });
  });

  it('rejects a single-item read without a valid session', async () => {
    const controller = makeController(null).controller;
    await expect(controller.readWorkItem('WI-1', request as never)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an empty workItem id before object I/O', async () => {
    const { controller, objectAccess } = makeController({ actor });
    await expect(controller.readWorkItem('', request as never)).rejects.toMatchObject({ status: 400 });
    expect(objectAccess.freshRead).not.toHaveBeenCalled();
  });

  it('propagates a fresh creator-only ACL denial and does not load object data', async () => {
    const { controller, objectAccess, workItems } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({
      allowed: false, action: 'READ_WORK_ITEM', accessRoot: { kind: 'WORK_ITEM', id: 'WI-other' },
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404, denialSource: 'MIAODA_OBJECT_ACCESS',
    });
    await expect(controller.readWorkItem('WI-other', request as never)).rejects.toMatchObject({ status: 404 });
    expect(workItems.loadTenantScopedProjection).not.toHaveBeenCalled();
  });

  it('propagates a 503 identity-handoff denial', async () => {
    const { controller, objectAccess } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({
      allowed: false, action: 'READ_WORK_ITEM', accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE', statusCode: 503,
      denialSource: 'SESSION_UNAVAILABLE_ADAPTER',
    });
    await expect(controller.readWorkItem('WI-1', request as never)).rejects.toMatchObject({ status: 503 });
  });

  it('keeps cross-tenant access indistinguishable from a missing WorkItem', async () => {
    const { controller, objectAccess, workItems } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({
      allowed: false, action: 'READ_WORK_ITEM', accessRoot: { kind: 'WORK_ITEM', id: 'WI-cross-tenant' },
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404, denialSource: 'MIAODA_OBJECT_ACCESS',
    });
    await expect(controller.readWorkItem('WI-cross-tenant', request as never)).rejects.toMatchObject({ status: 404 });
    expect(workItems.loadTenantScopedProjection).not.toHaveBeenCalled();
  });

  it('submits only the session ActorContext to freshRead', async () => {
    const { controller, objectAccess, workItems } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({ allowed: true, workItemId: 'WI-1' });
    workItems.loadTenantScopedProjection.mockResolvedValue({
      row: { revision: 2, status: 'READY', documentVersionId: 'DV-1' }, projection: { revision: 2 },
    });
    await controller.readWorkItem('WI-1', request as never);
    expect(objectAccess.freshRead).toHaveBeenCalledWith({ actor, action: 'READ_WORK_ITEM', accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' } });
    const submitted = objectAccess.freshRead.mock.calls[0][0].actor;
    expect(submitted.canonicalSubject.id).toBe('miaoda-user-1');
    expect(submitted.feishuOpenId).toBe('ou_valid_001');
    expect(submitted.canonicalSubject.id).not.toBe('forged');
  });

  it('binds the exact requested workItemId as accessRoot even on denial', async () => {
    const { controller, objectAccess } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({
      allowed: false, action: 'READ_WORK_ITEM', accessRoot: { kind: 'WORK_ITEM', id: 'WI-requested' },
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404, denialSource: 'MIAODA_OBJECT_ACCESS',
    });
    await expect(controller.readWorkItem('WI-requested', request as never)).rejects.toMatchObject({ status: 404 });
    expect(objectAccess.freshRead).toHaveBeenCalledWith({
      actor,
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-requested' },
    });
  });

  it('loads and returns the tenant-scoped row only after the ACL grant', async () => {
    const { controller, objectAccess, workItems } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({ allowed: true, workItemId: 'WI-1' });
    workItems.loadTenantScopedProjection.mockResolvedValue({
      row: { revision: 2, status: 'READY', documentVersionId: 'DV-1' }, projection: { revision: 2 },
    });
    const result = await controller.readWorkItem('WI-1', request as never);
    expect(workItems.loadTenantScopedProjection).toHaveBeenCalledWith('WI-1', 'tenant-1');
    expect(result).toMatchObject({ workItemId: 'WI-1', revision: 2, status: 'READY', documentVersionId: 'DV-1' });
    expect(JSON.stringify(result)).not.toContain('forged');
  });

  it('reports OAuth + opaque-session provenance without exposing the cookie', async () => {
    const { controller, objectAccess, workItems } = makeController({ actor });
    objectAccess.freshRead.mockResolvedValue({ allowed: true, workItemId: 'WI-1' });
    workItems.loadTenantScopedProjection.mockResolvedValue({
      row: { revision: 1, status: 'READY', documentVersionId: 'DV-1' }, projection: null,
    });
    const result = await controller.readWorkItem('WI-1', request as never);
    expect(result.actor).toEqual({
      identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
      miaodaUserId: 'miaoda-user-1',
      tenantId: 'tenant-1',
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
    });
    expect(JSON.stringify(result)).not.toContain('opaque-cookie');
  });
});

function makeController(resolved: unknown) {
  const sessions = { resolve: jest.fn().mockResolvedValue(resolved) };
  const objectAccess = { freshRead: jest.fn() };
  const workItems = { listOwnedWorkItems: jest.fn(), loadTenantScopedProjection: jest.fn() };
  return {
    controller: new ProtectedWorkItemReadController(sessions as never, objectAccess as never, workItems as never),
    sessions, objectAccess, workItems,
  };
}
