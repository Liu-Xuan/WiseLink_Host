import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import { parseTaskEnvelope } from '../action-attempt/action-attempt-envelope';
import type {
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ActionAttemptTerminalProjection,
  NewActionAttemptIdentity,
  PreparedActionAttemptCommit,
} from '../action-attempt/action-attempt.types';
import { ExternalDiscoveryService } from '../external-discovery/external-discovery.service';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import {
  MiaodaWorkItemRepository,
  type OverallSynthesisActionAttempt,
} from '../work-item/miaoda-work-item.repository';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type {
  CanonicalHostActor,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';
import {
  buildOpenClawOverallSynthesisInput,
  consumeOpenClawOverallSynthesisOutput,
  type OpenClawOverallSynthesisInput,
} from './openclaw-overall-synthesis.processor';
import { assertLatestOverallCandidate } from './selective-overall-resynthesis';
import { preflightCanonicalHostOpenClawResult } from './canonical-host-openclaw-runtime-policy';

const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';
const CANONICAL_APP_ID = 'app_17bzc551rsg';

@Injectable()
export class CanonicalHostOpenClawOverallService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly repository: MiaodaWorkItemRepository,
    private readonly discovery: ExternalDiscoveryService,
    private readonly assessment: CanonicalHostAssessmentService,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  async begin(
    workItemId: string,
    providers: string[],
  ): Promise<{
    attemptRef: string;
    status: 'RUNNING' | 'COMMITTING';
    leaseToken: string;
    leaseGeneration: number;
    leaseExpiresAt: string;
    task: OpenClawTaskEnvelope;
    recoveryResult?: OpenClawResultEnvelope;
    selectedDiscoveryRefs: string[];
    modelInput: OpenClawOverallSynthesisInput;
  }> {
    const scope = await this.serviceScope.authorizeOpenClawWorkItem({
      operation: 'BEGIN_OVERALL',
      workItemId,
    });
    assertWorkItemScope(scope, workItemId);
    const workItem = await this.requiredBaseRules(workItemId, scope.tenantId);
    const actor = serviceActor(scope.tenantId);
    const permissionSnapshotVersion = servicePermissionSnapshot(
      workItem,
      scope,
    );
    const providerCodes = providerCodesFor(providers);
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey: overallIdempotencyKey(workItem, providerCodes),
      sourceRefs: [
        {
          ref: workItem.package!.artifact.ref,
          sha256: workItem.package!.artifact.sha256,
        },
        {
          ref: workItem.integratedAssessment!.baseRules.artifact.ref,
          sha256: workItem.integratedAssessment!.baseRules.artifact.sha256,
        },
      ],
      allowedConnectors: providers,
      buildModelInput: async (identity) => {
        const packet = await this.buildPacket(
          workItem,
          overallAttempt(identity, workItem, actor, providerCodes),
          permissionSnapshotVersion,
        );
        return {
          modelInput: structuredClone(packet.modelInput),
          selectedDiscoveryRefs: [...packet.selectedDiscoveryRefs],
          providerCodes: [...providerCodes],
        };
      },
    });
    const storedInput = storedOverallInput(claim.task.modelInput);
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
      selectedDiscoveryRefs: storedInput.selectedDiscoveryRefs,
      modelInput: storedInput.modelInput,
    };
  }

  async resume(attemptReference: string): Promise<{
    attemptRef: string;
    leaseToken: string;
    leaseGeneration: number;
    leaseExpiresAt: string;
    task: OpenClawTaskEnvelope;
    selectedDiscoveryRefs: string[];
    modelInput: OpenClawOverallSynthesisInput;
  }> {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'RESUME_OVERALL',
      attemptRef: attemptReference,
    });
    assertAttemptScope(scope, attemptReference);
    const row = await this.attempts.readScoped({
      attemptRef: attemptReference,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    if (row.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS') {
      throw new Error('OPENCLAW_OVERALL_RESUME_ACTION_MISMATCH');
    }
    if (
      row.status !== 'RUNNING' ||
      row.leaseOwner !== scope.principalId ||
      !row.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= new Date()
    ) {
      throw new Error('OPENCLAW_OVERALL_RESUME_ATTEMPT_NOT_RUNNING');
    }
    if (!row.taskEnvelopeJson) throw new Error('TASK_ENVELOPE_MISSING');
    const task = parseTaskEnvelope(row.taskEnvelopeJson);
    const storedInput = storedOverallInput(task.modelInput);
    return {
      attemptRef: attemptReference,
      leaseToken: row.leaseToken,
      leaseGeneration: row.leaseGeneration,
      leaseExpiresAt: row.leaseExpiresAt.toISOString(),
      task: structuredClone(task),
      selectedDiscoveryRefs: storedInput.selectedDiscoveryRefs,
      modelInput: storedInput.modelInput,
    };
  }

  async commit(
    attemptRef: string,
    leaseToken: string,
    leaseGeneration: number,
    resultEnvelope: unknown,
  ): Promise<Record<string, unknown> | ActionAttemptTerminalProjection> {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'COMMIT_OVERALL',
      attemptRef,
    });
    assertAttemptScope(scope, attemptRef);
    const preflightRow = await this.attempts.readScoped({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    const preflight = preflightCanonicalHostOpenClawResult({
      row: preflightRow,
      result: resultEnvelope,
    });
    assertAttemptBinding(
      scope,
      overallAttemptFromRow(preflightRow),
      attemptRef,
    );
    const prepared = await this.attempts.prepareCommit({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
      principalId: scope.principalId,
      leaseToken,
      leaseGeneration,
      result: preflight.result,
    });
    const attempt = overallAttemptFromRow(prepared.row);
    assertAttemptBinding(scope, attempt, attemptRef);
    const recovered = await this.recoverPreparedCommit(prepared);
    if (recovered) return recovered;
    if (prepared.row.status === 'SUCCEEDED') {
      throw new Error('OPENCLAW_OVERALL_SUCCEEDED_PROJECTION_MISSING');
    }
    if (prepared.row.status !== 'COMMITTING') {
      return this.attempts.projectTerminal(prepared.row);
    }
    if (prepared.result.status !== 'SUCCEEDED') {
      throw new Error('OPENCLAW_OVERALL_COMMITTING_RESULT_INVALID');
    }
    const workItem = await this.requiredBaseRules(
      prepared.row.workItemId,
      scope.tenantId,
    );
    if (workItem.revision !== prepared.task.baseRevision) {
      await this.attempts.finishProjectionConflict({
        prepared,
        currentRevision: workItem.revision,
      });
      throw new Error('WORK_ITEM_CAS_CONFLICT');
    }
    const actor = serviceActor(prepared.row.tenantId);
    if (prepared.row.actorUserId !== actor.userId) {
      throw new Error('OPENCLAW_OVERALL_SERVICE_ACTOR_MISMATCH');
    }
    const permissionSnapshotVersion = servicePermissionSnapshot(
      workItem,
      scope,
    );
    try {
      void permissionSnapshotVersion;
      const modelInput = storedOverallInput(
        prepared.task.modelInput,
      ).modelInput;
      let output: string;
      let parsed: ReturnType<typeof consumeOpenClawOverallSynthesisOutput>;
      try {
        output = requiredModelOutput(prepared.result);
        parsed = consumeOpenClawOverallSynthesisOutput(modelInput, output);
      } catch (error) {
        return this.attempts.finishResultGateFailure(prepared, error);
      }
      const persisted = await this.artifactStore.persistAndReadback(
        new TextEncoder().encode(output),
      );
      const baseRules = workItem.integratedAssessment!.baseRules;
      const overall: CanonicalOpenClawOverallProjection = {
        status: 'CANDIDATE_ONLY',
        revision: modelInput.selectiveResynthesis.targetOverallRevision,
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
      assertLatestOverallCandidate(modelInput.selectiveResynthesis, overall);
      const integratedAssessment: CanonicalIntegratedAssessmentProjection = {
        status: 'OVERALL_CANDIDATE_READY',
        baseRules,
        engineerReviews: workItem.integratedAssessment?.engineerReviews ?? null,
        overallSynthesis: overall,
        overallForAeoConfirmation: null,
      };
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: prepared.task.baseRevision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment,
          // A new overall candidate must be confirmed before it can seed AEO.
          // Do not keep displaying a candidate bound to an older synthesis.
          aeo: null,
        },
      });
      await this.attempts.finishProjectionSuccess(prepared);
      return {
        workItemId: updated.workItemId,
        workItemRevision: updated.revision,
        status: integratedAssessment.status,
        overallSynthesis: overall,
      };
    } catch (error) {
      const recovered = await this.recoverPreparedCommit(prepared);
      if (recovered) return recovered;
      throw error;
    }
  }

  private async recoverPreparedCommit(
    prepared: PreparedActionAttemptCommit,
  ): Promise<Record<string, unknown> | ActionAttemptTerminalProjection | null> {
    const workItem = await this.requiredBaseRules(
      prepared.row.workItemId,
      prepared.row.tenantId,
    );
    const attempt = overallAttemptFromRow(prepared.row);
    const committed = committedOverallResult(workItem, attempt);
    if (committed) {
      await this.attempts.finishProjectionSuccess(prepared);
      return committed;
    }
    if (
      prepared.row.status === 'COMMITTING' &&
      workItem.revision !== prepared.task.baseRevision
    ) {
      return this.attempts.finishProjectionConflict({
        prepared,
        currentRevision: workItem.revision,
      });
    }
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
    assertDynamicCandidateSummary(
      dynamicCandidate.summary,
      workItem,
      baseRules,
    );
    const sourceEvidenceCandidates =
      dynamicCandidate.overall.context.criterionCards.flatMap(
        (criterion) => criterion.sourceEvidenceCandidates,
      );
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
    tenantId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      workItemId,
      tenantId,
    });
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
}

