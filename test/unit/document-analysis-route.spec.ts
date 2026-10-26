import { documentVersionAnalysisRoute, libraryDocumentAssessmentRoute,
  libraryTaskAnalysisRoute, readDocumentWorkItemLocator } from '../../client/src/pages/DocumentParsingPage/document-analysis-route';
import { documentAssessmentReturnParams, documentAssessmentReturnTarget } from '../../client/src/pages/DocumentParsingPage/document-workbench-panel';
import { readingReturnTarget } from '../../client/src/features/matter/reading-return';
import type { WorkbenchNode } from '../../client/src/pages/DocumentParsingPage/document-parsing-navigation';

it.each<[WorkbenchNode, string, string | null]>([
  ['assessment', 'assessment', null], ['review', 'assessment', 'review'],
  ['overall', 'assessment', 'process'], ['aeo', 'assessment', 'aeo'],
  ['reader', 'reader', null], ['package', 'reader', null], ['document', 'reader', null],
])('maps old %s into the exact version workspace with source and return state', (panel, expectedPanel, tab) => {
  const state = new URLSearchParams({ parseRunId: 'PARSE-OLD', sourceRef: 'SOURCE-OLD',
    documentVersionId: 'DV/OLD', returnDocumentVersionId: 'DV/OLD',
    returnLibraryQuery: 'familyId=F&listY=643&mode=tasks&workItemId=WI-RETURN' });
  const url = new URL(documentVersionAnalysisRoute('DV/OLD', 'WI/OLD', panel, state), 'https://example.invalid');
  expect(url.pathname).toBe('/document-versions/DV%2FOLD');
  expect(url.searchParams.get('workItemId')).toBe('WI/OLD');
  expect(url.searchParams.get('panel')).toBe(expectedPanel);
  expect(url.searchParams.get('assessmentTab')).toBe(tab);
  expect(url.searchParams.get('parseRunId')).toBe('PARSE-OLD');
  expect(url.searchParams.get('sourceRef')).toBe('SOURCE-OLD');
  expect(readingReturnTarget(url.searchParams, 'DV/OLD')?.route)
    .toBe('/library?familyId=F&listY=643&mode=tasks&workItemId=WI-RETURN');
});

it('retains the actual task separately from its directory return selection and maps a review criterion', () => {
  const url = new URL(libraryTaskAnalysisRoute('DV-OLD', 'WI-OLD', 'review',
    new URLSearchParams('familyId=F&listY=643&workItemId=WI-DIRECTORY')), 'https://example.invalid');
  expect(url.searchParams.get('workItemId')).toBe('WI-OLD');
  expect(new URLSearchParams(url.searchParams.get('returnLibraryQuery')!).get('workItemId')).toBe('WI-OLD');
  const review = new URL(documentVersionAnalysisRoute('DV-OLD', 'WI-OLD', 'review',
    new URLSearchParams('criterion=JAC-1')), 'https://example.invalid');
  expect(review.searchParams.get('assessmentCriterion')).toBe('JAC-1');
  const document = new URL(libraryDocumentAssessmentRoute('DV-HISTORY', 'WI-HISTORY',
    new URLSearchParams('mode=document&familyId=F&listY=643')), 'https://example.invalid');
  expect(document.searchParams.get('workItemId')).toBe('WI-HISTORY');
  expect(document.searchParams.get('returnLibraryQuery')).toContain('selectedDocumentVersionId=DV-HISTORY');
});

it.each(['documentVersionId=FOREIGN', 'documentVersionId=DV&documentVersionId=DV',
  'workItemId=FOREIGN', 'workItemId=WI&workItemId=WI', 'panel=review&panel=assessment',
  'parseRunId=P1&parseRunId=P2', 'parseRunId=', 'sourceRef=%20BROKEN',
  'returnLibraryQuery=one&returnLibraryQuery=two'])(
  'rejects conflicting or ambiguous navigation %s', query => {
    expect(() => documentVersionAnalysisRoute('DV', 'WI', 'assessment', new URLSearchParams(query))).toThrow();
  });

it('never treats the nested directory task as the assessment locator', () => {
  expect(readDocumentWorkItemLocator(new URLSearchParams('returnLibraryQuery=mode%3Dtasks%26workItemId%3DWI-RETURN')))
    .toEqual({ workItemId: null, error: null });
  for (const query of ['workItemId=', 'workItemId=WI&workItemId=WI', 'workItemId=%20WI'])
    expect(readDocumentWorkItemLocator(new URLSearchParams(query))).toEqual({ workItemId: null, error: expect.any(String) });
});

it('returns from a related work through the same explicit assessment task and exact directory state', () => {
  const state = new URLSearchParams({ workItemId: 'WI-OLD', panel: 'assessment', assessmentTab: 'investigation',
    returnDocumentVersionId: 'DV-OLD', returnLibraryQuery: 'mode=tasks&workItemId=WI-RETURN&listY=643' });
  const source = documentAssessmentReturnParams('DV-OLD', state, { workItemId: 'WI-SOURCE' }, 248);
  const target = documentAssessmentReturnTarget(source, 'DV-SOURCE', 'WI-SOURCE');
  const url = new URL(target!.route, 'https://example.invalid');
  expect(url.pathname).toBe('/document-versions/DV-OLD');
  expect(url.searchParams.get('workItemId')).toBe('WI-OLD');
  expect(url.searchParams.get('assessmentScroll')).toBe('248');
  expect(url.searchParams.get('returnLibraryQuery')).toContain('WI-RETURN');
});
