import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import { isJobAidProblemProjection } from '@shared/jobaid-problem-assessment.interface';
import { CanonicalJobAidProblemService } from './canonical-jobaid-problem.service';
import { overallModelEvidenceRegistry } from './overall-assessment-reading';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import type {
  CanonicalEngineerReviewPageContext,
  CanonicalWorkItemProjection,
  PendingReviewTurnResponse,
  ReviewTurnAssistantCandidate,
  ReviewMatterWorkingUpdateReceipt,
} from '@shared/api.interface';
import type { EngineeringMatterWorkingRevisionCommand } from '@shared/matter-working.interface';
import {
  canonicalSha256,
  canonicalJson,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { ReviewAttemptDispatchService } from '../action-attempt/review-attempt-dispatch.service';
import type {
  ActionAttemptRow,
  ActionAttemptTerminalProjection,
} from '../action-attempt/action-attempt.types';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import {
  ReviewConversationRepository,
  type PersistedReviewConversation,
  type PersistedReviewTurn,
} from '../review-persistence/review-conversation.repository';
import { parseReviewAttachmentParsedArtifact } from '../review-persistence/review-attachment-artifact';
import type { ReviewAttachmentBinding } from '../review-persistence/review-attachment.types';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedArtifactReadScope } from '../unified-reader/unified-artifact-read-scope';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import { CanonicalHostCommonContextService } from './canonical-host-common-context.service';
import { preflightCanonicalHostOpenClawResult } from './canonical-host-openclaw-runtime-policy';
import { parseBilingualTranslationArtifact } from './canonical-host-openclaw-translation.service';
import {
  parseReviewTurnCandidateContract,
  parseReviewTurnTaskContract,
  REVIEW_ALLOWED_OPERATIONS,
  REVIEW_MODEL_POLICY_REF,
  REVIEW_PROFILE_REF,
  REVIEW_RUNTIME_APP_ID,
  REVIEW_SKILL_POLICY_REF,
  REVIEW_TOOL_POLICY_REF,
  REVIEW_MATTER_TOOL_POLICY_REF,
  REVIEW_JOBAID_TOOL_POLICY_REF,
  type FrozenReviewSourceRef,
  type ReviewTurnCandidateContract,
  type ReviewTurnTaskContract,
} from './canonical-host-openclaw-review.contract';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';
import { EngineeringMatterWorkingService } from './engineering-matter-working.service';
import { EngineeringMatterWorkingRepository } from './engineering-matter-working.repository';
import {
  assertMatterReviewBasis,
  buildMatterReviewContext,
} from './matter-review-context';
import {
  matterWorkingCommand,
  resolvedReviewSourceRefs,
} from './matter-review-candidate';
import {
  reviewScopeSelection,
  sameReviewBusinessScope,
} from '../review-persistence/review-business-scope';
import { jobAidProblemModelWorkContent } from './jobaid-problem-task';
import { ReviewAilyService } from './review-aily.service';

const CANONICAL_APP_ID = 'app_17bzc551rsg';
const REVIEW_TASK_TYPE = 'OPENCLAW_INTERACTIVE_REVIEW' as const;

export interface BeginReviewTurnResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
  /** Host-owned routing only; never part of model input or the browser projection. */
  nativeSessionKey?: string;
  recoveryResult?: OpenClawResultEnvelope;
}

export interface ReviewTurnContextResult {
  schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2';
  attemptRef: string;
  reviewConversationRef: string;
  reviewTurnRef: string;
  mode: 'INTERACTIVE_REVIEW';
  selectedEvaluationItemId: string | null;
  inputRevision: number;
  allowedOperations: string[];
  resourceRefs: Array<{
    sourceRefId: string;
    resourceArtifactRef: string;
    resourceArtifactSha256: string;
  }>;
  context: Record<string, unknown>;
  executionPolicy: ReviewTurnTaskContract['executionPolicy'];
}

export interface ReviewSourceRefsResult {
  schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2';
  attemptRef: string;
  sourceRefs: Array<Record<string, unknown>>;
}

export interface CommitReviewTurnResult {
  schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2';
  attemptRef: string;
  status: string;
  replayed: boolean;
  assistantCandidate: ReviewTurnAssistantCandidate;
  authority: {
    candidatePersisted: true;
    reviewActionExecuted: false;
    workItemRevisionChanged: false;
    currentChanged: false;
    staleMarked: false;
  };
}

@Injectable()
export class CanonicalHostOpenClawReviewService {
  private readonly logger = new Logger(CanonicalHostOpenClawReviewService.name);

  constructor(
    private readonly conversations: ReviewConversationRepository,
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
    private readonly assessment: CanonicalHostAssessmentService,
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
    private readonly dispatch: ReviewAttemptDispatchService,
    private readonly commonContext: CanonicalHostCommonContextService,
    @Optional()
    private readonly matterWorking?: EngineeringMatterWorkingService,
    @Optional()
    private readonly matterWorkingRepository?: EngineeringMatterWorkingRepository,
    @Optional() private readonly jobAid?: CanonicalJobAidProblemService,
    @Optional() private readonly aily?: ReviewAilyService,
  ) {}

  async pending(workItemId: string): Promise<PendingReviewTurnResponse> {
    const scope = await this.serviceScope.authorizeOpenClawWorkItem({
      operation: 'GET_PENDING_REVIEW_TURN',
      workItemId,
    });
    assertWorkItemScope(scope, workItemId);
    const loaded = await this.workItems.loadTenantScopedProjection(
      workItemId,
      scope.tenantId,
    );
    if (!loaded?.projection) throw reviewNotFound();
    const turn = await this.conversations.loadPendingOpenClawTurn({
      tenantId: scope.tenantId,
      actorId: loaded.row.requestedByUserId,
      workItemId,
    });
    if (!turn) return { next: null, busy: false };
    const busy = await this.dispatch.isBusy({
      ...turn,
      tenantId: scope.tenantId,
      actorId: loaded.row.requestedByUserId,
      workItemId,
    });
    return {
      next: busy
        ? null
        : {
            reviewConversationRef: turn.reviewConversationId,
            reviewTurnRef: turn.reviewTurnId,
            requestId: turn.requestId,
            turnNo: turn.turnNo,
          },
      busy,
    };
  }

  async begin(
    reviewConversationRef: string,
    requestId: string,
  ): Promise<BeginReviewTurnResult> {
    requiredText(reviewConversationRef, 'REVIEW_CONVERSATION_REF_REQUIRED');
    requiredText(requestId, 'REVIEW_REQUEST_ID_REQUIRED');
    const scope = await this.serviceScope.authorizeOpenClawReview({
      operation: 'BEGIN_REVIEW',
      reviewConversationRef,
      requestId,
    });
    assertWorkItemScope(scope, scope.workItemId);
    const scopedWorkItem = await this.workItems.loadTenantScopedProjection(
      scope.workItemId,
      scope.tenantId,
    );
    if (!scopedWorkItem?.projection) {
      this.warnBeginNotFound('WORK_ITEM_SCOPE_NOT_VISIBLE');
      throw reviewNotFound();
    }
    const binding = await this.requiredConversationTurn(
      reviewConversationRef,
      requestId,
      scope,
      scopedWorkItem.row.requestedByUserId,
    );
    const buildInput = async () => {
      const workItem = await this.requiredCurrentWorkItem(binding, scope);
      const taskContract = await this.buildTaskContract(binding, workItem);
      return {
        modelInput: structuredClone(taskContract) as unknown as Record<
          string,
          unknown
        >,
        sourceRefs: taskArtifactRefs(workItem, binding.turn, taskContract),
        allowedConnectors:
          taskContract.context.purpose === 'CHAT' &&
          (taskContract.context.aily as { available?: boolean } | undefined)
            ?.available === true
            ? ['feishu-aily-user']
            : [],
      };
    };
    const claim =
      binding.turn.executionRequested || binding.turn.requestedModel
        ? await this.dispatch.prepareAndClaim({
            tenantId: binding.conversation.tenantId,
            actorId: binding.conversation.actorId,
            workItemId: binding.conversation.workItemId,
            reviewConversationId: binding.conversation.reviewConversationId,
            reviewTurnId: binding.turn.reviewTurnId,
            inputRevision: binding.turn.inputRevision,
            documentVersionId:
              scopedWorkItem.projection.source.documentVersionId,
            executionModel: binding.turn.requestedModel,
            leaseOwner: scope.principalId,
            buildInput,
          })
        : await this.beginLegacyTurn(
            binding,
            scope,
            scopedWorkItem.projection,
            buildInput,
          );
    return {
      attemptRef: claim.attemptRef,
      status: claim.status,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      leaseExpiresAt: claim.leaseExpiresAt,
      task: structuredClone(claim.task),
      ...(typeof claim.task.modelInput.actorContextRef === 'string' &&
      claim.task.modelInput.actorContextRef.startsWith('ACTX-RS-')
        ? {
            nativeSessionKey: `agent:${REVIEW_PROFILE_REF}:review:${claim.task.modelInput.actorContextRef}`,
          }
        : {}),
      ...(claim.status === 'COMMITTING'
        ? { recoveryResult: structuredClone(claim.recoveryResult) }
        : {}),
    };
  }

