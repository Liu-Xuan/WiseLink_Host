import { setTimeout as wait } from 'node:timers/promises';
import { WISELINK_PROFILE_REF } from './validate-payload.mjs';

const GATEWAY_RECEIPT_FIELDS = new Set(['attemptRef', 'modelId', 'maxCompletionTokens', 'maxModelRequests',
  'dispatches', 'activeOrdinal', 'unknownTerminal', 'absoluteDeadline', 'upstreamDispatchCount', 'upstreamHttpStatus',
  'transportCompleted', 'providerStopConfirmed', 'outcome', 'finishedAt', 'tempSecretScan', 'providerTimeout',
  'expectedReasoningEffort', 'observedReasoningEffort', 'observedThinkingMode']);
const DISPATCH_FIELDS = new Set(['ordinal', 'upstreamHttpStatus', 'actualCompletionTokens', 'transportCompleted',
  'providerKnownTerminal', 'finishReason', 'terminalObservation', 'outcome']);
const OBSERVATION_FIELDS = new Set(['contentTypeClass', 'parseCode', 'bodyBytes', 'chunkCount',
  'totalExceededLegacyLimit', 'eventOverflow', 'eventCount', 'dataEventCount', 'reasoningDeltaEvents',
  'reasoningDeltaChars', 'contentDeltaEvents', 'contentDeltaChars', 'toolArgDeltaEvents', 'toolArgDeltaChars',
  'doneObserved', 'doneFinal', 'finishReason', 'lineEndingKind', 'firstChunkMs', 'lastChunkMs', 'endMs']);
const integer = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fixedString = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]*$/u.test(value) && value.length <= 80;

export function validateSummaryRunBudget(budget) {
  if (!object(budget) || ![budget.timeoutMs, budget.maxCompletionTokens, budget.maxModelRequests].every(integer) ||
      !['low', 'high', 'max'].includes(budget.reasoningEffort) ||
      (budget.providerTimeoutSeconds !== undefined && !integer(budget.providerTimeoutSeconds)))
    throw new Error('DERIVED_SUMMARY_RUN_BUDGET_REQUIRED');
  return budget;
}

/** Retains A12b provider terminal proof; no response text, headers or credentials
 * can enter this durable receipt. The adapter remains the original implementation. */
export function validateSummaryGatewayReceipt(receipt, binding, { terminal = false, closed = false } = {}) {
  if (!object(receipt) || Object.keys(receipt).some(key => !GATEWAY_RECEIPT_FIELDS.has(key)) ||
      receipt.attemptRef !== binding.attemptRef || receipt.modelId !== 'glm-5.3' ||
      receipt.maxCompletionTokens !== binding.maxCompletionTokens || receipt.maxModelRequests !== binding.maxModelRequests ||
      receipt.absoluteDeadline !== binding.deadlineAt || receipt.expectedReasoningEffort !== binding.reasoningEffort ||
      !Number.isSafeInteger(receipt.upstreamDispatchCount) || receipt.upstreamDispatchCount < 0 ||
      receipt.upstreamDispatchCount > binding.maxModelRequests || !Array.isArray(receipt.dispatches) ||
      receipt.dispatches.length !== receipt.upstreamDispatchCount || typeof receipt.unknownTerminal !== 'boolean' ||
      typeof receipt.providerStopConfirmed !== 'boolean' || typeof receipt.transportCompleted !== 'boolean' ||
      !fixedString(receipt.outcome) ||
      ![null, 'LOW', 'HIGH', 'MAX', 'ABSENT', 'OTHER'].includes(receipt.observedReasoningEffort) ||
      ![null, 'ABSENT', 'ENABLED', 'DISABLED'].includes(receipt.observedThinkingMode))
    throw new Error('DERIVED_SUMMARY_GATEWAY_RECEIPT_INVALID');
  for (const [index, dispatch] of receipt.dispatches.entries()) {
    if (!object(dispatch) || Object.keys(dispatch).some(key => !DISPATCH_FIELDS.has(key)) || dispatch.ordinal !== index + 1 ||
        !integer(dispatch.actualCompletionTokens) || dispatch.actualCompletionTokens > binding.maxCompletionTokens ||
        typeof dispatch.transportCompleted !== 'boolean' || typeof dispatch.providerKnownTerminal !== 'boolean' ||
        ![null, 'stop', 'tool_calls', 'length', 'content_filter'].includes(dispatch.finishReason) || !fixedString(dispatch.outcome))
      throw new Error('DERIVED_SUMMARY_GATEWAY_RECEIPT_INVALID');
    const observation = dispatch.terminalObservation;
    if (observation !== undefined && observation !== null && (!object(observation) ||
        Object.keys(observation).some(key => !OBSERVATION_FIELDS.has(key)) || Object.values(observation).some(value =>
          !(value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && value >= 0) ||
            (typeof value === 'string' && (/^[A-Z][A-Z0-9_]*$/u.test(value) || ['stop', 'tool_calls', 'length', 'content_filter'].includes(value)))))))
      throw new Error('DERIVED_SUMMARY_GATEWAY_RECEIPT_INVALID');
  }
  if (receipt.providerTimeout !== undefined && (!object(receipt.providerTimeout) ||
      Object.keys(receipt.providerTimeout).some(key => !['sourceSeconds', 'callerSeconds', 'effectiveSeconds'].includes(key)) ||
      !integer(receipt.providerTimeout.sourceSeconds) || !integer(receipt.providerTimeout.effectiveSeconds) ||
      !(receipt.providerTimeout.callerSeconds === null || integer(receipt.providerTimeout.callerSeconds))))
    throw new Error('DERIVED_SUMMARY_GATEWAY_RECEIPT_INVALID');
  if (closed && (receipt.tempSecretScan?.complete !== true || receipt.tempSecretScan?.found !== false))
    throw new Error('DERIVED_SUMMARY_GATEWAY_CLEANUP_UNVERIFIED');
  if (terminal && (receipt.unknownTerminal || receipt.activeOrdinal !== null || receipt.upstreamDispatchCount < 1 ||
      receipt.providerStopConfirmed !== true || receipt.transportCompleted !== true ||
      receipt.observedReasoningEffort !== binding.reasoningEffort.toUpperCase() ||
      receipt.observedThinkingMode === 'DISABLED' ||
      receipt.dispatches.some(dispatch => !dispatch.transportCompleted || !dispatch.providerKnownTerminal ||
        !( ['stop', 'tool_calls'].includes(dispatch.finishReason) ||
          (dispatch.finishReason === null && [429, 503].includes(dispatch.upstreamHttpStatus))))))
    throw new Error('DERIVED_SUMMARY_PROVIDER_TERMINAL_UNVERIFIED');
  return receipt;
}

