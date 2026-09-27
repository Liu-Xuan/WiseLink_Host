import 'reflect-metadata';
import { McpServer } from '@modelcontextprotocol/server';
import { CanonicalHostOpenClawMcpService } from '../../server/modules/canonical-host/canonical-host-openclaw-mcp.service';

describe('successor Overall MCP contract', () => {
  it('accepts the delegated Review pointer and forwards it to the authorized Overall service', async () => {
    const registered = new Map<string, { definition: { inputSchema: { safeParse: (value: unknown) => { success: boolean } } }; handler: (value: unknown) => Promise<unknown> }>();
    const register = jest.spyOn(McpServer.prototype, 'registerTool').mockImplementation(function (
      name: string, definition: unknown, handler: unknown,
    ) {
      registered.set(name, { definition, handler } as never);
      return { remove: jest.fn(), enable: jest.fn(), disable: jest.fn(), update: jest.fn() } as never;
    });
    try {
      const overall = { begin: jest.fn().mockResolvedValue({ status: 'RUNNING' }) };
      const service = new CanonicalHostOpenClawMcpService(
        null as never, null as never, null as never, overall as never,
        null as never, null as never, null as never, null as never,
        null as never, null as never, null as never,
      );
      (service as unknown as { createServer: () => McpServer }).createServer();
      const tool = registered.get('begin_overall_synthesis');
      expect(tool).toBeDefined();
      const input = {
        workItemId: 'WI-4db598a0-33b8-4abd-a64d-df2aac9f29c5',
        successorReviewTurnRef: 'RT-db3e4028-94e4-4715-8091-8f9c953ea003',
        providers: [],
      };
      expect(tool!.definition.inputSchema.safeParse(input).success).toBe(true);
      expect(tool!.definition.inputSchema.safeParse({ ...input, tenantId: 'forged' }).success).toBe(false);
      await tool!.handler(input);
      expect(overall.begin).toHaveBeenCalledWith(input.workItemId, [], undefined, input.successorReviewTurnRef);
    } finally {
      register.mockRestore();
    }
  });
});
