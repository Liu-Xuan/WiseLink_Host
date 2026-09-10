import { InitialAssessmentKnowledgeService } from './initial-assessment-knowledge.service';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';
import type { AssessmentEvidence } from '@shared/assessment-reading.interface';
import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  isJobAidProblemProjection,
  type CanonicalJobAidProblemCandidateProjection,
  type JobAidWorkRevision,
  type JobAidWorkingReadModel,
} from '@shared/jobaid-problem-assessment.interface';
import {
  canonicalJson,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import {
  buildInitialAnalysisRequestInput,
  readInitialAnalysisRequestInput,
} from '../action-attempt/initial-analysis-request';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ActionAttemptTerminalProjection,
  PreparedActionAttemptCommit,
} from '../action-attempt/action-attempt.types';
import { ReviewConversationRepository } from '../review-persistence/review-conversation.repository';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedArtifactReadScope } from '../unified-reader/unified-artifact-read-scope';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import { CanonicalHostCommonContextService } from './canonical-host-common-context.service';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';
import { preflightCanonicalHostOpenClawResult } from './canonical-host-openclaw-runtime-policy';
import {
  buildOverallReadingEvidence,
  overallModelEvidenceRegistry,
} from './overall-assessment-reading';
import {
  buildJobAidProblemTask,
  expandJobAidSourceSelection,
  isJobAidProblemTask,
  parseJobAidProblemTask,
  resolvedAssessmentSources,
  type JobAidProblemModelInput,
  type JobAidProblemTaskInput,
  type JobAidSourceBinding,
} from './jobaid-problem-task';
import {
  jobAidReadingResult,
  materializeJobAidWork,
} from './jobaid-problem-work';
import {
  JobAidWorkRepository,
  assertJobAidWorkFence,
  type JobAidWorkFence,
} from './jobaid-work.repository';
import {
  activeConfigurationEvidenceReevaluation,
  configurationEvidenceShadow,
  withStagedBaseRules,
  promoteConfigurationEvidenceReevaluation,
  retryConfigurationEvidenceReevaluationStage,
} from './configuration-evidence/configuration-evidence-reevaluation.state';

export interface BeginJobAidProblemResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
  recoveryResult?: OpenClawResultEnvelope;
  modelInput: JobAidProblemModelInput;
  selectedDiscoveryRefs: string[];
}

