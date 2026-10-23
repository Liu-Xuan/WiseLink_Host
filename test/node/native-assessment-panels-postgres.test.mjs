import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS', moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const schema = require('../../server/database/schema.ts');
const { IdentityRepository } = require('../../server/modules/identity/identity.repository.ts');
const { SessionStore } = require('../../server/modules/identity/session.store.ts');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { MiaodaCanonicalWorkItemRegistrarAdapter } = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const { MiaodaHostedCanonicalObjectAccessAdapter } = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const { CanonicalObjectAccessRouter } = require('../../server/modules/work-item/canonical-object-access.router.ts');
const unavailable = require('../../server/modules/work-item/unavailable-canonical-object-access.adapters.ts');
const { DialogueBrowserScope } = require('../../server/modules/canonical-host/dialogue-browser-scope.service.ts');
const { CANONICAL_MIAODA_APP_ID } = require('../../server/modules/canonical-host/canonical-host.constants.ts');
const { ProductionMiaodaBrowserObjectIngressGuard } = require('../../server/modules/work-item/production-miaoda-browser-ingress.ts');
const { CanonicalFleetMasterDataRepository } = require('../../server/modules/canonical-host/canonical-fleet-master-data.repository.ts');
const { CanonicalHostApplicabilitySelectionService } = require('../../server/modules/canonical-host/canonical-host-applicability-selection.service.ts');
const { CanonicalHostApplicabilitySelectionController } = require('../../server/modules/canonical-host/canonical-host-applicability-selection.controller.ts');
const { ConfigurationEvidenceService } = require('../../server/modules/canonical-host/configuration-evidence/configuration-evidence.service.ts');
const { ConfigurationEvidenceController } = require('../../server/modules/canonical-host/configuration-evidence/configuration-evidence.controller.ts');
const { MiaodaConfigurationEvidenceStore } = require('../../server/modules/canonical-host/configuration-evidence/configuration-evidence.repository.ts');
const { MiaodaConfigurationEvidenceQueryStore } = require('../../server/modules/canonical-host/configuration-evidence/configuration-evidence-query.repository.ts');
const { initialProjection } = await import('./helpers/q1-review-postgres.fixture.mjs');

const databaseUrl = process.env.NATIVE_ASSESSMENT_PANELS_TEST_DATABASE_URL;
const options = { skip: !databaseUrl, concurrency: false, timeout: 20000 };
const ROLE = 'authenticated_wiselink_panels_test';
const TENANT = 'tenant-panels';
const ACTOR = 'actor-panels';
const OTHER_ACTOR = 'actor-panels-reader';
const WI = 'WI-native-panels';
const AS_OF = '2026-08-29T23:59:59.999Z';
const hash = 'a'.repeat(64);
const fleetTables = ['canonical_fleet_source_snapshot', 'canonical_fleet_scope_head',
  'canonical_fleet_asset_version', 'canonical_fleet_alias_version',
  'canonical_fleet_configuration_fact_version'];
const evidenceTables = ['configuration_evidence_snapshot_version',
  'configuration_evidence_event_version', 'configuration_evidence_fact_version',
  'configuration_evidence_predicate_trace_version', 'configuration_evidence_trace_staleness',
  'configuration_evidence_work_item_head', 'configuration_evidence_query_attempt'];

