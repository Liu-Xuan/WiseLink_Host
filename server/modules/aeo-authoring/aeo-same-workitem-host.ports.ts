/**
 * Host-owned same-WorkItem read seams and strict projection normalizers.
 *
 * This file contains no Aily tool, transport, controller or identity resolver.
 * The historical five-tool Aily implementation remains INTERNAL_LAB only.
 */
import {
  type AeoSimilarCandidateSummary,
  type AeoWorkItemReadModel,
  type AeoWorkItemReadRequest,
} from '../../../shared/aeo-integration';

import {
  isRecord,
  projectionError,
  requireExactKeys,
  requireNonEmptyString,
  requirePositiveInteger,
} from './aeo-editor-projection.utils';

export const AEO_WORK_ITEM_READ_PORT = Symbol('AEO_WORK_ITEM_READ_PORT');
export const AEO_SIMILAR_SEARCH_PORT = Symbol('AEO_SIMILAR_SEARCH_PORT');

export interface AeoWorkItemReadPort {
  read(request: AeoWorkItemReadRequest): Promise<unknown>;
}

export interface AeoSimilarSearchPort {
  search(request: {
    workItem: AeoWorkItemReadModel;
    query: string;
    sourceKinds?: AeoSimilarCandidateSummary['sourceKind'][];
  }): Promise<unknown>;
}

export async function searchAeoAuthoringCandidates(
  similar: AeoSimilarSearchPort,
  workItem: AeoWorkItemReadModel,
  seed: AeoSimilarCandidateSummary[] = [],
): Promise<AeoSimilarCandidateSummary[]> {
  const searched = normalizeSimilarCandidates(
    await similar.search({
      workItem,
      query: [
        workItem.aeoTargetIdentity.value,
        workItem.aeo.summary,
        workItem.sourceContext.document.documentVersionId,
      ].join(' '),
    }),
  );
  const merged = new Map<string, AeoSimilarCandidateSummary>();
  for (const candidate of [...normalizeSimilarCandidates(seed), ...searched]) {
    merged.set(candidate.candidateId, candidate);
  }
  return Array.from(merged.values());
}

export class UnconfiguredAeoWorkItemReadPort implements AeoWorkItemReadPort {
  async read(): Promise<AeoWorkItemReadModel> {
    projectionError(
      'CANONICAL_WORKITEM_READ_UNAVAILABLE',
      'CanonicalWorkItemStore fresh-read port 尚未冻结。',
    );
  }
}

export class UnconfiguredAeoSimilarSearchPort implements AeoSimilarSearchPort {
  async search(): Promise<AeoSimilarCandidateSummary[]> {
    projectionError(
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      'AEO 相似检索 read port 尚未冻结。',
    );
  }
}

export function normalizeWorkItemReadModel(
  value: unknown,
): AeoWorkItemReadModel {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'WorkItem 投影必须是对象。');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'workItemId',
      'requestId',
      'stateVersion',
      'permissionSnapshotVersion',
      'sourceDocumentFamily',
      'authoringPurpose',
      'aeoTargetIdentity',
      'validationRun',
      'sourceContext',
      'authoringSeed',
      'aeo',
      'artifactIndex',
      'todos',
      'observedAt',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'workItem',
  );
  if (
    value.schemaVersion !== 'wiselink.3_1.aeo_artifact_index.v0.candidate.2'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'WorkItem 投影 schemaVersion 不受支持。',
    );
  }
  const sourceDocumentFamily = normalizeSourceDocumentFamily(
    value.sourceDocumentFamily,
  );
  if (value.authoringPurpose !== 'AEO') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringPurpose 必须是 AEO。',
    );
  }
  const aeoTargetIdentity = normalizeAeoTargetIdentity(value.aeoTargetIdentity);
  const sourceContext = normalizeSourceContext(
    value.sourceContext,
    sourceDocumentFamily,
  );
  const authoringSeed = normalizeAuthoringSeed(value.authoringSeed);
  const aeo = normalizeWorkItemAeo(value.aeo);
  if (!Array.isArray(value.artifactIndex) || !Array.isArray(value.todos)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'artifactIndex 和 todos 必须是数组。',
    );
  }
  const observedAt = requireNonEmptyString(
    value.observedAt,
    'WORKITEM_PROJECTION_INVALID',
    'observedAt',
  );
  if (Number.isNaN(Date.parse(observedAt))) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'observedAt 必须是有效时间。',
    );
  }
  return {
    schemaVersion: 'wiselink.3_1.aeo_artifact_index.v0.candidate.2',
    workItemId: requireNonEmptyString(
      value.workItemId,
      'WORKITEM_PROJECTION_INVALID',
      'workItemId',
    ),
    requestId: requireNonEmptyString(
      value.requestId,
      'WORKITEM_PROJECTION_INVALID',
      'requestId',
    ),
    stateVersion: requirePositiveInteger(
      value.stateVersion,
      'WORKITEM_PROJECTION_INVALID',
      'stateVersion',
    ),
    permissionSnapshotVersion: requireNonEmptyString(
      value.permissionSnapshotVersion,
      'WORKITEM_PROJECTION_INVALID',
      'permissionSnapshotVersion',
    ),
    sourceDocumentFamily,
    authoringPurpose: 'AEO',
    aeoTargetIdentity,
    validationRun: normalizeValidationRun(value.validationRun),
    sourceContext,
    authoringSeed,
    aeo,
    artifactIndex: value.artifactIndex.map(normalizeArtifactIndexEntry),
    todos: value.todos.map(normalizeTodo),
    observedAt,
  };
}

