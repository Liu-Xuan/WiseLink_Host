import { CANONICAL_AILY_AGENT_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import { CanonicalObjectAccessRouter } from '../../server/modules/work-item/canonical-object-access.router';
import { MiaodaHostedCanonicalObjectAccessAdapter } from '../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter';
import {
  MiaodaWorkItemRepository,
  type WorkItemAuthorizationBinding,
} from '../../server/modules/work-item/miaoda-work-item.repository';
import {
  UnavailableAilyObjectAccessAdapter,
  UnavailableServiceObjectAccessAdapter,
  UnavailableSessionObjectAccessAdapter,
} from '../../server/modules/work-item/unavailable-canonical-object-access.adapters';
import type {
  CanonicalAilyFinalUserActorContext,
  CanonicalMiaodaFinalUserActorContext,
} from '../../server/modules/work-item/canonical-object-access.port';

const MIAODA_USER_ID = '1812345678901234567';
const FEISHU_USER_ID = '7620774801438674448';
const TENANT_ID = '7283059256756502547';
const BINDING_REVISION = 11;

/**
 * Aily-native final-user identity edge over the Host owner fresh-read.
 * The Actor may only come from the verified x-aily-jwt + official
 * AuthNPaasService conversion; every spoofable self-report must fail closed
 * before the repository I/O.
 */
describe('hosted Aily signed MCP creator-only access', () => {
  it('fresh-reads the Host owner and grants only the exact creator binding', async () => {
    const repository = productionRepository();
    const result = await productionRouter(repository).freshRead({
      actor: ailyActor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    expect(result).toMatchObject({
      allowed: true,
      workItemId: 'WI1',
      tenantId: TENANT_ID,
      actorUserId: MIAODA_USER_ID,
      ownerFact: {
        isOwner: true,
        ownerUserId: MIAODA_USER_ID,
        source: 'HOST_WORK_ITEM_REQUESTED_BY',
      },
      auditProvenance: {
        identity: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT',
        objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY',
      },
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledWith({
      workItemId: 'WI1',
      tenantId: TENANT_ID,
      actorUserId: MIAODA_USER_ID,
    });
  });

  it('re-fresh-reads the Host owner for every protected read', async () => {
    const repository = productionRepository();
    const router = productionRouter(repository);

    await router.freshRead({
      actor: ailyActor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });
    await router.freshRead({
      actor: ailyActor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    expect(repository.loadAuthorizationBinding).toHaveBeenCalledTimes(2);
  });

  it('fails closed on missing or conflicting Host ownership', async () => {
    const repository = productionRepository();
    const router = productionRouter(repository);

    await expect(
      router.freshRead({
        actor: ailyActor({ tenantId: '7283059256756502548' }),
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
      denialSource: 'AILY_SIGNED_MCP_OBJECT_ACCESS',
    });
    await expect(
      router.freshRead({
        actor: ailyActor({ canonicalUserId: '1812345678901234568' }),
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('authorizes two verified Aily actors with different agentId provenance identically', async () => {
    const repository = productionRepository();
    const router = productionRouter(repository);

    const currentEntrance = await router.freshRead({
      actor: ailyActor({ agentId: CANONICAL_AILY_AGENT_ID }),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });
    const otherEntrance = await router.freshRead({
      actor: ailyActor({ agentId: 'agent_4krmu8apqgdky' }),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });
    const unknownEntrance = await router.freshRead({
      actor: ailyActor({ agentId: 'agent_some_other_entrance' }),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    // agentId is provenance only: once the native signed Aily actor is
    // verified at ingress, ObjectAccess neither denies nor grants on it,
    // and it never reaches the authorization fingerprints or the canonical
    // Actor subject.
    expect(currentEntrance.allowed).toBe(true);
    expect(otherEntrance.allowed).toBe(true);
    expect(unknownEntrance.allowed).toBe(true);
    if (
      currentEntrance.allowed &&
      otherEntrance.allowed &&
      unknownEntrance.allowed
    ) {
      expect(otherEntrance.actorFingerprint).toBe(
        currentEntrance.actorFingerprint,
      );
      expect(unknownEntrance.actorFingerprint).toBe(
        currentEntrance.actorFingerprint,
      );
      expect(otherEntrance.authorizationFingerprint).toBe(
        currentEntrance.authorizationFingerprint,
      );
      expect(unknownEntrance.authorizationFingerprint).toBe(
        currentEntrance.authorizationFingerprint,
      );
      expect(otherEntrance.canonicalSubject).toEqual(
        currentEntrance.canonicalSubject,
      );
      expect(unknownEntrance.canonicalSubject).toEqual(
        currentEntrance.canonicalSubject,
      );
    }
    expect(repository.loadAuthorizationBinding).toHaveBeenCalledTimes(3);
    expect(repository.loadAuthorizationBinding).toHaveBeenNthCalledWith(1, {
      workItemId: 'WI1',
      tenantId: TENANT_ID,
      actorUserId: MIAODA_USER_ID,
    });
    expect(repository.loadAuthorizationBinding).toHaveBeenNthCalledWith(3, {
      workItemId: 'WI1',
      tenantId: TENANT_ID,
      actorUserId: MIAODA_USER_ID,
    });
  });

  it('rejects an open_id self-report or non-JWT identity provenance before I/O', async () => {
    const repository = productionRepository();
    const router = productionRouter(repository);

    const openIdSelfReport =
      ailyActor() as CanonicalAilyFinalUserActorContext & {
        feishuOpenId: string;
      };
    openIdSelfReport.feishuOpenId = 'ou_self_reported_open_id';
    await expect(
      router.freshRead({
        actor: openIdSelfReport,
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({ allowed: false, statusCode: 503 });

    await expect(
      router.freshRead({
        actor: ailyActor({ identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT' }),
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });
    expect(repository.loadAuthorizationBinding).not.toHaveBeenCalled();
  });

  it('rejects caller-constructed SDK/session-sender identity shapes before I/O', async () => {
    const repository = productionRepository();
    const router = productionRouter(repository);

    // A SDK header/body-constructed Miaoda gateway actor must never authorize
    // through the Aily signed transport decision.
    const sdkConstructed = {
      ...gatewayActor(),
      transport: 'AILY_SIGNED_MCP_HTTP',
    } as CanonicalAilyFinalUserActorContext;
    await expect(
      router.freshRead({
        actor: sdkConstructed,
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({
      allowed: false,
      code: 'CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE',
      statusCode: 503,
    });

    // An Aily OpenAPI session sender must not become a final-user Actor.
    const sessionSender = ailyActor({
      sessionProvenance: 'SERVER_OPAQUE_SESSION',
    });
    (sessionSender as { sessionId?: unknown }).sessionId = 'session-sender';
    (sessionSender as { sessionRevision?: unknown }).sessionRevision = 3;
    await expect(
      router.freshRead({
        actor: sessionSender,
        action: 'READ_WORK_ITEM',
        accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
      }),
    ).resolves.toMatchObject({ allowed: false, statusCode: 503 });
    expect(repository.loadAuthorizationBinding).not.toHaveBeenCalled();
  });

  it('keeps agent_id out of the actor fingerprint and authorization fingerprint', async () => {
    const repository = productionRepository();
    const router = productionRouter(repository);

    const first = await router.freshRead({
      actor: ailyActor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });
    const second = await router.freshRead({
      actor: ailyActor({ feishuUserId: '7620774801438674449' }),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI1' },
    });

    if (first.allowed && second.allowed) {
      // Same mapped Miaoda subject + tenant: the entrance agent_id and the
      // raw Feishu identifier must not change the authorization decision
      // fingerprints.
      expect(second.actorFingerprint).toBe(first.actorFingerprint);
      expect(second.authorizationFingerprint).toBe(
        first.authorizationFingerprint,
      );
    } else {
      throw new Error('EXPECTED_BOTH_GRANTS');
    }
  });
});

function productionRouter(
  repository: ReturnType<typeof productionRepository>,
): CanonicalObjectAccessRouter {
  return new CanonicalObjectAccessRouter(
    new MiaodaHostedCanonicalObjectAccessAdapter(repository as never),
    new UnavailableAilyObjectAccessAdapter(),
    new UnavailableServiceObjectAccessAdapter(),
    new UnavailableSessionObjectAccessAdapter(),
  );
}

function productionRepository() {
  return {
    loadAuthorizationBinding: jest.fn(
      async (input: {
        workItemId: string;
        tenantId: string;
        actorUserId: string;
      }) =>
        binding().workItemId === input.workItemId &&
        binding().tenantId === input.tenantId &&
        binding().requestedByUserId === input.actorUserId
          ? binding()
          : null,
    ),
  };
}

function binding(): WorkItemAuthorizationBinding {
  return {
    workItemId: 'WI1',
    revision: BINDING_REVISION,
    tenantId: TENANT_ID,
    requestId: 'REQ-WI1',
    documentId: 'DOC-WI1',
    documentVersionId: 'DV-WI1',
    requestedByUserId: MIAODA_USER_ID,
    runKey: 'RUN-WI1',
  };
}

function ailyActor(
  overrides: Partial<{
    agentId: string;
    tenantId: string;
    canonicalUserId: string;
    feishuUserId: string;
    identityProvenance: string;
    sessionProvenance: string;
  }> = {},
): CanonicalAilyFinalUserActorContext {
  const tenantId = overrides.tenantId ?? TENANT_ID;
  const canonicalUserId = overrides.canonicalUserId ?? MIAODA_USER_ID;
  const actor: CanonicalAilyFinalUserActorContext = {
    principalKind: 'FINAL_USER',
    transport: 'AILY_SIGNED_MCP_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: canonicalUserId },
    subjectDecision: {
      source: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId,
      version: 'aily-jwt-hs256.authnpaas-user-convert.v1',
      decidedAt: '2026-08-25T00:00:00.000Z',
    },
    tenantId,
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'online',
    platformRoles: [],
    identityProvenance: 'AILY_SIGNED_JWT',
    feishuUserId: overrides.feishuUserId ?? FEISHU_USER_ID,
    feishuOpenId: null,
    feishuIdentityProvenance: 'AILY_SIGNED_JWT',
    agentId: overrides.agentId ?? CANONICAL_AILY_AGENT_ID,
    tokenExpiresAt: '2026-08-26T00:00:00.000Z',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
  return overrides.identityProvenance || overrides.sessionProvenance
    ? ({
        ...actor,
        ...(overrides.identityProvenance
          ? { identityProvenance: overrides.identityProvenance as never }
          : {}),
        ...(overrides.sessionProvenance
          ? { sessionProvenance: overrides.sessionProvenance as never }
          : {}),
      } as CanonicalAilyFinalUserActorContext)
    : actor;
}

function gatewayActor(): CanonicalMiaodaFinalUserActorContext {
  return {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: MIAODA_USER_ID },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: TENANT_ID,
      version: 'miaoda-hosted-native-sso.v1',
      decidedAt: '2026-08-25T00:00:00.000Z',
    },
    tenantId: TENANT_ID,
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'online',
    platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
}
