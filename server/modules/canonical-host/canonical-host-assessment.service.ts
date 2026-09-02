import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';

import type {
  CanonicalAssessmentCandidateProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
} from '@shared/api.interface';
import type { EngineerReviewState } from '@shared/assessment-host.interface';
import {
  AssessmentHostConsumerService,
  type AssessmentHostCandidateResult,
  type HostedOpenClawDiscoveryResult,
} from '../assessment-workbench/assessment-host-consumer.public-api';
import { buildJobAidSourceEvidenceCandidates } from '../assessment-workbench/job-aid-runtime/sourceEvidenceCandidates.js';
import { buildUnifiedSbJobAidAssessmentInput } from '../assessment-workbench/unified-assessment-input';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
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
import { MiaodaWorkItemRepository } from '../work-item/miaoda-work-item.repository';
import { PHASE5_737_34_3830_HANDOFF } from '../document-management/src/hosted/phase5BoeingSbHandoff.js';
import { authorizeAndLoadCanonicalWorkItem } from './canonical-authorized-work-item-reader';
import {
  CanonicalRuleSetLifecycleService,
  type ActiveCanonicalRuleSetRuntime,
  type CanonicalRuleSetRuntime,
} from './canonical-rule-set-lifecycle.service';
const JOB_AID_SOURCE_MANIFEST_HASH =
  'sha256:550473ef40f3f4347eeceb392c9fd4318566e1bb7b102c10b5ec014f1a102678';

export interface CanonicalAssessmentEvaluateInput {
  workItemId: string;
  assessmentAsOf: string;
  generatedAt: string;
  externalDiscovery?: HostedOpenClawDiscoveryResult | null;
  reviewedExternalManifest?: unknown;
}

export interface CanonicalAssessmentResynthesisInput {
  workItemId: string;
  expectedRevision: number;
  criterionId: string;
  review: EngineerReviewState;
  externalDiscovery?: HostedOpenClawDiscoveryResult | null;
  reviewedExternalManifest?: unknown;
}

export interface PreparedDynamicRulesCandidate extends AssessmentHostCandidateResult {
  dynamicRulesInput: Record<string, unknown>;
}

