import { PgDialect } from 'drizzle-orm/pg-core';
import type {
  DerivedSummaryMember,
  DerivedSummaryRevision,
} from '@shared/derived-summary.interface';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import {
  completeSavedWiki,
  type WikiRow,
} from '../../server/modules/canonical-host/hierarchical-wiki.persistence';
import {
  emptyWikiDemand,
  wikiDue,
  wikiScopeKey,
} from '../../server/modules/canonical-host/hierarchical-wiki-demand';
import {
  readWikiInventory,
  wikiScopeFor,
} from '../../server/modules/canonical-host/hierarchical-wiki-inventory';
import { assertWikiLayerMembers, wikiDirectVersions } from '../../server/modules/canonical-host/hierarchical-wiki-generation';

jest.mock(
  '../../server/modules/canonical-host/hierarchical-wiki-inventory',
  () => ({
    ...jest.requireActual(
      '../../server/modules/canonical-host/hierarchical-wiki-inventory',
    ),
    readWikiInventory: jest.fn(async () => ({
      items: [],
      removed: [],
      waiting: [],
      complete: true,
      cursor: null,
    })),
  }),
);

const owner = { tenantId: 'layer-tenant', actorUserId: 'layer-actor' };
const target = { fleetFamilyId: 'B787', fleetModelId: null };
const at = (minute: number) =>
  new Date(Date.parse('2026-10-14T00:00:00Z') + minute * 60_000).toISOString();
const doc = {
  kind: 'DOCUMENT_READING',
  documentVersionId: 'DV-leaf',
  parseRunId: 'PR-leaf',
  semanticRevision: 2,
  readingRunRef: 'DRR-leaf',
  readingRevision: 3,
} satisfies DerivedSummaryMember;
const matter = {
  kind: 'MATTER_WORK',
  matterId: 'MAT-leaf',
  workRef: 'MWR-leaf',
  workRevision: 4,
  issueKeys: [],
} satisfies DerivedSummaryMember;
const pointer = (id: string, revision = 1): DerivedSummaryMember => ({
  kind: 'DERIVED_SUMMARY',
  summaryId: `DS-${id}`,
  summaryRef: `DSR-${id}-${revision}`,
  summaryRevision: revision,
});

/** Real refresh and SAVE branch/CAS functions, with deterministic local SQL
 * rows. No physical PostgreSQL, remote source or model is involved. */
