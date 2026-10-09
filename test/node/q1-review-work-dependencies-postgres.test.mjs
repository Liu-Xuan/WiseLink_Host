import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { eq, sql: contextSql } = require('drizzle-orm');
const {
  SqlExecutionContextMiddleware,
  UserContextMiddleware,
  CsrfMiddleware,
} = require('@lark-apaas/fullstack-nestjs-core');
const { Test } = require('@nestjs/testing');
const { Reflector } = require('@nestjs/core');
const { AuthNPaasGuard } = require('@lark-apaas/nestjs-authnpaas');
const cookieParser = require('cookie-parser');
const { GlobalExceptionFilter } = require('../../server/common/filters/exception.filter.ts');
const { IdentityRepository } = require('../../server/modules/identity/identity.repository.ts');
const { SessionStore } = require('../../server/modules/identity/session.store.ts');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { DialogueBrowserScope } = require('../../server/modules/canonical-host/dialogue-browser-scope.service.ts');
const { MiaodaHostedCanonicalObjectAccessAdapter } = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const { ProductionMiaodaBrowserObjectIngressGuard } = require('../../server/modules/work-item/production-miaoda-browser-ingress.ts');
const { EngineeringIssueSearchController } = require('../../server/modules/canonical-host/engineering-issue-search.controller.ts');
const { DocumentSourceSearchService } = require('../../server/modules/canonical-host/document-source-search.service.ts');
const { actionAttempt, engineeringMatterWorkRevision } = require('../../server/database/schema.ts');
const { getTableConfig } = require('drizzle-orm/pg-core');
const {
  EngineeringIssueSearchService,
} = require('../../server/modules/canonical-host/engineering-issue-search.service.ts');
const {
  EngineeringSearchProjectionWriter,
} = require('../../server/modules/canonical-host/engineering-search-projection.ts');
const {
  EngineeringMatterWorkingRepository,
} = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const {
  JobAidWorkRepository,
} = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const {
  ReviewConversationRepository,
} = require('../../server/modules/review-persistence/review-conversation.repository.ts');
const {
  CanonicalJobAidProblemService,
} = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const {
  CanonicalHostOpenClawReviewService,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-review.service.ts');
const {
  MiaodaWorkItemRepository,
} = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const {
  ActionAttemptRepository,
} = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const {
  ActionAttemptLifecycleService,
} = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const {
  materializeJobAidWork,
  jobAidReadingResult,
} = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const {
  buildJobAidProblemTask,
} = require('../../server/modules/canonical-host/jobaid-problem-task.ts');
const {
  projectCommonAssessmentContext,
} = require('../../server/modules/canonical-host/canonical-host-common-context.service.ts');
const {
  sealResultEnvelope,
  sealTaskEnvelope,
  canonicalJson,
} = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const {
  JOBAID_METHOD_BINDING,
  JOBAID_METHOD_EVIDENCE,
} = require('../../server/modules/canonical-host/jobaid-method-pack.ts');
const {
  originalFixture,
} = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const { fixedModelSettings } = require('../support/fixed-model-settings.ts');
const {
  overallUserRegenerationIdempotencyKey,
  CanonicalHostOpenClawOverallService,
} = require('../../server/modules/canonical-host/canonical-host-openclaw-overall.service.ts');
const {
  CanonicalHostOverallRegenerationService,
} = require('../../server/modules/canonical-host/canonical-host-overall-regeneration.service.ts');
const { resetQ1Database, initialProjection } =
  await import('./helpers/q1-review-postgres.fixture.mjs');

// The older Q1 fixture predates opaque sessions. Add only the identity schema
// needed for this isolated HTTP contract and reuse the actual browser RLS.
async function prepareOpaqueSessionFixture(sql) {
  await sql.unsafe(`ALTER TABLE identity_subject_mapping
    ADD COLUMN feishu_open_id varchar(255), ADD COLUMN feishu_tenant_key varchar(255),
    ADD COLUMN feishu_user_id varchar(255), ADD COLUMN revision integer DEFAULT 1,
    ADD COLUMN _created_by user_profile, ADD COLUMN _updated_by user_profile;
    ALTER TABLE identity_subject_mapping ADD CONSTRAINT q1_mapping_id_key UNIQUE(id);
    CREATE TABLE identity_session (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      session_token_hash varchar(64) NOT NULL UNIQUE,
      subject_mapping_id uuid NOT NULL REFERENCES identity_subject_mapping(id),
      aily_access_token_sealed text, aily_access_token_expires_at timestamptz(3),
      feishu_user_id varchar(255), revision integer NOT NULL DEFAULT 1,
      expires_at timestamptz(3) NOT NULL, revoked_at timestamptz(3),
      last_seen_at timestamptz(3) NOT NULL,
      _created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _created_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
        ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END),
      _updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      _updated_by user_profile DEFAULT (CASE WHEN current_setting('app.user_id', TRUE) = '' THEN NULL
        ELSE concat('(', current_setting('app.user_id', TRUE), ')')::user_profile END));
    ALTER TABLE identity_session ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE ON identity_session TO authenticated;`);
  const rls = await readFile(new URL('../../migrations/0005_identity_oauth_authenticated_rls.sql', import.meta.url), 'utf8');
  const issue = await readFile(new URL('../../migrations/0008_identity_session_authenticated_role_rebind.sql', import.meta.url), 'utf8');
  for (const [body, name] of [[rls, 'identity_session_authenticated_read'],
    [rls, 'identity_session_authenticated_update'], [issue, 'identity_session_authenticated_issue_runtime']]) {
    const policy = body.match(new RegExp(`CREATE POLICY ${name}[\\s\\S]+?\\n  \\);`, 'u'));
    assert.ok(policy, `missing ${name} from real migration`);
    await sql.unsafe(policy[0]);
  }
}

const databaseUrl = process.env.JOBAID_WORK_TEST_DATABASE_URL;
const scope = {
  tenantId: 'tenant-job',
  workItemId: 'WI-job',
  actorUserId: 'actor-job',
};
const fence = {
  principalId: 'service-job',
  leaseToken: 'lease-job',
  leaseGeneration: 1,
};
const source = {
  kind: 'DOCUMENT_PASSAGE',
  evidenceRef: 'source:dv-job:sr1',
  title: 'Constructed Q1 source',
  workItemId: scope.workItemId,
  documentVersionId: 'dv-job',
  sourceRefId: 'sr1',
  versionLabel: 'R1',
  locator: 'page 1',
  excerpt:
    'Do not replace unless the indication persists after 5 seconds. Normal inspection does not exclude intermittent failure.',
};
const evidence = [source, ...JOBAID_METHOD_EVIDENCE];
const sourceBindings = [
  {
    workItemId: scope.workItemId,
    documentVersionId: 'dv-job',
    artifactRef: 'artifact://test/source',
    artifactSha256: 'a'.repeat(64),
  },
];

// Loopback-only Hosted dispatch fixture. The gateway header is constructed, so
// this proves the application route and real persisted session/RLS, not gateway
// authenticity or a product-hosted OAuth exchange.
async function exerciseProjectionHttpRecovery({ t, db, sqlContext, searchService,
  browserScope, sessionStore, fixtureSql, token, expiredToken, revokedToken, queryLog,
  currentRef, baselineRef, content, scenario }) {
  const envKeys = ['MIAODA_LOCAL_DEV', 'FORCE_FRAMEWORK_ENVIRONMENT', 'SANDBOX_ID', 'WL_ENGINEERING_SEARCH_PROJECTION'];
  const oldEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  let app;
  const originalRebuild = searchService.rebuildProjection;
  const originalValidate = sessionStore.validate;
  const entries = [];
  const receipts = [];
  const sessionReads = [];
  try {
    delete process.env.MIAODA_LOCAL_DEV;
    delete process.env.SANDBOX_ID;
    process.env.FORCE_FRAMEWORK_ENVIRONMENT = 'boe';
    process.env.WL_ENGINEERING_SEARCH_PROJECTION = '1';
    sessionStore.validate = async function (opaque, database) {
      const [sqlIdentity] = database ? await database.execute(contextSql`SELECT current_user AS role,
        current_setting('app.user_id',true) AS actor`) : [null];
      sessionReads.push({ tokenMatched: opaque === token, inTransaction: !!database,
        role: sqlIdentity?.role ?? null, actor: sqlIdentity?.actor ?? null });
      return originalValidate.call(this, opaque, database);
    };
    // Observe the role at the real service entrance; call its unchanged body.
    searchService.rebuildProjection = async function (...args) {
      const [identity] = await db.execute(contextSql`SELECT current_user AS role,
        current_setting('app.user_id',true) AS actor`);
      entries.push({ ...identity, tenantId: args[1].tenantId,
        nativeSystemAccount: args[2].userContext.isSystemAccount });
      return originalRebuild.apply(this, args);
    };
    const module = await Test.createTestingModule({
      controllers: [EngineeringIssueSearchController],
      providers: [
        ProductionMiaodaBrowserObjectIngressGuard,
        { provide: EngineeringIssueSearchService, useValue: searchService },
        { provide: DialogueBrowserScope, useValue: browserScope },
        // This unrelated route is never requested. No work reader is mocked.
        { provide: DocumentSourceSearchService, useValue: {} },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    const userContext = new UserContextMiddleware();
    const csrf = new CsrfMiddleware();
    const filter = new GlobalExceptionFilter();
    app.use(cookieParser());
    app.use(userContext.use.bind(userContext));
    app.use(sqlContext.use.bind(sqlContext));
    app.use('/api', csrf.use.bind(csrf));
    app.useGlobalGuards(new AuthNPaasGuard(new Reflector()));
    app.useGlobalFilters(filter);
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
    const native = { user_id: scope.actorUserId, tenant_id: scope.tenantId,
      app_id: 'app_17bzc551rsg', env: 'runtime', roles: [], is_system_account: false };
    const request = async (name, path, options = {}) => {
      const before = queryLog.length;
      const entryBefore = entries.length;
      const headers = {
        'x-larkgw-suda-webuser': encodeURIComponent(JSON.stringify(options.native ?? native)),
        'x-suda-csrf-token': 'constructed-q1-csrf',
        cookie: `suda-csrf-token=constructed-q1-csrf${options.noSession ? '' : `; wl_session=${options.token ?? token}`}`,
      };
      if (options.noCsrf) delete headers['x-suda-csrf-token'];
      const response = await fetch(`${base}/api/canonical-host/engineering-issues${path}`, {
        method: options.method ?? 'POST', headers,
      });
      const rawBody = await response.text();
      let body;
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
      const receipt = { name, status: response.status, body,
        serviceCalls: entries.length - entryBefore, sqlQueries: queryLog.length - before };
      receipts.push(receipt);
      t.diagnostic(`CONSTRUCTED_HTTP_RECEIPT ${JSON.stringify(receipt)}`);
      return receipt;
    };
    // Additional HTTP contracts reuse the same real transport and session chain,
    // while owning their separate named test and cold component instances.
    if (scenario) {
      await scenario(request);
      assert.ok(entries.length > 0, 'scenario reaches the real rebuild service');
      assert.ok(sessionReads.some(read => read.inTransaction), 'scenario revalidates the persisted session in a transaction');
      assert.ok(entries.every(entry => entry.role === 'service_role_wiselink_jobaid_test' &&
        entry.actor === scope.actorUserId && entry.nativeSystemAccount === false));
      assert.ok(sessionReads.filter(read => read.inTransaction).every(read =>
        read.role === 'authenticated_wiselink_jobaid_test' && read.actor === scope.actorUserId));
      t.diagnostic(`CONSTRUCTED_HTTP_EXTRA_SCOPE ${JSON.stringify({ entries,
        transactionSessionReads: sessionReads.filter(read => read.inTransaction).length })}`);
      return receipts;
    }
    const deniedBefore = [
      ['missing-session-rejected', { noSession: true }, 401],
      ['unknown-session-rejected', { token: 'not-a-session' }, 401],
      ['expired-session-rejected', { token: expiredToken }, 401],
      ['revoked-session-rejected', { token: revokedToken }, 401],
      // The session row is invisible under the other browser actor's RLS,
      // before the higher-level identity-match check can run.
      ['wrong-actor-rejected', { native: { ...native, user_id: 'other-actor' } }, 401],
      ['wrong-tenant-rejected', { native: { ...native, tenant_id: 'other-tenant' } }, 403],
    ];
    for (const [name, options, expectedStatus] of deniedBefore) {
      const denied = await request(name, '/projection/rebuild?limit=2', options);
      assert.equal(denied.status, expectedStatus);
      assert.equal(denied.serviceCalls, 0);
    }
    for (const [name, nativeOverride, expectedStatus] of [
      ['system-account-rejected', { ...native, is_system_account: true }, 503],
      ['wrong-app-rejected', { ...native, app_id: 'constructed-other-app' }, 503],
      ['anonymous-login-rejected', { ...native, user_id: '', login_url: 'https://constructed.invalid/login' }, 401],
    ]) {
      const denied = await request(name, '/projection/rebuild?limit=2', { native: nativeOverride });
      assert.equal(denied.status, expectedStatus);
      assert.equal(denied.serviceCalls, 0);
      assert.equal(denied.sqlQueries, 0);
    }
    const badLimit = await request('invalid-limit-rejected', '/projection/rebuild?limit=101');
    assert.equal(badLimit.status, 400);
    assert.equal(badLimit.serviceCalls, 0);
    assert.equal(badLimit.sqlQueries, 0);
    const badCsrf = await request('missing-csrf-rejected', '/projection/rebuild?limit=2', { noCsrf: true });
    assert.equal(badCsrf.status, 403);
    assert.equal(badCsrf.serviceCalls, 0);
    assert.equal(badCsrf.sqlQueries, 0);
    const admitted = await request('ordinary-final-user-rebuild', '/projection/rebuild?limit=2');
    assert.equal(admitted.status, 201);
    assert.deepEqual(admitted.body, { attempted: 2, rebuilt: 2, failed: 0 });
    assert.equal(admitted.serviceCalls, 1);
    assert.ok(admitted.sqlQueries > 0);
    assert.deepEqual(entries, [{ role: 'service_role_wiselink_jobaid_test',
      actor: scope.actorUserId, tenantId: scope.tenantId, nativeSystemAccount: false }]);
    assert.ok(sessionReads.filter(read => read.tokenMatched && read.inTransaction).length >= 2,
      'each pending item must revalidate the persisted session inside its transaction');
    assert.ok(sessionReads.filter(read => read.tokenMatched && read.inTransaction).every(read =>
      read.role === 'authenticated_wiselink_jobaid_test' && read.actor === scope.actorUserId));
    t.diagnostic(`CONSTRUCTED_HTTP_SQL_IDENTITY ${JSON.stringify(entries[0])}`);
    const search = await request('ordinary-final-user-current-search', '?search=condition&scope=CURRENT', { method: 'GET' });
    assert.equal(search.status, 200);
    assert.equal(search.body.hits.length, 2);
    assert.ok(search.body.hits.every(hit => hit.workRef === currentRef));
    assert.deepEqual(search.body.hits.map(hit => hit.issueKey).sort(), ['condition', 'unrelated']);
    const history = await request('ordinary-final-user-history-search', '?search=When%20is%20replacement%20allowed%3F&scope=HISTORY', { method: 'GET' });
    assert.equal(history.status, 200);
    assert.ok(history.body.hits.some(hit => hit.workRef === baselineRef && hit.issueKey === 'condition'));
    const exact = await request('ordinary-final-user-exact-read',
      `/work?subjectKind=WORK_ITEM&subjectId=${scope.workItemId}&workRef=${encodeURIComponent(currentRef)}&issueKey=condition`,
      { method: 'GET' });
    assert.equal(exact.status, 200);
    assert.deepEqual(exact.body.issue, JSON.parse(JSON.stringify(content.issues[0])));
    const wiki = await request('ordinary-final-user-current-wiki',
      `/catalogue/work?subjectKind=WORK_ITEM&subjectId=${scope.workItemId}&workRef=${encodeURIComponent(currentRef)}`,
      { method: 'GET' });
    assert.equal(wiki.status, 200);
    assert.deepEqual(wiki.body.content, JSON.parse(JSON.stringify(content)));

    for (const [name, forgedRef, forgedSubject] of [
      ['forged-object-read-only', 'q1-forged-object-ref', 'WI-not-owned'],
      ['forged-revision-read-only', 'q1-forged-revision-ref', scope.workItemId],
    ]) {
      await fixtureSql`INSERT INTO engineering_search_projection_pending
        (tenant_id,exact_revision_ref,owner_kind,owner_id,subject_id,last_error,attempts)
        VALUES (${scope.tenantId},${forgedRef},'USER',${scope.actorUserId},${forgedSubject},'',0)`;
      const deniedItem = await request(name, '/projection/rebuild?limit=2');
      assert.equal(deniedItem.status, 201);
      assert.deepEqual(deniedItem.body, { attempted: 1, rebuilt: 0, failed: 1 });
      const [unchanged] = await fixtureSql`SELECT attempts,last_error FROM engineering_search_projection_pending
        WHERE tenant_id=${scope.tenantId} AND exact_revision_ref=${forgedRef}`;
      assert.deepEqual([unchanged.attempts, unchanged.last_error], [0, '']);
      await fixtureSql`DELETE FROM engineering_search_projection_pending
        WHERE tenant_id=${scope.tenantId} AND exact_revision_ref=${forgedRef}`;
    }

    // A warm request cache must not authorize a later item after revocation.
    // Both pending entries were already recovered once; this is a derived-only
    // replay and cleanup leaves the authoritative bodies untouched.
    await fixtureSql`INSERT INTO engineering_search_projection_pending
      (tenant_id,exact_revision_ref,owner_kind,owner_id,subject_id,last_error,attempts)
      VALUES (${scope.tenantId},${baselineRef},'USER',${scope.actorUserId},${scope.workItemId},'',0),
        (${scope.tenantId},${currentRef},'USER',${scope.actorUserId},${scope.workItemId},'',0)`;
    let itemValidations = 0;
    sessionStore.validate = async function (opaque, database) {
      if (opaque === token && database && ++itemValidations === 2)
        await fixtureSql`UPDATE identity_session SET revoked_at=now()
          WHERE session_token_hash=${createHash('sha256').update(token).digest('hex')}`;
      return originalValidate.call(this, opaque, database);
    };
    const interrupted = await request('revoked-between-items-rejected', '/projection/rebuild?limit=2');
    assert.equal(interrupted.status, 401);
    assert.equal(interrupted.serviceCalls, 1);
    assert.equal(itemValidations, 2);
    const afterInterruption = await fixtureSql`SELECT exact_revision_ref,attempts,last_error
      FROM engineering_search_projection_pending WHERE tenant_id=${scope.tenantId}
        AND owner_id=${scope.actorUserId} ORDER BY exact_revision_ref`;
    assert.equal(afterInterruption.length, 1);
    assert.equal(afterInterruption[0].attempts, 0);
    assert.equal(afterInterruption[0].last_error, '');
    await fixtureSql`DELETE FROM engineering_search_projection_pending
      WHERE tenant_id=${scope.tenantId} AND owner_id=${scope.actorUserId}`;
  } finally {
    searchService.rebuildProjection = originalRebuild;
    sessionStore.validate = originalValidate;
    if (app) await app.close();
    for (const [key, value] of oldEnv) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  return receipts;
}

// Manually checked against the constructed two-sentence source. No model candidate,
// OEM content acceptance, risk score, remote plugin, or product model call is involved.
function proposal(corrected = false) {
  return {
    schemaVersion: 'wiselink.jobaid-problem-work.v3',
    headline: corrected
      ? 'Normal inspection does not exclude intermittent failure'
      : 'Replacement requires a persistent indication',
    listBrief: corrected
      ? 'Preserve both the replacement condition and the inspection limitation.'
      : 'The indication must persist after 5 seconds.',
    overview: corrected
      ? source.excerpt
      : 'Replacement is conditional on a persistent indication.',
    roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
    completionReason:
      'The source is read; operational frequency remains unknown.',
    changeSummary: corrected
      ? 'Clarify the inspection limitation.'
      : 'Record the source condition.',
    unchangedExplanation: 'Keep the unrelated issue intact.',
    issues: [
      {
        issueKey: 'condition',
        question: corrected
          ? 'Can a normal inspection exclude intermittent failure?'
          : 'When is replacement allowed?',
        body: `${corrected ? source.excerpt : source.excerpt.split('. ')[0] + '.'} [[${source.evidenceRef}]]`,
        riskScenarios: [
          {
            scenario: 'Intermittent indication',
            conditions: ['A normal inspection can occur between indications.'],
            method: 'JA_AC_R01',
            severity: null,
            likelihood: null,
            importantEvent: null,
            limitations: ['No operational severity or frequency is provided.'],
            controlComparison: 'Keep the unknown severity and likelihood.',
          },
        ],
        measures: [],
        otherClassifications: [],
        requirementHandling: [],
        openQuestions: [
          {
            question: 'Is a continuous record available?',
            affects: 'Frequency',
            nextEvidence: 'Continuous record',
            reason: 'A single inspection does not resolve intermittency.',
          },
        ],
      },
    ],
    unchangedIssueKeys: corrected ? ['unrelated'] : [],
    retiredIssues: [],
  };
}

test(
  'Q1 fixed Review work, exact dependencies and recovery on disposable PostgreSQL',
  { skip: !databaseUrl, concurrency: false },
  async (t) => {
    const url = new URL(databaseUrl);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.match(url.pathname, /^\/wiselink_jobaid_test_q1_[a-z0-9_]+$/u);
    const sql = postgres(databaseUrl, { max: 4, onnotice() {} });
    try {
      await resetQ1Database(sql);
      await prepareOpaqueSessionFixture(sql);
      const queryLog = [];
      const db = drizzle(sql, { logger: { logQuery(query) { queryLog.push(query); } } });
      const sqlContext = new SqlExecutionContextMiddleware({
        roleSchema: 'wiselink_jobaid_test',
      });
      const projection = new EngineeringSearchProjectionWriter(db);
      const actors = new EngineeringMatterWorkingRepository(
        db,
        sqlContext,
        { roleSchema: 'wiselink_jobaid_test' },
        projection,
      );
      const work = new JobAidWorkRepository(db, actors, projection);
      const reviews = new ReviewConversationRepository(db);
      const workItems = new MiaodaWorkItemRepository(db);
      const objectAccess = new MiaodaHostedCanonicalObjectAccessAdapter(workItems);
      const sessionStore = new SessionStore(new IdentityRepository(db));
      const sessions = new SessionResolver(sessionStore,
        { applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime' }, sqlContext);
      const browserScope = new DialogueBrowserScope(sessions);
      const attempts = new ActionAttemptLifecycleService(
        new ActionAttemptRepository(db),
        fixedModelSettings(),
      );
      const inContext = (userId, system, callback) =>
        new Promise((resolve, reject) =>
          sqlContext.use(
            { userContext: { userId, isSystemAccount: system, roles: [] } },
            {},
            () => Promise.resolve().then(callback).then(resolve, reject),
          ),
        );
      const hosted = (callback) => inContext('-1', true, callback);
      const browser = (callback) =>
        inContext(scope.actorUserId, false, callback);
      const current = async () =>
        (
          await workItems.loadTenantScopedProjection(
            scope.workItemId,
            scope.tenantId,
          )
        ).projection;
      const registrar = {
        getTenantScopedByWorkItemId: current,
        compareAndSet: (input) => workItems.compareAndSet(input),
      };
      let artifactWrites = 0;
      const artifactStore = {
        persistAndReadback: async (bytes) => {
          artifactWrites += 1;
          return {
            artifact: {
              ref: `artifact://q1/${artifactWrites}`,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              byteLength: bytes.byteLength,
              mediaType: 'application/json',
              storeRole: 'U0_PARSED_PACKAGE',
            },
          };
        },
      };
      const original = originalFixture();
      original.binding.documentVersionId = 'dv-job';
      original.source.units = [original.source.units[0]];
      original.source.units[0].payload = { text: source.excerpt };
      const originalReader = {
        readDocumentOriginal: async () => ({
          original,
          structuredSource: original.source,
          run: {
            ...original.binding,
            manifestArtifact: {
              readback: 'VERIFIED',
              relativePath: 'original/manifest.json',
              sha256: 'b'.repeat(64),
              byteLength: 100,
            },
          },
        }),
      };
      // Only parse discovery is stubbed; every work, Review, lease and CAS uses SQL/RLS.
      work.publishedOriginalBinding = work.publishedOriginalBindingForRequest =
        async () => ({
          parseRunId: original.binding.parseRunId,
        });
      const common = {
        buildForWorkItemWithEvidence: async (item) => ({
          common: projectCommonAssessmentContext(
            item,
            {
              context: { status: 'UNAVAILABLE', reason: 'Q1_OFFLINE' },
              documentReadingStatus: 'AVAILABLE',
              items: [],
              sections: [],
              resourceRefs: [],
            },
            [],
          ),
          availableReadingEvidence: [],
        }),
      };
      const service = new CanonicalJobAidProblemService(
        registrar,
        artifactStore,
        {},
        {
          authorize: async ({ action }) => ({
            allowed: true,
            action,
            permissionSnapshotVersion: 'q1',
          }),
        },
        { freshRead: async () => ({ permissionSnapshotVersion: 'q1' }) },
        attempts,
        workItems,
        reviews,
        common,
        work,
        undefined,
        originalReader,
        { read: async () => null },
        db,
        undefined,
        objectAccess,
      );
      const reviewService = new CanonicalHostOpenClawReviewService(
        reviews,
        workItems,
        {},
        {},
        attempts,
        artifactStore,
        {},
        {},
        common,
        undefined,
        actors,
        service,
      );
      const [mapping] = await sql`INSERT INTO identity_subject_mapping
        (miaoda_user_id,miaoda_tenant_id,expected_client_id,status,feishu_open_id,feishu_tenant_key,revision)
        VALUES ('actor-job','tenant-job','cli_aadde8b579f95bc9','ACTIVE','q1-open-job','q1-tenant-key',1)
        RETURNING id`;
      const identity = { subjectMappingId: mapping.id, provenance: 'FEISHU_OAUTH_USER_ACCESS_TOKEN',
        miaodaUserId: scope.actorUserId, tenantId: scope.tenantId, feishuUserId: null,
        feishuOpenId: 'q1-open-job', namespacedSubject: { namespace: 'FEISHU_OPEN_ID',
          subject: 'q1-open-job', tenantKey: 'q1-tenant-key' }, verifiedAt: new Date().toISOString() };
      const opaqueSession = await browser(() => sessionStore.create(identity));
      const [ordinarySession] = await sql`SELECT aily_access_token_sealed,aily_access_token_expires_at
        FROM identity_session WHERE id=${opaqueSession.sessionId}`;
      assert.equal(ordinarySession.aily_access_token_sealed, null);
      assert.equal(ordinarySession.aily_access_token_expires_at, null);
      const expiredSession = await browser(() => sessionStore.create(identity));
      const revokedSession = await browser(() => sessionStore.create(identity));
      await sql`UPDATE identity_session SET expires_at=now()-interval '1 second'
        WHERE session_token_hash=${createHash('sha256').update(expiredSession.token).digest('hex')}`;
      await sql`UPDATE identity_session SET revoked_at=now()
        WHERE session_token_hash=${createHash('sha256').update(revokedSession.token).digest('hex')}`;
      await sql`INSERT INTO work_item(work_item_id,tenant_id,requested_by_user_id,revision,document_version_id,projection_json)
        VALUES ('WI-job','tenant-job','actor-job',1,'dv-job',${JSON.stringify(initialProjection(scope.workItemId))})`;
      await sql`INSERT INTO review_conversation(review_conversation_id,tenant_id,actor_id,work_item_id,openclaw_agent_id,openclaw_session_key,
        started_at_revision,last_synced_revision,status,created_at,last_active_at)
        VALUES ('RC-q1','tenant-job','actor-job','WI-job','wiselink-engineering','review:q1',1,1,'ACTIVE',now(),now())`;
      const rowById = async (id) =>
        (
          await db
            .select()
            .from(actionAttempt)
            .where(eq(actionAttempt.attemptId, id))
        )[0];
      const seedAttempt = async (id, type, status, baseRevision = 1) => {
        await sql`INSERT INTO action_attempt(attempt_id,operation_ref,work_item_id,tenant_id,actor_user_id,action_type,request_origin,status,
          input_revision,base_revision,document_version_id,task_input_hash,lease_owner,lease_token,lease_generation,lease_expires_at,deadline_at,created_at,updated_at,trigger_request_id)
          VALUES (${id},${`AQ-${id}`},'WI-job','tenant-job','actor-job',${type},'OPENCLAW_MCP_V1',${status},${baseRevision},${baseRevision},
          'dv-job',${'a'.repeat(64)},'service-job','lease-job',1,now()+interval '1 hour',now()+interval '2 hours',now(),now(),${`Q1-trigger-${id}`})`;
        return rowById(id);
      };
      const context = (previous) => ({
        methodBinding: JOBAID_METHOD_BINDING,
        workItemId: scope.workItemId,
        previous,
        evidence,
        readSourceRefs: evidence.map((item) => item.evidenceRef),
        capabilities: [],
        history: {
          required: false,
          priorAssessmentRefs: [],
          engineeringDocumentRefs: [],
          coverage: 'NOT_REQUIRED',
          limitation: null,
        },
      });
      // Authenticated identity is a local transport fixture; the real reader still
      // checks SQL/RLS ownership and active official actor mapping on every read.
      const searchActor = {
        userId: scope.actorUserId, tenantId: scope.tenantId, roles: [],
        objectAccessActor: {
          principalKind: 'FINAL_USER', transport: 'MIAODA_AUTHENTICATED_HTTP',
          canonicalSubject: { namespace: 'MIAODA_USER_ID', id: scope.actorUserId },
          tenantId: scope.tenantId, applicationScopeId: 'app_17bzc551rsg',
          subjectDecision: { applicationScopeId: 'app_17bzc551rsg',
            tenantId: scope.tenantId, source: 'MIAODA_GATEWAY_USER_CONTEXT',
            version: 'miaoda-hosted-native-sso.v1' },
          workspaceId: null, workspaceProvenance: 'UNAVAILABLE',
          identityProvenance: 'MIAODA_GATEWAY_USER_CONTEXT',
          applicationScopeProvenance: 'MIAODA_GATEWAY_APP_CONTEXT', env: 'runtime',
          feishuUserId: null, feishuOpenId: null, feishuIdentityProvenance: 'UNAVAILABLE',
          sessionId: null, sessionRevision: null, sessionProvenance: 'UNAVAILABLE',
        },
      };
      const knowledgeIdentity = (revision) => ({
        subjectKind: 'WORK_ITEM', subjectId: scope.workItemId,
        workRef: revision.workRevisionRef,
      });
      // The tested WorkItem reader is the same service instance as Review save.
      const searchService = new EngineeringIssueSearchService(db, service, {}, projection,
        undefined, undefined, sessions);
      const coldHttpRecovery = () => {
        const coldDb = drizzle(sql, { logger: { logQuery(query) { queryLog.push(query); } } });
        const coldWriter = new EngineeringSearchProjectionWriter(coldDb);
        const coldActors = new EngineeringMatterWorkingRepository(coldDb, sqlContext,
          { roleSchema: 'wiselink_jobaid_test' }, coldWriter);
        const coldWork = new JobAidWorkRepository(coldDb, coldActors, coldWriter);
        const coldItems = new MiaodaWorkItemRepository(coldDb);
        const coldReader = new CanonicalJobAidProblemService(registrar, artifactStore, {}, {}, {},
          attempts, coldItems, new ReviewConversationRepository(coldDb), common, coldWork,
          undefined, originalReader, undefined, coldDb, undefined,
          new MiaodaHostedCanonicalObjectAccessAdapter(coldItems));
        const coldStore = new SessionStore(new IdentityRepository(coldDb));
        const coldSessions = new SessionResolver(coldStore,
          { applicationScopeId: 'app_17bzc551rsg', sessionEnvironment: 'runtime' }, sqlContext);
        return { db: coldDb, writer: coldWriter, sessionStore: coldStore,
          searchService: new EngineeringIssueSearchService(coldDb, coldReader, {}, coldWriter,
            undefined, undefined, coldSessions), browserScope: new DialogueBrowserScope(coldSessions) };
      };
      const invokeColdHttp = async (h, token, scenario) => exerciseProjectionHttpRecovery({
        t, db: h.db, sqlContext, searchService: h.searchService, browserScope: h.browserScope,
        sessionStore: h.sessionStore, token, queryLog, scenario,
      });
      const seedHttpRetryMarker = async ref => sql`INSERT INTO engineering_search_projection_pending
        (tenant_id,exact_revision_ref,owner_kind,owner_id,subject_id,last_error,attempts)
        VALUES (${scope.tenantId},${ref},'USER',${scope.actorUserId},${scope.workItemId},'',0)`;
      const installHttpIndexFailure = async ref => sql.unsafe(`
        CREATE FUNCTION q1_http_search_failure() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.exact_revision_ref = '${ref.replaceAll("'", "''")}'
          THEN RAISE EXCEPTION 'Q1_HTTP_DERIVED_INDEX_FAILURE'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER q1_http_search_failure BEFORE INSERT ON engineering_search_projection
          FOR EACH ROW EXECUTE FUNCTION q1_http_search_failure();`);
      const removeHttpIndexFailure = async () => sql.unsafe(`
        DROP TRIGGER IF EXISTS q1_http_search_failure ON engineering_search_projection;
        DROP FUNCTION IF EXISTS q1_http_search_failure();`);
      // Deterministically pause only after the real PostgreSQL transaction has
      // rolled back. The competing completion still enters through HTTP.
      const holdFailedHttpRollback = h => {
        let resume; let observed; let held = false; let timer;
        const released = new Promise(resolve => { resume = resolve; });
        const failed = new Promise((resolve, reject) => {
          observed = resolve;
          timer = setTimeout(() => reject(new Error('HTTP_SQL_FAILURE_BARRIER_TIMEOUT')), 10000);
          timer.unref();
        });
        const original = h.db.transaction.bind(h.db);
        h.db.transaction = async (...args) => {
          try { return await original(...args); }
          catch (error) {
            if (!held) {
              let cause = error; let code;
              for (let depth = 0; depth < 5 && cause; depth += 1) {
                if (typeof cause.code === 'string') code = cause.code;
                cause = cause.cause;
              }
              assert.equal(code, 'P0001', 'barrier must follow a real projection SQL exception');
              held = true; clearTimeout(timer); observed(); await released;
            }
            throw error;
          }
        };
        return { failed, resume, restore: () => { clearTimeout(timer); h.db.transaction = original; } };
      };
      // Pending writes use the existing Hosted service actor scope. Consumer
      // search/expansion below run separately as the authenticated browser actor.
      const rebuild = (writer) => hosted(() => work.withActorScope(scope.actorUserId,
        () => writer.rebuildPending({ tenantId: scope.tenantId, actorUserId: scope.actorUserId,
          verifySession: async () => {}, load: async (pending) => {
          assert.equal(pending.ownerId, scope.actorUserId);
          assert.equal(pending.subjectId, scope.workItemId);
          return (await service.readBrowserRevision(pending.subjectId, pending.revisionRef, searchActor)).content;
        } })));
      let saved;
      let baseline;
      let reviewTask;
      let reviewRow;
      let initialSaveArgs;
      let publicRoute;
      let publicRequest;
      let publicQueued;

      await t.test(
        'concurrent initial saves admit one body, reject stale CAS and changed request reuse',
        async () => {
          const row = await seedAttempt(
            'ATT-q1-initial',
            'OPENCLAW_DYNAMIC_EVALUATION',
            'RUNNING',
          );
          const command = proposal();
          command.issues.push({
            issueKey: 'unrelated',
            question: 'What replacement condition is stated?',
            body: `${source.excerpt} [[${source.evidenceRef}]]`,
            riskScenarios: [],
            measures: [],
            otherClassifications: [],
            requirementHandling: [],
            openQuestions: [],
          });
          const args = (id) => ({
            row,
            actorUserId: scope.actorUserId,
            fence,
            sourceBindings,
            requestId: id,
            expectedWorkRevision: 0,
            command,
            content: materializeJobAidWork(command, context(null)),
          });
          const results = await Promise.allSettled(
            ['initial-a', 'initial-b'].map((id) =>
              hosted(() => work.save(args(id))),
            ),
          );
          assert.equal(
            results.filter((result) => result.status === 'fulfilled').length,
            1,
          );
          assert.match(
            String(
              results.find((result) => result.status === 'rejected').reason,
            ),
            /JOBAID_WORK_REVISION_CONFLICT/u,
          );
          saved = results.find((result) => result.status === 'fulfilled').value
            .revision;
          const replay = await hosted(() => work.save(args(saved.requestId)));
          assert.equal(replay.replayed, true);
          assert.deepEqual(replay.revision, saved);
          await assert.rejects(
            hosted(() =>
              work.save({ ...args(saved.requestId), command: proposal(true) }),
            ),
            /JOBAID_SAVE_REQUEST_REUSE/u,
          );
          await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${row.attemptId}`;
          baseline = saved;
          initialSaveArgs = args(saved.requestId);
          // Seed an already committed base/Overall fixture. This does not assert model quality.
          const item = await current();
          item.integratedAssessment = {
            status: 'OVERALL_CANDIDATE_READY',
            baseRules: service.baseProjection(item, row, saved, {
              ref: 'artifact://base',
              sha256: 'c'.repeat(64),
              byteLength: 100,
              mediaType: 'application/json',
              storeRole: 'U0_PARSED_PACKAGE',
            }),
            overallSynthesis: {
              status: 'CANDIDATE_ONLY',
              revision: 1,
              actionAttemptId: 'ATT-old-overall',
              basedOnJobAidWorkRevisionRef: saved.workRevisionRef,
              readingResult: jobAidReadingResult(saved),
              staleReason: null,
              artifact: {
                ref: 'artifact://old-overall',
                sha256: 'e'.repeat(64),
                byteLength: 1,
                mediaType: 'application/json',
                storeRole: 'U0_PARSED_PACKAGE',
              },
            },
            overallForAeoConfirmation: null,
          };
          item.integratedAssessment.overallForAeoConfirmation = {
            status: 'HUMAN_CONFIRMED',
            authority: 'CANONICAL_WORKITEM_SERVER_FRESH_READ',
            workItemRevision: 1,
            overallRevision: 1,
            overallArtifactRef: 'artifact://old-overall',
            overallArtifactSha256: 'e'.repeat(64),
            actionAttemptId: 'ATT-old-confirmation',
            confirmingActorUserId: scope.actorUserId,
            confirmedAt: '2026-10-02T00:00:00.000Z',
          };
          item.aeo = {
            status: 'CANDIDATE_AUTHORING_IN_PROGRESS',
            targetIdentity: 'AEO-q1',
            disposition: 'ADOPT',
            authorityLevel: 'candidate_only',
            sourceCandidateCount: 1,
            automaticallyAdopted: false,
            engineeringApproved: false,
            actionAttemptId: 'ATT-old-aeo',
            ownerCommit: '74333547ae5cd1878259812353d59563cc9041da',
            sourceOverall: {
              revision: 1,
              artifactRef: 'artifact://old-overall',
              artifactSha256: 'e'.repeat(64),
              confirmationActionAttemptId: 'ATT-old-confirmation',
              confirmedWorkItemRevision: 1,
              engineerReviewRevision: null,
              engineerReviewArtifactSha256: null,
            },
            artifacts: [],
          };
          await sql`UPDATE work_item SET projection_json=${JSON.stringify(item)} WHERE work_item_id='WI-job'`;
          await seedAttempt(
            'ATT-old-overall',
            'OPENCLAW_OVERALL_SYNTHESIS',
            'SUCCEEDED',
          );
        },
      );

      await t.test(
        'ordinary authenticated regeneration keeps the same base work through real reserve and Hosted begin',
        async () => {
          const before = await current();
          const overall = new CanonicalHostOpenClawOverallService(registrar, artifactStore,
            workItems, {}, {}, {}, attempts, {}, common, service);
          const route = new CanonicalHostOverallRegenerationService(
            {resolve:async()=>({actor:{tenantId:scope.tenantId,canonicalSubject:{id:scope.actorUserId}}})},
            {freshRead:async()=>({allowed:true,action:'REQUEST_OVERALL_REGENERATION',tenantId:scope.tenantId,
              actorUserId:scope.actorUserId,workItemId:scope.workItemId,workItemRevision:(await current()).revision,
              requestId:before.requestId,documentVersionId:'dv-job',authorizationFingerprint:'q1'})},
            registrar,{nowIso:()=> '2026-10-02T00:00:00.000Z'},overall,attempts,service);
          const request={requestId:'Q1-normal-base-regeneration',expectedRevision:before.revision,
            sourceIdentity:{documentVersionId:before.source.documentVersionId,
              sourceArtifactId:before.source.sourceArtifactId,sourceFileSha256:before.source.sourceFileSha256,
              packageId:before.package.packageId,packageArtifactSha256:before.package.artifact.sha256}};
          try {
            const [role]=await browser(()=>db.execute(contextSql`SELECT current_user AS role,current_setting('app.user_id',true) AS actor`));
            assert.equal(role.role,'authenticated_wiselink_jobaid_test');assert.equal(role.actor,scope.actorUserId);
            const queued=await browser(()=>route.request(scope.workItemId,request,{}));
            const replay=await browser(()=>route.request(scope.workItemId,request,{}));
            assert.equal(replay.replayed,true);assert.equal(replay.regeneration.attemptRef,queued.regeneration.attemptRef);
            const item=await current();assert.equal(item.revision,before.revision+1);
            assert.equal(item.overallRegenerationRequest.jobAidReviewWork,undefined);
            const begun=await hosted(()=>service.begin(item,{...scope,principalId:fence.principalId,
              authorizationFingerprint:'q1'},'OVERALL_CONSISTENCY'));
            assert.equal(begun.attemptRef,queued.regeneration.attemptRef);
            assert.equal(begun.task.modelInput.previousWork.workRevisionRef,baseline.workRevisionRef);
            assert.equal(begun.task.modelInput.previousWork.workRevision,baseline.workRevision);
            assert.equal(begun.task.modelInput.modelInput.expectedWorkRevision,baseline.workRevision);
            await sql`UPDATE action_attempt SET status='CANCELLED' WHERE operation_ref=${begun.attemptRef}`;
          } finally {
            // Disposable owner fixture restores the formal row before independent Review cases.
            // Runtime request/reserve/begin above use their actual public/Hosted SQL roles.
            await sql`UPDATE work_item SET revision=${before.revision},projection_json=${JSON.stringify(before)} WHERE work_item_id='WI-job'`;
          }
        },
      );

      await t.test(
        'actual Review persistence rolls back body, receipt and pending together, then recovers once',
        async () => {
          reviewRow = await seedAttempt(
            'ATT-q1-review',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
          );
          await sql`UPDATE action_attempt SET result_content_hash=${'d'.repeat(64)} WHERE attempt_id=${reviewRow.attemptId}`;
          const assessmentInput = `WLR7:${canonicalJson({
            schemaVersion: 'wiselink.3_1.review_engineer_input.v1.c7',
            userMessage: 'Clarify the inspection limitation.',
            attachments: [], purpose: 'UPDATE_ASSESSMENT', executionRequested: true,
          })}`;
          await sql`INSERT INTO review_turn(review_turn_id,review_conversation_id,engineer_supplied_input_id,tenant_id,actor_id,work_item_id,
          turn_no,request_id,input_revision,user_message,input_type,adoption_status,created_at)
          VALUES ('RT-q1','RC-q1','ESI-q1','tenant-job','actor-job','WI-job',1,'request-q1',1,${assessmentInput},'ENGINEER_TEXT','CANDIDATE_UNADOPTED',now())`;
          const binding = await hosted(() =>
            work.withActorTransaction(scope.actorUserId, (database) =>
              reviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          reviewTask = buildJobAidProblemTask({
            workItem: await current(),
            actorUserId: scope.actorUserId,
            permissionSnapshotVersion: 'q1',
            purpose: 'PROBLEM_REVIEW',
            sourceCatalog: evidence,
            sourceBindings,
            common: (await common.buildForWorkItemWithEvidence(await current()))
              .common,
            previousWork: baseline,
            expectedWorkRevision: 1,
            priorAssessmentRefs: [baseline.workRevisionRef],
          });
          const sealedReviewTask = sealTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
            actionAttemptId: reviewRow.attemptId,
            operationRef: reviewRow.operationRef,
            taskType: reviewRow.actionType,
            priority: 100,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            inputRevision: 1,
            baseRevision: 1,
            documentVersionId: 'dv-job',
            sourceRefs: [
              {
                ref: sourceBindings[0].artifactRef,
                sha256: sourceBindings[0].artifactSha256,
              },
            ],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: { jobAidContext: reviewTask },
            deadline: reviewRow.deadlineAt.toISOString(),
            idempotencyKey: 'q1:review:exact',
          });
          await sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(sealedReviewTask)},task_input_hash=${sealedReviewTask.inputHash} WHERE attempt_id=${reviewRow.attemptId}`;
          reviewRow = await rowById(reviewRow.attemptId);
          const candidate = {
            responseType: 'ANSWER',
            answer: 'Both conditions are retained.',
            sourceRefs: [source.evidenceRef],
            missingInputs: [],
            candidateEvidenceRefs: [source.evidenceRef],
            reviewActionDraft: null,
            affectedItemIds: [],
            warnings: [],
            actionAttemptRef: reviewRow.operationRef,
            provenance: {
              runtimeAppId: 'app_17c3zn24kv2',
              profileRef: 'wiselink-engineering',
              modelVersion: 'q1-constructed-not-called',
              promptVersion: 'q1-fixture',
              skillVersion: 'wiselink-research-and-synthesize@r09.c43',
              toolVersions: {
                'wiselink-openclaw-engineering-assessment': '1.2.0',
              },
              resultContentHash: 'd'.repeat(64),
            },
          };
          const authorized = {
            conversation: binding.conversation,
            turn: binding.turn,
            row: reviewRow,
            contract: { context: {}, jobAidContext: reviewTask },
          };
          const input = () => ({
            conversation: binding.conversation,
            turn: binding.turn,
            actionAttemptId: reviewRow.attemptId,
            candidate: structuredClone(candidate),
            completedAt: new Date(),
          });
          const originalPersist =
            reviews.persistOpenClawAssistantCandidate.bind(reviews);
          reviews.persistOpenClawAssistantCandidate = async (...args) => {
            await originalPersist(...args);
            throw new Error('Q1_AFTER_RECEIPT_ROLLBACK');
          };
          const persist = () =>
            hosted(() =>
              reviewService.persistJobAidCandidate(
                authorized,
                { ...candidate, jobAidWorkingDelta: proposal(true) },
                input(),
                fence,
                new Set(evidence.map((item) => item.evidenceRef)),
              ),
            );
          await assert.rejects(persist(), /Q1_AFTER_RECEIPT_ROLLBACK/u);
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            1,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM engineering_search_projection_pending`
            )[0].n,
            1,
          );
          assert.equal(
            (
              await sql`SELECT assistant_response FROM review_turn WHERE review_turn_id='RT-q1'`
            )[0].assistant_response,
            null,
          );
          reviews.persistOpenClawAssistantCandidate = originalPersist;
          const beforeProjection = (
            await sql`SELECT projection_json FROM work_item WHERE work_item_id='WI-job'`
          )[0].projection_json;
          const invalidate = service.invalidateReviewOverall.bind(service);
          service.invalidateReviewOverall = async (...args) => {
            await invalidate(...args);
            throw new Error('Q1_AFTER_STALE_ROLLBACK');
          };
          await assert.rejects(persist(), /Q1_AFTER_STALE_ROLLBACK/u);
          assert.equal(
            (
              await sql`SELECT projection_json FROM work_item WHERE work_item_id='WI-job'`
            )[0].projection_json,
            beforeProjection,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            1,
          );
          assert.equal(
            (
              await sql`SELECT assistant_response FROM review_turn WHERE review_turn_id='RT-q1'`
            )[0].assistant_response,
            null,
          );
          service.invalidateReviewOverall = invalidate;
          const first = await persist();
          const firstProjection = (
            await sql`SELECT projection_json,updated_at FROM work_item WHERE work_item_id='WI-job'`
          )[0];
          const replay = await persist();
          assert.equal(replay.replayed, true);
          assert.deepEqual(
            replay.turn.assistantCandidate.jobAidWorkingUpdate,
            first.turn.assistantCandidate.jobAidWorkingUpdate,
          );
          assert.deepEqual(
            (
              await sql`SELECT projection_json,updated_at FROM work_item WHERE work_item_id='WI-job'`
            )[0],
            firstProjection,
          );
          saved = await hosted(() => work.latestForRuntime(scope));
          assert.equal(saved.workRevision, 2);
          assert.equal(saved.previousWorkRevisionRef, baseline.workRevisionRef);
          assert.equal(
            saved.content.issues[0].issueRef,
            baseline.content.issues[0].issueRef,
          );
          assert.equal(
            saved.content.issues[0].body,
            proposal(true).issues[0].body,
          );
          assert.equal(
            saved.content.issues[0].question,
            proposal(true).issues[0].question,
          );
          assert.equal(saved.content.issues[0].riskScenarios[0].score, null);
          assert.equal(
            saved.content.issues[0].riskScenarios[0].riskGrade,
            null,
          );
          assert.deepEqual(saved.content.issues[0].sourceDependencies, [
            source.evidenceRef,
          ]);
          assert.deepEqual(
            saved.content.issues.find(
              (issue) => issue.issueKey === 'unrelated',
            ),
            baseline.content.issues.find(
              (issue) => issue.issueKey === 'unrelated',
            ),
          );
          await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${reviewRow.attemptId}`;
        },
      );

      await t.test(
        'constructed Review correction rebuilds pending through the real reader into CURRENT search and Wiki',
        async () => {
          // Search SQL unions both subject families. Keep the unused matter table
          // empty; every tested WorkItem revision/receipt/pending came from save.
          const columns = getTableConfig(engineeringMatterWorkRevision).columns
            .map((column) => `"${column.name}" ${column.getSQLType()}`);
          await sql.unsafe(`CREATE TABLE engineering_matter_work_revision (${columns.join(',')});
            ALTER TABLE engineering_matter_work_revision ENABLE ROW LEVEL SECURITY;
            GRANT SELECT ON engineering_matter_work_revision TO authenticated,service_role`);
          const before = await sql`SELECT assessment_work_revision_id,content_json
            FROM assessment_work_revision ORDER BY work_revision`;
          const receiptBefore = (await sql`SELECT assistant_response FROM review_turn
            WHERE review_turn_id='RT-q1'`)[0].assistant_response;
          const pending = await projection.listPending(scope.tenantId, scope.actorUserId);
          assert.deepEqual(pending.map((item) => item.revisionRef).sort(),
            [baseline.workRevisionRef, saved.workRevisionRef].sort());
          assert.ok(pending.every((item) => item.ownerKind === 'USER' &&
            item.ownerId === scope.actorUserId && item.subjectId === scope.workItemId));
          assert.equal((await sql`SELECT count(*)::int AS n FROM engineering_search_projection`)[0].n, 0);
          assert.deepEqual(saved.content.issues[0].riskScenarios[0].conditions,
            proposal(true).issues[0].riskScenarios[0].conditions);
          assert.deepEqual(saved.content.issues[0].measures, proposal(true).issues[0].measures);
          assert.equal(saved.content.headline, proposal(true).headline);
          assert.equal(saved.content.listBrief, proposal(true).listBrief);

          // These entries sort ahead of real refs. They must neither consume
          // the caller's LIMIT nor acquire an attempt/error write.
          await sql`INSERT INTO engineering_search_projection_pending
            (tenant_id,exact_revision_ref,owner_kind,owner_id,subject_id,last_error,attempts)
            VALUES (${scope.tenantId},'00-other-owner','USER','actor-other',${scope.workItemId},'',0),
              ('tenant-other','00-other-tenant','USER',${scope.actorUserId},${scope.workItemId},'',0)`;

          await exerciseProjectionHttpRecovery({ t, db, sqlContext, searchService,
            browserScope, sessionStore, fixtureSql: sql, token: opaqueSession.token,
            expiredToken: expiredSession.token, revokedToken: revokedSession.token, queryLog,
            currentRef: saved.workRevisionRef, baselineRef: baseline.workRevisionRef,
            content: saved.content });
          assert.deepEqual(await sql`SELECT assessment_work_revision_id,content_json
            FROM assessment_work_revision ORDER BY work_revision`, before);
          assert.equal((await sql`SELECT assistant_response FROM review_turn
            WHERE review_turn_id='RT-q1'`)[0].assistant_response, receiptBefore);
          assert.deepEqual(await projection.listPending(scope.tenantId, scope.actorUserId), []);
          const foreignPending = await sql`SELECT tenant_id,exact_revision_ref,owner_id,attempts,last_error
            FROM engineering_search_projection_pending WHERE exact_revision_ref LIKE '00-other-%'
            ORDER BY exact_revision_ref`;
          assert.deepEqual(foreignPending.map(row => [row.exact_revision_ref, row.attempts, row.last_error]),
            [['00-other-owner', 0, ''], ['00-other-tenant', 0, '']]);
          await sql`DELETE FROM engineering_search_projection_pending WHERE exact_revision_ref LIKE '00-other-%'`;
          assert.equal((await sql`SELECT count(*)::int AS n FROM engineering_search_projection`)[0].n, 4);
          t.diagnostic(`CONSTRUCTED_HTTP_RECOVERY_ACCEPTED ${JSON.stringify({
            workRevisions: before.length, pendingBefore: pending.length, projectionRows: 4,
            authoritativeBodySha256: createHash('sha256').update(JSON.stringify(before)).digest('hex'),
            reviewReceiptSha256: createHash('sha256').update(receiptBefore).digest('hex'),
          })}`);
          // Fail only the derived index in real SQL. The authoritative Review
          // content and receipt must survive, and the failed pending must retry.
          // Recreate one derived-only gap after the successful HTTP contract;
          // the saved body and Review receipt remain the authoritative source.
          await sql`DELETE FROM engineering_search_projection
            WHERE exact_revision_ref=${saved.workRevisionRef}`;
          await sql`INSERT INTO engineering_search_projection_pending
            (tenant_id,exact_revision_ref,owner_kind,owner_id,subject_id,last_error,attempts)
            VALUES (${scope.tenantId},${saved.workRevisionRef},'USER',${scope.actorUserId},${scope.workItemId},'',0)`;
          await sql.unsafe(`CREATE FUNCTION q1_search_failure() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.exact_revision_ref = '${saved.workRevisionRef.replaceAll("'", "''")}'
              THEN RAISE EXCEPTION 'Q1_DERIVED_INDEX_FAILURE'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER q1_search_failure BEFORE INSERT ON engineering_search_projection
              FOR EACH ROW EXECUTE FUNCTION q1_search_failure();`);
          try {
            assert.deepEqual(await rebuild(projection),
              { attempted: 1, rebuilt: 0, failed: 1 });
            const retained = await projection.listPending(scope.tenantId, scope.actorUserId);
            assert.equal(retained.length, 1);
            assert.equal(retained[0].revisionRef, saved.workRevisionRef);
            assert.equal(retained[0].attempts, 1);
            assert.equal((await sql`SELECT count(*)::int AS n FROM engineering_search_projection
              WHERE exact_revision_ref=${saved.workRevisionRef}`)[0].n, 0);
            assert.deepEqual(await sql`SELECT assessment_work_revision_id,content_json
              FROM assessment_work_revision ORDER BY work_revision`, before);
          } finally {
            await sql.unsafe('DROP TRIGGER q1_search_failure ON engineering_search_projection; DROP FUNCTION q1_search_failure()');
          }
          // Cold writer/service: no in-memory saved-content loader or mock reader.
          const coldWriter = new EngineeringSearchProjectionWriter(db);
          const cold = new EngineeringIssueSearchService(db, service, {}, coldWriter);
          assert.deepEqual(await rebuild(coldWriter),
            { attempted: 1, rebuilt: 1, failed: 0 });
          assert.deepEqual(await rebuild(coldWriter),
            { attempted: 0, rebuilt: 0, failed: 0 });
          assert.deepEqual(await projection.listPending(scope.tenantId, scope.actorUserId), []);
          assert.deepEqual(await sql`SELECT assessment_work_revision_id,content_json
            FROM assessment_work_revision ORDER BY work_revision`, before);
          assert.equal((await sql`SELECT assistant_response FROM review_turn
            WHERE review_turn_id='RT-q1'`)[0].assistant_response, receiptBefore);
          const indexed = await sql`SELECT parent_context_ref,owner_id,original_or_work_text
            FROM engineering_search_projection WHERE exact_revision_ref=${saved.workRevisionRef}`;
          assert.equal(indexed.length, 2);
          assert.ok(indexed.every((row) => row.parent_context_ref === scope.workItemId &&
            row.owner_id === scope.actorUserId && !/immediate|clears intermittent/iu.test(row.original_or_work_text)));
          assert.match(indexed[0].original_or_work_text, /5 seconds/u);

          const previousFlag = process.env.WL_ENGINEERING_SEARCH_PROJECTION;
          try {
            for (const flag of ['0', '1']) {
              process.env.WL_ENGINEERING_SEARCH_PROJECTION = flag;
              assert.deepEqual((await browser(() => cold.search('When is replacement allowed?', searchActor))).hits, []);
              const history = await browser(() => cold.search('When is replacement allowed?', searchActor, 'HISTORY'));
              assert.ok(history.hits.length > 0);
              assert.ok(history.hits.every((hit) => hit.workRef === baseline.workRevisionRef &&
                hit.workRevision === 1 && hit.subjectId === scope.workItemId));
              const oldHit = history.hits.find((hit) => hit.issueKey === 'condition');
              assert.ok(oldHit);
              const oldRead = await browser(() => cold.read(oldHit, searchActor));
              assert.deepEqual(oldRead.issue, baseline.content.issues[0]);
              const currentHit = (await browser(() => cold.search('condition', searchActor))).hits;
              assert.equal(currentHit.length, 2);
              assert.deepEqual(currentHit.map((hit) => hit.issueKey).sort(), ['condition', 'unrelated']);
              assert.ok(currentHit.every((hit) => hit.workRef === saved.workRevisionRef && hit.workRevision === 2));
              const currentRead = await browser(() => cold.read(
                currentHit.find((hit) => hit.issueKey === 'condition'), searchActor));
              assert.deepEqual(currentRead.issue, saved.content.issues[0]);
              assert.ok(currentRead.evidence.some((item) => item.evidenceRef === source.evidenceRef &&
                item.excerpt === source.excerpt));
              assert.equal((await browser(() => cold.search('persists', searchActor))).hits
                .filter((hit) => hit.issueKey === 'condition')[0].workRef, saved.workRevisionRef);
            }
            const currentCatalogue = await browser(() => cold.catalogue('', 'CURRENT', undefined, searchActor));
            assert.equal(currentCatalogue.entries.length, 1);
            assert.equal(currentCatalogue.entries[0].headline, proposal(true).headline);
            assert.equal(currentCatalogue.entries[0].listBrief, proposal(true).listBrief);
            assert.equal(currentCatalogue.entries[0].workRef, saved.workRevisionRef);
            assert.equal(currentCatalogue.entries[0].current, true);
            const historical = await browser(() => cold.catalogue('', 'HISTORICAL', undefined, searchActor));
            assert.deepEqual(historical.entries.map((entry) => entry.workRef), [baseline.workRevisionRef]);
            assert.equal(historical.entries[0].headline, proposal().headline);
            assert.equal((await browser(() => cold.catalogue('When is replacement allowed?', 'CURRENT', undefined, searchActor)))
              .entries.length, 0);
            const wiki = await browser(() => cold.readKnowledge(knowledgeIdentity(saved), searchActor));
            assert.deepEqual(wiki.content, saved.content);
            assert.equal(wiki.overall, null);
            const oldWiki = await browser(() => cold.readKnowledge(knowledgeIdentity(baseline), searchActor));
            assert.deepEqual(oldWiki.content, baseline.content);
            assert.equal(oldWiki.entry.current, false);
            assert.equal(oldWiki.overall.status, 'STALE');
            assert.equal((await browser(() => service.readBrowser(scope.workItemId, searchActor))).overallStatus, 'STALE');

            // Revoke SQL source ownership, retaining saved bodies and derived
            // rows. Both consumers must perform a fresh authoritative check.
            await sql`UPDATE work_item SET requested_by_user_id='actor-revoked' WHERE work_item_id=${scope.workItemId}`;
            try {
              for (const flag of ['0', '1']) {
                process.env.WL_ENGINEERING_SEARCH_PROJECTION = flag;
                assert.deepEqual((await browser(() => cold.search('condition', searchActor))).hits, []);
                assert.deepEqual((await browser(() => cold.search('When is replacement allowed?', searchActor, 'HISTORY'))).hits, []);
                for (const revision of [baseline, saved]) {
                  const identity = knowledgeIdentity(revision);
                  const unavailable = (error) => error.statusCode === 404 && error.message === 'CANONICAL_WORK_ITEM_NOT_FOUND';
                  await assert.rejects(browser(() => cold.read({ ...identity, issueKey: 'condition' }, searchActor)), unavailable);
                  await assert.rejects(browser(() => cold.readKnowledge(identity, searchActor)), unavailable);
                }
              }
              assert.deepEqual((await browser(() => cold.catalogue('', 'ALL', undefined, searchActor))).entries, []);
              assert.deepEqual(await sql`SELECT assessment_work_revision_id,content_json
                FROM assessment_work_revision ORDER BY work_revision`, before);
            } finally {
              await sql`UPDATE work_item SET requested_by_user_id=${scope.actorUserId} WHERE work_item_id=${scope.workItemId}`;
            }
            assert.deepEqual((await browser(() => cold.readKnowledge(knowledgeIdentity(saved), searchActor))).content, saved.content);
          } finally {
            if (previousFlag === undefined) delete process.env.WL_ENGINEERING_SEARCH_PROJECTION;
            else process.env.WL_ENGINEERING_SEARCH_PROJECTION = previousFlag;
          }
        },
      );

      await t.test('HTTP projection SQL failure rolls back, retains exact pending, then cold HTTP retry is idempotent', async () => {
        const fresh = await browser(() => sessionStore.create(identity));
        const beforeBodies = await sql`SELECT assessment_work_revision_id,content_json FROM assessment_work_revision ORDER BY work_revision`;
        const beforeRows = await sql`SELECT entry_id,parent_context_ref,owner_id,original_or_work_text
          FROM engineering_search_projection WHERE exact_revision_ref=${saved.workRevisionRef} ORDER BY entry_id`;
        assert.equal(beforeRows.length, 2);
        await seedHttpRetryMarker(saved.workRevisionRef);
        await sql`INSERT INTO engineering_search_projection_pending
          (tenant_id,exact_revision_ref,owner_kind,owner_id,subject_id,last_error,attempts)
          VALUES (${scope.tenantId},'00-http-other-owner','USER','actor-other',${scope.workItemId},'',0)`;
        await installHttpIndexFailure(saved.workRevisionRef);
        try {
          await invokeColdHttp(coldHttpRecovery(), fresh.token, async request => {
            const failed = await request('http-sql-failure-keeps-pending', '/projection/rebuild?limit=1');
            assert.equal(failed.status, 201);
            assert.deepEqual(failed.body, { attempted: 1, rebuilt: 0, failed: 1 });
          });
          const [pending] = await sql`SELECT tenant_id,owner_kind,owner_id,subject_id,exact_revision_ref,attempts,last_error
            FROM engineering_search_projection_pending WHERE exact_revision_ref=${saved.workRevisionRef}`;
          assert.deepEqual(pending, { tenant_id: scope.tenantId, owner_kind: 'USER', owner_id: scope.actorUserId,
            subject_id: scope.workItemId, exact_revision_ref: saved.workRevisionRef, attempts: 1, last_error: 'P0001' });
          assert.deepEqual(await sql`SELECT entry_id,parent_context_ref,owner_id,original_or_work_text
            FROM engineering_search_projection WHERE exact_revision_ref=${saved.workRevisionRef} ORDER BY entry_id`, beforeRows);
        } finally { await removeHttpIndexFailure(); }
        await invokeColdHttp(coldHttpRecovery(), fresh.token, async request => {
          const recovered = await request('cold-http-retry-recovers', '/projection/rebuild?limit=1');
          assert.equal(recovered.status, 201);
          assert.deepEqual(recovered.body, { attempted: 1, rebuilt: 1, failed: 0 });
          const replay = await request('cold-http-retry-idempotent', '/projection/rebuild?limit=1');
          assert.equal(replay.status, 201);
          assert.deepEqual(replay.body, { attempted: 0, rebuilt: 0, failed: 0 });
        });
        assert.deepEqual(await sql`SELECT entry_id,parent_context_ref,owner_id,original_or_work_text
          FROM engineering_search_projection WHERE exact_revision_ref=${saved.workRevisionRef} ORDER BY entry_id`, beforeRows);
        assert.deepEqual(await sql`SELECT assessment_work_revision_id,content_json FROM assessment_work_revision ORDER BY work_revision`, beforeBodies);
        const [other] = await sql`SELECT attempts,last_error FROM engineering_search_projection_pending
          WHERE exact_revision_ref='00-http-other-owner'`;
        assert.deepEqual(other, { attempts: 0, last_error: '' });
        assert.equal((await sql`SELECT count(*)::int AS n FROM engineering_search_projection_pending
          WHERE owner_id=${scope.actorUserId}`)[0].n, 0);
        await sql`DELETE FROM engineering_search_projection_pending WHERE exact_revision_ref='00-http-other-owner'`;
      });

      await t.test('HTTP failure bookkeeping cannot resurrect a marker concurrently completed by another HTTP request', async () => {
        const fresh = await browser(() => sessionStore.create(identity));
        await seedHttpRetryMarker(saved.workRevisionRef);
        await installHttpIndexFailure(saved.workRevisionRef);
        const failing = coldHttpRecovery(); const hold = holdFailedHttpRollback(failing);
        try {
          await invokeColdHttp(failing, fresh.token, async request => {
            const first = request('http-failure-awaits-concurrent-completion', '/projection/rebuild?limit=1');
            try {
              await hold.failed;
              await removeHttpIndexFailure();
              await invokeColdHttp(coldHttpRecovery(), fresh.token, async concurrent => {
                const done = await concurrent('concurrent-http-completion', '/projection/rebuild?limit=1');
                assert.equal(done.status, 201);
                assert.deepEqual(done.body, { attempted: 1, rebuilt: 1, failed: 0 });
              });
            } finally { hold.resume(); }
            const failed = await first;
            assert.equal(failed.status, 201);
            assert.deepEqual(failed.body, { attempted: 1, rebuilt: 0, failed: 1 });
          });
          assert.equal((await sql`SELECT count(*)::int AS n FROM engineering_search_projection_pending
            WHERE exact_revision_ref=${saved.workRevisionRef}`)[0].n, 0);
          assert.equal((await sql`SELECT count(*)::int AS n FROM engineering_search_projection
            WHERE exact_revision_ref=${saved.workRevisionRef}`)[0].n, 2);
        } finally { hold.resume(); hold.restore(); await removeHttpIndexFailure(); }
      });

      await t.test('HTTP failure bookkeeping reauthorizes after rollback and leaves attempts unchanged when source ownership was revoked', async () => {
        const fresh = await browser(() => sessionStore.create(identity));
        await seedHttpRetryMarker(saved.workRevisionRef);
        await installHttpIndexFailure(saved.workRevisionRef);
        const failing = coldHttpRecovery(); const hold = holdFailedHttpRollback(failing);
        try {
          await invokeColdHttp(failing, fresh.token, async request => {
            const first = request('http-failure-after-source-revocation', '/projection/rebuild?limit=1');
            try {
              await hold.failed;
              await sql`UPDATE work_item SET requested_by_user_id='actor-revoked' WHERE work_item_id=${scope.workItemId}`;
            } finally { hold.resume(); }
            const failed = await first;
            assert.equal(failed.status, 201);
            assert.deepEqual(failed.body, { attempted: 1, rebuilt: 0, failed: 1 });
          });
          const [pending] = await sql`SELECT attempts,last_error FROM engineering_search_projection_pending
            WHERE exact_revision_ref=${saved.workRevisionRef}`;
          assert.deepEqual(pending, { attempts: 0, last_error: '' });
        } finally {
          hold.resume(); hold.restore(); await removeHttpIndexFailure();
          await sql`UPDATE work_item SET requested_by_user_id=${scope.actorUserId} WHERE work_item_id=${scope.workItemId}`;
          await sql`DELETE FROM engineering_search_projection_pending WHERE exact_revision_ref=${saved.workRevisionRef}`;
        }
      });

      await t.test(
        'actor admits only a current full UPDATE_ASSESSMENT Review receipt for zero-model Overall',
        async () => {
          const item = await browser(current);
          const exactInput = {
            workItem: item, tenantId: scope.tenantId,
            actorUserId: scope.actorUserId, expectedRevision: item.revision,
            reviewConversationId: 'RC-q1', reviewTurnId: 'RT-q1',
            workRevisionRef: saved.workRevisionRef,
            expectedWorkRevision: saved.workRevision,
          };
          const exact = () => browser(() =>
            service.exactSavedReviewWorkForProjection(exactInput));
          assert.equal(saved.basedOnWorkItemRevision, item.revision);
          assert.equal((await exact()).workRevisionRef, saved.workRevisionRef);
          await assert.rejects(browser(() =>
            service.exactSavedReviewWorkForProjection({
              ...exactInput, expectedRevision: item.revision + 1,
              workItem: { ...item, revision: item.revision + 1 },
            })), /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u);
          await sql`UPDATE action_attempt SET status='COMMITTING' WHERE attempt_id=${reviewRow.attemptId}`;
          try {
            await assert.rejects(exact(), /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u);
          } finally {
            await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${reviewRow.attemptId}`;
          }
          const [turn] = await sql`SELECT user_message,result_provenance_json FROM review_turn WHERE review_turn_id='RT-q1'`;
          const originalInput = turn.user_message;
          const originalProvenance = JSON.parse(turn.result_provenance_json);
          const corruptFixture = (mutate) => sql.begin(async (fixtureSql) => {
            await fixtureSql`SET LOCAL session_replication_role='replica'`;
            await mutate(fixtureSql);
          });
          const updateInput = async (change) => corruptFixture(async (fixtureSql) => {
            const input = JSON.parse(originalInput.slice('WLR7:'.length));
            change(input);
            const encoded = `WLR7:${canonicalJson(input)}`;
            await fixtureSql`UPDATE review_turn SET user_message=${encoded} WHERE review_turn_id='RT-q1'`;
            await fixtureSql`UPDATE engineer_supplied_input SET candidate_text=${encoded} WHERE engineer_supplied_input_id='ESI-q1'`;
          });
          try {
            await updateInput((input) => { input.purpose = 'CHAT'; });
            await assert.rejects(exact(), /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u);
            await updateInput((input) => { input.targetIssueKeys = ['condition']; });
            await assert.rejects(exact(), /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u);
            await updateInput(() => {});
            const matterScope = {
              schemaVersion: 'wiselink.3_1.matter_review_scope.v1',
              kind: 'ENGINEERING_MATTER', matterId: 'MAT-other',
              basedOnMatterRevisionId: 'MWR-other', expectedWorkingRevision: 1,
              targetClaimId: null,
              inputs: [{ inputId: 'MI-other', workItemId: scope.workItemId,
                workItemRevision: item.revision, documentVersionId: 'dv-job',
                resultRef: null, resultRevision: null }],
            };
            await corruptFixture(async (fixtureSql) => {
              await fixtureSql`UPDATE review_turn SET review_scope_json=${JSON.stringify(matterScope)} WHERE review_turn_id='RT-q1'`;
            });
            await assert.rejects(exact(), /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u);
          } finally {
            await corruptFixture(async (fixtureSql) => {
              await fixtureSql`UPDATE review_turn SET user_message=${originalInput},review_scope_json=null WHERE review_turn_id='RT-q1'`;
              await fixtureSql`UPDATE engineer_supplied_input SET candidate_text=${originalInput} WHERE engineer_supplied_input_id='ESI-q1'`;
            });
          }
          const changedProvenance = structuredClone(originalProvenance);
          changedProvenance.jobAidWorkingUpdate.status = 'UNCHANGED';
          await corruptFixture(async (fixtureSql) => {
            await fixtureSql`UPDATE review_turn SET result_provenance_json=${JSON.stringify(changedProvenance)} WHERE review_turn_id='RT-q1'`;
          });
          try {
            await assert.rejects(exact(), /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u);
          } finally {
            await corruptFixture(async (fixtureSql) => {
              await fixtureSql`UPDATE review_turn SET result_provenance_json=${turn.result_provenance_json} WHERE review_turn_id='RT-q1'`;
            });
          }
          assert.equal((await exact()).workRevisionRef, saved.workRevisionRef);
        },
      );

      await t.test(
        'new service instances recover terminal Review and older save receipts without appending or moving latest',
        async () => {
          const coldWork = new JobAidWorkRepository(db, actors, projection);
          const coldReviews = new ReviewConversationRepository(db);
          const coldItem = await new MiaodaWorkItemRepository(
            db,
          ).loadTenantScopedProjection(scope.workItemId, scope.tenantId);
          assert.equal(
            coldItem.projection.integratedAssessment.overallSynthesis.status,
            'STALE',
          );
          assert.equal(
            coldItem.projection.integratedAssessment.overallSynthesis
              .basedOnJobAidWorkRevisionRef,
            baseline.workRevisionRef,
          );
          assert.equal((await rowById('ATT-old-overall')).status, 'SUCCEEDED');
          const historicalReceipt = await hosted(() =>
            coldWork.save(initialSaveArgs),
          );
          assert.equal(historicalReceipt.replayed, true);
          assert.deepEqual(historicalReceipt.revision, baseline);
          const binding = await hosted(() =>
            coldWork.withActorTransaction(scope.actorUserId, (database) =>
              coldReviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          const coldReviewService = new CanonicalHostOpenClawReviewService(
            coldReviews,
            workItems,
            {},
            {},
            attempts,
            artifactStore,
            {},
            {},
            common,
            undefined,
            actors,
            service,
          );
          const { completedAt: _completedAt, ...candidate } =
            binding.turn.assistantCandidate;
          const replay = await hosted(() =>
            coldReviewService.persistJobAidCandidate(
              {
                conversation: binding.conversation,
                turn: binding.turn,
                row: reviewRow,
                contract: { context: {}, jobAidContext: reviewTask },
              },
              binding.turn.assistantCandidate,
              {
                conversation: binding.conversation,
                turn: binding.turn,
                actionAttemptId: reviewRow.attemptId,
                candidate: structuredClone(candidate),
                completedAt: new Date(),
              },
              fence,
              new Set(evidence.map((item) => item.evidenceRef)),
            ),
          );
          assert.equal(replay.replayed, true);
          assert.equal(
            replay.turn.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (await hosted(() => coldWork.latestForRuntime(scope)))
              .workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
        },
      );

      await t.test(
        'Overall admission rejects missing/conflicting receipts and cross-actor, WorkItem, attempt or source bindings',
        async () => {
          const item = await current();
          const [turn] =
            await sql`SELECT result_provenance_json FROM review_turn WHERE review_turn_id='RT-q1'`;
          const originalProvenance = JSON.parse(turn.result_provenance_json);
          const cases = [
            (value) => {
              delete value.jobAidWorkingUpdate;
            },
            (value) => {
              value.jobAidWorkingUpdate.status = 'UNCHANGED';
            },
            (value) => {
              value.jobAidWorkingUpdate.workRevisionRef =
                baseline.workRevisionRef;
            },
            (value) => {
              value.jobAidWorkingUpdate.workRevision = 1;
            },
            (value) => {
              value.actionAttemptRef = 'AQ-conflict';
            },
            (value) => {
              value.resultContentHash = 'f'.repeat(64);
            },
          ];
          // The normal append-only trigger rejects receipt edits. Corrupt-fixture
          // setup alone uses the disposable cluster owner and a transaction-local
          // replication setting; runtime admission still reads with actor RLS.
          await assert.rejects(
            sql`UPDATE review_turn SET result_provenance_json='{}' WHERE review_turn_id='RT-q1'`,
            /REVIEW_TURN_C2_CANDIDATE_APPEND_ONLY/u,
          );
          const corruptFixture = (mutate) =>
            sql.begin(async (fixtureSql) => {
              await fixtureSql`SET LOCAL session_replication_role='replica'`;
              await mutate(fixtureSql);
            });
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          for (const mutate of cases) {
            const changed = structuredClone(originalProvenance);
            mutate(changed);
            try {
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE review_turn SET result_provenance_json=${JSON.stringify(changed)} WHERE review_turn_id='RT-q1'`,
              );
              await assert.rejects(
                hosted(() =>
                  service.enqueueOverall(item, scope.tenantId, 'q1'),
                ),
                /JOBAID_OVERALL_EXACT_WORK_REQUIRED|REVIEW_TURN_CANDIDATE_JSON_INVALID|REVIEW_TURN_CANDIDATE_PROVENANCE_MISMATCH/u,
              );
            } finally {
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE review_turn SET result_provenance_json=${turn.result_provenance_json} WHERE review_turn_id='RT-q1'`,
              );
            }
          }
          for (const change of ['actor', 'workItem', 'source', 'attempt']) {
            try {
              if (change === 'actor')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE action_attempt SET actor_user_id='actor-other' WHERE attempt_id=${reviewRow.attemptId}`,
                );
              if (change === 'workItem')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE review_turn SET work_item_id='WI-other' WHERE review_turn_id='RT-q1'`,
                );
              if (change === 'source')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE action_attempt SET document_version_id='dv-other' WHERE attempt_id=${reviewRow.attemptId}`,
                );
              if (change === 'attempt')
                await corruptFixture(
                  (fixtureSql) =>
                    fixtureSql`UPDATE review_turn SET action_attempt_id='ATT-other' WHERE review_turn_id='RT-q1'`,
                );
              await assert.rejects(
                hosted(() =>
                  service.enqueueOverall(item, scope.tenantId, 'q1'),
                ),
                /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
              );
            } finally {
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE action_attempt SET actor_user_id=${scope.actorUserId},document_version_id='dv-job' WHERE attempt_id=${reviewRow.attemptId}`,
              );
              await corruptFixture(
                (fixtureSql) =>
                  fixtureSql`UPDATE review_turn SET work_item_id=${scope.workItemId},action_attempt_id=${reviewRow.attemptId} WHERE review_turn_id='RT-q1'`,
              );
            }
          }
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before,
          );
          assert.equal(artifactWrites, 0);
        },
      );

      await t.test(
        'Review persists old Overall stale and admits only its exact saved receipt into Overall input',
        async () => {
          const actor = {
            tenantId: scope.tenantId,
            userId: scope.actorUserId,
            roles: [],
          };
          const read = await browser(() =>
            service.readBrowser(scope.workItemId, actor),
          );
          assert.equal(read.current.workRevisionRef, saved.workRevisionRef);
          assert.equal(read.overallStatus, 'STALE');
          assert.equal(
            read.overallBasedOnWorkRevisionRef,
            baseline.workRevisionRef,
          );
          const item = await current();
          assert.equal(
            item.integratedAssessment.baseRules.workRevisionRef,
            baseline.workRevisionRef,
          );
          assert.equal(
            item.integratedAssessment.overallSynthesis.status,
            'STALE',
          );
          assert.equal(
            item.integratedAssessment.overallSynthesis.staleReason,
            'BASE_RULE_RESULT_CHANGED',
          );
          assert.equal((await rowById('ATT-old-overall')).status, 'SUCCEEDED');
          assert.equal(item.revision, 1);
          assert.equal(item.aeo, null);
          assert.equal(
            item.integratedAssessment.overallForAeoConfirmation,
            null,
          );
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          const queued = await hosted(() =>
            service.enqueueOverall(item, scope.tenantId, 'q1'),
          );
          const [reserved] =
            await sql`SELECT task_envelope_json,attempt_id FROM action_attempt WHERE operation_ref=${queued.attemptRef}`;
          const sealed = JSON.parse(reserved.task_envelope_json);
          assert.equal(
            sealed.modelInput.previousWork.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(sealed.modelInput.modelInput.expectedWorkRevision, 2);
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before + 1,
          );
          assert.equal(artifactWrites, 0);
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${reserved.attempt_id}`;
        },
      );

      await t.test(
        'a new request on the old working version is rejected while exact historical work remains readable',
        async () => {
          const staleRow = await seedAttempt(
            'ATT-q1-stale',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
          );
          await assert.rejects(
            hosted(() =>
              work.withActorTransaction(scope.actorUserId, (database) =>
                service.saveReviewWork(
                  {
                    row: staleRow,
                    task: reviewTask,
                    fence,
                    requestId: 'review-turn:stale',
                    proposal: proposal(true),
                    actualReadRefs: new Set(
                      evidence.map((item) => item.evidenceRef),
                    ),
                  },
                  database,
                ),
              ),
            ),
            /JOBAID_WORK_REVISION_CONFLICT/u,
          );
          assert.deepEqual(
            await hosted(() =>
              work.readByRefForRuntime({
                ...scope,
                workRevisionRef: baseline.workRevisionRef,
              }),
            ),
            baseline,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
          await sql`UPDATE action_attempt SET status='FAILED' WHERE attempt_id=${staleRow.attemptId}`;
        },
      );

      await t.test(
        'cancellation and lease generation changes reject late saves without losing the last accepted work',
        async () => {
          const row = await seedAttempt(
            'ATT-q1-cancel',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'RUNNING',
          );
          const input = {
            row,
            actorUserId: scope.actorUserId,
            fence,
            sourceBindings,
            requestId: 'late-cancelled',
            expectedWorkRevision: 2,
            command: proposal(true),
            content: materializeJobAidWork(
              proposal(true),
              context(saved.content),
            ),
          };
          await sql`UPDATE action_attempt SET cancel_requested_at=now() WHERE attempt_id=${row.attemptId}`;
          await assert.rejects(
            hosted(() => work.save(input)),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/u,
          );
          await sql`UPDATE action_attempt SET cancel_requested_at=null,lease_generation=2 WHERE attempt_id=${row.attemptId}`;
          await assert.rejects(
            hosted(() => work.save(input)),
            /JOBAID_WORK_LEASE_FENCE_REJECTED/u,
          );
          assert.equal(
            (await hosted(() => work.latestForRuntime(scope))).workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
        },
      );

      await t.test(
        'authenticated public request validates receipt, CAS and real reserve, reads exact key and replays once',
        async () => {
          const [actualSqlContext] = await browser(() =>
            db.execute(
              contextSql`SELECT current_user AS role, current_setting('app.user_id',true) AS actor`,
            ),
          );
          assert.equal(
            actualSqlContext.role,
            'authenticated_wiselink_jobaid_test',
          );
          assert.equal(actualSqlContext.actor, scope.actorUserId);
          const old = await current();
          publicRequest = {
            requestId: 'Q1-user-regen',
            expectedRevision: old.revision,
            sourceIdentity: {
              documentVersionId: old.source.documentVersionId,
              sourceArtifactId: old.source.sourceArtifactId,
              sourceFileSha256: old.source.sourceFileSha256,
              packageId: old.package.packageId,
              packageArtifactSha256: old.package.artifact.sha256,
            },
          };
          let casCalls = 0;
          publicRoute = new CanonicalHostOverallRegenerationService(
            {
              resolve: async () => ({
                actor: {
                  tenantId: scope.tenantId,
                  canonicalSubject: { id: scope.actorUserId },
                },
              }),
            },
            {
              freshRead: async () => {
                const item = await current();
                return {
                  allowed: true,
                  action: 'REQUEST_OVERALL_REGENERATION',
                  tenantId: scope.tenantId,
                  actorUserId: scope.actorUserId,
                  workItemId: scope.workItemId,
                  workItemRevision: item.revision,
                  requestId: item.requestId,
                  documentVersionId: item.source.documentVersionId,
                  authorizationFingerprint: 'q1',
                };
              },
            },
            {
              ...registrar,
              compareAndSet: async (input) => {
                casCalls++;
                return registrar.compareAndSet(input);
              },
            },
            { nowIso: () => '2026-10-02T00:00:00.000Z' },
            {
              enqueueUserRequestedRegeneration: async () => {
                throw new Error('UNEXPECTED_LEGACY_QUEUE');
              },
            },
            attempts,
            service,
          );
          await assert.rejects(
            service.reviewOverallRegenerationBinding({
              workItem: old,
              ...scope,
            }),
            /JOBAID_REQUEST_ACTOR_CONTEXT_REQUIRED/u,
          );
          await assert.rejects(
            inContext('actor-other', false, () =>
              service.reviewOverallRegenerationBinding({
                workItem: old,
                ...scope,
              }),
            ),
            /JOBAID_REQUEST_ACTOR_CONTEXT_REQUIRED/u,
          );
          await assert.rejects(
            browser(() =>
              service.reviewOverallRegenerationBinding({
                workItem: old,
                ...scope,
                tenantId: 'tenant-other',
              }),
            ),
            /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
          );
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          await assert.rejects(
            browser(() =>
              publicRoute.request(
                scope.workItemId,
                { ...publicRequest, expectedRevision: 99 },
                {},
              ),
            ),
            /WORK_ITEM_CAS_CONFLICT/u,
          );
          await assert.rejects(
            browser(() =>
              publicRoute.request(
                scope.workItemId,
                {
                  ...publicRequest,
                  sourceIdentity: {
                    ...publicRequest.sourceIdentity,
                    packageArtifactSha256: 'f'.repeat(64),
                  },
                },
                {},
              ),
            ),
            /OVERALL_REGENERATION_SOURCE_CHANGED/u,
          );
          // Request JSON cannot enable a context branch or bypass receipt verification.
          const [receipt] =
            await sql`SELECT result_provenance_json FROM review_turn WHERE review_turn_id='RT-q1'`;
          const malformed = JSON.parse(receipt.result_provenance_json);
          delete malformed.jobAidWorkingUpdate;
          const corruptFixture = (mutate) =>
            sql.begin(async (fixtureSql) => {
              await fixtureSql`SET LOCAL session_replication_role='replica'`;
              await mutate(fixtureSql);
            });
          try {
            await corruptFixture(
              (q) =>
                q`UPDATE review_turn SET result_provenance_json=${JSON.stringify(malformed)} WHERE review_turn_id='RT-q1'`,
            );
            await assert.rejects(
              browser(() =>
                publicRoute.request(
                  scope.workItemId,
                  { ...publicRequest, requestContext: true },
                  {},
                ),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
          } finally {
            await corruptFixture(
              (q) =>
                q`UPDATE review_turn SET result_provenance_json=${receipt.result_provenance_json} WHERE review_turn_id='RT-q1'`,
            );
          }
          assert.equal(casCalls, 0);
          assert.deepEqual(await current(), old);
          // Simulate interruption after the Host request CAS and before queue.
          // A same-request retry must retain the exact marker and perform no new CAS.
          const enqueue = service.enqueueOverall.bind(service);
          service.enqueueOverall = async () => {
            throw new Error('Q1_QUEUE_INTERRUPTED_AFTER_CAS');
          };
          await assert.rejects(
            browser(() =>
              publicRoute.request(scope.workItemId, publicRequest, {}),
            ),
            /Q1_QUEUE_INTERRUPTED_AFTER_CAS/u,
          );
          assert.equal((await current()).revision, 2);
          assert.equal(casCalls, 1);
          service.enqueueOverall = enqueue;
          publicQueued = await browser(() =>
            publicRoute.request(scope.workItemId, publicRequest, {}),
          );
          assert.equal(publicQueued.replayed, true);
          assert.equal(publicQueued.regeneration.status, 'QUEUED');
          const item = await current();
          assert.equal(item.revision, 2);
          assert.deepEqual(item.overallRegenerationRequest.jobAidReviewWork, {
            workRevisionRef: saved.workRevisionRef,
            workRevision: 2,
          });
          assert.equal(
            item.overallRegenerationRequest.requestedFromRevision,
            1,
          );
          assert.equal(item.overallRegenerationRequest.executionRevision, 2);
          assert.equal(
            item.overallRegenerationRequest.requestedByUserId,
            scope.actorUserId,
          );
          assert.deepEqual(
            item.overallRegenerationRequest.sourceIdentity,
            publicRequest.sourceIdentity,
          );
          assert.equal(
            item.integratedAssessment.baseRules.workRevisionRef,
            baseline.workRevisionRef,
          );
          assert.equal((await rowById('ATT-old-overall')).status, 'SUCCEEDED');
          const key = overallUserRegenerationIdempotencyKey(
            scope.workItemId,
            2,
            publicRequest.requestId,
          );
          const row = await browser(() =>
            attempts.readExactIdempotency({
              tenantId: scope.tenantId,
              workItemId: scope.workItemId,
              taskType: 'OPENCLAW_OVERALL_SYNTHESIS',
              baseRevision: 2,
              documentVersionId: 'dv-job',
              idempotencyKey: key,
            }),
          );
          assert.equal(row.operationRef, publicQueued.regeneration.attemptRef);
          assert.equal(row.idempotencyKey, key);
          const sealed = JSON.parse(row.taskEnvelopeJson);
          assert.equal(
            sealed.modelInput.previousWork.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(sealed.modelInput.modelInput.expectedWorkRevision, 2);
          const replay = await browser(() =>
            publicRoute.request(scope.workItemId, publicRequest, {}),
          );
          assert.equal(replay.replayed, true);
          assert.equal(replay.regeneration.attemptRef, row.operationRef);
          assert.equal(casCalls, 1);
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before + 1,
          );
          assert.equal(
            JSON.stringify(publicQueued).includes('jobAidReviewWork'),
            false,
          );
        },
      );

      await t.test(
        'post-CAS marker must match exact work, actor, source, package, old Overall and both formal versions',
        async () => {
          const item = await current();
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          const cases = [
            (marker) => delete marker.jobAidReviewWork,
            (marker) => {
              marker.jobAidReviewWork.workRevisionRef =
                baseline.workRevisionRef;
            },
            (marker) => {
              marker.jobAidReviewWork.workRevision = 1;
            },
            (marker) => {
              marker.requestedFromRevision = 2;
            },
            (marker) => {
              marker.executionRevision = 99;
            },
            (marker) => {
              marker.requestedByUserId = 'actor-other';
            },
            (marker) => {
              marker.sourceIdentity.documentVersionId = 'dv-other';
            },
            (marker) => {
              marker.sourceIdentity.sourceArtifactId = 'source-other';
            },
            (marker) => {
              marker.sourceIdentity.sourceFileSha256 = 'f'.repeat(64);
            },
            (marker) => {
              marker.sourceIdentity.packageId = 'package-other';
            },
            (marker) => {
              marker.sourceIdentity.packageArtifactSha256 = 'f'.repeat(64);
            },
            (marker) => {
              marker.sourceOverall.actionAttemptId = 'ATT-other';
            },
            (marker) => {
              marker.sourceOverall.revision = 99;
            },
            (marker) => {
              marker.sourceOverall.artifactSha256 = 'f'.repeat(64);
            },
          ];
          for (const mutate of cases) {
            const changed = structuredClone(item);
            mutate(changed.overallRegenerationRequest);
            await assert.rejects(
              hosted(() =>
                service.enqueueOverall(changed, scope.tenantId, 'q1'),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
          }
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before,
          );
          assert.equal(artifactWrites, 0);
          assert.deepEqual(await current(), item);
        },
      );

      await t.test(
        'a later saved work after request CAS cannot be substituted for marker-bound work2',
        async () => {
          const item = await current();
          const row = await seedAttempt(
            'ATT-q1-after-request',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'RUNNING',
            item.revision,
          );
          const next = await hosted(() =>
            work.save({
              row,
              actorUserId: scope.actorUserId,
              fence,
              sourceBindings,
              requestId: 'review-turn:RT-after-request',
              expectedWorkRevision: 2,
              command: proposal(true),
              content: materializeJobAidWork(
                proposal(true),
                context(saved.content),
              ),
            }),
          );
          assert.equal(next.revision.workRevision, 3);
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          try {
            await assert.rejects(
              browser(() =>
                publicRoute.request(scope.workItemId, publicRequest, {}),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
            await assert.rejects(
              hosted(() => service.enqueueOverall(item, scope.tenantId, 'q1')),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
            const queuedBefore = await hosted(() =>
              attempts.readScoped({
                attemptRef: publicQueued.regeneration.attemptRef,
                tenantId: scope.tenantId,
                workItemId: scope.workItemId,
              }),
            );
            await assert.rejects(
              hosted(() =>
                service.begin(
                  item,
                  {
                    ...scope,
                    principalId: fence.principalId,
                    authorizationFingerprint: 'q1',
                  },
                  'OVERALL_CONSISTENCY',
                ),
              ),
              /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
            );
            const queuedAfter = await hosted(() =>
              attempts.readScoped({
                attemptRef: publicQueued.regeneration.attemptRef,
                tenantId: scope.tenantId,
                workItemId: scope.workItemId,
              }),
            );
            assert.equal(queuedAfter.status, 'QUEUED');
            assert.equal(queuedAfter.claimCount, queuedBefore.claimCount);
            assert.equal(
              (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
              before,
            );
            assert.deepEqual(await current(), item);
          } finally {
            // Dedicated test-owner teardown only; production never deletes work.
            await sql`DELETE FROM engineering_search_projection_pending WHERE exact_revision_ref=${next.revision.workRevisionRef}`;
            await sql`DELETE FROM assessment_work_revision WHERE assessment_work_revision_id=${next.revision.workRevisionRef}`;
            await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
          }
        },
      );

      await t.test(
        'Overall public commit uses the exact corrected work and reconciles a lost terminal response after CAS',
        async () => {
          // A sealed deterministic fixture tests public commit independently of
          // queue transport; the preceding test covers real queue admission.
          const item = await current();
          const begun = await hosted(() =>
            service.begin(
              item,
              {
                ...scope,
                principalId: fence.principalId,
                authorizationFingerprint: 'q1',
              },
              'OVERALL_CONSISTENCY',
            ),
          );
          const task = begun.task;
          const row = await rowById(task.actionAttemptId);
          assert.equal(task.baseRevision, 2);
          assert.equal(task.operationRef, publicQueued.regeneration.attemptRef);
          assert.equal(
            task.modelInput.previousWork.workRevisionRef,
            saved.workRevisionRef,
          );
          const result = sealResultEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
            actionAttemptId: task.actionAttemptId,
            operationRef: task.operationRef,
            taskType: task.taskType,
            workItemId: task.workItemId,
            baseRevision: task.baseRevision,
            status: 'SUCCEEDED',
            businessOutcome: 'CANDIDATE_READY',
            candidateStatus: null,
            modelOutput: JSON.stringify({
              workRevisionRef: saved.workRevisionRef,
              consistencyCheck: source.excerpt,
            }),
            outputArtifactRefs: [],
            sourceRefs: task.sourceRefs,
            factsConsidered: [],
            missingInputs: [],
            conflicts: [],
            warnings: [],
            modelVersion: 'q1-constructed-not-called',
            promptVersion: 'wiselink-jobaid-problem@v2',
            skillVersion: 'wiselink-research-and-synthesize@r09.c43',
            toolVersions: {
              'jobaid-problem-protocol': '2',
              'wiselink-openclaw-engineering-assessment': '1.2.0',
            },
            runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
            errorCode: null,
            errorDetail: null,
          });
          const args = async () => ({
            row: await rowById(row.attemptId),
            scope: {
              ...scope,
              principalId: fence.principalId,
              attemptRef: row.operationRef,
            },
            leaseToken: begun.leaseToken,
            leaseGeneration: begun.leaseGeneration,
            result,
          });
          const finish = attempts.finishProjectionSuccess.bind(attempts);
          attempts.finishProjectionSuccess = async () => {
            throw new Error('Q1_LOST_TERMINAL_RESPONSE');
          };
          await assert.rejects(
            hosted(async () => service.commit(await args())),
            /Q1_LOST_TERMINAL_RESPONSE/u,
          );
          const afterCas = await current();
          assert.equal(afterCas.revision, 3);
          assert.equal(
            afterCas.integratedAssessment.overallSynthesis
              .basedOnJobAidWorkRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            afterCas.integratedAssessment.baseRules.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            afterCas.integratedAssessment.baseRules.workRevision,
            saved.workRevision,
          );
          assert.equal((await rowById(row.attemptId)).status, 'COMMITTING');
          const writesAfterCas = artifactWrites;
          attempts.finishProjectionSuccess = finish;
          const recovered = await hosted(async () =>
            service.commit(await args()),
          );
          assert.equal(
            recovered.overallSynthesis.basedOnJobAidWorkRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal((await rowById(row.attemptId)).status, 'SUCCEEDED');
          await hosted(async () => service.commit(await args()));
          assert.equal((await current()).revision, 3);
          assert.equal(artifactWrites, writesAfterCas);
          const read = await browser(() =>
            service.readBrowser(scope.workItemId, {
              tenantId: scope.tenantId,
              userId: scope.actorUserId,
              roles: [],
            }),
          );
          assert.equal(read.overallStatus, 'CURRENT');
          assert.equal(
            read.overallBasedOnWorkRevisionRef,
            saved.workRevisionRef,
          );
          assert.deepEqual(read.current.content, saved.content);
          const wiki = await browser(() => searchService.readKnowledge(knowledgeIdentity(saved), searchActor));
          assert.equal(wiki.entry.current, true);
          assert.deepEqual(wiki.content, saved.content);
          assert.equal(wiki.overall.status, 'CANDIDATE_ONLY');
          assert.deepEqual(wiki.overall.readingResult,
            (await current()).integratedAssessment.overallSynthesis.readingResult);
          assert.equal((await browser(() => searchService.readKnowledge(knowledgeIdentity(baseline), searchActor))).overall, null);
        },
      );

      await t.test(
        'public Overall commit rejects an older saved ref without changing the corrected projection',
        async () => {
          const item = await current();
          const row = await seedAttempt(
            'ATT-q1-old-overall',
            'OPENCLAW_OVERALL_SYNTHESIS',
            'RUNNING',
            item.revision,
          );
          const taskInput = buildJobAidProblemTask({
            workItem: item,
            actorUserId: scope.actorUserId,
            permissionSnapshotVersion: 'q1',
            purpose: 'OVERALL_CONSISTENCY',
            sourceCatalog: evidence,
            sourceBindings,
            common: (await common.buildForWorkItemWithEvidence(item)).common,
            previousWork: saved,
            expectedWorkRevision: 2,
            priorAssessmentRefs: [
              saved.workRevisionRef,
              baseline.workRevisionRef,
            ],
          });
          const task = sealTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
            actionAttemptId: row.attemptId,
            operationRef: row.operationRef,
            taskType: row.actionType,
            priority: 100,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            inputRevision: item.revision,
            baseRevision: item.revision,
            documentVersionId: 'dv-job',
            sourceRefs: [
              {
                ref: sourceBindings[0].artifactRef,
                sha256: sourceBindings[0].artifactSha256,
              },
            ],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: taskInput,
            deadline: row.deadlineAt.toISOString(),
            idempotencyKey: 'q1:overall:obsolete',
          });
          await sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(task)},task_input_hash=${task.inputHash},
            idempotency_key=${task.idempotencyKey} WHERE attempt_id=${row.attemptId}`;
          const result = sealResultEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_result_envelope.v1',
            actionAttemptId: row.attemptId,
            operationRef: row.operationRef,
            taskType: row.actionType,
            workItemId: scope.workItemId,
            baseRevision: item.revision,
            status: 'SUCCEEDED',
            businessOutcome: 'CANDIDATE_READY',
            candidateStatus: null,
            modelOutput: JSON.stringify({
              workRevisionRef: baseline.workRevisionRef,
              consistencyCheck: source.excerpt,
            }),
            outputArtifactRefs: [],
            sourceRefs: task.sourceRefs,
            factsConsidered: [],
            missingInputs: [],
            conflicts: [],
            warnings: [],
            modelVersion: 'q1-constructed-not-called',
            promptVersion: 'wiselink-jobaid-problem@v2',
            skillVersion: 'wiselink-research-and-synthesize@r09.c43',
            toolVersions: {
              'jobaid-problem-protocol': '2',
              'wiselink-openclaw-engineering-assessment': '1.2.0',
            },
            runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
            errorCode: null,
            errorDetail: null,
          });
          const writes = artifactWrites;
          const terminal = await hosted(async () =>
            service.commit({
              row: await rowById(row.attemptId),
              scope: {
                ...scope,
                principalId: fence.principalId,
                attemptRef: row.operationRef,
              },
              leaseToken: fence.leaseToken,
              leaseGeneration: 1,
              result,
            }),
          );
          assert.equal(terminal.status, 'FAILED');
          assert.match(
            String((await rowById(row.attemptId)).errorCode),
            /JOBAID_COMPLETED_WORK_REQUIRED/u,
          );
          assert.deepEqual(await current(), item);
          assert.equal(artifactWrites, writes);
        },
      );

      await t.test(
        'legacy model schema is rejected; historical rows remain exact and workItem change fences late saves',
        async () => {
          assert.throws(
            () =>
              materializeJobAidWork(
                {
                  ...proposal(true),
                  schemaVersion: 'wiselink.jobaid-problem-work.v2',
                },
                context(saved.content),
              ),
            /JOBAID_SCHEMA/u,
          );
          const row = await seedAttempt(
            'ATT-q1-late',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
          );
          await assert.rejects(
            hosted(() =>
              work.withActorTransaction(scope.actorUserId, (database) =>
                service.saveReviewWork(
                  {
                    row,
                    task: {
                      ...reviewTask,
                      modelInput: {
                        ...reviewTask.modelInput,
                        expectedWorkRevision: 2,
                      },
                      previousWork: saved,
                    },
                    fence,
                    requestId: 'review-turn:late',
                    proposal: proposal(true),
                    actualReadRefs: new Set(
                      evidence.map((item) => item.evidenceRef),
                    ),
                  },
                  database,
                ),
              ),
            ),
            /JOBAID_SAVE_WORK_ITEM_CHANGED/u,
          );
          assert.deepEqual(
            await hosted(() =>
              work.readByRefForRuntime({
                ...scope,
                workRevisionRef: baseline.workRevisionRef,
              }),
            ),
            baseline,
          );
          assert.equal(
            (
              await sql`SELECT count(*)::int AS n FROM assessment_work_revision`
            )[0].n,
            2,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
        },
      );
      await t.test(
        'a later work with a review-turn prefix and no exact receipt cannot reuse an older matching receipt',
        async () => {
          const item = await current();
          const row = await seedAttempt(
            'ATT-q1-unmatched',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'RUNNING',
            item.revision,
          );
          const next = await hosted(() =>
            work.save({
              row,
              actorUserId: scope.actorUserId,
              fence,
              sourceBindings,
              requestId: 'review-turn:RT-q1-unmatched',
              expectedWorkRevision: 2,
              command: proposal(true),
              content: materializeJobAidWork(
                proposal(true),
                context(saved.content),
              ),
            }),
          );
          assert.equal(next.revision.workRevision, 3);
          const before = (
            await sql`SELECT count(*)::int AS n FROM action_attempt`
          )[0].n;
          const writes = artifactWrites;
          await assert.rejects(
            hosted(() => service.enqueueOverall(item, scope.tenantId, 'q1')),
            /JOBAID_OVERALL_EXACT_WORK_REQUIRED/u,
          );
          assert.equal(
            (await sql`SELECT count(*)::int AS n FROM action_attempt`)[0].n,
            before,
          );
          assert.equal(artifactWrites, writes);
          assert.equal(
            (await current()).integratedAssessment.baseRules.workRevisionRef,
            saved.workRevisionRef,
          );
          assert.equal(
            (
              await hosted(() =>
                work.readByRefForRuntime({
                  ...scope,
                  workRevisionRef: saved.workRevisionRef,
                }),
              )
            ).workRevision,
            2,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${row.attemptId}`;
        },
      );
      await t.test(
        'a subsequent authenticated Review request binds new receipt and does not inherit an obsolete regeneration marker',
        async () => {
          const item = await current();
          assert.equal(item.revision, 3);
          const previous = await hosted(() => work.latestForRuntime(scope));
          assert.equal(previous.workRevision, 3);
          let row = await seedAttempt(
            'ATT-q1-second-review',
            'OPENCLAW_INTERACTIVE_REVIEW',
            'COMMITTING',
            item.revision,
          );
          await sql`UPDATE action_attempt SET result_content_hash=${'d'.repeat(64)} WHERE attempt_id=${row.attemptId}`;
          await sql`UPDATE review_conversation SET last_synced_revision=3 WHERE review_conversation_id='RC-q1'`;
          await sql`INSERT INTO review_turn(review_turn_id,review_conversation_id,engineer_supplied_input_id,tenant_id,actor_id,work_item_id,
            turn_no,request_id,input_revision,user_message,input_type,adoption_status,created_at)
            VALUES ('RT-q1-second','RC-q1','ESI-q1-second','tenant-job','actor-job','WI-job',2,'request-q1-second',3,
              'Retain the checked inspection limitation.','ENGINEER_TEXT','CANDIDATE_UNADOPTED',now())`;
          const taskInput = buildJobAidProblemTask({
            workItem: item,
            actorUserId: scope.actorUserId,
            permissionSnapshotVersion: 'q1',
            purpose: 'PROBLEM_REVIEW',
            sourceCatalog: evidence,
            sourceBindings,
            common: (await common.buildForWorkItemWithEvidence(item)).common,
            previousWork: previous,
            expectedWorkRevision: 3,
            priorAssessmentRefs: [
              previous.workRevisionRef,
              saved.workRevisionRef,
            ],
          });
          const task = sealTaskEnvelope({
            schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
            actionAttemptId: row.attemptId,
            operationRef: row.operationRef,
            taskType: row.actionType,
            priority: 100,
            tenantId: scope.tenantId,
            workItemId: scope.workItemId,
            inputRevision: 3,
            baseRevision: 3,
            documentVersionId: 'dv-job',
            sourceRefs: [
              {
                ref: sourceBindings[0].artifactRef,
                sha256: sourceBindings[0].artifactSha256,
              },
            ],
            allowedConnectors: [],
            hostResolvedMissingInputs: [],
            modelInput: { jobAidContext: taskInput },
            deadline: row.deadlineAt.toISOString(),
            idempotencyKey: 'q1:review:second',
          });
          await sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(task)},task_input_hash=${task.inputHash} WHERE attempt_id=${row.attemptId}`;
          row = await rowById(row.attemptId);
          const binding = await hosted(() =>
            work.withActorTransaction(scope.actorUserId, (database) =>
              reviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1-second',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          const first = await hosted(() =>
            work.withActorTransaction(scope.actorUserId, (database) =>
              reviews.loadOpenClawTurnByIdBinding(
                {
                  reviewConversationId: 'RC-q1',
                  reviewTurnId: 'RT-q1',
                  tenantId: scope.tenantId,
                  actorId: scope.actorUserId,
                  workItemId: scope.workItemId,
                },
                database,
              ),
            ),
          );
          const {
            completedAt: _completedAt,
            jobAidWorkingUpdate: _receipt,
            ...candidate
          } = first.turn.assistantCandidate;
          candidate.actionAttemptRef = row.operationRef;
          await hosted(() =>
            reviewService.persistJobAidCandidate(
              {
                conversation: binding.conversation,
                turn: binding.turn,
                row,
                contract: { context: {}, jobAidContext: taskInput },
              },
              { ...candidate, jobAidWorkingDelta: proposal(true) },
              {
                conversation: binding.conversation,
                turn: binding.turn,
                actionAttemptId: row.attemptId,
                candidate: structuredClone(candidate),
                completedAt: new Date(),
              },
              fence,
              new Set(evidence.map((value) => value.evidenceRef)),
            ),
          );
          await sql`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id=${row.attemptId}`;
          const reviewed = await current();
          const next = await hosted(() => work.latestForRuntime(scope));
          assert.equal(next.workRevision, 4);
          assert.equal(
            reviewed.integratedAssessment.overallSynthesis.staleReason,
            'BASE_RULE_RESULT_CHANGED',
          );
          assert.equal(
            reviewed.overallRegenerationRequest.executionRevision,
            2,
          );
          const request = {
            ...publicRequest,
            requestId: 'Q1-second-user-regen',
            expectedRevision: 3,
          };
          const response = await browser(() =>
            publicRoute.request(scope.workItemId, request, {}),
          );
          const updated = await current();
          assert.equal(updated.revision, 4);
          assert.equal(
            updated.overallRegenerationRequest.requestedFromRevision,
            3,
          );
          assert.equal(updated.overallRegenerationRequest.executionRevision, 4);
          assert.deepEqual(
            updated.overallRegenerationRequest.jobAidReviewWork,
            { workRevisionRef: next.workRevisionRef, workRevision: 4 },
          );
          const [queued] =
            await sql`SELECT task_envelope_json,attempt_id FROM action_attempt WHERE operation_ref=${response.regeneration.attemptRef}`;
          assert.equal(
            JSON.parse(queued.task_envelope_json).modelInput.previousWork
              .workRevisionRef,
            next.workRevisionRef,
          );
          assert.equal(
            updated.integratedAssessment.baseRules.workRevisionRef,
            saved.workRevisionRef,
          );
          await sql`UPDATE action_attempt SET status='CANCELLED' WHERE attempt_id=${queued.attempt_id}`;
        },
      );
    } finally {
      await sql.end();
    }
  },
);
