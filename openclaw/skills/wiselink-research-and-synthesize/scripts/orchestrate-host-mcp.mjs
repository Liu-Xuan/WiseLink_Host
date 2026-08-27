import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_MODEL_VERSION,
  WISELINK_PROFILE_REF,
  WISELINK_RUNTIME_APP_ID,
  WISELINK_SKILL_VERSION,
  WISELINK_APPLICABILITY_PROMPT_VERSION,
  buildApplicabilityCandidate,
  canonicalJson,
  isForbiddenAuthorityInputKey,
  normalizeAuthorityInputKey,
  sealResultEnvelope,
  sealWaitingInputResultEnvelope,
  serializeDynamicRulesCommitOutput,
  validatePayload,
  validateApplicabilityAstCandidate,
  validateResultEnvelope,
  validateReviewCandidate,
  validateReviewTask,
  validateRuntimeProvenance,
  validateTaskEnvelope,
} from './validate-payload.mjs';

export const WISELINK_SESSION_MODES = [
  'INITIAL_ANALYSIS',
  'INTERACTIVE_REVIEW',
];

export const INITIAL_ANALYSIS_OPERATIONS = [
  'TRANSLATE',
  'EXTRACT_APPLICABILITY',
  'EVALUATE_JOBAID',
  'SYNTHESIZE_OVERALL',
];

export const INTERACTIVE_REVIEW_TOOLS = [
  'begin_review_turn',
  'get_review_turn_context',
  'read_source_refs',
  'get_action_attempt_status',
  'commit_review_turn_candidate',
];

export const HOST_MCP_TOOLS = [
  'get_parse_status',
  'query_parsed_package',
  'get_deep_link',
  'begin_translation',
  'commit_translation_candidate',
  'begin_applicability_evaluation',
  'commit_applicability_candidate',
  'begin_dynamic_evaluation',
  'commit_dynamic_evaluation_candidate',
  'record_oem_discovery_run',
  'begin_overall_synthesis',
  'resume_overall_synthesis',
  'commit_overall_candidate',
  'begin_review_turn',
  'get_review_turn_context',
  'read_source_refs',
  'get_action_attempt_status',
  'commit_review_turn_candidate',
  'heartbeat_action_attempt',
  'cancel_action_attempt',
];

const DYNAMIC_COMMIT_STATUSES = new Set([
  'BASE_RULE_CANDIDATE_READY',
  'OVERALL_CANDIDATE_STALE',
]);

/**
 * Route one Host-authorized INITIAL_ANALYSIS operation. Each operation keeps
 * its dedicated Host begin/commit lifecycle; dynamic evaluation never stands
 * in for applicability.
 */
export async function runInitialAnalysis(input) {
  if (input?.mode !== 'INITIAL_ANALYSIS') {
    throw new Error('INITIAL_ANALYSIS_MODE_REQUIRED');
  }
  switch (input.operation) {
    case 'TRANSLATE':
      return runTranslation(input);
    case 'EXTRACT_APPLICABILITY':
      return runApplicabilityEvaluation(input);
    case 'EVALUATE_JOBAID':
      return runDynamicEvaluation(input);
    case 'SYNTHESIZE_OVERALL':
      return runOverallSynthesis(input);
    default:
      throw new Error('INITIAL_ANALYSIS_OPERATION_UNSUPPORTED');
  }
}

export async function runTranslation({ workItemId, callTool, translate }) {
  assertCallbacks(workItemId, callTool, translate);
  const before = await callTool('get_parse_status', { workItemId });
  const begin = await callTool('begin_translation', { workItemId });
  assertBegin(begin, 'OPENCLAW_TRANSLATE');
  if (begin.status === 'COMMITTING') {
    return recoverInitialCommitting({
      stage: 'TRANSLATE',
      workItemId,
      before,
      begin,
      callTool,
    });
  }
  validatePayload('translation-input', begin.modelInput);
  const execution = normalizeExecution(
    await translate(structuredClone(begin.modelInput)),
  );
  validatePayload('translation-pair', {
    input: begin.modelInput,
    output: execution.output,
  });
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: execution.output,
    provenance: execution.provenance,
    factsConsidered: begin.modelInput.sourceUnits.map(({ unitKey }) => unitKey),
  });
  let committed;
  try {
    committed = await callTool(
      'commit_translation_candidate',
      commitArgs(begin, result),
    );
    assertTranslationCommit(committed, workItemId);
  } catch (error) {
    return recoverCommitResponseLoss({
      mode: 'INITIAL_ANALYSIS',
      operation: 'TRANSLATE',
      before,
      begin,
      result,
      callTool,
      cause: error,
    });
  }
  const after = await callTool('get_parse_status', { workItemId });
  const deepLink = await callTool('get_deep_link', { workItemId });
  return completedResult({
    mode: 'INITIAL_ANALYSIS',
    operation: 'TRANSLATE',
    before,
    committed,
    after,
    deepLink,
    result,
  });
}

