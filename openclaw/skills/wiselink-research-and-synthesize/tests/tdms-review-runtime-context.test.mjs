import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {validateReviewTask, validateReviewCandidate} from '../scripts/validate-payload.mjs';
import {runInteractiveReviewTurn} from '../scripts/orchestrate-host-mcp.mjs';
import {runHostedReviewTurn, invokeHostedReviewModel, callJsonTool} from '../scripts/run-hosted-review-turn.mjs';
import {consumePendingReviewTurn} from '../scripts/consume-hosted-review-turn.mjs';
import {assertTdmsReviewReadObservation, tdmsReviewDecisionCatalog,
  projectTdmsReviewReadSources} from '../scripts/tdms-review-runtime-context.mjs';
import {freshPacket, plain, reviewEnvelope, reviewOutput, reviewRuntimeFixture, syncReview} from './fixtures/tdms-review-runtime.fixture.mjs';

function fullCandidate(review, output = reviewOutput()) {
  return {schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c5', mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef,
    responseType: 'RESYNTHESIS_RESULT', missingInputs: [], candidateEvidenceRefs: [], reviewActionDraft: null,
    affectedItemIds: [], warnings: [], runtime: {runtimeAppId: 'app_17c3zn24kv2', profileRef: 'wiselink-engineering'}, ...output};
}
function fakeHost(review, {mutatePacket, commitUnknownRef = false, status = 'RUNNING'} = {}) {
  const task = reviewEnvelope(review), context = structuredClone(review.context);
  const calls = [], journal = [];
  const begin = {status, attemptRef: task.operationRef, task, leaseToken: 'synthetic-current-lease',
    leaseGeneration: 2, leaseExpiresAt: '2099-01-01T00:00:00Z', ...(status === 'COMMITTING' ? {recoveryResult: {}} : {})};
  const callTool = async (name, args) => {
    calls.push({name, args: structuredClone(args)});
    if (name === 'begin_review_turn') return begin;
    if (name === 'get_review_turn_context') return {schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
      attemptRef: task.operationRef, reviewConversationRef: review.reviewConversationRef, reviewTurnRef: review.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW', selectedEvaluationItemId: null, inputRevision: review.inputRevision,
      allowedOperations: review.allowedOperations, executionPolicy: review.executionPolicy, context,
      resourceRefs: review.resourceRefs.map(({sourceRefId, resourceArtifactRef, resourceArtifactSha256}) =>
        ({sourceRefId, resourceArtifactRef, resourceArtifactSha256}))};
    if (name === 'heartbeat_action_attempt') return {leaseExpiresAt: '2099-01-01T00:00:00Z'};
    if (name === 'cancel_action_attempt') return {attemptRef: task.operationRef, status: 'CANCELLED'};
    if (name === 'read_source_refs') return {schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
      attemptRef: task.operationRef, sourceRefs: args.sourceRefIds.map(ref => ({
        ...plain(review.jobAidContext.sourceCatalog.find(item => item.evidenceRef === ref)), sourceRefId: ref}))};
    if (name === 'read_review_native_sources') {
      assert.equal(args.attemptRef, task.operationRef); assert.equal(args.workItemId, task.workItemId);
      assert.equal(args.leaseToken, begin.leaseToken); assert.equal(args.leaseGeneration, begin.leaseGeneration);
      assert.equal(args.context, 'EXACT'); assert.ok(args.purpose.trim().length > 0 && args.purpose.length <= 2000);
      const packet = freshPacket(review, args.sourceRefs);
      mutatePacket?.(packet, task);
      journal.push(structuredClone(packet));
      return packet;
    }
    if (name === 'commit_review_turn_candidate') {
      const result = JSON.parse(args.resultJson), output = JSON.parse(result.modelOutput);
      const unchanged = output.jobAidWorkingDelta === null;
      return {schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2', attemptRef: task.operationRef, status: 'SUCCEEDED',
        authority: {candidatePersisted: true, reviewActionExecuted: false, workItemRevisionChanged: false,
          currentChanged: false, staleMarked: !unchanged}, assistantCandidate: {actionAttemptRef: task.operationRef,
          provenance: {resultContentHash: result.contentHash}, jobAidWorkingUpdate: {status: unchanged ? 'UNCHANGED' : 'APPLIED',
            workRevisionRef: unchanged ? 'saved-work-3' : 'saved-work-4', workRevision: unchanged ? 3 : 4,
            affectedIssueKeys: unchanged ? [] : ['bounded-native-review'],
            readSourceRefs: [...new Set(journal.flatMap(packet => packet.sourceRefs)), ...(commitUnknownRef ? ['native:unknown'] : [])]}}};
    }
    assert.fail(`Unexpected synthetic Host operation: ${name}`);
  };
  return {task, context, begin, calls, journal, callTool};
}

