import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalJson, canonicalSha256, sealResultEnvelope, WISELINK_SKILL_VERSION,
  WISELINK_HOST_MCP_NAME, WISELINK_HOST_MCP_VERSION } from '../scripts/validate-payload.mjs';
import { reconcileBoundedReviewSealedStatus } from '../scripts/orchestrate-host-mcp.mjs';
import { sealedReviewPipeline } from './fixtures/sealed-review-recovery.fixture.mjs';
import { reviewOutput, reviewRuntimeFixture, syncReview } from './fixtures/tdms-review-runtime.fixture.mjs';

async function sealed(t, options) {
  const f = await sealedReviewPipeline(t, options);
  const first = await f.run();
  assert.equal(first.status, 'REQUIRES_ATTENTION');
  assert.equal(first.result.ok, false);
  assert.equal(f.state.model, 1); assert.equal(f.state.commits, 1);
  return f;
}
function rehash(result) {
  const { contentHash: _hash, ...unsigned } = result;
  result.contentHash = canonicalSha256(unsigned);
}
function readCalls(f) {
  return f.calls.filter(({ name }) => ['read_source_refs', 'read_review_native_sources'].includes(name)).length;
}

test('fresh checkpoint normal consume directly recovers bounded COMMITTING with distinct before/after status and zero model/READ', async t => {
  for (const commitMode of ['SAVE', 'LOST_AFTER_SAVE', 'ROLLBACK', 'FINISHED_BEFORE_STATUS']) {
    const f = await sealedReviewPipeline(t);
    const original = sealResultEnvelope({ task: f.task, modelOutput: {
      schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c5', mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: f.review.reviewConversationRef, reviewTurnRef: f.review.reviewTurnRef,
      responseType: 'RESYNTHESIS_RESULT', missingInputs: [], candidateEvidenceRefs: [],
      reviewActionDraft: null, affectedItemIds: [], warnings: [],
      runtime: { runtimeAppId: 'app_17c3zn24kv2', profileRef: 'wiselink-engineering' }, ...reviewOutput(),
    }, provenance: { modelVersion: 'synthetic-already-sealed-model', promptVersion: 'synthetic-review',
      skillVersion: WISELINK_SKILL_VERSION, toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION },
      runMetrics: { durationMs: 1, inputUnits: 0, outputUnits: 0 } } });
    f.state.result = structuredClone(original); f.state.status = 'COMMITTING'; f.state.commitMode = commitMode;
    if (commitMode === 'FINISHED_BEFORE_STATUS') f.state.alterBegin = () => {
      // The begin snapshot is COMMITTING; a different authorized request
      // finishes before this trigger's fresh status is read.
      f.state.status = 'SUCCEEDED';
    };
    f.journal.add('native:fresh-1'); // Host journal from the original sealed execution, no READ in this trigger.
    const result = await f.run();
    assert.equal(result.status, commitMode === 'ROLLBACK' ? 'REQUIRES_ATTENTION' : 'CANDIDATE_SAVED');
    assert.equal(result.result.outcome, commitMode === 'SAVE' ? 'COMMITTING_REPLAYED' :
      commitMode === 'ROLLBACK' ? 'COMMITTING_RECOVERY_READ_ONLY' : 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
    assert.equal(f.state.model, 0); assert.equal(readCalls(f), 0);
    assert.equal(f.state.commits, commitMode === 'FINISHED_BEFORE_STATUS' ? 0 : 1);
    assert.deepEqual(f.state.result, original);
    assert.deepEqual(f.calls.map(call => call.name), ['get_pending_review_turn', 'begin_review_turn',
      'get_action_attempt_status', ...(commitMode === 'FINISHED_BEFORE_STATUS' ? [] :
        ['commit_review_turn_candidate', 'get_action_attempt_status'])]);
    const snapshot = await f.snapshot();
    const names = Object.keys(snapshot).filter(name => /^bounded-sealed-recovery-.*-status-(before|after)\.result\.json$/u.test(name));
    assert.equal(names.length, commitMode === 'FINISHED_BEFORE_STATUS' ? 1 : 2);
    if (names.length === 2) assert.notEqual(names[0], names[1]);
    const statuses = names.map(name => JSON.parse(snapshot[name]).value.status).sort();
    assert.deepEqual(statuses, commitMode === 'FINISHED_BEFORE_STATUS' ? ['SUCCEEDED'] :
      commitMode === 'ROLLBACK' ? ['COMMITTING', 'COMMITTING'] : ['COMMITTING', 'SUCCEEDED']);
    if (commitMode !== 'SAVE') assert.equal(Object.hasOwn(result.result, 'jobAidWorkingUpdate'), false);
  }
});

