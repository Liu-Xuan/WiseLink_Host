import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import TdmsSourceRelationGraph from '@client/src/features/tdms-source/TdmsSourceRelationGraph';
import { TdmsSourceRelations } from '@client/src/features/tdms-source/TdmsRecordDetails';
import { relations } from './reader-fixtures';

const { JSDOM } = require('jsdom');
jest.mock('@client/src/features/tdms-source/tdms-relation-graph.css', () => ({}));
jest.mock('@client/src/pages/RelationGraphPage/RelationGraphCanvas', () => ({
  __esModule: true, default: () => createElement('div', { className: 'rg-canvas' }),
}));
let dom: InstanceType<typeof JSDOM>;
let container: HTMLElement;
let root: Root;
const globals = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  container = document.getElementById('root')!; root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
  globals.clear();
});

it.each([
  'REVISION_RULE_EXACT_ENDPOINT_NOT_VERIFIED',
  'REVISION_RULE_SCOPE_NOT_VERIFIED',
  'REVISION_RULE_SOURCE_BASIS_NOT_CAPTURED',
  'REVISION_RULE_ENDPOINT_SOURCE_VERSION_UNCONFIRMED',
])('the real list and selected graph renderer retain explicit raw fields but grant no revision/completion credit for %s', async gap => {
  const read = relations('revision-exact-old');
  const assertion = read.relations[0];
  assertion.authority = 'SOURCE_EXPLICIT'; assertion.changeClass = 'EQUIVALENT';
  assertion.completionEffect = 'OLD_COMPLETION_RECOGNIZED';
  assertion.coverage = { status: 'PARTIAL', gaps: [gap], readback: 'CONSISTENT' };
  if (gap === 'REVISION_RULE_EXACT_ENDPOINT_NOT_VERIFIED')
    assertion.to = { kind: 'UNRESOLVED', rawIdentity: 'OR/VR unresolved', versionGap: 'exact source revision unavailable' };
  if (gap === 'REVISION_RULE_SCOPE_NOT_VERIFIED') assertion.scope = {};
  if (gap === 'REVISION_RULE_SOURCE_BASIS_NOT_CAPTURED') assertion.rawFields = {};
  const listHtml = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(TdmsSourceRelations, { read, onOpen: jest.fn() })));
  expect(listHtml).toContain('待核字段 EQUIVALENT'); expect(listHtml).toContain('待核字段 OLD_COMPLETION_RECOGNIZED');
  expect(listHtml).not.toContain('源明确等效'); expect(listHtml).not.toContain('源明确认可此范围旧版完成');
  expect(listHtml).toContain(gap);

  await act(async () => root.render(createElement(TdmsSourceRelationGraph, { reading: read })));
  const edge = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(assertion.assertionRef));
  expect(edge).toBeDefined(); await act(async () => edge!.click());
  const inspector = container.querySelector('[aria-label="准确关系断言"]')!;
  expect(inspector.textContent).toContain('待核字段 EQUIVALENT');
  expect(inspector.textContent).toContain('待核字段 OLD_COMPLETION_RECOGNIZED');
  expect(inspector.textContent).toContain('不形成完成认可或重做要求');
  expect(inspector.textContent).not.toContain('源明确等效');
  expect(inspector.textContent).not.toContain('源明确认可此精确范围旧版完成');
  expect(inspector.textContent).toContain(gap);
});

it('keeps explicit REPLACES/reexecute raw values pending for an unrecognized future revision-rule gap', () => {
  const read = relations('revision-exact-old'); const assertion = read.relations[0];
  assertion.changeClass = 'REPLACES'; assertion.completionEffect = 'REEXECUTE_NEW_VERSION';
  assertion.coverage = { status: 'PARTIAL', gaps: ['REVISION_RULE_FUTURE_VERIFICATION_GAP'], readback: 'NOT_VERIFIED' };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(TdmsSourceRelations, { read, onOpen: jest.fn() })));
  expect(html).toContain('待核字段 REPLACES'); expect(html).toContain('待核字段 REEXECUTE_NEW_VERSION');
  expect(html).not.toContain('源明确取代'); expect(html).not.toContain('源明确要求此范围按新版重做');
});
