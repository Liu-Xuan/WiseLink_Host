import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type {
  AeoSimilarCandidateSummary,
  AeoWorkItemReadModel,
} from '../../../shared/aeo-integration';

import { normalizeWorkItemReadModel } from './aeo-same-workitem-host.ports';
import { projectionError } from './aeo-editor-projection.utils';

export interface AeoReviewedAssessmentActualBytes {
  bytes: Uint8Array;
}

export interface AeoOverallHumanConfirmation {
  status: 'HUMAN_CONFIRMED';
  authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ';
  confirmationRef: string;
  workItemId: string;
  workItemRevision: number;
  overallArtifactRef: string;
  overallArtifactSha256: string;
}

export interface AeoReviewedIntegratedAssessmentInput {
  /** The canonical host projection containing integratedAssessment. */
  canonicalWorkItem: unknown;
  /**
   * Server fresh-read AEO projection for the same WorkItem. The canonical
   * host supplies both the human-confirmed candidate target and the selected
   * authoring seed; this consumer has no built-in AEO identity or seed.
   */
  serverDerivedAeoWorkItem: unknown;
  dynamicEvaluationActualBytes: AeoReviewedAssessmentActualBytes;
  overallActualBytes: AeoReviewedAssessmentActualBytes;
  overallHumanConfirmation: AeoOverallHumanConfirmation;
}

export interface AeoReviewedIntegratedAssessmentResult {
  workItem: AeoWorkItemReadModel;
  candidates: AeoSimilarCandidateSummary[];
  referenceArtifacts: Array<{
    artifactRef: string;
    artifactSha256: string;
    bytes: Uint8Array;
  }>;
  authority: 'REVIEWED_OVERALL_CANDIDATE_NOT_AUTOMATIC_ADOPTION_NOT_ENGINEERING_APPROVAL';
}

/**
 * Controller-free host consumer. The canonical host owns fresh-read,
 * authorization, ArtifactStore readback and CAS; this service only checks the
 * two already-persisted artifacts before exposing one review-only AEO
 * candidate to the existing working/Draft/Word services.
 */
@Injectable()
export class AeoReviewedIntegratedAssessmentConsumer {
  consume(
    input: AeoReviewedIntegratedAssessmentInput,
  ): AeoReviewedIntegratedAssessmentResult {
    return consumeReviewedIntegratedAssessment(input);
  }
}

