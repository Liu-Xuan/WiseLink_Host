import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import {
  activityReadingParams,
  activityWindowPin,
  completeActivityIdentity,
  libraryDocumentReadingRoute,
  libraryReadingParams,
  libraryReadingScope,
  readingReturnTarget,
} from '../../client/src/features/matter/reading-return';
import { matterDocumentRoute } from '../../client/src/features/matter/matter-navigation';
import { DocumentVersionLink } from '../../client/src/pages/WorkspaceHomePage/DocumentVersionLink';
import { LibraryDocumentDetails } from '../../client/src/pages/WorkspaceHomePage/LibraryDocumentDetails';
import {
  readReadingLocation,
  saveReadingLocation,
  matterReadingScope,
  clearMatterReadingLocations,
} from '../../client/src/features/matter/reading-location';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import { subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';

let mockSession = 1;
jest.mock('@client/src/components/ui/button', () => ({ Button: 'button' }));
jest.mock('@client/src/features/matter/LinkDocumentMatterMaterial', () => ({ __esModule: true, default: 'span' }));
jest.mock('@client/src/api/canonical-host', () => ({
  getCanonicalHostClientSessionGeneration: () => mockSession,
  subscribeCanonicalHostClientSession: jest.fn(() => () => undefined),
}));

test('the actual document row link returns to the same allowed directory filters, not an arbitrary URL', () => {
  const params = new URLSearchParams(
    'mode=document&familyId=F/old&ata=31&search=FTD&fleetModel=777&linkMatterId=write-intent&returnUrl=https://evil.invalid',
  );
  const version = {
    documentVersionId: 'DV/old',
    parsing: null,
  } as CanonicalLibraryDocumentVersionSummary;
  const html = renderToStaticMarkup(
    createElement(
      StaticRouter,
      { location: `/library?${params}` },
      createElement(DocumentVersionLink, { version, children: '原文' }),
    ),
  );
  const href = html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&');
  expect(href).toBe(
    libraryDocumentReadingRoute(version.documentVersionId, params),
  );
  const query = new URL(href, 'https://example.invalid').searchParams;
  const target = readingReturnTarget(query, version.documentVersionId)!;
  expect(target.route).toBe(`/library?${libraryReadingParams(params)}`);
  expect(target.route).toContain('familyId=F%2Fold');
  expect(target.route).not.toContain('evil');
  expect(target.route).not.toContain('linkMatterId');
  expect(readingReturnTarget(query, 'DV-other')).toBeNull();
});

test.each([null, 'WI-old'])(
  'exact parsed source preserves work and source independently (WorkItem=%s)',
  (workItemId) => {
    const route = matterDocumentRoute(
      'MAT/A',
      {
        workItemId,
        documentVersionId: 'DV-old',
        sourceRefId: 'source-old',
        locator: JSON.stringify({
          parseRunId: 'PRUN-old',
          sourceRefId: 'source-old',
        }),
      },
      'brief',
      'MW/3',
    );
    const url = new URL(route, 'https://example.invalid');
    expect(url.pathname).toBe('/document-versions/DV-old');
    expect(url.searchParams.get('parseRunId')).toBe('PRUN-old');
    expect(url.searchParams.get('sourceRef')).toBe('source-old');
    expect(readingReturnTarget(url.searchParams, 'DV-old')).toEqual({
      route: '/matters/MAT%2FA?workRef=MW%2F3',
      label: '返回原工作简报',
    });
    expect(readingReturnTarget(url.searchParams, 'DV-new')).toBeNull();
  },
);

test('legacy inline source and WorkItem reader both keep the exact work rather than current', () => {
  const source = {
    documentVersionId: 'DV-old',
    sourceRefId: 'DOCUMENT_VERSION:DV-old:page:3',
  };
  const inline = new URL(
    matterDocumentRoute('MAT', { ...source, workItemId: null }, 'brief', 'MW3'),
    'https://example.invalid',
  );
  expect(inline.searchParams.get('workRef')).toBe('MW3');
  expect(inline.searchParams.get('sourceDocument')).toBe('DV-old');
  const reader = new URL(
    matterDocumentRoute(
      'MAT',
      { ...source, workItemId: 'WI' },
      'review',
      'MW3',
    ),
    'https://example.invalid',
  );
  expect(reader.searchParams.get('documentVersionId')).toBe('DV-old');
  expect(readingReturnTarget(reader.searchParams, 'DV-old')!.route).toBe(
    '/matters/MAT?workRef=MW3',
  );
});

test('rejects ambiguous, duplicate, cross-document and external return targets', () => {
  for (const query of [
    'returnUrl=https://evil.invalid',
    'returnUrl=//evil.invalid',
    'returnMatterId=M&returnWorkItemId=W',
    'returnMatterId=M&returnMatterId=N',
    'returnMatterId=M&returnMatterWorkRef=',
    'returnMatterId=M&returnDocumentVersionId=OTHER',
    'returnLibraryQuery=mode%3Ddocument',
  ])
    expect(readingReturnTarget(new URLSearchParams(query), 'DV')).toBeNull();
  const target = readingReturnTarget(
    new URLSearchParams(
      'returnMatterId=//evil.invalid&returnMatterWorkRef=../old',
    ),
    'DV',
  )!;
  expect(target.route).toBe('/matters/%2F%2Fevil.invalid?workRef=..%2Fold');
});

test('work positions are isolated, revoked Matter positions clear, and old-session saves cannot repopulate them', () => {
  const location = {
    scrollY: 300,
    claim: null,
    focusClaimId: null,
    discussionClaimId: null,
    expandedIssueRefs: ['issue-3'],
  };
  const a = matterReadingScope('MAT', 'MW3');
  const b = matterReadingScope('MAT', 'MW7');
  const other = matterReadingScope('MAT-other', 'MW3');
  saveReadingLocation(a, location, mockSession);
  saveReadingLocation(b, { ...location, scrollY: 700 }, mockSession);
  saveReadingLocation(other, location, mockSession);
  expect(readReadingLocation(a)?.scrollY).toBe(300);
  expect(readReadingLocation(b)?.scrollY).toBe(700);
  expect(readReadingLocation(matterReadingScope('MAT'))).toBeNull();
  clearMatterReadingLocations('MAT');
  expect(readReadingLocation(a)).toBeNull();
  expect(readReadingLocation(b)).toBeNull();
  expect(readReadingLocation(other)).not.toBeNull();
  const oldSession = mockSession++;
  jest.mocked(subscribeCanonicalHostClientSession).mock.calls[0][0]();
  saveReadingLocation(a, location, oldSession);
  expect(readReadingLocation(a)).toBeNull();
  expect(readReadingLocation(other)).toBeNull();
});

test('directory scopes retain selection/filter differences and ignore unrelated or reordered parameters', () => {
  expect(libraryReadingScope(new URLSearchParams('ata=31&familyId=F'))).toBe(
    libraryReadingScope(
      new URLSearchParams('familyId=F&ata=31&returnUrl=https://evil.invalid'),
    ),
  );
  expect(libraryReadingScope(new URLSearchParams('familyId=F'))).not.toBe(
    libraryReadingScope(new URLSearchParams('familyId=G')),
  );
});

test('an unloaded selected family is not reported missing and does not silently select another row', () => {
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/library?familyId=F-old' },
    createElement(LibraryDocumentDetails, { document: null, selectionPending: true, onRefresh: jest.fn(), onViewTasks: jest.fn() })));
  expect(html).toContain('原选择尚未在当前读取范围内加载');
  expect(html).toContain('不代表资料不存在');
  expect(html).toContain('不会自动改选首行');
});

