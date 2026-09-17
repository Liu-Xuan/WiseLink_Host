import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { originalFixture } from './document-parsing/fixtures/document-original.fixture';
import { DocumentOriginalReader } from '../../client/src/pages/DocumentParsingPage/DocumentOriginalReader';
import type { DocumentOriginalResult } from '../../shared/document-original.interface';

const { JSDOM } = require('jsdom');

function mergedFixture(): DocumentOriginalResult {
  const original = originalFixture();
  original.coverage = { knownPageCount: 4, readPageIndexes: [0, 1, 2, 3], unresolvedRanges: [] };
  original.source.units = original.source.units.map((unit, index) => ({ ...unit, kind: 'paragraph',
    payload: { text: index ? 'Information listed below). Keep the condition with this procedure.' : 'If an operator prepares a database, use the approved tool (Support/ Contact' } }));
  original.locations = original.locations.map((location, index) => ({ ...location, pageIndex: index + 2,
    precision: 'TEXT_ITEM', coordinateSpace: 'PDF_VIEWPORT_TOP_LEFT', viewportWidth: 600, viewportHeight: 800,
    boxes: [[54, index ? 95 : 710, 480, 9]] }));
  return original;
}

function multiPageFixture(): DocumentOriginalResult {
  const original = originalFixture();
  original.coverage = { knownPageCount: 5, readPageIndexes: [0, 1, 2, 3, 4], unresolvedRanges: [] };
  original.source.units[0].sourceRefIds = ['SR-TEST-P1', 'SR-TEST-P2'];
  original.locations[0] = { ...original.locations[0], pageIndex: 1 };
  original.locations[1] = { ...original.locations[1], pageIndex: 3 };
  return original;
}

/** Same unit but a different parse-run binding whose saved pages are `pages` (one-based). */
function rebindFixture(pages: number[]): DocumentOriginalResult {
  const original = JSON.parse(JSON.stringify(multiPageFixture())) as DocumentOriginalResult;
  original.binding = { ...original.binding, parseRunId: 'PR-TEST-9', parseRevision: 9,
    sourceSha256: 'b'.repeat(64), sourceByteLength: 9999 };
  original.coverage = { knownPageCount: Math.max(...pages) + 2,
    readPageIndexes: pages.map(page => page - 1), unresolvedRanges: [] };
  original.source.units[0].sourceRefIds = ['SR-TEST-P1', 'SR-TEST-P2'];
  original.locations[0] = { ...original.locations[0], pageIndex: pages[0] - 1 };
  original.locations[1] = { ...original.locations[1], pageIndex: pages[1] - 1 };
  return original;
}

let root: Root;
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

async function mount(original: DocumentOriginalResult, onUnitLocate?: (page: number, unitId: string) => void) {
  root = createRoot(container);
  await act(async () => root.render(createElement(DocumentOriginalReader, { original, onUnitLocate })));
}

/** Rerender the SAME component instance so local state (pageChoice) persists across the run change. */
async function rerender(original: DocumentOriginalResult, onUnitLocate?: (page: number, unitId: string) => void) {
  await act(async () => root.render(createElement(DocumentOriginalReader, { original, onUnitLocate })));
}

