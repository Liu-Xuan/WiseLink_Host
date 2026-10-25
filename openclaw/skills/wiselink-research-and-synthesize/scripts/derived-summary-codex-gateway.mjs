import { createHash } from 'node:crypto';
import { createCodexGateway } from '../../../codex-evaluator/codex-generation.mjs';
import { canonicalJson } from './validate-payload.mjs';
import { validateSummaryRunBudget } from './derived-summary-native-gateway.mjs';
import { codexParentRunRecorder } from './model-executor.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
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
  let durableRound = null;
  let recoverRound = false;
  return {
    setRound: (round, recoverOnly = false) => {
      if (!options.durableRounds || !Number.isSafeInteger(round) || round < 0 ||
          typeof recoverOnly !== 'boolean') throw new Error('DERIVED_SUMMARY_CODEX_ROUND_INVALID');
      durableRound = round;
      recoverRound = recoverOnly;
    },
    request: async init => {
      if (!binding) {
        const priorStarted = await checkpoint.readOptional('summary-codex.started');
        if (priorStarted && !options.durableRounds)
          throw new Error('DERIVED_SUMMARY_CODEX_REARM_REQUIRES_NEW_REQUEST');
        if (options.durableRounds && durableRound === null)
          throw new Error('DERIVED_SUMMARY_CODEX_ROUND_INVALID');
        if ((!!options.matterId) === (!!options.summaryId)) throw new Error('DERIVED_SUMMARY_CODEX_SUBJECT_INVALID');
        const startedAt = Date.now();
        binding = { executor: 'CODEX', attemptRef: options.attemptRef,
          subject: options.matterId ? { kind: 'ENGINEERING_MATTER', matterId: options.matterId }
            : { kind: 'DERIVED_SUMMARY', summaryId: options.summaryId },
          executionModel: options.executionModel, taskDeadlineAt: options.deadlineAt,
          startedAt: new Date(startedAt).toISOString(),
          deadlineAt: new Date(Math.min(startedAt + options.runBudget.timeoutMs, Date.parse(options.deadlineAt))).toISOString(),
          maxModelRequests: options.runBudget.maxModelRequests };
        if (priorStarted) {
          const stable = ({ startedAt, deadlineAt, ...rest }) => rest;
          if (priorStarted.recoveryVersion !== 1 ||
              canonicalJson(stable(priorStarted)) !== canonicalJson({ ...stable(binding), recoveryVersion: 1 }))
            throw new Error('DERIVED_SUMMARY_CODEX_BINDING_INVALID');
          binding = priorStarted;
        } else {
          if (options.durableRounds) binding.recoveryVersion = 1;
          await checkpoint.writeOnce('summary-codex.started', binding);
          await options.onStarted?.(binding);
        }
        if (options.durableRounds) {
          const priorReceipt = await checkpoint.readOptional('summary-codex.receipt');
          if (priorReceipt) validateSummaryCodexReceipt(priorReceipt, binding);
          runs = [];
          for (let index = 0; index < durableRound; index += 1) {
            const previous = await checkpoint.readOptional(`summary-codex.round-${index}.receipt`);
            if (!previous || !runClosed(previous) ||
                (priorReceipt && canonicalJson(priorReceipt.runs[index]) !== canonicalJson(previous)))
              throw new Error('DERIVED_SUMMARY_CODEX_RECEIPT_BINDING_MISMATCH');
            runs.push(previous);
          }
          if (priorReceipt && priorReceipt.runs.length > durableRound + 1)
            throw new Error('DERIVED_SUMMARY_CODEX_RECEIPT_BINDING_MISMATCH');
        }
      }
      if (pending || unknown || runs.length >= binding.maxModelRequests)
        throw new Error('DERIVED_SUMMARY_CODEX_PROCESS_UNVERIFIED');
      pending = true;
      let roundStarted = null;
      if (options.durableRounds) {
        const key = `summary-codex.round-${durableRound}`;
        const expected = { requestId: `${options.summaryId ? 'summary' : 'matter'}:${options.summaryId ?? options.matterId}:${options.attemptRef}:round-${durableRound + 1}`,
          bodySha256: sha256(init.body), round: durableRound };
        const proposedTimeoutSeconds = Math.max(1, Math.min(options.codexOptions.timeoutSeconds ?? 3600,
          Math.ceil(Math.max(1, Date.parse(binding.deadlineAt) - Date.now()) / 1000)));
        roundStarted = await checkpoint.readOptional(`${key}.started`);
        const { timeoutSeconds: _timeoutSeconds, ...stable } = roundStarted ?? {};
        if (roundStarted && (canonicalJson(stable) !== canonicalJson(expected) ||
            !Number.isSafeInteger(roundStarted.timeoutSeconds) || roundStarted.timeoutSeconds < 1))
          throw new Error('DERIVED_SUMMARY_CODEX_ROUND_BINDING_MISMATCH');
        if (!roundStarted) {
          if (recoverRound) throw new Error('CODEX_GENERATION_OUTCOME_UNKNOWN');
          roundStarted = { ...expected, timeoutSeconds: proposedTimeoutSeconds };
          await checkpoint.writeOnce(`${key}.started`, roundStarted);
        }
      }
      let observed = false;
      const onRunCompleted = async ({ transport }) => {
        if (observed) { unknown = true; return; }
        observed = true;
        const receipt = runReceipt(transport);
        if (!receipt) { unknown = true; return; }
        if (options.durableRounds) {
          const key = `summary-codex.round-${durableRound}.receipt`;
          const previous = await checkpoint.readOptional(key);
          if (previous && canonicalJson(previous) !== canonicalJson(receipt)) {
            unknown = true;
            return;
          }
          if (!previous) await checkpoint.writeOnce(key, receipt);
        }
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
          timeoutSeconds: roundStarted?.timeoutSeconds ?? Math.max(1, Math.min(options.codexOptions.timeoutSeconds ?? 3600,
            Math.ceil(remainingMs / 1000))) });
        const response = await request(null, { ...init, signal,
          ...(roundStarted ? { codexRecovery: { requestId: roundStarted.requestId,
            recoverOnly: recoverRound,
            onRunPrepared: codexParentRunRecorder(checkpoint,`summary-codex.round-${durableRound}`,
              {requestId:roundStarted.requestId,argsHash:roundStarted.bodySha256}) } } : {}) }, { onRunCompleted });
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
      if (!binding && options.durableRounds) {
        const prior = await checkpoint.readOptional('summary-codex.started');
        if (prior) {
          if (prior.recoveryVersion !== 1 || prior.executor !== 'CODEX' ||
              prior.attemptRef !== options.attemptRef ||
              canonicalJson(prior.subject) !== canonicalJson(options.summaryId
                ? { kind: 'DERIVED_SUMMARY', summaryId: options.summaryId }
                : { kind: 'ENGINEERING_MATTER', matterId: options.matterId }) ||
              canonicalJson(prior.executionModel) !== canonicalJson(options.executionModel) ||
              prior.taskDeadlineAt !== options.deadlineAt)
            throw new Error('DERIVED_SUMMARY_CODEX_BINDING_INVALID');
          binding = prior;
          runs = [];
          for (let index = 0; index < binding.maxModelRequests; index += 1) {
            const started = await checkpoint.readOptional(`summary-codex.round-${index}.started`);
            const completed = await checkpoint.readOptional(`summary-codex.round-${index}.receipt`);
            if (!started && !completed) break;
            if (!started || !completed || !runClosed(completed)) {
              unknown = true;
              break;
            }
            runs.push(completed);
          }
        }
      }
      if (!binding) return;
      const receipt = { executor: 'CODEX', attemptRef: binding.attemptRef, runs,
        closed: !pending && !unknown && runs.length > 0 && runs.every(runClosed) };
      validateSummaryCodexReceipt(receipt, binding);
      await checkpoint.write('summary-codex.receipt', receipt);
    },
  };
}
