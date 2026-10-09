import type { LcmCandidateRecord, LcmCollectionContext, LcmParsedExport } from './lcm-export-staging.interface';

export interface LcmDatabaseScope {
  tenantId: string;
  actorId: string;
  authorizedSourceInstanceIds: string[];
}

export interface LcmExternalReference {
  sourceRecordId: string;
  targetTenantId: string;
  targetSourceInstanceId: string;
  targetKind: 'TDMS_RECORD' | 'WISELINK_DOCUMENT_VERSION' | 'FLEET_ASSET_VERSION';
  targetId: string;
  targetVersionId: string;
  relation: 'EXPLICIT_REFERENCE_CANDIDATE';
  evidence: string;
}

export interface LcmDatabaseImport {
  scope: LcmDatabaseScope;
  sourceInstanceId: string;
  requestId: string;
  context: LcmCollectionContext;
  originalFileName: string;
  localSourcePath: string;
  rawSha256: string;
  rawByteLength: number;
  artifactRef: string;
  parsed: LcmParsedExport;
  externalReferences: LcmExternalReference[];
}

export interface LcmDatabaseImportResult {
  snapshotId: string;
  replayed: boolean;
  recordCount: number;
  coordinateCount: number;
}

export interface LcmConfigurationQuery {
  scope: LcmDatabaseScope;
  tailNumber?: string;
  partNumber?: string;
  asOf?: string;
  asOfDate?: string;
  timeZone?: 'Asia/Shanghai';
  from?: string;
  to?: string;
  limit: number;
}

export interface LcmTimelineEntry {
  snapshotId: string;
  sourceInstanceId: string;
  collectionId: string;
  scopeKey: string;
  sourceObservedAt: string | null;
  sourceObservedDate: string | null;
  sourceTimeZone: string | null;
  sourceTimePrecision: 'day' | 'instant' | 'unknown';
  sameDayOrderingBasis: 'source-observed-at' | 'acquisition-sequence';
  importedAt: string;
  sourceExportedAt: string | null;
  rawSha256: string;
  artifactRef: string;
  record: LcmCandidateRecord;
  candidateOnly: true;
  liveExternalVerified: false;
}

export interface LcmQueryResult {
  schemaVersion: 'wiselink.lcm.configuration_query.v1';
  mode: 'READ_ONLY_LOCAL_CANDIDATE';
  entries: LcmTimelineEntry[];
  limit: number;
  truncated: boolean;
  unknownObservedTimesExcluded: boolean;
  queryTimeBasis: 'source-day' | 'source-instant' | 'history';
  dayPrecisionExcluded: boolean;
}

export interface LcmNeighborhoodResult extends LcmQueryResult {
  relations: Array<{
    snapshotId: string;
    sourceRecordId: string;
    targetSourceInstanceId: string;
    targetKind: LcmExternalReference['targetKind'];
    targetId: string;
    targetVersionId: string;
    relation: 'EXPLICIT_REFERENCE_CANDIDATE';
    evidence: string;
    liveExternalVerified: false;
  }>;
  relationLimit: number;
  relationsTruncated: boolean;
}