export async function runApplicabilityEvaluation({
  applicabilityContextRef,
  requestId,
  callTool,
  extractApplicability,
  runtimeProvenance,
}) {
  requiredText(
    applicabilityContextRef,
    'HOST_MCP_APPLICABILITY_CONTEXT_REF_REQUIRED',
  );
  requiredText(requestId, 'HOST_MCP_APPLICABILITY_REQUEST_ID_REQUIRED');
  if (typeof callTool !== 'function') {
    throw new Error('HOST_MCP_CALLBACK_REQUIRED');
  }
  const begin = await callTool('begin_applicability_evaluation', {
    applicabilityContextRef,
    requestId,
  });
  assertBegin(begin, 'OPENCLAW_APPLICABILITY_EVALUATION');
  validatePayload('applicability-input', begin.modelInput);
  const workItemId = begin.task.workItemId;
  const before = await callTool('get_parse_status', { workItemId });
  if (begin.status === 'COMMITTING') {
    return recoverInitialCommitting({
      stage: 'EXTRACT_APPLICABILITY',
      before,
      begin,
      callTool,
    });
  }

  let result;
  if (begin.task.hostResolvedMissingInputs.length > 0) {
    result = sealWaitingInputResultEnvelope({
      task: begin.task,
      provenance: normalizeApplicabilityProvenance(runtimeProvenance),
    });
  } else {
    if (typeof extractApplicability !== 'function') {
      throw new Error('HOST_MCP_APPLICABILITY_MODEL_CALLBACK_REQUIRED');
    }
    const execution = normalizeExecution(
      await extractApplicability(structuredClone(begin.modelInput)),
    );
    assertApplicabilityPromptVersion(execution.provenance);
    const astCandidate = validateApplicabilityAstCandidate(
      execution.output,
      begin.modelInput,
    );
    const candidate = buildApplicabilityCandidate(
      begin.modelInput,
      astCandidate,
    );
    result = sealResultEnvelope({
      task: begin.task,
      modelOutput: candidate,
      provenance: execution.provenance,
      factsConsidered: begin.modelInput.controlledFacts.map(
        ({ factId }) => factId,
      ),
    });
  }

  let committed;
  try {
    committed = await callTool(
      'commit_applicability_candidate',
      commitArgs(begin, result),
    );
    assertApplicabilityCommit(committed, begin, result);
  } catch (error) {
    return recoverCommitResponseLoss({
      mode: 'INITIAL_ANALYSIS',
      operation: 'EXTRACT_APPLICABILITY',
      before,
      begin,
      result,
      callTool,
      cause: error,
    });
  }
  const after = await callTool('get_parse_status', { workItemId });
  const deepLink = await callTool('get_deep_link', { workItemId });
  return completedResult({
    mode: 'INITIAL_ANALYSIS',
    operation: 'EXTRACT_APPLICABILITY',
    outcome:
      result.status === 'WAITING_INPUT' ? 'WAITING_INPUT' : 'CANDIDATE_ONLY',
    before,
    committed,
    after,
    deepLink,
    result,
  });
}

export async function runDynamicEvaluation({
  workItemId,
  query,
  callTool,
  evaluateDynamicRules,
}) {
  assertCallbacks(workItemId, callTool, evaluateDynamicRules);
  const before = await callTool('get_parse_status', { workItemId });
  const begin = await callTool('begin_dynamic_evaluation', { workItemId });
  assertBegin(begin, 'OPENCLAW_DYNAMIC_EVALUATION');
  if (begin.status === 'COMMITTING') {
    return recoverInitialCommitting({
      stage: 'EVALUATE_JOBAID',
      workItemId,
      before,
      begin,
      callTool,
    });
  }
  validatePayload('dynamic-rules-input', begin.modelInput);
  const execution = normalizeExecution(
    await evaluateDynamicRules(structuredClone(begin.modelInput)),
  );
  const serializedOutput = serializeDynamicRulesCommitOutput(
    begin.modelInput,
    execution.output,
  );
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: serializedOutput,
    provenance: execution.provenance,
    factsConsidered: execution.output.ruleResults.rows.map((row) => row[0]),
  });
  let committed = null;
  let after = null;
  try {
    committed = await callTool(
      'commit_dynamic_evaluation_candidate',
      commitArgs(begin, result),
    );
    assertDynamicCommit(committed, workItemId);
  } catch (error) {
    return recoverCommitResponseLoss({
      mode: 'INITIAL_ANALYSIS',
      operation: 'EVALUATE_JOBAID',
      before,
      begin,
      result,
      callTool,
      cause: error,
    });
  }
  after ??= await callTool('get_parse_status', { workItemId });
  const parsed =
    query === undefined
      ? null
      : await callTool('query_parsed_package', {
          workItemId,
          query: requiredText(query, 'HOST_MCP_QUERY_REQUIRED'),
        });
  const parsedReaderSummary =
    parsed === null ? null : summarizeQueryParsedPackage(parsed);
  const deepLink = await callTool('get_deep_link', { workItemId });
  return {
    ...completedResult({
      mode: 'INITIAL_ANALYSIS',
      operation: 'EVALUATE_JOBAID',
      before,
      committed,
      after,
      deepLink,
      result,
    }),
    commitRecoveredByReadback: false,
    parsed,
    parsedReaderSummary,
  };
}

