import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalReaderBilingualUnit,
  CanonicalTranslationCandidateProjection,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import { canonicalJson } from '../action-attempt/action-attempt-envelope';
import { ActionAttemptLifecycleService } from '../action-attempt/action-attempt-lifecycle.service';
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
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import { preflightCanonicalHostOpenClawResult } from './canonical-host-openclaw-runtime-policy';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';
import type { CanonicalTranslationConsumptionBinding } from './canonical-reader-consumption';
import {
  buildTranslationTaskContract,
  parseTranslationResultContract,
  validateTranslationResultContract,
  type TranslationCandidateUnit,
  type TranslationSourceUnit,
  type TranslationTaskContract,
  type TranslationValidationResult,
} from './canonical-translation-rule-contract';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
  HostOwnedV1TranslationRuleSetPrivateProvider,
} from './canonical-translation-rule-set-v1.private';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedOpenClawAttemptScope,
  type CanonicalVerifiedServiceScope,
} from './canonical-service-scope.authorization';

const CANONICAL_APP_ID = 'app_17bzc551rsg';
const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';
const SOURCE_LOCALE = 'en';
const TARGET_LOCALE = 'zh-CN';
const BILINGUAL_ARTIFACT_SCHEMA =
  'wiselink.3_1.bilingual_translation_artifact.v1';

interface TranslationAttempt {
  attemptId: string;
  workItemId: string;
  actionType: 'OPENCLAW_TRANSLATE';
  inputRevision: number;
  triggerRequestId: string;
  actorUserId: string;
  tenantId: string;
  createdAt: Date;
}

export interface BilingualTranslationArtifact {
  schemaVersion: typeof BILINGUAL_ARTIFACT_SCHEMA;
  candidateOnly: true;
  source: CanonicalTranslationConsumptionBinding;
  ruleSet: {
    ruleSetId: string;
    ruleSetVersion: string;
    sourceLocale: string;
    targetLocale: string;
  };
  units: CanonicalReaderBilingualUnit[];
  validation: TranslationValidationResult;
  execution: {
    actionAttemptId: string;
    operationRef: string;
    modelVersion: string;
    promptVersion: string;
    skillVersion: string;
    toolVersions: Record<string, string>;
    resultContentHash: string;
  };
}

export interface BeginTranslationResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
  recoveryResult?: OpenClawResultEnvelope;
}

export interface CommitTranslationResult {
  workItemId: string;
  workItemRevision: number;
  status: CanonicalTranslationCandidateProjection['status'];
  translation: CanonicalTranslationCandidateProjection;
}

