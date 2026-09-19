import { buildSuiteGraphPresentation } from '../../client/src/pages/RelationGraphPage/suite-graph-presentation';
import type { SuiteGraphMatter } from '../../client/src/pages/RelationGraphPage/suite-graph-model';

function matter(groupCount = 4): SuiteGraphMatter {
  const groups = Array.from({ length: groupCount }, (_, groupIndex) => ({
    key: `g${groupIndex}`,
    title: `Group ${groupIndex}`,
    items: [{ id: `item-${groupIndex}`, title: `Item ${groupIndex}` }],
  }));
  return {
    id: 'matter',
    title: 'Matter',
    rootKind: 'matter',
    groups,
    relations: [
      { id: 'r1', source: 'matter', target: 'item-0', type: 'contains', label: 'contains' },
      { id: 'r2', source: 'item-0', target: 'item-1', type: 'links', label: 'links' },
      { id: 'missing', source: 'matter', target: 'does-not-exist', type: 'links', label: 'links' },
    ],
  };
}

describe('buildSuiteGraphPresentation', () => {
  it.each([1, 2, 3, 4, 5, 6])('uses the bounded layout for %i visible groups', (count) => {
    const result = buildSuiteGraphPresentation(matter(count));
    expect(result.groups).toHaveLength(count);
    expect(result.groups.every((group) => Number.isFinite(group.x) && Number.isFinite(group.y))).toBe(true);
  });

  it('honors hidden groups and reports groups past the bounded page', () => {
    const result = buildSuiteGraphPresentation(matter(8), { hiddenGroups: ['g1'], maxGroups: 6 });
    expect(result.groups.map((group) => group.key)).toEqual(['g0', 'g2', 'g3', 'g4', 'g5', 'g6']);
    expect(result.overflow).toMatchObject({ totalGroups: 7, displayedGroups: 6, hasMore: true });
    expect(result.overflow.omittedGroupKeys).toEqual(['g7']);
  });

  it('renders overflow as a more node without dropping the group count', () => {
    const input = matter(1);
    input.groups[0].items = Array.from({ length: 6 }, (_, index) => ({ id: `i${index}`, title: `I${index}` }));
    const result = buildSuiteGraphPresentation(input, { density: 2 });
    expect(result.groups[0]).toMatchObject({ count: 6, visible: 2, overflow: 4 });
    expect(result.elements.some((element) => element.data.id === 'sg:more:g0')).toBe(true);
  });

  it('does not fabricate an edge for a missing endpoint', () => {
    const result = buildSuiteGraphPresentation(matter(), { relationMode: 'individual' });
    expect(result.elements.filter((element) => element.group === 'edges').map((element) => element.data.businessId)).toEqual(['r1', 'r2']);
    expect(result.counts.represented.relationships).toBe(2);
    expect(result.omittedRelationships).toEqual([{ id: 'missing', reason: 'missingEndpoint' }]);
  });

  it('preserves real relation ids when aggregating', () => {
    const result = buildSuiteGraphPresentation(matter(), { relationMode: 'aggregated' });
    const bundles = result.elements.filter((element) => element.group === 'edges' && element.data.viewKind === 'bundle');
    const individual = result.elements.filter((element) => element.group === 'edges' && element.data.viewKind === 'relationship');
    expect(bundles).toHaveLength(2);
    expect(bundles.map((edge) => edge.data.relationshipIds)).toEqual([['r1'], ['r2']]);
    expect(bundles.every((edge) => String(edge.data.id).startsWith('sg:bundle:'))).toBe(true);
    expect(String(bundles[0].data.id)).toContain('["r1"]');
    expect(individual.map((edge) => edge.data.businessId)).toEqual(['r1', 'r2']);
  });

  it('aggregates relations to overflow cards through their displayed group', () => {
    const input = matter(1);
    input.groups[0].items = Array.from({ length: 3 }, (_, index) => ({ id: `i${index}`, title: `I${index}` }));
    input.relations = [{ id: 'overflow-relation', source: 'matter', target: 'i2', type: 'contains', label: 'contains' }];
    const result = buildSuiteGraphPresentation(input, { density: 1, relationMode: 'aggregated' });
    expect(result.counts.shown.cards).toBe(1);
    expect(result.counts.represented.relationships).toBe(1);
    expect(result.elements.find((element) => element.group === 'edges')?.data.relationshipIds).toEqual(['overflow-relation']);
  });

  it('clamps a page after hidden groups remove the requested last page', () => {
    const result = buildSuiteGraphPresentation(matter(8), { page: 1, hiddenGroups: ['g0', 'g1', 'g2'], maxGroups: 6 });
    expect(result.groups.map((group) => group.key)).toEqual(['g3', 'g4', 'g5', 'g6', 'g7']);
    expect(result.counts.page).toEqual({ index: 0, size: 6, count: 5, pageCount: 1 });
  });

  it('rejects ambiguous root, item, group, and relation identities', () => {
    const rootCollision = matter(1);
    rootCollision.groups[0].items[0].id = rootCollision.id;
    expect(() => buildSuiteGraphPresentation(rootCollision)).toThrow('root/item id collision');

    const duplicateItem = matter(2);
    duplicateItem.groups[1].items[0].id = duplicateItem.groups[0].items[0].id;
    expect(() => buildSuiteGraphPresentation(duplicateItem)).toThrow('item id');

    const duplicateGroup = matter(2);
    duplicateGroup.groups[1].key = duplicateGroup.groups[0].key;
    expect(() => buildSuiteGraphPresentation(duplicateGroup)).toThrow('group key');

    const duplicateRelation = matter();
    duplicateRelation.relations.push({ ...duplicateRelation.relations[0], source: 'matter', target: 'item-1' });
    expect(() => buildSuiteGraphPresentation(duplicateRelation)).toThrow('relation id');
  });

  it('isolates display ids from colliding business ids', () => {
    const input = matter(1);
    input.id = 'g0';
    input.groups[0].items = [{ id: 'item:g0', title: 'same display suffix' }];
    const result = buildSuiteGraphPresentation(input);
    const nodeIds = result.elements.filter((element) => element.group === 'nodes').map((element) => String(element.data.id));
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(nodeIds).toContain('sg:hub:g0');
    expect(nodeIds).toContain('sg:item:item:g0');
    expect(result.visibleIds).toEqual(['g0', 'item:g0']);
  });

  it('keeps a display root out of business relation endpoints', () => {
    const input = matter(1);
    input.rootKind = 'display';
    const result = buildSuiteGraphPresentation(input, { relationMode: 'individual' });
    const hub = result.elements.find((element) => element.group === 'nodes' && element.data.viewKind === 'hub');
    expect(hub?.data).not.toHaveProperty('businessId');
    expect(hub?.data.virtual).toBe(true);
    expect(result.elements.filter((element) => element.group === 'edges')).toHaveLength(0);
    expect(result.omittedRelationships.map((item) => item.reason)).toContain('missingEndpoint');
  });

  it('normalizes non-finite and fractional paging options', () => {
    const result = buildSuiteGraphPresentation(matter(8), { page: Number.NaN, maxGroups: 1.5, density: Number.POSITIVE_INFINITY });
    expect(result.counts.page).toMatchObject({ index: 0, size: 1, pageCount: 8 });
    expect(result.groups[0].visible).toBe(1);
    const fallback = buildSuiteGraphPresentation(matter(8), { page: Number.POSITIVE_INFINITY, maxGroups: Number.NaN, density: 1.5 });
    expect(fallback.counts.page).toMatchObject({ index: 0, size: 6, pageCount: 2 });
    expect(fallback.groups[0].visible).toBe(1);
  });
});
