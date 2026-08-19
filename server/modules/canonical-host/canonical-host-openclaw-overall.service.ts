import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { ExternalDiscoveryService } from '../external-discovery/external-discovery.service';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import {
  MiaodaWorkItemRepository,
  type OverallSynthesisActionAttempt,
} from '../work-item/miaoda-work-item.repository';
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
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import {
  buildOpenClawOverallSynthesisInput,
  consumeOpenClawOverallSynthesisOutput,
  type OpenClawOverallSynthesisInput,
} from './openclaw-overall-synthesis.processor';

const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';
const CANONICAL_APP_ID = 'app_17bzc551rsg';

@Injectable()
export class CanonicalHostOpenClawOverallService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(CANONICAL_AUTHORIZATION)
    private readonly authorization: CanonicalAuthorizationPort,
    @Inject(CANONICAL_PERMISSION_SNAPSHOT)
    private readonly permissions: CanonicalPermissionSnapshotPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly discovery: ExternalDiscoveryService,
    private readonly assessment: CanonicalHostAssessmentService,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
  ) {}

  async begin(
    workItemId: string,
    providers: string[],
  ): Promise<{
    attemptRef: string;
    selectedDiscoveryRefs: string[];
    modelInput: OpenClawOverallSynthesisInput;
  }> {
    const workItem = await this.requiredBaseRules(workItemId);
    const row = await this.repository.getRow(workItem.workItemId);
    const actor = serviceActor(row.tenantId);
    const permissionSnapshotVersion = await this.authorize(workItem, actor);
    const providerCodes = providerCodesFor(providers);
    const attempt = await this.repository.reserveOverallSynthesisAction({
      workItemId: workItem.workItemId,
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      attemptNo: workItem.revision,
      providerCodes,
    });
    if (attempt.status !== 'RUNNING') {
      throw new Error('OPENCLAW_OVERALL_PRIOR_ATTEMPT_NOT_RUNNING');
    }
    let packet: Awaited<ReturnType<typeof this.buildPacket>>;
    try {
      packet = await this.buildPacket(
        workItem,
        attempt,
        permissionSnapshotVersion,
      );
    } catch (error) {
      await this.repository.recordOpenClawBeginFailure({
        attemptId: attempt.attemptId,
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
      });
      throw error;
    }
    return {
      attemptRef: attempt.triggerRequestId,
      selectedDiscoveryRefs: packet.selectedDiscoveryRefs,
      modelInput: packet.modelInput,
    };
  }

  async resume(
    attemptReference: string,
  ): Promise<{
    attemptRef: string;
    selectedDiscoveryRefs: string[];
    modelInput: OpenClawOverallSynthesisInput;
  }> {
    const attempt = await this.repository.getOverallSynthesisActionByRef(
      attemptReference,
    );
    if (attempt.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS') {
      throw new Error('OPENCLAW_OVERALL_RESUME_ACTION_MISMATCH');
    }
    if (attempt.status !== 'RUNNING') {
      throw new Error('OPENCLAW_OVERALL_RESUME_ATTEMPT_NOT_RUNNING');
    }
    if (
      attempt.packageArtifactRef !== null ||
      attempt.packageArtifactSha256 !== null ||
      attempt.failureArtifactRef !== null ||
      attempt.failureArtifactSha256 !== null
    ) {
      throw new Error('OPENCLAW_OVERALL_RESUME_ARTIFACT_ALREADY_PRESENT');
    }

    const workItem = await this.requiredBaseRules(attempt.workItemId);
    if (workItem.workItemId !== attempt.workItemId) {
      throw new Error('OPENCLAW_OVERALL_RESUME_WORK_ITEM_MISMATCH');
    }
    if (workItem.revision !== attempt.attemptNo) {
      throw new Error('OPENCLAW_OVERALL_RESUME_REVISION_MISMATCH');
    }
    const actor = serviceActor(attempt.tenantId);
    if (attempt.actorUserId !== actor.userId) {
      throw new Error('OPENCLAW_OVERALL_SERVICE_ACTOR_MISMATCH');
    }
    const permissionSnapshotVersion = await this.authorize(workItem, actor);
    const packet = await this.buildPacket(
      workItem,
      attempt,
      permissionSnapshotVersion,
    );
    return {
      attemptRef: attempt.triggerRequestId,
      selectedDiscoveryRefs: packet.selectedDiscoveryRefs,
      modelInput: packet.modelInput,
    };
  }

  async commit(
    attemptRef: string,
    output: string,
  ): Promise<Record<string, unknown>> {
    const attempt = await this.repository.getOverallSynthesisActionByCallerRef(
      attemptRef,
    );
    const recovered = await this.recoverExistingCommit(attempt);
    if (recovered) return recovered;
    if (attempt.status !== 'RUNNING') {
      throw new Error('OPENCLAW_OVERALL_ATTEMPT_NOT_RUNNING');
    }
    const workItem = await this.requiredBaseRules(attempt.workItemId);
    if (workItem.revision !== attempt.attemptNo) {
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const actor = serviceActor(attempt.tenantId);
    if (attempt.actorUserId !== actor.userId) {
      throw new Error('OPENCLAW_OVERALL_SERVICE_ACTOR_MISMATCH');
    }
    const permissionSnapshotVersion = await this.authorize(workItem, actor);
    let claimed = false;
    try {
      const { modelInput } = await this.buildPacket(
        workItem,
        attempt,
        permissionSnapshotVersion,
      );
      const parsed = consumeOpenClawOverallSynthesisOutput(modelInput, output);
      await this.repository.claimOverallSynthesisCommit(attempt.attemptId);
      claimed = true;
      const persisted = await this.artifactStore.persistAndReadback(
        new TextEncoder().encode(output),
      );
      const baseRules = workItem.integratedAssessment!.baseRules;
      const overall: CanonicalOpenClawOverallProjection = {
        status: 'CANDIDATE_ONLY',
        revision:
          (workItem.integratedAssessment?.overallSynthesis?.revision ?? 0) + 1,
        sourceResultId: requiredText(parsed.sourceResultId),
        basedOnBaseRuleRevision: baseRules.revision,
        basedOnBaseRuleArtifactSha256: baseRules.artifact.sha256,
        basedOnEngineerReviewRevision:
          modelInput.engineerReviewContext.revision,
        basedOnEngineerReviewArtifactSha256:
          modelInput.engineerReviewContext.artifactSha256,
        discoveryStatus: requiredText(parsed.discoveryStatus),
        gap: nullableString(parsed.gap),
        candidateRefCount: requiredCount(parsed.candidateRefCount),
        findingCount: requiredCount(parsed.findingCount),
        unresolvedCount: requiredCount(parsed.unresolvedCount),
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
        artifact: persisted.artifact,
        actionAttemptId: attempt.attemptId,
        staleReason: null,
        overallCandidate: requiredText(parsed.overallCandidate),
        findings: overallFindings(parsed.findings),
        missingInputs: requiredTextArray(parsed.missingInputs),
        applicabilityStatus: requiredText(parsed.applicabilityStatus),
        engineeringReviewRequired: parsed.engineeringReviewRequired === true,
        providers: requiredObject(parsed.providers),
      };
      const integratedAssessment: CanonicalIntegratedAssessmentProjection = {
        status: 'OVERALL_CANDIDATE_READY',
        baseRules,
        engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
        overallSynthesis: overall,
        overallForAeoConfirmation: null,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment,
          // A new overall candidate must be confirmed before it can seed AEO.
          // Do not keep displaying a candidate bound to an older synthesis.
          aeo: null,
        },
      });
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return {
        workItemId: updated.workItemId,
        workItemRevision: updated.revision,
        status: integratedAssessment.status,
        overallSynthesis: overall,
      };
    } catch (error) {
      if (claimed) {
        const recovered = await this.recoverClaimedFailure(attempt, error);
        if (recovered) return recovered;
      }
      throw error;
    }
  }

  private async recoverExistingCommit(
    attempt: OverallSynthesisActionAttempt,
  ): Promise<Record<string, unknown> | null> {
    if (attempt.status === 'RUNNING') return null;
    const workItem = await this.requiredBaseRules(attempt.workItemId);
    const committed = committedOverallResult(workItem, attempt);
    if (committed && attempt.status === 'COMMITTING') {
      await this.repository.completeAssessmentAction(attempt.attemptId);
      return committed;
    }
    if (committed && attempt.status === 'SUCCEEDED') return committed;
    if (attempt.status === 'COMMITTING') {
      throw new Error('OPENCLAW_OVERALL_COMMIT_IN_PROGRESS');
    }
    throw new Error('OPENCLAW_OVERALL_ATTEMPT_NOT_RUNNING');
  }

  private async recoverClaimedFailure(
    attempt: OverallSynthesisActionAttempt,
    error: unknown,
  ): Promise<Record<string, unknown> | null> {
    const workItem = await this.requiredBaseRules(attempt.workItemId);
    const committed = committedOverallResult(workItem, attempt);
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

  private async buildPacket(
    workItem: CanonicalWorkItemProjection,
    attempt: OverallSynthesisActionAttempt,
    permissionSnapshotVersion: string,
  ): Promise<{
    selectedDiscoveryRefs: string[];
    modelInput: OpenClawOverallSynthesisInput;
  }> {
    const baseRules = workItem.integratedAssessment!.baseRules;
    const discoveries = await packetInput(
      'OPENCLAW_OVERALL_DISCOVERY_READ_FAILED',
      () =>
        this.discovery.latestSearchRunsAsOf(
          providerCodesFromOrigin(attempt.requestOrigin),
          attempt.createdAt.toISOString(),
          serverContext(serviceActor(attempt.tenantId)),
        ),
    );
    const timestamp = attempt.createdAt.toISOString();
    const [
      baseArtifactBytes,
      packageBytes,
      dynamicCandidate,
      engineerReviewContext,
    ] = await Promise.all([
      packetInput('OPENCLAW_OVERALL_BASE_ARTIFACT_READ_FAILED', () =>
        this.artifactStore.readActualBytes(baseRules.artifact),
      ),
      packetInput('OPENCLAW_OVERALL_PACKAGE_ARTIFACT_READ_FAILED', () =>
        this.artifactStore.readActualBytes(workItem.package!.artifact),
      ),
      packetInput('OPENCLAW_OVERALL_DYNAMIC_CANDIDATE_BUILD_FAILED', () =>
        this.assessment.prepareDynamicRulesCandidate({
          workItem,
          permissionSnapshotVersion,
          assessmentAsOf: timestamp,
          generatedAt: timestamp,
          externalDiscovery: null,
          reviewedExternalManifest: null,
        }),
      ),
      packetInput('OPENCLAW_OVERALL_ENGINEER_REVIEW_READ_FAILED', () =>
        this.engineerReviews.modelContext(workItem),
      ),
    ]);
    assertDynamicCandidateSummary(dynamicCandidate.summary, workItem, baseRules);
    const sourceEvidenceCandidates = dynamicCandidate.overall.context.criterionCards
      .flatMap((criterion) => criterion.sourceEvidenceCandidates);
    return {
      selectedDiscoveryRefs: discoveries.map((value) => value.searchRunRef),
      modelInput: buildOpenClawOverallSynthesisInput({
        workItem,
        baseRules,
        baseArtifactBytes,
        packageBytes,
        discoveries,
        sourceEvidenceCandidates,
        engineerReviewContext,
        outputCorrelationRef: attempt.triggerRequestId,
      }),
    };
  }

  private async requiredBaseRules(
    workItemId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getByWorkItemId(workItemId);
    if (
      workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' ||
      !workItem.package ||
      !workItem.integratedAssessment?.baseRules ||
      !workItem.integratedAssessment.baseRules.sourceResultId.startsWith(
        'openclaw-dynamic://',
      )
    ) {
      throw new Error('OPENCLAW_OVERALL_DYNAMIC_N_CANDIDATE_REQUIRED');
    }
    const baseRules = workItem.integratedAssessment.baseRules;
    const attempt = await this.repository.getDynamicEvaluationActionByAttemptId(
      baseRules.actionAttemptId,
    );
    if (
      attempt.attemptId !== baseRules.actionAttemptId ||
      attempt.workItemId !== workItem.workItemId ||
      attempt.status !== 'SUCCEEDED' ||
      baseRules.sourceResultId !==
        `openclaw-dynamic://${attempt.triggerRequestId}`
    ) {
      throw new Error('OPENCLAW_OVERALL_DYNAMIC_N_ATTEMPT_MISMATCH');
    }
    return workItem;
  }

  private async authorize(
    workItem: CanonicalWorkItemProjection,
    actor: CanonicalHostActor,
  ): Promise<string> {
    const decision = await this.authorization.authorize({
      actor,
      action: 'PERSIST_OPENCLAW_OVERALL',
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (!decision.allowed || decision.action !== 'PERSIST_OPENCLAW_OVERALL') {
      throw new Error('CANONICAL_ACTION_NOT_AUTHORIZED');
    }
    const snapshot = await this.permissions.freshRead({
      actor,
      decision,
      workItemId: workItem.workItemId,
      requestId: workItem.requestId,
      documentVersionId: workItem.source.documentVersionId,
    });
    if (snapshot.permissionSnapshotVersion !== decision.permissionSnapshotVersion) {
      throw new Error('OPENCLAW_OVERALL_PERMISSION_SNAPSHOT_CHANGED');
    }
    return snapshot.permissionSnapshotVersion;
  }
}

function serviceActor(tenantId: string): CanonicalHostActor {
  if (!tenantId.trim()) throw new Error('OPENCLAW_OVERALL_TENANT_REQUIRED');
  return { userId: OPENCLAW_SERVICE_USER_ID, tenantId, appId: CANONICAL_APP_ID, roles: [], env: 'hosted' };
}
function committedOverallResult(
  workItem: CanonicalWorkItemProjection,
  attempt: OverallSynthesisActionAttempt,
): Record<string, unknown> | null {
  const integrated = workItem.integratedAssessment;
  const overall = integrated?.overallSynthesis;
  if (!integrated || overall?.actionAttemptId !== attempt.attemptId) return null;
  return {
    workItemId: workItem.workItemId,
    workItemRevision: workItem.revision,
    status: integrated.status,
    overallSynthesis: overall,
  };
}
function assertDynamicCandidateSummary(
  summary: {
    workItemId: string;
    documentVersionId: string;
    parsedPackageId: string;
    criterionSetId: string;
    criterionCount: number;
    evaluationItemCount: number;
  },
  workItem: CanonicalWorkItemProjection,
  baseRules: CanonicalIntegratedAssessmentProjection['baseRules'],
): void {
  if (
    summary.workItemId !== workItem.workItemId ||
    summary.documentVersionId !== workItem.source.documentVersionId ||
    summary.parsedPackageId !== workItem.package?.packageId ||
    summary.criterionSetId !== baseRules.criterionSetId ||
    summary.criterionCount !== baseRules.criterionCount ||
    summary.evaluationItemCount !== baseRules.evaluationItemCount
  ) {
    throw new Error('OPENCLAW_OVERALL_DYNAMIC_N_CONTEXT_DRIFT');
  }
}
function serverContext(actor: CanonicalHostActor) { return { actorUserId: actor.userId, tenantId: actor.tenantId, roles: [] as string[] }; }
function providerCodesFor(providers: string[]): string[] {
  if (new Set(providers).size !== providers.length || providers.length > 3) throw new Error('OPENCLAW_OVERALL_PROVIDERS_INVALID');
  const codes = providers.map((provider) => ({ AIRBUS: 'A', BOEING: 'B', COMAC: 'C' })[provider]);
  if (codes.some((code) => !code)) throw new Error('OPENCLAW_OVERALL_PROVIDERS_INVALID');
  return codes as string[];
}
function providerCodesFromOrigin(origin: string): string[] { const value = origin.replace(/^OPENCLAW_OVR_/u, ''); return value === 'NONE' ? [] : [...value]; }
function requiredText(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('OPENCLAW_OVERALL_RESULT_TEXT_INVALID'); return value; }
function nullableString(value: unknown): string | null { if (value === null) return null; return requiredText(value); }
function requiredCount(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('OPENCLAW_OVERALL_RESULT_COUNT_INVALID'); return Number(value); }
function requiredTextArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item: unknown): boolean => typeof item !== 'string' || !item.trim())) {
    throw new Error('OPENCLAW_OVERALL_RESULT_TEXT_ARRAY_INVALID');
  }
  return value as string[];
}
function requiredObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OPENCLAW_OVERALL_RESULT_OBJECT_INVALID');
  }
  return value as Record<string, unknown>;
}
function overallFindings(value: unknown): Array<{
  finding: string;
  basis: string;
  sourceRefIds: string[];
  assumptions: string[];
  uncertainty: string;
}> {
  if (!Array.isArray(value)) throw new Error('OPENCLAW_OVERALL_RESULT_FINDINGS_INVALID');
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('OPENCLAW_OVERALL_RESULT_FINDING_INVALID');
    }
    const finding = item as Record<string, unknown>;
    return {
      finding: requiredText(finding.finding),
      basis: requiredText(finding.basis),
      sourceRefIds: requiredTextArray(finding.sourceRefIds),
      assumptions: requiredTextArray(finding.assumptions),
      uncertainty: requiredText(finding.uncertainty),
    };
  });
}
function withoutRevision(workItem: CanonicalWorkItemProjection): Omit<CanonicalWorkItemProjection, 'revision'> { const { revision: _revision, ...rest } = workItem; return rest; }
function errorCode(error: unknown): string { return error instanceof Error ? error.message.split(':', 1)[0] : 'OPENCLAW_OVERALL_FAILED'; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function packetInput<T>(
  code: string,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    const error = new Error(`${code}:${errorMessage(cause)}`);
    (error as Error & { cause?: unknown }).cause = cause;
    throw error;
  }
}
