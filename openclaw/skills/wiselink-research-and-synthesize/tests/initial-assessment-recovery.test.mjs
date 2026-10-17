import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectInitialAssessmentRecovery, assertFreshInitialAssessmentClaim, findInitialAssessmentRecovery,
  initialApplicabilityCheckpointPointerPath, finishInitialAssessmentPolicyFailure } from '../scripts/initial-assessment-recovery.mjs';
import { canonicalSha256 } from '../scripts/validate-payload.mjs';
import { createJobAidEvidenceCache, cacheJobAidSourceRead, projectJobAidContinuationContext } from '../scripts/jobaid-continuation-context.mjs';

function fixture() {
  const now = Date.now();
  const claim = { attemptRef: 'attempt-one', status: 'RUNNING', leaseGeneration: 1, leaseToken: 'old',
    leaseExpiresAt: new Date(now - 1000).toISOString(), task: { workItemId: 'WI-one', documentVersionId: 'DV-one',
      deadline: new Date(now + 600000).toISOString(), inputHash: 'frozen-input' } };
  const values = new Map([
    ['binding', { workItemId: 'WI-one', documentVersionId: 'DV-one', operation: 'EVALUATE_JOBAID', requestId: 'request-one' }],
    ['assessment-enabled', { version: 1 }], ['assessment-state', { round: 2 }], ['assessment-current-claim', claim],
  ]);
  const input = { workItemId: 'WI-one', operation: 'EVALUATE_JOBAID', now,
    initial: { status: 'BUSY', documentVersionId: 'DV-one', stages: { jobAid: {
      status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: 'attempt-one', requestId: 'request-one' } } },
    checkpoint: { readOptional: async key => values.get(key) ?? null } };
  return { input, values, claim };
}

test('an expired local claim and a completed round are only a recovery candidate', async () => {
  const f = fixture();
  f.values.set('assessment-round-2.started', {});
  f.values.set('assessment-round-2.result', { value: { raw: 'recorded-response' } });
  assert.equal((await inspectInitialAssessmentRecovery(f.input)).status, 'RECOVERY_CANDIDATE');
});

test('an unknown model response cannot dispatch another model or claim', async () => {
  const f = fixture(); f.values.set('assessment-round-2.started', {});
  const result = await inspectInitialAssessmentRecovery(f.input);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN');
  assert.equal('previousClaim' in result, false);
});

test('live, expired-deadline, wrong-request, completed and commit-started records do not recover', async () => {
  for (const change of [
    f => { f.claim.leaseExpiresAt = new Date(f.input.now + 1000).toISOString(); },
    f => { f.claim.task.deadline = new Date(f.input.now - 1000).toISOString(); },
    f => { f.input.initial.stages.jobAid.requestId = 'different'; },
    f => { f.values.set('run-result', { status: 'REQUIRES_ATTENTION' }); },
    f => { f.values.set('commit_dynamic_evaluation_candidate-1.started', {}); },
  ]) { const f = fixture(); change(f); assert.equal(await inspectInitialAssessmentRecovery(f.input), null); }
});

test('sealed JobAid and Overall attempts recover the exact result after an attention receipt', async () => {
  for (const [operation, stage, begin] of [
    ['EVALUATE_JOBAID', 'jobAid', 'begin_dynamic_evaluation'],
    ['SYNTHESIZE_OVERALL', 'overall', 'begin_overall_synthesis'],
  ]) {
    const f = fixture();
    f.input.operation = operation;
    f.input.initial.stages = { [stage]: { status: 'BUSY', attemptStatus: 'COMMITTING',
      attemptRef: f.claim.attemptRef, requestId: 'request-one' } };
    f.values.set('binding', { workItemId: 'WI-one', documentVersionId: 'DV-one', operation,
      requestId: 'request-one' });
    f.values.set('assessment-enabled', { generationPolicy: { loopPolicyVersion: 'stage-protocol-progress-v1' } });
    f.values.set('assessment-state', { round: 4, protocolRepairs: null, noProgressRepairs: null });
    f.values.set(`${begin}-1.result`, { value: f.claim });
    f.values.set('run-result', { status: 'REQUIRES_ATTENTION', stageStatus: 'BUSY' });
    f.values.set('commit_overall_candidate-1.started', {});
    assert.equal((await inspectInitialAssessmentRecovery(f.input)).status, 'RECOVERY_COMMITTING');
    f.input.initial.stages[stage].attemptRef = 'different';
    assert.equal(await inspectInitialAssessmentRecovery(f.input), null);
  }
});

