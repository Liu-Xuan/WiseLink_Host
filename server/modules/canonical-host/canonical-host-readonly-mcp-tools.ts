import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import type { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import type { CanonicalServiceScopeAuthorizationPort } from './canonical-service-scope.authorization';

export const mcpWorkItemId = z.string().trim().min(1).max(200);
export const mcpQuery = z.string().trim().min(1).max(200);

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerCanonicalHostReadonlyMcpTools(
  server: McpServer,
  vertical: CanonicalHostVerticalService,
  serviceScope: CanonicalServiceScopeAuthorizationPort,
): void {
  server.registerTool(
    'get_parse_status',
    {
      title: '读取工程文件处理状态',
      description:
        '读取同一 WiseLink WorkItem 的最新状态、解析包摘要、候选评估摘要，以及配置证据采纳触发的脱敏全量重算进度。',
      inputSchema: z.object({ workItemId: mcpWorkItemId }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ workItemId }) => {
      const scope = await serviceScope.authorizeWorkItemRead({
        transport: 'READONLY_MCP',
        operation: 'READ_STATUS',
        workItemId,
      });
      return textResult(await vertical.openApiStatus(workItemId, scope));
    },
  );

  server.registerTool(
    'query_parsed_package',
    {
      title: '查询工程文件解析内容',
      description:
        '在同一 WorkItem 已验证的 frozen.2 解析包中查询带来源引用的内容单元。',
      inputSchema: z
        .object({ workItemId: mcpWorkItemId, query: mcpQuery })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ workItemId, query }) => {
      const scope = await serviceScope.authorizeWorkItemRead({
        transport: 'READONLY_MCP',
        operation: 'QUERY_PARSED_PACKAGE',
        workItemId,
      });
      return textResult(
        await vertical.openApiQuery({ workItemId, query }, scope),
      );
    },
  );

  server.registerTool(
    'get_deep_link',
    {
      title: '打开工程文件工作项',
      description: '读取由 WiseLink 服务端派生的同一 WorkItem 妙搭页面地址。',
      inputSchema: z.object({ workItemId: mcpWorkItemId }).strict(),
      annotations: readOnlyAnnotations,
    },
    async ({ workItemId }) => {
      const scope = await serviceScope.authorizeWorkItemRead({
        transport: 'READONLY_MCP',
        operation: 'READ_DEEP_LINK',
        workItemId,
      });
      return textResult(await vertical.openApiDeepLink(workItemId, scope));
    },
  );
}

export function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}
