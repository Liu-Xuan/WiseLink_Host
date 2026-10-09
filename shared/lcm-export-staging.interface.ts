/** Local staging types. These are not Host configuration facts or events. */
export type LcmExportKind = 'as-flown-detail' | 'tail-matrix';
export type LcmCellValue = string | number | boolean | null;

export interface LcmCellRef {
  sheet: string;
  row: number;
  column: number;
  address: string;
  rawValue: LcmCellValue;
  formula: string | null;
}

export interface LcmRowRef {
  sheet: string;
  row: number;
  cells: Record<string, LcmCellRef>;
}

export interface LcmExportDate {
  raw: string | null;
  localDateTime: string | null;
  timeZone: null;
  source: LcmCellRef | null;
}

export interface LcmExportMetadata {
  aircraftModel: string;
  aircraftModelOrigin: 'source-cell' | 'explicit-cli';
  aircraftModelCell: LcmCellRef | null;
  configurationLabel: string | null;
  exportDate: LcmExportDate;
  metadataRows: LcmRowRef[];
}

export interface LcmCandidateRecord {
  /** Stable only for the exact observed content, never a formal object ID. */
  recordId: string;
  identityKey: string;
  aircraftModel: string;
  tailNumber: string;
  partNumber: string | null;
  fields: Record<string, string | null>;
  observation: 'listed' | 'allowed-and-installed' | 'allowed-only' | 'unknown-blank' | 'unknown-value';
  allowed: boolean | null;
  installed: boolean | null;
  semanticBasis: 'user-confirmed-matrix-definition' | 'source-listing-only';
  effectiveAt: null;
  executedAt: null;
  originalEo: string | null;
  sourceRows: LcmRowRef[];
}

export interface LcmDiagnostic {
  code: 'MISSING_PART_NUMBER' | 'DUPLICATE_ROW' | 'IDENTITY_CONFLICT' | 'MATRIX_VALUE_UNKNOWN';
  recordIds: string[];
}

export interface LcmParsedExport {
  schemaVersion: 'wiselink.lcm.local_export.v1';
  kind: LcmExportKind;
  sourceAuthority: 'unverified/local';
  metadata: LcmExportMetadata;
  records: LcmCandidateRecord[];
  diagnostics: LcmDiagnostic[];
  contentDigest: string;
}

/** Explicit read-only export mapping; names alone cannot resolve identities. */
export interface LcmHostSnapshot {
  schemaVersion: 'wiselink.lcm.host_snapshot.v1';
  snapshotId: string;
  capturedAt: string;
  aircraft: Array<{ assetId: string; tailNumber: string; aircraftModel: string }>;
  software: Array<{ softwareId: string; partNumber: string }>;
  documentBindings: Array<{
    sourceEoValue: string;
    documentId: string;
    documentVersionId: string;
    version: string | null;
  }>;
}

export interface LcmMatch {
  status: 'exact-snapshot-candidate' | 'unresolved' | 'conflict';
  refs: string[];
  reason: string;
}

export interface LcmRecordMapping {
  recordId: string;
  aircraft: LcmMatch;
  software: LcmMatch;
  originalEo: LcmMatch;
  documentVersionRefs: Array<{
    documentId: string;
    documentVersionId: string;
    version: string | null;
  }>;
  liveHostVerified: false;
}

export interface LcmCandidateSnapshot {
  schemaVersion: 'wiselink.lcm.local_candidate_snapshot.v1';
  snapshotId: string;
  previousSnapshotId: string | null;
  createdAt: string;
  scopeKey: string;
  source: {
    sourceAuthority: 'unverified/local';
    originalFileName: string;
    rawSha256: string;
    rawByteLength: number;
    artifactRef: string;
    sourceObservedAt: string | null;
    ingestedAt: string;
    localSourcePath: string;
    collectionContext: LcmCollectionContext | null;
  };
  parsed: LcmParsedExport;
  hostSnapshot: { sha256: string; snapshotId: string; artifactRef: string } | null;
  mappings: LcmRecordMapping[];
  changes: {
    addedRecordIds: string[];
    changedIdentityKeys: string[];
    unobservedPreviousRecordIds: string[];
    previousRecordsRetained: true;
    withdrawalStatus: 'unknown';
  };
  authority: {
    candidateOnly: true;
    writesHost: false;
    formallyAdopted: false;
    createsInstallationEvents: false;
  };
}

export interface LcmStageOptions {
  inputPath: string;
  stagingDirectory: string;
  aircraftModel?: string;
  hostSnapshotPath?: string;
  collectionContextPath?: string;
  now?: () => Date;
}

export interface LcmStageResult {
  status: 'appended' | 'unchanged';
  snapshotId: string;
  snapshotPath: string;
  observationPath: string;
  rawSha256: string;
  recordCount: number;
  coordinateCount: number;
  unresolvedCount: number;
  conflictCount: number;
  sourceAuthority: 'unverified/local';
  liveHostVerified: false;
}

export interface LcmCollectionContext {
  schemaVersion: 'wiselink.lcm.collection_context.v1';
  collectionId: string;
  sourceOrigin: 'local-file' | 'user-confirmed-lcm-page';
  pageUrl: string | null;
  filters: Record<string, string | null>;
  observedAt: string | null;
  systemStateDate?: string;
  systemStateTimeZone?: 'Asia/Shanghai';
  systemStateDateBasis?: 'user-confirmed-system-state';
  sourceEvidence: string;
}

export interface LcmLocalObservation {
  schemaVersion: 'wiselink.lcm.local_observation.v1';
  snapshotId: string;
  rawSha256: string;
  artifactRef: string;
  originalFileName: string;
  localSourcePath: string;
  collectionContext: LcmCollectionContext | null;
  hostSha256: string | null;
  ingestedAt: string;
  parsed: LcmParsedExport;
}