function serviceActor(tenantId: string): CanonicalHostActor {
  if (!tenantId.trim()) throw new Error('OPENCLAW_OVERALL_TENANT_REQUIRED');
  return {
    userId: OPENCLAW_SERVICE_USER_ID,
    tenantId,
    appId: CANONICAL_APP_ID,
    roles: [],
    env: 'hosted',
  };
}

function servicePermissionSnapshot(
  workItem: CanonicalWorkItemProjection,
  scope: CanonicalVerifiedServiceScope,
): string {
  if (
    scope.workItemId !== workItem.workItemId ||
    !scope.authorizationFingerprint.trim()
  ) {
    throw openClawScopeNotFound();
  }
  return scope.authorizationFingerprint;
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
    throw openClawScopeNotFound();
  }
}
function assertAttemptScope(
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attemptRef: string,
): void {
  assertWorkItemScope(scope, scope.workItemId);
  if (scope.attemptRef !== attemptRef) throw openClawScopeNotFound();
}
function assertAttemptBinding(
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attempt: OverallSynthesisActionAttempt,
  attemptRef: string,
): void {
  if (
    attempt.workItemId !== scope.workItemId ||
    attempt.tenantId !== scope.tenantId ||
    attemptRef !== scope.attemptRef
  ) {
    throw openClawScopeNotFound();
  }
}

