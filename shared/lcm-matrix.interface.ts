import type { LcmCandidateRecord } from './lcm-export-staging.interface';
import type { LcmSnapshotSummary } from './lcm-source-reading.interface';

export type LcmMatrixCellState =
  | 'INSTALLED'
  | 'PARTIAL_INSTALLED'
  | 'ALLOWED_ONLY'
  | 'UNKNOWN'
  | 'NO_RECORD'
  | 'CONFLICT';
export type LcmMatrixQualification =
  | 'COMPARABLE'
  | 'PARTIAL'
  | 'UNCONFIRMED'
  | 'NO_RECORD'
  | 'CONFLICT';

/** All identities and permission bindings are issued by Host. Browser filters grant nothing. */
export interface LcmMatrixQuery {
  snapshotIds: string[];
  aircraftModel?: string;
  aircraftModels?: string[];
  aircraftRefs?: string[];
  search?: string;
  ata?: string;
  differencesOnly?: boolean;
  anchorSoftwareRef?: string | null;
}

export interface LcmMatrixBinding {
  readSetRef: string;
  projectionRevision: string;
  scopeRef: string;
  permissionRevision: string;
  filterHash: string;
  orderRef: string;
}

export interface LcmMatrixWindowRequest {
  query: LcmMatrixQuery;
  binding?: LcmMatrixBinding;
  rowStart?: number;
  rowLimit?: number;
  columnStart?: number;
  columnLimit?: number;
  expandedSoftwareRefs?: string[];
}

export interface LcmMatrixAircraft {
  aircraftRef: string;
  managementDomainRef: string;
  tailNumber: string;
  models: string[];
}

export interface LcmMatrixSummaryCell {
  aircraftRef: string;
  installedPartNumbers: string[];
  qualification: LcmMatrixQualification;
}

export interface LcmMatrixPartCell {
  aircraftRef: string;
  state: LcmMatrixCellState;
  installed: boolean | null;
  allowed: boolean | null;
}

export interface LcmMatrixPartCount {
  partNumber: string | null;
  confirmedInstalledAircraftCount: number;
  countCompleteness: 'COMPLETE_FOR_SELECTED_SCOPE' | 'PARTIAL';
  countScopeRef: string;
}

export interface LcmMatrixSoftwareIndex {
  softwareRef: string;
  managementDomainRef: string;
  lcmSoftwareName: string | null;
  ata: string[];
  systems: string[];
  sourceOrder: number;
  parts: LcmMatrixPartCount[];
  aliases: Array<{ alias: string; evidenceRef: string }>;
  knownInstalledSetDifference: boolean;
}

export interface LcmMatrixSoftwareWindow {
  softwareRef: string;
  summaryCells: LcmMatrixSummaryCell[];
  partRows: Array<LcmMatrixPartCount & { cells: LcmMatrixPartCell[] }>;
}

export interface LcmMatrixOrderGroup {
  kind:
    | 'CONFIRMED_INSTALLED_SET'
    | 'OBSERVED_INSTALLED_SET'
    | 'UNCONFIRMED_BUCKET'
    | 'CONFLICT_BUCKET';
  installedPartNumbers: string[];
  startIndex: number;
  endIndexExclusive: number;
}

export interface LcmMatrixResponse {
  binding: LcmMatrixBinding;
  snapshots: LcmSnapshotSummary[];
  sourceMode: 'CANDIDATE';
  aircraftIndex: LcmMatrixAircraft[];
  aircraftOrder: string[];
  orderGroups: LcmMatrixOrderGroup[];
  /** Complete lightweight software index. Cells below are windowed after full-scope aggregation. */
  softwareIndex: LcmMatrixSoftwareIndex[];
  softwareGroups: LcmMatrixSoftwareWindow[];
  anchorSoftwareRef: string | null;
  anchorCleared: boolean;
  rowStart: number;
  columnStart: number;
  columns: string[];
}

export interface LcmMatrixDetailRequest {
  query: LcmMatrixQuery;
  binding: LcmMatrixBinding;
  softwareRef?: string;
  aircraftRef?: string;
  partNumber?: string | null;
  after?: string;
}

export interface LcmMatrixDetailResponse {
  binding: LcmMatrixBinding;
  records: Array<{
    snapshot: LcmSnapshotSummary;
    softwareRef: string;
    aircraftRef: string;
    lcmSoftwareName: string | null;
    record: LcmCandidateRecord;
  }>;
  nextAfter: string | null;
  originalUnavailableReason: 'LOCAL_REFERENCE_ONLY' | null;
}
