import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { bindWholeDocumentTranslation, invokeHostedInitialModel as invokeInitialWithTransport } from '../scripts/invoke-hosted-initial-model.mjs';
import { requestHostedGateway } from '../scripts/request-hosted-gateway.mjs';

import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_MODEL_POLICY_REF,
  WISELINK_APPLICABILITY_PROMPT_VERSION,
  WISELINK_SKILL_COMPATIBILITY_REF,
  WISELINK_SKILL_VERSION,
  buildApplicabilityCandidate,
  canonicalSha256,
  reviewCandidateArtifactRefs,
  sealResultEnvelope,
  validateApplicabilityModelInput,
  validatePayload,
  validateReviewCandidate,
} from '../scripts/validate-payload.mjs';
import {
  CONFIGURATION_EVIDENCE_REEVALUATION_STATUS_SCHEMA,
  HOST_MCP_TOOLS,
  INITIAL_ANALYSIS_OPERATIONS,
  INTERACTIVE_REVIEW_TOOLS,
  commitTranslationPayloadFile,
  parseConfigurationEvidenceReevaluationStatus,
  runConfigurationEvidenceReevaluation,
  runDynamicEvaluation,
  runApplicabilityEvaluation,
  runInitialAnalysis,
  runInteractiveReviewTurn,
  runOverallSynthesis,
  runTranslation,
  summarizeQueryParsedPackage,
} from '../scripts/orchestrate-host-mcp.mjs';
import {
  assertHostedModelGatewayReady,
  createCheckpointStore,
  executionModelHeaders,
  findMcpConfig,
  invokeHostedReviewModel as invokeReviewWithTransport,
  isChatCompletionsEnabled,
  openClawConfigCandidates,
  prepareKnownModelNonDispatchRecovery,
  readHostMcpJsonResult,
  resolveConfiguredModelVersion,
  runHostedReviewTurn,
  summarizeHostedReviewModelOutputShape,
} from '../scripts/run-hosted-review-turn.mjs';

// Protocol tests explicitly inject their synthetic response transport. The
// production transport is exercised against a local HTTP server below.
const fakeGateway = { requestGateway: (...args) => globalThis.fetch(...args) };
const invokeHostedInitialModel = (input, options) => invokeInitialWithTransport(input, options, fakeGateway);
const invokeHostedReviewModel = (input, options) => invokeReviewWithTransport(input, options, fakeGateway);

test('retains a bounded Host rejection code without exposing the MCP error body or replaying a commit', async (t) => {
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-review-host-error-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const checkpoint = await createCheckpointStore(checkpointDir);
  let calls = 0;
  const step = () => checkpoint.remoteStep({
    step: 'commit', args: { leaseToken: 'fixture-secret-token' }, ambiguousCommit: true,
    perform: () => {
      calls++;
      return readHostMcpJsonResult({ isError: true, content: [{ type: 'text',
        text: 'OVERALL_UNKNOWN_EVIDENCE_REF:fixture-secret-token',
      }] }, 'commit_review_turn_candidate');
    },
  });
  await assert.rejects(step(), (error) => {
    assert.equal(error.hostErrorCode, 'OVERALL_UNKNOWN_EVIDENCE_REF');
    assert.equal(error.receivedHostToolError, true);
    assert.equal(error.message.includes('fixture-secret-token'), false);
    return true;
  });
  const saved = await readFile(join(checkpointDir, 'commit.error.json'), 'utf8');
  assert.equal(saved.includes('fixture-secret-token'), false);
  assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(saved)).filter(([key]) =>
    ['hostErrorCode', 'receivedHostToolError', 'outcome'].includes(key))), {
    hostErrorCode: 'OVERALL_UNKNOWN_EVIDENCE_REF', receivedHostToolError: true, outcome: 'UNKNOWN',
  });
  assert.equal((await stat(join(checkpointDir, 'commit.error.json'))).mode & 0o777, 0o600);
  await assert.rejects(step(), /REVIEW_COMMIT_OUTCOME_UNKNOWN/u);
  assert.equal(calls, 1);
  for (const text of ['private-url fixture-secret-token', 'OVERALL_' + 'A'.repeat(200)]) {
    assert.throws(() => readHostMcpJsonResult({ isError: true, content: [{ type: 'text', text }] }, 'commit_review_turn_candidate'),
      (error) => error.hostErrorCode === null && !error.message.includes('fixture-secret-token'));
  }
  assert.deepEqual(readHostMcpJsonResult({ content: [{ type: 'text', text: '{"status":"SUCCEEDED"}' }] }, 'get_action_attempt_status'), { status: 'SUCCEEDED' });
});

test('Review transient HTTP failures retry twice in the same native turn and expose each retry', async () => {
  for (const httpStatus of [429, 502, 503, 504]) {
    const requests = [];
    const progress = [];
    const waits = [];
    const result = await invokeReviewWithTransport({ input: {} }, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only',
      configuredModelVersion: 'fixture/provider',
      nativeSessionKey: 'agent:wiselink-engineering:review:ACTX-RS-transient',
      observeProgress: async (value) => { progress.push(value); },
    }, {
      wait: async (ms) => { waits.push(ms); },
      requestGateway: async (_url, init) => {
        requests.push({ headers: init.headers, body: init.body });
        if (requests.length < 3) return Response.json({ error: 'temporarily unavailable' }, { status: httpStatus });
        return Response.json({ model: 'fixture/provider', choices: [{ message: { content: null, tool_calls: [{
          type: 'function', function: { name: 'return_wiselink_review_candidate', arguments: '{"answer":"候选答复"}' },
        }] } }] });
      },
    });
    assert.equal(result.output.answer, '候选答复');
    assert.equal(requests.length, 3);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(requests[1], requests[2]);
    assert.deepEqual(waits, [1000, 3000]);
    assert.deepEqual(progress.map(({ kind, retryNo }) => [kind, retryNo]), [
      ['MODEL_REQUEST', 0], ['MODEL_RETRY', 1], ['MODEL_REQUEST', 1], ['MODEL_RETRY', 2], ['MODEL_REQUEST', 2],
    ]);
  }
});

test('Review stops after its retry budget and cannot retry after losing its Host lease', async () => {
  for (const loseLease of [false, true]) {
    let calls = 0;
    const result = invokeReviewWithTransport({ input: {} }, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
      observeProgress: async ({ kind }) => {
        if (loseLease && kind === 'MODEL_RETRY') throw new Error('ACTION_ATTEMPT_LEASE_EXPIRED');
      },
    }, {
      wait: async () => {},
      requestGateway: async () => { calls++; return Response.json({}, { status: 503 }); },
    });
    await assert.rejects(result, loseLease ? /ACTION_ATTEMPT_LEASE_EXPIRED/u : /REVIEW_GATEWAY_HTTP_503/u);
    assert.equal(calls, loseLease ? 1 : 3);
  }
});

test('Review does not retry authorization, input, missing endpoint or ambiguous transport failures', async () => {
  for (const failure of [400, 401, 403, 404, 'ECONNRESET', 'ETIMEDOUT']) {
    let calls = 0;
    const progress = [];
    const result = invokeReviewWithTransport({ input: {} }, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
      observeProgress: async (value) => { progress.push(value); },
    }, {
      wait: () => assert.fail('must not delay or retry this failure'),
      requestGateway: async () => {
        calls++;
        if (typeof failure === 'number') return Response.json({}, { status: failure });
        throw new Error('HOSTED_GATEWAY_REQUEST_FAILED', { cause: Object.assign(new Error('network failure'), { code: failure }) });
      },
    });
    await assert.rejects(result);
    assert.equal(calls, 1);
    assert.equal(progress.length, 1);
  }
});

const DYNAMIC_FIXTURE_URL = new URL(
  './fixtures/dynamic-rules-evaluation-737.input.json',
  import.meta.url,
);
const REVIEW_TASK_FIXTURE_URL = new URL(
  './fixtures/review-turn-task.c2.json',
  import.meta.url,
);
const REVIEW_ATTACHMENT_TASK_FIXTURE_URL = new URL(
  './fixtures/review-turn-task-attachment.c2.json',
  import.meta.url,
);
const REVIEW_CANDIDATE_FIXTURE_URL = new URL(
  './fixtures/review-turn-candidate.c3.json',
  import.meta.url,
);
const APPLICABILITY_TASK_FIXTURE_URL = new URL(
  './fixtures/applicability-task.c4.json',
  import.meta.url,
);
const APPLICABILITY_AST_FIXTURE_URL = new URL(
  './fixtures/applicability-ast-candidate.c4.json',
  import.meta.url,
);
const CONFIGURATION_REEVALUATION_FIXTURE_URL = new URL(
  './fixtures/configuration-evidence-reevaluation-status.p0b.json',
  import.meta.url,
);
const PACKAGED_VERSION_DECLARATIONS = [
  [new URL('../SKILL.md', import.meta.url), 'full'],
  [new URL('../agents/openai.yaml', import.meta.url), 'suffix'],
  [new URL('../references/hosted-uat-runbook.md', import.meta.url), 'full'],
  [new URL('../references/input-output.md', import.meta.url), 'full'],
];

const ARTIFACT_REF = 'artifact://fixture/frozen-package';
const ARTIFACT_SHA = 'b'.repeat(64);
const LEASE_TOKEN = '9bc7de9d-1e86-4c12-8e78-e27cce3aa0d4';
const WORK_ITEM_ID = 'WI-CONTROL-001';

async function localGateway(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('Initial and Review use the bounded production HTTP transport with their original routing and payload', async (t) => {
  let calls = 0;
  const gatewayUrl = await localGateway(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    assert.equal(Number(req.headers['content-length']), body.length);
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fixture-only');
    assert.equal(req.headers['x-openclaw-model'], 'miaoda/minimax-m3');
    const input = JSON.parse(body.toString('utf8'));
    assert.equal(input.model, 'openclaw/wiselink-engineering');
    assert.equal(input.stream, false);
    const review = calls++ === 1;
    if (review) assert.equal(req.headers['x-openclaw-session-key'], 'agent:wiselink-engineering:review:ACTX-RS-local');
    else assert.deepEqual(JSON.parse(input.messages[1].content), translationInput());
    setTimeout(() => res.end(JSON.stringify({ choices: [{ message: {
      content: null, tool_calls: [{ type: 'function', function: {
        name: review ? 'return_wiselink_review_candidate' : 'return_wiselink_initial_candidate',
        arguments: JSON.stringify(review ? { candidateOnly: true } : {
          candidate: { translatedUnits: [[0, '保持 28 VDC 和 ATA 24。']] },
        }),
      } }],
    } }] })), 30);
  });
  const options = { gatewayUrl, gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'local', timeoutMs: 2000,
    executionModel: modelSelection('miaoda/minimax-m3'), registeredModelRefs: ['miaoda/minimax-m3'] };
  const initial = await invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: translationInput() }, options);
  assert.equal(initial.output.candidateUnits[0].text, '保持 28 VDC 和 ATA 24。');
  const review = await invokeReviewWithTransport({ candidateOnly: true }, {
    ...options, nativeSessionKey: 'agent:wiselink-engineering:review:ACTX-RS-local',
  });
  assert.deepEqual(review.output, { candidateOnly: true });
  assert.equal(calls, 2);
});

for (const stage of ['headers', 'body']) {
  test(`Gateway operation deadline interrupts waiting for ${stage} without replay`, async (t) => {
    let calls = 0;
    let closed = 0;
    const gatewayUrl = await localGateway(t, (req, res) => {
      calls++;
      req.resume();
      res.once('close', () => closed++);
      if (stage === 'body') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{');
      }
    });
    const options = { gatewayUrl, gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'timeout', timeoutMs: 70 };
    await assert.rejects(invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: translationInput() }, options),
      /INITIAL_MODEL_TIMEOUT/u);
    await assert.rejects(invokeReviewWithTransport({ candidateOnly: true }, options), /REVIEW_MODEL_TIMEOUT/u);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 2);
    assert.equal(closed, 2);
  });
}

test('Gateway transport stops oversized or interrupted bodies before a candidate can be returned', async (t) => {
  let calls = 0;
  const gatewayUrl = await localGateway(t, (req, res) => {
    req.resume();
    if (calls++ === 0) res.end(Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    else {
      res.writeHead(200, { 'content-length': 100 });
      res.write('{');
      setImmediate(() => res.socket.destroy());
    }
  });
  const options = { gatewayUrl, gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'bounded', timeoutMs: 2000 };
  await assert.rejects(invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: translationInput() }, options),
    /INITIAL_GATEWAY_RESPONSE_TOO_LARGE/u);
  await assert.rejects(invokeReviewWithTransport({ candidateOnly: true }, options), /HOSTED_GATEWAY_RESPONSE_INTERRUPTED/u);
  assert.equal(calls, 2);
});

test('Gateway transport never follows redirects, retries failures, or dispatches an already aborted request', async (t) => {
  let calls = 0;
  const gatewayUrl = await localGateway(t, (req, res) => {
    calls++;
    req.resume();
    res.writeHead(302, { location: '/must-not-receive-credentials' });
    res.end('{}');
  });
  const init = { method: 'POST', headers: { authorization: 'Bearer fixture-only' }, body: '{}', signal: AbortSignal.timeout(2000) };
  const response = await requestHostedGateway(new URL('/v1/chat/completions', gatewayUrl), init);
  assert.equal(response.status, 302);
  assert.equal(response.ok, false);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(requestHostedGateway(gatewayUrl, { ...init, signal: abort.signal }), { name: 'AbortError' });
  await assert.rejects(requestHostedGateway('file:///tmp/unused', init), /HOSTED_GATEWAY_HTTP_URL_INVALID/u);
  await assert.rejects(requestHostedGateway('http://user:password@127.0.0.1/', init), /HOSTED_GATEWAY_HTTP_URL_INVALID/u);
  assert.equal(calls, 1);
});

function modelSelection(modelRef) {
  return { modelRef, displayName: modelRef.startsWith('dli/') ? 'GPT 5.6 Sol' : 'MiniMax-M3',
    providerKind: modelRef.startsWith('dli/') ? 'CUSTOM' : 'BUILT_IN', settingsRevision: 2, selectedAt: '2026-09-06T00:00:00.000Z' };
}

test('routes both registered models for Initial and Review without changing profile or reporting the old default', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const modelRef of ['miaoda/minimax-m3', 'dli/gpt-5.6-sol']) {
    const runtime = {
      gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'routing-fixture',
      executionModel: modelSelection(modelRef), registeredModelRefs: ['miaoda/minimax-m3', 'dli/gpt-5.6-sol'],
    };
    let review = false;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(init.headers['x-openclaw-model'], modelRef);
      assert.equal(body.model, 'openclaw/wiselink-engineering');
      assert.equal(JSON.stringify(body.messages).includes('settingsRevision'), false);
      assert.equal(body.max_completion_tokens,
        modelRef === 'miaoda/minimax-m3' ? 524_288 : undefined);
      if (review) assert.equal(init.headers['x-openclaw-session-key'], 'agent:wiselink-engineering:review:ACTX-RS-fixture');
      return Response.json({ model: 'openclaw/wiselink-engineering', choices: [{ message: {
        content: null, tool_calls: [{ type: 'function', function: {
          name: review ? 'return_wiselink_review_candidate' : 'return_wiselink_initial_candidate',
          arguments: JSON.stringify(review ? { candidateOnly: true } : { candidate: { translatedUnits: [[0, '保持 28 VDC 和 ATA 24。']] } }),
        } }],
      } }] });
    };
    const initial = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: translationInput() }, runtime);
    assert.equal(initial.provenance.modelVersion, `configured-route:${modelRef}`);
    review = true;
    const result = await invokeHostedReviewModel({ candidateOnly: true }, { ...runtime, nativeSessionKey: 'agent:wiselink-engineering:review:ACTX-RS-fixture' });
    assert.equal(result.provenance.modelVersion, `configured-route:${modelRef}`);
  }
});

test('selected model cannot inject headers, carry credentials, or silently use an unregistered route', () => {
  assert.deepEqual(executionModelHeaders({}), {});
  assert.throws(() => executionModelHeaders({ executionModel: modelSelection('dli/gpt-5.6-sol'), registeredModelRefs: ['miaoda/minimax-m3'] }), /HOSTED_SELECTED_MODEL_NOT_REGISTERED/u);
  assert.throws(() => executionModelHeaders({ executionModel: modelSelection('dli/gpt-5.6-sol\r\nx-header: changed'), registeredModelRefs: [] }));
  const task = makeTask('OPENCLAW_TRANSLATE', translationInput());
  task.executionModel = modelSelection('dli/gpt-5.6-sol');
  assert.throws(() => validatePayload('task-envelope', task), /TASK_ENVELOPE_INPUT_HASH_MISMATCH/u);
  const { inputHash: _hash, ...unsealed } = task;
  task.inputHash = canonicalSha256(unsealed);
  validatePayload('task-envelope', task);
  const [part] = translationDeliveryParts(task, task.modelInput);
  assert.equal(part.taskBinding.executionModel.modelRef, 'dli/gpt-5.6-sol');
  task.executionModel.apiKey = 'fixture-only';
  assert.throws(() => validatePayload('task-envelope', task));
});

test('M3 JobAid has a bounded output budget and preserves the complete criterion input and output', async () => {
  const modelInput = await readJson(DYNAMIC_FIXTURE_URL);
  const candidate = buildDynamicRulesOutput(modelInput);
  for (const modelRef of ['miaoda/minimax-m3', 'dli/gpt-5.6-sol']) {
    let calls = 0;
    const observed = [];
    const result = await invokeInitialWithTransport({ operation: 'EVALUATE_JOBAID', modelInput }, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'job-aid-budget-fixture',
      executionModel: modelSelection(modelRef), registeredModelRefs: ['miaoda/minimax-m3', 'dli/gpt-5.6-sol'],
      observeModelOutput: (value) => observed.push(value),
    }, {
      requestGateway: async (_url, init) => {
        calls += 1;
        const request = JSON.parse(init.body);
        assert.equal(init.headers['x-openclaw-model'], modelRef);
        assert.equal(request.max_completion_tokens, modelRef === 'miaoda/minimax-m3' ? 524_288 : undefined);
        assert.deepEqual(JSON.parse(request.messages[1].content), modelInput);
        return Response.json({ model: 'openclaw/wiselink-engineering', choices: [{ message: {
          content: null,
          tool_calls: [{ type: 'function', function: {
            name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidateJson: JSON.stringify(candidate) }),
          } }],
        } }] });
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result.output, candidate);
    assert.equal(observed[0].requestedMaxCompletionTokens, modelRef === 'miaoda/minimax-m3' ? 524_288 : null);
    assert.equal(result.provenance.modelVersion, `configured-route:${modelRef}`);
  }
});

test('JobAid JSON transport preserves null and column arrays and corrects rejected candidates in the original session', async () => {
  const modelInput = await readJson(DYNAMIC_FIXTURE_URL);
  const expected = buildDynamicRulesOutput(modelInput);
  const rejected = structuredClone(expected);
  rejected.engineeringConclusion = 'null';
  let calls = 0;
  let heartbeats = 0;
  const receipts = [];
  const result = await invokeInitialWithTransport({ operation: 'EVALUATE_JOBAID', modelInput }, {
    gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'job-aid-json-fixture',
    executionModel: modelSelection('miaoda/minimax-m3'), registeredModelRefs: ['miaoda/minimax-m3'],
    heartbeat: () => { heartbeats += 1; }, observeCandidateRejection: (value) => receipts.push(value),
  }, {
    requestGateway: async (_url, init) => {
      calls += 1;
      const request = JSON.parse(init.body);
      assert.equal(request.user, 'initial:job-aid-json-fixture');
      assert.equal(init.headers['x-openclaw-model'], 'miaoda/minimax-m3');
      assert.deepEqual(request.tools[0].function.parameters.required, ['candidateJson']);
      assert.equal(request.tools[0].function.parameters.properties.candidateJson.type, 'string');
      if (calls === 1) assert.deepEqual(JSON.parse(request.messages[1].content), modelInput);
      else {
        assert.equal(request.messages[1].tool_calls[0].id, 'jobaid-call-1');
        const feedback = JSON.parse(request.messages[2].content);
        assert.equal(feedback.candidateAccepted, false);
        assert.equal(feedback.validationError, 'DYNAMIC_RULES_ENGINEERING_CONCLUSION_FORBIDDEN');
      }
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{
        id: `jobaid-call-${calls}`, type: 'function', function: {
          name: 'return_wiselink_initial_candidate',
          arguments: JSON.stringify({ candidateJson: JSON.stringify(calls === 1 ? rejected : expected) }),
        },
      }] } }] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(heartbeats, 2);
  assert.equal(receipts.length, 1);
  assert.deepEqual(result.output, expected);
  assert.equal(rejected.engineeringConclusion, 'null');
  assert.equal(result.output.engineeringConclusion, null);
  assert.ok(Array.isArray(result.output.ruleResults.columns));
});

test('JobAid returns indexed row-budget errors to the same model without truncating rows', async () => {
  const modelInput = await readJson(DYNAMIC_FIXTURE_URL);
  const expected = buildDynamicRulesOutput(modelInput);
  const rejected = structuredClone(expected);
  rejected.ruleResults.rows[2][4] = '超长分析'.repeat(modelInput.responseInstruction.ruleResultsEncoding.maxRowUtf8Bytes);
  const originalRow = structuredClone(rejected.ruleResults.rows[2]);
  let calls = 0;
  const receipts = [];
  const result = await invokeInitialWithTransport({ operation: 'EVALUATE_JOBAID', modelInput }, {
    gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
    configuredModelVersion: 'dli/gpt-5.6-sol', sessionDiscriminator: 'indexed-row-budget',
    executionModel: modelSelection('dli/gpt-5.6-sol'), registeredModelRefs: ['dli/gpt-5.6-sol'],
    observeCandidateRejection: (receipt) => receipts.push(receipt),
  }, { requestGateway: async (_url, init) => {
    const request = JSON.parse(init.body);
    calls += 1;
    assert.equal(request.user, 'initial:indexed-row-budget');
    assert.match(request.messages[0].content, /UTF-8 byte length/u);
    if (calls === 2) {
      const feedback = JSON.parse(request.messages[2].content);
      assert.equal(feedback.validationError, 'DYNAMIC_RULES_RULE_RESULT_ROW_BUDGET_EXCEEDED:2');
      assert.match(feedback.instruction, /every row/u);
      assert.equal(request.messages[1].tool_calls[0].id, 'row-budget-1');
    }
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{
      id: `row-budget-${calls}`, type: 'function', function: {
        name: 'return_wiselink_initial_candidate',
        arguments: JSON.stringify({ candidateJson: JSON.stringify(calls === 1 ? rejected : expected) }),
      },
    }] } }] });
  } });
  assert.equal(calls, 2);
  assert.equal(receipts[0].errorCode, 'DYNAMIC_RULES_RULE_RESULT_ROW_BUDGET_EXCEEDED:2');
  assert.deepEqual(rejected.ruleResults.rows[2], originalRow);
  assert.deepEqual(result.output, expected);
});

test('JobAid never repairs invalid output and stops after two model corrections or a failed lease renewal', async () => {
  const modelInput = await readJson(DYNAMIC_FIXTURE_URL);
  const candidate = buildDynamicRulesOutput(modelInput);
  candidate.engineeringConclusion = 'null';
  for (const leaseFails of [false, true]) {
    let calls = 0;
    let heartbeats = 0;
    await assert.rejects(invokeInitialWithTransport({ operation: 'EVALUATE_JOBAID', modelInput }, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', gatewayChatCompletionsEnabled: true,
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'job-aid-rejection-fixture',
      executionModel: modelSelection('miaoda/minimax-m3'), registeredModelRefs: ['miaoda/minimax-m3'],
      heartbeat: () => { if (++heartbeats === 2 && leaseFails) throw new Error('HOST_LEASE_LOST'); },
    }, { requestGateway: async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{
        id: `invalid-${calls}`, type: 'function', function: {
          name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidateJson: JSON.stringify(candidate) }),
        },
      }] } }] });
    } }), leaseFails ? /HOST_LEASE_LOST/ : /DYNAMIC_RULES_ENGINEERING_CONCLUSION_FORBIDDEN/);
    assert.equal(calls, leaseFails ? 1 : 3);
    assert.equal(candidate.engineeringConclusion, 'null');
  }
});

test('official initial model adapter validates all four operation outputs without sending control bindings', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const dynamic = await readJson(DYNAMIC_FIXTURE_URL);
  const synthesis = synthesisInput();
  const examples = [
    ['TRANSLATE', translationInput(), translationOutput()],
    ['EXTRACT_APPLICABILITY', await readJson(APPLICABILITY_TASK_FIXTURE_URL), await readJson(APPLICABILITY_AST_FIXTURE_URL)],
    ['EVALUATE_JOBAID', dynamic, buildDynamicRulesOutput(dynamic)],
    ['SYNTHESIZE_OVERALL', synthesis, synthesisOutput(synthesis)],
  ];
  for (const [operation, modelInput, candidate] of examples) {
    const generated = operation === 'TRANSLATE'
      ? { translatedUnits: candidate.candidateUnits.map(({ text }, index) => [index, text]) }
      : candidate;
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
      calls += 1;
      const request = JSON.parse(init.body);
      assert.equal(request.model, 'openclaw/wiselink-engineering');
      assert.equal(request.user, 'initial:control-session-only');
      assert.equal(request.max_completion_tokens, 524_288);
      assert.deepEqual(JSON.parse(request.messages[1].content), modelInput);
      assert.equal(JSON.stringify(request.messages).includes('control-session-only'), false);
      return new Response(JSON.stringify({ model: 'actual-official-model', choices: [{ message: {
        role: 'assistant', content: null,
        tool_calls: [{ type: 'function', function: { name: 'return_wiselink_initial_candidate', arguments: JSON.stringify(operation === 'EVALUATE_JOBAID' ? { candidateJson: JSON.stringify(generated) } : { candidate: generated }) } }],
      } }] }), { status: 200 });
    };
    const result = await invokeHostedInitialModel({ operation, modelInput }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'control-session-only',
      executionModel: modelSelection('miaoda/minimax-m3'), registeredModelRefs: ['miaoda/minimax-m3'],
    });
    assert.deepEqual(result.output, candidate);
    assert.equal(result.provenance.modelVersion, 'actual-official-model');
    assert.equal(result.provenance.skillVersion, WISELINK_SKILL_VERSION);
    assert.equal(calls, 1);
  }
});

test('initial model rejects prose-only, unsupported content, analysis, ambiguous calls and altered translation', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const runtime = { gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only', configuredModelVersion: 'miaoda/miaoda-model-auto', sessionDiscriminator: 'isolated' };
  for (const malformed of ['prose-only', 'content-array', 'analysis', 'duplicate-call', 'numeric']) {
    const candidate = translationOutput();
    if (malformed === 'numeric') candidate.candidateUnits[0].text = '保持 29 VDC 和 ATA 24。';
    const generated = { translatedUnits: candidate.candidateUnits.map(({ text }, index) => [index, text]) };
    const toolCall = { type: 'function', function: { name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: generated }) } };
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
      content: malformed === 'prose-only' ? JSON.stringify({ candidate: generated }) : malformed === 'content-array' ? [] : null,
      ...(malformed === 'analysis' ? { reasoning_content: 'DO-NOT-RETAIN' } : {}),
      tool_calls: malformed === 'prose-only' ? [] : malformed === 'duplicate-call' ? [toolCall, toolCall] : [toolCall],
    } }] }), { status: 200 });
    await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: translationInput() }, runtime));
  }
});

test('initial translation consumes only strict tool arguments and discards Gateway companion text', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits = [0, 1].map((index) => ({ ...input.sourceUnits[0], unitKey: `commentary-unit-${index}` }));
  const companion = 'COMPANION-TEXT-NOT-CANDIDATE'.padEnd(99, '.');
  const observations = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(JSON.stringify(request.messages).includes(companion), false);
    const index = calls++;
    return Response.json({ choices: [{ message: {
      content: index === 0 ? companion : null,
      tool_calls: [{ id: `commentary-call-${index}`, type: 'function', function: {
        name: 'return_wiselink_initial_candidate',
        arguments: JSON.stringify({ candidate: { translatedUnits: [{ index, text: '保持 28 VDC 和 ATA 24。' }] } }),
      } }],
    } }] });
  };
  const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'commentary-fixture',
    observeModelOutput: (shape) => observations.push(shape),
  });
  assert.equal(calls, 2);
  assert.equal(result.output.candidateUnits.length, 2);
  assert.deepEqual(result.output.candidateUnits.map((unit) => unit.unitKey), input.sourceUnits.map((unit) => unit.unitKey));
  assert.equal(observations[0].outputChannel, 'FUNCTION_ARGUMENTS_WITH_COMMENTARY');
  assert.equal(observations[0].assistantContent.byteLength, 99);
  assert.equal(observations[0].toolCall.count, 1);
  assert.equal(observations[0].toolCall.nameMatched, true);
  assert.equal(observations[0].hasAnalysis, false);
  assert.equal(JSON.stringify({ result, observations }).includes(companion), false);
});

test('long translation renews before each round, shares one 45-minute budget and honors a shorter timeout', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  for (const scenario of [
    { units: 3, elapsed: 12 * 60_000, succeeds: true, calls: 3 },
    { units: 5, elapsed: 12 * 60_000, succeeds: false, calls: 4 },
    { units: 5, elapsed: 12 * 60_000, timeoutMs: 60 * 60_000, succeeds: false, calls: 4 },
    { units: 2, elapsed: 9 * 60_000, timeoutMs: 480_000, succeeds: false, calls: 1 },
  ]) {
    now = 1_000;
    let calls = 0;
    const renewals = [];
    const input = translationInput();
    input.sourceUnits = Array.from({ length: scenario.units }, (_, index) => ({ ...input.sourceUnits[0], unitKey: `budget-unit-${index}` }));
    globalThis.fetch = async () => {
      assert.equal(renewals.length, calls + 1, 'renew the same lease before every response, including continuation');
      const index = calls++;
      now += scenario.elapsed;
      return Response.json({ choices: [{ message: {
        content: null, tool_calls: [{ id: `budget-call-${index}`, type: 'function', function: {
          name: 'return_wiselink_initial_candidate',
          arguments: JSON.stringify({ candidate: { translatedUnits: [{ index, text: '保持 28 VDC 和 ATA 24。' }] } }),
        } }],
      } }] });
    };
    const invoke = () => invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'budget-fixture', timeoutMs: scenario.timeoutMs,
      heartbeat: async () => { renewals.push(now); },
    });
    if (scenario.succeeds) {
      assert.equal((await invoke()).output.candidateUnits.length, scenario.units);
    } else {
      await assert.rejects(invoke(), /INITIAL_MODEL_TIMEOUT/u);
    }
    assert.equal(calls, scenario.calls);
    assert.equal(renewals.length, scenario.calls);
  }
});

test('lost translation lease prevents the next model response and any complete candidate', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits.push({ ...input.sourceUnits[0], unitKey: 'lease-unit-1' });
  let calls = 0;
  let renewals = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{
      id: 'lease-call-0', type: 'function', function: {
        name: 'return_wiselink_initial_candidate',
        arguments: JSON.stringify({ candidate: { translatedUnits: [{ index: 0, text: '保持 28 VDC 和 ATA 24。' }] } }),
      },
    }] } }] });
  };
  await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'dli/gpt-5.6-sol', sessionDiscriminator: 'lease-fixture',
    heartbeat: async () => { if (++renewals === 2) throw new Error('ACTION_ATTEMPT_LEASE_LOST'); },
  }), /ACTION_ATTEMPT_LEASE_LOST/u);
  assert.equal(calls, 1);
  assert.equal(renewals, 2);
});

test('translation aborts identify the response limit or total budget without a model replay', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const budgets = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds) => {
    budgets.push(milliseconds);
    const controller = new AbortController();
    controller.abort(new DOMException('expired', 'TimeoutError'));
    return controller.signal;
  });
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; throw init.signal.reason; };
  for (const [timeoutMs, code] of [[undefined, 'INITIAL_MODEL_RESPONSE_TIMEOUT'], [500, 'INITIAL_MODEL_TIMEOUT']]) {
    await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: translationInput() }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'dli/gpt-5.6-sol', sessionDiscriminator: 'abort-fixture', timeoutMs,
    }), new RegExp(code, 'u'));
  }
  assert.equal(budgets[0], 15 * 60_000);
  assert.ok(budgets[1] <= 500 && budgets[1] > 0);
  assert.equal(calls, 2);
});

