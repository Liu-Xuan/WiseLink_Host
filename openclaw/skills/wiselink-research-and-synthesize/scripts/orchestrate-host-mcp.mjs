import { readFile } from 'node:fs/promises';
import { modelExecutorProvenance } from './model-executor.mjs';
import { runSemanticTranslation } from './run-semantic-translation.mjs';
import { projectTdmsReviewSavedModelContext } from './tdms-review-saved-context.mjs';
import {
  assertTdmsReviewRuntimeBinding, assertTdmsReviewReadObservation,
  projectTdmsReviewReadSources, reviewNativeDirectoryRefs, reviewNativeRuntime,
  tdmsReviewDecisionCatalog, REVIEW_NATIVE_READ_TOOL,
} from './tdms-review-runtime-context.mjs';

import {
  WISELINK_HOST_MCP_NAME,
  WISELINK_HOST_MCP_VERSION,
  WISELINK_MODEL_POLICY_REF,
  WISELINK_PROFILE_REF,
  WISELINK_RUNTIME_APP_ID,
  WISELINK_SKILL_VERSION,
  WISELINK_APPLICABILITY_PROMPT_VERSION,
  REVIEW_MATTER_TASK_SCHEMA,
  REVIEW_JOBAID_TASK_SCHEMA,
  buildApplicabilityCandidate,
  canonicalJson,
  isForbiddenAuthorityInputKey,
  normalizeAuthorityInputKey,
  reviewCandidateArtifactRefs,
  reviewCandidateSourceRefIds,
  sealResultEnvelope,
  sealTranslationDeliveryResultEnvelope,
  sealWaitingInputResultEnvelope,
  serializeDynamicRulesCommitOutput,
  validatePayload,
  validateApplicabilityAstCandidate,
  validateResultEnvelope,
  validateReviewCandidate,
  validateSealedBoundedReviewCandidate,
  validateReviewTask,
  validateRuntimeProvenance,
  validateTaskEnvelope,
  validateTranslationDeliveryResultEnvelope,
  validateTranslationDeliveryTaskBinding,
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
  'query_review_aily',
  'begin_review_turn',
  'get_review_turn_context',
  'read_source_refs',
  'get_action_attempt_status',
  'commit_review_turn_candidate',
];