  private async beginLegacyTurn(
    binding: ReviewBinding,
    scope: CanonicalVerifiedServiceScope,
    workItem: CanonicalWorkItemProjection,
    buildInput: () => Promise<{
      modelInput: Record<string, unknown>;
      sourceRefs: OpenClawTaskEnvelope['sourceRefs'];
      allowedConnectors?: string[];
    }>,
  ) {
    const prepared = await buildInput();
    return this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType: REVIEW_TASK_TYPE,
      actorUserId: binding.conversation.actorId,
      tenantId: binding.conversation.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: binding.turn.inputRevision,
      baseRevision: binding.turn.inputRevision,
      idempotencyKey: reviewIdempotencyKey(binding),
      sourceRefs: prepared.sourceRefs,
      allowedConnectors: prepared.allowedConnectors ?? [],
      buildModelInput: async () => prepared.modelInput,
    });
  }

  async context(attemptRef: string): Promise<ReviewTurnContextResult> {
    const attempt = await this.requiredReviewAttempt(
      attemptRef,
      'GET_REVIEW_CONTEXT',
    );
    await this.dispatch.recordEvidenceActivity(attempt.row, {
      kind: 'CONTEXT_PREPARED',
      sourceRefIds: [],
      sourceCatalogCount: attempt.contract.resourceRefs.length,
    });
    return {
      schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
      attemptRef,
      reviewConversationRef: attempt.contract.reviewConversationRef,
      reviewTurnRef: attempt.contract.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW',
      selectedEvaluationItemId: attempt.contract.selectedEvaluationItemId,
      inputRevision: attempt.contract.inputRevision,
      allowedOperations: [...attempt.contract.allowedOperations],
      resourceRefs: attempt.contract.resourceRefs.map((resource) => ({
        sourceRefId: resource.sourceRefId,
        resourceArtifactRef: resource.resourceArtifactRef,
        resourceArtifactSha256: resource.resourceArtifactSha256,
      })),
      context: structuredClone(attempt.contract.context),
      executionPolicy: structuredClone(attempt.contract.executionPolicy),
    };
  }

  async readSourceRefs(
    attemptRef: string,
    sourceRefIds: string[],
  ): Promise<ReviewSourceRefsResult> {
    assertDistinctRequiredTexts(sourceRefIds, 'REVIEW_SOURCE_REF_IDS_INVALID');
    const attempt = await this.requiredReviewAttempt(
      attemptRef,
      'READ_REVIEW_SOURCE_REFS',
    );
    const allowlist = new Map(
      attempt.contract.resourceRefs.map((resource) => [
        resource.sourceRefId,
        resource,
      ]),
    );
    const selected = sourceRefIds.map((sourceRefId) => {
      const resource = allowlist.get(sourceRefId);
      if (!resource) throw reviewSourceRefNotAllowed();
      return structuredClone(resource.value);
    });
    // This records actual allowlisted resolution from the current task's
    // verified bytes, not another file download or a model-read assertion.
    await this.dispatch.recordEvidenceActivity(attempt.row, {
      kind: 'SOURCE_REFS_RESOLVED',
      sourceRefIds: [...sourceRefIds],
      sourceCatalogCount: attempt.contract.resourceRefs.length,
    });
    return {
      schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
      attemptRef,
      sourceRefs: selected,
    };
  }

  async queryAily(
    attemptRef: string,
    input: { requestKey: string; query: string } | { queryRef: string },
  ) {
    const attempt = await this.requiredReviewAttempt(
      attemptRef,
      'READ_REVIEW_SOURCE_REFS',
    );
    if (
      attempt.turn.purpose !== 'CHAT' ||
      !this.aily ||
      attempt.row.status !== 'RUNNING' ||
      !attempt.task.allowedConnectors.includes('feishu-aily-user')
    )
      throw reviewConflict('AILY_QUERY_NOT_ALLOWED');
    const actor = {
      actorId: attempt.conversation.actorId,
      tenantId: attempt.conversation.tenantId,
      sessionId: attempt.turn.ailySessionId,
    };
    return 'queryRef' in input
      ? this.aily.result(actor, attemptRef, input.queryRef)
      : this.aily.start(actor, attemptRef, input.requestKey, input.query);
  }

  async commit(
    attemptRef: string,
    leaseToken: string,
    leaseGeneration: number,
    resultEnvelope: unknown,
  ): Promise<CommitReviewTurnResult | ActionAttemptTerminalProjection> {
    const authorized = await this.requiredReviewAttempt(
      attemptRef,
      'COMMIT_REVIEW',
    );
    const { result } = preflightCanonicalHostOpenClawResult({
      row: authorized.row,
      result: resultEnvelope,
    });
    const candidate = parseReviewTurnCandidateContract({
      result,
      task: authorized.contract,
    });
    if (
      authorized.turn.purpose === 'CHAT' &&
      (candidate.reviewActionDraft ||
        candidate.jobAidWorkingDelta ||
        candidate.matterWorkingDelta ||
        candidate.affectedItemIds.length ||
        candidate.responseType === 'RESYNTHESIS_RESULT')
    )
      throw reviewConflict('REVIEW_CHAT_ASSESSMENT_MUTATION_FORBIDDEN');
    const matterContext = authorized.contract.matterContext;
    const readRefs = resolvedReviewSourceRefs(
      authorized.row.reviewActivityJson,
    );
    if (
      (matterContext ||
        authorized.contract.jobAidContext ||
        authorized.turn.purpose === 'CHAT') &&
      [...candidate.sourceRefs, ...candidate.candidateEvidenceRefs].some(
        (ref) => !readRefs.has(ref),
      )
    )
      throw reviewConflict('REVIEW_MATTER_CITED_SOURCE_NOT_READ');
    const matterCommand =
      matterContext && candidate.matterWorkingDelta
        ? matterWorkingCommand({
            context: matterContext,
            proposal: candidate.matterWorkingDelta,
            requestId: 'review-turn:' + authorized.turn.reviewTurnId,
            attemptRef: authorized.row.attemptId,
            resolvedSourceRefIds: readRefs,
          })
        : null;
    if (authorized.contract.jobAidContext && candidate.jobAidWorkingDelta)
      this.jobAid!.prepareReviewWork(
        authorized.contract.jobAidContext,
        authorized.row.workItemId,
        candidate.jobAidWorkingDelta,
        readRefs,
      );
    assertReviewCommitFence({
      row: authorized.row,
      principalId: authorized.scope.principalId,
      leaseToken,
      leaseGeneration,
    });
    const prepared = await this.attempts.prepareCommit({
      attemptRef,
      tenantId: authorized.scope.tenantId,
      workItemId: authorized.scope.workItemId,
      principalId: authorized.scope.principalId,
      leaseToken,
      leaseGeneration,
      result,
      failClosedWithoutRejectionMutation: true,
    });
    if (
      prepared.row.status !== 'COMMITTING' &&
      prepared.row.status !== 'SUCCEEDED'
    ) {
      return this.attempts.projectTerminal(prepared.row);
    }
    const persistenceInput = {
      conversation: authorized.conversation,
      turn: authorized.turn,
      actionAttemptId: prepared.row.attemptId,
      candidate: assistantCandidate(attemptRef, candidate, result),
      completedAt: new Date(),
    };
    const persisted = authorized.contract.jobAidContext
      ? await this.persistJobAidCandidate(
          authorized,
          candidate,
          persistenceInput,
          {
            principalId: authorized.scope.principalId,
            leaseToken,
            leaseGeneration,
          },
          readRefs,
        )
      : authorized.contract.matterContext
        ? await this.persistMatterCandidate(
            authorized,
            candidate,
            persistenceInput,
            matterCommand,
          )
        : await this.conversations.persistOpenClawAssistantCandidate(
            persistenceInput,
          );
    const terminal =
      await this.attempts.finishCandidatePersistenceSuccess(prepared);
    if (!persisted.turn.assistantCandidate) {
      throw new Error('REVIEW_TURN_CANDIDATE_READBACK_FAILED');
    }
    return {
      schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
      attemptRef,
      status: terminal.status,
      replayed: persisted.replayed || prepared.recovery,
      assistantCandidate: structuredClone(persisted.turn.assistantCandidate),
      authority: {
        candidatePersisted: true,
        reviewActionExecuted: false,
        workItemRevisionChanged: false,
        currentChanged: false,
        staleMarked: false,
      },
    };
  }

  private async persistJobAidCandidate(
    authorized: AuthorizedReviewAttempt,
    candidate: ReviewTurnCandidateContract,
    input: Parameters<
      ReviewConversationRepository['persistOpenClawAssistantCandidate']
    >[0],
    fence: { principalId: string; leaseToken: string; leaseGeneration: number },
    readRefs: Set<string>,
  ) {
    if (!this.jobAid || !this.matterWorkingRepository)
      throw reviewConflict('REVIEW_JOBAID_RUNTIME_UNAVAILABLE');
    const task = authorized.contract.jobAidContext!;
    const cited = new Set([
      ...candidate.sourceRefs,
      ...candidate.candidateEvidenceRefs,
    ]);
    input.candidate.sourceBindings = task.sourceCatalog.flatMap((item) =>
      item.kind === 'DOCUMENT_PASSAGE' && cited.has(item.evidenceRef)
        ? [
            {
              sourceRefId: item.evidenceRef,
              workItemId: item.workItemId,
              documentVersionId: item.documentVersionId,
              originalSourceRefId: item.sourceRefId,
            },
          ]
        : [],
    );
    return this.matterWorkingRepository.withActorTransaction(
      authorized.conversation.actorId,
      async ({ database }) => {
        if (authorized.turn.assistantCandidate) {
          if (
            authorized.turn.assistantCandidate.actionAttemptRef !==
            input.candidate.actionAttemptRef
          )
            throw reviewConflict('REVIEW_TURN_CANDIDATE_CONFLICT');
          input.candidate.jobAidWorkingUpdate =
            authorized.turn.assistantCandidate.jobAidWorkingUpdate;
        } else if (candidate.jobAidWorkingDelta) {
          const saved = await this.jobAid!.saveReviewWork(
            {
              row: authorized.row,
              task,
              fence,
              requestId: `review-turn:${authorized.turn.reviewTurnId}`,
              proposal: candidate.jobAidWorkingDelta,
              actualReadRefs: readRefs,
            },
            database,
          );
          input.candidate.jobAidWorkingUpdate = {
            status: 'APPLIED',
            workRevisionRef: saved.revision.workRevisionRef,
            workRevision: saved.revision.workRevision,
            affectedIssueKeys: Array.isArray(
              candidate.jobAidWorkingDelta.issues,
            )
              ? candidate.jobAidWorkingDelta.issues.map((issue) =>
                  String((issue as Record<string, unknown>).issueKey),
                )
              : [],
          };
        } else {
          input.candidate.jobAidWorkingUpdate = {
            status: 'UNCHANGED',
            workRevisionRef: task.previousWork?.workRevisionRef ?? null,
            workRevision: task.previousWork?.workRevision ?? 0,
            affectedIssueKeys: [],
          };
        }
        return this.conversations.persistOpenClawAssistantCandidate(
          input,
          database,
        );
      },
    );
  }

  private async persistMatterCandidate(
    authorized: AuthorizedReviewAttempt,
    candidate: ReviewTurnCandidateContract,
    input: Parameters<
      ReviewConversationRepository['persistOpenClawAssistantCandidate']
    >[0],
    command: EngineeringMatterWorkingRevisionCommand | null,
  ) {
    const context = authorized.contract.matterContext!;
    const repository = this.matterWorkingRepository;
    if (!repository) throw reviewConflict('REVIEW_MATTER_RUNTIME_UNAVAILABLE');
    const sourceByRef = new Map(
      context.evidenceSources.map((source) => [source.evidenceRef, source]),
    );
    const cited = new Set([
      ...candidate.sourceRefs,
      ...candidate.candidateEvidenceRefs,
    ]);
    input.candidate.sourceBindings = context.readingEvidence.flatMap((item) => {
      const source = sourceByRef.get(item.evidenceRef);
      return item.kind === 'DOCUMENT_PASSAGE' &&
        source &&
        cited.has(source.sourceRefId)
        ? [
            {
              sourceRefId: source.sourceRefId,
              workItemId: item.workItemId,
              documentVersionId: item.documentVersionId,
              originalSourceRefId: item.sourceRefId,
            },
          ]
        : [];
    });
    return repository.withActorTransaction(
      authorized.conversation.actorId,
      async (executor) => {
        // Current and based membership are reauthorized on the same connection as both writes.
        const basis = await executor.authorizeRuntimeInputs({
          tenantId: authorized.row.tenantId,
          matterId: context.scope.matterId,
          actorUserId: authorized.row.actorUserId,
          basedOnMatterRevisionId: context.scope.basedOnMatterRevisionId,
        });
        const persistedCandidate = authorized.turn.assistantCandidate;
        if (persistedCandidate) {
          if (
            persistedCandidate.actionAttemptRef !==
            input.candidate.actionAttemptRef
          )
            throw reviewConflict('REVIEW_TURN_CANDIDATE_CONFLICT');
          input.candidate.matterWorkingUpdate =
            persistedCandidate.matterWorkingUpdate;
          return this.conversations.persistOpenClawAssistantCandidate(
            input,
            executor.database,
          );
        }
        let current = await executor.loadCurrent({
          tenantId: authorized.row.tenantId,
          matterId: context.scope.matterId,
        });
        let receipt: ReviewMatterWorkingUpdateReceipt = {
          matterId: context.scope.matterId,
          status: 'UNCHANGED',
          workingRevision: current?.workingRevision ?? 0,
          resultRef: current?.substantiveResultRef ?? null,
          resultRevision: current?.substantiveResultRevision ?? null,
          resultChanged: false,
          coverageChanged: false,
          reasonCode: null,
        };
        if (command) {
          try {
            // Repository checks own source replay before version CAS. The candidate and revision commit together.
            const applied = await executor.appendWorkingRevision({
              tenantId: authorized.row.tenantId,
              matterId: context.scope.matterId,
              actorUserId: authorized.row.actorUserId,
              command,
              currentInputs: context.scope.inputs,
              source: {
                actionAttemptId: authorized.row.attemptId,
                reviewTurnId: authorized.turn.reviewTurnId,
              },
            });
            receipt = {
              ...receipt,
              status: 'APPLIED',
              workingRevision: applied.revision.workingRevision,
              resultRef: applied.revision.substantiveResultRef,
              resultRevision: applied.revision.substantiveResultRevision,
              resultChanged: applied.resultChanged,
              coverageChanged: applied.coverageChanged,
            };
          } catch (error) {
            const code =
              error && typeof error === 'object' && 'code' in error
                ? String(error.code)
                : '';
            if (
              ![
                'ENGINEERING_MATTER_WORKING_CAS_CONFLICT',
                'ENGINEERING_MATTER_WORKING_MEMBERSHIP_CONFLICT',
                'ENGINEERING_MATTER_WORKING_INPUT_CONFLICT',
              ].includes(code)
            )
              throw error;
            current = await executor.loadCurrent({
              tenantId: authorized.row.tenantId,
              matterId: context.scope.matterId,
            });
            receipt = {
              ...receipt,
              status: 'BASIS_CHANGED',
              reasonCode: code,
              workingRevision: current?.workingRevision ?? 0,
              resultRef: current?.substantiveResultRef ?? null,
              resultRevision: current?.substantiveResultRevision ?? null,
            };
          }
        } else if (
          basis.currentMatterRevisionId !==
            context.scope.basedOnMatterRevisionId ||
          (current?.workingRevision ?? 0) !==
            context.scope.expectedWorkingRevision ||
          canonicalJson(basis.currentInputs) !==
            canonicalJson(context.scope.inputs)
        ) {
          receipt = {
            ...receipt,
            status: 'BASIS_CHANGED',
            reasonCode: 'REVIEW_MATTER_BASIS_CHANGED',
          };
        }
        input.candidate.matterWorkingUpdate = receipt;
        return this.conversations.persistOpenClawAssistantCandidate(
          input,
          executor.database,
        );
      },
    );
  }

  private async requiredConversationTurn(
    reviewConversationRef: string,
    requestId: string,
    scope: CanonicalVerifiedServiceScope,
    actorId: string,
  ): Promise<ReviewBinding> {
    const binding = await this.conversations.loadOpenClawTurnBinding({
      reviewConversationId: reviewConversationRef,
      requestId,
      tenantId: scope.tenantId,
      actorId,
      workItemId: scope.workItemId,
    });
    if (!binding) throw reviewNotFound();
    if (binding.turn.assistantCandidate) {
      if (binding.turn.executionRequested) {
        const execution = await this.dispatch.readExecution({
          tenantId: binding.conversation.tenantId,
          actorId: binding.conversation.actorId,
          workItemId: binding.conversation.workItemId,
          reviewConversationId: binding.conversation.reviewConversationId,
          reviewTurnId: binding.turn.reviewTurnId,
          inputRevision: binding.turn.inputRevision,
        });
        if (execution?.status === 'COMMITTING') return binding;
      }
      this.warnBeginNotFound('CANDIDATE_ALREADY_PRESENT');
      throw reviewNotFound();
    }
    return binding;
  }

  private warnBeginNotFound(
    reason: 'WORK_ITEM_SCOPE_NOT_VISIBLE' | 'CANDIDATE_ALREADY_PRESENT',
  ): void {
    this.logger.warn(
      JSON.stringify({
        event: 'OPENCLAW_REVIEW_BEGIN_NOT_FOUND',
        reason,
      }),
    );
  }

  private async requiredCurrentWorkItem(
    binding: ReviewBinding,
    scope: CanonicalVerifiedServiceScope,
  ): Promise<CanonicalWorkItemProjection> {
    if (
      binding.conversation.tenantId !== scope.tenantId ||
      binding.conversation.workItemId !== scope.workItemId
    ) {
      throw reviewNotFound();
    }
    const loaded = await this.workItems.loadTenantScopedProjection(
      binding.conversation.workItemId,
      binding.conversation.tenantId,
    );
    if (
      !loaded?.projection ||
      loaded.row.requestedByUserId !== binding.conversation.actorId ||
      loaded.row.revision !== loaded.projection.revision ||
      loaded.projection.workItemId !== binding.conversation.workItemId ||
      (!binding.turn.reviewScope &&
        binding.turn.inputRevision !== loaded.row.revision) ||
      (!binding.turn.reviewScope &&
        binding.conversation.lastSyncedRevision !== loaded.row.revision) ||
      loaded.projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      !loaded.projection.package ||
      (!binding.turn.reviewScope &&
        !loaded.projection.integratedAssessment?.baseRules &&
        !this.jobAid?.enabledForNewTasks())
    ) {
      throw reviewConflict('REVIEW_TURN_BINDING_STALE_OR_INELIGIBLE');
    }
    if (binding.turn.reviewScope) await this.authorizeMatterRuntime(binding);
    return loaded.projection;
  }

  private async requiredReviewAttempt(
    attemptRef: string,
    operation:
      | 'GET_REVIEW_CONTEXT'
      | 'READ_REVIEW_SOURCE_REFS'
      | 'COMMIT_REVIEW',
    requireCurrent = true,
  ): Promise<AuthorizedReviewAttempt> {
    requiredText(attemptRef, 'REVIEW_ATTEMPT_REF_REQUIRED');
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation,
      attemptRef,
    });
    assertAttemptScope(scope, attemptRef);
    const row = await this.attempts.readScoped({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    if (
      row.actionType !== REVIEW_TASK_TYPE ||
      row.actorUserId.startsWith('service:') ||
      !row.taskEnvelopeJson
    ) {
      throw reviewNotFound();
    }
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    const contract = parseReviewTurnTaskContract(task.modelInput);
    const binding = await this.conversations.loadOpenClawTurnByIdBinding({
      reviewConversationId: contract.reviewConversationRef,
      reviewTurnId: contract.reviewTurnRef,
      tenantId: row.tenantId,
      actorId: row.actorUserId,
      workItemId: row.workItemId,
    });
    if (
      !binding ||
      binding.turn.requestId !== contract.requestId ||
      binding.turn.inputRevision !== row.inputRevision ||
      task.inputRevision !== binding.turn.inputRevision ||
      canonicalJson(contract.matterContext?.scope ?? null) !==
        canonicalJson(binding.turn.reviewScope ?? null)
    ) {
      throw reviewNotFound();
    }
    if (contract.jobAidContext) {
      if (
        !this.jobAid ||
        contract.jobAidContext.actorUserId !== binding.conversation.actorId
      )
        throw reviewNotFound();
      await this.jobAid.assertReviewSources(
        contract.jobAidContext,
        row.tenantId,
        row.workItemId,
      );
    }
    if (requireCurrent) {
      if (binding.conversation.status !== 'ACTIVE') throw reviewNotFound();
      await this.requiredCurrentWorkItem(binding, scope);
    }
    return {
      scope,
      row,
      task,
      contract,
      conversation: binding.conversation,
      turn: binding.turn,
    };
  }

  private async discussionHistory(binding: ReviewBinding) {
    const repository = this.matterWorkingRepository;
    if (!repository)
      throw reviewConflict('REVIEW_RUNTIME_ACTOR_CONTEXT_UNAVAILABLE');
    // Hosted SQL middleware restores its actor before every query. Read the
    // conversation and turns through the same verified actor transaction used
    // by Matter history, rather than the browser-oriented default executor.
    const aggregate = await repository.withActorTransaction(
      binding.conversation.actorId,
      ({ database }) =>
        this.conversations.loadById(
          binding.conversation.reviewConversationId,
          database,
        ),
    );
    if (
      !aggregate ||
      aggregate.conversation.tenantId !== binding.conversation.tenantId ||
      aggregate.conversation.actorId !== binding.conversation.actorId ||
      aggregate.conversation.workItemId !== binding.conversation.workItemId
    )
      throw reviewNotFound();
    const selected =
      binding.turn.purpose === 'UPDATE_ASSESSMENT'
        ? new Set(binding.turn.includedDiscussionTurnIds ?? [])
        : null;
    const turns = aggregate.turns.filter(
      (turn) =>
        turn.turnNo < binding.turn.turnNo &&
        sameReviewBusinessScope(
          turn.reviewScope,
          reviewScopeSelection(binding.turn.reviewScope),
        ) &&
        (!selected || selected.has(turn.reviewTurnId)),
    );
    if (
      selected &&
      (turns.length !== selected.size ||
        turns.some(
          (turn) => turn.purpose !== 'CHAT' || !turn.assistantCandidate,
        ))
    )
      throw reviewConflict('REVIEW_UPDATE_DISCUSSION_INVALID');
    for (const turn of turns) {
      if (turn.reviewScope)
        await this.authorizeMatterRuntime({
          conversation: binding.conversation,
          turn,
        });
    }
    return turns;
  }

  private async buildChatTaskContract(
    binding: ReviewBinding,
    workItem: CanonicalWorkItemProjection,
  ): Promise<ReviewTurnTaskContract> {
    const aily = this.aily
      ? await this.aily.availability({
          actorId: binding.conversation.actorId,
          tenantId: binding.conversation.tenantId,
          sessionId: binding.turn.ailySessionId,
        })
      : { available: false, reason: 'NOT_CONFIGURED' };
    if (binding.turn.reviewScope) {
      // This builder only reads the authorized Matter inputs and saved state.
      // Keep its scope binding for later source reads and commit authorization.
      const task = await this.buildMatterTaskContract(binding, workItem);
      return parseReviewTurnTaskContract({
        ...task,
        context: {
          ...task.context,
          assessmentUpdateAllowed: false,
          aily,
        },
      });
    }
    const readScope = new UnifiedArtifactReadScope(this.artifactStore);
    const [
      bytes,
      attachments,
      history,
      previousTask,
      matterBasis,
      problemWork,
    ] = await Promise.all([
      readScope.readActualBytes(workItem.package!.artifact),
      this.readAttachmentContext(binding),
      this.discussionHistory(binding),
      this.conversations.loadPreviousOpenClawTask({
        reviewConversationId: binding.conversation.reviewConversationId,
        tenantId: binding.conversation.tenantId,
        actorId: binding.conversation.actorId,
        workItemId: workItem.workItemId,
        beforeTurnNo: binding.turn.turnNo,
        reviewScope: reviewScopeSelection(binding.turn.reviewScope),
      }),
      binding.turn.reviewScope ? this.authorizeMatterRuntime(binding) : null,
      this.jobAid
        ? this.jobAid.readCurrentWorkForRuntime({
            workItemId: workItem.workItemId,
            tenantId: binding.conversation.tenantId,
            actorUserId: binding.conversation.actorId,
          })
        : null,
    ]);
    const resourceRefs = mergeResourceRefs(
      frozenPackageResourceRefs(
        bytes,
        workItem.package!.artifact.ref,
        workItem.package!.artifact.sha256,
        null,
        readScope,
      ),
      attachments.resourceRefs,
    );
    return parseReviewTurnTaskContract({
      schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2',
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: binding.conversation.reviewConversationId,
      reviewTurnRef: binding.turn.reviewTurnId,
      requestId: binding.turn.requestId,
      actorContextRef: reviewSessionActorContextRef(
        binding,
        resourceRefs,
        previousTask,
      ),
      inputRevision: binding.turn.inputRevision,
      selectedEvaluationItemId: null,
      userMessage: binding.turn.userMessage,
      allowedOperations: [...REVIEW_ALLOWED_OPERATIONS],
      resourceRefs,
      allowedEvaluationItemIds: [],
      allowedAdoptedInputRefs: [],
      attachmentRefs: attachments.attachmentRefs,
      context: {
        purpose: 'CHAT',
        assessmentUpdateAllowed: false,
        workItem: {
          workItemId: workItem.workItemId,
          title: workItem.package!.title,
          documentVersionId: workItem.source.documentVersionId,
        },
        savedUnderstanding: matterBasis
          ? {
              title: matterBasis.snapshot.title,
              focus: matterBasis.working?.state.focus ?? null,
              content:
                matterBasis.working?.state.substantiveResult?.content ?? null,
              openQuestions: matterBasis.working?.state.openQuestions ?? [],
              reviewConditions:
                matterBasis.working?.state.reviewConditions ?? [],
            }
          : problemWork
            ? jobAidProblemModelWorkContent(problemWork.content)
            : {
                overallCandidate:
                  workItem.integratedAssessment?.overallSynthesis
                    ?.overallCandidate ?? null,
                engineeringSummary:
                  workItem.integratedAssessment?.overallSynthesis
                    ?.engineeringSummary ?? null,
                findings:
                  workItem.integratedAssessment?.overallSynthesis?.findings ??
                  [],
                missingInputs:
                  workItem.integratedAssessment?.overallSynthesis
                    ?.missingInputs ?? [],
              },
        discussion: history.map((turn) => ({
          reviewTurnId: turn.reviewTurnId,
          engineerStatement: turn.userMessage,
          assistantReply: turn.assistantCandidate?.answer ?? null,
          candidateOnly: true,
        })),
        engineerInput: {
          text: binding.turn.userMessage,
          attachmentRefs: attachments.attachmentRefs,
        },
        aily,
      },
      executionPolicy: {
        runtimeAppId: REVIEW_RUNTIME_APP_ID,
        profileRef: REVIEW_PROFILE_REF,
        modelPolicyRef: REVIEW_MODEL_POLICY_REF,
        skillPolicyRef: REVIEW_SKILL_POLICY_REF,
        toolPolicyRef: REVIEW_TOOL_POLICY_REF,
      },
    });
  }

  private async buildTaskContract(
    binding: ReviewBinding,
    workItem: CanonicalWorkItemProjection,
  ): Promise<ReviewTurnTaskContract> {
    if (binding.turn.purpose === 'CHAT')
      return this.buildChatTaskContract(binding, workItem);
    if (binding.turn.reviewScope)
      return this.buildMatterTaskContract(binding, workItem);
    if (
      isJobAidProblemProjection(workItem.integratedAssessment?.baseRules) ||
      (!workItem.integratedAssessment?.baseRules &&
        this.jobAid?.enabledForNewTasks())
    )
      return this.buildJobAidTaskContract(binding, workItem);
    const readScope: UnifiedArtifactReadScope = new UnifiedArtifactReadScope(
      this.artifactStore,
    );
    const [
      pageContext,
      adoptedContext,
      packageBytes,
      bilingual,
      attachmentContext,
      commonContext,
      previousTask,
    ] = await Promise.all([
      this.engineerReviews.pageContext(workItem),
      this.engineerReviews.modelContext(workItem),
      readScope.readActualBytes(workItem.package!.artifact),
      this.readBilingualContext(workItem),
      this.readAttachmentContext(binding),
      this.commonContext.build(
        workItem,
        {
          tenantId: binding.conversation.tenantId,
          actorId: binding.conversation.actorId,
        },
        {
          asOf: binding.turn.createdAt.toISOString(),
          reviewConversationId: binding.conversation.reviewConversationId,
          beforeTurnNo: binding.turn.turnNo,
          ...(binding.turn.purpose === 'UPDATE_ASSESSMENT'
            ? {
                includedDiscussionTurnIds:
                  binding.turn.includedDiscussionTurnIds ?? [],
              }
            : {}),
        },
        readScope,
      ),
      this.conversations.loadPreviousOpenClawTask({
        reviewConversationId: binding.conversation.reviewConversationId,
        tenantId: binding.conversation.tenantId,
        actorId: binding.conversation.actorId,
        workItemId: binding.conversation.workItemId,
        beforeTurnNo: binding.turn.turnNo,
      }),
    ]);
    const relatedContext = commonContext.related;
    if (!pageContext)
      throw reviewConflict('REVIEW_EVALUATION_CONTEXT_REQUIRED');
    const resolvedPageContext = resolveReviewPageSourceRefs(
      pageContext,
      await this.assessment.resolveStoredBaseSourceEvidenceRefs({
        workItem,
        tenantId: binding.conversation.tenantId,
        packageBytes,
        assessmentAsOf: binding.turn.createdAt.toISOString(),
        readScope,
      }),
    );
    const packageResourceRefs = frozenPackageResourceRefs(
      packageBytes,
      workItem.package!.artifact.ref,
      workItem.package!.artifact.sha256,
      new Set([
        ...packageReferencedSourceRefIds(resolvedPageContext, workItem),
        ...relatedContext.mentionSourceRefIds,
      ]),
      readScope,
    );
    const adoptedInputs = adoptedContext.effective.map((review) => ({
      adoptedInputRef: `engineer-review:${review.sequence}`,
      criterionId: review.criterionId,
      actionType: review.actionType,
      decision: review.decision,
      status: review.status,
      comment: review.comment,
      evidence: review.evidence.map((evidence) => ({
        sourceRefId: evidence.sourceRefId,
        kind: evidence.kind,
        statement: evidence.statement,
        locator: evidence.locator,
      })),
      resolvedMissingInputs: review.resolvedMissingInputs,
      correctedAnalysisDirection: review.correctedAnalysisDirection,
    }));
    const resourceRefs = mergeResourceRefs(
      packageResourceRefs,
      adoptedEvidenceResourceRefs(workItem, adoptedInputs),
      attachmentContext.resourceRefs,
      relatedContext.resourceRefs,
    );
    const allowedEvaluationItemIds = resolvedPageContext.items.map(
      (item) => item.criterionId,
    );
    const selectedEvaluationItemId: string | null =
      binding.turn.selectedEvaluationItemId ?? null;
    if (
      selectedEvaluationItemId !== null &&
      !allowedEvaluationItemIds.includes(selectedEvaluationItemId)
    ) {
      throw reviewConflict('REVIEW_SELECTED_EVALUATION_ITEM_NOT_FOUND');
    }
    const engineerInputRef = `engineer-input:${binding.turn.engineerSuppliedInputId}`;
    const allowedAdoptedInputRefs = [
      ...adoptedInputs.map((input) => input.adoptedInputRef),
      engineerInputRef,
      ...attachmentContext.attachmentRefs,
    ];
    const context: Record<string, unknown> = {
      workItem: {
        workItemId: workItem.workItemId,
        documentVersionId: workItem.source.documentVersionId,
        packageId: workItem.package!.packageId,
        title: workItem.package!.title,
      },
      evaluation: {
        criterionSetId: resolvedPageContext.criterionSetId,
        baseRuleRevision: resolvedPageContext.baseRuleRevision,
        gapLedger: resolvedPageContext.gapLedger,
        items: resolvedPageContext.items,
      },
      bilingual,
      applicability: {
        candidateStatus:
          workItem.integratedAssessment?.overallSynthesis
            ?.applicabilityStatus ??
          workItem.assessment?.applicabilityOverall ??
          null,
        sourceExpressionCount:
          workItem.package!.usagePolicy?.applicability.sourceExpressionCount ??
          null,
        normalizedCandidateCount:
          workItem.package!.usagePolicy?.applicability
            .normalizedCandidateCount ?? null,
        assignmentCount:
          workItem.package!.usagePolicy?.applicability.assignmentCount ?? null,
        inferredFromDocumentPresence: false,
      },
      adoptedInputs,
      engineerInput: {
        inputRef: engineerInputRef,
        text: binding.turn.candidateText,
        attachmentRefs: [...attachmentContext.attachmentRefs],
      },
      relatedContext: relatedContext.context,
      purpose: binding.turn.purpose ?? null,
      discussion: commonContext.common.discussion,
      commonContext: commonContext.common,
    };
    return parseReviewTurnTaskContract({
      schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2',
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: binding.conversation.reviewConversationId,
      reviewTurnRef: binding.turn.reviewTurnId,
      requestId: binding.turn.requestId,
      actorContextRef: reviewSessionActorContextRef(
        binding,
        resourceRefs,
        previousTask,
      ),
      inputRevision: binding.turn.inputRevision,
      selectedEvaluationItemId,
      userMessage: binding.turn.userMessage,
      allowedOperations: [...REVIEW_ALLOWED_OPERATIONS],
      resourceRefs,
      allowedEvaluationItemIds,
      allowedAdoptedInputRefs,
      attachmentRefs: [...attachmentContext.attachmentRefs],
      context,
      executionPolicy: {
        runtimeAppId: REVIEW_RUNTIME_APP_ID,
        profileRef: REVIEW_PROFILE_REF,
        modelPolicyRef: REVIEW_MODEL_POLICY_REF,
        skillPolicyRef: REVIEW_SKILL_POLICY_REF,
        toolPolicyRef: REVIEW_TOOL_POLICY_REF,
      },
    });
  }

  private async buildJobAidTaskContract(
    binding: ReviewBinding,
    workItem: CanonicalWorkItemProjection,
  ): Promise<ReviewTurnTaskContract> {
    if (!this.jobAid) throw reviewConflict('REVIEW_JOBAID_RUNTIME_UNAVAILABLE');
    if (binding.turn.selectedEvaluationItemId)
      throw reviewConflict('REVIEW_JOBAID_LEGACY_CRITERION_UNSUPPORTED');
    const [attachments, previousTask] = await Promise.all([
      this.readAttachmentContext(binding),
      this.conversations.loadPreviousOpenClawTask({
        reviewConversationId: binding.conversation.reviewConversationId,
        tenantId: binding.conversation.tenantId,
        actorId: binding.conversation.actorId,
        workItemId: workItem.workItemId,
        beforeTurnNo: binding.turn.turnNo,
      }),
    ]);
    const evidence: AssessmentEvidence[] = [
      {
        kind: 'ENGINEER_STATEMENT',
        origin: 'REVIEW_CONVERSATION',
        evidenceRef: `engineer-input:${binding.turn.engineerSuppliedInputId}`,
        title: '本轮工程师陈述',
        versionLabel: `Review ${binding.turn.turnNo}`,
        excerpt: binding.turn.candidateText || binding.turn.userMessage,
        reviewConversationId: binding.conversation.reviewConversationId,
        reviewTurnId: binding.turn.reviewTurnId,
        engineerSuppliedInputId: binding.turn.engineerSuppliedInputId,
        recordedAt: binding.turn.createdAt.toISOString(),
      },
    ];
    for (const resource of attachments.resourceRefs) {
      const attachment = binding.turn.attachmentBindings!.find(
        (item) => item.attachmentRef === resource.sourceRefId,
      )!;
      evidence.push({
        kind: 'ENGINEER_ATTACHMENT',
        evidenceRef: resource.sourceRefId,
        title: attachment.fileName,
        versionLabel: attachment.documentVersionId,
        excerpt: canonicalJson(resource.value.pages),
        workItemId: workItem.workItemId,
        reviewConversationId: binding.conversation.reviewConversationId,
        reviewTurnId: binding.turn.reviewTurnId,
        attachmentRef: attachment.attachmentRef,
        documentVersionId: attachment.documentVersionId,
        artifactRef: attachment.parsedArtifact.ref,
        artifactSha256: attachment.parsedArtifact.sha256,
        locator: '工程师上传附件的已解析页面',
      });
    }
    const discussion =
      binding.turn.purpose === 'UPDATE_ASSESSMENT'
        ? await this.discussionHistory(binding)
        : [];
    for (const turn of discussion) {
      evidence.push({
        kind: 'ENGINEER_STATEMENT',
        origin: 'REVIEW_CONVERSATION',
        evidenceRef: `engineer-input:${turn.engineerSuppliedInputId}`,
        title: '本次更新选中的工程师陈述',
        versionLabel: `Review ${turn.turnNo}`,
        excerpt: turn.candidateText || turn.userMessage,
        reviewConversationId: binding.conversation.reviewConversationId,
        reviewTurnId: turn.reviewTurnId,
        engineerSuppliedInputId: turn.engineerSuppliedInputId,
        recordedAt: turn.createdAt.toISOString(),
      });
      const savedAttachments = await this.readAttachmentContext({
        conversation: binding.conversation,
        turn,
      });
      for (const resource of savedAttachments.resourceRefs) {
        const attachment = turn.attachmentBindings.find(
          (item) => item.attachmentRef === resource.sourceRefId,
        )!;
        evidence.push({
          kind: 'ENGINEER_ATTACHMENT',
          evidenceRef: resource.sourceRefId,
          title: attachment.fileName,
          versionLabel: attachment.documentVersionId,
          excerpt: canonicalJson(resource.value.pages),
          workItemId: workItem.workItemId,
          reviewConversationId: binding.conversation.reviewConversationId,
          reviewTurnId: turn.reviewTurnId,
          attachmentRef: attachment.attachmentRef,
          documentVersionId: attachment.documentVersionId,
          artifactRef: attachment.parsedArtifact.ref,
          artifactSha256: attachment.parsedArtifact.sha256,
          locator: '本次更新选中的讨论附件已解析页面',
        });
      }
    }
    const jobAidContext = await this.jobAid.prepareReview({
      workItem,
      tenantId: binding.conversation.tenantId,
      actorUserId: binding.conversation.actorId,
      asOf: binding.turn.createdAt.toISOString(),
      evidence,
      ...(binding.turn.purpose === 'UPDATE_ASSESSMENT'
        ? {
            reviewSelection: {
              reviewConversationId: binding.conversation.reviewConversationId,
              beforeTurnNo: binding.turn.turnNo,
              // Selected statements and attachments were materialized above.
              includedDiscussionTurnIds: [],
            },
          }
        : {}),
    });
    const resourceRefs = jobAidContext.sourceCatalog.flatMap(
      (item): FrozenReviewSourceRef[] => {
        if (
          item.kind !== 'DOCUMENT_PASSAGE' &&
          item.kind !== 'ENGINEER_ATTACHMENT'
        )
          return [];
        const source =
          item.kind === 'DOCUMENT_PASSAGE'
            ? jobAidContext.sourceBindings.find(
                (entry) => entry.workItemId === item.workItemId,
              )!
            : null;
        return [
          {
            sourceRefId: item.evidenceRef,
            resourceArtifactRef:
              source?.artifactRef ??
              (
                item as Extract<
                  AssessmentEvidence,
                  { kind: 'ENGINEER_ATTACHMENT' }
                >
              ).artifactRef,
            resourceArtifactSha256:
              source?.artifactSha256 ??
              (
                item as Extract<
                  AssessmentEvidence,
                  { kind: 'ENGINEER_ATTACHMENT' }
                >
              ).artifactSha256,
            value: {
              ...overallModelEvidenceRegistry([item])[0],
              sourceRefId: item.evidenceRef,
            },
          },
        ];
      },
    );
    // Methods are delivered as method clauses, never synthetic document resources.
    jobAidContext.initiallyDeliveredRefs = [
      ...new Set([
        ...jobAidContext.initiallyDeliveredRefs,
        ...jobAidContext.sourceCatalog
          .filter((item) => item.kind === 'METHOD_CLAUSE')
          .map((item) => item.evidenceRef),
      ]),
    ];
    jobAidContext.modelInput.deliveredEvidence = overallModelEvidenceRegistry(
      jobAidContext.sourceCatalog.filter((item) =>
        jobAidContext.initiallyDeliveredRefs.includes(item.evidenceRef),
      ),
    );
    return parseReviewTurnTaskContract({
      schemaVersion: 'wiselink.3_1.review_turn_task.v1.c5',
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: binding.conversation.reviewConversationId,
      reviewTurnRef: binding.turn.reviewTurnId,
      requestId: binding.turn.requestId,
      actorContextRef: reviewSessionActorContextRef(
        binding,
        resourceRefs,
        previousTask,
      ),
      inputRevision: binding.turn.inputRevision,
      selectedEvaluationItemId: null,
      userMessage: binding.turn.userMessage,
      allowedOperations: [...REVIEW_ALLOWED_OPERATIONS],
      resourceRefs,
      allowedEvaluationItemIds: [],
      allowedAdoptedInputRefs: [],
      attachmentRefs: attachments.attachmentRefs,
      jobAidContext,
      context: {
        purpose: binding.turn.purpose ?? null,
        includedDiscussionTurnIds: binding.turn.includedDiscussionTurnIds ?? [],
        discussion: discussion.map((turn) => ({
          reviewTurnId: turn.reviewTurnId,
          engineerStatement: turn.userMessage,
          assistantReply: turn.assistantCandidate?.answer ?? null,
          candidateOnly: true,
        })),
        problemAssessment: jobAidContext.modelInput,
        engineerInput: {
          text: binding.turn.candidateText,
          attachmentRefs: attachments.attachmentRefs,
        },
      },
      executionPolicy: {
        runtimeAppId: REVIEW_RUNTIME_APP_ID,
        profileRef: REVIEW_PROFILE_REF,
        modelPolicyRef: REVIEW_MODEL_POLICY_REF,
        skillPolicyRef: REVIEW_SKILL_POLICY_REF,
        toolPolicyRef: REVIEW_JOBAID_TOOL_POLICY_REF,
      },
    });
  }

  private async authorizeMatterRuntime(binding: ReviewBinding) {
    const scope = binding.turn.reviewScope;
    if (!scope || !this.matterWorking)
      throw reviewConflict('REVIEW_MATTER_RUNTIME_UNAVAILABLE');
    const basis = await this.matterWorking.authorizeRuntimeWorkingBasis({
      matterId: scope.matterId,
      tenantId: binding.conversation.tenantId,
      actorId: binding.conversation.actorId,
      basedOnMatterRevisionId: scope.basedOnMatterRevisionId,
    });
    // Saved premises can outlive a membership change; permission must not be inherited from that old read.
    for (const evidence of basis.working?.state.substantiveResult?.evidence ??
      []) {
      if (!('workItemId' in evidence)) continue;
      const loaded = await this.workItems.loadTenantScopedProjection(
        evidence.workItemId,
        binding.conversation.tenantId,
      );
      if (
        !loaded ||
        loaded.row.requestedByUserId !== binding.conversation.actorId ||
        (evidence.kind === 'DOCUMENT_PASSAGE' &&
          loaded.row.documentVersionId !== evidence.documentVersionId)
      )
        throw reviewNotFound();
    }
    return basis;
  }

  private async buildMatterTaskContract(
    binding: ReviewBinding,
    workItem: CanonicalWorkItemProjection,
  ): Promise<ReviewTurnTaskContract> {
    const repository = this.matterWorkingRepository;
    if (!repository) throw reviewConflict('REVIEW_MATTER_RUNTIME_UNAVAILABLE');
    const scope = binding.turn.reviewScope!;
    const basis = await this.authorizeMatterRuntime(binding);
    assertMatterReviewBasis(scope, basis);
    const readScope = new UnifiedArtifactReadScope(this.artifactStore);
    const [documents, attachments, previousTask, aggregate] = await Promise.all(
      [
        Promise.all(
          scope.inputs.map(async (member) => {
            const loaded =
              member.workItemId === workItem.workItemId
                ? {
                    projection: workItem,
                    row: { requestedByUserId: binding.conversation.actorId },
                  }
                : await this.workItems.loadTenantScopedProjection(
                    member.workItemId,
                    binding.conversation.tenantId,
                  );
            const projection = loaded?.projection;
            if (
              !projection?.package ||
              loaded.row.requestedByUserId !== binding.conversation.actorId ||
              projection.revision !== member.workItemRevision ||
              projection.source.documentVersionId !== member.documentVersionId
            )
              throw reviewConflict('REVIEW_MATTER_INPUT_CHANGED');
            return {
              binding: member,
              workItem: projection,
              packageValue: readScope.parseJson(
                await readScope.readActualBytes(projection.package.artifact),
              ),
              problemWork: this.jobAid
                ? await this.jobAid.readCurrentWorkForRuntime({
                    workItemId: projection.workItemId,
                    tenantId: binding.conversation.tenantId,
                    actorUserId: binding.conversation.actorId,
                  })
                : null,
            };
          }),
        ),
        this.readAttachmentContext(binding),
        this.conversations.loadPreviousOpenClawTask({
          reviewConversationId: binding.conversation.reviewConversationId,
          tenantId: binding.conversation.tenantId,
          actorId: binding.conversation.actorId,
          workItemId: binding.conversation.workItemId,
          beforeTurnNo: binding.turn.turnNo,
          reviewScope: reviewScopeSelection(scope),
        }),
        repository.withActorTransaction(
          binding.conversation.actorId,
          ({ database }) =>
            this.conversations.loadCurrent(
              {
                tenantId: binding.conversation.tenantId,
                actorId: binding.conversation.actorId,
                workItemId: binding.conversation.workItemId,
              },
              database,
            ),
        ),
      ],
    );
    if (
      !aggregate ||
      aggregate.conversation.reviewConversationId !==
        binding.conversation.reviewConversationId
    )
      throw reviewConflict('REVIEW_CONVERSATION_CHANGED');
    const priorTurns = aggregate.turns.filter(
      (turn) =>
        (binding.turn.purpose !== 'UPDATE_ASSESSMENT' ||
          (binding.turn.includedDiscussionTurnIds ?? []).includes(
            turn.reviewTurnId,
          )) &&
        turn.turnNo < binding.turn.turnNo &&
        sameReviewBusinessScope(turn.reviewScope, reviewScopeSelection(scope)),
    );
    for (const past of priorTurns) {
      if (
        past.reviewScope?.basedOnMatterRevisionId !==
        scope.basedOnMatterRevisionId
      )
        await this.authorizeMatterRuntime({
          conversation: binding.conversation,
          turn: past,
        });
    }
    const discussionEvidence: AssessmentEvidence[] = [];
    if (binding.turn.purpose === 'UPDATE_ASSESSMENT') {
      // Recheck the exact selected set at execution, before making its content model-visible.
      const selected = await this.discussionHistory(binding);
      for (const turn of selected) {
        discussionEvidence.push({
          kind: 'ENGINEER_STATEMENT',
          origin: 'REVIEW_CONVERSATION',
          evidenceRef: `engineer-input:${turn.engineerSuppliedInputId}`,
          title: '本次更新选中的工程师陈述',
          versionLabel: `Review ${turn.turnNo}`,
          excerpt: turn.candidateText || turn.userMessage,
          reviewConversationId: binding.conversation.reviewConversationId,
          reviewTurnId: turn.reviewTurnId,
          engineerSuppliedInputId: turn.engineerSuppliedInputId,
          recordedAt: turn.createdAt.toISOString(),
        });
        const savedAttachments = await this.readAttachmentContext({
          conversation: binding.conversation,
          turn,
        });
        for (const resource of savedAttachments.resourceRefs) {
          const attachment = turn.attachmentBindings.find(
            (item) => item.attachmentRef === resource.sourceRefId,
          )!;
          discussionEvidence.push({
            kind: 'ENGINEER_ATTACHMENT',
            evidenceRef: resource.sourceRefId,
            title: attachment.fileName,
            versionLabel: attachment.documentVersionId,
            excerpt: canonicalJson(resource.value.pages),
            workItemId: workItem.workItemId,
            reviewConversationId: binding.conversation.reviewConversationId,
            reviewTurnId: turn.reviewTurnId,
            attachmentRef: attachment.attachmentRef,
            documentVersionId: attachment.documentVersionId,
            artifactRef: attachment.parsedArtifact.ref,
            artifactSha256: attachment.parsedArtifact.sha256,
            locator: '本次更新选中的讨论附件已解析页面',
          });
        }
      }
    }
    const context = buildMatterReviewContext({
      scope,
      basis,
      conversation: binding.conversation,
      turn: binding.turn,
      discussionEvidence,
      documents,
    });
    const resourceRefs = mergeResourceRefs(
      context.resourceRefs,
      attachments.resourceRefs,
    );
    // Recheck membership, working version and input versions after the actual reads.
    assertMatterReviewBasis(scope, await this.authorizeMatterRuntime(binding));
    return parseReviewTurnTaskContract({
      schemaVersion: 'wiselink.3_1.review_turn_task.v1.c4',
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: binding.conversation.reviewConversationId,
      reviewTurnRef: binding.turn.reviewTurnId,
      requestId: binding.turn.requestId,
      actorContextRef: reviewSessionActorContextRef(
        binding,
        resourceRefs,
        previousTask,
      ),
      inputRevision: binding.turn.inputRevision,
      selectedEvaluationItemId: null,
      userMessage: binding.turn.userMessage,
      allowedOperations: [...REVIEW_ALLOWED_OPERATIONS],
      resourceRefs,
      allowedEvaluationItemIds: [],
      allowedAdoptedInputRefs: [],
      attachmentRefs: attachments.attachmentRefs,
      matterContext: context.frozen,
      context: {
        purpose: binding.turn.purpose ?? null,
        matterWorking: context.model,
        engineerInput: {
          text: binding.turn.candidateText,
          attachmentRefs: attachments.attachmentRefs,
        },
        discussion: {
          turns: priorTurns.map((turn) => ({
            turnNo: turn.turnNo,
            userMessage: turn.userMessage,
            assistantAnswer: turn.assistantCandidate?.answer ?? null,
          })),
        },
      },
      executionPolicy: {
        runtimeAppId: REVIEW_RUNTIME_APP_ID,
        profileRef: REVIEW_PROFILE_REF,
        modelPolicyRef: REVIEW_MODEL_POLICY_REF,
        skillPolicyRef: REVIEW_SKILL_POLICY_REF,
        toolPolicyRef: REVIEW_MATTER_TOOL_POLICY_REF,
      },
    });
  }

  private async readAttachmentContext(binding: ReviewBinding): Promise<{
    attachmentRefs: string[];
    resourceRefs: FrozenReviewSourceRef[];
  }> {
    const resources = await Promise.all(
      (binding.turn.attachmentBindings ?? []).map(
        async (attachment: ReviewAttachmentBinding) => {
          const parsed = parseReviewAttachmentParsedArtifact(
            await this.artifactStore.readActualBytes(attachment.parsedArtifact),
          );
          if (
            parsed.attachmentRef !== attachment.attachmentRef ||
            parsed.workItemId !== binding.conversation.workItemId ||
            parsed.reviewConversationId !==
              binding.conversation.reviewConversationId ||
            parsed.documentVersionId !== attachment.documentVersionId ||
            parsed.fileName !== attachment.fileName ||
            parsed.mediaType !== attachment.mediaType ||
            parsed.byteLength !== attachment.byteLength
          ) {
            throw new Error('REVIEW_ATTACHMENT_BINDING_MISMATCH');
          }
          return {
            sourceRefId: attachment.attachmentRef,
            resourceArtifactRef: attachment.parsedArtifact.ref,
            resourceArtifactSha256: attachment.parsedArtifact.sha256,
            value: {
              sourceRefId: attachment.attachmentRef,
              kind: 'ENGINEER_ATTACHMENT',
              fileName: parsed.fileName,
              mediaType: parsed.mediaType,
              byteLength: parsed.byteLength,
              pageCount: parsed.pageCount,
              pages: parsed.pages,
            },
          } satisfies FrozenReviewSourceRef;
        },
      ),
    );
    return {
      attachmentRefs: (binding.turn.attachmentBindings ?? []).map(
        (attachment: ReviewAttachmentBinding) => attachment.attachmentRef,
      ),
      resourceRefs: resources,
    };
  }

  private async readBilingualContext(
    workItem: CanonicalWorkItemProjection,
  ): Promise<Record<string, unknown>> {
    const translation = workItem.translation;
    if (!translation || translation.currentness !== 'CURRENT') {
      return { status: 'UNAVAILABLE', units: [] };
    }
    const artifact = parseBilingualTranslationArtifact(
      await this.artifactStore.readActualBytes(translation.artifact),
    );
    return {
      status: 'BILINGUAL_READING_AID_AVAILABLE',
      sourceLocale: translation.sourceLocale,
      targetLocale: translation.targetLocale,
      units: artifact.units.map((unit) => ({
        unitId: unit.unitId,
        sourceText: unit.sourceText,
        translatedText: unit.translatedText,
        sourceRefIds: unit.sourceRefIds,
      })),
    };
  }
}

