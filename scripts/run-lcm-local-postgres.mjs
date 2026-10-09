import nodeAssert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { postgresCapability, startOwnedPostgres } from '../test/pg/owned-postgres-cluster.mjs';

const require = createRequire(import.meta.url);
const assertionStatistics = { count: 0 };
const assert = new Proxy(nodeAssert, { get(target, property) {
  const value = Reflect.get(target, property);
  if (typeof value !== 'function') return value;
  return (...args) => { assertionStatistics.count += 1; return Reflect.apply(value, target, args); };
} });
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const XLSX = require('xlsx');
const { parseLcmExport } = require('../server/modules/lcm-export-staging/lcm-export.parser.ts');
const { stageLcmExport } = require('../server/modules/lcm-export-staging/lcm-export.store.ts');
const { LcmConfigurationRepository, setDatabaseActor } = require('../server/modules/lcm-export-staging/lcm-configuration.repository.ts');
const { LcmConfigurationQueryService } = require('../server/modules/lcm-export-staging/lcm-configuration.query.ts');

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function options(args) {
  const mode = args.shift();
  assert.ok(['verify', 'query'].includes(mode), 'Expected verify or query');
  const allowed = mode === 'verify' ? ['--evidence-dir', '--manifest'] : ['--restore', '--request', '--output'];
  const result = { mode };
  while (args.length) {
    const key = args.shift(), value = args.shift();
    assert.ok(allowed.includes(key) && value && !value.startsWith('--') && !(key in result), 'Invalid local runner flags');
    result[key] = value;
  }
  return result;
}
async function command(file, args) {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  assert.equal(code, 0, `Owned local PostgreSQL command failed: ${errors}`);
}
async function privateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await chmod(path, 0o600);
}
function syntheticBytes(mark) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['ATA章', '系统', '类型', '软件名称', '软件件号', 'B-7800'],
    ['27', 'SYNTHETIC', 'SYNTHETIC', 'SYNTHETIC ONLY', 'TEST-PN', mark],
  ]), 'Sheet0');
  return XLSX.write(book, { type: 'buffer', bookType: 'xls' });
}
function fixture(id, mark, time, overrides = {}) {
  const bytes = syntheticBytes(mark);
  return {
    scope: { tenantId: 'synthetic-tenant', actorId: 'synthetic-actor', authorizedSourceInstanceIds: ['synthetic-lcm', 'synthetic-tdms'] },
    sourceInstanceId: 'synthetic-lcm', requestId: 'request-' + id,
    context: { schemaVersion: 'wiselink.lcm.collection_context.v1', collectionId: id, sourceOrigin: 'local-file',
      pageUrl: null, filters: { aircraftModel: 'B787-9', status: 'synthetic-scope' }, observedAt: time,
      sourceEvidence: 'Synthetic fixture, not a business record' },
    originalFileName: 'synthetic.xls', localSourcePath: 'synthetic-fixture-only', rawSha256: sha(bytes),
    rawByteLength: bytes.length, artifactRef: 'synthetic-artifact:' + sha(bytes), parsed: parseLcmExport(bytes, 'B787-9'),
    externalReferences: [], ...overrides,
  };
}

