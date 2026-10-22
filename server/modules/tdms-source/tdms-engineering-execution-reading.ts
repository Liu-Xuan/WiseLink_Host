import type {
  TdmsEngineeringExecutionReading,
  TdmsEngineeringExecutionRow,
  TdmsEngineeringExecutionWindow,
} from '@shared/tdms-engineering-execution.interface';
import type { TdmsRecordReadResponse, TdmsSourceVersion } from '@shared/tdms-source.interface';
import { canReadTdmsSourceBody } from '@shared/tdms-source-body-policy';
import {
  COMPLETE_OWN_MODE,
  validateCompleteOwnedObservation,
} from './tdms-complete-owned-source.validation';
import { canonical } from './tdms-source.validation';
import { tdmsError } from './tdms-source.types';

interface ValidatedStatusTable {
  tableId: string;
  tableTitle: string;
  panelLocator: string;
  gridId: string;
  enumerationState: string;
  stopReason: string | null;
  sourceViewEvidence?: Record<string, unknown>;
  nativeStatusProof?: {
    statusTable: {
      observedAt: string;
      reportedCount: number;
      rows: TdmsEngineeringExecutionRow[];
    };
  };
}
interface ValidatedCompleteObservation {
  requestedCriteria: { scopeId: string };
  reads: Array<{
    owner: {
      sourceRecordId: string;
      sourceVersion: TdmsSourceVersion;
      businessVersion: TdmsSourceVersion | null;
      number: string;
      stateRaw: string;
    };
    observedAt: string;
    relationTables: ValidatedStatusTable[];
  }>;
}

/** Uses the existing ingress validator and current body permission. Never reads
 * child feedback bodies, maps status words, or borrows rows from another version. */
export function engineeringExecutionReading(
  read: Pick<TdmsRecordReadResponse, 'record' | 'bodyReadPolicy'>,
): TdmsEngineeringExecutionReading | undefined {
  if (read.record.recordKind !== 'ENGINEERING_FILE' || !canReadTdmsSourceBody(read)) return;
  const record = read.record;
  const raw: unknown = record.rawFields.completeOwnedSource;
  if (raw === undefined) return;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  const proof: Record<string, unknown> = raw as Record<string, unknown>;
  if (!['EO', 'EF', 'AEO'].includes(String(proof.scopeId))) return;
  if (proof.mode !== COMPLETE_OWN_MODE) invalid();
  // Also validates the two stable observations, table/window evidence and exact
  // nativeStatusProof owner/version/number/row references before projecting.
  const observation: ValidatedCompleteObservation = validateCompleteOwnedObservation({
    schemaVersion: proof.schemaVersion,
    requestedCriteria: proof.requestedCriteria,
    documentIdentity: proof.documentIdentity,
    nativeReloadProvenance: proof.nativeReloadProvenance,
    reads: proof.reads,
  }, proof.requestedCriteria);
  const selected: ValidatedCompleteObservation['reads'][number] = observation.reads[1]!;
  if (observation.requestedCriteria.scopeId !== proof.scopeId ||
      selected.owner.sourceRecordId !== record.sourceRecordId ||
      canonical(selected.owner.sourceVersion) !== canonical(record.sourceVersion) ||
      canonical(selected.owner.businessVersion) !== canonical(record.businessVersion ?? null) ||
      selected.owner.number !== record.rawFields.number || selected.owner.stateRaw !== record.state?.rawName ||
      selected.observedAt !== record.observedAt) invalid();
  const windows: TdmsEngineeringExecutionWindow[] = [];
  for (const table of selected.relationTables) {
    if (table.gridId !== 'relatedStatusLinkTable' || !table.nativeStatusProof) continue;
    const status = table.nativeStatusProof.statusTable;
    windows.push({
      tableId: table.tableId,
      tableTitle: table.tableTitle,
      sourceLocator: `${table.panelLocator} #${table.gridId}`,
      observedAt: status.observedAt,
      enumerationState: table.enumerationState,
      stopReason: table.stopReason,
      reportedRowCount: status.reportedCount,
      observedAircraftCount: new Set(status.rows.map((row: TdmsEngineeringExecutionRow) =>
        row.executionStatus.assetRef)).size,
      sourceViewEvidence: structuredClone(table.sourceViewEvidence ?? null),
      // Keep multiple rows for one aircraft and their separate feedback identities.
      rows: structuredClone(status.rows),
    });
  }
  if (!windows.length) return;
  return {
    sourceRevisionRef: record.sourceRevisionRef,
    sourceRecordId: record.sourceRecordId,
    sourceVersion: structuredClone(record.sourceVersion),
    businessVersion: structuredClone(record.businessVersion ?? null),
    windows,
    requirementCoverage: 'NOT_CAPTURED',
    targetAircraftCoverage: 'UNKNOWN',
    executionVerified: false,
  };
}

function invalid(): never {
  throw tdmsError('TDMS_ENGINEERING_EXECUTION_SOURCE_BINDING_INVALID', 409);
}
