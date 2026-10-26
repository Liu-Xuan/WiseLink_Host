import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const exactly = (value, expected) => Array.isArray(value) && value.length === expected.length &&
  value.every((item, index) => item === expected[index]);

// This scanner only recognizes structure and duplicate keys. JSON.parse still
// validates the entire grammar; no token, string, value or nested closer is repaired.
function scan(text) {
  const stack = [];
  let quoted = false, escaped = false, start = 0, root = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char !== '"') continue;
      quoted = false;
      const parent = stack.at(-1);
      if (parent?.key) {
        const key = JSON.parse(text.slice(start, index + 1));
        if (parent.keys.has(key)) throw new Error('duplicate_json_key');
        parent.keys.add(key); parent.key = false;
      }
      continue;
    }
    if (char === '"') { quoted = true; start = index; continue; }
    if (char === '{' || char === '[') {
      if (!root) {
        if (char !== '{' || text.slice(0, index).trim()) throw new Error('object_required');
        root = true;
      } else if (!stack.length) throw new Error('extra_json_value');
      stack.push({ char, key: char === '{', keys: new Set() });
    } else if (char === '}' || char === ']') {
      if (stack.at(-1)?.char !== (char === '}' ? '{' : '[')) throw new Error('invalid_json_closer');
      stack.pop();
    } else if (char === ',' && stack.at(-1)?.char === '{') stack.at(-1).key = true;
    else if (!stack.length && char.trim()) throw new Error('extra_json_value');
  }
  return { stack, quoted, escaped, root };
}

function strictObject(text) {
  const state = scan(text);
  if (!state.root || state.quoted || state.stack.length) throw new Error('incomplete_json');
  const value = JSON.parse(text);
  const finite = item => typeof item === 'number' ? Number.isFinite(item)
    : item && typeof item === 'object' ? Object.values(item).every(finite) : true;
  if (!record(value) || !finite(value)) throw new Error('invalid_json_object');
  return value;
}

function closedCandidate(raw) {
  const state = scan(raw);
  if (!state.root || state.quoted || state.escaped || state.stack.length !== 1 ||
      state.stack[0].char !== '{') return null;
  const normalized = raw + '}';
  const candidate = strictObject(normalized);
  if (!exactly(Object.keys(candidate).sort(), ['arguments', 'tool_name']) ||
      typeof candidate.tool_name !== 'string' || !record(candidate.arguments)) return null;
  if (Object.hasOwn(candidate.arguments, 'workJson')) {
    if (typeof candidate.arguments.workJson !== 'string') return null;
    strictObject(candidate.arguments.workJson);
  }
  return { candidate, normalized };
}