@Injectable()
export class CanonicalHostOpenClawTranslationService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
    private readonly ruleSets: HostOwnedV1TranslationRuleSetPrivateProvider,
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  async begin(workItemId: string): Promise<BeginTranslationResult> {
    const scope = await this.serviceScope.authorizeOpenClawWorkItem({
      operation: 'BEGIN_TRANSLATE',
      workItemId,
    });
    assertWorkItemScope(scope, workItemId);
    const workItem = await this.requiredParsedWorkItem(
      workItemId,
      scope.tenantId,
    );
    assertTranslationNotCurrent(workItem);
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType: 'OPENCLAW_TRANSLATE',
      actorUserId: OPENCLAW_SERVICE_USER_ID,
      tenantId: scope.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey: translationIdempotencyKey(workItem),
      sourceRefs: [
        {
          ref: workItem.package!.artifact.ref,
          sha256: workItem.package!.artifact.sha256,
        },
      ],
      allowedConnectors: [],
      buildModelInput: async (_identity: NewActionAttemptIdentity) =>
        structuredClone(
          await this.buildTaskContract(workItem),
        ) as unknown as Record<string, unknown>,
    });
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
    };
  }

  async commit(
    attemptRef: string,
    leaseToken: string,
    leaseGeneration: number,
    resultEnvelope: unknown,
  ): Promise<CommitTranslationResult | ActionAttemptTerminalProjection> {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'COMMIT_TRANSLATE',
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
      translationAttemptFromRow(preflightRow),
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
    const attempt = translationAttemptFromRow(prepared.row);
    assertAttemptBinding(scope, attempt, attemptRef);
    const recovered = await this.recoverPreparedCommit(prepared);
    if (recovered) return recovered;
    if (prepared.row.status === 'SUCCEEDED') {
      throw new Error('TRANSLATION_SUCCEEDED_PROJECTION_MISSING');
    }
    if (prepared.row.status !== 'COMMITTING') {
      return this.attempts.projectTerminal(prepared.row);
    }
    if (prepared.result.status !== 'SUCCEEDED') {
      throw new Error('TRANSLATION_COMMITTING_RESULT_INVALID');
    }
    if (prepared.row.actorUserId !== OPENCLAW_SERVICE_USER_ID) {
      throw new Error('TRANSLATION_SERVICE_ACTOR_MISMATCH');
    }
    const workItem = await this.requiredParsedWorkItem(
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
    try {
      const taskContract = await this.buildTaskContract(workItem);
      if (
        canonicalJson(taskContract) !== canonicalJson(prepared.task.modelInput)
      ) {
        return this.attempts.finishResultGateFailure(
          prepared,
          new Error('TRANSLATION_TASK_MODEL_INPUT_DRIFT'),
        );
      }
      let parsedResult: ReturnType<typeof resultContract>;
      let validation: TranslationValidationResult;
      try {
        parsedResult = resultContract(prepared.result);
        validation = validateTranslationResultContract(parsedResult, {
          rulePack: taskContract.rulePack,
          rulePackId: taskContract.rulePack.meta.rulePackId,
          rulePackVersion: taskContract.rulePack.meta.rulePackVersion,
          sourceUnits: taskContract.sourceUnits,
          taskStartBinding: taskContract.taskStartBinding,
          validationTimeBinding: translationBinding(workItem),
        });
      } catch (error) {
        return this.attempts.finishResultGateFailure(prepared, error);
      }
      if (validation.verdict !== 'ACCEPTED') {
        return this.attempts.finishResultGateFailure(
          prepared,
          new Error(
            `TRANSLATION_RESULT_${validation.verdict}:${validation.findings
              .map((finding) => finding.code)
              .join(',')}`,
          ),
        );
      }
      const artifactValue = buildBilingualArtifact({
        task: taskContract,
        candidateUnits: parsedResult.candidateUnits,
        validation,
        result: prepared.result,
      });
      const artifactBytes = new TextEncoder().encode(
        canonicalJson(artifactValue),
      );
      const persisted =
        await this.artifactStore.persistAndReadback(artifactBytes);
      assertBilingualArtifactReadback(persisted.bytes, artifactValue);
      const translation = translationProjection({
        workItem,
        attempt,
        artifact: persisted.artifact,
        artifactValue,
      });
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: prepared.task.baseRevision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          translation,
        },
      });
      await this.attempts.finishProjectionSuccess(prepared);
      return {
        workItemId: updated.workItemId,
        workItemRevision: updated.revision,
        status: translation.status,
        translation,
      };
    } catch (error) {
      const recoveredAfterFailure = await this.recoverPreparedCommit(prepared);
      if (recoveredAfterFailure) return recoveredAfterFailure;
      throw error;
    }
  }

  private async recoverPreparedCommit(
    prepared: PreparedActionAttemptCommit,
  ): Promise<CommitTranslationResult | ActionAttemptTerminalProjection | null> {
    const workItem = await this.requiredParsedWorkItem(
      prepared.row.workItemId,
      prepared.row.tenantId,
    );
    const translation = workItem.translation;
    if (translation?.actionAttemptId === prepared.row.attemptId) {
      await this.attempts.finishProjectionSuccess(prepared);
      return {
        workItemId: workItem.workItemId,
        workItemRevision: workItem.revision,
        status: translation.status,
        translation,
      };
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

  private async buildTaskContract(
    workItem: CanonicalWorkItemProjection,
  ): Promise<TranslationTaskContract> {
    const sourceUnits = await this.reader.readAllSourceUnits({
      artifact: workItem.package!.artifact,
      packageId: workItem.package!.packageId,
    });
    if (
      sourceUnits.length !== workItem.package!.contentUnitCount ||
      sourceUnits.length === 0
    ) {
      throw new Error('TRANSLATION_SOURCE_UNIT_COUNT_MISMATCH');
    }
    const ruleSet = this.ruleSets.select({
      ruleSetId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      ruleSetVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
      sourceLocale: SOURCE_LOCALE,
      targetLocale: TARGET_LOCALE,
    });
    if (ruleSet === null) {
      throw new Error('TRANSLATION_RULE_SET_NOT_FOUND');
    }
    const task = buildTranslationTaskContract({
      sourceUnits: sourceUnits.map(toTranslationSourceUnit),
      rulePack: ruleSet,
      rulePackId: CANONICAL_TRANSLATION_RULE_SET_V1_ID,
      rulePackVersion: CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
      taskStartBinding: translationBinding(workItem),
    });
    if (task === null) {
      throw new Error('TRANSLATION_TASK_CONTRACT_INVALID');
    }
    return task;
  }

  private async requiredParsedWorkItem(
    workItemId: string,
    tenantId: string,
  ): Promise<CanonicalWorkItemProjection> {
    const workItem = await this.registrar.getTenantScopedByWorkItemId({
      workItemId,
      tenantId,
    });
    if (workItem.phase !== 'CANDIDATE_READBACK_VERIFIED' || !workItem.package) {
      throw new Error('TRANSLATION_PARSED_PACKAGE_NOT_READY');
    }
    if (
      workItem.package.contractId !== 'techpub.parsed-package.v1' ||
      workItem.package.contractRevision !== 'frozen.2'
    ) {
      throw new Error('TRANSLATION_FROZEN2_PACKAGE_REQUIRED');
    }
    return workItem;
  }
}

export function parseBilingualTranslationArtifact(
  bytes: Uint8Array,
): BilingualTranslationArtifact {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(text);
  const value: unknown = JSON.parse(text) as unknown;
  if (!isRecord(value) || value.schemaVersion !== BILINGUAL_ARTIFACT_SCHEMA) {
    throw new Error('BILINGUAL_TRANSLATION_ARTIFACT_SCHEMA_INVALID');
  }
  if (value.candidateOnly !== true || !Array.isArray(value.units)) {
    throw new Error('BILINGUAL_TRANSLATION_ARTIFACT_INVALID');
  }
  const units = value.units.map(parseBilingualUnit);
  return { ...(value as unknown as BilingualTranslationArtifact), units };
}

function resultContract(
  result: OpenClawResultEnvelope,
): NonNullable<ReturnType<typeof parseTranslationResultContract>> {
  if (typeof result.modelOutput !== 'string' || !result.modelOutput.trim()) {
    throw new Error('TRANSLATION_MODEL_OUTPUT_REQUIRED');
  }
  assertNoDuplicateJsonKeys(result.modelOutput);
  let raw: unknown;
  try {
    raw = JSON.parse(result.modelOutput) as unknown;
  } catch {
    throw new Error('TRANSLATION_MODEL_OUTPUT_JSON_INVALID');
  }
  assertTranslationResultExactShape(raw);
  const parsed = parseTranslationResultContract(raw);
  if (parsed === null) throw new Error('TRANSLATION_RESULT_CONTRACT_INVALID');
  return parsed;
}

function assertTranslationResultExactShape(value: unknown): void {
  if (!isRecord(value)) throw new Error('TRANSLATION_RESULT_CONTRACT_INVALID');
  assertExactKeys(value, [
    'schemaVersion',
    'rulePackId',
    'rulePackVersion',
    'taskStartBinding',
    'candidateUnits',
  ]);
  if (!Array.isArray(value.candidateUnits)) {
    throw new Error('TRANSLATION_RESULT_CONTRACT_INVALID');
  }
  value.candidateUnits.forEach((unit) => {
    if (!isRecord(unit)) throw new Error('TRANSLATION_RESULT_CONTRACT_INVALID');
    assertExactKeys(unit, [
      'unitKey',
      'text',
      'sourceRefIds',
      'engineerRevision',
    ]);
  });
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new Error('TRANSLATION_RESULT_CONTRACT_INVALID');
  }
}

