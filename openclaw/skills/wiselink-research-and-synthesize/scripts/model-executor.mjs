import { createCodexGateway } from '../../../codex-evaluator/codex-generation.mjs';
import { isAbsolute } from 'node:path';
import { requestHostedGateway } from './request-hosted-gateway.mjs';

/** Codex is an explicit, local execution choice. An absent choice preserves
 * the installed Hosted profile. The Host's selected model remains the GLM 5.3
 * route; it is never silently replaced by a client-side model preference. */
export function modelExecutor(options = {}) {
  const selected = options.modelExecutor ?? 'HOSTED';
  if (!['HOSTED', 'CODEX'].includes(selected)) throw new Error('MODEL_EXECUTOR_UNSUPPORTED');
  return selected;
}

export function assertModelExecutorReady(options = {}) {
  if (modelExecutor(options) !== 'CODEX') return;
  if (options.executionModel !== undefined &&
      options.executionModel?.modelRef !== 'miaoda/glm-5.3')
    throw new Error('CODEX_EXECUTION_MODEL_ROUTE_UNSUPPORTED');
  const settings = options.codexOptions;
  if (!settings || typeof settings !== 'object' ||
      !['codexBinary', 'configPath', 'runRoot'].every(key =>
        typeof settings[key] === 'string' && settings[key].trim() && isAbsolute(settings[key])))
    throw new Error('CODEX_RUNTIME_CONFIG_REQUIRED');
}

export function modelGatewayEndpoint(options) {
  if (modelExecutor(options) === 'CODEX') return null;
  return new URL('/v1/chat/completions', options.gatewayUrl);
}

export function modelGatewayHeaders(options) {
  if (modelExecutor(options) === 'CODEX') return {};
  return { authorization: `Bearer ${options.gatewayToken}` };
}

export async function requestModelGateway(options, endpoint, init, dependencies = {}) {
  if (typeof dependencies.requestGateway === 'function')
    return dependencies.requestGateway(endpoint, init);
  if (modelExecutor(options) === 'CODEX') {
    assertModelExecutorReady(options);
    return createCodexGateway(options.codexOptions)(endpoint, init);
  }
  return requestHostedGateway(endpoint, init);
}

export function modelExecutorProvenance(options) {
  return modelExecutor(options) === 'CODEX' ? { 'model-executor': 'CODEX' } : {};
}
