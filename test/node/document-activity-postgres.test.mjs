import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { DocumentActivityRunRepository } = require('../../server/modules/canonical-host/document-activity-run.repository.ts');
const databaseUrl = process.env.DOCUMENT_ACTIVITY_TEST_DATABASE_URL;
const scope = { tenantId: 'tenant-test', actorUserId: 'actor-one', documentVersionId: 'DV-test' };
const executionModel = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM5.3', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-12T00:00:00.000Z' };
const source = { parseRunId: 'PR-test', parseRevision: 1, semanticRevision: 1, manifestSha256: 'a'.repeat(64),
  selection: { sectionIds: ['section-test'] }, expectedRevision: 0, executionModel };
const range = { sectionId: 'section-test', offset: 0, unitIds: ['unit-test'], anchorIds: ['a1'], nextOffset: null };
const command = { candidate: { schemaVersion: 'wiselink.document.activity-candidate.v1', statements: [] },
  producer: { skillVersion: 'isolated-test', modelVersion: 'not-called' } };
const v2Schema = 'wiselink.document.activity-candidate.v2';
const productionContract = { promptVersion: 'isolated-v2-fixture', toolSchemaSha256: 'b'.repeat(64),
  sourceContextVersion: 'wiselink.document.activity-source-context.v1',
  quoteTransportVersion: 'wiselink.document.activity-quote-offsets.v1' };
const clients = [];
const exactBinding = { original: { documentVersionId: 'DV-test', parseRunId: 'PR-test', parseRevision: 1,
  sourceArtifactId: 'ART-test', sourceSha256: 'a'.repeat(64), sourceByteLength: 1234 }, semanticRevision: 1 };
const rawV2Statement = { statementId: 'DAS-v2-source', statementKey: 'source-local', label: 'Source raw semantics',
  quotes: [{ anchorId: 'a1', start: 0, end: 18, text: 'TBD after approval' }], subject: null, action: null, modality: null,
  status: { raw: 'TBD', quoteIndex: 0, meaning: 'UNKNOWN' },
  times: [{ raw: 'TBD', quoteIndex: 0, role: 'TARGET', precision: 'UNKNOWN', expression: 'TBD' },
    { raw: 'after approval', quoteIndex: 0, role: 'CONDITION', precision: 'UNKNOWN', expression: 'RELATIVE' }],
  technicalIds: [], scope: { sectionIds: ['section-test'], conditions: [], completeness: 'DELIVERED_SCOPE_ONLY' },
  limitations: ['Constructed SQL storage fixture only.'] };
let legacyBefore;

async function actor(role, userId) {
  // Dedicated one-connection clients prevent session identity from crossing actors.
  const client = postgres(databaseUrl, { max: 1, onnotice() {} });
  clients.push(client);
  assert.ok(['authenticated', 'service_role'].includes(role));
  await client.unsafe(`SET ROLE ${role}`);
  await client`SELECT set_config('app.user_id',${userId},false)`;
  return { client, repository: new DocumentActivityRunRepository(drizzle(client)) };
}
function materialize(run, revision) {
  return { schemaVersion: 'wiselink.document.activity-candidate.v1', candidateOnly: true,
    runRef: run.runRef, candidateRevision: revision, statements: [],
    sourceBinding: { original: { documentVersionId: scope.documentVersionId, parseRunId: source.parseRunId, parseRevision: 1 }, semanticRevision: 1 },
    readCoverage: { status: 'DELIVERED_RANGES_ONLY', selection: run.selection, deliveredRanges: run.deliveredRanges, sourceCoverage: {} },
    sourceAnchors: [], producer: command.producer, savedAt: '2026-09-16T00:00:00Z' };
}
function databaseConstraint(error, name) {
  for (let current = error; current; current = current.cause)
    if (current.code === '23514' && current.constraint_name === name) return true;
  return false;
}

