import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore, createHostMcpConnection, findMcpConfig } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { inspectInitialAssessmentRecovery, assertFreshInitialAssessmentClaim } from '../skills/wiselink-research-and-synthesize/scripts/initial-assessment-recovery.mjs';
import { assertCodexParentRunLink } from './codex-parent-run-link-test-helper.mjs';

const worker = fileURLToPath(new URL('./program-recovery-fixture.mjs', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'program-recovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function run(root, mode = 'normal') {
  const outcome = resolve(root, 'fixture-outcome.json');
  await rm(outcome, { force: true });
  const child = spawn(process.execPath, [worker, root, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdout.resume();
  child.stderr.on('data', value => { stderr += value; });
  return new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', async (code, signal) => {
      // A durable outcome also works when the execution sandbox captures child
      // stdio. SIGKILL must leave no successful outcome for this invocation.
      try {
        const result = signal ? null : JSON.parse(await readFile(outcome, 'utf8'));
        accept({ code, signal, stderr, result });
      } catch (error) { reject(error); }
    });
  });
}
const json = async (root, ...path) => JSON.parse(await readFile(resolve(root, ...path), 'utf8'));

test('complete model response survives parent death before SAVE and a new process saves without generation', async t => {
  for (const mode of ['after-model-receipt', 'after-response', 'before-save']) {
    const root = await fixture(t);
    assert.equal((await run(root, mode)).signal, 'SIGKILL');
    const completed = await run(root);
    assert.equal(completed.code, 0, JSON.stringify(completed));
    assert.equal(completed.result.state.modelRequests, 1);
    assert.equal(completed.result.state.committedWrites, 1);
    assert.equal(completed.result.state.saveCalls, 1);
    const response = await json(root, 'checkpoint', 'assessment-round-1.result.json');
    assert.equal(response.value.raw, (await json(root, 'synthetic-model', 'response.json')).raw);
    assert.equal(completed.result.receiptLinks.saveRequestId, completed.result.state.saved.requestId);
    assert.equal(completed.result.receiptLinks.workRevisionRef, completed.result.execution.output.workRevisionRef);
    assert.equal((await stat(resolve(root, 'checkpoint', 'assessment-round-1.result.json'))).mode & 0o077, 0);
  }
});

test('lost SAVE ACK across process death queries the original request and never sends a duplicate SAVE', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-save')).signal, 'SIGKILL');
  const original = await json(root, 'synthetic-host', 'state.json');
  const resumed = await run(root);
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.result.state.committedWrites, 1);
  assert.equal(resumed.result.state.saveCalls, 1);
  assert.equal(resumed.result.state.modelRequests, 1);
  assert.equal(resumed.result.state.saved.requestId, original.saved.requestId);
  assert.equal(resumed.result.state.actions.at(-1).tool, 'read_assessment_work');
  assert.equal(resumed.result.state.actions.at(-1).request.requestId, original.saved.requestId);
});

test('an in-process lost SAVE ACK is resolved by independent READ using the unchanged key', async t => {
  const root = await fixture(t), completed = await run(root, 'lose-save-ack');
  assert.equal(completed.code, 0, JSON.stringify(completed));
  assert.equal(completed.result.state.saveCalls, 1);
  assert.equal(completed.result.state.committedWrites, 1);
  assert.equal(completed.result.state.reads, 2);
});

test('restart after independent READ retains the original observation and tolerates refreshed packet metadata', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-readback')).signal, 'SIGKILL');
  const original = await json(root, 'checkpoint', 'program-work-readback.json');
  const resumed = await run(root);
  assert.equal(resumed.code, 0, JSON.stringify(resumed));
  assert.equal(resumed.result.state.reads, original.observationSequence + 1);
  assert.deepEqual(await json(root, 'checkpoint', 'program-work-readback.json'), original);
  assert.equal(resumed.result.state.saveCalls, 1);
});