function buildBilingualArtifact(input: {
  task: TranslationTaskContract;
  candidateUnits: readonly TranslationCandidateUnit[];
  validation: TranslationValidationResult;
  result: OpenClawResultEnvelope;
}): BilingualTranslationArtifact {
  const candidates = new Map(
    input.candidateUnits.map((unit) => [unit.unitKey, unit] as const),
  );
  return {
    schemaVersion: BILINGUAL_ARTIFACT_SCHEMA,
    candidateOnly: true,
    source: structuredClone(input.task.taskStartBinding),
    ruleSet: {
      ruleSetId: input.task.rulePack.meta.rulePackId,
      ruleSetVersion: input.task.rulePack.meta.rulePackVersion,
      sourceLocale: SOURCE_LOCALE,
      targetLocale: input.task.rulePack.meta.targetLocale,
    },
    units: input.task.sourceUnits.map((source) => {
      const candidate = candidates.get(source.unitKey);
      if (!candidate) throw new Error('TRANSLATION_ACCEPTED_UNIT_MISSING');
      return {
        unitId: source.unitKey,
        kind: source.kind,
        sourceText: source.text,
        translatedText: candidate.text,
        sourceRefIds: [...candidate.sourceRefIds],
        engineerRevisionId: candidate.engineerRevision?.revisionId ?? null,
      };
    }),
    validation: structuredClone(input.validation),
    execution: {
      actionAttemptId: input.result.actionAttemptId,
      operationRef: input.result.operationRef,
      modelVersion: input.result.modelVersion,
      promptVersion: input.result.promptVersion,
      skillVersion: input.result.skillVersion,
      toolVersions: structuredClone(input.result.toolVersions),
      resultContentHash: input.result.contentHash,
    },
  };
}

