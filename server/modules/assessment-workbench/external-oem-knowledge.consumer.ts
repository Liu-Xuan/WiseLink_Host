import { ConflictException } from '@nestjs/common';

import type {
  BoundKnowledgeRetrievalContext,
  ExternalOemKnowledgeReference,
} from '@shared/assessment-host.interface';

const EXTERNAL_CONTEXT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.external_knowledge_evaluation_context_manifest.v1.candidate';

export interface ReviewedExternalOemExpectedTarget {
  workItemId: string;
  assessmentCaseId: string;
  documentId: string;
  documentVersionId: string;
  assessmentAsOf: string;
  parsedPackage: {
    packageId: string;
    contractRevision: string;
    artifactRef: string;
    artifactHash: string;
    semanticHash: string;
  };
  jobAid: {
    criterionSetId: string;
    criterionSetHash: string;
    memberIdentityHash: string;
    criterionCount: number;
    ruleArtifactRef: string;
    ruleArtifactVersion: string;
    ruleArtifactDigest: string;
    sourceManifestHash: string;
  };
}

/**
 * Adapts the already-reviewed DM references from the existing external OEM
 * manifest into the existing Assessment knowledge context. Search snippets are
 * intentionally not copied. The caller remains responsible for fresh-reading
 * the immutable manifest and the referenced DM records before calling here.
 */
export function consumeReviewedExternalOemKnowledge(
  value: unknown,
  expected: ReviewedExternalOemExpectedTarget,
): BoundKnowledgeRetrievalContext {
  const manifest = requiredRecord(value, 'EXTERNAL_OEM_CONTEXT_INVALID');
  if (requiredText(manifest, 'schemaVersion') !== EXTERNAL_CONTEXT_SCHEMA) {
    throw new ConflictException('EXTERNAL_OEM_CONTEXT_SCHEMA_UNSUPPORTED');
  }
  if (
    requiredText(manifest, 'status') !== 'FROZEN_FOR_ONE_OVERALL_ASSESSMENT' ||
    manifest.syntheticFixture !== false
  ) {
    throw new ConflictException('EXTERNAL_OEM_CONTEXT_NOT_FROZEN_REAL_INPUT');
  }
  const manifestId = requiredText(manifest, 'manifestId');
  const manifestHash = requiredSha(manifest, 'manifestHash');
  if (manifestId !== `EKCM-${manifestHash.slice(7, 31).toUpperCase()}`) {
    throw new ConflictException('EXTERNAL_OEM_CONTEXT_IDENTITY_MISMATCH');
  }

  assertTarget(requiredRecord(manifest.target, 'EXTERNAL_OEM_TARGET_INVALID'), expected);
  assertAuthorityBoundary(manifest.authorityBoundary);

  const searchRuns = requiredArray(manifest.searchRuns, 'EXTERNAL_OEM_SEARCH_RUNS_INVALID')
    .map(parseSearchRun);
  if (searchRuns.length === 0) {
    throw new ConflictException('EXTERNAL_OEM_SEARCH_RUNS_EMPTY');
  }
  const searchRunById = new Map(searchRuns.map((run) => [run.searchRunId, run]));
  const records = requiredArray(
    manifest.adoptedExternalDocuments,
    'EXTERNAL_OEM_ADOPTED_DOCUMENTS_INVALID',
  ).map((item) => parseAdoptedDocument(item, searchRunById));
  if (records.length === 0) {
    throw new ConflictException('EXTERNAL_OEM_REVIEWED_DOCUMENTS_EMPTY');
  }

  const discoveryOnly = requiredArray(
    manifest.discoveryOnlyCandidates,
    'EXTERNAL_OEM_DISCOVERY_CANDIDATES_INVALID',
  );
  for (const item of discoveryOnly) {
    const candidate = requiredRecord(item, 'EXTERNAL_OEM_DISCOVERY_CANDIDATE_INVALID');
    if (candidate.adopted !== false || candidate.usableAsEvidence !== false) {
      throw new ConflictException('EXTERNAL_OEM_SNIPPET_AUTHORITY_INVALID');
    }
  }
  const gaps = requiredArray(manifest.gaps, 'EXTERNAL_OEM_GAPS_INVALID')
    .map(parseGap);
  const hasVersionGap = gaps.length > 0 || records.some(
    (record) => record.sourceCurrentnessStatus === 'DM_REVIEWED_VERSION_GAP',
  );
  const observedAt = [...searchRuns]
    .map((run) => run.observedAt)
    .sort()
    .at(-1)!;

  return {
    schemaVersion: 'wiselink.v3_1.sb_job_aid.knowledge_retrieval_context.v1',
    contextId: manifestId,
    contextHash: manifestHash,
    status: hasVersionGap ? 'AVAILABLE_WITH_VERSION_GAPS' : 'AVAILABLE_VERIFIED',
    reasonCode: hasVersionGap
      ? 'EXTERNAL_OEM_REVIEWED_REFERENCES_WITH_VISIBLE_GAPS'
      : 'EXTERNAL_OEM_REVIEWED_REFERENCES_AVAILABLE',
    query: searchRuns
      .map((run) => `${run.provider}:${run.query}`)
      .sort()
      .join(' | '),
    targetPackageId: expected.assessmentCaseId,
    targetDocumentId: expected.documentId,
    targetDocumentVersionId: expected.documentVersionId,
    requestedKnowledgeSpaceIds: [],
    observedAt,
    records,
    versionWarnings: [
      '外部 OEM 检索摘要和 snippet 未进入本上下文；只能使用经 Document Management 复核的 exact DocumentVersion、ParsedPackage 与 SourceUnit locator。',
      '已采纳外部资料仍不是当前机队事实、适用性结论、工程师批准或关闭决定。',
      ...gaps.map((gap) => `${gap.code}:${gap.provider}:${gap.scope}:${gap.detail}`),
    ],
    authorityBoundary: {
      knowledgeCandidateIsCurrentFact: false,
      sourceContainerMembershipConfirmed: false,
      createsEvidenceRef: false,
      createsCurrentEngineerDecision: false,
      createsApplicabilityConclusion: false,
    },
  };
}

