import { createHash } from 'node:crypto';

import type { Provider } from '@nestjs/common';

import {
  AEO_ARTIFACT_INDEX_VERSION,
  type AeoServerConfirmedTargetIdentity,
  type AeoSimilarCandidateSummary,
  type AeoWorkItemReadModel,
} from '../../../shared/aeo-integration';

import { normalizeWorkItemReadModel } from './aeo-aily.service';
import { projectionError } from './aeo-editor-projection.utils';

export const AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER = Symbol(
  'AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER',
);

export interface AeoAcceptedOemReferenceActualBytes {
  documentVersionId: string;
  parsedPackageId: string;
  artifactRef: string;
  artifactSha256: string;
  readerReceiptId: string;
  readerRevision: string;
  validationStatus: 'ACCEPTED';
  bytes: Uint8Array;
}

export interface AeoSameWorkItemAssessmentAdapterInput {
  canonicalWorkItem: unknown;
  assessmentActualBytes: Uint8Array;
  authoringSeed: AeoWorkItemReadModel['authoringSeed'];
  authoringSeedActualBytes: Uint8Array;
  aeoTargetIdentity: AeoServerConfirmedTargetIdentity;
  acceptedOemReferences: AeoAcceptedOemReferenceActualBytes[];
  observedAt: string;
}

export interface AeoSameWorkItemAssessmentAdapterResult {
  workItem: AeoWorkItemReadModel;
  candidates: AeoSimilarCandidateSummary[];
  referenceArtifacts: Array<{
    artifactRef: string;
    artifactSha256: string;
    bytes: Uint8Array;
  }>;
  authority: 'SERVER_FRESH_READ_CANDIDATES_NOT_AUTOMATIC_ADOPTION_NOT_ENGINEERING_APPROVAL';
}

export interface AeoSameWorkItemAssessmentAdapterPort {
  adapt(
    input: AeoSameWorkItemAssessmentAdapterInput,
  ): AeoSameWorkItemAssessmentAdapterResult;
}

export class DefaultAeoSameWorkItemAssessmentAdapter implements AeoSameWorkItemAssessmentAdapterPort {
  adapt(
    input: AeoSameWorkItemAssessmentAdapterInput,
  ): AeoSameWorkItemAssessmentAdapterResult {
    return adaptSameWorkItemAssessmentForAeo(input);
  }
}

/** Host-owned opt-in provider. AeoAuthoringModule does not register it by default. */
export function provideAeoSameWorkItemAssessmentAdapter(): Provider {
  return {
    provide: AEO_SAME_WORKITEM_ASSESSMENT_ADAPTER,
    useClass: DefaultAeoSameWorkItemAssessmentAdapter,
  };
}

/**
 * Host-only composition adapter. None of these fields are accepted from the
 * Miaoda/Aily request body; the caller supplies one server-fresh WorkItem,
 * its immutable Assessment bytes and already accepted Reader artifacts.
 */
