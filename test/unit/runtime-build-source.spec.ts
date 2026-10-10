/// <reference path="../../client/src/types/global.d.ts" />
import { performance as nodePerformance } from 'node:perf_hooks';
import type { RuntimeBuildFingerprint } from '../../client/src/config/runtime-build';

jest.mock('@client/src/config/runtime-build-module-url', () => ({
  runtimeBuildModuleUrl: Reflect.get(globalThis, '__WISELINK_TEST_MODULE_URL__'),
}), { virtual: true });

const { JSDOM } = require('jsdom');
const COMMIT = '4683043a37f9463088d94e9a24510bad6303847e';
const OTHER = '13d383dc4ab13252eb1361a24d0313c431ed1bd7';
const APP = 'app_17bzc551rsg';
const CDN = 'https://lf-miaoda-static.feishucdn.com';
const asset = (commit = COMMIT, app = APP) => `${CDN}/${app}/${commit}/client/assets/index-test.js`;
const oldGlobals = new Map<string, PropertyDescriptor | undefined>();

interface ResourceFixture { name: string; initiatorType?: string; responseStatus?: number }

function loadFingerprint(
  configured: unknown,
  scripts: string[] = [],
  loaded: (string | ResourceFixture)[] = scripts,
  moduleUrl: string | null = scripts.find(src => loaded.some(entry => (typeof entry === 'string' ? entry : entry.name) === src)) ?? null,
): RuntimeBuildFingerprint {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: `https://example.test/app/${APP}/runtime-probe`,
  });
  for (const src of scripts) {
    const script = dom.window.document.createElement('script');
    script.type = 'module';
    script.src = src;
    dom.window.document.head.append(script);
  }
  for (const [key, value] of Object.entries({
    document: dom.window.document,
    performance: { now: () => nodePerformance.now(), timeOrigin: nodePerformance.timeOrigin, getEntriesByType: () => loaded.map(entry => typeof entry === 'string' ? { name: entry, initiatorType: 'script', entryType: 'resource' } : { initiatorType: 'script', ...entry, entryType: 'resource' }) },
    __WISELINK_TEST_MODULE_URL__: moduleUrl,
    __WISELINK_SOURCE_COMMIT__: configured,
    __WISELINK_BUILD_TIME__: '2026-10-10T05:13:37.804Z',
    __WISELINK_VISUAL_VERSION__: 'R10.0-candidate-review',
  })) {
    if (!oldGlobals.has(key)) oldGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let fingerprint: RuntimeBuildFingerprint | undefined;
  jest.isolateModules(() => {
    fingerprint = require('../../client/src/config/runtime-build').runtimeBuildFingerprint;
  });
  dom.window.close();
  if (!fingerprint) throw new Error('FINGERPRINT_NOT_LOADED');
  return fingerprint;
}