async function syntheticVerification(cluster, connection) {
  const startCount = assertionStatistics.count;
  const repo = new LcmConfigurationRepository(connection), queries = new LcmConfigurationQueryService(connection);
  const first = fixture('A', 1, '2026-10-01T12:00:00Z');
  first.externalReferences.push({ sourceRecordId: first.parsed.records[0].recordId,
    targetTenantId: first.scope.tenantId, targetSourceInstanceId: 'synthetic-tdms', targetKind: 'TDMS_RECORD',
    targetId: 'synthetic-tdms-record', targetVersionId: 'synthetic-revision-1',
    relation: 'EXPLICIT_REFERENCE_CANDIDATE', evidence: 'Synthetic explicit reference, no real TDMS match' });
  const a = await repo.importSnapshot(first), replay = await repo.importSnapshot(first);
  assert.equal(replay.replayed, true); assert.equal(replay.snapshotId, a.snapshotId);
  for (const authorizedSourceInstanceIds of [
    ['synthetic-tdms', 'synthetic-lcm'],
    ['synthetic-tdms', 'synthetic-extra', 'synthetic-lcm'],
    ['synthetic-lcm', 'synthetic-tdms'],
  ]) {
    const changedGrants = await repo.importSnapshot({ ...first,
      scope: { ...first.scope, authorizedSourceInstanceIds } });
    assert.equal(changedGrants.replayed, true); assert.equal(changedGrants.snapshotId, a.snapshotId);
  }
  await assert.rejects(repo.importSnapshot({ ...first,
    scope: { ...first.scope, authorizedSourceInstanceIds: ['synthetic-tdms'] } }), { code: 'SOURCE_ACCESS_DENIED' });
  await assert.rejects(repo.importSnapshot({ ...first,
    scope: { ...first.scope, authorizedSourceInstanceIds: ['synthetic-lcm'] } }), { code: 'REFERENCE_ACCESS_DENIED' });
  const [replayCount] = await cluster.admin`SELECT count(*)::int AS n FROM lcm_source_collection`;
  assert.equal(replayCount.n, 1, 'Changed grants may replay but never append another collection');
  await assert.rejects(repo.importSnapshot({ ...first, originalFileName: 'changed.xls' }), { code: 'IMPORT_REPLAY_CONFLICT' });
  const b = await repo.importSnapshot(fixture('B', 2, '2026-10-02T12:00:00Z'));
  const again = await repo.importSnapshot(fixture('A-again', 1, '2026-10-03T12:00:00Z'));
  assert.notEqual(a.snapshotId, again.snapshotId);
  const query = { scope: first.scope, tailNumber: 'B-7800', partNumber: 'TEST-PN', limit: 50 };
  const old = await queries.asOf({ ...query, asOf: '2026-10-02T23:00:00Z' });
  assert.equal(old.entries.length, 1); assert.equal(old.entries[0].snapshotId, b.snapshotId);
  assert.equal(old.entries[0].record.installed, false);
  await repo.importSnapshot(fixture('late-arrival', 2, '2026-10-01T18:00:00Z'));
  const latest = await queries.asOf({ ...query, asOf: '2026-10-03T23:00:00Z' });
  assert.equal(latest.entries[0].snapshotId, again.snapshotId);
  await repo.importSnapshot(fixture('unknown-source-time', null, null));
  const unknownExcluded = await queries.asOf({ ...query, asOf: '2026-10-03T23:00:00Z' });
  assert.equal(unknownExcluded.entries[0].snapshotId, again.snapshotId);
  assert.equal(unknownExcluded.unknownObservedTimesExcluded, true);
  const all = await queries.history(query);
  assert.equal(all.entries.length, 5); assert.ok(all.entries.some((entry) => entry.sourceObservedAt === null));
  const graph = await queries.neighborhood(query);
  assert.equal(graph.relations.length, 1); assert.equal(graph.relations[0].targetVersionId, 'synthetic-revision-1');
  const withoutTarget = await queries.neighborhood({ ...query, scope: { ...first.scope, authorizedSourceInstanceIds: ['synthetic-lcm'] } });
  assert.equal(withoutTarget.relations.length, 0);
  assert.equal((await queries.history({ ...query, scope: { ...first.scope, actorId: 'other-actor' } })).entries.length, 0);
  assert.equal((await queries.history({ ...query, scope: { ...first.scope, tenantId: 'other-tenant' } })).entries.length, 0);
  assert.equal((await queries.history({ ...query, scope: { ...first.scope, authorizedSourceInstanceIds: ['other-source'] } })).entries.length, 0);
  await assert.rejects(queries.history({ ...query, limit: 501 }), { code: 'QUERY_LIMIT_INVALID' });
  await assert.rejects(repo.importSnapshot({ ...fixture('bad-reference', 1, null), externalReferences: [
    { ...first.externalReferences[0], targetTenantId: 'other-tenant' },
  ] }), { code: 'REFERENCE_ACCESS_DENIED' });
  const [countBefore] = await cluster.admin`SELECT count(*)::int AS n FROM lcm_source_collection`;
  await cluster.admin.unsafe(`CREATE FUNCTION lcm_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.original_file_name='fail-test.xls' THEN RAISE EXCEPTION 'synthetic injected failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER lcm_fixture_failure BEFORE INSERT ON lcm_configuration_snapshot FOR EACH ROW EXECUTE FUNCTION lcm_fixture_fail()`);
  await assert.rejects(repo.importSnapshot(fixture('rollback', 1, null, { originalFileName: 'fail-test.xls' })));
  const [countAfter] = await cluster.admin`SELECT count(*)::int AS n FROM lcm_source_collection`;
  assert.equal(countAfter.n, countBefore.n);
  await cluster.admin.unsafe('DROP TRIGGER lcm_fixture_failure ON lcm_configuration_snapshot; DROP FUNCTION lcm_fixture_fail()');
  await assert.rejects(connection`UPDATE lcm_configuration_snapshot SET original_file_name='forbidden'`, { code: '42501' });
  await assert.rejects(connection`DELETE FROM lcm_configuration_snapshot`, { code: '42501' });
  assert.equal((await connection`SELECT * FROM lcm_configuration_snapshot`).length, 0, 'Unset RLS scope cannot read rows');
  await assert.rejects(cluster.admin`UPDATE lcm_configuration_snapshot SET original_file_name='forbidden'`, { code: '55000' });
  const missing = fixture('latest-tail-missing', 1, '2026-10-04T12:00:00Z');
  const missingBytes = (() => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['ATA章','系统','类型','软件名称','软件件号','B-7801'], ['27','SYNTHETIC','SYNTHETIC','SYNTHETIC ONLY','TEST-PN',1],
    ]), 'Sheet0');
    return XLSX.write(book,{type:'buffer',bookType:'xls'});
  })();
  missing.parsed = parseLcmExport(missingBytes,'B787-9');
  missing.rawSha256 = sha(missingBytes); missing.rawByteLength = missingBytes.length;
  await repo.importSnapshot(missing);
  assert.equal((await queries.asOf({...query,asOf:'2026-10-04T23:00:00Z'})).entries.length,0,
    'Choose latest scope snapshot before filtering a missing tail');
  const daily = fixture('day-precision', 1, null);
  daily.context.systemStateDate='2026-10-08'; daily.context.systemStateTimeZone='Asia/Shanghai';
  daily.context.systemStateDateBasis='user-confirmed-system-state';
  await repo.importSnapshot(daily);
  const byDay=await queries.asOf({...query,asOfDate:'2026-10-08',timeZone:'Asia/Shanghai'});
  assert.equal(byDay.entries[0].sourceObservedDate,'2026-10-08');
  assert.equal(byDay.entries[0].sourceObservedAt,null);
  assert.equal(byDay.entries[0].sourceTimePrecision,'day');
  await assert.rejects(queries.asOf({...query,asOf:'2026-10-08T23:00:00Z'}),{code:'SOURCE_TIME_PRECISION_INSUFFICIENT'});
  await repo.importSnapshot(fixture('newer-instant',2,'2026-10-09T12:00:00Z'));
  assert.equal((await queries.asOf({...query,asOfDate:'2026-10-09',timeZone:'Asia/Shanghai'})).entries[0].record.installed,false,
    'Newer instant date must not be hidden by an older day snapshot');
  const conflicting=fixture('conflicting-time',1,'2026-10-09T12:00:00Z');
  conflicting.context.systemStateDate='2026-10-08';conflicting.context.systemStateTimeZone='Asia/Shanghai';
  conflicting.context.systemStateDateBasis='user-confirmed-system-state';
  await assert.rejects(repo.importSnapshot(conflicting),{code:'COLLECTION_DATE_CONFLICT'});
  await repo.importSnapshot(fixture('same-day-later-instant',1,'2026-10-10T10:00:00Z'));
  await repo.importSnapshot(fixture('same-day-late-earlier-instant',2,'2026-10-10T09:00:00Z'));
  const sameDayInstant=await queries.asOf({...query,asOfDate:'2026-10-10',timeZone:'Asia/Shanghai'});
  assert.equal(sameDayInstant.entries[0].record.installed,true,'Late import of an earlier instant must not replace the later instant');
  assert.equal(sameDayInstant.entries[0].sourceObservedAt,'2026-10-10T10:00:00.000Z');
  assert.equal(sameDayInstant.entries[0].sameDayOrderingBasis,'source-observed-at');
  const sameDayCoarse=fixture('same-day-coarse-after-instants',2,null);
  sameDayCoarse.context.systemStateDate='2026-10-10';sameDayCoarse.context.systemStateTimeZone='Asia/Shanghai';
  sameDayCoarse.context.systemStateDateBasis='user-confirmed-system-state';
  await repo.importSnapshot(sameDayCoarse);
  const mixedDay=await queries.asOf({...query,asOfDate:'2026-10-10',timeZone:'Asia/Shanghai'});
  assert.equal(mixedDay.entries[0].sourceTimePrecision,'day');
  assert.equal(mixedDay.entries[0].sameDayOrderingBasis,'acquisition-sequence');
  return { checks: assertionStatistics.count-startCount, requestReplay: true,
    reorderedExpandedReducedGrantReplay: true, revokedSourceAndReferenceRejected: true,
    aToBToA: true, lateArrival: true, unknownObservedTime: true,
    tenantActorSourceIsolation: true, relationBothEnds: true, rollback: true, appendOnlyRole: true,
    latestMissingTail: true, dayPrecision: true, sameDayInstantLateArrival:true, mixedDayOrderingExplicit:true, syntheticOnly: true };
}

