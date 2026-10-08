import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { createHostedReviewRequester } from '../scripts/request-hosted-gateway.mjs';
import { invokeHostedDerivedSummaryModel } from '../scripts/invoke-hosted-derived-summary-model.mjs';
import {
  invokeHostedReviewModel, reviewCliModelOptions, runHostedReviewTurn,
  M3_MAX_COMPLETION_TOKENS, M3_PROBE_REVIEW_MAX_COMPLETION_TOKENS,
  createCheckpointStore, prepareKnownModelNonDispatchRecovery,
  summarizeHostedReviewModelOutputShape,
} from '../scripts/run-hosted-review-turn.mjs';
import { canonicalSha256 } from '../scripts/validate-payload.mjs';

const endpoint = 'https://official.invalid/v1/chat/completions';
const baseOptions = {
  gatewayUrl: endpoint, gatewayToken: 'fixture-only',
  configuredModelVersion: 'fixture/provider',
};
const modelSelection = (modelRef) => ({ modelRef, displayName: 'Fixture model',
  providerKind: 'BUILT_IN', settingsRevision: 2,
  selectedAt: '2026-09-06T00:00:00.000Z' });
const toolResponse = (name, args, id = 'fixture-call') => Response.json({
  choices: [{ message: { content: null, tool_calls: [{ id, type: 'function',
    function: { name, arguments: JSON.stringify(args) } }] } }],
});
const candidateResponse = (args = { answer: '已核对' }) =>
  toolResponse('return_wiselink_review_candidate', args);
const readResponse = (ids) => toolResponse('read_wiselink_review_sources',
  { sourceRefIds: ids });
const sourceInput = { input: {
  availableSourceRefIds: ['page1'], context: { purpose: 'UPDATE_ASSESSMENT',
    problemAssessment: { availableSources: [{ kind: 'DOCUMENT_PASSAGE',
      sourceRefId: 'page1' }] } },
} };

test('the explicit output cap reaches every GLM request; defaults and M3 ceilings remain', async () => {
  const bodies = [];
  const result = await invokeHostedReviewModel({ input: {
    context: { problemAssessment: {} }, availableSourceRefIds: ['page1'],
  } },
    { ...baseOptions, maxCompletionTokens: 8192, maxModelRequests: 2,
      executionModel: modelSelection('miaoda/glm-5.3'),
      registeredModelRefs: ['miaoda/glm-5.3'],
      readSourceRefs: async (ids) => ids.map((sourceRefId) => ({ sourceRefId,
        evidenceRef: sourceRefId, excerpt: 'Fixture passage.' })) },
    { requestGateway: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      assert.equal(init.headers['x-openclaw-model'], 'miaoda/glm-5.3');
      return bodies.length === 1 ? readResponse(['page1']) : candidateResponse();
    } });
  assert.equal(result.output.answer, '已核对');
  assert.deepEqual(bodies.map((body) => body.max_completion_tokens), [8192, 8192]);

  for (const [modelRef, expected] of [
    ['miaoda/minimax-m3', M3_MAX_COMPLETION_TOKENS],
    ['m3probe/minimax-m3', M3_PROBE_REVIEW_MAX_COMPLETION_TOKENS],
  ]) {
    let calls = 0;
    const options = { ...baseOptions, executionModel: modelSelection(modelRef),
      registeredModelRefs: [modelRef] };
    await invokeHostedReviewModel({ input: { context: { problemAssessment: {} } } },
      options, { requestGateway: async (_url, init) => {
        calls++;
        assert.equal(JSON.parse(init.body).max_completion_tokens, expected);
        return candidateResponse();
      } });
    assert.equal(calls, 1);
    await assert.rejects(invokeHostedReviewModel({ input: {} },
      { ...options, maxCompletionTokens: expected + 1 },
      { requestGateway: async () => assert.fail('must not dispatch') }),
    /REVIEW_MAX_COMPLETION_TOKENS_EXCEEDS_ROUTE_LIMIT/u);
    await invokeHostedReviewModel({ input: { context: { problemAssessment: {} } } },
      { ...options, maxCompletionTokens: 8192 },
      { requestGateway: async (_url, init) => {
        assert.equal(JSON.parse(init.body).max_completion_tokens, 8192);
        return candidateResponse();
      } });
  }
  await invokeHostedReviewModel({ input: { context: { problemAssessment: {} } } },
    baseOptions, { requestGateway: async (_url, init) => {
      assert.equal(Object.hasOwn(JSON.parse(init.body), 'max_completion_tokens'), false);
      return candidateResponse();
    } });
});

