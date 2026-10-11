import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { automaticWorkItemQueueMode, consumeAutomaticWorkItemQueueTick } from '../scripts/consume-hosted-work-item.mjs';

const BLOCKED_AT = '2026-09-25T00:10:00.000Z';
const claim = () => ({ schemaVersion: 'wiselink.auto_work_item_claim.v1',
  workItemId: 'WI-OLD', requestId: 'REQ-OLD', documentVersionId: 'DV-OLD', workItemRevision: 3,
  leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436', leaseGeneration: 3,
  leaseExpiresAt: '2026-09-25T01:00:00.000Z', completionReady: false,
  consumerStopped: true, attentionCode: 'HOSTED_INITIAL_FAILED', blockReady: null });
const options = () => ({ finishBlockedClaim: true, finishWorkItemId: 'WI-OLD',
  finishRequestId: 'REQ-OLD', finishDocumentVersionId: 'DV-OLD', finishLeaseGeneration: 3,
  finishBlockedAt: BLOCKED_AT });
const receipt = () => ({ status: 'BLOCKED', workItemId: 'WI-OLD', replayed: true,
  blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED', blockedAt: BLOCKED_AT });
const archiveKey = 'blocked-claim-WI-OLD-g3';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function ownerTest(name, perform) {
  const platformName = process.platform === 'linux' ? name
    : `non-Linux owner rejection contract: ${name}`;
  return test(platformName, { timeout: 15_000 }, perform);
}
async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}
function waitForOwnerEntry(entered, operation) {
  return bounded(Promise.race([entered.promise, operation.then(() => {
    throw new Error('TEST_OWNER_ENDED_BEFORE_ENTRY');
  })]), 'TEST_OWNER_ENTRY_TIMEOUT');
}
function dependencies(checkpoint, overrides = {}) {
  return { checkpoint, now: () => new Date('2026-09-25T00:30:00.000Z'),
    nextWorkItem: async () => assert.fail('finish must not claim or scan other tasks'),
    acknowledgeWorkItem: async () => assert.fail('BLOCK failure is never a success ACK'),
    consumeWorkItem: async () => assert.fail('finish must not invoke a model'),
    readInitialStatus: async () => assert.fail('not-found status is not proof of BLOCK'),
    blockWorkItem: async input => {
      const expected = claim();
      assert.deepEqual(input, { workItemId: expected.workItemId,
        leaseToken: expected.leaseToken, leaseGeneration: expected.leaseGeneration });
      return receipt();
    }, ...overrides };
}
async function withStore(perform) {
  const directory = await mkdtemp(join(tmpdir(), 'wl-queue-finalization-'));
  try {
    const checkpoint = await createCheckpointStore(directory);
    if (process.platform !== 'linux') {
      const original = claim();
      await checkpoint.write('active-claim', original);
      const before = (await readdir(directory)).sort();
      let calls = 0;
      const unexpected = async () => { calls += 1; assert.fail('unsupported owner cannot enter business callbacks'); };
      const blockedDependencies = Object.fromEntries(Object.entries(dependencies(checkpoint))
        .map(([key, value]) => [key, typeof value === 'function' ? unexpected : value]));
      await assert.rejects(checkpoint.withActiveClaimOwner(unexpected), /AUTO_WORK_ITEM_QUEUE_OWNER_LOCK_UNAVAILABLE/u);
      for (const input of [{}, options()])
        await assert.rejects(consumeAutomaticWorkItemQueueTick(input, blockedDependencies),
          /AUTO_WORK_ITEM_QUEUE_OWNER_LOCK_UNAVAILABLE/u);
      assert.equal(calls, 0);
      assert.deepEqual(await checkpoint.readOptional('active-claim'), original);
      assert.deepEqual((await readdir(directory)).sort(), before);
      return;
    }
    return await perform(checkpoint, directory);
  }
  finally { await rm(directory, { recursive: true, force: true }); }
}

ownerTest('finish archives the exact BLOCK replay and claim before release; next natural tick may claim a new item', async () => withStore(async checkpoint => {
  const old = claim(); await checkpoint.write('active-claim', old);
  const result = await consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint));
  assert.equal(result.status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(result.alreadyFinalized, false);
  assert.equal(JSON.stringify(result).includes(old.leaseToken), false);
  assert.equal(await checkpoint.readOptional('active-claim'), null);
  assert.deepEqual(await checkpoint.readOptional(archiveKey), {
    schemaVersion: 'wiselink.auto_work_item_blocked_claim_archive.v1', claim: old, receipt: receipt() });
  const fresh = { ...old, workItemId: 'WI-NEW', requestId: 'REQ-NEW', documentVersionId: 'DV-NEW',
    consumerStopped: false, attentionCode: null, leaseGeneration: 1 };
  const { schemaVersion, completionReady, consumerStopped, attentionCode, blockReady, ...next } = fresh;
  const run = await consumeAutomaticWorkItemQueueTick({}, dependencies(checkpoint, {
    nextWorkItem: async input => { assert.equal(input, undefined); return { status: 'CLAIMED', ...next }; },
    readInitialStatus: async () => ({ documentVersionId: 'DV-NEW', status: 'BUSY', nextOperation: null }),
    consumeWorkItem: async () => ({ status: 'BUSY' }),
  }));
  assert.equal(run.workItemId, 'WI-NEW');
  assert.deepEqual(await checkpoint.readOptional('active-claim'), fresh);
}));

