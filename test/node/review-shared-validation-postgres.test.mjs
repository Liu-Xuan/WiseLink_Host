// Owned disposable PostgreSQL only. The fixture resets (DROPs) its own public schema.
// Never accept a dev/prod/external URL. No network/model execution or production DDL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';
const require = createRequire(import.meta.url);
const { McpServer } = require('@modelcontextprotocol/server');
const { CanonicalHostOpenClawMcpService } = require('../../server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts');
const { sealResultEnvelope } = require('../../server/modules/action-attempt/action-attempt-envelope.ts');
const { CANONICAL_EXECUTION_MODEL_V2_ENV } = require('../../server/modules/model-settings/canonical-model-output-budget.ts');
async function captureModel(f) {
  // The base model-settings DDL denies authenticated reads until the existing
  // 0057 tenant policy is installed, as in the real browser reservation path.
  await f.sql.unsafe(await readFile(new URL('../../migrations/0057_model_setting_authenticated_tenant_read.sql', import.meta.url), 'utf8'));
  // This owned fixture predates 0084. Reuse its exact additive column/constraint
  // clause in public; the workspace-owner RPC and its privileges are unrelated
  // to read-only capture and are not installed or relaxed for this test.
  const migration = await readFile(new URL('../../migrations/0084_canonical_model_output_budgets.sql', import.meta.url), 'utf8');
  const columnDdl = migration.match(/^ALTER TABLE workspace_aadkpkjef3slu\.canonical_model_setting\n[\s\S]*?;/mu)?.[0];
  assert.ok(columnDdl, '0084 canonical model settings additive column clause must exist');
  await f.sql.unsafe(columnDdl.replace('workspace_aadkpkjef3slu.canonical_model_setting', 'public.canonical_model_setting'));
  await f.sql`INSERT INTO canonical_model_setting(tenant_id,revision,model_ref,changed_by_user_id)
    VALUES(${f.tenantId},1,'miaoda/glm-5.3',${f.actorUserId}) ON CONFLICT(tenant_id)
    DO UPDATE SET revision=EXCLUDED.revision,model_ref=EXCLUDED.model_ref`;
  const setting = await f.withBrowser(() => f.modelSettingsRepository.read(f.tenantId));
  assert.ok(setting, 'authenticated owner must read the actual tenant model setting through 0057 RLS');
  const captured = await f.withBrowser(() => f.modelSettings.captureForExplicitProgram(
    f.tenantId, 'miaoda/glm-5.3', new Date(), 'PROGRAM_AGENT_V1'));
  assert.equal(captured.settingsRevision, setting.revision, 'profile revision comes from the real authenticated read');
  assert.equal(captured.modelRef, 'miaoda/glm-5.3');
  return captured;
}

function reviewTools(f) {
  const tools = new Map(), original = McpServer.prototype.registerTool;
  McpServer.prototype.registerTool = function(name, definition, handler) {
    tools.set(name, {definition, handler});
    return {remove(){},enable(){},disable(){},update(){}};
  };
  try {
    const mcp = new CanonicalHostOpenClawMcpService({}, {}, {}, f.overall, {}, {}, f.reviewService,
      {}, f.attempts, f.serviceScope, f.problem);
    mcp.createServer('CODEX');
  } finally { McpServer.prototype.registerTool = original; }
  return async(name,args) => f.withReviewScope(args.workItemId, async()=>{
    const tool=tools.get(name); assert.ok(tool, name);
    const output=await tool.handler(tool.definition.inputSchema.parse(args));
    assert.equal(output.isError,undefined);
    return JSON.parse(output.content[0].text);
  });
}
function args(claim,result) {
  return {attemptRef:claim.attemptRef,workItemId:claim.task.workItemId,
    leaseToken:claim.leaseToken,leaseGeneration:claim.leaseGeneration,result};
}
function codexResult(result) {
  const {contentHash:ignored,...rest}=result;
  return sealResultEnvelope({...rest,toolVersions:{...rest.toolVersions,'model-executor':'CODEX'}});
}

