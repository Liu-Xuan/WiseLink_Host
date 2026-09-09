import { jobAidWorkTypeErrors, jobAidWorkDependencyErrors, JOBAID_STEP_SHAPE, decodeJobAidStep } from './jobaid-work-shape.mjs';
import { randomUUID } from 'node:crypto';
import {
  M3_MAX_COMPLETION_TOKENS,
  actualModelVersion,
  assertHostedModelGatewayReady,
  executionModelHeaders,
  isFunctionResponseContentSupported,
  parseStrictJsonObject,
  summarizeHostedReviewModelOutputShape,
} from './run-hosted-review-turn.mjs';
import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_PROFILE_REF,
  WISELINK_SKILL_VERSION,
} from './validate-payload.mjs';
import { requestHostedGateway } from './request-hosted-gateway.mjs';

export const JOBAID_PROBLEM_TASK_SCHEMA = 'wiselink.jobaid-problem-task.v2';
const FUNCTION = 'return_wiselink_assessment_step';
import { JOBAID_PROBLEM_GUIDANCE as GUIDE } from './jobaid-problem-guidance.mjs';

export function validateJobAidProblemInput(input) {
  if (
    !input ||
    input.schemaVersion !== JOBAID_PROBLEM_TASK_SCHEMA ||
    !['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY'].includes(
      input.purpose,
    ) ||
    !input.methodBinding?.packRef ||
    !Array.isArray(input.availableSources) ||
    !Array.isArray(input.deliveredEvidence) ||
    !Number.isSafeInteger(input.expectedWorkRevision) ||
    input.expectedWorkRevision < 0
  )
    throw new Error('JOBAID_PROBLEM_INPUT_INVALID');
  const refs = input.availableSources.map((source) => source.ref);
  if (
    new Set(refs).size !== refs.length ||
    refs.some((ref) => typeof ref !== 'string' || !ref) ||
    input.deliveredEvidence.some((item) => !refs.includes(item.evidenceRef))
  )
    throw new Error('JOBAID_PROBLEM_SOURCE_CATALOG_INVALID');
  return input;
}