export async function runOverallSynthesis({
  workItemId,
  providers = [],
  callTool,
  synthesizeOverall,
}) {
  assertCallbacks(workItemId, callTool, synthesizeOverall);
  const selectedProviders = validateProviders(providers);
  const before = await callTool('get_parse_status', { workItemId });
  assertOverallSynthesisReady(before);
  const begin = await callTool('begin_overall_synthesis', {
    workItemId,
    providers: selectedProviders,
  });
  assertBegin(begin, 'OPENCLAW_OVERALL_SYNTHESIS');
  assertOverallInput(begin, selectedProviders);
  if (begin.status === 'COMMITTING') {
    return recoverInitialCommitting({
      stage: 'SYNTHESIZE_OVERALL',
      workItemId,
      before,
      begin,
      callTool,
    });
  }
  return completeOverall({
    workItemId,
    before,
    begin,
    callTool,
    synthesizeOverall,
  });
}

export async function resumeOverallSynthesis({
  workItemId,
  attemptRef,
  callTool,
  synthesizeOverall,
}) {
  assertCallbacks(workItemId, callTool, synthesizeOverall);
  requiredText(attemptRef, 'HOST_MCP_OVERALL_ATTEMPT_REF_REQUIRED');
  const resumed = await callTool('resume_overall_synthesis', { attemptRef });
  assertBegin({ ...resumed, status: 'RUNNING' }, 'OPENCLAW_OVERALL_SYNTHESIS');
  assertOverallInput(resumed, resumed.task.allowedConnectors);
  return completeOverall({
    workItemId,
    before: null,
    begin: resumed,
    callTool,
    synthesizeOverall,
    resumed: true,
  });
}

async function completeOverall({
  workItemId,
  before,
  begin,
  callTool,
  synthesizeOverall,
  resumed = false,
}) {
  validatePayload('synthesis-input', begin.modelInput);
  const execution = normalizeExecution(
    await synthesizeOverall(structuredClone(begin.modelInput)),
  );
  validatePayload('synthesis-pair', {
    input: begin.modelInput,
    output: execution.output,
  });
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: execution.output,
    provenance: execution.provenance,
    factsConsidered: begin.modelInput.baseRuleResult.items.map(
      ({ criterionId }) => criterionId,
    ),
  });
  let committed = null;
  let after = null;
  try {
    committed = await callTool(
      'commit_overall_candidate',
      commitArgs(begin, result),
    );
    assertOverallCommit(committed, workItemId);
  } catch (error) {
    return recoverCommitResponseLoss({
      mode: 'INITIAL_ANALYSIS',
      operation: 'SYNTHESIZE_OVERALL',
      before,
      begin,
      result,
      callTool,
      cause: error,
    });
  }
  after ??= await callTool('get_parse_status', { workItemId });
  const deepLink = await callTool('get_deep_link', { workItemId });
  return {
    ...completedResult({
      mode: 'INITIAL_ANALYSIS',
      operation: 'SYNTHESIZE_OVERALL',
      before,
      committed,
      after,
      deepLink,
      result,
    }),
    resumed,
    selectedDiscoveryRefs: [...begin.selectedDiscoveryRefs],
    commitRecoveredByReadback: false,
  };
}

