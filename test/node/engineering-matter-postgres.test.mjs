import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  EngineeringMatterRepository,
} = require('../../server/modules/canonical-host/engineering-matter.repository.ts');
const {
  EngineeringMatterService,
} = require('../../server/modules/canonical-host/engineering-matter.service.ts');
const {
  MiaodaDocumentVersionSourceResolver,
} = require('../../server/modules/work-item/miaoda-document-version-source.resolver.ts');
const {
  MiaodaHostedCanonicalObjectAccessAdapter,
} = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');

const databaseUrl = process.env.ENGINEERING_MATTER_TEST_DATABASE_URL;
const FTD_WORK_ITEM_ID = 'WI-DM-FTD-FD88DCB9CF64CF3B';
const SB_WORK_ITEM_ID = 'WI-LOCAL-737-34-3830-ASSESSMENT';
const REQUEST_REUSE_WORK_ITEM_ID = 'WI-DM-FTD-FD88DCB9CF64CF3B-RERUN';

test(
  'R09 Engineering Matter creates, revises and reads two real-document WorkItems with fresh ACL/currentness',
  { skip: !databaseUrl, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const sql = postgres(databaseUrl, { max: 8, onnotice: () => {} });
    try {
      const fixtures = await loadRealDocumentFixtures();
      await resetDatabase(sql);
      await seedRealDocumentWorkItems(sql, fixtures);

      const owner = await reserveActorService('actor-A');
      try {
        const created = await owner.service.create(
          {
            requestId: 'REQ-MATTER-REAL-DOCUMENTS-1',
            title: 'AIMS-2 and 737 FMC engineering matter',
            primaryWorkItemId: FTD_WORK_ITEM_ID,
          },
          owner.actor,
        );
        assert.equal(created.created, true);
        assert.equal(created.matter.currentRevision.revisionNo, 1);
        assert.deepEqual(
          created.matter.catalog.entries.map((entry) => entry.workItemId),
          [FTD_WORK_ITEM_ID],
        );

        const createReplay = await owner.service.create(
          {
            requestId: 'REQ-MATTER-REAL-DOCUMENTS-1',
            title: 'AIMS-2 and 737 FMC engineering matter',
            primaryWorkItemId: FTD_WORK_ITEM_ID,
          },
          owner.actor,
        );
        assert.equal(createReplay.created, false);
        assert.equal(createReplay.matter.matterId, created.matter.matterId);

        const linked = await owner.service.linkWorkItem(
          created.matter.matterId,
          {
            requestId: 'REQ-MATTER-LINK-REAL-SB-1',
            expectedMatterRevision: 1,
            workItemId: SB_WORK_ITEM_ID,
            changeSummary: 'Link actual 737-34-3830 Service Bulletin evidence.',
          },
          owner.actor,
        );
        assert.equal(linked.linked, true);
        assert.equal(linked.replayed, false);
        assert.equal(linked.matter.currentRevision.revisionNo, 2);
        assert.deepEqual(
          linked.matter.catalog.entries.map((entry) => ({
            workItemId: entry.workItemId,
            relationRole: entry.relationRole,
            sourceRefCount: entry.sourceNavigation.sourceRefCount,
            documentCode: entry.document.documentCode,
          })),
          [
            {
              workItemId: FTD_WORK_ITEM_ID,
              relationRole: 'PRIMARY',
              sourceRefCount: fixtures.ftd.sourceRefCount,
              documentCode: '777-FTD-31-21002',
            },
            {
              workItemId: SB_WORK_ITEM_ID,
              relationRole: 'RELATED',
              sourceRefCount: fixtures.sb.sourceRefCount,
              documentCode: '737-34-3830',
            },
          ],
        );

        const linkReplay = await owner.service.linkWorkItem(
          created.matter.matterId,
          {
            requestId: 'REQ-MATTER-LINK-REAL-SB-1',
            expectedMatterRevision: 1,
            workItemId: SB_WORK_ITEM_ID,
            changeSummary: 'Link actual 737-34-3830 Service Bulletin evidence.',
          },
          owner.actor,
        );
        assert.equal(linkReplay.linked, false);
        assert.equal(linkReplay.replayed, true);
        assert.equal(linkReplay.matter.currentRevision.revisionNo, 2);

        await assertLinkReplayMismatchAndCasConflict(
          owner,
          created.matter.matterId,
        );
        await advanceOwnerWorkItemCurrent(sql);
        const fresh = await owner.service.read(
          created.matter.matterId,
          owner.actor,
        );
        const ftd = fresh.catalog.entries.find(
          (entry) => entry.workItemId === FTD_WORK_ITEM_ID,
        );
        assert.equal(ftd.workItemChangedSinceLink, true);
        assert.equal(ftd.linkedAtWorkItemRevision, 4);
        assert.equal(ftd.currentWorkItemRevision, 5);
        assert.equal(ftd.documentCurrentness.selectedVersionIsCurrent, true);
        assert.equal(
          ftd.documentCurrentness.currentDocumentVersionId,
          'document_version_fd88dcb9cf64cf3ba21033ef',
        );
        assertBrowserSafe(fresh);

        await assertUnauthorizedLinkRollsBack(
          sql,
          owner,
          created.matter.matterId,
        );
        await assertAlreadyLinkedRequestReuse(
          sql,
          owner,
          created.matter.matterId,
        );
      } finally {
        await owner.release();
      }

      const outsider = await reserveActorService('actor-B');
      try {
        const [matter] = await sql`
          SELECT matter_id FROM engineering_matter LIMIT 1
        `;
        await assert.rejects(
          outsider.service.read(matter.matter_id, outsider.actor),
          (error) => error?.code === 'ENGINEERING_MATTER_NOT_FOUND',
        );
      } finally {
        await outsider.release();
      }

      const [matter] = await sql`
        SELECT matter_id FROM engineering_matter LIMIT 1
      `;
      await assertSecurityDefinerAndDirectRlsDenials(sql, matter.matter_id);

      const crossTenant = await reserveActorService('actor-C', 'tenant-B');
      try {
        await assert.rejects(
          crossTenant.service.read(matter.matter_id, crossTenant.actor),
          (error) => error?.code === 'ENGINEERING_MATTER_NOT_FOUND',
        );
      } finally {
        await crossTenant.release();
      }

      await assertMatterHistory(sql);
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
);

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname),
    'PostgreSQL integration test must use localhost',
  );
  assert.equal(
    parsed.pathname,
    '/wiselink_engineering_matter_test',
    'PostgreSQL integration test requires the exact isolated database name',
  );
}

