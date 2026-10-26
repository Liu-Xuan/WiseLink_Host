// Explicit candidate adapter injection only. No provider registration, routing
// discovery, credential lookup, HTTP service or Responses/SSE conversion here.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { canonicalJson, canonicalSha256 } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';

const adapterPath = fileURLToPath(new URL('./program_agent_litellm_adapter.py', import.meta.url));
const fail = code => { throw new Error(code); };
const STOP_CODES = new Set(['PROGRAM_AGENT_USER_CANCELLED', 'PROGRAM_AGENT_HEARTBEAT_FAILED',
  'PROGRAM_AGENT_DEADLINE_EXPIRED', 'PROGRAM_AGENT_TOOL_UNKNOWN', 'PROGRAM_AGENT_DISPATCH_UNKNOWN',
  'PROGRAM_AGENT_CLI_EXITED', 'PROGRAM_AGENT_SESSION_CLOSED', 'PROGRAM_AGENT_CLI_OUTPUT_LIMIT']);

export function createProgramAgentLiteLLMDispatch({ pythonBinary, apiBase, apiKey }) {
  if (!isAbsolute(pythonBinary ?? '') || typeof apiKey !== 'string' || !apiKey ||
      typeof apiBase !== 'string' || !/^https?:\/\//u.test(apiBase))
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
        apiBase, apiKey }));
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
