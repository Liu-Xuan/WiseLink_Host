import type { LcmMatrixResponse, LcmMatrixWindowRequest } from '@shared/lcm-matrix.interface';
import { lcmQueryModels } from '@shared/lcm-matrix-core';
import { lcmNativePartCell, lcmNativeSummary, type LcmNativeIndex } from '@shared/lcm-native-matrix-core';

/** Filter/count/order metadata is memoized separately; scrolling only builds visible cells. */
export function lcmNativeViewport(index: LcmNativeIndex, view: LcmMatrixResponse,
  request: LcmMatrixWindowRequest): LcmMatrixResponse {
  const rowStart: number = request.rowStart ?? 0, columnStart: number = request.columnStart ?? 0;
  const models = lcmQueryModels(request.query);
  const columns: string[] = view.aircraftOrder.slice(columnStart, columnStart + (request.columnLimit ?? 16));
  return { ...view, rowStart, columnStart, columns,
    softwareGroups: view.softwareIndex.slice(rowStart, rowStart + (request.rowLimit ?? 20)).map(group => ({
      softwareRef: group.softwareRef,
      summaryCells: columns.map(ref => lcmNativeSummary(index, group, ref, models)),
      partRows: request.expandedSoftwareRefs?.includes(group.softwareRef) ? group.parts.map(part => ({ ...part,
        cells: columns.map(ref => lcmNativePartCell(index, group.softwareRef, part.partNumber, ref,
          models)),
      })) : [],
    })),
  };
}