async function loadRealDocumentFixtures() {
  const [ftdRequest, ftdPackage, sbPackage] = await Promise.all([
    readJson('test/fixtures/real-ftd-canonical-vertical.request.json'),
    readJson('test/fixtures/real-ftd-frozen2.unified-package.json'),
    readJson(
      'server/runtime-assets/assessment-host/real-sb/737-34-3830-original-issue/unified-package.frozen-2.json',
    ),
  ]);
  assert.equal(ftdRequest.workItemId, FTD_WORK_ITEM_ID);
  assert.equal(ftdRequest.source.documentVersionId.length > 0, true);
  assert.equal(ftdPackage.sourceRefs.length, 239);
  assert.equal(sbPackage.sourceRefs.length, 76);
  return {
    ftd: {
      ...ftdRequest.source,
      workItemId: ftdRequest.workItemId,
      packageId: ftdPackage.packageId,
      sourceRefCount: ftdPackage.sourceRefs.length,
    },
    sb: {
      workItemId: SB_WORK_ITEM_ID,
      documentId: 'document_10085d27e5c05266403bb74c',
      documentVersionId: 'document_version_f4813607b91ee1a20e754e2d',
      sourceArtifactId: 'source_artifact_phase5_local_actual_bytes',
      sourceFileSha256:
        'sha256:add32c7d4192d35c59162f15eb57f08247427135d5912438501ec9267fa4d41a',
      sourceByteLength: 1_060_204,
      packageId: sbPackage.packageId,
      sourceRefCount: sbPackage.sourceRefs.length,
    },
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(process.cwd(), path), 'utf8'));
}