function translationProjection(input: {
  workItem: CanonicalWorkItemProjection;
  attempt: TranslationAttempt;
  artifact: UnifiedPackageArtifactDescriptor;
  artifactValue: BilingualTranslationArtifact;
}): CanonicalTranslationCandidateProjection {
  const { workItem, attempt, artifact, artifactValue } = input;
  return {
    schemaVersion: 'wiselink.3_1.translation_candidate_projection.v1',
    status: 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: `openclaw-translate://${attempt.triggerRequestId}`,
    actionAttemptId: attempt.attemptId,
    inputRevision: attempt.inputRevision,
    documentId: workItem.source.documentId,
    documentVersionId: workItem.source.documentVersionId,
    sourcePackageId: workItem.package!.packageId,
    sourcePackageContentHash: workItem.package!.contentHash,
    ruleSetId: artifactValue.ruleSet.ruleSetId,
    ruleSetVersion: artifactValue.ruleSet.ruleSetVersion,
    sourceLocale: artifactValue.ruleSet.sourceLocale,
    targetLocale: artifactValue.ruleSet.targetLocale,
    sourceUnitCount: artifactValue.units.length,
    translatedUnitCount: artifactValue.units.length,
    pendingTranslationUnitCount: 0,
    sourceRefCount: workItem.package!.sourceRefCount,
    engineerRevisionCount: artifactValue.units.filter(
      (unit) => unit.engineerRevisionId !== null,
    ).length,
    validationVerdict: 'ACCEPTED',
    validationFindingCount: artifactValue.validation.findings.length,
    artifact,
  };
}

function assertBilingualArtifactReadback(
  bytes: Uint8Array,
  expected: BilingualTranslationArtifact,
): void {
  const actual = parseBilingualTranslationArtifact(bytes);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error('BILINGUAL_TRANSLATION_ARTIFACT_READBACK_MISMATCH');
  }
}

function parseBilingualUnit(value: unknown): CanonicalReaderBilingualUnit {
  if (!isRecord(value) || !Array.isArray(value.sourceRefIds)) {
    throw new Error('BILINGUAL_TRANSLATION_UNIT_INVALID');
  }
  const unit: CanonicalReaderBilingualUnit = {
    unitId: requiredText(value.unitId, 'BILINGUAL_UNIT_ID_REQUIRED'),
    kind: requiredText(value.kind, 'BILINGUAL_UNIT_KIND_REQUIRED'),
    sourceText: requiredText(
      value.sourceText,
      'BILINGUAL_UNIT_SOURCE_TEXT_REQUIRED',
    ),
    translatedText: requiredText(
      value.translatedText,
      'BILINGUAL_UNIT_TRANSLATED_TEXT_REQUIRED',
    ),
    sourceRefIds: value.sourceRefIds.map((sourceRef) =>
      requiredText(sourceRef, 'BILINGUAL_UNIT_SOURCE_REF_REQUIRED'),
    ),
    engineerRevisionId:
      value.engineerRevisionId === null
        ? null
        : requiredText(
            value.engineerRevisionId,
            'BILINGUAL_UNIT_ENGINEER_REVISION_INVALID',
          ),
  };
  if (unit.sourceRefIds.length === 0) {
    throw new Error('BILINGUAL_UNIT_SOURCE_REF_REQUIRED');
  }
  return unit;
}

