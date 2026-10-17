import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../../tsconfig.node.json', import.meta.url));
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { CANONICAL_REGISTERED_MODELS } = require('../../server/modules/model-settings/canonical-model-catalog.ts');

// Exact pre-repair official CHECK expressions, without tenant/actor/business data.
const oldSubjectCheck = "CHECK (subject_kind::text = 'WORK_ITEM'::text AND work_item_id IS NOT NULL AND matter_id IS NULL AND matter_revision_id IS NULL AND (action_type::text <> ALL (ARRAY['OPENCLAW_MATTER_ASSESSMENT'::character varying::text, 'DOCUMENT_TRANSLATE'::character varying::text])) OR subject_kind::text = 'ENGINEERING_MATTER'::text AND work_item_id IS NULL AND document_version_id IS NULL AND matter_id IS NOT NULL AND matter_revision_id IS NOT NULL AND action_type::text = 'OPENCLAW_MATTER_ASSESSMENT'::text AND input_revision IS NOT NULL AND base_revision IS NOT NULL OR subject_kind::text = 'DOCUMENT_VERSION'::text AND work_item_id IS NULL AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NOT NULL AND producer_run_id IS NOT NULL AND input_revision IS NOT NULL AND input_revision > 0 AND action_type::text = 'DOCUMENT_TRANSLATE'::text AND (execution_model_json IS NULL OR jsonb_typeof(execution_model_json::jsonb) = 'object'::text AND jsonb_exists_all(execution_model_json::jsonb, ARRAY['modelRef'::text, 'displayName'::text, 'providerKind'::text, 'settingsRevision'::text, 'selectedAt'::text]) AND (execution_model_json::jsonb ->> 'modelRef'::text) = 'm3probe/minimax-m3'::text AND (execution_model_json::jsonb ->> 'providerKind'::text) = 'CUSTOM'::text AND jsonb_typeof(execution_model_json::jsonb -> 'displayName'::text) = 'string'::text AND (execution_model_json::jsonb ->> 'displayName'::text) <> ''::text AND jsonb_typeof(execution_model_json::jsonb -> 'settingsRevision'::text) = 'number'::text AND ((execution_model_json::jsonb ->> 'settingsRevision'::text)::numeric) >= 0::numeric AND jsonb_typeof(execution_model_json::jsonb -> 'selectedAt'::text) = 'string'::text) OR subject_kind::text = 'DERIVED_SUMMARY'::text AND work_item_id IS NULL AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NULL AND summary_id IS NOT NULL AND action_type::text = 'OPENCLAW_DERIVED_SUMMARY'::text AND input_revision IS NOT NULL AND base_revision IS NOT NULL)";
const identityCheck = "CHECK (subject_kind::text = 'DERIVED_SUMMARY'::text AND summary_id IS NOT NULL AND work_item_id IS NULL AND matter_id IS NULL AND matter_revision_id IS NULL AND document_version_id IS NULL AND action_type::text = 'OPENCLAW_DERIVED_SUMMARY'::text AND summary_request_command_json IS NOT NULL AND summary_delegated_principal_id IS NOT NULL OR subject_kind::text <> 'DERIVED_SUMMARY'::text AND summary_id IS NULL AND action_type::text <> 'OPENCLAW_DERIVED_SUMMARY'::text)";
const oldModelPair = "(execution_model_json::jsonb ->> 'modelRef'::text) = 'm3probe/minimax-m3'::text AND (execution_model_json::jsonb ->> 'providerKind'::text) = 'CUSTOM'::text";
const migration = await readFile(new URL(
  '../../migrations/0081_document_translation_registered_model_check.sql', import.meta.url), 'utf8');
const pairs = CANONICAL_REGISTERED_MODELS.filter(model => model.available)
  .map(({ modelRef, providerKind }) => [modelRef, providerKind]);
const pairSql = pairs.map(([ref, provider]) => "('" + ref + "'::text, '" + provider + "'::text)").join(', ');
const newModelPair = "(((execution_model_json::jsonb ->> 'modelRef'::text, " +
  "execution_model_json::jsonb ->> 'providerKind'::text) IN (" + pairSql + ")) IS TRUE)";
const expectedCheck = oldSubjectCheck.replace(oldModelPair, newModelPair);
const selection = (modelRef, providerKind) => ({ modelRef, providerKind,
  displayName: 'Constructed registered model', settingsRevision: 1, selectedAt: '2026-10-17T00:00:00.000Z' });
