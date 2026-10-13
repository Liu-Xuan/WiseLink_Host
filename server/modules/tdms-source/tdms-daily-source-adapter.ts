import { completeOwnedNativeKind } from './tdms-complete-owned-source.validation';
import {
  TDMS_SOURCE_PACKAGE_SCHEMA,
  type TdmsImportReceipt,
  type TdmsRecordKind,
  type TdmsSourcePackage,
} from '@shared/tdms-source.interface';
import {
  prepareTdmsDailySourceImport,
  type TdmsDailyMetadataEnvelope,
} from './tdms-daily-metadata-contract';
import { hash, identifier, sourcePackage } from './tdms-source.validation';
import { tdmsError, type TdmsImportMemberClaims } from './tdms-source.types';

export const TDMS_DAILY_SOURCE_ADAPTER_VERSION =
  'wiselink.tdms-daily-native-adapter.v1';
/** Never infer a relation type, formal document identity, attachment version, or execution. */
export function adaptTdmsDailySource(raw: unknown) {
  const prepared = prepareTdmsDailySourceImport(raw),
    pkg = prepared.envelope.package;
  const recordKind = (
    kind: (typeof pkg.records)[number]['kind'],
  ): TdmsRecordKind =>
    kind === 'AEO'
      ? 'ENGINEERING_FILE'
      : ['EXECUTION_STATUS', 'EXECUTION_FEEDBACK', 'PROCESSING_ITEM'].includes(
            kind,
          )
        ? (completeOwnedNativeKind(kind) as TdmsRecordKind)
        : (kind as TdmsRecordKind);
  const nativePackage: TdmsSourcePackage = {
    schemaVersion: TDMS_SOURCE_PACKAGE_SCHEMA,
    packageId: prepared.envelope.requestId,
    observedAt: pkg.observedAt,
    coverage: structuredClone(pkg.coverage),
    query: {
      requestedCriteria: structuredClone(
        (pkg.query.requestedCriteria as Record<string, unknown>) ?? {},
      ),
      actualCriteria: structuredClone(
        (pkg.query.actualCriteria as Record<string, unknown> | null) ?? null,
      ),
      scopeMatch:
        (pkg.query.scopeMatch as 'MATCHED' | 'MISMATCH' | 'UNKNOWN') ??
        'UNKNOWN',
      ...(Object.hasOwn(pkg.query, 'originalAcquisition')
        ? {
            originalAcquisition: structuredClone(
              pkg.query.originalAcquisition,
            ) as NonNullable<TdmsSourcePackage['query']['originalAcquisition']>,
          }
        : {}),
    },
    readFailures: pkg.readFailures.map((f) => ({
      ...f,
      detail: f.detail ?? 'SOURCE_DETAIL_UNAVAILABLE',
    })),
    records: pkg.records.map((r) => ({
      itemId: r.snapshotId,
      recordKind: recordKind(r.kind),
      sourceRecordId: r.sourceRecordId,
      // Filled from the actual scoped Host head before importPrepared's normal CAS, never from a snapshot ID.
      expectedHeadRevisionRef: null,
      sourceVersion: structuredClone(r.sourceVersion),
      businessVersion: structuredClone(r.businessVersion),
      title: r.number,
      fileType: structuredClone(
        r.rawFields.businessType ?? r.rawFields.storageType ?? null,
      ) as TdmsSourcePackage['records'][number]['fileType'],
      state: structuredClone(r.state),
      authors: r.authors.map((a) => ({
        sourcePersonId: (a.sourcePersonId as string | null) ?? null,
        name: (a.name as string | null) ?? null,
        role: (a.role as string | null) ?? null,
      })),
      sourceModifiedAt: r.sourceModifiedAt,
      observedAt: r.observedAt,
      coverage: structuredClone(r.coverage),
      rawFields: structuredClone(r.rawFields),
      content: structuredClone(r.content),
      fieldProvenance: structuredClone(r.provenance),
      artifactMemberIds: [],
      unreadAttachments: [],
      relatedDocumentVersionIds: [],
      formalDocumentArtifactMemberId: null,
    })),
    relations: pkg.edges.map((e) => ({
      sourceRelationId: e.edgeId,
      expectedHeadAssertionRef: null,
      rawKind: e.relationKind,
      controlledKind: null,
      from: {
        kind: 'UNRESOLVED',
        rawIdentity: e.fromSourceRecordId,
        versionGap: 'RELATION_ID_UNOBSERVED',
      },
      to: {
        kind: 'UNRESOLVED',
        rawIdentity: e.toSourceRecordId,
        versionGap: 'RELATION_ID_UNOBSERVED',
      },
      authority: 'CANDIDATE_ONLY',
      selector: e.evidenceLocator,
      observedAt: e.observedAt,
      coverage: structuredClone(pkg.coverage),
      scope: {},
      completionEffect: 'UNSPECIFIED',
      changeClass: 'UNSPECIFIED',
      rawFields: { dailyObservedEdge: structuredClone(e) },
    })),
    artifacts: [],
  };
  sourcePackage(nativePackage);
  const output = {
    nativePackage,
    artifactObservations: structuredClone(pkg.artifactBindings),
  };
  const mappings = {
    records: pkg.records.map((r, i) => ({
      snapshotId: r.snapshotId,
      itemId: r.snapshotId,
      sourceRecordId: r.sourceRecordId,
      sourceKind: r.kind,
      nativeKind: nativePackage.records[i]!.recordKind,
    })),
    relations: pkg.edges.map((e) => ({
      edgeId: e.edgeId,
      nativeRetentionKey: e.edgeId,
      nativeRelationId: null,
    })),
    artifacts: pkg.artifactBindings.map((b) => ({
      bindingId: b.bindingId,
      memberId: b.bindingId,
      ownerSnapshotId: b.ownerSnapshotId,
      sourceAttachmentId: b.sourceAttachmentId,
      sourceAttachmentVersion: null,
      ownerSourceVersion: structuredClone(b.sourceVersion),
      sha256: b.blobSha256,
      byteLength: b.byteLength,
      documentVersionId: null,
    })),
  };
  const memberClaims: TdmsImportMemberClaims = {
    records: [
      ...prepared.memberClaims.records,
      ...nativePackage.records.map((r) => ({
        recordKind: r.recordKind,
        sourceRecordId: r.sourceRecordId,
      })),
    ].filter(
      (r, i, all) =>
        all.findIndex(
          (a) =>
            a.recordKind === r.recordKind &&
            a.sourceRecordId === r.sourceRecordId,
        ) === i,
    ),
    relationIds: prepared.memberClaims.relationIds,
    artifacts: prepared.memberClaims.artifacts.map((a) => ({
      ...a,
      owners: [
        ...a.owners,
        ...a.owners.map((o) => ({
          ...o,
          recordKind: recordKind(
            o.recordKind as (typeof pkg.records)[number]['kind'],
          ),
        })),
      ].filter(
        (r, i, all) =>
          all.findIndex(
            (a) =>
              a.recordKind === r.recordKind &&
              a.sourceRecordId === r.sourceRecordId,
          ) === i,
      ),
    })),
    relatedDocumentVersionIds: [],
  };
  return {
    ...prepared,
    adapterVersion: TDMS_DAILY_SOURCE_ADAPTER_VERSION,
    output,
    outputDigest: hash(output),
    mappings,
    memberClaims,
  };
}
export type TdmsDailySourceAdapterCapture = Pick<
  ReturnType<typeof adaptTdmsDailySource>,
  'adapterVersion' | 'output' | 'outputDigest' | 'mappings'
