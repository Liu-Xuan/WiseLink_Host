import { Injectable, Logger } from '@nestjs/common';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import { CanonicalHostOpenClawDynamicEvaluationService } from './canonical-host-openclaw-dynamic-evaluation.service';
import {
  mcpWorkItemId,
  registerCanonicalHostReadonlyMcpTools,
  textResult,
} from './canonical-host-readonly-mcp-tools';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';

const attemptRef = z.string().trim().min(1).max(200);
const modelOutput = z.string().trim().min(1).max(80_000);

const beginAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const commitAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

@Injectable()
export class CanonicalHostOpenClawMcpService {
  private readonly logger = new Logger(CanonicalHostOpenClawMcpService.name);
  private readonly nodeHandler: NodeMcpRequestHandler;

  constructor(
    private readonly vertical: CanonicalHostVerticalService,
    private readonly dynamicEvaluation: CanonicalHostOpenClawDynamicEvaluationService,
  ) {
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
      name: 'wiselink-openclaw-engineering-assessment',
      version: '1.0.0',
    });

    registerCanonicalHostReadonlyMcpTools(server, this.vertical);

    server.registerTool(
      'begin_dynamic_evaluation',
      {
        title: '开始动态 Job Aid 逐项候选评估',
        description:
          '由服务端读取并授权同一 WorkItem，预留一次候选评估并返回不含写权限的动态 N 模型输入。同一 WorkItem revision 重复调用返回同一 attempt/modelInput；revision 变化后启动下一次候选运行。',
        inputSchema: z.object({ workItemId: mcpWorkItemId }).strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId }) =>
        textResult(await this.dynamicEvaluation.begin(workItemId)),
    );

    server.registerTool(
      'commit_dynamic_evaluation_candidate',
      {
        title: '提交动态 Job Aid 候选评估',
        description:
          '按服务端 attempt 绑定校验完整动态 N 输出，将 candidate_only 产物写回同一 WorkItem。',
        inputSchema: z.object({ attemptRef, output: modelOutput }).strict(),
        annotations: commitAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef, output }) =>
        textResult(
          await this.dynamicEvaluation.commit(selectedAttemptRef, output),
        ),
    );

    return server;
  }
}
