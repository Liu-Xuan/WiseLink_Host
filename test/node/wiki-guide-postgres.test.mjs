import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { readWikiGuideNavigation } = require('../../server/modules/canonical-host/hierarchical-wiki-navigation.ts');
const { readWikiGuideIssuePage, wikiGuideIssueReadStats } = require('../../server/modules/canonical-host/engineering-wiki-issue-page.ts');
const databaseUrl = process.env.WIKI_GUIDE_TEST_DATABASE_URL;

test('real local PostgreSQL: lightweight directory and exact membership issue pages', { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.pathname, '/wiselink_wiki_guide_test');
  const pg = postgres(databaseUrl, { max: 2, onnotice() {} });
  const originalProjection = process.env.WL_ENGINEERING_SEARCH_PROJECTION;
  try {
    await pg.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TABLE derived_summary(summary_id text PRIMARY KEY,tenant_id text,actor_user_id text,current_summary_ref text,current_revision integer);
      CREATE TABLE hierarchical_wiki_scope(wiki_id text PRIMARY KEY,summary_id text,tenant_id text,actor_user_id text,parent_wiki_id text,
        scope_json jsonb,enabled boolean,state_json jsonb,delegated_principal_id text);
      CREATE TABLE hierarchical_wiki_membership(wiki_id text,tenant_id text,actor_user_id text,source_kind text,source_id text,member_json jsonb,basis_json jsonb);
      CREATE TABLE action_attempt(attempt_id text,operation_ref text,status text,tenant_id text,actor_user_id text,summary_id text,
        trigger_request_id text,summary_delegated_principal_id text,subject_kind text,action_type text,work_item_id text,matter_id text,document_version_id text);
      CREATE TABLE assessment_work_revision(tenant_id text,work_item_id text,assessment_work_revision_id text,work_revision integer,document_version_id text,content_json text);
      CREATE TABLE engineering_matter_work_revision(tenant_id text,matter_id text,matter_work_revision_id text,working_revision integer,state_json text);
      CREATE TABLE engineering_search_projection(entry_id text,tenant_id text,entry_kind text,owner_kind text,parent_context_ref text,
        exact_revision_ref text,search_vector tsvector,identifiers text[]);`);
    const db = drizzle(pg), owner = { tenantId: 'tenant-A', actorUserId: 'actor-A', readScope: 'TENANT' };
    const state = { schemaVersion: 1, versions: {}, lastGenerated: {}, waiting: [], forceGeneration: 0, firstDirtyAt: null, active: null, blocked: null };
    async function node(id, parent, kind, ata2 = null, ata4 = null, tenant = 'tenant-A', actor = 'actor-A') {
      const scope = { kind, title: `${kind} ${ata4 ?? ata2 ?? id}`, fleetFamilyId: 'B787', fleetModelIds: [], ata2, ata4, selectionReason: '' };
      await pg`INSERT INTO derived_summary VALUES (${id},${tenant},${actor},${kind === 'FLEET' ? null : 'DSR-' + id},${kind === 'FLEET' ? 0 : 2})`;
      await pg`INSERT INTO hierarchical_wiki_scope VALUES (${'WIKI-' + id},${id},${tenant},${actor},${parent ? 'WIKI-' + parent : null},
        ${JSON.stringify(scope)}::jsonb,true,${JSON.stringify(state)}::jsonb,'principal')`;
    }
    await node('DS-root', null, 'FLEET');
    for (const chapter of ['21', '31', '32']) await node(`DS-${chapter}`, 'DS-root', 'ATA2', chapter);
    await node('DS-31-10', 'DS-31', 'ATA4', '31', '31-10');
    await node('DS-32-10', 'DS-32', 'ATA4', '32', '32-10');
    await node('DS-other-owner', null, 'FLEET', null, null, 'tenant-A', 'actor-B');
    await node('DS-other-tenant', null, 'FLEET', null, null, 'tenant-B');
    const roots = await readWikiGuideNavigation(db, owner, {});
    assert.equal(roots.items.length, 2); assert.ok(!roots.items.some(item => item.summaryId === 'DS-other-tenant'));
    assert.equal(roots.items.find(item => item.summaryId === 'DS-root').currentSummaryRef, null);
    const first = await readWikiGuideNavigation(db, owner, { parentSummaryId: 'DS-root', limit: 2 });
    const second = await readWikiGuideNavigation(db, owner, { parentSummaryId: 'DS-root', limit: 2, after: first.nextCursor });
    assert.equal(first.items.length, 2); assert.equal(second.items.length, 1);
    assert.equal(new Set([...first.items, ...second.items].map(item => item.summaryId)).size, 3);
    const exact = await readWikiGuideNavigation(db, owner, { summaryId: 'DS-31-10' });
    assert.deepEqual(exact.items[0].path.map(part => part.summaryId), ['DS-root', 'DS-31', 'DS-31-10']);
    assert.equal(exact.items[0].currentSummaryRef, 'DSR-DS-31-10');
    const found = await readWikiGuideNavigation(db, owner, { rootSummaryId: 'DS-root', search: '31-10' });
    assert.equal(found.items.length, 1);
    assert.deepEqual((await readWikiGuideNavigation(db, owner, { rootSummaryId: 'DS-root', search: '记录' }))
      .items.map(item => item.summaryId), ['DS-31']);
    assert.deepEqual((await readWikiGuideNavigation(db, owner, { rootSummaryId: 'DS-root', search: '仪表和控制面板' }))
      .items.map(item => item.summaryId), ['DS-31-10']);
    assert.deepEqual((await readWikiGuideNavigation(db, owner, { rootSummaryId: 'DS-root', search: 'Control Panels' }))
      .items.map(item => item.summaryId), ['DS-31-10']);
    assert.equal((await readWikiGuideNavigation(db, owner, { rootSummaryId: 'DS-root', search: '液压' })).items.length, 0);
    await assert.rejects(readWikiGuideNavigation(db, owner, { parentSummaryId: 'DS-31', rootSummaryId: 'DS-other-owner' }));
    await assert.rejects(readWikiGuideNavigation(db, owner, { summaryId: 'DS-31', limit: 20 }));

    const issues = Array.from({ length: 55 }, (_, index) => ({ issueKey: `I${String(index + 1).padStart(3, '0')}`,
      question: `guidekeyword question ${index + 1}`, body: 'retainedbodykeyword private body not returned' }));
    await pg`INSERT INTO assessment_work_revision VALUES ('tenant-A','WI-one','JAWR-one',2,'DV-one',${JSON.stringify({ issues })})`;
    await pg`INSERT INTO assessment_work_revision VALUES ('tenant-A','WI-one','JAWR-old',1,'DV-one',${JSON.stringify({ issues: [issues[0]] })})`;
    const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-one', documentVersionId: 'DV-one', workRef: 'JAWR-one', workRevision: 2, issueKeys: [] };
    async function membership(id, value, status = 'CONFIRMED') {
      await pg`INSERT INTO hierarchical_wiki_membership VALUES (${'WIKI-' + id},'tenant-A','actor-A','WORK_ITEM','WI-one',
        ${JSON.stringify(value)}::jsonb,${JSON.stringify({ classificationStatus: status })}::jsonb)`;
    }
    await membership('DS-31-10', member); await membership('DS-32-10', member);
    await membership('DS-21', { ...member, documentVersionId: 'DV-wrong' });
    await membership('DS-21', { ...member, issueKeys: ['I001'] }, 'CANDIDATE');
    await membership('DS-31-10', { ...member, workRef: 'JAWR-old', workRevision: 1 });
    for (const issue of issues) await pg`INSERT INTO engineering_search_projection VALUES (${'JAWR-one:issue:' + issue.issueKey},'tenant-A','WORK','USER','WI-one',
      'JAWR-one',to_tsvector('simple',${issue.question + ' retainedbodykeyword'}),ARRAY[${issue.issueKey}])`;
    const reads = [];
    const loadWork = async candidate => {
      reads.push(candidate.workRef);
      return { subjectKind: 'WORK_ITEM', subjectId: 'WI-one', workRef: candidate.workRef,
        workRevision: candidate.workRef === 'JAWR-one' ? 2 : 1, documentVersionId: 'DV-one', issues };
    };
    const read = (query, loader = loadWork) => readWikiGuideIssuePage({ query,
      withMetadataScope: operation => db.transaction(transaction => operation(transaction, owner)),
      loadWork: loader, stats: wikiGuideIssueReadStats(), isAccessUnavailable: error => error?.statusCode === 403 || error?.status === 404 });
    for (const projection of ['0', '1']) {
      process.env.WL_ENGINEERING_SEARCH_PROJECTION = projection;
      const page1 = await read({ rootSummaryId: 'DS-root', search: 'guidekeyword' });
      const page2 = await read({ rootSummaryId: 'DS-root', search: 'guidekeyword', after: page1.nextCursor });
      const page3 = await read({ rootSummaryId: 'DS-root', search: 'guidekeyword', after: page2.nextCursor });
      assert.deepEqual([page1.items.length, page2.items.length, page3.items.length], [20, 20, 15]);
      assert.equal(page3.nextCursor, null);
      assert.equal(new Set([...page1.items, ...page2.items, ...page3.items].map(item => item.issueKey)).size, 55);
      assert.equal(page1.items[0].paths.length, 2);
      assert.ok(page1.items[0].paths.every(path => path[0].summaryId === 'DS-root' && !path.some(part => part.summaryId === 'DS-21')));
      assert.ok(!JSON.stringify(page1).includes('private body'));
      assert.equal((await read({ rootSummaryId: 'DS-root', chapterSummaryId: 'DS-31', search: 'retainedbodykeyword' })).items[0].paths.length, 1);
      await assert.rejects(read({ rootSummaryId: 'DS-root', search: 'changed', after: page1.nextCursor }));
    }
    assert.equal(reads.length, 8); // Four pages per query path, one exact authorization per unique work/page.
    process.env.WL_ENGINEERING_SEARCH_PROJECTION = '0';
    const history = await read({ rootSummaryId: 'DS-root', search: '', scope: 'HISTORY' });
    assert.ok(history.items.some(item => item.workRef === 'JAWR-old'));
    const denied = await read({ rootSummaryId: 'DS-root', search: '' }, async () => { throw Object.assign(new Error('revoked'), { statusCode: 403 }); });
    assert.equal(denied.items.length, 0); assert.equal(denied.nextCursor, null);
    const ownOnly = await readWikiGuideNavigation(db, { ...owner, readScope: undefined }, {});
    assert.deepEqual(ownOnly.items.map(item => item.summaryId), ['DS-root']);
    assert.equal((await pg`SELECT count(*)::int AS n FROM action_attempt`)[0].n, 0);
    assert.equal((await pg`SELECT count(*)::int AS n FROM hierarchical_wiki_scope`)[0].n, 8);
  } finally {
    if (originalProjection === undefined) delete process.env.WL_ENGINEERING_SEARCH_PROJECTION;
    else process.env.WL_ENGINEERING_SEARCH_PROJECTION = originalProjection;
    await pg.end();
  }
});
