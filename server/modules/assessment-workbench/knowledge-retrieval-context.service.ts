import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';

import type {
  BoundKnowledgeRetrievalContext,
  BoundSimilarCaseContext,
  FeishuKnowledgeRetrievalCandidate,
  KnowledgeRetrievalCandidate,
  KnowledgeSourceLocator,
  SimilarCaseContext,
  SimilarCaseRelationshipLevel,
} from '@shared/assessment-host.interface';

const CONTEXT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.knowledge_retrieval_context.v1' as const;
const SIMILAR_CONTEXT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.similar_case_context.v1' as const;
const READBACK_SCHEMA =
  'wiselink.v3_1.sb_job_aid.feishu_knowledge_readback.v1' as const;

export interface CurrentKnowledgeTarget {
  packageId: string;
  documentId: string;
  documentVersionId: string;
  documentNumber: string;
  revisionLabel: string | null;
}

@Injectable()
export class KnowledgeRetrievalContextService {
  adaptVerifiedFeishuReadback(
    value: unknown,
    target: CurrentKnowledgeTarget,
  ): BoundKnowledgeRetrievalContext {
    return adaptVerifiedFeishuKnowledgeReadback(value, target);
  }
}

export function adaptVerifiedFeishuKnowledgeReadback(
  value: unknown,
  target: CurrentKnowledgeTarget,
): BoundKnowledgeRetrievalContext {
  const input = requiredRecord(value, 'KNOWLEDGE_READBACK_INVALID');
  if (requiredText(input, 'schemaVersion') !== READBACK_SCHEMA) {
    throw new ConflictException('KNOWLEDGE_READBACK_SCHEMA_UNSUPPORTED');
  }
  if (
    requiredText(input, 'retrievalChannel') !== 'FEISHU_DRIVE_SEARCH_V2' ||
    requiredText(input, 'resultStatus') !== 'FOUND' ||
    input.readbackVerified !== true
  ) {
    throw new ConflictException('KNOWLEDGE_READBACK_NOT_VERIFIED');
  }
  const query = requiredText(input, 'query');
  const requestedKnowledgeSpaceIds = requiredTextArray(
    input.requestedKnowledgeSpaceIds,
    'KNOWLEDGE_SPACE_IDS_INVALID',
  ).sort();
  const observedAt = requiredIsoDate(input, 'observedAt');
  const candidateInput = requiredRecord(
    input.candidate,
    'KNOWLEDGE_CANDIDATE_INVALID',
  );
  const candidate = buildCandidate(candidateInput);
  const versionWarnings = [
    '当前通过 Feishu Drive Search v2 读回源文件，无法证明其属于请求的 Aily 知识空间；空间归属保持 UNCONFIRMED。',
    'FTD 文件声明应回到源应用查看最新版本；本快照只能作为 REFERENCE_ONLY 候选，不能证明 current。',
  ];
  const identity = contextIdentityPayload({
    query,
    target,
    requestedKnowledgeSpaceIds,
    records: [candidate],
    versionWarnings,
  });
  const contextHash = hashCanonical(identity);
  return {
    schemaVersion: CONTEXT_SCHEMA,
    contextId: `KRC-${digest(contextHash).slice(0, 24).toUpperCase()}`,
    contextHash,
    status: 'AVAILABLE_WITH_VERSION_GAPS',
    reasonCode: 'KNOWLEDGE_SOURCE_CURRENTNESS_UNCONFIRMED',
    query,
    targetPackageId: target.packageId,
    targetDocumentId: target.documentId,
    targetDocumentVersionId: target.documentVersionId,
    requestedKnowledgeSpaceIds,
    observedAt,
    records: [candidate],
    versionWarnings,
    authorityBoundary: authorityBoundary(),
  };
}