/** Read/save intents are executed by existing Host callbacks, never by the model. */
export async function invokeHostedJobAidProblemModel(
  { operation, modelInput },
  options,
  dependencies = {},
) {
  validateJobAidProblemInput(modelInput);
  assertHostedModelGatewayReady(options);
  if (
    !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) ||
    typeof options.readAssessmentSources !== 'function' ||
    typeof options.saveAssessmentWork !== 'function' ||
    typeof options.readAssessmentWork !== 'function' ||
    !options.sessionDiscriminator
  )
    throw new Error('JOBAID_PROBLEM_RUNTIME_CAPABILITY_REQUIRED');
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const systemMessage = { role: 'system', content: GUIDE };
  let messages = [
    systemMessage,
    { role: 'user', content: JSON.stringify(modelInput) },
  ];
  let expectedWorkRevision = modelInput.expectedWorkRevision;
  let saved = modelInput.previousWork
    ? {
        workRevisionRef: modelInput.previousWork.workRevisionRef,
        workRevision: modelInput.previousWork.workRevision,
        roundCompletion: modelInput.previousWork.content.roundCompletion,
      }
    : null;
  let corrections = 0;
  let inputUnits = 0;
  let outputUnits = 0;
  const save = async (work) => {
    const requestId = `JA-save-${randomUUID()}`;
    const args = {
      requestId,
      expectedWorkRevision,
      workJson: JSON.stringify(work),
    };
    let result;
    try {
      result = await options.saveAssessmentWork(args);
    } catch (error) {
      // Unknown save response: read the same request first. Never change its
      // request ID or regenerate an already-persisted analysis to recover it.
      const readback = await options.readAssessmentWork({ requestId });
      if (!readback?.revision || readback.revision.requestId !== requestId)
        throw error;
      result = {
        workRevisionRef: readback.revision.workRevisionRef,
        workRevision: readback.revision.workRevision,
        roundCompletion: readback.revision.content.roundCompletion,
        replayed: true,
      };
    }
    if (
      !result?.workRevisionRef ||
      result.workRevision !== expectedWorkRevision + 1 ||
      !['IN_PROGRESS', 'COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'].includes(
        result.roundCompletion,
      )
    )
      throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
    expectedWorkRevision = result.workRevision;
    saved = result;
    return result;
  };
  for (let round = 1; round <= 64; round += 1) {
    await options.heartbeat?.();
    const remainingMs = timeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
    inputUnits += Buffer.byteLength(JSON.stringify(messages));
    const requestedModel = `openclaw/${WISELINK_PROFILE_REF}`;
    const response = await (
      dependencies.requestGateway ?? requestHostedGateway
    )(new URL('/v1/chat/completions', options.gatewayUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${options.gatewayToken}`,
        ...executionModelHeaders(options),
      },
      body: JSON.stringify({
        model: requestedModel,
        user: `initial:${options.sessionDiscriminator}`,
        messages,
        tools: [
          {
            type: 'function',
            function: {
              name: FUNCTION,
              description:
                'Return one source-read, substantive-work-save, or finish intent. The deterministic Host caller executes it.',
              parameters: {
                type: 'object',
                additionalProperties: false,
                required: ['step'],
                properties: { step: JOBAID_STEP_SHAPE },
              },
            },
          },
        ],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        n: 1,
        stream: false,
        ...(options.executionModel?.modelRef === 'miaoda/minimax-m3'
          ? { max_completion_tokens: M3_MAX_COMPLETION_TOKENS }
          : {}),
      }),
      signal: AbortSignal.timeout(Math.min(remainingMs, 15 * 60_000)),
    });
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024)
      throw new Error('JOBAID_MODEL_RESPONSE_TOO_LARGE');
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`JOBAID_GATEWAY_INVALID_JSON_HTTP_${response.status}`);
    }
    const shape = summarizeHostedReviewModelOutputShape({
      httpStatus: response.status,
      httpOk: response.ok,
      requestedModel,
      payload,
      expectedFunctionNames: [FUNCTION],
    });
    await options.observeModelOutput?.(
      {
        operation,
        round,
        httpStatus: response.status,
        finishReason: payload?.choices?.[0]?.finish_reason ?? null,
        inputTokens: payload?.usage?.prompt_tokens ?? null,
        outputTokens: payload?.usage?.completion_tokens ?? null,
        responseBytes: Buffer.byteLength(raw),
        outputChannel: shape.outputChannel,
      },
      round,
    );
    // The native profile can have tools. An outer candidate function does not
    // prove generation-only execution; an ambiguous 408/timeout is not retried.
    if (!response.ok) throw new Error(`JOBAID_GATEWAY_HTTP_${response.status}`);
    if (shape.hasAnalysis || payload.choices?.length !== 1)
      throw new Error('JOBAID_MODEL_OUTPUT_CHANNEL_INVALID');
    const choice = payload.choices[0];
    const message = choice?.message;
    const call = message?.tool_calls?.[0];
    if (
      !isFunctionResponseContentSupported(message?.content) ||
      message?.tool_calls?.length !== 1 ||
      call?.type !== 'function' ||
      call.function?.name !== FUNCTION ||
      typeof call.id !== 'string'
    )
      throw new Error('JOBAID_MODEL_OUTPUT_FUNCTION_INVALID');
    outputUnits += Buffer.byteLength(call.function.arguments);
    let receipt;
    let submittedWork;
    try {
      const args = parseStrictJsonObject(call.function.arguments);
      if (Object.keys(args).length !== 1 || !args.step || typeof args.step !== 'object' || Array.isArray(args.step))
        throw new Error('JOBAID_STEP_OBJECT_REQUIRED');
      const step = decodeJobAidStep(args.step);
      if (step.action === 'READ_SOURCES') {
        if (
          !Array.isArray(step.sourceRefs) ||
          !step.sourceRefs.length ||
          typeof step.purpose !== 'string' ||
          !['EXACT', 'PAGE'].includes(step.context)
        )
          throw new Error('JOBAID_SOURCE_STEP_INVALID');
        receipt = await options.readAssessmentSources({
          sourceRefs: step.sourceRefs,
          purpose: step.purpose,
          context: step.context,
        });
        if (receipt?.status !== 'AVAILABLE' || !Array.isArray(receipt.evidence))
          throw new Error('JOBAID_SOURCE_READ_FAILED');
      } else if (step.action === 'SAVE_WORK' || step.action === 'FINISH') {
        if (step.work !== undefined) {
          submittedWork = step.work;
          receipt = await save(step.work);
        }
        else if (step.action === 'SAVE_WORK')
          throw new Error('JOBAID_WORK_REQUIRED');
        if (step.action === 'FINISH') {
          if (!saved || saved.roundCompletion === 'IN_PROGRESS')
            throw new Error('JOBAID_COMPLETED_WORK_REQUIRED');
          if (
            modelInput.purpose === 'OVERALL_CONSISTENCY' &&
            (typeof step.consistencyCheck !== 'string' ||
              !step.consistencyCheck.trim())
          )
            throw new Error('JOBAID_OVERALL_CONSISTENCY_REQUIRED');
          return {
            output: {
              workRevisionRef: saved.workRevisionRef,
              ...(step.consistencyCheck
                ? { consistencyCheck: step.consistencyCheck }
                : {}),
            },
            provenance: {
              modelVersion: actualModelVersion(
                payload,
                choice,
                message,
                options.executionModel
                  ? `configured-route:${options.executionModel.modelRef}`
                  : options.configuredModelVersion,
              ),
              promptVersion: 'wiselink-jobaid-problem@v2',
              skillVersion: WISELINK_SKILL_VERSION,
              toolVersions: {
                [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
                'jobaid-problem-protocol': '2',
              },
              runMetrics: {
                durationMs: Date.now() - startedAt,
                inputUnits,
                outputUnits,
              },
            },
          };
        }
      } else throw new Error('JOBAID_STEP_ACTION_INVALID');
      corrections = 0;
    } catch (error) {
      const code = error?.hostErrorCode ?? error?.message ?? '';
      if (
        !/^JOBAID_[A-Z_]+(?::[A-Za-z0-9:_-]+)?$/u.test(code) ||
        /AUTHORIZATION|LEASE|REVISION_CONFLICT|VERSION_CHANGED|BUDGET|GATEWAY|READ_FAILED|ATTEMPT/.test(
          code,
        ) ||
        corrections >= 2
      )
        throw error;
      corrections += 1;
      receipt = {
        accepted: false,
        errorCode: code,
        expectedWorkRevision,
        instruction:
          'Correct only the rejected step or substantive work using the original evidence. Existing saved work remains available; never invent sources or turn failure into completion.',
        ...workShapeCorrection(code, submittedWork),
      };
      await options.observeCandidateRejection?.({
        correctionNo: corrections,
        code,
        ...(receipt.fieldErrors ? { fieldErrors: receipt.fieldErrors } : {}),
      });
    }
    // The configured Gateway resumes this native session's history. Keep one
    // copy of the context and earlier source bodies in that history.
    messages = [
      systemMessage,
      { role: 'assistant', content: null, tool_calls: [call] },
      {
        role: 'tool',
        tool_call_id: call.id,
        name: FUNCTION,
        content: JSON.stringify(receipt),
      },
    ];
  }
  throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
}

// Explain the existing Host rejection using types/positions only. The original
// work is still submitted unchanged and only the Host can accept a revision.
function workShapeCorrection(code, work) {
  if (!work) return {};
  const fieldErrors = [...jobAidWorkTypeErrors(work),
    ...(code === 'JOBAID_ISSUE_DEPENDENCY_MISSING' ? jobAidWorkDependencyErrors(work) : []),
  ];
  if (!fieldErrors.length) return {};
  return {
    fieldErrors,
    instruction:
      'Reconcile every reported citation with the same issue sourceDependencies or premiseRefs; include the exact already-used evidenceRef, including requirementHandling.methodRef. Do not remove supported statements to hide a missing dependency. Correct the reported field types using the original evidence and the work-update shape. conditions, limitations and basisRefs are arrays of strings; addresses is one non-empty string describing the problem or risk addressed. Preserve justified analysis and unknowns; do not invent content or remove substantive work merely to pass validation. The Host will validate the revised work.' +
      (code === 'JOBAID_MEASURE_ADDRESSES_INVALID'
        ? ' The rejected field is addresses; changing status does not repair it.'
        : ''),
  };
}
