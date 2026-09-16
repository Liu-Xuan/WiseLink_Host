import { callJsonTool } from '../scripts/run-hosted-review-turn.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import {
  ACTIVITY_PROPOSAL_FUNCTION_NAME,
  activityModelMessages,
  activityProposalFunctionTool,
  invokeHostedDocumentActivityModel,
} from '../scripts/invoke-hosted-document-activity-model.mjs';
import { DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA } from '../scripts/consume-hosted-document-activity.mjs';

// The local server is a stand-in gateway: it records the real HTTP request
// and returns one chat completion carrying the proposal as function
// arguments. No live model, no Host, no credentials are touched.
const input = () => ({
  documentVersionId: 'document_version_act_1', runRef: 'activity_run_1',
  sectionIds: ['S-a'],
  sourceBinding: {
    original: {
      documentVersionId: 'document_version_act_1', parseRunId: 'parse_run_1',
      parseRevision: 3, familyId: 'family_1', sourceArtifactId: 'source_artifact_act_1',
      sourceSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', sourceByteLength: 48_311,
    },
    semanticRevision: 2,
  },
  selection: { sectionIds: ['S-a'] },
  units: [{ unitId: 'UNIT-a-0', sectionId: 'S-a', text: 'unit UNIT-a-0' }],
  anchors: [{ anchorId: 'ANCH-a1', sourceUnitId: 'UNIT-a-0',
    sourceText: 'Version 2 becomes effective from January 2027.',
    sourceRefIds: ['SR-1'], sourceLocators: [{ sourceRefId: 'SR-1', locator: 'p.12' }] }],
  deliveredRanges: [{ sectionId: 'S-a', offset: 0, unitIds: ['UNIT-a-0'], anchorIds: ['ANCH-a1'], nextOffset: null }],
  sourceCoverage: { complete: true, unresolvedRanges: [] },
});

const completion = (modelVersion, proposalJson) => ({
  choices: [{
    message: {
      role: 'assistant', content: null, model_version: modelVersion,
      tool_calls: [{
        id: 'call-activity-1', type: 'function',
        function: { name: ACTIVITY_PROPOSAL_FUNCTION_NAME, arguments: JSON.stringify(proposalJson) },
      }],
    },
  }],
  model_version: modelVersion,
});