function normalizeValidationRun(
  value: unknown,
): AeoWorkItemReadModel['validationRun'] {
  if (value === null) return null;
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'validationRun 必须是对象或 null。',
    );
  }
  requireExactKeys(
    value,
    [
      'purpose',
      'runId',
      'manifestArtifactRef',
      'manifestArtifactSha256',
      'authorizedByDecisionId',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'validationRun',
  );
  if (value.purpose !== 'AEO_CANDIDATE_VERTICAL') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'validationRun purpose 不受支持。',
    );
  }
  return {
    purpose: 'AEO_CANDIDATE_VERTICAL',
    runId: requireNonEmptyString(
      value.runId,
      'WORKITEM_PROJECTION_INVALID',
      'validationRun.runId',
    ),
    manifestArtifactRef: requireArtifactRef(
      value.manifestArtifactRef,
      'validationRun.manifestArtifactRef',
    ),
    manifestArtifactSha256: requireSha256String(
      value.manifestArtifactSha256,
      'validationRun.manifestArtifactSha256',
    ),
    authorizedByDecisionId: requireNonEmptyString(
      value.authorizedByDecisionId,
      'WORKITEM_PROJECTION_INVALID',
      'validationRun.authorizedByDecisionId',
    ),
  };
}

function normalizeSourceDocumentFamily(
  value: unknown,
): AeoWorkItemReadModel['sourceDocumentFamily'] {
  if (value !== 'AEO' && value !== 'SB') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceDocumentFamily 必须是 AEO 或 SB。',
    );
  }
  return value;
}

function normalizeAeoTargetIdentity(
  value: unknown,
): AeoWorkItemReadModel['aeoTargetIdentity'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'aeoTargetIdentity 必须是 server fresh-read 对象。',
    );
  }
  requireExactKeys(
    value,
    ['value', 'confirmationStatus', 'authority', 'confirmationRef'],
    'WORKITEM_PROJECTION_INVALID',
    'aeoTargetIdentity',
  );
  if (
    value.confirmationStatus !== 'HUMAN_CONFIRMED' ||
    value.authority !== 'CANONICAL_WORKITEM_SERVER_FRESH_READ'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'aeoTargetIdentity 必须来自 server fresh-read 的人工确认记录。',
    );
  }
  return {
    value: requireNonEmptyString(
      value.value,
      'WORKITEM_PROJECTION_INVALID',
      'aeoTargetIdentity.value',
    ),
    confirmationStatus: 'HUMAN_CONFIRMED',
    authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
    confirmationRef: requireArtifactRef(
      value.confirmationRef,
      'aeoTargetIdentity.confirmationRef',
    ),
  };
}

function normalizeSourceContext(
  value: unknown,
  sourceDocumentFamily: AeoWorkItemReadModel['sourceDocumentFamily'],
): AeoWorkItemReadModel['sourceContext'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['document', 'parsedPackage', 'assessment'],
    'WORKITEM_PROJECTION_INVALID',
    'sourceContext',
  );
  const assessment = normalizeAssessmentContext(value.assessment);
  if (sourceDocumentFamily === 'SB' && assessment === null) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'SB source WorkItem 必须带 current Assessment exact ref。',
    );
  }
  return {
    document: normalizeSourceDocument(value.document),
    parsedPackage: normalizeSourceParsedPackage(
      value.parsedPackage,
      'sourceContext.parsedPackage',
    ),
    assessment,
  };
}