test('whole-document translation keeps all 503 input units in one native session with bounded output windows', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits = Array.from({ length: 503 }, (_, index) => ({
    ...input.sourceUnits[0], unitKey: `unit-${index}`, sourceRefIds: [`source-${index}`],
  }));
  const generated = { translatedUnits: input.sourceUnits.map((_, index) => [index, '保持 28 VDC 和 ATA 24。']) };
  let calls = 0;
  const observations = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (calls === 0) assert.deepEqual(JSON.parse(request.messages[1].content), input);
    else assert.equal(JSON.stringify(request.messages).includes('sourceUnits\":['), false);
    assert.equal(request.user, 'initial:whole-document');
    const { translationOutputWindow: window } = JSON.parse(request.messages[2].content);
    assert.equal(window.startUnitIndex, calls * 96);
    assert.equal(window.endUnitIndexExclusive, Math.min((calls + 1) * 96, input.sourceUnits.length));
    assert.equal(window.totalUnitCount, input.sourceUnits.length);
    assert.ok(window.sourceCharacters <= 6000);
    assert.match(request.messages[0].content, /one whole-document translation/u);
    assert.match(request.messages[0].content, /stop before endUnitIndexExclusive/u);
    calls += 1;
    return new Response(JSON.stringify({ model: 'actual-official-model', usage: { prompt_tokens: 10000, completion_tokens: 5000 }, choices: [{ finish_reason: 'tool_calls', message: {
      content: null, tool_calls: [{ id: `translation-window-${calls}`, type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: {
          translatedUnits: generated.translatedUnits.slice(window.startUnitIndex, window.endUnitIndexExclusive),
        } }),
      } }],
    } }] }), { status: 200 });
  };
  const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/miaoda-model-auto', sessionDiscriminator: 'whole-document',
    observeModelOutput: async (value) => { observations.push(value); },
  });
  assert.equal(calls, 6);
  assert.equal(result.output.candidateUnits.length, 503);
  for (const [index, unit] of result.output.candidateUnits.entries()) {
    assert.equal(unit.unitKey, input.sourceUnits[index].unitKey);
    assert.deepEqual(unit.sourceRefIds, input.sourceUnits[index].sourceRefIds);
    assert.equal(unit.text, generated.translatedUnits[index][1]);
  }
  assert.equal(observations.length, 6);
  assert.equal(observations[0].inputTokens, 10000);
  assert.equal(observations[0].outputTokens, 5000);
  assert.equal(observations.at(-1).translationOutputWindow.endUnitIndexExclusive, 503);
  assert.equal(JSON.stringify(observations).includes('保持'), false);
  assert.equal(JSON.stringify(observations).includes('test-only'), false);
});

test('translation output work budget uses source length without cutting a long Host unit', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits = [7000, 3500, 3500, 100].map((length, index) => ({
    ...input.sourceUnits[0], unitKey: `unit-${index}`, sourceRefIds: [`source-${index}`],
    text: `${'Context sentence. '.repeat(Math.ceil(length / 18)).slice(0, length)} ${input.sourceUnits[0].text}`,
  }));
  const ranges = [];
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (!ranges.length) assert.deepEqual(JSON.parse(request.messages[1].content), input);
    const { translationOutputWindow: window } = JSON.parse(request.messages[2].content);
    ranges.push([window.startUnitIndex, window.endUnitIndexExclusive]);
    return Response.json({ choices: [{ message: {
      content: null, tool_calls: [{ id: `window-${ranges.length}`, type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: {
          translatedUnits: input.sourceUnits.slice(window.startUnitIndex, window.endUnitIndexExclusive)
            .map((unit, index) => [window.startUnitIndex + index, unit.text]),
        } }),
      } }],
    } }] });
  };
  const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'long-units',
  });
  assert.deepEqual(ranges, [[0, 1], [1, 2], [2, 4]]);
  assert.deepEqual(result.output.candidateUnits.map((unit) => unit.text), input.sourceUnits.map((unit) => unit.text));
});

test('translation corrects only rejected units in the same full-document session and selected model', async (t) => {
  const input = translationInput();
  input.rulePack.terms = [{ ruleId: 'term.airplane', sourceTerm: 'airplane', targetRenderings: ['飞机'], severity: 'mandatory' }];
  input.sourceUnits = [
    'Issue 001, 24 Sep 2020',
    'Effectivity for the list of affected airplanes.',
    'Retain paragraph 10.',
    'No special tools are necessary.',
  ].map((text, index) => ({ ...input.sourceUnits[0], text, unitKey: 'unit-' + index, sourceRefIds: ['source-' + index] }));
  const unchangedInput = structuredClone(input);
  for (const modelRef of ['miaoda/minimax-m3', 'dli/gpt-5.6-sol']) {
    let calls = 0;
    const observations = [];
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.equal(request.user, 'initial:correction-session');
      assert.equal(init.headers['x-openclaw-model'], modelRef);
      assert.equal(request.max_completion_tokens,
        modelRef === 'miaoda/minimax-m3' ? 524_288 : undefined);
      let rows;
      if (calls === 0) {
        assert.deepEqual(JSON.parse(request.messages[1].content), input);
        rows = [[0, '第001版，2020年9月24日'], [1, '适用性。'], [2, '保留第10段。'], [3, '无需专用工具，参见第20段。']];
      } else {
        assert.equal(request.messages.length, 3);
        const feedback = JSON.parse(request.messages[2].content);
        assert.equal(feedback.status, 'CORRECT_TRANSLATION_UNITS');
        assert.deepEqual(feedback.unitIndices, [1, 3]);
        assert.equal(feedback.rejectedUnits[0].sourceText, input.sourceUnits[1].text);
        assert.equal(feedback.rejectedUnits[1].sourceText, input.sourceUnits[3].text);
        const shape = request.tools[0].function.parameters.properties.candidate.properties.translatedUnits;
        assert.deepEqual(shape.items.properties.index.enum, [1, 3]);
        assert.equal(shape.minItems, 2);
        assert.equal(JSON.stringify(request.messages).includes('sourceUnits":['), false);
        rows = [[1, '受影响飞机清单的适用性。'], [3, '无需专用工具。']];
      }
      calls += 1;
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{
        id: 'correction-' + calls, type: 'function', function: {
          name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: { translatedUnits: rows } }),
        },
      }] } }] });
    };
    const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: modelRef, sessionDiscriminator: 'correction-session',
      executionModel: modelSelection(modelRef), registeredModelRefs: [modelRef],
      observeModelOutput: async (value) => observations.push(value),
    });
    assert.equal(calls, 2);
    assert.equal(result.provenance.modelVersion, 'configured-route:' + modelRef);
    assert.deepEqual(result.output.candidateUnits.map((unit) => unit.text), [
      '第001版，2020年9月24日', '受影响飞机清单的适用性。', '保留第10段。', '无需专用工具。',
    ]);
    assert.deepEqual(input, unchangedInput);
    assert.deepEqual(result.output.candidateUnits.map((unit) => unit.sourceRefIds), input.sourceUnits.map((unit) => unit.sourceRefIds));
    assert.deepEqual(observations[1].translationCorrection, { round: 1, unitIndices: [1, 3] });
    assert.equal(JSON.stringify(observations).includes('受影响'), false);
    globalThis.fetch = originalFetch;
  }
});

test('translation corrections stop after two unsuccessful replacements or an out-of-scope index', async (t) => {
  for (const outOfScope of [false, true]) {
    const input = translationInput();
    let calls = 0;
    const reports = [];
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{
        id: 'bad-' + calls, type: 'function', function: {
          name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({
            candidate: { translatedUnits: [[outOfScope && calls > 1 ? 1 : 0, '保持 29 VDC 和 ATA 24。']] },
          }),
        },
      }] } }] });
    };
    await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'bounded-correction',
      observeTranslationFidelity: (report, round) => { reports.push({ report, round }); },
    }), outOfScope ? /INITIAL_TRANSLATION_CORRECTION_MAPPING_INVALID/u : /TRANSLATION_RULE_PREFLIGHT_REJECTED.*"correctionRounds":2/u);
    assert.equal(calls, outOfScope ? 2 : 3);
    assert.equal(reports.length, outOfScope ? 1 : 3);
    assert.equal(reports.at(-1).report.correctionRound, outOfScope ? 0 : 2);
    assert.equal(reports[0].report.checkedUnitCount, 1);
    assert.ok(reports[0].report.findings.some((finding) => finding.code === 'NUMBER_NOT_PRESERVED' && finding.unitIndex === 0));
    assert.equal(JSON.stringify(reports).includes(input.sourceUnits[0].text), false);
    assert.equal(JSON.stringify(reports).includes('保持 29 VDC 和 ATA 24。'), false);
    globalThis.fetch = originalFetch;
  }
});

test('translation resolves a converging seven-unit token shift in one 437-unit session before returning the full candidate', async () => {
  for (const failFinalWindow of [false, true]) {
    const { input, translations, shifted, otherWindowIndices } = shiftedTranslationFixture();
    const unchangedInput = structuredClone(input);
    const reports = [];
    const residualRequests = [];
    const windows = [];
    const previous = new Map();
    let calls = 0;
    let fourthWindowCorrections = 0;
    const requestGateway = async (_url, init) => {
      const request = JSON.parse(init.body);
      const feedback = JSON.parse(request.messages[2].content);
      const window = feedback.translationOutputWindow;
      assert.equal(request.user, 'initial:shifted-437');
      assert.equal(request.max_completion_tokens, 524_288);
      if (calls === 0) assert.deepEqual(JSON.parse(request.messages[1].content), unchangedInput);
      else assert.equal(JSON.stringify(request.messages).includes('sourceUnits\":['), false);
      calls += 1;
      let rows;
      if (feedback.status === 'CORRECT_TRANSLATION_UNITS') {
        for (const unit of feedback.rejectedUnits) {
          assert.equal(unit.sourceText, input.sourceUnits[unit.index].text);
          assert.equal(unit.previousTranslation, previous.get(unit.index));
        }
        if (feedback.correctionMode === 'SINGLE_UNIT_RETRANSLATION') {
          const [index] = feedback.unitIndices;
          residualRequests.push([index, feedback.unitAttempt]);
          assert.equal(feedback.unitIndices.length, 1);
          assert.equal(feedback.rejectedUnits.length, 1);
          const schema = request.tools[0].function.parameters.properties.candidate.properties.translatedUnits;
          assert.deepEqual(schema.items.properties.index.enum, [index]);
          assert.equal(schema.minItems, 1);
          assert.equal(schema.maxItems, 1);
          assert.match(feedback.instruction, /Retranslate the single requested index completely/u);
          // The first complete replacement still lacks 9/E991; a decreasing
          // per-unit finding count permits its one remaining retranslation.
          rows = [[index, index === 364 && feedback.unitAttempt === 1
            ? '参见相应段落和连接器。' : translations[index]]];
        } else if (window.startUnitIndex === 276) {
          fourthWindowCorrections += 1;
          rows = feedback.unitIndices.map((index) => [index, shifted.get(index) ?? translations[index]]);
          if (fourthWindowCorrections === 1) rows = rows.map(([index, text]) => {
            const offset = otherWindowIndices.indexOf(index);
            return [index, offset >= 0 && offset < 12
              ? text + ' 参见 901、902、903' + (offset < 11 ? '、904。' : '。') : text];
          });
        } else {
          assert.equal(window.startUnitIndex, 192);
          rows = feedback.unitIndices.map((index) => [index, translations[index]]);
        }
      } else {
        windows.push(window.startUnitIndex);
        if (window.startUnitIndex === 372 && failFinalWindow) {
          return Response.json({ error: { code: 'incomplete_result' } }, { status: 400 });
        }
        const end = window.startUnitIndex === 192 ? 276 : window.endUnitIndexExclusive;
        rows = translations.slice(window.startUnitIndex, end).map((text, offset) => {
          const index = window.startUnitIndex + offset;
          if (window.startUnitIndex === 192 && offset < 43) text += ' 参见 901、902 和 903。';
          if (window.startUnitIndex === 276) {
            text = shifted.get(index) ?? text;
            const otherOffset = otherWindowIndices.indexOf(index);
            if (otherOffset >= 0 && otherOffset < 71) {
              text += ' 参见 901、902、903' + (otherOffset < 15 ? '、904。' : '。');
            }
          }
          return [index, text];
        });
      }
      for (const [index, text] of rows) previous.set(index, text);
      return translationModelResponse(rows, 'shifted-' + calls);
    };
    const invocation = invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'shifted-437',
      executionModel: modelSelection('miaoda/minimax-m3'), registeredModelRefs: ['miaoda/minimax-m3'],
      observeTranslationFidelity: (report) => { reports.push(report); },
    }, { requestGateway });
    if (failFinalWindow) await assert.rejects(invocation, /INITIAL_GATEWAY_HTTP_400/u);
    else {
      const result = await invocation;
      assert.equal(result.output.candidateUnits.length, 437);
      assert.deepEqual(result.output.candidateUnits.map((unit) => unit.text), translations);
      assert.deepEqual(result.output.candidateUnits.map((unit) => unit.sourceRefIds), input.sourceUnits.map((unit) => unit.sourceRefIds));
      assert.deepEqual(result.output.taskStartBinding, input.taskStartBinding);
      assert.ok(result.output.candidateUnits.every((unit, index) => unit.text !== input.sourceUnits[index].text));
    }
    assert.deepEqual(input, unchangedInput);
    assert.equal(calls, 16);
    assert.deepEqual(windows, [0, 96, 192, 276, 372]);
    assert.deepEqual(reports.filter((report) => report.translationOutputWindow.startUnitIndex === 192)
      .map((report) => report.findingCount), [129, 0]);
    const fourth = reports.filter((report) => report.translationOutputWindow.startUnitIndex === 276);
    assert.deepEqual(fourth.slice(0, 3).map((report) => report.findingCount), [243, 62, 15]);
    assert.deepEqual(fourth.slice(0, 3).map((report) => new Set(report.findings.map((finding) => finding.unitIndex)).size), [78, 19, 7]);
    assert.ok(fourth[2].findings.some((finding) => finding.unitIndex === 366 && finding.code === 'TERM_MANDATORY_MISSING'));
    assert.deepEqual(residualRequests, [[288, 1], [289, 1], [363, 1], [364, 1], [364, 2], [366, 1], [369, 1], [371, 1]]);
    assert.equal(fourth.at(-1).findingCount, 0);
    assert.ok(fourth.slice(3).every((report) => report.correctionMode === 'SINGLE_UNIT_RETRANSLATION'));
    assert.equal(JSON.stringify(reports).includes('参见相应段落和连接器'), false);
    assert.equal(JSON.stringify(reports).includes(input.sourceUnits[364].text), false);
  }
});

test('translation residual correction rejects stalled, worse, exhausted or out-of-scope replacements', async () => {
  for (const scenario of [
    { name: 'stalled', rows: [[[0, '保留 1、2。']]], error: 'RESIDUAL_UNIT_NOT_IMPROVING', calls: 4 },
    { name: 'worse', rows: [[[0, '保留 1。']]], error: 'RESIDUAL_UNIT_NOT_IMPROVING', calls: 4 },
    { name: 'exhausted', rows: [[[0, '保留 1、2、3。']], [[0, '保留 1、2、3、4。']]], error: 'RESIDUAL_UNIT_ATTEMPTS_EXHAUSTED', calls: 5 },
    { name: 'wrong index', rows: [[[1, '保留 1、2、3、4、5、6 和 7。']]], error: 'INITIAL_TRANSLATION_CORRECTION_MAPPING_INVALID', calls: 4 },
    { name: 'extra index', rows: [[[0, '保留 1、2、3、4、5、6 和 7。'], [1, '额外译文。']]], error: 'INITIAL_TRANSLATION_CORRECTION_MAPPING_INVALID', calls: 4 },
  ]) {
    const input = residualTranslationFixture();
    const reports = [];
    let calls = 0;
    await assert.rejects(invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'bounded-residual',
      observeTranslationFidelity: (report) => { reports.push(report); },
    }, { requestGateway: async (_url, init) => {
      const feedback = JSON.parse(JSON.parse(init.body).messages[2].content);
      const stage = calls++;
      if (stage >= 3) {
        assert.equal(feedback.correctionMode, 'SINGLE_UNIT_RETRANSLATION');
        assert.deepEqual(feedback.unitIndices, [0]);
        assert.equal(feedback.unitAttempt, stage - 2);
      }
      const rows = stage < 3 ? [[0, ['保留所列数值。', '保留 1。', '保留 1、2。'][stage]]]
        : scenario.rows[stage - 3];
      return translationModelResponse(rows, 'residual-' + calls);
    } }), new RegExp(scenario.error, 'u'), scenario.name);
    assert.equal(calls, scenario.calls, scenario.name);
    if (scenario.name === 'exhausted') assert.deepEqual(reports.map((report) => report.findingCount), [7, 6, 5, 4, 3]);
  }
});

test('translation residual correction requires both batch rounds to converge and at most eight failed units', async () => {
  for (const scenario of [
    { name: 'first batch stalled', texts: ['保留所列数值。', '保留所列数值。', '保留 1。'], unitCount: 1, error: 'BATCH_CORRECTIONS_NOT_CONVERGING' },
    { name: 'first batch worsened', texts: ['保留 1、2。', '保留 1。', '保留 1、2、3、4、5 和 6。'], unitCount: 1, error: 'BATCH_CORRECTIONS_NOT_CONVERGING' },
    { name: 'too many residuals', texts: ['保留所列数值。', '保留 1。', '保留 1、2。'], unitCount: 9, error: 'RESIDUAL_UNIT_LIMIT_EXCEEDED' },
  ]) {
    const input = residualTranslationFixture(scenario.unitCount);
    let calls = 0;
    await assert.rejects(invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'residual-entry-bound',
    }, { requestGateway: async () => {
      const text = scenario.texts[calls++];
      return translationModelResponse(input.sourceUnits.map((_, index) => [index, text]), 'entry-' + calls);
    } }), new RegExp(scenario.error, 'u'), scenario.name);
    assert.equal(calls, 3, scenario.name);
  }
});

test('translation residual correction permits at most sixteen single-unit responses for eight residual units', async () => {
  const input = residualTranslationFixture(8);
  const complete = '保留 1、2、3、4、5、6 和 7。';
  const residualRequests = [];
  let calls = 0;
  const result = await invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'eight-residuals',
  }, { requestGateway: async (_url, init) => {
    const feedback = JSON.parse(JSON.parse(init.body).messages[2].content);
    const stage = calls++;
    let rows;
    if (stage < 3) {
      rows = input.sourceUnits.map((_, index) => [index, ['保留所列数值。', '保留 1。', '保留 1、2。'][stage]]);
    } else {
      assert.equal(feedback.correctionMode, 'SINGLE_UNIT_RETRANSLATION');
      assert.equal(feedback.unitIndices.length, 1);
      const [index] = feedback.unitIndices;
      residualRequests.push([index, feedback.unitAttempt]);
      rows = [[index, feedback.unitAttempt === 1 ? '保留 1、2、3、4、5 和 6。' : complete]];
    }
    return translationModelResponse(rows, 'eight-' + calls);
  } });
  assert.equal(calls, 19);
  assert.deepEqual(residualRequests, input.sourceUnits.flatMap((_, index) => [[index, 1], [index, 2]]));
  assert.deepEqual(result.output.candidateUnits.map((unit) => unit.text), Array(8).fill(complete));
});

test('translation residual correction retains the original 45-minute total and 15-minute response budgets', async (t) => {
  let now = 1000;
  const budgets = [];
  t.mock.method(Date, 'now', () => now);
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  let calls = 0;
  let heartbeats = 0;
  await assert.rejects(invokeInitialWithTransport({ operation: 'TRANSLATE', modelInput: residualTranslationFixture() }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'residual-timeout',
    heartbeat: () => { heartbeats += 1; },
  }, { requestGateway: async (_url, init) => {
    const stage = calls++;
    if (stage === 3) {
      const feedback = JSON.parse(JSON.parse(init.body).messages[2].content);
      assert.equal(feedback.correctionMode, 'SINGLE_UNIT_RETRANSLATION');
      assert.equal(feedback.unitAttempt, 1);
    }
    now += (stage === 3 ? 15 : 10) * 60_000;
    return translationModelResponse([[0, ['保留所列数值。', '保留 1。', '保留 1、2。', '保留 1、2、3。'][stage]]], 'budget-' + calls);
  } }), /INITIAL_MODEL_TIMEOUT/u);
  assert.equal(calls, 4);
  assert.equal(heartbeats, 4);
  assert.deepEqual(budgets, Array(4).fill(15 * 60_000));
});

test('corrected short output prefix continues from its real end without rewriting completed units', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits.push({ ...input.sourceUnits[0], unitKey: 'second-unit', sourceRefIds: ['second-ref'] });
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    if (calls === 2) {
      const feedback = JSON.parse(request.messages[2].content);
      assert.equal(feedback.status, 'CONTINUE_TRANSLATION');
      assert.equal(feedback.nextUnitIndex, 1);
    }
    const row = calls === 0 ? [0, '保持 29 VDC 和 ATA 24。']
      : [calls === 1 ? 0 : 1, '保持 28 VDC 和 ATA 24。'];
    calls += 1;
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{
      id: 'prefix-' + calls, type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: { translatedUnits: [row] } }),
      },
    }] } }] });
  };
  const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'prefix-correction',
  });
  assert.equal(calls, 3);
  assert.equal(result.output.candidateUnits.length, 2);
});

test('translation correction consumes the original timeout budget', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    now += 600;
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{
      id: 'timed-correction', type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: { translatedUnits: [[0, '保持 29 VDC 和 ATA 24。']] } }),
      },
    }] } }] });
  };
  await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: translationInput() }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'timed-correction', timeoutMs: 500,
  }), /INITIAL_MODEL_TIMEOUT/u);
  assert.equal(calls, 1);
});

test('a failed translation window is not retried and cannot return an incomplete candidate', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits.push({ ...input.sourceUnits[0], unitKey: 'unit-1', sourceRefIds: ['source-1'] });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 2) return Response.json({ error: { code: 'incomplete_result' } }, { status: 400 });
    return Response.json({ choices: [{ message: {
      content: null, tool_calls: [{ id: 'first-prefix', type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: {
          translatedUnits: [[0, '保持 28 VDC 和 ATA 24。']],
        } }),
      } }],
    } }] });
  };
  await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'failed-window',
  }), /INITIAL_GATEWAY_HTTP_400/u);
  assert.equal(calls, 2);
});

test('translation continues only an output prefix in the same full-document native session', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits = [0, 1, 2].map((index) => ({
    ...input.sourceUnits[0], unitKey: `unit-${index}`, sourceRefIds: [`source-${index}`],
  }));
  const observations = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.equal(request.user, 'initial:whole-continuation');
    assert.equal(init.headers['x-openclaw-model'], 'miaoda/minimax-m3');
    if (calls === 0) {
      assert.deepEqual(JSON.parse(request.messages[1].content), input);
    } else {
      assert.equal(request.messages[1].role, 'assistant');
      assert.equal(request.messages[1].tool_calls[0].id, 'translation-prefix');
      assert.equal(JSON.parse(request.messages[2].content).nextUnitIndex, 1);
      assert.equal(request.messages[2].tool_call_id, 'translation-prefix');
      assert.match(request.messages[0].content, /same native session/u);
      // Native history contains the FULL original input, not an isolated subset.
      assert.equal(JSON.stringify(request.messages).includes('sourceUnits\":['), false);
    }
    const rows = calls++ === 0 ? [[0, '保持 28 VDC 和 ATA 24。']]
      : [[1, '保持 28 VDC 和 ATA 24。'], [2, '保持 28 VDC 和 ATA 24。']];
    return new Response(JSON.stringify({ model: 'miaoda/minimax-m3', choices: [{ message: {
      content: null, tool_calls: [{ id: 'translation-prefix', type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: { translatedUnits: rows } }),
      } }],
    } }] }), { status: 200 });
  };
  const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'whole-continuation',
    executionModel: modelSelection('miaoda/minimax-m3'), registeredModelRefs: ['miaoda/minimax-m3'],
    observeModelOutput: (shape, round) => { observations.push([shape.round, round]); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(observations, [[1, 1], [2, 2]]);
  assert.deepEqual(result.output.candidateUnits.map((unit) => unit.unitKey), ['unit-0', 'unit-1', 'unit-2']);
  assert.equal(result.provenance.modelVersion, 'miaoda/minimax-m3');
});

test('translation rejects a continuation that repeats or skips accepted indices', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const wrongIndex of [0, 2]) {
    const input = translationInput();
    input.sourceUnits.push({ ...input.sourceUnits[0], unitKey: 'unit-1', sourceRefIds: ['source-1'] });
    let calls = 0;
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
      content: null, tool_calls: [{ id: 'prefix', type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: {
          translatedUnits: [[calls++ === 0 ? 0 : wrongIndex, '保持 28 VDC 和 ATA 24。']],
        } }),
      } }],
    } }] }), { status: 200 });
    await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
      gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
      configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'invalid-continuation',
    }), /INITIAL_TRANSLATION_UNIT_MAPPING_INVALID/u);
    assert.equal(calls, 2);
  }
});

test('translation binding rejects missing, reordered, duplicate and invented unit indices', () => {
  const input = translationInput();
  for (const candidate of [
    { translatedUnits: [] }, { translatedUnits: [[1, '译文']] },
    { translatedUnits: [[0, '译文'], [0, '译文']] },
    { translatedUnits: [[0, '译文']], sourceRefIds: ['invented'] },
  ]) assert.throws(() => bindWholeDocumentTranslation(input, candidate), /INITIAL_TRANSLATION_(?:UNIT_|CANDIDATE_SHAPE)/u);
});

test('translation consumes the observed M3 item/index/text wire form without changing text or bindings', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const input = translationInput();
  input.sourceUnits = Array.from({ length: 137 }, (_, index) => ({
    ...input.sourceUnits[0], unitKey: `unit-${index}`, sourceRefIds: [`source-${index}`],
  }));
  const observations = [];
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    const window = JSON.parse(request.messages[2].content).translationOutputWindow;
    const schema = request.tools[0].function.parameters.properties.candidate;
    assert.deepEqual(schema.required, ['translatedUnits']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.translatedUnits.type, 'array');
    assert.equal(schema.properties.translatedUnits.maxItems, window.endUnitIndexExclusive - window.startUnitIndex);
    assert.deepEqual(schema.properties.translatedUnits.items.required, ['index', 'text']);
    assert.equal(schema.properties.translatedUnits.items.additionalProperties, false);
    assert.equal(schema.properties.translatedUnits.items.properties.index.type, 'integer');
    assert.equal(schema.properties.translatedUnits.items.properties.index.minimum, window.startUnitIndex);
    assert.equal(schema.properties.translatedUnits.items.properties.index.maximum, window.endUnitIndexExclusive - 1);
    if (calls === 0) assert.deepEqual(JSON.parse(request.messages[1].content), input);
    else assert.equal(JSON.stringify(request.messages).includes('sourceUnits\":['), false);
    calls += 1;
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
      content: null, tool_calls: [{ id: `m3-wire-${calls}`, type: 'function', function: {
        name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate: {
          translatedUnits: { item: input.sourceUnits.slice(window.startUnitIndex, window.endUnitIndexExclusive)
            .map((unit, index) => ({ index: String(window.startUnitIndex + index), text: unit.text })) },
        } }),
      } }],
    } }] });
  };
  const result = await invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: input }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/minimax-m3', sessionDiscriminator: 'm3-wire-shape',
    observeModelOutput: (shape) => { observations.push(shape); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(result.output.candidateUnits.map((unit) => [unit.unitKey, unit.text, unit.sourceRefIds]),
    input.sourceUnits.map((unit) => [unit.unitKey, unit.text, unit.sourceRefIds]));
  assert.ok(observations.every((shape) => shape.translationTransport.format === 'ITEM_INDEX_TEXT_ROWS'));
  assert.deepEqual(observations.map((shape) => shape.translationTransport.receivedUnitCount), [96, 41]);
  assert.equal(observations.at(-1).translationTransport.lastUnitIndex, 136);
  assert.equal(JSON.stringify(observations).includes(input.sourceUnits[0].text), false);
});

test('translation accepts only exact declared rows and canonical integer indices', () => {
  const input = translationInput();
  for (const translatedUnits of [
    [{ index: 0, text: '  译文  ' }], [{ index: '0', text: '  译文  ' }],
    { item: [{ index: '0', text: '  译文  ' }] }, [[0, '  译文  ']],
  ]) {
    assert.equal(bindWholeDocumentTranslation(input, { translatedUnits }).candidateUnits[0].text, '  译文  ');
  }
  for (const translatedUnits of [
    { item: [{ index: '00', text: '译文' }] }, { item: [{ index: '1e0', text: '译文' }] },
    { item: [{ index: '+0', text: '译文' }] }, { item: [{ index: ' 0 ', text: '译文' }] },
    { item: [{ index: '9007199254740992', text: '译文' }] },
    { item: [{ index: '-1', text: '译文' }] }, { item: [{ index: '0', text: '译文', sourceRefIds: [] }] },
    { item: [[0, '译文']] }, { items: [{ index: 0, text: '译文' }] },
    { item: [{ index: 0, text: '译文' }], complete: true },
    [['0', '译文']], [{ index: 0, text: '' }],
  ]) {
    assert.throws(() => bindWholeDocumentTranslation(input, { translatedUnits }), /INITIAL_TRANSLATION_/u);
  }
});

test('recognized transport never repairs translation content that fails the existing numeric check', () => {
  const input = translationInput();
  const output = bindWholeDocumentTranslation(input, {
    translatedUnits: { item: [{ index: '0', text: '保持 27 VDC 和 ATA 24。' }] },
  });
  assert.equal(output.candidateUnits[0].text, '保持 27 VDC 和 ATA 24。');
  assert.throws(() => validatePayload('translation-pair', { input, output }));
});

test('initial Gateway failure records only safe token and terminal observations, without retrying', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  let observation;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 'incomplete_result', message: 'private detail must not persist' } }), { status: 400 });
  };
  await assert.rejects(invokeHostedInitialModel({ operation: 'TRANSLATE', modelInput: translationInput() }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'test-only',
    configuredModelVersion: 'miaoda/miaoda-model-auto', sessionDiscriminator: 'failed-document',
    observeModelOutput: async (value) => { observation = value; },
  }), /INITIAL_GATEWAY_HTTP_400/u);
  assert.equal(calls, 1);
  assert.equal(observation.errorCode, 'incomplete_result');
  assert.equal(observation.outputTokens, null);
  assert.equal(JSON.stringify(observation).includes('private detail'), false);
});

test('accepts shared background in new JobAid and Overall inputs while retaining old inputs', async () => {
  const commonContext = {
    primaryDocument: { documentVersionRef: 'DV-fixture-001', documentCode: '777-SL-31-064', businessRevision: '1', title: 'Issue analysis' },
    documentReading: { status: 'AVAILABLE', sections: [] },
    relatedMaterials: { status: 'AVAILABLE', reason: null, items: [] },
    discussion: { status: 'AVAILABLE', totalPriorTurns: 1, omittedEarlierTurns: 0, turns: [{ turnNo: 1, fromCurrentRevision: true, question: 'Explain the problem before the work card.', selectedEvaluationItemId: null, attachmentNames: [], workingAnswer: 'Need the issue analysis.', missingInputs: [], warnings: [] }], usage: 'DISCUSSION_NOT_ADOPTION' },
    knowledgeRetrieval: { status: 'NOT_CONNECTED', fragments: [] },
  };
  const dynamic = await readJson(DYNAMIC_FIXTURE_URL);
  const overall = synthesisInput();
  validatePayload('dynamic-rules-input', dynamic);
  validatePayload('synthesis-input', overall);
  validatePayload('dynamic-rules-input', { ...dynamic, commonContext });
  validatePayload('synthesis-input', { ...overall, commonContext });
});

