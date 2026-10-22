import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

import { consumeHostedWorkItem, initialStageLimit, jobAidRunLimitOptions,
  runHostedInitialStage, consumeAutomaticWorkItemQueueBatch, consumeAutomaticWorkItemQueueTick,
  prepareExplicitJobAidRunBudgets, prepareExplicitJobAidContinuationBudget } from '../scripts/consume-hosted-work-item.mjs';
import { invokeHostedInitialModel } from '../scripts/invoke-hosted-initial-model.mjs';
import { canonicalSha256 } from '../scripts/validate-payload.mjs';
import { createCheckpointStore, readHostMcpJsonResult } from '../scripts/run-hosted-review-turn.mjs';

const limits = { modelRequests: 8, saves: 1, finishes: 1 };
const flags = ['--jobaid-max-model-requests', '8', '--jobaid-max-saves', '1',
  '--jobaid-max-finishes', '1'];
const scope = { workItemId: 'WI-synthetic-budget', initialStageOnly: true,
  maxInitialStages: 1, expectedInitialOperation: 'EVALUATE_JOBAID' };
const work = { schemaVersion: 'wiselink.jobaid-problem-work.v3',
  roundCompletion: 'COMPLETE_WITH_OPEN_QUESTIONS',
  overview: 'Synthetic source retains its condition and unresolved limitation.' };

test('explicit JobAid limits reject malformed, partial, duplicate and other-subject options before transport', async () => {
  assert.deepEqual(jobAidRunLimitOptions([], {}), {});
  assert.deepEqual(jobAidRunLimitOptions(flags, scope), { jobAidRunLimits: limits });
  assert.deepEqual(jobAidRunLimitOptions(flags, { ...scope, expectedInitialOperation: 'SYNTHESIZE_OVERALL' }),
    { jobAidRunLimits: limits });
  for (const argv of [flags.slice(0, 2), [...flags, '--jobaid-max-saves', '2'],
    flags.map(value => value === '8' ? '0' : value),
    flags.map(value => value === '8' ? '1.5' : value),
    flags.map(value => value === '8' ? '9007199254740992' : value),
    ['--jobaid-max-model-requests=8', ...flags.slice(2)],
    ['--jobaid-max-model-request', '8']])
    assert.throws(() => jobAidRunLimitOptions(argv, scope), /JOBAID_RUN_LIMIT_INVALID/u);
  for (const changed of [{ ...scope, matterId: 'MAT-synthetic' },
    { ...scope, workItemId: undefined, documentVersionId: 'DV-synthetic' },
    { ...scope, expectedInitialOperation: 'EXTRACT_APPLICABILITY' },
    { ...scope, initialStageOnly: false }, { ...scope, maxInitialStages: 2 }]) {
    assert.throws(() => jobAidRunLimitOptions(flags, changed), /JOBAID_RUN_LIMIT_SCOPE_INVALID/u);
    await assert.rejects(consumeHostedWorkItem({ ...changed, jobAidRunLimits: limits }, {
      callTool: () => assert.fail('invalid budget cannot access transport'),
    }));
  }
  assert.deepEqual(initialStageLimit(['--max-initial-stages', '1',
    '--expected-initial-operation', 'EVALUATE_JOBAID'], scope.workItemId),
  { maxInitialStages: 1, initialStageOnly: true, expectedInitialOperation: 'EVALUATE_JOBAID' });
});

