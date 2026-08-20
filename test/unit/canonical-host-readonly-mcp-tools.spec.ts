import { registerCanonicalHostReadonlyMcpTools } from '../../server/modules/canonical-host/canonical-host-readonly-mcp-tools';

type ToolCallback = (input: Record<string, string>) => Promise<unknown>;

function target() {
  const callbacks = new Map<string, ToolCallback>();
  const server = {
    registerTool: jest.fn(
      (name: string, _definition: unknown, callback: ToolCallback) => {
        callbacks.set(name, callback);
      },
    ),
  };
  const vertical = {
    openApiStatus: jest.fn().mockResolvedValue({ status: 'ok' }),
    openApiQuery: jest.fn().mockResolvedValue({ results: [] }),
    openApiDeepLink: jest
      .fn()
      .mockResolvedValue({ deepLink: '/work-items/WI-1' }),
  };
  const scope = {
    principalId: 'service:api-key-1',
    appId: 'app_17bzc551rsg',
    tenantId: 'tenant-a',
    workItemId: 'WI-1',
    authorizationFingerprint: 'scope-fingerprint-1',
  };
  const serviceScope = {
    authorizeWorkItemRead: jest.fn().mockResolvedValue(scope),
  };
  registerCanonicalHostReadonlyMcpTools(
    server as never,
    vertical as never,
    serviceScope as never,
  );
  return { callbacks, vertical, scope, serviceScope };
}

describe('canonical readonly MCP tool authorization', () => {
  it('authorizes every tool operation against its exact WorkItem', async () => {
    const { callbacks, vertical, scope, serviceScope } = target();

    await callbacks.get('get_parse_status')!({ workItemId: 'WI-1' });
    await callbacks.get('query_parsed_package')!({
      workItemId: 'WI-1',
      query: 'applicability',
    });
    await callbacks.get('get_deep_link')!({ workItemId: 'WI-1' });

    expect(serviceScope.authorizeWorkItemRead.mock.calls).toEqual([
      [
        {
          transport: 'READONLY_MCP',
          operation: 'READ_STATUS',
          workItemId: 'WI-1',
        },
      ],
      [
        {
          transport: 'READONLY_MCP',
          operation: 'QUERY_PARSED_PACKAGE',
          workItemId: 'WI-1',
        },
      ],
      [
        {
          transport: 'READONLY_MCP',
          operation: 'READ_DEEP_LINK',
          workItemId: 'WI-1',
        },
      ],
    ]);
    expect(vertical.openApiStatus).toHaveBeenCalledWith('WI-1', scope);
    expect(vertical.openApiQuery).toHaveBeenCalledWith(
      { workItemId: 'WI-1', query: 'applicability' },
      scope,
    );
    expect(vertical.openApiDeepLink).toHaveBeenCalledWith('WI-1', scope);
  });

  it.each([
    ['get_parse_status', { workItemId: 'WI-forged' }],
    [
      'query_parsed_package',
      { workItemId: 'WI-forged', query: 'applicability' },
    ],
    ['get_deep_link', { workItemId: 'WI-forged' }],
  ])(
    'performs no vertical I/O when %s lacks trusted scope',
    async (tool, input) => {
      const { callbacks, vertical, serviceScope } = target();
      serviceScope.authorizeWorkItemRead.mockRejectedValue(
        Object.assign(new Error('scope unavailable'), {
          code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
          statusCode: 503,
        }),
      );

      await expect(callbacks.get(tool)!(input)).rejects.toMatchObject({
        code: 'CANONICAL_SERVICE_SCOPE_UNAVAILABLE',
        statusCode: 503,
      });
      expect(vertical.openApiStatus).not.toHaveBeenCalled();
      expect(vertical.openApiQuery).not.toHaveBeenCalled();
      expect(vertical.openApiDeepLink).not.toHaveBeenCalled();
    },
  );
});
