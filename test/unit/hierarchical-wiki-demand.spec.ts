import type {
  DerivedSummaryMember,
  DerivedSummaryScopeSelection,
} from '@shared/derived-summary.interface';
import {
  emptyWikiDemand,
  mergeWikiDemand,
  completeWikiDemand,
  wikiDue,
  wikiDemandState,
  wikiScopeKey,
  type WikiDemand,
  type WikiVersions,
} from '@server/modules/canonical-host/hierarchical-wiki-demand';

const at = (minutes: number): string =>
  new Date(Date.parse('2026-10-13T01:00:00Z') + minutes * 60_000).toISOString();
const doc: DerivedSummaryMember = {
  kind: 'DOCUMENT_READING',
  documentVersionId: 'DV-1',
  parseRunId: 'PR-1',
  readingRunRef: 'READ-1',
  readingRevision: 1,
  semanticRevision: 1,
};
const matter: DerivedSummaryMember = {
  kind: 'MATTER_WORK',
  matterId: 'MAT-1',
  workRef: 'MW-1',
  workRevision: 1,
  issueKeys: [],
};
const versions: WikiVersions = {
  'DOCUMENT_FAMILY:F-1': doc,
  'MATTER:MAT-1': matter,
};
const waiting: WikiDemand['waiting'] = [
  {
    kind: 'MATTER',
    subjectId: 'MAT-1',
    requestId: 'REQ-2',
    documentVersionId: 'DV-1',
    status: 'RUNNING',
  },
];
const initial = (): WikiDemand =>
  mergeWikiDemand(emptyWikiDemand(), {
    versions,
    waiting: [],
    kind: 'ATA4',
    now: at(0),
  });
const active = (state: WikiDemand): WikiDemand => ({
  ...state,
  active: {
    requestId: 'R-1',
    attemptRef: 'AQ-1',
    generation: state.desiredGeneration,
    versions: state.versions,
    waiting: state.waiting,
  },
});

