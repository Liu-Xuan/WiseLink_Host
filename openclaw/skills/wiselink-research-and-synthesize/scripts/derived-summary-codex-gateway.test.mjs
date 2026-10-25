import test from 'node:test';
import assert from 'node:assert/strict';
import { createSummaryCodexGatewaySession, validateSummaryCodexReceipt } from './derived-summary-codex-gateway.mjs';
import { consumeHierarchicalWikiIdle, summaryProviderSafelyClosed } from './consume-hierarchical-wiki-queue.mjs';
import { invokeHostedDerivedSummaryModel } from './invoke-hosted-derived-summary-model.mjs';
import { consumeHostedMatter } from './consume-hosted-matter.mjs';

function checkpoint() {
  const records = new Map();
  return {
    records,
    readOptional: async key => records.get(key) ?? null,
    write: async (key, value) => { records.set(key, value); },
    writeOnce: async (key, value) => {
      if (records.has(key)) throw new Error('CHECKPOINT_EXISTS');
      records.set(key, value);
    },
    hasEntries: async prefix => [...records.keys()].some(key => key.startsWith(prefix)),
    remoteStep: async ({ step, args, perform }) => {
      const prior = records.get(`${step}.result`);
      if (prior) {
        assert.deepEqual(prior.args, args);
        return prior.result;
      }
      const result = await perform();
      records.set(`${step}.result`, { args, result });
      return result;
    },
  };
}

const budget = { timeoutMs: 30_000, maxCompletionTokens: 1000, maxModelRequests: 3, reasoningEffort: 'low' };
const executionModel = { modelRef: 'miaoda/glm-5.3' };
const complete = { codex_exit_code: 0, closure: 'completed', terminal_events: ['turn.completed'],
  model_requests: 1, upstream_models: ['glm-5.3'], input_tokens: 23, output_tokens: 7,
  transport_passed: true, structured_final_to_contract: true, source_config_unchanged: true };

test('Codex summary session records each actual completed process and no native receipt', async () => {
  const store = checkpoint();
  const gateway = createSummaryCodexGatewaySession({ summaryId: 'DS-1', attemptRef: 'AQ-1',
    executionModel, deadlineAt: new Date(Date.now() + 30_000).toISOString(), runBudget: budget,
    codexOptions: {}, checkpoint: store,
    requestGateway: async (_endpoint, _init, { onRunCompleted }) => {
      await onRunCompleted({ transport: complete });
      return { status: 200, ok: true, text: async () => '{}' };
    } });
  await gateway.request({ signal: new AbortController().signal });
  await gateway.request({ signal: new AbortController().signal });
  await gateway.close();
  const binding = await store.readOptional('summary-codex.started');
  const receipt = await store.readOptional('summary-codex.receipt');
  assert.equal(validateSummaryCodexReceipt(receipt, binding).closed, true);
  assert.equal(receipt.runs.length, 2);
  assert.equal(await store.readOptional('summary-gateway.receipt'), null);
});

test('an unknown Codex producer outcome cannot become a closed receipt', async () => {
  const store = checkpoint();
  const gateway = createSummaryCodexGatewaySession({ summaryId: 'DS-1', attemptRef: 'AQ-1',
    executionModel, deadlineAt: new Date(Date.now() + 30_000).toISOString(), runBudget: budget,
    codexOptions: {}, checkpoint: store,
    requestGateway: async () => { throw new Error('CODEX_GENERATION_INCOMPLETE'); } });
  await assert.rejects(gateway.request({ signal: new AbortController().signal }), /CODEX_GENERATION_INCOMPLETE/u);
  await gateway.close();
  const binding = await store.readOptional('summary-codex.started');
  assert.equal(validateSummaryCodexReceipt(await store.readOptional('summary-codex.receipt'), binding).closed, false);
});

test('a completed process with an unexpected upstream model remains pinned', async () => {
  const store = checkpoint();
  const gateway = createSummaryCodexGatewaySession({ summaryId: 'DS-1', attemptRef: 'AQ-1',
    executionModel, deadlineAt: new Date(Date.now() + 30_000).toISOString(), runBudget: budget,
    codexOptions: {}, checkpoint: store,
    requestGateway: async (_endpoint, _init, { onRunCompleted }) => {
      await onRunCompleted({ transport: { ...complete, upstream_models: ['glm-5.3', 'other-model'] } });
      return { status: 200, ok: true, text: async () => '{}' };
    } });
  await assert.rejects(gateway.request({ signal: new AbortController().signal }),
    /DERIVED_SUMMARY_CODEX_PROCESS_UNVERIFIED/u);
  await gateway.close();
  assert.equal((await store.readOptional('summary-codex.receipt')).closed, false);
});