test('fresh Host claim must advance the generation with the identical task binding', () => {
  const { claim } = fixture();
  const current = { ...claim, leaseToken: 'new', leaseGeneration: 2, leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  assert.doesNotThrow(() => assertFreshInitialAssessmentClaim(claim, current));
  assert.throws(() => assertFreshInitialAssessmentClaim(claim, { ...current, leaseGeneration: 1 }), /STILL_OWNED/);
  assert.throws(() => assertFreshInitialAssessmentClaim(claim, { ...current, task: { ...current.task, inputHash: 'changed' } }), /BINDING_MISMATCH/);
  assert.throws(() => assertFreshInitialAssessmentClaim(claim, { ...current, leaseExpiresAt: claim.leaseExpiresAt }), /LEASE_EXPIRED/);
});

test('applicability recovery uses the exact expired claim and refuses an unknown model output',async()=>{
  const f=fixture();
  f.input.operation='EXTRACT_APPLICABILITY';
  f.input.initial.stages={applicability:{status:'BUSY',attemptStatus:'RUNNING',attemptRef:'attempt-one'}};
  f.values.set('binding',{workItemId:'WI-one',documentVersionId:'DV-one',operation:'EXTRACT_APPLICABILITY',requestId:'request-one'});
  f.values.set('begin_applicability_evaluation-1.result',{value:f.claim});
  assert.equal((await inspectInitialAssessmentRecovery(f.input)).status,'RECOVERY_CANDIDATE');
  f.values.set('model.started',{});
  const unknown=await inspectInitialAssessmentRecovery(f.input);
  assert.equal(unknown.status,'REQUIRES_ATTENTION');
  assert.equal(unknown.errorCode,'INITIAL_APPLICABILITY_MODEL_OUTCOME_UNKNOWN');
  f.values.set('model.result',{value:{output:'saved'}});
  assert.equal((await inspectInitialAssessmentRecovery(f.input)).status,'RECOVERY_CANDIDATE');
});

test('a sealed applicability commit is only a read-only recovery candidate',async()=>{
  const f=fixture();
  f.input.operation='EXTRACT_APPLICABILITY';
  f.input.initial.stages={applicability:{status:'BUSY',attemptStatus:'COMMITTING',attemptRef:'attempt-one'}};
  f.values.set('binding',{workItemId:'WI-one',documentVersionId:'DV-one',operation:'EXTRACT_APPLICABILITY',requestId:'request-one'});
  f.values.set('begin_applicability_evaluation-1.result',{value:f.claim});
  f.values.set('commit_applicability_candidate-1.started',{});
  assert.equal((await inspectInitialAssessmentRecovery(f.input)).status,'RECOVERY_COMMITTING');
});

test('Overall recovery preserves an earlier attention receipt and saves the new readback', async t => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-overall-committing-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const options = { checkpointRoot, workItemId: 'WI-one', maxInitialStages: 1,
    initialStageOnly: true, expectedInitialOperation: 'SYNTHESIZE_OVERALL' };
  const f = fixture();
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(
    options, 'SYNTHESIZE_OVERALL', 'request-one'));
  await checkpoint.write('binding', { workItemId: 'WI-one', documentVersionId: 'DV-one',
    operation: 'SYNTHESIZE_OVERALL', requestId: 'request-one' });
  await checkpoint.write('begin_overall_synthesis-1.result', { value: f.claim });
  await checkpoint.write('run-result', { status: 'REQUIRES_ATTENTION',
    operation: 'SYNTHESIZE_OVERALL', stageStatus: 'BUSY' });
  await checkpoint.write('commit_overall_candidate-1.started', { argsHash: 'old-response-unknown' });
  await checkpoint.write('commit_overall_candidate-1.error', { code: 'TRANSPORT_RESPONSE_LOST' });
  const busy = { status: 'BUSY', workItemRevision: 3, documentVersionId: 'DV-one',
    candidateOnly: true, nextOperation: null, stages: {
      translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'BUSY', attemptStatus: 'COMMITTING',
        attemptRef: 'attempt-one', requestId: 'request-one' } } };
  const done = { ...busy, status: 'SUCCEEDED', workItemRevision: 4,
    stages: { ...busy.stages, overall: { status: 'SUCCEEDED' } } };
  let reads = 0;
  let commits = 0;
  const report = await consumeHostedWorkItem(options, {
    callTool: async name => {
      if (name === 'get_parse_status') return { entry: { workItemId: 'WI-one' },
        initialAnalysis: reads++ === 0 || commits === 0 ? busy : done };
      if (name === 'get_action_attempt_status') return { attemptRef: f.claim.attemptRef, status: 'COMMITTING',
        recoveryAvailable: true, resultContentHash: 'sealed-hash', recoveryResult: { contentHash: 'sealed-hash' } };
      if (name === 'begin_overall_synthesis') return { ...f.claim, status: 'COMMITTING' };
      if (name === 'commit_overall_candidate') { commits += 1; return { status: 'OVERALL_CANDIDATE_READY' }; }
      assert.fail(name);
    },
    runInitial: async run => { await run.callTool('begin_overall_synthesis', {});
      await run.callTool('commit_overall_candidate', { attemptRef: 'attempt-one', phase: 'COMMIT' });
      return { outcome: 'COMMITTING_REPLAYED' }; },
    invokeInitialModel: async () => assert.fail('sealed recovery must not rerun the model'),
  });
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  assert.equal(commits, 1);
  assert.equal((await checkpoint.readOptional('run-result')).status, 'REQUIRES_ATTENTION');
  assert.equal((await checkpoint.readOptional('committing-recovery-result')).status, 'INITIAL_STAGE_SAVED');
});

test('applicability active pointer stays on the admission revision while Host revision advances',async t=>{
  const checkpointRoot=await mkdtemp(join(tmpdir(),'wiselink-applicability-pointer-'));
  t.after(()=>rm(checkpointRoot,{recursive:true,force:true}));
  const options={checkpointRoot,workItemId:'WI-one'};
  const pointer=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
  await pointer.write('active',{workItemRevision:2,requestId:null});
  const checkpoint=await createCheckpointStore(initialStageCheckpointPath({...options,initialWorkItemRevision:2},'EXTRACT_APPLICABILITY'));
  const f=fixture();
  await checkpoint.write('binding',{workItemId:'WI-one',documentVersionId:'DV-one',operation:'EXTRACT_APPLICABILITY',requestId:'request-one'});
  await checkpoint.write('begin_applicability_evaluation-1.result',{value:f.claim});
  const initial={status:'BUSY',workItemRevision:3,documentVersionId:'DV-one',stages:{applicability:{
    status:'BUSY',attemptStatus:'RUNNING',attemptRef:'attempt-one'}}};
  const recovery=await findInitialAssessmentRecovery(options,initial);
  assert.equal(recovery.status,'RECOVERY_CANDIDATE');
  assert.equal(recovery.initialWorkItemRevision,2);
});

test('consumer reclaims an expired applicability attempt with the same task and a newer lease',async t=>{
  const checkpointRoot=await mkdtemp(join(tmpdir(),'wiselink-applicability-resume-'));
  t.after(()=>rm(checkpointRoot,{recursive:true,force:true}));
  const options={checkpointRoot,workItemId:'WI-one',maxInitialStages:1,initialStageOnly:true,
    expectedInitialOperation:'EXTRACT_APPLICABILITY'};
  const f=fixture();
  const pointer=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
  await pointer.write('active',{workItemRevision:2,requestId:null});
  const checkpoint=await createCheckpointStore(initialStageCheckpointPath({...options,initialWorkItemRevision:2},'EXTRACT_APPLICABILITY'));
  await checkpoint.write('binding',{workItemId:'WI-one',documentVersionId:'DV-one',operation:'EXTRACT_APPLICABILITY',requestId:'request-one'});
  await checkpoint.write('begin_applicability_evaluation-1.result',{value:f.claim});
  const busy={workItemRevision:3,documentVersionId:'DV-one',candidateOnly:true,status:'BUSY',nextOperation:null,
    applicabilityContextRef:'APCTX-one',stages:{translation:{status:'SUCCEEDED'},applicability:{
      status:'BUSY',attemptStatus:'RUNNING',attemptRef:'attempt-one'},jobAid:{status:'PENDING'},overall:{status:'PENDING'}}};
  const fresh={...f.claim,leaseGeneration:2,leaseToken:'fresh',leaseExpiresAt:new Date(Date.now()+60000).toISOString()};
  let began=0;
  const result=await consumeHostedWorkItem(options,{
    callTool:async(name,args)=>{
      if(name==='get_parse_status') return {entry:{workItemId:'WI-one'},initialAnalysis:began
        ? {...busy,status:'REQUIRED',workItemRevision:4,nextOperation:'EVALUATE_JOBAID',stages:{...busy.stages,
          applicability:{status:'SUCCEEDED'}}} : busy};
      if(name==='begin_applicability_evaluation'){
        assert.deepEqual(args,{applicabilityContextRef:'APCTX-one',requestId:'request-one'});
        began+=1;return fresh;
      }
      assert.fail(name);
    },
    runInitial:async run=>{await run.callTool('begin_applicability_evaluation',{
      applicabilityContextRef:run.applicabilityContextRef,requestId:run.requestId});
      return {outcome:'CANDIDATE_READY'};},
  });
  assert.equal(result.status,'INITIAL_STAGE_SAVED');
  assert.equal(began,1);
});

