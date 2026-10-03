import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { consumeHostedDerivedSummary, derivedSummaryCliTarget, withSummaryHeartbeat } from '../scripts/consume-hosted-derived-summary.mjs';
import { invokeHostedDerivedSummaryModel, derivedSummaryModelMessages } from '../scripts/invoke-hosted-derived-summary-model.mjs';
import { derivedSummaryRegistry, validateDerivedSummaryTask, validateDerivedSummaryContent,
  materializeDerivedSummaryContent, normalizeDerivedSummaryContent,
  validateDerivedSummaryReadSelection } from '../scripts/derived-summary-shape.mjs';
import { canonicalSha256 } from '../scripts/validate-payload.mjs';
import { createCheckpointStore, executionModelHeaders, readHostMcpJsonResult } from '../scripts/run-hosted-review-turn.mjs';

const member = { kind: 'WORK_ITEM_WORK', workItemId: 'WI-one', documentVersionId: 'DV-one',
  workRef: 'WR-historical', workRevision: 2, issueKeys: ['issue-conditions'] };
const source = { evidenceRef: 'root-ref', kind: 'DOCUMENT_PASSAGE', title: 'Exact source', versionLabel: '2',
  excerpt: 'Applies only if installed; does not establish fleet installation.', workItemId: null,
  documentVersionId: 'DV-one', sourceRefId: 'SRC-one', locator: 'p. 4' };
const reading = { member, evidenceRef: 'member-ref', headline: 'Selected issue',
  body: 'Complete body with limiting conditions and named unknowns.', issues: [{ issueKey: 'issue-conditions',
    question: 'Condition?', body: 'Full selected issue and complete measure/risk rationale.' }],
  evidence: [source], rootRefs: [source.evidenceRef], limitations: ['Historical source; new version is not covered.'],
  current: false, overviewStatus: 'STALE', leaves: [member] };
const modelInput = { scope: { kind: 'ATA4', title: '46-00 selected material', fleetFamilyId: 'B787',
  fleetModelIds: ['B787-9'], ata2: '46', ata4: '46-00', selectionReason: 'Explicit selected work' },
  classificationStatus: 'CANDIDATE', instruction: 'Compare conditions without establishing applicability.',
  members: [reading], evidence: [source], limitations: ['Classification pending review.', 'No installation data connected.'] };
const task = { schemaVersion: 'wiselink.derived-summary-task.v1', taskType: 'OPENCLAW_DERIVED_SUMMARY',
  subject: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-one' }, expectedSummaryRevision: 0, requestId: 'request-one',
  modelInput, deadlineAt: '2099-01-01T00:00:00.000Z', actionAttemptId: 'ATT-one', operationRef: 'AQ-one',
  taskInputHash: 'host-owned-binding', executionModel: { modelRef: 'miaoda/glm-5.3', displayName: 'Synthetic route',
    providerKind: 'BUILT_IN', settingsRevision: 4, selectedAt: '2026-10-03T00:00:00.000Z' } };
const { taskInputHash: _taskHash, ...taskBasis } = task;
task.taskInputHash = canonicalSha256(taskBasis);
const content = { headline: '46-00 selected-material candidate', listBrief: 'Conditional outcome; installation is unknown.',
  body: 'Selected historical issue remains conditional [[member-ref]]. Original requirement [[root-ref]].',
  limitations: [...modelInput.limitations, 'Selected scope only; fleet installation unknown; classification pending.'] };
const target = { summaryId: 'DS-one', attemptRef: 'AQ-one' };
const runtime = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'synthetic-secret',
  configuredModelVersion: 'synthetic-configured', registeredModelRefs: ['miaoda/glm-5.3'] };