export function consumeReviewedIntegratedAssessment(
  input: AeoReviewedIntegratedAssessmentInput,
): AeoReviewedIntegratedAssessmentResult {
  const canonical = record(input.canonicalWorkItem, 'canonicalWorkItem');
  exact(
    canonical.schemaVersion,
    'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    'canonicalWorkItem.schemaVersion',
  );
  exact(
    canonical.phase,
    'CANDIDATE_READBACK_VERIFIED',
    'canonicalWorkItem.phase',
  );
  const workItemId = text(canonical.workItemId, 'canonicalWorkItem.workItemId');
  const requestId = text(canonical.requestId, 'canonicalWorkItem.requestId');
  const revision = positiveInteger(
    canonical.revision,
    'canonicalWorkItem.revision',
  );
  const permissionSnapshotVersion = text(
    canonical.permissionSnapshotVersion,
    'canonicalWorkItem.permissionSnapshotVersion',
  );
  const source = record(canonical.source, 'canonicalWorkItem.source');
  const documentVersionId = text(
    source.documentVersionId,
    'canonicalWorkItem.source.documentVersionId',
  );
  const pkg = record(canonical.package, 'canonicalWorkItem.package');
  const packageId = text(pkg.packageId, 'canonicalWorkItem.package.packageId');
  const packageArtifact = record(
    pkg.artifact,
    'canonicalWorkItem.package.artifact',
  );

  const integrated = record(
    canonical.integratedAssessment,
    'canonicalWorkItem.integratedAssessment',
  );
  exact(
    integrated.status,
    'OVERALL_CANDIDATE_READY',
    'integratedAssessment.status',
  );
  // `baseRules` is the canonical host's retained storage field name. Its
  // source identity must prove that the actual producer was OpenClaw dynamic
  // N/N evaluation; a historical Base result is not accepted here.
  const dynamicEvaluation = record(
    integrated.baseRules,
    'integratedAssessment.dynamicEvaluation',
  );
  exact(
    dynamicEvaluation.status,
    'CANDIDATE_ONLY',
    'dynamicEvaluation.status',
  );
  const dynamicSourceResultId = text(
    dynamicEvaluation.sourceResultId,
    'dynamicEvaluation.sourceResultId',
  );
  if (!dynamicSourceResultId.startsWith('openclaw-dynamic://')) {
    fail('DYNAMIC_EVALUATION_OPENCLAW_SOURCE_REQUIRED');
  }
  const dynamicRevision = positiveInteger(
    dynamicEvaluation.revision,
    'dynamicEvaluation.revision',
  );
  const criterionCount = positiveInteger(
    dynamicEvaluation.criterionCount,
    'dynamicEvaluation.criterionCount',
  );
  exact(
    dynamicEvaluation.evaluationItemCount,
    criterionCount,
    'dynamicEvaluation.evaluationItemCount',
  );
  const dynamicArtifact = artifact(
    dynamicEvaluation.artifact,
    'dynamicEvaluation.artifact',
  );

  const overall = record(
    integrated.overallSynthesis,
    'integratedAssessment.overallSynthesis',
  );
  exact(overall.status, 'CANDIDATE_ONLY', 'overallSynthesis.status');
  exact(overall.staleReason, null, 'overallSynthesis.staleReason');
  exact(
    overall.basedOnBaseRuleRevision,
    dynamicRevision,
    'overallSynthesis.basedOnDynamicEvaluationRevision',
  );
  exact(
    overall.basedOnBaseRuleArtifactSha256,
    dynamicArtifact.sha256,
    'overallSynthesis.basedOnDynamicEvaluationArtifactSha256',
  );
  exact(
    overall.authorityLevel,
    'candidate_only',
    'overallSynthesis.authorityLevel',
  );
  exact(
    overall.externalDiscoveryIsEvidence,
    false,
    'overallSynthesis.externalDiscoveryIsEvidence',
  );
  const overallArtifact = artifact(
    overall.artifact,
    'overallSynthesis.artifact',
  );

  const dynamicBytes = verifyActualBytes(
    input.dynamicEvaluationActualBytes.bytes,
    dynamicArtifact,
    'DYNAMIC_EVALUATION_ACTUAL_BYTES_MISMATCH',
  );
  const dynamicResult = json(
    dynamicBytes,
    'DYNAMIC_EVALUATION_ACTUAL_BYTES_INVALID',
  );
  assertFullDynamicEvaluationResult({
    value: dynamicResult,
    sourceResultId: dynamicSourceResultId,
    criterionCount,
  });

  const overallBytes = verifyActualBytes(
    input.overallActualBytes.bytes,
    overallArtifact,
    'OPENCLAW_OVERALL_ACTUAL_BYTES_MISMATCH',
  );
  const overallResult = json(
    overallBytes,
    'OPENCLAW_OVERALL_ACTUAL_BYTES_INVALID',
  );
  assertOverallResult({
    value: overallResult,
    sourceResultId: text(
      overall.sourceResultId,
      'overallSynthesis.sourceResultId',
    ),
    documentVersionId,
    packageId,
    dynamicRevision,
    dynamicArtifact,
  });

  assertHumanConfirmation(input.overallHumanConfirmation, {
    workItemId,
    revision,
    overallArtifact,
  });

  const workItem = normalizeWorkItemReadModel(input.serverDerivedAeoWorkItem);
  assertSameAeoWorkItem(workItem, {
    workItemId,
    requestId,
    revision,
    permissionSnapshotVersion,
    documentVersionId,
    packageId,
    packageArtifactRef: text(
      packageArtifact.ref,
      'canonicalWorkItem.package.artifact.ref',
    ),
    packageArtifactSha256: sha256(
      packageArtifact.sha256,
      'canonicalWorkItem.package.artifact.sha256',
    ),
    dynamicEvaluation,
    overallArtifact,
  });

  const confirmationRef = controlledArtifactRef(
    input.overallHumanConfirmation.confirmationRef,
    'overallHumanConfirmation.confirmationRef',
  );
  const candidates: AeoSimilarCandidateSummary[] = [
    {
      candidateId: `integrated-assessment:${text(
        overall.sourceResultId,
        'overallSynthesis.sourceResultId',
      )}`,
      sourceKind: 'AI_SUGGESTION',
      title: `已人工确认的整体综合候选 · ${text(
        dynamicEvaluation.criterionSetId,
        'dynamicEvaluation.criterionSetId',
      )} · N=${criterionCount}`,
      reason:
        `同一 WorkItem ${workItemId} 的 OpenClaw dynamic ${criterionCount}/${criterionCount} ` +
        `逐项评估与 candidate_only 整体综合；人工确认 ${confirmationRef}。` +
        '仍须在 AEO working copy 中显式处置，不形成工程批准或发布。',
      sourceArtifactRef: overallArtifact.ref,
      sourceArtifactSha256: overallArtifact.sha256,
      eligibility: 'CANDIDATE_REQUIRES_REVIEW',
    },
  ];

  return {
    workItem,
    candidates,
    referenceArtifacts: [
      {
        artifactRef: dynamicArtifact.ref,
        artifactSha256: dynamicArtifact.sha256,
        bytes: Uint8Array.from(dynamicBytes),
      },
      {
        artifactRef: overallArtifact.ref,
        artifactSha256: overallArtifact.sha256,
        bytes: Uint8Array.from(overallBytes),
      },
    ],
    authority:
      'REVIEWED_OVERALL_CANDIDATE_NOT_AUTOMATIC_ADOPTION_NOT_ENGINEERING_APPROVAL',
  };
}