function setup(discoveredWorkItemId?: string) {
  const rows = [null, '46', '46-00'].map(
    (ata, index): WikiRow => ({
      wikiId: `WIKI-${index}`,
      summaryId: `DS-${index}`,
      ...owner,
      scope: wikiScopeFor(target, ata),
      parentWikiId: index ? `WIKI-${index - 1}` : null,
      principalId: 'layer-principal',
      modelRef: 'miaoda/glm-5.3',
      enabled: true,
      state: emptyWikiDemand(),
      lastEventSeq: '0',
      lastInventoryAt: at(0),
      inventoryCursor: null,
      upstreamDelegations: {},
    }),
  );
  const memberships = new Map<
    string,
    Array<{ key: string; member: DerivedSummaryMember }>
  >([
    [
      'WIKI-0',
      [
        {
          key: 'DOCUMENT_FAMILY:coarse-fleet',
          member: { ...doc, documentVersionId: 'DV-coarse-fleet' },
        },
      ],
    ],
    [
      'WIKI-1',
      [
        {
          key: 'MATTER:coarse-ata2',
          member: { ...matter, matterId: 'MAT-coarse-ata2' },
        },
      ],
    ],
    [
      'WIKI-2',
      [
        { key: 'DOCUMENT_FAMILY:leaf', member: doc },
        { key: 'MATTER:leaf', member: matter },
      ],
    ],
  ]);
  for (let index = 2; index >= 0; index--) {
    const versions = {
      ...wikiDirectVersions(rows[index]!.scope.kind, memberships.get(rows[index]!.wikiId)!),
      ...(index < 2 ? { [`SUMMARY:DS-${index + 1}`]: pointer(String(index + 1)) } : {}),
    };
    rows[index]!.state = {
      ...emptyWikiDemand(),
      desiredGeneration: 1,
      completedGeneration: 1,
      versions,
      delivered: structuredClone(versions),
      lastGenerated: structuredClone(versions),
    };
  }
  const heads = new Map(
    rows.map((row) => [
      row.summaryId,
      {
        summaryId: row.summaryId,
        currentRevision: 1,
        currentSummaryRef: `DSR-${row.summaryId.slice(3)}-1`,
      },
    ]),
  );
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const database = {
    execute: jest.fn(
      async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
        const query = dialect.sqlToQuery(statement);
        calls.push(query);
        if (query.sql.includes("SELECT DISTINCT 'WORK_ITEM' AS kind"))
          return discoveredWorkItemId
            ? [{ kind: 'WORK_ITEM', subjectId: discoveredWorkItemId, important: true }]
            : [];
        if (query.sql.includes('SELECT wiki_id AS "wikiId",member_key AS key'))
          return [...memberships].flatMap(([wikiId, items]) =>
            items.map((item) => ({ ...item, wikiId })),
          );
        if (query.sql.includes('derived_summary_reading_sources_owned'))
          return [{ allowed: true }];
        if (
          query.sql.includes('SELECT member_key AS key,member_json AS member')
        )
          return structuredClone(
            memberships.get(query.params[0] as string) ?? [],
          );
        if (
          query.sql.includes('UPDATE hierarchical_wiki_scope SET state_json')
        ) {
          rows.find((row) => row.wikiId === query.params[1])!.state =
            JSON.parse(query.params[0] as string);
          return [];
        }
        if (
          query.sql.includes('SELECT') &&
          query.sql.includes('FROM hierarchical_wiki_scope')
        ) {
          let selected = rows;
          if (query.sql.includes('scope_key='))
            selected = rows.filter((row) =>
              query.params.includes(wikiScopeKey(row.scope)),
            );
          else if (query.sql.includes('parent_wiki_id='))
            selected = rows.filter(
              (row) => row.parentWikiId === query.params.at(-1),
            );
          else if (query.sql.includes('summary_id='))
            selected = rows.filter((row) =>
              query.params.includes(row.summaryId),
            );
          else if (query.sql.includes('WHERE wiki_id='))
            selected = rows.filter((row) => query.params.includes(row.wikiId));
          else if (query.sql.includes("scope_json->>'kind'='FLEET'"))
            selected = [rows[0]!];
          return structuredClone(selected);
        }
        return [];
      },
    ),
  };
  const repository = {
    head: jest.fn(async (id: string) => structuredClone(heads.get(id))),
    browser: jest.fn(async (_actor: unknown, operation: Function) =>
      operation(database, owner),
    ),
  };
  const service = new HierarchicalWikiService(
    database as never,
    repository as never,
    {} as never,
    {} as never,
    {} as never,
    {
      readLibraryCatalog: async () => ({
        status: 'AVAILABLE',
        families: [{ fleetFamily: 'B787', models: [] }],
      }),
    } as never,
    {
      authorizeOpenClawAutoWorkItemQueue: async () => ({
        appId: 'app_17bzc551rsg',
        tenantId: owner.tenantId,
        principalId: 'layer-principal',
      }),
    } as never,
    undefined,
    {
      captureForNewTask: async () => ({
        modelRef: 'miaoda/glm-5.3',
        settingsRevision: 1,
      }),
    } as never,
  );
  Object.assign(service, { readList: jest.fn(async () => ({ items: [] })) });
  return {
    rows,
    heads,
    memberships,
    calls,
    database,
    service,
    refresh: () =>
      service.enable(target, { tenantId: owner.tenantId } as never),
  };
}

test('refresh keeps exact directly classified ATA2 leaves beside saved children without promoting fleet leaves', async () => {
  const f = setup(),
    classifications = structuredClone([...f.memberships]);
  await f.refresh();
  expect(Object.values(f.rows[2]!.state.versions)).toEqual([doc, matter]);
  expect(Object.values(f.rows[1]!.state.versions)).toEqual([{ ...matter, matterId: 'MAT-coarse-ata2' }, pointer('2')]);
  expect(Object.values(f.rows[0]!.state.versions)).toEqual([pointer('1')]);
  expect([...f.memberships]).toEqual(classifications);
  expect(
    f.calls.some((call) =>
      call.sql.includes('DELETE FROM hierarchical_wiki_membership'),
    ),
  ).toBe(false);
});

