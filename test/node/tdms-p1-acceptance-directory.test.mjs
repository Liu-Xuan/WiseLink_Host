import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidateRoot = await realpath(process.env.WISELINK_TDMS_P1_TEST_ROOT ?? testRoot);
process.env.TS_NODE_PROJECT = join(candidateRoot, 'tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { listOwnedLibraryFamilies } = require(join(candidateRoot,
  'server/modules/document-management/src/hosted/nest/miaoda-hosted-library-query.ts'));
const { readCanonicalLibraryDirectory } = require(join(candidateRoot,
  'server/modules/canonical-host/canonical-library-directory.query.ts'));
const { tenantFamilyIdentityPrefix } = require(join(candidateRoot,
  'server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts'));
const sha = 'f'.repeat(64);

// Surrounding formal catalogue rows are synthetic. The production Drizzle query runs unchanged.
const catalogueTables = `
  CREATE TEMP TABLE work_item (document_id text,document_version_id text,work_item_id text,tenant_id text,
    requested_by_user_id text,package_id text,package_artifact_ref text,created_at timestamptz,
    source_artifact_id text,source_file_sha256 text,source_byte_length int);
  CREATE TEMP TABLE dm_document (document_id text,family_id text);
  CREATE TEMP TABLE dm_publication_family (family_id text,canonical_document_number text,document_family text,
    issuer_authority text,created_at timestamptz,updated_at timestamptz,canonical_identity_key text,
    current_document_version_id text);
  CREATE TEMP TABLE dm_document_version (document_version_id text,document_id text,family_id text,
    source_artifact_id text,business_revision text,revision_date text,source_generated_date text,
    original_filename text,byte_length int,committed_at timestamptz,pdf_sha256 text);
  CREATE TEMP TABLE dm_document_version_metadata (document_version_id text,extracted_metadata jsonb,metadata_revision int);
  CREATE TEMP TABLE dm_document_parse_run (tenant_id text,document_version_id text,status text,parse_revision int,
    parse_run_id text,manifest_artifact jsonb,source_binding jsonb);
  CREATE TEMP TABLE dm_document_semantic_revision (tenant_id text,document_version_id text,parse_run_id text,
    semantic_revision int,original_manifest_sha256 text);
  CREATE TEMP TABLE dm_document_reading_run (run_ref text,reading_revision int,result_json jsonb,tenant_id text,
    document_version_id text,parse_run_id text,parse_revision int,semantic_revision int,
    original_manifest_sha256 text,status text,_updated_at timestamptz,_created_at timestamptz);
  CREATE TEMP TABLE dm_document_reading_retraction (run_ref text,tenant_id text);
  CREATE TEMP TABLE dm_acquisition (document_version_id text,source_artifact_id text,acquired_by text,status text,
    idempotency_key text);
`;

