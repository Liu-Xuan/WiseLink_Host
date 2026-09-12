import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consumeHostedWorkItem } from '../scripts/consume-hosted-work-item.mjs';

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


test('an original impact asks Host for the durable successor and re-reads authoritative status', async t => {
  const input = await options(t);
  let queued=false, saved=false;
  const calls=[];
  const result=await consumeHostedWorkItem(input, {
    callTool:async name => {
      calls.push(name);
      if (name==='get_pending_review_turn') return {next:null,busy:false};
      if (name==='next_original_assessment') {queued=true;return {status:'QUEUED'};}
      assert.equal(name,'get_parse_status');
      return status({status:queued?'WAITING_INPUT':'CONFLICT',nextOperation:queued&&!saved?'EVALUATE_JOBAID':null,
        stages:{translation:{status:'PENDING'},applicability:{status:'WAITING_INPUT'},
          jobAid:saved?{status:'SUCCEEDED'}:queued?{status:'PENDING',requestId:'original-2'}:
            {status:'CONFLICT',terminalCode:'DOCUMENT_ORIGINAL_IMPACT_REVIEW_REQUIRED'},overall:{status:'SUCCEEDED'}}});
    },
    runInitial:async run => {assert.equal(run.continuationRequestId,'original-2');saved=true;return {outcome:'CANDIDATE_READY'};},
  });
  assert.equal(result.status,'INITIAL_STAGE_SAVED');
  assert.equal(calls.filter(name => name==='next_original_assessment').length,1);
});
