import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  ActivateCanonicalRuleSetSnapshotRequest,
  ActivateCanonicalRuleSetSnapshotResponse,
  CanonicalRuleSetActivationReadModel,
  CanonicalRuleSetLifecycleReadModel,
  CanonicalRuleSetSnapshotReadModel,
  CreateCanonicalRuleSetSnapshotRequest,
  CreateCanonicalRuleSetSnapshotResponse,
} from '@shared/api.interface';
import {
  buildJobAidCriterionSetVersion,
  hashExecutableCriterionList,
} from '../assessment-workbench/job-aid-runtime/criterionSet.js';
import { validateJobAidRulePack } from '../assessment-workbench/job-aid-runtime/rulePack.js';
import {
  CANONICAL_DEVELOPMENT_ROLE_ID,
  CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV,
} from './canonical-host.constants';
import type { CanonicalHostActor } from './canonical-host.types';
import { CanonicalRuleSetArtifactReader } from './canonical-rule-set-artifact.reader';
import {
  CANONICAL_JOB_AID_RULE_SET_KEY,
  CanonicalRuleSetLifecycleRepository,
  type StoredCanonicalRuleSetActivation,
  type StoredCanonicalRuleSetRuntime,
  type StoredCanonicalRuleSetSnapshot,
} from './canonical-rule-set-lifecycle.repository';

interface JobAidRulePack {
  package_meta?: { schema_version?: unknown };
  criteria: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface CriterionSetVersionRuntime {
  criterionSetId: string;
  criterionSetHash: string;
  memberIdentityHash: string;
  criteriaCount: number;
  lifecycleStatus: 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';
  [key: string]: unknown;
}

interface ActiveCriterionSetRuntime extends CriterionSetVersionRuntime {
  lifecycleStatus: 'ACTIVE';
}

export interface ActiveCanonicalRuleSetRuntime {
  snapshotId: string;
  headRevision: number;
  rulePack: Record<string, unknown>;
  rulePackHash: string;
  criterionSet: ActiveCriterionSetRuntime;
}

@Injectable()
export class CanonicalRuleSetLifecycleService {
  constructor(
    private readonly repository: CanonicalRuleSetLifecycleRepository,
    private readonly artifacts: CanonicalRuleSetArtifactReader,
  ) {}

  async createSnapshot(
    input: CreateCanonicalRuleSetSnapshotRequest,
    actor: CanonicalHostActor,
  ): Promise<CreateCanonicalRuleSetSnapshotResponse> {
    assertEngineeringOwner(actor);
    const selection = ruleSetSelection(input);
    const artifact = await this.artifacts.read(selection);
    const rulePackJson: string = decodeRulePack(artifact.bytes);
    const expectedDigest: string = digestRulePack(artifact.bytes);
    if (artifact.artifactDigest !== expectedDigest) {
      throw lifecycleError('RULE_SET_ARTIFACT_DIGEST_MISMATCH', 409);
    }
    const rulePack: JobAidRulePack = parseRulePack(rulePackJson);
    const identity = buildCandidateRuntimeIdentity(rulePack, artifact);
    const created = await this.repository.createSnapshot({
      tenantId: actor.tenantId,
      criterionSetId: identity.criterionSet.criterionSetId,
      criterionSetHash: identity.criterionSet.criterionSetHash,
      memberIdentityHash: identity.criterionSet.memberIdentityHash,
      criteriaCount: identity.criterionSet.criteriaCount,
      rulePackVersion: identity.rulePackVersion,
      rulePackJson,
      artifactRef: artifact.artifactRef,
      artifactDigest: artifact.artifactDigest,
      artifactVersion: artifact.artifactVersion,
      canonicalCriteriaHash: identity.canonicalCriteriaHash,
      sourceJobAidDocumentVersionId: null,
      sourceJobAidVersionStatus: 'VERSION_UNCONFIRMED',
      createdByEngineeringOwnerUserId: actor.userId,
    });
    const lifecycle = await this.readModel(actor.tenantId);
    const snapshot = lifecycle.snapshots.find(
      (candidate: CanonicalRuleSetSnapshotReadModel): boolean =>
        candidate.snapshotId === created.snapshot.criterionSetId,
    );
    if (!snapshot)
      throw lifecycleError('RULE_SET_SNAPSHOT_READBACK_FAILED', 500);
    return { snapshot, lifecycle, replayed: created.replayed };
  }

