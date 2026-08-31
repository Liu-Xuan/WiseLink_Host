import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalBaseRuleCandidateProjection,
  CanonicalIntegratedAssessmentProjection,
  CanonicalOpenClawOverallProjection,
  CanonicalWorkItemProjection,
} from '@shared/api.interface';
import { DynamicRulesEvaluationProcessor } from '../assessment-workbench/assessment-host-consumer.public-api';
import { serializeNormalizedBaseOneShotOutput } from '../assessment-workbench/base-one-shot-assessment.processor';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
import type {
  OpenClawDynamicRuleSetBinding,
  OpenClawDynamicTaskEnvelope,
  OpenClawDynamicTaskModelInput,
  OpenClawResultEnvelope,
  OpenClawTaskEnvelope,
} from '../action-attempt/action-attempt-envelope.types';
import type {
  ActionAttemptRow,
  ActionAttemptTerminalProjection,
  NewActionAttemptIdentity,
  PreparedActionAttemptCommit,
} from '../action-attempt/action-attempt.types';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import type { DynamicEvaluationActionAttempt } from '../work-item/miaoda-work-item.repository';
import { MiaodaDocumentVersionSourceResolver } from '../work-item/miaoda-document-version-source.resolver';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import { canonicalHostBareSha256 } from './canonical-host-sha256';
import {
  hostNativePdfAdapterIdFromDmPreflight,
  hostNativePdfClassificationFor,
  matchesHostNativePdfClassification,
} from './host-native-pdf-profile.registry';
import { preflightCanonicalHostOpenClawResult } from './canonical-host-openclaw-runtime-policy';
import { CanonicalHostAssessmentService } from './canonical-host-assessment.service';
import { CanonicalHostEngineerReviewService } from './canonical-host-engineer-review.service';
import {
  CanonicalRuleSetLifecycleService,
  type ActiveCanonicalRuleSetRuntime,
  type CanonicalRuleSetRuntime,
} from './canonical-rule-set-lifecycle.service';
import type {
  CanonicalHostActor,
  CanonicalWorkItemRegistrarPort,
} from './canonical-host.types';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';
const CANONICAL_APP_ID = 'app_17bzc551rsg';

export interface BeginDynamicEvaluationResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawDynamicTaskEnvelope;
  recoveryResult?: OpenClawResultEnvelope;
  modelInput: OpenClawDynamicTaskModelInput;
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
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly assessment: CanonicalHostAssessmentService,
    private readonly processor: DynamicRulesEvaluationProcessor,
    private readonly engineerReviews: CanonicalHostEngineerReviewService,
    private readonly attempts: ActionAttemptLifecycleService,
    private readonly ruleSets: CanonicalRuleSetLifecycleService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
    private readonly documentVersions: MiaodaDocumentVersionSourceResolver,
  ) {}

  async begin(workItemId: string): Promise<BeginDynamicEvaluationResult> {
    const scope = await this.serviceScope.authorizeOpenClawWorkItem({
      operation: 'BEGIN_DYNAMIC',
      workItemId,
    });
    assertWorkItemScope(scope, workItemId);
    const workItem = await this.requiredSbWorkItem(workItemId, scope.tenantId);
    const actor = serviceActor(scope.tenantId);
    const permissionSnapshotVersion = servicePermissionSnapshot(
      workItem,
      scope,
    );
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey: dynamicIdempotencyKey(workItem),
      sourceRefs: [
        {
          ref: workItem.package!.artifact.ref,
          sha256: workItem.package!.artifact.sha256,
        },
      ],
      buildModelInput: async (identity) => {
        // reserveAndClaim invokes this callback only for a genuinely new
        // attempt, before inserting it. Replays therefore never consult the
        // mutable ACTIVE head, while zero-head creation remains zero-write.
        const activeRuleSet: ActiveCanonicalRuleSetRuntime =
          await this.ruleSets.readActiveRuntime(actor.tenantId);
        const ruleSetBinding: OpenClawDynamicRuleSetBinding =
          dynamicRuleSetBinding(activeRuleSet);
        const request = await this.buildRequest(
          workItem,
          permissionSnapshotVersion,
          dynamicAttempt(identity, workItem, actor),
          activeRuleSet,
          ruleSetBinding,
        );
        return structuredClone(request.modelInput) as Record<string, unknown>;
      },
    });
    const task = parseDynamicTaskEnvelope(claim.task);
    const ruleSetBinding: OpenClawDynamicRuleSetBinding =
      parseDynamicRuleSetBinding(task.modelInput);
    const boundRuleSet: CanonicalRuleSetRuntime =
      await this.ruleSets.readRuntimeSnapshotAtActivation(
        actor.tenantId,
        ruleSetBinding.snapshotId,
        ruleSetBinding.activationRevision,
      );
    assertRuleSetBindingMatchesRuntime(ruleSetBinding, boundRuleSet);
    return {
      attemptRef: claim.attemptRef,
      status: claim.status,
      leaseToken: claim.leaseToken,
      leaseGeneration: claim.leaseGeneration,
      leaseExpiresAt: claim.leaseExpiresAt,
      task: structuredClone(task),
      ...(claim.status === 'COMMITTING'
        ? { recoveryResult: structuredClone(claim.recoveryResult) }
        : {}),
      modelInput: structuredClone(task.modelInput),
    };
  }

  async commit(
    attemptRef: string,
    leaseToken: string,
    leaseGeneration: number,
    resultEnvelope: unknown,
  ): Promise<CommitDynamicEvaluationResult | ActionAttemptTerminalProjection> {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'COMMIT_DYNAMIC',
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
    const ruleSetBinding: OpenClawDynamicRuleSetBinding =
      parseDynamicRuleSetBinding(preflight.task.modelInput);
    const boundRuleSet: CanonicalRuleSetRuntime =
      await this.ruleSets.readRuntimeSnapshotAtActivation(
        scope.tenantId,
        ruleSetBinding.snapshotId,
        ruleSetBinding.activationRevision,
      );
    assertRuleSetBindingMatchesRuntime(ruleSetBinding, boundRuleSet);
    assertAttemptBinding(
      scope,
      dynamicAttemptFromRow(preflightRow),
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
    const attempt = dynamicAttemptFromRow(prepared.row);
    assertAttemptBinding(scope, attempt, attemptRef);
    const recovered = await this.recoverPreparedCommit(prepared);
    if (recovered) return recovered;
    if (prepared.row.status === 'SUCCEEDED') {
      throw new Error('DYNAMIC_EVALUATION_SUCCEEDED_PROJECTION_MISSING');
    }
    if (prepared.row.status !== 'COMMITTING') {
      return this.attempts.projectTerminal(prepared.row);
    }
    if (prepared.result.status !== 'SUCCEEDED') {
      throw new Error('DYNAMIC_EVALUATION_COMMITTING_RESULT_INVALID');
    }
    const actor = serviceActor(prepared.row.tenantId);
    if (prepared.row.actorUserId !== actor.userId) {
      throw new Error('DYNAMIC_EVALUATION_SERVICE_ACTOR_MISMATCH');
    }
    const workItem = await this.requiredSbWorkItem(
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
    const permissionSnapshotVersion = servicePermissionSnapshot(
      workItem,
      scope,
    );
    try {
      const request = await this.buildRequest(
        workItem,
        permissionSnapshotVersion,
        attempt,
        boundRuleSet,
        ruleSetBinding,
      );
      if (
        canonicalJson(request.modelInput) !==
        canonicalJson(prepared.task.modelInput)
      ) {
        return this.attempts.finishResultGateFailure(
          prepared,
          new Error('DYNAMIC_EVALUATION_TASK_MODEL_INPUT_DRIFT'),
        );
      }
      let output: string;
      let result: ReturnType<DynamicRulesEvaluationProcessor['consumeOutput']>;
      let normalizedArtifactBytes: Uint8Array;
      try {
        output = requiredModelOutput(prepared.result);
        result = this.processor.consumeOutput(request, output);
        normalizedArtifactBytes = serializeNormalizedBaseOneShotOutput(
          output,
          result,
        );
      } catch (error) {
        return this.attempts.finishResultGateFailure(prepared, error);
      }
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
        expectedRevision: prepared.task.baseRevision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          integratedAssessment,
          // A candidate AEO is bound to the exact dynamic/overall artifact pair.
          // A new dynamic evaluation makes any previous authoring projection stale.
          aeo: null,
        },
      });
      await this.attempts.finishProjectionSuccess(prepared);
      return {
        workItemId: updated.workItemId,
        workItemRevision: updated.revision,
        status: integratedAssessment.status,
        baseRules,
      };
    } catch (error) {
      const recovered = await this.recoverPreparedCommit(prepared);
      if (recovered) return recovered;
      throw error;
    }
  }

  private async recoverPreparedCommit(
    prepared: PreparedActionAttemptCommit,
  ): Promise<
    CommitDynamicEvaluationResult | ActionAttemptTerminalProjection | null
  > {
    const workItem = await this.requiredSbWorkItem(
      prepared.row.workItemId,
      prepared.row.tenantId,
    );
    const attempt = dynamicAttemptFromRow(prepared.row);
    const committed = committedDynamicResult(workItem, attempt);
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

  private async buildRequest(
    workItem: CanonicalWorkItemProjection,
    permissionSnapshotVersion: string,
    attempt: DynamicEvaluationActionAttempt,
    ruleSet: CanonicalRuleSetRuntime,
    ruleSetBinding: OpenClawDynamicRuleSetBinding,
  ) {
    const timestamp = attempt.createdAt.toISOString();
    const candidate =
      await this.assessment.prepareDynamicRulesCandidateWithRuleSet(
        {
          workItem,
          tenantId: attempt.tenantId,
          permissionSnapshotVersion,
          assessmentAsOf: timestamp,
          generatedAt: timestamp,
          externalDiscovery: null,
          reviewedExternalManifest: null,
        },
        ruleSet,
      );
    const request = this.processor.buildRequest(
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
    return {
      ...request,
      modelInput: {
        ...request.modelInput,
        ruleSetBinding: structuredClone(ruleSetBinding),
      },
    };
  }

  private async requiredSbWorkItem(
    workItemId: string,
    tenantId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      workItemId,
      tenantId,
    });
    if (workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' || !workItem.package) {
      throw new Error('DYNAMIC_EVALUATION_PARSED_PACKAGE_NOT_READY');
    }
    if (workItem.classification.normalizedFamily !== 'SB') {
      throw new Error('DYNAMIC_EVALUATION_REQUIRES_CONFIRMED_SB');
    }
    if (workItem.classification.status === 'CONFIRMED') return workItem;
    return this.reconcileDmConfirmedSb(workItem, tenantId);
  }

  private async reconcileDmConfirmedSb(
    workItem: CanonicalWorkItemProjection,
    tenantId: string,
  ): Promise<CanonicalWorkItemProjection> {
    if (workItem.classification.status !== 'CANDIDATE') {
      throw new Error('DYNAMIC_EVALUATION_REQUIRES_CONFIRMED_SB');
    }
    const resolved = await this.documentVersions.resolve(
      workItem.source.documentVersionId,
      { requireCurrent: true },
    );
    const sourceDigest = canonicalHostBareSha256(
      workItem.source.sourceFileSha256,
    );
    const resolvedDigest = canonicalHostBareSha256(resolved.artifact.sha256);
    if (
      resolved.version.documentId !== workItem.source.documentId ||
      resolved.version.documentVersionId !==
        workItem.source.documentVersionId ||
      resolved.version.sourceArtifactId !== workItem.source.sourceArtifactId ||
      resolved.artifact.sourceArtifactId !== workItem.source.sourceArtifactId ||
      sourceDigest === null ||
      sourceDigest !== resolvedDigest ||
      Number(resolved.artifact.byteLength) !==
        workItem.source.sourceByteLength ||
      resolved.family.documentFamily !== 'SB'
    ) {
      throw new Error('DYNAMIC_EVALUATION_SB_SOURCE_BINDING_INVALID');
    }
    const confirmed = hostNativePdfClassificationFor({
      family: resolved.family.documentFamily,
      issuerAuthority: resolved.family.issuerAuthority,
      adapterId: hostNativePdfAdapterIdFromDmPreflight(resolved.preflight),
    });
    if (
      !confirmed ||
      confirmed.status !== 'CONFIRMED' ||
      confirmed.normalizedFamily !== 'SB' ||
      !matchesHostNativePdfClassification(
        {
          family: confirmed.normalizedFamily,
          parserProfileId: confirmed.parserProfileId,
          parserProfileHash: confirmed.parserProfileHash,
        },
        workItem.classification,
      )
    ) {
      throw new Error('DYNAMIC_EVALUATION_REQUIRES_CONFIRMED_SB');
    }
    const updated = await this.registrar.compareAndSet({
      workItemId: workItem.workItemId,
      expectedRevision: workItem.revision,
      syncPrimaryAttempt: false,
      next: {
        ...withoutRevision(workItem),
        classification: confirmed,
      },
    });
    if (
      updated.workItemId !== workItem.workItemId ||
      updated.revision !== workItem.revision + 1 ||
      updated.classification.status !== 'CONFIRMED' ||
      updated.classification.normalizedFamily !== 'SB'
    ) {
      throw new Error('DYNAMIC_EVALUATION_SB_CONFIRMATION_READBACK_INVALID');
    }
    const fresh = await this.registrar.getTenantScopedByWorkItemId({
      workItemId: updated.workItemId,
      tenantId,
    });
    if (
      fresh.revision !== updated.revision ||
      fresh.classification.status !== 'CONFIRMED' ||
      fresh.classification.parserProfileId !== confirmed.parserProfileId ||
      fresh.classification.parserProfileHash !== confirmed.parserProfileHash
    ) {
      throw new Error('DYNAMIC_EVALUATION_SB_CONFIRMATION_READBACK_INVALID');
    }
    return fresh;
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
  attempt: DynamicEvaluationActionAttempt,
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

function dynamicAttempt(
  identity: NewActionAttemptIdentity,
  workItem: CanonicalWorkItemProjection,
  actor: CanonicalHostActor,
): DynamicEvaluationActionAttempt {
  return {
    attemptId: identity.attemptId,
    workItemId: workItem.workItemId,
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    attemptNo: workItem.revision,
    triggerRequestId: identity.triggerRequestId,
    requestOrigin: 'OPENCLAW',
    status: 'QUEUED',
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    createdAt: identity.createdAt,
  };
}

function dynamicAttemptFromRow(
  row: ActionAttemptRow,
): DynamicEvaluationActionAttempt {
  if (row.actionType !== 'OPENCLAW_DYNAMIC_EVALUATION') {
    throw new Error('DYNAMIC_EVALUATION_ACTION_TYPE_MISMATCH');
  }
  return {
    attemptId: row.attemptId,
    workItemId: row.workItemId,
    actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    attemptNo: row.baseRevision ?? row.attemptNo,
    triggerRequestId: row.triggerRequestId,
    requestOrigin: 'OPENCLAW',
    status: row.status,
    actorUserId: row.actorUserId,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
  };
}

function dynamicIdempotencyKey(workItem: CanonicalWorkItemProjection): string {
  return [
    'openclaw-v1',
    'dynamic',
    workItem.workItemId,
    workItem.revision,
    workItem.package?.artifact?.sha256,
  ].join(':');
}

function dynamicRuleSetBinding(
  runtime: ActiveCanonicalRuleSetRuntime,
): OpenClawDynamicRuleSetBinding {
  return {
    schemaVersion: 'wiselink.3_1.dynamic_rule_set_binding.v1',
    snapshotId: runtime.snapshotId,
    criterionSetId: runtime.criterionSet.criterionSetId,
    criterionSetHash: runtime.criterionSet.criterionSetHash,
    memberIdentityHash: runtime.criterionSet.memberIdentityHash,
    criteriaCount: runtime.criterionSet.criteriaCount,
    rulePackVersion: runtime.rulePackVersion,
    artifactRef: runtime.artifactRef,
    artifactDigest: runtime.artifactDigest,
    artifactVersion: runtime.artifactVersion,
    activationRevision: runtime.headRevision,
  };
}

function parseDynamicRuleSetBinding(
  modelInput: Record<string, unknown>,
): OpenClawDynamicRuleSetBinding {
  const value = modelInput.ruleSetBinding;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('DYNAMIC_EVALUATION_RULE_SET_BINDING_REQUIRED');
  }
  const binding = value as Record<string, unknown>;
  if (
    binding.schemaVersion !== 'wiselink.3_1.dynamic_rule_set_binding.v1' ||
    !requiredBindingText(binding.snapshotId, 96) ||
    !requiredBindingText(binding.criterionSetId, 96) ||
    !requiredBindingText(binding.criterionSetHash, 71) ||
    !requiredBindingText(binding.memberIdentityHash, 71) ||
    !Number.isSafeInteger(binding.criteriaCount) ||
    Number(binding.criteriaCount) <= 0 ||
    !requiredBindingText(binding.rulePackVersion, 96) ||
    !requiredBindingText(binding.artifactRef, 4096) ||
    !requiredBindingText(binding.artifactDigest, 71) ||
    !requiredBindingText(binding.artifactVersion, 255) ||
    !Number.isSafeInteger(binding.activationRevision) ||
    Number(binding.activationRevision) <= 0
  ) {
    throw new Error('DYNAMIC_EVALUATION_RULE_SET_BINDING_INVALID');
  }
  return structuredClone(binding as unknown as OpenClawDynamicRuleSetBinding);
}

