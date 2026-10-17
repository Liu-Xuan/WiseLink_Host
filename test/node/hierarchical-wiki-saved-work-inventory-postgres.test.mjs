import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
const { PgDialect } = require('drizzle-orm/pg-core');
const {
  HierarchicalWikiService,
} = require('../../server/modules/canonical-host/hierarchical-wiki.service.ts');
const {
  emptyWikiDemand,
} = require('../../server/modules/canonical-host/hierarchical-wiki-demand.ts');
const {
  readWikiInventory,
} = require('../../server/modules/canonical-host/hierarchical-wiki-inventory.ts');
const owner = {
  tenantId: 'local-wiki-tenant',
  actorUserId: 'local-wiki-owner',
};
const target = { fleetFamilyId: 'B747', fleetModelId: '747-8' };

/** Uses the existing owned loopback cluster, with only synthetic columns/rows
 * needed to execute the actual inventory SQL. Tests SQL/currentness/filtering;
 * it does not replace full migration/RLS/exact-body runtime acceptance. */
test(
  'owned PG executes saved-WI inventory SQL with latest, owner, source, classification and cleanup boundaries',
  { timeout: 60000 },
  async (t) => {
    const capability = await postgresCapability();
    assert.equal(capability.available, true, capability.reason);
    const cluster = await startOwnedPostgres(capability);
    try {
      const sql = cluster.admin;
      const run = (statement, parameters = []) =>
        sql.unsafe(statement, parameters);
      await run(
        'CREATE TABLE dm_publication_family(family_id text PRIMARY KEY,current_document_version_id text);' +
          'CREATE TABLE dm_document_version(document_version_id text PRIMARY KEY,family_id text,pdf_sha256 text,byte_length bigint,source_artifact_id text);' +
          'CREATE TABLE work_item(work_item_id text PRIMARY KEY,tenant_id text,requested_by_user_id text,document_version_id text,source_artifact_id text,source_file_sha256 text,source_byte_length bigint,allowed boolean DEFAULT true);' +
          'CREATE TABLE assessment_work_revision(tenant_id text,work_item_id text,assessment_work_revision_id text,work_revision integer,document_version_id text,created_by_user_id text,request_id text,action_attempt_id text,content_json text);' +
          'CREATE TABLE action_attempt(attempt_id text,tenant_id text,work_item_id text,document_version_id text,actor_user_id text,subject_kind text,action_type text,status text);' +
          'CREATE TABLE hierarchical_wiki_scope(wiki_id text,tenant_id text,actor_user_id text,scope_json jsonb,state_json jsonb DEFAULT \'{"waiting":[]}\');' +
          'CREATE TABLE hierarchical_wiki_membership(wiki_id text,tenant_id text,actor_user_id text,member_key text,source_kind text,source_id text,member_json jsonb,basis_json jsonb);' +
          'CREATE TABLE dm_document_version_metadata(document_version_id text,metadata_revision integer,extracted_metadata jsonb);' +
          'CREATE TABLE dm_document_reading_run(tenant_id text,document_version_id text,run_ref text,parse_run_id text,semantic_revision integer,reading_revision integer,status text);' +
          'CREATE TABLE dm_document_parse_run(tenant_id text,document_version_id text,parse_run_id text,parse_revision integer,status text);' +
          'CREATE TABLE dm_document_semantic_revision(tenant_id text,document_version_id text,parse_run_id text,semantic_revision integer);' +
          'CREATE TABLE dm_document_reading_retraction(tenant_id text,run_ref text);' +
          'CREATE TABLE engineering_matter(tenant_id text,matter_id text,default_family_id text,current_matter_revision_id text);' +
          'CREATE TABLE engineering_matter_work_revision(tenant_id text,matter_id text,matter_work_revision_id text,based_on_matter_revision_id text,working_revision integer,state_json text,created_by_user_id text);' +
          'CREATE TABLE engineering_matter_material_link(matter_revision_id text,document_version_id text,family_id text,material_json text);' +
          'CREATE TABLE engineering_matter_revision_work_item(matter_revision_id text,work_item_id text);' +
          "CREATE FUNCTION engineering_matter_work_item_owned_by_actor(t text,w text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM work_item WHERE tenant_id=t AND work_item_id=w AND requested_by_user_id=current_setting('app.user_id',true) AND allowed) $$;" +
          "CREATE FUNCTION engineering_matter_document_owned_by_actor(t text,d text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM work_item WHERE tenant_id=t AND document_version_id=d AND requested_by_user_id=current_setting('app.user_id',true) AND allowed) $$;" +
          'CREATE FUNCTION engineering_matter_owned_by_actor(t text,m text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;',
      );
      await run("SELECT set_config('app.user_id',$1,false)", [
        owner.actorUserId,
      ]);
      const hash = 'a'.repeat(64);
      for (const [family, dvi] of [
        ['F-selected', 'DV-current'],
        ['F-unrelated', 'DV-unrelated'],
      ]) {
        await run('INSERT INTO dm_publication_family VALUES($1,$2)', [
          family,
          dvi,
        ]);
        await run(
          "INSERT INTO dm_document_version VALUES($1,$2,$3,100,'SRC-synthetic')",
          [dvi, family, hash],
        );
      }
      await run(
        "INSERT INTO dm_document_version VALUES('DV-old','F-selected',$1,100,'SRC-synthetic')",
        [hash],
      );
      for (const ata of ['31-00', '34-00']) {
        const wiki = 'wiki-' + ata;
        const scope = {
          ...target,
          kind: 'ATA4',
          fleetModelIds: [target.fleetModelId],
          ata4: ata,
        };
        await run(
          'INSERT INTO hierarchical_wiki_scope VALUES($1,$2,$3,$4::jsonb)',
          [wiki, owner.tenantId, owner.actorUserId, sql.json(scope)],
        );
        await run(
          "INSERT INTO hierarchical_wiki_membership VALUES($1,$2,$3,'DOCUMENT_FAMILY:F-selected','DOCUMENT','F-selected','{}',$4::jsonb)",
          [
            wiki,
            owner.tenantId,
            owner.actorUserId,
            sql.json({
              kind: 'USER_WIKI_CLASSIFICATION',
              documentVersionId: 'DV-current',
              classificationStatus: 'CONFIRMED',
            }),
          ],
        );
      }
      const [shape] = await run(
        'SELECT jsonb_typeof(s.scope_json) AS scope,jsonb_typeof(m.basis_json) AS basis FROM hierarchical_wiki_scope s JOIN hierarchical_wiki_membership m USING(wiki_id) LIMIT 1',
      );
      assert.deepEqual(
        { scope: shape.scope, basis: shape.basis },
        { scope: 'object', basis: 'object' },
      );
      async function work(id, options = {}) {
        const dvi = options.dvi ?? 'DV-current',
          tenant = options.tenant ?? owner.tenantId;
        await run(
          "INSERT INTO work_item VALUES($1,$2,$3,$4,'SRC-synthetic',$5,100,$6)",
          [
            id,
            tenant,
            options.actor ?? owner.actorUserId,
            dvi,
            options.hash ?? hash,
            options.allowed ?? true,
          ],
        );
        await revision(id, 1, { ...options, dvi, tenant });
      }
      async function revision(id, number, options = {}) {
        const ref = id + '-JAWR-' + number,
          attempt = ref + '-ATT';
        const dvi = options.dvi ?? 'DV-current',
          tenant = options.tenant ?? owner.tenantId;
        const content = {
          roundCompletion: options.completion ?? 'COMPLETE_WITH_OPEN_QUESTIONS',
          understanding:
            options.understanding ??
            'Exact saved understanding with open configuration/reference gaps.',
          overviewStatus: options.overviewStatus ?? 'STALE',
          issues: [],
          evidence: [],
        };
        await run(
          "INSERT INTO action_attempt VALUES($1,$2,$3,$4,$5,'WORK_ITEM',$6,$7)",
          [
            attempt,
            tenant,
            id,
            dvi,
            options.attemptActor ?? 'service:openclaw-main',
            options.actionType ?? 'OPENCLAW_DYNAMIC_EVALUATION',
            options.status ?? 'SUCCEEDED',
          ],
        );
        await run(
          'INSERT INTO assessment_work_revision VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            tenant,
            id,
            ref,
            number,
            options.savedDvi ?? dvi,
            options.creator ?? options.actor ?? owner.actorUserId,
            ref + '-REQ',
            attempt,
            JSON.stringify(content),
          ],
        );
        return ref;
      }
      await work('WI-ordinary');
      await work('WI-review', {
        attemptActor: owner.actorUserId,
        actionType: 'OPENCLAW_INTERACTIVE_REVIEW',
      });
      await work('WI-partial');
      await revision('WI-partial', 2, { completion: 'IN_PROGRESS' });
      await work('WI-failed', { status: 'FAILED' });
      await work('WI-blank', { understanding: '   ' });
      await work('WI-placeholder', {
        understanding: '问题正文已保存；综合认识尚未形成。',
        overviewStatus: 'NOT_AVAILABLE',
      });
      await work('WI-wrong-creator', { creator: 'another-actor' });
      await work('WI-wrong-actor', { actor: 'another-actor' });
      await work('WI-wrong-tenant', { tenant: 'another-tenant' });
      await work('WI-wrong-save-DVI', { savedDvi: 'DV-old' });
      await work('WI-old-DVI', { dvi: 'DV-old' });
      await work('WI-stale-source', { hash: 'b'.repeat(64) });
      await work('WI-unrelated', { dvi: 'DV-unrelated' });
      // Drizzle installs transparent JSON serializers on its client. Keep the
      // fixture seeder's native sql.json encoder on the separate admin client.
      const application = await cluster.connect();
      await application.unsafe("SELECT set_config('app.user_id',$1,false)", [
        owner.actorUserId,
      ]);
      const database = drizzle(application);
      const read = () =>
        readWikiInventory(
          database,
          owner,
          target,
          [{ kind: 'WORK_ITEM', subjectId: 'WI-ordinary' }],
          null,
          {
            authorizeRuntimeInputs: async () => {
              throw new Error('Unexpected Matter branch');
            },
          },
        );
      const leaves = (result) =>
        result.items.filter((item) => item.sourceKind === 'WORK_ITEM');

      await t.test('normal refresh discovers missing or changed WI heads using one bounded metadata query', async () => {
        const dialect = new PgDialect();
        const root = {
          wikiId: 'WIKI-root', summaryId: 'DS-root', ...owner,
          scope: { kind: 'FLEET', fleetFamilyId: target.fleetFamilyId,
            fleetModelIds: [target.fleetModelId] },
          enabled: true, parentWikiId: null, state: emptyWikiDemand(),
          lastEventSeq: '9', lastInventoryAt: new Date().toISOString(), inventoryCursor: null,
        };
        async function discover() {
          let rows;
          const completed = new Error('TEST_DISCOVERY_QUERY_COMPLETED');
          const service = Object.create(HierarchicalWikiService.prototype);
          const discoveryDatabase = {
            execute: async statement => {
              const query = dialect.sqlToQuery(statement);
              if (query.sql.includes("SELECT DISTINCT 'WORK_ITEM' AS kind")) {
                assert.ok(!query.sql.includes('content_json'));
                rows = await database.execute(statement);
                // Stop before inventory/mutation. This is the actual SELECT
                // emitted by refresh, executed on this owned synthetic PG.
                throw completed;
              }
              if (query.sql.includes('FROM hierarchical_wiki_scope') &&
                  !query.sql.includes('FROM hierarchical_wiki_membership')) return [structuredClone(root)];
              return [];
            },
          };
          await assert.rejects(service.refresh(discoveryDatabase, owner, new Date().toISOString()),
            error => error === completed);
          return rows;
        }
        const initial = await discover();
        const ids = initial.map(row => row.subjectId);
        assert.equal(ids.filter(id => id === 'WI-ordinary').length, 1);
        assert.ok(ids.includes('WI-review'));
        // Latest partial/NOT_AVAILABLE heads are forwarded to the original
        // inventory, never replaced by a previous complete body here.
        assert.ok(ids.includes('WI-partial'));
        assert.ok(ids.includes('WI-placeholder'));
        for (const id of ['WI-wrong-actor', 'WI-wrong-tenant', 'WI-old-DVI', 'WI-stale-source', 'WI-unrelated'])
          assert.ok(!ids.includes(id), id);
        try {
          for (const ata of ['31-00', '34-00']) await run(
            "INSERT INTO hierarchical_wiki_membership VALUES($1,$2,$3,'WORK_ITEM:WI-ordinary','WORK_ITEM','WI-ordinary',$4::jsonb,$5::jsonb)",
            ['wiki-' + ata, owner.tenantId, owner.actorUserId,
              sql.json({ kind: 'WORK_ITEM_WORK', workItemId: 'WI-ordinary', documentVersionId: 'DV-current',
                workRef: 'WI-ordinary-JAWR-1', workRevision: 1 }),
              sql.json({ classificationStatus: 'CONFIRMED' })],
          );
          assert.ok(!(await discover()).some(row => row.subjectId === 'WI-ordinary'));
          await revision('WI-ordinary', 2, { completion: 'IN_PROGRESS' });
          assert.ok((await discover()).some(row => row.subjectId === 'WI-ordinary'));
          assert.ok(!leaves(await read()).some(row => row.sourceId === 'WI-ordinary'));
          await run("UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(basis_json,'{classificationStatus}','\"CANDIDATE\"') WHERE source_kind='DOCUMENT'");
          assert.equal((await discover()).length, 0);
          await run("UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(basis_json,'{classificationStatus}','\"CONFIRMED\"') WHERE source_kind='DOCUMENT'");
          await run("UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(basis_json,'{documentVersionId}','\"DV-old\"') WHERE source_kind='DOCUMENT'");
          assert.equal((await discover()).length, 0);
        } finally {
          await run("DELETE FROM hierarchical_wiki_membership WHERE member_key='WORK_ITEM:WI-ordinary'");
          await run("DELETE FROM assessment_work_revision WHERE work_item_id='WI-ordinary' AND work_revision=2");
          await run("DELETE FROM action_attempt WHERE attempt_id='WI-ordinary-JAWR-2-ATT'");
          await run("UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(jsonb_set(basis_json,'{documentVersionId}','\"DV-current\"'),'{classificationStatus}','\"CONFIRMED\"') WHERE source_kind='DOCUMENT'");
        }
        try {
          for (let index = 0; index <= 100; index++) {
            const key = String(index).padStart(3, '0');
            const family = 'F-fair-' + key, dvi = 'DV-fair-' + key;
            await run('INSERT INTO dm_publication_family VALUES($1,$2)', [family, dvi]);
            await run("INSERT INTO dm_document_version VALUES($1,$2,$3,100,'SRC-synthetic')", [dvi, family, hash]);
            await run("INSERT INTO hierarchical_wiki_membership VALUES('wiki-31-00',$1,$2,$3,'DOCUMENT',$4,'{}',$5::jsonb)",
              [owner.tenantId, owner.actorUserId, 'DOCUMENT_FAMILY:' + family, family,
                sql.json({ kind: 'USER_WIKI_CLASSIFICATION', documentVersionId: dvi, classificationStatus: 'CONFIRMED' })]);
            await work('WI-' + key + '-fair', { dvi,
              completion: index < 100 ? 'IN_PROGRESS' : 'COMPLETE_WITH_OPEN_QUESTIONS',
              overviewStatus: index < 100 ? 'NOT_AVAILABLE' : 'CURRENT' });
          }
          const first = await discover();
          assert.equal(first.length, 100);
          assert.ok(!first.some(row => row.subjectId === 'WI-100-fair'));
          const firstInventory = await readWikiInventory(database, owner, target, first, null,
            { authorizeRuntimeInputs: async () => assert.fail('no Matter inputs') });
          const waiting = firstInventory.waiting
            .filter(row => row.status === 'SAVED_ASSESSMENT_NOT_READY')
            .map(({ ata: _ata, ...row }) => row);
          assert.equal(waiting.length, 100);
          await run("UPDATE hierarchical_wiki_scope SET state_json=jsonb_build_object('waiting',$1::jsonb) WHERE wiki_id='wiki-31-00'", [sql.json(waiting)]);
          const next = await discover();
          assert.ok(next.some(row => row.subjectId === 'WI-100-fair'),
            '100 already-waiting partial heads must not starve the 101st complete head');
          const nextInventory = await readWikiInventory(database, owner, target, next, null,
            { authorizeRuntimeInputs: async () => assert.fail('no Matter inputs') });
          assert.ok(leaves(nextInventory).some(row => row.sourceId === 'WI-100-fair'));
          // The existing family waiting refresh sees a new complete revision
          // without requiring the missing-WI head detector to select it again.
          await revision('WI-000-fair', 2, { dvi: 'DV-fair-000' });
          const viaWaiting = await readWikiInventory(database, owner, target,
            waiting.map(row => ({ kind: 'DOCUMENT', subjectId: row.documentVersionId })),
            null, { authorizeRuntimeInputs: async () => assert.fail('no Matter inputs') });
          assert.ok(leaves(viaWaiting).some(row => row.sourceId === 'WI-000-fair' && row.member.workRevision === 2));
        } finally {
          await run("DELETE FROM hierarchical_wiki_membership WHERE source_id LIKE 'F-fair-%'");
          await run("DELETE FROM assessment_work_revision WHERE work_item_id LIKE 'WI-%-fair'");
          await run("DELETE FROM action_attempt WHERE work_item_id LIKE 'WI-%-fair'");
          await run("DELETE FROM work_item WHERE work_item_id LIKE 'WI-%-fair'");
          await run("DELETE FROM dm_document_version WHERE family_id LIKE 'F-fair-%'");
          await run("DELETE FROM dm_publication_family WHERE family_id LIKE 'F-fair-%'");
          await run("UPDATE hierarchical_wiki_scope SET state_json='{\"waiting\":[]}'");
        }
      });

      await t.test(
        'normal service-actor and Review saves enter as separate exact leaves, without another DocumentReading',
        async () => {
          const result = await read();
          assert.deepEqual(
            leaves(result).map((item) => [item.sourceId, item.ata]),
            [
              ['WI-ordinary', '31-00'],
              ['WI-ordinary', '34-00'],
              ['WI-review', '31-00'],
              ['WI-review', '34-00'],
            ],
          );
          assert.ok(
            leaves(result).every(
              (item) =>
                item.member.kind === 'WORK_ITEM_WORK' &&
                item.member.workRevision === 1,
            ),
          );
          assert.ok(
            result.items.some(
              (item) =>
                item.memberKey === 'DOCUMENT_FAMILY:F-selected' &&
                item.member === null,
            ),
          );
          assert.ok(
            result.waiting.some(
              (item) => item.status === 'SAVED_ASSESSMENT_NOT_READY',
            ),
          );
          assert.ok(!result.removed.some((item) => item.id === 'WI-unrelated'));
          const [old] = await run(
            "SELECT count(*)::int AS n FROM assessment_work_revision WHERE work_item_id='WI-partial'",
          );
          assert.equal(old.n, 2);
        },
      );

      await t.test(
        'later successful complete revision replaces partial current and original history remains immutable',
        async () => {
          const ref = await revision('WI-partial', 3);
          const result = await read();
          assert.deepEqual(
            leaves(result)
              .filter((item) => item.sourceId === 'WI-partial')
              .map((item) => item.member.workRef),
            [ref, ref],
          );
          assert.ok(
            !result.waiting.some((item) => item.requestId === ref + '-REQ'),
          );
          const [history] = await run(
            "SELECT content_json::jsonb->>'roundCompletion' AS completion FROM assessment_work_revision WHERE work_item_id='WI-partial' AND work_revision=2",
          );
          assert.equal(history.completion, 'IN_PROGRESS');
        },
      );

      await t.test(
        'explicit exclusion removes that ATA4 assessment without promoting candidate metadata',
        async () => {
          await run(
            "UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(basis_json,'{classificationStatus}','\"EXCLUDED\"') WHERE wiki_id='wiki-34-00' AND source_kind='DOCUMENT'",
          );
          assert.deepEqual(
            leaves(await read()).map((item) => [item.sourceId, item.ata]),
            [
              ['WI-ordinary', '31-00'],
              ['WI-partial', '31-00'],
              ['WI-review', '31-00'],
            ],
          );
        },
      );

      await t.test(
        'new current DVI waits for its exact binding, then cleanup removes old, revoked and deleted WI members only',
        async () => {
          await work('WI-revoked', { allowed: false });
          for (const id of ['WI-ordinary', 'WI-revoked', 'WI-deleted']) {
            await run(
              "INSERT INTO hierarchical_wiki_membership VALUES('wiki-31-00',$1,$2,$3,'WORK_ITEM',$4,'{}',$5::jsonb)",
              [
                owner.tenantId,
                owner.actorUserId,
                'WORK_ITEM:' + id,
                id,
                sql.json({
                  familyId: 'F-selected',
                  documentVersionId: 'DV-current',
                  classificationStatus: 'CONFIRMED',
                }),
              ],
            );
          }
          await run(
            "INSERT INTO dm_document_version VALUES('DV-new','F-selected',$1,100,'SRC-synthetic')",
            [hash],
          );
          await run(
            "UPDATE dm_publication_family SET current_document_version_id='DV-new' WHERE family_id='F-selected'",
          );
          await work('WI-new', { dvi: 'DV-new' });
          const transition = await read();
          assert.equal(leaves(transition).length, 0);
          assert.ok(
            transition.waiting.some(
              (item) =>
                item.status === 'ASSESSMENT_CLASSIFICATION_PENDING' &&
                item.documentVersionId === 'DV-new',
            ),
          );
          for (const id of ['WI-ordinary', 'WI-revoked', 'WI-deleted'])
            assert.ok(
              transition.removed.some(
                (item) => item.kind === 'WORK_ITEM' && item.id === id,
              ),
            );
          await run(
            "UPDATE hierarchical_wiki_membership SET basis_json=jsonb_set(basis_json,'{documentVersionId}','\"DV-new\"') WHERE source_kind='DOCUMENT' AND wiki_id='wiki-31-00'",
          );
          const current = await read();
          assert.deepEqual(
            leaves(current).map((item) => item.sourceId),
            ['WI-new'],
          );
          const [classification] = await run(
            "SELECT basis_json->>'kind' AS kind FROM hierarchical_wiki_membership WHERE member_key='DOCUMENT_FAMILY:F-selected' AND wiki_id='wiki-31-00'",
          );
          assert.equal(classification.kind, 'USER_WIKI_CLASSIFICATION');
        },
      );
      const [engine] = await run('SELECT version() AS version');
      t.diagnostic(
        'Owned loopback PostgreSQL executed actual production inventory SQL; ' +
          engine.version.split(' on ')[0],
      );
    } finally {
      await cluster.stop();
    }
  },
);
