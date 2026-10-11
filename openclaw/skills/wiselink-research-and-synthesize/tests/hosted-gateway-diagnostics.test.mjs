import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consumeAutomaticWorkItemQueueTick, runHostedInitialStage } from '../scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';
import { hostedGatewayTransportFailureDiagnostic, requestHostedGateway } from '../scripts/request-hosted-gateway.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';

const SECRET = 'synthetic-secret https://private.example.test/path?token=fixture';
const transportError = (message = 'HOSTED_GATEWAY_REQUEST_FAILED', code = 'ECONNRESET') =>
  new Error(message, { cause: Object.assign(new Error(SECRET), {
    code, syscall: 'read', stack: SECRET, headers: { authorization: SECRET }, body: SECRET,
  }) });

test('transport projection preserves only fixed codes behind an exact Gateway wrapper', () => {
  const timeout = Object.assign(new Error(SECRET), { name: 'TimeoutError' });
  const abort = Object.assign(new Error(SECRET, { cause: timeout }), { name: 'AbortError', code: 'ABORT_ERR' });
  const request = new Error('HOSTED_GATEWAY_REQUEST_FAILED', { cause: abort });
  const outer = new Error(SECRET, { cause: request });
  assert.deepEqual(hostedGatewayTransportFailureDiagnostic(outer), {
    schemaVersion: 'wiselink.hosted-gateway-transport-failure.v1',
    errorCode: 'HOSTED_GATEWAY_REQUEST_FAILED', phase: 'REQUEST',
    causeCodes: ['ABORT_ERR'], causeNames: ['AbortError', 'TimeoutError'], syscalls: [],
    upstreamOutcome: 'UNKNOWN', retryAuthorized: false, rawErrorIncluded: false,
  });
  const diagnostic = hostedGatewayTransportFailureDiagnostic(transportError('HOSTED_GATEWAY_RESPONSE_INTERRUPTED'));
  assert.equal(diagnostic.phase, 'RESPONSE');
  assert.deepEqual(diagnostic.causeCodes, ['ECONNRESET']);
  assert.deepEqual(diagnostic.syscalls, ['read']);
  assert.ok(!JSON.stringify(diagnostic).includes(SECRET));
  assert.equal(hostedGatewayTransportFailureDiagnostic(Object.assign(new Error(SECRET), { code: 'ECONNRESET' })), null);
  assert.equal(hostedGatewayTransportFailureDiagnostic(new Error('HOSTED_GATEWAY_REQUEST_FAILED:' + SECRET)), null);
  assert.equal(hostedGatewayTransportFailureDiagnostic(new Error('HOSTED_GATEWAY_RESPONSE_TOO_LARGE')), null);
});

test('unknown, cyclic, deep and throwing cause fields cannot leak text or break diagnostics', () => {
  const unknown = transportError('HOSTED_GATEWAY_REQUEST_FAILED', SECRET);
  unknown.cause.name = SECRET;
  unknown.cause.syscall = SECRET;
  unknown.cause.cause = unknown;
  const diagnostic = hostedGatewayTransportFailureDiagnostic(unknown);
  assert.deepEqual(diagnostic.causeCodes, []);
  assert.deepEqual(diagnostic.causeNames, []);
  assert.deepEqual(diagnostic.syscalls, []);
  assert.equal(diagnostic.upstreamOutcome, 'UNKNOWN');
  assert.ok(!JSON.stringify(diagnostic).includes(SECRET));
  let reads = 0;
  const mutable = { get message() { return reads++ === 0 ? 'HOSTED_GATEWAY_REQUEST_FAILED' : SECRET; } };
  assert.equal(hostedGatewayTransportFailureDiagnostic(mutable).errorCode, 'HOSTED_GATEWAY_REQUEST_FAILED');
  assert.equal(reads, 1);
  const hostile = Object.defineProperties({}, Object.fromEntries(['message', 'cause', 'code', 'name', 'syscall']
    .map(key => [key, { get() { throw new Error(SECRET); } }])));
  assert.equal(hostedGatewayTransportFailureDiagnostic(hostile), null);
  assert.deepEqual(hostedGatewayTransportFailureDiagnostic(new Error('HOSTED_GATEWAY_REQUEST_FAILED', { cause: hostile })).causeCodes, []);
  let deep = transportError();
  for (let index = 0; index < 5; index++) deep = new Error(SECRET, { cause: deep });
  assert.equal(hostedGatewayTransportFailureDiagnostic(deep), null);
});