export async function runInteractiveReviewTurn({
  mode,
  reviewConversationRef,
  requestId,
  callTool,
  respond,
}) {
  if (mode !== 'INTERACTIVE_REVIEW') {
    throw new Error('INTERACTIVE_REVIEW_MODE_REQUIRED');
  }
  requiredText(reviewConversationRef, 'REVIEW_CONVERSATION_REF_REQUIRED');
  requiredText(requestId, 'REVIEW_REQUEST_ID_REQUIRED');
  if (typeof callTool !== 'function' || typeof respond !== 'function') {
    throw new Error('HOST_MCP_CALLBACK_REQUIRED');
  }
  const begin = await callTool('begin_review_turn', {
    reviewConversationRef,
    requestId,
  });
  assertBegin(begin, 'OPENCLAW_INTERACTIVE_REVIEW');
  const task = validateReviewTask(begin.task.modelInput);
  if (begin.status === 'COMMITTING') {
    return recoverReviewCommitting(begin, callTool);
  }
  const contextResult = await callTool('get_review_turn_context', {
    attemptRef: begin.attemptRef,
  });
  assertReviewContext(contextResult, begin, task);
  const readSourceRefIds = new Set();
  const readSourceRefs = async (sourceRefIds) => {
    const requested = validateReviewSourceRefRequest(sourceRefIds, task);
    const response = await callTool('read_source_refs', {
      attemptRef: begin.attemptRef,
      sourceRefIds: requested,
    });
    const sanitized = sanitizeSourceRefReadback(
      response,
      begin.attemptRef,
      requested,
    );
    requested.forEach((sourceRefId) => readSourceRefIds.add(sourceRefId));
    return sanitized;
  };
  const safeModelInput = buildReviewModelInput(task, contextResult);
  const execution = normalizeExecution(
    await respond({
      input: safeModelInput,
      readSourceRefs,
    }),
  );
  const candidate = validateReviewCandidate(task, execution.output);
  assertReviewSourcesWereRead(candidate, readSourceRefIds);
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: candidate,
    provenance: execution.provenance,
    sourceRefs: reviewArtifactRefs(task, candidate),
    factsConsidered: [...candidate.sourceRefs],
    warnings: [...candidate.warnings],
  });
  let committed;
  try {
    committed = await callTool(
      'commit_review_turn_candidate',
      commitArgs(begin, result),
    );
  } catch (error) {
    return recoverCommitResponseLoss({
      mode: 'INTERACTIVE_REVIEW',
      operation: 'REVIEW_TURN',
      before: contextResult,
      begin,
      result,
      callTool,
      cause: error,
    });
  }
  assertReviewCommit(committed, begin.attemptRef);
  return completedResult({
    mode: 'INTERACTIVE_REVIEW',
    operation: 'REVIEW_TURN',
    before: contextResult,
    committed,
    after: null,
    deepLink: null,
    result,
  });
}

async function recoverReviewCommitting(begin, callTool) {
  return recoverCommitting({
    mode: 'INTERACTIVE_REVIEW',
    operation: 'REVIEW_TURN',
    before: null,
    begin,
    callTool,
  });
}

async function recoverInitialCommitting({ stage, before, begin, callTool }) {
  return recoverCommitting({
    mode: 'INITIAL_ANALYSIS',
    operation: stage,
    before,
    begin,
    callTool,
  });
}

async function recoverCommitting({ mode, operation, before, begin, callTool }) {
  if (!begin.recoveryResult) {
    throw new Error('HOST_MCP_COMMITTING_RECOVERY_UNAVAILABLE');
  }
  validateResultEnvelope(begin.task, begin.recoveryResult);
  const status = await callTool('get_action_attempt_status', {
    attemptRef: begin.attemptRef,
  });
  assertGenericAttemptStatus(status, begin);
  if (
    status.status !== 'COMMITTING' ||
    status.recoveryAvailable !== true ||
    !status.recoveryResult
  ) {
    throw new Error('HOST_MCP_COMMITTING_RECOVERY_UNAVAILABLE');
  }
  validateResultEnvelope(begin.task, status.recoveryResult);
  if (
    status.resultContentHash !== begin.recoveryResult.contentHash ||
    status.recoveryResult.contentHash !== begin.recoveryResult.contentHash
  ) {
    throw new Error('HOST_MCP_COMMITTING_RESULT_HASH_MISMATCH');
  }
  return {
    ok: false,
    mode,
    operation,
    outcome: 'COMMITTING_RECOVERY_READ_ONLY',
    attemptRef: begin.attemptRef,
    before,
    status,
    provenance: resultProvenance(status.recoveryResult),
  };
}

async function recoverCommitResponseLoss({
  mode,
  operation,
  before,
  begin,
  result,
  callTool,
  cause,
}) {
  let status;
  try {
    status = await callTool('get_action_attempt_status', {
      attemptRef: begin.attemptRef,
    });
    assertGenericAttemptStatus(status, begin);
  } catch {
    throw outcomeUnknown('HOST_MCP_COMMIT_READBACK_FAILED', cause, null);
  }
  if (
    !['COMMITTING', 'SUCCEEDED', 'WAITING_INPUT', 'FAILED'].includes(
      status.status,
    ) ||
    status.resultContentHash !== result.contentHash
  ) {
    throw outcomeUnknown('HOST_MCP_COMMIT_OUTCOME_UNKNOWN', cause, status);
  }
  if (status.status === 'COMMITTING') {
    if (status.recoveryAvailable !== true || !status.recoveryResult) {
      throw outcomeUnknown('HOST_MCP_COMMIT_OUTCOME_UNKNOWN', cause, status);
    }
    validateResultEnvelope(begin.task, status.recoveryResult);
    if (status.recoveryResult.contentHash !== result.contentHash) {
      throw outcomeUnknown('HOST_MCP_COMMIT_OUTCOME_UNKNOWN', cause, status);
    }
  }
  return {
    ok: status.status === 'SUCCEEDED',
    mode,
    operation,
    outcome: 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY',
    attemptRef: begin.attemptRef,
    before,
    status,
    provenance: resultProvenance(result),
  };
}

