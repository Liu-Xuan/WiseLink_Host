import { jobAidWorkTypeErrors, JOBAID_STEP_SHAPE, decodeJobAidStep, jobAidFunctionSchema } from './jobaid-work-shape.mjs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
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
const INITIAL_JOBAID_READS_PER_SAVE = 1;
const INITIAL_JOBAID_SOURCE_REFS_PER_READ = 10;
export const JOBAID_GENERATION_POLICY = Object.freeze({
  version: 'continuous-body-batches-v5', requestMaxCompletionTokens: 16000,
  payloadTargetTokens: [2000, 4000], maxScopeAdjustments: 0,
  basis: 'Application budget; 16000 is an observation on one Hosted M3 request, not a universal model limit.',
});

// Drop only byte-equivalent repeated metadata within this exact native session.
// Persist the registry with the messages; a new task/session starts with full data.
export function projectJobAidReadReceipt(receipt, registry) {
  if (!Array.isArray(receipt.documents)) return receipt;
  return { ...receipt, documents: receipt.documents.map(document => {
    if (!document.binding?.parseRunId) return document;
    const metadata = { binding: document.binding, semanticMap: document.semanticMap,
      findings: document.findings, coverage: document.coverage };
    const prior = registry.findIndex(item => isDeepStrictEqual(item, metadata));
    if (prior < 0) {
      registry.push(metadata);
      return { ...document, metadataRef: `original-context-${registry.length}` };
    }
    const { semanticMap, findings, coverage, ...range } = document;
    return { ...range, metadataRef: `original-context-${prior + 1}`,
      metadataStatus: 'UNCHANGED_IN_THIS_SESSION',
      semanticBinding: semanticMap ? { semanticRevision: semanticMap.semanticRevision, profileRef: semanticMap.profileRef } : null };
  }) };
}

