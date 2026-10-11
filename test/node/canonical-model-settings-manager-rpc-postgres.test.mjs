import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = fileURLToPath(
  new URL('../../tsconfig.node.json', import.meta.url),
);
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const {
  CanonicalModelSettingsRepository,
} = require('../../server/modules/model-settings/canonical-model-settings.repository.ts');
const {
  CanonicalModelSettingsService,
} = require('../../server/modules/model-settings/canonical-model-settings.service.ts');
const {
  CANONICAL_REGISTERED_MODELS,
  CANONICAL_MODEL_MANAGER_ROLE_ENV,
} = require('../../server/modules/model-settings/canonical-model-catalog.ts');
const {
  miaodaHostedFinalUserActor,
} = require('../../server/modules/work-item/production-miaoda-browser-ingress.ts');
const schema = 'workspace_aadkpkjef3slu';
const authRole = `authenticated_${schema}`;
const manager = 'wiselink_model_settings_manager';
const modelRef = 'miaoda/glm-5.3';
// Mirrors the verified workspace pg_default_acl. PostgreSQL also adds PUBLIC.
const platformFunctionExecuteRoles = [
  'service_role',
  'authenticated',
  `service_role_${schema}`,
  authRole,
  `anon_${schema}`,
];
const source = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
const sqlError = (code, message) => (error) => {
  for (let cause = error; cause; cause = cause.cause)
    if (cause.code === code && (!message || cause.message === message))
      return true;
  return false;
};

