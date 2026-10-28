// Uses only the owned random local cluster. The reused fixture DROPs its own
// schema; never supply an existing dev/production URL. No model or HTTP calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';
const require=createRequire(import.meta.url);
const load=path=>require(`../../server/modules/${path}.ts`);
const {CanonicalInitialAttemptControlService}=load('canonical-host/canonical-initial-attempt-control.service');
const {InitialExpiredAttemptRepository}=load('action-attempt/initial-expired-attempt.repository');
const {OrdinaryCanonicalAuthorizationAdapter,OrdinaryCanonicalPermissionSnapshotAdapter}=load('canonical-host/ordinary-canonical-authorization.adapter');
const {SessionResolver}=load('identity/session-resolver.service');
const {CanonicalInitialAnalysisContinuationController}=load('canonical-host/canonical-initial-analysis-continuation.controller');
const {CanonicalHostController}=load('canonical-host/canonical-host.controller');
const {CanonicalInitialAnalysisContinuationService}=load('canonical-host/canonical-initial-analysis-continuation.service');
const {CanonicalHostInitialAnalysisStatusService}=load('canonical-host/canonical-host-initial-analysis-status.service');
const {sql}=require('drizzle-orm');
const {canonicalJson,sealTaskEnvelope}=load('action-attempt/action-attempt-envelope');

