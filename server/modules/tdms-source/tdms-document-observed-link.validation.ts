import type { TdmsObservedAssociationEvidence } from '@shared/tdms-source-reading.interface';
import type { TdmsSourceVersion } from '@shared/tdms-source.interface';
import { isRequiredTargetOccurrence } from './tdms-reviewed-complete-source-types';
import { reviewedAdItemEfrMetadataOccurrence } from './tdms-reviewed-ad-item-native-model';
import { isCompleteOwnedObservedEdge } from './tdms-complete-owned-source.validation';
import { storedDailyCapture } from './tdms-daily-metadata.readback';
import { sameScope } from './tdms-source.authorization';
import { canonical, hash, identifier, object } from './tdms-source.validation';
import {
  tdmsError,
  type TdmsCapture,
  type TdmsPublicActor,
  type TdmsSourceScope,
  type TdmsStoredRevision,
  type TdmsTransaction,
} from './tdms-source.types';
import type { TdmsProcessingCaptureIndex } from './tdms-processing-set.types';
import type { TdmsDailyMetadataRecord } from './tdms-daily-metadata-contract';

export interface ObservedRetainedCapture {
  index: TdmsProcessingCaptureIndex;
  capture: TdmsCapture;
  revision: TdmsStoredRevision;
  sourceRecord: TdmsDailyMetadataRecord;
  proof: Record<string, unknown>;
}

const invalid = (): never => { throw tdmsError('TDMS_OBSERVED_CAPTURE_INVALID', 409); };
const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid();
  return value;
}

/** Called only after the whole finite index has current exact read admission. */
export async function observedRetainedCapture(
  tx: TdmsTransaction,
  actor: TdmsPublicActor,
  scope: TdmsSourceScope,
  index: TdmsProcessingCaptureIndex,
  revisionRef: string,
): Promise<ObservedRetainedCapture> {
  if (!sameScope(index.scope, scope) || index.applicationScopeId !== actor.applicationScopeId)
    return invalid();
  const capture = await tx.capture(scope, index.packageId);
  if (!capture || capture.receipt.captureRef !== index.captureRef || capture.packageHash !== index.packageHash ||
      capture.receipt.packageId !== index.packageId || capture.receipt.sourceVerification !== 'DECLARED_ONLY' ||
      capture.receipt.engineeringAdoption !== 'NOT_CREATED' || capture.receipt.executionVerified !== false)
    return invalid();
  const saved = storedDailyCapture(capture, actor, scope, false);
  const retained = capture.dailyMetadata?.nativeRetention;
  if (!retained || index.records.length !== 1 ||
      !same(retained.records, index.records) || !same(retained.relations, index.relations) ||
      !same(retained.artifacts, index.artifacts) ||
      !same(capture.receipt.recordRevisionRefs, index.recordRevisionRefs) ||
      !same(capture.receipt.assertionRefs, index.assertionRefs)) return invalid();
  const mapping = index.records[0]!;
  if (mapping.sourceRevisionRef !== revisionRef || saved.envelope.package.records.length !== 1)
    return invalid();
  const sourceRecord = saved.envelope.package.records[0]!;
  const native = capture.dailyMetadata?.adapter?.output.nativePackage.records.filter(
    row => row.itemId === mapping.snapshotId,
  );
  const revision = await tx.revision(actor.tenantId, revisionRef);
  if (!revision || !sameScope(revision.scope, scope) || native?.length !== 1) return invalid();
  const r = revision.record, n = native[0]!;
  if (mapping.snapshotId !== sourceRecord.snapshotId || mapping.sourceRecordId !== sourceRecord.sourceRecordId ||
      mapping.sourceKind !== sourceRecord.kind || mapping.nativeKind !== r.recordKind ||
      r.captureRef !== index.captureRef || r.sourceRevisionRef !== revisionRef ||
      r.sourceRecordId !== sourceRecord.sourceRecordId || r.title !== sourceRecord.number ||
      r.sourceKey !== scope.sourceKey || r.sourceInstanceId !== scope.sourceInstanceId ||
      !same(r.sourceVersion, sourceRecord.sourceVersion) ||
      !same(r.businessVersion ?? null, sourceRecord.businessVersion) || !same(r.state, sourceRecord.state) ||
      r.sourceModifiedAt !== sourceRecord.sourceModifiedAt || r.observedAt !== sourceRecord.observedAt ||
      r.capturedAt !== capture.capturedAt || !same(r.authors, n.authors) || !same(r.fileType, n.fileType) ||
      !same(r.rawFields, sourceRecord.rawFields) || !same(r.content, sourceRecord.content) ||
      !same(r.fieldProvenance, sourceRecord.provenance) ||
      !same(r.fieldSelectors, sourceRecord.provenance.map(field => ({ fieldPath: field.fieldPath, selector: field.selector }))) ||
      !same(r.relatedDocumentVersionIds, n.relatedDocumentVersionIds) || r.sourceVerification !== 'DECLARED_ONLY' ||
      n.sourceRecordId !== r.sourceRecordId || n.recordKind !== r.recordKind ||
      !same(n.rawFields, r.rawFields) || !same(n.content, r.content) ||
      !same(n.sourceVersion, r.sourceVersion) || !same(n.businessVersion ?? null, r.businessVersion ?? null))
    return invalid();
  const proof = object(sourceRecord.rawFields.completeOwnedSource);
  if (proof.mode !== 'COMPLETE_OWN_SOURCE@1' || list(proof.reads).length !== 2)
    return invalid();
  const head = await tx.recordHead(scope, r.recordKind, r.sourceRecordId);
  return { index, capture, revision: { ...revision, record: { ...r,
    selectedHead: head?.sourceRevisionRef === revisionRef } }, sourceRecord, proof };
}