test('a real core HTTP deadline cause is classified without a second dispatch', async t => {
  let requests = 0;
  const server = createServer((req) => { requests++; req.resume(); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const error = await requestHostedGateway(`http://127.0.0.1:${server.address().port}/`, {
    method: 'POST', body: '{}', headers: {}, signal: AbortSignal.timeout(70),
  }).then(() => assert.fail('fixture must time out'), value => value);
  const diagnostic = hostedGatewayTransportFailureDiagnostic(error);
  assert.equal(diagnostic.errorCode, 'HOSTED_GATEWAY_REQUEST_FAILED');
  assert.deepEqual(diagnostic.causeCodes, ['ABORT_ERR']);
  assert.deepEqual(diagnostic.causeNames, ['AbortError', 'TimeoutError']);
  assert.equal(diagnostic.upstreamOutcome, 'UNKNOWN');
  assert.equal(diagnostic.retryAuthorized, false);
  assert.equal(requests, 1);
});

async function stageFixture(t) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-gateway-diagnostic-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const requestId = 'synthetic-queued-continuation';
  const options = { checkpointRoot, workItemId: 'WI-diag', operation: 'EVALUATE_JOBAID',
    initial: { workItemRevision: 3, documentVersionId: 'DV-diag', candidateOnly: true,
      status: 'REQUIRED', nextOperation: 'EVALUATE_JOBAID', stages: {
        translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: 'PENDING', requestId }, overall: { status: 'PENDING' },
      } } };
  const directory = initialStageCheckpointPath(options, options.operation, requestId);
  const checkpoint = await createCheckpointStore(directory);
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2' };
  const calls = [];
  let models = 0;
  const dependencies = error => ({
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'begin_dynamic_evaluation') return { status: 'RUNNING', attemptRef: 'AQ-diag',
        task: { deadline: '2099-01-01T00:00:00.000Z' }, modelInput };
      assert.equal(name, 'cancel_action_attempt');
      return { status: 'CANCELLED', attemptRef: 'AQ-diag' };
    },
    runInitial: async run => {
      await run.callTool('begin_dynamic_evaluation', { workItemId: options.workItemId, requestId });
      await run.evaluateDynamicRules(modelInput);
    },
    invokeInitialModel: async () => { models++; throw error; },
  });
  return { options, directory, checkpoint, calls, dependencies, modelCount: () => models };
}

test('confirmed initial cancellation persists the fixed cause without altering reason or replaying', async t => {
  const f = await stageFixture(t);
  const error = transportError();
  const dependencies = f.dependencies(error);
  const result = await runHostedInitialStage(f.options, dependencies);
  assert.equal(result.errorCode, 'HOSTED_GATEWAY_REQUEST_FAILED');
  assert.equal(result.attemptStatus, 'CANCELLED');
  assert.deepEqual(result.gatewayTransportFailure, hostedGatewayTransportFailureDiagnostic(error));
  assert.deepEqual(f.calls.map(call => call.name), ['begin_dynamic_evaluation', 'cancel_action_attempt']);
  assert.equal(f.calls[1].args.reason, 'HOSTED_INITIAL_EXECUTION_FAILED:HOSTED_GATEWAY_REQUEST_FAILED');
  assert.equal(f.modelCount(), 1);
  const bytes = await readFile(join(f.directory, 'run-result.json'));
  assert.deepEqual(JSON.parse(bytes), result);
  assert.ok(!bytes.includes(Buffer.from(SECRET)));
  await assert.rejects(runHostedInitialStage(f.options, dependencies), /INITIAL_COMPLETED_STAGE_HOST_DRIFT/u);
  assert.deepEqual(await readFile(join(f.directory, 'run-result.json')), bytes);
  assert.equal(f.modelCount(), 1);
  assert.equal(f.calls.length, 2);
});

