import type { Root } from 'react-dom/client';
import type { DocumentTranslationReadingResponse } from '@shared/document-translation-reading.interface';
import { semanticReadingFixture } from './semantic-reading-ui.fixtures';
import { adaptDocumentTranslationRead, translationDiagnosticAttempt, translationDiagnosticRevision } from '../../client/src/pages/DocumentParsingPage/runtime-monitor/adapt-document-translation-read';
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
dom.window.scrollTo = () => undefined;
dom.window.HTMLElement.prototype.scrollIntoView = jest.fn();
const prior = new Map<string, PropertyDescriptor | undefined>();
for (const name of ['window', 'document', 'HTMLElement', 'customElements', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/review/InitialAnalysisContinueButton', () => ({ __esModule: true, default: 'button' }));
jest.mock('@client/src/pages/DocumentParsingPage/TranslationRevisionEditor', () => ({ TranslationRevisionEditor: 'div' }));
jest.mock('@client/src/pages/DocumentParsingPage/semantic-bilingual-reader.css', () => ({}));
const { act, createElement }: typeof import('react') = require('react');
const { createRoot }: typeof import('react-dom/client') = require('react-dom/client');
const { SemanticBilingualReader }: typeof import('../../client/src/pages/DocumentParsingPage/SemanticBilingualReader') = require('../../client/src/pages/DocumentParsingPage/SemanticBilingualReader');
const { default: Diagnostic }: typeof import('../../client/src/pages/DocumentParsingPage/runtime-monitor/DocumentTranslationRuntimeDiagnostic') = require('../../client/src/pages/DocumentParsingPage/runtime-monitor/DocumentTranslationRuntimeDiagnostic');
const context = { scopeKey: 'session:document:parse', observedAt: '2026-10-22T14:00:00Z', environment: 'test', label: '文档', mode: 'live' as const };
function response(): DocumentTranslationReadingResponse {
  return { documentVersionId: 'document-test', parseRunId: 'parse-test',
    translation: { status: 'SEMANTIC_READING_AID_AVAILABLE', reading: semanticReadingFixture() },
    execution: { status: 'SUCCEEDED', errorCode: null } };
}
let host: HTMLElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
afterAll(() => { for (const [name, value] of prior) { if (value) Object.defineProperty(globalThis, name, value); else Reflect.deleteProperty(globalThis, name); } dom.window.close(); });
it('keeps partial reading independent of succeeded execution and connects only checked selected revisions', () => {
  const read = response();
  const runtime = adaptDocumentTranslationRead(read, read.documentVersionId, read.parseRunId, context)!;
  expect(runtime.nodes[0].execution).toEqual({ label: 'SUCCEEDED', status: 'SUCCEEDED' });
  expect(runtime.nodes[0].coverage).toMatchObject({ label: expect.stringContaining('PARTIAL'), tone: 'wait' });
  expect(runtime.edges[0].refs).toEqual(['body-checked-2']);
  expect(runtime.nodes[0].requests).toEqual([]);
  expect(runtime.nodes[0].requestCompleteness).toBe('not_provided');
  expect(runtime.resources).toBeUndefined();
  expect(runtime.meta.observedAt).toBe(context.observedAt);
  expect(runtime.nodes[0].sourceObservedAt).toBeUndefined();
});
it('rejects stale document/parse/revision navigation and never invents an edge for unavailable or unchecked results', () => {
  const read = response();
  expect(() => adaptDocumentTranslationRead(read, 'wrong', read.parseRunId, context)).toThrow('版本不一致');
  expect(() => adaptDocumentTranslationRead(read, read.documentVersionId, 'wrong', context)).toThrow('版本不一致');
  const runtime = adaptDocumentTranslationRead(read, read.documentVersionId, read.parseRunId, context)!;
  const detail = { kind: 'artifact' as const, nodeId: 'document.translation', scopeKey: context.scopeKey, ref: 'body-checked-2' };
  expect(translationDiagnosticRevision(detail, runtime)).toBe('body-checked-2');
  expect(translationDiagnosticRevision({ ...detail, scopeKey: 'other-session' }, runtime)).toBeNull();
  expect(translationDiagnosticRevision({ ...detail, ref: 'old-revision' }, runtime)).toBeNull();
  expect(translationDiagnosticRevision({ ...detail, kind: 'request' }, runtime)).toBeNull();
  read.translation = { status: 'UNAVAILABLE', reason: 'TRANSLATION_PROJECTION_NOT_AVAILABLE' };
  expect(adaptDocumentTranslationRead(read, read.documentVersionId, read.parseRunId, context)!.edges).toEqual([]);
});
it('uses parent refresh, preserves stale observation time, and clears the graph when access is rejected', async () => {
  const onRefresh = jest.fn(); const onLocateRevision = jest.fn();
  const props = { read: response() as DocumentTranslationReadingResponse | null, documentVersionId: 'document-test', parseRunId: 'parse-test',
    scopeKey: context.scopeKey, observedAt: context.observedAt, error: null as string | null, refreshing: false, onRefresh, onLocateRevision, onOpenContinuation: jest.fn() };
  await act(async () => root.render(createElement(Diagnostic, props)));
  const monitor = host.querySelector('wiselink-monitor')!;
  await act(async () => (monitor.shadowRoot!.querySelector('#refresh') as HTMLButtonElement).click());
  expect(onRefresh).toHaveBeenCalledTimes(1);
  await act(async () => monitor.dispatchEvent(new CustomEvent('wiselink-navigate', { detail: {
    kind: 'artifact', nodeId: 'document.translation', scopeKey: context.scopeKey, ref: 'body-checked-2',
  } })));
  expect(onLocateRevision).toHaveBeenCalledWith('body-checked-2');
  await act(async () => root.render(createElement(Diagnostic, { ...props, error: '暂时读取失败' })));
  expect(host.textContent).toContain('保留上次获权观察');
  expect(monitor.shadowRoot!.textContent).toContain('PARTIAL');
  expect((monitor as unknown as { runtime: { meta: { observedAt: string } } }).runtime.meta.observedAt).toBe(context.observedAt);
  await act(async () => root.render(createElement(Diagnostic, { ...props, read: null, observedAt: null, error: 'denied' })));
  expect(monitor.shadowRoot!.textContent).not.toContain('body-checked-2');
});
it('lists only the exact latest attempt with its native event times and refuses old request actions', () => {
  const read = response();
  read.execution = { status: 'SUCCEEDED', errorCode: null, attemptId: 'ATT-latest',
    createdAt: '2026-10-22T10:00:00Z', startedAt: '2026-10-22T10:01:00Z', completedAt: '2026-10-22T10:02:00Z' };
  const runtime = adaptDocumentTranslationRead(read, read.documentVersionId, read.parseRunId, context)!;
  expect(runtime.nodes[0].requestCompleteness).toBe('latest_only');
  expect(runtime.nodes[0].requests[0]).toMatchObject({ id: 'ATT-latest', createdAt: read.execution.createdAt,
    startedAt: read.execution.startedAt, completedAt: read.execution.completedAt });
  expect(runtime.nodes[0].requests[0].queuedAt).toBeUndefined();
  const action = { kind: 'request' as const, nodeId: 'document.translation', scopeKey: context.scopeKey,
    recordKind: 'attempt' as const, attemptId: 'ATT-latest', ref: 'ATT-latest' };
  expect(translationDiagnosticAttempt(action, runtime)).toBe(true);
  expect(translationDiagnosticAttempt({ ...action, attemptId: 'old', ref: 'old' }, runtime)).toBe(false);
  expect(translationDiagnosticAttempt({ ...action, requestId: 'invented' }, runtime)).toBe(false);
});
it('locates the exact saved revision in the actual reader and ignores a replaced revision', async () => {
  const read = response();
  const scroll = dom.window.HTMLElement.prototype.scrollIntoView as jest.Mock;
  const props = { translation: read.translation, onSourceRefSelect: jest.fn(), mode: 'translation' as const };
  scroll.mockClear();
  await act(async () => root.render(createElement(SemanticBilingualReader, { ...props, locateRevision: { revisionId: 'old-revision', request: 1 } })));
  expect(scroll).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(SemanticBilingualReader, { ...props, locateRevision: { revisionId: 'body-checked-2', request: 2 } })));
  expect(scroll).toHaveBeenCalled();
  expect(host.textContent).toContain('仅适用于上支架，不得用于下支架；应先核实构型。');
});
