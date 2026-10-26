import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { closeSync, createReadStream, fsyncSync, linkSync, openSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgramAgentSession } from './program-agent-session.mjs';
import { JOBAID_WORK_UPDATE_SHAPE } from '../skills/wiselink-research-and-synthesize/scripts/jobaid-work-shape.mjs';
import { JOBAID_SEMANTIC_GUIDANCE, SOURCE_CONTENT_SYNTHESIS_GUIDANCE } from '../skills/wiselink-research-and-synthesize/scripts/jobaid-problem-guidance.mjs';
import { createCheckpointStore } from '../skills/wiselink-research-and-synthesize/scripts/run-hosted-review-turn.mjs';
import { canonicalJson } from '../skills/wiselink-research-and-synthesize/scripts/validate-payload.mjs';
import { PROGRAM_AGENT_MODE, validateProgramAgentPolicy } from '../skills/wiselink-research-and-synthesize/scripts/program-assessment-materials.mjs';

export const PROGRAM_AGENT_SEAL_VERSION = 2;

const here = dirname(fileURLToPath(import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw new Error(code); };
const OUTPUT_FUNCTION = 'return_wiselink_program_assessment';

async function durable(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
const durableJson = (path, value) => durable(path, Buffer.from(JSON.stringify(value) + '\n'));
async function hasCompletedCliTurn(path) {
  // The old 2M-character successful stdout fits in at most 6M UTF-8 bytes.
  // Keep that entire control-record range without retaining the whole log.
  // Oversized records remain on disk and cannot complete from a partial match.
  const line = Buffer.alloc(6_000_000);
  let length = 0, oversized = false;
  const completed = () => {
    try { return JSON.parse(line.subarray(0, length).toString('utf8')).type === 'turn.completed'; }
    catch { return false; }
  };
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      const part = chunk.subarray(start, end < 0 ? chunk.length : end);
      if (!oversized) {
        if (length + part.length > line.length) oversized = true;
        else { part.copy(line, length); length += part.length; }
      }
      if (end < 0) break;
      if (!oversized && completed()) return true;
      length = 0; oversized = false; start = end + 1;
    }
  }
  // Preserve the original acceptance of a complete last JSON record without LF.
  return !oversized && completed();
}

async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function completeResponsesSse(bytes) {
  const text = bytes.toString('utf8');
  const events = [];
  let kind = null, data = [];
  for (const line of text.split(/\r?\n/u)) {
    if (line.startsWith('event:')) kind = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    else if (line === '' && data.length) {
      let value;
      try { value = JSON.parse(data.join('\n')); } catch { return false; }
      events.push({ kind, value }); kind = null; data = [];
    }
  }
  const terminal = events.filter(item => ['response.completed', 'response.failed', 'response.incomplete'].includes(item.kind));
  return data.length === 0 && terminal.length === 1 && terminal[0] === events.at(-1) &&
    terminal[0].kind === 'response.completed' && terminal[0].value?.response?.status === 'completed';
}

function trustedChatTerminal(receipt) {
  const terminal = receipt?.terminal;
  if (terminal?.schemaVersion !== 'wiselink.chat-terminal-receipt.v1' ||
      terminal.seenValidTerminal !== true || terminal.sdkStreamExhausted !== true ||
      terminal.errorCode !== null || terminal.rawFinishReason !== receipt.upstreamFinishReason ||
      !['stop', 'tool_calls'].includes(terminal.rawFinishReason)) return false;
  if (receipt.upstreamProtocol === 'fixture-chat-completions-sse-v1')
    return terminal.basis === 'synthetic-fixture';
  return receipt.upstreamProtocol === 'litellm-1.106.4-chat-completions-sse' &&
    terminal.basis === 'openai-sdk-raw-chat' && receipt.litellmVersion === '1.106.4' &&
    receipt.openaiSdkVersion === '2.54.0' && receipt.transportCleanEnd === true &&
    receipt.internalHttpAttemptCount === 1 && receipt.blockedAdditionalHttpAttempts === 0 &&
    receipt.cancelled === false && receipt.errorCode === null;
}