>;
/** Bind deterministic source identities to the actual same-transaction native retention.
 * These refs are observation revisions/candidate acquisitions, never document versions. */
export function dailyNativeRetention(
  adapter: TdmsDailySourceAdapterCapture,
  receipt: TdmsImportReceipt,
) {
  const m = adapter.mappings;
  if (
    receipt.recordRevisionRefs.length !== m.records.length ||
    receipt.assertionRefs.length !== m.relations.length ||
    receipt.artifactBindings.length !== m.artifacts.length ||
    new Set(receipt.recordRevisionRefs).size !== m.records.length ||
    new Set(receipt.assertionRefs).size !== m.relations.length
  )
    throw tdmsError('TDMS_DAILY_NATIVE_MAPPING_INVALID', 409);
  for (const ref of [...receipt.recordRevisionRefs, ...receipt.assertionRefs])
    identifier(ref);
  return {
    records: m.records.map((r, i) => ({
      ...r,
      sourceRevisionRef: receipt.recordRevisionRefs[i]!,
    })),
    relations: m.relations.map((r, i) => ({
      ...r,
      assertionRef: receipt.assertionRefs[i]!,
    })),
    artifacts: m.artifacts.map((a) => {
      const stored = receipt.artifactBindings.filter(
        (b) => b.memberId === a.memberId,
      );
      if (
        stored.length !== 1 ||
        stored[0]!.sha256 !== a.sha256 ||
        stored[0]!.byteLength !== a.byteLength ||
        stored[0]!.immutableReadbackVerified !== true ||
        stored[0]!.documentVersionId !== null
      )
        throw tdmsError('TDMS_DAILY_NATIVE_MAPPING_INVALID', 409);
      identifier(stored[0]!.sourceArtifactId);
      identifier(stored[0]!.acquisitionId);
      return {
        ...a,
        sourceArtifactId: stored[0]!.sourceArtifactId,
        acquisitionId: stored[0]!.acquisitionId,
      };
    }),
  };
}
export type TdmsDailyNativeRetention = ReturnType<typeof dailyNativeRetention>;
export function isDailyMetadataOnly(envelope: TdmsDailyMetadataEnvelope) {
  const p = envelope.package;
  return (
    !p.artifactBindings.length &&
    p.records.every(
      (r) =>
        ['AEO', 'EXECUTION_STATUS'].includes(r.kind) &&
        !Object.keys(r.content).length,
    )
  );
}