async function fixture(run) {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'derived-summary-'));
  try { await run(checkpointRoot); } finally { await rm(checkpointRoot, { recursive: true, force: true }); }
}
function gatewayStep(step, callId = 'call-one', extra = {}) {
  return new Response(JSON.stringify({ model: 'synthetic-actual/model-v1', ...extra,
    choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
      tool_calls: [{ id: callId, type: 'function', function: { name: 'return_wiselink_summary_step',
        arguments: JSON.stringify({ step }) } }] } }] }));
}
function harness(checkpointRoot, hooks = {}) {
  const calls = []; const gatewayCalls = []; let saved = null; let generation = 1; let gatewayReceipt;
  const runBudget = { timeoutMs: 600000, maxCompletionTokens: 64000, maxModelRequests: 10, reasoningEffort: 'low' };
  const dependencies = {
    prepareGateway: async binding => {
      assert.deepEqual(binding.subject, { kind: 'DERIVED_SUMMARY', summaryId: target.summaryId });
      assert.equal('workItemId' in binding, false);
      assert.equal(binding.nativeSessionKey, 'agent:wiselink-engineering:summary:DS-one:AQ-one');
      gatewayReceipt = { attemptRef: binding.attemptRef, modelId: 'glm-5.3', maxCompletionTokens: binding.maxCompletionTokens,
        maxModelRequests: binding.maxModelRequests, absoluteDeadline: binding.deadlineAt, dispatches: [],
        activeOrdinal: null, unknownTerminal: false, upstreamDispatchCount: 0, upstreamHttpStatus: null,
        transportCompleted: false, providerStopConfirmed: false, outcome: 'CREATED', finishedAt: null,
        expectedReasoningEffort: 'low', observedReasoningEffort: null, observedThinkingMode: null, tempSecretScan: null };
      return { gatewayUrl: 'http://127.0.0.1:1', gatewayToken: 'ephemeral-synthetic',
        getSanitizedReceipt: () => structuredClone(gatewayReceipt),
        close: async () => { gatewayReceipt.tempSecretScan = { complete: true, found: false }; } };
    },
    callTool: async (name, input) => {
      assert.equal(name, 'derived_summary_attempt'); calls.push(structuredClone(input));
      const intercepted = await hooks.tool?.(input, { get saved() { return saved; }, set saved(value) { saved = value; } });
      if (intercepted !== undefined) return intercepted;
      if (['HEARTBEAT', 'READ_MEMBER_WORK', 'READ_SOURCES', 'SAVE_SUMMARY', 'FINISH'].includes(input.operation)) {
        assert.equal(input.leaseToken, `lease-${generation}`); assert.equal(input.leaseGeneration, generation);
      }
      switch (input.operation) {
        case 'STATUS': return { ...target, status: 'RUNNING', savedSummaryRefs: saved ? [saved.summary.summaryRef] : [] };
        case 'CLAIM': return { ...target, task, status: 'RUNNING', leaseToken: `lease-${generation}`,
          leaseGeneration: generation, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
        case 'HEARTBEAT': return { ...target, status: 'RUNNING' };
        case 'READ_SAVED_SUMMARY': return saved;
        case 'READ_MEMBER_WORK': return { members: [reading] };
        case 'READ_SOURCES': return { evidence: [source] };
        case 'SAVE_SUMMARY': {
          assert.deepEqual(Object.keys(input).sort(), ['summaryId', 'attemptRef', 'leaseToken', 'leaseGeneration',
            'operation', 'requestId', 'expectedSummaryRevision', 'contentJson', 'provenanceJson'].sort());
          assert.equal(input.expectedSummaryRevision, 0); assert.equal(input.requestId, task.requestId);
          const receipt = { summaryId: target.summaryId, summaryRef: 'SUMR-one', revision: 1, replay: false };
          const submitted = JSON.parse(input.contentJson);
          const bodyRefs = new Set([...submitted.body.matchAll(/\[\[([^\]]+)\]\]/gu)].map(match => match[1]));
          saved = { receipt: { ...receipt, replay: true }, summary: { ...receipt, requestId: task.requestId,
            attemptRef: target.attemptRef, scope: modelInput.scope, classificationStatus: 'CANDIDATE',
            content: { headline: submitted.headline.trim(), listBrief: submitted.listBrief.trim(),
              body: submitted.body.trim(), limitations: [...new Set([...task.modelInput.limitations,
                ...submitted.limitations.map(item => item.trim())])] },
            members: task.modelInput.members,
            producer: JSON.parse(input.provenanceJson), coverage: task.modelInput.members.map(member => ({
              member: member.member, evidenceRef: member.evidenceRef, delivered: true, used: bodyRefs.has(member.evidenceRef),
              rootRefs: member.rootRefs, limitation: member.limitations.join('\n') })), candidateOnly: true } };
          await hooks.afterSave?.(saved);
          return receipt;
        }
        case 'FAIL': return { ...target, status: 'FAILED', errorCode: input.code };
        case 'FINISH': assert.ok(saved); return { ...target, status: 'SUCCEEDED', savedSummaryRef: saved.summary.summaryRef };
        default: assert.fail(input.operation);
      }
    },
    invokeModel: (input, modelHooks) => invokeHostedDerivedSummaryModel(input, { ...runtime, ...modelHooks }, {
      requestGateway: async (_endpoint, init) => {
        gatewayCalls.push(JSON.parse(init.body));
        assert.equal(init.headers['x-openclaw-model'], task.executionModel.modelRef);
        const response = await (hooks.gateway ? hooks.gateway(gatewayCalls.length, init)
          : gatewayStep({ action: 'SAVE_SUMMARY', content }));
        const reason = response.ok ? 'tool_calls' : null;
        gatewayReceipt.upstreamDispatchCount += 1;
        gatewayReceipt.dispatches.push({ ordinal: gatewayReceipt.upstreamDispatchCount,
          actualCompletionTokens: runBudget.maxCompletionTokens, upstreamHttpStatus: response.status,
          transportCompleted: true, providerKnownTerminal: true, finishReason: reason, outcome: 'COMPLETE' });
        Object.assign(gatewayReceipt, { providerStopConfirmed: true, transportCompleted: true,
          observedReasoningEffort: 'LOW', observedThinkingMode: 'ENABLED', outcome: 'COMPLETE' });
        await hooks.afterGatewayReceipt?.(gatewayReceipt);
        return response;
      }, wait: async () => {},
    }),
  };
  return { calls, gatewayCalls, dependencies, options: { ...target, checkpointRoot, runBudget },
    set generation(value) { generation = value; }, get saved() { return saved; } };
}

