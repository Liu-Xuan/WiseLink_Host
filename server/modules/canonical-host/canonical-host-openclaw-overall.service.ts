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
      };
      const integratedAssessment: CanonicalIntegratedAssessmentProjection = {
        status: 'OVERALL_CANDIDATE_READY',
        baseRules,
        overallSynthesis: overall,
        overallForAeoConfirmation: null,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: workItem.revision,
        syncPrimaryAttempt: false,
        next: { ...withoutRevision(workItem), integratedAssessment },
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
        await this.repository.failAssessmentAction({
          attemptId: attempt.attemptId,
          errorCode: errorCode(error),
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    }
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
    const discoveries = await this.discovery.latestSearchRunsAsOf(
      providerCodesFromOrigin(attempt.requestOrigin),
      attempt.createdAt.toISOString(),
      serverContext(serviceActor(attempt.tenantId)),
    );
    const timestamp = attempt.createdAt.toISOString();
    const [baseArtifactBytes, packageBytes, dynamicCandidate] = await Promise.all([
      this.artifactStore.readActualBytes(baseRules.artifact),
      this.artifactStore.readActualBytes(workItem.package!.artifact),
      this.assessment.prepareDynamicRulesCandidate({
        workItem,
        permissionSnapshotVersion,
        assessmentAsOf: timestamp,
        generatedAt: timestamp,
        externalDiscovery: null,
        reviewedExternalManifest: null,
      }),
    ]);
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
function withoutRevision(workItem: CanonicalWorkItemProjection): Omit<CanonicalWorkItemProjection, 'revision'> { const { revision: _revision, ...rest } = workItem; return rest; }
function errorCode(error: unknown): string { return error instanceof Error ? error.message.split(':', 1)[0] : 'OPENCLAW_OVERALL_FAILED'; }
