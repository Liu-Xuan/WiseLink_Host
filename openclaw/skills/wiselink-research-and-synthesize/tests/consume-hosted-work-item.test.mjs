import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

test('not ready, busy and failed Host stages do not dispatch a model or operation', async (t) => {
  const input = await options(t);
  for (const state of ['NOT_READY', 'BUSY', 'FAILED', 'CONFLICT']) {
    const result = await consumeHostedWorkItem(input, {
      callTool: async () => status({ status: state, nextOperation: null }),
      runInitial: () => assert.fail('Must not dispatch an initial stage'),
      consumeReview: () => assert.fail('Must not dispatch review'),
    });
    assert.equal(result.status, ['NOT_READY', 'BUSY'].includes(state) ? state : 'REQUIRES_ATTENTION');
  }
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
});

test('pre-commit failure cancels once; unknown final commit never cancels or replays', async (t) => {
  for (const finalCommit of [false, true]) {
    const input = await options(t);
    const calls = [];
    const dependencies = {
      callTool: async (name) => {
        calls.push(name);
        if (name === 'get_parse_status') return status();
        if (name === 'begin_translation') return { status: 'RUNNING', attemptRef: 'AQ-new' };
        if (name === 'commit_translation_candidate') throw new Error('TRANSPORT_RESPONSE_LOST');
        if (name === 'cancel_action_attempt') return { status: 'CANCELLED' };
        assert.fail(name);
      },
      runInitial: async (run) => {
        await run.callTool('begin_translation', {});
        if (finalCommit) await run.callTool('commit_translation_candidate', { phase: 'FINALIZE' });
        throw new Error('INITIAL_MODEL_INVALID');
      },
    };
    await assert.rejects(consumeHostedWorkItem(input, dependencies));
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

test('translation rejection diagnostics survive attempt cancellation and cannot be replayed', async (t) => {
  const input = await options(t);
  const report = { round: 3, correctionRound: 2, findingCount: 1,
    findings: [{ unitIndex: 7, unitKey: 'unit-7', code: 'NUMBER_NOT_PRESERVED', ruleId: 'number.fidelity', message: 'number "28" appears 1x in the source but only 0x in the translation' }] };
  let cancelled = 0;
  let models = 0;
  const dependencies = {
    callTool: async (name) => {
      if (name === 'get_parse_status') return status();
      if (name === 'begin_translation') return { status: 'RUNNING', attemptRef: 'AQ-new' };
      if (name === 'cancel_action_attempt') { cancelled++; return { status: 'CANCELLED' }; }
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
  await assert.rejects(consumeHostedWorkItem(input, dependencies), /TRANSLATION_RULE_PREFLIGHT_REJECTED/u);
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
