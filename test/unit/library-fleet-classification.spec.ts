import { Children, isValidElement, createElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanonicalLibraryFleetCatalog } from '../../shared/library-fleet.interface';
import { buildLibraryHierarchy } from '../../client/src/pages/WorkspaceHomePage/library-classification';
import { matchesLibraryFleet, libraryAircraftBusinessGroup, libraryAircraftBusinessGroups } from '../../client/src/pages/WorkspaceHomePage/library-fleet-classification';
import { LibraryFleetControls } from '../../client/src/pages/WorkspaceHomePage/LibraryFleetControls';
import { libraryFamily, libraryMetadata } from './fixtures/canonical-library';

jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

const catalog: CanonicalLibraryFleetCatalog = {
  scope: 'CURRENT_TENANT_ACTIVE_FLEET', status: 'AVAILABLE', asOf: '2026-09-10T00:00:00Z',
  source: { sourceSnapshotId: 'test-only', sourceRevisionKey: 'test-revision', sourceAsOf: '2026-09-10T00:00:00Z', authorityRevision: '1' },
  families: [{ fleetFamily: '787', models: ['787-9', '787-10'] }], unclassifiedAssetCount: 0,
  semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
};
function document(id: string, model: string) {
  const result = libraryFamily(id);
  result.versions[0].extractedMetadata = libraryMetadata('34', model);
  return result;
}
interface ActionProps { children?: ReactNode; onClick?: () => void }
function buttons(node: ReactNode): ReactElement<ActionProps>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<ActionProps>(child) ? [...(child.type === 'button' ? [child] : []), ...buttons(child.props.children)] : []);
}

