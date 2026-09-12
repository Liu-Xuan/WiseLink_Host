import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postgres from 'postgres';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: drizzleSql } = require('drizzle-orm');
const { DriveScanCheckpointRepository } = require('../../server/modules/document-management/src/hosted/nest/drive-scan-checkpoint.repository.ts');
const { runDriveFolderScan } = require('../../server/modules/document-management/src/hosted/drive-folder-scan-coordinator.ts');
const url = process.env.DRIVE_SCAN_TEST_DATABASE_URL;

test('scan page objects, pending intake and cursor commit together and resume A/B/C without loss', { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/wiselink_drive_scan_test');
  const sql = postgres(url, { max: 1, onnotice() {} });
  const scoped = postgres(url, { max: 1, onnotice() {} });
  try {
    await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await sql.unsafe(`CREATE FUNCTION engineering_matter_actor_has_tenant(candidate text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT candidate = 'test-tenant' AND current_setting('app.user_id',true) = 'test-actor' $$;`);
    for (const name of ['0040_wiselink_drive_scan_checkpoint.sql','0041_wiselink_drive_candidate_snapshot.sql','0046_drive_scan_pending_candidates.sql','0051_drive_scan_hosted_scope.sql']) {
      await sql.unsafe(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    await sql.unsafe('GRANT USAGE ON SCHEMA public TO authenticated,service_role; GRANT SELECT,INSERT,UPDATE,DELETE ON wiselink_drive_scan_checkpoint TO authenticated,service_role');
    const repository = new DriveScanCheckpointRepository(drizzle(sql));
    const store = repository.forTenant('test-tenant');
    const calls = [];
    const input = { sourceKey: 'source', roots: [{ folderToken: 'root', path: 'root', depth: 0 }], checkpoints: store,
      fetchPage: async (_folder, token) => {
        calls.push(token ?? 'first');
        const current = token === 'B' ? 'B' : token === 'C' ? 'C' : 'A';
        return { files: [{ token: current, type: 'file', name: `${current}.pdf`, version_id: 'v1' }],
          hasMore: current !== 'C', nextPageToken: current === 'A' ? 'B' : current === 'B' ? 'C' : null };
      } };
    await runDriveFolderScan({ ...input, maxPages: 1 });
    const before = await store.load('source');
    assert.deepEqual(JSON.parse(await store.loadCandidates('source')).map(item => item.providerObjectId), ['A']);
    await sql.unsafe(`ALTER TABLE wiselink_drive_scan_checkpoint ADD CONSTRAINT fail_page_b
      CHECK (pending_candidates_json NOT LIKE '%"providerObjectId":"B"%')`);
    await assert.rejects(runDriveFolderScan({ ...input, maxPages: 2 }));
    assert.equal(await store.load('source'), before);
    assert.deepEqual(JSON.parse(await store.loadCandidates('source')).map(item => item.providerObjectId), ['A']);
    await sql.unsafe('ALTER TABLE wiselink_drive_scan_checkpoint DROP CONSTRAINT fail_page_b');
    const finished = await runDriveFolderScan({ ...input, maxPages: 2 });
    assert.equal(finished.continuation.length, 0);
    assert.deepEqual(calls, ['first', 'B', 'B', 'C']);
    const [row] = await sql`SELECT * FROM wiselink_drive_scan_checkpoint WHERE source_key='source'`;
    assert.deepEqual(JSON.parse(row.candidate_snapshot_json).map(item => item.providerObjectId), ['A','B','C']);
    assert.deepEqual(JSON.parse(row.pending_candidates_json).map(item => item.providerObjectId), ['A','B','C']);
    assert.deepEqual((await repository.listPendingCandidates('test-tenant','source')).map(item => item.providerObjectId), ['A','B','C']);
    await assert.rejects(store.savePage('source', before, [], before), /DRIVE_SCAN_CHECKPOINT_CONFLICT/);
    assert.equal(await store.load('source'), row.checkpoint_json);
    // Constructed tenant mapping, actual PostgreSQL roles and RLS. This does not
    // prove upstream application/delegated Drive permissions.
    const inRole = (role, actor, operation) => drizzle(scoped).transaction(async tx => {
      await tx.execute(role === 'service_role' ? drizzleSql`SET LOCAL ROLE service_role` : drizzleSql`SET LOCAL ROLE authenticated`);
      await tx.execute(drizzleSql`SELECT set_config('app.user_id',${actor},true)`);
      return operation(new DriveScanCheckpointRepository(tx));
    });
    assert.equal((await inRole('service_role','test-actor', repo => repo.listPendingCandidates('test-tenant','source'))).length,3);
    await inRole('service_role','test-actor', repo => repo.forTenant('test-tenant').savePage('source',row.checkpoint_json,[],row.checkpoint_json));
    assert.deepEqual(await inRole('authenticated','test-actor', repo => repo.listPendingCandidates('test-tenant','source')),[]);
    assert.deepEqual(await inRole('service_role','other-actor', repo => repo.listPendingCandidates('test-tenant','source')),[]);
    assert.deepEqual(await inRole('service_role','test-actor', repo => repo.listPendingCandidates('other-tenant','source')),[]);
    await assert.rejects(inRole('authenticated','test-actor', repo => repo.forTenant('test-tenant').savePage('source',row.checkpoint_json,[],row.checkpoint_json)),
      error => error?.cause?.code === '42501');
  } finally { await scoped.end(); await sql.end(); }
});
