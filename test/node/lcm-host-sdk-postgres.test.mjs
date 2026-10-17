import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';
import { lcmSdkDatabase } from '../pg/lcm-sdk-database.mjs';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = resolve('tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
require('ts-node/register/transpile-only');
const { Logger } = require('@nestjs/common');
Logger.overrideLogger(false);
const { lcmHostDatabase } = require('../../server/modules/lcm-export-staging/lcm-host-database.ts');
const { LcmPersonalSourceRepository } = require('../../server/modules/lcm-export-staging/lcm-personal-source.repository.ts');
const { actor } = require('../unit/tdms-source/tdms-fixtures.ts');
const out = process.env.LCM_LOCAL_EVIDENCE_DIR;
if (!out) throw new Error('Explicit private LCM_LOCAL_EVIDENCE_DIR is required');
await mkdir(out, { recursive: true, mode: 0o700 });
const capability = await postgresCapability();
assert.equal(capability.available, true, capability.reason);

test('real installed SDK Proxy + request preSql/ROLE + LCM same-transaction owner/RLS + reconnect', async t => {
  const cluster = await startOwnedPostgres(capability);
  let sdk;
  const evidence = { localOnly: true, platformExecution: 0, actualSdkManagerAndProviderAndMiddleware: true,
    businessQueriesUnderAdmin: false, checks: [], observations: [] };
  try {
    await cluster.admin.unsafe('CREATE TYPE user_profile AS (user_id text)');
    await cluster.admin.unsafe(await readFile(new URL('../../migrations/candidates/lcm_personal_import.hosted.sql', import.meta.url), 'utf8'));
    sdk = await lcmSdkDatabase(cluster);
    evidence.roles = sdk.roles;
    const database = lcmHostDatabase(sdk.database), sources = new LcmPersonalSourceRepository(database), owner = actor();
    const withOwner = (id, operation, extras = {}) => sdk.withRequest({ userId: id, roles: ['local-test-reader'],
      userType: '_employee', isSystemAccount: false, ...extras }, operation);
    await t.test('get-only provider Proxy composes and SDK identities apply on the exact transaction client', async () => {
      assert.equal('$client' in sdk.database, false);
      await withOwner(owner.canonicalSubject.id, async () => {
        const actual = await database.run(owner.canonicalSubject.id, async tx => {
          const first = await tx`SELECT current_setting('app.user_id',true) AS id,current_user AS role,
            current_setting('app.role_ids',true) AS roles,txid_current()::text AS xid,pg_backend_pid() AS pid`;
          const again = await tx`SELECT txid_current()::text AS xid,pg_backend_pid() AS pid`;
          assert.equal(first[0].xid, again[0].xid); assert.equal(first[0].pid, again[0].pid);
          return first[0];
        });
        assert.equal(actual.id, owner.canonicalSubject.id); assert.equal(actual.role, sdk.roles.authenticatedRole);
        assert.equal(actual.roles, 'local-test-reader'); evidence.observations.push(actual);
        const grant = await sources.register(owner, 'a'.repeat(64));
        assert.equal(grant.scope.actorId, owner.canonicalSubject.id);
        assert.deepEqual(await sources.library(owner), { hasSource: true, latestSnapshotIds: [], snapshotCount: 0 });
      });
      evidence.checks.push('actual get-only provider and actual middleware apply SDK identity and role to one transaction');
    });
    await t.test('missing request, anonymous, service role and mismatched owner are rejected before LCM operations', async () => {
      const denied = { code: 'LCM_DATABASE_REQUEST_IDENTITY_REQUIRED', statusCode: 403 };
      await assert.rejects(sources.library(owner), denied);
      await withOwner('', () => assert.rejects(sources.library(owner), denied));
      await withOwner(owner.canonicalSubject.id, () => assert.rejects(sources.library(owner), denied), { isSystemAccount: true });
      await withOwner('456', () => assert.rejects(sources.library(owner), denied));
      evidence.checks.push('no request / anonymous / service identity / owner mismatch fail closed');
    });
    await t.test('concurrent actual request owners keep separate user IDs, transactions and source registrations', async () => {
      const people = ['123','456','789','101112'];
      const rows = await Promise.all(people.map(id => withOwner(id, async () => {
        const subject = { ...owner, canonicalSubject: { ...owner.canonicalSubject, id } };
        const registration = await sources.register(subject, 'b'.repeat(64));
        const result = await database.run(id, async tx => {
          await tx`SELECT set_config('app.lcm_tenant_id',${owner.tenantId},true),set_config('app.lcm_actor_id',${id},true)`;
          await tx`SELECT pg_sleep(0.02)`;
          const rows = await tx`SELECT owner_actor_id,current_setting('app.user_id',true) AS request_user,current_user AS role
            FROM lcm_personal_source`;
          assert.equal(rows.length, 1); assert.equal(rows[0].owner_actor_id, id); assert.equal(rows[0].request_user, id);
          // An SQL caller cannot substitute a different owner by changing only LCM's session variables.
          await tx`SELECT set_config('app.lcm_actor_id','not-this-request',true)`;
          assert.equal((await tx`SELECT owner_actor_id FROM lcm_personal_source`).length, 0);
          return rows[0];
        });
        return { ...result, source: registration.scope.authorizedSourceInstanceIds[0] };
      })));
      assert.equal(new Set(rows.map(row => row.source)).size, people.length);
      evidence.observations.push(...rows); evidence.checks.push('concurrent owner isolation including forged LCM actor variable');
    });
    await t.test('rollback keeps one atomic transaction and does not leak SET LOCAL user/role into the next request', async () => {
      const id = 'rollback-owner', subject = { ...owner, canonicalSubject: { ...owner.canonicalSubject, id } };
      await withOwner(id, async () => {
        await assert.rejects(database.run(id, async tx => {
          await tx`SELECT set_config('app.lcm_tenant_id',${owner.tenantId},true),set_config('app.lcm_actor_id',${id},true)`;
          await tx`INSERT INTO lcm_personal_source(application_scope_id,tenant_id,owner_actor_id,source_instance_id,created_from_sha256)
            VALUES (${owner.applicationScopeId},${owner.tenantId},${id},'rolled-back-source',${'c'.repeat(64)})`;
          throw new Error('deliberate-local-rollback');
        }), { message: 'deliberate-local-rollback' });
        assert.equal((await sources.library(subject)).hasSource, false);
      });
      await assert.rejects(sources.library(owner), { code: 'LCM_DATABASE_REQUEST_IDENTITY_REQUIRED' });
      evidence.checks.push('atomic rollback and missing-context rejection after pooled authenticated requests');
    });
    await t.test('public SDK manager reconnect closes the old client while the same Host runner follows the new database', async () => {
      const before = sdk.database.$client;
      const first = await withOwner('123', () => database.run('123', async tx => (await tx`SELECT pg_backend_pid() AS pid`)[0].pid));
      await sdk.manager.reconnect();
      assert.notEqual(sdk.database.$client, before);
      const second = await withOwner('123', () => database.run('123', async tx => (await tx`SELECT pg_backend_pid() AS pid`)[0].pid));
      assert.notEqual(second, first);
      assert.equal((await withOwner('123', () => sources.library(owner))).hasSource, true);
      evidence.reconnect = { oldPid: first, newPid: second, clientChanged: true, originalRunnerReused: true };
      evidence.checks.push('real manager reconnect + actual provider getter + original runner reuse');
    });
    await t.test('seven-table candidate has four platform audit columns, typed JSON comments, RLS and authenticated audit values', async () => {
      const audit = await cluster.admin`SELECT table_name,count(*)::int AS count FROM information_schema.columns
        WHERE table_name LIKE 'lcm_%' AND column_name IN ('_created_at','_created_by','_updated_at','_updated_by')
        GROUP BY table_name ORDER BY table_name`;
      assert.equal(audit.length, 7); assert.ok(audit.every(table => table.count === 4));
      const policies = await cluster.admin`SELECT relname,relrowsecurity,relforcerowsecurity
        FROM pg_class WHERE relkind='r' AND relname LIKE 'lcm_%'`;
      assert.equal(policies.length, 7); assert.ok(policies.every(table => table.relrowsecurity && table.relforcerowsecurity));
      const comments = await cluster.admin`SELECT col_description(attrelid,attnum) AS comment
        FROM pg_attribute WHERE attrelid IN (SELECT oid FROM pg_class WHERE relname LIKE 'lcm_%')
          AND atttypid='jsonb'::regtype`;
      assert.equal(comments.length, 3); assert.ok(comments.every(column => column.comment?.startsWith('@type')));
      const created = await withOwner('123', () => database.run('123', async tx => {
        await tx`SELECT set_config('app.lcm_tenant_id',${owner.tenantId},true),set_config('app.lcm_actor_id','123',true)`;
        return tx`SELECT (_created_by).user_id AS created,(_updated_by).user_id AS updated FROM lcm_personal_source`;
      }));
      assert.equal(created[0].created, '123'); assert.equal(created[0].updated, '123');
      const actionPolicies = await cluster.admin`SELECT tablename,array_agg(cmd ORDER BY cmd) AS commands
        FROM pg_policies WHERE tablename LIKE 'lcm_%' AND permissive='PERMISSIVE' GROUP BY tablename`;
      assert.equal(actionPolicies.length, 7);
      assert.ok(actionPolicies.every(table => table.commands.join(',') === 'DELETE,INSERT,SELECT,UPDATE'));
      evidence.audit = { audit, policies, actionPolicies, jsonCommentCount: comments.length, authenticatedAuditActor: created[0] };
      evidence.checks.push('seven tables + 28 audit columns + 3 JSON type comments + enabled/forced RLS + actual request user_profile');
    });
    await writeFile(join(out, 'sdk-composition.actual.private.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  } finally {
    if (sdk) await sdk.close();
    await cluster.stop();
  }
});