  async promote(
    input: ActivateCanonicalRuleSetSnapshotRequest,
    actor: CanonicalHostActor,
  ): Promise<ActivateCanonicalRuleSetSnapshotResponse> {
    return this.activate('PROMOTE', input, actor);
  }

  async rollback(
    input: ActivateCanonicalRuleSetSnapshotRequest,
    actor: CanonicalHostActor,
  ): Promise<ActivateCanonicalRuleSetSnapshotResponse> {
    return this.activate('ROLLBACK', input, actor);
  }

  async read(
    actor: CanonicalHostActor,
  ): Promise<CanonicalRuleSetLifecycleReadModel> {
    assertEngineeringOwner(actor);
    return this.readModel(actor.tenantId);
  }

  async readActiveRuntime(
    tenantIdValue: string,
  ): Promise<ActiveCanonicalRuleSetRuntime> {
    const tenantId: string = requiredText(
      tenantIdValue,
      'RULE_SET_TENANT_ID_REQUIRED',
      128,
    );
    const current = await this.repository.currentActivation(tenantId);
    if (!current)
      throw lifecycleError('RULE_SET_ACTIVE_SNAPSHOT_REQUIRED', 503);
    const snapshot = await this.repository.getSnapshot(
      tenantId,
      current.activeCriterionSetId,
    );
    if (!snapshot)
      throw lifecycleError('RULE_SET_ACTIVE_SNAPSHOT_MISSING', 500);
    const runtime = verifyRuntimeSnapshot(snapshot);
    return {
      snapshotId: snapshot.criterionSetId,
      headRevision: current.activationRevision,
      rulePack: runtime.rulePack,
      rulePackHash: snapshot.artifactDigest.slice('sha256:'.length),
      criterionSet: runtime.criterionSet,
    };
  }

  private async activate(
    action: 'PROMOTE' | 'ROLLBACK',
    input: ActivateCanonicalRuleSetSnapshotRequest,
    actor: CanonicalHostActor,
  ): Promise<ActivateCanonicalRuleSetSnapshotResponse> {
    const requiredRoleId: string = assertEngineeringOwner(actor);
    const targetSnapshotId: string = requiredText(
      input.targetSnapshotId,
      'RULE_SET_TARGET_SNAPSHOT_REQUIRED',
      96,
    );
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    ) {
      throw lifecycleError('RULE_SET_EXPECTED_REVISION_INVALID', 400);
    }
    const reason: string = requiredText(
      input.reason,
      'RULE_SET_ACTIVATION_REASON_REQUIRED',
      1000,
    );
    const target = await this.repository.getSnapshot(
      actor.tenantId,
      targetSnapshotId,
    );
    if (!target) throw lifecycleError('RULE_SET_SNAPSHOT_NOT_FOUND', 404);
    verifyRuntimeSnapshot(target);
    const activation = await this.repository.appendActivation({
      tenantId: actor.tenantId,
      targetCriterionSetId: targetSnapshotId,
      expectedRevision: input.expectedRevision,
      action,
      engineeringOwnerUserId: actor.userId,
      requiredRoleId,
      reason,
    });
    return {
      activation: activationReadModel(activation),
      lifecycle: await this.readModel(actor.tenantId),
    };
  }

  private async readModel(
    tenantId: string,
  ): Promise<CanonicalRuleSetLifecycleReadModel> {
    // Activation targets are immutable snapshots. Reading the ledger first
    // guarantees that every current/rollback target is visible in the later
    // snapshot read, even while another owner is creating and promoting.
    const activations = await this.repository.listActivations(tenantId);
    const snapshots = await this.repository.listSnapshots(tenantId);
    const current = activations[0] ?? null;
    const previouslyActiveIds: Set<string> = new Set(
      activations.map(
        (activation: StoredCanonicalRuleSetActivation): string =>
          activation.activeCriterionSetId,
      ),
    );
    return {
      schemaVersion: 'wiselink.3_1.rule_set_lifecycle.v1_1.candidate',
      ruleSetKey: CANONICAL_JOB_AID_RULE_SET_KEY,
      headRevision: current?.activationRevision ?? 0,
      activeSnapshotId: current?.activeCriterionSetId ?? null,
      snapshots: snapshots.map((snapshot: StoredCanonicalRuleSetSnapshot) =>
        snapshotReadModel(
          snapshot,
          current?.activeCriterionSetId ?? null,
          previouslyActiveIds,
        ),
      ),
      rollbackCandidates: [...previouslyActiveIds]
        .filter(
          (snapshotId: string): boolean =>
            snapshotId !== current?.activeCriterionSetId,
        )
        .map((targetSnapshotId: string) => ({
          targetSnapshotId,
          expectedRevision: current?.activationRevision ?? 0,
        })),
      activations: activations.map(activationReadModel),
      authority: {
        currentOwner: 'CANONICAL_HOST',
        currentCasEnforced: true,
        activationAuditAppendOnly: true,
        requiresExplicitEngineeringOwner: true,
        aiMayPromote: false,
        providerMayPromote: false,
        publishesEngineeringApproval: false,
      },
    };
  }
}