// Only synthetic engineer gap context and installation-event source I/O are
// substitutes. Controller, native scope, SDK SQL middleware, access adapter,
// registrar, fleet repository, query store and snapshot store are real.
// 0078's single-tenant shared SELECT predicate is mapped to this isolated role
// and tenant as a representative policy fixture, not an exact deployment of
// the prepared migration or evidence about the production gateway/policies.
async function resetDatabase(admin) {
  await admin.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')
        THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')
        THEN CREATE ROLE service_role NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${ROLE}')
        THEN CREATE ROLE ${ROLE} NOLOGIN IN ROLE authenticated; END IF;
    END $$;
    CREATE TYPE user_profile AS (user_id text);
    CREATE TABLE identity_subject_mapping (id uuid DEFAULT gen_random_uuid(),
      miaoda_user_id varchar, miaoda_tenant_id varchar,
      expected_client_id varchar, status varchar);
    ALTER TABLE identity_subject_mapping ENABLE ROW LEVEL SECURITY;`);
  const columns = getTableConfig(schema.workItem).columns.map(column =>
    `"${column.name}" ${column.getSQLType()}`);
  await admin.unsafe(`CREATE TABLE work_item (${columns.join(',')}, UNIQUE(work_item_id));
    ALTER TABLE work_item ENABLE ROW LEVEL SECURITY;`);
  const migration = await admin.reserve();
  try {
    const identity = await readFile(new URL('../../migrations/0005_identity_oauth_authenticated_rls.sql', import.meta.url), 'utf8');
    const identityPolicy = identity.match(/CREATE POLICY identity_subject_mapping_authenticated_oauth_read[\s\S]+?\n  \);/u);
    assert.ok(identityPolicy);
    await migration.unsafe(identityPolicy[0]);
    const owner = await readFile(new URL('../../migrations/0014_engineering_matter_catalog.sql', import.meta.url), 'utf8');
    for (const name of ['engineering_matter_actor_has_tenant', 'engineering_matter_work_item_owned_by_actor']) {
      const fn = owner.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]+?\\$\\$;`, 'u'));
      assert.ok(fn);
      await migration.unsafe(fn[0]);
    }
    for (const name of ['0011_canonical_fleet_master_data.sql',
      '0017_configuration_evidence_persistence.sql', '0020_configuration_evidence_candidate_query.sql']) {
      await migration.unsafe(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
    }
    const template = await readFile(new URL('../../migrations/0078_native_tenant_shared_read.sql', import.meta.url), 'utf8');
    const shared = template.match(/CREATE OR REPLACE FUNCTION native_app_shared_read_allowed\([\s\S]+?\$\$;/u);
    assert.ok(shared);
    await migration.unsafe(shared[0].replaceAll('authenticated_workspace_aadkpkjef3slu', ROLE)
      .replaceAll('63849986', TENANT));
  } finally { migration.release(); }
  await admin.unsafe(`CREATE POLICY panels_work_item_owner_update ON work_item
    FOR UPDATE TO authenticated USING (
      requested_by_user_id=current_setting('app.user_id',true)
      AND engineering_matter_actor_has_tenant(tenant_id))
    WITH CHECK (requested_by_user_id=current_setting('app.user_id',true)
      AND engineering_matter_actor_has_tenant(tenant_id));
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT ON identity_subject_mapping TO authenticated;
    GRANT SELECT,UPDATE ON work_item TO authenticated;`);
  for (const table of ['work_item', ...fleetTables, ...evidenceTables]) {
    await admin.unsafe(`CREATE POLICY panels_shared_select ON ${table}
      FOR SELECT TO ${ROLE} USING (native_app_shared_read_allowed(tenant_id));`);
  }
  await admin.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON
    ${[...fleetTables, ...evidenceTables].join(',')} TO authenticated`);
  await admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
    VALUES (${ACTOR},${TENANT},'cli_aadde8b579f95bc9','ACTIVE'),
      (${OTHER_ACTOR},${TENANT},'cli_aadde8b579f95bc9','ACTIVE')`;
  const current = { ...initialProjection(WI), revision: 7,
    package: { ...initialProjection(WI).package,
      contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2' } };
  await admin`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,
    revision,document_id,document_version_id,request_id,run_key,projection_json)
    VALUES (${WI},${TENANT},${ACTOR},7,'doc-job','dv-job',${current.requestId},
      'canonical',${JSON.stringify(current)})`;
  await admin`INSERT INTO canonical_fleet_source_snapshot(tenant_id,source_snapshot_id,
    source_kind,logical_source_key,source_revision_key,source_content_hash,source_as_of,
    snapshot_as_of,fleet_snapshot_digest,upstream_lineage_json,aircraft_asset_count,
    identity_alias_count,configuration_fact_count,imported_by_actor_id)
    VALUES (${TENANT},'FMS-panels','SYNTHETIC_LOCAL_FIXTURE','panels',
      'fleet-rev-1',${'sha256:' + hash},'2026-08-28',now(),${hash},'[]',1,0,0,${ACTOR})`;
  await admin`INSERT INTO canonical_fleet_scope_head(tenant_id,current_source_snapshot_id,authority_revision)
    VALUES (${TENANT},'FMS-panels',1)`;
  await admin`INSERT INTO canonical_fleet_asset_version(tenant_id,source_snapshot_id,
    asset_id,asset_version_id,aircraft_number,fleet_family,aircraft_model,msn,line_number,
    valid_from,status,source_record_id,record_hash,source_record_hash)
    VALUES (${TENANT},'FMS-panels','AIRCRAFT:panels','ASSET-panels-v1','B-2035',
      'B777','777-300ER','38674',1051,'2020-01-01','ACTIVE','fixture-record',
      ${'sha256:' + hash},${'sha256:' + hash})`;
  return current;
}

async function fixture(t) {
  const url = new URL(databaseUrl);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.match(url.pathname, /^\/wiselink_native_panels_test_[a-z0-9_]+$/u);
  const environment = { SANDBOX_ID: 'isolated-native-assessment-panels-pg',
    MIAODA_LOCAL_DEV: undefined, WL_APPLICABILITY_SELECTION_REVIEW_ACTION_ENABLED: '1',
    WL_OPENCLAW_SERVICE_WORK_ITEM_ID: 'WI-unrelated-primary',
    WL_OPENCLAW_SERVICE_ADDITIONAL_WORK_ITEM_IDS: JSON.stringify([WI]),
    WL_APPLICABILITY_SELECTION_REVIEW_SIGNING_KEY: 'isolated-synthetic-signing-key-for-native-panels' };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  let externalCalls = 0;
  const forbidExternal = () => { externalCalls += 1; throw new Error('UNEXPECTED_EXTERNAL_HTTP_OR_MODEL_CALL'); };
  const previousFetch = globalThis.fetch;
  globalThis.fetch = forbidExternal;
  const transports = [http, https].map(transport => {
    const saved = { request: transport.request, get: transport.get };
    transport.request = forbidExternal;
    transport.get = forbidExternal;
    return { transport, saved };
  });
  const admin = postgres(databaseUrl, { max: 1, onnotice() {} });
  const browserSql = postgres(databaseUrl, { max: 1, onnotice() {} });
  t.after(async () => {
    await browserSql.end({ timeout: 0 });
    await admin.end({ timeout: 0 });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = previousFetch;
    for (const { transport, saved } of transports) Object.assign(transport, saved);
    assert.equal(externalCalls, 0);
  });
  const initial = await resetDatabase(admin);
  const db = drizzle(browserSql);
  const context = new SqlExecutionContextMiddleware({ roleSchema: 'wiselink_panels_test' });
  const sessions = new SessionResolver(new SessionStore(new IdentityRepository(db)), {
    applicationScopeId: CANONICAL_MIAODA_APP_ID, sessionEnvironment: 'runtime',
  }, context);
  const scope = new DialogueBrowserScope(sessions);
  const request = { headers: {}, userContext: { userId: ACTOR, tenantId: TENANT,
    appId: CANONICAL_MIAODA_APP_ID, env: 'runtime', isSystemAccount: false, roles: [] } };
  const observations = [];
  async function observe(database = db, phase = 'store') {
    const [row] = await database.execute(sql`SELECT current_user AS role,
      current_setting('app.user_id',true) AS actor, rol.rolsuper AS superuser,
      rol.rolbypassrls AS bypass_rls, pg_has_role(current_user,'service_role','member') AS service_member,
      (SELECT bool_and(tableowner <> current_user) FROM pg_tables
        WHERE schemaname='public' AND tablename IN ('work_item','configuration_evidence_query_attempt',
          'configuration_evidence_snapshot_version')) AS not_owner
      FROM pg_roles rol WHERE rol.rolname=current_user`);
    assert.deepEqual(row, { role: ROLE, actor: request.userContext.userId,
      superuser: false, bypass_rls: false, service_member: false, not_owner: true });
    observations.push({ phase, ...row });
  }
  const hooks = {};
  const transaction = db.transaction.bind(db);
  db.transaction = (operation, settings) => transaction(async tx => {
    await observe(tx, 'transaction');
    const update = tx.update.bind(tx);
    tx.update = table => {
      const builder = update(table);
      if (table !== schema.workItem) return builder;
      const set = builder.set.bind(builder);
      builder.set = values => {
        const query = set(values);
        const returning = query.returning.bind(query);
        query.returning = async (...args) => {
          if (hooks.beforeWorkItemUpdate) {
            const hook = hooks.beforeWorkItemUpdate;
            delete hooks.beforeWorkItemUpdate;
            await hook();
          }
          return returning(...args);
        };
        return query;
      };
      return builder;
    };
    const insert = tx.insert.bind(tx);
    tx.insert = table => {
      const builder = insert(table);
      if (table !== schema.configurationEvidenceSnapshotVersion) return builder;
      const values = builder.values.bind(builder);
      builder.values = async input => {
        if (hooks.beforeSnapshotInsert) {
          const hook = hooks.beforeSnapshotInsert;
          delete hooks.beforeSnapshotInsert;
          await hook();
        }
        return values(input);
      };
      return builder;
    };
    return operation(tx);
  }, settings);
  const workItems = new MiaodaWorkItemRepository(db);
  const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
  const access = new CanonicalObjectAccessRouter(new MiaodaHostedCanonicalObjectAccessAdapter(workItems),
    new unavailable.UnavailableAilyObjectAccessAdapter(), new unavailable.UnavailableServiceObjectAccessAdapter(),
    new unavailable.UnavailableSessionObjectAccessAdapter());
  const store = new MiaodaConfigurationEvidenceStore(db);
  const queryStore = new MiaodaConfigurationEvidenceQueryStore(db);
  const fleet = new CanonicalFleetMasterDataRepository(db);
  const calls = {};
  for (const [label, object, methods] of [
    ['store', store, ['findByRequest', 'commit', 'readCurrent', 'readSnapshot', 'listHistory']],
    ['queryStore', queryStore, ['findLatest', 'findByRequest', 'findByQueryAttemptRef',
      'findByCandidateEvidenceRef', 'reserve', 'complete', 'markAdopted']],
    ['fleet', fleet, ['readCurrentForAircraft']], ['registrar', registrar, ['compareAndSet']],
  ]) for (const method of methods) {
    const original = object[method].bind(object);
    object[method] = async (...args) => {
      calls[label] = (calls[label] ?? 0) + 1;
      await observe(db, `${label}.${method}`);
      if (label === 'registrar' && hooks.beforeSelectionCas) {
        const hook = hooks.beforeSelectionCas;
        delete hooks.beforeSelectionCas;
        await hook();
      }
      return original(...args);
    };
  }
  let fixtureSourceCalls = 0;
  const port = { configured: true, getInstallationEvents: async query => {
    fixtureSourceCalls += 1;
    return controlledResult(query);
  } };
  const engineerReview = { pageContext: async workItem => ({ gapLedger: {
    inputRevision: workItem.revision, gaps: [{ gapRef: 'GAP-CONFIGURATION',
      materiality: 'P0_DECISION_CRITICAL', queryability: 'REVIEW_QUERYABLE',
      resolutionStatus: 'OPEN', evidenceCapabilities: ['GET_INSTALLATION_EVENTS'],
      disposition: null, affectedCriterionIds: ['APP-012'] }],
  } }) };
  const configuration = new ConfigurationEvidenceController(new ConfigurationEvidenceService(
    sessions, access, registrar, fleet, engineerReview, port, store, queryStore,
    { nowIso: () => '2026-08-30T01:02:03.000Z' }), scope);
  const selection = new CanonicalHostApplicabilitySelectionController(
    new CanonicalHostApplicabilitySelectionService(sessions, access, registrar, fleet), scope);
  const ingress = new ProductionMiaodaBrowserObjectIngressGuard();
  async function browser(operation, actor = ACTOR, tenant = TENANT) {
    const previousActor = { ...request.userContext };
    request.userContext.userId = actor;
    request.userContext.tenantId = tenant;
    try {
      assert.equal(request.headers.cookie, undefined);
      assert.equal(ingress.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
      return await new Promise((resolve, reject) => context.use(request, {}, () =>
        Promise.resolve().then(operation).then(resolve, reject)));
    } finally { Object.assign(request.userContext, previousActor); }
  }
  async function state() {
    const [row] = await admin`SELECT revision,projection_json FROM work_item WHERE work_item_id=${WI}`;
    const counts = {};
    for (const table of evidenceTables) {
      const [count] = await admin.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
      counts[table] = count.n;
    }
    return { workItem: JSON.parse(row.projection_json), revision: row.revision, counts };
  }
  async function advance() {
    const current = await state();
    const winner = { ...current.workItem, revision: current.revision + 1 };
    await admin`UPDATE work_item SET revision=${winner.revision},projection_json=${JSON.stringify(winner)}
      WHERE work_item_id=${WI}`;
    return winner;
  }
  return { admin, db, sessions, scope, access, request, browser, configuration, selection,
    observations, calls, hooks, state, advance, initial,
    fixtureSourceCalls: () => fixtureSourceCalls, externalCalls: () => externalCalls };
}

function queryBody() {
  return { schemaVersion: 'wiselink.3_1.refresh_configuration_evidence.v1',
    requestId: 'REQ-native-panels', expectedRevision: 7, aircraftIdentifier: 'B-2035',
    assessmentAsOf: AS_OF, windowStart: null, gapRefs: ['GAP-CONFIGURATION'],
    targets: [{ kind: 'EQUIPMENT', equipmentKey: 'AIMS2', positionId: null }] };
}
function previewBody() {
  return { expectedWorkItemRevision: 7, aircraftIdentifier: 'B-2035', asOf: '2026-08-29' };
}
function isRlsFailure(error) {
  const postgresError = error?.cause ?? error;
  return postgresError?.code === '42501' && /row-level security/iu.test(postgresError.message);
}
async function query(f) {
  return f.browser(() => f.configuration.query(WI, queryBody(), f.request));
}
async function preview(f) {
  return f.browser(() => f.selection.preview(WI, previewBody(), f.request));
}
function controlledResult(query) {
  return { status: 'COMPLETE', source: { owner: 'isolated-local-fixture',
    sourceSystem: 'SYNTHETIC_INSTALLATION_EVENT_FIXTURE', sourceRevision: 'fixture-rev-1',
    observedAt: '2026-08-29T12:00:00.000Z', freshness: 'AS_OF' },
  queryScope: structuredClone(query), coverage: { included: 'One synthetic controlled event.',
    limitation: 'Local isolated fixture only.', completeness: 'COMPLETE', allRecordsRead: true,
    exactAircraftMatch: true, exactTargetMatch: true }, records: [{ recordId: 'LOCAL-WO-1',
    revision: 'LOCAL-REV-1', authorityClass: 'INSTALLATION_EVENT_SOR', controlStatus: 'CONTROLLED',
    observedAt: '2026-08-29T12:00:00.000Z', freshness: 'AS_OF',
    coverage: { included: 'Synthetic exact event.', limitation: 'Fixture only.', completeness: 'COMPLETE' },
    aircraftAssetId: 'AIRCRAFT:panels', position: { positionId: 'POSITION:P1', sourcePositionKey: 'P1' },
    effectiveAt: '2026-08-28T01:00:00.000Z', recordedAt: '2026-08-28T01:00:00.000Z',
    event: { kind: 'INSTALL', installedComponent: { componentId: 'COMPONENT:AIMS2:P1',
      partNumber: 'PN:AIMS2', serialNumber: 'SN:LOCAL', equipmentKey: 'AIMS2' } } }], error: null };
}

test('native configuration owner queries candidate, explicitly adopts, reads current/snapshot and replays', options, async t => {
  const f = await fixture(t);
  const candidate = await query(f);
  assert.equal(candidate.candidate.terminalStatus, 'SUCCEEDED_EVIDENCE');
  assert.equal(candidate.candidate.adoption.status, 'CANDIDATE_UNADOPTED');
  assert.equal(candidate.authority.queryAdvancesWorkItemRevision, false);
  const beforeAdoption = await f.state();
  assert.deepEqual(beforeAdoption.workItem, f.initial);
  assert.equal(beforeAdoption.counts.configuration_evidence_snapshot_version, 0);
  const status = await f.browser(() => f.configuration.status(WI, f.request));
  assert.equal(status.current, null);
  assert.equal(status.latestQuery.adoptionStatus, 'CANDIDATE_UNADOPTED');
  const queryStatus = await f.browser(() => f.configuration.queryStatus(WI,
    candidate.candidate.queryAttemptRef, f.request));
  assert.deepEqual(queryStatus.candidate, candidate.candidate);
  const adopted = await f.browser(() => f.configuration.adopt(WI,
    candidate.candidate.candidateEvidenceRef, { expectedRevision: 7 }, f.request));
  assert.equal(adopted.workItemRevision, 8);
  assert.equal(adopted.persisted.snapshot.facts[0].truth, 'TRUE');
  const current = await f.browser(() => f.configuration.current(WI, f.request));
  const snapshot = await f.browser(() => f.configuration.snapshot(WI,
    adopted.persisted.summary.snapshotId, f.request));
  assert.equal(current.current.summary.snapshotId, adopted.persisted.summary.snapshotId);
  assert.deepEqual(snapshot.persisted.snapshot, adopted.persisted.snapshot);
  const committed = await f.state();
  const replay = await f.browser(() => f.configuration.adopt(WI,
    candidate.candidate.candidateEvidenceRef, { expectedRevision: 7 }, f.request));
  assert.equal(replay.replayed, true);
  assert.equal((await query(f)).replayed, true);
  assert.deepEqual(await f.state(), committed);
  assert.equal(committed.counts.configuration_evidence_snapshot_version, 1);
  assert.equal(committed.counts.configuration_evidence_query_attempt, 1);
  assert.equal(f.fixtureSourceCalls(), 1);
  assert.ok(f.observations.some(row => row.phase === 'transaction'));
  t.diagnostic(JSON.stringify({ sqlRole: ROLE, sqlActor: ACTOR, cookie: false,
    snapshots: 1, candidates: 1, externalCalls: f.externalCalls(),
    policyFixture: '0005/0011/0014/0017/0020 + representative mapped 0078 SELECT' }));
});

test('native selection owner previews without mutation, explicitly confirms and reads real CAS result', options, async t => {
  const f = await fixture(t);
  assert.equal((await f.browser(() => f.selection.availability(WI, f.request))).enabled, true);
  const before = await f.state();
  const draft = await preview(f);
  assert.deepEqual(await f.state(), before);
  const confirmed = await f.browser(() => f.selection.confirm(WI, { draft, confirmed: true }, f.request));
  assert.equal(confirmed.workItemRevision, 8);
  assert.equal(confirmed.currentness, 'CURRENT');
  assert.deepEqual(await f.browser(() => f.selection.read(WI, f.request)), confirmed);
  const saved = await f.state();
  assert.equal(saved.workItem.applicabilityControlledSelection.reviewAction.actorUserId, ACTOR);
  await assert.rejects(f.browser(() => f.selection.confirm(WI, { draft, confirmed: true }, f.request)),
    /APPLICABILITY_SELECTION_REVIEW_DRAFT_STALE/u);
  assert.deepEqual(await f.state(), saved);
  assert.equal(f.calls.registrar, 1);
});

test('native same-tenant SQL reader and cross-tenant actor get route 404 before adjacent panel stores', options, async t => {
  const f = await fixture(t);
  const candidate = await query(f);
  const adopted = await f.browser(() => f.configuration.adopt(WI,
    candidate.candidate.candidateEvidenceRef, { expectedRevision: 7 }, f.request));
  const draft = await f.browser(() => f.selection.preview(WI,
    { ...previewBody(), expectedWorkItemRevision: 8 }, f.request));
  await f.browser(() => f.scope.runRead(f.request, async () => {
    const [row] = await f.db.execute(sql`SELECT count(*)::int AS n FROM configuration_evidence_snapshot_version`);
    assert.equal(row.n, 1, 'nonowner really has shared SQL SELECT, independently of panel owner gate');
    const grant = await f.access.freshRead({ actor: f.sessions.nativeBrowserIdentity(f.request).actor,
      action: 'READ_CONFIGURATION_EVIDENCE', accessRoot: { kind: 'WORK_ITEM', id: WI } });
    assert.equal(grant.allowed, true);
    assert.equal(grant.actionPolicy.objectRelation, 'TENANT_READER');
  }), OTHER_ACTOR);
  const before = await f.state();
  const calls = { ...f.calls };
  for (const [actor, tenant] of [[OTHER_ACTOR, TENANT], [ACTOR, 'tenant-other']]) {
    for (const operation of [
      () => f.selection.read(WI, f.request),
      () => f.selection.availability(WI, f.request),
      () => f.selection.preview(WI, { ...previewBody(), expectedWorkItemRevision: 8 }, f.request),
      () => f.selection.confirm(WI, { draft, confirmed: true }, f.request),
      () => f.configuration.status(WI, f.request),
      () => f.configuration.queryStatus(WI, candidate.candidate.queryAttemptRef, f.request),
      () => f.configuration.current(WI, f.request),
      () => f.configuration.snapshot(WI, adopted.persisted.summary.snapshotId, f.request),
      () => f.configuration.query(WI, { ...queryBody(), requestId: 'REQ-denied', expectedRevision: 8 }, f.request),
      () => f.configuration.adopt(WI, candidate.candidate.candidateEvidenceRef, { expectedRevision: 8 }, f.request),
    ]) await assert.rejects(f.browser(operation, actor, tenant), error => error?.statusCode === 404);
  }
  assert.deepEqual(f.calls, calls, 'owner denial happens before fleet, registrar write, or evidence store');
  assert.deepEqual(await f.state(), before);
  assert.equal(f.fixtureSourceCalls(), 1);
});

test('revoked identity mapping blocks native configuration reservation and selection CAS under real RLS', options, async t => {
  const f = await fixture(t);
  const draft = await preview(f);
  const before = await f.state();
  await f.admin`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id=${ACTOR}`;
  await assert.rejects(query(f), isRlsFailure);
  await assert.rejects(f.browser(() => f.selection.confirm(WI, { draft, confirmed: true }, f.request)),
    /WORK_ITEM_CAS_CONFLICT/u);
  assert.deepEqual(await f.state(), before);
  assert.equal(f.fixtureSourceCalls(), 0);
});

test('withdrawing local fleet source head blocks native query and selection confirmation without mutation', options, async t => {
  const f = await fixture(t);
  const draft = await preview(f);
  const before = await f.state();
  await f.admin`DELETE FROM canonical_fleet_scope_head WHERE tenant_id=${TENANT}`;
  await assert.rejects(query(f), /APPLICABILITY_FLEET_DATABASE_UNAVAILABLE/u);
  await assert.rejects(f.browser(() => f.selection.confirm(WI, { draft, confirmed: true }, f.request)),
    /APPLICABILITY_FLEET_DATABASE_UNAVAILABLE/u);
  assert.deepEqual(await f.state(), before);
  assert.equal(f.fixtureSourceCalls(), 0);
});

test('native selection CAS race preserves the winning revision and never writes the rejected draft', options, async t => {
  const f = await fixture(t);
  const draft = await preview(f);
  let winner;
  f.hooks.beforeSelectionCas = async () => { winner = await f.advance(); };
  await assert.rejects(f.browser(() => f.selection.confirm(WI, { draft, confirmed: true }, f.request)),
    /WORK_ITEM_CAS_CONFLICT/u);
  assert.deepEqual((await f.state()).workItem, winner);
  assert.equal(winner.applicabilityControlledSelection, undefined);
});

test('native configuration commit CAS race rolls back and leaves its candidate unadopted', options, async t => {
  const f = await fixture(t);
  const candidate = await query(f);
  const before = await f.state();
  let winner;
  f.hooks.beforeWorkItemUpdate = async () => { winner = await f.advance(); };
  await assert.rejects(f.browser(() => f.configuration.adopt(WI,
    candidate.candidate.candidateEvidenceRef, { expectedRevision: 7 }, f.request)), /WORK_ITEM_CAS_CONFLICT/u);
  const after = await f.state();
  assert.deepEqual(after.workItem, winner);
  assert.deepEqual(after.counts, before.counts);
  const status = await f.browser(() => f.configuration.queryStatus(WI,
    candidate.candidate.queryAttemptRef, f.request));
  assert.equal(status.candidate.adoption.status, 'CANDIDATE_UNADOPTED');
});

test('mapping revocation after configuration CAS causes snapshot RLS failure and transaction rollback', options, async t => {
  const f = await fixture(t);
  const candidate = await query(f);
  const before = await f.state();
  f.hooks.beforeSnapshotInsert = async () => {
    await f.admin`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id=${ACTOR}`;
  };
  await assert.rejects(f.browser(() => f.configuration.adopt(WI,
    candidate.candidate.candidateEvidenceRef, { expectedRevision: 7 }, f.request)),
    isRlsFailure);
  assert.deepEqual(await f.state(), before, 'earlier WorkItem update rolled back with denied snapshot insert');
  const [row] = await f.admin`SELECT adoption_status FROM configuration_evidence_query_attempt`;
  assert.equal(row.adoption_status, 'CANDIDATE_UNADOPTED');
});