async function resetDatabase(sql) {
  await sql.unsafe('DROP SCHEMA public CASCADE');
  await sql.unsafe('CREATE SCHEMA public');
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
      THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$
  `);
  await sql.unsafe('CREATE TYPE user_profile AS (user_id text)');
  await sql.unsafe(`
    CREATE TABLE identity_subject_mapping (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      miaoda_user_id varchar(255) NOT NULL,
      miaoda_tenant_id varchar(128) NOT NULL,
      expected_client_id varchar(128) NOT NULL,
      status varchar(32) NOT NULL
    )
  `);
  await sql.unsafe(`
    CREATE TABLE work_item (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      work_item_id varchar(96) NOT NULL UNIQUE,
      tenant_id varchar(128) NOT NULL,
      action_type varchar(64) NOT NULL,
      document_id varchar(96) NOT NULL,
      document_version_id varchar(96) NOT NULL,
      source_artifact_id varchar(96) NOT NULL,
      source_file_sha256 varchar(64) NOT NULL,
      source_byte_length bigint NOT NULL,
      normalized_family varchar(64) NOT NULL,
      request_id varchar(96) NOT NULL,
      status varchar(64) NOT NULL,
      revision integer NOT NULL,
      projection_json text,
      package_id text,
      package_artifact_ref text,
      package_artifact_sha256 varchar(64),
      failure_code varchar(160),
      failure_artifact_ref text,
      failure_artifact_sha256 varchar(64),
      requested_by_user_id varchar(255) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      run_key varchar(96) NOT NULL DEFAULT 'canonical',
      _created_by user_profile,
      _updated_by user_profile,
      CONSTRAINT uk_work_item_tenant_parse
        UNIQUE (tenant_id, action_type, document_version_id, run_key)
    )
  `);
  await applyMigration(
    sql,
    'migrations/0001_document_management_hosted_catalog.sql',
  );
  await applyMigration(sql, 'migrations/0014_engineering_matter_catalog.sql');
  await sql.unsafe('ALTER TABLE work_item ENABLE ROW LEVEL SECURITY');
  await sql.unsafe(`
    CREATE POLICY work_item_owner ON work_item TO authenticated
    USING (
      requested_by_user_id = current_setting('app.user_id', true)
      AND tenant_id = 'tenant-A'
    )
  `);
  await sql.unsafe('GRANT USAGE ON SCHEMA public TO authenticated');
  await sql.unsafe('GRANT SELECT ON identity_subject_mapping TO authenticated');
  await sql.unsafe('GRANT SELECT ON work_item TO authenticated');
  await sql.unsafe(`
    GRANT SELECT ON dm_source_artifact, dm_acquisition,
      dm_publication_family, dm_document_version, dm_ingress_preflight,
      dm_currentness_decision
    TO authenticated
  `);
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE
    ON engineering_matter, engineering_matter_revision,
      engineering_matter_revision_work_item
    TO authenticated
  `);
}

async function applyMigration(sql, path) {
  const migration = await readFile(resolve(process.cwd(), path), 'utf8');
  const reserved = await sql.reserve();
  try {
    await reserved.unsafe(migration);
  } finally {
    reserved.release();
  }
}

async function seedRealDocumentWorkItems(sql, fixtures) {
  await sql`
    INSERT INTO identity_subject_mapping (
      miaoda_user_id, miaoda_tenant_id, expected_client_id, status
    ) VALUES
      ('actor-A', 'tenant-A', 'cli_aadde8b579f95bc9', 'ACTIVE'),
      ('actor-B', 'tenant-A', 'cli_aadde8b579f95bc9', 'ACTIVE'),
      ('actor-C', 'tenant-B', 'cli_aadde8b579f95bc9', 'ACTIVE')
  `;
  await seedDocument(sql, {
    fixture: fixtures.ftd,
    familyId: 'family_real_ftd_31_21002',
    documentFamily: 'FTD',
    documentCode: '777-FTD-31-21002',
    businessRevision: '2025-09-26',
    revisionDate: '2025-09-26',
    actor: 'actor-A',
    workItemRevision: 4,
  });
  await seedDocument(sql, {
    fixture: fixtures.sb,
    familyId: 'family_58068371edd11c2b3c8aecf0',
    documentFamily: 'SB',
    documentCode: '737-34-3830',
    businessRevision: 'Original Issue',
    revisionDate: '2026-05-13',
    actor: 'actor-A',
    workItemRevision: 6,
  });
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, request_id, status, revision,
      projection_json, package_id, requested_by_user_id, run_key
    )
    SELECT
      ${REQUEST_REUSE_WORK_ITEM_ID}, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, 'REQ-FTD-REAL-RERUN', status,
      revision,
      jsonb_set(
        projection_json::jsonb,
        '{workItemId}',
        to_jsonb(${REQUEST_REUSE_WORK_ITEM_ID}::text)
      )::text,
      package_id, requested_by_user_id, 'matter-request-regression'
    FROM work_item
    WHERE work_item_id = ${FTD_WORK_ITEM_ID}
  `;
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, request_id, status, revision,
      requested_by_user_id
    ) VALUES (
      'WI-OTHER-ACTOR', 'tenant-A', 'PARSE_PDF', 'document_other_actor',
      'document_version_other_actor', 'source_other_actor',
      repeat('c', 64), 1, 'SB', 'REQ-OTHER-ACTOR', 'reserved', 0, 'actor-B'
    )
  `;
}

