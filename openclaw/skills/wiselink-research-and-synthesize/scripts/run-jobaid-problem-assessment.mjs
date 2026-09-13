import { jobAidWorkTypeErrors, jobAidWorkDependencyErrors, JOBAID_STEP_SHAPE, decodeJobAidStep, jobAidFunctionSchema } from './jobaid-work-shape.mjs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
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
import { classifyHostedGatewayFailure, requestHostedGateway } from './request-hosted-gateway.mjs';

export const JOBAID_PROBLEM_TASK_SCHEMA = 'wiselink.jobaid-problem-task.v2';
export const MATTER_JOBAID_TASK_SCHEMA = 'wiselink.matter-jobaid-task.v2';
const FUNCTION = 'return_wiselink_assessment_step';
const { work: _workShape, ...stepProperties } = JOBAID_STEP_SHAPE.properties;
const transportStepShape = {
  ...JOBAID_STEP_SHAPE,
  properties: { ...stepProperties, workJson: { type: 'string', minLength: 2,
    description: 'Complete work update encoded as JSON text. Preserve arrays, nulls and every original field.' } },
};

export function parseJobAidWorkJson(value) {
  let work;
  try { work = parseStrictJsonObject(value); }
  catch { throw new Error('JOBAID_WORK_JSON_INVALID'); }
  // JSON.parse accepts duplicate keys by discarding earlier values. Reject
  // those before submitting any model-authored material to the Host.
  const tokens = value.match(/"(?:[^"\\]|\\.)*"|[{}\[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gs);
  let index = 0;
  function visit() {
    const token = tokens[index++];
    if (token === '{') {
      const keys = new Set();
      while (tokens[index] !== '}') {
        const key = JSON.parse(tokens[index++]);
        if (keys.has(key)) throw new Error('JOBAID_WORK_JSON_DUPLICATE_KEY');
        keys.add(key);
        index++; // colon; syntax was already validated
        visit();
        if (tokens[index] === ',') index++;
      }
      index++;
    } else if (token === '[') {
      while (tokens[index] !== ']') {
        visit();
        if (tokens[index] === ',') index++;
      }
      index++;
    }
  }
  visit();
  return work;
}
import { JOBAID_PROBLEM_GUIDANCE as GUIDE } from './jobaid-problem-guidance.mjs';