@Injectable()
export class CanonicalHostAssessmentService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissionSnapshots: CanonicalPermissionSnapshotPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly assessment: AssessmentHostConsumerService,
    private readonly ruleSets: CanonicalRuleSetLifecycleService,
  ) {}

  async evaluateCandidate(
    input: CanonicalAssessmentEvaluateInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    let authorized = await this.authorizeAndLoad(
      input.workItemId,
      actor,
      'EVALUATE_JOB_AID',
    );
    let workItem = requiredSbWorkItem(authorized.workItem);
    const permissionSnapshotVersion = authorized.permissionSnapshotVersion;
    if (workItem.assessment) return workItem;
    // Resolve and verify the exact ACTIVE runtime before creating the
    // synchronous attempt. A zero-head tenant must remain a zero-write
    // failure, and this runtime remains the input for the whole call.
    const activeRuleSet: ActiveCanonicalRuleSetRuntime =
      await this.ruleSets.readActiveRuntime(actor.tenantId);
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'EVALUATE_JOB_AID',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: 1,
    });
    if (!attempt.created) {
      authorized = await this.authorizeAndLoad(
        input.workItemId,
        actor,
        'EVALUATE_JOB_AID',
      );
      workItem = requiredSbWorkItem(authorized.workItem);
      if (workItem.assessment) return workItem;
      throw new Error('ASSESSMENT_EVALUATE_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      const result = await this.prepareDynamicRulesCandidateWithRuleSet(
        {
          workItem,
          tenantId: actor.tenantId,
          permissionSnapshotVersion,
          assessmentAsOf: input.assessmentAsOf,
          generatedAt: input.generatedAt,
          externalDiscovery: input.externalDiscovery ?? null,
          reviewedExternalManifest: input.reviewedExternalManifest ?? null,
        },
        activeRuleSet,
      );
      const persisted = await this.persistResult(result);
      const projection = assessmentProjection(
        result,
        persisted.artifact,
        attempt.attemptId,
        null,
      );
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          assessment: projection,
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

  async prepareDynamicRulesCandidate(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    permissionSnapshotVersion: string;
    assessmentAsOf: string;
    generatedAt: string;
    externalDiscovery: HostedOpenClawDiscoveryResult | null;
    reviewedExternalManifest: unknown | null;
  }): Promise<PreparedDynamicRulesCandidate> {
    const activeRuleSet = await this.ruleSets.readActiveRuntime(input.tenantId);
    return this.prepareDynamicRulesCandidateWithRuleSet(input, activeRuleSet);
  }

  async resolveStoredBaseSourceEvidenceRefs(input: {
    workItem: CanonicalWorkItemProjection;
    tenantId: string;
    packageBytes: Uint8Array;
    assessmentAsOf: string;
  }): Promise<Map<string, string[]>> {
    const baseRules = input.workItem.integratedAssessment?.baseRules;
    if (!baseRules) throw new Error('ASSESSMENT_STORED_BASE_RULES_REQUIRED');
    const ruleSet = await this.ruleSets.readRuntimeSnapshot(
      input.tenantId,
      baseRules.criterionSetId,
    );
    const criteria = runtimeCriteria(ruleSet.rulePack);
    if (
      ruleSet.snapshotId !== baseRules.criterionSetId ||
      ruleSet.criterionSet.criterionSetId !== baseRules.criterionSetId ||
      ruleSet.criterionSet.criteriaCount !== baseRules.criterionCount ||
      criteria.length !== baseRules.evaluationItemCount
    ) {
      throw new Error('ASSESSMENT_STORED_BASE_RULE_SET_DRIFT');
    }
    const dynamicRulesInput = buildUnifiedSbJobAidAssessmentInput({
      documentVersionBinding: assessmentBinding(input.workItem),
      artifactBytes: input.packageBytes,
      assessmentAsOf: requiredIso(input.assessmentAsOf, 'assessmentAsOf'),
    });
    const resolved = new Map<string, string[]>();
    for (const criterion of criteria) {
      const criterionId = requiredRuntimeText(
        criterion.criterion_id,
        'ASSESSMENT_STORED_BASE_CRITERION_ID_INVALID',
      );
      const candidates: unknown = buildJobAidSourceEvidenceCandidates({
        criterion,
        input: dynamicRulesInput,
      });
      if (!Array.isArray(candidates)) {
        throw new Error('ASSESSMENT_STORED_BASE_SOURCE_CATALOG_INVALID');
      }
      for (const candidate of candidates) {
        const binding = sourceEvidenceCandidateBinding(candidate, criterionId);
        const existing = resolved.get(binding.candidateId);
        if (
          existing &&
          JSON.stringify(existing) !== JSON.stringify(binding.sourceRefIds)
        ) {
          throw new Error('ASSESSMENT_STORED_BASE_SOURCE_CANDIDATE_DRIFT');
        }
        resolved.set(binding.candidateId, binding.sourceRefIds);
      }
    }
    return resolved;
  }

  async prepareDynamicRulesCandidateWithRuleSet(
    input: {
      workItem: CanonicalWorkItemProjection;
      tenantId: string;
      permissionSnapshotVersion: string;
      assessmentAsOf: string;
      generatedAt: string;
      externalDiscovery: HostedOpenClawDiscoveryResult | null;
      reviewedExternalManifest: unknown | null;
    },
    ruleSet: CanonicalRuleSetRuntime,
  ): Promise<PreparedDynamicRulesCandidate> {
    const packageBytes = await this.readAcceptedPackage(
      input.workItem,
      input.permissionSnapshotVersion,
    );
    const assessmentOptions = {
      workItemId: input.workItem.workItemId,
      documentVersionBinding: assessmentBinding(input.workItem),
      artifactBytes: packageBytes,
      assessmentAsOf: requiredIso(input.assessmentAsOf, 'assessmentAsOf'),
      rulePack: ruleSet.rulePack,
      rulePackHash: ruleSet.rulePackHash,
      criterionSet: ruleSet.criterionSet,
      jobAidSourceIdentity: {
        status: 'SOURCE_IDENTITY_MISMATCH',
        sourceManifestHash: JOB_AID_SOURCE_MANIFEST_HASH,
        allowsCandidateOnlyAssessment: true,
        blocksEngineeringClosure: true,
        blocksRulePromotion: true,
      },
      generatedAt: requiredIso(input.generatedAt, 'generatedAt'),
    };
    const dynamicRulesInput = buildUnifiedSbJobAidAssessmentInput({
      documentVersionBinding: assessmentOptions.documentVersionBinding,
      artifactBytes: packageBytes,
      assessmentAsOf: assessmentOptions.assessmentAsOf,
    });
    return {
      ...this.assessment.runCandidate({
        assessment: assessmentOptions,
        externalDiscovery: input.externalDiscovery,
        reviewedExternalOemManifest: input.reviewedExternalManifest,
      }),
      dynamicRulesInput,
    };
  }

  async resynthesizeAfterEngineerChange(
    input: CanonicalAssessmentResynthesisInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    let authorized = await this.authorizeAndLoad(
      input.workItemId,
      actor,
      'RESYNTHESIZE_ASSESSMENT',
    );
    let workItem = requiredSbWorkItem(authorized.workItem);
    if (!workItem.assessment) {
      throw new ConflictException('ASSESSMENT_CANDIDATE_REQUIRED');
    }
    if (workItem.revision !== input.expectedRevision) {
      throw new ConflictException('WORK_ITEM_CAS_CONFLICT');
    }
    validateEngineerChange(input, actor);
    const previous = await this.readAssessmentResult(
      workItem.assessment.artifact,
    );
    const changed = structuredClone(previous.evaluation.snapshot);
    const item = changed.items.find(
      (candidate) => candidate.criterionId === input.criterionId,
    );
    if (!item) throw assessmentBadRequest('ASSESSMENT_CRITERION_NOT_FOUND');
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'RESYNTHESIZE_ASSESSMENT',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: input.expectedRevision,
    });
    if (!attempt.created) {
      authorized = await this.authorizeAndLoad(
        input.workItemId,
        actor,
        'RESYNTHESIZE_ASSESSMENT',
      );
      workItem = requiredSbWorkItem(authorized.workItem);
      if (workItem.revision !== input.expectedRevision) return workItem;
      throw new Error('ASSESSMENT_RESYNTHESIS_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      item.engineerReview = structuredClone(input.review);
      const result = this.assessment.resynthesizeAfterEngineerChange(
        previous,
        changed,
        input.externalDiscovery ?? null,
        input.reviewedExternalManifest ?? null,
      );
      const persisted = await this.persistResult(result);
      const projection = assessmentProjection(
        result,
        persisted.artifact,
        workItem.assessment.evaluateAttemptId,
        attempt.attemptId,
      );
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          assessment: projection,
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

  private authorizeAndLoad(
    workItemId: string,
    actor: CanonicalHostActor,
    action: 'EVALUATE_JOB_AID' | 'RESYNTHESIZE_ASSESSMENT',
  ) {
    return authorizeAndLoadCanonicalWorkItem({
      authorization: this.authorization,
      permissionSnapshots: this.permissionSnapshots,
      registrar: this.registrar,
      actor,
      action,
      workItemId,
    });
  }

  private async readAcceptedPackage(
    workItem: CanonicalWorkItemProjection,
    permissionSnapshotVersion: string,
  ): Promise<Uint8Array> {
    if (!workItem.package) throw new Error('ASSESSMENT_PACKAGE_REQUIRED');
    const readback = await this.reader.readback({
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
      permissionSnapshotVersion,
      package: {
        packageId: workItem.package.packageId,
        contractId: workItem.package.contractId,
        contractRevision: workItem.package.contractRevision,
        artifact: workItem.package.artifact,
      },
      query: 'applicability',
    });
    if (
      readback.status !== 'CANDIDATE_READBACK_VERIFIED' ||
      readback.fullValidatorProof.status !== 'FULL_STRICT_VALIDATOR_PASSED'
    ) {
      throw new Error('ASSESSMENT_READER_RECEIPT_REQUIRED');
    }
    return this.artifactStore.readActualBytes(workItem.package.artifact);
  }

  private async persistResult(result: AssessmentHostCandidateResult) {
    const bytes = new TextEncoder().encode(JSON.stringify(result));
    return this.artifactStore.persistAndReadback(bytes);
  }

  private async readAssessmentResult(
    artifact: UnifiedPackageArtifactDescriptor,
  ): Promise<AssessmentHostCandidateResult> {
    const bytes = await this.artifactStore.readActualBytes(artifact);
    return JSON.parse(
      new TextDecoder('utf8', { fatal: true }).decode(bytes),
    ) as AssessmentHostCandidateResult;
  }
}

function assessmentBinding(workItem: CanonicalWorkItemProjection) {
  const pkg = workItem.package;
  if (!pkg) throw new Error('ASSESSMENT_PACKAGE_REQUIRED');
  return {
    documentId: workItem.source.documentId,
    documentVersionId: workItem.source.documentVersionId,
    artifactRecord: {
      $schema: 'urn:techpub:schema:v1:artifact-record:frozen-2',
      schemaVersion: 'techpub.artifact-record.v1',
      contractRevision: 'frozen.2',
      artifactRef: pkg.artifact.ref,
      mediaType: 'application/json',
      byteLength: pkg.artifact.byteLength,
      artifactHash: 'sha256:' + pkg.artifact.sha256,
      packageId: pkg.packageId,
      contentHash: pkg.contentHash,
    },
    lifecycleStatus: 'FROZEN' as const,
    selectionStatus: 'SELECTED' as const,
    isCurrent: true as const,
    classification: structuredClone(phase5Handoff().classificationEnvelope),
  };
}

function assessmentProjection(
  result: AssessmentHostCandidateResult,
  artifact: UnifiedPackageArtifactDescriptor,
  evaluateAttemptId: string,
  resynthesisAttemptId: string | null,
): CanonicalAssessmentCandidateProjection {
  return {
    status: resynthesisAttemptId
      ? 'CANDIDATE_ONLY_RESYNTHESIZED'
      : 'CANDIDATE_ONLY',
    criterionSetId: result.summary.criterionSetId,
    criterionCount: result.summary.criterionCount,
    evaluationItemCount: result.summary.evaluationItemCount,
    packageStatus: result.summary.packageStatus,
    applicabilityOverall: result.summary.applicabilityOverall,
    authorityLevel: result.summary.authorityLevel,
    warningCodes: [...result.summary.warningCodes],
    blocksEngineeringClosure: result.summary.blocksEngineeringClosure,
    externalDiscoveryStatus:
      result.externalDiscovery?.ailyModelInput.externalDiscovery.resultStatus ??
      null,
    externalDiscoveryIsEvidence: false,
    previousOverallStale: result.staleState.previousOverallStale,
    staleReason: result.staleState.reason,
    currentContextHash: result.staleState.currentContextHash,
    currentTransportHash: result.staleState.currentTransportHash,
    artifact: { ...artifact },
    evaluateAttemptId,
    resynthesisAttemptId,
  };
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function requiredSbWorkItem(
  workItem: CanonicalWorkItemProjection,
): CanonicalWorkItemProjection {
  if (
    workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
    workItem.package === null
  ) {
    throw new Error('ASSESSMENT_PARSED_PACKAGE_NOT_READY');
  }
  if (
    workItem.classification.status !== 'CONFIRMED' ||
    workItem.classification.normalizedFamily !== 'SB'
  ) {
    throw new Error('NOT_APPLICABLE_FOR_SB_ASSESSMENT');
  }
  return workItem;
}

function requiredIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error('ASSESSMENT_' + field.toUpperCase() + '_INVALID');
  }
  return value;
}

