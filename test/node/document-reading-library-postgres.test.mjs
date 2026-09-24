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
const { DocumentReadingRunRepository } = require('../../server/modules/canonical-host/document-reading-run.repository.ts');
const { listOwnedLibraryFamilies } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-library-query.ts');
const { tenantFamilyIdentityPrefix } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts');
const databaseUrl = process.env.DOCUMENT_READING_LIBRARY_TEST_DATABASE_URL;
const scope = { tenantId: 'tenant-test', actorUserId: 'actor-one', documentVersionId: 'DV-test' };
const source = { parseRunId: 'PR-test', parseRevision: 1, semanticRevision: 1, manifestSha256: 'a'.repeat(64), expectedRevision: 0 };
const clients = [];
async function actor(role, userId) {
  const client = postgres(databaseUrl, { max: 1, onnotice() {} });
  clients.push(client);
  assert.ok(['authenticated', 'service_role'].includes(role));
  await client.unsafe(`SET ROLE ${role}`);
  await client`SELECT set_config('app.user_id',${userId},false)`;
  return { client, db: drizzle(client), repository: new DocumentReadingRunRepository(drizzle(client)) };
}
const command = { candidate: { fixture: 'persistence-only' }, producer: { skillVersion: 'fixture', modelVersion: 'not-called' } };
function materialize(run, revision) {
  return { schemaVersion: 'wiselink.document.reading.v1', candidateOnly: true,
    readingRunRef: run.runRef, readingRevision: revision, headline: '真实保存的文件主题',
    brief: { text: '需要核实构型后才能判断。', quotes: [] }, explanation: [],
    criticalConditions: [{ text: '先核实构型', quotes: [] }], limitations: ['文件解读，尚未正式采用'],
    sourceBinding: { original: { documentVersionId: scope.documentVersionId, parseRunId: run.parseRunId, parseRevision: run.parseRevision }, semanticRevision: run.semanticRevision },
    readCoverage: { status: 'PARTIAL_DELIVERY', deliveredUnitIds: ['u1'], totalUnitCount: 3,
      sourceCoverage: { unresolvedRanges: [
        { message: 'diagnostic-only', readingImpact: 'DIAGNOSTIC' },
        { message: 'explicit-limitation', readingImpact: 'LIMITATION' },
        { message: 'legacy-unclassified' },
      ] } },
    sourceAnchors: [], producer: command.producer, savedAt: '2026-09-17T00:00:00Z' };
}

