// Q1-only fixture. Reuses the baseline test's migration/RLS setup, not its test execution.
// Caller must first validate a dedicated loopback test database; reset drops public there.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getTableConfig } = require('drizzle-orm/pg-core');
const {
  workItem,
  actionAttempt,
} = require('../../../server/database/schema.ts');
const hash = 'a'.repeat(64);
const sourceBindings = [{ artifactRef: 'artifact://test/source' }];

export async function resetQ1Database(sql) {
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated_wiselink_jobaid_test') THEN CREATE ROLE authenticated_wiselink_jobaid_test NOLOGIN IN ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role_wiselink_jobaid_test') THEN CREATE ROLE service_role_wiselink_jobaid_test NOLOGIN IN ROLE service_role; END IF; END $$;
    CREATE TYPE user_profile AS (user_id text);
    CREATE TABLE identity_subject_mapping (id uuid DEFAULT gen_random_uuid(), miaoda_user_id text, miaoda_tenant_id text, expected_client_id text, status text);`);
  for (const [name, table, constraints] of [
    [
      'work_item',
      workItem,
      'UNIQUE(work_item_id), UNIQUE(tenant_id,work_item_id)',
    ],
    [
      'action_attempt',
      actionAttempt,
      'UNIQUE(attempt_id), UNIQUE(operation_ref)',
    ],
  ]) {
    const columns = getTableConfig(table).columns.map(
      (column) =>
        `"${column.name.replaceAll('"', '""')}" ${column.getSQLType()}`,
    );
    await sql.unsafe(
      `CREATE TABLE ${name} (${columns.join(',')}, ${constraints})`,
    );
  }
  await sql.unsafe(`CREATE UNIQUE INDEX uk_action_attempt_active_work_task ON action_attempt(work_item_id, action_type)
    WHERE status IN ('QUEUED', 'RUNNING', 'RETRY_SCHEDULED', 'COMMITTING')`);
  await sql.unsafe(`ALTER TABLE action_attempt
    ALTER COLUMN claim_count SET DEFAULT 0,
    ALTER COLUMN retry_count SET DEFAULT 0,
    ALTER COLUMN lease_generation SET DEFAULT 0,
    ALTER COLUMN projection_applied SET DEFAULT false;
    ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY;`);
  // Match the existing platform ALL policies on these two tables. Source/work
  // history and identity tables retain their actual actor-bound RLS below.
  for (const name of ['work_item', 'action_attempt']) {
    await sql.unsafe(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${name}_authenticated ON ${name}
        FOR ALL TO authenticated_wiselink_jobaid_test USING (true);
      CREATE POLICY ${name}_service ON ${name}
        FOR ALL TO service_role_wiselink_jobaid_test USING (true);`);
  }
  const migration = await sql.reserve();
  try {
    for (const name of [
      '0009_review_conversation_persistence_c1.sql',
      '0010_interactive_review_host_mcp_c2.sql',
      '0018_interactive_review_openclaw_candidate_update.sql',
      '0019_interactive_review_hosted_runtime_select.sql',
      '0021_interactive_review_hosted_runtime_candidate_update.sql',
    ]) {
      await migration.unsafe(
        await readFile(
          new URL(`../../../migrations/${name}`, import.meta.url),
          'utf8',
        ),
      );
    }
    const identityRls = await readFile(
      new URL(
        '../../../migrations/0005_identity_oauth_authenticated_rls.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const authenticatedIdentityPolicy = identityRls.match(
      /CREATE POLICY identity_subject_mapping_authenticated_oauth_read[\s\S]+?\n  \);/u,
    );
    assert.ok(authenticatedIdentityPolicy);
    await migration.unsafe(authenticatedIdentityPolicy[0]);
    await migration.unsafe(
      'ALTER TABLE review_turn ADD COLUMN review_scope_json jsonb',
    );
    const catalog = await readFile(
      new URL(
        '../../../migrations/0014_engineering_matter_catalog.sql',
        import.meta.url,
      ),
      'utf8',
    );
    for (const name of [
      'engineering_matter_actor_has_tenant',
      'engineering_matter_work_item_owned_by_actor',
    ]) {
      const match = catalog.match(
        new RegExp(
          `CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]+?\\$\\$;`,
          'u',
        ),
      );
      assert.ok(match);
      await migration.unsafe(match[0]);
    }
    await migration.unsafe(
      await readFile(
        new URL(
          '../../../migrations/0026_assessment_work_revision.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    await migration.unsafe(`CREATE TABLE dm_document_version(document_version_id varchar(96) PRIMARY KEY, family_id varchar, source_artifact_id varchar);
      CREATE TABLE dm_publication_family(family_id varchar, canonical_identity_key text);
      CREATE TABLE dm_acquisition(document_version_id varchar,source_artifact_id varchar,acquired_by varchar,status varchar,idempotency_key text);`);
    const materialSql = await readFile(
      new URL(
        '../../../migrations/0032_engineering_matter_material.sql',
        import.meta.url,
      ),
      'utf8',
    );
    for (const name of [
      'engineering_matter_uri_component',
      'engineering_matter_document_owned_by_actor',
    ]) {
      const start = materialSql.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
      assert.ok(start >= 0);
      const end = materialSql.indexOf('$$;', start) + 3;
      await migration.unsafe(materialSql.slice(start, end));
    }
    await migration.unsafe(
      await readFile(
        new URL(
          '../../../migrations/0038_document_parse_run.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    for (const name of [
      '0039_engineering_search_projection.sql',
      '0042_engineering_search_projection_pending.sql',
      '0043_engineering_search_hosted_actor_scope.sql',
      '0050_document_source_projection_progress.sql',
    ]) {
      await migration.unsafe(
        await readFile(
          new URL(`../../../migrations/${name}`, import.meta.url),
          'utf8',
        ),
      );
    }
  } finally {
    migration.release();
  }
  await sql.unsafe(
    'GRANT USAGE ON SCHEMA public TO service_role, authenticated',
  );
  await sql.unsafe(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role, authenticated',
  );
}

export function initialProjection(workItemId) {
  return {
    schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
    workItemId,
    requestId: `REQ-${workItemId}`,
    revision: 1,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    permissionSnapshotVersion: 'isolated-test',
    source: {
      documentId: 'doc-job',
      documentVersionId: 'dv-job',
      sourceArtifactId: 'ART-TEST',
      sourceFileSha256: hash,
      sourceByteLength: 1234,
    },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    package: {
      packageId: `PKG-${workItemId}`,
      title: 'Synthetic English source',
      artifact: {
        ref: sourceBindings[0].artifactRef,
        sha256: hash,
        byteLength: 1,
        storeRole: 'U0_PARSED_PACKAGE',
        mediaType: 'application/json',
      },
    },
    integratedAssessment: null,
    failure: null,
    recordingFailure: null,
  };
}
