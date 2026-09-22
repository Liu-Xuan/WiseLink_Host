import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import postgres from 'postgres';

process.env.TS_NODE_PROJECT = resolve('tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  EngineeringMatterDirectoryService,
} = require('../../server/modules/canonical-host/engineering-matter-directory.service.ts');

const databaseUrl = process.env.ENGINEERING_MATTER_DIRECTORY_TEST_DATABASE_URL;

test(
  'engineering matter directory narrow read executes with isolated RLS and actor scope',
  { skip: !databaseUrl, timeout: 120000, concurrency: false },
  async () => {
    assertSafeIsolatedDatabase(databaseUrl);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const schema = `directory_fixture_${suffix}`;
    const role = `directory_reader_${suffix}`;
    const clients = [];
    const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    clients.push(admin);
    try {
      await createFixtureSchema(admin, schema, role);
      await admin.unsafe(`SET search_path TO "${schema}", public`);
      await seedFunctionalMatters(admin);
      await admin.unsafe('VACUUM (ANALYZE)');

      const alphaA = await actorHarness(
        databaseUrl,
        role,
        schema,
        'actor-alpha',
        'tenant-A',
      );
      const betaA = await actorHarness(
        databaseUrl,
        role,
        schema,
        'actor-beta',
        'tenant-A',
      );
      const alphaB = await actorHarness(
        databaseUrl,
        role,
        schema,
        'actor-alpha',
        'tenant-B',
      );
      clients.push(alphaA.client, betaA.client, alphaB.client);

      await assertNonBypassActor(alphaA.client, role);

      const smallStarted = performance.now();
      const alphaPage = await alphaA.service.list({ limit: 50 }, alphaA.actor);
      const smallNormalMs = performance.now() - smallStarted;
      const smallStatements = [...alphaA.statements];
      alphaA.statements.length = 0;
      const smallPlans = await explainStatements(
        alphaA.client,
        smallStatements,
      );
      const emptyPage = await alphaA.service.list(
        { search: 'NO_MATCH_DIRECTORY' },
        alphaA.actor,
      );
      assert.deepEqual(emptyPage.items, []);
      assert.equal(alphaA.statements.length, 1);
      alphaA.statements.length = 0;
      assert.deepEqual(alphaPage.items.map((item) => item.matterId).sort(), [
        'MAT-A1',
        'MAT-A2',
        'MAT-A3',
      ]);
      assert.equal(smallStatements.length, 6);
      assert.deepEqual(
        alphaPage.items.find((item) => item.matterId === 'MAT-A1')?.result
          ?.decisiveClaims,
        [
          { claimId: 'C1', text: 'Claim one' },
          { claimId: 'C3', text: 'Claim three' },
        ],
      );
      assert.equal(
        alphaPage.items.find((item) => item.matterId === 'MAT-A1')
          ?.overallStatus,
        'STALE',
      );
      assert.equal(
        alphaPage.items.find((item) => item.matterId === 'MAT-A1')
          ?.workingRevision,
        3,
      );

      const searched = await alphaA.service.list(
        { search: 'MAT-A3' },
        alphaA.actor,
      );
      assert.deepEqual(
        searched.items.map((item) => item.matterId),
        ['MAT-A3'],
      );
      const workItemFiltered = await alphaA.service.list(
        { workItemId: 'WI-A3-B' },
        alphaA.actor,
      );
      assert.deepEqual(
        workItemFiltered.items.map((item) => item.matterId),
        ['MAT-A3'],
      );
      const firstPage = await alphaA.service.list({ limit: 2 }, alphaA.actor);
      const secondPage = await alphaA.service.list(
        { limit: 2, cursor: firstPage.nextCursor },
        alphaA.actor,
      );
      assert.deepEqual(
        firstPage.items.map((item) => item.matterId),
        ['MAT-A3', 'MAT-A2'],
      );
      assert.deepEqual(
        secondPage.items.map((item) => item.matterId),
        ['MAT-A1'],
      );
      assert.equal(secondPage.nextCursor, null);

      const betaPage = await betaA.service.list({ limit: 50 }, betaA.actor);
      assert.deepEqual(betaPage.items.map((item) => item.matterId).sort(), [
        'MAT-A-BETA',
        'MAT-A2',
      ]);
      const otherTenantPage = await alphaB.service.list(
        { limit: 50 },
        alphaB.actor,
      );
      assert.deepEqual(
        otherTenantPage.items.map((item) => item.matterId),
        ['MAT-B-ALPHA'],
      );

      await assertControlledConcurrency(alphaA, admin, 'MAT-A1');

      const scaleMatterCount = 80;
      await seedScaleMatters(admin, scaleMatterCount);
      await admin.unsafe('VACUUM (ANALYZE)');
      const scaleActor = await actorHarness(
        databaseUrl,
        role,
        schema,
        'actor-scale',
        'tenant-SCALE',
      );
      clients.push(scaleActor.client);
      const scaleStarted = performance.now();
      const scalePage = await scaleActor.service.list(
        { limit: 20 },
        scaleActor.actor,
      );
      const scaleNormalMs = performance.now() - scaleStarted;
      const scaleStatements = [...scaleActor.statements];
      assert.equal(scalePage.items.length, 20);
      assert.equal(scaleStatements.length, 6);

      const scalePlans = await explainStatements(
        scaleActor.client,
        scaleStatements,
      );
      process.stdout.write(
        `${JSON.stringify(
          {
            kind: 'DIRECTORY_SQL_EVIDENCE',
            role,
            schema,
            small: {
              matterCount: 3,
              normalCallMs: round(smallNormalMs),
              queryCount: smallStatements.length,
              queries: smallStatements.map((statement) => statement.query),
              plans: smallPlans,
            },
            scale: {
              matterCount: scaleMatterCount,
              pageSize: 20,
              normalCallMs: round(scaleNormalMs),
              queryCount: scaleStatements.length,
              plans: scalePlans,
            },
            limitation:
              'Local synthetic RLS reproduces tenant/actor and WorkItem ownership, not the full Miaoda gateway identity/provenance chain.',
          },
          null,
          2,
        )}\n`,
      );
    } finally {
      for (const client of clients.reverse()) {
        try {
          await client.unsafe('RESET ROLE');
        } catch {}
        await client.end({ timeout: 5 });
      }
      const cleanup = postgres(databaseUrl, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await cleanup.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      } finally {
        await cleanup.end({ timeout: 5 });
      }
    }
  },
);