test('pins exact23 MCP 1.2, five review tools, and hosted provenance', () => {
  assert.deepEqual(INITIAL_ANALYSIS_OPERATIONS, [
    'TRANSLATE',
    'EXTRACT_APPLICABILITY',
    'EVALUATE_JOBAID',
    'SYNTHESIZE_OVERALL',
  ]);
  assert.deepEqual(INTERACTIVE_REVIEW_TOOLS, [
    'begin_review_turn',
    'get_review_turn_context',
    'read_source_refs',
    'get_action_attempt_status',
    'commit_review_turn_candidate',
  ]);
  assert.equal(HOST_MCP_TOOLS.length, 23);
  assert.equal(new Set(HOST_MCP_TOOLS).size, 23);
  for (const name of ['read_assessment_sources', 'save_assessment_work', 'read_assessment_work']) assert.ok(HOST_MCP_TOOLS.includes(name));
  assert.ok(HOST_MCP_TOOLS.includes('begin_applicability_evaluation'));
  assert.ok(HOST_MCP_TOOLS.includes('commit_applicability_candidate'));
  assert.equal(
    WISELINK_SKILL_VERSION,
    'wiselink-research-and-synthesize@r09.c43',
  );
  assert.equal(
    WISELINK_SKILL_COMPATIBILITY_REF,
    'wiselink-research-and-synthesize@r09',
  );
  assert.equal(WISELINK_MODEL_POLICY_REF, 'official-hosted-profile-config');
  assert.equal(WISELINK_HOST_MCP_VERSION, '1.2.0');
});

test('accepts ordinary applicability input with missing or null reevaluation coordination', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  assert.equal('configurationEvidenceReevaluation' in input, false);
  assert.doesNotThrow(() => validateApplicabilityModelInput(input));

  input.configurationEvidenceReevaluation = null;
  assert.doesNotThrow(() => validateApplicabilityModelInput(input));
});

test('accepts exact P0B applicability coordination without projecting it into the candidate', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  input.configurationEvidenceReevaluation = {
    triggerSnapshotId: 'CES-P0B-FIXTURE-001',
    triggerConfigurationRevision: 2,
    adoptionWorkItemRevision: 9,
    applicabilityRetryNo: 0,
  };

  assert.doesNotThrow(() => validateApplicabilityModelInput(input));
  const candidate = buildApplicabilityCandidate(input, astCandidate);
  assert.equal('configurationEvidenceReevaluation' in candidate, false);

  const withUnknownField = structuredClone(input);
  withUnknownField.configurationEvidenceReevaluation.nextStage =
    'APPLICABILITY';
  assert.throws(
    () => validateApplicabilityModelInput(withUnknownField),
    /APPLICABILITY_CONFIGURATION_EVIDENCE_REEVALUATION_UNKNOWN_FIELD:nextStage/u,
  );

  for (const [field, invalidValue, expectedCode] of [
    [
      'triggerSnapshotId',
      '',
      'APPLICABILITY_REEVALUATION_TRIGGER_SNAPSHOT_ID_REQUIRED',
    ],
    [
      'triggerConfigurationRevision',
      -1,
      'APPLICABILITY_REEVALUATION_TRIGGER_CONFIGURATION_REVISION_INVALID',
    ],
    [
      'adoptionWorkItemRevision',
      Number.MAX_SAFE_INTEGER + 1,
      'APPLICABILITY_REEVALUATION_ADOPTION_WORK_ITEM_REVISION_INVALID',
    ],
    [
      'applicabilityRetryNo',
      0.5,
      'APPLICABILITY_REEVALUATION_RETRY_NO_INVALID',
    ],
  ]) {
    const invalid = structuredClone(input);
    invalid.configurationEvidenceReevaluation[field] = invalidValue;
    assert.throws(
      () => validateApplicabilityModelInput(invalid),
      new RegExp(expectedCode, 'u'),
    );
  }
});

test('keeps every packaged runtime version declaration aligned', async () => {
  const versionSuffix = WISELINK_SKILL_VERSION.split('@').at(-1);
  assert.match(versionSuffix, /^r09\.c\d+$/u);
  for (const [url, format] of PACKAGED_VERSION_DECLARATIONS) {
    const contents = await readFile(url, 'utf8');
    const expected =
      format === 'suffix'
        ? `Skill ${versionSuffix}/MCP ${WISELINK_HOST_MCP_VERSION}`
        : WISELINK_SKILL_VERSION;
    assert.ok(
      contents.includes(expected),
      `${url.pathname} must declare ${expected}`,
    );
  }
});

test('distinguishes ordinary applicability waiting from terminal P0B stages', async () => {
  const contents = await readFile(
    new URL('../agents/openai.yaml', import.meta.url),
    'utf8',
  );
  assert.match(contents, /ordinary non-P0B INITIAL_ANALYSIS/u);
  assert.match(
    contents,
    /configuration-evidence P0B, any WAITING_INPUT, FAILED, or CONFLICT stage is terminal/u,
  );
  assert.match(contents, /do not continue to a downstream stage/u);
});

test('requires the single sanitized Host P0B status field', () => {
  assert.throws(
    () =>
      parseConfigurationEvidenceReevaluationStatus(
        status(WORK_ITEM_ID),
        WORK_ITEM_ID,
      ),
    /HOST_P0B_STATUS_UNAVAILABLE/u,
  );
  assert.throws(
    () =>
      parseConfigurationEvidenceReevaluationStatus(
        {
          entry: { workItemId: WORK_ITEM_ID },
          configurationEvidenceReevaluationSummary: {},
        },
        WORK_ITEM_ID,
      ),
    /HOST_P0B_STATUS_UNAVAILABLE/u,
  );
});

test('coordinates P0B through the existing tools without serving-current assumptions', async () => {
  const applicabilityInput = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const applicabilityOutput = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const applicabilityTask = makeTask(
    'OPENCLAW_APPLICABILITY_EVALUATION',
    applicabilityInput,
  );
  const dynamicInput = await readJson(DYNAMIC_FIXTURE_URL);
  const dynamicOutput = buildDynamicRulesOutput(dynamicInput);
  const dynamicTask = makeTask('OPENCLAW_DYNAMIC_EVALUATION', dynamicInput);
  const overallInput = synthesisInput();
  const overallOutput = synthesisOutput(overallInput);
  const overallTask = makeTask('OPENCLAW_OVERALL_SYNTHESIS', {
    modelInput: overallInput,
    selectedDiscoveryRefs: [],
    providerCodes: [],
  });
  const initialReevaluation = await readJson(
    CONFIGURATION_REEVALUATION_FIXTURE_URL,
  );
  let reevaluation = structuredClone(initialReevaluation);
  const calls = [];
  const callTool = async (name, args) => {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'get_parse_status') {
      return p0bStatus(WORK_ITEM_ID, reevaluation);
    }
    if (name === 'begin_applicability_evaluation') {
      return runningBegin(applicabilityTask, {
        modelInput: applicabilityInput,
      });
    }
    if (name === 'begin_dynamic_evaluation') {
      return runningBegin(dynamicTask, { modelInput: dynamicInput });
    }
    if (name === 'begin_overall_synthesis') {
      return runningBegin(overallTask, {
        modelInput: overallInput,
        selectedDiscoveryRefs: [],
      });
    }
    if (name === 'heartbeat_action_attempt') {
      return {
        attemptRef: args.attemptRef,
        status: 'RUNNING',
        leaseGeneration: args.leaseGeneration,
        leaseExpiresAt: '2026-08-27T11:05:00.000Z',
      };
    }
    if (name === 'commit_applicability_candidate') {
      validatePayload('result-envelope', {
        task: applicabilityTask,
        result: args.result,
      });
      reevaluation = p0bReevaluation('JOB_AID');
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 9,
        status: 'CANDIDATE_ONLY',
        applicability: {
          status: 'CANDIDATE_ONLY',
          actionAttemptId: applicabilityTask.actionAttemptId,
        },
      };
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      validatePayload('result-envelope', {
        task: dynamicTask,
        result: args.result,
      });
      reevaluation = p0bReevaluation('OVERALL');
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 10,
        status: 'BASE_RULE_CANDIDATE_READY',
      };
    }
    if (name === 'commit_overall_candidate') {
      validatePayload('result-envelope', {
        task: overallTask,
        result: args.result,
      });
      reevaluation = p0bReevaluation(null);
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 11,
        status: 'OVERALL_CANDIDATE_READY',
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          authorityLevel: 'candidate_only',
          externalDiscoveryIsEvidence: false,
        },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };

  const result = await runConfigurationEvidenceReevaluation({
    workItemId: WORK_ITEM_ID,
    applicabilityContextRef: applicabilityInput.applicabilityContextRef,
    applicabilityRequestId: 'REQ-P0B-APPLICABILITY-001',
    callTool,
    extractApplicability: async () => ({
      output: applicabilityOutput,
      provenance: applicabilityProvenance(),
    }),
    evaluateDynamicRules: async () => ({
      output: dynamicOutput,
      provenance: provenance(),
    }),
    synthesizeOverall: async () => ({
      output: overallOutput,
      provenance: provenance(),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reevaluation.status, 'SUCCEEDED');
  assert.equal(Object.hasOwn(result, 'initialStatus'), false);
  assert.equal(
    result.initialReevaluation.schemaVersion,
    CONFIGURATION_EVIDENCE_REEVALUATION_STATUS_SCHEMA,
  );
  assert.deepEqual(
    result.operations.map(({ stage }) => stage),
    ['APPLICABILITY', 'JOB_AID', 'OVERALL'],
  );
  assert.equal(
    calls.every(({ name }) => HOST_MCP_TOOLS.includes(name)),
    true,
  );
  assert.deepEqual(
    calls
      .filter(({ name }) =>
        [
          'commit_applicability_candidate',
          'commit_dynamic_evaluation_candidate',
          'commit_overall_candidate',
          'get_parse_status',
        ].includes(name),
      )
      .map(({ name }) => name)
      .filter(
        (name, index, sequence) =>
          name !== 'get_parse_status' ||
          index === 0 ||
          sequence[index - 1] !== 'get_parse_status',
      )
      .slice(-7),
    [
      'get_parse_status',
      'commit_applicability_candidate',
      'get_parse_status',
      'commit_dynamic_evaluation_candidate',
      'get_parse_status',
      'commit_overall_candidate',
      'get_parse_status',
    ],
  );
});

test('resumes P0B from Host nextStage and skips completed stages', async () => {
  const overallInput = synthesisInput();
  const overallOutput = synthesisOutput(overallInput);
  const overallTask = makeTask('OPENCLAW_OVERALL_SYNTHESIS', {
    modelInput: overallInput,
    selectedDiscoveryRefs: [],
    providerCodes: [],
  });
  let reevaluation = p0bReevaluation('OVERALL');
  const calls = [];
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'get_parse_status') {
      return p0bStatus(WORK_ITEM_ID, reevaluation);
    }
    if (name === 'begin_overall_synthesis') {
      return runningBegin(overallTask, {
        modelInput: overallInput,
        selectedDiscoveryRefs: [],
      });
    }
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(overallTask, args);
    }
    if (name === 'commit_overall_candidate') {
      reevaluation = p0bReevaluation(null);
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 11,
        status: 'OVERALL_CANDIDATE_READY',
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          authorityLevel: 'candidate_only',
          externalDiscoveryIsEvidence: false,
        },
      };
    }
    if (name === 'get_deep_link') return { deepLink: '/work-item/fixture' };
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };

  const result = await runConfigurationEvidenceReevaluation({
    workItemId: WORK_ITEM_ID,
    callTool,
    synthesizeOverall: async () => ({
      output: overallOutput,
      provenance: provenance(),
    }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.operations.map(({ stage }) => stage),
    ['OVERALL'],
  );
  assert.equal(calls.includes('begin_applicability_evaluation'), false);
  assert.equal(calls.includes('begin_dynamic_evaluation'), false);
});

test('accepts deterministic Host WAITING_INPUT after a successful applicability model result', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  let reevaluation = p0bReevaluation('APPLICABILITY');
  const calls = [];
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'get_parse_status') {
      return p0bStatus(WORK_ITEM_ID, reevaluation);
    }
    if (name === 'begin_applicability_evaluation') {
      return runningBegin(task, { modelInput: input });
    }
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_applicability_candidate') {
      assert.equal(args.result.status, 'SUCCEEDED');
      reevaluation = p0bReevaluation('APPLICABILITY');
      reevaluation.status = 'WAITING_INPUT';
      reevaluation.stages.applicability.status = 'WAITING_INPUT';
      return {
        attemptRef: task.operationRef,
        status: 'WAITING_INPUT',
        projectionApplied: false,
        terminalReason: 'APPLICABILITY_HOST_CONTROLLED_FACT_REQUIRED',
      };
    }
    if (name === 'get_deep_link') return { deepLink: '/work-item/fixture' };
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };

  const result = await runConfigurationEvidenceReevaluation({
    workItemId: WORK_ITEM_ID,
    applicabilityContextRef: input.applicabilityContextRef,
    applicabilityRequestId: 'REQ-P0B-DETERMINISTIC-WAITING-001',
    callTool,
    extractApplicability: async () => ({
      output: astCandidate,
      provenance: applicabilityProvenance(),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'WAITING_INPUT');
  assert.equal(result.operations[0].result.outcome, 'WAITING_INPUT');
  assert.equal(
    result.reevaluation.stages.applicability.status,
    'WAITING_INPUT',
  );
  assert.equal(calls.includes('get_action_attempt_status'), false);
});

test('prioritizes fresh P0B terminal state over generic commit recovery outcome', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: buildApplicabilityCandidate(input, astCandidate),
    provenance: applicabilityProvenance(),
    factsConsidered: input.controlledFacts.map(({ factId }) => factId),
  });
  let reevaluation = p0bReevaluation('APPLICABILITY');
  reevaluation.stages.applicability.status = 'COMMITTING';
  const calls = [];
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'get_parse_status') {
      return p0bStatus(WORK_ITEM_ID, reevaluation);
    }
    if (name === 'begin_applicability_evaluation') {
      return {
        ...runningBegin(task, { modelInput: input }),
        status: 'COMMITTING',
        recoveryResult,
      };
    }
    if (name === 'get_action_attempt_status') {
      reevaluation = p0bReevaluation('APPLICABILITY');
      reevaluation.status = 'WAITING_INPUT';
      reevaluation.stages.applicability.status = 'WAITING_INPUT';
      return attemptStatus(task, 'COMMITTING', recoveryResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCallCount = 0;

  const result = await runConfigurationEvidenceReevaluation({
    workItemId: WORK_ITEM_ID,
    applicabilityContextRef: input.applicabilityContextRef,
    applicabilityRequestId: 'REQ-P0B-RECOVERY-001',
    callTool,
    extractApplicability: async () => {
      modelCallCount += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.outcome, 'WAITING_INPUT');
  assert.equal(
    result.operations[0].result.outcome,
    'COMMITTING_RECOVERY_READ_ONLY',
  );
  assert.equal(result.reevaluation.nextStage, 'APPLICABILITY');
  assert.equal(modelCallCount, 0);
  assert.deepEqual(calls, [
    'get_parse_status',
    'begin_applicability_evaluation',
    'get_parse_status',
    'get_action_attempt_status',
    'get_parse_status',
  ]);
});

test('binds P0B applicability begin to the requested WorkItem before model or commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const { inputHash: ignoredInputHash, ...wrongWorkItemTaskFields } = {
    ...task,
    workItemId: 'WI-P0B-WRONG-TARGET',
  };
  assert.ok(ignoredInputHash);
  const wrongWorkItemTask = {
    ...wrongWorkItemTaskFields,
    inputHash: canonicalSha256(wrongWorkItemTaskFields),
  };
  const reevaluation = p0bReevaluation('APPLICABILITY');
  const calls = [];

  await assert.rejects(
    runConfigurationEvidenceReevaluation({
      workItemId: WORK_ITEM_ID,
      applicabilityContextRef: input.applicabilityContextRef,
      applicabilityRequestId: 'REQ-P0B-WORKITEM-BINDING-001',
      callTool: async (name) => {
        calls.push(name);
        if (name === 'get_parse_status') {
          return p0bStatus(WORK_ITEM_ID, reevaluation);
        }
        if (name === 'begin_applicability_evaluation') {
          return runningBegin(wrongWorkItemTask, { modelInput: input });
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      },
      extractApplicability: async () => {
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    }),
    /HOST_MCP_APPLICABILITY_WORKITEM_BINDING_MISMATCH/u,
  );
  assert.deepEqual(calls, [
    'get_parse_status',
    'begin_applicability_evaluation',
  ]);
});

test('runs real applicability AST extraction through dedicated begin/commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const begin = runningBegin(task, { modelInput: input });
  const calls = [];
  let modelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_applicability_evaluation') return begin;
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_applicability_candidate') {
      validatePayload('result-envelope', { task, result: args.result });
      const candidate = JSON.parse(args.result.modelOutput);
      assert.equal(
        candidate.schemaVersion,
        'wiselink.3_1.applicability_candidate.v1',
      );
      assert.equal(candidate.expressions.length, 1);
      assert.equal(
        Object.hasOwn(candidate.expressions[0], 'applicabilityLevel'),
        false,
      );
      assert.equal(
        Object.hasOwn(candidate.expressions[0], 'contentRef'),
        false,
      );
      assert.equal(args.attemptRef, task.operationRef);
      assert.equal(args.leaseToken, LEASE_TOKEN);
      assert.equal(args.leaseGeneration, 3);
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'CANDIDATE_ONLY',
        applicability: {
          status: 'CANDIDATE_ONLY',
          actionAttemptId: task.actionAttemptId,
        },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-001',
    callTool,
    extractApplicability: async (value) => {
      modelInput = value;
      return {
        output: astCandidate,
        provenance: applicabilityProvenance(),
      };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(Object.hasOwn(modelInput, 'tenantId'), false);
  assert.equal(Object.hasOwn(modelInput, 'workItemId'), false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_applicability_evaluation',
      'get_parse_status',
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'commit_applicability_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
});

test('rejects an operator outside the Host-frozen applicability vocabulary before commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  astCandidate.expressions[0].expressionAst = {
    type: 'assert',
    property: 'lineNumber',
    operator: 'between',
    value: [100, 200],
  };
  assert.throws(
    () =>
      validatePayload('applicability-pair', { input, output: astCandidate }),
    /APPLICABILITY_AST_ASSERT_UNSUPPORTED/u,
  );
});

test('propagates only Host-frozen applicability missing input without a model call', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const missingInputs = [
    {
      code: 'FLEET_MISSING_CONTROLLED_FACT_fixture',
      message: 'Controlled aircraft fact is missing.',
    },
  ];
  const task = makeTask(
    'OPENCLAW_APPLICABILITY_EVALUATION',
    input,
    missingInputs,
  );
  const begin = runningBegin(task, { modelInput: input });
  let modelCallCount = 0;
  const calls = [];
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'begin_applicability_evaluation') return begin;
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'commit_applicability_candidate') {
      assert.equal(args.result.status, 'WAITING_INPUT');
      assert.deepEqual(args.result.missingInputs, missingInputs);
      assert.deepEqual(args.result.conflicts, []);
      assert.equal(args.result.modelOutput, null);
      return {
        attemptRef: task.operationRef,
        status: 'WAITING_INPUT',
        projectionApplied: false,
        terminalReason: 'HOST_RESOLVED_MISSING_INPUT',
      };
    }
    if (name === 'get_deep_link') return { deepLink: '/work-item/fixture' };
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runApplicabilityEvaluation({
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-waiting',
    callTool,
    extractApplicability: async () => {
      modelCallCount += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
    runtimeProvenance: applicabilityProvenance({
      runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
    }),
  });
  assert.equal(result.outcome, 'WAITING_INPUT');
  assert.equal(modelCallCount, 0);
  assert.equal(
    calls.filter((name) => name === 'commit_applicability_candidate').length,
    1,
  );
});

test('keeps the real 777 FTD AIMS-2 condition in its own preliminary overall', async () => {
  const applicabilityInput = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const missingInputs = [
    {
      code: 'FLEET_MISSING_CONTROLLED_FACT_EQUIPMENTMODELINSTALLED_AIMS2',
      message:
        'Controlled Fleet fact equipmentModelInstalled[AIMS2] is unavailable for aircraft B-1266 as of 2026-08-27.',
    },
  ];
  const applicabilityTask = makeTask(
    'OPENCLAW_APPLICABILITY_EVALUATION',
    applicabilityInput,
    missingInputs,
  );
  let applicabilityModelCalls = 0;
  const applicability = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EXTRACT_APPLICABILITY',
    applicabilityContextRef: applicabilityInput.applicabilityContextRef,
    requestId: 'REQ-applicability-aims2-waiting',
    callTool: async (name, args) => {
      if (name === 'begin_applicability_evaluation') {
        return runningBegin(applicabilityTask, {
          modelInput: applicabilityInput,
        });
      }
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'commit_applicability_candidate') {
        validatePayload('result-envelope', {
          task: applicabilityTask,
          result: args.result,
        });
        return {
          attemptRef: applicabilityTask.operationRef,
          status: 'WAITING_INPUT',
          projectionApplied: false,
          terminalReason: 'HOST_RESOLVED_MISSING_INPUT',
        };
      }
      if (name === 'get_deep_link') {
        return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    extractApplicability: async () => {
      applicabilityModelCalls += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
    runtimeProvenance: applicabilityProvenance({
      runMetrics: { durationMs: 0, inputUnits: 0, outputUnits: 0 },
    }),
  });
  assert.equal(applicability.ok, true);
  assert.equal(applicability.outcome, 'WAITING_INPUT');
  assert.equal(applicabilityModelCalls, 0);

  const dynamicInput = await readJson(DYNAMIC_FIXTURE_URL);
  const dynamicOutput = buildDynamicRulesOutput(dynamicInput);
  const dynamicTask = makeTask('OPENCLAW_DYNAMIC_EVALUATION', dynamicInput);
  let dynamicModelCalls = 0;
  const dynamic = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EVALUATE_JOBAID',
    workItemId: WORK_ITEM_ID,
    callTool: async (name, args) => {
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'begin_dynamic_evaluation') {
        return runningBegin(dynamicTask, { modelInput: dynamicInput });
      }
      if (name === 'heartbeat_action_attempt') {
        return heartbeatResult(dynamicTask, args);
      }
      if (name === 'commit_dynamic_evaluation_candidate') {
        validatePayload('result-envelope', {
          task: dynamicTask,
          result: args.result,
        });
        return {
          workItemId: WORK_ITEM_ID,
          workItemRevision: 8,
          status: 'BASE_RULE_CANDIDATE_READY',
        };
      }
      if (name === 'get_deep_link') {
        return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    evaluateDynamicRules: async () => {
      dynamicModelCalls += 1;
      return { output: dynamicOutput, provenance: provenance() };
    },
  });
  assert.equal(dynamic.outcome, 'CANDIDATE_ONLY');
  assert.equal(dynamicModelCalls, 1);

  const overallInput = synthesisInput();
  overallInput.baseRuleResult.items[0].missingInputs = [
    missingInputs[0].message,
  ];
  const overallOutput = synthesisOutput(overallInput);
  overallOutput.gap = 'AIMS-2 configuration data is not connected.';
  overallOutput.overallCandidate =
    '飞机身份和机型已知；AIMS-2 构型数据未接入，适用性保持条件性未知，需工程师或后续受控数据确认；当前可形成初步工程综合候选，但不得最终批准或发布。';
  overallOutput.engineeringSummary.conclusion.text =
    overallOutput.overallCandidate;
  overallOutput.engineeringSummary.applicability.sourceScope.text =
    '当前 777 FTD 的来源适用范围要求飞机装有 AIMS-2 平台。';
  overallOutput.engineeringSummary.applicability.fleetMatch.text =
    '所选飞机的 AIMS-2 受控构型事实缺失，因此当前匹配保持条件性未知。';
  overallOutput.engineeringSummary.applicability.requiredFacts[0].text =
    missingInputs[0].message;
  overallOutput.engineeringSummary.nextActions[0].text =
    '核对所选 777 飞机是否装有 AIMS-2 平台的受控构型事实。';
  overallOutput.findings[0] = {
    finding: '飞机身份和机型已知，AIMS-2 构型状态未知。',
    basis: 'Dynamic N/N and frozen.2 SourceRef',
    sourceRefIds: [overallInput.unifiedSourceContext.sourceRefs[0].sourceRefId],
    assumptions: [],
    uncertainty: 'AIMS-2 构型数据未接入，适用性需人工或后续数据确认。',
  };
  overallOutput.missingInputs = [missingInputs[0].message];
  const overallTask = makeTask('OPENCLAW_OVERALL_SYNTHESIS', {
    modelInput: overallInput,
    selectedDiscoveryRefs: [],
    providerCodes: [],
  });
  let overallStatusReads = 0;
  let overallModelCalls = 0;
  const overall = await runInitialAnalysis({
    mode: 'INITIAL_ANALYSIS',
    operation: 'SYNTHESIZE_OVERALL',
    workItemId: WORK_ITEM_ID,
    providers: [],
    callTool: async (name, args) => {
      if (name === 'get_parse_status') {
        overallStatusReads += 1;
        return overallStatusReads === 1
          ? statusWithDynamic(WORK_ITEM_ID, 'REQ-DYNAMIC')
          : statusWithOverall(WORK_ITEM_ID, overallInput.outputCorrelationRef);
      }
      if (name === 'begin_overall_synthesis') {
        return runningBegin(overallTask, {
          modelInput: overallInput,
          selectedDiscoveryRefs: [],
        });
      }
      if (name === 'heartbeat_action_attempt') {
        return heartbeatResult(overallTask, args);
      }
      if (name === 'commit_overall_candidate') {
        validatePayload('result-envelope', {
          task: overallTask,
          result: args.result,
        });
        return {
          workItemId: WORK_ITEM_ID,
          workItemRevision: 9,
          status: 'OVERALL_CANDIDATE_READY',
          overallSynthesis: {
            status: 'CANDIDATE_ONLY',
            authorityLevel: 'candidate_only',
            externalDiscoveryIsEvidence: false,
          },
        };
      }
      if (name === 'get_deep_link') {
        return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    synthesizeOverall: async () => {
      overallModelCalls += 1;
      return { output: overallOutput, provenance: provenance() };
    },
  });
  assert.equal(overall.outcome, 'CANDIDATE_ONLY');
  assert.equal(overallModelCalls, 1);
  assert.equal(overallOutput.applicabilityStatus, 'UNKNOWN/WAITING_INPUT');
  assert.match(overallOutput.overallCandidate, /初步工程综合候选/u);
  assert.match(overallOutput.overallCandidate, /不得最终批准或发布/u);
});

test('recovers COMMITTING applicability once by generic attempt status hash', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: buildApplicabilityCandidate(input, astCandidate),
    provenance: applicabilityProvenance(),
    factsConsidered: input.controlledFacts.map(({ factId }) => factId),
  });
  const calls = [];
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_applicability_evaluation') {
      return {
        ...runningBegin(task, { modelInput: input }),
        status: 'COMMITTING',
        recoveryResult,
      };
    }
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'COMMITTING', recoveryResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCallCount = 0;
  const result = await runApplicabilityEvaluation({
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-committing',
    callTool,
    extractApplicability: async () => {
      modelCallCount += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
  });
  assert.equal(result.outcome, 'COMMITTING_RECOVERY_READ_ONLY');
  assert.equal(modelCallCount, 0);
  assert.deepEqual(calls, [
    'begin_applicability_evaluation',
    'get_parse_status',
    'get_action_attempt_status',
  ]);
});

test('recovers applicability commit response loss once and never retries commit', async () => {
  const input = await readJson(APPLICABILITY_TASK_FIXTURE_URL);
  const astCandidate = await readJson(APPLICABILITY_AST_FIXTURE_URL);
  const task = makeTask('OPENCLAW_APPLICABILITY_EVALUATION', input);
  const calls = [];
  let submittedResult;
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'begin_applicability_evaluation') {
      return runningBegin(task, { modelInput: input });
    }
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_applicability_candidate') {
      submittedResult = args.result;
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', submittedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runApplicabilityEvaluation({
    applicabilityContextRef: input.applicabilityContextRef,
    requestId: 'REQ-applicability-response-loss',
    callTool,
    extractApplicability: async () => ({
      output: astCandidate,
      provenance: applicabilityProvenance(),
    }),
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(
    calls.filter((name) => name === 'commit_applicability_candidate').length,
    1,
  );
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
  );
});

test('validates the real dynamic N input and preserves FALSE/UNKNOWN/TRUE', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  validatePayload('dynamic-rules-pair', { input, output });
  assert.equal(
    output.ruleResults.rows.length,
    input.jobAidContext.criterionTable.rowCount,
  );

  const table = input.jobAidContext.criterionTable;
  const predicateIndex = table.columns.indexOf('predicateResult');
  const sourceIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const falseIndex = table.rows.findIndex(
    (_, index) => dynamicValue(table, predicateIndex, index) === 'FALSE',
  );
  const unknownIndex = table.rows.findIndex(
    (_, index) => dynamicValue(table, predicateIndex, index) === 'UNKNOWN',
  );
  const trueIndex = table.rows.findIndex(
    (_, index) =>
      dynamicValue(table, predicateIndex, index) === 'TRUE' &&
      dynamicValue(table, sourceIndex, index).length > 0,
  );
  assert.deepEqual(output.ruleResults.rows[falseIndex].slice(1, 9), [
    'NOT_APPLICABLE',
    [],
    '谓词 FALSE。',
    '不适用。',
    'not_applicable',
    [],
    [],
    false,
  ]);
  assert.equal(
    output.ruleResults.rows[unknownIndex][1],
    'UNKNOWN/WAITING_INPUT',
  );
  assert.equal(output.ruleResults.rows[unknownIndex][8], true);
  assert.notEqual(
    output.ruleResults.rows[trueIndex][1],
    'UNKNOWN/WAITING_INPUT',
  );
  assert.ok(output.ruleResults.rows[trueIndex][6].length > 0);
});

test('rejects any dynamic attempt to degrade a Host TRUE predicate', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const table = input.jobAidContext.criterionTable;
  const predicateIndex = table.columns.indexOf('predicateResult');
  const sourceIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const trueIndex = table.rows.findIndex(
    (_, index) =>
      dynamicValue(table, predicateIndex, index) === 'TRUE' &&
      dynamicValue(table, sourceIndex, index).length > 0,
  );
  output.ruleResults.rows[trueIndex][1] = 'UNKNOWN/WAITING_INPUT';
  assert.throws(
    () => validatePayload('dynamic-rules-pair', { input, output }),
    /DYNAMIC_RULES_TRUE_PREDICATE_DOWNGRADED/u,
  );
});

test('reads resultCount/results without inventing applicability', () => {
  const summary = summarizeQueryParsedPackage({
    workItemId: WORK_ITEM_ID,
    resultCount: 2,
    results: [
      {
        unitId: 'U-1',
        kind: 'paragraph',
        text: '737-8 / 737-9',
        sourceRefIds: ['SR-1'],
      },
      {
        unitId: 'U-2',
        kind: 'paragraph',
        text: '737-8200',
        sourceRefIds: [],
      },
    ],
  });
  assert.equal(summary.resultCount, 2);
  assert.equal(summary.sourceBoundResultCount, 1);
  assert.equal(summary.applicabilityAuthorityAvailable, false);
  assert.deepEqual(summary.authorityCollections, {
    sourceExpressions: null,
    normalizedCandidates: null,
    assignments: null,
  });
});

test('seals actual model provenance without binding the Skill to one model version', () => {
  const task = makeTask('OPENCLAW_TRANSLATE', translationInput());
  const result = sealResultEnvelope({
    task,
    modelOutput: translationOutput(),
    provenance: provenance(),
  });
  validatePayload('result-envelope', { task, result });
  const { contentHash: _contentHash, ...unsealed } = result;
  assert.equal(result.contentHash, canonicalSha256(unsealed));
  assert.equal(result.skillVersion, WISELINK_SKILL_VERSION);
  assert.equal(
    result.toolVersions[WISELINK_HOST_MCP_NAME],
    WISELINK_HOST_MCP_VERSION,
  );
  assert.equal(
    sealResultEnvelope({
      task,
      modelOutput: translationOutput(),
      provenance: provenance({
        modelVersion: 'official-provider/model-release-2',
      }),
    }).modelVersion,
    'official-provider/model-release-2',
  );

  assert.throws(
    () =>
      sealResultEnvelope({
        task,
        modelOutput: translationOutput(),
        provenance: provenance({ skillVersion: 'self-reported-latest' }),
      }),
    /RUNTIME_SKILL_VERSION_POLICY_MISMATCH/u,
  );
  for (const modelVersion of ['', 'fallback', 'unknown']) {
    assert.throws(
      () =>
        sealResultEnvelope({
          task,
          modelOutput: translationOutput(),
          provenance: provenance({ modelVersion }),
        }),
      /RUNTIME_MODEL_PROVENANCE_(?:REQUIRED|UNREADABLE)/u,
    );
  }
});

