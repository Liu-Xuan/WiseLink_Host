// Only the existing owned loopback fixture. Its reset drops its disposable public schema.
// No supplied database URL, provider/model execution, production data or production DDL.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { startCoreP1HostFixture } from './helpers/core-p1-host-postgres.fixture.mjs';
const require = createRequire(import.meta.url);
const { CANONICAL_EXECUTION_MODEL_V2_ENV } = require('../../server/modules/model-settings/canonical-model-output-budget.ts');
const { materializeJobAidWork } = require('../../server/modules/canonical-host/jobaid-problem-work.ts');
const { parseJobAidProblemTask } = require('../../server/modules/canonical-host/jobaid-problem-task.ts');

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
async function opened(f) {
  const executionModel = await captureModel(f);
  const item = await f.seed('WI-rc1-synthetic', {executionModel});
  const requestId = '00000000-0000-4000-8000-0000000000c1';
  // The real continuation controller uses verified authenticated browser SQL
  // for request admission. Hosted -1 is not the document owner's RLS identity.
  await f.withBrowser(() => f.problem.enqueueContinuation(item, f.tenantId, 'synthetic-fixture-owner-scope',
    requestId, 'INITIAL_PROBLEM_ASSESSMENT', undefined, undefined, undefined,
    {modelRef:'miaoda/glm-5.3',executionMode:'PROGRAM_AGENT_V1'}));
  const queue = await f.nextWorkItem({resumeWorkItemId:item.workItemId});
  assert.equal(queue.status,'CLAIMED');
  const claim = await f.callTool('begin_dynamic_evaluation',{workItemId:item.workItemId,requestId});
  const taskInput = parseJobAidProblemTask(claim.task);
  assert.equal(claim.task.executionModel.settingsRevision, executionModel.settingsRevision);
  assert.equal(claim.task.executionModel.maxOutputTokens, executionModel.maxOutputTokens,
    'reserve captures the same backend model capability without a caller-supplied token budget');
  assert.ok(taskInput.checklistBinding, 'actual new PROGRAM task must seal RC1');
  assert.deepEqual(taskInput.modelInput.checklistBinding,taskInput.checklistBinding);
  const command=rc1Command(f,claim);
  const validate = {attemptRef:claim.attemptRef,workItemId:item.workItemId,leaseToken:claim.leaseToken,
    leaseGeneration:claim.leaseGeneration,expectedWorkRevision:taskInput.modelInput.expectedWorkRevision,workJson:JSON.stringify(command)};
  return {claim,taskInput,command,validate};
}
function rc1Command(f,claim) {
  const taskInput=parseJobAidProblemTask(claim.task);
  const source = taskInput.sourceCatalog.find(item => item.kind === 'DOCUMENT_PASSAGE');
  const command = f.proposal(claim);
  command.issues[0].body += ' 方法仅供本轮讨论。 [[method:risk]]';
  command.issues[0].measures = [{text:'合成记录所述措施的候选评价',addresses:'合成条件',
    limitations:['仅转述合成记录，不产生正式确认事件'],status:'VERIFIED_EFFECTIVE',basisRefs:[source.evidenceRef]}];
  command.issues[0].methodUsage = [{methodRef:'method:risk',usage:'REFERENCE_ONLY',basisRefs:[]}];
  command.checklistResults = taskInput.checklistBinding.selection.map(selection => ({itemId:selection.itemId,
    itemApplicability:selection.mode==='INCLUDE'||['ENG-METHOD-01','ENG-STATUS-01'].includes(selection.itemId)?'APPLICABLE':'NOT_APPLICABLE',
    outcome:'ANSWERED',resultRefs:[{issueKey:'condition',fieldPath:'/body'}],basisRefs:[source.evidenceRef]}));
  return command;
}
function commitArgs(f,claim,workRevisionRef,consistencyCheck) {
  return {workItemId:claim.task.workItemId,attemptRef:claim.attemptRef,leaseToken:claim.leaseToken,
    leaseGeneration:claim.leaseGeneration,result:f.result(claim,workRevisionRef,consistencyCheck)};
}
async function readOriginal(f,claim,requestId) {
  return f.hosted(()=>f.problem.readAttemptWork(claim.attemptRef,requestId,claim.task.workItemId,
    {leaseToken:claim.leaseToken,leaseGeneration:claim.leaseGeneration}));
}

