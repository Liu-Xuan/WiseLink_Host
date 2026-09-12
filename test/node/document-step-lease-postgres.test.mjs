import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postgres from 'postgres';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { DocumentStepLeaseRepository } = require('../../server/modules/document-management/src/hosted/nest/document-step-lease.repository.ts');
const url = process.env.DOCUMENT_STEP_TEST_DATABASE_URL;

test('parseRun step lease survives process replacement and rejects stale, cancelled and foreign writes', { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/wiselink_document_step_test');
  const admin = postgres(url, { max: 1, onnotice() {} });
  const actor = postgres(url, { max: 3, onnotice() {}, connection: { application_name: 'wiselink-step-test' } });
  try {
    await admin.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$;
      CREATE TABLE dm_document_version(document_version_id varchar(96) PRIMARY KEY);
      CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar, v varchar) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT t='TENANT-STEP' AND v='DV-STEP' AND current_setting('app.user_id', true)='ACTOR-STEP';
      $$;
      CREATE TYPE user_profile AS (user_id text);
      INSERT INTO dm_document_version VALUES ('DV-STEP');`);
    for (const name of ['0038_document_parse_run.sql', '0044_document_parse_step_lease.sql']) {
      await admin.unsafe(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    await admin.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT, INSERT, UPDATE ON dm_document_parse_run TO authenticated;
      INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,tenant_id,actor_user_id,request_id,
        parse_revision,expected_published_revision,status,bucket_id,source_binding,deadline_at)
      VALUES ('PRUN-STEP','DV-STEP','TENANT-STEP','ACTOR-STEP','REQ-STEP',1,0,'RUNNING','BUCKET','{"documentVersionId":"DV-STEP"}',now()+interval '10 minutes');`);
    // Each transaction explicitly models the already authenticated platform actor.
    const actorDb = drizzle(actor);
    const asActor = callback => actorDb.transaction(async connection => {
      await connection.execute(sql`SET LOCAL ROLE authenticated`);
      await connection.execute(sql`SELECT set_config('app.user_id','ACTOR-STEP',true)`);
      return callback(new DocumentStepLeaseRepository(connection), connection);
    });
    const scope = { tenantId: 'TENANT-STEP', actorUserId: 'ACTOR-STEP', documentVersionId: 'DV-STEP' };
    const claims = await Promise.all(['consumer-a','consumer-b'].map(owner => asActor(repo => repo.claim(scope, 'PRUN-STEP', owner))));
    assert.equal(claims.filter(Boolean).length, 1);
    const original = claims.find(Boolean);
    await asActor((repo, db) => repo.assertValid(db, scope, original));
    await admin`UPDATE dm_document_parse_run SET lease_expires_at=now()-interval '1 second' WHERE parse_run_id='PRUN-STEP'`;
    const resumed = await asActor(repo => repo.claim(scope, 'PRUN-STEP', 'replacement-process'));
    assert.equal(resumed.leaseGeneration, original.leaseGeneration + 1);
    assert.notEqual(resumed.leaseToken, original.leaseToken);
    await assert.rejects(asActor((repo, db) => repo.assertValid(db, scope, original)), /DOCUMENT_STEP_LEASE_REJECTED/);
    await assert.rejects(asActor((repo, db) => repo.assertValid(db, { ...scope, tenantId: 'foreign' }, resumed)), /DOCUMENT_STEP_LEASE_REJECTED/);
    assert.equal(await asActor(repo => repo.renew(scope, resumed)), true);
    await asActor(repo => repo.release(scope, original));
    await asActor((repo, db) => repo.assertValid(db, scope, resumed));
    await asActor(repo => repo.cancel(scope, 'PRUN-STEP'));
    await assert.rejects(asActor((repo, db) => repo.assertValid(db, scope, resumed)), /DOCUMENT_STEP_LEASE_REJECTED/);
    assert.equal(await asActor(repo => repo.claim(scope, 'PRUN-STEP', 'late-process')), null);
    const [row] = await admin`SELECT status,error_code FROM dm_document_parse_run WHERE parse_run_id='PRUN-STEP'`;
    assert.equal(row.status, 'FAILED');
    assert.equal(row.error_code, 'DOCUMENT_PARSE_CANCELLED');
  } finally { await actor.end(); await admin.end(); }
});
