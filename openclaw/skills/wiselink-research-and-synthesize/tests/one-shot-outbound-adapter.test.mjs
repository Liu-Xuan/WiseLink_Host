import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createOneShotOutboundAdapter } from '../scripts/one-shot-outbound-adapter.mjs';

const body = JSON.stringify({ model: 'glm-5.3', max_completion_tokens: 64000,
  messages: [{ role: 'user', content: 'Complete frozen input' }] });

function adapter(fetchUpstream, maxModelRequests = 2,
  expectedReasoningEffort) {
  return createOneShotOutboundAdapter({
    attemptRef: 'AQ-adaptive-fixture', modelId: 'glm-5.3',
    upstreamBaseUrl: 'https://official.example/v1',
    upstreamHeaders: { 'x-official-lane': 'fixture-only' },
    maxCompletionTokens: 64000, maxModelRequests,
    expectedReasoningEffort,
    absoluteDeadline: new Date(Date.now() + 10_000).toISOString(),
    fetchUpstream,
  });
}

async function send(route, completionTokens = 64000, reasoningEffort,
  extras = {}) {
  const requestBody = { ...JSON.parse(body),
    max_completion_tokens: completionTokens,
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
    ...extras };
  return fetch(`${route.baseUrl}${route.path}`, { method: 'POST',
    headers: { 'x-wiselink-attempt-nonce': route.nonce,
      authorization: 'Bearer fixture-only', 'content-type': 'application/json' },
    body: JSON.stringify(requestBody) });
}

test('an explicit effort must reach the real upstream body before dispatch',
  async () => {
    let fetched = 0;
    const gateway = adapter(async (_url, init) => {
      fetched++;
      assert.equal(JSON.parse(init.body).reasoning_effort, 'low');
      return Response.json({ choices: [{ finish_reason: 'stop' }] });
    }, 1, 'low');
    const route = await gateway.start();
    try {
      assert.equal((await send(route, 64000, 'low')).status, 200);
      const receipt = await settled(gateway);
      assert.equal(fetched, 1);
      assert.equal(receipt.expectedReasoningEffort, 'low');
      assert.equal(receipt.observedReasoningEffort, 'LOW');
      assert.equal(receipt.observedThinkingMode, 'ABSENT');
      assert.equal(receipt.upstreamDispatchCount, 1);
    } finally { await gateway.close(); }
  });

test('missing or wrong effort closes without a real provider dispatch', async () => {
  for (const [supplied, observed] of [[undefined, 'ABSENT'],
    ['high', 'HIGH'], ['off', 'OTHER']]) {
    let fetched = 0;
    const gateway = adapter(async () => { fetched++; return Response.json({}); },
      1, 'low');
    const route = await gateway.start();
    try {
      const response = await send(route, 64000, supplied);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: {
        code: 'ADAPTER_REASONING_EFFORT_MISMATCH' } });
      const receipt = gateway.getSanitizedReceipt();
      assert.equal(receipt.expectedReasoningEffort, 'low');
      assert.equal(receipt.observedReasoningEffort, observed);
      assert.equal(receipt.upstreamDispatchCount, 0);
      assert.equal(fetched, 0);
      assert.equal((await send(route, 64000, 'low')).status, 409);
    } finally { await gateway.close(); }
  }
});

test('GLM-5.3 thinking-off request is rejected before provider dispatch',
  async () => {
    for (const extras of [{ thinking: { type: 'disabled' } },
      { enable_thinking: false }]) {
      let fetched = 0;
      const gateway = adapter(async () => { fetched++; return Response.json({}); },
        1, 'low');
      const route = await gateway.start();
      try {
        const response = await send(route, 64000, 'low', extras);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), { error: {
          code: 'ADAPTER_THINKING_DISABLED_UNSUPPORTED' } });
        const receipt = gateway.getSanitizedReceipt();
        assert.equal(receipt.observedReasoningEffort, 'LOW');
        assert.equal(receipt.observedThinkingMode, 'DISABLED');
        assert.equal(receipt.upstreamDispatchCount, 0);
        assert.equal(fetched, 0);
      } finally { await gateway.close(); }
    }
  });

