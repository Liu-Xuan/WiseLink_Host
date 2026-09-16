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
const source = { parseRunId: 'PR-test', parseRevision: 1, semanticRevision: 1, manifestSha256: 'a'.repeat(64),
  selection: { sectionIds: ['section-test'] }, expectedRevision: 0 };
const range = { sectionId: 'section-test', offset: 0, unitIds: ['unit-test'], anchorIds: ['a1'], nextOffset: null };
const command = { candidate: { schemaVersion: 'wiselink.document.activity-candidate.v1', statements: [] },
  producer: { skillVersion: 'isolated-test', modelVersion: 'not-called' } };
const clients = [];

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
    CREATE TABLE dm_document_parse_run(tenant_id varchar(128),document_version_id varchar(96),parse_run_id varchar(96),parse_revision integer,status text,manifest_artifact jsonb,
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
    ${admin.json({ role: 'MANIFEST', relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: source.manifestSha256 })})`;
  await admin`INSERT INTO dm_document_semantic_revision
    (tenant_id,document_version_id,parse_run_id,parse_revision,semantic_revision,actor_user_id,profile_ref,original_manifest_sha256,map_json)
    VALUES ('tenant-test','DV-test','PR-test',1,1,'actor-one','test',${source.manifestSha256},
      ${admin.json({ schemaVersion: 'wiselink.document.semantic-map.v1', profileRef: 'test', semanticRevision: 1,
        binding: { documentVersionId: 'DV-test', parseRunId: 'PR-test', parseRevision: 1 } })})`;
}
