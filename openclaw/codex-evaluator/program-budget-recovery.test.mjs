import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { initialStageCheckpointPath } from '../skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs';
import { programRecoveryData } from './program-recovery-fixture.mjs';

// The real program consumer and budget run in new processes. Only its model
// gateway and Host are synthetic; this suite stops after one SAVE and READ.
const worker = fileURLToPath(new URL('./program-recovery-fixture.mjs', import.meta.url));
const { assessmentBinding } = programRecoveryData();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = async (root, ...path) => JSON.parse(await readFile(resolve(root, ...path), 'utf8'));
const checkpointPath = root => initialStageCheckpointPath({ checkpointRoot: root,
  workItemId: assessmentBinding.workItemId }, 'EVALUATE_JOBAID');

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'program-budget-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function run(root, mode = 'budget:normal') {
  const outcome = resolve(root, 'fixture-outcome.json');
  await rm(outcome, { force: true });
  const child = spawn(process.execPath, [worker, root, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', value => { stderr += value; });
  return new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      try {
        const result = signal ? null : JSON.parse(await readFile(outcome, 'utf8'));
        accept({ code, signal, stderr, result });
      } catch (error) { reject(error); }
    });
  });
}

async function seedPendingModel(t, { cachedResult = false } = {}) {
  const root = await fixture(t);
  assert.equal((await run(root, 'budget:after-model-receipt')).signal, 'SIGKILL');
  const checkpoint = await createCheckpointStore(checkpointPath(root));
  const originalBudget = await checkpoint.readOptional('jobaid-run-budget');
  assert.deepEqual(originalBudget.counts, { modelRequests: 1, saves: 0, finishes: 0 });
  assert.deepEqual(originalBudget.active, { kind: 'modelRequests' });
  if (cachedResult) {
    assert.equal((await run(root, 'budget:after-response')).signal, 'SIGKILL');
    assert.deepEqual(await checkpoint.readOptional('jobaid-run-budget'), originalBudget);
    assert.ok(await checkpoint.readOptional('assessment-round-1.result'));
  }
  return { root, checkpoint, originalBudget };
}

async function assertUnknownWithoutDispatch(root, originalBudget, expectedCode) {
  const resumed = await run(root);
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.result.report.status, 'REQUIRES_ATTENTION');
  assert.equal(resumed.result.report.attemptStatus, 'UNKNOWN');
  if (expectedCode) assert.match(resumed.result.report.errorCode, expectedCode);
  assert.deepEqual(resumed.result.budget, originalBudget);
  assert.equal(resumed.result.state.modelRequests, 1);
  assert.equal(resumed.result.state.saveCalls, 0);
  assert.equal(resumed.result.state.committedWrites, 0);
  assert.equal(resumed.result.state.saved, null);
  assert.equal(resumed.result.receiptLinks, null);
  assert.equal(resumed.result.state.realHostCalled, false);
  assert.equal(resumed.result.state.realModelCalled, false);
  const reservations = (await readdir(checkpointPath(root)))
    .filter(name => /^jobaid-run-budget-(?:modelRequests|saves|finishes)-/u.test(name));
  assert.ok(!reservations.some(name => /(?:saves|finishes)-/u.test(name)));
  return resumed.result;
}

function assertSavedAndRead(result) {
  assert.equal(result.report.outcome, 'SYNTHETIC_SAVE_READ_ONLY');
  assert.equal(result.report.attemptStatus, undefined);
  assert.equal(result.report.errorCode, undefined);
  assert.equal(result.budget.active, null);
  assert.deepEqual(result.budget.counts, { modelRequests: 1, saves: 1, finishes: 0 });
  assert.deepEqual(result.budget.limits, { modelRequests: 1, saves: 1, finishes: 1 });
  assert.deepEqual(result.report.jobAidRunBudget.dispatchReservations, result.budget.counts);
  assert.equal(result.report.jobAidRunBudget.pendingOutcome, null);
  assert.equal(result.state.modelRequests, 1);
  assert.equal(result.state.saveCalls, 1);
  assert.equal(result.state.committedWrites, 1);
  assert.equal(result.state.realHostCalled, false);
  assert.equal(result.state.realModelCalled, false);
  assert.equal(result.receiptLinks.saveRequestId, result.state.saved.requestId);
  assert.equal(result.receiptLinks.workRevisionRef, result.execution.output.workRevisionRef);
  const saveIndex = result.state.actions.findIndex(action => action.tool === 'save_assessment_work');
  assert.ok(saveIndex >= 0);
  const independentRead = result.state.actions[saveIndex + 1];
  assert.equal(independentRead.tool, 'read_assessment_work');
  assert.equal(independentRead.request.requestId, result.state.saved.requestId);
  assert.deepEqual(independentRead.response.revision, result.state.saved);
  assert.equal(result.state.actions.at(-1).tool, 'read_assessment_work');
}

