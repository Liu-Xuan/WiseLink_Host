import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleRoot = join(root, 'dist/server/modules/canonical-host');
const { CanonicalHostMcpService } = await import(
  pathToFileURL(join(moduleRoot, 'canonical-host-mcp.service.js'))
);

const calls = [];
const methods = [];
const mcp = new CanonicalHostMcpService({
  openApiStatus: async (workItemId) => {
    calls.push({ tool: 'get_parse_status', workItemId });
    await delay(workItemId.endsWith('SLOW') ? 15 : 1);
    return { workItemId, status: `STATUS:${workItemId}` };
  },
  openApiQuery: async ({ workItemId, query }) => {
    calls.push({ tool: 'query_parsed_package', workItemId, query });
    return {
      workItemId,
      query,
      resultCount: 1,
      results: [{ unitId: `UNIT:${workItemId}` }],
    };
  },
  openApiDeepLink: async (workItemId) => {
    calls.push({ tool: 'get_deep_link', workItemId });
    return {
      workItemId,
      deepLink: `https://host.example.test/work-items/${workItemId}/documents`,
    };
  },
});

const httpServer = createServer(async (request, response) => {
  methods.push(request.method);
  if (request.method !== 'POST' || request.url !== '/openapi/wiselink/mcp') {
    response.writeHead(405, { Allow: 'POST' });
    response.end();
    return;
  }
  try {
    await mcp.handle(request, response, await readJsonBody(request));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
      }),
    );
  }
});

await new Promise((resolveListen) =>
  httpServer.listen(0, '127.0.0.1', resolveListen),
);
const address = httpServer.address();
assert.ok(address && typeof address !== 'string');
const endpoint = new URL(
  `/openapi/wiselink/mcp`,
  `http://127.0.0.1:${address.port}`,
);

try {
  const client = await connectedClient(endpoint, 'mcp-readonly-client');
  try {
    assert.equal(client.getNegotiatedProtocolVersion(), '2025-11-25');
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map(({ name }) => name),
      ['get_parse_status', 'query_parsed_package', 'get_deep_link'],
    );
    assert.ok(
      listed.tools.every(
        ({ annotations }) =>
          annotations?.readOnlyHint === true &&
          annotations.destructiveHint === false &&
          annotations.idempotentHint === true &&
          annotations.openWorldHint === false,
      ),
    );
    assert.deepEqual(client.getServerCapabilities(), {
      tools: { listChanged: true },
    });

    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'get_parse_status',
          arguments: { workItemId: 'WI-STATUS' },
        }),
      ),
      { workItemId: 'WI-STATUS', status: 'STATUS:WI-STATUS' },
    );
    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'query_parsed_package',
          arguments: { workItemId: 'WI-QUERY', query: 'software' },
        }),
      ),
      {
        workItemId: 'WI-QUERY',
        query: 'software',
        resultCount: 1,
        results: [{ unitId: 'UNIT:WI-QUERY' }],
      },
    );
    assert.deepEqual(
      resultJson(
        await client.callTool({
          name: 'get_deep_link',
          arguments: { workItemId: 'WI-LINK' },
        }),
      ),
      {
        workItemId: 'WI-LINK',
        deepLink: 'https://host.example.test/work-items/WI-LINK/documents',
      },
    );
    assert.deepEqual(calls, [
      { tool: 'get_parse_status', workItemId: 'WI-STATUS' },
      {
        tool: 'query_parsed_package',
        workItemId: 'WI-QUERY',
        query: 'software',
      },
      { tool: 'get_deep_link', workItemId: 'WI-LINK' },
    ]);
  } finally {
    await client.close();
  }

  calls.length = 0;
  const negativeClient = await connectedClient(endpoint, 'mcp-negative-client');
  try {
    await negativeClient.listTools();
    await assert.rejects(
      negativeClient.callTool({ name: 'start_parse', arguments: {} }),
    );
    const extraInputResult = await negativeClient.callTool({
      name: 'get_parse_status',
      arguments: {
        workItemId: 'WI-NEGATIVE',
        url: 'https://untrusted.example.test',
        headers: { Authorization: 'untrusted' },
        actor: 'untrusted',
        authority: true,
      },
    });
    assert.equal(extraInputResult.isError, true);
    assert.deepEqual(calls, []);
  } finally {
    await negativeClient.close();
  }

  calls.length = 0;
  const modernClient = await connectedClient(
    endpoint,
    'mcp-modern-client',
    'modern',
  );
  try {
    assert.equal(modernClient.getNegotiatedProtocolVersion(), '2026-07-28');
    assert.deepEqual(
      resultJson(
        await modernClient.callTool({
          name: 'get_deep_link',
          arguments: { workItemId: 'WI-MODERN' },
        }),
      ),
      {
        workItemId: 'WI-MODERN',
        deepLink: 'https://host.example.test/work-items/WI-MODERN/documents',
      },
    );
    assert.deepEqual(calls, [
      { tool: 'get_deep_link', workItemId: 'WI-MODERN' },
    ]);
  } finally {
    await modernClient.close();
  }

  calls.length = 0;
  const [slowClient, fastClient] = await Promise.all([
    connectedClient(endpoint, 'mcp-concurrent-slow'),
    connectedClient(endpoint, 'mcp-concurrent-fast'),
  ]);
  try {
    const [slowResult, fastResult] = await Promise.all([
      slowClient.callTool({
        name: 'get_parse_status',
        arguments: { workItemId: 'WI-SLOW' },
      }),
      fastClient.callTool({
        name: 'get_parse_status',
        arguments: { workItemId: 'WI-FAST' },
      }),
    ]);
    assert.deepEqual(resultJson(slowResult), {
      workItemId: 'WI-SLOW',
      status: 'STATUS:WI-SLOW',
    });
    assert.deepEqual(resultJson(fastResult), {
      workItemId: 'WI-FAST',
      status: 'STATUS:WI-FAST',
    });
    assert.deepEqual(
      calls.toSorted((left, right) =>
        left.workItemId.localeCompare(right.workItemId),
      ),
      [
        { tool: 'get_parse_status', workItemId: 'WI-FAST' },
        { tool: 'get_parse_status', workItemId: 'WI-SLOW' },
      ],
    );
  } finally {
    await Promise.all([slowClient.close(), fastClient.close()]);
  }

  assert.ok(methods.length > 0);
  assert.ok(methods.includes('POST'));
  assert.ok(
    methods
      .filter((method) => method !== 'POST')
      .every((method) => method === 'GET' || method === 'DELETE'),
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: 'PASSED',
        transport: 'STATELESS_STREAMABLE_HTTP_JSON_POST_ONLY',
        protocolVersions: ['2026-07-28', '2025-11-25'],
        tools: ['get_parse_status', 'query_parsed_package', 'get_deep_link'],
        resources: 0,
        prompts: 0,
        mutationTools: 0,
        servedMethods: ['POST'],
        rejectedClientTransportMethods: [
          ...new Set(methods.filter((method) => method !== 'POST')),
        ],
        concurrentClientsIsolated: true,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await new Promise((resolveClose, rejectClose) =>
    httpServer.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
}

async function connectedClient(endpoint, name, era = 'legacy') {
  const client = new Client(
    { name, version: '1.0.0' },
    era === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  return client;
}

function resultJson(result) {
  const content = result.content.find((item) => item.type === 'text');
  assert.ok(content && content.type === 'text');
  return JSON.parse(content.text);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function delay(milliseconds) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
