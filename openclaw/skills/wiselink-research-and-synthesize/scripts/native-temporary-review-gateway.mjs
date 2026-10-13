import { createHash, randomBytes } from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const AGENT_ID = 'wiselink-engineering';
const MODEL_REF = 'miaoda/glm-5.3';
const MODEL_ID = 'glm-5.3';
const LOCK_ROOT = join(tmpdir(), 'wiselink-native-review-attempt-locks');
const SCAN_LIMIT_BYTES = 128 * 1024 * 1024;

async function scanTemporaryForSecrets(root, values) {
  const needles = [...new Set(values.filter((value) => typeof value === 'string' && value))]
    .map((value) => Buffer.from(value));
  const pending = [root];
  let scannedBytes = 0;
  let fileCount = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    const details = await lstat(current);
    if (details.isSymbolicLink()) return { complete: false, found: false };
    if (details.isDirectory()) {
      for (const item of await readdir(current)) pending.push(join(current, item));
      continue;
    }
    if (!details.isFile() || ++fileCount > 10_000 ||
      (scannedBytes += details.size) > SCAN_LIMIT_BYTES)
      return { complete: false, found: false };
    const bytes = await readFile(current);
    if (needles.some((needle) => bytes.includes(needle)))
      return { complete: true, found: true };
  }
  return { complete: true, found: false };
}

function diagnosticCategory(raw) {
  const value = String(raw ?? '').slice(-16_384);
  if (/EADDRINUSE|address already in use/iu.test(value)) return 'PORT_BUSY';
  if (/secret.?ref|secret.?provider|secret surface/iu.test(value)) return 'SECRET_REF';
  if (/invalid config|configuration invalid|schema validation/iu.test(value)) return 'CONFIG';
  if (/plugin/iu.test(value)) return 'PLUGIN';
  if (/unauthorized|forbidden|invalid token/iu.test(value)) return 'AUTH';
  return 'UNKNOWN';
}

function fixedHealthExecFailure(error, elapsedMs) {
  const rawCode = error?.code;
  const code = typeof rawCode === 'number' ? 'CLI_EXIT_NONZERO' :
    ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EACCES', 'ENOENT',
      'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'].includes(rawCode) ? rawCode :
      rawCode == null ? 'NONE' : 'OTHER';
  const signal = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']
    .includes(error?.signal) ? error.signal : error?.signal == null ? 'NONE' : 'OTHER';
  return { killed: error?.killed === true, signal, code,
    elapsedMs: Number.isSafeInteger(elapsedMs) ?
      Math.max(0, Math.min(elapsedMs, 60_000)) : null };
}

async function beforeDeadline(pending, deadlineAt, signal) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0 || signal?.aborted)
    throw new Error('NATIVE_GATEWAY_DEADLINE_EXPIRED');
  let timer;
  let onAbort;
  const cutoff = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('NATIVE_GATEWAY_DEADLINE_EXPIRED')),
      remaining);
    onAbort = () => reject(new Error('NATIVE_GATEWAY_DEADLINE_EXPIRED'));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([pending, cutoff]); }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export function assertNativeGatewayBinding(binding) {
  const summary = binding?.subject?.kind === 'DERIVED_SUMMARY';
  const matter = binding?.subject?.kind === 'ENGINEERING_MATTER';
  const subjectValid = matter ?
    typeof binding.subject.matterId === 'string' && /^MAT-[A-Za-z0-9_-]{1,92}$/u.test(binding.subject.matterId) &&
      Object.keys(binding.subject).length === 2 &&
      !['workItemId', 'summaryId', 'documentVersionId'].some(key => Object.hasOwn(binding, key)) &&
      binding.nativeSessionKey === `agent:${AGENT_ID}:matter:${binding.subject.matterId}:${binding.attemptRef}`
    : summary
    ? typeof binding.subject.summaryId === 'string' && /^DS-[A-Za-z0-9_-]{1,93}$/u.test(binding.subject.summaryId) &&
      Object.keys(binding.subject).length === 2 &&
      !['workItemId', 'matterId', 'documentVersionId'].some(key => Object.hasOwn(binding, key)) &&
      binding.nativeSessionKey === `agent:${AGENT_ID}:summary:${binding.subject.summaryId}:${binding.attemptRef}`
    : typeof binding?.workItemId === 'string' && Boolean(binding.workItemId) && binding.subject === undefined &&
      typeof binding.nativeSessionKey === 'string' && binding.nativeSessionKey.startsWith(`agent:${AGENT_ID}:review:ACTX-RS-`);
  if (!binding || typeof binding !== 'object' ||
    !/^[A-Za-z0-9._:-]{1,128}$/u.test(binding.attemptRef ?? '') ||
    !subjectValid ||
    binding.executionModel?.modelRef !== MODEL_REF ||
    !Number.isSafeInteger(binding.timeoutMs) || binding.timeoutMs <= 0 ||
    !Number.isSafeInteger(binding.maxCompletionTokens) ||
    binding.maxCompletionTokens <= 0 ||
    !Number.isSafeInteger(binding.maxModelRequests) ||
    binding.maxModelRequests <= 0 ||
    (binding.providerTimeoutSeconds !== undefined &&
      (!Number.isSafeInteger(binding.providerTimeoutSeconds) ||
        binding.providerTimeoutSeconds <= 0)) ||
    (binding.reasoningEffort !== undefined &&
      !['low', 'high', 'max'].includes(binding.reasoningEffort)) ||
    (binding.signal !== undefined && !(binding.signal instanceof AbortSignal)) ||
    typeof binding.nativeSessionKey !== 'string')
    throw new Error('NATIVE_GATEWAY_HOST_BINDING_INVALID');
  const startedAt = Date.parse(binding.startedAt);
  const taskDeadlineAt = Date.parse(binding.taskDeadlineAt);
  const deadlineAt = Date.parse(binding.deadlineAt);
  const requestedDeadlineAt = startedAt + binding.timeoutMs;
  if (![startedAt, taskDeadlineAt, deadlineAt, requestedDeadlineAt]
    .every(Number.isSafeInteger) ||
    deadlineAt !== Math.min(requestedDeadlineAt, taskDeadlineAt) ||
    deadlineAt <= Date.now()) throw new Error('NATIVE_GATEWAY_DEADLINE_INVALID');
  return deadlineAt;
}

