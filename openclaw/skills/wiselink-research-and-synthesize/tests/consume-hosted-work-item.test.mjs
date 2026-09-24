import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consumeHostedWorkItem, initialStageLimit, matterPreflightMode, runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';

function status(overrides = {}) {
  return { entry: { workItemId: 'WI-new' }, initialAnalysis: {
    workItemRevision: 2, documentVersionId: 'DV-new', candidateOnly: true,
    applicabilityContextRef: null, status: 'REQUIRED', nextOperation: 'TRANSLATE',
    stages: Object.fromEntries(['translation', 'applicability', 'jobAid', 'overall'].map((key) => [key, { status: 'PENDING' }])),
    ...overrides,
  } };
}

async function options(t) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-initial-consumer-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  return { workItemId: 'WI-new', checkpointRoot, applicabilityContextRef: 'AC-authorized', maxInitialStages: 1 };
}

test('CLI stage limit accepts only one WorkItem initial stage', () => {
  assert.deepEqual(initialStageLimit([], 'WI-new'), {});
  assert.deepEqual(initialStageLimit(['--max-initial-stages', '1'], 'WI-new'),
    { maxInitialStages: 1, initialStageOnly: true });
  assert.deepEqual(initialStageLimit(['--max-initial-stages', '1', '--expected-initial-operation', 'EVALUATE_JOBAID'], 'WI-new'),
    { maxInitialStages: 1, initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID' });
  assert.deepEqual(initialStageLimit(['--max-initial-stages', '1', '--expected-initial-operation', 'SYNTHESIZE_OVERALL'], 'WI-new'),
    { maxInitialStages: 1, initialStageOnly: true, expectedInitialOperation: 'SYNTHESIZE_OVERALL' });
  assert.deepEqual(initialStageLimit(['--max-initial-stages', '1', '--expected-initial-operation', 'EXTRACT_APPLICABILITY'], 'WI-new'),
    { maxInitialStages: 1, initialStageOnly: true, expectedInitialOperation: 'EXTRACT_APPLICABILITY' });
  for (const argv of [
    ['--max-initial-stages'],
    ['--max-initial-stages', '0'],
    ['--max-initial-stages', '2'],
    ['--max-initial-stages=1'],
    ['--max-initial-stages', '1', '--max-initial-stages', '1'],
  ]) {
    assert.throws(() => initialStageLimit(argv, 'WI-new'), /INITIAL_STAGE_LIMIT_INVALID/);
  }
  assert.throws(() => initialStageLimit(['--max-initial-stages', '1'], null, 'MAT-new'),
    /INITIAL_STAGE_LIMIT_INVALID/);
  assert.throws(() => initialStageLimit(['--max-initial-stages', '1'], null, null, 'DV-new'),
    /INITIAL_STAGE_LIMIT_INVALID/);
  for (const argv of [
    ['--expected-initial-operation'],
    ['--expected-initial-operation', 'EVALUATE_JOBAID'],
    ['--max-initial-stages', '1', '--expected-initial-operation'],
    ['--max-initial-stages', '1', '--expected-initial-operation', 'TRANSLATE'],
    ['--max-initial-stages', '1', '--expected-initial-operation', 'EVALUATE_JOBAID', '--expected-initial-operation', 'EVALUATE_JOBAID'],
  ]) assert.throws(() => initialStageLimit(argv, 'WI-new'), /INITIAL_EXPECTED_OPERATION_INVALID/);
  assert.throws(() => initialStageLimit(['--max-initial-stages', '1', '--expected-initial-operation=EVALUATE_JOBAID'], 'WI-new'),
    /INITIAL_EXPECTED_OPERATION_INVALID/);
  assert.throws(() => initialStageLimit(['--max-initial-stages', '1', '--expected-initial-operation', 'EVALUATE_JOBAID'], null, 'MAT-new'),
    /INITIAL_STAGE_LIMIT_INVALID/);
});

test('single-stage mode runs current JobAid once and leaves Overall pending', async t => {
  const input = { ...await options(t), initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID' };
  let saved = false;
  const calls = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async name => {
      calls.push(name);
      assert.equal(name, 'get_parse_status');
      return status({
        status: 'WAITING_INPUT',
        nextOperation: saved ? 'SYNTHESIZE_OVERALL' : 'EVALUATE_JOBAID',
        stages: {
          translation: { status: 'PENDING' },
          applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: saved ? 'SUCCEEDED' : 'PENDING' },
          overall: { status: 'PENDING' },
        },
      });
    },
    runInitial: async run => {
      assert.equal(run.operation, 'EVALUATE_JOBAID');
      saved = true;
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(saved, true);
  assert.deepEqual(calls, ['get_parse_status', 'get_parse_status']);
  assert.deepEqual(result.completedStages, ['EVALUATE_JOBAID']);
  assert.equal(result.nextOperation, 'SYNTHESIZE_OVERALL');
  await assert.rejects(consumeHostedWorkItem(input, {
    callTool: async name => {
      calls.push(name);
      assert.equal(name, 'get_parse_status');
      return status({ status: 'REQUIRED', nextOperation: 'SYNTHESIZE_OVERALL',
        stages: { translation: { status: 'PENDING' }, applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: 'SUCCEEDED' }, overall: { status: 'PENDING' } } });
    },
    runInitial: async () => assert.fail('re-entry must not start Overall'),
  }), /INITIAL_EXPECTED_OPERATION_MISMATCH/);
  assert.deepEqual(calls, ['get_parse_status', 'get_parse_status', 'get_parse_status']);
});

test('expected JobAid refuses any other entry stage before begin, recovery, or model', async t => {
  const input = { ...await options(t), initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID' };
  const cases = [
    status({ nextOperation: 'SYNTHESIZE_OVERALL', stages: {
      translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'PENDING' } } }),
    status({ nextOperation: 'TRANSLATE' }),
    status({ status: 'NOT_READY', nextOperation: null }),
    status({ status: 'BUSY', nextOperation: null, stages: {
      translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'BUSY' } } }),
  ];
  for (const value of cases) {
    const calls = [];
    await assert.rejects(consumeHostedWorkItem(input, {
      callTool: async name => { calls.push(name); return value; },
      runInitial: async () => assert.fail('guard must not enter initial stage'),
      consumeReview: async () => assert.fail('guard must not consume Review'),
    }), /INITIAL_EXPECTED_OPERATION_MISMATCH/);
    assert.deepEqual(calls, ['get_parse_status']);
  }
});

test('expected JobAid allows a BUSY JobAid to wait for exact recovery without starting another stage', async t => {
  const input = { ...await options(t), initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID' };
  const calls = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async name => {
      calls.push(name);
      return status({ status: 'BUSY', nextOperation: null, stages: {
        translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: 'BUSY', attemptStatus: 'RUNNING' }, overall: { status: 'PENDING' } } });
    },
    runInitial: async () => assert.fail('unowned BUSY attempt must not start'),
  });
  assert.equal(result.status, 'BUSY');
  assert.deepEqual(calls, ['get_parse_status']);
});

