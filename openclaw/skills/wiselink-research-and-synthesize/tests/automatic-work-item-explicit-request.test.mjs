import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { consumeAutomaticWorkItemQueueTick, consumeHostedWorkItem } from '../scripts/consume-hosted-work-item.mjs';
import { initialStageCheckpointPath } from '../scripts/initial-assessment-recovery.mjs';

const START = Date.parse('2026-10-13T00:20:00.000Z');
const OLD_REQUEST = '00000000-0000-4000-8000-000000000008';
const NEW_REQUEST = '00000000-0000-4000-8000-000000000009';
const LATER_REQUEST = '00000000-0000-4000-8000-000000000010';
const ATTENTION = 'JOBAID_GATEWAY_HTTP_502:TOOL_CHOICE_NOT_SATISFIED';

function claim(overrides = {}) {
  return { schemaVersion: 'wiselink.auto_work_item_claim.v1', workItemId: 'WI-explicit',
    requestId: 'REQ-original-grant', documentVersionId: 'DV-explicit', workItemRevision: 3,
    leaseToken: '00000000-0000-4000-8000-000000000041', leaseGeneration: 42,
    leaseExpiresAt: '2026-10-13T01:16:05.795Z', consumerStopped: true,
    attentionCode: ATTENTION, completionReady: false, blockReady: null, ...overrides };
}

function binding(requestId = OLD_REQUEST, operation = 'EVALUATE_JOBAID') {
  return { workItemId: 'WI-explicit', documentVersionId: 'DV-explicit', workItemRevision: 3,
    operation, requestId, attemptRef: requestId === OLD_REQUEST ? 'AQ-old' : 'AQ-new' };
}

function pending(operation = 'EVALUATE_JOBAID', requestId = NEW_REQUEST) {
  const stage = { TRANSLATE: 'translation', EVALUATE_JOBAID: 'jobAid', SYNTHESIZE_OVERALL: 'overall' }[operation];
  return { workItemId: 'WI-explicit', documentVersionId: 'DV-explicit', workItemRevision: 3,
    candidateOnly: true, status: 'REQUIRED', nextOperation: operation,
    applicabilityContextRef: null,
    stages: { translation: { status: 'PENDING' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: operation === 'SYNTHESIZE_OVERALL' ? 'SUCCEEDED' : 'PENDING' }, overall: { status: 'PENDING' },
      [stage]: { status: 'PENDING', requestId, attemptRef: 'AQ-new', attemptStatus: 'QUEUED', terminalCode: null } } };
}

async function fixture(t, initialClaim = claim()) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'wiselink-explicit-wakeup-'));
  t.after(() => rm(checkpointRoot, { recursive: true, force: true }));
  const values = new Map([['active-claim', structuredClone(initialClaim)]]);
  const writes = [];
  let owned = false;
  const checkpoint = {
    values, writes,
    withActiveClaimOwner: async perform => {
      assert.equal(owned, false); owned = true;
      try { return await perform(); } finally { owned = false; }
    },
    readOptional: async key => structuredClone(values.get(key) ?? null),
    hasEntries: async prefix => [...values.keys()].some(key => key.startsWith(prefix)),
    write: async (key, value) => {
      assert.equal(owned, true);
      writes.push([key, structuredClone(value)]); values.set(key, structuredClone(value));
    },
    writeOnce: async (key, value) => {
      assert.equal(owned, true); assert.equal(values.has(key), false);
      writes.push([key, structuredClone(value)]); values.set(key, structuredClone(value));
    },
  };
  const initial = pending();
  const dependencies = { checkpoint, now: () => new Date(START),
    nextWorkItem: async () => assert.fail('valid original queue lease must be reused'),
    acknowledgeWorkItem: async () => assert.fail('JobAid alone cannot ACK the WorkItem'),
    readInitialStatus: async () => initial,
    consumeWorkItem: async () => assert.fail('a rejected wakeup cannot run') };
  return { checkpointRoot, checkpoint, initial, dependencies,
    path: (requestId = NEW_REQUEST, operation = 'EVALUATE_JOBAID') => initialStageCheckpointPath(
      { checkpointRoot, workItemId: 'WI-explicit' }, operation, requestId) };
}