async function createFixtureSchema(admin, schema, role) {
  await admin.unsafe(`
    CREATE SCHEMA "${schema}";
    CREATE TABLE "${schema}".engineering_matter (
      matter_id varchar(96) PRIMARY KEY,
      tenant_id varchar(128) NOT NULL,
      title text NOT NULL,
      status varchar(32) NOT NULL,
      current_revision_no integer NOT NULL,
      current_matter_revision_id varchar(96) NOT NULL,
      request_id varchar(96) NOT NULL,
      created_by_user_id varchar(255) NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      default_family_id varchar(96)
    );
    CREATE TABLE "${schema}".engineering_matter_revision (
      matter_revision_id varchar(96) PRIMARY KEY,
      matter_id varchar(96) NOT NULL,
      tenant_id varchar(128) NOT NULL,
      revision_no integer NOT NULL,
      request_id varchar(96) NOT NULL,
      change_kind varchar(32) NOT NULL,
      change_summary text NOT NULL,
      created_by_user_id varchar(255) NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE "${schema}".engineering_matter_revision_work_item (
      id uuid PRIMARY KEY,
      matter_revision_id varchar(96) NOT NULL,
      matter_id varchar(96) NOT NULL,
      tenant_id varchar(128) NOT NULL,
      work_item_id varchar(96) NOT NULL,
      ordinal integer NOT NULL,
      relation_role varchar(32) NOT NULL,
      linked_at_work_item_revision integer NOT NULL
    );
    CREATE TABLE "${schema}".engineering_matter_material_link (
      id uuid PRIMARY KEY,
      tenant_id varchar(128) NOT NULL,
      matter_id varchar(96) NOT NULL,
      matter_revision_id varchar(96) NOT NULL,
      material_id varchar(96) NOT NULL,
      kind varchar(32) NOT NULL,
      family_id varchar(96),
      document_version_id varchar(96),
      material_json text NOT NULL,
      created_by_user_id varchar(255) NOT NULL
    );
    CREATE TABLE "${schema}".engineering_matter_work_revision (
      matter_work_revision_id varchar(96) PRIMARY KEY,
      tenant_id varchar(128) NOT NULL,
      matter_id varchar(96) NOT NULL,
      working_revision integer NOT NULL,
      request_id varchar(96) NOT NULL,
      based_on_matter_revision_id varchar(96) NOT NULL,
      update_kind varchar(32) NOT NULL,
      command_json text NOT NULL,
      state_json text NOT NULL,
      substantive_result_ref text,
      substantive_result_revision integer,
      change_summary text NOT NULL,
      action_attempt_id varchar(96),
      review_turn_id varchar(96),
      created_by_user_id varchar(255) NOT NULL,
      created_at timestamptz NOT NULL
    );
    CREATE TABLE "${schema}".work_item (
      work_item_id varchar(96) PRIMARY KEY,
      tenant_id varchar(128) NOT NULL,
      document_id varchar(96) NOT NULL,
      document_version_id varchar(96) NOT NULL,
      requested_by_user_id varchar(255) NOT NULL
    );
    CREATE TABLE "${schema}".dm_document_version (
      document_version_id varchar(96) PRIMARY KEY,
      document_id varchar(96) NOT NULL,
      family_id varchar(96) NOT NULL
    );
    CREATE TABLE "${schema}".dm_publication_family (
      family_id varchar(96) PRIMARY KEY
    );
    CREATE OR REPLACE FUNCTION "${schema}".directory_test_work_delay()
    RETURNS boolean LANGUAGE plpgsql AS $$
    BEGIN
      IF current_setting('app.directory_test_delay', true) = '1' THEN
        PERFORM pg_sleep(0.08);
      END IF;
      RETURN true;
    END;
    $$;
    ALTER TABLE "${schema}".engineering_matter ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".engineering_matter_revision_work_item ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".engineering_matter_material_link ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".engineering_matter_work_revision ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".work_item ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".dm_document_version ENABLE ROW LEVEL SECURITY;
    ALTER TABLE "${schema}".dm_publication_family ENABLE ROW LEVEL SECURITY;
    CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      INHERIT NOBYPASSRLS;
    CREATE POLICY engineering_matter_tenant ON "${schema}".engineering_matter
      FOR SELECT TO "${role}"
      USING (tenant_id = current_setting('app.tenant_id', true));
    CREATE POLICY engineering_matter_link_tenant ON "${schema}".engineering_matter_revision_work_item
      FOR SELECT TO "${role}"
      USING (tenant_id = current_setting('app.tenant_id', true));
    CREATE POLICY engineering_matter_material_tenant ON "${schema}".engineering_matter_material_link
      FOR SELECT TO "${role}"
      USING (tenant_id = current_setting('app.tenant_id', true));
    CREATE POLICY engineering_matter_working_tenant ON "${schema}".engineering_matter_work_revision
      FOR SELECT TO "${role}"
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND "${schema}".directory_test_work_delay()
      );
    CREATE POLICY work_item_owner ON "${schema}".work_item
      FOR SELECT TO "${role}"
      USING (
        tenant_id = current_setting('app.tenant_id', true)
        AND requested_by_user_id = current_setting('app.user_id', true)
      );
    CREATE POLICY document_version_read ON "${schema}".dm_document_version
      FOR SELECT TO "${role}" USING (true);
    CREATE POLICY publication_family_read ON "${schema}".dm_publication_family
      FOR SELECT TO "${role}" USING (true);
    GRANT USAGE ON SCHEMA "${schema}" TO "${role}";
    GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${role}";
    GRANT EXECUTE ON FUNCTION "${schema}".directory_test_work_delay() TO "${role}";
  `);
}