test('real summary adapter reads exact members and roots then saves, exact-reads and finishes the candidate', () => fixture(async root => {
  const steps = [
    { action: 'READ_MEMBER_WORK', evidenceRefs: ['member-ref'], purpose: 'Compare exact historical issue' },
    { action: 'READ_SOURCES', evidenceRefs: ['root-ref'], purpose: 'Check limiting original requirement' },
    { action: 'SAVE_SUMMARY', content },
  ];
  const h = harness(root, { gateway: n => gatewayStep(steps[n - 1], `call-${n}`) });
  const result = await consumeHostedDerivedSummary(h.options, h.dependencies);
  assert.equal(result.status, 'DERIVED_SUMMARY_SAVED'); assert.equal(result.candidateOnly, true);
  assert.equal(result.summaryRef, 'SUMR-one');
  assert.deepEqual(h.calls.map(call => call.operation), ['STATUS', 'CLAIM', 'READ_SAVED_SUMMARY', 'READ_MEMBER_WORK',
    'HEARTBEAT', 'READ_MEMBER_WORK', 'HEARTBEAT', 'READ_SOURCES', 'HEARTBEAT', 'SAVE_SUMMARY', 'READ_SAVED_SUMMARY', 'FINISH']);
  const input = JSON.parse(h.gatewayCalls[0].messages[1].content.split('INPUT:\n')[1]);
  assert.deepEqual(input, modelInput); assert.equal(input.members[0].member.workRef, 'WR-historical');
  assert.equal(input.members[0].issues[0].body, reading.issues[0].body);
  const requestText = JSON.stringify(h.gatewayCalls);
  for (const privateField of ['synthetic-secret', 'lease-1', 'taskInputHash', 'actionAttemptId', 'deadlineAt', 'executionModel'])
    assert.equal(requestText.includes(privateField), false);
  assert.equal(h.gatewayCalls[0].model, 'openclaw/wiselink-engineering');
  assert.equal(h.gatewayCalls[0].max_completion_tokens, 64000);
  const branches = h.gatewayCalls[0].tools[0].function.parameters.properties.step.oneOf;
  assert.deepEqual(branches.slice(0, 2).map(branch => branch.required),
    [['action', 'evidenceRefs', 'purpose'], ['action', 'evidenceRefs', 'purpose']]);
  const saveSchema = branches.find(branch => branch.properties.action.enum[0] === 'SAVE_SUMMARY');
  assert.deepEqual(saveSchema.required, ['action', 'content']);
  assert.equal(saveSchema.additionalProperties, false);
  const candidateSchema = saveSchema.properties.content;
  assert.equal(candidateSchema.type, 'object'); assert.equal(candidateSchema.additionalProperties, false);
  assert.deepEqual(candidateSchema.required, ['headline', 'listBrief', 'body', 'limitations']);
  for (const [key, maxLength] of [['headline', 240], ['listBrief', 2000], ['body', 1_000_000]])
    assert.deepEqual(candidateSchema.properties[key], { type: 'string', minLength: 1, maxLength, pattern: '\\S' });
  assert.equal(new RegExp(candidateSchema.properties.headline.pattern, 'u').test('Candidate'), true);
  assert.equal(new RegExp(candidateSchema.properties.headline.pattern, 'u').test('  \n'), false);
  assert.deepEqual(candidateSchema.properties.limitations,
    { type: 'array', minItems: 0, items: { type: 'string', minLength: 1, maxLength: 4000, pattern: '\\S' } });
  const systemPrompt = h.gatewayCalls[0].messages[0].content;
  assert.match(systemPrompt, /limitations is an array of nonempty strings and may be empty/);
  assert.match(systemPrompt, /Follow the length requested by this task instruction/);
  const checkpoint = await createCheckpointStore(join(root, 'derived-summary', 'host', 'DS-one', 'AQ-one'));
  assert.equal((await checkpoint.readOptional('summary-candidate')).provenance.actualModel, 'synthetic-actual/model-v1');
  assert.equal(h.saved.summary.producer.promptVersion, 'wiselink.derived-summary-prompt.v2');
  assert.deepEqual(h.saved.summary.content, content);
}));