test('a legacy stopped claim consumes only the fresh Host request and preserves old unknown checkpoints', async t => {
  const f = await fixture(t);
  const oldPath = f.path(OLD_REQUEST);
  await mkdir(oldPath, { recursive: true });
  const unknown = '{"outcome":"UNKNOWN","oldProvider":"unresolved"}\n';
  const failure = '{"status":"REQUIRES_ATTENTION","attemptRef":"AQ-old"}\n';
  await writeFile(join(oldPath, 'model.started.json'), unknown);
  await writeFile(join(oldPath, 'run-result.json'), failure);
  let saved = false;
  let begins = 0;
  let modelCalls = 0;
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies,
    consumeWorkItem: input => consumeHostedWorkItem(input, {
      callTool: async (name, args) => {
        if (name === 'get_parse_status') return { entry: { workItemId: 'WI-explicit' }, initialAnalysis: saved
          ? { ...f.initial, nextOperation: 'SYNTHESIZE_OVERALL', stages: { ...f.initial.stages,
            jobAid: { ...f.initial.stages.jobAid, status: 'SUCCEEDED', attemptStatus: 'SUCCEEDED' } } }
          : f.initial };
        assert.equal(name, 'begin_dynamic_evaluation');
        assert.deepEqual(args, { requestId: NEW_REQUEST, workItemId: 'WI-explicit' });
        begins += 1;
        return { status: 'RUNNING', attemptRef: 'AQ-new', task: { executionModel: { modelId: 'test-glm' } } };
      },
      runInitial: async run => {
        assert.equal(run.requestId, NEW_REQUEST); assert.equal(run.continuationRequestId, NEW_REQUEST);
        assert.equal(run.operation, 'EVALUATE_JOBAID');
        await run.callTool('begin_dynamic_evaluation', { requestId: run.continuationRequestId });
        await run.evaluateDynamicRules({ scope: 'same-work-item' });
        saved = true;
        f.initial.stages.jobAid.status = 'SUCCEEDED';
        f.initial.stages.jobAid.attemptStatus = 'SUCCEEDED';
        f.initial.nextOperation = 'SYNTHESIZE_OVERALL';
        return { outcome: 'CANDIDATE_READY' };
      },
      invokeInitialModel: async () => { modelCalls += 1; return { candidateOnly: true }; },
    }),
  });
  assert.equal(result.status, 'IN_PROGRESS'); assert.equal(begins, 1); assert.equal(modelCalls, 1);
  assert.equal(f.checkpoint.values.get('active-claim').requestId, 'REQ-original-grant');
  assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, false);
  assert.equal(f.checkpoint.values.get(`explicit-stage-wakeup-${NEW_REQUEST}`).priorAttentionCode, ATTENTION);
  assert.equal(JSON.parse(await readFile(join(f.path(), 'binding.json'), 'utf8')).requestId, NEW_REQUEST);
  assert.equal(JSON.parse(await readFile(join(f.path(), 'run-result.json'), 'utf8')).attemptRef, 'AQ-new');
  assert.equal(await readFile(join(oldPath, 'model.started.json'), 'utf8'), unknown);
  assert.equal(await readFile(join(oldPath, 'run-result.json'), 'utf8'), failure);
});

for (const operation of ['TRANSLATE', 'EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL']) {
  test(`a distinct ${operation} request retains an exact prior stopped-stage binding`, async t => {
    const old = binding();
    const f = await fixture(t, claim({ stoppedStageRequest: old }));
    const initial = pending(operation);
    const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
      ...f.dependencies, readInitialStatus: async () => initial,
      consumeWorkItem: async input => {
        assert.deepEqual(input.explicitStageRequest, binding(NEW_REQUEST, operation));
        assert.equal(input.autoRetry, undefined);
        assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, true,
          'the latch remains stopped until a settled invocation returns');
        const stage = { TRANSLATE: 'translation', EVALUATE_JOBAID: 'jobAid', SYNTHESIZE_OVERALL: 'overall' }[operation];
        initial.status = 'BUSY'; initial.nextOperation = null;
        initial.stages[stage].status = 'BUSY'; initial.stages[stage].attemptStatus = 'RUNNING';
        return { status: 'BUSY', operation, nextOperation: null, candidateOnly: true, modelCallCount: 0 };
      },
    });
    assert.equal(result.status, 'IN_PROGRESS');
    assert.deepEqual(f.checkpoint.values.get('active-claim').stoppedStageRequest, old);
    assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, false);
  });
}

