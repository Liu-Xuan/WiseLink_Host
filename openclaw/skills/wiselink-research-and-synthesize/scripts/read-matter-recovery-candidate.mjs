import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { canonicalSha256 } from './validate-payload.mjs';
import { createCheckpointStore, parseStrictJsonObject } from './run-hosted-review-turn.mjs';
import { classifyHostedGatewayFailure } from './request-hosted-gateway.mjs';

/** The Host authorizes the successor and exact prior input. This reads the
 * actual completed response without altering or replaying the failed task. */
export async function readMatterRecoveryCandidate({ checkpointRoot, matterId, recovery, executionModel }) {
  const store = await createCheckpointStore(join(checkpointRoot, 'matter', encodeURIComponent(matterId), encodeURIComponent(recovery.attemptRef)));
  const binding = await store.readOptional('binding');
  const enabled = await store.readOptional('assessment-enabled');
  const state = await store.readOptional('assessment-state');
  const invocation = await store.readOptional('assessment-invocation');
  if (binding?.matterId !== matterId || binding.attemptRef !== recovery.attemptRef || binding.inputHash !== recovery.inputHash ||
      enabled?.version !== 1 || enabled.binding?.operation !== 'ASSESS_MATTER' ||
      !isDeepStrictEqual(enabled.binding.executionModel, executionModel) ||
      !isDeepStrictEqual(enabled.binding.modelInput, invocation?.modelInput) ||
      enabled.binding.sessionDiscriminator !== invocation?.sessionDiscriminator ||
      !Number.isSafeInteger(state?.round) || state.round < 1 || state.round > 64)
    throw new Error('MATTER_RECOVERY_CHECKPOINT_BINDING_MISMATCH');
  const response = await store.readOptional(`assessment-round-${state.round}.result`);
  if (!response) throw new Error('MATTER_RECOVERY_MODEL_RESULT_UNKNOWN');
  const args = { operation: enabled.binding.operation, messages: state.messages,
    executionModel, sessionDiscriminator: invocation.sessionDiscriminator,
    ...(enabled.generationPolicy ? { generationPolicy: enabled.generationPolicy, scopeAdjustments: state.scopeAdjustments ?? 0 } : {}) };
  if (response.argsHash !== canonicalSha256(args))
    throw new Error('MATTER_RECOVERY_RESPONSE_BINDING_MISMATCH');
  const payload = parseStrictJsonObject(response.value.raw);
  if (response.value?.ok !== true) {
    const failure = classifyHostedGatewayFailure(payload);
    const ended = (response.value?.status === 502 && failure === 'TOOL_CHOICE_NOT_SATISFIED') ||
      (response.value?.status === 400 && failure === 'INCOMPLETE_TERMINAL_RESPONSE');
    if (!ended) throw new Error('MATTER_RECOVERY_MODEL_RESULT_UNKNOWN');
    // No candidate is recovered or replayed. The successor receives only the
    // current Host-authorized work and evidence copied by reserveJobAid.
    // A generic 502, lost response or uncertain SAVE must not enter this path.
    return { ...recovery, round: state.round, mode: 'SOURCE_CONTEXT_ONLY' };
  }
  const call = payload.choices?.[0]?.message?.tool_calls?.[0];
  if (payload.choices?.length !== 1 || payload.choices[0].finish_reason !== 'tool_calls' || payload.choices[0].message?.tool_calls?.length !== 1 ||
      call?.function?.name !== 'return_wiselink_assessment_step') throw new Error('MATTER_RECOVERY_SAVE_RESPONSE_REQUIRED');
  const step = parseStrictJsonObject(call.function.arguments).step;
  if (!['SAVE_WORK', 'FINISH'].includes(step?.action) || typeof step.workJson !== 'string')
    throw new Error('MATTER_RECOVERY_SAVE_RESPONSE_REQUIRED');
  return { ...recovery, round: state.round, mode: 'COMPLETE_CANDIDATE', response: response.value };
}
