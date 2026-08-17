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

import { RequestContextService } from '@lark-apaas/nestjs-common';

import { CanonicalHostOpenClawMcpOpenApiController } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.openapi.controller';

describe('CanonicalHostOpenClawMcpOpenApiController', () => {
  it('binds an API-key MCP request to the canonical host FileService context', async () => {
    const context = new RequestContextService();
    const observedAppIds: Array<string | undefined> = [];
    const mcp = {
      handle: jest.fn(async () => {
        observedAppIds.push(context.get('appId'));
      }),
    };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      context,
    );

    await context.run({ appId: '' }, () =>
      controller.handleOpenClawMcp({} as never, {} as never, {}),
    );

    expect(observedAppIds).toEqual(['app_17bzc551rsg']);
    expect(mcp.handle).toHaveBeenCalledTimes(1);
  });

  it('rejects a request already bound to another application', () => {
    const context = new RequestContextService();
    const mcp = { handle: jest.fn() };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      context,
    );

    expect(() =>
      context.run({ appId: 'app_other' }, () =>
        controller.handleOpenClawMcp({} as never, {} as never, {}),
      ),
    ).toThrow('OPENCLAW_MCP_HOST_CONTEXT_MISMATCH');
    expect(mcp.handle).not.toHaveBeenCalled();
  });

  it('fails explicitly when the platform request context is unavailable', () => {
    const context = new RequestContextService();
    const mcp = { handle: jest.fn() };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      context,
    );

    expect(() =>
      controller.handleOpenClawMcp({} as never, {} as never, {}),
    ).toThrow('OPENCLAW_MCP_REQUEST_CONTEXT_UNAVAILABLE');
    expect(mcp.handle).not.toHaveBeenCalled();
  });
});
