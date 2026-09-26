import assert from 'node:assert/strict';
import test from 'node:test';

import {
  automaticWorkItemQueueMode,
  consumeAutomaticWorkItemQueueTick,
  consumeHostedWorkItem,
} from '../scripts/consume-hosted-work-item.mjs';
import { createHostAutoWorkItemQueueClient } from '../scripts/run-hosted-review-turn.mjs';

const START = Date.parse('2026-09-25T00:00:00.000Z');
const TOKEN_1 = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';
const TOKEN_2 = 'a8e9a6e1-d1ab-4a58-9290-3634685d684c';

function lease(generation, expiresAt, workItemId = 'WI-QUEUE') {
  return {
    status: 'CLAIMED',
    workItemId,
    requestId: 'REQ-QUEUE',
    documentVersionId: 'DV-QUEUE',
    workItemRevision: generation + 1,
    leaseToken: generation === 1 ? TOKEN_1 : TOKEN_2,
    leaseGeneration: generation,
    leaseExpiresAt: expiresAt,
  };
}

function storedClaim(generation = 1, expiresAt = '2026-09-25T01:00:00.000Z') {
  const { status: _status, ...fields } = lease(generation, expiresAt);
  return {
    schemaVersion: 'wiselink.auto_work_item_claim.v1',
    ...fields,
    completionReady: false,
    consumerStopped: false,
    attentionCode: null,
    blockReady: null,
  };
}

function memoryCheckpoint(initialClaim = null, extras = {}) {
  const values = new Map([
    ['active-claim', structuredClone(initialClaim)],
    ...Object.entries(extras).map(([key, value]) => [key, structuredClone(value)]),
  ]);
  const writes = [];
  return {
    writes,
    values,
    readOptional: async key => structuredClone(values.get(key) ?? null),
    write: async (key, value) => {
      writes.push([key, structuredClone(value)]);
      values.set(key, structuredClone(value));
    },
  };
}

function status({
  overallStatus = 'REQUIRED',
  nextOperation = 'TRANSLATE',
  translation = 'PENDING',
  applicability = 'PENDING',
  jobAid = 'PENDING',
  overall = 'PENDING',
} = {}) {
  return {
    status: overallStatus,
    nextOperation,
    workItemRevision: 4,
    documentVersionId: 'DV-QUEUE',
    stages: {
      translation: { status: translation },
      applicability: { status: applicability },
      jobAid: { status: jobAid },
      overall: { status: overall },
    },
  };
}

function completeStatus() {
  return status({
    overallStatus: 'SUCCEEDED',
    nextOperation: null,
    translation: 'SUCCEEDED',
    applicability: 'WAITING_INPUT',
    jobAid: 'SUCCEEDED',
    overall: 'SUCCEEDED',
  });
}

test('automatic queue mode accepts only the exact queue flags', () => {
  assert.equal(automaticWorkItemQueueMode([]), false);
  assert.equal(automaticWorkItemQueueMode(['--auto-queue']), true);
  assert.equal(automaticWorkItemQueueMode([
    '--auto-queue', '--checkpoint-root', '/private/checkpoints',
    '--openclaw-config', '/private/openclaw.json',
  ]), true);
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--work-item-id', 'WI-X']),
    /AUTO_WORK_ITEM_QUEUE_OPTION_NOT_ALLOWED/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--checkpoint-root']),
    /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--agent', 'other-profile']),
    /AUTO_WORK_ITEM_QUEUE_OPTION_NOT_ALLOWED/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--auto-queue']),
    /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/,
  );
});

test('empty automatic queue returns IDLE without status reads or model calls', async () => {
  const checkpoint = memoryCheckpoint(null);
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async input => {
      assert.equal(input, undefined);
      return { status: 'IDLE' };
    },
    acknowledgeWorkItem: async () => assert.fail('empty queue must not ACK'),
    blockWorkItem: async () => assert.fail('empty queue must not block'),
    readInitialStatus: async () => assert.fail('empty queue must not read a WorkItem'),
    consumeWorkItem: async () => assert.fail('empty queue must not call a model'),
  });
  assert.deepEqual(result, { status: 'IDLE' });
  assert.deepEqual(checkpoint.writes, [['active-claim', null]]);
});