async function publish(path, bytes) {
  try {
    if (!(await readFile(path)).equals(bytes)) throw new Error('CODEX_GENERATION_FINAL_RECOVERY_INVALID');
    return;
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path);
  const directory = await open(resolve(path, '..'), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

/** Only after the gateway's unchanged original binding/prompt/receipt checks.
 * Original artifacts remain untouched. A derived receipt never changes their
 * failed transport verdict and cannot authorize a model request or Host write. */
export async function recoverFinalRoot({ runDirectory, binding, bindingSha256, receipt,
  transport, candidate, validateCandidate }) {
  if (transport.transport_passed !== false || transport.run_directory !== runDirectory ||
      transport.model !== 'glm-5.3' || transport.codex_version !== 'codex-cli 0.164.0' ||
      transport.codex_exit_code !== 0 || transport.timed_out !== false || transport.failure !== null ||
      transport.failure_phase !== null || transport.closure !== 'completed' ||
      transport.auth_json_present !== false || transport.provider_requires_openai_auth !== false ||
      transport.openai_credentials_in_child_environment !== false ||
      transport.process_group_closed !== true || transport.process_group_had_members !== false ||
      transport.model_requests !== 1 || !exactly(transport.upstream_models, ['glm-5.3']) ||
      !exactly(transport.terminal_events, ['turn.completed']) || !exactly(transport.tool_items, []) ||
      !exactly(transport.bridge_errors, []) || transport.structured_final_to_contract !== false ||
      transport.final_error !== 'invalid_structured_final' || Object.keys(candidate).length !== 0 ||
      transport.upstream_request_present !== true || transport.upstream_response_present !== true ||
      transport.source_config_unchanged !== true ||
      !/^[0-9a-f]{64}$/u.test(transport.source_config_sha256_before ?? '') ||
      transport.source_config_sha256_before !== transport.source_config_sha256_after ||
      ![transport.input_tokens, transport.output_tokens, transport.duration_ms].every(integer) ||
      transport.output_tokens === 0) return null;
  let source, final;
  try {
    try { await stat(resolve(runDirectory, 'contract-candidate.json')); return null; }
    catch (error) { if (error?.code !== 'ENOENT') return null; }
    const names = ['generation-binding.json', 'generation-receipt.json', 'upstream-request.json',
      'upstream-response.json', 'bridge.audit.jsonl', 'final.txt'];
    source = Object.fromEntries(await Promise.all(names.map(async name =>
      [name, await readFile(resolve(runDirectory, name))])));
    if (Object.values(source).some(bytes => !bytes.equals(Buffer.from(bytes.toString('utf8'))))) return null;
    if (digest(source['generation-binding.json'].toString('utf8').trim()) !== bindingSha256 ||
        JSON.stringify(strictObject(source['generation-receipt.json'].toString('utf8'))) !== JSON.stringify(receipt))
      return null;
    const requestSha = digest(source['upstream-request.json']);
    const responseSha = digest(source['upstream-response.json']);
    if (requestSha !== receipt.upstream_request_sha256 || requestSha !== transport.upstream_request_sha256 ||
        responseSha !== receipt.upstream_response_sha256 || responseSha !== transport.upstream_response_sha256)
      return null;
    const request = strictObject(source['upstream-request.json'].toString('utf8'));
    if (request.model !== 'glm-5.3' || request.stream !== true ||
        !Number.isSafeInteger(request.max_tokens) || request.max_tokens < 1 ||
        request.max_tokens > binding.maxOutputTokens ||
        (request.tools !== undefined && !exactly(request.tools, []))) return null;
    const audit = source['bridge.audit.jsonl'].toString('utf8').trim().split('\n').map(strictObject);
    if (audit.length !== 1) return null;
    const row = audit[0];
    if (row.route !== '/v1/responses' || row.model !== 'glm-5.3' || row.status !== 200 ||
        row.upstream_attempted !== true || !exactly(row.upstream_models, ['glm-5.3']) ||
        row.finish_reason !== 'stop' || row.tools !== 0 || row.tool_calls !== 0 || row.tool_results !== 0 ||
        row.error_code || row.error_type || row.error_phase || !record(row.usage) ||
        row.usage.input_tokens !== transport.input_tokens || row.usage.output_tokens !== transport.output_tokens ||
        row.usage.total_tokens !== transport.input_tokens + transport.output_tokens) return null;
    const upstream = strictObject(source['upstream-response.json'].toString('utf8'));
    if (upstream.format !== 'chat-completions-sse-events-v1' || !Array.isArray(upstream.events) ||
        !upstream.events.length) return null;
    const content = [], finishes = [], models = new Set();
    let usage;
    for (const event of upstream.events) {
      if (!record(event) || event.error || (event.choices !== undefined && !Array.isArray(event.choices))) return null;
      if (event.model !== undefined) models.add(event.model);
      if (event.usage != null) {
        if (!record(event.usage) ||
            !['prompt_tokens', 'completion_tokens', 'total_tokens'].every(key => integer(event.usage[key]))) return null;
        usage = event.usage;
      }
      for (const choice of event.choices ?? []) {
        if (!record(choice) || (choice.index ?? 0) !== 0 || !record(choice.delta ?? {})) return null;
        const delta = choice.delta ?? {};
        if (delta.refusal || (delta.tool_calls !== undefined && !exactly(delta.tool_calls, []))) return null;
        if (delta.content != null) {
          if (typeof delta.content !== 'string') return null;
          content.push(delta.content);
        }
        if (choice.finish_reason != null) finishes.push(choice.finish_reason);
      }
    }
    const raw = source['final.txt'].toString('utf8');
    if (!exactly([...models], ['glm-5.3']) || !exactly(finishes, ['stop']) || content.join('') !== raw ||
        usage?.prompt_tokens !== transport.input_tokens || usage?.completion_tokens !== transport.output_tokens ||
        usage?.total_tokens !== transport.input_tokens + transport.output_tokens) return null;
    final = closedCandidate(raw);
    if (!final || !validateCandidate(final.candidate)) return null;
  } catch { return null; }
  const normalizedFinalRef = resolve(runDirectory, 'generation-normalized-final.json');
  const receiptRef = resolve(runDirectory, 'generation-final-recovery.json');
  const provenance = { version: 1, kind: 'single-eof-root-close', requestId: binding.requestId,
    runDirectory, bindingSha256, originalReceiptSha256: digest(source['generation-receipt.json']),
    originalFinalSha256: digest(source['final.txt']), upstreamRequestSha256: digest(source['upstream-request.json']),
    upstreamResponseSha256: digest(source['upstream-response.json']),
    normalizedFinalSha256: digest(final.normalized), normalizedFinalRef, receiptRef,
    argumentsSha256: digest(JSON.stringify(final.candidate.arguments)),
    workJsonSha256: typeof final.candidate.arguments.workJson === 'string'
      ? digest(final.candidate.arguments.workJson) : null,
    modelVersion: 'glm-5.3', modelRequests: 1, inputTokens: transport.input_tokens,
    outputTokens: transport.output_tokens, durationMs: transport.duration_ms };
  const derived = { ...provenance, candidate: final.candidate };
  await publish(normalizedFinalRef, Buffer.from(final.normalized));
  await publish(receiptRef, Buffer.from(JSON.stringify(derived) + '\n'));
  return { candidate: final.candidate, provenance };
}
