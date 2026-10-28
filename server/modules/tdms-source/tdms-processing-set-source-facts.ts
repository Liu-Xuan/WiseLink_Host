import {
  TDMS_PROCESSING_SET_SCHEMA,
  type TdmsProcessingRevisionSet,
  type TdmsProcessingSetFromRetainedRequest,
  type TdmsProcessingSetProducerDiagnostic,
  type TdmsProcessingSetScope,
} from '@shared/tdms-processing-set.interface';
import type {
  TdmsSourceVersion,
  TdmsRecordKind,
} from '@shared/tdms-source.interface';
import type { TdmsDailyMetadataRecord } from './tdms-daily-metadata-contract';
import type {
  TdmsImportMemberClaims,
  TdmsSourceScope,
} from './tdms-source.types';
import { tdmsError } from './tdms-source.types';
import {
  canonical,
  identifier,
  object,
  strict,
} from './tdms-source.validation';
import { sameScope } from './tdms-source.authorization';
import { TDMS_SET_MAX_BYTES } from './tdms-processing-set.validation';
import type {
  TdmsProcessingCaptureIndex,
  TdmsProcessingCaptureProof,
  TdmsProcessingOwnProof,
  TdmsStoredRevisionMetadata,
} from './tdms-processing-set.types';

export const TDMS_PROCESSING_CAPTURE_LIMIT = 64;
const fail = (): never => {
  throw tdmsError('TDMS_PROCESSING_CAPTURE_INVALID', 409);
};
function decoded(value: unknown): Record<string, unknown> {
  try {
    return object(typeof value === 'string' ? JSON.parse(value) : value);
  } catch {
    return fail();
  }
}
function array(value: unknown, max = 1024): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail();
  return value;
}
function refs(value: unknown, max = 1024): string[] {
  const result: string[] = array(value, max).map((ref: unknown) =>
    identifier(ref),
  );
  if (new Set(result).size !== result.length) return fail();
  return result;
}
function nativeKind(value: unknown): TdmsRecordKind {
  const kind = identifier(value);
  switch (kind) {
    case 'MANUFACTURER_FILE':
    case 'PROCESSING_SHEET':
    case 'ENGINEER_ASSESSMENT':
    case 'COMMENT':
    case 'ENGINEERING_FILE':
    case 'SOURCE_EVENT':
    case 'OBSERVATION':
      return kind;
    default:
      return fail();
  }
}
function sourceKind(value: unknown): TdmsDailyMetadataRecord['kind'] {
  const kind = identifier(value);
  if (
    kind === 'AEO' ||
    kind === 'EXECUTION_FEEDBACK' ||
    kind === 'EXECUTION_STATUS' ||
    kind === 'PROCESSING_ITEM'
  )
    return kind;
  return nativeKind(kind);
}
export function processingScope(value: unknown): TdmsProcessingSetScope {
  const input = object(value);
  strict(input, ['tenantId', 'sourceKey', 'sourceInstanceId', 'scopeId']);
  return {
    tenantId: identifier(input.tenantId),
    sourceKey: identifier(input.sourceKey),
    sourceInstanceId: identifier(input.sourceInstanceId),
    scopeId: identifier(input.scopeId),
  };
}
export function processingFromRetainedRequest(
  value: unknown,
): TdmsProcessingSetFromRetainedRequest {
  if (Buffer.byteLength(canonical(value), 'utf8') > TDMS_SET_MAX_BYTES)
    throw tdmsError('TDMS_SET_SIZE_LIMIT');
  const input = object(value);
  strict(input, [
    'scope',
    'operationRef',
    'captures',
    'processingObservationRef',
    'rootObservationRefs',
    'assessmentObservationRefs',
    'expectedGeneration',
  ]);
  const captures = array(input.captures, TDMS_PROCESSING_CAPTURE_LIMIT).map(
    (entry: unknown) => {
      const row = object(entry);
      strict(row, ['packageId', 'captureRef']);
      return {
        packageId: identifier(row.packageId),
        captureRef: identifier(row.captureRef),
      };
    },
  );
  if (
    !captures.length ||
    new Set(captures.map((row) => row.captureRef)).size !== captures.length
  )
    return fail();
  const expected = input.expectedGeneration;
  if (
    expected !== null &&
    (!Number.isSafeInteger(expected) || Number(expected) < 1)
  )
    throw tdmsError('TDMS_SET_GENERATION_INVALID');
  const request: TdmsProcessingSetFromRetainedRequest = {
    scope: processingScope(input.scope),
    operationRef: identifier(input.operationRef),
    captures,
    processingObservationRef:
      input.processingObservationRef === null
        ? null
        : identifier(input.processingObservationRef),
    rootObservationRefs: refs(input.rootObservationRefs, 16),
    assessmentObservationRefs: refs(
      input.assessmentObservationRefs,
      TDMS_PROCESSING_CAPTURE_LIMIT,
    ),
    expectedGeneration: expected === null ? null : Number(expected),
  };
  const selected: string[] = [
    request.processingObservationRef,
    ...request.rootObservationRefs,
    ...request.assessmentObservationRefs,
  ].filter((ref): ref is string => ref !== null);
  if (new Set(selected).size !== selected.length) return fail();
  return request;
}
export function retainedCaptureIndex(
  value: unknown,
): TdmsProcessingCaptureIndex {
  const input = decoded(value);
  strict(input, [
    'scope',
    'packageId',
    'packageHash',
    'captureRef',
    'applicationScopeId',
    'records',
    'relations',
    'artifacts',
    'recordRevisionRefs',
    'assertionRefs',
  ]);
  const records = array(input.records, TDMS_PROCESSING_CAPTURE_LIMIT).map(
    (entry: unknown) => {
      const row = object(entry);
      strict(row, [
        'snapshotId',
        'itemId',
        'sourceRecordId',
        'sourceKind',
        'nativeKind',
        'sourceRevisionRef',
      ]);
      return {
        snapshotId: identifier(row.snapshotId),
        itemId: identifier(row.itemId),
        sourceRecordId: identifier(row.sourceRecordId),
        sourceKind: sourceKind(row.sourceKind),
        nativeKind: nativeKind(row.nativeKind),
        sourceRevisionRef: identifier(row.sourceRevisionRef),
      };
    },
  );
  const relations = array(input.relations).map((entry: unknown) => {
    const row = object(entry);
    strict(row, [
      'edgeId',
      'nativeRetentionKey',
      'nativeRelationId',
      'assertionRef',
    ]);
    if (row.nativeRelationId !== null) return fail();
    return {
      edgeId: identifier(row.edgeId),
      nativeRetentionKey: identifier(row.nativeRetentionKey),
      nativeRelationId: null,
      assertionRef: identifier(row.assertionRef),
    };
  });
  const artifacts = array(input.artifacts).map((entry: unknown) => {
    const row = object(entry);
    strict(row, [
      'bindingId',
      'memberId',
      'ownerSnapshotId',
      'sourceAttachmentId',
      'sourceAttachmentVersion',
      'ownerSourceVersion',
      'sha256',
      'byteLength',
      'documentVersionId',
      'sourceArtifactId',
      'acquisitionId',
    ]);
    if (
      row.sourceAttachmentVersion !== null ||
      row.documentVersionId !== null ||
      !Number.isSafeInteger(row.byteLength) ||
      Number(row.byteLength) < 1
    )
      return fail();
    return {
      bindingId: identifier(row.bindingId),
      memberId: identifier(row.memberId),
      ownerSnapshotId: identifier(row.ownerSnapshotId),
      sourceAttachmentId: identifier(row.sourceAttachmentId),
      sourceAttachmentVersion: null,
      ownerSourceVersion: sourceVersion(row.ownerSourceVersion),
      sha256: identifier(row.sha256),
      byteLength: Number(row.byteLength),
      documentVersionId: null,
      sourceArtifactId: identifier(row.sourceArtifactId),
      acquisitionId: identifier(row.acquisitionId),
    };
  });
  const result: TdmsProcessingCaptureIndex = {
    scope: processingScope(input.scope),
    packageId: identifier(input.packageId),
    packageHash: identifier(input.packageHash),
    captureRef: identifier(input.captureRef),
    applicationScopeId: identifier(input.applicationScopeId),
    records,
    relations,
    artifacts,
    recordRevisionRefs: refs(input.recordRevisionRefs),
    assertionRefs: refs(input.assertionRefs),
  };
  if (
    canonical(result.recordRevisionRefs) !==
      canonical(records.map((row) => row.sourceRevisionRef)) ||
    canonical(result.assertionRefs) !==
      canonical(relations.map((row) => row.assertionRef)) ||
    records.some((row) => row.itemId !== row.snapshotId) ||
    relations.some((row) => row.edgeId !== row.nativeRetentionKey)
  )
    return fail();
  return result;
}
function sourceVersion(value: unknown): TdmsSourceVersion {
  const row = object(value);
  strict(row, ['rawRevision', 'rawIteration', 'confirmation']);
  if (
    row.confirmation !== 'SOURCE_DECLARED' &&
    row.confirmation !== 'VERSION_UNCONFIRMED'
  )
    return fail();
  return {
    rawRevision: row.rawRevision === null ? null : identifier(row.rawRevision),
    rawIteration:
      row.rawIteration === null ? null : identifier(row.rawIteration),
    confirmation: row.confirmation,
  };
}
export function retainedCaptureProof(
  value: unknown,
): TdmsProcessingCaptureProof {
  const input = decoded(value);
  strict(input, ['captureRef', 'consistent', 'own', 'candidates']);
  if (typeof input.consistent !== 'boolean') return fail();
  const own: TdmsProcessingOwnProof[] = array(
    input.own,
    TDMS_PROCESSING_CAPTURE_LIMIT,
  ).map((entry: unknown) => {
    const row = object(entry);
    strict(row, ['sourceRevisionRef', 'scopeId', 'owners', 'consistent']);
    if (typeof row.consistent !== 'boolean') return fail();
    return {
      sourceRevisionRef: identifier(row.sourceRevisionRef),
      scopeId: identifier(row.scopeId),
      consistent: row.consistent,
      owners: array(row.owners, 2).map((entry: unknown) => {
        const owner = object(entry);
        strict(owner, [
          'sourceRecordId',
          'number',
          'nativeTypeId',
          'sourceVersion',
          'businessVersion',
          'stateRaw',
          'sourceModifiedRaw',
          'observedAt',
        ]);
        if (!Number.isFinite(Date.parse(String(owner.observedAt))))
          return fail();
        return {
          sourceRecordId: identifier(owner.sourceRecordId),
          number: identifier(owner.number),
          nativeTypeId:
            owner.nativeTypeId === null ? null : identifier(owner.nativeTypeId),
          sourceVersion: sourceVersion(owner.sourceVersion),
          businessVersion:
            owner.businessVersion === null
              ? null
              : sourceVersion(owner.businessVersion),
          stateRaw: identifier(owner.stateRaw),
          sourceModifiedRaw: identifier(owner.sourceModifiedRaw),
          observedAt: String(owner.observedAt),
        };
      }),
    };
  });
  const candidates = array(input.candidates).map((entry: unknown) => {
    const row = object(entry);
    strict(row, [
      'assertionRef',
      'sourceRelationId',
      'fromSourceRecordId',
      'toSourceRecordId',
    ]);
    return {
      assertionRef: identifier(row.assertionRef),
      sourceRelationId: identifier(row.sourceRelationId),
      fromSourceRecordId: identifier(row.fromSourceRecordId),
      toSourceRecordId: identifier(row.toSourceRecordId),
    };
  });
  return {
    captureRef: identifier(input.captureRef),
    consistent: input.consistent,
    own,
    candidates,
  };
}
export function captureClaims(
  indices: readonly TdmsProcessingCaptureIndex[],
): TdmsImportMemberClaims {
  return {
    records: indices.flatMap((index) =>
      index.records.map((row) => ({
        recordKind: row.nativeKind,
        sourceRecordId: row.sourceRecordId,
      })),
    ),
    relationIds: indices.flatMap((index) =>
      index.relations.map((row) => row.edgeId),
    ),
    artifacts: indices.flatMap((index) =>
      index.artifacts.map((row) => {
        const owners = index.records.filter(
          (record) => record.snapshotId === row.ownerSnapshotId,
        );
        if (owners.length !== 1) return fail();
        return {
          memberId: row.memberId,
          sourceAttachmentId: row.sourceAttachmentId,
          sourceAttachmentVersion: row.sourceAttachmentVersion,
          owners: owners.map((record) => ({
            recordKind: record.nativeKind,
            sourceRecordId: record.sourceRecordId,
          })),
        };
      }),
    ),
    relatedDocumentVersionIds: [],
  };
}
export function assertCaptureRevisions(
  scope: TdmsSourceScope,
  indices: readonly TdmsProcessingCaptureIndex[],
  revisions: readonly TdmsStoredRevisionMetadata[],
): void {
  const mapped = indices.flatMap((index) =>
    index.records.map((row) => ({ index, row })),
  );
  if (
    mapped.length !== revisions.length ||
    new Set(mapped.map(({ row }) => row.sourceRevisionRef)).size !==
      mapped.length
  )
    return fail();
  for (const { index, row } of mapped) {
    const native = revisions.find(
      (record) => record.record.sourceRevisionRef === row.sourceRevisionRef,
    );
    if (
      !native ||
      !sameScope(scope, index.scope) ||
      !sameScope(scope, native.scope) ||
      native.record.captureRef !== index.captureRef ||
      native.record.sourceRecordId !== row.sourceRecordId ||
      native.record.recordKind !== row.nativeKind
    )
      return fail();
  }
}
export function assertCaptureProof(
  index: TdmsProcessingCaptureIndex,
  proof: TdmsProcessingCaptureProof,
  revisions: readonly TdmsStoredRevisionMetadata[],
): void {
  if (
    !proof.consistent ||
    proof.captureRef !== index.captureRef ||
    proof.own.length !== index.records.length ||
    canonical(
      proof.candidates.map((row) => [row.assertionRef, row.sourceRelationId]),
    ) !==
      canonical(index.relations.map((row) => [row.assertionRef, row.edgeId]))
  )
    return fail();
  for (const row of proof.own) {
    const native = revisions.find(
      (value) => value.record.sourceRevisionRef === row.sourceRevisionRef,
    );
    if (
      !row.consistent ||
      !native ||
      !index.recordRevisionRefs.includes(row.sourceRevisionRef) ||
      row.owners.length !== 2
    )
      return fail();
    for (const owner of row.owners) {
      if (
        owner.sourceRecordId !== native.record.sourceRecordId ||
        canonical(owner.sourceVersion) !==
          canonical(native.record.sourceVersion) ||
        canonical(owner.businessVersion) !==
          canonical(native.record.businessVersion ?? null) ||
        owner.stateRaw !== native.record.state?.rawName ||
        owner.sourceModifiedRaw !== native.record.rawFields.sourceModifiedRaw
      )
        return fail();
    }
    const { observedAt: beforeTime, ...before } = row.owners[0];
    const { observedAt: afterTime, ...after } = row.owners[1];
    if (
      Date.parse(beforeTime) > Date.parse(afterTime) ||
      canonical(before) !== canonical(after)
    )
      return fail();
    const expectedKinds: Record<string, string> = {
      SB_PROCESSING_FORM: 'PROCESSING_SHEET',
      AD_PROCESSING_FORM: 'PROCESSING_SHEET',
      SB_ASSESSMENT_FORM: 'ENGINEER_ASSESSMENT',
      ENGINEERING_ASSESSMENT: 'ENGINEER_ASSESSMENT',
      SB: 'MANUFACTURER_FILE',
      SL: 'MANUFACTURER_FILE',
      AD: 'MANUFACTURER_FILE',
      MT: 'MANUFACTURER_FILE',
      EO: 'ENGINEERING_FILE',
      AEO: 'ENGINEERING_FILE',
      CEO: 'ENGINEERING_FILE',
    };
    if (expectedKinds[row.scopeId] !== native.record.recordKind) return fail();
  }
}
const gaps: string[] = [
  'SOURCE_FAMILY_IDENTITY_UNCONFIRMED',
  'COHORT_IDENTITY_UNCONFIRMED',
  'SOURCE_ROSTER_UNCONFIRMED',
  'EXACT_RELATION_VERSION_MAPPING_UNCONFIRMED',
  'SOURCE_CURRENTNESS_UNCONFIRMED',
  'SOURCE_OBSERVATION_NON_ATOMIC',
];
export function producerDiagnostic(
  acquired: boolean,
): TdmsProcessingSetProducerDiagnostic {
  return {
    code: acquired
      ? 'OBSERVED_PROCESSING_SET_UNRESOLVED'
      : 'PROCESSING_OBSERVATION_NOT_ACQUIRED',
    sourceFamilyConfirmed: false,
    cohortConfirmed: false,
    sourceCurrentness: 'UNKNOWN',
    gaps: acquired ? [...gaps] : ['PROCESSING_OBSERVATION_NOT_ACQUIRED'],
  };
}
export function unresolvedProcessingSet(
  request: TdmsProcessingSetFromRetainedRequest,
  revisions: readonly TdmsStoredRevisionMetadata[],
  indices: readonly TdmsProcessingCaptureIndex[],
  proofs: readonly TdmsProcessingCaptureProof[],
): TdmsProcessingRevisionSet | null {
  const parent = revisions.find(
    (row) =>
      row.record.sourceRevisionRef === request.processingObservationRef &&
      row.record.recordKind === 'PROCESSING_SHEET',
  );
  if (!parent) return null;
  const roots = request.rootObservationRefs.map((ref) =>
    revisions.find((row) => row.record.sourceRevisionRef === ref),
  );
  const members = request.assessmentObservationRefs.map((ref) =>
    revisions.find((row) => row.record.sourceRevisionRef === ref),
  );
  if (
    roots.some(
      (row) =>
        !row ||
        !['MANUFACTURER_FILE', 'ENGINEERING_FILE'].includes(
          row.record.recordKind,
        ),
    ) ||
    members.some(
      (row) => !row || row.record.recordKind !== 'ENGINEER_ASSESSMENT',
    )
  )
    return fail();
  const wanted = [parent, ...roots, ...members];
  if (
    wanted.length !== revisions.length ||
    new Set(wanted.map((row) => row.record.sourceRevisionRef)).size !==
      revisions.length
  )
    return fail();
  const times = revisions
    .map((row) => row.record.observedAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const observed = (from: string, to: string): boolean =>
    proofs.some((proof) =>
      proof.candidates.some(
        (edge) =>
          edge.fromSourceRecordId === from && edge.toSourceRecordId === to,
      ),
    );
  return {
    schemaVersion: TDMS_PROCESSING_SET_SCHEMA,
    scope: request.scope,
    setRevisionRef: request.operationRef,
    // Existing Host recordRef groups retained observations only; there is no Source family proof.
    processingFamilyRef: parent.record.recordRef,
    processingObservationRef: parent.record.sourceRevisionRef,
    cohortRef: null,
    familyIdentityEvidenceRefs: [],
    cohortIdentityEvidenceRefs: [],
    predecessorCohortRef: null,
    successionEvidenceRefs: [],
    supersedesSetRevisionRef: null,
    rootBindings: roots.map((row) => ({
      endpoint: {
        kind: 'NATIVE_RECORD_REVISION',
        sourceRevisionRef: row.record.sourceRevisionRef,
      },
      fileProcessingAssertionRefs: [],
      applicabilityEvidenceRefs: [],
    })),
    rosterEvidenceRefs: [],
    sourceRosterRevision: null,
    captureRefs: indices.map((row) => row.captureRef),
    observationWindow: { before: times[0], after: times[times.length - 1] },
    membershipCoverage: 'UNKNOWN',
    versionMappingCoverage: 'UNKNOWN',
    approvedBodyCaptureCoverage: 'UNKNOWN',
    approvalReadiness: 'UNKNOWN',
    sourceConsistency: 'NON_ATOMIC',
    sourceTransactionRef: null,
    currentness: 'UNKNOWN',
    currentnessEvidenceRefs: [],
    gaps: [
      ...gaps,
      ...roots
        .filter(
          (row) =>
            !observed(row.record.sourceRecordId, parent.record.sourceRecordId),
        )
        .map(
          (row) =>
            'ROOT_REQUEST_WITHOUT_SOURCE_RELATION:' +
            row.record.sourceRevisionRef,
        ),
    ],
    members: members.map((row) => ({
      memberRef: row.record.recordRef,
      assessmentFamilyRef: null,
      assessmentBusinessRevisionKey: null,
      assessmentObservationRef: row.record.sourceRevisionRef,
      membershipResolution: observed(
        parent.record.sourceRecordId,
        row.record.sourceRecordId,
      )
        ? 'OBSERVED_ONLY'
        : 'UNRESOLVED',
      expectedSourceRecordId: row.record.sourceRecordId,
      processingAssessmentAssertionRefs: [],
      cohortMembershipEvidenceRefs: [],
      assessmentSuccessionEvidenceRefs: [],
      gaps: [
        'COHORT_MEMBERSHIP_UNCONFIRMED',
        'EXACT_RELATION_VERSION_MAPPING_UNCONFIRMED',
        ...(observed(parent.record.sourceRecordId, row.record.sourceRecordId)
          ? []
          : ['MEMBER_REQUEST_WITHOUT_SOURCE_RELATION']),
      ],
    })),
  };
}
