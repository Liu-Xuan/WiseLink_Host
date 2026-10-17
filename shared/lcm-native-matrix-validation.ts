import type { LcmCellValue } from './lcm-export-staging.interface';
import type { LcmNativeMatrix } from './lcm-native-matrix.interface';

export function assertLcmNativeMatrix(
  value: unknown,
): asserts value is LcmNativeMatrix {
  const fail = (): never => {
    throw Object.assign(new Error('LCM_NATIVE_MATRIX_INVALID'), {
      code: 'LCM_NATIVE_MATRIX_INVALID',
      statusCode: 409,
    });
  };
  const object = (item: unknown): item is Record<string, unknown> =>
    Boolean(item) && typeof item === 'object' && !Array.isArray(item);
  const scalar = (item: unknown): item is LcmCellValue =>
    item === null ||
    typeof item === 'string' ||
    typeof item === 'boolean' ||
    (typeof item === 'number' && Number.isFinite(item));
  if (
    !object(value) ||
    value.schemaVersion !== 'wiselink.lcm.native_matrix.v1' ||
    value.kind !== 'tail-matrix' ||
    typeof value.aircraftModel !== 'string' ||
    !value.aircraftModel.trim() ||
    typeof value.sheet !== 'string' ||
    !value.sheet ||
    typeof value.rawSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(value.rawSha256) ||
    !object(value.range) ||
    !Array.isArray(value.fixedColumns) ||
    !Array.isArray(value.aircraft) ||
    !Array.isArray(value.rows)
  )
    fail();
  const matrix = value as unknown as LcmNativeMatrix;
  const headers: string[] = [
    'ATA章',
    '系统',
    '类型',
    '软件名称',
    '软件件号',
    ...(matrix.fixedColumns.length === 6 ? ['FIN号'] : []),
  ];
  if (
    ![5, 6].includes(matrix.fixedColumns.length) ||
    !matrix.rows.length ||
    !matrix.aircraft.length ||
    matrix.range.firstRow !== 1 ||
    matrix.range.firstColumn !== 1 ||
    matrix.range.lastRow !== matrix.rows.length + 1 ||
    matrix.range.lastColumn !==
      matrix.fixedColumns.length + matrix.aircraft.length ||
    matrix.range.lastRow * matrix.range.lastColumn > 500000
  )
    fail();
  matrix.fixedColumns.forEach((column, index: number) => {
    if (
      !object(column) ||
      column.name !== headers[index] ||
      column.sourceColumn !== index + 1 ||
      !scalar(column.rawValue) ||
      String(column.rawValue).trim() !== column.name
    )
      fail();
  });
  const tails: Set<string> = new Set();
  matrix.aircraft.forEach((column, index: number) => {
    if (
      !object(column) ||
      typeof column.tailNumber !== 'string' ||
      !/^B-[A-Z0-9]{4,6}$/u.test(column.tailNumber) ||
      tails.has(column.tailNumber) ||
      column.sourceColumn !== matrix.fixedColumns.length + index + 1 ||
      !scalar(column.rawValue) ||
      String(column.rawValue).trim() !== column.tailNumber
    )
      fail();
    tails.add(column.tailNumber);
  });
  matrix.rows.forEach((row, index: number) => {
    if (
      !object(row) ||
      row.sourceRow !== index + 2 ||
      !Array.isArray(row.fixed) ||
      !Array.isArray(row.states) ||
      row.fixed.length !== matrix.fixedColumns.length ||
      row.states.length !== matrix.aircraft.length ||
      !row.fixed.every(scalar) ||
      !row.states.every(scalar)
    )
      fail();
  });
}