/** Prepares lazily, so a saved response can re-run its exact Host read without
 * launching a new provider. The original A12b marker still forbids rearming an
 * attempt after preparation/dispatch uncertainty. A new Host request is required. */
export function createSummaryGatewaySession(options) {
  validateSummaryRunBudget(options.runBudget);
  const { checkpoint, prepareGateway } = options;
  if (typeof prepareGateway !== 'function') throw new Error('DERIVED_SUMMARY_NATIVE_GATEWAY_REQUIRED');
  let prepared = null; let binding = null;
  return {
    request: async init => {
      if (!prepared) {
        if (await checkpoint.readOptional('summary-gateway.started'))
          throw new Error('DERIVED_SUMMARY_GATEWAY_REARM_REQUIRES_NEW_REQUEST');
        const startedAt = Date.now();
        const deadlineAt = Math.min(startedAt + options.runBudget.timeoutMs, Date.parse(options.deadlineAt));
        if ((!!options.matterId) === (!!options.summaryId)) throw new Error('DERIVED_SUMMARY_GATEWAY_SUBJECT_INVALID');
        binding = { attemptRef: options.attemptRef, subject: options.matterId ? { kind: 'ENGINEERING_MATTER', matterId: options.matterId }
          : { kind: 'DERIVED_SUMMARY', summaryId: options.summaryId },
          nativeSessionKey: `agent:${WISELINK_PROFILE_REF}:${options.matterId ? 'matter' : 'summary'}:${options.matterId ?? options.summaryId}:${options.attemptRef}`,
          executionModel: options.executionModel, startedAt: new Date(startedAt).toISOString(),
          taskDeadlineAt: options.deadlineAt, deadlineAt: new Date(deadlineAt).toISOString(), ...options.runBudget };
        await checkpoint.writeOnce('summary-gateway.started', binding);
        prepared = await prepareGateway({ ...binding, signal: init.signal });
        if (!prepared || typeof prepared.close !== 'function' || typeof prepared.getSanitizedReceipt !== 'function' ||
            typeof prepared.gatewayUrl !== 'string' || typeof prepared.gatewayToken !== 'string')
          throw new Error('DERIVED_SUMMARY_NATIVE_GATEWAY_INVALID');
      }
      const signal = AbortSignal.any([init.signal, AbortSignal.timeout(Math.max(1,
        Math.min(Date.parse(binding.deadlineAt) - Date.now(), 2_147_483_647)))]);
      const request = { ...init, headers: { ...init.headers, authorization: `Bearer ${prepared.gatewayToken}` }, signal };
      const response = await options.requestGateway(new URL('/v1/chat/completions', prepared.gatewayUrl), request);
      const raw = await response.text();
      let receipt = prepared.getSanitizedReceipt();
      while (receipt.activeOrdinal !== null && !receipt.unknownTerminal && Date.now() + 5 < Date.parse(binding.deadlineAt)) {
        await wait(5, undefined, { signal }); receipt = prepared.getSanitizedReceipt();
      }
      validateSummaryGatewayReceipt(receipt, binding, { terminal: response.ok });
      if (!response.ok && (receipt.unknownTerminal || receipt.activeOrdinal !== null ||
          receipt.dispatches.some(dispatch => !dispatch.transportCompleted || !dispatch.providerKnownTerminal)))
        throw new Error('DERIVED_SUMMARY_PROVIDER_TERMINAL_UNVERIFIED');
      return { status: response.status, ok: response.ok, text: async () => raw, providerReceipt: receipt };
    },
    close: async () => {
      if (!prepared) return;
      await prepared.close();
      const receipt = validateSummaryGatewayReceipt(prepared.getSanitizedReceipt(), binding, { closed: true });
      await checkpoint.write('summary-gateway.receipt', receipt);
    },
  };
}
