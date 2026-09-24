import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import postgres from 'postgres';
process.env.TS_NODE_PROJECT = resolve('tsconfig.node.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
const { drizzle } = require('drizzle-orm/postgres-js');
const { createNoticeWindowReader } = require('../../server/modules/canonical-host/engineering-notice-window.ts');
const databaseUrl = process.env.CATALOGUE_BATCH_TEST_DATABASE_URL;

test('notice SQL preserves exact targets, revision ceilings, creators, JSON shape and ordering',
  { skip: !databaseUrl, timeout: 30000 }, async () => {
    const schema = `notice_window_${randomUUID().replaceAll('-', '')}`;
    const client = postgres(databaseUrl, { max: 1 });
    try {
      await client.unsafe(`CREATE SCHEMA "${schema}"`);
      {
        const tx = client;
        await tx.unsafe(`SET search_path TO "${schema}"`);
        await tx`CREATE TABLE action_attempt (attempt_id text, operation_ref text, status text,
          review_activity_json text, created_at integer, task_envelope_json text,
          tenant_id text, matter_id text, subject_kind text, action_type text)`;
        await tx`CREATE TABLE engineering_matter_work_revision (matter_work_revision_id text,
          tenant_id text, matter_id text, created_by_user_id text, working_revision integer)`;
        await tx`INSERT INTO engineering_matter_work_revision VALUES
          ('W1','T','M','owner',1), ('W2','T','M','owner',2), ('OTHER','T','M','other',1)`;
        const insert = async (id, time, modelInput, tenant = 'T', matter = 'M') => {
          await tx`INSERT INTO action_attempt VALUES (${id}, ${id}, 'FAILED', '[]', ${time},
            ${JSON.stringify({ modelInput })}, ${tenant}, ${matter}, 'ENGINEERING_MATTER', 'OPENCLAW_MATTER_ASSESSMENT')`;
        };
        const correction = ref => ({ correction: { kind: 'ENGINEERING_ISSUE_CORRECTION', expectedWorkRef: ref,
          issueKey: 'I', correctionReason: 'check' } });
        const overview = ref => ({ overviewCorrection: { kind: 'ENGINEERING_OVERVIEW_CORRECTION',
          expectedWorkRef: ref, correctionReason: 'check' } });
        await insert('new-overview', 4, overview('W2'));
        await insert('old-overview', 1, overview('W1'));
        await insert('bad-purpose', 2, { correction: { kind: 'ENGINEERING_ISSUE_CORRECTION', expectedWorkRef: 'W1' } });
        await insert('valid-correction', 3, correction('W2'));
        await insert('other-owner', 5, overview('OTHER'));
        await insert('wrong-tenant', 6, correction('W1'), 'OTHER');
        await insert('wrong-matter', 7, correction('W1'), 'T', 'OTHER');
        await insert('scalar-model-input', 8, 'broken');
        await insert('scalar-purpose', 9, { correction: 7 });
        const root = { tenantId: 'T', matterId: 'M', matterWorkRevisionId: 'W1', createdByUserId: 'owner', workingRevision: 1 };
        const read = createNoticeWindowReader(drizzle(tx));
        const [old, recent, otherOwner] = await Promise.all([read(root),
          read({ ...root, matterWorkRevisionId: 'W2', workingRevision: 2 }),
          read({ ...root, matterWorkRevisionId: 'OTHER', createdByUserId: 'other', workingRevision: 1 })]);
        const project = rows => rows.map(row => [row.id, row.isCorrection, row.isOverview]);
        assert.deepEqual(project(old), [['old-overview', null, true], ['bad-purpose', true, null]]);
        assert.deepEqual(project(recent), [['old-overview', null, true], ['valid-correction', true, null], ['new-overview', null, true]]);
        assert.deepEqual(project(otherOwner), [['other-owner', null, true]]);
        const empty = await createNoticeWindowReader(drizzle(tx))({ ...root, matterId: 'EMPTY' });
        assert.equal(empty.length, 0);
        await tx`DROP TABLE action_attempt`;
        const broken = createNoticeWindowReader(drizzle(tx));
        const outcomes = await Promise.allSettled([broken(root), broken(root)]);
        assert.equal(outcomes[0].status, 'rejected');
        assert.equal(outcomes[1].status, 'rejected');
        assert.equal(outcomes[0].reason, outcomes[1].reason);
      }
    } finally {
      await client.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
