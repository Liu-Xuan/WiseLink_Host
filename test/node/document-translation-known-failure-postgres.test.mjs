import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { actionAttempt, translationBlockRevision, translationWorkspace } = require('../../server/database/schema.ts');
const { DocumentTranslationAttemptRepository } = require('../../server/modules/action-attempt/document-translation-attempt.repository.ts');
const { sealDocumentTranslationTaskEnvelope } = require('../../server/modules/action-attempt/document-translation-task-envelope.ts');
const { buildTranslationSourcePlan } = require('../../server/modules/canonical-host/canonical-translation-source-plan.ts');
const { canonicalJson } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const { taskModelSelection } = require('../../server/modules/model-settings/canonical-model-catalog.ts');
const databaseUrl = process.env.DOCUMENT_TRANSLATION_KNOWN_FAILURE_TEST_DATABASE_URL;

test('known-failure successor is transactional, exact and idempotent in PostgreSQL',
  { skip: !databaseUrl }, async () => {
    const target = new URL(databaseUrl);
    assert.equal(target.hostname, '127.0.0.1');
    assert.equal(target.pathname, '/wiselink_translation_known_failure_test');
    const sql = postgres(databaseUrl, { max: 4, onnotice() {} });
    try {
      await sql.unsafe(`DROP TABLE IF EXISTS translation_block_revision,translation_workspace,action_attempt,
        dm_document_parse_run,dm_document_version CASCADE;
        DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='user_profile')
          THEN CREATE TYPE user_profile AS (user_id text); END IF; END $$;
        CREATE TABLE dm_document_version(document_version_id varchar PRIMARY KEY);
        CREATE TABLE dm_document_parse_run(tenant_id varchar,document_version_id varchar,
          parse_run_id varchar,parse_revision integer,status varchar,manifest_artifact jsonb);
        INSERT INTO dm_document_version VALUES ('DV');`);
      for (const [name, table] of [['action_attempt', actionAttempt],
        ['translation_workspace', translationWorkspace], ['translation_block_revision', translationBlockRevision]]) {
        const columns = getTableConfig(table).columns.map(column =>
          `"${column.name.replaceAll('"', '""')}" ${column.getSQLType()}`);
        await sql.unsafe(`CREATE TABLE ${name} (${columns.join(',')})`);
      }
      await sql.unsafe(`CREATE UNIQUE INDEX test_attempt_id ON action_attempt(attempt_id);
        CREATE UNIQUE INDEX test_operation_ref ON action_attempt(operation_ref);
        CREATE UNIQUE INDEX test_idempotency ON action_attempt(tenant_id,idempotency_key);
        CREATE UNIQUE INDEX test_document_number ON action_attempt(tenant_id,document_version_id,
          action_type,attempt_no);
        CREATE UNIQUE INDEX test_active_document ON action_attempt(tenant_id,document_version_id,action_type)
          WHERE status IN ('QUEUED','RUNNING','RETRY_SCHEDULED','COMMITTING');`);
      const source = { modules: [{ moduleId: 'module', order: 0 }], findings: [], references: [],
        sourceLocators: [{ sourceRefId: 'sr', kind: 'pdf_page', artifactId: 'PDF', pageStart: 1,
          pageEnd: 1, charStart: null, charEnd: null, charOffsetUnit: null, normalizedPath: null,
          xpath: null, elementId: null, quote: null, bbox: null }],
        units: [{ unitId: 'u', kind: 'heading', moduleId: 'module', parentUnitId: null, order: 0,
          depth: 0, continuityKey: 'u', sourceRefIds: ['sr'], sourceSegmentIds: ['seg'],
          mapping: { status: 'mapped_exactly', confidence: 'deterministic', findingIds: [] },
          payload: { text: 'Synthetic document', level: 1 } }] };
      const artifact = { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'document-original://DV/parse',
        sha256: 'a'.repeat(64), byteLength: 123, mediaType: 'application/json' };
      const plan = buildTranslationSourcePlan({ documentVersionId: 'DV', packageId: 'parse',
        parsedArtifact: artifact, title: 'Synthetic document', source });
      plan.source.originalBinding = { documentVersionId: 'DV', parseRunId: 'parse', parseRevision: 1,
        sourceArtifactId: 'PDF', sourceSha256: 'b'.repeat(64), sourceByteLength: 456 };
      const model = taskModelSelection();
      const modelInput = { schemaVersion: 'wiselink.3_1.translation_task.v2', workspaceId: 'TW',
        planRevision: plan.planRevision, contextRevision: plan.documentContext.revision,
        methodVersion: 'semantic-translation@2.0', documentProducer: 'HOSTED_M3', source: plan.source };
      const prior = sealDocumentTranslationTaskEnvelope({ schemaVersion: 'wiselink.document.translation_task.v1',
        actionAttemptId: 'DTA-prior', operationRef: 'DTQ-prior', tenantId: 'tenant', documentVersionId: 'DV',
        parseRunId: 'parse', parseRevision: 1, workspaceId: 'TW', modelInput,
        deadline: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: 'original' });
      const now = new Date().toISOString();
      const generation = { generationRequestRef: 'TG-known', clientRequestId: 'step-prior',
        attemptId: prior.actionAttemptId, leaseGeneration: 1, blockIds: [plan.blocks[0].blockId],
        dependencies: { planRevision: 1, contextRevision: 1, sourceAnchorIds: ['a1'],
          contextAnchorIds: [], methodVersion: modelInput.methodVersion }, purpose: 'GENERATE',
        targetBlockRevisionId: null, status: 'FAILED', registeredAt: now, finishedAt: now,
        error: { origin: 'UPSTREAM', code: 'HTTP_400', outcome: 'KNOWN_FAILURE', retryable: false } };
      await sql`INSERT INTO dm_document_parse_run VALUES ('tenant','DV','parse',1,'PUBLISHED',
        ${sql.json({ sha256: artifact.sha256, byteLength: artifact.byteLength })}::jsonb)`;
      await sql`INSERT INTO translation_workspace (workspace_id,tenant_id,work_item_id,subject_kind,
        document_version_id,package_id,parsed_artifact_ref,parsed_artifact_sha256,target_locale,
        plan_revision,context_revision,source_plan_json,method_version,active_attempt_id,
        generation_requests_json,row_version)
        VALUES ('TW','tenant',null,'DOCUMENT_VERSION','DV','parse',${artifact.ref},${artifact.sha256},
          'zh-CN',1,1,${canonicalJson(plan)},${modelInput.methodVersion},${prior.actionAttemptId},
          ${canonicalJson([generation])},1)`;
      await sql`INSERT INTO action_attempt (attempt_id,operation_ref,tenant_id,actor_user_id,
        document_version_id,subject_kind,action_type,attempt_no,trigger_request_id,request_origin,
        status,producer_run_id,input_revision,task_envelope_json,task_input_hash,idempotency_key,
        execution_model_json,error_code,terminal_reason,projection_applied)
        VALUES (${prior.actionAttemptId},${prior.operationRef},'tenant','actor','DV','DOCUMENT_VERSION',
          'DOCUMENT_TRANSLATE',1,'root','HOST_DOCUMENT','FAILED','parse',1,${canonicalJson(prior)},
          ${prior.inputHash},${prior.idempotencyKey},${canonicalJson(model)},'STEP_FAILED','STEP_FAILED',false)`;
      const repository = new DocumentTranslationAttemptRepository(drizzle(sql));
      const scope = { tenantId: 'tenant', actorUserId: 'actor', documentVersionId: 'DV' };
      const current = { parseRunId: 'parse', parseRevision: 1, modelInput };
      const recover = () => repository.recoverKnownFailure(scope, prior.operationRef, 'root', current,
        taskModelSelection());
      await assert.rejects(repository.recoverKnownFailure({ ...scope, actorUserId: 'other' },
        prior.operationRef, 'root', current, model), /PREDECESSOR_NOT_FOUND/u);
      await assert.rejects(repository.recoverKnownFailure(scope, prior.operationRef, 'other', current, model),
        /PREDECESSOR_INVALID/u);
      await assert.rejects(repository.recoverKnownFailure(scope, prior.operationRef, 'root',
        { ...current, modelInput: { ...modelInput, methodVersion: 'changed' } }, model),
      /PREDECESSOR_INVALID/u);
      await assert.rejects(repository.recoverKnownFailure(scope, prior.operationRef, 'root',
        current, taskModelSelection('miaoda/minimax-m3')), /PREDECESSOR_INVALID/u);
      await sql`UPDATE dm_document_parse_run SET manifest_artifact=${JSON.stringify({
        sha256: 'c'.repeat(64), byteLength: artifact.byteLength })}::jsonb WHERE parse_run_id='parse'`;
      await assert.rejects(recover(), /SOURCE_CHANGED/u);
      await sql`UPDATE dm_document_parse_run SET manifest_artifact=${JSON.stringify({
        sha256: artifact.sha256, byteLength: artifact.byteLength })}::jsonb WHERE parse_run_id='parse'`;
      await sql`UPDATE translation_workspace SET plan_revision=2 WHERE workspace_id='TW'`;
      await assert.rejects(recover(), /WORKSPACE_CHANGED/u);
      await sql`UPDATE translation_workspace SET plan_revision=1 WHERE workspace_id='TW'`;
      await sql`UPDATE translation_workspace SET generation_requests_json=${canonicalJson([{ ...generation,
        status: 'REGISTERED', finishedAt: null,
        error: { ...generation.error, outcome: 'GENERATION_UNKNOWN' } }])} WHERE workspace_id='TW'`;
      await assert.rejects(recover(), /GENERATION_UNSETTLED/u);
      assert.equal((await sql`SELECT generation_requests_json FROM translation_workspace`)[0]
        .generation_requests_json.includes('GENERATION_UNKNOWN'), true);
      await sql`UPDATE translation_workspace SET generation_requests_json=${canonicalJson([generation])}
        WHERE workspace_id='TW'`;
      await sql`INSERT INTO translation_block_revision (block_revision_id,tenant_id,workspace_id,
        generation_request_ref,origin_attempt_id) VALUES ('TB-saved','tenant','TW','TG-known','DTA-prior')`;
      await assert.rejects(recover(), /SAVED_OUTPUT/u);
      await sql`DELETE FROM translation_block_revision`;
      await sql`UPDATE translation_workspace SET result_artifact_json='{}' WHERE workspace_id='TW'`;
      await assert.rejects(recover(), /HAS_OUTPUT/u);
      await sql`UPDATE translation_workspace SET result_artifact_json=null,
        active_attempt_id='DTA-other' WHERE workspace_id='TW'`;
      await assert.rejects(recover(), /COORDINATOR_CHANGED/u);
      await sql`UPDATE translation_workspace SET active_attempt_id=${prior.actionAttemptId}
        WHERE workspace_id='TW'`;
      await sql.unsafe(`ALTER TABLE action_attempt ADD CONSTRAINT reject_successor
        CHECK (trigger_request_id IS DISTINCT FROM 'root:known-failure')`);
      await assert.rejects(recover(), error => error.cause?.constraint_name === 'reject_successor');
      assert.equal((await sql`SELECT active_attempt_id FROM translation_workspace`)[0].active_attempt_id,
        prior.actionAttemptId, 'failed insertion rolls back coordinator update');
      assert.equal((await sql`SELECT count(*)::int AS count FROM action_attempt`)[0].count, 1);
      await sql.unsafe('ALTER TABLE action_attempt DROP CONSTRAINT reject_successor');
      const [first, repeated] = await Promise.all([recover(), recover()]);
      assert.equal(first.attemptId, repeated.attemptId);
      assert.equal((await recover()).attemptId, first.attemptId, 'lost acceptance response reads back');
      assert.equal((await repository.latest(scope, 'root')).attemptId, first.attemptId);
      assert.equal((await sql`SELECT count(*)::int AS count FROM action_attempt`)[0].count, 2);
      assert.equal((await sql`SELECT status,error_code,terminal_reason FROM action_attempt
        WHERE attempt_id=${prior.actionAttemptId}`)[0].status, 'FAILED');
      assert.equal((await sql`SELECT generation_requests_json FROM translation_workspace`)[0]
        .generation_requests_json.includes('TG-known'), true);
      await sql`UPDATE action_attempt SET status='FAILED',error_code='HTTP_400'
        WHERE attempt_id=${first.attemptId}`;
      assert.equal((await recover()).attemptId, first.attemptId, 'failed successor cannot create a chain');
    } finally {
      await sql.end();
    }
  });
