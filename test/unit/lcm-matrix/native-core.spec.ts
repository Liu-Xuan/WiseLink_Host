import * as XLSX from 'xlsx';
import {
  buildLcmNativeIndex,
  lcmNativeWindow,
  lcmNativeAircraftRows,
  lcmNativePartCell,
  lcmNativeSummary,
} from '@shared/lcm-native-matrix-core';
import { lcmAircraftRef, lcmSortedModels } from '@shared/lcm-matrix-core';
import { assertLcmNativeMatrix } from '@shared/lcm-native-matrix-validation';
import { parseLcmPersonalExport } from '@server/modules/lcm-export-staging/lcm-native-matrix.parser';
import { lcmNativeCellRecord } from '@server/modules/lcm-export-staging/lcm-native-matrix-records';
import { nativeFixture, nativeId } from './native-fixtures';

describe('source matrix parser and local indices', () => {
  it('keeps every source cell and coordinate without expanded records', () => {
    const matrix = nativeFixture().matrices[0].matrix;
    assertLcmNativeMatrix(matrix);
    expect(matrix.rows).toHaveLength(5);
    expect(matrix.rows[0].states).toEqual(['1', '', '2']);
    expect(matrix.rows[2].fixed[5]).toBeNull();
    expect(matrix.aircraft[1]).toEqual({
      tailNumber: 'B-1002',
      sourceColumn: 8,
      rawValue: 'B-1002',
    });
    expect(matrix).not.toHaveProperty('records');
    const record = lcmNativeCellRecord(matrix, 0, 1);
    expect(record.sourceRows[0].cells['矩阵值']).toMatchObject({
      sheet: 'Sheet0',
      row: 2,
      column: 8,
      address: 'H2',
      rawValue: '',
    });
    expect(record.sourceRows[0].cells['FIN号'].rawValue).toBe('LEFT');
  });
  it('counts aircraft once across FINs and keeps unlocated rows separate', () => {
    const index = buildLcmNativeIndex(nativeFixture());
    const view = lcmNativeWindow(index, { query: { snapshotIds: [nativeId] } });
    const software = view.softwareIndex.find(
      (group) => group.lcmSoftwareName === '22 FCC OPS',
    )!;
    expect(
      software.parts.find((part) => part.partNumber === 'A')!
        .confirmedInstalledAircraftCount,
    ).toBe(2);
    expect(
      lcmNativePartCell(
        index,
        software.softwareRef,
        'A',
        lcmAircraftRef('test-domain', 'B-1001'),
      ).installed,
    ).toBe(true);
    expect(
      lcmNativeSummary(index, software, lcmAircraftRef('test-domain', 'B-1002'))
        .installedPartNumbers,
    ).toEqual(['A', 'B']);
    expect(index.softwareRows.get(software.softwareRef)).toHaveLength(4);
  });
  it('distinguishes covered blank from a missing source rectangle', () => {
    const data = nativeFixture();
    const other = structuredClone(data.matrices[0]);
    other.snapshotId = '2'.repeat(64);
    other.matrix.aircraft = [
      { tailNumber: 'B-2001', sourceColumn: 7, rawValue: 'B-2001' },
    ];
    other.matrix.rows = [other.matrix.rows[4]];
    other.matrix.rows[0].sourceRow = 2;
    other.matrix.rows[0].states = [''];
    other.matrix.range.lastRow = 2;
    other.matrix.range.lastColumn = 7;
    data.matrices.push(other);
    const index = buildLcmNativeIndex(data),
      sw = index.software.find(
        (group) => group.lcmSoftwareName === '22 FCC OPS',
      )!;
    expect(
      lcmNativePartCell(
        index,
        sw.softwareRef,
        'A',
        lcmAircraftRef('test-domain', 'B-1003'),
      ).state,
    ).toBe('UNKNOWN');
    expect(
      lcmNativePartCell(
        index,
        sw.softwareRef,
        'A',
        lcmAircraftRef('test-domain', 'B-2001'),
      ).state,
    ).toBe('NO_RECORD');
  });
  it('sorts all software columns by only one selected software and keeps unknown separate', () => {
    const index = buildLcmNativeIndex(nativeFixture()),
      sw = index.software[0];
    const result = lcmNativeWindow(index, {
      query: { snapshotIds: [nativeId], anchorSoftwareRef: sw.softwareRef },
      expandedSoftwareRefs: [sw.softwareRef],
    });
    expect(result.orderGroups.map((group) => group.kind)).toEqual([
      'OBSERVED_INSTALLED_SET',
      'OBSERVED_INSTALLED_SET',
      'UNCONFIRMED_BUCKET',
    ]);
    expect(result.columns).toEqual(result.aircraftOrder);
    expect(
      result.softwareGroups[1].summaryCells.map((cell) => cell.aircraftRef),
    ).toEqual(result.columns);
  });
  it('reads the selected aircraft column locally, preserving raw blanks and FIN', () => {
    const index = buildLcmNativeIndex(nativeFixture());
    const rows = lcmNativeAircraftRows(
      index,
      { snapshotIds: [nativeId] },
      lcmAircraftRef('test-domain', 'B-1001'),
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      fin: 'LEFT',
      rawValue: '1',
      sourceRow: 2,
      sourceColumn: 7,
    });
    expect(rows[2]).toMatchObject({
      installed: null,
      allowed: null,
      rawValue: '',
    });
  });
  it('naturally orders software and virtual windows while retaining source expansion positions', () => {
    const data = nativeFixture(), rows = data.matrices[0].matrix.rows;
    ['31 DPC OSS', '2 DFDAU', '12 DFDAU', '2 DFDAU', '3 DFDAU'].forEach((name, i) => { rows[i].fixed[3] = name; });
    const index = buildLcmNativeIndex(data);
    expect(index.software.map(sw => sw.lcmSoftwareName)).toEqual(['2 DFDAU', '3 DFDAU', '12 DFDAU', '31 DPC OSS']);
    expect(index.software.map(sw => sw.sourceOrder)).toEqual([1, 3, 2, 0]);
    const view = lcmNativeWindow(index, { query: { snapshotIds: [nativeId] }, rowStart: 2, rowLimit: 1 });
    expect(view.softwareIndex.map(sw => sw.softwareRef)).toEqual(index.software.map(sw => sw.softwareRef));
    expect(view.softwareGroups.map(sw => sw.softwareRef)).toEqual([index.software[2].softwareRef]);
    expect(lcmNativeAircraftRows(index, { snapshotIds: [nativeId] }, lcmAircraftRef('test-domain', 'B-1001'))
      .map(row => row.lcmSoftwareName)).toEqual(['2 DFDAU', '2 DFDAU', '3 DFDAU', '12 DFDAU', '31 DPC OSS']);
  });
  it('filters multiple real models consistently for window counts, summary and aircraft rows', () => {
    const data = nativeFixture();
    for (const [i, model] of ['A320-200', 'C919'].entries()) {
      const other = structuredClone(data.matrices[0]);
      other.snapshotId = String(i + 2).repeat(64); other.matrix.aircraftModel = model;
      other.matrix.rows.forEach(row => { row.states = row.states.map(() => model === 'C919' ? '2' : '1'); });
      data.matrices.push(other);
    }
    const index = buildLcmNativeIndex(data), query = { snapshotIds: [nativeId], aircraftModels: ['B787-9', 'A320-200'] };
    const view = lcmNativeWindow(index, { query });
    const sw = view.softwareIndex.find(value => value.lcmSoftwareName === '22 FCC OPS')!;
    expect(view.aircraftOrder).toHaveLength(3);
    expect(sw.parts.find(part => part.partNumber === 'A')?.confirmedInstalledAircraftCount).toBe(2);
    // The same tail has contradictory source values across the selected synthetic models.
    expect(lcmNativeSummary(index, sw, view.aircraftOrder[2], query.aircraftModels).qualification).toBe('CONFLICT');
    expect(lcmNativeSummary(index, sw, view.aircraftOrder[2], query.aircraftModels).installedPartNumbers).toEqual(['B']);
    expect(view.softwareGroups.find(value => value.softwareRef === sw.softwareRef)?.summaryCells[2].installedPartNumbers).toEqual(['B']);
    const rows = lcmNativeAircraftRows(index, query, view.aircraftOrder[0]);
    expect(rows).toHaveLength(10); expect(rows.map(row => row.snapshotId)).not.toContain('3'.repeat(64));
    expect(lcmNativeWindow(index, { query: { snapshotIds: [nativeId], aircraftModel: 'B787-9' } }).softwareIndex[0]
      .parts.find(part => part.partNumber === 'A')?.confirmedInstalledAircraftCount).toBe(2);
    expect(lcmNativeWindow(index, { query: { snapshotIds: [nativeId], aircraftModels: ['absent'] } }).aircraftOrder).toEqual([]);
  });
  it('orders Boeing, Airbus and COMAC naturally and leaves other actual models in stable source order', () => {
    expect(lcmSortedModels(['E190', 'C919', 'A320-200', 'B787-9', 'B737-800', 'B737-8', 'A319', 'C909', 'OTHER', 'E190']))
      .toEqual(['B737-8', 'B737-800', 'B787-9', 'A319', 'A320-200', 'C909', 'C919', 'E190', 'OTHER']);
  });
  it('rejects malformed bodies, duplicate tails, formulas and unsupported multi-sheet inputs', () => {
    const matrix = nativeFixture().matrices[0].matrix;
    matrix.rows[0].sourceRow = 99;
    expect(() => assertLcmNativeMatrix(matrix)).toThrow(
      'LCM_NATIVE_MATRIX_INVALID',
    );
    const book: XLSX.WorkBook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ['ATA章', '系统', '类型', '软件名称', '软件件号', 'B-1001'],
      ['22', '', '', 'SW', 'P', 1],
    ]);
    sheet.F2.f = '1+1';
    XLSX.utils.book_append_sheet(book, sheet, 'Sheet0');
    expect(() =>
      parseLcmPersonalExport(
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
        'MODEL',
      ),
    ).toThrow();
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet([['extra']]),
      'extra',
    );
    expect(() =>
      parseLcmPersonalExport(
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
        'MODEL',
      ),
    ).toThrow();
  });
});