function assertTarget(
  target: Record<string, unknown>,
  expected: ReviewedExternalOemExpectedTarget,
): void {
  const exactFields: Array<[string, string]> = [
    ['workItemId', expected.workItemId],
    ['assessmentCaseId', expected.assessmentCaseId],
    ['documentId', expected.documentId],
    ['documentVersionId', expected.documentVersionId],
    ['assessmentAsOf', expected.assessmentAsOf],
  ];
  for (const [field, exact] of exactFields) {
    if (requiredText(target, field) !== exact) {
      throw new ConflictException(`EXTERNAL_OEM_TARGET_MISMATCH:${field}`);
    }
  }
  const parsed = requiredRecord(
    target.subjectAcceptedParsedPackage,
    'EXTERNAL_OEM_SUBJECT_PACKAGE_INVALID',
  );
  const packageFields: Array<[string, string]> = [
    ['packageId', expected.parsedPackage.packageId],
    ['contractRevision', expected.parsedPackage.contractRevision],
    ['artifactRef', expected.parsedPackage.artifactRef],
    ['artifactArtifactSha256', rawSha(expected.parsedPackage.artifactHash)],
    ['semanticHash', expected.parsedPackage.semanticHash],
  ];
  for (const [field, exact] of packageFields) {
    if (requiredText(parsed, field) !== exact) {
      throw new ConflictException(`EXTERNAL_OEM_SUBJECT_PACKAGE_MISMATCH:${field}`);
    }
  }
  const reader = requiredRecord(parsed.readerReceipt, 'EXTERNAL_OEM_READER_RECEIPT_INVALID');
  if (
    requiredText(reader, 'ownerRole') !== 'CanonicalUnifiedReader' ||
    requiredText(reader, 'validationStatus') !== 'ACCEPTED'
  ) {
    throw new ConflictException('EXTERNAL_OEM_READER_RECEIPT_NOT_ACCEPTED');
  }

  const jobAid = requiredRecord(target.jobAid, 'EXTERNAL_OEM_JOB_AID_INVALID');
  const jobAidFields: Array<[string, string | number]> = [
    ['criterionSetId', expected.jobAid.criterionSetId],
    ['criterionSetHash', expected.jobAid.criterionSetHash],
    ['memberIdentityHash', expected.jobAid.memberIdentityHash],
    ['criterionCount', expected.jobAid.criterionCount],
    ['ruleArtifactRef', expected.jobAid.ruleArtifactRef],
    ['ruleArtifactVersion', expected.jobAid.ruleArtifactVersion],
    ['ruleArtifactDigest', expected.jobAid.ruleArtifactDigest],
    ['sourceManifestHash', expected.jobAid.sourceManifestHash],
  ];
  for (const [field, exact] of jobAidFields) {
    if (jobAid[field] !== exact) {
      throw new ConflictException(`EXTERNAL_OEM_JOB_AID_MISMATCH:${field}`);
    }
  }
}