test('RC1 real Host admission, preview, SAVE and exact revision independent READ preserve all fields', {timeout:120000}, async t => {
  const old = process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];
  process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]='true';
  let f;
  try {
    f=await startCoreP1HostFixture({browser:true,matter:true});
    const {claim,taskInput,command,validate}=await opened(f);
    const before=await f.snapshot();
    const preview=await f.hosted(()=>f.problem.validateWork(validate));
    assert.equal(preview.status,'VALID');
    assert.equal(preview.feedback.candidateBinding.taskBaselineHash,claim.task.inputHash);
    assert.equal(preview.feedback.candidateBinding.basedOnWorkItemRevision,claim.task.inputRevision);
    assert.ok(preview.feedback.findings.every(item=>item.assessment==='NOT_MACHINE_ASSESSED'));
    assert.deepEqual(await f.snapshot(),before,'preview must not write work, read/progress receipts or either lease');

    await t.test('missing delivered basis produces the same located content rejection on preview and SAVE',async()=>{
      const bad=structuredClone(command);bad.checklistResults[2].basisRefs=['SYNTHETIC-NOT-DELIVERED'];
      const args={...validate,workJson:JSON.stringify(bad)};
      const diagnostic=await f.hosted(()=>f.problem.validateWork(args));
      assert.equal(diagnostic.status,'REPAIR_REQUIRED');
      assert.equal(diagnostic.violations[0].code,'JOBAID_CHECKLIST_SOURCE_NOT_DELIVERED');
      assert.equal(diagnostic.violations[0].fieldPath,'/checklistResults/2/basisRefs/0');
      await assert.rejects(f.callTool('save_assessment_work',{...args,requestId:'S-rc1-rejected'}),/JOBAID_CHECKLIST_SOURCE_NOT_DELIVERED/u);
      assert.deepEqual(await f.snapshot(),before);
    });
    await t.test('caller binding and stale lease/revision are not repairable semantic success',async()=>{
      await assert.rejects(f.hosted(()=>f.problem.validateWork({...validate,leaseGeneration:claim.leaseGeneration+1})));
      await assert.rejects(f.hosted(()=>f.problem.validateWork({...validate,expectedWorkRevision:1})));
      await assert.rejects(f.callTool('save_assessment_work',{...validate,requestId:'S-rc1-forged',
        workJson:JSON.stringify({...command,checklistBinding:taskInput.checklistBinding})}));
      assert.deepEqual(await f.snapshot(),before);
    });

    const requestId='S-rc1-original';
    const saved=await f.callTool('save_assessment_work',{...validate,requestId});
    assert.equal(saved.workRevision,1);
    const expected=materializeJobAidWork(command,{workItemId:claim.task.workItemId,
      contentValidationVersion:taskInput.contentValidationVersion,checklistBinding:taskInput.checklistBinding,
      methodBinding:taskInput.modelInput.methodBinding,previous:null,evidence:taskInput.sourceCatalog,
      readSourceRefs:taskInput.initiallyDeliveredRefs,currentDeliveredSourceRefs:taskInput.initiallyDeliveredRefs,
      capabilities:taskInput.modelInput.capabilities,history:taskInput.modelInput.historyReview});
    // A separate authorized database read by immutable revision, not the SAVE return value or latest pointer.
    const read=await f.withBrowser(()=>f.problem.readBrowserRevision(claim.task.workItemId,saved.workRevisionRef,f.actor));
    assert.equal(read.workRevisionRef,saved.workRevisionRef);
    assert.equal(read.workRevision,1);
    assert.equal(read.requestId,requestId);
    assert.equal(read.actionAttemptId,claim.task.actionAttemptId);
    assert.deepEqual(read.content,expected);
    assert.deepEqual(read.content.checklistResults,command.checklistResults);
    assert.deepEqual(read.content.checklistBinding,taskInput.checklistBinding);
    assert.deepEqual(read.content.issues[0].methodUsage,command.issues[0].methodUsage);
    assert.equal(read.content.issues[0].requirementHandling.length,0);
    assert.equal(read.content.issues[0].measures[0].status,'VERIFIED_EFFECTIVE');
    const reading=require('../../shared/jobaid-problem-assessment.interface.ts').jobAidReadingResult(read);
    assert.equal(reading.candidateOnly,true);
    assert.equal(JSON.parse((await f.snapshot()).workItems[0].projection_json).integratedAssessment,null);
    assert.ok(read.content.issues[0].sourceDependencies.includes('method:risk'));
    const readOriginal=await f.hosted(()=>f.problem.readAttemptWork(claim.attemptRef,requestId,claim.task.workItemId,
      {leaseToken:claim.leaseToken,leaseGeneration:claim.leaseGeneration}));
    assert.deepEqual(readOriginal.revision,read,'original-S independent read remains exact');
    const replay=await f.callTool('save_assessment_work',{...validate,requestId});
    assert.equal(replay.replayed,true);
    assert.equal(replay.workRevisionRef,saved.workRevisionRef);
    const after=await f.snapshot();
    assert.equal(after.work.length,1);
    assert.deepEqual(after.workItems,before.workItems,'SAVE does not adopt or advance the WorkItem');
    await assert.rejects(f.hosted(()=>f.problem.validateWork(validate)),/JOBAID_WORK_REVISION_CONFLICT/u);
    assert.equal((await f.snapshot()).work.length,1);
  } finally {
    if(f) await f.close();
    if(old===undefined) delete process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];else process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]=old;
  }
});

