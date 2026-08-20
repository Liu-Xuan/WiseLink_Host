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
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
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

  it('has no transport-only positive seam that can expose OpenClaw tools', async () => {
    const mcp = { handle: jest.fn() };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
    );

    await expect(
      controller.handleOpenClawMcp({} as never, {} as never, {}),
    ).rejects.toMatchObject({
      code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
      statusCode: 503,
    });

    expect(mcp.handle).not.toHaveBeenCalled();
  });
});