test('expected JobAid requires the one-stage WorkItem mode before reading Host status', async t => {
  const base = await options(t);
  for (const input of [
    { ...base, expectedInitialOperation: 'EVALUATE_JOBAID' },
    { ...base, initialStageOnly: true, expectedInitialOperation: 'TRANSLATE' },
    { ...base, initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID', maxInitialStages: 2 },
  ]) await assert.rejects(consumeHostedWorkItem(input, {
    callTool: async () => assert.fail('invalid guard mode must not read or begin'),
  }), /INITIAL_EXPECTED_OPERATION_INVALID/);
});

test('expected Overall consumes only a pending Overall stage and binds its attempt calls', async t => {
  const input = { ...await options(t), initialStageOnly: true,
    expectedInitialOperation: 'SYNTHESIZE_OVERALL' };
  let saved = false;
  const calls = [];
  const initial = () => status({ status: saved ? 'SUCCEEDED' : 'REQUIRED',
    nextOperation: saved ? null : 'SYNTHESIZE_OVERALL',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: saved ? 'SUCCEEDED' : 'PENDING' } } });
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status') return initial();
      if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: 'future' };
      assert.fail(`Overall must not enter ${name}`);
    },
    runInitial: async run => {
      assert.equal(run.operation, 'SYNTHESIZE_OVERALL');
      await run.callTool('heartbeat_action_attempt', { attemptRef: 'AQ-overall' });
      saved = true;
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(result.completedStages, ['SYNTHESIZE_OVERALL']);
  assert.deepEqual(calls.filter(call => call.name === 'heartbeat_action_attempt').map(call => call.args),
    [{ attemptRef: 'AQ-overall', workItemId: 'WI-new' }]);
  assert.deepEqual(calls.map(call => call.name),
    ['get_parse_status', 'heartbeat_action_attempt', 'get_parse_status']);
});

test('Overall consumer passes its exact WorkItem through begin, work read, status and commit', async t => {
  const input = await options(t);
  let saved = false;
  const calls = [];
  const initial = status({ status: 'REQUIRED', nextOperation: 'SYNTHESIZE_OVERALL',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'PENDING' } } }).initialAnalysis;
  const report = await runHostedInitialStage({ ...input, operation: 'SYNTHESIZE_OVERALL', initial }, {
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'begin_overall_synthesis') return { status: 'RUNNING', attemptRef: 'AQ-overall',
        modelInput: { schemaVersion: 'wiselink.jobaid-problem-task.v2' } };
      if (name === 'read_assessment_work') return { work: null };
      if (name === 'get_action_attempt_status') return { attemptRef: 'AQ-overall', status: 'RUNNING' };
      if (name === 'commit_overall_candidate') { saved = true; return { status: 'SUCCEEDED' }; }
      if (name === 'get_parse_status') return status({ status: 'SUCCEEDED', nextOperation: null,
        stages: { ...initial.stages, overall: { status: saved ? 'SUCCEEDED' : 'PENDING' } } });
      assert.fail(`unexpected tool ${name}`);
    },
    runInitial: async run => {
      await run.callTool('begin_overall_synthesis', { workItemId: 'WI-new', providers: [] });
      await run.callTool('read_assessment_work', { attemptRef: 'AQ-overall' });
      await run.callTool('get_action_attempt_status', { attemptRef: 'AQ-overall' });
      await run.callTool('commit_overall_candidate', { attemptRef: 'AQ-overall', result: {} });
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(calls.filter(call => call.name !== 'get_parse_status').map(call => call.args), [
    { workItemId: 'WI-new', providers: [] },
    { attemptRef: 'AQ-overall', workItemId: 'WI-new' },
    { attemptRef: 'AQ-overall', workItemId: 'WI-new' },
    { attemptRef: 'AQ-overall', result: {}, workItemId: 'WI-new' },
  ]);
});

test('single-stage mode leaves original-impact conflict untouched', async t => {
  const input = { ...await options(t), initialStageOnly: true };
  const calls = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async name => {
      calls.push(name);
      assert.equal(name, 'get_parse_status');
      return status({ status: 'CONFLICT', nextOperation: null,
        stages: { translation: { status: 'PENDING' },
          applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: 'CONFLICT', terminalCode: 'DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED' },
          overall: { status: 'PENDING' } } });
    },
    runInitial: async () => assert.fail('a conflicted stage must not start'),
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.deepEqual(calls, ['get_parse_status']);
});

