import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const XLSX = require('xlsx');
const { parseLcmExport } = require('../../server/modules/lcm-export-staging/lcm-export.parser.ts');
const { LcmConfigurationRepository } = require('../../server/modules/lcm-export-staging/lcm-configuration.repository.ts');
const { LcmSnapshotBrowserRepository } = require('../../server/modules/lcm-export-staging/lcm-snapshot-browser.repository.ts');
const capability = await postgresCapability();

function fixture(index, changes = {}) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['ATA章', '系统', '类型', '软件名称', '软件件号', 'FIN号', 'B-7800', 'B-7801'],
    ...Array.from({ length: 40 }, (_, row) => [row % 2 ? '27' : '31',
      row % 2 ? 'SYS-27' : 'SYS-31', 'SYNTHETIC', `TEST-SW-${row}`, `TEST-PN-${row}`, `FIN-${row}`,
      [1, 2, null, 7][row % 4], 1]),
  ]), 'fixture');
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xls' });
  const rawSha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    scope: { tenantId: 'fixture-tenant', actorId: 'fixture-user', authorizedSourceInstanceIds: ['fixture-lcm'] },
    sourceInstanceId: 'fixture-lcm', requestId: `request-${index}`,
    context: { schemaVersion: 'wiselink.lcm.collection_context.v1', collectionId: `collection-${index}`,
      sourceOrigin: 'local-file', pageUrl: null, filters: { aircraftModel: 'B787-9' },
      observedAt: `2026-10-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
      sourceEvidence: 'Synthetic workbook; not received business evidence' },
    originalFileName: 'fixture.xls', localSourcePath: 'synthetic-fixture-only', rawSha256,
    rawByteLength: bytes.length, artifactRef: `fixture-local:${rawSha256}`,
    parsed: parseLcmExport(bytes, 'B787-9'), externalReferences: [], ...changes,
  };
}

test('LCM snapshot browser: isolated store, bounded historical reads and exact source filters',
  { skip: !capability.available ? capability.reason : false }, async (t) => {
    const cluster = await startOwnedPostgres(capability);
    let connection;
    try {
      await cluster.admin.unsafe(await readFile(new URL('../../migrations/0072_lcm_configuration_store.sql', import.meta.url), 'utf8'));
      const applicationUser = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await cluster.admin.unsafe(`CREATE ROLE ${applicationUser} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
      await cluster.admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${applicationUser}`);
      await cluster.admin.unsafe(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO ${applicationUser}`);
      await cluster.admin.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${applicationUser}`);
      connection = await cluster.connect(applicationUser);
      const imports = new LcmConfigurationRepository(connection);
      const browser = new LcmSnapshotBrowserRepository(connection);
      const input = fixture(0), ids = [];
      for (let index = 0; index < 6; index++) ids.push((await imports.importSnapshot(fixture(index))).snapshotId);
      const foreign = fixture(9, { scope: { ...input.scope, tenantId: 'foreign-tenant' } });
      const foreignId = (await imports.importSnapshot(foreign)).snapshotId;

      await t.test('stable snapshot pages contain each received snapshot once', async () => {
        let after, result; const actual = [];
        do {
          result = await browser.catalogue(input.scope, { limit: 2, ...(after ? { after } : {}) });
          assert.ok(result.snapshots.length <= 2);
          actual.push(...result.snapshots.map((snapshot) => snapshot.snapshotId));
          after = result.nextAfter;
        } while (result.hasMore);
        assert.equal(result.nextAfter, null);
        assert.deepEqual([...actual].sort(), [...ids].sort());
        assert.equal(new Set(actual).size, 6);
        assert.ok(!actual.includes(foreignId));
      });
      await t.test('selected history preserves rows, source dates and unknown effectivity', async () => {
        const seen = [], first = await browser.snapshot(input.scope, ids[0], { limit: 50 });
        const second = await browser.snapshot(input.scope, ids[0], { limit: 50, after: first.nextAfter });
        seen.push(...first.records, ...second.records);
        assert.equal(seen.length, 80); assert.equal(new Set(seen.map((record) => record.recordId)).size, 80);
        assert.equal(first.snapshot.snapshotId, ids[0]); assert.equal(second.snapshot.snapshotId, ids[0]);
        assert.equal(first.snapshot.sourceObservedAt, '2026-10-01T08:00:00.000Z');
        assert.equal(first.snapshot.sourceDataCutoffDate, null); assert.equal(first.snapshot.sourceEffectiveAt, null);
        assert.equal(first.snapshot.sourceExportedAt, null); assert.equal(first.snapshot.coveredAircraftCount, 2);
        assert.equal(first.snapshot.recordCount, 80); assert.equal(first.snapshot.completeness, 'UNVERIFIED');
        assert.ok(!('localSourcePath' in first.snapshot)); assert.ok(!('artifactRef' in first.snapshot));
        assert.ok(seen.some((record) => record.allowed === true && record.installed === false));
        assert.ok(seen.some((record) => record.allowed === null && record.installed === null));
        assert.ok(seen.every((record) => record.effectiveAt === null && record.executedAt === null));
      });
      await t.test('all filters apply on the same row before pagination', async () => {
        const filters = { aircraftModel: 'B787-9', tailNumber: 'B-7800', partNumber: 'TEST-PN-1',
          system: 'SYS-27', ata: '27', softwareName: 'TEST-SW-1', position: 'FIN-1', limit: 1 };
        const row = await browser.snapshot(input.scope, ids[0], filters);
        assert.equal(row.records.length, 1); assert.equal(row.records[0].partNumber, 'TEST-PN-1');
        assert.equal(row.hasMore, false);
        assert.equal((await browser.catalogue(input.scope, filters)).snapshots.length, 1);
        assert.equal((await browser.catalogue(input.scope, { ...filters, position: 'FIN-0' })).snapshots.length, 0);
        assert.equal((await browser.snapshot(input.scope, ids[0], { ...filters, position: 'FIN-0' })).records.length, 0);
        assert.equal((await browser.snapshot(input.scope, ids[0], { partNumber: "' OR TRUE --" })).records.length, 0);
      });
      await t.test('cross tenant, actor and source requests cannot return another snapshot', async () => {
        for (const scope of [{ ...input.scope, actorId: 'other-user' },
          { ...input.scope, authorizedSourceInstanceIds: ['other-lcm'] }]) {
          assert.equal((await browser.catalogue(scope, {})).snapshots.length, 0);
          await assert.rejects(browser.snapshot(scope, ids[0], {}), { code: 'LCM_SNAPSHOT_NOT_FOUND' });
        }
        await assert.rejects(browser.snapshot(input.scope, foreignId, {}), { code: 'LCM_SNAPSHOT_NOT_FOUND' });
        await assert.rejects(browser.catalogue(input.scope, { after: foreignId }), { code: 'LCM_CURSOR_INVALID' });
      });
      await t.test('invalid pagination and injected identities are rejected', async () => {
        for (const limit of [0, 51, 1.5, '', '01', '1e1'])
          await assert.rejects(browser.catalogue(input.scope, { limit }), { code: 'LCM_BROWSER_QUERY_INVALID' });
        await assert.rejects(browser.catalogue(input.scope, { tenantId: 'foreign-tenant' }), { code: 'LCM_BROWSER_QUERY_INVALID' });
        await assert.rejects(browser.catalogue(input.scope, { after: 'tampered' }), { code: 'LCM_CURSOR_INVALID' });
      });
    } finally {
      if (connection) await connection.end({ timeout: 1 });
      await cluster.stop();
    }
  });
