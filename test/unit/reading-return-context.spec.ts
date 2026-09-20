import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import {
  activityReadingReturnParams,
  activityReadingParams,
  activityReaderParams,
  activityWindowPin,
  completeActivityIdentity,
  libraryDocumentReadingRoute,
  libraryMatterReadingRoute,
  libraryReadingParams,
  libraryReadingScope,
  libraryTaskDocumentReadingRoute,
  readingReturnTarget,
  workItemDocumentReadingRoute,
} from '../../client/src/features/matter/reading-return';
import { matterDocumentRoute } from '../../client/src/features/matter/matter-navigation';
import {
  engineeringIssueReadingParams,
  readEngineeringIssueReadingState,
} from '../../client/src/features/matter/engineering-issue-reading';
import { DocumentVersionLink } from '../../client/src/pages/WorkspaceHomePage/DocumentVersionLink';
import { LibraryDocumentDetails } from '../../client/src/pages/WorkspaceHomePage/LibraryDocumentDetails';
import {
  readReadingLocation,
  saveReadingLocation,
  matterReadingScope,
  clearMatterReadingLocations,
} from '../../client/src/features/matter/reading-location';
import type { CanonicalLibraryDocumentVersionSummary } from '@shared/api.interface';
import type { CanonicalLibraryDocumentSummary } from '@shared/api.interface';
import { subscribeCanonicalHostClientSession } from '@client/src/api/canonical-host';

let mockSession = 1;

test('direct reading routes pin one exact version and preserve their source task', () => {
  const libraryRoute = new URL(libraryTaskDocumentReadingRoute('DV/1', 'WI/1',
    new URLSearchParams('mode=tasks&search=hydraulic&listY=410&quicklookY=90')), 'https://example.test');
  expect(libraryRoute.pathname).toBe('/document-versions/DV%2F1');
  expect(libraryRoute.searchParams.get('returnDocumentVersionId')).toBe('DV/1');
  expect(readingReturnTarget(libraryRoute.searchParams, 'DV/1')).toEqual({
    route: '/library?listY=410&mode=tasks&quicklookY=90&search=hydraulic&workItemId=WI%2F1',
    label: '返回任务快览' });
  const workItemRoute = new URL(workItemDocumentReadingRoute('DV-2', 'WI-2'), 'https://example.test');
  expect(readingReturnTarget(workItemRoute.searchParams, 'DV-2')).toEqual({
    route: '/work-items/WI-2', label: '返回评估简报' });
  expect(() => workItemDocumentReadingRoute('', 'WI-2'))
    .toThrow('DOCUMENT_READING_ROUTE_IDENTITY_INVALID');
  const unbound = new URL(workItemDocumentReadingRoute('DV-B', 'WI-A', true),
    'https://example.test');
  expect(unbound.pathname).toBe('/document-versions/DV-B');
  expect(unbound.searchParams.get('unboundEvidence')).toBe('1');
  expect(unbound.searchParams.has('sourceRef')).toBe(false);
});

test('document quicklook reads selected historical version and does not silently substitute an invalid pin', () => {
  const version = (id: string, current: boolean): CanonicalLibraryDocumentVersionSummary => ({
    documentVersionId: id, businessRevision: id, revisionDate: '', sourceGeneratedDate: '',
    originalFilename: `${id}.pdf`, byteLength: 100, committedAt: '2026-09-17T00:00:00Z',
    selectedVersionIsCurrent: current, readerWorkItemId: '', workItemCount: 0,
  });
  const document: CanonicalLibraryDocumentSummary = {
    kind: 'DOCUMENT', familyId: 'F1', documentId: 'D1', documentCode: 'SB-1',
    normalizedFamily: 'SB', issuerAuthority: '', createdAt: '', updatedAt: '',
    versions: [version('NEW', true), version('OLD', false)], workItemCount: 0,
  };
  const render = (query: string) => renderToStaticMarkup(createElement(StaticRouter,
    {location: `/library?mode=document&familyId=F1&${query}`},
    createElement(LibraryDocumentDetails, {document, onRefresh: jest.fn(), onViewTasks: jest.fn()})));
  expect(render('selectedDocumentVersionId=OLD')).toContain('class="library-selected-version" data-document-version-id="OLD"');
  for (const query of ['selectedDocumentVersionId=missing', 'selectedDocumentVersionId=', 'selectedDocumentVersionId=OLD&selectedDocumentVersionId=NEW']) {
    const html = render(query);
    expect(html).not.toContain('class="library-selected-version"');
    expect(html).toContain('未替换为其他版本');
  }
});