afterEach(() => {
  for (const [key, descriptor] of oldGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  oldGlobals.clear();
});

describe('frontend build source from its executed own-app module', () => {
  it('preserves a full verified build SHA and the independent build metadata', () => {
    expect(loadFingerprint(COMMIT)).toEqual({ sourceCommit: COMMIT, buildTime: '2026-10-10T05:13:37.804Z', visualVersion: 'R10.0-candidate-review' });
  });
  it('normalizes a full hexadecimal build SHA', () => {
    expect(loadFingerprint(COMMIT.toUpperCase()).sourceCommit).toBe(COMMIT);
  });
  it.each(['UNAVAILABLE', undefined, '2026-10-10T05:13:37.804Z', '7694901352792001834'])('uses the exact own-app loaded resource when build SHA is %s', (configured) => {
    expect(loadFingerprint(configured, [asset()]).sourceCommit).toBe(COMMIT);
  });
  it.each(['UNAVAILABLE', '', '4683043a', '2026-10-10T05:13:37.804Z', '7694901352792001834', ' frontend-commit '])('does not label non-SHA metadata %s as a source commit', (configured) => {
    expect(loadFingerprint(configured).sourceCommit).toBe('UNAVAILABLE');
  });
  it('rejects a conflict between verified build metadata and loaded source', () => {
    expect(loadFingerprint(COMMIT, [asset(OTHER)]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('rejects a mixture of own-app commit namespaces', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset(), asset(OTHER)]).sourceCommit).toBe('UNAVAILABLE');
    expect(loadFingerprint(COMMIT, [asset(), asset(OTHER)]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('rejects an already imported foreign-version module without a DOM script node', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset()], [asset(), asset(OTHER)]).sourceCommit).toBe('UNAVAILABLE');
    expect(loadFingerprint(COMMIT, [asset()], [asset(), asset(OTHER)]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('rechecks completed imports when the fingerprint is read after lazy loading', () => {
    const loaded: string[] = [asset()];
    const fingerprint = loadFingerprint('UNAVAILABLE', [asset()], loaded);
    expect(fingerprint.sourceCommit).toBe(COMMIT);
    loaded.push(asset(OTHER));
    expect(fingerprint.sourceCommit).toBe('UNAVAILABLE');
  });
  it('rejects an imported own-app malformed namespace without a DOM script node', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset()], [asset(), asset('latest')]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('does not treat a link-only preload as an executed foreign-version module', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset()], [asset(), { name: asset(OTHER), initiatorType: 'link' }]).sourceCommit).toBe(COMMIT);
  });
  it('does not infer a source from an explicitly failed script fetch', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset()], [{ name: asset(), responseStatus: 404 }], null).sourceCommit).toBe('UNAVAILABLE');
  });
  it('conservatively rejects an explicitly failed own-app import alongside its executed entry', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset()], [asset(), { name: asset(), responseStatus: 404 }]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('accepts its executed module without relying on ResourceTiming availability or status', () => {
    expect(loadFingerprint('UNAVAILABLE', [], [], asset()).sourceCommit).toBe(COMMIT);
    expect(loadFingerprint('UNAVAILABLE', [asset()], [{ name: asset(), responseStatus: 0 }]).sourceCommit).toBe(COMMIT);
  });
  it('never uses a completed import record alone as affirmative source evidence', () => {
    expect(loadFingerprint('UNAVAILABLE', [], [asset()], null).sourceCommit).toBe('UNAVAILABLE');
  });
  it('rejects own-app non-SHA and mixed valid/invalid namespaces', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset('latest')]).sourceCommit).toBe('UNAVAILABLE');
    expect(loadFingerprint('UNAVAILABLE', [asset(), asset('latest')]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('does not infer a source from a declared script still absent from completed resource entries', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset()], []).sourceCommit).toBe('UNAVAILABLE');
  });
  it('does not use a preloaded resource that is not an application script', () => {
    expect(loadFingerprint('UNAVAILABLE', [], [asset()]).sourceCommit).toBe('UNAVAILABLE');
  });
  it('accepts duplicate matching scripts and ignores unrelated SDK resources', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset(), asset(), 'https://sdk.example.test/external.js']).sourceCommit).toBe(COMMIT);
  });
  it('does not borrow another application commit', () => {
    expect(loadFingerprint('UNAVAILABLE', [asset(COMMIT, 'app_17c3zn24kv2')]).sourceCommit).toBe('UNAVAILABLE');
    expect(loadFingerprint('UNAVAILABLE', [asset(), asset(OTHER, 'app_17c3zn24kv2')]).sourceCommit).toBe(COMMIT);
  });
  it.each([
    asset().replace(CDN, 'http://lf-miaoda-static.feishucdn.com'),
    asset().replace(CDN, 'https://untrusted.example.test'),
    asset().replace('/client/assets/', '/server/assets/'),
    asset().replace('/index-test.js', '/nested/index-test.js'),
    `${asset()}?commit=${OTHER}`,
    `${asset()}#${OTHER}`,
    asset().replace('https://', 'https://user:password@'),
    asset().replace(COMMIT, 'not-a-git-sha'),
  ])('rejects an unverified resource path %s', (src) => {
    expect(loadFingerprint('UNAVAILABLE', [src]).sourceCommit).toBe('UNAVAILABLE');
  });
});
