import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  automaticWorkItemQueueMode,
  consumeAutomaticWorkItemQueueTick,
  consumeHostedDocument,
  consumeHostedWorkItem,
  runHostedSuccessorOverall,
} from '../scripts/consume-hosted-work-item.mjs';
import { createHostAutoWorkItemQueueClient } from '../scripts/run-hosted-review-turn.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';
import { consumeHierarchicalWikiIdle } from '../scripts/consume-hierarchical-wiki-queue.mjs';

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
  let ownerHeld = false;
  return {
    writes,
    values,
    withActiveClaimOwner: async perform => {
      if (ownerHeld) throw new Error('AUTO_WORK_ITEM_QUEUE_OWNER_BUSY');
      ownerHeld = true;
      try { return await perform(); } finally { ownerHeld = false; }
    },
    readOptional: async key => structuredClone(values.get(key) ?? null),
    write: async (key, value) => {
      writes.push([key, structuredClone(value)]);
      values.set(key, structuredClone(value));
    },
    writeOnce: async (key, value) => {
      if (values.has(key)) throw new Error(`REVIEW_CHECKPOINT_ALREADY_EXISTS:${key}`);
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

test('automatic queue dispatches an admitted document without inventing a WorkItem claim', async () => {
  const checkpoint = memoryCheckpoint();
  const calls = [];
  const result = await consumeAutomaticWorkItemQueueTick({}, {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => ({ status: 'DOCUMENT_PENDING', documentVersionId: 'DV-document',
      deliveryRef: 'work-item:WI-document', documentAfterRef: 'attempt:ATT-document' }),
    acknowledgeWorkItem: async () => { throw new Error('UNEXPECTED_ACK'); },
    consumeWorkItem: async () => { throw new Error('UNEXPECTED_WORK_ITEM'); },
    readInitialStatus: async () => { throw new Error('UNEXPECTED_STATUS'); },
    consumeDocument: async (documentVersionId, deliveryRef) => {
      calls.push({ documentVersionId, deliveryRef });
      return { status: 'DOCUMENT_READY', documentVersionId };
    },
  });
  assert.deepEqual(calls, [{ documentVersionId: 'DV-document', deliveryRef: 'work-item:WI-document' }]);
  assert.deepEqual(result, { status: 'DOCUMENT_DISPATCHED',
    documentVersionId: 'DV-document', deliveryRef: 'work-item:WI-document',
    document: { status: 'DOCUMENT_READY', documentVersionId: 'DV-document' } });
  assert.equal(checkpoint.values.get('active-claim'), null);
});
test('a later natural queue tick uses a new recovery ID to recheck Host admission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'document-queue-recovery-'));
  try {
    const checkpoint = memoryCheckpoint();
    const deliveryRef = 'work-item:WI-document';
    let recovery = 'initial';
    let repaired = false;
    let starts = 0;
    const dependencies = {
      checkpoint, now: () => new Date(START),
      nextWorkItem: async () => ({ status: 'DOCUMENT_PENDING', documentVersionId: 'DV-document',
        deliveryRef, documentAfterRef: 'attempt:ATT-document' }),
      acknowledgeWorkItem: async () => assert.fail('document is not a WorkItem claim'),
      consumeWorkItem: async () => assert.fail('document is not a WorkItem claim'),
      readInitialStatus: async () => assert.fail('document is not a WorkItem claim'),
      consumeDocument: (documentVersionId, selectedRef) => consumeHostedDocument(
        { documentVersionId, deliveryRef: selectedRef }, {
          documentTranslationCheckpoint: parseRunId => createCheckpointStore(join(
            directory, documentVersionId, encodeURIComponent(selectedRef), parseRunId, recovery)),
          callTool: async (name, args) => {
            assert.equal(args.deliveryRef, deliveryRef);
            if (name === 'document_work') return args.action === 'INDEX'
              ? { documentVersionId, parseRunId: 'PRUN-document', status: 'INDEXED' }
              : { documentVersionId, latestRun: { documentVersionId,
                parseRunId: 'PRUN-document', status: 'PUBLISHED' },
                documentDelivery: { reading: false, translation: 'ZH_FULL' } };
            if (args.action === 'STATUS') return { documentVersionId,
              parseRunId: 'PRUN-document', status: 'IDLE', semanticReady: true };
            assert.equal(args.action, 'START');
            starts += 1;
            if (!repaired) throw Object.assign(new Error('denied'), {
              receivedHostToolError: true, hostToolName: name,
              hostErrorCode: 'DOCUMENT_TRANSLATION_ADMISSION_DENIED',
            });
            return { documentVersionId, parseRunId: 'PRUN-document',
              attemptRef: 'DTQ-document', status: 'QUEUED' };
          },
        }),
    };
    assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).document.status,
      'REQUIRES_ATTENTION');
    assert.equal(starts, 1);
    repaired = true;
    assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).document.status,
      'REQUIRES_ATTENTION');
    assert.equal(starts, 1, 'unchanged recovery ID keeps the prior admission stop');
    recovery = 'fixed-host-admission-1';
    assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).document.status,
      'QUEUED');
    assert.equal(starts, 2, 'the next natural tick rechecks Host with its saved request ID');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('document discovery advances a bounded cursor across idle ticks', async () => {
  const checkpoint = memoryCheckpoint();
  const inputs = [];
  const dependencies = {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async input => {
      inputs.push(input);
      return inputs.length === 1
        ? { status: 'IDLE', documentAfterRef: 'attempt:ATT-one' }
        : { status: 'DOCUMENT_PENDING', documentVersionId: 'DV-document',
          deliveryRef: 'work-item:WI-document', documentAfterRef: 'attempt:ATT-document' };
    },
    acknowledgeWorkItem: async () => { throw new Error('UNEXPECTED_ACK'); },
    consumeWorkItem: async () => { throw new Error('UNEXPECTED_WORK_ITEM'); },
    readInitialStatus: async () => { throw new Error('UNEXPECTED_STATUS'); },
    consumeDocument: async () => ({ status: 'DOCUMENT_READY' }),
  };
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status, 'IDLE');
  assert.equal(checkpoint.values.get('document-cursor'), 'attempt:ATT-one');
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status,
    'DOCUMENT_DISPATCHED');
  assert.deepEqual(inputs, [undefined, { documentAfterRef: 'attempt:ATT-one' }]);
});

test('a preparing upload still gets STEP while its cursor rotates to later acquisitions and wraps', async () => {
  const checkpoint = memoryCheckpoint();
  const inputs = [];
  const steps = [];
  const dependencies = {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async input => {
      inputs.push(input);
      const after = input?.documentAfterRef;
      if (after === 'acquisition:ACQ-two') return { status: 'IDLE' };
      const acquisitionId = after ? 'ACQ-two' : 'ACQ-one';
      return { status: 'DOCUMENT_PENDING', documentVersionId: `DV-${acquisitionId}`,
        deliveryRef: `acquisition:${acquisitionId}`,
        documentAfterRef: `acquisition:${acquisitionId}` };
    },
    acknowledgeWorkItem: async () => { throw new Error('UNEXPECTED_ACK'); },
    consumeWorkItem: async () => { throw new Error('UNEXPECTED_WORK_ITEM'); },
    readInitialStatus: async () => { throw new Error('UNEXPECTED_STATUS'); },
    consumeDocument: (documentVersionId, deliveryRef) => consumeHostedDocument(
      { documentVersionId, deliveryRef }, { callTool: async (name, args) => {
        assert.equal(name, 'document_work');
        assert.equal(args.deliveryRef, deliveryRef);
        if (args.action === 'STATUS') return { documentVersionId, runtimeAvailable: true,
          latestRun: { documentVersionId, parseRunId: `PRUN-${documentVersionId}`,
            status: 'RUNNING', deadlineAt: new Date(Date.now() + 60_000).toISOString() } };
        assert.equal(args.action, 'STEP');
        assert.equal(checkpoint.values.get('document-cursor'), deliveryRef,
          'cursor is durable before document STEP');
        steps.push(deliveryRef);
        return { parseRunId: `PRUN-${documentVersionId}`, status: 'STAGING' };
      } }),
  };
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status, 'DOCUMENT_DISPATCHED');
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status, 'DOCUMENT_DISPATCHED');
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status, 'IDLE');
  assert.equal(checkpoint.values.get('document-cursor'), null);
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status, 'DOCUMENT_DISPATCHED');
  assert.deepEqual(steps, ['acquisition:ACQ-one', 'acquisition:ACQ-two', 'acquisition:ACQ-one']);
  assert.deepEqual(inputs, [undefined,
    { documentAfterRef: 'acquisition:ACQ-one' },
    { documentAfterRef: 'acquisition:ACQ-two' }, undefined]);
});