test('RC1 mixed history fails before SAVE, then explicit regeneration SAVE/READ reaches real Overall', {timeout:120000}, async()=>{
  const old=process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]='true';
  let f;
  try {
    f=await startCoreP1HostFixture({browser:true,matter:true});
    const id='WI-rc1-history-synthetic';
    await f.seed(id,{executionModel:await captureModel(f)});
    await f.withReviewScope(id,async()=>{
      const legacy=await f.callTool('begin_dynamic_evaluation',{workItemId:id});
      assert.equal(legacy.task.modelInput.checklistBinding,undefined);
      const original=f.proposal(legacy);
      original.issues[0].issueKey='legacy';
      original.issues[0].body+=' 合成旧方法说明。 [[method:risk]]';
      original.issues[0].requirementHandling=[{methodRef:'method:risk',requirement:'合成旧要求',conditions:[],
        treatment:'LATER_BUSINESS_STAGE',basisRefs:[],explanation:'合成旧阶段边界',bodyQuote:'合成旧方法说明。'}];
      const first=await f.callTool('save_assessment_work',{attemptRef:legacy.attemptRef,workItemId:id,
        leaseToken:legacy.leaseToken,leaseGeneration:legacy.leaseGeneration,expectedWorkRevision:0,
        requestId:'S-legacy-original',workJson:JSON.stringify(original)});
      await f.callTool('commit_dynamic_evaluation_candidate',commitArgs(f,legacy,first.workRevisionRef));
      const legacyRead=await f.withBrowser(()=>f.problem.readBrowserRevision(id,first.workRevisionRef,f.actor));
      assert.equal(legacyRead.content.issues[0].methodUsage,undefined);
      const current=await f.workItems.loadTenantScopedProjection(id,f.tenantId);
      const requestId='00000000-0000-4000-8000-0000000000c2';
      await f.problem.enqueueContinuation(current.projection,f.tenantId,'synthetic-fixture-owner-scope',requestId,
        'INITIAL_PROBLEM_ASSESSMENT',undefined,undefined,undefined,{modelRef:'miaoda/glm-5.3',executionMode:'PROGRAM_AGENT_V1'});
      const claim=await f.callTool('begin_dynamic_evaluation',{workItemId:id,requestId});
      assert.equal(claim.task.modelInput.previousWork.workRevisionRef,first.workRevisionRef);
      const command=rc1Command(f,claim);
      command.unchangedIssueKeys=['legacy'];
      const args={attemptRef:claim.attemptRef,workItemId:id,leaseToken:claim.leaseToken,
        leaseGeneration:claim.leaseGeneration,expectedWorkRevision:1,workJson:JSON.stringify(command)};
      const before=await f.snapshot();
      const bad=await f.problem.validateWork(args);
      assert.equal(bad.status,'REPAIR_REQUIRED');
      assert.equal(bad.violations[0].code,'JOBAID_METHOD_USAGE_INVALID');
      assert.equal(bad.violations[0].fieldPath,'/issues');
      assert.match(bad.violations[0].message,/legacy/u);
      await assert.rejects(f.callTool('save_assessment_work',{...args,requestId:'S-mixed-rejected'}),/JOBAID_METHOD_USAGE_INVALID/u);
      assert.deepEqual(await f.snapshot(),before,'mixed candidates must never reach persistence');
      command.issues.push({...original.issues[0],methodUsage:[{methodRef:'method:risk',usage:'REFERENCE_ONLY',basisRefs:[]}]});
      command.unchangedIssueKeys=[];
      args.workJson=JSON.stringify(command);
      assert.equal((await f.problem.validateWork(args)).status,'VALID');
      const saved=await f.callTool('save_assessment_work',{...args,requestId:'S-regenerated-original'});
      const read=await readOriginal(f,claim,'S-regenerated-original');
      assert.equal(read.revision.workRevisionRef,saved.workRevisionRef);
      assert.equal(read.revision.content.issues.find(issue=>issue.issueKey==='legacy').methodUsage[0].usage,'REFERENCE_ONLY');
      assert.deepEqual(await f.withBrowser(()=>f.problem.readBrowserRevision(id,first.workRevisionRef,f.actor)),legacyRead,
        'old immutable revision is not rewritten');
      const projected=await f.callTool('commit_dynamic_evaluation_candidate',commitArgs(f,claim,saved.workRevisionRef));
      assert.equal(projected.overallSynthesis.basedOnJobAidWorkRevisionRef,saved.workRevisionRef);
      // Exercise the actual later Overall preflight, which formerly upgraded retained issues only after SAVE.
      const overall=await f.callTool('begin_overall_synthesis',{workItemId:id,requestId:'00000000-0000-4000-8000-0000000000c3'});
      const finished=await f.callTool('commit_overall_candidate',commitArgs(f,overall,saved.workRevisionRef,'合成重提交后逐项一致。'));
      assert.equal(finished.overallSynthesis.basedOnJobAidWorkRevisionRef,saved.workRevisionRef);
      const artifact=await f.readArtifact(finished.overallSynthesis.artifact);
      assert.deepEqual(artifact.analysis,read.revision);
      assert.equal(artifact.adopted,false);
    });
  } finally {
    if(f) await f.close();
    if(old===undefined) delete process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];else process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]=old;
  }
});

