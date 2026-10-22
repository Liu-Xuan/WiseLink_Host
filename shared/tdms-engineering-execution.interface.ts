import type { TdmsCompleteOwnedValueState, TdmsSourceVersion } from './tdms-source.interface';

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

/** Literal columns of the reviewed AEO feedback page, not parsed AEO content. */
export interface TdmsEngineeringFeedbackPageRow {
  occurrenceId: string;
  aircraftNumberRaw: string | null;
  aircraftNumberState: TdmsCompleteOwnedValueState;
  cells: Array<{
    actualLabel: string;
    rawValue: string | null;
    state: TdmsCompleteOwnedValueState;
    observedTotalCodepoints: number;
  }>;
  sourceLinks: Array<{
    targetRef: string;
    numberRaw: string | null;
    rawHref: string;
    locator: string;
    nativeRole: string;
    nativeColumnLabel: string;
    nativeColumnToken: string | null;
  }>;
}

export interface TdmsEngineeringFeedbackPageWindow {
  tableId: string;
  tableTitle: string;
  sourceLocator: string;
  observedAt: string;
  enumerationState: string;
  stopReason: string | null;
  reportedRowCount: number | null;
  applicabilityBasis: 'CURRENT_AEO_FEEDBACK_PAGE';
  /** Exact nonblank aircraft-number literals, deduplicated without altering rows. */
  aircraftNumbers: string[];
  unknownAircraftRowCount: number;
  sourceViewEvidence: Record<string, unknown>;
  rows: TdmsEngineeringFeedbackPageRow[];
}

export interface TdmsEngineeringExecutionReading {
  sourceRevisionRef: string;
  sourceRecordId: string;
  sourceVersion: TdmsSourceVersion;
  businessVersion: TdmsSourceVersion | null;
  windows: TdmsEngineeringExecutionWindow[];
  /** Current AEO applicability comes from the independently validated feedback page. */
  applicabilityWindows?: TdmsEngineeringFeedbackPageWindow[];
  /** AEO content parsing is outside this read; no whole-document execution verdict. */
  requirementCoverage: 'NOT_CAPTURED';
  targetAircraftCoverage: 'UNKNOWN';
  executionVerified: false;
}