test('pending budget model receipt recovers after process death or an exception with one charged dispatch', async t => {
  for (const mode of ['after-model-receipt', 'throw-after-model-receipt']) {
    await t.test(mode, async t => {
      const root = await fixture(t);
      const interrupted = await run(root, `budget:${mode}`);
      if (mode === 'after-model-receipt') assert.equal(interrupted.signal, 'SIGKILL');
      else {
        assert.equal(interrupted.result.report.attemptStatus, 'UNKNOWN');
        assert.equal(interrupted.result.report.errorCode, 'FIXTURE_RESPONSE_ACK_LOST');
      }
      const checkpoint = await createCheckpointStore(checkpointPath(root));
      const pending = await checkpoint.readOptional('jobaid-run-budget');
      const response = await json(root, 'synthetic-model', 'response.json');
      const started = await checkpoint.readOptional('assessment-round-1.started');
      const parent = await checkpoint.readOptional('assessment-round-1.codex-run');
      assert.deepEqual(pending.active, { kind: 'modelRequests' });
      assert.deepEqual(pending.counts, { modelRequests: 1, saves: 0, finishes: 0 });
      assert.equal(parent.requestId, started.codexRecoveryRequestId);
      assert.equal(parent.argsHash, started.argsHash);
      assert.equal(parent.runRoot, root);
      assert.equal(parent.runDirectory, resolve(root, 'synthetic-model'));
      assert.match(parent.gatewayBindingSha256, /^[0-9a-f]{64}$/u);
      assert.equal(parent.promptSha256, sha256(response.requestBody));
      assert.equal(response.responseSha256, sha256(response.raw));
      const completed = await run(root);
      assert.equal(completed.code, 0, JSON.stringify(completed));
      assertSavedAndRead(completed.result);
      assert.ok(completed.result.state.modelRecoveryRequests >= 1);
      assert.deepEqual(await json(root, 'synthetic-model', 'response.json'), response);
      assert.deepEqual(await checkpoint.readOptional('jobaid-run-budget-modelRequests-1'),
        { kind: 'modelRequests', ordinal: 1 });
      assert.deepEqual(await checkpoint.readOptional('assessment-round-1.codex-run'), parent);
    });
  }
});

test('receipt recovery may die after writing round.result and the next process closes only the pending model reservation', async t => {
  const { root, checkpoint, originalBudget } = await seedPendingModel(t, { cachedResult: true });
  const cached = await checkpoint.readOptional('assessment-round-1.result');
  const before = await json(root, 'synthetic-host', 'state.json');
  assert.equal(before.modelRequests, 1);
  assert.equal(before.saveCalls, 0);
  assert.equal(before.modelRecoveryRequests, 1);
  const completed = await run(root);
  assert.equal(completed.code, 0, JSON.stringify(completed));
  assertSavedAndRead(completed.result);
  assert.equal(completed.result.state.modelRecoveryRequests, before.modelRecoveryRequests + 1);
  assert.equal(completed.result.budget.counts.modelRequests, originalBudget.counts.modelRequests);
  assert.deepEqual(await checkpoint.readOptional('assessment-round-1.result'), cached);
});