async function actorHarness(databaseUrl, role, schema, actorId, tenantId) {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await client.unsafe(`SET ROLE "${role}"`);
  await client.unsafe(`SET search_path TO "${schema}", public`);
  await client`SELECT
    set_config('app.user_id', ${actorId}, false),
    set_config('app.tenant_id', ${tenantId}, false),
    set_config('app.directory_test_delay', '0', false)`;
  const statements = [];
  const db = drizzle(client, {
    logger: {
      logQuery(query, params) {
        statements.push({ query, params });
      },
    },
  });
  const fullReader = {
    read() {
      throw new Error('FULL_MATTER_READ_CALLED');
    },
    readWorking() {
      throw new Error('FULL_WORKING_READ_CALLED');
    },
  };
  const service = new EngineeringMatterDirectoryService(
    db,
    fullReader,
    fullReader,
  );
  return {
    client,
    service,
    statements,
    actor: actorFixture(actorId, tenantId),
  };
}

async function assertNonBypassActor(client, expectedRole) {
  const [row] = await client`
    SELECT
      current_user AS role,
      current_setting('app.user_id', true) AS actor,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass
  `;
  assert.deepEqual(row, {
    role: expectedRole,
    actor: 'actor-alpha',
    bypass: false,
  });
}

async function seedFunctionalMatters(admin) {
  await seedMatter(admin, {
    matterId: 'MAT-A1',
    tenantId: 'tenant-A',
    actorId: 'actor-alpha',
    title: 'MAT-A1 old working basis',
    createdAt: '2026-09-01T00:00:00.000Z',
    links: [{ workItemId: 'WI-A1', role: 'PRIMARY' }],
    materials: [],
    historyCount: 3,
    stateBytes: 1024,
    oldBasis: true,
  });
  await seedMatter(admin, {
    matterId: 'MAT-A2',
    tenantId: 'tenant-A',
    actorId: 'actor-alpha',
    title: 'MAT-A2 material only',
    createdAt: '2026-09-02T00:00:00.000Z',
    links: [],
    materials: [material('MATERIAL-A2', 'FAM-MAT-A2')],
    historyCount: 1,
    stateBytes: 512,
    oldBasis: false,
  });
  await seedMatter(admin, {
    matterId: 'MAT-A3',
    tenantId: 'tenant-A',
    actorId: 'actor-alpha',
    title: 'MAT-A3 multi-material',
    createdAt: '2026-09-03T00:00:00.000Z',
    links: [
      { workItemId: 'WI-A3-A', role: 'PRIMARY' },
      { workItemId: 'WI-A3-B', role: 'RELATED' },
    ],
    materials: [material('MATERIAL-A3', 'FAM-MAT-A3')],
    historyCount: 2,
    stateBytes: 2048,
    oldBasis: false,
  });
  await seedMatter(admin, {
    matterId: 'MAT-A-BETA',
    tenantId: 'tenant-A',
    actorId: 'actor-beta',
    title: 'MAT-A beta owned',
    createdAt: '2026-09-04T00:00:00.000Z',
    links: [{ workItemId: 'WI-BETA', role: 'PRIMARY' }],
    materials: [],
    historyCount: 2,
    stateBytes: 4096,
    oldBasis: false,
  });
  await seedMatter(admin, {
    matterId: 'MAT-B-ALPHA',
    tenantId: 'tenant-B',
    actorId: 'actor-alpha',
    title: 'MAT-B other tenant',
    createdAt: '2026-09-05T00:00:00.000Z',
    links: [{ workItemId: 'WI-B', role: 'PRIMARY' }],
    materials: [],
    historyCount: 1,
    stateBytes: 1024,
    oldBasis: false,
  });
}

