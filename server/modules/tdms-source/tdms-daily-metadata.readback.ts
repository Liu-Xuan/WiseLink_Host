import {
  prepareTdmsDailyMetadataImport,
  validateTdmsDailyMetadataImportReceipt,
  type TdmsDailyMetadataPackage,
} from './tdms-daily-metadata-contract';
import { canonical } from './tdms-source.validation';
import { sameScope } from './tdms-source.authorization';
import {
  tdmsError,
  type TdmsCapture,
  type TdmsImportMemberClaims,
  type TdmsPublicActor,
  type TdmsSourceScope,
} from './tdms-source.types';

export function dailyRequestId(value: unknown): string {
  if (typeof value !== 'string' || !/^TDMSIMPORT-[a-f0-9]{64}$/u.test(value))
    throw tdmsError('TDMS_DAILY_REQUEST_ID_INVALID');
  return value;
}
export function dailySourceRef(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^TDMS:(?:SNAPSHOT:TDMSSNAP-[a-f0-9]{64}|FIELD:TDMSSNAP-[a-f0-9]{64}:(?:0|[1-9][0-9]{0,3})|RELATION:TDMSEDGE-[a-f0-9]{64})$/u.test(
      value,
    )
  )
    throw tdmsError('TDMS_DAILY_SOURCE_REF_INVALID');
  return value;
}

/** Stored bytes, actor/application binding and receipt must agree before releasing a capture. */
export function storedDailyCapture(
  row: TdmsCapture,
  actor: TdmsPublicActor,
  scope: TdmsSourceScope,
  requireCreator: boolean,
) {
  const saved = row.dailyMetadata;
  if (
    !sameScope(row.scope, scope) ||
    !saved ||
    saved.applicationScopeId !== actor.applicationScopeId ||
    (requireCreator && row.actorId !== actor.canonicalSubject.id)
  )
    throw tdmsError('TDMS_DAILY_CAPTURE_BINDING_CONFLICT', 409);
  try {
    const prepared = prepareTdmsDailyMetadataImport(saved.envelope);
    if (
      row.packageId !== prepared.envelope.requestId ||
      row.packageHash !== prepared.payloadDigest ||
      row.capturedAt !== saved.receipt.importedAt
    )
      throw new Error('capture identity differs');
    validateTdmsDailyMetadataImportReceipt(saved.receipt, prepared.envelope);
    return { ...prepared, receipt: structuredClone(saved.receipt) };
  } catch {
    throw tdmsError('TDMS_DAILY_CAPTURE_INTEGRITY_CONFLICT', 409);
  }
}
export function assertSameDailyEnvelope(
  saved: ReturnType<typeof storedDailyCapture>,
  prepared: ReturnType<typeof prepareTdmsDailyMetadataImport>,
) {
  if (canonical(saved.envelope) !== canonical(prepared.envelope))
    throw tdmsError('TDMS_PACKAGE_IDEMPOTENCY_CONFLICT', 409);
}

/** Exact immutable literals only. OR/VR endpoints stay unresolved, never joined by number. */
export function dailyReferenceRead(pkg: TdmsDailyMetadataPackage, ref: string) {
  const [, kind, entityId, fieldIndexRaw] = dailySourceRef(ref).split(':');
  const snapshot = pkg.records.find((r) => r.snapshotId === entityId) ?? null;
  const fieldIndex = kind === 'FIELD' ? Number(fieldIndexRaw) : null;
  const field =
    fieldIndex === null ? null : (snapshot?.provenance[fieldIndex] ?? null);
  const relation =
    kind === 'RELATION'
      ? (pkg.edges.find((e) => e.edgeId === entityId) ?? null)
      : null;
  if (
    (kind === 'FIELD' && !field) ||
    (kind === 'SNAPSHOT' && !snapshot) ||
    (kind === 'RELATION' && !relation)
  )
    throw tdmsError('TDMS_SOURCE_NOT_FOUND', 404);
  const relatedEdges = snapshot
    ? pkg.edges.filter(
        (e) => e.fromSnapshotId === entityId || e.toSnapshotId === entityId,
      )
    : [];
  const returnedEdges = relation ? [relation] : relatedEdges;
  const recordIds = new Set([
    ...(snapshot ? [snapshot.sourceRecordId] : []),
    ...returnedEdges.flatMap((e) => [e.fromSourceRecordId, e.toSourceRecordId]),
  ]);
  const claims: TdmsImportMemberClaims = {
    records: pkg.records
      .filter((r) => recordIds.has(r.sourceRecordId))
      .map((r) => ({ recordKind: r.kind, sourceRecordId: r.sourceRecordId })),
    relationIds: returnedEdges.map((e) => e.edgeId),
    artifacts: [],
    relatedDocumentVersionIds: [],
  };
  return {
    claims,
    response: {
      schemaVersion: 'wiselink.tdms-source-read.v1',
      sourceSystem: 'TDMS',
      sourceRef: ref,
      reference: {
        sourceRef: ref,
        kind,
        entityId,
        snapshotId: snapshot?.snapshotId ?? null,
        fieldIndex,
        locator: field?.selector ?? relation?.evidenceLocator ?? null,
      },
      snapshot,
      field,
      relation,
      artifactBinding: null,
      relatedEdges,
      artifactBindings: [],
      documentVersionMappings: [],
      limitations: {
        nativeRelationsVerified: false,
        engineeringEvidenceAuthorization: 'NOT_GRANTED_BY_IMPORT',
        executionVerified: false,
        sourceCoverage: pkg.coverage,
        query: pkg.query,
      },
    },
  };
}