async function fixture(t, steps, changes = {}, behavior = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wiselink-jobaid-run-limits-'));
  const workItemId = behavior.workItemId ?? scope.workItemId;
  const calls = [], requests = [], store = new Map();
  const overall = behavior.overall === true;
  const continuationRequestId = behavior.continuationRequestId;
  let committed = false;
  let committedHash = null;
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    requests.push(JSON.parse(raw));
    const step = steps.shift();
    if (step === 'UNKNOWN') { request.socket.destroy(); return; }
    if (typeof step === 'number') {
      response.writeHead(step, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { type: 'api_error' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ model: 'synthetic-model', choices: [{ finish_reason: 'tool_calls',
      message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${requests.length}`,
        type: 'function', function: { name: 'return_wiselink_assessment_step',
          arguments: JSON.stringify({ step }) } }] } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const prior = { requestId: 'JA-save-synthetic-prior', workItemId,
    workRevisionRef: 'JAWR-synthetic-1', workRevision: 1, overviewStatus: 'CURRENT',
    content: { ...work, issues: [], overviewStatus: 'CURRENT', readSourceRefs: [] } };
  if (overall) store.set(prior.requestId, prior);
  const modelInput = { schemaVersion: 'wiselink.jobaid-problem-task.v2', expectedWorkRevision: overall ? 1 : 0,
    purpose: overall ? 'OVERALL_CONSISTENCY' : 'INITIAL_PROBLEM_ASSESSMENT', methodBinding: { packRef: 'synthetic-method' },
    ...(behavior.semantic ? { contentValidationVersion: 'jobaid-semantic.v1' } : {}),
    availableSources: [{ ref: 'source:synthetic:1' }], deliveredEvidence: [], previousWork: overall ? prior : null,
    capabilities: [{ capability: 'reliability_history', status: 'NOT_CONNECTED', impact: 'Unqueried.' }] };
  const body = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    taskType: overall ? 'OPENCLAW_OVERALL_SYNTHESIS' : 'OPENCLAW_DYNAMIC_EVALUATION', actionAttemptId: 'ATT-synthetic-budget',
    operationRef: 'AQ-synthetic-budget', tenantId: 'synthetic-tenant', workItemId,
    documentVersionId: 'DV-synthetic-budget', priority: 100, inputRevision: 2, baseRevision: 2,
    sourceRefs: [], allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: { modelInput },
    deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: continuationRequestId
      ? `openclaw-v2:${overall ? 'overall' : 'dynamic'}:${workItemId}:DV-synthetic-budget:${continuationRequestId}`
      : 'synthetic-budget-stage' };
  const begin = { status: 'RUNNING', attemptRef: body.operationRef, leaseToken: 'synthetic-fence',
    leaseGeneration: 1, leaseExpiresAt: body.deadline, modelInput,
    task: { ...body, inputHash: canonicalSha256(body) } };
  const initial = { workItemId, documentVersionId: body.documentVersionId,
    workItemRevision: 2, candidateOnly: true, status: 'REQUIRED', nextOperation: overall ? 'SYNTHESIZE_OVERALL' : 'EVALUATE_JOBAID',
    stages: { translation: { status: 'SUCCEEDED' }, applicability: { status: 'WAITING_INPUT' },
      jobAid: { status: overall ? 'SUCCEEDED' : 'PENDING' }, overall: { status: 'PENDING' } } };
  const options = { ...scope, workItemId, expectedInitialOperation: overall ? 'SYNTHESIZE_OVERALL' : 'EVALUATE_JOBAID',
    checkpointRoot: root, jobAidRunLimits: { ...limits, ...changes } };
  if (continuationRequestId) {
    Object.assign(initial.stages[overall ? 'overall' : 'jobAid'], { requestId: continuationRequestId,
      attemptRef: begin.attemptRef, attemptStatus: 'QUEUED', terminalCode: null });
    options.explicitStageRequest = { workItemId, documentVersionId: body.documentVersionId,
      workItemRevision: initial.workItemRevision, operation: options.expectedInitialOperation,
      requestId: continuationRequestId, attemptRef: begin.attemptRef };
  }
  const dependencies = {
    invokeInitialModel: (input, hooks) => invokeHostedInitialModel(input, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: `http://127.0.0.1:${server.address().port}`,
      gatewayToken: 'synthetic-only', configuredModelVersion: 'synthetic-model', ...hooks,
    }),
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status') return { entry: { workItemId },
        initialAnalysis: committed ? { ...initial, workItemRevision: 3,
          nextOperation: overall ? null : 'SYNTHESIZE_OVERALL',
          stages: { ...initial.stages, [overall ? 'overall' : 'jobAid']: { status: 'SUCCEEDED' } } } : initial,
        ...(overall ? { integratedAssessmentSummary: { baseRules: {
          schemaVersion: 'wiselink.jobaid-problem-result.v2', status: 'CANDIDATE_ONLY',
          workRevisionRef: prior.workRevisionRef, workRevision: prior.workRevision,
          roundCompletion: work.roundCompletion } } } : {}) };
      if (name === (overall ? 'begin_overall_synthesis' : 'begin_dynamic_evaluation'))
        return { ...begin, selectedDiscoveryRefs: [] };
      if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: body.deadline };
      if (name === 'get_deep_link') return { url: 'https://example.invalid/synthetic' };
      if (name === 'read_assessment_sources') return { status: 'AVAILABLE',
        evidence: [{ evidenceRef: 'source:synthetic:1', kind: 'DOCUMENT_PASSAGE', excerpt: 'Synthetic condition.' }] };
      if (name === 'read_assessment_work') return { revision: args.requestId
        ? store.get(args.requestId) ?? null : [...store.values()].at(-1) ?? null };
      if (name === 'save_assessment_work') {
        if (behavior.saveUnknown) throw new Error('SYNTHETIC_SAVE_RESPONSE_LOST');
        const content = { ...JSON.parse(args.workJson), ...(overall ? { overviewStatus: 'CURRENT' } : {}) };
        const revision = { requestId: args.requestId, workItemId,
          workRevisionRef: `JAWR-synthetic-${args.expectedWorkRevision + 1}`,
          workRevision: args.expectedWorkRevision + 1, content };
        store.set(args.requestId, revision);
        if (behavior.savedResponseLost) throw new Error('SYNTHETIC_SAVE_RESPONSE_LOST');
        return { ...revision, roundCompletion: content.roundCompletion };
      }
      if (name === 'get_action_attempt_status') return {
        attemptRef: begin.attemptRef, taskType: body.taskType,
        status: committed ? 'SUCCEEDED' : 'RUNNING', resultContentHash: committedHash,
        recoveryAvailable: false, projectionApplied: committed, commitStartedAt: null, terminalReason: null,
      };
      if (name === (overall ? 'commit_overall_candidate' : 'commit_dynamic_evaluation_candidate')) {
        committed = true;
        committedHash = args.result.contentHash;
        if (behavior.finishResponseLost) throw new Error('SYNTHETIC_FINISH_RESPONSE_LOST');
        return { workItemId, workItemRevision: 3,
          status: overall ? 'OVERALL_CANDIDATE_READY' : 'BASE_RULE_CANDIDATE_READY',
          ...(overall ? { overallSynthesis: { status: 'CANDIDATE_ONLY', authorityLevel: 'candidate_only',
            externalDiscoveryIsEvidence: false } } : {}) };
      }
      assert.fail(`Unexpected synthetic Host tool ${name}`);
    },
  };
  const budgetPath = join(root, workItemId, 'initial', options.expectedInitialOperation, 'jobaid-run-budget.json');
  return { options, dependencies, calls, requests, initial, store,
    run: () => consumeHostedWorkItem(options, dependencies),
    budget: async () => JSON.parse(await readFile(budgetPath, 'utf8')) };
}