test('P1 formal directory leaf queries use actual SQL node scope before pagination', { timeout: 60000 }, async t => {
  const capability = await postgresCapability();
  assert.equal(capability.available, true, capability.reason);
  const owned = await startOwnedPostgres(capability);
  try {
    const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    await owned.admin.unsafe(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS`);
    const sql = await owned.connect(login);
    await sql.unsafe(catalogueTables);
    const db = drizzle(sql);
    const scope = { tenantId: 'synthetic-t1', actorUserId: 'synthetic-reader-a', search: '', cursor: null, limit: 20 };
    const metadata = (ata, models) => ({ sourceSha256: sha, sourceByteLength: 100,
      ata: { observations: ata.map(value => ({ value })) },
      mentionedAircraftModels: { observations: models.map(value => ({ value })) } });
    async function family(id, tenant, versions, current) {
      await sql`INSERT INTO dm_document VALUES (${id},${id})`;
      await sql`INSERT INTO dm_publication_family VALUES (${id},${`SYNTHETIC-${id}`},'SB','TEST',
        '2026-10-01','2026-10-01',${tenantFamilyIdentityPrefix(tenant) + id},${current})`;
      for (const version of versions) {
        await sql`INSERT INTO dm_document_version VALUES (${version.id},${id},${id},'synthetic-source',
          ${version.revision},'','','synthetic.pdf',100,${version.time ?? '2026-10-01'},${sha})`;
        await sql`INSERT INTO dm_acquisition VALUES (${version.id},'synthetic-source','synthetic-importer',
          'COMMITTED_CANONICAL',${`tenant:${encodeURIComponent(tenant)}:request:${version.id}`})`;
        if (version.metadata) await sql`INSERT INTO dm_document_version_metadata VALUES
          (${version.id},${JSON.stringify(version.metadata)}::jsonb,1)`;
      }
    }
    await family('a', scope.tenantId, [
      { id: 'DV-a-old', revision: 'R01', metadata: metadata(['34-11'], ['OLD-MODEL']) },
      { id: 'DV-a-current', revision: 'R02', time: '2026-10-02',
        metadata: metadata(['27-11', '27-21', '27-11'], ['MODEL-A', ' MODEL-B ', 'MODEL-A']) },
    ], 'DV-a-current');
    await family('b', scope.tenantId, [{ id: 'DV-b', revision: 'R01', metadata: metadata(['27'], ['MODEL-A']) }], 'DV-b');
    await family('c', scope.tenantId, [{ id: 'DV-c', revision: 'R01' }], 'DV-c');
    await family('d', scope.tenantId, [{ id: 'DV-d', revision: 'R01', metadata: metadata(['ATA unclear'], ['MODEL-A']) }], 'DV-d');
    await family('unselected', scope.tenantId, [{ id: 'DV-unselected', revision: 'R01',
      metadata: metadata(['27-11'], ['MODEL-A']) }], null);
    await family('foreign', 'synthetic-t2', [{ id: 'DV-foreign', revision: 'R01',
      metadata: metadata(['27-11'], ['MODEL-A']) }], 'DV-foreign');
    const list = async query => (await listOwnedLibraryFamilies(db, { ...scope, ...query }))[0];

    await t.test('metadata-only catalogue remains available without parse, reading, WorkItem or model results', async () => {
      const result = await list({});
      assert.equal(result.totalCount, 5);
      assert.equal(result.rows.length, 5);
      assert.ok(result.rows.every(row => row.workItemCount === 0));
      assert.ok(result.rows.flatMap(row => row.versions).every(version =>
        !version.parsing && version.documentReading.status === 'NOT_GENERATED'));
      const a = result.rows.find(row => row.familyId === 'a');
      assert.equal(a.versions.length, 2);
      assert.equal(a.versions.find(version => version.selectedVersionIsCurrent).documentVersionId, 'DV-a-current');
      assert.equal(result.rows.find(row => row.familyId === 'unselected').versions
        .some(version => version.selectedVersionIsCurrent), false);
    });
    await t.test('ATA2 node filters direct and child ATA documents before list paging', async () => {
      const result = await list({ ata2: '27', aircraftModel: 'MODEL-A' });
      assert.deepEqual(result.rows.map(row => row.familyId).sort(), ['a', 'b']);
      assert.equal(result.totalCount, 2);
      const first = await list({ ata2: '27', aircraftModel: 'MODEL-A', limit: 1 });
      const anchor = first.rows[0];
      const second = await list({ ata2: '27', aircraftModel: 'MODEL-A', limit: 1,
        cursor: { createdAt: new Date(anchor.createdAt).toISOString(), itemId: anchor.familyId } });
      assert.equal(second.rows[0].familyId, 'a');
    });
    await t.test('ATA4 leaf does not admit an ATA2-only document or another child', async () => {
      const result = await list({ ata2: '27', ata4: '27-11', aircraftModel: 'MODEL-A' });
      assert.deepEqual(result.rows.map(row => row.familyId), ['a']);
      assert.equal(result.totalCount, 1);
      assert.deepEqual((await list({ ata2: '27', ata4: '27-99', aircraftModel: 'MODEL-A' })).rows, []);
      assert.deepEqual((await list({ ata2: '27', ata4: '__DIRECT__', aircraftModel: 'MODEL-A' })).rows
        .map(row => row.familyId), ['b']);
    });
    await t.test('default current classification is not derived from a historical version', async () => {
      const result = await list({ ata2: '34', ata4: '34-11' });
      assert.equal(result.totalCount, 0, 'R01 metadata must not classify the current R02 document');
    });
    await t.test('missing and ambiguous ATA classifications remain visible in explicit groups', async () => {
      const unknown = await list({ ata2: '__UNKNOWN__' });
      assert.deepEqual(unknown.rows.map(row => row.familyId).sort(), ['c', 'unselected']);
      const raw = await list({ ata2: '__RAW__' });
      assert.deepEqual(raw.rows.map(row => row.familyId), ['d']);
    });
    await t.test('directory independently deduplicates families, visible history versions and multi-model parent counts', async () => {
      const root = await readCanonicalLibraryDirectory(db, scope);
      assert.equal(root.level, 'AIRCRAFT_MODEL');
      assert.equal(root.documentCount, 5);
      assert.equal(root.versionCount, 6);
      const node = value => root.nodes.find(item => item.value === value);
      assert.equal(node('MODEL-A').documentCount, 3);
      assert.equal(node('MODEL-A').versionCount, 4);
      assert.equal(node('MODEL-B').documentCount, 1);
      assert.ok(node('MODEL-B').rawValues.includes(' MODEL-B '));
      assert.equal(node('__UNKNOWN__').documentCount, 2, 'Missing explicit current version remains visible as unknown');
      assert.ok(root.nodes.reduce((total, item) => total + item.documentCount, 0) > root.documentCount,
        'Shared model entry is one formal family, not copied identities');
      assert.deepEqual((await list({ aircraftModel: 'MODEL-B' })).rows.map(row => row.familyId), ['a'],
        'Normalized node selection must match its SQL leaf scope');
    });
    await t.test('ATA2 direct membership is separate and child counts cannot be summed into the parent', async () => {
      const chapter = await readCanonicalLibraryDirectory(db, { ...scope, aircraftModel: 'MODEL-A' });
      const ata27 = chapter.nodes.find(item => item.value === '27');
      assert.equal(ata27.documentCount, 2);
      assert.equal(ata27.versionCount, 3);
      assert.equal(ata27.directDocumentCount, 1);
      assert.equal(ata27.directVersionCount, 1);
      const children = await readCanonicalLibraryDirectory(db, { ...scope, aircraftModel: 'MODEL-A', ata2: '27' });
      assert.equal(children.documentCount, 2);
      assert.equal(children.versionCount, 3);
      assert.equal(children.directDocumentCount, 1);
      assert.deepEqual(children.nodes.map(item => item.value), ['27-11', '27-21']);
      assert.equal(children.nodes.reduce((total, item) => total + item.documentCount, 0) +
        children.directDocumentCount, 3);
      assert.ok(!children.nodes.some(item => ['__UNKNOWN__', '__DIRECT__', '27-00'].includes(item.value)));
      const raw = chapter.nodes.find(item => item.value === '__RAW__');
      assert.deepEqual(raw.rawValues, ['ATA unclear']);
      assert.equal(raw.documentCount, 1);
    });
    await t.test('same tenant SQL read scope is shared while foreign namespace and acquisitions are excluded', async () => {
      const a = await list({});
      const [b] = await listOwnedLibraryFamilies(db, { ...scope, actorUserId: 'synthetic-reader-b' });
      assert.deepEqual(a.rows, b.rows);
      const [foreign] = await listOwnedLibraryFamilies(db, { ...scope, tenantId: 'unreceived-tenant' });
      assert.equal(foreign.totalCount, 0);
      assert.deepEqual(foreign.rows, []);
    });
    await t.test('server-resolved fleet and raw model scopes intersect consistently in directory and leaf SQL', async () => {
      const query = { aircraftModel: 'MODEL-B', fleetMentionValues: ['MODEL-A'], ata2: '27' };
      assert.deepEqual((await list(query)).rows.map(row => row.familyId), ['a']);
      const directory = await readCanonicalLibraryDirectory(db, { ...scope, ...query });
      assert.equal(directory.documentCount, 1);
      assert.equal(directory.versionCount, 2);
      const mismatch = { ...query, fleetMentionValues: ['NOT-IN-THE-CURRENT-FLEET'] };
      assert.deepEqual((await list(mismatch)).rows, []);
      const empty = await readCanonicalLibraryDirectory(db, { ...scope, ...mismatch });
      assert.equal(empty.documentCount, 0);
      assert.deepEqual(empty.nodes, []);
    });
    t.diagnostic('SYNTHETIC_FORMAL_SQL_ONLY; catalogue query does not verify real membership or production RLS');
  } finally { await owned.stop(); }
});