function parseDynamicTaskEnvelope(
  task: OpenClawTaskEnvelope,
): OpenClawDynamicTaskEnvelope {
  if (task.taskType !== 'OPENCLAW_DYNAMIC_EVALUATION') {
    throw new Error('DYNAMIC_EVALUATION_TASK_TYPE_MISMATCH');
  }
  parseDynamicRuleSetBinding(task.modelInput);
  return task as OpenClawDynamicTaskEnvelope;
}

function requiredBindingText(value: unknown, maxLength: number): boolean {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function assertRuleSetBindingMatchesRuntime(
  binding: OpenClawDynamicRuleSetBinding,
  runtime: CanonicalRuleSetRuntime,
): void {
  if (
    binding.snapshotId !== runtime.snapshotId ||
    binding.criterionSetId !== runtime.criterionSet.criterionSetId ||
    binding.criterionSetHash !== runtime.criterionSet.criterionSetHash ||
    binding.memberIdentityHash !== runtime.criterionSet.memberIdentityHash ||
    binding.criteriaCount !== runtime.criterionSet.criteriaCount ||
    binding.rulePackVersion !== runtime.rulePackVersion ||
    binding.artifactRef !== runtime.artifactRef ||
    binding.artifactDigest !== runtime.artifactDigest ||
    binding.artifactVersion !== runtime.artifactVersion
  ) {
    throw new Error('DYNAMIC_EVALUATION_RULE_SET_BINDING_MISMATCH');
  }
}

function requiredModelOutput(result: OpenClawResultEnvelope): string {
  if (
    typeof result.modelOutput !== 'string' ||
    result.modelOutput.trim() === ''
  ) {
    throw new Error('DYNAMIC_EVALUATION_MODEL_OUTPUT_REQUIRED');
  }
  return result.modelOutput;
}

function openClawScopeNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
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

function requiredCount(value: unknown, maximum: number, code: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > maximum
  ) {
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