test('an explicit queued request uses its own checkpoint and preserves the old failed run', async (t) => {
  const input = await options(t);
  const oldPath = join(input.checkpointRoot, 'WI-new/initial/EVALUATE_JOBAID');
  await mkdir(oldPath, { recursive: true });
  const oldFailure = JSON.stringify({ status: 'REQUIRES_ATTENTION', operation: 'EVALUATE_JOBAID', candidateOnly: true });
  await writeFile(join(oldPath, 'run-result.json'), oldFailure);
  const requestId = 'explicit-successor';
  let saved = false;
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name) => {
      if (name === 'get_pending_review_turn') return { next: null, busy: false };
      assert.equal(name, 'get_parse_status');
      return status({ status: 'WAITING_INPUT', nextOperation: saved ? 'SYNTHESIZE_OVERALL' : 'EVALUATE_JOBAID',
        stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: saved ? 'SUCCEEDED' : 'PENDING', requestId }, overall: { status: 'PENDING' } } });
    },
    runInitial: async (run) => {
      assert.equal(run.requestId, requestId); assert.equal(run.continuationRequestId, requestId);
      saved = true; return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(await readFile(join(oldPath, 'run-result.json'), 'utf8'), oldFailure);
  const binding = JSON.parse(await readFile(join(oldPath, 'requests', requestId, 'binding.json'), 'utf8'));
  assert.equal(binding.requestId, requestId);
});

test('an explicitly continued P0B Overall carries its current staged binding even without a serving base', async (t) => {
  const input = await options(t);
  const reevaluation = { schemaVersion: 'wiselink.3_1.configuration_evidence_reevaluation_status.v1',
    triggerSnapshotId: 'CES-current', triggerConfigurationRevision: 2, mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
    status: 'RUNNING', nextStage: 'OVERALL', servingCurrentPreserved: true, candidateOnly: true,
    stages: { applicability: { status: 'SUCCEEDED', retryNo: 0 }, jobAid: { status: 'SUCCEEDED', retryNo: 0 }, overall: { status: 'PENDING', retryNo: 1 } } };
  let saved = false;
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name) => {
      if (name === 'get_pending_review_turn') return { next: null, busy: false };
      return { ...status({ nextOperation: saved ? null : 'SYNTHESIZE_OVERALL', status: saved ? 'SUCCEEDED' : 'REQUIRED',
        stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'SUCCEEDED' }, jobAid: { status: 'SUCCEEDED' },
          overall: { status: saved ? 'SUCCEEDED' : 'PENDING', requestId: 'p0b-overall-request' } } }),
      integratedAssessmentSummary: null, configurationEvidenceReevaluation: reevaluation };
    },
    runInitial: async (run) => {
      assert.equal(run.operation, 'SYNTHESIZE_OVERALL');
      assert.equal(run.continuationRequestId, 'p0b-overall-request');
      assert.equal(run.configurationEvidenceReevaluation.triggerSnapshotId, 'CES-current');
      assert.equal(run.configurationEvidenceReevaluation.nextStage, 'OVERALL');
      saved = true; return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
});

test('not ready and busy Host stages do not query or dispatch Review', async (t) => {
  const input = await options(t);
  for (const state of ['NOT_READY', 'BUSY']) {
    const result = await consumeHostedWorkItem(input, {
      callTool: async () => status({ status: state, nextOperation: null }),
      runInitial: () => assert.fail('Must not dispatch an initial stage'),
      consumeReview: () => assert.fail('Must not dispatch review'),
    });
    assert.equal(result.status, state);
  }
});

test('failed initial stages remain attention when no explicit Review is queued', async (t) => {
  const input = await options(t);
  for (const state of ['FAILED', 'CONFLICT']) {
    const calls = [];
    const result = await consumeHostedWorkItem(input, {
      callTool: async (name) => {
        calls.push(name);
        if (name === 'get_parse_status') return status({ status: state, nextOperation: null });
        if (name === 'get_pending_review_turn') return { next: null, busy: false };
        assert.fail(name);
      },
      runInitial: () => assert.fail('Must not replay an initial stage'),
      invokeReviewModel: () => assert.fail('An idle Review check must not call the model'),
    });
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.initialStatus, state);
    assert.deepEqual(calls, ['get_parse_status', 'get_pending_review_turn']);
  }
});

test('explicit Matter Review proceeds independently and retains failed initial status', async (t) => {
  const input = await options(t);
  const failed = status({ status: 'FAILED', nextOperation: null });
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name) => {
      assert.equal(name, 'get_parse_status');
      return failed;
    },
    consumeReview: async (value, dependencies) => {
      assert.equal(value.workItemId, input.workItemId);
      assert.equal(value.checkpointRoot, join(input.checkpointRoot, 'review'));
      assert.equal(typeof dependencies.callTool, 'function');
      return { status: 'CANDIDATE_SAVED', reviewTurnRef: 'RT-matter' };
    },
    runInitial: () => assert.fail('Review must never replay the failed initial stage'),
  });
  assert.equal(result.status, 'CANDIDATE_SAVED');
  assert.equal(result.reviewTurnRef, 'RT-matter');
  assert.equal(result.initialStatus, 'FAILED');
  assert.deepEqual(result.initialStages, failed.initialAnalysis.stages);
});