async function seedDocument(sql, input) {
  const rawSha = input.fixture.sourceFileSha256.replace(/^sha256:/u, '');
  const acquisitionId = `acquisition_${input.documentFamily.toLowerCase()}`;
  const preflightId = `preflight_${input.documentFamily.toLowerCase()}`;
  await sql`
    INSERT INTO dm_source_artifact (
      source_artifact_id, sha256, byte_length, media_type, bucket_id,
      file_path, provider_object_id, provider_version_id,
      readback_verified, created_at
    ) VALUES (
      ${input.fixture.sourceArtifactId}, ${rawSha},
      ${input.fixture.sourceByteLength}, 'application/pdf',
      'repository-real-fixtures', ${input.fixture.workItemId},
      ${input.fixture.workItemId}, 'accepted-real-fixture', TRUE, NOW()
    )
  `;
  await sql`
    INSERT INTO dm_acquisition (
      acquisition_id, source_artifact_id, document_version_id,
      source_channel, source_ref, selection_bucket_id, selection_file_path,
      provider_object_id, provider_version_id, acquired_by, acquired_at,
      idempotency_key, source_descriptor_json, status
    ) VALUES (
      ${acquisitionId}, ${input.fixture.sourceArtifactId},
      ${input.fixture.documentVersionId}, 'repository_real_fixture',
      ${input.fixture.workItemId}, 'repository-real-fixtures',
      ${input.fixture.workItemId}, ${input.fixture.workItemId},
      'accepted-real-fixture', ${input.actor}, NOW(),
      ${`IDEMP-${input.documentFamily}`}, '{}', 'COMMITTED'
    )
  `;
  await sql`
    INSERT INTO dm_publication_family (
      family_id, canonical_identity_key, document_family, issuer_authority,
      canonical_document_number, current_document_version_id,
      current_generation, status, created_at, updated_at
    ) VALUES (
      ${input.familyId}, ${`BOEING:${input.documentCode}`},
      ${input.documentFamily}, 'BOEING', ${input.documentCode},
      ${input.fixture.documentVersionId}, 1, 'ACTIVE', NOW(), NOW()
    )
  `;
  await sql`
    INSERT INTO dm_document_version (
      document_version_id, document_id, family_id, revision_id,
      canonical_revision_identity, business_revision, revision_date,
      source_generated_date, original_filename, source_artifact_id,
      acquisition_id, pdf_sha256, byte_length, media_type,
      lifecycle_status, committed_at, committed_by
    ) VALUES (
      ${input.fixture.documentVersionId}, ${input.fixture.documentId},
      ${input.familyId}, ${`revision_${input.documentFamily.toLowerCase()}`},
      ${`DATE:${input.revisionDate}`}, ${input.businessRevision},
      ${input.revisionDate}, ${input.revisionDate},
      ${`${input.documentCode}.pdf`}, ${input.fixture.sourceArtifactId},
      ${acquisitionId}, ${rawSha}, ${input.fixture.sourceByteLength},
      'application/pdf', 'COMMITTED_IMMUTABLE', NOW(), ${input.actor}
    )
  `;
  await sql`
    INSERT INTO dm_ingress_preflight (
      preflight_id, acquisition_id, decision, branch,
      execution_authorized, observed_current_generation,
      normalized_descriptor_json, decision_payload_json, status,
      document_version_id, commit_idempotency_key, created_at, committed_at
    ) VALUES (
      ${preflightId}, ${acquisitionId}, 'CREATE_FIRST_VERSION', 'CREATE',
      FALSE, 0, '{}', '{}', 'COMMITTED',
      ${input.fixture.documentVersionId},
      ${`COMMIT-${input.documentFamily}`}, NOW(), NOW()
    )
  `;
  await sql`
    INSERT INTO dm_currentness_decision (
      currentness_decision_id, family_id, next_document_version_id,
      previous_generation, next_generation, reason, decided_at,
      decided_by, preflight_id
    ) VALUES (
      ${`currentness_${input.documentFamily.toLowerCase()}`},
      ${input.familyId}, ${input.fixture.documentVersionId}, 0, 1,
      'INITIAL_VERSION', NOW(), ${input.actor}, ${preflightId}
    )
  `;
  const projection = {
    workItemId: input.fixture.workItemId,
    revision: input.workItemRevision,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: {
      documentId: input.fixture.documentId,
      documentVersionId: input.fixture.documentVersionId,
    },
    package: {
      packageId: input.fixture.packageId,
      sourceRefCount: input.fixture.sourceRefCount,
    },
  };
  await sql`
    INSERT INTO work_item (
      work_item_id, tenant_id, action_type, document_id,
      document_version_id, source_artifact_id, source_file_sha256,
      source_byte_length, normalized_family, request_id, status, revision,
      projection_json, package_id, requested_by_user_id
    ) VALUES (
      ${input.fixture.workItemId}, 'tenant-A', 'PARSE_PDF',
      ${input.fixture.documentId}, ${input.fixture.documentVersionId},
      ${input.fixture.sourceArtifactId}, ${rawSha},
      ${input.fixture.sourceByteLength}, ${input.documentFamily},
      ${`REQ-${input.documentFamily}-REAL`}, 'candidate_readback_verified',
      ${input.workItemRevision}, ${JSON.stringify(projection)},
      ${input.fixture.packageId}, ${input.actor}
    )
  `;
}