async function settled(gateway) {
  for (let i = 0; i < 50; i += 1) {
    const receipt = gateway.getSanitizedReceipt();
    if (receipt.activeOrdinal === null) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('ADAPTER_TEST_NOT_SETTLED');
}

test('provider dispatch ledger admits only bounded sequential known terminals', async () => {
  const statuses = [503, 200];
  const seen = [];
  const gateway = adapter(async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body), headers: init.headers });
    const status = statuses.shift();
    return status === 503
      ? Response.json({ error: { message: 'busy' } }, { status })
      : Response.json({ choices: [{ finish_reason: 'tool_calls' }] }, { status });
  });
  const route = await gateway.start();
  try {
    assert.equal((await send(route)).status, 503);
    assert.equal((await send(route)).status, 200);
    assert.equal((await send(route)).status, 409);
    const receipt = await settled(gateway);
    assert.equal(receipt.upstreamDispatchCount, 2);
    assert.deepEqual(receipt.dispatches.map((item) => item.ordinal), [1, 2]);
    assert.deepEqual(receipt.dispatches.map((item) => item.actualCompletionTokens),
      [64000, 64000]);
    assert.deepEqual(receipt.dispatches.map((item) => item.providerKnownTerminal),
      [true, true]);
    assert.equal(receipt.unknownTerminal, false);
    assert.equal(seen.length, 2);
    assert.equal(seen[0].url, 'https://official.example/v1/chat/completions');
    assert.equal(seen[0].body.max_completion_tokens, 64000);
    assert.equal(seen[0].headers['x-official-lane'], 'fixture-only');
  } finally { await gateway.close(); }
});

test('receipt distinguishes actual native cap from caller allowance', async () => {
  const gateway = adapter(async () => Response.json({ choices: [
    { finish_reason: 'tool_calls' }] }), 1);
  const route = await gateway.start();
  try {
    assert.equal((await send(route, 32000)).status, 200);
    const receipt = await settled(gateway);
    assert.equal(receipt.maxCompletionTokens, 64000);
    assert.equal(receipt.dispatches[0].actualCompletionTokens, 32000);
  } finally { await gateway.close(); }
});

test('transport EOF without provider terminal proof permanently closes dispatch', async () => {
  const gateway = adapter(async () => new Response(
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
    { headers: { 'content-type': 'text/event-stream' } }));
  const route = await gateway.start();
  try {
    assert.equal((await send(route)).status, 200);
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].transportCompleted, true);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, false);
    assert.equal(receipt.unknownTerminal, true);
    assert.equal((await send(route)).status, 409);
    assert.equal(gateway.getSanitizedReceipt().upstreamDispatchCount, 1);
  } finally { await gateway.close(); }
});

test('SSE finish reason followed by DONE proves a provider terminal', async () => {
  const gateway = adapter(async () => new Response(
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } }), 1);
  const route = await gateway.start();
  try {
    assert.equal((await send(route)).status, 200);
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].transportCompleted, true);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
    assert.equal(receipt.unknownTerminal, false);
  } finally { await gateway.close(); }
});

test('known length terminal closes remaining slots before native can retry', async () => {
  let fetched = 0;
  const gateway = adapter(async () => {
    fetched++;
    return new Response('data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
  });
  const route = await gateway.start();
  try {
    assert.equal((await send(route)).status, 200);
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
    assert.equal(receipt.dispatches[0].finishReason, 'length');
    assert.equal(receipt.unknownTerminal, false);
    assert.equal((await send(route)).status, 409);
    assert.equal(gateway.getSanitizedReceipt().upstreamDispatchCount, 1);
    assert.equal(fetched, 1);
  } finally { await gateway.close(); }
});

test('502 SSE envelope cannot prove a provider terminal', async () => {
  const gateway = adapter(async () => new Response(
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n',
    { status: 502, headers: { 'content-type': 'text/event-stream' } }));
  const route = await gateway.start();
  try {
    assert.equal((await send(route)).status, 502);
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, false);
    assert.equal(receipt.unknownTerminal, true);
    assert.equal((await send(route)).status, 409);
  } finally { await gateway.close(); }
});

test('complete 502 or 504 JSON does not prove that the provider stopped', async () => {
  for (const status of [502, 504]) {
    const gateway = adapter(async () => Response.json({ error: {
      message: 'synthetic proxy error' } }, { status }));
    const route = await gateway.start();
    try {
      assert.equal((await send(route)).status, status);
      const receipt = await settled(gateway);
      assert.equal(receipt.dispatches[0].transportCompleted, true);
      assert.equal(receipt.dispatches[0].providerKnownTerminal, false);
      assert.equal(receipt.unknownTerminal, true);
      assert.equal((await send(route)).status, 409);
      assert.equal(gateway.getSanitizedReceipt().upstreamDispatchCount, 1);
    } finally { await gateway.close(); }
  }
});