test('real consumer/orchestrator/model HTTP chain counts FINISH work as one SAVE and stops before Overall', async t => {
  const f = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }]);
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(result.completedStages, ['EVALUATE_JOBAID']);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.equal(f.calls.some(call => call.name === 'begin_overall_synthesis'), false);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 1, finishes: 1 });
  const [requestId] = f.store.keys();
  assert.ok(f.calls.some(call => call.name === 'read_assessment_work' && call.args.requestId === requestId));
  assert.equal((await f.budget()).active, null);
});

test('actual HTTP cap stops a later round before dispatch, without SAVE or forced FINISH', async t => {
  const f = await fixture(t, [{ action: 'READ_SOURCES', sourceRefs: ['source:synthetic:1'],
    purpose: 'Read exact synthetic source', context: 'EXACT' }], { modelRequests: 1 });
  const result = await f.run();
  assert.equal(result.errorCode, 'JOBAID_MODEL_HTTP_BUDGET_EXHAUSTED');
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 0);
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 0);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 0, finishes: 0 });
});

for (const overall of [false, true])
  test(`semantic ${overall ? 'Overall' : 'JobAid'} retains the actual HTTP budget and stops before a second dispatch`, async t => {
    const f = await fixture(t, [{ action: 'READ_SOURCES', sourceRefs: ['source:synthetic:1'],
      purpose: 'Read the exact source before semantic classification', context: 'EXACT' }],
    { modelRequests: 1 }, { semantic: true, overall });
    const result = await f.run();
    assert.equal(result.errorCode, 'JOBAID_MODEL_HTTP_BUDGET_EXHAUSTED');
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].messages[0].content, /definitionMatch \{methodRef,definitionQuote\}/u);
    assert.match(f.requests[0].messages[0].content, /method alone cannot prove applicability/u);
    assert.equal(f.calls.some(call => call.name === 'save_assessment_work' || call.name.startsWith('commit_')), false);
    assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 0, finishes: 0 });
    assert.deepEqual((await f.budget()).limits, { ...limits, modelRequests: 1 });
  });

test('second SAVE proposed inside FINISH is blocked before Host and does not force completion', async t => {
  const f = await fixture(t, [{ action: 'SAVE_WORK', workJson: JSON.stringify(work) },
    { action: 'FINISH', workJson: JSON.stringify(work) }]);
  const result = await f.run();
  assert.equal(result.errorCode, 'JOBAID_SAVE_BUDGET_EXHAUSTED');
  assert.equal(f.requests.length, 2);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 0);
  assert.equal(f.store.size, 1);
});

test('one saved complete revision may FINISH without another SAVE', async t => {
  const f = await fixture(t, [{ action: 'SAVE_WORK', workJson: JSON.stringify(work) }, { action: 'FINISH' }]);
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(f.requests.length, 2);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 2, saves: 1, finishes: 1 });
});

test('unknown HTTP is not retried and restart cannot drop or enlarge the original budget', async t => {
  const f = await fixture(t, ['UNKNOWN']);
  const result = await f.run();
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.jobAidRunBudget.pendingOutcome, 'modelRequests');
  assert.equal(f.requests.length, 1);
  const input = { ...f.options, operation: 'EVALUATE_JOBAID', initial: f.initial };
  await assert.rejects(runHostedInitialStage({ ...input, jobAidRunLimits: undefined }, f.dependencies),
    /JOBAID_RUN_LIMIT_REQUIRED/u);
  await assert.rejects(runHostedInitialStage({ ...input,
    jobAidRunLimits: { ...limits, modelRequests: 9 } }, f.dependencies), /JOBAID_RUN_LIMIT_CHECKPOINT_CHANGED/u);
  await assert.rejects(f.run());
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 0);
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 0);
});

test('a completed HTTP error consumes one attempt without adopting Review retry policy', async t => {
  const f = await fixture(t, [503]);
  const result = await f.run();
  assert.equal(result.errorCode, 'JOBAID_GATEWAY_HTTP_503');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 0, finishes: 0 });
});

test('saved response loss reconciles the original SAVE key and finishes without a second write', async t => {
  const f = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }], {},
    { savedResponseLost: true });
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 1);
  assert.equal(result.jobAidRunBudget.pendingOutcome, null);
});

test('unresolved SAVE response performs original-key reads only and never resends or FINISHes', async t => {
  const f = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }], {}, { saveUnknown: true });
  const result = await f.run();
  assert.equal(result.status, 'REQUIRES_ATTENTION');
  assert.equal(result.jobAidRunBudget.pendingOutcome, 'saves');
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 0);
  await assert.rejects(f.run());
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.requests.length, 1);
});