test('consumer routes a sealed applicability attempt to read-only COMMITTING recovery',async t=>{
  const checkpointRoot=await mkdtemp(join(tmpdir(),'wiselink-applicability-committing-'));
  t.after(()=>rm(checkpointRoot,{recursive:true,force:true}));
  const options={checkpointRoot,workItemId:'WI-one',maxInitialStages:1,initialStageOnly:true,
    expectedInitialOperation:'EXTRACT_APPLICABILITY'};
  const f=fixture();
  const pointer=await createCheckpointStore(initialApplicabilityCheckpointPointerPath(options));
  await pointer.write('active',{workItemRevision:2,requestId:null});
  const checkpoint=await createCheckpointStore(initialStageCheckpointPath({...options,initialWorkItemRevision:2},'EXTRACT_APPLICABILITY'));
  await checkpoint.write('binding',{workItemId:'WI-one',documentVersionId:'DV-one',operation:'EXTRACT_APPLICABILITY',requestId:'request-one'});
  await checkpoint.write('begin_applicability_evaluation-1.result',{value:f.claim});
  await checkpoint.write('commit_applicability_candidate-1.started',{});
  const busy={workItemRevision:3,documentVersionId:'DV-one',candidateOnly:true,status:'BUSY',nextOperation:null,
    applicabilityContextRef:'APCTX-one',stages:{translation:{status:'SUCCEEDED'},applicability:{
      status:'BUSY',attemptStatus:'COMMITTING',attemptRef:'attempt-one'},jobAid:{status:'PENDING'},overall:{status:'PENDING'}}};
  let beginCalls=0; let statusCalls=0;
  const result=await consumeHostedWorkItem(options,{
    callTool:async(name,args)=>{
      if(name==='get_parse_status') return {entry:{workItemId:'WI-one'},initialAnalysis:busy};
      if(name==='begin_applicability_evaluation'){
        assert.deepEqual(args,{applicabilityContextRef:'APCTX-one',requestId:'request-one'});
        beginCalls+=1;return {...f.claim,status:'COMMITTING'};
      }
      if(name==='get_action_attempt_status'){statusCalls+=1;return {status:'COMMITTING'};}
      assert.fail(name);
    },
    runInitial:async run=>{
      await run.callTool('begin_applicability_evaluation',{applicabilityContextRef:run.applicabilityContextRef,requestId:run.requestId});
      await run.callTool('get_action_attempt_status',{attemptRef:'attempt-one'});
      return {outcome:'COMMITTING_RECOVERY_READ_ONLY'};
    },
    invokeInitialModel:async()=>assert.fail('COMMITTING recovery must not invoke a model'),
  });
  assert.equal(result.status,'REQUIRES_ATTENTION');
  assert.equal(beginCalls,1);
  assert.equal(statusCalls,1);
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { consumeHostedWorkItem, consumeAutomaticWorkItemQueueTick } from '../scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';

async function consumerFixture(t) {
  const f = fixture();
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-assessment-recovery-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const options = { checkpointRoot, workItemId: 'WI-one', maxInitialStages: 1 };
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(options, 'EVALUATE_JOBAID', 'request-one'));
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2' };
  f.claim.modelInput = modelInput;
  for (const [key, value] of f.values) await checkpoint.write(key, value);
  const initial = { ...f.input.initial, candidateOnly: true, workItemRevision: 1, nextOperation: null,
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'SUCCEEDED' },
      overall: { status: 'PENDING' }, ...f.input.initial.stages } };
  let finished = false;
  const calls = [];
  const freshClaim = { ...f.claim, leaseGeneration: 2, leaseToken: 'new-token', leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  const deps = {
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status') return { entry: { workItemId: 'WI-one' }, initialAnalysis: finished
        ? { ...initial, status: 'REQUIRED', nextOperation: 'SYNTHESIZE_OVERALL', stages: { ...initial.stages, jobAid: { status: 'SUCCEEDED' } } } : initial };
      if (name === 'begin_dynamic_evaluation') return freshClaim;
      if (name === 'heartbeat_action_attempt') { assert.equal(args.leaseToken, 'new-token'); return { leaseExpiresAt: freshClaim.leaseExpiresAt }; }
      if (name === 'read_assessment_sources') return { status: 'AVAILABLE', evidence: [] };
      throw new Error(`unexpected ${name}`);
    },
    runInitial: async run => {
      const claim = await run.callTool('begin_dynamic_evaluation', { workItemId: run.workItemId, requestId: run.requestId });
      await run.evaluateDynamicRules(claim.modelInput, {
        heartbeat: () => run.callTool('heartbeat_action_attempt', { attemptRef: claim.attemptRef, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration }),
        readAssessmentSources: () => run.callTool('read_assessment_sources', { attemptRef: claim.attemptRef }),
      });
      finished = true;
      return { outcome: 'CANDIDATE_READY' };
    },
    invokeInitialModel: async (_input, hooks) => {
      assert.equal((await hooks.assessmentCheckpoint.readOptional('assessment-state')).round, 2);
      assert.equal(hooks.taskDeadline, freshClaim.task.deadline);
      await hooks.heartbeat(); await hooks.heartbeat();
      await hooks.readAssessmentSources(); await hooks.readAssessmentSources();
    },
  };
  return { options, deps, checkpoint, calls, freshClaim };
}