async function importManifest(manifestPath, evidenceDirectory, connection) {
  if (!manifestPath) return [];
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest.inputs) && manifest.inputs.length > 0);
  if(manifest.expectedAircraftModels) assert.deepEqual([...manifest.expectedAircraftModels].sort(),
    manifest.inputs.map(item=>item.aircraftModel).sort(),'Manifest expected models must exactly match supplied inputs');
  const repo = new LcmConfigurationRepository(connection), queries = new LcmConfigurationQueryService(connection);
  const results = [];
  for (const item of manifest.inputs) {
    process.stdout.write(JSON.stringify({phase:'real-import',aircraftModel:item.aircraftModel})+'\n');
    const contextPath = join(evidenceDirectory, 'contexts', sha(Buffer.from(JSON.stringify(item.context))) + '.json');
    await privateJson(contextPath, item.context);
    const opts = { inputPath: item.inputPath, aircraftModel: item.aircraftModel,
      stagingDirectory: join(evidenceDirectory, 'staging'), collectionContextPath: contextPath };
    const staged = await stageLcmExport(opts), restaged = await stageLcmExport(opts);
    assert.equal(restaged.status, 'unchanged'); assert.equal(restaged.snapshotId, staged.snapshotId);
    const observation = JSON.parse(await readFile(staged.observationPath, 'utf8'));
    const bytes = await readFile(join(opts.stagingDirectory, observation.artifactRef));
    assert.equal(sha(bytes), staged.rawSha256);
    const input = { scope: { tenantId: manifest.tenantId, actorId: manifest.actorId,
        authorizedSourceInstanceIds: [manifest.sourceInstanceId] }, sourceInstanceId: manifest.sourceInstanceId,
      requestId: item.context.collectionId, context: item.context, originalFileName: observation.originalFileName,
      localSourcePath: observation.localSourcePath, rawSha256: staged.rawSha256, rawByteLength: bytes.length,
      artifactRef: join(opts.stagingDirectory, observation.artifactRef), parsed: observation.parsed, externalReferences: [] };
    const stored = await repo.importSnapshot(input), replayed = await repo.importSnapshot(input);
    assert.equal(replayed.replayed, true); assert.equal(stored.snapshotId, replayed.snapshotId);
    const counts = { installedAndAllowed: 0, allowedOnly: 0, blank: 0, other: 0 };
    for (const record of input.parsed.records) {
      const key = record.observation === 'allowed-and-installed' ? 'installedAndAllowed'
        : record.observation === 'allowed-only' ? 'allowedOnly' : record.observation === 'unknown-blank' ? 'blank' : 'other';
      counts[key] += record.sourceRows.length;
    }
    const tail = input.parsed.records[0].tailNumber;
    const request = { scope: input.scope, tailNumber: tail, limit: 5 };
    const history = await queries.history(request), graph = await queries.neighborhood(request);
    assert.ok(history.entries.length > 0); assert.equal(graph.relations.length, 0);
    assert.ok(history.entries.every((entry) => entry.sourceExportedAt === null && entry.record.effectiveAt === null && entry.record.executedAt === null));
    await assert.rejects(queries.asOf({ ...request, asOf: '2026-10-09T00:00:00Z' }),
      {code:'SOURCE_TIME_PRECISION_INSUFFICIENT'},'Day precision cannot establish an exact instant');
    const dayAsOf=await queries.asOf({...request,asOfDate:item.context.systemStateDate,timeZone:'Asia/Shanghai'});
    assert.ok(dayAsOf.entries.length>0,'User-confirmed day-level system state is queryable');
    assert.ok(dayAsOf.entries.every(entry=>entry.sourceObservedDate===item.context.systemStateDate&&entry.sourceTimePrecision==='day'));
    if(results.length===0) await privateJson(join(evidenceDirectory,'query-day.request.json'),
      {action:'as-of',query:{...request,asOfDate:item.context.systemStateDate,timeZone:'Asia/Shanghai'}});
    results.push({ aircraftModel: item.aircraftModel, fileName: observation.originalFileName,
      rawSha256: staged.rawSha256, byteLength: bytes.length, snapshotId: stored.snapshotId,
      records: stored.recordCount, coordinates: stored.coordinateCount, counts,
      repeatedStaging: restaged.status, repeatedImport: replayed.replayed,
      historyReturned: history.entries.length, neighborhoodRelations: 0, observedAsOfReturned: 0,
      observedAsOfDateReturned:dayAsOf.entries.length,systemStateDate:item.context.systemStateDate,
      systemStateTimeZone:'Asia/Shanghai',sourceTimePrecision:'day',
      sourceOrigin: item.context.sourceOrigin, sourceAuthority: 'unverified/local', liveExternalVerified: false });
  }
  const scope={tenantId:manifest.tenantId,actorId:manifest.actorId,authorizedSourceInstanceIds:[manifest.sourceInstanceId]};
  await connection.begin(async(tx)=>{
    await setDatabaseActor(tx,scope);
    for(const result of results){
      const [persisted]=await tx`
        SELECT count(*)::int AS records,
          COALESCE(sum(jsonb_array_length(record_json->'sourceRows')),0)::int AS coordinates,
          count(*) FILTER (WHERE jsonb_typeof(record_json)='object')::int AS "jsonObjectRecords",
          COALESCE(sum(jsonb_array_length(record_json->'sourceRows')) FILTER (WHERE observation='allowed-and-installed'),0)::int AS "installedAndAllowed",
          COALESCE(sum(jsonb_array_length(record_json->'sourceRows')) FILTER (WHERE observation='allowed-only'),0)::int AS "allowedOnly",
          COALESCE(sum(jsonb_array_length(record_json->'sourceRows')) FILTER (WHERE observation='unknown-blank'),0)::int AS blank,
          COALESCE(sum(jsonb_array_length(record_json->'sourceRows')) FILTER (WHERE observation NOT IN ('allowed-and-installed','allowed-only','unknown-blank')),0)::int AS other
        FROM lcm_configuration_observation
        WHERE tenant_id=${scope.tenantId} AND owner_actor_id=${scope.actorId} AND snapshot_id=${result.snapshotId}`;
      assert.equal(persisted.records,result.records,'Persisted row count must match this snapshot');
      assert.equal(persisted.coordinates,result.coordinates,'Persisted raw source coordinate count must match');
      assert.equal(persisted.jsonObjectRecords,result.records,'Every record_json must be a JSON object');
      assert.deepEqual({installedAndAllowed:persisted.installedAndAllowed,allowedOnly:persisted.allowedOnly,
        blank:persisted.blank,other:persisted.other},result.counts,'Database state coordinate counts must match original parse');
      result.persistedDatabaseCounts=persisted;
    }
  });
  return results;
}

