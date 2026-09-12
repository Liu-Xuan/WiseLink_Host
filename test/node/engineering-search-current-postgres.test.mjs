import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import postgres from 'postgres';
process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only'); require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { EngineeringIssueSearchService } = require('../../server/modules/canonical-host/engineering-issue-search.service.ts');
const { jobAidReadingFixture } = require('../unit/semantic-reading-ui.fixtures.ts');
const { jobAidReadingResult } = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const url = process.env.ENGINEERING_SEARCH_TEST_DATABASE_URL;

test('real SQL current/history search resolves real subjects and reauthorizes exact work', { skip: !url }, async () => {
  const target = new URL(url); assert.equal(target.hostname,'127.0.0.1'); assert.equal(target.pathname,'/wiselink_search_current_test');
  const db = postgres(url,{max:1,onnotice(){}});
  const priorProjection = process.env.WL_ENGINEERING_SEARCH_PROJECTION;
  try {
    await db.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TABLE assessment_work_revision(tenant_id text,created_by_user_id text,work_item_id text,assessment_work_revision_id text,work_revision integer,content_json text);
      CREATE TABLE engineering_matter_work_revision(tenant_id text,created_by_user_id text,matter_id text,matter_work_revision_id text,working_revision integer,state_json text);
      CREATE TABLE engineering_search_projection(entry_id text,tenant_id text,owner_kind text,owner_id text,exact_revision_ref text,
        entry_kind text,parent_context_ref text,title text,identifiers text[],search_vector tsvector);`);
    const saved = new Map();
    for (const kind of ['WI','MAT']) for (const revision of [1,2]) {
      const value = jobAidReadingFixture().current;
      value.workItemId = `${kind}-real`; value.workRevisionRef=`${kind}-revision-${revision}`; value.workRevision=revision;
      value.content.issues = [{...value.content.issues[0],issueKey:'ISSUE',question:revision===1?'retiredneedle':'currentneedle'}];
      const ref = value.workRevisionRef;
      if (kind==='WI') {
        await db`INSERT INTO assessment_work_revision VALUES ('tenant','actor',${value.workItemId},${ref},${revision},${JSON.stringify(value.content)})`;
        saved.set(ref,value);
      } else {
        const state={problemWork:value.content,substantiveResult:jobAidReadingResult(value)};
        await db`INSERT INTO engineering_matter_work_revision VALUES ('tenant','actor','MAT-real',${ref},${revision},${JSON.stringify(state)})`;
        saved.set(ref,{workingRevision:revision,state});
      }
      await db`INSERT INTO engineering_search_projection VALUES (${ref+':issue:ISSUE'},'tenant',${kind==='WI'?'USER':'MATTER'},'actor',
        ${ref},'WORK',${kind+'-real'},'ISSUE',ARRAY['ISSUE'],to_tsvector('simple',${value.content.issues[0].question}))`;
    }
    await db`INSERT INTO engineering_search_projection VALUES ('orphan:issue:ISSUE','tenant','USER','actor','orphan','WORK','WI-real','ISSUE',ARRAY['ISSUE'],to_tsvector('simple','currentneedle'))`;
    const actor={userId:'actor',tenantId:'tenant',objectAccessActor:{principalKind:'FINAL_USER',transport:'MIAODA_AUTHENTICATED_HTTP',
      canonicalSubject:{namespace:'MIAODA_USER_ID',id:'actor'},tenantId:'tenant',applicationScopeId:'app_17bzc551rsg',
      subjectDecision:{applicationScopeId:'app_17bzc551rsg',tenantId:'tenant',source:'MIAODA_GATEWAY_USER_CONTEXT',version:'miaoda-hosted-native-sso.v1'},
      workspaceId:null,workspaceProvenance:'UNAVAILABLE',identityProvenance:'MIAODA_GATEWAY_USER_CONTEXT',applicationScopeProvenance:'MIAODA_GATEWAY_APP_CONTEXT',
      env:'runtime',feishuUserId:null,feishuOpenId:null,feishuIdentityProvenance:'UNAVAILABLE',sessionId:null,sessionRevision:null,sessionProvenance:'UNAVAILABLE'}};
    let denied=false;
    const reads=[];
    const load=async(subject,ref)=>{reads.push([subject,ref]);if(denied)throw Object.assign(new Error('SOURCE_REVOKED'),{statusCode:403});return saved.get(ref);};
    const service=new EngineeringIssueSearchService(drizzle(db),{readBrowserRevision:load},{readWorkingRevision:load});
    for(const projection of ['0','1']) {
      process.env.WL_ENGINEERING_SEARCH_PROJECTION=projection;
      assert.equal((await service.search('retiredneedle',actor)).hits.length,0);
      const history=await service.search('retiredneedle',actor,'HISTORY');
      assert.deepEqual(history.hits.map(hit=>hit.subjectId).sort(),['MAT-real','WI-real']);
      assert.ok(history.hits.every(hit=>hit.workRevision===1));
      const current=await service.search('currentneedle',actor);
      assert.equal(current.hits.length,2); assert.ok(current.hits.every(hit=>hit.workRevision===2));
      assert.ok(reads.every(([subject])=>subject!=='actor'));
      denied=true;
      assert.equal((await service.search('retiredneedle',actor,'HISTORY')).hits.length,0);
      denied=false;
    }
  } finally { if(priorProjection===undefined)delete process.env.WL_ENGINEERING_SEARCH_PROJECTION;else process.env.WL_ENGINEERING_SEARCH_PROJECTION=priorProjection;await db.end(); }
});
