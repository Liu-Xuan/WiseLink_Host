import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidateRoot = await realpath(process.env.WISELINK_TDMS_P1_TEST_ROOT ?? testRoot);
process.env.TS_NODE_PROJECT = join(candidateRoot, 'tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { LcmSourceReadingService, lcmBrowserQuery } = require(
  join(candidateRoot, 'server/modules/lcm-export-staging/lcm-source-reading.service.ts'),
);
const { UnconfiguredLcmSourceReadAuthorization, UnconfiguredLcmSnapshotReadRepository } = require(
  join(candidateRoot, 'server/modules/lcm-export-staging/lcm-source-reading.port.ts'),
);
const { actor } = require(join(testRoot, 'test/unit/tdms-source/tdms-fixtures.ts'));
const oldId = 'a'.repeat(64), newId = 'b'.repeat(64);
const summary = (snapshotId = oldId) => ({
  snapshotId, sourceInstanceId: 'synthetic-lcm-source', collectionId: 'synthetic-collection',
  scopeKey: 'synthetic-scope', originalFileName: 'synthetic-export.xls',
  originalSha256: 'c'.repeat(64), originalByteLength: 1000,
  originalAvailability: 'LOCAL_REFERENCE_ONLY', sourceObservedAt: null,
  sourceObservedDate: '2026-10-08', sourceTimeZone: 'Asia/Shanghai', sourceTimePrecision: 'day',
  sourceExportedAt: '2026-10-09T08:00:00', sourceDataCutoffDate: '2026-10-08',
  importedAt: '2026-10-11T01:00:00Z', sourceEffectiveAt: null,
  coveredAircraftModels: ['SYNTHETIC-MODEL'], coveredAircraftCount: 1, recordCount: 1,
  completeness: 'UNVERIFIED', sourceAuthority: 'unverified/local', candidateOnly: true,
  liveExternalVerified: false,
});
const sourceRecord = (value = 'unexpected') => ({
  recordId: `lcm-record:${'d'.repeat(64)}`, identityKey: 'synthetic-row',
  aircraftModel: 'SYNTHETIC-MODEL', tailNumber: 'SYNTHETIC-TAIL', partNumber: null,
  fields: { '矩阵值': value, '来源（EO）': 'synthetic source text', '状态': '新生效' },
  observation: 'unknown-value', allowed: null, installed: null,
  semanticBasis: 'user-confirmed-matrix-definition', effectiveAt: null, executedAt: null,
  originalEo: 'synthetic source text', sourceRows: [],
});

// These injected decisions and records are local doubles. No real login, source authority or model is used.
function setup() {
  const subject = actor();
  let grant = { applicationScopeId: subject.applicationScopeId,
    scope: { tenantId: subject.tenantId, actorId: subject.canonicalSubject.id,
      authorizedSourceInstanceIds: ['synthetic-lcm-source'] },
    authorityRef: 'synthetic-current-source-decision', permissionRevision: 'synthetic-r1' };
  let snapshots = [summary(oldId), summary(newId)];
  let selected = summary(oldId);
  let records = [sourceRecord()];
  let afterRead = () => {};
  const calls = { authorization: 0, catalogue: 0, snapshot: 0, queries: [] };
  const authorization = { available: true, authorize: async () => {
    calls.authorization++;
    return structuredClone(grant);
  } };
  const repository = { available: true,
    catalogue: async (_scope, query) => {
      calls.catalogue++; calls.queries.push(query); afterRead();
      return { snapshots: structuredClone(snapshots), hasMore: false, nextAfter: null };
    },
    snapshot: async (_scope, _id, query) => {
      calls.snapshot++; calls.queries.push(query); afterRead();
      return { snapshot: structuredClone(selected), records: structuredClone(records), hasMore: false, nextAfter: null };
    } };
  return { subject, calls, repository, authorization,
    service: new LcmSourceReadingService(authorization, repository),
    setGrant: value => { grant = value; }, grant: () => structuredClone(grant),
    setSnapshots: value => { snapshots = value; },
    setSelected: value => { selected = value; },
    setRecords: value => { records = value; },
    afterRead: callback => { afterRead = callback; } };
}

test('LCM defaults expose unavailable rather than an empty successful fleet', async () => {
  const service = new LcmSourceReadingService(new UnconfiguredLcmSourceReadAuthorization(),
    new UnconfiguredLcmSnapshotReadRepository());
  await assert.rejects(service.catalogue(actor(), {}), { code: 'LCM_SOURCE_READING_UNCONFIGURED', statusCode: 503 });
  await assert.rejects(service.snapshot(actor(), oldId, {}), { code: 'LCM_SOURCE_READING_UNCONFIGURED', statusCode: 503 });
});

test('actual Nest LCM module resolves closed default providers without any database connection', async () => {
  const { Test } = require('@nestjs/testing');
  const { LcmSourceReadingModule } = require(join(candidateRoot,
    'server/modules/lcm-export-staging/lcm-source-reading.module.ts'));
  const module = await Test.createTestingModule({ imports: [LcmSourceReadingModule] }).compile();
  try {
    const service = module.get(LcmSourceReadingService);
    await assert.rejects(service.catalogue(actor(), {}),
      { code: 'LCM_SOURCE_READING_UNCONFIGURED', statusCode: 503 });
    await assert.rejects(service.snapshot(actor(), oldId, {}),
      { code: 'LCM_SOURCE_READING_UNCONFIGURED', statusCode: 503 });
    assert.throws(() => LcmSourceReadingModule.register({
      authorizationProvider: { provide: 'browser-supplied-ACL', useValue: {} },
      repositoryProvider: { provide: 'browser-supplied-database', useValue: {} },
    }), { code: 'LCM_SERVER_PROVIDER_BINDING_INVALID' });
  } finally { await module.close(); }
});

