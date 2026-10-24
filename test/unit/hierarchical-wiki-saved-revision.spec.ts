import { PgDialect } from 'drizzle-orm/pg-core';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import { emptyWikiDemand } from '../../server/modules/canonical-host/hierarchical-wiki-demand';
import type { WikiRow } from '../../server/modules/canonical-host/hierarchical-wiki.persistence';

const owner = { tenantId: 'wiki-revision-tenant', actorUserId: 'wiki-revision-reader', readScope: 'TENANT' as const };
function row(index: number): WikiRow {
  return {
    wikiId: `wiki-${index}`, summaryId: `summary-${index}`, ...owner,
    scope: { kind: 'FLEET', title: `Saved scope ${index}`, fleetFamilyId: `fleet-${index}`,
      fleetModelIds: [], ata2: null, ata4: null, selectionReason: 'Synthetic confirmed scope' },
    parentWikiId: null, principalId: 'existing-principal', modelRef: 'miaoda/glm-5.3', enabled: true,
    lastEventSeq: '0', lastInventoryAt: null, inventoryCursor: null, upstreamDelegations: {},
    currentSummaryRef: `saved-${index}`, currentRevision: index + 7,
    state: { ...emptyWikiDemand(), desiredGeneration: 3, completedGeneration: 1 },
  };
}
function setup() {
  const rows: WikiRow[] = [row(1), row(2)];
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const dialect = new PgDialect();
  const database = {
    execute: jest.fn(async (statement: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const query = dialect.sqlToQuery(statement);
      queries.push(query);
      if (query.sql.includes('FROM hierarchical_wiki_scope w JOIN hierarchical_wiki_membership')) return [];
      if (query.sql.includes('FROM hierarchical_wiki_scope')) return structuredClone(rows);
      if (query.sql.includes('AS allowed')) return [{ allowed: true }];
      throw new Error('UNEXPECTED_DIRECTORY_QUERY');
    }),
  };
  const repository = {
    readBrowser: jest.fn(async (_actor: unknown, operation: Function) => operation(database, owner)),
    browser: jest.fn(async () => { throw new Error('UNEXPECTED_DIRECTORY_WRITE'); }),
    head: jest.fn(async () => { throw new Error('UNEXPECTED_PER_ROW_HEAD_QUERY'); }),
  };
  const members = { readAll: jest.fn(async () => []) };
  const summaries = { reserve: jest.fn() };
  const service = new HierarchicalWikiService(database as never, repository as never, summaries as never,
    members as never, {} as never, {} as never, {} as never);
  return { service, rows, queries, database, repository, members, summaries };
}

it('returns exact persisted heads in the same authorized directory query without a per-row or body read', async () => {
  const f = setup();
  const listed = await f.service.list({ userId: owner.actorUserId } as never);
  expect(listed.items.map(item => item.savedRevision)).toEqual([
    { summaryRef: 'saved-1', revision: 8 }, { summaryRef: 'saved-2', revision: 9 },
  ]);
  expect(listed.items[0].completedGeneration).toBe(1);
  const heads = f.queries.filter(query => query.sql.includes('LEFT JOIN derived_summary'));
  expect(heads).toHaveLength(1);
  expect(heads[0].sql).toContain('s.tenant_id=w."tenantId" AND s.actor_user_id=w."actorUserId"');
  expect(heads[0].params).toEqual([owner.tenantId]);
  expect(heads[0].sql).not.toContain('derived_summary_revision');
  expect(heads[0].sql).not.toContain('content_json');
  expect(f.repository.head).not.toHaveBeenCalled();
  expect(f.repository.browser).not.toHaveBeenCalled();
  expect(f.summaries.reserve).not.toHaveBeenCalled();
  for (const call of f.members.readAll.mock.calls)
    expect(call).toEqual([[], owner, f.database]);
});

it('preserves an observation across later saves and returns the new ref only on directory reread', async () => {
  const f = setup();
  const before = await f.service.list({ userId: owner.actorUserId } as never);
  Object.assign(f.rows[0], { currentSummaryRef: 'saved-next', currentRevision: 10 });
  const after = await f.service.list({ userId: owner.actorUserId } as never);
  expect(before.items[0].savedRevision).toEqual({ summaryRef: 'saved-1', revision: 8 });
  expect(after.items[0].savedRevision).toEqual({ summaryRef: 'saved-next', revision: 10 });
});

it('hides the saved pointer when the existing source-closure authorization denies the directory row', async () => {
  const f = setup();
  f.members.readAll.mockRejectedValueOnce(new Error('WIKI_SOURCE_UNAVAILABLE'));
  const listed = await f.service.list({ userId: owner.actorUserId } as never);
  expect(listed.items[0]).toMatchObject({
    state: 'BLOCKED', errorCode: 'WIKI_SOURCE_UNAVAILABLE', savedRevision: null, coveredMembers: [], waiting: [],
  });
  expect(listed.items[1].savedRevision).toEqual({ summaryRef: 'saved-2', revision: 9 });
});

it('keeps no-save metadata null and rejects a persisted ref without its actual revision', async () => {
  const f = setup();
  Object.assign(f.rows[0], { currentSummaryRef: null, currentRevision: 0 });
  expect((await f.service.list({ userId: owner.actorUserId } as never)).items[0].savedRevision).toBeNull();
  Object.assign(f.rows[0], { currentSummaryRef: 'incomplete-ref', currentRevision: null });
  await expect(f.service.list({ userId: owner.actorUserId } as never)).rejects.toThrow('WIKI_PERSISTENCE_INVALID');
});
