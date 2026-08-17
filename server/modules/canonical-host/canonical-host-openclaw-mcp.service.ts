import { Injectable, Logger } from '@nestjs/common';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import {
  CanonicalHostOpenClawDiscoveryService,
  type PublicHostedDiscoveryResult,
} from './canonical-host-openclaw-discovery.service';
import { CanonicalHostOpenClawOverallService } from './canonical-host-openclaw-overall.service';
import {
  mcpWorkItemId,
  registerCanonicalHostReadonlyMcpTools,
  textResult,
} from './canonical-host-readonly-mcp-tools';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';

const attemptRef = z.string().trim().min(1).max(200);
const overallOutput = z.string().trim().min(1).max(160_000);
const discoveryCandidate = z.object({
  title: z.string().trim().min(1).max(1000),
  sourceUrl: z.string().url().max(4000),
  documentNumber: z.string().trim().min(1).max(500).nullable(),
  revisionLabel: z.string().trim().min(1).max(500).nullable(),
  snippet: z.string().trim().min(1).max(4000).nullable(),
  relationshipReason: z.string().trim().min(1).max(2000),
  matchLevel: z.enum(['DIRECT', 'TANGENTIAL']),
}).strict();
const publicDiscoveryResult = z.object({
  provider: z.enum(['BOEING', 'AIRBUS', 'COMAC']),
  query: z.string().trim().min(1).max(2000),
  resultStatus: z.enum([
    'COMPLETE', 'PARTIAL', 'ACCESS_DENIED', 'ZERO_RESULT',
    'ZERO_RESULTS_FOR_TARGET_IDENTIFIER', 'TRUNCATED',
  ]),
  candidates: z.array(discoveryCandidate).max(100),
  accessRestricted: z.boolean().optional(),
  truncated: z.boolean().optional(),
  partialOnly: z.boolean().optional(),
  excludedNonOemCandidateCount: z.number().int().min(0).optional(),
  error: z.object({
    code: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(2000),
  }).strict().nullable(),
}).strict();

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
    private readonly discovery: CanonicalHostOpenClawDiscoveryService,
    private readonly overall: CanonicalHostOpenClawOverallService,
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
      'record_oem_discovery_run',
      {
        title: '记录 OEM 公开网站发现结果',
        description:
          '可选后台工具：仅在整体综合明确指出需补充某一 OEM 调查时，记录该次公开网站 discovery 到妙搭 SearchRun/候选表；时间、租户、actor 和 SearchRun 身份均由服务端派生，不采纳文档或触发 DM。',
        inputSchema: z.object({
          workItemId: mcpWorkItemId,
          result: publicDiscoveryResult,
        }).strict(),
        annotations: commitAnnotations,
      },
      async ({ workItemId, result }) =>
        textResult(
          await this.discovery.record(
            workItemId,
            result as PublicHostedDiscoveryResult,
          ),
        ),
    );

    server.registerTool(
      'begin_overall_synthesis',
      {
        title: '开始整体候选综合',
        description:
          '默认 providers=[]，先只基于同一 WorkItem 的完整 dynamic-N 实际字节和 frozen.2 来源完成整体综合；仅在已有综合明确指出不确定项后，才按需指定相关 OEM provider 做显式重综合。',
        inputSchema: z.object({
          workItemId: mcpWorkItemId,
          providers: z.array(z.enum(['AIRBUS', 'BOEING', 'COMAC'])).max(3).optional(),
        }).strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId, providers }) =>
        textResult(await this.overall.begin(workItemId, providers ?? [])),
    );

    server.registerTool(
      'commit_overall_candidate',
      {
        title: '提交整体 candidate_only 候选',
        description:
          '仅按服务端 opaque attempt 验证完整 overall 输出，保存原始实际字节并 CAS 写回同一 WorkItem；不形成人工确认或工程结论。',
        inputSchema: z.object({
          attemptRef,
          output: overallOutput,
        }).strict(),
        annotations: commitAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef, output }) =>
        textResult(await this.overall.commit(selectedAttemptRef, output)),
    );

    return server;
  }
}
