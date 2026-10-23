import type { TdmsRecordSummary } from '@shared/tdms-source.interface';
import type { TdmsStoredRevisionMetadata } from './tdms-processing-set.types';
import type { TdmsRuntimeRecordMetadata } from './tdms-runtime-reader.adapter';

/** Deliberate metadata projection. Native opinion/content fields never cross it. */
export function tdmsRuntimeMetadataRecord(
  value: TdmsStoredRevisionMetadata,
): TdmsRuntimeRecordMetadata {
  const r = value.record;
  const record: TdmsRecordSummary = {
    recordRef: r.recordRef,
    sourceRevisionRef: r.sourceRevisionRef,
    recordKind: r.recordKind,
    sourceRecordId: r.sourceRecordId,
    sourceKey: r.sourceKey,
    sourceInstanceId: r.sourceInstanceId,
    title: r.title,
    fileType: r.fileType,
    sourceVersion: r.sourceVersion,
    ...(r.businessVersion === undefined
      ? {}
      : { businessVersion: r.businessVersion }),
    state: r.state,
    authors: r.authors,
    observedAt: r.observedAt,
    capturedAt: r.capturedAt,
    coverage: r.coverage,
    relatedDocumentVersionIds: r.relatedDocumentVersionIds,
    fieldSelectors: r.fieldSelectors,
    sourceVerification: r.sourceVerification,
    currentness: r.currentness,
  };
  return structuredClone({
    scope: value.scope,
    record,
    captureRef: r.captureRef,
    sourceModifiedAt: r.sourceModifiedAt,
    ...(typeof r.rawFields.sourceModifiedRaw === 'string'
      ? { sourceModifiedRaw: r.rawFields.sourceModifiedRaw }
      : {}),
    opinionCollection: r.rawFields.opinionCollection ?? null,
    fieldProvenance: r.fieldProvenance,
  });
}