test('source activity PostgreSQL request, leases, CAS, immutable revisions and source RLS', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/wiselink_activity_test(?:_[a-z0-9_]+)?$/u);
  const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
  try {
    await reset(admin);
    const one = await actor('service_role', 'actor-one');
    const concurrent = await actor('service_role', 'actor-one');
    const two = await actor('service_role', 'actor-two');
    const browser = await actor('authenticated', 'actor-two');
    const foreign = await actor('authenticated', 'actor-foreign');
    let saved;
    let v2Run;
    let v2Saved;

    await t.test('0074 migrates existing frozen v1 and active rows without rewriting history or inventing producer provenance', async () => {
      const rows = await admin`SELECT run_ref,candidate_schema_version,production_contract_json,result_json::text AS raw
        FROM dm_document_activity_run WHERE run_ref IN ('DAR-legacy-saved','DAR-legacy-active') ORDER BY run_ref`;
      assert.equal(rows.length, 2);
      assert.ok(rows.every(row => row.candidate_schema_version === 'wiselink.document.activity-candidate.v1' && row.production_contract_json === null));
      assert.equal(rows.find(row => row.run_ref === 'DAR-legacy-saved').raw, legacyBefore);
      assert.equal(rows.find(row => row.run_ref === 'DAR-legacy-active').raw, null);
      const legacy = JSON.parse(legacyBefore);
      assert.equal(legacy.productionContract, undefined);
      assert.equal(legacy.candidateSchemaVersion, undefined);
      await assert.rejects(admin`UPDATE dm_document_activity_run SET candidate_schema_version=${v2Schema}
        WHERE run_ref='DAR-legacy-active'`, /DOCUMENT_ACTIVITY_REQUEST_IMMUTABLE/);
      await assert.rejects(admin`UPDATE dm_document_activity_run SET production_contract_json=${admin.json(productionContract)}
        WHERE run_ref='DAR-legacy-active'`, /DOCUMENT_ACTIVITY_REQUEST_IMMUTABLE/);
      await assert.rejects(admin`UPDATE dm_document_activity_run SET result_json='{}'::jsonb
        WHERE run_ref='DAR-legacy-saved'`, /DOCUMENT_ACTIVITY_TERMINAL_IMMUTABLE/);
    });

    await t.test('same request is idempotent; conflicts and native writes are rejected', async () => {
      const first = await one.repository.begin(scope, { ...source, requestId: 'request-one' });
      const replay = await one.repository.begin(scope, { ...source, requestId: 'request-one' });
      assert.equal(first.runRef, replay.runRef);
      await assert.rejects(one.repository.begin(scope, { ...source, requestId: 'request-one', expectedRevision: 1 }), /REQUEST_CONFLICT/);
      await assert.rejects(browser.repository.begin({ ...scope, actorUserId: 'actor-two' }, { ...source, requestId: 'native' }));
      assert.equal(await browser.repository.readRun({ ...scope, actorUserId: 'actor-two' }, first.runRef), null);
      assert.equal(await two.repository.readRun({ ...scope, actorUserId: 'actor-two' }, first.runRef), null);
    });

    await t.test('only one lease wins; exact delivery and SAVE replay retain one immutable revision', async () => {
      const row = await one.repository.readRequest(scope, 'request-one');
      const claims = await Promise.all([one.repository.claim(scope, row.runRef, 'producer-one'), concurrent.repository.claim(scope, row.runRef, 'producer-two')]);
      assert.equal(claims.filter(Boolean).length, 1);
      const fence = claims.find(Boolean);
      await one.repository.recordDelivery(scope, fence, range);
      await one.repository.recordDelivery(scope, fence, range);
      assert.equal((await one.repository.readRun(scope, row.runRef)).deliveredRanges.length, 1);
      await assert.rejects(one.repository.recordDelivery(scope, fence, { ...range, anchorIds: ['forged'] }), /DELIVERY_CONFLICT/);
      saved = await one.repository.save(scope, fence, command, materialize);
      assert.equal(saved.candidateRevision, 1);
      assert.deepEqual(await one.repository.save(scope, fence, command, () => { throw new Error('must not regenerate'); }), saved);
      await assert.rejects(one.repository.save(scope, fence, { ...command, candidate: { changed: true } }, materialize), /SAVE_REPLAY_CONFLICT/);
      await assert.rejects(one.client`UPDATE dm_document_activity_run SET result_json='{}'::jsonb WHERE run_ref=${row.runRef}`);
      const privateFields = await browser.client`SELECT lease_token,lease_owner,lease_expires_at FROM dm_document_activity_run WHERE run_ref=${row.runRef}`;
      assert.deepEqual(privateFields[0], { lease_token: null, lease_owner: null, lease_expires_at: null });
    });

    await t.test('authorized readers see exact saved revisions; another tenant and revoked readers do not', async () => {
      assert.deepEqual(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 1), saved);
      assert.equal(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 9), null);
      assert.equal(await foreign.repository.readSaved({ ...scope, actorUserId: 'actor-foreign' }, source.parseRunId, 1), null);
      await admin`DELETE FROM work_item WHERE requested_by_user_id='actor-two'`;
      assert.equal(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 1), null);
      await admin`INSERT INTO work_item VALUES ('tenant-test','DV-test','actor-two')`;
    });

    await t.test('concurrent requests with the same expected revision cannot both SAVE', async () => {
      const a = await one.repository.begin(scope, { ...source, requestId: 'race-a', expectedRevision: 1 });
      const b = await concurrent.repository.begin(scope, { ...source, requestId: 'race-b', expectedRevision: 1 });
      const fa = await one.repository.claim(scope, a.runRef, 'race-a');
      const fb = await concurrent.repository.claim(scope, b.runRef, 'race-b');
      await one.repository.recordDelivery(scope, fa, range);
      await concurrent.repository.recordDelivery(scope, fb, range);
      const saves = await Promise.allSettled([one.repository.save(scope, fa, command, materialize), concurrent.repository.save(scope, fb, command, materialize)]);
      assert.equal(saves.filter(value => value.status === 'fulfilled').length, 1);
      assert.match(String(saves.find(value => value.status === 'rejected').reason), /REVISION_CONFLICT/);
      assert.equal((await one.repository.readSaved(scope, source.parseRunId)).candidateRevision, 2);
      assert.deepEqual(await one.repository.readSaved(scope, source.parseRunId, 1), saved);
    });

    await t.test('reclaimed, cancelled and expired leases cannot publish a later result', async () => {
      const row = await one.repository.begin(scope, { ...source, requestId: 'reclaim', expectedRevision: 2 });
      const old = await one.repository.claim(scope, row.runRef, 'old');
      await admin`UPDATE dm_document_activity_run SET lease_expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE run_ref=${row.runRef}`;
      const fresh = await one.repository.claim(scope, row.runRef, 'new');
      assert.equal(fresh.leaseGeneration, old.leaseGeneration + 1);
      await assert.rejects(one.repository.recordDelivery(scope, old, range), /LEASE_REJECTED/);
      await one.repository.cancel(scope, row.runRef);
      assert.equal(await one.repository.renew(scope, fresh), false);
      await assert.rejects(one.repository.save(scope, fresh, command, materialize), /LEASE_REJECTED/);
      const deadline = await one.repository.begin(scope, { ...source, requestId: 'expired', expectedRevision: 2 });
      // Only the isolated DB owner advances this fixture's deadline; production
      // code cannot change the immutable admission deadline.
      await admin.unsafe('ALTER TABLE dm_document_activity_run DISABLE TRIGGER document_activity_run_guard');
      await admin`UPDATE dm_document_activity_run SET deadline_at=CURRENT_TIMESTAMP-interval '1 second' WHERE run_ref=${deadline.runRef}`;
      await admin.unsafe('ALTER TABLE dm_document_activity_run ENABLE TRIGGER document_activity_run_guard');
      assert.equal(await one.repository.claim(scope, deadline.runRef, 'too-late'), null);
      assert.equal((await one.repository.readRun(scope, deadline.runRef)).status, 'EXPIRED');
    });

    await t.test('0074 rejects malformed v2 contracts and makes admitted schema/producer pins immutable', async () => {
      const input = { ...source, requestId: 'v2-contract', expectedRevision: 2,
        candidateSchemaVersion: v2Schema, productionContract };
      await assert.rejects(one.repository.begin(scope, { ...input, requestId: 'v2-invalid-contract',
        productionContract: { ...productionContract, toolSchemaSha256: 'invalid' } }),
      error => databaseConstraint(error, 'document_activity_production_contract_shape'));
      assert.equal(await one.repository.readRequest(scope, 'v2-invalid-contract'), null);
      v2Run = await one.repository.begin(scope, input);
      assert.equal(v2Run.candidateSchemaVersion, v2Schema);
      assert.deepEqual(v2Run.productionContract, productionContract);
      await assert.rejects(one.client`UPDATE dm_document_activity_run
        SET candidate_schema_version='wiselink.document.activity-candidate.v1',production_contract_json=NULL
        WHERE run_ref=${v2Run.runRef}`, /DOCUMENT_ACTIVITY_REQUEST_IMMUTABLE/);
      await assert.rejects(one.client`UPDATE dm_document_activity_run
        SET production_contract_json=${JSON.stringify({ ...productionContract, promptVersion: 'changed' })}::jsonb
        WHERE run_ref=${v2Run.runRef}`, /DOCUMENT_ACTIVITY_REQUEST_IMMUTABLE/);
      const unchanged = await one.repository.readRun(scope, v2Run.runRef);
      assert.equal(unchanged.candidateSchemaVersion, v2Schema);
      assert.deepEqual(unchanged.productionContract, productionContract);
    });

    await t.test('0074 SAVED check rejects wrong schema; exact v2 save, reader and replay retain pinned result', async () => {
      const fence = await one.repository.claim(scope, v2Run.runRef, 'v2-producer');
      await one.repository.recordDelivery(scope, fence, range);
      const v2Command = { ...command, candidate: { ...command.candidate, schemaVersion: v2Schema, statements: [rawV2Statement] } };
      const running = await one.repository.readRun(scope, v2Run.runRef);
      // Direct synthetic SQL reaches the real new SAVED constraint without the
      // repository's earlier schema guard hiding a missing database check.
      await assert.rejects(one.client`UPDATE dm_document_activity_run SET status='SAVED',candidate_revision=3,
        result_json=${JSON.stringify(materialize(running, 3))}::jsonb,save_command_json=${JSON.stringify(v2Command)}::jsonb,
        lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE run_ref=${v2Run.runRef}`,
      error => databaseConstraint(error, 'document_activity_saved_contract_v2'));
      assert.equal((await one.repository.readRun(scope, v2Run.runRef)).status, 'RUNNING');
      v2Saved = await one.repository.save(scope, fence, v2Command,
        (run, revision) => {
          const result = { ...materialize(run, revision), schemaVersion: v2Schema,
            sourceBinding: exactBinding, statements: [rawV2Statement] };
          return { ...result, sourceContext: { schemaVersion: productionContract.sourceContextVersion,
            sourceBinding: result.sourceBinding,
            profile: { profileRef: 'test', selectionBasis: 'NOT_RECORDED', family: null, issuer: null },
            sections: [{ sectionId: 'section-test', parentSectionId: null, titleRaw: null, roleKey: null,
              headingUnitId: null, deliveredUnitIds: ['unit-test'], contextForSectionIds: [] }], organizationWarnings: [] } };
        });
      assert.equal(v2Saved.candidateRevision, 3);
      assert.equal(v2Saved.schemaVersion, v2Schema);
      assert.deepEqual(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 3), v2Saved);
      assert.equal(await foreign.repository.readSaved({ ...scope, actorUserId: 'actor-foreign' }, source.parseRunId, 3), null);
      assert.deepEqual(await one.repository.save(scope, fence, v2Command, () => { throw new Error('must not regenerate v2'); }), v2Saved);
      const stored = await one.repository.readRun(scope, v2Run.runRef);
      assert.deepEqual(stored.productionContract, productionContract);
      assert.equal(stored.candidateSchemaVersion, v2Schema);
      assert.deepEqual(stored.result, v2Saved);
      assert.deepEqual(await one.repository.readSaved(scope, source.parseRunId, 1), saved);
    });

    await t.test('physical exact-reference reads retain raw UNKNOWN/multiple times and source ACL after revocation', async () => {
      const readerScope = { ...scope, actorUserId: 'actor-two' };
      const reference = { runRef: v2Run.runRef, candidateRevision: v2Saved.candidateRevision };
      assert.deepEqual(await browser.repository.readSavedByReference(readerScope, reference, exactBinding), v2Saved);
      assert.equal(await foreign.repository.readSavedByReference({ ...scope, actorUserId: 'actor-foreign' }, reference, exactBinding), null);
      assert.equal(await browser.repository.readSavedByReference(readerScope, { ...reference, runRef: 'DAR-missing' }, exactBinding), null);
      const [row] = await admin`SELECT result_json::text AS raw FROM dm_document_activity_run WHERE run_ref=${reference.runRef}`;
      const roundtrip = JSON.parse(row.raw);
      assert.deepEqual(roundtrip, v2Saved);
      assert.deepEqual(roundtrip.statements[0], rawV2Statement);
      assert.equal(roundtrip.statements[0].status.meaning, 'UNKNOWN');
      assert.equal(roundtrip.statements[0].times.length, 2);
      assert.equal(Object.hasOwn(roundtrip.statements[0], 'time'), false);
      await admin`DELETE FROM work_item WHERE requested_by_user_id='actor-two'`;
      assert.equal(await browser.repository.readSavedByReference(readerScope, reference, exactBinding), null);
      await admin`INSERT INTO work_item VALUES ('tenant-test','DV-test','actor-two')`;
    });
  } finally {
    await Promise.all(clients.map(client => client.end()));
    await admin.end();
  }
});