interface ArtifactPointer {
  ref: string;
  sha256: string;
  byteLength: number;
  mediaType: 'application/json';
}

function artifact(value: unknown, field: string): ArtifactPointer {
  const result = record(value, field);
  const mediaType = result.mediaType;
  exact(mediaType, 'application/json', `${field}.mediaType`);
  return {
    ref: controlledArtifactRef(result.ref, `${field}.ref`),
    sha256: sha256(result.sha256, `${field}.sha256`),
    byteLength: positiveInteger(result.byteLength, `${field}.byteLength`),
    mediaType: 'application/json',
  };
}

function assertFullDynamicEvaluationResult(input: {
  value: Record<string, unknown>;
  sourceResultId: string;
  criterionCount: number;
}): void {
  if (Object.prototype.hasOwnProperty.call(input.value, 'correlation')) {
    fail('DYNAMIC_EVALUATION_PRIVATE_CORRELATION_PRESENT');
  }
  exact(
    input.value.callerCorrelationRef,
    input.sourceResultId.slice('openclaw-dynamic://'.length),
    'dynamicEvaluation.callerCorrelationRef',
  );
  exact(
    input.value.authorityLevel,
    'candidate_only',
    'dynamicEvaluation.authorityLevel',
  );
  exact(
    input.value.engineeringConclusion,
    null,
    'dynamicEvaluation.engineeringConclusion',
  );
  const requiredFields = [
    'ruleId',
    'result',
    'factsConsidered',
    'ruleApplication',
    'analysisSummary',
    'conclusion',
    'sourceRefs',
    'missingInputs',
    'humanReviewRequired',
  ];
  const ruleResults = decodeRuleResults(
    input.value.ruleResults,
    requiredFields,
  );
  exact(
    ruleResults.length,
    input.criterionCount,
    'dynamicEvaluation.ruleResults.length',
  );
  const ids = ruleResults.map((entry, index) => {
    const rule = record(entry, `dynamicEvaluation.ruleResults[${index}]`);
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(rule, field)) {
        fail(`DYNAMIC_EVALUATION_RESULT_FIELD_MISSING:${field}`);
      }
    }
    if (
      !Array.isArray(rule.factsConsidered) ||
      !Array.isArray(rule.sourceRefs) ||
      !Array.isArray(rule.missingInputs) ||
      typeof rule.humanReviewRequired !== 'boolean'
    ) {
      fail('DYNAMIC_EVALUATION_RESULT_FIELD_TYPE_INVALID');
    }
    return text(rule.ruleId, 'ruleId');
  });
  if (new Set(ids).size !== input.criterionCount) {
    fail('DYNAMIC_EVALUATION_RESULT_IDS_NOT_UNIQUE');
  }
  const overallSelfCheck = record(
    input.value.overallSelfCheck,
    'dynamicEvaluation.overallSelfCheck',
  );
  exact(
    overallSelfCheck.ruleResultCount,
    input.criterionCount,
    'dynamicEvaluation.overallSelfCheck.ruleResultCount',
  );
  exact(
    overallSelfCheck.overallOpinionProduced,
    false,
    'dynamicEvaluation.overallSelfCheck.overallOpinionProduced',
  );
  exact(
    overallSelfCheck.holisticSynthesisDeferredToOpenClaw,
    true,
    'dynamicEvaluation.overallSelfCheck.holisticSynthesisDeferredToOpenClaw',
  );
  const completion = record(
    input.value.completionSelfCheck,
    'dynamicEvaluation.completionSelfCheck',
  );
  exact(
    completion.expectedRuleCount,
    input.criterionCount,
    'dynamicEvaluation.completionSelfCheck.expectedRuleCount',
  );
  exact(
    completion.allInputRulesReturned,
    true,
    'dynamicEvaluation.completionSelfCheck.allInputRulesReturned',
  );
}