export async function recordDiscoveryRuns({
  workItemId,
  observations,
  callTool,
}) {
  requiredText(workItemId, 'HOST_MCP_WORKITEM_REQUIRED');
  if (!Array.isArray(observations) || typeof callTool !== 'function') {
    throw new Error('HOST_MCP_DISCOVERY_INPUT_INVALID');
  }
  const results = [];
  for (const observation of observations) {
    const preserved = preserveDiscoveryObservation(observation);
    let recorded;
    try {
      recorded = await callTool('record_oem_discovery_run', {
        workItemId,
        result: publicDiscoveryResult(preserved),
      });
    } catch (error) {
      throw outcomeUnknown(
        'HOST_MCP_DISCOVERY_COMMIT_OUTCOME_UNKNOWN',
        error,
        null,
      );
    }
    assertDiscoveryRecord(recorded, preserved, workItemId);
    results.push({ observation: preserved, recorded });
  }
  return results;
}

export function preserveDiscoveryObservation(observation) {
  validatePayload('discovery-output', observation);
  return structuredClone(observation);
}

export function assertOverallSynthesisReady(statusResult) {
  const dynamicRules = statusResult?.integratedAssessmentSummary?.baseRules;
  if (
    !dynamicRules ||
    dynamicRules.status !== 'CANDIDATE_ONLY' ||
    !Number.isSafeInteger(dynamicRules.criterionCount) ||
    dynamicRules.criterionCount < 1 ||
    dynamicRules.evaluationItemCount !== dynamicRules.criterionCount
  ) {
    throw new Error('HOST_MCP_OVERALL_REQUIRES_PERSISTED_DYNAMIC_N');
  }
  return statusResult;
}

export function summarizeQueryParsedPackage(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.resultCount) ||
    value.resultCount < 0 ||
    !Array.isArray(value.results)
  ) {
    throw new Error('HOST_MCP_QUERY_RESULT_SHAPE_UNSUPPORTED');
  }
  if (value.resultCount !== value.results.length) {
    throw new Error('HOST_MCP_QUERY_RESULT_COUNT_MISMATCH');
  }
  const uniqueSourceRefIds = new Set();
  let sourceBoundResultCount = 0;
  for (const result of value.results) {
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof result.unitId !== 'string' ||
      typeof result.kind !== 'string' ||
      typeof result.text !== 'string' ||
      !Array.isArray(result.sourceRefIds)
    ) {
      throw new Error('HOST_MCP_QUERY_RESULT_ITEM_INVALID');
    }
    if (result.sourceRefIds.length > 0) sourceBoundResultCount += 1;
    for (const sourceRefId of result.sourceRefIds) {
      uniqueSourceRefIds.add(
        requiredText(sourceRefId, 'HOST_MCP_QUERY_RESULT_SOURCE_REF_INVALID'),
      );
    }
  }
  const authorityCollections = {
    sourceExpressions: optionalArrayLength(
      value.sourceExpressions ?? value.applicability?.sourceExpressions,
      'sourceExpressions',
    ),
    normalizedCandidates: optionalArrayLength(
      value.normalizedCandidates ?? value.applicability?.normalizedCandidates,
      'normalizedCandidates',
    ),
    assignments: optionalArrayLength(
      value.assignments ?? value.applicability?.assignments,
      'assignments',
    ),
  };
  return {
    resultCount: value.resultCount,
    resultsLength: value.results.length,
    sourceBoundResultCount,
    uniqueSourceRefCount: uniqueSourceRefIds.size,
    authorityCollections,
    applicabilityAuthorityAvailable: Object.values(authorityCollections).some(
      (length) => length !== null && length > 0,
    ),
  };
}

function assertBegin(value, taskType) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('HOST_MCP_BEGIN_RESULT_INVALID');
  }
  const attemptRef = requiredText(
    value.attemptRef,
    'HOST_MCP_ATTEMPT_REF_REQUIRED',
  );
  if (!['RUNNING', 'COMMITTING'].includes(value.status)) {
    throw new Error('HOST_MCP_BEGIN_STATUS_INVALID');
  }
  requiredText(value.leaseToken, 'HOST_MCP_LEASE_TOKEN_REQUIRED');
  if (
    !Number.isSafeInteger(value.leaseGeneration) ||
    value.leaseGeneration < 1
  ) {
    throw new Error('HOST_MCP_LEASE_GENERATION_INVALID');
  }
  validateTaskEnvelope(value.task);
  if (
    value.task.taskType !== taskType ||
    value.task.operationRef !== attemptRef
  ) {
    throw new Error('HOST_MCP_BEGIN_TASK_BINDING_INVALID');
  }
  if (value.status === 'COMMITTING' && !value.recoveryResult) {
    throw new Error('HOST_MCP_COMMITTING_RECOVERY_REQUIRED');
  }
}

