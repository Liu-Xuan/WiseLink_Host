import {
  activityReadingParams,
  libraryReadingParams,
  readingReturnTarget,
  withSourceReadingReturn,
} from '@client/src/features/matter/reading-return';
import { documentGraphReadingParams } from '@client/src/pages/RelationGraphPage/suite-graph-return';

const directory = new URLSearchParams({
  mode: 'document',
  familyId: 'family-original',
  selectedDocumentVersionId: 'DV-original',
  expandedFamilyIds: 'family-z,family-a',
  listY: '735',
  quicklookY: '83',
  search: '737MAX-FTD-34-17005',
  normalizedFamily: 'FTD',
  ata2: '34',
});
const source = (route: string) => new URL(route, 'https://example.test');

test('global entry keeps original selection/filter/scroll while binding the destination exact version', () => {
  const route = source(
    withSourceReadingReturn(
      '/work-items/WI-target/analysis?panel=reader&documentVersionId=DV-target&sourceRef=SRC-OLD',
      '/library',
      directory,
    ),
  );
  expect(route.pathname).toBe('/work-items/WI-target/analysis');
  expect(route.searchParams.get('sourceRef')).toBe('SRC-OLD');
  expect(route.searchParams.get('returnDocumentVersionId')).toBe('DV-target');
  expect(readingReturnTarget(route.searchParams, 'DV-target')?.route).toBe(
    `/library?${libraryReadingParams(directory)}`,
  );
  expect(readingReturnTarget(route.searchParams, 'DV-original')).toBeNull();
});

test('bound directory return survives activity discovery, window and source-reader serialization', () => {
  const first = source(
    withSourceReadingReturn(
      '/activity-graph?documentVersionId=DV-target',
      '/library',
      directory,
    ),
  );
  const discovery = activityReadingParams(first.searchParams);
  discovery.set('documentVersionId', 'DV-target');
  discovery.set('parseRunId', 'PR-target');
  discovery.set('candidateRevision', '4');
  discovery.set('runRef', 'RUN-target');
  discovery.set('window', 'current-year');
  const replaced = activityReadingParams(discovery);
  expect(replaced.get('returnDocumentVersionId')).toBe('DV-target');
  expect(readingReturnTarget(replaced, 'DV-target', 'PR-target')?.route).toBe(
    `/library?${libraryReadingParams(directory)}`,
  );
});

test.each([
  'mode=document&selectedDocumentVersionId=DV-original&selectedDocumentVersionId=DV-other',
  'mode=document&selectedDocumentVersionId=DV-original%0A',
  'mode=document&selectedMatterId=MAT-foreign',
  'mode=document&returnWorkItemId=WI-foreign',
  'https://outside.example/library?selectedDocumentVersionId=DV-original',
])('global entry keeps malformed directory intent rejected: %s', (raw) => {
  const route = source(
    withSourceReadingReturn(
      '/timeline?documentVersionId=DV-target',
      '/library',
      new URLSearchParams(raw),
    ),
  );
  expect(route.searchParams.has('returnLibraryQuery')).toBe(true);
  expect(readingReturnTarget(route.searchParams, 'DV-target')).toBeNull();
  expect(
    readingReturnTarget(activityReadingParams(route.searchParams), 'DV-target'),
  ).toBeNull();
});

test.each([
  'duplicate',
  'wrong-version',
  'conflicting',
  'foreign-field',
  'padded-binding',
] as const)('reader-to-global entry cannot repair %s return pins', (kind) => {
  const origin = new URLSearchParams({
    documentVersionId: 'DV-original',
    returnDocumentVersionId: 'DV-original',
    returnLibraryQuery: directory.toString(),
  });
  if (kind === 'duplicate')
    origin.append('returnLibraryQuery', directory.toString());
  if (kind === 'wrong-version')
    origin.set('returnDocumentVersionId', 'DV-foreign');
  if (kind === 'conflicting') origin.set('returnWorkItemId', 'WI-foreign');
  if (kind === 'foreign-field')
    origin.set('returnUrl', 'https://outside.example');
  if (kind === 'padded-binding')
    origin.set('returnDocumentVersionId', ' DV-original ');
  const route = source(
    withSourceReadingReturn(
      '/activity-graph?documentVersionId=DV-original',
      '/work-items/WI-original/analysis',
      origin,
    ),
  );
  expect(readingReturnTarget(route.searchParams, 'DV-original')).toBeNull();
  expect(
    readingReturnTarget(
      activityReadingParams(route.searchParams),
      'DV-original',
    ),
  ).toBeNull();
});

