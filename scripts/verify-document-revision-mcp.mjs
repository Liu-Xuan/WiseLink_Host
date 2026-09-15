import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CanonicalHostOpenClawMcpService } from '../dist/server/modules/canonical-host/canonical-host-openclaw-mcp.service.js';
import { validateHostToolMetadata } from '../openclaw/skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';

// Isolated transport test using the actual Host registration and installed consumer validator.
const calls = [];
const documentWork = {
  readOriginal: async input => { calls.push(['single', input]); return { mode: 'single', input }; },
  readRevision: async input => { calls.push(['comparison', input]); return { mode: 'comparison', input }; },
};
const service = new CanonicalHostOpenClawMcpService(...Array.from({ length: 13 }, () => ({})), documentWork, {}, {});
const http = createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    await service.handle(request, response, text ? JSON.parse(text) : undefined);
  } catch (error) {
    response.statusCode = 500;
    response.end(error instanceof Error ? error.message : 'TEST_SERVER_ERROR');
  }
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
const client = new Client({ name: 'isolated-revision-reading-test', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/openapi/wiselink/openclaw-mcp`)));
  const listed = await client.listTools();
  validateHostToolMetadata(listed);
  assert.equal(listed.tools.some(tool => tool.name === 'read_document_revision'), false);
  const single = { documentVersionId: 'DV-new', parseRunId: 'parse-new', semanticRevision: 1 };
  const read = async input => client.callTool({ name: 'read_document_original', arguments: input });
  assert.equal(JSON.parse((await read(single)).content[0].text).mode, 'single');
  const before = { documentVersionId: 'DV-old', parseRunId: 'parse-old', semanticRevision: 2 };
  assert.equal(JSON.parse((await read({ ...single, compareWith: before, roleKey: 'ftd.status' })).content[0].text).mode, 'comparison');
  assert.deepEqual(calls, [['single', single], ['comparison', { before, after: single, roleKey: 'ftd.status' }]]);
  assert.equal((await read({ ...single, compareWith: before })).isError, true);
  assert.equal((await read({ ...single, compareWith: before, roleKey: 'ftd.status', limit: 5 })).isError, true);
  assert.equal((await read({ ...single, roleKey: 'ftd.status' })).isError, true);
  assert.equal(calls.length, 2);
  console.log(JSON.stringify({ scope: 'ISOLATED_TRANSPORT', tools: listed.tools.length,
    existingConsumerMetadataCompatible: true, singleAndPairReadPassed: true, invalidSelectorsRejected: 3 }));
} finally {
  await client.close();
  await new Promise(resolve => http.close(resolve));
}