test('LCM browser selectors cannot carry identity, permission, source scope or SQL', async () => {
  for (const key of ['tenantId', 'actorId', 'applicationScopeId', 'authorizedSourceInstanceIds', 'sourceInstanceId', 'sql']) {
    const s = setup();
    await assert.rejects(s.service.catalogue(s.subject, { [key]: 'forged' }),
      { code: 'LCM_BROWSER_QUERY_INVALID', statusCode: 400 });
    assert.equal(s.calls.authorization, 0);
    assert.equal(s.calls.catalogue, 0);
  }
  for (const limit of [0, -1, 51, 1.5, '1.0', '01', '1 OR TRUE']) {
    assert.throws(() => lcmBrowserQuery({ limit }), { code: 'LCM_BROWSER_QUERY_INVALID' });
  }
  assert.deepEqual(lcmBrowserQuery({ aircraftModel: ' SYNTHETIC-MODEL ', system: 'system', ata: '27',
    softwareName: 'name', position: 'FIN-A', limit: '5' }),
  { aircraftModel: 'SYNTHETIC-MODEL', system: 'system', ata: '27', softwareName: 'name', position: 'FIN-A', limit: 5 });
});

test('LCM mismatched current actor, tenant and app decisions fail before any store read', async () => {
  for (const field of ['actorId', 'tenantId', 'applicationScopeId']) {
    const s = setup(), grant = s.grant();
    if (field === 'applicationScopeId') grant.applicationScopeId = 'other-app';
    else grant.scope[field] = 'other';
    s.setGrant(grant);
    await assert.rejects(s.service.catalogue(s.subject, {}), { code: 'LCM_SOURCE_ACCESS_DENIED', statusCode: 403 });
    assert.equal(s.calls.catalogue, 0);
  }
  const s = setup(), anonymous = { ...s.subject, canonicalSubject: { ...s.subject.canonicalSubject, id: '-1' } };
  await assert.rejects(s.service.catalogue(anonymous, {}), { code: 'TDMS_VERIFIED_PUBLIC_ACTOR_REQUIRED' });
  assert.equal(s.calls.authorization, 0);
});

test('LCM source, snapshot and effectivity declarations cannot escape their exact source grant', async () => {
  for (const change of [ { sourceInstanceId: 'ungranted-source' }, { candidateOnly: false },
    { liveExternalVerified: true }, { sourceAuthority: 'formal' }, { sourceEffectiveAt: '2026-10-08' } ]) {
    const s = setup(); s.setSnapshots([{ ...summary(), ...change }]);
    await assert.rejects(s.service.catalogue(s.subject, {}), { code: 'LCM_SNAPSHOT_BINDING_INVALID', statusCode: 409 });
  }
  const s = setup(); s.setSelected(summary(newId));
  await assert.rejects(s.service.snapshot(s.subject, oldId, {}), { code: 'LCM_SNAPSHOT_BINDING_INVALID', statusCode: 409 });
});

test('LCM revoked or changed current permission is rechecked after both catalogue and snapshot reads', async () => {
  for (const operation of ['catalogue', 'snapshot']) {
    const s = setup();
    s.afterRead(() => s.setGrant({ ...s.grant(), permissionRevision: 'synthetic-r2' }));
    const promise = operation === 'catalogue'
      ? s.service.catalogue(s.subject, {}) : s.service.snapshot(s.subject, oldId, {});
    await assert.rejects(promise, { code: 'LCM_SOURCE_PERMISSION_CHANGED', statusCode: 409 });
    assert.equal(s.calls.authorization, 2);
  }
});

test('LCM retains separate cutoff, export and import time, unknown effectivity and original raw status', async () => {
  const s = setup();
  const catalogue = await s.service.catalogue(s.subject, { limit: 2 });
  assert.deepEqual(catalogue.snapshots.map(item => item.snapshotId), [oldId, newId]);
  const result = await s.service.snapshot(s.subject, oldId, { tailNumber: 'SYNTHETIC-TAIL', limit: 1 });
  assert.equal(result.snapshot.snapshotId, oldId);
  assert.equal(result.snapshot.sourceObservedDate, '2026-10-08');
  assert.equal(result.snapshot.sourceDataCutoffDate, '2026-10-08');
  assert.equal(result.snapshot.sourceExportedAt, '2026-10-09T08:00:00');
  assert.equal(result.snapshot.importedAt, '2026-10-11T01:00:00Z');
  assert.equal(result.snapshot.sourceObservedAt, null);
  assert.equal(result.snapshot.sourceEffectiveAt, null);
  assert.equal(result.snapshot.originalAvailability, 'LOCAL_REFERENCE_ONLY');
  assert.equal(result.snapshot.completeness, 'UNVERIFIED');
  assert.deepEqual(result.records[0], sourceRecord());
  assert.equal(result.records[0].fields['状态'], '新生效');
  assert.equal(result.records[0].allowed, null);
  assert.equal(result.records[0].installed, null);
  assert.equal(result.records[0].effectiveAt, null);
  assert.equal(s.calls.catalogue, 1);
  assert.equal(s.calls.snapshot, 1);
});

test('LCM empty matching rows preserve the selected snapshot and do not assert absent installation', async () => {
  const s = setup(); s.setRecords([]);
  const result = await s.service.snapshot(s.subject, oldId, { partNumber: 'NO-MATCH' });
  assert.equal(result.snapshot.snapshotId, oldId);
  assert.deepEqual(result.records, []);
  assert.equal(result.snapshot.completeness, 'UNVERIFIED');
  assert.equal(result.hasMore, false);
  assert.equal(result.nextAfter, null);
});