test('matter Wiki return is bound to the opened matter and original directory selection', () => {
  const route = new URL(libraryMatterReadingRoute('MAT-A', new URLSearchParams('search=gear&listY=240&quicklookY=80&linkMatterId=WRITE')), 'https://example.invalid');
  expect(route.pathname).toBe('/matters/MAT-A');
  const target = readingReturnTarget(route.searchParams, undefined, null, 'MAT-A')!;
  expect(target.label).toBe('返回原事项目录');
  expect(target.route).toContain('selectedMatterId=MAT-A');
  expect(target.route).toContain('listY=240');
  expect(target.route).not.toContain('linkMatterId');
  expect(readingReturnTarget(route.searchParams, undefined, null, 'MAT-B')).toBeNull();
  expect(readingReturnTarget(route.searchParams, 'DV-A')).toBeNull();
  const duplicate = new URLSearchParams(route.searchParams);
  duplicate.append('returnLibraryMatterId', 'MAT-A');
  expect(readingReturnTarget(duplicate, undefined, null, 'MAT-A')).toBeNull();
  route.searchParams.set('returnLibraryQuery', 'mode=matter&selectedMatterId=MAT-B');
  expect(readingReturnTarget(route.searchParams, undefined, null, 'MAT-A')).toBeNull();
});

test('directory to Wiki to exact source returns through the same saved work and directory state', () => {
  const wiki = new URL(libraryMatterReadingRoute('MAT-A', new URLSearchParams('search=gear&listY=240&workItemId=WI-filter')), 'https://example.invalid');
  const source = new URL(matterDocumentRoute('MAT-A', {
    documentVersionId: 'DV-old', workItemId: 'WI-A', sourceRefId: 'SRC-A',
    locator: JSON.stringify({parseRunId: 'PRUN-old', sourceRefId: 'SRC-A'}),
  }, 'brief', 'MW-3', wiki.searchParams), 'https://example.invalid');
  expect(source.searchParams.get('parseRunId')).toBe('PRUN-old');
  const returnedWiki = new URL(readingReturnTarget(source.searchParams, 'DV-old')!.route, 'https://example.invalid');
  expect(returnedWiki.searchParams.get('workRef')).toBe('MW-3');
  const returnedLibrary = readingReturnTarget(returnedWiki.searchParams, undefined, null, 'MAT-A')!;
  expect(returnedLibrary.route).toContain('listY=240');
  expect(returnedLibrary.route).toContain('workItemId=WI-filter');
  expect(libraryReadingParams(new URLSearchParams('mode=document&workItemId=WI-filter')).has('workItemId')).toBe(false);
  expect(libraryReadingParams(new URLSearchParams('mode=matter&workItemId=WI-A&workItemId=WI-B')).has('workItemId')).toBe(false);
  expect(returnedLibrary.route).toContain('selectedMatterId=MAT-A');
  source.searchParams.set('returnMatterLibraryQuery', 'mode=matter&selectedMatterId=MAT-B');
  expect(readingReturnTarget(source.searchParams, 'DV-old')).toBeNull();
});