test('summary model retains Host read and SAVE_SUMMARY program with fake Codex steps', async () => {
  const store = checkpoint();
  const member = { member: { kind: 'MATTER_WORK', matterId: 'MAT-1', workRef: 'work-1',
    workRevision: 1, issueKeys: [] }, evidenceRef: 'member-1', headline: 'Member finding',
    body: 'Exact selected engineering work.', issues: [], evidence: [], rootRefs: [],
    limitations: ['Source currentness not established.'], current: true, overviewStatus: 'CURRENT', leaves: [] };
  const input = { scope: { kind: 'ATA4', title: 'Selected ATA4', fleetFamilyId: 'FAM-1',
    fleetModelIds: ['MODEL-1'], ata2: '27', ata4: '27-10', selectionReason: 'Selected exact work' },
    classificationStatus: 'CANDIDATE', instruction: 'Summarize selected work.', members: [member],
    evidence: [], limitations: ['Source currentness not established.'] };
  const steps = [
    { action: 'READ_MEMBER_WORK', evidenceRefs: ['member-1'], purpose: 'Confirm exact selected work.' },
    { action: 'SAVE_SUMMARY', content: { headline: 'Selected ATA4 candidate', listBrief: 'One selected matter.',
      body: 'Selected engineering finding [[member-1]]. Source currentness remains unverified.',
      limitations: ['Source currentness not established.'] } },
  ];
  let calls = 0;
  const candidate = await invokeHostedDerivedSummaryModel(input, {
    modelExecutor: 'CODEX', codexOptions: { codexBinary: '/usr/bin/codex',
      configPath: '/tmp/openclaw.json', runRoot: '/tmp/codex-runs' },
    executionModel, checkpoint: store, sessionDiscriminator: 'AQ-1:1', summaryId: 'DS-1',
    attemptRef: 'AQ-1', deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    runBudget: budget, heartbeat: async () => {},
    readMembers: async () => ({ members: [member] }), readSources: async () => ({ evidence: [] }),
  }, { requestGateway: async (_endpoint, init, { onRunCompleted }) => {
    const request = JSON.parse(init.body);
    assert.equal(request.messages.length, calls === 0 ? 2 : 4);
    assert.equal(request.tools[0].function.name, 'return_wiselink_summary_step');
    await onRunCompleted({ transport: complete });
    const step = steps[calls++];
    return { status: 200, ok: true, text: async () => JSON.stringify({ model: 'glm-5.3',
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null,
        tool_calls: [{ id: `call-${calls}`, type: 'function', function: {
          name: 'return_wiselink_summary_step', arguments: JSON.stringify({ step }) } }] } }] }) };
  } });
  assert.equal(calls, 2);
  assert.equal(candidate.content.headline, 'Selected ATA4 candidate');
  assert.equal(candidate.provenance.actualModel, 'glm-5.3');
  assert.equal(candidate.provenance.toolVersions['model-executor'], 'CODEX');
  assert.equal((await store.readOptional('summary-codex.receipt')).closed, true);
  assert.equal((await store.readOptional('summary-model-state')).round, 1);
});

async function queueWithMatter(transport) {
  const queue = checkpoint();
  const matter = checkpoint();
  let cleanupCalls = 0;
  const result = await consumeHierarchicalWikiIdle({ enabled: true, modelExecutor: 'CODEX',
    codexOptions: {}, runBudget: budget, checkpointRoot: '/tmp/wiselink-wiki-test', endpointKey: 'host' }, {
    checkpoint: queue,
    createCheckpoint: async () => matter,
    callTool: async name => {
      if (name === 'next_hierarchical_wiki') return { status: 'MATTER_PENDING', matterId: 'MAT-1', attemptRef: 'AQ-1' };
      if (name === 'hierarchical_wiki_cleanup') cleanupCalls++;
      throw new Error('UNEXPECTED_HOST_TOOL');
    },
    consumeMatter: async (matterOptions, deps) => {
      assert.equal(matterOptions.modelExecutor, 'CODEX');
      await matter.writeOnce('binding', { matterId: 'MAT-1', attemptRef: 'AQ-1', inputHash: 'exact-hash' });
      return deps.invokeMatterModel({}, { executionModel,
        taskDeadline: new Date(Date.now() + 30_000).toISOString() });
    },
    invokeMatterModel: async (_input, _hooks, deps) => {
      await deps.requestGateway(null, { signal: new AbortController().signal, body: '{}',
        codexRound: 0, codexRecoverOnly: false });
      return { status: 'MATTER_WORK_SAVED' };
    },
    requestGateway: async (_endpoint, _init, { onRunCompleted }) => {
      if (transport) await onRunCompleted({ transport });
      return { status: 200, ok: true, text: async () => '{}' };
    },
  });
  return { result, queue, matter, cleanupCalls };
}

test('Wiki releases exact matter pointer only after completed Codex receipt', async () => {
  const { result, queue, matter, cleanupCalls } = await queueWithMatter(complete);
  assert.equal(result.status, 'WIKI_MATTER_DISPATCHED');
  assert.equal(await queue.readOptional('active-wiki'), null);
  assert.equal((await matter.readOptional('summary-codex.receipt')).closed, true);
  assert.equal(cleanupCalls, 0);
});