// Executes the production Drizzle query, not a reconstructed SQL approximation.
// Minimal surrounding catalog tables are fixtures; real 0055/0058/0060 migrations
// supply semantic/reading schema, source authorization functions and RLS.
test('production library SQL projects exact document reading and authorized current sources', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/wiselink_reading_library_test(?:_[a-z0-9_]+)?$/u);
  const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
  try {
    await reset(admin);
    await catalog(admin);
    const producer = await actor('service_role', 'actor-one');
    const browser = await actor('authenticated', 'actor-two');
    const foreign = await actor('authenticated', 'actor-foreign');
    const query = async (who = browser, overrides = {}) => {
      const rows = await listOwnedLibraryFamilies(who.db, { tenantId: 'tenant-test', actorUserId: 'actor-two', search: '', cursor: null, limit: 20, ...overrides });
      return rows[0];
    };
    const version = result => result.rows[0].versions.find(item => item.documentVersionId === 'DV-test');
    let originalPreview;
    await t.test('current published source returns the same saved partial text and excludes only DIAGNOSTIC limitations', async () => {
      assert.deepEqual(version(await query()).documentReading, { status: 'NOT_GENERATED', reading: null });
      const run = await producer.repository.begin(scope, { ...source, requestId: 'library-reading' });
      const fence = await producer.repository.claim(scope, run.runRef, 'fixture-producer');
      await producer.repository.save(scope, fence, command, materialize);
      originalPreview = version(await query()).documentReading;
      assert.equal(originalPreview.status, 'AVAILABLE');
      assert.equal(originalPreview.reading.headline, '真实保存的文件主题');
      assert.equal(originalPreview.reading.brief, '需要核实构型后才能判断。');
      assert.deepEqual(originalPreview.reading.criticalConditions, ['先核实构型']);
      assert.deepEqual(originalPreview.reading.sourceLimitations, ['explicit-limitation', 'legacy-unclassified']);
      assert.equal(originalPreview.reading.coverageStatus, 'PARTIAL_DELIVERY');
      assert.equal(originalPreview.reading.deliveredUnitCount, 1);
      assert.equal(originalPreview.reading.totalUnitCount, 3);
      assert.equal(originalPreview.reading.sourceBinding.semanticRevision, 1);
      assert.equal(version(await query()).selectedVersionIsCurrent, true);
      assert.equal((await query()).rows[0].versions.find(item => item.documentVersionId === 'DV-old').selectedVersionIsCurrent, false);
      assert.deepEqual((await query()).rows[0].versions.find(item => item.documentVersionId === 'DV-old').documentReading, { status: 'NOT_GENERATED', reading: null });
    });
    await t.test('new FAILED and pending parses do not obscure the still-published reading', async () => {
      for (const [revision, status] of [[2, 'FAILED'], [3, 'QUEUED']]) {
        await admin`INSERT INTO dm_document_parse_run VALUES ('tenant-test','DV-test',${`PR-${revision}`},${revision},${status},NULL)`;
        const result = version(await query());
        assert.equal(result.parsing.status, status);
        assert.equal(result.parsing.publishedRevision, 1);
        assert.deepEqual(result.documentReading, originalPreview);
      }
    });
    await t.test('new semantic revision makes previous reading SOURCE_CHANGED, not current', async () => {
      await semantic(admin, 'PR-test', 1, 2);
      assert.deepEqual(version(await query()).documentReading, { status: 'SOURCE_CHANGED', reading: null });
      const run = await producer.repository.begin(scope, { ...source, semanticRevision: 2, requestId: 'new-semantic-reading' });
      const fence = await producer.repository.claim(scope, run.runRef, 'fixture-producer');
      await producer.repository.save(scope, fence, command, materialize);
      const result = version(await query()).documentReading;
      assert.equal(result.status, 'AVAILABLE');
      assert.equal(result.reading.sourceBinding.semanticRevision, 2);
      assert.equal(result.reading.readingRevision, 1);
      const retraction = { runRef: run.runRef, expectedReadingRevision: 1,
        requestId: 'retract-semantic-two', reasonCode: 'SOURCE_SEMANTIC_CONTRADICTION',
        reviewReference: 'fixture-independent-review' };
      await assert.rejects(browser.client`INSERT INTO dm_document_reading_retraction
        (run_ref,tenant_id,actor_user_id,document_version_id,reading_revision,request_id,reason_code,review_reference)
        VALUES (${run.runRef},'tenant-test','actor-one','DV-test',1,'native-browser','OTHER','fixture')`,
      /row-level security/);
      const recorded = await producer.repository.retract(scope, retraction);
      assert.equal(recorded.readingRevision, 1);
      assert.deepEqual(await producer.repository.retract(scope, retraction), recorded);
      const preserved = await admin`SELECT status,reading_revision,result_json->>'headline' AS headline
        FROM dm_document_reading_run WHERE run_ref=${run.runRef}`;
      assert.deepEqual([preserved[0].status, preserved[0].reading_revision, preserved[0].headline],
        ['SAVED', 1, '真实保存的文件主题']);
      await assert.rejects(admin`UPDATE dm_document_reading_retraction SET reason_code='OTHER'
        WHERE run_ref=${run.runRef}`, /DOCUMENT_READING_RETRACTION_IMMUTABLE/);
      await assert.rejects(admin`DELETE FROM dm_document_reading_retraction WHERE run_ref=${run.runRef}`,
        /DOCUMENT_READING_RETRACTION_IMMUTABLE/);
      await assert.rejects(producer.repository.save(scope, fence, command, materialize),
        /DOCUMENT_READING_RETRACTED/);
      assert.deepEqual(version(await query()).documentReading, { status: 'RETRACTED', reading: null });
      assert.equal(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 2, 1), null);
      await assert.rejects(producer.repository.retract(scope, { ...retraction, requestId: 'wrong-revision', expectedReadingRevision: 2 }),
        /DOCUMENT_READING_RETRACTION_TARGET_CONFLICT/);
      const replacement = await producer.repository.begin(scope, { ...source, semanticRevision: 2,
        requestId: 'replacement-reading', expectedRevision: 1 });
      const replacementFence = await producer.repository.claim(scope, replacement.runRef, 'fixture-producer');
      await producer.repository.save(scope, replacementFence, command, materialize);
      assert.equal(version(await query()).documentReading.reading.readingRevision, 2);
      assert.equal((await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 2)).readingRevision, 2);
      assert.equal(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 2, 1), null);
      await producer.repository.retract(scope, { runRef: replacement.runRef, expectedReadingRevision: 2,
        requestId: 'retract-replacement', reasonCode: 'SOURCE_SEMANTIC_CONTRADICTION',
        reviewReference: 'fixture-second-review' });
      assert.deepEqual(version(await query()).documentReading, { status: 'RETRACTED', reading: null });
      assert.equal(await browser.repository.readSaved({ ...scope, actorUserId: 'actor-two' }, source.parseRunId, 2), null);
    });
    await t.test('new published source never borrows previous parse reading', async () => {
      await admin`INSERT INTO dm_document_parse_run VALUES ('tenant-test','DV-test','PR-4',4,'PUBLISHED',
        ${admin.json({ role: 'MANIFEST', relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: source.manifestSha256 })})`;
      await semantic(admin, 'PR-4', 4, 1);
      assert.deepEqual(version(await query()).documentReading, { status: 'SOURCE_CHANGED', reading: null });
    });
    await t.test('production catalog visibility plus source RLS rejects other actor/tenant and revoked ownership', async () => {
      assert.equal((await query(foreign, { tenantId: 'tenant-foreign', actorUserId: 'actor-foreign' })).totalCount, 0);
      assert.equal((await query(foreign, { actorUserId: 'actor-foreign' })).totalCount, 0);
      await admin`DELETE FROM work_item WHERE requested_by_user_id='actor-two'`;
      assert.equal((await query()).totalCount, 0);
      // An allowed acquisition restores document visibility without a task.
      await admin`INSERT INTO dm_acquisition VALUES ('DV-test','SA-test','actor-two','LINKED_EXACT_DOCUMENT_VERSION','tenant:tenant-test:request:acquisition-fixture')`;
      assert.equal((await query()).totalCount, 1);
    });
  } finally {
    await Promise.all(clients.map(client => client.end()));
    await admin.end();
  }
});
async function semantic(admin, parseRunId, parseRevision, semanticRevision) {
  await admin`INSERT INTO dm_document_semantic_revision
    (tenant_id,document_version_id,parse_run_id,parse_revision,semantic_revision,actor_user_id,profile_ref,original_manifest_sha256,map_json)
    VALUES ('tenant-test','DV-test',${parseRunId},${parseRevision},${semanticRevision},'actor-one','test',${source.manifestSha256},
      ${admin.json({ schemaVersion: 'wiselink.document.semantic-map.v1', profileRef: 'test', semanticRevision,
        binding: { documentVersionId: 'DV-test', parseRunId, parseRevision } })})`;
}
async function catalog(admin) {
  await admin.unsafe(`ALTER TABLE work_item ADD COLUMN document_id varchar DEFAULT 'D-test', ADD COLUMN work_item_id varchar DEFAULT 'WI-test',
    ADD COLUMN package_id text, ADD COLUMN package_artifact_ref text, ADD COLUMN created_at timestamptz DEFAULT CURRENT_TIMESTAMP;
    ALTER TABLE dm_document_version ADD COLUMN document_id varchar DEFAULT 'D-test', ADD COLUMN business_revision varchar DEFAULT '1',
    ADD COLUMN revision_date varchar DEFAULT '2026-09-17', ADD COLUMN source_generated_date varchar DEFAULT '2026-09-17',
    ADD COLUMN original_filename text DEFAULT 'fixture.pdf', ADD COLUMN byte_length bigint DEFAULT 100,
    ADD COLUMN committed_at timestamptz DEFAULT CURRENT_TIMESTAMP;
    CREATE TABLE dm_document(document_id varchar, family_id varchar);
    CREATE TABLE dm_document_version_metadata(document_version_id varchar, metadata_revision integer, extracted_metadata jsonb);
    ALTER TABLE dm_publication_family ADD COLUMN canonical_document_number varchar DEFAULT 'DOC-TEST', ADD COLUMN document_family varchar DEFAULT 'FTD',
    ADD COLUMN issuer_authority varchar DEFAULT 'TEST', ADD COLUMN created_at timestamptz DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at timestamptz DEFAULT CURRENT_TIMESTAMP, ADD COLUMN current_document_version_id varchar;
    GRANT SELECT ON dm_document,dm_document_version_metadata TO authenticated,service_role;`);
  await admin`UPDATE dm_document_version SET family_id='F-test',source_artifact_id='SA-test'`;
  await admin`INSERT INTO dm_document VALUES ('D-test','F-test')`;
  await admin`INSERT INTO dm_publication_family(family_id,canonical_identity_key,current_document_version_id)
    VALUES ('F-test',${tenantFamilyIdentityPrefix('tenant-test') + 'fixture'},'DV-test')`;
  await admin`INSERT INTO dm_document_version(document_version_id,family_id,source_artifact_id) VALUES ('DV-old','F-test','SA-old')`;
  await admin`INSERT INTO work_item(tenant_id,document_version_id,requested_by_user_id,work_item_id) VALUES ('tenant-test','DV-old','actor-two','WI-old')`;
}
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
  await admin.unsafe(await readFile(new URL('../../migrations/0060_document_reading_run.sql', import.meta.url), 'utf8'));
  await admin.unsafe(await readFile(new URL('../../migrations/0061_document_reading_retraction.sql', import.meta.url), 'utf8'));
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
