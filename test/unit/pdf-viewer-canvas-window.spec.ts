import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { transformSync } from 'esbuild';
const { JSDOM } = require('jsdom');
jest.setTimeout(60000);
jest.mock('@lark-apaas/client-toolkit', () => ({ getCsrfToken: () => null }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => 0,
  subscribeCanonicalHostClientSession: () => () => undefined,
}));

interface RenderRecord {
  page: number;
  canvas: HTMLCanvasElement;
  cancel: jest.Mock;
  finish: () => void;
  fail: (error: Error) => void;
  promise: Promise<void>;
}
let panelActive = true;
let autoFinish = true;
let mobile = false;
let width = 400;
let pageCount = 200;
let renders: RenderRecord[] = [];
let delayedPage: number | null = null;
let resolvePage: (() => void) | null = null;
const pageSizes = new Map<number, [number, number]>([[2, [792, 612]], [3, [612, 1100]]]);
const cleanups = new Map<number, jest.Mock>();
const destroy = jest.fn(async () => undefined);
const getPage = jest.fn(async (page: number) => {
  if (delayedPage === page) await new Promise<void>(resolve => { resolvePage = resolve; });
  const cleanup = jest.fn(); cleanups.set(page, cleanup);
  const [baseWidth, baseHeight] = pageSizes.get(page) ?? [612, 792];
  return {
    cleanup,
    getViewport: ({ scale }: { scale: number }) => ({ width: baseWidth * scale, height: baseHeight * scale }),
    render: ({ canvasContext }: { canvasContext: { canvas: HTMLCanvasElement } }) => {
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const promise = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
      const record: RenderRecord = { page, canvas: canvasContext.canvas, cancel: jest.fn(), finish, fail, promise };
      renders.push(record);
      if (autoFinish) finish();
      return record;
    },
  };
});
const getDocument = jest.fn(() => ({ promise: Promise.resolve({ numPages: pageCount, getPage }), destroy }));
const viewerFile = resolve(__dirname, '../../client/src/pages/DocumentParsingPage/PdfDocumentViewer.tsx');
const compiled = transformSync(readFileSync(viewerFile, 'utf8'), {
  loader: 'tsx', format: 'cjs', jsx: 'automatic',
  define: { 'import.meta.url': JSON.stringify('http://localhost/PdfDocumentViewer.tsx') },
}).code;
const moduleObject = { exports: {} as { default: (props: any) => any } };
new Function('require', 'module', 'exports', compiled)((name: string) => {
  if (name.endsWith('?worker&url')) return 'http://localhost/pdf.worker.mjs';
  if (name === './pdfjs-runtime') return { loadPdfJsRuntime: async () => ({ getDocument }) };
  if (name === '@client/src/api/canonical-host') return {
    canonicalPdfPreviewUrl: () => '/unused', getCanonicalHostClientSessionGeneration: () => 0,
  };
  if (name.endsWith('RetainedWorkbenchPanel')) return { useWorkbenchPanelActive: () => panelActive };
  if (name.startsWith('./')) return require(resolve(viewerFile, '..', name));
  return require(name);
}, moduleObject, moduleObject.exports);
const Viewer = moduleObject.exports.default;

