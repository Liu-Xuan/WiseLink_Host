import { createCodexGateway } from '../../../codex-evaluator/codex-generation.mjs';
import { dirname, isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
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

/** Add the runner location to the existing parent checkpoint before spawn.
 * The original started/result files, argsHash and receipt index remain owners
 * of recovery. This link contains no prompt/body or transport credentials.
 */
export function codexParentRunRecorder(checkpoint, step, { requestId, argsHash }) {
  if (typeof checkpoint?.readOptional!=='function' ||
      typeof checkpoint?.writeOnce!=='function' ||
      typeof step!=='string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u.test(step) ||
      typeof requestId!=='string' || !requestId ||
      typeof argsHash!=='string' || !/^[0-9a-f]{64}$/u.test(argsHash))
    throw new Error('CODEX_PARENT_RUN_BINDING_INVALID');
  return async prepared => {
    if (prepared?.requestId!==requestId || !isAbsolute(prepared.runRoot??'') ||
        !isAbsolute(prepared.runDirectory??'') || dirname(prepared.runDirectory)!==prepared.runRoot ||
        ![prepared.bindingSha256,prepared.promptSha256].every(value=>
          typeof value==='string' && /^[0-9a-f]{64}$/u.test(value)))
      throw new Error('CODEX_PARENT_RUN_BINDING_INVALID');
    const value={version:1,requestId,argsHash,runRoot:prepared.runRoot,
      runDirectory:prepared.runDirectory,gatewayBindingSha256:prepared.bindingSha256,
      promptSha256:prepared.promptSha256};
    const key=`${step}.codex-run`;
    if (typeof checkpoint.writeOnceOrEqual==='function') {
      await checkpoint.writeOnceOrEqual(key,value);return;
    }
    const previous=await checkpoint.readOptional(key);
    if (previous!==null && previous!==undefined) {
      if (!isDeepStrictEqual(previous,value)) throw new Error('CODEX_PARENT_RUN_BINDING_MISMATCH');
      return;
    }
    await checkpoint.writeOnce(key,value);
  };
}