test('cross-tick work resumes the same lease scope and ACK waits for full initial completion', async () => {
  const checkpoint = memoryCheckpoint(null, { 'jobaid-model.output': { retained: true } });
  const initial = status();
  let clock = START;
  let nextCalls = [];
  let consumeCalls = [];
  let ackCalls = [];
  let step = 0;
  const dependencies = {
    checkpoint,
    now: () => new Date(clock),
    nextWorkItem: async input => {
      nextCalls.push(input);
      if (nextCalls.length === 1) return lease(1, '2026-09-25T01:00:00.000Z');
      assert.deepEqual(input, { resumeWorkItemId: 'WI-QUEUE' });
      return lease(2, '2026-09-25T02:01:00.000Z');
    },
    acknowledgeWorkItem: async input => {
      ackCalls.push(input);
      return {
        status: 'ACKNOWLEDGED', workItemId: 'WI-QUEUE', replayed: false,
        acknowledgedAt: '2026-09-25T01:06:00.000Z',
      };
    },
    blockWorkItem: async () => assert.fail('successful work must not block'),
    readInitialStatus: async workItemId => {
      assert.equal(workItemId, 'WI-QUEUE');
      return initial;
    },
    consumeWorkItem: async input => {
      consumeCalls.push(input);
      assert.equal(input.workItemId, 'WI-QUEUE');
      assert.equal(input.initialStageOnly, true);
      assert.equal(input.maxInitialStages, 1);
      assert.equal(input.applicabilityContextRef, undefined);
      step += 1;
      if (step === 1) {
        Object.assign(initial, status({
          nextOperation: 'EVALUATE_JOBAID',
          translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
        }));
      } else if (step === 2) {
        Object.assign(initial, status({
          nextOperation: 'SYNTHESIZE_OVERALL',
          translation: 'SUCCEEDED', applicability: 'WAITING_INPUT', jobAid: 'SUCCEEDED',
        }));
      } else {
        Object.assign(initial, completeStatus());
      }
      return { status: 'INITIAL_STAGE_SAVED' };
    },
  };

  const options = { checkpointRoot: '/private/wiselink-checkpoints' };
  const first = await consumeAutomaticWorkItemQueueTick(options, dependencies);
  assert.equal(first.status, 'IN_PROGRESS');
  assert.equal(first.leaseGeneration, 1);
  assert.equal(checkpoint.values.get('active-claim').status, undefined);
  assert.equal(ackCalls.length, 0);

  clock += 15 * 60_000;
  const second = await consumeAutomaticWorkItemQueueTick(options, dependencies);
  assert.equal(second.status, 'IN_PROGRESS');
  assert.equal(second.leaseGeneration, 1);
  assert.equal(nextCalls.length, 1, 'an unexpired lease is reused without a new claim');
  assert.equal(ackCalls.length, 0, 'JobAid/Overall work is not acknowledged early');
  assert.deepEqual(checkpoint.values.get('jobaid-model.output'), { retained: true });

  clock = Date.parse('2026-09-25T01:05:00.000Z');
  const third = await consumeAutomaticWorkItemQueueTick(options, dependencies);
  assert.equal(third.status, 'ACKNOWLEDGED');
  assert.equal(third.workItemId, 'WI-QUEUE');
  assert.equal(third.replayed, false);
  assert.deepEqual(nextCalls, [undefined, { resumeWorkItemId: 'WI-QUEUE' }]);
  assert.equal(consumeCalls.length, 3);
  assert.deepEqual(ackCalls, [{
    workItemId: 'WI-QUEUE', leaseToken: TOKEN_2, leaseGeneration: 2,
  }]);
  assert.equal(checkpoint.values.get('active-claim'), null);
  assert.deepEqual(checkpoint.values.get('jobaid-model.output'), { retained: true });
});

