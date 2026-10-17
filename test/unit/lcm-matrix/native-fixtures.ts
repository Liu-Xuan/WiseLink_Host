import * as XLSX from 'xlsx';
import { parseLcmPersonalExport } from '@server/modules/lcm-export-staging/lcm-native-matrix.parser';
import type { LcmNativeMatrixResponse } from '@shared/lcm-native-matrix.interface';
import { snapshot } from '../tdms-p1-frontend/fixtures';

export const nativeId: string = '1'.repeat(64);
export function nativeFixture(): LcmNativeMatrixResponse {
  const book: XLSX.WorkBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [
        'ATA章',
        '系统',
        '类型',
        '软件名称',
        '软件件号',
        'FIN号',
        'B-1001',
        'B-1002',
        'B-1003',
      ],
      ['22', 'SYS', 'OPS', '22 FCC OPS', 'A', 'LEFT', '1', '', '2'],
      ['22', 'SYS', 'OPS', '22 FCC OPS', 'A', 'RIGHT', '1', '', ''],
      ['22', 'SYS', 'OPS', '22 FCC OPS', 'B', null, '', '1', ''],
      ['22', 'SYS', 'OPS', '22 FCC OPS', 'A', null, '', '1', ''],
      ['27', 'SYS', 'OPS', '27 OTHER', 'C', null, '', '2', ''],
    ]),
    'Sheet0',
  );
  const matrix = parseLcmPersonalExport(
    XLSX.write(book, { type: 'buffer', bookType: 'xls' }),
    'B787-9',
  );
  return {
    binding: {
      readSetRef: 'native-test',
      scopeRef: 'native-scope',
      permissionRevision: 'p1',
      projectionRevision: 'wiselink.lcm.native_matrix.v1',
      filterHash: 'native-local-filters',
      orderRef: 'native-local-aircraft-order',
    },
    snapshots: [
      {
        ...snapshot(nativeId),
        originalSha256: matrix.rawSha256,
        coveredAircraftCount: 3,
        recordCount: 5,
      },
    ],
    matrices: [
      { snapshotId: nativeId, managementDomainRef: 'test-domain', matrix },
    ],
  };
}
