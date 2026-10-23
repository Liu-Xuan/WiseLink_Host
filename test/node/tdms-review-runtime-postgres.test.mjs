import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
const { McpServer } = require('@modelcontextprotocol/server');
const { SqlExecutionContextMiddleware } = require('@lark-apaas/fullstack-nestjs-core');
const schema = require('../../server/database/schema.ts');
const { dmDocumentParseRun } = require('../../server/database/document-parsing.schema.ts');
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
const { CanonicalHostOpenClawAttemptStatusService } = load('canonical-host/canonical-host-openclaw-attempt-status.service');
const { CanonicalHostOpenClawOverallService } = load('canonical-host/canonical-host-openclaw-overall.service');
const { CanonicalHostOpenClawMcpService } = load('canonical-host/canonical-host-openclaw-mcp.service');
const { projectCommonAssessmentContext } = load('canonical-host/canonical-host-common-context.service');
const { TdmsProductionRuntimeReader } = load('tdms-source/tdms-production-runtime-reader');
const { tdmsReviewBinding } = load('tdms-source/tdms-review-delegation');
const { assertTdmsNativeInTransaction } = load('canonical-host/tdms-native-evidence-verifier.port');
const { materializeJobAidWork } = load('canonical-host/jobaid-problem-work');
const { JOBAID_METHOD_BINDING, JOBAID_METHOD_EVIDENCE } = load('canonical-host/jobaid-method-pack');
const { resolvedTdmsReadCarriers } = load('canonical-host/jobaid-tdms-context');
const { sealResultEnvelope } = load('action-attempt/action-attempt-envelope');
const { parseAssessmentTdmsEvidence } = require('../../shared/assessment-tdms-evidence.ts');
const { parseReviewTurnCandidateContract } = load('canonical-host/canonical-host-openclaw-review.contract');
const { originalFixture } = require('../unit/document-parsing/fixtures/document-original.fixture.ts');
const { tdmsRuntimeFixture } = require('../unit/fixtures/tdms-runtime.fixture.ts');
const {CanonicalModelSettingsService}=load('model-settings/canonical-model-settings.service');
const {CanonicalModelSettingsRepository}=load('model-settings/canonical-model-settings.repository');
const { resetQ1Database, initialProjection } = await import('./helpers/q1-review-postgres.fixture.mjs');
const { seedReceivers, seedNative } = await import('./helpers/tdms-saved-native-postgres.fixture.mjs');
const nativeScripts=process.env.WL_TDMS_REVIEW_NATIVE_SCRIPTS
  ? pathToFileURL(process.env.WL_TDMS_REVIEW_NATIVE_SCRIPTS+'/')
  : new URL('../../openclaw/skills/wiselink-research-and-synthesize/scripts/',import.meta.url);
const {validateReviewTask}=await import(new URL('validate-payload.mjs',nativeScripts));
const {runHostedReviewTurn,invokeHostedReviewModel,validateHostToolMetadata}=await import(new URL('run-hosted-review-turn.mjs',nativeScripts));
const {consumePendingReviewTurn}=await import(new URL('consume-hosted-review-turn.mjs',nativeScripts));
const {HOST_MCP_TOOLS}=await import(new URL('orchestrate-host-mcp.mjs',nativeScripts));
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
// JSON field/boolean metadata is allowed. Standalone full journal/result columns
// must never be selected before the native Source gate.
const loadsAttemptBody=query=>/(?:select|,)\s*(?:"action_attempt"\.)?"(?:review_activity_json|result_envelope_json)"\s*(?:,|from)/iu.test(query);