test('pending WorkItems persist attempt cursors before STEP, then reach uploads and wrap', async () => {
  const checkpoint = memoryCheckpoint();
  const inputs = [];
  const steps = [];
  const pending = [
    { status: 'DOCUMENT_PENDING', documentVersionId: 'DV-one',
      deliveryRef: 'work-item:WI-one', documentAfterRef: 'attempt:ATT-one' },
    { status: 'DOCUMENT_PENDING', documentVersionId: 'DV-two',
      deliveryRef: 'work-item:WI-two', documentAfterRef: 'attempt:ATT-two' },
    { status: 'DOCUMENT_PENDING', documentVersionId: 'DV-upload',
      deliveryRef: 'acquisition:ACQ-upload', documentAfterRef: 'acquisition:ACQ-upload' },
  ];
  const dependencies = {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async input => {
      inputs.push(input);
      const after = input?.documentAfterRef;
      if (after === 'attempt:ATT-one') return pending[1];
      if (after === 'attempt:ATT-two') return pending[2];
      if (after === 'acquisition:ACQ-upload') return { status: 'IDLE' };
      return pending[0];
    },
    acknowledgeWorkItem: async () => assert.fail('document dispatch must not ACK a WorkItem'),
    consumeWorkItem: async () => assert.fail('document dispatch must not claim a WorkItem'),
    readInitialStatus: async () => assert.fail('document dispatch must not read initial status'),
    consumeDocument: (documentVersionId, deliveryRef) => consumeHostedDocument(
      { documentVersionId, deliveryRef }, { callTool: async (name, args) => {
        assert.equal(name, 'document_work');
        assert.equal(args.deliveryRef, deliveryRef);
        if (args.action === 'STATUS') return { documentVersionId, runtimeAvailable: true,
          latestRun: { documentVersionId, parseRunId: `PRUN-${documentVersionId}`,
            status: 'RUNNING', deadlineAt: new Date(Date.now() + 60_000).toISOString() } };
        assert.equal(args.action, 'STEP');
        const expectedCursor = pending.find(item => item.deliveryRef === deliveryRef).documentAfterRef;
        assert.equal(checkpoint.values.get('document-cursor'), expectedCursor,
          'exact cursor is durable before document STEP');
        steps.push(deliveryRef);
        return { parseRunId: `PRUN-${documentVersionId}`, status: 'STAGING' };
      } }),
  };
  for (let index = 0; index < 3; index++)
    assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status,
      'DOCUMENT_DISPATCHED');
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status, 'IDLE');
  assert.equal(checkpoint.values.get('document-cursor'), null);
  assert.equal((await consumeAutomaticWorkItemQueueTick({}, dependencies)).status,
    'DOCUMENT_DISPATCHED');
  assert.deepEqual(steps, ['work-item:WI-one', 'work-item:WI-two',
    'acquisition:ACQ-upload', 'work-item:WI-one']);
  assert.deepEqual(inputs, [undefined, { documentAfterRef: 'attempt:ATT-one' },
    { documentAfterRef: 'attempt:ATT-two' },
    { documentAfterRef: 'acquisition:ACQ-upload' }, undefined]);
});

test('pending WorkItem rejects a cursor from another source kind before dispatch', async () => {
  const checkpoint = memoryCheckpoint();
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => ({ status: 'DOCUMENT_PENDING',
      documentVersionId: 'DV-one', deliveryRef: 'work-item:WI-one',
      documentAfterRef: 'acquisition:ACQ-other' }),
    acknowledgeWorkItem: async () => assert.fail('invalid cursor must not acknowledge'),
    consumeWorkItem: async () => assert.fail('invalid cursor must not consume WorkItem'),
    readInitialStatus: async () => assert.fail('invalid cursor must not read status'),
    consumeDocument: async () => assert.fail('invalid cursor must not dispatch'),
  }), /AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID/u);
  assert.equal(checkpoint.values.get('document-cursor'), undefined);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => ({ status: 'DOCUMENT_PENDING',
      documentVersionId: 'DV-one', deliveryRef: 'work-item:WI-one' }),
    acknowledgeWorkItem: async () => assert.fail('missing cursor must not acknowledge'),
    consumeWorkItem: async () => assert.fail('missing cursor must not claim'),
    readInitialStatus: async () => assert.fail('missing cursor must not read status'),
    consumeDocument: async () => assert.fail('missing cursor must not dispatch'),
  }), /AUTO_WORK_ITEM_CLAIM_RESPONSE_MISSING_FIELD/u);
  assert.equal(checkpoint.values.get('document-cursor'), undefined);
});

test('document cursor must exactly bind to the pending acquisition', async () => {
  const checkpoint = memoryCheckpoint();
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => ({ status: 'DOCUMENT_PENDING',
      documentVersionId: 'DV-one', deliveryRef: 'acquisition:ACQ-one',
      documentAfterRef: 'acquisition:ACQ-other' }),
    acknowledgeWorkItem: async () => assert.fail('invalid cursor must not acknowledge'),
    consumeWorkItem: async () => assert.fail('invalid cursor must not consume WorkItem'),
    readInitialStatus: async () => assert.fail('invalid cursor must not read status'),
    consumeDocument: async () => assert.fail('invalid cursor must not dispatch'),
  }), /AUTO_WORK_ITEM_CLAIM_RESPONSE_INVALID/u);
  assert.equal(checkpoint.values.get('document-cursor'), undefined);
});

test('a stopped queue claim resumes only an exact sealed Overall attempt', async t => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-queue-committing-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const claim = memoryCheckpoint({ ...storedClaim(), consumerStopped: true,
    attentionCode: 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN' });
  const stageStore = await createCheckpointStore(initialStageCheckpointPath(
    { checkpointRoot, workItemId: 'WI-QUEUE' }, 'SYNTHESIZE_OVERALL', 'REQ-OVERALL'));
  const exact = { attemptRef: 'ATT-OVERALL', status: 'RUNNING', leaseGeneration: 2,
    leaseToken: 'frozen', task: { workItemId: 'WI-QUEUE', documentVersionId: 'DV-QUEUE' } };
  await stageStore.write('binding', { workItemId: 'WI-QUEUE', documentVersionId: 'DV-QUEUE',
    operation: 'SYNTHESIZE_OVERALL', requestId: 'REQ-OVERALL' });
  await stageStore.write('begin_overall_synthesis-1.result', { value: exact });
  let current = status({ overallStatus: 'BUSY', nextOperation: null, translation: 'SUCCEEDED',
    applicability: 'WAITING_INPUT', jobAid: 'SUCCEEDED', overall: 'BUSY' });
  current.stages.overall = { status: 'BUSY', attemptStatus: 'COMMITTING',
    attemptRef: 'ATT-OVERALL', requestId: 'REQ-OVERALL' };
  let consumed = 0;
  const dependencies = { checkpoint: claim, now: () => new Date(START),
    consumeWikiIdle: async () => assert.fail('sealed COMMITTING recovery has priority over Wiki'),
    nextWorkItem: async () => assert.fail('lease is live'),
    acknowledgeWorkItem: async () => ({ status: 'ACKNOWLEDGED', workItemId: 'WI-QUEUE',
      replayed: false, acknowledgedAt: new Date(START).toISOString() }),
    readInitialStatus: async () => current,
    consumeWorkItem: async input => { consumed += 1;
      assert.equal(input.workItemId, 'WI-QUEUE');
      current = completeStatus();
      return { status: 'INITIAL_STAGE_SAVED' };
    },
  };
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot }, dependencies);
  assert.equal(result.status, 'ACKNOWLEDGED');
  assert.equal(consumed, 1);
  assert.equal(claim.values.get('active-claim'), null);
});

test('automatic queue mode accepts only the exact queue flags', () => {
  assert.equal(automaticWorkItemQueueMode([]), false);
  assert.equal(automaticWorkItemQueueMode(['--auto-queue']), true);
  assert.equal(automaticWorkItemQueueMode([
    '--auto-queue', '--document-translation-recovery', 'fixed-host-admission-1',
  ]), true);
  assert.equal(automaticWorkItemQueueMode([
    '--auto-queue', '--repair-stopped-claim',
    '--repair-work-item-id', 'WI-QUEUE',
    '--repair-attempt-ref', 'AQ-RETRY-NO-WORK',
  ]), true);
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
  for (const args of [
    ['--document-translation-recovery'],
    ['--document-translation-recovery', '../unsafe'],
    ['--document-translation-recovery', 'fixed-1', '--document-translation-recovery', 'fixed-2'],
  ]) {
    assert.throws(() => automaticWorkItemQueueMode(['--auto-queue', ...args]),
      /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/);
  }
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--agent', 'other-profile']),
    /AUTO_WORK_ITEM_QUEUE_OPTION_NOT_ALLOWED/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--auto-queue']),
    /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--repair-stopped-claim']),
    /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--repair-work-item-id', 'WI-QUEUE']),
    /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--repair-stopped-claim',
      '--repair-stopped-claim']),
    /AUTO_WORK_ITEM_QUEUE_OPTIONS_INVALID/,
  );
  assert.throws(
    () => automaticWorkItemQueueMode(['--auto-queue', '--repair-stopped-claim']),
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

test('completed-task review uses its own turn and cursor without an initial lease ACK', async () => {
  const checkpoint = memoryCheckpoint(null);
  const requests = [];
  const dependencies = {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async input => {
      requests.push(input);
      if (requests.length === 1)
        return { status: 'IDLE', reviewAfterWorkItemId: 'WI-EARLIER' };
      return { status: 'REVIEW_PENDING', workItemId: 'WI-REVIEW',
        reviewTurnRef: 'RT-EXPLICIT', reviewAfterWorkItemId: 'WI-REVIEW' };
    },
    acknowledgeWorkItem: async () => assert.fail('review must not ACK an initial lease'),
    readInitialStatus: async () => assert.fail('review must not read initial-stage status'),
    consumeWorkItem: async () => assert.fail('review must not rerun initial analysis'),
    consumeReview: async workItemId => {
      assert.equal(workItemId, 'WI-REVIEW');
      return { status: 'CANDIDATE_SAVED', reviewTurnRef: 'RT-EXPLICIT' };
    },
  };
  assert.deepEqual(await consumeAutomaticWorkItemQueueTick({}, dependencies), { status: 'IDLE' });
  const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.equal(result.status, 'REVIEW_DISPATCHED');
  assert.equal(result.review.status, 'CANDIDATE_SAVED');
  assert.deepEqual(requests, [undefined, { reviewAfterWorkItemId: 'WI-EARLIER' }]);
  assert.equal(checkpoint.values.get('review-cursor'), 'WI-REVIEW');
  assert.equal(checkpoint.values.get('active-claim'), null);
});

test('requested successor Overall uses the exact Review work and advances the cursor only after success', async () => {
  const checkpoint = memoryCheckpoint(null);
  let shouldFail = true;
  let calls = 0;
  let discoveries = 0;
  const dependencies = {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => { discoveries += 1; return { status: 'OVERALL_PENDING', workItemId: 'WI-REVIEW',
      reviewTurnRef: 'RT-EXPLICIT', workRevisionRef: 'JAWR-EXACT',
      reviewAfterWorkItemId: 'WI-REVIEW' }; },
    acknowledgeWorkItem: async () => assert.fail('successor Overall has no initial lease ACK'),
    readInitialStatus: async () => assert.fail('successor Overall has no initial-stage status'),
    consumeWorkItem: async () => assert.fail('successor Overall must not rerun initial stages'),
    consumeSuccessorOverall: async pointer => {
      calls += 1;
      assert.equal(pointer.workRevisionRef, 'JAWR-EXACT');
      if (shouldFail) throw new Error('TRANSIENT_OVERALL_FAILURE');
      return { status: 'SUCCESSOR_OVERALL_SAVED' };
    },
  };
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, dependencies), /TRANSIENT_OVERALL_FAILURE/);
  assert.equal(checkpoint.values.get('review-cursor'), undefined);
  assert.equal(checkpoint.values.get('active-successor-overall').reviewTurnRef, 'RT-EXPLICIT');
  shouldFail = false;
  const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.equal(result.status, 'OVERALL_DISPATCHED');
  assert.equal(result.overall.status, 'SUCCESSOR_OVERALL_SAVED');
  assert.equal(checkpoint.values.get('review-cursor'), 'WI-REVIEW');
  assert.equal(checkpoint.values.get('active-successor-overall'), null);
  assert.equal(calls, 2);
  assert.equal(discoveries, 1, 'a saved successor pointer resumes before fresh discovery');
});