export function adaptSameWorkItemAssessmentForAeo(
  input: AeoSameWorkItemAssessmentAdapterInput,
): AeoSameWorkItemAssessmentAdapterResult {
  const host = asRecord(input.canonicalWorkItem, 'canonicalWorkItem');
  exactText(
    host.schemaVersion,
    'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    'canonicalWorkItem.schemaVersion',
  );
  exactText(
    host.phase,
    'CANDIDATE_READBACK_VERIFIED',
    'canonicalWorkItem.phase',
  );
  const classification = asRecord(host.classification, 'classification');
  exactText(classification.status, 'CONFIRMED', 'classification.status');
  exactText(
    classification.normalizedFamily,
    'SB',
    'classification.normalizedFamily',
  );
  const source = asRecord(host.source, 'source');
  const pkg = asRecord(host.package, 'package');
  const packageArtifact = asRecord(pkg.artifact, 'package.artifact');
  const fullValidatorProof = asRecord(
    pkg.fullValidatorProof,
    'package.fullValidatorProof',
  );
  const assessment = asRecord(host.assessment, 'assessment');
  if (
    assessment.authorityLevel !== 'candidate_only' ||
    assessment.blocksEngineeringClosure !== true ||
    assessment.externalDiscoveryIsEvidence !== false
  ) {
    fail('ASSESSMENT_AUTHORITY_INVALID');
  }
  if (
    assessment.status !== 'CANDIDATE_ONLY' &&
    assessment.status !== 'CANDIDATE_ONLY_RESYNTHESIZED'
  ) {
    fail('ASSESSMENT_STATUS_INVALID');
  }
  const assessmentArtifact = asRecord(
    assessment.artifact,
    'assessment.artifact',
  );
  verifyBytes(
    input.assessmentActualBytes,
    text(assessmentArtifact.sha256, 'assessment.artifact.sha256'),
    integer(assessmentArtifact.byteLength, 'assessment.artifact.byteLength'),
    'ASSESSMENT_ACTUAL_BYTES_MISMATCH',
  );
  const assessmentResult = parseJson(
    input.assessmentActualBytes,
    'ASSESSMENT_ACTUAL_BYTES_INVALID',
  );
  const discoveryBoundary = asRecord(
    asRecord(assessmentResult.externalDiscovery, 'externalDiscovery')
      .authorityBoundary,
    'externalDiscovery.authorityBoundary',
  );
  if (discoveryBoundary.externalDiscoveryIsEvidence !== false) {
    fail('EXTERNAL_DISCOVERY_MUST_NOT_BE_EVIDENCE');
  }
  assertServerConfirmedTarget(input.aeoTargetIdentity);
  verifyBytes(
    input.authoringSeedActualBytes,
    input.authoringSeed.parsedPackage.artifactSha256,
    input.authoringSeedActualBytes.byteLength,
    'AUTHORING_SEED_ACTUAL_BYTES_MISMATCH',
  );
  const authoringSeedPackage = parseJson(
    input.authoringSeedActualBytes,
    'AUTHORING_SEED_ACTUAL_BYTES_INVALID',
  );
  const formalIdentity = asRecord(
    authoringSeedPackage.formalIdentity,
    'formalIdentity',
  );
  const formalAeoIdentity = text(
    formalIdentity.formalAeoIdentity,
    'formalIdentity.formalAeoIdentity',
  );
  const revision = text(formalIdentity.revision, 'formalIdentity.revision');
  const iteration = text(formalIdentity.iteration, 'formalIdentity.iteration');
  const acceptedSeedIdentities = new Set([
    formalAeoIdentity,
    `${formalAeoIdentity}-${revision}`,
    `${formalAeoIdentity}-${revision}-${iteration}`,
  ]);
  if (
    text(
      authoringSeedPackage.parsePackageId,
      'authoringSeed.parsePackageId',
    ) !== input.authoringSeed.parsedPackage.packageId ||
    !acceptedSeedIdentities.has(input.authoringSeed.aeoIdentity)
  ) {
    fail('AUTHORING_SEED_IDENTITY_MISMATCH');
  }

  const acceptedByDocumentVersion = new Map(
    input.acceptedOemReferences.map((reference) => {
      if (reference.validationStatus !== 'ACCEPTED') {
        fail('OEM_REFERENCE_READER_NOT_ACCEPTED');
      }
      verifyBytes(
        reference.bytes,
        reference.artifactSha256,
        reference.bytes.byteLength,
        'OEM_REFERENCE_ACTUAL_BYTES_MISMATCH',
      );
      const parsed = parseJson(
        reference.bytes,
        'OEM_REFERENCE_ACTUAL_BYTES_INVALID',
      );
      if (
        text(parsed.packageId, 'oemReference.packageId') !==
        reference.parsedPackageId
      ) {
        fail('OEM_REFERENCE_PACKAGE_ID_MISMATCH');
      }
      const legacyIdentifiers = asArray(
        asRecord(parsed.source, 'oemReference.source').legacyIdentifiers,
        'oemReference.source.legacyIdentifiers',
      );
      if (
        !legacyIdentifiers.some((entry) => {
          const value = asRecord(entry, 'legacyIdentifier');
          return (
            value.namespace === 'wiselink_document_version_id' &&
            value.value === reference.documentVersionId
          );
        })
      ) {
        fail('OEM_REFERENCE_DOCUMENT_VERSION_MISMATCH');
      }
      return [reference.documentVersionId, { reference, parsed }] as const;
    }),
  );
  const knowledgeRecords = asArray(
    asRecord(
      asRecord(
        asRecord(assessmentResult.overall, 'overall').context,
        'overall.context',
      ).knowledgeContext,
      'overall.context.knowledgeContext',
    ).records,
    'overall.context.knowledgeContext.records',
  );
  const candidates: AeoSimilarCandidateSummary[] = [];
  const referenceArtifacts: AeoSameWorkItemAssessmentAdapterResult['referenceArtifacts'] =
    [];
  for (const rawRecord of knowledgeRecords) {
    const record = asRecord(rawRecord, 'knowledgeContext.record');
    if (
      record.sourceSystem !== 'DOCUMENT_MANAGEMENT' ||
      record.authorityLevel !== 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY' ||
      record.usableAsCurrentFact !== false ||
      record.createsCurrentEngineerDecision !== false
    ) {
      continue;
    }
    const adoptionDecisionRef = text(
      record.adoptionDecisionRef,
      'knowledgeContext.record.adoptionDecisionRef',
    );
    const documentVersionId = text(
      record.externalDocumentVersionId,
      'knowledgeContext.record.externalDocumentVersionId',
    );
    const accepted = acceptedByDocumentVersion.get(documentVersionId);
    if (!accepted) fail('OEM_REFERENCE_ACCEPTED_BYTES_REQUIRED');
    if (
      text(
        record.parsedPackageId,
        'knowledgeContext.record.parsedPackageId',
      ) !== accepted.reference.parsedPackageId ||
      text(
        record.parsedPackageArtifactRef,
        'knowledgeContext.record.parsedPackageArtifactRef',
      ) !== accepted.reference.artifactRef
    ) {
      fail('OEM_REFERENCE_EXACT_REF_MISMATCH');
    }
    const contentUnits = asArray(
      accepted.parsed.contentUnits,
      'oemReference.contentUnits',
    );
    const locators = asArray(
      record.locators,
      'knowledgeContext.record.locators',
    );
    for (const rawLocator of locators) {
      const locator = asRecord(rawLocator, 'knowledgeContext.locator');
      const sourceUnitId = text(
        locator.sourceUnitId,
        'knowledgeContext.locator.sourceUnitId',
      );
      if (
        !contentUnits.some(
          (unit) =>
            asRecord(unit, 'oemReference.contentUnit').unitId === sourceUnitId,
        )
      ) {
        fail('OEM_REFERENCE_SOURCE_UNIT_NOT_FOUND');
      }
      candidates.push({
        candidateId: sourceUnitId,
        sourceKind: 'OEM_REFERENCE',
        title: `${text(record.sourceTitle, 'record.sourceTitle')} ${text(
          record.sourceFileVersion,
          'record.sourceFileVersion',
        )}`,
        reason:
          `DM exact DocumentVersion ${documentVersionId}；Assessment 人工采纳 ${adoptionDecisionRef}；` +
          '仅为待复核参考，不从 applicability 计数推断工程事实。',
        sourceArtifactRef: accepted.reference.artifactRef,
        sourceArtifactSha256: accepted.reference.artifactSha256,
        eligibility: 'CANDIDATE_REQUIRES_REVIEW',
      });
    }
    referenceArtifacts.push({
      artifactRef: accepted.reference.artifactRef,
      artifactSha256: accepted.reference.artifactSha256,
      bytes: Uint8Array.from(accepted.reference.bytes),
    });
  }
  if (candidates.length === 0) fail('NO_DM_ADOPTED_OEM_REFERENCE');

  const workItem = normalizeWorkItemReadModel({
    schemaVersion: AEO_ARTIFACT_INDEX_VERSION,
    workItemId: text(host.workItemId, 'workItemId'),
    requestId: text(host.requestId, 'requestId'),
    stateVersion: integer(host.revision, 'revision'),
    permissionSnapshotVersion: text(
      host.permissionSnapshotVersion,
      'permissionSnapshotVersion',
    ),
    sourceDocumentFamily: 'SB',
    authoringPurpose: 'AEO',
    aeoTargetIdentity: input.aeoTargetIdentity,
    validationRun: null,
    sourceContext: {
      document: {
        documentId: text(source.documentId, 'source.documentId'),
        documentVersionId: text(
          source.documentVersionId,
          'source.documentVersionId',
        ),
        classificationStatus: 'CONFIRMED',
        catalogRole: 'CanonicalDocumentCatalog',
        classificationFingerprint: text(
          classification.fingerprint,
          'classification.fingerprint',
        ),
      },
      parsedPackage: {
        packageId: text(pkg.packageId, 'package.packageId'),
        artifactRef: text(packageArtifact.ref, 'package.artifact.ref'),
        artifactSha256: text(packageArtifact.sha256, 'package.artifact.sha256'),
        contractId: text(pkg.contractId, 'package.contractId'),
        contractRevision: text(
          pkg.contractRevision,
          'package.contractRevision',
        ),
        readerReceiptId: text(pkg.readerReceiptId, 'package.readerReceiptId'),
        fullValidatorRevision: text(
          fullValidatorProof.validatorRevision,
          'package.fullValidatorProof.validatorRevision',
        ),
        validationStatus: 'ACCEPTED',
      },
      assessment: {
        status: assessment.status,
        criterionSetId: text(
          assessment.criterionSetId,
          'assessment.criterionSetId',
        ),
        criterionCount: integer(
          assessment.criterionCount,
          'assessment.criterionCount',
        ),
        evaluationItemCount: integer(
          assessment.evaluationItemCount,
          'assessment.evaluationItemCount',
        ),
        packageStatus: text(
          assessment.packageStatus,
          'assessment.packageStatus',
        ),
        applicabilityOverall: text(
          assessment.applicabilityOverall,
          'assessment.applicabilityOverall',
        ),
        authorityLevel: 'candidate_only',
        blocksEngineeringClosure: true,
        externalDiscoveryStatus:
          assessment.externalDiscoveryStatus === null
            ? null
            : text(
                assessment.externalDiscoveryStatus,
                'assessment.externalDiscoveryStatus',
              ),
        externalDiscoveryIsEvidence: false,
        previousOverallStale: boolean(
          assessment.previousOverallStale,
          'assessment.previousOverallStale',
        ),
        staleReason: assessment.staleReason,
        currentContextHash: text(
          assessment.currentContextHash,
          'assessment.currentContextHash',
        ),
        currentTransportHash: text(
          assessment.currentTransportHash,
          'assessment.currentTransportHash',
        ),
        artifactRef: text(assessmentArtifact.ref, 'assessment.artifact.ref'),
        artifactSha256: text(
          assessmentArtifact.sha256,
          'assessment.artifact.sha256',
        ),
        artifactByteLength: integer(
          assessmentArtifact.byteLength,
          'assessment.artifact.byteLength',
        ),
        evaluateAttemptId: text(
          assessment.evaluateAttemptId,
          'assessment.evaluateAttemptId',
        ),
        resynthesisAttemptId:
          assessment.resynthesisAttemptId === null
            ? null
            : text(
                assessment.resynthesisAttemptId,
                'assessment.resynthesisAttemptId',
              ),
      },
    },
    authoringSeed: input.authoringSeed,
    aeo: {
      state: 'PARSE_READY',
      stateVersion: `AEO-STATE-${integer(host.revision, 'revision')}`,
      summary:
        `SB Assessment ${text(assessment.status, 'assessment.status')} / ` +
        `${text(assessment.applicabilityOverall, 'assessment.applicabilityOverall')}；` +
        'AEO target 已由工程师确认，候选不会自动采用。',
      blockers: [
        'Assessment 与 OEM_REFERENCE 均为 candidate_only；工程师必须显式处置。',
      ],
    },
    artifactIndex: [],
    todos: [
      {
        todoId: 'AEO-PHASE6B-REVIEW-ASSESSMENT',
        label: '复核当前 Assessment candidate 与 FAST #62 来源候选',
        state: 'OPEN',
      },
    ],
    observedAt: input.observedAt,
  });
  return {
    workItem,
    candidates,
    referenceArtifacts,
    authority:
      'SERVER_FRESH_READ_CANDIDATES_NOT_AUTOMATIC_ADOPTION_NOT_ENGINEERING_APPROVAL',
  };
}