for (const unchanged of [false, true]) test(`sealed bounded actual consume/checkpoint ${unchanged ? 'UNCHANGED' : 'APPLIED'} restores one candidate without model or READ replay`, async t => {
  const f = await sealed(t, { unchanged }), old = await f.snapshot(), before = f.calls.length;
  const originalHash = f.state.result.contentHash;
  f.state.commitMode = 'SAVE';
  const restored = await f.run();
  assert.equal(restored.status, 'CANDIDATE_SAVED'); assert.equal(restored.result.outcome, 'COMMITTING_REPLAYED');
  assert.equal(restored.result.jobAidWorkingUpdate.status, unchanged ? 'UNCHANGED' : 'APPLIED');
  assert.equal(restored.result.jobAidWorkingUpdate.workRevision, unchanged ? 3 : 4);
  assert.equal(restored.result.authorityMutations.staleChanged, !unchanged);
  assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
  assert.equal(f.state.workWrites, 1); assert.equal(f.state.commits, 2);
  assert.equal(f.state.result.contentHash, originalHash);
  assert.deepEqual(f.calls.slice(before).map(call => call.name), ['get_pending_review_turn',
    'begin_review_turn', 'get_action_attempt_status', 'commit_review_turn_candidate', 'get_action_attempt_status']);
  const now = await f.snapshot();
  for (const [name, contents] of Object.entries(old)) assert.equal(now[name], contents, `old ${name} preserved`);
  const freshStatuses = Object.keys(now).filter(name => /^bounded-sealed-recovery-.*-status-(before|after)\.result\.json$/u.test(name));
  assert.equal(freshStatuses.length, 2); assert.notEqual(freshStatuses[0], freshStatuses[1]);
  const last = f.calls.length;
  assert.deepEqual((await f.run()).result, restored.result);
  assert.deepEqual(f.calls.slice(last).map(call => call.name), ['get_pending_review_turn']);
  assert.equal(f.state.workWrites, 1); assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
});

test('sealed bounded lost response gets only fresh status; another normal trigger may finish same COMMITTING checkpoint', async t => {
  const f = await sealed(t), start = f.calls.length;
  const attention = await f.run();
  assert.equal(attention.status, 'REQUIRES_ATTENTION');
  assert.equal(f.state.commits, 2, 'one commit in this trigger, no immediate retry');
  assert.equal(Object.hasOwn(attention.result, 'jobAidWorkingUpdate'), false);
  assert.deepEqual(f.calls.slice(start).map(call => call.name), ['get_pending_review_turn',
    'begin_review_turn', 'get_action_attempt_status', 'commit_review_turn_candidate', 'get_action_attempt_status']);
  f.state.commitMode = 'SAVE';
  assert.equal((await f.run()).status, 'CANDIDATE_SAVED');
  assert.equal(f.state.commits, 3); assert.equal(f.state.workWrites, 1);
  assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
  const names = await readdir(f.checkpointDir);
  assert.equal(names.filter(name => /^bounded-sealed-recovery-.*-commit\.started\.json$/u.test(name)).length, 2);
});

