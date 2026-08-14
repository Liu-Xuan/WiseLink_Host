import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

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
import {
  buildJobAidCriterionSetVersion,
} from '../assessment-workbench/job-aid-runtime/criterionSet.js';
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

const RULE_ARTIFACT_REF =
  'feishu-drive://file/Q3eVb8SGFovADCxSdH6cWDKCnme';
const RULE_ARTIFACT_VERSION = '7672126854932728804';
const RULE_CRITERIA_HASH =
  'sha256:29a085166e2f08391b6f057a9e6dbb881800bd087cef9c359ea3a6f93ebc03cd';
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
  criterionId: string;
  review: EngineerReviewState;
  externalDiscovery?: HostedOpenClawDiscoveryResult | null;
  reviewedExternalManifest?: unknown;
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
  ) {}

  async evaluateCandidate(
    input: CanonicalAssessmentEvaluateInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    let workItem = await this.requiredSbWorkItem(input.workItemId);
    if (workItem.assessment) return workItem;
    const permissionSnapshotVersion = await this.authorize(
      workItem,
      actor,
      'EVALUATE_JOB_AID',
    );
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'EVALUATE_JOB_AID',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
    });
    if (!attempt.created) {
      workItem = await this.requiredSbWorkItem(input.workItemId);
      if (workItem.assessment) return workItem;
      throw new Error('ASSESSMENT_EVALUATE_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      const packageBytes = await this.readAcceptedPackage(
        workItem,
        permissionSnapshotVersion,
      );
      const ruleBytes = await readAssessmentAsset('job-aid/rule-pack-0.2.json');
      const rulePack = JSON.parse(Buffer.from(ruleBytes).toString('utf8')) as
        Record<string, unknown>;
      const ruleDigest =
        'sha256:' + createHash('sha256').update(ruleBytes).digest('hex');
      const criterionSet = buildJobAidCriterionSetVersion({
        rulePack,
        artifactRef: RULE_ARTIFACT_REF,
        artifactDigest: ruleDigest,
        artifactVersion: RULE_ARTIFACT_VERSION,
        canonicalCriteriaHash: RULE_CRITERIA_HASH,
        sourceJobAidDocumentVersionStatus: 'VERSION_UNCONFIRMED',
        lifecycleStatus: 'ACTIVE',
      });
      const result = this.assessment.runCandidate({
        assessment: {
          workItemId: workItem.workItemId,
          documentVersionBinding: assessmentBinding(workItem),
          artifactBytes: packageBytes,
          assessmentAsOf: requiredIso(input.assessmentAsOf, 'assessmentAsOf'),
          rulePack,
          rulePackHash: ruleDigest.slice('sha256:'.length),
          criterionSet,
          jobAidSourceIdentity: {
            status: 'SOURCE_IDENTITY_MISMATCH',
            sourceManifestHash: JOB_AID_SOURCE_MANIFEST_HASH,
            allowsCandidateOnlyAssessment: true,
            blocksEngineeringClosure: true,
            blocksRulePromotion: true,
          },
          generatedAt: requiredIso(input.generatedAt, 'generatedAt'),
        },
        externalDiscovery: input.externalDiscovery ?? null,
        reviewedExternalOemManifest:
          input.reviewedExternalManifest ?? null,
      });
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

  async resynthesizeAfterEngineerChange(
    input: CanonicalAssessmentResynthesisInput,
    actor: CanonicalHostActor,
  ): Promise<CanonicalWorkItemProjection> {
    let workItem = await this.requiredSbWorkItem(input.workItemId);
    if (!workItem.assessment) throw new Error('ASSESSMENT_CANDIDATE_REQUIRED');
    if (workItem.assessment.resynthesisAttemptId) return workItem;
    await this.authorize(workItem, actor, 'RESYNTHESIZE_ASSESSMENT');
    const attempt = await this.repository.reserveAssessmentAction({
      workItemId: workItem.workItemId,
      actionType: 'RESYNTHESIZE_ASSESSMENT',
      triggerRequestId: workItem.requestId,
      requestOrigin: 'MIAODA',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
    });
    if (!attempt.created) {
      workItem = await this.requiredSbWorkItem(input.workItemId);
      if (workItem.assessment?.resynthesisAttemptId) return workItem;
      throw new Error('ASSESSMENT_RESYNTHESIS_INCOMPLETE_PRIOR_ATTEMPT');
    }
    try {
      const previous = await this.readAssessmentResult(
        workItem.assessment.artifact,
      );
      const changed = structuredClone(previous.evaluation.snapshot);
      const item = changed.items.find(
        (candidate) => candidate.criterionId === input.criterionId,
      );
      if (!item) throw new Error('ASSESSMENT_CRITERION_NOT_FOUND');
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

  private async requiredSbWorkItem(
    workItemId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getByWorkItemId(workItemId);
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

  private async authorize(
    workItem: CanonicalWorkItemProjection,
    actor: CanonicalHostActor,
    action: 'EVALUATE_JOB_AID' | 'RESYNTHESIZE_ASSESSMENT',
  ): Promise<string> {
    const decision = await this.authorization.authorize({
      actor,
      action,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    const snapshot = await this.permissionSnapshots.freshRead({
      actor,
      decision,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (snapshot.permissionSnapshotVersion !== decision.permissionSnapshotVersion) {
      throw new Error('ASSESSMENT_PERMISSION_SNAPSHOT_CHANGED');
    }
    return snapshot.permissionSnapshotVersion;
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
      result.externalDiscovery?.ailyModelInput.externalDiscovery.resultStatus
      ?? null,
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

async function readAssessmentAsset(relativePath: string): Promise<Uint8Array> {
  const candidates = [
    resolve(process.cwd(), 'dist/server/runtime-assets/assessment-host', relativePath),
    resolve(process.cwd(), 'server/runtime-assets/assessment-host', relativePath),
    resolve(__dirname, '../../runtime-assets/assessment-host', relativePath),
  ];
  for (const path of candidates) {
    try {
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('ASSESSMENT_RUNTIME_ASSET_NOT_PACKAGED:' + relativePath);
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function requiredIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error('ASSESSMENT_' + field.toUpperCase() + '_INVALID');
  }
  return value;
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
