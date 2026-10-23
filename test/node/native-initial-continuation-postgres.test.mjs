import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql, eq, and, desc } = require('drizzle-orm');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const { workItem, actionAttempt, dmDocumentVersion, dmPublicationFamily, dmAcquisition } = require('../../server/database/schema.ts');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { ProductionMiaodaBrowserObjectIngressGuard } = require('../../server/modules/work-item/production-miaoda-browser-ingress.ts');
const { MiaodaDocumentVersionSourceResolver } = require('../../server/modules/work-item/miaoda-document-version-source.resolver.ts');
const { CanonicalHostController } = require('../../server/modules/canonical-host/canonical-host.controller.ts');
const { CanonicalInitialAnalysisContinuationController } = require('../../server/modules/canonical-host/canonical-initial-analysis-continuation.controller.ts');
const { CanonicalInitialAnalysisContinuationService } = require('../../server/modules/canonical-host/canonical-initial-analysis-continuation.service.ts');
const { CanonicalHostInitialAnalysisStatusService, projectCanonicalHostInitialAnalysisStatus } = require('../../server/modules/canonical-host/canonical-host-initial-analysis-status.service.ts');
const { ActionAttemptRepository } = require('../../server/modules/action-attempt/action-attempt.repository.ts');
const { ActionAttemptLifecycleService } = require('../../server/modules/action-attempt/action-attempt-lifecycle.service.ts');
const { CanonicalModelSettingsRepository } = require('../../server/modules/model-settings/canonical-model-settings.repository.ts');
const { CanonicalModelSettingsService } = require('../../server/modules/model-settings/canonical-model-settings.service.ts');
const { canonicalJson, sealTaskEnvelope } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const { buildInitialAnalysisRequestInput } = require('../../server/modules/action-attempt/initial-analysis-request.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { OrdinaryDocumentManagementAuthorizer } = require('../../server/modules/document-management-runtime/ordinary-document-management-authorizer.ts');
const { MiaodaHostedDocumentCatalog, tenantFamilyIdentityPrefix } = require('../../server/modules/document-management/src/hosted/nest/miaoda-hosted-document-catalog.ts');
const { MiaodaAutomaticWorkItemSourceAuthorizationAdapter } = require('../../server/modules/canonical-host/miaoda-automatic-work-item-source-authorization.adapter.ts');

const TENANT = 'tenant-native-initial', OWNER = 'owner-native-initial', READER = 'reader-native-initial';
const APP = 'app_17bzc551rsg', WI = 'WI-native-initial', PERMISSION = 'permission-native-initial';
const MODEL = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-10T00:00:00.000Z' };
const SOURCE = { documentId: 'DOC-native-initial', documentVersionId: 'DV-native-initial',
  sourceArtifactId: 'ART-native-initial', sourceFileSha256: 'a'.repeat(64), sourceByteLength: 1024 };
const projection = { schemaVersion: 'wiselink.3_1.canonical_work_item_projection.v0.candidate',
  workItemId: WI, requestId: 'REQ-native-initial-parse', revision: 3, phase: 'CANDIDATE_READBACK_VERIFIED',
  classification: { normalizedFamily: 'AD', status: 'CONFIRMED' }, source: SOURCE,
  package: { packageId: 'PKG-native-initial', contractId: 'techpub.parsed-package.v1', contractRevision: 'frozen.2',
    artifact: { ref: 'fixture/package.json', sha256: 'b'.repeat(64) } } };
const additionsOnly = process.env.NATIVE_INITIAL_TEST_ADDITIONS_ONLY === '1';

// Real native scope, SDK SQL middleware, lifecycle/model capture, repository,
// guard and 0062-0065 grant RLS. Parser/page composition, object-action decisions
// and Source resolution are bounded substitutes. The transaction Source cases
// use the real read-policy adapter, authorizer and repositories, not a gateway.
// No external/model transport is permitted.
test('native owner requests one exact terminal successor atomically under real restricted PG roles',
  { timeout: 120000 }, async t => {
    const cluster = await startOwnedPostgres(await postgresCapability());
    const previousEnvironment = { ...process.env };
    const admin = cluster.admin;
    const scope = 'native_initial_fixture', nativeRole = `authenticated_${scope}`;
    const serviceRole = `service_role_${scope}`;
    let externalCalls = 0;
    const forbid = () => { externalCalls += 1; throw new Error('UNEXPECTED_EXTERNAL_OR_MODEL_CALL'); };
    const originalFetch = globalThis.fetch;
    const transports = [http, https].map(transport => ({ transport, request: transport.request, get: transport.get }));
    const originalResolve = MiaodaDocumentVersionSourceResolver.prototype.resolve;
    const baseTest = (name, perform) => additionsOnly ? undefined : t.test(name, perform);
    const additionTest = (name, perform) => process.env.NATIVE_INITIAL_TEST_CASE &&
      !name.includes(process.env.NATIVE_INITIAL_TEST_CASE) ? undefined : t.test(name, perform);
    try {
      Object.assign(process.env, { SANDBOX_ID: 'owned-native-initial-test', WL_JOBAID_PROBLEM_V2_ENABLED: '1',
        WL_TRANSLATION_V2_ENABLED: '0', WL_OPENCLAW_SERVICE_SCOPE_ENABLED: '0' });
      delete process.env.MIAODA_LOCAL_DEV;
      globalThis.fetch = forbid;
      for (const { transport } of transports) { transport.request = forbid; transport.get = forbid; }
      await admin.unsafe(`CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
        CREATE TYPE user_profile AS(user_id text);
        CREATE ROLE ${nativeRole} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE authenticated;
        CREATE ROLE ${serviceRole} NOLOGIN NOSUPERUSER NOBYPASSRLS IN ROLE service_role;
        CREATE ROLE tdms_fixture_app_1234567890abcdef LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${nativeRole},${serviceRole};`);
      for (const [name, table] of [['work_item', workItem], ['action_attempt', actionAttempt],
        ['dm_document_version', dmDocumentVersion], ['dm_publication_family', dmPublicationFamily], ['dm_acquisition', dmAcquisition]]) {
        const columns = getTableConfig(table).columns.map(column => `"${column.name}" ${column.getSQLType()}`);
        await admin.unsafe(`CREATE TABLE ${name} (${columns.join(',')}); ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY;`);
      }
      await admin.unsafe(`ALTER TABLE work_item ADD PRIMARY KEY(tenant_id,work_item_id);
        ALTER TABLE action_attempt ADD PRIMARY KEY(attempt_id), ADD UNIQUE(tenant_id,idempotency_key),
          ADD FOREIGN KEY(tenant_id,work_item_id) REFERENCES work_item(tenant_id,work_item_id);
        ALTER TABLE action_attempt ALTER COLUMN subject_kind SET DEFAULT 'WORK_ITEM';
        ALTER TABLE action_attempt ALTER COLUMN projection_applied SET DEFAULT false;
        GRANT SELECT,INSERT,UPDATE ON work_item,action_attempt TO ${nativeRole},${serviceRole};
        CREATE POLICY fixture_native_work ON work_item FOR SELECT TO ${nativeRole}
          USING(tenant_id='${TENANT}' AND current_setting('app.user_id',true) IN ('${OWNER}','${READER}'));
        CREATE POLICY fixture_native_attempt ON action_attempt FOR SELECT TO ${nativeRole}
          USING(tenant_id='${TENANT}' AND current_setting('app.user_id',true) IN ('${OWNER}','${READER}'));
        CREATE POLICY fixture_service_work ON work_item FOR ALL TO ${serviceRole}
          USING(current_setting('fixture.source_read_denied',true) IS DISTINCT FROM '1'
            AND NULLIF(current_setting('fixture.source_read_error',true),'')::integer IS NULL) WITH CHECK(true);
        CREATE POLICY fixture_service_attempt ON action_attempt FOR ALL TO ${serviceRole} USING(true) WITH CHECK(true);`);
      for (const table of ['dm_document_version', 'dm_publication_family', 'dm_acquisition'])
        await admin.unsafe(`GRANT SELECT ON ${table} TO ${serviceRole};
          CREATE POLICY fixture_source_catalog ON ${table} FOR SELECT TO ${serviceRole} USING(true)`);
      for (const name of ['0062_auto_work_item_authorization.sql', '0063_auto_work_item_lease_ack.sql',
        '0064_auto_work_item_block_receipt.sql', '0065_auto_work_item_authenticated_intake.sql'])
        await admin.unsafe(await readFile(new URL(`../../migrations/${name}`, import.meta.url), 'utf8'));
      await admin.unsafe(`GRANT SELECT,INSERT,UPDATE ON auto_work_item_authorization TO ${nativeRole},${serviceRole}`);
      await admin.unsafe(`CREATE TABLE fixture_grant_release_count(work_item_id text);
        GRANT INSERT,SELECT ON fixture_grant_release_count TO ${serviceRole};
        CREATE FUNCTION fixture_count_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
          IF OLD.status='BLOCKED' AND NEW.status='WAITING' THEN
            INSERT INTO fixture_grant_release_count VALUES(NEW.work_item_id); END IF; RETURN NEW; END $$;
        CREATE TRIGGER fixture_count_release AFTER UPDATE ON auto_work_item_authorization
          FOR EACH ROW EXECUTE FUNCTION fixture_count_release()`);
      const db = drizzle(await cluster.connect('tdms_fixture_app_1234567890abcdef'));
      const middleware = new SqlExecutionContextMiddleware({ roleSchema: scope });
      const sessions = new SessionResolver({ validate: async token => token === 'expired' ? null : ({
        sessionId: '11111111-1111-4111-8111-111111111111', revision: 1, expiresAt: new Date(Date.now() + 60000),
        identity: { miaodaUserId: token, tenantId: TENANT, verifiedAt: new Date().toISOString(), feishuOpenId: 'fixture-open' },
      }) }, { applicationScopeId: APP, sessionEnvironment: 'runtime' }, middleware);
      const repo = new ActionAttemptRepository(db);
      const realSourceRepository = new MiaodaWorkItemRepository(db);
      const realSourceCatalog = new MiaodaHostedDocumentCatalog(db);
      const realSourceAuthorization = new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(
        new OrdinaryDocumentManagementAuthorizer(realSourceRepository, {}, realSourceCatalog));
      const sourceExecutors = [], pendingSourceReads = [];
      let realSourceMode = null;
      async function boundedSourceRead(input, database) {
        if (realSourceMode === null)
          return { ...input, allowed: sourceAllowed, action: 'DOCUMENT_READ', authorizationPolicy: 'MIAODA_HOST_DOCUMENT_READ' };
        sourceExecutors.push(database);
        if (realSourceMode === 'DENIED')
          await database.execute(sql`SELECT set_config('fixture.source_read_denied','1',true)`);
        if (realSourceMode === 'ERROR')
          await database.execute(sql`SELECT set_config('fixture.source_read_error','invalid',true)`);
        const pending = realSourceAuthorization.authorizeSourceRead(input, database);
        pendingSourceReads.push(pending);
        let timer;
        try {
          return await Promise.race([pending, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('FIXTURE_SOURCE_EXECUTOR_LEFT_HELD_TRANSACTION')), 750);
          })]);
        } finally {
          clearTimeout(timer);
        }
      }
      const lifecycle = new ActionAttemptLifecycleService(repo,
        new CanonicalModelSettingsService(new CanonicalModelSettingsRepository(db)));
      const initial = new CanonicalHostInitialAnalysisStatusService(db, lifecycle, undefined, undefined, undefined, sessions);
      const request = (userId = OWNER, cookie = null, changes = {}) => ({ headers: cookie ? { cookie: `wl_session=${cookie}` } : {},
        userContext: { userId, tenantId: TENANT, appId: APP, env: 'runtime', roles: [], isSystemAccount: false, ...changes } });
      const ingress = new ProductionMiaodaBrowserObjectIngressGuard();
      function browser(req, operation) {
        ingress.canActivate({ switchToHttp: () => ({ getRequest: () => req }) });
        return operation();
      }
      async function observe(database = db) {
        const [identity] = await database.execute(sql`SELECT current_user AS role,
          current_setting('app.user_id',true) AS actor,
          r.rolsuper AS superuser,r.rolbypassrls AS bypass FROM pg_roles r WHERE rolname=current_user`);
        assert.equal(identity.actor, OWNER);
        assert.equal(identity.superuser, false); assert.equal(identity.bypass, false);
        return identity;
      }
      let sourceAllowed = true, sourceCurrent = true, permissionCurrent = true, beforeReserve;
      MiaodaDocumentVersionSourceResolver.prototype.resolve = async function (id, options) {
        assert.equal(id, SOURCE.documentVersionId);
        assert.deepEqual(options, { requireCurrent: true, expectedCreatorUserId: OWNER });
        assert.equal((await observe(this.db)).role, serviceRole);
        return { version: { ...SOURCE, sourceArtifactId: sourceCurrent ? SOURCE.sourceArtifactId : 'ART-changed',
          pdfSha256: SOURCE.sourceFileSha256, byteLength: SOURCE.sourceByteLength } };
      };
      const authorization = { authorize: async ({ actor, action, workItemId }, database = db) => {
        const [owner] = await database.select().from(workItem).where(and(eq(workItem.tenantId, actor.tenantId), eq(workItem.workItemId, workItemId)));
        return { action, allowed: owner?.requestedByUserId === actor.userId && actor.appId === APP,
          permissionSnapshotVersion: PERMISSION };
      } };
      const permissions = { freshRead: async () => ({ permissionSnapshotVersion: permissionCurrent ? PERMISSION : 'revoked' }) };
      const registrar = { getTenantScopedByWorkItemId: async ({ tenantId, workItemId }) => {
        const [row] = await db.select().from(workItem).where(and(eq(workItem.tenantId, tenantId), eq(workItem.workItemId, workItemId)));
        return row ? JSON.parse(row.projectionJson) : null;
      } };
      initial.project = async ({ workItem: item, tenantId }) => {
        const rows = await db.select().from(actionAttempt).where(and(eq(actionAttempt.tenantId, tenantId), eq(actionAttempt.workItemId, item.workItemId)))
          .orderBy(desc(actionAttempt.attemptNo));
        return projectCanonicalHostInitialAnalysisStatus(item, rows.map(row => ({ attemptId: row.attemptId, actionType: row.actionType,
          attemptRef: row.operationRef, status: row.status, terminalCode: row.terminalReason })),
        { originalPublished: true, englishAssessmentEnabled: true });
      };
      const jobAid = { enqueueContinuation: async (item, tenantId, _permission, requestId, _purpose, knowledge, _original, guard) => {
        if (beforeReserve) await beforeReserve();
        const reserved = await lifecycle.reserve({ workItemId: item.workItemId, tenantId,
          taskType: 'OPENCLAW_DYNAMIC_EVALUATION', actorUserId: 'service:openclaw-main',
          documentVersionId: item.source.documentVersionId, inputRevision: item.revision, baseRevision: item.revision,
          idempotencyKey: `openclaw-v2:dynamic:${WI}:${SOURCE.documentVersionId}:${requestId}`,
          sourceRefs: [{ ref: SOURCE.sourceArtifactId, sha256: SOURCE.sourceFileSha256 }],
          initialKnowledgeSession: { expectedSessionId: null, ...(knowledge ? { replacement: knowledge } : {}) },
          cancelledInitialContinuation: guard, buildModelInput: async () => buildInitialAnalysisRequestInput({
            taskType: 'OPENCLAW_DYNAMIC_EVALUATION', requestId, originalParseRunId: 'PR-native-initial' }) });
        return { status: reserved.row.status, created: reserved.created };
      } };
      const continuation = new CanonicalInitialAnalysisContinuationController(new CanonicalInitialAnalysisContinuationService(
        authorization, permissions, registrar, lifecycle, initial, {}, jobAid, sessions,
        { availability: async () => ({ available: false }) },
        { authorizeSourceRead: boundedSourceRead }), sessions);
      const statusInput = async (_id, actor) => {
        const item = await registrar.getTenantScopedByWorkItemId({ tenantId: actor.tenantId, workItemId: WI });
        if (!item) throw new Error('CANONICAL_WORK_ITEM_NOT_FOUND');
        return initial.projectForBrowser({ workItem: item, tenantId: actor.tenantId, actorUserId: actor.userId });
      };
      const reads = new CanonicalHostController({ browserInitialAnalysisStatus: statusInput }, {}, {}, {}, {}, undefined, undefined, undefined, sessions);
      reads.pageWithEngineerReviews = async ({ workItemId }, actor) => statusInput(workItemId, actor);
      const read = (req = request()) => browser(req, () => reads.initialAnalysis(WI, req));
      const post = (id = randomUUID(), req = request(), expectedRevision = 3) => browser(req,
        () => continuation.request(WI, { requestId: id, expectedRevision, operation: 'EVALUATE_JOBAID' }, req));
      let oldRows;
      async function seed(status = 'TIMED_OUT') {
        sourceAllowed = true; sourceCurrent = true; permissionCurrent = true; beforeReserve = undefined;
        realSourceMode = null; sourceExecutors.length = 0;
        await admin.unsafe('TRUNCATE action_attempt,auto_work_item_authorization,work_item,fixture_grant_release_count CASCADE');
        await admin`INSERT INTO work_item(tenant_id,work_item_id,request_id,requested_by_user_id,revision,action_type,status,
          document_id,document_version_id,source_artifact_id,source_file_sha256,source_byte_length,
          package_id,package_artifact_ref,package_artifact_sha256,projection_json,analysis_model_json)
          VALUES(${TENANT},${WI},${projection.requestId},${OWNER},3,'PARSE_PDF','CANDIDATE_READBACK_VERIFIED',
          ${SOURCE.documentId},${SOURCE.documentVersionId},${SOURCE.sourceArtifactId},${SOURCE.sourceFileSha256},1024,
          ${projection.package.packageId},${projection.package.artifact.ref},${projection.package.artifact.sha256},${canonicalJson(projection)},${canonicalJson(MODEL)})`;
        for (const number of [1, 2]) {
          const task = sealTaskEnvelope({ schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', actionAttemptId: `ATT-old-${number}`,
            operationRef: `AQ-old-${number}`, taskType: 'OPENCLAW_DYNAMIC_EVALUATION', priority: 100, tenantId: TENANT,
            workItemId: WI, inputRevision: 3, baseRevision: 3, documentVersionId: SOURCE.documentVersionId,
            sourceRefs: [{ ref: SOURCE.sourceArtifactId, sha256: SOURCE.sourceFileSha256 }], allowedConnectors: [], hostResolvedMissingInputs: [],
            modelInput: { schemaVersion: 'legacy-prepared-fixture', source: 'synthetic' }, executionModel: MODEL,
            deadline: '2026-10-10T02:00:00.000Z', idempotencyKey: `legacy-initial-${number}` });
          await admin`INSERT INTO action_attempt(attempt_id,operation_ref,tenant_id,work_item_id,subject_kind,actor_user_id,
            request_origin,action_type,status,attempt_no,trigger_request_id,input_revision,base_revision,document_version_id,
            task_envelope_json,task_input_hash,execution_model_json,idempotency_key,projection_applied,created_at,completed_at)
            VALUES(${task.actionAttemptId},${task.operationRef},${TENANT},${WI},'WORK_ITEM','service:openclaw-main','OPENCLAW_MCP_V1',
            'OPENCLAW_DYNAMIC_EVALUATION',${number === 2 ? status : 'TIMED_OUT'},${number},${'REQ-old-' + number},3,3,${SOURCE.documentVersionId},
            ${canonicalJson(task)},${task.inputHash},${canonicalJson(MODEL)},${task.idempotencyKey},false,
            ${new Date(`2026-10-10T0${number}:00:00.000Z`)},${new Date(`2026-10-10T0${number}:10:00.000Z`)})`;
        }
        await admin`INSERT INTO auto_work_item_authorization(tenant_id,work_item_id,request_id,actor_user_id,document_id,
          document_version_id,source_artifact_id,source_file_sha256,source_byte_length,grant_kind,status,lease_generation,
          blocked_code,blocked_lease_token_hash,blocked_lease_generation,blocked_at)
          VALUES(${TENANT},${WI},${projection.requestId},${OWNER},${SOURCE.documentId},${SOURCE.documentVersionId},${SOURCE.sourceArtifactId},
          ${SOURCE.sourceFileSha256},1024,'MIAODA_CANONICAL_PARSE_REQUEST','BLOCKED',3,
          ${status === 'CANCELLED' ? 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED' : 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED'},${'f'.repeat(64)},3,'2026-10-10T03:00:00.000Z')`;
        oldRows = await admin`SELECT * FROM action_attempt ORDER BY attempt_no`;
      }
      async function assertUnchanged() {
        assert.deepEqual(await admin`SELECT * FROM action_attempt ORDER BY attempt_no`, oldRows);
        assert.equal((await admin`SELECT status FROM auto_work_item_authorization`)[0].status, 'BLOCKED');
      }
      await baseTest('native owner without cookie and matching/expired optional OAuth read the same two GET capabilities', async () => {
        await seed();
        for (const cookie of [null, OWNER, 'expired']) {
          const req = request(OWNER, cookie), status = await read(req);
          assert.deepEqual(status.continuationOperations, ['EVALUATE_JOBAID']);
          assert.equal(status.continuationDiagnosticCode, undefined);
          assert.deepEqual(await browser(req, () => reads.page(WI, undefined, undefined, req)), status);
        }
        await sessions.withNativeBrowserIdentity(request(), () => sessions.withVerifiedNativeBrowserSql(async () => {
          assert.equal((await observe()).role, nativeRole);
          assert.equal((await db.execute(sql`SELECT * FROM auto_work_item_authorization`)).length, 0);
          assert.equal((await db.execute(sql`UPDATE auto_work_item_authorization SET lease_generation=99 RETURNING work_item_id`)).length, 0);
          assert.equal(await initial.hasExactAutoProcessingGrant({ tenantId: TENANT, actorUserId: OWNER, workItem: projection }), false);
          assert.equal((await observe()).role, nativeRole);
        }));
        await assertUnchanged();
      });
      await baseTest('same-tenant reader reads status but cannot continue; forged/service/cross-tenant/wrong-app/mismatched OAuth fail with no writes', async () => {
        await seed();
        assert.deepEqual((await read(request(READER))).continuationOperations, []);
        await assert.rejects(post(randomUUID(), request(READER)));
        for (const req of [request(OWNER, null, { tenantId: 'other-tenant' }), request(OWNER, null, { appId: 'app-other' }),
          request('service:forged'), request(OWNER, null, { isSystemAccount: true }), request(OWNER, READER)])
          await assert.rejects(async () => post(randomUUID(), req));
        await assertUnchanged();
      });
      for (const status of ['FAILED', 'TIMED_OUT', 'CANCELLED']) await baseTest(`${status} creates one new ATT and preserves old rows/blocked receipt`, async () => {
        await seed(status);
        const id = randomUUID(), value = await post(id);
        assert.deepEqual(value, { requestId: id, operation: 'EVALUATE_JOBAID', status: 'QUEUED', replayed: false, candidateOnly: true });
        assert.deepEqual(await admin`SELECT * FROM action_attempt WHERE attempt_no<=2 ORDER BY attempt_no`, oldRows);
        const [grant] = await admin`SELECT status,blocked_code,blocked_lease_generation,blocked_at FROM auto_work_item_authorization`;
        assert.equal(grant.status, 'WAITING'); assert.equal(grant.blocked_lease_generation, 3);
        assert.equal(grant.blocked_at.toISOString(), '2026-10-10T03:00:00.000Z');
        assert.match(grant.blocked_code, /JOBAID_(?:FAILED|CANCELLED)$/u);
        assert.equal((await post(id)).replayed, true);
      });
      await baseTest('concurrent different UUIDs yield exactly one ATT and one grant release', async () => {
        await seed();
        const results = await Promise.allSettled([post(), post()]);
        assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
        assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 3);
        assert.equal((await admin`SELECT status FROM auto_work_item_authorization`)[0].status, 'WAITING');
      });
      await baseTest('lost response same UUID replays after COMPLETED/BLOCKED and advanced revision; a new UUID does not reopen it', async () => {
        await seed(); const id = randomUUID(); await post(id);
        await admin`UPDATE action_attempt SET status='SUCCEEDED',completed_at=now() WHERE attempt_no=3`;
        await admin`UPDATE work_item SET revision=4,projection_json=${canonicalJson({ ...projection, revision: 4 })}`;
        for (const state of ['COMPLETED', 'BLOCKED']) {
          if (state === 'COMPLETED') await admin`UPDATE auto_work_item_authorization SET status='COMPLETED',completed_lease_token_hash=${'e'.repeat(64)},completed_lease_generation=4,completed_at=now()`;
          else await admin`UPDATE auto_work_item_authorization SET status='BLOCKED',completed_lease_token_hash=null,completed_lease_generation=null,completed_at=null`;
          assert.deepEqual(await post(id), { requestId: id, operation: 'EVALUATE_JOBAID', status: 'SUCCEEDED', replayed: true, candidateOnly: true });
          await assert.rejects(post());
        }
        assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 3);
      });
      for (const failure of ['source', 'source-access', 'permission', 'generation', 'blockedAt', 'revision', 'model', 'actor', 'newer-attempt', 'insert', 'CAS'])
        await baseTest(`${failure} changes before/inside locks reject with zero partial reservation`, async () => {
          await seed();
          beforeReserve = async () => {
            if (failure === 'source') sourceCurrent = false;
            if (failure === 'source-access') sourceAllowed = false;
            if (failure === 'permission') permissionCurrent = false;
            if (failure === 'generation') await admin`UPDATE auto_work_item_authorization SET lease_generation=4,blocked_lease_generation=4`;
            if (failure === 'blockedAt') await admin`UPDATE auto_work_item_authorization SET blocked_at=blocked_at+interval '1 second'`;
            if (failure === 'revision') await admin`UPDATE work_item SET revision=4`;
            if (failure === 'model') await admin`UPDATE work_item SET analysis_model_json=${canonicalJson({ ...MODEL, settingsRevision: 2 })}`;
            if (failure === 'actor') activeRequest.userContext.userId = READER;
            if (failure === 'newer-attempt') await admin`UPDATE action_attempt SET created_at='2026-10-10T04:00:00Z' WHERE attempt_no=1`;
            if (failure === 'insert') await admin.unsafe(`CREATE FUNCTION fixture_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FIXTURE_INSERT_FAILURE'; END $$;
              CREATE TRIGGER fixture_reject_insert BEFORE INSERT ON action_attempt FOR EACH ROW EXECUTE FUNCTION fixture_reject_insert()`);
            if (failure === 'CAS') await admin.unsafe(`CREATE FUNCTION fixture_reject_cas() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FIXTURE_CAS_FAILURE'; END $$;
              CREATE TRIGGER fixture_reject_cas BEFORE UPDATE ON auto_work_item_authorization FOR EACH ROW EXECUTE FUNCTION fixture_reject_cas()`);
          };
          const activeRequest = request();
          await assert.rejects(async () => post(randomUUID(), activeRequest));
          assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 2);
          assert.equal((await admin`SELECT status FROM auto_work_item_authorization`)[0].status, 'BLOCKED');
          await admin.unsafe('DROP TRIGGER IF EXISTS fixture_reject_insert ON action_attempt; DROP FUNCTION IF EXISTS fixture_reject_insert(); DROP TRIGGER IF EXISTS fixture_reject_cas ON auto_work_item_authorization; DROP FUNCTION IF EXISTS fixture_reject_cas()');
        });
      await additionTest('OAuth POST: absent, matching and expired optional sessions retain native local admission', async () => {
        for (const cookie of [null, OWNER, 'expired']) {
          await seed();
          assert.equal((await post(randomUUID(), request(OWNER, cookie))).replayed, false);
          assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 3);
        }
        await assert.rejects(initial.cancelledContinuationBinding({tenantId:TENANT,actorUserId:OWNER,workItem:projection}),
          /OFFICIAL_OAUTH_SESSION_REQUIRED/u);
      });
      for (const state of ['absent', 'wrong-code', 'COMPLETED', 'WAITING', 'LEASED'])
        await additionTest('grant eligibility: ' + state, async () => {
          await seed();
          if (state === 'absent') await admin`DELETE FROM auto_work_item_authorization`;
          if (state === 'wrong-code') await admin`UPDATE auto_work_item_authorization SET blocked_code='AUTO_WORK_ITEM_STAGE_OVERALL_FAILED'`;
          if (state === 'COMPLETED') await admin`UPDATE auto_work_item_authorization SET status='COMPLETED',completed_lease_token_hash=${'e'.repeat(64)},completed_lease_generation=4,completed_at=now()`;
          if (state === 'WAITING') await admin`UPDATE auto_work_item_authorization SET status='WAITING'`;
          if (state === 'LEASED') await admin`UPDATE auto_work_item_authorization SET status='LEASED',lease_owner='service:fixture',lease_token='11111111-1111-4111-8111-111111111111',lease_expires_at=now()+interval '1 hour'`;
          const model = await read();
          if (['WAITING', 'LEASED'].includes(state)) assert.deepEqual(model.continuationOperations, ['EVALUATE_JOBAID']);
          else {
            assert.deepEqual(model.continuationOperations, []);
            await assert.rejects(post(), /AUTOMATIC_SCOPE_UNAVAILABLE/u);
          }
          assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 2);
          // This synthetic WAITING setup itself releases the parked fixture once.
          assert.equal((await admin`SELECT count(*)::integer AS n FROM fixture_grant_release_count`)[0].n,
            state === 'WAITING' ? 1 : 0);
        });
      await additionTest('same UUID concurrent POST returns one insertion and one replay with one CAS', async () => {
        await seed(); const id = randomUUID();
        const results = await Promise.all([post(id), post(id)]);
        assert.deepEqual(results.map(row => row.replayed).sort(), [false, true]);
        assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 3);
        assert.equal((await admin`SELECT count(*)::integer AS n FROM fixture_grant_release_count`)[0].n, 1);
      });
      await additionTest('transaction Source: real adapter authorizer repository finishes while the only pool connection holds the WI lock', async () => {
        await seed(); realSourceMode = 'ALLOWED';
        try {
          const result = await post();
          assert.equal(result.status, 'QUEUED');
          assert.equal(sourceExecutors.length, 1);
          assert.ok(sourceExecutors[0], 'SOURCE_MUST_RECEIVE_THE_RESERVATION_TRANSACTION');
          assert.equal((await admin`SELECT count(*)::integer AS n FROM action_attempt`)[0].n, 3);
          assert.deepEqual(await admin`SELECT * FROM action_attempt WHERE attempt_no<=2 ORDER BY attempt_no`, oldRows);
          assert.equal((await admin`SELECT status FROM auto_work_item_authorization`)[0].status, 'WAITING');
          assert.equal((await admin`SELECT count(*)::integer AS n FROM fixture_grant_release_count`)[0].n, 1);
        } finally { await Promise.allSettled(pendingSourceReads); }
      });
      await additionTest('transaction Source: real catalog fallback uses the held executor without a matching WI binding', async () => {
        await seed(); realSourceMode = 'ALLOWED';
        const fallbackDvi = 'DV-source-fallback';
        await admin`INSERT INTO dm_publication_family(family_id,canonical_identity_key)
          VALUES('FAMILY-source-fallback',${tenantFamilyIdentityPrefix(TENANT) + 'fallback'})`;
        await admin`INSERT INTO dm_document_version(document_version_id,family_id,source_artifact_id)
          VALUES(${fallbackDvi},'FAMILY-source-fallback','ART-source-fallback')`;
        await admin`INSERT INTO dm_acquisition(document_version_id,source_artifact_id,status,idempotency_key,acquired_by)
          VALUES(${fallbackDvi},'ART-source-fallback','COMMITTED_CANONICAL',${'tenant:' + encodeURIComponent(TENANT) + ':request:fallback'},${OWNER})`;
        const req = request();
        try {
          await sessions.withNativeBrowserIdentity(req, () => sessions.withVerifiedReviewServiceSql(() =>
            db.transaction(async transaction => {
              await transaction.select().from(workItem).where(eq(workItem.workItemId, WI)).for('update');
              const permission = await boundedSourceRead({tenantId:TENANT,actorUserId:OWNER,workItemId:WI,
                requestId:projection.requestId,...SOURCE,documentVersionId:fallbackDvi}, transaction);
              assert.equal(permission.allowed, true);
            }), OWNER));
          await assertUnchanged();
        } finally { await Promise.allSettled(pendingSourceReads); }
      });
      for (const mode of ['DENIED', 'ERROR']) await additionTest('transaction Source: real ' + mode + ' leaves no new ATT and keeps the blocked grant', async () => {
        await seed(); realSourceMode = mode;
        try {
          await assert.rejects(post(), mode === 'DENIED' ? /BINDING_CHANGED/u : error => error.cause?.code === '22P02');
          await assertUnchanged();
        } finally { await Promise.allSettled(pendingSourceReads); }
      });
      assert.equal(externalCalls, 0);
      t.diagnostic(JSON.stringify({ ownedEndpoint: cluster.instance, ownedDatabase: cluster.identity.name,
        realRestrictedRoles: [nativeRole, serviceRole], externalCalls }));
    } finally {
      MiaodaDocumentVersionSourceResolver.prototype.resolve = originalResolve;
      globalThis.fetch = originalFetch;
      for (const { transport, request, get } of transports) { transport.request = request; transport.get = get; }
      for (const key of Object.keys(process.env)) if (!(key in previousEnvironment)) delete process.env[key];
      Object.assign(process.env, previousEnvironment);
      await cluster.stop();
      await assert.rejects(access(cluster.root));
      t.diagnostic('OWNED_POSTGRES_STOPPED_AND_DIRECTORY_REMOVED');
    }
  });
