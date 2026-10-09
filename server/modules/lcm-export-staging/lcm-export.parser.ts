import * as XLSX from 'xlsx';
import type {
  LcmCandidateRecord, LcmDiagnostic, LcmExportMetadata, LcmParsedExport,
  LcmRowRef, LcmCellRef,
} from '../../../shared/lcm-export-staging.interface';
import {
  canonicalJson, cellText, LcmStagingError, makeRecord, readCell,
  recordContent, rowRef, sha256, validateLocalDateTime,
} from './lcm-export.helpers';

const DETAIL_HEADERS: readonly string[] = [
  'ATA章节', '系统', '类型', '软件名称', '软件件号', '软件描述', '来源（EO）',
  '状态', '装载方式', '媒体件集号', '模块件号', 'ERD', 'SLID', '硬件名称', '硬件件号', '硬件描述',
];
const MATRIX_HEADERS: readonly string[] = ['ATA章', '系统', '类型', '软件名称', '软件件号'];
const MAX_CELLS: number = 2_000_000;

function matchesHeaders(sheet: XLSX.WorkSheet, name: string, row: number, headers: readonly string[]): boolean {
  return headers.every((header: string, column: number) => cellText(readCell(sheet, name, row, column)) === header);
}

function nonemptyRow(sheet: XLSX.WorkSheet, name: string, row: number, columns: number): boolean {
  return Array.from({ length: columns }, (_value: unknown, column: number) =>
    cellText(readCell(sheet, name, row, column))).some((value: string | null) => value !== null);
}

function fieldsFrom(ref: LcmRowRef): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  Object.entries(ref.cells).forEach(([key, cell]: [string, LcmCellRef]) => { fields[key] = cellText(cell); });
  return fields;
}

function parseDetail(
  sheet: XLSX.WorkSheet, name: string, range: XLSX.Range, explicitModel?: string,
): { metadata: LcmExportMetadata; records: LcmCandidateRecord[] } {
  if (range.e.c !== 15 || !matchesHeaders(sheet, name, 2, DETAIL_HEADERS) ||
      !matchesHeaders(sheet, name, 0, ['所属构型', '实飞构型'])) {
    throw new LcmStagingError('DETAIL_LAYOUT_INVALID', 'Expected the exact 16-column as-flown export layout.');
  }
  const modelCell: LcmCellRef = readCell(sheet, name, 0, 5);
  const tailCell: LcmCellRef = readCell(sheet, name, 0, 9);
  const exportDateCell: LcmCellRef = readCell(sheet, name, 0, 13);
  const aircraftModel: string | null = cellText(modelCell);
  const tail: string | null = cellText(tailCell);
  const rawDate: string | null = cellText(exportDateCell);
  if (cellText(readCell(sheet, name, 0, 4)) !== '机型' ||
      cellText(readCell(sheet, name, 0, 8)) !== '机尾号' ||
      cellText(readCell(sheet, name, 0, 12)) !== '导出日期' || !aircraftModel || !tail) {
    throw new LcmStagingError('DETAIL_METADATA_INVALID', 'Aircraft identity labels and values must be present.');
  }
  if (explicitModel !== undefined && explicitModel.trim() !== aircraftModel) {
    throw new LcmStagingError('AIRCRAFT_MODEL_CONFLICT', 'Explicit aircraft model disagrees with the source cell.');
  }
  const metadata: LcmExportMetadata = {
    aircraftModel, aircraftModelOrigin: 'source-cell', aircraftModelCell: modelCell,
    configurationLabel: cellText(readCell(sheet, name, 0, 1)),
    exportDate: { raw: rawDate, localDateTime: rawDate === null ? null : validateLocalDateTime(rawDate),
      timeZone: null, source: exportDateCell },
    metadataRows: [0, 1].map((row: number) => rowRef(sheet, name, row,
      Array.from({ length: 16 }, (_value: unknown, column: number) => XLSX.utils.encode_col(column)))),
  };
  const records: LcmCandidateRecord[] = [];
  for (let row: number = 3; row <= range.e.r; row++) {
    if (!nonemptyRow(sheet, name, row, 16)) continue;
    const ref: LcmRowRef = rowRef(sheet, name, row, DETAIL_HEADERS);
    ref.cells['机型'] = modelCell;
    ref.cells['机尾号'] = tailCell;
    const fields: Record<string, string | null> = fieldsFrom(ref);
    delete fields['机型'];
    delete fields['机尾号'];
    records.push(makeRecord(aircraftModel, tail, fields, 'listed', [ref]));
  }
  return { metadata, records };
}

