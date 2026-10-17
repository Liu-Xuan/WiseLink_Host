import type { LcmNativeMatrixResponse } from '@shared/lcm-native-matrix.interface';
import { snapshot } from '../tdms-p1-frontend/fixtures';

export const nativeSnapshotId: string = 'a'.repeat(64);

export function nativeMatrixFixture(): LcmNativeMatrixResponse {
  const aircraft = Array.from({ length: 76 }, (_, column: number) => ({
    tailNumber: 'LOCAL-' + String(column + 1).padStart(3, '0'), sourceColumn: column + 6,
    rawValue: 'LOCAL-' + String(column + 1).padStart(3, '0'),
  }));
  return { binding: { readSetRef: 'native-readset', projectionRevision: 'native-v1', scopeRef: 'scope',
    permissionRevision: 'p1', filterHash: 'native-local-filters', orderRef: 'native-local-aircraft-order' },
  snapshots: [{ ...snapshot(nativeSnapshotId), coveredAircraftModels: ['A321'], coveredAircraftCount: 76,
    recordCount: 4, originalFileName: 'LOCAL-SYNTHETIC-MATRIX.xls' }],
  matrices: [{ snapshotId: nativeSnapshotId, managementDomainRef: 'LOCAL_TEST_DOMAIN', matrix: {
    schemaVersion: 'wiselink.lcm.native_matrix.v1', kind: 'tail-matrix', aircraftModel: 'A321',
    sheet: 'Sheet1', rawSha256: 'f'.repeat(64), range: { firstRow: 2, lastRow: 5, firstColumn: 1, lastColumn: 81 },
    fixedColumns: ['软件名称', '软件件号', 'FIN号', 'ATA章', '系统'].map((name: string, column: number) => ({
      name, sourceColumn: column + 1, rawValue: name,
    })), aircraft,
    rows: [
      { sourceRow: 2, fixed: ['FAC', 'FAC-PN-1', 'FIN-A', '22', 'Flight control'],
        states: aircraft.map((_, index: number) => index < 69 ? 1 : index === 75 ? '' : 2) },
      { sourceRow: 3, fixed: ['FAC', 'FAC-PN-1', 'FIN-B', '22', 'Flight control'],
        states: aircraft.map((_, index: number) => index < 69 ? 1 : index === 75 ? '' : 2) },
      { sourceRow: 4, fixed: ['FAC', 'FAC-PN-2', 'FIN-C', '22', 'Flight control'],
        states: aircraft.map((_, index: number) => index === 69 ? 1 : 2) },
      { sourceRow: 5, fixed: ['Navigation', 'NAV-PN-1', 'FIN-NAV', '34', 'Navigation'],
        states: aircraft.map(() => 2) },
    ],
  } }],
  };
}
