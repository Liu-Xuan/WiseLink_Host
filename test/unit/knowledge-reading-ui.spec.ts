import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import KnowledgeLookupPage from '../../client/src/pages/KnowledgeLookupPage/KnowledgeLookupPage';
import EngineeringIssueSearch from '../../client/src/features/matter/EngineeringIssueSearch';
import { exactDocumentSourceRoute, matterDocumentRoute } from '../../client/src/features/matter/matter-navigation';
import { readingReturnTarget, knowledgeReadingIdentity } from '../../client/src/features/matter/reading-return';

function renderKnowledge(location: string) {
  const client = new QueryClient();
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client },
      createElement(StaticRouter, { location }, createElement(KnowledgeLookupPage))));
  } finally { client.clear(); }
}

let mockAuthenticationRequired = false;
jest.mock('@client/src/app/providers/CurrentUserSessionProvider', () => ({ useCurrentUserSession: () => ({ sessionGeneration: 1, authenticationRequired: mockAuthenticationRequired, currentUser: { user_id: 'actor-test' } }) }));
jest.mock('@client/src/api/canonical-host', () => ({ subscribeCanonicalHostClientSession: () => () => undefined }));
jest.mock('@client/src/api/engineering-matter', () => ({}));
jest.mock('@client/src/features/matter/MatterDocumentSourceDialog', () => ({ __esModule: true, default: 'div' }));
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/components/ui/input', () => ({ Input: 'input' }));
jest.mock('@client/src/components/ui/select', () => ({ Select: 'select', SelectContent: 'div', SelectItem: 'option', SelectTrigger: 'button', SelectValue: 'span' }));
jest.mock('@lark-apaas/client-toolkit/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@client/src/pages/DocumentParsingPage/jobaid-problem-workspace.css', () => ({}));
jest.mock('../../client/src/pages/KnowledgeLookupPage/knowledge-lookup.css', () => ({}));
jest.mock('../../client/src/pages/KnowledgeLookupPage/knowledge-suite.css', () => ({}));

test('knowledge defaults to saved explanation catalogue without process cards or write actions', () => {
  const html = renderKnowledge('/knowledge?referenceAttemptRef=must-not-run');
  expect(html).toContain('已有工程认识');
  expect(html).toContain('完整工程认识');
  expect(html).toContain('仅历史工作');
  expect(html).not.toContain('知识读取口径');
  expect(html).not.toContain('解析单元');
  expect(html).not.toContain('引用比较处理状态');
});

test('knowledge identity refuses partial, empty and duplicated history pins', () => {
  for (const query of ['workRef=old', 'subjectKind=WORK_ITEM&subjectId=X&workRef=', 'subjectKind=WORK_ITEM&subjectId=X&workRef=old&workRef=new']) {
    expect(knowledgeReadingIdentity(new URLSearchParams(query)).state).toBe('invalid');
    const params = new URLSearchParams({ returnDocumentVersionId: 'DV', returnKnowledgeQuery: query });
    expect(readingReturnTarget(params, 'DV')).toBeNull();
  }
  expect(knowledgeReadingIdentity(new URLSearchParams()).state).toBe('absent');
  const query = 'kind=works&scope=HISTORICAL&subjectKind=WORK_ITEM&subjectId=X&workRef=old&articleY=123';
  const params = new URLSearchParams({ returnDocumentVersionId: 'DV', returnKnowledgeQuery: query });
  expect(readingReturnTarget(params, 'DV')!.route).toContain('workRef=old');
  expect(readingReturnTarget(params, 'DV')!.route).toContain('articleY=123');
  expect(readingReturnTarget(params, 'other')).toBeNull();
});

test('authentication-required knowledge does not retain either result surface', () => {
  mockAuthenticationRequired = true;
  const html = renderKnowledge('/knowledge');
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
