import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useSummaryResource } from '../../client/src/features/derived-summary/useSummaryResource';

const { JSDOM } = require('jsdom');

let mockSession = 1;
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
}));

interface Props {
  identityKey: string;
  session: number;
  preserveWhileLoading?: boolean;
  preserveAfterTemporaryError?: boolean;
  visible?: boolean;
}

interface PendingRead {
  signal: AbortSignal;
  resolve(value: string): void;
  reject(reason: Error): void;
}

let dom: InstanceType<typeof JSDOM>;
let root: Root;
let container: HTMLElement;
let pending: PendingRead[];
let load: jest.Mock<Promise<string>, [AbortSignal]>;
let commits: Array<{ data: string | null; loading: boolean }>;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

function Reading(props: Props) {
  const value = useSummaryResource(props.identityKey, props.session, load, {
    preserveWhileLoading: props.preserveWhileLoading,
    preserveAfterTemporaryError: props.preserveAfterTemporaryError, visible: props.visible,
  });
  useLayoutEffect(() => {
    commits.push({ data: value.data, loading: value.loading });
  });
  return createElement('section', null,
    createElement('p', { 'data-reading': true, 'data-retained': value.retainedAfterError,
      'data-withheld': value.withheld }, value.data ?? ''),
    value.loading ? createElement('p', { role: 'status' }, 'Reading current data') : null,
    value.error ? createElement('p', { role: 'alert' }, value.error) : null,
  );
}

async function render(props: Props) {
  await act(async () => root.render(createElement(Reading, props)));
}

async function resolveRead(index: number, value: string) {
  await act(async () => pending[index].resolve(value));
}

async function focusWindow() {
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('focus'));
  });
}

function body() {
  return container.querySelector('[data-reading]')?.textContent;
}

beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = dom.window.document.getElementById('root')!;
  root = createRoot(container);
  mockSession = 1;
  pending = [];
  commits = [];
  load = jest.fn((signal: AbortSignal) => new Promise<string>((resolve, reject) => {
    pending.push({ signal, resolve, reject });
  }));
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