test('consumer reclaims the exact expired request, restores round state and uses fresh Host reads and heartbeats', async t => {
  const f = await consumerFixture(t);
  const result = await consumeHostedWorkItem({ ...f.options,
    initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID' }, f.deps);
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  const begin = f.calls.find(call => call.name === 'begin_dynamic_evaluation');
  assert.equal(begin.args.requestId, 'request-one');
  assert.equal(f.calls.filter(call => call.name === 'heartbeat_action_attempt').length, 2);
  assert.equal(f.calls.filter(call => call.name === 'read_assessment_sources').length, 2);
  assert.equal((await f.checkpoint.readOptional('assessment-current-claim')).leaseGeneration, 2);
});

test('a lease renewed by a live worker stays BUSY and cannot invoke or cancel it', async t => {
  const f = await consumerFixture(t); f.freshClaim.leaseGeneration = 1;
  f.deps.invokeInitialModel = async () => assert.fail('must not invoke');
  const result = await consumeHostedWorkItem(f.options, f.deps);
  assert.equal(result.status, 'BUSY');
  assert.deepEqual(f.calls.map(call => call.name), ['get_parse_status', 'begin_dynamic_evaluation']);
  assert.equal(await f.checkpoint.readOptional('run-result'), null);
});

test('consumer surfaces an ambiguous round without any begin, model or cancellation', async t => {
  const f = await consumerFixture(t);
  await f.checkpoint.write('assessment-round-2.started', { startedAt: new Date().toISOString() });
  const result = await consumeHostedWorkItem(f.options, f.deps);
  assert.equal(result.errorCode, 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN');
  assert.deepEqual(f.calls.map(call => call.name), ['get_parse_status']);
});

test('fresh begin authorization denial never consumes saved context or cancels an unclaimed attempt', async t => {
  const f = await consumerFixture(t);
  const call = f.deps.callTool;
  f.deps.callTool = async (name, args) => {
    if (name === 'begin_dynamic_evaluation') throw new Error('JOBAID_SOURCE_AUTHORIZATION_DENIED');
    return call(name, args);
  };
  f.deps.invokeInitialModel = async () => assert.fail('must not invoke');
  await assert.rejects(consumeHostedWorkItem(f.options, f.deps), /SOURCE_AUTHORIZATION_DENIED/);
  assert.equal((await f.checkpoint.readOptional('assessment-current-claim')).leaseGeneration, 1);
  assert.equal(await f.checkpoint.readOptional('run-result'), null);
});

test('new-policy damaged repair counters are observations rather than takeover candidates', async () => {
  for (const key of ['protocolRepairs', 'noProgressRepairs']) for (const value of [undefined, null, 2, '1']) {
    const f = fixture();
    f.values.set('assessment-enabled', { generationPolicy: { loopPolicyVersion: 'stage-protocol-progress-v1' } });
    const state = { round: 4, protocolRepairs: 1, noProgressRepairs: 0 };
    if (value === undefined) delete state[key]; else state[key] = value;
    f.values.set('assessment-state', state);
    const result = await inspectInitialAssessmentRecovery(f.input);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
    assert.equal(Object.hasOwn(result, 'previousClaim'), false);
  }
});

async function repairBudgetFixture(t) {
  const f = await consumerFixture(t);
  await f.checkpoint.write('assessment-enabled', { generationPolicy: { loopPolicyVersion: 'stage-protocol-progress-v1' } });
  const state = { round: 2, protocolRepairs: 1, noProgressRepairs: 0 };
  await f.checkpoint.write('assessment-state', state);
  const revision = { requestId: 'original-save-key', actionAttemptId: 'owned-db-attempt',
    workRevisionRef: 'JAWR-original', workItemId: 'WI-one', documentVersionId: 'DV-one',
    content: { roundCompletion: 'IN_PROGRESS' } };
  const readback = { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: revision.actionAttemptId,
    executionStatus: 'RUNNING', revision };
  const call = f.deps.callTool;
  f.deps.callTool = async (name, args) => {
    if (name !== 'read_assessment_work') return call(name, args);
    f.calls.push({ name, args });
    return readback;
  };
  return { ...f, state, readback };
}

test('damaged stage budget still reads authorized Host latest and original SAVE key before attention', async t => {
  for (const value of [undefined, null]) {
    const f = await repairBudgetFixture(t);
    if (value === undefined) delete f.state.protocolRepairs; else f.state.protocolRepairs = value;
    await f.checkpoint.write('assessment-state', f.state);
    f.deps.runInitial = async () => assert.fail('a damaged budget cannot begin or dispatch a model');
    const claim = await f.checkpoint.readOptional('assessment-current-claim');
    const result = await consumeHostedWorkItem(f.options, f.deps);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
    assert.equal(result.savedWorkRevisionRef, f.readback.revision.workRevisionRef);
    assert.deepEqual(f.calls.map(call => call.name), ['get_parse_status', 'read_assessment_work', 'read_assessment_work']);
    assert.deepEqual(f.calls.slice(1).map(call => call.args), [
      { attemptRef: 'attempt-one', workItemId: 'WI-one' },
      { attemptRef: 'attempt-one', workItemId: 'WI-one', requestId: 'original-save-key' },
    ]);
    assert.deepEqual(await f.checkpoint.readOptional('assessment-state'), f.state);
    assert.deepEqual(await f.checkpoint.readOptional('assessment-current-claim'), claim);
    assert.equal(await f.checkpoint.readOptional('run-result'), null);
  }
});

test('policy fallback preserves Host authorization failures, exact readback binding and cancellation', async t => {
  for (const kind of ['latest-denied', 'original-denied', 'original-drift', 'cancelled']) {
    const f = await repairBudgetFixture(t);
    f.state.noProgressRepairs = null;
    await f.checkpoint.write('assessment-state', f.state);
    f.deps.runInitial = async () => assert.fail('policy fallback cannot begin or invoke a model');
    const denied = Object.assign(new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED'), { hostErrorCode: 'JOBAID_SOURCE_AUTHORIZATION_CHANGED' });
    const call = f.deps.callTool;
    f.deps.callTool = async (name, args) => {
      if (name === 'read_assessment_work') {
        if ((kind === 'latest-denied' && !args.requestId) || (kind === 'original-denied' && args.requestId)) throw denied;
        if (kind === 'original-drift' && args.requestId)
          return { ...f.readback, revision: { ...f.readback.revision, workRevisionRef: 'JAWR-different' } };
      }
      return call(name, args);
    };
    if (kind === 'cancelled') {
      f.readback.executionStatus = 'CANCELLED';
      assert.equal((await consumeHostedWorkItem(f.options, f.deps)).errorCode, 'ACTION_ATTEMPT_ALREADY_CANCELLED');
    } else if (kind.endsWith('denied')) await assert.rejects(consumeHostedWorkItem(f.options, f.deps), error => error === denied);
    else await assert.rejects(consumeHostedWorkItem(f.options, f.deps), /INITIAL_SAVED_WORK_READBACK_INVALID/u);
    assert.equal(f.calls.some(call => call.name.startsWith('begin_') || call.name === 'heartbeat_action_attempt'), false);
    assert.equal((await f.checkpoint.readOptional('assessment-current-claim')).leaseGeneration, 1);
    assert.deepEqual(await f.checkpoint.readOptional('assessment-state'), f.state);
  }
});

test('a valid new-policy repair budget retains ordinary exact recovery', async t => {
  const f = await repairBudgetFixture(t);
  const result = await consumeHostedWorkItem({ ...f.options, initialStageOnly: true,
    expectedInitialOperation: 'EVALUATE_JOBAID' }, f.deps);
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(f.calls.filter(call => call.name === 'begin_dynamic_evaluation').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 0);
  assert.equal((await f.checkpoint.readOptional('assessment-current-claim')).leaseGeneration, 2);
});

async function settledPolicyFixture(t, { compact = false } = {}) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-settled-policy-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const options = { checkpointRoot, workItemId: 'WI-one', initialStageOnly: true, maxInitialStages: 1 };
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(options, 'EVALUATE_JOBAID', 'request-one'));
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2',
    purpose: 'INITIAL_PROBLEM_ASSESSMENT', expectedWorkRevision: 0,
    documentOverview: { documentVersionRef: 'DV-one' }, deliveredEvidence: [] };
  const executionModel = { modelRef: 'synthetic/model', displayName: 'Synthetic', providerKind: 'BUILT_IN',
    settingsRevision: 7, selectedAt: new Date().toISOString() };
  const body = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1', taskType: 'OPENCLAW_DYNAMIC_EVALUATION',
    actionAttemptId: 'ATT-one', operationRef: 'AQ-one', tenantId: 'tenant-one',
    workItemId: 'WI-one', documentVersionId: 'DV-one', priority: 100, inputRevision: 1, baseRevision: 1,
    sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [], executionModel,
    modelInput: { modelInput, automaticWorkItemLease: { requestId: 'REQ-queue-one', leaseGeneration: 2 } },
    deadline: new Date(Date.now() + 3600000).toISOString(), idempotencyKey: 'initial-one' };
  const claim = { status: 'RUNNING', attemptRef: 'AQ-one', leaseToken: 'old-attempt-token', leaseGeneration: 1,
    leaseExpiresAt: new Date(Date.now() - 1000).toISOString(), task: { ...body, inputHash: canonicalSha256(body) }, modelInput };
  const fresh = { ...claim, leaseToken: 'new-attempt-token', leaseGeneration: 2,
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  const revision = { requestId: 'original-save-key', actionAttemptId: 'ATT-one', workItemId: 'WI-one', documentVersionId: 'DV-one',
    basedOnWorkItemRevision: 1, workRevisionRef: 'JAWR-one', workRevision: 1, content: { roundCompletion: 'IN_PROGRESS' } };
  const saved = { schemaVersion: 'wiselink.jobaid-work-read.v2', attemptId: 'ATT-one', executionStatus: 'RUNNING', revision };
  const parameters = { sourceRefs: ['PR-synthetic:SR-one'], purpose: 'Check a distinct exact passage', context: compact ? 'PAGE' : 'EXACT' };
  const fullReceipt = { schemaVersion: 'wiselink.jobaid-source-read.v2', status: 'AVAILABLE',
    sourceRefs: parameters.sourceRefs, scope: parameters.context, completeRequestedScope: true,
    evidence: compact ? [{ evidenceRef: 'PR-synthetic:SR-one', kind: 'DOCUMENT_PASSAGE', excerpt: 'First exact synthetic body.' },
      { evidenceRef: 'PR-synthetic:SR-two', kind: 'DOCUMENT_PASSAGE', excerpt: 'Second exact synthetic body in the requested page.' }] : [] };
  const cached = compact ? cacheJobAidSourceRead(createJobAidEvidenceCache(modelInput), fullReceipt) : null;
  const receipt = cached?.receipt ?? fullReceipt;
  const state = { round: 4, protocolRepairs: null, noProgressRepairs: 0, inputUnits: 100, outputUnits: 30,
    expectedWorkRevision: 1, saved: { requestId: revision.requestId, workRevisionRef: revision.workRevisionRef,
      workRevision: 1, roundCompletion: 'IN_PROGRESS' },
    lastObservation: { action: 'READ_SOURCES', parameters, result: receipt },
    messages: [{ role: 'user', content: JSON.stringify({ schemaVersion: 'wiselink.jobaid-source-read-continuation.v1',
      status: 'HOST_SOURCE_READ_CONFIRMED', expectedWorkRevision: 1, sourceReadReceipt: receipt }) }] };
  if (compact) {
    state.evidenceCache = cached.cache;
    state.messages.unshift({ role: 'system', content: 'Synthetic existing stage instructions.' },
      { role: 'user', content: JSON.stringify(projectJobAidContinuationContext(modelInput, cached.cache, null)) });
  }
  const payload = step => ({ model: 'synthetic-provider-model', choices: [{ message: { role: 'assistant', content: null,
    tool_calls: [{ id: 'call-one', type: 'function', function: { name: 'return_wiselink_assessment_step',
      arguments: JSON.stringify({ step }) } }] } }] });
  const responses = [payload({ action: 'SAVE_WORK', workJson: JSON.stringify(revision.content) }),
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'A complete response without the named tool.' } }] },
    payload({ action: 'READ_SOURCES', ...parameters })];
  await checkpoint.write('binding', { workItemId: 'WI-one', documentVersionId: 'DV-one',
    operation: 'EVALUATE_JOBAID', requestId: 'request-one' });
  await checkpoint.write('assessment-enabled', { version: 1, startedAt: Date.now() - 1000,
    binding: { operation: 'EVALUATE_JOBAID', modelInput, executionModel, sessionDiscriminator: 'request-one' },
    generationPolicy: { loopPolicyVersion: 'stage-protocol-progress-v1',
      ...(compact ? { contextProjectionVersion: 'shared-evidence-target-work-v2' } : {}) } });
  await checkpoint.write('assessment-current-claim', claim);
  await checkpoint.write('assessment-state', state);
  for (let round = 1; round <= responses.length; round++)
    await checkpoint.remoteStep({ step: `assessment-round-${round}`, args: { syntheticRound: round },
      perform: async () => ({ ok: true, status: 200, localTransportRequestOrdinal: round,
        raw: JSON.stringify(responses[round - 1]) }) });
  const initial = { workItemId: 'WI-one', candidateOnly: true, status: 'BUSY', nextOperation: null, workItemRevision: 1, documentVersionId: 'DV-one',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'SUCCEEDED' }, overall: { status: 'PENDING' },
      jobAid: { status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: 'AQ-one', requestId: 'request-one' } } };
  const calls = [];
  let committed;
  const currentStatus = () => committed ? { ...initial, status: 'FAILED', stages: { ...initial.stages,
    jobAid: { ...initial.stages.jobAid, status: 'FAILED', attemptStatus: 'FAILED', terminalCode: committed.errorCode } } } : initial;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return { entry: { workItemId: 'WI-one' }, initialAnalysis: currentStatus() };
    if (name === 'read_assessment_work') return saved;
    if (name === 'begin_dynamic_evaluation') return fresh;
    if (name === 'heartbeat_action_attempt') {
      assert.equal(args.leaseGeneration, 2); assert.equal(args.leaseToken, fresh.leaseToken);
      return { leaseExpiresAt: fresh.leaseExpiresAt };
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      assert.equal(args.leaseGeneration, 2); assert.equal(args.leaseToken, fresh.leaseToken);
      assert.equal(args.result.status, 'FAILED'); assert.equal(args.result.modelOutput, null);
      committed = args.result;
      return { status: 'FAILED', attemptRef: 'AQ-one', errorCode: args.result.errorCode };
    }
    if (name === 'get_deep_link') return {};
    assert.fail(`unexpected policy closure tool ${name}`);
  };
  const deps = { callTool, invokeInitialModel: () => assert.fail('close-only never dispatches a model') };
  return { options, checkpoint, claim, fresh, saved, state, initial, calls, deps, currentStatus };
}

