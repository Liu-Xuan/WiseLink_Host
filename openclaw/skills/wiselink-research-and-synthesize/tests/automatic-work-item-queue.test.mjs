import assert from 'node:assert/strict';
import test from 'node:test';

import {
  automaticWorkItemQueueMode,
  consumeAutomaticWorkItemQueueTick,
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

test('terminal failure is Host-blocked and is never acknowledged', async () => {
  const checkpoint = memoryCheckpoint(null);
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING',
  });
  let acked = false;
  let blocked = false;
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => lease(1, '2026-09-25T01:00:00.000Z'),
    acknowledgeWorkItem: async () => { acked = true; },
    blockWorkItem: async input => {
      blocked = true;
      assert.deepEqual(input, {
        workItemId: 'WI-QUEUE', leaseToken: TOKEN_1, leaseGeneration: 1,
      });
      return {
        status: 'BLOCKED', workItemId: 'WI-QUEUE',
        blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED', replayed: false,
        blockedAt: '2026-09-25T00:01:00.000Z',
      };
    },
    readInitialStatus: async () => failed,
    consumeWorkItem: async () => assert.fail('terminal Host failure must not retry model work'),
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED');
  assert.equal(acked, false);
  assert.equal(blocked, true);
  assert.equal(checkpoint.values.get('active-claim'), null);
});

test('a lost terminal block response is replayed from the persisted exact claim', async () => {
  const checkpoint = memoryCheckpoint(null);
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING',
  });
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => lease(1, '2026-09-25T01:00:00.000Z'),
    acknowledgeWorkItem: async () => assert.fail('terminal failure must not ACK'),
    blockWorkItem: async () => { throw new Error('simulated response loss'); },
    readInitialStatus: async () => failed,
    consumeWorkItem: async () => assert.fail('terminal failure must not retry model work'),
  }), /simulated response loss/);
  assert.deepEqual(checkpoint.values.get('active-claim').blockReady, {
    stage: 'jobAid', status: 'FAILED',
  });

  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date('2026-09-25T02:00:00.000Z'),
    nextWorkItem: async () => assert.fail('block replay must not claim any WorkItem'),
    acknowledgeWorkItem: async () => assert.fail('block replay must not ACK'),
    blockWorkItem: async input => {
      assert.deepEqual(input, {
        workItemId: 'WI-QUEUE', leaseToken: TOKEN_1, leaseGeneration: 1,
      });
      return {
        status: 'BLOCKED', workItemId: 'WI-QUEUE',
        blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED', replayed: true,
        blockedAt: '2026-09-25T00:01:00.000Z',
      };
    },
    readInitialStatus: async () => assert.fail('Host block endpoint owns replay verification'),
    consumeWorkItem: async () => assert.fail('block replay must not run model work'),
  });
  assert.equal(result.errorCode, 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED');
  assert.equal(checkpoint.values.get('active-claim'), null);
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
