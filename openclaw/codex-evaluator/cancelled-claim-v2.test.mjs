import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { consumeAutomaticWorkItemQueueTick } from '../skills/wiselink-research-and-synthesize/scripts/consume-hosted-work-item.mjs';
import { parseCancelledClaimExpectation, readCancelledClaimExpectation } from '../skills/wiselink-research-and-synthesize/scripts/cancelled-claim-parking.mjs';

// Reuse the existing cancelled-claim test's synthetic owner/dependency seam.
// No real Host, lease, request, model or Linux owner-lock claim is exercised.
const WHEN = '2026-10-12T00:00:00.000Z';
const MODEL_SCHEMA = 'wiselink.3_1.execution_model_selection.v2';
const MODEL_KEYS = ['modelRef', 'displayName', 'providerKind', 'settingsRevision', 'selectedAt',
  'schemaVersion', 'maxOutputTokens'];
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
      providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: WHEN,
      schemaVersion: MODEL_SCHEMA, maxOutputTokens: 131072 } } });
const receipt = () => ({ status: 'BLOCKED', workItemId: 'WI-test',
  blockedCode: 'AUTO_WORK_ITEM_STAGE_JOBAID_CANCELLED', blockedAt: WHEN, replayed: true });
const archiveKey = 'blocked-claim-WI-test-g10';
const intentKey = 'cancelled-park-WI-test-g10';

async function fixture(t) {
  const retained = process.env.WISELINK_CANCELLED_CLAIM_V2_ARTIFACT_ROOT;
  const parent = retained || tmpdir();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, 'cancel-v2-'));
  if (!retained) t.after(() => rm(directory, { recursive: true, force: true }));
  else t.diagnostic(`synthetic artifacts: ${directory}`);
  const store = await createCheckpointStore(directory); let held = false;
  const checkpoint = { ...store, withActiveClaimOwner: async run => {
    assert.equal(held, false); held = true;
    try { return await run(); } finally { held = false; }
  } };
  const original = expectation(), path = join(directory, 'expectation.json'), calls = [];
  await writeFile(path, JSON.stringify(original), { mode: 0o600 });
  await checkpoint.write('active-claim', claim());
  const options = { parkCancelledClaim: true, parkExpectationFile: path };
  const finish = { finishBlockedClaim: true, finishCancelledClaim: true,
    finishWorkItemId: 'WI-test', finishRequestId: 'REQ-parse', finishDocumentVersionId: 'DV-test',
    finishLeaseGeneration: 10, finishBlockedAt: WHEN, parkExpectationFile: path };
  const forbidden = async () => assert.fail('synthetic PARK/finalize cannot call producer/model/ACK/NEXT');
  const dependencies = { checkpoint, nextWorkItem: forbidden, acknowledgeWorkItem: forbidden,
    consumeWorkItem: forbidden, readInitialStatus: forbidden, prepareOriginal: forbidden,
    blockWorkItem: async input => {
      assert.equal(held, true); calls.push(structuredClone(input));
      // Compare to independent original seven-field bytes, not parser output.
      assert.deepEqual(input.expectedCancellation, original.expectedCancellation);
      assert.deepEqual(Object.keys(input.expectedCancellation.executionModel), MODEL_KEYS);
      assert.deepEqual(input, { workItemId: original.workItemId, leaseToken: claim().leaseToken,
        leaseGeneration: original.leaseGeneration, expectedCancellation: original.expectedCancellation,
        ...(input.replayOnly === true ? { replayOnly: true } : {}) });
      return { ...receipt(), replayed: input.replayOnly === true };
    } };
  const park = () => consumeAutomaticWorkItemQueueTick(options, dependencies);
  const finalize = () => consumeAutomaticWorkItemQueueTick(finish, dependencies);
  return { directory, checkpoint, path, original, calls, options, finish, dependencies, park, finalize };
}