it('keeps readable content on window focus while the same-context refresh is pending', async () => {
  await render({ identityKey: 'wiki-a', session: 1, preserveWhileLoading: true });
  await resolveRead(0, 'Saved directory');
  commits.length = 0;

  await focusWindow();

  expect(load).toHaveBeenCalledTimes(2);
  expect(commits[0].data).toBe('Saved directory');
  expect(body()).toBe('Saved directory');
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await resolveRead(1, 'Updated directory');
  expect(body()).toBe('Updated directory');
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('still clears content on focus when preservation was not requested', async () => {
  await render({ identityKey: 'wiki-a', session: 1 });
  await resolveRead(0, 'Saved directory');
  commits.length = 0;
  await focusWindow();
  expect(commits[0].data).toBeNull();
  expect(body()).toBe('');
  expect(load).toHaveBeenCalledTimes(2);
});

it.each([
  { change: 'object', identityKey: 'wiki-b', session: 1 },
  { change: 'session', identityKey: 'wiki-a', session: 2 },
])('hides the previous $change content before passive effects when context changes', async next => {
  await render({ identityKey: 'wiki-a', session: 1, preserveWhileLoading: true });
  await resolveRead(0, 'Previous context');
  commits.length = 0;
  mockSession = next.session;

  await render({ identityKey: next.identityKey, session: next.session, preserveWhileLoading: true });

  expect(commits[0].data).toBeNull();
  expect(body()).toBe('');
  expect(pending[0].signal.aborted).toBe(true);
  await resolveRead(1, 'New context');
  expect(body()).toBe('New context');
});

it('uses the current preservation option when the window regains focus', async () => {
  await render({ identityKey: 'wiki-a', session: 1, preserveWhileLoading: true });
  await resolveRead(0, 'Saved directory');
  await render({ identityKey: 'wiki-a', session: 1, preserveWhileLoading: false });
  await resolveRead(1, 'Latest non-preserved directory');
  commits.length = 0;

  await focusWindow();

  expect(commits[0].data).toBeNull();
  expect(body()).toBe('');
  expect(load).toHaveBeenCalledTimes(3);
});

it('removes retained content when the refreshed read rejects access', async () => {
  await render({ identityKey: 'wiki-a', session: 1, preserveWhileLoading: true });
  await resolveRead(0, 'Previously readable directory');
  await focusWindow();
  await act(async () => pending[1].reject(Object.assign(new Error('Access rejected'), { statusCode: 403 })));
  expect(body()).toBe('');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Access rejected');
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it.each([
  { statusCode: 500 }, { statusCode: 503 },
  { code: 'ERR_NETWORK' }, { code: 'ECONNABORTED' }, { code: 'ETIMEDOUT' }, { code: 'ECONNRESET' },
])('retains the exact displayed read after a temporary failure %j', async failure => {
  await render({ identityKey: 'DVI:parse-1:semantic-2:DRR-1:r1', session: 1, preserveAfterTemporaryError: true });
  await resolveRead(0, 'Saved revision 1; version B is not applicable.');
  await focusWindow();
  await act(async () => pending[1].reject(Object.assign(new Error('temporary read failed'), failure)));
  expect(body()).toBe('Saved revision 1; version B is not applicable.');
  expect(container.querySelector('[data-reading]')?.getAttribute('data-retained')).toBe('true');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('temporary read failed');
  await focusWindow();
  await resolveRead(2, 'Newly authorized revision 2');
  expect(body()).toBe('Newly authorized revision 2');
});

it.each([
  { statusCode: 401 }, { statusCode: 403, code: 'ERR_NETWORK' }, { statusCode: 404 },
  { statusCode: 409 }, { code: 'DOCUMENT_READING_BINDING_MISMATCH' }, {},
])('clears text on a non-temporary failure and cannot revive it after another network error %j', async failure => {
  await render({ identityKey: 'exact-reading', session: 1, preserveAfterTemporaryError: true });
  await resolveRead(0, 'Previously authorized prose');
  await focusWindow();
  await act(async () => pending[1].reject(Object.assign(new Error('read rejected'), failure)));
  expect(body()).toBe('');
  expect(container.querySelector('[data-reading]')?.getAttribute('data-withheld')).toBe('true');
  await focusWindow();
  await act(async () => pending[2].reject(Object.assign(new Error('network later failed'), { code: 'ERR_NETWORK' })));
  expect(body()).toBe('');
  expect(container.querySelector('[data-reading]')?.getAttribute('data-withheld')).toBe('true');
});

it('a disabled authorization epoch hides text before effects and rejects a late reply after recovery', async () => {
  await render({ identityKey: 'exact-reading', session: 1, preserveAfterTemporaryError: true });
  await resolveRead(0, 'Previously authorized prose');
  await focusWindow();
  commits.length = 0;
  await render({ identityKey: 'exact-reading', session: 1, preserveAfterTemporaryError: true, visible: false });
  expect(commits[0].data).toBeNull();
  expect(pending[1].signal.aborted).toBe(true);
  await render({ identityKey: 'exact-reading', session: 1, preserveAfterTemporaryError: true, visible: true });
  await resolveRead(1, 'Late rejected-epoch prose');
  expect(body()).toBe('');
  await resolveRead(2, 'Freshly authorized prose');
  expect(body()).toBe('Freshly authorized prose');
});

it('the original preserveWhileLoading option alone still clears a settled network failure', async () => {
  await render({ identityKey: 'ordinary-directory', session: 1, preserveWhileLoading: true });
  await resolveRead(0, 'Previously read directory');
  await focusWindow();
  await act(async () => pending[1].reject(Object.assign(new Error('temporary failure'), { statusCode: 503 })));
  expect(body()).toBe('');
});