for (const change of [
  { workItemId: 'WI-OTHER' }, { requestId: 'REQ-OTHER' }, { documentVersionId: 'DV-OTHER' },
  { leaseGeneration: 4 }, { completionReady: true }, { consumerStopped: false },
]) ownerTest(`finish rejects changed exact claim ${Object.keys(change)[0]}`, async () => withStore(async checkpoint => {
  const changed = { ...claim(), ...change }; await checkpoint.write('active-claim', changed);
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint, {
    blockWorkItem: async () => assert.fail('mismatched claim cannot contact Host'),
  })), /AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED/u);
  assert.deepEqual(await checkpoint.readOptional('active-claim'), changed);
  assert.equal(await checkpoint.readOptional(archiveKey), null);
}));

for (const change of [
  { status: 'ACKNOWLEDGED' }, { workItemId: 'WI-OTHER' }, { replayed: false },
  { blockedCode: 'HOSTED_INITIAL_FAILED' }, { blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_BUSY' },
  { blockedAt: '2026-09-25T00:11:00.000Z' }, { unexpected: true },
]) ownerTest(`finish preserves claim for invalid formal receipt ${Object.keys(change)[0]}`, async () => withStore(async checkpoint => {
  const old = claim(); await checkpoint.write('active-claim', old);
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint, {
    blockWorkItem: async () => ({ ...receipt(), ...change }),
  })), /AUTO_WORK_ITEM_BLOCK_RECEIPT_INVALID/u);
  assert.deepEqual(await checkpoint.readOptional('active-claim'), old);
  assert.equal(await checkpoint.readOptional(archiveKey), null);
}));

ownerTest('ambiguous BLOCK transport failure retains claim and does not retry', async () => withStore(async checkpoint => {
  const old = claim(); await checkpoint.write('active-claim', old); let calls = 0;
  const failure = new Error('TRANSPORT_FAILED');
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint, {
    blockWorkItem: async () => { calls += 1; throw failure; },
  })), error => error === failure);
  assert.equal(calls, 1); assert.deepEqual(await checkpoint.readOptional('active-claim'), old);
}));

ownerTest('archive failure preserves the exact claim', async () => withStore(async checkpoint => {
  const old = claim(); await checkpoint.write('active-claim', old);
  checkpoint.writeOnceOrEqual = async () => { throw new Error('ARCHIVE_WRITE_FAILED'); };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /ARCHIVE_WRITE_FAILED/u);
  assert.deepEqual(await checkpoint.readOptional('active-claim'), old);
}));

ownerTest('archive before a failed clear is reusable without overwriting the preserved history', async () => withStore(async (checkpoint, directory) => {
  const old = claim(); await checkpoint.write('active-claim', old);
  const write = checkpoint.write;
  checkpoint.write = async (key, value) => { if (key === 'active-claim' && value === null) throw new Error('CLEAR_FAILED'); return write(key, value); };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /CLEAR_FAILED/u);
  const archivePath = join(directory, `${archiveKey}.json`), before = await readFile(archivePath, 'utf8');
  assert.deepEqual(await checkpoint.readOptional('active-claim'), old);
  checkpoint.write = write;
  assert.equal((await consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint))).status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(await readFile(archivePath, 'utf8'), before);
  assert.equal(await checkpoint.readOptional('active-claim'), null);
}));