test('v2 cancellation: parser preserves all seven fields and strict legacy and output-budget rules', () => {
  const value = expectation();
  const original = structuredClone(value);
  const parsed = parseCancelledClaimExpectation(value);
  assert.deepEqual(parsed, original);
  assert.deepEqual(Object.keys(parsed.expectedCancellation.executionModel), MODEL_KEYS);
  const reordered = structuredClone(value);
  reordered.expectedCancellation.executionModel = Object.fromEntries(
    Object.entries(value.expectedCancellation.executionModel).reverse());
  assert.equal(JSON.stringify(parseCancelledClaimExpectation(reordered)), JSON.stringify(parsed));
  for (const tokens of [1, 65536, Number.MAX_SAFE_INTEGER]) {
    const candidate = structuredClone(value); candidate.expectedCancellation.executionModel.maxOutputTokens = tokens;
    assert.deepEqual(parseCancelledClaimExpectation(candidate), candidate);
  }
  const legacy = structuredClone(value);
  delete legacy.expectedCancellation.executionModel.schemaVersion;
  delete legacy.expectedCancellation.executionModel.maxOutputTokens;
  assert.deepEqual(parseCancelledClaimExpectation(legacy), legacy);
  for (const change of [model => { delete model.schemaVersion; }, model => { delete model.maxOutputTokens; },
    model => { model.schemaVersion = 'unknown'; }, model => { model.extra = true; },
    model => { model.settingsRevision = -1; }, model => { model.selectedAt = 'invalid'; },
    ...[0, -1, 1.5, '131072', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]
      .map(tokens => model => { model.maxOutputTokens = tokens; })]) {
    const candidate = structuredClone(value); change(candidate.expectedCancellation.executionModel);
    assert.throws(() => parseCancelledClaimExpectation(candidate), /CANCELLATION_EXPECTATION_INVALID/u);
  }
  for (const model of [null, false, 'invalid', []]) {
    const candidate = structuredClone(value); candidate.expectedCancellation.executionModel = model;
    assert.throws(() => parseCancelledClaimExpectation(candidate), /CANCELLATION_EXPECTATION_INVALID/u);
  }
  assert.deepEqual(value, original);
});

test('v2 cancellation: fresh PARK and strict replay archive preserve seven fields and original claim before clear', async t => {
  const f = await fixture(t), pointer = join(f.directory, 'active-claim.json');
  const bytes = await readFile(pointer), before = await stat(pointer);
  assert.deepEqual(await readCancelledClaimExpectation(f.path), f.original);
  const parked = await f.park();
  assert.equal(parked.status, 'CANCELLED_CLAIM_PARKED');
  assert.equal(parked.providerTerminal, 'UNKNOWN'); assert.equal(parked.claimRetained, true);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].replayOnly, undefined);
  assert.deepEqual(await readFile(pointer), bytes); assert.equal((await stat(pointer)).mtimeMs, before.mtimeMs);
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
  assert.deepEqual((await f.checkpoint.readOptional(intentKey)).cancellationExpectation, f.original);
  const write = f.checkpoint.write;
  f.checkpoint.write = async (key, value) => {
    if (key === 'active-claim' && value === null) {
      const archived = await f.checkpoint.readOptional(archiveKey);
      assert.deepEqual(archived.cancellationExpectation, f.original);
      assert.deepEqual(archived.claim, claim()); assert.equal(archived.receipt.replayed, true);
    }
    return write(key, value);
  };
  const finished = await f.finalize();
  assert.equal(finished.status, 'BLOCKED_CLAIM_FINALIZED');
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].replayOnly, true);
  assert.equal(await f.checkpoint.readOptional('active-claim'), null);
  const archive = join(f.directory, `${archiveKey}.json`), archivedBytes = await readFile(archive);
  const archivedStat = await stat(archive);
  const successor = { ...claim(), workItemId: 'WI-successor', requestId: 'REQ-successor', leaseGeneration: 11 };
  await f.checkpoint.write('active-claim', successor);
  assert.equal((await f.finalize()).alreadyFinalized, true);
  assert.equal(f.calls.length, 2); assert.deepEqual(await f.checkpoint.readOptional('active-claim'), successor);
  assert.deepEqual(await readFile(archive), archivedBytes);
  assert.equal((await stat(archive)).mtimeMs, archivedStat.mtimeMs);
});

