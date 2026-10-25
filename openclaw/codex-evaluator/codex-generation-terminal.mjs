import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const exactly = (value, expected) => Array.isArray(value) && value.length === expected.length &&
  value.every((item, index) => item === expected[index]);

/** Called only after the gateway validates the original binding, private prompt,
 * receipt binding hash, and exact durable transport/candidate agreement. */
export async function outputLengthFailure({ runDirectory, binding, receipt, transport, candidate }) {
  if (transport.transport_passed !== false || transport.timed_out !== false ||
      transport.failure !== null || transport.closure !== 'incomplete' ||
      transport.process_group_closed !== true || transport.process_group_had_members !== false ||
      transport.model_requests !== 1 || !exactly(transport.upstream_models, ['glm-5.3']) ||
      !exactly(transport.bridge_errors, ['upstream_output_length']) ||
      transport.structured_final_to_contract !== false || Object.keys(candidate).length !== 0 ||
      transport.upstream_request_present !== true || transport.upstream_response_present !== false ||
      transport.upstream_response_sha256 !== null || receipt.upstream_response_sha256 !== null ||
      transport.source_config_unchanged !== true ||
      !/^[0-9a-f]{64}$/u.test(transport.source_config_sha256_before ?? '') ||
      transport.source_config_sha256_before !== transport.source_config_sha256_after ||
      ![transport.input_tokens, transport.output_tokens, transport.duration_ms].every(nonnegativeInteger) ||
      transport.output_tokens === 0) return null;
  let audit, requestRaw, request;
  try {
    for (const name of ['contract-candidate.json', 'upstream-response.json', 'adapted-response.json']) {
      try { await stat(resolve(runDirectory, name)); return null; }
      catch (error) { if (error?.code !== 'ENOENT') return null; }
    }
    audit = (await readFile(resolve(runDirectory, 'bridge.audit.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line));
    requestRaw = await readFile(resolve(runDirectory, 'upstream-request.json'));
    request = JSON.parse(requestRaw.toString('utf8'));
  } catch { return null; }
  const requestSha256 = createHash('sha256').update(requestRaw).digest('hex');
  if (receipt.upstream_request_sha256 !== requestSha256 ||
      transport.upstream_request_sha256 !== requestSha256 ||
      !record(request) || request.model !== 'glm-5.3' ||
      !Number.isSafeInteger(request.max_tokens) || request.max_tokens < 1 ||
      request.max_tokens > binding.maxOutputTokens || audit.length !== 1 || !record(audit[0])) return null;
  const row = audit[0];
  if (row.route !== '/v1/responses' || row.model !== 'glm-5.3' || row.status !== 502 ||
      row.upstream_attempted !== true || !exactly(row.upstream_models, ['glm-5.3']) ||
      row.error_code !== 'upstream_output_length' || row.error_type !== 'Rejected' ||
      row.error_phase !== 'upstream_stream' || row.finish_reason !== 'length' ||
      row.tools !== 0 || row.tool_calls !== 0 || row.tool_results !== 0 || !record(row.usage) ||
      row.usage.input_tokens !== transport.input_tokens ||
      row.usage.output_tokens !== transport.output_tokens ||
      !nonnegativeInteger(row.usage.total_tokens) ||
      row.usage.total_tokens !== transport.input_tokens + transport.output_tokens) return null;
  return { code: 'JOBAID_MODEL_OUTPUT_LENGTH', requestId: binding.requestId, runDirectory,
    transportSummaryRef: resolve(runDirectory, 'transport-summary.json'), modelVersion: 'glm-5.3',
    inputTokens: transport.input_tokens, outputTokens: transport.output_tokens,
    durationMs: transport.duration_ms };
}