for (const atCommit of [false, true]) test(`sealed bounded status-only SUCCEEDED ${atCommit ? 'after response loss' : 'before replay'} carries no invented receipt/read/stale proof`, async t => {
  const f = await sealed(t), commits = f.state.commits;
  if (atCommit) f.state.commitMode = 'LOST_AFTER_SAVE';
  else f.state.status = 'SUCCEEDED';
  const restored = await f.run();
  assert.equal(restored.status, 'CANDIDATE_SAVED');
  assert.equal(restored.result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(Object.hasOwn(restored.result, 'jobAidWorkingUpdate'), false);
  assert.equal(Object.hasOwn(restored.result.authorityMutations, 'staleChanged'), false);
  assert.equal(f.state.commits, commits + Number(atCommit));
  assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
});

for (const [name, mutate, pattern] of [
  ['hash', value => { value.resultContentHash = 'b'.repeat(64); }, /HASH_MISMATCH/u],
  ['UNKNOWN', value => { value.status = 'UNKNOWN'; }, /RECOVERY_UNAVAILABLE/u],
  ['base', value => { value.recoveryResult.baseRevision += 1; rehash(value.recoveryResult); }, /BASE_REVISION|HASH_MISMATCH/u],
  ['task input', value => { value.recoveryResult.actionAttemptId = 'wrong-attempt'; rehash(value.recoveryResult); }, /BINDING|ATTEMPT/u],
]) test(`sealed bounded fresh before-status rejects ${name} without commit/cancel`, async t => {
  const f = await sealed(t); f.state.alterStatus = mutate;
  await assert.rejects(f.run(), pattern);
  assert.equal(f.state.commits, 1); assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
  assert.equal(f.calls.some(call => call.name === 'cancel_action_attempt'), false);
});

for (const [name, mutate] of [
  ['turn', value => { value.task.modelInput.reviewTurnRef = 'different-turn'; }],
  ['base', value => { value.task.baseRevision += 1; }],
  ['lease generation', value => { value.leaseGeneration += 1; }],
  ['lease owner', value => { value.leaseToken = 'other-owner'; }],
  ['RUNNING', value => { value.status = 'RUNNING'; }],
]) test(`sealed bounded fresh begin rejects ${name} and never cancels`, async t => {
  const f = await sealed(t); f.state.alterBegin = mutate;
  await assert.rejects(f.run(), error => error.sealedReviewRecovery === true);
  assert.equal(f.state.commits, 1); assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
  assert.equal(f.calls.some(call => call.name === 'cancel_action_attempt'), false);
});

test('sealed bounded c234 envelope and changed original commit shape cannot enter replay', async t => {
  const older = await sealed(t);
  older.state.result.skillVersion = older.state.result.skillVersion.replace(/c235$/u, 'c234');
  rehash(older.state.result);
  await assert.rejects(older.run(), /SKILL_VERSION/u);
  assert.equal(older.state.commits, 1);
  const f = await sealed(t), path = join(f.checkpointDir, 'commit.started.json');
  const record = JSON.parse(await readFile(path, 'utf8'));
  // Consumer transport scope must not silently replace the original driver hash.
  record.argsHash = canonicalSha256({ attemptRef: f.task.operationRef, leaseToken: 'synthetic-current-lease',
    leaseGeneration: 2, resultJson: canonicalJson(f.state.result), workItemId: f.task.workItemId });
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(f.run(), /REVIEW_CHECKPOINT_ARGUMENT_MISMATCH:commit/u);
  assert.equal(f.state.commits, 1); assert.equal(f.calls.some(call => call.name === 'cancel_action_attempt'), false);
});

for (const [name, alter] of [
  ['unknown ref', value => { value.assistantCandidate.jobAidWorkingUpdate.readSourceRefs.push('native:unknown'); }],
  ['missing readSourceRefs', value => { delete value.assistantCandidate.jobAidWorkingUpdate.readSourceRefs; }],
  ['used ref unread', value => { value.assistantCandidate.jobAidWorkingUpdate.readSourceRefs = []; }],
  ['duplicate READ', value => { value.assistantCandidate.jobAidWorkingUpdate.readSourceRefs.push('native:fresh-1'); }],
  ['attempt', value => { value.assistantCandidate.actionAttemptRef = 'other'; }],
  ['hash', value => { value.assistantCandidate.provenance.resultContentHash = 'c'.repeat(64); }],
  ['revision', value => { value.assistantCandidate.jobAidWorkingUpdate.workRevision = 3; value.authority.staleMarked = false; }],
  ['old work ref', value => { value.assistantCandidate.jobAidWorkingUpdate.workRevisionRef = 'saved-work-3'; value.authority.staleMarked = false; }],
  ['formal authority', value => { value.authority.reviewActionExecuted = true; }],
  ['current authority', value => { value.authority.currentChanged = true; }],
]) test(`sealed bounded real replay receipt rejects ${name}; subsequent SUCCEEDED cannot launder it`, async t => {
  const f = await sealed(t); f.state.commitMode = 'SAVE'; f.state.alterReceipt = alter;
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID|SOURCE_REF_NOT_READ_THIS_TURN/u);
  assert.equal(f.state.commits, 2); assert.equal(f.state.status, 'SUCCEEDED');
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID|SOURCE_REF_NOT_READ_THIS_TURN/u);
  assert.equal(f.state.commits, 2, 'known invalid receipt cannot become a status-only success');
  assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
});