function overallAttempt(
  identity: NewActionAttemptIdentity,
  workItem: CanonicalWorkItemProjection,
  actor: CanonicalHostActor,
  providerCodes: string[],
): OverallSynthesisActionAttempt {
  return {
    attemptId: identity.attemptId,
    workItemId: workItem.workItemId,
    actionType: 'OPENCLAW_OVERALL_SYNTHESIS',
    attemptNo: workItem.revision,
    triggerRequestId: identity.triggerRequestId,
    requestOrigin: overallRequestOrigin(providerCodes),
    status: 'QUEUED',
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    packageArtifactRef: null,
    packageArtifactSha256: null,
    failureArtifactRef: null,
    failureArtifactSha256: null,
    createdAt: identity.createdAt,
  };
}

function overallAttemptFromRow(
  row: ActionAttemptRow,
): OverallSynthesisActionAttempt {
  if (row.actionType !== 'OPENCLAW_OVERALL_SYNTHESIS') {
    throw new Error('OPENCLAW_OVERALL_ACTION_TYPE_MISMATCH');
  }
  if (!row.taskEnvelopeJson) throw new Error('TASK_ENVELOPE_MISSING');
  const storedInput = storedOverallInput(
    parseTaskEnvelope(row.taskEnvelopeJson).modelInput,
  );
  return {
    attemptId: row.attemptId,
    workItemId: row.workItemId,
    actionType: 'OPENCLAW_OVERALL_SYNTHESIS',
    attemptNo: row.baseRevision ?? row.attemptNo,
    triggerRequestId: row.triggerRequestId,
    requestOrigin: overallRequestOrigin(storedInput.providerCodes),
    status: row.status,
    actorUserId: row.actorUserId,
    tenantId: row.tenantId,
    packageArtifactRef: null,
    packageArtifactSha256: null,
    failureArtifactRef: null,
    failureArtifactSha256: null,
    createdAt: row.createdAt,
  };
}

