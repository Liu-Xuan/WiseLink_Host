import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { lcmModelChoices, lcmModelLabel, lcmModelNames, lcmRawBlank, lcmRecordPresentation } from '@client/src/pages/WorkspaceHomePage/lcm-source-presentation';
import { lcmNativeSelectionIsBlank } from '@client/src/pages/WorkspaceHomePage/lcm-matrix-presentation';
import { LcmSnapshotFacts, LcmSnapshotRecords } from '@client/src/pages/WorkspaceHomePage/LcmSnapshotRecords';
import { buildLcmNativeIndex } from '@shared/lcm-native-matrix-core';
import { lcmAircraftRef } from '@shared/lcm-matrix-core';
import { lcmNativeCellRecord } from '@server/modules/lcm-export-staging/lcm-native-matrix-records';
import { nativeMatrixFixture } from './native-ui-fixtures';

describe('LCM display aliases preserve exact source identities', () => {
  it('displays the complete ARJ21 series as C909 and naturally sorts its COMAC group', () => {
    const models = ['E190', 'ARJ21-700', 'C919-700', 'A320-200', 'B787-9', 'B737-8', 'ARJ210', 'OTHER'];
    const before = [...models];
    expect(lcmModelLabel('ARJ21')).toBe('C909');
    expect(lcmModelLabel('ARJ21-700')).toBe('C909');
    expect(lcmModelLabel('ARJ21-700LR')).toBe('C909');
    expect(lcmModelLabel('ARJ210')).toBe('ARJ210');
    expect(lcmModelChoices(models).map(item => [item.value, item.label])).toEqual([
      ['B737-8', 'B737-8'], ['B787-9', 'B787-9'], ['A320-200', 'A320-200'], ['ARJ210', 'ARJ210'],
      ['ARJ21-700', 'C909'], ['C919-700', 'C919-700'], ['E190', 'E190'], ['OTHER', 'OTHER'],
    ]);
    expect(models).toEqual(before);
  });
  it('keeps independent C909 and ARJ21 source choices separate, including multiple old source names', () => {
    expect(lcmModelChoices(['ARJ21-700', 'C909', 'ARJ21', 'ARJ21-700'])).toEqual([
      { value: 'ARJ21-700', label: 'C909（原 ARJ21-700）' },
      { value: 'C909', label: 'C909' }, { value: 'ARJ21', label: 'C909（原 ARJ21）' },
    ]);
    expect(lcmModelNames(['ARJ21-700'])).toBe('C909');
    expect(lcmModelNames(['ARJ21-700', 'C909'])).toBe('C909（原 ARJ21-700） / C909');
  });
});

