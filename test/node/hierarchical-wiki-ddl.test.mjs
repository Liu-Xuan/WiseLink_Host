import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { prepareHierarchicalWikiDdl } from '../../scripts/prepare-hierarchical-wiki-ddl.mjs';

const template = await readFile(
  new URL('../../migrations/0077_hierarchical_wiki.sql', import.meta.url),
  'utf8',
);
const snapshot = (schema) => ({
  ok: true,
  data: [{ schema_probe: { schema, constraints: [], policies: [] } }],
});
const prepare = (schema) =>
  prepareHierarchicalWikiDdl({
    template,
    devSnapshot: snapshot(schema),
    onlineSnapshot: snapshot(schema),
  });

test('official schema prep emits one exact SDK SQL role per policy and top-level service grants', () => {
  const output = prepare('app_wiki');
  const policies = output.match(/CREATE POLICY[^;]+;/gu);
  assert.ok(policies.length > 15);
  for (const policy of policies) {
    assert.match(
      policy,
      /TO "(?:authenticated|service_role|anon)_app_wiki"\s/u,
    );
    assert.doesNotMatch(
      policy,
      /TO PUBLIC|TO authenticated[,\s]|TO service_role[,\s]|TO anon[,\s]/u,
    );
  }
  assert.equal(
    (output.match(/GRANT EXECUTE ON FUNCTION hierarchical_wiki_/gu) ?? [])
      .length,
    3,
  );
  assert.doesNotMatch(output, /WIKI_DDL_PREPARE_REQUIRED/u);
  assert.match(output, /polroles IS DISTINCT FROM ARRAY\[r.oid\]/u);
});

test('function bodies and commit cancellation cutoff stay exact; preparation mutates no SQL inside DO', () => {
  const output = prepare('public');
  for (const body of template.match(/AS \$\$[\s\S]*?\$\$;/gu))
    assert.ok(output.includes(body));
  for (const body of output.match(/DO \$[a-z_]+\$[\s\S]*?\$[a-z_]+\$;/gu))
    assert.doesNotMatch(
      body,
      /\b(?:CREATE|ALTER|GRANT|INSERT|UPDATE|DELETE)\b/u,
    );
  assert.match(
    output,
    /a.status='COMMITTING' OR a.commit_started_at IS NOT NULL/u,
  );
  assert.match(output, /cancel_result:='TOO_LATE'/u);
});

test('missing official envelopes, cross-schema snapshots, or unknown policy roles fail visibly', () => {
  assert.throws(
    () =>
      prepareHierarchicalWikiDdl({
        template,
        devSnapshot: {},
        onlineSnapshot: snapshot('public'),
      }),
    /OFFICIAL_SCHEMA_SNAPSHOT_REQUIRED/u,
  );
  assert.throws(
    () =>
      prepareHierarchicalWikiDdl({
        template,
        devSnapshot: snapshot('dev'),
        onlineSnapshot: snapshot('online'),
      }),
    /WIKI_DDL_SCOPE_MISMATCH/u,
  );
  assert.throws(
    () =>
      prepareHierarchicalWikiDdl({
        template: template.replace(
          'TO authenticated,service_role,anon',
          'TO PUBLIC',
        ),
        devSnapshot: snapshot('public'),
        onlineSnapshot: snapshot('public'),
      }),
    /WIKI_DDL_POLICY_INVALID/u,
  );
});