function overallRequestOrigin(providerCodes: string[]): string {
  return `OPENCLAW_OVR_${providerCodes.length === 0 ? 'NONE' : providerCodes.join('')}`;
}

function overallIdempotencyKey(
  workItem: CanonicalWorkItemProjection,
  providerCodes: string[],
): string {
  return [
    'openclaw-v1',
    'overall',
    workItem.workItemId,
    workItem.revision,
    providerCodes.length === 0 ? 'NONE' : providerCodes.join(''),
  ].join(':');
}

interface StoredOverallTaskInput {
  modelInput: OpenClawOverallSynthesisInput;
  selectedDiscoveryRefs: string[];
  providerCodes: string[];
}

function storedOverallInput(value: unknown): StoredOverallTaskInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OPENCLAW_OVERALL_TASK_INPUT_INVALID');
  }
  const record = value as Record<string, unknown>;
  if (
    !record.modelInput ||
    typeof record.modelInput !== 'object' ||
    Array.isArray(record.modelInput) ||
    !Array.isArray(record.selectedDiscoveryRefs) ||
    record.selectedDiscoveryRefs.some(
      (item) => typeof item !== 'string' || item.trim() === '',
    ) ||
    !Array.isArray(record.providerCodes) ||
    record.providerCodes.some(
      (item) => typeof item !== 'string' || !['A', 'B', 'C'].includes(item),
    )
  ) {
    throw new Error('OPENCLAW_OVERALL_TASK_INPUT_INVALID');
  }
  const modelInput = record.modelInput as Record<string, unknown>;
  if (
    modelInput.operation !== 'SYNTHESIZE_OVERALL_CANDIDATE' ||
    typeof modelInput.outputCorrelationRef !== 'string' ||
    !modelInput.outputCorrelationRef.trim()
  ) {
    throw new Error('OPENCLAW_OVERALL_TASK_INPUT_INVALID');
  }
  return {
    modelInput: modelInput as unknown as OpenClawOverallSynthesisInput,
    selectedDiscoveryRefs: [...record.selectedDiscoveryRefs] as string[],
    providerCodes: [...record.providerCodes] as string[],
  };
}

function requiredModelOutput(result: OpenClawResultEnvelope): string {
  if (
    typeof result.modelOutput !== 'string' ||
    result.modelOutput.trim() === ''
  ) {
    throw new Error('OPENCLAW_OVERALL_MODEL_OUTPUT_REQUIRED');
  }
  return result.modelOutput;
}

function openClawScopeNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}
function committedOverallResult(
  workItem: CanonicalWorkItemProjection,
  attempt: OverallSynthesisActionAttempt,
): Record<string, unknown> | null {
  const integrated = workItem.integratedAssessment;
  const overall = integrated?.overallSynthesis;
  if (!integrated || overall?.actionAttemptId !== attempt.attemptId)
    return null;
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
function serverContext(actor: CanonicalHostActor) {
  return {
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    roles: [] as string[],
  };
}
function providerCodesFor(providers: string[]): string[] {
  if (new Set(providers).size !== providers.length || providers.length > 3)
    throw new Error('OPENCLAW_OVERALL_PROVIDERS_INVALID');
  const codes = providers.map(
    (provider) => ({ AIRBUS: 'A', BOEING: 'B', COMAC: 'C' })[provider],
  );
  if (codes.some((code) => !code))
    throw new Error('OPENCLAW_OVERALL_PROVIDERS_INVALID');
  return codes as string[];
}
function providerCodesFromOrigin(origin: string): string[] {
  const value = origin.replace(/^OPENCLAW_OVR_/u, '');
  return value === 'NONE' ? [] : [...value];
}
function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('OPENCLAW_OVERALL_RESULT_TEXT_INVALID');
  return value;
}
function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredText(value);
}
function requiredCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error('OPENCLAW_OVERALL_RESULT_COUNT_INVALID');
  return Number(value);
}
function requiredTextArray(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.some(
      (item: unknown): boolean => typeof item !== 'string' || !item.trim(),
    )
  ) {
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
  if (!Array.isArray(value))
    throw new Error('OPENCLAW_OVERALL_RESULT_FINDINGS_INVALID');
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
function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
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