test('missing or changed original receipt, request and parent link retain UNKNOWN without SAVE or another dispatch', async t => {
  const cases = [
    ['missing receipt', async ({ root }) => rm(resolve(root, 'synthetic-model', 'response.json'))],
    ['malformed receipt', async ({ root }) => writeFile(resolve(root, 'synthetic-model', 'response.json'), '{')],
    ['changed raw with its original fixed hash', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      const response = await store.readOptional('response');
      await store.write('response', { ...response, raw: `${response.raw} ` });
    }],
    ['wrong request ID', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      await store.write('response', { ...await store.readOptional('response'), requestId: 'program:foreign:round-1' });
    }],
    ['wrong request body', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      const response = await store.readOptional('response');
      await store.write('response', { ...response, requestBody: `${response.requestBody} ` });
    }],
    ['missing transport receipt', async ({ root }) => rm(resolve(root, 'synthetic-model', 'transport-summary.json'))],
    ['incomplete transport receipt', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      await store.write('transport-summary', { synthetic: true, model_requests: 1, closure: 'unknown' });
    }],
    ['missing parent link', async ({ root }) => rm(resolve(checkpointPath(root), 'assessment-round-1.codex-run.json'))],
    ['malformed parent link', async ({ root }) => writeFile(
      resolve(checkpointPath(root), 'assessment-round-1.codex-run.json'), '{')],
    ...[
      ['requestId', 'program:foreign:round-1'], ['argsHash', 'f'.repeat(64)],
      ['gatewayBindingSha256', 'f'.repeat(64)], ['promptSha256', 'f'.repeat(64)],
      ['runRoot', '/fixture/foreign-root'], ['runDirectory', '/fixture/foreign-run'],
    ].map(([key, value]) => [`wrong parent ${key}`, async ({ checkpoint }) => {
      const parent = await checkpoint.readOptional('assessment-round-1.codex-run');
      await checkpoint.write('assessment-round-1.codex-run', { ...parent, [key]: value });
    }]),
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async t => {
      const context = await seedPendingModel(t);
      await mutate(context);
      await assertUnknownWithoutDispatch(context.root, context.originalBudget);
      if (name === 'missing parent link')
        assert.equal(await context.checkpoint.readOptional('assessment-round-1.codex-run'), null);
    });
  }
});

test('cached round.result cannot replace the original started marker, parent binding or full gateway receipt', async t => {
  const cases = [
    ['missing original receipt', async ({ root }) => rm(resolve(root, 'synthetic-model', 'response.json'))],
    ['malformed original receipt', async ({ root }) => writeFile(
      resolve(root, 'synthetic-model', 'response.json'), '{')],
    ['changed original raw', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      const response = await store.readOptional('response');
      await store.write('response', { ...response, raw: `${response.raw} ` });
    }],
    ['wrong original request ID', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      await store.write('response', { ...await store.readOptional('response'), requestId: 'program:foreign:round-1' });
    }],
    ['wrong original request body', async ({ root }) => {
      const store = await createCheckpointStore(resolve(root, 'synthetic-model'));
      const response = await store.readOptional('response');
      await store.write('response', { ...response, requestBody: `${response.requestBody} ` });
    }],
    ['missing started marker', async ({ root }) => rm(
      resolve(checkpointPath(root), 'assessment-round-1.started.json'))],
    ['wrong started request', async ({ checkpoint }) => {
      const started = await checkpoint.readOptional('assessment-round-1.started');
      await checkpoint.write('assessment-round-1.started', { ...started, codexRecoveryRequestId: 'foreign' });
    }],
    ['missing parent link', async ({ root }) => rm(
      resolve(checkpointPath(root), 'assessment-round-1.codex-run.json'))],
    ['raw with a recomputed cached hash', async ({ checkpoint }) => {
      const cached = await checkpoint.readOptional('assessment-round-1.result');
      cached.value.raw += ' ';
      cached.value.codexReceipt.responseSha256 = sha256(cached.value.raw);
      await checkpoint.write('assessment-round-1.result', cached);
    }],
    ...[
      ['status', 201], ['ok', false],
      ['requestId', 'program:foreign:round-1'], ['runDirectory', '/fixture/foreign-run'],
      ['transportSummaryRef', '/fixture/foreign-summary.json'],
    ].map(([key, value]) => [`wrong cached ${key}`, async ({ checkpoint }) => {
      const cached = await checkpoint.readOptional('assessment-round-1.result');
      if (key === 'status' || key === 'ok') cached.value[key] = value;
      else cached.value.codexReceipt[key] = value;
      await checkpoint.write('assessment-round-1.result', cached);
    }]),
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async t => {
      const context = await seedPendingModel(t, { cachedResult: true });
      await mutate(context);
      await assertUnknownWithoutDispatch(context.root, context.originalBudget);
      if (name === 'missing parent link')
        assert.equal(await context.checkpoint.readOptional('assessment-round-1.codex-run'), null);
    });
  }
});

