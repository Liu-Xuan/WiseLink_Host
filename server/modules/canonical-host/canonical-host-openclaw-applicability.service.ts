import { Inject, Injectable } from '@nestjs/common';

import type {
  CanonicalApplicabilityCandidateProjection,
  CanonicalApplicabilityInputProjection,
  CanonicalReaderBilingualUnit,
  CanonicalWorkItemProjection,
  UnifiedPackageArtifactDescriptor,
  UnifiedReaderQueryResult,
} from '@shared/api.interface';
import {
  canonicalJson,
  canonicalSha256,
  parseResultEnvelope,
  parseTaskEnvelope,
} from '../action-attempt/action-attempt-envelope';
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
import {
  UNKNOWN,
  evaluateApplicabilityFragmentSetWithTrace,
  type ApplicabilityFragment,
  type BlockingUnknown,
} from '../assessment-workbench/applicability-fleet/applicabilityKleeneEngine';
import {
  FLEET_MASTER_DATA_SCHEMA_VERSION,
  resolveFleetSnapshot,
  type FleetMasterDataSource,
  type FleetSnapshotResolution,
} from '../assessment-workbench/applicability-fleet/fleetMasterData';
import { UNIFIED_ARTIFACT_STORE } from '../unified-reader/unified-reader.constants';
import { UnifiedReaderService } from '../unified-reader/unified-reader.service';
import type { UnifiedArtifactStorePort } from '../unified-reader/unified-reader.types';
import { assertNoDuplicateJsonKeys } from '../unified-reader/unified-reader.utils';
import {
  APPLICABILITY_ARTIFACT_SCHEMA_VERSION,
  APPLICABILITY_MCP_SERVER_NAME,
  APPLICABILITY_MCP_SERVER_VERSION,
  APPLICABILITY_MODEL_VERSION,
  APPLICABILITY_PROMPT_VERSION,
  APPLICABILITY_SKILL_VERSION,
  APPLICABILITY_TASK_SCHEMA_VERSION,
  applicabilityRuntimePolicy,
  parseApplicabilityCandidate,
  validateApplicabilityCandidateBinding,
  type ApplicabilityCandidateContract,
  type ApplicabilityTaskContract,
  type ApplicabilityTaskSourceExpression,
} from './canonical-host-openclaw-applicability.contract';
import { parseBilingualTranslationArtifact } from './canonical-host-openclaw-translation.service';
import {
  CANONICAL_TRANSLATION_RULE_SET_V1_ID,
  CANONICAL_TRANSLATION_RULE_SET_V1_VERSION,
} from './canonical-translation-rule-set-v1.private';
import { CANONICAL_WORK_ITEM_REGISTRAR } from './canonical-host.constants';
import type { CanonicalWorkItemRegistrarPort } from './canonical-host.types';
import {
  CANONICAL_SERVICE_SCOPE_AUTHORIZATION,
  type CanonicalServiceScopeAuthorizationPort,
  type CanonicalVerifiedApplicabilityContextScope,
  type CanonicalVerifiedOpenClawAttemptScope,
} from './canonical-service-scope.authorization';

const CANONICAL_APP_ID = 'app_17bzc551rsg';
const OPENCLAW_SERVICE_USER_ID = 'service:openclaw-main';

interface ApplicabilityTaskBuild {
  contract: ApplicabilityTaskContract;
  missingInputs: OpenClawTaskEnvelope['hostResolvedMissingInputs'];
  sourceRefs: OpenClawTaskEnvelope['sourceRefs'];
  fleetSource: FleetMasterDataSource;
}

interface ApplicabilityEvaluation {
  status: 'EVALUATED' | 'WAITING_INPUT';
  decision: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNKNOWN';
  kleeneResult: true | false | typeof UNKNOWN;
  pass: boolean;
  blockingUnknowns: BlockingUnknown[];
  fleetResolution: FleetSnapshotResolution;
}

interface ApplicabilityCandidateArtifact {
  schemaVersion: typeof APPLICABILITY_ARTIFACT_SCHEMA_VERSION;
  candidateOnly: true;
  source: {
    documentId: string;
    documentVersionId: string;
    packageId: string;
    packageContentHash: string;
    translationActionAttemptId: string;
    applicabilityContextRef: string;
    applicabilityBindingRevision: string;
  };
  candidate: ApplicabilityCandidateContract;
  evaluation: ApplicabilityEvaluation;
  execution: {
    actionAttemptId: string;
    operationRef: string;
    resultContentHash: string;
    modelVersion: string;
    promptVersion: string;
    skillVersion: string;
    toolVersions: Record<string, string>;
  };
  authority: {
    createsEvidenceRef: false;
    createsClosureDecision: false;
    createsActionReadiness: false;
    createsAirworthinessConclusion: false;
  };
}

export interface BeginApplicabilityEvaluationResult {
  attemptRef: string;
  status: 'RUNNING' | 'COMMITTING';
  leaseToken: string;
  leaseGeneration: number;
  leaseExpiresAt: string;
  task: OpenClawTaskEnvelope;
  recoveryResult?: OpenClawResultEnvelope;
  modelInput: Record<string, unknown>;
}

export interface CommitApplicabilityCandidateResult {
  workItemId: string;
  workItemRevision: number;
  status: CanonicalApplicabilityCandidateProjection['status'];
  applicability: CanonicalApplicabilityCandidateProjection;
}

