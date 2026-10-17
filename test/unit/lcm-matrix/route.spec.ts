import type { LcmMatrixResponse } from '@shared/lcm-matrix.interface';
import { lcmQueryFromRoute, readLcmExpansion, writeLcmExpansion } from '@client/src/pages/WorkspaceHomePage/lcm-matrix-route';
const index: LcmMatrixResponse = { binding: { readSetRef: 'exact-readset', scopeRef: 'exact-authorized-scope',
  permissionRevision: 'p1', projectionRevision: 'r2', filterHash: 'filter', orderRef: 'order' },
  snapshots: [], sourceMode: 'CANDIDATE', aircraftIndex: [], aircraftOrder: [], orderGroups: [],
  softwareGroups: [], anchorSoftwareRef: null, anchorCleared: false, rowStart: 0, columnStart: 0, columns: [],
  softwareIndex: Array.from({ length: 500 }, (_, i) => ({ softwareRef: 'long-source-name-' + i + '-'.repeat(150),
    managementDomainRef: 'domain', lcmSoftwareName: 'Source Name ' + i, ata: [], systems: [], sourceOrder: i * 3,
    parts: [], aliases: [], knownInstalledSetDifference: false })) };

it('all-expand for 500 software stays compact and reloadable rather than producing a huge URL', () => {
  const expanded = new Set(index.softwareIndex.map(group => group.softwareRef));
  const params = writeLcmExpansion(new URLSearchParams({ mode: 'lcm' }), index, expanded);
  expect(params.toString().length).toBeLessThan(1500);
  expect(readLcmExpansion(params, index)).toEqual(expanded);
});
it('filtering software keeps stable source positions and never expands a different software', () => {
  const expanded = new Set(index.softwareIndex.filter((_, i) => i % 2 === 0).map(group => group.softwareRef));
  const params = writeLcmExpansion(new URLSearchParams(), index, expanded);
  const subset = { ...index, softwareIndex: index.softwareIndex.filter((_, i) => i >= 490) };
  expect([...readLcmExpansion(params, subset)]).toEqual(subset.softwareIndex.filter((_, i) => i % 2 === 0)
    .map(group => group.softwareRef));
});
it.each(['readSetRef', 'scopeRef', 'permissionRevision', 'projectionRevision'] as const)
  ('does not restore an expired expansion %s', key => {
    const params = writeLcmExpansion(new URLSearchParams(), index, new Set([index.softwareIndex[0].softwareRef]));
    expect(readLcmExpansion(params, { ...index, binding: { ...index.binding, [key]: 'changed' } }).size).toBe(0);
  });
it('legacy expansion links are constrained to the currently authorized software index', () => {
  const params = new URLSearchParams(); params.append('lcmExpanded', 'foreign-software');
  params.append('lcmExpanded', index.softwareIndex[0].softwareRef);
  expect([...readLcmExpansion(params, index)]).toEqual([index.softwareIndex[0].softwareRef]);
});

it('restores repeated model pins, supports legacy single model, and clears to all without combining names', () => {
  expect(lcmQueryFromRoute(new URLSearchParams('aircraftModel=B737-8')).aircraftModel).toBe('B737-8');
  const params = new URLSearchParams('aircraftModel=B737-8&aircraftModel=A320-200&aircraftModel=B737-8');
  expect(lcmQueryFromRoute(params)).toMatchObject({ aircraftModels: ['A320-200', 'B737-8'] });
  expect(lcmQueryFromRoute(params).aircraftModel).toBeUndefined();
  params.delete('aircraftModel'); expect(lcmQueryFromRoute(params).aircraftModels).toBeUndefined();
});
it('keeps expansion identities through natural display reordering and browser route restoration', () => {
  const selected = index.softwareIndex[15].softwareRef;
  const params = writeLcmExpansion(new URLSearchParams(), index, new Set([selected]));
  const sorted = { ...index, softwareIndex: [...index.softwareIndex].reverse() };
  expect([...readLcmExpansion(new URLSearchParams(params.toString()), sorted)]).toEqual([selected]);
});