test('expired resume IDLE preserves the exact checkpoint and never consumes another pending item', async () => {
  const previous = storedClaim(1, '2026-09-25T00:59:00.000Z');
  const checkpoint = memoryCheckpoint(previous, { 'jobaid-model.output': { retained: true } });
  const originalClaim = structuredClone(previous);
  const originalJobAidCheckpoint = structuredClone(checkpoint.values.get('jobaid-model.output'));
  const nextCalls = [];
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date('2026-09-25T01:00:00.000Z'),
    nextWorkItem: async input => {
      nextCalls.push(input);
      // A different WorkItem is pending, but Host exact-resume correctly finds
      // no eligible lease for WI-QUEUE and returns IDLE.
      const otherPendingWorkItem = 'WI-OTHER';
      assert.equal(otherPendingWorkItem, 'WI-OTHER');
      return { status: 'IDLE' };
    },
    acknowledgeWorkItem: async () => assert.fail('IDLE must not ACK'),
    blockWorkItem: async () => assert.fail('IDLE must not block'),
    readInitialStatus: async () => assert.fail('IDLE must not read a different WorkItem'),
    consumeWorkItem: async () => assert.fail('IDLE must not run a model'),
  });

  assert.deepEqual(nextCalls, [{ resumeWorkItemId: 'WI-QUEUE' }]);
  assert.deepEqual(result, {
    status: 'REQUIRES_ATTENTION',
    workItemId: 'WI-QUEUE',
    requestId: 'REQ-QUEUE',
    documentVersionId: 'DV-QUEUE',
    leaseGeneration: 1,
    errorCode: 'AUTO_WORK_ITEM_EXPIRED_RECLAIM_UNAVAILABLE',
  });
  assert.equal(checkpoint.writes.length, 0);
  assert.deepEqual(checkpoint.values.get('active-claim'), originalClaim);
  assert.deepEqual(checkpoint.values.get('jobaid-model.output'), originalJobAidCheckpoint);
});

test('expired completion checkpoint replays its exact ACK receipt before clearing', async () => {
  const claim = storedClaim(4, '2026-09-25T00:59:00.000Z');
  claim.completionReady = true;
  const checkpoint = memoryCheckpoint(claim);
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date('2026-09-25T01:00:00.000Z'),
    nextWorkItem: async input => {
      assert.deepEqual(input, { resumeWorkItemId: 'WI-QUEUE' });
      return { status: 'IDLE' };
    },
    acknowledgeWorkItem: async input => {
      assert.deepEqual(input, {
        workItemId: 'WI-QUEUE', leaseToken: TOKEN_2, leaseGeneration: 4,
      });
      return {
        status: 'ACKNOWLEDGED', workItemId: 'WI-QUEUE', replayed: true,
        acknowledgedAt: '2026-09-25T00:58:00.000Z',
      };
    },
    blockWorkItem: async () => assert.fail('completed work must not block'),
    readInitialStatus: async () => assert.fail('completed receipt replay needs no new work read'),
    consumeWorkItem: async () => assert.fail('completed work must not be consumed again'),
  });
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.equal(result.replayed, true);
  assert.equal(checkpoint.values.get('active-claim'), null);
});

test('expired resume fails closed if a different item is returned', async () => {
  const previous = storedClaim(1, '2026-09-25T00:59:00.000Z');
  const checkpoint = memoryCheckpoint(previous);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date('2026-09-25T01:00:00.000Z'),
    nextWorkItem: async () => lease(2, '2026-09-25T02:00:00.000Z', 'WI-OTHER'),
    acknowledgeWorkItem: async () => assert.fail('mismatched item must not ACK'),
    blockWorkItem: async () => assert.fail('mismatched item must not block'),
    readInitialStatus: async () => assert.fail('mismatched item must not be read'),
    consumeWorkItem: async () => assert.fail('mismatched item must not be consumed'),
  }), /AUTO_WORK_ITEM_RECLAIM_SCOPE_MISMATCH/);
  assert.deepEqual(checkpoint.values.get('active-claim'), previous);
  assert.equal(checkpoint.writes.length, 0);
});