test('Host and Skill fidelity cases preserve dates, CJK numbers, identifiers, and real errors', async () => {
  const cases = JSON.parse(await readFile(new URL('./fixtures/translation-fidelity-cases.json', import.meta.url), 'utf8'));
  for (const item of cases) {
    const input = translationInput();
    const output = translationOutput();
    input.sourceUnits[0].text = item.source;
    output.candidateUnits[0].text = item.translation;
    if (item.accepted) {
      assert.doesNotThrow(() => validatePayload('translation-pair', { input, output }), item.name);
    } else {
      assert.throws(() => validatePayload('translation-pair', { input, output }), /TRANSLATION_RULE_PREFLIGHT_REJECTED/u, item.name);
    }
  }
});

test('rejects Host-incompatible numeric tokenization with unit diagnostics', () => {
  const cases = [
    {
      label: 'letter-glued digits split into an extra standalone token',
      unitKey: 'SYNTH-GLUED-DIGITS',
      sourceText: 'Retain OCRX123.',
      translatedText: '保留 OCRX 123。',
    },
    {
      label: 'leading-zero token split',
      unitKey: 'SYNTH-LEADING-ZERO',
      sourceText: 'Retain 007.',
      translatedText: '保留 00 7。',
    },
    {
      label: 'concatenated decimal table string reordered',
      unitKey: 'SYNTH-DECIMAL-TABLE',
      sourceText: 'Retain 40.512.7.',
      translatedText: '保留 40.5 12.7。',
    },
  ];
  for (const { label, unitKey, sourceText, translatedText } of cases) {
    const input = translationInput();
    const output = translationOutput();
    input.sourceUnits[0].unitKey = unitKey;
    output.candidateUnits[0].unitKey = unitKey;
    input.sourceUnits[0].text = sourceText;
    output.candidateUnits[0].text = translatedText;
    assert.throws(
      () => validatePayload('translation-pair', { input, output }),
      (error) => {
        assert.match(error.message, /TRANSLATION_RULE_PREFLIGHT_REJECTED/u);
        assert.match(error.message, /NUMBER_NOT_PRESERVED/u);
        assert.match(error.message, new RegExp(unitKey, 'u'));
        return true;
      },
      label,
    );
  }
});

test('rejects a missing ATA token after the numeric multiset still matches', () => {
  const input = translationInput();
  const output = translationOutput();
  input.sourceUnits[0].unitKey = 'SYNTH-ATA';
  output.candidateUnits[0].unitKey = 'SYNTH-ATA';
  input.sourceUnits[0].text = 'Retain ATA 31-21 with marker 8.';
  output.candidateUnits[0].text = '保留 ATA 31 和 21，并保留标记 8。';
  assert.throws(
    () => validatePayload('translation-pair', { input, output }),
    (error) => {
      assert.match(error.message, /TRANSLATION_RULE_PREFLIGHT_REJECTED/u);
      assert.match(error.message, /ATA_CHAPTER_NOT_PRESERVED/u);
      assert.match(error.message, /SYNTH-ATA/u);
      return true;
    },
  );
});

test('accepts a normal Chinese translation with Host tokens preserved', () => {
  const input = translationInput();
  const output = translationOutput();
  input.sourceUnits[0].text = 'Retain OCRX123, 007, 40.512.7, and ATA 31-21.';
  output.candidateUnits[0].text = '保留 OCRX123、007、40.512.7 和 ATA 31-21。';
  validatePayload('translation-pair', { input, output });
});

test('does not treat mm inside ordinary words as a preserved engineering unit', () => {
  const input = translationInput();
  const output = translationOutput();
  input.rulePack.deterministic.preservedUnits = ['mm'];
  input.sourceUnits[0].text =
    'Commercial Summary recommended common Accomplishment.';
  output.candidateUnits[0].text = '商业摘要、建议、通用和实施。';
  validatePayload('translation-pair', { input, output });
});

test('rejects missing mandatory terms and real engineering units before Host commit', () => {
  const input = translationInput();
  const output = translationOutput();
  input.rulePack.terms = [
    {
      ruleId: 'term.airplane',
      sourceTerm: 'airplane',
      targetRenderings: ['飞机'],
      severity: 'mandatory',
    },
  ];
  input.rulePack.deterministic.preservedUnits = ['mm'];
  input.sourceUnits[0].unitKey = 'ACTUAL-777-PREFLIGHT';
  input.sourceUnits[0].text = 'The airplane requires a 10mm clearance.';
  output.candidateUnits[0].unitKey = 'ACTUAL-777-PREFLIGHT';
  output.candidateUnits[0].text = '该设备要求保持 10 的间隙。';

  assert.throws(
    () => validatePayload('translation-pair', { input, output }),
    (error) => {
      assert.match(error.message, /TERM_MANDATORY_MISSING/u);
      assert.match(error.message, /UNIT_NOT_PRESERVED/u);
      assert.match(error.message, /ACTUAL-777-PREFLIGHT/u);
      return true;
    },
  );
});

test('stops invalid translation before seal, post-model heartbeat, or upload', async () => {
  const input = translationInput();
  input.sourceUnits[0].unitKey = 'SYNTH-PRECOMMIT';
  input.sourceUnits[0].text = 'Retain OCRX123.';
  const output = translationOutput();
  output.candidateUnits[0].unitKey = 'SYNTH-PRECOMMIT';
  output.candidateUnits[0].text = '保留 OCRX 123。';
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const [begin] = translationDeliveryParts(task, input);
  const calls = [];
  await assert.rejects(
    runTranslation({
      workItemId: WORK_ITEM_ID,
      callTool: async (name, args) => {
        calls.push(name);
        if (name === 'get_parse_status') return status(WORK_ITEM_ID);
        if (name === 'begin_translation') return begin;
        if (name === 'heartbeat_action_attempt') {
          return heartbeatResult(task, args);
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      },
      translate: async () => ({ output, provenance: provenance() }),
    }),
    /NUMBER_NOT_PRESERVED.*SYNTH-PRECOMMIT|SYNTH-PRECOMMIT.*NUMBER_NOT_PRESERVED/u,
  );
  assert.deepEqual(calls, [
    'get_parse_status',
    'begin_translation',
    'heartbeat_action_attempt',
  ]);
});

test('runs translation with fresh status and full fenced ResultEnvelope', async () => {
  const input = translationInput();
  input.sourceUnits.push({
    unitKey: 'unit-002',
    kind: 'paragraph',
    text: 'Inspect ATA 32 before release.',
    sourceRefIds: ['source-ref-002'],
  });
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const deliveryParts = translationDeliveryParts(task, input, { batchSize: 1 });
  const output = translationOutput();
  output.candidateUnits.push({
    unitKey: 'unit-002',
    text: '放行前检查 ATA 32。',
    sourceRefIds: ['source-ref-002'],
    engineerRevision: null,
  });
  const calls = [];
  const uploaded = new Map();
  let deliveredModelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'begin_translation') {
      return deliveryParts[args.deliveryPart ?? 0];
    }
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_translation_candidate') {
      assert.equal(args.attemptRef, task.operationRef);
      assert.equal(args.leaseToken, LEASE_TOKEN);
      assert.equal(args.leaseGeneration, 3);
      if (args.phase === 'UPLOAD_PART') {
        return stageTranslationPart(args, uploaded);
      }
      assert.equal(args.phase, 'FINALIZE');
      const assembled = assembleTranslationParts(args, uploaded);
      validatePayload('result-envelope', { task, result: assembled });
      assert.deepEqual(assembled.sourceRefs, []);
      assert.equal(
        JSON.stringify(assembled).includes('tenant-control-plane'),
        false,
      );
      assert.equal(JSON.stringify(assembled).includes(ARTIFACT_REF), false);
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'CANDIDATE_ONLY',
        translation: { status: 'CANDIDATE_ONLY' },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runTranslation({
    workItemId: WORK_ITEM_ID,
    callTool,
    translate: async (modelInput, runtimeHooks) => {
      deliveredModelInput = modelInput;
      await runtimeHooks.heartbeat();
      return { output, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(result.provenance.skillVersion, WISELINK_SKILL_VERSION);
  assert.deepEqual(deliveredModelInput, input);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'get_parse_status',
      'begin_translation',
      'begin_translation',
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'commit_translation_candidate',
      'commit_translation_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
  assert.deepEqual(calls[1].args, { workItemId: WORK_ITEM_ID });
  assert.deepEqual(calls[2].args, {
    workItemId: WORK_ITEM_ID,
    deliveryPart: 1,
  });
});

test('recovers COMMITTING translation through generic status without model or commit', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: translationOutput(),
    provenance: provenance(),
  });
  const [begin] = translationDeliveryParts(task, input, {
    status: 'COMMITTING',
    recoveryResult,
  });
  const calls = [];
  let translateCalls = 0;
  const result = await runTranslation({
    workItemId: WORK_ITEM_ID,
    callTool: async (name, args) => {
      calls.push({ name, args });
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'begin_translation') return begin;
      if (name === 'get_action_attempt_status') {
        return attemptStatus(task, 'COMMITTING', recoveryResult);
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    translate: async () => {
      translateCalls += 1;
      throw new Error('MODEL_MUST_NOT_RUN');
    },
  });
  assert.equal(result.outcome, 'COMMITTING_RECOVERY_READ_ONLY');
  assert.equal(translateCalls, 0);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ['get_parse_status', 'begin_translation', 'get_action_attempt_status'],
  );
});

test('recovers translation commit response loss against the delivered task binding', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const [begin] = translationDeliveryParts(task, input);
  const calls = [];
  const uploaded = new Map();
  let submittedResult;
  const result = await runTranslation({
    workItemId: WORK_ITEM_ID,
    callTool: async (name, args) => {
      calls.push(name);
      if (name === 'get_parse_status') return status(WORK_ITEM_ID);
      if (name === 'begin_translation') return begin;
      if (name === 'heartbeat_action_attempt') {
        return heartbeatResult(task, args);
      }
      if (name === 'commit_translation_candidate') {
        if (args.phase === 'UPLOAD_PART') {
          return stageTranslationPart(args, uploaded);
        }
        submittedResult = assembleTranslationParts(args, uploaded);
        throw new Error('TRANSPORT_RESPONSE_LOST');
      }
      if (name === 'get_action_attempt_status') {
        return attemptStatus(task, 'COMMITTING', submittedResult);
      }
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    translate: async () => ({
      output: translationOutput(),
      provenance: provenance(),
    }),
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.deepEqual(calls, [
    'get_parse_status',
    'begin_translation',
    'heartbeat_action_attempt',
    'heartbeat_action_attempt',
    'commit_translation_candidate',
    'commit_translation_candidate',
    'get_action_attempt_status',
  ]);
});

test('reads a locally sealed translation payload file and uploads bounded parts before finalize', async () => {
  const input = translationInput();
  const task = makeTask('OPENCLAW_TRANSLATE', input);
  const [begin] = translationDeliveryParts(task, input);
  const result = sealResultEnvelope({
    task,
    modelOutput: translationOutput(),
    provenance: provenance(),
  });
  const directory = await mkdtemp(join(tmpdir(), 'wiselink-translation-'));
  const payloadPath = join(directory, 'commit-payload.json');
  await writeFile(
    payloadPath,
    JSON.stringify({
      attemptRef: begin.attemptRef,
      leaseToken: begin.leaseToken,
      leaseGeneration: begin.leaseGeneration,
      result,
    }),
  );
  const uploaded = new Map();
  try {
    const committed = await commitTranslationPayloadFile({
      begin,
      payloadPath,
      callTool: async (name, args) => {
        assert.equal(name, 'commit_translation_candidate');
        assert.ok(Buffer.byteLength(JSON.stringify(args)) < 12_000);
        if (args.phase === 'UPLOAD_PART') {
          return stageTranslationPart(args, uploaded);
        }
        assert.deepEqual(assembleTranslationParts(args, uploaded), result);
        return { status: 'CANDIDATE_ONLY' };
      },
    });
    assert.deepEqual(committed, { status: 'CANDIDATE_ONLY' });
    assert.equal(uploaded.size, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects each forbidden translation input before the model boundary', async (t) => {
  const leakageCases = [
    ['actor', { actor: { id: 'actor-secret' } }],
    ['tenant', { tenant: 'tenant-secret' }],
    ['ACL normalized key', { A_C_L: ['private-row'] }],
    ['sessionKey', { sessionKey: 'analysis:tenant:work-item:attempt' }],
    [
      'openClawSessionKey',
      { openClawSessionKey: 'analysis:tenant:work-item:attempt' },
    ],
    [
      'openClawSessionKey normalized key',
      { 'open_claw-session key': 'analysis:tenant:work-item:attempt' },
    ],
    ['credential', { credential: 'credential-secret' }],
    ['FileService locator', { file_service_locator: 'bucket/private/path' }],
    ['raw PDF', { 'raw-pdf': 'JVBERi0xLjQ=' }],
    ['full Fleet', { 'full fleet': [{ registration: 'B-0001' }] }],
  ];

  for (const [label, leakage] of leakageCases) {
    await t.test(label, async () => {
      const input = { ...translationInput(), ...leakage };
      const task = makeTask('OPENCLAW_TRANSLATE', input);
      const [begin] = translationDeliveryParts(task, input);
      const toolCalls = [];
      let translateCallCount = 0;
      const callTool = async (name) => {
        toolCalls.push(name);
        if (name === 'get_parse_status') return status(WORK_ITEM_ID);
        if (name === 'begin_translation') return begin;
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };

      await assert.rejects(
        runTranslation({
          workItemId: WORK_ITEM_ID,
          callTool,
          translate: async () => {
            translateCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /FORBIDDEN_AUTHORITY_INPUT/u,
      );
      assert.equal(translateCallCount, 0);
      assert.deepEqual(toolCalls, ['get_parse_status', 'begin_translation']);
    });
  }
});

test('rejects actor identity key forms before the translation model boundary', async (t) => {
  const leakageCases = [
    ['actorId exact', { actorId: 'actor-secret' }],
    ['actorId case', { ACTORID: 'actor-secret' }],
    ['actorId separator', { 'actor-id': 'actor-secret' }],
    ['actorId NFKC', { ａｃｔｏｒＩｄ: 'actor-secret' }],
    ['actorContextRef exact', { actorContextRef: 'actor-context-secret' }],
    ['actorContextRef case', { ACTORCONTEXTREF: 'actor-context-secret' }],
    [
      'actorContextRef separator',
      { 'Actor_Context-Ref': 'actor-context-secret' },
    ],
    [
      'actorContextRef NFKC',
      { ａｃｔｏｒＣｏｎｔｅｘｔＲｅｆ: 'actor-context-secret' },
    ],
  ];

  for (const [label, leakage] of leakageCases) {
    await t.test(label, async () => {
      const input = { ...translationInput(), ...leakage };
      const task = makeTask('OPENCLAW_TRANSLATE', input);
      const [begin] = translationDeliveryParts(task, input);
      let translateCallCount = 0;
      const callTool = async (name) => {
        if (name === 'get_parse_status') return status(WORK_ITEM_ID);
        if (name === 'begin_translation') return begin;
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };

      await assert.rejects(
        runTranslation({
          workItemId: WORK_ITEM_ID,
          callTool,
          translate: async () => {
            translateCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /FORBIDDEN_AUTHORITY_INPUT/u,
      );
      assert.equal(translateCallCount, 0);
    });
  }
});

test('runs dynamic N/N and never uses old {attemptRef, output}', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const task = makeTask('OPENCLAW_DYNAMIC_EVALUATION', input);
  const begin = runningBegin(task, { modelInput: input });
  const calls = [];
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') return status(WORK_ITEM_ID);
    if (name === 'begin_dynamic_evaluation') return begin;
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      assert.equal(Object.hasOwn(args, 'output'), false);
      assert.equal(Object.hasOwn(args, 'result'), true);
      validatePayload('result-envelope', { task, result: args.result });
      assert.equal(
        JSON.parse(args.result.modelOutput).ruleResults.rows.length,
        input.jobAidContext.criterionTable.rowCount,
      );
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'BASE_RULE_CANDIDATE_READY',
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runDynamicEvaluation({
    workItemId: WORK_ITEM_ID,
    callTool,
    evaluateDynamicRules: async () => ({
      output,
      provenance: provenance(),
    }),
  });
  assert.equal(result.commitRecoveredByReadback, false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'get_parse_status',
      'begin_dynamic_evaluation',
      'heartbeat_action_attempt',
      'heartbeat_action_attempt',
      'commit_dynamic_evaluation_candidate',
      'get_parse_status',
      'get_deep_link',
    ],
  );
});

test('does one generic dynamic status recovery after commit response loss', async () => {
  const input = await readJson(DYNAMIC_FIXTURE_URL);
  const output = buildDynamicRulesOutput(input);
  const task = makeTask('OPENCLAW_DYNAMIC_EVALUATION', input);
  const calls = [];
  let submittedResult;
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'get_parse_status') {
      return status(WORK_ITEM_ID);
    }
    if (name === 'begin_dynamic_evaluation') {
      return runningBegin(task, { modelInput: input });
    }
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_dynamic_evaluation_candidate') {
      submittedResult = args.result;
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', submittedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runDynamicEvaluation({
    workItemId: WORK_ITEM_ID,
    callTool,
    evaluateDynamicRules: async () => ({ output, provenance: provenance() }),
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(
    calls.filter((name) => name === 'commit_dynamic_evaluation_candidate')
      .length,
    1,
  );
  assert.equal(calls.filter((name) => name === 'get_parse_status').length, 1);
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
  );
});

test('runs no-discovery overall from complete persisted dynamic N', async () => {
  const input = synthesisInput();
  const output = synthesisOutput(input);
  const task = makeTask('OPENCLAW_OVERALL_SYNTHESIS', {
    modelInput: input,
    selectedDiscoveryRefs: [],
    providerCodes: [],
  });
  const begin = runningBegin(task, {
    modelInput: input,
    selectedDiscoveryRefs: [],
  });
  const calls = [];
  let statusReads = 0;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'get_parse_status') {
      statusReads += 1;
      return statusReads === 1
        ? statusWithDynamic(WORK_ITEM_ID, 'REQ-DYNAMIC')
        : statusWithOverall(WORK_ITEM_ID, input.outputCorrelationRef);
    }
    if (name === 'begin_overall_synthesis') return begin;
    if (name === 'heartbeat_action_attempt') {
      return heartbeatResult(task, args);
    }
    if (name === 'commit_overall_candidate') {
      validatePayload('result-envelope', { task, result: args.result });
      return {
        workItemId: WORK_ITEM_ID,
        workItemRevision: 8,
        status: 'OVERALL_CANDIDATE_READY',
        overallSynthesis: {
          status: 'CANDIDATE_ONLY',
          authorityLevel: 'candidate_only',
          externalDiscoveryIsEvidence: false,
        },
      };
    }
    if (name === 'get_deep_link') {
      return { workItemId: WORK_ITEM_ID, deepLink: '/work-item/fixture' };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runOverallSynthesis({
    workItemId: WORK_ITEM_ID,
    providers: [],
    callTool,
    synthesizeOverall: async () => ({ output, provenance: provenance() }),
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.deepEqual(result.selectedDiscoveryRefs, []);
  assert.deepEqual(
    calls.find(({ name }) => name === 'begin_overall_synthesis').args.providers,
    [],
  );
});

test('binds Overall applicability status to the Host current candidate', () => {
  const input = synthesisInput();
  input.applicabilityResult = {
    schemaVersion: 'wiselink.3_1.overall_applicability_result.v1',
    status: 'CANDIDATE_ONLY',
    sourceResultId: 'openclaw-applicability://REQ-APPLICABILITY-001',
    inputRevision: 6,
    documentVersionId: input.baseRuleResult.documentVersionId,
    sourcePackageId: input.baseRuleResult.packageId,
    sourcePackageContentHash: 'f'.repeat(64),
    sourceExpressionCount: 1,
    sourceRefCount: 1,
    decision: 'APPLICABLE',
    kleeneResult: true,
    pass: true,
    blockingUnknownCount: 0,
  };
  const output = synthesisOutput(input);
  validatePayload('synthesis-pair', { input, output });
  assert.equal(output.applicabilityStatus, 'APPLICABLE');
  assert.throws(
    () =>
      validatePayload('synthesis-pair', {
        input,
        output: { ...output, applicabilityStatus: 'UNKNOWN/WAITING_INPUT' },
      }),
    /OVERALL_APPLICABILITY_STATUS_MISMATCH/u,
  );
});

test('Overall v2 accepts a related premise independently and keeps all premise roles and conditions', () => {
  const input = readingSynthesisInput();
  const output = readingSynthesisOutput(input);
  validatePayload('synthesis-pair', { input, output });
  assert.equal(output.engineeringSummary.claims[0].premises[0].evidenceRef, 'overall-evidence:related:1');
  assert.equal(Object.hasOwn(output.engineeringSummary, 'implementationImpact'), false);
  assert.equal(Object.hasOwn(output.engineeringSummary, 'nextActions'), false);
  output.engineeringSummary.claims[0].premises.push({ evidenceRef: input.evidenceRegistry[0].evidenceRef, role: 'LIMITS', explanation: '保留主文档限定的适用范围。', limitation: '具体构型仍需核对。' });
  validatePayload('synthesis-pair', { input, output });
  assert.equal(output.engineeringSummary.claims[0].premises.length, 2);
});

test('Overall new registry input requires v2 while a historical task retains v1 semantics', () => {
  const input = readingSynthesisInput();
  const output = synthesisOutput(input);
  assert.throws(() => validatePayload('synthesis-pair', { input, output }), /OVERALL_READING_SUMMARY_VERSION_REQUIRED/u);
  delete input.evidenceRegistry;
  validatePayload('synthesis-pair', { input, output });
  output.engineeringSummary.nextActions = [];
  assert.throws(() => validatePayload('synthesis-pair', { input, output }), /OVERALL_NEXT_ACTIONS_COUNT_INVALID/u);
});

test('Overall v2 rejects unread catalog refs, duplicate claims, missing premises and changed result bindings', () => {
  const cases = [
    [(input, output) => { input.commonContext = { relatedMaterials: { items: [{ availableSourceRefIds: ['UNREAD'] }] } }; output.engineeringSummary.claims[0].premises[0].evidenceRef = 'UNREAD'; }, /OVERALL_UNKNOWN_EVIDENCE_REF:UNREAD/u],
    [(_input, output) => { output.engineeringSummary.claims.push(structuredClone(output.engineeringSummary.claims[0])); }, /OVERALL_DUPLICATE_CLAIM_ID/u],
    [(_input, output) => { output.engineeringSummary.claims[0].premises = []; }, /OVERALL_CLAIM_PREMISES_REQUIRED/u],
    [(_input, output) => { output.engineeringSummary.decisiveClaimIds = ['MISSING']; }, /OVERALL_UNKNOWN_DECISIVE_CLAIM_ID/u],
    [(_input, output) => { output.engineeringSummary.lead = '另一个结果'; }, /OVERALL_LEAD_CANDIDATE_MISMATCH/u],
    [(_input, output) => { output.sourceResultId = 'OTHER-RESULT'; }, /OVERALL_CORRELATION_MISMATCH/u],
    [(_input, output) => { output.unresolvedCount = 0; }, /OVERALL_UNRESOLVED_COUNT_MISMATCH/u],
    [(_input, output) => { output.adopted = true; }, /OVERALL_ADOPTION_INVALID/u],
    [(input) => { input.evidenceRegistry.push(structuredClone(input.evidenceRegistry[0])); }, /OVERALL_DUPLICATE_EVIDENCE_REF/u],
    [(input) => { delete input.evidenceRegistry; }, /OVERALL_READING_EVIDENCE_REGISTRY_REQUIRED/u],
    [(input) => { input.evidenceRegistry[0].workItemId = 'WI-PRIVATE'; }, /FORBIDDEN_AUTHORITY_INPUT/u],
  ];
  for (const [change, expected] of cases) {
    const input = readingSynthesisInput();
    const output = readingSynthesisOutput(input);
    change(input, output);
    assert.throws(() => validatePayload('synthesis-pair', { input, output }), expected);
  }
});

test('Overall v2 accepts actual Host ledger fields and keeps engineering statements separate from document passages', () => {
  const input = readingSynthesisInput();
  const sourceRefId = 'overall-evidence:engineer-review:1:1';
  const artifact = { storeRole: 'UnifiedArtifactStoreCandidate', ref: 'artifact://review-evidence', sha256: 'a'.repeat(64), byteLength: 99, mediaType: 'application/json' };
  const review = {
    sequence: 1, criterionId: 'criterion-001', affectedCriterionIds: ['criterion-001'], baseRuleRevision: 1, baseRuleArtifactSha256: 'e'.repeat(64),
    actionType: 'SUPPLEMENT_EVIDENCE', decision: 'deferred', status: 'NEEDS_REVIEW', comment: '记录了工程师补充说明。', recordedAt: '2026-09-08T00:00:00.000Z',
    evidence: [{ kind: 'AIRCRAFT_FACT', statement: '工程师表示构型记录尚不完整。', locator: '工程师评审 1', sourceRefId, artifact }],
    resolvedMissingInputs: [], uncertaintyDispositions: [], decisionSnapshot: {
      decisionSnapshotRef: 'SNAPSHOT-1', revision: 2, engineerConfirmationRef: null,
      assessmentAsOf: '2026-09-08T00:00:00.000Z', evidenceHorizon: ['SOURCE_DOCUMENT_COMPLETE'], currentBestJudgment: '当前只能保留候选认识。', alternativeJudgments: [], decisionMaturity: 'PRELIMINARY', decisiveFacts: [], assumptions: [], residualUncertainties: [], uncertaintyDispositions: [], controlsAndMitigations: [], monitoringPlan: null, validUntil: null, reviewBy: null, reopenTriggers: [], whatWouldChangeDecision: [], candidateOnly: true,
    }, correctedAnalysisDirection: null,
  };
  input.engineerReviewContext = { revision: 1, artifactSha256: 'b'.repeat(64), reviewCount: 1, history: [review], effective: [structuredClone(review)] };
  input.unifiedSourceContext.sourceRefs.push({ sourceRefId, locator: review.evidence[0].locator, excerpt: review.evidence[0].statement, evidenceKind: 'AIRCRAFT_FACT', artifactRef: artifact.ref, artifactSha256: artifact.sha256 });
  input.unifiedSourceContext.sourceRefCount += 1;
  input.baseRuleResult.items[0].sourceRefIds.push(sourceRefId);
  input.evidenceRegistry.push({ evidenceRef: 'overall-evidence:engineer-review:1:1', kind: 'ENGINEER_STATEMENT', title: '工程师评审 criterion-001 · AIRCRAFT_FACT', versionLabel: 'review revision 1', excerpt: review.evidence[0].statement, locator: review.evidence[0].locator });
  const output = readingSynthesisOutput(input);
  output.engineerReviewRevision = 1;
  output.engineerReviewArtifactSha256 = input.engineerReviewContext.artifactSha256;
  output.engineeringSummary.claims[0].premises.push({ evidenceRef: 'overall-evidence:engineer-review:1:1', role: 'LIMITS', explanation: '这是工程师陈述，未成为受控构型记录。', limitation: '陈述不证明改装已经完成。' });
  validatePayload('synthesis-pair', { input, output });
  assert.equal(input.evidenceRegistry.at(-1).kind, 'ENGINEER_STATEMENT');
  assert.equal(input.evidenceRegistry.some((item) => item.kind === 'QUERY_RECEIPT'), false);
  input.engineerReviewContext.history[0].evidence[0].sourceRefId = 'review-evidence://WI-ENGINEER/1/criterion-001/1';
  assert.throws(() => validatePayload('synthesis-input', input), /FORBIDDEN_WORKITEM_VALUE/u);
});

test('Overall accepts negation and manufacturer attribution while rejecting actual approval assertions in both versions', () => {
  const allowed = ['未批准执行。', '尚未确认该机队适用。', 'This has not yet been approved for execution.', 'The fleet is not confirmed applicable.', 'Boeing states that the modification is approved; fleet matching remains unresolved.', '厂家声明：“已批准执行”是厂家立场；本机队仍需核对。'];
  const forbidden = ['已批准执行。', '已确认该机队适用。', 'The work is approved.', 'It is safe to release.', '未批准执行；但本次可以直接实施。', 'Boeing states that the modification is approved; therefore this work is approved.'];
  for (const reading of [false, true]) {
    for (const [narratives, rejected] of [[allowed, false], [forbidden, true]]) {
      for (const narrative of narratives) {
        const input = reading ? readingSynthesisInput() : synthesisInput();
        const output = reading ? readingSynthesisOutput(input) : synthesisOutput(input);
        output.overallCandidate = narrative;
        if (reading) output.engineeringSummary.lead = narrative;
        else output.engineeringSummary.conclusion.text = narrative;
        const validate = () => validatePayload('synthesis-pair', { input, output });
        if (rejected) assert.throws(validate, /OVERALL_AUTHORITATIVE_NARRATIVE_FORBIDDEN/u, narrative);
        else assert.doesNotThrow(validate, narrative);
      }
    }
  }
});

test('official initial model adapter selects the Overall v2 contract and sends the entire registered passage', async () => {
  const modelInput = readingSynthesisInput();
  modelInput.evidenceRegistry[0].excerpt = `${'Source context. '.repeat(500)}This does not approve operator execution.`;
  const candidate = readingSynthesisOutput(modelInput);
  const result = await invokeInitialWithTransport({ operation: 'SYNTHESIZE_OVERALL', modelInput }, {
    gatewayChatCompletionsEnabled: true, gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'miaoda/miaoda-model-auto', sessionDiscriminator: 'v2-test',
  }, { requestGateway: async (_url, init) => {
    const request = JSON.parse(init.body);
    const guidance = request.messages[0].content;
    assert.match(guidance, /overall_engineering_summary\.v2/u);
    assert.doesNotMatch(guidance, /overall_engineering_summary\.v1/u);
    assert.match(guidance, /no implementation decision/u);
    assert.match(request.tools[0].function.parameters.properties.candidate.description, /decisiveClaimIds/u);
    assert.deepEqual(JSON.parse(request.messages[1].content), modelInput);
    assert.doesNotMatch(JSON.stringify(request.messages), /"workItemId"/u);
    return Response.json({ model: 'actual-official-model', choices: [{ message: { content: null, tool_calls: [{ type: 'function', function: { name: 'return_wiselink_initial_candidate', arguments: JSON.stringify({ candidate }) } }] } }] });
  } });
  assert.deepEqual(result.output, candidate);
});

test('Matter Review c4 validates exact Host deltas while retaining the WorkItem c3 contract', async () => {
  for (const turnNo of [1, 2]) {
    const { reviewTask, delta } = await matterReviewFixture(turnNo);
    validatePayload('review-task', reviewTask);
    validateReviewCandidate(reviewTask, matterReviewCandidate(reviewTask, delta));
    validateReviewCandidate(reviewTask, matterReviewCandidate(reviewTask, null));
  }
  const { reviewTask, delta } = await matterReviewFixture(2);
  for (const [name, mutate, error] of [
    ['missing delta', (candidate) => { delete candidate.matterWorkingDelta; }, /MATTERWORKINGDELTA|matterWorkingDelta/u],
    ['old candidate schema', (candidate) => { candidate.schemaVersion = 'wiselink.3_1.review_turn_candidate.v1.c3'; }, /REVIEW_CANDIDATE_SCHEMA_UNSUPPORTED/u],
    ['formal action', (candidate) => { candidate.reviewActionDraft = {}; }, /REVIEW_MATTER_FORMAL_ACTION_FORBIDDEN/u],
    ['affected item', (candidate) => { candidate.affectedItemIds = ['criterion-001']; }, /REVIEW_MATTER_AFFECTED_ITEMS_FORBIDDEN/u],
    ['wrong replacement id', (candidate) => { candidate.matterWorkingDelta.claimDelta.replacements[0].claimId = 'invented-replacement'; }, /REVIEW_MATTER_EXISTING_ID_REQUIRED/u],
    ['lost unchanged claim', (candidate) => { candidate.matterWorkingDelta.claimDelta.explicitlyUnchangedClaimIds.pop(); }, /REVIEW_MATTER_CARRY_FORWARD_INCOMPLETE/u],
    ['overlapping change', (candidate) => { candidate.matterWorkingDelta.claimDelta.explicitlyUnchangedClaimIds.push('claim-origin'); }, /REVIEW_MATTER_DELTA_OVERLAP/u],
    ['unregistered premise', (candidate) => { candidate.matterWorkingDelta.claimDelta.replacements[0].premises[0].evidenceRef = 'unknown-evidence'; }, /REVIEW_MATTER_PREMISE_NOT_ALLOWED/u],
    ['presentation omitted', (candidate) => { candidate.matterWorkingDelta.readingPresentation = null; }, /REVIEW_MATTER_PRESENTATION_DELTA_REQUIRED/u],
    ['cross-document coverage', (candidate) => { candidate.matterWorkingDelta.coverageUpdates[0].inputRef = 'matter-input:2'; }, /REVIEW_MATTER_COVERAGE_SOURCE_NOT_ALLOWED/u],
    ['empty checked range', (candidate) => { candidate.matterWorkingDelta.coverageUpdates[0].checkedSourceRefIds = []; }, /REVIEW_MATTER_CHECKED_RANGE_REQUIRED/u],
    ['used input labelled unchanged', (candidate) => { candidate.matterWorkingDelta.coverageUpdates[0].contribution = 'NO_MATERIAL_CHANGE'; }, /REVIEW_MATTER_SUBSTANTIVE_INPUT_NOT_COVERED/u],
    ['unused input labelled substantive', (candidate) => { candidate.matterWorkingDelta.coverageUpdates.push({ inputRef: 'matter-input:3', checkedSourceRefIds: ['matter-source:3:1'], checkedScope: 'Read one passage', contribution: 'SUBSTANTIVE', reason: 'Incorrectly claims contribution without a cited premise' }); }, /REVIEW_MATTER_SUBSTANTIVE_INPUT_UNUSED/u],
    ['private control in delta', (candidate) => { candidate.matterWorkingDelta.expectedWorkingRevision = 1; }, /REVIEW_MATTER_DELTA_UNKNOWN_FIELD/u],
  ]) {
    const candidate = matterReviewCandidate(reviewTask, structuredClone(delta));
    mutate(candidate);
    assert.throws(() => validateReviewCandidate(reviewTask, candidate), error, name);
  }
  const missingRetainedCoverage = structuredClone(reviewTask);
  missingRetainedCoverage.matterContext.workingState.coverage = missingRetainedCoverage.matterContext.workingState.coverage.filter((item) => item.binding.inputId !== missingRetainedCoverage.matterContext.scope.inputs[1].inputId);
  assert.throws(() => validateReviewCandidate(missingRetainedCoverage, matterReviewCandidate(missingRetainedCoverage, delta)), /REVIEW_MATTER_SUBSTANTIVE_INPUT_NOT_COVERED/u);
  const missingContext = structuredClone(reviewTask);
  delete missingContext.matterContext;
  assert.throws(() => validatePayload('review-task', missingContext), /REVIEW_TASK_MISSING_FIELD:matterContext/u);
  const wrongPolicy = structuredClone(reviewTask);
  wrongPolicy.executionPolicy.toolPolicyRef = 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-review-c3';
  assert.throws(() => validatePayload('review-task', wrongPolicy), /REVIEW_TASK_TOOL_POLICY_INVALID/u);
  const legacyTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const legacyCandidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  validateReviewCandidate(legacyTask, legacyCandidate);
  assert.throws(() => validateReviewCandidate(legacyTask, { ...legacyCandidate, matterWorkingDelta: null }), /REVIEW_CANDIDATE_UNKNOWN_FIELD:matterWorkingDelta/u);
  assert.throws(() => validatePayload('review-task', { ...legacyTask, matterContext: reviewTask.matterContext }), /REVIEW_TASK_UNKNOWN_FIELD:matterContext/u);
});

test('Matter Review c4 continues two native turns with scoped source keys, preserved claims and delta provenance', async (t) => {
  const directories = [];
  t.after(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
  const requests = [];
  const reads = [];
  const submitted = [];
  const nativeSessionKey = 'agent:wiselink-engineering:review:ACTX-RS-matter-private';
  for (const turnNo of [1, 2]) {
    const { reviewTask, delta } = await matterReviewFixture(turnNo);
    const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], reviewTask.resourceRefs.map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
    task.executionModel = modelSelection('miaoda/minimax-m3');
    const { inputHash: _inputHash, ...unsealed } = task;
    task.inputHash = canonicalSha256(unsealed);
    const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-matter-review-'));
    directories.push(checkpointDir);
    const requested = turnNo === 1 ? ['matter-source:1:1', 'matter-source:2:1'] : ['matter-source:1:1'];
    let modelCalls = 0;
    const result = await runHostedReviewTurn({ reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir }, {
      callTool: async (name, args) => {
        if (name === 'heartbeat_action_attempt') return reviewProgressHeartbeat(task, args);
        if (name === 'begin_review_turn') return runningBegin(task, { nativeSessionKey });
        if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
        if (name === 'read_source_refs') {
          reads.push({ turnNo, ids: args.sourceRefIds });
          return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef,
            sourceRefs: args.sourceRefIds.map((id) => structuredClone(reviewTask.resourceRefs.find((ref) => ref.sourceRefId === id).value)) };
        }
        if (name === 'commit_review_turn_candidate') {
          const result = JSON.parse(args.resultJson);
          validatePayload('result-envelope', { task, result });
          submitted.push(result);
          assert.deepEqual(result.factsConsidered, requested);
          assert.deepEqual(result.sourceRefs, reviewTask.resourceRefs.slice(0, requested.length).map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
          return reviewCommit(task.operationRef);
        }
        throw new Error('UNEXPECTED_TOOL:' + name);
      },
      invokeModel: (input, hooks) => invokeReviewWithTransport(input, {
        gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
        registeredModelRefs: ['miaoda/minimax-m3'], ...hooks,
      }, { requestGateway: async (_url, init) => {
        const body = JSON.parse(init.body);
        requests.push({ body, headers: init.headers });
        modelCalls += 1;
        const serialized = JSON.stringify(body.messages);
        for (const forbidden of [reviewTask.reviewTurnRef, reviewTask.reviewConversationRef, reviewTask.requestId,
          reviewTask.actorContextRef, reviewTask.matterContext.scope.matterId,
          ...reviewTask.matterContext.scope.inputs.map((binding) => binding.workItemId),
          'matterContext', 'engineerSuppliedInputId', 'resourceArtifactRef', 'urn:source:shared-original-page']) {
          assert.equal(serialized.includes(forbidden), false, forbidden);
        }
        const schema = body.tools.find((tool) => tool.function.name === 'return_wiselink_review_candidate').function.parameters;
        assert.deepEqual(schema.required, ['candidateJson']);
        assert.equal(schema.properties.candidateJson.type, 'string');
        assert.deepEqual(Object.keys(schema.properties), ['candidateJson']);
        assert.equal(body.tool_choice, 'required');
        assert.equal(body.max_completion_tokens, 524_288);
        if (modelCalls === 1) {
          assert.equal(serialized.includes('SOURCE_A_FULL_PASSAGE'), false);
          assert.equal(serialized.includes('SOURCE_B_FULL_PASSAGE'), false);
          assert.equal(serialized.includes('SOURCE_C_UNREAD_PASSAGE'), false);
          assert.ok(serialized.includes(reviewTask.matterContext.readingEvidence.at(-1).excerpt));
          assert.match(body.messages[1].content, /INITIAL_SYNTHESIS/u);
          assert.match(body.messages[1].content, /not force an implementation/u);
          assert.match(body.messages[1].content, /reviewActionDraft=null and affectedItemIds=\[\]/u);
          assert.match(body.messages[1].content, /single candidateJson string parameter/u);
          assert.match(body.messages[1].content, /headline, listBrief and lead are each one nonempty string/u);
          if (turnNo === 2) {
            assert.ok(serialized.includes('claim-independent'));
            assert.ok(serialized.includes('claim-engineer'));
          }
        } else {
          assert.deepEqual(body.messages.map((message) => message.role), ['system', 'assistant', 'tool']);
          const fragments = JSON.parse(body.messages[2].content).sourceRefs;
          assert.deepEqual(fragments.map((item) => item.sourceRefId), requested);
          assert.deepEqual(fragments.map((item) => item.evidenceRef), requested.map((id) => reviewTask.resourceRefs.find((ref) => ref.sourceRefId === id).value.evidenceRef));
          assert.ok(fragments[0].quote.startsWith('SOURCE_A_FULL_PASSAGE'));
          if (turnNo === 1) assert.ok(fragments[1].quote.startsWith('SOURCE_B_FULL_PASSAGE'));
          assert.equal(serialized.includes('SOURCE_C_UNREAD_PASSAGE'), false);
        }
        return Response.json({ model: 'fixture/provider', choices: [{ message: { content: null, tool_calls: [{
          id: 'matter-call-' + turnNo + '-' + modelCalls, type: 'function', function: {
            name: modelCalls === 1 ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
            arguments: JSON.stringify(modelCalls === 1 ? { sourceRefIds: requested } : {
              candidateJson: JSON.stringify(matterReviewModelOutput(delta)),
            }),
          },
        }] } }] });
      } }),
    });
    assert.equal(result.ok, true);
    assert.equal(result.sessionRouting, 'HOST_SCOPED');
    assert.equal(modelCalls, 2);
    for (const name of ['model.output-shape.json', 'model.output-shape-2.json']) {
      const shape = JSON.parse(await readFile(join(checkpointDir, name), 'utf8'));
      assert.equal(shape.value.requestedMaxCompletionTokens, 524_288);
    }
  }
  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ headers, body }) => headers['x-openclaw-session-key'] === nativeSessionKey && !Object.hasOwn(body, 'user')));
  assert.deepEqual(reads, [{ turnNo: 1, ids: ['matter-source:1:1', 'matter-source:2:1'] }, { turnNo: 2, ids: ['matter-source:1:1'] }]);
  const candidates = submitted.map((result) => JSON.parse(result.modelOutput));
  assert.ok(candidates.every((candidate) => candidate.schemaVersion === 'wiselink.3_1.review_turn_candidate.v1.c4' && candidate.sourceRefs.length === 0));
  assert.equal(candidates[1].matterWorkingDelta.claimDelta.replacements[0].claimId, candidates[0].matterWorkingDelta.claimDelta.additions[0].claimId);
  assert.deepEqual(candidates[1].matterWorkingDelta.claimDelta.explicitlyUnchangedClaimIds, ['claim-independent', 'claim-engineer']);
  assert.ok(submitted.every((result) => result.modelVersion === 'fixture/provider' && result.skillVersion === WISELINK_SKILL_VERSION && result.toolVersions[WISELINK_HOST_MCP_NAME] === WISELINK_HOST_MCP_VERSION));
});

test('Matter candidate validation feeds two corrections into the same native session before one Host commit', async (t) => {
  const { reviewTask, delta } = await matterReviewFixture(1);
  const extra = { ...reviewTask.matterContext.readingEvidence[0], evidenceRef: 'matter-evidence:revision:1:document:1:2',
    sourceRefId: 'urn:source:another-page', excerpt: 'Another checked passage in document A.' };
  reviewTask.matterContext.readingEvidence.splice(1, 0, extra);
  reviewTask.matterContext.evidenceSources.push({ evidenceRef: extra.evidenceRef, sourceRefId: 'matter-source:1:2', inputId: reviewTask.matterContext.scope.inputs[0].inputId });
  const resource = structuredClone(reviewTask.resourceRefs[0]);
  resource.sourceRefId = resource.value.sourceRefId = 'matter-source:1:2';
  resource.value.evidenceRef = extra.evidenceRef;
  resource.value.quote = extra.excerpt;
  reviewTask.resourceRefs.push(resource);
  reviewTask.context.matterWorking.evidenceCatalog.push({ evidenceRef: extra.evidenceRef, kind: extra.kind,
    title: extra.title, versionLabel: extra.versionLabel, locator: extra.locator, sourceRefId: resource.sourceRefId, providedText: null });
  const artifacts = [...new Map(reviewTask.resourceRefs.map((ref) => [ref.resourceArtifactRef,
    { ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 }])).values()];
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], artifacts);
  task.executionModel = modelSelection('miaoda/minimax-m3');
  const { inputHash: _inputHash, ...unsealed } = task;
  task.inputHash = canonicalSha256(unsealed);
  const nativeSessionKey = 'agent:wiselink-engineering:review:ACTX-RS-matter-private';
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-matter-correction-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const requested = ['matter-source:1:1', 'matter-source:2:1', 'matter-source:1:2'];
  const feedback = [];
  const calls = [];
  let modelCalls = 0;
  let committed;
  const result = await runHostedReviewTurn({ reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir }, {
    callTool: async (name, args) => {
      calls.push(name);
      if (name === 'heartbeat_action_attempt') return reviewProgressHeartbeat(task, args);
      if (name === 'begin_review_turn') return runningBegin(task, { nativeSessionKey });
      if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
      if (name === 'read_source_refs') return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((id) => structuredClone(reviewTask.resourceRefs.find((ref) => ref.sourceRefId === id).value)),
      };
      if (name === 'commit_review_turn_candidate') {
        const sealed = JSON.parse(args.resultJson);
        validatePayload('result-envelope', { task, result: sealed });
        committed = JSON.parse(sealed.modelOutput);
        return reviewCommit(task.operationRef);
      }
      throw new Error('UNEXPECTED_TOOL:' + name);
    },
    invokeModel: (input, hooks) => invokeReviewWithTransport(input, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
      registeredModelRefs: ['miaoda/minimax-m3'], ...hooks,
    }, { requestGateway: async (_url, init) => {
      modelCalls += 1;
      assert.equal(calls.includes('commit_review_turn_candidate'), false);
      assert.equal(init.headers['x-openclaw-session-key'], nativeSessionKey);
      const body = JSON.parse(init.body);
      assert.equal(body.max_completion_tokens, 524_288);
      assert.equal(body.tool_choice, 'required');
      if (modelCalls >= 3) {
        assert.deepEqual(body.messages.map((message) => message.role), ['system', 'assistant', 'tool']);
        const receipt = JSON.parse(body.messages[2].content);
        feedback.push(receipt);
        assert.equal(receipt.candidateAccepted, false);
        const registered = [...requested.map((id) => reviewTask.resourceRefs.find((ref) => ref.sourceRefId === id).value.evidenceRef), reviewTask.matterContext.readingEvidence.at(-1).evidenceRef];
        assert.deepEqual(new Set(receipt.availableEvidenceRefs), new Set(registered));
        for (const privateValue of [reviewTask.requestId, reviewTask.reviewTurnRef, reviewTask.reviewConversationRef, task.operationRef]) {
          assert.equal(body.messages[2].content.includes(privateValue), false);
        }
      }
      const output = matterReviewModelOutput(structuredClone(delta));
      if (modelCalls === 2) output.matterWorkingDelta.readingPresentation.listBrief = ['Wrong array type'];
      // Both passages were really read, but coverage of page 2 cannot cover
      // the page 1 premise. The model must repair its own declared range.
      if (modelCalls === 3) output.matterWorkingDelta.coverageUpdates[0].checkedSourceRefIds = ['matter-source:1:2'];
      return Response.json({ model: 'fixture/provider', choices: [{ message: { content: null, tool_calls: [{
        id: `correction-call-${modelCalls}`, type: 'function', function: {
          name: modelCalls === 1 ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
          arguments: JSON.stringify(modelCalls === 1 ? { sourceRefIds: requested } : { candidateJson: JSON.stringify(output) }),
        },
      }] } }] });
    } }),
  });
  assert.equal(result.ok, true);
  assert.equal(modelCalls, 4);
  assert.equal(calls.filter((name) => name === 'read_source_refs').length, 1);
  assert.equal(calls.filter((name) => name === 'commit_review_turn_candidate').length, 1);
  assert.deepEqual(committed.matterWorkingDelta, delta);
  assert.deepEqual(feedback.map((entry) => entry.validationError), ['OVERALL_LIST_BRIEF_INVALID', 'REVIEW_MATTER_DOCUMENT_EVIDENCE_NOT_CHECKED']);
  for (const correctionNo of [1, 2]) {
    const path = join(checkpointDir, `candidate-rejection-${correctionNo}.json`);
    const receipt = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(receipt.correctionNo, correctionNo);
    assert.equal(receipt.modelRound, correctionNo + 1);
    assert.equal(receipt.errorCode, feedback[correctionNo - 1].validationError);
    assert.equal((await stat(path)).mode & 0o077, 0);
  }
});

test('Matter candidate corrections keep their original deadline and stop after exhaustion, lease loss or an unexpected failure', async () => {
  for (const scenario of ['exhausted', 'lease-lost', 'deadline', 'unexpected']) {
    let requests = 0;
    let renewals = 0;
    const rejected = [];
    const validationError = scenario === 'unexpected' ? 'INTERNAL_VALIDATOR_FAILURE' : 'REVIEW_MATTER_PREMISE_NOT_ALLOWED';
    await assert.rejects(invokeReviewWithTransport({ input: { context: { matterWorking: {} } } }, {
      gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
      ...(scenario === 'deadline' ? { timeoutMs: 20 } : {}),
      validateCandidate: async () => {
        if (scenario === 'deadline') await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error(validationError);
      },
      observeCandidateRejection: (value) => rejected.push(value),
      observeProgress: () => {
        renewals += 1;
        if (scenario === 'lease-lost' && renewals === 2) throw new Error('HOST_LEASE_LOST');
      },
    }, { requestGateway: async () => {
      requests += 1;
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{
        id: `bounded-call-${requests}`, type: 'function', function: {
          name: 'return_wiselink_review_candidate', arguments: JSON.stringify({ candidateJson: JSON.stringify(matterReviewModelOutput(null)) }),
        },
      }] } }] });
    } }), new RegExp(scenario === 'lease-lost' ? 'HOST_LEASE_LOST' : scenario === 'deadline' ? 'REVIEW_MODEL_TIMEOUT' : validationError, 'u'), scenario);
    assert.equal(requests, scenario === 'exhausted' ? 3 : 1, scenario);
    assert.equal(rejected.length, scenario === 'exhausted' ? 2 : scenario === 'unexpected' ? 0 : 1, scenario);
  }
});