test('activity window pins are whitelist-only, single-occurrence, and carried through the exact return', () => {
  const allPin = activityWindowPin(new URLSearchParams('window=all'));
  expect(allPin.state === 'ok' ? allPin.value : null).toBe('all');
  const yearPin = activityWindowPin(new URLSearchParams('window=current-year'));
  expect(yearPin.state === 'ok' ? yearPin.value : null).toBe('current-year');
  expect(activityWindowPin(new URLSearchParams('window=2026')).state).toBe('invalid');
  expect(activityWindowPin(new URLSearchParams('window=all&window=all')).state).toBe('duplicate');
  expect(activityWindowPin(new URLSearchParams('window=')).state).toBe('empty');
  expect(activityWindowPin(new URLSearchParams()).state).toBe('absent');
  expect(activityReadingParams(new URLSearchParams('parseRunId=PR1&window=current-year&window=evil')).get('window')).toBeNull();
  expect(activityReadingParams(new URLSearchParams('parseRunId=PR1&window=current-year')).get('window')).toBe('current-year');
  const identity = 'parseRunId=PR1&candidateRevision=2&runRef=run-2&statementId=S1&anchor=A1&window=current-year';
  const pins = completeActivityIdentity(new URLSearchParams(identity));
  expect(pins).not.toBeNull();
  expect(pins!.window).toBe('current-year');
  expect(completeActivityIdentity(new URLSearchParams(`${identity}&window=all`))).toBeNull();
  expect(completeActivityIdentity(new URLSearchParams('parseRunId=PR1&candidateRevision=2&runRef=run-2&window=bogus'))).toBeNull();
  const returnQuery = new URLSearchParams({
    returnDocumentVersionId: 'DV1',
    returnActivityQuery: identity,
    returnActivityView: 'timeline',
  });
  const target = readingReturnTarget(returnQuery, 'DV1', 'PR1')!;
  expect(target).not.toBeNull();
  expect(target.route).toContain('/timeline?');
  expect(target.route).toContain('window=current-year');
  expect(target.route).toContain('statementId=S1');
});

test('opening a tree version without first selecting its quicklook preserves that row identity', () => {
  const version = { documentVersionId: 'DV-row', parsing: null } as CanonicalLibraryDocumentVersionSummary;
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/library?mode=document&familyId=previous' },
    createElement(DocumentVersionLink, { version, familyId: 'clicked-family', children: '原文' })));
  const route = new URL(html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&'), 'https://example.invalid');
  expect(readingReturnTarget(route.searchParams, 'DV-row')!.route).toContain('familyId=clicked-family');
  expect(readingReturnTarget(route.searchParams, 'DV-row')!.route).not.toContain('previous');
});