const glm = selection('miaoda/glm-5.3', 'BUILT_IN');
const legacySubjects = [
  ['WORK_ITEM', { subject_kind: 'WORK_ITEM', work_item_id: 'WI-fixture',
    action_type: 'OPENCLAW_DYNAMIC_EVALUATION', producer_run_id: null,
    input_revision: null, base_revision: null }],
  ['ENGINEERING_MATTER', { subject_kind: 'ENGINEERING_MATTER', document_version_id: null,
    matter_id: 'MAT-fixture', matter_revision_id: 'MREV-fixture',
    action_type: 'OPENCLAW_MATTER_ASSESSMENT', input_revision: 1, base_revision: 1,
    producer_run_id: null }],
  ['DERIVED_SUMMARY', { subject_kind: 'DERIVED_SUMMARY', document_version_id: null,
    producer_run_id: null, summary_id: 'DS-fixture', action_type: 'OPENCLAW_DERIVED_SUMMARY',
    input_revision: 1, base_revision: 1, summary_request_command_json: '{}',
    summary_delegated_principal_id: 'service-fixture' }],
];

test('0081 widens only document translation registered model pairs in an owned local PostgreSQL database',
  { timeout: 60000 }, async t => {
    assert.equal(pairs.length, 7);
    assert.equal(oldSubjectCheck.split(oldModelPair).length, 2);
    assert.equal((migration.match(/ALTER TABLE action_attempt/gu) ?? []).length, 1);
    assert.equal((migration.match(/DROP CONSTRAINT ck_action_attempt_summary_subject/gu) ?? []).length, 1);
    assert.equal((migration.match(/ADD CONSTRAINT ck_action_attempt_summary_subject/gu) ?? []).length, 1);
    assert.ok(migration.includes('ADD CONSTRAINT ck_action_attempt_summary_subject ' + expectedCheck + ';'));
    assert.doesNotMatch(migration, /\b(?:GRANT|REVOKE|POLICY|FUNCTION|INSERT|UPDATE|DELETE)\b/u);
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    // This helper accepts no external URL/.env: it starts and verifies its own
    // 127.0.0.1 server, data directory and randomly named temporary database.
    const owned = await startOwnedPostgres(capability).catch(error => {
      t.diagnostic(JSON.stringify({ stage: 'owned-local-pg-start',
        exitCode: error.exitCode ?? null, diagnostic: error.diagnostic ?? null }));
      throw error;
    });
    let sequence = 0;
    const db = owned.admin;
    const insert = async (overrides = {}) => {
      sequence++;
      const row = {
        id: 'row-' + sequence, subject_kind: 'DOCUMENT_VERSION', work_item_id: null,
        matter_id: null, matter_revision_id: null, document_version_id: 'DV-fixture',
        producer_run_id: 'PRUN-fixture', input_revision: 1, base_revision: null,
        action_type: 'DOCUMENT_TRANSLATE', execution_model_json: null, summary_id: null,
        summary_request_command_json: null, summary_delegated_principal_id: null,
        ...overrides,
      };
      const columns = Object.keys(row);
      return db.unsafe('INSERT INTO action_attempt (' + columns.join(',') + ') VALUES (' +
        columns.map((_column, index) => '$' + (index + 1)).join(',') + ')', Object.values(row));
    };
    const rejectsCheck = (overrides, label, codes = ['23514']) =>
      assert.rejects(insert(overrides), error => codes.includes(error.code), label);
    const catalogState = async () => ({
      checks: Array.from(await db.unsafe("SELECT conname,oid::text AS oid,pg_get_constraintdef(oid) AS definition " +
        "FROM pg_constraint WHERE conrelid='action_attempt'::regclass ORDER BY conname"), row => ({ ...row })),
      policies: Array.from(await db.unsafe("SELECT polname,polcmd,polpermissive,polroles::text AS roles," +
        "pg_get_expr(polqual,polrelid) AS using_expression,pg_get_expr(polwithcheck,polrelid) AS check_expression " +
        "FROM pg_policy WHERE polrelid='action_attempt'::regclass ORDER BY polname"), row => ({ ...row })),
    });
    try {
      await db.unsafe('CREATE TABLE action_attempt (' +
        'id text,subject_kind text NOT NULL,work_item_id text,matter_id text,matter_revision_id text,' +
        'document_version_id text,producer_run_id text,input_revision integer,base_revision integer,' +
        'action_type text,execution_model_json text,summary_id text,' +
        'summary_request_command_json text,summary_delegated_principal_id text,' +
        'CONSTRAINT ck_action_attempt_summary_subject ' + oldSubjectCheck + ',' +
        'CONSTRAINT ck_action_attempt_summary_identity ' + identityCheck + ')');
      await t.test('RED: the actual old CHECK rejects the failed GLM/BUILT_IN admission', async () => {
        await assert.rejects(insert({ execution_model_json: JSON.stringify(glm) }),
          error => error.code === '23514' && error.constraint_name === 'ck_action_attempt_summary_subject');
        t.diagnostic('Old official CHECK rejected GLM with SQLSTATE 23514; no production database was used.');
      });
      await t.test('old official NULL producer and the three existing subjects remain valid', async () => {
        await insert();
        for (const [_kind, subject] of legacySubjects) await insert(subject);
      });
      const before = await catalogState();
      const existingRows = await db.unsafe('SELECT row_to_json(a)::text AS row FROM action_attempt a ORDER BY id');
      await t.test('the exact transactional migration replaces only the named CHECK', async () => {
        await db.unsafe(migration);
        const after = await catalogState();
        assert.equal(before.checks.length, 2);
        assert.equal(after.checks.length, 2);
        const oldIdentity = before.checks.find(row => row.conname === 'ck_action_attempt_summary_identity');
        assert.deepEqual(after.checks.find(row => row.conname === oldIdentity.conname), oldIdentity);
        assert.notEqual(after.checks.find(row => row.conname === 'ck_action_attempt_summary_subject').oid,
          before.checks.find(row => row.conname === 'ck_action_attempt_summary_subject').oid);
        assert.deepEqual(after.policies, before.policies);
        assert.deepEqual(Array.from(await db.unsafe(
          'SELECT row_to_json(a)::text AS row FROM action_attempt a ORDER BY id'), row => row.row),
        Array.from(existingRows, row => row.row));
      });
      for (const [modelRef, providerKind] of pairs)
        await t.test('GREEN registered exact pair: ' + modelRef + '/' + providerKind, async () => {
          await insert({ execution_model_json: JSON.stringify(selection(modelRef, providerKind)) });
        });
      await t.test('every registered ref rejects the other provider and an unknown ref stays rejected', async () => {
        for (const [modelRef, providerKind] of pairs)
          await rejectsCheck({ execution_model_json: JSON.stringify(
            selection(modelRef, providerKind === 'CUSTOM' ? 'BUILT_IN' : 'CUSTOM')) }, modelRef);
        await rejectsCheck({ execution_model_json: JSON.stringify(selection('unregistered/model', 'BUILT_IN')) }, 'unknown');
        await rejectsCheck({ execution_model_json: JSON.stringify(selection('MIAODA/glm-5.3', 'BUILT_IN')) }, 'case drift');
      });
      await t.test('SQL NULL remains official; JSON null, missing identity and malformed snapshots are rejected', async () => {
        await insert();
        const missing = key => Object.fromEntries(Object.entries(glm).filter(([name]) => name !== key));
        const snapshots = [null, [], 'not-an-object', 17, true,
          ...Object.keys(glm).map(missing),
          { ...glm, modelRef: null }, { ...glm, providerKind: null },
          { ...glm, modelRef: null, providerKind: null },
          { ...glm, modelRef: 42 }, { ...glm, providerKind: false },
          { ...glm, displayName: '' }, { ...glm, displayName: null }, { ...glm, displayName: 42 },
          { ...glm, settingsRevision: -1 }, { ...glm, settingsRevision: '1' },
          { ...glm, settingsRevision: null }, { ...glm, selectedAt: null }, { ...glm, selectedAt: 42 }];
        for (const [index, snapshot] of snapshots.entries())
          await rejectsCheck({ execution_model_json: JSON.stringify(snapshot) }, 'snapshot ' + index,
            ['23514', '22P02']);
        await rejectsCheck({ execution_model_json: '{invalid-json' }, 'invalid JSON', ['22P02']);
      });
      await t.test('document subject boundaries remain closed for every model pair', async () => {
        for (const [modelRef, providerKind] of pairs) {
          const model = JSON.stringify(selection(modelRef, providerKind));
          for (const broken of [
            { work_item_id: 'WI-wrong-subject' }, { matter_id: 'MAT-wrong-subject' },
            { matter_revision_id: 'MREV-wrong-subject' }, { summary_id: 'DS-wrong-subject' },
            { document_version_id: null }, { producer_run_id: null },
            { input_revision: null }, { input_revision: 0 }, { action_type: 'OPENCLAW_DYNAMIC_EVALUATION' },
          ]) await rejectsCheck({ execution_model_json: model, ...broken }, JSON.stringify(broken));
        }
      });
      await t.test('legacy valid subjects and their invalid variants retain both original CHECK boundaries', async () => {
        for (const [_kind, subject] of legacySubjects) await insert(subject);
        const work = legacySubjects[0][1], matter = legacySubjects[1][1], summary = legacySubjects[2][1];
        for (const broken of [
          { ...work, work_item_id: null }, { ...work, matter_id: 'MAT' },
          { ...work, action_type: 'DOCUMENT_TRANSLATE' }, { ...work, summary_id: 'DS' },
          { ...matter, document_version_id: 'DV' }, { ...matter, matter_revision_id: null },
          { ...matter, base_revision: null }, { ...matter, action_type: 'DOCUMENT_TRANSLATE' },
          { ...summary, document_version_id: 'DV' }, { ...summary, work_item_id: 'WI' },
          { ...summary, summary_id: null }, { ...summary, summary_request_command_json: null },
          { ...summary, summary_delegated_principal_id: null }, { ...summary, input_revision: null },
          { subject_kind: 'UNKNOWN_SUBJECT' },
        ]) await rejectsCheck(broken, 'legacy invalid subject');
      });
      t.diagnostic('The subject and identity CHECKs were loaded; the remaining 12 constraints and 30 policies were not recreated or behaviorally tested. Official metadata scope is verified separately.');
    } finally {
      await owned.stop();
    }
  });