test('Suite directory return preserves selected matter and pane positions without write intent', () => {
  const state = new URLSearchParams('mode=matter&selectedMatterId=MAT-A&search=gear&density=compact&listY=280&quicklookY=510&linkMatterId=WRITE&returnUrl=https://invalid.example');
  const route = new URL(libraryDocumentReadingRoute('DV-A', state), 'https://example.invalid');
  const back = readingReturnTarget(route.searchParams, 'DV-A')!;
  expect(back.label).toBe('返回原事项目录');
  const restored = new URL(back.route, 'https://example.invalid').searchParams;
  expect(Object.fromEntries(restored)).toEqual({mode: 'matter', selectedMatterId: 'MAT-A', search: 'gear', density: 'compact', listY: '280', quicklookY: '510'});
  const changedScroll = new URLSearchParams(state);
  changedScroll.set('listY', '800');
  expect(libraryReadingScope(changedScroll)).toBe(libraryReadingScope(state));
  expect(readingReturnTarget(route.searchParams, 'DV-B')).toBeNull();
});

test('Suite document return retains bounded family expansion and rejects ambiguous or malformed display state', () => {
  const state = new URLSearchParams('mode=document&selectedDocumentVersionId=OLD&expandedFamilyIds=F2,F1,F2&density=compact&listY=-2&quicklookY=Infinity&selectedMatterId=OTHER');
  const clean = libraryReadingParams(state);
  expect(clean.get('selectedDocumentVersionId')).toBe('OLD');
  expect(clean.get('expandedFamilyIds')).toBe('F1,F2');
  expect(clean.has('selectedMatterId')).toBe(false);
  expect(clean.has('listY')).toBe(false);
  expect(clean.has('quicklookY')).toBe(false);
  state.append('selectedDocumentVersionId', 'NEW');
  expect(libraryReadingParams(state).has('selectedDocumentVersionId')).toBe(false);
  state.set('expandedFamilyIds', Array.from({length: 33}, (_, i) => `F${i}`).join(','));
  expect(libraryReadingParams(state).has('expandedFamilyIds')).toBe(false);
});
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
  params.set('selectedDocumentVersionId', version.documentVersionId);
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

test('activity navigation preserves a validated long graph return without widening other return intents', () => {
  const selectedId = `["claim","MW-1","${'条件'.repeat(500)}"]`;
  const graphQuery = new URLSearchParams({
    matterId: 'MAT-1',
    workRef: 'MW-1',
    selectedId,
    perspective: 'documents',
  }).toString();
  const params = new URLSearchParams({
    documentVersionId: 'DV-1',
    parseRunId: 'PR-1',
    candidateRevision: '2',
    runRef: 'RUN-2',
    returnGraphQuery: graphQuery,
    returnDocumentVersionId: 'DV-1',
  });
  expect(graphQuery.length).toBeGreaterThan(512);
  expect(activityReadingParams(params).get('returnGraphQuery')).toBe(graphQuery);
  const activityIdentity = activityReadingParams(params);
  const outer = activityReadingReturnParams(
    activityIdentity.toString(),
    'DV-1',
    'timeline',
  );
  expect(outer.get('returnActivityQuery')!.length).toBeGreaterThan(4096);
  const timelineTarget = readingReturnTarget(outer, 'DV-1', 'PR-1');
  expect(timelineTarget?.route.startsWith('/timeline?')).toBe(true);
  const returnedTimeline = new URL(
    timelineTarget!.route,
    'https://example.test',
  ).searchParams;
  const graphTarget = readingReturnTarget(returnedTimeline, 'DV-1', 'PR-1');
  expect(graphTarget?.route).toContain('/graph?');
  expect(new URL(graphTarget!.route, 'https://example.test').searchParams.get('selectedId'))
    .toBe(selectedId);
  params.set('returnLibraryQuery', 'mode=document');
  expect(activityReadingParams(params).has('returnGraphQuery')).toBe(false);
});

