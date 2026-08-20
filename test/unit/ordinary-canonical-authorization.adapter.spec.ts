import {
  OrdinaryCanonicalAuthorizationAdapter,
  OrdinaryCanonicalPermissionSnapshotAdapter,
} from '../../server/modules/canonical-host/ordinary-canonical-authorization.adapter';
import type { CanonicalHostActor } from '../../server/modules/canonical-host/canonical-host.types';
import type {
  CanonicalMiaodaFinalUserActorContext,
  CanonicalObjectAccessGrant,
  CanonicalObjectAccessPort,
} from '../../server/modules/work-item/canonical-object-access.port';
import { CanonicalObjectAccessRouter } from '../../server/modules/work-item/canonical-object-access.router';
import {
  UnavailableAilyObjectAccessAdapter,
  UnavailableMiaodaBrowserObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} from '../../server/modules/work-item/unavailable-canonical-object-access.adapters';

const visibleActorFields: CanonicalMiaodaFinalUserActorContext = {
  principalKind: 'FINAL_USER',
  transport: 'MIAODA_AUTHENTICATED_HTTP',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user-creator' },
  subjectDecision: {
    source: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScopeId: 'app_17bzc551rsg',
    tenantId: 'tenant-a',
    version: 'miaoda-user-context.v1',
    decidedAt: '2026-08-20T00:00:00.000Z',
  },
  tenantId: 'tenant-a',
  applicationScopeId: 'app_17bzc551rsg',
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE',
  env: 'test',
  platformRoles: [],
  identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
  feishuUserId: null,
  feishuOpenId: null,
  feishuIdentityProvenance: 'UNAVAILABLE',
  sessionId: null,
  sessionRevision: null,
  sessionProvenance: 'UNAVAILABLE',
};

const creator: CanonicalHostActor = {
  userId: 'user-creator',
  tenantId: 'tenant-a',
  appId: 'app_17bzc551rsg',
  roles: [],
  env: 'test',
  objectAccessActor: visibleActorFields,
};

const grant: CanonicalObjectAccessGrant = {
  allowed: true,
  action: 'READ_DOCUMENT_PARSING',
  accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
  workItemId: 'WI-1',
  workItemRevision: 7,
  requestId: 'REQ-1',
  documentVersionId: 'DV-1',
  tenantId: 'tenant-a',
  applicationScopeId: 'app_17bzc551rsg',
  applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
  workspaceId: null,
  workspaceProvenance: 'UNAVAILABLE',
  actorUserId: 'user-creator',
  canonicalSubject: { namespace: 'MIAODA_USER_ID', id: 'user-creator' },
  actorFingerprint: 'sha256:actor',
  ownerFact: {
    isOwner: true,
    ownerUserId: 'user-creator',
    source: 'HOST_WORK_ITEM_REQUESTED_BY',
  },
  memberFact: { isMember: false, source: 'UNAVAILABLE' },
  actionPolicy: {
    action: 'READ_DOCUMENT_PARSING',
    objectRelation: 'OWNER',
    source: 'HOST_SERVER_ACTION_POLICY',
    requiredPlatformRoles: [],
    platformRoleEvaluation: 'NOT_REQUIRED',
    policyRevision: 'creator-only.v1',
  },
  accessRevision: 'work-item:7:creator-only.v1',
  authorizationFingerprint: 'sha256:authorization',
  freshReadAt: '2026-08-20T00:00:00.000Z',
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

describe('ordinary canonical authorization bridge', () => {
  it('binds a decision and fresh snapshot to the ObjectAccess grant', async () => {
    const objectAccess = scriptedPort(grant, grant);
    const authorization = new OrdinaryCanonicalAuthorizationAdapter(
      objectAccess,
    );
    const snapshots = new OrdinaryCanonicalPermissionSnapshotAdapter(
      objectAccess,
    );
    const decision = await authorization.authorize({
      actor: creator,
      action: 'READ_DOCUMENT_PARSING',
      workItemId: 'WI-1',
      requestId: 'REQ-1',
      documentVersionId: 'DV-1',
    });
    const fresh = await snapshots.freshRead({
      actor: creator,
      decision,
      workItemId: 'WI-1',
      requestId: 'REQ-1',
      documentVersionId: 'DV-1',
    });

    expect(decision).toMatchObject({
      allowed: true,
      actorFingerprint: grant.actorFingerprint,
      permissionSnapshotVersion: grant.authorizationFingerprint,
    });
    expect(fresh.permissionSnapshotVersion).toBe(
      grant.authorizationFingerprint,
    );
    expect(objectAccess.freshRead).toHaveBeenCalledTimes(2);
  });

  it('propagates a fail-closed service identity denial', async () => {
    const objectAccess = scriptedPort({
      allowed: false,
      action: 'READ_DOCUMENT_PARSING',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
      denialSource: 'SERVICE_UNAVAILABLE_ADAPTER',
    });
    const authorization = new OrdinaryCanonicalAuthorizationAdapter(
      objectAccess,
    );

    await expect(
      authorization.authorize({
        actor: { ...creator, objectAccessActor: undefined },
        action: 'READ_DOCUMENT_PARSING',
        workItemId: 'WI-1',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('rejects a snapshot whose authenticated actor fingerprint changed', async () => {
    const objectAccess = scriptedPort({
      ...grant,
      actorFingerprint: 'sha256:different-actor',
    });
    const snapshots = new OrdinaryCanonicalPermissionSnapshotAdapter(
      objectAccess,
    );

    await expect(
      snapshots.freshRead({
        actor: creator,
        decision: {
          action: 'READ_DOCUMENT_PARSING',
          allowed: true,
          actorFingerprint: grant.actorFingerprint,
          decisionId: 'decision-1',
          decisionHash: 'sha256:decision',
          permissionSnapshotVersion: grant.authorizationFingerprint,
        },
        workItemId: 'WI-1',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects fully copied visible actor fields through the real router before repository I/O', async () => {
    const repository = { loadAuthorizationBinding: jest.fn() };
    const router = new CanonicalObjectAccessRouter(
      new UnavailableMiaodaBrowserObjectAccessAdapter(),
      new UnavailableAilyObjectAccessAdapter(),
      new UnavailableServiceObjectAccessAdapter(),
      new UnavailableSessionObjectAccessAdapter(),
    );
    const authorization = new OrdinaryCanonicalAuthorizationAdapter(router);

    await expect(
      authorization.authorize({
        actor: creator,
        action: 'READ_DOCUMENT_PARSING',
        workItemId: 'WI-1',
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
    expect(repository.loadAuthorizationBinding).not.toHaveBeenCalled();
  });
});

function scriptedPort(
  ...results: Awaited<ReturnType<CanonicalObjectAccessPort['freshRead']>>[]
): CanonicalObjectAccessPort & { freshRead: jest.Mock } {
  return {
    freshRead: jest.fn().mockImplementation(async () => results.shift()),
  };
}
