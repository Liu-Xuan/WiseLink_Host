import type { HierarchicalWikiStatus } from '../../shared/hierarchical-wiki.interface';
import type { WiseLinkMonitorElement } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/monitor-types';

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  customElements: dom.window.customElements, CustomEvent: dom.window.CustomEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame, cancelAnimationFrame: dom.window.cancelAnimationFrame,
  ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
})) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const React = require('react');
const { createRoot } = require('react-dom/client');
const { MemoryRouter, useLocation } = require('react-router-dom');
const Diagnostic = require('../../client/src/features/derived-summary/HierarchicalWikiRuntimeDiagnostic').default;
const read: HierarchicalWikiStatus = {
  wikiId: 'wiki1', summaryId: 'summary1', parentSummaryId: null,
  scope: { kind: 'ATA2', title: 'B787 · ATA 46', fleetFamilyId: 'B787', fleetModelIds: [],
    ata2: '46', ata4: null, selectionReason: 'confirmed' },
  enabled: true, state: 'RUNNING', desiredGeneration: 2, completedGeneration: 1,
  firstDirtyAt: '2026-10-22T04:00:00Z', dueAt: '2026-10-22T04:20:00Z',
  coveredMembers: [{ kind: 'DERIVED_SUMMARY', summaryId: 'child1', summaryRef: 'child-rev1', summaryRevision: 4 }],
  waiting: [], activeRequest: { requestId: 'request1', attemptRef: 'attempt1', status: 'RUNNING', claimCount: 1, executorSessionKey: null },
  errorCode: null, coverage: 'AUTHORIZED_CLASSIFIED_HOST_MATERIAL', lastCheckedAt: '2026-10-22T05:00:00Z', inventoryComplete: true,
};
function Location() {
  const location = useLocation();
  return React.createElement('output', { id: 'location' }, `${location.pathname}${location.search}`);
}
let container: HTMLDivElement, root: ReturnType<typeof createRoot>;
const refresh = jest.fn();
beforeEach(async () => {
  refresh.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await React.act(async () => root.render(React.createElement(MemoryRouter,
    { future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(Diagnostic, { wiki: read, session: 3, observedAt: '2026-10-22T05:01:00Z', refreshing: false, onRefresh: refresh }),
    React.createElement(Location))));
});
afterEach(async () => { await React.act(async () => root.unmount()); container.remove(); });
afterAll(() => {
  for (const [name, value] of prior) {
    if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name);
  }
  dom.window.close();
});
async function open(): Promise<WiseLinkMonitorElement> {
  await React.act(async () => {
    const details = container.querySelector('details')!;
    details.open = true; details.dispatchEvent(new dom.window.Event('toggle'));
  });
  return container.querySelector('wiselink-monitor') as WiseLinkMonitorElement;
}

it('mounts only when expanded, uses the supplied observation and delegates reread to the parent', async () => {
  expect(container.querySelector('wiselink-monitor')).toBeNull();
  const monitor = await open();
  expect(monitor.runtime?.meta.observedAt).toBe('2026-10-22T05:01:00Z');
  expect(monitor.runtime?.nodes[0].sourceObservedAt).toBe(read.lastCheckedAt);
  expect(monitor.shadowRoot?.textContent).toContain('RUNNING');
  expect(monitor.shadowRoot?.textContent).toContain('确切修订未返回');
  expect(refresh).not.toHaveBeenCalled();
  await React.act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('#refresh')!.click());
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('navigates an actual covered child to its saved revision through the existing reader route', async () => {
  const monitor = await open();
  await React.act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-node="knowledge.wiki"]')!.click());
  await React.act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-nav="source"][data-ref="child-rev1"]')!.click());
  expect(container.querySelector('#location')!.textContent).toBe('/summaries/child1?summaryRef=child-rev1');
});

it('opens the original reader with the actual current attempt and does not create an update request', async () => {
  const monitor = await open();
  await React.act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-node="knowledge.wiki"]')!.click());
  await React.act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-request="request1"]')!.click());
  await React.act(async () => monitor.shadowRoot!.querySelector<HTMLButtonElement>('[data-nav="request"]')!.click());
  expect(container.querySelector('#location')!.textContent).toBe('/summaries/summary1?attemptRef=attempt1');
  expect(refresh).not.toHaveBeenCalled();
});
