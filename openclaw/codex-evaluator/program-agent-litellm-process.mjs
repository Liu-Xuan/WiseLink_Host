// Candidate adapter process and lazy existing-route configuration. No provider
// registration, route discovery, HTTP service or Responses/SSE conversion here.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { canonicalJson, canonicalSha256 } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const adapterPath = fileURLToPath(new URL('./program_agent_litellm_adapter.py', import.meta.url));
const fail = code => { throw new Error(code); };
const STOP_CODES = new Set(['PROGRAM_AGENT_USER_CANCELLED', 'PROGRAM_AGENT_HEARTBEAT_FAILED',
  'PROGRAM_AGENT_DEADLINE_EXPIRED', 'PROGRAM_AGENT_TOOL_UNKNOWN', 'PROGRAM_AGENT_DISPATCH_UNKNOWN',
  'PROGRAM_AGENT_CLI_EXITED', 'PROGRAM_AGENT_SESSION_CLOSED', 'PROGRAM_AGENT_CLI_OUTPUT_LIMIT']);
const MIAODA_BASE = 'https://innerapi.aiforce.cloud/innerapi/api/v1/sgw/model/proxy';
const SECRET_RESOLVER = '/home/gem/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/runtime-secret-resolution.js';

/** Reuse the selected Codex config and installed official file-SecretRef
 * resolver. No route registration, credential copying, or catalogue budget. */
