import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../scripts/validate-payload.mjs';
import { derivedSummaryModelView, derivedSummaryModelMessages, derivedSummaryCachePrefixModelMessages,
  invokeHostedDerivedSummaryModel, DERIVED_SUMMARY_PROMPT_VERSION, DERIVED_SUMMARY_CACHE_PREFIX_PROMPT_VERSION } from '../scripts/invoke-hosted-derived-summary-model.mjs';
import { derivedSummaryRegistry } from '../scripts/derived-summary-shape.mjs';
import { createDerivedSummaryDeliveredView, createDerivedSummarySparseDeliveredView,
  projectDerivedSummaryReadReceipt } from '../scripts/derived-summary-read-projection.mjs';
import { summaryEvidenceRefs, summaryNativeReceiptFields, restoreSummaryMemberEvidence,
  sameSummaryEvidence } from '../scripts/derived-summary-native-evidence.mjs';
import { hierarchicalWikiParentModelView } from '../scripts/hierarchical-wiki-model-view.mjs';
import { createCheckpointStore } from '../scripts/run-hosted-review-turn.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DVI = 'document_version_carriers';
const SOURCE = 'PRUN-carriers:u1:p0';
const REF = `DOCUMENT_ORIGINAL:${DVI}:PRUN-carriers:${SOURCE}`;
const original = workItemId => ({ kind: 'DOCUMENT_PASSAGE', evidenceRef: REF, documentVersionId: DVI,
  workItemId, sourceRefId: SOURCE, title: 'Synthetic original', versionLabel: 'PRUN-carriers',
  excerpt: 'UNIQUE_DOCUMENT_BODY: Only if the exact condition holds.', locator: '{"parseRunId":"PRUN-carriers","sourceRefId":"PRUN-carriers:u1:p0"}' });