test('known SAVE requirements rejection permits the model correction while retaining both SAVE reservations', async t => {
  const corrected = { ...work, issues: Array.from({ length: 4 }, (_, index) => ({
    issueKey: `synthetic-${index}`, requirementHandling: [],
  })) };
  const rejected = structuredClone(corrected);
  rejected.issues[3].requirementHandling = {};
  const f = await fixture(t, [
    { action: 'READ_SOURCES', sourceRefs: ['source:synthetic:1'], purpose: 'Read synthetic condition.', context: 'EXACT' },
    { action: 'SAVE_WORK', workJson: JSON.stringify(rejected) },
    { action: 'FINISH', workJson: JSON.stringify(corrected) },
  ], { saves: 2 });
  const originalCall = f.dependencies.callTool;
  const saveKeys = [];
  f.dependencies.callTool = async (name, args) => {
    if (name === 'save_assessment_work') {
      saveKeys.push(args.requestId);
      assert.equal(args.expectedWorkRevision, 0);
      if (saveKeys.length === 1) {
        f.calls.push({ name, args });
        assert.deepEqual(JSON.parse(args.workJson).issues[3].requirementHandling, {});
        readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text: 'JOBAID_REQUIREMENTS_INVALID' }] }, name, args);
      }
      assert.ok(Array.isArray(JSON.parse(args.workJson).issues[3].requirementHandling));
    }
    return originalCall(name, args);
  };
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(f.requests.length, 3);
  assert.equal(saveKeys.length, 2);
  assert.notEqual(saveKeys[0], saveKeys[1]);
  assert.ok(f.calls.filter(call => call.name === 'read_assessment_work' && call.args.requestId === saveKeys[0]).length >= 2);
  assert.equal(f.store.size, 1);
  assert.equal(f.store.has(saveKeys[0]), false);
  assert.equal(f.store.get(saveKeys[1]).workRevision, 1);
  assert.equal(f.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 3, saves: 2, finishes: 1 });
  assert.equal(result.jobAidRunBudget.pendingOutcome, null);
  const correction = JSON.parse(f.requests[2].messages.at(-1).content);
  assert.equal(correction.errorCode, 'JOBAID_REQUIREMENTS_INVALID');
  assert.ok(correction.fieldErrors.some(item => item.path === 'work.issues[3].requirementHandling'));
  assert.deepEqual((await f.budget()).limits, { ...limits, saves: 2 });
});

test('known SAVE requirements rejection still consumes the original SAVE cap', async t => {
  const f = await fixture(t, [
    { action: 'SAVE_WORK', workJson: JSON.stringify(work) },
    { action: 'FINISH', workJson: JSON.stringify(work) },
  ]);
  const originalCall = f.dependencies.callTool;
  f.dependencies.callTool = async (name, args) => {
    if (name === 'save_assessment_work') {
      f.calls.push({ name, args });
      readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text: 'JOBAID_REQUIREMENTS_INVALID' }] }, name, args);
    }
    return originalCall(name, args);
  };
  const result = await f.run();
  assert.equal(result.errorCode, 'JOBAID_SAVE_BUDGET_EXHAUSTED');
  assert.equal(f.requests.length, 2);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 0);
  assert.equal(f.store.size, 0);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 2, saves: 1, finishes: 0 });
  assert.equal(result.jobAidRunBudget.pendingOutcome, null);
});

test('timeout, unproven rejection and post-save Host failure retain the uncertain SAVE without a second write', async t => {
  for (const failure of ['timeout', 'no-mcp-receipt', 'other-tool', 'post-save']) await t.test(failure, async subtest => {
    const f = await fixture(subtest, [{ action: 'FINISH', workJson: JSON.stringify(work) }]);
    const originalCall = f.dependencies.callTool;
    f.dependencies.callTool = async (name, args) => {
      if (name === 'read_assessment_work' && failure === 'post-save') {
        f.calls.push({ name, args });
        return { revision: null }; // The exact original SAVE key cannot establish a committed result.
      }
      if (name === 'save_assessment_work') {
        if (failure === 'post-save') await originalCall(name, args);
        else f.calls.push({ name, args });
        if (failure === 'timeout') throw new DOMException('Synthetic SAVE timeout.', 'TimeoutError');
        if (failure === 'no-mcp-receipt') throw new Error('JOBAID_REQUIREMENTS_INVALID');
        readHostMcpJsonResult({ isError: true, content: [{ type: 'text',
          text: failure === 'post-save' ? 'JOBAID_SOURCE_AUTHORIZATION_CHANGED' : 'JOBAID_REQUIREMENTS_INVALID',
        }] }, failure === 'other-tool' ? 'read_assessment_work' : name, args);
      }
      return originalCall(name, args);
    };
    const result = await f.run();
    assert.equal(result.status, 'REQUIRES_ATTENTION');
    assert.equal(result.jobAidRunBudget.pendingOutcome, 'saves');
    assert.equal(f.requests.length, 1);
    assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
    assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 0);
    assert.equal(f.store.size, failure === 'post-save' ? 1 : 0);
    const before = await f.budget();
    await assert.rejects(f.run());
    assert.deepEqual(await f.budget(), before);
    assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
    assert.equal(f.requests.length, 1);
  });
});

const normalContinuationId = 'a6421bc1-dfa5-4cb1-8f3c-4eabb5b4f0a7';
const continuationLimits = { modelRequests: 62, saves: 23, finishes: 1 };

