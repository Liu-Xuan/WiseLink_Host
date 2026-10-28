import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { sourceRead } from '../tdms-p1-frontend/fixtures';
import { observedFixture } from './tdms-observed-links.fixture';

let sessionGeneration = 1;
const sourcePage = jest.fn();
const observedRead = jest.fn();
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => sessionGeneration,
  subscribeCanonicalHostClientSession: () => () => undefined,
  isCanonicalHostClientSessionAuthenticationRequired: () => false,
  readTdmsDocumentSource: (...args: unknown[]) => sourcePage(...args),
  readTdmsDocumentObservedLinks: (...args: unknown[]) => observedRead(...args),
  readTdmsSourceHistory: jest.fn(), readTdmsSourceRecord: jest.fn(), readTdmsSourceRelations: jest.fn(),
}));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));

import { TdmsDocumentSourceReading } from '@client/src/features/tdms-source/TdmsDocumentSourceReading';

describe('document source observed links in the existing reader', () => {
  let dom: JSDOM, root: Root, container: HTMLDivElement;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    dom = new JSDOM('<!doctype html><body></body>', { url: 'https://test.invalid/library' });
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
      getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    container = dom.window.document.createElement('div');
    dom.window.document.body.append(container);
    root = createRoot(container);
    sessionGeneration = 1;
    sourcePage.mockReset(); observedRead.mockReset();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    originals.clear();
  });
  async function mount(version: string) {
    await act(async () => root.render(createElement(MemoryRouter,
      { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
      createElement(TdmsDocumentSourceReading, { documentVersionId: version }))));
  }
  async function expand(details: HTMLDetailsElement, pending: () => Promise<unknown>) {
    await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')); await Promise.resolve(); });
    await act(async () => { await pending(); });
  }

  it('expands exact observed processing, each own opinion and AEO data from the production controller', async () => {
    const f = await observedFixture({ includeAeo: true }), dv = f.registration.documentVersionId!;
    const original = sourceRead('root', dv);
    original.record.recordKind = 'MANUFACTURER_FILE';
    original.record.sourceRevisionRef = f.rootRef;
    original.bodyReadPolicy = { kind: 'NON_OPINION_SOURCE', sourceRecordId: original.record.sourceRecordId,
      sourceRevisionRef: f.rootRef };
    sourcePage.mockResolvedValue({ documentVersionId: dv, sourceStatus: 'AVAILABLE',
      records: [original], hasMore: false, nextAfter: null });
    let pending: Promise<unknown> = Promise.resolve();
    observedRead.mockImplementation((input: { documentVersionId: string; rootRevisionRef: string;
      parentPath: string[]; after?: string; limit: number }) => {
      pending = f.controller.documentObservedLinks(f.request, input.documentVersionId, {
        root: input.rootRevisionRef, parent: input.parentPath, limit: String(input.limit),
        ...(input.after ? { after: input.after } : {}),
      });
      return pending;
    });
    await mount(dv);
    expect(observedRead).not.toHaveBeenCalled();
    await expand(container.querySelector<HTMLDetailsElement>('.tdms-observed-links')!, () => pending);
    expect(container.textContent).toContain('适用性、当前性和完整性均未确认');
    expect(observedRead.mock.calls[0][0]).toMatchObject({ documentVersionId: dv, rootRevisionRef: f.rootRef, parentPath: [] });
    const nested = container.querySelectorAll<HTMLDetailsElement>('.tdms-observed-links')[1]!;
    await expand(nested, () => pending);
    expect(container.textContent).toContain('Synthetic approved opinion');
    expect(container.textContent).toContain('本条仅显示元数据');
    expect(container.textContent).toContain('SYNTHETIC PRIOR SOURCE ASSERTION');
    expect(container.textContent).toContain('不计算整份完成率');
  });

  it('clears a late observed response when the selected document version changes', async () => {
    const original = sourceRead('old-root', 'DV-OLD');
    original.record.recordKind = 'MANUFACTURER_FILE';
    sourcePage.mockImplementation(({ documentVersionId }: { documentVersionId: string }) => Promise.resolve({
      documentVersionId, sourceStatus: 'AVAILABLE', records: documentVersionId === 'DV-OLD' ? [original] : [],
      hasMore: false, nextAfter: null,
    }));
    let release!: (value: unknown) => void, signal!: AbortSignal;
    const delayed = new Promise(resolve => { release = resolve; });
    observedRead.mockImplementation((_input: unknown, abort: AbortSignal) => { signal = abort; return delayed; });
    await mount('DV-OLD');
    const details = container.querySelector<HTMLDetailsElement>('.tdms-observed-links')!;
    await act(async () => { details.open = true; details.dispatchEvent(new dom.window.Event('toggle')); await Promise.resolve(); });
    expect(observedRead).toHaveBeenCalled();
    await mount('DV-NEW');
    expect(signal.aborted).toBe(true);
    await act(async () => { release({ diagnostic: 'AVAILABLE', gaps: [], links: [{ child: { record: { title: 'LATE-PRIVATE' } } }], hasMore: false }); await delayed; });
    expect(container.textContent).not.toContain('LATE-PRIVATE');
    expect(container.textContent).not.toContain('old-root');
  });
});