test('an exact newly failed request is stopped once and cannot be woken again', async t => {
  const f = await fixture(t);
  let consumes = 0;
  const deps = { ...f.dependencies, consumeWorkItem: async () => {
    consumes += 1; return { status: 'REQUIRES_ATTENTION', errorCode: ATTENTION };
  } };
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
    'REQUIRES_ATTENTION');
  assert.deepEqual(f.checkpoint.values.get('active-claim').stoppedStageRequest, binding(NEW_REQUEST));
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
    'REQUIRES_ATTENTION');
  assert.equal(consumes, 1);
  f.initial.stages.jobAid.requestId = LATER_REQUEST;
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
    'REQUIRES_ATTENTION');
  assert.equal(consumes, 2, 'only a different explicitly admitted fresh request may continue');
});

const rejectedStatuses = [
  ['same stopped UUID', (f) => f.checkpoint.values.set('active-claim', claim({ stoppedStageRequest: binding(NEW_REQUEST) }))],
  ['unknown request', (f) => { delete f.initial.stages.jobAid.requestId; }],
  ['unknown attempt', (f) => { delete f.initial.stages.jobAid.attemptRef; }],
  ['unknown queued status', (f) => { delete f.initial.stages.jobAid.attemptStatus; }],
  ['terminal code on queued request', (f) => { f.initial.stages.jobAid.terminalCode = 'UNKNOWN_PRIOR_OUTCOME'; }],
  ['unknown terminal state', (f) => { delete f.initial.stages.jobAid.terminalCode; }],
  ['auto retry ID', (f) => { f.initial.stages.jobAid.requestId = `auto-retry-${'a'.repeat(32)}`; }],
  ['auto repair ID', (f) => { f.initial.stages.jobAid.requestId = `auto-repair-${'a'.repeat(32)}`; }],
  ['legacy generated label', (f) => { f.initial.stages.jobAid.requestId = 'original-1'; }],
  ['not a strict read', (f) => { f.initial.candidateOnly = false; }],
  ['changed WorkItem', (f) => { f.initial.workItemId = 'WI-changed'; }],
  ['changed revision', (f) => { f.initial.workItemRevision = 4; }],
  ['other BUSY stage', (f) => { f.initial.stages.overall.status = 'BUSY'; }],
  ['other RUNNING attempt', (f) => { f.initial.stages.overall.attemptStatus = 'RUNNING'; }],
  ['other RETRY_SCHEDULED attempt', (f) => { f.initial.stages.overall.attemptStatus = 'RETRY_SCHEDULED'; }],
  ['other COMMITTING attempt', (f) => { f.initial.stages.overall.attemptStatus = 'COMMITTING'; }],
  ['BUSY initial', (f) => { f.initial.status = 'BUSY'; f.initial.nextOperation = null; }],
  ['already executed attempt', (f) => { f.initial.stages.jobAid.attemptStatus = 'RUNNING'; }],
  ['committing attempt', (f) => { f.initial.stages.jobAid.attemptStatus = 'COMMITTING'; }],
  ['failed applicability prerequisite', (f) => { f.initial.stages.applicability.status = 'FAILED'; }],
  ['pending applicability prerequisite', (f) => { f.initial.stages.applicability.status = 'PENDING'; }],
  ['missing Overall prerequisite', (f) => Object.assign(f.initial, pending('SYNTHESIZE_OVERALL'),
    { stages: { ...pending('SYNTHESIZE_OVERALL').stages, jobAid: { status: 'FAILED' } } })],
  ['authorization failure', (f) => f.checkpoint.values.set('active-claim', claim({ attentionCode: 'SOURCE_REVOKED' }))],
  ['different stopped WI', (f) => f.checkpoint.values.set('active-claim', claim({ stoppedStageRequest: { ...binding(), workItemId: 'WI-changed' } }))],
  ['different stopped DV', (f) => f.checkpoint.values.set('active-claim', claim({ stoppedStageRequest: { ...binding(), documentVersionId: 'DV-changed' } }))],
  ['different stopped revision', (f) => f.checkpoint.values.set('active-claim', claim({ stoppedStageRequest: { ...binding(), workItemRevision: 4 } }))],
  ['legacy stopped revision retained after reclaim', (f) => f.checkpoint.values.set('active-claim', claim({ stoppedWorkItemRevision: 2 }))],
  ['prior BLOCK intent', (f) => f.checkpoint.values.set('active-claim', claim({ blockReady: { stage: 'jobAid', status: 'FAILED' } }))],
  ['prior ACK intent', (f) => f.checkpoint.values.set('active-claim', claim({ completionReady: true }))],
  ['prior wake intent', (f) => f.checkpoint.values.set(`explicit-stage-wakeup-${NEW_REQUEST}`, {})],
  ['unfinished wake intent', (f) => f.checkpoint.values.set(`explicit-stage-wakeup-${NEW_REQUEST}.json.tmp`, null)],
];
for (const [name, change] of rejectedStatuses) {
  test(`an explicit wakeup rejects ${name} without consuming`, async t => {
    const f = await fixture(t); change(f);
    const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, f.dependencies);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, true);
    assert.equal(f.checkpoint.values.get('active-claim').requestId, 'REQ-original-grant');
  });
}