test('an activities reader preserves exactly one bound timeline parent', () => {
  const parent = new URLSearchParams({
    documentVersionId: 'DV-1',
    parseRunId: 'PR-1',
    candidateRevision: '2',
    runRef: 'RUN-2',
    statementId: 'ST-parent',
    anchor: 'A-parent',
    window: 'current-year',
  });
  const reader = new URLSearchParams({
    parseRunId: 'PR-1',
    candidateRevision: '2',
    runRef: 'RUN-2',
    statementId: 'ST-reader',
    anchor: 'A-reader',
    returnActivityQuery: parent.toString(),
    returnActivityView: 'timeline',
  });
  const normalized = activityReaderParams(reader, 'DV-1');
  expect(normalized.get('returnActivityView')).toBe('timeline');
  expect(new URLSearchParams(normalized.get('returnActivityQuery')!).get('statementId'))
    .toBe('ST-parent');
  const original = activityReadingReturnParams(
    normalized.toString(),
    'DV-1',
  );
  const backToReader = readingReturnTarget(original, 'DV-1', 'PR-1');
  expect(backToReader?.route).toContain('/document-versions/DV-1/activities?');
  const readerQuery = new URL(backToReader!.route, 'https://example.test').searchParams;
  expect(readerQuery.get('statementId')).toBe('ST-reader');
  const backToTimeline = readingReturnTarget(readerQuery, 'DV-1', 'PR-1');
  expect(backToTimeline?.route).toContain('/timeline?');
  const timelineQuery = new URL(backToTimeline!.route, 'https://example.test').searchParams;
  expect(timelineQuery.get('statementId')).toBe('ST-parent');
  expect(timelineQuery.get('anchor')).toBe('A-parent');
  expect(timelineQuery.get('window')).toBe('current-year');
});

test('an activities reader rejects mismatched or recursive parent state', () => {
  const current = new URLSearchParams({
    parseRunId: 'PR-1',
    candidateRevision: '2',
    runRef: 'RUN-2',
    statementId: 'ST-reader',
  });
  const parent = new URLSearchParams({
    documentVersionId: 'DV-1',
    parseRunId: 'PR-1',
    candidateRevision: '3',
    runRef: 'RUN-2',
    statementId: 'ST-parent',
  });
  current.set('returnActivityQuery', parent.toString());
  current.set('returnActivityView', 'timeline');
  expect(activityReaderParams(current, 'DV-1').has('returnActivityQuery')).toBe(false);
  parent.set('candidateRevision', '2');
  parent.set('returnActivityQuery', 'parseRunId=PR-1');
  parent.set('returnActivityView', 'timeline');
  current.set('returnActivityQuery', parent.toString());
  expect(activityReaderParams(current, 'DV-1').has('returnActivityQuery')).toBe(false);
});

test('historical issue source reading returns to the exact issue and graph state', () => {
  const graphQuery = new URLSearchParams({
    matterId: 'MAT-A',
    workRef: 'MW-current',
    selectedId: 'prior-result',
    perspective: 'matter',
  }).toString();
  const issueState = engineeringIssueReadingParams({
    query: '液压条件',
    scope: 'HISTORY',
    selected: {
      subjectKind: 'ENGINEERING_MATTER',
      subjectId: 'MAT-B',
      workRef: 'MW-old',
      issueKey: 'ISSUE-2',
    },
  });
  issueState.set('returnGraphQuery', graphQuery);
  issueState.set('returnGraphTargetMatterId', 'MAT-A');
  issueState.set('returnGraphTargetWorkRef', 'MW-current');
  issueState.set('sourceWorkRef', 'MW-current');
  const route = matterDocumentRoute('MAT-A', {
    workItemId: null,
    documentVersionId: 'DV-old',
    sourceRefId: 'SR-old',
    locator: JSON.stringify({
      parseRunId: 'PR-old',
      sourceRefId: 'SR-old',
    }),
  }, 'materials', '', issueState);
  const original = new URL(route, 'https://example.test');
  const target = readingReturnTarget(
    original.searchParams,
    'DV-old',
    'PR-old',
  );
  expect(target?.route).toContain('/matters/MAT-A?');
  const returned = new URL(target!.route, 'https://example.test').searchParams;
  expect(returned.get('panel')).toBe('materials');
  expect(returned.get('issueSubjectKind')).toBe('ENGINEERING_MATTER');
  expect(returned.get('issueSubjectId')).toBe('MAT-B');
  expect(returned.get('issueWorkRef')).toBe('MW-old');
  expect(returned.get('issueKey')).toBe('ISSUE-2');
  expect(returned.get('issueSearchScope')).toBe('HISTORY');
  expect(returned.get('returnGraphQuery')).toBe(graphQuery);
  expect(readEngineeringIssueReadingState(returned)).toMatchObject({
    state: 'ok',
    value: {
      selected: {
        subjectKind: 'ENGINEERING_MATTER',
        subjectId: 'MAT-B',
        workRef: 'MW-old',
        issueKey: 'ISSUE-2',
      },
    },
  });
});