function secretRef(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    value.source === 'file' && typeof value.provider === 'string' &&
    value.provider.length > 0 && typeof value.id === 'string' &&
    value.id.length > 0;
}

function providerProfile(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    value.api !== 'openai-completions' ||
    typeof value.baseUrl !== 'string' ||
    !value.baseUrl.startsWith('https://'))
    throw new Error('NATIVE_GATEWAY_PROVIDER_INVALID');
  const url = new URL(value.baseUrl);
  if (url.username || url.password || url.hash)
    throw new Error('NATIVE_GATEWAY_PROVIDER_INVALID');
  const supportedKeys = new Set(['baseUrl', 'api', 'apiKey', 'headers', 'models',
    'timeoutSeconds']);
  if (Object.keys(value).some((key) => !supportedKeys.has(key)))
    throw new Error('NATIVE_GATEWAY_PROVIDER_SETTINGS_UNSUPPORTED');
  if (!Number.isSafeInteger(value.timeoutSeconds) || value.timeoutSeconds <= 0)
    throw new Error('NATIVE_GATEWAY_PROVIDER_TIMEOUT_INVALID');
  if (!secretRef(value.apiKey))
    throw new Error('NATIVE_GATEWAY_CREDENTIAL_REF_REQUIRED');
  const models = value.models;
  const target = Array.isArray(models)
    ? models.filter((item) => item?.id === MODEL_ID) : [];
  if (target.length !== 1) throw new Error('NATIVE_GATEWAY_MODEL_INVALID');
  const containsCredentialField = (item) => item && typeof item === 'object' &&
    Object.entries(item).some(([key, nested]) =>
      /^(?:api.?key|token|secret|authorization|headers?|password|accessToken|refreshToken)$/iu.test(key) ||
      containsCredentialField(nested));
  if (containsCredentialField(target[0]))
    throw new Error('NATIVE_GATEWAY_MODEL_METADATA_UNSAFE');
  if (!Number.isSafeInteger(target[0].maxTokens) || target[0].maxTokens <= 0 ||
    !Number.isSafeInteger(target[0].contextWindow) ||
    target[0].contextWindow <= 0 ||
    target[0].maxTokens > target[0].contextWindow)
    throw new Error('NATIVE_GATEWAY_MODEL_BUDGET_INVALID');
  const headers = value.headers ?? {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers) ||
    Object.keys(headers).length !== 1 ||
    Object.values(headers).some((entry) => !secretRef(entry)))
    throw new Error('NATIVE_GATEWAY_PROVIDER_HEADERS_UNRESOLVED');
  return { upstreamBaseUrl: value.baseUrl,
    headerRefs: structuredClone(headers),
    apiKeyRef: structuredClone(value.apiKey), model: structuredClone(target[0]),
    timeoutSeconds: value.timeoutSeconds };
}