test('ordinary Host failure has no transport annotation and an unrecorded cause stays unknown', async t => {
  const ordinary = await stageFixture(t);
  const result = await runHostedInitialStage(ordinary.options, ordinary.dependencies(new Error('INITIAL_MODEL_INVALID')));
  assert.equal(Object.hasOwn(result, 'gatewayTransportFailure'), false);
  assert.equal(result.errorCode, 'INITIAL_MODEL_INVALID');
  const unknown = await stageFixture(t);
  const next = await runHostedInitialStage(unknown.options, unknown.dependencies(new Error('HOSTED_GATEWAY_REQUEST_FAILED')));
  assert.deepEqual(next.gatewayTransportFailure.causeCodes, []);
  assert.deepEqual(next.gatewayTransportFailure.causeNames, []);
  assert.equal(next.gatewayTransportFailure.upstreamOutcome, 'UNKNOWN');
});

test('an uncertain cancellation persists only the invocation diagnostic without changing its queue claim', async () => {
  const claim = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-diag',
    documentVersionId: 'DV-diag', requestId: 'REQ-diag', workItemRevision: 3,
    leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436', leaseGeneration: 1, leaseExpiresAt: '2099-01-01T00:00:00.000Z',
    completionReady: false, consumerStopped: false, attentionCode: null, blockReady: null };
  const receipt = new Map([['active-claim', structuredClone(claim)]]);
  const writes = [];
  const checkpoint = {
    withActiveClaimOwner: perform => perform(),
    readOptional: async key => structuredClone(receipt.get(key) ?? null),
    write: async () => assert.fail('failed invocation must not change the shared claim'),
    writeOnce: async (key, value) => { writes.push(key); receipt.set(key, structuredClone(value)); },
  };
  const error = new Error('HOSTED_INITIAL_CANCEL_FAILED:HOSTED_GATEWAY_REQUEST_FAILED:REVIEW_STOP-ATTEMPT_OUTCOME_UNKNOWN',
    { cause: transportError() });
  let consumers = 0;
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint, now: () => new Date('2026-01-01T00:00:00.000Z'),
    nextWorkItem: async () => assert.fail('must not reclaim a valid lease'),
    acknowledgeWorkItem: async () => assert.fail('must not ACK an unknown result'),
    readInitialStatus: async () => ({ workItemRevision: 3, documentVersionId: 'DV-diag',
      status: 'REQUIRED', nextOperation: 'EVALUATE_JOBAID', stages: {
        translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: 'PENDING' }, overall: { status: 'PENDING' },
      } }),
    consumeWorkItem: async () => { consumers++; throw error; },
  }), value => value === error);
  assert.equal(consumers, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^consumer-failure-[a-f0-9-]+$/u);
  const saved = receipt.get(writes[0]);
  assert.equal(saved.attentionCode, 'HOSTED_INITIAL_CANCEL_FAILED:HOSTED_GATEWAY_REQUEST_FAILED:REVIEW_STOP-ATTEMPT_OUTCOME_UNKNOWN');
  assert.deepEqual(saved.gatewayTransportFailure, hostedGatewayTransportFailureDiagnostic(error));
  assert.equal(Object.hasOwn(saved, 'leaseToken'), false);
  assert.ok(!JSON.stringify(saved).includes(SECRET));
  assert.deepEqual(receipt.get('active-claim'), claim);
});