async function pipeline(t, {review = reviewRuntimeFixture(), reads = [['native:fresh-1']], output = reviewOutput(),
  mutatePacket, commitUnknownRef, hasTool = () => true, isolated = false} = {}) {
  const host = fakeHost(review, {mutatePacket, commitUnknownRef});
  const original = structuredClone(host.task), originalContext = structuredClone(host.context);
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-review-native-read-'));
  t.after(() => rm(checkpointDir, {recursive: true, force: true}));
  const requests = [], inputs = [];
  const runtime = {gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://synthetic.invalid', gatewayToken: 'synthetic-only',
    configuredModelVersion: 'synthetic-selected-model', registeredModelRefs: ['miaoda/glm-5.3']};
  const requestGateway = async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body);
    const ids = reads[requests.length - 1];
    return Response.json({model: 'synthetic-selected-model', choices: [{finish_reason: 'tool_calls', message: {content: null,
      tool_calls: [{id: `synthetic-${requests.length}`, type: 'function', function: {
        name: ids ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
        arguments: JSON.stringify(ids ? {sourceRefIds: ids} : output)}}]}}]});
  };
  const invokeModel = async (input, hooks) => {
    inputs.push(structuredClone(input));
    return invokeHostedReviewModel(input, {...runtime, ...hooks}, {requestGateway});
  };
  const run = () => runHostedReviewTurn({workItemId: host.task.workItemId,
    reviewConversationRef: review.reviewConversationRef, requestId: review.requestId, checkpointDir,
    ...(isolated ? {isolatedCandidate: true, timeoutMs: 480000, maxModelRequests: 1, maxCompletionTokens: 8192} : {})},
  {callTool: host.callTool, hasTool, invokeModel, modelRuntime: runtime, requestGateway});
  return {...host, run, requests, inputs, checkpointDir, original, originalContext, invokeModel};
}

test('actual two-round driver reads fresh native, protects Gateway view, validates delta and accepts exact commit readback', async t => {
  const f = await pipeline(t);
  const result = await f.run();
  assert.equal(result.ok, true); assert.equal(f.requests.length, 2);
  assert.equal(f.calls.filter(call => call.name === 'read_review_native_sources').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 0);
  const sent = JSON.stringify(f.requests);
  for (const value of [f.task.operationRef, f.task.actionAttemptId, f.task.workItemId, f.begin.leaseToken,
    f.task.modelInput.reviewConversationRef, f.task.modelInput.reviewTurnRef, f.task.modelInput.requestId])
    assert.equal(sent.includes(value), false, value);
  const feedback = JSON.parse(f.requests[1].messages.find(message => message.role === 'tool').content);
  const carrier = feedback.sourceRefs[0];
  assert.equal(carrier.sourceRefId, 'native:fresh-1');
  assert.equal(carrier.excerpt, f.journal[0].evidence[0].excerpt);
  assert.deepEqual(carrier.nativeSource.sourceVersion, f.journal[0].evidence[0].nativeSource.sourceVersion);
  assert.deepEqual(carrier.nativeScope.approval, f.journal[0].evidence[0].nativeScope.approval);
  assert.deepEqual(carrier.nativeReadReceipt, (({taskContextRef: _, ...rest}) => rest)(f.journal[0].evidence[0].nativeReadReceipt));
  assert.equal(Object.hasOwn(carrier.nativeScope.processingSetBinding.scope, 'tenantId'), false);
  const addon = f.inputs[0].input.context.problemAssessment.tdmsReviewContext;
  assert.deepEqual(Object.keys(addon).sort(), ['schemaVersion', 'mode', 'projection'].sort());
  assert.equal(addon.projection.readPerformed, false);
  assert.equal(Object.hasOwn(addon.projection.opinions[0].scope, 'tenantId'), false);
  assert.equal(Object.hasOwn(addon.projection.cohorts[0].scope, 'tenantId'), false);
  assert.deepEqual(f.task, f.original); assert.deepEqual(f.context, f.originalContext);
  assert.equal(f.journal[0].nativeReadReceipts[0].taskContextRef, f.task.operationRef);
  const nativeCheckpoint = JSON.parse(await readFile(join(f.checkpointDir, 'native-sources-1.result.json'), 'utf8'));
  assert.ok(JSON.stringify(nativeCheckpoint).includes(f.task.operationRef), 'private READ checkpoint retains original receipt identity');
  const commit = f.calls.find(call => call.name === 'commit_review_turn_candidate');
  assert.match(JSON.parse(JSON.parse(commit.args.resultJson).modelOutput).jobAidWorkingDelta.issues[0].body, /\[\[native:fresh-1\]\]/u);
});