test('an explicit queued Review precedes pending automatic initial work', async (t) => {
  const input = await options(t);
  const result = await consumeHostedWorkItem(input, {
    callTool: async () => status(),
    consumeReview: async () => ({ status: 'BUSY' }),
    runInitial: () => assert.fail('Must not start initial work while Review is busy'),
  });
  assert.equal(result.status, 'BUSY');
  assert.equal(result.initialStatus, 'REQUIRED');
});

test('one tick runs only the next Host stage and persists its exact binding', async (t) => {
  const input = await options(t);
  let runs = 0;
  let modelCalls = 0;
  let saved = false;
  let renewed = 0;
  const heartbeat = async () => { renewed++; };
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name) => {
      if (name === 'get_pending_review_turn') return { next: null, busy: false };
      if (name === 'get_parse_status') return saved ? status({
        workItemRevision: 3, nextOperation: 'EXTRACT_APPLICABILITY',
        stages: { ...status().initialAnalysis.stages, translation: { status: 'SUCCEEDED' } },
      }) : status();
      if (name === 'begin_translation') return { status: 'RUNNING', attemptRef: 'AQ-new', taskBinding: { executionModel: { modelRef: 'dli/gpt-5.6-sol' } } };
      if (name === 'commit_translation_candidate') { saved = true; return { ok: true }; }
      assert.fail(name);
    },
    invokeInitialModel: async ({ operation, modelInput }, hooks) => {
      assert.equal(operation, 'TRANSLATE');
      assert.deepEqual(modelInput, { sourceUnits: [] });
      assert.match(hooks.sessionDiscriminator, /^[0-9a-f-]{36}$/u);
      assert.equal(hooks.executionModel.modelRef, 'dli/gpt-5.6-sol');
      assert.equal(hooks.heartbeat, heartbeat);
      await hooks.heartbeat();
      modelCalls += 1;
      return { output: {}, provenance: {} };
    },
    runInitial: async (run) => {
      runs += 1;
      assert.deepEqual(run.providers, []);
      assert.equal(run.operation, 'TRANSLATE');
      await run.callTool('begin_translation', { workItemId: 'WI-new' });
      await run.translate({ sourceUnits: [] }, { heartbeat });
      await run.callTool('commit_translation_candidate', { phase: 'FINALIZE' });
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(runs, 1);
  assert.equal(modelCalls, 1);
  assert.equal(renewed, 1);
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(result.nextOperation, 'EXTRACT_APPLICABILITY');
  const binding = JSON.parse(await readFile(join(input.checkpointRoot, 'WI-new/initial/TRANSLATE/binding.json'), 'utf8'));
  assert.equal(binding.documentVersionId, 'DV-new');
});

test('applicability WAITING_INPUT permits later candidates and completed initial analysis routes Review', async (t) => {
  const input = await options(t);
  const stages = { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' }, jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' } };
  let after = false;
  const result = await consumeHostedWorkItem(input, {
    callTool: async () => status({ status: 'WAITING_INPUT', nextOperation: after ? 'SYNTHESIZE_OVERALL' : 'EVALUATE_JOBAID', stages: after ? { ...stages, jobAid: { status: 'SUCCEEDED' } } : stages }),
    runInitial: async (run) => { assert.equal(run.operation, 'EVALUATE_JOBAID'); after = true; return { outcome: 'CANDIDATE_READY' }; },
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  const complete = { ...stages, jobAid: { status: 'SUCCEEDED' }, overall: { status: 'SUCCEEDED' } };
  const reviewed = await consumeHostedWorkItem(input, {
    callTool: async () => status({ status: 'WAITING_INPUT', nextOperation: null, stages: complete }),
    consumeReview: async (value) => { assert.equal(value.workItemId, 'WI-new'); return { status: 'CANDIDATE_SAVED' }; },
  });
  assert.equal(reviewed.status, 'CANDIDATE_SAVED');
  for (const translationStatus of ['PENDING','FAILED','CONFLICT']) {
    const independent = await consumeHostedWorkItem(input, {
      callTool:async () => status({status:'WAITING_INPUT',nextOperation:null,
        stages:{...complete,translation:{status:translationStatus}}}),
      runInitial:async () => {throw new Error('Engineering completion must not dispatch legacy translation');},
      consumeReview:async () => ({status:'CANDIDATE_SAVED'}),
    });
    assert.equal(independent.status,'CANDIDATE_SAVED');
  }
});

test('JobAid attempt calls bind the exact WorkItem while other stages retain legacy arguments', async (t) => {
  const input = { ...await options(t), initialStageOnly: true,
    expectedInitialOperation: 'EVALUATE_JOBAID' };
  let saved = false;
  const called = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name, args) => {
      called.push({ name, args });
      if (name === 'get_pending_review_turn') assert.fail('single-stage JobAid must not read Review queue');
      if (name === 'save_assessment_work') return { saved: true };
      if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: 'future' };
      if (name === 'get_parse_status') return status({
        status: 'WAITING_INPUT', nextOperation: saved ? 'SYNTHESIZE_OVERALL' : 'EVALUATE_JOBAID',
        stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: saved ? 'SUCCEEDED' : 'PENDING' }, overall: { status: 'PENDING' } },
      });
      assert.fail(name);
    },
    runInitial: async (run) => {
      await run.callTool('save_assessment_work', { attemptRef: 'AQ-exact', workJson: '{}' });
      await run.callTool('heartbeat_action_attempt', { attemptRef: 'AQ-exact' });
      saved = true;
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(called.filter(item => item.name === 'save_assessment_work' ||
    item.name === 'heartbeat_action_attempt').map(item => item.args), [
    { attemptRef: 'AQ-exact', workJson: '{}', workItemId: 'WI-new' },
    { attemptRef: 'AQ-exact', workItemId: 'WI-new' },
  ]);
});