export const HOST_MCP_TOOLS = [
  'document_reading',
  'document_work',
  'read_document_original',
  'document_translation',
  'next_original_assessment',
  'next_matter_assessment',
  'begin_matter_assessment',
  'matter_action_attempt',
  'derived_summary_attempt',
  'next_hierarchical_wiki', 'hierarchical_wiki_next_matter_assessment',
  'hierarchical_wiki_read_matter_current_work', 'hierarchical_wiki_matter_action_attempt', 'hierarchical_wiki_cleanup',
  'read_matter_current_work',
  'query_review_aily',
  'get_parse_status',
  'query_parsed_package',
  'get_deep_link',
  'begin_translation',
  'commit_translation_candidate',
  'translation_workspace',
  'begin_applicability_evaluation',
  'commit_applicability_candidate',
  'begin_dynamic_evaluation',
  'commit_dynamic_evaluation_candidate',
  'read_assessment_sources',
  'query_assessment_knowledge',
  'save_assessment_work',
  'read_assessment_work',
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

export const CONFIGURATION_EVIDENCE_REEVALUATION_STATUS_SCHEMA =
  'wiselink.3_1.configuration_evidence_reevaluation_status.v1';

const CONFIGURATION_EVIDENCE_REEVALUATION_STAGES = [
  'APPLICABILITY',
  'JOB_AID',
  'OVERALL',
];
const CONFIGURATION_EVIDENCE_REEVALUATION_ACTIVE_STATUSES = new Set([
  'REQUIRED',
  'RUNNING',
]);
const CONFIGURATION_EVIDENCE_REEVALUATION_TERMINAL_STATUSES = new Set([
  'WAITING_INPUT',
  'FAILED',
  'CONFLICT',
]);
const CONFIGURATION_EVIDENCE_REEVALUATION_STATUSES = new Set([
  ...CONFIGURATION_EVIDENCE_REEVALUATION_ACTIVE_STATUSES,
  ...CONFIGURATION_EVIDENCE_REEVALUATION_TERMINAL_STATUSES,
  'SUCCEEDED',
]);
const CONFIGURATION_EVIDENCE_REEVALUATION_STAGE_STATUSES = new Set([
  'PENDING',
  'RUNNING',
  'COMMITTING',
  'SUCCEEDED',
  'WAITING_INPUT',
  'FAILED',
  'CONFLICT',
]);

const DYNAMIC_COMMIT_STATUSES = new Set([
  'BASE_RULE_CANDIDATE_READY',
  'OVERALL_CANDIDATE_STALE',
]);
export const TRANSLATION_COMMIT_PART_BYTES = 6_144;
const TRANSLATION_COMMIT_ARGUMENT_MAX_BYTES = 12_000;
const TRANSLATION_COMMIT_PART_MAX_COUNT = 64;

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

/**
 * Coordinate the Host-owned P0B full reevaluation after configuration
 * evidence adoption. The Host status is the only stage authority: serving
 * applicability/baseRules/overall may intentionally remain unchanged until
 * the final Host CAS, and the Skill never asks to see the staged bundle.
 */
export async function runConfigurationEvidenceReevaluation(input) {
  const workItemId = requiredText(
    input?.workItemId,
    'HOST_MCP_WORKITEM_REQUIRED',
  );
  if (typeof input?.callTool !== 'function') {
    throw new Error('HOST_MCP_CALLBACK_REQUIRED');
  }
  const operations = [];
  const initialStatusResult = await input.callTool('get_parse_status', {
    workItemId,
  });
  let reevaluation = parseConfigurationEvidenceReevaluationStatus(
    initialStatusResult,
    workItemId,
  );
  const initialReevaluation = structuredClone(reevaluation);
  const triggerBinding = configurationEvidenceTriggerBinding(reevaluation);

  while (operations.length < CONFIGURATION_EVIDENCE_REEVALUATION_STAGES.length) {
    if (reevaluation.status === 'SUCCEEDED') {
      return completedConfigurationEvidenceReevaluation({
        initialReevaluation,
        operations,
        reevaluation,
      });
    }
    if (
      CONFIGURATION_EVIDENCE_REEVALUATION_TERMINAL_STATUSES.has(
        reevaluation.status,
      )
    ) {
      return stoppedConfigurationEvidenceReevaluation({
        initialReevaluation,
        operations,
        reevaluation,
      });
    }
    if (
      !CONFIGURATION_EVIDENCE_REEVALUATION_ACTIVE_STATUSES.has(
        reevaluation.status,
      ) ||
      reevaluation.nextStage === null
    ) {
      throw new Error('HOST_P0B_STATUS_INVALID');
    }

    const stage = reevaluation.nextStage;
    const operationResult = await runConfigurationEvidenceStage({
      ...input,
      workItemId,
      reevaluation,
      stage,
    });
    operations.push({ stage, result: operationResult });

    const freshStatusResult = await input.callTool('get_parse_status', {
      workItemId,
    });
    const fresh = parseConfigurationEvidenceReevaluationStatus(
      freshStatusResult,
      workItemId,
    );
    assertConfigurationEvidenceTriggerBinding(fresh, triggerBinding);
    reevaluation = fresh;

    if (
      CONFIGURATION_EVIDENCE_REEVALUATION_TERMINAL_STATUSES.has(
        reevaluation.status,
      )
    ) {
      return stoppedConfigurationEvidenceReevaluation({
        initialReevaluation,
        operations,
        reevaluation,
      });
    }
    if (
      operationResult?.outcome === 'COMMITTING_RECOVERY_READ_ONLY' ||
      operationResult?.outcome ===
        'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY'
    ) {
      return {
        ok: false,
        mode: 'CONFIGURATION_EVIDENCE_REEVALUATION',
        outcome: operationResult.outcome,
        initialReevaluation: structuredClone(initialReevaluation),
        operations: structuredClone(operations),
        reevaluation: structuredClone(reevaluation),
      };
    }
    if (reevaluation.status === 'SUCCEEDED') {
      return completedConfigurationEvidenceReevaluation({
        initialReevaluation,
        operations,
        reevaluation,
      });
    }
    assertConfigurationEvidenceStageDidNotRegress(stage, fresh);
  }

  if (
    CONFIGURATION_EVIDENCE_REEVALUATION_TERMINAL_STATUSES.has(
      reevaluation.status,
    )
  ) {
    return stoppedConfigurationEvidenceReevaluation({
      initialReevaluation,
      operations,
      reevaluation,
    });
  }
  if (reevaluation.status !== 'SUCCEEDED') {
    throw new Error('HOST_P0B_REEVALUATION_DID_NOT_COMPLETE');
  }
  return completedConfigurationEvidenceReevaluation({
    initialReevaluation,
    operations,
    reevaluation,
  });
}

export function parseConfigurationEvidenceReevaluationStatus(
  statusResult,
  expectedWorkItemId,
) {
  if (!isRecord(statusResult)) throw new Error('HOST_P0B_STATUS_INVALID');
  if (
    expectedWorkItemId !== undefined &&
    statusResult.entry?.workItemId !== expectedWorkItemId
  ) {
    throw new Error('HOST_P0B_WORKITEM_BINDING_MISMATCH');
  }
  const value = statusResult.configurationEvidenceReevaluation;
  if (value === undefined || value === null) {
    throw new Error('HOST_P0B_STATUS_UNAVAILABLE');
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !==
      CONFIGURATION_EVIDENCE_REEVALUATION_STATUS_SCHEMA ||
    value.mode !== 'FULL_APPLICABILITY_JOB_AID_OVERALL' ||
    !CONFIGURATION_EVIDENCE_REEVALUATION_STATUSES.has(value.status) ||
    typeof value.servingCurrentPreserved !== 'boolean' ||
    value.candidateOnly !== true
  ) {
    throw new Error('HOST_P0B_STATUS_INVALID');
  }
  const triggerSnapshotId = requiredText(
    value.triggerSnapshotId,
    'HOST_P0B_TRIGGER_SNAPSHOT_REQUIRED',
  );
  if (
    !Number.isSafeInteger(value.triggerConfigurationRevision) ||
    value.triggerConfigurationRevision < 1
  ) {
    throw new Error('HOST_P0B_TRIGGER_REVISION_INVALID');
  }
  if (!Object.hasOwn(value, 'nextStage')) {
    throw new Error('HOST_P0B_NEXT_STAGE_REQUIRED');
  }
  const nextStage = value.nextStage;
  if (
    nextStage !== null &&
    !CONFIGURATION_EVIDENCE_REEVALUATION_STAGES.includes(nextStage)
  ) {
    throw new Error('HOST_P0B_NEXT_STAGE_INVALID');
  }
  if (
    CONFIGURATION_EVIDENCE_REEVALUATION_ACTIVE_STATUSES.has(value.status) &&
    nextStage === null
  ) {
    throw new Error('HOST_P0B_NEXT_STAGE_REQUIRED');
  }
  if (value.status === 'SUCCEEDED' && nextStage !== null) {
    throw new Error('HOST_P0B_SUCCEEDED_NEXT_STAGE_INVALID');
  }
  if (value.status !== 'SUCCEEDED' && value.servingCurrentPreserved !== true) {
    throw new Error('HOST_P0B_SERVING_CURRENT_NOT_PRESERVED');
  }

  const stages = parseConfigurationEvidenceStages(value.stages);
  assertConfigurationEvidenceStageOrder(value.status, nextStage, stages);
  return {
    schemaVersion: CONFIGURATION_EVIDENCE_REEVALUATION_STATUS_SCHEMA,
    triggerSnapshotId,
    triggerConfigurationRevision: value.triggerConfigurationRevision,
    mode: 'FULL_APPLICABILITY_JOB_AID_OVERALL',
    status: value.status,
    nextStage,
    stages,
    servingCurrentPreserved: value.servingCurrentPreserved,
    candidateOnly: true,
  };
}

async function runConfigurationEvidenceStage(input) {
  switch (input.stage) {
    case 'APPLICABILITY':
      return runApplicabilityEvaluation({
        applicabilityContextRef: input.applicabilityContextRef,
        requestId: input.applicabilityRequestId,
        expectedWorkItemId: input.workItemId,
        callTool: input.callTool,
        extractApplicability: input.extractApplicability,
        runtimeProvenance: input.runtimeProvenance,
      });
    case 'JOB_AID':
      return runDynamicEvaluation({
        workItemId: input.workItemId,
        callTool: input.callTool,
        evaluateDynamicRules: input.evaluateDynamicRules,
      });
    case 'OVERALL':
      return runOverallSynthesis({
        workItemId: input.workItemId,
        providers: [],
        callTool: input.callTool,
        synthesizeOverall: input.synthesizeOverall,
        configurationEvidenceReevaluation: input.reevaluation,
      });
    default:
      throw new Error('HOST_P0B_NEXT_STAGE_INVALID');
  }
}

function parseConfigurationEvidenceStages(value) {
  if (!isRecord(value)) throw new Error('HOST_P0B_STAGES_INVALID');
  return {
    applicability: parseConfigurationEvidenceStage(
      value.applicability,
      'APPLICABILITY',
    ),
    jobAid: parseConfigurationEvidenceStage(value.jobAid, 'JOB_AID'),
    overall: parseConfigurationEvidenceStage(value.overall, 'OVERALL'),
  };
}

function parseConfigurationEvidenceStage(value, name) {
  if (
    !isRecord(value) ||
    !CONFIGURATION_EVIDENCE_REEVALUATION_STAGE_STATUSES.has(value.status) ||
    !Number.isSafeInteger(value.retryNo) ||
    value.retryNo < 0
  ) {
    throw new Error(`HOST_P0B_${name}_STAGE_INVALID`);
  }
  return { status: value.status, retryNo: value.retryNo };
}

function assertConfigurationEvidenceStageOrder(status, nextStage, stages) {
  if (nextStage === 'JOB_AID' && stages.applicability.status !== 'SUCCEEDED') {
    throw new Error('HOST_P0B_APPLICABILITY_NOT_SUCCEEDED');
  }
  if (
    nextStage === 'OVERALL' &&
    (stages.applicability.status !== 'SUCCEEDED' ||
      stages.jobAid.status !== 'SUCCEEDED')
  ) {
    throw new Error('HOST_P0B_JOB_AID_NOT_SUCCEEDED');
  }
  if (
    status === 'SUCCEEDED' &&
    Object.values(stages).some((stage) => stage.status !== 'SUCCEEDED')
  ) {
    throw new Error('HOST_P0B_SUCCEEDED_STAGES_INVALID');
  }
}

function configurationEvidenceTriggerBinding(value) {
  return {
    triggerSnapshotId: value.triggerSnapshotId,
    triggerConfigurationRevision: value.triggerConfigurationRevision,
  };
}

function assertConfigurationEvidenceTriggerBinding(value, expected) {
  if (
    value.triggerSnapshotId !== expected.triggerSnapshotId ||
    value.triggerConfigurationRevision !==
      expected.triggerConfigurationRevision
  ) {
    throw new Error('HOST_P0B_TRIGGER_BINDING_CHANGED');
  }
}

function assertConfigurationEvidenceStageDidNotRegress(completedStage, fresh) {
  if (
    fresh.status === 'SUCCEEDED' ||
    CONFIGURATION_EVIDENCE_REEVALUATION_TERMINAL_STATUSES.has(fresh.status)
  ) {
    return;
  }
  const completedIndex =
    CONFIGURATION_EVIDENCE_REEVALUATION_STAGES.indexOf(completedStage);
  const nextIndex = CONFIGURATION_EVIDENCE_REEVALUATION_STAGES.indexOf(
    fresh.nextStage,
  );
  if (nextIndex <= completedIndex) {
    throw new Error('HOST_P0B_STAGE_DID_NOT_ADVANCE');
  }
}

function completedConfigurationEvidenceReevaluation(input) {
  return {
    ok: true,
    mode: 'CONFIGURATION_EVIDENCE_REEVALUATION',
    outcome: 'SUCCEEDED',
    initialReevaluation: structuredClone(input.initialReevaluation),
    operations: structuredClone(input.operations),
    reevaluation: structuredClone(input.reevaluation),
  };
}

function stoppedConfigurationEvidenceReevaluation(input) {
  return {
    ok: false,
    mode: 'CONFIGURATION_EVIDENCE_REEVALUATION',
    outcome: input.reevaluation.status,
    initialReevaluation: structuredClone(input.initialReevaluation),
    operations: structuredClone(input.operations),
    reevaluation: structuredClone(input.reevaluation),
  };
}

export async function runTranslation({ workItemId, callTool, translate, requestId, runtimeProvenance }) {
  assertCallbacks(workItemId, callTool, translate);
  const before = await callTool('get_parse_status', { workItemId });
  const begin = await collectTranslationDelivery(workItemId, callTool, requestId);
  if (begin.status === 'COMMITTING') {
    return recoverInitialCommitting({
      stage: 'TRANSLATE',
      workItemId,
      before,
      begin,
      callTool,
    });
  }
  if (begin.task?.modelInput?.schemaVersion === 'wiselink.3_1.translation_task.v2') {
    const modelExecutor = runtimeProvenance?.toolVersions?.['model-executor'] === 'CODEX' ? 'CODEX' : 'HOSTED';
    const execution = await runSemanticTranslation({ begin, callTool, translate, requestId, modelExecutor });
    let committed;
    try {
      committed = await callTool('commit_translation_candidate', commitArgs(begin, execution.result));
      assertTranslationCommit(committed, workItemId);
    } catch (error) {
      const recovered = await recoverCommitResponseLoss({ mode: 'INITIAL_ANALYSIS', operation: 'TRANSLATE', before, begin,
        result: execution.result, callTool, cause: error });
      if (recovered.status?.status !== 'COMMITTING') return recovered;
      // Only replay the identical prepared envelope, never call the model.
      committed = await callTool('commit_translation_candidate', commitArgs(begin, execution.result));
      assertTranslationCommit(committed, workItemId);
    }
    return { ...completedResult({ mode: 'INITIAL_ANALYSIS', operation: 'TRANSLATE', before, committed,
      after: await callTool('get_parse_status', { workItemId }), deepLink: await callTool('get_deep_link', { workItemId }), result: execution.result }),
      completeness: execution.completeness, modelRequestCount: execution.modelRequestCount };
  }
  validatePayload('translation-input', begin.modelInput);
  await heartbeatAttempt(begin, callTool);
  const execution = normalizeExecution(
    await translate(structuredClone(begin.modelInput), {
      heartbeat: () => heartbeatAttempt(begin, callTool),
    }),
  );
  validateTranslationBeforeCommit({
    input: begin.modelInput,
    output: execution.output,
  });
  await heartbeatAttempt(begin, callTool);
  const result = sealTranslationDeliveryResultEnvelope({
    taskBinding: begin.taskBinding,
    modelOutput: execution.output,
    provenance: execution.provenance,
    factsConsidered: begin.modelInput.sourceUnits.map(({ unitKey }) => unitKey),
  });
  let committed;
  try {
    committed = await commitTranslationResultParts({
      begin,
      result,
      callTool,
    });
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

function validateTranslationBeforeCommit({ input, output }) {
  // Fail with unit diagnostics before sealing or the first UPLOAD_PART. Host
  // remains the final authority and repeats these deterministic checks.
  validatePayload('translation-pair', { input, output });
}

/**
 * Commit a locally sealed translation payload without copying its full JSON
 * into one model-authored MCP argument. The file may contain the ResultEnvelope
 * itself or the former {attemptRef, leaseToken, leaseGeneration, result}
 * wrapper; wrapper fences must match the live begin result exactly.
 */
export async function commitTranslationPayloadFile({
  begin,
  payloadPath,
  callTool,
}) {
  if (typeof callTool !== 'function') {
    throw new Error('HOST_MCP_CALLBACK_REQUIRED');
  }
  const path = requiredText(
    payloadPath,
    'HOST_MCP_TRANSLATION_PAYLOAD_PATH_REQUIRED',
  );
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('HOST_MCP_TRANSLATION_PAYLOAD_FILE_INVALID');
  }
  const result = extractTranslationPayloadFileResult(parsed, begin);
  return commitTranslationResultParts({ begin, result, callTool });
}

export async function commitTranslationResultParts({
  begin,
  result,
  callTool,
}) {
  validateTranslationDeliveryResultEnvelope(begin.taskBinding, result);
  const bytes = new TextEncoder().encode(canonicalJson(result));
  const partCount = Math.ceil(bytes.byteLength / TRANSLATION_COMMIT_PART_BYTES);
  if (partCount < 1 || partCount > TRANSLATION_COMMIT_PART_MAX_COUNT) {
    throw new Error('HOST_MCP_TRANSLATION_PAYLOAD_PART_COUNT_UNSUPPORTED');
  }
  const parts = [];
  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const start = partIndex * TRANSLATION_COMMIT_PART_BYTES;
    const payloadBase64 = Buffer.from(
      bytes.subarray(start, start + TRANSLATION_COMMIT_PART_BYTES),
    ).toString('base64');
    const args = {
      attemptRef: begin.attemptRef,
      leaseToken: begin.leaseToken,
      leaseGeneration: begin.leaseGeneration,
      phase: 'UPLOAD_PART',
      resultContentHash: result.contentHash,
      partIndex,
      partCount,
      payloadBase64,
    };
    assertTranslationCommitArgumentSize(args);
    const receipt = await callTool('commit_translation_candidate', args);
    parts.push(
      validateTranslationPartReceipt(receipt, {
        begin,
        resultContentHash: result.contentHash,
        partIndex,
        partCount,
        byteLength: Math.min(
          TRANSLATION_COMMIT_PART_BYTES,
          bytes.byteLength - start,
        ),
      }),
    );
  }
  const finalizeArgs = {
    attemptRef: begin.attemptRef,
    leaseToken: begin.leaseToken,
    leaseGeneration: begin.leaseGeneration,
    phase: 'FINALIZE',
    resultContentHash: result.contentHash,
    partCount,
    parts,
  };
  assertTranslationCommitArgumentSize(finalizeArgs);
  return callTool('commit_translation_candidate', finalizeArgs);
}

export async function runApplicabilityEvaluation({
  applicabilityContextRef,
  requestId,
  expectedWorkItemId,
  callTool,
  extractApplicability,
  runtimeProvenance,
}) {
  const modelExecutor = runtimeProvenance?.toolVersions?.['model-executor'] === 'CODEX' ? 'CODEX' : 'HOSTED';
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
  if (
    expectedWorkItemId !== undefined &&
    begin.task.workItemId !== expectedWorkItemId
  ) {
    throw new Error('HOST_MCP_APPLICABILITY_WORKITEM_BINDING_MISMATCH');
  }
  validatePayload('applicability-input', begin.modelInput, { modelExecutor });
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
    await heartbeatAttempt(begin, callTool);
    const execution = normalizeExecution(
      await extractApplicability(structuredClone(begin.modelInput), {
        heartbeat: () => heartbeatAttempt(begin, callTool),
        timeoutMs: Math.max(1, Date.parse(begin.task.deadline) - Date.now()),
      }),
    );
    await heartbeatAttempt(begin, callTool);
    assertApplicabilityPromptVersion(execution.provenance);
    const astCandidate = validateApplicabilityAstCandidate(
      execution.output,
      begin.modelInput,
    );
    const candidate = buildApplicabilityCandidate(
      begin.modelInput,
      astCandidate,
      { modelExecutor },
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
      committed.status === 'WAITING_INPUT' || result.status === 'WAITING_INPUT'
        ? 'WAITING_INPUT'
        : 'CANDIDATE_ONLY',
    before,
    committed,
    after,
    deepLink,
    result,
  });
}