test('expired resume cannot silently change the original request or DocumentVersion', async () => {
  const previous = storedClaim(1, '2026-09-25T00:59:00.000Z');
  const checkpoint = memoryCheckpoint(previous);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date('2026-09-25T01:00:00.000Z'),
    nextWorkItem: async () => ({
      ...lease(2, '2026-09-25T02:00:00.000Z'),
      requestId: 'REQ-REPLACED',
      documentVersionId: 'DV-REPLACED',
    }),
    acknowledgeWorkItem: async () => assert.fail('changed binding must not ACK'),
    blockWorkItem: async () => assert.fail('changed binding must not block'),
    readInitialStatus: async () => assert.fail('changed binding must not be read'),
    consumeWorkItem: async () => assert.fail('changed binding must not be consumed'),
  }), /AUTO_WORK_ITEM_RECLAIM_BINDING_MISMATCH/);
  assert.deepEqual(checkpoint.values.get('active-claim'), previous);
  assert.equal(checkpoint.writes.length, 0);
});

test('a changed Host document version cannot be retried or acknowledged under the old claim', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('claim is still live'),
    acknowledgeWorkItem: async () => assert.fail('changed source cannot ACK'),
    blockWorkItem: async () => assert.fail('changed source cannot BLOCK'),
    readInitialStatus: async () => ({ ...completeStatus(), documentVersionId: 'DV-NEW' }),
    consumeWorkItem: async () => assert.fail('changed source cannot run'),
  }), /AUTO_WORK_ITEM_STATUS_SOURCE_CHANGED/u);
  assert.deepEqual(checkpoint.values.get('active-claim'), storedClaim());
});

test('unclassified stage failure stays available for diagnosis instead of blocking the document', async () => {
  const checkpoint = memoryCheckpoint(null);
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING',
  });
  let acked = false;
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => lease(1, '2026-09-25T01:00:00.000Z'),
    acknowledgeWorkItem: async () => { acked = true; },
    blockWorkItem: async () => assert.fail('run failure is not a business block'),
    readInitialStatus: async () => failed,
    consumeWorkItem: async () => ({ status: 'REQUIRES_ATTENTION', errorCode: 'JOBAID_WORK_FAILED' }),
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'JOBAID_WORK_FAILED');
  assert.equal(acked, false);
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
});

test('cancelled execution gets one exact automatic continuation and retains the queue grant', async () => {
  const checkpoint = memoryCheckpoint(null);
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING',
  });
  failed.stages.jobAid.attemptStatus = 'CANCELLED';
  failed.stages.jobAid.attemptRef = 'AQ-FAILED-FIRST';
  failed.stages.jobAid.requestId = 'original-1';
  failed.stages.jobAid.terminalCode = 'REVIEW_CHECKPOINT_ALREADY_EXISTS';
  let retry;
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => lease(1, '2026-09-25T01:00:00.000Z'),
    acknowledgeWorkItem: async () => assert.fail('cancelled attempt cannot ACK'),
    blockWorkItem: async () => assert.fail('cancelled attempt is not a business block'),
    readInitialStatus: async () => failed,
    consumeWorkItem: async input => {
      retry = input.autoRetry;
      return { status: 'REQUIRES_ATTENTION', errorCode: 'JOBAID_GATEWAY_HTTP_502' };
    },
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(retry.operation, 'EVALUATE_JOBAID');
  assert.equal(retry.attemptRef, failed.stages.jobAid.attemptRef);
  assert.match(retry.requestId, /^auto-retry-[0-9a-f]{32}$/u);
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
});

test('a stopped claim resumes a recoverable failure on the next tick', async () => {
  const checkpoint = memoryCheckpoint({ ...storedClaim(),
    consumerStopped: true, attentionCode: 'JOBAID_GATEWAY_HTTP_502' });
  const failed = status({ overallStatus: 'FAILED', nextOperation: null,
    translation: 'PENDING', applicability: 'WAITING_INPUT',
    jobAid: 'SUCCEEDED', overall: 'FAILED' });
  failed.stages.overall = { status: 'FAILED', attemptStatus: 'CANCELLED',
    attemptRef: 'AQ-CANCELLED', requestId: 'original-1',
    terminalCode: 'JOBAID_GATEWAY_HTTP_502' };
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('claim is still live'),
    acknowledgeWorkItem: async () => assert.fail('not yet complete'),
    blockWorkItem: async () => assert.fail('runtime failure cannot BLOCK'),
    readInitialStatus: async () => failed,
    consumeWorkItem: async input => {
      assert.equal(input.autoRetry.operation, 'SYNTHESIZE_OVERALL');
      return { status: 'BUSY' };
    },
  });
  assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, false);
});