async function seedScaleMatters(admin, count) {
  for (let index = 1; index <= count; index += 1) {
    const matterId = `MAT-SCALE-${String(index).padStart(3, '0')}`;
    await seedMatter(admin, {
      matterId,
      tenantId: 'tenant-SCALE',
      actorId: 'actor-scale',
      title: `${matterId} scale`,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
      links: [{ workItemId: `WI-SCALE-${index}`, role: 'PRIMARY' }],
      materials:
        index % 7 === 0 ? [material(`MATERIAL-${index}`, `FAM-${index}`)] : [],
      historyCount: 1 + (index % 4),
      stateBytes: 4096 + (index % 3) * 16384,
      oldBasis: index % 5 === 0,
    });
  }
}

async function seedMatter(admin, input) {
  const oldRevisionId = `MREV-${input.matterId}-OLD`;
  const currentRevisionId = `MREV-${input.matterId}-CURRENT`;
  await admin`INSERT INTO engineering_matter (
    matter_id, tenant_id, title, status, current_revision_no,
    current_matter_revision_id, request_id, created_by_user_id,
    created_at, updated_at
  ) VALUES (
    ${input.matterId}, ${input.tenantId}, ${input.title}, 'ACTIVE', 2,
    ${currentRevisionId}, ${`REQ-${input.matterId}`}, ${input.actorId},
    ${input.createdAt}, ${input.createdAt}
  )`;
  await admin`INSERT INTO engineering_matter_revision (
    matter_revision_id, matter_id, tenant_id, revision_no, request_id,
    change_kind, change_summary, created_by_user_id, created_at
  ) VALUES
    (${oldRevisionId}, ${input.matterId}, ${input.tenantId}, 1,
      ${`REQ-${input.matterId}-OLD`}, 'CREATED', 'Synthetic old', ${input.actorId}, ${input.createdAt}),
    (${currentRevisionId}, ${input.matterId}, ${input.tenantId}, 2,
      ${`REQ-${input.matterId}-CURRENT`}, 'WORK_ITEM_LINKED', 'Synthetic current', ${input.actorId}, ${input.createdAt})`;
  for (const [index, link] of input.links.entries()) {
    const workItemId = link.workItemId;
    const documentId = `DOC-${workItemId}`;
    const documentVersionId = `DV-${workItemId}`;
    const familyId = `FAM-${workItemId}`;
    await admin`INSERT INTO dm_publication_family (family_id)
      VALUES (${familyId}) ON CONFLICT DO NOTHING`;
    await admin`INSERT INTO dm_document_version (
      document_version_id, document_id, family_id
    ) VALUES (${documentVersionId}, ${documentId}, ${familyId})`;
    await admin`INSERT INTO work_item (
      work_item_id, tenant_id, document_id, document_version_id,
      requested_by_user_id
    ) VALUES (${workItemId}, ${input.tenantId}, ${documentId},
      ${documentVersionId}, ${input.actorId})`;
    await admin`INSERT INTO engineering_matter_revision_work_item (
      id, matter_revision_id, matter_id, tenant_id, work_item_id,
      ordinal, relation_role, linked_at_work_item_revision
    ) VALUES (${randomUUID()}, ${currentRevisionId}, ${input.matterId},
      ${input.tenantId}, ${workItemId}, ${index + 1}, ${link.role}, 1)`;
  }
  for (const item of input.materials) {
    await admin`INSERT INTO engineering_matter_material_link (
      id, tenant_id, matter_id, matter_revision_id, material_id, kind,
      family_id, document_version_id, material_json, created_by_user_id
    ) VALUES (${randomUUID()}, ${input.tenantId}, ${input.matterId},
      ${currentRevisionId}, ${item.materialId}, ${item.kind},
      ${item.familyId}, ${item.documentVersionId},
      ${JSON.stringify(item)}, ${input.actorId})`;
  }
  for (let revision = 1; revision <= input.historyCount; revision += 1) {
    const latest = revision === input.historyCount;
    const basedOn =
      latest && input.oldBasis ? oldRevisionId : currentRevisionId;
    const state = workingState(input, revision, latest && input.oldBasis);
    await admin`INSERT INTO engineering_matter_work_revision (
      matter_work_revision_id, tenant_id, matter_id, working_revision,
      request_id, based_on_matter_revision_id, update_kind, command_json,
      state_json, substantive_result_ref, substantive_result_revision,
      change_summary, created_by_user_id, created_at
    ) VALUES (
      ${`MWREV-${input.matterId}-${revision}`}, ${input.tenantId},
      ${input.matterId}, ${revision}, ${`WORK-${input.matterId}-${revision}`},
      ${basedOn}, 'FULL_REPLACEMENT', '{}', ${JSON.stringify(state)},
      ${state.substantiveResult.resultRef}, ${revision},
      ${'Synthetic working revision'}, ${input.actorId},
      ${new Date(Date.parse(input.createdAt) + revision).toISOString()}
    )`;
  }
}