for (const field of ['title', 'excerpt', 'receiptRef', 'permissionRevision'])
  test(`actual fresh ${field} containing current control value fails before second Gateway request`, async t => {
    const f = await pipeline(t, {mutatePacket(packet, task) {
      const item = packet.evidence[0];
      if (['title', 'excerpt'].includes(field)) item[field] = `Unexpected ${task.operationRef}`;
      else item.nativeReadReceipt[field] = `Unexpected ${task.operationRef}`;
      packet.nativeReadReceipts = packet.evidence.map(value => structuredClone(value.nativeReadReceipt));
    }});
    await assert.rejects(f.run(), /REVIEW_MODEL_CONTROL_PLANE_VALUE_FORBIDDEN/u);
    assert.equal(f.requests.length, 1);
    assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
    assert.equal(f.journal[0].evidence[0].nativeReadReceipt.taskContextRef, f.task.operationRef);
    assert.deepEqual(f.task, f.original);
  });

for (const [name, mutate, error] of [
  ['old task receipt', packet => { packet.evidence[0].nativeReadReceipt.taskContextRef = 'old-task';
    packet.nativeReadReceipts[0].taskContextRef = 'old-task'; }, /READ_BINDING_INVALID/u],
  ['packet receipt mismatch', packet => { packet.nativeReadReceipts[0] = {...packet.nativeReadReceipts[0], receiptRef: 'different'}; }, /READ_RECEIPT_INVALID/u],
  ['wrong source revision', packet => { packet.evidence[0].nativeSource.sourceRevisionRef = 'other'; }, /READ_RECEIPT_INVALID/u],
  ['wrong selected set', packet => { packet.evidence[0].nativeScope.processingSetBinding.setRevisionRef = 'other'; }, /READ_BINDING_INVALID/u],
  ['wrong selected generation', packet => { packet.evidence[0].nativeScope.processingSetBinding.generation++; }, /READ_BINDING_INVALID/u],
  ['wrong exact field selector', packet => { packet.evidence[0].nativeScope.fieldSelectors[0].selector = '#other'; }, /READ_BINDING_INVALID/u],
  ['extra returned source', packet => { packet.sourceRefs.push('native:other'); }, /READ_PACKET_INVALID/u],
  ['PAGE expansion', packet => { packet.scope = 'PAGE'; }, /READ_PACKET_INVALID/u],
  ['wrong own approval', packet => { packet.evidence[0].nativeScope.approval.before.sourceRecordId = 'parent'; }, /READ_APPROVAL_INVALID/u],
  ['unapproved own state', packet => { packet.evidence[0].nativeSource.state.rawCode = 'Estimating'; }, /READ_RECEIPT_INVALID/u],
  ['missing receipt time', packet => { delete packet.evidence[0].nativeReadReceipt.readAt; }, /TDMS_/u],
  ['forbidden key outside exact scope', packet => { packet.evidence[0].nativeSource.tenantId = 'unexpected'; }, /SENSITIVE_FIELD_FORBIDDEN/u],
]) test(`actual fresh READ rejects ${name} before model receives source`, async t => {
  const f = await pipeline(t, {mutatePacket: mutate});
  await assert.rejects(f.run(), error);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
});

