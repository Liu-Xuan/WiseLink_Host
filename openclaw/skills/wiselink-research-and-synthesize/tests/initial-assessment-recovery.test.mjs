import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectInitialAssessmentRecovery, assertFreshInitialAssessmentClaim, findInitialAssessmentRecovery,
  initialApplicabilityCheckpointPointerPath } from '../scripts/initial-assessment-recovery.mjs';

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
import { consumeHostedWorkItem } from '../scripts/consume-hosted-work-item.mjs';
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