test('a missing old saved WI head is discovered before the next full inventory without a journal event', async () => {
  const f = setup('WI-old-work13');
  // The old inventory finished before WORK_ITEM leaves were introduced. The
  // existing reading is unchanged; no new save/event or full-sweep deadline.
  f.rows[0]!.lastInventoryAt = new Date().toISOString();
  f.rows[0]!.lastEventSeq = '9';
  jest.mocked(readWikiInventory).mockClear();
  await f.service.update('DS-0', {}, { tenantId: owner.tenantId } as never);
  expect(readWikiInventory).toHaveBeenCalledTimes(1);
  expect(readWikiInventory).toHaveBeenCalledWith(
    f.database,
    owner,
    expect.objectContaining(target),
    [{ kind: 'WORK_ITEM', subjectId: 'WI-old-work13', important: true }],
    null,
    expect.anything(),
  );
  const query = f.calls.find((call) =>
    call.sql.includes("SELECT DISTINCT 'WORK_ITEM' AS kind"),
  )!;
  expect(query.params).toEqual([
    owner.actorUserId, owner.tenantId, owner.actorUserId, 'B787', '[]',
    owner.tenantId, owner.tenantId,
  ]);
  expect(query.sql).toContain("m.basis_json->>'classificationStatus'='CONFIRMED'");
  expect(query.sql).toContain("m.basis_json->>'documentVersionId'=d.document_version_id");
  expect(query.sql).toContain("w.scope_json->>'kind' IN ('ATA4','ATA2')");
  expect(query.sql).toContain('wi.source_file_sha256=d.pdf_sha256');
  expect(query.sql).toContain('ORDER BY r.work_revision DESC LIMIT 1');
  expect(query.sql).toContain('ORDER BY "subjectId" LIMIT 100');
  expect(query.sql).not.toMatch(/content_json|created_by_user_id|a\.actor_user_id/u);
  // Discovery only uses the original inventory; it does not reserve a model or
  // reset a blocked demand before that inventory establishes changed inputs.
  expect(f.calls.some((call) => call.sql.includes('INSERT INTO action_attempt'))).toBe(false);
});

test('unchanged WI heads do not reopen inventory or manufacture another generation', async () => {
  const f = setup();
  f.rows[0]!.lastInventoryAt = new Date().toISOString();
  const before = f.rows.map((row) => structuredClone(row.state));
  jest.mocked(readWikiInventory).mockClear();
  await f.service.update('DS-0', {}, { tenantId: owner.tenantId } as never);
  expect(readWikiInventory).not.toHaveBeenCalled();
  expect(f.rows.map((row) => row.state)).toEqual(before);
});

test('existing assessment waiting rereads the exact DVI without head rediscovery', async () => {
  const f = setup();
  f.rows[0]!.lastInventoryAt = new Date().toISOString();
  f.rows[2]!.state.waiting = [{
    kind: 'DOCUMENT', subjectId: 'F-waiting', documentVersionId: 'DV-waiting',
    requestId: 'saved-partial-request', status: 'SAVED_ASSESSMENT_NOT_READY',
  }];
  jest.mocked(readWikiInventory).mockClear();
  await f.service.update('DS-0', {}, { tenantId: owner.tenantId } as never);
  expect(readWikiInventory).toHaveBeenCalledTimes(1);
  expect(readWikiInventory).toHaveBeenCalledWith(
    f.database, owner, expect.objectContaining(target),
    [{ kind: 'DOCUMENT', subjectId: 'DV-waiting', important: false }],
    null, expect.anything(),
  );
});

test('changed leaf waits at both parents; exact new saved child propagates only one layer per save', async () => {
  const f = setup();
  f.memberships.get('WIKI-2')![0]!.member = {
    ...doc,
    readingRunRef: 'DRR-leaf-new',
    readingRevision: 4,
  } as DerivedSummaryMember;
  await f.refresh();
  expect(f.rows[2]!.state.firstDirtyAt).not.toBeNull();
  expect(f.rows[1]!.state.waiting.map((item) => item.subjectId)).toContain(
    'DS-2',
  );
  expect(f.rows[0]!.state.waiting.map((item) => item.subjectId)).toContain(
    'DS-1',
  );
  expect(Object.values(f.rows[1]!.state.versions)).toEqual([{ ...matter, matterId: 'MAT-coarse-ata2' }, pointer('2')]);
  const beforeMaximumWait = new Date(
    Date.parse(f.rows[1]!.state.firstDirtyAt!) + 239 * 60_000,
  ).toISOString();
  expect(wikiDue(f.rows[1]!.state, 'ATA2', beforeMaximumWait)).toBe(false);
  const leaf = f.rows[2]!;
  leaf.state = {
    ...leaf.state,
    firstDirtyAt: null,
    dueAt: null,
    completedGeneration: leaf.state.desiredGeneration,
    lastGenerated: structuredClone(leaf.state.versions),
    delivered: structuredClone(leaf.state.versions),
  };
  f.heads.set('DS-2', {
    summaryId: 'DS-2',
    currentRevision: 2,
    currentSummaryRef: 'DSR-2-2',
  });
  await f.refresh();
  expect(Object.values(f.rows[1]!.state.versions)).toEqual([{ ...matter, matterId: 'MAT-coarse-ata2' }, pointer('2', 2)]);
  expect(f.rows[1]!.state.waiting).toEqual([]);
  expect(Object.values(f.rows[0]!.state.versions)).toEqual([pointer('1')]);
  expect(f.rows[0]!.state.waiting.map((item) => item.subjectId)).toContain(
    'DS-1',
  );
  const middle = f.rows[1]!;
  middle.state = {
    ...middle.state,
    firstDirtyAt: null,
    dueAt: null,
    completedGeneration: middle.state.desiredGeneration,
    lastGenerated: structuredClone(middle.state.versions),
    delivered: structuredClone(middle.state.versions),
  };
  f.heads.set('DS-1', {
    summaryId: 'DS-1',
    currentRevision: 2,
    currentSummaryRef: 'DSR-1-2',
  });
  await f.refresh();
  expect(Object.values(f.rows[0]!.state.versions)).toEqual([pointer('1', 2)]);
  expect(f.rows[0]!.state.waiting).toEqual([]);
});