test('overlapping slow request bodies close the slot before either provider dispatch',
  async () => {
    let fetchCount = 0;
    const gateway = adapter(async () => {
      fetchCount++;
      return Response.json({ choices: [{ finish_reason: 'tool_calls' }] });
    });
    const route = await gateway.start();
    let firstReq;
    let timeout;
    try {
      let receivedContinue;
      let failedContinue;
      const continued = new Promise((resolve, reject) => {
        receivedContinue = resolve;
        failedContinue = reject;
      });
      const first = new Promise((resolve, reject) => {
        firstReq = httpRequest(`${route.baseUrl}${route.path}`, { method: 'POST',
          headers: { 'x-wiselink-attempt-nonce': route.nonce,
            authorization: 'Bearer fixture-only',
            'content-type': 'application/json',
            expect: '100-continue' } }, (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode));
        });
        firstReq.once('error', (error) => {
          failedContinue(error);
          reject(error);
        });
        firstReq.once('continue', () => {
          // The server acknowledged the headers and reserved pendingRequest
          // before reading this incomplete body. Keep it open for request two.
          firstReq.write(body.slice(0, 10));
          receivedContinue();
        });
        firstReq.flushHeaders();
      });
      first.catch(() => {}); // Keep timeout cleanup from surfacing as an unhandled rejection.
      timeout = setTimeout(() => firstReq.destroy(
        new Error('ADAPTER_OVERLAP_TEST_TIMEOUT')), 10_000);
      await continued;
      assert.equal((await send(route)).status, 409);
      firstReq.end(body.slice(10));
      assert.equal(await first, 409);
      assert.equal(fetchCount, 0);
      assert.equal(gateway.getSanitizedReceipt().unknownTerminal, true);
    } finally {
      clearTimeout(timeout);
      if (firstReq && !firstReq.writableEnded) firstReq.destroy();
      await gateway.close();
    }
  });

test('concurrent local request permanently closes the adapter even if first ends', async () => {
  let release;
  let arrived;
  const entered = new Promise((resolve) => { arrived = resolve; });
  const gateway = adapter(async () => {
    arrived();
    return new Promise((resolve) => { release = () => resolve(Response.json(
      { choices: [{ finish_reason: 'tool_calls' }] })); });
  });
  const route = await gateway.start();
  try {
    const first = send(route);
    await entered;
    assert.equal((await send(route)).status, 409);
    release();
    assert.equal((await first).status, 200);
    const receipt = await settled(gateway);
    assert.equal(receipt.unknownTerminal, true);
    assert.equal((await send(route)).status, 409);
    assert.equal(receipt.upstreamDispatchCount, 1);
  } finally { await gateway.close(); }
});

function streamedSse(parts) {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (index < parts.length) controller.enqueue(encoder.encode(parts[index++]));
    else controller.close();
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

function streamedSseBytes(parts) {
  let index = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (index < parts.length) controller.enqueue(parts[index++]);
    else controller.close();
  } }), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
}

test('SSE terminal proof survives more than 4 MiB across bounded events', async () => {
  const content = 'x'.repeat(1024);
  const event = `data: ${JSON.stringify({ choices: [{ delta: { content },
    finish_reason: null }] })}\n\n`;
  const parts = Array.from({ length: 4200 }, () => event);
  parts.push('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
    'data: [DONE]\n\n');
  const gateway = adapter(async () => streamedSse(parts), 1);
  const route = await gateway.start();
  try {
    const response = await send(route);
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    const receipt = await settled(gateway);
    const observed = receipt.dispatches[0].terminalObservation;
    assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
    assert.equal(receipt.dispatches[0].finishReason, 'tool_calls');
    assert.equal(observed.parseCode, 'KNOWN_TERMINAL');
    assert(observed.bodyBytes > 4 * 1024 * 1024);
    assert.equal(observed.totalExceededLegacyLimit, true);
    assert.equal(observed.eventOverflow, false);
    assert.equal(observed.doneFinal, true);
    assert.equal(observed.dataEventCount, 4202);
    assert.equal(observed.contentTypeClass, 'SSE');
    assert(Number.isSafeInteger(observed.firstChunkMs));
    assert(observed.lastChunkMs >= observed.firstChunkMs);
  } finally { await gateway.close(); }
});

test('SSE accepts BOM, CR-only and split CRLF event separators', async () => {
  for (const [parts, expectedLineEnding] of [
    [['\uFEFFdata: {"choices":[{"finish_reason":"tool_calls"}]}\r',
      '\rdata: [DONE]\r', '\r'], 'CR'],
    [['data: {"choices":[{"finish_reason":"tool_calls"}]}\r',
      '\n\r', '\ndata: [DONE]\r', '\n\r', '\n'], 'CRLF'],
  ]) {
    const gateway = adapter(async () => streamedSse(parts), 1);
    const route = await gateway.start();
    try {
      const response = await send(route);
      await response.text();
      const receipt = await settled(gateway);
      assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
      assert.equal(receipt.dispatches[0].terminalObservation.lineEndingKind,
        expectedLineEnding);
      assert.equal(receipt.dispatches[0].terminalObservation.doneFinal, true);
    } finally { await gateway.close(); }
  }
});

