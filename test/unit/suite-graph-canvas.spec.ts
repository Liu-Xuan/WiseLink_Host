import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SuiteGraphCanvas, { type SuiteGraphCanvasHandle } from '../../client/src/pages/RelationGraphPage/SuiteGraphCanvas';
import type { SuiteGraphPresentation } from '../../client/src/pages/RelationGraphPage/suite-graph-model';

var mockCyFactory = jest.fn();
jest.mock('cytoscape', () => ({ __esModule: true, default: (...args: unknown[]) => mockCyFactory(...args) }));
jest.mock('../../client/src/pages/RelationGraphPage/suite-graph-canvas.css', () => ({}));
jest.mock('../../client/src/components/ui/image', () => ({ __esModule: true, Image: () => null, default: () => null }));

function createCy() {
  const handlers = new Map<string, (event?: { target: unknown }) => void>();
  let definitions: Array<{ group: string; data: Record<string, unknown>; position?: { x: number; y: number } }> = [];
  const cy = {
    nodes: () => Object.assign(definitions.filter((definition) => definition.group === 'nodes').map((definition) => ({
      id: () => String(definition.data.id),
      data: (key?: string) => (key === undefined ? definition.data : definition.data[key]),
      renderedPosition: () => definition.position ?? { x: 0, y: 0 },
      addClass: jest.fn(),
    })), { removeClass: jest.fn() }),
    elements: () => ({ remove: () => { definitions = []; } }),
    add: (next: Array<{ group: string; data: Record<string, unknown>; position?: { x: number; y: number } }>) => { definitions = next; handlers.get('render')?.(); },
    layout: () => ({ run: () => handlers.get('render')?.() }),
    fit: jest.fn(),
    resize: jest.fn(),
    on: (event: string, selectorOrHandler: string | ((event?: { target: unknown }) => void), maybeHandler?: (event?: { target: unknown }) => void) => { const handler = typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler!; event.split(' ').forEach((name) => handlers.set(typeof selectorOrHandler === 'function' ? name : `${name} ${selectorOrHandler}`, handler)); },
    trigger: (key: string, event: { target: unknown }) => handlers.get(key)?.(event),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
    getElementById: jest.fn(() => ({ length: 1, addClass: jest.fn() })),
    minZoom: () => 0.16,
    maxZoom: () => 2.4,
    zoom: jest.fn(() => 1),
    pan: jest.fn(() => ({ x: 0, y: 0 })),
    width: () => 800,
    height: () => 600,
    center: jest.fn(),
  };
  return cy;
}

const presentation: SuiteGraphPresentation = {
  elements: [
    { group: 'nodes', data: { id: 'sg:hub:m', viewKind: 'hub', businessId: 'm', title: 'Matter', w: 180, h: 180 }, position: { x: 200, y: 180 } },
    { group: 'nodes', data: { id: 'sg:item:i', viewKind: 'item', businessId: 'i', title: 'Item', subtitle: 'Detail', w: 120, h: 48 }, position: { x: 80, y: 100 } },
    { group: 'nodes', data: { id: 'sg:more:g', viewKind: 'more', groupKey: 'g', count: 2, w: 120, h: 32 }, position: { x: 320, y: 100 } },
  ],
  groups: [],
  visibleIds: ['m', 'i'],
  visibleItemIds: ['i'],
  overflow: { page: 0, pageSize: 6, totalGroups: 1, displayedGroups: 1, omittedGroupKeys: [], hasMore: false },
  counts: { loaded: { groups: 1, items: 1, relationships: 0 }, eligible: { groups: 1, items: 1 }, page: { index: 0, size: 6, count: 1, pageCount: 1 }, shown: { groups: 1, items: 1, cards: 1 }, represented: { relationships: 0 } },
  omittedRelationships: [],
  bounds: { x1: 0, y1: 0, x2: 400, y2: 400, w: 400, h: 400 },
};

const groupPresentation: SuiteGraphPresentation = {
  elements: [
    { group: 'nodes', data: { id: 'sg:hub:m', viewKind: 'hub', businessId: 'm', title: 'Matter', w: 180, h: 180 }, position: { x: 100, y: 100 } },
    { group: 'nodes', data: { id: 'sg:item:a', viewKind: 'item', businessId: 'a', groupKey: 'g1', title: 'Card A', w: 183.6, h: 48 }, position: { x: 349, y: 200 } },
    { group: 'nodes', data: { id: 'sg:item:b', viewKind: 'item', businessId: 'b', groupKey: 'g1', title: 'Card B', w: 183.6, h: 48 }, position: { x: 532.6, y: 200 } },
  ],
  groups: [],
  visibleIds: ['m', 'a', 'b'],
  visibleItemIds: ['a', 'b'],
  overflow: { page: 0, pageSize: 6, totalGroups: 1, displayedGroups: 1, omittedGroupKeys: [], hasMore: false },
  counts: { loaded: { groups: 1, items: 2, relationships: 0 }, eligible: { groups: 1, items: 2 }, page: { index: 0, size: 6, count: 1, pageCount: 1 }, shown: { groups: 1, items: 2, cards: 2 }, represented: { relationships: 0 } },
  omittedRelationships: [],
  bounds: { x1: 0, y1: 0, x2: 600, y2: 400, w: 600, h: 400 },
};

