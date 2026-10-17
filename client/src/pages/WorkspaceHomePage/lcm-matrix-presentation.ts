import type { LcmMatrixQuery } from '@shared/lcm-matrix.interface';
import { lcmModelMatches, lcmQueryModels } from '@shared/lcm-matrix-core';
import { lcmNativeField, type LcmNativeIndex } from '@shared/lcm-native-matrix-core';
import { lcmRawBlank } from './lcm-source-presentation';

/** Reuse the source-sized row/column indices, only for a visible unknown cell.
 * A mixed observation or a missing source rectangle keeps its aggregate meaning. */
export function lcmNativeSelectionIsBlank(index: LcmNativeIndex, query: LcmMatrixQuery,
  softwareRef: string, aircraftRef: string, partNumber?: string | null): boolean {
  if (query.aircraftRefs && !query.aircraftRefs.includes(aircraftRef)) return false;
  const models = lcmQueryModels(query);
  const columns = index.aircraftColumns.get(aircraftRef) ?? [];
  let found = false;
  for (const location of index.softwareRows.get(softwareRef) ?? []) {
    const entry = index.data.matrices[location.matrixIndex];
    if (!query.snapshotIds.includes(entry.snapshotId) || !lcmModelMatches(entry.matrix.aircraftModel, models)) continue;
    if (partNumber !== undefined && lcmNativeField(entry.matrix, location.rowIndex, '软件件号') !== partNumber) continue;
    const column = columns.find(value => value.matrixIndex === location.matrixIndex);
    if (!column || !lcmRawBlank(entry.matrix.rows[location.rowIndex].states[column.columnIndex])) return false;
    found = true;
  }
  return found;
}