test('a proved settled partial loop closes through a fresh fence without restoring budget or requiring finish_reason', async t => {
  for (const counter of [undefined, null]) {
    const f = await settledPolicyFixture(t);
    if (counter === undefined) delete f.state.protocolRepairs;
    await f.checkpoint.write('assessment-state', f.state);
    const report = await consumeHostedWorkItem(f.options, f.deps);
    assert.equal(report.outcome, 'FAILED');
    assert.equal(report.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
    assert.equal(report.modelCallCount, 0);
    assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 4);
    assert.equal(f.calls.filter(call => call.name === 'begin_dynamic_evaluation').length, 1);
    assert.equal(f.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
    assert.equal(f.calls.some(call => ['save_assessment_work', 'cancel_action_attempt'].includes(call.name)), false);
    const sealed = f.calls.find(call => call.name === 'commit_dynamic_evaluation_candidate').args.result;
    assert.equal(sealed.modelVersion, 'synthetic-provider-model');
    assert.equal(sealed.runMetrics.inputUnits, 100, 'retain the preceding real responses, not a fictional zero-model stage');
    assert.equal(sealed.runMetrics.outputUnits, 30);
    assert.deepEqual(await f.checkpoint.readOptional('assessment-state'), f.state);
    assert.equal((await f.checkpoint.readOptional('assessment-current-claim')).leaseGeneration, 2);
  }
});

test('close-only resolves the actual compact read index against the original cache and its one-body projection', async t => {
  const f = await settledPolicyFixture(t, { compact: true });
  assert.equal(f.state.lastObservation.result.cachedReadIndex, 0);
  assert.equal(Object.hasOwn(f.state.lastObservation.result, 'sourceRefs'), false);
  assert.equal(f.state.evidenceCache.reads[0].evidenceRefs.length, 2, 'PAGE bodies need not equal requested sourceRefs');
  const report = await consumeHostedWorkItem(f.options, f.deps);
  assert.equal(report.outcome, 'FAILED');
  assert.equal(report.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
  assert.equal(report.modelCallCount, 0);
  assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 4);
  assert.equal(f.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.deepEqual(await f.checkpoint.readOptional('assessment-state'), f.state, 'the proof does not copy or rewrite the evidence');
});

test('compact read proof rejects missing, mixed or invalid indices and changed cached metadata, binding or body', async t => {
  const mutations = [
    s => { delete s.lastObservation.result.cachedReadIndex; },
    s => { s.lastObservation.result.cachedReadIndex = null; },
    s => { s.lastObservation.result.cachedReadIndex = '0'; },
    s => { s.lastObservation.result.cachedReadIndex = 0.5; },
    s => { s.lastObservation.result.cachedReadIndex = -1; },
    s => { s.lastObservation.result.cachedReadIndex = 1; },
    s => { delete s.evidenceCache; },
    s => { s.evidenceCache.reads[0].receiptKind = 'KNOWLEDGE_QUERY'; },
    s => { s.evidenceCache.reads[0].sourceRefs = ['PR-other:SR-one']; },
    s => { s.evidenceCache.reads[0].scope = 'EXACT'; },
    s => { s.evidenceCache.evidence.pop(); },
    s => { s.evidenceCache.evidence[0].excerpt = 'Changed body'; },
    s => { const c = JSON.parse(s.messages[1].content); c.documentOverview.documentVersionRef = 'DV-other'; s.messages[1].content = JSON.stringify(c); },
    s => { const c = JSON.parse(s.messages.at(-1).content); delete c.sourceReadReceipt.cachedReadIndex; s.messages.at(-1).content = JSON.stringify(c); },
  ];
  for (const mutate of mutations) {
    const f = await settledPolicyFixture(t, { compact: true });
    mutate(f.state);
    await f.checkpoint.write('assessment-state', f.state);
    const report = await consumeHostedWorkItem(f.options, f.deps);
    assert.equal(report.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
    assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 2);
    assert.equal(f.calls.some(call => call.name.startsWith('begin_') || call.name.startsWith('commit_')), false);
  }
});

test('a compact checkpoint cannot lose both indices and impersonate a legacy direct receipt', async t => {
  for (const kind of ['changed-cache', 'missing-cache', 'declared-projection-only']) {
    const f = await settledPolicyFixture(t, { compact: true });
    const refs = f.state.lastObservation.parameters.sourceRefs;
    delete f.state.lastObservation.result.cachedReadIndex;
    f.state.lastObservation.result.sourceRefs = refs;
    const continuation = JSON.parse(f.state.messages.at(-1).content);
    delete continuation.sourceReadReceipt.cachedReadIndex;
    continuation.sourceReadReceipt.sourceRefs = refs;
    f.state.messages.at(-1).content = JSON.stringify(continuation);
    if (kind === 'changed-cache') f.state.evidenceCache.reads[0].scope = 'EXACT';
    else delete f.state.evidenceCache;
    if (kind === 'declared-projection-only') {
      const context = JSON.parse(f.state.messages[1].content);
      delete context.deliveredSourceReads;
      f.state.messages[1].content = JSON.stringify(context);
    }
    await f.checkpoint.write('assessment-state', f.state);
    const report = await consumeHostedWorkItem(f.options, f.deps);
    assert.equal(report.status, 'REQUIRES_ATTENTION');
    assert.equal(report.outcome, undefined);
    assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 2);
    assert.equal(f.calls.some(call => call.name.startsWith('begin_') || call.name.startsWith('commit_')), false);
  }
});

test('policy damage alone cannot close an in-flight, incomplete, finished or differently bound execution', async t => {
  const mutations = [
    async f => f.checkpoint.write('assessment-round-4.started', { startedAt: new Date().toISOString() }),
    async f => f.checkpoint.write('assessment-round-4.result', { value: { raw: '{}' } }),
    async f => f.checkpoint.write('assessment-round-3.error', { code: 'HOSTED_GATEWAY_RESPONSE_INTERRUPTED' }),
    async f => f.checkpoint.write('quarantine-assessment-round-4.started-synthetic', {}),
    async f => f.checkpoint.write('run-result', { attemptStatus: 'UNKNOWN', errorCode: 'HOSTED_GATEWAY_RESPONSE_INTERRUPTED' }),
    async f => f.checkpoint.write('assessment-round-2.result', { value: { ok: false, status: 503 } }),
    async f => { f.state.messages = []; await f.checkpoint.write('assessment-state', f.state); },
    async f => { f.state.saved.requestId = 'different-save-key'; await f.checkpoint.write('assessment-state', f.state); },
    async f => { f.saved.revision.content.roundCompletion = 'COMPLETE'; },
    async f => f.checkpoint.write('model.result', { value: { output: { workRevisionRef: 'JAWR-one' } } }),
    async f => { f.claim.leaseExpiresAt = new Date(Date.now() + 60000).toISOString();
      await f.checkpoint.write('assessment-current-claim', f.claim); },
  ];
  for (const mutate of mutations) {
    const f = await settledPolicyFixture(t);
    await mutate(f);
    const report = await consumeHostedWorkItem(f.options, f.deps);
    assert.equal(report.status, 'REQUIRES_ATTENTION');
    assert.equal(report.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
    assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 2);
    assert.equal(f.calls.some(call => call.name.startsWith('begin_') || call.name.startsWith('commit_')), false);
  }
});

test('new lease does not waive a changed closure proof, source denial or exact original SAVE readback', async t => {
  for (const kind of ['started', 'denied', 'original-drift', 'cancelled']) {
    const f = await settledPolicyFixture(t);
    const recovery = await findInitialAssessmentRecovery(f.options, f.initial, f.deps);
    assert.ok(recovery.closeOnly);
    await f.checkpoint.write('assessment-current-claim', f.fresh);
    if (kind === 'started') await f.checkpoint.write('assessment-round-4.started', { startedAt: new Date().toISOString() });
    if (kind === 'cancelled') f.saved.executionStatus = 'CANCELLED';
    const denied = new Error('JOBAID_SOURCE_AUTHORIZATION_CHANGED');
    const callTool = async (name, args) => {
      if (kind === 'denied') throw denied;
      if (kind === 'original-drift' && args.requestId)
        return { ...f.saved, revision: { ...f.saved.revision, workRevisionRef: 'JAWR-other' } };
      return f.deps.callTool(name, args);
    };
    await assert.rejects(finishInitialAssessmentPolicyFailure({ checkpoint: f.checkpoint, recovery, begin: f.fresh, callTool }),
      kind === 'denied' ? error => error === denied : /CLOSURE_UNCONFIRMED|SAVED_WORK_READBACK_INVALID/u);
  }
});

test('an already stopped automatic claim can close naturally, then uses the existing terminal BLOCK receipt', async t => {
  const f = await settledPolicyFixture(t);
  const checkpoint = await createCheckpointStore(join(f.options.checkpointRoot, 'queue'));
  checkpoint.withActiveClaimOwner = perform => perform();
  const claim = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-one', documentVersionId: 'DV-one',
    workItemRevision: 1, requestId: 'REQ-queue-one', leaseToken: '00000000-0000-4000-8000-000000000001', leaseGeneration: 2,
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), completionReady: false, consumerStopped: true,
    attentionCode: 'JOBAID_CHECKPOINT_POLICY_CHANGED', blockReady: null };
  await checkpoint.write('active-claim', claim);
  let blocks = 0;
  const blockedAt = new Date().toISOString();
  const deps = { checkpoint, callTool: f.deps.callTool, readInitialStatus: async () => f.currentStatus(),
    nextWorkItem: () => assert.fail('current queue grant is still valid'),
    acknowledgeWorkItem: () => assert.fail('a failed stage is not acknowledged as successful'),
    consumeWorkItem: options => consumeHostedWorkItem(options, f.deps),
    blockWorkItem: async input => { blocks++; assert.equal(input.leaseToken, claim.leaseToken);
      return { status: 'BLOCKED', workItemId: 'WI-one', blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED',
        replayed: blocks > 1, blockedAt }; } };
  const closed = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.options.checkpointRoot }, deps);
  assert.equal(closed.status, 'REQUIRES_ATTENTION');
  assert.equal(closed.errorCode, 'JOBAID_CHECKPOINT_POLICY_CHANGED');
  assert.equal(f.currentStatus().status, 'FAILED');
  assert.equal(f.calls.filter(call => call.name === 'read_assessment_work').length, 6);
  assert.equal(blocks, 0);
  const blocked = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.options.checkpointRoot }, deps);
  assert.equal(blocked.status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(blocks, 2, 'clear only after the exact ordinary BLOCK receipt is read back');
  assert.equal(await checkpoint.readOptional('active-claim'), null);
});

