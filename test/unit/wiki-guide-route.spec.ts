import {
  EMPTY_WIKI_GUIDE_STATE, readWikiGuideState, wikiGuideStateParams, wikiGuideReturnRoute,
  wikiGuideSummaryRoute, wikiGuideIssueRoute, type WikiGuideState,
  wikiGuideIssueAnchor, type WikiGuidePageState,
} from '@client/src/lib/wiki-guide-route';
import type { WikiGuidePathSegment, WikiGuideIssueHit } from '@shared/wiki-guide.interface';

const root = 'DS-00000000-0000-4000-8000-000000000001';
const chapter = 'DS-00000000-0000-4000-8000-000000000002';
const state: WikiGuideState = { rootSummaryId: root, chapterSummaryId: chapter, search: '31 告警 / 条件', scrollTop: 420 };
const saved: WikiGuidePathSegment = { summaryId: chapter, parentSummaryId: root,
  currentSummaryRef: 'DSR-00000000-0000-4000-8000-000000000003', currentRevision: 3,
  scope: { kind: 'ATA2', title: '指示与记录', fleetFamilyId: 'B747', fleetModelIds: ['B747-8'],
    ata2: '31', ata4: null, selectionReason: '' } };
const hit: WikiGuideIssueHit = {
  subjectKind: 'WORK_ITEM', subjectId: 'WI-00000000-0000-4000-8000-000000000004',
  workRef: 'JAWR-00000000-0000-4000-8000-000000000005', workRevision: 4, issueKey: 'I4',
  question: '已保存的条件是什么？', documentVersionId: 'document_version_exact', paths: [[saved]],
};

it('round trips the exact model/chapter/search/scroll and only returns to the local guide', () => {
  const encoded = wikiGuideStateParams(state).toString();
  expect(readWikiGuideState(new URLSearchParams(encoded))).toEqual(state);
  expect(wikiGuideReturnRoute(encoded)).toBe('/situation?' + encoded);
  expect(wikiGuideReturnRoute(null)).toBeNull();
  expect(wikiGuideReturnRoute('')).toBe('/situation');
  expect(readWikiGuideState(new URLSearchParams())).toEqual(EMPTY_WIKI_GUIDE_STATE);
});
it.each([
  'wikiRoot=', 'wikiRoot=DS-1', 'wikiRoot=https://outside.invalid',
  'wikiRoot=' + root + '&wikiRoot=' + root,
  'wikiChapter=' + chapter + '&wikiChapter=' + chapter,
  'wikiRoot=' + root + '%0A', 'wikiQuery=a&wikiQuery=b', 'wikiQuery=%00',
  'wikiQuery=' + 'x'.repeat(201), 'wikiY=-1', 'wikiY=0.5', 'wikiY=1e3',
  'wikiY=00', 'wikiY=10000000', 'wikiY=1&wikiY=2', 'returnUrl=https://outside.invalid',
  'wikiRoot=' + root + '&requestId=write-intent', 'scope=ALL',
])('rejects invalid or ambiguous guide state %s', query => {
  expect(readWikiGuideState(new URLSearchParams(query))).toBeNull();
  expect(wikiGuideReturnRoute(query)).toBeNull();
});
it('rejects oversized encoded returns without accepting a partly valid prefix', () => {
  expect(wikiGuideReturnRoute('wikiQuery=' + 'x'.repeat(8192))).toBeNull();
});
it('opens the exact saved summary ref and carries one guide return intent', () => {
  const route = wikiGuideSummaryRoute(saved, state)!;
  const url = new URL(route, 'https://local.invalid');
  expect(url.pathname).toBe('/summaries/' + chapter);
  expect(url.searchParams.get('summaryRef')).toBe(saved.currentSummaryRef);
  expect(wikiGuideReturnRoute(url.searchParams.get('returnWikiGuideQuery'))).toBe('/situation?' + wikiGuideStateParams(state));
  expect([...url.searchParams.keys()]).toEqual(['summaryRef', 'returnWikiGuideQuery']);
  expect(wikiGuideSummaryRoute({ ...saved, currentSummaryRef: null }, state)).toBeNull();
  expect(wikiGuideSummaryRoute({ ...saved, summaryId: 'DS-1' }, state)).toBeNull();
  expect(wikiGuideSummaryRoute(saved, { ...state, scrollTop: Infinity })).toBeNull();
});
it.each(['WORK_ITEM', 'ENGINEERING_MATTER'] as const)('opens an exact %s work and issue without manufacturing a DVI or model request', kind => {
  const url = new URL(wikiGuideIssueRoute({ ...hit, subjectKind: kind }, state)!, 'https://local.invalid');
  expect(url.pathname).toBe('/knowledge');
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ subjectKind: kind, subjectId: hit.subjectId,
    workRef: hit.workRef, knowledgeIssueKey: hit.issueKey });
  expect(url.searchParams.has('documentVersionId')).toBe(false);
  expect(wikiGuideReturnRoute(url.searchParams.get('returnWikiGuideQuery'))).toContain('/situation?');
  expect(wikiGuideIssueRoute({ ...hit, workRef: '' }, state)).toBeNull();
});