export function validateJobAidProblemInput(input) {
  if (
    !input ||
    ![JOBAID_PROBLEM_TASK_SCHEMA, MATTER_JOBAID_TASK_SCHEMA].includes(input.schemaVersion) ||
    (input.schemaVersion === MATTER_JOBAID_TASK_SCHEMA
      ? input.subject?.kind !== 'ENGINEERING_MATTER' || !input.subject.matterId || !Array.isArray(input.availableDocuments)
      : !['INITIAL_PROBLEM_ASSESSMENT', 'OVERALL_CONSISTENCY'].includes(
      input.purpose,
    )) ||
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

// Keep provenance next to its readable source instead of sending each long
// evidence reference twice. The Host input and its bindings remain untouched.
export function projectJobAidModelInput(input) {
  if (!Array.isArray(input.contextPackage?.sourceOrigins)) return input;
  const sources = new Set(input.availableSources.map((source) => source.ref));
  const origins = new Map();
  const unmatched = [];
  for (const entry of input.contextPackage.sourceOrigins) {
    const { evidenceRef, ...origin } = entry;
    if (!sources.has(evidenceRef)) {
      unmatched.push(entry);
      continue;
    }
    const items = origins.get(evidenceRef) ?? [];
    items.push(origin);
    origins.set(evidenceRef, items);
  }
  const { sourceOrigins: _sourceOrigins, ...contextPackage } = input.contextPackage;
  return {
    ...input,
    availableSources: input.availableSources.map((source) => ({
      ...source,
      ...(origins.has(source.ref) ? { sourceOrigins: origins.get(source.ref) } : {}),
    })),
    contextPackage: {
      ...contextPackage,
      ...(unmatched.length ? { sourceOrigins: unmatched } : {}),
    },
  };
}

// A model may request more sources than one Host MCP call accepts. Preserve
// the entire intent, while each batch retains the Host's scope and lease checks.
export async function readJobAidSourceBatches(intent, read) {
  const batchSize = 96;
  if (intent.sourceRefs.length <= batchSize) return read(intent);
  if (new Set(intent.sourceRefs).size !== intent.sourceRefs.length)
    throw new Error('JOBAID_SOURCE_SELECTION_INVALID');
  let first;
  const sourceRefs = new Set();
  const evidence = new Map();
  for (let offset = 0; offset < intent.sourceRefs.length; offset += batchSize) {
    const requested = intent.sourceRefs.slice(offset, offset + batchSize);
    const result = await read({ ...intent, sourceRefs: requested });
    if (result?.status !== 'AVAILABLE' || result.scope !== intent.context ||
      result.completeRequestedScope !== true || !Array.isArray(result.sourceRefs) ||
      !Array.isArray(result.evidence) || requested.some(ref => !result.sourceRefs.includes(ref)))
      throw new Error('JOBAID_SOURCE_READ_FAILED:INCOMPLETE_BATCH');
    first ??= result;
    for (const item of result.evidence) {
      if (!item || typeof item.evidenceRef !== 'string' ||
        (evidence.has(item.evidenceRef) && !isDeepStrictEqual(evidence.get(item.evidenceRef), item)))
        throw new Error('JOBAID_SOURCE_READ_FAILED:INCONSISTENT_EVIDENCE');
      evidence.set(item.evidenceRef, item);
    }
    for (const ref of result.sourceRefs) sourceRefs.add(ref);
  }
  return { ...first, sourceRefs: [...sourceRefs], evidence: [...evidence.values()] };
}

/** Read/save intents are executed by existing Host callbacks, never by the model. */
export async function invokeHostedJobAidProblemModel(
  { operation, modelInput },
  options,
  dependencies = {},
) {
  validateJobAidProblemInput(modelInput);
  if ((modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA) !== (operation === 'ASSESS_MATTER'))
    throw new Error('JOBAID_PROBLEM_OPERATION_MISMATCH');
  assertHostedModelGatewayReady(options);
  if (
    !['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL', 'ASSESS_MATTER'].includes(operation) ||
    typeof options.readAssessmentSources !== 'function' ||
    typeof options.saveAssessmentWork !== 'function' ||
    typeof options.readAssessmentWork !== 'function' ||
    !options.sessionDiscriminator
  )
    throw new Error('JOBAID_PROBLEM_RUNTIME_CAPABILITY_REQUIRED');
  let startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const systemMessage = { role: 'system', content: GUIDE + (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA
    ? '\n本任务主体是工程事项。本轮工作由 trigger 和 sourceChanges 指定，previousWork 是历史认识，不得将其旧指令当作本轮请求。availableDocuments 只是版本目录；有 boundOriginal 时，通过 READ_SOURCES 请求该项 originalReadRef，按返回 nextOffset 继续读取 DOCUMENT_VERSION:<documentVersionId>:original:<offset>。读取结果中的 semanticMap 是固定版本的章节导航；应读取有关正文、条件及必要其他范围，目录和角色不等于证据或工程结论。没有 boundOriginal 时才先请求 DOCUMENT_VERSION:<documentVersionId>:page:1，再按需读取后续页。实际未读的图表与范围保留限制。结合完整前次工作处理本轮变化，保留不受影响的问题；每个新任务必须保存本轮工作后才可 FINISH。' : '') };
  let messages = [
    systemMessage,
    { role: 'user', content: JSON.stringify(projectJobAidModelInput(modelInput)) },
  ];
  const initialContextMessage = messages[1];
  let expectedWorkRevision = modelInput.expectedWorkRevision;
  let saved = modelInput.previousWork?.content && (modelInput.schemaVersion !== MATTER_JOBAID_TASK_SCHEMA || options.resumeSavedWork)
    ? {
        workRevisionRef: modelInput.previousWork.workRevisionRef,
        workRevision: modelInput.previousWork.workRevision,
        roundCompletion: modelInput.previousWork.content.roundCompletion,
      }
    : null;
  let corrections = 0;
  let inputUnits = 0;
  let outputUnits = 0;
  const checkpoint = options.assessmentCheckpoint;
  if (checkpoint) {
    const binding = { operation, modelInput, sessionDiscriminator: options.sessionDiscriminator,
      executionModel: options.executionModel ?? null };
    const existing = await checkpoint.readOptional('assessment-enabled');
    if (existing && !isDeepStrictEqual(existing.binding, binding)) throw new Error('JOBAID_CHECKPOINT_BINDING_MISMATCH');
    if (existing) startedAt = existing.startedAt;
    else await checkpoint.writeOnce('assessment-enabled', { version: 1, binding, startedAt });
  }
  let round = 1;
  const restored = await checkpoint?.readOptional('assessment-state');
  if (restored) {
    ({ round, messages, expectedWorkRevision, saved, corrections, inputUnits, outputUnits } = restored);
  } else await checkpoint?.write('assessment-state', { round, messages,
    expectedWorkRevision, saved, corrections, inputUnits, outputUnits });
  const taskDeadlineMs = options.taskDeadline === undefined ? Infinity : Date.parse(options.taskDeadline);
  if (Number.isNaN(taskDeadlineMs)) throw new Error('JOBAID_TASK_DEADLINE_INVALID');
  // Matter already has an absolute Host deadline. Its model budget measures
  // actual recorded execution, not maintenance downtime between completed rounds.
  const activeModelBudget = operation === 'ASSESS_MATTER' && checkpoint && Number.isFinite(taskDeadlineMs);
  let modelExecutionMs = 0;
  const accountedRounds = new Set();
  const accountRound = async number => {
    if (!activeModelBudget || accountedRounds.has(number)) return;
    const result = await checkpoint.readOptional(`assessment-round-${number}.result`);
    if (!result) return;
    const start = await checkpoint.readOptional(`assessment-round-${number}.started`);
    const startMs = Date.parse(start?.startedAt);
    const endMs = Date.parse(result.finishedAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
      throw new Error('JOBAID_CHECKPOINT_EXECUTION_TIME_INVALID');
    modelExecutionMs += endMs - startMs;
    accountedRounds.add(number);
  };
  if (activeModelBudget) for (let number = 1; number <= round; number++) await accountRound(number);
  const remainingBudgetMs = () => Math.min(taskDeadlineMs - Date.now(),
    timeoutMs - (activeModelBudget ? modelExecutionMs : Date.now() - startedAt));
  const requestKey = async (kind) => {
    const key = `assessment-${round}-${kind}`;
    let value = await checkpoint?.readOptional(key);
    if (!value) {
      value = { requestId: `JA-${kind}-${randomUUID()}` };
      await checkpoint?.writeOnce(key, value);
    }
    return value.requestId;
  };
  const save = async (work) => {
    const requestId = await requestKey('save');
    const args = {
      requestId,
      expectedWorkRevision,
      workJson: JSON.stringify(work),
    };
    let result;
    try {
      const readback = checkpoint ? await options.readAssessmentWork({ requestId }) : null;
      if (readback?.revision) {
        if (readback.revision.requestId !== requestId) throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
        result = { ...readback.revision, roundCompletion: readback.revision.content.roundCompletion };
      } else result = await options.saveAssessmentWork(args);
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
  for (; round <= 64; round += 1) {
    await options.heartbeat?.();
    const remainingMs = remainingBudgetMs();
    if (Date.now() >= taskDeadlineMs || (remainingMs <= 0 && !accountedRounds.has(round)))
      throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
    inputUnits += Buffer.byteLength(JSON.stringify(messages));
    const requestedModel = `openclaw/${WISELINK_PROFILE_REF}`;
    const performRequest = async () => {
      if (round === 1 && options.recoveredInitialResponse) return options.recoveredInitialResponse;
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
                  properties: { step: jobAidFunctionSchema(transportStepShape) },
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
      return { raw, status: response.status, ok: response.ok };
    };
    // Persist a complete response before executing its read/save intent. A lost
    // response remains unknown; a failed Host read can reuse this exact result.
    const response = checkpoint ? await checkpoint.remoteStep({
      step: `assessment-round-${round}`, args: { operation, messages, executionModel: options.executionModel ?? null,
        sessionDiscriminator: options.sessionDiscriminator }, ambiguousCommit: false, perform: performRequest,
    }) : await performRequest();
    await accountRound(round);
    const { raw } = response;
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
    const gatewayFailure = response.ok ? null : classifyHostedGatewayFailure(payload);
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
        ...(gatewayFailure ? { gatewayFailure } : {}),
      },
      round,
    );
    // The native profile can have tools. An outer candidate function does not
    // prove generation-only execution; an ambiguous 408/timeout is not retried.
    if (!response.ok) {
      const error = new Error(`JOBAID_GATEWAY_HTTP_${response.status}${gatewayFailure === 'UNCLASSIFIED' ? '' : ':' + gatewayFailure}`);
      // The gateway explicitly reports an ended, incomplete invocation. This
      // is a failed result, unlike a transport timeout with an unknown outcome.
      if (response.status === 400 && gatewayFailure === 'INCOMPLETE_TERMINAL_RESPONSE') {
        error.terminalAssessmentFailure = {
          errorCode: 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE',
          provenance: {
            modelVersion: `configured-route:${options.executionModel?.modelRef ?? options.configuredModelVersion}`,
            promptVersion: 'wiselink-jobaid-problem@v2', skillVersion: WISELINK_SKILL_VERSION,
            toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': '2' },
            runMetrics: { durationMs: Date.now() - startedAt, inputUnits, outputUnits },
          },
        };
      }
      throw error;
    }
    if (shape.hasAnalysis || payload.choices?.length !== 1)
      throw new Error('JOBAID_MODEL_OUTPUT_CHANNEL_INVALID');
    const choice = payload.choices[0];
    const message = choice?.message;
    const call = message?.tool_calls?.[0];
    // A completed text-only answer is known, unlike an interrupted generation.
    // Keep its durable result and request a separate, bounded protocol correction.
    if (choice.finish_reason === 'stop' && message?.role === 'assistant' &&
        typeof message.content === 'string' && message.content.trim() &&
        (message.tool_calls == null || (Array.isArray(message.tool_calls) && message.tool_calls.length === 0)) &&
        message.function_call == null && corrections < 2) {
      outputUnits += Buffer.byteLength(message.content);
      corrections += 1;
      messages = [...messages, { role: 'user', content: JSON.stringify({
        accepted: false, errorCode: 'JOBAID_MODEL_OUTPUT_FUNCTION_REQUIRED', expectedWorkRevision,
        instruction: `Your completed text-only response did not submit any step. Return exactly one ${FUNCTION} function call. Continue the existing investigation and correct the prior rejected work using its evidence and receipt; do not restart the assessment or treat prose as saved work.`,
        ...priorRejectedRatingCorrection(messages, modelInput),
      }) }];
      await options.observeCandidateRejection?.({ correctionNo: corrections, code: 'JOBAID_MODEL_OUTPUT_FUNCTION_REQUIRED' });
      await checkpoint?.write('assessment-state', { round: round + 1, messages,
        expectedWorkRevision, saved, corrections, inputUnits, outputUnits });
      continue;
    }
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
      if (Object.keys(args.step).some(key => !Object.hasOwn(transportStepShape.properties, key)))
        throw new Error('JOBAID_STEP_FIELD_INVALID');
      const step = decodeJobAidStep(args.step);
      if (step.action === 'READ_SOURCES') {
        if (
          !Array.isArray(step.sourceRefs) ||
          !step.sourceRefs.length ||
          typeof step.purpose !== 'string' ||
          !['EXACT', 'PAGE'].includes(step.context)
        )
          throw new Error('JOBAID_SOURCE_STEP_INVALID');
        receipt = await readJobAidSourceBatches({
          sourceRefs: step.sourceRefs,
          purpose: step.purpose,
          context: step.context,
        }, options.readAssessmentSources);
        if (receipt?.status !== 'AVAILABLE' || !Array.isArray(receipt.evidence))
          throw new Error('JOBAID_SOURCE_READ_FAILED');
      } else if (step.action === 'QUERY_KNOWLEDGE') {
        if (typeof step.query !== 'string' || !step.query.trim() || step.query.length > 4000)
          throw new Error('JOBAID_KNOWLEDGE_QUERY_INVALID');
        if (!modelInput.knowledgeAccess?.available || !options.queryAssessmentKnowledge) {
          receipt = { status: 'UNAVAILABLE', error: modelInput.knowledgeAccess?.reason ?? 'NOT_CONNECTED', evidence: [], candidateOnly: true, originalDocumentsVerified: false };
        } else {
          const queryRequestKey = await requestKey('query');
          try { receipt = await options.queryAssessmentKnowledge({ requestKey: queryRequestKey, query: step.query }); }
          catch {
            // A transport failure cannot authorize replaying the upstream query.
            receipt = await options.queryAssessmentKnowledge({ requestKey: queryRequestKey });
          }
          while (receipt?.status === 'RUNNING') {
            if (!receipt.queryRef) throw new Error('JOBAID_KNOWLEDGE_RECEIPT_INVALID');
            if (remainingBudgetMs() <= 0) throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
            await options.heartbeat?.();
            await (dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(3000);
            receipt = await options.queryAssessmentKnowledge({ queryRef: receipt.queryRef });
          }
          if (!['COMPLETED','FAILED','UNKNOWN','UNAVAILABLE'].includes(receipt?.status) || !Array.isArray(receipt.evidence))
            throw new Error('JOBAID_KNOWLEDGE_RECEIPT_INVALID');
        }
      } else if (step.action === 'SAVE_WORK' || step.action === 'FINISH') {
        if (step.workJson !== undefined) {
          submittedWork = parseJobAidWorkJson(step.workJson);
          receipt = await save(submittedWork);
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
        ...workShapeCorrection(code, submittedWork, modelInput),
        ...(code === 'JOBAID_SOURCE_NOT_DELIVERED' && error.hostRejectedSourceRef ? {
          sourceRef: error.hostRejectedSourceRef,
          instruction: 'The Host rejected this exact source reference from your candidate. Read it through READ_SOURCES if it belongs to the authorized catalog or document range. If unavailable, preserve the limitation and revise the unsupported assertion. Do not guess another identifier, silently drop supported analysis, or treat the failed save as completed.',
        } : {}),
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
      ...(round === 1 && options.recoveredInitialContext ? [initialContextMessage] : []),
      { role: 'assistant', content: null, tool_calls: [call] },
      {
        role: 'tool',
        tool_call_id: call.id,
        name: FUNCTION,
        content: JSON.stringify(receipt),
      },
    ];
    await checkpoint?.write('assessment-state', { round: round + 1, messages,
      expectedWorkRevision, saved, corrections, inputUnits, outputUnits });
  }
  throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
}

// Explain the existing Host rejection using types/positions only. The original
// work is still submitted unchanged and only the Host can accept a revision.
function priorRejectedRatingCorrection(messages, modelInput) {
  const receiptMessage = messages.findLast(message => message.role === 'tool');
  const priorCall = messages.findLast(message => message.role === 'assistant' && message.tool_calls?.length === 1)?.tool_calls[0];
  if (!receiptMessage || priorCall?.function?.name !== FUNCTION) return {};
  const receipt = parseStrictJsonObject(receiptMessage.content);
  if (receipt.accepted !== false || !/^JOBAID_(SEVERITY|LIKELIHOOD)_BUSINESS_EVIDENCE_REQUIRED$/.test(receipt.errorCode)) return {};
  const step = parseStrictJsonObject(priorCall.function.arguments).step;
  if (typeof step?.workJson !== 'string') return {};
  return { priorRejection: { errorCode: receipt.errorCode,
    ...workShapeCorrection(receipt.errorCode, parseJobAidWorkJson(step.workJson), modelInput) } };
}

function workShapeCorrection(code, work, modelInput) {
  if (!work) return {};
  const rating = /^JOBAID_(SEVERITY|LIKELIHOOD)_BUSINESS_EVIDENCE_REQUIRED$/.exec(code)?.[1]?.toLowerCase();
  if (rating) {
    const kinds = new Map((modelInput.availableSources ?? []).map(source => [source.ref, source.kind]));
    const fieldErrors = [];
    for (const [i, issue] of (work.issues ?? []).entries()) for (const [j, risk] of (issue.riskScenarios ?? []).entries()) {
      const proposal = risk[rating];
      if (proposal && Array.isArray(proposal.basisRefs) && proposal.basisRefs.every(ref =>
        kinds.has(ref) && !['DOCUMENT_PASSAGE', 'HOST_FACT'].includes(kinds.get(ref))))
        fieldErrors.push({ path: `work.issues[${i}].riskScenarios[${j}].${rating}`, expected: 'business evidence or null',
          received: 'rating supported only by non-business sources', basisRefs: proposal.basisRefs,
          sourceKinds: proposal.basisRefs.map(ref => kinds.get(ref)) });
    }
    return { fieldErrors, instruction: `The Host rejected a ${rating} rating without business evidence. Engineer statements, method rules and historical candidates alone cannot establish this rating. Use an actually supporting DOCUMENT_PASSAGE or HOST_FACT only if available; otherwise set the unsupported ${rating} to null and preserve the scenario, conditions, evidence, limitation and open question. Never guess a rating or attach an unrelated citation to pass validation. Preserve all other justified work. The Host will validate the revised work.` };
  }
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