function toTranslationSourceUnit(
  unit: UnifiedReaderQueryResult,
): TranslationSourceUnit {
  return {
    unitKey: unit.unitId,
    kind: translationUnitKind(unit.kind),
    text: unit.text,
    sourceRefIds: [...unit.sourceRefIds],
  };
}

function translationUnitKind(value: string): TranslationSourceUnit['kind'] {
  const allowed = new Set<TranslationSourceUnit['kind']>([
    'paragraph',
    'heading',
    'text_block',
    'table',
    'preserved_source',
    'step',
    'list_item',
    'warning',
    'caution',
    'note',
    'figure',
  ]);
  if (!allowed.has(value as TranslationSourceUnit['kind'])) {
    throw new Error(`TRANSLATION_SOURCE_UNIT_KIND_UNSUPPORTED:${value}`);
  }
  return value as TranslationSourceUnit['kind'];
}

function translationBinding(
  workItem: CanonicalWorkItemProjection,
): CanonicalTranslationConsumptionBinding | null {
  if (!workItem.package) return null;
  return {
    documentId: workItem.source.documentId,
    revisionId: workItem.source.documentVersionId,
    sbdPackageId: workItem.package.packageId,
    sbdContentHash: workItem.package.contentHash,
    tcpPackageId: null,
    tcpContentHash: null,
  };
}

function translationIdempotencyKey(
  workItem: CanonicalWorkItemProjection,
): string {
  return [
    'openclaw-v1',
    'translate',
    workItem.workItemId,
    workItem.revision,
    workItem.package!.artifact.sha256,
    CANONICAL_TRANSLATION_RULE_SET_V1_ID,
    CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
  ].join(':');
}

function translationAttemptFromRow(row: ActionAttemptRow): TranslationAttempt {
  if (row.actionType !== 'OPENCLAW_TRANSLATE') {
    throw new Error('TRANSLATION_ACTION_TYPE_MISMATCH');
  }
  if (row.inputRevision === null) {
    throw new Error('TRANSLATION_INPUT_REVISION_MISSING');
  }
  return {
    attemptId: row.attemptId,
    workItemId: row.workItemId,
    actionType: 'OPENCLAW_TRANSLATE',
    inputRevision: row.inputRevision,
    triggerRequestId: row.triggerRequestId,
    actorUserId: row.actorUserId,
    tenantId: row.tenantId,
    createdAt: row.createdAt,
  };
}

function assertTranslationNotCurrent(
  workItem: CanonicalWorkItemProjection,
): void {
  const translation = workItem.translation;
  if (
    translation?.status === 'CANDIDATE_ONLY' &&
    translation.currentness === 'CURRENT' &&
    translation.documentVersionId === workItem.source.documentVersionId &&
    translation.sourcePackageId === workItem.package!.packageId &&
    translation.sourcePackageContentHash === workItem.package!.contentHash &&
    translation.ruleSetId === CANONICAL_TRANSLATION_RULE_SET_V1_ID &&
    translation.ruleSetVersion === CANONICAL_TRANSLATION_RULE_SET_V1_VERSION
  ) {
    throw new Error('TRANSLATION_ALREADY_CURRENT');
  }
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
    throw scopeNotFound();
  }
}

function assertAttemptScope(
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attemptRef: string,
): void {
  assertWorkItemScope(scope, scope.workItemId);
  if (scope.attemptRef !== attemptRef) throw scopeNotFound();
}

function assertAttemptBinding(
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attempt: TranslationAttempt,
  attemptRef: string,
): void {
  if (
    attempt.workItemId !== scope.workItemId ||
    attempt.tenantId !== scope.tenantId ||
    attemptRef !== scope.attemptRef
  ) {
    throw scopeNotFound();
  }
}

function scopeNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}