const changes = [
  ['modelRef', model => { model.modelRef = 'miaoda/synthetic-other'; }],
  ['displayName', model => { model.displayName = 'Changed synthetic name'; }],
  ['providerKind', model => { model.providerKind = 'CUSTOM'; }],
  ['settingsRevision', model => { model.settingsRevision = 2; }],
  ['selectedAt', model => { model.selectedAt = '2026-10-12T00:00:01.000Z'; }],
  ['maxOutputTokens', model => { model.maxOutputTokens = 65536; }],
  ['schemaVersion', model => { model.schemaVersion = 'wiselink.3_1.execution_model_selection.v3'; }],
  ['legacy downgrade', model => { delete model.schemaVersion; delete model.maxOutputTokens; }],
];
for (const [name, change] of changes)
  test(`v2 cancellation: sealed ${name} change rejects before another POST or archive`, async t => {
    const f = await fixture(t); await f.park();
    const paths = [join(f.directory, `${intentKey}.json`), join(f.directory, 'active-claim.json')];
    const original = await Promise.all(paths.map(async path => ({ bytes: await readFile(path), info: await stat(path) })));
    const changed = structuredClone(f.original); change(changed.expectedCancellation.executionModel);
    await writeFile(f.path, JSON.stringify(changed));
    await assert.rejects(f.finalize(), name === 'schemaVersion' ? /CANCELLATION_EXPECTATION_INVALID/u : /PARK_INTENT_INVALID/u);
    await assert.rejects(f.park(), name === 'schemaVersion' ? /CANCELLATION_EXPECTATION_INVALID/u : /PARK_ALREADY_STARTED/u);
    assert.equal(f.calls.length, 1);
    assert.equal(await f.checkpoint.readOptional(archiveKey), null);
    for (let i = 0; i < paths.length; i++) {
      assert.deepEqual(await readFile(paths[i]), original[i].bytes);
      assert.equal((await stat(paths[i])).mtimeMs, original[i].info.mtimeMs);
    }
  });

for (const [name, change] of changes.filter(([name]) => ['maxOutputTokens', 'legacy downgrade'].includes(name)))
  test(`v2 cancellation: archived ${name} change cannot replay or clear a successor`, async t => {
    const f = await fixture(t); await f.park(); await f.finalize();
    const path = join(f.directory, `${archiveKey}.json`), bytes = await readFile(path), info = await stat(path);
    const successor = { ...claim(), workItemId: 'WI-successor', requestId: 'REQ-successor', leaseGeneration: 11 };
    await f.checkpoint.write('active-claim', successor);
    const changed = structuredClone(f.original); change(changed.expectedCancellation.executionModel);
    await writeFile(f.path, JSON.stringify(changed));
    await assert.rejects(f.finalize(), /BLOCK_ARCHIVE_INVALID/u);
    assert.equal(f.calls.length, 2);
    assert.deepEqual(await readFile(path), bytes); assert.equal((await stat(path)).mtimeMs, info.mtimeMs);
    assert.deepEqual(await f.checkpoint.readOptional('active-claim'), successor);
  });

test('v2 cancellation: replayOnly false and UNKNOWN still retain original claim and sealed intent', async t => {
  const f = await fixture(t); await f.park();
  await assert.rejects(consumeAutomaticWorkItemQueueTick(f.finish, { ...f.dependencies,
    blockWorkItem: async input => {
      assert.equal(input.replayOnly, true); assert.deepEqual(input.expectedCancellation, f.original.expectedCancellation);
      return { ...receipt(), replayed: false };
    } }), /BLOCK_RECEIPT_INVALID/u);
  assert.deepEqual(await f.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await f.checkpoint.readOptional(archiveKey), null);
  const unknown = await fixture(t); let calls = 0;
  const dependencies = { ...unknown.dependencies, blockWorkItem: async input => {
    calls++; assert.deepEqual(input.expectedCancellation, unknown.original.expectedCancellation);
    throw new Error('SYNTHETIC_UNKNOWN_POST');
  } };
  await assert.rejects(consumeAutomaticWorkItemQueueTick(unknown.options, dependencies), /SYNTHETIC_UNKNOWN_POST/u);
  await assert.rejects(consumeAutomaticWorkItemQueueTick(unknown.options, dependencies), /PARK_ALREADY_STARTED/u);
  assert.equal(calls, 1); assert.deepEqual(await unknown.checkpoint.readOptional('active-claim'), claim());
  assert.equal(await unknown.checkpoint.readOptional(archiveKey), null);
  assert.deepEqual((await unknown.checkpoint.readOptional(intentKey)).cancellationExpectation, unknown.original);
});