test('terminal successor Overall clears only its local pointer and reports attention', async () => {
  const pointer = { status: 'OVERALL_PENDING', workItemId: 'WI-REVIEW',
    reviewTurnRef: 'RT-EXPLICIT', workRevisionRef: 'JAWR-EXACT',
    reviewAfterWorkItemId: 'WI-REVIEW' };
  const checkpoint = memoryCheckpoint(null, { 'active-successor-overall': pointer });
  const dependencies = {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => assert.fail('saved pointer must be handled first'),
    acknowledgeWorkItem: async () => assert.fail('no initial lease'),
    readInitialStatus: async () => assert.fail('no initial stage'),
    consumeWorkItem: async () => assert.fail('no initial work'),
    consumeSuccessorOverall: async () => {
      throw Object.assign(new Error('terminal'), { hostToolName: 'begin_overall_synthesis',
        hostErrorCode: 'ACTION_ATTEMPT_ALREADY_FAILED' });
    },
  };
  await expectTerminalSuccessorAttention(dependencies, checkpoint);
});

async function expectTerminalSuccessorAttention(dependencies, checkpoint) {
  const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.deepEqual(result, { status: 'REQUIRES_ATTENTION', workItemId: 'WI-REVIEW',
    reviewTurnRef: 'RT-EXPLICIT', errorCode: 'ACTION_ATTEMPT_ALREADY_FAILED' });
  assert.equal(checkpoint.values.get('active-successor-overall'), null);
  assert.equal(checkpoint.values.get('review-cursor'), 'WI-REVIEW');
}