test('Wiki pins exact matter pointer when Codex callback is missing', async () => {
  const { result, queue, matter, cleanupCalls } = await queueWithMatter(null);
  assert.equal(result.status, 'WIKI_ATTENTION');
  assert.equal(result.errorCode, 'WIKI_PROVIDER_TERMINAL_UNKNOWN');
  assert.deepEqual(await queue.readOptional('active-wiki'), {
    schemaVersion: 1, kind: 'MATTER', matterId: 'MAT-1', attemptRef: 'AQ-1',
    modelExecutor: 'CODEX', phase: 'PREPARING' });
  assert.equal((await matter.readOptional('summary-codex.receipt')).closed, false);
  assert.equal(cleanupCalls, 0);
});

test('Wiki rejects executor switch on an unresolved Codex pointer', async () => {
  const { queue } = await queueWithMatter(null);
  let dispatched = false;
  await assert.rejects(consumeHierarchicalWikiIdle({ enabled: true, runBudget: budget,
    checkpointRoot: '/tmp/wiselink-wiki-test', endpointKey: 'host' }, {
    checkpoint: queue, callTool: async () => { dispatched = true; throw new Error('MUST_NOT_DISPATCH'); },
  }), /WIKI_MODEL_EXECUTOR_BINDING_INVALID/u);
  assert.equal(dispatched, false);
  assert.equal((await queue.readOptional('active-wiki')).modelExecutor, 'CODEX');
});

test('Wiki rejects Codex takeover of a legacy markerless Hosted pointer', async () => {
  const queue = checkpoint();
  await queue.write('active-wiki', { schemaVersion: 1, kind: 'SUMMARY', summaryId: 'DS-1',
    attemptRef: 'AQ-1', phase: 'NO_GATEWAY' });
  await assert.rejects(consumeHierarchicalWikiIdle({ enabled: true, modelExecutor: 'CODEX',
    runBudget: budget, checkpointRoot: '/tmp/wiselink-wiki-test', endpointKey: 'host' },
  { checkpoint: queue }), /WIKI_MODEL_EXECUTOR_BINDING_INVALID/u);
  assert.equal((await queue.readOptional('active-wiki')).modelExecutor, undefined);
});

test('Wiki Matter Codex binding rejects an existing Hosted COMMITTING checkpoint before recovery', async () => {
  const locator = checkpoint();
  const attempt = checkpoint();
  await attempt.writeOnce('binding', { matterId: 'MAT-1', attemptRef: 'AQ-1', inputHash: 'old-hash' });
  await attempt.writeOnce('finish-result', { status: 'SUCCEEDED', modelOutput: '{"workRevisionRef":"old"}' });
  const called = [];
  await assert.rejects(consumeHostedMatter({ matterId: 'MAT-1', attemptRef: 'AQ-1',
    checkpointRoot: '/tmp/wiselink-wiki-test', modelExecutor: 'CODEX' }, {
    createCheckpoint: async path => path.endsWith('/MAT-1') ? locator : attempt,
    callTool: async (name, input) => {
      called.push(`${name}:${input?.operation ?? ''}`);
      if (name === 'next_matter_assessment') return { matterId: 'MAT-1',
        next: { attemptRef: 'AQ-1', status: 'COMMITTING' } };
      if (name === 'matter_action_attempt' && input.operation === 'CLAIM') return {
        attemptRef: 'AQ-1', status: 'COMMITTING', leaseToken: 'lease', leaseGeneration: 1,
        recoveryResult: { status: 'SUCCEEDED', modelOutput: '{"workRevisionRef":"old"}' },
        task: { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v2',
          taskType: 'OPENCLAW_MATTER_ASSESSMENT', subject: { kind: 'ENGINEERING_MATTER', matterId: 'MAT-1' },
          operationRef: 'AQ-1', inputHash: 'old-hash', modelInput: {
            schemaVersion: 'wiselink.matter-jobaid-task.v2' } },
      };
      throw new Error('UNEXPECTED_HOST_TOOL');
    },
    invokeMatterModel: async () => { throw new Error('MUST_NOT_GENERATE'); },
  }), /MATTER_CHECKPOINT_BINDING_MISMATCH/u);
  assert.deepEqual(called, ['next_matter_assessment:', 'matter_action_attempt:CLAIM']);
});

test('native receipt still uses its original closure contract', () => {
  const binding = { attemptRef: 'AQ-1', maxCompletionTokens: 1000, maxModelRequests: 3,
    deadlineAt: '2026-10-25T00:00:00.000Z', reasoningEffort: 'low' };
  const receipt = { attemptRef: 'AQ-1', modelId: 'glm-5.3', maxCompletionTokens: 1000,
    maxModelRequests: 3, dispatches: [], activeOrdinal: null, unknownTerminal: false,
    absoluteDeadline: binding.deadlineAt, upstreamDispatchCount: 0, upstreamHttpStatus: null,
    transportCompleted: false, providerStopConfirmed: false, outcome: 'NO_DISPATCH',
    expectedReasoningEffort: 'low',
    observedReasoningEffort: null, observedThinkingMode: null,
    tempSecretScan: { complete: true, found: false } };
  assert.equal(summaryProviderSafelyClosed(receipt, binding), true);
});
