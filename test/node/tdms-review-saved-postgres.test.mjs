import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { postgresCapability, startOwnedPostgres } from '../pg/owned-postgres-cluster.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module:'CommonJS', moduleResolution:'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { drizzle } = require('drizzle-orm/postgres-js');
const { getTableConfig } = require('drizzle-orm/pg-core');
const { sql } = require('drizzle-orm');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const schema = require('../../server/database/schema.ts');
const { autoWorkItemAuthorization } = require('../../server/database/auto-work-item-authorization.schema.ts');
const load = path => require(`../../server/modules/${path}.ts`);
const { EngineeringMatterWorkingRepository } = load('canonical-host/engineering-matter-working.repository');
const { JobAidWorkRepository } = load('canonical-host/jobaid-work.repository');
const { EngineeringSearchProjectionWriter } = load('canonical-host/engineering-search-projection');
const { ReviewConversationRepository } = load('review-persistence/review-conversation.repository');
const { MiaodaWorkItemRepository } = load('work-item/miaoda-work-item.repository');
const { MiaodaHostedCanonicalObjectAccessAdapter } = load('work-item/miaoda-hosted-canonical-object-access.adapter');
const { ConfiguredDevelopmentCanonicalServiceScopeAuthorization } = load('canonical-host/configured-development-service-scope.authorization');
const { MiaodaAutomaticWorkItemLeaseAuthorizationAdapter } = load('canonical-host/miaoda-automatic-work-item-lease-authorization.adapter');
const { MiaodaAutomaticWorkItemSourceAuthorizationAdapter } = load('canonical-host/miaoda-automatic-work-item-source-authorization.adapter');
const { OrdinaryDocumentManagementAuthorizer } = load('document-management-runtime/ordinary-document-management-authorizer');
const { MiaodaDocumentVersionSourceResolver } = load('work-item/miaoda-document-version-source.resolver');
const { ActionAttemptRepository } = load('action-attempt/action-attempt.repository');
const { ActionAttemptLifecycleService } = load('action-attempt/action-attempt-lifecycle.service');
const { ReviewAttemptDispatchService } = load('action-attempt/review-attempt-dispatch.service');
const { DerivedSummaryMembersService } = load('canonical-host/derived-summary-members.service');
const { CanonicalJobAidProblemService } = load('canonical-host/canonical-jobaid-problem.service');
const { CanonicalHostOpenClawReviewService } = load('canonical-host/canonical-host-openclaw-review.service');
const { projectCommonAssessmentContext } = load('canonical-host/canonical-host-common-context.service');
const { TdmsProductionRuntimeReader } = load('tdms-source/tdms-production-runtime-reader');
const { tdmsReviewBinding } = load('tdms-source/tdms-review-delegation');
const { assertTdmsNativeInTransaction } = load('canonical-host/tdms-native-evidence-verifier.port');
const { materializeJobAidWork } = load('canonical-host/jobaid-problem-work');
const { JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } = load('canonical-host/jobaid-method-pack');
const { sealResultEnvelope } = load('action-attempt/action-attempt-envelope');
const { parseReviewTurnCandidateContract } = load('canonical-host/canonical-host-openclaw-review.contract');
const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const { tdmsRuntimeFixture } = require('../unit/fixtures/tdms-runtime.fixture.ts');
const { fixedModelSettings } = require('../support/fixed-model-settings.ts');
const { resetQ1Database, initialProjection } = await import('./helpers/q1-review-postgres.fixture.mjs');
const { seedReceivers, seedNative } = await import('./helpers/tdms-saved-native-postgres.fixture.mjs');
const { validateReviewTask } = await import('../../openclaw/skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs');
const { runHostedReviewTurn, invokeHostedReviewModel } = await import('../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs');
const SCHEMA='workspace_aadkpkjef3slu', ROLE=`service_role_${SCHEMA}`, BROWSER=`authenticated_${SCHEMA}`;
const APP='app_17bzc551rsg', WI='WI-review', RC='RC-review';
const config={WL_OPENCLAW_SERVICE_SCOPE_ENABLED:'1',WL_OPENCLAW_GATEWAY_AUTH_MODE:'API_KEY',
  WL_OPENCLAW_SERVICE_SCOPE_ENV:'DEV',WL_OPENCLAW_SERVICE_PRINCIPAL_ID:'service:review-test',
  WL_OPENCLAW_SERVICE_TENANT_ID:'tenant-a',WL_OPENCLAW_SERVICE_WORK_ITEM_ID:WI,WL_JOBAID_PROBLEM_V2_ENABLED:'1'};
const copy=structuredClone;

