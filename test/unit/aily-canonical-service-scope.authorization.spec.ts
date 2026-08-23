import { RequestContextService } from '@lark-apaas/nestjs-common';

import {
  AILY_ACTOR_REQUEST_CONTEXT_KEY,
  AilyCanonicalServiceScopeAuthorization,
} from '../../server/modules/canonical-host/aily-canonical-service-scope.authorization';
import { CANONICAL_AILY_AGENT_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import type {
  CanonicalAilyFinalUserActorContext,
  CanonicalObjectAccessGrant,
} from '../../server/modules/work-item/canonical-object-access.port';

describe('AilyCanonicalServiceScopeAuthorization', () => {
  it('uses native request context and the Host owner fresh-read', async () => {
    const context = new RequestContextService();
    const objectAccess = {
      freshRead: jest.fn().mockResolvedValue(grant('WI-1')),
    };
    const service = new AilyCanonicalServiceScopeAuthorization(
      context,
      objectAccess as never,
      executorScope() as never,
    );

    const scope = await context.run(
      {
        requestId: 'request-1',
        [AILY_ACTOR_REQUEST_CONTEXT_KEY]: actor(),
      },
      () =>
        service.authorizeWorkItemRead({
          transport: 'READONLY_MCP',
          operation: 'READ_STATUS',
          workItemId: 'WI-1',
        }),
    );

    expect(objectAccess.freshRead).toHaveBeenCalledWith({
      actor: actor(),
      action: 'READ_WORK_ITEM',
      accessRoot: { kind: 'WORK_ITEM', id: 'WI-1' },
    });
    expect(scope).toEqual({
      principalId: 'final-user:sha256:actor',
      appId: 'app_17bzc551rsg',
      tenantId: '7283059256756502547',
      workItemId: 'WI-1',
      authorizationFingerprint: 'sha256:authorization',
    });
  });

  it('rejects MCP transport outside a verified Aily request context', async () => {
    const service = new AilyCanonicalServiceScopeAuthorization(
      new RequestContextService(),
      { freshRead: jest.fn() } as never,
      executorScope() as never,
    );

    await expect(
      service.assertTransport({ transport: 'READONLY_MCP' }),
    ).rejects.toMatchObject({
      code: 'AILY_SIGNED_IDENTITY_UNAVAILABLE',
      statusCode: 401,
    });
  });

  it('delegates DEV, OpenAPI, and OpenClaw service scope without using Aily identity', async () => {
    const delegate = executorScope();
    const objectAccess = { freshRead: jest.fn() };
    const service = new AilyCanonicalServiceScopeAuthorization(
      new RequestContextService(),
      objectAccess as never,
      delegate as never,
    );
    const developmentInput = {
      documentVersionId: 'DV-1',
      developmentRunToken: '00000000-0000-4000-8000-000000000001',
    };
    const readInput = {
      transport: 'OPENAPI_REST' as const,
      operation: 'READ_STATUS' as const,
      workItemId: 'WI-1',
    };
    const workItemInput = {
      operation: 'BEGIN_DYNAMIC' as const,
      workItemId: 'WI-1',
    };
    const attemptInput = {
      operation: 'HEARTBEAT_ATTEMPT' as const,
      attemptRef: 'ATT-1',
    };

    await service.authorizeDevelopmentCreate(developmentInput);
    await service.authorizeWorkItemRead(readInput);
    await service.assertTransport({ transport: 'OPENCLAW_MCP' });
    await service.authorizeOpenClawWorkItem(workItemInput);
    await service.authorizeOpenClawAttempt(attemptInput);

    expect(delegate.authorizeDevelopmentCreate).toHaveBeenCalledWith(
      developmentInput,
    );
    expect(delegate.authorizeWorkItemRead).toHaveBeenCalledWith(readInput);
    expect(delegate.assertTransport).toHaveBeenCalledWith({
      transport: 'OPENCLAW_MCP',
    });
    expect(delegate.authorizeOpenClawWorkItem).toHaveBeenCalledWith(
      workItemInput,
    );
    expect(delegate.authorizeOpenClawAttempt).toHaveBeenCalledWith(
      attemptInput,
    );
    expect(objectAccess.freshRead).not.toHaveBeenCalled();
  });
});

function executorScope() {
  return {
    authorizeWorkItemRead: jest.fn().mockResolvedValue({}),
    authorizeDevelopmentCreate: jest.fn().mockResolvedValue({}),
    assertTransport: jest.fn().mockResolvedValue(undefined),
    authorizeOpenClawWorkItem: jest.fn().mockResolvedValue({}),
    authorizeOpenClawAttempt: jest.fn().mockResolvedValue({}),
  };
}

function actor(): CanonicalAilyFinalUserActorContext {
  return {
    principalKind: 'FINAL_USER',
    transport: 'AILY_SIGNED_MCP_HTTP',
    canonicalSubject: {
      namespace: 'MIAODA_USER_ID',
      id: '1812345678901234567',
    },
    subjectDecision: {
      source: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: '7283059256756502547',
      version: 'aily-jwt-hs256.authnpaas-user-convert.v1',
      decidedAt: '2026-08-24T00:00:00.000Z',
    },
    tenantId: '7283059256756502547',
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'online',
    platformRoles: [],
    identityProvenance: 'AILY_SIGNED_JWT',
    feishuUserId: '7620774801438674448',
    feishuOpenId: null,
    feishuIdentityProvenance: 'AILY_SIGNED_JWT',
    agentId: CANONICAL_AILY_AGENT_ID,
    tokenExpiresAt: '2026-08-25T00:00:00.000Z',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
}

function grant(workItemId: string): CanonicalObjectAccessGrant {
  return {
    allowed: true,
    action: 'READ_WORK_ITEM',
    accessRoot: { kind: 'WORK_ITEM', id: workItemId },
    workItemId,
    workItemRevision: 1,
    requestId: 'REQ-1',
    documentVersionId: 'DV-1',
    tenantId: '7283059256756502547',
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'HOST_CONFIGURED_MIAODA_APP_ID',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    actorUserId: '1812345678901234567',
    canonicalSubject: {
      namespace: 'MIAODA_USER_ID',
      id: '1812345678901234567',
    },
    actorFingerprint: 'sha256:actor',
    ownerFact: {
      isOwner: true,
      ownerUserId: '1812345678901234567',
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
    accessRevision: 'work-item:1:creator-only.v1',
    authorizationFingerprint: 'sha256:authorization',
    freshReadAt: '2026-08-24T00:00:00.000Z',
    auditProvenance: {
      identity: 'AILY_SIGNED_JWT_AND_MIAODA_AUTHNPAAS_ID_CONVERT',
      applicationScope: 'HOST_CONFIGURED_MIAODA_APP_ID',
      workspace: 'UNAVAILABLE',
      objectAuthorization: 'HOST_WORK_ITEM_REQUESTED_BY',
      memberAuthorization: 'UNAVAILABLE',
      session: 'UNAVAILABLE',
      correlationFieldsAreAuthorizationInputs: false,
      platformRolesAreObjectGrantInputs: false,
      platformRolesMayBeActionPolicyInputs: true,
    },
  };
}
