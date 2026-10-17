/** Local staging types. These are not Host configuration facts or events. */
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

export interface LcmCandidateRecord {
  /** Stable only for the exact observed content, never a formal object ID. */
  recordId: string;
  identityKey: string;
  aircraftModel: string;
  tailNumber: string;
  partNumber: string | null;
  fields: Record<string, string | null>;
  observation:
    | 'listed'
    | 'allowed-and-installed'
    | 'allowed-only'
    | 'unknown-blank'
    | 'unknown-value';
  allowed: boolean | null;
  installed: boolean | null;
  semanticBasis: 'user-confirmed-matrix-definition' | 'source-listing-only';
  effectiveAt: null;
  executedAt: null;
  originalEo: string | null;
  sourceRows: LcmRowRef[];
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
