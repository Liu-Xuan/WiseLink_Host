import { Children, isValidElement, createElement, type ReactNode, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanonicalLibraryFleetCatalog } from '../../shared/library-fleet.interface';
import { buildLibraryHierarchy } from '../../client/src/pages/WorkspaceHomePage/library-classification';
import { matchesLibraryFleet } from '../../client/src/pages/WorkspaceHomePage/library-fleet-classification';
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
    actions.find((button) => Children.toArray(button.props.children).join('') === '787 · 全部子机型')?.props.onClick?.();
    expect(onFilterChange).toHaveBeenLastCalledWith({ normalizedFamily: 'SB', ata: '34', aircraftModel: '', fleetFamily: '787', fleetModel: '' });
  });
  it('distinguishes missing, empty, error and unclassified assets without raw nonfleet buttons', () => {
    const render = (fleet: Parameters<typeof LibraryFleetControls>[0]['fleet']) => renderToStaticMarkup(createElement(LibraryFleetControls, { fleet, filters: {}, disabled: false, onFilterChange: jest.fn() }));
    expect(render({ catalog: { ...catalog, status: 'MISSING', source: null, families: [] }, loading: false, error: null })).toContain('尚无当前有效机队快照');
    expect(render({ catalog: { ...catalog, families: [] }, loading: false, error: null })).toContain('无可分类的在役机型');
    expect(render({ catalog: null, loading: false, error: '服务不可用' })).toContain('机队目录读取失败');
    expect(render({ catalog: { ...catalog, unclassifiedAssetCount: 2 }, loading: false, error: null })).toContain('2 架有效资产缺少完整父子机型字段');
    expect(render({ catalog, loading: false, error: null })).not.toContain('777');
  });
});