/** Reconstruct the exact frozen Source original package from its retained metadata package. */
export function assertOriginalMetadataOrigin(original: ObservedRetainedCapture,
  metadata: ObservedRetainedCapture, parentOperationId: string): void {
  const o = original.capture.dailyMetadata!.envelope.package;
  const m = metadata.capture.dailyMetadata!.envelope.package;
  if (o.artifactBindings.length !== 1 || m.records.length !== 1 ||
      !same(original.sourceRecord, metadata.sourceRecord)) return invalid();
  const binding = o.artifactBindings[0]!;
  const marker = object(o.query.originalAcquisition);
  if (marker.ownOperationId !== parentOperationId ||
      binding.ownerSnapshotId !== metadata.sourceRecord.snapshotId) return invalid();
  const packageId = 'TDMSORIGINALPKG-' + hash({
    metadataPackageId: m.packageId, owner: metadata.sourceRecord, binding,
  });
  const expected = {
    ...m,
    observedAt: [metadata.sourceRecord.observedAt, binding.observedAt].sort().at(-1),
    records: [metadata.sourceRecord],
    edges: m.edges.filter(edge => edge.fromSnapshotId === metadata.sourceRecord.snapshotId),
    artifactBindings: [binding],
    readFailures: [],
    query: { ...m.query, originalAcquisition: marker },
    packageId,
  };
  if (o.packageId !== packageId || !same(o, expected)) return invalid();
}

function declaredProof(child: ObservedRetainedCapture): Record<string, unknown> {
  const requested = object(child.proof.requestedCriteria);
  const proof = object(requested.sourceProof);
  if (proof.kind !== 'REQUIRED_RELATION_TARGET' || requested.sourceObjectRef !== child.sourceRecord.sourceRecordId ||
      proof.targetRef !== child.sourceRecord.sourceRecordId) return invalid();
  return proof;
}
export function observedParentProof(child: ObservedRetainedCapture) {
  const proof = declaredProof(child);
  const sha = identifier(proof.parentPackageSha256);
  if (!/^[a-f0-9]{64}$/u.test(sha)) return invalid();
  return {
    packageId: identifier(proof.parentPackageId),
    packageSha256: sha,
    operationId: identifier(proof.parentOperationId),
  };
}

function observedLinkInRead(readValue: unknown, occurrence: Record<string, unknown>): {
  table?: Record<string, unknown>; row?: Record<string, unknown>; link: Record<string, unknown>;
} {
  const read = object(readValue);
  const index = Number(occurrence.linkIndex);
  if (!Number.isSafeInteger(index) || index < 0) return invalid();
  if (occurrence.origin === 'RELATION_TABLE') {
    const tables = list(read.relationTables).map(object).filter(table => table.tableId === occurrence.tableId);
    if (tables.length !== 1) return invalid();
    const rows = list(tables[0]!.rows).map(object).filter(row => row.occurrenceId === occurrence.occurrenceId);
    if (rows.length !== 1) return invalid();
    const link = object(list(rows[0]!.sourceLinks)[index]);
    if (!same(rows[0]!.observedVersion, occurrence.sourceVersion) ||
        !same(rows[0]!.treePath, occurrence.treePath)) return invalid();
    return { table: tables[0], row: rows[0], link };
  }
  if (occurrence.origin !== 'OWN_FIELD') return invalid();
  const fields = list(read.fields).map(object).filter(field => field.fieldId === occurrence.fieldId);
  if (fields.length !== 1) return invalid();
  return { link: object(list(fields[0]!.links)[index]) };
}
function assertOccurrenceRead(read: unknown, occurrence: Record<string, unknown>) {
  const found = observedLinkInRead(read, occurrence), link = found.link;
  if (link.targetRef !== occurrence.targetRef || link.rawHref !== occurrence.rawHref ||
      link.numberRaw !== occurrence.numberRaw || link.locator !== occurrence.locator ||
      link.nativeRole !== occurrence.nativeLinkRole ||
      (link.nativeColumnLabel ?? null) !== (occurrence.nativeColumnLabel ?? null) ||
      (link.nativeColumnToken ?? null) !== (occurrence.nativeColumnToken ?? null)) return invalid();
  return found;
}

