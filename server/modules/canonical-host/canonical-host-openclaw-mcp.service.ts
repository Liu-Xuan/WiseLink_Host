import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  toNodeHandler,
  type NodeMcpRequestHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';

import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { buildOpenClawTranslationDelivery } from './canonical-host-openclaw-attempt-delivery';
import { CanonicalHostOpenClawDynamicEvaluationService } from './canonical-host-openclaw-dynamic-evaluation.service';
import {
  CanonicalHostOpenClawDiscoveryService,
  type PublicHostedDiscoveryResult,
} from './canonical-host-openclaw-discovery.service';
import { CanonicalHostOpenClawOverallService } from './canonical-host-openclaw-overall.service';
import { CanonicalHostOpenClawAttemptStatusService } from './canonical-host-openclaw-attempt-status.service';
import { CanonicalHostOpenClawReviewService } from './canonical-host-openclaw-review.service';
import {
  CanonicalHostOpenClawTranslationService,
  TRANSLATION_RESULT_PART_MAX_BYTES,
  TRANSLATION_RESULT_PART_MAX_COUNT,
} from './canonical-host-openclaw-translation.service';
import { CanonicalHostOpenClawApplicabilityService } from './canonical-host-openclaw-applicability.service';
import { translationWorkspaceCommandSchemaV2 } from './canonical-translation-v2.service';
import { TRANSLATION_V2_TASK_SCHEMA } from './canonical-translation-v2.contract';
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
const reviewProgress = z
  .object({
    kind: z.enum(['MODEL_REQUEST', 'MODEL_RETRY']),
    requestNo: z.number().int().positive(),
    retryNo: z.number().int().min(0).max(2),
    delayMs: z.number().int().min(0).max(30000),
    errorCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{0,119}$/u)
      .nullable(),
  })
  .strict();
const resultEnvelope = z.record(z.string(), z.unknown());
const reviewCommitInput = z
  .object({
    attemptRef,
    leaseToken,
    leaseGeneration,
    resultJson: z.string().trim().min(2).max(1_000_000),
  })
  .strict();
const resultContentHash = z.string().regex(/^[0-9a-f]{64}$/u);
const translationResultPartBinding = z
  .object({
    partIndex: z
      .number()
      .int()
      .min(0)
      .max(TRANSLATION_RESULT_PART_MAX_COUNT - 1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/u),
    byteLength: z.number().int().min(1).max(TRANSLATION_RESULT_PART_MAX_BYTES),
  })
  .strict();
