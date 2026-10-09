import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

function databaseCode(error) {
  const seen = new Set();
  for (
    let current = error;
    current && !seen.has(current);
    current = current.cause
  ) {
    seen.add(current);
    if (typeof current.code === 'string') return current.code;
  }
  return null;
}
const capability = await postgresCapability();
const tables = [
  'tdms_capture',
  'tdms_record',
  'tdms_record_revision',
  'tdms_relation',
  'tdms_relation_assertion',
  'tdms_read_receipt',
];
const scopeA = {
  tenantId: 'tenant-a',
  sourceKey: 'TDMS',
  sourceInstanceId: 'fixture-instance',
  scopeId: 'fixture-scope',
};
const scopeB = { ...scopeA, tenantId: 'tenant-b' };
function actor(id, tenant) {
  return {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id },
    tenantId: tenant,
    applicationScopeId: 'app_17bzc551rsg',
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: tenant,
      version: 'fixture-only',
      decidedAt: new Date().toISOString(),
    },
    identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
    applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT',
    workspaceId: null,
    workspaceProvenance: 'UNAVAILABLE',
    env: 'preview',
    platformRoles: [],
    feishuUserId: null,
    feishuOpenId: null,
    feishuIdentityProvenance: 'UNAVAILABLE',
    sessionId: null,
    sessionRevision: null,
    sessionProvenance: 'UNAVAILABLE',
  };
}
function packet(
  packageId,
  expected = null,
  revision = '1',
  observedAt = '2026-10-05T10:00:00Z',
) {
  const coverage = { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' };
  return {
    schemaVersion: 'wiselink.tdms-source-package.v1',
    packageId,
    observedAt,
    coverage,
    query: {
      requestedCriteria: { fixture: true },
      actualCriteria: { fixture: true },
      scopeMatch: 'MATCHED',
    },
    readFailures: [],
    records: [
      {
        itemId: 'a',
        recordKind: 'ENGINEERING_FILE',
        sourceRecordId: 'REC-A',
        expectedHeadRevisionRef: expected,
        sourceVersion: {
          rawRevision: revision,
          rawIteration: null,
          confirmation: 'SOURCE_DECLARED',
        },
        title: 'Isolated fixture',
        fileType: { rawCode: 'AEO', rawName: 'source label only' },
        state: { rawCode: 'Passed', rawName: 'source state only' },
        authors: [],
        sourceModifiedAt: null,
        observedAt,
        coverage,
        rawFields: { fixture: true, mandatory: false },
        content: { conditions: ['no execution/adoption inference'] },
        fieldProvenance: [],
        artifactMemberIds: [],
        relatedDocumentVersionIds: [],
      },
    ],
    relations: [],
    artifacts: [],
  };
}
function relationPacket(id, expectedRecord = null, expectedRelation = null) {
  const p = packet(id, expectedRecord);
  p.relations = [
    {
      sourceRelationId: 'EDGE-A',
      expectedHeadAssertionRef: expectedRelation,
      rawKind: 'references',
      controlledKind: 'REFERENCES',
      from: { kind: 'PACKAGE_RECORD', itemId: 'a' },
      to: {
        kind: 'UNRESOLVED',
        rawIdentity: 'VR:fixture-unmapped',
        versionGap: 'exact OR/VR mapping not proven',
      },
      authority: 'SOURCE_EXPLICIT',
      selector: 'fixture.row',
      observedAt: p.observedAt,
      coverage: p.coverage,
      scope: {},
      completionEffect: 'UNSPECIFIED',
      changeClass: 'UNSPECIFIED',
      rawFields: { fixture: true },
    },
  ];
  return p;
}

test(
  'owned ephemeral physical PostgreSQL: native six-table draft, transactions, exact observation history and fixture RLS',
  { skip: capability.available ? false : capability.reason, timeout: 120000 },
  async (t) => {
    // No URL input/fallback. initdb + postgres process and data_directory are owned by this runner.
    const owned = await startOwnedPostgres(capability);
    try {
      t.diagnostic(
        `TDMS_OWNED_PG_IDENTITY ${JSON.stringify({
          expected: owned.expected,
          instance: owned.instance,
          identity: owned.identity,
        })}`,
      );
      const admin = owned.admin;
      const schema = 'tdms_pg_' + randomUUID().replaceAll('-', '').slice(0, 16);
      const badSchema = schema + '_bad';
      const applicationLogin =
        'tdms_fixture_app_' + schema.slice('tdms_pg_'.length);
      const roles = {
        authenticated: 'authenticated_' + schema,
        service: 'service_role_' + schema,
      };
      let permissionRevision = 'fixture-policy-1';
      let enabled = true;
      let readRecordChecks = 0;
      let changeAfterReceipt = false;
      process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
      process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
        module: 'CommonJS',
        moduleResolution: 'node',
      });
      const require = createRequire(import.meta.url);
      require('ts-node/register/transpile-only');
      require('tsconfig-paths/register');
      const { drizzle } = require('drizzle-orm/postgres-js');
      const {
        MiaodaTdmsSourceRepository,
      } = require('../../server/modules/tdms-source/tdms-source.repository.ts');
      const {
        TdmsSourceService,
      } = require('../../server/modules/tdms-source/tdms-source.service.ts');
      const {
        HostDecisionTdmsSourceAuthorization,
      } = require('../../server/modules/tdms-source/tdms-source.authorization.ts');
      const ddl = await readFile(
        new URL(
          '../../server/database/tdms-source-rebuild-v1.draft.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const clients = [];
      async function client(role, user) {
        const sql = await owned.connect(applicationLogin);
        clients.push(sql);
        await sql.unsafe(`SET search_path TO ${schema},pg_catalog`);
        await sql.unsafe(`SET ROLE ${role}`);
        await sql`SELECT set_config('app.user_id',${user},false)`;
        const [identity] =
          await sql`SELECT current_user AS role,session_user AS login`;
        assert.equal(identity.role, role);
        assert.notEqual(identity.role, identity.login);
        assert.equal(identity.login, applicationLogin);
        return {
          sql,
          repository: new MiaodaTdmsSourceRepository(drizzle(sql)),
        };
      }
      async function counts() {
        const result = {};
        for (const table of tables) {
          const [row] = await admin.unsafe(
            `SELECT count(*)::int AS n FROM ${schema}.${table}`,
          );
          result[table] = row.n;
        }
        return result;
      }
      // Explicit server-authorizer fixture double, not an installed current Host provider.
      const authorization = new HostDecisionTdmsSourceAuthorization(
        async (input) => {
          const id = input.actor.canonicalSubject.id,
            tenant = input.actor.tenantId;
          if (input.action === 'READ_RECORD') {
            readRecordChecks++;
            if (changeAfterReceipt && readRecordChecks === 3)
              permissionRevision = 'fixture-policy-2';
          }
          if (
            !enabled ||
            !(
              (id === 'actor-one' && tenant === 'tenant-a') ||
              (id === 'actor-b' && tenant === 'tenant-b')
            )
          )
            return [];
          const scope = tenant === 'tenant-a' ? scopeA : scopeB;
          if (
            input.scope &&
            Object.entries(scope).some(
              ([key, value]) => input.scope[key] !== value,
            )
          )
            return [];
          return [{ scope, permissionRevision }];
        },
        async ({ scope, claims, grant }) => ({
          ...grant,
          scope,
          authorityRef: 'fixture-source-rights',
          captureRetentionAllowed: true,
          nativeProjectionAllowed: true,
          permittedMembers: {
            records: claims.records.filter(
              (r) =>
                r.recordKind === 'ENGINEERING_FILE' &&
                ['REC-A', 'REC-B'].includes(r.sourceRecordId),
            ),
            artifacts: [],
            relationIds: claims.relationIds.filter((id) => id === 'EDGE-A'),
          },
        }),
      );
      const noArtifacts = {
        acquire: async () => {
          throw new Error('NO_FILESERVICE_OR_SOURCE_IO_IN_PHYSICAL_FIXTURE');
        },
      };
      const noDocuments = {
        assertRead: async () => {
          throw new Error('NO_DOCUMENT_SOURCE_IO_IN_PHYSICAL_FIXTURE');
        },
      };
      const service = (db) =>
        new TdmsSourceService(db, authorization, noArtifacts, noDocuments);
      await admin.unsafe(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${badSchema}`);
      const existing =
        await admin`SELECT rolname FROM pg_roles WHERE rolname IN (${roles.authenticated},${roles.service},${applicationLogin})`;
      assert.equal(
        existing.length,
        0,
        'never reuse/alter existing cluster roles',
      );
      for (const role of Object.values(roles))
        await admin.unsafe(
          `CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
        );
      await admin.unsafe(
        `CREATE ROLE ${applicationLogin} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      await admin.unsafe(
        `GRANT ${roles.authenticated},${roles.service} TO ${applicationLogin}`,
      );
      await admin.unsafe(`SET search_path TO ${schema},pg_catalog`);
      await admin.unsafe(ddl);
      await t.test(
        'the exact draft creates six ENABLE/FORCE RLS tables with no policies',
        async () => {
          const rows =
            await admin`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,(SELECT count(*)::int FROM pg_policy WHERE polrelid=c.oid) AS policies FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname IN (${tables[0]},${tables[1]},${tables[2]},${tables[3]},${tables[4]},${tables[5]})`;
          assert.equal(rows.length, 6);
          assert.ok(
            rows.every(
              (r) =>
                r.relrowsecurity && r.relforcerowsecurity && r.policies === 0,
            ),
          );
          const roleRows =
            await admin`SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN (${roles.authenticated},${roles.service})`;
          assert.ok(roleRows.every((r) => !r.rolsuper && !r.rolbypassrls));
        },
      );
      await t.test(
        'an injected migration failure physically rolls all six new tables back',
        async () => {
          await admin.unsafe(`SET search_path TO ${badSchema},pg_catalog`);
          await assert.rejects(
            admin.unsafe(
              ddl.replace(
                'COMMIT;',
                'SELECT tdms_fixture_missing_function(); COMMIT;',
              ),
            ),
          );
          await admin.unsafe('ROLLBACK');
          const rows =
            await admin`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${badSchema}`;
          assert.equal(rows.length, 0);
          await admin.unsafe(`SET search_path TO ${schema},pg_catalog`);
        },
      );
      for (const role of Object.values(roles)) {
        await admin.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
        for (const table of tables)
          await admin.unsafe(
            `GRANT SELECT,INSERT ON ${schema}.${table} TO ${role}`,
          );
        await admin.unsafe(
          `GRANT UPDATE ON ${schema}.tdms_record,${schema}.tdms_relation TO ${role}`,
        );
      }
      const one = await client(roles.authenticated, 'actor-one');
      const second = await client(roles.service, 'actor-one');
      const two = await client(roles.authenticated, 'actor-two');
      const foreign = await client(roles.authenticated, 'actor-b');
      await assert.rejects(
        one.sql.unsafe('SET ROLE tdms_test_owner'),
        (error) => databaseCode(error) === '42501',
      );
      const [loginRole] =
        await admin`SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=${applicationLogin}`;
      assert.ok(
        !loginRole.rolsuper &&
          !loginRole.rolbypassrls &&
          !loginRole.rolcreatedb &&
          !loginRole.rolcreaterole,
      );
      const main = service(one.repository),
        otherConnection = service(second.repository);
      await t.test(
        'table privileges exist but default RLS denies reads and inserts before fixture policy',
        async () => {
          assert.equal(
            (await one.sql`SELECT * FROM tdms_record_revision`).length,
            0,
          );
          await assert.rejects(
            main.importPackage(
              actor('actor-one', 'tenant-a'),
              {
                sourceKey: 'TDMS',
                sourceInstanceId: 'fixture-instance',
                scopeId: 'fixture-scope',
              },
              packet('DENIED'),
            ),
            (e) => databaseCode(e) === '42501',
          );
          assert.deepEqual(
            await counts(),
            Object.fromEntries(tables.map((x) => [x, 0])),
          );
        },
      );
      // TEST-ONLY fixture policy: scope and actor membership. Not deployment grants/policies.
      await admin.unsafe(`CREATE TABLE ${schema}._test_actor_tenant(actor_id text,tenant_id text,PRIMARY KEY(actor_id,tenant_id));
      CREATE TABLE ${schema}._test_scope_access(actor_id text,tenant_id text,source_key text,source_instance_id text,scope_id text,allowed boolean NOT NULL,PRIMARY KEY(actor_id,tenant_id,source_key,source_instance_id,scope_id));`);
      await admin.unsafe(`INSERT INTO ${schema}._test_actor_tenant VALUES ('actor-one','tenant-a'),('actor-two','tenant-a'),('actor-b','tenant-b');
      INSERT INTO ${schema}._test_scope_access VALUES ('actor-one','tenant-a','TDMS','fixture-instance','fixture-scope',true),('actor-two','tenant-a','TDMS','fixture-instance','fixture-scope',false),('actor-b','tenant-b','TDMS','fixture-instance','fixture-scope',true)`);
      for (const role of Object.values(roles))
        await admin.unsafe(
          `GRANT SELECT ON ${schema}._test_actor_tenant,${schema}._test_scope_access TO ${role}`,
        );
      for (const table of tables) {
        const extra =
          table === 'tdms_read_receipt'
            ? ` AND actor_id=current_setting('app.user_id',true)`
            : '';
        const predicate = `EXISTS (SELECT 1 FROM ${schema}._test_scope_access a JOIN ${schema}._test_actor_tenant m ON m.actor_id=a.actor_id AND m.tenant_id=a.tenant_id WHERE a.actor_id=current_setting('app.user_id',true) AND a.allowed AND a.tenant_id=${table}.tenant_id AND a.source_key=${table}.source_key AND a.source_instance_id=${table}.source_instance_id AND a.scope_id=${table}.scope_id)${extra}`;
        await admin.unsafe(
          `CREATE POLICY fixture_native_scope ON ${schema}.${table} FOR ALL TO ${roles.authenticated},${roles.service} USING (${predicate}) WITH CHECK (${predicate})`,
        );
      }
      const target = {
        sourceKey: 'TDMS',
        sourceInstanceId: 'fixture-instance',
        scopeId: 'fixture-scope',
      };
      let first;
      await t.test(
        'same actor package replay uses the actual service/repository and persists exact native receipt',
        async () => {
          const p = relationPacket('FIRST');
          first = await main.importPackage(
            actor('actor-one', 'tenant-a'),
            target,
            p,
          );
          const before = await counts();
          const replay = await main.importPackage(
            actor('actor-one', 'tenant-a'),
            target,
            p,
          );
          assert.equal(replay.created, false);
          assert.equal(replay.captureRef, first.captureRef);
          assert.deepEqual(await counts(), before);
          const read = await main.readRecord(
            actor('actor-one', 'tenant-a'),
            first.recordRevisionRefs[0],
          );
          assert.equal(
            read.receipt.sourceRevisionRef,
            first.recordRevisionRefs[0],
          );
          assert.equal(read.receipt.readPerformed, true);
          assert.equal(read.receipt.executionVerified, false);
          const changed = structuredClone(p);
          changed.records[0].title = 'different';
          await assert.rejects(
            main.importPackage(actor('actor-one', 'tenant-a'), target, changed),
            /IDEMPOTENCY_CONFLICT/,
          );
        },
      );
      await t.test(
        'record and relation CAS failures roll back already inserted immutable history',
        async () => {
          const before = await counts();
          const old = await one.repository.transaction((tx) =>
            tx.revision('tenant-a', first.recordRevisionRefs[0]),
          );
          await assert.rejects(
            one.repository.transaction((tx) =>
              tx.saveRevision(
                {
                  scope: scopeA,
                  recordRef: old.record.recordRef,
                  sourceRecordId: 'REC-A',
                  recordKind: 'ENGINEERING_FILE',
                  sourceRevisionRef: 'SHOULD-ROLL-BACK',
                  observedAt: old.record.observedAt,
                },
                'WRONG-EXPECTED',
                {
                  scope: scopeA,
                  record: {
                    ...old.record,
                    sourceRevisionRef: 'SHOULD-ROLL-BACK',
                  },
                },
              ),
            ),
            /CAS_CONFLICT/,
          );
          const [row] =
            await admin`SELECT data FROM tdms_relation_assertion WHERE assertion_ref=${first.assertionRefs[0]}`;
          const assertion = {
            ...row.data.assertion,
            assertionRef: 'ASSERTION-ROLL-BACK',
            selectedHead: true,
          };
          await assert.rejects(
            one.repository.transaction((tx) =>
              tx.saveAssertion(
                {
                  scope: scopeA,
                  relationRef: assertion.relationRef,
                  sourceRelationId: 'EDGE-A',
                  assertionRef: assertion.assertionRef,
                  observedAt: assertion.observedAt,
                },
                'WRONG-EXPECTED',
                { scope: scopeA, assertion },
              ),
            ),
            /CAS_CONFLICT/,
          );
          assert.deepEqual(await counts(), before);
        },
      );
      await t.test(
        'new-head same-package uniqueness race leaves one complete capture and replay is recoverable',
        async () => {
          const before = await counts();
          const p = packet('SAME-CREATE');
          p.records[0].sourceRecordId = 'REC-B';
          const result = await Promise.allSettled([
            main.importPackage(actor('actor-one', 'tenant-a'), target, p),
            otherConnection.importPackage(
              actor('actor-one', 'tenant-a'),
              target,
              p,
            ),
          ]);
          const commits = result.filter((r) => r.status === 'fulfilled');
          assert.ok(commits.length >= 1);
          const after = await counts();
          assert.equal(after.tdms_record, before.tdms_record + 1);
          assert.equal(
            after.tdms_record_revision,
            before.tdms_record_revision + 1,
          );
          assert.equal(after.tdms_capture, before.tdms_capture + 1);
          if (result.some((r) => r.status === 'rejected'))
            assert.match(
              result.find((r) => r.status === 'rejected').reason.code,
              /CAS_CONFLICT|IDEMPOTENCY_CONFLICT/,
            );
          const replay = await main.importPackage(
            actor('actor-one', 'tenant-a'),
            target,
            p,
          );
          assert.equal(replay.created, false);
          assert.equal(replay.captureRef, commits[0].value.captureRef);
        },
      );
      let newest;
      await t.test(
        'two independent connections race an exact head; one wins and the loser rolls back',
        async () => {
          const before = await counts();
          const p1 = packet(
            'RACE-1',
            first.recordRevisionRefs[0],
            '2',
            '2026-10-05T11:00:00Z',
          );
          const p2 = packet(
            'RACE-2',
            first.recordRevisionRefs[0],
            '2',
            '2026-10-05T11:00:00Z',
          );
          const result = await Promise.allSettled([
            main.importPackage(actor('actor-one', 'tenant-a'), target, p1),
            otherConnection.importPackage(
              actor('actor-one', 'tenant-a'),
              target,
              p2,
            ),
          ]);
          assert.equal(
            result.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          assert.equal(result.filter((r) => r.status === 'rejected').length, 1);
          newest = result.find((r) => r.status === 'fulfilled').value;
          assert.match(
            result.find((r) => r.status === 'rejected').reason.code,
            /CAS_CONFLICT|IDEMPOTENCY_CONFLICT/,
          );
          const after = await counts();
          assert.equal(
            after.tdms_record_revision,
            before.tdms_record_revision + 1,
          );
          assert.equal(after.tdms_capture, before.tdms_capture + 1);
          assert.equal(after.tdms_record, before.tdms_record);
        },
      );
      await t.test(
        'late old observations and same-declared-version changes are retained without fabrication',
        async () => {
          const old = await main.importPackage(
            actor('actor-one', 'tenant-a'),
            target,
            packet(
              'LATE',
              newest.recordRevisionRefs[0],
              '1',
              '2026-10-05T09:00:00Z',
            ),
          );
          assert.equal(
            (
              await main.readRecord(
                actor('actor-one', 'tenant-a'),
                old.recordRevisionRefs[0],
              )
            ).record.selectedHead,
            false,
          );
          const conflict = packet(
            'CONFLICT',
            newest.recordRevisionRefs[0],
            '2',
            '2026-10-05T12:00:00Z',
          );
          conflict.records[0].content.conditions = [
            'changed source observation',
          ];
          const changed = await main.importPackage(
            actor('actor-one', 'tenant-a'),
            target,
            conflict,
          );
          assert.equal(changed.status, 'PARTIAL');
          assert.ok(
            changed.gaps.includes('SAME_DECLARED_VERSION_CONTENT_CHANGED'),
          );
          assert.equal(
            (
              await main.readRecord(
                actor('actor-one', 'tenant-a'),
                first.recordRevisionRefs[0],
              )
            ).record.sourceVersion.rawRevision,
            '1',
          );
          const retained = await main.readRecord(
            actor('actor-one', 'tenant-a'),
            newest.recordRevisionRefs[0],
          );
          const changedRead = await main.readRecord(
            actor('actor-one', 'tenant-a'),
            changed.recordRevisionRefs[0],
          );
          assert.equal(retained.record.sourceVersion.rawRevision, '2');
          assert.equal(changedRead.record.sourceVersion.rawRevision, '2');
          assert.deepEqual(retained.record.content.conditions, [
            'no execution/adoption inference',
          ]);
          assert.deepEqual(changedRead.record.content.conditions, [
            'changed source observation',
          ]);
        },
      );
      await t.test(
        'physical RLS hides other actor, foreign tenant, source instance and scope; SQL claims do not change roles',
        async () => {
          const tenantB = await service(foreign.repository).importPackage(
            actor('actor-b', 'tenant-b'),
            target,
            packet('FIRST'),
          );
          assert.equal(
            (await main.catalogue(actor('actor-one', 'tenant-a'))).records
              .length,
            2,
          );
          await assert.rejects(
            main.readRecord(
              actor('actor-one', 'tenant-a'),
              tenantB.recordRevisionRefs[0],
            ),
            /NOT_FOUND/,
          );
          assert.equal(
            (await two.sql`SELECT * FROM tdms_record_revision`).length,
            0,
          );
          assert.equal(
            (
              await one.sql`SELECT * FROM tdms_record_revision WHERE tenant_id='tenant-b'`
            ).length,
            0,
          );
          await assert.rejects(
            service(two.repository).readRecord(
              actor('actor-two', 'tenant-a'),
              first.recordRevisionRefs[0],
            ),
            /NOT_FOUND/,
          );
          // Same authenticated DB actor cannot read a different tenant, regardless of caller tenant input.
          assert.equal(
            await one.repository.transaction((tx) =>
              tx.revision('tenant-b', tenantB.recordRevisionRefs[0]),
            ),
            null,
          );
          await assert.rejects(
            main.readRecord(
              actor('actor-one', 'tenant-b'),
              tenantB.recordRevisionRefs[0],
            ),
            /NOT_FOUND/,
          );
          // Bypass the server double: direct SQL still denies foreign source instance and scope.
          for (const [instance, scope] of [
            ['foreign-instance', 'fixture-scope'],
            ['fixture-instance', 'foreign-scope'],
          ]) {
            await assert.rejects(
              one.sql`INSERT INTO tdms_record_revision (tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data) VALUES ('tenant-a','TDMS',${instance},${scope},${'FOREIGN-' + randomUUID()},'FOREIGN','{}'::jsonb)`,
              (error) => databaseCode(error) === '42501',
            );
          }
          await one.sql`SELECT set_config('request.jwt.claims','{"role":"service_role","sub":"actor-b"}',false)`;
          const [role] = await one.sql`SELECT current_user AS current_role`;
          assert.equal(role.current_role, roles.authenticated);
          await assert.rejects(
            main.importPackage(
              actor('actor-one', 'tenant-a'),
              { ...target, sourceInstanceId: 'foreign-instance' },
              packet('FOREIGN'),
            ),
            /NOT_FOUND/,
          );
        },
      );
      await t.test(
        'SQL unique conflict, no ordinary history overwrite and post-receipt permission change retain rollback',
        async () => {
          const before = await counts();
          await assert.rejects(
            one.repository.transaction(async (tx) => {
              const stored = await tx.revision(
                'tenant-a',
                first.recordRevisionRefs[0],
              );
              await tx.saveRevision(
                {
                  scope: scopeA,
                  recordRef: stored.record.recordRef,
                  sourceRecordId: 'REC-A',
                  recordKind: 'ENGINEERING_FILE',
                  sourceRevisionRef: stored.record.sourceRevisionRef,
                  observedAt: stored.record.observedAt,
                },
                'wrong',
                stored,
              );
            }),
            (e) => databaseCode(e) === '23505',
          );
          assert.deepEqual(await counts(), before);
          await assert.rejects(
            one.sql`UPDATE tdms_record_revision SET data='{}'::jsonb`,
            (e) => databaseCode(e) === '42501',
          );
          // Third fresh authorization occurs after the real receipt INSERT but before COMMIT.
          readRecordChecks = 0;
          changeAfterReceipt = true;
          const receiptsBefore = (await counts()).tdms_read_receipt;
          await assert.rejects(
            main.readRecord(
              actor('actor-one', 'tenant-a'),
              first.recordRevisionRefs[0],
            ),
            /PERMISSION_CHANGED/,
          );
          changeAfterReceipt = false;
          assert.equal((await counts()).tdms_read_receipt, receiptsBefore);
        },
      );
      await t.test(
        'revocation hides exact history and catalogue without granting source or deployment rights',
        async () => {
          enabled = false;
          await admin`UPDATE _test_scope_access SET allowed=false WHERE actor_id='actor-one'`;
          assert.equal(
            (await one.sql`SELECT * FROM tdms_record_revision`).length,
            0,
          );
          assert.deepEqual(
            (await main.catalogue(actor('actor-one', 'tenant-a'))).records,
            [],
          );
          await assert.rejects(
            main.readRecord(
              actor('actor-one', 'tenant-a'),
              first.recordRevisionRefs[0],
            ),
            /NOT_FOUND/,
          );
        },
      );
    } finally {
      await owned.stop();
    }
  },
);