function assertOverallInput(value, providers) {
  if (
    !Array.isArray(value.selectedDiscoveryRefs) ||
    value.selectedDiscoveryRefs.some(
      (ref) => typeof ref !== 'string' || ref.trim() === '',
    ) ||
    !value.modelInput ||
    typeof value.modelInput !== 'object' ||
    Array.isArray(value.modelInput)
  ) {
    throw new Error('HOST_MCP_OVERALL_MODEL_INPUT_INVALID');
  }
  const actualProviders = [
    ...new Set(
      value.modelInput.externalDiscoveryResults?.map(
        ({ provider }) => provider,
      ),
    ),
  ].sort();
  if (canonicalJson(actualProviders) !== canonicalJson([...providers].sort())) {
    throw new Error('HOST_MCP_OVERALL_PROVIDER_SELECTION_MISMATCH');
  }
  if (value.selectedDiscoveryRefs.length !== actualProviders.length) {
    throw new Error('HOST_MCP_OVERALL_DISCOVERY_REF_COUNT_MISMATCH');
  }
}

function normalizeExecution(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'output') ||
    !Object.hasOwn(value, 'provenance') ||
    Object.keys(value).length !== 2
  ) {
    throw new Error('HOSTED_MODEL_EXECUTION_RESULT_INVALID');
  }
  validateRuntimeProvenance(value.provenance);
  if (
    !value.output ||
    typeof value.output !== 'object' ||
    Array.isArray(value.output)
  ) {
    throw new Error('HOSTED_MODEL_OUTPUT_INVALID');
  }
  return value;
}

function normalizeApplicabilityProvenance(value) {
  validateRuntimeProvenance(value);
  assertApplicabilityPromptVersion(value);
  return structuredClone(value);
}

function assertApplicabilityPromptVersion(provenance) {
  if (provenance.promptVersion !== WISELINK_APPLICABILITY_PROMPT_VERSION) {
    throw new Error('APPLICABILITY_PROMPT_POLICY_MISMATCH');
  }
}

function commitArgs(begin, result) {
  return {
    attemptRef: begin.attemptRef,
    leaseToken: begin.leaseToken,
    leaseGeneration: begin.leaseGeneration,
    result,
  };
}

function completedResult({
  mode,
  operation,
  outcome = 'CANDIDATE_ONLY',
  before,
  committed,
  after,
  deepLink,
  result,
}) {
  return {
    ok: true,
    mode,
    operation,
    outcome,
    before,
    committed,
    after,
    deepLink,
    provenance: resultProvenance(result),
  };
}

function resultProvenance(result) {
  return {
    modelVersion: result.modelVersion,
    promptVersion: result.promptVersion,
    skillVersion: result.skillVersion,
    toolVersions: structuredClone(result.toolVersions),
    contentHash: result.contentHash,
  };
}

function assertTranslationCommit(value, workItemId) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.workItemId !== workItemId ||
    !Number.isSafeInteger(value.workItemRevision) ||
    value.translation?.status !== 'CANDIDATE_ONLY'
  ) {
    throw new Error('HOST_MCP_TRANSLATION_COMMIT_RESULT_INVALID');
  }
}

function assertApplicabilityCommit(value, begin, result) {
  if (result.status === 'WAITING_INPUT') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value.attemptRef !== begin.attemptRef ||
      value.status !== 'WAITING_INPUT'
    ) {
      throw new Error('HOST_MCP_APPLICABILITY_WAITING_RESULT_INVALID');
    }
    return;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.workItemId !== begin.task.workItemId ||
    !Number.isSafeInteger(value.workItemRevision) ||
    value.status !== 'CANDIDATE_ONLY' ||
    value.applicability?.status !== 'CANDIDATE_ONLY' ||
    value.applicability?.actionAttemptId !== begin.task.actionAttemptId
  ) {
    throw new Error('HOST_MCP_APPLICABILITY_COMMIT_RESULT_INVALID');
  }
}

function assertDynamicCommit(value, workItemId) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.workItemId !== workItemId ||
    !Number.isSafeInteger(value.workItemRevision) ||
    !DYNAMIC_COMMIT_STATUSES.has(value.status)
  ) {
    throw new Error('HOST_MCP_DYNAMIC_COMMIT_RESULT_INVALID');
  }
}

function assertOverallCommit(value, workItemId) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.workItemId !== workItemId ||
    !Number.isSafeInteger(value.workItemRevision) ||
    value.status !== 'OVERALL_CANDIDATE_READY' ||
    value.overallSynthesis?.status !== 'CANDIDATE_ONLY' ||
    value.overallSynthesis?.authorityLevel !== 'candidate_only' ||
    value.overallSynthesis?.externalDiscoveryIsEvidence !== false
  ) {
    throw new Error('HOST_MCP_OVERALL_COMMIT_RESULT_INVALID');
  }
}

