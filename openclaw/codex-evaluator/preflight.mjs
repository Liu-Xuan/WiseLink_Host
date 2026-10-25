#!/usr/bin/env node
/** Configuration inventory only. This does not authenticate or grant Host access. */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findMcpConfig } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { HOST_MCP_TOOLS } from '../skills/wiselink-research-and-synthesize/scripts/orchestrate-host-mcp.mjs';
import { WISELINK_HOST_MCP_VERSION, requireCodexRuntimeAppId } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const expectedServerName = 'wiselink-codex-engineering-assessment';
const expectedEndpointPath = '/openapi/wiselink/codex-mcp';
// The connection validates the full established list. Program-controlled
// assessment also needs the optional progress capability when dispatched.
const requiredTools = [...HOST_MCP_TOOLS, 'record_assessment_program_progress'];

function validCodexEndpoint(value) {
  try {
    const endpoint = new URL(value);
    return endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password &&
      !endpoint.search && !endpoint.hash && endpoint.pathname.endsWith(expectedEndpointPath);
  } catch { return false; }
}

export async function inspectConfiguration(configPath, codexBinary, env = process.env) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const provider = config.models?.providers?.miaoda;
  const legacyHost = findMcpConfig(config, 'HOSTED');
  const codexHost = findMcpConfig(config, 'CODEX');
  const codexHostMcpConfigPresent = Boolean(codexHost);
  const codexHostMcpConfigured = codexHostMcpConfigPresent && codexHost.enabled !== false;
  const codexHostMcpEndpointValid = codexHostMcpConfigured && validCodexEndpoint(codexHost.url);
  let codexRuntimeAppIdConfigured = false;
  try { requireCodexRuntimeAppId(env.WL_CODEX_RUNTIME_APP_ID); codexRuntimeAppIdConfigured = true; }
  catch { /* Report missing/invalid configuration without exposing its value. */ }
  const allowed = codexHost?.toolFilter?.include;
  const hostToolFilterPresent = Array.isArray(allowed);
  const missingTools = hostToolFilterPresent ? requiredTools.filter(tool => !allowed.includes(tool)) : null;
  let binaryAvailable = false;
  if (codexBinary) {
    try { await access(codexBinary, constants.X_OK); binaryAvailable = true; } catch {}
  }
  const modelRouteConfigured = (provider?.baseUrl ?? provider?.baseURL)?.replace(/\/$/, '') ===
    'https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy' && provider.api === 'openai-completions';
  const platformSecretRefsConfigured = provider?.apiKey?.source === 'file' &&
    provider?.headers?.['x-api-key']?.source === 'file';
  return {
    model: 'miaoda/glm-5.3', modelRouteConfigured, codexBinaryAvailable: binaryAvailable,
    platformSecretRefsConfigured,
    legacyHostMcpConfigPresent: Boolean(legacyHost),
    codexHostMcpConfigPresent, codexHostMcpConfigured,
    hostMcpConfigured: codexHostMcpConfigured,
    codexHostMcpEndpointValid, expectedHostMcpPath: expectedEndpointPath,
    codexRuntimeAppIdConfigured,
    expectedHostMcpServerName: expectedServerName, expectedHostMcpServerVersion: WISELINK_HOST_MCP_VERSION,
    requiredHostToolScope: 'CLIENT_EXACT_METADATA_PLUS_PROGRAM_PROGRESS',
    requiredHostToolCount: requiredTools.length, hostToolFilterPresent,
    missingHostTools: missingTools,
    hostAuthenticationVerified: false, hostRuntimeRegistrationVerified: false,
    readyForModelFixture: Boolean(modelRouteConfigured && platformSecretRefsConfigured && binaryAvailable),
    readyForBusinessExecution: false,
    remaining: [
      ...(!codexHostMcpConfigured ? ['CODEX_HOST_MCP_NOT_CONFIGURED'] : []),
      ...(codexHostMcpConfigured && !codexHostMcpEndpointValid ? ['CODEX_HOST_MCP_ENDPOINT_INVALID'] : []),
      ...(!codexRuntimeAppIdConfigured ? ['CODEX_RUNTIME_APP_ID_CONFIG_INVALID'] : []),
      ...(missingTools?.length ? ['HOST_TOOL_BINDING_INCOMPLETE'] : []),
      ...(!hostToolFilterPresent ? ['VERIFY_CODEX_HOST_TOOL_DISCOVERY'] : []),
      'VERIFY_HOST_AUTHENTICATION_AND_CURRENT_RUNTIME_REGISTRATION',
      'SELECT_AUTHORIZED_BUSINESS_TASK_AND_VERIFY_EXACT_VERSION_READERS',
    ],
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
  inspectConfiguration(get('--config', '/home/gem/workspace/agent/openclaw.json'), get('--codex', undefined))
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(() => { console.error('CONFIGURATION_UNAVAILABLE'); process.exitCode = 1; });
}