// Reuse the existing migration/RLS fixture in a caller-owned disposable schema.
// No live URL, policy workaround or root-pool consumer is accepted by this test.
function schemaFixture(connection) {
  return new Proxy(connection,{get(target,key){
    if(key==='unsafe') return (query,...args)=>target.unsafe(query.replaceAll('public',SCHEMA)
      .replaceAll('wiselink_jobaid_test',SCHEMA),...args);
    if(key==='reserve') return async()=>schemaFixture(await target.reserve());
    const value=target[key];return typeof value==='function'?value.bind(target):value;
  }});
}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('saved TDMS Review uses real builder/dispatch/save and current authorized consumers', {timeout:90000}, async t=>{
  const capability=await postgresCapability();assert.equal(capability.available,true,capability.reason);
  const owned=await startOwnedPostgres(capability), admin=owned.admin;
  const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));
  Object.assign(process.env,config);
  try {
    await admin.unsafe(`CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA},pg_catalog`);
    await resetQ1Database(schemaFixture(admin));
    await admin.unsafe(`SET search_path TO ${SCHEMA},pg_catalog; ALTER TABLE action_attempt ALTER COLUMN subject_kind SET DEFAULT 'WORK_ITEM'`);
    const scopeDdl=await readFile(new URL('../../migrations/0023_engineering_matter_working_state.sql',import.meta.url),'utf8');
    await admin.unsafe(scopeDdl.slice(scopeDdl.indexOf('CREATE OR REPLACE FUNCTION review_turn_r10_guard_scope_immutable'),
      scopeDdl.indexOf('CREATE TABLE IF NOT EXISTS engineering_matter_work_revision')));
    await admin.unsafe(await readFile(new URL('../../migrations/candidates/tdms_review_saved_context_locks.hosted.sql',import.meta.url),'utf8'));
    for(const table of [schema.dmDocumentVersion,schema.dmPublicationFamily,schema.dmSourceArtifact,
      schema.dmAcquisition,schema.dmIngressPreflight,schema.dmCurrentnessDecision,autoWorkItemAuthorization]) {
      const c=getTableConfig(table);
      await admin.unsafe(`CREATE TABLE IF NOT EXISTS ${c.name}(fixture_placeholder boolean)`);
      for(const col of c.columns) await admin.unsafe(`ALTER TABLE ${c.name} ADD COLUMN IF NOT EXISTS "${col.name}" ${col.getSQLType()}`);
    }
    for(const name of ['tdms-source-rebuild-v1.draft.sql','tdms-processing-set-v1.draft.sql'])
      await admin.unsafe(await readFile(new URL(`../../server/database/${name}`,import.meta.url),'utf8'));
    await seedReceivers(admin);
    // Exact controlled-writer guard and both triggers, observed in the hosted
    // catalog on 2026-10-21 and rechecked on 2026-10-23. This disposable fixture
    // reproduces that existing protocol; it is not a new production migration.
    await admin.unsafe(`CREATE OR REPLACE FUNCTION ${SCHEMA}.tdms_receiver_guard_change()
      RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wiselink:tdms-receiver:' || OLD.receiver_id,0));
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        IF NEW.receiver_id IS DISTINCT FROM OLD.receiver_id THEN
          RAISE EXCEPTION 'TDMS_RECEIVER_ID_IMMUTABLE';
        END IF;
        NEW.revision := OLD.revision + 1;
        RETURN NEW;
      END;
      $function$;
      CREATE TRIGGER tdms_receiver_revision BEFORE DELETE OR UPDATE ON tdms_source_receiver
        FOR EACH ROW EXECUTE FUNCTION tdms_receiver_guard_change();
      CREATE TRIGGER tdms_receiver_grant_revision BEFORE DELETE OR UPDATE ON tdms_source_receiver_grant
        FOR EACH ROW EXECUTE FUNCTION tdms_receiver_guard_change();`);
    await admin.unsafe(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${SCHEMA} TO ${ROLE},${BROWSER}`);
    for(const table of ['tdms_record_revision','tdms_relation_assertion','tdms_processing_revision_set',
      'tdms_processing_set_head','tdms_capture','tdms_read_receipt']) await admin.unsafe(
      `CREATE POLICY fixture_scope ON ${table} TO ${ROLE},${BROWSER} USING(tenant_id='tenant-a' AND current_setting('app.user_id',true)='user-a')`);
    const login=`tdms_fixture_app_${randomUUID().replaceAll('-','').slice(0,16)}`;
    await admin.unsafe(`CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS IN ROLE ${ROLE},${BROWSER}`);
    const client=await owned.connect(login);
    await client.unsafe(`SET search_path TO ${SCHEMA},pg_catalog; SET ROLE ${ROLE}`);
    await client`SELECT set_config('app.user_id','user-a',false)`;
    const queries=[], database=drizzle(client,{logger:{logQuery(query){queries.push(query);}}}), adminDb=drizzle(admin);
    const f=tdmsRuntimeFixture({workItemId:WI}), {binding}=f;
    // Retained storage has no contributor directory. Do not synthesize one
    // into this original READ; the exact native text/approval remains intact.
    f.facts.contributions=[];
    const context=await f.adapter.discover(f.principal,binding);
    const evidence=(await f.adapter.read(f.principal,{context,evidenceRefs:[context.projection.selectedSetApprovedRefs[0]],
      purpose:'JOB_AID_NATIVE_RECORD',taskContextRef:binding.taskContextRef})).evidence[0];
    // Existing fixture seeds the exact original ordinary READ and its unchanged
    // carrier. Supply the real work table's mandatory finite header columns.
    const seedDb=new Proxy(adminDb,{get(target,key){
      if(key==='insert') return table=>table===schema.assessmentWorkRevision
        ? {values:value=>target.insert(table).values({...value,workRevision:value.assessmentWorkRevisionId==='work-selected'?1:2,
          requestId:value.assessmentWorkRevisionId,actionAttemptId:'attempt-original',basedOnWorkItemRevision:1,commandJson:'{}'})}
        :target.insert(table);
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
    await seedNative(admin,seedDb,f,context,evidence);
    await admin`DELETE FROM assessment_work_revision WHERE assessment_work_revision_id='work-other'`;
    const projection=initialProjection(WI);
    projection.requestId='request';projection.source={documentId:'doc',documentVersionId:binding.documentVersionId,
      sourceArtifactId:'artifact',sourceFileSha256:'a'.repeat(64),sourceByteLength:42};
    projection.package.packageId='PKG-review';
    await admin`UPDATE work_item SET projection_json=${JSON.stringify(projection)},status='CANDIDATE_READBACK_VERIFIED',
      action_type='PARSE_PDF',package_id='PKG-review',source_artifact_id='artifact',source_file_sha256=${'a'.repeat(64)},source_byte_length=42`;
    const original=originalFixture();Object.assign(original.binding,{documentVersionId:binding.documentVersionId,
      sourceArtifactId:'artifact',sourceByteLength:42});
    const originalLoaded={original,structuredSource:original.source,run:{...original.binding,
      manifestArtifact:{readback:'VERIFIED',relativePath:'original/manifest.json',sha256:'b'.repeat(64),byteLength:100}}};
    const baselineContent={schemaVersion:'wiselink.jobaid-problem-work.v3',headline:'Saved native work',listBrief:'Exact historical receipt',
      understanding:'Prior authorized candidate',decisiveIssueKeys:[],overviewStatus:'CURRENT',issues:[],
      roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',completionReason:'Uncertainty retained',changeSummary:'Original save',
      unchangedExplanation:'',methodBinding:JOBAID_METHOD_BINDING,evidence:[evidence,...JOBAID_METHOD_EVIDENCE],
      readSourceRefs:[evidence.evidenceRef,...JOBAID_METHOD_EVIDENCE.map(e=>e.evidenceRef)],capabilities:[],
      historyReview:{required:false,priorAssessmentRefs:[],engineeringDocumentRefs:[],coverage:'NOT_REQUIRED',limitation:null}};
    await admin`UPDATE assessment_work_revision SET content_json=${JSON.stringify(baselineContent)},created_at=now() WHERE assessment_work_revision_id='work-selected'`;
    await admin`UPDATE action_attempt SET action_type='OPENCLAW_DYNAMIC_EVALUATION',subject_kind='WORK_ITEM',request_origin='OPENCLAW_MCP_V1',
      status='SUCCEEDED',attempt_no=1,input_revision=1,created_at=now()-interval '1 hour',completed_at=now()-interval '1 hour' WHERE attempt_id='attempt-original'`;
    await admin`INSERT INTO review_conversation(review_conversation_id,tenant_id,actor_id,work_item_id,openclaw_agent_id,
      openclaw_session_key,started_at_revision,last_synced_revision,status,created_at,last_active_at)
      VALUES(${RC},'tenant-a','user-a',${WI},'wiselink-engineering','review:exact',1,1,'ACTIVE',now(),now())`;
    const sqlContext=new SqlExecutionContextMiddleware({roleSchema:SCHEMA});
    const writer=new EngineeringSearchProjectionWriter(database);
    const actors=new EngineeringMatterWorkingRepository(database,sqlContext,{roleSchema:SCHEMA},writer);
    const work=new JobAidWorkRepository(database,actors,writer);
    const workItems=new MiaodaWorkItemRepository(database), reviews=new ReviewConversationRepository(database);
    const authority=new ConfiguredDevelopmentCanonicalServiceScopeAuthorization();
    const objectAccess=new MiaodaHostedCanonicalObjectAccessAdapter(workItems);
    const native=new TdmsProductionRuntimeReader(database,authority,work,{current:()=>({tenantId:'tenant-a',clientId:'cli_aadde8b579f95bc9'})},objectAccess);
    const attemptRepository=new ActionAttemptRepository(database), models=fixedModelSettings();
    const attempts=new ActionAttemptLifecycleService(attemptRepository,models);
    const dispatch=new ReviewAttemptDispatchService(attemptRepository,attempts,models);
    const common={buildForWorkItemWithEvidence:async item=>({common:projectCommonAssessmentContext(item,
      {context:{status:'UNAVAILABLE',reason:'OFFLINE_FIXTURE'},documentReadingStatus:'AVAILABLE',items:[],sections:[],resourceRefs:[]},[]),availableReadingEvidence:[]})};
    const registrar={getTenantScopedByWorkItemId:async()=> (await workItems.loadTenantScopedProjection(WI,'tenant-a')).projection};
    const jobAid=new CanonicalJobAidProblemService(registrar,{},authority,
      {authorize:async({action})=>({allowed:true,action,permissionSnapshotVersion:'fixture'})},
      {freshRead:async()=>({permissionSnapshotVersion:'fixture'})},attempts,workItems,reviews,common,work,undefined,
      {readDocumentOriginal:async()=>copy(originalLoaded)},{read:async()=>null},database,undefined,objectAccess,native,native);
    work.publishedOriginalBinding=work.publishedOriginalBindingForRequest=async()=>({parseRunId:original.binding.parseRunId});
    const review=new CanonicalHostOpenClawReviewService(reviews,workItems,{}, {},attempts,{},authority,dispatch,common,undefined,actors,jobAid);
    const hosted=callback=>new Promise((resolve,reject)=>sqlContext.use(
      {userContext:{userId:'user-a',isSystemAccount:true,roles:[]}}, {},()=>Promise.resolve().then(callback).then(resolve,reject)));
    const browser=callback=>new Promise((resolve,reject)=>sqlContext.use(
      {userContext:{userId:'user-a',isSystemAccount:false,roles:[]}}, {},()=>Promise.resolve().then(callback).then(resolve,reject)));
    const browserActor={userId:'user-a',tenantId:'tenant-a',appId:APP,roles:[],objectAccessActor:{...f.actor,
      applicationScopeId:APP,subjectDecision:{...f.actor.subjectDecision,applicationScopeId:APP,version:'miaoda-hosted-native-sso.v1'}}};
    const newTurn=async(request,selectedConversation)=>browser(async()=>{
      const conversation=selectedConversation ?? {
          reviewConversationId:RC,tenantId:'tenant-a',actorId:'user-a',workItemId:WI,status:'ACTIVE',
          openClawAgentId:'wiselink-engineering',openClawSessionKey:'review:exact',startedAtRevision:1,lastSyncedRevision:1};
      return reviews.appendTextTurn({conversation,requestId:request,userMessage:'Reconsider the exact saved opinion.',
        purpose:'UPDATE_ASSESSMENT',executionRequested:true,overallRequested:false,expectedInputRevision:1,currentRevision:1});
    });
    let first, savedRef, firstResult;
    const delta=()=>({schemaVersion:'wiselink.jobaid-problem-work.v3',headline:'Keep the exact native qualification',
      listBrief:'Historical professional judgment remains conditional.',overview:'Use the saved approved opinion as a source, with uncertainty retained.',
      roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',completionReason:'No operational configuration was verified.',
      changeSummary:'Clarify the retained opinion.',unchangedExplanation:'Other unknowns remain.',issues:[{
        issueKey:'native-condition',question:'Is the installed configuration known?',
        body:`The historical opinion requires its exact installed condition. [[${evidence.evidenceRef}]]`,
        riskScenarios:[{scenario:'Configuration remains unknown',conditions:['Only if the named component is installed'],method:'JA_AC_R01',
          severity:null,likelihood:null,importantEvent:null,limitations:['No operational severity or frequency was acquired.'],
          controlComparison:'Retain the unknown configuration.'}],measures:[],otherClassifications:[],requirementHandling:[],
        openQuestions:[{question:'Is it installed?',affects:'Applicability',nextEvidence:'Controlled configuration',reason:'The opinion is historical.'}]}],
      unchangedIssueKeys:[],retiredIssues:[]});
    const result=(begin,proposal)=>sealResultEnvelope({schemaVersion:'wiselink.3_1.openclaw_result_envelope.v1',
      actionAttemptId:begin.task.actionAttemptId,operationRef:begin.attemptRef,taskType:begin.task.taskType,workItemId:WI,
      baseRevision:begin.task.baseRevision,status:'SUCCEEDED',businessOutcome:'CANDIDATE_READY',candidateStatus:null,
      modelOutput:JSON.stringify({schemaVersion:'wiselink.3_1.review_turn_candidate.v1.c5',mode:'INTERACTIVE_REVIEW',
        reviewConversationRef:RC,reviewTurnRef:begin.task.modelInput.reviewTurnRef,responseType:'RESYNTHESIS_RESULT',
        answer:'Retain the exact saved qualification.',sourceRefs:[],missingInputs:[],candidateEvidenceRefs:[],
        reviewActionDraft:null,affectedItemIds:[],warnings:[],jobAidWorkingDelta:proposal,
        runtime:{runtimeAppId:'app_17c3zn24kv2',profileRef:'wiselink-engineering'}}),
      outputArtifactRefs:[],sourceRefs:begin.task.sourceRefs,factsConsidered:[],missingInputs:[],conflicts:[],warnings:[],
      modelVersion:'constructed-offline-no-model',promptVersion:'review-saved-fixture',
      skillVersion:'wiselink-research-and-synthesize@r09.c234',toolVersions:{'wiselink-openclaw-engineering-assessment':'1.2.0'},
      runMetrics:{durationMs:0,inputUnits:0,outputUnits:0},errorCode:null,errorDetail:null});
    const commit=(begin,envelope)=>hosted(()=>review.commit(begin.attemptRef,begin.leaseToken,begin.leaseGeneration,envelope,WI));
    await t.test('prepared lock-only policies allow exact row marks and reject even no-op updates under the actual consumer roles',async()=>{
      for(const [table,column,value,roles] of [
        ['review_conversation','review_conversation_id',RC,[hosted]],
        ['identity_subject_mapping','miaoda_user_id','user-a',[hosted,browser]],
        ['assessment_work_revision','assessment_work_revision_id','work-selected',[hosted]],
      ]) for(const enter of roles) {
        const rows=await enter(()=>database.transaction(tx=>tx.execute(sql`SELECT ${sql.raw(column)} AS ref
          FROM ${sql.raw(table)} WHERE ${sql.raw(column)}=${value} FOR SHARE`)));
        assert.equal(rows.length,1);
        await assert.rejects(enter(()=>database.transaction(tx=>tx.execute(sql`UPDATE ${sql.raw(table)}
          SET ${sql.raw(column)}=${sql.raw(column)} WHERE ${sql.raw(column)}=${value}`))),error=>
          error.code==='42501'||error.cause?.code==='42501');
      }
      await new Promise((resolve,reject)=>sqlContext.use({userContext:{userId:'wrong-actor',isSystemAccount:true,roles:[]}}, {},
        ()=>database.transaction(async tx=>{
          for(const table of ['review_conversation','identity_subject_mapping','assessment_work_revision'])
            assert.equal((await tx.execute(sql`SELECT 1 FROM ${sql.raw(table)} FOR SHARE`)).length,0);
        }).then(resolve,reject)));
      for(const [table,tenant] of [['review_conversation','tenant_id'],['identity_subject_mapping','miaoda_tenant_id'],['assessment_work_revision','tenant_id']])
        assert.equal((await hosted(()=>database.transaction(tx=>tx.execute(sql`SELECT 1 FROM ${sql.raw(table)}
          WHERE ${sql.raw(tenant)}='wrong-tenant' FOR SHARE`)))).length,0);
    });
    await t.test('metadata admission rejects revoked Source before saved body/task journal and before dispatch',async()=>{
      await newTurn('request-review');
      await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
      queries.length=0;
      await assert.rejects(hosted(()=>review.begin(RC,'request-review',WI)),/TDMS_RECEIVER_ACTION_DENIED/);
      assert.equal(queries.some(q=>q.includes('review_activity_json')||q.includes('SELECT "assessment_work_revision_id",')||
        q.includes('jsonb_extract_path(data,\'record\',\'content\'')),false);
      assert.equal((await admin`SELECT count(*)::int AS n FROM action_attempt WHERE action_type='OPENCLAW_INTERACTIVE_REVIEW'`)[0].n,0);
      await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;
    });
    await t.test('actual begin builder and dispatch produce a Native-accepted saved-only task, with no native resource or new READ',async()=>{
      first=await hosted(()=>review.begin(RC,'request-review',WI));
      const contract=validateReviewTask(first.task.modelInput), task=contract.jobAidContext;
      assert.equal(task.tdmsReviewContext.mode,'SAVED_EVIDENCE_ONLY');
      assert.deepEqual(task.sourceCatalog.find(e=>e.kind==='TDMS_NATIVE_RECORD'),evidence);
      assert.ok(task.initiallyDeliveredRefs.includes(evidence.evidenceRef));
      assert.equal(contract.resourceRefs.some(r=>r.sourceRefId===evidence.evidenceRef),false);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
      const delivered=await hosted(()=>review.context(first.attemptRef,WI));
      assert.equal(delivered.context.problemAssessment.tdmsReviewContext.mode,'SAVED_EVIDENCE_ONLY');
    });
    await t.test('opaque real entry handle survives only by identity; forged copies, mismatched scope and revoked current mapping reject',async()=>{
      const scope=await authority.authorizeOpenClawAttempt({operation:'COMMIT_REVIEW',attemptRef:first.attemptRef,workItemId:WI});
      const caller=await hosted(()=>native.admitReview({scope,attemptRef:first.attemptRef}));
      assert.equal(Object.isFrozen(caller),true);assert.equal(Object.isFrozen(tdmsReviewBinding(caller).scope),true);
      const check=handle=>hosted(()=>work.withActorTransaction('user-a',database=>assertTdmsNativeInTransaction({
        actor:{tenantId:'tenant-a',actorUserId:'user-a'},reviewCaller:handle,evidence:[evidence],database},native)));
      await check(caller);
      for(const forged of [{...caller},structuredClone(caller),JSON.parse(JSON.stringify(caller))])
        await assert.rejects(check(forged),/TDMS_REVIEW_DELEGATION_REJECTED/);
      scope.workItemId='WI-wrong';await check(caller); // no external mutable binding retained
      await admin`UPDATE identity_subject_mapping SET status='REVOKED'`;
      try {await assert.rejects(check(caller),/TDMS_(REVIEW_DELEGATION_REJECTED|RECEIVER_BOUND_IDENTITY_MISMATCH)/);}
      finally {await admin`UPDATE identity_subject_mapping SET status='ACTIVE'`;}
    });
    await t.test('actual Host task and context reach the real Native driver, sanitizer, model marshalling and original candidate guard',async()=>{
      const checkpointDir=await mkdtemp(join(tmpdir(),'wiselink-review-saved-host-driver-'));
      const stop=new Error('ACTUAL_HOST_MODEL_PIPELINE_CAPTURED_BEFORE_COMMIT');
      const requests=[], inputs=[];let validated=0, artifactReads=0;
      const docRef=first.task.modelInput.resourceRefs[0].sourceRefId;
      const runtime={gatewayChatCompletionsEnabled:true,gatewayUrl:'https://constructed.invalid',gatewayToken:'fixture-only',
        configuredModelVersion:'constructed-no-model',registeredModelRefs:[first.task.executionModel.modelRef]};
      const callTool=async(name,args)=>{
        if(name==='begin_review_turn')return copy(first);
        if(name==='get_review_turn_context')return hosted(()=>review.context(args.attemptRef,WI));
        if(name==='read_source_refs') {artifactReads++;assert.equal(args.sourceRefIds.includes(evidence.evidenceRef),false);
          return hosted(()=>review.readSourceRefs(args.attemptRef,args.sourceRefIds,WI));}
        if(name==='heartbeat_action_attempt')return {leaseExpiresAt:first.leaseExpiresAt};
        assert.fail(`Unexpected business operation ${name}`);
      };
      const requestGateway=async(_url,init)=>{
        const request=JSON.parse(init.body);requests.push(request);
        const readFirst=request.tools.every(tool=>tool.function.name==='read_wiselink_review_sources');
        return Response.json({model:'constructed-no-model',choices:[{finish_reason:'tool_calls',message:{content:null,
          tool_calls:[{id:`constructed-${requests.length}`,type:'function',function:{
            name:readFirst?'read_wiselink_review_sources':'return_wiselink_review_candidate',
            arguments:JSON.stringify(readFirst?{sourceRefIds:[docRef]}:{answer:'Keep the historical qualification.',sourceRefs:[docRef],jobAidWorkingDelta:delta()})}}]}}]});
      };
      try {
        await assert.rejects(runHostedReviewTurn({workItemId:WI,reviewConversationRef:RC,requestId:'request-review',checkpointDir},
          {callTool,modelRuntime:runtime,requestGateway,invokeModel:async(input,options)=>{
            inputs.push(copy(input));await invokeHostedReviewModel(input,{...runtime,...options,
              validateCandidate:value=>{options.validateCandidate(value);validated++;}},{requestGateway});throw stop;
          }}),error=>error===stop);
        assert.equal(validated,1);assert.equal(artifactReads,1);assert.equal(requests.length,2);
        const model=inputs[0].input.context.problemAssessment;
        assert.equal(Object.hasOwn(model,'tdmsReviewContext'),false);
        const delivered=model.deliveredEvidence.find(e=>e.kind==='TDMS_NATIVE_RECORD');
        assert.equal(Object.hasOwn(delivered.nativeScope.processingSetBinding.scope,'tenantId'),false);
        assert.deepEqual(delivered.nativeReadReceipt,evidence.nativeReadReceipt);
      } finally {await rm(checkpointDir,{recursive:true,force:true});}
    });
    await t.test('current Source/head/own approval gates reject before stored task and journal bodies are released',async()=>{
      for(const [change,restore,expected] of [
        [()=>admin`UPDATE tdms_processing_set_head SET generation=2,data=jsonb_set(data,'{generation}','2')`,
          ()=>admin`UPDATE tdms_processing_set_head SET generation=1,data=jsonb_set(data,'{generation}','1')`,/TDMS_PROCESSING_SET_SELECTION_CHANGED/],
        [()=>admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,state}','{"rawCode":"Pending","rawName":"Pending"}') WHERE source_revision_ref='a'`,
          ()=>admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,state}','{"rawCode":"Estimated","rawName":"Estimated"}') WHERE source_revision_ref='a'`,/TDMS_SET_ALL_APPROVED_UNCONFIRMED/],
      ]) {
        await change();queries.length=0;
        try {await assert.rejects(hosted(()=>review.context(first.attemptRef,WI)),expected);
          assert.equal(queries.some(q=>q.includes('review_activity_json')||q.includes("jsonb_extract_path(data,'record','content'")),false);
        } finally {await restore();}
      }
    });
    await t.test('actual correction rolls work and Review receipt back together, then sealed COMMITTING recovery remints and saves once',async()=>{
      firstResult=result(first,delta());
      const originalPersist=reviews.persistOpenClawAssistantCandidate.bind(reviews);
      reviews.persistOpenClawAssistantCandidate=async(...args)=>{await originalPersist(...args);throw new Error('AFTER_REVIEW_RECEIPT_ROLLBACK');};
      try {await assert.rejects(commit(first,firstResult),/AFTER_REVIEW_RECEIPT_ROLLBACK/);} finally {reviews.persistOpenClawAssistantCandidate=originalPersist;}
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,1);
      assert.equal((await admin`SELECT result_content_hash FROM review_turn WHERE request_id='request-review'`)[0].result_content_hash,null);
      assert.equal((await admin`SELECT status FROM action_attempt WHERE operation_ref=${first.attemptRef}`)[0].status,'COMMITTING');
      const [beforeExpiry]=await admin`SELECT lease_expires_at,lease_generation FROM action_attempt WHERE operation_ref=${first.attemptRef}`;
      await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second' WHERE operation_ref=${first.attemptRef}`;
      await assert.rejects(commit(first,firstResult),/TDMS_REVIEW_DELEGATION_REJECTED/);
      await admin`UPDATE action_attempt SET lease_expires_at=${beforeExpiry.lease_expires_at} WHERE operation_ref=${first.attemptRef}`;
      // New request enters the actual authorization/metadata path; no handle or
      // former lease is serialized or renewed to recover the sealed result.
      const finish=attempts.finishCandidatePersistenceSuccess.bind(attempts);
      attempts.finishCandidatePersistenceSuccess=async()=>{throw new Error('LOST_TERMINAL_RESPONSE');};
      try {await assert.rejects(commit(first,firstResult),/LOST_TERMINAL_RESPONSE/);} finally {attempts.finishCandidatePersistenceSuccess=finish;}
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,2);
      await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second' WHERE operation_ref=${first.attemptRef}`;
      const recovered=await commit(first,firstResult);
      assert.equal(recovered.status,'SUCCEEDED');assert.equal(recovered.assistantCandidate.jobAidWorkingUpdate.status,'APPLIED');
      savedRef=recovered.assistantCandidate.jobAidWorkingUpdate.workRevisionRef;
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,2);
      assert.equal((await admin`SELECT lease_generation FROM action_attempt WHERE operation_ref=${first.attemptRef}`)[0].lease_generation,beforeExpiry.lease_generation);
      const again=await commit(first,firstResult);assert.equal(again.replayed,true);
      assert.equal(again.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,savedRef);
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,2);
      const saved=await hosted(()=>work.readByRefForRuntime({tenantId:'tenant-a',actorUserId:'user-a',workItemId:WI,workRevisionRef:savedRef}));
      assert.deepEqual(saved.content.evidence.find(e=>e.kind==='TDMS_NATIVE_RECORD'),evidence);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
    });
    await t.test('explicit unchanged compares the current saved native work and persists only its Review receipt',async()=>{
      await newTurn('request-unchanged');
      const next=await hosted(()=>review.begin(RC,'request-unchanged',WI));
      validateReviewTask(next.task.modelInput);
      assert.equal(next.task.modelInput.jobAidContext.tdmsReviewContext.workRevisionRef,savedRef);
      const answer=await commit(next,result(next,null));
      assert.equal(answer.assistantCandidate.jobAidWorkingUpdate.status,'UNCHANGED');
      assert.equal(answer.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,savedRef);
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,2);
    });
    await t.test('existing browser and summary consumers read the new exact work and original READ; latest ordinary attempt stays separately identified',async()=>{
      const ddl=await readFile(new URL('../../migrations/0078_native_tenant_shared_read.sql',import.meta.url),'utf8');
      for(const name of ['native_app_shared_read_allowed','native_app_work_item_readable','native_app_document_readable']) {
        const definition=ddl.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`,'u'))?.[0];assert.ok(definition);
        await admin.unsafe(definition.replaceAll("'63849986'","'tenant-a'"));
      }
      await admin`UPDATE dm_document_version SET document_id='doc'`;
      await admin`UPDATE dm_acquisition SET idempotency_key='tenant:tenant-a:request:fixture'`;
      const read=await browser(()=>jobAid.readBrowser(WI,browserActor));
      assert.equal(read.current.workRevisionRef,savedRef);assert.equal(read.current.workRevision,2);
      assert.equal(read.current.actionAttemptId,first.task.actionAttemptId);
      assert.equal(read.latestAttempt.attemptId,'attempt-original');assert.notEqual(read.latestAttempt.attemptId,read.current.actionAttemptId);
      assert.deepEqual(read.current.content.evidence.find(e=>e.kind==='TDMS_NATIVE_RECORD'),evidence);
      const unregister=require('tsconfig-paths').register({baseUrl:process.cwd(),paths:{'@/*':['client/src/*'],
        '@shared/*':['shared/*'],'@server/*':['server/*']}});
      let graph;try {const {adaptJobAidWorkingRead}=require('../../client/src/pages/DocumentParsingPage/runtime-monitor/adapt-jobaid-working-read.ts');
        graph=adaptJobAidWorkingRead(read,{observedAt:new Date().toISOString(),environment:'owned-pg-fixture',scopeKey:WI,label:'Constructed Review',mode:'snapshot'});
      } finally {unregister();}
      const research=graph.nodes.find(n=>n.id==='assessment.research');
      assert.ok(research.outputs.some(o=>o.ref===savedRef));
      assert.ok(research.summary.includes(first.task.actionAttemptId));
      assert.equal(research.requests[0].id,'attempt-original');
      assert.equal(research.requests[0].artifact,'未取得此尝试对应的保存结果');
      assert.deepEqual(graph.edges.filter(e=>e.templateId==='company.research')[0].refs,
        [evidence.nativeSource.sourceRevisionRef,evidence.nativeReadReceipt.receiptRef,evidence.evidenceRef,savedRef]);
      const summaries=new DerivedSummaryMembersService(jobAid,actors,{readDocumentOriginal:async()=>copy(originalLoaded)},native);
      const owner={tenantId:'tenant-a',actorUserId:'user-a',readScope:'TENANT'};
      const [member]=await browser(()=>database.transaction(database=>summaries.withNativeTransaction(owner,database,
        {kind:'BROWSER',actor:browserActor},()=>summaries.readAll([{kind:'WORK_ITEM_WORK',workItemId:WI,
          documentVersionId:binding.documentVersionId,workRef:savedRef,workRevision:2,issueKeys:[]}],owner,database))));
      assert.deepEqual(member.evidence.find(e=>e.kind==='TDMS_NATIVE_RECORD'),evidence);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
    });
    await t.test('real completed-source successor authorization stays finite before the native gate and cannot become an ordinary WorkItem actor',async()=>{
      await adminDb.insert(autoWorkItemAuthorization).values({tenantId:'tenant-a',workItemId:WI,requestId:'request',actorUserId:'user-a',
        documentId:'doc',documentVersionId:binding.documentVersionId,sourceArtifactId:'artifact',sourceFileSha256:'a'.repeat(64),sourceByteLength:42,
        grantKind:'MIAODA_CANONICAL_PARSE_REQUEST',status:'COMPLETED',completedAt:new Date(),leaseGeneration:1});
      await admin`UPDATE dm_document_version SET lifecycle_status='COMMITTED_IMMUTABLE',committed_by='user-a'`;
      const keys=['WL_OPENCLAW_SERVICE_WORK_ITEM_ID','WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED','WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED'];
      const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
      delete process.env.WL_OPENCLAW_SERVICE_WORK_ITEM_ID;
      process.env.WL_OPENCLAW_SERVICE_AUTO_QUEUE_ENABLED='1';process.env.WL_OPENCLAW_SERVICE_SUCCESSOR_REVIEW_ENABLED='1';
      const adapter=new MiaodaAutomaticWorkItemLeaseAuthorizationAdapter(workItems,new MiaodaDocumentVersionSourceResolver(database),
        new MiaodaAutomaticWorkItemSourceAuthorizationAdapter(new OrdinaryDocumentManagementAuthorizer(workItems,undefined)),reviews,attemptRepository);
      const dynamic=new ConfiguredDevelopmentCanonicalServiceScopeAuthorization(adapter);
      const consumer=new CanonicalHostOpenClawReviewService(reviews,workItems,{}, {},attempts,{},dynamic,dispatch,common,undefined,actors,jobAid);
      try {
        await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
        queries.length=0;
        try {await assert.rejects(hosted(()=>consumer.context(first.attemptRef,WI)),/TDMS_RECEIVER_ACTION_DENIED/);
          assert.equal(queries.some(query=>query.includes('"projection_json"')||query.includes('"review_activity_json"')),false);
        } finally {await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
        const actual=await hosted(()=>consumer.context(first.attemptRef,WI));
        assert.equal(actual.context.problemAssessment.tdmsReviewContext.workRevisionRef,'work-selected');
        const authorized=await hosted(()=>dynamic.authorizeOpenClawAttempt({operation:'GET_REVIEW_CONTEXT',attemptRef:first.attemptRef,workItemId:WI}));
        assert.equal(authorized.successorReviewDelegation.actorUserId,'user-a');
        await assert.rejects(dynamic.assertOpenClawWorkItemTransport(authorized),/CANONICAL_WORK_ITEM_NOT_FOUND/);
        const caller=await hosted(()=>native.admitReview({scope:authorized,attemptRef:first.attemptRef}));
        assert.ok(Object.isFrozen(tdmsReviewBinding(caller).scope.successorReviewDelegation));
        authorized.successorReviewDelegation.actorUserId='caller-mutated-owner';
        authorized.successorReviewDelegation.reviewTurnRef='caller-mutated-turn';
        await hosted(()=>work.withActorTransaction('user-a',database=>assertTdmsNativeInTransaction({
          actor:{tenantId:'tenant-a',actorUserId:'user-a'},reviewCaller:caller,evidence:[evidence],database},native)));
      } finally {for(const [key,value] of Object.entries(old)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}}
    });
    await t.test('existing Source writer protocol, selected head, mapping, cancellation and session close serialize on the handed transaction in both winning orders',async()=>{
      const {turn}=await newTurn('request-races');
      const racing=await hosted(()=>review.begin(RC,'request-races',WI));
      const ingress=await authority.authorizeOpenClawAttempt({operation:'COMMIT_REVIEW',attemptRef:racing.attemptRef,workItemId:WI});
      let caller=await hosted(()=>native.admitReview({scope:ingress,attemptRef:racing.attemptRef}));
      const run=(handle=caller,extra={})=>hosted(()=>work.withActorTransaction('user-a',database=>
        assertTdmsNativeInTransaction({actor:{tenantId:'tenant-a',actorUserId:'user-a'},reviewCaller:handle,
          evidence:[evidence],database,...extra},native)));
      const observer=await owned.connect();
      const [{pid:writerPid}]=await admin`SELECT pg_backend_pid() AS pid`;
      const waitLocked=async()=>{
        const deadline=Date.now()+3000;
        while(Date.now()<deadline) {
          const [state]=await observer`SELECT wait_event_type,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid=${writerPid}`;
          if(state?.wait_event_type==='Lock'&&state.blockers.length) return;
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        assert.fail('Expected the actual PostgreSQL writer to wait for the consumer row lock');
      };
      const consumerWins=async(write,after)=>{
        const held=deferred(),release=deferred();
        const consumer=hosted(()=>work.withActorTransaction('user-a',async database=>{
          await assertTdmsNativeInTransaction({actor:{tenantId:'tenant-a',actorUserId:'user-a'},reviewCaller:caller,evidence:[evidence],database},native);
          held.resolve();await release.promise;
          await assertTdmsNativeInTransaction({actor:{tenantId:'tenant-a',actorUserId:'user-a'},reviewCaller:caller,evidence:[evidence],database},native);
        }));
        await Promise.race([held.promise,consumer.then(()=>{throw new Error('Consumer did not retain its transaction');})]);
        const writer=write();
        try {await waitLocked();} finally {release.resolve();}
        await consumer;await writer;await after();
      };
      for(const [change,restore,error] of [
        [()=>admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`,
          ()=>admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`,/TDMS_RECEIVER_ACTION_DENIED/],
        [()=>admin`UPDATE tdms_source_receiver SET status='REVOKED'`,
          ()=>admin`UPDATE tdms_source_receiver SET status='ACTIVE'`,/TDMS_RECEIVER_ACTION_DENIED/],
        [()=>admin`UPDATE tdms_processing_set_head SET generation=2,data=jsonb_set(data,'{generation}','2')`,
          ()=>admin`UPDATE tdms_processing_set_head SET generation=1,data=jsonb_set(data,'{generation}','1')`,/TDMS_PROCESSING_SET_SELECTION_CHANGED/],
        [()=>admin`UPDATE identity_subject_mapping SET status='REVOKED'`,()=>admin`UPDATE identity_subject_mapping SET status='ACTIVE'`,/TDMS_REVIEW_DELEGATION_REJECTED/],
        [()=>admin`UPDATE action_attempt SET cancel_requested_at=now() WHERE operation_ref=${racing.attemptRef}`,
          ()=>admin`UPDATE action_attempt SET cancel_requested_at=NULL WHERE operation_ref=${racing.attemptRef}`,/TDMS_REVIEW_DELEGATION_REJECTED/],
      ]) {
        await change();try {await assert.rejects(run(),error);} finally {await restore();}
        try {await consumerWins(()=>Promise.resolve(change()),()=>assert.rejects(run(),error));} finally {await restore();}
      }
      // Wrong actual binding/fence or carrier cannot borrow a valid handle.
      await assert.rejects(run(caller,{actor:{tenantId:'tenant-a',actorUserId:'other'}}),/TDMS_/);
      await assert.rejects(run(caller,{summaryCaller:{kind:'BROWSER',actor:browserActor}}),/TDMS_NATIVE_EVIDENCE_ACTOR_INVALID/);
      const fakeBody=copy(evidence);fakeBody.excerpt='outside the exact saved carrier';
      await assert.rejects(run(caller,{evidence:[fakeBody]}),/TDMS_NATIVE_SAVED_WORK_BINDING_MISMATCH/);
      const wrongBasis=copy(racing.task.modelInput.jobAidContext);wrongBasis.tdmsReviewContext.workRevisionRef='work-selected';
      wrongBasis.modelInput.tdmsReviewContext=copy(wrongBasis.tdmsReviewContext);
      await assert.rejects(hosted(()=>work.withActorTransaction('user-a',database=>
        jobAid.assertReviewNativeInTransaction(wrongBasis,caller,'tenant-a',database))),/TDMS_REVIEW_CALLER_BINDING_MISMATCH/);
      for(const [change,restore] of [
        [()=>admin`UPDATE action_attempt SET lease_generation=lease_generation+1 WHERE operation_ref=${racing.attemptRef}`,
          ()=>admin`UPDATE action_attempt SET lease_generation=lease_generation-1 WHERE operation_ref=${racing.attemptRef}`],
        [()=>admin`UPDATE work_item SET source_file_sha256=${'c'.repeat(64)} WHERE work_item_id=${WI}`,
          ()=>admin`UPDATE work_item SET source_file_sha256=${'a'.repeat(64)} WHERE work_item_id=${WI}`],
        [()=>admin`UPDATE work_item SET revision=2 WHERE work_item_id=${WI}`,()=>admin`UPDATE work_item SET revision=1 WHERE work_item_id=${WI}`],
      ]) {await change();try {await assert.rejects(run(),/TDMS_REVIEW_DELEGATION_REJECTED/);} finally {await restore();}}
      // Use the real sealed attempt and candidate persistence consumer for a
      // pending->completed race; no broad turn UPDATE policy is added.
      const sealed=result(racing,null);
      const parsed=parseReviewTurnCandidateContract({result:sealed,task:racing.task.modelInput});
      await hosted(()=>attempts.prepareCommit({attemptRef:racing.attemptRef,tenantId:'tenant-a',workItemId:WI,
        principalId:ingress.principalId,leaseToken:racing.leaseToken,leaseGeneration:racing.leaseGeneration,result:sealed,
        failClosedWithoutRejectionMutation:true}));
      caller=await hosted(()=>native.admitReview({scope:ingress,attemptRef:racing.attemptRef}));
      await assert.rejects(admin`UPDATE review_turn SET assistant_response='constructed',action_attempt_id=${racing.task.actionAttemptId},
        result_content_hash=${sealed.contentHash},review_scope_json='{"kind":"forged"}'::jsonb WHERE review_turn_id=${turn.reviewTurnId}`,
      /REVIEW_TURN_R10_SCOPE_IMMUTABLE/);
      const candidate={responseType:parsed.responseType,answer:parsed.answer,sourceRefs:[],missingInputs:[],candidateEvidenceRefs:[],
        reviewActionDraft:null,affectedItemIds:[],warnings:[],actionAttemptRef:racing.attemptRef,
        jobAidWorkingUpdate:{status:'UNCHANGED',workRevisionRef:savedRef,workRevision:2,affectedIssueKeys:[],readSourceRefs:[]},
        provenance:{runtimeAppId:'app_17c3zn24kv2',profileRef:'wiselink-engineering',modelVersion:sealed.modelVersion,
          promptVersion:sealed.promptVersion,skillVersion:sealed.skillVersion,toolVersions:sealed.toolVersions,resultContentHash:sealed.contentHash}};
      const bound=await hosted(()=>reviews.loadOpenClawTurnByIdBinding({reviewConversationId:RC,reviewTurnId:turn.reviewTurnId,
        tenantId:'tenant-a',actorId:'user-a',workItemId:WI}));
      const writerReviews=new ReviewConversationRepository(adminDb);
      await consumerWins(()=>hosted(()=>writerReviews.persistOpenClawAssistantCandidate({conversation:bound.conversation,
        turn:bound.turn,actionAttemptId:racing.task.actionAttemptId,candidate,completedAt:new Date()})),()=>run());
      await assert.rejects(admin`UPDATE review_turn SET assistant_response=assistant_response||'changed' WHERE review_turn_id=${turn.reviewTurnId}`,
        /REVIEW_TURN_C2_CANDIDATE_APPEND_ONLY/);
      await assert.rejects(hosted(()=>native.admitReview({scope:ingress,reviewConversationRef:RC,requestId:'request-races'})),/TDMS_REVIEW_DELEGATION_REJECTED/);
      // Consumer first: live conversation closure waits, then later readers deny.
      await consumerWins(()=>Promise.resolve(admin`UPDATE review_conversation SET status='CLOSED',closed_at=now() WHERE review_conversation_id=${RC}`),
        ()=>assert.rejects(run(),/TDMS_REVIEW_DELEGATION_REJECTED/));
      // Close first on a newly created real conversation: no old session is reused.
      const next=await browser(()=>reviews.createOrResume({tenantId:'tenant-a',actorId:'user-a',workItemId:WI,currentRevision:1}));
      await newTurn('request-close-first',next.aggregate.conversation);
      await admin`UPDATE review_conversation SET status='CLOSED',closed_at=now() WHERE review_conversation_id=${next.aggregate.conversation.reviewConversationId}`;
      await assert.rejects(hosted(()=>review.begin(next.aggregate.conversation.reviewConversationId,'request-close-first',WI)),/TDMS_REVIEW_DELEGATION_REJECTED/);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
    });
  } finally {
    for(const [key,value] of Object.entries(previous)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await owned.stop();
  }
});