for (const replacement of ['new-generation', 'new-work-item', 'cleared'])
  ownerTest(`repeated finish retains ${replacement} state and never replays Host`, async () => withStore(async checkpoint => {
    const old = claim(); await checkpoint.write('active-claim', old);
    await consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint));
    const next = replacement === 'cleared' ? null : replacement === 'new-generation'
      ? { ...old, leaseGeneration: 4 } : { ...old, workItemId: 'WI-NEW', requestId: 'REQ-NEW', documentVersionId: 'DV-NEW' };
    await checkpoint.write('active-claim', next);
    const result = await consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint, {
      blockWorkItem: async () => assert.fail('archived finalization cannot replay or affect a successor'),
    }));
    assert.equal(result.alreadyFinalized, true);
    assert.deepEqual(await checkpoint.readOptional('active-claim'), next);
  }));

ownerTest('missing or tampered archive cannot finalize an empty or successor claim', async () => withStore(async checkpoint => {
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED/u);
  await checkpoint.write(archiveKey, { schemaVersion: 'bad', claim: claim(), receipt: receipt() });
  await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /AUTO_WORK_ITEM_BLOCK_ARCHIVE_INVALID/u);
  assert.equal(await checkpoint.readOptional('active-claim'), null);
}));

ownerTest('held whole-tick owner refuses competing finish before any Host call', async () => withStore(async checkpoint => {
  await checkpoint.write('active-claim', claim()); const entered = deferred(), finish = deferred();
  const a = checkpoint.withActiveClaimOwner(async () => { entered.resolve(); await finish.promise; });
  try {
    await waitForOwnerEntry(entered, a);
    await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
  }
  finally { finish.resolve(); await a; }
  assert.deepEqual(await checkpoint.readOptional('active-claim'), claim());
}));