function parseSearchRun(value: unknown): {
  searchRunId: string;
  provider: 'BOEING' | 'AIRBUS' | 'COMAC';
  query: string;
  observedAt: string;
} {
  const input = requiredRecord(value, 'EXTERNAL_OEM_SEARCH_RUN_INVALID');
  const provider = providerValue(input.provider);
  const audit = requiredRecord(input.audit, 'EXTERNAL_OEM_SEARCH_AUDIT_INVALID');
  return {
    searchRunId: requiredText(input, 'searchRunId'),
    provider,
    query: requiredText(input, 'query'),
    observedAt: requiredIso(audit, 'observedAt'),
  };
}

function parseAdoptedDocument(
  value: unknown,
  searchRunById: Map<string, { observedAt: string }>,
): ExternalOemKnowledgeReference {
  const input = requiredRecord(value, 'EXTERNAL_OEM_ADOPTED_DOCUMENT_INVALID');
  const searchRunId = requiredText(input, 'searchRunId');
  const searchRun = searchRunById.get(searchRunId);
  if (!searchRun) {
    throw new ConflictException('EXTERNAL_OEM_ADOPTION_SEARCH_RUN_MISSING');
  }
  const review = requiredRecord(input.adoptionReview, 'EXTERNAL_OEM_ADOPTION_REVIEW_INVALID');
  if (!['HUMAN_REVIEWED', 'RULE_VALIDATED'].includes(requiredText(review, 'status'))) {
    throw new ConflictException('EXTERNAL_OEM_ADOPTION_NOT_REVIEWED');
  }
  const lifecycleStatus = requiredText(input, 'lifecycleStatus');
  if (!['ACTIVE', 'SUPERSEDED', 'WITHDRAWN', 'UNKNOWN'].includes(lifecycleStatus)) {
    throw new ConflictException('EXTERNAL_OEM_LIFECYCLE_INVALID');
  }
  const artifact = requiredRecord(input.artifact, 'EXTERNAL_OEM_ARTIFACT_INVALID');
  const parsed = requiredRecord(input.parsedPackage, 'EXTERNAL_OEM_PARSED_PACKAGE_INVALID');
  if (
    requiredText(parsed, 'contractId') !== 'techpub.parsed-package.v1' ||
    requiredText(parsed, 'contractRevision') !== 'frozen.2'
  ) {
    throw new ConflictException('EXTERNAL_OEM_PARSED_PACKAGE_NOT_ACCEPTED');
  }
  const locators = requiredArray(
    input.sourceUnitLocators,
    'EXTERNAL_OEM_SOURCE_LOCATORS_INVALID',
  ).map((item) => {
    const locator = requiredRecord(item, 'EXTERNAL_OEM_SOURCE_LOCATOR_INVALID');
    return {
      sourceUnitId: requiredText(locator, 'sourceUnitId'),
      sourceUnitHash: requiredSha(locator, 'sourceUnitHash'),
      locator: requiredRecord(locator.locator, 'EXTERNAL_OEM_LOCATOR_INVALID'),
      locatorHash: requiredSha(locator, 'locatorHash'),
    };
  });
  if (locators.length === 0) {
    throw new ConflictException('EXTERNAL_OEM_SOURCE_LOCATORS_EMPTY');
  }
  requiredRecord(input.retention, 'EXTERNAL_OEM_RETENTION_INVALID');
  const observedAt = searchRun.observedAt;
  const documentNumber = requiredText(input, 'documentNumber');
  const documentVersionId = requiredText(input, 'externalDocumentVersionId');
  return {
    candidateId: requiredText(input, 'adoptionId'),
    candidateHash: requiredSha(parsed, 'semanticHash'),
    sourceSystem: 'DOCUMENT_MANAGEMENT',
    retrievalChannel: 'EXTERNAL_OEM_SEARCH_ADOPTION',
    sourceFileToken: documentVersionId,
    sourceUrl: requiredText(artifact, 'artifactRef'),
    sourceTitle: documentNumber,
    sourceFileVersion: requiredText(input, 'revisionLabel'),
    sourceFileByteHash: requiredRawSha(artifact, 'artifactSha256'),
    sourceFileSizeBytes: requiredPositiveInteger(artifact, 'byteLength'),
    sourceCreatedAt: observedAt,
    sourceUpdatedAt: observedAt,
    sourceOwnerName: 'CanonicalDocumentCatalog',
    sourceContainerMembershipStatus: 'CONFIRMED',
    documentFamily: 'EXTERNAL_OEM_TECHNICAL_PUBLICATION',
    documentNumber,
    revisionLabel: requiredText(input, 'revisionLabel'),
    revisionStatus: 'DM_CONFIRMED_EXACT_DOCUMENT_VERSION',
    sourceCurrentnessStatus: lifecycleStatus === 'ACTIVE'
      ? 'DM_REVIEWED_ACTIVE_REFERENCE'
      : 'DM_REVIEWED_VERSION_GAP',
    relationshipLevel: 'L3_SEMANTICALLY_RELATED_REFERENCE',
    relationshipReason: `经 DM 复核采纳的 ${providerValue(input.provider)} 外部工程资料引用；来源检索 ${searchRunId}。`,
    locators,
    extractedClaims: [],
    affectedCriterionIds: [],
    authorityLevel: 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY',
    usableAsCurrentFact: false,
    createsCurrentEngineerDecision: false,
    provider: providerValue(input.provider),
    externalDocumentId: requiredText(input, 'externalDocumentId'),
    externalDocumentVersionId: documentVersionId,
    artifactRef: requiredText(artifact, 'artifactRef'),
    parsedPackageId: requiredText(parsed, 'packageId'),
    parsedPackageArtifactRef: requiredText(parsed, 'artifactRef'),
    parsedPackageSemanticHash: requiredSha(parsed, 'semanticHash'),
    adoptionDecisionRef: requiredText(review, 'decisionRef'),
  };
}

