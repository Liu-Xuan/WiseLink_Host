import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

// A different candidate checkout can be read without copying or merging production code.
const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidateRoot = await realpath(process.env.WISELINK_TDMS_P1_TEST_ROOT ?? testRoot);
process.env.TS_NODE_PROJECT = join(candidateRoot, 'tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { MiaodaTdmsSourceRepository, SqlTdmsTransaction } = require(
  join(candidateRoot, 'server/modules/tdms-source/tdms-source.repository.ts'),
);
const { TdmsSourceService } = require(join(candidateRoot, 'server/modules/tdms-source/tdms-source.service.ts'));
const { HostDecisionTdmsSourceAuthorization, UnconfiguredTdmsSourceAuthorization } = require(
  join(candidateRoot, 'server/modules/tdms-source/tdms-source.authorization.ts'),
);
const { tdmsError } = require(join(candidateRoot, 'server/modules/tdms-source/tdms-source.types.ts'));
const { actor, fixture } = require(join(testRoot, 'test/unit/tdms-source/tdms-fixtures.ts'));
const { nativeScope } = require(join(testRoot, 'test/unit/tdms-source/tdms-memory-double.ts'));
const tables = ['tdms_capture', 'tdms_record', 'tdms_record_revision', 'tdms_relation',
  'tdms_relation_assertion', 'tdms_read_receipt'];

function packet(scopeId) {
  const result = fixture();
  const original = result.records[0];
  result.packageId = `synthetic-p1-${scopeId}`;
  result.records = Array.from({ length: 90 }, (_unused, index) => ({
    ...structuredClone(original),
    itemId: `item-${index}`,
    recordKind: 'ENGINEERING_FILE',
    sourceRecordId: `synthetic-${scopeId}-${index}`,
    title: `synthetic independent acceptance ${index}`,
    sourceVersion: { rawRevision: '0042', rawIteration: '8', confirmation: 'SOURCE_DECLARED' },
    businessVersion: { rawRevision: index % 3 === 1 ? 'R02' : 'R01', rawIteration: null,
      confirmation: 'SOURCE_DECLARED' },
    relatedDocumentVersionIds: index % 3 === 2 ? [] : [index % 3 === 1 ? 'DV-R02' : 'DV-R01'],
    content: { conditions: [`synthetic retained original source ${index}`] },
  }));
  return result;
}