test('sealed bounded UNCHANGED enforces old ref/revision, no affected keys and no stale permission', async t => {
  const f = await sealed(t, { unchanged: true }), begin = f.begin(), status = f.status();
  for (const alter of [
    value => { value.assistantCandidate.jobAidWorkingUpdate.workRevisionRef = 'new'; },
    value => { value.assistantCandidate.jobAidWorkingUpdate.workRevision = 4; },
    value => { value.assistantCandidate.jobAidWorkingUpdate.affectedIssueKeys = ['changed']; },
    value => { value.authority.staleMarked = true; },
  ]) {
    const receipt = f.receipt(); alter(receipt);
    assert.throws(() => reconcileBoundedReviewSealedStatus(begin, status, receipt), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID/u);
  }
});

test('sealed bounded null receipt stays a known invalid response on a later SUCCEEDED status', async t => {
  const f = await sealed(t); f.state.commitMode = 'SAVE'; f.state.response = null;
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID/u);
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID/u);
  assert.equal(f.state.commits, 2); assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
});

test('sealed bounded real consumer requires a separate valid terminal status after the receipt', async t => {
  const f = await sealed(t); f.state.commitMode = 'SAVE';
  f.state.alterStatus = value => { if (value.status === 'SUCCEEDED') value.projectionApplied = true; };
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_RECOVERY_STATUS_INVALID/u);
  assert.equal(f.state.commits, 2); assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
  assert.equal(f.calls.slice(-1)[0].name, 'get_action_attempt_status');
  f.state.alterStatus = null;
  const reconciled = await f.run();
  assert.equal(reconciled.result.outcome, 'COMMITTING_REPLAYED');
  assert.deepEqual(reconciled.result.jobAidWorkingUpdate, f.state.receipt.assistantCandidate.jobAidWorkingUpdate);
  assert.equal(f.state.commits, 2, 'valid retained receipt plus fresh terminal status does not resubmit');
});

test('sealed bounded validates original canonical candidate rules and terminal Review semantics', async t => {
  const f = await sealed(t);
  for (const [name, mutate] of [
    ['unknown citation', candidate => { candidate.jobAidWorkingDelta.issues[0].body = '[[native:unknown]]'; }],
    ['turn', candidate => { candidate.reviewTurnRef = 'other-turn'; }],
    ['formal action', candidate => { candidate.reviewActionDraft = {}; }],
    ['extra key', candidate => { candidate.authorized = true; }],
    ['runtime profile', candidate => { candidate.runtime.profileRef = 'other'; }],
    ['delta partition', candidate => { candidate.jobAidWorkingDelta.issues.push(structuredClone(candidate.jobAidWorkingDelta.issues[0])); }],
    ['premise basis', candidate => { candidate.jobAidWorkingDelta.issues[0].measures.push({ basisRefs: [] }); }],
    ['closure', candidate => { candidate.jobAidWorkingDelta.roundCompletion = 'COMPLETE';
      candidate.jobAidWorkingDelta.issues[0].openQuestions.push('未解决'); }],
  ]) {
    const begin = f.begin(), candidate = JSON.parse(begin.recoveryResult.modelOutput);
    mutate(candidate); begin.recoveryResult.modelOutput = canonicalJson(candidate); rehash(begin.recoveryResult);
    const status = f.status(); status.recoveryResult = structuredClone(begin.recoveryResult);
    status.resultContentHash = begin.recoveryResult.contentHash;
    assert.throws(() => reconcileBoundedReviewSealedStatus(begin, status), undefined, name);
  }
  for (const mutate of [value => { value.projectionApplied = true; },
    value => { value.terminalReason = 'OTHER'; }, value => { value.resultContentHash = 'd'.repeat(64); }]) {
    f.state.status = 'SUCCEEDED'; const status = f.status(); mutate(status);
    assert.throws(() => reconcileBoundedReviewSealedStatus(f.begin(), status), /RECOVERY_STATUS_INVALID|HASH_MISMATCH/u);
  }
});