async function reset(admin) {
  await admin.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE TYPE user_profile AS (user_id text);
    CREATE TABLE identity_subject_mapping(miaoda_user_id text,miaoda_tenant_id text,expected_client_id text,status text);
    CREATE TABLE work_item(tenant_id varchar,document_version_id varchar,requested_by_user_id varchar);
    CREATE TABLE dm_document_version(document_version_id varchar(96) PRIMARY KEY,family_id varchar,source_artifact_id varchar);
    CREATE TABLE dm_publication_family(family_id varchar,canonical_identity_key text);
    CREATE TABLE dm_acquisition(document_version_id varchar,source_artifact_id varchar,acquired_by varchar,status varchar,idempotency_key text);
    CREATE TABLE dm_document_parse_run(tenant_id varchar(128),document_version_id varchar(96),parse_run_id varchar(96),parse_revision integer,status text,manifest_artifact jsonb,source_binding jsonb,
      UNIQUE(tenant_id,document_version_id,parse_run_id));`);
  for (const [file, names] of [
    ['0014_engineering_matter_catalog.sql', ['engineering_matter_actor_has_tenant']],
    ['0032_engineering_matter_material.sql', ['engineering_matter_uri_component', 'engineering_matter_document_owned_by_actor']],
    ['0048_document_translation_attempt_subject.sql', ['document_translation_attempt_owned']],
  ]) {
    const migration = await readFile(new URL(`../../migrations/${file}`, import.meta.url), 'utf8');
    for (const name of names) {
      const start = migration.search(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION ${name}\\(`));
      assert.ok(start >= 0);
      await admin.unsafe(migration.slice(start, migration.indexOf('$$;', start) + 3));
    }
  }
  await admin.unsafe(await readFile(new URL('../../migrations/0055_document_semantic_revision.sql', import.meta.url), 'utf8'));
  await admin.unsafe(await readFile(new URL('../../migrations/0058_document_activity_run.sql', import.meta.url), 'utf8'));
  await admin.unsafe('GRANT USAGE ON SCHEMA public TO service_role,authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO service_role,authenticated');
  await admin`INSERT INTO identity_subject_mapping VALUES
    ('actor-one','tenant-test','cli_aadde8b579f95bc9','ACTIVE'),('actor-two','tenant-test','cli_aadde8b579f95bc9','ACTIVE'),
    ('actor-foreign','tenant-foreign','cli_aadde8b579f95bc9','ACTIVE')`;
  await admin`INSERT INTO work_item VALUES ('tenant-test','DV-test','actor-one'),('tenant-test','DV-test','actor-two')`;
  await admin`INSERT INTO dm_document_version(document_version_id) VALUES ('DV-test')`;
  await admin`INSERT INTO dm_document_parse_run VALUES ('tenant-test','DV-test','PR-test',1,'PUBLISHED',
    ${admin.json({ role: 'MANIFEST', relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: source.manifestSha256 })},
    ${admin.json({ documentVersionId: 'DV-test', sourceArtifactId: 'ART-test', pdfSha256: exactBinding.original.sourceSha256, byteLength: 1234 })})`;
  await admin`INSERT INTO dm_document_semantic_revision
    (tenant_id,document_version_id,parse_run_id,parse_revision,semantic_revision,actor_user_id,profile_ref,original_manifest_sha256,map_json)
    VALUES ('tenant-test','DV-test','PR-test',1,1,'actor-one','test',${source.manifestSha256},
      ${admin.json({ schemaVersion: 'wiselink.document.semantic-map.v1', profileRef: 'test', semanticRevision: 1,
        binding: { documentVersionId: 'DV-test', parseRunId: 'PR-test', parseRevision: 1 } })})`;
  // These rows must exist under 0058 before 0074 runs; their separate parse avoids
  // changing the main fixture's revision, lease and CAS cases.
  await admin`INSERT INTO dm_document_parse_run SELECT tenant_id,document_version_id,'PR-legacy',parse_revision,status,manifest_artifact,source_binding
    FROM dm_document_parse_run WHERE parse_run_id='PR-test'`;
  const legacy = { ...materialize({ runRef: 'DAR-legacy-saved', selection: source.selection, deliveredRanges: [] }, 1),
    sourceBinding: { original: { documentVersionId: 'DV-test', parseRunId: 'PR-legacy', parseRevision: 1 }, semanticRevision: 1 } };
  await admin`INSERT INTO dm_document_activity_run(run_ref,tenant_id,actor_user_id,request_id,document_version_id,parse_run_id,parse_revision,semantic_revision,
    original_manifest_sha256,selection_json,expected_revision,candidate_revision,status,deadline_at,result_json,save_command_json)
    VALUES('DAR-legacy-saved','tenant-test','actor-one','legacy-saved','DV-test','PR-legacy',1,1,${source.manifestSha256},${admin.json(source.selection)},0,1,'SAVED',CURRENT_TIMESTAMP,${admin.json(legacy)},${admin.json(command)})`;
  await admin`INSERT INTO dm_document_activity_run(run_ref,tenant_id,actor_user_id,request_id,document_version_id,parse_run_id,parse_revision,semantic_revision,
    original_manifest_sha256,selection_json,expected_revision,status,deadline_at)
    VALUES('DAR-legacy-active','tenant-test','actor-one','legacy-active','DV-test','PR-legacy',1,1,${source.manifestSha256},${admin.json(source.selection)},1,'QUEUED',CURRENT_TIMESTAMP+interval '1 hour')`;
  const absentPins = await admin`SELECT column_name FROM information_schema.columns WHERE table_name='dm_document_activity_run'
    AND column_name IN ('candidate_schema_version','production_contract_json')`;
  assert.equal(absentPins.length, 0);
  legacyBefore = (await admin`SELECT result_json::text AS raw FROM dm_document_activity_run WHERE run_ref='DAR-legacy-saved'`)[0].raw;
  await admin.unsafe(await readFile(new URL('../../migrations/0074_document_activity_candidate_contract.sql', import.meta.url), 'utf8'));
}