interface ReviewBinding {
  conversation: PersistedReviewConversation;
  turn: PersistedReviewTurn;
}

interface AuthorizedReviewAttempt extends ReviewBinding {
  scope: CanonicalVerifiedOpenClawAttemptScope;
  row: ActionAttemptRow;
  task: OpenClawTaskEnvelope;
  contract: ReviewTurnTaskContract;
}

function packageReferencedSourceRefIds(
  page: CanonicalEngineerReviewPageContext,
  workItem: CanonicalWorkItemProjection,
): Set<string> {
  return new Set([
    ...page.items.flatMap((item) => item.sourceRefs ?? []),
    ...(
      workItem.integratedAssessment?.overallSynthesis?.findings ?? []
    ).flatMap((finding) => finding.sourceRefIds),
  ]);
}

function resolveReviewPageSourceRefs(
  page: CanonicalEngineerReviewPageContext,
  candidateRefs: Map<string, string[]>,
): CanonicalEngineerReviewPageContext {
  const resolve = (sourceRefs: string[]): string[] => [
    ...new Set(
      sourceRefs.flatMap(
        (sourceRefId) => candidateRefs.get(sourceRefId) ?? [sourceRefId],
      ),
    ),
  ];
  return {
    ...page,
    gapLedger: {
      ...page.gapLedger,
      gaps: page.gapLedger.gaps.map((gap) => ({
        ...gap,
        sourceRefs: resolve(gap.sourceRefs),
      })),
    },
    items: page.items.map((item) => ({
      ...item,
      sourceRefs: resolve(item.sourceRefs ?? []),
    })),
  };
}