function normalizeSourceParsedPackage(
  value: unknown,
  field: string,
): AeoWorkItemReadModel['sourceContext']['parsedPackage'] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', `${field} 必须是对象。`);
  }
  requireExactKeys(
    value,
    [
      'packageId',
      'artifactRef',
      'artifactSha256',
      'contractId',
      'contractRevision',
      'readerReceiptId',
      'fullValidatorRevision',
      'validationStatus',
    ],
    'WORKITEM_PROJECTION_INVALID',
    field,
  );
  if (value.validationStatus !== 'ACCEPTED') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须有 ACCEPTED Reader receipt。`,
    );
  }
  return {
    packageId: requireNonEmptyString(
      value.packageId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.packageId`,
    ),
    artifactRef: requireArtifactRef(value.artifactRef, `${field}.artifactRef`),
    artifactSha256: requireSha256String(
      value.artifactSha256,
      `${field}.artifactSha256`,
    ),
    contractId: requireNonEmptyString(
      value.contractId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractId`,
    ),
    contractRevision: requireNonEmptyString(
      value.contractRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractRevision`,
    ),
    readerReceiptId: requireNonEmptyString(
      value.readerReceiptId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.readerReceiptId`,
    ),
    fullValidatorRevision: requireNonEmptyString(
      value.fullValidatorRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.fullValidatorRevision`,
    ),
    validationStatus: 'ACCEPTED',
  };
}

function normalizeSourceDocument(
  value: unknown,
): AeoWorkItemReadModel['sourceContext']['document'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'documentId',
      'documentVersionId',
      'classificationStatus',
      'catalogRole',
      'classificationFingerprint',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'sourceContext.document',
  );
  if (
    value.classificationStatus !== 'CONFIRMED' ||
    value.catalogRole !== 'CanonicalDocumentCatalog'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document 必须是 Catalog CONFIRMED exact version。',
    );
  }
  return {
    documentId: requireNonEmptyString(
      value.documentId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document.documentId',
    ),
    documentVersionId: requireNonEmptyString(
      value.documentVersionId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.document.documentVersionId',
    ),
    classificationStatus: 'CONFIRMED',
    catalogRole: 'CanonicalDocumentCatalog',
    classificationFingerprint: requireSha256Fingerprint(
      value.classificationFingerprint,
      'sourceContext.document.classificationFingerprint',
    ),
  };
}

function normalizeAuthoringSeed(
  value: unknown,
): AeoWorkItemReadModel['authoringSeed'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    ['document', 'parsedPackage', 'aeoIdentity'],
    'WORKITEM_PROJECTION_INVALID',
    'authoringSeed',
  );
  const document = normalizeAuthoringSeedDocument(value.document);
  return {
    document,
    parsedPackage: normalizeAcceptedParsedPackage(
      value.parsedPackage,
      'authoringSeed.parsedPackage',
    ),
    aeoIdentity: requireNonEmptyString(
      value.aeoIdentity,
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.aeoIdentity',
    ),
  };
}

function normalizeAuthoringSeedDocument(
  value: unknown,
): AeoWorkItemReadModel['authoringSeed']['document'] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'documentId',
      'documentVersionId',
      'family',
      'classificationStatus',
      'catalogRole',
      'classificationFingerprint',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'authoringSeed.document',
  );
  if (
    value.family !== 'AEO' ||
    value.classificationStatus !== 'CONFIRMED' ||
    value.catalogRole !== 'CanonicalDocumentCatalog'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document 必须是 Catalog CONFIRMED 的 AEO exact version。',
    );
  }
  return {
    documentId: requireNonEmptyString(
      value.documentId,
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document.documentId',
    ),
    documentVersionId: requireNonEmptyString(
      value.documentVersionId,
      'WORKITEM_PROJECTION_INVALID',
      'authoringSeed.document.documentVersionId',
    ),
    family: 'AEO',
    classificationStatus: 'CONFIRMED',
    catalogRole: 'CanonicalDocumentCatalog',
    classificationFingerprint: requireSha256Fingerprint(
      value.classificationFingerprint,
      'authoringSeed.document.classificationFingerprint',
    ),
  };
}

