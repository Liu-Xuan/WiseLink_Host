import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import {
  CANONICAL_AUTHORIZATION,
  CANONICAL_BASE_RULE_RESULT_PROVIDER,
  CANONICAL_OPENCLAW_OVERALL_PROVIDER,
  CANONICAL_PERMISSION_SNAPSHOT,
  CANONICAL_WORK_ITEM_REGISTRAR,
} from './canonical-host.constants';
import type {
  CanonicalAuthorizationDecision,
  CanonicalAuthorizationPort,
  CanonicalBaseRuleResult,
  CanonicalBaseRuleResultProviderPort,
  CanonicalHostActor,
  CanonicalOpenClawOverallProviderPort,
  CanonicalOpenClawOverallResult,
  CanonicalPermissionSnapshotPort,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';

@Injectable()
export class CanonicalHostIntegratedAssessmentService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(CANONICAL_BASE_RULE_RESULT_PROVIDER)
    private readonly baseRuleProvider: CanonicalBaseRuleResultProviderPort,
    @Inject(CANONICAL_OPENCLAW_OVERALL_PROVIDER)
    private readonly openClawProvider: CanonicalOpenClawOverallProviderPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
  ) {}

  async persistBaseRuleCandidate(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    if (!this.baseRuleProvider.configured) {
      throw unavailable('BASE_RULE_RESULT_PROVIDER_NOT_CONFIGURED');
    }
    const workItem = await this.requiredParsedWorkItem(workItemId);
    await this.authorize(workItem, actor, 'PERSIST_BASE_RULE_RESULT');
    const result = await this.baseRuleProvider.readResult({ workItem });
    validateBaseResult(result, workItem);
    if (
      workItem.integratedAssessment?.baseRules.sourceResultId ===
      result.sourceResultId
    ) {
      return workItem;
    }

    const revision =
      (workItem.integratedAssessment?.baseRules.revision ?? 0) + 1;
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'PERSIST_BASE_RULE_RESULT',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: revision,
    });
    if (!attempt.created) {
      throw new Error('BASE_RULE_RESULT_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      const persisted = await this.artifactStore.persistAndReadback(
        result.artifactBytes,
      );
      const baseRules: CanonicalBaseRuleCandidateProjection = {
        status: 'CANDIDATE_ONLY',
        revision,
        sourceResultId: result.sourceResultId,
        criterionSetId: result.criterionSetId,
        criterionCount: result.criterionCount,
        evaluationItemCount: result.evaluationItemCount,
        unresolvedCount: result.unresolvedCount,
        sourceBoundCandidateCount: result.sourceBoundCandidateCount,
        artifact: persisted.artifact,
        actionAttemptId: attempt.attemptId,
      };
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
        overallSynthesis,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment,
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return updated;
    } catch (error) {
      await this.repository.failAssessmentAction({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  }

  async persistOpenClawOverall(
    workItemId: string,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    if (!this.openClawProvider.configured) {
      throw unavailable('OPENCLAW_OVERALL_PROVIDER_NOT_CONFIGURED');
    }
    const workItem = await this.requiredParsedWorkItem(workItemId);
    const baseRules = workItem.integratedAssessment?.baseRules;
    if (!baseRules) throw new Error('BASE_RULE_CANDIDATE_REQUIRED');
    await this.authorize(workItem, actor, 'PERSIST_OPENCLAW_OVERALL');
    const result = await this.openClawProvider.synthesize({
      workItem,
      baseRules,
    });
    validateOverallResult(result, workItem, baseRules);
    if (
      workItem.integratedAssessment?.overallSynthesis?.sourceResultId ===
        result.sourceResultId &&
      workItem.integratedAssessment.overallSynthesis.status === 'CANDIDATE_ONLY'
    ) {
      return workItem;
    }

    const revision =
      (workItem.integratedAssessment?.overallSynthesis?.revision ?? 0) + 1;
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'PERSIST_OPENCLAW_OVERALL',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: revision,
    });
    if (!attempt.created) {
      throw new Error('OPENCLAW_OVERALL_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      const persisted = await this.artifactStore.persistAndReadback(
        result.artifactBytes,
      );
      const overallSynthesis: CanonicalOpenClawOverallProjection = {
        status: 'CANDIDATE_ONLY',
        revision,
        sourceResultId: result.sourceResultId,
        basedOnBaseRuleRevision: result.baseRuleRevision,
        basedOnBaseRuleArtifactSha256: result.baseRuleArtifactSha256,
        discoveryStatus: result.discoveryStatus,
        gap: result.gap,
        candidateRefCount: result.candidateRefCount,
        findingCount: result.findingCount,
        unresolvedCount: result.unresolvedCount,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: persisted.artifact,
        actionAttemptId: attempt.attemptId,
        staleReason: null,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment: {
            status: 'OVERALL_CANDIDATE_READY',
            baseRules,
            overallSynthesis,
          },
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return updated;
    } catch (error) {
      await this.repository.failAssessmentAction({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  }

  private async requiredParsedWorkItem(
    workItemId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getByWorkItemId(workItemId);
    if (
      workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      workItem.package === null
    ) {
      throw new Error('INTEGRATED_ASSESSMENT_PARSED_PACKAGE_NOT_READY');
    }
    return workItem;
  }

  private async authorize(
    workItem: CanonicalWorkItemProjection,
    actor: CanonicalHostActor,
    action: Extract<
      CanonicalAuthorizationDecision['action'],
      'PERSIST_BASE_RULE_RESULT' | 'PERSIST_OPENCLAW_OVERALL'
    >,
  ): Promise<void> {
    const decision = await this.authorization.authorize({
      actor,
      action,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (!decision.allowed || decision.action !== action) {
      throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
    }
    const snapshot = await this.permissionSnapshots.freshRead({
      actor,
      decision,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (snapshot.permissionSnapshotVersion !== decision.permissionSnapshotVersion) {
      throw new Error('INTEGRATED_ASSESSMENT_PERMISSION_SNAPSHOT_CHANGED');
    }
  }
}

function validateBaseResult(
  result: CanonicalBaseRuleResult,
  workItem: CanonicalWorkItemProjection,
): void {
  if (
    result.workItemId !== workItem.workItemId ||
    result.documentVersionId !== workItem.source.documentVersionId ||
    result.packageId !== workItem.package?.packageId ||
    result.packageArtifactSha256 !== workItem.package.artifact.sha256 ||
    !result.sourceResultId.trim() ||
    !result.criterionSetId.trim() ||
    !positiveInteger(result.criterionCount) ||
    result.evaluationItemCount !== result.criterionCount ||
    !count(result.unresolvedCount, result.criterionCount) ||
    !count(result.sourceBoundCandidateCount, result.criterionCount) ||
    result.artifactBytes.byteLength < 1
  ) {
    throw new Error('BASE_RULE_RESULT_IDENTITY_MISMATCH');
  }
}

function validateOverallResult(
  result: CanonicalOpenClawOverallResult,
  workItem: CanonicalWorkItemProjection,
  baseRules: CanonicalBaseRuleCandidateProjection,
): void {
  if (
    result.workItemId !== workItem.workItemId ||
    result.documentVersionId !== workItem.source.documentVersionId ||
    result.packageId !== workItem.package?.packageId ||
    result.baseRuleRevision !== baseRules.revision ||
    result.baseRuleArtifactSha256 !== baseRules.artifact.sha256 ||
    result.authorityLevel !== 'candidate_only' ||
    result.externalDiscoveryIsEvidence !== false ||
    !result.sourceResultId.trim() ||
    !result.discoveryStatus.trim() ||
    (result.gap !== null && !result.gap.trim()) ||
    !count(result.candidateRefCount) ||
    !count(result.findingCount) ||
    !count(result.unresolvedCount) ||
    result.artifactBytes.byteLength < 1
  ) {
    throw new Error('OPENCLAW_OVERALL_IDENTITY_MISMATCH');
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function count(value: number, maximum = Number.MAX_SAFE_INTEGER): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function unavailable(code: string): Error {
  return Object.assign(new Error(code), { code, statusCode: 503 });
}

function errorCode(value: unknown): string {
  return value instanceof Error && value.message
    ? value.message.slice(0, 160)
    : 'UNKNOWN_ERROR';
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'Unknown integrated assessment error.';
}
