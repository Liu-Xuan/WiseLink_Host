import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { transformSync } from 'esbuild';
const { JSDOM } = require('jsdom');
jest.mock('@lark-apaas/client-toolkit', () => ({ getCsrfToken: () => null }));

// Compile only Vite's worker URL/import.meta syntax. Run the actual React viewer;
// PDF acquisition is isolated so late page geometry can be controlled precisely.
const viewerFile = resolve(__dirname, '../../client/src/pages/DocumentParsingPage/PdfDocumentViewer.tsx');
let panelActive = true;
const destroy = jest.fn(async () => undefined);
const pdf = { numPages: 5, getPage: () => new Promise(() => undefined) };
const runtime = { loadPdfJsRuntime: async () => ({ getDocument: () => ({ promise: Promise.resolve(pdf), destroy }) }) };
const compiled = transformSync(readFileSync(viewerFile, 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic',
  define: { 'import.meta.url': JSON.stringify('http://localhost/PdfDocumentViewer.tsx') } }).code;
const moduleObject = { exports: {} as { default: (props: any) => any } };
new Function('require', 'module', 'exports', compiled)((name: string) => {
  if (name.endsWith('?worker&url')) return 'http://localhost/pdf.worker.mjs';
  if (name === './pdfjs-runtime') return runtime;
  if (name === '@client/src/api/canonical-host') return { canonicalPdfPreviewUrl: () => '/unused' };
  if (name.endsWith('RetainedWorkbenchPanel')) return { useWorkbenchPanelActive: () => panelActive };
  if (name.startsWith('./')) return require(resolve(viewerFile, '..', name));
  return require(name);
}, moduleObject, moduleObject.exports);
const Viewer = moduleObject.exports.default;

describe('actual PDF viewer with asynchronous page geometry (isolated PDF engine)', () => {
  let dom: any; let root: Root; let host: HTMLElement;
  let heights: number[]; let frames: Map<number, FrameRequestCallback>;
  let observers: Set<{ callback: () => void; targets: Set<Element>; disconnect: jest.Mock }>;
  let originals: Map<string, PropertyDescriptor | undefined>;
  function pageOffset(page: number) { return 6 + heights.slice(0, page - 1).reduce((sum, height) => sum + height + 8, 0); }
  function flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); }
  function resize() { for (const observer of observers) if (observer.targets.size) observer.callback(); flushFrames(); }
  function container() { return host.querySelector('.parse-pdf-pages') as HTMLElement; }
  function targetTop(page = 5) { return host.querySelector(`[data-pdf-page="${page}"]`)!.getBoundingClientRect().top - container().getBoundingClientRect().top; }
  async function mount(signal = 'source-5', targetPage = 5) { await act(async () => { root.render(createElement(Viewer, {
    sourceUrl: 'blob:isolated-pdf', targetPage, targetSignal: signal,
  })); }); await act(async () => flushFrames()); }
  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    originals = new Map(); heights = [280, 280, 280, 280, 280]; frames = new Map(); observers = new Set(); panelActive = true;
    let frameId = 0;
    const resizeObserver = class {
      targets = new Set<Element>(); callback: () => void;
      constructor(callback: () => void) { this.callback = callback; observers.add(this); }
      observe(target: Element) { this.targets.add(target); }
      disconnect = jest.fn(() => this.targets.clear());
    };
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, ResizeObserver: resizeObserver,
      IntersectionObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    dom.window.requestAnimationFrame = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; };
    dom.window.cancelAnimationFrame = (id: number) => frames.delete(id);
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get() { return 400; } });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get() { return this.classList.contains('parse-pdf-pages') ? 760 : 0; } });
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', { get() {
      return heights.reduce((sum, height) => sum + height, 0) + 32 + 6 + (Number.parseFloat(this.style.paddingBottom) || 6);
    } });
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const page = Number(this.getAttribute('data-pdf-page'));
      const top = page ? 100 + pageOffset(page) - container().scrollTop : 100;
      const height = page ? heights[page - 1] : 760;
      return { top, bottom: top + height, left: 0, right: 400, width: 400, height, x: 0, y: top, toJSON() {} };
    };
    dom.window.HTMLElement.prototype.scrollTo = function ({ top }: { top: number }) {
      this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
      this.dispatchEvent(new dom.window.Event('scroll', { bubbles: false }));
    };
    host = document.getElementById('root')!; root = createRoot(host); destroy.mockClear();
  });
  afterEach(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
  });

  it('keeps the requested last page aligned as prior canvases gain height, including a viewport taller than the last page', async () => {
    await mount();
    expect(targetTop()).toBe(0);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('5');
    await act(async () => { heights = [514, 514, 514, 514, 514]; resize(); });
    expect(targetTop()).toBe(0);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('5');
    expect(container().scrollTop).toBe(pageOffset(5));
  });

  it('also realigns a middle page when earlier page canvases resize', async () => {
    await mount('source-3', 3);
    expect(targetTop(3)).toBe(0);
    await act(async () => { heights = [514, 514, 514, 514, 514]; resize(); });
    expect(targetTop(3)).toBe(0);
    expect((host.querySelector('input') as HTMLInputElement).value).toBe('3');
  });

  it('stops following the source after a user scroll gesture and resumes only on a new explicit target', async () => {
    await mount();
    await act(async () => { container().dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true })); container().scrollTo({ top: 300 }); flushFrames(); });
    const manualTop = container().scrollTop;
    await act(async () => { heights = [514, 514, 514, 514, 514]; resize(); });
    expect(container().scrollTop).toBe(manualTop);
    await mount('new-source-5');
    expect(targetTop()).toBe(0);
  });

  it('disconnects target observers and pending frames when hidden or unmounted without reopening the PDF', async () => {
    await mount();
    panelActive = false; await mount();
    expect([...observers].every(observer => observer.targets.size === 0)).toBe(true);
    expect(frames.size).toBe(0);
    expect(destroy).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(destroy).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });
});