async function reserveActorService(actorId, tenantId = 'tenant-A') {
  const connection = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await connection.unsafe('SET ROLE authenticated');
    await connection`SELECT set_config('app.user_id', ${actorId}, false)`;
    const db = drizzle(connection);
    const workItems = new MiaodaWorkItemRepository(db);
    const objectAccess = new MiaodaHostedCanonicalObjectAccessAdapter(
      workItems,
    );
    const service = new EngineeringMatterService(
      new EngineeringMatterRepository(db),
      workItems,
      new MiaodaDocumentVersionSourceResolver(db),
      objectAccess,
    );
    return {
      service,
      actor: actor(actorId, tenantId),
      async release() {
        await connection.unsafe('RESET ROLE');
        await connection.end({ timeout: 5 });
      },
    };
  } catch (error) {
    await connection.unsafe('RESET ROLE');
    await connection.end({ timeout: 5 });
    throw error;
  }
}

function actor(userId, tenantId = 'tenant-A') {
  const objectAccessActor = {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id: userId },
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId,
      version: 'miaoda-hosted-native-sso.v1',
      decidedAt: '2026-08-30T00:00:00.000Z',
    },
    tenantId,
    applicationScopeId: 'app_17bzc551rsg',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'runtime',
    platformRoles: [],
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
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
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'runtime',
    objectAccessActor,
  };
}

async function assertLinkReplayMismatchAndCasConflict(owner, matterId) {
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId: 'REQ-MATTER-LINK-REAL-SB-1',
        expectedMatterRevision: 1,
        workItemId: SB_WORK_ITEM_ID,
        changeSummary: 'Same request id but different summary.',
      },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
  );
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId: 'REQ-MATTER-STALE-CAS',
        expectedMatterRevision: 1,
        workItemId: REQUEST_REUSE_WORK_ITEM_ID,
      },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_CAS_CONFLICT',
  );
}