export function parseBoundKnowledgeRetrievalContext(
  value: unknown,
  expected?: Pick<CurrentKnowledgeTarget, 'packageId' | 'documentId' | 'documentVersionId'>,
): BoundKnowledgeRetrievalContext {
  const input = requiredRecord(value, 'KNOWLEDGE_CONTEXT_INVALID');
  if (requiredText(input, 'schemaVersion') !== CONTEXT_SCHEMA) {
    throw new ConflictException('KNOWLEDGE_CONTEXT_SCHEMA_UNSUPPORTED');
  }
  const status = requiredText(input, 'status');
  if (status !== 'AVAILABLE_WITH_VERSION_GAPS') {
    throw new ConflictException('KNOWLEDGE_CONTEXT_STATUS_UNSUPPORTED');
  }
  const query = requiredText(input, 'query');
  const targetPackageId = requiredText(input, 'targetPackageId');
  const targetDocumentId = requiredText(input, 'targetDocumentId');
  const targetDocumentVersionId = requiredText(input, 'targetDocumentVersionId');
  if (
    expected &&
    (targetPackageId !== expected.packageId ||
      targetDocumentId !== expected.documentId ||
      targetDocumentVersionId !== expected.documentVersionId)
  ) {
    throw new ConflictException('KNOWLEDGE_CONTEXT_TARGET_MISMATCH');
  }
  const requestedKnowledgeSpaceIds = requiredTextArray(
    input.requestedKnowledgeSpaceIds,
    'KNOWLEDGE_SPACE_IDS_INVALID',
  ).sort();
  const observedAt = requiredIsoDate(input, 'observedAt');
  const recordsInput = requiredArray(input.records, 'KNOWLEDGE_RECORDS_INVALID');
  if (recordsInput.length !== 1) {
    throw new ConflictException('KNOWLEDGE_RECORD_COUNT_INVALID');
  }
  const records = recordsInput.map((item) => parseCandidate(item));
  const versionWarnings = requiredTextArray(
    input.versionWarnings,
    'KNOWLEDGE_WARNINGS_INVALID',
  );
  const target: CurrentKnowledgeTarget = {
    packageId: targetPackageId,
    documentId: targetDocumentId,
    documentVersionId: targetDocumentVersionId,
    documentNumber: '',
    revisionLabel: null,
  };
  const contextHash = hashCanonical(contextIdentityPayload({
    query,
    target,
    requestedKnowledgeSpaceIds,
    records,
    versionWarnings,
  }));
  const contextId = `KRC-${digest(contextHash).slice(0, 24).toUpperCase()}`;
  if (
    requiredText(input, 'contextHash') !== contextHash ||
    requiredText(input, 'contextId') !== contextId ||
    requiredText(input, 'reasonCode') !==
      'KNOWLEDGE_SOURCE_CURRENTNESS_UNCONFIRMED'
  ) {
    throw new ConflictException('KNOWLEDGE_CONTEXT_IDENTITY_MISMATCH');
  }
  assertAuthorityBoundary(input.authorityBoundary);
  return {
    schemaVersion: CONTEXT_SCHEMA,
    contextId,
    contextHash,
    status: 'AVAILABLE_WITH_VERSION_GAPS',
    reasonCode: 'KNOWLEDGE_SOURCE_CURRENTNESS_UNCONFIRMED',
    query,
    targetPackageId,
    targetDocumentId,
    targetDocumentVersionId,
    requestedKnowledgeSpaceIds,
    observedAt,
    records,
    versionWarnings,
    authorityBoundary: authorityBoundary(),
  };
}

export function buildSimilarCaseContext(
  knowledgeContext: BoundKnowledgeRetrievalContext | null,
): SimilarCaseContext {
  if (!knowledgeContext) {
    return {
      status: 'MISSING',
      reasonCode: 'SIMILAR_CASES_NOT_BOUND',
      records: [],
    };
  }
  const records: BoundSimilarCaseContext['records'] =
    knowledgeContext.records.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateHash: candidate.candidateHash,
      sourceTitle: candidate.sourceTitle,
      documentNumber: candidate.documentNumber,
      revisionLabel: candidate.revisionLabel,
      relationshipLevel: candidate.relationshipLevel,
      relationshipReason: candidate.relationshipReason,
      sourceCurrentnessStatus: candidate.sourceCurrentnessStatus,
      authorityLevel: candidate.authorityLevel,
      usableAsCurrentFact: false,
    }));
  const contextHash = hashCanonical({
    schemaVersion: SIMILAR_CONTEXT_SCHEMA,
    knowledgeContextId: knowledgeContext.contextId,
    knowledgeContextHash: knowledgeContext.contextHash,
    records,
  });
  return {
    schemaVersion: SIMILAR_CONTEXT_SCHEMA,
    contextId: `SCC-${digest(contextHash).slice(0, 24).toUpperCase()}`,
    contextHash,
    status: knowledgeContext.status,
    reasonCode: 'SIMILAR_CASE_CANDIDATE_REFERENCE_ONLY',
    records,
    authorityBoundary: {
      similarCaseIsCurrentFact: false,
      createsEvidenceRef: false,
      createsCurrentEngineerDecision: false,
      createsApplicabilityConclusion: false,
    },
  };
}

