import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { consumeAutomaticWorkItemQueueTick, automaticWorkItemQueueMode } from '../scripts/consume-hosted-work-item.mjs';
import { parseCancelledClaimExpectation, readCancelledClaimExpectation } from '../scripts/cancelled-claim-parking.mjs';

const WHEN = '2026-10-12T00:00:00.000Z';
const claim = () => ({ schemaVersion: 'wiselink.auto_work_item_claim.v1',
  workItemId: 'WI-test', requestId: 'REQ-parse', documentVersionId: 'DV-test', workItemRevision: 3,
  leaseToken: 'b1686364-7ee9-4ca1-a3aa-0b62794cb436', leaseGeneration: 10,
  leaseExpiresAt: '2026-10-12T01:00:00.000Z', completionReady: false, consumerStopped: true,
  attentionCode: 'JOBAID_GATEWAY_HTTP_502:TOOL_CHOICE_NOT_SATISFIED', blockReady: null });
const expectation = () => ({ workItemId: 'WI-test', leaseGeneration: 10,
  leaseTokenHash: createHash('sha256').update(claim().leaseToken).digest('hex'),
  expectedCancellation: { requestId: 'REQ-parse', workItemRevision: 3,
    documentId: 'DOC-test', documentVersionId: 'DV-test', sourceArtifactId: 'ART-test',
    sourceFileSha256: 'a'.repeat(64), sourceByteLength: 1024,
    attemptId: 'ATT-cancelled', attemptRef: 'AQ-cancelled', attemptNo: 6,
    attemptRequestId: 'REQ-job', actionType: 'OPENCLAW_DYNAMIC_EVALUATION',
    inputRevision: 3, baseRevision: 3, inputHash: 'b'.repeat(64),
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'GLM 5.3',
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: WHEN } } });
const receipt = () => ({ status: 'BLOCKED', workItemId: 'WI-test',
  blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED', blockedAt: WHEN, replayed: true });
const archiveKey = 'blocked-claim-WI-test-g10';

// Explicit synthetic owner seam on macOS; real files/immutable writer are used.
// The unchanged owner suite retains the Linux-only/fail-closed lock contract;
// this macOS run does not claim actual Linux kernel or production execution.
async function fixture(perform) {
  const directory = await mkdtemp(join(tmpdir(), 'wl-cancelled-claim-'));
  try {
    const store = await createCheckpointStore(directory); let held = false; const events = [];
    const checkpoint = { ...store, withActiveClaimOwner: async run => {
      if (held) throw new Error('AUTO_WORK_ITEM_QUEUE_OWNER_BUSY');
      held = true; events.push('owner-acquired');
      try { return await run(); } finally { held = false; events.push('owner-released'); }
    } };
    const path = join(directory, 'expectation.json');
    await writeFile(path, JSON.stringify(expectation()), { mode: 0o600 });
    await checkpoint.write('active-claim', claim());
    const options = { parkCancelledClaim: true, parkExpectationFile: path };
    const finish = { finishBlockedClaim: true, finishCancelledClaim: true,
      finishWorkItemId: 'WI-test', finishRequestId: 'REQ-parse', finishDocumentVersionId: 'DV-test',
      finishLeaseGeneration: 10, finishBlockedAt: WHEN, parkExpectationFile: path };
    const forbidden = async () => assert.fail('PARK/finalize must not start producer, model, ACK, NEXT or stage tools');
    const dependencies = { checkpoint, nextWorkItem: forbidden, acknowledgeWorkItem: forbidden,
      consumeWorkItem: forbidden, readInitialStatus: forbidden, prepareOriginal: forbidden,
      blockWorkItem: async input => {
        assert.equal(held, true); events.push('BLOCK');
        assert.deepEqual(input, { workItemId: 'WI-test', leaseToken: claim().leaseToken, leaseGeneration: 10,
          expectedCancellation: parseCancelledClaimExpectation(expectation()).expectedCancellation,
          ...(input.replayOnly === true ? { replayOnly: true } : {}) });
        return receipt();
      } };
    const prepareFinish = async () => {
      await consumeAutomaticWorkItemQueueTick(options, { ...dependencies,
        blockWorkItem: async input => ({ ...await dependencies.blockWorkItem(input), replayed: false }) });
      events.length = 0;
    };
    await perform({ directory, checkpoint, path, options, finish, dependencies, events, prepareFinish });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('synthetic owner seam: fresh PARK is one POST with zero producer/model and retains exact claim bytes/mtime', async () => fixture(async f => {
  const path = join(f.directory, 'active-claim.json'); const bytes = await readFile(path); const before = await stat(path);
  let calls = 0;
  const result = await consumeAutomaticWorkItemQueueTick(f.options, { ...f.dependencies,
    blockWorkItem: async input => { calls += 1; assert.equal(input.replayOnly, undefined); return { ...receipt(), replayed: false }; } });
  assert.equal(result.status, 'CANCELLED_CLAIM_PARKED'); assert.equal(result.claimRetained, true);
  assert.equal(result.providerTerminal, 'UNKNOWN'); assert.equal(calls, 1);
  assert.equal(JSON.stringify(result).includes(claim().leaseToken), false);
  assert.deepEqual(await readFile(path), bytes); assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

test('synthetic owner seam: strict replay archives original cancellation/claim before null and repeated finalize is immutable', async () => fixture(async f => {
  await f.prepareFinish();
  const write = f.checkpoint.write;
  f.checkpoint.write = async (key, value) => {
    if (key === 'active-claim' && value === null) {
      const archive = await f.checkpoint.readOptional(archiveKey);
      assert.deepEqual(archive.claim, claim()); assert.equal(archive.receipt.replayed, true);
      f.events.push('null-after-archive');
    }
    return write(key, value);
  };
  const result = await consumeAutomaticWorkItemQueueTick(f.finish, f.dependencies);
  assert.equal(result.status, 'BLOCKED_CLAIM_FINALIZED'); assert.equal(result.alreadyFinalized, false);
  assert.equal(await f.checkpoint.readOptional('active-claim'), null);
  const archive = join(f.directory, `${archiveKey}.json`); const bytes = await readFile(archive); const before = await stat(archive);
  assert.deepEqual(f.events, ['owner-acquired', 'BLOCK', 'null-after-archive', 'owner-released']);
  const next = { ...claim(), workItemId: 'WI-new', requestId: 'REQ-new', leaseGeneration: 1 };
  await f.checkpoint.write('active-claim', next);
  const again = await consumeAutomaticWorkItemQueueTick(f.finish, { ...f.dependencies,
    blockWorkItem: async () => assert.fail('archived outcome cannot call Host or change successor') });
  assert.equal(again.alreadyFinalized, true); assert.deepEqual(await f.checkpoint.readOptional('active-claim'), next);
  assert.deepEqual(await readFile(archive), bytes); assert.equal((await stat(archive)).mtimeMs, before.mtimeMs);
}));

for (const change of [{ replayed: false }, { blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED' },
  { blockedCode: 'AUTO_WORK_ITEM_STAGE_OVERALL_CANCELLED' }, { blockedAt: '2026-10-12T00:01:00.000Z' },
  { workItemId: 'WI-new' }, { status: 'ACKNOWLEDGED' }, { extra: true }])
  test(`synthetic owner seam: fresh/conflicting finalization receipt preserves pointer ${JSON.stringify(change)}`, async () => fixture(async f => {
    await f.prepareFinish();
    await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, { ...f.dependencies,
      blockWorkItem: async () => ({ ...receipt(), ...change }) }), /AUTO_WORK_ITEM_BLOCK_RECEIPT_INVALID/u);
    assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
    assert.equal(await f.checkpoint.readOptional(archiveKey), null);
  }));

for (const mode of ['park', 'finish']) test(`synthetic owner seam: unknown ${mode} POST stays one call and preserves stopped checkpoint`, async () => fixture(async f => {
  if (mode === 'finish') await f.prepareFinish();
  let calls = 0; const error = new Error('AUTO_WORK_ITEM_QUEUE_TRANSPORT_FAILED');
  await assert.rejects(consumeAutomaticWorkItemQueueTick(mode === 'park' ? f.options : f.finish, {
    ...f.dependencies, blockWorkItem: async () => { calls += 1; throw error; } }), e => e === error);
  assert.equal(calls, 1); assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

for (const change of [{ workItemRevision: 4 }, { leaseGeneration: 11 }, { consumerStopped: false },
  { completionReady: true }, { requestId: 'REQ-other' }, { documentVersionId: 'DV-other' },
  { leaseToken: 'd6c5e6ef-ac4b-4dc2-9955-57cb338c12ee' }])
  test(`synthetic owner seam: exact stopped claim changed ${JSON.stringify(change)}`, async () => fixture(async f => {
    const changed = { ...claim(), ...change }; await f.checkpoint.write('active-claim', changed);
    const deps = { ...f.dependencies, blockWorkItem: async () => assert.fail('changed claim cannot POST') };
    for (const input of [f.options, f.finish])
      await assert.rejects(consumeAutomaticWorkItemQueueTick(input, deps), /AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED/u);
    assert.deepEqual(await f.checkpoint.readOptional('active-claim'), changed);
  }));

test('synthetic owner seam: a pointer replaced during POST is reread and never cleared or archived', async () => fixture(async f => {
  await f.prepareFinish();
  const next = { ...claim(), leaseGeneration: 11 };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, { ...f.dependencies,
    blockWorkItem: async () => { await f.checkpoint.write('active-claim', next); return receipt(); } }),
  /AUTO_WORK_ITEM_BLOCKED_CLAIM_CHANGED/u);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), next); assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

test('synthetic owner seam: failed archive preserves pointer, and conflicting old archive cannot be overwritten', async () => fixture(async f => {
  await f.prepareFinish();
  const original = f.checkpoint.writeOnceOrEqual;
  f.checkpoint.writeOnceOrEqual = async () => { throw new Error('ARCHIVE_FAILED'); };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, f.dependencies), /ARCHIVE_FAILED/u);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  f.checkpoint.writeOnceOrEqual = original;
  await f.checkpoint.write(archiveKey, { schemaVersion: 'wiselink.auto_work_item_blocked_claim_archive.v1',
    claim: claim(), receipt: { ...receipt(), blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_FAILED' } });
  const before = await readFile(join(f.directory, `${archiveKey}.json`));
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, f.dependencies), /AUTO_WORK_ITEM_BLOCK_ARCHIVE_INVALID/u);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim()); assert.deepEqual(await readFile(join(f.directory, `${archiveKey}.json`)), before);
}));

test('synthetic owner seam: competing PARK/finish cannot enter a held owner or call Host', async () => fixture(async f => {
  let end; const stop = new Promise(resolve => { end = resolve; }); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const a = f.checkpoint.withActiveClaimOwner(async () => { entered(); await stop; }); await started;
  try { for (const input of [f.options, f.finish]) await assert.rejects(
    consumeAutomaticWorkItemQueueTick(input, f.dependencies), /AUTO_WORK_ITEM_QUEUE_OWNER_BUSY/u); }
  finally { end(); await a; }
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
}));

test('private expectation files reject broad permissions, symlinks, excess bytes and unsafe JSON without printing contents', async () => fixture(async f => {
  await chmod(f.path, 0o644); await assert.rejects(readCancelledClaimExpectation(f.path), /EXPECTATION_INVALID/u);
  await chmod(f.path, 0o600); const alias = join(f.directory, 'alias.json'); await symlink(f.path, alias);
  await assert.rejects(readCancelledClaimExpectation(alias), /EXPECTATION_INVALID/u);
  for (const bytes of ['SECRET_SENTINEL malformed', ' '.repeat(8193)]) {
    await writeFile(f.path, bytes); await assert.rejects(readCancelledClaimExpectation(f.path), error => {
      assert.equal(error.message, 'AUTO_WORK_ITEM_CANCELLATION_EXPECTATION_INVALID'); return true;
    });
  }
}));

test('new intent: a changed expectation for a later cancellation cannot replay or replace the first PARK bytes', async () => fixture(async f => {
  await f.prepareFinish();
  const path = join(f.directory, 'cancelled-park-WI-test-g10.json');
  const bytes = await readFile(path); const before = await stat(path);
  const changed = expectation(); changed.expectedCancellation.attemptId = 'ATT-later';
  changed.expectedCancellation.attemptRef = 'AQ-later'; changed.expectedCancellation.attemptNo = 7;
  await writeFile(f.path, JSON.stringify(changed));
  const dependencies = { ...f.dependencies, blockWorkItem: async () => assert.fail('later cancellation cannot POST') };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.options, dependencies), /PARK_ALREADY_STARTED/u);
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, dependencies), /PARK_INTENT_INVALID/u);
  assert.deepEqual(await readFile(path), bytes); assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

test('new intent: unknown POST prevents any repeat PARK', async () => fixture(async f => {
  let calls = 0;
  const dependencies = { ...f.dependencies, blockWorkItem: async () => { calls += 1; throw new Error('UNKNOWN_POST'); } };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.options, dependencies), /UNKNOWN_POST/u);
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.options, dependencies), /PARK_ALREADY_STARTED/u);
  assert.equal(calls, 1); assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

test('new intent: interruption after durable intent but before POST prevents a later dispatch', async () => fixture(async f => {
  const writeIntent = f.checkpoint.writeOnceOrEqual;
  f.checkpoint.writeOnceOrEqual = async (key, value) => {
    await writeIntent(key, value); throw new Error('INTERRUPTED_BEFORE_POST');
  };
  const dependencies = { ...f.dependencies, blockWorkItem: async () => assert.fail('pre-POST interruption cannot dispatch') };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.options, dependencies), /INTERRUPTED_BEFORE_POST/u);
  f.checkpoint.writeOnceOrEqual = writeIntent;
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.options, dependencies), /PARK_ALREADY_STARTED/u);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

test('new intent: missing or changed stored claim intent rejects finalization before Host or archive', async () => fixture(async f => {
  const dependencies = { ...f.dependencies, blockWorkItem: async () => assert.fail('invalid intent cannot POST') };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, dependencies), /PARK_INTENT_INVALID/u);
  await f.prepareFinish(); const intentKey = 'cancelled-park-WI-test-g10';
  const intent = await f.checkpoint.readOptional(intentKey); intent.claim.leaseToken = 'd6c5e6ef-ac4b-4dc2-9955-57cb338c12ee';
  await f.checkpoint.write(intentKey, intent);
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, dependencies), /PARK_INTENT_INVALID/u);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
}));