test.each([
  'https://outside.example/document-versions/DV-target',
  '//outside.example/document-versions/DV-target',
  '/settings/models?documentVersionId=DV-target',
  '/work-items/WI-target/analysis?documentVersionId=DV-target&documentVersionId=DV-other',
  '/work-items/WI-target/analysis?documentVersionId=%20DV-target%20',
])(
  'return decoration does not admit an unregistered or ambiguous destination: %s',
  (route) => {
    expect(withSourceReadingReturn(route, '/library', directory)).toBe(route);
  },
);

test('a destination explicit return is preserved and a version-mismatched binding stays rejected', () => {
  const route =
    '/document-versions/DV-target?returnDocumentVersionId=DV-foreign&returnLibraryQuery=mode%3Ddocument';
  expect(withSourceReadingReturn(route, '/library', directory)).toBe(route);
  expect(
    readingReturnTarget(source(route).searchParams, 'DV-target'),
  ).toBeNull();
});

test('new global consumers retain the existing P2 rejection inside a nested document graph', () => {
  const graph = documentGraphReadingParams(
    'DV-original',
    'WI-original',
    {},
    new URLSearchParams({
      returnDocumentVersionId: 'DV-original',
      returnLibraryQuery:
        'mode=document&selectedDocumentVersionId=DV-original&selectedDocumentVersionId=DV-foreign',
    }),
  );
  const reader = source(
    withSourceReadingReturn(
      '/work-items/WI-target/analysis?panel=reader&documentVersionId=DV-target',
      '/graph',
      graph,
    ),
  );
  const returned = readingReturnTarget(reader.searchParams, 'DV-target')!;
  const original = source(returned.route);
  expect(original.searchParams.has('returnLibraryQuery')).toBe(true);
  expect(readingReturnTarget(original.searchParams, 'DV-original')).toBeNull();
});

test('ordinary unpinned entries and existing task-directory return mode stay compatible', () => {
  expect(
    withSourceReadingReturn(
      '/document-versions/DV-target',
      '/knowledge',
      new URLSearchParams(),
    ),
  ).toBe('/document-versions/DV-target');
  const route = source(
    withSourceReadingReturn(
      '/document-versions/DV-target',
      '/library',
      new URLSearchParams({
        mode: 'tasks',
        workItemId: 'WI-original',
        listY: '112',
      }),
    ),
  );
  expect(readingReturnTarget(route.searchParams, 'DV-target')?.route).toBe(
    '/library?listY=112&mode=tasks&workItemId=WI-original',
  );
  const legacy = new URLSearchParams({
    documentVersionId: 'DV-original',
    returnLibraryQuery: 'mode=document',
  });
  const retained = source(
    withSourceReadingReturn(
      '/activity-graph?documentVersionId=DV-original',
      '/timeline',
      legacy,
    ),
  );
  expect(retained.searchParams.get('returnLibraryQuery')).toBe('mode=document');
  expect(readingReturnTarget(retained.searchParams, 'DV-original')).toBeNull();
});

test('graph rejection keeps explicit return intent through repeated activity serialization', () => {
  const origin = new URLSearchParams({
    documentVersionId: 'DV-original',
    returnDocumentVersionId: 'DV-foreign',
    returnGraphQuery: 'scope=document&documentVersionId=DV-original',
  });
  const entered = source(
    withSourceReadingReturn(
      '/activity-graph?documentVersionId=DV-original',
      '/document-versions/DV-original',
      origin,
    ),
  );
  expect(readingReturnTarget(entered.searchParams, 'DV-original')).toBeNull();
  let params = entered.searchParams;
  for (let index = 0; index < 2; index += 1) {
    params = activityReadingParams(params);
    params.set('parseRunId', 'PR-original');
    params.set('documentVersionId', 'DV-original');
    expect(params.has('returnGraphQuery')).toBe(true);
    expect(
      readingReturnTarget(params, 'DV-original', 'PR-original'),
    ).toBeNull();
  }
});