function runtimeCriteria(rulePack: Record<string, unknown>) {
  const criteria = rulePack.criteria;
  if (
    !Array.isArray(criteria) ||
    criteria.some(
      (criterion) =>
        typeof criterion !== 'object' ||
        criterion === null ||
        Array.isArray(criterion),
    )
  ) {
    throw new Error('ASSESSMENT_STORED_BASE_RULE_PACK_INVALID');
  }
  return criteria as Array<Record<string, unknown>>;
}

function sourceEvidenceCandidateBinding(
  value: unknown,
  criterionId: string,
): { candidateId: string; sourceRefIds: string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('ASSESSMENT_STORED_BASE_SOURCE_CANDIDATE_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  if (
    requiredRuntimeText(
      candidate.criterionId,
      'ASSESSMENT_STORED_BASE_SOURCE_CRITERION_INVALID',
    ) !== criterionId ||
    !Array.isArray(candidate.sourceRefs) ||
    candidate.sourceRefs.length === 0
  ) {
    throw new Error('ASSESSMENT_STORED_BASE_SOURCE_CANDIDATE_INVALID');
  }
  const sourceRefIds = [
    ...new Set(
      candidate.sourceRefs.map((sourceRef) => {
        if (
          typeof sourceRef !== 'object' ||
          sourceRef === null ||
          Array.isArray(sourceRef)
        ) {
          throw new Error('ASSESSMENT_STORED_BASE_SOURCE_REF_INVALID');
        }
        return requiredRuntimeText(
          (sourceRef as Record<string, unknown>).sourceRefId,
          'ASSESSMENT_STORED_BASE_SOURCE_REF_ID_INVALID',
        );
      }),
    ),
  ];
  return {
    candidateId: requiredRuntimeText(
      candidate.candidateId,
      'ASSESSMENT_STORED_BASE_SOURCE_CANDIDATE_ID_INVALID',
    ),
    sourceRefIds,
  };
}