test('RC1 real scoped Review resolves the last unknown with an explicit owned checklist update only', {timeout:120000}, async()=>{
  const old=process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]='true';
  let f;
  try {
    f=await startCoreP1HostFixture({browser:true,matter:true});
    const {claim,command,validate}=await opened(f);
    const id=claim.task.workItemId;
    command.roundCompletion='COMPLETE_WITH_OPEN_QUESTIONS';
    command.issues[0].openQuestions=[{question:'合成最后未知',affects:'目标问题',nextEvidence:'合成已有材料核对',reason:'初评待核'}];
    command.issues.push({...structuredClone(command.issues[0]),issueKey:'other',openQuestions:[]});
    command.checklistResults[0].outcome='OPEN';
    command.checklistResults[1].resultRefs=[{issueKey:'other',fieldPath:'/body'}];
    command.checklistResults[2].resultRefs.push({issueKey:'other',fieldPath:'/body'});
    const saved=await f.callTool('save_assessment_work',{...validate,workJson:JSON.stringify(command),requestId:'S-before-review'});
    await readOriginal(f,claim,'S-before-review');
    await f.callTool('commit_dynamic_evaluation_candidate',commitArgs(f,claim,saved.workRevisionRef));
    const turn=await f.seedReviewTurn({workItemId:id,text:'仅核对合成目标问题的最后未知。',
      targetIssueKeys:['condition'],purpose:'UPDATE_ASSESSMENT'});
    const review=await f.withReviewScope(id,service=>service.begin(turn.reviewConversationId,turn.requestId,id));
    const task=review.task.modelInput.jobAidContext;
    const row=await f.hosted(()=>f.attempts.readScoped({attemptRef:review.attemptRef,tenantId:f.tenantId,workItemId:id}));
    const proposal={...command,issues:[{...command.issues[0],body:command.issues[0].body+' 合成最后未知已核对。',openQuestions:[]}],
      checklistResults:structuredClone(command.checklistResults),changeSummary:'仅显式解决目标问题及其清单结果。'};
    proposal.checklistResults[0].outcome='ANSWERED';
    const input={row,task,fence:{principalId:row.leaseOwner,leaseToken:review.leaseToken,leaseGeneration:review.leaseGeneration},
      requestId:'S-review-resolved',proposal,actualReadRefs:new Set(),targetIssueKeys:['condition']};
    const saveReview=value=>f.hosted(()=>f.work.withActorTransaction(f.actorUserId,database=>f.problem.saveReviewWork(value,database)));
    const before=await f.snapshot();
    for(const index of [1,2]) {
      const outside=structuredClone(proposal);
      // Row 1 is outside the target; row 2 has mixed target/non-target references.
      outside.checklistResults[index].basisRefs=[];
      assert.throws(()=>f.problem.prepareReviewWork(task,id,outside,new Set(),['condition']),/REVIEW_WORK_OUT_OF_SCOPE:checklistResults/u);
      await assert.rejects(saveReview({...input,requestId:`S-review-outside-${index}`,proposal:outside}),/REVIEW_WORK_OUT_OF_SCOPE:checklistResults/u);
      assert.deepEqual(await f.snapshot(),before);
    }
    const prepared=f.problem.prepareReviewWork(task,id,proposal,new Set(),['condition']);
    assert.equal(prepared.issues.find(issue=>issue.issueKey==='condition').openQuestions.length,0);
    assert.equal(prepared.checklistResults[0].outcome,'ANSWERED');
    assert.equal(prepared.roundCompletion,'COMPLETE_WITH_OPEN_QUESTIONS','Review cannot promote global completion');
    const result=await saveReview(input);
    const read=await f.withBrowser(()=>f.problem.readBrowserRevision(id,result.revision.workRevisionRef,f.actor));
    assert.deepEqual(read.content,prepared);
    assert.deepEqual(read.content.checklistBinding,task.previousWork.content.checklistBinding);
    assert.deepEqual(read.content.issues.find(issue=>issue.issueKey==='other'),task.previousWork.content.issues.find(issue=>issue.issueKey==='other'));
    assert.deepEqual((await f.snapshot()).workItems,before.workItems,'work save never adopts an engineering conclusion');
  } finally {
    if(f) await f.close();
    if(old===undefined) delete process.env[CANONICAL_EXECUTION_MODEL_V2_ENV];else process.env[CANONICAL_EXECUTION_MODEL_V2_ENV]=old;
  }
});
