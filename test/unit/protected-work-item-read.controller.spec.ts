import 'reflect-metadata';

// Mock NestJS decorators that crash under ts-jest stage-3 ES decorators.
jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Controller: noOpDecorator,
    Get: noOpDecorator,
    Inject: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
    Query: noOpDecorator,
    Param: noOpDecorator,
    HttpCode: noOpDecorator,
    HttpException: actual.HttpException,
    HttpStatus: actual.HttpStatus,
    Logger: actual.Logger,
  };
});

import { ProtectedWorkItemReadController } from '../../server/modules/identity/protected-work-item-read.controller';
import { SessionResolver } from '../../server/modules/identity/session-resolver.service';
import type { CanonicalObjectAccessPort, CanonicalObjectAccessResult } from '../../server/modules/work-item/canonical-object-access.port';
import type { VerifiedIdentity } from '../../server/modules/identity/identity.types';
import type { ResolvedSession } from '../../server/modules/identity/session-resolver.service';

const IDENTITY: VerifiedIdentity = {
  provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
  miaodaUserId: 'miaoda_user_001',
  tenantId: '2001',
  feishuUserId: 'emp_001',
  feishuOpenId: 'ou_valid_001',
  namespacedSubject: {
    namespace: 'FEISHU_OPEN_ID',
    subject: 'ou_valid_001',
    tenantKey: 'tkey_a',
  },
  verifiedAt: '2026-08-23T10:00:00.000Z',
};

const ACTOR = {
  principalKind: 'FINAL_USER' as const,
  transport: 'MIAODA_AUTHENTICATED_HTTP' as const,
  canonicalSubject: { namespace: 'MIAODA_USER_ID' as const, id: 'miaoda_user_001' },
  subjectDecision: {
    source: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' as const,
    applicationScopeId: 'app_test',
    tenantId: '2001',
    version: 'feishu-oauth-verified.v1',
    decidedAt: '2026-08-23T10:00:00.000Z',
  },
  tenantId: '2001',
  applicationScopeId: 'app_test',
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT' as const,
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE' as const,
  env: 'development',
  platformRoles: [],
  identityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' as const,
  feishuUserId: 'emp_001',
  feishuOpenId: 'ou_valid_001',
  feishuIdentityProvenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN' as const,
  sessionId: 'session-token',
  sessionRevision: 1,
  sessionProvenance: 'SERVER_OPAQUE_SESSION' as const,
};

function mockSessionResolver(
  resolved: ResolvedSession | null,
): jest.Mocked<SessionResolver> {
  return {
    resolve: jest.fn().mockReturnValue(resolved),
  } as unknown as jest.Mocked<SessionResolver>;
}

function mockObjectAccess(
  result: CanonicalObjectAccessResult,
): jest.Mocked<CanonicalObjectAccessPort> {
  return {
    freshRead: jest.fn().mockResolvedValue(result),
  } as unknown as jest.Mocked<CanonicalObjectAccessPort>;
}

const GRANT: CanonicalObjectAccessResult = {
  allowed: true,
  action: 'READ_WORK_ITEM',
  accessRoot: { kind: 'WORK_ITEM', id: 'WI-001' },
  workItemId: 'WI-001',
  workItemRevision: 0,
  requestId: 'REQ-001',
  documentVersionId: 'DV-001',
  tenantId: '2001',
  applicationScopeId: 'app_test',
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE',
  actorUserId: 'miaoda_user_001',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'miaoda_user_001' },
  actorFingerprint: 'sha256:abc',
  ownerFact: {
    isOwner: true,
    ownerUserId: 'miaoda_user_001',
    source: 'HOST_WORK_ITEM_REQUESTED_BY',
  },
  memberFact: { isMember: false, source: 'UNAVAILABLE' },
  actionPolicy: {
    action: 'READ_WORK_ITEM',
    objectRelation: 'OWNER',
    source: 'HOST_SERVER_ACTION_POLICY',
    requiredPlatformRoles: [],
    platformRoleEvaluation: 'NOT_REQUIRED',
    policyRevision: 'creator-only.v1',
  },
  accessRevision: 'work-item:0:creator-only.v1',
  authorizationFingerprint: 'sha256:def',
  freshReadAt: '2026-08-23T10:01:00.000Z',
  auditProvenance: {
    identity: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScope: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspace: 'UNAVAILABLE',
    objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY',
    memberAuthorization: 'UNAVAILABLE',
    session: 'UNAVAILABLE',
    correlationFieldsAreAuthorizationInputs: false,
    platformRolesAreObjectGrantInputs: false,
    platformRolesMayBeActionPolicyInputs: true,
  },
};