function workingState(input, revision, oldBasis) {
  const filler = 'x'.repeat(
    Math.max(
      256,
      Math.floor((input.stateBytes * revision) / input.historyCount),
    ),
  );
  return {
    schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
    focus: { headline: input.title, revision },
    substantiveResult: {
      resultRef: `RESULT-${input.matterId}`,
      resultRevision: revision,
      scope: { kind: 'ENGINEERING_MATTER', matterId: input.matterId },
      content: {
        schemaVersion: 'wiselink.3_1.assessment_reading.v1',
        headline: `Headline ${input.matterId}`,
        listBrief: `Brief ${input.matterId}`,
        lead: 'Synthetic lead',
        claims: [
          { claimId: 'C1', text: 'Claim one' },
          { claimId: 'C2', text: 'Claim two' },
          { claimId: 'C3', text: 'Claim three' },
        ],
        decisiveClaimIds: ['C3', 'C1'],
        issueArticles: [],
      },
      evidence: [],
      candidateOnly: true,
    },
    openQuestions: [],
    reviewConditions: [],
    substantiveInputs: [],
    coverage: [],
    problemWork: {
      understanding: `Synthetic overview ${input.matterId}`,
      overviewStatus: oldBasis ? 'STALE' : 'CURRENT',
      issues: [],
      evidence: [],
    },
    filler,
  };
}