for (const name of ['binding.json', 'begin_dynamic_evaluation-1.started.json',
  'begin_dynamic_evaluation-1.result.json', 'model.started.json', 'model.result.json',
  'assessment-round-1.started.json', 'commit_dynamic_evaluation-1.started.json',
  'save_assessment_work-1.started.json', 'run-result.json', 'binding.json.123.tmp',
  'begin_dynamic_evaluation-1.started.json.123.tmp']) {
  test(`a legacy wakeup rejects existing ${name} without reading or replaying it`, async t => {
    const f = await fixture(t);
    await mkdir(f.path(), { recursive: true });
    await writeFile(join(f.path(), name), 'malformed/unknown private content');
    const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, f.dependencies);
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
    assert.equal(await readFile(join(f.path(), name), 'utf8'), 'malformed/unknown private content');
    assert.equal(f.checkpoint.writes.length, 0);
  });
}

test('a changed document is rejected before attempting to wake the claim', async t => {
  const f = await fixture(t); f.initial.documentVersionId = 'DV-changed';
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, f.dependencies),
    /AUTO_WORK_ITEM_STATUS_SOURCE_CHANGED/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
});

test('a missing or symbolic-link checkpoint root is unknown, never fresh', async t => {
  const f = await fixture(t);
  const link = `${f.checkpointRoot}-link`;
  await symlink(f.checkpointRoot, link);
  t.after(() => rm(link, { force: true }));
  for (const checkpointRoot of [`${f.checkpointRoot}/absent`, link]) {
    await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot }, f.dependencies),
      /AUTO_WORK_ITEM_EXPLICIT_CHECKPOINT_UNAVAILABLE/u);
    assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
  }
});

test('an expired claim cannot wake until normal exact reclaim succeeds', async t => {
  const expired = claim({ leaseExpiresAt: '2026-10-13T00:19:00.000Z', stoppedStageRequest: binding() });
  const f = await fixture(t, expired);
  let reclaims = 0;
  const deps = { ...f.dependencies, nextWorkItem: async args => {
    assert.deepEqual(args, { resumeWorkItemId: 'WI-explicit' }); reclaims += 1;
    return { status: 'IDLE' };
  } };
  const first = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps);
  assert.equal(first.errorCode, 'AUTO_WORK_ITEM_EXPIRED_RECLAIM_UNAVAILABLE');
  assert.deepEqual(f.checkpoint.values.get('active-claim'), expired);
  const { schemaVersion, completionReady, consumerStopped, attentionCode, blockReady, stoppedStageRequest, ...fields } = claim();
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...deps, nextWorkItem: async () => ({ status: 'CLAIMED', ...fields,
      leaseGeneration: 43, leaseToken: '00000000-0000-4000-8000-000000000043' }),
    consumeWorkItem: async () => {
      assert.deepEqual(f.checkpoint.values.get('active-claim').stoppedStageRequest, binding());
      assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, true);
      f.initial.status = 'BUSY'; f.initial.nextOperation = null;
      f.initial.stages.jobAid.status = 'BUSY'; f.initial.stages.jobAid.attemptStatus = 'RUNNING';
      return { status: 'BUSY', operation: 'EVALUATE_JOBAID', nextOperation: null, candidateOnly: true, modelCallCount: 0 };
    },
  });
  assert.equal(reclaims, 1); assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(f.checkpoint.values.get('active-claim').leaseGeneration, 43);
  assert.deepEqual(f.checkpoint.values.get('active-claim').stoppedStageRequest, binding());
});