function verifyRuntimeSnapshot(snapshot: StoredCanonicalRuleSetRuntime): {
  rulePack: Record<string, unknown>;
  criterionSet: ActiveCriterionSetRuntime;
} {
  const bytes: Uint8Array = new TextEncoder().encode(snapshot.rulePackJson);
  if (digestRulePack(bytes) !== snapshot.artifactDigest) {
    throw lifecycleError('RULE_SET_STORED_PAYLOAD_DIGEST_MISMATCH', 500);
  }
  const rulePack: JobAidRulePack = parseRulePack(snapshot.rulePackJson, 500);
  let validation: { rulePackVersion: string };
  let canonicalCriteriaHash: string;
  let criterionSet: ActiveCriterionSetRuntime;
  try {
    validation = validateJobAidRulePack(rulePack);
    canonicalCriteriaHash = hashExecutableCriterionList(rulePack.criteria);
    criterionSet = buildJobAidCriterionSetVersion({
      rulePack,
      artifactRef: snapshot.artifactRef,
      artifactDigest: snapshot.artifactDigest,
      artifactVersion: snapshot.artifactVersion,
      canonicalCriteriaHash,
      sourceJobAidDocumentVersionId: snapshot.sourceJobAidDocumentVersionId,
      sourceJobAidDocumentVersionStatus: snapshot.sourceJobAidVersionStatus,
      lifecycleStatus: 'ACTIVE',
    }) as ActiveCriterionSetRuntime;
  } catch {
    throw lifecycleError('RULE_SET_STORED_PAYLOAD_INVALID', 500);
  }
  if (
    validation.rulePackVersion !== snapshot.rulePackVersion ||
    canonicalCriteriaHash !== snapshot.canonicalCriteriaHash
  ) {
    throw lifecycleError('RULE_SET_STORED_PAYLOAD_IDENTITY_MISMATCH', 500);
  }
  if (
    criterionSet.criterionSetId !== snapshot.criterionSetId ||
    criterionSet.criterionSetHash !== snapshot.criterionSetHash ||
    criterionSet.memberIdentityHash !== snapshot.memberIdentityHash ||
    criterionSet.criteriaCount !== snapshot.criteriaCount
  ) {
    throw lifecycleError('RULE_SET_STORED_CRITERION_SET_MISMATCH', 500);
  }
  return { rulePack, criterionSet };
}

function snapshotReadModel(
  snapshot: StoredCanonicalRuleSetSnapshot,
  activeSnapshotId: string | null,
  previouslyActiveIds: ReadonlySet<string>,
): CanonicalRuleSetSnapshotReadModel {
  const lifecycleStatus =
    snapshot.criterionSetId === activeSnapshotId
      ? 'ACTIVE'
      : previouslyActiveIds.has(snapshot.criterionSetId)
        ? 'SUPERSEDED'
        : 'DRAFT';
  return {
    snapshotId: snapshot.criterionSetId,
    lifecycleStatus,
    rulePackVersion: snapshot.rulePackVersion,
    criterionSetId: snapshot.criterionSetId,
    criterionSetHash: snapshot.criterionSetHash,
    memberIdentityHash: snapshot.memberIdentityHash,
    criteriaCount: snapshot.criteriaCount,
    artifact: {
      ref: snapshot.artifactRef,
      digest: snapshot.artifactDigest,
      version: snapshot.artifactVersion,
    },
    canonicalCriteriaHash: snapshot.canonicalCriteriaHash,
    sourceJobAidDocumentVersion: {
      documentVersionId: snapshot.sourceJobAidDocumentVersionId,
      status: snapshot.sourceJobAidVersionStatus,
    },
    createdByEngineeringOwnerUserId: snapshot.createdByEngineeringOwnerUserId,
    createdAt: snapshot.createdAt.toISOString(),
  };
}