test('pending model reservation requires the original first ordinal without clearing or refunding its count', async t => {
  for (const missing of [true, false]) {
    await t.test(missing ? 'missing ordinal' : 'changed ordinal', async t => {
      const context = await seedPendingModel(t, { cachedResult: true });
      if (missing) await rm(resolve(checkpointPath(context.root), 'jobaid-run-budget-modelRequests-1.json'));
      else await context.checkpoint.write('jobaid-run-budget-modelRequests-1', { kind: 'modelRequests', ordinal: 2 });
      const before = await json(context.root, 'synthetic-host', 'state.json');
      const result = await assertUnknownWithoutDispatch(context.root, context.originalBudget,
        /^JOBAID_PROGRAM_MODEL_BUDGET_RECOVERY_INVALID$/u);
      assert.equal(result.state.modelRecoveryRequests, before.modelRecoveryRequests);
    });
  }
});

test('a pending SAVE reservation stays pending and causes no gateway verification or duplicate SAVE', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'budget:before-save')).signal, 'SIGKILL');
  const checkpoint = await createCheckpointStore(checkpointPath(root));
  const pending = await checkpoint.readOptional('jobaid-run-budget');
  assert.equal(pending.active.kind, 'saves');
  assert.deepEqual(pending.counts, { modelRequests: 1, saves: 1, finishes: 0 });
  const before = await json(root, 'synthetic-host', 'state.json');
  assert.equal(before.modelRecoveryRequests, 0);
  const resumed = await run(root);
  assert.equal(resumed.result.report.errorCode, 'JOBAID_RUN_OUTCOME_UNKNOWN');
  assert.equal(resumed.result.report.attemptStatus, 'UNKNOWN');
  assert.deepEqual(resumed.result.budget, pending);
  assert.equal(resumed.result.state.modelRequests, 1);
  assert.equal(resumed.result.state.modelRecoveryRequests, 0);
  assert.equal(resumed.result.state.saveCalls, 0);
  assert.equal(resumed.result.state.committedWrites, 0);
});

test('a known completed model reservation needs no additional gateway verification before SAVE and READ', async t => {
  for (const interrupt of [false, true]) {
    await t.test(interrupt ? 'restart after normal result publication' : 'uninterrupted', async t => {
      const root = await fixture(t);
      if (interrupt) {
        assert.equal((await run(root, 'budget:after-response')).signal, 'SIGKILL');
        assert.equal((await json(checkpointPath(root), 'jobaid-run-budget.json')).active, null);
      }
      const completed = await run(root);
      assert.equal(completed.code, 0, JSON.stringify(completed));
      assertSavedAndRead(completed.result);
      assert.equal(completed.result.state.modelRecoveryRequests, 0);
    });
  }
});

test('an unrelated pending FINISH reservation is not cleared by the cached program response', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'budget:after-response')).signal, 'SIGKILL');
  const checkpoint = await createCheckpointStore(checkpointPath(root));
  const budget = await checkpoint.readOptional('jobaid-run-budget');
  // The SAVE/READ-only fixture never sends FINISH. This negative checkpoint
  // asserts that model reconciliation cannot consume another operation's slot.
  const pending = { ...budget, counts: { ...budget.counts, finishes: 1 },
    active: { kind: 'finishes', attemptRef: assessmentBinding.attemptRef, contentHash: 'e'.repeat(64) } };
  await checkpoint.write('jobaid-run-budget', pending);
  await checkpoint.writeOnce('jobaid-run-budget-finishes-1', { kind: 'finishes', ordinal: 1 });
  const resumed = await run(root);
  assert.equal(resumed.result.report.errorCode, 'JOBAID_RUN_OUTCOME_UNKNOWN');
  assert.equal(resumed.result.report.attemptStatus, 'UNKNOWN');
  assert.deepEqual(resumed.result.budget, pending);
  assert.equal(resumed.result.state.modelRequests, 1);
  assert.equal(resumed.result.state.modelRecoveryRequests, 0);
  assert.equal(resumed.result.state.saveCalls, 0);
  assert.equal(resumed.result.state.committedWrites, 0);
});

test('the initial no-budget program path keeps its existing SAVE and independent READ behavior', async t => {
  const root = await fixture(t);
  const completed = await run(root, 'normal');
  assert.equal(completed.code, 0, JSON.stringify(completed));
  assert.equal(completed.result.budget, undefined);
  assert.equal(completed.result.report, undefined);
  assert.equal(completed.result.state.modelRequests, 1);
  assert.equal(completed.result.state.modelRecoveryRequests, 0);
  assert.equal(completed.result.state.saveCalls, 1);
  assert.equal(completed.result.state.reads, 2);
  assert.equal(completed.result.state.actions.at(-1).tool, 'read_assessment_work');
});