test('P1 exact version source pages use physical bounded queries and retain source-only identities',
  { timeout: 60000 }, async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const previousSandbox = process.env.SANDBOX_ID;
    const scopes = [nativeScope, { ...nativeScope, scopeId: 'synthetic-second-scope' }];
    try {
      const admin = owned.admin;
      await admin.unsafe('CREATE SCHEMA p1_acceptance; SET search_path TO p1_acceptance,pg_catalog');
      await admin.unsafe(await readFile(join(candidateRoot, 'server/database/tdms-source-rebuild-v1.draft.sql'), 'utf8'));
      const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await admin.unsafe(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS;
        GRANT USAGE ON SCHEMA p1_acceptance TO ${login}`);
      // Narrow fixture policies exist only in this owned ephemeral database. They prove no production authorization.
      for (const table of tables) {
        await admin.unsafe(`GRANT SELECT, INSERT, UPDATE ON ${table} TO ${login};
          CREATE POLICY p1_fixture ON ${table} TO ${login}
          USING (tenant_id=current_setting('app.tenant_id',true))
          WITH CHECK (tenant_id=current_setting('app.tenant_id',true))`);
      }
      const connection = await owned.connect(login);
      await connection.unsafe('SET search_path TO p1_acceptance,pg_catalog');
      await connection`SELECT set_config('app.tenant_id',${nativeScope.tenantId},false)`;
      const repository = new MiaodaTdmsSourceRepository(drizzle(connection));
      let transactions = 0;
      const countedRepository = { transaction: async (operation) => {
        transactions++;
        return repository.transaction(operation);
      } };
      const grants = scopes.map(scope => ({ scope, permissionRevision: 'synthetic-current-fixture' }));
      const authorization = new HostDecisionTdmsSourceAuthorization(async ({ actor: subject, action }) => {
        if (subject.tenantId !== nativeScope.tenantId || !['123', '456'].includes(subject.canonicalSubject.id)) return [];
        if (action === 'IMPORT' && subject.canonicalSubject.id !== '123') return [];
        return grants;
      }, async ({ claims, grant }) => ({ ...grant, authorityRef: 'synthetic-local-only',
        captureRetentionAllowed: true, nativeProjectionAllowed: true, permittedMembers: claims }));
      let acquisitions = 0;
      const documentChecks = [];
      const service = new TdmsSourceService(countedRepository, authorization, {
        acquire: async () => { acquisitions++; throw new Error('UNEXPECTED_FILE_IO'); },
      }, { assertRead: async (_subject, id) => {
        documentChecks.push(id);
        if (id === 'DV-denied') throw tdmsError('DOCUMENT_NOT_FOUND', 404);
      } });
      const writer = actor();
      const reader = { ...writer, canonicalSubject: { ...writer.canonicalSubject, id: '456' } };
      const firstHeads = new Map();
      for (const scope of scopes) {
        const input = packet(scope.scopeId);
        const target = { sourceKey: scope.sourceKey, sourceInstanceId: scope.sourceInstanceId, scopeId: scope.scopeId };
        const first = await service.importPackage(writer, target, input);
        firstHeads.set(scope.scopeId, first.recordRevisionRefs[0]);
        const retry = await service.importPackage(writer, target, input);
        assert.equal(first.created, true);
        assert.equal(retry.created, false);
        assert.deepEqual(retry.recordRevisionRefs, first.recordRevisionRefs);
      }
      const counts = async () => Object.fromEntries(await Promise.all(tables.map(async table => {
        const [row] = await admin.unsafe(`SELECT count(*)::int AS n FROM p1_acceptance.${table}`);
        return [table, row.n];
      })));
      const importedCounts = await counts();
      assert.equal(importedCounts.tdms_record, 180);
      assert.equal(importedCounts.tdms_record_revision, 180);
      assert.equal(importedCounts.tdms_capture, 2);

      await t.test('SQL limits before release, applies exact membership and keeps the seek cursor', async () => {
        const transaction = new SqlTdmsTransaction(drizzle(connection));
        const first = await transaction.catalogue(scopes[0], { limit: 4, documentVersionId: 'DV-R01' });
        assert.equal(first.length, 4, 'Repository must not fetch all ninety records before slicing');
        assert.ok(first.every(row => row.record.relatedDocumentVersionIds.includes('DV-R01')));
        const after = first.at(-1).record.sourceRevisionRef;
        const second = await transaction.catalogue(scopes[0], { limit: 4, documentVersionId: 'DV-R01', after });
        assert.equal(second.length, 4);
        assert.ok(second.every(row => row.record.sourceRevisionRef > after));
        assert.equal(new Set([...first, ...second].map(row => row.record.sourceRevisionRef)).size, 8);
        assert.deepEqual(await transaction.catalogue(scopes[0], {
          limit: 4, documentVersionId: "DV-R01' OR TRUE--",
        }), [], 'A version selector must be a bound parameter, not SQL');
      });
      await t.test('invalid repository page sizes fail instead of silently fetching full scope', async () => {
        const transaction = new SqlTdmsTransaction(drizzle(connection));
        for (const limit of [0, -1, 52, 1.5]) {
          await assert.rejects(transaction.catalogue(scopes[0], { limit }), { code: 'TDMS_CATALOGUE_LIMIT_INVALID' });
        }
      });
      await t.test('two authorized scopes merge into stable pages without other-version or unresolved sources', async () => {
        const first = await service.catalogue(reader, { documentVersionId: 'DV-R01' });
        assert.equal(first.records.length, 50);
        assert.equal(first.hasMore, true);
        const second = await service.catalogue(reader, { documentVersionId: 'DV-R01' }, first.nextAfter);
        const records = [...first.records, ...second.records];
        assert.equal(records.length, 60);
        assert.equal(second.hasMore, false);
        assert.equal(second.nextAfter, null);
        assert.equal(new Set(records.map(row => row.sourceRevisionRef)).size, 60);
        assert.ok(records.every(row => row.relatedDocumentVersionIds.includes('DV-R01')));
        assert.ok(records.every(row => row.businessVersion.rawRevision === 'R01' && row.sourceVersion.rawRevision === '0042'));
        assert.equal(first.readPerformed, false);
        assert.deepEqual(await counts(), importedCounts, 'Browsing must not persist evaluations or source read receipts');
        assert.equal(acquisitions, 0);
      });
      await t.test('both synthetic admitted readers see the same exact page; read-only import is denied', async () => {
        const a = await service.catalogue(writer, { documentVersionId: 'DV-R01' });
        const b = await service.catalogue(reader, { documentVersionId: 'DV-R01' });
        assert.deepEqual(a.records, b.records);
        const before = transactions;
        const target = { sourceKey: scopes[0].sourceKey,
          sourceInstanceId: scopes[0].sourceInstanceId, scopeId: scopes[0].scopeId };
        await assert.rejects(service.importPackage(reader, target, packet('denied-write')), { code: 'TDMS_SOURCE_NOT_FOUND' });
        assert.equal(transactions, before);
      });
      await t.test('selected document denial is checked before any TDMS transaction', async () => {
        const before = transactions;
        await assert.rejects(service.catalogue(reader, { documentVersionId: 'DV-denied' }), { code: 'DOCUMENT_NOT_FOUND' });
        assert.equal(transactions, before);
        assert.ok(documentChecks.includes('DV-denied'));
      });
      await t.test('anonymous and foreign tenant cannot use synthetic current decisions to read', async () => {
        const anonymous = { ...reader, canonicalSubject: { ...reader.canonicalSubject, id: '-1' } };
        await assert.rejects(service.catalogue(anonymous), { code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED' });
        const foreign = { ...reader, tenantId: 'foreign-tenant' };
        await assert.rejects(service.catalogue(foreign), { code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED' });
      });
      await t.test('DVI query applies current record members before DISTINCT and LIMIT', async () => {
        const transaction = new SqlTdmsTransaction(drizzle(connection));
        const sourceRecordId = `synthetic-${scopes[0].scopeId}-87`;
        const page = await transaction.documentVersionCatalogue(scopes[0], {
          documentVersionId: 'DV-R01', limit: 2,
          permittedRecords: [{ recordKind: 'ENGINEERING_FILE', sourceRecordId }],
        });
        assert.equal(page.length, 1);
        assert.equal(page[0].record.sourceRecordId, sourceRecordId);
        assert.deepEqual(await transaction.documentVersionCatalogue(scopes[0], {
          documentVersionId: 'DV-R01', limit: 2, permittedRecords: [],
        }), []);
      });
      await t.test('existing lineage exact revision refs join without rewriting retained DVI metadata', async () => {
        const transaction = new SqlTdmsTransaction(drizzle(connection));
        const sourceRevisionRef = firstHeads.get(scopes[0].scopeId);
        const page = { documentVersionId: 'DV-registered-by-existing-lineage', limit: 2,
          sourceRevisionRefs: [sourceRevisionRef] };
        const rows = await transaction.documentVersionCatalogue(scopes[0], page);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].record.sourceRevisionRef, sourceRevisionRef);
        assert.deepEqual(rows[0].record.relatedDocumentVersionIds, ['DV-R01']);
        assert.deepEqual(await transaction.documentVersionCatalogue(scopes[0], {
          ...page, sourceRevisionRefs: ["x' OR TRUE--"],
        }), []);
        assert.deepEqual(await transaction.documentVersionCatalogue(scopes[0], {
          ...page, permittedRecords: [],
        }), []);
      });
      await t.test('raw exact-version pages retain each original, receipt and technical/business revision', async () => {
        const before = await counts();
        const first = await service.readDocumentVersion(reader, { documentVersionId: 'DV-R01', limit: 7 });
        const next = await service.readDocumentVersion(reader, {
          documentVersionId: 'DV-R01', limit: 7, after: first.nextAfter,
        });
        const records = [...first.records, ...next.records];
        assert.equal(first.documentVersionId, 'DV-R01');
        assert.equal(first.sourceStatus, 'AVAILABLE');
        assert.equal(first.records.length, 7);
        assert.equal(next.records.length, 7);
        assert.equal(new Set(records.map(item => item.record.sourceRevisionRef)).size, 14);
        assert.ok(records.every(item => item.record.relatedDocumentVersionIds.includes('DV-R01')));
        assert.ok(records.every(item => item.record.businessVersion.rawRevision === 'R01' &&
          item.record.sourceVersion.rawRevision === '0042' && item.record.sourceVersion.rawIteration === '8'));
        assert.ok(records.every(item => item.record.content.conditions[0].startsWith('synthetic retained original')));
        assert.ok(records.every(item => item.receipt.readPerformed === true &&
          item.receipt.engineeringAdoption === 'NOT_CREATED' && item.receipt.executionVerified === false));
        const after = await counts();
        assert.equal(after.tdms_read_receipt - before.tdms_read_receipt, 14);
        for (const table of tables.filter(name => name !== 'tdms_read_receipt')) assert.equal(after[table], before[table]);
        assert.equal(acquisitions, 0);
      });
      await t.test('unbound and unconfigured exact source reads have distinct outcomes', async () => {
        const unbound = await service.readDocumentVersion(reader, { documentVersionId: 'DV-unbound', limit: 5 });
        assert.equal(unbound.sourceStatus, 'NO_BOUND_RECORDS');
        assert.deepEqual(unbound.records, []);
        assert.equal(unbound.hasMore, false);
        assert.equal(unbound.nextAfter, null);
        const closed = new TdmsSourceService(countedRepository, new UnconfiguredTdmsSourceAuthorization(), {
          acquire: async () => { throw new Error('UNEXPECTED_IO'); },
        }, { assertRead: async () => { throw new Error('UNEXPECTED_DOCUMENT_READ'); } });
        const before = transactions;
        await assert.rejects(closed.readDocumentVersion(reader, { documentVersionId: 'DV-R01' }),
          { code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED', statusCode: 503 });
        assert.equal(transactions, before);
        for (const limit of [0, -1, 51, 1.5]) {
          await assert.rejects(service.readDocumentVersion(reader, { documentVersionId: 'DV-R01', limit }),
            { code: 'TDMS_DOCUMENT_SOURCE_LIMIT_INVALID' });
        }
      });
      await t.test('R01 stays readable after same-version correction, R02 rebinding and a late older R01', async () => {
        const scope = scopes[0];
        const target = { sourceKey: scope.sourceKey, sourceInstanceId: scope.sourceInstanceId, scopeId: scope.scopeId };
        const update = async (packageId, expected, businessRevision, technicalRevision, time, body) => {
          const input = packet(scope.scopeId);
          input.packageId = packageId;
          input.observedAt = time;
          const record = input.records[0];
          record.expectedHeadRevisionRef = expected;
          record.observedAt = time;
          record.sourceVersion.rawRevision = technicalRevision;
          record.businessVersion.rawRevision = businessRevision;
          record.relatedDocumentVersionIds = [`DV-${businessRevision}`];
          record.content.conditions = [body];
          input.records = [record];
          return (await service.importPackage(writer, target, input)).recordRevisionRefs[0];
        };
        const r01 = await update('synthetic-r01-correction', firstHeads.get(scope.scopeId), 'R01', '0043',
          '2026-10-05T11:00:00Z', 'synthetic latest R01 revised source');
        const r02 = await update('synthetic-r02-rebind', r01, 'R02', '0044',
          '2026-10-05T12:00:00Z', 'synthetic R02 source');
        const late = await update('synthetic-r01-late', r02, 'R01', '0041',
          '2026-10-05T10:30:00Z', 'synthetic late older R01 source');
        const readAll = async (documentVersionId) => {
          const a = await service.readDocumentVersion(reader, { documentVersionId, limit: 50 });
          const b = a.hasMore ? await service.readDocumentVersion(reader, {
            documentVersionId, limit: 50, after: a.nextAfter,
          }) : { records: [] };
          return [...a.records, ...b.records];
        };
        const history = await readAll('DV-R01');
        assert.equal(history.length, 60, 'Multiple technical observations must not duplicate a version source object');
        const retained = history.filter(item => item.record.sourceRecordId === `synthetic-${scope.scopeId}-0`);
        assert.equal(retained.length, 1);
        assert.equal(retained[0].record.sourceRevisionRef, r01, 'Late acquisition must not supersede newer source observation');
        assert.equal(retained[0].record.selectedHead, false);
        assert.deepEqual(retained[0].record.content.conditions, ['synthetic latest R01 revised source']);
        assert.ok(history.every(item => item.record.sourceRevisionRef !== late && item.record.sourceRevisionRef !== r02));
        const current = (await readAll('DV-R02')).filter(item =>
          item.record.sourceRecordId === `synthetic-${scope.scopeId}-0`);
        assert.equal(current.length, 1);
        assert.equal(current[0].record.sourceRevisionRef, r02);
        assert.equal(current[0].record.selectedHead, true);
        assert.deepEqual(current[0].record.content.conditions, ['synthetic R02 source']);
        const after = await counts();
        assert.equal(after.tdms_record, 180);
        assert.equal(after.tdms_record_revision, 183);
        assert.equal(after.tdms_capture, 5);
        assert.equal(acquisitions, 0);
      });
      t.diagnostic(`SYNTHETIC_LOCAL_ONLY candidate=${candidateRoot}; ${JSON.stringify(owned.identity)}; no production identity or source authorization verified`);
    } finally {
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
      await owned.stop();
    }
  });