test('bounded TDMS Review uses real native READ journal, save and exact successor authority', {timeout:600000}, async t=>{
  const capability=await postgresCapability();assert.equal(capability.available,true,capability.reason);
  const owned=await startOwnedPostgres(capability), admin=owned.admin;
  const previous=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));
  Object.assign(process.env,config);
  try {
    await admin.unsafe(`CREATE SCHEMA ${SCHEMA}; SET search_path TO ${SCHEMA},pg_catalog`);
    await resetQ1Database(schemaFixture(admin));
    await admin.unsafe(`SET search_path TO ${SCHEMA},pg_catalog; ALTER TABLE action_attempt ALTER COLUMN subject_kind SET DEFAULT 'WORK_ITEM'; ALTER TABLE action_attempt ALTER COLUMN id SET DEFAULT gen_random_uuid()`);
    const scopeDdl=await readFile(new URL('../../migrations/0023_engineering_matter_working_state.sql',import.meta.url),'utf8');
    await admin.unsafe(scopeDdl.slice(scopeDdl.indexOf('CREATE OR REPLACE FUNCTION review_turn_r10_guard_scope_immutable'),
      scopeDdl.indexOf('CREATE TABLE IF NOT EXISTS engineering_matter_work_revision')));
    await admin.unsafe(await readFile(new URL('../../migrations/candidates/tdms_review_saved_context_locks.hosted.sql',import.meta.url),'utf8'));
    for(const table of [schema.dmDocumentVersion,schema.dmPublicationFamily,schema.dmSourceArtifact,dmDocumentParseRun,
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
    await admin`UPDATE dm_document_version SET document_id='doc'`;
    await admin`UPDATE dm_acquisition SET idempotency_key='tenant:tenant-a:request:fixture'`;
    const sharedReadDdl=await readFile(new URL('../../migrations/0078_native_tenant_shared_read.sql',import.meta.url),'utf8');
    for(const name of ['native_app_shared_read_allowed','native_app_work_item_readable','native_app_document_readable']) {
      const definition=sharedReadDdl.match(new RegExp(`CREATE OR REPLACE FUNCTION ${name}\\([\\s\\S]*?\\$\\$;`,'u'))?.[0];assert.ok(definition);
      await admin.unsafe(definition.replaceAll("'63849986'","'tenant-a'"));
    }
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
    await adminDb.insert(dmDocumentParseRun).values({id:randomUUID(),tenantId:'tenant-a',documentVersionId:binding.documentVersionId,
      parseRunId:original.binding.parseRunId,parseRevision:original.binding.parseRevision,status:'PUBLISHED',
      actorUserId:'user-a',requestId:'fixture-published-original',expectedPublishedRevision:1,bucketId:'fixture-bucket',
      sourceBinding:original.binding,manifestArtifact:{...originalLoaded.run.manifestArtifact,role:'MANIFEST'},
      deadlineAt:new Date(Date.now()+60*60_000),completedAt:new Date()});
    const baselineContent={schemaVersion:'wiselink.jobaid-problem-work.v3',headline:'Saved native work',listBrief:'Exact historical receipt',
      understanding:'Prior authorized candidate',decisiveIssueKeys:[],overviewStatus:'CURRENT',issues:[],
      roundCompletion:'COMPLETE_WITH_OPEN_QUESTIONS',completionReason:'Uncertainty retained',changeSummary:'Original save',
      unchangedExplanation:'',methodBinding:JOBAID_METHOD_BINDING,evidence:[...JOBAID_METHOD_EVIDENCE],
      readSourceRefs:JOBAID_METHOD_EVIDENCE.map(e=>e.evidenceRef),capabilities:[],
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
    const attemptRepository=new ActionAttemptRepository(database),modelRepository=new CanonicalModelSettingsRepository(database);
    const models=new CanonicalModelSettingsService({read:async tenantId=>({tenantId,modelRef:'miaoda/minimax-m3',revision:0,
      updatedAt:new Date('2026-09-06T00:00:00Z')}),readWorkItemModel:(...args)=>modelRepository.readWorkItemModel(...args),
      pinWorkItemModel:(...args)=>modelRepository.pinWorkItemModel(...args)});
    const attempts=new ActionAttemptLifecycleService(attemptRepository,models);
    const dispatch=new ReviewAttemptDispatchService(attemptRepository,attempts,models);
    const common={buildForWorkItemWithEvidence:async item=>({common:projectCommonAssessmentContext(item,
      {context:{status:'UNAVAILABLE',reason:'OFFLINE_FIXTURE'},documentReadingStatus:'AVAILABLE',items:[],sections:[],resourceRefs:[]},[]),availableReadingEvidence:[]})};
    const registrar={getTenantScopedByWorkItemId:async()=> (await workItems.loadTenantScopedProjection(WI,'tenant-a')).projection,
      compareAndSet:input=>workItems.compareAndSet(input)};
    const artifactBytes=new Map();
    const artifacts={readActualBytes:async artifact=>{
      const bytes=artifactBytes.get(artifact.ref);assert.ok(bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);return bytes.slice();},
      persistAndReadback:async bytes=>{const digest=createHash('sha256').update(bytes).digest('hex');
      artifactBytes.set(`constructed-candidate:${digest}`,bytes.slice());
      return {artifact:{ref:`constructed-candidate:${digest}`,sha256:digest,byteLength:bytes.byteLength,
        mediaType:'application/json',storeRole:'UnifiedArtifactStoreCandidate'}};}};
    const jobAid=new CanonicalJobAidProblemService(registrar,artifacts,authority,
      {authorize:async({action})=>({allowed:true,action,permissionSnapshotVersion:'fixture'})},
      {freshRead:async()=>({permissionSnapshotVersion:'fixture'})},attempts,workItems,reviews,common,work,undefined,
      {readDocumentOriginal:async()=>copy(originalLoaded)},{read:async()=>null},database,undefined,objectAccess,native,native);
    const baselineRevision=await work.readByRefForRuntime({tenantId:'tenant-a',actorUserId:'user-a',workItemId:WI,workRevisionRef:'work-selected'});
    const baselineArtifact=(await artifacts.persistAndReadback(new TextEncoder().encode(JSON.stringify(baselineRevision)))).artifact;
    projection.integratedAssessment={status:'BASE_RULE_CANDIDATE_READY',
      baseRules:jobAid.baseProjection(projection,{attemptId:'attempt-original',triggerRequestId:'request-original'},baselineRevision,baselineArtifact),
      engineerReviews:null,overallSynthesis:null,overallForAeoConfirmation:null};
    await admin`UPDATE work_item SET projection_json=${JSON.stringify(projection)}`;
    const review=new CanonicalHostOpenClawReviewService(reviews,workItems,{}, {},attempts,artifacts,authority,dispatch,common,undefined,actors,jobAid);
    const hosted=callback=>new Promise((resolve,reject)=>sqlContext.use(
      {userContext:{userId:'user-a',isSystemAccount:true,roles:[]}}, {},()=>Promise.resolve().then(callback).then(resolve,reject)));
    const browser=callback=>new Promise((resolve,reject)=>sqlContext.use(
      {userContext:{userId:'user-a',isSystemAccount:false,roles:[]}}, {},()=>Promise.resolve().then(callback).then(resolve,reject)));
    const browserActor={userId:'user-a',tenantId:'tenant-a',appId:APP,roles:[],objectAccessActor:{...f.actor,
      applicationScopeId:APP,subjectDecision:{...f.actor.subjectDecision,applicationScopeId:APP,version:'miaoda-hosted-native-sso.v1'}}};
    const newTurn=async(request,selectedConversation,attachmentBindings=[])=>browser(async()=>{
      const conversation=selectedConversation ?? {
          reviewConversationId:RC,tenantId:'tenant-a',actorId:'user-a',workItemId:WI,status:'ACTIVE',
          openClawAgentId:'wiselink-engineering',openClawSessionKey:'review:exact',startedAtRevision:1,lastSyncedRevision:1};
      return reviews.appendTextTurn({conversation,requestId:request,userMessage:'Reconsider the exact saved opinion.',
        purpose:'UPDATE_ASSESSMENT',executionRequested:true,overallRequested:true,expectedInputRevision:1,currentRevision:1,attachmentBindings});
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
      skillVersion:'wiselink-research-and-synthesize@r09.c235',toolVersions:{'wiselink-openclaw-engineering-assessment':'1.2.0'},
      runMetrics:{durationMs:0,inputUnits:0,outputUnits:0},errorCode:null,errorDetail:null});
    const commit=(begin,envelope)=>hosted(()=>review.commit(begin.attemptRef,begin.leaseToken,begin.leaseGeneration,envelope,WI));
    let packet,driverResult;
    const readNative=(begin,extra={})=>hosted(()=>review.readNativeSources({attemptRef:begin.attemptRef,workItemId:WI,
      leaseToken:begin.leaseToken,leaseGeneration:begin.leaseGeneration,sourceRefs:[evidence.evidenceRef],
      context:'EXACT',purpose:'Read the current explicitly approved field',...extra}));
    const cancel=begin=>hosted(()=>attempts.requestCancel({attemptRef:begin.attemptRef,tenantId:'tenant-a',workItemId:WI,
      reason:'Complete this isolated negative scenario'}));
    const cancelIfActive=async begin=>{if(begin && ['RUNNING','QUEUED'].includes(
      (await admin`SELECT status FROM action_attempt WHERE operation_ref=${begin.attemptRef}`)[0]?.status)) await cancel(begin);};
    const attemptStatus=new CanonicalHostOpenClawAttemptStatusService(attempts,authority,native);
    const registered=new Map(),register=McpServer.prototype.registerTool;
    McpServer.prototype.registerTool=function(name,definition,handler){registered.set(name,{definition,handler});
      return {remove(){},enable(){},disable(){},update(){}};};
    // Register the actual complete production capability shape. Optional ports
    // are inert here; this scenario only observes schemas and invokes the real
    // Review handler below, never their business callbacks.
    try {new CanonicalHostOpenClawMcpService(null,null,null,null,null,null,review,attemptStatus,attempts,authority,jobAid,
      {},{},{},{},{},{},{},{},{}).createServer();}
    finally {McpServer.prototype.registerTool=register;}
    await t.test('the actual Host MCP registration is accepted by the final Native strict optional capability contract',async()=>{
      const tools=[...registered].filter(([name])=>HOST_MCP_TOOLS.includes(name)||name==='read_review_native_sources')
        .map(([name,{definition}])=>({name,inputSchema:definition.inputSchema['~standard'].jsonSchema.input({target:'draft-2020-12'}),
          annotations:definition.annotations}));
      assert.equal(tools.length,HOST_MCP_TOOLS.length+1);validateHostToolMetadata({tools});
      const {inputSchema}=registered.get('read_review_native_sources').definition;
      const input={attemptRef:'AQ-fixture',workItemId:'WI-4db598a0-33b8-4abd-a64d-df2aac9f29c5',
        leaseToken:randomUUID(),leaseGeneration:1,sourceRefs:[evidence.evidenceRef],context:'EXACT',purpose:'Read exact selected metadata target'};
      assert.equal(inputSchema.safeParse(input).success,true);
      for(const extra of [{context:'PAGE'},{actorUserId:'forged'},{sourceRefs:[]},{sourceRefs:Array(97).fill(evidence.evidenceRef)},
        {purpose:' '},{leaseGeneration:0},{leaseToken:'invalid'}])assert.equal(inputSchema.safeParse({...input,...extra}).success,false);
    });
    await t.test('empty saved native still takes the finite current Source and own-approval gate before body or reserve',async()=>{
      await newTurn('request-review');
      const count=async()=>(await admin`SELECT count(*)::int AS n FROM action_attempt`)[0].n;
      const before=await count();
      for(const [change,restore,error] of [
        [()=>admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`,
          ()=>admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`,/TDMS_/],
        [()=>admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,state}','{"rawCode":"Pending","rawName":"Pending"}') WHERE source_revision_ref='a'`,
          ()=>admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,state}','{"rawCode":"Estimated","rawName":"Estimated"}') WHERE source_revision_ref='a'`,/TDMS_/],
        [()=>admin`UPDATE tdms_record_revision SET data=jsonb_set(data,'{record,rawFields,opinionCollection}','null') WHERE source_revision_ref IN ('a','b')`,
          async()=>{for(const ref of ['a','b'])await admin`UPDATE tdms_record_revision SET data=jsonb_set(data,
            '{record,rawFields,opinionCollection}',${JSON.stringify(f.revisions.get(ref).record.rawFields.opinionCollection)}::jsonb) WHERE source_revision_ref=${ref}`;},
          /TDMS_RUNTIME_OPINION_NOT_APPROVED/],
      ]) {
        await change();queries.length=0;
        try {await assert.rejects(hosted(()=>review.begin(RC,'request-review',WI)),error);
          assert.equal(queries.some(q=>q.includes('review_activity_json')||q.includes('SELECT "assessment_work_revision_id",')||
            q.includes("jsonb_extract_path(data,'record','content'")),false);
          assert.equal(await count(),before);
        } finally {await restore();}
      }
    });
    await t.test('a genuinely selected complete empty set remains metadata-only; it is distinct from a revoked grant or missing own approval',async()=>{
      const empty=copy(f.set);empty.members=[];empty.setRevisionRef='set-empty';
      await admin`INSERT INTO tdms_processing_revision_set(tenant_id,source_key,source_instance_id,scope_id,set_revision_ref,
        processing_family_ref,cohort_ref,processing_observation_ref,data) VALUES('tenant-a','TDMS','instance','shared-source',
        ${empty.setRevisionRef},${empty.processingFamilyRef},${empty.cohortRef},${empty.processingObservationRef},${JSON.stringify(empty)}::jsonb)`;
      await admin`UPDATE tdms_processing_set_head SET selected_set_revision_ref=${empty.setRevisionRef},generation=2,
        data=${JSON.stringify({...f.head,selectedSetRevisionRef:empty.setRevisionRef,generation:2})}::jsonb`;
      let begin;
      try {
        await newTurn('request-empty-directory');
        begin=await hosted(()=>review.begin(RC,'request-empty-directory',WI));
        const addon=begin.task.modelInput.jobAidContext.tdmsReviewContext;
        assert.equal(addon.mode,'BOUNDED_NATIVE_READ');assert.equal(addon.runtimeContext.selections.length,1);
        assert.deepEqual(addon.runtimeContext.projection.selectedSetApprovedRefs,[]);
        assert.deepEqual(addon.runtimeContext.projection.opinions,[]);
        assert.equal(addon.runtimeContext.projection.readPerformed,false);
        validateReviewTask(begin.task.modelInput);
        await assert.rejects(readNative(begin),/REVIEW_NATIVE_SOURCE_REF_NOT_ALLOWED/);
        assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
        await cancel(begin);
      } finally {await cancelIfActive(begin);await admin`UPDATE tdms_processing_set_head SET selected_set_revision_ref=${f.set.setRevisionRef},generation=3,
        data=${JSON.stringify({...f.head,generation:3})}::jsonb`;}
    });
    await t.test('real reserve operationRef freezes a strict metadata-only addon accepted by the actual Native builder',async()=>{
      first=await hosted(()=>review.begin(RC,'request-review',WI));
      const contract=validateReviewTask(first.task.modelInput),task=contract.jobAidContext,addon=task.tdmsReviewContext;
      assert.equal(addon.mode,'BOUNDED_NATIVE_READ');assert.equal(Object.keys(addon).length,10);
      assert.deepEqual(addon.savedEvidenceRefs,[]);assert.equal(addon.runtimeContext.binding.taskContextRef,first.attemptRef);
      assert.equal(addon.runtimeContext.projection.readPerformed,false);
      assert.ok(task.modelInput.availableSources.some(item=>item.ref===evidence.evidenceRef));
      assert.equal(task.sourceCatalog.some(item=>item.evidenceRef===evidence.evidenceRef),false);
      assert.equal(task.initiallyDeliveredRefs.includes(evidence.evidenceRef),false);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
    });
    await t.test('wrong fence, PAGE, unknown ref and forged caller cannot cause a native READ',async()=>{
      for(const extra of [{leaseGeneration:first.leaseGeneration+1},{context:'PAGE'},
        {sourceRefs:['native:unknown']},{sourceRefs:Array(97).fill(evidence.evidenceRef)}, {purpose:' '}])
        await assert.rejects(readNative(first,extra));
      const scope=await authority.authorizeOpenClawAttempt({operation:'GET_REVIEW_CONTEXT',attemptRef:first.attemptRef,workItemId:WI});
      const caller=await hosted(()=>native.admitReview({scope,attemptRef:first.attemptRef}));
      for(const copy of [{...caller},structuredClone(caller),JSON.parse(JSON.stringify(caller))])
        await assert.rejects(hosted(()=>work.withActorTransaction('user-a',database=>assertTdmsNativeInTransaction({
          actor:{tenantId:'tenant-a',actorUserId:'user-a'},reviewCaller:copy,evidence:[],database},native))),/TDMS_REVIEW_DELEGATION_REJECTED/);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,1);
    });
    await t.test('a persisted bounded addon cannot fall back to ordinary admission when its TDMS marker disappears',async()=>{
      const [source]=await admin`SELECT source_descriptor_json FROM dm_acquisition`;
      await admin`UPDATE dm_acquisition SET source_descriptor_json=(source_descriptor_json::jsonb-'tdmsRegistration')::text`;
      queries.length=0;
      try {await assert.rejects(hosted(()=>review.context(first.attemptRef,WI)),/TDMS_RUNTIME_DOCUMENT_ACCESS_UNAVAILABLE/);
        assert.equal(queries.some(q=>loadsAttemptBody(q)),false);
      } finally {await admin`UPDATE dm_acquisition SET source_descriptor_json=${source.source_descriptor_json}`;}
    });
    await t.test('a frozen native directory cannot satisfy SAVE without an actual READ journal',async()=>{
      await assert.rejects(commit(first,result(first,delta())),/JOBAID_(?:SOURCE|UNKNOWN|EVIDENCE)|ASSESSMENT_/);
      assert.equal((await admin`SELECT status FROM action_attempt WHERE operation_ref=${first.attemptRef}`)[0].status,'RUNNING');
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,1);
    });
    await t.test('actual two-round Native Gateway hook invokes Host READ, immutable receipt+journal and atomic Review SAVE',async()=>{
      const checkpointDir=await mkdtemp(join(tmpdir(),'wiselink-review-runtime-host-driver-'));
      const requests=[],sealed=copy(first.task);let reads=0;
      const runtime={gatewayChatCompletionsEnabled:true,gatewayUrl:'https://constructed.invalid',gatewayToken:'fixture-only',
        configuredModelVersion:'constructed-no-model',registeredModelRefs:[first.task.executionModel.modelRef]};
      const performTool=async(name,args)=>{
        if(name==='begin_review_turn') return copy(first);
        if(name==='get_review_turn_context') return hosted(()=>review.context(args.attemptRef,WI));
        if(name==='read_review_native_sources') {reads++;
          const response=await hosted(()=>registered.get(name).handler(args));packet=JSON.parse(response.content[0].text);return packet;}
        if(name==='heartbeat_action_attempt') return {leaseExpiresAt:first.leaseExpiresAt};
        if(name==='commit_review_turn_candidate') return hosted(()=>review.commit(args.attemptRef,args.leaseToken,
          args.leaseGeneration,JSON.parse(args.resultJson),WI));
        assert.fail(`Unexpected operation ${name}`);
      };
      const callTool=async(name,args)=>{try{return await performTool(name,args);}catch(error){
        await writeFile(`tmp/review-native-read-evidence/pg-tool-failure-${name}.json`,JSON.stringify({tool:name,error:String(error),
          rows:await admin`SELECT operation_ref,status,review_activity_json FROM action_attempt`,
          receipts:await admin`SELECT receipt_ref,data FROM tdms_read_receipt`},null,2));throw error;}};
      const requestGateway=async(_url,init)=>{
        requests.push(JSON.parse(init.body));
        const initial=requests.length===1;
        return Response.json({model:'constructed-no-model',choices:[{finish_reason:'tool_calls',message:{content:null,
          tool_calls:[{id:`constructed-${requests.length}`,type:'function',function:{
            name:initial?'read_wiselink_review_sources':'return_wiselink_review_candidate',arguments:JSON.stringify(
              initial?{sourceRefIds:[evidence.evidenceRef]}:{answer:'Keep the actual approved qualification.',
                sourceRefs:[],jobAidWorkingDelta:delta()})}}]}}]});
      };
      try {
        driverResult=await runHostedReviewTurn({workItemId:WI,reviewConversationRef:RC,requestId:'request-review',checkpointDir},
          {callTool,hasTool:()=>true,modelRuntime:runtime,requestGateway,
            invokeModel:(input,hooks)=>invokeHostedReviewModel(input,{...runtime,...hooks},{requestGateway})});
        assert.equal(driverResult.ok,true);assert.equal(reads,1);assert.equal(requests.length,2);
        assert.deepEqual(first.task,sealed);
        const model=JSON.stringify(requests);
        for(const secret of [first.attemptRef,first.task.actionAttemptId,first.leaseToken,WI,RC,first.task.modelInput.reviewTurnRef])
          assert.equal(model.includes(secret),false,secret);
        const feedback=JSON.parse(requests[1].messages.find(message=>message.role==='tool').content).sourceRefs[0];
        assert.equal(feedback.excerpt,packet.evidence[0].excerpt);
        assert.equal(Object.hasOwn(feedback.nativeReadReceipt,'taskContextRef'),false);
        assert.equal(packet.evidence[0].nativeReadReceipt.taskContextRef,first.attemptRef);
      } finally {await rm(checkpointDir,{recursive:true,force:true});}
      const [turn]=await admin`SELECT result_provenance_json FROM review_turn WHERE request_id='request-review'`;
      const update=JSON.parse(turn.result_provenance_json).jobAidWorkingUpdate;savedRef=update.workRevisionRef;
      assert.equal(update.status,'APPLIED');assert.ok(update.readSourceRefs.includes(evidence.evidenceRef));
      const read=await hosted(()=>work.readByRefForRuntime({tenantId:'tenant-a',actorUserId:'user-a',workItemId:WI,workRevisionRef:savedRef}));
      const carrier=read.content.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD');
      assert.deepEqual(carrier.nativeReadReceipt,packet.nativeReadReceipts[0]);assert.equal(carrier.nativeReadReceipt.taskContextRef,first.attemptRef);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,2);
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,2);
      const [row]=await admin`SELECT review_activity_json,task_envelope_json FROM action_attempt WHERE operation_ref=${first.attemptRef}`;
      const journal=JSON.parse(row.review_activity_json);assert.equal(journal.filter(o=>o.kind==='ASSESSMENT_SOURCES_READ').length,1);
      const actualRead=journal.find(o=>o.kind==='ASSESSMENT_SOURCES_READ');
      assert.deepEqual(actualRead.nativeReadReceipts,packet.nativeReadReceipts);
      assert.deepEqual(actualRead.nativeEvidence,packet.evidence);
      for(const item of packet.evidence) {
        assert.deepEqual(parseAssessmentTdmsEvidence(item),item);
        assert.equal(Object.hasOwn(item,'locator'),false);
      }
      assert.deepEqual(JSON.parse(row.task_envelope_json),first.task);
    });
    await t.test('UNCHANGED may keep a fresh READ audit while preserving the exact first saved carrier and work version',async()=>{
      await newTurn('request-unchanged');
      const next=await hosted(()=>review.begin(RC,'request-unchanged',WI));
      validateReviewTask(next.task.modelInput);
      const old=next.task.modelInput.jobAidContext.sourceCatalog.find(item=>item.kind==='TDMS_NATIVE_RECORD');
      assert.deepEqual(old.nativeReadReceipt,packet.nativeReadReceipts[0]);
      const second=await readNative(next);
      assert.notEqual(second.nativeReadReceipts[0].receiptRef,packet.nativeReadReceipts[0].receiptRef);
      const finish=await commit(next,result(next,null));
      assert.equal(finish.assistantCandidate.jobAidWorkingUpdate.status,'UNCHANGED');
      assert.equal(finish.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,savedRef);
      assert.ok(finish.assistantCandidate.jobAidWorkingUpdate.readSourceRefs.includes(evidence.evidenceRef));
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,2);
      const current=await hosted(()=>work.readByRefForRuntime({tenantId:'tenant-a',actorUserId:'user-a',workItemId:WI,workRevisionRef:savedRef}));
      assert.deepEqual(current.content.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD').nativeReadReceipt,packet.nativeReadReceipts[0]);
    });
    await t.test('actual browser, summary and Review activity consumers read the same saved work without native body/control fields in status',async()=>{
      const read=await browser(()=>jobAid.readBrowser(WI,browserActor));
      assert.equal(read.current.workRevisionRef,savedRef);assert.equal(read.current.actionAttemptId,first.task.actionAttemptId);
      assert.equal(read.latestAttempt.attemptId,'attempt-original');
      assert.deepEqual(read.current.content.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD').nativeReadReceipt,packet.nativeReadReceipts[0]);
      const summaries=new DerivedSummaryMembersService(jobAid,actors,{readDocumentOriginal:async()=>copy(originalLoaded)},native);
      const owner={tenantId:'tenant-a',actorUserId:'user-a',readScope:'TENANT'};
      const [member]=await browser(()=>database.transaction(database=>summaries.withNativeTransaction(owner,database,
        {kind:'BROWSER',actor:browserActor},()=>summaries.readAll([{kind:'WORK_ITEM_WORK',workItemId:WI,
          documentVersionId:binding.documentVersionId,workRef:savedRef,workRevision:2,issueKeys:[]}],owner,database))));
      assert.deepEqual(member.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD').nativeReadReceipt,packet.nativeReadReceipts[0]);
      const scope=await hosted(()=>reviews.loadOpenClawTurnByIdBinding({reviewConversationId:RC,reviewTurnId:first.task.modelInput.reviewTurnRef,
        tenantId:'tenant-a',actorId:'user-a',workItemId:WI}));
      const input={tenantId:'tenant-a',actorId:'user-a',workItemId:WI,reviewConversationId:RC,
        reviewTurnId:scope.turn.reviewTurnId,inputRevision:1,createdAt:scope.turn.createdAt,executionRequested:true};
      const status=await hosted(()=>dispatch.executionProjection(input));
      assert.equal(status.status,'SUCCEEDED');assert.equal(status.evidenceActivity.error,null);
      assert.ok(status.evidenceActivity.items.some(item=>item.kind==='ASSESSMENT_SOURCES_READ'&&item.sourceRefIds.includes(evidence.evidenceRef)));
      const thin=await hosted(()=>dispatch.readExecution(input,true));
      assert.equal(thin.taskEnvelopeJson,null);assert.equal(thin.resultEnvelopeJson,null);
      assert.equal(thin.reviewActivityJson.includes(packet.evidence[0].excerpt),false);
      assert.equal(thin.reviewActivityJson.includes(packet.nativeReadReceipts[0].receiptRef),false);
    });
    await t.test('bounded status denies revoked Source or missing provider before loading its native journal/result',async()=>{
      await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;queries.length=0;
      try {
        await assert.rejects(hosted(()=>attemptStatus.status(first.attemptRef,WI)),/TDMS_/);
        assert.equal(queries.some(q=>loadsAttemptBody(q)),false);
      } finally {await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
      const absent=new CanonicalHostOpenClawAttemptStatusService(attempts,authority);
      queries.length=0;
      await assert.rejects(hosted(()=>absent.status(first.attemptRef,WI)),/TDMS_REVIEW_ADMISSION_NOT_CONNECTED/);
      assert.equal(queries.some(q=>loadsAttemptBody(q)),false);
      assert.equal((await hosted(()=>attemptStatus.status(first.attemptRef,WI))).status,'SUCCEEDED');
    });
    await t.test('real heartbeat and idempotent cancel use finite control fields even with omitted WorkItem and revoked Source',async sub=>{
      await newTurn('request-control');const control=await hosted(()=>review.begin(RC,'request-control',WI));sub.after(()=>cancelIfActive(control));
      const call=(name,input)=>hosted(()=>registered.get(name).handler(input));
      const heartbeat={attemptRef:control.attemptRef,leaseToken:control.leaseToken,leaseGeneration:control.leaseGeneration};
      queries.length=0;
      await call('heartbeat_action_attempt',heartbeat);
      assert.equal(queries.some(loadsAttemptBody),false);
      await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;queries.length=0;
      try {
        const reason='Cancel exact local control scenario';
        for(let i=0;i<2;i++) {
          const response=await call('cancel_action_attempt',{attemptRef:control.attemptRef,reason});
          assert.equal(JSON.parse(response.content[0].text).status,'CANCELLED');
        }
        await assert.rejects(call('heartbeat_action_attempt',heartbeat),/ACTION_ATTEMPT_/);
        assert.equal(queries.some(loadsAttemptBody),false);
      } finally {await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
      const [sealed]=await admin`SELECT status FROM action_attempt WHERE operation_ref=${control.attemptRef}`;
      assert.equal(sealed.status,'CANCELLED');
    });
    await t.test('revocation between committed immutable READ and journal prevents carrier release and creates no journal',async sub=>{
      await newTurn('request-read-revoke');const next=await hosted(()=>review.begin(RC,'request-read-revoke',WI));
      sub.after(()=>cancelIfActive(next));
      const before=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
      const originalRecord=work.recordSourceRead.bind(work);let observed;
      work.recordSourceRead=async input=>{observed=copy(input.nativeEvidence);
        await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
        return originalRecord(input);};
      try {await assert.rejects(readNative(next),/TDMS_/);}
      finally {work.recordSourceRead=originalRecord;await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
      assert.equal(observed.length,1);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,before+1);
      const journal=JSON.parse((await admin`SELECT review_activity_json FROM action_attempt WHERE operation_ref=${next.attemptRef}`)[0].review_activity_json??'[]');
      assert.equal(journal.some(item=>item.kind==='ASSESSMENT_SOURCES_READ'),false);
      await cancel(next);
    });
    await t.test('ordinary READ winning before cutoff causes an explicit snapshot conflict and preserves the unsealed candidate',async sub=>{
      const parsed={schemaVersion:'wiselink.3_1.review_attachment_parse.v1.c7',attachmentRef:'ATTACHMENT-cutoff',workItemId:WI,
        reviewConversationId:RC,documentVersionId:'DV-attachment',fileName:'constructed-note.pdf',mediaType:'application/pdf',
        byteLength:40,pageCount:1,pages:[{page:1,text:'Constructed note, no operational confirmation.'}]};
      const parsedArtifact=(await artifacts.persistAndReadback(new TextEncoder().encode(JSON.stringify(parsed)))).artifact;
      await newTurn('request-read-first',undefined,[{attachmentRef:parsed.attachmentRef,documentVersionId:parsed.documentVersionId,
        fileName:parsed.fileName,mediaType:parsed.mediaType,byteLength:parsed.byteLength,selectionKey:'fixture/note.pdf',parsedArtifact}]);
      const next=await hosted(()=>review.begin(RC,'request-read-first',WI));sub.after(()=>cancelIfActive(next));
      const resource=next.task.modelInput.resourceRefs[0]?.sourceRefId;assert.ok(resource);
      const envelope=result(next,null),prepare=attempts.prepareCommit.bind(attempts);let entered=false;
      attempts.prepareCommit=async input=>{
        if(!entered){entered=true;await hosted(()=>review.readSourceRefs(next.attemptRef,[resource],WI));}
        return prepare(input);
      };
      try {await assert.rejects(commit(next,envelope),/ACTION_ATTEMPT_COMMIT_CUTOFF_LOST/);}
      finally {attempts.prepareCommit=prepare;}
      const [row]=await admin`SELECT status,result_envelope_json,review_activity_json FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      assert.equal(row.status,'RUNNING');assert.equal(row.result_envelope_json,null);
      assert.ok(JSON.parse(row.review_activity_json).some(item=>item.kind==='SOURCE_REFS_RESOLVED'&&item.sourceRefIds.includes(resource)));
      assert.equal(envelope.modelOutput,result(next,null).modelOutput);
      await cancel(next);
    });
    await t.test('cutoff winning after a native READ audit rejects its late journal and all late ordinary activity',async sub=>{
      await newTurn('request-seal-first');const next=await hosted(()=>review.begin(RC,'request-seal-first',WI));
      sub.after(()=>cancelIfActive(next));
      const before=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
      const oldRow=await hosted(()=>attempts.readScoped({attemptRef:next.attemptRef,tenantId:'tenant-a',workItemId:WI}));
      const atJournal=deferred(),release=deferred(),record=work.recordSourceRead.bind(work);let observed;
      work.recordSourceRead=async input=>{observed=copy(input.nativeEvidence);atJournal.resolve();await release.promise;return record(input);};
      const late=readNative(next).then(value=>({value}),error=>({error}));
      await atJournal.promise;
      let finish;
      try {finish=await commit(next,result(next,null));}
      finally {release.resolve();work.recordSourceRead=record;}
      const read=await late;assert.ok(read.error);assert.equal(read.value,undefined);
      assert.equal(finish.status,'SUCCEEDED');assert.equal(finish.assistantCandidate.jobAidWorkingUpdate.status,'UNCHANGED');
      assert.equal(finish.assistantCandidate.jobAidWorkingUpdate.readSourceRefs.includes(evidence.evidenceRef),false);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,before+1);
      const [row]=await admin`SELECT review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      assert.equal(JSON.parse(row.review_activity_json??'[]').some(item=>item.kind==='ASSESSMENT_SOURCES_READ'),false);
      await assert.rejects(hosted(()=>dispatch.recordEvidenceActivity(oldRow,{kind:'SOURCE_REFS_RESOLVED',
        sourceRefIds:['late-ordinary'],sourceCatalogCount:1})),/REVIEW_ACTIVITY_BINDING_CHANGED/);
      await assert.rejects(readNative(next),/TDMS_|REVIEW_/);
      const scope=await hosted(()=>authority.authorizeOpenClawAttempt({operation:'GET_REVIEW_CONTEXT',attemptRef:next.attemptRef,workItemId:WI}));
      const caller=await hosted(()=>native.admitReview({scope,attemptRef:next.attemptRef}));
      await assert.rejects(hosted(()=>native.verifyEvidence({scope,actorUserId:'user-a',reviewCaller:caller},observed)),/TDMS_RUNTIME_SAVED_RECEIPT_MISMATCH/);
      assert.deepEqual((await admin`SELECT review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${next.attemptRef}`)[0],row);
    });
    await t.test('a revoked then newly authorized grant does not rewrite or reuse this attempt original receipt permission revision',async()=>{
      const original=copy(packet),before=(await admin`SELECT revision FROM tdms_source_receiver_grant`)[0].revision;
      const count=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
      const [journal]=await admin`SELECT review_activity_json FROM action_attempt WHERE operation_ref=${first.attemptRef}`;
      const carriers=resolvedTdmsReadCarriers(journal.review_activity_json);
      assert.equal(carriers.length,1);assert.deepEqual(carriers[0].nativeReadReceipt,original.nativeReadReceipts[0]);
      const scope=await hosted(()=>authority.authorizeOpenClawAttempt({operation:'GET_REVIEW_CONTEXT',attemptRef:first.attemptRef,workItemId:WI}));
      let restored=false;
      await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;
      try {
        await assert.rejects(hosted(()=>native.admitReview({scope,attemptRef:first.attemptRef})),/TDMS_/);
        await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;restored=true;
        assert.equal((await admin`SELECT revision FROM tdms_source_receiver_grant`)[0].revision,before+2);
        const caller=await hosted(()=>native.admitReview({scope,attemptRef:first.attemptRef}));
        await assert.rejects(hosted(()=>native.verifyEvidence({scope,actorUserId:'user-a',reviewCaller:caller},
          carriers)),/TDMS_RUNTIME_RECEIPT_BINDING_MISMATCH/);
        assert.deepEqual(packet,original);
        assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,count);
        assert.deepEqual((await admin`SELECT review_activity_json FROM action_attempt WHERE operation_ref=${first.attemptRef}`)[0],journal);
      } finally {if(!restored)await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
    });
    await t.test('expired COMMITTING UNCHANGED persists only its sealed original read snapshot without another work version',async()=>{
      await newTurn('request-unchanged-expired');
      const next=await hosted(()=>review.begin(RC,'request-unchanged-expired',WI));
      await readNative(next);const envelope=result(next,null);
      const before=(await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n;
      const persist=reviews.persistOpenClawAssistantCandidate.bind(reviews);
      reviews.persistOpenClawAssistantCandidate=async(...args)=>{await persist(...args);throw new Error('ROLLBACK_UNCHANGED_RECEIPT');};
      try {await assert.rejects(commit(next,envelope),/ROLLBACK_UNCHANGED_RECEIPT/);}
      finally {reviews.persistOpenClawAssistantCandidate=persist;}
      await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second',deadline_at=now()-interval '1 second' WHERE operation_ref=${next.attemptRef}`;
      const [expired]=await admin`SELECT lease_expires_at,deadline_at,lease_token,lease_generation,review_activity_json FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      const reads=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
      const resumed=await hosted(()=>review.begin(RC,'request-unchanged-expired',WI));
      assert.equal(resumed.status,'COMMITTING');assert.deepEqual(resumed.recoveryResult,envelope);
      const finished=await commit(next,resumed.recoveryResult);
      assert.equal(finished.assistantCandidate.jobAidWorkingUpdate.status,'UNCHANGED');
      assert.equal(finished.assistantCandidate.jobAidWorkingUpdate.workRevisionRef,savedRef);
      assert.ok(finished.assistantCandidate.jobAidWorkingUpdate.readSourceRefs.includes(evidence.evidenceRef));
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,before);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,reads);
      const [after]=await admin`SELECT deadline_at,lease_generation,review_activity_json FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      assert.deepEqual(after,{deadline_at:expired.deadline_at,lease_generation:expired.lease_generation,review_activity_json:expired.review_activity_json});
    });
    await t.test('expired COMMITTING Review recovers only its sealed native decision after atomic rollback, without renewing its lease or READ',async()=>{
      await newTurn('request-recovery');const next=await hosted(()=>review.begin(RC,'request-recovery',WI));
      const fresh=await readNative(next),proposal=delta();proposal.headline='Reconsidered exact conditional judgment';
      const envelope=result(next,proposal),persist=reviews.persistOpenClawAssistantCandidate.bind(reviews);
      const [running]=await admin`SELECT lease_expires_at,deadline_at FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      const count=(await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n;
      reviews.persistOpenClawAssistantCandidate=async(...args)=>{await persist(...args);throw new Error('ROLLBACK_FRESH_REVIEW_RECEIPT');};
      try {await assert.rejects(commit(next,envelope),/ROLLBACK_FRESH_REVIEW_RECEIPT/);}
      finally {reviews.persistOpenClawAssistantCandidate=persist;}
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,count);
      assert.equal((await admin`SELECT result_content_hash FROM review_turn WHERE request_id='request-recovery'`)[0].result_content_hash,null);
      assert.equal((await admin`SELECT status FROM action_attempt WHERE operation_ref=${next.attemptRef}`)[0].status,'COMMITTING');
      const [cutoff]=await admin`SELECT lease_expires_at FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      assert.equal(new Date(cutoff.lease_expires_at).getTime(),Math.min(new Date(running.lease_expires_at).getTime(),new Date(running.deadline_at).getTime()));
      await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second',deadline_at=now()-interval '1 second' WHERE operation_ref=${next.attemptRef}`;
      const [expired]=await admin`SELECT lease_expires_at,deadline_at,lease_token,lease_generation,review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${next.attemptRef}`;
      const changed=result(next,{...proposal,headline:'Different candidate must not replace the sealed payload'});
      await assert.rejects(commit(next,changed),/RESULT_ENVELOPE_REPLAY_MISMATCH/);
      queries.length=0;
      const pending=JSON.parse((await hosted(()=>registered.get('get_pending_review_turn').handler({workItemId:WI}))).content[0].text);
      assert.equal(pending.next.requestId,'request-recovery');assert.equal(queries.some(loadsAttemptBody),false);
      const resumed=await hosted(()=>review.begin(RC,'request-recovery',WI));
      assert.equal(resumed.status,'COMMITTING');assert.deepEqual(resumed.recoveryResult,envelope);
      assert.equal(resumed.leaseToken,next.leaseToken);assert.equal(resumed.leaseGeneration,next.leaseGeneration);
      assert.equal(new Date(resumed.leaseExpiresAt).getTime(),new Date(expired.lease_expires_at).getTime());
      const scope=await hosted(()=>authority.authorizeOpenClawAttempt({operation:'GET_REVIEW_CONTEXT',attemptRef:next.attemptRef,workItemId:WI}));
      const caller=await hosted(()=>native.admitReview({scope,attemptRef:next.attemptRef}));
      assert.equal(tdmsReviewBinding(caller).attempt.phase,'SEALED_RECOVERY');
      await assert.rejects(hosted(()=>native.discover({scope,actorUserId:'user-a',reviewCaller:caller},
        next.task.modelInput.jobAidContext.tdmsReviewContext.runtimeContext.binding)),/TDMS_RUNTIME_EXECUTION_REQUIRED/);
      const status=await hosted(()=>attemptStatus.status(next.attemptRef,WI));
      assert.equal(status.recoveryAvailable,true);assert.deepEqual(status.recoveryResult,envelope);
      const reads=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
      await assert.rejects(readNative(next),/REVIEW_NATIVE_READ_INVALID/);
      const terminalize=attempts.finishCandidatePersistenceSuccess.bind(attempts);
      attempts.finishCandidatePersistenceSuccess=async()=>{throw new Error('LOST_FRESH_REVIEW_TERMINAL_RESPONSE');};
      try {await assert.rejects(commit(next,envelope),/LOST_FRESH_REVIEW_TERMINAL_RESPONSE/);}
      finally {attempts.finishCandidatePersistenceSuccess=terminalize;}
      assert.deepEqual((await admin`SELECT lease_expires_at,deadline_at,lease_token,lease_generation,review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${next.attemptRef}`)[0],expired);
      queries.length=0;
      const completedPending=JSON.parse((await hosted(()=>registered.get('get_pending_review_turn').handler({workItemId:WI}))).content[0].text);
      assert.equal(completedPending.next.requestId,'request-recovery');assert.equal(queries.some(loadsAttemptBody),false);
      const completedBegin=await hosted(()=>review.begin(RC,'request-recovery',WI));
      assert.equal(completedBegin.status,'COMMITTING');assert.deepEqual(completedBegin.recoveryResult,envelope);
      assert.equal(completedBegin.attemptRef,next.attemptRef);assert.equal(completedBegin.leaseToken,next.leaseToken);
      const finish=await commit(next,envelope);
      assert.equal(finish.status,'SUCCEEDED');assert.equal(finish.replayed,true);
      assert.equal(finish.assistantCandidate.jobAidWorkingUpdate.status,'APPLIED');
      savedRef=finish.assistantCandidate.jobAidWorkingUpdate.workRevisionRef;first=next;
      assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,count+1);
      assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,reads);
      const current=await hosted(()=>work.readByRefForRuntime({tenantId:'tenant-a',actorUserId:'user-a',workItemId:WI,workRevisionRef:savedRef}));
      // Same body retains the original saved carrier; the recovery's independent
      // fresh receipt remains immutable in this attempt's exact sealed journal.
      assert.deepEqual(current.content.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD').nativeReadReceipt,packet.nativeReadReceipts[0]);
      assert.notEqual(fresh.nativeReadReceipts[0].receiptRef,packet.nativeReadReceipts[0].receiptRef);
    });
    await t.test('normal Native consume resumes the same checkpoint after isolated expiry, rollback and a lost terminal response without another model or READ',async()=>{
      const request='request-native-checkpoint-recovery';await newTurn(request);
      const checkpointRoot=await mkdtemp(join(process.cwd(),'tmp/review-native-read-evidence/native-consume-checkpoint-'));
      const options={workItemId:WI,checkpointRoot},calls=[],gatewayRequests=[],results=[];
      const workCount=(await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n;
      const readCount=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
      let begin,modelInvocations=0;
      const runtime={gatewayChatCompletionsEnabled:true,gatewayUrl:'https://constructed.invalid',gatewayToken:'fixture-only',
        configuredModelVersion:'constructed-no-model',registeredModelRefs:[first.task.executionModel.modelRef]};
      const requestGateway=async(_url,init)=>{
        gatewayRequests.push(JSON.parse(init.body));const initial=gatewayRequests.length===1;
        const proposal=delta();proposal.headline='Exact checkpoint recovery retains the original conditional judgment';
        return Response.json({model:'constructed-no-model',choices:[{finish_reason:'tool_calls',message:{content:null,
          tool_calls:[{id:`checkpoint-${gatewayRequests.length}`,type:'function',function:{
            name:initial?'read_wiselink_review_sources':'return_wiselink_review_candidate',
            arguments:JSON.stringify(initial?{sourceRefIds:[evidence.evidenceRef]}:{answer:'Retain the original qualification and all unknowns.',
              sourceRefs:[],jobAidWorkingDelta:proposal})}}]}}]});
      };
      const dependencies={hasTool:name=>registered.has(name),callTool:async(name,args)=>{
        const entry={name,args:copy(args)};calls.push(entry);
        try {
          const response=await hosted(()=>registered.get(name).handler(args));
          const value=JSON.parse(response.content[0].text);entry.value=copy(value);
          if(name==='begin_review_turn')begin??=copy(value);
          return value;
        } catch(error) {entry.error=String(error);throw error;}
      },invokeModel:(input,hooks)=>{modelInvocations++;
        return invokeHostedReviewModel(input,{...runtime,...hooks},{requestGateway});}};
      const persist=reviews.persistOpenClawAssistantCandidate.bind(reviews);
      const terminalize=attempts.finishCandidatePersistenceSuccess.bind(attempts);
      const readFields=()=>admin`SELECT lease_expires_at,deadline_at,lease_token,lease_generation,
        review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${begin.attemptRef}`;
      try {
        reviews.persistOpenClawAssistantCandidate=async(...args)=>{await persist(...args);throw new Error('NATIVE_CONSUMER_ATOMIC_ROLLBACK');};
        const original=await consumePendingReviewTurn(options,dependencies);results.push(original);
        reviews.persistOpenClawAssistantCandidate=persist;
        assert.equal(original.status,'REQUIRES_ATTENTION');assert.equal(original.result?.ok,false,JSON.stringify(original));
        assert.equal(original.result.outcome,'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
        assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,workCount);
        assert.equal((await admin`SELECT result_content_hash FROM review_turn WHERE request_id=${request}`)[0].result_content_hash,null);
        const dir=join(checkpointRoot,encodeURIComponent(begin.task.modelInput.reviewTurnRef));
        const originalFiles=new Map(await Promise.all((await readdir(dir)).map(async name=>[name,await readFile(join(dir,name))])));
        await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second',deadline_at=now()-interval '1 second'
          WHERE operation_ref=${begin.attemptRef}`;
        const [expired]=await readFields();
        assert.ok(new Date(expired.lease_expires_at).getTime()<Date.now());
        assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,readCount+1);
        const beforeRecovery=calls.length;
        attempts.finishCandidatePersistenceSuccess=async()=>{throw new Error('NATIVE_CONSUMER_LOST_TERMINAL_RESPONSE');};
        const landed=await consumePendingReviewTurn(options,dependencies);results.push(landed);
        attempts.finishCandidatePersistenceSuccess=terminalize;
        assert.equal(landed.status,'REQUIRES_ATTENTION');assert.equal(landed.result.ok,false);
        assert.equal(landed.result.outcome,'COMMITTING_RECOVERY_READ_ONLY');
        assert.deepEqual((await readFields())[0],expired);
        assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,workCount+1);
        assert.equal((await admin`SELECT result_content_hash FROM review_turn WHERE request_id=${request}`)[0].result_content_hash,expired.result_content_hash);
        const nextTrigger=calls.length;
        const finished=await consumePendingReviewTurn(options,dependencies);results.push(finished);
        assert.equal(finished.status,'CANDIDATE_SAVED');assert.equal(finished.result.ok,true);
        assert.equal(finished.result.jobAidWorkingUpdate.status,'APPLIED');
        assert.ok(finished.result.jobAidWorkingUpdate.readSourceRefs.includes(evidence.evidenceRef));
        const expectedCalls=['get_pending_review_turn','begin_review_turn','get_action_attempt_status',
          'commit_review_turn_candidate','get_action_attempt_status'];
        assert.deepEqual(calls.slice(beforeRecovery,nextTrigger).map(item=>item.name),expectedCalls);
        assert.deepEqual(calls.slice(nextTrigger).map(item=>item.name),expectedCalls);
        const commitCalls=calls.filter(item=>item.name==='commit_review_turn_candidate');
        assert.equal(commitCalls.length,3);
        for(const item of commitCalls)assert.equal(item.args.resultJson,commitCalls[0].args.resultJson);
        assert.equal(JSON.parse(commitCalls[0].args.resultJson).contentHash,expired.result_content_hash);
        assert.equal(modelInvocations,1);assert.equal(gatewayRequests.length,2);
        assert.equal(calls.filter(item=>item.name==='read_review_native_sources').length,1);
        assert.equal(calls.slice(beforeRecovery).some(item=>['get_review_turn_context','read_source_refs',
          'read_review_native_sources','heartbeat_action_attempt','cancel_action_attempt'].includes(item.name)),false);
        assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,readCount+1);
        assert.equal((await admin`SELECT count(*)::int AS n FROM assessment_work_revision`)[0].n,workCount+1);
        const [terminal]=await readFields();
        assert.equal(terminal.lease_expires_at,null);assert.equal(terminal.lease_token,null);
        assert.deepEqual({deadline_at:terminal.deadline_at,lease_generation:terminal.lease_generation,
          review_activity_json:terminal.review_activity_json,result_content_hash:terminal.result_content_hash},
        {deadline_at:expired.deadline_at,lease_generation:expired.lease_generation,
          review_activity_json:expired.review_activity_json,result_content_hash:expired.result_content_hash});
        for(const [name,bytes] of originalFiles)assert.deepEqual(await readFile(join(dir,name)),bytes,name);
        const idle=await consumePendingReviewTurn(options,dependencies);results.push(idle);assert.equal(idle.status,'IDLE');
        assert.equal(modelInvocations,1);assert.equal(gatewayRequests.length,2);
        savedRef=finished.result.jobAidWorkingUpdate.workRevisionRef;first=begin;
        await writeFile(join(checkpointRoot,'integration-result.json'),JSON.stringify({nativeScripts:String(nativeScripts),
          expiryMethod:'Owned fixture administrator set existing lease/deadline past; no wait for original TTL is claimed.',
          results,calls,modelInvocations,gatewayRequests:gatewayRequests.length,
          originalCheckpointFiles:[...originalFiles].map(([name,bytes])=>({name,bytes:bytes.length,
            sha256:createHash('sha256').update(bytes).digest('hex')})),expired,terminal},null,2));
      } finally {
        reviews.persistOpenClawAssistantCandidate=persist;attempts.finishCandidatePersistenceSuccess=terminalize;
        await writeFile(join(checkpointRoot,'attempt-trace.json'),JSON.stringify({nativeScripts:String(nativeScripts),
          results,calls,modelInvocations,gatewayRequests:gatewayRequests.length},null,2));
      }
    });
    await t.test('exact APPLIED successor owns a new Overall lease, historical Review receipt and bounded READ; ordinary SAVE remains denied',async()=>{
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
      const provider=new TdmsProductionRuntimeReader(database,dynamic,work,{current:()=>({tenantId:'tenant-a',clientId:'cli_aadde8b579f95bc9'})},objectAccess);
      const consumer=new CanonicalJobAidProblemService(registrar,artifacts,dynamic,
        {authorize:async({action})=>({allowed:true,action,permissionSnapshotVersion:'fixture'})},
        {freshRead:async()=>({permissionSnapshotVersion:'fixture'})},attempts,workItems,reviews,common,work,undefined,
        {readDocumentOriginal:async()=>copy(originalLoaded)},{read:async()=>null},database,undefined,objectAccess,provider,provider);
      const overall=new CanonicalHostOpenClawOverallService(registrar,artifacts,workItems,{}, {},{},attempts,dynamic,common,consumer);
      const successorStatus=new CanonicalHostOpenClawAttemptStatusService(attempts,dynamic,provider);
      try {
        const turnRef=first.task.modelInput.reviewTurnRef;
        const scope=await hosted(()=>dynamic.authorizeOpenClawWorkItem({operation:'BEGIN_OVERALL',workItemId:WI,successorReviewTurnRef:turnRef}));
        await assert.rejects(dynamic.assertOpenClawWorkItemTransport(scope),/CANONICAL_WORK_ITEM_NOT_FOUND/);
        await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;queries.length=0;
        try {await assert.rejects(hosted(()=>consumer.beginSuccessorOverall(WI,scope,turnRef)),/TDMS_/);
          assert.equal(queries.some(q=>q.includes('SELECT "assessment_work_revision_id",')||q.includes('"review_activity_json"')),false);
        } finally {await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
        const begin=await hosted(()=>consumer.beginSuccessorOverall(WI,scope,turnRef));
        assert.notEqual(begin.attemptRef,first.attemptRef);assert.notEqual(begin.leaseToken,first.leaseToken);
        assert.equal(begin.task.modelInput.previousWork.workRevisionRef,savedRef);
        assert.equal(begin.task.modelInput.tdmsContext.binding.taskContextRef,begin.attemptRef);
        assert.equal(begin.task.modelInput.automaticWorkItemLease,undefined);
        const read=await hosted(()=>consumer.readSources({attemptRef:begin.attemptRef,workItemId:WI,leaseToken:begin.leaseToken,
          leaseGeneration:begin.leaseGeneration,sourceRefs:[evidence.evidenceRef],purpose:'Successor independent source read',context:'EXACT'}));
        assert.equal(read.nativeReadReceipts[0].taskContextRef,begin.attemptRef);
        await assert.rejects(hosted(()=>consumer.saveWork({attemptRef:begin.attemptRef,workItemId:WI,leaseToken:begin.leaseToken,
          leaseGeneration:begin.leaseGeneration,requestId:'forbidden-successor-save',expectedWorkRevision:2,workJson:JSON.stringify(delta())})),/JOBAID_SUCCESSOR_OVERALL_EXACT_WORK_READ_ONLY/);
        const exact=await hosted(()=>consumer.readAttemptWork(begin.attemptRef,undefined,WI));
        assert.equal(exact.revision.workRevisionRef,savedRef);
        assert.deepEqual(exact.revision.content.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD').nativeReadReceipt,packet.nativeReadReceipts[0]);
        const wrong=await hosted(()=>dynamic.authorizeOpenClawAttempt({operation:'READ_ASSESSMENT_SOURCES',attemptRef:begin.attemptRef,workItemId:WI}));
        const caller=await hosted(()=>provider.admitReview({scope:wrong,attemptRef:begin.attemptRef,
          reviewConversationRef:RC,requestId:wrong.successorReviewDelegation.requestId,successorOverall:{reviewTurnRef:turnRef}}));
        assert.equal(tdmsReviewBinding(caller).kind,'SUCCESSOR_OVERALL');
        await admin`UPDATE action_attempt SET lease_token=${randomUUID()} WHERE operation_ref=${begin.attemptRef}`;
        await assert.rejects(hosted(()=>provider.assertAuthorized({scope:wrong,actorUserId:'user-a',reviewCaller:caller},
          begin.task.modelInput.tdmsContext)),/TDMS_/);
        await admin`UPDATE action_attempt SET lease_token=${begin.leaseToken} WHERE operation_ref=${begin.attemptRef}`;
        const envelope=sealResultEnvelope({schemaVersion:'wiselink.3_1.openclaw_result_envelope.v1',
          actionAttemptId:begin.task.actionAttemptId,operationRef:begin.attemptRef,taskType:begin.task.taskType,workItemId:WI,
          baseRevision:begin.task.baseRevision,status:'SUCCEEDED',businessOutcome:'CANDIDATE_READY',candidateStatus:null,
          modelOutput:JSON.stringify({workRevisionRef:savedRef,consistencyCheck:'Keep the exact conditional native work and its unknowns.'}),
          outputArtifactRefs:[],sourceRefs:[],factsConsidered:[],missingInputs:[],conflicts:[],warnings:[],
          modelVersion:'constructed-offline-no-model',promptVersion:'wiselink-jobaid-problem@v2',
          skillVersion:'wiselink-research-and-synthesize@r09.c235',toolVersions:{'wiselink-openclaw-engineering-assessment':'1.2.0',
            'jobaid-problem-protocol':'2','tdms-native-context':'1'},runMetrics:{durationMs:0,inputUnits:0,outputUnits:0},errorCode:null,errorDetail:null});
        const beforeRecoveryReads=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
        const applyProjection=registrar.compareAndSet;
        registrar.compareAndSet=async()=>{throw new Error('ROLLBACK_SUCCESSOR_BEFORE_CAS');};
        try {await assert.rejects(hosted(()=>overall.commit(begin.attemptRef,begin.leaseToken,begin.leaseGeneration,envelope,WI)),/ROLLBACK_SUCCESSOR_BEFORE_CAS/);}
        finally {registrar.compareAndSet=applyProjection;}
        await admin`UPDATE action_attempt SET lease_expires_at=now()-interval '1 second',deadline_at=now()-interval '1 second' WHERE operation_ref=${begin.attemptRef}`;
        const [expired]=await admin`SELECT lease_expires_at,deadline_at,lease_token,lease_generation,review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${begin.attemptRef}`;
        const recoveryScope=await hosted(()=>dynamic.authorizeOpenClawWorkItem({operation:'BEGIN_OVERALL',workItemId:WI,successorReviewTurnRef:turnRef}));
        const beforeCas=await hosted(()=>consumer.beginSuccessorOverall(WI,recoveryScope,turnRef));
        assert.equal(beforeCas.status,'COMMITTING');assert.deepEqual(beforeCas.recoveryResult,envelope);
        assert.equal(beforeCas.leaseToken,begin.leaseToken);assert.equal(beforeCas.leaseGeneration,begin.leaseGeneration);
        assert.equal(new Date(beforeCas.leaseExpiresAt).getTime(),new Date(expired.lease_expires_at).getTime());
        await assert.rejects(hosted(()=>consumer.readSources({attemptRef:begin.attemptRef,workItemId:WI,leaseToken:begin.leaseToken,
          leaseGeneration:begin.leaseGeneration,sourceRefs:[evidence.evidenceRef],purpose:'Expired recovery cannot READ',context:'EXACT'})),/TDMS_|JOBAID_|ACTION_/);
        const terminalize=attempts.finishProjectionSuccess.bind(attempts);
        attempts.finishProjectionSuccess=async()=>{throw new Error('LOST_SUCCESSOR_TERMINAL_RESPONSE');};
        try {await assert.rejects(hosted(()=>overall.commit(begin.attemptRef,begin.leaseToken,begin.leaseGeneration,envelope,WI)),/LOST_SUCCESSOR_TERMINAL_RESPONSE/);}
        finally {attempts.finishProjectionSuccess=terminalize;}
        assert.deepEqual((await admin`SELECT lease_expires_at,deadline_at,lease_token,lease_generation,review_activity_json,result_content_hash FROM action_attempt WHERE operation_ref=${begin.attemptRef}`)[0],expired);
        const resumedScope=await hosted(()=>dynamic.authorizeOpenClawWorkItem({operation:'BEGIN_OVERALL',workItemId:WI,successorReviewTurnRef:turnRef}));
        const resumed=await hosted(()=>consumer.beginSuccessorOverall(WI,resumedScope,turnRef));
        assert.equal(resumed.status,'COMMITTING');assert.equal(resumed.attemptRef,begin.attemptRef);
        assert.equal(resumed.leaseToken,begin.leaseToken);assert.equal(resumed.leaseGeneration,begin.leaseGeneration);
        assert.deepEqual(resumed.recoveryResult,envelope);
        const finish=await hosted(()=>overall.commit(begin.attemptRef,begin.leaseToken,begin.leaseGeneration,resumed.recoveryResult,WI));
        assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,beforeRecoveryReads);
        assert.equal(finish.status,'OVERALL_CANDIDATE_READY');assert.equal(finish.workItemRevision,2);
        assert.equal(finish.overallSynthesis.actionAttemptId,begin.task.actionAttemptId);
        assert.equal(finish.overallSynthesis.basedOnJobAidWorkRevisionRef,savedRef);
        assert.deepEqual(finish.overallSynthesis.readingResult.evidence.find(item=>item.kind==='TDMS_NATIVE_RECORD').nativeReadReceipt,
          packet.nativeReadReceipts[0]);
        const replay=await hosted(()=>overall.commit(begin.attemptRef,begin.leaseToken,begin.leaseGeneration,envelope,WI));
        assert.equal(replay.workItemRevision,2);assert.equal(replay.overallSynthesis.actionAttemptId,begin.task.actionAttemptId);
        const currentScope=await hosted(()=>dynamic.authorizeOpenClawAttempt({operation:'GET_ACTION_ATTEMPT_STATUS',
          attemptRef:begin.attemptRef,workItemId:WI}));
        const ingress={scope:currentScope,attemptRef:begin.attemptRef,reviewConversationRef:RC,
          requestId:currentScope.successorReviewDelegation.requestId,successorOverall:{reviewTurnRef:turnRef}};
        const savedCaller=await hosted(()=>provider.admitReview(ingress));
        assert.equal(tdmsReviewBinding(savedCaller).inputRevision,1);
        assert.equal(tdmsReviewBinding(savedCaller).workItemRevision,2);
        assert.equal(tdmsReviewBinding(savedCaller).attempt.phase,'SAVED_VERIFICATION');
        const [currentRow]=await admin`SELECT revision,projection_json FROM work_item WHERE work_item_id=${WI}`;
        await admin`UPDATE work_item SET revision=3 WHERE work_item_id=${WI}`;queries.length=0;
        try {await assert.rejects(hosted(()=>provider.admitReview(ingress)),/TDMS_SUCCESSOR_DELEGATION_REJECTED/);
          assert.equal(queries.some(q=>loadsAttemptBody(q)),false);
        } finally {await admin`UPDATE work_item SET revision=${currentRow.revision} WHERE work_item_id=${WI}`;}
        const foreign=JSON.parse(currentRow.projection_json);foreign.integratedAssessment.overallSynthesis.actionAttemptId='ATT-foreign';
        await admin`UPDATE work_item SET projection_json=${JSON.stringify(foreign)} WHERE work_item_id=${WI}`;queries.length=0;
        try {await assert.rejects(hosted(()=>provider.admitReview(ingress)),/TDMS_SUCCESSOR_DELEGATION_REJECTED/);
          assert.equal(queries.some(q=>loadsAttemptBody(q)),false);
        } finally {await admin`UPDATE work_item SET projection_json=${currentRow.projection_json} WHERE work_item_id=${WI}`;}
        const receiptCount=(await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n;
        await assert.rejects(hosted(()=>consumer.readSources({attemptRef:begin.attemptRef,workItemId:WI,leaseToken:begin.leaseToken,
          leaseGeneration:begin.leaseGeneration,sourceRefs:[evidence.evidenceRef],purpose:'No terminal READ',context:'EXACT'})),/TDMS_|JOBAID_|ACTION_/);
        assert.equal((await admin`SELECT count(*)::int AS n FROM tdms_read_receipt`)[0].n,receiptCount);
        const browserRead=await browser(()=>consumer.readBrowser(WI,browserActor));
        assert.equal(browserRead.current.workRevisionRef,savedRef);assert.equal(browserRead.overallStatus,'CURRENT');
        assert.equal(browserRead.overallBasedOnWorkRevisionRef,savedRef);
        assert.equal((await hosted(()=>successorStatus.status(begin.attemptRef,WI))).status,'SUCCEEDED');
        await admin`UPDATE tdms_source_receiver_grant SET status='REVOKED'`;queries.length=0;
        try {await assert.rejects(hosted(()=>successorStatus.status(begin.attemptRef,WI)),/TDMS_/);
          assert.equal(queries.some(q=>loadsAttemptBody(q)),false);
        } finally {await admin`UPDATE tdms_source_receiver_grant SET status='ACTIVE'`;}
      } finally {for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
    });
  } finally {
    for(const [key,value] of Object.entries(previous)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
    await owned.stop();
  }
});
