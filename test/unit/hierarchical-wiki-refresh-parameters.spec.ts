import { drizzle } from 'drizzle-orm/postgres-js';
import { CanonicalModelSettingsService } from '../../server/modules/model-settings/canonical-model-settings.service';
import { HierarchicalWikiService } from '../../server/modules/canonical-host/hierarchical-wiki.service';
import { emptyWikiDemand } from '../../server/modules/canonical-host/hierarchical-wiki-demand';
import type { WikiRow } from '../../server/modules/canonical-host/hierarchical-wiki.persistence';

jest.mock('../../server/modules/canonical-host/hierarchical-wiki-inventory', () => ({
  ...jest.requireActual('../../server/modules/canonical-host/hierarchical-wiki-inventory'),
  readWikiInventory: jest.fn(async () => ({ items: [], removed: [], waiting: [], complete: true, cursor: null })),
}));

/** Real installed Drizzle PostgresJsPreparedQuery, with an in-memory unsafe sink.
 * Tests the enable→refresh path, parameter forwarding and retained-member pruning.
 * This is not the remote platform parser or a physical PostgreSQL proof. */
function setup(allowed: boolean, family = 'B787') {
  const owner = { tenantId: "tenant-?-$1'", actorUserId: "actor-?-$2'" };
  const member = { kind: 'MATTER_WORK', matterId: 'MAT-selected', workRef: 'MW-selected', workRevision: 1, issueKeys: [] };
  let retained = true;
  const row: WikiRow = { wikiId: 'WIKI-test', summaryId: 'DS-test', ...owner,
    scope: { kind: 'FLEET', title: family, fleetFamilyId: family, fleetModelIds: [], ata2: null, ata4: null, selectionReason: 'user selected' },
    parentWikiId: null, principalId: 'service-test', modelRef: 'miaoda/glm-5.3', enabled: true,
    state: emptyWikiDemand(), lastEventSeq: '0', lastInventoryAt: null, inventoryCursor: null, upstreamDelegations: {} };
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const client = {
    options: { parsers: {}, serializers: {} },
    unsafe: jest.fn(async (query: string, params: unknown[]) => {
      calls.push({ query, params });
      if (query.includes('FROM hierarchical_wiki_scope') && !query.includes('FROM hierarchical_wiki_membership')) return [structuredClone(row)];
      if (query.includes('SELECT wiki_id AS "wikiId",member_key AS key'))
        return retained ? [{ wikiId: row.wikiId, key: 'MATTER:MAT-selected', member, kind: 'MATTER', sourceId: member.matterId }] : [];
      if (query.includes('derived_summary_reading_sources_owned')) return [{ allowed }];
      if (query.includes("SET member_json='{}'::jsonb")) { retained = false; return []; }
      if (query.includes('SELECT member_key AS key,member_json AS member FROM hierarchical_wiki_membership'))
        return retained ? [{ key: 'MATTER:MAT-selected', member }] : [];
      if (query.includes('UPDATE hierarchical_wiki_scope SET state_json')) {
        const state = JSON.parse(params[0] as string); row.state = state;
      }
      return [];
    }),
  };
  const database = drizzle(client as never);
  const transaction = jest.fn(async (_actor: unknown, operation: Function) => operation(database, owner));
  const repository = { browser: transaction };
  const models = new CanonicalModelSettingsService({ read: async () => ({ ...owner, modelRef: 'miaoda/glm-5.3', revision: 1, updatedAt: new Date() }) } as never);
  const summaries = { reserve: jest.fn() };
  const service = new HierarchicalWikiService(database as never, repository as never, summaries as never,
    {} as never, {} as never,
    { readLibraryCatalog: async () => ({ status: 'AVAILABLE', families: [{ fleetFamily: family, models: [] }] }) } as never,
    { authorizeOpenClawAutoWorkItemQueue: async () => ({ appId: 'app_17bzc551rsg', tenantId: owner.tenantId, principalId: row.principalId }) } as never,
    undefined, models);
  Object.assign(service, { readList: jest.fn(async () => ({ items: [] })) });
  return { service, owner, row, calls, summaries, transaction, client };
}

test.each([true, false])('actual enable/refresh SQL keeps exact scope parameters and source pruning, allowed=%s', async allowed => {
  const f = setup(allowed);
  await expect(f.service.enable({ fleetFamilyId: 'B787', fleetModelId: null }, { tenantId: f.owner.tenantId } as never))
    .resolves.toEqual({ items: [] });
  expect(f.transaction).toHaveBeenCalledTimes(1);
  const retained = f.calls.find(call => call.query.includes('SELECT wiki_id AS "wikiId",member_key AS key'))!;
  expect(retained.params).toEqual([f.owner.tenantId, f.owner.actorUserId, 'B787', '[]']);
  const sourceChange = f.calls.find(call => call.query.includes("SELECT DISTINCT 'DOCUMENT' AS kind"))!;
  expect(sourceChange.params).toEqual([f.owner.tenantId, f.owner.tenantId, f.owner.actorUserId, 'B787', '[]', f.owner.tenantId]);
  const membership = f.calls.find(call => call.query.includes('SELECT member_key AS key,member_json AS member FROM hierarchical_wiki_membership'))!;
  expect(membership.params).toEqual(['WIKI-test']);
  // A literal operator must not masquerade as another platform bind marker.
  for (const call of [retained, sourceChange, membership]) expect(call.query).not.toContain('?');
  expect(f.calls.some(call => call.query.includes("SET member_json='{}'::jsonb"))).toBe(!allowed);
  // The retained coarse membership remains classified, but a fleet generation
  // now consumes only saved ATA2 children.
  expect(Object.keys(f.row.state.versions)).toEqual([]);
  expect(f.summaries.reserve).not.toHaveBeenCalled();
});

test('question marks and SQL-looking scope data stay bound rather than entering query text', async () => {
  const family = "B787 ? '$4'";
  const f = setup(true, family);
  await f.service.enable({ fleetFamilyId: family, fleetModelId: null }, { tenantId: f.owner.tenantId } as never);
  const scoped = f.calls.filter(call => call.params.includes(family));
  expect(scoped.length).toBeGreaterThan(3);
  for (const call of scoped) {
    expect(call.query).not.toContain(family);
    expect(call.query).not.toContain(f.owner.tenantId);
    expect(call.query).not.toContain(f.owner.actorUserId);
  }
  expect(f.summaries.reserve).not.toHaveBeenCalled();
});