function buildCandidate(
  input: Record<string, unknown>,
): FeishuKnowledgeRetrievalCandidate {
  if (
    requiredText(input, 'sourceContainerMembershipStatus') !== 'UNCONFIRMED' ||
    requiredText(input, 'sourceCurrentnessStatus') !==
      'REFERENCE_ONLY_REQUIRES_SOURCE_APP'
  ) {
    throw new ConflictException('KNOWLEDGE_SOURCE_STATUS_INVALID');
  }
  const relationshipLevel = relationshipLevelValue(input.relationshipLevel);
  const sourceFileToken = requiredText(input, 'sourceFileToken');
  const sourceUrl = requiredText(input, 'sourceUrl');
  if (
    !sourceUrl.startsWith('https://') ||
    !sourceUrl.includes(`/file/${sourceFileToken}`)
  ) {
    throw new ConflictException('KNOWLEDGE_SOURCE_URL_INVALID');
  }
  const locators = requiredArray(input.locators, 'KNOWLEDGE_LOCATORS_INVALID')
    .map(parseLocator);
  if (locators.length === 0) {
    throw new ConflictException('KNOWLEDGE_LOCATORS_EMPTY');
  }
  const candidateBase: Omit<FeishuKnowledgeRetrievalCandidate, 'candidateId' | 'candidateHash'> = {
    sourceSystem: 'FEISHU_DRIVE',
    retrievalChannel: 'FEISHU_DRIVE_SEARCH_V2',
    sourceFileToken,
    sourceUrl,
    sourceTitle: requiredText(input, 'sourceTitle'),
    sourceFileVersion: requiredText(input, 'sourceFileVersion'),
    sourceFileByteHash: requiredSha256(input, 'sourceFileByteHash'),
    sourceFileSizeBytes: requiredPositiveInteger(input, 'sourceFileSizeBytes'),
    sourceCreatedAt: requiredIsoDate(input, 'sourceCreatedAt'),
    sourceUpdatedAt: requiredIsoDate(input, 'sourceUpdatedAt'),
    sourceOwnerName: requiredText(input, 'sourceOwnerName'),
    sourceContainerMembershipStatus: 'UNCONFIRMED',
    documentFamily: requiredText(input, 'documentFamily'),
    documentNumber: requiredText(input, 'documentNumber'),
    revisionLabel: optionalText(input, 'revisionLabel'),
    revisionStatus: revisionStatusValue(input.revisionStatus),
    sourceCurrentnessStatus: 'REFERENCE_ONLY_REQUIRES_SOURCE_APP',
    relationshipLevel,
    relationshipReason: requiredText(input, 'relationshipReason'),
    locators,
    extractedClaims: requiredTextArray(
      input.extractedClaims,
      'KNOWLEDGE_CLAIMS_INVALID',
    ),
    affectedCriterionIds: requiredTextArray(
      input.affectedCriterionIds ?? [],
      'KNOWLEDGE_CRITERIA_INVALID',
      true,
    ).sort(),
    authorityLevel: 'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY',
    usableAsCurrentFact: false,
    createsCurrentEngineerDecision: false,
  };
  if (candidateBase.extractedClaims.length === 0) {
    throw new ConflictException('KNOWLEDGE_CLAIMS_EMPTY');
  }
  const candidateHash = hashCanonical(candidateIdentity(candidateBase));
  return {
    candidateId: `KBC-${digest(candidateHash).slice(0, 24).toUpperCase()}`,
    candidateHash,
    ...candidateBase,
  };
}

function parseCandidate(value: unknown): FeishuKnowledgeRetrievalCandidate {
  const input = requiredRecord(value, 'KNOWLEDGE_CANDIDATE_INVALID');
  const candidate = buildCandidate(input);
  if (
    requiredText(input, 'candidateId') !== candidate.candidateId ||
    requiredText(input, 'candidateHash') !== candidate.candidateHash ||
    requiredText(input, 'sourceSystem') !== 'FEISHU_DRIVE' ||
    requiredText(input, 'retrievalChannel') !== 'FEISHU_DRIVE_SEARCH_V2' ||
    requiredText(input, 'authorityLevel') !==
      'KNOWLEDGE_CANDIDATE_REFERENCE_ONLY' ||
    input.usableAsCurrentFact !== false ||
    input.createsCurrentEngineerDecision !== false
  ) {
    throw new ConflictException('KNOWLEDGE_CANDIDATE_IDENTITY_MISMATCH');
  }
  return candidate;
}