test('failed retry is not retried again or BLOCKed', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'SUCCEEDED', overall: 'FAILED',
  });
  failed.stages.overall = {
    status: 'FAILED', attemptStatus: 'CANCELLED',
    attemptRef: 'AQ-RETRY-FAILED', requestId: 'auto-retry-1234',
    terminalCode: 'JOBAID_GATEWAY_HTTP_502',
  };
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('claim is still live'),
    acknowledgeWorkItem: async () => assert.fail('failed work cannot ACK'),
    blockWorkItem: async () => assert.fail('runtime failure cannot BLOCK'),
    readInitialStatus: async () => failed,
    consumeWorkItem: async input => {
      assert.equal(input.autoRetry, undefined);
      return { status: 'REQUIRES_ATTENTION', errorCode: 'JOBAID_GATEWAY_HTTP_502' };
    },
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
});

test('a failed first retry with newly saved work gets one bounded successor', async () => {
  const checkpoint = memoryCheckpoint({ ...storedClaim(), consumerStopped: true,
    attentionCode: 'HOSTED_GATEWAY_REQUEST_FAILED' });
  const failed = status({ overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING' });
  failed.stages.jobAid = { status: 'FAILED', attemptStatus: 'CANCELLED',
    attemptRef: 'AQ-RETRY-WITH-WORK', requestId: `auto-retry-${'a'.repeat(32)}`,
    terminalCode: 'CANCELLED_BY_REQUEST' };
  const saved = {
    schemaVersion: 'wiselink.jobaid-work-read.v2',
    executionStatus: 'CANCELLED', attemptId: 'ATT-RETRY-WITH-WORK',
    inputWorkRevision: 0,
    revision: { actionAttemptId: 'ATT-RETRY-WITH-WORK', workRevision: 15,
      workItemId: 'WI-QUEUE', documentVersionId: 'DV-QUEUE',
      basedOnWorkItemRevision: 4 },
  };
  let successor;
  const dependencies = {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('current claim is live'),
    acknowledgeWorkItem: async () => assert.fail('not complete'),
    blockWorkItem: async () => assert.fail('runtime failure cannot BLOCK'),
    readInitialStatus: async () => failed,
    readSavedWork: async (attemptRef, workItemId) => {
      assert.equal(attemptRef, 'AQ-RETRY-WITH-WORK');
      assert.equal(workItemId, 'WI-QUEUE');
      return saved;
    },
    consumeWorkItem: async input => {
      successor = input.autoRetry;
      return { status: 'REQUIRES_ATTENTION', errorCode: 'HOSTED_GATEWAY_REQUEST_FAILED' };
    },
  };
  const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(successor.operation, 'EVALUATE_JOBAID');
  assert.equal(successor.attemptRef, 'AQ-RETRY-WITH-WORK');
  assert.match(successor.requestId, /^auto-resume-2-[0-9a-f]{32}$/u);
  for (const bad of [
    { ...saved, inputWorkRevision: 15 },
    { ...saved, revision: { ...saved.revision, actionAttemptId: 'ATT-OTHER' } },
    { ...saved, revision: { ...saved.revision, documentVersionId: 'DV-OTHER' } },
  ]) {
    const stopped = memoryCheckpoint({ ...storedClaim(), consumerStopped: true,
      attentionCode: 'HOSTED_GATEWAY_REQUEST_FAILED' });
    const blocked = await consumeAutomaticWorkItemQueueTick({}, {
      ...dependencies, checkpoint: stopped,
      readSavedWork: async () => bad,
      consumeWorkItem: async () => assert.fail('unbound work cannot start a successor'),
    });
    assert.equal(blocked.status, 'REQUIRES_ATTENTION');
  }
  failed.stages.jobAid.requestId = successor.requestId;
  failed.stages.jobAid.attemptRef = 'AQ-SECOND-FAILED';
  const exhausted = await consumeAutomaticWorkItemQueueTick({}, {
    ...dependencies,
    consumeWorkItem: async () => assert.fail('second successor is the final attempt'),
  });
  assert.equal(exhausted.status, 'REQUIRES_ATTENTION');
});

test('failed preparation receives a stable new request and recovers saved JobAid work', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'PENDING', applicability: 'WAITING_INPUT',
    jobAid: 'SUCCEEDED', overall: 'FAILED',
  });
  failed.stages.overall = {
    status: 'FAILED', attemptStatus: 'FAILED',
    attemptRef: 'AQ-PREP-FAILED', requestId: 'original-1',
    terminalCode: 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED',
  };
  let observed = failed;
  let requestId;
  const dependencies = {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('claim is still live'),
    acknowledgeWorkItem: async () => ({
      status: 'ACKNOWLEDGED', workItemId: 'WI-QUEUE', replayed: false,
      acknowledgedAt: '2026-09-25T00:02:00.000Z',
    }),
    blockWorkItem: async () => assert.fail('recoverable failure cannot BLOCK'),
    readInitialStatus: async () => observed,
    consumeWorkItem: async input => {
      assert.equal(input.autoRetry.operation, 'SYNTHESIZE_OVERALL');
      requestId = input.autoRetry.requestId;
      observed = completeStatus();
      return { status: 'INITIAL_STAGE_SAVED', operation: 'SYNTHESIZE_OVERALL' };
    },
  };
  const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.match(requestId, /^auto-retry-[0-9a-f]{32}$/u);
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.equal(checkpoint.values.get('active-claim'), null);
});