const DENY_503: CanonicalObjectAccessResult = {
  allowed: false,
  action: 'READ_WORK_ITEM',
  accessRoot: { kind: 'WORK_ITEM', id: 'WI-001' },
  code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
  statusCode: 503,
  denialSource: 'MIAODA_BROWSER_UNAVAILABLE_ADAPTER',
};

const DENY_404: CanonicalObjectAccessResult = {
  allowed: false,
  action: 'READ_WORK_ITEM',
  accessRoot: { kind: 'WORK_ITEM', id: 'WI-001' },
  code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
  statusCode: 404,
  denialSource: 'MIAODA_OBJECT_ACCESS',
};

describe('ProtectedWorkItemReadController', () => {
  // ── 401: no session ──
  it('returns 401 when no session is present', async () => {
    const resolver = mockSessionResolver(null);
    const access = mockObjectAccess(GRANT);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    await expect(
      controller.readWorkItem('WI-001', { headers: {} } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 401, code: 'SESSION_REQUIRED' },
    });
    expect(access.freshRead).not.toHaveBeenCalled();
  });

  // ── 400: empty workItemId ──
  it('returns 400 when workItemId is empty', async () => {
    const resolver = mockSessionResolver({ identity: IDENTITY, actor: ACTOR });
    const access = mockObjectAccess(GRANT);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    await expect(
      controller.readWorkItem('', { headers: {} } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 400 },
    });
  });

  // ── 503: ACL denial (unavailable adapter) ──
  it('throws 503 when ACL port denies with identity handoff unavailable', async () => {
    const resolver = mockSessionResolver({ identity: IDENTITY, actor: ACTOR });
    const access = mockObjectAccess(DENY_503);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    await expect(
      controller.readWorkItem('WI-001', { headers: {} } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 503 },
    });
    expect(access.freshRead).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI-001' },
      }),
    );
  });

  // ── 404: ACL denial (non-owner / cross-tenant) ──
  it('throws 404 when ACL port denies with work item not found', async () => {
    const resolver = mockSessionResolver({ identity: IDENTITY, actor: ACTOR });
    const access = mockObjectAccess(DENY_404);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    await expect(
      controller.readWorkItem('WI-001', { headers: {} } as never),
    ).rejects.toMatchObject({
      response: { statusCode: 404 },
    });
  });

  // ── 200: grant ──
  it('returns workItemId and actor info on grant', async () => {
    const resolver = mockSessionResolver({ identity: IDENTITY, actor: ACTOR });
    const access = mockObjectAccess(GRANT);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    const result = await controller.readWorkItem(
      'WI-001',
      { headers: {} } as never,
    );

    expect(result.workItemId).toBe('WI-001');
    expect(result.access.allowed).toBe(true);
    expect(result.actor.miaodaUserId).toBe('miaoda_user_001');
    expect(result.actor.identityProvenance).toBe('FEISHU_OAUTH_USER_ACCESS_TOKEN');
    expect(result.actor.sessionProvenance).toBe('SERVER_OPAQUE_SESSION');
  });

  // ── ACL preflight: the actor submitted to the port comes from the session,
  //    not from any caller field ──
  it('submits the session actor to the ACL port (not caller headers)', async () => {
    const resolver = mockSessionResolver({ identity: IDENTITY, actor: ACTOR });
    const access = mockObjectAccess(GRANT);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    await controller.readWorkItem('WI-001', {
      headers: {
        // Attacker tries to inject identity via header (R08 violation)
        'x-miaoda-user-id': 'attacker-evil-user',
        'x-feishu-open-id': 'ou_attacker',
        authorization: 'Bearer attacker-fake-token',
      },
    } as never);

    // The actor in the freshRead call must be the session actor, not the
    // attacker's header values.
    const submittedActor = access.freshRead.mock.calls[0][0].actor;
    expect(submittedActor.canonicalSubject.id).toBe('miaoda_user_001');
    expect(submittedActor.feishuOpenId).toBe('ou_valid_001');
    expect(submittedActor.canonicalSubject.id).not.toBe('attacker-evil-user');
  });

  // ── Object ID is not permission ──
  it('submits the requested workItemId as accessRoot even on denial', async () => {
    const resolver = mockSessionResolver({ identity: IDENTITY, actor: ACTOR });
    const access = mockObjectAccess(DENY_404);
    const controller = new ProtectedWorkItemReadController(resolver, access);

    await expect(
      controller.readWorkItem('WI-cross-tenant', { headers: {} } as never),
    ).rejects.toMatchObject({ response: { statusCode: 404 } });

    expect(access.freshRead).toHaveBeenCalledWith(
      expect.objectContaining({
        accessRoot: { kind: 'WORK_ITEM', id: 'WI-cross-tenant' },
      }),
    );
  });
});