test('a dispatch marker without a durable model receipt never causes fresh inference on restart', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'after-started')).signal, 'SIGKILL');
  const resumed = await run(root);
  assert.equal(resumed.code, 1);
  assert.equal(resumed.result.errorCode, 'CODEX_GENERATION_OUTCOME_UNKNOWN');
  const state = await json(root, 'synthetic-host', 'state.json');
  assert.equal(state.modelRequests, 0);
  assert.equal(state.saveCalls, 0);
});

test('Program assessment durably links its real prepared Codex run before launch and rejects a changed parent link', async t => {
  const root = await fixture(t);
  assert.equal((await run(root, 'before-codex-launch')).signal, 'SIGKILL');
  const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
  const started = await checkpoint.readOptional('assessment-round-1.started');
  assert.equal(started.codexRecoveryRequestId, 'program:AQ-fixture-program-recovery:round-1');
  const link = await assertCodexParentRunLink({ checkpointRoot: resolve(root, 'checkpoint'),
    step: 'assessment-round-1', requestId: started.codexRecoveryRequestId,
    argsHash: started.argsHash, runRoot: resolve(root, 'synthetic-model') });
  assert.equal(link.requestId, started.codexRecoveryRequestId);
  await assert.rejects(readFile(resolve(root, 'synthetic-model', 'dispatch-count')), { code: 'ENOENT' });

  const resumed = await run(root);
  assert.equal(resumed.code, 1, JSON.stringify(resumed));
  assert.equal(resumed.result.errorCode, 'CODEX_GENERATION_OUTCOME_UNKNOWN');
  const state = await json(root, 'synthetic-host', 'state.json');
  assert.equal(state.modelRequests, 0);
  assert.equal(state.saveCalls, 0);
  await assert.rejects(readFile(resolve(root, 'synthetic-model', 'dispatch-count')), { code: 'ENOENT' });

  await checkpoint.write('assessment-round-1.codex-run', { ...link, argsHash: 'f'.repeat(64) });
  const mismatch = await run(root);
  assert.equal(mismatch.result.errorCode, 'REVIEW_CHECKPOINT_VALUE_CHANGED:assessment-round-1.codex-run');
  assert.equal((await json(root, 'synthetic-host', 'state.json')).modelRequests, 0);
  await assert.rejects(readFile(resolve(root, 'synthetic-model', 'dispatch-count')), { code: 'ENOENT' });
});

test('query failure, foreign identity, changed authored body and changed save payload cannot finish', async t => {
  for (const [mode, expected] of [['read-unavailable', 'FIXTURE_READ_UNAVAILABLE'],
    ['wrong-read-identity', 'PROGRAM_ASSESSMENT_READ_IDENTITY_MISMATCH'],
    ['wrong-read-issue', 'PROGRAM_ASSESSMENT_SAVED_ISSUES_MISMATCH']]) {
    const root = await fixture(t), failed = await run(root, mode);
    assert.equal(failed.code, 1);
    assert.equal(failed.result.errorCode, expected);
    const state = await json(root, 'synthetic-host', 'state.json');
    assert.equal(state.saveCalls, mode === 'wrong-read-issue' ? 1 : 0);
    const resumed = await run(root);
    assert.equal(resumed.code, 0, JSON.stringify(resumed));
    assert.equal(resumed.result.state.modelRequests, 1);
    assert.equal(resumed.result.state.committedWrites, 1);
  }
  const root = await fixture(t);
  assert.equal((await run(root, 'before-save')).signal, 'SIGKILL');
  const checkpoint = await createCheckpointStore(resolve(root, 'checkpoint'));
  const request = await checkpoint.readOptional('program-save-request');
  await checkpoint.write('program-save-request', { ...request, expectedWorkRevision: 3 });
  assert.equal((await run(root)).result.errorCode, 'PROGRAM_ASSESSMENT_SAVE_BINDING_MISMATCH');
});

