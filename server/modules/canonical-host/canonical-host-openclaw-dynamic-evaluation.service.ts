import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { DynamicRulesEvaluationProcessor } from '../assessment-workbench/assessment-host-consumer.public-api';
import { serializeNormalizedBaseOneShotOutput } from '../assessment-workbench/base-one-shot-assessment.processor';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import {
  MiaodaWorkItemRepository,
  type DynamicEvaluationActionAttempt,
} from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import type {
  CanonicalAuthorizationPort,
  CanonicalHostActor,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';
const CANONICAL_APP_ID = 'app_17bzc551rsg';

export interface BeginDynamicEvaluationResult {
  attemptRef: string;
  modelInput: Record<string, unknown>;
}

export interface CommitDynamicEvaluationResult {
  workItemId: string;
  workItemRevision: number;
  status: CanonicalIntegratedAssessmentProjection['status'];
  baseRules: CanonicalBaseRuleCandidateProjection;
}

@Injectable()
export class CanonicalHostOpenClawDynamicEvaluationService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly assessment: CanonicalHostAssessmentService,
    private readonly processor: DynamicRulesEvaluationProcessor,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
  ) {}

  async begin(workItemId: string): Promise<BeginDynamicEvaluationResult> {
    const workItem = await this.requiredSbWorkItem(workItemId);
    const row = await this.repository.getRow(workItem.workItemId);
    const actor = serviceActor(row.tenantId);
    const permissionSnapshotVersion = await this.authorize(workItem, actor);
    const attempt = await this.repository.reserveDynamicEvaluationAction({
      workItemId: workItem.workItemId,
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: workItem.revision,
    });
    if (attempt.status !== 'RUNNING') {
      throw new Error('DYNAMIC_EVALUATION_PRIOR_ATTEMPT_NOT_RUNNING');
    }
    const request = await this.buildRequest(
      workItem,
      permissionSnapshotVersion,
      attempt,
    );
    return {
      attemptRef: attempt.triggerRequestId,
      modelInput: structuredClone(
        request.modelInput,
      ) as Record<string, unknown>,
    };
  }

  async commit(
    attemptRef: string,
    output: string,
  ): Promise<CommitDynamicEvaluationResult> {
    const attempt = await this.repository.getDynamicEvaluationActionByCallerRef(
      attemptRef,
    );
    const recovered = await this.recoverExistingCommit(attempt);
    if (recovered) return recovered;
    if (attempt.status !== 'RUNNING') {
      throw new Error('DYNAMIC_EVALUATION_ATTEMPT_NOT_RUNNING');
    }
    const workItem = await this.requiredSbWorkItem(attempt.workItemId);
    if (workItem.revision !== attempt.attemptNo) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const actor = serviceActor(attempt.tenantId);
    if (attempt.actorUserId !== actor.userId) {
      throw new Error('DYNAMIC_EVALUATION_SERVICE_ACTOR_MISMATCH');
    }
    const permissionSnapshotVersion = await this.authorize(workItem, actor);
    let commitClaimed = false;
    try {
      const request = await this.buildRequest(
        workItem,
        permissionSnapshotVersion,
        attempt,
      );
      const result = this.processor.consumeOutput(request, output);
      const normalizedArtifactBytes = serializeNormalizedBaseOneShotOutput(
        output,
        result,
      );
      const currentBase = workItem.integratedAssessment?.baseRules;
      if (workItem.integratedAssessment?.engineerReviews && currentBase) {
        const prospectiveBase = baseRuleProjection(
          workItem,
          attempt,
          request.modelInput.expectedSelfCheck,
          result,
          currentBase.artifact,
        );
        await this.engineerReviews.assertLedgerCompatibleWithDynamicBytes(
          workItem,
          prospectiveBase,
          normalizedArtifactBytes,
        );
      }
      try {
        await this.repository.claimDynamicEvaluationCommit(attempt.attemptId);
        commitClaimed = true;
      } catch (error) {
        if (errorCode(error) === 'DYNAMIC_EVALUATION_COMMIT_ALREADY_CLAIMED') {
          throw error;
        }
        throw error;
      }
      const persisted = await this.artifactStore.persistAndReadback(
        normalizedArtifactBytes,
      );
      const baseRules = baseRuleProjection(
        workItem,
        attempt,
        request.modelInput.expectedSelfCheck,
        result,
        persisted.artifact,
      );
      const previousOverall = workItem.integratedAssessment?.overallSynthesis;
      const overallSynthesis: CanonicalOpenClawOverallProjection | null =
        previousOverall
          ? {
              ...previousOverall,
              status: 'STALE',
              staleReason: 'BASE_RULE_RESULT_CHANGED',
            }
          : null;
      const integratedAssessment: CanonicalIntegratedAssessmentProjection = {
        status: overallSynthesis
          ? 'OVERALL_CANDIDATE_STALE'
          : 'BASE_RULE_CANDIDATE_READY',
        baseRules,
        engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
        overallSynthesis,
        overallForAeoConfirmation: null,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment,
          // A candidate AEO is bound to the exact dynamic/overall artifact pair.
          // A new dynamic evaluation makes any previous authoring projection stale.
          aeo: null,
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return {
        workItemId: updated.workItemId,
        workItemRevision: updated.revision,
        status: integratedAssessment.status,
        baseRules,
      };
    } catch (error) {
      if (commitClaimed) {
        const recovered = await this.recoverClaimedFailure(attempt, error);
        if (recovered) return recovered;
      }
      throw error;
    }
  }

  private async recoverExistingCommit(
    attempt: DynamicEvaluationActionAttempt,
  ): Promise<CommitDynamicEvaluationResult | null> {
    if (attempt.status === 'RUNNING') return null;
    const workItem = await this.requiredSbWorkItem(attempt.workItemId);
    const committed = committedDynamicResult(workItem, attempt);
    if (committed && attempt.status === 'COMMITTING') {
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return committed;
    }
    if (committed && attempt.status === 'SUCCEEDED') return committed;
    if (attempt.status === 'COMMITTING') {
      throw new Error('DYNAMIC_EVALUATION_COMMIT_IN_PROGRESS');
    }
    throw new Error('DYNAMIC_EVALUATION_ATTEMPT_NOT_RUNNING');
  }

  private async recoverClaimedFailure(
    attempt: DynamicEvaluationActionAttempt,
    error: unknown,
  ): Promise<CommitDynamicEvaluationResult | null> {
    const workItem = await this.requiredSbWorkItem(attempt.workItemId);
    const committed = committedDynamicResult(workItem, attempt);
    if (committed) {
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return committed;
    }
    if (workItem.revision === attempt.attemptNo) {
      await this.repository.releaseOpenClawCommitForRetry({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      });
      return null;
    }
    await this.repository.failAssessmentAction({
      attemptId: attempt.attemptId,
      errorCode: errorCode(error),
      errorMessage: errorMessage(error),
    });
    return null;
  }

  private async buildRequest(
    workItem: CanonicalWorkItemProjection,
    permissionSnapshotVersion: string,
    attempt: DynamicEvaluationActionAttempt,
  ) {
    const timestamp = attempt.createdAt.toISOString();
    const candidate = await this.assessment.prepareDynamicRulesCandidate({
      workItem,
      permissionSnapshotVersion,
      assessmentAsOf: timestamp,
      generatedAt: timestamp,
      externalDiscovery: null,
      reviewedExternalManifest: null,
    });
    return this.processor.buildRequest(
      candidate.dynamicRulesInput,
      candidate.overall.transport,
      {
        transportId: `OPENCLAW-DYNAMIC:${attempt.attemptId}`,
        workItemId: workItem.workItemId,
        actionAttemptId: attempt.attemptId,
        expectedRevision: attempt.attemptNo,
        documentVersionId: workItem.source.documentVersionId,
      },
      attempt.triggerRequestId,
    );
  }

  private async requiredSbWorkItem(
    workItemId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getByWorkItemId(workItemId);
    if (
      workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      workItem.package === null
    ) {
      throw new Error('DYNAMIC_EVALUATION_PARSED_PACKAGE_NOT_READY');
    }
    if (
      workItem.classification.status !== 'CONFIRMED' ||
      workItem.classification.normalizedFamily !== 'SB'
    ) {
      throw new Error('DYNAMIC_EVALUATION_REQUIRES_CONFIRMED_SB');
    }
    return workItem;
  }

  private async authorize(
    workItem: CanonicalWorkItemProjection,
    actor: CanonicalHostActor,
  ): Promise<string> {
    const decision = await this.authorization.authorize({
      actor,
      action: 'PERSIST_OPENCLAW_DYNAMIC_EVALUATION',
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (
      !decision.allowed ||
      decision.action !== 'PERSIST_OPENCLAW_DYNAMIC_EVALUATION'
    ) {
      throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
    }
    const snapshot = await this.permissionSnapshots.freshRead({
      actor,
      decision,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (
      snapshot.permissionSnapshotVersion !== decision.permissionSnapshotVersion
    ) {
      throw new Error('DYNAMIC_EVALUATION_PERMISSION_SNAPSHOT_CHANGED');
    }
    return snapshot.permissionSnapshotVersion;
  }
}

function serviceActor(tenantId: string): CanonicalHostActor {
  if (typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('DYNAMIC_EVALUATION_TENANT_REQUIRED');
  }
  return {
    userId: OPENCLAW_SERVICE_USER_ID,
    tenantId,
    appId: CANONICAL_APP_ID,
    roles: [],
    env: 'hosted',
  };
}

function committedDynamicResult(
  workItem: CanonicalWorkItemProjection,
  attempt: DynamicEvaluationActionAttempt,
): CommitDynamicEvaluationResult | null {
  const integrated = workItem.integratedAssessment;
  const baseRules = integrated?.baseRules;
  if (!integrated || baseRules?.actionAttemptId !== attempt.attemptId) {
    return null;
  }
  return {
    workItemId: workItem.workItemId,
    workItemRevision: workItem.revision,
    status: integrated.status,
    baseRules,
  };
}

function baseRuleProjection(
  workItem: CanonicalWorkItemProjection,
  attempt: DynamicEvaluationActionAttempt,
  expectedSelfCheck: Record<string, unknown>,
  result: {
    ruleResults: Array<Record<string, unknown>>;
    overallSelfCheck: Record<string, unknown>;
    criterionCount: number;
  },
  artifact: CanonicalBaseRuleCandidateProjection['artifact'],
): CanonicalBaseRuleCandidateProjection {
  const criterionSetId = requiredText(
    expectedSelfCheck.criterionSetId,
    'DYNAMIC_EVALUATION_CRITERION_SET_ID_REQUIRED',
  );
  const unresolvedCount = requiredCount(
    result.overallSelfCheck.rulesWithMissingInputs,
    result.criterionCount,
    'DYNAMIC_EVALUATION_UNRESOLVED_COUNT_INVALID',
  );
  const sourceBoundCandidateCount = result.ruleResults.filter(
    (rule) => Array.isArray(rule.sourceRefs) && rule.sourceRefs.length > 0,
  ).length;
  return {
    status: 'CANDIDATE_ONLY',
    revision: (workItem.integratedAssessment?.baseRules.revision ?? 0) + 1,
    sourceResultId: `openclaw-dynamic://${attempt.triggerRequestId}`,
    criterionSetId,
    criterionCount: result.criterionCount,
    evaluationItemCount: result.ruleResults.length,
    unresolvedCount,
    sourceBoundCandidateCount,
    artifact,
    actionAttemptId: attempt.attemptId,
  };
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value;
}

function requiredCount(
  value: unknown,
  maximum: number,
  code: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new Error(code);
  }
  return Number(value);
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.split(':', 1)[0]
    : 'DYNAMIC_EVALUATION_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