test('cached sources and checkpoint replay retain safe display/raw receipt separation; unknown commit ref stays rejected', async t => {
  const f = await pipeline(t, {reads: [['native:fresh-1'], ['native:fresh-1']], commitUnknownRef: true});
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID/u);
  assert.equal(f.requests.length, 3);
  const originalCalls = f.calls.length;
  await assert.rejects(f.run(), /HOST_MCP_REVIEW_COMMIT_RESULT_INVALID/u);
  assert.equal(f.requests.length, 3, 'model is not rerun');
  assert.equal(f.calls.length, originalCalls, 'completed source and commit checkpoints are not resent');
  assert.equal(f.calls.filter(call => call.name === 'read_review_native_sources').length, 1);
  assert.equal(JSON.stringify(f.requests).includes(f.task.operationRef), false);
  const checkpoint = JSON.parse(await readFile(join(f.checkpointDir, 'native-sources-1.result.json'), 'utf8'));
  assert.ok(JSON.stringify(checkpoint).includes(f.task.operationRef));
});

test('UNCHANGED does not require unrelated native directory entries to be read', async t => {
  const f = await pipeline(t, {reads: [['document:page-1']], output: {answer: '原版本判断保持不变。',
    responseType: 'RESYNTHESIS_RESULT', sourceRefs: [], jobAidWorkingDelta: null}});
  assert.equal((await f.run()).ok, true);
  assert.equal(f.calls.some(call => call.name === 'read_review_native_sources'), false);
});

test('new addon requires capability before model; ordinary old c5 needs no new capability; COMMITTING recovery precedes it', async t => {
  const unavailable = await pipeline(t, {hasTool: () => false});
  await assert.rejects(unavailable.run(), /REVIEW_NATIVE_READ_CAPABILITY_UNAVAILABLE/u);
  assert.equal(unavailable.requests.length, 0);
  const old = reviewRuntimeFixture();
  delete old.jobAidContext.tdmsReviewContext; delete old.jobAidContext.modelInput.tdmsReviewContext;
  old.jobAidContext.modelInput.availableSources = old.jobAidContext.modelInput.availableSources.slice(0, 1);
  old.context.problemAssessment = structuredClone(old.jobAidContext.modelInput);
  const ordinary = await pipeline(t, {review: old, hasTool: () => false,
    reads: [['document:page-1']], output: reviewOutput('document:page-1')});
  assert.equal((await ordinary.run()).ok, true);
  const review = reviewRuntimeFixture(), host = fakeHost(review, {status: 'COMMITTING'});
  await assert.rejects(runInteractiveReviewTurn({mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: review.reviewConversationRef, requestId: review.requestId, callTool: host.callTool,
    hasTool() { assert.fail('COMMITTING must not inspect new READ capability'); }, respond() { assert.fail('no model'); }}),
  /HOST_MCP_COMMITTING_RECOVERY_UNAVAILABLE/u);
  assert.deepEqual(host.calls.map(call => call.name), ['begin_review_turn']);
});

test('mixed read request preserves order and rejects entire native 97/unknown batch before any Host READ', async () => {
  for (const [refs, count, error] of [[['native:fresh-2', 'document:page-1', 'native:fresh-1'], 2, null],
    [['document:page-1', 'native:unregistered'], 1, /SOURCE_REF_NOT_ALLOWED/u],
    [[...Array.from({length: 97}, (_, i) => `native:fresh-${i + 1}`), 'document:page-1'], 97, /NATIVE_SOURCE_REQUEST_INVALID/u]]) {
    const review = reviewRuntimeFixture({count}), host = fakeHost(review), stop = new Error('STOP_AFTER_READ');
    await assert.rejects(runInteractiveReviewTurn({mode: 'INTERACTIVE_REVIEW', workItemId: host.task.workItemId,
      reviewConversationRef: review.reviewConversationRef, requestId: review.requestId, callTool: host.callTool, hasTool: () => true,
      respond: async hooks => {
        const values = await hooks.readSourceRefs(refs);
        assert.deepEqual(values.map(item => item.sourceRefId), refs);
        throw stop;
      }}), error ?? (value => value === stop));
    assert.equal(host.calls.filter(call => call.name.startsWith('read_')).length, error ? 0 : 2);
  }
});

