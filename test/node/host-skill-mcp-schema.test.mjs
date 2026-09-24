import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(resolve(repoRoot, 'package.json'));
const { McpServer, InMemoryTransport } = require('@modelcontextprotocol/server');
const { Client } = require('@modelcontextprotocol/client');
const { z } = require('zod');
const skillScripts = resolve(repoRoot, 'openclaw/skills/wiselink-research-and-synthesize/scripts');
const { validateHostToolMetadata } = await import(pathToFileURL(resolve(skillScripts, 'run-hosted-review-turn.mjs')).href);
const { HOST_MCP_TOOLS } = await import(pathToFileURL(resolve(skillScripts, 'orchestrate-host-mcp.mjs')).href);

test('published Host commit schema survives the real MCP tools/list and Skill validator', async () => {
  const hostSource = await readFile(
    resolve(repoRoot, 'server/modules/canonical-host/canonical-host-openclaw-mcp.service.ts'),
    'utf8',
  );
  const readonlySource = await readFile(
    resolve(repoRoot, 'server/modules/canonical-host/canonical-host-readonly-mcp-tools.ts'),
    'utf8',
  );
  const workItemDefinition = readonlySource.match(/export const mcpWorkItemId = ([^;]+);/u)?.[1];
  const start = hostSource.indexOf('const attemptRef =');
  const end = hostSource.indexOf('const resultContentHash =');
  assert.ok(workItemDefinition && start >= 0 && end > start);
  // Compile only the production Zod declaration block. The rest of the Host
  // service needs Nest injection and does not affect the registered schema.
  const reviewCommitInput = new Function(
    'z',
    `const mcpWorkItemId = ${workItemDefinition};\n${hostSource.slice(start, end)}\nreturn reviewCommitInput;`,
  )(z);
  assert.match(
    hostSource,
    /inputSchema: reviewCommitInput,[\s\S]*?async \(input\) =>/u,
  );

  const server = new McpServer({
    name: 'wiselink-openclaw-engineering-assessment',
    version: '1.2.0',
  });
  let businessCalls = 0;
  for (const name of [...HOST_MCP_TOOLS, 'get_pending_review_turn']) {
    server.registerTool(name, {
      inputSchema: name === 'commit_review_turn_candidate'
        ? reviewCommitInput
        : name === 'read_matter_current_work'
          ? z.object({ matterId: z.string() }).strict()
          : z.object({}).strict(),
      ...(name === 'read_matter_current_work' ? {
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      } : {}),
    }, async () => {
      businessCalls += 1;
      throw new Error('BUSINESS_TOOL_MUST_NOT_RUN');
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'host-skill-contract-test', version: '1.0.0' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listing = await client.listTools();
    const schema = listing.tools.find(({ name }) => name === 'commit_review_turn_candidate')?.inputSchema;
    assert.deepEqual(schema?.properties?.workItemId, {
      type: 'string', minLength: 1, maxLength: 200,
    });
    assert.equal(schema?.additionalProperties, false);
    assert.equal(schema?.required.includes('workItemId'), false);
    assert.doesNotThrow(() => validateHostToolMetadata(listing));
    const legacy = structuredClone(listing);
    delete legacy.tools.find(({ name }) => name === 'commit_review_turn_candidate').inputSchema.properties.workItemId;
    assert.doesNotThrow(() => validateHostToolMetadata(legacy));
    assert.equal(businessCalls, 0);
  } finally {
    await client.close();
    await server.close();
  }
});