function frozenPackageResourceRefs(
  bytes: Uint8Array,
  resourceArtifactRef: string,
  resourceArtifactSha256: string,
  referenced: Set<string> | null,
  readScope: UnifiedArtifactReadScope,
): FrozenReviewSourceRef[] {
  const raw: unknown = readScope.parseJson(bytes);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('REVIEW_PACKAGE_JSON_INVALID');
  }
  const sourceRefs = (raw as Record<string, unknown>).sourceRefs;
  if (!Array.isArray(sourceRefs))
    throw new Error('REVIEW_PACKAGE_SOURCE_REFS_INVALID');
  const result: FrozenReviewSourceRef[] = [];
  const seen = new Set<string>();
  for (const value of sourceRefs) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('REVIEW_PACKAGE_SOURCE_REF_INVALID');
    }
    const ref = value as Record<string, unknown>;
    const sourceRefId = requiredText(
      ref.sourceRefId,
      'REVIEW_PACKAGE_SOURCE_REF_ID_INVALID',
    );
    if (seen.has(sourceRefId))
      throw new Error('REVIEW_PACKAGE_SOURCE_REF_DUPLICATE');
    seen.add(sourceRefId);
    if (referenced && !referenced.has(sourceRefId)) continue;
    result.push({
      sourceRefId,
      resourceArtifactRef,
      resourceArtifactSha256,
      value: structuredClone(ref),
    });
  }
  if (
    referenced &&
    [...referenced].some((sourceRefId) => !seen.has(sourceRefId))
  ) {
    throw new Error('REVIEW_REFERENCED_SOURCE_REF_NOT_IN_PACKAGE');
  }
  return result;
}