export async function runDynamicEvaluation(input) {
  const { workItemId, query, callTool, evaluateDynamicRules } = input;
  const modelExecutor = input.runtimeProvenance?.toolVersions?.['model-executor'] === 'CODEX' ? 'CODEX' : 'HOSTED';
  const continuationRequestId = optionalContinuationRequest(input);
  assertCallbacks(workItemId, callTool, evaluateDynamicRules);
  const before = await callTool('get_parse_status', { workItemId });
  const begin = await callTool('begin_dynamic_evaluation', { workItemId,
    ...(continuationRequestId ? { requestId: continuationRequestId } : {}) });
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
  const problemV2 = ['wiselink.jobaid-problem-task.v2','wiselink.jobaid-problem-task.v3'].includes(begin.modelInput?.schemaVersion);
  if ((begin.modelInput?.executionMode !== undefined || begin.task.modelInput?.executionMode !== undefined) &&
      (begin.modelInput?.executionMode !== 'PROGRAM_CONTROLLED_V1' ||
        begin.task.modelInput?.executionMode !== begin.modelInput.executionMode ||
        canonicalJson(begin.modelInput) !== canonicalJson(begin.task.modelInput.modelInput)))
    throw new Error('HOST_MCP_PROGRAM_ASSESSMENT_MODE_BINDING_MISMATCH');
  if (!problemV2) validatePayload('dynamic-rules-input', begin.modelInput);
  await heartbeatAttempt(begin, callTool);
  const reconciled = problemV2 ? await reconcileSavedInitialAssessment(begin, callTool, modelExecutor) : null;
  const execution = reconciled ?? await recoverAssessmentExecution(begin, problemV2, input.recoverAssessmentExecution) ?? await executeInitialAssessment(begin, problemV2, () =>
    evaluateDynamicRules(structuredClone(begin.modelInput), problemV2 ? problemAssessmentHooks(begin, callTool) : undefined));
  await heartbeatAttempt(begin, callTool);
  // The program executor has already saved and independently read its exact
  // request. Read the current authorized revision once more before commit so
  // the projection can be checked against the actual Host SAVE identity.
  // Host permits workRevisionRef selection only for the previous-work baseline;
  // a fresh saved revision is verified here as the latest exact attempt work.
  const program = execution.failureCode ? null : programAssessmentCommitBinding(begin, execution.output);
  if (program) {
    const readback = await callTool('read_assessment_work', {
      attemptRef: begin.attemptRef, workItemId,
    });
    assertProgramAssessmentSavedReadback(readback, begin, program, 'RUNNING');
  }
  const serializedOutput = execution.failureCode ? null : problemV2 ? execution.output : serializeDynamicRulesCommitOutput(
    begin.modelInput,
    execution.output,
  );
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: serializedOutput,
    provenance: workItemJobAidProvenance(begin.modelInput, execution.provenance),
    failureCode: execution.failureCode ?? null,
    factsConsidered: execution.failureCode ? [] : problemV2 ? [execution.output.workRevisionRef] : execution.output.ruleResults.rows.map((row) => row[0]),
  });
  let committed = null;
  let after = null;
  try {
    committed = await callTool(
      'commit_dynamic_evaluation_candidate',
      commitArgs(begin, result),
    );
  } catch (error) {
    return recoverCommitResponseLoss({
      mode: 'INITIAL_ANALYSIS',
      operation: 'EVALUATE_JOBAID',
      before,
      begin,
      result,
      callTool,
      cause: error,
      program,
    });
  }
  // A received but invalid ACK is a protocol failure, not a lost ACK that a
  // generic SUCCEEDED status may silently repair.
  if (execution.failureCode) assertFailedAssessmentCommit(committed, begin, result);
  else assertDynamicCommit(committed, workItemId, program);
  after ??= await callTool('get_parse_status', { workItemId });
  if (program) assertProgramAssessmentStatusReadback(after, workItemId, program);
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
    ...(reconciled ? { executionKind: 'HOST_SAVED_WORK_RECONCILIATION', modelRequests: 0 } : {}),
    parsed,
    parsedReaderSummary,
  };
}

