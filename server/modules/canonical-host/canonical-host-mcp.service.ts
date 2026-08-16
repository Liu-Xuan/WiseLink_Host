import { Injectable, Logger } from '@nestjs/common';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import { CanonicalHostVerticalService } from './canonical-host-vertical.service';

const workItemId = z.string().trim().min(1).max(200);
const query = z.string().trim().min(1).max(200);
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

@Injectable()
export class CanonicalHostMcpService {
  private readonly logger = new Logger(CanonicalHostMcpService.name);
  private readonly nodeHandler: NodeMcpRequestHandler;

  constructor(private readonly vertical: CanonicalHostVerticalService) {
    const handler = createMcpHandler(() => this.createServer(), {
      legacy: 'stateless',
      responseMode: 'json',
      onerror: (error) => this.logger.error(error.stack ?? error.message),
    });
    this.nodeHandler = toNodeHandler(handler, {
      onerror: (error) => this.logger.error(error.stack ?? error.message),
    });
  }

  async handle(
    request: Parameters<NodeMcpRequestHandler>[0],
    response: Parameters<NodeMcpRequestHandler>[1],
    body: unknown,
  ): Promise<void> {
    await this.nodeHandler(request, response, body);
  }

  private createServer(): McpServer {
    const server = new McpServer({
      name: 'wiselink-engineering-document-readonly',
      version: '1.0.0',
    });

    server.registerTool(
      'get_parse_status',
      {
        title: '读取工程文件处理状态',
        description:
          '读取同一 WiseLink WorkItem 的最新状态、解析包摘要和候选评估摘要。',
        inputSchema: z.object({ workItemId }).strict(),
        annotations: readOnlyAnnotations,
      },
      async ({ workItemId: selectedWorkItemId }) =>
        textResult(await this.vertical.openApiStatus(selectedWorkItemId)),
    );

    server.registerTool(
      'query_parsed_package',
      {
        title: '查询工程文件解析内容',
        description:
          '在同一 WorkItem 已验证的 frozen.2 解析包中查询带来源引用的内容单元。',
        inputSchema: z.object({ workItemId, query }).strict(),
        annotations: readOnlyAnnotations,
      },
      async ({ workItemId: selectedWorkItemId, query: selectedQuery }) =>
        textResult(
          await this.vertical.openApiQuery({
            workItemId: selectedWorkItemId,
            query: selectedQuery,
          }),
        ),
    );

    server.registerTool(
      'get_deep_link',
      {
        title: '打开工程文件工作项',
        description: '读取由 WiseLink 服务端派生的同一 WorkItem 妙搭页面地址。',
        inputSchema: z.object({ workItemId }).strict(),
        annotations: readOnlyAnnotations,
      },
      async ({ workItemId: selectedWorkItemId }) =>
        textResult(await this.vertical.openApiDeepLink(selectedWorkItemId)),
    );

    return server;
  }
}

function textResult(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  };
}