const after = Buffer.from(JSON.stringify({ synthetic: 'exact-page-2' })).toString('base64url');
it.each(['SECTIONS', 'SEARCH_CHAPTERS', 'ISSUES'] as const)('round trips one bounded %s page and exact trigger', kind => {
  const page: WikiGuidePageState = { kind, after,
    anchor: kind === 'ISSUES' ? wikiGuideIssueAnchor(hit) : saved.summaryId, offset: -80 };
  const value = { ...state, search: kind === 'SECTIONS' ? '' : state.search, page };
  const encoded = wikiGuideStateParams(value).toString();
  expect(readWikiGuideState(new URLSearchParams(encoded))).toEqual(value);
  expect(wikiGuideReturnRoute(encoded)).toBe('/situation?' + encoded);
  expect(readWikiGuideState(wikiGuideStateParams({ ...value, page: { ...page, after: null, offset: 0 } }))?.page)
    .toEqual({ ...page, after: null, offset: 0 });
});
it.each([
  { wikiPage: 'ISSUES' }, { wikiAfter: after }, { wikiPage: 'OTHER' },
  { wikiAfter: '' }, { wikiAfter: 'YQ==' }, { wikiAfter: 'YQ+' }, { wikiAfter: 'Y' },
  { wikiAfter: 'YR' }, { wikiAfter: 'A'.repeat(4001) },
  { wikiOffset: '-0' }, { wikiOffset: '1.5' }, { wikiOffset: '1e2' }, { wikiOffset: '10001' },
  { wikiOffset: '-10001' }, { wikiAnchor: 'DS-invalid' },
])('rejects incomplete, malformed or unbounded page context %j', overrides => {
  const params = wikiGuideStateParams({ ...state, search: '', page: { kind: 'SECTIONS', after, anchor: saved.summaryId, offset: 0 } });
  if (Object.keys(overrides).length === 1 && 'wikiPage' in overrides && overrides.wikiPage === 'ISSUES') {
    params.delete('wikiAnchor'); params.delete('wikiOffset');
  }
  if ('wikiAfter' in overrides && Object.keys(overrides).length === 1 && overrides.wikiAfter === after) params.delete('wikiPage');
  for (const [key, value] of Object.entries(overrides)) params.set(key, value);
  expect(readWikiGuideState(params)).toBeNull();
});
it('rejects duplicate page keys, cross-mode context and partial issue identities', () => {
  const params = wikiGuideStateParams({ ...state, page: { kind: 'ISSUES', after, anchor: wikiGuideIssueAnchor(hit), offset: 0 } });
  params.append('wikiAfter', after);
  expect(readWikiGuideState(params)).toBeNull();
  params.delete('wikiAfter'); params.set('wikiPage', 'SECTIONS');
  expect(readWikiGuideState(params)).toBeNull();
  params.set('wikiPage', 'ISSUES'); params.set('wikiAnchor', JSON.stringify(['WORK_ITEM', hit.subjectId, hit.workRef]));
  expect(readWikiGuideState(params)).toBeNull();
  params.set('wikiAnchor', JSON.stringify(['WORK_ITEM', hit.subjectId, hit.workRef, ' ']));
  expect(readWikiGuideState(params)).toBeNull();
  params.set('wikiAnchor', wikiGuideIssueAnchor(hit)); params.delete('wikiRoot');
  expect(readWikiGuideState(params)).toBeNull();
});
it('keeps a maximum-length canonical cursor within the bounded guide return', () => {
  const value = { ...state, page: { kind: 'ISSUES' as const, after: 'A'.repeat(4000),
    anchor: wikiGuideIssueAnchor(hit), offset: 10_000 } };
  const params = wikiGuideStateParams(value);
  expect(params.toString().length).toBeLessThanOrEqual(8192);
  expect(wikiGuideReturnRoute(params.toString())).toBe('/situation?' + params);
  expect(wikiGuideIssueRoute(hit, value)).not.toBeNull();
});