test('an exact applicability begin with a lost receipt can reconcile only before model or commit starts', async () => {
  const f = fixture();
  f.input.operation = 'EXTRACT_APPLICABILITY';
  f.input.initial.stages = { applicability: {
    status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: 'attempt-one',
  } };
  f.values.set('binding', { workItemId: 'WI-one', documentVersionId: 'DV-one',
    operation: 'EXTRACT_APPLICABILITY', requestId: 'request-one' });
  f.values.set('begin_applicability_evaluation-1.started', { argsHash: 'frozen-hash' });
  assert.deepEqual(await inspectInitialAssessmentRecovery(f.input), {
    status: 'RECOVERY_BEGIN', operation: 'EXTRACT_APPLICABILITY', previousAttemptRef: 'attempt-one',
  });
  f.values.set('model.started', {});
  assert.equal((await inspectInitialAssessmentRecovery(f.input)).errorCode,
    'INITIAL_APPLICABILITY_BEGIN_MODEL_ALREADY_STARTED');
  f.values.delete('model.started');
  f.values.set('commit_applicability_candidate-1.started', {});
  assert.equal(await inspectInitialAssessmentRecovery(f.input), null);
});

test('an ambiguous pending applicability begin replays its frozen request without duplicating model work', async t => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-applicability-begin-replay-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const options = { checkpointRoot, workItemId: 'WI-one', maxInitialStages: 1,
    initialStageOnly: true, expectedInitialOperation: 'EXTRACT_APPLICABILITY' };
  const initialWorkItemRevision = 2;
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(
    { ...options, initialWorkItemRevision }, 'EXTRACT_APPLICABILITY'));
  const args = { applicabilityContextRef: 'APCTX-one', requestId: 'request-one' };
  await checkpoint.writeOnce('binding', { workItemId: 'WI-one', documentVersionId: 'DV-one',
    operation: 'EXTRACT_APPLICABILITY', requestId: args.requestId });
  await assert.rejects(checkpoint.remoteStep({ step: 'begin_applicability_evaluation-1', args,
    ambiguousCommit: false, perform: async () => { throw new Error('gateway disconnected'); } }), /gateway disconnected/u);

  const pending = { candidateOnly: true, workItemId: 'WI-one', workItemRevision: initialWorkItemRevision,
    documentVersionId: 'DV-one', status: 'REQUIRED', nextOperation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: args.applicabilityContextRef, stages: {
      translation: { status: 'SUCCEEDED' }, applicability: { status: 'PENDING' },
      jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' },
    } };
  const saved = { ...pending, workItemRevision: 3, nextOperation: 'EVALUATE_JOBAID', stages: {
    ...pending.stages, applicability: { status: 'SUCCEEDED' } } };
  const claim = { status: 'RUNNING', attemptRef: 'attempt-one', leaseToken: 'lease-one',
    leaseGeneration: 1, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    task: { workItemId: 'WI-one', documentVersionId: 'DV-one', deadline: new Date(Date.now() + 600_000).toISOString() },
    modelInput: { schemaVersion: 'fixture.applicability.v1' } };
  let statusReads = 0;
  let beginCalls = 0;
  let modelCalls = 0;
  const result = await consumeHostedWorkItem(options, {
    callTool: async (name, observedArgs) => {
      if (name === 'get_parse_status') {
        statusReads += 1;
        return { entry: { workItemId: 'WI-one' }, initialAnalysis: statusReads === 1 ? pending : saved };
      }
      if (name === 'begin_applicability_evaluation') {
        beginCalls += 1;
        assert.deepEqual(observedArgs, args);
        return claim;
      }
      assert.fail(`unexpected tool ${name}`);
    },
    runInitial: async run => {
      await run.callTool('begin_applicability_evaluation', args);
      return { outcome: 'CANDIDATE_READY' };
    },
    invokeInitialModel: async () => { modelCalls += 1; assert.fail('model dispatch is not part of begin recovery'); },
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(beginCalls, 1);
  assert.equal(modelCalls, 0);
  assert.deepEqual((await checkpoint.readOptional('begin_applicability_evaluation-1.result')).value, claim);
});

