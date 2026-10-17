/** Browser filters contain no tenant, actor, source grant or database query. */
export interface LcmSnapshotBrowseRequest {
  aircraftModel?: string;
  tailNumber?: string;
  partNumber?: string;
  system?: string;
  ata?: string;
  softwareName?: string;
  position?: string;
  after?: string;
  limit?: number;
}

export interface LcmSnapshotSummary {
  snapshotId: string;
  sourceInstanceId: string;
  collectionId: string;
  scopeKey: string;
  originalFileName: string;
  originalSha256: string;
  originalByteLength: number;
  originalAvailability: 'LOCAL_REFERENCE_ONLY' | 'HOST_FILE_SERVICE';
  sourceObservedAt: string | null;
  sourceObservedDate: string | null;
  sourceTimeZone: string | null;
  sourceTimePrecision: 'day' | 'instant' | 'unknown';
  /** Export time has no verified timezone and cannot establish effectivity. */
  sourceExportedAt: string | null;
  sourceDataCutoffDate: string | null;
  importedAt: string;
  sourceEffectiveAt: null;
  coveredAircraftModels: string[];
  coveredAircraftCount: number;
  /** Native source data rows (the matrix body carries exact row/column coordinates). */
  recordCount: number;
  completeness: 'UNVERIFIED';
  sourceAuthority: 'unverified/local';
  candidateOnly: true;
  liveExternalVerified: false;
}

export interface LcmSnapshotCatalogueResponse {
  snapshots: LcmSnapshotSummary[];
  hasMore: boolean;
  nextAfter: string | null;
}