test('single-stage applicability keeps begin opaque and binds commit, heartbeat and status to the WorkItem', async (t) => {
  const input={...await options(t),initialStageOnly:true,expectedInitialOperation:'EXTRACT_APPLICABILITY'};
  const called=[]; let saved=false;
  const stages={translation:{status:'SUCCEEDED'},applicability:{status:'PENDING'},jobAid:{status:'PENDING'},overall:{status:'PENDING'}};
  const result=await consumeHostedWorkItem(input,{
    callTool:async(name,args)=>{
      called.push({name,args});
      if(name==='get_parse_status') return status({status:'REQUIRED',nextOperation:saved?'EVALUATE_JOBAID':'EXTRACT_APPLICABILITY',
        applicabilityContextRef:'APCTX-ftd',stages:{...stages,applicability:{status:saved?'SUCCEEDED':'PENDING'}}});
      if(name==='begin_applicability_evaluation') return {status:'RUNNING',attemptRef:'AQ-ftd',task:{executionModel:{modelRef:'test'}}};
      if(name==='heartbeat_action_attempt') return {leaseExpiresAt:'future'};
      if(name==='commit_applicability_candidate'){saved=true;return {status:'SUCCEEDED'};}
      return {status:'SUCCEEDED'};
    },
    runInitial:async(run)=>{
      await run.callTool('begin_applicability_evaluation',{applicabilityContextRef:'APCTX-ftd',requestId:run.requestId});
      await run.callTool('heartbeat_action_attempt',{attemptRef:'AQ-ftd'});
      await run.callTool('get_action_attempt_status',{attemptRef:'AQ-ftd'});
      await run.callTool('commit_applicability_candidate',{attemptRef:'AQ-ftd',result:{}});
      return {outcome:'CANDIDATE_READY'};
    },
  });
  assert.equal(result.status,'INITIAL_STAGE_SAVED');
  assert.deepEqual(called.filter(item=>['begin_applicability_evaluation','heartbeat_action_attempt',
    'get_action_attempt_status','commit_applicability_candidate'].includes(item.name)).map(item=>item.args),[
    {applicabilityContextRef:'APCTX-ftd',requestId:called.find(item=>item.name==='begin_applicability_evaluation').args.requestId},
    {attemptRef:'AQ-ftd',workItemId:'WI-new'},
    {attemptRef:'AQ-ftd',workItemId:'WI-new'},
    {attemptRef:'AQ-ftd',result:{},workItemId:'WI-new'},
  ]);
});

test('a new controlled selection revision can retry applicability after WAITING_INPUT without reusing its checkpoint',async t=>{
  const input=await options(t); let runs=0;
  const initial=revision=>status({workItemRevision:revision,status:'REQUIRED',nextOperation:'EXTRACT_APPLICABILITY',
    applicabilityContextRef:'APCTX-ftd',stages:{translation:{status:'SUCCEEDED'},applicability:{status:'PENDING'},
      jobAid:{status:'PENDING'},overall:{status:'PENDING'}}}).initialAnalysis;
  const deps={
    callTool:async name=>{
      assert.equal(name,'get_parse_status');
      return status({workItemRevision:runs===1?3:4,status:runs===1?'WAITING_INPUT':'REQUIRED',
        nextOperation:runs===1?'EVALUATE_JOBAID':'EVALUATE_JOBAID',
        stages:{translation:{status:'SUCCEEDED'},applicability:{status:runs===1?'WAITING_INPUT':'SUCCEEDED'},
          jobAid:{status:'PENDING'},overall:{status:'PENDING'}}});
    },
    runInitial:async()=>{runs+=1;return {outcome:runs===1?'WAITING_INPUT':'CANDIDATE_READY'};},
  };
  const first=await runHostedInitialStage({...input,operation:'EXTRACT_APPLICABILITY',initial:initial(2)},deps);
  assert.equal(first.status,'REQUIRES_ATTENTION');
  assert.equal(first.stageStatus,'WAITING_INPUT');
  const second=await runHostedInitialStage({...input,operation:'EXTRACT_APPLICABILITY',initial:initial(3)},deps);
  assert.equal(second.status,'INITIAL_STAGE_SAVED');
  assert.equal(runs,2);
});