test('operator CLI modes require exact file/finish fields and cannot mix static subjects, repair or cron recovery', () => {
  const park = ['--auto-queue', '--park-cancelled-claim', '--park-expectation-file', '/private/expectation.json'];
  const finish = ['--auto-queue', '--finish-blocked-claim', '--finish-cancelled-claim', '--park-expectation-file', '/private/expectation.json',
    '--finish-work-item-id', 'WI-test', '--finish-request-id', 'REQ-parse', '--finish-document-version-id', 'DV-test',
    '--finish-lease-generation', '10', '--finish-blocked-at', WHEN];
  assert.equal(automaticWorkItemQueueMode(park), true); assert.equal(automaticWorkItemQueueMode(finish), true);
  for (const args of [park.slice(1), ['--auto-queue', '--park-cancelled-claim'],
    ['--auto-queue', '--finish-cancelled-claim'], [...park, '--finish-blocked-claim'],
    [...park, '--repair-stopped-claim'], [...park, '--document-translation-recovery', 'PRUN-test'],
    [...park, '--work-item-id', 'WI-test'], [...finish, '--park-cancelled-claim']])
    assert.throws(() => automaticWorkItemQueueMode(args), /AUTO_WORK_ITEM_QUEUE_/u);
  assert.equal(automaticWorkItemQueueMode(['--auto-queue']), true);
});