describe('only actual source-matrix blanks display as none', () => {
  function source() {
    const data = nativeMatrixFixture(), matrix = data.matrices[0].matrix;
    matrix.aircraftModel = 'ARJ21-700'; matrix.aircraft = matrix.aircraft.slice(0, 3);
    matrix.rows = matrix.rows.slice(0, 1); matrix.rows[0].states = ['', 3, 1];
    return data;
  }
  it('uses exact indexed row/column/model positions and never changes the source or aggregate facts', () => {
    const data = source(), before = structuredClone(data), index = buildLcmNativeIndex(data);
    const software = index.software[0], query = { snapshotIds: [data.matrices[0].snapshotId], aircraftModel: 'ARJ21-700' };
    const ref = (tail: string) => lcmAircraftRef('LOCAL_TEST_DOMAIN', tail);
    expect(lcmNativeSelectionIsBlank(index, query, software.softwareRef, ref('LOCAL-001'), 'FAC-PN-1')).toBe(true);
    expect(lcmNativeSelectionIsBlank(index, query, software.softwareRef, ref('LOCAL-002'), 'FAC-PN-1')).toBe(false);
    expect(lcmNativeSelectionIsBlank(index, query, software.softwareRef, ref('LOCAL-003'), 'FAC-PN-1')).toBe(false);
    expect(lcmNativeSelectionIsBlank(index, query, software.softwareRef, ref('ABSENT'), 'FAC-PN-1')).toBe(false);
    expect(lcmNativeSelectionIsBlank(index, { ...query, aircraftModel: 'C909' }, software.softwareRef, ref('LOCAL-001'))).toBe(false);
    expect(lcmNativeSelectionIsBlank(index, { ...query, snapshotIds: [] }, software.softwareRef, ref('LOCAL-001'))).toBe(false);
    expect(lcmNativeSelectionIsBlank(index, { ...query, aircraftRefs: [] }, software.softwareRef, ref('LOCAL-001'))).toBe(false);
    expect(data).toEqual(before);
  });
  it.each(['mixed', 'missing-rectangle'] as const)('does not turn a %s aggregate into none', kind => {
    const data = source(), other = structuredClone(data.matrices[0]);
    other.snapshotId = 'b'.repeat(64);
    if (kind === 'mixed') other.matrix.rows[0].states[0] = 2;
    else other.matrix.aircraft[0].tailNumber = 'OTHER-TAIL';
    data.matrices.push(other);
    const index = buildLcmNativeIndex(data), sw = index.software[0];
    expect(lcmNativeSelectionIsBlank(index, { snapshotIds: data.matrices.map(entry => entry.snapshotId) },
      sw.softwareRef, lcmAircraftRef('LOCAL_TEST_DOMAIN', 'LOCAL-001'), 'FAC-PN-1')).toBe(false);
  });
  it('does not scan unrelated matrices while presenting an indexed blank cell', () => {
    const data = source(), other = structuredClone(data.matrices[0]);
    other.snapshotId = 'b'.repeat(64); other.matrix.rows[0].fixed[0] = 'UNRELATED'; data.matrices.push(other);
    const index = buildLcmNativeIndex(data), software = index.software.find(item => item.lcmSoftwareName === 'FAC')!;
    Object.defineProperty(data.matrices, 1, { get: () => { throw new Error('Unrelated source must not be scanned'); } });
    expect(lcmNativeSelectionIsBlank(index, { snapshotIds: [data.matrices[0].snapshotId] },
      software.softwareRef, lcmAircraftRef('LOCAL_TEST_DOMAIN', 'LOCAL-001'), 'FAC-PN-1')).toBe(true);
  });
  it('shows none in exact source records but preserves uncollected and listing-only unknowns', () => {
    const data = source(), record = lcmNativeCellRecord(data.matrices[0].matrix, 0, 0), before = structuredClone(record);
    expect(lcmRecordPresentation(record)).toMatchObject({ rawState: '无', allowed: '无', installed: '无', effectiveAt: '未知' });
    const withoutCell = structuredClone(record); delete withoutCell.sourceRows[0].cells['矩阵值'];
    expect(lcmRecordPresentation(withoutCell)).toMatchObject({ rawState: '原始状态未取得', allowed: '未知', installed: '未知' });
    expect(lcmRecordPresentation({ ...record, semanticBasis: 'source-listing-only' }).rawState).toBe('原始状态未取得');
    expect(lcmRecordPresentation(lcmNativeCellRecord(data.matrices[0].matrix, 0, 1))).toMatchObject({ rawState: '3', allowed: '未知', installed: '未知' });
    expect(record).toEqual(before);
    expect(lcmRawBlank(undefined)).toBe(false); expect(lcmRawBlank(0)).toBe(false);
    expect(lcmRawBlank(null)).toBe(true); expect(lcmRawBlank('  ')).toBe(true);
    const html = renderToStaticMarkup(createElement(LcmSnapshotRecords, { records: [record] }));
    expect(html).toContain('title="ARJ21-700">C909'); expect(html).toContain('原始状态</dt><dd>无');
    const snapshot = { ...data.snapshots[0], coveredAircraftModels: ['ARJ21-700'], originalFileName: '构型统计_ARJ21-700_2026108161327.xls' };
    const facts = renderToStaticMarkup(createElement(LcmSnapshotFacts, { snapshot }));
    expect(facts).toContain('覆盖机型</dt><dd title="ARJ21-700">C909');
    expect(facts).toContain(snapshot.originalFileName);
  });
});