@Injectable()
export class CanonicalHostOpenClawApplicabilityService {
  constructor(
    @Inject(CANONICAL_WORK_ITEM_REGISTRAR)
    private readonly registrar: CanonicalWorkItemRegistrarPort,
    @Inject(UNIFIED_ARTIFACT_STORE)
    private readonly artifactStore: UnifiedArtifactStorePort,
    private readonly reader: UnifiedReaderService,
    private readonly attempts: ActionAttemptLifecycleService,
    @Inject(CANONICAL_SERVICE_SCOPE_AUTHORIZATION)
    private readonly serviceScope: CanonicalServiceScopeAuthorizationPort,
  ) {}

  async begin(
    applicabilityContextRef: string,
    requestId: string,
  ): Promise<BeginApplicabilityEvaluationResult> {
    const scope = await this.serviceScope.authorizeOpenClawApplicabilityContext(
      {
        operation: 'BEGIN_APPLICABILITY',
        applicabilityContextRef,
        requestId,
      },
    );
    assertApplicabilityContextScope(scope, applicabilityContextRef, requestId);
    const workItem = await this.requiredParsedWorkItem(
      scope.workItemId,
      scope.tenantId,
    );
    const applicabilityInput = requiredApplicabilityInput(
      workItem,
      applicabilityContextRef,
    );
    assertApplicabilityNotCurrent(workItem, applicabilityInput);
    const taskBuild = await this.buildTaskContract(
      workItem,
      applicabilityInput,
    );
    const claim = await this.attempts.reserveAndClaim({
      workItemId: workItem.workItemId,
      taskType: 'OPENCLAW_APPLICABILITY_EVALUATION',
      actorUserId: OPENCLAW_SERVICE_USER_ID,
      tenantId: scope.tenantId,
      leaseOwner: scope.principalId,
      documentVersionId: workItem.source.documentVersionId,
      inputRevision: workItem.revision,
      baseRevision: workItem.revision,
      idempotencyKey: applicabilityIdempotencyKey({
        workItem,
        applicabilityInput,
        requestId,
      }),
      sourceRefs: taskBuild.sourceRefs,
      allowedConnectors: [],
      hostResolvedMissingInputs: taskBuild.missingInputs,
      buildModelInput: async (_identity: NewActionAttemptIdentity) =>
        structuredClone(taskBuild.contract) as unknown as Record<
          string,
          unknown
        >,
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
      modelInput: structuredClone(claim.task.modelInput),
    };
  }

  async commit(
    attemptRef: string,
    leaseToken: string,
    leaseGeneration: number,
    resultEnvelope: unknown,
  ): Promise<
    CommitApplicabilityCandidateResult | ActionAttemptTerminalProjection
  > {
    const scope = await this.serviceScope.authorizeOpenClawAttempt({
      operation: 'COMMIT_APPLICABILITY',
      attemptRef,
    });
    assertAttemptScope(scope, attemptRef);

    // ResultGate preflight is deliberately read-only. Wrong provenance,
    // SourceRef, revision, aircraft/fact binding, or envelope bytes never
    // advance the attempt to COMMITTING and never persist an artifact.
    const row = await this.attempts.readScoped({
      attemptRef,
      tenantId: scope.tenantId,
      workItemId: scope.workItemId,
    });
    assertApplicabilityAttempt(row, scope, attemptRef);
    const task = requiredApplicabilityTask(row);
    const result = parseResultEnvelope({ value: resultEnvelope, task });
    assertResultProvenance(result, task);

    let workItem = await this.requiredParsedWorkItem(
      row.workItemId,
      scope.tenantId,
    );
    const recoveredProjection = workItem.applicability;
    if (recoveredProjection?.actionAttemptId === row.attemptId) {
      const prepared = await this.prepareCommit({
        scope,
        attemptRef,
        leaseToken,
        leaseGeneration,
        resultEnvelope,
      });
      await finishForProjection(this.attempts, prepared, recoveredProjection);
      return projectionResult(workItem, recoveredProjection);
    }

    if (result.status !== 'SUCCEEDED') {
      return this.prepareNonCandidateTerminal({
        scope,
        attemptRef,
        leaseToken,
        leaseGeneration,
        resultEnvelope,
      });
    }
    if (workItem.revision !== task.baseRevision) {
      throw conflict('WORK_ITEM_REVISION_CONFLICT');
    }
    const applicabilityInput = requiredApplicabilityInput(
      workItem,
      requiredApplicabilityContextRef(task.modelInput),
    );
    const rebuilt = await this.buildTaskContract(workItem, applicabilityInput);
    if (canonicalJson(rebuilt.contract) !== canonicalJson(task.modelInput)) {
      throw new Error('APPLICABILITY_TASK_MODEL_INPUT_DRIFT');
    }
    if (canonicalJson(rebuilt.sourceRefs) !== canonicalJson(task.sourceRefs)) {
      throw new Error('APPLICABILITY_TASK_RESOURCE_BINDING_DRIFT');
    }

    const candidate = parseCandidateModelOutput(result.modelOutput);
    validateApplicabilityCandidateBinding(candidate, rebuilt.contract);
    const evaluation = evaluateCandidate(candidate, rebuilt.fleetSource);
    assertOnlyHostFactUnknown(evaluation);
    const artifactValue = buildApplicabilityArtifact({
      workItem,
      applicabilityInput,
      candidate,
      evaluation,
      result,
    });
    const artifactBytes = new TextEncoder().encode(
      canonicalJson(artifactValue),
    );

    const prepared = await this.prepareCommit({
      scope,
      attemptRef,
      leaseToken,
      leaseGeneration,
      resultEnvelope,
    });
    const recovered = await this.recoverPreparedCommit(prepared);
    if (recovered) return recovered;
    if (prepared.row.status !== 'COMMITTING') {
      return this.attempts.projectTerminal(prepared.row);
    }

    try {
      const persisted =
        await this.artifactStore.persistAndReadback(artifactBytes);
      assertArtifactReadback(persisted.bytes, artifactValue);
      const applicability = applicabilityProjection({
        workItem,
        applicabilityInput,
        attempt: prepared.row,
        artifact: persisted.artifact,
        artifactValue,
      });
      const updated = await this.registrar.compareAndSet({
        workItemId: workItem.workItemId,
        expectedRevision: task.baseRevision,
        syncPrimaryAttempt: false,
        next: {
          ...withoutRevision(workItem),
          applicability,
        },
      });
      await finishForProjection(this.attempts, prepared, applicability);
      return projectionResult(updated, applicability);
    } catch (error) {
      workItem = await this.requiredParsedWorkItem(
        prepared.row.workItemId,
        prepared.row.tenantId,
      );
      const recoveredAfterFailure = workItem.applicability;
      if (recoveredAfterFailure?.actionAttemptId === prepared.row.attemptId) {
        await finishForProjection(
          this.attempts,
          prepared,
          recoveredAfterFailure,
        );
        return projectionResult(workItem, recoveredAfterFailure);
      }
      throw error;
    }
  }

  private async prepareCommit(input: {
    scope: CanonicalVerifiedOpenClawAttemptScope;
    attemptRef: string;
    leaseToken: string;
    leaseGeneration: number;
    resultEnvelope: unknown;
  }): Promise<PreparedActionAttemptCommit> {
    return this.attempts.prepareCommit({
      attemptRef: input.attemptRef,
      tenantId: input.scope.tenantId,
      workItemId: input.scope.workItemId,
      principalId: input.scope.principalId,
      leaseToken: input.leaseToken,
      leaseGeneration: input.leaseGeneration,
      result: input.resultEnvelope,
      failClosedWithoutRejectionMutation: true,
    });
  }

  private async prepareNonCandidateTerminal(input: {
    scope: CanonicalVerifiedOpenClawAttemptScope;
    attemptRef: string;
    leaseToken: string;
    leaseGeneration: number;
    resultEnvelope: unknown;
  }): Promise<ActionAttemptTerminalProjection> {
    const prepared = await this.prepareCommit(input);
    return this.attempts.projectTerminal(prepared.row);
  }

  private async recoverPreparedCommit(
    prepared: PreparedActionAttemptCommit,
  ): Promise<
    CommitApplicabilityCandidateResult | ActionAttemptTerminalProjection | null
  > {
    const workItem = await this.requiredParsedWorkItem(
      prepared.row.workItemId,
      prepared.row.tenantId,
    );
    const applicability = workItem.applicability;
    if (applicability?.actionAttemptId === prepared.row.attemptId) {
      await finishForProjection(this.attempts, prepared, applicability);
      return projectionResult(workItem, applicability);
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
    applicabilityInput: CanonicalApplicabilityInputProjection,
  ): Promise<ApplicabilityTaskBuild> {
    const sourceUnits = await this.reader.readAllSourceUnits({
      artifact: workItem.package!.artifact,
      packageId: workItem.package!.packageId,
    });
    if (
      sourceUnits.length !== workItem.package!.contentUnitCount ||
      sourceUnits.length === 0
    ) {
      throw new Error('APPLICABILITY_SOURCE_UNIT_COUNT_MISMATCH');
    }
    const packageBytes = await this.artifactStore.readActualBytes(
      workItem.package!.artifact,
    );
    const sourceExpressions = parseFrozenSourceExpressions(
      packageBytes,
      workItem,
    );
    const missingInputs: OpenClawTaskEnvelope['hostResolvedMissingInputs'] = [];
    if (sourceExpressions.length === 0) {
      missingInputs.push({
        code: 'DOCUMENT_APPLICABILITY_EXPRESSIONS_MISSING',
        message:
          'The current frozen.2 package has no source-bound applicability expression.',
      });
    }

    const bilingual = await this.readCurrentBilingual(workItem);
    if (bilingual === null) {
      missingInputs.push({
        code: 'CURRENT_BILINGUAL_TRANSLATION_MISSING',
        message:
          'The current document version has no current validated bilingual projection.',
      });
    }
    const relevantRefIds = new Set(
      sourceExpressions.flatMap((expression) => expression.sourceRefIds),
    );
    const bilingualUnits = bilingual
      ? selectBilingualUnits(bilingual.units, sourceUnits, relevantRefIds)
      : [];
    if (
      sourceExpressions.length > 0 &&
      bilingual &&
      bilingualUnits.length === 0
    ) {
      missingInputs.push({
        code: 'BILINGUAL_APPLICABILITY_SOURCE_UNIT_MISSING',
        message:
          'No bilingual SourceUnit is bound to the frozen applicability SourceRefs.',
      });
    }

    const fleetSource = toFleetSource(applicabilityInput);
    const resolution = resolveFleetSnapshot({
      dataSource: fleetSource,
      aircraftNumber: applicabilityInput.aircraftNumber,
      asOf: applicabilityInput.assessmentAsOf,
    });
    if (applicabilityInput.currentness !== 'CURRENT') {
      missingInputs.push({
        code: `APPLICABILITY_INPUT_${applicabilityInput.currentness}`,
        message: 'The Host applicability input binding is not current.',
      });
    }
    if (
      !fleetSource.sourceSnapshotId ||
      !fleetSource.sourceRevisionKey ||
      !fleetSource.authorityRevision ||
      !fleetSource.sourceAsOf
    ) {
      missingInputs.push({
        code: 'FLEET_SOURCE_CURRENTNESS_UNVERIFIED',
        message:
          'The controlled FleetMasterData snapshot identity is incomplete.',
      });
    }
    if (
      fleetSource.sourceAsOf &&
      (!isIsoDate(fleetSource.sourceAsOf) ||
        fleetSource.sourceAsOf > applicabilityInput.assessmentAsOf)
    ) {
      missingInputs.push({
        code: 'FLEET_SOURCE_AS_OF_INVALID',
        message:
          'The controlled FleetMasterData sourceAsOf is invalid or later than assessmentAsOf.',
      });
    }
    if (
      matchingAircraftCount(fleetSource, applicabilityInput.aircraftNumber) !==
      1
    ) {
      missingInputs.push({
        code: 'FLEET_AIRCRAFT_IDENTITY_NOT_UNIQUE',
        message:
          'The selected aircraft number does not resolve to exactly one controlled asset.',
      });
    }
    if (resolution.status === 'WAITING_INPUT') {
      missingInputs.push({
        code: 'FLEET_AIRCRAFT_FACTS_NOT_RESOLVED',
        message:
          'The selected aircraft facts are missing or conflicting at assessmentAsOf.',
      });
    }

    const assetId = resolution.provenance?.assetId ?? null;
    const controlledAircraft = assetId
      ? (fleetSource.assets.find((asset) => asset.assetId === assetId) ?? null)
      : null;
    const controlledFacts = assetId
      ? fleetSource.facts.filter(
          (fact) =>
            fact.assetId === assetId &&
            (!fact.validAsOf ||
              fact.validAsOf <= applicabilityInput.assessmentAsOf),
        )
      : [];
    const contract: ApplicabilityTaskContract = {
      schemaVersion: APPLICABILITY_TASK_SCHEMA_VERSION,
      operation: 'EXTRACT_APPLICABILITY',
      applicabilityContextRef: applicabilityInput.applicabilityContextRef,
      inputRevision: workItem.revision,
      documentVersionRef: workItem.source.documentVersionId,
      sourcePackage: {
        packageId: workItem.package!.packageId,
        contentHash: workItem.package!.contentHash,
      },
      bilingualBinding: bilingual
        ? {
            actionAttemptId: workItem.translation!.actionAttemptId,
            artifactSha256: workItem.translation!.artifact.sha256,
          }
        : null,
      aircraft: {
        aircraftNumber: applicabilityInput.aircraftNumber,
        assessmentAsOf: applicabilityInput.assessmentAsOf,
      },
      fleetBinding: {
        bindingRevision: applicabilityInput.bindingRevision,
        sourceSnapshotId: fleetSource.sourceSnapshotId,
        sourceRevisionKey: fleetSource.sourceRevisionKey,
        authorityRevision: fleetSource.authorityRevision,
        sourceAsOf: fleetSource.sourceAsOf,
      },
      controlledAircraft: controlledAircraft
        ? {
            assetId: controlledAircraft.assetId,
            assetVersionId: controlledAircraft.assetVersionId,
            aircraftNumber: controlledAircraft.aircraftNumber,
            fleetFamily: controlledAircraft.fleetFamily ?? null,
            aircraftModel: controlledAircraft.aircraftModel ?? null,
            series: controlledAircraft.series ?? null,
            msn: controlledAircraft.msn ?? null,
            lineNumber: controlledAircraft.lineNumber ?? null,
            deliveryDate: controlledAircraft.deliveryDate ?? null,
            recordHash: controlledAircraft.recordHash,
          }
        : null,
      controlledFacts: controlledFacts.map((fact) => ({
        factId: fact.factId,
        factType: fact.factType,
        property: fact.property,
        qualifier: fact.qualifier ?? null,
        value: structuredClone(fact.value),
        validAsOf: fact.validAsOf ?? null,
        recordHash: fact.recordHash,
      })),
      sourceExpressions,
      bilingualSourceUnits: bilingualUnits,
      runtimePolicy: applicabilityRuntimePolicy(),
      authority: {
        candidateOnly: true,
        documentTextDoesNotProveFleetApplicability: true,
        hostDeterministicEvaluationRequired: true,
      },
    };
    const sourceRefs = [
      {
        ref: workItem.package!.artifact.ref,
        sha256: workItem.package!.artifact.sha256,
      },
      ...(bilingual
        ? [
            {
              ref: workItem.translation!.artifact.ref,
              sha256: workItem.translation!.artifact.sha256,
            },
          ]
        : []),
    ];
    return {
      contract,
      missingInputs: uniqueMissingInputs(missingInputs),
      sourceRefs,
      fleetSource,
    };
  }

  private async readCurrentBilingual(
    workItem: CanonicalWorkItemProjection,
  ): Promise<{ units: CanonicalReaderBilingualUnit[] } | null> {
    const translation = workItem.translation;
    if (
      !translation ||
      translation.status !== 'CANDIDATE_ONLY' ||
      translation.currentness !== 'CURRENT' ||
      translation.documentVersionId !== workItem.source.documentVersionId ||
      translation.sourcePackageId !== workItem.package!.packageId ||
      translation.sourcePackageContentHash !== workItem.package!.contentHash ||
      translation.ruleSetId !== CANONICAL_TRANSLATION_RULE_SET_V1_ID ||
      translation.ruleSetVersion !==
        CANONICAL_TRANSLATION_RULE_SET_V1_VERSION ||
      translation.validationVerdict !== 'ACCEPTED' ||
      translation.pendingTranslationUnitCount !== 0
    ) {
      return null;
    }
    const bytes = await this.artifactStore.readActualBytes(
      translation.artifact,
    );
    const artifact = parseBilingualTranslationArtifact(bytes);
    if (
      artifact.execution.actionAttemptId !== translation.actionAttemptId ||
      artifact.source.documentId !== workItem.source.documentId ||
      artifact.source.revisionId !== workItem.source.documentVersionId ||
      artifact.source.sbdPackageId !== workItem.package!.packageId ||
      artifact.source.sbdContentHash !== workItem.package!.contentHash ||
      artifact.ruleSet.ruleSetId !== CANONICAL_TRANSLATION_RULE_SET_V1_ID ||
      artifact.ruleSet.ruleSetVersion !==
        CANONICAL_TRANSLATION_RULE_SET_V1_VERSION ||
      artifact.validation.verdict !== 'ACCEPTED' ||
      artifact.units.length !== translation.translatedUnitCount
    ) {
      throw new Error('APPLICABILITY_BILINGUAL_ARTIFACT_BINDING_MISMATCH');
    }
    return { units: artifact.units };
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
      throw new Error('APPLICABILITY_PARSED_PACKAGE_NOT_READY');
    }
    if (
      workItem.package.contractId !== 'techpub.parsed-package.v1' ||
      workItem.package.contractRevision !== 'frozen.2'
    ) {
      throw new Error('APPLICABILITY_FROZEN2_PACKAGE_REQUIRED');
    }
    return workItem;
  }
}

function parseFrozenSourceExpressions(
  bytes: Uint8Array,
  workItem: CanonicalWorkItemProjection,
): ApplicabilityTaskSourceExpression[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(text);
  const parsed: unknown = JSON.parse(text) as unknown;
  const pkg = record(parsed, 'APPLICABILITY_FROZEN_PACKAGE_INVALID');
  const applicability = record(
    pkg.applicability,
    'APPLICABILITY_FROZEN_BLOCK_INVALID',
  );
  const sourceRefs = array(pkg.sourceRefs, 'APPLICABILITY_SOURCE_REFS_INVALID');
  const knownRefs = new Set(
    sourceRefs.map((value) =>
      requiredText(
        record(value, 'APPLICABILITY_SOURCE_REF_INVALID').sourceRefId,
        'APPLICABILITY_SOURCE_REF_ID_REQUIRED',
      ),
    ),
  );
  const seen = new Set<string>();
  const expressions = array(
    applicability.sourceExpressions,
    'APPLICABILITY_SOURCE_EXPRESSIONS_INVALID',
  ).map((value) => {
    const expression = record(value, 'APPLICABILITY_SOURCE_EXPRESSION_INVALID');
    const expressionId = requiredText(
      expression.expressionId,
      'APPLICABILITY_SOURCE_EXPRESSION_ID_REQUIRED',
    );
    const sourceRefIds = requiredStringArray(
      expression.sourceRefIds,
      'APPLICABILITY_SOURCE_EXPRESSION_REFS_INVALID',
    );
    if (
      seen.has(expressionId) ||
      sourceRefIds.some((sourceRefId) => !knownRefs.has(sourceRefId))
    ) {
      throw new Error('APPLICABILITY_SOURCE_EXPRESSION_BINDING_INVALID');
    }
    seen.add(expressionId);
    return {
      expressionId,
      text: requiredText(
        expression.text,
        'APPLICABILITY_SOURCE_EXPRESSION_TEXT_REQUIRED',
      ),
      sourceRefIds,
    };
  });
  const expectedCount =
    workItem.package!.usagePolicy?.applicability.sourceExpressionCount;
  if (expectedCount !== undefined && expectedCount !== expressions.length) {
    throw new Error('APPLICABILITY_SOURCE_EXPRESSION_COUNT_DRIFT');
  }
  return expressions;
}

function selectBilingualUnits(
  bilingualUnits: CanonicalReaderBilingualUnit[],
  sourceUnits: UnifiedReaderQueryResult[],
  relevantRefIds: Set<string>,
): ApplicabilityTaskContract['bilingualSourceUnits'] {
  const sourceById = new Map(sourceUnits.map((unit) => [unit.unitId, unit]));
  return bilingualUnits
    .filter((unit) =>
      unit.sourceRefIds.some((sourceRefId) => relevantRefIds.has(sourceRefId)),
    )
    .map((unit) => {
      const source = sourceById.get(unit.unitId);
      if (
        !source ||
        source.text !== unit.sourceText ||
        canonicalJson(source.sourceRefIds) !== canonicalJson(unit.sourceRefIds)
      ) {
        throw new Error('APPLICABILITY_BILINGUAL_SOURCE_UNIT_DRIFT');
      }
      return {
        unitId: unit.unitId,
        kind: unit.kind,
        sourceText: unit.sourceText,
        translatedText: unit.translatedText,
        sourceRefIds: [...unit.sourceRefIds],
      };
    });
}

function parseCandidateModelOutput(
  modelOutput: string | null,
): ApplicabilityCandidateContract {
  if (typeof modelOutput !== 'string' || !modelOutput.trim()) {
    throw new Error('APPLICABILITY_MODEL_OUTPUT_REQUIRED');
  }
  assertNoDuplicateJsonKeys(modelOutput);
  try {
    return parseApplicabilityCandidate(JSON.parse(modelOutput) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('APPLICABILITY_MODEL_OUTPUT_JSON_INVALID');
    }
    throw error;
  }
}

function evaluateCandidate(
  candidate: ApplicabilityCandidateContract,
  dataSource: FleetMasterDataSource,
): ApplicabilityEvaluation {
  const resolution = resolveFleetSnapshot({
    dataSource,
    aircraftNumber: candidate.aircraft.aircraftNumber,
    asOf: candidate.aircraft.assessmentAsOf,
  });
  if (resolution.status === 'WAITING_INPUT' || !resolution.snapshot) {
    return {
      status: 'WAITING_INPUT',
      decision: 'UNKNOWN',
      kleeneResult: UNKNOWN,
      pass: false,
      blockingUnknowns: [
        ...resolution.missingFacts.map((item) => ({ ...item })),
        ...resolution.conflictingFacts.map((item) => ({ ...item })),
      ],
      fleetResolution: resolution,
    };
  }
  const fragments: ApplicabilityFragment[] = candidate.expressions.map(
    (expression) => ({
      ruleFragmentId: expression.expressionId,
      extractionStatus: expression.extractionStatus,
      applicabilityLevel: expression.applicabilityLevel,
      contentRef: expression.contentRef,
      expressionAst: expression.expressionAst,
    }),
  );
  const trace = evaluateApplicabilityFragmentSetWithTrace(
    fragments,
    resolution.snapshot,
  );
  if (trace.result === UNKNOWN) {
    return {
      status: 'WAITING_INPUT',
      decision: 'UNKNOWN',
      kleeneResult: UNKNOWN,
      pass: false,
      blockingUnknowns: trace.blockingUnknowns,
      fleetResolution: resolution,
    };
  }
  return {
    status: 'EVALUATED',
    decision: trace.result ? 'APPLICABLE' : 'NOT_APPLICABLE',
    kleeneResult: trace.result,
    pass: trace.result === true,
    blockingUnknowns: [],
    fleetResolution: resolution,
  };
}

function assertOnlyHostFactUnknown(evaluation: ApplicabilityEvaluation): void {
  if (evaluation.kleeneResult !== UNKNOWN) return;
  if (
    evaluation.blockingUnknowns.length === 0 ||
    evaluation.blockingUnknowns.some(
      (unknown) =>
        ![
          'fact_unknown',
          'missing_fleet_fact',
          'conflicting_fleet_fact',
        ].includes(unknown.kind),
    )
  ) {
    throw new Error('APPLICABILITY_INTERPRETATION_UNKNOWN_REJECTED');
  }
}

function assertResultProvenance(
  result: OpenClawResultEnvelope,
  task: OpenClawTaskEnvelope,
): void {
  if (
    result.modelVersion !== APPLICABILITY_MODEL_VERSION ||
    result.promptVersion !== APPLICABILITY_PROMPT_VERSION ||
    result.skillVersion !== APPLICABILITY_SKILL_VERSION ||
    result.toolVersions[APPLICABILITY_MCP_SERVER_NAME] !==
      APPLICABILITY_MCP_SERVER_VERSION
  ) {
    throw new Error('APPLICABILITY_RESULT_PROVENANCE_MISMATCH');
  }
  if (canonicalJson(result.sourceRefs) !== canonicalJson(task.sourceRefs)) {
    throw new Error('APPLICABILITY_RESULT_RESOURCE_BINDING_MISMATCH');
  }
  if (result.status === 'SUCCEEDED') {
    if (
      result.outputArtifactRefs.length !== 0 ||
      result.missingInputs.length !== 0 ||
      result.conflicts.length !== 0
    ) {
      throw new Error('APPLICABILITY_RESULT_SUCCESS_SEMANTICS_INVALID');
    }
    const taskContract =
      task.modelInput as unknown as ApplicabilityTaskContract;
    const expectedFacts = taskContract.controlledFacts.map(
      (fact) => fact.factId,
    );
    if (
      canonicalJson(result.factsConsidered) !== canonicalJson(expectedFacts)
    ) {
      throw new Error('APPLICABILITY_RESULT_FACT_PROVENANCE_MISMATCH');
    }
  }
}

function requiredApplicabilityTask(
  row: ActionAttemptRow,
): OpenClawTaskEnvelope {
  if (!row.taskEnvelopeJson) throw conflict('TASK_ENVELOPE_MISSING');
  const task = parseTaskEnvelope(row.taskEnvelopeJson);
  if (
    row.actionType !== 'OPENCLAW_APPLICABILITY_EVALUATION' ||
    task.taskType !== 'OPENCLAW_APPLICABILITY_EVALUATION' ||
    task.actionAttemptId !== row.attemptId ||
    task.operationRef !== row.operationRef ||
    task.workItemId !== row.workItemId ||
    task.tenantId !== row.tenantId ||
    task.inputHash !== row.taskInputHash ||
    task.modelInput.schemaVersion !== APPLICABILITY_TASK_SCHEMA_VERSION
  ) {
    throw conflict('APPLICABILITY_TASK_ROW_BINDING_MISMATCH');
  }
  return task;
}

function requiredApplicabilityContextRef(
  modelInput: Record<string, unknown>,
): string {
  const task = modelInput as unknown as ApplicabilityTaskContract;
  return requiredText(
    task.applicabilityContextRef,
    'APPLICABILITY_CONTEXT_REF_MISSING',
  );
}

function requiredApplicabilityInput(
  workItem: CanonicalWorkItemProjection,
  applicabilityContextRef: string,
): CanonicalApplicabilityInputProjection {
  const input = workItem.applicabilityInput;
  if (
    !input ||
    input.schemaVersion !== 'wiselink.3_1.applicability_input_projection.v1' ||
    input.applicabilityContextRef !== applicabilityContextRef ||
    !input.bindingRevision.trim() ||
    !input.aircraftNumber.trim() ||
    !isIsoDate(input.assessmentAsOf) ||
    input.fleetMasterData.schemaVersion !== FLEET_MASTER_DATA_SCHEMA_VERSION
  ) {
    throw scopeNotFound();
  }
  return structuredClone(input);
}

function toFleetSource(
  input: CanonicalApplicabilityInputProjection,
): FleetMasterDataSource {
  return structuredClone(input.fleetMasterData) as FleetMasterDataSource;
}

function buildApplicabilityArtifact(input: {
  workItem: CanonicalWorkItemProjection;
  applicabilityInput: CanonicalApplicabilityInputProjection;
  candidate: ApplicabilityCandidateContract;
  evaluation: ApplicabilityEvaluation;
  result: OpenClawResultEnvelope;
}): ApplicabilityCandidateArtifact {
  return {
    schemaVersion: APPLICABILITY_ARTIFACT_SCHEMA_VERSION,
    candidateOnly: true,
    source: {
      documentId: input.workItem.source.documentId,
      documentVersionId: input.workItem.source.documentVersionId,
      packageId: input.workItem.package!.packageId,
      packageContentHash: input.workItem.package!.contentHash,
      translationActionAttemptId: input.workItem.translation!.actionAttemptId,
      applicabilityContextRef: input.applicabilityInput.applicabilityContextRef,
      applicabilityBindingRevision: input.applicabilityInput.bindingRevision,
    },
    candidate: structuredClone(input.candidate),
    evaluation: structuredClone(input.evaluation),
    execution: {
      actionAttemptId: input.result.actionAttemptId,
      operationRef: input.result.operationRef,
      resultContentHash: input.result.contentHash,
      modelVersion: input.result.modelVersion,
      promptVersion: input.result.promptVersion,
      skillVersion: input.result.skillVersion,
      toolVersions: structuredClone(input.result.toolVersions),
    },
    authority: {
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      createsAirworthinessConclusion: false,
    },
  };
}

function applicabilityProjection(input: {
  workItem: CanonicalWorkItemProjection;
  applicabilityInput: CanonicalApplicabilityInputProjection;
  attempt: ActionAttemptRow;
  artifact: UnifiedPackageArtifactDescriptor;
  artifactValue: ApplicabilityCandidateArtifact;
}): CanonicalApplicabilityCandidateProjection {
  const fleetBinding = input.artifactValue.candidate.fleetBinding;
  const sourceRefCount = new Set(
    input.artifactValue.candidate.expressions.flatMap(
      (expression) => expression.sourceRefIds,
    ),
  ).size;
  return {
    schemaVersion: 'wiselink.3_1.applicability_candidate_projection.v1',
    status:
      input.artifactValue.evaluation.status === 'WAITING_INPUT'
        ? 'WAITING_INPUT'
        : 'CANDIDATE_ONLY',
    currentness: 'CURRENT',
    staleReason: null,
    sourceResultId: `openclaw-applicability://${input.attempt.triggerRequestId}`,
    actionAttemptId: input.attempt.attemptId,
    inputRevision: input.attempt.inputRevision!,
    documentId: input.workItem.source.documentId,
    documentVersionId: input.workItem.source.documentVersionId,
    sourcePackageId: input.workItem.package!.packageId,
    sourcePackageContentHash: input.workItem.package!.contentHash,
    translationActionAttemptId: input.workItem.translation!.actionAttemptId,
    applicabilityContextRef: input.applicabilityInput.applicabilityContextRef,
    applicabilityBindingRevision: input.applicabilityInput.bindingRevision,
    aircraftNumber: input.applicabilityInput.aircraftNumber,
    assessmentAsOf: input.applicabilityInput.assessmentAsOf,
    fleetSourceSnapshotId: fleetBinding.sourceSnapshotId!,
    fleetSourceRevisionKey: fleetBinding.sourceRevisionKey!,
    fleetAuthorityRevision: fleetBinding.authorityRevision!,
    fleetSourceAsOf: fleetBinding.sourceAsOf!,
    sourceExpressionCount: input.artifactValue.candidate.expressions.length,
    sourceRefCount,
    decision: input.artifactValue.evaluation.decision,
    kleeneResult: input.artifactValue.evaluation.kleeneResult,
    pass: input.artifactValue.evaluation.pass,
    blockingUnknownCount:
      input.artifactValue.evaluation.blockingUnknowns.length,
    artifact: input.artifact,
  };
}

function assertArtifactReadback(
  bytes: Uint8Array,
  expected: ApplicabilityCandidateArtifact,
): void {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  assertNoDuplicateJsonKeys(text);
  const actual: unknown = JSON.parse(text) as unknown;
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error('APPLICABILITY_ARTIFACT_READBACK_MISMATCH');
  }
}

