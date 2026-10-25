import { createCodexGateway } from '../../../codex-evaluator/codex-generation.mjs';
import { canonicalJson } from './validate-payload.mjs';
import { validateSummaryRunBudget } from './derived-summary-native-gateway.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** This is a process receipt, not an OpenClaw native gateway receipt. Only
 * bounded audit metadata from the runner is allowed into the checkpoint. */
function runReceipt(transport) {
  if (!object(transport)) return null;
  return {
    codexExitCode: Number.isSafeInteger(transport.codex_exit_code) ? transport.codex_exit_code : null,
    closure: transport.closure === 'completed' ? 'COMPLETED' : 'UNKNOWN',
    terminalEvents: Array.isArray(transport.terminal_events)
      ? transport.terminal_events.slice(0, 8).map(value =>
        ['turn.completed', 'turn.failed', 'error', 'invalid_event_json'].includes(value) ? value : 'OTHER') : [],
    modelRequests: Number.isSafeInteger(transport.model_requests) ? transport.model_requests : null,
    upstreamModels: Array.isArray(transport.upstream_models)
      ? transport.upstream_models.slice(0, 8).map(value => value === 'glm-5.3' ? value : 'OTHER') : [],
    inputTokens: Number.isSafeInteger(transport.input_tokens) && transport.input_tokens >= 0 ? transport.input_tokens : null,
    outputTokens: Number.isSafeInteger(transport.output_tokens) && transport.output_tokens >= 0 ? transport.output_tokens : null,
    transportPassed: transport.transport_passed === true,
    structuredFinalToContract: transport.structured_final_to_contract === true,
    sourceConfigUnchanged: transport.source_config_unchanged === true,
    auditBounded: Array.isArray(transport.terminal_events) && transport.terminal_events.length <= 8 &&
      Array.isArray(transport.upstream_models) && transport.upstream_models.length <= 8,
  };
}

function runClosed(run) {
  return run?.codexExitCode === 0 && run.closure === 'COMPLETED' &&
    run.terminalEvents.length === 1 && run.terminalEvents[0] === 'turn.completed' &&
    run.modelRequests === 1 && canonicalJson(run.upstreamModels) === canonicalJson(['glm-5.3']) &&
    run.transportPassed === true && run.structuredFinalToContract === true && run.sourceConfigUnchanged === true &&
    run.auditBounded === true;
}

export function validateSummaryCodexReceipt(receipt, binding) {
  if (!object(binding) || binding.executor !== 'CODEX' || !object(receipt) ||
      canonicalJson(Object.keys(receipt).sort()) !== canonicalJson(['attemptRef', 'executor', 'runs', 'closed'].sort()) ||
      receipt.executor !== 'CODEX' || receipt.attemptRef !== binding.attemptRef ||
      !Array.isArray(receipt.runs) || receipt.runs.length > binding.maxModelRequests ||
      typeof receipt.closed !== 'boolean' ||
      receipt.runs.some(run => !object(run) ||
        canonicalJson(Object.keys(run).sort()) !== canonicalJson(['codexExitCode', 'closure', 'terminalEvents',
          'modelRequests', 'upstreamModels', 'inputTokens', 'outputTokens', 'transportPassed',
          'structuredFinalToContract', 'sourceConfigUnchanged', 'auditBounded'].sort()) ||
        !Array.isArray(run.terminalEvents) || !Array.isArray(run.upstreamModels)) ||
      (receipt.closed && (receipt.runs.length === 0 || !receipt.runs.every(runClosed))))
    throw new Error('DERIVED_SUMMARY_CODEX_RECEIPT_INVALID');
  return receipt;
}

/** A fresh session may run several bounded, one-request Codex processes. A
 * missing child callback or uncertain completion never produces closure proof. */
export function createSummaryCodexGatewaySession(options) {
  validateSummaryRunBudget(options.runBudget);
  if (!object(options.codexOptions)) throw new Error('DERIVED_SUMMARY_CODEX_CONFIG_REQUIRED');
  const { checkpoint } = options;
  let binding = null;
  let pending = false;
  let unknown = false;
  let runs = [];
  return {
    request: async init => {
      if (!binding) {
        if (await checkpoint.readOptional('summary-codex.started'))
          throw new Error('DERIVED_SUMMARY_CODEX_REARM_REQUIRES_NEW_REQUEST');
        if ((!!options.matterId) === (!!options.summaryId)) throw new Error('DERIVED_SUMMARY_CODEX_SUBJECT_INVALID');
        const startedAt = Date.now();
        binding = { executor: 'CODEX', attemptRef: options.attemptRef,
          subject: options.matterId ? { kind: 'ENGINEERING_MATTER', matterId: options.matterId }
            : { kind: 'DERIVED_SUMMARY', summaryId: options.summaryId },
          executionModel: options.executionModel, taskDeadlineAt: options.deadlineAt,
          startedAt: new Date(startedAt).toISOString(),
          deadlineAt: new Date(Math.min(startedAt + options.runBudget.timeoutMs, Date.parse(options.deadlineAt))).toISOString(),
          maxModelRequests: options.runBudget.maxModelRequests };
        await checkpoint.writeOnce('summary-codex.started', binding);
        await options.onStarted?.(binding);
      }
      if (pending || unknown || runs.length >= binding.maxModelRequests)
        throw new Error('DERIVED_SUMMARY_CODEX_PROCESS_UNVERIFIED');
      pending = true;
      let observed = false;
      const onRunCompleted = async ({ transport }) => {
        if (observed) { unknown = true; return; }
        observed = true;
        const receipt = runReceipt(transport);
        if (!receipt) { unknown = true; return; }
        runs.push(receipt);
        if (!runClosed(receipt)) unknown = true;
      };
      try {
        const remainingMs = Math.max(1, Math.min(Date.parse(binding.deadlineAt) - Date.now(), 2_147_483_647));
        const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(remainingMs)])
          : AbortSignal.timeout(remainingMs);
        const request = options.requestGateway ?? createCodexGateway({ ...options.codexOptions, onRunCompleted,
          reasoningEffort: options.runBudget.reasoningEffort,
          maxOutputTokens: Math.min(options.codexOptions.maxOutputTokens ?? options.runBudget.maxCompletionTokens,
            options.runBudget.maxCompletionTokens, 32_768),
          timeoutSeconds: Math.max(1, Math.min(options.codexOptions.timeoutSeconds ?? 3600,
            Math.ceil(remainingMs / 1000))) });
        const response = await request(null, { ...init, signal }, { onRunCompleted });
        if (!observed || !runClosed(runs.at(-1))) {
          unknown = true;
          throw new Error('DERIVED_SUMMARY_CODEX_PROCESS_UNVERIFIED');
        }
        return response;
      } catch (error) {
        if (!observed) unknown = true;
        throw error;
      } finally { pending = false; }
    },
    close: async () => {
      if (!binding) return;
      const receipt = { executor: 'CODEX', attemptRef: binding.attemptRef, runs,
        closed: !pending && !unknown && runs.length > 0 && runs.every(runClosed) };
      validateSummaryCodexReceipt(receipt, binding);
      await checkpoint.write('summary-codex.receipt', receipt);
    },
  };
}