function normalizeAcceptedParsedPackage(
  value: unknown,
  field: string,
): AeoWorkItemReadModel['authoringSeed']['parsedPackage'] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', `${field} 必须是对象。`);
  }
  requireExactKeys(
    value,
    [
      'packageId',
      'artifactRef',
      'artifactSha256',
      'contractId',
      'contractRevision',
      'readerReceiptId',
      'readerRevision',
      'validationStatus',
    ],
    'WORKITEM_PROJECTION_INVALID',
    field,
  );
  if (value.validationStatus !== 'ACCEPTED') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须有 ACCEPTED Reader receipt。`,
    );
  }
  return {
    packageId: requireNonEmptyString(
      value.packageId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.packageId`,
    ),
    artifactRef: requireArtifactRef(value.artifactRef, `${field}.artifactRef`),
    artifactSha256: requireSha256String(
      value.artifactSha256,
      `${field}.artifactSha256`,
    ),
    contractId: requireNonEmptyString(
      value.contractId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractId`,
    ),
    contractRevision: requireNonEmptyString(
      value.contractRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.contractRevision`,
    ),
    readerReceiptId: requireNonEmptyString(
      value.readerReceiptId,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.readerReceiptId`,
    ),
    readerRevision: requireNonEmptyString(
      value.readerRevision,
      'WORKITEM_PROJECTION_INVALID',
      `${field}.readerRevision`,
    ),
    validationStatus: 'ACCEPTED',
  };
}

function normalizeAssessmentContext(
  value: unknown,
): AeoWorkItemReadModel['sourceContext']['assessment'] {
  if (value === null) return null;
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment 必须是对象或 null。',
    );
  }
  requireExactKeys(
    value,
    [
      'status',
      'criterionSetId',
      'criterionCount',
      'evaluationItemCount',
      'packageStatus',
      'applicabilityOverall',
      'authorityLevel',
      'blocksEngineeringClosure',
      'externalDiscoveryStatus',
      'externalDiscoveryIsEvidence',
      'previousOverallStale',
      'staleReason',
      'currentContextHash',
      'currentTransportHash',
      'artifactRef',
      'artifactSha256',
      'artifactByteLength',
      'evaluateAttemptId',
      'resynthesisAttemptId',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'sourceContext.assessment',
  );
  if (
    !['CANDIDATE_ONLY', 'CANDIDATE_ONLY_RESYNTHESIZED'].includes(
      String(value.status),
    ) ||
    value.authorityLevel !== 'candidate_only' ||
    value.blocksEngineeringClosure !== true ||
    value.externalDiscoveryIsEvidence !== false
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'Assessment 必须保持 candidate_only、阻断工程关闭且 discovery 非证据。',
    );
  }
  if (
    value.staleReason !== null &&
    value.staleReason !== 'ENGINEER_ITEM_SET_CHANGED' &&
    value.staleReason !== 'EXTERNAL_CONTEXT_STALE'
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'Assessment staleReason 不受支持。',
    );
  }
  return {
    status: value.status as NonNullable<
      AeoWorkItemReadModel['sourceContext']['assessment']
    >['status'],
    criterionSetId: requireNonEmptyString(
      value.criterionSetId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.criterionSetId',
    ),
    criterionCount: requirePositiveInteger(
      value.criterionCount,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.criterionCount',
    ),
    evaluationItemCount: requirePositiveInteger(
      value.evaluationItemCount,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.evaluationItemCount',
    ),
    packageStatus: requireNonEmptyString(
      value.packageStatus,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.packageStatus',
    ),
    applicabilityOverall: requireNonEmptyString(
      value.applicabilityOverall,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.applicabilityOverall',
    ),
    authorityLevel: 'candidate_only',
    blocksEngineeringClosure: true,
    externalDiscoveryStatus:
      value.externalDiscoveryStatus === null
        ? null
        : requireNonEmptyString(
            value.externalDiscoveryStatus,
            'WORKITEM_PROJECTION_INVALID',
            'sourceContext.assessment.externalDiscoveryStatus',
          ),
    externalDiscoveryIsEvidence: false,
    previousOverallStale: requireBoolean(
      value.previousOverallStale,
      'sourceContext.assessment.previousOverallStale',
    ),
    staleReason: value.staleReason as NonNullable<
      AeoWorkItemReadModel['sourceContext']['assessment']
    >['staleReason'],
    currentContextHash: requireSha256Fingerprint(
      value.currentContextHash,
      'sourceContext.assessment.currentContextHash',
    ),
    currentTransportHash: requireSha256Fingerprint(
      value.currentTransportHash,
      'sourceContext.assessment.currentTransportHash',
    ),
    artifactRef: requireArtifactRef(
      value.artifactRef,
      'sourceContext.assessment.artifactRef',
    ),
    artifactSha256: requireSha256String(
      value.artifactSha256,
      'sourceContext.assessment.artifactSha256',
    ),
    artifactByteLength: requirePositiveInteger(
      value.artifactByteLength,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.artifactByteLength',
    ),
    evaluateAttemptId: requireNonEmptyString(
      value.evaluateAttemptId,
      'WORKITEM_PROJECTION_INVALID',
      'sourceContext.assessment.evaluateAttemptId',
    ),
    resynthesisAttemptId:
      value.resynthesisAttemptId === null
        ? null
        : requireNonEmptyString(
            value.resynthesisAttemptId,
            'WORKITEM_PROJECTION_INVALID',
            'sourceContext.assessment.resynthesisAttemptId',
          ),
  };
}

function normalizeWorkItemAeo(value: unknown): AeoWorkItemReadModel['aeo'] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo 必须是对象。');
  }
  requireExactKeys(
    value,
    ['state', 'stateVersion', 'summary', 'blockers'],
    'WORKITEM_PROJECTION_INVALID',
    'aeo',
  );
  const states = new Set([
    'NOT_STARTED',
    'PARSE_READY',
    'AUTHORING',
    'CHECKPOINTED',
    'BLOCKED',
  ]);
  if (typeof value.state !== 'string' || !states.has(value.state)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo.state 不受支持。');
  }
  if (!Array.isArray(value.blockers)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo.blockers 必须是数组。');
  }
  const summary = requireNonEmptyString(
    value.summary,
    'WORKITEM_PROJECTION_INVALID',
    'aeo.summary',
  );
  if (summary.length > 2_000) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'aeo.summary 过长。');
  }
  return {
    state: value.state as AeoWorkItemReadModel['aeo']['state'],
    stateVersion: requireNonEmptyString(
      value.stateVersion,
      'WORKITEM_PROJECTION_INVALID',
      'aeo.stateVersion',
    ),
    summary,
    blockers: value.blockers.map((item, index) => {
      const blocker = requireNonEmptyString(
        item,
        'WORKITEM_PROJECTION_INVALID',
        `aeo.blockers[${index}]`,
      );
      if (blocker.length > 2_000) {
        projectionError('WORKITEM_PROJECTION_INVALID', 'AEO blocker 过长。');
      }
      return blocker;
    }),
  };
}

function normalizeArtifactIndexEntry(
  value: unknown,
): AeoWorkItemReadModel['artifactIndex'][number] {
  if (!isRecord(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'artifact entry 必须是对象。',
    );
  }
  requireExactKeys(
    value,
    [
      'artifactKind',
      'storeRole',
      'artifactRef',
      'artifactSha256',
      'byteLength',
      'mediaType',
      'schemaVersion',
      'workingRevision',
      'casToken',
      'state',
    ],
    'WORKITEM_PROJECTION_INVALID',
    'artifactIndex[]',
  );
  const kinds = new Set([
    'SOURCE_DOCUMENT',
    'PARSED_PACKAGE',
    'AUTHORING_BOOTSTRAP',
    'WORKING_COPY',
    'DRAFT_PACKAGE',
    'WORD_EXPORT',
    'RELEASE_PACKAGE',
    'XML_EXPORT',
  ]);
  const states = new Set(['AVAILABLE', 'CANDIDATE', 'BLOCKED']);
  if (
    typeof value.artifactKind !== 'string' ||
    !kinds.has(value.artifactKind)
  ) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'artifactKind 不受支持。');
  }
  if (value.storeRole !== 'CanonicalArtifactStore') {
    projectionError('WORKITEM_PROJECTION_INVALID', 'artifact storeRole 错误。');
  }
  if (typeof value.state !== 'string' || !states.has(value.state)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'artifact state 不受支持。');
  }
  const artifactRef = requireArtifactRef(value.artifactRef, 'artifactRef');
  const sha256 = requireSha256String(value.artifactSha256, 'artifactSha256');
  if (
    value.workingRevision !== null &&
    (!Number.isInteger(value.workingRevision) ||
      Number(value.workingRevision) < 1)
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'workingRevision 必须是正整数或 null。',
    );
  }
  if (value.casToken !== null && typeof value.casToken !== 'string') {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      'casToken 必须是字符串或 null。',
    );
  }
  return {
    artifactKind:
      value.artifactKind as AeoWorkItemReadModel['artifactIndex'][number]['artifactKind'],
    storeRole: 'CanonicalArtifactStore',
    artifactRef,
    artifactSha256: sha256,
    byteLength: requirePositiveInteger(
      value.byteLength,
      'WORKITEM_PROJECTION_INVALID',
      'artifact.byteLength',
    ),
    mediaType: requireNonEmptyString(
      value.mediaType,
      'WORKITEM_PROJECTION_INVALID',
      'artifact.mediaType',
    ),
    schemaVersion: requireNonEmptyString(
      value.schemaVersion,
      'WORKITEM_PROJECTION_INVALID',
      'artifact.schemaVersion',
    ),
    workingRevision: value.workingRevision as number | null,
    casToken: value.casToken as string | null,
    state:
      value.state as AeoWorkItemReadModel['artifactIndex'][number]['state'],
  };
}

function normalizeTodo(value: unknown): AeoWorkItemReadModel['todos'][number] {
  if (!isRecord(value)) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'todo 必须是对象。');
  }
  requireExactKeys(
    value,
    ['todoId', 'label', 'state'],
    'WORKITEM_PROJECTION_INVALID',
    'todos[]',
  );
  if (!['OPEN', 'DONE', 'BLOCKED'].includes(String(value.state))) {
    projectionError('WORKITEM_PROJECTION_INVALID', 'todo.state 不受支持。');
  }
  return {
    todoId: requireNonEmptyString(
      value.todoId,
      'WORKITEM_PROJECTION_INVALID',
      'todo.todoId',
    ),
    label: requireNonEmptyString(
      value.label,
      'WORKITEM_PROJECTION_INVALID',
      'todo.label',
    ),
    state: value.state as AeoWorkItemReadModel['todos'][number]['state'],
  };
}

export function normalizeSimilarCandidates(
  value: unknown,
): AeoSimilarCandidateSummary[] {
  if (!Array.isArray(value)) {
    projectionError(
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      '相似检索结果必须是数组。',
    );
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      projectionError('AEO_SIMILAR_SEARCH_UNAVAILABLE', '候选必须是对象。');
    }
    requireExactKeys(
      item,
      [
        'candidateId',
        'sourceKind',
        'title',
        'reason',
        'sourceArtifactRef',
        'sourceArtifactSha256',
        'eligibility',
      ],
      'AEO_SIMILAR_SEARCH_UNAVAILABLE',
      'candidate',
    );
    const sourceKinds = new Set([
      'HISTORICAL_AEO',
      'CATEGORY_PATTERN',
      'SB_SOURCE',
      'OEM_REFERENCE',
      'AI_SUGGESTION',
    ]);
    if (
      typeof item.sourceKind !== 'string' ||
      !sourceKinds.has(item.sourceKind)
    ) {
      projectionError(
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        '候选 sourceKind 错误。',
      );
    }
    if (item.eligibility !== 'CANDIDATE_REQUIRES_REVIEW') {
      projectionError(
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        '候选不能自动获得知识资格。',
      );
    }
    return {
      candidateId: requireNonEmptyString(
        item.candidateId,
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        'candidateId',
      ),
      sourceKind: item.sourceKind as AeoSimilarCandidateSummary['sourceKind'],
      title: requireNonEmptyString(
        item.title,
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        'title',
      ),
      reason: requireNonEmptyString(
        item.reason,
        'AEO_SIMILAR_SEARCH_UNAVAILABLE',
        'reason',
      ),
      sourceArtifactRef: requireArtifactRef(
        item.sourceArtifactRef,
        'sourceArtifactRef',
      ),
      sourceArtifactSha256: requireSha256String(
        item.sourceArtifactSha256,
        'sourceArtifactSha256',
      ),
      eligibility: 'CANDIDATE_REQUIRES_REVIEW' as const,
    };
  });
}

function requireArtifactRef(value: unknown, field: string): string {
  const ref = requireNonEmptyString(
    value,
    'WORKITEM_PROJECTION_INVALID',
    field,
  );
  if (
    !/^(artifact|drive|miaoda-file):\/\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/u.test(
      ref,
    )
  ) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须是受控 artifact ref，不能是本机路径或任意 URL。`,
    );
  }
  return ref;
}

function requireSha256String(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须是 lowercase SHA-256。`,
    );
  }
  return value;
}

function requireSha256Fingerprint(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    projectionError(
      'WORKITEM_PROJECTION_INVALID',
      `${field} 必须是 sha256:<64-hex>。`,
    );
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    projectionError('WORKITEM_PROJECTION_INVALID', `${field} 必须是 boolean。`);
  }
  return value;
}