function mockNarrowLayout(): () => void {
  const original = dom.window.matchMedia;
  dom.window.matchMedia = (() => ({ matches: true, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof dom.window.matchMedia;
  return () => { dom.window.matchMedia = original; };
}

const { JSDOM } = require('jsdom');
let dom: { window: Window & typeof globalThis };
let resizeCallback: (() => void) | null = null;

describe('SuiteGraphCanvas', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
    dom.window.matchMedia = (() => ({ matches: false, media: '', onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as typeof dom.window.matchMedia;
  });

  afterAll(() => dom.window.close());

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    resizeCallback = null;
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { constructor(callback: () => void) { resizeCallback = callback; } observe() {} disconnect() {} };
    mockCyFactory.mockReturnValue(createCy());
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    mockCyFactory.mockReset();
  });

  it('renders HTML cards, routes selection and overflow callbacks, and destroys Cytoscape', async () => {
    const onSelect = jest.fn();
    const onOverflow = jest.fn();
    const onInspectRelationships = jest.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation, onSelect, onOverflow, onInspectRelationships }));
    });
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[aria-label="Item，Detail"]')).toBeTruthy();
    await act(async () => (container.querySelector('[aria-label="Item，Detail"]') as HTMLButtonElement).click());
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'i' }), false);
    await act(async () => (container.querySelector('[aria-label="展开全部，2 项"]') as HTMLButtonElement).click());
    expect(onOverflow).toHaveBeenCalledWith('g');
    const cyInstance = mockCyFactory.mock.results[0].value as { trigger: (key: string, event: { target: unknown }) => void };
    await act(async () => cyInstance.trigger('tap edge', { target: { data: () => ['premise-1', 'premise-2'] } }));
    expect(onInspectRelationships).toHaveBeenCalledWith(['premise-1', 'premise-2']);
    const cy = mockCyFactory.mock.results[0].value as { destroy: jest.Mock };
    await act(async () => root.unmount());
    expect(cy.destroy).toHaveBeenCalledTimes(1);
  });

  it('keeps a restored initial viewport and never fits over it, including the first resize', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation, initialViewport: { zoom: 1.5, pan: { x: 12, y: -8 } } }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as { fit: jest.Mock; zoom: jest.Mock; pan: jest.Mock };
    expect(cy.zoom).toHaveBeenCalledWith(1.5);
    expect(cy.pan).toHaveBeenCalledWith({ x: 12, y: -8 });
    expect(cy.fit).not.toHaveBeenCalled();
    act(() => { resizeCallback?.(); });
    expect(cy.fit).not.toHaveBeenCalled();
  });

  it('marks toolbar zoom and reset as user camera so later resizes never fit over them', async () => {
    const ref = createRef<SuiteGraphCanvasHandle>();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation, ref }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as { fit: jest.Mock; zoom: jest.Mock };
    expect(cy.fit).toHaveBeenCalledTimes(1);
    act(() => ref.current!.zoomBy(1.18));
    expect(cy.zoom).toHaveBeenCalledWith(expect.objectContaining({ level: expect.closeTo(1.18, 5) }));
    act(() => { resizeCallback?.(); });
    expect(cy.fit).toHaveBeenCalledTimes(1);
    act(() => ref.current!.reset());
    expect(cy.fit).toHaveBeenCalledTimes(2);
    act(() => { resizeCallback?.(); });
    expect(cy.fit).toHaveBeenCalledTimes(2);
  });

  it('enters with a readable zoom centered on the matter hub on narrow layouts instead of fitting everything', async () => {
    const restoreMatchMedia = mockNarrowLayout();
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation }));
      });
      await act(async () => { await Promise.resolve(); });
      const cy = mockCyFactory.mock.results[0].value as { fit: jest.Mock; zoom: jest.Mock; center: jest.Mock; getElementById: jest.Mock };
      expect(cy.fit).not.toHaveBeenCalled();
      expect(cy.zoom).toHaveBeenCalledWith(0.85);
      expect(cy.getElementById).toHaveBeenCalledWith('sg:hub:m');
      expect(cy.center).toHaveBeenCalled();
      act(() => { resizeCallback?.(); });
      expect(cy.fit).not.toHaveBeenCalled();
    } finally {
      restoreMatchMedia();
    }
  });

  it('focuses the filtered group target cards into a readable view on narrow layouts instead of only the hub', async () => {
    const restoreMatchMedia = mockNarrowLayout();
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation: groupPresentation, focusGroupKey: 'g1' }));
      });
      await act(async () => { await Promise.resolve(); });
      const cy = mockCyFactory.mock.results[0].value as { fit: jest.Mock; center: jest.Mock };
      expect(cy.fit).toHaveBeenCalledTimes(1);
      const [fitCollection, fitPadding] = cy.fit.mock.calls[0] as [unknown[], number];
      expect(fitCollection.length).toBe(3);
      expect(fitPadding).toBe(28);
      expect(cy.center).not.toHaveBeenCalled();
    } finally {
      restoreMatchMedia();
    }
  });

  it('fits only without a restored viewport and stops fitting once a user camera exists', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as { fit: jest.Mock };
    expect(cy.fit).toHaveBeenCalledTimes(1);
    act(() => { resizeCallback?.(); });
    expect(cy.fit).toHaveBeenCalledTimes(2);
    const surface = container.querySelector('.suite-graph-cy') as HTMLElement;
    act(() => { surface.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })); });
    act(() => { resizeCallback?.(); });
    expect(cy.fit).toHaveBeenCalledTimes(2);
  });
});