async function finishForProjection(
  attempts: ActionAttemptLifecycleService,
  prepared: PreparedActionAttemptCommit,
  projection: CanonicalApplicabilityCandidateProjection,
): Promise<ActionAttemptTerminalProjection> {
  return projection.status === 'WAITING_INPUT'
    ? attempts.finishProjectionWaitingInput(prepared)
    : attempts.finishProjectionSuccess(prepared);
}

function projectionResult(
  workItem: CanonicalWorkItemProjection,
  applicability: CanonicalApplicabilityCandidateProjection,
): CommitApplicabilityCandidateResult {
  return {
    workItemId: workItem.workItemId,
    workItemRevision: workItem.revision,
    status: applicability.status,
    applicability,
  };
}

function applicabilityIdempotencyKey(input: {
  workItem: CanonicalWorkItemProjection;
  applicabilityInput: CanonicalApplicabilityInputProjection;
  requestId: string;
}): string {
  // action_attempt.idempotency_key is varchar(255); hashing this exact,
  // versioned binding prevents valid opaque refs from overflowing that DB
  // type while preserving deterministic replay identity.
  return `openclaw-v1:applicability:${canonicalSha256({
    workItemId: input.workItem.workItemId,
    revision: input.workItem.revision,
    packageSha256: input.workItem.package!.artifact.sha256,
    translationSha256:
      input.workItem.translation?.artifact.sha256 ?? 'translation-missing',
    applicabilityBindingRevision: input.applicabilityInput.bindingRevision,
    requestId: input.requestId,
  })}`;
}