test('begin replay requires the frozen argument hash and cannot replay a model or commit', async t => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-exact-begin-replay-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const checkpoint = await createCheckpointStore(checkpointRoot);
  const args = { applicabilityContextRef: 'APCTX-one', requestId: 'request-one' };
  let beginCalls = 0;
  const begin = (step, input = args) => checkpoint.remoteStep({ step, args: input,
    ambiguousCommit: false, allowExactReplay: true,
    perform: async () => { beginCalls += 1; return { attemptRef: 'attempt-one' }; } });
  await assert.rejects(checkpoint.remoteStep({ step: 'begin_applicability_evaluation-1', args,
    ambiguousCommit: false, perform: async () => { throw new Error('gateway disconnected'); } }), /gateway disconnected/u);
  await assert.rejects(begin('begin_applicability_evaluation-1', { ...args, requestId: 'changed' }),
    /ARGUMENT_MISMATCH/u);
  assert.deepEqual(await begin('begin_applicability_evaluation-1'), { attemptRef: 'attempt-one' });
  assert.equal(beginCalls, 1);

  let otherCalls = 0;
  const commit = () => checkpoint.remoteStep({ step: 'commit_applicability_candidate-1', args,
    ambiguousCommit: true, allowExactReplay: true,
    perform: async () => { otherCalls += 1; throw new Error('commit receipt lost'); } });
  await assert.rejects(commit(), /commit receipt lost/u);
  await assert.rejects(commit(), /COMMIT_OUTCOME_UNKNOWN/u);
  const model = () => checkpoint.remoteStep({ step: 'model', args, ambiguousCommit: false,
    allowExactReplay: true, perform: async () => { otherCalls += 1; throw new Error('model response lost'); } });
  await assert.rejects(model(), /model response lost/u);
  await assert.rejects(model(), /MODEL_OUTCOME_UNKNOWN/u);
  assert.equal(otherCalls, 2);
});
