import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOp = () => () => undefined;
  return { ...actual, Body: noOp, Controller: noOp, Inject: noOp, Post: noOp, Req: noOp, Res: noOp };
});

import type { Request, Response } from 'express';
import { CanonicalHostMcpOpenApiController } from '../../server/modules/canonical-host/canonical-host-mcp.openapi.controller';

describe('CanonicalHostMcpOpenApiController official native-handoff blocker', () => {
  it('rejects a custom signed header before MCP I/O', async () => {
    const serviceScope = { assertTransport: jest.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE', statusCode: 503 })) };
    const mcp = { handle: jest.fn() };
    const controller = new CanonicalHostMcpOpenApiController(mcp as never, serviceScope as never);
    const request = {
      path: '/openapi/wiselink/mcp', method: 'POST',
      headers: { 'x-aily-jwt': 'caller-constructed-token' },
    } as unknown as Request;
    await expect(controller.handleWiseLinkMcp(request, {} as Response, {})).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE', statusCode: 503,
    });
    expect(serviceScope.assertTransport).toHaveBeenCalledWith({ transport: 'READONLY_MCP' });
    expect(mcp.handle).not.toHaveBeenCalled();
  });

  it('does not accept body/header/agent fields as an ActorContext', async () => {
    const serviceScope = { assertTransport: jest.fn().mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE', statusCode: 503 })) };
    const mcp = { handle: jest.fn() };
    const request = {
      headers: { 'x-aily-jwt': 'forged' },
      body: { userId: 'forged', tenantId: 'forged', agentId: 'agent_4km47c77ujwqphg', sender: 123456 },
    } as unknown as Request;
    await expect(
      new CanonicalHostMcpOpenApiController(mcp as never, serviceScope as never)
        .handleWiseLinkMcp(request, {} as Response, request.body),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mcp.handle).not.toHaveBeenCalled();
  });

  it('calls MCP only after an external official service-scope handoff succeeds', async () => {
    const serviceScope = { assertTransport: jest.fn().mockResolvedValue(undefined) };
    const mcp = { handle: jest.fn().mockResolvedValue(undefined) };
    const request = { headers: {} } as unknown as Request;
    const response = {} as Response;
    const body = { jsonrpc: '2.0' };
    await new CanonicalHostMcpOpenApiController(mcp as never, serviceScope as never)
      .handleWiseLinkMcp(request, response, body);
    expect(serviceScope.assertTransport).toHaveBeenCalledTimes(1);
    expect(mcp.handle).toHaveBeenCalledWith(request, response, body);
  });
});
