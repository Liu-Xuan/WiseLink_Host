import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import KnowledgeLookupPage from '../../client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import EngineeringIssueSearch from '../../client/src/features/matter/EngineeringIssueSearch';
import { exactDocumentSourceRoute, matterDocumentRoute } from '../../client/src/features/matter/matter-navigation';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';

let mockAuthenticationRequired = false;
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: mockAuthenticationRequired }) }));
jest.mock('@client/src/api/canonical-host', () => ({ subscribeCanonicalHostClientSession: () => () => undefined }));
jest.mock('@client/src/api/engineering-matter', () => ({}));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({ __esModule: true, default: 'div' }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }));
jest.mock('@client/src/components/ui/select', () => ({ Select: 'select', SelectContent: 'div', SelectItem: 'option', SelectTrigger: 'button', SelectValue: 'span' }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('../../client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));

test('knowledge mounts the shared read-only search without requiring a selected Matter or querying units first', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/knowledge?referenceAttemptRef=must-not-run' }, createElement(KnowledgeLookupPage)));
  expect(html).toContain('只读工程知识检索');
  expect(html).toContain('工程工作检索结果');
  expect(html).toContain('原文检索结果');
  expect(html).toContain('按文档任务与准确版本查询解析单元');
  expect(html).not.toContain('请先在资料库选择事项');
  expect(html).not.toContain('正在确认事项范围');
  expect(html).not.toContain('引用比较处理状态');
  expect(html).not.toContain('引用并比较本事项');
});

test('authentication-required knowledge does not retain either result surface', () => {
  mockAuthenticationRequired = true;
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/knowledge' }, createElement(KnowledgeLookupPage)));
  mockAuthenticationRequired = false;
  expect(html).toContain('请先登录');
  expect(html).not.toContain('只读工程知识检索');
  expect(html).not.toContain('解析单元查询');
});

test('existing Matter search retains its explicit reference-status surface while readOnly ignores reference URL inputs', () => {
  const readonly = renderToStaticMarkup(createElement(StaticRouter, { location: '/knowledge?referenceAttemptRef=AQ&sourceWorkRef=old&sourceIssueKey=condition' }, createElement(EngineeringIssueSearch, { readOnly: true })));
  const matter = renderToStaticMarkup(createElement(StaticRouter, { location: '/matters/M?referenceAttemptRef=AQ' }, createElement(EngineeringIssueSearch, { matterId: 'M' })));
  expect(readonly).not.toContain('引用比较处理状态');
  expect(matter).toContain('引用比较处理状态');
});

test('shared source route keeps exact parse identity and prior Matter return binding', () => {
  const source = { documentVersionId: 'DV-old', workItemId: null, sourceRefId: 'SR-old', locator: JSON.stringify({ parseRunId: 'PRUN-old', sourceRefId: 'SR-old' }) };
  const route = exactDocumentSourceRoute(source)!;
  const url = new URL(route, 'https://example.invalid');
  expect(url.pathname).toBe('/document-versions/DV-old');
  expect(url.searchParams.get('parseRunId')).toBe('PRUN-old');
  expect(exactDocumentSourceRoute({ ...source, sourceRefId: 'SR-other' })).toBeNull();
  const matter = new URL(matterDocumentRoute('M', source, 'brief', 'MW3'), 'https://example.invalid');
  expect(matter.searchParams.get('sourceRef')).toBe('SR-old');
  expect(readingReturnTarget(matter.searchParams, 'DV-old')!.route).toBe('/matters/M?workRef=MW3');
});