test('an old uncertain block intent is kept for review without another mutation', async () => {
  const checkpoint = memoryCheckpoint({
    ...storedClaim(), blockReady: { stage: 'jobAid', status: 'FAILED' },
  });
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date('2026-09-25T02:00:00.000Z'),
    nextWorkItem: async () => assert.fail('block replay must not claim any WorkItem'),
    acknowledgeWorkItem: async () => assert.fail('block replay must not ACK'),
    blockWorkItem: async () => assert.fail('unknown old receipt cannot be resent'),
    readInitialStatus: async () => assert.fail('uncertain block must stop before status work'),
    consumeWorkItem: async () => assert.fail('uncertain block must not run model work'),
  });
  assert.equal(result.errorCode, 'AUTO_WORK_ITEM_PRIOR_BLOCK_RECEIPT_UNCERTAIN');
  assert.equal(checkpoint.values.get('active-claim').workItemId, 'WI-QUEUE');
});

test('queue REST client sends exact resume body and exposes ACK and terminal block routes', async () => {
  const requests = [];
  const client = createHostAutoWorkItemQueueClient({
    hostMcpUrl: 'https://host.example/openapi/wiselink/openclaw-mcp',
    headers: { authorization: 'Bearer test' },
  }, async (url, init) => {
    requests.push({ url: new URL(url), init });
    return {
      ok: true,
      headers: { get: name => name === 'content-type' ? 'application/json' : null },
      json: async () => ({ accepted: true }),
    };
  });
  await client.nextWorkItem({ resumeWorkItemId: 'WI-QUEUE' });
  await client.acknowledgeWorkItem({ workItemId: 'WI-QUEUE' });
  await client.blockWorkItem({ workItemId: 'WI-QUEUE' });
  assert.deepEqual(requests.map(request => request.url.pathname), [
    '/openapi/wiselink/next-work-item',
    '/openapi/wiselink/ack-work-item',
    '/openapi/wiselink/block-work-item',
  ]);
  assert.deepEqual(JSON.parse(requests[0].init.body), { resumeWorkItemId: 'WI-QUEUE' });
  assert.equal(requests[0].init.headers.authorization, 'Bearer test');
});

