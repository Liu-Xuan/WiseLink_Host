import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticQueueBatchOptions,
  automaticWorkItemQueueMode,
  consumeAutomaticWorkItemQueueBatch,
  consumeAutomaticWorkItemQueueTick,
} from '../scripts/consume-hosted-work-item.mjs';

const NOW = '2026-10-19T12:00:00.000Z';
const TOKEN = 'b1686364-7ee9-4ca1-a3aa-0b62794cb436';

function fixture(kind = 'DOCUMENT', initial = {}) {
  const values = new Map(Object.entries(initial));
  const trace = [];
  let held = false, owners = 0, ordinary = 0, wiki = 0;
  const checkpoint = {
    readOptional: async key => structuredClone(values.get(key) ?? null),
    write: async (key, value) => { assert.equal(held, true); values.set(key, structuredClone(value)); },
    withActiveClaimOwner: async run => {
      assert.equal(held, false); held = true; owners += 1;
      try { return await run(); } finally { held = false; }
    },
  };
  const complete = id => ({ status: 'SUCCEEDED', nextOperation: null,
    documentVersionId: `DV-${id}`, workItemRevision: 1,
    stages: Object.fromEntries(['translation', 'applicability', 'jobAid', 'overall']
      .map(stage => [stage, { status: 'SUCCEEDED' }])) });
  const dependencies = {
    checkpoint, now: () => new Date(NOW),
    nextWorkItem: async () => {
      assert.equal(held, true); ordinary += 1;
      if (kind === 'DOCUMENT') return { status: 'DOCUMENT_PENDING', documentVersionId: `DV-${ordinary}`,
        deliveryRef: `acquisition:ACQ-${ordinary}`, documentAfterRef: `acquisition:ACQ-${ordinary}` };
      if (kind === 'REVIEW') return { status: 'REVIEW_PENDING', workItemId: `WI-${ordinary}`,
        reviewTurnRef: `RT-${ordinary}`, reviewAfterWorkItemId: `WI-${ordinary}` };
      return { status: 'CLAIMED', workItemId: `WI-${ordinary}`, requestId: `REQ-${ordinary}`,
        documentVersionId: `DV-WI-${ordinary}`, workItemRevision: 1,
        leaseToken: TOKEN, leaseGeneration: 1, leaseExpiresAt: '2026-10-19T13:00:00.000Z' };
    },
    readInitialStatus: async id => complete(id),
    acknowledgeWorkItem: async ({ workItemId }) => {
      trace.push('WORK');
      return { status: 'ACKNOWLEDGED', workItemId, replayed: false, acknowledgedAt: NOW };
    },
    consumeWorkItem: async () => assert.fail('already complete WorkItem must only ACK'),
    consumeDocument: async () => { trace.push('WORK'); return { status: 'DOCUMENT_READY' }; },
    consumeReview: async () => { trace.push('WORK'); return { status: 'CANDIDATE_SAVED' }; },
    consumeWikiIdle: async () => {
      assert.equal(held, true); trace.push('WIKI'); wiki += 1;
      return { status: 'WIKI_DISPATCHED', summaryId: `DS-${wiki}`, attemptRef: `AQ-${wiki}` };
    },
  };
  return { dependencies, checkpoint, values, trace, counts: () => ({ owners, ordinary, wiki, held }) };
}

for (const kind of ['DOCUMENT', 'REVIEW', 'WORK_ITEM']) {
  test(`continuous ${kind} receives work while Wiki gets a bounded alternating opportunity`, async () => {
    const f = fixture(kind);
    for (let index = 0; index < 40; index += 1)
      await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
    assert.deepEqual(f.trace, Array.from({ length: 40 }, (_, i) => i % 2 ? 'WIKI' : 'WORK'));
    assert.equal(f.counts().ordinary, 20);
    assert.equal(f.counts().wiki, 20);
  });
}