async function retainOriginalUnknown(f) {
  await prepareExplicitJobAidRunBudgets({ workItemId: f.options.workItemId,
    documentVersionId: f.initial.documentVersionId, checkpointRoot: f.options.checkpointRoot,
    jobAidRunLimits: { modelRequests: 64, saves: 24, finishes: 1 },
    overallRunLimits: { modelRequests: 16, saves: 8, finishes: 1 } });
  const directory = join(f.options.checkpointRoot, f.options.workItemId, 'initial', 'EVALUATE_JOBAID');
  const checkpoint = await createCheckpointStore(directory);
  const original = await checkpoint.readOptional('jobaid-run-budget');
  await checkpoint.write('jobaid-run-budget', { ...original,
    counts: { modelRequests: 2, saves: 1, finishes: 0 },
    active: { kind: 'saves', requestId: 'JA-save-synthetic-original-unknown' } });
  await checkpoint.writeOnce('binding', { workItemId: f.options.workItemId,
    documentVersionId: f.initial.documentVersionId, operation: 'EVALUATE_JOBAID', requestId: null });
  await checkpoint.writeOnce('run-result', { status: 'REQUIRES_ATTENTION', attemptStatus: 'UNKNOWN',
    errorCode: 'JOBAID_RUN_OUTCOME_UNKNOWN', attemptRef: 'AQ-synthetic-original' });
  await checkpoint.writeOnce('assessment-current-claim', { attemptRef: 'AQ-synthetic-original',
    leaseToken: 'synthetic-old-lease', leaseGeneration: 1 });
  const control = await createCheckpointStore(join(f.options.checkpointRoot, 'original-control'));
  await control.writeOnce('run.started.private', { workItemId: f.options.workItemId, at: '2026-10-21T09:49:38Z' });
  const paths = ['jobaid-run-budget', 'binding', 'run-result', 'assessment-current-claim']
    .map(step => join(directory, `${step}.json`));
  paths.push(join(f.options.checkpointRoot, 'original-control', 'run.started.private.json'));
  const snapshot = () => Promise.all(paths.map(path => readFile(path)));
  const childPath = join(directory, 'requests', normalContinuationId, 'jobaid-run-budget.json');
  return { snapshot, before: await snapshot(), childPath };
}

test('normal Host continuation uses its prepared request directory and retains original UNKNOWN bytes and spent quota', async t => {
  const f = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }], continuationLimits,
    { continuationRequestId: normalContinuationId });
  const old = await retainOriginalUnknown(f);
  const prepared = await prepareExplicitJobAidContinuationBudget(f.options, f.dependencies);
  assert.equal(prepared.selection.requestId, normalContinuationId);
  assert.deepEqual(prepared.limits, continuationLimits);
  assert.deepEqual(prepared.previousRunBudget.dispatchReservations, { modelRequests: 2, saves: 1, finishes: 0 });
  assert.equal(prepared.previousRunBudget.pendingOutcome, 'saves');
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(result.completedStages, ['EVALUATE_JOBAID']);
  assert.equal(f.calls.find(call => call.name === 'begin_dynamic_evaluation').args.requestId, normalContinuationId);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 1, finishes: 1 });
  assert.deepEqual(await old.snapshot(), old.before);
  const child = await readFile(old.childPath);
  assert.deepEqual(JSON.parse(child).selection, prepared.selection);
  assert.deepEqual(JSON.parse(child).limits, continuationLimits);
  assert.equal(f.store.size, 1);
  await assert.rejects(f.run());
  await assert.rejects(prepareExplicitJobAidContinuationBudget(f.options, f.dependencies));
  assert.deepEqual(await readFile(old.childPath), child);
  assert.deepEqual(await old.snapshot(), old.before);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.equal(f.requests.length, 1);
});

test('normal Host continuation cannot consume the original guard without a separately prepared request budget', async t => {
  const f = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }], continuationLimits,
    { continuationRequestId: normalContinuationId });
  const old = await retainOriginalUnknown(f);
  await assert.rejects(f.run(), /JOBAID_CONTINUATION_BUDGET_REQUIRED/u);
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.some(call => call.name.startsWith('begin_')), false);
  assert.deepEqual(await old.snapshot(), old.before);
  await assert.rejects(readFile(old.childPath), { code: 'ENOENT' });
});

test('continuation preparation requires the fresh normal Host declaration rather than a caller or model request ID', async t => {
  for (const mismatch of ['absent', 'old-request', 'other-work-item', 'other-version', 'other-attempt', 'other-revision'])
    await t.test(mismatch, async subtest => {
      const f = await fixture(subtest, [{ action: 'FINISH', requestId: normalContinuationId,
        workJson: JSON.stringify(work) }], continuationLimits, { continuationRequestId: normalContinuationId });
      const old = await retainOriginalUnknown(f);
      if (mismatch === 'absent') delete f.initial.stages.jobAid.requestId;
      if (mismatch === 'old-request') f.initial.stages.jobAid.requestId = 'original-2';
      if (mismatch === 'other-work-item') f.initial.workItemId = 'WI-synthetic-other';
      if (mismatch === 'other-version') f.initial.documentVersionId = 'DV-synthetic-other';
      if (mismatch === 'other-attempt') f.initial.stages.jobAid.attemptRef = 'AQ-synthetic-other';
      if (mismatch === 'other-revision') f.initial.workItemRevision += 1;
      await assert.rejects(prepareExplicitJobAidContinuationBudget(f.options, f.dependencies));
      assert.equal(f.requests.length, 0);
      assert.equal(f.calls.some(call => call.name.startsWith('begin_')), false);
      assert.deepEqual(await old.snapshot(), old.before);
      await assert.rejects(readFile(old.childPath), { code: 'ENOENT' });
    });
});

