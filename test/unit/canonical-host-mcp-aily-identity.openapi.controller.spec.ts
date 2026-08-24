import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Inject: noOpDecorator,
    Injectable: noOpDecorator,
    Post: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
  };
});

import { RequestContextService } from '@lark-apaas/nestjs-common';
import type { Request, Response } from 'express';

import { AILY_ACTOR_REQUEST_CONTEXT_KEY } from '../../server/modules/canonical-host/aily-canonical-service-scope.authorization';
import { CanonicalHostMcpOpenApiController } from '../../server/modules/canonical-host/canonical-host-mcp.openapi.controller';
import { CANONICAL_AILY_AGENT_ID } from '../../server/modules/canonical-host/canonical-host.constants';
import type { CanonicalAilyFinalUserActorContext } from '../../server/modules/work-item/canonical-object-access.port';

describe('CanonicalHostMcpOpenApiController Aily identity edge', () => {
  it('uses only the native signed header and scopes the mapped actor to this request', async () => {
    const requestContext = new RequestContextService();
    const finalUser = actor();
    const identity = {
      verifyAndMap: jest.fn().mockResolvedValue({
        actor: finalUser,
        actorFingerprint: 'sha256:actor',
        agentId: finalUser.agentId,
        tokenExpiresAt: finalUser.tokenExpiresAt,
      }),
    };
    const observed: unknown[] = [];
    const serviceScope = {
      assertTransport: jest.fn().mockImplementation(async () => {
        observed.push(requestContext.get(AILY_ACTOR_REQUEST_CONTEXT_KEY));
      }),
    };
    const mcp = {
      handle: jest.fn().mockImplementation(async () => {
        observed.push(requestContext.get(AILY_ACTOR_REQUEST_CONTEXT_KEY));
      }),
    };
    const controller = new CanonicalHostMcpOpenApiController(
      mcp as never,
      identity as never,
      requestContext,
      serviceScope as never,
    );
    const request = {
      path: '/openapi/wiselink/mcp',
      method: 'POST',
      headers: { 'x-aily-jwt': 'native-signed-token' },
    } as unknown as Request;
    const response = {} as Response;
    const untrustedBody = {
      actorUserId: 'spoofed-user',
      tenantId: 'spoofed-tenant',
    };

    await controller.handleWiseLinkMcp(request, response, untrustedBody);

    expect(identity.verifyAndMap).toHaveBeenCalledWith('native-signed-token');
    expect(serviceScope.assertTransport).toHaveBeenCalledWith({
      transport: 'READONLY_MCP',
    });
    expect(mcp.handle).toHaveBeenCalledWith(request, response, untrustedBody);
    expect(observed).toEqual([finalUser, finalUser]);
    expect(requestContext.get(AILY_ACTOR_REQUEST_CONTEXT_KEY)).toBeUndefined();
  });
});

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