test('one request budget blocks transient HTTP and known preconnection replay before wait', async () => {
  for (const result of [Response.json({}, { status: 429 }),
    Response.json({}, { status: 502 }),
    new Error('connection refused', { cause: { code: 'ECONNREFUSED' } })]) {
    let calls = 0;
    let waits = 0;
    const requester = createHostedReviewRequester({ maxModelRequests: 1,
      observeProgress: async () => {},
      requestGateway: async () => {
        calls++;
        if (result instanceof Error) throw result;
        return result;
      },
      wait: async () => { waits++; } });
    await assert.rejects(requester(endpoint, { signal: new AbortController().signal }),
      /REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
    assert.equal(calls, 1);
    assert.equal(waits, 0);
  }
});

test('retry and later model rounds draw from one request budget', async () => {
  let calls = 0;
  const bodies = [];
  await assert.rejects(invokeHostedReviewModel({ input: { context: { problemAssessment: {} },
    availableSourceRefIds: ['page1'] } }, { ...baseOptions,
    maxCompletionTokens: 8192, maxModelRequests: 2,
    observeProgress: async () => {},
    readSourceRefs: async (ids) => ids.map((sourceRefId) => ({ sourceRefId,
      evidenceRef: sourceRefId, excerpt: 'Fixture passage.' })),
  }, { requestGateway: async (_url, init) => {
    calls++;
    bodies.push(JSON.parse(init.body));
    return calls === 1 ? Response.json({}, { status: 429 }) : readResponse(['page1']);
  }, wait: async () => {} }), /REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
  assert.equal(calls, 2);
  assert.deepEqual(bodies.map((body) => body.max_completion_tokens), [8192, 8192]);
});

test('source selection, candidate rejection and incomplete correction share the cap', async () => {
  let calls = 0;
  let reads = 0;
  await assert.rejects(invokeHostedReviewModel(sourceInput, {
    ...baseOptions, maxModelRequests: 1,
    readSourceRefs: async (ids) => {
      reads++;
      return ids.map((sourceRefId) => ({ sourceRefId,
        evidenceRef: sourceRefId, excerpt: 'Fixture passage.' }));
    },
  }, { requestGateway: async (_url, init) => {
    calls++;
    assert.deepEqual(JSON.parse(init.body).tools.map((tool) => tool.function.name),
      ['read_wiselink_review_sources']);
    return readResponse(['page1']);
  } }), /REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
  assert.equal(calls, 1);
  assert.equal(reads, 1);

  calls = 0;
  await assert.rejects(invokeHostedReviewModel({ input: { context: { problemAssessment: {} } } },
    { ...baseOptions, maxModelRequests: 1,
      validateCandidate: async () => { throw new Error('REVIEW_TEST_CANDIDATE_REJECTED'); } },
    { requestGateway: async () => { calls++; return candidateResponse(); } }),
  /REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(invokeHostedReviewModel(sourceInput, {
    ...baseOptions, maxModelRequests: 2,
    nativeSessionKey: 'agent:wiselink-engineering:review:ACTX-RS-budget-fixture',
    readSourceRefs: async (ids) => ids.map((sourceRefId) => ({ sourceRefId,
      evidenceRef: sourceRefId, excerpt: 'Fixture passage.' })),
  }, { requestGateway: async () => {
    calls++;
    return calls === 1 ? readResponse(['page1']) : Response.json({ error: {
      message: 'Agent run ended with an incomplete terminal response.',
    } }, { status: 400 });
  } }), /REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
  assert.equal(calls, 2);
});

test('API and CLI reject malformed limits before dispatch', async () => {
  const badApi = [null, '', 0, -1, 1.5, NaN, Infinity,
    Number.MAX_SAFE_INTEGER + 1, '8192'];
  for (const value of badApi) {
    for (const field of ['maxCompletionTokens', 'maxModelRequests']) {
      await assert.rejects(invokeHostedReviewModel({ input: {} },
        { ...baseOptions, [field]: value },
        { requestGateway: async () => assert.fail('must not dispatch') }),
      new RegExp(field === 'maxCompletionTokens'
        ? 'REVIEW_MAX_COMPLETION_TOKENS_INVALID' : 'REVIEW_MAX_MODEL_REQUESTS_INVALID', 'u'));
    }
  }
  for (const [flag, code] of [
    ['--max-completion-tokens', /REVIEW_MAX_COMPLETION_TOKENS_INVALID/u],
    ['--max-model-requests', /REVIEW_MAX_MODEL_REQUESTS_INVALID/u],
  ]) {
    for (const value of ['', '0', '-1', '1.5', 'NaN', '8192tail',
      String(Number.MAX_SAFE_INTEGER + 1)]) {
      assert.throws(() => reviewCliModelOptions({}, {}, [flag, value]), code);
    }
    assert.throws(() => reviewCliModelOptions({}, {}, [flag]), code);
    assert.throws(() => reviewCliModelOptions({}, {}, [flag, '--agent', 'fixture']), code);
    assert.throws(() => reviewCliModelOptions({}, {}, [flag, '1', flag, '2']), code);
    assert.throws(() => reviewCliModelOptions({}, {}, [`${flag}=1`]), code);
  }
  assert.deepEqual([
    reviewCliModelOptions({}, {}, ['--max-completion-tokens', '8192']).maxCompletionTokens,
    reviewCliModelOptions({}, {}, ['--max-model-requests', '3']).maxModelRequests,
  ], [8192, 3]);
  assert.equal(reviewCliModelOptions({}, {}, []).maxModelRequests, undefined);
  assert.deepEqual([reviewCliModelOptions({}, {
    maxCompletionTokens: 8192, maxModelRequests: 4,
  }, []).maxCompletionTokens, reviewCliModelOptions({}, {
    maxModelRequests: 4,
  }, []).maxModelRequests], [8192, 4]);

});

test('the Review driver passes API budgets to its model hook', async (t) => {
  const reviewTask = JSON.parse(await readFile(new URL('./fixtures/review-turn-task.c2.json',
    import.meta.url), 'utf8'));
  const sourceRefs = reviewTask.resourceRefs.map((source) => ({
    ref: source.resourceArtifactRef, sha256: source.resourceArtifactSha256,
  }));
  const unsealed = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-budget-fixture', operationRef: 'AQ-budget-fixture',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100,
    tenantId: 'tenant-control-plane',
    workItemId: reviewTask.context.workItem.workItemId,
    inputRevision: reviewTask.inputRevision, baseRevision: reviewTask.inputRevision,
    documentVersionId: reviewTask.context.workItem.documentVersionId,
    sourceRefs, allowedConnectors: [], hostResolvedMissingInputs: [],
    modelInput: reviewTask, deadline: '2026-08-27T12:00:00.000Z',
    idempotencyKey: 'fixture:budget-forwarding',
  };
  const task = { ...unsealed, inputHash: canonicalSha256(unsealed) };
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-review-budget-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  let modelCalls = 0;
  await assert.rejects(runHostedReviewTurn({
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId, checkpointDir,
    maxCompletionTokens: 8192, maxModelRequests: 2,
  }, {
    callTool: async (name) => {
      if (name === 'begin_review_turn') return {
        attemptRef: task.operationRef, status: 'RUNNING', task,
        leaseToken: 'fixture-token', leaseGeneration: 3,
        leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      };
      if (name === 'get_review_turn_context') return {
        schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
        attemptRef: task.operationRef,
        reviewConversationRef: reviewTask.reviewConversationRef,
        reviewTurnRef: reviewTask.reviewTurnRef,
        mode: 'INTERACTIVE_REVIEW',
        selectedEvaluationItemId: reviewTask.selectedEvaluationItemId,
        inputRevision: reviewTask.inputRevision,
        allowedOperations: reviewTask.allowedOperations,
        resourceRefs: reviewTask.resourceRefs.map((source) => ({
          sourceRefId: source.sourceRefId,
          resourceArtifactRef: source.resourceArtifactRef,
          resourceArtifactSha256: source.resourceArtifactSha256,
        })),
        context: reviewTask.context,
        executionPolicy: reviewTask.executionPolicy,
      };
      assert.fail(`unexpected Host tool ${name}`);
    },
    invokeModel: async (_input, hooks) => {
      modelCalls++;
      assert.deepEqual([hooks.maxCompletionTokens, hooks.maxModelRequests], [8192, 2]);
      throw new Error('FIXTURE_STOP_AFTER_HOOKS');
    },
  }), /FIXTURE_STOP_AFTER_HOOKS/u);
  assert.equal(modelCalls, 1);
});

test('pre-aborted and timed-out requests do not dispatch again', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const requester = createHostedReviewRequester({ maxModelRequests: 2,
    requestGateway: async () => { calls++; return Response.json({}, { status: 429 }); },
    observeProgress: async () => {}, wait: async () => assert.fail('must not wait') });
  await assert.rejects(requester(endpoint, { signal: controller.signal }));
  assert.equal(calls, 0);
  const timeout = new AbortController();
  const timedRequester = createHostedReviewRequester({ maxModelRequests: 2,
    observeProgress: async () => {},
    requestGateway: async () => {
      calls++;
      timeout.abort();
      return Response.json({}, { status: 429 });
    },
    wait: async () => assert.fail('must not wait') });
  await assert.rejects(timedRequester(endpoint, { signal: timeout.signal }));
  assert.equal(calls, 1);
});

test('observer cancellation is checked before dispatch and does not consume a request', async () => {
  const controller = new AbortController();
  let dispatches = 0, observations = 0;
  const requester = createHostedReviewRequester({ maxModelRequests: 1,
    observeProgress: async () => { if (++observations === 1) controller.abort(); },
    requestGateway: async () => { dispatches++; return Response.json({}); } });
  await assert.rejects(requester(endpoint, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(dispatches, 0);
  await requester(endpoint, { signal: new AbortController().signal });
  assert.equal(dispatches, 1);
  await assert.rejects(requester(endpoint, { signal: new AbortController().signal }),
    /REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
  assert.equal(observations, 2);
});

test('checkpoint equal-write preserves bytes and rejects changed or cross-process raced values', async (t) => {
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-equal-checkpoint-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const store = await createCheckpointStore(checkpointDir);
  await store.writeOnceOrEqual('same', { b: 2, a: 1 });
  const before = await readFile(join(checkpointDir, 'same.json'), 'utf8');
  await store.writeOnceOrEqual('same', { a: 1, b: 2 });
  assert.equal(await readFile(join(checkpointDir, 'same.json'), 'utf8'), before);
  await assert.rejects(store.writeOnceOrEqual('same', { a: 2, b: 2 }), /REVIEW_CHECKPOINT_VALUE_CHANGED:same/u);
  // The existing writeOnce temp name is per PID. This tests exclusive linking
  // between distinct processes; same-PID concurrent writes remain fail-closed.
  const writeFromChild = (name, value) => promisify(execFile)(process.execPath,
    ['--input-type=module', '--eval', `const [url, directory, step, value] = process.argv.slice(1);
      const { createCheckpointStore } = await import(url);
      await (await createCheckpointStore(directory)).writeOnceOrEqual(step, JSON.parse(value));`,
    new URL('../scripts/run-hosted-review-turn.mjs', import.meta.url).href,
    checkpointDir, name, JSON.stringify(value)], { timeout: 5000 });
  await Promise.all([writeFromChild('race-equal', { a: 1 }), writeFromChild('race-equal', { a: 1 })]);
  const outcomes = await Promise.allSettled([writeFromChild('race-different', { a: 1 }),
    writeFromChild('race-different', { a: 2 })]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(x => x.status === 'rejected').reason.message,
    /REVIEW_CHECKPOINT_VALUE_CHANGED:race-different/u);
});

test('known non-dispatch recovery keeps original observations and creates recovery observations', async (t) => {
  const reviewTask = JSON.parse(await readFile(new URL('./fixtures/review-turn-task.c2.json', import.meta.url), 'utf8'));
  const unsealed = { schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: 'ATT-recovery-budget', operationRef: 'AQ-recovery-budget',
    taskType: 'OPENCLAW_INTERACTIVE_REVIEW', priority: 100, tenantId: 'tenant-control-plane',
    workItemId: reviewTask.context.workItem.workItemId,
    inputRevision: reviewTask.inputRevision, baseRevision: reviewTask.inputRevision,
    documentVersionId: reviewTask.context.workItem.documentVersionId,
    sourceRefs: reviewTask.resourceRefs.map(r => ({ ref: r.resourceArtifactRef, sha256: r.resourceArtifactSha256 })),
    allowedConnectors: [], hostResolvedMissingInputs: [], modelInput: reviewTask,
    deadline: '2099-01-01T00:00:00.000Z', idempotencyKey: 'fixture:recovery-budget' };
  const task = { ...unsealed, inputHash: canonicalSha256(unsealed) };
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-observation-recovery-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const counts = new Map();
  const callTool = async (name, args) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (name === 'begin_review_turn') return { attemptRef: task.operationRef, status: 'RUNNING', task,
      leaseToken: 'fixture-lease', leaseGeneration: 3, leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    if (name === 'get_review_turn_context') return {
      schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2', attemptRef: task.operationRef,
      reviewConversationRef: reviewTask.reviewConversationRef, reviewTurnRef: reviewTask.reviewTurnRef,
      mode: 'INTERACTIVE_REVIEW', selectedEvaluationItemId: reviewTask.selectedEvaluationItemId,
      inputRevision: reviewTask.inputRevision, allowedOperations: reviewTask.allowedOperations,
      resourceRefs: reviewTask.resourceRefs.map(({sourceRefId,resourceArtifactRef,resourceArtifactSha256}) =>
        ({sourceRefId,resourceArtifactRef,resourceArtifactSha256})), context: reviewTask.context,
      executionPolicy: reviewTask.executionPolicy };
    if (name === 'read_source_refs') return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
      attemptRef: task.operationRef, sourceRefs: args.sourceRefIds.map(sourceRefId =>
        ({sourceRefId, kind: 'page', statement: 'Synthetic source.'})) };
    if (name === 'heartbeat_action_attempt') return { leaseExpiresAt: '2099-01-01T00:00:00.000Z' };
    assert.fail(`Unexpected tool ${name}`);
  };
  const options = { reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId, checkpointDir, maxModelRequests: 2 };
  const observe = async (hooks) => {
    await hooks.readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
    await hooks.observeProgress({kind:'MODEL_REQUEST',requestNo:1,retryNo:0,delayMs:0,errorCode:null});
    await hooks.observeCandidateRejection({modelRound:1,correctionNo:1,errorCode:'REVIEW_TEST_REJECTED'});
    await hooks.observeOutputShape(summarizeHostedReviewModelOutputShape({httpStatus:404,httpOk:false,payload:null}));
  };
  const failureCode = 'REVIEW_GATEWAY_INVALID_JSON_HTTP_404';
  await assert.rejects(runHostedReviewTurn(options, {callTool,invokeModel:async (_input,hooks) => {
    await observe(hooks);throw new Error(failureCode);
  }}), new RegExp(failureCode, 'u'));
  const names = ['runtime-progress-1', 'candidate-rejection-1', 'model.output-shape'];
  const original = await Promise.all(names.map(n => readFile(join(checkpointDir,n+'.json'),'utf8')));
  const evidencePath = join(checkpointDir,'failure.log');
  await writeFile(evidencePath,`${failureCode}\nFIRST_RUN_EXIT=1\n`,{mode:0o600});
  await prepareKnownModelNonDispatchRecovery({checkpointDir,failureCode,evidencePath});
  await assert.rejects(runHostedReviewTurn(options,{callTool,invokeModel:async (_input,hooks) => {
    await observe(hooks);throw new Error('FIXTURE_STOP_AFTER_RECOVERY_OBSERVATIONS');
  }}), /FIXTURE_STOP_AFTER_RECOVERY_OBSERVATIONS/u);
  for (const [i,name] of names.entries()) {
    assert.equal(await readFile(join(checkpointDir,name+'.json'),'utf8'),original[i]);
    assert.ok(JSON.parse(await readFile(join(checkpointDir,name+'-recovery.json'),'utf8')));
  }
  await assert.rejects(runHostedReviewTurn(options,{callTool,invokeModel:async () => assert.fail('No unknown-outcome replay')}),
    /REVIEW_MODEL_OUTCOME_UNKNOWN/u);
  assert.equal(counts.get('begin_review_turn'),1);
  assert.equal(counts.get('get_review_turn_context'),1);
  assert.equal(counts.get('read_source_refs'),1);
  assert.equal(counts.get('heartbeat_action_attempt'),2);
  assert.equal(counts.get('commit_review_turn_candidate'),undefined);
});

test('the unchanged summary caller enforces its request cap before transient replay', async (t) => {
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/derived-summary-r1-sealed.json', import.meta.url),'utf8'));
  const task = JSON.parse(fixtures.groups.find(g => g.name === 'legacy').variants[0].taskEnvelopeJson);
  const checkpointDir = await mkdtemp(join(tmpdir(),'wiselink-summary-cap-'));
  t.after(() => rm(checkpointDir,{recursive:true,force:true}));
  const checkpoint = await createCheckpointStore(checkpointDir);
  let calls=0, waits=0, closes=0, providerReceipt;
  const runBudget = {timeoutMs:60000,maxCompletionTokens:8192,maxModelRequests:1,reasoningEffort:'low'};
  await assert.rejects(invokeHostedDerivedSummaryModel(task.modelInput, {
    checkpoint, executionModel:task.executionModel, registeredModelRefs:[task.executionModel.modelRef],
    gatewayChatCompletionsEnabled:true, gatewayUrl:endpoint, gatewayToken:'fixture-only',
    sessionDiscriminator:'fixture-summary-budget', deadlineAt:task.deadlineAt,
    attemptRef:task.operationRef,summaryId:task.subject.summaryId,runBudget,
    heartbeat:async () => {}, readMembers:async () => assert.fail('No model member read'),
    readSources:async () => assert.fail('No model source read'),
    prepareGateway:async binding => {
      providerReceipt={attemptRef:binding.attemptRef,modelId:'glm-5.3',
        maxCompletionTokens:binding.maxCompletionTokens,maxModelRequests:binding.maxModelRequests,
        absoluteDeadline:binding.deadlineAt,expectedReasoningEffort:'low',observedReasoningEffort:null,
        observedThinkingMode:null,dispatches:[],upstreamDispatchCount:0,activeOrdinal:null,
        unknownTerminal:false,upstreamHttpStatus:null,transportCompleted:false,providerStopConfirmed:false,
        outcome:'CREATED',finishedAt:null};
      return {gatewayUrl:endpoint,gatewayToken:'fixture-ephemeral',
        getSanitizedReceipt:() => structuredClone(providerReceipt),
        close:async () => {closes++;providerReceipt.tempSecretScan={complete:true,found:false};}};
    },
  }, {requestGateway:async () => {
    calls++;providerReceipt.dispatches.push({ordinal:calls,upstreamHttpStatus:429,
      actualCompletionTokens:8192,transportCompleted:true,providerKnownTerminal:true,
      finishReason:null,outcome:'HTTP_REJECTED'});
    Object.assign(providerReceipt,{upstreamDispatchCount:calls,upstreamHttpStatus:429,
      transportCompleted:true,providerStopConfirmed:true,outcome:'HTTP_REJECTED'});
    return Response.json({}, {status:429});
  },wait:async () => {waits++;}}),/REVIEW_MODEL_REQUEST_BUDGET_EXHAUSTED/u);
  assert.equal(calls,1);assert.equal(waits,0);assert.equal(closes,1);
});