function click(selector: string) {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  act(() => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
}

function pressEnter(selector: string) {
  const element = container.querySelector(selector);
  if (!element) throw new Error(`missing element ${selector}`);
  act(() => { element.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
}

function button(text: string): HTMLElement {
  const element = [...container.querySelectorAll('button')].find(item => item.textContent === text);
  if (!element) throw new Error(`missing button ${text}`);
  return element;
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root');
});

afterEach(async () => {
  await act(async () => root?.unmount());
  dom.window.close();
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

it('clicking each merged member locates the exact clicked source unit, not the group head', async () => {
  const onUnitLocate = jest.fn();
  await mount(mergedFixture(), onUnitLocate);
  click('#u1');
  expect(onUnitLocate).toHaveBeenLastCalledWith(3, 'u1');
  click('#u2');
  expect(onUnitLocate).toHaveBeenLastCalledWith(4, 'u2');
});

it('supports keyboard activation on a paragraph', async () => {
  const onUnitLocate = jest.fn();
  await mount(mergedFixture(), onUnitLocate);
  pressEnter('[role="button"]');
  expect(onUnitLocate).toHaveBeenCalledTimes(1);
});

it('does not jump while text is selected', async () => {
  const onUnitLocate = jest.fn();
  Object.defineProperty(dom.window, 'getSelection', {
    configurable: true,
    value: () => ({ isCollapsed: false, toString: () => 'selected run' }),
  });
  await mount(mergedFixture(), onUnitLocate);
  click('#u1');
  expect(onUnitLocate).not.toHaveBeenCalled();
});

it('keyboard-activating a later merged member locates that member, not the group head', async () => {
  const onUnitLocate = jest.fn();
  await mount(mergedFixture(), onUnitLocate);
  pressEnter('#u2');
  expect(onUnitLocate).toHaveBeenCalledTimes(1);
  expect(onUnitLocate).toHaveBeenCalledWith(4, 'u2');
});

it('restores stable DOM ids on the table unit, rows and cells so getElementById positioning works', async () => {
  const onUnitLocate = jest.fn();
  await mount(originalFixture(), onUnitLocate);
  const table = dom.window.document.getElementById('u2');
  expect(table).not.toBeNull();
  expect(table?.getAttribute('data-unit-id')).toBe('u2');
  expect(table?.className).toContain('original-locatable-block');
  expect(dom.window.document.getElementById('r0')).not.toBeNull();
  expect(dom.window.document.getElementById('c1')).not.toBeNull();
  click('#u2');
  expect(onUnitLocate).toHaveBeenLastCalledWith(2, 'u2');
});

it('keeps merged paragraph members inline while staying individually locatable', async () => {
  const onUnitLocate = jest.fn();
  await mount(mergedFixture(), onUnitLocate);
  const first = dom.window.document.getElementById('u1');
  expect(first?.tagName).toBe('SPAN');
  expect(first?.className).toBe('original-locatable');
  expect(first?.className).not.toContain('block');
  expect(first?.getAttribute('tabindex')).toBe('0');
});

it('offers the real pages of a multi-page unit instead of guessing one, and locates only the chosen page', async () => {
  const onUnitLocate = jest.fn();
  await mount(multiPageFixture(), onUnitLocate);
  click('#u1');
  expect(onUnitLocate).not.toHaveBeenCalled();
  const group = container.querySelector('[role="group"][aria-label^="此段跨越多页"]');
  expect(group).not.toBeNull();
  act(() => { button('第 4 页').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  expect(onUnitLocate).toHaveBeenCalledTimes(1);
  expect(onUnitLocate).toHaveBeenCalledWith(4, 'u1');
});

it('canceling the multi-page chooser does not locate anything', async () => {
  const onUnitLocate = jest.fn();
  await mount(multiPageFixture(), onUnitLocate);
  click('#u1');
  act(() => { button('取消').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  expect(onUnitLocate).not.toHaveBeenCalled();
  expect(container.querySelector('[role="group"]')).toBeNull();
});

it('shows a concise local notice and does not jump when the unit has no physical page', async () => {
  const original = mergedFixture();
  original.locations = original.locations.map(location => ({ ...location, pageIndex: null }));
  const onUnitLocate = jest.fn();
  await mount(original, onUnitLocate);
  click('#u1');
  expect(onUnitLocate).not.toHaveBeenCalled();
  expect(container.textContent).toContain('没有可用的物理页定位');
});

it('a rerender to a new parse-run binding invalidates the old page choice and locates only the new pages', async () => {
  const onUnitLocate = jest.fn();
  await mount(multiPageFixture(), onUnitLocate);
  click('#u1'); // opens the old-binding chooser (pages 2 and 4)
  expect(container.querySelector('[role="group"]')).not.toBeNull();
  await rerender(rebindFixture([7, 9]), onUnitLocate);
  // The stale choice must be synchronously invisible and un-clickable after the run change.
  expect(container.querySelector('[role="group"]')).toBeNull();
  expect([...container.querySelectorAll('button')].some(item => item.textContent === '第 2 页' || item.textContent === '第 4 页')).toBe(false);
  expect(onUnitLocate).not.toHaveBeenCalled();
  // Re-opening uses the new binding's page set, and only those pages can be passed through.
  click('#u1');
  const group = container.querySelector('[role="group"]');
  expect(group).not.toBeNull();
  expect(group?.textContent).toContain('第 7 页');
  expect(group?.textContent).toContain('第 9 页');
  act(() => { button('第 9 页').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  expect(onUnitLocate).toHaveBeenCalledTimes(1);
  expect(onUnitLocate).toHaveBeenCalledWith(9, 'u1');
});

it('keeps the open choice visible across a rerender that preserves the same binding and pages', async () => {
  const onUnitLocate = jest.fn();
  await mount(multiPageFixture(), onUnitLocate);
  click('#u1');
  await rerender(JSON.parse(JSON.stringify(multiPageFixture())) as DocumentOriginalResult, onUnitLocate);
  expect(container.querySelector('[role="group"]')).not.toBeNull();
  act(() => { button('第 2 页').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  expect(onUnitLocate).toHaveBeenCalledWith(2, 'u1');
});
