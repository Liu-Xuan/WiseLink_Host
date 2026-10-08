import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import TdmsSourceReading from '@client/src/features/tdms-source/TdmsSourceReading';
import TdmsGraphSourceReading from '@client/src/features/tdms-source/TdmsGraphSourceReading';
import TdmsGraphSourceEntry from '@client/src/features/tdms-source/TdmsGraphSourceEntry';
import DeferredTdmsSourceRelationGraph from '@client/src/features/tdms-source/DeferredTdmsSourceRelationGraph';
import { TDMS_SOURCE_UI_ENABLED } from '@client/src/features/tdms-source/tdms-source-enabled';
import { relations } from './reader-fixtures';

const { JSDOM } = require('jsdom');
const mockHttp = jest.fn();
const mockLoader = jest.fn();
const mockSessionRead = jest.fn();
const mockIdentityRead = jest.fn();
jest.mock('@lark-apaas/client-toolkit/utils/getAxiosForBackend', () => ({
  axiosForBackend: (...args: unknown[]) => mockHttp(...args),
}));
jest.mock('@lark-apaas/client-toolkit/utils/resolveAppUrl', () => ({ resolveAppUrl: (url: string) => url }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({
  useCurrentUserSession: () => {
    mockSessionRead();
    return { sessionGeneration: 1, authenticationRequired: false, currentUser: { user_id: 'synthetic-user' } };
  },
}));
jest.mock('@client/src/features/matter/useEngineeringMatter', () => ({
  useEngineeringMatterQueryIdentity: (...args: unknown[]) => {
    mockIdentityRead(...args);
    return { identity: { appId: 'synthetic-app', tenantId: 'synthetic-tenant', actorId: 'synthetic-actor' },
      identityQuery: { isFetching: false, error: null, refetch: jest.fn() } };
  },
}));
jest.mock('@client/src/features/tdms-source/tdms-relation-graph-loader', () => ({
  loadTdmsSourceRelationGraph: (...args: unknown[]) => mockLoader(...args),
}));
jest.mock('../../../client/src/features/tdms-source/tdms-source-reading.css', () => ({}));
jest.mock('../../../client/src/features/tdms-source/tdms-relation-graph.css', () => ({}));

let dom: InstanceType<typeof JSDOM>;
let root: Root;
let container: HTMLElement;
const prior = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.test/?tdms=true' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  // An untrusted browser value cannot override the source constant.
  dom.window.localStorage.setItem('TDMS_SOURCE_UI_ENABLED', 'true');
  dom.window.sessionStorage.setItem('tdmsEnabled', 'true');
  container = dom.window.document.getElementById('root')!;
  root = createRoot(container);
  for (const mock of [mockHttp, mockLoader, mockSessionRead, mockIdentityRead]) mock.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  prior.clear();
});

async function foregroundAndClick() {
  await act(async () => {
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    for (const button of container.querySelectorAll('button')) (button as HTMLButtonElement).click();
  });
  expect(mockHttp).not.toHaveBeenCalled();
  expect(mockLoader).not.toHaveBeenCalled();
  expect(container.querySelector('[data-testid="loaded-graph"]')).toBeNull();
  expect(container.textContent).not.toContain('Private excerpt');
}

it('reader defaults off through the actual canonical API, including foreground/click attempts', async () => {
  expect(TDMS_SOURCE_UI_ENABLED).toBe(false);
  await act(async () => root.render(createElement(TdmsSourceReading,
    { context: { documentVersionId: 'synthetic-DV' } })));
  expect(mockIdentityRead).toHaveBeenCalledWith(false, 1);
  await foregroundAndClick();
  await act(async () => root.render(createElement(TdmsSourceReading,
    { context: { matterId: 'synthetic-M' }, exactRevisionRefs: ['synthetic-old-ref'] })));
  await foregroundAndClick();
  expect(container.textContent).not.toContain('synthetic-old-ref');
});

it('graph reader defaults off before any saved-work or source GET', async () => {
  await act(async () => root.render(createElement(TdmsGraphSourceReading, {
    documentVersionId: 'synthetic-DV',
    savedWork: { subjectKind: 'WORK_ITEM', subjectId: 'synthetic-WI', workRef: 'synthetic-work' },
  })));
  await foregroundAndClick();
  expect(container.textContent).toBe('');
});

it('module-gated graph entry mounts no session hook, button or lazy reader even with enabled props', async () => {
  await act(async () => root.render(createElement(TdmsGraphSourceEntry,
    { enabled: true, documentVersionId: 'synthetic-DV' })));
  await foregroundAndClick();
  expect(mockSessionRead).not.toHaveBeenCalled();
  expect(mockIdentityRead).not.toHaveBeenCalled();
  expect(container.querySelector('button')).toBeNull();
  expect(container.textContent).toBe('');
});

it('default-disabled deferred graph neither imports its canvas nor produces nodes', async () => {
  await act(async () => root.render(createElement(DeferredTdmsSourceRelationGraph,
    { reading: relations('synthetic-ref') })));
  await foregroundAndClick();
  expect(container.textContent).toBe('');
});