function assertOverallResult(input: {
  value: Record<string, unknown>;
  sourceResultId: string;
  documentVersionId: string;
  packageId: string;
  dynamicRevision: number;
  dynamicArtifact: ArtifactPointer;
}): void {
  exact(input.value.sourceResultId, input.sourceResultId, 'overall.sourceResultId');
  exact(
    input.value.documentVersionId,
    input.documentVersionId,
    'overall.documentVersionId',
  );
  exact(input.value.packageId, input.packageId, 'overall.packageId');
  exact(
    input.value.baseRuleRevision,
    input.dynamicRevision,
    'overall.dynamicEvaluationRevision',
  );
  exact(
    input.value.baseRuleArtifactSha256,
    `sha256:${input.dynamicArtifact.sha256}`,
    'overall.dynamicEvaluationArtifactSha256',
  );
  exact(input.value.authorityLevel, 'candidate_only', 'overall.authorityLevel');
  exact(
    input.value.externalDiscoveryIsEvidence,
    false,
    'overall.externalDiscoveryIsEvidence',
  );
  exact(input.value.adopted, false, 'overall.adopted');
  exact(input.value.usableAsEvidence, false, 'overall.usableAsEvidence');
  exact(
    input.value.engineeringReviewRequired,
    true,
    'overall.engineeringReviewRequired',
  );
}

function decodeRuleResults(
  value: unknown,
  requiredFields: string[],
): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      record(entry, `dynamicEvaluation.ruleResults[${index}]`),
    );
  }
  const encoded = record(value, 'dynamicEvaluation.ruleResults');
  const keys = Object.keys(encoded).sort();
  if (keys.length !== 2 || keys[0] !== 'columns' || keys[1] !== 'rows') {
    fail('DYNAMIC_EVALUATION_RESULTS_COLUMNAR_SHAPE_INVALID');
  }
  if (
    !Array.isArray(encoded.columns) ||
    JSON.stringify(encoded.columns) !== JSON.stringify(requiredFields) ||
    !Array.isArray(encoded.rows)
  ) {
    fail('DYNAMIC_EVALUATION_RESULTS_COLUMNAR_SCHEMA_INVALID');
  }
  return encoded.rows.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== requiredFields.length) {
      fail(`DYNAMIC_EVALUATION_RESULT_ROW_INVALID:${index}`);
    }
    return Object.fromEntries(
      requiredFields.map((field, fieldIndex) => [field, entry[fieldIndex]]),
    );
  });
}

function assertHumanConfirmation(
  confirmation: AeoOverallHumanConfirmation,
  expected: {
    workItemId: string;
    revision: number;
    overallArtifact: ArtifactPointer;
  },
): void {
  exact(confirmation.status, 'HUMAN_CONFIRMED', 'confirmation.status');
  exact(
    confirmation.authority,
    'CANONICAL_WORKITEM_SERVER_FRESH_READ',
    'confirmation.authority',
  );
  exact(confirmation.workItemId, expected.workItemId, 'confirmation.workItemId');
  exact(
    confirmation.workItemRevision,
    expected.revision,
    'confirmation.workItemRevision',
  );
  exact(
    confirmation.overallArtifactRef,
    expected.overallArtifact.ref,
    'confirmation.overallArtifactRef',
  );
  exact(
    confirmation.overallArtifactSha256,
    expected.overallArtifact.sha256,
    'confirmation.overallArtifactSha256',
  );
  controlledArtifactRef(confirmation.confirmationRef, 'confirmation.confirmationRef');
}