test('a restarted invocation reads the durable turn instead of restarting ordinary priority', async () => {
  const f = fixture();
  await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
  assert.equal(f.values.get('queue-turn'), 'WIKI');
  await consumeAutomaticWorkItemQueueTick({}, { ...f.dependencies });
  assert.deepEqual(f.trace, ['WORK', 'WIKI']);
  assert.equal(f.values.get('queue-turn'), 'WORK');
});

test('one batch holds one owner, runs sequentially and respects its item bound', async () => {
  const f = fixture();
  let active = 0, peak = 0;
  f.dependencies.consumeDocument = async () => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active -= 1; f.trace.push('WORK');
    return { status: 'DOCUMENT_READY' };
  };
  const result = await consumeAutomaticWorkItemQueueBatch({ maxQueueItems: 16 }, f.dependencies);
  assert.equal(f.counts().owners, 1);
  assert.equal(peak, 1);
  assert.equal(result.queueBatch.processedItems, 16);
  assert.equal(result.queueBatch.stopReason, 'ITEM_LIMIT');
  assert.deepEqual(f.trace, Array.from({ length: 16 }, (_, i) => i % 2 ? 'WIKI' : 'WORK'));
});

test('an empty Wiki probe yields ordinary work in the same bounded batch without duplicate probes', async () => {
  const f = fixture();
  let probes = 0;
  f.dependencies.consumeWikiIdle = async () => { probes += 1; return { status: 'IDLE' }; };
  const result = await consumeAutomaticWorkItemQueueBatch({}, f.dependencies);
  assert.equal(result.queueBatch.processedItems, 4);
  assert.equal(f.counts().ordinary, 4);
  assert.equal(probes, 3);
  assert.deepEqual(f.trace, ['WORK', 'WORK', 'WORK', 'WORK']);
});

test('time budget stops only between completed subjects and does not expand the item bound', async () => {
  const f = fixture();
  let elapsed = -500;
  f.dependencies.monotonicNow = () => elapsed += 500;
  const result = await consumeAutomaticWorkItemQueueBatch({ maxQueueItems: 16, queueTickBudgetMs: 1000 }, f.dependencies);
  assert.equal(result.queueBatch.processedItems, 2);
  assert.equal(result.queueBatch.stopReason, 'TIME_BUDGET');
  assert.deepEqual(f.trace, ['WORK', 'WIKI']);
});

test('active Wiki UNKNOWN resumes before a corrupt fairness cursor and never starts ordinary work', async () => {
  const active = { schemaVersion: 1, summaryId: 'DS-current', attemptRef: 'AQ-current', phase: 'PREPARING' };
  const f = fixture('DOCUMENT', { 'active-wiki': active, 'queue-turn': 'BROKEN' });
  f.dependencies.consumeWikiIdle = async () => ({ status: 'WIKI_ATTENTION', errorCode: 'WIKI_PROVIDER_TERMINAL_UNKNOWN' });
  const result = await consumeAutomaticWorkItemQueueBatch({}, f.dependencies);
  assert.equal(result.status, 'WIKI_ATTENTION');
  assert.equal(result.queueBatch.processedItems, 1);
  assert.equal(f.counts().ordinary, 0);
  assert.deepEqual(f.values.get('active-wiki'), active);
});

test('an existing WorkItem is ACKed before a pending Wiki turn or corrupt cursor', async () => {
  const claim = { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-current',
    requestId: 'REQ-current', documentVersionId: 'DV-WI-current', workItemRevision: 1,
    leaseToken: TOKEN, leaseGeneration: 1, leaseExpiresAt: '2026-10-19T13:00:00.000Z',
    completionReady: true, consumerStopped: false, attentionCode: null, blockReady: null };
  const f = fixture('WORK_ITEM', { 'active-claim': claim, 'queue-turn': 'BROKEN' });
  const result = await consumeAutomaticWorkItemQueueBatch({ maxQueueItems: 1 }, f.dependencies);
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.equal(f.counts().ordinary, 0);
  assert.equal(f.counts().wiki, 0);
  assert.deepEqual(f.trace, ['WORK']);
  assert.equal(f.values.get('queue-turn'), 'WIKI');
});

