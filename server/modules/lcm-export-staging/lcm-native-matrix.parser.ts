import * as XLSX from 'xlsx';
import type { LcmCellValue } from '@shared/lcm-export-staging.interface';
import type { LcmNativeMatrix } from '@shared/lcm-native-matrix.interface';
import {
  cellText,
  LcmStagingError,
  readCell,
  sha256,
} from './lcm-export.helpers';

const FIXED_HEADERS: string[] = [
  'ATA章',
  '系统',
  '类型',
  '软件名称',
  '软件件号',
];

/** Matrix imports never build per-aircraft candidate records. */
export function parseLcmPersonalExport(
  bytes: Buffer,
  aircraftModel: string,
): LcmNativeMatrix {
  if (
    bytes.length > 50 * 1024 * 1024 ||
    (bytes.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1' &&
      bytes.subarray(0, 4).toString('hex') !== '504b0304')
  )
    throw new LcmStagingError(
      'WORKBOOK_FORMAT_INVALID',
      'Expected an Excel workbook within the size limit.',
    );
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(bytes, {
      type: 'buffer',
      cellDates: false,
      cellFormula: true,
    });
  } catch {
    throw new LcmStagingError(
      'WORKBOOK_FORMAT_INVALID',
      'The workbook cannot be read.',
    );
  }
  if (book.SheetNames.length !== 1)
    throw new LcmStagingError(
      'SHEET_LAYOUT_UNSUPPORTED',
      'Exactly one source sheet is required.',
    );
  const name: string = book.SheetNames[0];
  const sheet: XLSX.WorkSheet = book.Sheets[name];
  if (!sheet['!ref'])
    throw new LcmStagingError('WORKBOOK_EMPTY', 'No source range.');
  const range: XLSX.Range = XLSX.utils.decode_range(sheet['!ref']);
  if (
    range.s.r !== 0 ||
    range.s.c !== 0 ||
    range.e.r < 1 ||
    (range.e.r + 1) * (range.e.c + 1) > 500000
  )
    throw new LcmStagingError(
      'WORKBOOK_RANGE_INVALID',
      'Shifted, empty or excessive source range.',
    );
  if (!aircraftModel.trim())
    throw new LcmStagingError(
      'AIRCRAFT_MODEL_REQUIRED',
      'An explicit model is required.',
    );
  if (
    FIXED_HEADERS.some(
      (header: string, column: number) =>
        cellText(readCell(sheet, name, 0, column)) !== header,
    )
  )
    throw new LcmStagingError(
      'MATRIX_LAYOUT_INVALID',
      'Expected the source matrix identity headers.',
    );
  const headers: string[] =
    cellText(readCell(sheet, name, 0, 5)) === 'FIN号'
      ? [...FIXED_HEADERS, 'FIN号']
      : FIXED_HEADERS;
  const matrix: LcmNativeMatrix = {
    schemaVersion: 'wiselink.lcm.native_matrix.v1',
    kind: 'tail-matrix',
    aircraftModel: aircraftModel.trim(),
    sheet: name,
    rawSha256: sha256(bytes),
    range: {
      firstRow: 1,
      lastRow: range.e.r + 1,
      firstColumn: 1,
      lastColumn: range.e.c + 1,
    },
    fixedColumns: headers.map((header: string, column: number) => ({
      name: header,
      sourceColumn: column + 1,
      rawValue: readCell(sheet, name, 0, column).rawValue,
    })),
    aircraft: [],
    rows: [],
  };
  const seen: Set<string> = new Set();
  for (let column: number = headers.length; column <= range.e.c; column++) {
    const cell = readCell(sheet, name, 0, column);
    const tail: string | null = cellText(cell);
    if (tail === null || !/^B-[A-Z0-9]{4,6}$/u.test(tail) || seen.has(tail))
      throw new LcmStagingError(
        'MATRIX_TAIL_INVALID',
        'Aircraft headers must be unique explicit tail numbers.',
      );
    seen.add(tail);
    matrix.aircraft.push({
      tailNumber: tail,
      sourceColumn: column + 1,
      rawValue: cell.rawValue,
    });
  }
  if (!matrix.aircraft.length)
    throw new LcmStagingError('MATRIX_TAIL_INVALID', 'No aircraft columns.');
  for (let row: number = 1; row <= range.e.r; row++) {
    const values: LcmCellValue[] = [];
    for (let column: number = 0; column <= range.e.c; column++) {
      const cell = readCell(sheet, name, row, column);
      cellText(cell); // Reject formulas/unsupported cells, retaining the original scalar below.
      values.push(cell.rawValue);
    }
    matrix.rows.push({
      sourceRow: row + 1,
      fixed: values.slice(0, headers.length),
      states: values.slice(headers.length),
    });
  }
  if (
    !matrix.rows.some((row: LcmNativeMatrix['rows'][number]) =>
      row.fixed.some(
        (value: LcmCellValue) => value !== null && String(value).trim() !== '',
      ),
    )
  )
    throw new LcmStagingError('EXPORT_EMPTY', 'No source identity rows.');
  return matrix;
}