test('SSE decodes a multibyte character split across transport chunks', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('data: {"choices":[{"delta":{"content":"中"},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
  const splitAt = bytes.indexOf(0xe4) + 1;
  assert(splitAt > 0);
  const gateway = adapter(async () => streamedSseBytes([
    bytes.subarray(0, splitAt), bytes.subarray(splitAt, splitAt + 1),
    bytes.subarray(splitAt + 1),
  ]), 1);
  const route = await gateway.start();
  try {
    const response = await send(route);
    await response.arrayBuffer();
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
    assert.equal(receipt.dispatches[0].terminalObservation.parseCode,
      'KNOWN_TERMINAL');
  } finally { await gateway.close(); }
});

test('SSE malformed UTF-8 cannot prove a provider terminal', async () => {
  const encoder = new TextEncoder();
  const gateway = adapter(async () => streamedSseBytes([
    new Uint8Array([0xff]),
    encoder.encode('data: {"choices":[{"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'),
  ]), 1);
  const route = await gateway.start();
  try {
    const response = await send(route);
    await response.arrayBuffer();
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, false);
    assert.equal(receipt.dispatches[0].terminalObservation.parseCode,
      'SSE_UTF8_INVALID');
    assert.equal(receipt.unknownTerminal, true);
  } finally { await gateway.close(); }
});

test('SSE permits usage metadata after a finish reason before DONE', async () => {
  const gateway = adapter(async () => streamedSse([
    'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
    'data: {"usage":{"total_tokens":7}}\n\n',
    'data: [DONE]\n\n',
  ]), 1);
  const route = await gateway.start();
  try {
    const response = await send(route);
    await response.arrayBuffer();
    const receipt = await settled(gateway);
    assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
    assert.equal(receipt.dispatches[0].terminalObservation.dataEventCount, 3);
  } finally { await gateway.close(); }
});

test('SSE records only fixed delta counters for reasoning, content and tool arguments',
  async () => {
    const gateway = adapter(async () => streamedSse([
      'data: {"choices":[{"delta":{"reasoning_content":"思考"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"结论"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"a\\":1}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]), 1);
    const route = await gateway.start();
    try {
      const response = await send(route);
      await response.arrayBuffer();
      const receipt = await settled(gateway);
      const observation = receipt.dispatches[0].terminalObservation;
      assert.equal(receipt.dispatches[0].providerKnownTerminal, true);
      assert.deepEqual([
        observation.reasoningDeltaEvents, observation.reasoningDeltaChars,
        observation.contentDeltaEvents, observation.contentDeltaChars,
        observation.toolArgDeltaEvents, observation.toolArgDeltaChars,
      ], [1, 2, 1, 2, 1, 7]);
      assert.equal(JSON.stringify(observation).includes('思考'), false);
      assert.equal(JSON.stringify(observation).includes('结论'), false);
    } finally { await gateway.close(); }
  });

test('SSE missing DONE, invalid data, unknown finish and oversized event stay closed',
  async () => {
    const finish = 'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n';
    const cases = [
      { parts: [finish], code: 'SSE_DONE_MISSING' },
      { parts: [finish, 'data: [DONE]'], code: 'SSE_PENDING_EVENT_AT_EOF' },
      { parts: ['data: not-json\n\n', 'data: [DONE]\n\n'],
        code: 'SSE_DATA_JSON_INVALID' },
      { parts: [finish, 'data: {"error":{"message":"synthetic transport error"}}\n\n',
        'data: [DONE]\n\n'], code: 'SSE_PROVIDER_ERROR' },
      { parts: ['data: {"choices":[{"finish_reason":"novel"}]}\n\n',
        'data: [DONE]\n\n'], code: 'SSE_FINISH_UNSUPPORTED' },
      { parts: [`data: ${'x'.repeat(1024 * 1024 + 1)}\n\n`,
        'data: [DONE]\n\n'], code: 'SSE_EVENT_OVERFLOW' },
      { parts: [finish, 'data: [DONE]\n\n', 'event: error\n\n'],
        code: 'SSE_AFTER_DONE' },
    ];
    for (const item of cases) {
      const gateway = adapter(async () => streamedSse(item.parts));
      const route = await gateway.start();
      try {
        const response = await send(route);
        await response.arrayBuffer();
        const receipt = await settled(gateway);
        assert.equal(receipt.dispatches[0].providerKnownTerminal, false,
          item.code);
        assert.equal(receipt.dispatches[0].terminalObservation.parseCode,
          item.code);
        assert.equal(receipt.unknownTerminal, true);
        assert.equal((await send(route)).status, 409);
      } finally { await gateway.close(); }
    }
  });
