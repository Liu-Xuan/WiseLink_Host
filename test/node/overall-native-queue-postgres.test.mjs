import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
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
const { getTableConfig } = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');
const tables = require('../../server/database/schema.ts');
const {
  dmDocumentParseRun,
} = require('../../server/database/document-parsing.schema.ts');
const {
  CanonicalHostOverallRegenerationService,
} = require('../../server/modules/canonical-host/canonical-host-overall-regeneration.service.ts');
const {
  CanonicalJobAidProblemService,
} = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const {
  JobAidWorkRepository,
} = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const {
  MiaodaCanonicalWorkItemRegistrarAdapter,
} = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const {
  MiaodaHostedCanonicalObjectAccessAdapter,
} = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const {
  ReviewConversationRepository,
} = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const {
  ActionAttemptRepository,
} = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const {
  ActionAttemptLifecycleService,
} = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const {
  CanonicalModelSettingsRepository,
} = require('../../server/modules/model-settings/canonical-model-settings.repository.ts');
const {
  CanonicalModelSettingsService,
} = require('../../server/modules/model-settings/canonical-model-settings.service.ts');
const {
  parseTaskEnvelope,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  readInitialAnalysisRequestInput,
} = require('../../server/modules/action-attempt/initial-analysis-request.ts');
const {
  JOBAID_PROBLEM_RESULT_SCHEMA,
  JOBAID_PROBLEM_WORK_SCHEMA,
  jobAidReadingResult,
} = require('../../shared/jobaid-problem-assessment.interface.ts');
const {
  JOBAID_METHOD_BINDING,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');
const {
  tdmsRuntimeFixture,
} = require('../unit/fixtures/tdms-runtime.fixture.ts');
const {
  tdmsTransactionProofFixture,
} = require('../unit/fixtures/tdms-transaction-native-verifier.fixture.ts');

// Real service, owner adapter, immutable-work reader, registrar/CAS, lifecycle,
// model-choice persistence and queue repository. The resolved browser identity,
// native receipts/source facts and native transaction verifier are OFFLINE fixtures.
// DDL/seeding use the owned test owner. Consumers use a separate generated
// NOSUPERUSER/NOBYPASSRLS login under fixture-only policies. This proves this
// synthetic SQL boundary, not production session or native provider authority.
const tableList = [
  tables.workItem,
  tables.actionAttempt,
  tables.assessmentWorkRevision,
  tables.identitySubjectMapping,
  dmDocumentParseRun,
];
async function schema(admin) {
  await admin.unsafe('CREATE TYPE user_profile AS (user_id text)');
  for (const table of tableList) {
    const config = getTableConfig(table);
    const columns = config.columns.map((c) => `"${c.name}" ${c.getSQLType()}`);
    await admin.unsafe(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
  }
  await admin.unsafe(`
    CREATE UNIQUE INDEX queue_fixture_work_id ON work_item(work_item_id);
    CREATE UNIQUE INDEX queue_fixture_attempt_id ON action_attempt(attempt_id);
    CREATE UNIQUE INDEX queue_fixture_operation_ref ON action_attempt(operation_ref);
    CREATE UNIQUE INDEX queue_fixture_work_revision ON assessment_work_revision(tenant_id,work_item_id,work_revision);
    ALTER TABLE action_attempt ALTER COLUMN claim_count SET DEFAULT 0,
      ALTER COLUMN retry_count SET DEFAULT 0, ALTER COLUMN lease_generation SET DEFAULT 0,
      ALTER COLUMN projection_applied SET DEFAULT false;
  `);
  const migration = await readFile(
    new URL(
      '../../migrations/0003_action_attempt_openclaw_v1.sql',
      import.meta.url,
    ),
    'utf8',
  );
  for (const name of [
    'uk_action_attempt_idempotency',
    'uk_action_attempt_active_work_task',
    'uk_action_attempt_operation_ref',
    'uk_action_attempt_lease_slot',
  ]) {
    const statement = migration.match(
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${name}[\\s\\S]+?;`, 'u'),
    );
    assert.ok(statement, `Actual queue index ${name}`);
    await admin.unsafe(statement[0]);
  }
  const appLogin = 'tdms_fixture_app_' + randomUUID().replaceAll('-', '').slice(0, 16);
  await admin.unsafe(`CREATE ROLE ${appLogin} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  await admin.unsafe(`GRANT USAGE ON SCHEMA public TO ${appLogin}`);
  for (const table of tableList) {
    const { name } = getTableConfig(table);
    const tenantColumn = name === 'identity_subject_mapping' ? 'miaoda_tenant_id' : 'tenant_id';
    const actor = name === 'work_item'
      ? " AND requested_by_user_id=current_setting('app.user_id',true)" : '';
    await admin.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON "${name}" TO ${appLogin}`);
    await admin.unsafe(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`);
    await admin.unsafe(`ALTER TABLE "${name}" FORCE ROW LEVEL SECURITY`);
    const condition = `${tenantColumn}=current_setting('app.fixture_tenant',true)${actor}`;
    await admin.unsafe(`CREATE POLICY queue_fixture_scope ON "${name}" FOR ALL TO ${appLogin} USING (${condition}) WITH CHECK (${condition})`);
  }
  return appLogin;
}
async function consumerConnection(owned) {
  const connection = await owned.connect(owned.fixtureAppLogin);
  await connection`SELECT set_config('app.user_id','owner',false),set_config('app.fixture_tenant','fixture-tenant',false)`;
  const [role] = await connection`SELECT session_user AS session,current_user AS role,rolsuper,rolbypassrls
    FROM pg_roles WHERE rolname=current_user`;
  assert.equal(role.session, owned.fixtureAppLogin);
  assert.equal(role.role, owned.fixtureAppLogin);
  assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false);
  const [privileges] = await connection`SELECT
    (SELECT count(*)::int FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS memberships,
    (SELECT count(*)::int FROM pg_class WHERE relname IN
      ('work_item','action_attempt','assessment_work_revision','identity_subject_mapping','dm_document_parse_run')
      AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned_tables`;
  assert.equal(privileges.memberships, 0); assert.equal(privileges.owned_tables, 0);
  return connection;
}
async function fixture(owned, controls = {}) {
  const admin = owned.admin;
  await admin.unsafe(
    'TRUNCATE work_item,action_attempt,assessment_work_revision,identity_subject_mapping,dm_document_parse_run',
  );
  const browserSql = await consumerConnection(owned);
  await browserSql.unsafe("SET statement_timeout='5s';SET lock_timeout='3s'");
  const queries = [];
  const db = drizzle(browserSql, {
    logger: {
      logQuery(query) {
        queries.push(query);
      },
    },
  });
  const f = tdmsRuntimeFixture({
    tenantId: 'fixture-tenant',
    actorUserId: 'owner',
    workItemId: 'WI-NATIVE',
    documentVersionId: 'DV-NATIVE',
    taskContextRef: 'OP-ORIGINAL',
  });
  f.principal.scope.appId = 'app_17bzc551rsg';
  f.actor.applicationScopeId = f.principal.scope.appId;
  f.actor.subjectDecision.applicationScopeId = f.principal.scope.appId;
  f.actor.subjectDecision.version = 'miaoda-hosted-native-sso.v1';
  const context = await f.adapter.discover(f.principal, f.binding);
  const evidence = (
    await f.adapter.read(f.principal, {
      context,
      evidenceRefs: context.projection.selectedSetApprovedRefs,
      purpose: 'JOB_AID_NATIVE_RECORD',
      taskContextRef: f.binding.taskContextRef,
    })
  ).evidence;
  const authenticEvidence = structuredClone(evidence);
  const revision = {
    workRevisionRef: 'JAWR-NATIVE-1',
    workItemId: 'WI-NATIVE',
    workRevision: 1,
    previousWorkRevisionRef: null,
    requestId: 'SAVE-ORIGINAL',
    actionAttemptId: 'ATT-ORIGINAL',
    basedOnWorkItemRevision: 11,
    documentVersionId: 'DV-NATIVE',
    createdAt: '2026-10-07T00:00:00.000Z',
    content: {
      schemaVersion: JOBAID_PROBLEM_WORK_SCHEMA,
      overviewStatus: 'CURRENT',
      headline: 'Conditional judgment',
      listBrief: 'Verify applicability',
      understanding: 'Execution is unverified.',
      decisiveIssueKeys: [],
      issues: [],
      roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
      completionReason: 'Native sources read',
      changeSummary: 'Candidate only',
      unchangedExplanation: 'No adoption',
      methodBinding: structuredClone(JOBAID_METHOD_BINDING),
      evidence,
      readSourceRefs: evidence.map((e) => e.evidenceRef),
      capabilities: [],
      historyReview: {
        required: false,
        priorAssessmentRefs: [],
        engineeringDocumentRefs: [],
        coverage: 'NOT_REQUIRED',
        limitation: null,
      },
    },
  };
  const sourceIdentity = {
    documentVersionId: 'DV-NATIVE',
    sourceArtifactId: 'ART-NATIVE',
    sourceFileSha256: 'a'.repeat(64),
    packageId: 'PKG-NATIVE',
    packageArtifactSha256: 'b'.repeat(64),
  };
  let current = {
    workItemId: 'WI-NATIVE',
    requestId: 'REQ-ORIGINAL',
    revision: 12,
    phase: 'CANDIDATE_READBACK_VERIFIED',
    source: { ...sourceIdentity },
    package: { packageId: 'PKG-NATIVE', artifact: { sha256: 'b'.repeat(64) } },
    classification: { status: 'CONFIRMED', normalizedFamily: 'SB' },
    aeo: null,
    failure: null,
    recordingFailure: null,
    integratedAssessment: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        schemaVersion: JOBAID_PROBLEM_RESULT_SCHEMA,
        workRevisionRef: revision.workRevisionRef,
        workRevision: 1,
        readingResult: jobAidReadingResult(revision),
      },
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        revision: 1,
        actionAttemptId: 'ATT-OVERALL',
        artifact: { sha256: 'c'.repeat(64) },
        staleReason: null,
        basedOnJobAidWorkRevisionRef: revision.workRevisionRef,
        readingResult: jobAidReadingResult(revision),
      },
      overallForAeoConfirmation: null,
    },
  };
  const original = structuredClone(current),
    originalWork = structuredClone(revision);
  const originalReceipts = structuredClone(f.receipts);
  await admin`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,
    revision,document_id,document_version_id,request_id,projection_json)
    VALUES ('WI-NATIVE','fixture-tenant','owner',12,'DOC-NATIVE','DV-NATIVE',
      ${current.requestId},${JSON.stringify(current)})`;
  await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,
    tenant_id,work_item_id,work_revision,previous_work_revision_id,request_id,action_attempt_id,
    based_on_work_item_revision,document_version_id,content_json,created_by_user_id,created_at)
    VALUES (${revision.workRevisionRef},'fixture-tenant','WI-NATIVE',1,null,${revision.requestId},
      ${revision.actionAttemptId},11,'DV-NATIVE',${JSON.stringify(revision.content)},'owner',${new Date(revision.createdAt)})`;
  await admin`INSERT INTO identity_subject_mapping(id,miaoda_user_id,miaoda_tenant_id,
    expected_client_id,status) VALUES ('11111111-1111-4111-8111-111111111111',
      'owner','fixture-tenant','cli_aadde8b579f95bc9','ACTIVE')`;
  async function publish(parseRunId, parseRevision) {
    await admin`INSERT INTO dm_document_parse_run(parse_run_id,document_version_id,
      tenant_id,status,parse_revision) VALUES (${parseRunId},'DV-NATIVE','fixture-tenant','PUBLISHED',${parseRevision})`;
  }
  await publish('PR-NATIVE-1', 1);
  const workItems = new MiaodaWorkItemRepository(db);
  const registrar = new MiaodaCanonicalWorkItemRegistrarAdapter(workItems);
  const accessAdapter = new MiaodaHostedCanonicalObjectAccessAdapter(workItems);
  const unused = new Proxy(
    {},
    {
      get(_target, name) {
        throw new Error(
          `UNEXPECTED_EXTERNAL_OR_RUNTIME_DEPENDENCY:${String(name)}`,
        );
      },
    },
  );
  const work = new JobAidWorkRepository(db, unused, unused);
  const repository = new ActionAttemptRepository(db);
  const models = new CanonicalModelSettingsService(
    new CanonicalModelSettingsRepository(db),
  );
  const attempts = new ActionAttemptLifecycleService(repository, models);
  const conversations = new ReviewConversationRepository(db);
  const proof = tdmsTransactionProofFixture(f);
  const guardCalls = [];
  const verifier = {
    async assertInTransaction(input) {
      assert.notEqual(
        input.database,
        db,
        'Native proof must use a handed transaction',
      );
      const [identity] = await input.database
        .execute(sql`SELECT pg_backend_pid() AS pid,
        txid_current()::text AS txid,current_setting('app.user_id',true) AS actor`);
      guardCalls.push({ identity, browser: !!input.browserCaller });
      assert.equal(identity.actor, 'owner');
      if (input.browserCaller) {
        assert.deepEqual(input.browserCaller.actor, f.actor);
        assert.equal(input.browserCaller.workRevisionRef, 'JAWR-NATIVE-1');
        assert.equal(input.browserCaller.workItemId, 'WI-NATIVE');
        assert.equal(input.browserCaller.documentVersionId, 'DV-NATIVE');
      }
      assert.equal(input.runtime, undefined);
      assert.equal(input.summaryCaller, undefined);
      for (const carrier of input.evidence) {
        const authentic = authenticEvidence.find(
          (e) =>
            e.nativeReadReceipt.receiptRef ===
            carrier.nativeReadReceipt.receiptRef,
        );
        assert.deepEqual(
          carrier,
          authentic,
          'Exact independent original native evidence',
        );
      }
      if (controls.onGuard)
        await controls.onGuard({ input, f, call: guardCalls.length, admin });
      await proof(input);
    },
    authorize: () => {
      throw new Error('UNEXPECTED_ROOT_NATIVE_AUTHORITY');
    },
    readExactEvidence: () => {
      throw new Error('UNEXPECTED_ROOT_NATIVE_READ');
    },
    assertCurrentEvidence: () => {
      throw new Error('UNEXPECTED_ROOT_NATIVE_CURRENTNESS');
    },
  };
  const jobAid = new CanonicalJobAidProblemService(
    registrar,
    unused,
    unused,
    unused,
    unused,
    attempts,
    workItems,
    conversations,
    unused,
    work,
    undefined,
    undefined,
    undefined,
    db,
    undefined,
    accessAdapter,
    undefined,
    verifier,
  );
  const service = new CanonicalHostOverallRegenerationService(
    { resolve: async () => (controls.noSession ? null : { actor: f.actor }) },
    accessAdapter,
    registrar,
    { nowIso: () => new Date().toISOString() },
    unused,
    attempts,
    jobAid,
    work,
    db,
    verifier,
  );
  const input = {
    requestId: 'REQ-REGEN',
    expectedRevision: 12,
    sourceIdentity,
  };
  const request = () => service.request('WI-NATIVE', input, {});
  async function currentProjection() {
    const [row] =
      await admin`SELECT projection_json FROM work_item WHERE work_item_id='WI-NATIVE'`;
    return JSON.parse(row.projection_json);
  }
  async function queueRows() {
    return admin`SELECT * FROM action_attempt ORDER BY attempt_id`;
  }
  async function unchanged() {
    assert.deepEqual(await currentProjection(), original);
    assert.equal((await queueRows()).length, 0);
  }
  async function historyUnchanged() {
    const saved = await work.readByRef({
      tenantId: 'fixture-tenant',
      workItemId: 'WI-NATIVE',
      workRevisionRef: 'JAWR-NATIVE-1',
    });
    assert.deepEqual(saved, originalWork);
    assert.deepEqual(f.receipts, originalReceipts);
  }
  async function peer() {
    const peerSql = await consumerConnection(owned);
    await peerSql.unsafe("SET statement_timeout='5s';SET lock_timeout='3s'");
    const peerDb = drizzle(peerSql);
    const peerItems = new MiaodaWorkItemRepository(peerDb);
    const peerRegistrar = new MiaodaCanonicalWorkItemRegistrarAdapter(
      peerItems,
    );
    const peerAccess = new MiaodaHostedCanonicalObjectAccessAdapter(peerItems);
    const peerWork = new JobAidWorkRepository(peerDb, unused, unused);
    const peerRepository = new ActionAttemptRepository(peerDb);
    const peerModels = new CanonicalModelSettingsService(
      new CanonicalModelSettingsRepository(peerDb),
    );
    const peerAttempts = new ActionAttemptLifecycleService(
      peerRepository,
      peerModels,
    );
    const peerJobAid = new CanonicalJobAidProblemService(
      peerRegistrar,
      unused,
      unused,
      unused,
      unused,
      peerAttempts,
      peerItems,
      new ReviewConversationRepository(peerDb),
      unused,
      peerWork,
      undefined,
      undefined,
      undefined,
      peerDb,
      undefined,
      peerAccess,
      undefined,
      verifier,
    );
    const peerService = new CanonicalHostOverallRegenerationService(
      { resolve: async () => ({ actor: f.actor }) },
      peerAccess,
      peerRegistrar,
      { nowIso: () => new Date().toISOString() },
      unused,
      peerAttempts,
      peerJobAid,
      peerWork,
      peerDb,
      verifier,
    );
    const [mainIdentity] = await browserSql`SELECT pg_backend_pid() AS pid`;
    const [peerIdentity] = await peerSql`SELECT pg_backend_pid() AS pid`;
    assert.notEqual(
      mainIdentity.pid,
      peerIdentity.pid,
      'Independent PostgreSQL sessions',
    );
    return {
      request: () => peerService.request('WI-NATIVE', input, {}),
      registrar: peerRegistrar,
      repository: peerRepository,
      close: () => peerSql.end({ timeout: 0 }),
      pids: [mainIdentity.pid, peerIdentity.pid],
    };
  }
  return {
    admin,
    db,
    browserSql,
    queries,
    f,
    controls,
    service,
    request,
    input,
    original,
    originalWork,
    currentProjection,
    queueRows,
    unchanged,
    historyUnchanged,
    guardCalls,
    verifier,
    repository,
    attempts,
    jobAid,
    registrar,
    work,
    publish,
    peer,
    close: () => browserSql.end({ timeout: 0 }),
  };
}

function twoPartyBarrier() {
  let count = 0,
    release;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    count += 1;
    if (count === 2) release();
    let timer;
    try {
      await Promise.race([
        ready,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('FIXTURE_TWO_PARTY_BARRIER_TIMEOUT')),
            3000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

const capability = await postgresCapability();
test(
  'browser native Overall regeneration through real PostgreSQL queue persistence',
  { timeout: 120000 },
  async (t) => {
    assert.equal(
      capability.available,
      true,
      'Explicit isolated PG runtime is required; never silently skip',
    );
    const owned = await startOwnedPostgres(capability);
    const checked = [];
    t.diagnostic(
      `OWNED_POSTGRES ${JSON.stringify({ uid: process.getuid(), ...owned.expected, ...owned.instance, identity: owned.identity })}`,
    );
    try {
      owned.fixtureAppLogin = await schema(owned.admin);
      async function scenario(name, body, controls = {}) {
        await t.test(name, async () => {
          const h = await fixture(owned, controls);
          try {
            await body(h);
            checked.push(name);
          } finally {
            await h.close();
          }
        });
      }
      await scenario('nonbypass consumer enforces fixture tenant and work-item actor RLS before queue replay', async h => {
        await h.publish('PARSE-RLS-synthetic', 1);
        await h.request();
        try {
          await h.browserSql`SELECT set_config('app.fixture_tenant','wrong-fixture-tenant',false)`;
          for (const table of tableList) {
            const { name } = getTableConfig(table);
            assert.equal((await h.browserSql.unsafe(`SELECT * FROM "${name}"`)).length, 0,
              `Wrong fixture tenant must not see ${name}`);
          }
          await assert.rejects(() => h.browserSql`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id)
            VALUES ('WI-RLS-negative','fixture-tenant','owner')`, { code: '42501' });
          await h.browserSql`SELECT set_config('app.fixture_tenant','fixture-tenant',false),set_config('app.user_id','wrong-owner',false)`;
          assert.equal((await h.browserSql`SELECT * FROM work_item`).length, 0);
          await assert.rejects(() => h.browserSql`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id)
            VALUES ('WI-RLS-negative','fixture-tenant','owner')`, { code: '42501' });
          // The other four fixture policies are tenant-scoped, not per-actor source grants.
          assert.equal((await h.browserSql`SELECT * FROM action_attempt`).length, 1);
        } finally {
          await h.browserSql`SELECT set_config('app.fixture_tenant','fixture-tenant',false),set_config('app.user_id','owner',false)`;
        }
        assert.equal((await h.browserSql`SELECT * FROM work_item`).length, 1);
        assert.equal((await h.request()).replayed, true);
      });
      await scenario(
        'exact metadata-only intent persists and replay returns one real row',
        async (h) => {
          const result = await h.request();
          assert.equal(result.replayed, false);
          assert.equal(result.regeneration.executionRevision, 13);
          assert.equal(result.regeneration.status, 'QUEUED');
          const [row] = await h.queueRows();
          assert.equal(row.operation_ref, result.regeneration.attemptRef);
          assert.equal(row.tenant_id, 'fixture-tenant');
          assert.equal(row.work_item_id, 'WI-NATIVE');
          assert.equal(row.document_version_id, 'DV-NATIVE');
          assert.equal(row.actor_user_id, 'service:openclaw-main');
          assert.equal(row.base_revision, 13);
          assert.equal(row.input_revision, 13);
          assert.equal(row.claim_count, 0);
          assert.equal(row.lease_generation, 0);
          assert.equal(row.lease_token, null);
          assert.equal(row.projection_applied, false);
          const task = parseTaskEnvelope(row.task_envelope_json);
          assert.equal(
            task.idempotencyKey,
            'openclaw-v1:overall:WI-NATIVE:13:USER_REQUESTED_REGENERATION:REQ-REGEN',
          );
          assert.equal(task.inputHash, row.task_input_hash);
          assert.deepEqual(readInitialAnalysisRequestInput(task), {
            schemaVersion: 'wiselink.3_1.initial_analysis_request.v1',
            taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
            requestId: 'original-13',
            originalParseRunId: 'PR-NATIVE-1',
            nativeOverallAdmission: {
              workRevisionRef: 'JAWR-NATIVE-1',
              workRevision: 1,
              regenerationRequestId: 'REQ-REGEN',
            },
          });
          assert.deepEqual(task.sourceRefs, [
            { ref: 'ART-NATIVE', sha256: 'a'.repeat(64) },
          ]);
          assert.deepEqual(task.allowedConnectors, []);
          assert.deepEqual(
            task.executionModel,
            JSON.parse(row.execution_model_json),
          );
          assert.equal(task.executionModel.modelRef, 'm3probe/minimax-m3');
          assert.ok(Buffer.byteLength(row.task_envelope_json) < 3000);
          for (const e of h.originalWork.content.evidence) {
            assert.ok(!JSON.stringify(row).includes(e.excerpt));
            assert.ok(
              !JSON.stringify(row).includes(e.nativeReadReceipt.receiptRef),
            );
          }
          assert.ok(!row.task_envelope_json.includes('readingResult'));
          assert.ok(!row.task_envelope_json.includes('tdmsContext'));
          const current = await h.currentProjection();
          assert.equal(current.revision, 13);
          assert.deepEqual(
            current.integratedAssessment.baseRules,
            h.original.integratedAssessment.baseRules,
          );
          assert.deepEqual(
            current.integratedAssessment.overallSynthesis.readingResult,
            h.original.integratedAssessment.overallSynthesis.readingResult,
          );
          assert.equal(
            h.guardCalls[0].identity.txid,
            h.guardCalls[1].identity.txid,
          );
          assert.equal(
            h.guardCalls[0].identity.pid,
            h.guardCalls[1].identity.pid,
          );
          await h.historyUnchanged();
          const repeated = await h.request();
          assert.equal(repeated.replayed, true);
          assert.equal(repeated.regeneration.attemptRef, row.operation_ref);
          assert.equal((await h.queueRows()).length, 1);
          const status = await h.service.status('WI-NATIVE', 'REQ-REGEN', {});
          assert.equal(status.status, 'QUEUED');
          assert.ok(!JSON.stringify(status).includes('TDMS_NATIVE_RECORD'));
          assert.ok(!JSON.stringify(status).includes('JAWR-NATIVE-1'));
          t.diagnostic(
            `EXACT_QUEUE ${JSON.stringify({ taskHash: row.task_input_hash, bytes: Buffer.byteLength(row.task_envelope_json), guardCalls: h.guardCalls.length })}`,
          );
        },
      );
      await scenario(
        'source parse replacement after admission does not repin persisted intent',
        async (h) => {
          await h.request();
          const [before] = await h.queueRows();
          await h.publish('PR-NATIVE-2', 2);
          await h.request();
          const [after] = await h.queueRows();
          assert.equal(after.task_envelope_json, before.task_envelope_json);
          assert.equal(
            readInitialAnalysisRequestInput(
              parseTaskEnvelope(after.task_envelope_json),
            ).originalParseRunId,
            'PR-NATIVE-1',
          );
        },
      );
      await scenario(
        'parallel exact browser replay remains one queue row',
        async (h) => {
          await h.request();
          const rows = await Promise.all(
            Array.from({ length: 5 }, () => h.request()),
          );
          assert.ok(rows.every((r) => r.replayed));
          assert.equal(
            new Set(rows.map((r) => r.regeneration.attemptRef)).size,
            1,
          );
          assert.equal((await h.queueRows()).length, 1);
        },
      );
      for (const mode of ['owner', 'tenant', 'application', 'session'])
        await scenario(
          `${mode} authorization denies before mutation`,
          async (h) => {
            if (mode === 'owner')
              h.f.actor.canonicalSubject.id = 'someone-else';
            if (mode === 'tenant') {
              h.f.actor.tenantId = 'other-tenant';
              h.f.actor.subjectDecision.tenantId = 'other-tenant';
            }
            if (mode === 'application') {
              h.f.actor.applicationScopeId = 'other-app';
              h.f.actor.subjectDecision.applicationScopeId = 'other-app';
            }
            await assert.rejects(
              h.request,
              /CANONICAL_WORK_ITEM_NOT_FOUND|CANONICAL_IDENTITY_HANDOFF_UNAVAILABLE|OFFICIAL_OAUTH_SESSION_REQUIRED/,
            );
            await h.unchanged();
          },
          { noSession: mode === 'session' },
        );
      for (const mode of ['missing', 'capability'])
        await scenario(
          `${mode} native verifier remains default-off`,
          async (h) => {
            if (mode === 'missing') h.service.nativeVerifier = undefined;
            else delete h.verifier.assertInTransaction;
            await assert.rejects(
              h.request,
              /TDMS_NATIVE_TRANSACTION_AUTHORIZATION_NOT_CONNECTED/,
            );
            await h.unchanged();
          },
        );
      for (const flag of [
        'authenticated',
        'sourceAllowed',
        'objectAllowed',
        'documentAllowed',
        'applicationAllowed',
      ])
        await scenario(
          `native ${flag} revocation rolls back written projection and queues nothing`,
          async (h) => {
            await assert.rejects(
              h.request,
              /FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED/,
            );
            assert.equal(h.guardCalls.length, 2);
            await h.unchanged();
            await h.historyUnchanged();
          },
          {
            onGuard: ({ f, call }) => {
              if (call === 2) f.control[flag] = false;
            },
          },
        );
      await scenario(
        'native fixture lease expiry in postwrite guard rolls back',
        async (h) => {
          await assert.rejects(
            h.request,
            /FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED/,
          );
          await h.unchanged();
        },
        {
          onGuard: ({ f, call }) => {
            if (call === 2)
              f.principal.scope.automaticWorkItemLease.leaseExpiresAt =
                '2000-01-01T00:00:00Z';
          },
        },
      );
      await scenario(
        'post-CAS source revocation preserves recoverable marker but no queue row',
        async (h) => {
          await assert.rejects(
            h.request,
            /FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED/,
          );
          assert.equal((await h.currentProjection()).revision, 13);
          assert.equal((await h.queueRows()).length, 0);
          h.f.control.sourceAllowed = true;
          h.controls.onGuard = undefined;
          const recovered = await h.request();
          assert.equal(recovered.replayed, true);
          assert.equal((await h.queueRows()).length, 1);
          await h.historyUnchanged();
        },
        {
          onGuard: ({ f, call }) => {
            if (call === 3) f.control.sourceAllowed = false;
          },
        },
      );
      await scenario(
        'missing published original fails admission then exact retry recovers',
        async (h) => {
          await h.admin`DELETE FROM dm_document_parse_run`;
          await assert.rejects(h.request, /DOCUMENT_ORIGINAL_NOT_PUBLISHED/);
          assert.equal((await h.currentProjection()).revision, 13);
          assert.equal((await h.queueRows()).length, 0);
          await h.publish('PR-NATIVE-1', 1);
          const response = await h.request();
          assert.equal(response.replayed, true);
          assert.equal((await h.queueRows()).length, 1);
        },
      );
      await scenario(
        'persisted owner revocation blocks browser replay and status',
        async (h) => {
          await h.request();
          const [before] = await h.queueRows();
          await h.admin`UPDATE work_item SET requested_by_user_id='other-owner' WHERE work_item_id='WI-NATIVE'`;
          await assert.rejects(h.request, /CANONICAL_WORK_ITEM_NOT_FOUND/);
          await assert.rejects(
            () => h.service.status('WI-NATIVE', 'REQ-REGEN', {}),
            /CANONICAL_WORK_ITEM_NOT_FOUND/,
          );
          assert.equal(
            (await h.queueRows())[0].task_envelope_json,
            before.task_envelope_json,
          );
        },
      );
      await scenario(
        'fresh native revocation blocks replay without replacing queued bytes',
        async (h) => {
          await h.request();
          const [before] = await h.queueRows();
          h.f.control.sourceAllowed = false;
          await assert.rejects(
            h.request,
            /FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED/,
          );
          assert.equal(
            (await h.queueRows())[0].task_envelope_json,
            before.task_envelope_json,
          );
        },
      );
      await scenario(
        'mismatched idempotency replay payload is rejected',
        async (h) => {
          await h.request();
          h.input.sourceIdentity.sourceArtifactId = 'ART-OTHER';
          await assert.rejects(
            h.request,
            /OVERALL_REGENERATION_IDEMPOTENCY_PAYLOAD_MISMATCH/,
          );
          assert.equal((await h.queueRows()).length, 1);
        },
      );
      await scenario(
        'metadata-only request cannot obtain execution lease without preparation',
        async (h) => {
          await h.request();
          const [raw] = await h.queueRows();
          const row = await h.repository.readByAttemptId(raw.attempt_id);
          const task = parseTaskEnvelope(row.taskEnvelopeJson);
          const input = {
            workItemId: task.workItemId,
            taskType: task.taskType,
            actorUserId: row.actorUserId,
            tenantId: task.tenantId,
            documentVersionId: task.documentVersionId,
            inputRevision: task.inputRevision,
            baseRevision: task.baseRevision,
            idempotencyKey: task.idempotencyKey,
            leaseOwner: 'fixture-executor',
            sourceRefs: task.sourceRefs,
            allowedConnectors: task.allowedConnectors,
          };
          // Test the actual lifecycle's final lease gate directly. No authorized runtime
          // or native preparation is supplied and no model/executor is invoked.
          await assert.rejects(
            () => h.attempts.claimExisting(row, input, new Date()),
            /ACTION_ATTEMPT_INITIAL_REQUEST_NOT_PREPARED/,
          );
          const after = await h.repository.readByAttemptId(row.attemptId);
          assert.equal(after.status, 'QUEUED');
          assert.equal(after.claimCount, 0);
          assert.equal(after.leaseToken, null);
        },
      );
      await scenario(
        'independent-session first requests commit one marker and one attempt; losing CAS retries',
        async (h) => {
          const peer = await h.peer();
          try {
            const gate = twoPartyBarrier();
            for (const registrar of [h.registrar, peer.registrar]) {
              const original = registrar.compareAndSet.bind(registrar);
              registrar.compareAndSet = async (input) => {
                await gate();
                return original(input);
              };
            }
            const outcomes = await Promise.allSettled([
              h.request(),
              peer.request(),
            ]);
            assert.equal(
              outcomes.filter((r) => r.status === 'fulfilled').length,
              1,
            );
            assert.equal(
              outcomes.filter((r) => r.status === 'rejected').length,
              1,
            );
            for (const outcome of outcomes)
              if (outcome.status === 'rejected')
                assert.match(outcome.reason.message, /WORK_ITEM_CAS_CONFLICT/);
            assert.equal((await h.queueRows()).length, 1);
            assert.equal((await h.currentProjection()).revision, 13);
            assert.equal((await peer.request()).replayed, true);
            t.diagnostic(`INDEPENDENT_CAS_PIDS ${JSON.stringify(peer.pids)}`);
          } finally {
            await peer.close();
          }
        },
      );
      await scenario(
        'independent-session lost-queue recovery races actual INSERT and keeps one idempotent row',
        async (h) => {
          await h.admin`DELETE FROM dm_document_parse_run`;
          await assert.rejects(h.request, /DOCUMENT_ORIGINAL_NOT_PUBLISHED/);
          await h.publish('PR-NATIVE-1', 1);
          const peer = await h.peer();
          try {
            const gate = twoPartyBarrier();
            for (const repository of [h.repository, peer.repository]) {
              const original = repository.reserve.bind(repository);
              repository.reserve = async (...args) => {
                await gate();
                return original(...args);
              };
            }
            const outcomes = await Promise.all([h.request(), peer.request()]);
            assert.ok(outcomes.every((r) => r.replayed));
            assert.equal(
              outcomes[0].regeneration.attemptRef,
              outcomes[1].regeneration.attemptRef,
            );
            assert.equal((await h.queueRows()).length, 1);
            assert.equal((await h.currentProjection()).revision, 13);
            t.diagnostic(`INDEPENDENT_QUEUE_PIDS ${JSON.stringify(peer.pids)}`);
          } finally {
            await peer.close();
          }
        },
      );
      for (const existing of [true, false])
        await scenario(
          `successor work ${existing ? 'retains existing replay' : 'denies missing-attempt recovery'}`,
          async (h) => {
            await h.request();
            const [before] = await h.queueRows();
            await h.admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,work_item_id,
        work_revision,previous_work_revision_id,request_id,action_attempt_id,based_on_work_item_revision,
        document_version_id,content_json,created_by_user_id,created_at)
        SELECT 'JAWR-NATIVE-2',tenant_id,work_item_id,2,assessment_work_revision_id,'SAVE-NEXT','ATT-NEXT',
          13,document_version_id,content_json,created_by_user_id,created_at FROM assessment_work_revision
          WHERE assessment_work_revision_id='JAWR-NATIVE-1'`;
            if (existing) {
              const replay = await h.request();
              assert.equal(replay.replayed, true);
              assert.equal(
                replay.regeneration.attemptRef,
                before.operation_ref,
              );
              assert.equal(
                (await h.queueRows())[0].task_envelope_json,
                before.task_envelope_json,
              );
            } else {
              await h.admin`DELETE FROM action_attempt`;
              await assert.rejects(
                h.request,
                /JOBAID_OVERALL_EXACT_WORK_CHANGED/,
              );
              assert.equal((await h.queueRows()).length, 0);
            }
            await h.historyUnchanged();
          },
        );
      await scenario(
        'queue INSERT failure rolls back that row and exact replay recovers marker',
        async (h) => {
          await h.admin
            .unsafe(`CREATE FUNCTION fixture_fail_queue_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'FIXTURE_QUEUE_INSERT_FAILED'; END $$;
        CREATE TRIGGER fixture_fail_queue_insert BEFORE INSERT ON action_attempt FOR EACH ROW
        EXECUTE FUNCTION fixture_fail_queue_insert()`);
          try {
            await assert.rejects(
              h.request,
              (error) => error.cause?.message === 'FIXTURE_QUEUE_INSERT_FAILED',
            );
            assert.equal((await h.queueRows()).length, 0);
            assert.equal((await h.currentProjection()).revision, 13);
          } finally {
            await h.admin.unsafe(
              'DROP TRIGGER fixture_fail_queue_insert ON action_attempt; DROP FUNCTION fixture_fail_queue_insert()',
            );
          }
          const replay = await h.request();
          assert.equal(replay.replayed, true);
          assert.equal((await h.queueRows()).length, 1);
          await h.historyUnchanged();
        },
      );
      await scenario(
        'changed native selected generation rejects existing replay without rebinding',
        async (h) => {
          await h.request();
          const [before] = await h.queueRows();
          h.f.head.generation += 1;
          await assert.rejects(
            h.request,
            /FIXTURE_NATIVE_TRANSACTION_PROOF_REVOKED/,
          );
          assert.equal(
            (await h.queueRows())[0].task_envelope_json,
            before.task_envelope_json,
          );
        },
      );
      await scenario(
        'SQL actor mismatch hides the work item through fixture RLS before replay',
        async (h) => {
          await h.request();
          await h.browserSql`SELECT set_config('app.user_id','wrong-sql-actor',false)`;
          await assert.rejects(
            h.request,
            /CANONICAL_WORK_ITEM_NOT_FOUND/,
          );
          assert.equal((await h.queueRows()).length, 1);
        },
      );
      await scenario(
        'official actor mapping revocation denies post-CAS queue admission',
        async (h) => {
          await h.admin`UPDATE identity_subject_mapping SET status='REVOKED'`;
          await assert.rejects(h.request, /JOBAID_ACTOR_AUTHORIZATION_CHANGED/);
          assert.equal((await h.queueRows()).length, 0);
          assert.equal((await h.currentProjection()).revision, 13);
          await h.admin`UPDATE identity_subject_mapping SET status='ACTIVE'`;
          assert.equal((await h.request()).replayed, true);
          assert.equal((await h.queueRows()).length, 1);
        },
      );
      await scenario(
        'terminal attempt replay retains original operation and bytes',
        async (h) => {
          const first = await h.request();
          const [before] = await h.queueRows();
          await h.admin`UPDATE action_attempt SET status='FAILED',terminal_reason='FIXTURE_TERMINAL',updated_at=now() WHERE attempt_id=${before.attempt_id}`;
          const replay = await h.request();
          assert.equal(replay.replayed, true);
          assert.equal(replay.regeneration.status, 'FAILED');
          assert.equal(
            replay.regeneration.attemptRef,
            first.regeneration.attemptRef,
          );
          assert.equal((await h.queueRows()).length, 1);
          assert.equal(
            (await h.queueRows())[0].task_envelope_json,
            before.task_envelope_json,
          );
        },
      );
    } finally {
      await owned.stop();
      await assert.rejects(() => access(owned.root), { code: 'ENOENT' });
      const portClosed = await new Promise((resolve) => {
        const socket = createConnection({
          host: '127.0.0.1',
          port: owned.expected.port,
        });
        socket.once('error', () => resolve(true));
        socket.once('connect', () => {
          socket.destroy();
          resolve(false);
        });
        socket.setTimeout(1000, () => {
          socket.destroy();
          resolve(false);
        });
      });
      assert.equal(
        portClosed,
        true,
        'Owned PostgreSQL TCP listener must be gone',
      );
      t.diagnostic(
        `CLEANUP ${JSON.stringify({ dataDirectoryRemoved: true, tcpListenerClosed: portClosed, passedScenarios: checked.length })}`,
      );
    }
  },
);