export async function runOverallSynthesis(input) {
  const { workItemId, successorReviewTurnRef, successorWorkRevisionRef,
    providers = [], callTool, synthesizeOverall, configurationEvidenceReevaluation } = input;
  const continuationRequestId = optionalContinuationRequest(input);
  assertCallbacks(workItemId, callTool, synthesizeOverall);
  const selectedProviders = validateProviders(providers);
  if (successorReviewTurnRef && (continuationRequestId || selectedProviders.length || configurationEvidenceReevaluation))
    throw new Error('HOST_MCP_SUCCESSOR_OVERALL_MODE_AMBIGUOUS');
  if (successorReviewTurnRef && (!/^RT-[A-Za-z0-9_-]{1,93}$/u.test(successorReviewTurnRef) ||
      !/^JAWR-[A-Za-z0-9_-]{1,93}$/u.test(successorWorkRevisionRef ?? '')))
    throw new Error('HOST_MCP_SUCCESSOR_OVERALL_BINDING_INVALID');
  const before = await callTool('get_parse_status', { workItemId,
    ...(successorReviewTurnRef ? { successorReviewTurnRef } : {}) });
  if (successorReviewTurnRef) {
    // The Host validates the saved Review request and exact work revision.
  } else if (configurationEvidenceReevaluation === undefined) {
    assertOverallSynthesisReady(before);
  } else {
    const freshReevaluation =
      parseConfigurationEvidenceReevaluationStatus(before, workItemId);
    assertConfigurationEvidenceTriggerBinding(
      freshReevaluation,
      configurationEvidenceTriggerBinding(configurationEvidenceReevaluation),
    );
    if (
      !CONFIGURATION_EVIDENCE_REEVALUATION_ACTIVE_STATUSES.has(
        freshReevaluation.status,
      ) ||
      freshReevaluation.nextStage !== 'OVERALL'
    ) {
      throw new Error('HOST_P0B_OVERALL_STAGE_NOT_READY');
    }
  }
  const begin = await callTool('begin_overall_synthesis', {
    workItemId,
    providers: selectedProviders,
    ...(successorReviewTurnRef ? { successorReviewTurnRef } : {}),
    ...(continuationRequestId ? { requestId: continuationRequestId } : {}),
  });
  assertBegin(begin, 'OPENCLAW_OVERALL_SYNTHESIS');
  assertOverallInput(begin, selectedProviders);
  if (successorReviewTurnRef &&
      (begin.task?.modelInput?.successorOverallBinding?.workRevisionRef !== successorWorkRevisionRef ||
       begin.task?.modelInput?.successorReviewTurnRef !== successorReviewTurnRef))
    throw new Error('HOST_MCP_SUCCESSOR_OVERALL_WORK_CHANGED');
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
    successorWorkRevisionRef,
    successorReviewTurnRef,
    recoverAssessment: input.recoverAssessmentExecution,
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
  successorWorkRevisionRef,
  successorReviewTurnRef,
  recoverAssessment,
}) {
  const problemV2 = ['wiselink.jobaid-problem-task.v2','wiselink.jobaid-problem-task.v3'].includes(begin.modelInput?.schemaVersion);
  if (!problemV2) validatePayload('synthesis-input', begin.modelInput);
  await heartbeatAttempt(begin, callTool);
  const execution = await recoverAssessmentExecution(begin, problemV2, recoverAssessment) ?? await executeInitialAssessment(begin, problemV2, () =>
    synthesizeOverall(structuredClone(begin.modelInput), problemV2 ? problemAssessmentHooks(begin, callTool) : undefined));
  await heartbeatAttempt(begin, callTool);
  if (!problemV2 && !execution.failureCode) validatePayload('synthesis-pair', {
    input: begin.modelInput,
    output: execution.output,
  });
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: execution.output,
    provenance: workItemJobAidProvenance(begin.modelInput, execution.provenance),
    failureCode: execution.failureCode ?? null,
    factsConsidered: execution.failureCode ? [] : problemV2 ? [execution.output.workRevisionRef] : begin.modelInput.baseRuleResult.items.map(
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
    if (execution.failureCode) assertFailedAssessmentCommit(committed, begin, result);
    else assertOverallCommit(committed, workItemId);
    if (!execution.failureCode && successorWorkRevisionRef &&
        committed.overallSynthesis.basedOnJobAidWorkRevisionRef !== successorWorkRevisionRef)
      throw new Error('HOST_MCP_SUCCESSOR_OVERALL_COMMIT_WORK_MISMATCH');
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
  after ??= await callTool('get_parse_status', { workItemId,
    ...(successorReviewTurnRef ? { successorReviewTurnRef } : {}) });
  const deepLink = await callTool('get_deep_link', { workItemId,
    ...(successorReviewTurnRef ? { successorReviewTurnRef } : {}) });
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
  workItemId,
  reviewConversationRef,
  requestId,
  callTool,
  hasTool,
  respond,
  isolatedCandidate = false,
  modelExecutor = 'HOSTED',
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
    ...(workItemId ? { workItemId } : {}),
  });
  assertBegin(begin, 'OPENCLAW_INTERACTIVE_REVIEW');
  const task = validateReviewTask(begin.task.modelInput, { modelExecutor });
  assertTdmsReviewRuntimeBinding(task, begin.task);
  if (task.reviewConversationRef !== reviewConversationRef ||
    task.requestId !== requestId ||
    (workItemId && begin.task.workItemId !== workItemId)) {
    throw new Error('HOST_MCP_REVIEW_TASK_BINDING_MISMATCH');
  }
  if (begin.status === 'COMMITTING') {
    if (isolatedCandidate) throw new Error('REVIEW_ISOLATED_COMMITTING_FORBIDDEN');
    return recoverReviewCommitting(begin, callTool, modelExecutor);
  }
  if (reviewNativeRuntime(task) &&
      (typeof hasTool !== 'function' || hasTool(REVIEW_NATIVE_READ_TOOL) !== true))
    throw new Error('REVIEW_NATIVE_READ_CAPABILITY_UNAVAILABLE');
  const contextResult = await callTool('get_review_turn_context', {
    attemptRef: begin.attemptRef,
  });
  assertReviewContext(contextResult, begin, task);
  const readSourceRefIds = new Set();
  const nativeObservations = [];
  const readSourceRefs = async (sourceRefIds) => {
    const requested = validateReviewSourceRefRequest(sourceRefIds, task, begin.task.workItemId);
    const nativeDirectory = new Set(reviewNativeDirectoryRefs(task));
    const nativeRefs = requested.filter(ref => nativeDirectory.has(ref));
    const ordinaryRefs = requested.filter(ref => !nativeDirectory.has(ref));
    // Validate the whole mixed batch before either Host call. Do not split an
    // oversized native request to evade the per-request bound.
    if (nativeRefs.length > 96) throw new Error('HOST_MCP_REVIEW_NATIVE_SOURCE_REQUEST_INVALID');
    const values = [];
    if (ordinaryRefs.length) values.push(...await readOrdinarySourceRefs(ordinaryRefs));
    if (nativeRefs.length) {
      const packet = await callTool(REVIEW_NATIVE_READ_TOOL, {
        attemptRef: begin.attemptRef, workItemId: begin.task.workItemId,
        leaseToken: begin.leaseToken, leaseGeneration: begin.leaseGeneration,
        sourceRefs: nativeRefs, context: 'EXACT', purpose: 'Review exact TDMS professional opinions',
      });
      const observation = { requestedRefs: [...nativeRefs], packet: structuredClone(packet) };
      assertTdmsReviewReadObservation(task, observation);
      tdmsReviewDecisionCatalog(task, [...nativeObservations, observation]);
      nativeObservations.push(observation);
      values.push(...sanitizeReviewModelSources(projectTdmsReviewReadSources(task, observation)));
    }
    requested.forEach(ref => readSourceRefIds.add(ref));
    return requested.map(ref => values.find(value => value.sourceRefId === ref));
  };
  const readOrdinarySourceRefs = async (requested) => {
    const response = await callTool('read_source_refs', {
      attemptRef: begin.attemptRef,
      sourceRefIds: requested,
    });
    const sanitized = sanitizeSourceRefReadback(
      response,
      begin.attemptRef,
      requested,
    );
    if (task.schemaVersion === REVIEW_MATTER_TASK_SCHEMA) {
      for (const source of sanitized) {
        const bindings = task.matterContext.evidenceSources.filter((binding) => binding.sourceRefId === source.sourceRefId);
        // Existing engineer attachments retain their authorized C3 read shape;
        // Matter document passages additionally bind the local key to evidenceRef.
        if (bindings.length > 0 ? !bindings.some((binding) => binding.evidenceRef === source.evidenceRef)
          : !task.attachmentRefs.includes(source.sourceRefId)) {
          throw new Error('HOST_MCP_REVIEW_MATTER_SOURCE_BINDING_INVALID');
        }
      }
    }
    if (task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA) for (const source of sanitized) {
      const evidence = task.jobAidContext.sourceCatalog.find((item) => item.evidenceRef === source.sourceRefId);
      if (!evidence || source.evidenceRef !== evidence.evidenceRef || source.excerpt !== evidence.excerpt || source.kind !== evidence.kind) throw new Error('HOST_MCP_REVIEW_JOBAID_SOURCE_BINDING_INVALID');
    }
    return sanitized;
  };
  const safeModelInput = buildReviewModelInput(task, contextResult, begin.task.workItemId);
  const validateCandidate = (value) => {
    const candidate = validateReviewCandidate(task, value, nativeObservations, { modelExecutor });
    assertReviewSourcesWereRead(candidate, readSourceRefIds, task, safeModelInput.context.matterWorking, begin.task.workItemId);
    return candidate;
  };
  const execution = normalizeExecution(
    await respond({
      input: safeModelInput,
      readSourceRefs,
      // Pure validation of a proposed candidate. The Host bindings remain in
      // this closure; a model correction never commits or changes the task.
      validateCandidate,
    }),
  );
  const candidate = validateCandidate(execution.output);
  const decisionCatalog = tdmsReviewDecisionCatalog(task, nativeObservations);
  if (isolatedCandidate) {
    return {
      ok: false, mode: 'INTERACTIVE_REVIEW', operation: 'REVIEW_TURN',
      outcome: 'CANDIDATE_NOT_SAVED', candidate,
      provenance: execution.provenance,
    };
  }
  const result = sealResultEnvelope({
    task: begin.task,
    modelOutput: candidate,
    provenance: execution.provenance,
    sourceRefs: reviewCandidateArtifactRefs(begin.task, candidate, nativeObservations, { modelExecutor }),
    factsConsidered: [REVIEW_MATTER_TASK_SCHEMA, REVIEW_JOBAID_TASK_SCHEMA].includes(task.schemaVersion)
      ? reviewCandidateSourceRefIds(task, candidate) : [...candidate.sourceRefs],
    warnings: [...candidate.warnings],
  });
  let committed;
  try {
    committed = await callTool(
      'commit_review_turn_candidate',
      reviewCommitArgs(begin, result),
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
  assertReviewCommit(committed, begin.attemptRef, task, candidate, result,
    new Set(decisionCatalog.map((item) => item.evidenceRef)));
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

async function recoverReviewCommitting(begin, callTool, modelExecutor = 'HOSTED') {
  const bounded = boundedReviewRecoveryTask(begin.task, modelExecutor);
  let observed, beforeStatus;
  try {
    observed = await recoverCommitting({
      mode: 'INTERACTIVE_REVIEW', operation: 'REVIEW_TURN', before: null, begin,
      callTool: bounded ? async (name, args) => {
        const value = await callTool(name, args);
        if (name === 'get_action_attempt_status') beforeStatus = value;
        return value;
      } : callTool,
    });
  } catch (error) {
    // Another authorized commit may finish after this COMMITTING begin. The
    // same exact bounded reconciliation proves terminal persistence only.
    if (!bounded || beforeStatus?.status !== 'SUCCEEDED') throw error;
    return reconcileBoundedReviewSealedStatus(begin, beforeStatus, undefined, modelExecutor);
  }
  if (!bounded) return observed;
  const evidence = boundedReviewSealedEvidence(begin, observed.status, modelExecutor);
  let committed;
  try {
    committed = await callTool('commit_review_turn_candidate',
      reviewCommitArgs(begin, evidence.result));
  } catch (error) {
    const recovered = await recoverCommitResponseLoss({
      mode: 'INTERACTIVE_REVIEW', operation: 'REVIEW_TURN', before: null,
      begin, result: evidence.result, callTool, cause: error,
    });
    // A missing receipt cannot prove a READ journal or stale mutation. Only
    // the exact current terminal status may reconcile candidate persistence.
    return reconcileBoundedReviewSealedStatus(begin, recovered.status, undefined, modelExecutor);
  }
  assertBoundedReviewCommit(committed, begin, evidence);
  const after = await callTool('get_action_attempt_status', { attemptRef: begin.attemptRef });
  return reconcileBoundedReviewSealedStatus(begin, after, committed, modelExecutor);
}

/** The private checkpoint coordinator uses this only to recognize the exact
 * c5 runtime addon. No task/version migration or historical provenance option. */
export function boundedReviewRecoveryTask(envelope, modelExecutor = 'HOSTED') {
  validateTaskEnvelope(envelope);
  const task = validateReviewTask(envelope.modelInput, { modelExecutor });
  assertTdmsReviewRuntimeBinding(task, envelope);
  return task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA &&
    task.context.purpose === 'UPDATE_ASSESSMENT' &&
    task.jobAidContext.tdmsReviewContext?.mode === 'BOUNDED_NATIVE_READ' &&
    reviewNativeRuntime(task) ? task : null;
}

function boundedReviewSealedEvidence(begin, status, modelExecutor = 'HOSTED') {
  assertBegin(begin, 'OPENCLAW_INTERACTIVE_REVIEW');
  const task = boundedReviewRecoveryTask(begin.task, modelExecutor);
  if (!task || begin.status !== 'COMMITTING')
    throw new Error('HOST_MCP_REVIEW_SEALED_BOUNDED_BEGIN_REQUIRED');
  const result = validateResultForBegin(begin, begin.recoveryResult);
  if (result.status !== 'SUCCEEDED' || result.businessOutcome !== 'CANDIDATE_READY' ||
      (begin.recoveryResultContentHash !== undefined &&
        begin.recoveryResultContentHash !== result.contentHash))
    throw new Error('HOST_MCP_REVIEW_SEALED_RESULT_INVALID');
  assertGenericAttemptStatus(status, begin);
  if (status.resultContentHash !== result.contentHash)
    throw new Error('HOST_MCP_COMMITTING_RESULT_HASH_MISMATCH');
  if (status.status === 'COMMITTING') {
    if (status.recoveryAvailable !== true || !status.recoveryResult)
      throw new Error('HOST_MCP_COMMITTING_RECOVERY_UNAVAILABLE');
    validateResultForBegin(begin, status.recoveryResult);
    if (canonicalJson(status.recoveryResult) !== canonicalJson(result))
      throw new Error('HOST_MCP_COMMITTING_RESULT_HASH_MISMATCH');
  } else if (status.status !== 'SUCCEEDED' || status.projectionApplied !== false ||
      !['REVIEW_TURN_CANDIDATE_PERSISTED', 'REVIEW_TURN_CANDIDATE_RECONCILED'].includes(status.terminalReason)) {
    throw new Error('HOST_MCP_REVIEW_RECOVERY_STATUS_INVALID');
  }
  let candidate;
  try { candidate = JSON.parse(result.modelOutput); }
  catch { throw new Error('HOST_MCP_REVIEW_SEALED_CANDIDATE_INVALID'); }
  validateSealedBoundedReviewCandidate(task, candidate, { modelExecutor });
  return { task, result, candidate, allowedReadRefs: new Set([
    ...task.jobAidContext.sourceCatalog.map((item) => item.evidenceRef),
    ...reviewNativeDirectoryRefs(task),
  ]) };
}

function assertBoundedReviewCommit(committed, begin, evidence) {
  const { task, result, candidate, allowedReadRefs } = evidence;
  assertReviewCommit(committed, begin.attemptRef, task, candidate, result, allowedReadRefs);
  const saved = committed.assistantCandidate, update = saved?.jobAidWorkingUpdate;
  const unchanged = candidate.jobAidWorkingDelta === null;
  const expected = task.jobAidContext.modelInput.expectedWorkRevision;
  if (saved?.actionAttemptRef !== begin.attemptRef ||
      saved?.provenance?.resultContentHash !== result.contentHash ||
      !isRecord(update) || !Array.isArray(update.readSourceRefs) ||
      !Array.isArray(update.affectedIssueKeys) ||
      update.affectedIssueKeys.some((key) => typeof key !== 'string' || !key.trim()) ||
      new Set(update.affectedIssueKeys).size !== update.affectedIssueKeys.length ||
      (!unchanged && (update.status !== 'APPLIED' ||
        !Number.isSafeInteger(expected) || update.workRevision !== expected + 1 ||
        typeof update.workRevisionRef !== 'string' || !update.workRevisionRef.trim() ||
        update.workRevisionRef === task.jobAidContext.previousWork?.workRevisionRef)))
    throw new Error('HOST_MCP_REVIEW_COMMIT_RESULT_INVALID');
  assertReviewSourcesWereRead(candidate, new Set(update.readSourceRefs), task, null,
    begin.task.workItemId);
}

/** Fresh status-only reconciliation never manufactures a receipt, READ proof
 * or stale observation. A retained real receipt is validated again, not hidden. */
export function reconcileBoundedReviewSealedStatus(begin, status, committed, modelExecutor = 'HOSTED') {
  const evidence = boundedReviewSealedEvidence(begin, status, modelExecutor);
  if (committed !== undefined) assertBoundedReviewCommit(committed, begin, evidence);
  const succeeded = status.status === 'SUCCEEDED';
  return {
    ok: succeeded, mode: 'INTERACTIVE_REVIEW', operation: 'REVIEW_TURN',
    outcome: !succeeded ? 'COMMITTING_RECOVERY_READ_ONLY' : committed
      ? 'COMMITTING_REPLAYED' : 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY',
    attemptRef: begin.attemptRef, before: null, status,
    ...(succeeded && committed ? { committed } : {}),
    provenance: resultProvenance(evidence.result),
  };
}

async function recoverInitialCommitting({ stage, before, begin, callTool }) {
  const observed = await recoverCommitting({
    mode: 'INITIAL_ANALYSIS',
    operation: stage,
    before,
    begin,
    callTool,
  });
  if (!['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(stage)) return observed;
  // The Host has already sealed this exact ResultEnvelope. Replaying it with
  // the same attempt fence finishes an interrupted projection without a model
  // call or a new business result. The Host rejects a changed result or owner.
  const tool = stage === 'EVALUATE_JOBAID'
    ? 'commit_dynamic_evaluation_candidate' : 'commit_overall_candidate';
  const program = stage === 'EVALUATE_JOBAID' && begin.task.modelInput?.executionMode === 'PROGRAM_CONTROLLED_V1'
    ? programAssessmentCommitBinding(begin, JSON.parse(observed.status.recoveryResult.modelOutput)) : null;
  if (program) {
    // Locate the SAVE key through this attempt and WorkItem, then ask Host for
    // that exact revision. A latest-work observation alone is not the original
    // SAVE receipt and cannot authorize replay of the frozen ResultEnvelope.
    const latest = await callTool('read_assessment_work', {
      attemptRef: begin.attemptRef, workItemId: begin.task.workItemId,
    });
    assertProgramAssessmentSavedReadback(latest, begin, program, 'COMMITTING');
    const original = await callTool('read_assessment_work', {
      attemptRef: begin.attemptRef, workItemId: begin.task.workItemId,
      requestId: latest.revision.requestId,
    });
    assertProgramAssessmentSavedReadback(original, begin, program, 'COMMITTING');
    if (canonicalJson(original.revision) !== canonicalJson(latest.revision))
      throw new Error('HOST_MCP_PROGRAM_ASSESSMENT_SAVED_READBACK_INVALID');
  }
  const committed = await callTool(tool, commitArgs(begin, observed.status.recoveryResult));
  if (stage === 'EVALUATE_JOBAID') assertDynamicCommit(committed, begin.task.workItemId,
    program);
  else assertOverallCommit(committed, begin.task.workItemId);
  const after = program ? await callTool('get_parse_status', { workItemId: begin.task.workItemId }) : null;
  if (program) assertProgramAssessmentStatusReadback(after, begin.task.workItemId, program);
  return { ...observed, outcome: 'COMMITTING_REPLAYED', committed,
    ...(after ? { after } : {}) };
}

async function recoverCommitting({ mode, operation, before, begin, callTool }) {
  const sealedOptions = { allowHistoricalSkillVersion: mode === 'INITIAL_ANALYSIS' &&
    ['EVALUATE_JOBAID', 'SYNTHESIZE_OVERALL'].includes(operation) };
  const expectedContentHash =
    begin.recoveryResult?.contentHash ?? begin.recoveryResultContentHash;
  if (!expectedContentHash) {
    throw new Error('HOST_MCP_COMMITTING_RECOVERY_UNAVAILABLE');
  }
  if (begin.recoveryResult) {
    validateResultForBegin(begin, begin.recoveryResult, sealedOptions);
  }
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
  validateResultForBegin(begin, status.recoveryResult, sealedOptions);
  if (
    status.resultContentHash !== expectedContentHash ||
    status.recoveryResult.contentHash !== expectedContentHash
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
  program = null,
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
    validateResultForBegin(begin, status.recoveryResult);
    if (status.recoveryResult.contentHash !== result.contentHash) {
      throw outcomeUnknown('HOST_MCP_COMMIT_OUTCOME_UNKNOWN', cause, status);
    }
  }
  let after;
  if (status.status === 'SUCCEEDED' && program) {
    try { after = await callTool('get_parse_status', { workItemId: begin.task.workItemId }); }
    catch { throw outcomeUnknown('HOST_MCP_PROGRAM_PROJECTION_READBACK_FAILED', cause, status); }
    assertProgramAssessmentStatusReadback(after, begin.task.workItemId, program);
  }
  return {
    ok: status.status === 'SUCCEEDED',
    mode,
    operation,
    outcome: 'COMMIT_RESPONSE_LOSS_RECOVERED_READ_ONLY',
    attemptRef: begin.attemptRef,
    before,
    status,
    ...(after ? { after } : {}),
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
  if (dynamicRules?.schemaVersion === 'wiselink.jobaid-problem-result.v2') {
    if (dynamicRules.status !== 'CANDIDATE_ONLY' || !dynamicRules.workRevisionRef || !Number.isSafeInteger(dynamicRules.workRevision) || dynamicRules.workRevision < 1 ||
      !['COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'].includes(dynamicRules.roundCompletion))
      throw new Error('HOST_MCP_OVERALL_REQUIRES_PERSISTED_PROBLEM_WORK');
    return statusResult;
  }
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

function optionalContinuationRequest(input) {
  if (!Object.hasOwn(input, 'continuationRequestId')) return undefined;
  const requestId = input.continuationRequestId;
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/u.test(requestId))
    throw new Error('INITIAL_CONTINUATION_REQUEST_INVALID');
  return requestId;
}

async function reconcileSavedInitialAssessment(begin, callTool, modelExecutor = 'HOSTED') {
  const taskInput = begin.task.modelInput;
  if (!Object.hasOwn(taskInput, 'savedWorkReconciliation')) return null;
  const startedAt = Date.now();
  const marker = taskInput.savedWorkReconciliation;
  if (!marker || begin.task.taskType !== 'OPENCLAW_DYNAMIC_EVALUATION' ||
      marker.executionKind !== 'HOST_SAVED_WORK_RECONCILIATION' || marker.modelRequests !== 0 ||
      typeof marker.workRevisionRef !== 'string' || !marker.workRevisionRef ||
      !Number.isSafeInteger(marker.workRevision) || marker.workRevision < 1 ||
      typeof marker.sourceActionAttemptId !== 'string' || !marker.sourceActionAttemptId ||
      begin.modelInput.purpose !== 'INITIAL_PROBLEM_ASSESSMENT')
    throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_INVALID');
  const latest = await callTool('read_assessment_work', { attemptRef: begin.attemptRef });
  const revision = latest?.revision;
  if (latest?.schemaVersion !== 'wiselink.jobaid-work-read.v2' ||
      latest.attemptId !== begin.task.actionAttemptId || latest.executionStatus !== 'RUNNING' ||
      revision?.workRevisionRef !== marker.workRevisionRef || revision.workRevision !== marker.workRevision ||
      revision.actionAttemptId !== marker.sourceActionAttemptId ||
      revision.workItemId !== begin.task.workItemId || revision.documentVersionId !== begin.task.documentVersionId ||
      revision.basedOnWorkItemRevision !== begin.task.baseRevision ||
      revision.content?.roundCompletion !== 'COMPLETE' ||
      typeof revision.requestId !== 'string' || !revision.requestId)
    throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_READBACK_INVALID');
  // Use only the Host-returned original SAVE key. The new task's marker grants
  // this exact historical read; an actionAttemptId is never converted to an AQ id.
  const original = await callTool('read_assessment_work', {
    attemptRef: begin.attemptRef, requestId: revision.requestId,
  });
  if (original?.schemaVersion !== latest.schemaVersion || original.attemptId !== latest.attemptId ||
      original.executionStatus !== 'RUNNING' || canonicalJson(original.revision) !== canonicalJson(revision))
    throw new Error('JOBAID_SAVED_WORK_RECONCILIATION_READBACK_INVALID');
  const protocol = begin.modelInput.schemaVersion === 'wiselink.jobaid-problem-task.v3' ? '3' : '2';
  return { output: { workRevisionRef: marker.workRevisionRef }, provenance: {
    executionKind: 'HOST_SAVED_WORK_RECONCILIATION', modelRequests: 0, modelVersion: null,
    sourceWork: { workRevisionRef: marker.workRevisionRef, sourceActionAttemptId: marker.sourceActionAttemptId },
    promptVersion: `wiselink-jobaid-problem@v${protocol}`,
    skillVersion: WISELINK_SKILL_VERSION,
    toolVersions: { [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
      ...modelExecutorProvenance({ modelExecutor }),
      'jobaid-problem-protocol': protocol, 'host-saved-work-reconciliation': '1',
      ...(taskInput.tdmsContext ? { 'tdms-native-context': '1' } : {}) },
    runMetrics: { durationMs: Date.now() - startedAt, inputUnits: 0, outputUnits: 0 },
  } };
}

async function recoverAssessmentExecution(begin, problemV2, recover) {
  if (!problemV2 || recover === undefined) return null;
  if (typeof recover !== 'function') throw new Error('INITIAL_ASSESSMENT_POLICY_CLOSURE_UNCONFIRMED');
  const execution = await recover(begin);
  if (!execution || Object.keys(execution).length !== 2 ||
      execution.failureCode !== 'JOBAID_CHECKPOINT_POLICY_CHANGED')
    throw new Error('INITIAL_ASSESSMENT_POLICY_CLOSURE_UNCONFIRMED');
  validateRuntimeProvenance(execution.provenance);
  return execution;
}

async function executeInitialAssessment(begin, problemV2, perform) {
  try { return normalizeExecution(await perform()); }
  catch (error) {
    const failure = error?.terminalAssessmentFailure;
    const knownFailure = [
      'JOBAID_MODEL_OUTPUT_LENGTH', 'JOBAID_WORK_VALIDATION_FAILED',
      'JOBAID_WORK_JSON_INVALID', 'JOBAID_SOURCE_BATCH_POLICY_NOT_FOLLOWED',
      'JOBAID_PROTOCOL_REPAIR_EXHAUSTED', 'JOBAID_NO_PROGRESS',
    ].includes(failure?.errorCode) || (failure?.errorCode === 'JOBAID_INCOMPLETE_TERMINAL_RESPONSE' &&
      error?.message === 'JOBAID_MODEL_OUTPUT_FUNCTION_INVALID');
    if (!problemV2 || !knownFailure) throw error;
    // A gateway/tool-choice error does not prove the provider stopped. Only
    // these recorded complete/rejected responses can finish as known failure.
    validateRuntimeProvenance(failure.provenance);
    return { failureCode: failure.errorCode, provenance: failure.provenance };
  }
}

function workItemJobAidProvenance(modelInput, provenance) {
  const protocol = modelInput?.schemaVersion === 'wiselink.jobaid-problem-task.v3' ? '3'
    : modelInput?.schemaVersion === 'wiselink.jobaid-problem-task.v2' ? '2' : null;
  // Only these two fresh guidance versions implement the Host's base protocol.
  // Legacy/unknown declarations retain the existing strict Host validation.
  if (!protocol ||
      provenance.promptVersion !== `wiselink-jobaid-problem@v${protocol}.source-content-once.v2` ||
      provenance.toolVersions['jobaid-problem-protocol'] !== protocol) return provenance;
  const guidance = provenance.toolVersions['jobaid-problem-guidance'];
  if (guidance !== undefined && guidance !== provenance.promptVersion)
    throw new Error('HOST_MCP_JOBAID_GUIDANCE_VERSION_MISMATCH');
  return { ...provenance, promptVersion: `wiselink-jobaid-problem@v${protocol}`,
    toolVersions: { ...provenance.toolVersions, 'jobaid-problem-guidance': provenance.promptVersion } };
}

function assertFailedAssessmentCommit(value, begin, result) {
  if (value?.status !== 'FAILED' || value.attemptRef !== begin.attemptRef ||
      value.errorCode !== result.errorCode)
    throw new Error('HOST_MCP_FAILED_ASSESSMENT_COMMIT_INVALID');
}

function problemAssessmentHooks(begin, callTool) {
  const control = { attemptRef: begin.attemptRef, leaseToken: begin.leaseToken, leaseGeneration: begin.leaseGeneration };
  const programControlled = begin.modelInput.executionMode === 'PROGRAM_CONTROLLED_V1';
  return {
    assessmentBinding: { attemptRef: begin.attemptRef, actionAttemptId: begin.task.actionAttemptId,
      workItemId: begin.task.workItemId, documentVersionId: begin.task.documentVersionId,
      inputRevision: begin.task.inputRevision, baseRevision: begin.task.baseRevision },
    heartbeat: () => heartbeatAttempt(begin, callTool),
    queryAssessmentKnowledge: (intent) => callTool('query_assessment_knowledge', { ...intent, ...control }),
    readAssessmentSources: (intent) => callTool('read_assessment_sources', { ...intent, ...control }),
    saveAssessmentWork: (intent) => callTool('save_assessment_work', { ...intent, ...control }),
    readAssessmentWork: (intent) => callTool('read_assessment_work', { ...intent,
      ...(programControlled ? control : { attemptRef: begin.attemptRef }) }),
    ...(programControlled ? { recordAssessmentProgramProgress: (intent) =>
      callTool('record_assessment_program_progress', { ...intent, ...control }) } : {}),
  };
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

async function collectTranslationDelivery(workItemId, callTool, requestId) {
  const first = await callTool('begin_translation', { workItemId, ...(requestId ? { requestId } : {}) });
  if (first.task?.modelInput?.schemaVersion === 'wiselink.3_1.translation_task.v2') {
    assertBegin(first, 'OPENCLAW_TRANSLATE');
    if (first.task.workItemId !== workItemId) throw new Error('TRANSLATION_V2_WORK_ITEM_BINDING_INVALID');
    return first;
  }
  assertTranslationDeliveryPart(first, {
    workItemId,
    expectedPartIndex: 0,
  });
  const begin = translationDeliveryControl(first);
  if (begin.status === 'COMMITTING') return begin;

  const sourceUnits = [...first.delivery.sourceUnits];
  for (
    let partIndex = 1;
    partIndex < first.delivery.partCount;
    partIndex += 1
  ) {
    const part = await callTool('begin_translation', {
      workItemId,
      ...(requestId ? { requestId } : {}),
      deliveryPart: partIndex,
    });
    assertTranslationDeliveryPart(part, {
      workItemId,
      expectedPartIndex: partIndex,
      expectedControl: begin,
      expectedSourceUnitStartIndex: sourceUnits.length,
    });
    sourceUnits.push(...part.delivery.sourceUnits);
  }
  if (sourceUnits.length !== first.delivery.sourceUnitCount) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_COUNT_MISMATCH');
  }
  const modelInput = {
    ...structuredClone(first.delivery.modelInputBase),
    sourceUnits: structuredClone(sourceUnits),
  };
  validatePayload('translation-input', modelInput);
  return { ...begin, modelInput };
}

function assertTranslationDeliveryPart(
  value,
  {
    workItemId,
    expectedPartIndex,
    expectedControl,
    expectedSourceUnitStartIndex = 0,
  },
) {
  if (!isRecord(value)) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_INVALID');
  }
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'attemptRef',
      'status',
      'leaseToken',
      'leaseGeneration',
      'leaseExpiresAt',
      'taskBinding',
      'delivery',
    ],
    ['recoveryResultContentHash'],
    'HOST_MCP_TRANSLATION_DELIVERY',
  );
  if (
    value.schemaVersion !== 'wiselink.3_1.openclaw_translation_delivery.v1' ||
    !['RUNNING', 'COMMITTING'].includes(value.status)
  ) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_SCHEMA_INVALID');
  }
  requiredText(value.attemptRef, 'HOST_MCP_ATTEMPT_REF_REQUIRED');
  requiredText(value.leaseToken, 'HOST_MCP_LEASE_TOKEN_REQUIRED');
  requiredText(
    value.leaseExpiresAt,
    'HOST_MCP_TRANSLATION_LEASE_EXPIRY_REQUIRED',
  );
  if (
    !Number.isSafeInteger(value.leaseGeneration) ||
    value.leaseGeneration < 1
  ) {
    throw new Error('HOST_MCP_LEASE_GENERATION_INVALID');
  }
  validateTranslationDeliveryTaskBinding(value.taskBinding);
  if (
    value.taskBinding.operationRef !== value.attemptRef ||
    value.taskBinding.workItemId !== workItemId
  ) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_TASK_BINDING_INVALID');
  }
  if (value.status === 'COMMITTING') {
    if (!/^[a-f0-9]{64}$/u.test(value.recoveryResultContentHash ?? '')) {
      throw new Error('HOST_MCP_COMMITTING_RECOVERY_UNAVAILABLE');
    }
  } else if (Object.hasOwn(value, 'recoveryResultContentHash')) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_RECOVERY_HASH_UNEXPECTED');
  }

  const delivery = value.delivery;
  if (!isRecord(delivery)) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_PART_INVALID');
  }
  assertExactKeys(
    delivery,
    [
      'partIndex',
      'partCount',
      'sourceUnitStartIndex',
      'sourceUnitEndExclusive',
      'sourceUnitCount',
      'sourceUnits',
    ],
    ['modelInputBase'],
    'HOST_MCP_TRANSLATION_DELIVERY_PART',
  );
  if (
    !Number.isSafeInteger(delivery.partIndex) ||
    delivery.partIndex !== expectedPartIndex ||
    !Number.isSafeInteger(delivery.partCount) ||
    delivery.partCount < 1 ||
    delivery.partIndex >= delivery.partCount ||
    !Number.isSafeInteger(delivery.sourceUnitStartIndex) ||
    delivery.sourceUnitStartIndex !== expectedSourceUnitStartIndex ||
    !Number.isSafeInteger(delivery.sourceUnitEndExclusive) ||
    !Number.isSafeInteger(delivery.sourceUnitCount) ||
    delivery.sourceUnitCount < 1 ||
    !Array.isArray(delivery.sourceUnits) ||
    delivery.sourceUnits.length < 1 ||
    delivery.sourceUnitEndExclusive !==
      delivery.sourceUnitStartIndex + delivery.sourceUnits.length ||
    delivery.sourceUnitEndExclusive > delivery.sourceUnitCount
  ) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_PART_INVALID');
  }
  if (
    expectedPartIndex === 0
      ? !isRecord(delivery.modelInputBase) ||
        Object.hasOwn(delivery.modelInputBase, 'sourceUnits')
      : Object.hasOwn(delivery, 'modelInputBase')
  ) {
    throw new Error('HOST_MCP_TRANSLATION_MODEL_INPUT_BASE_INVALID');
  }
  if (
    expectedPartIndex === delivery.partCount - 1 &&
    delivery.sourceUnitEndExclusive !== delivery.sourceUnitCount
  ) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_COUNT_MISMATCH');
  }
  if (
    expectedControl &&
    canonicalJson(translationDeliveryControl(value)) !==
      canonicalJson(expectedControl)
  ) {
    throw new Error('HOST_MCP_TRANSLATION_DELIVERY_FENCE_CHANGED');
  }
}