async function loadOfficialProvider({ sourceConfigPath }) {
  // `config get --json` redacts SecretRef metadata. Read the already-active,
  // strict-JSON source file to preserve the original reference objects. Their
  // values are still resolved only by the installed OpenClaw runtime.
  let root;
  try { root = JSON.parse(await readFile(sourceConfigPath, 'utf8')); }
  catch { throw new Error('NATIVE_GATEWAY_PROVIDER_CONFIG_UNREADABLE'); }
  return { ...providerProfile(root?.models?.providers?.miaoda), sourceConfig: root };
}

async function resolveOfficialSecret(ref, config, env, resolver) {
  let values;
  try { values = await resolver([ref], { config, env }); }
  catch { throw new Error('NATIVE_GATEWAY_SECRET_RESOLUTION_FAILED'); }
  if (!(values instanceof Map) || values.size !== 1)
    throw new Error('NATIVE_GATEWAY_SECRET_RESOLUTION_INVALID');
  const [value] = values.values();
  if (typeof value !== 'string' || !value || value.includes('\r') ||
    value.includes('\n')) throw new Error('NATIVE_GATEWAY_SECRET_RESOLUTION_INVALID');
  return value;
}

export function buildTemporaryGatewayConfig({ profile, baseUrl, nonce, port,
  workspace, deadlineAt, providerTimeoutSeconds, reasoningEffort }) {
  if (!profile || !/^http:\/\/127\.0\.0\.1:\d+$/u.test(baseUrl) ||
    !/^[a-f0-9]{64}$/u.test(nonce) ||
    !Number.isSafeInteger(port) || port < 1024 || port > 65535 ||
    !isAbsolute(workspace) || !Number.isSafeInteger(deadlineAt) ||
    deadlineAt <= Date.now() || !Number.isSafeInteger(profile.timeoutSeconds) ||
    profile.timeoutSeconds <= 0) throw new Error('NATIVE_GATEWAY_CONFIG_INPUT_INVALID');
  if (providerTimeoutSeconds !== undefined &&
    (!Number.isSafeInteger(providerTimeoutSeconds) || providerTimeoutSeconds <= 0))
    throw new Error('NATIVE_GATEWAY_PROVIDER_TIMEOUT_INVALID');
  if (reasoningEffort !== undefined &&
    !['low', 'high', 'max'].includes(reasoningEffort))
    throw new Error('NATIVE_GATEWAY_REASONING_EFFORT_INVALID');
  const remainingWholeSeconds = Math.floor((deadlineAt - Date.now()) / 1000);
  if (remainingWholeSeconds < 1) throw new Error('NATIVE_GATEWAY_DEADLINE_EXPIRED');
  const timeoutSeconds = Math.min(providerTimeoutSeconds ?? profile.timeoutSeconds,
    remainingWholeSeconds);
  return {
    gateway: { mode: 'local', bind: 'loopback', port,
      auth: { mode: 'token', token: {
        source: 'env', provider: 'default', id: 'WL_REVIEW_GATEWAY_TOKEN' } },
      http: { endpoints: { chatCompletions: { enabled: true } } } },
    plugins: { enabled: false },
    tools: { profile: 'minimal', deny: ['session_status'] },
    models: { providers: { miaoda: {
      baseUrl: `${baseUrl}/v1`, api: 'openai-completions',
      apiKey: { source: 'env', provider: 'default', id: 'WL_REVIEW_UPSTREAM_KEY' },
      headers: { 'x-wiselink-attempt-nonce': nonce },
      timeoutSeconds,
      models: [structuredClone(profile.model)],
    } } },
    agents: { defaults: { model: { primary: MODEL_REF, fallbacks: [] },
      models: { [MODEL_REF]: reasoningEffort === undefined ? {} : {
        params: { extra_body: { reasoning_effort: reasoningEffort } },
      } } },
    list: [{ id: AGENT_ID, model: { primary: MODEL_REF, fallbacks: [] },
      workspace }] },
  };
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForLoopback(port, child, deadlineAt, signal) {
  const until = Math.min(deadlineAt, Date.now() + 60_000);
  while (Date.now() < until) {
    if (signal?.aborted) throw new Error('NATIVE_GATEWAY_DEADLINE_EXPIRED');
    if (child.launchFailed || child.exitCode !== null || child.signalCode !== null)
      throw new Error(`NATIVE_GATEWAY_PROCESS_EXITED_${diagnosticCategory(child.gatewayStderr)}`);
    const connected = await new Promise((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`NATIVE_GATEWAY_START_TIMEOUT_${diagnosticCategory(child.gatewayStderr)}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  let timer;
  try { await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => { timer = setTimeout(resolve, 2_000); }),
  ]); } finally { clearTimeout(timer); }
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    let killTimer;
    try { await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => { killTimer = setTimeout(resolve, 2_000); }),
    ]); } finally { clearTimeout(killTimer); }
    if (child.exitCode === null && child.signalCode === null)
      throw new Error('NATIVE_GATEWAY_STOP_UNKNOWN');
  }
}

/** Called only after the Host begin and exact deadline have been validated. */
export function createNativeReviewGatewayPreparer({ sourceConfigPath,
  adapterModulePath = fileURLToPath(new URL('./one-shot-outbound-adapter.mjs', import.meta.url)),
  secretResolverModulePath = '/home/gem/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/runtime-secret-resolution.js',
  command = 'openclaw', env = process.env } = {}) {
  if (!isAbsolute(sourceConfigPath ?? '') || !isAbsolute(adapterModulePath) ||
    !isAbsolute(secretResolverModulePath))
    throw new Error('NATIVE_GATEWAY_SOURCE_PATH_REQUIRED');
  let invoked = false;
  return async (binding) => {
    if (invoked) throw new Error('NATIVE_GATEWAY_PREPARER_REUSED');
    invoked = true;
    const deadlineAt = assertNativeGatewayBinding(binding);
    const assertLive = () => {
      if (binding.signal?.aborted || Date.now() >= deadlineAt)
        throw new Error('NATIVE_GATEWAY_DEADLINE_EXPIRED');
    };
    const attemptHash = createHash('sha256').update(binding.attemptRef).digest('hex');
    await mkdir(LOCK_ROOT, { recursive: true, mode: 0o700 });
    const marker = join(LOCK_ROOT, attemptHash);
    await writeFile(marker, JSON.stringify({ attemptHash,
      startedAt: binding.startedAt, deadlineAt: binding.deadlineAt }),
    { flag: 'wx', mode: 0o600 });
    // The marker intentionally survives cleanup. A second checkpoint directory
    // cannot re-arm the same Host attempt after a failed or ambiguous dispatch.
    let temporary = null;
    let adapter = null;
    let child = null;
    const sensitiveValues = [];
    let tempSecretScan = null;
    let providerTimeoutReceipt = null;
    let closePromise;
    const close = () => {
      closePromise ??= (async () => {
        let failed = false;
        try { await stopChild(child); } catch { failed = true; }
        try { await adapter?.close(); } catch { failed = true; }
        try { if (temporary) tempSecretScan = await scanTemporaryForSecrets(
          temporary, sensitiveValues); }
        catch { tempSecretScan = { complete: false, found: false }; }
        try { if (temporary) await rm(temporary, { recursive: true, force: true }); }
        catch { failed = true; }
        if (tempSecretScan?.found)
          throw new Error('NATIVE_GATEWAY_SECRET_PERSISTED_TEMP');
        if (tempSecretScan && !tempSecretScan.complete)
          throw new Error('NATIVE_GATEWAY_SECRET_SCAN_INCOMPLETE');
        if (failed) throw new Error('NATIVE_GATEWAY_CLEANUP_FAILED');
      })();
      return closePromise;
    };
    try {
      assertLive();
      const profile = await beforeDeadline(loadOfficialProvider({ sourceConfigPath }),
        deadlineAt, binding.signal);
      assertLive();
      if (binding.maxCompletionTokens > profile.model.maxTokens ||
        binding.maxCompletionTokens > profile.model.contextWindow)
        throw new Error('NATIVE_GATEWAY_COMPLETION_BUDGET_EXCEEDS_PROFILE');
      const resolverModule = await import(secretResolverModulePath);
      assertLive();
      const resolver = resolverModule.resolveSecretRefValues;
      if (typeof resolver !== 'function')
        throw new Error('NATIVE_GATEWAY_OFFICIAL_RESOLVER_MISSING');
      const upstreamKey = await beforeDeadline(resolveOfficialSecret(profile.apiKeyRef,
        profile.sourceConfig, env, resolver), deadlineAt, binding.signal);
      sensitiveValues.push(upstreamKey);
      assertLive();
      const upstreamHeaders = {};
      for (const [name, ref] of Object.entries(profile.headerRefs)) {
        upstreamHeaders[name] = await beforeDeadline(resolveOfficialSecret(ref,
          profile.sourceConfig, env, resolver), deadlineAt, binding.signal);
        sensitiveValues.push(upstreamHeaders[name]);
        assertLive();
      }
      const { createOneShotOutboundAdapter } = await import(adapterModulePath);
      assertLive();
      if (typeof createOneShotOutboundAdapter !== 'function')
        throw new Error('NATIVE_GATEWAY_ADAPTER_MISSING');
      adapter = createOneShotOutboundAdapter({
        attemptRef: binding.attemptRef, modelId: MODEL_ID,
        upstreamBaseUrl: profile.upstreamBaseUrl,
        upstreamHeaders,
        maxCompletionTokens: binding.maxCompletionTokens,
        maxModelRequests: binding.maxModelRequests,
        expectedReasoningEffort: binding.reasoningEffort,
        absoluteDeadline: binding.deadlineAt,
      });
      const route = await adapter.start();
      assertLive();
      temporary = await mkdtemp(join(tmpdir(), 'wiselink-native-review-gw-'));
      await mkdir(join(temporary, 'workspace'), { mode: 0o700 });
      const port = await freePort();
      assertLive();
      const config = buildTemporaryGatewayConfig({ profile,
        baseUrl: route.baseUrl, nonce: route.nonce, port,
        workspace: join(temporary, 'workspace'), deadlineAt,
        providerTimeoutSeconds: binding.providerTimeoutSeconds,
        reasoningEffort: binding.reasoningEffort });
      providerTimeoutReceipt = {
        sourceSeconds: profile.timeoutSeconds,
        callerSeconds: binding.providerTimeoutSeconds ?? null,
        effectiveSeconds: config.models.providers.miaoda.timeoutSeconds,
      };
      const configPath = join(temporary, 'openclaw.json');
      await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
      const token = randomBytes(32).toString('hex');
      sensitiveValues.push(token);
      const childEnv = { ...env, OPENCLAW_CONFIG_PATH: configPath,
        OPENCLAW_STATE_DIR: temporary, WL_REVIEW_GATEWAY_TOKEN: token,
        OPENCLAW_GATEWAY_TOKEN: token,
        OPENCLAW_GATEWAY_PORT: String(port),
        WL_REVIEW_UPSTREAM_KEY: upstreamKey, NO_COLOR: '1' };
      delete childEnv.OPENCLAW_GATEWAY_URL;
      try { await execFile(command, ['config', 'validate'], { env: childEnv,
        maxBuffer: 1024 * 1024,
        timeout: Math.max(1, Math.min(30_000, deadlineAt - Date.now())) }); }
      catch (error) { throw new Error(`NATIVE_GATEWAY_CONFIG_VALIDATE_${diagnosticCategory(error.stderr)}`); }
      assertLive();
      child = spawn(command, ['gateway', 'run', '--port', String(port),
        '--bind', 'loopback'], { env: childEnv,
        stdio: ['ignore', 'ignore', 'pipe'] });
      child.gatewayStderr = '';
      child.stderr.on('data', (chunk) => {
        child.gatewayStderr = `${child.gatewayStderr}${String(chunk)}`.slice(-16_384);
      });
      child.once('error', () => { child.launchFailed = true; });
      await waitForLoopback(port, child, deadlineAt, binding.signal);
      assertLive();
      const healthStartedAt = Date.now();
      const healthRemainingMs = Math.max(1, deadlineAt - healthStartedAt);
      try { await execFile(command, ['gateway', 'health', '--timeout',
        String(Math.min(10_000, healthRemainingMs))],
        { env: childEnv, maxBuffer: 1024 * 1024,
          timeout: Math.min(60_000, healthRemainingMs) }); }
      catch (error) {
        const failure = new Error(`NATIVE_GATEWAY_HEALTH_${diagnosticCategory(error.stderr)}`);
        failure.healthExec = fixedHealthExecFailure(error, Date.now() - healthStartedAt);
        throw failure;
      }
      assertLive();
      return { gatewayUrl: `http://127.0.0.1:${port}`, gatewayToken: token,
        close, getSanitizedReceipt: () => ({ ...adapter.getSanitizedReceipt(),
          tempSecretScan, providerTimeout: providerTimeoutReceipt }) };
    } catch (error) {
      await close();
      throw error;
    }
  };
}