/** Frozen Source's reference-only exclusions; they do not change the stored edge. */
function referenceOnly(scopeId: string, occurrence: Record<string, unknown>,
  read: Record<string, unknown>, found: ReturnType<typeof observedLinkInRead>): boolean {
  if (scopeId === 'CEO') return true; // CEO's reviewed surface model is not retained by this Host.
  const token = occurrence.nativeColumnToken;
  const optionalToken = (expected: string): boolean => token == null || token === expected;
  const target = String(occurrence.targetRef);
  if (scopeId === 'AEO' && occurrence.tableId === 'relatedStatusLinkTable' && (
    (occurrence.nativeLinkRole === 'STATUS_LINK' && occurrence.nativeColumnLabel === 'Number' &&
      /^(?:OR|VR):com\.airchina\.tdms\.statuslink\.TDMSStatusLink:\d{1,24}$/u.test(target) && optionalToken('number')) ||
    (occurrence.nativeLinkRole === 'FEEDBACK_LINK' && occurrence.nativeColumnLabel === 'Feed Back Order' &&
      /^(?:OR|VR):wt\.doc\.WTDocument:\d{1,24}$/u.test(target) && optionalToken('feedbackOid')) ||
    (occurrence.nativeLinkRole === 'ENGINEERING_DOC_REFERENCE' && occurrence.nativeColumnLabel === 'Document Number' &&
      /^(?:OR|VR):wt\.epm\.EPMDocument:\d{1,24}$/u.test(target) && optionalToken('docOid')))) return true;
  if (scopeId !== 'AD_ITEM' || !found.table || !found.row) return false;
  if (found.table.gridId === 'mytreetable' && token === 'creator' &&
      occurrence.nativeColumnLabel === 'Created By' && /^(?:OR|VR):wt\.org\.WTUser:\d{1,24}$/u.test(target))
    return true;
  const metadata = reviewedAdItemEfrMetadataOccurrence({ scopeId, owner: read.owner,
    read, table: found.table, row: found.row, link: found.link });
  return !!metadata && ['PEO-S', 'PEO-L'].includes(metadata.nativeCategory);
}