function input(variant = 'siblings') {
  const members = ['WI-A', 'WI-B'].map((workItemId, index) => {
    const member = { kind: 'WORK_ITEM_WORK', workItemId, documentVersionId: DVI,
      workRef: `JAWR-${workItemId}`, workRevision: index === 0 ? 13 : 18, issueKeys: [] };
    return { member, evidenceRef: `member-${index}`, headline: 'Saved candidate',
      understanding: `Saved understanding ${workItemId}`, body: `Saved understanding ${workItemId}\n\n`,
      issues: [], evidence: [original(workItemId)], rootRefs: [REF], limitations: ['Synthetic scope'],
      current: true, overviewStatus: 'CURRENT', leaves: [member] };
  });
  const value = { scope: { kind: 'ATA4', title: 'Synthetic selected scope', fleetFamilyId: 'B787', fleetModelIds: [],
    ata2: '45', ata4: '45-00', selectionReason: 'Selected fixture' }, classificationStatus: 'CANDIDATE',
    instruction: 'Synthesize exact selected saved work', members, evidence: [original('WI-A')], limitations: [] };
  if (variant !== 'siblings') {
    const member = variant === 'nested'
      ? { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child', summaryRef: 'DSR-child', summaryRevision: 1 }
      : { kind: 'MATTER_WORK', matterId: 'MAT-one', workRef: 'MWR-one', workRevision: 1, issueKeys: [] };
    const reading = { ...members[0], member, evidence: [original(null), original('WI-A'), original('WI-B')],
      leaves: members.map(item => item.member), rootRefs: [REF] };
    if (variant === 'nested') { delete reading.understanding; reading.body = 'Exact saved child body'; }
    value.members = [reading];
  }
  return value;
}

test('shared exact document source reaches the real model projection and restores both original WI member carriers', () => {
  const value = input(), before = canonicalJson(value);
  const view = derivedSummaryModelView(value);
  assert.equal(view.evidence.length, 1);
  assert.equal(view.evidence[0].workItemId, 'WI-A');
  const restored = createDerivedSummaryDeliveredView(view);
  assert.deepEqual([...restored.members.values()].map(item => item.value.evidence), value.members.map(item => item.evidence));
  assert.deepEqual(derivedSummaryRegistry(value).evidence.get(REF), value.evidence[0]);
  assert.equal(canonicalJson(value), before);
});

for (const variant of ['single-leaf', 'nested']) test(`${variant} preserves null and each WI occurrence through initial and detached READ projections`, () => {
  const value = input(variant), before = canonicalJson(value), view = derivedSummaryModelView(value);
  const actual = createDerivedSummaryDeliveredView(view).members.get('member-0').value;
  assert.deepEqual(actual.evidence, value.members[0].evidence);
  assert.deepEqual(actual.leaves, value.members[0].leaves);
  assert.deepEqual(view.members[0].evidenceRefs, [REF, REF, REF]);
  assert.deepEqual(view.members[0].documentWorkItemCarriers.map(row => row.workItemId), [null, 'WI-A', 'WI-B']);
  assert.equal(canonicalJson(view).split('UNIQUE_DOCUMENT_BODY').length - 1, 1);
  const registry = derivedSummaryRegistry(value), delivered = createDerivedSummaryDeliveredView({ members: [], evidence: [] });
  const intent = { action: 'READ_MEMBER_WORK', evidenceRefs: ['member-0'], purpose: 'Read exact saved carrier' };
  const packet = projectDerivedSummaryReadReceipt({ members: value.members }, intent, registry, delivered, { round: 0, messageIndex: 3 });
  const content = packet.items[0].content;
  assert.equal(content.evidence.length, 1);
  const roots = new Map(content.evidence.map(item => [item.evidenceRef, { value: item }]));
  assert.deepEqual(restoreSummaryMemberEvidence({ evidenceRefs: summaryEvidenceRefs(value.members[0].evidence),
    documentWorkItemCarriers: content.documentWorkItemCarriers }, roots), value.members[0].evidence);
  const again = projectDerivedSummaryReadReceipt({ members: value.members }, intent, registry, delivered, { round: 1, messageIndex: 5 });
  assert.equal(again.items[0].status, 'CONFIRMED_SAME_CONTENT');
  assert.equal(Object.hasOwn(again.items[0], 'content'), false);
  assert.equal(canonicalJson(value), before);
});

test('old single canonical carrier projection bytes remain unchanged', () => {
  const value = input(); value.members = [value.members[0]];
  const expected = structuredClone(value);
  expected.members = expected.members.map(({ evidence, body: _body, ...member }) => ({ ...member, evidenceRefs: [REF] }));
  assert.equal(canonicalJson(derivedSummaryModelView(value)), canonicalJson(expected));
  assert.deepEqual(summaryNativeReceiptFields(value.members[0].evidence, derivedSummaryRegistry(value).evidence), {});
  assert.deepEqual(createDerivedSummaryDeliveredView(expected).members.get('member-0').value.evidence, value.members[0].evidence);
});

test('canonical legacy SourceRef supports WI carriers, but readings, non-document refs and real version/body drift stay strict', () => {
  const a = original('WI-A'), b = original('WI-B');
  assert.equal(sameSummaryEvidence(a, b), true);
  for (const key of ['excerpt', 'locator', 'sourceRefId', 'documentVersionId', 'versionLabel', 'title'])
    assert.equal(sameSummaryEvidence(a, { ...b, [key]: `${b[key]} changed` }), false, key);
  assert.equal(sameSummaryEvidence(a, { ...b, workItemId: 42 }), false);
  for (const ref of ['legacy-unqualified', `DOCUMENT_READING_ORIGINAL:${DVI}:PRUN-carriers:DRR-1:anchor-1`])
    assert.equal(sameSummaryEvidence({ ...a, evidenceRef: ref }, { ...b, evidenceRef: ref }), false);
  assert.equal(sameSummaryEvidence({ ...a, evidenceRef: `source:${DVI}:${SOURCE}` },
    { ...b, evidenceRef: `source:${DVI}:${SOURCE}` }), true);
  const differentVersion = { ...b, evidenceRef: `DOCUMENT_ORIGINAL:${DVI}:PRUN-other:${SOURCE}`, versionLabel: 'PRUN-other' };
  assert.equal(derivedSummaryRegistry({ members: [], evidence: [a, differentVersion] }).evidence.size, 2);
  const fact = { kind: 'HOST_FACT', evidenceRef: 'fact-1', workItemId: 'WI-A', excerpt: 'Synthetic fact' };
  assert.equal(sameSummaryEvidence(fact, { ...fact, workItemId: 'WI-B' }), false);
});

test('carrier projection rejects missing occurrences, extra refs/fields and changed raw bodies before delivery mutation', () => {
  const value = input('nested'), registry = derivedSummaryRegistry(value);
  const view = derivedSummaryModelView(value), roots = new Map([...registry.evidence].map(([ref, body]) => [ref, { value: body }]));
  for (const mutate of [
    item => { delete item.documentWorkItemCarriers; },
    item => { item.documentWorkItemCarriers.pop(); },
    item => { item.documentWorkItemCarriers.push({ evidenceRef: REF, workItemId: 'WI-extra' }); },
    item => { item.documentWorkItemCarriers[0].evidenceRef = 'unregistered-ref'; },
    item => { item.documentWorkItemCarriers[0].extra = true; },
  ]) {
    const projected = structuredClone(view.members[0]); mutate(projected);
    assert.throws(() => restoreSummaryMemberEvidence(projected, roots), /DOCUMENT_CARRIER_INVALID/);
  }
  const receipt = structuredClone(value.members); receipt[0].evidence[1].excerpt += ' changed';
  const delivered = createDerivedSummaryDeliveredView({ members: [], evidence: [] });
  assert.throws(() => projectDerivedSummaryReadReceipt({ members: receipt },
    { action: 'READ_MEMBER_WORK', evidenceRefs: ['member-0'], purpose: 'Read exact member' }, registry, delivered,
    { round: 0, messageIndex: 3 }), /READ_PROJECTION_BINDING_INVALID/);
  assert.equal(delivered.members.size, 0); assert.equal(delivered.evidence.size, 0);
});

test('native receipt ref compression keeps each canonical document occurrence and source order', () => {
  const evidence = [original(null), original('WI-B'), { kind: 'TDMS_NATIVE_RECORD', evidenceRef: 'native-ref' },
    { kind: 'TDMS_NATIVE_RECORD', evidenceRef: 'native-ref' }, original('WI-A')];
  assert.deepEqual(summaryEvidenceRefs(evidence), [REF, REF, 'native-ref', REF]);
});

test('actual Wiki parent builder carries WI deltas without promoting roots to model body delivery', () => {
  const value = input();
  value.scope = { ...value.scope, kind: 'ATA2', ata4: null }; value.wikiLevel = 'ATA2';
  value.members = value.members.map((reading, index) => {
    const result = { ...reading, member: { kind: 'DERIVED_SUMMARY', summaryId: `DS-child-${index}`,
      summaryRef: `DSR-child-${index}`, summaryRevision: 1 } };
    delete result.understanding; result.body = `Saved child own-body ${index}`;
    return result;
  });
  const registry = derivedSummaryRegistry(value), view = hierarchicalWikiParentModelView(value);
  assert.equal(view.evidence.length, 0);
  assert.equal(view.members[0].documentWorkItemCarriers, undefined);
  assert.deepEqual(view.members[1].documentWorkItemCarriers, [{ evidenceRef: REF, workItemId: 'WI-B' }]);
  const delivered = createDerivedSummarySparseDeliveredView(view, registry);
  assert.equal(delivered.members.size, 2); assert.equal(delivered.evidence.size, 0);
  const roots = new Map([...registry.evidence].map(([ref, body]) => [ref, { value: body }]));
  assert.deepEqual(restoreSummaryMemberEvidence(view.members[1], roots), value.members[1].evidence);
});

async function driverFixture(value, cache) {
  const root = await mkdtemp(join(tmpdir(), 'summary-document-carriers-'));
  const checkpoint = await createCheckpointStore(root);
  await checkpoint.write('summary-model-state', { round: 0,
    promptVersion: cache ? DERIVED_SUMMARY_CACHE_PREFIX_PROMPT_VERSION : DERIVED_SUMMARY_PROMPT_VERSION,
    messages: cache ? derivedSummaryCachePrefixModelMessages(value) : derivedSummaryModelMessages(value) });
  let calls = 0, receipt, binding;
  const content = { headline: 'Candidate', listBrief: 'Selected synthetic scope', body: 'Saved candidate [[member-0]]', limitations: [] };
  const options = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'fixture-only',
    configuredModelVersion: 'fixture-configured', registeredModelRefs: ['miaoda/glm-5.3'], summaryId: 'summary-document',
    attemptRef: 'attempt-document', deadlineAt: '2099-01-01T00:00:00Z', sessionDiscriminator: 'attempt-document:1', checkpoint,
    executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Fixture', providerKind: 'BUILT_IN', settingsRevision: 1,
      selectedAt: '2026-10-17T00:00:00Z' },
    runBudget: { timeoutMs: 600000, maxCompletionTokens: 1000, maxModelRequests: 1, reasoningEffort: 'low' }, heartbeat: async () => {},
    readMembers: async () => { throw new Error('UNEXPECTED_MEMBER_READ'); },
    readSources: async () => { throw new Error('UNEXPECTED_SOURCE_READ'); },
    prepareGateway: async actual => { binding = actual; receipt = { attemptRef: actual.attemptRef, modelId: 'glm-5.3',
      maxCompletionTokens: actual.maxCompletionTokens, maxModelRequests: actual.maxModelRequests, absoluteDeadline: actual.deadlineAt,
      dispatches: [], activeOrdinal: null, unknownTerminal: false, upstreamDispatchCount: 0, upstreamHttpStatus: null,
      transportCompleted: false, providerStopConfirmed: false, outcome: 'CREATED', finishedAt: null,
      expectedReasoningEffort: 'low', observedReasoningEffort: null, observedThinkingMode: null, tempSecretScan: null };
      return { gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'fixture-only', getSanitizedReceipt: () => structuredClone(receipt),
        close: async () => { receipt.tempSecretScan = { complete: true, found: false }; } }; } };
  const dependencies = { requestGateway: async () => {
    calls++; Object.assign(receipt, { upstreamDispatchCount: 1, upstreamHttpStatus: 200, transportCompleted: true,
      providerStopConfirmed: true, outcome: 'COMPLETE', observedReasoningEffort: 'LOW', observedThinkingMode: 'ABSENT',
      dispatches: [{ ordinal: 1, upstreamHttpStatus: 200, actualCompletionTokens: binding.maxCompletionTokens,
        transportCompleted: true, providerKnownTerminal: true, finishReason: 'tool_calls', outcome: 'COMPLETE' }] });
    return new Response(JSON.stringify({ model: 'fixture/actual-model', choices: [{ finish_reason: 'tool_calls', message: {
      role: 'assistant', content: null, tool_calls: [{ id: 'fixture-call', type: 'function', function: {
        name: 'return_wiselink_summary_step', arguments: JSON.stringify({ step: { action: 'SAVE_SUMMARY', content } }) } }] } }] }));
  } };
  return { root, checkpoint, content, invoke: () => invokeHostedDerivedSummaryModel(value, options, dependencies), calls: () => calls };
}