function parseLocator(value: unknown): KnowledgeSourceLocator {
  const input = requiredRecord(value, 'KNOWLEDGE_LOCATOR_INVALID');
  const pageStart = requiredPositiveInteger(input, 'pageStart');
  const pageEnd = requiredPositiveInteger(input, 'pageEnd');
  if (pageEnd < pageStart) {
    throw new ConflictException('KNOWLEDGE_LOCATOR_PAGE_RANGE_INVALID');
  }
  return {
    pageStart,
    pageEnd,
    section: requiredText(input, 'section'),
    excerpt: requiredText(input, 'excerpt'),
  };
}

function candidateIdentity(
  candidate: Omit<FeishuKnowledgeRetrievalCandidate, 'candidateId' | 'candidateHash'>,
): unknown {
  return candidate;
}

function contextIdentityPayload(input: {
  query: string;
  target: CurrentKnowledgeTarget;
  requestedKnowledgeSpaceIds: string[];
  records: KnowledgeRetrievalCandidate[];
  versionWarnings: string[];
}): unknown {
  return {
    schemaVersion: CONTEXT_SCHEMA,
    status: 'AVAILABLE_WITH_VERSION_GAPS',
    reasonCode: 'KNOWLEDGE_SOURCE_CURRENTNESS_UNCONFIRMED',
    query: input.query,
    targetPackageId: input.target.packageId,
    targetDocumentId: input.target.documentId,
    targetDocumentVersionId: input.target.documentVersionId,
    requestedKnowledgeSpaceIds: input.requestedKnowledgeSpaceIds,
    records: input.records.map((record) => ({
      candidateId: record.candidateId,
      candidateHash: record.candidateHash,
    })),
    versionWarnings: input.versionWarnings,
    authorityBoundary: authorityBoundary(),
  };
}

function authorityBoundary(): BoundKnowledgeRetrievalContext['authorityBoundary'] {
  return {
    knowledgeCandidateIsCurrentFact: false,
    sourceContainerMembershipConfirmed: false,
    createsEvidenceRef: false,
    createsCurrentEngineerDecision: false,
    createsApplicabilityConclusion: false,
  };
}

function assertAuthorityBoundary(value: unknown): void {
  const input = requiredRecord(value, 'KNOWLEDGE_AUTHORITY_INVALID');
  for (const key of Object.keys(authorityBoundary())) {
    if (input[key] !== false) {
      throw new ConflictException('KNOWLEDGE_AUTHORITY_ESCALATION');
    }
  }
}

function relationshipLevelValue(value: unknown): SimilarCaseRelationshipLevel {
  if (
    value === 'L2_SAME_FAMILY_ATA_MODEL_TOPIC' ||
    value === 'L3_SEMANTICALLY_RELATED_REFERENCE'
  ) return value;
  throw new ConflictException('KNOWLEDGE_RELATIONSHIP_INVALID');
}

function revisionStatusValue(
  value: unknown,
): FeishuKnowledgeRetrievalCandidate['revisionStatus'] {
  if (value === 'OBSERVED_LABEL' || value === 'VERSION_UNCONFIRMED') return value;
  throw new ConflictException('KNOWLEDGE_REVISION_STATUS_INVALID');
}

function requiredRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConflictException(code);
  }
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, code: string): unknown[] {
  if (!Array.isArray(value)) throw new ConflictException(code);
  return value;
}

function requiredText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ConflictException(`KNOWLEDGE_FIELD_INVALID:${field}`);
  }
  return value.trim();
}

function optionalText(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  throw new ConflictException(`KNOWLEDGE_FIELD_INVALID:${field}`);
}

function requiredTextArray(
  value: unknown,
  code: string,
  allowEmpty = false,
): string[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || item.trim().length === 0)
  ) throw new ConflictException(code);
  const normalized = value.map((item) => (item as string).trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new ConflictException(`${code}:DUPLICATE`);
  }
  return normalized;
}

function requiredIsoDate(record: Record<string, unknown>, field: string): string {
  const value = requiredText(record, field);
  if (Number.isNaN(Date.parse(value))) {
    throw new ConflictException(`KNOWLEDGE_DATE_INVALID:${field}`);
  }
  return new Date(value).toISOString();
}

function requiredPositiveInteger(
  record: Record<string, unknown>,
  field: string,
): number {
  const value = record[field];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ConflictException(`KNOWLEDGE_INTEGER_INVALID:${field}`);
  }
  return value as number;
}

function requiredSha256(record: Record<string, unknown>, field: string): string {
  const value = requiredText(record, field);
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new ConflictException(`KNOWLEDGE_HASH_INVALID:${field}`);
  }
  return value;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function digest(hash: string): string {
  return hash.startsWith('sha256:') ? hash.slice(7) : hash;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