test('the queue lease is rechecked after the status read before waking', async t => {
  const f = await fixture(t); let expired = false;
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies,
    now: () => new Date(expired ? '2026-10-13T01:17:00.000Z' : START),
    readInitialStatus: async () => { expired = true; return f.initial; },
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION'); assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
});

test('a legacy stopped revision survives a reclaim that changes the current revision', async t => {
  const old = claim({ leaseExpiresAt: '2026-10-13T00:19:00.000Z' });
  const f = await fixture(t, old);
  f.initial.workItemRevision = 4;
  const { schemaVersion, consumerStopped, completionReady, attentionCode, blockReady, ...fields } = claim();
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies, nextWorkItem: async () => ({ status: 'CLAIMED', ...fields,
      workItemRevision: 4, leaseGeneration: 43, leaseToken: '00000000-0000-4000-8000-000000000043' }),
  });
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(f.checkpoint.values.get('active-claim').workItemRevision, 4);
  assert.equal(f.checkpoint.values.get('active-claim').stoppedWorkItemRevision, 3);
  assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, true);
  assert.equal(f.checkpoint.values.get('active-claim').attentionCode, ATTENTION);
});

test('unknown checkpoint evidence never becomes empty history', async t => {
  const f = await fixture(t);
  f.checkpoint.hasEntries = async () => { throw new Error('CHECKPOINT_READ_UNAVAILABLE'); };
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, f.dependencies),
    /CHECKPOINT_READ_UNAVAILABLE/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
});

test('a changed active claim before wakeup is not overwritten or consumed', async t => {
  const f = await fixture(t);
  const other = claim({ workItemId: 'WI-other', requestId: 'REQ-other' });
  f.checkpoint.hasEntries = async () => { f.checkpoint.values.set('active-claim', other); return false; };
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, f.dependencies),
    /AUTO_WORK_ITEM_EXPLICIT_CLAIM_CHANGED/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), other);
  assert.equal(f.checkpoint.writes.length, 0);
});

test('a changed active claim after the invocation is not overwritten with the old stop', async t => {
  const f = await fixture(t);
  const other = claim({ workItemId: 'WI-other', requestId: 'REQ-other' });
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies, consumeWorkItem: async () => {
      f.checkpoint.values.set('active-claim', other);
      return { status: 'REQUIRES_ATTENTION', errorCode: ATTENTION };
    },
  }), /AUTO_WORK_ITEM_EXPLICIT_CLAIM_CHANGED/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), other);
});

test('a failed wake-intent write leaves the stop intact and never invokes the consumer', async t => {
  const f = await fixture(t);
  f.checkpoint.writeOnce = async () => { throw new Error('WAKE_INTENT_WRITE_FAILED'); };
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, f.dependencies),
    /WAKE_INTENT_WRITE_FAILED/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
});

for (const [name, change] of [
  ['request', value => { value.stages.jobAid.requestId = LATER_REQUEST; }],
  ['attempt', value => { value.stages.jobAid.attemptRef = 'AQ-other'; }],
  ['revision', value => { value.workItemRevision = 4; }],
  ['document', value => { value.documentVersionId = 'DV-changed'; }],
  ['prerequisite', value => { value.stages.applicability.status = 'FAILED'; }],
  ['operation', value => { value.nextOperation = 'SYNTHESIZE_OVERALL'; }],
]) {
  test(`the consumer rechecks the exact ${name} before BEGIN and preserves the latch on drift`, async t => {
    const f = await fixture(t);
    const changed = structuredClone(f.initial); change(changed);
    const deps = { ...f.dependencies, consumeWorkItem: input => consumeHostedWorkItem(input, {
      callTool: async name => {
        assert.equal(name, 'get_parse_status');
        return { entry: { workItemId: 'WI-explicit' }, initialAnalysis: changed };
      },
      runInitial: async () => assert.fail('a changed request cannot BEGIN or run a model'),
    }) };
    await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps),
      /AUTO_WORK_ITEM_EXPLICIT_STAGE_CHANGED/u);
    assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
    assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
      'REQUIRES_ATTENTION', 'the durable wake intent blocks a second invocation of this UUID');
  });
}

