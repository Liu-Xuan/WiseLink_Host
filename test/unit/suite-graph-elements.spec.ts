import cytoscape from 'cytoscape';
import { reconcileSuiteGraphElements } from '../../client/src/pages/RelationGraphPage/suite-graph-elements';
import type { CytoscapeSuiteElement } from '../../client/src/pages/RelationGraphPage/suite-graph-model';

const node = (id: string, x = 0): CytoscapeSuiteElement => ({
  group: 'nodes', data: { id, title: id, w: 100, h: 40 }, position: { x, y: 0 },
});
const edge = (source: string, target: string): CytoscapeSuiteElement => ({ group: 'edges', data: { id: 'edge', source, target } });

describe('incremental graph topology with real Cytoscape', () => {
  it('replaces only changed endpoints, removes obsolete nodes and preserves surviving dragged positions', () => {
    const cy = cytoscape({ headless: true });
    try {
      const before = [node('a'), node('b', 100), edge('a', 'b')];
      reconcileSuiteGraphElements(cy, [], before, () => {});
      const a = cy.$id('a')[0];
      const oldEdge = cy.$id('edge')[0];
      a.position({ x: 20, y: 30 });
      const cleanup = jest.fn();
      const after = [edge('a', 'c'), node('a'), node('c', 200)];
      const update = reconcileSuiteGraphElements(cy, before, after, cleanup);
      expect(update.layoutRequired).toBe(true);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cy.$id('a')[0]).toBe(a);
      expect(cy.$id('b').length).toBe(0);
      expect(cy.$id('edge')[0]).not.toBe(oldEdge);
      expect(cy.$id('edge').target().id()).toBe('c');
      expect(update.positions).toEqual({ a: { x: 20, y: 30 }, c: { x: 200, y: 0 } });
    } finally { cy.destroy(); }
  });

  it('patches declared data and classes while retaining interaction state and runtime halo dimensions', () => {
    const cy = cytoscape({ headless: true });
    try {
      const before = [{ ...node('a'), classes: 'old', data: { id: 'a', title: 'old', subtitle: 'remove me', w: 100, h: 40 } }];
      reconcileSuiteGraphElements(cy, [], before, () => {});
      cy.$id('a').addClass('interaction').data('w', 300);
      const after = [{ ...node('a'), classes: 'new', grabbable: false, selectable: false }];
      const cleanup = jest.fn();
      const update = reconcileSuiteGraphElements(cy, before, after, cleanup);
      expect(update.layoutRequired).toBe(false);
      expect(cleanup).not.toHaveBeenCalled();
      expect(cy.$id('a').data('subtitle')).toBeUndefined();
      expect(cy.$id('a').data('title')).toBe('a');
      expect(cy.$id('a').data('w')).toBe(300);
      expect(cy.$id('a').hasClass('interaction')).toBe(true);
      expect(cy.$id('a').hasClass('old')).toBe(false);
      expect(cy.$id('a').hasClass('new')).toBe(true);
      expect(cy.$id('a').grabbable()).toBe(false);
      expect(cy.$id('a').selectable()).toBe(false);
    } finally { cy.destroy(); }
  });

  it('honors an explicitly changed declared layout and sizes', () => {
    const cy = cytoscape({ headless: true });
    try {
      const before = [node('a')];
      reconcileSuiteGraphElements(cy, [], before, () => {});
      cy.$id('a').position({ x: 20, y: 30 });
      const after = [node('a', 500)];
      expect(reconcileSuiteGraphElements(cy, before, after, () => {}).positions.a).toEqual({ x: 500, y: 0 });
      const resized = [{ ...node('a', 500), data: { id: 'a', w: 150, h: 40 } }];
      expect(reconcileSuiteGraphElements(cy, after, resized, () => {}).layoutRequired).toBe(true);
      expect(cy.$id('a').data('w')).toBe(150);
    } finally { cy.destroy(); }
  });
});
