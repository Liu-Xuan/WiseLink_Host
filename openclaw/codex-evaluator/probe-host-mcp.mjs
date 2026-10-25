#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHostMcpConnection } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';

/** Metadata-only compatibility probe. This deliberately does not construct a
 * queue client or expose callTool to the caller. The legacy MCP identity is
 * checked as legacy, never relabelled as an independent Codex identity. */
export async function probeHostMetadata(config, connect = createHostMcpConnection) {
  const endpoint = new URL(config.url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash ||
      !endpoint.pathname.endsWith('/openapi/wiselink/openclaw-mcp') ||
      !config.headers || typeof config.headers !== 'object' || Array.isArray(config.headers))
    throw new Error('HOST_METADATA_PROBE_CONFIG_INVALID');
  const connection = await connect({ hostMcpUrl: endpoint.href, headers: config.headers,
    modelExecutor: 'HOSTED' });
  try {
    return { status: 'TRANSPORT_AND_TOOL_METADATA_VERIFIED',
      endpointOrigin: endpoint.origin, endpointPath: endpoint.pathname,
      targetRuntime: 'LEGACY_HOST_MCP', businessToolsCalled: false,
      queueAccessed: false, runtimeIdentityIndependentlyBound: false };
  } finally { await connection.close(); }
}

async function main() {
  const index = process.argv.indexOf('--connection-file');
  if (index < 0 || !process.argv[index + 1])
    throw new Error('HOST_METADATA_PROBE_CONNECTION_FILE_REQUIRED');
  const file = resolve(process.argv[index + 1]);
  const info = await stat(file);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 16_384)
    throw new Error('HOST_METADATA_PROBE_PRIVATE_FILE_REQUIRED');
  const config = JSON.parse(await readFile(file, 'utf8'));
  process.stdout.write(`${JSON.stringify(await probeHostMetadata(config), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // A server message can contain business data. Emit only a known code.
    const message = String(error?.message ?? '');
    const code = /^(?:HOST_METADATA_PROBE|REVIEW_HOST_MCP|REVIEW_MCP)_[A-Z0-9_]+$/u.test(message)
      ? message : 'HOST_METADATA_PROBE_FAILED';
    process.stderr.write(`${JSON.stringify({ status: code, businessToolsCalled: false,
      queueAccessed: false, runtimeIdentityIndependentlyBound: false })}\n`);
    process.exitCode = 1;
  });
}