function assertReviewContext(value, begin, task) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 'wiselink.3_1.review_turn_context.v1.c2' ||
    value.attemptRef !== begin.attemptRef ||
    value.reviewConversationRef !== task.reviewConversationRef ||
    value.reviewTurnRef !== task.reviewTurnRef ||
    value.mode !== 'INTERACTIVE_REVIEW' ||
    value.inputRevision !== task.inputRevision ||
    canonicalJson(value.allowedOperations) !==
      canonicalJson(task.allowedOperations) ||
    canonicalJson(value.executionPolicy) !==
      canonicalJson(task.executionPolicy) ||
    !Array.isArray(value.resourceRefs) ||
    !value.context ||
    typeof value.context !== 'object' ||
    Array.isArray(value.context)
  ) {
    throw new Error('HOST_MCP_REVIEW_CONTEXT_INVALID');
  }
}

function buildReviewModelInput(task, contextResult) {
  const context = sanitizeForModel(contextResult.context);
  return {
    schemaVersion: 'wiselink.3_1.review_model_input.v1.c2',
    mode: 'INTERACTIVE_REVIEW',
    reviewConversationRef: task.reviewConversationRef,
    reviewTurnRef: task.reviewTurnRef,
    requestId: task.requestId,
    inputRevision: task.inputRevision,
    selectedEvaluationItemId: task.selectedEvaluationItemId,
    userMessage: task.userMessage,
    allowedOperations: [...task.allowedOperations],
    allowedEvaluationItemIds: [...task.allowedEvaluationItemIds],
    allowedAdoptedInputRefs: [...task.allowedAdoptedInputRefs],
    availableSourceRefIds: task.resourceRefs.map(
      ({ sourceRefId }) => sourceRefId,
    ),
    context,
    executionPolicy: structuredClone(task.executionPolicy),
  };
}

function sanitizeForModel(value, modelPath = '$') {
  if (typeof value === 'string') {
    if (
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu.test(value) ||
      /\b(?:api[_ -]?key|cookie|authorization)\s*[:=]/iu.test(value)
    ) {
      throw new Error(`REVIEW_MODEL_CREDENTIAL_FORBIDDEN:${modelPath}`);
    }
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      sanitizeForModel(item, `${modelPath}[${index}]`),
    );
  }
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeAuthorityInputKey(key);
    if (normalized === 'workitemid') continue;
    if (isForbiddenAuthorityInputKey(key)) {
      throw new Error(
        `REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:${modelPath}.${key}`,
      );
    }
    result[key] = sanitizeForModel(child, `${modelPath}.${key}`);
  }
  return result;
}

function validateReviewSourceRefRequest(sourceRefIds, task) {
  if (
    !Array.isArray(sourceRefIds) ||
    sourceRefIds.length < 1 ||
    sourceRefIds.length > 100 ||
    sourceRefIds.some(
      (value) => typeof value !== 'string' || value.trim() === '',
    ) ||
    new Set(sourceRefIds).size !== sourceRefIds.length
  ) {
    throw new Error('HOST_MCP_REVIEW_SOURCE_REF_REQUEST_INVALID');
  }
  const allowed = new Set(
    task.resourceRefs.map(({ sourceRefId }) => sourceRefId),
  );
  if (sourceRefIds.some((sourceRefId) => !allowed.has(sourceRefId))) {
    throw new Error('HOST_MCP_REVIEW_SOURCE_REF_NOT_ALLOWED');
  }
  return [...sourceRefIds];
}

function sanitizeSourceRefReadback(value, attemptRef, requested) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 'wiselink.3_1.review_source_refs.v1.c2' ||
    value.attemptRef !== attemptRef ||
    !Array.isArray(value.sourceRefs) ||
    value.sourceRefs.length !== requested.length
  ) {
    throw new Error('HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID');
  }
  value.sourceRefs.forEach((sourceRef, index) => {
    if (
      !sourceRef ||
      typeof sourceRef !== 'object' ||
      Array.isArray(sourceRef) ||
      sourceRef.sourceRefId !== requested[index]
    ) {
      throw new Error('HOST_MCP_REVIEW_SOURCE_REF_BINDING_INVALID');
    }
  });
  return value.sourceRefs.map((sourceRef, index) =>
    sanitizeForModel(sourceRef, `$.sourceRefs[${index}]`),
  );
}

function reviewArtifactRefs(task, candidate) {
  const used = new Set([
    ...candidate.sourceRefs,
    ...candidate.candidateEvidenceRefs,
    ...(candidate.reviewActionDraft?.sourceRefs ?? []),
  ]);
  const artifacts = new Map();
  for (const resource of task.resourceRefs) {
    if (!used.has(resource.sourceRefId)) continue;
    const existing = artifacts.get(resource.resourceArtifactRef);
    if (existing && existing !== resource.resourceArtifactSha256) {
      throw new Error('REVIEW_RESOURCE_ARTIFACT_BINDING_CONFLICT');
    }
    artifacts.set(
      resource.resourceArtifactRef,
      resource.resourceArtifactSha256,
    );
  }
  return [...artifacts].map(([ref, sha256]) => ({ ref, sha256 }));
}