test('new continuation requires the same Host claim and request identity before any model or SAVE', async t => {
  for (const mismatch of ['request-key', 'attempt', 'revision']) await t.test(mismatch, async subtest => {
    const f = await fixture(subtest, [{ action: 'FINISH', workJson: JSON.stringify(work) }], continuationLimits,
      { continuationRequestId: normalContinuationId });
    const old = await retainOriginalUnknown(f);
    await prepareExplicitJobAidContinuationBudget(f.options, f.dependencies);
    const originalCall = f.dependencies.callTool;
    f.dependencies.callTool = async (name, args) => {
      const result = await originalCall(name, args);
      if (name !== 'begin_dynamic_evaluation') return result;
      if (mismatch === 'attempt') return { ...result, attemptRef: 'AQ-synthetic-other' };
      return { ...result, task: { ...result.task, ...(mismatch === 'request-key'
        ? { idempotencyKey: result.task.idempotencyKey.replace(normalContinuationId, 'old-request') }
        : { inputRevision: result.task.inputRevision + 1 }) } };
    };
    await assert.rejects(f.run(), /AUTO_WORK_ITEM_EXPLICIT_STAGE_CHANGED/u);
    assert.equal(f.requests.length, 0);
    assert.equal(f.calls.some(call => call.name === 'save_assessment_work' || call.name.startsWith('commit_')), false);
    assert.deepEqual(await old.snapshot(), old.before);
    assert.deepEqual(JSON.parse(await readFile(old.childPath)).counts, { modelRequests: 0, saves: 0, finishes: 0 });
  });
});

test('FINISH response loss uses existing exact status readback without another commit', async t => {
  const f = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }], {},
    { finishResponseLost: true });
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 1);
  assert.equal(f.calls.filter(call => call.name === 'get_action_attempt_status').length, 1);
  assert.equal(result.jobAidRunBudget.pendingOutcome, null);
});

test('consumer enforces FINISH dispatch cap even if a caller asks for a second commit', async t => {
  const f = await fixture(t, []);
  f.dependencies.runInitial = async run => {
    await run.callTool('begin_dynamic_evaluation', { workItemId: scope.workItemId });
    const args = { attemptRef: 'AQ-synthetic-budget', result: { contentHash: 'synthetic-hash' } };
    await run.callTool('commit_dynamic_evaluation_candidate', args);
    await run.callTool('commit_dynamic_evaluation_candidate', args);
    assert.fail('second commit must stop');
  };
  const result = await f.run();
  assert.equal(result.errorCode, 'JOBAID_FINISH_BUDGET_EXHAUSTED');
  assert.equal(f.calls.filter(call => call.name.startsWith('commit_')).length, 1);
  assert.equal(f.requests.length, 0);
});

test('explicit Overall uses its own four-request budget and reuses exact CURRENT work without resaving', async t => {
  const f = await fixture(t, [{ action: 'FINISH', consistencyCheck: 'Synthetic exact saved overview is consistent.' }],
    { modelRequests: 4 }, { overall: true });
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.deepEqual(result.completedStages, ['SYNTHESIZE_OVERALL']);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 0);
  assert.equal(f.calls.filter(call => call.name === 'commit_overall_candidate').length, 1);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 1, saves: 0, finishes: 1 });
  assert.equal((await f.budget()).limits.modelRequests, 4);
});

test('Overall HTTP exhaustion stops before dispatch or forced commit', async t => {
  const f = await fixture(t, [{ action: 'READ_SOURCES', sourceRefs: ['source:synthetic:1'],
    purpose: 'Synthetic consistency source', context: 'EXACT' }], { modelRequests: 1 }, { overall: true });
  const result = await f.run();
  assert.equal(result.errorCode, 'JOBAID_MODEL_HTTP_BUDGET_EXHAUSTED');
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'commit_overall_candidate').length, 0);
});

test('Overall may read the exact baseline and save one meaningful new overview revision within4/1/1', async t => {
  const first = { workRevisionRef: 'JAWR-synthetic-1', action: 'READ_WORK',
    issueKeys: [], includeOverview: true };
  const f = await fixture(t, [first, { action: 'SAVE_WORK', workJson: JSON.stringify({
    ...work, issues: [], overview: 'Synthetic clarified condition and limitation.',
    changeSummary: 'Synthetic meaningful consistency clarification.' }) },
  { action: 'FINISH', consistencyCheck: 'Synthetic updated overview matches the exact saved issue scope.' }],
  { modelRequests: 4 }, { overall: true });
  const original = structuredClone(f.store.get('JA-save-synthetic-prior'));
  const result = await f.run();
  assert.equal(result.status, 'INITIAL_STAGE_SAVED');
  assert.equal(f.requests.length, 3);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(f.calls.find(call => call.name === 'save_assessment_work').args.expectedWorkRevision, 1);
  assert.equal(JSON.parse(f.calls.find(call => call.name === 'commit_overall_candidate').args.result.modelOutput).workRevisionRef,
    'JAWR-synthetic-2');
  assert.deepEqual(f.store.get('JA-save-synthetic-prior'), original);
  assert.deepEqual(result.jobAidRunBudget.dispatchReservations, { modelRequests: 3, saves: 1, finishes: 1 });
});

async function prepareTrial(f) {
  return prepareExplicitJobAidRunBudgets({ workItemId: f.options.workItemId,
    documentVersionId: f.initial.documentVersionId, checkpointRoot: f.options.checkpointRoot,
    jobAidRunLimits: limits, overallRunLimits: { ...limits, modelRequests: 4 } });
}