const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function tracked(operation) {
  let settled;
  const promise=operation.then(value=>(settled={value}),error=>(settled={error}));
  return {promise,result:()=>settled};
}
async function waiting(f,pid,contender) {
  assert.ok(Number.isSafeInteger(pid),'record the real holding connection PID');
  for(let i=0;i<300;i++) {
    if(contender.result()) {
      const error=contender.result().error;
      // Keep technical denial visible rather than masking it as a lock timeout.
      const code=[error?.code,error?.message,error?.cause?.code]
        .find(value=>typeof value==='string'&&/^[A-Z0-9_]+$/u.test(value));
      assert.fail(`contender ended before the exact row lock: ${code ?? error?.constructor?.name ?? 'completed'}`);
    }
    const rows=await f.sql`SELECT pid,query,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
    const row=rows.find(row=>Number(row.pid)!==pid&&row.blockers.map(Number).includes(pid)&&/work_item[\s\S]*for update/iu.test(row.query));
    if(row)return row;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail('expected exact WorkItem row-lock waiter blocked by the recorded physical transaction');
}
function saveArgs(f,c,key) {return {workItemId:c.task.workItemId,attemptRef:c.attemptRef,leaseToken:c.leaseToken,
  leaseGeneration:c.leaseGeneration,requestId:key,expectedWorkRevision:0,workJson:JSON.stringify(f.proposal(c))};}

test('owned PG exact browser INITIAL timeout, authoritative absence, replay and real SAVE races', {timeout:180000}, async t=>{
  const priorSandbox=process.env.SANDBOX_ID;process.env.SANDBOX_ID='synthetic-owned-pg';
  const f=await startCoreP1HostFixture({browser:true,matter:true});
  try {
    const request={headers:{},userContext:{userId:f.actorUserId,tenantId:f.tenantId,appId:'app_17bzc551rsg',
      roles:[],env:'runtime'}};
    const sessions=new SessionResolver({}, {}, f.sqlContext);
    const peer=await f.openParallelBrowserContext();
    const connection=async database=>(await database.execute(sql`SELECT pg_backend_pid() AS pid,
      session_user AS login,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=session_user`))[0];
    const [saveConnection,controlConnection]=await f.hosted(()=>Promise.all([connection(f.db),connection(peer.db)]));
    assert.notEqual(Number(saveConnection.pid),Number(controlConnection.pid));
    assert.equal(saveConnection.login,controlConnection.login);
    for(const current of [saveConnection,controlConnection]) {
      assert.equal(current.rolsuper,false);assert.equal(current.rolbypassrls,false);
    }
    t.diagnostic(JSON.stringify({kind:'OWNED_PHYSICAL_CONNECTIONS',savePid:Number(saveConnection.pid),
      controlPid:Number(controlConnection.pid),sameSessionUser:saveConnection.login===controlConnection.login,
      nonSuperuser:true,nonBypassRls:true}));
    const service=new CanonicalInitialAttemptControlService(peer.db,new OrdinaryCanonicalAuthorizationAdapter(peer.objectAccess),
      new OrdinaryCanonicalPermissionSnapshotAdapter(peer.objectAccess),peer.registrar,peer.sourceAuthorization,sessions,peer.actors);
    const ordinary={request:()=>{throw new Error('must not create a continuation');}};
    const writer=new CanonicalInitialAnalysisContinuationController(ordinary,sessions,service);
    const reader=new CanonicalHostController({}, {}, {}, {}, {},undefined,undefined,f.problem,sessions,service);
    const normalInitial=new CanonicalHostInitialAnalysisStatusService(f.db,f.attempts,f.work,undefined,undefined,sessions);
    const continuation=new CanonicalInitialAnalysisContinuationService(new OrdinaryCanonicalAuthorizationAdapter(f.objectAccess),
      new OrdinaryCanonicalPermissionSnapshotAdapter(f.objectAccess),f.registrar,f.attempts,normalInitial,
      {enqueueContinuation:()=>{throw new Error('must not translate');}},f.problem,sessions,undefined,f.sourceAuthorization);
    const normalWriter=new CanonicalInitialAnalysisContinuationController(continuation,sessions,service);
    async function opened(name,beforeBegin) {
      const wi=`WI-expired-${name}`;const seeded=await f.seed(wi);
      // The shared legacy seed omitted the two persisted package columns checked
      // by matchesInitialContinuationOwner. Match the actual seed projection,
      // as the real WorkItem producer does; do not loosen that owner predicate.
      await f.sql`UPDATE work_item SET package_artifact_ref=${seeded.package.artifact.ref},
        package_artifact_sha256=${seeded.package.artifact.sha256} WHERE work_item_id=${wi}`;
      const q=await f.nextWorkItem({resumeWorkItemId:wi});assert.equal(q.status,'CLAIMED');
      if(beforeBegin)await beforeBegin({wi,seeded,q});
      const c=await f.callTool('begin_dynamic_evaluation',{workItemId:wi,requestId:`synthetic-${name}`});
      const query={view:'attempt-control',attemptId:c.task.actionAttemptId,attemptRef:c.attemptRef};
      const read=()=>reader.assessmentWork(wi,request,query);
      const facts=await read();
      const command={operation:'RECONCILE_EXPIRED',attemptId:facts.attemptId,attemptRef:facts.attemptRef,
        stageRequestId:facts.stageRequestId,expectedRevision:facts.workItemRevision,expectedLeaseGeneration:facts.leaseGeneration};
      return {wi,c,read,query,command,intakeRequestId:seeded.requestId,close:()=>writer.request(wi,command,request)};
    }
    await t.test('exact reads are write-free and do not disclose task, response or lease secrets',async()=>{
      const h=await opened('read');const before=await f.snapshot();
      const facts=await h.read(), again=await h.read();
      assert.ok(Number.isFinite(Date.parse(again.observedAt)));
      assert.deepEqual({...again,observedAt:facts.observedAt},facts);
      assert.deepEqual(await f.snapshot(),before);
      assert.equal(facts.reconciliation,'PROTECTED');assert.equal(facts.savedWorks.length,0);
      for(const key of ['leaseToken','leaseOwner','taskEnvelopeJson','resultEnvelopeJson','goal','modelInput'])
        assert.equal(Object.hasOwn(facts,key),false,key);
      await assert.rejects(()=>reader.assessmentWork(h.wi,request,{...h.query,attemptId:'ATT-foreign'}),/NOT_FOUND/u);
      await assert.rejects(()=>reader.assessmentWork(h.wi,{...request,userContext:{...request.userContext,userId:'another-owner'}},h.query),/NOT_FOUND/u);
      await assert.rejects(h.close,/DEADLINE_NOT_EXPIRED/u);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('normal reclaim preserves an earlier block receipt without blocking exact unsaved expiry',async()=>{
      let history;
      const h=await opened('historical-block',async({wi,seeded})=>{
        const active=(await f.snapshot()).grants.find(row=>row.work_item_id===wi);
        // Real block persistence while there is no active INITIAL attempt. The
        // following WAITING precondition models the existing browser continuation,
        // which deliberately retains this receipt; it is fixture setup only.
        const blocked=await f.hosted(()=>f.workItems.blockAutoProcessingLease({
          tenantId:f.tenantId,workItemId:wi,requestId:active.request_id,actorUserId:active.actor_user_id,
          documentId:active.document_id,documentVersionId:active.document_version_id,
          sourceArtifactId:active.source_artifact_id,sourceFileSha256:active.source_file_sha256,
          sourceByteLength:Number(active.source_byte_length),expectedWorkItemRevision:seeded.revision,
          leaseOwner:active.lease_owner,leaseToken:active.lease_token,leaseGeneration:active.lease_generation,
          blockedCode:'SYNTHETIC_PREVIOUS_STAGE_FAILED',now:new Date()}));
        assert.equal(blocked?.replayed,false);
        history=(await f.snapshot()).grants.find(row=>row.work_item_id===wi);
        assert.ok(history.blocked_at);assert.match(history.blocked_lease_token_hash,/^[a-f0-9]{64}$/u);
        assert.equal(history.blocked_lease_generation,active.lease_generation);
        await f.sql`UPDATE auto_work_item_authorization SET status='WAITING' WHERE work_item_id=${wi}`;
        const next=await f.nextWorkItem({resumeWorkItemId:wi});assert.equal(next.status,'CLAIMED');
        const claimed=(await f.snapshot()).grants.find(row=>row.work_item_id===wi);
        assert.equal(claimed.status,'LEASED');assert.equal(claimed.blocked_code,null);
        assert.equal(claimed.lease_generation,history.blocked_lease_generation+1);
        for(const key of ['blocked_at','blocked_lease_generation','blocked_lease_token_hash'])
          assert.deepEqual(claimed[key],history[key],`normal claim retains ${key}`);
        t.diagnostic(JSON.stringify({kind:'NORMAL_CLAIM_RETAINS_BLOCK_HISTORY',
          blockedGeneration:history.blocked_lease_generation,claimedGeneration:claimed.lease_generation,blockedCodeCleared:true}));
      });
      const observation=[{kind:'ASSESSMENT_CONSUMER_STOPPED',upstreamOutcome:'UNKNOWN',
        requestId:h.command.stageRequestId,documentVersionId:h.c.task.documentVersionId,
        inputRevision:h.c.task.inputRevision,modelRound:1,errorCode:'SYNTHETIC_UNSAVED',observedAt:new Date().toISOString()}];
      await f.sql`UPDATE action_attempt SET review_activity_json=${JSON.stringify(observation)} WHERE attempt_id=${h.command.attemptId}`;
      await f.advance();const before=await f.snapshot();
      const facts=await h.read();assert.equal(facts.reconciliation,'ELIGIBLE');assert.equal(facts.consumerOutcome,'UNKNOWN');
      assert.deepEqual(await f.snapshot(),before,'the exact browser GET remains write-free');
      const currentGrant=before.grants.find(row=>row.work_item_id===h.wi);
      const protectedBlock=async()=>{
        const protectedSnapshot=await f.snapshot();const protectedRead=await h.read();
        assert.equal(protectedRead.reconciliation,'PROTECTED');
        assert.deepEqual(protectedRead.protectionDetails.reasons,['GRANT_BLOCKED']);
        assert.equal(JSON.stringify(protectedRead).includes('blockedLeaseTokenHash'),false);
        assert.equal(JSON.stringify(protectedRead).includes(history.blocked_lease_token_hash),false);
        await assert.rejects(h.close,/GRANT_CHANGED_OR_ACTIVE/u);
        assert.deepEqual(await f.snapshot(),protectedSnapshot,'current or incomplete block protects the CAS without writing');
      };
      for(const generation of [currentGrant.lease_generation,currentGrant.lease_generation+1]) {
        await f.sql`UPDATE auto_work_item_authorization SET blocked_lease_generation=${generation} WHERE work_item_id=${h.wi}`;
        await protectedBlock();
      }
      await f.sql`UPDATE auto_work_item_authorization SET blocked_lease_generation=${history.blocked_lease_generation},
        blocked_code='SYNTHETIC_CURRENT_BLOCK' WHERE work_item_id=${h.wi}`;
      await protectedBlock();
      // The real schema forbids partially populated receipt triples. This legal
      // code-only row represents an incomplete current block and must also refuse.
      await f.sql`UPDATE auto_work_item_authorization SET blocked_at=NULL,blocked_lease_generation=NULL,
        blocked_lease_token_hash=NULL WHERE work_item_id=${h.wi}`;
      await protectedBlock();
      await f.sql`UPDATE auto_work_item_authorization SET blocked_at=${history.blocked_at},
        blocked_lease_generation=${history.blocked_lease_generation},blocked_lease_token_hash=${history.blocked_lease_token_hash},
        blocked_code=NULL WHERE work_item_id=${h.wi}`;
      assert.deepEqual(await f.snapshot(),before,'fixture restores the exact historical receipt before expiry');
      const closed=await h.close();assert.equal(closed.changed,true);assert.equal(closed.attempt.status,'TIMED_OUT');
      assert.equal(closed.attempt.consumerOutcome,'UNKNOWN');assert.deepEqual(closed.attempt.savedWorks,[]);
      const after=await f.snapshot();assert.deepEqual(after.grants,before.grants);
      assert.deepEqual(after.work,before.work);assert.deepEqual(after.workItems,before.workItems);
      const old=before.attempts.find(row=>row.attempt_id===h.command.attemptId);
      const fresh=after.attempts.find(row=>row.attempt_id===h.command.attemptId);
      const allowed=new Set(['status','terminal_reason','completed_at','updated_at','lease_owner','lease_token','lease_expires_at','lease_slot']);
      for(const key of Object.keys(old))if(!allowed.has(key))assert.deepEqual(fresh[key],old[key],key);
      assert.deepEqual(after.attempts.filter(row=>row!==fresh),before.attempts.filter(row=>row!==old));
      assert.equal((await h.close()).changed,false);assert.deepEqual(await f.snapshot(),after);
    });
    await t.test('no S is required: original deadline times out only the exact unsaved attempt; UNKNOWN and replay remain',async()=>{
      const h=await opened('no-save');
      const observation=[{kind:'ASSESSMENT_PROGRAM_PROGRESS',phase:'MODEL_RESPONSE_SAVED',
        checkpointRef:'synthetic-response-checkpoint',observedAt:new Date().toISOString()},
        {kind:'ASSESSMENT_CONSUMER_STOPPED',upstreamOutcome:'UNKNOWN',requestId:h.command.stageRequestId,
        documentVersionId:h.c.task.documentVersionId,inputRevision:h.c.task.inputRevision,modelRound:1,
        errorCode:'SYNTHETIC_SAVE_REJECTED',observedAt:new Date().toISOString()}];
      await f.sql`UPDATE action_attempt SET review_activity_json=${JSON.stringify(observation)},error_code='SYNTHETIC_SAVE_REJECTED'
        WHERE attempt_id=${h.c.task.actionAttemptId}`;
      await f.advance();const before=await f.snapshot();
      const facts=await h.read();assert.equal(facts.reconciliation,'ELIGIBLE');assert.equal(facts.consumerOutcome,'UNKNOWN');
      const closed=await h.close();assert.equal(closed.changed,true);assert.equal(closed.attempt.status,'TIMED_OUT');
      assert.equal(closed.attempt.consumerOutcome,'UNKNOWN');assert.deepEqual(closed.attempt.savedWorks,[]);
      const after=await f.snapshot();assert.deepEqual(after.grants,before.grants);assert.deepEqual(after.work,before.work);
      assert.deepEqual(after.workItems,before.workItems);
      const old=before.attempts.find(row=>row.attempt_id===h.c.task.actionAttemptId);
      const fresh=after.attempts.find(row=>row.attempt_id===old.attempt_id);
      const allowed=new Set(['status','terminal_reason','completed_at','updated_at','lease_owner','lease_token','lease_expires_at','lease_slot']);
      for(const key of Object.keys(old))if(!allowed.has(key))assert.deepEqual(fresh[key],old[key],key);
      assert.deepEqual(after.attempts.filter(row=>row!==fresh),before.attempts.filter(row=>row!==old));
      assert.equal((await h.close()).changed,false);assert.deepEqual(await f.snapshot(),after);
    });
    await t.test('only a separate normal continuation reserves a new request; an active successor still blocks another',async()=>{
      const h=await opened('normal-next');await f.advance();await h.close();
      // The old synthetic attempt is already terminal. The subsequent browser
      // request uses the current CODEX exact WI/intake contract, never a legacy
      // static OPENCLAW scope or a new identity. These are local fixture values.
      const codex={WL_MODEL_EXECUTOR:'CODEX',WL_CODEX_RUNTIME_APP_ID:'app_syntheticcodex',
        WL_CODEX_SERVICE_SCOPE_ENABLED:'1',WL_CODEX_GATEWAY_AUTH_MODE:'API_KEY',
        WL_CODEX_SERVICE_SCOPE_ENV:'UAT',WL_CODEX_SERVICE_PRINCIPAL_ID:'service:synthetic-codex-control',
        WL_CODEX_SERVICE_TENANT_ID:f.tenantId,WL_CODEX_SERVICE_WORK_ITEM_ID:h.wi,
        WL_CODEX_SERVICE_REQUEST_ID:h.intakeRequestId,WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED:'1'};
      const previous=Object.fromEntries(Object.keys(codex).map(key=>[key,process.env[key]]));
      Object.assign(process.env,codex);
      try {
        const before=await f.snapshot();
        const projection=await f.withBrowser(()=>f.registrar.getTenantScopedByWorkItemId({tenantId:f.tenantId,workItemId:h.wi}));
        assert.equal(await sessions.withNativeBrowserIdentity(request,()=>sessions.withVerifiedNativeBrowserSql(()=>
          normalInitial.hasExactAutoProcessingGrant({tenantId:f.tenantId,actorUserId:f.actorUserId,workItem:projection}))),true,
          'real browser owner and exact persisted intake grant must pass before continuation');
        const next={operation:'EVALUATE_JOBAID',requestId:'00000000-0000-4000-8000-000000000071',
          expectedRevision:h.command.expectedRevision};
        const receipt=await normalWriter.request(h.wi,next,request);
        assert.equal(receipt.status,'QUEUED');assert.equal(receipt.replayed,false);
        const after=await f.snapshot();assert.equal(after.attempts.length,before.attempts.length+1);
        const old=before.attempts.find(r=>r.attempt_id===h.command.attemptId);
        assert.deepEqual(after.attempts.find(r=>r.attempt_id===h.command.attemptId),old);
        assert.deepEqual(after.grants,before.grants,'normal reservation has not claimed or rewritten the expired outer generation');
        const pending=after.attempts.find(r=>!before.attempts.some(p=>p.attempt_id===r.attempt_id));
        assert.equal(pending.status,'QUEUED');assert.equal(pending.claim_count,0);assert.equal(pending.lease_generation,0);
        assert.match(pending.idempotency_key,/000000000071$/u);
        await assert.rejects(()=>normalWriter.request(h.wi,{...next,requestId:'00000000-0000-4000-8000-000000000072'},request),
          /EXISTING_WORK_NOT_TERMINAL/u);
        assert.deepEqual(await f.snapshot(),after);
      } finally {for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
    });
    await t.test('e6 prepared PROGRAM metadata without RC1 stays readable and closable without rebuilding business inputs',async()=>{
      const h=await opened('e6-shape');
      // Synthetic copy of the finite e6 JobAidTaskInput / TaskEnvelope / queue
      // lease shape. No production task is read or rewritten. No new RC1
      // checklistBinding, executionPolicy, model projection or validator is used.
      const {inputHash:ignored,...outer}=structuredClone(h.c.task);
      const oldInput=structuredClone(outer.modelInput);
      delete oldInput.checklistBinding;delete oldInput.modelInput.checklistBinding;
      delete oldInput.modelInput.checklistResults;delete oldInput.executionPolicy;
      oldInput.executionMode='PROGRAM_AGENT_V1';oldInput.requestedModelRef='miaoda/glm-5.3';
      oldInput.agentPolicy={schemaVersion:'wiselink.program-agent-policy.v1',maxModelRequests:null,
        maxOutputTokens:98304,maxToolCalls:null,timeoutSeconds:3600};
      const legacy=sealTaskEnvelope({...outer,modelInput:oldInput,executionModel:{
        schemaVersion:'wiselink.3_1.execution_model_selection.v2',modelRef:'miaoda/glm-5.3',
        displayName:'GLM 5.3',providerKind:'BUILT_IN',settingsRevision:1,
        selectedAt:new Date().toISOString(),maxOutputTokens:98304}});
      assert.ok(legacy.modelInput.automaticWorkItemLease);
      assert.equal(Object.hasOwn(legacy.modelInput,'checklistBinding'),false);
      await f.sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(legacy)},task_input_hash=${legacy.inputHash},
        execution_model_json=${canonicalJson(legacy.executionModel)} WHERE attempt_id=${h.command.attemptId}`;
      await f.advance();const before=await f.snapshot();
      assert.equal((await h.read()).reconciliation,'ELIGIBLE');
      assert.equal((await h.close()).changed,true);
      const after=await f.snapshot(), prior=before.attempts.find(r=>r.attempt_id===h.command.attemptId),
        current=after.attempts.find(r=>r.attempt_id===h.command.attemptId);
      for(const key of ['task_envelope_json','task_input_hash','deadline_at','execution_model_json','review_activity_json'])
        assert.deepEqual(current[key],prior[key],key);
      assert.deepEqual(after.grants,before.grants);
      // Missing control/source binding is UNKNOWN, never filled from latest.
      const broken=structuredClone(legacy);delete broken.inputHash;delete broken.modelInput.sourceBindings;
      const invalid=sealTaskEnvelope(broken);
      await f.sql`UPDATE action_attempt SET task_envelope_json=${canonicalJson(invalid)},task_input_hash=${invalid.inputHash}
        WHERE attempt_id=${h.command.attemptId}`;
      const unknown=await f.snapshot();await assert.rejects(h.read,/SOURCE_BINDING_UNKNOWN/u);
      await assert.rejects(h.close,/SOURCE_BINDING_UNKNOWN/u);assert.deepEqual(await f.snapshot(),unknown);
    });
    await t.test('COMMITTING, result presence, corrupt coverage and stale caller fences all fail closed',async()=>{
      const h=await opened('protected');await f.advance();
      for(const overrides of [{stageRequestId:'wrong-request'},{expectedLeaseGeneration:h.command.expectedLeaseGeneration+1},
        {expectedRevision:h.command.expectedRevision+1}]) {
        const before=await f.snapshot();await assert.rejects(()=>writer.request(h.wi,{...h.command,...overrides},request),/INITIAL_EXPIRED_/u);
        assert.deepEqual(await f.snapshot(),before);
      }
      await f.sql`UPDATE action_attempt SET status='COMMITTING',commit_started_at=now(),result_envelope_json='{"synthetic":"retained"}'
        WHERE attempt_id=${h.c.task.actionAttemptId}`;
      const sealed=await f.snapshot();await assert.rejects(h.close,/SAVED_OR_COMMITTING/u);assert.deepEqual(await f.snapshot(),sealed);
      assert.equal((await h.read()).hasPersistedResult,true);
      // This is loss of the existing owner/tenant visibility, not proof of no SAVE.
      try {
        await f.sql`UPDATE identity_subject_mapping SET status='REVOKED' WHERE miaoda_user_id=${f.actorUserId}`;
        await assert.rejects(h.close,/NOT_FOUND|SAVE_COVERAGE_UNKNOWN/u);
      } finally {await f.sql`UPDATE identity_subject_mapping SET status='ACTIVE' WHERE miaoda_user_id=${f.actorUserId}`;}
      await f.sql`UPDATE action_attempt SET status='FAILED' WHERE attempt_id=${h.c.task.actionAttemptId}`;
    });
    await t.test('an actual prior SAVE remains protected under its original S after deadline',async()=>{
      const h=await opened('saved');const saved=await f.callTool('save_assessment_work',saveArgs(f,h.c,'S-original-synthetic'));
      await f.advance();const before=await f.snapshot();
      const facts=await h.read();assert.equal(facts.protectionCode,'SAVED_OR_COMMITTING');
      assert.deepEqual(facts.savedWorks,[{workRevisionRef:saved.workRevisionRef,workRevision:1,saveRequestId:'S-original-synthetic'}]);
      await assert.rejects(h.close,/SAVED_OR_COMMITTING/u);assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('real SAVE wins the WI lock; expiration waits and protects that saved result',async()=>{
      const h=await opened('save-first'), reached=gate(),release=gate();
      const original=f.work.save.bind(f.work);let pid;
      f.work.save=(input,...args)=>{let calls=0;return original({...input,assertNativeAuthorized:async database=>{
        await input.assertNativeAuthorized?.(database);
        if(++calls===2){pid=Number((await database.execute(sql`SELECT pg_backend_pid() AS pid`))[0].pid);reached.resolve();await release.promise;}
      }},...args);};
      const save=tracked(f.callTool('save_assessment_work',saveArgs(f,h.c,'S-race-first')));
      let closing;
      try {
        await Promise.race([reached.promise,save.promise.then(result=>{throw result.error ?? new Error('SAVE finished before the held-lock checkpoint');})]);
        assert.equal(pid,Number(saveConnection.pid),'SAVE holds the original physical connection');
        await f.advance();closing=tracked(h.close());
        const wait=await waiting(f,pid,closing);assert.ok(wait.blockers.map(Number).includes(pid));
        t.diagnostic(JSON.stringify({kind:'SAVE_FIRST_WI_ROW_LOCK',holderPid:pid,waiterPid:Number(wait.pid)}));release.resolve();
        const result=await save.promise;assert.ok(result.value, result.error?.message);
        const closed=await closing.promise;assert.match(closed.error?.message ?? '',/SAVED_OR_COMMITTING/u);
        assert.equal((await h.read()).savedWorks[0].saveRequestId,'S-race-first');
      } finally {release.resolve();f.work.save=original;await save.promise;await closing?.promise;}
    });
    await t.test('expiration wins; an already admitted real SAVE observes terminal state even with an unexpired synthetic clock',async()=>{
      const h=await opened('expire-first'),reached=gate(),release=gate();await f.advance();
      const original=InitialExpiredAttemptRepository.prototype.reconcile;let pid;
      InitialExpiredAttemptRepository.prototype.reconcile=function(scope,input,authorize){let calls=0;
        return original.call(this,scope,input,async(database,owners)=>{await authorize(database,owners);
          if(++calls===2){pid=Number((await database.execute(sql`SELECT pg_backend_pid() AS pid`))[0].pid);reached.resolve();await release.promise;}});};
      const closing=tracked(h.close());
      let save;
      try {
        await Promise.race([reached.promise,closing.promise.then(result=>{throw result.error ?? new Error('control finished before the held-lock checkpoint');})]);
        // Explicit test clock: SAVE has its original live time. Its failure must
        // therefore follow the committed terminal fence, not merely old expiry.
        assert.equal(pid,Number(controlConnection.pid),'control holds the independent physical connection');
        await f.advance(-7200000);
        assert.ok(new Date(h.c.task.deadline)>new Date());
        save=tracked(f.callTool('save_assessment_work',saveArgs(f,h.c,'S-race-late')));
        const wait=await waiting(f,pid,save);
        t.diagnostic(JSON.stringify({kind:'EXPIRY_FIRST_WI_ROW_LOCK',holderPid:pid,waiterPid:Number(wait.pid)}));
        release.resolve();const closed=await closing.promise;assert.equal(closed.value?.changed,true,closed.error?.message);
        const result=await save.promise;assert.ok(result.error);assert.match(result.error.message,/ATTEMPT|LEASE|FENCE/u);
        const facts=await h.read();assert.equal(facts.status,'TIMED_OUT');assert.deepEqual(facts.savedWorks,[]);
      } finally {release.resolve();InitialExpiredAttemptRepository.prototype.reconcile=original;await closing.promise;await save?.promise;}
    });
    await t.test('a new grant generation and changed source ownership never become a writable expired target',async()=>{
      const h=await opened('changed');await f.advance();
      await f.sql`UPDATE auto_work_item_authorization SET lease_generation=lease_generation+1 WHERE work_item_id=${h.wi}`;
      let before=await f.snapshot();await assert.rejects(h.close,/GRANT_CHANGED_OR_ACTIVE/u);assert.deepEqual(await f.snapshot(),before);
      await f.sql`UPDATE work_item SET requested_by_user_id='different-owner' WHERE work_item_id=${h.wi}`;
      before=await f.snapshot();await assert.rejects(h.close,/NOT_FOUND/u);assert.deepEqual(await f.snapshot(),before);
    });
  } finally {await f.close();if(priorSandbox===undefined)delete process.env.SANDBOX_ID;else process.env.SANDBOX_ID=priorSandbox;}
});