test('partial or duplicate historical issue identity never falls back to current work', () => {
  for (const query of [
    'issueSubjectKind=ENGINEERING_MATTER&issueSubjectId=MAT-B&issueWorkRef=MW-old',
    'issueSubjectKind=WORK_ITEM&issueSubjectId=WI-1&issueWorkRef=MW-old&issueKey=I1&issueKey=I2',
    'issueSubjectKind=OTHER&issueSubjectId=X&issueWorkRef=MW-old&issueKey=I1',
  ]) {
    expect(readEngineeringIssueReadingState(new URLSearchParams(query)).state)
      .toBe('invalid');
  }
  const params = new URLSearchParams({
    returnMatterId: 'MAT-A',
    returnDocumentVersionId: 'DV-old',
    returnMatterPanel: 'materials',
    returnMatterIssueQuery:
      'issueSubjectKind=ENGINEERING_MATTER&issueSubjectId=MAT-B&issueWorkRef=MW-old',
  });
  expect(readingReturnTarget(params, 'DV-old')).toBeNull();
  params.set('returnMatterIssueQuery', new URLSearchParams({
    issueSearchScope: 'HISTORY',
    issueSubjectKind: 'ENGINEERING_MATTER',
    issueSubjectId: 'MAT-B',
    issueWorkRef: 'MW-old',
    issueKey: 'I1',
    returnGraphQuery: 'matterId=MAT-B',
  }).toString());
  expect(readingReturnTarget(params, 'DV-old')).toBeNull();
});

test('legacy referenced-work state converts to a bound issue return only on source navigation', () => {
  const context = new URLSearchParams({
    panel: 'materials',
    sourceWorkRef: 'MW-legacy',
    sourceIssueKey: 'I-legacy',
  });
  const route = matterDocumentRoute('MAT-A', {
    workItemId: null,
    documentVersionId: 'DV-old',
    sourceRefId: 'SR-old',
    locator: JSON.stringify({
      parseRunId: 'PR-old',
      sourceRefId: 'SR-old',
    }),
  }, 'materials', '', context);
  const original = new URL(route, 'https://example.test');
  const target = readingReturnTarget(
    original.searchParams,
    'DV-old',
    'PR-old',
  );
  const returned = new URL(target!.route, 'https://example.test').searchParams;
  expect(returned.get('issueSubjectKind')).toBe('ENGINEERING_MATTER');
  expect(returned.get('issueSubjectId')).toBe('MAT-A');
  expect(returned.get('issueWorkRef')).toBe('MW-legacy');
  expect(returned.get('issueKey')).toBe('I-legacy');
  expect(returned.get('sourceWorkRef')).toBeNull();
  expect(returned.get('sourceIssueKey')).toBeNull();
});

test('opening a tree version without first selecting its quicklook preserves that row identity', () => {
  const version = { documentVersionId: 'DV-row', parsing: null } as CanonicalLibraryDocumentVersionSummary;
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/library?mode=document&familyId=previous' },
    createElement(DocumentVersionLink, { version, familyId: 'clicked-family', children: '原文' })));
  const route = new URL(html.match(/href="([^"]+)"/)![1].replace(/&amp;/g, '&'), 'https://example.invalid');
  expect(readingReturnTarget(route.searchParams, 'DV-row')!.route).toContain('familyId=clicked-family');
  expect(readingReturnTarget(route.searchParams, 'DV-row')!.route).toContain('selectedDocumentVersionId=DV-row');
  expect(readingReturnTarget(route.searchParams, 'DV-row')!.route).not.toContain('previous');
});
