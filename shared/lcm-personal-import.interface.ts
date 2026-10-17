import type { LcmCollectionContext } from './lcm-export-staging.interface';

/** Upload ownership is re-read from FileService; no browser actor/source grant is accepted. */
export interface LcmExcelImportRequest {
  requestId: string;
  aircraftModel: string;
  selection: {
    bucketId: string;
    filePath: string;
    expectedProviderObjectId: string;
  };
  /** Omitted dates remain unknown. An explicit collection preserves a distinct source observation. */
  context?: LcmCollectionContext;
}

/** Read-only recovery of an upload whose response was lost, within the current owner. */
export interface LcmUploadResolveRequest {
  filePath: string;
}
export interface LcmUploadResolveResponse {
  selection: LcmExcelImportRequest['selection'] | null;
}

export interface LcmExcelImportResponse {
  requestId: string;
  snapshotId: string;
  sourceInstanceId: string;
  scopeKey: string;
  replayed: boolean;
  /** Source Excel data rows; never the expanded software/aircraft observation count. */
  recordCount: number;
  /** Raw state cells in the source rectangle, including blanks. */
  coordinateCount: number;
  sourceRowCount: number;
  aircraftColumnCount: number;
  stateCellCount: number;
  originalSha256: string;
  originalByteLength: number;
  candidateOnly: true;
}

export interface LcmPersonalLibraryResponse {
  hasSource: boolean;
  latestSnapshotIds: string[];
  snapshotCount: number;
}
