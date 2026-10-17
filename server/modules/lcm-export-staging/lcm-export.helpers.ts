import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type {
  LcmCandidateRecord,
  LcmCellRef,
  LcmCellValue,
  LcmRowRef,
} from '../../../shared/lcm-export-staging.interface';

export class LcmStagingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LcmStagingError';
  }
}

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Stable JSON for semantic idempotence, independent of row/object order. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item: unknown) => canonicalJson(item)).join(',')}]`;
  const object: Record<string, unknown> = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key: string) => object[key] !== undefined)
    .sort()
    .map(
      (key: string) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`,
    )
    .join(',')}}`;
}

export function readCell(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  row: number,
  column: number,
): LcmCellRef {
  const address: string = XLSX.utils.encode_cell({ r: row, c: column });
  const cell: XLSX.CellObject | undefined = sheet[address] as
    | XLSX.CellObject
    | undefined;
  let rawValue: LcmCellValue = null;
  if (cell?.v !== undefined && cell.v !== null) {
    if (!['string', 'number', 'boolean'].includes(typeof cell.v)) {
      throw new LcmStagingError(
        'CELL_TYPE_UNSUPPORTED',
        'Only scalar workbook cells are supported.',
      );
    }
    rawValue = cell.v as string | number | boolean;
  }
  return {
    sheet: sheetName,
    row: row + 1,
    column: column + 1,
    address,
    rawValue,
    formula: cell?.f ?? null,
  };
}

export function cellText(cell: LcmCellRef): string | null {
  if (cell.formula !== null) {
    throw new LcmStagingError(
      'FORMULA_UNSUPPORTED',
      'Formula cells cannot establish source observations.',
    );
  }
  if (cell.rawValue === null) return null;
  const value: string = String(cell.rawValue).trim();
  return value === '' ? null : value;
}

export function recordContent(record: LcmCandidateRecord): unknown {
  return {
    aircraftModel: record.aircraftModel,
    tailNumber: record.tailNumber,
    partNumber: record.partNumber,
    fields: record.fields,
    observation: record.observation,
    allowed: record.allowed,
    installed: record.installed,
    semanticBasis: record.semanticBasis,
    effectiveAt: record.effectiveAt,
    executedAt: record.executedAt,
    originalEo: record.originalEo,
  };
}

export function makeRecord(
  aircraftModel: string,
  tailNumber: string,
  fields: Record<string, string | null>,
  observation: LcmCandidateRecord['observation'],
  sourceRows: LcmRowRef[],
): LcmCandidateRecord {
  const partNumber: string | null = fields['软件件号'] ?? null;
  const identityKey: string = canonicalJson({
    aircraftModel,
    tailNumber,
    partNumber,
    fin: fields['FIN号'] ?? null,
    ata: fields['ATA章'] ?? fields['ATA章节'] ?? null,
    system: fields['系统'] ?? null,
    type: fields['类型'] ?? null,
    // Missing PN must not merge unrelated rows by their software name.
    missingPartNumberFields: partNumber === null ? fields : null,
  });
  const record: LcmCandidateRecord = {
    recordId: '',
    identityKey,
    aircraftModel,
    tailNumber,
    partNumber,
    fields,
    observation,
    effectiveAt: null,
    executedAt: null,
    allowed: ['allowed-and-installed', 'allowed-only'].includes(observation)
      ? true
      : null,
    installed:
      observation === 'allowed-and-installed'
        ? true
        : observation === 'allowed-only'
          ? false
          : null,
    semanticBasis:
      observation === 'listed'
        ? 'source-listing-only'
        : 'user-confirmed-matrix-definition',
    originalEo: fields['来源（EO）'] ?? null,
    sourceRows,
  };
  record.recordId = `lcm-record:${sha256(canonicalJson(recordContent(record)))}`;
  return record;
}