test('sealed bounded UNCHANGED requires every exact ALL_PENDING contribution in actual Host readSourceRefs', async t => {
  const review = reviewRuntimeFixture();
  review.requestId = 'dialogue-synthetic-request';
  review.jobAidContext.tdmsReviewContext.requestId = review.requestId;
  const dialogue = { evidenceRef: 'opaque-current-dialogue', kind: 'ENGINEER_STATEMENT',
    origin: 'REVIEW_CONVERSATION', title: '当前用户补充', versionLabel: '贡献修订 2',
    excerpt: '补充未提供执行证明。', reviewConversationId: review.reviewConversationRef,
    reviewTurnId: review.reviewTurnRef, engineerSuppliedInputId: 'ESI-synthetic',
    recordedAt: '2026-10-23T00:00:00Z', dialogueSource: { requestRef: 'synthetic-request',
      contributionRef: 'synthetic-contribution', revision: 2,
      contextWorkItemIds: [review.context.workItem.workItemId] } };
  review.jobAidContext.sourceCatalog.push(dialogue);
  review.jobAidContext.modelInput.availableSources.push({ ref: dialogue.evidenceRef, kind: dialogue.kind,
    title: dialogue.title, versionLabel: dialogue.versionLabel, locator: null });
  syncReview(review);
  const f = await sealed(t, { unchanged: true, review, reads: ['document:page-1', dialogue.evidenceRef] });
  assert.equal(f.journal.has(dialogue.evidenceRef), true);
  f.state.commitMode = 'SAVE';
  f.state.alterReceipt = value => { value.assistantCandidate.jobAidWorkingUpdate.readSourceRefs = ['document:page-1']; };
  await assert.rejects(f.run(), /SOURCE_REF_NOT_READ_THIS_TURN/u);
  assert.equal(f.state.model, 1); assert.equal(readCalls(f), 1);
});

for (const mode of ['NO_ADDON', 'SAVED_EVIDENCE_ONLY'])
  test(`legacy ${mode} keeps existing readonly consume checkpoint without new recovery dispatch`, async t => {
    const review = reviewRuntimeFixture({ saved: mode === 'SAVED_EVIDENCE_ONLY' });
    if (mode === 'NO_ADDON') {
      delete review.jobAidContext.tdmsReviewContext;
      delete review.jobAidContext.modelInput.tdmsReviewContext;
      review.jobAidContext.modelInput.availableSources = review.jobAidContext.modelInput.availableSources.slice(0, 1);
      review.context.problemAssessment = structuredClone(review.jobAidContext.modelInput);
    } else {
      review.jobAidContext.tdmsReviewContext = {
        schemaVersion: 'wiselink.tdms-review-saved-context.v1', mode,
        reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef,
        requestId: review.requestId, inputRevision: review.inputRevision,
        workRevisionRef: 'saved-work-3', workRevision: 3, evidenceRefs: ['native:fresh-1'],
      };
      syncReview(review);
    }
    const f = await sealed(t, { unchanged: true, review }), old = await f.snapshot(), before = f.calls.length;
    f.state.commitMode = 'SAVE';
    assert.equal((await f.run()).status, 'REQUIRES_ATTENTION');
    assert.deepEqual(await f.snapshot(), old);
    assert.deepEqual(f.calls.slice(before).map(call => call.name), ['get_pending_review_turn']);
    assert.equal(f.state.model, 1); assert.equal(f.state.commits, 1); assert.equal(readCalls(f), 1);
  });