test('c115 resumes a c114 JobAid checkpoint without changing its argument hash', async (t) => {
  const input = await options(t);
  const requestId = 'legacy-c114';
  const initial = status({ status: 'WAITING_INPUT', nextOperation: 'EVALUATE_JOBAID',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'PENDING', requestId }, overall: { status: 'PENDING' } } }).initialAnalysis;
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(input, 'EVALUATE_JOBAID', requestId));
  await checkpoint.writeOnce('binding', { workItemId: 'WI-new', documentVersionId: 'DV-new',
    operation: 'EVALUATE_JOBAID', requestId });
  await checkpoint.remoteStep({ step: 'begin_dynamic_evaluation-1',
    args: { workItemId: 'WI-new', requestId }, ambiguousCommit: false,
    perform: async () => ({ status: 'RUNNING', attemptRef: 'AQ-c114',
      modelInput: { schemaVersion: 'wiselink.jobaid-problem-task.v2' },
      task: { deadline: new Date(Date.now() + 60000).toISOString() } }),
  });
  const remoteCalls = [];
  const report = await runHostedInitialStage({ ...input, operation: 'EVALUATE_JOBAID', initial }, {
    callTool: async (name, args) => {
      remoteCalls.push({ name, args });
      if (name === 'get_parse_status') return status({ status: 'WAITING_INPUT',
        nextOperation: 'SYNTHESIZE_OVERALL', stages: { ...initial.stages,
          jobAid: { status: 'SUCCEEDED', requestId } } });
      assert.fail(`c114 completed BEGIN must not replay: ${name}`);
    },
    runInitial: async (run) => {
      const restored = await run.callTool('begin_dynamic_evaluation', { workItemId: 'WI-new', requestId });
      assert.equal(restored.attemptRef, 'AQ-c114');
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(remoteCalls.map(call => call.name), ['get_parse_status']);
});

test('c116 resumes a c115 Overall checkpoint without replaying begin', async t => {
  const input = await options(t);
  const requestId = 'legacy-c115-overall';
  const initial = status({ status: 'REQUIRED', nextOperation: 'SYNTHESIZE_OVERALL',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'PENDING', requestId } } }).initialAnalysis;
  const checkpoint = await createCheckpointStore(initialStageCheckpointPath(input, 'SYNTHESIZE_OVERALL', requestId));
  await checkpoint.writeOnce('binding', { workItemId: 'WI-new', documentVersionId: 'DV-new',
    operation: 'SYNTHESIZE_OVERALL', requestId });
  const beginArgs = { workItemId: 'WI-new', providers: [], requestId };
  await checkpoint.remoteStep({ step: 'begin_overall_synthesis-1', args: beginArgs,
    ambiguousCommit: false, perform: async () => ({ status: 'RUNNING', attemptRef: 'AQ-c115-overall',
      modelInput: { schemaVersion: 'legacy-overall' } }) });
  const remoteCalls = [];
  const report = await runHostedInitialStage({ ...input, operation: 'SYNTHESIZE_OVERALL', initial }, {
    callTool: async (name, args) => {
      remoteCalls.push({ name, args });
      if (name === 'get_parse_status') return status({ status: 'SUCCEEDED', nextOperation: null,
        stages: { ...initial.stages, overall: { status: 'SUCCEEDED', requestId } } });
      assert.fail(`c115 completed Overall BEGIN must not replay: ${name}`);
    },
    runInitial: async run => {
      const restored = await run.callTool('begin_overall_synthesis', beginArgs);
      assert.equal(restored.attemptRef, 'AQ-c115-overall');
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.equal(report.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(remoteCalls.map(call => call.name), ['get_parse_status']);
});

test('pre-commit failure cancels once; unknown final commit never cancels or replays', async (t) => {
  for (const finalCommit of [false, true]) {
    const input = await options(t);
    const calls = [];
    const dependencies = {
      callTool: async (name) => {
        calls.push(name);
        if (name === 'get_pending_review_turn') return { next: null, busy: false };
        if (name === 'get_parse_status') return status();
        if (name === 'begin_translation') return { status: 'RUNNING', attemptRef: 'AQ-new' };
        if (name === 'commit_translation_candidate') throw new Error('TRANSPORT_RESPONSE_LOST');
        if (name === 'cancel_action_attempt') return { status: 'CANCELLED', attemptRef: 'AQ-new' };
        assert.fail(name);
      },
      runInitial: async (run) => {
        await run.callTool('begin_translation', {});
        if (finalCommit) await run.callTool('commit_translation_candidate', { phase: 'FINALIZE' });
        throw new Error('INITIAL_MODEL_INVALID');
      },
    };
    if (finalCommit) await assert.rejects(consumeHostedWorkItem(input, dependencies), /TRANSPORT_RESPONSE_LOST/u);
    else assert.equal((await consumeHostedWorkItem(input, dependencies)).errorCode, 'INITIAL_MODEL_INVALID');
    await assert.rejects(consumeHostedWorkItem(input, dependencies));
    assert.equal(calls.filter((name) => name === 'begin_translation').length, 1);
    assert.equal(calls.filter((name) => name === 'commit_translation_candidate').length, finalCommit ? 1 : 0);
    assert.equal(calls.filter((name) => name === 'cancel_action_attempt').length, finalCommit ? 0 : 1);
  }
});

test('Host identity mismatch stops before any operation', async (t) => {
  await assert.rejects(consumeHostedWorkItem(await options(t), {
    callTool: async () => ({ ...status(), entry: { workItemId: 'WI-other' } }),
    runInitial: () => assert.fail('Must not run'),
  }), /HOST_INITIAL_STATUS_UNAVAILABLE/u);
});

test('a terminal Host validation failure retains its specific safe code through cancellation', async (t) => {
  const input = await options(t);
  const cancellations = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name, args) => {
      if (name === 'get_pending_review_turn') return { next: null, busy: false };
      if (name === 'get_parse_status') return status();
      if (name === 'begin_translation') return { status: 'RUNNING', attemptRef: 'AQ-new' };
      if (name === 'cancel_action_attempt') {
        cancellations.push(args);
        return { status: 'CANCELLED', attemptRef: 'AQ-new' };
      }
      assert.fail(name);
    },
    runInitial: async (run) => {
      await run.callTool('begin_translation', {});
      throw Object.assign(new Error('REVIEW_HOST_MCP_TOOL_FAILED:save_assessment_work'), {
        hostErrorCode: 'JOBAID_MEASURE_ADDRESSES_INVALID',
      });
    },
  });
  assert.equal(result.errorCode, 'JOBAID_MEASURE_ADDRESSES_INVALID');
  assert.equal(cancellations.length, 1);
  assert.equal(cancellations[0].reason, 'HOSTED_INITIAL_EXECUTION_FAILED:JOBAID_MEASURE_ADDRESSES_INVALID');
});