test('typed empty model limitations save through the unchanged JSON transport with inherited Host limitations', () => fixture(async root => {
  const empty = { ...content, limitations: [] };
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: empty }) });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).summaryRef, 'SUMR-one');
  const submitted = h.calls.find(call => call.operation === 'SAVE_SUMMARY');
  assert.equal(typeof submitted.contentJson, 'string');
  assert.equal(Object.hasOwn(submitted, 'content'), false);
  assert.deepEqual(JSON.parse(submitted.contentJson), { ...empty, limitations: modelInput.limitations });
  assert.deepEqual(h.saved.summary.content.limitations, modelInput.limitations);
  assert.equal(h.gatewayCalls.length, 1);
}));

test('typed model failures remain failures without coercion or replay of their completed model response', () => fixture(async root => {
  for (const [index, [step, code]] of [
    [{ action: 'SAVE_SUMMARY', content: { ...content, limitations: 'A string instead of an array' } }, 'DERIVED_SUMMARY_CONTENT_INVALID'],
    [{ action: 'SAVE_SUMMARY', content: { ...content, limitations: ['   '] } }, 'DERIVED_SUMMARY_CONTENT_INVALID'],
    [{ action: 'SAVE_SUMMARY', content: { ...content, headline: 42 } }, 'DERIVED_SUMMARY_CONTENT_INVALID'],
    [{ action: 'SAVE_SUMMARY', content: { ...content, producer: 'model supplied' } }, 'DERIVED_SUMMARY_CONTENT_INVALID'],
    [{ action: 'SAVE_SUMMARY', content: JSON.stringify(content) }, 'DERIVED_SUMMARY_CONTENT_INVALID'],
    [{ action: 'SAVE_SUMMARY', contentJson: JSON.stringify(content) }, 'DERIVED_SUMMARY_MODEL_SAVE_INVALID'],
    [{ action: 'SAVE_SUMMARY', content, extra: true }, 'DERIVED_SUMMARY_MODEL_SAVE_INVALID'],
  ].entries()) {
    let failed = false;
    const h = harness(join(root, `typed-invalid-${index}`), { gateway: () => gatewayStep(step), tool: async input => {
      if (input.operation === 'FAIL') failed = true;
      if (input.operation === 'STATUS' && failed) return { ...target, status: 'FAILED', savedSummaryRefs: [] };
    } });
    await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), new RegExp(code, 'u'));
    assert.equal(h.calls.find(call => call.operation === 'FAIL').code, code);
    assert.equal(h.calls.some(call => ['SAVE_SUMMARY', 'FINISH', 'CANCEL'].includes(call.operation)), false);
    assert.equal(h.saved, null);
    assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).attemptStatus, 'FAILED');
    assert.equal(h.gatewayCalls.length, 1);
  }
}));

test('typed content enforces the existing Host receive limits before SAVE', () => fixture(async root => {
  for (const [index, invalid] of [
    { ...content, headline: 'H'.repeat(241) }, { ...content, listBrief: 'B'.repeat(2001) },
    { ...content, body: `${'B'.repeat(1_000_000)} [[member-ref]]` },
    { ...content, limitations: ['L'.repeat(4001)] },
  ].entries()) {
    const h = harness(join(root, `host-limit-${index}`), { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: invalid }) });
    await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /DERIVED_SUMMARY_CONTENT_INVALID/);
    assert.equal(h.calls.some(call => call.operation === 'SAVE_SUMMARY'), false);
    assert.equal(h.gatewayCalls.length, 1);
  }
}));

const sourceOnlyContent = { ...content, body: 'The original requirement remains conditional [[root-ref]].',
  limitations: [...content.limitations, 'The selected member was delivered [[member-ref]].'] };

test('registered source-only body saves and finishes without inventing direct member use', () => fixture(async root => {
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: sourceOnlyContent }) });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).summaryRef, 'SUMR-one');
  assert.deepEqual(JSON.parse(h.calls.find(call => call.operation === 'SAVE_SUMMARY').contentJson), sourceOnlyContent);
  assert.equal(h.saved.summary.coverage[0].delivered, true);
  assert.equal(h.saved.summary.coverage[0].used, false);
  assert.deepEqual(h.saved.summary.coverage[0].rootRefs, ['root-ref']);
  assert.equal(h.gatewayCalls.length, 1);
  assert.ok(h.calls.some(call => call.operation === 'FINISH'));
}));

test('source citations cannot be reported as direct member coverage', () => fixture(async root => {
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: sourceOnlyContent }),
    afterSave: async saved => { saved.summary.coverage[0].used = true; } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /SAVE_READBACK_MISMATCH/);
  assert.equal(h.calls.some(call => call.operation === 'FINISH'), false);
}));