function requiredRuntimeText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function validateEngineerChange(
  input: CanonicalAssessmentResynthesisInput,
  actor: CanonicalHostActor,
): void {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1
  ) {
    throw assessmentBadRequest('ASSESSMENT_EXPECTEDREVISION_INVALID');
  }
  if (input.criterionId.trim() === '') {
    throw assessmentBadRequest('ASSESSMENT_CRITERIONID_REQUIRED');
  }
  const review = input.review;
  const expectedStatus =
    review.decision === 'confirmed_pass' || review.decision === 'confirmed_fail'
      ? 'ENGINEER_CONFIRMED'
      : review.decision === 'returned_for_rework' ||
          review.decision === 'deferred'
        ? 'NEEDS_REVIEW'
        : null;
  if (expectedStatus === null || review.status !== expectedStatus) {
    throw assessmentBadRequest('ASSESSMENT_ENGINEER_DECISION_STATUS_INVALID');
  }
  if (
    review.comment.trim() === '' ||
    review.baseRecordId.trim() === '' ||
    !Number.isFinite(Date.parse(review.updatedAt))
  ) {
    throw assessmentBadRequest('ASSESSMENT_ENGINEER_REVIEW_INVALID');
  }
  if (
    review.reviewingEngineerUserIds.length !== 1 ||
    review.reviewingEngineerUserIds[0] !== actor.userId
  ) {
    throw assessmentBadRequest('ASSESSMENT_ENGINEER_REVIEW_ACTOR_INVALID');
  }
}

function assessmentBadRequest(code: string): BadRequestException {
  return new BadRequestException({ code, message: code });
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code);
  }
  if (error instanceof Error && /^[A-Z0-9_]+/u.test(error.message)) {
    return error.message.split(':', 1)[0];
  }
  return 'ASSESSMENT_ACTION_FAILED';
}

function phase5Handoff() {
  return PHASE5_737_34_3830_HANDOFF as {
    classificationEnvelope: {
      schemaVersion: string;
      classificationId: string;
      classificationHash: string;
      status: 'CONFIRMED';
      normalizedFamily: 'SB';
      issuer: 'BOEING';
      subtype: 'service_bulletin';
      profileId: string;
      nativeParseProfileId: 'boeing.sb';
    };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
