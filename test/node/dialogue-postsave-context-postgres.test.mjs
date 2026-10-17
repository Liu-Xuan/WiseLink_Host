import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

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
const tables = require('../../server/database/schema.ts');
const { SessionResolver } = require('../../server/modules/identity/session-resolver.service.ts');
const { MiaodaWorkItemRepository } = require('../../server/modules/work-item/miaoda-work-item.repository.ts');
const { MiaodaHostedCanonicalObjectAccessAdapter } = require('../../server/modules/work-item/miaoda-hosted-canonical-object-access.adapter.ts');
const { MiaodaCanonicalWorkItemRegistrarAdapter } = require('../../server/modules/work-item/miaoda-canonical-work-item-registrar.adapter.ts');
const { OrdinaryCanonicalAuthorizationAdapter, OrdinaryCanonicalPermissionSnapshotAdapter } = require('../../server/modules/canonical-host/ordinary-canonical-authorization.adapter.ts');
const { EngineeringMatterWorkingRepository } = require('../../server/modules/canonical-host/engineering-matter-working.repository.ts');
const { JobAidWorkRepository } = require('../../server/modules/canonical-host/jobaid-work.repository.ts');
const { CanonicalJobAidProblemService } = require('../../server/modules/canonical-host/canonical-jobaid-problem.service.ts');
const { DialogueBrowserScope } = require('../../server/modules/canonical-host/dialogue-browser-scope.service.ts');
const { DialogueRepository } = require('../../server/modules/canonical-host/dialogue.repository.ts');
const { DialogueContextService } = require('../../server/modules/canonical-host/dialogue-context.service.ts');
const { DialogueService } = require('../../server/modules/canonical-host/dialogue.service.ts');
const { jobAidReadingFixture } = require('../unit/semantic-reading-ui.fixtures.ts');

const schema = 'workspace_aadkpkjef3slu';
const authenticated = `authenticated_${schema}`;
const service = `service_role_${schema}`;
const actorId = 'dialogue-owner';
const tenantId = '63849986';
const workItemId = 'WI-dialogue-postsave-fixture';
const documentVersionId = 'DV-dialogue-postsave-fixture';
const workingRef = 'JAWR-dialogue-postsave-fixture';
const request = (actor = actorId, tenant = tenantId) => ({
  headers: {},
  userContext: {
    userId: actor, tenantId: tenant, appId: 'app_17bzc551rsg',
    env: 'preview', isSystemAccount: false, roles: [],
  },
});