test('successor Overall readback finishes an already succeeded exact attempt without model execution', async t => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-successor-overall-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  let statusReads = 0;
  const pointer = { workItemId: 'WI-REVIEW', reviewTurnRef: 'RT-EXPLICIT',
    workRevisionRef: 'JAWR-EXACT', checkpointRoot };
  const result = await runHostedSuccessorOverall(pointer, {
    callTool: async (name, args) => {
      if (name === 'get_parse_status') {
        assert.deepEqual(args, { workItemId: 'WI-REVIEW', successorReviewTurnRef: 'RT-EXPLICIT' });
        statusReads += 1;
        return { integratedAssessmentSummary: { overallSynthesis: {
          basedOnJobAidWorkRevisionRef: 'JAWR-EXACT',
        } } };
      }
      assert.equal(name, 'begin_overall_synthesis');
      const error = new Error('REVIEW_HOST_MCP_TOOL_FAILED:begin_overall_synthesis:ACTION_ATTEMPT_ALREADY_SUCCEEDED');
      error.hostToolName = name;
      error.hostErrorCode = 'ACTION_ATTEMPT_ALREADY_SUCCEEDED';
      throw error;
    },
    invokeInitialModel: async () => assert.fail('saved work must not regenerate'),
  });
  assert.equal(result.status, 'SUCCESSOR_OVERALL_SAVED');
  assert.equal(result.recoveredByReadback, true);
  assert.equal(statusReads, 2);
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

test('lost ACK response retains completion and resumes from the Host receipt', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  const ackInputs = [];
  let responseLost = true;
  const dependencies = {
    checkpoint,
    now: () => new Date(START),
    nextWorkItem: async () => assert.fail('the existing lease is still active'),
    acknowledgeWorkItem: async input => {
      ackInputs.push(input);
      if (responseLost) {
        responseLost = false;
        // The Host commits, but this response never reaches the consumer.
        throw new Error('SIMULATED_ACK_RESPONSE_LOST');
      }
      return {
        status: 'ACKNOWLEDGED', workItemId: 'WI-QUEUE', replayed: true,
        acknowledgedAt: '2026-09-25T00:00:00.000Z',
      };
    },
    blockWorkItem: async () => assert.fail('transport failure must not block'),
    readInitialStatus: async () => completeStatus(),
    consumeWorkItem: async () => assert.fail('saved work must not be regenerated'),
  };

  await assert.rejects(
    consumeAutomaticWorkItemQueueTick({}, dependencies),
    /SIMULATED_ACK_RESPONSE_LOST/u,
  );
  assert.equal(checkpoint.values.get('active-claim').completionReady, true);
  assert.equal(ackInputs.length, 1);

  const resumed = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.equal(resumed.status, 'ACKNOWLEDGED');
  assert.equal(resumed.replayed, true);
  assert.deepEqual(ackInputs, [
    { workItemId: 'WI-QUEUE', leaseToken: TOKEN_1, leaseGeneration: 1 },
    { workItemId: 'WI-QUEUE', leaseToken: TOKEN_1, leaseGeneration: 1 },
  ]);
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

test('cancelled execution cannot invent an automatic continuation and retains its queue grant', async () => {
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
  assert.equal(retry, undefined);
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
});

test('a stopped cancelled claim does not turn provider uncertainty into an automatic retry', async () => {
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
    consumeWorkItem: async () => assert.fail('cancelled attempt has no new Host stage grant'),
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
});

function unknownStoppedClaim() {
  return { ...storedClaim(), consumerStopped: true,
    attentionCode: 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN' };
}

function stoppedAttentionDependencies(checkpoint, extra = {}) {
  return {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => assert.fail('stopped live claim cannot take a new grant'),
    acknowledgeWorkItem: async () => assert.fail('UNKNOWN cannot acknowledge'),
    blockWorkItem: async () => assert.fail('UNKNOWN cannot block'),
    consumeWorkItem: async () => assert.fail('UNKNOWN cannot repeat the ordinary model'),
    readInitialStatus: async () => status(),
    ...extra,
  };
}

test('a stopped UNKNOWN claim preserves its attention while enabled Wiki runs under the same owner', async () => {
  const claim = unknownStoppedClaim();
  const checkpoint = memoryCheckpoint(claim);
  const dependencies = stoppedAttentionDependencies(checkpoint, {
    consumeWikiIdle: async () => {
      await assert.rejects(consumeAutomaticWorkItemQueueTick({}, dependencies),
        /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
      return { status: 'WIKI_DISPATCHED', summaryId: 'DS-wiki', attemptRef: 'AQ-wiki' };
    },
  });
  const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, claim.attentionCode);
  assert.equal(result.workItemId, claim.workItemId);
  assert.equal(result.requestId, claim.requestId);
  assert.equal(result.documentVersionId, claim.documentVersionId);
  assert.equal(result.initialStatus, 'REQUIRED');
  assert.deepEqual(result.wiki, { status: 'WIKI_DISPATCHED', summaryId: 'DS-wiki', attemptRef: 'AQ-wiki' });
  assert.deepEqual(checkpoint.values.get('active-claim'), claim);
  assert.deepEqual(checkpoint.writes, []);
  assert.equal(JSON.stringify(result).includes(claim.leaseToken), false);
});

for (const mode of ['disabled', 'idle', 'error']) {
  test(`stopped UNKNOWN retains ordinary attention when Wiki is ${mode}`, async () => {
    const claim = unknownStoppedClaim();
    const checkpoint = memoryCheckpoint(claim);
    const dependencies = stoppedAttentionDependencies(checkpoint, mode === 'disabled' ? {} : {
      consumeWikiIdle: async () => {
        if (mode === 'error') throw new Error('WIKI_ACTIVE_POINTER_INVALID');
        return { status: 'IDLE' };
      },
    });
    const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.errorCode, claim.attentionCode);
    assert.deepEqual(result.wiki, mode === 'disabled' ? undefined : mode === 'idle'
      ? { status: 'IDLE' } : { status: 'WIKI_ATTENTION', errorCode: 'WIKI_ACTIVE_POINTER_INVALID' });
    assert.deepEqual(checkpoint.values.get('active-claim'), claim);
    assert.deepEqual(checkpoint.writes, []);
  });
}

for (const attentionCode of ['AUTO_WORK_ITEM_CONSUMER_STOPPED',
  'INITIAL_APPLICABILITY_MODEL_OUTCOME_UNKNOWN', 'JOBAID_SOURCE_AUTHORIZATION_CHANGED']) {
  test(`Wiki does not turn unrelated stopped attention ${attentionCode} into idle`, async () => {
    const claim = { ...unknownStoppedClaim(), attentionCode };
    const checkpoint = memoryCheckpoint(claim);
    const result = await consumeAutomaticWorkItemQueueTick({}, stoppedAttentionDependencies(checkpoint, {
      consumeWikiIdle: async () => assert.fail('only the exact stopped assessment UNKNOWN may yield'),
    }));
    assert.equal(result.errorCode, attentionCode);
    assert.equal(result.wiki, undefined);
    assert.deepEqual(checkpoint.values.get('active-claim'), claim);
  });
}

for (const change of [{ consumerStopped: false }, { completionReady: true },
  { blockReady: { stage: 'jobAid', status: 'FAILED' } },
  { attentionCode: 'AUTO_WORK_ITEM_CONSUMER_STOPPED' }]) {
  test(`an active Wiki still rejects incompatible ordinary pointer ${JSON.stringify(change)}`, async () => {
    const claim = { ...unknownStoppedClaim(), ...change };
    const checkpoint = memoryCheckpoint(claim, { 'active-wiki': {
      schemaVersion: 1, summaryId: 'DS-wiki', attemptRef: 'AQ-wiki', phase: 'PREPARING' } });
    await assert.rejects(consumeAutomaticWorkItemQueueTick({}, stoppedAttentionDependencies(checkpoint, {
      consumeWikiIdle: async () => assert.fail('conflicting pointer cannot dispatch'),
    })), /AUTO_WORK_ITEM_WIKI_CHECKPOINT_CONFLICT/u);
    assert.deepEqual(checkpoint.values.get('active-claim'), claim);
    assert.deepEqual(checkpoint.writes, []);
  });
}

test('an active Wiki cannot coexist with operator repair or a successor pointer', async () => {
  for (const mode of ['repair', 'successor']) {
    const checkpoint = memoryCheckpoint(unknownStoppedClaim(), {
      'active-wiki': { schemaVersion: 1, summaryId: 'DS-wiki', attemptRef: 'AQ-wiki', phase: 'PREPARING' },
      ...(mode === 'successor' ? { 'active-successor-overall': { workItemId: 'WI-other' } } : {}),
    });
    await assert.rejects(consumeAutomaticWorkItemQueueTick(mode === 'repair' ? { repairStoppedClaim: true } : {},
      stoppedAttentionDependencies(checkpoint, {
        consumeWikiIdle: async () => assert.fail('mixed recovery cannot dispatch'),
      })), /AUTO_WORK_ITEM_WIKI_CHECKPOINT_CONFLICT/u);
    assert.deepEqual(checkpoint.writes, []);
  }
});

test('a resumable ordinary task takes priority over a new Wiki dispatch', async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  let consumed = 0;
  const result = await consumeAutomaticWorkItemQueueTick({}, stoppedAttentionDependencies(checkpoint, {
    consumeWorkItem: async () => { consumed++; return { status: 'INITIAL_STAGE_SAVED' }; },
    consumeWikiIdle: async () => assert.fail('ordinary progress has priority'),
  }));
  assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(consumed, 1);
  assert.equal(result.wiki, undefined);
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

test('operator repair admits one exact stopped no-work retry without BLOCK or implicit replay', async () => {
  const stopped = { ...storedClaim(), workItemRevision: 4, consumerStopped: true,
    attentionCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' };
  const failed = status({ overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING' });
  failed.stages.jobAid = { status: 'FAILED', attemptStatus: 'CANCELLED',
    attemptRef: 'AQ-RETRY-NO-WORK', requestId: `auto-retry-${'a'.repeat(32)}`,
    terminalCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' };
  const saved = { schemaVersion: 'wiselink.jobaid-work-read.v2',
    executionStatus: 'CANCELLED', attemptId: 'ATT-RETRY-NO-WORK',
    inputWorkRevision: 0, revision: null };
  const checkpoint = memoryCheckpoint(stopped);
  const makeDependencies = overrides => ({
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => assert.fail('stopped live claim cannot take another item'),
    acknowledgeWorkItem: async () => assert.fail('failed work cannot ACK'),
    blockWorkItem: async () => assert.fail('runtime failure cannot BLOCK'),
    readInitialStatus: async () => failed,
    readSavedWork: async () => saved,
    consumeWorkItem: async () => assert.fail('repair must be explicit'),
    ...overrides,
  });
  const ordinary = await consumeAutomaticWorkItemQueueTick({}, makeDependencies());
  assert.equal(ordinary.status, 'REQUIRES_ATTENTION');
  assert.deepEqual(checkpoint.values.get('active-claim'), stopped);
  let repair;
  const repairOptions = { repairStoppedClaim: true, repairWorkItemId: 'WI-QUEUE',
    repairAttemptRef: 'AQ-RETRY-NO-WORK' };
  const resumed = await consumeAutomaticWorkItemQueueTick(repairOptions,
    makeDependencies({ consumeWorkItem: async input => {
      repair = input;
      return { status: 'REQUIRES_ATTENTION', errorCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' };
    } }));
  assert.equal(resumed.status, 'REQUIRES_ATTENTION');
  assert.equal(repair.autoRetry.operation, 'EVALUATE_JOBAID');
  assert.equal(repair.autoRetry.attemptRef, 'AQ-RETRY-NO-WORK');
  assert.match(repair.autoRetry.requestId, /^auto-repair-[0-9a-f]{32}$/u);
  assert.equal(repair.repairStoppedClaim, true);
  assert.equal(repair.repairAttentionCode, stopped.attentionCode);
  assert.equal(repair.repairWorkItemRevision, 4);
  assert.equal(repair.repairAttemptRef, 'AQ-RETRY-NO-WORK');
  assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
  failed.stages.jobAid.requestId = repair.autoRetry.requestId;
  const exhausted = await consumeAutomaticWorkItemQueueTick(repairOptions,
    makeDependencies());
  assert.equal(exhausted.status, 'REQUIRES_ATTENTION');
});

test('repair never claims another item or changes an unrelated stopped claim', async () => {
  for (const initialClaim of [null, storedClaim(),
    { ...storedClaim(), consumerStopped: true }]) {
    const checkpoint = memoryCheckpoint(initialClaim);
    await assert.rejects(() => consumeAutomaticWorkItemQueueTick({
      repairStoppedClaim: true, repairWorkItemId: 'WI-OTHER',
      repairAttemptRef: 'AQ-RETRY-NO-WORK',
    }, {
      checkpoint, now: () => new Date(START),
      nextWorkItem: async () => assert.fail('repair cannot claim another item'),
      acknowledgeWorkItem: async () => assert.fail('repair cannot ACK'),
      readInitialStatus: async () => assert.fail('repair cannot read another item'),
      consumeWorkItem: async () => assert.fail('repair cannot consume another item'),
    }), /AUTO_WORK_ITEM_REPAIR_CLAIM_UNAVAILABLE/u);
    assert.deepEqual(checkpoint.values.get('active-claim'), initialClaim);
  }
});

test('repair rejects a changed revision during lease reclaim before checkpoint mutation', async () => {
  const stopped = { ...storedClaim(1, '2026-09-24T23:00:00.000Z'),
    consumerStopped: true,
    attentionCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' };
  const checkpoint = memoryCheckpoint(stopped);
  await assert.rejects(() => consumeAutomaticWorkItemQueueTick({
    repairStoppedClaim: true, repairWorkItemId: 'WI-QUEUE',
    repairAttemptRef: 'AQ-RETRY-NO-WORK',
  }, {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => ({ ...lease(2, '2026-09-25T02:00:00.000Z'),
      workItemRevision: 5 }),
    acknowledgeWorkItem: async () => assert.fail('repair cannot ACK'),
    readInitialStatus: async () => assert.fail('changed revision cannot be read'),
    consumeWorkItem: async () => assert.fail('changed revision cannot run'),
  }), /AUTO_WORK_ITEM_REPAIR_REVISION_CHANGED/u);
  assert.deepEqual(checkpoint.values.get('active-claim'), stopped);
  assert.equal(checkpoint.writes.length, 0);
});

test('repair interruption preserves the stopped claim and its stable successor request', async () => {
  const stopped = { ...storedClaim(), workItemRevision: 4, consumerStopped: true,
    attentionCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' };
  const failed = status({ overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING' });
  failed.stages.jobAid = { status: 'FAILED', attemptStatus: 'CANCELLED',
    attemptRef: 'AQ-RETRY-NO-WORK', requestId: `auto-retry-${'d'.repeat(32)}`,
    terminalCode: stopped.attentionCode };
  const checkpoint = memoryCheckpoint(stopped);
  const ids = [];
  const run = () => consumeAutomaticWorkItemQueueTick({
    repairStoppedClaim: true, repairWorkItemId: 'WI-QUEUE',
    repairAttemptRef: 'AQ-RETRY-NO-WORK',
  }, {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => assert.fail('active lease must be retained'),
    acknowledgeWorkItem: async () => assert.fail('no completed result'),
    readInitialStatus: async () => failed,
    readSavedWork: async () => ({ schemaVersion: 'wiselink.jobaid-work-read.v2',
      executionStatus: 'CANCELLED', attemptId: 'ATT-RETRY-NO-WORK',
      inputWorkRevision: 0, revision: null }),
    consumeWorkItem: async input => {
      ids.push(input.autoRetry.requestId);
      throw new Error('SIMULATED_PROCESS_EXIT');
    },
  });
  await assert.rejects(run, /SIMULATED_PROCESS_EXIT/u);
  assert.deepEqual(checkpoint.values.get('active-claim'), stopped);
  await assert.rejects(run, /SIMULATED_PROCESS_EXIT/u);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test('repair refuses saved work, changed revision and authorization failure', async () => {
  const failed = status({ overallStatus: 'FAILED', nextOperation: null,
    translation: 'SUCCEEDED', applicability: 'WAITING_INPUT',
    jobAid: 'FAILED', overall: 'PENDING' });
  failed.stages.jobAid = { status: 'FAILED', attemptStatus: 'CANCELLED',
    attemptRef: 'AQ-RETRY-NO-WORK', requestId: `auto-retry-${'b'.repeat(32)}`,
    terminalCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' };
  const saved = { schemaVersion: 'wiselink.jobaid-work-read.v2',
    executionStatus: 'CANCELLED', attemptId: 'ATT-RETRY-NO-WORK',
    inputWorkRevision: 0, revision: null };
  for (const change of [
    { saved: { ...saved, revision: { workRevision: 1 } } },
    { initial: { ...failed, workItemRevision: 5 } },
    { initial: { ...failed, stages: { ...failed.stages,
      jobAid: { ...failed.stages.jobAid, terminalCode: 'SOURCE_REVOKED' } } } },
  ]) {
    const checkpoint = memoryCheckpoint({ ...storedClaim(), workItemRevision: 4,
      consumerStopped: true,
      attentionCode: 'JOBAID_GATEWAY_HTTP_400:INCOMPLETE_TERMINAL_RESPONSE' });
    const run = () => consumeAutomaticWorkItemQueueTick({ repairStoppedClaim: true,
      repairWorkItemId: 'WI-QUEUE', repairAttemptRef: 'AQ-RETRY-NO-WORK' }, {
      checkpoint, now: () => new Date(START),
      nextWorkItem: async () => assert.fail('claim remains live'),
      acknowledgeWorkItem: async () => assert.fail('cannot ACK'),
      readInitialStatus: async () => change.initial ?? failed,
      readSavedWork: async () => change.saved ?? saved,
      consumeWorkItem: async () => assert.fail('ineligible repair cannot execute'),
    });
    if (change.initial?.workItemRevision === 5) {
      await assert.rejects(run, /AUTO_WORK_ITEM_REPAIR_REVISION_CHANGED/u);
    } else {
      assert.equal((await run()).status, 'REQUIRES_ATTENTION');
    }
    assert.equal(checkpoint.values.get('active-claim').consumerStopped, true);
  }
});

test('newly saved partial work cannot authorize a successor after Host cancellation', async () => {
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
  assert.equal(successor, undefined);
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
  failed.stages.jobAid.requestId = `auto-resume-2-${'b'.repeat(32)}`;
  failed.stages.jobAid.attemptRef = 'AQ-SECOND-FAILED';
  const exhausted = await consumeAutomaticWorkItemQueueTick({}, {
    ...dependencies,
    consumeWorkItem: async () => assert.fail('second successor is the final attempt'),
  });
  assert.equal(exhausted.status, 'REQUIRES_ATTENTION');
});

for (const legacyRequestId of [undefined, 'original-1']) test(`legacy failed preparation receives a stable retry (${legacyRequestId ?? 'absent request'})`, async () => {
  const checkpoint = memoryCheckpoint(storedClaim());
  const failed = status({
    overallStatus: 'FAILED', nextOperation: null,
    translation: 'PENDING', applicability: 'WAITING_INPUT',
    jobAid: 'SUCCEEDED', overall: 'FAILED',
  });
  failed.stages.overall = {
    status: 'FAILED', attemptStatus: 'FAILED',
    attemptRef: 'AQ-PREP-FAILED', ...(legacyRequestId ? { requestId: legacyRequestId } : {}),
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

const PREPARATION_REQUEST = '00000000-0000-4000-8000-000000000059';
async function initialPreparationFixture(t, operation = 'EVALUATE_JOBAID', consumerStopped = false) {
  const directory = await mkdtemp(join(tmpdir(), 'queue-initial-preparation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { checkpointRoot: directory };
  const claim = { ...storedClaim(), consumerStopped,
    attentionCode: consumerStopped ? 'REVIEW_BEGIN_DYNAMIC_EVALUATION_1_OUTCOME_UNKNOWN' : null };
  const checkpoint = await createCheckpointStore(join(directory, 'queue'));
  checkpoint.withActiveClaimOwner = perform => perform();
  await checkpoint.write('active-claim', claim);
  const stage = operation === 'EVALUATE_JOBAID' ? 'jobAid' : 'overall';
  const begin = operation === 'EVALUATE_JOBAID' ? 'begin_dynamic_evaluation' : 'begin_overall_synthesis';
  const failed = { ...status({ overallStatus: 'FAILED', nextOperation: null, translation: 'SUCCEEDED',
    applicability: 'WAITING_INPUT', jobAid: operation === 'EVALUATE_JOBAID' ? 'FAILED' : 'SUCCEEDED',
    overall: operation === 'SYNTHESIZE_OVERALL' ? 'FAILED' : 'PENDING' }),
    candidateOnly: true, workItemId: claim.workItemId, workItemRevision: claim.workItemRevision };
  failed.stages[stage] = { status: 'FAILED', attemptStatus: 'FAILED', requestId: PREPARATION_REQUEST,
    attemptRef: 'AQ-initial-preparation', terminalCode: 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED' };
  const retryId = `auto-retry-${createHash('sha256').update([
    claim.workItemId, claim.documentVersionId, stage, failed.stages[stage].attemptRef,
  ].join(':')).digest('hex').slice(0, 32)}`;
  const paths = [];
  for (const requestId of [PREPARATION_REQUEST, retryId]) {
    const path = initialStageCheckpointPath({ ...options, workItemId: claim.workItemId }, operation, requestId);
    paths.push(path);
    const store = await createCheckpointStore(path);
    await store.writeOnce('binding', { workItemId: claim.workItemId, documentVersionId: claim.documentVersionId, operation, requestId });
    const cached = structuredClone(failed);
    if (requestId === PREPARATION_REQUEST) {
      cached.status = 'REQUIRED'; cached.nextOperation = operation;
      cached.stages[stage] = { ...cached.stages[stage], status: 'PENDING', attemptStatus: 'QUEUED', terminalCode: null };
    }
    await store.remoteStep({ step: 'get_parse_status-1', args: { workItemId: claim.workItemId },
      perform: async () => ({ entry: { workItemId: claim.workItemId }, initialAnalysis: cached }) });
    await assert.rejects(store.remoteStep({ step: `${begin}-1`, args: { workItemId: claim.workItemId,
      ...(operation === 'SYNTHESIZE_OVERALL' ? { providers: [] } : {}), requestId },
      perform: async () => { throw new Error('SIMULATED_INITIAL_PREPARATION_SQL_FAILURE'); } }), /SIMULATED_INITIAL_PREPARATION_SQL_FAILURE/);
    assert.equal(await store.readOptional(`${begin}-1.result`), null);
  }
  // Unrelated historical roots may contain UNKNOWN data. The two exact request
  // namespaces above never authorize reading or repairing these old records.
  const legacy = await createCheckpointStore(initialStageCheckpointPath({ ...options, workItemId: claim.workItemId }, operation));
  await legacy.write('model.started', { unknownLegacyOutcome: true });
  const snapshot = async () => Promise.all(paths.map(async path => Object.fromEntries(
    await Promise.all((await readdir(path)).sort().map(async name => [name, (await readFile(join(path, name))).toString('base64')])))));
  const before = await snapshot();
  const observed = { attemptRef: failed.stages[stage].attemptRef,
    taskType: operation === 'EVALUATE_JOBAID' ? 'OPENCLAW_DYNAMIC_EVALUATION' : 'OPENCLAW_OVERALL_SYNTHESIS',
    status: 'FAILED', terminalReason: 'ACTION_ATTEMPT_INITIAL_PREPARATION_FAILED', recoveryAvailable: false,
    commitStartedAt: null, resultContentHash: null, projectionApplied: false };
  const calls = [], posts = [];
  const receipt = { status: 'BLOCKED', workItemId: claim.workItemId,
    blockedCode: `AUTO_WORK_ITEM_STAGE_${stage.toUpperCase()}_FAILED`, blockedAt: '2026-09-25T00:01:00.000Z' };
  const dependencies = { checkpoint, now: () => new Date(START),
    nextWorkItem: () => assert.fail('reconciliation must not claim another item'),
    acknowledgeWorkItem: () => assert.fail('failed preparation cannot ACK success'),
    consumeWorkItem: () => assert.fail('explicit preparation failure cannot retry BEGIN or invoke a model'),
    readInitialStatus: async () => { calls.push('initial'); return structuredClone(failed); },
    callTool: async (name, args) => {
      calls.push(name);
      assert.equal(name, 'get_action_attempt_status');
      assert.deepEqual(args, { attemptRef: 'AQ-initial-preparation', workItemId: claim.workItemId });
      return structuredClone(observed);
    },
    blockWorkItem: async input => {
      calls.push('BLOCK'); posts.push(input);
      assert.deepEqual(input, { workItemId: claim.workItemId, leaseToken: claim.leaseToken, leaseGeneration: claim.leaseGeneration });
      return { ...receipt, replayed: posts.length > 1 };
    },
  };
  return { options, claim, checkpoint, failed, stage, begin, paths, snapshot, before, observed, calls, posts, dependencies };
}

for (const operation of ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL']) {
  test(`explicit ${operation} preparation failure reconciles two started-without-result namespaces before exact BLOCK`, async t => {
    const f = await initialPreparationFixture(t, operation, operation === 'SYNTHESIZE_OVERALL');
    const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
    assert.equal(result.status, 'BLOCKED_CLAIM_FINALIZED');
    assert.deepEqual(f.calls, ['initial', 'get_action_attempt_status', 'initial', 'BLOCK', 'BLOCK']);
    assert.equal(await f.checkpoint.readOptional('active-claim'), null);
    const archive = await f.checkpoint.readOptional(`blocked-claim-${f.claim.workItemId}-g${f.claim.leaseGeneration}`);
    assert.equal(archive.claim.attentionCode, f.claim.attentionCode);
    assert.equal(archive.claim.consumerStopped, true);
    assert.equal(archive.claim.completionReady, false);
    assert.equal(archive.claim.stoppedStageRequest.requestId, PREPARATION_REQUEST);
    assert.equal(JSON.stringify(result).includes(f.claim.leaseToken), false);
    assert.deepEqual(await f.snapshot(), f.before, 'both original UNKNOWN namespaces remain byte-identical');
  });
}

test('expired unclaimed explicit preparation resumes only the original Host grant and BLOCKs with its renewed fence', async t => {
  const f = await initialPreparationFixture(t);
  const expired = { ...f.claim, leaseExpiresAt: '2026-09-24T23:59:00.000Z' };
  await f.checkpoint.write('active-claim', expired);
  Object.assign(f.claim, { leaseToken: TOKEN_2, leaseGeneration: 2, leaseExpiresAt: '2026-09-25T02:00:00.000Z' });
  f.dependencies.nextWorkItem = async input => {
    f.calls.push('resume');
    assert.deepEqual(input, { resumeWorkItemId: f.claim.workItemId });
    return { status: 'CLAIMED', workItemId: f.claim.workItemId, requestId: f.claim.requestId,
      documentVersionId: f.claim.documentVersionId, workItemRevision: f.claim.workItemRevision,
      leaseToken: f.claim.leaseToken, leaseGeneration: f.claim.leaseGeneration, leaseExpiresAt: f.claim.leaseExpiresAt };
  };
  const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
  assert.equal(result.status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(result.leaseGeneration, 2);
  assert.deepEqual(f.calls, ['resume', 'initial', 'get_action_attempt_status', 'initial', 'BLOCK', 'BLOCK']);
  assert.equal(f.posts.every(post => post.leaseToken !== expired.leaseToken && post.leaseGeneration === 2), true);
  assert.equal(await f.checkpoint.readOptional('active-claim'), null);
  assert.deepEqual(await f.snapshot(), f.before);
});

for (const operation of ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL']) {
  test(`UUID ${operation} non-preparation terminal keeps its existing BLOCK path`, async t => {
    const f = await initialPreparationFixture(t, operation);
    f.failed.stages[f.stage].terminalCode = 'MODEL_FAILURE';
    if (operation === 'SYNTHESIZE_OVERALL') f.failed.stages.jobAid = {
      status: 'SUCCEEDED', requestId: PREPARATION_REQUEST, attemptStatus: 'SUCCEEDED', attemptRef: 'AQ-saved-jobaid' };
    f.dependencies.callTool = () => assert.fail('ordinary terminal cleanup does not use preparation reconciliation');
    const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
    assert.equal(result.status, 'BLOCKED_CLAIM_FINALIZED');
    assert.deepEqual(f.calls, ['initial', 'BLOCK', 'BLOCK']);
    assert.deepEqual(await f.snapshot(), f.before);
  });
}

for (const change of [
  { attemptRef: 'AQ-other' }, { taskType: 'OPENCLAW_OVERALL_SYNTHESIS' }, { status: 'RUNNING' },
  { terminalReason: 'MODEL_FAILURE' }, { recoveryAvailable: true }, { recoveryAvailable: undefined },
  { commitStartedAt: '2026-09-25T00:00:00.000Z' }, { resultContentHash: 'a'.repeat(64) },
  { projectionApplied: true }, { recoveryResult: null },
]) test(`explicit preparation keeps UNKNOWN when Host attempt readback changes ${Object.keys(change)[0]}`, async t => {
  const f = await initialPreparationFixture(t);
  Object.assign(f.observed, change);
  const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(f.posts.length, 0);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), f.claim);
  assert.deepEqual(await f.snapshot(), f.before);
});

for (const kind of ['attempt-read-failure', 'fresh-read-failure', 'work-item', 'source', 'revision', 'request', 'attempt', 'active-stage', 'wrong-terminal']) {
  test(`explicit preparation keeps UNKNOWN on ${kind} before BLOCK`, async t => {
    const f = await initialPreparationFixture(t);
    const original = f.dependencies.readInitialStatus;
    let reads = 0;
    f.dependencies.readInitialStatus = async () => {
      const value = await original();
      if (++reads === 1) return value;
      if (kind === 'fresh-read-failure') throw new Error('SIMULATED_FRESH_STATUS_UNAVAILABLE');
      if (kind === 'work-item') value.workItemId = 'WI-other';
      if (kind === 'source') value.documentVersionId = 'DV-other';
      if (kind === 'revision') value.workItemRevision += 1;
      if (kind === 'request') value.stages.jobAid.requestId = '00000000-0000-4000-8000-000000000060';
      if (kind === 'attempt') value.stages.jobAid.attemptRef = 'AQ-other';
      if (kind === 'active-stage') value.stages.overall = { status: 'BUSY', attemptStatus: 'COMMITTING' };
      if (kind === 'wrong-terminal') value.stages.jobAid.terminalCode = 'MODEL_FAILURE';
      return value;
    };
    if (kind === 'attempt-read-failure') f.dependencies.callTool = async () => { throw new Error('SIMULATED_ATTEMPT_STATUS_UNAVAILABLE'); };
    const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(f.posts.length, 0);
    assert.deepEqual(await f.checkpoint.readOptional('active-claim'), f.claim);
    assert.deepEqual(await f.snapshot(), f.before);
  });
}

for (const name of ['begin_dynamic_evaluation-1.result', 'assessment-current-claim', 'model.started',
  'assessment-round-1.started', 'commit_dynamic_evaluation_candidate-1.started', 'run-result', 'jobaid-run-budget', 'unfinished.tmp']) {
  test(`either precise preparation namespace with ${name} keeps UNKNOWN`, async t => {
    for (const namespace of [0, 1]) {
      const f = await initialPreparationFixture(t);
      await writeFile(join(f.paths[namespace], `${name}.json`), '{}', { mode: 0o600 });
      const before = await f.snapshot();
      const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
      assert.equal(result.status, 'REQUIRES_ATTENTION');
      assert.equal(f.posts.length, 0);
      assert.deepEqual(await f.checkpoint.readOptional('active-claim'), f.claim);
      assert.deepEqual(await f.snapshot(), before);
    }
  });
}

for (const kind of ['corrupt', 'permission', 'directory-permission', 'symlink', 'binding']) {
  test(`unreadable or changed preparation checkpoint (${kind}) stays UNKNOWN without quarantine`, async t => {
    const f = await initialPreparationFixture(t);
    const path = join(f.paths[1], 'binding.json');
    if (kind === 'corrupt') await writeFile(path, '{', { mode: 0o600 });
    if (kind === 'permission') await chmod(path, 0o644);
    if (kind === 'directory-permission') await chmod(f.paths[1], 0o755);
    if (kind === 'symlink') { await rm(path); await symlink(join(f.paths[0], 'binding.json'), path); }
    if (kind === 'binding') await writeFile(path, JSON.stringify({ workItemId: 'WI-other' }), { mode: 0o600 });
    const before = await f.snapshot();
    const result = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(f.posts.length, 0);
    assert.deepEqual(await f.checkpoint.readOptional('active-claim'), f.claim);
    assert.deepEqual(await f.snapshot(), before);
  });
}

test('explicit preparation unknown BLOCK retains its exact intent and replays only the original receipt', async t => {
  const f = await initialPreparationFixture(t);
  const block = f.dependencies.blockWorkItem;
  f.dependencies.blockWorkItem = async input => { await block(input); throw new Error('SIMULATED_BLOCK_RESPONSE_LOST'); };
  const first = await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies);
  assert.equal(first.errorCode, 'AUTO_WORK_ITEM_BLOCK_RECEIPT_UNCERTAIN');
  const intent = await f.checkpoint.readOptional('active-claim');
  assert.equal(intent.attentionCode, f.claim.attentionCode);
  assert.equal(intent.stoppedStageRequest.requestId, PREPARATION_REQUEST);
  f.dependencies.blockWorkItem = block;
  f.dependencies.readInitialStatus = () => assert.fail('BLOCK unknown resumes only its exact durable intent');
  f.dependencies.callTool = () => assert.fail('BLOCK unknown does not query or begin another attempt');
  assert.equal((await consumeAutomaticWorkItemQueueTick(f.options, f.dependencies)).status, 'BLOCKED_CLAIM_FINALIZED');
  assert.deepEqual(await f.snapshot(), f.before);
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


function failedInvocationDependencies(checkpoint, consumeWorkItem, initial = status({
  overallStatus: 'BUSY', nextOperation: null, jobAid: 'BUSY',
})) {
  return {
    checkpoint, now: () => new Date(START),
    nextWorkItem: async () => assert.fail('must retain the existing live queue lease'),
    acknowledgeWorkItem: async () => assert.fail('failed local invocation cannot ACK'),
    blockWorkItem: async () => assert.fail('local invocation failure does not prove Host failure'),
    readInitialStatus: async () => initial,
    consumeWorkItem,
  };
}

function invocationFailures(checkpoint) {
  return [...checkpoint.values].filter(([key]) => key.startsWith('consumer-failure-'));
}

function assertInvocationFailure([key, receipt], claim, attentionCode) {
  assert.match(key, /^consumer-failure-[a-f0-9-]{36}$/u);
  assert.deepEqual(receipt, {
    schemaVersion: 'wiselink.auto_work_item_invocation_failure.v1',
    invocationId: key.slice('consumer-failure-'.length),
    status: 'FAILED_INVOCATION',
    workItemId: claim.workItemId, requestId: claim.requestId,
    documentVersionId: claim.documentVersionId,
    workItemRevision: claim.workItemRevision,
    leaseGeneration: claim.leaseGeneration, leaseExpiresAt: claim.leaseExpiresAt,
    attentionCode,
  });
  assert.equal(JSON.stringify(receipt).includes(claim.leaseToken), false);
  assert.equal(Object.hasOwn(receipt, 'consumerStopped'), false);
}

test('a thrown begin failure records only its independent invocation and rethrows the same error', async () => {
  const original = storedClaim();
  const checkpoint = memoryCheckpoint(original);
  const failure = Object.assign(new Error('Host MCP begin failed'), {
    receivedHostToolError: true, hostToolName: 'begin_dynamic_evaluation',
  });
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(
    checkpoint, async () => { throw failure; })), error => error === failure);
  assert.deepEqual(checkpoint.values.get('active-claim'), original);
  const receipts = invocationFailures(checkpoint);
  assert.equal(receipts.length, 1);
  assertInvocationFailure(receipts[0], original, 'REVIEW_HOST_MCP_TOOL_FAILED:begin_dynamic_evaluation');
  assert.equal(checkpoint.writes.length, 1);
});

test('an unclassified thrown invocation records only a bounded safe code and preserves its original error', async () => {
  const original = storedClaim();
  const checkpoint = memoryCheckpoint(original);
  const failure = new Error('untrusted lowercase prose\nprivate-token-fixture');
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(
    checkpoint, async () => { throw failure; })), error => error === failure);
  assert.deepEqual(checkpoint.values.get('active-claim'), original);
  assertInvocationFailure(invocationFailures(checkpoint)[0], original, 'HOSTED_INITIAL_FAILED');
  assert.equal(JSON.stringify([...checkpoint.values]).includes('private-token-fixture'), false);
});

test('a failure to persist independent evidence retains both failures and never clears the claim', async () => {
  const original = storedClaim();
  const checkpoint = memoryCheckpoint(original);
  const failure = new Error('HOSTED_INITIAL_FAILED');
  const persistenceFailure = new Error('CHECKPOINT_WRITE_FAILED');
  checkpoint.writeOnce = async () => { throw persistenceFailure; };
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(
    checkpoint, async () => { throw failure; })), error =>
    error instanceof AggregateError && error.message === 'AUTO_WORK_ITEM_FAILURE_CHECKPOINT_UNCONFIRMED' &&
    error.errors[0] === failure && error.errors[1] === persistenceFailure);
  assert.deepEqual(checkpoint.values.get('active-claim'), original);
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function realOwnerTest(name, perform) {
  const platformName = process.platform === 'linux' ? name
    : `non-Linux owner rejection contract: ${name}`;
  return test(platformName, { timeout: 15_000 }, perform);
}

async function assertUnsupportedOwnerPlatform(checkpoint, directory, original) {
  if (process.platform === 'linux') return false;
  const before = (await readdir(directory)).sort();
  let calls = 0;
  const unexpected = async () => { calls += 1; assert.fail('unsupported owner cannot enter business callbacks'); };
  const dependencies = Object.fromEntries(Object.entries(failedInvocationDependencies(checkpoint, unexpected))
    .map(([key, value]) => [key, typeof value === 'function' ? unexpected : value]));
  await assert.rejects(checkpoint.withActiveClaimOwner(unexpected), /AUTO_WORK_ITEM_QUEUE_OWNER_LOCK_UNAVAILABLE/u);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, dependencies), /AUTO_WORK_ITEM_QUEUE_OWNER_LOCK_UNAVAILABLE/u);
  assert.equal(calls, 0);
  assert.deepEqual(await checkpoint.readOptional('active-claim'), original);
  assert.deepEqual((await readdir(directory)).sort(), before);
  return true;
}

async function waitForOwnerEntry(entered, operation) {
  let timer;
  try {
    await Promise.race([entered.promise, operation.then(() => {
      throw new Error('TEST_OWNER_ENDED_BEFORE_ENTRY');
    }), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('TEST_OWNER_ENTRY_TIMEOUT')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

for (const replacement of ['new-generation', 'new-work-item', 'cleared']) {
  realOwnerTest(`real checkpoint: late invocation failure preserves a ${replacement} claim`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wiselink-invocation-race-'));
    try {
      const checkpoint = await createCheckpointStore(directory);
      const original = storedClaim();
      await checkpoint.write('active-claim', original);
      if (await assertUnsupportedOwnerPlatform(checkpoint, directory, original)) return;
      const entered = deferred();
      const finish = deferred();
      const failure = new Error('HOSTED_INITIAL_FAILED');
      const invocation = consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(
        checkpoint, async () => { entered.resolve(); await finish.promise; throw failure; }));
      const result = invocation.then(() => assert.fail('failed invocation must reject'), error => error);
      try {
        await waitForOwnerEntry(entered, invocation);
        const next = replacement === 'cleared' ? null : replacement === 'new-generation'
          ? storedClaim(2) : { ...storedClaim(2), workItemId: 'WI-NEW', requestId: 'REQ-NEW', documentVersionId: 'DV-NEW' };
        await checkpoint.write('active-claim', next);
        finish.resolve();
        assert.equal(await result, failure);
        assert.deepEqual(await checkpoint.readOptional('active-claim'), next);
        const names = (await readdir(directory)).filter(name => /^consumer-failure-.*\.json$/u.test(name));
        assert.equal(names.length, 1);
        const key = names[0].slice(0, -5);
        assertInvocationFailure([key, await checkpoint.readOptional(key)], original, 'HOSTED_INITIAL_FAILED');
      } finally { finish.resolve(); await result; }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}

realOwnerTest('real checkpoint: one active invocation rejects a competing same-lease consumer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-invocation-live-race-'));
  try {
    const checkpoint = await createCheckpointStore(directory);
    const original = storedClaim();
    await checkpoint.write('active-claim', original);
    if (await assertUnsupportedOwnerPlatform(checkpoint, directory, original)) return;
    const entered = deferred(), finish = deferred();
    const failure = new Error('HOSTED_INITIAL_FAILED');
    const a = consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(checkpoint,
      async () => { entered.resolve(); await finish.promise; throw failure; }));
    const resultA = a.then(() => assert.fail('A must fail'), error => error);
    try {
      await waitForOwnerEntry(entered, a);
      await assert.rejects(consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(checkpoint,
        async () => assert.fail('competing consumer must not run'))), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
    } finally { finish.resolve(); await resultA; }
    assert.equal(await resultA, failure);
    assert.deepEqual(await checkpoint.readOptional('active-claim'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

realOwnerTest('real checkpoint: separate failed invocations retain independent immutable receipts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-invocation-two-failures-'));
  try {
    const checkpoint = await createCheckpointStore(directory);
    const original = storedClaim();
    await checkpoint.write('active-claim', original);
    if (await assertUnsupportedOwnerPlatform(checkpoint, directory, original)) return;
    const errors = [new Error('HOSTED_INITIAL_FAILED'), new Error('DOCUMENT_PARSE_STEP_FAILED')];
    for (const failure of errors)
      await assert.rejects(consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(checkpoint,
        async () => { throw failure; })), error => error === failure);
    assert.deepEqual(await checkpoint.readOptional('active-claim'), original);
    const names = (await readdir(directory)).filter(name => /^consumer-failure-.*\.json$/u.test(name));
    assert.equal(names.length, 2);
    const codes = [];
    for (const name of names) {
      const key = name.slice(0, -5), receipt = await checkpoint.readOptional(key);
      assertInvocationFailure([key, receipt], original, receipt.attentionCode);
      codes.push(receipt.attentionCode);
      await assert.rejects(checkpoint.writeOnce(key, { ...receipt, attentionCode: 'CHANGED' }),
        /REVIEW_CHECKPOINT_ALREADY_EXISTS/u);
      assert.deepEqual(await checkpoint.readOptional(key), receipt);
    }
    assert.deepEqual(codes.sort(), errors.map(error => error.message).sort());
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an active BUSY invocation is not marked stopped, acknowledged, blocked or cleared', async () => {
  const original = storedClaim();
  const checkpoint = memoryCheckpoint(original);
  const report = await consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(
    checkpoint, async () => ({ status: 'BUSY' })));
  assert.equal(report.status, 'IN_PROGRESS');
  assert.deepEqual(checkpoint.values.get('active-claim'), original);
  assert.deepEqual(checkpoint.writes, []);
});

test('source drift rejected before invocation cannot annotate or clear a different claim', async () => {
  const original = storedClaim();
  const checkpoint = memoryCheckpoint(original);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({}, failedInvocationDependencies(
    checkpoint, async () => assert.fail('foreign source must not execute'),
    { ...status(), documentVersionId: 'DV-FOREIGN' })), /AUTO_WORK_ITEM_STATUS_SOURCE_CHANGED/u);
  assert.deepEqual(checkpoint.values.get('active-claim'), original);
  assert.deepEqual(checkpoint.writes, []);
});

const wikiOptions = { enabled: true, checkpointRoot: '/synthetic/checkpoint', endpointKey: 'synthetic-endpoint',
  runBudget: { timeoutMs: 60000, maxCompletionTokens: 32000, maxModelRequests: 4, reasoningEffort: 'low' } };

const stoppedClaim = {
  schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-ordinary', requestId: 'REQ-ordinary',
  documentVersionId: 'DV-ordinary', workItemRevision: 3,
  leaseToken: '559ce045-666a-4c47-b29d-370fa49857e4', leaseGeneration: 1,
  leaseExpiresAt: '2099-01-01T00:00:00.000Z', completionReady: false, consumerStopped: true,
  attentionCode: 'INITIAL_ASSESSMENT_MODEL_OUTCOME_UNKNOWN', blockReady: null,
};

test('a real stopped-UNKNOWN recovery preserves ordinary checkpoint bytes while the Wiki consumer claims reads and saves', async t => {
  const root = await mkdtemp(join(tmpdir(), 'wiki-stopped-ordinary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const queueRoot = join(root, 'queue');
  const queueStore = await createCheckpointStore(queueRoot);
  let ownerHeld = false;
  const checkpoint = { ...queueStore, withActiveClaimOwner: async perform => {
    assert.equal(ownerHeld, false); ownerHeld = true;
    try { return await perform(); } finally { ownerHeld = false; }
  } };
  await checkpoint.write('active-claim', stoppedClaim);
  const stageRoot = initialStageCheckpointPath({ checkpointRoot: root, workItemId: stoppedClaim.workItemId },
    'EVALUATE_JOBAID', 'request-ordinary');
  const stage = await createCheckpointStore(stageRoot);
  await stage.write('binding', { workItemId: stoppedClaim.workItemId, documentVersionId: stoppedClaim.documentVersionId,
    operation: 'EVALUATE_JOBAID', requestId: 'request-ordinary' });
  await stage.write('assessment-enabled', {});
  await stage.write('assessment-state', { round: 1 });
  await stage.write('assessment-current-claim', { status: 'RUNNING', attemptRef: 'AQ-ordinary-unknown',
    leaseGeneration: 1, leaseExpiresAt: '2000-01-01T00:00:00.000Z', task: {
      workItemId: stoppedClaim.workItemId, documentVersionId: stoppedClaim.documentVersionId,
      deadline: '2099-01-01T00:00:00.000Z' } });
  await stage.write('assessment-round-1.started', { retainedUnknownIntent: true });
  const ordinaryFiles = await readdir(stageRoot);
  const before = await Promise.all([readFile(join(queueRoot, 'active-claim.json')),
    ...ordinaryFiles.map(name => readFile(join(stageRoot, name)))]);
  const sealed = JSON.parse(await readFile(new URL('./fixtures/derived-summary-r1-sealed.json', import.meta.url), 'utf8'));
  const task = JSON.parse(sealed.groups[0].variants[0].taskEnvelopeJson);
  const target = { summaryId: task.subject.summaryId, attemptRef: task.operationRef };
  const calls = [];
  let saved = null;
  let invocations = 0;
  const callTool = async (name, input) => {
    assert.equal(ownerHeld, true, 'all Wiki work stays inside the ordinary queue owner');
    assert.equal(JSON.stringify(input).includes(stoppedClaim.leaseToken), false);
    if (name === 'next_hierarchical_wiki') {
      calls.push('NEXT_WIKI');
      return { status: 'SUMMARY_PENDING', ...target };
    }
    assert.equal(name, 'derived_summary_attempt');
    assert.equal(input.summaryId, target.summaryId);
    assert.equal(input.attemptRef, target.attemptRef);
    assert.equal(input.workItemId, undefined, 'the Wiki never inherits the stopped ordinary identity');
    calls.push(input.operation);
    switch (input.operation) {
      case 'STATUS': return { ...target, status: 'QUEUED', savedSummaryRefs: [] };
      case 'CLAIM': return { ...target, status: 'RUNNING', task, leaseToken: 'wiki-only-lease', leaseGeneration: 1,
        leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
      case 'READ_SAVED_SUMMARY': return saved;
      case 'READ_MEMBER_WORK': return { members: task.modelInput.members };
      case 'READ_SOURCES': return { evidence: task.modelInput.evidence.filter(item => input.evidenceRefs.includes(item.evidenceRef)) };
      case 'SAVE_SUMMARY': {
        assert.equal(input.leaseToken, 'wiki-only-lease');
        assert.equal(input.requestId, task.requestId);
        assert.equal(input.expectedSummaryRevision, task.expectedSummaryRevision);
        const receipt = { summaryId: target.summaryId, summaryRef: 'SUMR-local-wiki',
          revision: task.expectedSummaryRevision + 1, replay: false };
        const content = JSON.parse(input.contentJson);
        saved = { receipt: { ...receipt, replay: true }, summary: { ...receipt, ...target,
          scope: task.modelInput.scope, requestId: task.requestId, classificationStatus: 'CANDIDATE', candidateOnly: true,
          content, producer: JSON.parse(input.provenanceJson), members: task.modelInput.members,
          coverage: task.modelInput.members.map(member => ({ member: member.member, evidenceRef: member.evidenceRef,
            delivered: true, used: content.body.includes(`[[${member.evidenceRef}]]`), rootRefs: member.rootRefs,
            limitation: member.limitations.join('\n') })) } };
        return receipt;
      }
      case 'FINISH': assert.ok(saved); return { ...target, status: 'SUCCEEDED', savedSummaryRef: saved.receipt.summaryRef };
      default: assert.fail(input.operation);
    }
  };
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: root }, {
    checkpoint,
    nextWorkItem: async () => assert.fail('the stopped ordinary grant cannot be replaced'),
    acknowledgeWorkItem: async () => assert.fail('ordinary UNKNOWN cannot acknowledge'),
    blockWorkItem: async () => assert.fail('ordinary UNKNOWN cannot block'),
    consumeWorkItem: async () => assert.fail('the ordinary model must not repeat'),
    readInitialStatus: async () => ({ status: 'BUSY', nextOperation: null,
      workItemId: stoppedClaim.workItemId, documentVersionId: stoppedClaim.documentVersionId, workItemRevision: 3,
      stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
        jobAid: { status: 'BUSY', attemptStatus: 'RUNNING', attemptRef: 'AQ-ordinary-unknown', requestId: 'request-ordinary' },
        overall: { status: 'PENDING' } } }),
    callTool: async () => assert.fail('the existing UNKNOWN checkpoint already proves no ordinary replay'),
    consumeWikiIdle: () => consumeHierarchicalWikiIdle({ ...wikiOptions, checkpointRoot: root }, {
      checkpoint, callTool,
      createGatewayPreparer: () => () => assert.fail('this offline candidate adapter never opens a provider'),
      invokeModel: async (input, hooks) => {
        invocations++;
        assert.deepEqual(input, task.modelInput);
        assert.deepEqual(hooks.executionModel, task.executionModel);
        assert.deepEqual(hooks.runBudget, wikiOptions.runBudget);
        const refs = task.modelInput.evidence.map(item => item.evidenceRef);
        await hooks.readSources({ action: 'READ_SOURCES', evidenceRefs: refs, purpose: 'Read the exact registered source' });
        return { content: { headline: 'Local selected Wiki candidate', listBrief: 'Exact source only.',
          body: [...task.modelInput.members.map(item => `Selected work [[${item.evidenceRef}]].`),
            ...refs.map(ref => `Exact source [[${ref}]].`)].join('\n'), limitations: task.modelInput.limitations },
        provenance: { configuredModelRef: task.executionModel.modelRef, actualModel: 'offline-candidate-adapter',
          promptVersion: 'offline-existing-summary-protocol', skillVersion: 'fixture', toolVersions: { host: 'fixture' } } };
      },
    }),
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.errorCode, stoppedClaim.attentionCode);
  assert.equal(result.initialStatus, 'BUSY');
  assert.equal(result.wiki.status, 'WIKI_DISPATCHED');
  assert.equal(result.wiki.result.status, 'DERIVED_SUMMARY_SAVED');
  assert.equal(invocations, 1);
  assert.deepEqual(calls, ['NEXT_WIKI', 'STATUS', 'CLAIM', 'READ_SAVED_SUMMARY', 'READ_MEMBER_WORK',
    'READ_SOURCES', 'SAVE_SUMMARY', 'READ_SAVED_SUMMARY', 'FINISH']);
  assert.equal(await checkpoint.readOptional('active-wiki'), null);
  assert.deepEqual(await readdir(stageRoot), ordinaryFiles);
  assert.deepEqual(await Promise.all([readFile(join(queueRoot, 'active-claim.json')),
    ...ordinaryFiles.map(name => readFile(join(stageRoot, name)))]), before);
});

test('an existing UNKNOWN Wiki resumes beside only the stopped ordinary UNKNOWN and keeps both pointers', async () => {
  const checkpoint = memoryCheckpoint();
  await checkpoint.write('active-claim', structuredClone(stoppedClaim));
  const active = { schemaVersion: 1, kind: 'SUMMARY', summaryId: 'DS-exact', attemptRef: 'AQ-exact', phase: 'PREPARING' };
  await checkpoint.write('active-wiki', active);
  const before = JSON.stringify(await checkpoint.readOptional('active-claim'));
  const dependencies = {
    checkpoint,
    nextWorkItem: () => assert.fail('an existing Wiki cannot take an ordinary grant'),
    acknowledgeWorkItem: () => assert.fail('UNKNOWN ordinary result cannot acknowledge'),
    consumeWorkItem: () => assert.fail('UNKNOWN ordinary model cannot repeat'),
    readInitialStatus: () => assert.fail('existing Wiki owns the endpoint before ordinary recovery'),
    consumeWikiIdle: () => consumeHierarchicalWikiIdle(wikiOptions, {
      checkpoint, createCheckpoint: async () => memoryCheckpoint(),
      callTool: () => assert.fail('no new Wiki admission or cleanup without terminal proof'),
      createGatewayPreparer: () => () => assert.fail('no provider redispatch'),
      consumeSummary: async () => ({ status: 'DERIVED_SUMMARY_SAVED' }),
    }),
  };
  for (let tick = 0; tick < 2; tick++) {
    const result = await consumeAutomaticWorkItemQueueTick({}, dependencies);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.errorCode, stoppedClaim.attentionCode);
    assert.equal(result.wiki.errorCode, 'WIKI_PROVIDER_TERMINAL_UNKNOWN');
    assert.deepEqual(await checkpoint.readOptional('active-wiki'), active);
    assert.equal(JSON.stringify(await checkpoint.readOptional('active-claim')), before);
  }
});