function parseMatrix(
  sheet: XLSX.WorkSheet, name: string, range: XLSX.Range, explicitModel?: string,
): { metadata: LcmExportMetadata; records: LcmCandidateRecord[] } {
  const aircraftModel: string | undefined = explicitModel?.trim();
  if (!aircraftModel) {
    throw new LcmStagingError('AIRCRAFT_MODEL_REQUIRED', 'Tail matrices require an explicit aircraft model.');
  }
  if (range.e.c < 5 || !matchesHeaders(sheet, name, 0, MATRIX_HEADERS)) {
    throw new LcmStagingError('MATRIX_LAYOUT_INVALID', 'Expected five fixed headers followed by exact tail numbers.');
  }
  const tails: string[] = [];
  const hasFin: boolean = cellText(readCell(sheet, name, 0, 5)) === 'FIN号';
  const tailStart: number = hasFin ? 6 : 5;
  const identityHeaders: readonly string[] = hasFin ? [...MATRIX_HEADERS, 'FIN号'] : MATRIX_HEADERS;
  for (let column: number = tailStart; column <= range.e.c; column++) {
    const tail: string | null = cellText(readCell(sheet, name, 0, column));
    if (tail === null || !/^B-[A-Z0-9]{4,6}$/u.test(tail) || tails.includes(tail)) {
      throw new LcmStagingError('MATRIX_TAIL_INVALID', 'Matrix tail headers must be unique explicit aircraft numbers.');
    }
    tails.push(tail);
  }
  if (tails.length === 0) throw new LcmStagingError('MATRIX_TAIL_INVALID', 'Matrix has no explicit aircraft columns.');
  const metadata: LcmExportMetadata = {
    aircraftModel, aircraftModelOrigin: 'explicit-cli', aircraftModelCell: null,
    configurationLabel: null, exportDate: { raw: null, localDateTime: null, timeZone: null, source: null },
    metadataRows: [],
  };
  const records: LcmCandidateRecord[] = [];
  for (let row: number = 1; row <= range.e.r; row++) {
    if (!nonemptyRow(sheet, name, row, range.e.c + 1)) continue;
    const base: LcmRowRef = rowRef(sheet, name, row, identityHeaders);
    const fields: Record<string, string | null> = fieldsFrom(base);
    if (!Object.values(fields).some((value: string | null) => value !== null)) {
      throw new LcmStagingError('MATRIX_ROW_INVALID', 'A matrix presence row lacks its software identity columns.');
    }
    tails.forEach((tail: string, index: number) => {
      const presence: LcmCellRef = readCell(sheet, name, row, index + tailStart);
      const value: string | null = cellText(presence);
      const ref: LcmRowRef = { ...base, cells: { ...base.cells,
        '机尾号': readCell(sheet, name, 0, index + tailStart), '矩阵值': presence } };
      const observation: LcmCandidateRecord['observation'] = value === null ? 'unknown-blank'
        : value === '1' ? 'allowed-and-installed' : value === '2' ? 'allowed-only' : 'unknown-value';
      records.push(makeRecord(aircraftModel, tail, { ...fields, '矩阵值': value }, observation, [ref]));
    });
  }
  return { metadata, records };
}