interface MinimalAdoptedInput {
  adoptedInputRef: string;
  evidence: Array<{
    sourceRefId: string;
    kind: string;
    statement: string;
    locator: string;
  }>;
}

function adoptedEvidenceResourceRefs(
  workItem: CanonicalWorkItemProjection,
  adoptedInputs: MinimalAdoptedInput[],
): FrozenReviewSourceRef[] {
  const artifact = workItem.integratedAssessment?.engineerReviews?.artifact;
  if (!artifact) {
    if (adoptedInputs.some((input) => input.evidence.length > 0)) {
      throw new Error('REVIEW_ADOPTED_EVIDENCE_ARTIFACT_REQUIRED');
    }
    return [];
  }
  return adoptedInputs.flatMap((input) =>
    input.evidence.map((evidence) => ({
      sourceRefId: evidence.sourceRefId,
      resourceArtifactRef: artifact.ref,
      resourceArtifactSha256: artifact.sha256,
      value: {
        sourceRefId: evidence.sourceRefId,
        kind: evidence.kind,
        statement: evidence.statement,
        locator: evidence.locator,
        adoptedInputRef: input.adoptedInputRef,
      },
    })),
  );
}

function mergeResourceRefs(
  ...groups: FrozenReviewSourceRef[][]
): FrozenReviewSourceRef[] {
  const result = new Map<string, FrozenReviewSourceRef>();
  for (const ref of groups.flat()) {
    if (result.has(ref.sourceRefId)) {
      throw new Error('REVIEW_RESOURCE_REF_COLLISION');
    }
    result.set(ref.sourceRefId, ref);
  }
  return [...result.values()];
}