async function main() {
  const opts = options(process.argv.slice(2)), capability = await postgresCapability();
  assert.ok(capability.available, capability.reason);
  process.stdout.write(JSON.stringify({phase:'starting-owned-postgres'})+'\n');
  const cluster = await startOwnedPostgres(capability);
  try {
    if (opts.mode === 'query') {
      assert.ok(opts['--restore'] && opts['--request'] && opts['--output']);
      await command(join(dirname(capability.initdb), 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-privileges',
        '-h', '127.0.0.1', '-p', String(cluster.expected.port), '-U', 'tdms_test_owner',
        '-d', cluster.expected.database, resolve(opts['--restore'])]);
      const request = JSON.parse(await readFile(opts['--request'], 'utf8'));
      assert.ok(['history', 'as-of', 'neighborhood'].includes(request.action), 'Fixed query action required');
      const role='tdms_fixture_app_'+randomUUID().replaceAll('-','').slice(0,16);
      await cluster.admin.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        GRANT USAGE ON SCHEMA public TO ${role};GRANT SELECT ON lcm_source_artifact,lcm_source_collection,
          lcm_configuration_snapshot,lcm_configuration_observation,lcm_evidence_relation TO ${role}`);
      const query = new LcmConfigurationQueryService(await cluster.connect(role));
      const result = request.action === 'history' ? await query.history(request.query)
        : request.action === 'as-of' ? await query.asOf(request.query) : await query.neighborhood(request.query);
      await privateJson(resolve(opts['--output']), result);
      process.stdout.write(JSON.stringify({ action: request.action, entries: result.entries.length,
        outputPath: resolve(opts['--output']), candidateOnly: true,nonSuperuserConsumer:true }) + '\n');
      return;
    }
    assert.ok(opts['--evidence-dir'], 'Private evidence directory required');
    const evidenceDirectory = resolve(opts['--evidence-dir']);
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    const migration = await readFile(new URL('../migrations/0072_lcm_configuration_store.sql', import.meta.url), 'utf8');
    await cluster.admin.unsafe(migration);
    const role = 'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
    await cluster.admin.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT, INSERT ON lcm_source_artifact,lcm_source_collection,lcm_configuration_snapshot,
        lcm_configuration_observation,lcm_evidence_relation TO ${role}`);
    const connection = await cluster.connect(role);
    process.stdout.write(JSON.stringify({phase:'synthetic-verification'})+'\n');
    const synthetic = await syntheticVerification(cluster, connection);
    if(opts['--manifest']) await cluster.admin.unsafe('TRUNCATE lcm_evidence_relation,lcm_configuration_observation,lcm_configuration_snapshot,lcm_source_collection,lcm_source_artifact CASCADE');
    const realImports = await importManifest(opts['--manifest'], evidenceDirectory, connection);
    const dumpPath = join(evidenceDirectory, 'lcm-local-db.dump');
    await command(join(dirname(capability.initdb), 'pg_dump'), ['-Fc', '-h', '127.0.0.1', '-p', String(cluster.expected.port),
      '-U', 'tdms_test_owner', '-d', cluster.expected.database, '-f', dumpPath]);
    await chmod(dumpPath, 0o600);
    const dumpSha256 = sha(await readFile(dumpPath));
    await writeFile(dumpPath + '.sha256', dumpSha256 + '  lcm-local-db.dump\n', { mode: 0o600 });
    const report = { schemaVersion: 'wiselink.lcm.local_pg_verification.v1', migration: '0072_lcm_configuration_store.sql',
      isolatedOwnedPostgres: true, productionDatabaseTouched: false, synthetic, realImports, dumpPath, dumpSha256,
      backupIncludesSynthetic:Boolean(!opts['--manifest']),clusterCleanedOnExit: true, externalSystemsConnected: false,
      completedAircraftModels:realImports.map(item=>item.aircraftModel),completedModelCount:realImports.length };
    await cluster.stop();
    await privateJson(join(evidenceDirectory, 'verification.json'), report);
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { await cluster.stop(); }
}

main().catch((error) => { process.stderr.write(JSON.stringify({ code: error.code ?? 'LOCAL_VERIFICATION_FAILED',
  message: error.message }) + '\n'); process.exitCode = 1; });