function material(materialId, familyId) {
  return {
    materialId,
    kind: 'MEMBER',
    familyId,
    documentVersionId: `DV-${materialId}`,
    scope: 'Synthetic scope',
    contribution: 'Synthetic contribution',
    basis: [],
    origin: 'ENGINEER',
    disposition: 'INCLUDED',
  };
}

async function assertControlledConcurrency(alpha, admin, matterId) {
  await alpha.client`SELECT set_config('app.directory_test_delay', '1', false)`;
  const listPromise = alpha.service.list({ search: matterId }, alpha.actor);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await admin`UPDATE engineering_matter
    SET current_matter_revision_id = ${`${'MREV-'}${matterId}-CONCURRENT`}
    WHERE matter_id = ${matterId}`;
  await assert.rejects(
    listPromise,
    (error) => error?.code === 'ENGINEERING_MATTER_DIRECTORY_CHANGED',
  );
  await alpha.client`SELECT set_config('app.directory_test_delay', '0', false)`;
}

async function explainStatements(client, statements) {
  const plans = [];
  for (const statement of statements) {
    const started = performance.now();
    const rows = await client.unsafe(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.query}`,
      statement.params,
    );
    const elapsedMs = performance.now() - started;
    const raw = rows[0]['QUERY PLAN'];
    const root = Array.isArray(raw) ? raw[0] : JSON.parse(raw)[0];
    plans.push({
      elapsedMs: round(elapsedMs),
      planningMs: round(root['Planning Time']),
      executionMs: round(root['Execution Time']),
      plan: summarizePlan(root.Plan),
    });
  }
  return plans;
}

function summarizePlan(plan) {
  const nodes = [];
  const visit = (node) => {
    nodes.push({
      nodeType: node['Node Type'],
      relation: node['Relation Name'] ?? null,
      actualRows: node['Actual Rows'] ?? null,
      actualTotalMs: round(node['Actual Total Time']),
      sharedHitBlocks: node['Shared Hit Blocks'] ?? 0,
      sharedReadBlocks: node['Shared Read Blocks'] ?? 0,
      tempReadBlocks: node['Temp Read Blocks'] ?? 0,
      tempWrittenBlocks: node['Temp Written Blocks'] ?? 0,
    });
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(plan);
  return nodes;
}

function actorFixture(actorId, tenantId) {
  return {
    userId: actorId,
    tenantId,
    appId: 'app_17bzc551rsg',
    roles: [],
    env: 'preview',
    objectAccessActor: {
      principalKind: 'FINAL_USER',
      transport: 'MIAODA_AUTHENTICATED_HTTP',
      canonicalSubject: { namespace: 'MIAODA_USER_ID', id: actorId },
      subjectDecision: {
        source: 'MIAODA_GATEWAY_USER_CONTEXT',
        applicationScopeId: 'app_17bzc551rsg',
        tenantId,
        version: 'miaoda-hosted-native-sso.v1',
        decidedAt: '2026-09-22T00:00:00.000Z',
      },
      tenantId,
      applicationScopeId: 'app_17bzc551rsg',
      applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
      workspaceId: null,
      workspaceProvenance: 'UNAVAILABLE',
      env: 'preview',
      platformRoles: [],
      identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
      feishuUserId: null,
      feishuOpenId: null,
      feishuIdentityProvenance: 'UNAVAILABLE',
      sessionId: null,
      sessionRevision: null,
      sessionProvenance: 'UNAVAILABLE',
    },
  };
}

function assertSafeIsolatedDatabase(value) {
  const parsed = new URL(value);
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(parsed.hostname),
    `unsafe database host: ${parsed.hostname}`,
  );
  assert.match(parsed.pathname, /directory/u);
  assert.notEqual(parsed.port, '5432');
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