test('the second WorkItem identity read must still match before any BEGIN', async t => {
  const f = await fixture(t);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies, consumeWorkItem: input => consumeHostedWorkItem(input, {
      callTool: async () => ({ entry: { workItemId: 'WI-other' }, initialAnalysis: f.initial }),
      runInitial: async () => assert.fail('a different WorkItem cannot run'),
    }),
  }), /HOST_INITIAL_STATUS_UNAVAILABLE/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
});

test('an intent appearing during the second status read prevents any BEGIN', async t => {
  const f = await fixture(t);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies, consumeWorkItem: input => consumeHostedWorkItem(input, {
      callTool: async name => {
        assert.equal(name, 'get_parse_status');
        await mkdir(f.path(), { recursive: true });
        await writeFile(join(f.path(), 'begin_dynamic_evaluation-1.started.json.123.tmp'), 'unknown intent');
        return { entry: { workItemId: 'WI-explicit' }, initialAnalysis: f.initial };
      },
      runInitial: async () => assert.fail('the newly appeared intent cannot be replayed'),
    }),
  }), /AUTO_WORK_ITEM_EXPLICIT_CHECKPOINT_CHANGED/u);
  assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
});

for (const hostErrorCode of ['JOBAID_SOURCE_AUTHORIZATION_CHANGED', 'JOBAID_ORIGINAL_REQUEST_CHANGED',
  'ACTION_ATTEMPT_TIMED_OUT']) {
  test(`normal Host BEGIN still blocks ${hostErrorCode} without model execution or deadline refresh`, async t => {
    const f = await fixture(t); let begins = 0;
    const deps = { ...f.dependencies, consumeWorkItem: input => consumeHostedWorkItem(input, {
      callTool: async (name, args) => {
        if (name === 'get_parse_status') return { entry: { workItemId: 'WI-explicit' }, initialAnalysis: f.initial };
        assert.equal(name, 'begin_dynamic_evaluation');
        assert.deepEqual(args, { requestId: NEW_REQUEST, workItemId: 'WI-explicit' });
        begins += 1;
        throw Object.assign(new Error(hostErrorCode), { receivedHostToolError: true,
          hostToolName: name, hostErrorCode });
      },
      runInitial: async run => run.callTool('begin_dynamic_evaluation', { requestId: run.continuationRequestId }),
      invokeInitialModel: async () => assert.fail('a denied BEGIN cannot start a model'),
    }) };
    await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps),
      new RegExp(hostErrorCode, 'u'));
    assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
    assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
      'REQUIRES_ATTENTION');
    assert.equal(begins, 1, 'an expired or denied admitted request is never automatically replayed');
  });
}

for (const [name, report] of [
  ['undefined report', undefined], ['null report', null], ['empty report', {}],
  ['unknown status', { status: 'UNKNOWN' }], ['incomplete BUSY', { status: 'BUSY' }],
  ['unconfirmed BUSY', { status: 'BUSY', operation: 'EVALUATE_JOBAID', nextOperation: null, candidateOnly: true, modelCallCount: 0 }],
  ['incomplete saved report', { status: 'INITIAL_STAGE_SAVED' }],
  ['unconfirmed saved report', { status: 'INITIAL_STAGE_SAVED', operation: 'EVALUATE_JOBAID', stageStatus: 'SUCCEEDED',
    workItemRevision: 3, candidateOnly: true, modelCallCount: 1 }],
]) {
  test(`a new request cannot release the old stop with ${name}`, async t => {
    const f = await fixture(t); let consumes = 0;
    const deps = { ...f.dependencies, consumeWorkItem: async () => { consumes += 1; return report; } };
    const first = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps);
    assert.equal(first.errorCode, 'AUTO_WORK_ITEM_EXPLICIT_REPORT_UNCONFIRMED');
    assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
    assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
      'REQUIRES_ATTENTION');
    assert.equal(consumes, 1);
  });
}

