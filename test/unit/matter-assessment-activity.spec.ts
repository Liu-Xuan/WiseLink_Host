import {
  activityCursor,
  readActivityCursor,
  projectMatterActivity,
} from '../../server/modules/canonical-host/matter-assessment-activity';

const scope = { tenantId: 't', actorUserId: 'a', matterId: 'm' };
const source = {
  kind: 'MATTER_SOURCE_PAGES_READ',
  observedAt: '2026-09-22T00:00:00Z',
  reading: {
    documentVersionId: 'dv',
    pages: [{ page: 1, text: 'PRIVATE', evidence: { excerpt: 'PRIVATE' } }],
  },
  purpose: 'PRIVATE',
  checkpoint: 'PRIVATE',
};
const save = {
  kind: 'MATTER_JOBAID_WORK_SAVED',
  requestId: 'r',
  workRevisionRef: 'w',
  proposal: 'PRIVATE',
};

describe('Matter activity safe projection', () => {
  it('keeps stable raw sequences, real repeated reads and separate omission counts across pages', () => {
    const raw = JSON.stringify([
      source,
      { kind: 'FUTURE_PRIVATE_EVENT', text: 'PRIVATE' },
      save,
      save,
      source,
    ]);
    const first = projectMatterActivity(raw, 0, 3);
    expect(first.items.map((item) => item.sequence)).toEqual([1, 3]);
    expect(first.items[1].occurredAt).toBeNull();
    expect(first.unknownOmittedCount).toBe(1);
    expect(first.nextOffset).toBe(3);
    const second = projectMatterActivity(raw, first.nextOffset!, 3);
    expect(second.items.map((item) => item.sequence)).toEqual([5]);
    expect(second).toMatchObject({
      omittedEarlierCount: 3,
      duplicateOmittedCount: 1,
      hasMore: false,
      nextOffset: null,
    });
    expect(JSON.stringify([first, second])).not.toContain('PRIVATE');
    expect(JSON.stringify(first)).not.toContain('proposal');
    expect(JSON.stringify(first)).not.toContain('checkpoint');
  });
  it('reports corrupt known items without erasing valid receipts, and never fabricates timestamps', () => {
    const page = projectMatterActivity(
      JSON.stringify([
        null,
        { ...source, observedAt: 'broken' },
        save,
        {
          kind: 'MATTER_ORIGINAL_BOUND',
          documentVersionId: 'dv',
          parseRunId: 'run',
          context: 'PRIVATE',
        },
      ]),
      0,
      50,
    );
    expect(page.malformedCount).toBe(2);
    expect(page.error).toBe('ACTIVITY_ITEMS_UNREADABLE');
    expect(page.items.map((item) => item.sequence)).toEqual([3, 4]);
    expect(page.items.every((item) => item.occurredAt === null)).toBe(true);
    expect(projectMatterActivity('{', 0, 50).error).toBe('ACTIVITY_UNREADABLE');
    expect(projectMatterActivity('{}', 0, 50).error).toBe(
      'ACTIVITY_UNREADABLE',
    );
  });
  it('limits by raw receipts even if the whole page is unknown', () => {
    const raw = JSON.stringify(
      Array.from({ length: 205 }, () => ({ kind: 'FUTURE' })),
    );
    expect(projectMatterActivity(raw, 0, 100)).toMatchObject({
      items: [],
      unknownOmittedCount: 100,
      nextOffset: 100,
    });
    expect(() => projectMatterActivity(raw, 0, 101)).toThrow();
    expect(() => projectMatterActivity(raw, 206, 10)).toThrow();
  });
  it('binds cursors to actor, tenant, subject, exact selector and attempt', () => {
    const cursor = activityCursor(
      scope,
      { workRef: 'w' },
      { attemptRef: 'aq', offset: 50 },
    );
    expect(readActivityCursor(scope, { workRef: 'w', cursor })).toEqual({
      attemptRef: 'aq',
      offset: 50,
    });
    for (const other of [
      { ...scope, tenantId: 'other' },
      { ...scope, actorUserId: 'other' },
      { ...scope, matterId: 'other' },
    ])
      expect(() =>
        readActivityCursor(other, { workRef: 'w', cursor }),
      ).toThrow();
    expect(() =>
      readActivityCursor(scope, { workRef: 'other', cursor }),
    ).toThrow();
    expect(() => readActivityCursor(scope, { cursor })).toThrow();
    expect(() =>
      readActivityCursor(scope, { attemptRef: 'a', workRef: 'w' }),
    ).toThrow();
    expect(() => readActivityCursor(scope, { cursor: '%' })).toThrow();
    const exact = activityCursor(
      scope,
      { attemptRef: 'a' },
      { attemptRef: 'b', offset: 0 },
    );
    expect(() =>
      readActivityCursor(scope, { attemptRef: 'a', cursor: exact }),
    ).toThrow();
  });
  it('whitelists original and correction receipts without leaking nested payloads', () => {
    const raw = JSON.stringify([
      {
        kind: 'MATTER_ORIGINAL_READ',
        reading: {
          documentVersionId: 'dv',
          binding: { parseRunId: 'pr' },
          offset: 4,
          units: ['PRIVATE'],
          evidence: ['PRIVATE'],
          semanticMap: 'PRIVATE',
        },
      },
      {
        kind: 'MATTER_REGISTERED_SOURCES_READ',
        sourceRefs: ['PRIVATE'],
        evidence: ['PRIVATE'],
      },
      {
        kind: 'MATTER_ISSUE_CORRECTION_STARTED',
        requestId: 'r',
        context: 'PRIVATE',
        request: 'PRIVATE',
      },
      {
        kind: 'MATTER_ISSUE_CORRECTION_GENERATED',
        requestId: 'r',
        result: 'PRIVATE',
      },
      {
        kind: 'MATTER_CORRECTION_UNCHANGED',
        requestId: 'r',
        workRevisionRef: 'w',
      },
    ]);
    const page = projectMatterActivity(raw, 0, 50);
    expect(page.items).toHaveLength(5);
    expect(page.items[0]).toMatchObject({
      unitOffset: 4,
      unitCount: 1,
      parseRunId: 'pr',
    });
    expect(JSON.stringify(page)).not.toContain('PRIVATE');
  });
});
