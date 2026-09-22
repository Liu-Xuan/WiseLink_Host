import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectInitialAssessmentRecovery, assertFreshInitialAssessmentClaim } from '../scripts/initial-assessment-recovery.mjs';

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
    f => { f.input.initial.stages.jobAid.attemptStatus = 'COMMITTING'; },
  ]) { const f = fixture(); change(f); assert.equal(await inspectInitialAssessmentRecovery(f.input), null); }
});

test('fresh Host claim must advance the generation with the identical task binding', () => {
  const { claim } = fixture();
  const current = { ...claim, leaseToken: 'new', leaseGeneration: 2, leaseExpiresAt: new Date(Date.now() + 60000).toISOString() };
  assert.doesNotThrow(() => assertFreshInitialAssessmentClaim(claim, current));
  assert.throws(() => assertFreshInitialAssessmentClaim(claim, { ...current, leaseGeneration: 1 }), /STILL_OWNED/);
  assert.throws(() => assertFreshInitialAssessmentClaim(claim, { ...current, task: { ...current.task, inputHash: 'changed' } }), /BINDING_MISMATCH/);
  assert.throws(() => assertFreshInitialAssessmentClaim(claim, { ...current, leaseExpiresAt: claim.leaseExpiresAt }), /LEASE_EXPIRED/);
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
  const result = await consumeHostedWorkItem(f.options, f.deps);
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