test('CODEX c5: real shared preview, SAVE, exact saved body READ, successor Overall and same-version reading',
  {timeout:180000}, async()=>{
  const keys=[CANONICAL_EXECUTION_MODEL_V2_ENV,'WL_MODEL_EXECUTOR','WL_CODEX_RUNTIME_APP_ID',
    'WL_CODEX_SERVICE_SCOPE_ENABLED','WL_CODEX_GATEWAY_AUTH_MODE','WL_CODEX_SERVICE_SCOPE_ENV',
    'WL_CODEX_SERVICE_PRINCIPAL_ID','WL_CODEX_SERVICE_TENANT_ID','WL_CODEX_SERVICE_WORK_ITEM_ID',
    'WL_CODEX_SERVICE_REQUEST_ID','WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED','WL_CODEX_SERVICE_SUCCESSOR_REVIEW_ENABLED'];
  const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  let f;
  try {
    process.env.WL_MODEL_EXECUTOR='HOSTED';process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]='true';
    f=await startCoreP1HostFixture({browser:true,matter:true});
    const model=await captureModel(f), wi='WI-review-validation-synthetic';
    const item=await f.seed(wi,{executionModel:model});
    const initialRequestId='00000000-0000-4000-8000-0000000000d1';
    await f.withBrowser(()=>f.problem.enqueueContinuation(item,f.tenantId,'synthetic-owner-scope',initialRequestId,
      'INITIAL_PROBLEM_ASSESSMENT',undefined,undefined,undefined,{modelRef:'miaoda/glm-5.3',executionMode:'PROGRAM_AGENT_V1'}));
    const queue=await f.nextWorkItem({resumeWorkItemId:wi});assert.equal(queue.status,'CLAIMED');
    const initial=await f.callTool('begin_dynamic_evaluation',{workItemId:wi,requestId:initialRequestId});
    const original=f.proposal(initial);
    const checklist=initial.task.modelInput.checklistBinding;
    assert.ok(checklist, 'actual new PROGRAM task must seal RC1');
    if(checklist) {
      original.issues[0].methodUsage=[];
      const source=initial.task.modelInput.sourceCatalog.find(item=>item.kind==='DOCUMENT_PASSAGE');
      original.checklistResults=checklist.selection.map(item=>({itemId:item.itemId,
        itemApplicability:item.mode==='INCLUDE'||['ENG-METHOD-01','ENG-STATUS-01'].includes(item.itemId)?'APPLICABLE':'NOT_APPLICABLE',outcome:'ANSWERED',
        resultRefs:[{issueKey:'condition',fieldPath:'/body'}],basisRefs:[source.evidenceRef]}));
    }
    const save=await f.callTool('save_assessment_work',{attemptRef:initial.attemptRef,workItemId:wi,
      leaseToken:initial.leaseToken,leaseGeneration:initial.leaseGeneration,expectedWorkRevision:0,
      requestId:'S-initial-synthetic',workJson:JSON.stringify(original)});
    // The normal PROGRAM read carries the original execution fence. An unfenced
    // recovery read can return the body but cannot mint the live read observation.
    const originalRead=await f.callTool('read_assessment_work',{attemptRef:initial.attemptRef,workItemId:wi,
      requestId:'S-initial-synthetic',leaseToken:initial.leaseToken,leaseGeneration:initial.leaseGeneration});
    assert.equal(originalRead.revision.workRevisionRef,save.workRevisionRef);
    const readAttempt=(await f.snapshot()).attempts.find(row=>row.attempt_id===initial.task.actionAttemptId);
    assert.ok(readAttempt, 'the original attempt must remain present after its independent READ');
    const readObservation=JSON.parse(readAttempt.review_activity_json).find(item=>item.kind==='ASSESSMENT_WORK_READ');
    assert.ok(readObservation, 'the real Host read must persist its observation before INITIAL commit');
    assert.equal(readObservation.workRevisionRef,originalRead.revision.workRevisionRef);
    assert.equal(readObservation.workRevision,originalRead.revision.workRevision);
    assert.equal(readObservation.saveRequestId,originalRead.revision.requestId);
    assert.ok(Number.isFinite(Date.parse(readObservation.observedAt)));
    const initialCommitted=await f.callTool('commit_dynamic_evaluation_candidate',args(initial,f.result(initial,save.workRevisionRef)));
    assert.deepEqual(initialCommitted.overallSynthesis.sourceAssessment,{
      actionAttemptId:initial.task.actionAttemptId,workRevisionRef:originalRead.revision.workRevisionRef,
      workRevision:originalRead.revision.workRevision,saveRequestId:originalRead.revision.requestId,
      readObservedAt:readObservation.observedAt,
    });
    const firstOverall=await f.callTool('begin_overall_synthesis',{workItemId:wi});
    await f.callTool('commit_overall_candidate',args(firstOverall,f.result(firstOverall,save.workRevisionRef,'Synthetic initial consistency.')));
    assert.equal((await f.acknowledgeWorkItem({workItemId:wi,leaseToken:queue.leaseToken,
      leaseGeneration:queue.leaseGeneration})).status,'ACKNOWLEDGED');

    const turn=await f.seedReviewTurn({workItemId:wi,text:'Synthetic review of the same evidence; retain unresolved conditions.',
      purpose:'UPDATE_ASSESSMENT',targetIssueKeys:['condition'],executionRequested:true,overallRequested:true,requestedModel:model});
    Object.assign(process.env,{WL_MODEL_EXECUTOR:'CODEX',WL_CODEX_RUNTIME_APP_ID:'app_syntheticcodex',
      WL_CODEX_SERVICE_SCOPE_ENABLED:'1',WL_CODEX_GATEWAY_AUTH_MODE:'API_KEY',WL_CODEX_SERVICE_SCOPE_ENV:'UAT',
      WL_CODEX_SERVICE_PRINCIPAL_ID:'service:codex-synthetic',WL_CODEX_SERVICE_TENANT_ID:f.tenantId,
      WL_CODEX_SERVICE_WORK_ITEM_ID:wi,WL_CODEX_SERVICE_REQUEST_ID:item.requestId,
      WL_CODEX_SERVICE_AUTO_QUEUE_ENABLED:'1',WL_CODEX_SERVICE_SUCCESSOR_REVIEW_ENABLED:'1'});
    const call=reviewTools(f);
    const pending=await f.nextWorkItem({reviewAfterWorkItemId:wi});assert.equal(pending.status,'REVIEW_PENDING');
    const claim=await call('begin_review_turn',{workItemId:wi,reviewConversationRef:turn.reviewConversationId,requestId:turn.requestId});
    assert.equal(claim.task.modelInput.executionPolicy.executor,'CODEX');
    assert.equal(Object.keys(claim.task.modelInput.executionPolicy).length,7);
    const task=claim.task.modelInput.jobAidContext;
    const delta={...original,issues:[{...original.issues[0],body:original.issues[0].body+' Synthetic explicit clarification.'}],
      changeSummary:'Synthetic explicit clarification of the scoped issue.'};
    const candidate={schemaVersion:'wiselink.3_1.review_turn_candidate.v1.c5',mode:'INTERACTIVE_REVIEW',
      reviewConversationRef:turn.reviewConversationId,reviewTurnRef:turn.reviewTurnId,responseType:'RESYNTHESIS_RESULT',
      answer:'Synthetic candidate update only.',sourceRefs:[],missingInputs:[],candidateEvidenceRefs:[],reviewActionDraft:null,
      affectedItemIds:[],warnings:[],jobAidWorkingDelta:delta,
      runtime:{runtimeAppId:'app_syntheticcodex',profileRef:'wiselink-engineering'}};
    const request={attemptRef:claim.attemptRef,workItemId:wi,leaseToken:claim.leaseToken,leaseGeneration:claim.leaseGeneration,
      candidateJson:JSON.stringify(candidate)};
    const before=await f.snapshot();
    const beforeTurns=await f.sql`SELECT * FROM review_turn ORDER BY review_turn_id`;
    const validated=await call('validate_review_turn_candidate',request);
    assert.equal(validated.status,'VALID');
    assert.equal(validated.checklistFeedback.ruleset.validatorBuildRef,'wiselink.jobaid-checklist-validator.rc1.2');
    assert.deepEqual(await f.snapshot(),before,'preview must not reserve/SAVE, journal/READ, or extend either lease');
    assert.deepEqual(await f.sql`SELECT * FROM review_turn ORDER BY review_turn_id`,beforeTurns);
    const missingBasis=structuredClone(candidate);
    missingBasis.jobAidWorkingDelta.checklistResults[0].basisRefs=['not-delivered-synthetic'];
    const located=await call('validate_review_turn_candidate',{...request,candidateJson:JSON.stringify(missingBasis)});
    assert.equal(located.status,'REPAIR_REQUIRED');
    assert.ok(located.violations.some(item=>item.fieldPaths.some(path=>path.startsWith('/jobAidWorkingDelta/checklistResults/'))));
    assert.ok(located.checklistFeedback.findings.some(item=>item.fieldPath?.startsWith('/jobAidWorkingDelta/checklistResults/')));
    const bad={...request,candidateJson:JSON.stringify({...candidate,answer:''})};
    const feedback=await call('validate_review_turn_candidate',bad);
    assert.equal(feedback.status,'REPAIR_REQUIRED');assert.deepEqual(feedback.violations[0].fieldPaths,['/answer']);
    await assert.rejects(call('validate_review_turn_candidate',{...request,leaseGeneration:claim.leaseGeneration+1}),/FENCE/u);
    process.env.WL_CODEX_SERVICE_REQUEST_ID='wrong-intake';
    await assert.rejects(call('validate_review_turn_candidate',request));
    process.env.WL_CODEX_SERVICE_REQUEST_ID=item.requestId;
    await f.sql`UPDATE dm_acquisition SET acquired_by='actor-other' WHERE acquisition_id='acq-core-p1'`;
    try { await assert.rejects(call('validate_review_turn_candidate',request)); }
    finally { await f.sql`UPDATE dm_acquisition SET acquired_by=${f.actorUserId} WHERE acquisition_id='acq-core-p1'`; }
    assert.deepEqual(await f.snapshot(),before);
    const template=f.result(claim,task.previousWork.workRevisionRef);
    const {contentHash:ignored,...envelope}=template;
    const result=sealResultEnvelope({...envelope,modelOutput:request.candidateJson,
      toolVersions:{...envelope.toolVersions,'model-executor':'CODEX'}});
    const committed=await call('commit_review_turn_candidate',{attemptRef:claim.attemptRef,workItemId:wi,leaseToken:claim.leaseToken,leaseGeneration:claim.leaseGeneration,
      resultJson:JSON.stringify(result)});
    assert.equal(committed.status,'SUCCEEDED');
    const receipt=committed.assistantCandidate.jobAidWorkingUpdate;
    assert.equal(receipt.status,'APPLIED');
    const readArgs={attemptRef:claim.attemptRef,workItemId:wi,workRevisionRef:receipt.workRevisionRef};
    const afterSave=await f.snapshot();
    const read=await call('read_review_saved_work',readArgs);
    assert.equal(read.revision.content.issues[0].body,delta.issues[0].body);
    assert.equal(read.revision.actionAttemptId,claim.task.actionAttemptId);
    assert.equal(read.revision.previousWorkRevisionRef,task.previousWork.workRevisionRef);
    assert.equal(read.revision.requestId,`review-turn:${turn.reviewTurnId}`);
    assert.deepEqual(await f.snapshot(),afterSave,'saved body READ must be independently no-write');
    await assert.rejects(call('read_review_saved_work',{...readArgs,workRevisionRef:save.workRevisionRef}),/BINDING_MISMATCH/u);
    await assert.rejects(call('validate_review_turn_candidate',request),/SUCCEEDED/u);
    // Queue discovery starts as the real service SQL identity, not in the
    // engineer scope used by direct Review tools. Its pointer must establish
    // that same trusted actor locally and still reauthorize the full metadata.
    const metadataInput={tenantId:f.tenantId,actorId:f.actorUserId,workItemId:wi,reviewTurnRef:turn.reviewTurnId};
    const metadata=await f.hosted(()=>f.reviews.loadSuccessorOverallAuthorizationMetadata(metadataInput));
    assert.ok(metadata, 'a saved APPLIED turn must be visible to exact authorized service discovery');
    assert.deepEqual(metadata.turn.jobAidWorkingUpdate,{status:'APPLIED',workRevisionRef:receipt.workRevisionRef});
    assert.equal(metadata.turn.overallRequested,true);
    for(const field of ['userMessage','assistantCandidate','candidateText','attachmentBindings'])
      assert.equal(field in metadata.turn,false,'authorization metadata must not expose body fields');
    for(const mismatch of [{actorId:'actor-other'},{workItemId:'WI-other'},{reviewTurnRef:'RT-other'},{tenantId:'tenant-other'}])
      assert.equal(await f.hosted(()=>f.reviews.loadSuccessorOverallAuthorizationMetadata({...metadataInput,...mismatch})),null);
    assert.deepEqual(await f.snapshot(),afterSave,'metadata discovery must not write business state or READ observations');
    // A saved attempt needs no live execution lease; its original deadline is unchanged.
    await f.advance(2*60*60*1000);
    assert.deepEqual((await call('read_review_saved_work',readArgs)).revision,read.revision);
    const next=await f.nextWorkItem({reviewAfterWorkItemId:wi});assert.equal(next.status,'OVERALL_PENDING');
    assert.equal(next.workRevisionRef,read.revision.workRevisionRef);
    const overall=await call('begin_overall_synthesis',{workItemId:wi,providers:[],successorReviewTurnRef:turn.reviewTurnId});
    const final=await call('commit_overall_candidate',{...args(overall,undefined),result:codexResult(
      f.result(overall,read.revision.workRevisionRef,'Synthetic exact saved body consistency.'))});
    const artifact=await f.readArtifact(final.overallSynthesis.artifact);
    assert.deepEqual(artifact.analysis,read.revision);
    assert.equal(artifact.adopted,false);
    assert.equal((await f.nextWorkItem({reviewAfterWorkItemId:wi})).status,'IDLE');
  } finally {
    if(f) await f.close();
    for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}
  }
});