function activationReadModel(
  activation: StoredCanonicalRuleSetActivation,
): CanonicalRuleSetActivationReadModel {
  return {
    activationId: activation.activationId,
    revision: activation.activationRevision,
    action: activation.action,
    fromSnapshotId: activation.fromCriterionSetId,
    activeSnapshotId: activation.activeCriterionSetId,
    engineeringOwnerUserId: activation.engineeringOwnerUserId,
    requiredRoleId: activation.requiredRoleId,
    reason: activation.reason,
    activatedAt: activation.activatedAt.toISOString(),
  };
}

function assertEngineeringOwner(actor: CanonicalHostActor): string {
  const requiredRoleId: string = requiredEngineeringOwnerRoleId();
  const identity = actor.objectAccessActor;
  if (
    !identity ||
    identity.principalKind !== 'FINAL_USER' ||
    identity.transport !== 'MIAODA_AUTHENTICATED_HTTP' ||
    identity.canonicalSubject.id !== actor.userId ||
    identity.tenantId !== actor.tenantId ||
    identity.applicationScopeId !== actor.appId ||
    !identity.platformRoles.includes(requiredRoleId) ||
    !actor.roles.includes(requiredRoleId)
  ) {
    throw lifecycleError('RULE_SET_ENGINEERING_OWNER_REQUIRED', 403);
  }
  return requiredRoleId;
}

function requiredEngineeringOwnerRoleId(): string {
  const roleId: string = requiredText(
    process.env[CANONICAL_RULE_SET_ENGINEERING_OWNER_ROLE_ENV],
    'RULE_SET_ENGINEERING_OWNER_ROLE_NOT_CONFIGURED',
    96,
    503,
  );
  if (roleId === CANONICAL_DEVELOPMENT_ROLE_ID) {
    throw lifecycleError('RULE_SET_ENGINEERING_OWNER_ROLE_NOT_DEDICATED', 503);
  }
  return roleId;
}

function ruleSetSelection(input: CreateCanonicalRuleSetSnapshotRequest): {
  bucketId: string;
  filePath: string;
} {
  if (!input || typeof input !== 'object' || !input.selection) {
    throw lifecycleError('RULE_SET_ARTIFACT_SELECTION_REQUIRED', 400);
  }
  return {
    bucketId: requiredText(
      input.selection.bucketId,
      'RULE_SET_BUCKET_ID_REQUIRED',
      255,
    ),
    filePath: requiredText(
      input.selection.filePath,
      'RULE_SET_FILE_PATH_REQUIRED',
      1024,
    ),
  };
}

function decodeRulePack(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf8', { fatal: true }).decode(bytes);
  } catch {
    throw lifecycleError('RULE_SET_ARTIFACT_UTF8_INVALID', 400);
  }
}

function buildCandidateRuntimeIdentity(
  rulePack: JobAidRulePack,
  artifact: {
    artifactRef: string;
    artifactDigest: string;
    artifactVersion: string;
  },
): {
  rulePackVersion: string;
  canonicalCriteriaHash: string;
  criterionSet: CriterionSetVersionRuntime;
} {
  try {
    const validation = validateJobAidRulePack(rulePack);
    const canonicalCriteriaHash: string = hashExecutableCriterionList(
      rulePack.criteria,
    );
    return {
      rulePackVersion: validation.rulePackVersion,
      canonicalCriteriaHash,
      criterionSet: buildJobAidCriterionSetVersion({
        rulePack,
        artifactRef: artifact.artifactRef,
        artifactDigest: artifact.artifactDigest,
        artifactVersion: artifact.artifactVersion,
        canonicalCriteriaHash,
        sourceJobAidDocumentVersionStatus: 'VERSION_UNCONFIRMED',
        lifecycleStatus: 'DRAFT',
      }) as CriterionSetVersionRuntime,
    };
  } catch {
    throw lifecycleError('RULE_SET_ARTIFACT_RULE_PACK_INVALID', 400);
  }
}

function parseRulePack(value: string, statusCode = 400): JobAidRulePack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw lifecycleError('RULE_SET_ARTIFACT_JSON_INVALID', statusCode);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw lifecycleError('RULE_SET_ARTIFACT_JSON_INVALID', statusCode);
  }
  return parsed as JobAidRulePack;
}

function digestRulePack(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function requiredText(
  value: unknown,
  code: string,
  maxLength: number,
  statusCode = 400,
): string {
  if (typeof value !== 'string') throw lifecycleError(code, statusCode);
  const normalized: string = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw lifecycleError(code, statusCode);
  }
  return normalized;
}

function lifecycleError(
  code: string,
  statusCode: number,
): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode });
}