export async function resolveProgramAgentAdapterConfig(codexOptions, { env = process.env, resolveSecretRefValues } = {}) {
  if (!isAbsolute(codexOptions?.configPath ?? '')) fail('PROGRAM_AGENT_ADAPTER_CONFIGURATION_REQUIRED');
  let config;
  try { config = JSON.parse(await readFile(codexOptions.configPath, 'utf8')); }
  catch { fail('PROGRAM_AGENT_ADAPTER_CONFIGURATION_UNREADABLE'); }
  const provider = config?.models?.providers?.miaoda;
  const apiBase = provider?.baseUrl ?? provider?.baseURL;
  if (typeof apiBase !== 'string' || apiBase.replace(/\/+$/u, '') !== MIAODA_BASE ||
      !Array.isArray(provider.models) || provider.models.filter(model => model?.id === 'glm-5.3').length !== 1 ||
      !provider.headers || Object.keys(provider.headers).length !== 1 ||
      !Object.hasOwn(provider.headers, 'x-api-key')) fail('PROGRAM_AGENT_ADAPTER_PROVIDER_INVALID');
  let pythonBinary = codexOptions.pythonBinary;
  if (pythonBinary === undefined) {
    // Preserve the existing runner's python3/PATH choice, resolving it before
    // the child's deliberately minimal environment is installed.
    for (const directory of (env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
      const candidate = resolve(directory, 'python3');
      try { await access(candidate, constants.X_OK); pythonBinary = candidate; break; } catch {}
    }
  }
  if (!isAbsolute(pythonBinary ?? '')) fail('PROGRAM_AGENT_ADAPTER_PYTHON_REQUIRED');
  let resolver = resolveSecretRefValues;
  if (resolver === undefined) {
    try { resolver = (await import(SECRET_RESOLVER)).resolveSecretRefValues; }
    catch { fail('PROGRAM_AGENT_OFFICIAL_SECRET_RESOLVER_UNAVAILABLE'); }
  }
  if (typeof resolver !== 'function') fail('PROGRAM_AGENT_OFFICIAL_SECRET_RESOLVER_UNAVAILABLE');
  const secret = async ref => {
    if (!ref || ref.source !== 'file' || typeof ref.provider !== 'string' || !ref.provider ||
        typeof ref.id !== 'string' || !ref.id || config?.secrets?.providers?.[ref.provider]?.source !== 'file')
      fail('PROGRAM_AGENT_FILE_SECRET_REF_REQUIRED');
    let values;
    try { values = await resolver([ref], { config, env }); }
    catch { fail('PROGRAM_AGENT_SECRET_RESOLUTION_FAILED'); }
    if (!(values instanceof Map) || values.size !== 1) fail('PROGRAM_AGENT_SECRET_RESOLUTION_FAILED');
    const [value] = values.values();
    if (typeof value !== 'string' || !value || /[\r\n]/u.test(value)) fail('PROGRAM_AGENT_SECRET_RESOLUTION_FAILED');
    return value;
  };
  return { pythonBinary, apiBase: MIAODA_BASE, apiKey: await secret(provider.apiKey),
    headers: { 'x-api-key': await secret(provider.headers['x-api-key']) } };
}

export function createConfiguredProgramAgentLiteLLMDispatch(codexOptions) {
  let dispatch;
  return async request => {
    // Complete local receipt recovery never enters this closure or resolves a
    // secret. A fresh send retains the original config route for this session.
    dispatch ??= resolveProgramAgentAdapterConfig(codexOptions).then(createProgramAgentLiteLLMDispatch);
    return (await dispatch)(request);
  };
}

export function createProgramAgentLiteLLMDispatch({ pythonBinary, apiBase, apiKey, headers = {} }) {
  if (!isAbsolute(pythonBinary ?? '') || typeof apiKey !== 'string' || !apiKey ||
      typeof apiBase !== 'string' || !/^https?:\/\//u.test(apiBase) ||
      !headers || typeof headers !== 'object' || Array.isArray(headers) ||
      Object.entries(headers).some(([key, value]) => key !== 'x-api-key' ||
        typeof value !== 'string' || !value || /[\r\n]/u.test(value)))
    fail('PROGRAM_AGENT_ADAPTER_CONFIGURATION_REQUIRED');
  return async request => {
    const { runDirectory, ordinal, nativeAdmission, generationDeadlineAt, signal } = request;
    if (!isAbsolute(runDirectory ?? '') || !Number.isSafeInteger(ordinal) || ordinal < 1 ||
        !(signal instanceof AbortSignal) || !Number.isFinite(Date.parse(generationDeadlineAt)) ||
        nativeAdmission?.generationDeadlineAt !== generationDeadlineAt || nativeAdmission.ordinal !== ordinal ||
        nativeAdmission.requestId !== request.requestId || !Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)
      fail('PROGRAM_AGENT_ADAPTER_INVOCATION_INVALID');
    const remainingMs = Math.min(request.timeoutMs, Date.parse(generationDeadlineAt) - Date.now());
    if (signal.aborted || remainingMs <= 0) fail('PROGRAM_AGENT_ADAPTER_STOPPED_BEFORE_SPAWN');
    const ledger = await createCheckpointStore(resolve(runDirectory, 'ledger'));
    if (canonicalJson(await ledger.readOptional(`dispatch-${ordinal}.started`)) !== canonicalJson(nativeAdmission))
      fail('PROGRAM_AGENT_ADAPTER_RESERVATION_MISMATCH');
    const directory = resolve(runDirectory, `dispatch-${ordinal}.adapter`);
    // One invocation for the already-reserved ordinal. An existing record is
    // never cleared or re-used to spawn a replacement Python process.
    await ledger.writeOnce(`dispatch-${ordinal}.adapter-invocation`, {
      version: 1, requestId: request.requestId, ordinal, generationDeadlineAt,
      nativeAdmissionSha256: canonicalSha256(nativeAdmission), timeoutMsAtEntry: remainingMs, directory });
    if (signal.aborted || Date.now() >= Date.parse(generationDeadlineAt))
      fail('PROGRAM_AGENT_ADAPTER_STOPPED_BEFORE_SPAWN');

    let child, closed = false, stopCode = null, killTimer, deadlineTimer, killedAfterGrace = false;
    const stdoutHash = createHash('sha256'), stderrHash = createHash('sha256');
    let stdoutBytes = 0, stderrBytes = 0;
    const stop = code => {
      stopCode ??= code;
      if (!child || closed) return;
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      // Local process cleanup bound, not an upstream timeout/retry setting.
      killTimer ??= setTimeout(() => {
        if (!closed) {
          killedAfterGrace = true;
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        }
      }, 5000);
      killTimer.unref();
    };
    const onAbort = () => stop(STOP_CODES.has(signal.reason?.message)
      ? signal.reason.message : 'PROGRAM_AGENT_USER_CANCELLED');
    let exit = { code: null, signal: null }, spawnFailed = false;
    try {
      child = spawn(pythonBinary, ['-B', adapterPath, '--dispatch-stdio'], {
        cwd: runDirectory, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1',
          LITELLM_LOCAL_MODEL_COST_MAP: 'True', DO_NOT_TRACK: '1', LITELLM_TELEMETRY: 'False',
          LITELLM_DISABLE_TELEMETRY: 'True', OTEL_SDK_DISABLED: 'true' },
      });
      const completion = new Promise((accept, reject) => {
        child.once('error', () => { spawnFailed = true; reject(new Error('PROGRAM_AGENT_ADAPTER_SPAWN_FAILED')); });
        child.once('close', (code, exitSignal) => { closed = true; accept({ code, signal: exitSignal }); });
      });
      child.stdout.on('data', part => {
        stdoutBytes += part.length; stdoutHash.update(part);
        if (stdoutBytes > 2_000_000) stop('PROGRAM_AGENT_ADAPTER_OUTPUT_LIMIT');
      });
      child.stderr.on('data', part => {
        stderrBytes += part.length; stderrHash.update(part);
        if (stderrBytes > 2_000_000) stop('PROGRAM_AGENT_ADAPTER_OUTPUT_LIMIT');
      });
      child.stdin.on('error', () => {});
      signal.addEventListener('abort', onAbort, { once: true });
      deadlineTimer = setTimeout(() => stop('PROGRAM_AGENT_DEADLINE_EXPIRED'),
        Math.max(1, Date.parse(generationDeadlineAt) - Date.now()));
      if (signal.aborted) onAbort();
      child.stdin.end(JSON.stringify({ clientRequestBytes: request.clientRequestBytes.toString('base64'),
        effectiveRequestBytes: request.effectiveRequestBytes.toString('base64'),
        executionModel: request.executionModel, maxOutputTokens: request.maxOutputTokens,
        nativeAdmission, directory, generationDeadlineAt,
        timeoutSeconds: Math.min(remainingMs, Date.parse(generationDeadlineAt) - Date.now()) / 1000,
        apiBase, apiKey, headers }));
      exit = await completion;
    } finally {
      clearTimeout(deadlineTimer); clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
      await ledger.writeOnce(`dispatch-${ordinal}.adapter-process-result`, {
        version: 1, requestId: request.requestId, ordinal, generationDeadlineAt,
        nativeAdmissionSha256: canonicalSha256(nativeAdmission), pid: child?.pid ?? null,
        exitCode: exit.code, exitSignal: exit.signal, spawnFailed, closed, stopCode, killedAfterGrace,
        stdoutBytes, stderrBytes, stdoutSha256: stdoutHash.digest('hex'), stderrSha256: stderrHash.digest('hex'),
        outcome: stopCode || spawnFailed || exit.code !== 0 ? 'UNKNOWN' : 'RECEIPT_AVAILABLE' });
    }
    if (stopCode || signal.aborted || exit.code !== 0) fail('PROGRAM_AGENT_ADAPTER_OUTCOME_UNKNOWN');
    const [responseBytes, upstreamRequestBytes, upstreamResponseBytes, rawReceipt] = await Promise.all([
      readFile(resolve(directory, 'response.sse')), readFile(resolve(directory, 'upstream-request.body')),
      readFile(resolve(directory, 'upstream-response.body')), readFile(resolve(directory, 'receipt.json'), 'utf8'),
    ]);
    // The existing gateway performs the request/response hash, model, cap and
    // terminal checks. Never synthesize a completed receipt from process exit.
    return { responseBytes, upstreamRequestBytes, upstreamResponseBytes, receipt: JSON.parse(rawReceipt) };
  };
}