function originalPreparationDependencies(checkpoint, overrides = {}) {
  return {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('claim is still live'),
    acknowledgeWorkItem: async () => assert.fail('preparation cannot ACK'),
    blockWorkItem: async () => assert.fail('preparation cannot BLOCK'),
    readInitialStatus: async () => status({ overallStatus: 'NOT_READY', nextOperation: null }),
    consumeWorkItem: async () => assert.fail('unprepared source cannot run a model'),
    ...overrides,
  };
}

for (const parseRunId of [undefined, 'PARSE-PARTIAL']) {
  test(`automatic original preparation advances one bounded step (${parseRunId ?? 'missing'})`, async () => {
    const checkpoint = memoryCheckpoint(storedClaim());
    let preparations = 0;
    let reads = 0;
    const result = await consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
      prepareOriginal: async (...args) => {
        assert.deepEqual(args, ['WI-QUEUE'], 'lease token must not reach the MCP preparation call');
        preparations += 1;
        return { status: 'ORIGINAL_PREPARING', documentVersionId: 'DV-QUEUE',
          ...(parseRunId ? { parseRunId } : {}) };
      },
      readInitialStatus: async () => {
        reads += 1;
        return status({ overallStatus: 'NOT_READY', nextOperation: null });
      },
    }));
    assert.equal(result.status, 'IN_PROGRESS');
    assert.equal(result.consumerStatus, 'ORIGINAL_PREPARING');
    assert.equal(preparations, 1);
    assert.equal(reads, 2);
    assert.deepEqual(checkpoint.values.get('active-claim'), storedClaim());
    assert.equal(checkpoint.values.get('last-original-preparation').parseRunId, parseRunId);
  });
}

test('newly ready original continues at most one analysis stage in the same tick', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  let prepared = false;
  let consumed = 0;
  const result = await consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
    prepareOriginal: async () => {
      assert.equal(prepared, false);
      prepared = true;
      return { status: 'ORIGINAL_READY', documentVersionId: 'DV-QUEUE', parseRunId: 'PARSE-READY' };
    },
    readInitialStatus: async () => prepared ? status()
      : status({ overallStatus: 'NOT_READY', nextOperation: null }),
    consumeWorkItem: async input => {
      consumed += 1;
      assert.equal(input.initialStageOnly, true);
      assert.equal(input.maxInitialStages, 1);
      assert.equal(input.leaseToken, undefined);
      return { status: 'INITIAL_STAGE_SAVED' };
    },
  }));
  assert.equal(consumed, 1);
  assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(result.consumerStatus, 'INITIAL_STAGE_SAVED');
});

for (const failure of ['attention', 'throw', 'busy']) {
  test(`original preparation ${failure} preserves claim and diagnostic report`, async () => {
    const checkpoint = memoryCheckpoint(storedClaim());
    const result = await consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
      prepareOriginal: async () => {
        if (failure === 'throw') throw new Error('DOCUMENT_PARSE_STEP_FAILED');
        return { status: failure === 'busy' ? 'BUSY' : 'REQUIRES_ATTENTION',
          documentVersionId: 'DV-QUEUE', errorCode: 'DOCUMENT_PARSE_STEP_FAILED' };
      },
    }));
    assert.equal(result.status, failure === 'busy' ? 'IN_PROGRESS' : 'REQUIRES_ATTENTION');
    assert.deepEqual(checkpoint.values.get('active-claim'), storedClaim());
    assert.equal(checkpoint.values.get('last-original-preparation').status,
      failure === 'busy' ? 'BUSY' : 'REQUIRES_ATTENTION');
    if (failure !== 'busy') assert.equal(result.errorCode, 'DOCUMENT_PARSE_STEP_FAILED');
  });
}

for (const drift of ['before', 'preparation', 'after']) {
  test(`source version drift ${drift} preparation rejects analysis`, async () => {
    const checkpoint = memoryCheckpoint(storedClaim());
    let reads = 0;
    await assert.rejects(consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
      readInitialStatus: async () => {
        reads += 1;
        return { ...status({ overallStatus: 'NOT_READY', nextOperation: null }),
          documentVersionId: drift === 'before' || (drift === 'after' && reads > 1)
            ? 'DV-CHANGED' : 'DV-QUEUE' };
      },
      prepareOriginal: async () => {
        assert.notEqual(drift, 'before');
        return { status: 'ORIGINAL_READY',
          documentVersionId: drift === 'preparation' ? 'DV-CHANGED' : 'DV-QUEUE' };
      },
    })), /AUTO_WORK_ITEM_STATUS_SOURCE_CHANGED/u);
    assert.deepEqual(checkpoint.values.get('active-claim'), storedClaim());
  });
}

