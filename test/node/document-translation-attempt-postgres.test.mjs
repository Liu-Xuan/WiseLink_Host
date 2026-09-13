import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postgres from 'postgres';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { actionAttempt } = require('../../server/database/schema.ts');
const { drizzle } = require('drizzle-orm/postgres-js');
const { sql: query } = require('drizzle-orm');
const { DocumentTranslationAttemptRepository } = require('../../server/modules/action-attempt/document-translation-attempt.repository.ts');
const { sealDocumentTranslationTaskEnvelope } = require('../../server/modules/action-attempt/document-translation-task-envelope.ts');
const url = process.env.DOCUMENT_ATTEMPT_TEST_DATABASE_URL;

test('document attempts preserve published source identity and service-only actor scope', { skip: !url }, async () => {
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/wiselink_document_attempt_test');
  const db = postgres(url, { max: 1, onnotice() {} });
  try {
    await db.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TYPE user_profile AS (user_id text);
      CREATE TABLE dm_document_version(document_version_id varchar PRIMARY KEY);
      INSERT INTO dm_document_version VALUES ('DV');
      CREATE TABLE dm_document_parse_run(tenant_id varchar, document_version_id varchar, parse_run_id varchar,
        parse_revision integer, status varchar, manifest_artifact jsonb);
      CREATE TABLE engineering_matter(tenant_id varchar,matter_id varchar,current_matter_revision_id varchar);
      CREATE FUNCTION engineering_matter_actor_has_tenant(t varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT t='tenant' AND current_setting('app.user_id',true)='actor' $$;
      CREATE FUNCTION engineering_matter_document_owned_by_actor(t varchar,dv varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT t='tenant' AND dv='DV' AND current_setting('app.user_id',true)='actor' $$;
      CREATE FUNCTION engineering_matter_owned_by_actor(t varchar,m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE FUNCTION engineering_matter_all_links_owned_by_actor(t varchar,m varchar) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;`);
    const columns = getTableConfig(actionAttempt).columns.map(column => `"${column.name}" ${column.getSQLType()}`);
    await db.unsafe(`CREATE TABLE action_attempt (${columns.join(',')}, CONSTRAINT ck_action_attempt_subject CHECK(true));
      ALTER TABLE action_attempt ENABLE ROW LEVEL SECURITY;
      CREATE POLICY legacy_broad_policy ON action_attempt FOR ALL TO authenticated,service_role USING(true) WITH CHECK(true);
      CREATE POLICY action_attempt_matter_subject_boundary ON action_attempt AS RESTRICTIVE FOR ALL TO PUBLIC USING(true);
      INSERT INTO dm_document_parse_run VALUES ('tenant','DV','parse',1,'PUBLISHED','{"role":"MANIFEST","relativePath":"original/manifest.json","readback":"VERIFIED"}'),
        ('tenant','DV','staging',2,'STAGING',null);
      GRANT USAGE ON SCHEMA public TO authenticated,service_role;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,service_role;`);
    await db.unsafe(await readFile(new URL('../../migrations/0048_document_translation_attempt_subject.sql', import.meta.url), 'utf8'));
    const asRole = (role, actor, fn) => db.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx`SELECT set_config('app.user_id',${actor},true)`;
      return fn(tx);
    });
    const insert = (tx, attempt, overrides = {}) => tx`INSERT INTO action_attempt ${tx({
      attempt_id: attempt, tenant_id: 'tenant', actor_user_id: 'actor', subject_kind: 'DOCUMENT_VERSION',
      work_item_id: null, document_version_id: 'DV', producer_run_id: 'parse', input_revision: 1,
      action_type: 'DOCUMENT_TRANSLATE', attempt_no: 1, status: 'QUEUED', ...overrides,
    })}`;
    // Reproduce Hosted retaining the 0037 policy after the unsupported 0048
    // ALTER POLICY. The real document boundary is already present and retained.
    const legacyPolicy = await readFile(new URL('../../migrations/0037_matter_restrictive_policy_runtime_roles.sql', import.meta.url), 'utf8');
    await db.unsafe(legacyPolicy.slice(0, legacyPolicy.indexOf('DROP POLICY engineering_matter_work_real_attempt_boundary')) + 'COMMIT;');
    await assert.rejects(asRole('service_role','actor',tx => insert(tx,'before-policy-fix')), /action_attempt_matter_subject_boundary/);
    await db.unsafe(await readFile(new URL('../../migrations/0053_document_attempt_matter_policy_recreate.sql', import.meta.url), 'utf8'));
    await db.unsafe(await readFile(new URL('../../migrations/0054_document_attempt_policy_identity.sql', import.meta.url), 'utf8'));
    const oldPolicies = await db`SELECT policyname FROM pg_policies WHERE policyname='action_attempt_matter_subject_boundary'`;
    assert.equal(oldPolicies.length, 0);
    const [policy] = await db`SELECT roles, permissive, cmd, with_check FROM pg_policies WHERE policyname='action_attempt_matter_or_document_subject_boundary'`;
    assert.equal(policy.cmd, 'ALL');
    assert.equal(policy.with_check, null);
    assert.equal(policy.permissive, 'RESTRICTIVE');
    assert.deepEqual([...policy.roles].sort(), ['authenticated', 'service_role']);
    await assert.rejects(asRole('authenticated','actor',tx => insert(tx,'native')), /row-level security/);
    await assert.rejects(asRole('service_role','other',tx => insert(tx,'wrong-actor')), /row-level security/);
    await asRole('service_role','actor',tx => insert(tx,'real'));
    await db`UPDATE action_attempt SET operation_ref='operation', deadline_at=now()+interval '10 minutes',
      lease_generation=0,claim_count=0 WHERE attempt_id='real'`;
    const scope = { tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'DV' };
    const use = fn => drizzle(db).transaction(async tx => {
      await tx.execute(query`SET LOCAL ROLE service_role`);
      await tx.execute(query`SELECT set_config('app.user_id','actor',true)`);
      return fn(new DocumentTranslationAttemptRepository(tx));
    });
    const first = await use(repo => repo.claim(scope, 'operation', 'consumer-a'));
    assert.ok(first);
    assert.equal(await use(repo => repo.claim(scope, 'operation', 'consumer-b')), null);
    await db`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second' WHERE attempt_id='real'`;
    const replacement = await use(repo => repo.claim(scope, 'operation', 'consumer-b'));
    assert.equal(replacement.leaseGeneration, first.leaseGeneration + 1);
    assert.equal(await use(repo => repo.renew(scope, first)), false);
    await use(repo => repo.release(scope, first));
    assert.equal(await use(repo => repo.renew(scope, replacement)), true);
    assert.equal((await asRole('authenticated','actor',tx => tx`SELECT * FROM action_attempt`)).length, 1);
    assert.equal((await asRole('service_role','other',tx => tx`SELECT * FROM action_attempt`)).length, 0);
    await assert.rejects(asRole('service_role','actor',tx => insert(tx,'second',{ attempt_no: 2 })), /duplicate key/);
    await assert.rejects(asRole('service_role','actor',tx => tx`UPDATE action_attempt SET work_item_id='fake',subject_kind='WORK_ITEM' WHERE attempt_id='real'`), /SUBJECT_IMMUTABLE/);
    await assert.rejects(asRole('service_role','actor',tx => insert(tx,'unpublished',{ producer_run_id: 'staging', input_revision: 2, attempt_no: 2 })), /ORIGINAL_NOT_PUBLISHED/);
    assert.equal((await asRole('authenticated','actor',tx => tx`UPDATE action_attempt SET status='SUCCEEDED' WHERE attempt_id='real' RETURNING attempt_id`)).length, 0);
    await use(repo => repo.cancel(scope, 'operation'));
    assert.equal(await use(repo => repo.renew(scope, replacement)), false);
    assert.equal(await use(repo => repo.claim(scope, 'operation', 'late')), null);
    await asRole('service_role','actor',tx => insert(tx,'successor',{ attempt_no: 2 }));
    // Legacy producer IDs do not reference parseRun and must remain valid.
    await db`INSERT INTO action_attempt(attempt_id,subject_kind,work_item_id,action_type,producer_run_id)
      VALUES ('legacy','WORK_ITEM','WI','OPENCLAW_TRANSLATE','legacy-worker-run')`;
    assert.equal((await db`SELECT * FROM action_attempt`).length, 3);
    await db`INSERT INTO dm_document_parse_run VALUES ('tenant','DV','parse-new',3,'PUBLISHED',
      ${JSON.stringify({ role: 'MANIFEST', relativePath: 'original/manifest.json', readback: 'VERIFIED', sha256: 'a'.repeat(64), byteLength: 123 })}::jsonb)`;
    const source = { documentVersionId: 'DV', packageId: 'parse-new',
      originalBinding: { documentVersionId: 'DV', parseRunId: 'parse-new', parseRevision: 3, sourceArtifactId: 'PDF',
        sourceSha256: 'b'.repeat(64), sourceByteLength: 234 },
      parsedArtifact: { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'document-original://DV/parse-new',
        sha256: 'a'.repeat(64), byteLength: 123, mediaType: 'application/json' } };
    const task = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
      actionAttemptId: 'new-source-attempt', operationRef: 'new-operation', tenantId: 'tenant',
      documentVersionId: 'DV', parseRunId: 'parse-new', parseRevision: 3, workspaceId: 'workspace',
      modelInput: { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'workspace', planRevision: 1,
        contextRevision: 1, methodVersion: 'semantic-translation@2.0', documentProducer: 'OFFICIAL_PLUGIN', source },
      deadline: new Date(Date.now()+600_000).toISOString(), idempotencyKey: 'translation-new' });
    await db.unsafe(`ALTER TABLE action_attempt ADD CONSTRAINT test_reservation_failure CHECK(trigger_request_id IS DISTINCT FROM 'fail')`);
    await assert.rejects(use(repo => repo.reserve(scope, task, 'fail')), error => error.cause?.constraint_name === 'test_reservation_failure');
    assert.equal((await db`SELECT status FROM action_attempt WHERE attempt_id='successor'`)[0].status, 'QUEUED');
    await use(repo => repo.reserve(scope, task, 'new-request'));
    assert.equal((await db`SELECT status,terminal_reason FROM action_attempt WHERE attempt_id='successor'`)[0].terminal_reason,
      'DOCUMENT_ORIGINAL_SUPERSEDED');
    assert.equal((await db`SELECT status FROM action_attempt WHERE attempt_id='new-source-attempt'`)[0].status, 'QUEUED');
    assert.equal((await use(repo => repo.reserve(scope, task, 'new-request'))).attemptId, 'new-source-attempt');
    const stale = structuredClone(task);
    delete stale.inputHash;
    stale.parseRunId='parse'; stale.parseRevision=1; stale.modelInput.source.packageId='parse';
    Object.assign(stale.modelInput.source.originalBinding,{parseRunId:'parse',parseRevision:1});
    stale.modelInput.source.parsedArtifact.ref='document-original://DV/parse';
    await assert.rejects(use(repo => repo.reserve(scope, sealDocumentTranslationTaskEnvelope(stale), 'stale-request')), /RESERVATION_SOURCE_CHANGED/);
    // Semantic revisions use the same exact published source and current actor boundary.
    await db.unsafe(await readFile(new URL('../../migrations/0055_document_semantic_revision.sql', import.meta.url), 'utf8'));
    await db.unsafe('GRANT SELECT,INSERT,UPDATE,DELETE ON dm_document_semantic_revision TO authenticated,service_role');
    const { DocumentSemanticRevisionRepository } = require('../../server/modules/canonical-host/document-semantic-revision.repository.ts');
    const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
    const { buildDocumentSemanticMap } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-map.ts');
    const { GENERIC_SEMANTIC_PROFILE } = require('../../server/modules/document-management/src/hosted/nest/document-semantic-profile.ts');
    const original = originalFixture();
    original.binding = source.originalBinding;
    const map = buildDocumentSemanticMap({ original, semanticRevision: 1, profile: GENERIC_SEMANTIC_PROFILE });
    const semantic = (role, actor, fn) => drizzle(db).transaction(async tx => {
      await tx.execute(query.raw(`SET LOCAL ROLE ${role}`));
      await tx.execute(query`SELECT set_config('app.user_id',${actor},true)`);
      return fn(new DocumentSemanticRevisionRepository(tx));
    });
    const append = (repo, value=map, expected=0, sha='a'.repeat(64)) => repo.append(scope, original, value, expected, sha);
    await assert.rejects(semantic('authenticated','actor',append), error => error.cause?.code === '42501');
    await assert.rejects(semantic('service_role','other',append), error => error.cause?.code === '42501');
    await assert.rejects(semantic('service_role','actor',repo => append(repo,map,0,'wrong')), /ORIGINAL_CHANGED/);
    assert.deepEqual(await semantic('service_role','actor',append), map);
    assert.deepEqual(await semantic('authenticated','actor',repo => repo.read(scope,'parse-new',1)), map);
    assert.equal(await semantic('service_role','other',repo => repo.read(scope,'parse-new',1)), null);
    await assert.rejects(semantic('service_role','actor',append), /REVISION_CONFLICT/);
    const nextMap = { ...map, semanticRevision: 2 };
    await semantic('service_role','actor',repo => append(repo,nextMap,1));
    assert.deepEqual(await semantic('service_role','actor',repo => repo.read(scope,'parse-new',1)), map);
    assert.deepEqual(await semantic('service_role','actor',repo => repo.read(scope,'parse-new')), nextMap);
    // Exercise the actual INDEX semantic service, including registered family lookup and retry readback.
    const { DocumentSemanticService } = require('../../server/modules/canonical-host/document-semantic.service.ts');
    await db.unsafe("ALTER TABLE dm_document_version ADD COLUMN family_id varchar; CREATE TABLE dm_publication_family(family_id varchar,document_family varchar,issuer_authority varchar); INSERT INTO dm_publication_family VALUES ('family','FTD','BOEING'); UPDATE dm_document_version SET family_id='family'; GRANT SELECT ON dm_publication_family TO service_role");
    await db`INSERT INTO dm_document_parse_run SELECT tenant_id,document_version_id,'parse-service',4,status,manifest_artifact FROM dm_document_parse_run WHERE parse_run_id='parse-new'`;
    const serviceOriginal = structuredClone(original);
    Object.assign(serviceOriginal.binding,{parseRunId:'parse-service',parseRevision:4});
    const loaded = { original:serviceOriginal, run: {tenantId:'tenant',parseRunId:'parse-service',manifestArtifact:{readback:'VERIFIED',sha256:'a'.repeat(64)}} };
    const ensure = () => drizzle(db).transaction(async tx => {
      await tx.execute(query`SET LOCAL ROLE service_role`);
      await tx.execute(query`SELECT set_config('app.user_id','actor',true)`);
      return new DocumentSemanticService(tx,new DocumentSemanticRevisionRepository(tx)).ensure({...scope,roles:[]},loaded);
    });
    const indexedMap = await ensure();
    assert.equal(indexedMap.profileRef,'boeing.ftd.sections.v1');
    assert.deepEqual(await ensure(),indexedMap);
    const { bindMatterOriginalInputs } = require('../../server/modules/canonical-host/matter-original-input-bindings.ts');
    const boundInputs = await drizzle(db).transaction(async tx => {
      await tx.execute(query`SET LOCAL ROLE service_role`);
      await tx.execute(query`SELECT set_config('app.user_id','actor',true)`);
      return bindMatterOriginalInputs(tx,'tenant',[
      {inputId:'document',kind:'DOCUMENT_VERSION',familyId:'family',documentVersionId:'DV',workItemId:null,workItemRevision:null,resultRef:null,resultRevision:null}
    ]); });
    assert.deepEqual(boundInputs[0].original,{parseRunId:'parse-service',parseRevision:4,semantic:{revision:1,profileRef:'boeing.ftd.sections.v1'}});

    // Even a later broad platform policy cannot allow native writes or mutate history.
    await db.unsafe('CREATE POLICY constructed_broad_semantic_policy ON dm_document_semantic_revision FOR ALL TO authenticated,service_role USING(true) WITH CHECK(true)');
    await assert.rejects(semantic('authenticated','actor',repo => append(repo,{...map,semanticRevision:3},2)), error => error.cause?.code === '42501');
    await assert.rejects(asRole('service_role','actor',tx => tx`UPDATE dm_document_semantic_revision SET profile_ref='changed'`), /IMMUTABLE/);
    await assert.rejects(asRole('service_role','actor',tx => tx`DELETE FROM dm_document_semantic_revision`), /IMMUTABLE/);
  } finally { await db.end(); }
});