function taskArtifactRefs(
  workItem: CanonicalWorkItemProjection,
  turn: PersistedReviewTurn,
  contract: ReviewTurnTaskContract,
): OpenClawTaskEnvelope['sourceRefs'] {
  const artifacts = [
    workItem.package?.artifact,
    workItem.translation?.artifact,
    workItem.integratedAssessment?.baseRules?.artifact,
    workItem.integratedAssessment?.engineerReviews?.artifact,
    workItem.integratedAssessment?.overallSynthesis?.artifact,
    ...(turn.attachmentBindings ?? []).map(
      (attachment: ReviewAttachmentBinding) => attachment.parsedArtifact,
    ),
    ...contract.resourceRefs.map((resource) => ({
      ref: resource.resourceArtifactRef,
      sha256: resource.resourceArtifactSha256,
    })),
  ].filter((value) => value !== undefined);
  const result = new Map<string, string>();
  for (const artifact of artifacts) {
    const existing = result.get(artifact.ref);
    if (existing && existing !== artifact.sha256) {
      throw new Error('REVIEW_TASK_ARTIFACT_BINDING_CONFLICT');
    }
    result.set(artifact.ref, artifact.sha256);
  }
  return [...result].map(([ref, sha256]) => ({ ref, sha256 }));
}

function assistantCandidate(
  attemptRef: string,
  candidate: ReviewTurnCandidateContract,
  result: OpenClawResultEnvelope,
): Omit<ReviewTurnAssistantCandidate, 'completedAt'> {
  const decisionSnapshot = candidate.reviewActionDraft?.decisionSnapshot
    ? {
        ...structuredClone(candidate.reviewActionDraft.decisionSnapshot),
        decisionSnapshotRef: `DS-${canonicalSha256({
          schemaVersion: 'wiselink.3_1.decision_snapshot_ref.v1',
          attemptRef,
          workItemId: result.workItemId,
          revision: result.baseRevision,
          resultContentHash: result.contentHash,
          snapshot: candidate.reviewActionDraft.decisionSnapshot,
        })}`,
        workItemId: result.workItemId,
        revision: result.baseRevision,
        engineerConfirmationRef: null,
      }
    : null;
  const persistedDraft = candidate.reviewActionDraft
    ? {
        ...structuredClone(candidate.reviewActionDraft),
        uncertaintyDispositions: [
          ...(candidate.reviewActionDraft.uncertaintyDispositions ?? []),
        ],
        decisionSnapshot,
      }
    : null;
  const reviewActionDraft = candidate.reviewActionDraft
    ? {
        ...persistedDraft!,
        reviewActionDraftRef: `RAD-${canonicalSha256({
          schemaVersion: 'wiselink.3_1.review_action_draft_ref.v1',
          attemptRef,
          reviewConversationRef: candidate.reviewConversationRef,
          reviewTurnRef: candidate.reviewTurnRef,
          resultContentHash: result.contentHash,
          draft: persistedDraft,
        })}`,
      }
    : null;
  return {
    responseType: candidate.responseType,
    answer: candidate.answer,
    sourceRefs: [...candidate.sourceRefs],
    missingInputs: [...candidate.missingInputs],
    candidateEvidenceRefs: [...candidate.candidateEvidenceRefs],
    reviewActionDraft,
    affectedItemIds: [...candidate.affectedItemIds],
    warnings: [...candidate.warnings],
    actionAttemptRef: attemptRef,
    provenance: {
      runtimeAppId: REVIEW_RUNTIME_APP_ID,
      profileRef: REVIEW_PROFILE_REF,
      modelVersion: result.modelVersion,
      promptVersion: result.promptVersion,
      skillVersion: result.skillVersion,
      toolVersions: structuredClone(result.toolVersions),
      resultContentHash: result.contentHash,
    },
  };
}