async function assertAlreadyLinkedRequestReuse(sql, owner, matterId) {
  const requestId = 'REQ-MATTER-ALREADY-LINKED-THEN-NEW';
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId,
        expectedMatterRevision: 2,
        workItemId: SB_WORK_ITEM_ID,
      },
      owner.actor,
    ),
    (error) =>
      error?.code === 'ENGINEERING_MATTER_WORK_ITEM_ALREADY_LINKED' &&
      error?.statusCode === 409,
  );
  const [failedReadback] = await sql`
    SELECT
      matter.current_revision_no,
      count(revision.matter_revision_id)::int AS request_revision_count
    FROM engineering_matter AS matter
    LEFT JOIN engineering_matter_revision AS revision
      ON revision.matter_id = matter.matter_id
      AND revision.request_id = ${requestId}
    WHERE matter.matter_id = ${matterId}
    GROUP BY matter.current_revision_no
  `;
  assert.deepEqual(failedReadback, {
    current_revision_no: 2,
    request_revision_count: 0,
  });

  const input = {
    requestId,
    expectedMatterRevision: 2,
    workItemId: REQUEST_REUSE_WORK_ITEM_ID,
    changeSummary: 'Link the request-id regression WorkItem.',
  };
  const linked = await owner.service.linkWorkItem(matterId, input, owner.actor);
  assert.equal(linked.linked, true);
  assert.equal(linked.replayed, false);
  assert.equal(linked.matter.currentRevision.revisionNo, 3);

  const replayed = await owner.service.linkWorkItem(
    matterId,
    input,
    owner.actor,
  );
  assert.equal(replayed.linked, false);
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.matter.currentRevision.revisionNo, 3);

  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      { ...input, changeSummary: 'Changed after successful request.' },
      owner.actor,
    ),
    (error) => error?.code === 'ENGINEERING_MATTER_REQUEST_REPLAY_MISMATCH',
  );
  const [successfulReadback] = await sql`
    SELECT revision_no, changed_work_item_id, change_summary
    FROM engineering_matter_revision
    WHERE matter_id = ${matterId} AND request_id = ${requestId}
  `;
  assert.deepEqual(successfulReadback, {
    revision_no: 3,
    changed_work_item_id: REQUEST_REUSE_WORK_ITEM_ID,
    change_summary: input.changeSummary,
  });
}

async function advanceOwnerWorkItemCurrent(sql) {
  await sql`
    UPDATE work_item
    SET revision = 5,
        projection_json = jsonb_set(
          projection_json::jsonb,
          '{revision}',
          '5'::jsonb
        )::text
    WHERE work_item_id = ${FTD_WORK_ITEM_ID}
  `;
}

async function assertUnauthorizedLinkRollsBack(sql, owner, matterId) {
  await assert.rejects(
    owner.service.linkWorkItem(
      matterId,
      {
        requestId: 'REQ-MATTER-UNAUTHORIZED-LINK',
        expectedMatterRevision: 2,
        workItemId: 'WI-OTHER-ACTOR',
      },
      owner.actor,
    ),
    (error) => error?.code === 'CANONICAL_WORK_ITEM_NOT_FOUND',
  );
  const [readback] = await sql`
    SELECT
      current_revision_no,
      (SELECT count(*)::int FROM engineering_matter_revision
        WHERE matter_id = ${matterId}) AS revision_count
    FROM engineering_matter WHERE matter_id = ${matterId}
  `;
  assert.deepEqual(readback, { current_revision_no: 2, revision_count: 2 });
}

async function assertSecurityDefinerAndDirectRlsDenials(sql, matterId) {
  const functions = await sql`
    SELECT
      procedure.proname,
      procedure.prosecdef,
      pg_get_userbyid(procedure.proowner) AS function_owner,
      pg_get_userbyid(relation.relowner) AS table_owner,
      procedure.prorettype = 'boolean'::regtype AS returns_boolean,
      procedure.proconfig,
      coalesce(procedure.proacl::text, '') AS acl
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    JOIN pg_class AS relation
      ON relation.relname = 'engineering_matter'
      AND relation.relnamespace = namespace.oid
    WHERE namespace.nspname = 'public'
      AND (
        procedure.proname LIKE 'engineering_matter_%_by_actor'
        OR procedure.proname = 'engineering_matter_actor_has_tenant'
      )
    ORDER BY procedure.proname
  `;
  assert.equal(functions.length, 5);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, true, fn.proname);
    assert.equal(fn.returns_boolean, true, fn.proname);
    assert.equal(fn.function_owner, fn.table_owner, fn.proname);
    assert.deepEqual(fn.proconfig, ['search_path=pg_catalog, public']);
    assert.equal(/(?:^\{|,)=X\//u.test(fn.acl), false, fn.proname);
    assert.equal(fn.acl.includes('authenticated=X/'), true, fn.proname);
  }

  const [current] = await sql`
    SELECT current_matter_revision_id
    FROM engineering_matter WHERE matter_id = ${matterId}
  `;
  await asActorSql('actor-A', async (actorSql) => {
    const [denials] = await actorSql`
      SELECT
        engineering_matter_actor_has_tenant('tenant-B') AS cross_tenant,
        engineering_matter_work_item_owned_by_actor(
          'tenant-A', 'WI-OTHER-ACTOR'
        ) AS third_work_item
    `;
    assert.deepEqual(denials, {
      cross_tenant: false,
      third_work_item: false,
    });
    await assert.rejects(
      actorSql`
        INSERT INTO engineering_matter_revision_work_item (
          matter_revision_id, matter_id, tenant_id, work_item_id,
          ordinal, relation_role, linked_at_work_item_revision
        ) VALUES (
          ${current.current_matter_revision_id}, ${matterId}, 'tenant-A',
          'WI-OTHER-ACTOR', 99, 'RELATED', 0
        )
      `,
      (error) => databaseCode(error) === '42501',
    );
  });

  await asActorSql('actor-B', async (actorSql) => {
    const [denials] = await actorSql`
      SELECT
        engineering_matter_owned_by_actor(
          'tenant-A', ${matterId}
        ) AS matter_owner,
        engineering_matter_work_item_owned_by_actor(
          'tenant-A', ${FTD_WORK_ITEM_ID}
        ) AS primary_work_item,
        engineering_matter_all_links_owned_by_actor(
          'tenant-A', ${current.current_matter_revision_id}
        ) AS all_links,
        (SELECT count(*)::int FROM engineering_matter) AS visible_matters
    `;
    assert.deepEqual(denials, {
      matter_owner: false,
      primary_work_item: false,
      all_links: false,
      visible_matters: 0,
    });
  });

  await asActorSql('actor-C', async (actorSql) => {
    const [denials] = await actorSql`
      SELECT
        engineering_matter_actor_has_tenant('tenant-A') AS tenant_a,
        engineering_matter_actor_has_tenant('tenant-B') AS tenant_b
    `;
    assert.deepEqual(denials, { tenant_a: false, tenant_b: true });
  });
}