function claimFor(workItemId, leaseGeneration = 1) {
  return { status: 'CLAIMED', workItemId, requestId: 'REQ-synthetic-budget',
    documentVersionId: 'DV-synthetic-budget', workItemRevision: 2,
    leaseToken: 'b1686364-7ee9-4ec0-863c-e5b3d579048b', leaseGeneration,
    leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
}

function storedClaim(workItemId, changes = {}) {
  const { status: _status, ...claim } = claimFor(workItemId);
  return { schemaVersion: 'wiselink.auto_work_item_claim.v1', ...claim,
    completionReady: false, consumerStopped: false, attentionCode: null, blockReady: null, ...changes };
}

async function queueCheckpoint(root, claim = null) {
  const checkpoint = await createCheckpointStore(join(root, 'synthetic-queue'));
  await checkpoint.write('active-claim', claim);
  // Local macOS fixture substitutes only Linux FD/flock ownership; checkpoint
  // files, queue batch, actual consumer/model runner and owned HTTP are real.
  return { ...checkpoint, withActiveClaimOwner: perform => perform() };
}

test('budget UNKNOWN retains its real claim and stage bytes while actual batch continues another ordinary consumer', async t => {
  const trial = await fixture(t, ['UNKNOWN']);
  const other = await fixture(t, [{ action: 'FINISH', workJson: JSON.stringify(work) }], {},
    { workItemId: 'WI-synthetic-other' });
  await prepareTrial(trial);
  const unknown = await trial.run();
  assert.equal(unknown.jobAidRunBudget.pendingOutcome, 'modelRequests');
  const before = await readFile(join(trial.options.checkpointRoot, scope.workItemId,
    'initial', 'EVALUATE_JOBAID', 'jobaid-run-budget.json'));
  const original = storedClaim(scope.workItemId, { consumerStopped: true,
    attentionCode: 'JOBAID_RUN_OUTCOME_UNKNOWN' });
  const checkpoint = await queueCheckpoint(trial.options.checkpointRoot, original);
  let nextCalls = 0;
  const report = await consumeAutomaticWorkItemQueueBatch({ checkpointRoot: trial.options.checkpointRoot,
    maxQueueItems: 4 }, {
    checkpoint, nextWorkItem: async () => { nextCalls += 1; return claimFor(other.options.workItemId); },
    acknowledgeWorkItem: () => assert.fail('neither trial nor partial other WI can ACK'),
    blockWorkItem: () => assert.fail('budget is not Host terminal failure'),
    readInitialStatus: async id => {
      assert.equal(id, other.options.workItemId);
      return (await other.dependencies.callTool('get_parse_status', { workItemId: id })).initialAnalysis;
    },
    consumeWorkItem: options => {
      assert.equal(options.workItemId, other.options.workItemId);
      return consumeHostedWorkItem(options, other.dependencies);
    },
  });
  assert.deepEqual(report.reports.map(item => item.status), ['EXPLICIT_BUDGET_DEFERRED', 'IN_PROGRESS']);
  assert.equal(nextCalls, 1);
  const budgetCheckpoint = await createCheckpointStore(join(trial.options.checkpointRoot,
    scope.workItemId, 'initial', 'EVALUATE_JOBAID'));
  assert.deepEqual(await budgetCheckpoint.readOptional(report.reports[0].preservedClaimStep), original);
  assert.deepEqual(await readFile(join(trial.options.checkpointRoot, scope.workItemId,
    'initial', 'EVALUATE_JOBAID', 'jobaid-run-budget.json')), before);
  assert.equal(trial.requests.length, 1); // only the original UNKNOWN, never resent
  assert.equal(trial.calls.some(call => call.name === 'save_assessment_work' || call.name.startsWith('commit_')), false);
  assert.equal(other.requests.length, 1);
  assert.equal(other.calls.filter(call => call.name === 'save_assessment_work').length, 1);
  assert.equal(other.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 1);
  assert.equal((await checkpoint.readOptional('active-claim')).workItemId, other.options.workItemId);
});

test('later normal Host claim of protected WI is retained and deferred before any trial consumer dispatch', async t => {
  const trial = await fixture(t, []);
  await prepareTrial(trial);
  const checkpoint = await queueCheckpoint(trial.options.checkpointRoot);
  let nextCalls = 0;
  const report = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: trial.options.checkpointRoot }, {
    checkpoint, nextWorkItem: async () => { nextCalls += 1; return claimFor(scope.workItemId, 2); },
    acknowledgeWorkItem: () => assert.fail('no fake ACK'), blockWorkItem: () => assert.fail('no fake BLOCK'),
    consumeWorkItem: () => assert.fail('protected WI cannot dispatch'),
    readInitialStatus: () => assert.fail('guard precedes trial source/model/status paths'),
  });
  assert.equal(report.status, 'EXPLICIT_BUDGET_DEFERRED');
  assert.equal(report.leaseGeneration, 2);
  assert.equal(nextCalls, 1); // Host claim effects are explicit, not preclaim exclusion
  assert.equal(await checkpoint.readOptional('active-claim'), null);
  const budgetCheckpoint = await createCheckpointStore(join(trial.options.checkpointRoot,
    scope.workItemId, 'initial', 'EVALUATE_JOBAID'));
  assert.equal((await budgetCheckpoint.readOptional(report.preservedClaimStep)).leaseGeneration, 2);
  assert.equal(trial.requests.length, 0);
});

