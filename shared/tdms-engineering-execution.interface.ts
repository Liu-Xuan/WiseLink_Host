import type { TdmsSourceVersion } from './tdms-source.interface';

/** Literal rows from the selected engineering file's retained Related Status window. */
export interface TdmsEngineeringExecutionRow {
  sourceRecordId: string;
  number: string;
  stateRaw: string;
  sourceModifiedRaw: string;
  executionStatus: {
    engineeringDocumentRef: string;
    engineeringDocumentNumber: string;
    assetRef: string;
    assetNumber: string | null;
    feedbackRef: string | null;
    feedbackNumber: string | null;
    executedDateRaw: string | null;
    stateComments: string | null;
    expiredDateRaw: string | null;
    operatorBase: string | null;
  };
}

export interface TdmsEngineeringExecutionWindow {
  tableId: string;
  tableTitle: string;
  sourceLocator: string;
  observedAt: string;
  enumerationState: string;
  stopReason: string | null;
  reportedRowCount: number;
  observedAircraftCount: number;
  /** Retains the native view/filter declaration; no target scope is inferred from it. */
  sourceViewEvidence: Record<string, unknown> | null;
  rows: TdmsEngineeringExecutionRow[];
}

export interface TdmsEngineeringExecutionReading {
  sourceRevisionRef: string;
  sourceRecordId: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion: TdmsSourceVersion | null;
  windows: TdmsEngineeringExecutionWindow[];
  /** The current native rows do not identify each execution requirement or all targets. */
  requirementCoverage: 'NOT_CAPTURED';
  targetAircraftCoverage: 'UNKNOWN';
  executionVerified: false;
}