test('an UNKNOWN successor retains its pointer and prevents further batch dispatch', async () => {
  const active = { status: 'OVERALL_PENDING', workItemId: 'WI-current',
    reviewTurnRef: 'RT-current', workRevisionRef: 'JAWR-current', reviewAfterWorkItemId: 'WI-current' };
  const f = fixture('DOCUMENT', { 'active-successor-overall': active, 'queue-turn': 'WIKI' });
  f.dependencies.consumeSuccessorOverall = async () => { throw new Error('PROVIDER_UNKNOWN'); };
  await assert.rejects(consumeAutomaticWorkItemQueueBatch({}, f.dependencies), /PROVIDER_UNKNOWN/u);
  assert.equal(f.counts().ordinary, 0);
  assert.equal(f.counts().wiki, 0);
  assert.deepEqual(f.values.get('active-successor-overall'), active);
  assert.equal(f.counts().held, false);
});

test('pending model/save confirmation stops a batch and does not move its ordinary turn', async () => {
  const f = fixture();
  f.dependencies.consumeDocument = async () => ({ status: 'PENDING_MODEL_CONFIRMATION' });
  const result = await consumeAutomaticWorkItemQueueBatch({}, f.dependencies);
  assert.equal(result.queueBatch.processedItems, 1);
  assert.equal(result.queueBatch.stopReason, 'PENDING_OR_IDLE');
  assert.equal(f.counts().wiki, 0);
  assert.equal(f.values.get('queue-turn'), undefined);
});

test('a known closed Wiki failure yields ordinary work and preserves its attention', async () => {
  const f = fixture('DOCUMENT', { 'queue-turn': 'WIKI' });
  f.dependencies.consumeWikiIdle = async () => ({ status: 'WIKI_ATTENTION', errorCode: 'KNOWN_CLOSED_FAILURE' });
  const result = await consumeAutomaticWorkItemQueueTick({}, f.dependencies);
  assert.equal(result.status, 'DOCUMENT_DISPATCHED');
  assert.equal(result.wikiAttention.errorCode, 'KNOWN_CLOSED_FAILURE');
  assert.deepEqual(f.trace, ['WORK']);
});

test('a system failure escapes once without starting further subjects', async () => {
  const f = fixture();
  delete f.dependencies.consumeWikiIdle;
  f.dependencies.consumeDocument = async () => { throw new Error('HOST_UNREACHABLE'); };
  await assert.rejects(consumeAutomaticWorkItemQueueBatch({}, f.dependencies), /HOST_UNREACHABLE/u);
  assert.equal(f.counts().ordinary, 1);
  assert.equal(f.counts().held, false);
});

test('CLI accepts bounded batch options only for normal automatic queue dispatch', () => {
  assert.deepEqual(automaticQueueBatchOptions([]), { maxQueueItems: 4, queueTickBudgetMs: 900000 });
  assert.equal(automaticWorkItemQueueMode(['--auto-queue', '--queue-max-items', '8', '--queue-tick-budget-ms', '30000']), true);
  for (const args of [
    ['--queue-max-items', '0'], ['--queue-max-items', '17'],
    ['--queue-tick-budget-ms', '999'], ['--queue-tick-budget-ms', '900001'],
    ['--queue-max-items', '2', '--queue-max-items', '3'], ['--queue-max-items=2'],
  ]) assert.throws(() => automaticQueueBatchOptions(args), /AUTO_QUEUE_BATCH_OPTIONS_INVALID/u);
  assert.throws(() => automaticWorkItemQueueMode(['--queue-max-items', '2']), /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/u);
  assert.throws(() => automaticWorkItemQueueMode(['--auto-queue', '--queue-max-items', '2',
    '--repair-stopped-claim', '--repair-work-item-id', 'WI-a', '--repair-attempt-ref', 'AQ-a']),
  /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/u);
});