function reviewIdempotencyKey(binding: ReviewBinding): string {
  return [
    'openclaw-v1',
    'review',
    binding.conversation.reviewConversationId,
    binding.turn.reviewTurnId,
    binding.turn.inputRevision,
  ].join(':');
}

function reviewSessionActorContextRef(
  binding: ReviewBinding,
  resources: FrozenReviewSourceRef[],
  previous: { status: string | null; taskEnvelopeJson: string | null } | null,
): string {
  // Use existing Turn IDs and persisted attempt inputs, not another session
  // registry/hash. A failed turn may have uncommitted native history, so it
  // starts a new session too. Host discussion remains the recovery context.
  const freshRef = `ACTX-RS-${binding.turn.reviewTurnId}`;
  // An update consumes only its explicit selection, never implicit native chat memory.
  if (binding.turn.purpose === 'UPDATE_ASSESSMENT') return freshRef;
  if (previous?.status !== 'SUCCEEDED' || !previous.taskEnvelopeJson)
    return freshRef;
  const priorTask = parseTaskEnvelope(previous.taskEnvelopeJson);
  const prior = parseReviewTurnTaskContract(priorTask.modelInput);
  if (
    (prior.context.purpose === 'CHAT') !== (binding.turn.purpose === 'CHAT') ||
    priorTask.tenantId !== binding.conversation.tenantId ||
    priorTask.workItemId !== binding.conversation.workItemId ||
    priorTask.executionModel?.modelRef !==
      binding.turn.requestedModel?.modelRef ||
    prior.reviewConversationRef !== binding.conversation.reviewConversationId ||
    prior.inputRevision !== binding.turn.inputRevision ||
    !sameReviewBusinessScope(
      prior.matterContext?.scope,
      reviewScopeSelection(binding.turn.reviewScope),
    ) ||
    (binding.turn.reviewScope &&
      prior.matterContext?.scope.basedOnMatterRevisionId !==
        binding.turn.reviewScope.basedOnMatterRevisionId) ||
    !prior.actorContextRef.startsWith('ACTX-RS-')
  )
    return freshRef;
  const priorResources = new Map(
    prior.resourceRefs.map((resource) => [resource.sourceRefId, resource]),
  );
  const sameSources =
    resources.length === priorResources.size &&
    resources.every((resource) => {
      const stored = priorResources.get(resource.sourceRefId);
      return (
        stored?.resourceArtifactRef === resource.resourceArtifactRef &&
        stored.resourceArtifactSha256 === resource.resourceArtifactSha256
      );
    });
  // Related-document permission/material changes need not increment this WI's
  // revision. Compare its fresh authorized catalog before retaining memory.
  return sameSources ? prior.actorContextRef : freshRef;
}