test('Matter native JSON transport rejects wrappers without repairing model output', async () => {
  const output = matterReviewModelOutput(null);
  const request = (args) => invokeReviewWithTransport({ input: { context: { matterWorking: {} } } }, {
    gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
  }, { requestGateway: async () => Response.json({ choices: [{ message: { content: null, tool_calls: [{
    type: 'function', function: { name: 'return_wiselink_review_candidate', arguments: JSON.stringify(args) },
  }] } }] }) });
  for (const args of [output, { candidateJson: output }, { candidateJson: JSON.stringify(output), extra: true }]) {
    await assert.rejects(request(args), /REVIEW_MATTER_CANDIDATE_JSON_REQUIRED/u);
  }
  for (const candidateJson of ['```json\n{}\n```', '[]', 'null', 'explanation {}', '{broken}']) {
    await assert.rejects(request({ candidateJson }), /REVIEW_MODEL_(STRICT_JSON_REQUIRED|JSON_INVALID)/u);
  }
  output.answer = '保留 "Windows 7"、反斜杠 \\、换行\n以及 null 和空数组的含义。';
  assert.deepEqual((await request({ candidateJson: JSON.stringify(output) })).output, output);
});

test('Matter native JSON candidates still reject unread sources and formal actions before any commit', async (t) => {
  for (const [name, mutate, error] of [
    ['unread source', (output) => { output.sourceRefs = ['matter-source:1:1']; }, /REVIEW_MODEL_SOURCE_REF_NOT_READ/u],
    ['formal action', (output) => { output.reviewActionDraft = {}; }, /REVIEW_MODEL_MATTER_DELTA_INVALID/u],
    ['array wrapper', (output) => { output.missingInputs = { item: [] }; }, /REVIEW_MODEL_MISSINGINPUTS_INVALID/u],
    ['nested claim array', (output, delta) => { output.matterWorkingDelta = structuredClone(delta); output.matterWorkingDelta.claimDelta.additions = { item: delta.claimDelta.additions }; }, /REVIEW_MATTER_/u],
    ['list brief array', (output, delta) => { output.matterWorkingDelta = structuredClone(delta); output.matterWorkingDelta.readingPresentation.listBrief = ['Brief returned as an array']; }, /OVERALL_LIST_BRIEF_INVALID/u],
    ['control binding', (output) => { output.leaseToken = 'model-invented'; }, /REVIEW_MODEL_OUTPUT_KEYS_INVALID/u],
  ]) {
    const { reviewTask, delta } = await matterReviewFixture(1);
    const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], reviewTask.resourceRefs.map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
    const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-matter-json-reject-'));
    t.after(() => rm(checkpointDir, { recursive: true, force: true }));
    const output = matterReviewModelOutput(null);
    mutate(output, delta);
    const calls = [];
    await assert.rejects(runHostedReviewTurn({ reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir }, {
      callTool: async (tool, args) => {
        calls.push(tool);
        if (tool === 'heartbeat_action_attempt') return reviewProgressHeartbeat(task, args);
        if (tool === 'begin_review_turn') return runningBegin(task);
        if (tool === 'get_review_turn_context') return reviewContext(task, reviewTask);
        throw new Error('UNEXPECTED_TOOL:' + tool);
      },
      invokeModel: (input, hooks) => invokeReviewWithTransport(input, {
        gatewayUrl: 'https://official.invalid', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider', ...hooks,
      }, { requestGateway: async () => Response.json({ choices: [{ message: { content: null, tool_calls: [{
        type: 'function', function: { name: 'return_wiselink_review_candidate', arguments: JSON.stringify({ candidateJson: JSON.stringify(output) }) },
      }] } }] }) }),
    }), error, name);
    assert.equal(calls.includes('commit_review_turn_candidate'), false, name);
  }
});

test('Matter Review c4 plain explanations retain a null delta without source reads or a fabricated working revision', async (t) => {
  const directories = [];
  t.after(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
  for (const turnNo of [1, 2]) {
    const { reviewTask } = await matterReviewFixture(turnNo);
    const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], reviewTask.resourceRefs.map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
    const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-matter-explanation-'));
    directories.push(checkpointDir);
    const calls = [];
    const result = await runHostedReviewTurn({ reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir }, {
      callTool: async (name, args) => {
        calls.push(name);
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
        if (name === 'commit_review_turn_candidate') {
          const sealed = JSON.parse(args.resultJson);
          assert.deepEqual(sealed.sourceRefs, []);
          assert.deepEqual(sealed.factsConsidered, []);
          const candidate = JSON.parse(sealed.modelOutput);
          assert.equal(candidate.schemaVersion, 'wiselink.3_1.review_turn_candidate.v1.c4');
          assert.equal(candidate.matterWorkingDelta, null);
          assert.equal(candidate.reviewActionDraft, null);
          return reviewCommit(task.operationRef);
        }
        throw new Error('UNEXPECTED_TOOL:' + name);
      },
      invokeModel: async (input) => {
        assert.equal(input.input.context.matterWorking.workingRevision, turnNo - 1);
        return { output: matterReviewModelOutput(null), provenance: provenance() };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, ['begin_review_turn', 'get_review_turn_context', 'commit_review_turn_candidate']);
  }
});

test('Matter Review c4 keeps authorized engineer attachments on their existing source read path', async (t) => {
  const { reviewTask } = await matterReviewFixture(1);
  const attachment = { sourceRefId: 'review-attachment:fixture-1', resourceArtifactRef: 'artifact://fixture/matter-attachment',
    resourceArtifactSha256: 'd'.repeat(64), value: { sourceRefId: 'review-attachment:fixture-1', kind: 'ENGINEER_ATTACHMENT', statement: '工程师提供的补充附件内容。' } };
  reviewTask.resourceRefs.push(attachment);
  reviewTask.attachmentRefs = [attachment.sourceRefId];
  reviewTask.context.engineerInput = { text: '请解释这份补充材料。', attachmentRefs: [attachment.sourceRefId] };
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], reviewTask.resourceRefs.map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-matter-attachment-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  let reads = 0;
  const result = await runHostedReviewTurn({ reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir }, {
    callTool: async (name, args) => {
      if (name === 'begin_review_turn') return runningBegin(task);
      if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
      if (name === 'read_source_refs') {
        reads += 1;
        assert.deepEqual(args.sourceRefIds, [attachment.sourceRefId]);
        return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef, sourceRefs: [attachment.value] };
      }
      if (name === 'commit_review_turn_candidate') {
        const sealed = JSON.parse(args.resultJson);
        assert.deepEqual(sealed.sourceRefs, [{ ref: attachment.resourceArtifactRef, sha256: attachment.resourceArtifactSha256 }]);
        const candidate = JSON.parse(sealed.modelOutput);
        assert.equal(candidate.schemaVersion, 'wiselink.3_1.review_turn_candidate.v1.c4');
        assert.equal(candidate.matterWorkingDelta, null);
        assert.deepEqual(candidate.candidateEvidenceRefs, [attachment.sourceRefId]);
        return reviewCommit(task.operationRef);
      }
      throw new Error('UNEXPECTED_TOOL:' + name);
    },
    invokeModel: async (_input, { readSourceRefs }) => {
      const values = await readSourceRefs([attachment.sourceRefId]);
      assert.equal(values[0].statement, attachment.value.statement);
      return { output: { ...matterReviewModelOutput(null), responseType: 'CANDIDATE_EVIDENCE',
        sourceRefs: [attachment.sourceRefId], candidateEvidenceRefs: [attachment.sourceRefId] }, provenance: provenance() };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 1);
});

test('Matter Review c4 rejects unread delta premises, unchecked coverage and mismatched fragment identities before commit', async () => {
  for (const scenario of ['unread changed premise', 'unread coverage', 'wrong evidence binding', 'unprovided engineer statement']) {
    const { reviewTask, delta } = await matterReviewFixture(2);
    if (scenario === 'unread coverage') {
      delta.claimDelta = null;
      delta.readingPresentation = null;
    }
    if (scenario === 'unprovided engineer statement') {
      reviewTask.context.matterWorking.evidenceCatalog.at(-1).providedText = null;
    }
    const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], reviewTask.resourceRefs.map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
    let commits = 0;
    const reading = scenario === 'wrong evidence binding' || scenario === 'unprovided engineer statement';
    await assert.rejects(runInteractiveReviewTurn({ mode: 'INTERACTIVE_REVIEW', reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId,
      callTool: async (name, args) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
        if (name === 'read_source_refs') {
          const value = structuredClone(reviewTask.resourceRefs[0].value);
          if (scenario === 'wrong evidence binding') value.evidenceRef = reviewTask.resourceRefs[1].value.evidenceRef;
          return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef, sourceRefs: [value] };
        }
        if (name === 'commit_review_turn_candidate') { commits += 1; throw new Error('COMMIT_MUST_NOT_RUN'); }
        throw new Error('UNEXPECTED_TOOL:' + name);
      },
      respond: async ({ readSourceRefs }) => {
        if (reading) await readSourceRefs(['matter-source:1:1']);
        return { output: matterReviewCandidate(reviewTask, delta), provenance: provenance() };
      },
    }), scenario === 'wrong evidence binding' ? /HOST_MCP_REVIEW_MATTER_SOURCE_BINDING_INVALID/u
      : scenario === 'unprovided engineer statement' ? /REVIEW_MATTER_PREMISE_NOT_PROVIDED_OR_READ_THIS_TURN/u
        : /REVIEW_CANDIDATE_SOURCE_REF_NOT_READ_THIS_TURN/u, scenario);
    assert.equal(commits, 0, scenario);
  }
});

test('Matter Review c4 preserves model privacy guards and requires a matching safe Matter context', async () => {
  for (const scenario of ['private context', 'normalized private context', 'actor', 'credential', 'missing safe context']) {
    const { reviewTask } = await matterReviewFixture(1);
    const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [], reviewTask.resourceRefs.map((ref) => ({ ref: ref.resourceArtifactRef, sha256: ref.resourceArtifactSha256 })));
    let modelCalls = 0;
    await assert.rejects(runInteractiveReviewTurn({ mode: 'INTERACTIVE_REVIEW', reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId,
      callTool: async (name) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') {
          const result = reviewContext(task, reviewTask);
          if (scenario === 'missing safe context') delete result.context.matterWorking;
          else if (scenario === 'private context') result.context.matterContext = reviewTask.matterContext;
          else if (scenario === 'normalized private context') result.context.matterWorking.matter_Context = reviewTask.matterContext;
          else if (scenario === 'actor') result.context.matterWorking.actorId = 'actor-private';
          else result.context.matterWorking.evidenceCatalog.at(-1).providedText = 'Bearer private-fixture-secret';
          return result;
        }
        throw new Error('UNEXPECTED_TOOL:' + name);
      },
      respond: async () => { modelCalls += 1; throw new Error('MODEL_MUST_NOT_RUN'); },
    }), scenario === 'missing safe context' ? /HOST_MCP_REVIEW_MATTER_CONTEXT_BINDING_INVALID/u
      : scenario === 'credential' ? /REVIEW_MODEL_CREDENTIAL_FORBIDDEN/u : /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u, scenario);
    assert.equal(modelCalls, 0, scenario);
  }
});

test('validates the exact C3 review task and candidate fixtures', async () => {
  const task = await readJson(REVIEW_TASK_FIXTURE_URL);
  const attachmentTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  validatePayload('review-task', task);
  validatePayload('review-task', attachmentTask);
  validatePayload('review-candidate', { task, candidate });
});

test('rejects SOURCE_LINK without a structured SourceRef', async () => {
  const task = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  candidate.sourceRefs = [];
  assert.throws(
    () => validatePayload('review-candidate', { task, candidate }),
    /REVIEW_CANDIDATE_SOURCE_LINK_REF_REQUIRED/u,
  );
});

test('runs INTERACTIVE_REVIEW through only the five-tool C3 contract', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const begin = runningBegin(task);
  const calls = [];
  let modelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return begin;
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      assert.deepEqual(Object.keys(args).sort(), [
        'attemptRef',
        'leaseGeneration',
        'leaseToken',
        'resultJson',
      ]);
      const submittedResult = JSON.parse(args.resultJson);
      validatePayload('result-envelope', { task, result: submittedResult });
      assert.equal(submittedResult.skillVersion, WISELINK_SKILL_VERSION);
      assert.deepEqual(submittedResult.sourceRefs, [
        {
          ref: ARTIFACT_REF,
          sha256: ARTIFACT_SHA,
        },
      ]);
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async ({ input, readSourceRefs }) => {
      modelInput = input;
      const refs = await readSourceRefs([
        reviewTask.resourceRefs[0].sourceRefId,
      ]);
      assert.equal(refs[0].sourceRefId, reviewTask.resourceRefs[0].sourceRefId);
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.equal(
    JSON.stringify(modelInput).includes('WI-control-plane-only'),
    false,
  );
  assert.equal(
    JSON.stringify(modelInput).includes('ACTX-opaque-fixture'),
    false,
  );
  assert.equal(
    JSON.stringify(modelInput).includes(reviewTask.reviewConversationRef),
    false,
  );
  assert.equal(
    JSON.stringify(modelInput).includes(reviewTask.requestId),
    false,
  );
  assert.equal(Object.hasOwn(modelInput, 'executionPolicy'), false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_review_turn',
      'get_review_turn_context',
      'read_source_refs',
      'commit_review_turn_candidate',
    ],
  );
  assert.ok(calls.every(({ name }) => INTERACTIVE_REVIEW_TOOLS.includes(name)));
});

test('stops a SOURCE_LINK without SourceRefs before review commit', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-source-link-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      throw new Error('COMMIT_MUST_NOT_RUN');
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };

  await assert.rejects(
    runHostedReviewTurn(
      {
        reviewConversationRef: reviewTask.reviewConversationRef,
        requestId: reviewTask.requestId,
        checkpointDir,
      },
      {
        callTool,
        invokeModel: async () => ({
          output: {
            responseType: 'SOURCE_LINK',
            answer: '正文声称存在来源，但结构化引用缺失。',
            sourceRefs: [],
            missingInputs: [],
            candidateEvidenceRefs: [],
            reviewActionDraft: null,
            affectedItemIds: [],
            warnings: ['candidate_only'],
          },
          provenance: provenance(),
        }),
      },
    ),
    /REVIEW_MODEL_SOURCE_LINK_REF_REQUIRED/u,
  );
  assert.deepEqual(
    calls.map(({ name }) => name),
    ['begin_review_turn', 'get_review_turn_context'],
  );
});