test('saved/fresh same body preserves original saved carrier and all original receipts without sealed task mutation', () => {
  const review = reviewRuntimeFixture({saved: true}), before = structuredClone(review);
  validateReviewTask(review);
  const observation = {requestedRefs: ['native:fresh-1'], packet: freshPacket(review, ['native:fresh-1'])};
  const merged = tdmsReviewDecisionCatalog(review, [observation]);
  assert.equal(merged.find(item => item.kind === 'TDMS_NATIVE_RECORD'), review.jobAidContext.sourceCatalog[1]);
  assert.equal(merged[1].nativeReadReceipt.taskContextRef, 'original-historical-task');
  assert.equal(observation.packet.evidence[0].nativeReadReceipt.taskContextRef, 'AQ-native-review-current');
  assert.doesNotThrow(() => validateReviewCandidate(review, fullCandidate(review), [observation]));
  assert.deepEqual(review, before);
  observation.packet.evidence[0].excerpt = 'changed source body';
  assert.throws(() => tdmsReviewDecisionCatalog(review, [observation]), /BODY_CHANGED/u);
});

test('fresh evidence is usable only from fully verified raw observation, never directory or model display copy', () => {
  const review = reviewRuntimeFixture(), candidate = fullCandidate(review);
  validateReviewTask(review);
  assert.throws(() => validateReviewCandidate(review, candidate), /EVIDENCE_NOT_REGISTERED/u);
  const observation = {requestedRefs: ['native:fresh-1'], packet: freshPacket(review, ['native:fresh-1'])};
  assert.doesNotThrow(() => validateReviewCandidate(review, candidate, [observation]));
  const view = projectTdmsReviewReadSources(review, observation);
  const forged = structuredClone(observation); forged.packet.evidence = view;
  assert.throws(() => assertTdmsReviewReadObservation(review, forged), /TDMS_/u);
  candidate.sourceRefs = ['native:fresh-1'];
  assert.throws(() => validateReviewCandidate(review, candidate, [observation]), /SOURCE_REF_NOT_ALLOWED/u);
  candidate.sourceRefs = []; candidate.candidateEvidenceRefs = ['native:fresh-1'];
  assert.throws(() => validateReviewCandidate(review, candidate, [observation]), /EVIDENCE_REF_NOT_ALLOWED/u);
});

for (const [name, mutate] of [
  ['eleventh addon key', review => { review.jobAidContext.tdmsReviewContext.authorized = true; }],
  ['mixed ordinary context', review => { review.jobAidContext.tdmsContext = {}; }],
  ['wrong turn', review => { review.jobAidContext.tdmsReviewContext.reviewTurnRef = 'other'; }],
  ['wrong request', review => { review.jobAidContext.tdmsReviewContext.requestId = 'other'; }],
  ['wrong input revision', review => { review.jobAidContext.tdmsReviewContext.inputRevision++; }],
  ['wrong work revision', review => { review.jobAidContext.tdmsReviewContext.workRevision++; }],
  ['fake saved ref', review => { review.jobAidContext.tdmsReviewContext.savedEvidenceRefs.push('native:fresh-1'); }],
  ['directory-only carrier promoted into delivered', review => { review.jobAidContext.modelInput.deliveredEvidence.push(freshPacket(review, ['native:fresh-1']).evidence[0]); }],
  ['scope tenant drift', review => { review.jobAidContext.tdmsReviewContext.runtimeContext.binding.tenantId = 'other'; }],
  ['unknown scope path', review => { review.jobAidContext.tdmsReviewContext.runtimeContext.projection.opinions[0].newScope = {tenantId: 'other'}; }],
]) test(`strict task rejects ${name}`, () => {
  const review = reviewRuntimeFixture(); mutate(review); syncReview(review);
  assert.throws(() => validateReviewTask(review), /TDMS_|DELIVERED_EVIDENCE_DRIFT/u);
});

