#!/usr/bin/env node
/** Configuration inventory only. This does not authenticate or grant Host access. */
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredTools = ['begin_dynamic_evaluation', 'read_assessment_sources',
  'save_assessment_work', 'read_assessment_work', 'commit_dynamic_evaluation_candidate',
  'begin_overall_synthesis', 'commit_overall_candidate', 'heartbeat_action_attempt',
  'get_parse_status', 'get_deep_link'];

export async function inspectConfiguration(configPath, codexBinary) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const provider = config.models?.providers?.miaoda;
  const host = config.mcp?.servers?.wiselink_host_controller;
  const allowed = host?.toolFilter?.include;
  const missingTools = Array.isArray(allowed) ? requiredTools.filter(tool => !allowed.includes(tool)) : [];
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
    hostMcpConfigured: Boolean(host && host.enabled !== false), missingHostTools: missingTools,
    hostAuthenticationVerified: false, hostRuntimeRegistrationVerified: false,
    readyForModelFixture: Boolean(modelRouteConfigured && platformSecretRefsConfigured && binaryAvailable),
    readyForBusinessExecution: false,
    remaining: [
      ...(!host || host.enabled === false ? ['HOST_MCP_NOT_CONFIGURED'] : []),
      ...(missingTools.length ? ['HOST_TOOL_BINDING_INCOMPLETE'] : []),
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