test('runs a review turn from durable checkpoints without replaying remote work', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  reviewTask.context.evaluation.gapLedger = {
    schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1',
    inputRevision: reviewTask.inputRevision,
    baseRuleRevision: 1,
    currentness: 'CURRENT',
    candidateOnly: true,
    gaps: [
      {
        gapRef: 'GAP-001',
        authority: {
          owner: 'CANONICAL_HOST',
          candidateOnly: true,
          modelMayClose: false,
          queryResultIsFact: false,
        },
      },
    ],
  };
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  const modelInputs = [];
  const modelSessionDiscriminators = [];
  let shapeObserverCalls = 0;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      assert.deepEqual(Object.keys(args).sort(), [
        'attemptRef',
        'leaseGeneration',
        'leaseToken',
        'resultJson',
      ]);
      assert.equal(Object.hasOwn(args, 'result'), false);
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const invokeModel = async (
    input,
    { observeOutputShape, sessionDiscriminator, readSourceRefs },
  ) => {
    assert.deepEqual(input.sourceRefs, []);
    await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
    modelInputs.push(input);
    modelSessionDiscriminators.push(sessionDiscriminator);
    shapeObserverCalls += 1;
    await observeOutputShape(
      summarizeHostedReviewModelOutputShape({
        httpStatus: 200,
        httpOk: true,
        requestedModel: 'openclaw/wiselink-engineering',
        payload: {
          provider: 'openai-codex',
          model: 'gpt-5.4',
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: null,
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: 'return_wiselink_review_candidate',
                      arguments:
                        '{"private":"MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED"}',
                    },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    return {
      output: {
        responseType: 'SOURCE_LINK',
        answer: '该候选只解释本轮实读来源，当前判断仍受缺失构型事实限制。',
        sourceRefs: [reviewTask.resourceRefs[0].sourceRefId],
        missingInputs: ['Controlled FleetFacts'],
        candidateEvidenceRefs: [],
        reviewActionDraft: null,
        affectedItemIds: [],
        warnings: ['candidate_only'],
      },
      provenance: provenance(),
    };
  };
  const options = {
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    checkpointDir,
  };

  const first = await runHostedReviewTurn(options, { callTool, invokeModel });
  const second = await runHostedReviewTurn(options, { callTool, invokeModel });

  assert.deepEqual(second, first);
  assert.equal(first.outcome, 'CANDIDATE_ONLY');
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_review_turn',
      'get_review_turn_context',
      'read_source_refs',
      'commit_review_turn_candidate',
    ],
  );
  assert.equal(modelInputs.length, 1);
  assert.deepEqual(modelSessionDiscriminators, [
    createHash('sha256').update(reviewTask.requestId).digest('hex'),
  ]);
  assert.equal(shapeObserverCalls, 1);
  assert.deepEqual(
    modelInputs[0].input.context.evaluation.gapLedger.gaps[0].gapControl,
    {
      owner: 'CANONICAL_HOST',
      candidateOnly: true,
      modelMayClose: false,
      queryResultIsFact: false,
    },
  );
  assert.equal(
    Object.hasOwn(
      modelInputs[0].input.context.evaluation.gapLedger.gaps[0],
      'authority',
    ),
    false,
  );
  const serializedModelInput = JSON.stringify(modelInputs[0]);
  for (const forbidden of [
    reviewTask.reviewConversationRef,
    reviewTask.reviewTurnRef,
    reviewTask.requestId,
    task.actionAttemptId,
    task.operationRef,
    task.workItemId,
    LEASE_TOKEN,
  ]) {
    assert.equal(serializedModelInput.includes(forbidden), false, forbidden);
  }
  const checkpointInfo = await stat(join(checkpointDir, 'begin.result.json'));
  assert.equal(checkpointInfo.mode & 0o077, 0);
  const shapePath = join(checkpointDir, 'model.output-shape.json');
  const shapeInfo = await stat(shapePath);
  const shapeSerialized = await readFile(shapePath, 'utf8');
  const shapeCheckpoint = JSON.parse(shapeSerialized);
  assert.equal(shapeInfo.mode & 0o077, 0);
  assert.equal(shapeCheckpoint.argsHash, canonicalSha256(modelInputs[0]));
  assert.equal(shapeCheckpoint.value.outputChannel, 'FUNCTION_ARGUMENTS');
  assert.equal(
    shapeCheckpoint.value.toolCall.sha256,
    createHash('sha256')
      .update('{"private":"MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED"}')
      .digest('hex'),
  );
  assert.equal(shapeCheckpoint.value.assistantContent.isBlank, true);
  assert.equal(shapeCheckpoint.value.toolCall.rawJsonParseResult, 'OBJECT');
  assert.equal(
    shapeSerialized.includes('MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED'),
    false,
  );
  assert.equal(shapeSerialized.includes('{"private"'), false);
});

test('reads both selected Criterion sources and the current attachment for candidate evidence', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-evidence-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const task = makeTask(
    'OPENCLAW_INTERACTIVE_REVIEW',
    reviewTask,
    [],
    reviewTask.resourceRefs.map(
      ({ resourceArtifactRef: ref, resourceArtifactSha256: sha256 }) => ({
        ref,
        sha256,
      }),
    ),
  );
  const calls = [];
  let committedResult;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind:
            sourceRefId === reviewTask.attachmentRefs[0]
              ? 'ENGINEER_ATTACHMENT'
              : 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      committedResult = JSON.parse(args.resultJson);
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };

  const result = await runHostedReviewTurn(
    {
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      checkpointDir,
    },
    {
      callTool,
      invokeModel: async (_input, { readSourceRefs }) => {
        await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId, reviewTask.attachmentRefs[0]]);
        return {
        output: {
          responseType: 'CANDIDATE_EVIDENCE',
          answer: '本轮附件形成候选证据，但尚未采纳或改变任何业务状态。',
          sourceRefs: [reviewTask.attachmentRefs[0]],
          missingInputs: [],
          candidateEvidenceRefs: [reviewTask.attachmentRefs[0]],
          reviewActionDraft: null,
          affectedItemIds: [],
          warnings: ['candidate_only', 'not_adopted'],
        },
        provenance: provenance(),
        };
      },
    },
  );

  const sourceCall = calls.find(({ name }) => name === 'read_source_refs');
  assert.deepEqual(sourceCall.args.sourceRefIds, [
    reviewTask.resourceRefs[0].sourceRefId,
    reviewTask.attachmentRefs[0],
  ]);
  assert.deepEqual(
    JSON.parse(committedResult.modelOutput).candidateEvidenceRefs,
    [reviewTask.attachmentRefs[0]],
  );
  assert.deepEqual(result.authorityMutations, {
    reviewCandidatePersisted: true,
    workItemRevisionChanged: false,
    currentChanged: false,
    staleChanged: false,
    reviewActionExecuted: false,
  });
});

test('reads more than 100 authorized sources in API-sized batches without truncation', async (t) => {
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-review-batches-'));
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  reviewTask.selectedEvaluationItemId = null;
  const original = reviewTask.resourceRefs[0];
  reviewTask.resourceRefs.push(...Array.from({ length: 101 }, (_, i) => ({
    ...original, sourceRefId: `SOURCE-BATCH-${i}`, value: { sourceRefId: `SOURCE-BATCH-${i}`, kind: 'page', statement: 'Fixture source' },
  })));
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const reads = [];
  const result = await runHostedReviewTurn({ reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir }, {
    callTool: async (name, args) => {
      if (name === 'begin_review_turn') return runningBegin(task);
      if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
      if (name === 'read_source_refs') {
        reads.push(args.sourceRefIds);
        assert.ok(args.sourceRefIds.length <= 100);
        return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef, sourceRefs: args.sourceRefIds.map(sourceRefId => ({ sourceRefId, kind: 'page', statement: 'Fixture source' })) };
      }
      if (name === 'commit_review_turn_candidate') return reviewCommit(task.operationRef);
      throw new Error(`UNEXPECTED_TOOL:${name}`);
    },
    invokeModel: async (input, { readSourceRefs }) => {
      assert.deepEqual(input.sourceRefs, []);
      const requested = reviewTask.resourceRefs.map(({ sourceRefId }) => sourceRefId);
      for (let offset = 0; offset < requested.length; offset += 100) {
        await readSourceRefs(requested.slice(offset, offset + 100));
      }
      return { output: { responseType: 'ANSWER', answer: '依据所读材料形成候选。', sourceRefs: [original.sourceRefId], missingInputs: [], candidateEvidenceRefs: [], reviewActionDraft: null, affectedItemIds: [], warnings: [] }, provenance: provenance() };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(reads.length, 2);
  assert.deepEqual(reads.flat(), reviewTask.resourceRefs.map(({ sourceRefId }) => sourceRefId));
});

test('reads only requested fragments across native tool rounds and restores a completed model checkpoint', async (t) => {
  const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-review-on-demand-'));
  const resumeDir = await mkdtemp(join(tmpdir(), 'wiselink-review-on-demand-resume-'));
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(checkpointDir, { recursive: true, force: true });
    await rm(resumeDir, { recursive: true, force: true });
  });
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const primary = reviewTask.resourceRefs[0].sourceRefId;
  const attachment = reviewTask.attachmentRefs[0];
  reviewTask.resourceRefs.push({
    ...reviewTask.resourceRefs[0], sourceRefId: 'SOURCE-UNRELATED',
    value: { sourceRefId: 'SOURCE-UNRELATED', statement: 'Never requested' },
  });
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask, [],
    [...new Map(reviewTask.resourceRefs.map(({ resourceArtifactRef: ref, resourceArtifactSha256: sha256 }) => [ref, { ref, sha256 }])).values()]);
  const requests = [];
  const reads = [];
  const calls = [];
  const companion = 'REVIEW-COMPANION-NOT-EVIDENCE';
  let snapshotSaved = false;
  let commits = 0;
  const candidate = {
    responseType: 'CANDIDATE_EVIDENCE', answer: '根据原文与附件形成候选解释，尚未采用。',
    sourceRefs: [primary, attachment], missingInputs: [], candidateEvidenceRefs: [attachment],
    reviewActionDraft: null, affectedItemIds: [], warnings: ['candidate_only'],
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(JSON.stringify(body.messages).includes(companion), false);
    requests.push(body);
    const round = requests.length;
    if (round === 1) assert.equal(reads.length, 0, 'no eager source prefetch');
    const name = round < 3 ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate';
    const args = round === 1 ? { sourceRefIds: [primary] }
      : round === 2 ? { sourceRefIds: [primary, attachment] } : candidate;
    return Response.json({ model: 'fixture/provider', choices: [{ message: {
      content: companion, tool_calls: [{ id: `call-${round}`, type: 'function', function: {
        name, arguments: JSON.stringify(args),
      } }],
    } }] });
  };
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') return reviewContext(task, reviewTask);
    if (name === 'heartbeat_action_attempt') return reviewProgressHeartbeat(task, args);
    if (name === 'read_source_refs') {
      reads.push([...args.sourceRefIds]);
      return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({ sourceRefId, kind: 'page', statement: `Read ${sourceRefId}` })) };
    }
    if (name === 'commit_review_turn_candidate') {
      commits += 1;
      assert.deepEqual(JSON.parse(JSON.parse(args.resultJson).modelOutput).sourceRefs, candidate.sourceRefs);
      if (!snapshotSaved) {
        // Capture the real completed model/read files at the pre-commit boundary.
        for (const file of await readdir(checkpointDir)) {
          if (/^(begin|context|sources(?:-\d+)?|model)\./u.test(file)) {
            await copyFile(join(checkpointDir, file), join(resumeDir, file));
          }
        }
        snapshotSaved = true;
      }
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const invokeModel = (input, hooks) => invokeHostedReviewModel(input, {
    gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'fixture-only',
    configuredModelVersion: 'fixture/provider', ...hooks,
  });
  const options = { reviewConversationRef: reviewTask.reviewConversationRef, requestId: reviewTask.requestId, checkpointDir };
  const first = await runHostedReviewTurn(options, { callTool, invokeModel });
  assert.equal(first.ok, true);
  for (const file of await readdir(checkpointDir)) {
    assert.equal((await readFile(join(checkpointDir, file), 'utf8')).includes(companion), false);
  }
  const shape = JSON.parse(await readFile(join(checkpointDir, 'model.output-shape.json'), 'utf8'));
  assert.equal(shape.value.outputChannel, 'FUNCTION_ARGUMENTS_WITH_COMMENTARY');
  assert.deepEqual(reads, [[primary], [attachment]], 'repeated ref is reused within the authorized turn');
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(({ user }) => user)).size, 1);
  assert.ok(requests.every(({ model }) => model === 'openclaw/wiselink-engineering'));
  assert.match(requests[0].messages[1].content, /SOURCE-UNRELATED/u);
  for (const request of requests.slice(1)) {
    assert.deepEqual(request.messages.map(({ role }) => role), ['system', 'assistant', 'tool']);
    assert.equal(JSON.stringify(request.messages).includes('SOURCE-UNRELATED'), false);
    assert.equal(request.messages[2].tool_call_id, request.messages[1].tool_calls[0].id);
  }
  const callsBeforeResume = calls.length;
  const resumed = await runHostedReviewTurn({ ...options, checkpointDir: resumeDir }, { callTool, invokeModel });
  assert.equal(resumed.ok, true);
  assert.deepEqual(calls.slice(callsBeforeResume), ['commit_review_turn_candidate']);
  assert.equal(requests.length, 3, 'completed model is not replayed');
  assert.equal(commits, 2, 'one commit per independent pre-commit test snapshot');
});

test('carries Host session routing across two new turns while reading citations anew per turn', async (t) => {
  const originalFetch = globalThis.fetch;
  const directories = [];
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const path of directories) await rm(path, { recursive: true, force: true });
  });
  const requests = [];
  const sourceReads = [];
  const commits = [];
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  reviewTask.actorContextRef = 'ACTX-RS-RT-first';
  const sourceRefId = reviewTask.resourceRefs[0].sourceRefId;
  const nativeSessionKey = 'agent:wiselink-engineering:review:ACTX-RS-RT-first';
  globalThis.fetch = async (_url, init) => {
    requests.push({ body: JSON.parse(init.body), headers: init.headers });
    assert.equal(requests.at(-1).body.tools[0].function.parameters.required.includes('matterWorkingDelta'), false);
    const reading = requests.length % 2 === 1;
    return Response.json({ model: 'fixture/provider', choices: [{ message: {
      content: null, tool_calls: [{ id: `call-${requests.length}`, type: 'function', function: {
        name: reading ? 'read_wiselink_review_sources' : 'return_wiselink_review_candidate',
        arguments: JSON.stringify(reading ? { sourceRefIds: [sourceRefId] } : {
          responseType: 'SOURCE_LINK', answer: '本轮根据重新读取的依据继续讨论。', sourceRefs: [sourceRefId],
          missingInputs: [], candidateEvidenceRefs: [], reviewActionDraft: null, affectedItemIds: [], warnings: [],
        }),
      } }],
    } }] });
  };
  for (const turnNo of [1, 2]) {
    const checkpointDir = await mkdtemp(join(tmpdir(), 'wiselink-native-continuation-'));
    directories.push(checkpointDir);
    const input = { ...reviewTask, reviewTurnRef: `RT-new-${turnNo}`, requestId: `request-new-${turnNo}`,
      userMessage: `请处理第 ${turnNo} 个新问题。` };
    const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', input);
    const calls = [];
    const dependencies = {
      callTool: async (name, args) => {
        calls.push(name);
        if (name === 'begin_review_turn') return runningBegin(task, { nativeSessionKey });
        if (name === 'heartbeat_action_attempt') return reviewProgressHeartbeat(task, args);
        if (name === 'get_review_turn_context') return reviewContext(task, input);
        if (name === 'read_source_refs') {
          sourceReads.push({ turnNo, ids: args.sourceRefIds });
          return { schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2', attemptRef: task.operationRef,
            sourceRefs: input.resourceRefs.filter((ref) => args.sourceRefIds.includes(ref.sourceRefId)).map((ref) => ref.value) };
        }
        if (name === 'commit_review_turn_candidate') {
          const candidate = JSON.parse(JSON.parse(args.resultJson).modelOutput);
          assert.equal(candidate.schemaVersion, 'wiselink.3_1.review_turn_candidate.v1.c3');
          assert.equal(Object.hasOwn(candidate, 'matterWorkingDelta'), false);
          commits.push(candidate.reviewTurnRef);
          return reviewCommit(task.operationRef);
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      },
      invokeModel: (value, hooks) => invokeHostedReviewModel(value, {
        gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider', ...hooks,
      }),
    };
    const options = { reviewConversationRef: input.reviewConversationRef, requestId: input.requestId, checkpointDir };
    const result = await runHostedReviewTurn(options, dependencies);
    assert.equal(result.sessionRouting, 'HOST_SCOPED');
    const callCount = calls.length;
    await runHostedReviewTurn(options, dependencies);
    assert.equal(calls.length, callCount, 'restarting a completed turn performs no remote work');
  }
  assert.equal(requests.length, 4);
  assert.ok(requests.every(({ headers, body }) => headers['x-openclaw-session-key'] === nativeSessionKey && !Object.hasOwn(body, 'user')));
  assert.ok(requests.every(({ body }) => body.model === 'openclaw/wiselink-engineering' && !JSON.stringify(body.messages).includes(nativeSessionKey)));
  assert.deepEqual(sourceReads, [{ turnNo: 1, ids: [sourceRefId] }, { turnNo: 2, ids: [sourceRefId] }]);
  assert.deepEqual(commits, ['RT-new-1', 'RT-new-2']);
  assert.match(requests[2].body.messages[1].content, /第 2 个新问题/u);
});

test('does not send a native key bound to a different profile', async () => {
  await assert.rejects(invokeHostedReviewModel({ input: {} }, {
    gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
    nativeSessionKey: 'agent:main:review:ACTX-RS-RT-first',
  }), /REVIEW_NATIVE_SESSION_BINDING_INVALID/u);
});

test('rejects an unauthorized model source request without reading or continuing the model', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let modelCalls = 0;
  let sourceCalls = 0;
  globalThis.fetch = async () => {
    modelCalls += 1;
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{
      id: 'unauthorized-read', type: 'function', function: {
        name: 'read_wiselink_review_sources', arguments: JSON.stringify({ sourceRefIds: ['NOT-AUTHORIZED'] }),
      },
    }] } }] });
  };
  await assert.rejects(invokeHostedReviewModel({ input: { availableSourceRefIds: ['ALLOWED'] } }, {
    gatewayUrl: 'http://127.0.0.1:18789', gatewayToken: 'fixture-only', configuredModelVersion: 'fixture/provider',
    readSourceRefs: async () => { sourceCalls += 1; return []; },
  }), /REVIEW_MODEL_SOURCE_REQUEST_INVALID/u);
  assert.equal(modelCalls, 1);
  assert.equal(sourceCalls, 0);
});

test('does not relabel a document SourceRef as new candidate evidence', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-evidence-boundary-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const task = makeTask(
    'OPENCLAW_INTERACTIVE_REVIEW',
    reviewTask,
    [],
    reviewTask.resourceRefs.map(
      ({ resourceArtifactRef: ref, resourceArtifactSha256: sha256 }) => ({
        ref,
        sha256,
      }),
    ),
  );
  await assert.rejects(
    runHostedReviewTurn(
      {
        reviewConversationRef: reviewTask.reviewConversationRef,
        requestId: reviewTask.requestId,
        checkpointDir,
      },
      {
        callTool: async (name, args) => {
          if (name === 'begin_review_turn') return runningBegin(task);
          if (name === 'get_review_turn_context') {
            return reviewContext(task, reviewTask);
          }
          if (name === 'read_source_refs') {
            return {
              schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
              attemptRef: task.operationRef,
              sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
                sourceRefId,
                kind: 'fixture',
                statement: 'Fixture-only source-bound statement.',
              })),
            };
          }
          throw new Error(`MODEL_MUST_NOT_COMMIT:${name}`);
        },
        invokeModel: async (_input, { readSourceRefs }) => {
          await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
          return {
          output: {
            responseType: 'CANDIDATE_EVIDENCE',
            answer: '错误地把受控原文标为新证据。',
            sourceRefs: [reviewTask.resourceRefs[0].sourceRefId],
            missingInputs: [],
            candidateEvidenceRefs: [reviewTask.resourceRefs[0].sourceRefId],
            reviewActionDraft: null,
            affectedItemIds: [],
            warnings: ['candidate_only'],
          },
          provenance: provenance(),
          };
        },
      },
    ),
    /REVIEW_MODEL_CANDIDATE_EVIDENCE_REF_NOT_ATTACHMENT/u,
  );
});

test('persists a complete candidate-only review action draft without confirming it', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-draft-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  reviewTask.userMessage =
    '采用本轮附件作为候选输入，把 criterion-001 改为 PROVISIONAL，并给出确认前差异草案。';
  reviewTask.context.engineerInput.text = reviewTask.userMessage;
  const task = makeTask(
    'OPENCLAW_INTERACTIVE_REVIEW',
    reviewTask,
    [],
    reviewTask.resourceRefs.map(
      ({ resourceArtifactRef: ref, resourceArtifactSha256: sha256 }) => ({
        ref,
        sha256,
      }),
    ),
  );
  const calls = [];
  let committedResult;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'fixture',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      committedResult = JSON.parse(args.resultJson);
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const sourceRefId = reviewTask.resourceRefs[0].sourceRefId;
  const attachmentRef = reviewTask.attachmentRefs[0];
  const uncertaintyDispositions = [];
  const reviewActionDraft = {
    baseRevision: reviewTask.inputRevision,
    evaluationItemId: 'criterion-001',
    proposedStatus: 'PROVISIONAL',
    resolvedGapRefs: [],
    adoptedInputRefs: ['engineer-input:ESI-fixture-001'],
    sourceRefs: [sourceRefId, attachmentRef],
    assumptions: ['附件内容仍需工程师确认后才可进入 Host current。'],
    affectedItemIds: ['criterion-001'],
    overallImpact: true,
    uncertaintyDispositions,
    decisionSnapshot: {
      assessmentAsOf: '2026-09-02T00:00:00.000Z',
      evidenceHorizon: ['SOURCE_DOCUMENT_COMPLETE', 'CONFIGURATION_PARTIAL'],
      currentBestJudgment: 'criterion-001 可形成 PROVISIONAL 候选判断。',
      alternativeJudgments: ['保留 UNKNOWN/WAITING_INPUT。'],
      decisionMaturity: 'REVIEWABLE',
      decisiveFacts: ['本轮附件与受控原文已读取。'],
      assumptions: ['附件内容尚未通过结构化确认。'],
      residualUncertainties: ['目标构型覆盖仍不完整。'],
      uncertaintyDispositions,
      controlsAndMitigations: ['确认前不改变 current。'],
      monitoringPlan: null,
      validUntil: null,
      reviewBy: null,
      reopenTriggers: ['取得新的受控构型证据。'],
      whatWouldChangeDecision: ['反证附件内容与目标对象不匹配。'],
      candidateOnly: true,
    },
  };

  const result = await runHostedReviewTurn(
    {
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      checkpointDir,
    },
    {
      callTool,
      invokeModel: async (_input, { readSourceRefs }) => {
        await readSourceRefs([sourceRefId, attachmentRef]);
        return {
        output: {
          responseType: 'REVIEW_ACTION_DRAFT',
          answer: '已形成确认前差异草案；尚未确认、采纳或执行。',
          sourceRefs: [sourceRefId, attachmentRef],
          missingInputs: ['工程师结构化确认'],
          candidateEvidenceRefs: [attachmentRef],
          reviewActionDraft,
          affectedItemIds: ['criterion-001'],
          warnings: ['candidate_only', 'confirmation_required'],
        },
        provenance: provenance(),
        };
      },
    },
  );

  const candidate = JSON.parse(committedResult.modelOutput);
  assert.deepEqual(candidate.reviewActionDraft, reviewActionDraft);
  assert.equal(candidate.responseType, 'REVIEW_ACTION_DRAFT');
  assert.equal(result.authorityMutations.reviewActionExecuted, false);
  assert.equal(result.authorityMutations.workItemRevisionChanged, false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_review_turn',
      'get_review_turn_context',
      'read_source_refs',
      'commit_review_turn_candidate',
    ],
  );
});

test('keeps non-gap authority data outside the review model boundary', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  reviewTask.context.evaluation.actorAuthority = {
    authority: { owner: 'UNTRUSTED' },
  };
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  await assert.rejects(
    runInteractiveReviewTurn({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      callTool: async (name) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') {
          return reviewContext(task, reviewTask);
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      },
      respond: async () => {
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    }),
    /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:\$\.evaluation\.actorAuthority\.authority/u,
  );
});

test('discovers the Hosted OpenClaw config and exact canonical MCP alias', () => {
  const paths = openClawConfigCandidates(
    [],
    {},
    {
      homeDirectory: '/home/gem',
      workingDirectory:
        '/home/gem/workspace/agent/workspace/skills/wiselink-research-and-synthesize',
    },
  );
  assert.ok(paths.includes('/home/gem/workspace/agent/openclaw.json'));
  assert.deepEqual(
    findMcpConfig({
      mcp: {
        servers: {
          wiselink_host_controller: {
            url: 'https://host.example.test/mcp',
            headers: { 'x-api-key': 'fixture-only' },
          },
        },
      },
    }),
    {
      url: 'https://host.example.test/mcp',
      headers: { 'x-api-key': 'fixture-only' },
    },
  );
  assert.equal(
    findMcpConfig({
      mcp: { servers: { unrelated: { url: 'https://other.example.test' } } },
    }),
    null,
  );
});

test('requires an explicitly enabled Hosted chat-completions endpoint', () => {
  assert.equal(
    isChatCompletionsEnabled({
      gateway: {
        http: {
          endpoints: { chatCompletions: { enabled: true } },
        },
      },
    }),
    true,
  );
  for (const config of [
    {},
    { gateway: {} },
    { gateway: { http: { endpoints: { chatCompletions: {} } } } },
    {
      gateway: {
        http: {
          endpoints: { chatCompletions: { enabled: false } },
        },
      },
    },
  ]) {
    assert.equal(isChatCompletionsEnabled(config), false);
  }
  assert.throws(
    () =>
      assertHostedModelGatewayReady({
        gatewayChatCompletionsEnabled: false,
      }),
    /REVIEW_GATEWAY_CHAT_COMPLETIONS_DISABLED/u,
  );
});

test('resolves one no-fallback model from the explicit agent or defaults', () => {
  assert.equal(
    resolveConfiguredModelVersion({
      agents: {
        defaults: { model: 'provider/default' },
        list: [{ id: 'wiselink-engineering', model: 'provider/explicit' }],
      },
    }),
    'provider/explicit',
  );
  assert.equal(
    resolveConfiguredModelVersion({
      agents: {
        list: [
          {
            id: 'wiselink-engineering',
            model: { primary: 'provider/explicit-object', fallbacks: [] },
          },
        ],
      },
    }),
    'provider/explicit-object',
  );
  assert.equal(
    resolveConfiguredModelVersion({
      agents: {
        defaults: {
          model: { primary: 'provider/default-object', fallbacks: [] },
        },
        list: [{ id: 'wiselink-engineering' }],
      },
    }),
    'provider/default-object',
  );
  assert.equal(
    resolveConfiguredModelVersion(
      { agents: { defaults: { model: 'provider/default' }, list: [] } },
      'another-agent',
    ),
    'provider/default',
  );
});

test('rejects ambiguous, fallback-enabled, and unreadable model config', () => {
  assert.throws(
    () =>
      resolveConfiguredModelVersion({
        agents: {
          defaults: { model: 'provider/default' },
          list: [
            { id: 'wiselink-engineering' },
            { id: 'wiselink-engineering' },
          ],
        },
      }),
    /REVIEW_MODEL_CONFIG_AMBIGUOUS/u,
  );
  for (const fallbacks of [['provider/fallback'], 'provider/fallback']) {
    assert.throws(
      () =>
        resolveConfiguredModelVersion({
          agents: {
            list: [
              {
                id: 'wiselink-engineering',
                model: { primary: 'provider/primary', fallbacks },
              },
            ],
          },
        }),
      /REVIEW_MODEL_FALLBACK_NONEMPTY/u,
    );
  }
  for (const config of [
    {},
    { agents: { list: 'not-an-array' } },
    {
      agents: {
        list: [
          {
            id: 'wiselink-engineering',
            model: { primary: 'unknown', fallbacks: [] },
          },
        ],
      },
    },
  ]) {
    assert.throws(
      () => resolveConfiguredModelVersion(config),
      /REVIEW_MODEL_CONFIG_UNREADABLE/u,
    );
  }
});