async function asActorSql(actorId, action) {
  const actorSql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    await actorSql.unsafe('SET ROLE authenticated');
    await actorSql`SELECT set_config('app.user_id', ${actorId}, false)`;
    return await action(actorSql);
  } finally {
    await actorSql.unsafe('RESET ROLE');
    await actorSql.end({ timeout: 5 });
  }
}

function databaseCode(error) {
  return String(error?.code ?? error?.cause?.code ?? '');
}

function assertBrowserSafe(readModel) {
  assert.equal(
    readModel.schemaVersion,
    'wiselink.3_1.engineering_matter_catalog.v1',
  );
  assert.deepEqual(readModel.authorization, {
    policy: 'ALL_LINKED_WORK_ITEMS_REQUIRED',
    authorizedWorkItemCount: 2,
  });
  assert.deepEqual(readModel.authority, {
    workItemCurrentRemainsAuthoritative: true,
    documentManagementRemainsAuthoritative: true,
    sourceRefsRemainWorkItemScoped: true,
    matterCreatesAssessmentCurrent: false,
  });
  const serialized = JSON.stringify(readModel);
  for (const forbidden of [
    'tenant-A',
    'actor-A',
    'tenantId',
    'actorUserId',
    'packageId',
    'artifactRef',
    'artifactSha256',
    'sourceArtifactId',
    'sourceFileSha256',
    'packageArtifactSha256',
    'bucketId',
    'filePath',
    'permissionSnapshotVersion',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(/sha256:[0-9a-f]{64}/u.test(serialized), false, 'sha256');
}

async function assertMatterHistory(sql) {
  const revisions = await sql`
    SELECT revision_no, change_kind, changed_work_item_id
    FROM engineering_matter_revision ORDER BY revision_no
  `;
  assert.deepEqual(
    [...revisions],
    [
      {
        revision_no: 1,
        change_kind: 'CREATED',
        changed_work_item_id: FTD_WORK_ITEM_ID,
      },
      {
        revision_no: 2,
        change_kind: 'WORK_ITEM_LINKED',
        changed_work_item_id: SB_WORK_ITEM_ID,
      },
      {
        revision_no: 3,
        change_kind: 'WORK_ITEM_LINKED',
        changed_work_item_id: REQUEST_REUSE_WORK_ITEM_ID,
      },
    ],
  );
  const snapshots = await sql`
    SELECT revision_no, count(*)::int AS linked_work_item_count
    FROM engineering_matter_revision AS revision
    JOIN engineering_matter_revision_work_item AS link
      ON link.matter_revision_id = revision.matter_revision_id
    GROUP BY revision_no ORDER BY revision_no
  `;
  assert.deepEqual(
    [...snapshots],
    [
      { revision_no: 1, linked_work_item_count: 1 },
      { revision_no: 2, linked_work_item_count: 2 },
      { revision_no: 3, linked_work_item_count: 3 },
    ],
  );
}