test('translation rejection diagnostics survive attempt cancellation and cannot be replayed', async (t) => {
  const input = await options(t);
  const report = { round: 3, correctionRound: 2, findingCount: 1,
    findings: [{ unitIndex: 7, unitKey: 'unit-7', code: 'NUMBER_NOT_PRESERVED', ruleId: 'number.fidelity', message: 'number "28" appears 1x in the source but only 0x in the translation' }] };
  let cancelled = 0;
  let models = 0;
  const dependencies = {
    callTool: async (name) => {
      if (name === 'get_pending_review_turn') return { next: null, busy: false };
      if (name === 'get_parse_status') return status();
      if (name === 'begin_translation') return { status: 'RUNNING', attemptRef: 'AQ-new' };
      if (name === 'cancel_action_attempt') { cancelled++; return { status: 'CANCELLED', attemptRef: 'AQ-new' }; }
      assert.fail(name);
    },
    runInitial: async (run) => {
      await run.callTool('begin_translation', {});
      await run.translate({ sourceUnits: [] });
      assert.fail('Rejected output must never commit');
    },
    invokeInitialModel: async (_input, hooks) => {
      models++;
      await hooks.observeTranslationFidelity(report, 3);
      throw new Error('TRANSLATION_RULE_PREFLIGHT_REJECTED');
    },
  };
  assert.equal((await consumeHostedWorkItem(input, dependencies)).errorCode, 'TRANSLATION_RULE_PREFLIGHT_REJECTED');
  const saved = JSON.parse(await readFile(join(input.checkpointRoot, 'WI-new/initial/TRANSLATE/model.translation-fidelity-3.json'), 'utf8'));
  assert.deepEqual(saved, report);
  await assert.rejects(consumeHostedWorkItem(input, dependencies));
  assert.equal(cancelled, 1);
  assert.equal(models, 1);
});

test('one tick drains ready stages with fresh Host revisions and serial commits', async (t) => {
  const input = { ...await options(t), maxInitialStages: 4 };
  const operations = ['TRANSLATE', 'EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'];
  const keys = ['translation', 'jobAid', 'overall'];
  let saved = 0;
  let active = 0;
  const started = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async (name) => {
      if (name === 'get_pending_review_turn') return { next: null, busy: false };
      assert.equal(name, 'get_parse_status');
      const stages = { applicability: { status: 'WAITING_INPUT' },
        ...Object.fromEntries(keys.map((key, index) => [key, { status: index < saved ? 'SUCCEEDED' : 'PENDING' }])) };
      return status({ workItemRevision: 2 + saved, status: 'WAITING_INPUT', nextOperation: operations[saved] ?? null, stages });
    },
    runInitial: async (run) => {
      assert.equal(active++, 0, 'no simultaneous begin/model/commit against the shared WorkItem CAS');
      assert.equal(run.operation, operations[saved]);
      started.push(run.operation);
      await Promise.resolve();
      saved += 1; active -= 1;
      return { outcome: 'CANDIDATE_READY' };
    },
  });
  assert.deepEqual(started, operations);
  assert.deepEqual(result.completedStages, operations);
  assert.equal(result.workItemRevision, 5);
  assert.equal(result.nextOperation, null);
});

test('native jobs require one subject and never hide Matter behind a WorkItem dependency', async () => {
  let calls = 0;
  const dependencies = { callTool: async () => { calls += 1; } };
  for (const input of [{}, { workItemId: 'WI-one', matterId: 'MAT-one' }]) {
    await assert.rejects(consumeHostedWorkItem(input, dependencies), /CONSUMER_SINGLE_SUBJECT_REQUIRED/);
  }
  assert.equal(calls, 0);
});

test('Matter preflight modes stay scoped to one Matter and never enter WorkItem dispatch', async () => {
  let calls = 0;
  const dependencies = { callTool: async () => { calls += 1; } };
  await assert.rejects(consumeHostedWorkItem({ workItemId: 'WI-one', matterPreflightOnly: true }, dependencies),
    /MATTER_PREFLIGHT_TARGET_REQUIRED/);
  await assert.rejects(consumeHostedWorkItem({ matterId: 'MAT-one', matterPreflightOnly: true,
    matterExpectedSnapshot: 'a'.repeat(64) }, dependencies), /MATTER_PREFLIGHT_MODE_AMBIGUOUS/);
  assert.equal(calls, 0);
});

test('Matter preflight CLI refuses unsupported equals syntax instead of silently dispatching', () => {
  const snapshot = 'a'.repeat(64);
  assert.deepEqual(matterPreflightMode(['--matter-preflight-only'], 'MAT-one'),
    { matterPreflightOnly: true, matterExpectedSnapshot: undefined });
  assert.deepEqual(matterPreflightMode(['--matter-expected-snapshot', snapshot], 'MAT-one'),
    { matterPreflightOnly: false, matterExpectedSnapshot: snapshot });
  for (const arg of [`--matter-expected-snapshot=${snapshot}`, '--matter-preflight-only=true'])
    assert.throws(() => matterPreflightMode([arg], 'MAT-one'), /MATTER_PREFLIGHT_OPTION_INVALID/);
  assert.throws(() => matterPreflightMode(['--matter-preflight-only'], null), /MATTER_PREFLIGHT_TARGET_REQUIRED/);
});