test('runtime operationRef must match actual begin envelope before context/model', async t => {
  const review = reviewRuntimeFixture();
  review.jobAidContext.tdmsReviewContext.runtimeContext.binding.taskContextRef = 'invented-before-reserve'; syncReview(review);
  const f = await pipeline(t, {review});
  await assert.rejects(f.run(), /TASK_BINDING_INVALID/u);
  assert.equal(f.requests.length, 0); assert.deepEqual(f.calls.map(call => call.name), ['begin_review_turn']);
});

test('runtime current WorkItem and DocumentVersion must match the real begin envelope', async t => {
  for (const key of ['workItemId', 'documentVersionId']) {
    const review = reviewRuntimeFixture();
    review.jobAidContext.tdmsReviewContext.runtimeContext.binding[key] = 'other-current-object'; syncReview(review);
    const f = await pipeline(t, {review});
    await assert.rejects(f.run(), /TASK_BINDING_INVALID/u);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.calls.map(call => call.name), ['begin_review_turn']);
  }
});

test('a valid bound runtime context may select no approved native refs without inventing a READ or saved carrier', () => {
  const review = reviewRuntimeFixture({count: 0}), before = structuredClone(review);
  assert.doesNotThrow(() => validateReviewTask(review));
  assert.deepEqual(review.jobAidContext.tdmsReviewContext.savedEvidenceRefs, []);
  assert.equal(review.jobAidContext.modelInput.availableSources.some(item => item.kind === 'TDMS_NATIVE_RECORD'), false);
  assert.deepEqual(review, before);
});

test('actual v3 native-only packet preserves receipt and uses the same bounded candidate path', async t => {
  const f = await pipeline(t, {mutatePacket(packet) {
    packet.schemaVersion = 'wiselink.jobaid-source-read.v3';
    packet.sourceStatements = []; packet.activityContexts = [];
  }});
  assert.equal((await f.run()).ok, true); assert.equal(f.requests.length, 2);
  assert.equal(f.journal[0].evidence[0].nativeReadReceipt.taskContextRef, f.task.operationRef);
});

for (const field of ['sourceStatements', 'activityContexts'])
  test(`native-only v3 rejects nonrequested ${field} before second Gateway request`, async t => {
    const f = await pipeline(t, {mutatePacket(packet) {
      packet.schemaVersion = 'wiselink.jobaid-source-read.v3';
      packet.sourceStatements = []; packet.activityContexts = [];
      packet[field].push({unrequested: true});
    }});
    await assert.rejects(f.run(), /READ_PACKET_INVALID/u);
    assert.equal(f.requests.length, 1);
    assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
  });

test('automatic citation correction uses the guarded read wrapper before replaying model feedback', async t => {
  const output = {...reviewOutput(), sourceRefs: ['document:page-1']};
  const f = await pipeline(t, {output});
  assert.equal((await f.run()).ok, true); assert.equal(f.requests.length, 3);
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'read_review_native_sources').length, 1);
  assert.equal(JSON.stringify(f.requests).includes(f.task.operationRef), false);
});

test('automatic citation correction rejects control values in ordinary read body before next Gateway request', async t => {
  const review = reviewRuntimeFixture();
  review.jobAidContext.sourceCatalog[0].excerpt = 'Poison AQ-native-review-current';
  review.resourceRefs[0].value.excerpt = 'Poison AQ-native-review-current';
  review.jobAidContext.modelInput.deliveredEvidence[0].excerpt = 'Poison AQ-native-review-current'; syncReview(review);
  const f = await pipeline(t, {review, output: {...reviewOutput(), sourceRefs: ['document:page-1']}});
  await assert.rejects(f.run(), /REVIEW_MODEL_CONTROL_PLANE_VALUE_FORBIDDEN/u);
  assert.equal(f.requests.length, 2, 'the source is blocked before a third request');
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 1);
  assert.equal(f.calls.some(call => call.name === 'commit_review_turn_candidate'), false);
});

