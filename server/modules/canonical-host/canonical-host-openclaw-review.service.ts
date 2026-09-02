import { Inject, Injectable, Logger } from '@nestjs/common';

import type {
  CanonicalEngineerReviewPageContext,
  CanonicalWorkItemProjection,
  ReviewTurnAssistantCandidate,
} from '@shared/api.interface';
import {
  canonicalSha256,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
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
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
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

const CANONICAL_APP_ID = 'app_17bzc551rsg';
const REVIEW_TASK_TYPE = 'OPENCLAW_INTERACTIVE_REVIEW' as const;

export interface BeginReviewTurnResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
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
  ) {}

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
    const workItem = await this.requiredCurrentWorkItem(binding, scope);
    const taskContract = await this.buildTaskContract(binding, workItem);
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType: REVIEW_TASK_TYPE,
      actorUserId: binding.conversation.actorId,
      tenantId: binding.conversation.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: binding.turn.inputRevision,
      baseRevision: binding.turn.inputRevision,
      idempotencyKey: reviewIdempotencyKey(binding),
      sourceRefs: taskArtifactRefs(workItem, binding.turn),
      allowedConnectors: [],
      buildModelInput: async () =>
        structuredClone(taskContract) as unknown as Record<string, unknown>,
    });
    return {
      attemptRef: claim.attemptRef,
      status: claim.status,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      leaseExpiresAt: claim.leaseExpiresAt,
      task: structuredClone(claim.task),
      ...(claim.status === 'COMMITTING'
        ? { recoveryResult: structuredClone(claim.recoveryResult) }
        : {}),
    };
  }

  async context(attemptRef: string): Promise<ReviewTurnContextResult> {
    const attempt = await this.requiredReviewAttempt(
      attemptRef,
      'GET_REVIEW_CONTEXT',
    );
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
    return {
      schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
      attemptRef,
      sourceRefs: selected,
    };
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
    const persisted =
      await this.conversations.persistOpenClawAssistantCandidate({
        conversation: authorized.conversation,
        turn: authorized.turn,
        actionAttemptId: prepared.row.attemptId,
        candidate: assistantCandidate(attemptRef, candidate, result),
        completedAt: new Date(),
      });
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
      binding.turn.inputRevision !== loaded.row.revision ||
      binding.conversation.lastSyncedRevision !== loaded.row.revision ||
      loaded.projection.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      !loaded.projection.package ||
      !loaded.projection.integratedAssessment?.baseRules
    ) {
      throw reviewConflict('REVIEW_TURN_BINDING_STALE_OR_INELIGIBLE');
    }
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
      task.inputRevision !== binding.turn.inputRevision
    ) {
      throw reviewNotFound();
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

  private async buildTaskContract(
    binding: ReviewBinding,
    workItem: CanonicalWorkItemProjection,
  ): Promise<ReviewTurnTaskContract> {
    const [
      pageContext,
      adoptedContext,
      packageBytes,
      bilingual,
      attachmentContext,
    ] = await Promise.all([
      this.engineerReviews.pageContext(workItem),
      this.engineerReviews.modelContext(workItem),
      this.artifactStore.readActualBytes(workItem.package!.artifact),
      this.readBilingualContext(workItem),
      this.readAttachmentContext(binding),
    ]);
    if (!pageContext)
      throw reviewConflict('REVIEW_EVALUATION_CONTEXT_REQUIRED');
    const resolvedPageContext = resolveReviewPageSourceRefs(
      pageContext,
      await this.assessment.resolveStoredBaseSourceEvidenceRefs({
        workItem,
        tenantId: binding.conversation.tenantId,
        packageBytes,
        assessmentAsOf: binding.turn.createdAt.toISOString(),
      }),
    );
    const packageResourceRefs = frozenPackageResourceRefs(
      packageBytes,
      workItem.package!.artifact.ref,
      workItem.package!.artifact.sha256,
      packageReferencedSourceRefIds(resolvedPageContext, workItem),
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
    );
    const allowedEvaluationItemIds = resolvedPageContext.items.map(
      (item) => item.criterionId,
    );
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
    };
    return parseReviewTurnTaskContract({
      schemaVersion: 'wiselink.3_1.review_turn_task.v1.c2',
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: binding.conversation.reviewConversationId,
      reviewTurnRef: binding.turn.reviewTurnId,
      requestId: binding.turn.requestId,
      actorContextRef: actorContextRef(binding.conversation),
      inputRevision: binding.turn.inputRevision,
      selectedEvaluationItemId: null,
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
      sourceRefs.flatMap((sourceRefId) =>
        candidateRefs.get(sourceRefId) ?? [sourceRefId],
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
  referenced: Set<string>,
): FrozenReviewSourceRef[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(text);
  const raw: unknown = JSON.parse(text) as unknown;
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
    if (!referenced.has(sourceRefId)) continue;
    result.push({
      sourceRefId,
      resourceArtifactRef,
      resourceArtifactSha256,
      value: structuredClone(ref),
    });
  }
  if ([...referenced].some((sourceRefId) => !seen.has(sourceRefId))) {
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
): OpenClawTaskEnvelope['sourceRefs'] {
  const artifacts = [
    workItem.package?.artifact,
    workItem.translation?.artifact,
    workItem.integratedAssessment?.baseRules.artifact,
    workItem.integratedAssessment?.engineerReviews?.artifact,
    workItem.integratedAssessment?.overallSynthesis?.artifact,
    ...(turn.attachmentBindings ?? []).map(
      (attachment: ReviewAttachmentBinding) => attachment.parsedArtifact,
    ),
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
  return {
    responseType: candidate.responseType,
    answer: candidate.answer,
    sourceRefs: [...candidate.sourceRefs],
    missingInputs: [...candidate.missingInputs],
    candidateEvidenceRefs: [...candidate.candidateEvidenceRefs],
    reviewActionDraft: candidate.reviewActionDraft
      ? structuredClone(candidate.reviewActionDraft)
      : null,
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

function actorContextRef(conversation: PersistedReviewConversation): string {
  return `ACTX-${canonicalSha256({
    schemaVersion: 'wiselink.3_1.review_actor_context_ref.v1.c2',
    reviewConversationRef: conversation.reviewConversationId,
    tenantId: conversation.tenantId,
    actorId: conversation.actorId,
  })}`;
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
