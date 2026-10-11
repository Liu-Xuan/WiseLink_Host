import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
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
  MiaodaTdmsSourceRepository,
} = require('../../server/modules/tdms-source/tdms-source.repository.ts');
const {
  TdmsSourceService,
} = require('../../server/modules/tdms-source/tdms-source.service.ts');
const {
  HostDecisionTdmsSourceAuthorization,
  UnconfiguredTdmsSourceAuthorization,
} = require('../../server/modules/tdms-source/tdms-source.authorization.ts');
const {
  prepareTdmsDailyMetadataImport,
} = require('../../server/modules/tdms-source/tdms-daily-metadata-contract.ts');
const {
  hash,
} = require('../../server/modules/tdms-source/tdms-source.validation.ts');
const { actor } = require('../unit/tdms-source/tdms-fixtures.ts');
const { nativeScope } = require('../unit/tdms-source/tdms-memory-double.ts');
const {
  syntheticDailyEnvelope,
} = require('../unit/tdms-source/tdms-daily-metadata.fixture.ts');

test(
  'daily receiver uses the existing physical immutable capture and exact request/SourceRef CAS',
  { timeout: 60000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const previousSandbox = process.env.SANDBOX_ID;
    try {
      const admin = owned.admin;
      const applicationLogin =
        'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
      await admin.unsafe(`
      CREATE ROLE ${applicationLogin} LOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE SCHEMA daily_receiver_fixture;
      SET search_path TO daily_receiver_fixture,pg_catalog;
    `);
      await admin.unsafe(
        await readFile(
          new URL(
            '../../server/database/tdms-source-rebuild-v1.draft.sql',
            import.meta.url,
          ),
          'utf8',
        ),
      );
      // Local test-only current tenant policy. No production provider/schema/role is configured.
      await admin.unsafe(`
      GRANT USAGE ON SCHEMA daily_receiver_fixture TO ${applicationLogin};
      GRANT SELECT, INSERT ON tdms_capture TO ${applicationLogin};
      CREATE POLICY daily_fixture_select ON tdms_capture FOR SELECT TO ${applicationLogin}
        USING (tenant_id=current_setting('app.tenant_id',true));
      CREATE POLICY daily_fixture_insert ON tdms_capture FOR INSERT TO ${applicationLogin}
        WITH CHECK (tenant_id=current_setting('app.tenant_id',true));
    `);
      const client = await owned.connect(applicationLogin);
      await client.unsafe(
        'SET search_path TO daily_receiver_fixture,pg_catalog',
      );
      await client`SELECT set_config('app.tenant_id','tenant-a',false)`;
      const [identity] =
        await client`SELECT current_user AS role, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`;
      assert.equal(identity.rolsuper, false);
      assert.equal(identity.rolbypassrls, false);
      t.diagnostic(
        `LOCAL_ONLY_NOBYPASS_RECEIVER ${JSON.stringify({ identity, owned: owned.identity })}`,
      );
      const repository = new MiaodaTdmsSourceRepository(drizzle(client));
      const envelope = syntheticDailyEnvelope(),
        prepared = prepareTdmsDailyMetadataImport(envelope);
      const grant = {
        scope: nativeScope,
        permissionRevision: 'fixture-current-1',
      };
      let readAllowed = true;
      // Explicit independent fixture allowlist, not an installed current Host/source authority.
      const authorization = new HostDecisionTdmsSourceAuthorization(
        async () => [grant],
        async () => ({
          ...grant,
          authorityRef: 'fixture-retain',
          captureRetentionAllowed: true,
          nativeProjectionAllowed: true,
          permittedMembers: prepared.memberClaims,
        }),
        async () => ({
          ...grant,
          authorityRef: 'fixture-read',
          retainedCaptureReadAllowed: true,
          permittedMembers: readAllowed
            ? prepared.memberClaims
            : { records: [], relationIds: [], artifacts: [] },
        }),
      );
      const artifacts = {
        acquire: async () => {
          throw new Error('unexpected artifact');
        },
      };
      const documents = {
        assertRead: async () => {
          throw new Error('unexpected document');
        },
      };
      const service = new TdmsSourceService(
        repository,
        authorization,
        artifacts,
        documents,
      );
      let receipt;
      await t.test(
        'unconfigured actual repository path is503 and inserts zero rows',
        async () => {
          const closed = new TdmsSourceService(
            repository,
            new UnconfiguredTdmsSourceAuthorization(),
            artifacts,
            documents,
          );
          await assert.rejects(closed.importDailyMetadata(actor(), envelope), {
            code: 'TDMS_SOURCE_AUTHORIZATION_UNCONFIGURED',
            statusCode: 503,
          });
          const [row] =
            await admin`SELECT count(*)::int AS n FROM daily_receiver_fixture.tdms_capture`;
          assert.equal(row.n, 0);
        },
      );
      await t.test(
        'JSONB stored readback is exact and creates no native projections or mappings',
        async () => {
          receipt = await service.importDailyMetadata(actor(), envelope);
          const result = await service.readDailyMetadataImport(
            actor(),
            envelope.requestId,
          );
          assert.deepEqual(result, { receipt, package: envelope.package });
          assert.equal(Object.keys(receipt).length, 10);
          for (const table of [
            'tdms_record',
            'tdms_record_revision',
            'tdms_relation',
            'tdms_relation_assertion',
          ]) {
            const [row] = await admin.unsafe(
              `SELECT count(*)::int AS n FROM daily_receiver_fixture.${table}`,
            );
            assert.equal(row.n, 0);
          }
        },
      );
      await t.test(
        'sequential idempotence is immutable; changed payload cannot reuse request',
        async () => {
          assert.deepEqual(
            await service.importDailyMetadata(actor(), envelope),
            receipt,
          );
          const changed = JSON.parse(JSON.stringify(envelope));
          changed.package.packageId = 'changed';
          await assert.rejects(service.importDailyMetadata(actor(), changed), {
            code: 'TDMS_DAILY_REQUEST_DIGEST_MISMATCH',
          });
          const [row] =
            await admin`SELECT count(*)::int AS n FROM daily_receiver_fixture.tdms_capture`;
          assert.equal(row.n, 1);
        },
      );
      await t.test(
        'actual SQL SourceRef membership and scope are exact, without substring/OR-VR inference',
        async () => {
          const ref = receipt.sourceRefs[0];
          assert.equal(
            (await service.readDailySourceRef(actor(), ref)).snapshot
              .snapshotId,
            envelope.package.records[0].snapshotId,
          );
          assert.equal(
            (
              await repository.transaction((tx) =>
                tx.capturesBySourceRef(nativeScope, ref),
              )
            ).length,
            1,
          );
          assert.equal(
            (
              await repository.transaction((tx) =>
                tx.capturesBySourceRef(nativeScope, ref.slice(0, -1)),
              )
            ).length,
            0,
          );
          assert.equal(
            (
              await repository.transaction((tx) =>
                tx.capturesBySourceRef(
                  { ...nativeScope, tenantId: 'tenant-b' },
                  ref,
                ),
              )
            ).length,
            0,
          );
          assert.equal(
            (
              await repository.transaction((tx) =>
                tx.capturesBySourceRef(nativeScope, "x' OR TRUE --"),
              )
            ).length,
            0,
          );
          readAllowed = false;
          await assert.rejects(service.readDailySourceRef(actor(), ref), {
            code: 'TDMS_READ_MEMBER_SCOPE_ADMISSION_REQUIRED',
          });
          readAllowed = true;
        },
      );
      await t.test(
        'two real transactions race the same request: one capture winner, no overwrite',
        async () => {
          const race = JSON.parse(JSON.stringify(envelope));
          race.package.packageId = 'TDMSEOPKG-synthetic-race';
          race.requestId = 'TDMSIMPORT-' + hash(race.package);
          let arrived = 0,
            release;
          const barrier = new Promise((resolve) => {
            release = resolve;
          });
          const competing = (r) => ({
            transaction: (fn) =>
              r.transaction((tx) =>
                fn(
                  new Proxy(tx, {
                    get(target, key) {
                      if (key === 'saveCapture')
                        return async (row) => {
                          if (++arrived === 2) release();
                          let timer;
                          try {
                            await Promise.race([
                              barrier,
                              new Promise((_, reject) => {
                                timer = setTimeout(
                                  () =>
                                    reject(
                                      new Error(
                                        'CAS fixture barrier timed out',
                                      ),
                                    ),
                                  5000,
                                );
                              }),
                            ]);
                          } finally {
                            clearTimeout(timer);
                          }
                          return target.saveCapture(row);
                        };
                      const value = Reflect.get(target, key);
                      return typeof value === 'function'
                        ? value.bind(target)
                        : value;
                    },
                  }),
                ),
              ),
          });
          const second = await owned.connect(applicationLogin);
          await second.unsafe(
            'SET search_path TO daily_receiver_fixture,pg_catalog',
          );
          await second`SELECT set_config('app.tenant_id','tenant-a',false)`;
          const racingService = new TdmsSourceService(
            competing(repository),
            authorization,
            artifacts,
            documents,
          );
          const secondService = new TdmsSourceService(
            competing(new MiaodaTdmsSourceRepository(drizzle(second))),
            authorization,
            artifacts,
            documents,
          );
          const results = await Promise.allSettled([
            racingService.importDailyMetadata(actor(), race),
            secondService.importDailyMetadata(actor(), race),
          ]);
          assert.equal(
            results.filter((r) => r.status === 'fulfilled').length,
            1,
          );
          const loser = results.find((r) => r.status === 'rejected');
          assert.equal(loser.reason.code, 'TDMS_PACKAGE_IDEMPOTENCY_CONFLICT');
          assert.equal(loser.reason.statusCode, 409);
          const saved = await service.readDailyMetadataImport(
            actor(),
            race.requestId,
          );
          assert.deepEqual(saved.package, race.package);
          const [row] =
            await admin`SELECT count(*)::int AS n FROM daily_receiver_fixture.tdms_capture WHERE package_id=${race.requestId}`;
          assert.equal(row.n, 1);
        },
      );
    } finally {
      await owned.stop();
      if (previousSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = previousSandbox;
    }
  },
);