test('preseeded WI and operations cannot gain quota through missing flags or a new request suffix', async t => {
  const f = await fixture(t, []);
  const result = await prepareTrial(f);
  assert.equal(result.prepared.length, 2);
  await assert.rejects(consumeHostedWorkItem({ ...f.options, jobAidRunLimits: undefined }, {
    callTool: () => assert.fail('missing explicit limits must stop before Host'),
  }), /JOBAID_RUN_LIMIT_REQUIRED/u);
  f.initial.stages.jobAid.requestId = 'new-normal-request';
  await assert.rejects(f.run(), /JOBAID_RUN_LIMIT_SELECTION_CHANGED/u);
  await assert.rejects(runHostedInitialStage({ ...f.options, operation: 'SYNTHESIZE_OVERALL',
    expectedInitialOperation: 'SYNTHESIZE_OVERALL', jobAidRunLimits: { ...limits, modelRequests: 4 },
    initial: { ...f.initial, stages: { ...f.initial.stages, overall: { status: 'PENDING', requestId: 'another-request' } } } },
  f.dependencies), /JOBAID_RUN_LIMIT_SELECTION_CHANGED/u);
  assert.equal(f.requests.length, 0);
  assert.equal(f.calls.some(call => call.name.startsWith('begin_') || call.name.startsWith('commit_') ||
    call.name === 'save_assessment_work'), false);
  assert.deepEqual((await f.budget()).counts, { modelRequests: 0, saves: 0, finishes: 0 });
});

test('malformed protected budget fails closed and preserves the active claim without discovery or dispatch', async t => {
  const f = await fixture(t, []);
  await prepareTrial(f);
  const path = join(f.options.checkpointRoot, scope.workItemId, 'initial', 'EVALUATE_JOBAID', 'jobaid-run-budget.json');
  const bad = await f.budget(); bad.counts.saves = -1;
  await writeFile(path, JSON.stringify(bad));
  const original = storedClaim(scope.workItemId);
  const checkpoint = await queueCheckpoint(f.options.checkpointRoot, original);
  await assert.rejects(consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.options.checkpointRoot }, {
    checkpoint, nextWorkItem: () => assert.fail('bad guard cannot become unprotected'),
    acknowledgeWorkItem: () => assert.fail('no ACK'), blockWorkItem: () => assert.fail('no BLOCK'),
    consumeWorkItem: () => assert.fail('no dispatch'), readInitialStatus: () => assert.fail('no status'),
  }), /JOBAID_RUN_LIMIT_CHECKPOINT_CHANGED/u);
  assert.deepEqual(await checkpoint.readOptional('active-claim'), original);
  assert.equal(f.requests.length, 0);
});

test('a different unprotected prior UNKNOWN remains pinned and is never cleared by another WI budget', async t => {
  const f = await fixture(t, []);
  await prepareTrial(f);
  const original = storedClaim('WI-synthetic-unprotected', { consumerStopped: true,
    attentionCode: 'PROVIDER_UNKNOWN' });
  const checkpoint = await queueCheckpoint(f.options.checkpointRoot, original);
  const report = await consumeAutomaticWorkItemQueueTick({ checkpointRoot: f.options.checkpointRoot }, {
    checkpoint, nextWorkItem: () => assert.fail('old UNKNOWN stays pinned'),
    acknowledgeWorkItem: () => assert.fail('no ACK'), blockWorkItem: () => assert.fail('no BLOCK'),
    consumeWorkItem: () => assert.fail('no old task retry'),
    readInitialStatus: async () => ({ ...f.initial, workItemId: original.workItemId }),
  });
  assert.equal(report.status, 'REQUIRES_ATTENTION');
  assert.deepEqual(await checkpoint.readOptional('active-claim'), original);
  assert.equal(f.requests.length, 0);
});

test('relative checkpoint root retains cross-request protection through the actual consumer', async t => {
  const f = await fixture(t, ['UNKNOWN']);
  f.options.checkpointRoot = relative(process.cwd(), f.options.checkpointRoot);
  f.initial.stages.jobAid.requestId = 'relative-request-1';
  assert.equal((await f.run()).status, 'REQUIRES_ATTENTION');
  f.initial.stages.jobAid.requestId = 'relative-request-2';
  await assert.rejects(consumeHostedWorkItem({ ...f.options, jobAidRunLimits: undefined }, {
    callTool: () => assert.fail('same relative root cannot ignore its budget'),
  }), /JOBAID_RUN_LIMIT_REQUIRED/u);
  await assert.rejects(f.run(), /JOBAID_RUN_LIMIT_SELECTION_CHANGED/u);
  assert.equal(f.requests.length, 1);
  assert.equal(f.calls.filter(call => call.name === 'save_assessment_work').length, 0);
  assert.equal(f.calls.filter(call => call.name === 'commit_dynamic_evaluation_candidate').length, 0);
});

test('empty and padded checkpoint roots use the actual checkpoint store namespace for protection', async t => {
  for (const checkpointRoot of ['', ' .']) {
    const f = await fixture(t, ['UNKNOWN']);
    const previous = process.cwd();
    try {
      process.chdir(f.options.checkpointRoot);
      f.options.checkpointRoot = checkpointRoot;
      f.initial.stages.jobAid.requestId = 'request-1';
      assert.equal((await f.run()).status, 'REQUIRES_ATTENTION');
      f.initial.stages.jobAid.requestId = 'request-2';
      await assert.rejects(consumeHostedWorkItem({ ...f.options, jobAidRunLimits: undefined }, {
        callTool: () => assert.fail('filesystem-accepted root cannot hide its budget'),
      }), /JOBAID_RUN_LIMIT_REQUIRED/u);
      await assert.rejects(f.run(), /JOBAID_RUN_LIMIT_SELECTION_CHANGED/u);
      assert.equal(f.requests.length, 1);
    } finally { process.chdir(previous); }
  }
});