function matchingAircraftCount(
  source: FleetMasterDataSource,
  aircraftNumber: string,
): number {
  const target = normalizeAircraftNumber(aircraftNumber);
  return source.assets.filter(
    (asset) =>
      normalizeAircraftNumber(asset.aircraftNumber) === target ||
      (asset.aliases ?? []).some(
        (alias) => normalizeAircraftNumber(alias.aliasValue) === target,
      ),
  ).length;
}

function normalizeAircraftNumber(value: string): string {
  return value.trim().toUpperCase();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

function assertApplicabilityNotCurrent(
  workItem: CanonicalWorkItemProjection,
  input: CanonicalApplicabilityInputProjection,
): void {
  const current = workItem.applicability;
  if (
    current?.status === 'CANDIDATE_ONLY' &&
    current.currentness === 'CURRENT' &&
    current.documentVersionId === workItem.source.documentVersionId &&
    current.sourcePackageId === workItem.package!.packageId &&
    current.sourcePackageContentHash === workItem.package!.contentHash &&
    current.translationActionAttemptId ===
      workItem.translation?.actionAttemptId &&
    current.applicabilityContextRef === input.applicabilityContextRef &&
    current.applicabilityBindingRevision === input.bindingRevision &&
    current.aircraftNumber === input.aircraftNumber &&
    current.assessmentAsOf === input.assessmentAsOf
  ) {
    throw new Error('APPLICABILITY_ALREADY_CURRENT');
  }
}

function assertApplicabilityContextScope(
  scope: CanonicalVerifiedApplicabilityContextScope,
  applicabilityContextRef: string,
  requestId: string,
): void {
  if (
    scope.appId !== CANONICAL_APP_ID ||
    scope.applicabilityContextRef !== applicabilityContextRef ||
    scope.requestId !== requestId ||
    !scope.workItemId.trim() ||
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
  if (
    scope.appId !== CANONICAL_APP_ID ||
    scope.attemptRef !== attemptRef ||
    !scope.workItemId.trim() ||
    !scope.principalId.trim() ||
    !scope.tenantId.trim() ||
    !scope.authorizationFingerprint.trim()
  ) {
    throw scopeNotFound();
  }
}

function assertApplicabilityAttempt(
  row: ActionAttemptRow,
  scope: CanonicalVerifiedOpenClawAttemptScope,
  attemptRef: string,
): void {
  if (
    row.actionType !== 'OPENCLAW_APPLICABILITY_EVALUATION' ||
    row.workItemId !== scope.workItemId ||
    row.tenantId !== scope.tenantId ||
    row.actorUserId !== OPENCLAW_SERVICE_USER_ID ||
    row.operationRef !== attemptRef
  ) {
    throw scopeNotFound();
  }
}

function uniqueMissingInputs(
  values: OpenClawTaskEnvelope['hostResolvedMissingInputs'],
): OpenClawTaskEnvelope['hostResolvedMissingInputs'] {
  return Array.from(
    new Map(values.map((value) => [value.code, value])).values(),
  );
}

function requiredStringArray(value: unknown, code: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || !item.trim()) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(code);
  }
  return [...value] as string[];
}

function array(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(code);
  return value;
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value;
}

function withoutRevision(
  workItem: CanonicalWorkItemProjection,
): Omit<CanonicalWorkItemProjection, 'revision'> {
  const { revision: _revision, ...rest } = workItem;
  return rest;
}

function scopeNotFound(): Error & { code: string; statusCode: number } {
  return Object.assign(new Error('CANONICAL_WORK_ITEM_NOT_FOUND'), {
    code: 'CANONICAL_WORK_ITEM_NOT_FOUND',
    statusCode: 404,
  });
}

function conflict(code: string): Error & { code: string; statusCode: number } {
  return Object.assign(new Error(code), { code, statusCode: 409 });
}
