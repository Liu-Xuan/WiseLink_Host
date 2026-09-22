import cytoscape from 'cytoscape';
import { activateGraphLayoutSession, captureGraphLayout, readGraphLayout, restoreGraphLayout, saveGraphLayout, type SuiteGraphLayoutSnapshot } from '../../client/src/pages/RelationGraphPage/suite-graph-layout-memory';
import { reconcileSuiteGraphElements } from '../../client/src/pages/RelationGraphPage/suite-graph-elements';
import type { CytoscapeSuiteElement } from '../../client/src/pages/RelationGraphPage/suite-graph-model';
const snapshot: SuiteGraphLayoutSnapshot = { nodes: [{ id: 'a', base: { x: 1, y: 2 }, position: { x: 50, y: 60 }, baseW: 100, baseH: 40, w: 100, h: 40 }] };
beforeEach(() => activateGraphLayoutSession(1, true));

test('isolates exact scope and session, copies inputs and expires after 30 minutes', () => {
 const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
 try {
  const source = JSON.parse(JSON.stringify(snapshot));
  const key = saveGraphLayout('session1/matter/work1/perspective1', source)!;
  source.nodes[0].position.x = 999;
  expect(readGraphLayout(key, 'session1/matter/work1/perspective1')!.nodes[0].position.x).toBe(50);
  expect(readGraphLayout(key, 'session1/matter/work2/perspective1')).toBeUndefined();
  expect(readGraphLayout(key, 'session1/matter/work1/perspective2')).toBeUndefined();
  clock.mockReturnValue(1000 + 30 * 60 * 1000);
  expect(readGraphLayout(key, 'session1/matter/work1/perspective1')).toBeUndefined();
  const next = saveGraphLayout('scope', snapshot)!;
  activateGraphLayoutSession(2, false);
  expect(readGraphLayout(next, 'scope')).toBeUndefined();
  const denied = saveGraphLayout('scope', snapshot)!;
  activateGraphLayoutSession(2, true);
  expect(readGraphLayout(denied, 'scope')).toBeUndefined();
 } finally { clock.mockRestore(); }
});

test('bounds entry count and rejects excessive or non-finite geometry', () => {
 const first = saveGraphLayout('scope', snapshot)!;
 for (let i = 0; i < 8; i++) saveGraphLayout(`scope-${i}`, snapshot);
 expect(readGraphLayout(first, 'scope')).toBeUndefined();
 expect(saveGraphLayout('scope', { nodes: Array(513).fill(snapshot.nodes[0]) })).toBeUndefined();
 expect(saveGraphLayout('scope', { nodes: [{ ...snapshot.nodes[0], position: { x: Infinity, y: 0 } }] })).toBeUndefined();
 const key = saveGraphLayout('stable', snapshot)!;
 expect(saveGraphLayout('stable', snapshot, key)).toBe(key);
 expect(saveGraphLayout('different', snapshot, key)).not.toBe(key);
 const changed = { nodes: [{ ...snapshot.nodes[0], position: { x: 20, y: 30 } }] };
 expect(saveGraphLayout('stable', changed, key)).not.toBe(key);
 expect(readGraphLayout(key, 'stable')!.nodes[0].position).toEqual({ x: 50, y: 60 });
});

test('restores only freshly authorized compatible nodes, including nodes arriving after the hub', () => {
 const cy = cytoscape({ headless: true });
 const elements: CytoscapeSuiteElement[] = [{ group: 'nodes', data: { id: 'a', w: 100, h: 40 }, position: { x: 1, y: 2 } }];
 try {
  const hub: CytoscapeSuiteElement[] = [{ group: 'nodes', data: { id: 'hub', w: 80, h: 80 }, position: { x: 0, y: 0 } }];
  reconcileSuiteGraphElements(cy, [], hub, () => {});
  restoreGraphLayout(cy, hub, [], snapshot);
  reconcileSuiteGraphElements(cy, hub, [...hub, ...elements], () => {});
  restoreGraphLayout(cy, [...hub, ...elements], hub, snapshot);
  expect(cy.$id('a').position()).toEqual({ x: 50, y: 60 });
  const captured = captureGraphLayout(cy, elements);
  captured.nodes[0].position.x = 999;
  expect(cy.$id('a').position().x).toBe(50);
  cy.$id('a').position({ x: 70, y: 80 });
  restoreGraphLayout(cy, elements, elements, snapshot);
  expect(cy.$id('a').position()).toEqual({ x: 70, y: 80 });
  const different = [{ ...elements[0], position: { x: 3, y: 4 } }] as CytoscapeSuiteElement[];
  expect(restoreGraphLayout(cy, different, [], snapshot)).toEqual({});
  expect(cy.$id('missing').length).toBe(0);
  expect(captureGraphLayout(cy, []).nodes).toEqual([]);
 } finally { cy.destroy(); }
});

test('enforces byte budgets as well as entry count', () => {
 const large = { nodes: Array.from({ length: 100 }, (_, i) => ({ ...snapshot.nodes[0], id: `${i}-` + 'x'.repeat(1900) })) };
 const first = saveGraphLayout('bytes-first', large)!;
 expect(first).toBeDefined();
 for (let i=0;i<5;i++) expect(saveGraphLayout(`bytes-${i}`, large)).toBeDefined();
 expect(readGraphLayout(first, 'bytes-first')).toBeUndefined();
 expect(saveGraphLayout('oversize', { nodes: [...large.nodes, ...large.nodes] })).toBeUndefined();
});