/** Problem analysis uses the existing ActionAttempt, source authorization and candidate CAS. */
@Injectable()
export class CanonicalJobAidProblemService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    private readonly attempts: ActionAttemptLifecycleService,
    private readonly workItems: MiaodaWorkItemRepository,
    private readonly conversations: ReviewConversationRepository,
    private readonly common: CanonicalHostCommonContextService,
    private readonly work: JobAidWorkRepository,
    @Optional() private readonly knowledge?: InitialAssessmentKnowledgeService,
  ) {}

  /** Deployment first installs dual readers; only explicitly enabled NEW tasks use v2. */
  enabledForNewTasks(): boolean {
    return process.env.WL_JOBAID_PROBLEM_V2_ENABLED === '1';
  }

  async hasBoundTask(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    purpose: JobAidProblemModelInput['purpose'],
  ): Promise<boolean> {
    return !!(await this.attempts.readExactIdempotency({
      tenantId,
      workItemId: workItem.workItemId,
      taskType:
        purpose === 'INITIAL_PROBLEM_ASSESSMENT'
          ? 'OPENCLAW_DYNAMIC_EVALUATION'
          : 'OPENCLAW_OVERALL_SYNTHESIS',
      baseRevision: workItem.revision,
      documentVersionId: workItem.source.documentVersionId,
      idempotencyKey: problemIdempotencyKey(workItem, purpose),
    }));
  }

  async begin(
    workItem: CanonicalWorkItemProjection,
    scope: CanonicalVerifiedServiceScope,
    purpose: JobAidProblemModelInput['purpose'],
    requestId?: string,
  ): Promise<BeginJobAidProblemResult> {
    const loaded = await this.workItems.loadTenantScopedProjection(
      workItem.workItemId,
      scope.tenantId,
    );
    if (
      !loaded ||
      loaded.row.documentVersionId !== workItem.source.documentVersionId ||
      !workItem.package
    )
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const actorUserId = loaded.row.requestedByUserId;
    const taskType =
      purpose === 'INITIAL_PROBLEM_ASSESSMENT'
        ? 'OPENCLAW_DYNAMIC_EVALUATION'
        : 'OPENCLAW_OVERALL_SYNTHESIS';
    const idempotencyKey = problemIdempotencyKey(workItem, purpose, requestId);
    if (requestId !== undefined) {
      const existing = await this.attempts.readRequest({
        tenantId: scope.tenantId,
        workItemId: workItem.workItemId,
        taskType,
        documentVersionId: workItem.source.documentVersionId,
        idempotencyKey,
      });
      if (existing) {
        continuationReceipt(existing, purpose);
        if (
          !['QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING'].includes(
            existing.status,
          )
        )
          throw new Error(`ACTION_ATTEMPT_ALREADY_${existing.status}`);
      } else if (!this.enabledForNewTasks()) {
        throw new Error('JOBAID_PROBLEM_V2_NEW_REQUEST_DISABLED');
      }
    }
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType,
      actorUserId: 'service:openclaw-main',
      tenantId: scope.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey,
      sourceRefs: [
        {
          ref: workItem.package.artifact.ref,
          sha256: workItem.package.artifact.sha256,
        },
      ],
      allowedConnectors: loaded.row.initialAilySessionId
        ? ['feishu-aily-user']
        : [],
      initialKnowledgeSession: {
        expectedSessionId: loaded.row.initialAilySessionId ?? null,
      },
      buildModelInput: (identity) =>
        this.buildInput(
          workItem,
          scope.tenantId,
          actorUserId,
          scope.authorizationFingerprint,
          purpose,
          identity.createdAt.toISOString(),
        ),
    });
    const input = parseJobAidProblemTask(claim.task);
    await this.assertSourcesAuthorized(
      input.sourceCatalog,
      input,
      scope.tenantId,
      workItem.workItemId,
    );
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
      modelInput: structuredClone(input.modelInput),
      selectedDiscoveryRefs: [],
    };
  }

  /** Called after browser owner, permission and current-version checks. */
  async enqueueContinuation(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    permissionSnapshotVersion: string,
    requestId: string,
    purpose: 'INITIAL_PROBLEM_ASSESSMENT' | 'OVERALL_CONSISTENCY',
    authorizedKnowledgeSession?: {
      sessionId: string;
      actorId: string;
      tenantId: string;
    },
  ) {
    if (!permissionSnapshotVersion.trim())
      throw new Error('JOBAID_PERMISSION_SNAPSHOT_REQUIRED');
    const idempotencyKey = problemIdempotencyKey(workItem, purpose, requestId);
    const taskType =
      purpose === 'INITIAL_PROBLEM_ASSESSMENT'
        ? 'OPENCLAW_DYNAMIC_EVALUATION'
        : 'OPENCLAW_OVERALL_SYNTHESIS';
    const existing = await this.attempts.readRequest({
      tenantId,
      workItemId: workItem.workItemId,
      taskType,
      documentVersionId: workItem.source.documentVersionId,
      idempotencyKey,
    });
    if (existing) return continuationReceipt(existing, purpose);
    if (!this.enabledForNewTasks())
      throw new Error('JOBAID_PROBLEM_V2_NEW_REQUEST_DISABLED');

    const execution = await this.prepareContinuationWorkItem(
      workItem,
      tenantId,
      purpose,
    );
    const loaded = await this.workItems.loadTenantScopedProjection(
      execution.workItemId,
      tenantId,
    );
    if (
      !loaded ||
      loaded.row.documentVersionId !== execution.source.documentVersionId ||
      !execution.package
    )
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const reserved = await this.attempts.reserve({
      workItemId: execution.workItemId,
      taskType,
      actorUserId: 'service:openclaw-main',
      tenantId,
      documentVersionId: execution.source.documentVersionId,
      inputRevision: execution.revision,
      baseRevision: execution.revision,
      idempotencyKey,
      sourceRefs: [
        {
          ref: execution.package.artifact.ref,
          sha256: execution.package.artifact.sha256,
        },
      ],
      allowedConnectors:
        authorizedKnowledgeSession || loaded.row.initialAilySessionId
          ? ['feishu-aily-user']
          : [],
      initialKnowledgeSession: {
        expectedSessionId: loaded.row.initialAilySessionId ?? null,
        ...(authorizedKnowledgeSession
          ? { replacement: authorizedKnowledgeSession }
          : {}),
      },
      buildModelInput: async () =>
        buildInitialAnalysisRequestInput({ taskType, requestId }),
    });
    return {
      attemptRef: reserved.task.operationRef,
      status: reserved.row.status,
      created: reserved.created,
      workItemRevision: reserved.task.baseRevision,
    };
  }

  private async prepareContinuationWorkItem(
    requested: CanonicalWorkItemProjection,
    tenantId: string,
    purpose: 'INITIAL_PROBLEM_ASSESSMENT' | 'OVERALL_CONSISTENCY',
  ): Promise<CanonicalWorkItemProjection> {
    let authoritative = await this.registrar.getTenantScopedByWorkItemId({
      tenantId,
      workItemId: requested.workItemId,
    });
    if (
      authoritative.revision !== requested.revision ||
      authoritative.source.documentVersionId !==
        requested.source.documentVersionId
    )
      throw new Error('JOBAID_WORK_ITEM_BINDING_CHANGED');
    const marker = activeConfigurationEvidenceReevaluation(authoritative);
    if (!marker) return authoritative;
    if (
      marker.stages.applicability.status !== 'SUCCEEDED' ||
      !marker.stagedBundle.applicabilityInput ||
      !marker.stagedBundle.applicability
    )
      throw new Error(
        'CONFIGURATION_REEVALUATION_APPLICABILITY_STAGE_REQUIRED',
      );
    if (
      purpose === 'INITIAL_PROBLEM_ASSESSMENT' &&
      marker.stages.dynamic.status === 'SUCCEEDED'
    )
      throw new Error('CONFIGURATION_REEVALUATION_DYNAMIC_ALREADY_SUCCEEDED');
    if (
      purpose === 'OVERALL_CONSISTENCY' &&
      (marker.stages.dynamic.status !== 'SUCCEEDED' ||
        !marker.stagedBundle.baseRules)
    )
      throw new Error('CONFIGURATION_REEVALUATION_OVERALL_STAGE_REQUIRED');
    const stage =
      purpose === 'INITIAL_PROBLEM_ASSESSMENT' ? 'DYNAMIC' : 'OVERALL';
    const status =
      stage === 'DYNAMIC'
        ? marker.stages.dynamic.status
        : marker.stages.overall.status;
    if (['WAITING_INPUT', 'FAILED', 'CONFLICT'].includes(status)) {
      const retry = retryConfigurationEvidenceReevaluationStage({
        workItem: authoritative,
        stage,
      });
      authoritative = await this.registrar.compareAndSet({
        workItemId: authoritative.workItemId,
        expectedRevision: authoritative.revision,
        syncPrimaryAttempt: false,
        next: withoutRevision(retry),
      });
    }
    return configurationEvidenceShadow(authoritative);
  }

  async enqueueOverall(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    permissionSnapshotVersion: string,
  ) {
    const loaded = await this.workItems.loadTenantScopedProjection(
      workItem.workItemId,
      tenantId,
    );
    if (!loaded || !workItem.package)
      throw new Error('JOBAID_WORK_ITEM_BINDING_INVALID');
    const reserved = await this.attempts.reserve({
      workItemId: workItem.workItemId,
      taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
      actorUserId: 'service:openclaw-main',
      tenantId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey: problemIdempotencyKey(workItem, 'OVERALL_CONSISTENCY'),
      sourceRefs: [
        {
          ref: workItem.package.artifact.ref,
          sha256: workItem.package.artifact.sha256,
        },
      ],
      allowedConnectors: loaded.row.initialAilySessionId
        ? ['feishu-aily-user']
        : [],
      initialKnowledgeSession: {
        expectedSessionId: loaded.row.initialAilySessionId ?? null,
      },
      buildModelInput: (identity) =>
        this.buildInput(
          workItem,
          tenantId,
          loaded.row.requestedByUserId,
          permissionSnapshotVersion,
          'OVERALL_CONSISTENCY',
          identity.createdAt.toISOString(),
        ),
    });
    return {
      attemptRef: reserved.task.operationRef,
      created: reserved.created,
    };
  }

  private async buildInput(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
    actorUserId: string,
    permissionSnapshotVersion: string,
    purpose: JobAidProblemModelInput['purpose'],
    asOf: string,
    extraEvidence: AssessmentEvidence[] = [],
    reviewSelection?: {
      reviewConversationId: string;
      beforeTurnNo: number;
      includedDiscussionTurnIds: string[];
    },
  ): Promise<JobAidProblemTaskInput> {
    const readScope = new UnifiedArtifactReadScope(this.artifactStore);
    const [packageBytes, common, history] = await Promise.all([
      readScope.readActualBytes(workItem.package!.artifact),
      this.common.buildForWorkItemWithEvidence(
        workItem,
        tenantId,
        asOf,
        readScope,
        reviewSelection,
      ),
      this.work.listHeadersForRuntime({
        tenantId: tenantId,
        workItemId: workItem.workItemId,
        actorUserId,
      }),
    ]);
    const primary = buildOverallReadingEvidence({
      workItem,
      packageBytes,
      readScope,
      engineerReviewContext: {
        revision: null,
        artifactSha256: null,
        reviewCount: 0,
        history: [],
        effective: [],
      },
    });
    const sourceCatalog = [
      ...primary,
      ...common.availableReadingEvidence,
      ...extraEvidence,
    ];
    const base = workItem.integratedAssessment?.baseRules;
    if (purpose === 'OVERALL_CONSISTENCY' && !isJobAidProblemProjection(base))
      throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    const previousWorkRef =
      purpose === 'OVERALL_CONSISTENCY' && isJobAidProblemProjection(base)
        ? base.workRevisionRef
        : history[0]?.workRevisionRef;
    const previousWork = previousWorkRef
      ? await this.work.readByRefForRuntime({
          tenantId,
          workItemId: workItem.workItemId,
          actorUserId,
          workRevisionRef: previousWorkRef,
        })
      : null;
    if (previousWorkRef && !previousWork)
      throw new Error(
        purpose === 'OVERALL_CONSISTENCY'
          ? 'JOBAID_OVERALL_EXACT_WORK_REQUIRED'
          : 'JOBAID_PREVIOUS_WORK_NOT_FOUND',
      );
    if (purpose === 'OVERALL_CONSISTENCY') {
      if (!isJobAidProblemProjection(base))
        throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
      if (
        !previousWork ||
        previousWork.workRevisionRef !== history[0]?.workRevisionRef ||
        previousWork.workRevision !== base.workRevision ||
        previousWork.documentVersionId !== workItem.source.documentVersionId ||
        previousWork.content.roundCompletion === 'IN_PROGRESS'
      )
        throw new Error('JOBAID_OVERALL_EXACT_WORK_REQUIRED');
    }
    // Authorize the complete new input inside buildModelInput, before the
    // lifecycle persists or claims an attempt. begin also rechecks replays.
    const sourceBindings = await this.sourceBindings(
      [...sourceCatalog, ...(previousWork?.content.evidence ?? [])],
      workItem,
      tenantId,
      actorUserId,
    );
    const taskInput = buildJobAidProblemTask({
      workItem,
      actorUserId,
      permissionSnapshotVersion: permissionSnapshotVersion,
      purpose,
      sourceCatalog,
      sourceBindings,
      common: common.common,
      previousWork,
      expectedWorkRevision: history[0]?.workRevision ?? 0,
      priorAssessmentRefs: history.map((revision) => revision.workRevisionRef),
    });
    if (purpose !== 'PROBLEM_REVIEW') {
      const loaded = await this.workItems.loadTenantScopedProjection(
        workItem.workItemId,
        tenantId,
      );
      const knowledge = await this.knowledge?.binding(
        { tenantId, actorId: actorUserId, workItemId: workItem.workItemId },
        loaded?.row.initialAilySessionId,
      );
      taskInput.knowledgeBinding = knowledge?.binding;
      taskInput.modelInput.knowledgeAccess = knowledge?.access ?? {
        available: false,
        reason: 'NOT_CONFIGURED',
      };
      if (taskInput.modelInput.contextPackage)
        taskInput.modelInput.contextPackage.knowledgeRetrieval = {
          status: knowledge?.binding ? 'NOT_REQUESTED' : 'UNAVAILABLE',
          reason:
            knowledge?.access.reason ??
            (knowledge?.binding ? undefined : 'NOT_CONFIGURED'),
          fragments: [],
        };
    }
    return taskInput;
  }

  async readCurrentWorkForRuntime(input: {
    workItemId: string;
    tenantId: string;
    actorUserId: string;
  }): Promise<JobAidWorkRevision | null> {
    const current = await this.work.latestForRuntime(input);
    if (current)
      await this.work.withActorTransaction(input.actorUserId, (database) =>
        this.assertEvidenceOwned(
          current.content.evidence,
          input.tenantId,
          input.actorUserId,
          input.workItemId,
          database,
        ),
      );
    return current;
  }

  async prepareReview(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    actorUserId: string;
    asOf: string;
    evidence: AssessmentEvidence[];
    reviewSelection?: {
      reviewConversationId: string;
      beforeTurnNo: number;
      includedDiscussionTurnIds: string[];
    };
  }): Promise<JobAidProblemTaskInput> {
    return this.buildInput(
      input.workItem,
      input.tenantId,
      input.actorUserId,
      'review-owner-context',
      'PROBLEM_REVIEW',
      input.asOf,
      input.evidence,
      input.reviewSelection,
    );
  }

  async assertReviewSources(
    input: JobAidProblemTaskInput,
    tenantId: string,
    workItemId: string,
  ): Promise<void> {
    await this.assertSourcesAuthorized(
      input.sourceCatalog,
      input,
      tenantId,
      workItemId,
    );
  }

  prepareReviewWork(
    task: JobAidProblemTaskInput,
    workItemId: string,
    proposal: unknown,
    actualReadRefs: Set<string>,
  ) {
    return materializeJobAidWork(proposal, {
      workItemId,
      previous: task.previousWork?.content ?? null,
      evidence: task.sourceCatalog,
      readSourceRefs: [
        ...new Set([...task.initiallyDeliveredRefs, ...actualReadRefs]),
      ],
      capabilities: task.modelInput.capabilities,
      history: task.modelInput.historyReview,
    });
  }

  saveReviewWork(
    input: {
      row: ActionAttemptRow;
      task: JobAidProblemTaskInput;
      fence: JobAidWorkFence;
      requestId: string;
      proposal: unknown;
      actualReadRefs: Set<string>;
    },
    database: PostgresJsDatabase,
  ) {
    return this.work.save(
      {
        row: input.row,
        actorUserId: input.task.actorUserId,
        fence: { ...input.fence, allowCommittingReview: true },
        sourceBindings: input.task.sourceBindings,
        requestId: input.requestId,
        expectedWorkRevision: input.task.modelInput.expectedWorkRevision,
        command: {
          expectedWorkRevision: input.task.modelInput.expectedWorkRevision,
          work: input.proposal,
        },
        content: this.prepareReviewWork(
          input.task,
          input.row.workItemId,
          input.proposal,
          input.actualReadRefs,
        ),
      },
      database,
    );
  }

  async readSources(input: {
    attemptRef: string;
    leaseToken: string;
    leaseGeneration: number;
    sourceRefs: string[];
    purpose: string;
    context: 'EXACT' | 'PAGE';
  }) {
    const { row, taskInput, scope } = await this.authorizedAttempt(
      input.attemptRef,
      'READ_ASSESSMENT_SOURCES',
    );
    if (!input.purpose.trim())
      throw new Error('JOBAID_SOURCE_PURPOSE_REQUIRED');
    const selected = expandJobAidSourceSelection(
      taskInput.sourceCatalog,
      input.sourceRefs,
      input.context,
    );
    // Recheck the complete session scope. Revoked material may already be in
    // native memory; a new lease check alone cannot make that session forget it.
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      scope.tenantId,
      scope.workItemId,
    );
    await this.work.recordSourceRead({
      row,
      actorUserId: taskInput.actorUserId,
      fence: { ...input, principalId: scope.principalId },
      sourceBindings: taskInput.sourceBindings,
      sourceRefs: selected.map((item) => item.evidenceRef),
      purpose: input.purpose,
    });
    return {
      schemaVersion: 'wiselink.jobaid-source-read.v2',
      status: 'AVAILABLE',
      sourceRefs: selected.map((item) => item.evidenceRef),
      evidence: overallModelEvidenceRegistry(selected),
      scope: input.context,
      completeRequestedScope: true,
    };
  }

  async queryKnowledge(input: {
    attemptRef: string;
    leaseToken: string;
    leaseGeneration: number;
    requestKey?: string;
    query?: string;
    queryRef?: string;
  }) {
    const { row, task, taskInput, scope } = await this.authorizedAttempt(
      input.attemptRef,
      'READ_ASSESSMENT_SOURCES',
    );
    assertJobAidWorkFence(row, { ...input, principalId: scope.principalId });
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      scope.tenantId,
      scope.workItemId,
    );
    if (
      !this.knowledge ||
      !taskInput.knowledgeBinding ||
      !task.allowedConnectors.includes('feishu-aily-user')
    )
      return {
        queryRef: null,
        status: 'UNAVAILABLE',
        error: taskInput.modelInput.knowledgeAccess?.reason ?? 'NOT_CONNECTED',
        evidence: [],
        candidateOnly: true,
        originalDocumentsVerified: false,
      };
    await this.work.recordSourceRead({
      row,
      actorUserId: taskInput.actorUserId,
      fence: { ...input, principalId: scope.principalId },
      sourceBindings: taskInput.sourceBindings,
      sourceRefs: [],
      purpose: '按需知识检索授权检查',
    });
    let receipt;
    try {
      receipt = await this.knowledge.query(
        {
          tenantId: scope.tenantId,
          actorId: taskInput.actorUserId,
          workItemId: scope.workItemId,
        },
        taskInput.knowledgeBinding,
        row.attemptId,
        input,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'AILY_USER_REAUTHORIZATION_REQUIRED'
      )
        return {
          queryRef: input.queryRef ?? null,
          status: 'UNAVAILABLE',
          error: error.message,
          evidence: [],
          candidateOnly: true,
          originalDocumentsVerified: false,
        };
      throw error;
    }
    if (receipt.evidence.length)
      await this.work.recordSourceRead({
        row,
        actorUserId: taskInput.actorUserId,
        fence: { ...input, principalId: scope.principalId },
        sourceBindings: taskInput.sourceBindings,
        sourceRefs: receipt.evidence.map((item) => item.evidenceRef),
        purpose: '读取实际知识检索回执',
      });
    return {
      ...receipt,
      evidence: overallModelEvidenceRegistry(receipt.evidence),
    };
  }

  async saveWork(input: {
    attemptRef: string;
    leaseToken: string;
    leaseGeneration: number;
    requestId: string;
    expectedWorkRevision: number;
    workJson: string;
  }) {
    const { row, taskInput, scope } = await this.authorizedAttempt(
      input.attemptRef,
      'SAVE_ASSESSMENT_WORK',
    );
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      scope.tenantId,
      scope.workItemId,
    );
    const history = await this.work.listForRuntime({
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
      actorUserId: taskInput.actorUserId,
    });
    const command: unknown = JSON.parse(input.workJson);
    const replay = history.find((item) => item.requestId === input.requestId);
    const previous = replay
      ? (history.find(
          (item) => item.workRevisionRef === replay.previousWorkRevisionRef,
        ) ?? null)
      : (history[0] ?? taskInput.previousWork);
    const readRefs = [
      ...new Set([
        ...taskInput.initiallyDeliveredRefs,
        ...resolvedAssessmentSources(row.reviewActivityJson),
        ...(previous?.content.readSourceRefs ?? []),
      ]),
    ];
    const content = materializeJobAidWork(command, {
      workItemId: scope.workItemId,
      previous: previous?.content ?? null,
      evidence: [
        ...taskInput.sourceCatalog,
        ...((await this.knowledge?.saved(
          {
            tenantId: scope.tenantId,
            actorId: taskInput.actorUserId,
            workItemId: scope.workItemId,
          },
          row.attemptId,
        )) ?? []),
      ],
      readSourceRefs: readRefs,
      capabilities: taskInput.modelInput.capabilities,
      history: taskInput.modelInput.historyReview,
    });
    const saved = await this.work.save({
      row,
      actorUserId: taskInput.actorUserId,
      fence: { ...input, principalId: scope.principalId },
      sourceBindings: taskInput.sourceBindings,
      requestId: input.requestId,
      expectedWorkRevision: input.expectedWorkRevision,
      command: {
        expectedWorkRevision: input.expectedWorkRevision,
        work: command,
      },
      content,
    });
    return {
      schemaVersion: 'wiselink.jobaid-work-saved.v2',
      workRevisionRef: saved.revision.workRevisionRef,
      workRevision: saved.revision.workRevision,
      replayed: saved.replayed,
      roundCompletion: saved.revision.content.roundCompletion,
      issueKeys: saved.revision.content.issues.map((issue) => issue.issueKey),
      currentUnderstanding: saved.revision.content.understanding,
    };
  }

  async readAttemptWork(attemptRef: string, requestId?: string) {
    const { row, taskInput, scope } = await this.authorizedAttempt(
      attemptRef,
      'READ_ASSESSMENT_WORK',
    );
    const history = await this.work.listForRuntime({
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
      actorUserId: taskInput.actorUserId,
    });
    const revision = requestId
      ? (history.find(
          (item) =>
            item.requestId === requestId &&
            item.actionAttemptId === row.attemptId,
        ) ?? null)
      : (history[0] ?? null);
    if (revision)
      await this.assertSourcesAuthorized(
        revision.content.evidence,
        taskInput,
        scope.tenantId,
        scope.workItemId,
      );
    return {
      schemaVersion: 'wiselink.jobaid-work-read.v2',
      revision,
      executionStatus: row.status,
    };
  }

  async commit(input: {
    row: ActionAttemptRow;
    scope: CanonicalVerifiedOpenClawAttemptScope;
    leaseToken: string;
    leaseGeneration: number;
    result: unknown;
  }): Promise<
    | {
        workItemId: string;
        workItemRevision: number;
        status: CanonicalIntegratedAssessmentProjection['status'];
        baseRules?: CanonicalBaseRuleCandidateProjection;
        overallSynthesis?: CanonicalOpenClawOverallProjection;
      }
    | ActionAttemptTerminalProjection
  > {
    const preflight = preflightCanonicalHostOpenClawResult({
      row: input.row,
      result: input.result,
    });
    const taskInput = parseJobAidProblemTask(preflight.task);
    if (
      preflight.result.toolVersions['jobaid-problem-protocol'] !== '2' ||
      preflight.result.promptVersion !== 'wiselink-jobaid-problem@v2'
    )
      throw new Error('JOBAID_RUNTIME_CAPABILITY_REQUIRED');
    await this.assertSourcesAuthorized(
      taskInput.sourceCatalog,
      taskInput,
      input.scope.tenantId,
      input.scope.workItemId,
    );
    const prepared = await this.attempts.prepareCommit({
      attemptRef: input.scope.attemptRef,
      tenantId: input.scope.tenantId,
      workItemId: input.scope.workItemId,
      principalId: input.scope.principalId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      result: preflight.result,
    });
    if (
      prepared.row.status !== 'COMMITTING' &&
      prepared.row.status !== 'SUCCEEDED'
    )
      return this.attempts.projectTerminal(prepared.row);
    const current = await this.registrar.getTenantScopedByWorkItemId({
      tenantId: input.scope.tenantId,
      workItemId: input.scope.workItemId,
    });
    const isOverall = prepared.task.taskType === 'OPENCLAW_OVERALL_SYNTHESIS';
    const committed = isOverall
      ? current.integratedAssessment?.overallSynthesis
      : (activeConfigurationEvidenceReevaluation(current)?.stagedBundle
          .baseRules ?? current.integratedAssessment?.baseRules);
    if (committed?.actionAttemptId === prepared.row.attemptId) {
      await this.attempts.finishProjectionSuccess(prepared);
      return {
        workItemId: current.workItemId,
        workItemRevision: current.revision,
        status:
          current.integratedAssessment?.status ?? 'BASE_RULE_CANDIDATE_READY',
        ...(isOverall
          ? {
              overallSynthesis: committed as CanonicalOpenClawOverallProjection,
            }
          : { baseRules: committed as CanonicalBaseRuleCandidateProjection }),
      };
    }
    if (prepared.row.status === 'SUCCEEDED')
      throw new Error('JOBAID_SUCCESS_PROJECTION_MISSING');
    if (current.revision !== prepared.task.baseRevision)
      return this.attempts.finishProjectionConflict({
        prepared,
        currentRevision: current.revision,
      });
    try {
      const output = parseFinishOutput(prepared.result.modelOutput);
      const history = await this.work.listForRuntime({
        tenantId: input.scope.tenantId,
        workItemId: current.workItemId,
        actorUserId: taskInput.actorUserId,
      });
      const revision = history.find(
        (item) => item.workRevisionRef === output.workRevisionRef,
      );
      const allowedPriorForOverall =
        isOverall &&
        revision?.workRevisionRef === taskInput.previousWork?.workRevisionRef;
      if (
        !revision ||
        revision.workRevisionRef !== history[0]?.workRevisionRef ||
        revision.documentVersionId !== current.source.documentVersionId ||
        (revision.actionAttemptId !== prepared.row.attemptId &&
          !allowedPriorForOverall) ||
        revision.content.roundCompletion === 'IN_PROGRESS'
      )
        throw new Error('JOBAID_COMPLETED_WORK_REQUIRED');
      if (isOverall)
        return await this.commitOverall(prepared, current, revision, output);
      const bytes = new TextEncoder().encode(canonicalJson(revision));
      const persisted = await this.artifactStore.persistAndReadback(bytes);
      const baseRules = this.baseProjection(
        current,
        prepared.row,
        revision,
        persisted.artifact,
      );
      const oldOverall = current.integratedAssessment?.overallSynthesis;
      const integrated: CanonicalIntegratedAssessmentProjection = {
        status: oldOverall
          ? 'OVERALL_CANDIDATE_STALE'
          : 'BASE_RULE_CANDIDATE_READY',
        baseRules,
        engineerReviews: current.integratedAssessment?.engineerReviews ?? null,
        overallSynthesis: oldOverall
          ? {
              ...oldOverall,
              status: 'STALE',
              staleReason: 'BASE_RULE_RESULT_CHANGED',
            }
          : null,
        overallForAeoConfirmation: null,
      };
      const marker = activeConfigurationEvidenceReevaluation(current);
      const next = marker
        ? withStagedBaseRules(current, baseRules, attemptBinding(prepared.row))
        : { ...current, integratedAssessment: integrated, aeo: null };
      const saved = await this.registrar.compareAndSet({
        workItemId: current.workItemId,
        expectedRevision: prepared.task.baseRevision,
        syncPrimaryAttempt: false,
        next: withoutRevision(next),
      });
      await this.attempts.finishProjectionSuccess(prepared);
      return {
        workItemId: saved.workItemId,
        workItemRevision: saved.revision,
        status: integrated.status,
        baseRules,
      };
    } catch (error) {
      // An already-applied projection is recovered by the same commit identity;
      // it never triggers another model call or a replacement ResultEnvelope.
      const fresh = await this.registrar.getTenantScopedByWorkItemId({
        tenantId: input.scope.tenantId,
        workItemId: current.workItemId,
      });
      const applied = isOverall
        ? fresh.integratedAssessment?.overallSynthesis
        : (activeConfigurationEvidenceReevaluation(fresh)?.stagedBundle
            .baseRules ?? fresh.integratedAssessment?.baseRules);
      if (applied?.actionAttemptId === prepared.row.attemptId) {
        await this.attempts.finishProjectionSuccess(prepared);
        return {
          workItemId: fresh.workItemId,
          workItemRevision: fresh.revision,
          status:
            fresh.integratedAssessment?.status ?? 'BASE_RULE_CANDIDATE_READY',
          ...(isOverall
            ? {
                overallSynthesis: applied as CanonicalOpenClawOverallProjection,
              }
            : { baseRules: applied as CanonicalBaseRuleCandidateProjection }),
        };
      }
      if (error instanceof Error && error.message.startsWith('JOBAID_'))
        return this.attempts.finishResultGateFailure(prepared, error);
      throw error;
    }
  }

  private async commitOverall(
    prepared: PreparedActionAttemptCommit,
    workItem: CanonicalWorkItemProjection,
    revision: JobAidWorkRevision,
    output: ReturnType<typeof parseFinishOutput>,
  ) {
    if (!output.consistencyCheck || !output.consistencyCheck.trim())
      throw new Error('JOBAID_OVERALL_CONSISTENCY_REQUIRED');
    const marker = activeConfigurationEvidenceReevaluation(workItem);
    const effective = marker ? configurationEvidenceShadow(workItem) : workItem;
    const base = effective.integratedAssessment!.baseRules;
    if (!isJobAidProblemProjection(base))
      throw new Error('JOBAID_OVERALL_BASE_VERSION_INVALID');
    const reading = jobAidReadingResult(revision);
    const artifact = await this.artifactStore.persistAndReadback(
      new TextEncoder().encode(
        canonicalJson({
          schemaVersion: 'wiselink.jobaid-problem-overall.v2',
          analysis: revision,
          consistencyCheck: output.consistencyCheck,
          readingResult: reading,
          authorityLevel: 'candidate_only',
          adopted: false,
        }),
      ),
    );
    const synthesis: CanonicalOpenClawOverallProjection = {
      status: 'CANDIDATE_ONLY',
      revision:
        (workItem.integratedAssessment?.overallSynthesis?.revision ?? 0) + 1,
      sourceResultId: `openclaw-overall://${prepared.row.triggerRequestId}`,
      basedOnBaseRuleRevision: base.revision,
      basedOnBaseRuleArtifactSha256: base.artifact.sha256,
      basedOnEngineerReviewRevision:
        workItem.integratedAssessment?.engineerReviews?.revision ?? null,
      basedOnEngineerReviewArtifactSha256:
        workItem.integratedAssessment?.engineerReviews?.artifact.sha256 ?? null,
      discoveryStatus: 'NO_DISCOVERY',
      gap:
        revision.content.issues
          .flatMap((issue) => issue.openQuestions.map((q) => q.question))
          .join('；') || null,
      candidateRefCount: 0,
      findingCount: revision.content.issues.length,
      unresolvedCount: revision.content.issues.reduce(
        (sum, issue) => sum + issue.openQuestions.length,
        0,
      ),
      authorityLevel: 'candidate_only',
      externalDiscoveryIsEvidence: false,
      artifact: artifact.artifact,
      actionAttemptId: prepared.row.attemptId,
      staleReason: null,
      overallCandidate: revision.content.understanding,
      readingResult: reading,
      basedOnJobAidWorkRevisionRef: revision.workRevisionRef,
      affectedIssueKeys: revision.content.decisiveIssueKeys,
      missingInputs: revision.content.issues.flatMap((issue) =>
        issue.openQuestions.map((item) => item.question),
      ),
      applicabilityStatus: effective.applicability?.decision ?? 'UNKNOWN',
      engineeringReviewRequired: true,
      providers: {},
      modelVersion: prepared.result.modelVersion,
      promptVersion: prepared.result.promptVersion,
      skillVersion: prepared.result.skillVersion,
      toolVersions: prepared.result.toolVersions,
    };
    let nextBase = base;
    if (revision.workRevisionRef !== base.workRevisionRef) {
      const saved = await this.artifactStore.persistAndReadback(
        new TextEncoder().encode(canonicalJson(revision)),
      );
      nextBase = {
        ...base,
        revision: base.revision + 1,
        workRevisionRef: revision.workRevisionRef,
        workRevision: revision.workRevision,
        issueCount: revision.content.issues.length,
        openQuestionCount: synthesis.unresolvedCount,
        headline: revision.content.headline,
        listBrief: revision.content.listBrief,
        readingResult: reading,
        artifact: saved.artifact,
      };
      synthesis.basedOnBaseRuleArtifactSha256 = nextBase.artifact.sha256;
      synthesis.basedOnBaseRuleRevision = nextBase.revision;
    }
    const integrated: CanonicalIntegratedAssessmentProjection = {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: nextBase,
      engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
      overallSynthesis: synthesis,
      overallForAeoConfirmation: null,
    };
    const promotionBasis = marker
      ? {
          ...workItem,
          configurationEvidenceReevaluation: {
            ...marker,
            stagedBundle: { ...marker.stagedBundle, baseRules: nextBase },
          },
        }
      : workItem;
    const next = marker
      ? promoteConfigurationEvidenceReevaluation(
          promotionBasis,
          synthesis,
          attemptBinding(prepared.row),
        )
      : { ...workItem, integratedAssessment: integrated, aeo: null };
    const saved = await this.registrar.compareAndSet({
      workItemId: workItem.workItemId,
      expectedRevision: prepared.task.baseRevision,
      syncPrimaryAttempt: false,
      next: withoutRevision(next),
    });
    await this.attempts.finishProjectionSuccess(prepared);
    return {
      workItemId: saved.workItemId,
      workItemRevision: saved.revision,
      status: integrated.status,
      overallSynthesis: synthesis,
    };
  }

  async readBrowser(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<JobAidWorkingReadModel> {
    const { workItem } = await authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action: 'READ_DOCUMENT_PARSING',
      workItemId,
    });
    const current = await this.work.latest({
      tenantId: actor.tenantId,
      workItemId,
    });
    if (current)
      await this.assertEvidenceOwned(
        current.content.evidence,
        actor.tenantId,
        actor.userId,
        workItemId,
      );
    const executionStatus = current
      ? await this.work.readExecutionStatus({
          actionAttemptId: current.actionAttemptId,
          tenantId: actor.tenantId,
          workItemId,
        })
      : null;
    const overall = workItem.integratedAssessment?.overallSynthesis;
    const base = workItem.integratedAssessment?.baseRules;
    return {
      schemaVersion: 'wiselink.jobaid-working-read.v2',
      workItemId,
      current,
      enabled:
        !!current ||
        isJobAidProblemProjection(base) ||
        (!base && this.enabledForNewTasks()),
      executionStatus,
      currentInputChanged:
        !!current &&
        current.basedOnWorkItemRevision !== workItem.revision &&
        (!isJobAidProblemProjection(base) ||
          base.workRevisionRef !== current.workRevisionRef),
      overallStatus: !overall
        ? 'NOT_AVAILABLE'
        : overall.status === 'CANDIDATE_ONLY' &&
            overall.basedOnJobAidWorkRevisionRef === current?.workRevisionRef
          ? 'CURRENT'
          : 'STALE',
      overallBasedOnWorkRevisionRef:
        overall?.basedOnJobAidWorkRevisionRef ?? null,
    };
  }

  private baseProjection(
    workItem: CanonicalWorkItemProjection,
    row: ActionAttemptRow,
    revision: JobAidWorkRevision,
    artifact: CanonicalBaseRuleCandidateProjection['artifact'],
  ): CanonicalJobAidProblemCandidateProjection {
    if (revision.content.roundCompletion === 'IN_PROGRESS')
      throw new Error('JOBAID_COMPLETED_WORK_REQUIRED');
    return {
      schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
      status: 'CANDIDATE_ONLY',
      revision: (workItem.integratedAssessment?.baseRules.revision ?? 0) + 1,
      sourceResultId: `openclaw-dynamic://${row.triggerRequestId}`,
      workRevisionRef: revision.workRevisionRef,
      workRevision: revision.workRevision,
      issueCount: revision.content.issues.length,
      openQuestionCount: revision.content.issues.reduce(
        (sum, issue) => sum + issue.openQuestions.length,
        0,
      ),
      roundCompletion: revision.content.roundCompletion,
      methodBinding: structuredClone(revision.content.methodBinding),
      headline: revision.content.headline,
      listBrief: revision.content.listBrief,
      artifact,
      actionAttemptId: row.attemptId,
      readingResult: jobAidReadingResult(revision),
    };
  }

  private async sourceBindings(
    evidence: AssessmentEvidence[],
    primary: CanonicalWorkItemProjection,
    tenantId: string,
    actorUserId: string,
  ): Promise<JobAidSourceBinding[]> {
    const ids = new Set([
      primary.workItemId,
      ...evidence.flatMap((item) =>
        item.kind === 'DOCUMENT_PASSAGE' ? [item.workItemId] : [],
      ),
    ]);
    return this.work.withActorTransaction(actorUserId, async (database) => {
      await this.assertEvidenceOwned(
        evidence,
        tenantId,
        actorUserId,
        primary.workItemId,
        database,
      );
      const bindings: JobAidSourceBinding[] = [];
      for (const workItemId of ids) {
        const binding = await this.work.loadOwnedSourceBinding(
          { workItemId, tenantId, actorUserId },
          database,
        );
        if (!binding) throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
        bindings.push(binding);
      }
      return bindings;
    });
  }

  private async assertSourcesAuthorized(
    evidence: AssessmentEvidence[],
    input: JobAidProblemTaskInput,
    tenantId: string,
    workItemId: string,
  ): Promise<void> {
    await this.work.withActorTransaction(
      input.actorUserId,
      async (database) => {
        await this.assertEvidenceOwned(
          evidence,
          tenantId,
          input.actorUserId,
          workItemId,
          database,
        );
        for (const binding of input.sourceBindings) {
          const current = await this.work.loadOwnedSourceBinding(
            {
              workItemId: binding.workItemId,
              tenantId,
              actorUserId: input.actorUserId,
            },
            database,
          );
          if (
            !current ||
            current.documentVersionId !== binding.documentVersionId ||
            current.artifactSha256 !== binding.artifactSha256
          )
            throw new Error('JOBAID_SOURCE_VERSION_CHANGED');
        }
      },
    );
  }

  private async assertEvidenceOwned(
    evidence: AssessmentEvidence[],
    tenantId: string,
    actorUserId: string,
    primaryWorkItemId: string,
    database?: PostgresJsDatabase,
  ): Promise<void> {
    if (
      !(await this.conversations.hasActiveOfficialActorMapping(
        { tenantId, actorId: actorUserId },
        database,
      ))
    )
      throw new Error('JOBAID_ACTOR_AUTHORIZATION_CHANGED');
    const queried = evidence.filter(
      (item) =>
        item.kind === 'QUERY_RECEIPT' &&
        item.queryProvenance?.origin === 'AILY_RETRIEVAL',
    );
    if (queried.length) {
      const saved =
        (await this.knowledge?.saved(
          { tenantId, actorId: actorUserId, workItemId: primaryWorkItemId },
          undefined,
          database,
        )) ?? [];
      for (const item of queried)
        if (
          !saved.some(
            (receipt) =>
              receipt.evidenceRef === item.evidenceRef &&
              canonicalJson(receipt) === canonicalJson(item),
          )
        )
          throw new Error('JOBAID_QUERY_RECEIPT_AUTHORIZATION_CHANGED');
    }
    const bindings = new Map<string, string | null>([
      [primaryWorkItemId, null],
    ]);
    for (const item of evidence)
      for (const id of item.dialogueSource?.contextWorkItemIds ?? [])
        bindings.set(id, bindings.get(id) ?? null);
    for (const item of evidence)
      if (item.kind === 'DOCUMENT_PASSAGE')
        bindings.set(item.workItemId, item.documentVersionId);
    for (const item of evidence)
      if (item.kind === 'ENGINEER_ATTACHMENT') {
        const binding = await this.conversations.loadOpenClawTurnByIdBinding(
          {
            reviewConversationId: item.reviewConversationId,
            reviewTurnId: item.reviewTurnId,
            tenantId,
            actorId: actorUserId,
            workItemId: item.workItemId,
          },
          database,
        );
        const attachment = binding?.turn.attachmentBindings?.find(
          (entry) => entry.attachmentRef === item.attachmentRef,
        );
        if (
          !attachment ||
          attachment.documentVersionId !== item.documentVersionId ||
          attachment.parsedArtifact.ref !== item.artifactRef ||
          attachment.parsedArtifact.sha256 !== item.artifactSha256
        )
          throw new Error('JOBAID_ATTACHMENT_AUTHORIZATION_CHANGED');
      }
    for (const [workItemId, documentVersionId] of bindings) {
      const owned = database
        ? await this.work.loadOwnedSourceBinding(
            { workItemId, tenantId, actorUserId },
            database,
          )
        : await this.workItems.loadAuthorizationBinding({
            workItemId,
            tenantId,
            actorUserId,
          });
      if (
        !owned ||
        (documentVersionId && owned.documentVersionId !== documentVersionId)
      )
        throw new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    }
  }

  private async authorizedAttempt(
    attemptRef: string,
    operation:
      | 'READ_ASSESSMENT_SOURCES'
      | 'SAVE_ASSESSMENT_WORK'
      | 'READ_ASSESSMENT_WORK',
  ) {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      attemptRef,
      operation,
    });
    const row = await this.attempts.readScoped({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    if (
      row.operationRef !== attemptRef ||
      !row.taskEnvelopeJson ||
      !['OPENCLAW_DYNAMIC_EVALUATION', 'OPENCLAW_OVERALL_SYNTHESIS'].includes(
        row.actionType,
      )
    )
      throw new Error('JOBAID_ATTEMPT_NOT_FOUND');
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    const taskInput = parseJobAidProblemTask(task);
    if (
      scope.appId !== 'app_17bzc551rsg' ||
      row.tenantId !== scope.tenantId ||
      row.workItemId !== scope.workItemId
    )
      throw new Error('JOBAID_ATTEMPT_NOT_FOUND');
    return { row, task, taskInput, scope };
  }
}

