import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { CanonicalHostOpenClawDynamicEvaluationService } from './canonical-host-openclaw-dynamic-evaluation.service';
import {
  CanonicalHostOpenClawDiscoveryService,
  type PublicHostedDiscoveryResult,
} from './canonical-host-openclaw-discovery.service';
import { CanonicalHostOpenClawOverallService } from './canonical-host-openclaw-overall.service';
import { CanonicalHostOpenClawTranslationService } from './canonical-host-openclaw-translation.service';
import {
  mcpWorkItemId,
  registerCanonicalHostReadonlyMcpTools,
  textResult,
} from './canonical-host-readonly-mcp-tools';
import { CanonicalHostVerticalService } from './canonical-host-vertical.service';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
} from './canonical-service-scope.authorization';

const attemptRef = z.string().trim().min(1).max(200);
const leaseToken = z.string().uuid();
const leaseGeneration = z.number().int().positive();
const resultEnvelope = z.record(z.string(), z.unknown());
const discoveryCandidate = z
  .object({
    title: z.string().trim().min(1).max(1000),
    sourceUrl: z.string().url().max(4000),
    documentNumber: z.string().trim().min(1).max(500).nullable(),
    revisionLabel: z.string().trim().min(1).max(500).nullable(),
    snippet: z.string().trim().min(1).max(4000).nullable(),
    relationshipReason: z.string().trim().min(1).max(2000),
    matchLevel: z.enum(['DIRECT', 'TANGENTIAL']),
  })
  .strict();
const publicDiscoveryResult = z
  .object({
    provider: z.enum(['BOEING', 'AIRBUS', 'COMAC']),
    query: z.string().trim().min(1).max(2000),
    resultStatus: z.enum([
      'COMPLETE',
      'PARTIAL',
      'ACCESS_DENIED',
      'ZERO_RESULT',
      'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
      'TRUNCATED',
    ]),
    candidates: z.array(discoveryCandidate).max(100),
    accessRestricted: z.boolean().optional(),
    truncated: z.boolean().optional(),
    partialOnly: z.boolean().optional(),
    excludedNonOemCandidateCount: z.number().int().min(0).optional(),
    error: z
      .object({
        code: z.string().trim().min(1).max(300),
        message: z.string().trim().min(1).max(2000),
      })
      .strict()
      .nullable(),
  })
  .strict();

const beginAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const resumeAnnotations = {
  readOnlyHint: true,
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
    private readonly discovery: CanonicalHostOpenClawDiscoveryService,
    private readonly overall: CanonicalHostOpenClawOverallService,
    private readonly translation: CanonicalHostOpenClawTranslationService,
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
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

    registerCanonicalHostReadonlyMcpTools(
      server,
      this.vertical,
      this.serviceScope,
    );

    server.registerTool(
      'begin_translation',
      {
        title: '开始来源绑定的中英文候选翻译',
        description:
          'Host fresh-read 同一 WorkItem，冻结 frozen.2 SourceUnits、SourceRefs 与 exact versioned TranslationRuleSet，创建 durable TRANSLATE ActionAttempt；重复 begin 只恢复同一未完成 attempt。',
        inputSchema: z.object({ workItemId: mcpWorkItemId }).strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId }) =>
        textResult(await this.translation.begin(workItemId)),
    );

    server.registerTool(
      'commit_translation_candidate',
      {
        title: '提交来源绑定的中英文候选翻译',
        description:
          'Host 按 durable attempt 与 lease fence 校验完整 ResultEnvelope，执行 TranslationRuleSet 确定性 ResultGate、FileService 实际字节 readback 和 WorkItem CAS；OpenClaw 不能直接写 current。',
        inputSchema: z
          .object({
            attemptRef,
            leaseToken,
            leaseGeneration,
            result: resultEnvelope,
          })
          .strict(),
        annotations: commitAnnotations,
      },
      async ({
        attemptRef: selectedAttemptRef,
        leaseToken: selectedLeaseToken,
        leaseGeneration: selectedLeaseGeneration,
        result,
      }) =>
        textResult(
          await this.translation.commit(
            selectedAttemptRef,
            selectedLeaseToken,
            selectedLeaseGeneration,
            result,
          ),
        ),
    );

    server.registerTool(
      'begin_dynamic_evaluation',
      {
        title: '开始动态 Job Aid 逐项候选评估',
        description:
          '由服务端读取并授权同一 WorkItem，预留一次候选评估并返回不含写权限的动态 N 模型输入。同一 WorkItem revision 重复调用返回同一 attempt/modelInput；若已进入 COMMITTING，同时返回 Host 持久化的 recoveryResult 供原样重放而不再调用模型。',
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
          '按服务端 attempt、lease fencing token 与完整 ResultEnvelope 校验动态 N 输出，将 candidate_only 产物 CAS 写回同一 WorkItem。',
        inputSchema: z
          .object({
            attemptRef,
            leaseToken,
            leaseGeneration,
            result: resultEnvelope,
          })
          .strict(),
        annotations: commitAnnotations,
      },
      async ({
        attemptRef: selectedAttemptRef,
        leaseToken: selectedLeaseToken,
        leaseGeneration: selectedLeaseGeneration,
        result,
      }) =>
        textResult(
          await this.dynamicEvaluation.commit(
            selectedAttemptRef,
            selectedLeaseToken,
            selectedLeaseGeneration,
            result,
          ),
        ),
    );

    server.registerTool(
      'record_oem_discovery_run',
      {
        title: '记录 OEM 公开网站发现结果',
        description:
          '可选后台工具：仅在整体综合明确指出需补充某一 OEM 调查时，记录该次公开网站 discovery 到妙搭 SearchRun/候选表；时间、租户、actor 和 SearchRun 身份均由服务端派生，不采纳文档或触发 DM。',
        inputSchema: z
          .object({
            workItemId: mcpWorkItemId,
            result: publicDiscoveryResult,
          })
          .strict(),
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
          '默认 providers=[]，先只基于同一 WorkItem 的完整 dynamic-N 实际字节和 frozen.2 来源完成整体综合；仅在已有综合明确指出不确定项后，才按需指定相关 OEM provider。重复 begin 遇到 COMMITTING 时返回 recoveryResult，禁止二次模型执行。',
        inputSchema: z
          .object({
            workItemId: mcpWorkItemId,
            providers: z
              .array(z.enum(['AIRBUS', 'BOEING', 'COMAC']))
              .max(3)
              .optional(),
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId, providers }) =>
        textResult(await this.overall.begin(workItemId, providers ?? [])),
    );

    server.registerTool(
      'resume_overall_synthesis',
      {
        title: '恢复既有整体候选综合输入',
        description:
          '只读恢复既有 RUNNING overall attempt 的同语义 modelInput；接受内部 ATT 或 opaque OVR 引用，不创建 attempt、不写 DB/FileService，也不重跑 dynamic 或 discovery。',
        inputSchema: z.object({ attemptRef }).strict(),
        annotations: resumeAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef }) =>
        textResult(await this.overall.resume(selectedAttemptRef)),
    );

    server.registerTool(
      'commit_overall_candidate',
      {
        title: '提交整体 candidate_only 候选',
        description:
          '仅按服务端 opaque attempt、lease fencing token 与完整 ResultEnvelope 验证 overall 输出，保存原始实际字节并 CAS 写回同一 WorkItem；不形成人工确认或工程结论。',
        inputSchema: z
          .object({
            attemptRef,
            leaseToken,
            leaseGeneration,
            result: resultEnvelope,
          })
          .strict(),
        annotations: commitAnnotations,
      },
      async ({
        attemptRef: selectedAttemptRef,
        leaseToken: selectedLeaseToken,
        leaseGeneration: selectedLeaseGeneration,
        result,
      }) =>
        textResult(
          await this.overall.commit(
            selectedAttemptRef,
            selectedLeaseToken,
            selectedLeaseGeneration,
            result,
          ),
        ),
    );

    server.registerTool(
      'heartbeat_action_attempt',
      {
        title: '续期当前 ActionAttempt lease',
        description:
          '使用当前 attempt 的 fencing token 与 generation 续期 RUNNING lease；旧 worker、过期 token 或跨 WorkItem scope 一律拒绝。',
        inputSchema: z
          .object({ attemptRef, leaseToken, leaseGeneration })
          .strict(),
        annotations: commitAnnotations,
      },
      async ({
        attemptRef: selectedAttemptRef,
        leaseToken: selectedLeaseToken,
        leaseGeneration: selectedLeaseGeneration,
      }) => {
        const scope = await this.serviceScope.authorizeOpenClawAttempt({
          operation: 'HEARTBEAT_ATTEMPT',
          attemptRef: selectedAttemptRef,
        });
        return textResult(
          await this.attempts.heartbeat({
            attemptRef: selectedAttemptRef,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            principalId: scope.principalId,
            leaseToken: selectedLeaseToken,
            leaseGeneration: selectedLeaseGeneration,
          }),
        );
      },
    );

    server.registerTool(
      'cancel_action_attempt',
      {
        title: '取消尚未进入 COMMITTING 的 ActionAttempt',
        description:
          '对 exact WorkItem scope 下的 QUEUED/RUNNING/RETRY_SCHEDULED attempt 执行原子取消；一旦跨过 COMMITTING 截止点返回冲突。',
        inputSchema: z
          .object({
            attemptRef,
            reason: z.string().trim().min(1).max(4000),
          })
          .strict(),
        annotations: commitAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef, reason }) => {
        const scope = await this.serviceScope.authorizeOpenClawAttempt({
          operation: 'CANCEL_ATTEMPT',
          attemptRef: selectedAttemptRef,
        });
        return textResult(
          await this.attempts.requestCancel({
            attemptRef: selectedAttemptRef,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            reason,
          }),
        );
      },
    );

    return server;
  }
}