const translationCommitInput = z.union([
  z
    .object({
      attemptRef,
      leaseToken,
      leaseGeneration,
      result: resultEnvelope,
    })
    .strict(),
  z
    .object({
      attemptRef,
      leaseToken,
      leaseGeneration,
      phase: z.literal('UPLOAD_PART'),
      resultContentHash,
      partIndex: z
        .number()
        .int()
        .min(0)
        .max(TRANSLATION_RESULT_PART_MAX_COUNT - 1),
      partCount: z.number().int().min(1).max(TRANSLATION_RESULT_PART_MAX_COUNT),
      payloadBase64: z
        .string()
        .min(4)
        .max(Math.ceil(TRANSLATION_RESULT_PART_MAX_BYTES / 3) * 4),
    })
    .strict(),
  z
    .object({
      attemptRef,
      leaseToken,
      leaseGeneration,
      phase: z.literal('FINALIZE'),
      resultContentHash,
      partCount: z.number().int().min(1).max(TRANSLATION_RESULT_PART_MAX_COUNT),
      parts: z
        .array(translationResultPartBinding)
        .min(1)
        .max(TRANSLATION_RESULT_PART_MAX_COUNT),
    })
    .strict(),
]);
const reviewConversationRef = z.string().trim().min(1).max(96);
const reviewRequestId = z.string().trim().min(1).max(96);
const reviewSourceRefId = z.string().trim().min(1).max(512);
const applicabilityContextRef = z.string().trim().min(1).max(160);
const applicabilityRequestId = z.string().trim().min(1).max(96);
const deliveryPart = z.number().int().min(0).max(10_000).optional();
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
    private readonly problemAssessment: CanonicalJobAidProblemService,
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
          'Host 为同一 WorkItem 创建或恢复 TRANSLATE ActionAttempt。新 v2 使用 requestId 与完整结构来源工作区，返回任务指针；通过 translation_workspace 领取完整语义批次、保存并检查后由 Host 组装。历史 v1 仍返回有界 SourceUnit 传输分片，COMMITTING 仅恢复相同提交。',
        inputSchema: z
          .object({
            workItemId: mcpWorkItemId,
            deliveryPart,
            requestId: z
              .string()
              .regex(/^[A-Za-z0-9_-]{1,64}$/u)
              .optional(),
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId, deliveryPart: selectedDeliveryPart, requestId }) => {
        const begin = await this.translation.begin(workItemId, requestId);
        if (
          begin.task.modelInput.schemaVersion === TRANSLATION_V2_TASK_SCHEMA
        ) {
          if (selectedDeliveryPart !== undefined && selectedDeliveryPart !== 0)
            throw new Error('TRANSLATION_V2_TASK_HAS_NO_SOURCE_UNIT_PARTS');
          return textResult(begin);
        }
        return textResult(
          buildOpenClawTranslationDelivery(begin, selectedDeliveryPart ?? 0),
        );
      },
    );

    server.registerTool(
      'translation_workspace',
      {
        title: '翻译工作区批次、保存、检查与组装',
        description:
          '在已有翻译 attempt 的租约和工作区范围内操作。NEXT 领取一批完整语义块；READ_BATCH 只传输该批完整输入；SAVE 幂等保存实际译文为待检查版本；CHECK 保存独立语义检查；RECORD_FAILURE 保留明确或未知生成结果；ASSEMBLE 从 Host 已选版本组装带覆盖范围的候选。全部为候选，不采用工程结论，不改变原文。',
        inputSchema: translationWorkspaceCommandSchemaV2,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (input) =>
        textResult(await this.translation.workspaceCommand(input)),
    );

    server.registerTool(
      'commit_translation_candidate',
      {
        title: '提交来源绑定的中英文候选翻译',
        description:
          '大结果先按 UPLOAD_PART（每 part 原始字节最多 6144，Base64）写入同一 Host FileService attempt-owned staging；相同 part 可按 lease fence 精确重放且 chunk 阶段不改变 WorkItem/current。全部 receipt 就绪后以 FINALIZE 一次组装完整 ResultEnvelope，进入既有 TranslationRuleSet ResultGate、FileService 实际字节 readback 与 WorkItem CAS。保留小结果直接 result 兼容形态；OpenClaw 不能直接写 current。',
        inputSchema: translationCommitInput,
        annotations: commitAnnotations,
      },
      async (input) => {
        if ('result' in input) {
          return textResult(
            await this.translation.commit(
              input.attemptRef,
              input.leaseToken,
              input.leaseGeneration,
              input.result,
            ),
          );
        }
        if (input.phase === 'UPLOAD_PART') {
          return textResult(
            await this.translation.uploadResultPart(
              input.attemptRef,
              input.leaseToken,
              input.leaseGeneration,
              {
                resultContentHash: input.resultContentHash,
                partIndex: input.partIndex,
                partCount: input.partCount,
                payloadBase64: input.payloadBase64,
              },
            ),
          );
        }
        return textResult(
          await this.translation.finalizeResultParts(
            input.attemptRef,
            input.leaseToken,
            input.leaseGeneration,
            {
              resultContentHash: input.resultContentHash,
              partCount: input.partCount,
              parts: input.parts,
            },
          ),
        );
      },
    );

    server.registerTool(
      'begin_applicability_evaluation',
      {
        title: '开始飞机号适用性条件提取与候选评估',
        description:
          '输入仅含 Host opaque applicabilityContextRef 与幂等 requestId。Host 派生 tenant/WorkItem/ACL 并冻结当前文档、飞机号/asOf、窄受控机队事实及来源条件。v2 使用已验证英文，v1 保留完整译文绑定；不发送原始 PDF、FileService locator 或完整 Fleet。',
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
          '仅接受由官方 Skill runApplicabilityEvaluation 按 Host modelInput.astVocabulary 组装的专属 CANDIDATE 与 fenced ResultEnvelope；factsConsidered 必须精确等于 Host controlledFacts[].factId。业务校验拒绝后不得重提 commit。Host 校验 exact DV/revision/SourceRef/aircraft/asOf/fact versions/actual runtime provenance，再调用唯一 FleetMasterData+Kleene evaluator，实际字节 readback 后 CAS 写回；FALSE 永远是 NOT_APPLICABLE/pass=false，只有 Host 缺失受控事实可形成 UNKNOWN/WAITING_INPUT。',
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
        title: '开始 JobAid 候选评估',
        description:
          'Host 按任务已绑定的 schema 返回旧逐项或新问题分析输入。新任务可按已登记来源调查并保存完整工作；同一身份精确重放。COMMITTING 返回已存 recoveryResult，不重新生成。',
        inputSchema: z
          .object({
            workItemId: mcpWorkItemId,
            requestId: z
              .string()
              .regex(/^[A-Za-z0-9_-]{1,64}$/u)
              .optional(),
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId, requestId }) =>
        textResult(await this.dynamicEvaluation.begin(workItemId, requestId)),
    );

    server.registerTool(
      'read_assessment_sources',
      {
        title: '读取 JobAid 授权来源和方法',
        description:
          '按原任务的来源目录、actor/版本及有效 lease 读取正文，EXACT 或 PAGE 展开条件与脚注；保存实际读取回执后才加入可引用集合。',
        inputSchema: z
          .object({
            attemptRef,
            leaseToken,
            leaseGeneration,
            sourceRefs: z.array(z.string().min(1).max(512)).min(1).max(96),
            purpose: z.string().trim().min(1).max(2000),
            context: z.enum(['EXACT', 'PAGE']).default('PAGE'),
          })
          .strict(),
        annotations: resumeAnnotations,
      },
      async (input) =>
        textResult(await this.problemAssessment.readSources(input)),
    );

    server.registerTool(
      'save_assessment_work',
      {
        title: '保存 JobAid 问题工作正文',
        description:
          '保存完整问题修订和实际依据，原 request 精确幂等及工作 revision CAS；不改变正式采用、WorkItem current 或已取消 attempt。',
        inputSchema: z
          .object({
            attemptRef,
            leaseToken,
            leaseGeneration,
            requestId: z.string().regex(/^[A-Za-z0-9:_-]{1,96}$/u),
            expectedWorkRevision: z.number().int().min(0),
            workJson: z.string().min(2).max(1_000_000),
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async (input) => textResult(await this.problemAssessment.saveWork(input)),
    );

    server.registerTool(
      'read_assessment_work',
      {
        title: '读回已保存的 JobAid 工作',
        description:
          '在当前授权下读回原 request 的完整正文或最新工作，供保存响应丢失、退出及取消后的恢复核对；不发起模型或提升结果。',
        inputSchema: z
          .object({ attemptRef, requestId: z.string().max(96).optional() })
          .strict(),
        annotations: resumeAnnotations,
      },
      async ({ attemptRef: ref, requestId }) =>
        textResult(
          await this.problemAssessment.readAttemptWork(ref, requestId),
        ),
    );

    server.registerTool(
      'commit_dynamic_evaluation_candidate',
      {
        title: '提交动态 Job Aid 候选评估',
        description:
          '按冻结任务的 schema、attempt 和 lease 校验候选：历史协议提交准则结果，JobAid v2 提交已保存工作版本的精确引用；仅将候选 CAS 写回同一 WorkItem。',
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
          'Host 按已绑定 schema 使用当前 JobAid 工作与核实来源；新问题评估只检查最新工作的一致性，历史逐项结果仍兼容。显式 requestId 领取同一新请求，COMMITTING 只恢复已存结果。',
        inputSchema: z
          .object({
            workItemId: mcpWorkItemId,
            requestId: z
              .string()
              .regex(/^[A-Za-z0-9_-]{1,64}$/u)
              .optional(),
            providers: z
              .array(z.enum(['AIRBUS', 'BOEING', 'COMAC']))
              .max(3)
              .optional(),
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({ workItemId, providers, requestId }) =>
        textResult(
          await this.overall.begin(workItemId, providers ?? [], requestId),
        ),
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
      'get_pending_review_turn',
      {
        title: '读取下一条已请求自动执行的评审轮次',
        description:
          '仅查询已授权 WorkItem 的 ACTIVE 会话，按保存顺序返回显式 AUTOMATIC 且尚未完成的下一轮。不会选择历史普通保存的 Turn，不改写业务数据；当前轮租约有效时返回 busy，不越过当前轮。',
        inputSchema: z.object({ workItemId: mcpWorkItemId }).strict(),
        annotations: resumeAnnotations,
      },
      async ({ workItemId }) =>
        textResult(await this.review.pending(workItemId)),
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
      'query_review_aily',
      {
        title: '以本轮工程师身份检索 Aily',
        description:
          '仅限已授权的自由对话 attempt；发起只读检索或读取同一 attempt 已登记的检索结果。令牌不进入工具参数或结果。',
        inputSchema: z
          .object({
            attemptRef,
            requestKey: z.string().min(1).max(200).optional(),
            query: z.string().min(1).max(4000).optional(),
            queryRef: z.string().uuid().optional(),
          })
          .strict(),
        annotations: beginAnnotations,
      },
      async ({
        attemptRef: selectedAttemptRef,
        requestKey,
        query,
        queryRef,
      }) => {
        if (queryRef && requestKey === undefined && query === undefined)
          return textResult(
            await this.review.queryAily(selectedAttemptRef, { queryRef }),
          );
        if (!queryRef && requestKey && query)
          return textResult(
            await this.review.queryAily(selectedAttemptRef, {
              requestKey,
              query,
            }),
          );
        throw new Error('AILY_QUERY_ARGUMENTS_INVALID');
      },
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
          '仅接收 bundled validator 生成的 canonical resultJson，并按 exact attempt、lease token/generation 与完整 versioned ResultEnvelope fail-closed 校验 provenance/SourceRef/item allowlists。外层 ResultEnvelope.sourceRefs 只能是 TaskEnvelope.sourceRefs 中的 artifact {ref,sha256}；已读取的 sourceRefId 只能放在 modelOutput 内层 Review candidate.sourceRefs，严禁混用。只追加 ReviewTurn assistant response、candidateEvidence 与 ReviewActionDraft 候选；绝不执行 ReviewAction 或修改 WorkItem revision/current/STALE。',
        inputSchema: reviewCommitInput,
        annotations: commitAnnotations,
      },
      async (input) => {
        const result = parseCanonicalReviewResultJson(input.resultJson);
        return textResult(
          await this.review.commit(
            input.attemptRef,
            input.leaseToken,
            input.leaseGeneration,
            result,
          ),
        );
      },
    );

    server.registerTool(
      'heartbeat_action_attempt',
      {
        title: '续期当前 ActionAttempt lease',
        description:
          '使用当前 attempt 的 fencing token 与 generation 续期 RUNNING lease；旧 worker、过期 token 或跨 WorkItem scope 一律拒绝。',
        inputSchema: z
          .object({
            attemptRef,
            leaseToken,
            leaseGeneration,
            reviewProgress: reviewProgress.optional(),
          })
          .strict(),
        annotations: commitAnnotations,
      },
      async ({
        attemptRef: selectedAttemptRef,
        leaseToken: selectedLeaseToken,
        leaseGeneration: selectedLeaseGeneration,
        reviewProgress: selectedReviewProgress,
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
            ...(selectedReviewProgress
              ? {
                  reviewProgress: {
                    ...selectedReviewProgress,
                    errorCode: selectedReviewProgress.errorCode ?? null,
                  },
                }
              : {}),
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

function parseCanonicalReviewResultJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw Object.assign(new Error('REVIEW_RESULT_JSON_INVALID'), {
      code: 'REVIEW_RESULT_JSON_INVALID',
      statusCode: 400,
    });
  }
}