test('offers source reading and one final candidate function with blank assistant content', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        model: 'openai-codex/gpt-5.4',
        choices: [
          {
            message: {
              content: ' \n ',
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'return_wiselink_review_candidate',
                    arguments: ' \n {"candidateOnly":true} \n ',
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  const result = await invokeHostedReviewModel(
    { candidateOnly: true },
    {
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayToken: 'fixture-only-never-logged',
      configuredModelVersion: 'provider/configured',
    },
  );

  assert.deepEqual(result.output, { candidateOnly: true });
  assert.equal(Object.hasOwn(requestBody, 'response_format'), false);
  assert.equal(requestBody.tools.length, 2);
  assert.equal(
    requestBody.tools[0].function.name,
    'return_wiselink_review_candidate',
  );
  assert.equal(requestBody.tools[0].function.parameters.type, 'object');
  assert.equal(
    requestBody.tools[0].function.parameters.additionalProperties,
    false,
  );
  assert.equal(requestBody.tools[1].function.name, 'read_wiselink_review_sources');
  assert.equal(requestBody.tool_choice, 'required');
  assert.equal(requestBody.parallel_tool_calls, false);
  assert.equal(requestBody.n, 1);
  assert.match(requestBody.user, /^review-driver:[0-9a-f]{24}$/u);
  assert.equal(result.provenance.modelVersion, 'openai-codex/gpt-5.4');
  assert.equal(
    result.provenance.promptVersion,
    'wiselink.3_1.review_prompt.v1.c41',
  );
});

test('falls back to the configured model and records only output shape v2', async (t) => {
  const originalFetch = globalThis.fetch;
  let outputShape;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'return_wiselink_review_candidate',
                    arguments:
                      '{"private":"MODEL-OUTPUT-MUST-NOT-BE-RETAINED","candidateOnly":true}',
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const result = await invokeHostedReviewModel(
    { candidateOnly: true },
    {
      gatewayUrl: 'http://127.0.0.1:18789',
      gatewayToken: 'fixture-only-never-logged',
      configuredModelVersion: 'provider/configured',
      observeOutputShape: async (value) => {
        outputShape = value;
      },
    },
  );

  assert.deepEqual(result.output, {
    private: 'MODEL-OUTPUT-MUST-NOT-BE-RETAINED',
    candidateOnly: true,
  });
  assert.equal(result.provenance.modelVersion, 'provider/configured');
  assert.equal(
    result.provenance.promptVersion,
    'wiselink.3_1.review_prompt.v1.c41',
  );
  assert.equal(
    outputShape.schemaVersion,
    'wiselink.3_1.review_model_output_shape.v2',
  );
  assert.equal(outputShape.outputChannel, 'FUNCTION_ARGUMENTS');
  assert.equal(outputShape.assistantContent.isBlank, true);
  assert.equal(outputShape.toolCall.count, 1);
  assert.equal(outputShape.toolCall.nameMatched, true);
  assert.equal(outputShape.toolCall.rawJsonParseResult, 'OBJECT');
  assert.equal(outputShape.toolCall.strictJsonObjectAccepted, true);
  assert.equal(
    JSON.stringify(outputShape).includes('MODEL-OUTPUT-MUST-NOT-BE-RETAINED'),
    false,
  );
});

test('accepts only tool arguments, rejects prose-only, wrappers, analysis and ambiguous calls', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const validToolCall = () => ({
    type: 'function',
    function: {
      name: 'return_wiselink_review_candidate',
      arguments: '{"candidateOnly":true}',
    },
  });
  let nextChoices = [
    { message: { content: null, tool_calls: [validToolCall()] } },
  ];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: 'openai-codex/gpt-5.4',
        choices: nextChoices,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  const invoke = () =>
    invokeHostedReviewModel(
      { candidateOnly: true },
      {
        gatewayUrl: 'http://127.0.0.1:18789',
        gatewayToken: 'fixture-only-never-logged',
        configuredModelVersion: 'provider/configured',
      },
    );
  for (const argumentsText of [
    '```json\n{"candidateOnly":true}\n```',
    'Here is the result: {"candidateOnly":true}',
    '[{"candidateOnly":true}]',
    'null',
  ]) {
    const toolCall = validToolCall();
    toolCall.function.arguments = argumentsText;
    nextChoices = [{ message: { content: null, tool_calls: [toolCall] } }];
    await assert.rejects(
      invoke(),
      /REVIEW_MODEL_STRICT_JSON_REQUIRED/u,
      argumentsText,
    );
  }
  const malformedArguments = validToolCall();
  malformedArguments.function.arguments = '{"candidateOnly":true,}';
  nextChoices = [
    { message: { content: null, tool_calls: [malformedArguments] } },
  ];
  await assert.rejects(invoke(), /REVIEW_MODEL_JSON_INVALID/u);
  nextChoices = [
    {
      message: {
        content: 'Here is the result:',
        tool_calls: [validToolCall()],
      },
    },
  ];
  assert.deepEqual((await invoke()).output, { candidateOnly: true });
  nextChoices = [{ message: { content: '{"candidateOnly":true}' } }];
  await assert.rejects(invoke(), /REVIEW_GATEWAY_OUTPUT_FUNCTION_COUNT_INVALID/u);
  nextChoices = [{ message: { content: [], tool_calls: [validToolCall()] } }];
  await assert.rejects(invoke(), /REVIEW_GATEWAY_ASSISTANT_CONTENT_FORBIDDEN/u);
  nextChoices = [
    {
      message: {
        content: null,
        reasoning_content: 'MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED',
        tool_calls: [validToolCall()],
      },
    },
  ];
  await assert.rejects(invoke(), /REVIEW_MODEL_ANALYSIS_FORBIDDEN/u);
  nextChoices = [
    {
      message: {
        content: null,
        tool_calls: [validToolCall(), validToolCall()],
      },
    },
  ];
  await assert.rejects(
    invoke(),
    /REVIEW_GATEWAY_OUTPUT_FUNCTION_COUNT_INVALID/u,
  );
  nextChoices = [{ message: { content: null, tool_calls: [] } }];
  await assert.rejects(
    invoke(),
    /REVIEW_GATEWAY_OUTPUT_FUNCTION_COUNT_INVALID/u,
  );
  const wrongType = validToolCall();
  wrongType.type = 'custom';
  nextChoices = [{ message: { content: null, tool_calls: [wrongType] } }];
  await assert.rejects(
    invoke(),
    /REVIEW_GATEWAY_OUTPUT_FUNCTION_TYPE_INVALID/u,
  );
  const wrongName = validToolCall();
  wrongName.function.name = 'another_function';
  nextChoices = [{ message: { content: null, tool_calls: [wrongName] } }];
  await assert.rejects(
    invoke(),
    /REVIEW_GATEWAY_OUTPUT_FUNCTION_NAME_INVALID/u,
  );
  nextChoices = [];
  await assert.rejects(invoke(), /REVIEW_GATEWAY_CHOICE_COUNT_INVALID/u);
  nextChoices = [
    { message: { content: null, tool_calls: [validToolCall()] } },
    { message: { content: null, tool_calls: [validToolCall()] } },
  ];
  await assert.rejects(invoke(), /REVIEW_GATEWAY_CHOICE_COUNT_INVALID/u);
  const nonStringArguments = validToolCall();
  nonStringArguments.function.arguments = { candidateOnly: true };
  nextChoices = [
    {
      message: { content: null, tool_calls: [nonStringArguments] },
    },
  ];
  await assert.rejects(
    invoke(),
    /REVIEW_GATEWAY_OUTPUT_FUNCTION_ARGUMENTS_REQUIRED/u,
  );
  const missingArguments = validToolCall();
  delete missingArguments.function.arguments;
  nextChoices = [
    { message: { content: null, tool_calls: [missingArguments] } },
  ];
  await assert.rejects(
    invoke(),
    /REVIEW_GATEWAY_OUTPUT_FUNCTION_ARGUMENTS_REQUIRED/u,
  );
});

test('classifies rejected forced-function output without retaining raw values', () => {
  const summarize = ({ content = null, argumentsText, message = {} }) =>
    summarizeHostedReviewModelOutputShape({
      httpStatus: 200,
      httpOk: true,
      requestedModel: 'openclaw/wiselink-engineering',
      payload: {
        provider: 'openai-codex',
        model: 'gpt-5.4',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content,
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'return_wiselink_review_candidate',
                    arguments: argumentsText,
                  },
                },
              ],
              ...message,
            },
          },
        ],
      },
    });
  const analysis = summarize({
    argumentsText: '{"candidateOnly":true}',
    message: {
      reasoning_content: 'MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED',
    },
  });
  const prose = summarize({
    argumentsText:
      'Result: MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED {"candidateOnly":true}',
  });
  const fence = summarize({
    argumentsText:
      '```json\n{"private":"MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED"}\n```',
  });
  const array = summarize({ argumentsText: '[{"candidateOnly":true}]' });
  const nullValue = summarize({ argumentsText: 'null' });
  const nonblankContent = summarize({
    content: 'MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED',
    argumentsText: '{"candidateOnly":true}',
  });

  assert.equal(analysis.hasAnalysis, true);
  assert.equal(analysis.outputChannel, 'REJECTED');
  assert.equal(prose.toolCall.rawJsonParseResult, 'INVALID');
  assert.equal(prose.outputChannel, 'REJECTED');
  assert.equal(fence.toolCall.rawJsonParseResult, 'INVALID');
  assert.equal(fence.outputChannel, 'REJECTED');
  assert.equal(array.toolCall.rawJsonParseResult, 'ARRAY');
  assert.equal(array.outputChannel, 'REJECTED');
  assert.equal(nullValue.toolCall.rawJsonParseResult, 'NULL');
  assert.equal(nullValue.outputChannel, 'REJECTED');
  assert.equal(nonblankContent.assistantContent.isBlank, false);
  assert.equal(nonblankContent.outputChannel, 'FUNCTION_ARGUMENTS_WITH_COMMENTARY');
  for (const shape of [
    analysis,
    prose,
    fence,
    array,
    nullValue,
    nonblankContent,
  ]) {
    assert.equal(
      JSON.stringify(shape).includes('MODEL-OUTPUT-MUST-NOT-BE-CHECKPOINTED'),
      false,
    );
  }
});

test('requires a configured model before dispatch', async () => {
  await assert.rejects(
    invokeHostedReviewModel(
      { candidateOnly: true },
      {
        gatewayUrl: 'http://127.0.0.1:18789',
        gatewayToken: 'fixture-only-never-logged',
      },
    ),
    /REVIEW_MODEL_CONFIG_UNREADABLE/u,
  );
});

test('recovers an ambiguous checkpointed review commit with one status read and no replay', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-recovery-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  let committedResult;
  const counts = new Map();
  const callTool = async (name, args) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      committedResult = JSON.parse(args.resultJson);
      throw new Error('TRANSPORT_RESPONSE_LOST_AFTER_HOST_COMMIT');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', committedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runHostedReviewTurn(
    {
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      checkpointDir,
    },
    {
      callTool,
      invokeModel: async (_input, { readSourceRefs }) => {
        await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
        return {
        output: {
          responseType: 'SOURCE_LINK',
          answer: '候选答复。',
          sourceRefs: [reviewTask.resourceRefs[0].sourceRefId],
          missingInputs: [],
          candidateEvidenceRefs: [],
          reviewActionDraft: null,
          affectedItemIds: [],
          warnings: ['candidate_only'],
        },
        provenance: provenance(),
        };
      },
    },
  );

  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(counts.get('commit_review_turn_candidate'), 1);
  assert.equal(counts.get('get_action_attempt_status'), 1);
});

test('never retries invalid model arguments after output-shape checkpoint', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-fail-closed-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: 'openai-codex/gpt-5.4',
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: null,
              tool_calls: [
                {
                  type: 'function',
                  function: {
                    name: 'return_wiselink_review_candidate',
                    arguments: '{"candidateOnly":true,}',
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const counts = new Map();
  const callTool = async (name, args) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCalls = 0;
  const dependencies = {
    callTool,
    invokeModel: async (input, hooks) => {
      modelCalls += 1;
      return invokeHostedReviewModel(input, {
        gatewayUrl: 'http://127.0.0.1:18789',
        gatewayToken: 'fixture-only-never-logged',
        configuredModelVersion: 'provider/configured',
        sessionDiscriminator: hooks.sessionDiscriminator,
        observeOutputShape: hooks.observeOutputShape,
      });
    },
  };
  const options = {
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    checkpointDir,
  };

  await assert.rejects(
    runHostedReviewTurn(options, dependencies),
    /REVIEW_MODEL_JSON_INVALID/u,
  );
  await assert.rejects(
    runHostedReviewTurn(options, dependencies),
    /REVIEW_MODEL_OUTCOME_UNKNOWN/u,
  );
  assert.equal(counts.get('begin_review_turn'), 1);
  assert.equal(counts.get('get_review_turn_context'), 1);
  assert.equal(counts.get('read_source_refs'), undefined);
  assert.equal(counts.get('commit_review_turn_candidate'), undefined);
  assert.equal(modelCalls, 1);
  await stat(join(checkpointDir, 'model.output-shape.json'));
  for (const name of [
    'model.result.json',
    'commit.started.json',
    'commit.result.json',
  ]) {
    await assert.rejects(
      stat(join(checkpointDir, name)),
      (error) => error?.code === 'ENOENT',
    );
  }
});

test('recovers a proven pre-dispatch gateway 404 once without replaying Host reads', async (t) => {
  const checkpointDir = await mkdtemp(
    join(tmpdir(), 'wiselink-review-driver-known-nondispatch-'),
  );
  t.after(() => rm(checkpointDir, { recursive: true, force: true }));
  const evidencePath = join(checkpointDir, 'gateway-failure.log');
  const failureCode = 'REVIEW_GATEWAY_INVALID_JSON_HTTP_404';
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const counts = new Map();
  const callTool = async (name, args) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) => ({
          sourceRefId,
          kind: 'page',
          statement: 'Fixture-only source-bound statement.',
        })),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCalls = 0;
  const options = {
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    checkpointDir,
  };

  await assert.rejects(
    runHostedReviewTurn(options, {
      callTool,
      invokeModel: async (_input, { readSourceRefs }) => {
        await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
        modelCalls += 1;
        throw new Error(failureCode);
      },
    }),
    new RegExp(failureCode, 'u'),
  );
  await writeFile(evidencePath, `${failureCode}\nFIRST_RUN_EXIT=1\n`, {
    mode: 0o600,
  });
  const prepared = await prepareKnownModelNonDispatchRecovery({
    checkpointDir,
    failureCode,
    evidencePath,
  });
  assert.deepEqual(prepared, { prepared: true, replayed: false });

  const dependencies = {
    callTool,
    invokeModel: async (_input, { readSourceRefs }) => {
      await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
      modelCalls += 1;
      return {
        output: {
          responseType: 'SOURCE_LINK',
          answer: '候选答复。',
          sourceRefs: [reviewTask.resourceRefs[0].sourceRefId],
          missingInputs: [],
          candidateEvidenceRefs: [],
          reviewActionDraft: null,
          affectedItemIds: [],
          warnings: ['candidate_only'],
        },
        provenance: provenance(),
      };
    },
  };
  const recovered = await runHostedReviewTurn(options, dependencies);
  const recoveryReplay = await prepareKnownModelNonDispatchRecovery({
    checkpointDir,
    failureCode,
    evidencePath,
  });
  const replayed = await runHostedReviewTurn(options, dependencies);

  assert.equal(recovered.outcome, 'CANDIDATE_ONLY');
  assert.deepEqual(replayed, recovered);
  assert.deepEqual(recoveryReplay, { prepared: true, replayed: true });
  assert.equal(counts.get('begin_review_turn'), 1);
  assert.equal(counts.get('get_review_turn_context'), 1);
  assert.equal(counts.get('read_source_refs'), 1);
  assert.equal(counts.get('commit_review_turn_candidate'), 1);
  assert.equal(modelCalls, 2);
  const archiveInfo = await stat(
    join(checkpointDir, 'model.known-nondispatch.json'),
  );
  assert.equal(archiveInfo.mode & 0o077, 0);
});

test('keeps review sourceRefIds inside the candidate and maps only artifact refs to the envelope', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const artifactRefs = reviewCandidateArtifactRefs(task, candidate);
  assert.deepEqual(candidate.sourceRefs, [
    reviewTask.resourceRefs[0].sourceRefId,
  ]);
  assert.deepEqual(artifactRefs, [
    {
      ref: reviewTask.resourceRefs[0].resourceArtifactRef,
      sha256: reviewTask.resourceRefs[0].resourceArtifactSha256,
    },
  ]);
  assert.equal('sourceRefId' in artifactRefs[0], false);
  assert.throws(
    () =>
      sealResultEnvelope({
        task,
        modelOutput: candidate,
        provenance: provenance(),
        sourceRefs: candidate.sourceRefs.map((sourceRefId) => ({
          sourceRefId,
        })),
      }),
    /ACTION_ENVELOPE_REF_UNKNOWN_FIELD:sourceRefId/u,
  );
});

test('reads a Host-authorized attachment through the C3 SourceRef path', async () => {
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const baseCandidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const attachmentRef = reviewTask.attachmentRefs[0];
  const attachmentResource = reviewTask.resourceRefs.find(
    ({ sourceRefId }) => sourceRefId === attachmentRef,
  );
  const candidate = {
    ...baseCandidate,
    reviewConversationRef: reviewTask.reviewConversationRef,
    reviewTurnRef: reviewTask.reviewTurnRef,
    responseType: 'CANDIDATE_EVIDENCE',
    answer: '本候选仅分析 Host 本轮授权并解析后的附件内容。',
    sourceRefs: [attachmentRef],
    missingInputs: [],
    candidateEvidenceRefs: [attachmentRef],
  };
  const task = makeTask(
    'OPENCLAW_INTERACTIVE_REVIEW',
    reviewTask,
    [],
    reviewTask.resourceRefs.map(
      ({ resourceArtifactRef, resourceArtifactSha256 }) => ({
        ref: resourceArtifactRef,
        sha256: resourceArtifactSha256,
      }),
    ),
  );
  const begin = runningBegin(task);
  const calls = [];
  let modelInput;
  const callTool = async (name, args) => {
    calls.push({ name, args });
    if (name === 'begin_review_turn') return begin;
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: args.sourceRefIds.map((sourceRefId) =>
          structuredClone(
            reviewTask.resourceRefs.find(
              (resource) => resource.sourceRefId === sourceRefId,
            ).value,
          ),
        ),
      };
    }
    if (name === 'commit_review_turn_candidate') {
      const submittedResult = JSON.parse(args.resultJson);
      validatePayload('result-envelope', { task, result: submittedResult });
      assert.deepEqual(submittedResult.sourceRefs, [
        {
          ref: attachmentResource.resourceArtifactRef,
          sha256: attachmentResource.resourceArtifactSha256,
        },
      ]);
      return reviewCommit(task.operationRef);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async ({ input, readSourceRefs }) => {
      modelInput = input;
      const refs = await readSourceRefs([attachmentRef]);
      assert.deepEqual(refs, [attachmentResource.value]);
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'CANDIDATE_ONLY');
  assert.deepEqual(modelInput.attachmentRefs, [attachmentRef]);
  assert.ok(modelInput.availableSourceRefIds.includes(attachmentRef));
  assert.equal(
    JSON.stringify(modelInput).includes(attachmentResource.resourceArtifactRef),
    false,
  );
  assert.equal(
    JSON.stringify(modelInput).includes(
      attachmentResource.resourceArtifactSha256,
    ),
    false,
  );
  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      'begin_review_turn',
      'get_review_turn_context',
      'read_source_refs',
      'commit_review_turn_candidate',
    ],
  );
});

test('uses read-only status recovery for COMMITTING review attempts', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const recoveryResult = sealResultEnvelope({
    task,
    modelOutput: candidate,
    provenance: provenance(),
    sourceRefs: [{ ref: ARTIFACT_REF, sha256: ARTIFACT_SHA }],
  });
  const calls = [];
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_review_turn') {
      return {
        ...runningBegin(task),
        status: 'COMMITTING',
        recoveryResult,
      };
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'COMMITTING', recoveryResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  let modelCalled = false;
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async () => {
      modelCalled = true;
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'COMMITTING_RECOVERY_READ_ONLY');
  assert.equal(modelCalled, false);
  assert.deepEqual(calls, ['begin_review_turn', 'get_action_attempt_status']);
});

test('recovers review commit response loss by matching the sealed result hash', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  let submittedResult;
  const callTool = async (name, args) => {
    calls.push(name);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      return reviewContext(task, reviewTask);
    }
    if (name === 'read_source_refs') {
      return {
        schemaVersion: 'wiselink.3_1.review_source_refs.v1.c2',
        attemptRef: task.operationRef,
        sourceRefs: [
          {
            sourceRefId: reviewTask.resourceRefs[0].sourceRefId,
            kind: 'page',
            statement: 'Fixture-only source-bound statement.',
          },
        ],
      };
    }
    if (name === 'commit_review_turn_candidate') {
      submittedResult = JSON.parse(args.resultJson);
      throw new Error('TRANSPORT_RESPONSE_LOST');
    }
    if (name === 'get_action_attempt_status') {
      return attemptStatus(task, 'SUCCEEDED', submittedResult);
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  const result = await runInteractiveReviewTurn({
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef,
    requestId: reviewTask.requestId,
    callTool,
    respond: async ({ readSourceRefs }) => {
      await readSourceRefs([reviewTask.resourceRefs[0].sourceRefId]);
      return { output: candidate, provenance: provenance() };
    },
  });
  assert.equal(result.outcome, 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY');
  assert.equal(
    calls.filter((name) => name === 'commit_review_turn_candidate').length,
    1,
  );
  assert.equal(
    calls.filter((name) => name === 'get_action_attempt_status').length,
    1,
  );
});

test('fails closed for invalid attachment relations and unavailable expansion', async () => {
  const task = await readJson(REVIEW_TASK_FIXTURE_URL);
  const candidate = await readJson(REVIEW_CANDIDATE_FIXTURE_URL);

  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: ['ATTACHMENT-not-in-resource-refs'],
      }),
    /REVIEW_TASK_ATTACHMENT_REF_NOT_ALLOWED/u,
  );
  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: [
          task.resourceRefs[0].sourceRefId,
          task.resourceRefs[0].sourceRefId,
        ],
      }),
    /REVIEW_TASK_ATTACHMENTS_DUPLICATE/u,
  );
  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        attachmentRefs: [''],
      }),
    /REVIEW_TASK_ATTACHMENTS_INVALID/u,
  );
  assert.throws(
    () =>
      validatePayload('review-task', {
        ...task,
        allowedOperations: [
          ...task.allowedOperations,
          'SEARCH_ALLOWED_KNOWLEDGE',
        ],
      }),
    /REVIEW_TASK_ALLOWED_OPERATIONS_INVALID/u,
  );
  assert.throws(
    () =>
      validateReviewCandidate(task, {
        ...candidate,
        responseType: 'RESYNTHESIS_RESULT',
      }),
    /REVIEW_CANDIDATE_RESPONSE_TYPE_UNSUPPORTED_BY_C3/u,
  );
  assert.equal(task.allowedOperations.includes('COMPARE_REVISIONS'), false);
  assert.equal(task.allowedOperations.includes('REEVALUATE_AFFECTED'), false);
});

test('binds review gap resolution to Host-issued gaps, engineer evidence, and exact affected items', async () => {
  const baseTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = {
    ...structuredClone(baseTask),
    allowedAdoptedInputRefs: ['engineer-input:fixture-001'],
    context: {
      ...structuredClone(baseTask.context),
      evaluation: {
        ...structuredClone(baseTask.context.evaluation),
        gapLedger: {
          schemaVersion: 'wiselink.3_1.assessment_gap_ledger_projection.v1',
          inputRevision: baseTask.inputRevision,
          baseRuleRevision: 1,
          currentness: 'CURRENT',
          candidateOnly: true,
          gaps: [
            {
              gapRef: 'GAP-001',
              missingInputId: 'aircraft.currentPartNumber',
              materiality: 'P0_DECISION_CRITICAL',
              queryability: 'REVIEW_QUERYABLE',
              resolutionStatus: 'OPEN',
              affectedCriterionIds: ['criterion-001'],
              authority: {
                owner: 'CANONICAL_HOST',
                modelMayClose: false,
              },
            },
          ],
        },
      },
    },
  };
  const draft = {
    baseRevision: task.inputRevision,
    evaluationItemId: 'criterion-001',
    proposedStatus: 'review_required',
    resolvedGapRefs: ['GAP-001'],
    adoptedInputRefs: ['engineer-input:fixture-001'],
    sourceRefs: [task.resourceRefs[0].sourceRefId],
    assumptions: [],
    affectedItemIds: ['criterion-001'],
    overallImpact: true,
    uncertaintyDispositions: [
      {
        gapRef: 'GAP-001',
        disposition: 'RESOLVED_BY_EVIDENCE',
        rationale: '工程师补充已提供当前构型事实。',
        assumptions: [],
        controlsAndMitigations: [],
        evidenceRefs: [task.resourceRefs[0].sourceRefId],
        reviewBy: null,
        reopenTriggers: ['目标飞机或构型发生变化。'],
      },
    ],
    decisionSnapshot: {
      assessmentAsOf: '2026-09-02T00:00:00.000Z',
      evidenceHorizon: ['SOURCE_DOCUMENT_COMPLETE', 'CONFIGURATION_PARTIAL'],
      currentBestJudgment: '采用当前受控构型事实形成候选判断。',
      alternativeJudgments: [],
      decisionMaturity: 'REVIEWABLE',
      decisiveFacts: ['当前构型事实由工程师补充。'],
      assumptions: [],
      residualUncertainties: [],
      uncertaintyDispositions: [
        {
          gapRef: 'GAP-001',
          disposition: 'RESOLVED_BY_EVIDENCE',
          rationale: '工程师补充已提供当前构型事实。',
          assumptions: [],
          controlsAndMitigations: [],
          evidenceRefs: [task.resourceRefs[0].sourceRefId],
          reviewBy: null,
          reopenTriggers: ['目标飞机或构型发生变化。'],
        },
      ],
      controlsAndMitigations: [],
      monitoringPlan: null,
      validUntil: null,
      reviewBy: null,
      reopenTriggers: ['目标飞机或构型发生变化。'],
      whatWouldChangeDecision: ['出现冲突的受控构型记录。'],
      candidateOnly: true,
    },
  };
  const candidate = {
    schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c3',
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: task.reviewConversationRef,
    reviewTurnRef: task.reviewTurnRef,
    responseType: 'REVIEW_ACTION_DRAFT',
    answer: '基于工程师补充事实形成候选动作。',
    sourceRefs: [task.resourceRefs[0].sourceRefId],
    missingInputs: [],
    candidateEvidenceRefs: [],
    reviewActionDraft: draft,
    affectedItemIds: ['criterion-001'],
    warnings: ['candidate_only'],
    runtime: {
      runtimeAppId: 'app_17c3zn24kv2',
      profileRef: 'wiselink-engineering',
    },
  };

  assert.equal(validateReviewCandidate(task, candidate), candidate);
  const unknownGapDisposition = {
    ...draft.uncertaintyDispositions[0],
    gapRef: 'GAP-404',
  };
  assert.throws(
    () =>
      validateReviewCandidate(task, {
        ...candidate,
        reviewActionDraft: {
          ...draft,
          resolvedGapRefs: ['GAP-404'],
          uncertaintyDispositions: [unknownGapDisposition],
          decisionSnapshot: {
            ...draft.decisionSnapshot,
            uncertaintyDispositions: [unknownGapDisposition],
          },
        },
      }),
    /REVIEW_CANDIDATE_DRAFT_GAP_NOT_ALLOWED/u,
  );
  assert.throws(
    () =>
      validateReviewCandidate(task, {
        ...candidate,
        reviewActionDraft: { ...draft, adoptedInputRefs: [] },
      }),
    /REVIEW_CANDIDATE_DRAFT_GAP_EVIDENCE_REQUIRED/u,
  );
});