describe('authoritative fleet library classification', () => {
  it('matches real B787-9 authority to 787-9 document mentions without inventing parentage or stripping other letters', () => {
    const source = { ...catalog, families: [{ fleetFamily: 'B787', models: ['B787-9'] }, { fleetFamily: 'A320', models: ['A320-200'] }] };
    const fleetDocuments = [document('child', '787-9'), document('prefixed', 'B787-9'), document('sibling', '787-10'), document('broad', '787'), document('wrong-prefix', 'C787-9'), document('airbus-unmapped', '320-200')];
    const filters = { fleetFamily: 'B787', fleetModel: 'B787-9' };
    expect(fleetDocuments.filter((item) => matchesLibraryFleet(item, source, filters)).map((item) => item.familyId)).toEqual(['child', 'prefixed']);
    expect(fleetDocuments.filter((item) => matchesLibraryFleet(item, source, { fleetFamily: 'B787' })).map((item) => item.familyId)).toEqual(['child', 'prefixed', 'broad']);
    expect(matchesLibraryFleet(fleetDocuments[5], source, { fleetFamily: 'A320', fleetModel: 'A320-200' })).toBe(false);
    const tree = buildLibraryHierarchy(fleetDocuments, 'aircraft', filters, source);
    expect(tree[0].key).toBe('B787');
    expect(tree[0].children[0].key).toBe('B787-9');
    expect(tree[0].children[0].documents.map((item) => item.familyId)).toEqual(['child', 'prefixed']);
  });
  const parent = document('parent', '787');
  const child = document('child', ' 787-9 ');
  const sibling = document('sibling', '787-10');
  const outside = document('outside', '777-300');
  const documents = [parent, child, sibling, outside];
  it('includes active children for parent but matches only exact child for child selection', () => {
    expect(documents.filter((item) => matchesLibraryFleet(item, catalog, { fleetFamily: '787' })).map((item) => item.familyId)).toEqual(['parent', 'child', 'sibling']);
    expect(documents.filter((item) => matchesLibraryFleet(item, catalog, { fleetFamily: '787', fleetModel: '787-9' })).map((item) => item.familyId)).toEqual(['child']);
    expect(matchesLibraryFleet(child, { ...catalog, families: [{ fleetFamily: 'OTHER', models: ['787-9'] }] }, { fleetFamily: '787' })).toBe(false);
  });
  it.each(['category', 'ata', 'aircraft'] as const)('preserves parent results with %s first', (first) => {
    const groups = buildLibraryHierarchy(documents, first, { fleetFamily: '787', ata: '34' }, catalog);
    expect(groups.flatMap((group) => group.documents).map((item) => item.familyId)).toEqual(['parent', 'child', 'sibling']);
  });
  it('renders only authoritative aircraft branches and retains outside documents without inventing families', () => {
    const tree = buildLibraryHierarchy(documents, 'aircraft', {}, catalog);
    expect(tree.map((group) => group.key)).toEqual(['787', '__OUTSIDE_FLEET__']);
    expect(tree[0].children.map((group) => group.key)).toEqual(['787-9', '787-10', '__FAMILY_MENTION__']);
    expect(tree[1].documents).toEqual([outside]);
  });
  it('keeps all documents reachable for missing or empty catalogs', () => {
    for (const value of [null, { ...catalog, status: 'MISSING' as const, source: null, families: [] }, { ...catalog, families: [] }]) {
      const tree = buildLibraryHierarchy(documents, 'aircraft', {}, value);
      expect(tree).toHaveLength(1);
      expect(tree[0].documents).toEqual(documents);
      expect(tree[0].key).toBe('__OUTSIDE_FLEET__');
    }
  });
  it('clears legacy and child filters when choosing parent, preserves category and search-independent facets', () => {
    const onFilterChange = jest.fn();
    const actions = buttons(LibraryFleetControls({ fleet: { catalog, loading: false, error: null }, filters: { normalizedFamily: 'SB', ata: '34', aircraftModel: '777', fleetModel: '787-10' }, disabled: false, onFilterChange }));
    actions.find((button) => Children.toArray(button.props.children).join('') === '787-9')?.props.onClick?.();
    expect(onFilterChange).toHaveBeenLastCalledWith({ normalizedFamily: 'SB', ata: '34', aircraftModel: '', aircraftModels: '["787-9"]', fleetFamily: '', fleetModel: '' });
  });
  it('uses all observed real model groups when fleet snapshots are unavailable and folds actual errors', () => {
    const render = (fleet: Parameters<typeof LibraryFleetControls>[0]['fleet']) => renderToStaticMarkup(createElement(LibraryFleetControls,
      { fleet, counts: { A320: 1, '747-8': 1, '777-300ER': 1, '737-800': 1, '737 MAX': 1 }, filters: {}, disabled: false, onFilterChange: jest.fn() }));
    for (const fleet of [undefined, { catalog: { ...catalog, status: 'MISSING' as const, source: null, families: [] }, loading: false, error: null }]) {
      const html = render(fleet);
      expect(html).toContain('A320'); expect(html).toContain('747-8'); expect(html).toContain('737NG'); expect(html).toContain('737MAX');
    }
    expect(render({ catalog: null, loading: false, error: '服务不可用' })).toContain('机队目录读取失败');
    expect(render({ catalog: { ...catalog, unclassifiedAssetCount: 2 }, loading: false, error: null })).toContain('2 架资产机型字段不完整');
  });
  it('classifies only explicit NG/MAX mentions and keeps broad or other real models distinct', () => {
    for (const model of ['737-600', '737-700', '737-800', '737-900', 'B737-900ER', '737-600/700/800/900']) expect(libraryAircraftBusinessGroup(model)).toBe('737NG');
    for (const model of ['737MAX', '737 MAX', 'B737-MAX', '737 MAX 8', '737-8 MAX']) expect(libraryAircraftBusinessGroup(model)).toBe('737MAX');
    expect(libraryAircraftBusinessGroup('737')).toBe('737');
    expect(libraryAircraftBusinessGroup('737-8')).toBe('737-8');
    const raw = ['737-800', '737-700', '737', '737-8', '747-8', '747-400', '777-300ER', '787-9', 'A320', 'A350'];
    const groups = libraryAircraftBusinessGroups(raw);
    expect(groups.find(group => group.key === '737NG')?.models).toEqual(['737-700', '737-800']);
    expect(groups.map(group => group.key)).toContain('A350');
    expect(groups.length).toBeGreaterThan(6);
    expect(raw).toContain('737-700');
    const mixed = libraryAircraftBusinessGroups(['737-800/777-300ER']);
    expect(mixed.find(group => group.key === '737NG')?.models).toEqual(['737-800/777-300ER']);
    expect(mixed.find(group => group.key === '777-300ER')?.models).toEqual(['737-800/777-300ER']);
  });
});

it('groups explicit Airbus certification variants into their source parent while retaining requested Boeing business dimensions', () => {
  const original = ['A319-113', 'A319-114', 'A320-214', 'A321-231', '747-8', '747-400', '777-300ER', '787-9', 'A319-unknown'];
  const groups = libraryAircraftBusinessGroups(original);
  expect(groups.find(group => group.key === 'A319')?.models).toEqual(['A319-113', 'A319-114']);
  expect(groups.find(group => group.key === 'A320')?.models).toEqual(['A320-214']);
  for (const key of ['747-8', '747-400', '777-300ER', '787-9', 'A319-UNKNOWN']) expect(groups.map(group => group.key)).toContain(key);
  expect(libraryAircraftBusinessGroup('A319-113/114')).toBe('A319');
  expect(libraryAircraftBusinessGroup('A320-32-1496')).toBe('A320-32-1496');
  expect(original[0]).toBe('A319-113');
});