function assertServerConfirmedTarget(
  value: AeoServerConfirmedTargetIdentity,
): void {
  if (
    value.confirmationStatus !== 'HUMAN_CONFIRMED' ||
    value.authority !== 'CANONICAL_WORKITEM_SERVER_FRESH_READ'
  ) {
    fail('AEO_TARGET_IDENTITY_NOT_SERVER_CONFIRMED');
  }
  text(value.value, 'aeoTargetIdentity.value');
  text(value.confirmationRef, 'aeoTargetIdentity.confirmationRef');
}

function verifyBytes(
  bytes: Uint8Array,
  expectedSha256: string,
  expectedByteLength: number,
  code: string,
): void {
  if (
    bytes.byteLength !== expectedByteLength ||
    createHash('sha256').update(bytes).digest('hex') !== expectedSha256
  ) {
    fail(code);
  }
}

function parseJson(bytes: Uint8Array, code: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(Buffer.from(bytes).toString('utf8')), code);
  } catch {
    fail(code);
  }
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`INVALID_RECORD:${field}`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`INVALID_ARRAY:${field}`);
  return value;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`INVALID_TEXT:${field}`);
  }
  return value;
}

function exactText(value: unknown, expected: string, field: string): void {
  if (value !== expected) fail(`INVALID_VALUE:${field}`);
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    fail(`INVALID_INTEGER:${field}`);
  }
  return Number(value);
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(`INVALID_BOOLEAN:${field}`);
  return value;
}

function fail(code: string): never {
  projectionError(
    'WORKITEM_PROJECTION_INVALID',
    `AEO_PHASE6B_SAME_WORKITEM_INVALID:${code}`,
  );
}
