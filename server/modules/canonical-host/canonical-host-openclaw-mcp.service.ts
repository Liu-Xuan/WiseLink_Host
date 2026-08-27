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
import { CanonicalHostOpenClawAttemptStatusService } from './canonical-host-openclaw-attempt-status.service';
import { CanonicalHostOpenClawReviewService } from './canonical-host-openclaw-review.service';
import { CanonicalHostOpenClawTranslationService } from './canonical-host-openclaw-translation.service';
import { CanonicalHostOpenClawApplicabilityService } from './canonical-host-openclaw-applicability.service';
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
const reviewConversationRef = z.string().trim().min(1).max(96);
const reviewRequestId = z.string().trim().min(1).max(96);
const reviewSourceRefId = z.string().trim().min(1).max(512);
const applicabilityContextRef = z.string().trim().min(1).max(160);
const applicabilityRequestId = z.string().trim().min(1).max(96);
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
    private readonly applicability: CanonicalHostOpenClawApplicabilityService,
    private readonly review: CanonicalHostOpenClawReviewService,
    private readonly attemptStatus: CanonicalHostOpenClawAttemptStatusService,
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
      version: '1.2.0',
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
      'begin_applicability_evaluation',
      {
        title: '开始飞机号适用性条件提取与候选评估',
        description:
          '输入仅含 Host opaque applicabilityContextRef 与幂等 requestId。Host 派生 tenant/WorkItem/ACL，fresh-read current DV、飞机号+asOf、受控 FleetMasterData、frozen.2 SourceExpressions/SourceRefs 和 current bilingual SourceUnits，冻结专属 durable ActionAttempt；不发送原始 PDF、FileService locator 或完整 Fleet。',
        inputSchema: z
          .object({
            applicabilityContextRef,
            requestId: applicabilityRequestId,
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({ applicabilityContextRef: contextRef, requestId }) =>
        textResult(await this.applicability.begin(contextRef, requestId)),
    );

    server.registerTool(
      'commit_applicability_candidate',
      {
        title: '提交飞机号适用性提取候选',
        description:
          '仅接受专属 CANDIDATE applicability 输出与完整 fenced ResultEnvelope。Host 校验 exact DV/revision/SourceRef/aircraft/asOf/fact versions/actual runtime provenance，再调用唯一 FleetMasterData+Kleene evaluator，实际字节 readback 后 CAS 写回；FALSE 永远是 NOT_APPLICABLE/pass=false，只有 Host 缺失受控事实可形成 UNKNOWN/WAITING_INPUT。',
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
          await this.applicability.commit(
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
      'begin_review_turn',
      {
        title: '开始已持久评审轮次',
        description:
          '输入仅含 C1 reviewConversationRef 与 requestId。Host 从持久会话、官方 OAuth subject 映射、WorkItem owner/current revision 派生 tenant、actor、WorkItem、turn 与 opaque actorContextRef，并在既有 durable ActionAttempt 上领取租约；客户端不能提供或覆盖 actor、tenant、WorkItem 或 sessionKey。',
        inputSchema: z
          .object({ reviewConversationRef, requestId: reviewRequestId })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({ reviewConversationRef: conversationRef, requestId }) =>
        textResult(await this.review.begin(conversationRef, requestId)),
    );

    server.registerTool(
      'get_review_turn_context',
      {
        title: '读取评审轮次最小上下文',
        description:
          '只读返回该 durable attempt 冻结的 WorkItem、evaluation、bilingual、applicability、adopted inputs 最小投影与执行 policy；不返回 tenant、actor、OAuth credential 或 server-owned sessionKey。',
        inputSchema: z.object({ attemptRef }).strict(),
        annotations: resumeAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef }) =>
        textResult(await this.review.context(selectedAttemptRef)),
    );

    server.registerTool(
      'read_source_refs',
      {
        title: '读取评审 attempt 冻结的 exact SourceRefs',
        description:
          '仅按 sourceRefId 读取该 review TaskEnvelope 内冻结的 exact SourceRef allowlist；不提供 search/query，也不读取其他 WorkItem 或未授权 artifact。',
        inputSchema: z
          .object({
            attemptRef,
            sourceRefIds: z.array(reviewSourceRefId).min(1).max(100),
          })
          .strict(),
        annotations: resumeAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef, sourceRefIds }) =>
        textResult(
          await this.review.readSourceRefs(selectedAttemptRef, sourceRefIds),
        ),
    );

    server.registerTool(
      'get_action_attempt_status',
      {
        title: '读取通用 ActionAttempt 状态',
        description:
          '先授权再按 tenant/WorkItem scope 只读返回五类 exact ActionAttempt 的 RUNNING/COMMITTING/terminal 状态；仅 COMMITTING 返回经 Host policy 校验的 recovery ResultEnvelope，不触发模型或业务写入。',
        inputSchema: z.object({ attemptRef }).strict(),
        annotations: resumeAnnotations,
      },
      async ({ attemptRef: selectedAttemptRef }) =>
        textResult(await this.attemptStatus.status(selectedAttemptRef)),
    );

    server.registerTool(
      'commit_review_turn_candidate',
      {
        title: '提交评审轮次候选响应',
        description:
          '按 exact attempt、lease token/generation 与完整 versioned ResultEnvelope fail-closed 校验 provenance/SourceRef/item allowlists，只追加 ReviewTurn assistant response、candidateEvidence 与 ReviewActionDraft 候选；绝不执行 ReviewAction 或修改 WorkItem revision/current/STALE。',
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
          await this.review.commit(
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