const whitespaceContent = { headline: '\t Selected candidate \n', listBrief: '\n Selected scope only. \t',
  body: '\n  Body [[member-ref]]\n\nInterior paragraph [[root-ref]]  \n',
  limitations: ['\t Candidate boundary. \n', 'Candidate boundary.'] };
const normalizedWhitespaceContent = { headline: 'Selected candidate', listBrief: 'Selected scope only.',
  body: 'Body [[member-ref]]\n\nInterior paragraph [[root-ref]]',
  limitations: [...modelInput.limitations, 'Candidate boundary.'] };

test('complete candidate normalization is stable under the Host trim then task-limitations union', () => {
  const input = { ...modelInput, limitations: ['\n Inherited boundary. \t', ...modelInput.limitations] };
  const candidate = materializeDerivedSummaryContent(whitespaceContent, input);
  assert.deepEqual(candidate.limitations, [...input.limitations, 'Inherited boundary.', 'Candidate boundary.']);
  assert.deepEqual(normalizeDerivedSummaryContent(candidate, input), candidate);
});

test('model boundary whitespace is normalized before checkpoint and SAVE with Host-equivalent exact readback', () => fixture(async root => {
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: whitespaceContent }) });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).summaryRef, 'SUMR-one');
  const checkpoint = await createCheckpointStore(join(root, 'derived-summary', 'host', 'DS-one', 'AQ-one'));
  assert.deepEqual((await checkpoint.readOptional('summary-candidate')).content, normalizedWhitespaceContent);
  assert.deepEqual(JSON.parse(h.calls.find(call => call.operation === 'SAVE_SUMMARY').contentJson), normalizedWhitespaceContent);
  assert.deepEqual(h.saved.summary.content, normalizedWhitespaceContent);
  assert.equal(h.calls.filter(call => call.operation === 'FINISH').length, 1);
}));

test('legacy whitespace checkpoint resumes its exact saved candidate after lost FINISH without model or SAVE replay', () => fixture(async root => {
  let finishes = 0;
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: whitespaceContent }),
    tool: async input => {
      if (input.operation === 'FINISH' && ++finishes === 1) throw new Error('finish response lost');
    } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /finish response lost/);
  const checkpoint = await createCheckpointStore(join(root, 'derived-summary', 'host', 'DS-one', 'AQ-one'));
  const candidate = await checkpoint.readOptional('summary-candidate');
  await checkpoint.write('summary-candidate', { ...candidate, content: { ...whitespaceContent,
    limitations: [...modelInput.limitations, ...whitespaceContent.limitations] } });
  h.generation = 2;
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).summaryRef, 'SUMR-one');
  assert.deepEqual(h.saved.summary.content, normalizedWhitespaceContent);
  assert.equal(h.gatewayCalls.length, 1);
  assert.equal(h.calls.filter(call => call.operation === 'SAVE_SUMMARY').length, 1);
  assert.equal(h.calls.filter(call => call.operation === 'FINISH').length, 2);
}));

test('lost SAVE response reads back the same request before FINISH without another generation', () => fixture(async root => {
  const h = harness(root, { afterSave: async () => { throw new Error('save response lost'); } });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).status, 'DERIVED_SUMMARY_SAVED');
  assert.equal(h.gatewayCalls.length, 1);
  assert.equal(h.calls.filter(call => call.operation === 'SAVE_SUMMARY').length, 1);
  assert.equal(h.calls.filter(call => call.operation === 'FINISH').length, 1);
}));

test('lost FINISH response preserves the exact saved revision and next lease performs zero generation/save', () => fixture(async root => {
  let finishes = 0;
  const h = harness(root, { tool: async input => {
    if (input.operation === 'FINISH' && ++finishes === 1) throw new Error('finish response lost');
  } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /finish response lost/);
  h.generation = 2;
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).summaryRef, 'SUMR-one');
  assert.equal(h.gatewayCalls.length, 1); assert.equal(h.calls.filter(call => call.operation === 'SAVE_SUMMARY').length, 1);
}));

test('an exact completed read intent replays its Host read but a retired native attempt requires a new Host request before another generation', () => fixture(async root => {
  let reads = 0;
  const h = harness(root, { tool: async input => {
    if (input.operation === 'READ_SOURCES' && ++reads === 1) throw new Error('source read failed');
  }, gateway: n => gatewayStep(n === 1
    ? { action: 'READ_SOURCES', evidenceRefs: ['root-ref'], purpose: 'Check root' }
    : { action: 'SAVE_SUMMARY', content }, `call-${n}`) });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /source read failed/);
  h.generation = 2;
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /GATEWAY_REARM_REQUIRES_NEW_REQUEST/);
  assert.equal(reads, 2); assert.equal(h.gatewayCalls.length, 1);
}));