async function serverAt(handler) {
  const server = createServer(handler);
  await new Promise((accept, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', accept);
  });
  return server;
}
async function closeServer(server) {
  if (!server) return;
  server.closeAllConnections();
  await new Promise(accept => server.close(accept));
}
async function bodyOf(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2_000_000) fail('PROGRAM_AGENT_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function send(response, status, bytes, contentType = 'application/json') {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': contentType, 'content-length': bytes.length, connection: 'close' });
  response.end(bytes);
}

function configText({ modelCatalog, providerPort, brokerPort, brokerToken, timeoutSeconds }) {
  // Broker token is passed only in the child environment, never written here.
  void brokerPort; void brokerToken;
  return `model = "glm-5.3"
model_provider = "synthetic-program-agent"
model_catalog_json = ${JSON.stringify(modelCatalog)}
web_search = "disabled"
sandbox_mode = "read-only"
approval_policy = "never"
allow_login_shell = false
check_for_update_on_startup = false
mcp_optional_startup_grace_ms = 0

[model_providers.synthetic-program-agent]
name = "Injected offline program-agent provider"
base_url = "http://127.0.0.1:${providerPort}/v1"
wire_api = "responses"
requires_openai_auth = false
env_key = "WISELINK_PROGRAM_AGENT_LOCAL_TOKEN"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = ${timeoutSeconds * 1000}

[model_providers.synthetic-program-agent.capabilities]
external_web_access = false
remote_compaction = "unsupported"

[mcp_servers.program_agent]
enabled = true
required = true
command = ${JSON.stringify('python3')}
args = [${JSON.stringify(resolve(here, 'mcp_stdio.py'))}]
env_vars = ["WISELINK_ASSESSMENT_URL", "WISELINK_ASSESSMENT_TOKEN"]
enabled_tools = ["read_sources", "read_private_units", "read_previous_work", "validate_candidate"]
startup_timeout_sec = 10
tool_timeout_sec = 30

[mcp_servers.program_agent.tools.read_sources]
approval_mode = "approve"
[mcp_servers.program_agent.tools.read_private_units]
approval_mode = "approve"
[mcp_servers.program_agent.tools.read_previous_work]
approval_mode = "approve"
[mcp_servers.program_agent.tools.validate_candidate]
approval_mode = "approve"

[agents]
enabled = false
[features]
shell_tool = false
view_image = false
goals = false
apps = false
multi_agent = false
hooks = false
enable_request_compression = false
unbounded_connection_retries = false
[analytics]
enabled = false
[feedback]
enabled = false
[otel]
exporter = "none"
metrics_exporter = "none"
trace_exporter = "none"
[shell_environment_policy]
inherit = "none"
set = { PATH = "/usr/bin:/bin" }
`;
}

function modelCatalog() {
  return { models: [{ slug: 'glm-5.3', display_name: 'Offline program candidate',
    description: 'Isolated candidate formation with bounded read-only tools', default_reasoning_level: null,
    supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true,
    priority: 1, availability_nux: null, upgrade: null,
    model_messages: { instructions_template: 'Use only the program_agent MCP tools. Return a candidate, not a saved result.' },
    supports_reasoning_summary_parameter: false, default_reasoning_summary: 'none', support_verbosity: false,
    default_verbosity: null, apply_patch_tool_type: null, truncation_policy: { mode: 'bytes', limit: 300000 },
    experimental_supported_tools: [], input_modalities: ['text'], tool_mode: 'direct',
    node_repl_disabled: true, include_apps_usage_instructions: false }] };
}

/** One fresh CLI process or the exact complete receipt of that process. There
 * is deliberately no dead-session restart or provider replay. */
