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
    const autoWorkItems = {
      nextWorkItem: jest.fn(),
      acknowledgeWorkItem: jest.fn(),
    };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      autoWorkItems as never,
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
    const autoWorkItems = {
      nextWorkItem: jest.fn().mockResolvedValue({ status: 'IDLE' }),
      acknowledgeWorkItem: jest.fn().mockResolvedValue({
        status: 'ACKNOWLEDGED',
        workItemId: 'WI-01',
        replayed: false,
        acknowledgedAt: '2026-09-25T08:42:17.000Z',
      }),
    };
    const serviceScope = {
      assertTransport: jest.fn(),
      assertAutoWorkItemQueueTransport: jest.fn(),
    };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      mcp as never,
      autoWorkItems as never,
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

  it('authenticates queue discovery and acknowledgement before forwarding', async () => {
    const autoWorkItems = {
      nextWorkItem: jest.fn().mockResolvedValue({ status: 'IDLE' }),
      acknowledgeWorkItem: jest.fn().mockResolvedValue({
        status: 'ACKNOWLEDGED',
        workItemId: 'WI-01',
        replayed: false,
        acknowledgedAt: '2026-09-25T08:42:17.000Z',
      }),
    };
    const serviceScope = {
      assertTransport: jest.fn(),
      assertAutoWorkItemQueueTransport: jest.fn(),
    };
    const controller = new CanonicalHostOpenClawMcpOpenApiController(
      { handle: jest.fn() } as never,
      autoWorkItems as never,
      serviceScope as never,
    );

    await expect(controller.nextWorkItem()).resolves.toEqual({
      status: 'IDLE',
    });
    const ack = {
      workItemId: 'WI-01',
      leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436',
      leaseGeneration: 3,
    };
    await expect(controller.acknowledgeWorkItem(ack)).resolves.toMatchObject({
      status: 'ACKNOWLEDGED',
    });

    expect(serviceScope.assertAutoWorkItemQueueTransport).toHaveBeenCalledTimes(
      2,
    );
    expect(autoWorkItems.nextWorkItem).toHaveBeenCalledTimes(1);
    expect(autoWorkItems.acknowledgeWorkItem).toHaveBeenCalledWith(ack);
  });
});