test('unknown gateway dispatch never repeats on a later native invocation', () => fixture(async root => {
  const h = harness(root, { gateway: () => { throw new Error('unknown gateway outcome'); } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /unknown gateway outcome/);
  h.generation = 2;
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /SUMMARY-ROUND-0_OUTCOME_UNKNOWN/);
  assert.equal(h.gatewayCalls.length, 1);
  assert.equal(h.calls.some(call => ['SAVE_SUMMARY', 'FINISH'].includes(call.operation)), false);
}));

test('safe transient gateway responses use the shared deadline-bound retry and exact Host heartbeat', () => fixture(async root => {
  const h = harness(root, { gateway: n => n === 1 ? new Response('{}', { status: 503 })
    : gatewayStep({ action: 'SAVE_SUMMARY', content }) });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).status, 'DERIVED_SUMMARY_SAVED');
  assert.equal(h.gatewayCalls.length, 2); assert.deepEqual(h.gatewayCalls[0], h.gatewayCalls[1]);
  assert.ok(h.calls.filter(call => call.operation === 'HEARTBEAT').length >= 3);
}));

for (const status of ['FAILED', 'CANCELLED']) test(`terminal ${status} summary attempt invokes neither CLAIM nor model`, () => fixture(async root => {
  const h = harness(root, { tool: async input => input.operation === 'STATUS'
    ? { ...target, status, savedSummaryRefs: [] } : undefined });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).attemptStatus, status);
  assert.equal(h.calls.length, 1); assert.equal(h.gatewayCalls.length, 0);
}));

for (const corrupt of [
  claim => { claim.summaryId = 'foreign-summary'; },
  claim => { claim.task = { ...task, subject: { kind: 'WORK_ITEM', workItemId: 'WI-fake' } }; },
  claim => { claim.task = { ...task, workItemId: 'WI-fake' }; },
  claim => { claim.task = { ...task, taskType: 'OPENCLAW_MATTER_ASSESSMENT' }; },
  claim => { claim.leaseGeneration = 0; },
]) test('foreign subject, fake old identity, wrong task type or invalid lease fails before gateway', () => fixture(async root => {
  const h = harness(root, { tool: async input => {
    if (input.operation !== 'CLAIM') return;
    const claim = { ...target, task, status: 'RUNNING', leaseToken: 'lease-1', leaseGeneration: 1,
      leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    corrupt(claim); return claim;
  } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /DERIVED_SUMMARY_(CLAIM|LEASE)/);
  assert.equal(h.gatewayCalls.length, 0);
}));

test('selected upper summary delivers the exact child and leaves with their limitations', () => {
  const upper = structuredClone(modelInput);
  upper.scope = { ...upper.scope, kind: 'ATA2', title: 'Explicit ATA46 subset', ata4: null };
  upper.members = [{ ...reading, member: { kind: 'DERIVED_SUMMARY', summaryId: 'DS-child',
    summaryRef: 'SUMR-child-exact', summaryRevision: 3 }, evidenceRef: 'child-ref', leaves: [member] }];
  const messages = derivedSummaryModelMessages(upper);
  assert.deepEqual(JSON.parse(messages[1].content.split('INPUT:\n')[1]), upper);
  assert.match(messages[0].content, /do not count the same root source twice/);
  assert.match(messages[0].content, /inherited source read is not a fresh verification/);
});

test('citation registry rejects foreign source/body injection and keeps member/source read kinds distinct', () => {
  const registry = derivedSummaryRegistry(modelInput);
  for (const intent of [
    { action: 'READ_SOURCES', evidenceRefs: ['member-ref'], purpose: 'wrong kind' },
    { action: 'READ_SOURCES', evidenceRefs: ['root-ref', 'foreign-page'], purpose: 'foreign' },
    { action: 'READ_SOURCES', evidenceRefs: ['root-ref', 'root-ref'], purpose: 'duplicate' },
    { action: 'READ_SOURCES', evidenceRefs: ['root-ref'], purpose: 'inject', body: 'fake source' },
  ]) assert.throws(() => validateDerivedSummaryReadSelection(intent, registry, 'READ_SOURCES'), /DERIVED_SUMMARY_/);
  assert.throws(() => validateDerivedSummaryContent({ ...content, body: 'Unknown [[foreign-ref]]' }, modelInput), /CITATION_NOT_REGISTERED/);
  assert.throws(() => validateDerivedSummaryContent({ ...content, body: 'No citation' }, modelInput), /CITATION_NOT_REGISTERED/);
  for (const kind of ['DOCUMENT_PASSAGE', 'DOCUMENT_ORIGINAL', 'ENGINEER_ATTACHMENT']) {
    const input = { ...modelInput, evidence: [{ ...source, kind }],
      members: [{ ...reading, evidence: [{ ...source, kind }] }] };
    assert.deepEqual(validateDerivedSummaryContent(sourceOnlyContent, input), sourceOnlyContent);
  }
  for (const candidate of [
    { ...sourceOnlyContent, body: 'No body citation', limitations: ['Limitation [[member-ref]]'] },
    { ...sourceOnlyContent, body: 'Registered [[root-ref]] and foreign [[foreign]]' },
    { ...sourceOnlyContent, limitations: ['Foreign limitation [[foreign]]'] },
    { ...sourceOnlyContent, body: 'Registered [[root-ref]] and malformed [[foreign\nref]]' },
  ]) assert.throws(() => validateDerivedSummaryContent(candidate, modelInput), /CITATION_NOT_REGISTERED/);
  assert.throws(() => validateDerivedSummaryContent({ ...content, candidateOnly: false }, modelInput), /CONTENT_INVALID/);
});

for (const operation of ['READ_MEMBER_WORK', 'READ_SOURCES']) test(`Host ${operation} receipt cannot switch exact identities`, () => fixture(async root => {
  const h = harness(root, { gateway: () => gatewayStep({ action: operation,
    evidenceRefs: [operation === 'READ_MEMBER_WORK' ? 'member-ref' : 'root-ref'], purpose: 'Check exact' }),
    tool: async input => {
      if (input.operation === 'READ_MEMBER_WORK') return { members: [{ ...reading, member: { ...member, workRef: 'WR-latest' } }] };
      if (input.operation === 'READ_SOURCES') return { evidence: [{ ...source, documentVersionId: 'DV-other' }] };
    } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /READ_BINDING_MISMATCH/);
  assert.equal(h.calls.some(call => call.operation === 'SAVE_SUMMARY'), false);
}));

test('Host exact saved readback must match candidate and revision before FINISH', () => fixture(async root => {
  const h = harness(root, { afterSave: async saved => { saved.summary.content = { ...content, body: 'Changed body [[member-ref]]' }; } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /SAVE_READBACK_MISMATCH/);
  assert.equal(h.calls.some(call => call.operation === 'FINISH'), false);
}));

test('lease loss aborts actual in-flight work and prevents a late return being accepted', async () => {
  let aborted = false;
  await assert.rejects(withSummaryHeartbeat(async signal => new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve('late'); });
  }), async () => { throw new Error('lease revoked'); }, 1), /lease revoked/);
  assert.equal(aborted, true);
});

