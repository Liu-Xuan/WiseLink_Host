import { Injectable, Logger } from '@nestjs/common';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import { registerCanonicalHostReadonlyMcpTools } from './canonical-host-readonly-mcp-tools';

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

    registerCanonicalHostReadonlyMcpTools(server, this.vertical);

    return server;
  }
}