for (const variant of ['siblings', 'single-leaf', 'nested']) for (const cache of [false, true])
  test(`actual driver ${cache ? 'cache' : 'regular'} ${variant} restores carriers and never repeats a completed request`, async () => {
    const value = input(variant), f = await driverFixture(value, cache);
    try {
      assert.deepEqual((await f.invoke()).content, f.content); assert.equal(f.calls(), 1);
      const before = canonicalJson(await f.checkpoint.readOptional('summary-model-state'));
      assert.deepEqual((await f.invoke()).content, f.content); assert.equal(f.calls(), 1);
      assert.equal(canonicalJson(await f.checkpoint.readOptional('summary-model-state')), before);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });

for (const mutation of ['missing', 'forged', 'reordered'])
  test(`actual stored member binding refuses ${mutation} document carrier metadata before another request`, async () => {
    const value = input('nested'), f = await driverFixture(value, false);
    try {
      await f.invoke();
      const state = await f.checkpoint.readOptional('summary-model-state');
      const message = state.messages[1], at = message.content.indexOf('INPUT:\n') + 'INPUT:\n'.length;
      const view = JSON.parse(message.content.slice(at));
      if (mutation === 'missing') delete view.members[0].documentWorkItemCarriers;
      if (mutation === 'forged') view.members[0].documentWorkItemCarriers[2].workItemId = 'WI-forged';
      if (mutation === 'reordered') view.members[0].documentWorkItemCarriers.reverse();
      message.content = message.content.slice(0, at) + JSON.stringify(view);
      await f.checkpoint.write('summary-model-state', state);
      await assert.rejects(f.invoke, /DERIVED_SUMMARY_MODEL_PROMPT_BINDING_INVALID/);
      assert.equal(f.calls(), 1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  });