test('independent native job invocations progress while another subject is waiting', async () => {
  let finishWorkItemRead;
  const workItemRead = new Promise(resolve => { finishWorkItemRead = resolve; });
  const workItem = consumeHostedWorkItem({ workItemId: 'WI-new' }, {
    callTool: async name => { assert.equal(name, 'get_parse_status'); return workItemRead; },
  });
  const matter = await consumeHostedWorkItem({ matterId: 'MAT-other' }, {
    callTool: async (name, input) => {
      assert.equal(name, 'next_matter_assessment');
      assert.deepEqual(input, { matterId: 'MAT-other' });
      return { matterId: input.matterId, next: null };
    },
  });
  assert.equal(matter.status, 'IDLE');
  finishWorkItemRead(status({ status: 'NOT_READY', nextOperation: null }));
  assert.equal((await workItem).status, 'NOT_READY');
});


for (const operation of ['EVALUATE_JOBAID','EXTRACT_APPLICABILITY']) test(`original ${operation} impact consumes the durable successor after authoritative readback`, async t => {
  const input = await options(t);
  let queued=false, saved=false;
  const calls=[];
  const result=await consumeHostedWorkItem(input, {
    callTool:async name => {
      calls.push(name);
      if (name==='get_pending_review_turn') return {next:null,busy:false};
      if (name==='next_original_assessment') {queued=true;return {status:'QUEUED'};}
      assert.equal(name,'get_parse_status');
      return status({status:queued?'WAITING_INPUT':'CONFLICT',nextOperation:queued&&!saved?operation:null,
        stages:{translation:{status:'PENDING'},overall:{status:'SUCCEEDED'},
          ...(operation==='EXTRACT_APPLICABILITY' ? {jobAid:{status:'SUCCEEDED'}} : {applicability:{status:'WAITING_INPUT'}}),
          [operation==='EXTRACT_APPLICABILITY'?'applicability':'jobAid']:saved?{status:'SUCCEEDED'}:queued?{status:'PENDING',requestId:'original-2'}:
            {status:'CONFLICT',terminalCode:'DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED'}}});
    },
    runInitial:async run => {assert.equal(run.continuationRequestId,'original-2');saved=true;return {outcome:'CANDIDATE_READY'};},
  });
  assert.equal(result.status,'INITIAL_STAGE_SAVED');
  assert.equal(calls.filter(name => name==='next_original_assessment').length,1);
});

for (const queue of [
  { busy: false, next: { reviewConversationRef: 'RC-new', reviewTurnRef: 'RT-new', requestId: 'REQ-new', turnNo: 1 } },
  { busy: true, next: null },
]) test(`a newly ${queue.busy ? 'busy' : 'queued'} Review yields after the saved stage`, async t => {
  const input = { ...await options(t), maxInitialStages: 4 };
  let saved = 0;
  let queueReads = 0;
  const started = [];
  const result = await consumeHostedWorkItem(input, {
    callTool: async name => {
      if (name === 'get_pending_review_turn') { queueReads++; return saved ? queue : { busy: false, next: null }; }
      assert.equal(name, 'get_parse_status');
      return status({ workItemRevision: 2 + saved, nextOperation: saved ? 'EVALUATE_JOBAID' : 'TRANSLATE',
        stages: { translation: { status: saved ? 'SUCCEEDED' : 'PENDING' }, applicability: { status: 'WAITING_INPUT' },
          jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' } } });
    },
    runInitial: async run => { started.push(run.operation); saved++; return { outcome: 'CANDIDATE_READY' }; },
  });
  assert.deepEqual(started, ['TRANSLATE']);
  assert.equal(queueReads, 2);
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(result.completedStages, ['TRANSLATE']);
  assert.equal(result.continuationDeferred, queue.busy ? 'REVIEW_BUSY' : 'REVIEW_PENDING');
  const checkpoint = JSON.parse(await readFile(join(input.checkpointRoot, 'WI-new/initial/TRANSLATE/run-result.json'), 'utf8'));
  assert.equal(checkpoint.status, 'INITIAL_STAGE_SAVED');
});

for (const condition of ['unknown-receipt', 'malformed-status', 'budget-exhausted'])
  test(`continuation stops at ${condition} without losing the saved stage`, async t => {
    const input = { ...await options(t), maxInitialStages: 4 };
    const epoch = Date.now();
    let clock = epoch;
    t.mock.method(Date, 'now', () => clock);
    let saved = 0;
    let queueReads = 0;
    const started = [];
    const run = consumeHostedWorkItem(input, {
      callTool: async name => {
        if (name === 'get_pending_review_turn') {
          queueReads++;
          if (saved) {
            if (condition === 'unknown-receipt') throw new Error('QUEUE_REPLY_LOST');
            if (condition === 'malformed-status') return { busy: false };
            clock = epoch + 15 * 60_000;
          }
          return { busy: false, next: null };
        }
        assert.equal(name, 'get_parse_status');
        return status({ workItemRevision: 2 + saved, nextOperation: saved ? 'EVALUATE_JOBAID' : 'TRANSLATE',
          stages: { translation: { status: saved ? 'SUCCEEDED' : 'PENDING' }, applicability: { status: 'WAITING_INPUT' },
            jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' } } });
      },
      runInitial: async operation => { started.push(operation.operation); saved++; return { outcome: 'CANDIDATE_READY' }; },
    });
    if (condition === 'budget-exhausted') assert.deepEqual((await run).completedStages, ['TRANSLATE']);
    else await assert.rejects(run, condition === 'unknown-receipt' ? /QUEUE_REPLY_LOST/ : /INITIAL_REVIEW_QUEUE_STATUS_INVALID/);
    assert.deepEqual(started, ['TRANSLATE']);
    assert.equal(queueReads, 2, 'no replay of an uncertain queue read');
    const checkpoint = JSON.parse(await readFile(join(input.checkpointRoot, 'WI-new/initial/TRANSLATE/run-result.json'), 'utf8'));
    assert.equal(checkpoint.status, 'INITIAL_STAGE_SAVED');
  });