test('stable scope identity ignores title/reason but distinguishes family, model and chapter', () => {
  const scope: DerivedSummaryScopeSelection = {
    kind: 'ATA4',
    title: '一',
    fleetFamilyId: 'B787',
    fleetModelIds: [],
    ata2: '46',
    ata4: '46-00',
    selectionReason: '初次',
  };
  expect(wikiScopeKey(scope)).toBe(
    wikiScopeKey({ ...scope, title: '二', selectionReason: '更新' }),
  );
  expect(wikiScopeKey(scope)).not.toBe(
    wikiScopeKey({ ...scope, fleetModelIds: ['B787-9'] }),
  );
  expect(() =>
    wikiScopeKey({ ...scope, fleetModelIds: ['B787-8', 'B787-9'] }),
  ).toThrow('WIKI_SINGLE_FLEET_SCOPE_REQUIRED');
});
test('duplicate versions and JSONB property ordering cause zero new generation', () => {
  const state = initial();
  const reordered = JSON.parse(
    JSON.stringify(versions),
    (key, value: unknown) => value,
  );
  expect(
    mergeWikiDemand(state, {
      versions: reordered,
      waiting: [],
      kind: 'ATA4',
      now: at(2),
    }).desiredGeneration,
  ).toBe(1);
  expect(wikiDue(state, 'ATA4', at(4))).toBe(false);
  expect(wikiDue(state, 'ATA4', at(5))).toBe(true);
});
test('real upstream completion releases the original deadline and merges new document+matter once', () => {
  const state = mergeWikiDemand(emptyWikiDemand(), {
    versions,
    waiting,
    kind: 'ATA4',
    now: at(0),
  });
  expect(wikiDue(state, 'ATA4', at(10))).toBe(false);
  const next = mergeWikiDemand(state, {
    versions: {
      ...versions,
      'MATTER:MAT-1': { ...matter, workRef: 'MW-2', workRevision: 2 },
    },
    waiting: [],
    kind: 'ATA4',
    now: at(8),
    dependencyCompleted: true,
  });
  expect(next.dueAt).toBe(state.dueAt);
  expect(wikiDue(next, 'ATA4', at(8))).toBe(true);
  const completed = completeWikiDemand(
    active(next),
    'R-1',
    next.versions,
    at(9),
  );
  expect(wikiDemandState(completed)).toBe('CURRENT');
  expect(wikiDue(completed, 'ATA4', at(200))).toBe(false);
});
test('maximum waiting permits qualified partial coverage and unchanged failure never re-generates', () => {
  const state = mergeWikiDemand(emptyWikiDemand(), {
    versions,
    waiting,
    kind: 'ATA4',
    now: at(0),
  });
  expect(wikiDue(state, 'ATA4', at(119))).toBe(false);
  expect(wikiDue(state, 'ATA4', at(120))).toBe(true);
  const partial = completeWikiDemand(active(state), 'R-1', versions, at(121));
  expect(partial.completedGeneration).toBe(0);
  expect(wikiDemandState(partial)).toBe('PARTIAL');
  expect(wikiDue(partial, 'ATA4', at(400))).toBe(false);
});
test('uncited members remain pending without an empty-tick model loop', () => {
  const state = initial();
  const partial = completeWikiDemand(
    active(state),
    'R-1',
    { 'DOCUMENT_FAMILY:F-1': doc },
    at(6),
  );
  expect(partial.completedGeneration).toBe(0);
  expect(wikiDemandState(partial)).toBe('PARTIAL');
  expect(wikiDue(partial, 'ATA4', at(60))).toBe(false);
});
test('new inputs during running retain their own generation after the old snapshot saves', () => {
  const running = active(initial());
  const added = mergeWikiDemand(running, {
    versions: {
      ...versions,
      other: { ...doc, documentVersionId: 'DV-2', readingRunRef: 'READ-2' },
    },
    waiting: [],
    kind: 'ATA4',
    now: at(3),
  });
  expect(added.active).toEqual(running.active);
  const saved = completeWikiDemand(added, 'R-1', versions, at(6));
  expect(saved.completedGeneration).toBe(1);
  expect(saved.desiredGeneration).toBe(2);
  expect(wikiDemandState(saved)).toBe('PENDING');
});
test('important inputs cannot be postponed by a later ordinary input', () => {
  const important = mergeWikiDemand(initial(), {
    versions: { ...versions, next: doc },
    waiting: [],
    kind: 'ATA4',
    now: at(2),
    important: true,
  });
  const ordinary = mergeWikiDemand(important, {
    versions: { ...important.versions, more: doc },
    waiting: [],
    kind: 'ATA4',
    now: at(3),
  });
  expect(ordinary.dueAt).toBe(important.dueAt);
});
test('continuous ordinary changes retain the first dirty maximum instead of deferring forever', () => {
  let state = completeWikiDemand(active(initial()), 'R-1', versions, at(6));
  for (let index = 1; index <= 20; index++)
    state = mergeWikiDemand(state, {
      versions: {
        ...versions,
        'DOCUMENT_FAMILY:F-1': {
          ...doc,
          readingRunRef: `READ-${index + 1}`,
          readingRevision: index + 1,
        },
      },
      waiting: [],
      kind: 'ATA4',
      now: at(10 * index),
    });
  expect(state.firstDirtyAt).toBe(at(10));
  expect(state.dueAt).toBe(at(130));
});
test('verified unchanged dependency completion can clear pending with no new body', () => {
  const state = completeWikiDemand(
    active(
      mergeWikiDemand(emptyWikiDemand(), {
        versions,
        waiting,
        kind: 'ATA4',
        now: at(0),
      }),
    ),
    'R-1',
    versions,
    at(121),
  );
  const resolved = mergeWikiDemand(state, {
    versions,
    waiting: [],
    kind: 'ATA4',
    now: at(122),
    dependencyCompleted: true,
  });
  expect(wikiDemandState(resolved)).toBe('CURRENT');
  expect(wikiDue(resolved, 'ATA4', at(200))).toBe(false);
});

test('one explicit rebuild preserves the saved scope and consumes its generation once', () => {
  const saved = completeWikiDemand(active(initial()), 'R-1', versions, at(6));
  const requested = {
    ...saved,
    desiredGeneration: 2,
    forceGeneration: 2,
    firstDirtyAt: at(7),
    dueAt: at(7),
  };
  expect(requested.lastGenerated).toEqual(versions);
  expect(wikiDemandState(requested)).toBe('PENDING');
  expect(wikiDue(requested, 'ATA4', at(7))).toBe(true);
  const complete = completeWikiDemand(
    active(requested),
    'R-1',
    versions,
    at(8),
  );
  expect(complete.forceGeneration).toBeNull();
  expect(wikiDue(complete, 'ATA4', at(9))).toBe(false);
});

test('a second explicit rebuild during the active one remains pending after the older save', () => {
  const running = active({
    ...initial(),
    desiredGeneration: 2,
    forceGeneration: 2,
  });
  const requested = { ...running, desiredGeneration: 3, forceGeneration: 3 };
  const complete = completeWikiDemand(requested, 'R-1', versions, at(8));
  expect(complete.forceGeneration).toBe(3);
  expect(complete.lastGenerated).toEqual(versions);
  expect(wikiDue(complete, 'ATA4', at(9))).toBe(true);
});