test('task model selection stays on registered Host route and candidate classification cannot be promoted', () => {
  assert.deepEqual(executionModelHeaders({ ...runtime, executionModel: task.executionModel }), { 'x-openclaw-model': 'miaoda/glm-5.3' });
  assert.throws(() => executionModelHeaders({ ...runtime, registeredModelRefs: [], executionModel: task.executionModel }), /NOT_REGISTERED/);
  const promoted = { ...taskBasis, modelInput: { ...modelInput, classificationStatus: 'CONFIRMED' } };
  assert.throws(() => validateDerivedSummaryTask({ ...promoted, taskInputHash: canonicalSha256(promoted) }, target), /MODEL_INPUT_INVALID/);
});

test('summary CLI requires exact summary/attempt and rejects ambiguous legacy subject flags', () => {
  assert.deepEqual(derivedSummaryCliTarget(['--summary-id', 'DS-one', '--attempt-ref', 'AQ-one']), target);
  for (const flags of [[], ['--summary-id', 'DS-one'], ['--summary-id', 'DS-one', '--attempt-ref', 'AQ-one', '--matter-id', 'MAT-fake']])
    assert.throws(() => derivedSummaryCliTarget(flags), /DERIVED_SUMMARY_/);
});

test('bounded summary Host codes remain visible without arbitrary exception prose or tokens', () => {
  const args = { operation: 'SAVE_SUMMARY' };
  try { readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text: 'Error: DERIVED_SUMMARY_REVISION_CONFLICT:private' }] },
    'derived_summary_attempt', args); assert.fail(); }
  catch (error) { assert.equal(error.hostErrorCode, 'DERIVED_SUMMARY_REVISION_CONFLICT'); assert.equal(error.message.includes('private'), false); }
});


test('actual model reporting remains null when the official gateway does not expose a downstream model', () => fixture(async root => {
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content },
    'call-one', { model: 'openclaw/wiselink-engineering' }) });
  await consumeHostedDerivedSummary(h.options, h.dependencies);
  const saved = h.calls.find(call => call.operation === 'SAVE_SUMMARY');
  const producer = JSON.parse(saved.provenanceJson);
  assert.equal(producer.actualModel, null); assert.equal(producer.configuredModelRef, task.executionModel.modelRef);
  assert.equal('modelVersion' in producer, false);
}));


