import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { wikiRows } = require('../../server/modules/canonical-host/hierarchical-wiki.persistence.ts');
const { emptyWikiDemand } = require('../../server/modules/canonical-host/hierarchical-wiki-demand.ts');

/** Query/RLS integration on an owned loopback cluster with synthetic metadata.
 * No body or model tables exist here; this does not prove production source access. */
test('directory reads exact saved heads in one existing scoped query under actual PostgreSQL RLS', { timeout: 60000 }, async t => {
  const capability = await postgresCapability();
  assert.equal(capability.available, true, capability.reason);
  const cluster = await startOwnedPostgres(capability);
  try {
    const admin = cluster.admin;
    const role = 'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
    await admin.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS`);
    await admin.unsafe(`
      CREATE TABLE hierarchical_wiki_scope(
        wiki_id text PRIMARY KEY,summary_id text,tenant_id text,actor_user_id text,scope_json jsonb,
        parent_wiki_id text,delegated_principal_id text,model_ref text,enabled boolean,state_json jsonb,
        last_event_seq bigint,last_inventory_at timestamptz,inventory_cursor text,upstream_delegations_json jsonb);
      CREATE TABLE derived_summary(
        summary_id text,tenant_id text,actor_user_id text,current_summary_ref text,current_revision integer,
        UNIQUE(tenant_id,summary_id));
      ALTER TABLE hierarchical_wiki_scope ENABLE ROW LEVEL SECURITY;
      ALTER TABLE derived_summary ENABLE ROW LEVEL SECURITY;
      CREATE POLICY wiki_read ON hierarchical_wiki_scope FOR SELECT USING(
        tenant_id=current_setting('app.tenant_id',true) AND
        (actor_user_id=current_setting('app.user_id',true) OR current_setting('app.read_scope',true)='TENANT'));
      CREATE POLICY summary_read ON derived_summary FOR SELECT USING(
        tenant_id=current_setting('app.tenant_id',true) AND
        (actor_user_id=current_setting('app.user_id',true) OR current_setting('app.read_scope',true)='TENANT'));
      GRANT SELECT ON hierarchical_wiki_scope,derived_summary TO ${role};
    `);
    const state = emptyWikiDemand();
    for (const [id, tenant, actor, headActor, ref, revision] of [
      ['own', 'tenant1', 'owner1', 'owner1', 'saved-ref1', 7],
      ['other-owner', 'tenant1', 'owner2', 'owner2', 'saved-other', 9],
      ['other-tenant', 'tenant2', 'owner1', 'owner1', 'saved-private', 11],
      ['mismatched-owner', 'tenant1', 'owner1', 'owner2', 'must-not-attach', 13],
      ['empty', 'tenant1', 'owner1', 'owner1', null, 0],
    ]) {
      await admin`INSERT INTO hierarchical_wiki_scope VALUES(
        ${id},${id},${tenant},${actor},${admin.json({ kind: 'FLEET', title: id, fleetFamilyId: 'B787', fleetModelIds: [] })},
        NULL,'existing-principal','miaoda/glm-5.3',true,${admin.json(state)},0,NULL,NULL,'{}')`;
      await admin`INSERT INTO derived_summary VALUES(${id},${tenant},${headActor},${ref},${revision})`;
    }
    const client = await cluster.connect(role);
    const database = drizzle(client);
    const read = readScope => database.transaction(async tx => {
      await tx.execute(sql`SELECT set_config('app.tenant_id','tenant1',true),set_config('app.user_id','owner1',true),
        set_config('app.read_scope',${readScope ?? 'OWN'},true)`);
      return wikiRows(tx, { tenantId: 'tenant1', actorUserId: 'owner1',
        ...(readScope === 'TENANT' ? { readScope } : {}) }, true);
    });
    await t.test('owner and RLS filters do not attach another owner or tenant head', async () => {
      const rows = await read();
      assert.deepEqual(rows.map(row => row.wikiId), ['empty', 'mismatched-owner', 'own']);
      assert.equal(rows.find(row => row.wikiId === 'own').currentSummaryRef, 'saved-ref1');
      assert.equal(rows.find(row => row.wikiId === 'own').currentRevision, 7);
      assert.equal(rows.find(row => row.wikiId === 'mismatched-owner').currentSummaryRef, null);
      assert.equal(rows.find(row => row.wikiId === 'empty').currentSummaryRef, null);
    });
    await t.test('tenant reading preserves each exact owner binding and the old observation across a later save', async () => {
      const before = await read('TENANT');
      assert.deepEqual(before.map(row => row.wikiId), ['empty', 'mismatched-owner', 'other-owner', 'own']);
      assert.equal(before.find(row => row.wikiId === 'other-owner').currentSummaryRef, 'saved-other');
      assert.equal(before.find(row => row.wikiId === 'mismatched-owner').currentSummaryRef, null);
      await admin`UPDATE derived_summary SET current_summary_ref='saved-ref2',current_revision=8 WHERE summary_id='own'`;
      const after = await read('TENANT');
      assert.equal(before.find(row => row.wikiId === 'own').currentSummaryRef, 'saved-ref1');
      assert.equal(after.find(row => row.wikiId === 'own').currentSummaryRef, 'saved-ref2');
      assert.equal(after.find(row => row.wikiId === 'own').currentRevision, 8);
    });
    await t.test('a head hidden by its current RLS policy does not leak a saved ref through the directory join', async () => {
      await admin.unsafe("ALTER POLICY summary_read ON derived_summary USING(false)");
      const rows = await read('TENANT');
      assert.equal(rows.length, 4);
      assert.ok(rows.every(row => row.currentSummaryRef === null && row.currentRevision === null));
    });
  } finally {
    await cluster.stop();
  }
});