function parseGap(value: unknown): {
  code: string;
  provider: string;
  scope: string;
  detail: string;
} {
  const input = requiredRecord(value, 'EXTERNAL_OEM_GAP_INVALID');
  return {
    code: requiredText(input, 'code'),
    provider: providerValue(input.provider),
    scope: requiredText(input, 'scope'),
    detail: requiredText(input, 'detail'),
  };
}

function assertAuthorityBoundary(value: unknown): void {
  const boundary = requiredRecord(value, 'EXTERNAL_OEM_AUTHORITY_BOUNDARY_INVALID');
  for (const field of [
    'snippetIsEvidence',
    'ragHitIsEvidence',
    'discoveryCandidateIsEvidence',
    'adoptedDocumentIsFleetFact',
    'createsApplicabilityConclusion',
    'createsEngineerDecision',
    'createsClosureDecision',
  ]) {
    if (boundary[field] !== false) {
      throw new ConflictException(`EXTERNAL_OEM_AUTHORITY_INVALID:${field}`);
    }
  }
}

function requiredRecord(value: unknown, code: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConflictException(code);
  }
  return value as Record<string, any>;
}

function requiredArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new ConflictException(code);
  return value;
}

function requiredText(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ConflictException(`EXTERNAL_OEM_FIELD_REQUIRED:${field}`);
  }
  return value.trim();
}

function requiredSha(input: Record<string, unknown>, field: string): string {
  const value = requiredText(input, field);
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new ConflictException(`EXTERNAL_OEM_SHA_INVALID:${field}`);
  }
  return value;
}

function requiredRawSha(input: Record<string, unknown>, field: string): string {
  const value = requiredText(input, field);
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new ConflictException(`EXTERNAL_OEM_RAW_SHA_INVALID:${field}`);
  }
  return value;
}

function requiredIso(input: Record<string, unknown>, field: string): string {
  const value = requiredText(input, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new ConflictException(`EXTERNAL_OEM_DATE_INVALID:${field}`);
  }
  return value;
}

function requiredPositiveInteger(
  input: Record<string, unknown>,
  field: string,
): number {
  const value = input[field];
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new ConflictException(`EXTERNAL_OEM_INTEGER_INVALID:${field}`);
  }
  return Number(value);
}

function providerValue(value: unknown): 'BOEING' | 'AIRBUS' | 'COMAC' {
  if (value !== 'BOEING' && value !== 'AIRBUS' && value !== 'COMAC') {
    throw new ConflictException('EXTERNAL_OEM_PROVIDER_INVALID');
  }
  return value;
}

function rawSha(value: string): string {
  return value.startsWith('sha256:') ? value.slice('sha256:'.length) : value;
}
