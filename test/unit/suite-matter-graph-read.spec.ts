import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { libraryMatterFixture } from './fixtures/library-matter';
import { useSuiteMatterGraph } from '../../client/src/pages/RelationGraphPage/useSuiteMatterGraph';
import type { EngineeringMatterWorkingRevisionReadModel } from '../../shared/matter-working.interface';
const { JSDOM } = require('jsdom');
const mockRead = jest.fn();
let mockSession = 1;
const mockWorkspace = {data: libraryMatterFixture(), error: null, loading: false, refresh: jest.fn()};
jest.mock('../../client/src/features/matter/useEngineeringMatter', () => ({__esModule: true, default: () => mockWorkspace}));
jest.mock('../../client/src/api/engineering-matter', () => ({getEngineeringMatterWorkingRevision: (...args: unknown[]) => mockRead(...args)}));
jest.mock('../../client/src/api/canonical-host', () => ({getCanonicalHostClientSessionGeneration: () => mockSession}));

test('historical graph does not substitute current work or display cancelled or revoked responses', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const prior = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true})) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
  }
  const pending = new Map<string, (value: EngineeringMatterWorkingRevisionReadModel) => void>();
  mockRead.mockImplementation((_matter: string, ref: string) => new Promise(resolve => pending.set(ref, resolve)));
  function Probe({workRef, denied = false}: {workRef: string; denied?: boolean}) {
    const state = useSuiteMatterGraph('ui-test-matter', workRef, mockSession, denied);
    return createElement('div', null, state.graph?.workRef ?? (state.error || 'waiting'));
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const history = (workRef: string) => ({...structuredClone(mockWorkspace.data.working.current!), matterWorkRevisionId: workRef, workingRevision: 1});
  try {
    await act(async () => root.render(createElement(Probe, {workRef: 'old-a'})));
    expect(container.textContent).toBe('waiting');
    await act(async () => root.render(createElement(Probe, {workRef: 'old-b'})));
    await act(async () => pending.get('old-a')!(history('old-a')));
    expect(container.textContent).toBe('waiting');
    await act(async () => pending.get('old-b')!(history('old-b')));
    expect(container.textContent).toBe('old-b');
    await act(async () => root.render(createElement(Probe, {workRef: 'old-c'})));
    mockSession++;
    await act(async () => root.render(createElement(Probe, {workRef: 'old-c', denied: true})));
    await act(async () => pending.get('old-c')!(history('old-c')));
    expect(container.textContent).not.toContain('old-c');
    expect(container.textContent).not.toContain('test-working-3');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, value] of prior) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); }
  }
});