// Creates its own local cluster, database and non-superuser application login.
// All business identities/content are synthetic. No configured application DB,
// HTTP, Native, Aily, model or queue operation is used.
test('saved W0 dialogue mutations use real SDK browser reads and service writes',
  { timeout: 90000 }, async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const owned = await startOwnedPostgres(capability);
    const originalSandbox = process.env.SANDBOX_ID;
    const originalLocal = process.env.MIAODA_LOCAL_DEV;
    process.env.SANDBOX_ID = 'isolated-dialogue-postsave';
    delete process.env.MIAODA_LOCAL_DEV;
    try {
      await setup(owned.admin);
      const login = `tdms_fixture_app_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
      await owned.admin.unsafe(`CREATE ROLE ${login} LOGIN NOINHERIT;
        GRANT ${authenticated}, ${service} TO ${login};
        ALTER ROLE ${login} SET search_path=${schema},public;`);
      const connection = await owned.connect(login);
      const db = drizzle(connection);
      const middleware = new SqlExecutionContextMiddleware({ roleSchema: schema });
      const sessions = new SessionResolver({}, {}, middleware);
      const browser = new DialogueBrowserScope(sessions);
      const actors = new EngineeringMatterWorkingRepository(db, middleware, { roleSchema: schema });
      const repository = new DialogueRepository(actors);
      const workItems = new MiaodaWorkItemRepository(db);
      const access = new MiaodaHostedCanonicalObjectAccessAdapter(workItems);
      const reads = [];
      const identity = async () => (await db.execute(sql`
        SELECT current_user AS role,current_setting('app.user_id',true) AS actor`))[0];
      const evidenceDatabase = new Proxy(db, {
        get(target, key) {
          if (key === 'execute') return async (query) => {
            reads.push(await identity());
            return target.execute(query);
          };
          return Reflect.get(target, key);
        },
      });
      const savedWork = new JobAidWorkRepository(db, actors, null);
      const working = new CanonicalJobAidProblemService(
        new MiaodaCanonicalWorkItemRegistrarAdapter(workItems), null, null,
        new OrdinaryCanonicalAuthorizationAdapter(access),
        new OrdinaryCanonicalPermissionSnapshotAdapter(access),
        null, workItems, null, null, savedWork,
        undefined, undefined, undefined, evidenceDatabase,
      );
      const context = new DialogueContextService(access, working, repository);
      let modelCalls = 0;
      const aily = {
        availability: async () => ({ available: false, reason: 'USER_REAUTHORIZATION_REQUIRED' }),
        startMessage: async () => { modelCalls += 1; assert.fail('CONTRIBUTION_ONLY must not start Aily'); },
      };
      const dialogue = new DialogueService(sessions, repository, context, aily);
      const native = request();
      const create = async (withCurrent = true) => {
        reads.length = 0;
        await seed(owned.admin, withCurrent);
        return browser.run(native, () => dialogue.create({
          requestId: 'create-fixture', workItemIds: [workItemId],
        }, native));
      };
      const input = {
        requestId: 'original-C0-fixture', expectedThreadRevision: 1,
        userText: '本轮没有补入新的执行记录。', workItemIds: [workItemId],
        purpose: 'CONTRIBUTION_ONLY', origin: 'HOST',
      };
      const count = async () => (await owned.admin`
        SELECT (SELECT count(*)::integer FROM dialogue_message) AS messages,
          (SELECT count(*)::integer FROM dialogue_assessment_request) AS assessments,
          (SELECT count(*)::integer FROM review_turn) AS turns,
          (SELECT count(*)::integer FROM action_attempt) AS attempts`)[0];

      await t.test('GET reads W0; append freezes the same W0, restores service, and replays once', async () => {
        const thread = await create();
        const before = await browser.runRead(native, () =>
          dialogue.currentContext(thread.threadRef, workItemId, native));
        assert.equal(before[0].workingRef, workingRef);
        assert.equal(before[0].workingRevision, 1);
        assert.equal(before[0].workItemRevision, 4);
        // The original unwrapped mutation read still demonstrates the precise
        // boundary: same actor, saved W0 present, service role rejected by SQL.
        await assert.rejects(browser.run(native, () =>
          context.current(sessions.nativeBrowserIdentity(native), [workItemId])),
        { code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404 });
        assert.deepEqual(await count(), { messages: 0, assessments: 0, turns: 0, attempts: 0 });
        assert.deepEqual(reads.at(-1), { role: service, actor: actorId });
        const result = await browser.run(native, async () => {
          const value = await dialogue.append(thread.threadRef, input, native);
          assert.deepEqual(await identity(), { role: service, actor: actorId });
          return value;
        });
        assert.equal(result.revision, 2);
        assert.equal(result.messages.length, 1);
        assert.equal(result.messages[0].executor, 'NONE');
        assert.equal(result.messages[0].response, null);
        assert.equal(result.messages[0].focus[0].workingRef, workingRef);
        assert.deepEqual(reads.at(-1), { role: authenticated, actor: actorId });
        const [write] = await owned.admin`SELECT role,actor FROM dialogue_write_observation`;
        assert.deepEqual(write, { role: service, actor: actorId });
        const readCount = reads.length;
        const replay = await browser.run(native, () => dialogue.append(thread.threadRef, input, native));
        assert.equal(replay.revision, 2);
        assert.equal(replay.messages.length, 1);
        assert.equal(reads.length, readCount, 'replay does not rebuild or reread saved W0');
        assert.deepEqual(await count(), { messages: 1, assessments: 0, turns: 0, attempts: 0 });
        assert.equal(modelCalls, 0);
      });

      await t.test('source withdrawal rejects GET and append before mutation', async () => {
        const thread = await create();
        await owned.admin`UPDATE dm_source_artifact SET readback_verified=false`;
        await assert.rejects(browser.runRead(native, () =>
          dialogue.currentContext(thread.threadRef, workItemId, native)),
        { code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404 });
        await assert.rejects(browser.run(native, () =>
          dialogue.append(thread.threadRef, input, native)),
        { code: 'CANONICAL_WORK_ITEM_NOT_FOUND', statusCode: 404 });
        const [stored] = await owned.admin`SELECT revision FROM dialogue_thread`;
        assert.equal(stored.revision, 1);
        assert.deepEqual(reads, [
          { role: authenticated, actor: actorId }, { role: authenticated, actor: actorId },
        ]);
        assert.deepEqual(await count(), { messages: 0, assessments: 0, turns: 0, attempts: 0 });
      });

      for (const [name, other] of [
        ['another actor', request('dialogue-other')],
        ['another tenant', request(actorId, '63849987')],
      ]) await t.test(`${name} cannot append to the private thread`, async () => {
        const thread = await create();
        await assert.rejects(browser.run(other, () =>
          dialogue.append(thread.threadRef, input, other)), /DIALOGUE_NOT_FOUND/u);
        assert.equal(reads.length, 0, 'private isolation fails before the W0 reader');
        assert.deepEqual(await count(), { messages: 0, assessments: 0, turns: 0, attempts: 0 });
      });

      await t.test('empty W0 remains empty and permits contribution-only input', async () => {
        const thread = await create(false);
        const result = await browser.run(native, () => dialogue.append(thread.threadRef, input, native));
        assert.equal(result.messages[0].focus[0].workingRef, null);
        assert.equal(reads.length, 0, 'no fabricated saved evidence');
        assert.deepEqual(await count(), { messages: 1, assessments: 0, turns: 0, attempts: 0 });
        assert.equal(modelCalls, 0);
      });

      await t.test('authenticated browser cannot use the service transaction write helper', async () => {
        await assert.rejects(browser.runRead(native, () =>
          actors.withActorTransaction(actorId, () => assert.fail('service guard bypassed'))),
        /RUNTIME_AUTHORIZATION_UNAVAILABLE/u);
      });
    } finally {
      if (originalSandbox === undefined) delete process.env.SANDBOX_ID;
      else process.env.SANDBOX_ID = originalSandbox;
      if (originalLocal === undefined) delete process.env.MIAODA_LOCAL_DEV;
      else process.env.MIAODA_LOCAL_DEV = originalLocal;
      await owned.stop();
    }
  });

async function setup(admin) {
  await admin.unsafe(`CREATE SCHEMA ${schema}; SET search_path=${schema},public;
    CREATE ROLE service_role NOLOGIN;
    CREATE ROLE ${service} NOLOGIN IN ROLE service_role;
    CREATE ROLE ${authenticated} NOLOGIN;
    GRANT USAGE ON SCHEMA ${schema} TO service_role,${authenticated};
    CREATE TYPE user_profile AS (user_id varchar);`);
  for (const table of [tables.workItem, tables.actionAttempt, tables.assessmentWorkRevision,
    tables.identitySubjectMapping, tables.reviewConversation, tables.reviewTurn, tables.reviewAilyQuery]) {
    const config = getTableConfig(table);
    const columns = config.columns.filter((c) =>
      config.name !== 'review_aily_query' || !['message_ref', 'remote_session_id'].includes(c.name));
    await admin.unsafe(`CREATE TABLE ${config.name} (${columns.map((c) =>
      `"${c.name}" ${c.getSQLType()}`).join(',')})`);
  }
  await admin.unsafe(`ALTER TABLE work_item ADD UNIQUE(tenant_id,work_item_id);
    ALTER TABLE review_conversation ADD UNIQUE(review_conversation_id);
    ALTER TABLE review_turn ADD UNIQUE(review_turn_id);
    CREATE TABLE dm_publication_family(family_id varchar,canonical_identity_key text);
    CREATE TABLE dm_document_version(document_version_id varchar,family_id varchar,
      acquisition_id varchar,source_artifact_id varchar,document_id varchar,pdf_sha256 varchar,byte_length bigint);
    CREATE TABLE dm_acquisition(acquisition_id varchar,document_version_id varchar,
      source_artifact_id varchar,idempotency_key text,status text);
    CREATE TABLE dm_source_artifact(source_artifact_id varchar,readback_verified boolean,sha256 varchar,byte_length bigint);
    CREATE FUNCTION engineering_matter_uri_component(value text) RETURNS text
      LANGUAGE sql IMMUTABLE AS $$ SELECT value $$;`);
  const ownerDdl = await readFile(new URL('../../migrations/0014_engineering_matter_catalog.sql', import.meta.url), 'utf8');
  for (const name of ['engineering_matter_actor_has_tenant', 'engineering_matter_work_item_owned_by_actor']) {
    const expression = new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`, 'u');
    const definition = ownerDdl.match(expression)?.[0];
    assert.ok(definition, name);
    await admin.unsafe(definition);
  }
  await admin.unsafe(await readFile(new URL('../../migrations/0030_personal_dialogue.sql', import.meta.url), 'utf8'));
  const nativeDdl = await readFile(new URL('../../migrations/0078_native_tenant_shared_read.sql', import.meta.url), 'utf8');
  // Use the exact three production evidence predicates, including the fixed
  // authenticated role, tenant, acquisition and original byte/hash checks.
  await admin.unsafe(nativeDdl.slice(nativeDdl.indexOf('CREATE OR REPLACE FUNCTION native_app_shared_read_allowed'),
    nativeDdl.indexOf('-- A fact-only read')));
  for (const table of ['work_item', 'action_attempt', 'assessment_work_revision']) {
    await admin.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON ${table} TO service_role,${authenticated};
      CREATE POLICY service_owner_read ON ${table} FOR SELECT TO service_role USING
        (engineering_matter_actor_has_tenant(tenant_id));
      CREATE POLICY native_read ON ${table} FOR SELECT TO ${authenticated} USING
        (native_app_shared_read_allowed(tenant_id));`);
  }
  await admin.unsafe(`GRANT SELECT,INSERT,UPDATE ON dialogue_thread,dialogue_message,
    discussion_contribution,dialogue_assessment_request,review_aily_query TO service_role;
    GRANT SELECT ON dialogue_thread,dialogue_message,discussion_contribution,
      dialogue_assessment_request,review_aily_query,review_turn,review_conversation TO ${authenticated};
    GRANT SELECT ON review_turn,review_conversation TO service_role;`);
  for (const table of ['dialogue_thread', 'dialogue_message', 'discussion_contribution', 'dialogue_assessment_request']) {
    await admin.unsafe(`CREATE POLICY native_private_read ON ${table}
      FOR SELECT TO ${authenticated} USING (native_app_shared_read_allowed(tenant_id)
        AND actor_id=current_setting('app.user_id',true));`);
  }
  await admin.unsafe(`CREATE TABLE dialogue_write_observation(role text,actor text);
    GRANT INSERT ON dialogue_write_observation TO service_role;
    CREATE FUNCTION observe_dialogue_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO dialogue_write_observation VALUES(current_user,current_setting('app.user_id',true));
      RETURN NEW; END $$;
    CREATE TRIGGER observe_dialogue_write BEFORE INSERT ON dialogue_message
      FOR EACH ROW EXECUTE FUNCTION observe_dialogue_write();`);
}

async function seed(admin, withCurrent) {
  await admin.unsafe(`TRUNCATE dialogue_thread,dialogue_message,discussion_contribution,
    dialogue_assessment_request,review_aily_query,review_turn,review_conversation,
    work_item,action_attempt,assessment_work_revision,identity_subject_mapping,
    dm_publication_family,dm_document_version,dm_acquisition,dm_source_artifact,
    dialogue_write_observation CASCADE;`);
  await admin`INSERT INTO identity_subject_mapping(miaoda_user_id,miaoda_tenant_id,expected_client_id,status)
    VALUES (${actorId},${tenantId},'cli_aadde8b579f95bc9','ACTIVE'),
      ('dialogue-other',${tenantId},'cli_aadde8b579f95bc9','ACTIVE')`;
  const projection = {
    workItemId, requestId: 'REQ-dialogue-fixture', revision: 4,
    source: { documentVersionId }, integratedAssessment: { baseRules: {
      schemaVersion: 'wiselink.jobaid-problem-result.v2', workRevisionRef: workingRef,
    } },
  };
  await admin`INSERT INTO work_item(work_item_id,tenant_id,request_id,revision,
    document_id,document_version_id,requested_by_user_id,run_key,projection_json)
    VALUES(${workItemId},${tenantId},${projection.requestId},4,'DOC-fixture',${documentVersionId},
      ${actorId},'canonical',${JSON.stringify(projection)})`;
  await admin`INSERT INTO dm_publication_family VALUES('FAM-fixture','tenant:63849986:family:fixture')`;
  await admin`INSERT INTO dm_document_version VALUES(${documentVersionId},'FAM-fixture',
    'ACQ-fixture','ART-fixture','DOC-fixture','fixture-hash',100)`;
  await admin`INSERT INTO dm_acquisition VALUES('ACQ-fixture',${documentVersionId},
    'ART-fixture','tenant:63849986:request:fixture','COMMITTED_CANONICAL')`;
  await admin`INSERT INTO dm_source_artifact VALUES('ART-fixture',true,'fixture-hash',100)`;
  if (withCurrent) {
    const content = { ...jobAidReadingFixture().current.content, issues: [], evidence: [{
      kind: 'DOCUMENT_PASSAGE', evidenceRef: 'source-fixture', workItemId, documentVersionId,
      artifactRef: 'ART-fixture', artifactSha256: 'fixture-hash', quote: 'Synthetic source passage',
    }] };
    await admin`INSERT INTO assessment_work_revision(assessment_work_revision_id,tenant_id,
      work_item_id,work_revision,previous_work_revision_id,request_id,action_attempt_id,
      based_on_work_item_revision,document_version_id,created_by_user_id,created_at,content_json)
      VALUES(${workingRef},${tenantId},${workItemId},1,null,'REQ-W0-fixture','ATT-W0-fixture',
        3,${documentVersionId},${actorId},clock_timestamp(),${JSON.stringify(content)})`;
  }
}