test('static NOT_READY WorkItem remains read-only and never prepares an original', async () => {
  const calls = [];
  const result = await consumeHostedWorkItem({ workItemId: 'WI-QUEUE',
    checkpointRoot: '/private/tmp/wiselink-static-not-ready', maxInitialStages: 1 }, {
    callTool: async name => {
      calls.push(name);
      assert.equal(name, 'get_parse_status');
      return { entry: { workItemId: 'WI-QUEUE' }, initialAnalysis: {
        ...status({ overallStatus: 'NOT_READY', nextOperation: null }),
        candidateOnly: true, applicabilityContextRef: null,
      } };
    },
    prepareOriginal: async () => assert.fail('static mode cannot prepare originals'),
    invokeInitialModel: async () => assert.fail('static NOT_READY cannot run a model'),
  });
  assert.equal(result.status, 'NOT_READY');
  assert.deepEqual(calls, ['get_parse_status']);
});

for (const code of ['DOCUMENT_PLUGIN_QUOTA_EXHAUSTED', 'DOCUMENT_PLUGIN_RATE_LIMITED']) {
  test(`original preparation preserves safe MCP ${code} in result and checkpoint`, async () => {
    const checkpoint = memoryCheckpoint(storedClaim());
    const result = await consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
      prepareOriginal: async () => {
        throw Object.assign(new Error('private provider text token=fixture-private-token'), {
          receivedHostToolError: true, hostToolName: 'next_original_assessment', hostErrorCode: code,
        });
      },
    }));
    const expected = `REVIEW_HOST_MCP_TOOL_FAILED:next_original_assessment:${code}`;
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.errorCode, expected);
    assert.equal(checkpoint.values.get('last-original-preparation').errorCode, expected);
    assert.deepEqual(checkpoint.values.get('active-claim'), storedClaim());
    assert.equal(JSON.stringify([...checkpoint.values]).includes('fixture-private-token'), false);
  });
}

for (const unsafe of [
  'REVIEW_HOST_MCP_TOOL_FAILED:private_tool:SECRET_TOKEN',
  'REVIEW_HOST_MCP_TOOL_FAILED:next_original_assessment:DOCUMENT_PLUGIN_RATE_LIMITED:SECRET_TOKEN',
  'REVIEW_HOST_MCP_TOOL_FAILED:next_original_assessment:DOCUMENT_PLUGIN_RATE_LIMITED token=fixture-private-token',
  'REVIEW_HOST_MCP_TOOL_FAILED:next_original_assessment:lowercase-secret',
]) {
  test(`original attention discards unsafe tool diagnostic ${unsafe.split(':')[1]}`, async () => {
    const checkpoint = memoryCheckpoint(storedClaim());
    const result = await consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
      prepareOriginal: async () => ({ status: 'REQUIRES_ATTENTION', documentVersionId: 'DV-QUEUE', errorCode: unsafe }),
    }));
    assert.equal(result.errorCode, 'AUTO_WORK_ITEM_CONSUMER_STOPPED');
    assert.equal(checkpoint.values.get('last-original-preparation').errorCode, 'AUTO_WORK_ITEM_CONSUMER_STOPPED');
  });
}

test('a known MCP tool without a retained host code still preserves its safe call site', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  const result = await consumeAutomaticWorkItemQueueTick({}, originalPreparationDependencies(checkpoint, {
    prepareOriginal: async () => { throw Object.assign(new Error('private provider text'), {
      receivedHostToolError: true, hostToolName: 'next_original_assessment', hostErrorCode: null,
    }); },
  }));
  assert.equal(result.errorCode, 'REVIEW_HOST_MCP_TOOL_FAILED:next_original_assessment');
});