test(
  'model settings RPC uses trusted actor scope without granting table or parser writes',
  { timeout: 60000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const admin = owned.admin;
    const fixtureEnvironment = [
      CANONICAL_MODEL_MANAGER_ROLE_ENV,
      'SANDBOX_ID',
      'MIAODA_LOCAL_DEV',
    ];
    const previousEnvironment = Object.fromEntries(
      fixtureEnvironment.map((key) => [key, process.env[key]]),
    );
    process.env[CANONICAL_MODEL_MANAGER_ROLE_ENV] = manager;
    process.env.SANDBOX_ID = 'model-settings-owned-pg-fixture';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      const applicationUser = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await admin.unsafe(`
      CREATE ROLE dataloom_user NOLOGIN NOSUPERUSER BYPASSRLS;
      CREATE ROLE ${authRole} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon_${schema} NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE service_role_${schema} NOLOGIN NOSUPERUSER BYPASSRLS;
      CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE service_role NOLOGIN NOSUPERUSER BYPASSRLS;
      CREATE ROLE ${applicationUser} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
      GRANT ${platformFunctionExecuteRoles.join(', ')} TO ${applicationUser};
      CREATE SCHEMA ${schema} AUTHORIZATION dataloom_user;
      SET ROLE dataloom_user;
      SET search_path = ${schema};
      -- Production pg_catalog readback: one attribute, user_id character varying.
      CREATE TYPE user_profile AS (user_id character varying);
      ALTER DEFAULT PRIVILEGES FOR ROLE dataloom_user IN SCHEMA ${schema}
        GRANT EXECUTE ON FUNCTIONS TO ${platformFunctionExecuteRoles.join(', ')};
      CREATE TABLE identity_subject_mapping (
        miaoda_user_id varchar NOT NULL, miaoda_tenant_id varchar NOT NULL,
        expected_client_id varchar NOT NULL, status varchar NOT NULL
      );
      INSERT INTO identity_subject_mapping VALUES
        ('actor-a', 'tenant-a', 'cli_aadde8b579f95bc9', 'ACTIVE'),
        ('actor-b', 'tenant-b', 'cli_aadde8b579f95bc9', 'ACTIVE'),
        ('inactive', 'tenant-a', 'cli_aadde8b579f95bc9', 'DISABLED'),
        ('wrong-client', 'tenant-a', 'other-client', 'ACTIVE'),
        ('actor-a', 'tenant-race', 'cli_aadde8b579f95bc9', 'ACTIVE');
    `);
      const aliases = (ddl) =>
        ddl
          .replace(/\bTO authenticated\b/g, `TO ${authRole}`)
          .replace(/\bTO service_role\b/g, `TO service_role_${schema}`);
      // Use real table/default/policy definitions, not a replacement settings schema.
      await admin.unsafe(
        aliases(
          await source('server/database/canonical-model-setting.ddl.sql'),
        ),
      );
      await admin.unsafe(
        await source('server/database/document-parsing-settings.ddl.sql'),
      );
      const catalogMigration = await source(
        'migrations/0014_engineering_matter_catalog.sql',
      );
      const helper = catalogMigration.match(
        /CREATE OR REPLACE FUNCTION engineering_matter_actor_has_tenant\([\s\S]+?\$\$;/,
      )?.[0];
      assert.ok(helper, 'real tenant helper definition must be loaded');
      await admin.unsafe(helper);
      await admin.unsafe(
        aliases(
          await source(
            'migrations/0057_model_setting_authenticated_tenant_read.sql',
          ),
        ),
      );
      await admin.unsafe(`
      GRANT USAGE ON SCHEMA ${schema} TO ${platformFunctionExecuteRoles.join(', ')};
      GRANT SELECT, INSERT, UPDATE, DELETE ON canonical_model_setting TO ${authRole};
      CREATE SEQUENCE rpc_temp_view_canary;
    `);
      const policySnapshot = async () => admin`
      SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = ${schema} AND tablename = 'canonical_model_setting' ORDER BY policyname
    `;
      const aclSnapshot = async () => admin`
      SELECT relacl::text AS acl, relrowsecurity AS rls, relforcerowsecurity AS force_rls
      FROM pg_class WHERE oid = 'workspace_aadkpkjef3slu.canonical_model_setting'::regclass
    `;
      const baselinePolicies = await policySnapshot();
      const baselineAcl = await aclSnapshot();
      const defaultFunctionAcl = () => admin`
        SELECT defaclacl::text AS acl FROM pg_default_acl
        WHERE defaclnamespace = 'workspace_aadkpkjef3slu'::regnamespace
          AND defaclrole = 'dataloom_user'::regrole AND defaclobjtype = 'f'
      `;
      const baselineDefaultFunctionAcl = await defaultFunctionAcl();
      const forward = await source(
        'migrations/0075_canonical_model_setting_manager_rpc.sql',
      );
      await admin.unsafe(forward);
      await admin.unsafe('RESET ROLE');
      const client = await owned.connect(applicationUser);
      const second = await owned.connect(applicationUser);
      const ownerClient = await owned.connect();
      const scoped = (
        connection,
        operation,
        {
          actor = 'actor-a',
          roles = manager,
          role = authRole,
          ownerSession = false,
        } = {},
      ) =>
        drizzle(connection).transaction(async (database) => {
          // Use Drizzle's real transaction for repository calls; its native SQL
          // client is used only for fixture DDL, policy probes and savepoints.
          const tx = database.session.client;
          if (ownerSession)
            await tx.unsafe('SET LOCAL SESSION AUTHORIZATION dataloom_user');
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          await tx.unsafe(`SET LOCAL search_path = ${schema}, pg_catalog`);
          await tx`SELECT set_config('app.user_id', ${actor}, true), set_config('app.role_ids', ${roles}, true), set_config('statement_timeout', '5000', true), set_config('lock_timeout', '5000', true)`;
          return operation(tx, new CanonicalModelSettingsRepository(database));
        });
      const update = (connection, expectedRevision, changes = {}, context) =>
        scoped(
          connection,
          (_tx, repo) =>
            repo.compareAndSet({
              tenantId: 'tenant-a',
              modelRef,
              expectedRevision,
              actorUserId: 'caller-must-not-control-audit',
              ...changes,
            }),
          context,
        );
      const snapshot = () => admin`
      SELECT tenant_id, model_ref, revision, changed_by_user_id,
        (_created_by).user_id AS created_by, (_updated_by).user_id AS updated_by,
        _created_at, _updated_at, local_mineru_fallback_enabled, title_enhancement_enabled
      FROM workspace_aadkpkjef3slu.canonical_model_setting ORDER BY tenant_id
    `;

      await t.test(
        'runtime is non-owner without RLS bypass; migration changes no table grants or policies',
        async () => {
          const runtime = await scoped(client, async (tx) => {
            const [runtime] =
              await tx`SELECT current_user AS user_name, current_setting('row_security') AS rls, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
            assert.deepEqual(runtime, {
              user_name: authRole,
              rls: 'on',
              rolsuper: false,
              rolbypassrls: false,
            });
            return runtime;
          });
          assert.deepEqual(await policySnapshot(), baselinePolicies);
          assert.deepEqual(await aclSnapshot(), baselineAcl);
          assert.deepEqual(
            await defaultFunctionAcl(),
            baselineDefaultFunctionAcl,
          );
          const [rpc] = await admin`
        SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS definer, proconfig,
          has_function_privilege(${authRole}, oid, 'EXECUTE') AS authenticated_execute,
          has_function_privilege(${`anon_${schema}`}, oid, 'EXECUTE') AS anon_execute,
          has_function_privilege(${`service_role_${schema}`}, oid, 'EXECUTE') AS service_execute,
          has_function_privilege('authenticated', oid, 'EXECUTE') AS global_authenticated_execute,
          has_function_privilege('service_role', oid, 'EXECUTE') AS global_service_execute
        FROM pg_proc WHERE oid = 'workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(varchar,varchar,integer)'::regprocedure
      `;
          assert.deepEqual(rpc, {
            owner: 'dataloom_user',
            definer: true,
            proconfig: [
              'search_path=pg_catalog, workspace_aadkpkjef3slu, pg_temp',
            ],
            authenticated_execute: true,
            anon_execute: true,
            service_execute: true,
            global_authenticated_execute: true,
            global_service_execute: true,
          });
          const grants =
            await admin`SELECT acl.grantee, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee_name, acl.privilege_type, acl.is_grantable FROM pg_proc AS rpc, LATERAL aclexplode(rpc.proacl) AS acl WHERE rpc.oid = 'workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(varchar,varchar,integer)'::regprocedure`;
          assert.deepEqual(
            grants.map((entry) => entry.grantee_name).sort(),
            ['PUBLIC', 'dataloom_user', ...platformFunctionExecuteRoles].sort(),
          );
          const roleMembership = await admin.unsafe(`SELECT rolname,
            pg_has_role(oid, '${authRole}'::regrole, 'MEMBER') AS target_role_member
            FROM pg_roles WHERE rolname IN (${platformFunctionExecuteRoles.map((role) => `'${role}'`).join(',')})
            ORDER BY rolname`);
          assert.ok(
            roleMembership.every(
              (entry) =>
                entry.target_role_member === (entry.rolname === authRole),
            ),
          );
          const attributes =
            await admin`SELECT attname, format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid = (SELECT typrelid FROM pg_type WHERE oid = 'workspace_aadkpkjef3slu.user_profile'::regtype) AND attnum > 0 AND NOT attisdropped ORDER BY attnum`;
          assert.deepEqual(
            [...attributes],
            [{ attname: 'user_id', type: 'character varying' }],
          );
          t.diagnostic(
            JSON.stringify({
              isolatedPostgres: owned.expected,
              runtime,
              rpc,
              functionAcl: [...grants],
              roleMembership: [...roleMembership],
              platformDefaultFunctionAclUnchanged: true,
              userProfileAttributes: [...attributes],
              tablePoliciesUnchanged: true,
              tableAclUnchanged: true,
            }),
          );
        },
      );

      await t.test(
        'authorized Host service saves GLM with real composite audit, timestamp mapping and parser defaults',
        async () => {
          const identity = miaodaHostedFinalUserActor({
            userId: 'actor-a',
            tenantId: 'tenant-a',
            appId: 'app_17bzc551rsg',
            env: 'runtime',
            roles: [manager],
          });
          const actor = {
            userId: 'actor-a',
            tenantId: 'tenant-a',
            appId: 'app_17bzc551rsg',
            env: 'runtime',
            roles: [manager],
            objectAccessActor: identity,
          };
          const result = await scoped(client, (_tx, repo) =>
            new CanonicalModelSettingsService(repo).update(
              { expectedRevision: 0, modelRef },
              actor,
            ),
          );
          assert.equal(result.revision, 1);
          assert.equal(result.selectedModelRef, modelRef);
          assert.equal(result.canManage, true);
          assert.ok(Number.isFinite(Date.parse(result.updatedAt)));
          const [row] = await snapshot();
          assert.equal(row.changed_by_user_id, 'actor-a');
          assert.equal(row.created_by, 'actor-a');
          assert.equal(row.updated_by, 'actor-a');
          assert.equal(row.local_mineru_fallback_enabled, true);
          assert.equal(row.title_enhancement_enabled, false);
          const readback = await scoped(client, (_tx, repo) =>
            repo.read('tenant-a'),
          );
          assert.equal(readback.revision, 1);
          assert.ok(readback.updatedAt instanceof Date);
        },
      );

      await t.test(
        'update derives actor from platform GUC and preserves saved parser flags and creation audit',
        async () => {
          await admin`UPDATE workspace_aadkpkjef3slu.canonical_model_setting SET local_mineru_fallback_enabled = false, title_enhancement_enabled = true WHERE tenant_id = 'tenant-a'`;
          const [before] = await snapshot();
          const saved = await update(client, 1, {
            modelRef: 'dli/gpt-5.6-sol',
          });
          assert.equal(saved.revision, 2);
          assert.ok(saved.updatedAt instanceof Date);
          const [after] = await snapshot();
          assert.equal(after.changed_by_user_id, 'actor-a');
          assert.equal(after.updated_by, 'actor-a');
          assert.equal(after.created_by, before.created_by);
          assert.deepEqual(after._created_at, before._created_at);
          assert.equal(after.local_mineru_fallback_enabled, false);
          assert.equal(after.title_enhancement_enabled, true);
        },
      );

      await t.test(
        'only exact manager CSV membership permits the operation',
        async () => {
          const before = await snapshot();
          for (const roles of [
            '',
            'wiselink_development',
            `prefix_${manager}`,
            `${manager}_suffix`,
            `other,${manager}_suffix`,
            `${manager} `,
          ]) {
            await assert.rejects(
              update(client, 2, {}, { roles }),
              sqlError('42501'),
            );
          }
          assert.deepEqual(await snapshot(), before);
          assert.equal(
            (
              await update(
                client,
                2,
                {},
                { roles: `other,${manager},wiselink_development` },
              )
            ).revision,
            3,
          );
        },
      );

      await t.test(
        'missing actor, inactive mapping, wrong client and cross-tenant remain denied',
        async () => {
          const before = await snapshot();
          for (const actor of [
            '',
            ' ',
            'unmapped',
            'inactive',
            'wrong-client',
            'actor-b',
          ]) {
            await assert.rejects(
              update(client, 3, {}, { actor }),
              sqlError('42501'),
            );
          }
          await assert.rejects(
            update(client, 0, { tenantId: 'tenant-b' }),
            sqlError('42501'),
          );
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        'roles with platform EXECUTE receive custom rejection before any table access',
        async () => {
          const before = await snapshot();
          // Instrument the real schema only inside the owned fixture. A mapping
          // read or settings DML increments a non-transactional sequence, so a
          // rejected/rolled-back RPC cannot hide access before its role guard.
          await admin.unsafe(`SET ROLE dataloom_user;
            CREATE SEQUENCE ${schema}.rpc_role_guard_canary;
            CREATE FUNCTION ${schema}.rpc_mapping_access_canary() RETURNS boolean LANGUAGE plpgsql AS $canary$
            BEGIN PERFORM pg_catalog.nextval('${schema}.rpc_role_guard_canary'); RETURN true; END; $canary$;
            CREATE FUNCTION ${schema}.rpc_settings_access_canary() RETURNS trigger LANGUAGE plpgsql AS $canary$
            BEGIN PERFORM pg_catalog.nextval('${schema}.rpc_role_guard_canary'); RETURN NULL; END; $canary$;
            ALTER TABLE ${schema}.identity_subject_mapping RENAME TO rpc_mapping_baseline;
            CREATE VIEW ${schema}.identity_subject_mapping AS
              SELECT * FROM ${schema}.rpc_mapping_baseline WHERE ${schema}.rpc_mapping_access_canary();
            CREATE TRIGGER rpc_settings_access_canary BEFORE INSERT OR UPDATE OR DELETE
              ON ${schema}.canonical_model_setting FOR EACH STATEMENT
              EXECUTE FUNCTION ${schema}.rpc_settings_access_canary();
            RESET ROLE;
          `);
          const counter = async () =>
            (
              await admin`SELECT last_value, is_called FROM workspace_aadkpkjef3slu.rpc_role_guard_canary`
            )[0];
          const rejected = [];
          try {
            // Positive control: a permitted caller reaches the canary even
            // though revision-zero CAS loses against the already saved row.
            assert.equal(
              (
                await scoped(
                  client,
                  (tx) =>
                    tx`SELECT * FROM workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set('tenant-a',${modelRef},0)`,
                )
              ).length,
              0,
            );
            assert.equal((await counter()).is_called, true);
            await admin.unsafe(
              `ALTER SEQUENCE ${schema}.rpc_role_guard_canary RESTART WITH 1`,
            );
            const contexts = [
              ...platformFunctionExecuteRoles
                .filter((role) => role !== authRole)
                .map((role) => ({ connection: client, role })),
              { connection: ownerClient, role: 'dataloom_user' },
              { connection: ownerClient, role: 'none', ownerSession: true },
            ];
            for (const { connection, ...context } of contexts) {
              let identity;
              await assert.rejects(
                scoped(
                  connection,
                  async (tx) => {
                    [identity] =
                      await tx`SELECT current_user AS user_name, session_user AS session_user_name, current_setting('role') AS active_role`;
                    return tx`SELECT * FROM workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set('tenant-a',${modelRef},3)`;
                  },
                  context,
                ),
                sqlError('42501', 'MODEL_SETTINGS_MANAGER_REQUIRED'),
              );
              if (context.ownerSession)
                assert.deepEqual(identity, {
                  user_name: 'dataloom_user',
                  session_user_name: 'dataloom_user',
                  active_role: 'none',
                });
              assert.deepEqual(await counter(), {
                last_value: '1',
                is_called: false,
              });
              rejected.push({
                ...identity,
                customError: 'MODEL_SETTINGS_MANAGER_REQUIRED',
                tableAccessCanaryCalls: 0,
              });
            }
            t.diagnostic(
              JSON.stringify({
                roleGuardCanary: {
                  positiveControlTouchedTables: true,
                  rejectedCallers: rejected,
                },
              }),
            );
          } finally {
            await admin.unsafe(`SET ROLE dataloom_user;
              DROP TRIGGER rpc_settings_access_canary ON ${schema}.canonical_model_setting;
              DROP VIEW ${schema}.identity_subject_mapping;
              ALTER TABLE ${schema}.rpc_mapping_baseline RENAME TO identity_subject_mapping;
              DROP FUNCTION ${schema}.rpc_mapping_access_canary();
              DROP FUNCTION ${schema}.rpc_settings_access_canary();
              DROP SEQUENCE ${schema}.rpc_role_guard_canary;
              RESET ROLE;
            `);
          }
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        'direct INSERT, UPDATE, DELETE and parsing-column edits remain unavailable even to manager',
        async () => {
          const before = await snapshot();
          await assert.rejects(
            scoped(
              client,
              (tx) =>
                tx`INSERT INTO workspace_aadkpkjef3slu.canonical_model_setting (tenant_id,model_ref,revision,changed_by_user_id,_created_by,_updated_by) VALUES ('tenant-direct',${modelRef},1,'forged',ROW('forged')::workspace_aadkpkjef3slu.user_profile,ROW('forged')::workspace_aadkpkjef3slu.user_profile)`,
            ),
            sqlError('42501'),
          );
          await scoped(client, async (tx) => {
            assert.equal(
              (
                await tx`UPDATE workspace_aadkpkjef3slu.canonical_model_setting SET model_ref = 'dli/gpt-5.6-sol', changed_by_user_id = 'forged' WHERE tenant_id = 'tenant-a' RETURNING tenant_id`
              ).length,
              0,
            );
            assert.equal(
              (
                await tx`UPDATE workspace_aadkpkjef3slu.canonical_model_setting SET local_mineru_fallback_enabled = true, title_enhancement_enabled = false WHERE tenant_id = 'tenant-a' RETURNING tenant_id`
              ).length,
              0,
            );
            assert.equal(
              (
                await tx`DELETE FROM workspace_aadkpkjef3slu.canonical_model_setting WHERE tenant_id = 'tenant-a' RETURNING tenant_id`
              ).length,
              0,
            );
          });
          await assert.rejects(
            scoped(
              client,
              (tx) =>
                tx`SELECT * FROM workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set('tenant-a',${modelRef},3,'forged',false)`,
            ),
            sqlError('42883'),
          );
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        'registered-model SQL allowlist stays synchronized and rejects invalid revision/input',
        async () => {
          const sqlAllowlist = forward.match(
            /ARRAY\[([\s\S]+?)\]::varchar\[\]/,
          )?.[1];
          assert.ok(sqlAllowlist);
          const refs = [...sqlAllowlist.matchAll(/'([^']+)'/g)].map(
            (match) => match[1],
          );
          const registered = CANONICAL_REGISTERED_MODELS.filter(
            (option) => option.available,
          ).map((option) => option.modelRef);
          assert.deepEqual(refs, registered);
          let revision = 3;
          for (const ref of registered)
            assert.equal(
              (await update(client, revision++, { modelRef: ref })).revision,
              revision,
            );
          const before = await snapshot();
          for (const changes of [
            { modelRef: 'other/model' },
            { modelRef: null },
            { expectedRevision: -1 },
            { expectedRevision: null },
            { expectedRevision: 2147483647 },
            { tenantId: '' },
          ]) {
            await assert.rejects(
              update(client, revision, changes),
              sqlError('22023'),
            );
          }
          assert.deepEqual(await snapshot(), before);
        },
      );

      await t.test(
        'stale and concurrent updates keep the existing 409 CAS contract',
        async () => {
          const [before] = await snapshot();
          await assert.rejects(update(client, before.revision - 1), {
            code: 'MODEL_SETTINGS_REVISION_CONFLICT',
            statusCode: 409,
          });
          const results = await Promise.allSettled([
            update(client, before.revision),
            update(second, before.revision, { modelRef: 'dli/gpt-5.6-sol' }),
          ]);
          assert.equal(
            results.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          const failed = results.find(
            (result) => result.status === 'rejected',
          ).reason;
          assert.equal(failed.code, 'MODEL_SETTINGS_REVISION_CONFLICT');
          assert.equal(failed.statusCode, 409);
          assert.equal((await snapshot())[0].revision, before.revision + 1);
        },
      );

      await t.test(
        'concurrent initial insert has exactly one winner',
        async () => {
          const results = await Promise.allSettled([
            update(client, 0, { tenantId: 'tenant-race' }),
            update(second, 0, {
              tenantId: 'tenant-race',
              modelRef: 'dli/gpt-5.6-sol',
            }),
          ]);
          assert.equal(
            results.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          assert.equal(
            results.find((result) => result.status === 'rejected').reason.code,
            'MODEL_SETTINGS_REVISION_CONFLICT',
          );
          const rows = (await snapshot()).filter(
            (row) => row.tenant_id === 'tenant-race',
          );
          assert.equal(rows.length, 1);
          assert.equal(rows[0].revision, 1);
        },
      );

      await t.test(
        'temporary mapping view cannot execute a canary as definer before tenant rejection',
        async () => {
          await scoped(
            client,
            async (tx) => {
              await tx.unsafe(`
          CREATE FUNCTION pg_temp.rpc_mapping_canary() RETURNS varchar LANGUAGE plpgsql AS $canary$
          BEGIN
            IF current_user <> 'dataloom_user' THEN RAISE EXCEPTION 'CANARY_REQUIRES_DEFINER'; END IF;
            PERFORM pg_catalog.nextval('${schema}.rpc_temp_view_canary');
            RETURN 'unmapped';
          END; $canary$;
          CREATE TEMP VIEW identity_subject_mapping AS
            SELECT pg_temp.rpc_mapping_canary() AS miaoda_user_id,
              'tenant-a'::varchar AS miaoda_tenant_id,
              'cli_aadde8b579f95bc9'::varchar AS expected_client_id,
              'ACTIVE'::varchar AS status;
          GRANT SELECT ON pg_temp.identity_subject_mapping TO dataloom_user;
        `);
              // Demonstrate the legacy-helper risk in this isolated copy. Sequence
              // increments survive savepoint rollback, detecting even rejected writes.
              assert.equal(
                (
                  await tx`SELECT workspace_aadkpkjef3slu.engineering_matter_actor_has_tenant('tenant-a') AS allowed`
                )[0].allowed,
                true,
              );
              assert.equal(
                (
                  await admin`SELECT last_value FROM workspace_aadkpkjef3slu.rpc_temp_view_canary`
                )[0].last_value,
                '1',
              );
              await assert.rejects(
                tx.savepoint(
                  (savepoint) =>
                    savepoint`SELECT * FROM workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set('tenant-a',${modelRef},1)`,
                ),
                sqlError('42501'),
              );
              assert.equal(
                (
                  await admin`SELECT last_value FROM workspace_aadkpkjef3slu.rpc_temp_view_canary`
                )[0].last_value,
                '1',
                'RPC must never execute the temporary view',
              );
              t.diagnostic(
                JSON.stringify({
                  temporaryViewCanary: {
                    legacyHelperExecutedAsOwner: true,
                    sequenceBeforeRpc: '1',
                    sequenceAfterRejectedRpc: '1',
                    rpcTouchedTemporaryView: false,
                  },
                }),
              );
              await tx.unsafe(
                'DROP VIEW pg_temp.identity_subject_mapping; DROP FUNCTION pg_temp.rpc_mapping_canary()',
              );
            },
            { actor: 'unmapped' },
          );
        },
      );

      await t.test(
        'qualified RPC ignores a temporary settings table and caller search_path',
        async () => {
          const [before] = await snapshot();
          await scoped(client, async (tx, repo) => {
            await tx.unsafe(
              `CREATE TEMP TABLE canonical_model_setting (tenant_id varchar, model_ref varchar, revision integer); SET LOCAL search_path = pg_temp, public`,
            );
            const saved = await repo.compareAndSet({
              tenantId: 'tenant-a',
              modelRef,
              expectedRevision: before.revision,
              actorUserId: 'forged',
            });
            assert.equal(saved.revision, before.revision + 1);
            assert.equal(
              (await tx`SELECT * FROM pg_temp.canonical_model_setting`).length,
              0,
            );
            await tx.unsafe('DROP TABLE pg_temp.canonical_model_setting');
          });
          assert.equal((await snapshot())[0].revision, before.revision + 1);
        },
      );

      await t.test(
        'rollback removes only the RPC and keeps saved rows and original RLS/ACLs',
        async () => {
          const before = await snapshot();
          await admin.unsafe(
            `SET ROLE dataloom_user; SET search_path = ${schema}`,
          );
          await admin.unsafe(
            await source(
              'migrations/rollback/0075_canonical_model_setting_manager_rpc.sql',
            ),
          );
          await admin.unsafe('RESET ROLE');
          assert.equal(
            (
              await admin`SELECT to_regprocedure('workspace_aadkpkjef3slu.canonical_model_setting_compare_and_set(varchar,varchar,integer)') AS rpc`
            )[0].rpc,
            null,
          );
          assert.deepEqual(await snapshot(), before);
          assert.deepEqual(await policySnapshot(), baselinePolicies);
          assert.deepEqual(await aclSnapshot(), baselineAcl);
          await assert.rejects(update(client, 1), sqlError('42883'));
          assert.equal(
            (
              await scoped(
                client,
                (tx) =>
                  tx`UPDATE workspace_aadkpkjef3slu.canonical_model_setting SET model_ref = ${modelRef} WHERE tenant_id = 'tenant-a' RETURNING tenant_id`,
              )
            ).length,
            0,
          );
        },
      );
    } finally {
      for (const key of fixtureEnvironment) {
        if (previousEnvironment[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnvironment[key];
      }
      await owned.stop();
    }
  },
);