test('rejects duplicate or unknown attachment refs before context and model', async (t) => {
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const attachmentRef = reviewTask.attachmentRefs[0];
  const cases = [
    {
      name: 'duplicate',
      attachmentRefs: [attachmentRef, attachmentRef],
      error: /REVIEW_TASK_ATTACHMENTS_DUPLICATE/u,
    },
    {
      name: 'unknown',
      attachmentRefs: ['ATTACHMENT-from-another-resource'],
      error: /REVIEW_TASK_ATTACHMENT_REF_NOT_ALLOWED/u,
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const invalidReviewTask = {
        ...structuredClone(reviewTask),
        attachmentRefs: testCase.attachmentRefs,
      };
      const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', invalidReviewTask);
      const calls = [];
      let respondCallCount = 0;
      const callTool = async (name) => {
        calls.push(name);
        if (name === 'begin_review_turn') return runningBegin(task);
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };
      await assert.rejects(
        runInteractiveReviewTurn({
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef: reviewTask.reviewConversationRef,
          requestId: reviewTask.requestId,
          callTool,
          respond: async () => {
            respondCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        testCase.error,
      );
      assert.deepEqual(calls, ['begin_review_turn']);
      assert.equal(respondCallCount, 0);
    });
  }
});

test('rejects cross-resource review context before model execution', async () => {
  const reviewTask = await readJson(REVIEW_ATTACHMENT_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const calls = [];
  let respondCallCount = 0;
  const callTool = async (name) => {
    calls.push(name);
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      const context = reviewContext(task, reviewTask);
      context.resourceRefs[1].sourceRefId = 'ATTACHMENT-from-another-resource';
      return context;
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  await assert.rejects(
    runInteractiveReviewTurn({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      callTool,
      respond: async () => {
        respondCallCount += 1;
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    }),
    /HOST_MCP_REVIEW_CONTEXT_RESOURCE_REFS_MISMATCH/u,
  );
  assert.deepEqual(calls, ['begin_review_turn', 'get_review_turn_context']);
  assert.equal(respondCallCount, 0);
});

test('rejects tenant, credential, FileService, raw PDF, or Fleet leakage', async () => {
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
  const callTool = async (name) => {
    if (name === 'begin_review_turn') return runningBegin(task);
    if (name === 'get_review_turn_context') {
      const context = reviewContext(task, reviewTask);
      context.context.tenantId = 'tenant-secret';
      return context;
    }
    throw new Error(`UNEXPECTED_TOOL:${name}`);
  };
  await assert.rejects(
    runInteractiveReviewTurn({
      mode: 'INTERACTIVE_REVIEW',
      reviewConversationRef: reviewTask.reviewConversationRef,
      requestId: reviewTask.requestId,
      callTool,
      respond: async () => {
        throw new Error('MODEL_MUST_NOT_RUN');
      },
    }),
    /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u,
  );
});

test('rejects review session keys before respond, including normalized forms', async (t) => {
  const leakageKeys = [
    'sessionKey',
    'openClawSessionKey',
    'open_claw-session key',
    'ｏｐｅｎＣｌａｗＳｅｓｓｉｏｎＫｅｙ',
  ];

  for (const leakageKey of leakageKeys) {
    await t.test(leakageKey, async () => {
      const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
      const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
      let respondCallCount = 0;
      const callTool = async (name) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') {
          const context = reviewContext(task, reviewTask);
          context.context[leakageKey] =
            'review:tenant:actor:work-item:conversation';
          return context;
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };

      await assert.rejects(
        runInteractiveReviewTurn({
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef: reviewTask.reviewConversationRef,
          requestId: reviewTask.requestId,
          callTool,
          respond: async () => {
            respondCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u,
      );
      assert.equal(respondCallCount, 0);
    });
  }
});

test('rejects actor identity key forms before respond', async (t) => {
  const leakageKeys = [
    'actorId',
    'ACTORID',
    'actor-id',
    'ａｃｔｏｒＩｄ',
    'actorContextRef',
    'ACTORCONTEXTREF',
    'Actor_Context-Ref',
    'ａｃｔｏｒＣｏｎｔｅｘｔＲｅｆ',
  ];

  for (const leakageKey of leakageKeys) {
    await t.test(leakageKey, async () => {
      const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
      const task = makeTask('OPENCLAW_INTERACTIVE_REVIEW', reviewTask);
      let respondCallCount = 0;
      const callTool = async (name) => {
        if (name === 'begin_review_turn') return runningBegin(task);
        if (name === 'get_review_turn_context') {
          const context = reviewContext(task, reviewTask);
          context.context[leakageKey] = 'actor-secret';
          return context;
        }
        throw new Error(`UNEXPECTED_TOOL:${name}`);
      };

      await assert.rejects(
        runInteractiveReviewTurn({
          mode: 'INTERACTIVE_REVIEW',
          reviewConversationRef: reviewTask.reviewConversationRef,
          requestId: reviewTask.requestId,
          callTool,
          respond: async () => {
            respondCallCount += 1;
            throw new Error('MODEL_MUST_NOT_RUN');
          },
        }),
        /REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN/u,
      );
      assert.equal(respondCallCount, 0);
    });
  }
});

function provenance(overrides = {}) {
  return {
    modelVersion: 'GLM-5.3',
    promptVersion: 'r09.prompt.fixture.1',
    skillVersion: WISELINK_SKILL_VERSION,
    toolVersions: {
      [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
    },
    runMetrics: {
      durationMs: 12,
      inputUnits: 10,
      outputUnits: 8,
    },
    ...overrides,
  };
}

function applicabilityProvenance(overrides = {}) {
  return provenance({
    promptVersion: WISELINK_APPLICABILITY_PROMPT_VERSION,
    ...overrides,
  });
}

function makeTask(
  taskType,
  modelInput,
  hostResolvedMissingInputs = [],
  sourceRefs = [{ ref: ARTIFACT_REF, sha256: ARTIFACT_SHA }],
) {
  const unsealed = {
    schemaVersion: 'wiselink.3_1.openclaw_task_envelope.v1',
    actionAttemptId: `ATT-${taskType}`,
    operationRef: `AQ-${taskType}`,
    taskType,
    priority: 100,
    tenantId: 'tenant-control-plane',
    workItemId: WORK_ITEM_ID,
    inputRevision: 7,
    baseRevision: 7,
    documentVersionId: 'DV-fixture-001',
    sourceRefs: structuredClone(sourceRefs),
    allowedConnectors: [],
    hostResolvedMissingInputs: structuredClone(hostResolvedMissingInputs),
    modelInput: structuredClone(modelInput),
    deadline: '2026-08-27T12:00:00.000Z',
    idempotencyKey: `fixture:${taskType}`,
  };
  return { ...unsealed, inputHash: canonicalSha256(unsealed) };
}

function runningBegin(task, extra = {}) {
  return {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseToken: LEASE_TOKEN,
    leaseGeneration: 3,
    leaseExpiresAt: '2026-08-27T11:00:00.000Z',
    task,
    ...extra,
  };
}

function heartbeatResult(task, args) {
  assert.deepEqual(args, {
    attemptRef: task.operationRef,
    leaseToken: LEASE_TOKEN,
    leaseGeneration: 3,
  });
  return {
    attemptRef: task.operationRef,
    status: 'RUNNING',
    leaseExpiresAt: '2026-08-27T11:30:00.000Z',
  };
}

function reviewProgressHeartbeat(task, args) {
  const { reviewProgress, ...fence } = args;
  heartbeatResult(task, fence);
  assert.ok(['MODEL_REQUEST', 'MODEL_RETRY'].includes(reviewProgress.kind));
  assert.ok(Number.isSafeInteger(reviewProgress.requestNo) && reviewProgress.requestNo > 0);
  return { leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
}

function stageTranslationPart(args, uploaded) {
  assert.equal(args.phase, 'UPLOAD_PART');
  assert.ok(Buffer.byteLength(JSON.stringify(args)) < 12_000);
  const bytes = Buffer.from(args.payloadBase64, 'base64');
  assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 6_144);
  const existing = uploaded.get(args.partIndex);
  if (existing && !existing.equals(bytes)) {
    throw new Error('RESULT_ENVELOPE_PART_REPLAY_MISMATCH');
  }
  uploaded.set(args.partIndex, existing ?? bytes);
  return {
    schemaVersion: 'wiselink.3_1.translation_result_part_receipt.v1',
    attemptRef: args.attemptRef,
    resultContentHash: args.resultContentHash,
    partIndex: args.partIndex,
    partCount: args.partCount,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    replayed: existing !== undefined,
  };
}

function assembleTranslationParts(args, uploaded) {
  assert.equal(args.phase, 'FINALIZE');
  assert.equal(args.parts.length, args.partCount);
  const bytes = Buffer.concat(
    [...args.parts]
      .sort((left, right) => left.partIndex - right.partIndex)
      .map((part, index) => {
        assert.equal(part.partIndex, index);
        const staged = uploaded.get(index);
        assert.ok(staged);
        assert.equal(part.byteLength, staged.byteLength);
        assert.equal(
          part.sha256,
          createHash('sha256').update(staged).digest('hex'),
        );
        return staged;
      }),
  );
  const result = JSON.parse(bytes.toString('utf8'));
  assert.equal(result.contentHash, args.resultContentHash);
  return result;
}

function translationDeliveryParts(
  task,
  input,
  {
    batchSize = input.sourceUnits.length,
    status = 'RUNNING',
    recoveryResult,
  } = {},
) {
  const sourceUnits = structuredClone(input.sourceUnits);
  const batches = [];
  for (let index = 0; index < sourceUnits.length; index += batchSize) {
    batches.push(sourceUnits.slice(index, index + batchSize));
  }
  const { sourceUnits: _sourceUnits, ...modelInputBase } = input;
  let startIndex = 0;
  return batches.map((batch, partIndex) => {
    const sourceUnitStartIndex = startIndex;
    startIndex += batch.length;
    return {
      schemaVersion: 'wiselink.3_1.openclaw_translation_delivery.v1',
      attemptRef: task.operationRef,
      status,
      leaseToken: LEASE_TOKEN,
      leaseGeneration: 3,
      leaseExpiresAt: '2026-08-27T11:00:00.000Z',
      ...(status === 'COMMITTING'
        ? { recoveryResultContentHash: recoveryResult?.contentHash }
        : {}),
      taskBinding: {
        actionAttemptId: task.actionAttemptId,
        operationRef: task.operationRef,
        taskType: 'OPENCLAW_TRANSLATE',
        workItemId: task.workItemId,
        inputRevision: task.inputRevision,
        baseRevision: task.baseRevision,
        documentVersionId: task.documentVersionId,
        deadline: task.deadline,
        inputHash: task.inputHash,
        sourceArtifactSha256: task.sourceRefs.map(({ sha256 }) => sha256),
        ...(task.executionModel ? { executionModel: structuredClone(task.executionModel) } : {}),
      },
      delivery: {
        partIndex,
        partCount: batches.length,
        sourceUnitStartIndex,
        sourceUnitEndExclusive: startIndex,
        sourceUnitCount: sourceUnits.length,
        ...(partIndex === 0
          ? { modelInputBase: structuredClone(modelInputBase) }
          : {}),
        sourceUnits: structuredClone(batch),
      },
    };
  });
}

function translationInput() {
  return {
    schemaVersion: 'wiselink.3_1.translation_task.v0.candidate',
    sourceUnits: [
      {
        unitKey: 'unit-001',
        kind: 'paragraph',
        text: 'Maintain 28 VDC and ATA 24.',
        sourceRefIds: ['source-ref-001'],
      },
    ],
    rulePack: {
      meta: {
        schemaVersion: 'wiselink.3_1.translation_rule_pack.v0.candidate',
        rulePackId: 'rule-pack-fixture',
        rulePackVersion: '1.0.0',
        label: 'Fixture rules',
        targetLocale: 'zh-CN',
        sourceLocales: ['en'],
      },
      terms: [],
      noTranslate: [],
      deterministic: {
        numericFidelity: true,
        preserveAtaChapterNumbers: true,
      },
    },
    taskStartBinding: {
      documentId: 'DOC-fixture',
      revisionId: 'REV-fixture',
      packageId: 'PKG-fixture',
      contentHash: 'sha256:fixture',
    },
  };
}

function translationModelResponse(rows, id) {
  return Response.json({ choices: [{ finish_reason: 'tool_calls', message: {
    content: null, tool_calls: [{ id, type: 'function', function: {
      name: 'return_wiselink_initial_candidate',
      arguments: JSON.stringify({ candidate: { translatedUnits: rows } }),
    } }],
  } }] });
}

function shiftedTranslationFixture() {
  const input = translationInput();
  input.rulePack.terms = [{ ruleId: 'term.airplane', sourceTerm: 'airplane', targetRenderings: ['飞机'], severity: 'mandatory' }];
  input.sourceUnits = Array.from({ length: 437 }, (_, index) => ({
    ...input.sourceUnits[0], unitKey: 'unit-' + index, sourceRefIds: ['source-' + index],
    text: 'Inspect item ' + index + ' and retain the recorded value.',
  }));
  const translations = input.sourceUnits.map((_, index) => '检查第 ' + index + ' 项并保留记录值。');
  const shifted = new Map();
  // Same misplaced literal tokens as the observed residual; the proper Chinese
  // translations restore source ownership by index, never by moving text here.
  for (const [index, source, translation, rejected] of [
    [288, 'Retain the configuration label.', '保留构型标签。', '保留构型标签 3。'],
    [289, 'Review paragraph 3 before maintenance.', '维修前查阅第 3 段。', '维修前查阅该段。'],
    [363, 'Review paragraphs 11 and 13.', '查阅第 11 和 13 段。', '查阅相应段落。'],
    [364, 'Refer to paragraph 9 and connector E991.', '参见第 9 段和连接器 E991。', '参见第 11 和 13 段及连接器。'],
    [366, 'Inspect airplane connector 6.', '检查飞机的连接器 6。', '检查第 9 段和连接器 E991。'],
    [369, 'Read paragraph 7.', '阅读第 7 段。', '阅读第 6 段。'],
    [371, 'Retain the stated warning.', '保留所述警告。', '保留第 7 段所述警告。'],
  ]) {
    input.sourceUnits[index].text = source;
    translations[index] = translation;
    shifted.set(index, rejected);
  }
  return {
    input, translations, shifted,
    otherWindowIndices: Array.from({ length: 96 }, (_, offset) => 276 + offset).filter((index) => !shifted.has(index)),
  };
}

function residualTranslationFixture(unitCount = 1) {
  const input = translationInput();
  input.sourceUnits = Array.from({ length: unitCount }, (_, index) => ({
    ...input.sourceUnits[0], unitKey: 'unit-' + index, sourceRefIds: ['source-' + index],
    text: 'Retain 1, 2, 3, 4, 5, 6 and 7.',
  }));
  return input;
}

function translationOutput() {
  const input = translationInput();
  return {
    schemaVersion: 'wiselink.3_1.translation_result.v0.candidate',
    rulePackId: input.rulePack.meta.rulePackId,
    rulePackVersion: input.rulePack.meta.rulePackVersion,
    taskStartBinding: structuredClone(input.taskStartBinding),
    candidateUnits: [
      {
        unitKey: 'unit-001',
        text: '保持 28 VDC 和 ATA 24。',
        sourceRefIds: ['source-ref-001'],
        engineerRevision: null,
      },
    ],
  };
}

function buildDynamicRulesOutput(input) {
  const table = input.jobAidContext.criterionTable;
  const criterionIndex = table.columns.indexOf('criterionId');
  const predicateIndex = table.columns.indexOf('predicateResult');
  const conclusionIndex = table.columns.indexOf('candidateConclusion');
  const sourceIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const missingIndex = table.columns.indexOf('missingPredicateKeys');
  const missingRules = new Map();
  const rows = table.rows.map((row, index) => {
    const ruleId = String(row[criterionIndex]);
    const predicate = dynamicValue(table, predicateIndex, index);
    const conclusion = dynamicValue(table, conclusionIndex, index);
    const sourceRefs = dynamicValue(table, sourceIndex, index);
    const missingInputs = dynamicValue(table, missingIndex, index);
    for (const missingInputId of missingInputs) {
      const rules = missingRules.get(missingInputId) ?? [];
      rules.push(ruleId);
      missingRules.set(missingInputId, rules);
    }
    if (predicate === 'FALSE') {
      return [
        ruleId,
        'NOT_APPLICABLE',
        [],
        '谓词 FALSE。',
        '不适用。',
        'not_applicable',
        [],
        [],
        false,
      ];
    }
    if (predicate === 'UNKNOWN') {
      return [
        ruleId,
        'UNKNOWN/WAITING_INPUT',
        [],
        '缺谓词。',
        '待补输入。',
        'insufficient_data',
        [],
        [...missingInputs],
        true,
      ];
    }
    return [
      ruleId,
      conclusion === 'pass' ? 'CANDIDATE_PASS' : 'CANDIDATE_REVIEW_REQUIRED',
      sourceRefs.length > 0 ? ['SOURCE_BOUND'] : [],
      '候选判断。',
      sourceRefs.length > 0 ? '有来源。' : '待复核。',
      conclusion,
      [...sourceRefs],
      [],
      conclusion === 'conditional',
    ];
  });
  const nextRoundChecklist = [...missingRules.entries()]
    .slice(0, input.responseInstruction.nextRoundChecklist.maxItems)
    .map(([missingInputId, affectedRuleIds]) => ({
      missingInputId,
      description: `补充 ${missingInputId}`,
      affectedRuleIds,
      requestedEvidenceOrFact: missingInputId,
      priority: 'HIGH',
      blocking: true,
    }));
  return {
    callerCorrelationRef: input.callerCorrelationRef,
    authorityLevel: 'candidate_only',
    engineeringConclusion: null,
    applicabilityOverall:
      input.jobAidContext.currentAssessment.applicabilityOverall,
    ruleResults: {
      columns: [...input.responseInstruction.ruleResultRequiredFields],
      rows,
    },
    overallSelfCheck: {
      ruleResultCount: rows.length,
      rulesWithMissingInputs: rows.filter((row) => row[7].length > 0).length,
      humanReviewRequiredCount: rows.filter((row) => row[8]).length,
      overallOpinionProduced: false,
      holisticSynthesisDeferredToOpenClaw: true,
    },
    nextRoundChecklist,
    completionSelfCheck: {
      expectedRuleCount: rows.length,
      sourcePageCount:
        input.responseInstruction.completionSelfCheck.sourcePageCount,
      allInputRulesReturned: true,
      returnedRuleIdsMatchInputOrder: true,
      returnedRuleIdsUnique: true,
    },
  };
}

function dynamicValue(table, columnIndex, rowIndex) {
  const encoded = table.rows[rowIndex][columnIndex];
  const dictionary = table.valueDictionaries?.[table.columns[columnIndex]];
  return Number.isInteger(encoded) && Array.isArray(dictionary)
    ? structuredClone(dictionary[encoded])
    : structuredClone(encoded);
}

function synthesisInput() {
  const sourceRefId = `urn:techpub:source-ref:v1:sha256:${'c'.repeat(64)}`;
  const packageId = `urn:techpub:package:v1:sha256:${'d'.repeat(64)}`;
  return {
    operation: 'SYNTHESIZE_OVERALL_CANDIDATE',
    outputCorrelationRef: 'REQ-OVERALL-001',
    applicabilityResult: null,
    baseRuleResult: {
      sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC',
      revision: 1,
      artifactSha256: `sha256:${'e'.repeat(64)}`,
      documentVersionId: 'DV-fixture-001',
      packageId,
      packageArtifactSha256: `sha256:${'f'.repeat(64)}`,
      criterionSetId: 'criterion-set-fixture',
      criterionCount: 1,
      evaluationItemCount: 1,
      unresolvedCount: 1,
      sourceBoundCandidateCount: 1,
      items: [
        {
          criterionId: 'criterion-001',
          status: 'UNKNOWN/WAITING_INPUT',
          sourceRefIds: [sourceRefId],
          fact: null,
          analysis: 'Controlled dynamic candidate.',
          candidateConclusion: 'UNKNOWN/WAITING_INPUT',
          missingInputs: ['Controlled FleetFacts'],
          humanReviewRequired: true,
          authorityLevel: 'candidate_only',
        },
      ],
    },
    unifiedSourceContext: {
      documentVersionId: 'DV-fixture-001',
      packageId,
      packageArtifactSha256: `sha256:${'f'.repeat(64)}`,
      contractRevision: 'frozen.2',
      contentUnitCount: 1,
      sourceRefCount: 1,
      currentDocumentSourceRefIds: [sourceRefId],
      sourceRefs: [
        {
          sourceRefId,
          locator: 'page 1',
          excerpt: null,
        },
      ],
    },
    adoptedDocumentVersions: [
      {
        documentVersionId: 'DV-fixture-001',
        publisher: 'BOEING',
        documentNumber: 'DOC-fixture',
        revisionLabel: 'REV-fixture',
        adoptionStatus: 'ADOPTED',
        currentness: 'CURRENT',
      },
    ],
    engineerReviewContext: {
      revision: null,
      artifactSha256: null,
      reviewCount: 0,
      history: [],
      effective: [],
    },
    externalDiscoveryResults: [],
    selectiveResynthesis: {
      mode: 'INITIAL',
      criterionSetId: 'criterion-set-fixture',
      baseRuleRevision: 1,
      baseRuleArtifactSha256: `sha256:${'e'.repeat(64)}`,
      staleOverallRevision: null,
      targetOverallRevision: 1,
      priorEngineerReviewRevision: null,
      currentEngineerReviewRevision: null,
      affectedCriterionIds: [],
      reusedCriterionIds: [],
      adoptedEvidenceSourceRefIds: [],
    },
  };
}

function synthesisOutput(input) {
  const sourceRefId = input.unifiedSourceContext.sourceRefs[0].sourceRefId;
  const overallCandidate =
    'Candidate only; applicability remains unknown pending the source-required fleet facts.';
  const statement = (text, basis = 'CONDITIONAL_INFERENCE') => ({
    text,
    basis,
    sourceRefIds: [sourceRefId],
  });
  return {
    sourceResultId: input.outputCorrelationRef,
    documentVersionId: input.baseRuleResult.documentVersionId,
    packageId: input.baseRuleResult.packageId,
    baseRuleRevision: input.baseRuleResult.revision,
    baseRuleArtifactSha256: input.baseRuleResult.artifactSha256,
    engineerReviewRevision: null,
    engineerReviewArtifactSha256: null,
    discoveryStatus: 'NO_DISCOVERY',
    gap: 'Controlled FleetFacts are missing.',
    candidateRefCount: 0,
    findingCount: 1,
    unresolvedCount: 1,
    authorityLevel: 'candidate_only',
    externalDiscoveryIsEvidence: false,
    adopted: false,
    usableAsEvidence: false,
    providers: {},
    overallCandidate,
    engineeringSummary: {
      schemaVersion: 'wiselink.3_1.overall_engineering_summary.v1',
      conclusion: statement(overallCandidate),
      whyItMatters: [
        statement(
          'The current source contains an applicability condition that must be matched.',
          'SOURCE_FACT',
        ),
      ],
      applicability: {
        sourceScope: statement(
          'The source scope is limited to the effectivity stated in the current document.',
          'SOURCE_FACT',
        ),
        fleetMatch: statement(
          'The fleet match remains unknown until the source-required facts are available.',
        ),
        requiredFacts: [
          statement(
            'Obtain the controlled facts required by source effectivity.',
          ),
        ],
      },
      implementationImpact: [
        statement('Plan implementation only after applicability is matched.'),
      ],
      dispositionPriority: [
        statement('Close the applicability fact gap before release planning.'),
      ],
      nextActions: [
        statement('Check the source-required controlled fleet facts.'),
      ],
    },
    findings: [
      {
        finding: 'Controlled applicability facts are missing.',
        basis: 'Dynamic N/N and frozen.2 SourceRef',
        sourceRefIds: [sourceRefId],
        assumptions: [],
        uncertainty: 'Fleet applicability is not established.',
      },
    ],
    missingInputs: ['Controlled FleetFacts'],
    applicabilityStatus:
      input.applicabilityResult?.decision === 'APPLICABLE'
        ? 'APPLICABLE'
        : input.applicabilityResult?.decision === 'NOT_APPLICABLE'
          ? 'NOT_APPLICABLE'
          : 'UNKNOWN/WAITING_INPUT',
    engineeringReviewRequired: true,
  };
}

function readingSynthesisInput() {
  const input = synthesisInput();
  input.unifiedSourceContext.sourceRefs[0].excerpt = '主文档说明故障范围与条件。';
  input.evidenceRegistry = [
    { evidenceRef: 'overall-evidence:primary:1', kind: 'DOCUMENT_PASSAGE', title: '主文档', versionLabel: 'R1', excerpt: input.unifiedSourceContext.sourceRefs[0].excerpt, locator: 'page 1-1' },
    { evidenceRef: 'overall-evidence:related:1', kind: 'DOCUMENT_PASSAGE', title: '关联故障报告', versionLabel: 'R2', excerpt: '关联正文独立解释失效机理；并未批准执行。', locator: 'page 2-2' },
  ];
  return input;
}

function readingSynthesisOutput(input) {
  const output = synthesisOutput(input);
  output.overallCandidate = '现有材料已形成有用认识；具体构型待核对，尚无实施决定。';
  output.engineeringSummary = {
    schemaVersion: 'wiselink.3_1.overall_engineering_summary.v2',
    headline: '故障机理的当前认识', listBrief: '故障机理已有依据，具体构型仍待核对。', lead: output.overallCandidate,
    claims: [{ claimId: 'MECHANISM', text: '关联正文解释了故障机理；机队构型仍待核对。', basis: 'CONDITIONAL_INFERENCE', premises: [{ evidenceRef: 'overall-evidence:related:1', role: 'SUPPORTS', explanation: '已读关联正文支持该判断。', limitation: '没有形成实施决定。' }] }],
    decisiveClaimIds: ['MECHANISM'],
  };
  output.findings = [];
  output.findingCount = 0;
  return output;
}

function status(workItemId) {
  return { entry: { workItemId }, integratedAssessmentSummary: null };
}

function statusWithDynamic(workItemId, correlationRef) {
  return {
    entry: { workItemId },
    integratedAssessmentSummary: {
      status: 'BASE_RULE_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: `openclaw-dynamic://${correlationRef}`,
        criterionCount: 1,
        evaluationItemCount: 1,
      },
      overallSynthesis: null,
    },
  };
}

function statusWithOverall(workItemId, correlationRef) {
  return {
    entry: { workItemId },
    integratedAssessmentSummary: {
      status: 'OVERALL_CANDIDATE_READY',
      baseRules: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: 'openclaw-dynamic://REQ-DYNAMIC',
        criterionCount: 1,
        evaluationItemCount: 1,
      },
      overallSynthesis: {
        status: 'CANDIDATE_ONLY',
        sourceResultId: correlationRef,
        authorityLevel: 'candidate_only',
        externalDiscoveryIsEvidence: false,
      },
    },
  };
}

function p0bStatus(workItemId, reevaluation) {
  return {
    entry: { workItemId },
    integratedAssessmentSummary: null,
    configurationEvidenceReevaluation: structuredClone(reevaluation),
  };
}

function p0bReevaluation(nextStage) {
  const stages = {
    applicability: {
      status: nextStage === 'APPLICABILITY' ? 'PENDING' : 'SUCCEEDED',
      retryNo: 0,
    },
    jobAid: {
      status:
        nextStage === 'APPLICABILITY' || nextStage === 'JOB_AID'
          ? 'PENDING'
          : 'SUCCEEDED',
      retryNo: 0,
    },
    overall: {
      status: nextStage === null ? 'SUCCEEDED' : 'PENDING',
      retryNo: 0,
    },
  };
  return {
    schemaVersion: CONFIGURATION_EVIDENCE_REEVALUATION_STATUS_SCHEMA,
    triggerSnapshotId: 'CES-P0B-FIXTURE-001',
    triggerConfigurationRevision: 2,
    mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
    status: nextStage === null ? 'SUCCEEDED' : 'RUNNING',
    nextStage,
    stages,
    servingCurrentPreserved: nextStage !== null,
    candidateOnly: true,
  };
}

async function matterReviewFixture(turnNo = 1) {
  const first = turnNo === 2 ? await matterReviewFixture(1) : null;
  const reviewTask = await readJson(REVIEW_TASK_FIXTURE_URL);
  Object.assign(reviewTask, {
    schemaVersion: 'wiselink.3_1.review_turn_task.v1.c4',
    reviewConversationRef: 'RC-matter-private', reviewTurnRef: 'RT-matter-private-' + turnNo,
    requestId: 'REQ-matter-private-' + turnNo, actorContextRef: 'ACTX-RS-matter-private',
    selectedEvaluationItemId: null, allowedEvaluationItemIds: [], allowedAdoptedInputRefs: [], attachmentRefs: [],
    userMessage: turnNo === 1 ? '请根据文件 A、B 形成当前问题理解，其他材料仍待核对。' : '请纠正 claim-origin，保留传感器安装条件和其他未变结论。',
    executionPolicy: { ...reviewTask.executionPolicy, toolPolicyRef: 'wiselink-openclaw-engineering-assessment@1.2.0#interactive-matter-review-c4' },
  });
  const inputs = [1, 2, 3].map((index) => ({
    inputId: 'WI-matter-private-' + index, workItemId: 'WI-matter-private-' + index,
    workItemRevision: 7, documentVersionId: 'DV-matter-' + index,
    resultRef: null, resultRevision: null,
  }));
  const scope = {
    schemaVersion: 'wiselink.3_1.matter_review_scope.v1', kind: 'ENGINEERING_MATTER',
    matterId: 'MATTER-private-identity', basedOnMatterRevisionId: 'MREV-membership-1',
    expectedWorkingRevision: turnNo - 1, targetClaimId: turnNo === 1 ? null : 'claim-origin', inputs,
  };
  const documentEvidence = [
    'SOURCE_A_FULL_PASSAGE: The proposed check applies only to aircraft with sensor P installed.',
    'SOURCE_B_FULL_PASSAGE: Document B separately describes connector Q inspection.',
    'SOURCE_C_UNREAD_PASSAGE: A later service issue remains outside the ranges checked in this review.',
  ].map((excerpt, index) => ({
    evidenceRef: `matter-evidence:revision:${turnNo === 2 && index === 2 ? 2 : 1}:document:${index + 1}:1`,
    kind: 'DOCUMENT_PASSAGE', title: '文件 ' + ['A', 'B', 'C'][index], versionLabel: 'Revision 1', excerpt,
    workItemId: inputs[index].workItemId, documentVersionId: inputs[index].documentVersionId,
    sourceRefId: 'urn:source:shared-original-page', locator: 'page 1-1',
  }));
  const engineerEvidence = {
    evidenceRef: `matter-evidence:revision:${turnNo}:engineer`, kind: 'ENGINEER_STATEMENT', origin: 'REVIEW_CONVERSATION',
    title: '工程师本轮说明', versionLabel: null,
    excerpt: turnNo === 1 ? '当前尚未核对本机传感器安装状态。' : '请保留传感器安装条件；补充说法仅代表工程师陈述。',
    reviewConversationId: reviewTask.reviewConversationRef, reviewTurnId: reviewTask.reviewTurnRef,
    engineerSuppliedInputId: 'EINPUT-private-' + turnNo, recordedAt: '2026-09-08T02:00:00.000Z',
  };
  const evidenceSources = documentEvidence.map((item, index) => ({
    evidenceRef: item.evidenceRef, sourceRefId: `matter-source:${index + 1}:1`, inputId: inputs[index].inputId,
  }));
  reviewTask.resourceRefs = documentEvidence.map((item, index) => ({
    sourceRefId: evidenceSources[index].sourceRefId,
    resourceArtifactRef: 'artifact://fixture/matter-document-' + (index + 1), resourceArtifactSha256: ['a', 'b', 'c'][index].repeat(64),
    value: { sourceRefId: evidenceSources[index].sourceRefId, kind: item.kind, evidenceRef: item.evidenceRef,
      inputRef: 'matter-input:' + (index + 1), documentVersionRef: item.documentVersionId,
      title: item.title, versionLabel: item.versionLabel, locator: item.locator, pageStart: 1, pageEnd: 1, quote: item.excerpt },
  }));
  const firstDelta = first?.delta;
  const workingState = first ? {
    schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1',
    focus: firstDelta.nextFocus,
    substantiveResult: {
      resultRef: 'MRESULT-private-1', resultRevision: 1,
      scope: { kind: 'ENGINEERING_MATTER', matterId: scope.matterId },
      content: { schemaVersion: 'wiselink.3_1.assessment_reading.v1', ...firstDelta.readingPresentation, claims: firstDelta.claimDelta.additions },
      evidence: first.reviewTask.matterContext.readingEvidence.filter((item) => item.kind === 'ENGINEER_STATEMENT' || item.title !== '文件 C'),
      candidateOnly: true,
    },
    openQuestions: firstDelta.openQuestionDelta.upserts, reviewConditions: [],
    substantiveInputs: inputs.slice(0, 2),
    coverage: firstDelta.coverageUpdates.map(({ inputRef, ...coverage }) => ({
      binding: inputs[Number(inputRef.split(':')[1]) - 1], ...coverage,
      // Host persists original SourceRefs inside the document binding, while
      // model deltas contain task-local aliases.
      checkedSourceRefIds: coverage.checkedSourceRefIds.map((id) => {
        const source = first.reviewTask.matterContext.evidenceSources.find((item) => item.sourceRefId === id);
        return first.reviewTask.matterContext.readingEvidence.find((item) => item.evidenceRef === source.evidenceRef).sourceRefId;
      }),
    })),
  } : null;
  const readingEvidence = [...documentEvidence,
    ...(workingState?.substantiveResult.evidence.filter((item) => item.kind === 'ENGINEER_STATEMENT') ?? []), engineerEvidence];
  const safeEvidence = (item) => ({
    evidenceRef: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel,
    locator: item.locator ?? null,
    sourceRefId: evidenceSources.find((source) => source.evidenceRef === item.evidenceRef)?.sourceRefId ?? null,
    providedText: item.kind === 'DOCUMENT_PASSAGE' ? null : item.excerpt,
  });
  reviewTask.matterContext = { scope, title: '传感器条件与独立连接器问题', workingState, readingEvidence, evidenceSources };
  reviewTask.context = { matterWorking: {
    title: reviewTask.matterContext.title, workingRevision: scope.expectedWorkingRevision,
    membershipRevisionRef: scope.basedOnMatterRevisionId, targetClaimId: scope.targetClaimId,
    currentResult: workingState ? { content: workingState.substantiveResult.content, evidence: workingState.substantiveResult.evidence.map(safeEvidence) } : null,
    focus: workingState?.focus ?? null, openQuestions: workingState?.openQuestions ?? [], reviewConditions: [],
    inputs: inputs.map((item, index) => ({ inputRef: 'matter-input:' + (index + 1), documentVersionRef: item.documentVersionId,
      title: documentEvidence[index].title, versionLabel: documentEvidence[index].versionLabel, pending: turnNo === 1 || index === 2 })),
    evidenceCatalog: readingEvidence.map(safeEvidence),
  } };
  const premise = (evidenceRef, role = 'SUPPORTS') => ({ evidenceRef, role,
    explanation: role === 'LIMITS' ? '工程师补充限定当前理解的边界。' : '该前提直接支持此项表述。',
    limitation: role === 'LIMITS' ? '工程师陈述不是受控完成记录。' : null });
  const originClaim = {
    claimId: 'claim-origin', text: turnNo === 1 ? '文件 A 所述检查仅适用于已安装传感器 P 的飞机。' : '保留文件 A 的传感器 P 安装条件；当前陈述不证明本机已满足该条件。',
    basis: turnNo === 1 ? 'SOURCE_FACT' : 'CONDITIONAL_INFERENCE',
    premises: [premise(documentEvidence[0].evidenceRef), ...(turnNo === 2 ? [premise(engineerEvidence.evidenceRef, 'LIMITS')] : [])],
  };
  const additions = turnNo === 1 ? [originClaim,
    { claimId: 'claim-independent', text: '文件 B 独立描述连接器 Q 检查。', basis: 'SOURCE_FACT', premises: [premise(documentEvidence[1].evidenceRef)] },
    { claimId: 'claim-engineer', text: '工程师表示本机传感器安装状态尚未核对。', basis: 'SOURCE_FACT', premises: [premise(engineerEvidence.evidenceRef)] },
  ] : [];
  const delta = {
    updateKind: turnNo === 1 ? 'INITIAL_SYNTHESIS' : 'CORRECTION',
    changeSummary: turnNo === 1 ? '建立保留构型条件的当前理解，记录独立问题。' : '按原文和工程师补充修正 claim-origin，保留其他两项理解。',
    nextFocus: turnNo === 1 ? { question: '当前问题的适用条件与独立影响是什么？', targetRefs: [] } : null,
    claimDelta: { changedBecause: turnNo === 1 ? '本轮实际读取文件 A、B 的相关片段。' : '本轮复读 A 的适用条件，并纳入工程师陈述的限制。',
      additions, replacements: turnNo === 2 ? [originClaim] : [], retirements: [],
      explicitlyUnchangedClaimIds: turnNo === 2 ? ['claim-independent', 'claim-engineer'] : [] },
    readingPresentation: { headline: '保留传感器安装条件', listBrief: '传感器条件与独立连接器问题仍需分别理解。',
      lead: '文件 A 的条件仍保留；文件 B 独立说明连接器问题，工程师尚未核对本机构型。',
      decisiveClaimIds: ['claim-origin', 'claim-independent'] },
    openQuestionDelta: turnNo === 1 ? { upserts: [{ itemId: 'question-config', text: '本机是否安装传感器 P？', basisRefs: [documentEvidence[0].evidenceRef] }], retirements: [], explicitlyUnchangedItemIds: [] } : null,
    reviewConditionDelta: null,
    coverageUpdates: inputs.slice(0, turnNo === 1 ? 2 : 1).map((_, index) => ({
      inputRef: 'matter-input:' + (index + 1), checkedSourceRefIds: [evidenceSources[index].sourceRefId],
      checkedScope: `仅核对文件 ${['A', 'B'][index]} 第 1 页所给片段`, contribution: 'SUBSTANTIVE', reason: '该范围支持上述保留条件的理解。',
    })),
  };
  return { reviewTask, delta };
}

function matterReviewModelOutput(delta) {
  return { responseType: delta === null ? 'ANSWER' : 'RESYNTHESIS_RESULT',
    answer: delta === null ? '这是对当前问题的普通解释。' : delta.changeSummary,
    sourceRefs: [], missingInputs: [], candidateEvidenceRefs: [], reviewActionDraft: null, affectedItemIds: [], warnings: [], matterWorkingDelta: delta };
}

function matterReviewCandidate(reviewTask, delta) {
  return { schemaVersion: 'wiselink.3_1.review_turn_candidate.v1.c4', mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: reviewTask.reviewConversationRef, reviewTurnRef: reviewTask.reviewTurnRef,
    ...matterReviewModelOutput(delta), runtime: { runtimeAppId: reviewTask.executionPolicy.runtimeAppId, profileRef: reviewTask.executionPolicy.profileRef } };
}

function reviewContext(task, reviewTask) {
  return {
    schemaVersion: 'wiselink.3_1.review_turn_context.v1.c2',
    attemptRef: task.operationRef,
    reviewConversationRef: reviewTask.reviewConversationRef,
    reviewTurnRef: reviewTask.reviewTurnRef,
    mode: 'INTERACTIVE_REVIEW',
    selectedEvaluationItemId: reviewTask.selectedEvaluationItemId,
    inputRevision: reviewTask.inputRevision,
    allowedOperations: [...reviewTask.allowedOperations],
    resourceRefs: reviewTask.resourceRefs.map((resource) => ({
      sourceRefId: resource.sourceRefId,
      resourceArtifactRef: resource.resourceArtifactRef,
      resourceArtifactSha256: resource.resourceArtifactSha256,
    })),
    context: structuredClone(reviewTask.context),
    executionPolicy: structuredClone(reviewTask.executionPolicy),
  };
}

function reviewCommit(attemptRef) {
  return {
    schemaVersion: 'wiselink.3_1.review_turn_commit.v1.c2',
    attemptRef,
    status: 'SUCCEEDED',
    replayed: false,
    assistantCandidate: {},
    authority: {
      candidatePersisted: true,
      reviewActionExecuted: false,
      workItemRevisionChanged: false,
      currentChanged: false,
      staleMarked: false,
    },
  };
}

function attemptStatus(task, statusValue, result) {
  const committing = statusValue === 'COMMITTING';
  const terminal = ['SUCCEEDED', 'WAITING_INPUT', 'FAILED'].includes(
    statusValue,
  );
  return {
    attemptRef: task.operationRef,
    taskType: task.taskType,
    status: statusValue,
    recoveryAvailable: committing,
    commitStartedAt: '2026-08-27T10:00:00.000Z',
    terminalReason: terminal ? 'FIXTURE_TERMINAL' : null,
    projectionApplied:
      statusValue === 'SUCCEEDED' &&
      task.taskType !== 'OPENCLAW_INTERACTIVE_REVIEW',
    resultContentHash: result?.contentHash ?? null,
    ...(committing ? { recoveryResult: result } : {}),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
