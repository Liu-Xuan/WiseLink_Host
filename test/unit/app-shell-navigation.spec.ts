import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

jest.mock('@client/src/components/CurrentUserControl', () => ({
  __esModule: true,
  default: 'span',
}));
jest.mock('@client/src/features/atlas/AtlasLauncher', () => ({
  __esModule: true,
  default: 'span',
}));
jest.mock('@client/src/app/providers/CurrentObjectContextProvider', () => ({
  useCurrentObjectContext: () => ({ currentObject: null }),
  currentObjectKindLabel: () => '工程事项',
}));

import TopBar from '../../client/src/features/navigation/TopBar';
import {
  buildShellObjectLinks,
  deriveBreadcrumbs,
  deriveShellRouteContext,
} from '../../client/src/features/navigation/shell-utils';

function renderTopBar(pathname: string, search = ''): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`${pathname}${search}`] },
      createElement(TopBar, {
        pathname,
        search,
        mobileNavOpen: false,
        onToggleMobile: () => undefined,
      }),
    ),
  );
}

test('registered shell routes have concrete breadcrumbs instead of a not-found label', () => {
  const routes: Array<[string, string?]> = [
    ['/', ''],
    ['/library', ''],
    ['/work-items/WI-1', ''],
    ['/work-items/WI-1/documents', '?node=reader'],
    ['/matters/MAT-1', ''],
    ['/matters/MAT-1', '?workRef=MWREV-1'],
    ['/document-versions/DV-1', ''],
    ['/dialogues', ''],
    ['/dialogues/THREAD-1', ''],
    ['/runtime-probe', ''],
    ['/settings/models', ''],
    ['/external-discovery', ''],
    ['/knowledge', ''],
    ['/graph', ''],
    ['/situation', ''],
    ['/dev-preview/graph', ''],
    ['/dev-preview/reader-workspace', ''],
    ['/dev-preview/situation', ''],
    ['/timeline', '?documentVersionId=DV-1'],
    ['/activity-graph', '?documentVersionId=DV-1'],
  ];
  for (const [pathname, search = ''] of routes) {
    expect(deriveBreadcrumbs(pathname, search).map((item) => item.label)).not.toContain(
      '页面未找到',
    );
  }
});

test('Matter navigation stays in the Matter and never passes a Matter id as a WorkItem', () => {
  const current = deriveShellRouteContext('/matters/MAT%2F777', '');
  const historical = deriveShellRouteContext(
    '/matters/MAT%2F777',
    '?workRef=MWREV%2F3',
  );
  expect(current).toMatchObject({
    matterId: 'MAT/777',
    workItemId: '',
    workRef: '',
  });
  expect(historical.workRef).toBe('MWREV/3');

  const links = buildShellObjectLinks(historical);
  expect(links.map((item) => item.label)).toEqual([
    '返回当前事项简报',
    '当前事项核对与讨论',
    '当前事项关联资料',
  ]);
  expect(links.every((item) => item.to.startsWith('/matters/MAT%2F777'))).toBe(
    true,
  );
  expect(JSON.stringify(links)).not.toContain('/work-items/');
  expect(JSON.stringify(links)).not.toContain('/knowledge');
});

test('historical Matter and document-version top bars expose their exact route identity', () => {
  const historical = renderTopBar(
    '/matters/MAT-777',
    '?workRef=MWREV-3',
  );
  expect(historical).toContain('工程事项');
  expect(historical).toContain('历史工作 MWREV-3');
  expect(historical).toContain('历史工作 · MWREV-3');
  expect(historical).not.toContain('页面未找到');
  expect(historical).not.toContain('尚未选择事项');

  const documentVersion = renderTopBar('/document-versions/DV-777');
  expect(documentVersion).toContain('文档版本');
  expect(documentVersion).toContain('DV-777');
  expect(documentVersion).not.toContain('页面未找到');
  expect(documentVersion).not.toContain('尚未选择事项');

  const unrelatedQuery = renderTopBar('/knowledge', '?workRef=MWREV-WRONG');
  expect(unrelatedQuery).not.toContain('历史工作');
});

test('timeline shell binds a validated graph return to its query document and parse run', () => {
  const graphQuery = new URLSearchParams({
    matterId: 'MAT-1',
    workRef: 'MW-1',
    perspective: 'documents',
  }).toString();
  const search = `?${new URLSearchParams({
    documentVersionId: 'DV-1',
    parseRunId: 'PR-1',
    returnGraphQuery: graphQuery,
    returnDocumentVersionId: 'DV-1',
  })}`;
  expect(deriveShellRouteContext('/timeline', search).documentVersionId).toBe('DV-1');
  const timeline = renderTopBar('/timeline', search);
  expect(timeline).toContain('aria-label="返回关系图谱"');
  expect(timeline).not.toContain('aria-label="返回关系图谱" disabled=""');

  const mismatched = renderTopBar(
    '/timeline',
    search.replace('documentVersionId=DV-1', 'documentVersionId=DV-2'),
  );
  expect(mismatched).toContain('aria-label="返回目标与当前版本不匹配"');
});

test('WorkItem reader shell validates and exposes an exact graph return', () => {
  const graphQuery = new URLSearchParams({
    matterId: 'MAT-1',
    workRef: 'MW-1',
    selectedId: 'evidence-1',
  }).toString();
  const search = `?${new URLSearchParams({
    node: 'reader',
    documentVersionId: 'DV-1',
    returnGraphQuery: graphQuery,
    returnDocumentVersionId: 'DV-1',
  })}`;
  const pathname = '/work-items/WI-1/documents';
  expect(deriveShellRouteContext(pathname, search).documentVersionId).toBe('DV-1');
  const reader = renderTopBar(pathname, search);
  expect(reader).toContain('aria-label="返回关系图谱"');
  expect(reader).not.toContain('aria-label="返回关系图谱" disabled=""');

  const mismatched = renderTopBar(
    pathname,
    search.replace('documentVersionId=DV-1', 'documentVersionId=DV-2'),
  );
  expect(mismatched).toContain('aria-label="返回目标与当前版本不匹配"');

  const duplicated = renderTopBar(pathname, `${search}&documentVersionId=DV-1`);
  expect(duplicated).toContain('aria-label="返回目标与当前版本不匹配"');
  const empty = renderTopBar(
    pathname,
    search.replace('documentVersionId=DV-1', 'documentVersionId='),
  );
  expect(empty).toContain('aria-label="返回目标与当前版本不匹配"');
});

test('WorkItem navigation retains the existing assessment and reader paths', () => {
  const links = buildShellObjectLinks(
    deriveShellRouteContext('/work-items/WI%2F7/documents', ''),
  );
  expect(links.map((item) => item.to)).toEqual(
    expect.arrayContaining([
      '/work-items/WI%2F7/documents?node=assessment&tab=assessment',
      '/work-items/WI%2F7/documents?node=reader&tab=source',
      '/work-items/WI%2F7/documents?node=review&tab=review',
    ]),
  );
});