export async function runProgramAgentGateway({ requestId, binding, materials, policy, executionModel,
  codexOptions, readAssessmentSources, readAssessmentWork, providerDispatch, onRunPrepared,
  generationDeadlineAt, heartbeat, sealVersion = PROGRAM_AGENT_SEAL_VERSION, signal, recoverOnly = false }) {
  if (typeof requestId !== 'string' || !requestId || !record(binding) ||
      !record(materials) || !record(policy) || executionModel?.modelRef !== 'miaoda/glm-5.3' ||
      typeof providerDispatch !== 'function' || !isAbsolute(codexOptions?.codexBinary ?? '') ||
      !isAbsolute(codexOptions?.runRoot ?? '') ||
      !Number.isFinite(Date.parse(generationDeadlineAt)) || ![1, PROGRAM_AGENT_SEAL_VERSION].includes(sealVersion) ||
      typeof recoverOnly !== 'boolean' ||
      (signal !== undefined && !(signal instanceof AbortSignal))) fail('PROGRAM_AGENT_GATEWAY_INVALID');
  if (materials.originalInput?.executionMode === PROGRAM_AGENT_MODE)
    validateProgramAgentPolicy(policy, executionModel);
  // V1 retains its original ordering and hashes. New V2 seals use exactly the
  // deterministic representation already used by the parent checkpoint store.
  const represent = sealVersion === PROGRAM_AGENT_SEAL_VERSION ? canonicalJson : JSON.stringify;
  if (sealVersion === PROGRAM_AGENT_SEAL_VERSION) {
    materials = JSON.parse(represent(materials));
    binding = JSON.parse(represent(binding));
    executionModel = JSON.parse(represent(executionModel));
    policy = JSON.parse(represent(policy));
  }
  const root = resolve(codexOptions.runRoot);
  if (!recoverOnly) await mkdir(root, { recursive: true, mode: 0o700 });
  const runDirectory = resolve(root, `program-agent-${sha(requestId)}`);
  let heartbeatFailure = false, dispatchFailed = false;
  let broker, provider, child, heartbeatTimer, deadlineTimer, killTimer;
  let stopCode = null, childClosed = false, inFlight = 0;
  const cancellation = new AbortController();
  const stop = code => {
    if (!cancellation.signal.aborted) {
      stopCode = code;
      cancellation.abort(new Error(code));
    }
    if (child && !childClosed) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer ??= setTimeout(() => {
        if (!childClosed) try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }, 5000);
      killTimer.unref();
    }
  };
  const externalAbort = () => stop('PROGRAM_AGENT_USER_CANCELLED');
  const checkHeartbeat = async () => {
    try { await heartbeat?.(); }
    catch {
      heartbeatFailure = true;
      stop('PROGRAM_AGENT_HEARTBEAT_FAILED');
      fail('PROGRAM_AGENT_HEARTBEAT_FAILED');
    }
  };
  const canContinue = () => !cancellation.signal.aborted && !signal?.aborted &&
    !heartbeatFailure && !dispatchFailed &&
    Date.now() < Date.parse(generationDeadlineAt);
  const task = materials.originalInput;
  const prompt = `Produce one complete Chinese engineering work candidate for ${task.purpose}.\n` +
    `Scope: ${represent({ documentTitle: task.documentOverview?.title ?? null,
      expectedWorkRevision: task.expectedWorkRevision,
      methodPackRef: task.methodBinding?.packRef ?? null,
      previousWorkRevisionRef: task.previousWork?.workRevisionRef ?? null })}\n` +
    `Read exact source references or private original units on demand; unit IDs and uncitable IDs are not citations.\n` +
    `read_private_units also returns the bound task context, original coverage and findings.\n` +
    `Each issue.body must contain an inline citation: put the exact complete evidenceRef inside ` +
    `[[double brackets]] near the supported text. Copy it verbatim from this session's successful ` +
    `read_sources result; bare refs and basisRefs/checkedEvidenceRefs do not replace body citations.\n` +
    `read_private_units supplies content and locators only; it does not grant citation authority. ` +
    `Before citing a directory source ref, read that exact ref with read_sources. ` +
    `Do not substitute unitId/sourceRefId values for an evidenceRef; ` +
    `use only the exact evidenceRef returned by successful read_sources.\n` +
    `The Host computes numeric risk scores and risk grades. Do not write calculated scores or grades ` +
    `in candidate prose, including issue bodies, headlines, listBrief or overview. ` +
    `Preserve supported severity/likelihood labels and their evidence instead.\n` +
    `Call validate_candidate for repair feedback. Do not save, finish Host work, use shell/web, or claim approval.\n` +
    `Required work schema: ${represent(JOBAID_WORK_UPDATE_SHAPE)}\n` +
    `${JOBAID_SEMANTIC_GUIDANCE}\n${SOURCE_CONTENT_SYNTHESIS_GUIDANCE}\n` +
    `At the end return only JSON with exactly tool_name=${OUTPUT_FUNCTION} and arguments={workJson:<JSON text>}.\n` +
    represent(materials.directory);
  const sealed = JSON.parse(represent({ version: sealVersion,
    ...(sealVersion === PROGRAM_AGENT_SEAL_VERSION ? { schemaVersion: 'wiselink.native.program-agent-seal.v2' } : {}),
    requestId, binding, executionModel, policy, generationDeadlineAt,
    materialsSha256: sha(represent(materials)),
    originalInputSha256: sha(represent(materials.originalInput)),
    directorySha256: sha(represent(materials.directory)), promptSha256: sha(prompt) }));
  let fresh = false;
  if (!recoverOnly) {
    try { await mkdir(runDirectory, { mode: 0o700 }); fresh = true; }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  const sealedPath = resolve(runDirectory, 'program-agent-binding.json');
  if (!fresh) {
    const prior = await optionalJson(sealedPath);
    if (!prior && recoverOnly) fail('PROGRAM_AGENT_OUTCOME_UNKNOWN');
    if (represent(prior) !== represent(sealed)) fail('PROGRAM_AGENT_BINDING_MISMATCH');
    const completed = await optionalJson(resolve(runDirectory, 'program-agent-final-receipt.json'));
    if (!record(completed) || completed.version !== 1 || completed.requestId !== requestId ||
        completed.runDirectory !== runDirectory || completed.bindingSha256 !== sha(JSON.stringify(sealed)) ||
        (sealVersion === PROGRAM_AGENT_SEAL_VERSION && completed.sealVersion !== sealVersion) ||
        represent(completed.binding) !== represent(binding) ||
        represent(completed.executionModel) !== represent(executionModel) ||
        represent(completed.policy) !== represent(policy) ||
        completed.generationDeadlineAt !== generationDeadlineAt ||
        completed.responseSha256 !== sha(completed.raw) || completed.status !== 200 || completed.ok !== true ||
        !Number.isSafeInteger(completed.dispatchCount) || completed.dispatchCount < 1 ||
        (policy.maxModelRequests !== null && completed.dispatchCount > policy.maxModelRequests) ||
        !Array.isArray(completed.dispatches) || completed.dispatches.length !== completed.dispatchCount ||
        completed.dispatches.some((item, index) => item.ordinal !== index + 1 ||
          item.maxOutputTokens !== policy.maxOutputTokens) ||
        !Array.isArray(completed.toolAudit) || !Array.isArray(completed.deliveredRefs))
      fail('PROGRAM_AGENT_OUTCOME_UNKNOWN');
    return completed;
  }
  await durableJson(sealedPath, sealed);
  await durable(resolve(runDirectory, 'codex-prompt.txt'), Buffer.from(prompt, 'utf8'));
  await onRunPrepared?.({ runDirectory, bindingSha256: sha(JSON.stringify(sealed)), requestId });
  const ledger = await createCheckpointStore(resolve(runDirectory, 'ledger'));
  const token = randomBytes(32).toString('base64url');
  const brokerToken = randomBytes(32).toString('base64url');
  let count = 0, toolCount = 0;
  const session = createProgramAgentSession({ materials, readAssessmentSources, readAssessmentWork,
    maxToolCalls: policy.maxToolCalls, canContinue,
    persistToolResult: observation => ledger.writeOnce(`tool-${++toolCount}.result`, observation) });
  const report = [];
  let dispatchQueue = Promise.resolve();
  if (signal?.aborted) externalAbort();
  else signal?.addEventListener('abort', externalAbort, { once: true });
  const remainingMs = Date.parse(generationDeadlineAt) - Date.now();
  if (remainingMs <= 0) stop('PROGRAM_AGENT_DEADLINE_EXPIRED');
  else deadlineTimer = setTimeout(() => stop('PROGRAM_AGENT_DEADLINE_EXPIRED'), remainingMs);
  try {
    broker = await serverAt(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/mcp' ||
          request.headers.authorization !== `Bearer ${brokerToken}`) {
        send(response, 403, Buffer.from('{"error":"forbidden"}')); return;
      }
      try {
        const message = JSON.parse((await bodyOf(request)).toString('utf8'));
        let value = null;
        if (message.method === 'tools/list') value = { tools: session.tools };
        else if (message.method === 'tools/call') {
          if (!canContinue()) fail('PROGRAM_AGENT_TOOL_STOPPED');
          await checkHeartbeat();
          const observation = await session.callTool(message.params?.name, message.params?.arguments);
          value = { content: [{ type: 'text', text: JSON.stringify(observation) }], isError: false };
        }
        send(response, value ? 200 : 400, Buffer.from(JSON.stringify(value ?? { error: 'method_not_allowed' })));
      } catch {
        dispatchFailed = true;
        stop('PROGRAM_AGENT_TOOL_UNKNOWN');
        send(response, 502, Buffer.from('{"error":"program_agent_tool_unknown"}'));
      }
    });
    provider = await serverAt(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/v1/responses' ||
          request.headers.authorization !== `Bearer ${token}`) {
        send(response, 403, Buffer.from('{"error":"forbidden"}')); return;
      }
      const work = dispatchQueue.then(async () => {
        if (!canContinue()) fail('PROGRAM_AGENT_DISPATCH_STOPPED');
        await checkHeartbeat();
        if (!canContinue()) fail('PROGRAM_AGENT_DISPATCH_STOPPED');
        const clientRequestBytes = await bodyOf(request);
        if (!canContinue()) fail('PROGRAM_AGENT_DISPATCH_STOPPED');
        const ordinal = count + 1;
        if (policy.maxModelRequests !== null && ordinal > policy.maxModelRequests) fail('PROGRAM_AGENT_MODEL_BUDGET_EXHAUSTED');
        const clientRequestSha256 = sha(clientRequestBytes);
        let parsed;
        try { parsed = JSON.parse(clientRequestBytes.toString('utf8')); }
        catch { fail('PROGRAM_AGENT_CLIENT_REQUEST_INVALID'); }
        if (!record(parsed) || parsed.model !== 'glm-5.3' || parsed.stream !== true ||
            (parsed.max_output_tokens !== undefined && parsed.max_output_tokens !== policy.maxOutputTokens))
          fail('PROGRAM_AGENT_CLIENT_REQUEST_INVALID');
        const effectiveRequestBytes = Buffer.from(JSON.stringify({ ...parsed, max_output_tokens: policy.maxOutputTokens }));
        const effectiveRequestSha256 = sha(effectiveRequestBytes);
        const started = { version: 1, ordinal, requestId, clientRequestSha256, effectiveRequestSha256,
          executionModel, maxOutputTokens: policy.maxOutputTokens, bindingSha256: sha(JSON.stringify(sealed)),
          ...(sealVersion === PROGRAM_AGENT_SEAL_VERSION ? { generationDeadlineAt } : {}) };
        count = ordinal;
        await ledger.writeOnce(`dispatch-${ordinal}.started`, started);
        await durable(resolve(runDirectory, `dispatch-${ordinal}.client.json`), clientRequestBytes);
        await durable(resolve(runDirectory, `dispatch-${ordinal}.effective.json`), effectiveRequestBytes);
        // The timer and the earlier check do not authorize this dispatch after
        // body reads/durable writes. Recheck the current fence at the call edge,
        // then the same frozen deadline; keep the reservation on any failure.
        await checkHeartbeat();
        if (!canContinue()) fail('PROGRAM_AGENT_DISPATCH_STOPPED');
        let result;
        inFlight++;
        try {
          result = await providerDispatch({ ordinal, requestId, runDirectory, binding,
            executionModel, maxOutputTokens: policy.maxOutputTokens, clientRequestBytes,
            clientRequestSha256, effectiveRequestBytes, effectiveRequestSha256, nativeAdmission: started,
            generationDeadlineAt, timeoutMs: Math.min(policy.timeoutSeconds * 1000,
              Date.parse(generationDeadlineAt) - Date.now()), signal: cancellation.signal });
        } finally { inFlight--; }
        const { responseBytes, upstreamRequestBytes, upstreamResponseBytes, receipt } = result ?? {};
        if (!Buffer.isBuffer(responseBytes) || !Buffer.isBuffer(upstreamRequestBytes) ||
            !Buffer.isBuffer(upstreamResponseBytes) || !record(receipt) || receipt.complete !== true ||
            receipt.upstreamHttpStatus !== 200 || !trustedChatTerminal(receipt) ||
            (receipt.upstreamProtocol === 'litellm-1.106.4-chat-completions-sse' &&
              (JSON.stringify(receipt.nativeAdmission) !== JSON.stringify(started) ||
                (sealVersion === PROGRAM_AGENT_SEAL_VERSION &&
                  (receipt.generationDeadlineAt !== generationDeadlineAt || receipt.deadlineBasis !== 'SEALED_ABSOLUTE')))) ||
            receipt.maxOutputTokens !== policy.maxOutputTokens ||
            JSON.stringify(receipt.executionModel) !== JSON.stringify(executionModel) ||
            receipt.clientRequestSha256 !== clientRequestSha256 ||
            receipt.effectiveRequestSha256 !== effectiveRequestSha256 ||
            receipt.upstreamRequestSha256 !== sha(upstreamRequestBytes) ||
            receipt.upstreamResponseSha256 !== sha(upstreamResponseBytes) ||
            (receipt.reportedModel !== null && (typeof receipt.reportedModel !== 'string' ||
              !receipt.reportedModel || receipt.reportedModel.length > 255)) ||
            !completeResponsesSse(responseBytes)) fail('PROGRAM_AGENT_PROVIDER_RECEIPT_INVALID');
        await durable(resolve(runDirectory, `dispatch-${ordinal}.response.sse`), responseBytes);
        await durable(resolve(runDirectory, `dispatch-${ordinal}.upstream-request`), upstreamRequestBytes);
        await durable(resolve(runDirectory, `dispatch-${ordinal}.upstream-response`), upstreamResponseBytes);
        if (!canContinue()) fail('PROGRAM_AGENT_DISPATCH_STOPPED');
        const closed = { ...started, responseSha256: sha(responseBytes), receipt };
        await ledger.writeOnce(`dispatch-${ordinal}.result`, closed);
        report.push({ ordinal, clientRequestSha256, effectiveRequestSha256,
          responseSha256: closed.responseSha256, upstreamRequestSha256: receipt.upstreamRequestSha256,
          upstreamResponseSha256: receipt.upstreamResponseSha256, reportedModel: receipt.reportedModel,
          upstreamFinishReason: receipt.upstreamFinishReason,
          maxOutputTokens: policy.maxOutputTokens });
        return responseBytes;
      });
      dispatchQueue = work.catch(() => {
        dispatchFailed = true;
        stop('PROGRAM_AGENT_DISPATCH_UNKNOWN');
      });
      try {
        send(response, 200, await work, 'text/event-stream');
      } catch {
        dispatchFailed = true;
        send(response, 502, Buffer.from('{"error":"program_agent_dispatch_unknown"}'));
      }
    });
    for (const name of ['codex-home', 'user-home', 'tmp', 'work'])
      await mkdir(resolve(runDirectory, name), { mode: 0o700 });
    const catalogPath = resolve(runDirectory, 'models.json');
    await writeFile(catalogPath, JSON.stringify(modelCatalog()), { mode: 0o600 });
    await writeFile(resolve(runDirectory, 'codex-home/config.toml'), configText({ modelCatalog: catalogPath,
      providerPort: provider.address().port, brokerPort: broker.address().port, brokerToken,
      timeoutSeconds: policy.timeoutSeconds }), { mode: 0o600 });
    if (!canContinue()) fail('PROGRAM_AGENT_DEADLINE_EXPIRED');
    await checkHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (canContinue()) checkHeartbeat().catch(() => {});
    }, 10_000);
    const env = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: resolve(runDirectory, 'user-home'),
      CODEX_HOME: resolve(runDirectory, 'codex-home'), TMPDIR: resolve(runDirectory, 'tmp'), TERM: 'dumb',
      WISELINK_PROGRAM_AGENT_LOCAL_TOKEN: token,
      WISELINK_ASSESSMENT_URL: `http://127.0.0.1:${broker.address().port}/mcp`,
      WISELINK_ASSESSMENT_TOKEN: brokerToken };
    const command = ['exec', '--sandbox', 'read-only', '--ephemeral', '--json', '--output-last-message',
      resolve(runDirectory, 'final.txt'), '--skip-git-repo-check', '--cd', resolve(runDirectory, 'work'), '-'];
    const stdoutPath = resolve(runDirectory, 'codex.stdout.jsonl');
    const stderrPath = resolve(runDirectory, 'codex.stderr.log');
    let stdoutFile, stderrFile, output, captureFailed = false;
    const captures = [];
    const captureFailure = () => { captureFailed = true; stop('PROGRAM_AGENT_CLI_OUTPUT_CAPTURE_FAILED'); };
    const capture = async (stream, file) => {
      try {
        // Each pipe waits for its current disk write before reading again.
        // Neither a whole-stream buffer nor an unbounded write queue is kept.
        for await (const part of stream) {
          let offset = 0;
          while (offset < part.length) {
            const { bytesWritten } = await file.write(part, offset, part.length - offset, null);
            if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > part.length - offset)
              fail('PROGRAM_AGENT_CLI_OUTPUT_CAPTURE_FAILED');
            offset += bytesWritten;
          }
        }
      } catch { captureFailure(); }
      finally {
        // Even a failed run keeps its successfully written prefix.
        try { await file.sync(); } catch { captureFailure(); }
      }
    };
    try {
      try {
        stdoutFile = await open(stdoutPath, 'wx', 0o600);
        stderrFile = await open(stderrPath, 'wx', 0o600);
      } catch (error) { captureFailure(); throw error; }
      output = await new Promise((accept, reject) => {
        child = spawn(codexOptions.codexBinary, command, { cwd: resolve(runDirectory, 'work'),
          env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        let childError;
        captures.push(capture(child.stdout, stdoutFile), capture(child.stderr, stderrFile));
        if (!canContinue()) stop(stopCode ?? 'PROGRAM_AGENT_DEADLINE_EXPIRED');
        child.once('error', error => { childError = error; stop('PROGRAM_AGENT_CLI_FAILED'); });
        child.once('close', code => {
          childClosed = true;
          if (inFlight > 0 || code !== 0) stop('PROGRAM_AGENT_CLI_EXITED');
          if (childError) reject(childError);
          else accept({ code, timedOut: stopCode === 'PROGRAM_AGENT_DEADLINE_EXPIRED' });
        });
        child.stdin.on('error', () => {});
        child.stdin.end(prompt);
      });
    } finally {
      await Promise.all(captures);
      for (const file of [stdoutFile, stderrFile]) {
        try { await file?.close(); } catch { captureFailure(); }
      }
      try {
        const directory = await open(runDirectory, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch { captureFailure(); }
    }
    if (captureFailed || dispatchFailed || heartbeatFailure || !canContinue() ||
        output.code !== 0 || output.timedOut || report.length < 1 ||
        report.at(-1).upstreamFinishReason !== 'stop' ||
        !await hasCompletedCliTurn(stdoutPath))
      fail('PROGRAM_AGENT_OUTCOME_UNKNOWN');
    let candidate;
    try { candidate = JSON.parse(await readFile(resolve(runDirectory, 'final.txt'), 'utf8')); }
    catch { fail('PROGRAM_AGENT_CANDIDATE_INVALID'); }
    if (!record(candidate) || Object.keys(candidate).sort().join(',') !== 'arguments,tool_name' ||
        candidate.tool_name !== OUTPUT_FUNCTION || !record(candidate.arguments) ||
        Object.keys(candidate.arguments).join(',') !== 'workJson' ||
        session.validateFinal(candidate.arguments.workJson).status !== 'VALID') fail('PROGRAM_AGENT_CANDIDATE_INVALID');
    if (!canContinue()) fail('PROGRAM_AGENT_OUTCOME_UNKNOWN');
    const reportedModel = report.at(-1).reportedModel;
    const raw = JSON.stringify({ id: `program-agent-${sha(requestId).slice(0, 24)}`,
      object: 'chat.completion', ...(reportedModel ? { model: reportedModel } : {}),
      choices: [{ index: 0, finish_reason: 'tool_calls',
        message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${sha(requestId).slice(0, 24)}`,
          type: 'function', function: { name: OUTPUT_FUNCTION,
            arguments: JSON.stringify(candidate.arguments) } }] } }] });
    const completed = { version: 1, requestId, runDirectory, bindingSha256: sha(JSON.stringify(sealed)),
      ...(sealVersion === PROGRAM_AGENT_SEAL_VERSION ? { sealVersion } : {}),
      binding, executionModel, policy, generationDeadlineAt,
      responseSha256: sha(raw), raw, status: 200, ok: true, dispatchCount: report.length,
      dispatches: report, toolAudit: session.audit(), deliveredRefs: session.deliveredRefs() };
    const pendingReceipt = resolve(runDirectory, 'program-agent-final-receipt.pending.json');
    await durableJson(pendingReceipt, completed);
    // Publication is the success boundary. Stop during candidate read or the
    // durable write leaves only a private pending file, never a trusted result.
    // No await may interleave a stop between this check and exclusive publish.
    if (!canContinue()) fail('PROGRAM_AGENT_OUTCOME_UNKNOWN');
    linkSync(pendingReceipt, resolve(runDirectory, 'program-agent-final-receipt.json'));
    const parentFd = openSync(runDirectory, 'r');
    try { fsyncSync(parentFd); unlinkSync(pendingReceipt); fsyncSync(parentFd); }
    finally { closeSync(parentFd); }
    return completed;
  } finally {
    clearInterval(heartbeatTimer);
    clearTimeout(deadlineTimer);
    signal?.removeEventListener('abort', externalAbort);
    if ((child && !childClosed) || inFlight > 0) stop('PROGRAM_AGENT_SESSION_CLOSED');
    // Await the adapter's cancellation/final receipt; killing only Codex must
    // not leave a Python HTTP attempt running after the gateway returns.
    await dispatchQueue;
    if (stopCode) await ledger.writeOnce('session-stop', { version: 1, requestId,
      bindingSha256: sha(JSON.stringify(sealed)), generationDeadlineAt,
      code: stopCode, reservedDispatches: count, inFlightAtReturn: inFlight });
    clearTimeout(killTimer);
    await closeServer(provider); await closeServer(broker);
  }
}