test('SAVE rejects a parent whose exact bound child snapshot changed and emits no completion event', async () => {
  const f = setup(),
    row = f.rows[1]!;
  row.state.active = {
    requestId: 'wiki-active',
    attemptRef: 'AQ-active',
    generation: 1,
    versions: structuredClone(row.state.versions),
    waiting: [],
  };
  row.state.versions = { 'SUMMARY:DS-2': pointer('2', 2) };
  await expect(
    completeSavedWiki(f.database as never, owner, {
      summaryId: row.summaryId,
      requestId: 'wiki-active',
    } as DerivedSummaryRevision),
  ).rejects.toThrow('DERIVED_SUMMARY_CONTEXT_CHANGED');
  expect(
    f.calls.some((call) =>
      call.sql.includes('INSERT INTO hierarchical_wiki_change'),
    ),
  ).toBe(false);
  expect(row.state.active).not.toBeNull();
});

test('invalid tree cannot bind an ATA2 child directly under ATA2', async () => {
  const f = setup();
  f.rows[2]!.scope = wikiScopeFor(target, '47');
  await expect(f.refresh()).rejects.toThrow('WIKI_LAYER_MEMBERS_INVALID');
});

test('an ATA4 child from a different chapter cannot bind to the ATA2 parent', async () => {
  const f = setup();
  f.rows[2]!.scope = wikiScopeFor(target, '47-00');
  await expect(f.refresh()).rejects.toThrow('WIKI_LAYER_MEMBERS_INVALID');
});

test('ATA2 accepts its direct saved members and children while FLEET still rejects direct leaves', () => {
  expect(() => assertWikiLayerMembers('ATA2', wikiScopeFor(target, '46'), [doc, matter, pointer('2')])).not.toThrow();
  expect(() => assertWikiLayerMembers('FLEET', wikiScopeFor(target, null), [doc])).toThrow('WIKI_LAYER_MEMBERS_INVALID');
  expect(() => assertWikiLayerMembers('ATA4', wikiScopeFor(target, '46-00'), [pointer('2')])).toThrow('WIKI_LAYER_MEMBERS_INVALID');
});

test('ATA2-only membership absent from old consumed scope becomes pending without inventing ATA4 or changing fleet coverage', async () => {
  const f = setup();
  f.rows.splice(2);
  f.memberships.delete('WIKI-2');
  const middle = f.rows[1]!;
  middle.state = emptyWikiDemand();
  const fleetBefore = structuredClone(f.rows[0]!.state.versions);
  await f.refresh();
  expect(middle.state.versions).toEqual({ 'MATTER:coarse-ata2': { ...matter, matterId: 'MAT-coarse-ata2' } });
  expect(middle.state.desiredGeneration).toBe(1);
  expect(middle.state.firstDirtyAt).not.toBeNull();
  expect(f.rows.map(row => row.scope.kind)).toEqual(['FLEET', 'ATA2']);
  expect(f.rows[0]!.state.versions).toEqual(fleetBefore);
  expect(f.rows[0]!.state.waiting).toEqual([expect.objectContaining({ kind: 'SUMMARY', subjectId: middle.summaryId })]);
  expect(f.calls.some(call => call.sql.includes('INSERT INTO action_attempt') ||
    call.sql.includes('INSERT INTO hierarchical_wiki_scope'))).toBe(false);
  const generation = middle.state.desiredGeneration;
  await f.refresh();
  expect(middle.state.desiredGeneration).toBe(generation);
});