test('checkpoint publication survives orphan temporaries, preserves no-clobber and private permissions', async t => {
  const root = await fixture(t), checkpoint = await createCheckpointStore(root);
  await writeFile(resolve(root, `response.json.${process.pid}.once.tmp`), 'orphan', { mode: 0o600 });
  await checkpoint.writeOnce('response', { complete: true, body: '完整响应' });
  await assert.rejects(checkpoint.writeOnce('response', { complete: false }), /ALREADY_EXISTS/u);
  assert.deepEqual(await checkpoint.readOptional('response'), { complete: true, body: '完整响应' });
  await checkpoint.write('current', { revision: 1 });
  await checkpoint.write('current', { revision: 2 });
  assert.deepEqual(await checkpoint.readOptional('current'), { revision: 2 });
  assert.equal((await stat(resolve(root, 'response.json'))).mode & 0o077, 0);
});

test('only the new Codex program marker enters receipt-only recovery and a fresh Host lease remains required', async () => {
  const previous = { status: 'RUNNING', attemptRef: 'AQ-fixture', leaseGeneration: 1,
    leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
    task: { workItemId: 'WI-fixture', documentVersionId: 'DV-fixture', deadline: new Date(Date.now() + 60_000).toISOString() } };
  const values = { binding: { workItemId: 'WI-fixture', documentVersionId: 'DV-fixture', operation: 'EVALUATE_JOBAID',
    requestId: null, modelExecutor: 'CODEX' },
  'assessment-enabled': { generationPolicy: { loopPolicyVersion: 'program-controlled-v1' },
    binding: { modelExecutor: 'CODEX', assessmentBinding: { attemptRef: 'AQ-fixture' } } },
  'assessment-state': { round: 1 }, 'assessment-current-claim': previous,
  'assessment-round-1.started': { codexRecoveryRequestId: 'program:AQ-fixture:round-1' },
  'program-model-input': { body: 'exact-saved-input' } };
  const args = { workItemId: 'WI-fixture', operation: 'EVALUATE_JOBAID',
    initial: { status: 'BUSY', documentVersionId: 'DV-fixture', stages: { jobAid: {
      status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: 'AQ-fixture' } } },
    checkpoint: { readOptional: async key => values[key] ?? null } };
  const recovered = await inspectInitialAssessmentRecovery(args);
  assert.equal(recovered.modelRecovery, 'CODEX_DURABLE_RECEIPT_ONLY');
  assert.throws(() => assertFreshInitialAssessmentClaim(previous, { ...previous, leaseToken: 'fixture' }), /STILL_OWNED/u);
  assertFreshInitialAssessmentClaim(previous, { ...previous, leaseGeneration: 2, leaseToken: 'fixture',
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString() });
  delete values['assessment-round-1.started'].codexRecoveryRequestId;
  assert.equal((await inspectInitialAssessmentRecovery(args)).status, 'REQUIRES_ATTENTION');
});

test('CODEX endpoint/config selection rejects the old binding before loading SDK or using credentials', async () => {
  const legacy = { url: 'https://host.invalid/openapi/wiselink/openclaw-mcp' };
  const codex = { url: 'https://host.invalid/openapi/wiselink/codex-mcp' };
  const config = { mcpServers: { 'wiselink-openclaw-engineering-assessment': legacy,
    'wiselink-codex-engineering-assessment': codex } };
  assert.equal(findMcpConfig(config, 'CODEX'), codex);
  assert.equal(findMcpConfig(config, 'HOSTED'), legacy);
  assert.equal(findMcpConfig({ mcpServers: { 'wiselink-openclaw-engineering-assessment': legacy } }, 'CODEX'), null);
  for (const url of [legacy.url, 'http://host.invalid/openapi/wiselink/codex-mcp', `${codex.url}?token=fixture`])
    await assert.rejects(createHostMcpConnection({ modelExecutor: 'CODEX', hostMcpUrl: url }), /CODEX_HOST_MCP_ENDPOINT_INVALID/u);
});