function translationDeliveryControl(value) {
  return {
    attemptRef: value.attemptRef,
    status: value.status,
    leaseToken: value.leaseToken,
    leaseGeneration: value.leaseGeneration,
    leaseExpiresAt: value.leaseExpiresAt,
    taskBinding: structuredClone(value.taskBinding),
    partCount: value.delivery.partCount,
    sourceUnitCount: value.delivery.sourceUnitCount,
    ...(value.recoveryResultContentHash
      ? { recoveryResultContentHash: value.recoveryResultContentHash }
      : {}),
  };
}

function validateResultForBegin(begin, result, options) {
  if (begin.task) return validateResultEnvelope(begin.task, result, options);
  return validateTranslationDeliveryResultEnvelope(begin.taskBinding, result);
}

async function heartbeatAttempt(begin, callTool) {
  const heartbeat = await callTool('heartbeat_action_attempt', {
    attemptRef: begin.attemptRef,
    leaseToken: begin.leaseToken,
    leaseGeneration: begin.leaseGeneration,
  });
  requiredText(
    heartbeat?.leaseExpiresAt,
    'HOST_MCP_HEARTBEAT_LEASE_EXPIRY_REQUIRED',
  );
  return heartbeat;
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

function reviewCommitArgs(begin, result) {
  return {
    attemptRef: begin.attemptRef,
    leaseToken: begin.leaseToken,
    leaseGeneration: begin.leaseGeneration,
    resultJson: canonicalJson(result),
  };
}

function extractTranslationPayloadFileResult(value, begin) {
  if (!isRecord(value)) {
    throw new Error('HOST_MCP_TRANSLATION_PAYLOAD_FILE_INVALID');
  }
  if (!Object.hasOwn(value, 'result')) return value;
  assertExactKeys(
    value,
    ['attemptRef', 'leaseToken', 'leaseGeneration', 'result'],
    [],
    'HOST_MCP_TRANSLATION_PAYLOAD_FILE',
  );
  if (
    value.attemptRef !== begin.attemptRef ||
    value.leaseToken !== begin.leaseToken ||
    value.leaseGeneration !== begin.leaseGeneration ||
    !isRecord(value.result)
  ) {
    throw new Error('HOST_MCP_TRANSLATION_PAYLOAD_FENCE_MISMATCH');
  }
  return value.result;
}

function validateTranslationPartReceipt(
  value,
  { begin, resultContentHash, partIndex, partCount, byteLength },
) {
  if (!isRecord(value)) {
    throw new Error('HOST_MCP_TRANSLATION_PART_RECEIPT_INVALID');
  }
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'attemptRef',
      'resultContentHash',
      'partIndex',
      'partCount',
      'sha256',
      'byteLength',
      'replayed',
    ],
    [],
    'HOST_MCP_TRANSLATION_PART_RECEIPT',
  );
  if (
    value.schemaVersion !== 'wiselink.3_1.translation_result_part_receipt.v1' ||
    value.attemptRef !== begin.attemptRef ||
    value.resultContentHash !== resultContentHash ||
    value.partIndex !== partIndex ||
    value.partCount !== partCount ||
    value.byteLength !== byteLength ||
    !/^[0-9a-f]{64}$/u.test(value.sha256) ||
    typeof value.replayed !== 'boolean'
  ) {
    throw new Error('HOST_MCP_TRANSLATION_PART_RECEIPT_INVALID');
  }
  return {
    partIndex: value.partIndex,
    sha256: value.sha256,
    byteLength: value.byteLength,
  };
}