test('a successful exact projection can omit the continuation UUID and advance the WorkItem revision', async t => {
  const f = await fixture(t);
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...f.dependencies, consumeWorkItem: async () => {
      f.initial.workItemRevision = 4;
      f.initial.nextOperation = 'SYNTHESIZE_OVERALL';
      f.initial.stages.jobAid = { status: 'SUCCEEDED', attemptStatus: 'SUCCEEDED', attemptRef: 'AQ-new', terminalCode: null };
      return { status: 'INITIAL_STAGE_SAVED', operation: 'EVALUATE_JOBAID', stageStatus: 'SUCCEEDED',
        candidateOnly: true, modelCallCount: 1, workItemRevision: 4 };
    },
  });
  assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, false);
  assert.equal(f.checkpoint.values.get('active-claim').workItemRevision, 4);
});

test('confirmed R3 success, R4 Overall failure, reclaim and a fresh R4 request retain the real stopped scope', async t => {
  const f = await fixture(t, claim({ consumerStopped: false, attentionCode: null,
    stoppedWorkItemRevision: 3, stoppedStageRequest: binding() }));
  const overallRequest = '00000000-0000-4000-8000-000000000011';
  const freshOverallRequest = '00000000-0000-4000-8000-000000000012';
  const consumed = [];
  let clock = START;
  let phase = 'jobAid';
  const deps = { ...f.dependencies,
    now: () => new Date(clock),
    nextWorkItem: async input => {
      assert.deepEqual(input, { resumeWorkItemId: 'WI-explicit' });
      const { schemaVersion, consumerStopped, attentionCode, completionReady, blockReady, ...fields } = claim();
      return { status: 'CLAIMED', ...fields, workItemRevision: 4, leaseGeneration: 43,
        leaseToken: '00000000-0000-4000-8000-000000000043',
        leaseExpiresAt: '2026-10-13T02:16:05.795Z' };
    },
    consumeWorkItem: async input => {
      consumed.push(phase);
      if (phase === 'jobAid') {
        assert.equal(input.explicitStageRequest, undefined, 'ordinary successful stages also advance the local scope');
        f.initial.workItemRevision = 4; f.initial.nextOperation = 'SYNTHESIZE_OVERALL';
        f.initial.stages.jobAid = { status: 'SUCCEEDED', attemptStatus: 'SUCCEEDED', attemptRef: 'AQ-new', terminalCode: null };
        f.initial.stages.overall = { status: 'PENDING', attemptStatus: 'QUEUED', attemptRef: 'AQ-overall-r4',
          requestId: overallRequest, terminalCode: null };
        return { status: 'INITIAL_STAGE_SAVED', operation: 'EVALUATE_JOBAID', attemptRef: 'AQ-new',
          stageStatus: 'SUCCEEDED', candidateOnly: true, modelCallCount: 1, workItemRevision: 4 };
      }
      if (phase === 'overallFailure') {
        assert.equal(input.explicitStageRequest, undefined);
        assert.equal(f.checkpoint.values.get('active-claim').workItemRevision, 4);
        f.initial.status = 'FAILED'; f.initial.nextOperation = null;
        f.initial.stages.overall.status = 'FAILED'; f.initial.stages.overall.attemptStatus = 'CANCELLED';
        f.initial.stages.overall.terminalCode = ATTENTION;
        return { status: 'REQUIRES_ATTENTION', operation: 'SYNTHESIZE_OVERALL', attemptRef: 'AQ-overall-r4',
          errorCode: ATTENTION, candidateOnly: true, modelCallCount: 1 };
      }
      assert.equal(input.explicitStageRequest.workItemRevision, 4);
      assert.equal(input.explicitStageRequest.requestId, freshOverallRequest);
      assert.equal(input.explicitStageRequest.attemptRef, 'AQ-fresh-overall-r4');
      assert.equal(input.autoRetry, undefined);
      f.initial.status = 'BUSY'; f.initial.nextOperation = null;
      f.initial.stages.overall.status = 'BUSY'; f.initial.stages.overall.attemptStatus = 'RUNNING';
      return { status: 'BUSY', operation: 'SYNTHESIZE_OVERALL', nextOperation: null, candidateOnly: true, modelCallCount: 0 };
    },
  };
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status, 'IN_PROGRESS');
  assert.equal(f.checkpoint.values.get('active-claim').workItemRevision, 4);
  phase = 'overallFailure';
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status, 'REQUIRES_ATTENTION');
  assert.deepEqual(f.checkpoint.values.get('active-claim').stoppedStageRequest, {
    ...binding(overallRequest, 'SYNTHESIZE_OVERALL'), workItemRevision: 4, attemptRef: 'AQ-overall-r4',
  });
  assert.equal(f.checkpoint.values.get('active-claim').stoppedWorkItemRevision, 4);
  phase = 'freshOverall'; clock = Date.parse('2026-10-13T01:20:00.000Z');
  f.initial.status = 'REQUIRED'; f.initial.nextOperation = 'SYNTHESIZE_OVERALL';
  f.initial.stages.overall = { status: 'PENDING', attemptStatus: 'QUEUED', attemptRef: 'AQ-fresh-overall-r4',
    requestId: freshOverallRequest, terminalCode: null };
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status, 'IN_PROGRESS');
  assert.deepEqual(consumed, ['jobAid', 'overallFailure', 'freshOverall']);
  assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, false);
  assert.equal(f.checkpoint.values.get('active-claim').workItemRevision, 4);
  assert.equal(f.checkpoint.values.get('active-claim').stoppedWorkItemRevision, 4);
  assert.equal(f.checkpoint.values.get('active-claim').leaseGeneration, 43);
  assert.equal(f.checkpoint.values.get('active-claim').requestId, 'REQ-original-grant');
});