function assertSameAeoWorkItem(
  workItem: AeoWorkItemReadModel,
  expected: {
    workItemId: string;
    requestId: string;
    revision: number;
    permissionSnapshotVersion: string;
    documentVersionId: string;
    packageId: string;
    packageArtifactRef: string;
    packageArtifactSha256: string;
    dynamicEvaluation: Record<string, unknown>;
    overallArtifact: ArtifactPointer;
  },
): void {
  exact(workItem.workItemId, expected.workItemId, 'aeoWorkItem.workItemId');
  exact(workItem.requestId, expected.requestId, 'aeoWorkItem.requestId');
  exact(workItem.stateVersion, expected.revision, 'aeoWorkItem.stateVersion');
  exact(
    workItem.permissionSnapshotVersion,
    expected.permissionSnapshotVersion,
    'aeoWorkItem.permissionSnapshotVersion',
  );
  exact(
    workItem.sourceContext.document.documentVersionId,
    expected.documentVersionId,
    'aeoWorkItem.sourceContext.documentVersionId',
  );
  exact(
    workItem.sourceContext.parsedPackage.packageId,
    expected.packageId,
    'aeoWorkItem.sourceContext.parsedPackage.packageId',
  );
  exact(
    workItem.sourceContext.parsedPackage.artifactRef,
    expected.packageArtifactRef,
    'aeoWorkItem.sourceContext.parsedPackage.artifactRef',
  );
  exact(
    workItem.sourceContext.parsedPackage.artifactSha256,
    expected.packageArtifactSha256,
    'aeoWorkItem.sourceContext.parsedPackage.artifactSha256',
  );
  const assessment = workItem.sourceContext.assessment;
  if (!assessment) fail('AEO_WORKITEM_ASSESSMENT_POINTER_REQUIRED');
  exact(
    assessment.criterionSetId,
    text(
      expected.dynamicEvaluation.criterionSetId,
      'dynamicEvaluation.criterionSetId',
    ),
    'aeoWorkItem.assessment.criterionSetId',
  );
  exact(
    assessment.criterionCount,
    positiveInteger(
      expected.dynamicEvaluation.criterionCount,
      'dynamicEvaluation.criterionCount',
    ),
    'aeoWorkItem.assessment.criterionCount',
  );
  exact(
    assessment.evaluationItemCount,
    assessment.criterionCount,
    'aeoWorkItem.assessment.evaluationItemCount',
  );
  exact(
    assessment.artifactRef,
    expected.overallArtifact.ref,
    'aeoWorkItem.assessment.artifactRef',
  );
  exact(
    assessment.artifactSha256,
    expected.overallArtifact.sha256,
    'aeoWorkItem.assessment.artifactSha256',
  );
  exact(
    assessment.artifactByteLength,
    expected.overallArtifact.byteLength,
    'aeoWorkItem.assessment.artifactByteLength',
  );
  exact(
    assessment.authorityLevel,
    'candidate_only',
    'aeoWorkItem.assessment.authorityLevel',
  );
  exact(
    assessment.blocksEngineeringClosure,
    true,
    'aeoWorkItem.assessment.blocksEngineeringClosure',
  );
  exact(
    assessment.externalDiscoveryIsEvidence,
    false,
    'aeoWorkItem.assessment.externalDiscoveryIsEvidence',
  );
  exact(
    assessment.previousOverallStale,
    false,
    'aeoWorkItem.assessment.previousOverallStale',
  );
  exact(assessment.staleReason, null, 'aeoWorkItem.assessment.staleReason');
}

function verifyActualBytes(
  bytes: Uint8Array,
  pointer: ArtifactPointer,
  code: string,
): Uint8Array {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength !== pointer.byteLength ||
    createHash('sha256').update(bytes).digest('hex') !== pointer.sha256
  ) {
    fail(code);
  }
  return Uint8Array.from(bytes);
}

function json(bytes: Uint8Array, code: string): Record<string, unknown> {
  try {
    return record(JSON.parse(Buffer.from(bytes).toString('utf8')), code);
  } catch {
    fail(code);
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`INVALID_RECORD:${field}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`INVALID_TEXT:${field}`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(`INVALID_POSITIVE_INTEGER:${field}`);
  }
  return Number(value);
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    fail(`INVALID_SHA256:${field}`);
  }
  return value;
}

function controlledArtifactRef(value: unknown, field: string): string {
  const ref = text(value, field);
  if (!/^(artifact|drive|miaoda-file):\/\//u.test(ref)) {
    fail(`INVALID_ARTIFACT_REF:${field}`);
  }
  return ref;
}

function exact(value: unknown, expected: unknown, field: string): void {
  if (value !== expected) fail(`INVALID_VALUE:${field}`);
}

function fail(code: string): never {
  projectionError(
    'WORKITEM_PROJECTION_INVALID',
    `AEO_REVIEWED_INTEGRATED_ASSESSMENT_INVALID:${code}`,
  );
}
