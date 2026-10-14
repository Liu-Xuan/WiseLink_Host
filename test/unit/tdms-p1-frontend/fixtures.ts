import type { LcmCandidateRecord } from '@shared/lcm-export-staging.interface';
import type { LcmSnapshotSummary } from '@shared/lcm-source-reading.interface';
import type { TdmsFileServiceRecordReadResponse } from '@shared/tdms-file-service-import.interface';
import { record } from '../tdms-frontend-recovery/reader-fixtures';

export function sourceRead(ref: string, versionId = 'DV-1', state = 'Estimated'): TdmsFileServiceRecordReadResponse {
  const read: TdmsFileServiceRecordReadResponse = record(ref);
  read.record.relatedDocumentVersionIds = [versionId];
  read.record.state = { rawCode: state, rawName: state };
  read.record.businessVersion = { rawRevision: 'R00', rawIteration: null, confirmation: 'SOURCE_DECLARED' };
  read.bodyReadPolicy = { kind: state === 'Estimated' ? 'ESTIMATED_ASSESSMENT' : 'METADATA_ONLY',
    sourceRecordId: read.record.sourceRecordId, sourceRevisionRef: read.record.sourceRevisionRef };
  return read;
}

export function snapshot(snapshotId = 'snapshot-1'): LcmSnapshotSummary {
  return {
    snapshotId, sourceInstanceId: 'test-lcm', collectionId: 'test-collection', scopeKey: 'B787-9/test',
    originalFileName: 'test-configuration.xlsx', originalSha256: 'a'.repeat(64), originalByteLength: 100,
    originalAvailability: 'LOCAL_REFERENCE_ONLY', sourceObservedAt: '2026-10-13T09:00:00+08:00',
    sourceObservedDate: '2026-10-13', sourceTimeZone: 'Asia/Shanghai', sourceTimePrecision: 'day',
    sourceExportedAt: '2026-10-13T09:10:00', sourceDataCutoffDate: '2026-10-12',
    importedAt: '2026-10-14T10:00:00+08:00', sourceEffectiveAt: null,
    coveredAircraftModels: ['B787-9'], coveredAircraftCount: 2, recordCount: 3,
    completeness: 'UNVERIFIED', sourceAuthority: 'unverified/local', candidateOnly: true, liveExternalVerified: false,
  };
}

export function configurationRecord(recordId = 'record-1'): LcmCandidateRecord {
  return {
    recordId, identityKey: `identity-${recordId}`, aircraftModel: 'B787-9', tailNumber: 'B-TEST',
    partNumber: 'PN-TEST', fields: { '软件名称': '测试软件', '系统': '测试系统', 'ATA章': '27', 'FIN号': 'FIN-TEST', '状态': 'source-raw-state' },
    observation: 'allowed-only', allowed: true, installed: false,
    semanticBasis: 'user-confirmed-matrix-definition', effectiveAt: null, executedAt: null,
    originalEo: 'AEO-TEST R13', sourceRows: [{ sheet: 'Sheet0', row: 5, cells: {
      '状态': { sheet: 'Sheet0', row: 5, column: 2, address: 'C5', rawValue: 'source-raw-state', formula: null },
    } }],
  };
}