describe('actual PDF viewer bounded canvas lifecycle (deterministic geometry and PDF engine)', () => {
  let dom: any; let root: Root; let host: HTMLElement;
  let frames: Map<number, FrameRequestCallback>;
  let offsetCache: Map<Element, number> | null;
  let mutations: MutationObserver;
  let mediaListeners: Set<() => void>;
  let originals: Map<string, PropertyDescriptor | undefined>;
  let resizeObservers: Set<{ callback: () => void; targets: Set<Element> }>;
  let intersectionObservers: Set<{ callback: (entries: unknown[]) => void; targets: Set<Element>; states: Map<Element, boolean> }>;
  const boxes = { boxes: [[10, 20, 30, 40]], viewportWidth: 306, viewportHeight: 396 };
  const container = () => host.querySelector('.parse-pdf-pages') as HTMLElement;
  const pageElement = (page: number) => host.querySelector(`[data-pdf-page="${page}"]`) as HTMLElement;
  const canvas = (page: number) => pageElement(page).querySelector('canvas')!;
  const retained = () => [...host.querySelectorAll('canvas')].filter(element => element.width > 0 && element.height > 0);
  function pageHeight(element: Element): number {
    const style = element.querySelector('canvas')?.style;
    return Math.max(mobile ? 320 : 280, style?.height ? Number.parseFloat(style.height) + 10 : (width + 2) * 11 / 8.5);
  }
  function offset(element: Element): number {
    if (!offsetCache) {
      offsetCache = new Map();
      let top = 6;
      for (const page of container().children) {
        offsetCache.set(page, top);
        top += pageHeight(page) + 8;
      }
    }
    return offsetCache.get(element) ?? 6;
  }

  function flushFrames(): void {
    offsetCache = null;
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
  }
  function intersections(): void {
    offsetCache = null;
    for (const observer of intersectionObservers) {
      const entries: unknown[] = [];
      for (const target of observer.targets) {
        const rect = target.getBoundingClientRect();
        const isIntersecting = rect.bottom >= 100 - 900 && rect.top <= 860 + 900;
        if (observer.states.get(target) !== isIntersecting) entries.push({ target, isIntersecting });
        observer.states.set(target, isIntersecting);
      }
      if (entries.length) observer.callback(entries);
    }
  }
  async function settle(): Promise<void> {
    for (let step = 0; step < 3; step++) await act(async () => { flushFrames(); intersections(); });
  }
  async function mount(targetPage = 1, targetSignal = 'source-1', sourceUrl = 'blob:fixture', readingScope?: string): Promise<void> {
    await act(async () => { root.render(createElement(Viewer, { sourceUrl, targetPage, targetSignal, targetBoxes: boxes, readingScope })); });
    await settle();
  }
  async function scrollToPage(page: number, within = 0): Promise<void> {
    await act(async () => {
      container().dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true }));
      offsetCache = null;
      container().scrollTo({ top: offset(pageElement(page)) + within });
      flushFrames(); intersections();
    });
    await settle();
  }
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    originals = new Map(); offsetCache = null; mediaListeners = new Set(); frames = new Map(); resizeObservers = new Set(); intersectionObservers = new Set();
    panelActive = true; autoFinish = true; mobile = false; width = 400; pageCount = 200; renders = [];
    pageSizes.set(2, [792, 612]);
    delayedPage = null; resolvePage = null; cleanups.clear(); destroy.mockClear(); getPage.mockClear(); getDocument.mockClear();
    let frameId = 0;
    class ResizeObserverMock {
      targets = new Set<Element>();
      constructor(public callback: () => void) { resizeObservers.add(this); }
      observe(target: Element) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    }
    class IntersectionObserverMock {
      targets = new Set<Element>();
      states = new Map<Element, boolean>();
      constructor(public callback: (entries: unknown[]) => void) { intersectionObservers.add(this); }
      observe(target: Element) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    }
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, ResizeObserver: ResizeObserverMock,
      IntersectionObserver: IntersectionObserverMock, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    dom.window.matchMedia = () => ({ get matches() { return mobile; },
      addEventListener(_type: string, listener: () => void) { mediaListeners.add(listener); },
      removeEventListener(_type: string, listener: () => void) { mediaListeners.delete(listener); },
    });
    dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; };
    dom.window.cancelAnimationFrame = (id: number) => frames.delete(id);
    dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get() { return width; } });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get() { return this.classList.contains('parse-pdf-pages') ? 760 : 0; } });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', { get() {
      return [...this.querySelectorAll('[data-pdf-page]')].reduce((sum: number, page: Element) => sum + pageHeight(page) + 8, 6)
        + (Number.parseFloat(this.style.paddingBottom) || 6);
    } });
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const isPage = this.hasAttribute('data-pdf-page');
      const height = isPage ? pageHeight(this) : 760;
      const top = isPage ? 100 + offset(this) - container().scrollTop : 100;
      return { top, bottom: top + height, left: 0, right: width, width, height, x: 0, y: top, toJSON() {} };
    };
    dom.window.HTMLElement.prototype.scrollTo = function ({ top }: { top: number }) {
      this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
      this.dispatchEvent(new dom.window.Event('scroll'));
    };
    host = document.getElementById('root')!; root = createRoot(host);
    mutations = new dom.window.MutationObserver(() => { offsetCache = null; });
    mutations.observe(host, { subtree: true, childList: true, attributes: true });
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); resolvePage?.(); renders.forEach(record => record.finish()); });
    mutations.disconnect();
    dom.window.close();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
  });

  it.each([true, false])('bounds retained backing pixels through a 200-page traversal, IntersectionObserver=%s', async (withObserver) => {
    if (!withObserver) Object.defineProperty(globalThis, 'IntersectionObserver', { value: undefined, configurable: true });
    await mount();
    const initialGeometry = { width: canvas(1).style.width, height: canvas(1).style.height };
    const maximumPages = Math.ceil((760 + 2 * 900) / 280) + 3;
    for (let page = 10; page <= 190; page += 10) {
      await scrollToPage(page);
      expect(retained().length).toBeLessThanOrEqual(maximumPages);
      expect(canvas(page).width).toBeGreaterThan(0);
    }
    expect(host.querySelectorAll('[data-pdf-page]')).toHaveLength(200);
    expect(canvas(1).width).toBe(0);
    expect(canvas(1).height).toBe(0);
    expect({ width: canvas(1).style.width, height: canvas(1).style.height }).toEqual(initialGeometry);
    expect(pageElement(1).classList.contains('is-source-target')).toBe(true);
    expect(pageElement(1).querySelectorAll('.parse-pdf-source-box')).toHaveLength(1);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps visible neighbors rendered when a same-page or nearby jump produces no intersection transition', async () => {
    pageCount = 3; await mount();
    expect(retained()).toHaveLength(3);
    await act(async () => {
      const input = host.querySelector('input')!;
      input.dispatchEvent(new dom.window.FocusEvent('focusout', { bubbles: true }));
    });
    expect(retained()).toHaveLength(3);
    await act(async () => { (host.querySelector('[aria-label="下一页"]') as HTMLButtonElement).click(); });
    expect(retained()).toHaveLength(3);
  });

  it('keeps mixed-page geometry and exact target boxes after eviction, zoom and width changes', async () => {
    await mount(2, 'landscape');
    const before = canvas(2).style.height;
    const beforeBox = pageElement(2).querySelector('.parse-pdf-source-box') as HTMLElement;
    const initialLeft = Number.parseFloat(beforeBox.style.left);
    expect(initialLeft).toBeCloseTo(9 + 10 * 382 / 306);
    await scrollToPage(40);
    expect(canvas(2).width).toBe(0);
    expect(canvas(2).style.height).toBe(before);
    await act(async () => { (host.querySelector('[aria-label="放大 PDF"]') as HTMLButtonElement).click(); });
    expect(canvas(2).style.height).toBe(`${Math.floor(612 * 382 / 792 * 1.25)}px`);
    await act(async () => { width = 500; resizeObservers.forEach(observer => { if (observer.targets.size) observer.callback(); }); flushFrames(); });
    expect(canvas(2).style.height).toBe(`${Math.floor(612 * 482 / 792 * 1.25)}px`);
    const box = pageElement(2).querySelector('.parse-pdf-source-box') as HTMLElement;
    expect(Number.parseFloat(box.style.left)).toBeCloseTo(10 * 482 * 1.25 / 306);
    expect(Number.parseFloat(box.style.top)).toBeCloseTo(4 + 20 * 482 / 792 * 1.25 * 612 / 396);
    expect(canvas(2).width).toBe(0);
    await scrollToPage(2);
    expect(canvas(2).width).toBe(Math.floor(482 * 1.25));
  });

  it('cancels an evicted render and waits for its late completion before reusing its canvas', async () => {
    autoFinish = false; await mount();
    const first = renders.find(record => record.page === 1)!;
    expect(first).toBeDefined();
    await scrollToPage(40);
    expect(first.cancel).toHaveBeenCalled();
    expect(canvas(1).width).toBe(0);
    await scrollToPage(1);
    expect(renders.filter(record => record.page === 1)).toHaveLength(1);
    await act(async () => first.finish());
    expect(renders.filter(record => record.page === 1)).toHaveLength(2);
    expect(canvas(1).width).toBeGreaterThan(0);
    await scrollToPage(40);
    await act(async () => renders.filter(record => record.page === 1).forEach(record => record.finish()));
    expect(canvas(1).width).toBe(0);
    expect(canvas(1).height).toBe(0);
  });

  it('does not start rendering a late page acquisition after eviction', async () => {
    delayedPage = 1; await mount();
    await scrollToPage(40);
    await act(async () => resolvePage?.());
    expect(renders.some(record => record.page === 1)).toBe(false);
    expect(canvas(1).width).toBe(0);
    expect(cleanups.get(1)).toHaveBeenCalled();
  });

  it('releases hidden canvas backing, keeps scroll/zoom, and resumes without reopening the document', async () => {
    await mount(); await scrollToPage(40, 80);
    const top = container().scrollTop;
    panelActive = false; await mount();
    expect(retained()).toHaveLength(0);
    expect([...resizeObservers].every(observer => observer.targets.size === 0)).toBe(true);
    expect([...intersectionObservers].every(observer => observer.targets.size === 0)).toBe(true);
    expect(frames.size).toBe(0);
    panelActive = true; await mount();
    expect(container().scrollTop).toBe(top);
    expect(canvas(40).width).toBeGreaterThan(0);
    expect(getDocument).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it('reconciles fallback retention when a later page resolves tall without scrolling', async () => {
    Object.defineProperty(globalThis, 'IntersectionObserver', { value: undefined, configurable: true });
    pageCount = 10; delayedPage = 2; pageSizes.set(2, [612, 4000]);
    await mount();
    expect(canvas(3).width).toBeGreaterThan(0);
    await act(async () => resolvePage?.());
    await act(async () => {
      for (const observer of resizeObservers) if (observer.targets.has(pageElement(2))) observer.callback();
      flushFrames();
    });
    expect(canvas(3).width).toBe(0);
    expect(canvas(2).width).toBeGreaterThan(0);
    expect(retained()).toHaveLength(2);
  });

  it('starts one successor after a cancellation rejection and does not show a render error', async () => {
    autoFinish = false; await mount();
    const first = renders.find(record => record.page === 1)!;
    await scrollToPage(40); await scrollToPage(1);
    await act(async () => {
      const error = new Error('Rendering cancelled'); error.name = 'RenderingCancelledException';
      first.fail(error);
    });
    expect(renders.filter(record => record.page === 1)).toHaveLength(2);
    expect(canvas(1).width).toBeGreaterThan(0);
    expect(host.querySelector('.parse-pdf-page-error')).toBeNull();
  });

  it('prevents late old-document acquisition and render from repopulating replaced canvases', async () => {
    autoFinish = false; delayedPage = 2; await mount();
    const oldAcquisition = resolvePage!;
    const oldRender = renders.find(record => record.page === 1)!;
    const oldCanvas = canvas(1);
    delayedPage = null; autoFinish = true;
    await mount(50, 'new-source', 'blob:new-document');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(oldRender.cancel).toHaveBeenCalled();
    await act(async () => { oldAcquisition(); oldRender.finish(); });
    expect(oldCanvas.width).toBe(0);
    expect(oldCanvas.height).toBe(0);
    expect(oldCanvas.isConnected).toBe(false);
    expect(canvas(50).width).toBeGreaterThan(0);
    expect(pageElement(50).classList.contains('is-source-target')).toBe(true);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('50');
    expect(getDocument).toHaveBeenCalledTimes(2);
  });

  it('changes desktop/mobile page sets without reopening the PDF or retaining removed canvases', async () => {
    await mount(40, 'breakpoint');
    const removedCanvas = canvas(1);
    await act(async () => { mobile = true; mediaListeners.forEach(listener => listener()); });
    await settle();
    expect(host.querySelectorAll('[data-pdf-page]')).toHaveLength(1);
    expect(canvas(40).width).toBeGreaterThan(0);
    expect(removedCanvas.width).toBe(0);
    await act(async () => { mobile = false; mediaListeners.forEach(listener => listener()); });
    await settle();
    expect(host.querySelectorAll('[data-pdf-page]')).toHaveLength(200);
    expect(canvas(40).width).toBeGreaterThan(0);
    expect(getDocument).toHaveBeenCalledTimes(1);
  });

  it('keeps one mounted mobile page and renders repeated distant target requests', async () => {
    mobile = true; await mount(150, 'mobile-150');
    expect(host.querySelectorAll('[data-pdf-page]')).toHaveLength(1);
    expect(canvas(150).width).toBeGreaterThan(0);
    await mount(2, 'mobile-2');
    expect(host.querySelectorAll('[data-pdf-page]')).toHaveLength(1);
    expect(canvas(2).width).toBeGreaterThan(0);
    expect(retained()).toHaveLength(1);
    expect(pageElement(2).querySelectorAll('.parse-pdf-source-box')).toHaveLength(1);
  });
});