const { work: _workShape, ...stepProperties } = JOBAID_STEP_SHAPE.properties;
const transportStepShape = {
  ...JOBAID_STEP_SHAPE,
  properties: { ...stepProperties, workJson: { type: 'string', minLength: 2,
    description: 'One complete batch of new or changed issues encoded as JSON text, plus only necessary summary changes. Unchanged issues are retained by Host; supplied issues replace whole issues. Preserve arrays and nulls.' } },
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

function projectSavedJobAidWorkContent(content) {
  if (content?.schemaVersion !== 'wiselink.jobaid-problem-work.v3' ||
      !Array.isArray(content.issues))
    throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
  return {
    schemaVersion: content.schemaVersion,
    headline: content.headline,
    listBrief: content.listBrief,
    overview: content.understanding ?? content.overview,
    roundCompletion: content.roundCompletion,
    completionReason: content.completionReason,
    changeSummary: content.changeSummary,
    unchangedExplanation: content.unchangedExplanation,
    issues: content.issues.map(issue => {
      const { issueRef: _issueRef, sourceDependencies: _sourceDependencies,
        premiseRefs: _premiseRefs, legacyCriterionRefs: _legacyCriterionRefs,
        ...modelIssue } = issue;
      return {
        ...modelIssue,
        riskScenarios: (issue.riskScenarios ?? []).map(({ gradeMeaning: _gradeMeaning, ...risk }) => risk),
      };
    }),
  };
}

function continuationModelInput(input, revision) {
  return {
    ...input,
    expectedWorkRevision: revision.workRevision,
    previousWork: {
      workRevisionRef: revision.workRevisionRef,
      workRevision: revision.workRevision,
      ...(revision.content.overviewStatus ? { overviewStatus: revision.content.overviewStatus } : {}),
      content: projectSavedJobAidWorkContent(revision.content),
    },
  };
}

function sourceBatchPolicyFeedback(code, requestedCount, readsSinceSave) {
  if (code === 'JOBAID_SOURCE_BATCH_TOO_LARGE') return {
    sourceReadPolicy: {
      maxSourceRefsPerRead: INITIAL_JOBAID_SOURCE_REFS_PER_READ,
      requestedSourceRefCount: requestedCount,
      hostReadExecuted: false,
    },
    instruction: `本次来源请求超过单批上限 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} 个，Host 未执行任何读取。只选择最相关且能支持一组完整判断的至多 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} 个引用；不得声称其余来源已核验。`,
  };
  if (code === 'JOBAID_SOURCE_BATCH_SAVE_REQUIRED') return {
    sourceReadPolicy: {
      maxReadActionsBeforeSave: INITIAL_JOBAID_READS_PER_SAVE,
      readActionsSinceSave: readsSinceSave,
      hostReadExecuted: false,
    },
    instruction: '自上次 Host 确认保存后已完成一个来源读取动作。本次未执行新的读取。无论本次 sourceRef 是否有效或已登记，都不得再次 READ_SOURCES；必须基于当前已交付正文保存一项有价值的完整工作增量，标记未覆盖范围；保存后运行器将读回完整工作并在新 OpenClaw 会话继续。',
  };
  return {};
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
  const maxCorrections = modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA ? 2 : 4;
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
  const toolChoice = { type: 'function', function: { name: FUNCTION } };
  let startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const boundedInitialJobAid = operation === 'EVALUATE_JOBAID' &&
    modelInput.schemaVersion === JOBAID_PROBLEM_TASK_SCHEMA && Boolean(modelInput.documentOverview);
  const systemMessage = { role: 'system', content: GUIDE + (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA
    ? '\n本任务主体是工程事项。本轮工作由 trigger 和 sourceChanges 指定，previousWork 是历史认识，不得将其旧指令当作本轮请求。availableDocuments 只是版本目录；有 boundOriginal 时，通过 READ_SOURCES 请求该项 originalReadRef，按返回 nextOffset 继续读取 DOCUMENT_VERSION:<documentVersionId>:original:<offset>。读取结果中的 semanticMap 是固定版本的章节导航；应读取有关正文、条件及必要其他范围，目录和角色不等于证据或工程结论。没有 boundOriginal 时才先请求 DOCUMENT_VERSION:<documentVersionId>:page:1，再按需读取后续页。实际未读的图表与范围保留限制。结合完整前次工作处理本轮变化，保留不受影响的问题；每个新任务必须保存本轮工作后才可 FINISH。' : '') };
  if (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA &&
      modelInput.overviewCorrectionProtocol === 'OPENCLAW_SCOPED_V1') {
    systemMessage.content += '\n本轮是明确指定的工程事项综合更正。以 overviewCorrection.expectedWorkRef 对应的 previousWork 为准确基线，按 correctionReason 核对已保存的全部问题、当前综合及完成说明。问题正文只是比较语境，不自动重新认证为原文。只使用 overviewCorrection.evidenceRefs 所指本轮已交付证据作新综合的引用；缺少决定性依据时保留限制。新的 overview 面向工程师，用简短段落给出主要判断、决定性条件、下一步或尚缺资料；过程与展开的论证留在问题正文和依据中，关键限制仍须在综合里说清。SAVE_WORK 只提交一个完整的综合更正：issues:[]、新的 overview、completionReason、changeSummary，roundCompletion 与 previousWork.content 相同；不得提交问题正文、摘要或其他工作字段。即使旧综合标记 STALE，也要实际核对后形成综合，不把状态本身当作结论。保存回执后 FINISH；本轮不作正式采用。';
  }
  if (boundedInitialJobAid) {
    systemMessage.content += `\n本次初始 JobAid 执行按可核验批次推进：每次 SAVE_WORK 前最多执行 ${INITIAL_JOBAID_READS_PER_SAVE} 个 READ_SOURCES 动作，每个动作最多 ${INITIAL_JOBAID_SOURCE_REFS_PER_READ} 个 sourceRefs。保存有价值的完整增量时用 IN_PROGRESS 或 COMPLETE_WITH_OPEN_QUESTIONS，并保留未读范围；不要声称未读来源已经核验。Host 成功读取后，运行器会在独立 OpenClaw 会话中提供完整来源回执，并将工具Schema限制为必须 SAVE_WORK；Host 确认并读回保存后，再在新会话中提供完整已保存工作和版本回执，继续下一批。只有完整复核后才 FINISH。`;
  }
  let messages = [
    systemMessage,
    { role: 'user', content: JSON.stringify(projectJobAidModelInput(modelInput)) },
  ];
  if (options.recoveredSourceContext) systemMessage.content += '\n这是 Host 正常授权的后继任务：旧任务已结束但未交付完整工作载荷。当前 deliveredEvidence 包含 Host 重新授权并保留的已读原文，previousWork 是实际已保存工作。先使用这些完整证据形成本批有价值正文，仅在缺少必要语境时补读；不要为了恢复而重复获取已交付的相同范围。旧任务错误不是工程结论，也不是已保存正文。本次仍须正常 SAVE_WORK 后才能完成。';
  let initialContextMessage = messages[1];
  let sessionModelInput = modelInput;
  let expectedWorkRevision = modelInput.expectedWorkRevision;
  let sessionWorkRevision = modelInput.expectedWorkRevision;
  let readsSinceSave = 0;
  let savedReadSourceRefs = [];
  let nativeSessionSegment = 0;
  let forceSaveBeforeRead = false;
  // Host accepts a prior attempt's completed work only for Overall consistency.
  // Ordinary reassessment must save under this attempt, even if unchanged.
  const canReusePreviousWork = (operation === 'SYNTHESIZE_OVERALL' && modelInput.purpose === 'OVERALL_CONSISTENCY') ||
    (modelInput.schemaVersion === MATTER_JOBAID_TASK_SCHEMA && options.resumeSavedWork);
  let saved = modelInput.previousWork?.content && canReusePreviousWork
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
  const generationPolicy = JOBAID_GENERATION_POLICY;
  let scopeAdjustments = 0;
  let sourceMetadata = [];
  const persistAssessmentState = (nextRound) => checkpoint?.write('assessment-state', {
    round: nextRound, messages, expectedWorkRevision, saved, corrections, inputUnits, outputUnits,
    scopeAdjustments, sourceMetadata, sessionModelInput, sessionWorkRevision, readsSinceSave,
    savedReadSourceRefs, nativeSessionSegment, forceSaveBeforeRead,
  });
  if (checkpoint) {
    const binding = { operation, modelInput, sessionDiscriminator: options.sessionDiscriminator,
      executionModel: options.executionModel ?? null };
    const existing = await checkpoint.readOptional('assessment-enabled');
    if (existing && !isDeepStrictEqual(existing.binding, binding)) throw new Error('JOBAID_CHECKPOINT_BINDING_MISMATCH');
    if (existing) {
      startedAt = existing.startedAt;
      if (!isDeepStrictEqual(existing.generationPolicy, generationPolicy))
        throw new Error('JOBAID_CHECKPOINT_POLICY_CHANGED'); // use a normal successor; never reinterpret an old in-flight request
    } else await checkpoint.writeOnce('assessment-enabled', { version: 1, binding, startedAt, generationPolicy });
  }
  let round = 1;
  const restored = await checkpoint?.readOptional('assessment-state');
  if (restored) {
    ({ round, messages, expectedWorkRevision, saved, corrections, inputUnits, outputUnits } = restored);
    sessionModelInput = restored.sessionModelInput ?? modelInput;
    initialContextMessage = { role: 'user', content: JSON.stringify(projectJobAidModelInput(sessionModelInput)) };
    sessionWorkRevision = restored.sessionWorkRevision ?? modelInput.expectedWorkRevision;
    readsSinceSave = restored.readsSinceSave ?? 0;
    savedReadSourceRefs = restored.savedReadSourceRefs ?? [];
    nativeSessionSegment = restored.nativeSessionSegment ?? 0;
    forceSaveBeforeRead = restored.forceSaveBeforeRead ?? false;
    scopeAdjustments = restored.scopeAdjustments ?? 0;
    sourceMetadata = restored.sourceMetadata ?? [];
  } else await persistAssessmentState(round);
  const taskDeadlineMs = options.taskDeadline === undefined ? Infinity : Date.parse(options.taskDeadline);
  if (Number.isNaN(taskDeadlineMs)) throw new Error('JOBAID_TASK_DEADLINE_INVALID');
  // A checkpointed assessment with an absolute Host deadline measures
  // actual recorded execution, not maintenance downtime between completed rounds.
  const activeModelBudget = checkpoint && Number.isFinite(taskDeadlineMs);
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
    let saveReadback = null;
    try {
      saveReadback = checkpoint ? await options.readAssessmentWork({ requestId }) : null;
      if (saveReadback?.revision) {
        if (saveReadback.revision.requestId !== requestId) throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
        result = { ...saveReadback.revision, roundCompletion: saveReadback.revision.content.roundCompletion };
      } else result = await options.saveAssessmentWork(args);
    } catch (error) {
      // Unknown save response: read the same request first. Never change its
      // request ID or regenerate an already-persisted analysis to recover it.
      saveReadback = await options.readAssessmentWork({ requestId });
      if (!saveReadback?.revision || saveReadback.revision.requestId !== requestId)
        throw error;
      result = {
        workRevisionRef: saveReadback.revision.workRevisionRef,
        workRevision: saveReadback.revision.workRevision,
        roundCompletion: saveReadback.revision.content.roundCompletion,
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
    saved = { requestId, workRevisionRef: result.workRevisionRef, workRevision: result.workRevision,
      roundCompletion: result.roundCompletion };
    if (boundedInitialJobAid) {
      if (!saveReadback?.revision)
        saveReadback = await options.readAssessmentWork({ requestId });
      const revision = saveReadback?.revision;
      if (revision?.requestId !== requestId ||
          revision.workRevisionRef !== result.workRevisionRef ||
          revision.workRevision !== result.workRevision ||
          !revision.content)
        throw new Error('JOBAID_WORK_SAVE_READBACK_INVALID');
      sessionModelInput = continuationModelInput(modelInput, revision);
      savedReadSourceRefs = Array.isArray(revision.content.readSourceRefs)
        ? [...revision.content.readSourceRefs] : [];
      initialContextMessage = {
        role: 'user',
        content: JSON.stringify(projectJobAidModelInput(sessionModelInput)),
      };
      sessionWorkRevision = revision.workRevision;
    }
    return saved;
  };
  for (; round <= 64; round += 1) {
    await options.heartbeat?.();
    const remainingMs = remainingBudgetMs();
    if (Date.now() >= taskDeadlineMs || (remainingMs <= 0 && !accountedRounds.has(round)))
      throw new Error('JOBAID_MODEL_BUDGET_EXHAUSTED');
    inputUnits += Buffer.byteLength(JSON.stringify(messages));
    const requestedModel = `openclaw/${WISELINK_PROFILE_REF}`;
    const nativeSessionDiscriminator = boundedInitialJobAid && nativeSessionSegment > 0
      ? `${options.sessionDiscriminator}:work:${sessionWorkRevision}:segment:${nativeSessionSegment}`
      : sessionWorkRevision === modelInput.expectedWorkRevision
        ? options.sessionDiscriminator
        : `${options.sessionDiscriminator}:work:${sessionWorkRevision}`;
    const focus = scopeAdjustments
      ? 'Reduce the amount delivered in this unfinished batch while retaining the full engineering context. Choose one or several complete, meaningful issue updates; do not split conditions or reasoning fragments. Preserve saved work and do not continue a truncated JSON string.'
      : boundedInitialJobAid
        ? forceSaveBeforeRead
          ? 'The Host has delivered one successful source-read receipt in this fresh native session. Submit a substantive, complete SAVE_WORK now. The required function schema permits only SAVE_WORK until Host confirms the save; preserve unread scopes and do not claim them verified.'
          : 'Save each meaningful initial-analysis increment after one bounded source-read action. After a successful Host source read, the runtime starts a fresh native session with that exact evidence and requires SAVE_WORK. After a Host-confirmed SAVE_WORK, it starts another fresh native session containing the exact Host-read-back work and revision receipt. Do not accumulate more source reads before saving or claim unread scopes were verified.'
        : 'Keep the shared engineering context and investigate across relevant sections and sources. Choose the number of complete issues that can be delivered in this batch; save substantive results promptly without first exhausting every issue. After SAVE_WORK continue automatically in this same session. Do not rewrite unchanged issues or summary fields. Before completion check cross-issue consistency and save only necessary synthesis or corrections.';
    const requestStepShape = forceSaveBeforeRead ? {
      ...transportStepShape,
      required: ['action', 'workJson'],
      properties: { ...transportStepShape.properties, action: { type: 'string', enum: ['SAVE_WORK'] } },
    } : transportStepShape;
    const requestToolSchema = jobAidFunctionSchema(requestStepShape);
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
          user: `initial:${nativeSessionDiscriminator}`,
          messages: messages.map(message => message.role !== 'system' ? message : ({ ...message, content: message.content + '\n' + JSON.stringify({
            generationPolicy, scopeAdjustment: scopeAdjustments, expectedWorkRevision, savedWork: saved,
            focus,
          }) })),
          tools: [
            {
              type: 'function',
              function: {
                name: FUNCTION,
                description: forceSaveBeforeRead
                  ? 'Return one substantive SAVE_WORK intent. The deterministic Host caller executes and validates it.'
                  : 'Return one source-read, substantive-work-save, or finish intent. The deterministic Host caller executes it.',
                parameters: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['step'],
                  properties: { step: requestToolSchema },
                },
              },
            },
          ],
          tool_choice: toolChoice,
          parallel_tool_calls: false,
          n: 1,
          stream: false,
          ...(options.executionModel?.modelRef === 'miaoda/minimax-m3'
            ? { max_completion_tokens: generationPolicy.requestMaxCompletionTokens }
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
        sessionDiscriminator: nativeSessionDiscriminator, generationPolicy, scopeAdjustments,
        ...(boundedInitialJobAid ? { nativeSessionSegment, forceSaveBeforeRead, requestToolSchema } : {}) },
      ambiguousCommit: false, perform: performRequest,
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
        requestedToolChoice: toolChoice,
        requestMaxCompletionTokens: options.executionModel?.modelRef === 'miaoda/minimax-m3' ? (generationPolicy.requestMaxCompletionTokens) : null,
        generationPolicyVersion: generationPolicy.version,
        scopeAdjustments,
        functionArgumentsBytes: typeof payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments === 'string'
          ? Buffer.byteLength(payload.choices[0].message.tool_calls[0].function.arguments) : null,
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
    // Only an explicit completion reason establishes truncation. Never infer
    // length from generic 502/tool-choice failures or repair partial arguments.
    if (payload.choices?.length === 1 && payload.choices[0].finish_reason === 'length') {
      if (scopeAdjustments >= generationPolicy.maxScopeAdjustments) {
        const error = new Error('JOBAID_MODEL_OUTPUT_LENGTH');
        error.terminalAssessmentFailure = {
          errorCode: 'JOBAID_MODEL_OUTPUT_LENGTH',
          provenance: {
            modelVersion: `configured-route:${options.executionModel?.modelRef ?? options.configuredModelVersion}`,
            promptVersion: 'wiselink-jobaid-problem@v2', skillVersion: WISELINK_SKILL_VERSION,
            toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': '2' },
            runMetrics: { durationMs: Date.now() - startedAt, inputUnits, outputUnits },
          },
        };
        throw error;
      }
      scopeAdjustments += 1;
      // Retain the latest source/save receipt. The native session holds earlier
      // complete context; the incomplete output is never resubmitted as a tool.
      await options.observeCandidateRejection?.({ modelRound: round, correctionNo: scopeAdjustments, code: 'JOBAID_MODEL_OUTPUT_LENGTH' });
      await persistAssessmentState(round + 1);
      continue;
    }
    // The native profile can have tools. An outer candidate function does not
    // prove generation-only execution; an ambiguous 408/timeout is not retried.
    if (!response.ok) {
      const error = new Error(`JOBAID_GATEWAY_HTTP_${response.status}${gatewayFailure === 'UNCLASSIFIED' ? '' : ':' + gatewayFailure}`);
      // The gateway explicitly reports an ended, incomplete invocation. This
      // is a failed result, unlike a transport timeout with an unknown outcome.
      if ((response.status === 400 && gatewayFailure === 'INCOMPLETE_TERMINAL_RESPONSE') ||
          (response.status === 502 && gatewayFailure === 'TOOL_CHOICE_NOT_SATISFIED')) {
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
        message.function_call == null && corrections < maxCorrections) {
      outputUnits += Buffer.byteLength(message.content);
      corrections += 1;
      messages = [...messages, { role: 'user', content: JSON.stringify({
        accepted: false, errorCode: 'JOBAID_MODEL_OUTPUT_FUNCTION_REQUIRED', expectedWorkRevision,
        instruction: `Your completed text-only response did not submit any step. Return exactly one ${FUNCTION} function call. Continue the existing investigation and correct the prior rejected work using its evidence and receipt; do not restart the assessment or treat prose as saved work.`,
        ...priorRejectedRatingCorrection(messages, modelInput),
      }) }];
      await options.observeCandidateRejection?.({ modelRound: round, correctionNo: corrections, code: 'JOBAID_MODEL_OUTPUT_FUNCTION_REQUIRED' });
      await persistAssessmentState(round + 1);
      continue;
    }
    if (choice.finish_reason === 'stop' && message?.role === 'assistant' &&
        typeof message.content === 'string' && message.content.trim() &&
        (message.tool_calls == null || (Array.isArray(message.tool_calls) && message.tool_calls.length === 0)) &&
        message.function_call == null && corrections >= maxCorrections) {
      const error = new Error('JOBAID_MODEL_OUTPUT_FUNCTION_INVALID');
      // All responses are durably complete and the bounded corrections are exhausted.
      // Reuse the existing failed-result lifecycle instead of leaving a live lease
      // to replay the same rejected response indefinitely. No candidate is accepted.
      error.terminalAssessmentFailure = {
        errorCode: 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE',
        provenance: {
          modelVersion: actualModelVersion(payload, choice, message,
            options.executionModel ? `configured-route:${options.executionModel.modelRef}` : options.configuredModelVersion),
          promptVersion: 'wiselink-jobaid-problem@v2', skillVersion: WISELINK_SKILL_VERSION,
          toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': '2' },
          runMetrics: { durationMs: Date.now() - startedAt, inputUnits,
            outputUnits: outputUnits + Buffer.byteLength(message.content) },
        },
      };
      throw error;
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
    let sessionResetKind = null;
    let requestedSourceRefCount = null;
    try {
      const args = parseStrictJsonObject(call.function.arguments);
      if (Object.keys(args).length !== 1 || !args.step || typeof args.step !== 'object' || Array.isArray(args.step))
        throw new Error('JOBAID_STEP_OBJECT_REQUIRED');
      if (Object.keys(args.step).some(key => !Object.hasOwn(transportStepShape.properties, key)))
        throw new Error('JOBAID_STEP_FIELD_INVALID');
      const step = decodeJobAidStep(args.step);
      if (step.action === 'READ_SOURCES') {
        if (boundedInitialJobAid && readsSinceSave >= INITIAL_JOBAID_READS_PER_SAVE)
          throw new Error('JOBAID_SOURCE_BATCH_SAVE_REQUIRED');
        if (
          !Array.isArray(step.sourceRefs) ||
          !step.sourceRefs.length ||
          typeof step.purpose !== 'string' ||
          !['EXACT', 'PAGE'].includes(step.context)
        )
          throw new Error('JOBAID_SOURCE_STEP_INVALID');
        requestedSourceRefCount = step.sourceRefs.length;
        if (boundedInitialJobAid && step.sourceRefs.length > INITIAL_JOBAID_SOURCE_REFS_PER_READ)
          throw new Error('JOBAID_SOURCE_BATCH_TOO_LARGE');
        receipt = await readJobAidSourceBatches({
          sourceRefs: step.sourceRefs,
          purpose: step.purpose,
          context: step.context,
        }, options.readAssessmentSources);
        if (receipt?.status !== 'AVAILABLE' || !Array.isArray(receipt.evidence))
          throw new Error('JOBAID_SOURCE_READ_FAILED');
        if (boundedInitialJobAid) {
          readsSinceSave++;
          forceSaveBeforeRead = true;
          nativeSessionSegment++;
          sessionResetKind = 'SOURCE_READ';
        }
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
          const priorWorkRevision = expectedWorkRevision;
          submittedWork = parseJobAidWorkJson(step.workJson);
          receipt = await save(submittedWork);
          if (boundedInitialJobAid && expectedWorkRevision > priorWorkRevision) {
            readsSinceSave = 0;
            forceSaveBeforeRead = false;
            nativeSessionSegment++;
            sessionResetKind = 'SAVE';
          }
        }
        else if (step.action === 'SAVE_WORK')
          throw new Error('JOBAID_WORK_REQUIRED');
        if (step.action === 'FINISH') {
          if (!saved || (saved.roundCompletion === 'IN_PROGRESS' &&
              modelInput.overviewCorrectionProtocol !== 'OPENCLAW_SCOPED_V1'))
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
      const invalidWorkJson = code === 'JOBAID_WORK_JSON_INVALID' && !submittedWork;
      const sourcePolicyNotFollowed = boundedInitialJobAid && corrections >= maxCorrections &&
        ['JOBAID_SOURCE_BATCH_TOO_LARGE', 'JOBAID_SOURCE_BATCH_SAVE_REQUIRED'].includes(code);
      if (corrections >= maxCorrections && (sourcePolicyNotFollowed || invalidWorkJson || (submittedWork && error?.hostErrorCode &&
          /^JOBAID_[A-Z_]+(?::[A-Za-z0-9:_-]+)?$/u.test(code) &&
          !/AUTHORIZATION|LEASE|REVISION_CONFLICT|VERSION_CHANGED|BUDGET|GATEWAY|READ_FAILED|ATTEMPT/.test(code)))) {
        // Invalid JSON never reaches SAVE. Together with explicit Host rejection,
        // this is a known exhausted failure, not an ambiguous write to replay.
        error.terminalAssessmentFailure = { errorCode: sourcePolicyNotFollowed
          ? 'JOBAID_SOURCE_BATCH_POLICY_NOT_FOLLOWED'
          : invalidWorkJson ? 'JOBAID_WORK_JSON_INVALID' : 'JOBAID_WORK_VALIDATION_FAILED', provenance: {
          modelVersion: `configured-route:${options.executionModel?.modelRef ?? options.configuredModelVersion}`,
          promptVersion: 'wiselink-jobaid-problem@v2', skillVersion: WISELINK_SKILL_VERSION,
          toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION, 'jobaid-problem-protocol': '2' },
          runMetrics: { durationMs: Date.now() - startedAt, inputUnits, outputUnits },
        } };
      }
      if (
        !/^JOBAID_[A-Z_]+(?::[A-Za-z0-9:_-]+)?$/u.test(code) ||
        /AUTHORIZATION|LEASE|REVISION_CONFLICT|VERSION_CHANGED|BUDGET|GATEWAY|READ_FAILED|ATTEMPT/.test(
          code,
        ) ||
        corrections >= maxCorrections
      )
        throw error;
      corrections += 1;
      const shapeCorrection = workShapeCorrection(code, submittedWork, modelInput);
      const sourcePolicy = sourceBatchPolicyFeedback(code, requestedSourceRefCount, readsSinceSave);
      receipt = {
        accepted: false,
        errorCode: code,
        expectedWorkRevision,
        instruction: sourcePolicy.instruction ??
          'Correct only the rejected step or substantive work using the original evidence. Existing saved work remains available; never invent sources or turn failure into completion.',
        ...sourcePolicy,
        ...shapeCorrection,
        ...(code === 'JOBAID_SOURCE_NOT_DELIVERED' && error.hostRejectedSourceRef ? {
          sourceRef: error.hostRejectedSourceRef,
          instruction: 'The Host rejected this exact source reference from your candidate. Read it through READ_SOURCES if it belongs to the authorized catalog or document range. If unavailable, preserve the limitation and revise the unsupported assertion. Do not guess another identifier, silently drop supported analysis, or treat the failed save as completed.' +
            (shapeCorrection.instruction ? ` ${shapeCorrection.instruction}` : ''),
        } : {}),
      };
      await options.observeCandidateRejection?.({
        modelRound: round,
        correctionNo: corrections,
        code,
        ...(receipt.fieldErrors ? { fieldErrors: receipt.fieldErrors } : {}),
      });
    }
    // The configured Gateway resumes this native session's history. Keep one
    // copy of the context and earlier source bodies in that history.
    messages = sessionResetKind === 'SOURCE_READ' ? [
      systemMessage,
      initialContextMessage,
      { role: 'user', content: JSON.stringify({
        schemaVersion: 'wiselink.jobaid-source-read-continuation.v1',
        status: 'HOST_SOURCE_READ_CONFIRMED',
        expectedWorkRevision,
        sourceReadReceipt: projectJobAidReadReceipt(receipt, sourceMetadata),
        instruction: '这是一次成功且已由 Host 确认的来源读取。当前新 OpenClaw 会话已收到完整 Host 回执和来源正文。请立即基于已交付材料提交一项有价值、完整的 SAVE_WORK，明确保留尚未读取的范围和问题。当前工具只允许 SAVE_WORK；不得再读来源、不得声称未读来源已核验。保存成功后运行器会精确读回 Host 工作并在下一新会话继续。',
      }) },
    ] : sessionResetKind === 'SAVE' ? [
      systemMessage,
      initialContextMessage,
      { role: 'user', content: JSON.stringify({
        schemaVersion: 'wiselink.jobaid-continuation-receipt.v1',
        status: 'HOST_SAVE_CONFIRMED',
        workRevisionRef: saved.workRevisionRef,
        workRevision: saved.workRevision,
        roundCompletion: saved.roundCompletion,
        readSourceRefs: savedReadSourceRefs,
        instruction: '这是同一 Host attempt 在确认保存后的续段。previousWork 是同一 attempt 刚读回的完整工作基线。继续检查未覆盖范围并保留已有问题；本条 readSourceRefs 只证明先前已保存的来源读取，不是本新会话中可直接引用的正文。若新判断需要原文，先用 READ_SOURCES；每次只读一个不超过 10 refs 的批次，再保存增量。不得重放先前 SAVE_WORK。',
      }) },
    ] : [
      systemMessage,
      ...(round === 1 && options.recoveredInitialContext ? [initialContextMessage] : []),
      { role: 'assistant', content: null, tool_calls: [call] },
      {
        role: 'tool',
        tool_call_id: call.id,
        name: FUNCTION,
        content: JSON.stringify(projectJobAidReadReceipt(receipt, sourceMetadata)),
      },
    ];
    await persistAssessmentState(round + 1);
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
  if (['JOBAID_READING_SUMMARY_REQUIRED', 'JOBAID_READING_SUMMARY_PAIR_REQUIRED'].includes(code)) {
    return { instruction: 'The Host requires headline and listBrief together for the initial saved work or an explicit summary revision. Supply a concise engineering topic and a short explanation of the actual saved understanding, preserving decisive conditions and uncertainty. Do not copy the first issue question, invent a conclusion, or rerun source reading. Preserve the complete issue bodies and evidence. Later updates may omit both fields only to retain an existing saved summary.' };
  }
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
  const fieldErrors = jobAidWorkTypeErrors(work);
  if (!fieldErrors.length) return {};
  return {
    fieldErrors,
    instruction:
      'Use exact delivered [[evidenceRef]] citations in body. Do not generate redundant dependency fields. Correct the reported field types using the original evidence and the work-update shape. conditions, limitations and basisRefs are arrays of strings; addresses is one non-empty string describing the problem or risk addressed. Preserve justified analysis and unknowns; do not invent content or remove substantive work merely to pass validation. The Host will validate the revised work.' +
      (fieldErrors.some(error => error.received === 'undeclared field')
        ? ' The reported undeclared fields are not accepted at those paths; allowedFields lists the current contract. Preserve their substantive meaning in the relevant issue body or declared field. openQuestions belongs to an issue; explicit scheduling changes use reviewConditionDelta, not a full reviewConditions list. Work revision is assigned by Host, not authored in workJson.' : '') +
      (code === 'JOBAID_MEASURE_ADDRESSES_INVALID'
        ? ' The rejected field is addresses; changing status does not repair it.'
        : ''),
  };
}