function consolidate(records: LcmCandidateRecord[]): { records: LcmCandidateRecord[]; diagnostics: LcmDiagnostic[] } {
  const unique: Map<string, LcmCandidateRecord> = new Map();
  const diagnostics: LcmDiagnostic[] = [];
  records.forEach((record: LcmCandidateRecord) => {
    const existing: LcmCandidateRecord | undefined = unique.get(record.recordId);
    if (existing) {
      existing.sourceRows.push(...record.sourceRows);
      diagnostics.push({ code: 'DUPLICATE_ROW', recordIds: [record.recordId] });
    } else {
      unique.set(record.recordId, record);
      if (record.partNumber === null) diagnostics.push({ code: 'MISSING_PART_NUMBER', recordIds: [record.recordId] });
      if (record.observation === 'unknown-value') diagnostics.push({ code: 'MATRIX_VALUE_UNKNOWN', recordIds: [record.recordId] });
    }
  });
  const identityGroups: Map<string, string[]> = new Map();
  unique.forEach((record: LcmCandidateRecord) => {
    const group: string[] = identityGroups.get(record.identityKey) ?? [];
    group.push(record.recordId);
    identityGroups.set(record.identityKey, group);
  });
  identityGroups.forEach((group: string[]) => {
    if (group.length > 1) diagnostics.push({ code: 'IDENTITY_CONFLICT', recordIds: group.sort() });
  });
  return { records: [...unique.values()].sort((a: LcmCandidateRecord, b: LcmCandidateRecord) =>
    a.recordId.localeCompare(b.recordId)), diagnostics };
}

export function parseLcmExport(bytes: Buffer, aircraftModel?: string): LcmParsedExport {
  const oleMagic: string = 'd0cf11e0a1b11ae1';
  if (bytes.length > 50 * 1024 * 1024 ||
      (bytes.subarray(0, 8).toString('hex') !== oleMagic && bytes.subarray(0, 4).toString('hex') !== '504b0304')) {
    throw new LcmStagingError('WORKBOOK_FORMAT_INVALID', 'Input must be an Excel workbook within the local size limit.');
  }
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(bytes, { type: 'buffer', cellDates: false, cellFormula: true }); }
  catch { throw new LcmStagingError('WORKBOOK_FORMAT_INVALID', 'The Excel workbook cannot be read.'); }
  if (workbook.SheetNames.length !== 1) {
    throw new LcmStagingError('SHEET_LAYOUT_UNSUPPORTED', 'Only a single export sheet is supported; extra sheets are not ignored.');
  }
  const name: string = workbook.SheetNames[0];
  const sheet: XLSX.WorkSheet = workbook.Sheets[name];
  if (!sheet['!ref']) throw new LcmStagingError('WORKBOOK_EMPTY', 'The workbook contains no export rows.');
  const range: XLSX.Range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.s.r !== 0 || range.s.c !== 0 || (range.e.r + 1) * (range.e.c + 1) > MAX_CELLS) {
    throw new LcmStagingError('WORKBOOK_RANGE_INVALID', 'The export range is shifted or exceeds local limits.');
  }
  const kind: LcmParsedExport['kind'] = cellText(readCell(sheet, name, 0, 0)) === '所属构型'
    ? 'as-flown-detail' : 'tail-matrix';
  const parsed: { metadata: LcmExportMetadata; records: LcmCandidateRecord[] } = kind === 'as-flown-detail'
    ? parseDetail(sheet, name, range, aircraftModel) : parseMatrix(sheet, name, range, aircraftModel);
  const consolidated: { records: LcmCandidateRecord[]; diagnostics: LcmDiagnostic[] } = consolidate(parsed.records);
  if (consolidated.records.length === 0) throw new LcmStagingError('EXPORT_EMPTY', 'No candidate records were observed.');
  const digestContent: unknown = {
    kind, aircraftModel: parsed.metadata.aircraftModel,
    exportDate: parsed.metadata.exportDate.localDateTime,
    records: consolidated.records.map((record: LcmCandidateRecord) => recordContent(record)),
  };
  return {
    schemaVersion: 'wiselink.lcm.local_export.v1', kind, sourceAuthority: 'unverified/local',
    metadata: parsed.metadata, records: consolidated.records, diagnostics: consolidated.diagnostics,
    contentDigest: sha256(canonicalJson(digestContent)),
  };
}
