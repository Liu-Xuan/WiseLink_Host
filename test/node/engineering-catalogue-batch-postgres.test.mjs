import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = resolve('tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: drizzleSql } = require('drizzle-orm');
const { EngineeringMatterWorkingRepository } = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');

const databaseUrl = process.env.CATALOGUE_BATCH_TEST_DATABASE_URL;

test('batched exact rows retain tenant, owner and source-link RLS in real PostgreSQL',
  { skip: !databaseUrl, concurrency: false, timeout: 30000 }, async () => {
    const schema = `catalogue_batch_${randomUUID().replaceAll('-', '')}`;
    const role = `catalogue_reader_${randomUUID().replaceAll('-', '')}`;
    const sql = postgres(databaseUrl, { max: 1 });
    try {
      await sql.unsafe(`CREATE SCHEMA "${schema}"`);
      await sql.unsafe(`CREATE ROLE "${role}" NOLOGIN`);
      await sql.begin(async tx => {
        await tx.unsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx`CREATE TABLE engineering_matter_work_revision (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          matter_work_revision_id varchar(96) UNIQUE NOT NULL,
          tenant_id varchar(128) NOT NULL, matter_id varchar(96) NOT NULL,
          working_revision integer NOT NULL, request_id varchar(96) NOT NULL,
          based_on_matter_revision_id varchar(96) NOT NULL,
          update_kind varchar(32) NOT NULL, command_json text NOT NULL,
          state_json text NOT NULL, substantive_result_ref text,
          substantive_result_revision integer, change_summary text NOT NULL,
          action_attempt_id varchar(96), review_turn_id varchar(96),
          created_by_user_id varchar(255) NOT NULL,
          created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`;
        await tx`CREATE TABLE test_matter_access (tenant_id text, matter_id text, actor_id text, allowed boolean)`;
        await tx`CREATE TABLE test_link_access (tenant_id text, revision_id text, allowed boolean)`;
        await tx.unsafe(`CREATE FUNCTION engineering_matter_actor_has_tenant(value varchar)
          RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT value = current_setting('app.tenant_id', true) $$`);
        await tx.unsafe(`CREATE FUNCTION engineering_matter_owned_by_actor(tenant varchar, matter varchar)
          RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (
            SELECT 1 FROM "${schema}".test_matter_access access
            WHERE access.tenant_id = tenant AND access.matter_id = matter
              AND access.actor_id = current_setting('app.user_id', true) AND access.allowed
          ) $$`);
        await tx.unsafe(`CREATE FUNCTION engineering_matter_all_links_owned_by_actor(tenant varchar, revision varchar)
          RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (
            SELECT 1 FROM "${schema}".test_link_access access
            WHERE access.tenant_id = tenant AND access.revision_id = revision AND access.allowed
          ) $$`);
        await tx`ALTER TABLE engineering_matter_work_revision ENABLE ROW LEVEL SECURITY`;
        await tx.unsafe(`CREATE POLICY engineering_matter_work_revision_authenticated_select
          ON engineering_matter_work_revision FOR SELECT TO "${role}" USING (
            engineering_matter_actor_has_tenant(tenant_id)
            AND engineering_matter_owned_by_actor(tenant_id, matter_id)
            AND engineering_matter_all_links_owned_by_actor(tenant_id, based_on_matter_revision_id)
          )`);
        await tx.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
        await tx.unsafe(`GRANT SELECT ON engineering_matter_work_revision, test_matter_access, test_link_access TO "${role}"`);
        await tx`INSERT INTO test_matter_access VALUES
          ('tenant-A','MAT-A','owner-A',true),
          ('tenant-A','MAT-B','owner-B',true),
          ('tenant-A','MAT-C','owner-A',true),
          ('tenant-B','MAT-A','owner-A',true)`;
        await tx`INSERT INTO test_link_access VALUES
          ('tenant-A','BASIS-A',true), ('tenant-A','BASIS-B',true),
          ('tenant-A','BASIS-C',false), ('tenant-B','BASIS-D',true)`;
        await tx`INSERT INTO engineering_matter_work_revision
          (matter_work_revision_id,tenant_id,matter_id,working_revision,request_id,
            based_on_matter_revision_id,update_kind,command_json,state_json,
            change_summary,created_by_user_id) VALUES
          ('REV-A','tenant-A','MAT-A',1,'REQ-A','BASIS-A','INITIAL_SYNTHESIS','{}','{}','saved','owner-A'),
          ('REV-B','tenant-A','MAT-B',1,'REQ-B','BASIS-B','INITIAL_SYNTHESIS','{}','{}','saved','owner-B'),
          ('REV-C','tenant-A','MAT-C',1,'REQ-C','BASIS-C','INITIAL_SYNTHESIS','{}','{}','saved','owner-A'),
          ('REV-D','tenant-B','MAT-A',1,'REQ-D','BASIS-D','INITIAL_SYNTHESIS','{}','{}','saved','owner-A')`;
      });
      const read = async actor => drizzle(sql).transaction(async tx => {
        await tx.execute(drizzleSql.raw(`SET LOCAL search_path TO "${schema}"`));
        await tx.execute(drizzleSql`SELECT set_config('app.tenant_id', 'tenant-A', true)`);
        await tx.execute(drizzleSql`SELECT set_config('app.user_id', ${actor}, true)`);
        await tx.execute(drizzleSql.raw(`SET LOCAL ROLE "${role}"`));
        const repo = new EngineeringMatterWorkingRepository(tx, {}, {}, {});
        const batch = repo.createSavedRowBatch(4);
        return Promise.all([
          batch.read({ tenantId: 'tenant-A', matterId: 'MAT-A', workRef: 'REV-A' }),
          batch.read({ tenantId: 'tenant-A', matterId: 'MAT-B', workRef: 'REV-B' }),
          batch.read({ tenantId: 'tenant-A', matterId: 'MAT-C', workRef: 'REV-C' }),
          batch.read({ tenantId: 'tenant-B', matterId: 'MAT-A', workRef: 'REV-D' }),
        ]);
      });
      const first = await read('owner-A');
      assert.deepEqual(first.map(row => row?.matterWorkRevisionId ?? null), ['REV-A', null, null, null]);
      const second = await read('owner-B');
      assert.deepEqual(second.map(row => row?.matterWorkRevisionId ?? null), [null, 'REV-B', null, null]);
      await sql.unsafe(`UPDATE "${schema}".test_link_access SET allowed=false WHERE revision_id='BASIS-A'`);
      const revoked = await read('owner-A');
      assert.deepEqual(revoked.map(row => row?.matterWorkRevisionId ?? null), [null, null, null, null]);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await sql.unsafe(`DROP ROLE IF EXISTS "${role}"`);
      await sql.end();
    }
  });