function assertTranslationCommitArgumentSize(value) {
  const byteLength = new TextEncoder().encode(canonicalJson(value)).byteLength;
  if (byteLength >= TRANSLATION_COMMIT_ARGUMENT_MAX_BYTES) {
    throw new Error('HOST_MCP_TRANSLATION_COMMIT_ARGUMENT_TOO_LARGE');
  }
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
    ok: result.status !== 'FAILED',
    mode,
    operation,
    outcome: result.status === 'FAILED' ? 'FAILED' : outcome,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    before,
    committed,
    after,
    deepLink,
    provenance: resultProvenance(result),
  };
}

function resultProvenance(result) {
  return {
    ...(result.executionKind === 'HOST_SAVED_WORK_RECONCILIATION' ? {
      executionKind: result.executionKind, modelRequests: 0, sourceWork: structuredClone(result.sourceWork),
    } : {}),
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
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.status === 'WAITING_INPUT'
  ) {
    const terminalAttempt = value.attemptRef === begin.attemptRef;
    const candidateProjection =
      value.workItemId === begin.task.workItemId &&
      Number.isSafeInteger(value.workItemRevision) &&
      value.applicability?.status === 'WAITING_INPUT' &&
      value.applicability?.actionAttemptId === begin.task.actionAttemptId;
    if (!terminalAttempt && !candidateProjection) {
      throw new Error('HOST_MCP_APPLICABILITY_WAITING_RESULT_INVALID');
    }
    return;
  }
  if (result.status === 'WAITING_INPUT') {
    throw new Error('HOST_MCP_APPLICABILITY_WAITING_RESULT_INVALID');
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

function programAssessmentCommitBinding(begin, output) {
  return begin.task.modelInput?.executionMode === 'PROGRAM_CONTROLLED_V1'
    ? { actionAttemptId: begin.task.actionAttemptId, workRevisionRef: output?.workRevisionRef } : null;
}

function assertProgramAssessmentSavedReadback(packet, begin, program, expectedExecutionStatus) {
  const revision = packet?.revision;
  if (packet?.schemaVersion !== 'wiselink.jobaid-work-read.v2' ||
      packet.attemptId !== begin.task.actionAttemptId ||
      packet.inputWorkRevision !== begin.modelInput.expectedWorkRevision ||
      packet.executionStatus !== expectedExecutionStatus ||
      revision?.workRevisionRef !== program.workRevisionRef ||
      revision.actionAttemptId !== begin.task.actionAttemptId ||
      revision.workItemId !== begin.task.workItemId ||
      revision.documentVersionId !== begin.task.documentVersionId ||
      revision.basedOnWorkItemRevision !== begin.task.baseRevision ||
      revision.workRevision !== begin.modelInput.expectedWorkRevision + 1 ||
      typeof revision.requestId !== 'string' || !revision.requestId ||
      !['COMPLETE', 'COMPLETE_WITH_OPEN_QUESTIONS'].includes(revision.content?.roundCompletion) ||
      revision.content.overviewStatus !== 'CURRENT' ||
      typeof revision.content.understanding !== 'string' || !revision.content.understanding.trim())
    throw new Error('HOST_MCP_PROGRAM_ASSESSMENT_SAVED_READBACK_INVALID');
  program.saveRequestId = revision.requestId;
  program.workRevision = revision.workRevision;
}

function assertDynamicCommit(value, workItemId, program = null) {
  if (program) {
    if (value?.workItemId !== workItemId || !Number.isSafeInteger(value.workItemRevision))
      throw new Error('HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID');
    assertProgramAssessmentProjection(value, program);
    return;
  }
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

function assertProgramAssessmentProjection(value, program) {
  const overall = value?.overallSynthesis, source = overall?.sourceAssessment;
  if (!program.workRevisionRef || value?.status !== 'OVERALL_CANDIDATE_READY' ||
      value.baseRules?.workRevisionRef !== program.workRevisionRef ||
      overall?.status !== 'CANDIDATE_ONLY' || overall.executionKind !== 'DETERMINISTIC_PROJECTION' ||
      overall.modelRequests !== 0 || overall.basedOnJobAidWorkRevisionRef !== program.workRevisionRef ||
      source?.actionAttemptId !== program.actionAttemptId || source.workRevisionRef !== program.workRevisionRef ||
      source.workRevision !== program.workRevision ||
      source.saveRequestId !== program.saveRequestId || !Number.isFinite(Date.parse(source.readObservedAt)))
    throw new Error('HOST_MCP_PROGRAM_ASSESSMENT_COMMIT_RESULT_INVALID');
}

// get_parse_status wraps this existing projection; its entry does not expose
// workItemRevision. Do not manufacture a commit ACK from this read response.
export function assertProgramAssessmentStatusReadback(value, workItemId, program) {
  if (value?.entry?.workItemId !== workItemId)
    throw new Error('HOST_MCP_PROGRAM_PROJECTION_IDENTITY_MISMATCH');
  assertProgramAssessmentProjection(value.integratedAssessmentSummary, program);
  return value;
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
    value.selectedEvaluationItemId !== task.selectedEvaluationItemId ||
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
  if ((task.schemaVersion === REVIEW_MATTER_TASK_SCHEMA) !== isRecord(value.context.matterWorking)) {
    throw new Error('HOST_MCP_REVIEW_MATTER_CONTEXT_BINDING_INVALID');
  }
  if ((task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA) !== isRecord(value.context.problemAssessment)) throw new Error('HOST_MCP_REVIEW_JOBAID_CONTEXT_BINDING_INVALID');
  const expectedResourceRefs = task.resourceRefs.map(
    ({ sourceRefId, resourceArtifactRef, resourceArtifactSha256 }) => ({
      sourceRefId,
      resourceArtifactRef,
      resourceArtifactSha256,
    }),
  );
  if (
    canonicalJson(value.resourceRefs) !== canonicalJson(expectedResourceRefs)
  ) {
    throw new Error('HOST_MCP_REVIEW_CONTEXT_RESOURCE_REFS_MISMATCH');
  }
  const engineerInput = value.context.engineerInput;
  if (
    task.attachmentRefs.length > 0 &&
    (!engineerInput ||
      typeof engineerInput !== 'object' ||
      Array.isArray(engineerInput))
  ) {
    throw new Error('HOST_MCP_REVIEW_CONTEXT_ATTACHMENT_REFS_MISMATCH');
  }
  if (
    engineerInput &&
    typeof engineerInput === 'object' &&
    !Array.isArray(engineerInput) &&
    (Object.hasOwn(engineerInput, 'attachmentRefs') ||
      task.attachmentRefs.length > 0) &&
    canonicalJson(engineerInput.attachmentRefs) !==
      canonicalJson(task.attachmentRefs)
  ) {
    throw new Error('HOST_MCP_REVIEW_CONTEXT_ATTACHMENT_REFS_MISMATCH');
  }
}

function buildReviewModelInput(task, contextResult, workItemId) {
  const context = sanitizeForModel(projectTdmsReviewSavedModelContext(task, contextResult.context));
  return {
    schemaVersion: task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA ? 'wiselink.3_1.review_model_input.v1.c5' : task.schemaVersion === REVIEW_MATTER_TASK_SCHEMA
      ? 'wiselink.3_1.review_model_input.v1.c4' : 'wiselink.3_1.review_model_input.v1.c3',
    mode: 'INTERACTIVE_REVIEW',
    inputRevision: task.inputRevision,
    selectedEvaluationItemId: task.selectedEvaluationItemId,
    userMessage: task.userMessage,
    allowedOperations: [...task.allowedOperations],
    allowedEvaluationItemIds: [...task.allowedEvaluationItemIds],
    allowedAdoptedInputRefs: [...task.allowedAdoptedInputRefs],
    attachmentRefs: [...task.attachmentRefs],
    availableSourceRefIds: reviewReadableSourceRefIds(task, workItemId),
    context,
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
    if (normalized === 'mattercontext') {
      throw new Error(`REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:${modelPath}.${key}`);
    }
    if (normalized === 'workitemid') continue;
    if (
      normalized === 'authority' &&
      /^\$\.evaluation\.gapLedger\.gaps\[\d+\]$/u.test(modelPath)
    ) {
      if (Object.hasOwn(value, 'gapControl')) {
        throw new Error(`REVIEW_MODEL_GAP_CONTROL_INVALID:${modelPath}`);
      }
      result.gapControl = sanitizeReviewGapControl(child, modelPath);
      continue;
    }
    if (isForbiddenAuthorityInputKey(key)) {
      throw new Error(
        `REVIEW_MODEL_SENSITIVE_FIELD_FORBIDDEN:${modelPath}.${key}`,
      );
    }
    result[key] = sanitizeForModel(child, `${modelPath}.${key}`);
  }
  return result;
}

function sanitizeReviewGapControl(value, modelPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`REVIEW_MODEL_GAP_CONTROL_INVALID:${modelPath}.authority`);
  }
  const allowedKeys = new Set([
    'owner',
    'candidateOnly',
    'modelMayClose',
    'queryResultIsFact',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(`REVIEW_MODEL_GAP_CONTROL_INVALID:${modelPath}.authority`);
  }
  if (
    value.owner !== 'CANONICAL_HOST' ||
    value.candidateOnly !== true ||
    value.modelMayClose !== false ||
    value.queryResultIsFact !== false
  ) {
    throw new Error(`REVIEW_MODEL_GAP_CONTROL_INVALID:${modelPath}.authority`);
  }
  return {
    owner: value.owner,
    candidateOnly: value.candidateOnly,
    modelMayClose: value.modelMayClose,
    queryResultIsFact: value.queryResultIsFact,
  };
}

function reviewReadableSourceRefIds(task, workItemId) {
  const refs = task.resourceRefs.map(({ sourceRefId }) => sourceRefId);
  if (task.schemaVersion !== REVIEW_JOBAID_TASK_SCHEMA) return refs;
  return [...new Set([...refs, ...reviewDialogueSourceRefIds(task, workItemId), ...reviewNativeDirectoryRefs(task)])];
}

function reviewDialogueSourceRefIds(task, workItemId) {
  if (task.schemaVersion !== REVIEW_JOBAID_TASK_SCHEMA) return [];
  const refs = [];
  for (const item of task.jobAidContext.sourceCatalog) {
    const source = item.dialogueSource;
    if (item.kind !== 'ENGINEER_STATEMENT' || item.origin !== 'REVIEW_CONVERSATION' ||
      !source || typeof source.requestRef !== 'string' || !source.requestRef.trim() ||
      typeof source.contributionRef !== 'string' || !source.contributionRef.trim() ||
      !Number.isSafeInteger(source.revision) || source.revision < 1 ||
      // This exact request binding is persisted by DialogueAssessmentRepository.
      // The evidenceRef remains the Host's opaque frozen value, never rebuilt.
      task.requestId !== `dialogue-${source.requestRef}` ||
      item.reviewConversationId !== task.reviewConversationRef ||
      item.reviewTurnId !== task.reviewTurnRef ||
      !Array.isArray(source.contextWorkItemIds) ||
      !source.contextWorkItemIds.includes(workItemId)) continue;
    refs.push(item.evidenceRef);
  }
  return [...new Set(refs)];
}

function validateReviewSourceRefRequest(sourceRefIds, task, workItemId) {
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
  const allowed = new Set(reviewReadableSourceRefIds(task, workItemId));
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
  return sanitizeReviewModelSources(value.sourceRefs);
}

export function sanitizeReviewModelSources(values) {
  if (!Array.isArray(values)) throw new Error('HOST_MCP_REVIEW_SOURCE_REF_READBACK_INVALID');
  return values.map((sourceRef, index) => sanitizeForModel(sourceRef, `$.sourceRefs[${index}]`));
}

function assertReviewSourcesWereRead(candidate, readSourceRefIds, task, matterWorking, workItemId) {
  const used = reviewCandidateSourceRefIds(task, candidate);
  if (task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA &&
    task.context.purpose === 'UPDATE_ASSESSMENT' && candidate.jobAidWorkingDelta === null) {
    // ALL_PENDING contributions are not initially delivered. A completed
    // comparison must read each exact current-request frozen contribution.
    used.push(...reviewDialogueSourceRefIds(task, workItemId));
  }
  if (used.some((sourceRefId) => !readSourceRefIds.has(sourceRefId))) {
    throw new Error('REVIEW_CANDIDATE_SOURCE_REF_NOT_READ_THIS_TURN');
  }
  if (task.schemaVersion !== REVIEW_MATTER_TASK_SCHEMA || candidate.matterWorkingDelta === null) return;
  const provided = new Set([
    ...(matterWorking.evidenceCatalog ?? []),
    ...(matterWorking.currentResult?.evidence ?? []),
  ].filter((item) => item.kind !== 'DOCUMENT_PASSAGE' && typeof item.providedText === 'string' && item.providedText.trim())
    .map((item) => item.evidenceRef));
  const evidence = new Map([
    ...(task.matterContext.workingState?.substantiveResult?.evidence ?? []),
    ...task.matterContext.readingEvidence,
  ].map((item) => [item.evidenceRef, item]));
  const sources = new Map(task.matterContext.evidenceSources.map((item) => [item.evidenceRef, item.sourceRefId]));
  const delta = candidate.matterWorkingDelta.claimDelta;
  for (const claim of [...(delta?.additions ?? []), ...(delta?.replacements ?? [])]) {
    for (const premise of claim.premises) {
      if (evidence.get(premise.evidenceRef)?.kind !== 'DOCUMENT_PASSAGE' &&
        !provided.has(premise.evidenceRef) && !readSourceRefIds.has(sources.get(premise.evidenceRef))) {
        throw new Error('REVIEW_MATTER_PREMISE_NOT_PROVIDED_OR_READ_THIS_TURN');
      }
    }
  }
}

function assertGenericAttemptStatus(value, begin) {
  const taskType = begin.task?.taskType ?? begin.taskBinding?.taskType;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.attemptRef !== begin.attemptRef ||
    value.taskType !== taskType ||
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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, required, optional, code) {
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error(`${code}_UNKNOWN_FIELD`);
  }
  if (required.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${code}_MISSING_FIELD`);
  }
}

function assertReviewCommit(value, attemptRef, task, candidate, result, allowedReadRefs) {
  const saved = value?.assistantCandidate;
  const update = saved?.jobAidWorkingUpdate;
  const expected = task?.jobAidContext?.modelInput?.expectedWorkRevision;
  const unchanged = task?.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA &&
    task.context.purpose === 'UPDATE_ASSESSMENT' && candidate?.jobAidWorkingDelta === null;
  const exactUnchangedReceipt = !unchanged || (
    saved?.actionAttemptRef === attemptRef &&
    saved?.provenance?.resultContentHash === result?.contentHash &&
    update?.status === 'UNCHANGED' &&
    update.workRevisionRef === task.jobAidContext.previousWork.workRevisionRef &&
    update.workRevision === expected &&
    Array.isArray(update.affectedIssueKeys) && update.affectedIssueKeys.length === 0);
  const readProofValid = !isRecord(update) || !Object.hasOwn(update, 'readSourceRefs') ||
    (Array.isArray(update.readSourceRefs) &&
      update.readSourceRefs.every((ref) => typeof ref === 'string' && ref.trim() !== '' &&
        allowedReadRefs.has(ref)) &&
      new Set(update.readSourceRefs).size === update.readSourceRefs.length);
  // A saved JobAid correction may invalidate its derived Overall. This is
  // permitted only by the Host's exact APPLIED receipt for this sealed result;
  // it does not authorize a formal ReviewAction or a WorkItem/current change.
  const exactJobAidInvalidation = task?.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA &&
    isRecord(candidate?.jobAidWorkingDelta) &&
    saved?.actionAttemptRef === attemptRef &&
    saved?.provenance?.resultContentHash === result?.contentHash &&
    update?.status === 'APPLIED' &&
    typeof update.workRevisionRef === 'string' && update.workRevisionRef.trim() !== '' &&
    update.workRevisionRef !== task.jobAidContext.previousWork?.workRevisionRef &&
    Number.isSafeInteger(expected) && expected >= 0 &&
    Number.isSafeInteger(update.workRevision) && update.workRevision === expected + 1;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 'wiselink.3_1.review_turn_commit.v1.c2' ||
    value.attemptRef !== attemptRef ||
    value.status !== 'SUCCEEDED' ||
    !exactUnchangedReceipt || !readProofValid ||
    value.authority?.candidatePersisted !== true ||
    value.authority?.reviewActionExecuted !== false ||
    value.authority?.workItemRevisionChanged !== false ||
    value.authority?.currentChanged !== false ||
    !(value.authority?.staleMarked === false ||
      (value.authority?.staleMarked === true && exactJobAidInvalidation))
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
  modelPolicyRef: WISELINK_MODEL_POLICY_REF,
  skillVersion: WISELINK_SKILL_VERSION,
  toolVersions: Object.freeze({
    [WISELINK_HOST_MCP_NAME]: WISELINK_HOST_MCP_VERSION,
  }),
});
