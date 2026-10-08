import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  postgresCapability,
  startOwnedPostgres,
} from '../pg/owned-postgres-cluster.mjs';

const capability = await postgresCapability();
const scope = {
  tenantId: 'tenant-a',
  sourceKey: 'TDMS',
  sourceInstanceId: 'fixture-instance',
  scopeId: 'fixture-scope',
};
const sourceObservationRef = 'processing-observation-fixture';
const family = 'processing-family-fixture';

function processingSet(setRevisionRef, options = {}) {
  const value = {
    schemaVersion: 'wiselink.tdms-processing-set.v1',
    scope: { ...scope },
    setRevisionRef,
    processingFamilyRef: options.processingFamilyRef ?? family,
    cohortRef: options.cohortRef ?? 'cohort-0',
    processingObservationRef:
      options.processingObservationRef ?? sourceObservationRef,
    familyIdentityEvidenceRefs: ['family-proof'],
    cohortIdentityEvidenceRefs: ['cohort-proof'],
    predecessorCohortRef: null,
    successionEvidenceRefs: [],
    supersedesSetRevisionRef: null,
    rootBindings: [],
    rosterEvidenceRefs: ['roster-proof'],
    sourceRosterRevision: 'roster-0',
    captureRefs: ['capture-fixture'],
    observationWindow: {
      before: '2026-10-06T09:00:00.000Z',
      after: '2026-10-06T10:00:00.000Z',
    },
    membershipCoverage: 'PARTIAL',
    versionMappingCoverage: 'UNKNOWN',
    approvedBodyCaptureCoverage: 'UNKNOWN',
    approvalReadiness: 'UNKNOWN',
    sourceConsistency: 'UNKNOWN',
    sourceTransactionRef: null,
    currentness: 'CURRENT',
    currentnessEvidenceRefs: ['currentness-proof'],
    members: [],
    gaps: ['isolated storage fixture'],
  };
  return { ...value, ...options, scope: { ...scope } };
}