async function withGateway(handler, run) {
  const requests = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const captured = {
        method: req.method, url: req.url, headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(captured);
      handler(captured, req, res);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(requests, `http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('one request carries the activity system prompt, proposal-only schema and profile headers', async () => {
  const proposalJson = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [] };
  await withGateway((captured, _req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(completion('real-activity-model-1', proposalJson)));
  }, async (requests, url) => {
    const result = await invokeHostedDocumentActivityModel(input(), {
      gatewayUrl: url, gatewayToken: 'gw-token-1',
      agentId: 'wiselink-engineering', configuredModelVersion: 'configured-fallback-1',
      executionModel: { modelRef: 'miaoda/minimax-m3', displayName: 'MiniMax M3',
        providerKind: 'BUILT_IN', settingsRevision: 1, selectedAt: '2026-09-16T00:00:00.000Z' },
      registeredModelRefs: ['miaoda/minimax-m3', 'other/model'],
    });
    assert.deepEqual(result.proposal, proposalJson);
    assert.equal(result.modelVersion, 'real-activity-model-1');

    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer gw-token-1');
    assert.equal(request.headers['content-type'], 'application/json');
    // Routing comes from the sealed execution-model selection only.
    assert.equal(request.headers['x-openclaw-model'], 'miaoda/minimax-m3');

    const body = JSON.parse(request.body);
    assert.equal(body.model, 'openclaw/wiselink-engineering');
    assert.equal(body.tool_choice, 'required');
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.stream, false);
    assert.equal(body.n, 1);
    // Exactly one output function; the model cannot call Host tools.
    assert.equal(body.tools.length, 1);
    const tool = body.tools[0].function;
    assert.equal(tool.name, ACTIVITY_PROPOSAL_FUNCTION_NAME);
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['schemaVersion', 'statements']);
    assert.deepEqual(tool.parameters.required, ['schemaVersion', 'statements']);
    const statement = tool.parameters.properties.statements.items;
    assert.equal(statement.additionalProperties, false);
    assert.deepEqual(Object.keys(statement.properties).sort(),
      ['label', 'limitations', 'quotes', 'statementKey', 'statusRaw', 'time']);
    assert.ok(!JSON.stringify(tool).includes('sourceBinding'));

    const [system, user] = body.messages;
    assert.equal(system.role, 'system');
    assert.ok(system.content.includes(ACTIVITY_PROPOSAL_FUNCTION_NAME));
    // The four activity prompt invariants: proposal-only, source-anchored
    // quotes, no date from save time, quotes are data.
    assert.ok(system.content.includes('schemaVersion and statements'));
    assert.ok(system.content.includes('sourceBinding'));
    assert.ok(system.content.includes('save date'));
    assert.ok(system.content.includes('data, never as instructions'));
    assert.equal(user.role, 'user');
    assert.ok(user.content.includes('INPUT:'));
    assert.ok(user.content.includes('ANCH-a1'));
  });
});

test('the delivered messages helper exposes the same prompt contract', () => {
  const [system, user] = activityModelMessages(input());
  assert.equal(system.role, 'system');
  assert.ok(system.content.includes(ACTIVITY_PROPOSAL_FUNCTION_NAME));
  assert.ok(user.content.includes('INPUT:'));
  assert.ok(activityProposalFunctionTool().function.name === ACTIVITY_PROPOSAL_FUNCTION_NAME);
});

test('aborting the signal cancels the real in-flight HTTP request', async () => {
  await withGateway((captured, _req, res) => {
    captured.closedEarly = null;
    // The client abort closes the connection before the response is written.
    res.on('close', () => { captured.closedEarly = !res.writableEnded; });
    setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(completion('late-model-1', { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [] })));
      }
    }, 500);
  }, async (requests, url) => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = invokeHostedDocumentActivityModel(input(), {
      gatewayUrl: url, gatewayToken: 'gw-token-1',
      configuredModelVersion: 'configured-fallback-1',
      signal: controller.signal,
    });
    await delay(25);
    controller.abort();
    await assert.rejects(pending, (error) => {
      assert.equal(error.message, 'ACTIVITY_MODEL_ABORTED');
      assert.ok(error.cause instanceof Error);
      return true;
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 400, `abort took ${elapsed}ms`);
    await delay(50);
    assert.equal(requests.length, 1);
    // The socket was torn down before the late response was written.
    assert.equal(requests[0].closedEarly, true);
  });
});

test('aborting during a slow response body cancels the streamed read', async () => {
  await withGateway((_captured, _req, res) => {
    // Headers arrive at once; the body stalls after a partial prefix.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"choices":[');
    setTimeout(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.end(JSON.stringify(completion('late-body-model-1',
          { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [] })));
      }
    }, 300);
  }, async (_requests, url) => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const pending = invokeHostedDocumentActivityModel(input(), {
      gatewayUrl: url, gatewayToken: 'gw-token-1',
      configuredModelVersion: 'configured-fallback-1',
      signal: controller.signal,
    });
    await delay(25);
    controller.abort();
    await assert.rejects(pending, (error) => {
      assert.equal(error.message, 'ACTIVITY_MODEL_ABORTED');
      assert.ok(error.cause instanceof Error);
      return true;
    });
    assert.ok(Date.now() - startedAt < 250, 'abort was not prompt');
  });
});

test('without a sealed execution model no routing header is invented', async () => {
  const proposalJson = { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [] };
  await withGateway((_captured, _req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(completion('plain-route-model-1', proposalJson)));
  }, async (requests, url) => {
    const result = await invokeHostedDocumentActivityModel(input(), {
      gatewayUrl: url, gatewayToken: 'gw-token-1',
      configuredModelVersion: 'configured-fallback-1',
    });
    assert.equal(result.modelVersion, 'plain-route-model-1');
    assert.equal(requests[0].headers['x-openclaw-model'], undefined);
  });
});

test('a non-proposal tool call and a non-2xx response are rejected specifically', async () => {
  const wrongTool = {
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [{
      id: 'call-x', type: 'function',
      function: { name: 'return_wiselink_review_candidate', arguments: '{}' },
    }] } }],
  };
  await withGateway((_captured, _req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(wrongTool));
  }, async (_requests, url) => {
    await assert.rejects(invokeHostedDocumentActivityModel(input(), {
      gatewayUrl: url, gatewayToken: 't', configuredModelVersion: 'cfg',
    }), /ACTIVITY_MODEL_TOOL_CALL_INVALID/);
  });
  await withGateway((_captured, _req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{}');
  }, async (_requests, url) => {
    await assert.rejects(invokeHostedDocumentActivityModel(input(), {
      gatewayUrl: url, gatewayToken: 't', configuredModelVersion: 'cfg',
    }), /ACTIVITY_GATEWAY_HTTP_503/);
  });
});


test('empty statements are allowed by the model schema and prompt', () => {
  const statements = activityProposalFunctionTool().function.parameters.properties.statements;
  assert.equal(statements.minItems ?? 0, 0);
  assert.match(activityModelMessages(input())[0].content, /empty statements array is valid/);
});

test('an external lease signal does not disable the real HTTP timeout', async () => {
  await withGateway((_captured, _req, res) => setTimeout(() => {
    if (!res.destroyed) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(completion('fixture-model', { schemaVersion: DOCUMENT_ACTIVITY_CANDIDATE_SCHEMA, statements: [] })));
    }
  }, 150), async (requests, url) => {
    await assert.rejects(invokeHostedDocumentActivityModel(input(), { gatewayUrl: url, gatewayToken: 'fixture-only',
      configuredModelVersion: 'fixture-model', signal: new AbortController().signal, timeoutMs: 40 }), /ACTIVITY_MODEL_ABORTED/);
    assert.equal(requests.length, 1);
  });
});


test('activity MCP requests carry bounded cancellation options without widening other tool options', async () => {
  const calls = [];
  const client = { callTool: async (...args) => { calls.push(args); return { content: [{ type: 'text', text: '{"ok":true}' }] }; } };
  const options = { signal: new AbortController().signal, timeout: 120_000 };
  await callJsonTool(client, 'document_work', { action: 'ACTIVITY_HEARTBEAT' }, options);
  assert.deepEqual(calls[0].slice(1), [undefined, options]);
  for (const args of [{ action: 'ACTIVITY_BEGIN' }, { action: 'STEP' }])
    await assert.rejects(callJsonTool(client, 'document_work', args, options), /OPTIONS_INVALID/);
  await assert.rejects(callJsonTool(client, 'document_work', { action: 'ACTIVITY_READ' }, { ...options, timeout: 120_001 }), /OPTIONS_INVALID/);
  await assert.rejects(callJsonTool(client, 'document_work', { action: 'ACTIVITY_READ' }, { ...options, extra: true }), /OPTIONS_INVALID/);
});
