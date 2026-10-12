import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const postgres = require('postgres');
const databaseUrl = process.env.DOCUMENT_ACTIVITY_TEST_DATABASE_URL;
const template = await readFile(new URL('../../server/database/derived-summary.ddl.sql', import.meta.url), 'utf8');
const marker = "AND a.result_json->'producer'=CASE";
const first = template.indexOf(marker), last = template.indexOf(' END))', first);
assert.ok(first >= 0 && last > first);
const equality = template.slice(first + 4, last + 4);
const actual = { skillVersion: 'synthetic-source-skill', modelVersion: 'provider-reported-model' };
const pin = { modelRef: 'miaoda/glm-5.3', displayName: 'GLM5.3', providerKind: 'BUILT_IN',
  settingsRevision: 1, selectedAt: '2026-10-12T00:00:00.000Z' };

test('derived source actual-producer equality with frozen control metadata (local PostgreSQL expression only)',
  { skip: !databaseUrl }, async () => {
    const target = new URL(databaseUrl);
    assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
    assert.match(target.pathname, /^\/wiselink_activity_test(?:_[a-z0-9_]+)?$/u);
    const socket = target.searchParams.get('host');
    if (socket !== null) {
      assert.match(socket, /^\/private\/tmp\/c220-producer-projection-pg-verified-[a-z0-9_]+\/socket$/u);
      target.searchParams.delete('host');
    }
    const sql = postgres(target.href, { max: 1, ...(socket === null ? {} : { host: socket }), onnotice() {} });
    try {
      for (const [name, stored, matches] of [
        ['historical actual pair', actual, true],
        ['actual pair plus frozen control', { ...actual, executionModel: pin }, true],
        ['unknown extra key remains rejected', { ...actual, executionModel: pin, forged: 'not-allowed' }, false],
        ['actual model mismatch remains rejected', { ...actual, executionModel: pin, modelVersion: 'forged-model' }, false],
        ['missing actual skill remains rejected', { modelVersion: actual.modelVersion, executionModel: pin }, false],
        ['JSON null is non-match without scalar operator failure', null, false],
        ['scalar is non-match without scalar operator failure', 'not-an-object', false],
        ['array is non-match', [actual], false],
      ]) {
        const rows = await sql.unsafe(`SELECT (${equality}) IS TRUE AS matched
          FROM (VALUES ($1::jsonb,$2::jsonb)) a(result_json,producer_json)`,
        [sql.json({ producer: actual }), sql.json(stored)]);
        assert.equal(rows[0].matched, matches, name);
      }
    } finally { await sql.end(); }
  });
