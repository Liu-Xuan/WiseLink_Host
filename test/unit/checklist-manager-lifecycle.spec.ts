import type { Root } from 'react-dom/client';
import type { JobAidChecklistDefinitionRead } from '../../shared/jobaid-checklist.interface';
import { currentChecklistDefinition } from '../../server/modules/canonical-host/jobaid-checklist-reading';

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>');
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
  IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
let mockSession = 1;
const mockListeners = new Set<() => void>();
const mockRead = jest.fn();
jest.mock('../../client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: (listener: () => void) => {
    mockListeners.add(listener); return () => mockListeners.delete(listener);
  },
  readChecklistDefinition: (...args: unknown[]) => mockRead(...args),
}));
jest.mock('../../client/src/components/ui/button', () => ({
  Button: ({ variant: _variant, ...props }: Record<string, unknown>) => require('react').createElement('button', props),
}));
jest.mock('../../client/src/components/ui/dialog', () => ({}));
const { CurrentDefinition }: typeof import('../../client/src/features/checklist/ChecklistManager') =
  require('../../client/src/features/checklist/ChecklistManager');
let root: Root, container: HTMLElement;
const definition = currentChecklistDefinition();
beforeEach(() => {
  mockSession = 1; mockRead.mockReset();
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(mockListeners.size).toBe(0);
});
afterAll(() => {
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
async function render() { await act(async () => root.render(createElement(CurrentDefinition))); }
async function refresh() { await act(async () => container.querySelector('button')!.click()); }

it('preserves the readable definition and expanded details during an ordinary delayed refresh', async () => {
  let finish: (value: JobAidChecklistDefinitionRead) => void = () => {};
  mockRead.mockResolvedValueOnce(definition)
    .mockImplementationOnce(() => new Promise<JobAidChecklistDefinitionRead>(resolve => { finish = resolve; }));
  await render();
  const panel = container.querySelector('[data-checklist-definition]');
  const details = panel!.querySelector('details')!;
  details.open = true;
  await refresh();
  expect(container.querySelector('[data-checklist-definition]')).toBe(panel);
  expect(details.open).toBe(true);
  expect(container.textContent).toContain(definition.current.definitionContentHash);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('暂保留本账号');
  await act(async () => finish(structuredClone(definition)));
  expect(container.querySelector('[data-checklist-definition]')).toBe(panel);
  expect(panel!.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(2);
});

it('refreshes through the read API only, and clears previously readable definition after denial', async () => {
  mockRead.mockResolvedValueOnce(definition).mockRejectedValueOnce(Object.assign(new Error('读取被拒绝'), { statusCode: 403 }));
  await render();
  expect(container.textContent).toContain(definition.current.definitionContentHash);
  expect(container.querySelectorAll('button')).toHaveLength(1);
  expect(container.querySelector('button')!.textContent).toBe('重新读取定义');
  await refresh();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('读取被拒绝');
  expect(container.textContent).not.toContain(definition.current.definitionContentHash);
  expect(mockRead).toHaveBeenCalledTimes(2);
  for (const args of mockRead.mock.calls) {
    expect(args).toHaveLength(1); expect(args[0]).toHaveProperty('aborted');
  }
});

it('clears on account change, aborts the prior request and ignores a late reply from that account', async () => {
  let finishOld: (value: JobAidChecklistDefinitionRead) => void = () => {};
  mockRead.mockResolvedValueOnce(definition)
    .mockImplementationOnce(() => new Promise<JobAidChecklistDefinitionRead>(resolve => { finishOld = resolve; }))
    .mockImplementation(() => new Promise(() => {}));
  await render(); await refresh();
  const oldSignal = mockRead.mock.calls[1][0] as AbortSignal;
  await act(async () => { mockSession++; for (const listener of mockListeners) listener(); });
  expect(oldSignal.aborted).toBe(true);
  expect(container.textContent).not.toContain(definition.current.definitionContentHash);
  await act(async () => finishOld(definition));
  expect(container.textContent).not.toContain(definition.current.definitionContentHash);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('正在读取');
  expect(mockRead).toHaveBeenCalledTimes(3);
});