test('initial SAVE_NOT_FOUND is interpreted only by its exact bounded Host code', () => fixture(async root => {
  let reads = 0;
  const h = harness(root, { tool: async input => {
    if (input.operation === 'READ_SAVED_SUMMARY' && ++reads === 1)
      throw Object.assign(new Error('bounded Host failure'), { hostErrorCode: 'DERIVED_SUMMARY_SAVE_NOT_FOUND' });
  } });
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).status, 'DERIVED_SUMMARY_SAVED');
}));

test('lost FINISH with a SUCCEEDED status reads the exact saved result without CLAIM or generation', () => fixture(async root => {
  let terminal = false;
  const h = harness(root, { tool: async input => {
    if (input.operation === 'FINISH' && !terminal) { terminal = true; throw new Error('finish receipt lost'); }
    if (input.operation === 'STATUS' && terminal) return { ...target, status: 'SUCCEEDED', savedSummaryRefs: ['SUMR-one'] };
  } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /finish receipt lost/);
  const firstClaimCount = h.calls.filter(call => call.operation === 'CLAIM').length;
  assert.equal((await consumeHostedDerivedSummary(h.options, h.dependencies)).summaryRef, 'SUMR-one');
  assert.equal(h.calls.filter(call => call.operation === 'CLAIM').length, firstClaimCount);
  assert.equal(h.gatewayCalls.length, 1);
}));

test('same-DV separate WorkItems are all read; no latest or reader WorkItem is silently selected', () => fixture(async root => {
  const second = { ...reading, evidenceRef: 'member-two', member: { ...member, workItemId: 'WI-two', workRef: 'WR-two', issueKeys: ['issue-two'] } };
  const selected = { ...taskBasis, modelInput: { ...modelInput, members: [reading, second] } };
  const h = harness(root, { afterSave: async saved => {
    saved.summary.members = [reading, second]; saved.summary.coverage = [reading, second].map(item => ({
      member: item.member, evidenceRef: item.evidenceRef, delivered: true, used: item.evidenceRef === 'member-ref',
      rootRefs: item.rootRefs, limitation: item.limitations.join('\n') }));
  }, tool: async input => {
    if (input.operation === 'CLAIM') return { ...target, task: { ...selected, taskInputHash: canonicalSha256(selected) }, status: 'RUNNING',
      leaseToken: 'lease-1', leaseGeneration: 1, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    if (input.operation === 'READ_MEMBER_WORK') {
      assert.deepEqual(input.evidenceRefs, ['member-ref', 'member-two']); return { members: [reading, second] };
    }
  } });
  await consumeHostedDerivedSummary(h.options, h.dependencies);
  const input = JSON.parse(h.gatewayCalls[0].messages[1].content.split('INPUT:\n')[1]);
  assert.deepEqual(input.members.map(item => item.member.workItemId), ['WI-one', 'WI-two']);
}));

test('known model validation failure records its exact FAIL receipt, never CANCEL or a fake success', () => fixture(async root => {
  const h = harness(root, { gateway: () => gatewayStep({ action: 'SAVE_SUMMARY', content: { ...content, body: 'Bad [[foreign]]' } }) });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /CITATION_NOT_REGISTERED/);
  const failed = h.calls.find(call => call.operation === 'FAIL');
  assert.equal(failed.code, 'DERIVED_SUMMARY_CITATION_NOT_REGISTERED'); assert.equal(failed.leaseToken, 'lease-1');
  assert.equal(h.calls.some(call => ['CANCEL', 'SAVE_SUMMARY', 'FINISH'].includes(call.operation)), false);
}));

test('saved coverage must report actual direct member use and exact inherited roots before FINISH', () => fixture(async root => {
  for (const [index, alter] of [
    entry => { entry.used = false; },
    entry => { entry.rootRefs = ['unregistered-root']; },
    entry => { entry.delivered = false; },
  ].entries()) {
    const h = harness(join(root, `coverage-${index}`), { afterSave: async saved => alter(saved.summary.coverage[0]) });
    await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /SAVE_READBACK_MISMATCH/);
    assert.equal(h.calls.some(call => call.operation === 'FINISH'), false);
  }
}));

test('unverified provider terminal proof prevents save and records the actual execution failure', () => fixture(async root => {
  const h = harness(root, { afterGatewayReceipt: async receipt => { receipt.providerStopConfirmed = false; receipt.unknownTerminal = true; } });
  await assert.rejects(consumeHostedDerivedSummary(h.options, h.dependencies), /PROVIDER_TERMINAL_UNVERIFIED/);
  assert.equal(h.calls.find(call => call.operation === 'FAIL').code, 'DERIVED_SUMMARY_PROVIDER_TERMINAL_UNVERIFIED');
  assert.equal(h.calls.some(call => call.operation === 'SAVE_SUMMARY'), false);
}));
