import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import RelationGraphCanvas from '@client/src/pages/RelationGraphPage/RelationGraphCanvas';

const { JSDOM } = require('jsdom');
const mockCytoscape = jest.fn();
jest.mock('cytoscape', () => ({ __esModule: true, default: (...args: unknown[]) => mockCytoscape(...args) }));
jest.mock('@client/src/pages/RelationGraphPage/relation-graph.css', () => ({}));

let dom: InstanceType<typeof JSDOM>;
let root: Root;
let container: HTMLElement;
const globals = new Map<string, PropertyDescriptor | undefined>();
function canvasDouble() {
  const callbacks = new Map<string, (event: { target: { data: () => unknown } }) => void>();
  const selected = new Map<string, jest.Mock>();
  const styles = { clear: jest.fn(), fromJson: jest.fn(), update: jest.fn() };
  styles.clear.mockReturnValue(styles); styles.fromJson.mockReturnValue(styles);
  return {
    callbacks, selected, styles,
    on: jest.fn((event: string, selector: string, callback: (event: { target: { data: () => unknown } }) => void) => callbacks.set(`${event}:${selector}`, callback)),
    elements: jest.fn(() => ({ remove: jest.fn(), removeClass: jest.fn() })),
    nodes: jest.fn(() => ({ removeClass: jest.fn() })),
    add: jest.fn(), layout: jest.fn(() => ({ run: jest.fn() })), fit: jest.fn(), destroy: jest.fn(),
    style: jest.fn(() => styles),
    $id: jest.fn((id: string) => { if (!selected.has(id)) selected.set(id, jest.fn()); return { addClass: selected.get(id), empty: () => false }; }),
  };
}
let cy: ReturnType<typeof canvasDouble>;
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root'); root = createRoot(container);
  cy = canvasDouble(); mockCytoscape.mockReset().mockReturnValue(cy);
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  globals.clear();
});
const elements = [
  { data: { id: 'N-exact', kind: 'TDMS_NATIVE_RECORD_REVISION', label: 'exact old source' } },
  { data: { id: 'E-exact', source: 'N-exact', target: 'N-other', tdmsAuthority: 'CANDIDATE_ONLY', label: 'unverified' } },
];
it('reuses the fixed real graph canvas without claiming unsupported TDMS styles', async () => {
  await act(async () => root.render(createElement(RelationGraphCanvas, { elements, onNodeOpen: jest.fn() })));
  expect(container.querySelector('.rg-canvas')?.getAttribute('aria-label')).toBe('对象关系图谱');
  const style = mockCytoscape.mock.calls[0][0].style as Array<{ selector: string; style: Record<string, unknown> }>;
  expect(style.find(item => item.selector === 'edge')).toBeDefined();
  expect(style.some(item => item.selector.includes('tdmsAuthority'))).toBe(false);
  expect(style.some(item => item.selector === 'node[kind = "TDMS_UNRESOLVED"]')).toBe(false);
  expect(cy.add).toHaveBeenCalledWith(elements); expect(cy.fit).toHaveBeenCalledWith(undefined, 48);
});
it('routes exact node data to current callbacks and preserves supported node selection', async () => {
  const first = jest.fn(), next = jest.fn();
  await act(async () => root.render(createElement(RelationGraphCanvas, { elements, onNodeOpen: first, selectedNodeId: 'N-exact' })));
  const nodeData = { id: 'N-exact', endpoint: { sourceRevisionRef: 'old' } };
  cy.callbacks.get('tap:node')!({ target: { data: () => nodeData } }); expect(first).toHaveBeenCalledWith(nodeData);
  expect(cy.callbacks.has('tap:edge')).toBe(false);
  expect(cy.selected.get('N-exact')).toHaveBeenCalledWith('sample-highlight');
  await act(async () => root.render(createElement(RelationGraphCanvas, { elements, onNodeOpen: next })));
  cy.callbacks.get('tap:node')!({ target: { data: () => nodeData } }); expect(next).toHaveBeenCalledWith(nodeData);
  expect(first).toHaveBeenCalledTimes(1); expect(mockCytoscape).toHaveBeenCalledTimes(1);
});
it('updates the same canvas on theme changes and destroys its instance on return/unmount', async () => {
  await act(async () => root.render(createElement(RelationGraphCanvas, { elements, onNodeOpen: jest.fn() })));
  await act(async () => { document.documentElement.setAttribute('data-wl-theme', 'light'); await Promise.resolve(); });
  expect(cy.styles.fromJson).toHaveBeenCalled();
  await act(async () => root.unmount()); expect(cy.destroy).toHaveBeenCalledTimes(1);
  root = createRoot(container);
});
