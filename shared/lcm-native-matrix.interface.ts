import type { LcmCellValue } from './lcm-export-staging.interface';
import type { LcmMatrixBinding } from './lcm-matrix.interface';
import type { LcmSnapshotSummary } from './lcm-source-reading.interface';

/** Source coordinates are one-based. Empty strings and absent/null cells stay distinct. */
export interface LcmNativeMatrix {
  schemaVersion: 'wiselink.lcm.native_matrix.v1';
  kind: 'tail-matrix';
  aircraftModel: string;
  sheet: string;
  rawSha256: string;
  range: {
    firstRow: number;
    lastRow: number;
    firstColumn: number;
    lastColumn: number;
  };
  fixedColumns: Array<{
    name: string;
    sourceColumn: number;
    rawValue: LcmCellValue;
  }>;
  aircraft: Array<{
    tailNumber: string;
    sourceColumn: number;
    rawValue: LcmCellValue;
  }>;
  rows: Array<{
    sourceRow: number;
    fixed: LcmCellValue[];
    states: LcmCellValue[];
  }>;
}

/** One Host-approved read set. Local search/order/viewport never broaden this read set. */
export interface LcmNativeMatrixResponse {
  binding: LcmMatrixBinding;
  snapshots: LcmSnapshotSummary[];
  matrices: Array<{
    snapshotId: string;
    managementDomainRef: string;
    matrix: LcmNativeMatrix;
  }>;
}

export interface LcmNativeMatrixStoredSet {
  snapshots: LcmSnapshotSummary[];
  matrices: Array<{ snapshotId: string; matrix: LcmNativeMatrix }>;
}