function assertWorkItemScope(
  scope: CanonicalVerifiedServiceScope,
  workItemId: string,
): void {
  if (
    scope.workItemId !== workItemId ||
    scope.appId !== CANONICAL_APP_ID ||
    !scope.principalId.trim() ||
    !scope.tenantId.trim() ||
    !scope.authorizationFingerprint.trim()
  ) {
    throw reviewNotFound();
  }
}

function assertAttemptScope(
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attemptRef: string,
): void {
  assertWorkItemScope(scope, scope.workItemId);
  if (scope.attemptRef !== attemptRef) throw reviewNotFound();
}

function assertDistinctRequiredTexts(values: string[], code: string): void {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => typeof value !== 'string' || !value.trim()) ||
    new Set(values).size !== values.length
  ) {
    throw Object.assign(new Error(code), { code, statusCode: 400 });
  }
}

function assertReviewCommitFence(input: {
  row: ActionAttemptRow;
  principalId: string;
  leaseToken: string;
  leaseGeneration: number;
}): void {
  const { row } = input;
  if (row.status === 'SUCCEEDED') return;
  if (!['RUNNING', 'COMMITTING'].includes(row.status)) {
    throw reviewConflict(`ACTION_ATTEMPT_ALREADY_${row.status}`);
  }
  if (
    row.leaseOwner !== input.principalId ||
    row.leaseToken !== input.leaseToken ||
    row.leaseGeneration !== input.leaseGeneration
  ) {
    throw reviewConflict('ACTION_ATTEMPT_LEASE_FENCE_REJECTED');
  }
  if (row.status === 'COMMITTING') return;
  const now = new Date();
  if (!row.leaseExpiresAt || row.leaseExpiresAt <= now) {
    throw reviewConflict('ACTION_ATTEMPT_LEASE_EXPIRED');
  }
  if (row.deadlineAt && row.deadlineAt <= now) {
    throw reviewConflict('ACTION_ATTEMPT_DEADLINE_EXCEEDED');
  }
  if (row.cancelRequestedAt) {
    throw reviewConflict('ACTION_ATTEMPT_CANCELLED');
  }
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw Object.assign(new Error(code), { code, statusCode: 400 });
  }
  return value;
}

function reviewNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('Review turn was not found.'), {
    code: 'REVIEW_TURN_NOT_FOUND',
    statusCode: 404,
  });
}

function reviewSourceRefNotAllowed(): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(
    new Error('Review SourceRef is not in the frozen task allowlist.'),
    {
      code: 'REVIEW_SOURCE_REF_NOT_ALLOWED',
      statusCode: 400,
    },
  );
}

function reviewConflict(code: string): Error & {
  code: string;
  statusCode: number;
} {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
