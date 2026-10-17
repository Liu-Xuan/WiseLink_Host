import * as XLSX from 'xlsx';
import type {
  LcmCandidateRecord,
  LcmCellRef,
  LcmCellValue,
} from '@shared/lcm-export-staging.interface';
import type { LcmNativeMatrix } from '@shared/lcm-native-matrix.interface';
import { lcmNativeText } from '@shared/lcm-native-matrix-core';
import { canonicalJson, makeRecord } from './lcm-export.helpers';

export function lcmNativeCellRecord(
  matrix: LcmNativeMatrix,
  rowIndex: number,
  columnIndex: number,
): LcmCandidateRecord {
  const row = matrix.rows[rowIndex],
    column = matrix.aircraft[columnIndex];
  const cell = (
    sourceRow: number,
    sourceColumn: number,
    rawValue: LcmCellValue,
  ): LcmCellRef => ({
    sheet: matrix.sheet,
    row: sourceRow,
    column: sourceColumn,
    rawValue,
    formula: null,
    address: XLSX.utils.encode_cell({ r: sourceRow - 1, c: sourceColumn - 1 }),
  });
  const fields: Record<string, string | null> = {};
  const cells: Record<string, LcmCellRef> = {};
  matrix.fixedColumns.forEach((fixed, index: number) => {
    fields[fixed.name] = lcmNativeText(row.fixed[index]);
    cells[fixed.name] = cell(
      row.sourceRow,
      fixed.sourceColumn,
      row.fixed[index],
    );
  });
  const value: string | null = lcmNativeText(row.states[columnIndex]);
  fields['矩阵值'] = value;
  cells['机尾号'] = cell(1, column.sourceColumn, column.rawValue);
  cells['矩阵值'] = cell(
    row.sourceRow,
    column.sourceColumn,
    row.states[columnIndex],
  );
  return makeRecord(
    matrix.aircraftModel,
    column.tailNumber,
    fields,
    value === '1'
      ? 'allowed-and-installed'
      : value === '2'
        ? 'allowed-only'
        : value === null
          ? 'unknown-blank'
          : 'unknown-value',
    [{ sheet: matrix.sheet, row: row.sourceRow, cells }],
  );
}

export function lcmNativeCoordinateKey(
  snapshotId: string,
  matrix: LcmNativeMatrix,
  rowIndex: number,
  columnIndex: number,
): string {
  return canonicalJson([
    snapshotId,
    matrix.sheet,
    matrix.rows[rowIndex].sourceRow,
    matrix.aircraft[columnIndex].sourceColumn,
  ]);
}