for (const [name, change] of [
  ['different projected attempt', value => { value.stages.jobAid.attemptRef = 'AQ-other'; }],
  ['different projected UUID', value => { value.stages.jobAid.requestId = LATER_REQUEST; }],
  ['unsucceeded projected attempt', value => { value.stages.jobAid.attemptStatus = 'RUNNING'; }],
]) {
  test(`a saved report with ${name} keeps the stopped claim`, async t => {
    const f = await fixture(t);
    const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
      ...f.dependencies, consumeWorkItem: async () => {
        f.initial.stages.jobAid.status = 'SUCCEEDED'; f.initial.stages.jobAid.attemptStatus = 'SUCCEEDED';
        change(f.initial);
        return { status: 'INITIAL_STAGE_SAVED', operation: 'EVALUATE_JOBAID', stageStatus: 'SUCCEEDED',
          candidateOnly: true, modelCallCount: 1, workItemRevision: 3 };
      },
    });
    assert.equal(result.errorCode, 'AUTO_WORK_ITEM_EXPLICIT_REPORT_UNCONFIRMED');
    assert.deepEqual(f.checkpoint.values.get('active-claim'), claim());
  });
}

test('a newly recorded failure refreshes a stale stopped revision consistently', async t => {
  const f = await fixture(t, claim({ consumerStopped: false, attentionCode: null,
    stoppedWorkItemRevision: 2, stoppedStageRequest: { ...binding(), workItemRevision: 2 } }));
  const deps = { ...f.dependencies, consumeWorkItem: async () => ({ status: 'REQUIRES_ATTENTION', errorCode: ATTENTION }) };
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
    'REQUIRES_ATTENTION');
  const stopped = f.checkpoint.values.get('active-claim');
  assert.equal(stopped.stoppedWorkItemRevision, 3);
  assert.equal(stopped.stoppedStageRequest.workItemRevision, 3);
  assert.equal(stopped.stoppedStageRequest.requestId, NEW_REQUEST);
  assert.equal((await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, deps)).status,
    'REQUIRES_ATTENTION', 'the same newly failed request is still blocked');
  f.initial.stages.jobAid.requestId = LATER_REQUEST;
  let resumed = false;
  const result = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.checkpointRoot }, {
    ...deps, consumeWorkItem: async () => {
      resumed = true;
      f.initial.status = 'BUSY'; f.initial.nextOperation = null;
      f.initial.stages.jobAid.status = 'BUSY'; f.initial.stages.jobAid.attemptStatus = 'RUNNING';
      return { status: 'BUSY', operation: 'EVALUATE_JOBAID', nextOperation: null, candidateOnly: true, modelCallCount: 0 };
    },
  });
  assert.equal(resumed, true); assert.equal(result.status, 'IN_PROGRESS');
  assert.equal(f.checkpoint.values.get('active-claim').consumerStopped, false);
});