function assertReviewSourcesWereRead(candidate, readSourceRefIds) {
  const used = [
    ...candidate.sourceRefs,
    ...candidate.candidateEvidenceRefs,
    ...(candidate.reviewActionDraft?.sourceRefs ?? []),
  ];
  if (used.some((sourceRefId) => !readSourceRefIds.has(sourceRefId))) {
    throw new Error('REVIEW_CANDIDATE_SOURCE_REF_NOT_READ_THIS_TURN');
  }
}

function assertGenericAttemptStatus(value, begin) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.attemptRef !== begin.attemptRef ||
    value.taskType !== begin.task.taskType ||
    typeof value.status !== 'string' ||
    typeof value.recoveryAvailable !== 'boolean' ||
    typeof value.projectionApplied !== 'boolean' ||
    (value.commitStartedAt !== null &&
      typeof value.commitStartedAt !== 'string') ||
    (value.terminalReason !== null &&
      typeof value.terminalReason !== 'string') ||
    (value.resultContentHash !== null &&
      typeof value.resultContentHash !== 'string')
  ) {
    throw new Error('HOST_MCP_ACTION_ATTEMPT_STATUS_INVALID');
  }
}

function assertReviewCommit(value, attemptRef) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 'wiselink.3_1.review_turn_commit.v1.c2' ||
    value.attemptRef !== attemptRef ||
    value.status !== 'SUCCEEDED' ||
    value.authority?.candidatePersisted !== true ||
    value.authority?.reviewActionExecuted !== false ||
    value.authority?.workItemRevisionChanged !== false ||
    value.authority?.currentChanged !== false ||
    value.authority?.staleMarked !== false
  ) {
    throw new Error('HOST_MCP_REVIEW_COMMIT_RESULT_INVALID');
  }
}

function publicDiscoveryResult(value) {
  const {
    runtime: _runtime,
    runtimeAppId: _runtimeAppId,
    observedAt: _observedAt,
    ...result
  } = value;
  return result;
}

function assertDiscoveryRecord(value, observation, workItemId) {
  const expectedStatus = {
    COMPLETE: 'CANDIDATES_FOUND',
    PARTIAL: 'PARTIAL_RESULTS',
    ZERO_RESULT: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
    ZERO_RESULTS_FOR_TARGET_IDENTIFIER: 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
    ACCESS_DENIED: 'ACCESS_DENIED',
    TRUNCATED: 'TRUNCATED',
  }[observation.resultStatus];
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.searchRunRef !== 'string' ||
    !value.searchRunRef.startsWith(
      `search:${observation.provider.toLowerCase()}:`,
    ) ||
    typeof value.observedAt !== 'string' ||
    value.observedAt.trim() === '' ||
    value.provider !== observation.provider ||
    value.resultStatus !== expectedStatus ||
    value.candidateCount !== observation.candidates.length ||
    typeof value.disposition !== 'string' ||
    value.disposition.trim() === '' ||
    value.documentManagementIoPerformed !== false ||
    value.candidateAdopted !== false
  ) {
    throw new Error(`HOST_MCP_DISCOVERY_RECORD_RESULT_INVALID:${workItemId}`);
  }
}

function validateProviders(providers) {
  if (
    !Array.isArray(providers) ||
    providers.length > 3 ||
    new Set(providers).size !== providers.length ||
    providers.some(
      (provider) => !['AIRBUS', 'BOEING', 'COMAC'].includes(provider),
    )
  ) {
    throw new Error('HOST_MCP_OVERALL_PROVIDERS_INVALID');
  }
  return [...providers];
}

function optionalArrayLength(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new Error(
      `HOST_MCP_QUERY_RESULT_AUTHORITY_COLLECTION_INVALID:${fieldName}`,
    );
  }
  return value.length;
}

function assertCallbacks(workItemId, callTool, modelCallback) {
  requiredText(workItemId, 'HOST_MCP_WORKITEM_REQUIRED');
  if (typeof callTool !== 'function' || typeof modelCallback !== 'function') {
    throw new Error('HOST_MCP_CALLBACK_REQUIRED');
  }
}

function outcomeUnknown(code, cause, readback) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  error.readback = readback;
  return error;
}

function requiredText(value, code) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value;
}

export const EXPECTED_HOSTED_PROVENANCE = Object.freeze({
  runtimeAppId: WISELINK_RUNTIME_APP_ID,
  profileRef: WISELINK_PROFILE_REF,
  modelVersion: WISELINK_MODEL_VERSION,
  skillVersion: WISELINK_SKILL_VERSION,
  toolVersions: Object.freeze({
    [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
  }),
});