function dataForSet(value) {
  return JSON.stringify(value);
}
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
function personActor(id = 'fixture-user') {
  return {
    principalKind: 'FINAL_USER',
    transport: 'MIAODA_AUTHENTICATED_HTTP',
    canonicalSubject: { namespace: 'MIAODA_USER_ID', id },
    tenantId: scope.tenantId,
    applicationScopeId: 'app_17bzc551rsg',
    subjectDecision: {
      source: 'MIAODA_GATEWAY_USER_CONTEXT',
      applicationScopeId: 'app_17bzc551rsg',
      tenantId: scope.tenantId,
      version: 'fixture-only',
      decidedAt: '2026-10-06T10:00:00.000Z',
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
function sourceRecord(
  ref,
  kind = 'PROCESSING_SHEET',
  recordId = 'processing-fixture',
) {
  const now = '2026-10-06T10:00:00.000Z';
  const record = {
    recordRef: `record-${recordId}`,
    sourceRevisionRef: ref,
    recordKind: kind,
    sourceRecordId: recordId,
    sourceKey: scope.sourceKey,
    sourceInstanceId: scope.sourceInstanceId,
    title: 'Fixture processing sheet',
    fileType: null,
    sourceVersion: {
      rawRevision: 'R00',
      rawIteration: '1',
      confirmation: 'SOURCE_DECLARED',
    },
    businessVersion: null,
    state: { rawCode: 'Estimated', rawName: 'Estimated' },
    authors: [],
    observedAt: now,
    capturedAt: now,
    coverage: { status: 'COMPLETE', gaps: [], readback: 'CONSISTENT' },
    relatedDocumentVersionIds: [],
    fieldSelectors: [],
    sourceVerification: 'DECLARED_ONLY',
    currentness: 'SELECTED_HOST_OBSERVATION',
    captureRef: 'capture-fixture',
    sourceModifiedAt: null,
    rawFields: {},
    content: {},
    fieldProvenance: [],
    artifacts: [],
    unreadAttachments: [],
    selectedHead: true,
  };
  return { scope: { ...scope }, record };
}
function head(value, generation = 1) {
  return {
    scope: { ...value.scope },
    processingFamilyRef: value.processingFamilyRef,
    selectedSetRevisionRef: value.setRevisionRef,
    generation,
  };
}

test(
  'owned ephemeral PostgreSQL executes the additive two-table draft with FK, immutability, RLS, SQL CAS and transaction rollback',
  { skip: capability.available ? false : capability.reason, timeout: 120000 },
  async (t) => {
    const owned = await startOwnedPostgres(capability);
    const clients = [];
    try {
      const schema = `tdms_set_${randomUUID().replaceAll('-', '').slice(0, 14)}`;
      const badSchema = `${schema}_bad`;
      const appLogin = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      const sourceDdl = await readFile(
        new URL(
          '../../server/database/tdms-source-rebuild-v1.draft.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const setDdl = await readFile(
        new URL(
          '../../server/database/tdms-processing-set-v1.draft.sql',
          import.meta.url,
        ),
        'utf8',
      );
      const admin = owned.admin;
      await admin.unsafe(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${badSchema}`);
      await admin.unsafe(`SET search_path TO ${schema},pg_catalog`);
      await admin.unsafe(sourceDdl);
      await admin.unsafe(setDdl);
      const tableRows = await admin`
        SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,
          (SELECT count(*)::int FROM pg_policy WHERE polrelid=c.oid) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=${schema} AND c.relname IN ('tdms_processing_revision_set','tdms_processing_set_head')
      `;
      assert.equal(tableRows.length, 2);
      assert.ok(
        tableRows.every(
          (r) => r.relrowsecurity && r.relforcerowsecurity && r.policies === 0,
        ),
      );
      const indexRows = await admin`
        SELECT indexname FROM pg_indexes WHERE schemaname=${schema} AND indexname IN
          ('tdms_processing_set_family_cohort','tdms_processing_set_observation')
      `;
      assert.deepEqual(
        new Set(indexRows.map((r) => r.indexname)),
        new Set([
          'tdms_processing_set_family_cohort',
          'tdms_processing_set_observation',
        ]),
      );

      const parentData = JSON.stringify(sourceRecord(sourceObservationRef));
      await admin.unsafe(
        `INSERT INTO ${schema}.tdms_record_revision ` +
          `(tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data) ` +
          `VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb)`,
        [
          scope.tenantId,
          scope.sourceKey,
          scope.sourceInstanceId,
          scope.scopeId,
          sourceObservationRef,
          'record-processing-fixture',
          parentData,
        ],
      );
      const invalidSourceRef = 'source-observation-json-string';
      await admin.unsafe(
        `INSERT INTO ${schema}.tdms_record_revision ` +
          `(tenant_id,source_key,source_instance_id,scope_id,source_revision_ref,record_ref,data) ` +
          `VALUES ($1,$2,$3,$4,$5,$6,$7::text::jsonb)`,
        [
          scope.tenantId,
          scope.sourceKey,
          scope.sourceInstanceId,
          scope.scopeId,
          invalidSourceRef,
          'record-invalid-json-string',
          JSON.stringify('not-an-object'),
        ],
      );
      const [invalidSourceShape] = await admin.unsafe(
        `SELECT jsonb_typeof(data) AS json_type FROM ${schema}.tdms_record_revision WHERE source_revision_ref=$1`,
        [invalidSourceRef],
      );
      assert.equal(invalidSourceShape.json_type, 'string');
      const validSet = processingSet('set-seed');
      const validSetJson = dataForSet(validSet);
      await admin.unsafe(
        `INSERT INTO ${schema}.tdms_processing_revision_set ` +
          `(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data) ` +
          `VALUES ('tenant-a','TDMS','fixture-instance','fixture-scope','set-seed','${family}','cohort-0','${sourceObservationRef}','${validSetJson.replaceAll("'", "''")}'::jsonb)`,
      );
      async function assertNullSetMirrorRejected(ref, data) {
        const serialized = JSON.stringify(data);
        await assert.rejects(
          admin.unsafe(
            `INSERT INTO ${schema}.tdms_processing_revision_set ` +
              `(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data) ` +
              `VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text::jsonb)`,
            [
              scope.tenantId,
              scope.sourceKey,
              scope.sourceInstanceId,
              scope.scopeId,
              ref,
              family,
              'cohort-0',
              sourceObservationRef,
              serialized,
            ],
          ),
          (error) => databaseCode(error) === '23514',
        );
        const [remaining] = await admin.unsafe(
          `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_revision_set WHERE set_revision_ref=$1`,
          [ref],
        );
        assert.equal(remaining.n, 0, `${ref} must leave no stored row`);
      }
      await assertNullSetMirrorRejected('set-null-schema-version', {
        ...validSet,
        setRevisionRef: 'set-null-schema-version',
        schemaVersion: null,
      });
      await assertNullSetMirrorRejected('set-null-scope-tenant', {
        ...validSet,
        setRevisionRef: 'set-null-scope-tenant',
        scope: { ...scope, tenantId: null },
      });
      async function assertNullHeadMirrorRejected(ref, data) {
        const serialized = JSON.stringify(data);
        await assert.rejects(
          admin.unsafe(
            `INSERT INTO ${schema}.tdms_processing_set_head ` +
              `(tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data) ` +
              `VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text::jsonb)`,
            [
              scope.tenantId,
              scope.sourceKey,
              scope.sourceInstanceId,
              scope.scopeId,
              family,
              validSet.setRevisionRef,
              1,
              serialized,
            ],
          ),
          (error) => databaseCode(error) === '23514',
        );
        const [remaining] = await admin.unsafe(
          `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_set_head WHERE processing_family_ref=$1`,
          [family],
        );
        assert.equal(remaining.n, 0, `${ref} must leave no stored head`);
      }
      const validHead = head(validSet);
      await assertNullHeadMirrorRejected('head-null-generation', {
        ...validHead,
        generation: null,
      });
      await assertNullHeadMirrorRejected('head-null-selected-ref', {
        ...validHead,
        selectedSetRevisionRef: null,
      });

      const absentParent = processingSet('set-no-parent', {
        processingObservationRef: 'not-a-source-revision',
      });
      const absentParentSql = dataForSet(absentParent).replaceAll("'", "''");
      await assert.rejects(
        admin.unsafe(
          `INSERT INTO ${schema}.tdms_processing_revision_set ` +
            `(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data) ` +
            `VALUES ('tenant-a','TDMS','fixture-instance','fixture-scope','set-no-parent','${family}','cohort-0','not-a-source-revision','${absentParentSql}'::jsonb)`,
        ),
        (error) => databaseCode(error) === '23503',
      );
      await assert.rejects(
        admin.unsafe(
          `INSERT INTO ${schema}.tdms_processing_revision_set ` +
            `(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data) ` +
            `VALUES ('tenant-a','TDMS','fixture-instance','fixture-scope','set-json-string','${family}','cohort-0','${sourceObservationRef}','"not-an-object"'::jsonb)`,
        ),
        (error) => databaseCode(error) === '23514',
      );
      const [stringSetRows] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_revision_set WHERE set_revision_ref='set-json-string'`,
      );
      assert.equal(
        stringSetRows.n,
        0,
        'a jsonb scalar cannot bypass the root-object contract',
      );
      const absentSetHead = head(processingSet('not-a-set'));
      const absentHeadData = JSON.stringify(absentSetHead).replaceAll(
        "'",
        "''",
      );
      await assert.rejects(
        admin.unsafe(
          `INSERT INTO ${schema}.tdms_processing_set_head ` +
            `(tenant_id,source_key,source_instance_id,scope_id,processing_family_ref,selected_set_revision_ref,generation,data) ` +
            `VALUES ('tenant-a','TDMS','fixture-instance','fixture-scope','${family}','not-a-set',1,'${absentHeadData}'::jsonb)`,
        ),
        (error) => databaseCode(error) === '23503',
      );
      await assert.rejects(
        admin.unsafe(
          `UPDATE ${schema}.tdms_processing_revision_set SET data='{}'::jsonb WHERE set_revision_ref='set-seed'`,
        ),
        (error) =>
          String(error.message).includes('TDMS_PROCESSING_SET_IMMUTABLE'),
      );
      await assert.rejects(
        admin.unsafe(
          `DELETE FROM ${schema}.tdms_processing_revision_set WHERE set_revision_ref='set-seed'`,
        ),
        (error) =>
          String(error.message).includes('TDMS_PROCESSING_SET_IMMUTABLE'),
      );

      const existingRole =
        await admin`SELECT rolname FROM pg_roles WHERE rolname=${appLogin}`;
      assert.equal(
        existingRole.length,
        0,
        'never reuse or alter an existing PostgreSQL role',
      );
      await admin.unsafe(
        `CREATE ROLE ${appLogin} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`,
      );
      await admin.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${appLogin}`);
      await admin.unsafe(
        `GRANT SELECT,INSERT,UPDATE,DELETE ON ${schema}.tdms_processing_revision_set,${schema}.tdms_processing_set_head,${schema}.tdms_record_revision TO ${appLogin}`,
      );
      const denied = await owned.connect(appLogin);
      clients.push(denied);
      await denied.unsafe(`SET search_path TO ${schema},pg_catalog`);
      const [roleIdentity] =
        await denied`SELECT current_user,session_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`;
      assert.equal(roleIdentity.current_user, appLogin);
      assert.equal(roleIdentity.session_user, appLogin);
      assert.equal(roleIdentity.rolsuper, false);
      assert.equal(roleIdentity.rolbypassrls, false);
      const [hiddenBeforePolicy] =
        await denied`SELECT count(*)::int AS n FROM tdms_processing_revision_set`;
      assert.equal(
        hiddenBeforePolicy.n,
        0,
        'FORCE RLS with no policy hides stored sets from a non-owner',
      );
      await assert.rejects(
        denied.unsafe(
          `INSERT INTO tdms_processing_revision_set ` +
            `(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,processing_family_ref,cohort_ref,processing_observation_ref,data) ` +
            `VALUES ('tenant-a','TDMS','fixture-instance','fixture-scope','set-denied','${family}','cohort-0','${sourceObservationRef}','${validSetJson.replaceAll("'", "''")}'::jsonb)`,
        ),
        (error) => databaseCode(error) === '42501',
      );

      // A temporary tenant-scoped fixture policy lets the service execute against only this
      // self-created database. The draft itself still has no policies or grants.
      for (const table of [
        'tdms_record_revision',
        'tdms_processing_revision_set',
        'tdms_processing_set_head',
      ]) {
        await admin.unsafe(
          `CREATE POLICY fixture_tenant_scope ON ${schema}.${table} FOR ALL TO ${appLogin} USING (tenant_id=current_setting('app.fixture_tenant',true)) WITH CHECK (tenant_id=current_setting('app.fixture_tenant',true))`,
        );
      }
      const liveA = await owned.connect(appLogin);
      const liveB = await owned.connect(appLogin);
      clients.push(liveA, liveB);
      for (const client of [liveA, liveB]) {
        await client.unsafe(`SET search_path TO ${schema},pg_catalog`);
        await client`SELECT set_config('app.fixture_tenant',${scope.tenantId},false)`;
      }
      const [sourceRowShape] = await liveA.unsafe(
        `SELECT jsonb_typeof(data) AS json_type,data->'scope'->>'tenantId' AS stored_tenant ` +
          `FROM ${schema}.tdms_record_revision WHERE source_revision_ref='${sourceObservationRef}'`,
      );
      assert.deepEqual(sourceRowShape, {
        json_type: 'object',
        stored_tenant: scope.tenantId,
      });

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
        MiaodaTdmsProcessingSetRepository,
      } = require('../../server/modules/tdms-source/tdms-processing-set.repository.ts');
      const {
        TdmsProcessingSetService,
      } = require('../../server/modules/tdms-source/tdms-processing-set.service.ts');
      const auth = {
        available: true,
        assertScopeAccess: async ({
          actor: requested,
          scope: requestedScope,
        }) => {
          if (requested.tenantId !== requestedScope.tenantId)
            throw Object.assign(new Error('TDMS_SOURCE_NOT_FOUND'), {
              code: 'TDMS_SOURCE_NOT_FOUND',
            });
        },
        assertAccess: async () => {},
        compare: async () => ({
          cohort: 'SAME',
          roster: 'SAME',
          evidenceRefs: ['fixture-proof'],
        }),
      };
      const dbServices = [liveA, liveB].map(
        (client) =>
          new TdmsProcessingSetService(
            new MiaodaTdmsProcessingSetRepository(drizzle(client)),
            auth,
          ),
      );
      const appActor = personActor();
      const maskedFamily = 'processing-family-auth-mask';
      const selectedB = processingSet('set-auth-current-B', {
        processingFamilyRef: maskedFamily,
      });
      const retainedA = processingSet('set-auth-retained-A', {
        processingFamilyRef: maskedFamily,
        currentness: 'HISTORICAL',
        currentnessEvidenceRefs: ['historical-proof'],
      });
      let denySelectedBRead = false;
      let retainedAChecks = 0;
      let deniedSelectedBReadChecks = 0;
      const maskingAuth = {
        ...auth,
        assertAccess: async ({ action, set }) => {
          if (
            action === 'RETAIN' &&
            set.setRevisionRef === retainedA.setRevisionRef
          )
            retainedAChecks += 1;
          if (
            denySelectedBRead &&
            action === 'READ' &&
            set.setRevisionRef === selectedB.setRevisionRef
          ) {
            deniedSelectedBReadChecks += 1;
            throw Object.assign(new Error('TDMS_SOURCE_NOT_FOUND'), {
              code: 'TDMS_SOURCE_NOT_FOUND',
            });
          }
        },
      };
      const maskingService = new TdmsProcessingSetService(
        new MiaodaTdmsProcessingSetRepository(drizzle(liveA)),
        maskingAuth,
      );
      const selectedBReceipt = await maskingService.save(
        appActor,
        selectedB,
        null,
      );
      assert.equal(selectedBReceipt.disposition, 'SELECTED');
      assert.equal(
        selectedBReceipt.selectedSetRevisionRef,
        selectedB.setRevisionRef,
      );
      const retainedAReceipt = await maskingService.save(
        appActor,
        retainedA,
        1,
      );
      assert.equal(retainedAReceipt.disposition, 'HISTORY_ONLY');
      assert.equal(
        retainedAReceipt.selectedSetRevisionRef,
        selectedB.setRevisionRef,
      );
      denySelectedBRead = true;
      const replayReceipt = await maskingService.save(appActor, retainedA, 1);
      assert.deepEqual(replayReceipt, {
        setRevisionRef: retainedA.setRevisionRef,
        selectedSetRevisionRef: null,
        generation: null,
        disposition: 'REPLAY',
      });
      assert.ok(
        retainedAChecks >= 2,
        'the historical set remains RETAIN-authorized',
      );
      assert.equal(deniedSelectedBReadChecks, 1);
      assert.equal(
        JSON.stringify(replayReceipt).includes(selectedB.setRevisionRef),
        false,
      );
      const [retainedAStored] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_revision_set WHERE set_revision_ref=$1`,
        [retainedA.setRevisionRef],
      );
      const [maskedActualHead] = await admin.unsafe(
        `SELECT selected_set_revision_ref,generation FROM ${schema}.tdms_processing_set_head WHERE processing_family_ref=$1`,
        [maskedFamily],
      );
      assert.equal(retainedAStored.n, 1);
      assert.deepEqual(maskedActualHead, {
        selected_set_revision_ref: selectedB.setRevisionRef,
        generation: 1,
      });
      const invalidSourceCandidate = processingSet(
        'set-reject-invalid-source-json',
        {
          processingFamilyRef: 'processing-family-invalid-source',
          processingObservationRef: invalidSourceRef,
        },
      );
      await assert.rejects(
        dbServices[0].save(appActor, invalidSourceCandidate, null),
        (error) => databaseCode(error) === 'TDMS_SET_STORED_DATA_INVALID',
      );
      const [invalidSourceSetRows] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_revision_set WHERE set_revision_ref=$1`,
        [invalidSourceCandidate.setRevisionRef],
      );
      const [invalidSourceHeadRows] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_set_head WHERE processing_family_ref=$1`,
        [invalidSourceCandidate.processingFamilyRef],
      );
      assert.equal(invalidSourceSetRows.n, 0);
      assert.equal(invalidSourceHeadRows.n, 0);
      const createOne = processingSet('set-concurrent-a');
      const createTwo = processingSet('set-concurrent-b');
      const raced = await Promise.allSettled([
        dbServices[0].save(appActor, createOne, null),
        dbServices[1].save(appActor, createTwo, null),
      ]);
      const raceSummary = raced.map((result) =>
        result.status === 'fulfilled'
          ? { status: result.status, value: result.value }
          : {
              status: result.status,
              name: result.reason?.name,
              message: result.reason?.message,
              stack: result.reason?.stack,
              code: databaseCode(result.reason),
            },
      );
      assert.equal(
        raced.filter((r) => r.status === 'fulfilled').length,
        1,
        JSON.stringify(raceSummary),
      );
      const rejected = raced.find((r) => r.status === 'rejected');
      assert.equal(rejected?.status, 'rejected');
      assert.equal(
        rejected && databaseCode(rejected.reason),
        'TDMS_PROCESSING_SET_CAS_CONFLICT',
      );
      const [headRows] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_set_head WHERE processing_family_ref='${family}'`,
      );
      const [raceRows] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_revision_set WHERE processing_family_ref='${family}' AND set_revision_ref IN ('set-concurrent-a','set-concurrent-b')`,
      );
      assert.equal(headRows.n, 1);
      assert.equal(
        raceRows.n,
        1,
        'losing head CAS rolls its inserted set back in the same transaction',
      );

      const selectedRef = raced.find((r) => r.status === 'fulfilled').value
        .selectedSetRevisionRef;
      const selected =
        selectedRef === createOne.setRevisionRef ? createOne : createTwo;
      const opposite =
        selectedRef === createOne.setRevisionRef ? createTwo : createOne;
      await assert.rejects(
        dbServices[0].save(
          appActor,
          { ...selected, setRevisionRef: 'set-stale-generation' },
          null,
        ),
        (error) => databaseCode(error) === 'TDMS_PROCESSING_SET_CAS_CONFLICT',
      );
      assert.notEqual(opposite.setRevisionRef, selectedRef);

      let accessCalls = 0;
      const revokingAuth = {
        ...auth,
        assertAccess: async () => {
          accessCalls += 1;
          if (accessCalls === 2)
            throw Object.assign(new Error('TDMS_SOURCE_NOT_FOUND'), {
              code: 'TDMS_SOURCE_NOT_FOUND',
            });
        },
      };
      const rollbackService = new TdmsProcessingSetService(
        new MiaodaTdmsProcessingSetRepository(drizzle(liveA)),
        revokingAuth,
      );
      const rollbackCandidate = processingSet('set-revoked-before-commit', {
        processingFamilyRef: 'processing-family-rollback',
      });
      await assert.rejects(
        rollbackService.save(appActor, rollbackCandidate, null),
        (error) => databaseCode(error) === 'TDMS_SOURCE_NOT_FOUND',
      );
      const [rollbackRows] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_revision_set WHERE set_revision_ref='set-revoked-before-commit'`,
      );
      const [rollbackHeads] = await admin.unsafe(
        `SELECT count(*)::int AS n FROM ${schema}.tdms_processing_set_head WHERE processing_family_ref='processing-family-rollback'`,
      );
      assert.equal(
        rollbackRows.n,
        0,
        'late ACL revocation rolls back both immutable set and head',
      );
      assert.equal(rollbackHeads.n, 0);

      const [foreignRows] =
        await liveA`SELECT count(*)::int AS n FROM tdms_processing_revision_set WHERE tenant_id='tenant-b'`;
      assert.equal(foreignRows.n, 0, 'fixture policy is tenant scoped');
      await t.test(
        'service repository inserts, selects, and reads the saved current set through the selector seam',
        async () => {
          const selectedValue = await dbServices[0].readSelected(
            appActor,
            scope,
            family,
          );
          assert.ok(selectedValue);
          assert.equal(selectedValue.head.selectedSetRevisionRef, selectedRef);
          assert.equal(selectedValue.set.setRevisionRef, selectedRef);
        },
      );
      await t.test(
        'injected schema execution failure leaves the target schema without partial draft objects',
        async () => {
          await admin.unsafe(`SET search_path TO ${badSchema},pg_catalog`);
          await assert.rejects(
            admin.unsafe(
              setDdl.replace(
                'CREATE TABLE tdms_processing_set_head',
                'SELECT tdms_fixture_missing_function(); CREATE TABLE tdms_processing_set_head',
              ),
            ),
          );
          await admin.unsafe('ROLLBACK');
          const partial =
            await admin`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${badSchema} AND c.relname LIKE 'tdms_processing_%'`;
          assert.equal(partial.length, 0);
          await admin.unsafe(`SET search_path TO ${schema},pg_catalog`);
        },
      );
    } finally {
      for (const client of clients)
        await client.end({ timeout: 3 }).catch(() => {});
      await owned.stop();
    }
  },
);
