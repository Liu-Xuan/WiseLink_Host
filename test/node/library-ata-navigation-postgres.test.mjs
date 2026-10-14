import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'node:http';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const candidateRoot = await realpath(testRoot);
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

const { CanonicalLibraryService } = require(join(candidateRoot, 'server/modules/canonical-host/canonical-library.service.ts'));
const { syntheticMiaodaActorFixture } = require(join(candidateRoot, 'test/fixtures/synthetic-development-canonical-object-access.adapter.ts'));
const { libraryCatalogueQuery, libraryAircraftModelsQuery, LIBRARY_CATALOG_PAGED_QUERY_BUDGET } =
  require(join(candidateRoot, 'shared/library-aircraft-mentions.ts'));

test('ATA navigation and exact raw-model unions use one production query with stable number-first pagination', { timeout: 60000 }, async t => {
  const capability = await postgresCapability();
  assert.equal(capability.available, true, capability.reason);
  const owned = await startOwnedPostgres(capability);
  try {
    const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    await owned.admin.unsafe(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS`);
    const client = await owned.connect(login);
    await client.unsafe(catalogueTables);
    const db = drizzle(client);
    const tenant = 'synthetic-ui-c257';
    const identity = syntheticMiaodaActorFixture('synthetic-ui-reader', tenant);
    identity.env = 'preview'; identity.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
    const actor = { userId: 'synthetic-ui-reader', tenantId: tenant, appId: identity.applicationScopeId,
      env: 'preview', roles: [], objectAccessActor: identity };
    const scope = { tenantId: tenant, actorUserId: actor.userId, search: '', cursor: null, limit: 20 };
    const service = new CanonicalLibraryService({
      listDocuments: query => listOwnedLibraryFamilies(db, query),
      directory: query => readCanonicalLibraryDirectory(db, query),
    }, {}, {});
    async function family(id, code, created, versions, current, ownerTenant = tenant, issuer = 'TEST') {
      await client`INSERT INTO dm_document VALUES (${id},${id})`;
      await client`INSERT INTO dm_publication_family VALUES (${id},${code},'SB',${issuer},
        ${created},${created},${tenantFamilyIdentityPrefix(ownerTenant) + id},${current})`;
      for (const version of versions) {
        await client`INSERT INTO dm_document_version VALUES (${version.id},${id},${id},'synthetic-source',
          ${version.revision},'','','synthetic.pdf',100,${created},${sha})`;
        await client`INSERT INTO dm_acquisition VALUES (${version.id},'synthetic-source','synthetic-importer',
          'COMMITTED_CANONICAL',${`tenant:${encodeURIComponent(ownerTenant)}:request:${version.id}`})`;
        const metadata = { sourceSha256: sha, sourceByteLength: 100,
          ata: { observations: (version.ata ?? []).map(value => ({ value })) },
          mentionedAircraftModels: { observations: (version.models ?? []).map(value => ({ value })) },
          title: { observations: (version.title ? [version.title] : []).map(value => ({ value })) } };
        await client`INSERT INTO dm_document_version_metadata VALUES (${version.id},${JSON.stringify(metadata)}::jsonb,1)`;
      }
    }
    await family('multi', 'NG-source', '2026-10-01', [
      { id: 'multi-old', revision: 'R1', ata: ['34-11'], models: ['737 MAX'] },
      { id: 'multi-current', revision: 'R2', ata: ['27-11', '271100', '27-21'], models: ['737-600', '737-800', '737-800'] },
    ], 'multi-current');
    await family('ng-direct', 'NG-direct', '2026-10-02', [{ id: 'ng-current', revision: 'R1', ata: ['27'], models: ['737-700'] }], 'ng-current');
    await family('broad', 'Broad-source', '2026-10-03', [{ id: 'broad-current', revision: 'R1', ata: ['27-11'], models: ['737'] }], 'broad-current');
    await family('max', 'MAX-source', '2026-10-04', [{ id: 'max-current', revision: 'R1', ata: ['27-11'], models: ['737 MAX'] }], 'max-current');
    await family('foreign', 'NG-foreign', '2026-10-05', [{ id: 'foreign-current', revision: 'R1', ata: ['27-11'], models: ['737-800'] }], 'foreign-current', 'foreign-tenant');
    const aircraftModels = ['737-600', '737-700', '737-800', '737-900'];
    await t.test('union filters the current observation before pagination, keeps full history and deduplicates a multi-model family', async () => {
      const first = await service.list({ aircraftModels, limit: 1 }, actor);
      assert.equal(first.totalCount, 2); assert.equal(first.items.length, 1);
      assert.equal(first.items[0].familyId, 'ng-direct');
      const second = await service.list({ aircraftModels, limit: 1, cursor: first.nextCursor }, actor);
      assert.equal(second.items[0].familyId, 'multi'); assert.equal(second.items[0].versions.length, 2);
      assert.equal(second.totalCount, 2); assert.equal(second.nextCursor, null);
      await assert.rejects(service.list({ aircraftModels: ['737-800'], cursor: first.nextCursor }, actor), /LIBRARY_CURSOR_INVALID/);
      const all = await service.list({ aircraftModels: [...aircraftModels, '737 MAX'] }, actor);
      assert.deepEqual(all.items.map(item => item.familyId), ['max', 'ng-direct', 'multi']);
      assert.equal(all.totalCount, 3); assert.ok(!all.items.some(item => ['broad', 'foreign'].includes(item.familyId)));
    });
    await t.test('ATA-first directory counts the same model union without summing duplicate ATA or model children', async () => {
      const root = await service.directory({ layout: 'ATA', aircraftModels }, actor);
      assert.equal(root.level, 'ATA2'); assert.equal(root.documentCount, 2); assert.equal(root.versionCount, 3);
      assert.deepEqual(root.nodes.map(node => node.value), ['27']);
      assert.equal(root.nodes[0].documentCount, 2); assert.equal(root.nodes[0].versionCount, 3);
      assert.equal(root.nodes[0].directDocumentCount, 1);
      const sections = await service.directory({ layout: 'ATA', aircraftModels, ata2: '27' }, actor);
      assert.deepEqual(sections.nodes.map(node => node.value), ['27-11', '27-21']);
      assert.equal(sections.nodes[0].documentCount, 1); assert.equal(sections.nodes[0].versionCount, 2);
      assert.deepEqual(sections.nodes[0].rawValues, ['27-11', '271100']);
      const selected = await service.list({ aircraftModels, ata2: '27', ata4: '27-11' }, actor);
      assert.deepEqual(selected.items.map(item => item.familyId), ['multi']);
      assert.equal(selected.items[0].versions.length, 2);
      const legacy = await service.directory({ aircraftModel: '737-800' }, actor);
      assert.equal(legacy.level, 'ATA2'); assert.equal(legacy.documentCount, 1);
      const legacyRoot = await service.directory({}, actor); assert.equal(legacyRoot.level, 'AIRCRAFT_MODEL');
    });
    await family('old-exact', 'A320-32-1496', '2024-01-01', [{ id: 'search-1', revision: 'R1', ata: ['32'], models: ['A320'] }], 'search-1');
    await family('other-identity', 'A320-32-1496', '2025-01-01', [{ id: 'search-2', revision: 'R1', ata: ['32'], models: ['A320'] }], 'search-2', tenant, 'OTHER-ISSUER');
    await family('new-title', 'TITLE-ONLY', '2027-01-01', [{ id: 'search-3', revision: 'R1', ata: ['32'], models: ['A320'], title: 'reference A320-32-1496' }], 'search-3');
    await family('code-fragment', 'X-A320-32-1496-Z', '2026-01-01', [{ id: 'search-4', revision: 'R1', ata: ['32'], models: ['A320'] }], 'search-4');
    await family('foreign-search', 'A320-32-1496', '2028-01-01', [{ id: 'search-5', revision: 'R1', ata: ['32'], models: ['A320'] }], 'search-5', 'foreign-tenant');
    await t.test('complete number and fragment search execute real SQL; exact identities lead every cursor page without merging issuers', async () => {
      const ids = []; let cursor;
      do {
        const page = await service.list({ search: 'a320-32-1496', limit: 1, ...(cursor ? { cursor } : {}) }, actor);
        assert.equal(page.totalCount, 4); assert.equal(page.order, 'DOCUMENT_NUMBER_EXACT_FIRST_FAMILY_CREATED_AT_DESC_FAMILY_ID_DESC');
        ids.push(...page.items.map(item => item.familyId)); cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(ids, ['other-identity', 'old-exact', 'new-title', 'code-fragment']);
      assert.equal(new Set(ids).size, 4);
      const fragment = await service.list({ search: '32-1496' }, actor);
      assert.equal(fragment.totalCount, 4);
      assert.deepEqual(fragment.items.map(item => item.familyId), ['new-title', 'code-fragment', 'other-identity', 'old-exact']);
      assert.equal((await service.list({ search: 'A320%_32' }, actor)).totalCount, 0);
    });
    await t.test('reachable Unicode/escaped raw models really pass HTTP GET, production SQL, seek cursor and read-only return without large headers', async () => {
      const models = Array.from({ length: 16 }, (_, index) => `${index}型号\\"`);
      await family('unicode-one', 'UNICODE-one', '2026-10-01', [{ id: 'unicode-1', revision: 'R1', ata: ['32'], models }], 'unicode-1');
      await family('unicode-two', 'UNICODE-two', '2026-10-02', [{ id: 'unicode-2', revision: 'R1', ata: ['32'], models }], 'unicode-2');
      // This tiny transport serves only the owned synthetic catalogue actor; it is not a production-auth test.
      const server = createServer(async (request, response) => {
        try {
          const query = new URL(request.url, 'http://127.0.0.1').searchParams;
          const page = await service.list({ aircraftModels: libraryAircraftModelsQuery(query.get('aircraftModels')),
            cursor: query.get('cursor') ?? undefined, limit: Number(query.get('limit') ?? 1) }, actor);
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(page));
        } catch (error) {
          response.statusCode = 400; response.end(JSON.stringify({ error: error.message }));
        }
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/canonical-host/library/documents`;
      try {
        const firstQuery = libraryCatalogueQuery({ aircraftModels: models, limit: 1 });
        const firstResponse = await fetch(`${base}?${firstQuery}`); assert.equal(firstResponse.status, 200);
        const first = await firstResponse.json(); assert.equal(first.totalCount, 2); assert.equal(first.items[0].familyId, 'unicode-two');
        assert.ok(first.nextCursor.length < 2048);
        const nextQuery = libraryCatalogueQuery({ aircraftModels: models, limit: 1, cursor: first.nextCursor });
        assert.ok(Buffer.byteLength(`${base}?${nextQuery}`) < LIBRARY_CATALOG_PAGED_QUERY_BUDGET);
        const secondResponse = await fetch(`${base}?${nextQuery}`); assert.equal(secondResponse.status, 200);
        const second = await secondResponse.json(); assert.equal(second.items[0].familyId, 'unicode-one'); assert.equal(second.nextCursor, null);
        const over = Array.from({ length: 16 }, (_, index) => `${index}型`.padEnd(24, '号'));
        const denied = await fetch(`${base}?aircraftModels=${encodeURIComponent(JSON.stringify(over))}`);
        assert.equal(denied.status, 400); assert.equal((await denied.json()).error, 'LIBRARY_AIRCRAFT_MODELS_TOO_LONG');
      } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    });
    t.diagnostic('Production SQL and service cursors on owned local PostgreSQL; synthetic catalog only, no production RLS/business acceptance claim.');
  } finally { await owned.stop(); }
});