function parseFinishOutput(value: string | null): {
  workRevisionRef: string;
  consistencyCheck: string | null;
} {
  if (!value) throw new Error('JOBAID_FINAL_OUTPUT_MISSING');
  const output: unknown = JSON.parse(value);
  if (
    !output ||
    typeof output !== 'object' ||
    !('workRevisionRef' in output) ||
    typeof output.workRevisionRef !== 'string' ||
    !output.workRevisionRef
  )
    throw new Error('JOBAID_FINAL_OUTPUT_INVALID');
  return {
    workRevisionRef: output.workRevisionRef,
    consistencyCheck:
      'consistencyCheck' in output &&
      typeof output.consistencyCheck === 'string'
        ? output.consistencyCheck
        : null,
  };
}
function withoutRevision(
  value: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = value;
  return rest;
}
function attemptBinding(row: ActionAttemptRow) {
  return {
    attemptId: row.attemptId,
    attemptRef: row.operationRef!,
    inputRevision: row.inputRevision!,
    baseRevision: row.baseRevision!,
  };
}
function problemIdempotencyKey(
  workItem: CanonicalWorkItemProjection,
  purpose: JobAidProblemModelInput['purpose'],
  requestId?: string,
): string {
  if (requestId !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(requestId))
      throw new Error('JOBAID_REQUEST_ID_INVALID');
    if (
      purpose !== 'INITIAL_PROBLEM_ASSESSMENT' &&
      purpose !== 'OVERALL_CONSISTENCY'
    )
      throw new Error('JOBAID_CONTINUATION_PURPOSE_INVALID');
    return `openclaw-v2:${purpose === 'INITIAL_PROBLEM_ASSESSMENT' ? 'dynamic' : 'overall'}:${workItem.workItemId}:${workItem.source.documentVersionId}:${requestId}`;
  }
  return `openclaw-v1:${purpose === 'INITIAL_PROBLEM_ASSESSMENT' ? 'dynamic' : 'overall'}:${workItem.workItemId}:${workItem.revision}:problem-v2`;
}

function continuationReceipt(
  row: ActionAttemptRow,
  purpose: JobAidProblemModelInput['purpose'],
) {
  const task = parseTaskEnvelope(row.taskEnvelopeJson!);
  const request = readInitialAnalysisRequestInput(task);
  const expectedTaskType =
    purpose === 'INITIAL_PROBLEM_ASSESSMENT'
      ? 'OPENCLAW_DYNAMIC_EVALUATION'
      : 'OPENCLAW_OVERALL_SYNTHESIS';
  if (
    request
      ? request.taskType !== expectedTaskType
      : parseJobAidProblemTask(task).modelInput.purpose !== purpose
  )
    throw new Error('JOBAID_CONTINUATION_PURPOSE_MISMATCH');
  return {
    attemptRef: task.operationRef,
    status: row.status,
    created: false,
    workItemRevision: task.baseRevision,
  };
}
