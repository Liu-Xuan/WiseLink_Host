import 'reflect-metadata';

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  const noOpDecorator = () => () => undefined;
  return {
    ...actual,
    Body: noOpDecorator,
    Controller: noOpDecorator,
    Post: noOpDecorator,
    Req: noOpDecorator,
    Res: noOpDecorator,
  };
});

import { CanonicalHostOpenClawMcpOpenApiController } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller';

describe('CanonicalHostOpenClawMcpOpenApiController', () => {
  it('fails closed before MCP or object I/O without trusted scope', async () => {
    const mcp = { handle: jest.fn() };
    const serviceScope = {
      assertTransport: jest.fn().mockRejectedValue(
        Object.assign(new Error('scope unavailable'), {
          code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
          statusCode: 503,
        }),
      ),
    };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      serviceScope as never,
    );

    await expect(
      controller.handleOpenClawMcp({} as never, {} as never, {
        params: {
          arguments: {
            workItemId: 'WI-caller-supplied',
            tenantId: 'tenant-caller-supplied',
            actor: 'caller-supplied',
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });
    expect(mcp.handle).not.toHaveBeenCalled();
  });

  it('forwards to the real MCP handler only after transport scope succeeds', async () => {
    const mcp = { handle: jest.fn() };
    const serviceScope = { assertTransport: jest.fn() };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      serviceScope as never,
    );
    const request = {} as never;
    const response = {} as never;
    const body = { jsonrpc: '2.0', method: 'tools/list', id: 1 };

    await controller.handleOpenClawMcp(request, response, body);

    expect(serviceScope.assertTransport).toHaveBeenCalledWith({
      transport: 'OPENCLAW_MCP',
    });
    expect(mcp.handle).toHaveBeenCalledWith(request, response, body);
  });
});
