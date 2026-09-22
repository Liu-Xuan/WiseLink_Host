import { act, createElement, createRef, Profiler } from 'react';
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
  let currentZoom = 1;
  let currentPan = { x: 0, y: 0 };
  const nodeFor = (definition?: { group: string; data: Record<string, unknown>; position?: { x: number; y: number } }) => {
    if (!definition) return { length: 0, addClass: jest.fn() };
    return {
      length: 1,
      id: () => String(definition.data.id),
      data: (key?: string, value?: unknown) => {
        if (key === undefined) return definition.data;
        if (value !== undefined) definition.data[key] = value;
        return definition.data[key];
      },
      position: (next?: { x: number; y: number }) => {
        if (next) {
          definition.position ??= { x: 0, y: 0 };
          definition.position.x = next.x;
          definition.position.y = next.y;
        }
        return definition.position ?? { x: 0, y: 0 };
      },
      renderedPosition: () => definition.position ?? { x: 0, y: 0 },
      addClass: jest.fn(),
    };
  };
  const cy = {
    nodes: jest.fn(() => Object.assign(definitions.filter((definition) => definition.group === 'nodes').map(nodeFor), { removeClass: jest.fn() })),
    elements: () => ({
      remove: () => { definitions = []; },
      renderedBoundingBox: () => {
        const positions = definitions
          .filter((definition) => definition.group === 'nodes')
          .map((definition) => definition.position ?? { x: 0, y: 0 });
        const xs = positions.map((position) => position.x * currentZoom + currentPan.x);
        const ys = positions.map((position) => position.y * currentZoom + currentPan.y);
        return {
          x1: Math.min(...xs),
          y1: Math.min(...ys),
          x2: Math.max(...xs),
          y2: Math.max(...ys),
        };
      },
    }),
    add: (next: Array<{ group: string; data: Record<string, unknown>; position?: { x: number; y: number } }>) => {
      definitions = next.map((definition) => ({
        ...definition,
        data: { ...definition.data },
        position: definition.position ? { ...definition.position } : undefined,
      }));
      handlers.get('render')?.();
    },
    layout: () => ({ run: () => handlers.get('render')?.() }),
    fit: jest.fn(),
    resize: jest.fn(),
    on: (event: string, selectorOrHandler: string | ((event?: { target: unknown }) => void), maybeHandler?: (event?: { target: unknown }) => void) => { const handler = typeof selectorOrHandler === 'function' ? selectorOrHandler : maybeHandler!; event.split(' ').forEach((name) => handlers.set(typeof selectorOrHandler === 'function' ? name : `${name} ${selectorOrHandler}`, handler)); },
    trigger: (key: string, event: { target: unknown }) => handlers.get(key)?.(event),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
    getElementById: jest.fn((id: string) => nodeFor(definitions.find((definition) => definition.data.id === id))),
    minZoom: () => 0.16,
    maxZoom: () => 2.4,
    zoom: jest.fn((next?: number | { level: number }) => {
      if (typeof next === 'number') currentZoom = next;
      else if (next) currentZoom = next.level;
      return currentZoom;
    }),
    pan: jest.fn((next?: { x: number; y: number }) => {
      if (next) currentPan = next;
      return currentPan;
    }),
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
    { group: 'nodes', data: { id: 'sg:group:g1', viewKind: 'halo', groupKey: 'g1', title: 'Group', w: 430, h: 130 }, position: { x: 440, y: 200 } },
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

function pointerEvent(type: string, pointerId: number, clientX: number, clientY: number): Event {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: 0 },
    pointerId: { value: pointerId },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return event;
}

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
  let frames: Map<number, FrameRequestCallback>;
  const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(0)); };

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
    frames = new Map();
    let nextFrame = 0;
    dom.window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    dom.window.cancelAnimationFrame = jest.fn((id: number) => { frames.delete(id); });
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

  it('applies declared edge curves, theme tones, and the local graph sheet to Cytoscape', async () => {
    const originalGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: (name: string) => ({
        '--wl-sheet': '#112233',
        '--suite-graph-tone-green': '#55aa88',
        '--suite-graph-edge-label': '#aabbcc',
      })[name] ?? '',
    })) as unknown as typeof getComputedStyle;
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation }));
      });
      await act(async () => { await Promise.resolve(); });
      const options = mockCyFactory.mock.calls[0][0] as {
        style: Array<{ selector: string; style: Record<string, unknown> }>;
      };
      expect(options.style.find((item) => item.selector === 'edge')?.style).toMatchObject({
        'control-point-distances': 'data(curvature)',
        'control-point-weights': 0.5,
        'text-background-color': '#112233',
        color: '#aabbcc',
      });
      expect(options.style.find((item) => item.selector === 'edge[tone = "green"]')?.style).toMatchObject({
        'line-color': '#55aa88',
        'target-arrow-color': '#55aa88',
      });
      expect(options.style.find((item) => item.selector === 'edge[color]')?.style).toMatchObject({
        'line-color': 'data(color)',
      });
    } finally {
      globalThis.getComputedStyle = originalGetComputedStyle;
    }
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

  it('repairs a restored viewport that places the complete graph outside the canvas', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, {
        presentation,
        initialViewport: { zoom: 1.3, pan: { x: 12, y: 3565 } },
      }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as {
      fit: jest.Mock;
      resize: jest.Mock;
    };
    expect(cy.resize).toHaveBeenCalled();
    expect(cy.fit).toHaveBeenCalledWith(undefined, 24);
  });

  it('marks toolbar zoom and reset as user camera so later resizes never fit over them', async () => {
    const ref = createRef<SuiteGraphCanvasHandle>();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation, ref }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as {
      fit: jest.Mock;
      resize: jest.Mock;
      zoom: jest.Mock;
    };
    expect(cy.fit).toHaveBeenCalledTimes(1);
    act(() => ref.current!.zoomBy(1.18));
    expect(cy.zoom).toHaveBeenCalledWith(expect.objectContaining({ level: expect.closeTo(1.18, 5) }));
    act(() => { resizeCallback?.(); });
    expect(cy.fit).toHaveBeenCalledTimes(1);
    act(() => ref.current!.reset());
    expect(cy.fit).toHaveBeenCalledTimes(2);
    expect(cy.resize).toHaveBeenCalled();
    act(() => { resizeCallback?.(); });
    expect(cy.fit).toHaveBeenCalledTimes(2);
  });

  it('enters with the complete graph fitted on narrow layouts', async () => {
    const restoreMatchMedia = mockNarrowLayout();
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation }));
      });
      await act(async () => { await Promise.resolve(); });
      const cy = mockCyFactory.mock.results[0].value as { fit: jest.Mock; zoom: jest.Mock; center: jest.Mock; getElementById: jest.Mock };
      expect(cy.fit).toHaveBeenCalledTimes(1);
      expect(cy.zoom).not.toHaveBeenCalledWith(0.85);
      expect(cy.center).not.toHaveBeenCalled();
      act(() => { resizeCallback?.(); });
      expect(cy.fit).toHaveBeenCalledTimes(2);
    } finally {
      restoreMatchMedia();
    }
  });

  it('focuses an explicitly selected non-hub object on narrow layouts', async () => {
    const restoreMatchMedia = mockNarrowLayout();
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation, selectedId: 'i' }));
      });
      await act(async () => { await Promise.resolve(); });
      const cy = mockCyFactory.mock.results[0].value as {
        fit: jest.Mock;
        zoom: jest.Mock;
        center: jest.Mock;
        getElementById: jest.Mock;
      };
      expect(cy.fit).not.toHaveBeenCalled();
      expect(cy.getElementById).toHaveBeenCalledWith('sg:item:i');
      expect(cy.zoom).toHaveBeenCalledWith(0.85);
      expect(cy.center).toHaveBeenCalled();
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

  it('moves a card by pointer delta, expands its halo, suppresses the drag click, and resets both', async () => {
    const onSelect = jest.fn();
    const ref = createRef<SuiteGraphCanvasHandle>();
    const originalPresentation: SuiteGraphPresentation = structuredClone(groupPresentation);
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation: groupPresentation, onSelect, ref }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as {
      getElementById: (id: string) => { data: (key?: string) => unknown; position: () => { x: number; y: number } };
    };
    const card = container.querySelector('[aria-label="Card A"]') as HTMLButtonElement;
    act(() => card.dispatchEvent(pointerEvent('pointerdown', 7, 120, 100)));
    act(() => window.dispatchEvent(pointerEvent('pointermove', 7, 140, 120)));
    act(() => window.dispatchEvent(pointerEvent('pointermove', 7, 160, 130)));
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 389, y: 230 });
    expect(Number(cy.getElementById('sg:group:g1').data('h'))).toBeGreaterThan(130);
    act(() => window.dispatchEvent(pointerEvent('pointerup', 7, 160, 130)));
    await act(async () => card.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, detail: 1 })));
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => card.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    act(() => ref.current?.reset());
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 349, y: 200 });
    expect(cy.getElementById('sg:group:g1').data('w')).toBe(430);
    expect(cy.getElementById('sg:group:g1').data('h')).toBe(130);
    expect(groupPresentation).toEqual(originalPresentation);
  });

  it('rolls a cancelled drag back, ignores another pointer, and does not swallow the next click', async () => {
    const onSelect = jest.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation: groupPresentation, onSelect }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as {
      getElementById: (id: string) => { position: () => { x: number; y: number } };
    };
    const card = container.querySelector('[aria-label="Card A"]') as HTMLButtonElement;
    act(() => card.dispatchEvent(pointerEvent('pointerdown', 11, 100, 100)));
    act(() => window.dispatchEvent(pointerEvent('pointermove', 12, 180, 160)));
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 349, y: 200 });
    act(() => window.dispatchEvent(pointerEvent('pointermove', 11, 180, 160)));
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 429, y: 260 });
    act(() => window.dispatchEvent(pointerEvent('pointercancel', 11, 180, 160)));
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 349, y: 200 });
    await act(async () => card.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('selects the center object on a true canvas tap and keeps edge taps separate', async () => {
    const onSelect = jest.fn();
    const onInspectRelationships = jest.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation, onSelect, onInspectRelationships }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as {
      trigger: (key: string, event: { target: unknown }) => void;
    };
    act(() => cy.trigger('tap', { target: cy }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'm', viewKind: 'hub' }), false);
    act(() => cy.trigger('tap edge', { target: { data: () => ['relationship-1'] } }));
    expect(onInspectRelationships).toHaveBeenCalledWith(['relationship-1']);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('focuses a real narrow-screen card click only before a restored or manual camera exists', async () => {
    const restoreMatchMedia = mockNarrowLayout();
    try {
      const onViewport = jest.fn();
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation, onViewport }));
      });
      await act(async () => { await Promise.resolve(); });
      const cy = mockCyFactory.mock.results[0].value as { zoom: jest.Mock; center: jest.Mock };
      cy.zoom.mockClear();
      cy.center.mockClear();
      await act(async () => (container.querySelector('[aria-label="Item，Detail"]') as HTMLButtonElement).click());
      expect(cy.zoom).toHaveBeenCalledWith(0.85);
      expect(cy.center).toHaveBeenCalledTimes(1);
      cy.zoom.mockClear();
      cy.center.mockClear();
      await act(async () => (container.querySelector('[aria-label="Item，Detail"]') as HTMLButtonElement).click());
      expect(cy.zoom).not.toHaveBeenCalledWith(0.85);
      expect(cy.center).not.toHaveBeenCalled();
    } finally {
      restoreMatchMedia();
    }
  });

  it('keeps an exact restored camera when a narrow-screen card is clicked', async () => {
    const restoreMatchMedia = mockNarrowLayout();
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, {
          presentation,
          initialViewport: { zoom: 1.4, pan: { x: 24, y: -18 } },
        }));
      });
      await act(async () => { await Promise.resolve(); });
      const cy = mockCyFactory.mock.results[0].value as { zoom: jest.Mock; center: jest.Mock; pan: jest.Mock };
      cy.zoom.mockClear();
      cy.center.mockClear();
      cy.pan.mockClear();
      await act(async () => (container.querySelector('[aria-label="Item，Detail"]') as HTMLButtonElement).click());
      expect(cy.zoom).not.toHaveBeenCalled();
      expect(cy.center).not.toHaveBeenCalled();
      expect(cy.pan).not.toHaveBeenCalled();
    } finally {
      restoreMatchMedia();
    }
  });

  it('rolls back an active drag and removes its listeners when unmounted', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation: groupPresentation }));
    });
    await act(async () => { await Promise.resolve(); });
    const cy = mockCyFactory.mock.results[0].value as {
      getElementById: (id: string) => { position: () => { x: number; y: number } };
    };
    const card = container.querySelector('[aria-label="Card A"]') as HTMLButtonElement;
    act(() => card.dispatchEvent(pointerEvent('pointerdown', 19, 100, 100)));
    act(() => window.dispatchEvent(pointerEvent('pointermove', 19, 150, 140)));
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 399, y: 240 });
    await act(async () => root.unmount());
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 349, y: 200 });
    act(() => window.dispatchEvent(pointerEvent('pointermove', 19, 210, 190)));
    expect(cy.getElementById('sg:item:a').position()).toEqual({ x: 349, y: 200 });
  });
  it('coalesces 100 visual events into one snapshot and suppresses unchanged commits and viewport callbacks', async () => {
    const onViewport = jest.fn();
    const onRender = jest.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(Profiler, { id: 'canvas', onRender }, createElement(SuiteGraphCanvas, { presentation, onViewport })));
    });
    const cy = mockCyFactory.mock.results[0].value as ReturnType<typeof createCy>;
    cy.nodes.mockClear(); onViewport.mockClear(); onRender.mockClear();
    act(() => {
      cy.zoom(1.5); cy.pan({ x: 10, y: 20 });
      for (let index = 0; index < 100; index++) cy.trigger(['render', 'resize', 'pan', 'zoom'][index % 4], { target: cy });
    });
    expect(cy.nodes).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    act(flushFrames);
    expect(cy.nodes).toHaveBeenCalledTimes(1);
    expect(onViewport).toHaveBeenCalledTimes(1);
    expect(onViewport).toHaveBeenLastCalledWith({ zoom: 1.5, pan: { x: 10, y: 20 } });
    expect(container.querySelector('.suite-graph-camera-status')?.textContent).toBe('150%');
    onViewport.mockClear(); onRender.mockClear(); cy.nodes.mockClear();
    act(() => { for (let index = 0; index < 100; index++) cy.trigger('render', { target: cy }); });
    act(flushFrames);
    expect(cy.nodes).toHaveBeenCalledTimes(1);
    expect(onViewport).not.toHaveBeenCalled();
    expect(onRender).not.toHaveBeenCalled();
  });

  it('updates mutated node data and drag positions without rebuilding, and cancels pending work on unmount', async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(SuiteGraphCanvas, { presentation }));
    });
    const cy = mockCyFactory.mock.results[0].value as ReturnType<typeof createCy>;
    const node = cy.getElementById('sg:item:i');
    act(() => {
      if ('data' in node) { node.data('title', 'Updated'); node.position({ x: 150, y: 160 }); }
      cy.trigger('render', { target: cy });
    });
    act(flushFrames);
    const card = container.querySelector('[aria-label="Updated，Detail"]');
    expect(card).toBeTruthy();
    expect((card?.parentElement as HTMLElement).style.left).toBe('150px');
    expect(mockCyFactory).toHaveBeenCalledTimes(1);
    act(() => cy.trigger('pan', { target: cy }));
    const lateFrame = [...frames.values()][0];
    cy.nodes.mockClear();
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    act(() => lateFrame(0));
    expect(cy.nodes).not.toHaveBeenCalled();
    expect(cy.destroy).toHaveBeenCalledTimes(1);
  });

  it('tracks real Cytoscape pan/zoom and node mutations across frames and presentation replacement', async () => {
    const realCytoscape = jest.requireActual<typeof import('cytoscape')>('cytoscape');
    document.documentElement.setAttribute('data-wl-motion', 'off');
    mockCyFactory.mockImplementation((options) => realCytoscape({ ...options, headless: true, styleEnabled: false }));
    const onViewport = jest.fn();
    try {
      await act(async () => {
        root = createRoot(container);
        root.render(createElement(SuiteGraphCanvas, { presentation, onViewport }));
      });
      const cy = mockCyFactory.mock.results[0].value as import('cytoscape').Core;
      onViewport.mockClear();
      act(() => { cy.zoom(1.2); cy.pan({ x: 20, y: 30 }); });
      expect(frames.size).toBe(1);
      act(flushFrames);
      expect(onViewport).toHaveBeenCalledTimes(1);
      expect(onViewport).toHaveBeenCalledWith({ zoom: 1.2, pan: { x: 20, y: 30 } });
      act(() => {
        cy.getElementById('sg:item:i').position({ x: 50, y: 60 }).data('title', 'Real node');
        cy.emit('render');
      });
      act(flushFrames);
      const card = container.querySelector('[aria-label="Real node，Detail"]');
      expect(card).toBeTruthy();
      expect((card?.parentElement as HTMLElement).style.left).toBe('80px');
      expect((card?.parentElement as HTMLElement).style.top).toBe('102px');
      await act(async () => root.render(createElement(SuiteGraphCanvas, { presentation: groupPresentation, onViewport })));
      expect(container.querySelector('[aria-label="Real node，Detail"]')).toBeNull();
      expect(container.querySelector('[aria-label="Card A"]')).toBeTruthy();
      expect(mockCyFactory).toHaveBeenCalledTimes(1);
    } finally {
      document.documentElement.removeAttribute('data-wl-motion');
    }
  });

});
