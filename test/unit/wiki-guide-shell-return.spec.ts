import { readingReturnTarget, knowledgeReadingParams, knowledgeReadingReturnRoute } from '@client/src/features/matter/reading-return';
import { summaryReadingRoute } from '@client/src/features/derived-summary/summary-selection';
import { wikiGuideStateParams, wikiGuideReturnRoute } from '@client/src/lib/wiki-guide-route';

const guide = new URLSearchParams({ wikiRoot: 'DS-11111111-1111-4111-8111-111111111111', wikiChapter: 'DS-22222222-2222-4222-8222-222222222222', wikiQuery: '软件', wikiY: '352' }).toString();

test('Wiki toolbar accepts a directory return independently of the selected work origin', () => {
  const knowledge = new URLSearchParams({ subjectKind: 'WORK_ITEM', subjectId: 'WI-original', workRef: 'JAWR-4', kind: 'works', articleY: '73' });
  const params = new URLSearchParams({ returnKnowledgeQuery: knowledge.toString() });
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/summaries/DS-other'))
    .toEqual({ route: `/knowledge?${knowledgeReadingParams(knowledge)}`, label: '返回工程知识' });
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/graph')).toBeNull();
});

test('guide return is fixed read-only state for summary and exact saved-work readers', () => {
  const params = new URLSearchParams({ returnWikiGuideQuery: guide });
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/summaries/DS-chapter'))
    .toMatchObject({ route: expect.stringContaining('/situation?'), label: '返回 Wiki 导览' });
  params.set('subjectKind', 'WORK_ITEM'); params.set('subjectId', 'WI-1'); params.set('workRef', 'JAWR-1');
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/knowledge')).not.toBeNull();
  params.delete('workRef');
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/knowledge')).toBeNull();
});

test('document return remains bound to its actual destination version', () => {
  const params = new URLSearchParams({ returnWikiGuideQuery: guide, returnDocumentVersionId: 'DV-one' });
  expect(readingReturnTarget(params, 'DV-one', null, undefined, undefined, '/document-versions/DV-one')).not.toBeNull();
  expect(readingReturnTarget(params, 'DV-two', null, undefined, undefined, '/document-versions/DV-two')).toBeNull();
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/summaries/DS-one')).toBeNull();
  params.append('returnDocumentVersionId', 'DV-one');
  expect(readingReturnTarget(params, 'DV-one', null, undefined, undefined, '/document-versions/DV-one')).toBeNull();
});

test.each(['returnKnowledgeQuery', 'returnGraphQuery', 'returnLibraryGraphQuery', 'returnSituationQuery', 'returnMatterId'])
('guide rejects conflicting %s instead of choosing an arbitrary return', conflict => {
  const params = new URLSearchParams({ returnWikiGuideQuery: guide, [conflict]: 'anything' });
  expect(readingReturnTarget(params, undefined, null, undefined, undefined, '/summaries/DS-one')).toBeNull();
});

test('no guide return reaches creation, graph or an external location', () => {
  for (const path of ['/summaries/new', '/summaries/DS-one/update', '/graph', '/situation', 'https://external.invalid']) {
    expect(readingReturnTarget(new URLSearchParams({ returnWikiGuideQuery: guide }), undefined, null, undefined, undefined, path)).toBeNull();
  }
  const unknown = new URLSearchParams({ returnKnowledgeQuery: 'subjectKind=WORK_ITEM&subjectId=WI-1&workRef=JAWR-1&execute=1' });
  expect(knowledgeReadingReturnRoute(unknown)).toBeNull();
});

test('internal child Wiki, saved work and document links retain the same guide selection', () => {
  const params = new URLSearchParams({ returnWikiGuideQuery: guide });
  for (const route of ['/summaries/DS-child?summaryRef=DSR-older', '/knowledge?subjectKind=WORK_ITEM&subjectId=WI-1&workRef=JAWR-1', '/document-versions/DV-one?parseRunId=PRUN-one']) {
    const result = new URL(summaryReadingRoute(route, params), 'https://test.invalid');
    expect(result.searchParams.get('returnWikiGuideQuery')).toBe(guide);
    if (result.pathname.startsWith('/document-versions/')) expect(result.searchParams.get('returnDocumentVersionId')).toBe('DV-one');
  }
  expect(summaryReadingRoute('/summaries/DS-one/update', params)).toBe('/summaries/DS-one/update');
});

test('saved-work source return can retain a validated guide return without recursive destinations', () => {
  const state = new URLSearchParams({ subjectKind: 'WORK_ITEM', subjectId: 'WI-1', workRef: 'JAWR-1', returnWikiGuideQuery: guide });
  const safe = knowledgeReadingParams(state);
  expect(safe.get('returnWikiGuideQuery')).toBe(guide);
  expect(knowledgeReadingReturnRoute(new URLSearchParams({ returnKnowledgeQuery: safe.toString() }))).toContain('returnWikiGuideQuery=');
  state.set('returnWikiGuideQuery', 'returnUrl=https://external.invalid');
  expect(knowledgeReadingParams(state).has('returnWikiGuideQuery')).toBe(false);
});

test('an exact second-page return survives the work and source nesting at supported cursor and search bounds', () => {
  const saved = wikiGuideStateParams({ rootSummaryId: 'DS-11111111-1111-4111-8111-111111111111',
    chapterSummaryId: 'DS-22222222-2222-4222-8222-222222222222', search: '软件'.repeat(100), scrollTop: 352,
    page: { kind: 'ISSUES', after: 'A'.repeat(4000), anchor: JSON.stringify(['WORK_ITEM', 'WI-1', 'JAWR-1', 'issue-2']), offset: 28 },
  }).toString();
  expect(saved.length).toBeGreaterThan(4096);
  expect(wikiGuideReturnRoute(saved)).not.toBeNull();
  const state = new URLSearchParams({ subjectKind: 'WORK_ITEM', subjectId: 'WI-1', workRef: 'JAWR-1', returnWikiGuideQuery: saved });
  const safe = knowledgeReadingParams(state);
  expect(safe.get('returnWikiGuideQuery')).toBe(saved);
  const nested = new URLSearchParams({ returnKnowledgeQuery: safe.toString() });
  expect(safe.toString().length).toBeLessThanOrEqual(8192);
  const route = knowledgeReadingReturnRoute(nested);
  expect(route).not.toBeNull();
  expect(new URL(route!, 'https://test.invalid').searchParams.get('returnWikiGuideQuery')).toBe(saved);
});
