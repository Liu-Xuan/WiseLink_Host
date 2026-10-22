import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

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
  tdmsRuntimeFixture,
} = require('../unit/fixtures/tdms-runtime.fixture.ts');
const {
  MiaodaTdmsProcessingSetRepository,
} = require('../../server/modules/tdms-source/tdms-processing-set.repository.ts');
const {
  TdmsProcessingSetService,
} = require('../../server/modules/tdms-source/tdms-processing-set.service.ts');
const capability = await postgresCapability();

test(
  'actual processing-set metadata SQL excludes retained bodies before the driver returns; explicit revision READ retains them',
  { skip: capability.available ? false : capability.reason, timeout: 30000 },
  async () => {
    const owned = await startOwnedPostgres(capability);
    try {
      const fixture = tdmsRuntimeFixture();
      const { scope, set, actor } = fixture;
      const admin = owned.admin;
      const role = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await admin`CREATE SCHEMA metadata_fixture`;
      await admin`SET search_path TO metadata_fixture,pg_catalog`;
      for (const name of [
        'tdms-source-rebuild-v1.draft.sql',
        'tdms-processing-set-v1.draft.sql',
      ]) {
        await admin.unsafe(
          await readFile(
            new URL(`../../server/database/${name}`, import.meta.url),
            'utf8',
          ),
        );
      }
      for (const [ref, value] of fixture.revisions) {
        const stored = JSON.parse(JSON.stringify(value));
        stored.record.rawFields.privateUnstructuredBody =
          'RAW_BODY_MUST_STAY_IN_DATABASE';
        stored.attachmentAcquisitions = [
          { privateBody: 'ACQUISITION_MUST_STAY_IN_DATABASE' },
        ];
        await admin`INSERT INTO tdms_record_revision
          (tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data)
          VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},
            ${stored.record.recordRef},${JSON.stringify(stored)}::text::jsonb)`;
      }
      for (const [ref, value] of fixture.assertions) {
        await admin`INSERT INTO tdms_relation_assertion
          (tenant_id,source_key,source_instance_id,scope_id,assertion_ref,relation_ref,data)
          VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},
            ${value.assertion.relationRef},${JSON.stringify(value)}::text::jsonb)`;
      }
      await admin`INSERT INTO tdms_processing_revision_set
        (tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data)
        VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${set.setRevisionRef},
          ${set.processingFamilyRef},${set.cohortRef},${set.processingObservationRef},${JSON.stringify(set)}::text::jsonb)`;
      await admin.unsafe(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS`);
      await admin.unsafe(`GRANT USAGE ON SCHEMA metadata_fixture TO ${role}`);
      for (const table of [
        'tdms_record_revision',
        'tdms_relation_assertion',
        'tdms_processing_revision_set',
      ]) {
        await admin.unsafe(`GRANT SELECT ON ${table} TO ${role}`);
        await admin.unsafe(`CREATE POLICY fixture_tenant ON ${table} FOR SELECT TO ${role}
          USING (tenant_id=current_setting('app.fixture_tenant',true))`);
      }
      const client = await owned.connect(role);
      await client`SET search_path TO metadata_fixture,pg_catalog`;
      await client`SELECT set_config('app.fixture_tenant',${scope.tenantId},false)`;
      const rawResults = [];
      const database = drizzle(client);
      const observedDatabase = {
        transaction: (operation) =>
          database.transaction((tx) =>
            operation({
              execute: async (query) => {
                const result = await tx.execute(query);
                // Inspect the actual PG driver response, before repository decoding/projection.
                rawResults.push(JSON.stringify(result));
                return result;
              },
            }),
          ),
      };
      const repository = new MiaodaTdmsProcessingSetRepository(
        observedDatabase,
      );
      let checks = 0;
      const service = new TdmsProcessingSetService(repository, {
        available: true,
        assertScopeAccess: async ({ actor: current, scope: selected }) => {
          assert.equal(current.tenantId, selected.tenantId);
        },
        assertAccess: async ({ revisions }) => {
          checks += 1;
          assert.equal(revisions.length, fixture.revisions.size);
          for (const revision of revisions) {
            assert.equal(
              Object.hasOwn(revision.record, 'content'),
              false,
              'metadata authority must not receive content',
            );
            assert.equal(
              Object.hasOwn(revision, 'attachmentAcquisitions'),
              false,
            );
            assert.equal(
              Object.hasOwn(
                revision.record.rawFields,
                'privateUnstructuredBody',
              ),
              false,
            );
          }
        },
        compare: async () => {
          throw new Error('not used');
        },
      });
      assert.deepEqual(
        await service.readFrozen(actor, scope, set.setRevisionRef),
        set,
      );
      assert.equal(checks, 3);
      for (const body of [
        'Unique complete opinion',
        'RAW_BODY_MUST_STAY_IN_DATABASE',
        'ACQUISITION_MUST_STAY_IN_DATABASE',
      ]) {
        assert.equal(
          rawResults.some((value) => value.includes(body)),
          false,
          'metadata driver response must omit body bytes',
        );
      }
      rawResults.length = 0;
      const explicit = await repository.transaction((tx) =>
        tx.revision(scope.tenantId, 'a'),
      );
      assert.equal(
        explicit.record.content.opinions[0].text,
        'Unique complete opinion a',
      );
      assert.equal(
        rawResults.some((value) => value.includes('Unique complete opinion a')),
        true,
      );
      assert.equal(
        await repository.transaction((tx) =>
          tx.revisionMetadata('another-tenant', 'a'),
        ),
        null,
      );
      // Projection must not launder malformed storage into a valid metadata record.
      for (const [ref, data] of [
        ['bad-root', 'not an object'],
        ['bad-record', { scope, record: [] }],
        ['bad-raw-fields', { scope, record: { rawFields: 'not an object' } }],
      ]) {
        await admin`INSERT INTO tdms_record_revision
          (tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data)
          VALUES (${scope.tenantId},${scope.sourceKey},${scope.sourceInstanceId},${scope.scopeId},${ref},${ref},${JSON.stringify(data)}::text::jsonb)`;
        await assert.rejects(
          repository.transaction((tx) =>
            tx.revisionMetadata(scope.tenantId, ref),
          ),
          (error) => error.code === 'TDMS_SET_STORED_DATA_INVALID',
        );
      }
    } finally {
      await owned.stop();
    }
  },
);