test('isolated candidate remains document-only with full-input guard and never reads the new native directory', async t => {
  const f = await pipeline(t, {isolated: true, reads: [], output: reviewOutput('document:page-1')});
  assert.equal((await f.run()).outcome, 'CANDIDATE_NOT_SAVED');
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 1);
  assert.equal(f.calls.some(call => ['read_review_native_sources', 'commit_review_turn_candidate'].includes(call.name)), false);
});

test('isolated document read cannot smuggle a current control value outside initial prompt', async t => {
  const review = reviewRuntimeFixture();
  review.jobAidContext.initiallyDeliveredRefs = [];
  review.jobAidContext.modelInput.deliveredEvidence = [];
  review.jobAidContext.sourceCatalog[0].excerpt = 'Poison AQ-native-review-current';
  review.resourceRefs[0].value.excerpt = 'Poison AQ-native-review-current'; syncReview(review);
  const f = await pipeline(t, {review, isolated: true, reads: [], output: reviewOutput('document:page-1')});
  await assert.rejects(f.run(), /REVIEW_MODEL_CONTROL_PLANE_VALUE_FORBIDDEN/u);
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.filter(call => call.name === 'read_source_refs').length, 1);
});

test('actual automatic Review consumer forwards capability and retains its original failure-stop handling', async t => {
  for (const available of [true, false]) {
    const f = await pipeline(t);
    const review = f.task.modelInput;
    const result = await consumePendingReviewTurn({workItemId: f.task.workItemId, checkpointRoot: f.checkpointDir}, {
      hasTool: () => available, invokeModel: f.invokeModel,
      callTool: async (name, args) => name === 'get_pending_review_turn'
        ? {busy: false, next: {reviewConversationRef: review.reviewConversationRef,
          reviewTurnRef: review.reviewTurnRef, requestId: review.requestId}} : f.callTool(name, args),
    });
    assert.equal(result.status, available ? 'CANDIDATE_SAVED' : 'REQUIRES_ATTENTION');
    if (!available) {
      assert.equal(result.errorCode, 'REVIEW_NATIVE_READ_CAPABILITY_UNAVAILABLE');
      assert.equal(result.attemptStatus, 'CANCELLED'); assert.equal(f.requests.length, 0);
    }
  }
});

test('new READ MCP boundary preserves bounded Source error code without private detail', async () => {
  for (const code of ['TDMS_SOURCE_PERMISSION_CHANGED', 'TDMS_PROCESSING_SET_SELECTION_CHANGED',
    'TDMS_RUNTIME_CALLER_AUTHORIZATION_NOT_CONNECTED']) {
    const client = {callTool: async () => ({isError: true, content: [{type: 'text',
      text: `Error: ${code}:private-actor private-scope private-token`}]})};
    await assert.rejects(callJsonTool(client, 'read_review_native_sources', {}), error => {
      assert.equal(error.hostErrorCode, code);
      assert.equal(error.message, `REVIEW_HOST_MCP_TOOL_FAILED:read_review_native_sources:${code}`);
      assert.equal(error.receivedHostToolError, true);
      assert.equal(JSON.stringify(error).includes('private-'), false);
      return true;
    });
  }
});

test('new READ error extraction does not broaden ordinary tools or retain unknown/oversized prose', async () => {
  for (const [tool, text] of [['read_source_refs', 'TDMS_SOURCE_PERMISSION_CHANGED:private-token'],
    ['read_review_native_sources', 'Arbitrary body with private-token'],
    ['read_review_native_sources', 'TDMS_RUNTIME_ACCESS_CHANGED:private-token'],
    ['read_review_native_sources', 'TDMS_SOURCE_PERMISSION_CHANGED private-token'],
    ['read_review_native_sources', `TDMS_${'A'.repeat(160)}:private-token`]]) {
    const client = {callTool: async () => ({isError: true, content: [{type: 'text', text}]})};
    await assert.rejects(callJsonTool(client, tool, {}), error => {
      assert.equal(error.hostErrorCode, null); assert.equal(error.message, `REVIEW_HOST_MCP_TOOL_FAILED:${tool}`);
      return true;
    });
  }
});