/** Both the immutable candidate and both source reads must bind the exact child. */
export async function observedAssociation(tx: TdmsTransaction, scope: TdmsSourceScope,
  rootRef: string, rootCaptureRef: string, navigationParentRef: string,
  parent: ObservedRetainedCapture, child: ObservedRetainedCapture,
): Promise<TdmsObservedAssociationEvidence> {
  const p = declaredProof(child), parentPackage = parent.capture.dailyMetadata!.envelope.package;
  if (p.parentPackageId !== parentPackage.packageId || p.parentPackageSha256 !== parent.capture.packageHash ||
      p.parentSnapshotId !== parent.sourceRecord.snapshotId || p.parentSourceRecordId !== parent.sourceRecord.sourceRecordId ||
      !same(p.parentSourceVersion, parent.sourceRecord.sourceVersion)) return invalid();
  const matches = list(parent.proof.targetOccurrences).map(object).filter(value =>
    value.tableId === p.tableId && value.occurrenceId === p.occurrenceId &&
    value.linkIndex === p.linkIndex && value.targetRef === p.targetRef);
  if (matches.length !== 1) return invalid();
  const occurrence = matches[0]!;
  if (!isRequiredTargetOccurrence(occurrence) || occurrence.relationshipRole === 'OUT_OF_SCOPE_REFERENCE' ||
      occurrence.relationshipRole === 'LCM_AUTHORITY_REFERENCE' ||
      (occurrence.modelRoleOrigin === 'REVIEWED_NATIVE_TREE_MODEL' &&
        (!Array.isArray(occurrence.treePath) || occurrence.treePath.at(-2) !== parent.sourceRecord.sourceRecordId ||
          occurrence.targetRef === parent.sourceRecord.sourceRecordId))) return invalid();
  const requested = object(child.proof.requestedCriteria), expected = object(requested.expectedOwner);
  const targetVersion = object(occurrence.sourceVersion) as unknown as TdmsSourceVersion;
  if (targetVersion.confirmation === 'SOURCE_DECLARED' &&
      (!same(targetVersion, expected.sourceVersion) || !same(targetVersion, child.sourceRecord.sourceVersion))) return invalid();
  const reads = list(parent.proof.reads), first = assertOccurrenceRead(reads[0], occurrence),
    second = assertOccurrenceRead(reads[1], occurrence), lastRead = object(reads[1]);
  if (referenceOnly(String(parent.proof.scopeId), occurrence, lastRead, second)) return invalid();
  if (parent.sourceRecord.sourceVersion.confirmation === 'VERSION_UNCONFIRMED') {
    const owner = object(lastRead.owner), technical = object(owner.technicalVersionEvidence),
      field = object(owner.technicalVersionFieldEvidence);
    if (technical.state !== 'ABSENT' || field.state !== 'ABSENT' ||
        typeof owner.sourceModifiedRaw !== 'string' || !owner.sourceModifiedRaw.trim() ||
        owner.sourceModifiedRaw !== parent.sourceRecord.rawFields.sourceModifiedRaw) return invalid();
  }
  void first;
  const edges = parentPackage.edges.filter(edge => edge.fromSnapshotId === parent.sourceRecord.snapshotId &&
    edge.fromSourceRecordId === parent.sourceRecord.sourceRecordId && edge.toSourceRecordId === child.sourceRecord.sourceRecordId &&
    edge.relationKind === occurrence.tableId && edge.evidenceLocator === occurrence.locator &&
    isCompleteOwnedObservedEdge(edge, parent.sourceRecord));
  if (edges.length !== 1) return invalid();
  const edge = edges[0]!, mapping = parent.index.relations.filter(value => value.edgeId === edge.edgeId);
  if (mapping.length !== 1 || !tx.observedAssertion) return invalid();
  const stored = await tx.observedAssertion(scope, mapping[0]!.assertionRef);
  const assertion = stored?.assertion;
  if (!stored || !sameScope(stored.scope, scope) || !assertion || assertion.captureRef !== parent.index.captureRef ||
      assertion.assertionRef !== mapping[0]!.assertionRef || assertion.sourceRelationId !== edge.edgeId ||
      assertion.authority !== 'CANDIDATE_ONLY' || assertion.controlledKind !== null ||
      assertion.from.kind !== 'UNRESOLVED' || assertion.from.rawIdentity !== edge.fromSourceRecordId ||
      assertion.to.kind !== 'UNRESOLVED' || assertion.to.rawIdentity !== edge.toSourceRecordId ||
      assertion.rawKind !== edge.relationKind || assertion.selector !== edge.evidenceLocator ||
      assertion.observedAt !== edge.observedAt || assertion.sourceVerification !== 'DECLARED_ONLY' ||
      assertion.completionEffect !== 'UNSPECIFIED' || assertion.changeClass !== 'UNSPECIFIED' ||
      !same(assertion.scope, {}) || !same(assertion.rawFields, { dailyObservedEdge: edge })) return invalid();
  return {
    kind: 'SOURCE_OBSERVED_ASSOCIATION', rootRevisionRef: rootRef, rootOriginalCaptureRef: rootCaptureRef,
    parentRevisionRef: navigationParentRef, sourceParentRevisionRef: parent.revision.record.sourceRevisionRef,
    childRevisionRef: child.revision.record.sourceRevisionRef,
    parentCaptureRef: parent.index.captureRef, childCaptureRef: child.index.captureRef,
    parentSourcePackageId: parentPackage.packageId, parentPackageSha256: parent.capture.packageHash,
    parentSnapshotId: parent.sourceRecord.snapshotId, parentSourceRecordId: parent.sourceRecord.sourceRecordId,
    parentSourceVersion: parent.sourceRecord.sourceVersion, childSourceRecordId: child.sourceRecord.sourceRecordId,
    childSourceVersion: child.sourceRecord.sourceVersion, targetSourceVersion: targetVersion,
    tableId: identifier(occurrence.tableId), occurrenceId: identifier(occurrence.occurrenceId),
    linkIndex: Number(occurrence.linkIndex), candidateAssertionRef: mapping[0]!.assertionRef,
    sourceRelationId: edge.edgeId, parentObservedAt: parent.sourceRecord.observedAt,
    childObservedAt: child.sourceRecord.observedAt, parentOperationVerification: 'NOT_RETAINED',
    applicability: 'UNKNOWN', currentness: 'UNKNOWN', completeness: 'UNKNOWN', readback: 'NON_ATOMIC',
  };
}
