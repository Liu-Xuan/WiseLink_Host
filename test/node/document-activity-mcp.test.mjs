import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import test from 'node:test';
import { validateHostToolMetadata } from '../../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';

process.env.TS_NODE_PROJECT = 'tsconfig.node.json';
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'node' });
const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const { CanonicalHostOpenClawMcpService } = require('../../server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts');

test('actual MCP transport keeps the installed tool catalog and dispatches explicit activity actions', async () => {
  const calls = [];
  const documentWork = { run: async input => { calls.push(['document', input]); return { status: 'PUBLISHED' }; } };
  const activity = { run: async input => { calls.push(['activity', input]); return { status: 'QUEUED', runRef: input.runRef }; } };
  const service = new CanonicalHostOpenClawMcpService({}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, documentWork, {}, {}, activity, { run: async () => ({ reading: null }) });
  const server = createServer((request, response) => { void service.handle(request, response); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let id = 0;
  const rpc = async (method, params) => {
    const requestId = ++id;
    const response = await fetch(`http://127.0.0.1:${address.port}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) });
    assert.equal(response.status, 200);
    const body = await response.text();
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const messages = body.split(/\r?\n\r?\n/u).map(event => event.split(/\r?\n/u)
        .filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean).map(data => JSON.parse(data));
      const result = messages.find(message => message.id === requestId);
      assert.ok(result, 'the SSE stream must contain this exact JSON-RPC response');
      return result;
    }
    return JSON.parse(body);
  };
  try {
    const initialized = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'isolated-activity-test', version: '1' } });
    assert.ok(initialized.result);
    const listed = await rpc('tools/list', {});
    validateHostToolMetadata(listed.result);
    const activityStatus = await rpc('tools/call', { name: 'document_work', arguments: { action: 'ACTIVITY_STATUS', documentVersionId: 'DV-test', runRef: 'DAR-test' } });
    assert.equal(activityStatus.result.isError, undefined);
    assert.deepEqual(calls[0], ['activity', { action: 'ACTIVITY_STATUS', documentVersionId: 'DV-test', runRef: 'DAR-test' }]);
    await rpc('tools/call', { name: 'document_work', arguments: { action: 'INDEX', documentVersionId: 'DV-test', parseRunId: 'PR-test' } });
    assert.deepEqual(calls[1], ['document', { action: 'INDEX', documentVersionId: 'DV-test', parseRunId: 'PR-test' }]);
    const invalid = await rpc('tools/call', { name: 'document_work', arguments: { action: 'ACTIVITY_SAVE', documentVersionId: 'DV-test', runRef: 'DAR-test', candidate: {} } });
    assert.ok(invalid.error || invalid.result?.isError);
    assert.equal(calls.length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
  }
});
