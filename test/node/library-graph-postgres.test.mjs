import assert from 'node:assert/strict';
import { readFile, access, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { libraryAircraftMentionAliases } = require('../../shared/library-aircraft-mentions.ts');
const {
  libraryGraphStatement,
  listOwnedLibraryGraph,
} = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-library-graph-query.ts');
const { CanonicalLibraryService } = require('../../server/modules/canonical-host/canonical-library.service.ts');
const { libraryGraphHttpRequest } = require('../../server/modules/canonical-host/canonical-library-graph.ts');
const { tenantFamilyIdentityPrefix } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts');
const {
  postgresCapability,
  startOwnedPostgres,
} = await import('../pg/owned-postgres-cluster.mjs');

// Keep default artifacts inside the checkout; acceptance runners may explicitly
// choose a separate evidence directory without assuming a parent-folder layout.
const evidenceDirectory = resolve(process.env.LIBRARY_GRAPH_EVIDENCE_DIRECTORY ?? 'tmp/library-graph-postgres-evidence');
const evidenceFile = (name) => join(evidenceDirectory, name);

const readMigration = (name) =>
  readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
const sourceRef = {
  tenantId: 'tenant-a',
  actorUserId: 'actor-a',
};
const dataSha = 'a'.repeat(64);
const appId = 'app_17bzc551rsg';

function hostActor(userId = sourceRef.actorUserId, tenantId = sourceRef.tenantId) {
  const identity = {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    tenantId,
    applicationScopeId: appId,
    subjectDecision: {
      applicationScopeId: appId,
      tenantId,
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      version: 'miaoda-hosted-native-sso.v1',
    },
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    env: 'runtime',
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
  return {
    userId,
    tenantId,
    appId,
    roles: [],
    env: 'runtime',
    objectAccessActor: identity,
  };
}

function metadata({ ata = [], aircraft = [], title = [] } = {}) {
  const observations = (values) =>
    values.map((value) => ({
      value,
      status: 'PENDING_REVIEW',
      evidence: [{ page: 1, text: `Fixture observation ${value}` }],
    }));
  const typed = (values) => ({
    status: values.length ? 'PENDING_REVIEW' : 'NOT_FOUND',
    observations: observations(values),
  });
  return {
    schemaVersion: 'wiselink.document_metadata.v1',
    source: 'ACTUAL_PDF_TEXT',
    sourceSha256: dataSha,
    sourceByteLength: 1000,
    pageCount: 1,
    inspectedPages: [1],
    extractedAt: '2026-10-07T00:00:00.000Z',
    title: typed(title),
    documentType: typed([]),
    issuer: typed([]),
    ata: typed(ata),
    mentionedAircraftModels: typed(aircraft),
    aircraftModelSemantics: 'DOCUMENT_MENTION_ONLY',
    applicabilityAssessment: 'NOT_EVALUATED',
  };
}

async function applyFixtureSchema(admin) {
  await admin.unsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;
    CREATE TYPE user_profile AS (user_id text);
  `);

  // These are the repository's actual catalog and metadata migrations, including
  // their constraints, indexes, triggers, and catalog RLS policies.
  for (const migration of [
    '0001_document_management_hosted_catalog.sql',
    '0004_identity_oauth_session.sql',
    '0027_document_version_extracted_metadata.sql',
    '0028_document_metadata_revision.sql',
  ]) {
    await admin.unsafe(await readMigration(migration));
  }

  // Reuse the actual repository WorkItem DDL for its table and indexes. The
  // hosted actor-bound SELECT fixture from migration 0019 replaces the legacy
  // broad service_role policy for this read, matching the existing RLS test
  // pattern in test/node/local-mineru-worker-rls.test.mjs.
  const workItemDdl = await readFile(
    new URL('../../server/database/work-item.ddl.sql', import.meta.url),
    'utf8',
  );
  const actionAttempt = workItemDdl.indexOf('CREATE TABLE action_attempt');
  assert.ok(actionAttempt > 0, 'actual WorkItem DDL marker exists');
  await admin.unsafe(`${workItemDdl.slice(0, actionAttempt)} COMMIT;`);
  await admin.unsafe('ALTER TABLE work_item ENABLE ROW LEVEL SECURITY');
  await admin.unsafe(
    'DROP POLICY identity_subject_mapping_service ON identity_subject_mapping',
  );
  const hostedPolicyMigration = await readMigration(
    '0019_interactive_review_hosted_runtime_select.sql',
  );
  const policyStart = hostedPolicyMigration.indexOf(
    'DROP POLICY IF EXISTS identity_subject_mapping_hosted_runtime_actor_select',
  );
  const reviewPolicies = hostedPolicyMigration.indexOf(
    'DROP POLICY IF EXISTS review_conversation',
    policyStart,
  );
  assert.ok(policyStart >= 0 && reviewPolicies > policyStart);
  await admin.unsafe(
    `${hostedPolicyMigration.slice(policyStart, reviewPolicies)} COMMIT;`,
  );

  await admin.unsafe(`
    GRANT USAGE ON SCHEMA public TO service_role;
    GRANT SELECT ON identity_subject_mapping, work_item, dm_publication_family,
      dm_document, dm_document_version, dm_document_version_metadata, dm_acquisition
      TO service_role;
  `);

  await admin`
    INSERT INTO identity_subject_mapping
      (feishu_open_id,feishu_tenant_key,miaoda_user_id,miaoda_tenant_id,
        expected_client_id,status,revision)
    VALUES
      ('open-a','tenant-key-a','actor-a','tenant-a','cli_aadde8b579f95bc9','ACTIVE',1),
      ('open-b','tenant-key-b','actor-b','tenant-b','cli_aadde8b579f95bc9','ACTIVE',1)
  `;
}

async function seedCatalog(admin) {
  const tenantPrefix = tenantFamilyIdentityPrefix(sourceRef.tenantId).replaceAll("'", "''");
  await admin.unsafe(`
    CREATE TEMP TABLE graph_seed AS
    SELECT i,
      'V-' || lpad(i::text,8,'0') AS version_id,
      CASE
        WHEN i <= 10000 THEN 'F-HUGE'
        WHEN i BETWEEN 10001 AND 10004 THEN 'F-REV-A'
        WHEN i BETWEEN 10005 AND 10008 THEN 'F-REV-B'
        WHEN i BETWEEN 10009 AND 10012 THEN 'F-REV-C'
        ELSE 'F-SCALE-' || lpad(
          (1 + mod(floor((i-10013)::numeric / 4)::integer,9996))::text,5,'0')
      END AS family_id
    FROM generate_series(1,50000) AS i;

    INSERT INTO dm_publication_family
      (family_id,canonical_identity_key,document_family,issuer_authority,
        canonical_document_number,current_document_version_id,current_generation,
        status,created_at,updated_at)
    SELECT family_id, '${tenantPrefix}' || family_id,
      CASE WHEN family_id LIKE 'F-REV-%' OR family_id='F-HUGE' THEN 'FTD' ELSE 'SB' END,
      'FIXTURE-OEM','DOC-' || family_id,
      CASE WHEN family_id='F-HUGE' THEN 'V-00010000' ELSE max(version_id) END,
      1,'COMMITTED',TIMESTAMPTZ '2026-01-01 00:00:00+00',TIMESTAMPTZ '2026-01-01 00:00:00+00'
    FROM graph_seed GROUP BY family_id;

    INSERT INTO dm_document(document_id,family_id,document_family,status,created_at)
    SELECT 'D-' || family_id,family_id,
      CASE WHEN family_id LIKE 'F-REV-%' OR family_id='F-HUGE' THEN 'FTD' ELSE 'SB' END,
      'COMMITTED',TIMESTAMPTZ '2026-01-01 00:00:00+00'
    FROM (SELECT DISTINCT family_id FROM graph_seed) families;

    INSERT INTO dm_document_version
      (document_version_id,document_id,family_id,revision_id,canonical_revision_identity,
        business_revision,revision_date,source_generated_date,original_filename,
        source_artifact_id,acquisition_id,pdf_sha256,byte_length,media_type,
        lifecycle_status,committed_at,committed_by)
    SELECT version_id,'D-' || family_id,family_id,version_id,version_id,
      'R' || i,'2026-01-01','2026-01-01',version_id || '.pdf',
      'ART-' || version_id,'ACQ-' || version_id,repeat('a',64),1000,'application/pdf',
      'COMMITTED',TIMESTAMPTZ '2026-01-01 00:00:00+00' + i * interval '1 second','fixture'
    FROM graph_seed;

    INSERT INTO dm_document_version_metadata
      (document_version_id,metadata_revision,request_id,extracted_metadata)
    SELECT version_id,1,NULL,jsonb_build_object(
      'schemaVersion','wiselink.document_metadata.v1',
      'source','ACTUAL_PDF_TEXT','sourceSha256',repeat('a',64),
      'sourceByteLength',1000,'pageCount',1,'inspectedPages','[1]'::jsonb,
      'extractedAt','2026-10-07T00:00:00.000Z',
      'title',jsonb_build_object('status','PENDING_REVIEW','observations',
        jsonb_build_array(jsonb_build_object('value','GENERIC-' || i,'status','PENDING_REVIEW','evidence','[]'::jsonb))),
      'documentType',jsonb_build_object('status','NOT_FOUND','observations','[]'::jsonb),
      'issuer',jsonb_build_object('status','NOT_FOUND','observations','[]'::jsonb),
      'ata',jsonb_build_object('status','PENDING_REVIEW','observations',
        jsonb_build_array(jsonb_build_object('value','ATA-' || lpad(mod(i,50)::text,2,'0'),'status','PENDING_REVIEW','evidence','[]'::jsonb))),
      'mentionedAircraftModels',jsonb_build_object('status','PENDING_REVIEW','observations',
        jsonb_build_array(jsonb_build_object('value','MODEL-' || mod(i,6),'status','PENDING_REVIEW','evidence','[]'::jsonb))),
      'aircraftModelSemantics','DOCUMENT_MENTION_ONLY',
      'applicabilityAssessment','NOT_EVALUATED'
    )
    FROM graph_seed
    WHERE i NOT BETWEEN 10001 AND 10012 AND i NOT IN (10014,10021,10025,10029);

    INSERT INTO work_item
      (work_item_id,tenant_id,action_type,document_id,document_version_id,
        source_artifact_id,source_file_sha256,source_byte_length,normalized_family,
        request_id,requested_by_user_id,created_at,updated_at)
    SELECT 'WI-' || version_id,'tenant-a','PARSE_PDF','D-' || family_id,version_id,
      'ART-' || version_id,repeat('a',64),1000,
      CASE WHEN family_id LIKE 'F-REV-%' OR family_id='F-HUGE' THEN 'FTD' ELSE 'SB' END,
      'REQ-' || version_id,'actor-a',TIMESTAMPTZ '2026-01-01 00:00:00+00',TIMESTAMPTZ '2026-01-01 00:00:00+00'
    FROM graph_seed WHERE i NOT IN (10000,10002,10013);

    DROP TABLE graph_seed;
  `);

  // The same exact document/version attached to another tenant's WorkItem does
  // not authorize it in tenant-a. Likewise, a wrong-artifact acquisition does
  // not authorize version 10013.
  await admin`
    INSERT INTO work_item
      (work_item_id,tenant_id,action_type,document_id,document_version_id,
        source_artifact_id,source_file_sha256,source_byte_length,normalized_family,
        request_id,requested_by_user_id,created_at,updated_at)
    VALUES ('WI-CROSS-TENANT','tenant-b','PARSE_PDF','D-F-REV-A','V-00010002',
      'ART-V-00010002',${dataSha},1000,'FTD','REQ-CROSS-TENANT','actor-a',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',TIMESTAMPTZ '2026-01-01 00:00:00+00')
  `;
  await admin`
    INSERT INTO dm_acquisition
      (acquisition_id,source_artifact_id,document_version_id,source_channel,source_ref,
       selection_bucket_id,selection_file_path,provider_object_id,provider_version_id,
       acquired_by,acquired_at,idempotency_key,source_descriptor_json,status)
    VALUES ('ACQ-WRONG-ARTIFACT','ART-WRONG','V-00010013','FIXTURE','fixture://wrong',
      'fixture-bucket','fixture/wrong.pdf','fixture-object','fixture-version','actor-a',
      TIMESTAMPTZ '2026-01-01 00:00:00+00','tenant:tenant-a:request:wrong-artifact',
      '{}','COMMITTED_CANONICAL')
  `;

  // Eligible acquisition-only access works for the exact artifact. Each
  // negative row differs by exactly one authorization dimension.
  await admin`
    DELETE FROM work_item
    WHERE document_version_id IN ('V-00010015','V-00010017','V-00010018','V-00010019')
  `;
  await insertAcquisition(admin, 'V-00010015', 'acq-only', {
    status: 'LINKED_EXACT_DOCUMENT_VERSION',
  });
  await insertAcquisition(admin, 'V-00010017', 'wrong-status', {
    status: 'FAILED',
  });
  await insertAcquisition(admin, 'V-00010018', 'wrong-actor', {
    acquiredBy: 'actor-b',
  });
  await insertAcquisition(admin, 'V-00010019', 'wrong-tenant', {
    idempotencyTenant: 'tenant-b',
  });

  // Two valid task routes for one exact version test that authorization joins
  // cannot multiply a graph node. Metadata revisions use the real 0028 shape.
  await admin`
    INSERT INTO work_item
      (work_item_id,tenant_id,action_type,document_id,document_version_id,
        source_artifact_id,source_file_sha256,source_byte_length,normalized_family,
        request_id,requested_by_user_id,created_at,updated_at)
    VALUES ('WI-DUPLICATE-V10001','tenant-a','READ_PDF','D-F-REV-A','V-00010001',
      'ART-V-00010001',${dataSha},1000,'FTD','REQ-DUPLICATE-V10001','actor-a',
      TIMESTAMPTZ '2026-01-01 00:00:00+00',TIMESTAMPTZ '2026-01-01 00:00:00+00')
  `;

  await insertMetadata(admin, 'V-00010001', 1, metadata({ ata: ['90'] }), null);
  await insertMetadata(admin, 'V-00010001', 2, metadata({ ata: ['20', '20'] }), 'metadata-latest-10001');
  await insertMetadata(admin, 'V-00010003', 1, metadata({ aircraft: ['737'] }), null);
  await insertMetadata(admin, 'V-00010005', 1, metadata({ title: ['SPECIAL-REV-B'] }), null);
  await insertMetadata(admin, 'V-00010009', 1, metadata({ aircraft: ['737-800'] }), null);
  await insertMetadata(admin, 'V-00010007', 1, metadata({ ata: [''] }), null);
  await insertMetadata(admin, 'V-00010021', 1, metadata({ title: ['PERCENT%TOKEN'] }), null);
  await insertMetadata(admin, 'V-00010025', 1, metadata({ title: ['UNDERSCORE_TOKEN'] }), null);
  await insertMetadata(admin, 'V-00010029', 1, metadata({ title: ['BACK\\SLASH'] }), null);
  await admin.unsafe('ANALYZE');
}

async function insertAcquisition(admin, documentVersionId, suffix, overrides = {}) {
  const sourceArtifactId = `ART-${documentVersionId}`;
  await admin`
    INSERT INTO dm_acquisition
      (acquisition_id,source_artifact_id,document_version_id,source_channel,source_ref,
       selection_bucket_id,selection_file_path,provider_object_id,provider_version_id,
       acquired_by,acquired_at,idempotency_key,source_descriptor_json,status)
    VALUES (${`ACQ-${suffix}`},${overrides.sourceArtifactId ?? sourceArtifactId},${documentVersionId},
      'FIXTURE',${`fixture://${suffix}`},'fixture-bucket',${`fixture/${suffix}.pdf`},
      ${`object-${suffix}`},${`provider-${suffix}`},${overrides.acquiredBy ?? 'actor-a'},
      TIMESTAMPTZ '2026-01-01 00:00:00+00',
      ${`tenant:${overrides.idempotencyTenant ?? 'tenant-a'}:request:${suffix}`},
      '{}',${overrides.status ?? 'COMMITTED_CANONICAL'})
  `;
}

async function insertMetadata(admin, documentVersionId, metadataRevision, value, requestId) {
  await admin`
    INSERT INTO dm_document_version_metadata
      (document_version_id,metadata_revision,request_id,extracted_metadata)
    VALUES (${documentVersionId},${metadataRevision},${requestId},${admin.json(value)})
  `;
}

function graphInput(request, overrides = {}) {
  return {
    ...sourceRef,
    request,
    after: null,
    limit: 50,
    ...overrides,
  };
}

function summarizePlan(plan) {
  const nodes = [];
  const visit = (node) => {
    nodes.push({
      node: node['Node Type'],
      relation: node['Relation Name'] ?? null,
      actualRows: node['Actual Rows'] ?? null,
      loops: node['Actual Loops'] ?? null,
      tempReadBlocks: node['Temp Read Blocks'] ?? 0,
      tempWrittenBlocks: node['Temp Written Blocks'] ?? 0,
    });
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan.Plan);
  return {
    planningMs: plan['Planning Time'],
    executionMs: plan['Execution Time'],
    nodes,
  };
}

test('production macro library graph query preserves authorization and bounded projection on PostgreSQL', async (t) => {
  const capability = await postgresCapability();
  if (!capability.available) {
    t.skip(capability.reason);
    return;
  }

  await mkdir(evidenceDirectory, { recursive: true });
  const owned = await startOwnedPostgres(capability);
  let runtime;
  let receipt;
  let failure;
  let diagnosticPlanPath;
  const timings = [];
  const phaseLogs = [];
  const mark = (label, startedAt = performance.now()) => {
    const line = `LIBRARY_GRAPH_PG_PHASE ${label} elapsedMs=${Math.round(performance.now() - startedAt)}`;
    phaseLogs.push(line);
    process.stderr.write(`${line}\n`);
  };
  try {
    const admin = owned.admin;
    await admin.unsafe("SET statement_timeout='120s'");
    let phase = performance.now();
    mark('schema:start', phase);
    await applyFixtureSchema(admin);
    mark('schema:ready', phase);
    phase = performance.now();
    mark('seed-50000:start', phase);
    await seedCatalog(admin);
    mark('seed-50000:ready', phase);

    phase = performance.now();
    mark('service-role-connect:start', phase);
    runtime = await owned.connect();
    await runtime.unsafe('SET ROLE service_role');
    await runtime.unsafe("SET statement_timeout='45s'");
    await runtime.unsafe("SET app.user_id='actor-a'");
    mark('service-role-connect:ready', phase);
    const db = drizzle(runtime);
    if (process.env.LIBRARY_GRAPH_PLAN_ONLY === '1') {
      const input = graphInput({ level: 'clusters', groupBy: 'normalizedFamily' }, { limit: 50 });
      const statement = libraryGraphStatement(input);
      const compiled = db.dialect.sqlToQuery(statement);
      const planLabel = (process.env.LIBRARY_GRAPH_PLAN_LABEL || 'attempt3')
        .toLowerCase()
        .replace(/[^a-z0-9-]/gu, '-');
      const planEvidenceName = `library-graph-postgres-${planLabel}-plan.json`;
      const planStarted = performance.now();
      mark('explain-format-json-50000:start', planStarted);
      const [planRow] = await db.execute(sql`EXPLAIN (FORMAT JSON) ${statement}`);
      const planElapsedMs = Math.round(performance.now() - planStarted);
      const plan = planRow['QUERY PLAN'][0];
      const diagnostic = {
        status: 'DIAGNOSTIC_ONLY',
        mode: 'EXPLAIN (FORMAT JSON); no graph SELECT or EXPLAIN ANALYZE was executed',
        environment: 'owned disposable PostgreSQL 17 loopback cluster; service_role; actor-a RLS setting',
        cardinality: {
          documentVersions: 50000,
          families: 10000,
          populatedLatestMetadataRows: 49993,
          physicalTenThousandVersionFamily: 10000,
        },
        planningCallElapsedMs: planElapsedMs,
        generatedQuery: { sql: compiled.sql, params: compiled.params },
        plan,
        cleanup: 'pending',
      };
      diagnosticPlanPath = evidenceFile(planEvidenceName);
      await writeFile(
        diagnosticPlanPath,
        `${JSON.stringify(diagnostic, null, 2)}\n`,
      );
      receipt = {
        status: 'DIAGNOSTIC_ONLY',
        planEvidence: planEvidenceName,
        planCallElapsedMs: planElapsedMs,
        phaseLogs,
        cleanup: 'pending',
      };
      mark('explain-format-json-50000:ready', planStarted);
      t.skip('diagnostic-only EXPLAIN plan capture; no graph result or acceptance assertions were run');
      return;
    }
    if (process.env.LIBRARY_GRAPH_TIMED_ONE === '1') {
      const input = graphInput({ level: 'clusters', groupBy: 'normalizedFamily' }, { limit: 50 });
      let calls = 0;
      const started = performance.now();
      mark('single-select-50000:start', started);
      const [row] = await listOwnedLibraryGraph({
        execute: (statement) => {
          calls += 1;
          return db.execute(statement);
        },
      }, input);
      const elapsedMs = Math.round(performance.now() - started);
      const queryReceipt = {
        status: 'DIAGNOSTIC_ONLY',
        mode: 'one production repository graph SELECT; no other graph read or EXPLAIN ANALYZE replay',
        request: { level: input.request.level, groupBy: input.request.groupBy, limit: input.limit },
        calls,
        elapsedMs,
        result: {
          uniqueFamilyCount: row.uniqueFamilyCount,
          readableVersionCountInMatchingFamilies: row.readableVersionCountInMatchingFamilies,
          invalidData: row.invalidData,
          rawRowsWithLookahead: row.items.length,
          serializedBytes: Buffer.byteLength(JSON.stringify(row)),
        },
        cleanup: 'pending',
      };
      await writeFile(
        evidenceFile('library-graph-postgres-after-boolean-identity-check-single-query.json'),
        `${JSON.stringify(queryReceipt, null, 2)}\n`,
      );
      receipt = queryReceipt;
      timings.push({ label: 'clusters/normalizedFamily/diagnostic-one-select', elapsedMs });
      mark('single-select-50000:ready', started);
      t.skip('diagnostic-only single full-scope SELECT; no other acceptance assertions were run');
      return;
    }
    const [role] = await runtime`
      SELECT current_user AS role, r.rolsuper, r.rolbypassrls,
        c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS table_owner,
        c.relrowsecurity AS rls
      FROM pg_roles r,pg_class c
      WHERE r.rolname=current_user AND c.oid='work_item'::regclass
    `;
    assert.deepEqual(role, {
      role: 'service_role',
      rolsuper: false,
      rolbypassrls: false,
      table_owner: false,
      rls: true,
    });
    const [tenantBRows] = await runtime`
      SELECT count(*)::integer AS n FROM work_item WHERE tenant_id='tenant-b'
    `;
    assert.equal(tenantBRows.n, 0, 'actor-bound RLS hides the cross-tenant WorkItem');

    let graphSequence = 0;
    const executeGraph = async (input, instrument = false) => {
      let calls = 0;
      const label = `${input.request.level}/${input.request.groupBy ?? input.request.familyId ?? 'page'}/${++graphSequence}`;
      const queryStarted = performance.now();
      mark(`query:${label}:start`, queryStarted);
      const client = instrument
        ? { execute: (statement) => { calls += 1; return db.execute(statement); } }
        : db;
      const rows = await listOwnedLibraryGraph(client, input);
      if (instrument) assert.equal(calls, 1, 'one graph request executes one database statement');
      mark(`query:${label}:ready`, queryStarted);
      timings.push({ label, elapsedMs: Math.round(performance.now() - queryStarted) });
      return rows[0];
    };

    const fleetCatalog = {
      scope: 'CURRENT_TENANT_ACTIVE_FLEET',
      status: 'AVAILABLE',
      asOf: '2026-10-07',
      source: {
        sourceSnapshotId: 'FLEET-SNAPSHOT-1',
        sourceRevisionKey: 'FLEET-REVISION-1',
        sourceAsOf: '2026-10-07',
        authorityRevision: 'FLEET-AUTHORITY-1',
      },
      families: [{ fleetFamily: 'B737', models: ['B737-800'] }],
      unclassifiedAssetCount: 0,
      semantics: 'DOCUMENT_MENTION_CLASSIFICATION_ONLY',
    };
    const service = new CanonicalLibraryService(
      { graph: (input) => listOwnedLibraryGraph(db, input) },
      {},
      {},
      undefined,
      {
        readLibraryCatalog: async ({ tenantId }) => {
          assert.equal(tenantId, sourceRef.tenantId);
          return fleetCatalog;
        },
      },
    );
    const actor = hostActor();

    const all = await executeGraph(graphInput({ level: 'clusters', groupBy: 'normalizedFamily' }, { limit: 50 }), true);
    assert.equal(all.uniqueFamilyCount, 10000);
    assert.equal(all.readableVersionCountInMatchingFamilies, 49994);
    assert.equal(all.invalidData, false);
    assert.ok(all.items.length <= 51);
    assert.ok(Buffer.byteLength(JSON.stringify(all)) < 256 * 1024);
    const [metadataRows] = await admin`
      SELECT count(*)::integer AS n FROM dm_document_version_metadata
    `;
    assert.equal(metadataRows.n, 49993, 'short latest metadata is present for ordinary scale versions');

    phase = performance.now();
    mark('plan-clusters-50000:start', phase);
    const clusterInput = graphInput(
      { level: 'clusters', groupBy: 'normalizedFamily' },
      { limit: 50 },
    );
    const clusterStatement = libraryGraphStatement(clusterInput);
    const clusterCompiled = db.dialect.sqlToQuery(clusterStatement);
    const [clusterPlanRow] = await db.execute(sql`
      EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON)
      ${clusterStatement}
    `);
    const clusterPlanRaw = clusterPlanRow['QUERY PLAN'][0];
    const clusterPlan = summarizePlan(clusterPlanRaw);
    mark('plan-clusters-50000:ready', phase);

    const wrongActor = await executeGraph(graphInput(
      { level: 'clusters', groupBy: 'normalizedFamily' },
      { tenantId: 'tenant-a', actorUserId: 'actor-c' },
    ));
    assert.equal(wrongActor.uniqueFamilyCount, 0);
    assert.equal(wrongActor.readableVersionCountInMatchingFamilies, 0);
    assert.deepEqual(wrongActor.items, []);

    const wrongTenant = await executeGraph(graphInput(
      { level: 'clusters', groupBy: 'normalizedFamily' },
      { tenantId: 'tenant-b', actorUserId: 'actor-a' },
    ));
    assert.equal(wrongTenant.uniqueFamilyCount, 0);
    assert.deepEqual(wrongTenant.items, []);

    const publicFamilies = await service.graph({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB', limit: 50,
    }, actor);
    assert.ok(publicFamilies.items.length <= 50);
    assert.equal(publicFamilies.limit, 50);
    assert.ok(Buffer.byteLength(JSON.stringify(publicFamilies)) < 256 * 1024);
    await assert.rejects(
      service.graph({ level: 'clusters', groupBy: 'ata', limit: 51 }, actor),
      (error) => error.getStatus?.() === 400,
      'public page limit is capped at 50',
    );
    await assert.rejects(
      service.graph({ level: 'clusters', groupBy: 'ata', actorUserId: 'actor-b' }, actor),
      (error) => error.getStatus?.() === 400,
      'actor scope is never accepted from graph request fields',
    );
    const otherActor = await service.graph(
      { level: 'clusters', groupBy: 'normalizedFamily', limit: 50 },
      hostActor('actor-b', 'tenant-b'),
    );
    assert.equal(otherActor.counts.uniqueFamilyCount, 0);
    assert.deepEqual(otherActor.items, []);

    const wrongArtifactFamily = await executeGraph(graphInput(
      { level: 'versions', familyId: 'F-SCALE-00001' },
    ));
    assert.equal(wrongArtifactFamily.readableVersionCountInMatchingFamilies, 7);
    assert.ok(!wrongArtifactFamily.items.some((item) => item.documentVersionId === 'V-00010013'));

    const familyAnd = await executeGraph(graphInput({
      level: 'families',
      groupBy: 'normalizedFamily',
      clusterValue: 'FTD',
      ata: '20',
      aircraftModel: '737',
    }));
    assert.equal(familyAnd.uniqueFamilyCount, 1);
    assert.equal(familyAnd.readableVersionCountInMatchingFamilies, 3);
    assert.deepEqual(familyAnd.items.map((item) => item.familyId), ['F-REV-A']);

    const staleAta = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD', ata: '90',
    }));
    assert.equal(staleAta.uniqueFamilyCount, 0, 'revision 2 supersedes the earlier ATA observation');
    assert.deepEqual(staleAta.items, []);

    const latestAta = await executeGraph(graphInput({
      level: 'clusters', groupBy: 'ata', ata: '20',
    }));
    assert.equal(latestAta.uniqueFamilyCount, 1);
    assert.equal(latestAta.readableVersionCountInMatchingFamilies, 3);
    assert.deepEqual(latestAta.items.map((item) => [item.value, item.uniqueFamilyCount]), [['20', 1]]);

    const familyType = await executeGraph(graphInput({
      level: 'clusters', groupBy: 'normalizedFamily', normalizedFamily: 'FTD',
    }));
    assert.equal(familyType.uniqueFamilyCount, 4);
    assert.equal(familyType.items[0].value, 'FTD');
    assert.equal(familyType.items[0].uniqueFamilyCount, 4);

    const aircraft = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD', aircraftModel: '737',
    }));
    assert.equal(aircraft.uniqueFamilyCount, 1);
    assert.deepEqual(aircraft.items.map((item) => item.familyId), ['F-REV-A']);

    const search = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD', search: 'SPECIAL-REV-B',
    }));
    assert.equal(search.uniqueFamilyCount, 1);
    assert.deepEqual(search.items.map((item) => item.familyId), ['F-REV-B']);

    const aliases = libraryAircraftMentionAliases('B737-800');
    assert.deepEqual(aliases, ['B737-800', '737-800']);
    const fleet = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD',
      fleetFamily: 'B737', fleetModel: 'B737-800',
    }, { fleetMentionValues: aliases }));
    assert.equal(fleet.uniqueFamilyCount, 1);
    assert.deepEqual(fleet.items.map((item) => item.familyId), ['F-REV-C']);
    const serviceFleet = await service.graph({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD',
      fleetFamily: 'B737', fleetModel: 'B737-800', limit: 50,
    }, actor);
    assert.deepEqual(serviceFleet.items.map((item) => item.familyId), ['F-REV-C']);
    assert.equal(serviceFleet.relationMeaning, 'CLASSIFICATION_AND_CONTAINMENT_ONLY');

    // Public ATA node pages traverse missing (null), exact empty, and ordinary
    // nonempty keys. The service cursor is scoped to the same graph request.
    const firstAta = await service.graph(libraryGraphHttpRequest({
      level: 'clusters', groupBy: 'ata', limit: '1',
    }), actor);
    assert.equal(firstAta.items[0].value, null);
    assert.equal(firstAta.hasMore, true);
    const secondAta = await service.graph(libraryGraphHttpRequest({
      level: 'clusters', groupBy: 'ata', limit: '1', cursor: firstAta.nextCursor,
    }), actor);
    assert.equal(secondAta.items[0].value, '');
    assert.equal(secondAta.hasMore, true);
    const thirdAta = await service.graph(libraryGraphHttpRequest({
      level: 'clusters', groupBy: 'ata', limit: '1', cursor: secondAta.nextCursor,
    }), actor);
    assert.equal(thirdAta.items[0].value, '20');
    assert.equal(thirdAta.hasMore, true);
    const missingAtaFamilies = await service.graph(libraryGraphHttpRequest({
      level: 'families', groupBy: 'ata', clusterMissing: 'true', limit: '50',
    }), actor);
    const emptyAtaFamilies = await service.graph(libraryGraphHttpRequest({
      level: 'families', groupBy: 'ata', clusterValue: '', limit: '50',
    }), actor);
    assert.ok(missingAtaFamilies.items.some((item) => item.familyId === 'F-REV-C'));
    assert.ok(emptyAtaFamilies.items.some((item) => item.familyId === 'F-REV-B'));
    assert.ok(!emptyAtaFamilies.items.some((item) => item.familyId === 'F-REV-C'));

    // Escaped LIKE metacharacters match literal observations, not broad patterns.
    const literalPercent = await service.graph({
      level: 'clusters', groupBy: 'normalizedFamily', search: '%', limit: 50,
    }, actor);
    const literalUnderscore = await service.graph({
      level: 'clusters', groupBy: 'normalizedFamily', search: '_', limit: 50,
    }, actor);
    const literalBackslash = await service.graph({
      level: 'clusters', groupBy: 'normalizedFamily', search: '\\', limit: 50,
    }, actor);
    assert.equal(literalPercent.counts.uniqueFamilyCount, 1);
    assert.equal(literalPercent.items[0].value, 'SB');
    assert.equal(literalUnderscore.counts.uniqueFamilyCount, 1);
    assert.equal(literalBackslash.counts.uniqueFamilyCount, 1);

    const acquisitionOnly = await executeGraph(graphInput({
      level: 'versions', familyId: 'F-SCALE-00001',
    }));
    assert.equal(acquisitionOnly.readableVersionCountInMatchingFamilies, 7);
    assert.ok(acquisitionOnly.items.some((item) => item.documentVersionId === 'V-00010015'));
    const wrongAcquisitions = await executeGraph(graphInput({
      level: 'versions', familyId: 'F-SCALE-00002',
    }));
    assert.deepEqual(wrongAcquisitions.items.map((item) => item.documentVersionId), ['V-00010020']);

    // The selected 10,000-version family is freshly authorized, returns only a
    // 50-row page plus one lookahead row, and never joins reading or parse data.
    const [physicalHuge] = await admin`
      SELECT count(*)::integer AS n FROM dm_document_version WHERE family_id='F-HUGE'
    `;
    assert.equal(physicalHuge.n, 10000);
    const hugeInput = graphInput({ level: 'versions', familyId: 'F-HUGE' });
    const hugeSql = db.dialect.sqlToQuery(libraryGraphStatement(hugeInput)).sql;
    assert.doesNotMatch(hugeSql, /dm_document_version_metadata|dm_document_parse_run|dm_document_reading_run/u);
    assert.match(hugeSql, /f\.family_id\s*=\s*\$\d+/u, 'family anchor is pushed into the visible-version scan');
    assert.doesNotMatch(hugeSql.trim(), /;\s*\S/u, 'graph SQL is one statement');
    phase = performance.now();
    mark('plan-anchor-10000:start', phase);
    const versionStatement = libraryGraphStatement(hugeInput);
    const versionCompiled = db.dialect.sqlToQuery(versionStatement);
    const [versionPlanRow] = await db.execute(sql`
      EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${versionStatement}
    `);
    const versionPlanRaw = versionPlanRow['QUERY PLAN'][0];
    const versionPlan = summarizePlan(versionPlanRaw);
    mark('plan-anchor-10000:ready', phase);
    await writeFile(
      evidenceFile('library-graph-postgres-final-plans.json'),
      `${JSON.stringify({
        status: 'ACTUAL_EXPLAIN_ANALYZE',
        fixture: { documentVersions: 50000, families: 10000, populatedLatestMetadataRows: 49993 },
        clusterQuery: { sql: clusterCompiled.sql, params: clusterCompiled.params, plan: clusterPlanRaw },
        anchoredVersionQuery: { sql: versionCompiled.sql, params: versionCompiled.params, plan: versionPlanRaw },
        caveat: 'Local synthetic PostgreSQL plan evidence only; not a hosted-production workload or SLA',
      }, null, 2)}\n`,
    );
    const huge = await executeGraph(hugeInput, true);
    assert.equal(huge.uniqueFamilyCount, 1);
    assert.equal(huge.readableVersionCountInMatchingFamilies, 9999);
    assert.equal(huge.items.length, 51);
    assert.ok(Buffer.byteLength(JSON.stringify(huge)) < 256 * 1024);
    assert.ok(!JSON.stringify(huge).includes('V-00010000'), 'hidden current version ID is absent');
    assert.ok(huge.items.every((item) => item.isCurrent === false));

    // Cursor pages are keyset ordered and bounded to limit+1 raw rows.
    const first = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB',
    }, { limit: 1 }));
    assert.equal(first.items.length, 2);
    const firstId = first.items[0].familyId;
    const second = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'SB',
    }, { limit: 1, after: { value: firstId } }));
    assert.equal(second.items.length, 2);
    assert.ok(second.items[0].familyId > firstId);
    assert.notEqual(second.items[0].familyId, firstId);

    // Permissions are checked again for the next live page. Removing the three
    // later FTD families after page one prevents them from returning by cursor.
    const beforeRevocation = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD',
    }, { limit: 1 }));
    assert.equal(beforeRevocation.items.length, 2);
    const afterRevocation = beforeRevocation.items[0].familyId;
    const serviceBeforeRevocation = await service.graph({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD', limit: 1,
    }, actor);
    assert.equal(serviceBeforeRevocation.hasMore, true);
    await admin`
      DELETE FROM work_item
      WHERE tenant_id='tenant-a' AND requested_by_user_id='actor-a'
        AND document_id IN ('D-F-REV-A','D-F-REV-B','D-F-REV-C')
    `;
    const nextAfterRevocation = await executeGraph(graphInput({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD',
    }, { limit: 1, after: { value: afterRevocation } }));
    assert.deepEqual(nextAfterRevocation.items, []);
    const serviceNextAfterRevocation = await service.graph({
      level: 'families', groupBy: 'normalizedFamily', clusterValue: 'FTD', limit: 1,
      cursor: serviceBeforeRevocation.nextCursor,
    }, actor);
    assert.deepEqual(serviceNextAfterRevocation.items, []);

    // Oversized classification values produce an explicit incomplete-data flag;
    // the query does not silently truncate and present the value as authoritative.
    const oversizedAtaMetadata = metadata({ ata: ['X'.repeat(385)] });
    await insertMetadata(admin, 'V-00010014', 1, oversizedAtaMetadata, null);
    const invalidAta = await executeGraph(graphInput({ level: 'clusters', groupBy: 'ata' }));
    assert.equal(invalidAta.invalidData, true);
    assert.ok(!JSON.stringify(invalidAta).includes('X'.repeat(385)));

    // A later, otherwise-valid ATA revision isolates malformed aircraft values.
    const malformedAircraftMetadata = metadata({ ata: ['DATA-OK'] });
    malformedAircraftMetadata.mentionedAircraftModels = {
      status: 'PENDING_REVIEW',
      observations: [
        { value: null, status: 'PENDING_REVIEW', evidence: [] },
        { value: 737, status: 'PENDING_REVIEW', evidence: [] },
      ],
    };
    await insertMetadata(admin, 'V-00010014', 2, malformedAircraftMetadata, 'metadata-malformed-aircraft-10014');
    const invalidUnknownAircraft = await executeGraph(graphInput({
      level: 'clusters', groupBy: 'ata', aircraftModel: '__UNKNOWN__',
    }));
    assert.equal(invalidUnknownAircraft.invalidData, true);
    const invalidFleet = await executeGraph(graphInput({
      level: 'clusters', groupBy: 'ata', fleetFamily: 'B737', fleetModel: 'B737-800',
    }, { fleetMentionValues: aliases }));
    assert.equal(invalidFleet.invalidData, true);
    await assert.rejects(
      service.graph({
        level: 'clusters', groupBy: 'ata', fleetFamily: 'B737', fleetModel: 'B737-800',
      }, actor),
      (error) => error.getStatus?.() === 422 && error.getResponse?.()?.code === 'LIBRARY_GRAPH_DATA_LIMIT_EXCEEDED',
      'malformed observations fail closed as data-limit errors, not empty coverage',
    );

    const engine = await admin`SELECT version() AS version`;
    receipt = {
      status: 'PASS',
      postgres: engine[0].version.match(/PostgreSQL \d+\.\d+/u)?.[0] ?? 'unparsed',
      cluster: 'owned disposable loopback cluster; non-owner, non-BYPASSRLS service_role query session',
      fixture: '50,000 actual-schema DocumentVersion rows, 10,000 actual-schema families; one physical 10,000-version family',
      visibleCounts: { families: all.uniqueFamilyCount, versions: all.readableVersionCountInMatchingFamilies },
      populatedMetadataRows: metadataRows.n,
      hugeFamily: { physicalVersions: physicalHuge.n, readableVersions: huge.readableVersionCountInMatchingFamilies, returnedRows: huge.items.length, serializedBytes: Buffer.byteLength(JSON.stringify(huge)) },
      pageBounds: { requestedLimit: 50, sqlLookaheadRows: huge.items.length, serializedBytes: Buffer.byteLength(JSON.stringify(huge)) },
      plans: { clusters: clusterPlan, anchoredVersions: versionPlan },
      queryTimings: timings,
      phaseLogs,
      schemaAndRls: 'actual migrations 0001/0004/0027/0028 and actual 0019 actor SELECT policy; WorkItem table/indexes from repository DDL; local fixture grants and actor rows',
      limitations: 'synthetic local loopback fixture; no hosted database or production distribution; driver and EXPLAIN timings are local observations, not an HTTP latency/SLA claim',
      cleanup: 'pending',
    };
  } catch (error) {
    const causeChain = [];
    const seenErrors = new Set();
    for (let current = error; current && !seenErrors.has(current); current = current.cause) {
      seenErrors.add(current);
      causeChain.push({
        name: current.name ?? null,
        message: current.message ?? String(current),
        code: current.code ?? null,
        severity: current.severity ?? null,
      });
    }
    failure = {
      message: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
      causeChain,
    };
    throw error;
  } finally {
    if (runtime) await runtime.end();
    await owned.stop();
    await assert.rejects(access(owned.data));
    if (receipt) {
      receipt.cleanup = 'owned PostgreSQL listener/process stopped and temporary cluster directory removed';
    } else {
      receipt = {
        status: 'FAILED',
        failure,
        queryTimings: timings,
        phaseLogs,
        cleanup: 'owned PostgreSQL listener/process stopped and temporary cluster directory removed',
      };
    }
    if (diagnosticPlanPath) {
      const planEvidence = JSON.parse(await readFile(diagnosticPlanPath, 'utf8'));
      planEvidence.cleanup = receipt.cleanup;
      planEvidence.cleanupReceipt = 'library-graph-postgres-receipt.json';
      await writeFile(diagnosticPlanPath, `${JSON.stringify(planEvidence, null, 2)}\n`);
    }
    if (receipt && process.env.LIBRARY_GRAPH_TIMED_ONE === '1') {
      receipt.cleanup = 'owned PostgreSQL listener/process stopped and temporary cluster directory removed';
      receipt.phaseLogs = phaseLogs;
      receipt.queryTimings = timings;
      await writeFile(
        evidenceFile('library-graph-postgres-after-boolean-identity-check-single-query.json'),
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
    }
    await writeFile(
      evidenceFile('library-graph-postgres-receipt.json'),
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    console.log(`LIBRARY_GRAPH_PG_ACCEPTANCE_RECEIPT=${JSON.stringify(receipt)}`);
  }
});