ownerTest('normal tick holds owner across awaiting Host and prevents null ABA or a competing dispatch', async () => withStore(async checkpoint => {
  const entered = deferred(), finish = deferred();
  const a = consumeAutomaticWorkItemQueueTick({}, dependencies(checkpoint, {
    nextWorkItem: async () => { entered.resolve(); await finish.promise; return { status: 'IDLE' }; },
  }));
  try {
    await waitForOwnerEntry(entered, a);
    await assert.rejects(consumeAutomaticWorkItemQueueTick({}, dependencies(checkpoint)), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
    await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
  } finally { finish.resolve(); await a; }
  assert.equal(await checkpoint.readOptional('active-claim'), null);
}));

for (const phase of ['ACK', 'attention']) ownerTest(`owner covers late ${phase} responses through the final claim write`, async () => withStore(async checkpoint => {
  const old = { ...claim(), consumerStopped: false, attentionCode: null };
  await checkpoint.write('active-claim', old);
  const entered = deferred(), finish = deferred();
  const busy = { documentVersionId: 'DV-OLD', status: 'BUSY', nextOperation: null };
  const complete = { documentVersionId: 'DV-OLD', status: 'SUCCEEDED', nextOperation: null,
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'SUCCEEDED' },
      jobAid: { status: 'SUCCEEDED' }, overall: { status: 'SUCCEEDED' } } };
  const a = consumeAutomaticWorkItemQueueTick({}, dependencies(checkpoint, {
    readInitialStatus: async () => phase === 'ACK' ? complete : busy,
    acknowledgeWorkItem: async () => {
      entered.resolve(); await finish.promise;
      return { status: 'ACKNOWLEDGED', workItemId: 'WI-OLD', replayed: false,
        acknowledgedAt: '2026-09-25T00:30:00.000Z' };
    },
    consumeWorkItem: async () => {
      entered.resolve(); await finish.promise;
      return { status: 'REQUIRES_ATTENTION', errorCode: 'HOSTED_INITIAL_FAILED' };
    },
  }));
  try {
    await waitForOwnerEntry(entered, a);
    await assert.rejects(consumeAutomaticWorkItemQueueTick({}, dependencies(checkpoint)), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
    await assert.rejects(consumeAutomaticWorkItemQueueTick(options(), dependencies(checkpoint)), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
    finish.resolve();
    assert.equal((await a).status, phase === 'ACK' ? 'ACKNOWLEDGED' : 'REQUIRES_ATTENTION');
  } finally { finish.resolve(); await a; }
  assert.deepEqual(await checkpoint.readOptional('active-claim'), phase === 'ACK' ? null
    : { ...old, consumerStopped: true, attentionCode: 'HOSTED_INITIAL_FAILED' });
}));

ownerTest('owner kernel lock retains its inode and releases after throw and process death', async () => withStore(async (checkpoint, directory) => {
  await assert.rejects(checkpoint.withActiveClaimOwner(async () => { throw new Error('LOCAL_FAILED'); }), /LOCAL_FAILED/u);
  const lockPath = join(directory, 'active-claim.owner.lock'), inode = (await stat(lockPath)).ino;
  await checkpoint.withActiveClaimOwner(async () => {});
  assert.equal((await stat(lockPath)).ino, inode);
  const moduleUrl = new URL('../scripts/run-hosted-review-turn.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `const {createCheckpointStore}=await import(${JSON.stringify(moduleUrl)});const c=await createCheckpointStore(${JSON.stringify(directory)});await c.withActiveClaimOwner(async()=>{console.log('OWNER_HELD');setInterval(()=>{},1000);await new Promise(()=>{});});`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const childWaits = new AbortController();
  try {
    const exited = once(child, 'exit', { signal: childWaits.signal }).then(() => {
      throw new Error('TEST_OWNER_CHILD_EXITED_BEFORE_ENTRY');
    });
    const [output] = await bounded(Promise.race([
      once(child.stdout, 'data', { signal: childWaits.signal }), exited,
    ]), 'TEST_OWNER_CHILD_ENTRY_TIMEOUT');
    assert.match(output.toString(), /OWNER_HELD/u);
    await assert.rejects(checkpoint.withActiveClaimOwner(async () => assert.fail('second process cannot acquire')), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u);
    const killed = once(child, 'exit');
    child.kill('SIGKILL'); await bounded(killed, 'TEST_OWNER_CHILD_EXIT_TIMEOUT');
    await checkpoint.withActiveClaimOwner(async () => {});
    assert.equal((await stat(lockPath)).ino, inode);
  } finally {
    childWaits.abort();
    if (child.exitCode === null && child.signalCode === null) {
      const killed = once(child, 'exit');
      child.kill('SIGKILL'); await bounded(killed, 'TEST_OWNER_CHILD_CLEANUP_TIMEOUT');
    }
  }
}));

ownerTest('missing supported flock fails closed before performing any owner operation', async () => withStore(async checkpoint => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent-wiselink-test-only';
  try {
    await assert.rejects(checkpoint.withActiveClaimOwner(async () => assert.fail('unsupported locking cannot dispatch')),
      /AUTO_WORK_ITEM_QUEUE_OWNER_LOCK_UNAVAILABLE/u);
  } finally { process.env.PATH = originalPath; }
  await checkpoint.withActiveClaimOwner(async () => {});
}));

test('finish CLI mode is exact, explicit and rejects unrelated or duplicate controls', () => {
  const flags = ['--auto-queue', '--finish-blocked-claim', '--finish-work-item-id', 'WI-OLD',
    '--finish-request-id', 'REQ-OLD', '--finish-document-version-id', 'DV-OLD',
    '--finish-lease-generation', '3', '--finish-blocked-at', BLOCKED_AT];
  assert.equal(automaticWorkItemQueueMode(flags), true);
  for (const bad of [flags.slice(1), [...flags, '--finish-blocked-claim'], [...flags, '--repair-stopped-claim'],
    [...flags, '--document-translation-recovery', 'new'], flags.map(value => value === '3' ? '0' : value),
    flags.map(value => value === BLOCKED_AT ? 'yesterday' : value), ['--auto-queue', '--finish-work-item-id', 'WI-OLD']])
    assert.throws(() => automaticWorkItemQueueMode(bad), /AUTO_WORK_ITEM_QUEUE_/u);
});
