#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const WISELINK_SKILL_VERSION =
  'wiselink-research-and-synthesize@r09.c86';
export const WISELINK_SKILL_COMPATIBILITY_REF =
  'wiselink-research-and-synthesize@r09';
export const WISELINK_HOST_MCP_NAME =
  'wiselink-openclaw-engineering-assessment';
export const WISELINK_HOST_MCP_VERSION = '1.2.0';
export const WISELINK_MODEL_POLICY_REF = 'official-hosted-profile-config';
export const WISELINK_RUNTIME_APP_ID = 'app_17c3zn24kv2';
export const WISELINK_PROFILE_REF = 'wiselink-engineering';
export const WISELINK_APPLICABILITY_PROMPT_VERSION =
  'wiselink-applicability-extraction@r09.c4';

const TASK_ENVELOPE_SCHEMA = 'wiselink.3_1.openclaw_task_envelope.v1';
const RESULT_ENVELOPE_SCHEMA = 'wiselink.3_1.openclaw_result_envelope.v1';
const REVIEW_TASK_SCHEMA = 'wiselink.3_1.review_turn_task.v1.c2';
const REVIEW_CANDIDATE_SCHEMA = 'wiselink.3_1.review_turn_candidate.v1.c3';
export const REVIEW_JOBAID_TASK_SCHEMA = 'wiselink.3_1.review_turn_task.v1.c5';
export const REVIEW_JOBAID_CANDIDATE_SCHEMA = 'wiselink.3_1.review_turn_candidate.v1.c5';
export const REVIEW_MATTER_TASK_SCHEMA = 'wiselink.3_1.review_turn_task.v1.c4';
export const REVIEW_MATTER_CANDIDATE_SCHEMA = 'wiselink.3_1.review_turn_candidate.v1.c4';
const APPLICABILITY_TASK_SCHEMA = 'wiselink.3_1.applicability_task.v1';
const APPLICABILITY_AST_CANDIDATE_SCHEMA =
  'wiselink.3_1.applicability_ast_candidate.v1';
const APPLICABILITY_AST_VOCABULARY_SCHEMA =
  'wiselink.3_1.applicability_ast_vocabulary.v1';
const APPLICABILITY_CANDIDATE_SCHEMA =
  'wiselink.3_1.applicability_candidate.v1';
const BARE_SHA256 = /^[a-f0-9]{64}$/u;
const TASK_TYPES = new Set([
  'OPENCLAW_APPLICABILITY_EVALUATION',
  'OPENCLAW_DYNAMIC_EVALUATION',
  'OPENCLAW_INTERACTIVE_REVIEW',
  'OPENCLAW_OVERALL_SYNTHESIS',
  'OPENCLAW_TRANSLATE',
]);
export const REVIEW_ALLOWED_OPERATIONS = [
  'GET_WORKITEM_CONTEXT',
  'GET_EVALUATION_ITEM',
  'READ_SOURCE_REFS',
  'DRAFT_REVIEW_ACTION',
  'PREVIEW_AFFECTED_ITEMS',
  'GET_OPERATION_STATUS',
];
const REVIEW_RESPONSE_TYPES = new Set([
  'ANSWER',
  'CLARIFYING_QUESTION',
  'SOURCE_LINK',
  'CANDIDATE_EVIDENCE',
  'REVIEW_ACTION_DRAFT',
  'INPUT_REQUEST',
  'AFFECTED_ITEMS_PREVIEW',
  'TASK_STATUS',
]);
const REVIEW_UNCERTAINTY_DISPOSITIONS = new Set([
  'RESOLVE_NOW',
  'ACCEPT_WITH_ASSUMPTION',
  'APPLY_CONSERVATIVE_BOUND',
  'MITIGATE_AND_MONITOR',
  'DEFER_TO_REVIEW_DATE',
  'PROFESSIONAL_JUDGMENT',
  'OUT_OF_CURRENT_SCOPE',
  'LIFECYCLE_NOT_REACHED',
  'RESOLVED_BY_EVIDENCE',
  'NOT_APPLICABLE',
]);
const REVIEW_DECISION_MATURITIES = new Set([
  'PRELIMINARY',
  'REVIEWABLE',
  'CONFIRMABLE',
  'DEFERRED_WITH_MONITORING',
]);
const REVIEW_EVIDENCE_HORIZONS = new Set([
  'SOURCE_DOCUMENT_COMPLETE',
  'TARGET_IDENTITY_KNOWN',
  'CONFIGURATION_PARTIAL',
  'LOCAL_RELIABILITY_NOT_CONNECTED',
  'GLOBAL_EVIDENCE_PARTIAL',
  'OPERATIONS_REVIEW_PENDING',
]);

const PROVIDERS = new Set(['BOEING', 'AIRBUS', 'COMAC']);
const DISCOVERY_STATUSES = new Set([
  'COMPLETE',
  'PARTIAL',
  'ACCESS_DENIED',
  'ZERO_RESULT',
  'ZERO_RESULTS_FOR_TARGET_IDENTIFIER',
  'TRUNCATED',
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PACKAGE_ID = /^urn:techpub:package:v1:sha256:[a-f0-9]{64}$/u;
const SOURCE_REF_ID = /^urn:techpub:source-ref:v1:sha256:[a-f0-9]{64}$/u;
const OVERALL_REVIEW_SOURCE_REF_ID = /^review-evidence:\/\/[^/\s]+\/[1-9][0-9]*\/[^/\s]+\/[1-9][0-9]*$/u;
const OVERALL_MODEL_REVIEW_REF_ID = /^overall-evidence:engineer-review:[1-9][0-9]*:[1-9][0-9]*$/u;
/** Keep these two patterns aligned with the current Host ResultGate. */
const ATA_CHAPTER_PATTERN =
  /\bATA(?:\s+chapters?)?\s*[:：#]?\s*(\d{2,3}(?:-\d{2,3})?)(?!\d)/giu;
const PART_NUMBER_PATTERN =
  /\b\d{3}-(?:FTD|SL|SIL|FOTB)-\d{2,3}-\d{3,6}(?:\s?R\d+)?\b|\bD\d{10,14}\b/;
const CITATION_PATTERN = /\b\d{3}-FTD-\d{2,3}-\d{3,6}\b/;
export const DYNAMIC_RULES_TRANSPORT_TARGET_MAX_UTF8_BYTES = 28_000;
const DYNAMIC_RULE_RESULT_FIELDS = [
  'ruleId',
  'result',
  'factsConsidered',
  'ruleApplication',
  'analysisSummary',
  'conclusion',
  'sourceRefs',
  'missingInputs',
  'humanReviewRequired',
];
const DYNAMIC_NEXT_ROUND_FIELDS = [
  'missingInputId',
  'description',
  'affectedRuleIds',
  'requestedEvidenceOrFact',
  'priority',
  'blocking',
];
const FORBIDDEN_INPUT_KEYS = new Set([
  'workitemid',
  'actionattemptid',
  'attemptid',
  'expectedrevision',
  'transportid',
  'apikey',
  'xapikey',
  'appsecret',
  'accesstoken',
  'tenantaccesstoken',
  'actor',
  'actorid',
  'actorcontextref',
  'actoruserid',
  'actorroles',
  'tenant',
  'tenantid',
  'authority',
  'authorization',
  'permission',
  'permissionsnapshot',
  'permissionversion',
  'header',
  'headers',
  'cookie',
  'secret',
  'baserecordid',
  'reviewingengineeruserids',
  'revieweruserid',
  'acl',
  'acls',
  'credential',
  'credentials',
  'sessionkey',
  'openclawsessionkey',
  'bucket',
  'bucketid',
  'filepath',
  'objectkey',
  'fileservicelocator',
  'rawpdf',
  'pdfbytes',
  'fullfleet',
]);

export function validatePayload(kind, value) {
  assertObject(value, 'payload');
  switch (kind) {
    case 'task-envelope':
      validateTaskEnvelope(value);
      break;
    case 'result-envelope':
      exactKeys(value, ['task', 'result'], [], 'result envelope pair');
      validateResultEnvelope(value.task, value.result);
      break;
    case 'runtime-provenance':
      validateRuntimeProvenance(value);
      break;
    case 'translation-input':
      validateTranslationModelInput(value);
      break;
    case 'translation-pair':
      exactKeys(value, ['input', 'output'], [], 'translation pair');
      validateTranslationPair(value.input, value.output);
      break;
    case 'applicability-input':
      validateApplicabilityModelInput(value);
      break;
    case 'applicability-ast-candidate':
      validateApplicabilityAstCandidate(value);
      break;
    case 'applicability-pair':
      exactKeys(value, ['input', 'output'], [], 'applicability pair');
      validateApplicabilityModelInput(value.input);
      validateApplicabilityAstCandidate(value.output, value.input);
      break;
    case 'review-task':
      validateReviewTask(value);
      break;
    case 'review-candidate':
      exactKeys(value, ['task', 'candidate'], [], 'review candidate pair');
      validateReviewCandidate(value.task, value.candidate);
      break;
    case 'discovery-input':
      rejectAuthorityInput(value);
      validateDiscoveryInput(value);
      break;
    case 'discovery-output':
      rejectAuthorityInput(value);
      validateDiscoveryOutput(value);
      break;
    case 'synthesis-input':
      rejectAuthorityInput(value);
      validateSynthesisInput(value);
      break;
    case 'synthesis-output':
      rejectAuthorityInput(value);
      validateSynthesisOutput(value);
      break;
    case 'synthesis-pair':
      exactKeys(value, ['input', 'output'], [], 'synthesis pair');
      rejectAuthorityInput(value);
      validateSynthesisInput(value.input);
      validateSynthesisOutput(value.output);
      validateSynthesisPair(value.input, value.output);
      break;
    case 'dynamic-rules-input':
      rejectAuthorityInput(value);
      validateDynamicRulesInput(value);
      break;
    case 'dynamic-rules-output':
      rejectAuthorityInput(value);
      validateDynamicRulesOutput(value);
      break;
    case 'dynamic-rules-pair':
      exactKeys(value, ['input', 'output'], [], 'dynamic rules pair');
      rejectAuthorityInput(value);
      validateDynamicRulesInput(value.input);
      validateDynamicRulesOutput(value.output);
      validateDynamicRulesPair(value.input, value.output);
      break;
    default:
      fail(`UNKNOWN_VALIDATION_KIND:${kind}`);
  }
  return value;
}

export function validateDynamicRulesPair(input, output) {
  equal(
    output.callerCorrelationRef,
    input.callerCorrelationRef,
    'DYNAMIC_RULES_CALLER_CORRELATION_MISMATCH',
  );
  const table = input.jobAidContext.criterionTable;
  const criterionIdIndex = table.columns.indexOf('criterionId');
  const predicateResultIndex = table.columns.indexOf('predicateResult');
  const candidateConclusionIndex = table.columns.indexOf('candidateConclusion');
  const sourceIdsIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  const missingInputsIndex = table.columns.indexOf('missingPredicateKeys');
  if (
    criterionIdIndex < 0 ||
    predicateResultIndex < 0 ||
    candidateConclusionIndex < 0 ||
    sourceIdsIndex < 0 ||
    missingInputsIndex < 0
  ) {
    fail('DYNAMIC_RULES_CRITERION_COLUMNS_INVALID');
  }
  const expectedRuleIds = table.rows.map((row) =>
    String(row[criterionIdIndex]),
  );
  const rows = output.ruleResults.rows;
  if (rows.length !== expectedRuleIds.length) {
    fail(
      `DYNAMIC_RULES_RULE_COUNT_MISMATCH:${rows.length}:${expectedRuleIds.length}`,
    );
  }
  const maxRowBytes =
    input.responseInstruction.ruleResultsEncoding.maxRowUtf8Bytes;
  const catalog = dynamicSourceCatalog(
    input.jobAidContext.sourceEvidenceCatalog,
  );
  rows.forEach((row, index) => {
    if (
      !Array.isArray(row) ||
      row.length !== DYNAMIC_RULE_RESULT_FIELDS.length
    ) {
      fail(`DYNAMIC_RULES_RULE_RESULT_ROW_INVALID:${index}`);
    }
    equal(
      String(row[0]),
      expectedRuleIds[index],
      'DYNAMIC_RULES_RULE_MEMBERSHIP_OR_ORDER_MISMATCH',
    );
    nonEmpty(row[1], 'DYNAMIC_RULES_RESULT_INVALID');
    array(row[2], 'DYNAMIC_RULES_FACTS_INVALID');
    nonEmpty(row[3], 'DYNAMIC_RULES_RULE_APPLICATION_INVALID');
    nonEmpty(row[4], 'DYNAMIC_RULES_ANALYSIS_INVALID');
    nonEmpty(row[5], 'DYNAMIC_RULES_CONCLUSION_INVALID');
    arrayOfText(row[6], 'DYNAMIC_RULES_SOURCE_REFS_INVALID');
    arrayOfText(row[7], 'DYNAMIC_RULES_MISSING_INPUTS_INVALID');
    boolean(row[8], 'DYNAMIC_RULES_HUMAN_REVIEW_INVALID');
    if (Buffer.byteLength(JSON.stringify(row), 'utf8') > maxRowBytes) {
      fail(`DYNAMIC_RULES_RULE_RESULT_ROW_BUDGET_EXCEEDED:${index}`);
    }
    const returnedRefs = row[6];
    if (new Set(returnedRefs).size !== returnedRefs.length) {
      fail(`DYNAMIC_RULES_SOURCE_REF_DUPLICATED:${index}`);
    }
    const allowedRefs = dynamicAllowedSourceRefs(table, sourceIdsIndex, index);
    for (const ref of returnedRefs) {
      if (!catalog.has(ref) || !allowedRefs.has(ref)) {
        fail(`DYNAMIC_RULES_SOURCE_REF_NOT_BOUND:${index}:${ref}`);
      }
    }
    const expectedMissingInputs = dynamicCriterionArrayValue(
      table,
      missingInputsIndex,
      index,
      'DYNAMIC_RULES_MISSING_INPUT_BINDING_INVALID',
    );
    equal(
      JSON.stringify(row[7]),
      JSON.stringify(expectedMissingInputs),
      `DYNAMIC_RULES_MISSING_INPUT_DRIFT:${index}`,
    );
    validateDynamicRuleSemantics({
      predicateResult: dynamicCriterionTextValue(
        table,
        predicateResultIndex,
        index,
        'DYNAMIC_RULES_PREDICATE_RESULT_INVALID',
      ),
      candidateConclusion: dynamicCriterionTextValue(
        table,
        candidateConclusionIndex,
        index,
        'DYNAMIC_RULES_CANDIDATE_CONCLUSION_INVALID',
      ),
      allowedRefs,
      expectedMissingInputs,
      row,
      index,
    });
  });
  const completion = output.completionSelfCheck;
  equal(
    output.applicabilityOverall,
    input.jobAidContext.currentAssessment.applicabilityOverall,
    'DYNAMIC_RULES_APPLICABILITY_BOUNDARY_CHANGED',
  );
  equal(
    completion.expectedRuleCount,
    expectedRuleIds.length,
    'DYNAMIC_RULES_COMPLETION_COUNT_MISMATCH',
  );
  equal(
    completion.sourcePageCount,
    input.responseInstruction.completionSelfCheck.sourcePageCount,
    'DYNAMIC_RULES_COMPLETION_SOURCE_PAGE_MISMATCH',
  );
  equal(
    completion.allInputRulesReturned,
    true,
    'DYNAMIC_RULES_COMPLETION_INCOMPLETE',
  );
  equal(
    completion.returnedRuleIdsMatchInputOrder,
    true,
    'DYNAMIC_RULES_COMPLETION_ORDER_INVALID',
  );
  equal(
    completion.returnedRuleIdsUnique,
    true,
    'DYNAMIC_RULES_COMPLETION_UNIQUENESS_INVALID',
  );
  equal(
    output.overallSelfCheck.ruleResultCount,
    expectedRuleIds.length,
    'DYNAMIC_RULES_SELF_CHECK_COUNT_MISMATCH',
  );
  equal(
    output.overallSelfCheck.rulesWithMissingInputs,
    rows.filter((row) => row[7].length > 0).length,
    'DYNAMIC_RULES_SELF_CHECK_MISSING_COUNT_MISMATCH',
  );
  equal(
    output.overallSelfCheck.humanReviewRequiredCount,
    rows.filter((row) => row[8] === true).length,
    'DYNAMIC_RULES_SELF_CHECK_REVIEW_COUNT_MISMATCH',
  );
  equal(
    output.overallSelfCheck.overallOpinionProduced,
    false,
    'DYNAMIC_RULES_OVERALL_OPINION_FORBIDDEN',
  );
  equal(
    output.overallSelfCheck.holisticSynthesisDeferredToOpenClaw,
    true,
    'DYNAMIC_RULES_HOLISTIC_DEFERRED_REQUIRED',
  );
  if (
    Buffer.byteLength(JSON.stringify(output), 'utf8') >
    input.responseInstruction.outputBudget.maxUtf8Bytes
  ) {
    fail('DYNAMIC_RULES_OUTPUT_BUDGET_EXCEEDED');
  }
  if (
    output.nextRoundChecklist.length >
    input.responseInstruction.outputBudget.maxNextRoundChecklistItems
  ) {
    fail('DYNAMIC_RULES_NEXT_ROUND_BUDGET_EXCEEDED');
  }
  validateDynamicNextRoundChecklist(input, output, expectedRuleIds);
  const transportBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  if (transportBytes >= DYNAMIC_RULES_TRANSPORT_TARGET_MAX_UTF8_BYTES) {
    fail(
      `DYNAMIC_RULES_TRANSPORT_TARGET_EXCEEDED:${transportBytes}:` +
        `${DYNAMIC_RULES_TRANSPORT_TARGET_MAX_UTF8_BYTES}`,
    );
  }
  return output;
}

export function serializeDynamicRulesCommitOutput(input, output) {
  validatePayload('dynamic-rules-pair', { input, output });
  return JSON.stringify(output);
}

function validateDynamicRulesInput(input) {
  exactKeys(
    input,
    [
      'purpose',
      'callerCorrelationRef',
      'operatorInstruction',
      'subjectContext',
      'jobAidContext',
      'expectedSelfCheck',
      'responseInstruction',
    ],
    ['commonContext'],
    'dynamic rules input',
  );
  equal(
    input.purpose,
    'EVALUATE_DYNAMIC_RULES',
    'DYNAMIC_RULES_PURPOSE_INVALID',
  );
  nonEmpty(
    input.callerCorrelationRef,
    'DYNAMIC_RULES_CALLER_CORRELATION_INVALID',
  );
  arrayOfText(
    input.operatorInstruction,
    'DYNAMIC_RULES_OPERATOR_INSTRUCTION_INVALID',
  );
  assertObject(input.subjectContext, 'dynamic rules subject context');
  assertObject(input.jobAidContext, 'dynamic rules Job Aid context');
  const table = input.jobAidContext.criterionTable;
  assertObject(table, 'dynamic rules criterion table');
  arrayOfText(table.columns, 'DYNAMIC_RULES_CRITERION_COLUMNS_INVALID');
  array(table.rows, 'DYNAMIC_RULES_CRITERION_ROWS_INVALID');
  positiveInteger(table.rowCount, 'DYNAMIC_RULES_CRITERION_COUNT_INVALID');
  if (table.rows.length !== table.rowCount)
    fail('DYNAMIC_RULES_CRITERION_COUNT_MISMATCH');
  const criterionIdIndex = table.columns.indexOf('criterionId');
  if (criterionIdIndex < 0) fail('DYNAMIC_RULES_CRITERION_ID_COLUMN_MISSING');
  const criterionIds = table.rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      fail(`DYNAMIC_RULES_CRITERION_ROW_INVALID:${index}`);
    }
    const criterionId = row[criterionIdIndex];
    nonEmpty(criterionId, 'DYNAMIC_RULES_CRITERION_ID_INVALID');
    return criterionId;
  });
  if (new Set(criterionIds).size !== criterionIds.length) {
    fail('DYNAMIC_RULES_CRITERION_IDS_NOT_UNIQUE');
  }
  const predicateResultIndex = table.columns.indexOf('predicateResult');
  const candidateConclusionIndex = table.columns.indexOf('candidateConclusion');
  const missingInputsIndex = table.columns.indexOf('missingPredicateKeys');
  const sourceIdsIndex = table.columns.indexOf('sourceEvidenceCandidateIds');
  if (
    predicateResultIndex < 0 ||
    candidateConclusionIndex < 0 ||
    missingInputsIndex < 0 ||
    sourceIdsIndex < 0 ||
    table.columns.indexOf('engineerReview') < 0
  ) {
    fail('DYNAMIC_RULES_EVALUATION_ITEM_COLUMNS_MISSING');
  }
  table.rows.forEach((row, index) => {
    const predicateResult = dynamicCriterionTextValue(
      table,
      predicateResultIndex,
      index,
      'DYNAMIC_RULES_PREDICATE_RESULT_INVALID',
    );
    dynamicCriterionTextValue(
      table,
      candidateConclusionIndex,
      index,
      'DYNAMIC_RULES_CANDIDATE_CONCLUSION_INVALID',
    );
    const missingInputs = dynamicCriterionArrayValue(
      table,
      missingInputsIndex,
      index,
      'DYNAMIC_RULES_MISSING_INPUT_BINDING_INVALID',
    );
    dynamicCriterionArrayValue(
      table,
      sourceIdsIndex,
      index,
      'DYNAMIC_RULES_SOURCE_REF_BINDING_INVALID',
    );
    if (!['TRUE', 'FALSE', 'UNKNOWN'].includes(predicateResult)) {
      fail(`DYNAMIC_RULES_PREDICATE_RESULT_INVALID:${index}`);
    }
    if (predicateResult === 'UNKNOWN' && missingInputs.length === 0) {
      fail(`DYNAMIC_RULES_UNKNOWN_WITHOUT_HOST_MISSING_PREDICATE:${index}`);
    }
    if (predicateResult !== 'UNKNOWN' && missingInputs.length > 0) {
      fail(`DYNAMIC_RULES_NON_UNKNOWN_WITH_MISSING_PREDICATE:${index}`);
    }
  });
  const resources = input.jobAidContext.resourceTable;
  assertObject(resources, 'dynamic rules resource table');
  arrayOfText(resources.columns, 'DYNAMIC_RULES_RESOURCE_COLUMNS_INVALID');
  equal(
    resources.rowCount,
    table.rowCount,
    'DYNAMIC_RULES_RESOURCE_COUNT_MISMATCH',
  );
  array(resources.rows, 'DYNAMIC_RULES_RESOURCE_ROWS_INVALID');
  equal(
    resources.rows.length,
    table.rowCount,
    'DYNAMIC_RULES_RESOURCE_ROWS_COUNT_MISMATCH',
  );
  const resourceCriterionIdIndex = resources.columns.indexOf('criterionId');
  if (resourceCriterionIdIndex < 0)
    fail('DYNAMIC_RULES_RESOURCE_CRITERION_ID_MISSING');
  resources.rows.forEach((row, index) => {
    if (
      !Array.isArray(row) ||
      row.length !== resources.columns.length ||
      row[resourceCriterionIdIndex] !== criterionIds[index]
    ) {
      fail(`DYNAMIC_RULES_RESOURCE_MEMBERSHIP_OR_ORDER_MISMATCH:${index}`);
    }
  });
  dynamicSourceCatalog(input.jobAidContext.sourceEvidenceCatalog);
  assertObject(input.expectedSelfCheck, 'dynamic rules expected self check');
  equal(
    input.expectedSelfCheck.criterionCount,
    table.rowCount,
    'DYNAMIC_RULES_EXPECTED_COUNT_MISMATCH',
  );
  equal(
    input.expectedSelfCheck.authorityLevel,
    'candidate_only',
    'DYNAMIC_RULES_EXPECTED_AUTHORITY_INVALID',
  );
  equal(
    input.expectedSelfCheck.engineeringConclusion,
    null,
    'DYNAMIC_RULES_EXPECTED_CONCLUSION_INVALID',
  );
  validateDynamicContextIdentity(input, table.rowCount);
  const instruction = input.responseInstruction;
  assertObject(instruction, 'dynamic rules response instruction');
  equal(
    instruction.expectedRuleCount,
    table.rowCount,
    'DYNAMIC_RULES_RESPONSE_COUNT_MISMATCH',
  );
  equal(
    instruction.authorityLevel,
    'candidate_only',
    'DYNAMIC_RULES_RESPONSE_AUTHORITY_INVALID',
  );
  equal(
    instruction.engineeringConclusion,
    null,
    'DYNAMIC_RULES_RESPONSE_CONCLUSION_INVALID',
  );
  equal(
    instruction.echoCallerCorrelationRefExactly,
    true,
    'DYNAMIC_RULES_ECHO_CORRELATION_REQUIRED',
  );
  if (
    !Array.isArray(instruction.requiredSections) ||
    !instruction.requiredSections.includes('callerCorrelationRef') ||
    !instruction.requiredSections.includes('ruleResults')
  ) {
    fail('DYNAMIC_RULES_REQUIRED_SECTIONS_INVALID');
  }
  if (
    !Array.isArray(instruction.forbiddenSections) ||
    !instruction.forbiddenSections.includes('overallAssessment')
  ) {
    fail('DYNAMIC_RULES_FORBIDDEN_SECTIONS_INVALID');
  }
  assertObject(
    instruction.ruleResultsEncoding,
    'dynamic rules result encoding',
  );
  equal(
    instruction.ruleResultsEncoding.type,
    'COLUMNAR_ROWS',
    'DYNAMIC_RULES_RESULT_ENCODING_INVALID',
  );
  if (
    JSON.stringify(instruction.ruleResultsEncoding.columns) !==
    JSON.stringify(DYNAMIC_RULE_RESULT_FIELDS)
  ) {
    fail('DYNAMIC_RULES_RESULT_COLUMNS_INVALID');
  }
  positiveInteger(
    instruction.ruleResultsEncoding.maxRowUtf8Bytes,
    'DYNAMIC_RULES_ROW_BUDGET_INVALID',
  );
  assertObject(instruction.outputBudget, 'dynamic rules output budget');
  positiveInteger(
    instruction.outputBudget.maxUtf8Bytes,
    'DYNAMIC_RULES_OUTPUT_BUDGET_INVALID',
  );
  assertObject(
    instruction.nextRoundChecklist,
    'dynamic rules next round instruction',
  );
  equal(
    instruction.nextRoundChecklist.required,
    true,
    'DYNAMIC_RULES_NEXT_ROUND_REQUIRED',
  );
  equal(
    instruction.nextRoundChecklist.deduplicateMissingInputs,
    true,
    'DYNAMIC_RULES_NEXT_ROUND_DEDUP_REQUIRED',
  );
  positiveInteger(
    instruction.nextRoundChecklist.maxItems,
    'DYNAMIC_RULES_NEXT_ROUND_MAX_INVALID',
  );
  positiveInteger(
    instruction.nextRoundChecklist.maxItemUtf8Bytes,
    'DYNAMIC_RULES_NEXT_ROUND_ITEM_MAX_INVALID',
  );
  if (
    JSON.stringify(instruction.nextRoundChecklist.requiredFields) !==
    JSON.stringify(DYNAMIC_NEXT_ROUND_FIELDS)
  ) {
    fail('DYNAMIC_RULES_NEXT_ROUND_FIELDS_INVALID');
  }
  return input;
}

function validateDynamicRulesOutput(output) {
  exactKeys(
    output,
    [
      'callerCorrelationRef',
      'authorityLevel',
      'engineeringConclusion',
      'applicabilityOverall',
      'ruleResults',
      'overallSelfCheck',
      'nextRoundChecklist',
      'completionSelfCheck',
    ],
    [],
    'dynamic rules output',
  );
  nonEmpty(
    output.callerCorrelationRef,
    'DYNAMIC_RULES_CALLER_CORRELATION_INVALID',
  );
  equal(
    output.authorityLevel,
    'candidate_only',
    'DYNAMIC_RULES_AUTHORITY_INVALID',
  );
  equal(
    output.engineeringConclusion,
    null,
    'DYNAMIC_RULES_ENGINEERING_CONCLUSION_FORBIDDEN',
  );
  nonEmpty(output.applicabilityOverall, 'DYNAMIC_RULES_APPLICABILITY_INVALID');
  assertObject(output.ruleResults, 'dynamic rules results');
  exactKeys(
    output.ruleResults,
    ['columns', 'rows'],
    [],
    'dynamic rules results',
  );
  if (
    JSON.stringify(output.ruleResults.columns) !==
    JSON.stringify(DYNAMIC_RULE_RESULT_FIELDS)
  ) {
    fail('DYNAMIC_RULES_RESULT_COLUMNS_INVALID');
  }
  array(output.ruleResults.rows, 'DYNAMIC_RULES_RESULT_ROWS_INVALID');
  assertObject(output.overallSelfCheck, 'dynamic rules overall self check');
  exactKeys(
    output.overallSelfCheck,
    [
      'ruleResultCount',
      'rulesWithMissingInputs',
      'humanReviewRequiredCount',
      'overallOpinionProduced',
      'holisticSynthesisDeferredToOpenClaw',
    ],
    [],
    'dynamic rules overall self check',
  );
  array(output.nextRoundChecklist, 'DYNAMIC_RULES_NEXT_ROUND_INVALID');
  assertObject(
    output.completionSelfCheck,
    'dynamic rules completion self check',
  );
  exactKeys(
    output.completionSelfCheck,
    [
      'expectedRuleCount',
      'sourcePageCount',
      'allInputRulesReturned',
      'returnedRuleIdsMatchInputOrder',
      'returnedRuleIdsUnique',
    ],
    [],
    'dynamic rules completion self check',
  );
  rejectDynamicAuthorityNarrative(output);
  return output;
}

function validateDynamicContextIdentity(input, expectedCount) {
  const subject = input.subjectContext;
  const identity = input.jobAidContext.identity;
  const criterionSet = identity?.criterionSet;
  const expected = input.expectedSelfCheck;
  const assessment = expected.assessmentSelfCheck;
  const current = input.jobAidContext.currentAssessment;
  const resourceSummary = input.jobAidContext.resourceSummary;
  const workInstructions =
    input.jobAidContext.structuredAssessmentContext?.workInstructions;
  assertObject(identity, 'dynamic rules context identity');
  assertObject(criterionSet, 'dynamic rules CriterionSet identity');
  assertObject(assessment, 'dynamic rules assessment self check');
  assertObject(current, 'dynamic rules current assessment');
  assertObject(current.counts, 'dynamic rules current assessment counts');
  assertObject(resourceSummary, 'dynamic rules resource summary');
  assertObject(workInstructions, 'dynamic rules structured work instructions');
  equal(
    subject.documentIdentity?.documentId,
    identity.documentId,
    'DYNAMIC_RULES_DOCUMENT_IDENTITY_MISMATCH',
  );
  equal(
    subject.documentIdentity?.revisionId,
    identity.documentVersionId,
    'DYNAMIC_RULES_DOCUMENT_VERSION_IDENTITY_MISMATCH',
  );
  equal(
    subject.unifiedParsedPackage?.documentVersionId,
    identity.documentVersionId,
    'DYNAMIC_RULES_PACKAGE_DOCUMENT_VERSION_MISMATCH',
  );
  equal(
    subject.unifiedParsedPackage?.documentId,
    identity.documentId,
    'DYNAMIC_RULES_PACKAGE_DOCUMENT_IDENTITY_MISMATCH',
  );
  equal(
    subject.unifiedParsedPackage?.packageId,
    identity.structuredParsePackageId,
    'DYNAMIC_RULES_PACKAGE_IDENTITY_MISMATCH',
  );
  equal(
    subject.unifiedParsedPackage?.contractRevision,
    'frozen.2',
    'DYNAMIC_RULES_PACKAGE_REVISION_INVALID',
  );
  equal(
    expected.documentVersionId,
    identity.documentVersionId,
    'DYNAMIC_RULES_EXPECTED_DOCUMENT_VERSION_MISMATCH',
  );
  equal(
    expected.criterionSetId,
    criterionSet.criterionSetId,
    'DYNAMIC_RULES_CRITERION_SET_IDENTITY_MISMATCH',
  );
  equal(
    criterionSet.criteriaCount,
    expectedCount,
    'DYNAMIC_RULES_CRITERION_SET_COUNT_MISMATCH',
  );
  sha256(
    criterionSet.criterionSetHash,
    'DYNAMIC_RULES_CRITERION_SET_HASH_INVALID',
  );
  sha256(
    criterionSet.criterionSetMemberIdentityHash,
    'DYNAMIC_RULES_CRITERION_MEMBER_HASH_INVALID',
  );
  equal(
    assessment.contextId,
    identity.contextId,
    'DYNAMIC_RULES_CONTEXT_IDENTITY_MISMATCH',
  );
  sha256(assessment.contextHash, 'DYNAMIC_RULES_CONTEXT_HASH_INVALID');
  sha256(
    assessment.evaluationItemSetHash,
    'DYNAMIC_RULES_EVALUATION_ITEM_SET_HASH_INVALID',
  );
  equal(
    assessment.assessmentPackageId,
    identity.assessmentPackageId,
    'DYNAMIC_RULES_ASSESSMENT_PACKAGE_IDENTITY_MISMATCH',
  );
  equal(
    assessment.structuredParsePackageId,
    identity.structuredParsePackageId,
    'DYNAMIC_RULES_STRUCTURED_PACKAGE_IDENTITY_MISMATCH',
  );
  equal(
    assessment.criterionCardCount,
    expectedCount,
    'DYNAMIC_RULES_CRITERION_CARD_COUNT_MISMATCH',
  );
  equal(
    assessment.resourceAssessmentCount,
    expectedCount,
    'DYNAMIC_RULES_RESOURCE_ASSESSMENT_COUNT_MISMATCH',
  );
  integerInRange(
    assessment.humanRequiredCount,
    0,
    expectedCount,
    'DYNAMIC_RULES_EXPECTED_HUMAN_REVIEW_COUNT_INVALID',
  );
  equal(
    assessment.applicabilityOverall,
    current.applicabilityOverall,
    'DYNAMIC_RULES_ASSESSMENT_APPLICABILITY_MISMATCH',
  );
  equal(
    assessment.documentApplicabilityProvesFleetApplicability,
    false,
    'DYNAMIC_RULES_FLEET_APPLICABILITY_INFERENCE_FORBIDDEN',
  );
  equal(
    assessment.authorityLevel,
    'candidate_only',
    'DYNAMIC_RULES_ASSESSMENT_AUTHORITY_INVALID',
  );
  equal(
    assessment.sourceUnitSetId,
    identity.sourceUnitSetId,
    'DYNAMIC_RULES_SOURCE_UNIT_SET_IDENTITY_MISMATCH',
  );
  equal(
    assessment.jobAidActiveVersion,
    criterionSet.activeVersion,
    'DYNAMIC_RULES_JOB_AID_ACTIVE_VERSION_MISMATCH',
  );
  equal(
    assessment.jobAidTargetCandidateVersion,
    criterionSet.targetCandidateVersion,
    'DYNAMIC_RULES_JOB_AID_TARGET_VERSION_MISMATCH',
  );
  equal(
    current.counts.total,
    expectedCount,
    'DYNAMIC_RULES_CURRENT_ASSESSMENT_COUNT_MISMATCH',
  );
  equal(
    current.counts.humanRequired,
    assessment.humanRequiredCount,
    'DYNAMIC_RULES_CURRENT_HUMAN_REVIEW_COUNT_MISMATCH',
  );
  equal(
    current.counts.unresolved,
    assessment.unresolvedCount,
    'DYNAMIC_RULES_CURRENT_UNRESOLVED_COUNT_MISMATCH',
  );
  equal(
    resourceSummary.MISSING,
    assessment.resourceMissingCount,
    'DYNAMIC_RULES_RESOURCE_MISSING_COUNT_MISMATCH',
  );
  equal(
    workInstructions.availability,
    assessment.parsedWorkStepAvailability,
    'DYNAMIC_RULES_WORK_STEP_AVAILABILITY_MISMATCH',
  );
  equal(
    JSON.stringify(workInstructions.stepIds),
    JSON.stringify(assessment.parsedWorkStepIds),
    'DYNAMIC_RULES_WORK_STEP_IDENTITY_MISMATCH',
  );
}

function validateDynamicNextRoundChecklist(input, output, expectedRuleIds) {
  const instruction = input.responseInstruction.nextRoundChecklist;
  const table = input.jobAidContext.criterionTable;
  const missingIndex = table.columns.indexOf('missingPredicateKeys');
  const missingToRules = new Map();
  table.rows.forEach((_row, index) => {
    for (const missingInputId of dynamicCriterionArrayValue(
      table,
      missingIndex,
      index,
      'DYNAMIC_RULES_MISSING_INPUT_BINDING_INVALID',
    )) {
      const affected = missingToRules.get(missingInputId) ?? [];
      affected.push(expectedRuleIds[index]);
      missingToRules.set(missingInputId, affected);
    }
  });
  if (missingToRules.size > 0 && output.nextRoundChecklist.length === 0) {
    fail('DYNAMIC_RULES_NEXT_ROUND_CHECKLIST_EMPTY_WITH_GAPS');
  }
  const seenMissingInputs = new Set();
  for (const [index, item] of output.nextRoundChecklist.entries()) {
    assertObject(item, 'dynamic rules next round item');
    exactKeys(
      item,
      instruction.requiredFields,
      [],
      'dynamic rules next round item',
    );
    nonEmpty(item.missingInputId, 'DYNAMIC_RULES_NEXT_ROUND_ID_INVALID');
    if (seenMissingInputs.has(item.missingInputId)) {
      fail(`DYNAMIC_RULES_NEXT_ROUND_DUPLICATE:${item.missingInputId}`);
    }
    seenMissingInputs.add(item.missingInputId);
    const allowedRules = missingToRules.get(item.missingInputId);
    if (!allowedRules)
      fail(`DYNAMIC_RULES_NEXT_ROUND_UNKNOWN_GAP:${item.missingInputId}`);
    nonEmpty(item.description, 'DYNAMIC_RULES_NEXT_ROUND_DESCRIPTION_INVALID');
    arrayOfText(item.affectedRuleIds, 'DYNAMIC_RULES_NEXT_ROUND_RULES_INVALID');
    if (JSON.stringify(item.affectedRuleIds) !== JSON.stringify(allowedRules)) {
      fail(
        `DYNAMIC_RULES_NEXT_ROUND_RULE_BINDING_INVALID:${item.missingInputId}`,
      );
    }
    nonEmpty(
      item.requestedEvidenceOrFact,
      'DYNAMIC_RULES_NEXT_ROUND_REQUEST_INVALID',
    );
    nonEmpty(item.priority, 'DYNAMIC_RULES_NEXT_ROUND_PRIORITY_INVALID');
    boolean(item.blocking, 'DYNAMIC_RULES_NEXT_ROUND_BLOCKING_INVALID');
    if (
      Buffer.byteLength(JSON.stringify(item), 'utf8') >
      instruction.maxItemUtf8Bytes
    ) {
      fail(`DYNAMIC_RULES_NEXT_ROUND_ITEM_BUDGET_EXCEEDED:${index}`);
    }
  }
}

function dynamicSourceCatalog(value) {
  assertObject(value, 'dynamic rules source evidence catalog');
  arrayOfText(value.columns, 'DYNAMIC_RULES_SOURCE_CATALOG_COLUMNS_INVALID');
  array(value.rows, 'DYNAMIC_RULES_SOURCE_CATALOG_ROWS_INVALID');
  const candidateIdIndex = value.columns.indexOf('candidateId');
  if (candidateIdIndex < 0)
    fail('DYNAMIC_RULES_SOURCE_CATALOG_ID_COLUMN_MISSING');
  const ids = new Set();
  value.rows.forEach((row, index) => {
    if (!Array.isArray(row))
      fail(`DYNAMIC_RULES_SOURCE_CATALOG_ROW_INVALID:${index}`);
    const id = row[candidateIdIndex];
    nonEmpty(id, 'DYNAMIC_RULES_SOURCE_CATALOG_ID_INVALID');
    if (ids.has(id)) fail(`DYNAMIC_RULES_SOURCE_CATALOG_ID_DUPLICATE:${id}`);
    ids.add(id);
  });
  return ids;
}

function dynamicAllowedSourceRefs(table, sourceIdsIndex, rowIndex) {
  return new Set(
    dynamicCriterionArrayValue(
      table,
      sourceIdsIndex,
      rowIndex,
      'DYNAMIC_RULES_SOURCE_REF_BINDING_INVALID',
    ),
  );
}

function dynamicCriterionArrayValue(table, columnIndex, rowIndex, code) {
  const columnName = table.columns[columnIndex];
  const encoded = table.rows[rowIndex][columnIndex];
  const dictionary = table.valueDictionaries?.[columnName];
  const values =
    Number.isInteger(encoded) && Array.isArray(dictionary)
      ? dictionary[encoded]
      : encoded;
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string')
  ) {
    fail(`${code}:${rowIndex}`);
  }
  return values;
}

function dynamicCriterionTextValue(table, columnIndex, rowIndex, code) {
  const columnName = table.columns[columnIndex];
  const encoded = table.rows[rowIndex][columnIndex];
  const dictionary = table.valueDictionaries?.[columnName];
  const value =
    Number.isInteger(encoded) && Array.isArray(dictionary)
      ? dictionary[encoded]
      : encoded;
  nonEmpty(value, `${code}:${rowIndex}`);
  return value;
}

function validateDynamicRuleSemantics({
  predicateResult,
  candidateConclusion,
  allowedRefs,
  expectedMissingInputs,
  row,
  index,
}) {
  if (predicateResult === 'FALSE') {
    equal(
      row[1],
      'NOT_APPLICABLE',
      `DYNAMIC_RULES_FALSE_NOT_APPLICABLE_REQUIRED:${index}`,
    );
    if (row[6].length > 0 || row[7].length > 0 || row[8] !== false) {
      fail(`DYNAMIC_RULES_FALSE_BOUNDARY_INVALID:${index}`);
    }
    return;
  }
  if (predicateResult === 'UNKNOWN') {
    if (expectedMissingInputs.length === 0) {
      fail(`DYNAMIC_RULES_UNKNOWN_WITHOUT_HOST_MISSING_PREDICATE:${index}`);
    }
    equal(
      row[1],
      'UNKNOWN/WAITING_INPUT',
      `DYNAMIC_RULES_UNKNOWN_STATUS_INVALID:${index}`,
    );
    equal(row[8], true, `DYNAMIC_RULES_UNKNOWN_REVIEW_REQUIRED:${index}`);
    return;
  }
  if (predicateResult !== 'TRUE') {
    fail(`DYNAMIC_RULES_PREDICATE_RESULT_INVALID:${index}`);
  }
  if (
    row[7].length > 0 ||
    [
      'BLOCKED_MISSING_INPUT',
      'UNKNOWN/WAITING_INPUT',
      'NOT_APPLICABLE',
    ].includes(row[1])
  ) {
    fail(`DYNAMIC_RULES_TRUE_PREDICATE_DOWNGRADED:${index}`);
  }
  if (allowedRefs.size > 0 && row[2].length === 0 && row[6].length === 0) {
    fail(`DYNAMIC_RULES_TRUE_SOURCE_CANDIDATE_DROPPED:${index}`);
  }
  if (
    allowedRefs.size > 0 &&
    /(?:UNKNOWN|WAITING_INPUT|BLOCKED_MISSING_INPUT)/iu.test(
      `${row[1]}\n${row[5]}`,
    )
  ) {
    fail(`DYNAMIC_RULES_TRUE_SOURCE_CANDIDATE_DOWNGRADED:${index}`);
  }
  if (
    candidateConclusion === 'pass' &&
    /(?:FAIL|NOT_APPLICABLE|UNKNOWN|WAITING_INPUT)/iu.test(
      `${row[1]}\n${row[5]}`,
    )
  ) {
    fail(`DYNAMIC_RULES_TRUE_PASS_CANDIDATE_DOWNGRADED:${index}`);
  }
}

function rejectDynamicAuthorityNarrative(output) {
  const text = output.ruleResults.rows
    .flatMap((row) =>
      Array.isArray(row) ? [row[1], row[3], row[4], row[5]] : [],
    )
    .join('\n');
  const forbidden = [
    /(?:已批准|批准执行|批准放行|可直接实施|可以直接实施)/u,
    /形成适航结论/u,
    /\b(?:approved|airworthiness conclusion|safe to release)\b/iu,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    fail('DYNAMIC_RULES_AUTHORITATIVE_NARRATIVE_FORBIDDEN');
  }
}

export function validateSynthesisPair(input, output) {
  const base = input.baseRuleResult;
  const context = input.unifiedSourceContext;
  equal(
    output.sourceResultId,
    input.outputCorrelationRef,
    'OVERALL_CORRELATION_MISMATCH',
  );
  equal(
    output.documentVersionId,
    base.documentVersionId,
    'OVERALL_DOCUMENT_VERSION_MISMATCH',
  );
  equal(output.packageId, base.packageId, 'OVERALL_PACKAGE_ID_MISMATCH');
  equal(
    output.baseRuleRevision,
    base.revision,
    'OVERALL_BASE_REVISION_MISMATCH',
  );
  equal(
    output.baseRuleArtifactSha256,
    base.artifactSha256,
    'OVERALL_BASE_ARTIFACT_MISMATCH',
  );
  equal(
    output.engineerReviewRevision,
    input.engineerReviewContext.revision,
    'OVERALL_ENGINEER_REVIEW_REVISION_MISMATCH',
  );
  equal(
    output.engineerReviewArtifactSha256,
    input.engineerReviewContext.artifactSha256,
    'OVERALL_ENGINEER_REVIEW_ARTIFACT_MISMATCH',
  );
  equal(
    output.applicabilityStatus,
    expectedOverallApplicabilityStatus(input.applicabilityResult),
    'OVERALL_APPLICABILITY_STATUS_MISMATCH',
  );
  const knownRefs = new Set(context.sourceRefs.map((item) => item.sourceRefId));
  for (const finding of output.findings) {
    for (const sourceRefId of finding.sourceRefIds) {
      if (!knownRefs.has(sourceRefId))
        fail(`OVERALL_UNKNOWN_SOURCE_REF:${sourceRefId}`);
    }
  }
  const readingV2 = output.engineeringSummary.schemaVersion === 'wiselink.3_1.overall_engineering_summary.v2';
  if (input.evidenceRegistry !== undefined && !readingV2) fail('OVERALL_READING_SUMMARY_VERSION_REQUIRED');
  if (readingV2) {
    if (!input.evidenceRegistry) fail('OVERALL_READING_EVIDENCE_REGISTRY_REQUIRED');
    const knownEvidence = new Set(input.evidenceRegistry.map((item) => item.evidenceRef));
    for (const claim of output.engineeringSummary.claims) {
      for (const premise of claim.premises) {
        if (!knownEvidence.has(premise.evidenceRef)) fail(`OVERALL_UNKNOWN_EVIDENCE_REF:${premise.evidenceRef}`);
      }
    }
  } else {
    validateEngineeringSummaryBindings(output.engineeringSummary, knownRefs, new Set(context.currentDocumentSourceRefIds));
  }
  equal(output.unresolvedCount, base.unresolvedCount, 'OVERALL_UNRESOLVED_COUNT_MISMATCH');
  const candidateRefCount = input.externalDiscoveryResults.reduce(
    (count, result) => count + result.candidates.length,
    0,
  );
  equal(
    output.candidateRefCount,
    candidateRefCount,
    'OVERALL_CANDIDATE_COUNT_MISMATCH',
  );
  const expectedProviders = Object.fromEntries(
    input.externalDiscoveryResults
      .map((result) => [
        result.provider.toLowerCase(),
        discoveryProviderSummary(result),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  equal(
    JSON.stringify(output.providers),
    JSON.stringify(expectedProviders),
    'OVERALL_PROVIDER_SUMMARY_MISMATCH',
  );
  equal(
    output.discoveryStatus,
    canonicalDiscoveryStatus(input.externalDiscoveryResults),
    'OVERALL_DISCOVERY_STATUS_MISMATCH',
  );
  return output;
}

function validateDiscoveryInput(input) {
  exactKeys(
    input,
    ['operation', 'provider', 'query', 'targetIdentifiers'],
    ['maxCandidates'],
    'discovery input',
  );
  equal(input.operation, 'DISCOVER_PUBLIC_OEM', 'DISCOVERY_OPERATION_INVALID');
  provider(input.provider);
  nonEmpty(input.query, 'DISCOVERY_QUERY_INVALID');
  arrayOfText(input.targetIdentifiers, 'DISCOVERY_TARGET_IDENTIFIERS_INVALID');
  if (input.targetIdentifiers.length === 0)
    fail('DISCOVERY_TARGET_IDENTIFIERS_REQUIRED');
  if (
    new Set(input.targetIdentifiers.map((value) => value.trim())).size !==
    input.targetIdentifiers.length
  ) {
    fail('DISCOVERY_TARGET_IDENTIFIERS_DUPLICATE');
  }
  if (input.maxCandidates !== undefined) {
    integerInRange(
      input.maxCandidates,
      1,
      100,
      'DISCOVERY_MAX_CANDIDATES_INVALID',
    );
  }
}

function validateDiscoveryOutput(output) {
  exactKeys(
    output,
    [
      'runtime',
      'provider',
      'query',
      'resultStatus',
      'observedAt',
      'candidates',
      'accessRestricted',
      'truncated',
      'partialOnly',
      'excludedNonOemCandidateCount',
      'error',
    ],
    ['runtimeAppId'],
    'discovery output',
  );
  equal(output.runtime, 'FEISHU_HOSTED_OPENCLAW', 'DISCOVERY_RUNTIME_INVALID');
  provider(output.provider);
  nonEmpty(output.query, 'DISCOVERY_QUERY_INVALID');
  if (!DISCOVERY_STATUSES.has(output.resultStatus)) {
    fail('DISCOVERY_STATUS_INVALID');
  }
  if (output.observedAt !== null)
    isoDate(output.observedAt, 'DISCOVERY_OBSERVED_AT_INVALID');
  if (output.runtimeAppId !== undefined)
    nonEmpty(output.runtimeAppId, 'DISCOVERY_APP_ID_INVALID');
  boolean(output.accessRestricted, 'DISCOVERY_ACCESS_FLAG_INVALID');
  boolean(output.truncated, 'DISCOVERY_TRUNCATED_FLAG_INVALID');
  boolean(output.partialOnly, 'DISCOVERY_PARTIAL_FLAG_INVALID');
  integerInRange(
    output.excludedNonOemCandidateCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'DISCOVERY_EXCLUDED_COUNT_INVALID',
  );
  array(output.candidates, 'DISCOVERY_CANDIDATES_INVALID');
  for (const candidate of output.candidates)
    validateDiscoveryCandidate(output.provider, candidate);
  if (output.error !== null) {
    exactKeys(output.error, ['code', 'message'], [], 'discovery error');
    nonEmpty(output.error.code, 'DISCOVERY_ERROR_CODE_INVALID');
    nonEmpty(output.error.message, 'DISCOVERY_ERROR_MESSAGE_INVALID');
  }

  const directCount = output.candidates.filter(
    (candidate) => candidate.matchLevel === 'DIRECT',
  ).length;
  switch (output.resultStatus) {
    case 'COMPLETE':
      if (directCount < 1) fail('DISCOVERY_COMPLETE_REQUIRES_DIRECT_CANDIDATE');
      if (
        output.accessRestricted ||
        output.truncated ||
        output.partialOnly ||
        output.error !== null
      ) {
        fail('DISCOVERY_COMPLETE_FLAG_CONFLICT');
      }
      break;
    case 'ZERO_RESULT':
      if (output.candidates.length !== 0)
        fail('DISCOVERY_ZERO_RESULT_CANDIDATE_CONFLICT');
      break;
    case 'ZERO_RESULTS_FOR_TARGET_IDENTIFIER':
      if (directCount !== 0) fail('DISCOVERY_TARGET_ZERO_DIRECT_CONFLICT');
      break;
    case 'ACCESS_DENIED':
      if (
        !output.accessRestricted ||
        output.error === null ||
        output.candidates.length !== 0
      ) {
        fail('DISCOVERY_ACCESS_DENIED_SHAPE_INVALID');
      }
      break;
    case 'PARTIAL':
      if (!output.partialOnly) fail('DISCOVERY_PARTIAL_FLAG_REQUIRED');
      break;
    case 'TRUNCATED':
      if (!output.truncated) fail('DISCOVERY_TRUNCATED_FLAG_REQUIRED');
      break;
  }
}

function validateDiscoveryCandidate(providerName, candidate) {
  assertObject(candidate, 'discovery candidate');
  exactKeys(
    candidate,
    [
      'title',
      'sourceUrl',
      'documentNumber',
      'revisionLabel',
      'snippet',
      'relationshipReason',
      'matchLevel',
    ],
    [],
    'discovery candidate',
  );
  nonEmpty(candidate.title, 'DISCOVERY_CANDIDATE_TITLE_INVALID');
  nonEmpty(candidate.relationshipReason, 'DISCOVERY_RELATIONSHIP_INVALID');
  nullableText(candidate.documentNumber, 'DISCOVERY_DOCUMENT_NUMBER_INVALID');
  nullableText(candidate.revisionLabel, 'DISCOVERY_REVISION_INVALID');
  nullableText(candidate.snippet, 'DISCOVERY_SNIPPET_INVALID');
  if (!['DIRECT', 'TANGENTIAL'].includes(candidate.matchLevel)) {
    fail('DISCOVERY_MATCH_LEVEL_INVALID');
  }
  const url = httpsUrl(candidate.sourceUrl, 'DISCOVERY_SOURCE_URL_INVALID');
  if (!officialHost(providerName, url.hostname)) {
    fail(`DISCOVERY_NON_OFFICIAL_SOURCE:${url.hostname}`);
  }
}

function validateSynthesisInput(input) {
  exactKeys(
    input,
    [
      'operation',
      'outputCorrelationRef',
      'applicabilityResult',
      'baseRuleResult',
      'unifiedSourceContext',
      'adoptedDocumentVersions',
      'externalDiscoveryResults',
      'engineerReviewContext',
      'selectiveResynthesis',
    ],
    ['commonContext', 'evidenceRegistry'],
    'synthesis input',
  );
  equal(
    input.operation,
    'SYNTHESIZE_OVERALL_CANDIDATE',
    'SYNTHESIS_OPERATION_INVALID',
  );
  nonEmpty(input.outputCorrelationRef, 'SYNTHESIS_CORRELATION_INVALID');
  validateOverallApplicabilityResult(input.applicabilityResult);
  validateBaseRuleResult(input.baseRuleResult);
  validateUnifiedSourceContext(input.unifiedSourceContext);
  validateAdoptedDocumentVersions(input.adoptedDocumentVersions);
  validateEngineerReviewContext(input.engineerReviewContext);
  if (input.evidenceRegistry !== undefined) validateOverallEvidenceRegistry(input.evidenceRegistry);
  assertObject(input.selectiveResynthesis, 'selective resynthesis');
  array(input.externalDiscoveryResults, 'SYNTHESIS_DISCOVERY_RESULTS_INVALID');
  for (const result of input.externalDiscoveryResults)
    validateDiscoveryOutput(result);
  if (
    new Set(input.externalDiscoveryResults.map(({ provider }) => provider))
      .size !== input.externalDiscoveryResults.length
  ) {
    fail('SYNTHESIS_DUPLICATE_DISCOVERY_PROVIDER');
  }

  const base = input.baseRuleResult;
  const context = input.unifiedSourceContext;
  if (base.documentVersionId !== context.documentVersionId)
    fail('SYNTHESIS_DOCUMENT_VERSION_MISMATCH');
  if (base.packageId !== context.packageId)
    fail('SYNTHESIS_PACKAGE_ID_MISMATCH');
  if (base.packageArtifactSha256 !== context.packageArtifactSha256) {
    fail('SYNTHESIS_PACKAGE_ARTIFACT_MISMATCH');
  }
  const applicability = input.applicabilityResult;
  if (
    applicability &&
    (applicability.documentVersionId !== base.documentVersionId ||
      applicability.sourcePackageId !== base.packageId)
  ) {
    fail('SYNTHESIS_APPLICABILITY_SOURCE_BINDING_MISMATCH');
  }
  if (
    !input.adoptedDocumentVersions.some(
      (item) => item.documentVersionId === base.documentVersionId,
    )
  ) {
    fail('SYNTHESIS_PRIMARY_DOCUMENT_VERSION_NOT_ADOPTED');
  }
  const knownRefs = new Set(context.sourceRefs.map((item) => item.sourceRefId));
  for (const item of base.items) {
    for (const sourceRefId of item.sourceRefIds) {
      if (!knownRefs.has(sourceRefId))
        fail(`SYNTHESIS_UNKNOWN_SOURCE_REF:${sourceRefId}`);
    }
  }
}

function validateOverallEvidenceRegistry(values) {
  array(values, 'OVERALL_READING_EVIDENCE_REGISTRY_INVALID');
  const seen = new Set();
  for (const item of values) {
    assertObject(item, 'Overall model evidence');
    exactKeys(item, ['evidenceRef', 'kind', 'title', 'versionLabel', 'excerpt', 'locator'], [], 'Overall model evidence');
    nonEmpty(item.evidenceRef, 'OVERALL_EVIDENCE_REF_INVALID');
    if (seen.has(item.evidenceRef)) fail('OVERALL_DUPLICATE_EVIDENCE_REF');
    seen.add(item.evidenceRef);
    if (!['DOCUMENT_PASSAGE', 'ENGINEER_STATEMENT', 'HOST_FACT', 'QUERY_RECEIPT', 'PRIOR_RESULT'].includes(item.kind)) fail('OVERALL_EVIDENCE_KIND_INVALID');
    nonEmpty(item.title, 'OVERALL_EVIDENCE_TITLE_INVALID');
    nullableText(item.versionLabel, 'OVERALL_EVIDENCE_VERSION_INVALID');
    nonEmpty(item.excerpt, 'OVERALL_EVIDENCE_EXCERPT_INVALID');
    nullableText(item.locator, 'OVERALL_EVIDENCE_LOCATOR_INVALID');
  }
}

function validateEngineerReviewContext(context) {
  assertObject(context, 'engineer review context');
  exactKeys(
    context,
    ['revision', 'artifactSha256', 'reviewCount', 'history', 'effective'],
    [],
    'engineer review context',
  );
  array(context.history, 'ENGINEER_REVIEW_HISTORY_INVALID');
  array(context.effective, 'ENGINEER_REVIEW_EFFECTIVE_INVALID');
  integerInRange(
    context.reviewCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'ENGINEER_REVIEW_COUNT_INVALID',
  );
  equal(
    context.reviewCount,
    context.history.length,
    'ENGINEER_REVIEW_HISTORY_COUNT_MISMATCH',
  );
  if (context.revision === null || context.artifactSha256 === null) {
    if (
      context.revision !== null ||
      context.artifactSha256 !== null ||
      context.reviewCount !== 0 ||
      context.history.length !== 0 ||
      context.effective.length !== 0
    ) {
      fail('ENGINEER_REVIEW_EMPTY_CONTEXT_INVALID');
    }
    return;
  }
  positiveInteger(context.revision, 'ENGINEER_REVIEW_REVISION_INVALID');
  overallSha256(context.artifactSha256, 'ENGINEER_REVIEW_ARTIFACT_SHA_INVALID');
  if (context.reviewCount === 0) fail('ENGINEER_REVIEW_CONTEXT_EMPTY');

  const latestByCriterion = new Map();
  context.history.forEach((review, index) => {
    validateEngineerReviewEntry(review, index + 1);
    latestByCriterion.set(review.criterionId, review);
  });
  const effectiveByCriterion = new Map();
  context.effective.forEach((review) => {
    validateEngineerReviewEntry(review);
    if (effectiveByCriterion.has(review.criterionId)) {
      fail(`ENGINEER_REVIEW_EFFECTIVE_DUPLICATE:${review.criterionId}`);
    }
    effectiveByCriterion.set(review.criterionId, review);
  });
  equal(
    effectiveByCriterion.size,
    latestByCriterion.size,
    'ENGINEER_REVIEW_EFFECTIVE_COUNT_MISMATCH',
  );
  for (const [criterionId, review] of latestByCriterion) {
    if (
      JSON.stringify(effectiveByCriterion.get(criterionId)) !==
      JSON.stringify(review)
    ) {
      fail(`ENGINEER_REVIEW_EFFECTIVE_DRIFT:${criterionId}`);
    }
  }
}

function validateOverallApplicabilityResult(result) {
  if (result === null) return;
  assertObject(result, 'overall applicability result');
  exactKeys(
    result,
    [
      'schemaVersion',
      'status',
      'sourceResultId',
      'inputRevision',
      'documentVersionId',
      'sourcePackageId',
      'sourcePackageContentHash',
      'sourceExpressionCount',
      'sourceRefCount',
      'decision',
      'kleeneResult',
      'pass',
      'blockingUnknownCount',
    ],
    [],
    'overall applicability result',
  );
  equal(
    result.schemaVersion,
    'wiselink.3_1.overall_applicability_result.v1',
    'OVERALL_APPLICABILITY_RESULT_SCHEMA_INVALID',
  );
  if (!['CANDIDATE_ONLY', 'WAITING_INPUT'].includes(result.status)) {
    fail('OVERALL_APPLICABILITY_RESULT_STATUS_INVALID');
  }
  nonEmpty(
    result.sourceResultId,
    'OVERALL_APPLICABILITY_SOURCE_RESULT_INVALID',
  );
  positiveInteger(
    result.inputRevision,
    'OVERALL_APPLICABILITY_INPUT_REVISION_INVALID',
  );
  nonEmpty(
    result.documentVersionId,
    'OVERALL_APPLICABILITY_DOCUMENT_VERSION_INVALID',
  );
  match(
    result.sourcePackageId,
    PACKAGE_ID,
    'OVERALL_APPLICABILITY_PACKAGE_ID_INVALID',
  );
  nonEmpty(
    result.sourcePackageContentHash,
    'OVERALL_APPLICABILITY_PACKAGE_CONTENT_HASH_INVALID',
  );
  integerInRange(
    result.sourceExpressionCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'OVERALL_APPLICABILITY_EXPRESSION_COUNT_INVALID',
  );
  integerInRange(
    result.sourceRefCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'OVERALL_APPLICABILITY_SOURCE_REF_COUNT_INVALID',
  );
  integerInRange(
    result.blockingUnknownCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'OVERALL_APPLICABILITY_UNKNOWN_COUNT_INVALID',
  );
  boolean(result.pass, 'OVERALL_APPLICABILITY_PASS_INVALID');
  if (!['APPLICABLE', 'NOT_APPLICABLE', 'UNKNOWN'].includes(result.decision)) {
    fail('OVERALL_APPLICABILITY_DECISION_INVALID');
  }
  if (![true, false, 'unknown'].includes(result.kleeneResult)) {
    fail('OVERALL_APPLICABILITY_KLEENE_INVALID');
  }
  const consistent =
    (result.decision === 'APPLICABLE' &&
      result.status === 'CANDIDATE_ONLY' &&
      result.kleeneResult === true &&
      result.pass === true &&
      result.blockingUnknownCount === 0) ||
    (result.decision === 'NOT_APPLICABLE' &&
      result.status === 'CANDIDATE_ONLY' &&
      result.kleeneResult === false &&
      result.pass === false &&
      result.blockingUnknownCount === 0) ||
    (result.decision === 'UNKNOWN' &&
      result.status === 'WAITING_INPUT' &&
      result.kleeneResult === 'unknown' &&
      result.pass === false &&
      result.blockingUnknownCount > 0);
  if (!consistent) fail('OVERALL_APPLICABILITY_RESULT_INVALID');
}

function expectedOverallApplicabilityStatus(result) {
  return !result || result.decision === 'UNKNOWN'
    ? 'UNKNOWN/WAITING_INPUT'
    : result.decision;
}

function validateEngineerReviewEntry(review, expectedSequence = undefined) {
  assertObject(review, 'engineer review entry');
  const extended = Object.hasOwn(review, 'actionType');
  exactKeys(
    review,
    ['sequence', 'criterionId', 'decision', 'status', 'comment', 'recordedAt', ...(extended ? ['baseRuleRevision', 'baseRuleArtifactSha256', 'actionType', 'evidence', 'resolvedMissingInputs', 'uncertaintyDispositions', 'decisionSnapshot', 'correctedAnalysisDirection'] : [])],
    extended ? ['affectedCriterionIds'] : [],
    'engineer review entry',
  );
  positiveInteger(review.sequence, 'ENGINEER_REVIEW_SEQUENCE_INVALID');
  if (expectedSequence !== undefined) {
    equal(
      review.sequence,
      expectedSequence,
      'ENGINEER_REVIEW_SEQUENCE_ORDER_INVALID',
    );
  }
  nonEmpty(review.criterionId, 'ENGINEER_REVIEW_CRITERION_INVALID');
  if (
    ![
      'confirmed_pass',
      'confirmed_fail',
      'returned_for_rework',
      'deferred',
    ].includes(review.decision)
  ) {
    fail('ENGINEER_REVIEW_DECISION_INVALID');
  }
  const expectedStatus = (!extended || review.actionType === 'REVISE_JUDGMENT') && ['confirmed_pass', 'confirmed_fail'].includes(review.decision)
    ? 'ENGINEER_CONFIRMED'
    : 'NEEDS_REVIEW';
  equal(review.status, expectedStatus, 'ENGINEER_REVIEW_STATUS_INVALID');
  nonEmpty(review.comment, 'ENGINEER_REVIEW_COMMENT_INVALID');
  isoDate(review.recordedAt, 'ENGINEER_REVIEW_RECORDED_AT_INVALID');
  if (!extended) return;
  positiveInteger(review.baseRuleRevision, 'ENGINEER_REVIEW_BASE_REVISION_INVALID');
  overallSha256(review.baseRuleArtifactSha256, 'ENGINEER_REVIEW_BASE_ARTIFACT_INVALID');
  if (!['REVISE_JUDGMENT', 'SUPPLEMENT_EVIDENCE', 'CORRECT_ANALYSIS_DIRECTION'].includes(review.actionType)) fail('ENGINEER_REVIEW_ACTION_TYPE_INVALID');
  if (review.affectedCriterionIds !== undefined) {
    uniqueTextArray(review.affectedCriterionIds, 'ENGINEER_REVIEW_AFFECTED_CRITERIA_INVALID');
    if (!review.affectedCriterionIds.includes(review.criterionId)) fail('ENGINEER_REVIEW_AFFECTED_CRITERIA_INVALID');
  }
  array(review.evidence, 'ENGINEER_REVIEW_EVIDENCE_INVALID');
  review.evidence.forEach(validateOverallEngineerEvidence);
  if (new Set(review.evidence.map((item) => item.sourceRefId)).size !== review.evidence.length) fail('ENGINEER_REVIEW_EVIDENCE_DUPLICATE');
  arrayOfText(review.resolvedMissingInputs, 'ENGINEER_REVIEW_RESOLVED_INPUTS_INVALID');
  validateReviewUncertaintyDispositions(review.uncertaintyDispositions);
  nullableText(review.correctedAnalysisDirection, 'ENGINEER_REVIEW_DIRECTION_INVALID');
  if (review.decisionSnapshot !== null) {
    assertObject(review.decisionSnapshot, 'Overall engineer decision snapshot');
    const { decisionSnapshotRef, revision, engineerConfirmationRef, ...proposal } = review.decisionSnapshot;
    nonEmpty(decisionSnapshotRef, 'ENGINEER_REVIEW_SNAPSHOT_REF_INVALID');
    positiveInteger(revision, 'ENGINEER_REVIEW_SNAPSHOT_REVISION_INVALID');
    nullableText(engineerConfirmationRef, 'ENGINEER_REVIEW_SNAPSHOT_CONFIRMATION_INVALID');
    validateReviewDecisionSnapshot(proposal);
  }
  if (
    (review.actionType === 'SUPPLEMENT_EVIDENCE' && (review.evidence.length === 0 || review.correctedAnalysisDirection !== null)) ||
    (review.actionType === 'REVISE_JUDGMENT' && (review.evidence.length !== 0 || review.resolvedMissingInputs.length !== 0 || review.correctedAnalysisDirection !== null)) ||
    (review.actionType === 'CORRECT_ANALYSIS_DIRECTION' && (review.evidence.length !== 0 || review.resolvedMissingInputs.length !== 0 || !review.correctedAnalysisDirection))
  ) fail('ENGINEER_REVIEW_ACTION_DETAILS_INVALID');
}

function validateOverallEngineerEvidence(item) {
  assertObject(item, 'Overall engineer evidence');
  exactKeys(item, ['kind', 'statement', 'locator', 'sourceRefId'], ['artifact'], 'Overall engineer evidence');
  if (!['ENGINEER_TEXT', 'AIRCRAFT_FACT', 'DOCUMENT_FACT', 'ATTACHMENT'].includes(item.kind)) fail('ENGINEER_REVIEW_EVIDENCE_KIND_INVALID');
  nonEmpty(item.statement, 'ENGINEER_REVIEW_EVIDENCE_STATEMENT_INVALID');
  nonEmpty(item.locator, 'ENGINEER_REVIEW_EVIDENCE_LOCATOR_INVALID');
  overallReviewEvidenceRef(item.sourceRefId, 'ENGINEER_REVIEW_EVIDENCE_SOURCE_REF_INVALID');
  if (item.artifact !== undefined) {
    assertObject(item.artifact, 'Overall engineer evidence artifact');
    exactKeys(item.artifact, ['storeRole', 'ref', 'sha256', 'byteLength', 'mediaType'], [], 'Overall engineer evidence artifact');
    equal(item.artifact.storeRole, 'UnifiedArtifactStoreCandidate', 'ENGINEER_REVIEW_EVIDENCE_STORE_INVALID');
    equal(item.artifact.mediaType, 'application/json', 'ENGINEER_REVIEW_EVIDENCE_MEDIA_INVALID');
    nonEmpty(item.artifact.ref, 'ENGINEER_REVIEW_EVIDENCE_ARTIFACT_REF_INVALID');
    overallSha256(item.artifact.sha256, 'ENGINEER_REVIEW_EVIDENCE_ARTIFACT_SHA_INVALID');
    positiveInteger(item.artifact.byteLength, 'ENGINEER_REVIEW_EVIDENCE_ARTIFACT_LENGTH_INVALID');
  }
}

function overallSha256(value, code) {
  if (typeof value !== 'string' || (!SHA256.test(value) && !BARE_SHA256.test(value))) fail(code);
}

function overallSourceRef(value, code) {
  if (typeof value !== 'string' || (!SOURCE_REF_ID.test(value) && !OVERALL_REVIEW_SOURCE_REF_ID.test(value) && !OVERALL_MODEL_REVIEW_REF_ID.test(value))) fail(code);
}

function overallReviewEvidenceRef(value, code) {
  if (typeof value !== 'string' || (!OVERALL_REVIEW_SOURCE_REF_ID.test(value) && !OVERALL_MODEL_REVIEW_REF_ID.test(value))) fail(code);
}

// `baseRuleResult` is the Host's compatibility field name for the current
// OpenClaw dynamic N/N projection. It is not evidence of Base model execution.
function validateBaseRuleResult(base) {
  assertObject(base, 'dynamic result compatibility projection');
  exactKeys(
    base,
    [
      'sourceResultId',
      'revision',
      'artifactSha256',
      'documentVersionId',
      'packageId',
      'packageArtifactSha256',
      'criterionSetId',
      'criterionCount',
      'evaluationItemCount',
      'unresolvedCount',
      'sourceBoundCandidateCount',
      'items',
    ],
    [],
    'dynamic result compatibility projection',
  );
  nonEmpty(base.sourceResultId, 'BASE_SOURCE_RESULT_ID_INVALID');
  positiveInteger(base.revision, 'BASE_REVISION_INVALID');
  sha256(base.artifactSha256, 'BASE_ARTIFACT_SHA_INVALID');
  nonEmpty(base.documentVersionId, 'BASE_DOCUMENT_VERSION_INVALID');
  match(base.packageId, PACKAGE_ID, 'BASE_PACKAGE_ID_INVALID');
  sha256(base.packageArtifactSha256, 'BASE_PACKAGE_ARTIFACT_SHA_INVALID');
  nonEmpty(base.criterionSetId, 'BASE_CRITERION_SET_INVALID');
  positiveInteger(base.criterionCount, 'BASE_CRITERION_COUNT_INVALID');
  positiveInteger(base.evaluationItemCount, 'BASE_EVALUATION_COUNT_INVALID');
  array(base.items, 'BASE_ITEMS_INVALID');
  if (
    base.items.length !== base.criterionCount ||
    base.items.length !== base.evaluationItemCount
  ) {
    fail('BASE_DYNAMIC_N_INCOMPLETE');
  }
  integerInRange(
    base.unresolvedCount,
    0,
    base.items.length,
    'BASE_UNRESOLVED_COUNT_INVALID',
  );
  integerInRange(
    base.sourceBoundCandidateCount,
    0,
    base.items.length,
    'BASE_SOURCE_BOUND_COUNT_INVALID',
  );
  const criterionIds = new Set();
  let derivedUnresolved = 0;
  let derivedSourceBound = 0;
  for (const item of base.items) {
    assertObject(item, 'dynamic evaluation compatibility item');
    exactKeys(
      item,
      [
        'criterionId',
        'status',
        'sourceRefIds',
        'fact',
        'analysis',
        'candidateConclusion',
        'missingInputs',
        'humanReviewRequired',
        'authorityLevel',
      ],
      [],
      'base evaluation item',
    );
    nonEmpty(item.criterionId, 'BASE_CRITERION_ID_INVALID');
    if (criterionIds.has(item.criterionId))
      fail(`BASE_DUPLICATE_CRITERION:${item.criterionId}`);
    criterionIds.add(item.criterionId);
    nonEmpty(item.status, 'BASE_ITEM_STATUS_INVALID');
    arrayOfText(item.sourceRefIds, 'BASE_ITEM_SOURCE_REFS_INVALID');
    for (const sourceRefId of item.sourceRefIds)
      overallSourceRef(sourceRefId, 'BASE_SOURCE_REF_INVALID');
    nullableText(item.fact, 'BASE_ITEM_FACT_INVALID');
    nonEmpty(item.analysis, 'BASE_ITEM_ANALYSIS_INVALID');
    nonEmpty(item.candidateConclusion, 'BASE_ITEM_CONCLUSION_INVALID');
    arrayOfText(item.missingInputs, 'BASE_ITEM_MISSING_INPUTS_INVALID');
    boolean(item.humanReviewRequired, 'BASE_ITEM_HUMAN_REVIEW_INVALID');
    equal(item.authorityLevel, 'candidate_only', 'BASE_ITEM_AUTHORITY_INVALID');
    if (item.missingInputs.length > 0) derivedUnresolved += 1;
    if (item.sourceRefIds.length > 0) derivedSourceBound += 1;
  }
  if (derivedUnresolved !== base.unresolvedCount)
    fail('BASE_UNRESOLVED_COUNT_MISMATCH');
  if (derivedSourceBound !== base.sourceBoundCandidateCount)
    fail('BASE_SOURCE_BOUND_COUNT_MISMATCH');
}

function validateUnifiedSourceContext(context) {
  assertObject(context, 'Unified source context');
  exactKeys(
    context,
    [
      'documentVersionId',
      'packageId',
      'packageArtifactSha256',
      'contractRevision',
      'contentUnitCount',
      'sourceRefCount',
      'currentDocumentSourceRefIds',
      'sourceRefs',
    ],
    [],
    'Unified source context',
  );
  nonEmpty(
    context.documentVersionId,
    'SOURCE_CONTEXT_DOCUMENT_VERSION_INVALID',
  );
  match(context.packageId, PACKAGE_ID, 'SOURCE_CONTEXT_PACKAGE_ID_INVALID');
  sha256(context.packageArtifactSha256, 'SOURCE_CONTEXT_ARTIFACT_SHA_INVALID');
  equal(
    context.contractRevision,
    'frozen.2',
    'SOURCE_CONTEXT_REVISION_INVALID',
  );
  integerInRange(
    context.contentUnitCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'SOURCE_CONTEXT_UNIT_COUNT_INVALID',
  );
  positiveInteger(context.sourceRefCount, 'SOURCE_CONTEXT_REF_COUNT_INVALID');
  array(context.sourceRefs, 'SOURCE_CONTEXT_REFS_INVALID');
  if (context.sourceRefs.length !== context.sourceRefCount)
    fail('SOURCE_CONTEXT_REF_COUNT_MISMATCH');
  arrayOfText(
    context.currentDocumentSourceRefIds,
    'CURRENT_DOCUMENT_SOURCE_REFS_INVALID',
  );
  if (context.currentDocumentSourceRefIds.length === 0) {
    fail('CURRENT_DOCUMENT_SOURCE_REF_REQUIRED');
  }
  const seen = new Set();
  for (const sourceRef of context.sourceRefs) {
    assertObject(sourceRef, 'source ref');
    exactKeys(
      sourceRef,
      ['sourceRefId', 'locator', 'excerpt'],
      ['evidenceKind', 'artifactRef', 'artifactSha256'],
      'source ref',
    );
    overallSourceRef(sourceRef.sourceRefId, 'SOURCE_CONTEXT_REF_ID_INVALID');
    if (seen.has(sourceRef.sourceRefId))
      fail(`SOURCE_CONTEXT_DUPLICATE_REF:${sourceRef.sourceRefId}`);
    seen.add(sourceRef.sourceRefId);
    nonEmpty(sourceRef.locator, 'SOURCE_CONTEXT_LOCATOR_INVALID');
    nullableText(sourceRef.excerpt, 'SOURCE_CONTEXT_EXCERPT_INVALID');
    if (sourceRef.evidenceKind !== undefined) {
      if (!['ENGINEER_TEXT', 'AIRCRAFT_FACT', 'DOCUMENT_FACT', 'ATTACHMENT'].includes(sourceRef.evidenceKind)) fail('SOURCE_CONTEXT_EVIDENCE_KIND_INVALID');
      overallReviewEvidenceRef(sourceRef.sourceRefId, 'SOURCE_CONTEXT_REVIEW_EVIDENCE_REF_INVALID');
    }
    if ((sourceRef.artifactRef === undefined) !== (sourceRef.artifactSha256 === undefined)) fail('SOURCE_CONTEXT_ARTIFACT_BINDING_INVALID');
    if (sourceRef.artifactRef !== undefined) {
      nonEmpty(sourceRef.artifactRef, 'SOURCE_CONTEXT_ARTIFACT_REF_INVALID');
      overallSha256(sourceRef.artifactSha256, 'SOURCE_CONTEXT_ARTIFACT_SHA_INVALID');
    }
  }
  const knownRefs = new Set(context.sourceRefs.map((item) => item.sourceRefId));
  for (const sourceRefId of context.currentDocumentSourceRefIds) {
    match(sourceRefId, SOURCE_REF_ID, 'CURRENT_DOCUMENT_SOURCE_REF_INVALID');
    if (!knownRefs.has(sourceRefId)) {
      fail(`CURRENT_DOCUMENT_SOURCE_REF_UNKNOWN:${sourceRefId}`);
    }
  }
  if (
    new Set(context.currentDocumentSourceRefIds).size !==
    context.currentDocumentSourceRefIds.length
  ) {
    fail('CURRENT_DOCUMENT_SOURCE_REF_DUPLICATE');
  }
}

function validateAdoptedDocumentVersions(values) {
  array(values, 'ADOPTED_DOCUMENT_VERSIONS_INVALID');
  if (values.length < 1) fail('ADOPTED_DOCUMENT_VERSION_REQUIRED');
  const seen = new Set();
  for (const item of values) {
    assertObject(item, 'adopted DocumentVersion');
    exactKeys(
      item,
      [
        'documentVersionId',
        'publisher',
        'documentNumber',
        'revisionLabel',
        'adoptionStatus',
        'currentness',
      ],
      [],
      'adopted DocumentVersion',
    );
    nonEmpty(item.documentVersionId, 'ADOPTED_DOCUMENT_VERSION_ID_INVALID');
    if (seen.has(item.documentVersionId))
      fail(`ADOPTED_DOCUMENT_VERSION_DUPLICATE:${item.documentVersionId}`);
    seen.add(item.documentVersionId);
    nonEmpty(item.publisher, 'ADOPTED_PUBLISHER_INVALID');
    nonEmpty(item.documentNumber, 'ADOPTED_DOCUMENT_NUMBER_INVALID');
    nonEmpty(item.revisionLabel, 'ADOPTED_REVISION_INVALID');
    equal(item.adoptionStatus, 'ADOPTED', 'DOCUMENT_VERSION_NOT_ADOPTED');
    if (!['CURRENT', 'HISTORICAL'].includes(item.currentness))
      fail('ADOPTED_CURRENTNESS_INVALID');
  }
}

function validateSynthesisOutput(output) {
  exactKeys(
    output,
    [
      'sourceResultId',
      'documentVersionId',
      'packageId',
      'baseRuleRevision',
      'baseRuleArtifactSha256',
      'engineerReviewRevision',
      'engineerReviewArtifactSha256',
      'discoveryStatus',
      'gap',
      'candidateRefCount',
      'findingCount',
      'unresolvedCount',
      'authorityLevel',
      'externalDiscoveryIsEvidence',
      'overallCandidate',
      'engineeringSummary',
      'findings',
      'missingInputs',
      'applicabilityStatus',
      'engineeringReviewRequired',
      'adopted',
      'usableAsEvidence',
      'providers',
    ],
    [],
    'synthesis output',
  );
  nonEmpty(output.sourceResultId, 'OVERALL_SOURCE_RESULT_ID_INVALID');
  nonEmpty(output.documentVersionId, 'OVERALL_DOCUMENT_VERSION_INVALID');
  match(output.packageId, PACKAGE_ID, 'OVERALL_PACKAGE_ID_INVALID');
  positiveInteger(output.baseRuleRevision, 'OVERALL_BASE_REVISION_INVALID');
  sha256(output.baseRuleArtifactSha256, 'OVERALL_BASE_ARTIFACT_SHA_INVALID');
  if (output.engineerReviewRevision !== null) {
    positiveInteger(
      output.engineerReviewRevision,
      'OVERALL_ENGINEER_REVIEW_REVISION_INVALID',
    );
  }
  if (output.engineerReviewArtifactSha256 !== null) {
    overallSha256(
      output.engineerReviewArtifactSha256,
      'OVERALL_ENGINEER_REVIEW_ARTIFACT_SHA_INVALID',
    );
  }
  if (
    (output.engineerReviewRevision === null) !==
    (output.engineerReviewArtifactSha256 === null)
  ) {
    fail('OVERALL_ENGINEER_REVIEW_BINDING_INCOMPLETE');
  }
  nonEmpty(output.discoveryStatus, 'OVERALL_DISCOVERY_STATUS_INVALID');
  nullableText(output.gap, 'OVERALL_GAP_INVALID');
  integerInRange(
    output.candidateRefCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'OVERALL_CANDIDATE_COUNT_INVALID',
  );
  integerInRange(
    output.findingCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'OVERALL_FINDING_COUNT_INVALID',
  );
  integerInRange(
    output.unresolvedCount,
    0,
    Number.MAX_SAFE_INTEGER,
    'OVERALL_UNRESOLVED_COUNT_INVALID',
  );
  equal(output.authorityLevel, 'candidate_only', 'OVERALL_AUTHORITY_INVALID');
  equal(
    output.externalDiscoveryIsEvidence,
    false,
    'OVERALL_DISCOVERY_EVIDENCE_INVALID',
  );
  equal(output.adopted, false, 'OVERALL_ADOPTION_INVALID');
  equal(
    output.usableAsEvidence,
    false,
    'OVERALL_DISCOVERY_USE_AS_EVIDENCE_INVALID',
  );
  validateDiscoveryProviderSummaries(output.providers);
  nonEmpty(output.overallCandidate, 'OVERALL_CANDIDATE_INVALID');
  validateEngineeringSummary(output.engineeringSummary);
  const readingV2 = output.engineeringSummary.schemaVersion === 'wiselink.3_1.overall_engineering_summary.v2';
  equal(
    output.overallCandidate,
    readingV2 ? output.engineeringSummary.lead : output.engineeringSummary.conclusion.text,
    readingV2 ? 'OVERALL_LEAD_CANDIDATE_MISMATCH' : 'OVERALL_CONCLUSION_CANDIDATE_MISMATCH',
  );
  array(output.findings, 'OVERALL_FINDINGS_INVALID');
  if (output.findings.length !== output.findingCount)
    fail('OVERALL_FINDING_COUNT_MISMATCH');
  for (const finding of output.findings) {
    assertObject(finding, 'overall finding');
    exactKeys(
      finding,
      ['finding', 'basis', 'sourceRefIds', 'assumptions', 'uncertainty'],
      [],
      'overall finding',
    );
    nonEmpty(finding.finding, 'OVERALL_FINDING_INVALID');
    nonEmpty(finding.basis, 'OVERALL_FINDING_BASIS_INVALID');
    arrayOfText(finding.sourceRefIds, 'OVERALL_FINDING_SOURCE_REFS_INVALID');
    for (const sourceRefId of finding.sourceRefIds)
      overallSourceRef(sourceRefId, 'OVERALL_SOURCE_REF_INVALID');
    arrayOfText(finding.assumptions, 'OVERALL_ASSUMPTIONS_INVALID');
    nonEmpty(finding.uncertainty, 'OVERALL_UNCERTAINTY_INVALID');
  }
  arrayOfText(output.missingInputs, 'OVERALL_MISSING_INPUTS_INVALID');
  if (
    !['APPLICABLE', 'NOT_APPLICABLE', 'UNKNOWN/WAITING_INPUT'].includes(
      output.applicabilityStatus,
    )
  ) {
    fail('OVERALL_APPLICABILITY_STATUS_INVALID');
  }
  equal(
    output.engineeringReviewRequired,
    true,
    'OVERALL_ENGINEER_REVIEW_REQUIRED',
  );
  rejectAuthoritativeNarrative(output);
}

function validateEngineeringSummary(summary) {
  assertObject(summary, 'engineering summary');
  if (summary.schemaVersion === 'wiselink.3_1.overall_engineering_summary.v2') {
    validateEngineeringReadingSummary(summary);
    return;
  }
  exactKeys(
    summary,
    [
      'schemaVersion',
      'conclusion',
      'whyItMatters',
      'applicability',
      'implementationImpact',
      'dispositionPriority',
      'nextActions',
    ],
    [],
    'engineering summary',
  );
  equal(
    summary.schemaVersion,
    'wiselink.3_1.overall_engineering_summary.v1',
    'OVERALL_ENGINEERING_SUMMARY_VERSION_INVALID',
  );
  validateEngineeringStatement(summary.conclusion, 'OVERALL_CONCLUSION');
  validateEngineeringStatementArray(
    summary.whyItMatters,
    'OVERALL_WHY_IT_MATTERS',
    1,
  );
  assertObject(summary.applicability, 'engineering applicability summary');
  exactKeys(
    summary.applicability,
    ['sourceScope', 'fleetMatch', 'requiredFacts'],
    [],
    'engineering applicability summary',
  );
  validateEngineeringStatement(
    summary.applicability.sourceScope,
    'OVERALL_SOURCE_SCOPE',
  );
  validateEngineeringStatement(
    summary.applicability.fleetMatch,
    'OVERALL_FLEET_MATCH',
  );
  validateEngineeringStatementArray(
    summary.applicability.requiredFacts,
    'OVERALL_REQUIRED_FACTS',
    0,
  );
  validateEngineeringStatementArray(
    summary.implementationImpact,
    'OVERALL_IMPLEMENTATION_IMPACT',
    1,
  );
  validateEngineeringStatementArray(
    summary.dispositionPriority,
    'OVERALL_DISPOSITION_PRIORITY',
    1,
  );
  validateEngineeringStatementArray(
    summary.nextActions,
    'OVERALL_NEXT_ACTIONS',
    1,
    3,
  );
}

function validateEngineeringReadingSummary(summary) {
  exactKeys(summary, ['schemaVersion', 'headline', 'listBrief', 'lead', 'claims', 'decisiveClaimIds'], [], 'engineering reading summary');
  nonEmpty(summary.headline, 'OVERALL_HEADLINE_INVALID');
  nonEmpty(summary.listBrief, 'OVERALL_LIST_BRIEF_INVALID');
  nonEmpty(summary.lead, 'OVERALL_LEAD_INVALID');
  array(summary.claims, 'OVERALL_CLAIMS_INVALID');
  if (summary.claims.length === 0) fail('OVERALL_CLAIMS_REQUIRED');
  const claimIds = new Set();
  for (const claim of summary.claims) {
    assertObject(claim, 'Overall reading claim');
    exactKeys(claim, ['claimId', 'text', 'basis', 'premises'], [], 'Overall reading claim');
    nonEmpty(claim.claimId, 'OVERALL_CLAIM_ID_INVALID');
    if (claimIds.has(claim.claimId)) fail('OVERALL_DUPLICATE_CLAIM_ID');
    claimIds.add(claim.claimId);
    nonEmpty(claim.text, 'OVERALL_CLAIM_TEXT_INVALID');
    if (!['SOURCE_FACT', 'CONDITIONAL_INFERENCE'].includes(claim.basis)) fail('OVERALL_CLAIM_BASIS_INVALID');
    array(claim.premises, 'OVERALL_CLAIM_PREMISES_INVALID');
    if (claim.premises.length === 0) fail('OVERALL_CLAIM_PREMISES_REQUIRED');
    const evidenceRefs = new Set();
    for (const premise of claim.premises) {
      assertObject(premise, 'Overall claim premise');
      exactKeys(premise, ['evidenceRef', 'role', 'explanation', 'limitation'], [], 'Overall claim premise');
      nonEmpty(premise.evidenceRef, 'OVERALL_EVIDENCE_REF_INVALID');
      if (evidenceRefs.has(premise.evidenceRef)) fail('OVERALL_DUPLICATE_CLAIM_EVIDENCE_REF');
      evidenceRefs.add(premise.evidenceRef);
      if (!['SUPPORTS', 'LIMITS', 'CONTEXT', 'CONFLICTS'].includes(premise.role)) fail('OVERALL_CLAIM_PREMISE_ROLE_INVALID');
      nonEmpty(premise.explanation, 'OVERALL_CLAIM_PREMISE_EXPLANATION_INVALID');
      nullableText(premise.limitation, 'OVERALL_CLAIM_PREMISE_LIMITATION_INVALID');
    }
  }
  arrayOfText(summary.decisiveClaimIds, 'OVERALL_DECISIVE_CLAIM_IDS_INVALID');
  if (new Set(summary.decisiveClaimIds).size !== summary.decisiveClaimIds.length) fail('OVERALL_DUPLICATE_DECISIVE_CLAIM_ID');
  for (const claimId of summary.decisiveClaimIds) {
    if (!claimIds.has(claimId)) fail(`OVERALL_UNKNOWN_DECISIVE_CLAIM_ID:${claimId}`);
  }
}

function validateEngineeringStatementArray(
  statements,
  code,
  minimum,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  array(statements, `${code}_INVALID`);
  if (statements.length < minimum || statements.length > maximum) {
    fail(`${code}_COUNT_INVALID`);
  }
  statements.forEach((statement, index) =>
    validateEngineeringStatement(statement, `${code}_${index}`),
  );
}

function validateEngineeringStatement(statement, code) {
  assertObject(statement, 'engineering statement');
  exactKeys(
    statement,
    ['text', 'basis', 'sourceRefIds'],
    [],
    'engineering statement',
  );
  nonEmpty(statement.text, `${code}_TEXT_INVALID`);
  if (!['SOURCE_FACT', 'CONDITIONAL_INFERENCE'].includes(statement.basis)) {
    fail(`${code}_BASIS_INVALID`);
  }
  arrayOfText(statement.sourceRefIds, `${code}_SOURCE_REFS_INVALID`);
  if (statement.sourceRefIds.length === 0) {
    fail(`${code}_SOURCE_REF_REQUIRED`);
  }
  if (new Set(statement.sourceRefIds).size !== statement.sourceRefIds.length) {
    fail(`${code}_SOURCE_REF_DUPLICATE`);
  }
  statement.sourceRefIds.forEach((sourceRefId) =>
    overallSourceRef(sourceRefId, `${code}_SOURCE_REF_INVALID`),
  );
}

function validateEngineeringSummaryBindings(
  summary,
  knownRefs,
  currentDocumentRefs,
) {
  const statements = engineeringSummaryStatements(summary);
  statements.forEach((statement, index) => {
    statement.sourceRefIds.forEach((sourceRefId) => {
      if (!knownRefs.has(sourceRefId)) {
        fail(`OVERALL_UNKNOWN_SOURCE_REF:${sourceRefId}`);
      }
    });
    if (
      !statement.sourceRefIds.some((sourceRefId) =>
        currentDocumentRefs.has(sourceRefId),
      )
    ) {
      fail(`OVERALL_STATEMENT_CURRENT_DOCUMENT_SOURCE_REF_REQUIRED:${index}`);
    }
  });
}

function engineeringSummaryStatements(summary) {
  if (summary.schemaVersion === 'wiselink.3_1.overall_engineering_summary.v2') {
    return [
      ...[summary.headline, summary.listBrief, summary.lead].map((text) => ({ text })),
      ...summary.claims,
      ...summary.claims.flatMap((claim) => claim.premises.flatMap((premise) => [premise.explanation, ...(premise.limitation === null ? [] : [premise.limitation])].map((text) => ({ text })))),
    ];
  }
  return [
    summary.conclusion,
    ...summary.whyItMatters,
    summary.applicability.sourceScope,
    summary.applicability.fleetMatch,
    ...summary.applicability.requiredFacts,
    ...summary.implementationImpact,
    ...summary.dispositionPriority,
    ...summary.nextActions,
  ];
}

function canonicalDiscoveryStatus(results) {
  if (results.length === 0) return 'NO_DISCOVERY';
  return [...results]
    .sort((left, right) => left.provider.localeCompare(right.provider))
    .map(
      (result) =>
        `${result.provider}:${result.resultStatus === 'PARTIAL' ? 'PARTIAL_RESULTS' : result.resultStatus}`,
    )
    .join(';');
}

function discoveryProviderSummary(result) {
  return {
    status:
      result.resultStatus === 'PARTIAL'
        ? 'PARTIAL_RESULTS'
        : result.resultStatus,
    match: result.candidates.some(({ matchLevel }) => matchLevel === 'DIRECT')
      ? 'DIRECT_OFFICIAL_SOURCE_MATCH'
      : 'NO_DIRECT_OFFICIAL_SOURCE_MATCH',
    accessRestricted: result.accessRestricted,
    candidateCount: result.candidates.length,
    failureCode: result.error?.code ?? null,
    source: 'OFFICIAL_OEM_PUBLIC_SOURCE',
    baiduAcceptedAsOfficial: false,
  };
}

function validateDiscoveryProviderSummaries(value) {
  assertObject(value, 'overall provider summaries');
  for (const [key, summary] of Object.entries(value)) {
    if (!['boeing', 'airbus', 'comac'].includes(key)) {
      fail(`OVERALL_PROVIDER_UNKNOWN:${key}`);
    }
    assertObject(summary, `overall ${key} provider summary`);
    exactKeys(
      summary,
      [
        'status',
        'match',
        'accessRestricted',
        'candidateCount',
        'failureCode',
        'source',
        'baiduAcceptedAsOfficial',
      ],
      [],
      `overall ${key} provider summary`,
    );
    nonEmpty(summary.status, 'OVERALL_PROVIDER_STATUS_INVALID');
    if (
      ![
        'DIRECT_OFFICIAL_SOURCE_MATCH',
        'NO_DIRECT_OFFICIAL_SOURCE_MATCH',
      ].includes(summary.match)
    ) {
      fail('OVERALL_PROVIDER_MATCH_INVALID');
    }
    boolean(summary.accessRestricted, 'OVERALL_PROVIDER_ACCESS_INVALID');
    integerInRange(
      summary.candidateCount,
      0,
      Number.MAX_SAFE_INTEGER,
      'OVERALL_PROVIDER_CANDIDATE_COUNT_INVALID',
    );
    nullableText(summary.failureCode, 'OVERALL_PROVIDER_FAILURE_CODE_INVALID');
    equal(
      summary.source,
      'OFFICIAL_OEM_PUBLIC_SOURCE',
      'OVERALL_PROVIDER_SOURCE_INVALID',
    );
    equal(
      summary.baiduAcceptedAsOfficial,
      false,
      'OVERALL_PROVIDER_BAIDU_INVALID',
    );
  }
}

export function validateApplicabilityModelInput(input) {
  const englishInput = input?.schemaVersion === 'wiselink.3_1.applicability_task.v2';
  exactKeys(
    input,
    [
      'schemaVersion',
      'operation',
      'applicabilityContextRef',
      'inputRevision',
      'documentVersionRef',
      'sourcePackage',
      'bilingualBinding',
      'aircraft',
      'fleetBinding',
      'controlledAircraft',
      'controlledFacts',
      'astVocabulary',
      'sourceExpressions',
      'bilingualSourceUnits',
      ...(englishInput ? ['sourceReadingMode', 'sourceContext'] : []),
      'runtimePolicy',
      'authority',
    ],
    ['configurationEvidenceReevaluation'],
    'applicability input',
  );
  equal(
    input.schemaVersion,
    englishInput ? 'wiselink.3_1.applicability_task.v2' : APPLICABILITY_TASK_SCHEMA,
    'APPLICABILITY_TASK_SCHEMA_UNSUPPORTED',
  );
  equal(
    input.operation,
    'EXTRACT_APPLICABILITY',
    'APPLICABILITY_TASK_OPERATION_INVALID',
  );
  nonEmpty(input.applicabilityContextRef, 'APPLICABILITY_CONTEXT_REF_REQUIRED');
  integerInRange(
    input.inputRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'APPLICABILITY_INPUT_REVISION_INVALID',
  );
  nonEmpty(input.documentVersionRef, 'APPLICABILITY_DOCUMENT_VERSION_REQUIRED');
  validateApplicabilitySourcePackage(input.sourcePackage);
  validateApplicabilityBilingualBinding(input.bilingualBinding);
  validateApplicabilityAircraft(input.aircraft);
  validateApplicabilityFleetBinding(input.fleetBinding);
  validateApplicabilityControlledAircraft(input.controlledAircraft);
  validateApplicabilityControlledFacts(input.controlledFacts);
  validateApplicabilityAstVocabulary(input.astVocabulary);
  validateApplicabilitySourceExpressions(input.sourceExpressions);
  if (englishInput) {
    equal(input.sourceReadingMode, 'VERIFIED_ENGLISH', 'APPLICABILITY_SOURCE_READING_MODE_INVALID');
    equal(input.bilingualBinding, null, 'APPLICABILITY_V2_LEGACY_BILINGUAL_FORBIDDEN');
    equal(canonicalJson(input.bilingualSourceUnits), '[]', 'APPLICABILITY_V2_LEGACY_UNITS_FORBIDDEN');
    array(input.sourceContext, 'APPLICABILITY_ENGLISH_CONTEXT_REQUIRED');
    for (const unit of input.sourceContext) {
      exactKeys(unit, ['unitId', 'kind', 'sourceText', 'sourceRefIds'], [], 'applicability English source context');
      nonEmpty(unit.unitId, 'APPLICABILITY_ENGLISH_UNIT_REQUIRED');
      nonEmpty(unit.sourceText, 'APPLICABILITY_ENGLISH_TEXT_REQUIRED');
      uniqueTextArray(unit.sourceRefIds, 'APPLICABILITY_ENGLISH_SOURCE_REFS_INVALID');
    }
    const covered = new Set(input.sourceContext.flatMap((unit) => unit.sourceRefIds));
    assertSubsetOf(input.sourceExpressions.flatMap((expression) => expression.sourceRefIds), covered, 'APPLICABILITY_ENGLISH_SOURCE_COVERAGE_REQUIRED');
  } else validateApplicabilityBilingualUnits(input.bilingualSourceUnits);
  validateApplicabilityRuntimePolicy(input.runtimePolicy);
  if ('configurationEvidenceReevaluation' in input) {
    validateApplicabilityConfigurationEvidenceReevaluation(
      input.configurationEvidenceReevaluation,
    );
  }
  exactKeys(
    input.authority,
    [
      'candidateOnly',
      'documentTextDoesNotProveFleetApplicability',
      'hostDeterministicEvaluationRequired',
    ],
    [],
    'applicability authority',
  );
  equal(input.authority.candidateOnly, true, 'APPLICABILITY_AUTHORITY_INVALID');
  equal(
    input.authority.documentTextDoesNotProveFleetApplicability,
    true,
    'APPLICABILITY_AUTHORITY_INVALID',
  );
  equal(
    input.authority.hostDeterministicEvaluationRequired,
    true,
    'APPLICABILITY_AUTHORITY_INVALID',
  );
  return input;
}

function validateApplicabilityConfigurationEvidenceReevaluation(value) {
  if (value === null) return;
  exactKeys(
    value,
    [
      'triggerSnapshotId',
      'triggerConfigurationRevision',
      'adoptionWorkItemRevision',
      'applicabilityRetryNo',
    ],
    [],
    'applicability configuration evidence reevaluation',
  );
  nonEmpty(
    value.triggerSnapshotId,
    'APPLICABILITY_REEVALUATION_TRIGGER_SNAPSHOT_ID_REQUIRED',
  );
  integerInRange(
    value.triggerConfigurationRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'APPLICABILITY_REEVALUATION_TRIGGER_CONFIGURATION_REVISION_INVALID',
  );
  integerInRange(
    value.adoptionWorkItemRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'APPLICABILITY_REEVALUATION_ADOPTION_WORK_ITEM_REVISION_INVALID',
  );
  integerInRange(
    value.applicabilityRetryNo,
    0,
    Number.MAX_SAFE_INTEGER,
    'APPLICABILITY_REEVALUATION_RETRY_NO_INVALID',
  );
}

export function validateApplicabilityAstCandidate(output, input) {
  exactKeys(
    output,
    ['schemaVersion', 'expressions'],
    [],
    'applicability AST candidate',
  );
  equal(
    output.schemaVersion,
    APPLICABILITY_AST_CANDIDATE_SCHEMA,
    'APPLICABILITY_AST_CANDIDATE_SCHEMA_UNSUPPORTED',
  );
  array(output.expressions, 'APPLICABILITY_AST_EXPRESSIONS_INVALID');
  const expected = input
    ? new Map(
        input.sourceExpressions.map((expression) => [
          expression.expressionId,
          expression,
        ]),
      )
    : null;
  if (
    output.expressions.length < 1 ||
    output.expressions.length > 200 ||
    (expected && output.expressions.length !== expected.size)
  ) {
    fail('APPLICABILITY_AST_EXPRESSIONS_INVALID');
  }
  const seen = new Set();
  output.expressions.forEach((expression, index) => {
    assertObject(expression, `applicability AST expression ${index}`);
    exactKeys(
      expression,
      ['expressionId', 'sourceRefIds', 'extractionStatus', 'expressionAst'],
      [],
      `applicability AST expression ${index}`,
    );
    nonEmpty(
      expression.expressionId,
      'APPLICABILITY_AST_EXPRESSION_ID_REQUIRED',
    );
    if (seen.has(expression.expressionId)) {
      fail('APPLICABILITY_AST_EXPRESSION_DUPLICATE');
    }
    seen.add(expression.expressionId);
    uniqueTextArray(
      expression.sourceRefIds,
      'APPLICABILITY_AST_SOURCE_REFS_INVALID',
    );
    equal(
      expression.extractionStatus,
      'extracted',
      'APPLICABILITY_AST_EXTRACTION_STATUS_INVALID',
    );
    const expectedExpression = expected?.get(expression.expressionId);
    if (
      expected &&
      (!expectedExpression ||
        canonicalJson(expression.sourceRefIds) !==
          canonicalJson(expectedExpression.sourceRefIds))
    ) {
      fail('APPLICABILITY_AST_SOURCE_BINDING_MISMATCH');
    }
    validateApplicabilityAstNode(
      expression.expressionAst,
      input?.astVocabulary ?? null,
    );
  });
  return output;
}

export function buildApplicabilityCandidate(input, astCandidate) {
  validateApplicabilityModelInput(input);
  validateApplicabilityAstCandidate(astCandidate, input);
  return {
    schemaVersion: APPLICABILITY_CANDIDATE_SCHEMA,
    operation: 'EXTRACT_APPLICABILITY',
    candidateStatus: 'CANDIDATE',
    inputRevision: input.inputRevision,
    documentVersionRef: input.documentVersionRef,
    sourcePackage: structuredClone(input.sourcePackage),
    bilingualBinding: structuredClone(input.bilingualBinding),
    aircraft: structuredClone(input.aircraft),
    fleetBinding: structuredClone(input.fleetBinding),
    expressions: structuredClone(astCandidate.expressions),
    runtime: structuredClone(input.runtimePolicy),
    authority: {
      candidateOnly: true,
      createsEvidenceRef: false,
      createsClosureDecision: false,
      createsActionReadiness: false,
      createsAirworthinessConclusion: false,
    },
  };
}

function validateApplicabilitySourcePackage(value) {
  exactKeys(
    value,
    ['packageId', 'contentHash'],
    [],
    'applicability source package',
  );
  nonEmpty(value.packageId, 'APPLICABILITY_PACKAGE_ID_REQUIRED');
  nonEmpty(value.contentHash, 'APPLICABILITY_PACKAGE_HASH_REQUIRED');
}

function validateApplicabilityBilingualBinding(value) {
  if (value === null) return;
  exactKeys(
    value,
    ['actionAttemptId', 'artifactSha256'],
    [],
    'applicability bilingual binding',
  );
  nonEmpty(value.actionAttemptId, 'APPLICABILITY_TRANSLATION_ATTEMPT_REQUIRED');
  nonEmpty(value.artifactSha256, 'APPLICABILITY_TRANSLATION_HASH_REQUIRED');
}

function validateApplicabilityAircraft(value) {
  exactKeys(
    value,
    ['aircraftNumber', 'assessmentAsOf'],
    [],
    'applicability aircraft',
  );
  nonEmpty(value.aircraftNumber, 'APPLICABILITY_AIRCRAFT_NUMBER_REQUIRED');
  match(
    value.assessmentAsOf,
    /^\d{4}-\d{2}-\d{2}$/u,
    'APPLICABILITY_AS_OF_INVALID',
  );
}

function validateApplicabilityFleetBinding(value) {
  exactKeys(
    value,
    [
      'bindingRevision',
      'selectionRevision',
      'sourceSnapshotId',
      'sourceRevisionKey',
      'authorityRevision',
      'sourceAsOf',
    ],
    [],
    'applicability fleet binding',
  );
  nonEmpty(value.bindingRevision, 'APPLICABILITY_BINDING_REVISION_REQUIRED');
  nonEmpty(
    value.selectionRevision,
    'APPLICABILITY_SELECTION_REVISION_REQUIRED',
  );
  nullableText(value.sourceSnapshotId, 'APPLICABILITY_SNAPSHOT_ID_INVALID');
  nullableText(
    value.sourceRevisionKey,
    'APPLICABILITY_SOURCE_REVISION_INVALID',
  );
  nullableText(
    value.authorityRevision,
    'APPLICABILITY_AUTHORITY_REVISION_INVALID',
  );
  nullableText(value.sourceAsOf, 'APPLICABILITY_SOURCE_AS_OF_INVALID');
}

function validateApplicabilityControlledAircraft(value) {
  if (value === null) return;
  exactKeys(
    value,
    [
      'assetId',
      'assetVersionId',
      'aircraftNumber',
      'fleetFamily',
      'aircraftModel',
      'series',
      'msn',
      'lineNumber',
      'deliveryDate',
      'recordHash',
    ],
    [],
    'controlled aircraft',
  );
  nonEmpty(value.assetId, 'APPLICABILITY_ASSET_ID_REQUIRED');
  nonEmpty(value.assetVersionId, 'APPLICABILITY_ASSET_VERSION_REQUIRED');
  nonEmpty(value.aircraftNumber, 'APPLICABILITY_ASSET_NUMBER_REQUIRED');
  for (const key of [
    'fleetFamily',
    'aircraftModel',
    'series',
    'msn',
    'deliveryDate',
  ]) {
    nullableText(value[key], 'APPLICABILITY_ASSET_FIELD_INVALID');
  }
  if (
    value.lineNumber !== null &&
    (!Number.isFinite(value.lineNumber) || value.lineNumber < 0)
  ) {
    fail('APPLICABILITY_ASSET_LINE_NUMBER_INVALID');
  }
  nonEmpty(value.recordHash, 'APPLICABILITY_ASSET_HASH_REQUIRED');
}

function validateApplicabilityControlledFacts(values) {
  array(values, 'APPLICABILITY_CONTROLLED_FACTS_INVALID');
  const ids = new Set();
  values.forEach((value, index) => {
    exactKeys(
      value,
      [
        'factId',
        'factType',
        'property',
        'qualifier',
        'value',
        'validAsOf',
        'recordHash',
      ],
      [],
      `controlled fact ${index}`,
    );
    nonEmpty(value.factId, 'APPLICABILITY_FACT_ID_REQUIRED');
    if (ids.has(value.factId)) fail('APPLICABILITY_FACT_ID_DUPLICATE');
    ids.add(value.factId);
    nonEmpty(value.factType, 'APPLICABILITY_FACT_TYPE_REQUIRED');
    nonEmpty(value.property, 'APPLICABILITY_FACT_PROPERTY_REQUIRED');
    nullableText(value.qualifier, 'APPLICABILITY_FACT_QUALIFIER_INVALID');
    nullableText(value.validAsOf, 'APPLICABILITY_FACT_AS_OF_INVALID');
    nonEmpty(value.recordHash, 'APPLICABILITY_FACT_HASH_REQUIRED');
  });
}

function validateApplicabilitySourceExpressions(values) {
  array(values, 'APPLICABILITY_SOURCE_EXPRESSIONS_INVALID');
  if (values.length < 1 || values.length > 200) {
    fail('APPLICABILITY_SOURCE_EXPRESSIONS_INVALID');
  }
  const ids = new Set();
  values.forEach((value, index) => {
    exactKeys(
      value,
      [
        'expressionId',
        'text',
        'sourceRefIds',
        'assignmentId',
        'targetKind',
        'targetId',
        'targetSourceRefIds',
        'applicabilityLevel',
        'contentRef',
      ],
      [],
      `applicability source expression ${index}`,
    );
    nonEmpty(value.expressionId, 'APPLICABILITY_EXPRESSION_ID_REQUIRED');
    if (ids.has(value.expressionId)) {
      fail('APPLICABILITY_EXPRESSION_ID_DUPLICATE');
    }
    ids.add(value.expressionId);
    nonEmpty(value.text, 'APPLICABILITY_EXPRESSION_TEXT_REQUIRED');
    uniqueTextArray(
      value.sourceRefIds,
      'APPLICABILITY_EXPRESSION_SOURCE_REFS_INVALID',
    );
    nonEmpty(value.assignmentId, 'APPLICABILITY_ASSIGNMENT_ID_REQUIRED');
    if (
      !['module', 'content_unit', 'source_element'].includes(value.targetKind)
    ) {
      fail('APPLICABILITY_TARGET_KIND_INVALID');
    }
    nullableText(value.targetId, 'APPLICABILITY_TARGET_ID_INVALID');
    uniqueTextArray(
      value.targetSourceRefIds,
      'APPLICABILITY_TARGET_SOURCE_REFS_INVALID',
    );
    if (
      !['document_effectivity', 'inline'].includes(value.applicabilityLevel)
    ) {
      fail('APPLICABILITY_LEVEL_INVALID');
    }
    nullableText(value.contentRef, 'APPLICABILITY_CONTENT_REF_INVALID');
  });
}

function validateApplicabilityBilingualUnits(values) {
  array(values, 'APPLICABILITY_BILINGUAL_UNITS_INVALID');
  const ids = new Set();
  values.forEach((value, index) => {
    exactKeys(
      value,
      ['unitId', 'kind', 'sourceText', 'translatedText', 'sourceRefIds'],
      [],
      `applicability bilingual unit ${index}`,
    );
    nonEmpty(value.unitId, 'APPLICABILITY_BILINGUAL_UNIT_ID_REQUIRED');
    if (ids.has(value.unitId)) {
      fail('APPLICABILITY_BILINGUAL_UNIT_ID_DUPLICATE');
    }
    ids.add(value.unitId);
    nonEmpty(value.kind, 'APPLICABILITY_BILINGUAL_KIND_REQUIRED');
    nonEmpty(value.sourceText, 'APPLICABILITY_BILINGUAL_SOURCE_REQUIRED');
    nonEmpty(
      value.translatedText,
      'APPLICABILITY_BILINGUAL_TRANSLATION_REQUIRED',
    );
    uniqueTextArray(
      value.sourceRefIds,
      'APPLICABILITY_BILINGUAL_SOURCE_REFS_INVALID',
    );
  });
}

function validateApplicabilityRuntimePolicy(value) {
  exactKeys(
    value,
    [
      'runtimeAppId',
      'profileRef',
      'modelPolicyRef',
      'promptVersion',
      'skillVersion',
      'mcpServerName',
      'mcpServerVersion',
    ],
    [],
    'applicability runtime policy',
  );
  equal(
    value.runtimeAppId,
    WISELINK_RUNTIME_APP_ID,
    'APPLICABILITY_RUNTIME_APP_MISMATCH',
  );
  equal(
    value.profileRef,
    WISELINK_PROFILE_REF,
    'APPLICABILITY_PROFILE_MISMATCH',
  );
  equal(
    value.modelPolicyRef,
    WISELINK_MODEL_POLICY_REF,
    'APPLICABILITY_MODEL_POLICY_MISMATCH',
  );
  equal(
    value.promptVersion,
    WISELINK_APPLICABILITY_PROMPT_VERSION,
    'APPLICABILITY_PROMPT_POLICY_MISMATCH',
  );
  equal(
    value.skillVersion,
    WISELINK_SKILL_COMPATIBILITY_REF,
    'APPLICABILITY_SKILL_POLICY_MISMATCH',
  );
  equal(
    value.mcpServerName,
    WISELINK_HOST_MCP_NAME,
    'APPLICABILITY_MCP_NAME_MISMATCH',
  );
  equal(
    value.mcpServerVersion,
    WISELINK_HOST_MCP_VERSION,
    'APPLICABILITY_MCP_VERSION_MISMATCH',
  );
}

function validateApplicabilityAstVocabulary(value) {
  assertObject(value, 'applicability AST vocabulary');
  exactKeys(
    value,
    ['schemaVersion', 'nodeTypes', 'properties', 'limits'],
    [],
    'applicability AST vocabulary',
  );
  equal(
    value.schemaVersion,
    APPLICABILITY_AST_VOCABULARY_SCHEMA,
    'APPLICABILITY_AST_VOCABULARY_SCHEMA_UNSUPPORTED',
  );
  const expectedNodeTypes = ['literal', 'assert', 'and', 'or', 'not'];
  if (canonicalJson(value.nodeTypes) !== canonicalJson(expectedNodeTypes)) {
    fail('APPLICABILITY_AST_VOCABULARY_NODE_TYPES_INVALID');
  }
  array(value.properties, 'APPLICABILITY_AST_VOCABULARY_PROPERTIES_INVALID');
  if (value.properties.length < 1 || value.properties.length > 64) {
    fail('APPLICABILITY_AST_VOCABULARY_PROPERTIES_INVALID');
  }
  const seenProperties = new Set();
  value.properties.forEach((property, propertyIndex) => {
    assertObject(property, `applicability AST property ${propertyIndex}`);
    exactKeys(
      property,
      ['property', 'valueType', 'qualifier', 'operators'],
      [],
      `applicability AST property ${propertyIndex}`,
    );
    nonEmpty(
      property.property,
      'APPLICABILITY_AST_VOCABULARY_PROPERTY_INVALID',
    );
    if (seenProperties.has(property.property)) {
      fail('APPLICABILITY_AST_VOCABULARY_PROPERTY_DUPLICATE');
    }
    seenProperties.add(property.property);
    if (!['string', 'number', 'boolean', 'date'].includes(property.valueType)) {
      fail('APPLICABILITY_AST_VOCABULARY_VALUE_TYPE_INVALID');
    }
    if (!['required', 'forbidden'].includes(property.qualifier)) {
      fail('APPLICABILITY_AST_VOCABULARY_QUALIFIER_INVALID');
    }
    array(property.operators, 'APPLICABILITY_AST_VOCABULARY_OPERATORS_INVALID');
    if (property.operators.length < 1 || property.operators.length > 16) {
      fail('APPLICABILITY_AST_VOCABULARY_OPERATORS_INVALID');
    }
    const seenOperators = new Set();
    property.operators.forEach((operator, operatorIndex) => {
      assertObject(
        operator,
        `applicability AST operator ${propertyIndex}:${operatorIndex}`,
      );
      exactKeys(
        operator,
        ['operator', 'valueShape'],
        [],
        `applicability AST operator ${propertyIndex}:${operatorIndex}`,
      );
      nonEmpty(
        operator.operator,
        'APPLICABILITY_AST_VOCABULARY_OPERATOR_INVALID',
      );
      if (seenOperators.has(operator.operator)) {
        fail('APPLICABILITY_AST_VOCABULARY_OPERATOR_DUPLICATE');
      }
      seenOperators.add(operator.operator);
      if (
        !['scalar', 'scalar_array', 'min_max_object'].includes(
          operator.valueShape,
        )
      ) {
        fail('APPLICABILITY_AST_VOCABULARY_VALUE_SHAPE_INVALID');
      }
    });
  });
  exactKeys(
    value.limits,
    ['maxDepth', 'maxNodes', 'maxGroupChildren', 'maxSetValues'],
    [],
    'applicability AST vocabulary limits',
  );
  integerInRange(
    value.limits.maxDepth,
    1,
    64,
    'APPLICABILITY_AST_VOCABULARY_LIMIT_INVALID',
  );
  integerInRange(
    value.limits.maxNodes,
    1,
    2000,
    'APPLICABILITY_AST_VOCABULARY_LIMIT_INVALID',
  );
  integerInRange(
    value.limits.maxGroupChildren,
    1,
    500,
    'APPLICABILITY_AST_VOCABULARY_LIMIT_INVALID',
  );
  integerInRange(
    value.limits.maxSetValues,
    1,
    1000,
    'APPLICABILITY_AST_VOCABULARY_LIMIT_INVALID',
  );
}

function validateApplicabilityAstNode(
  value,
  vocabulary = null,
  depth = 0,
  budget = { count: 0 },
) {
  assertObject(value, 'applicability AST node');
  nonEmpty(value.type, 'APPLICABILITY_AST_TYPE_REQUIRED');
  if (vocabulary) {
    if (
      depth > vocabulary.limits.maxDepth ||
      ++budget.count > vocabulary.limits.maxNodes
    ) {
      fail('APPLICABILITY_AST_TOO_COMPLEX');
    }
    if (!vocabulary.nodeTypes.includes(value.type)) {
      fail('APPLICABILITY_AST_TYPE_UNSUPPORTED');
    }
  }
  if (value.type === 'literal') {
    exactKeys(value, ['type', 'value'], [], 'applicability AST literal');
    boolean(value.value, 'APPLICABILITY_AST_LITERAL_INVALID');
    return;
  }
  if (value.type === 'assert') {
    exactKeys(
      value,
      ['type', 'property', 'operator', 'value'],
      ['qualifier'],
      'applicability AST assert',
    );
    nonEmpty(value.property, 'APPLICABILITY_AST_PROPERTY_REQUIRED');
    nonEmpty(value.operator, 'APPLICABILITY_AST_OPERATOR_REQUIRED');
    if (Object.hasOwn(value, 'qualifier')) {
      nullableText(value.qualifier, 'APPLICABILITY_AST_QUALIFIER_INVALID');
    }
    if (vocabulary) {
      const definition = vocabulary.properties.find(
        (entry) => entry.property === value.property,
      );
      const operator = definition?.operators.find(
        (entry) => entry.operator === value.operator,
      );
      if (!definition || !operator) {
        fail('APPLICABILITY_AST_ASSERT_UNSUPPORTED');
      }
      const hasQualifier =
        Object.hasOwn(value, 'qualifier') && value.qualifier !== null;
      if ((definition.qualifier === 'required') !== hasQualifier) {
        fail('APPLICABILITY_AST_QUALIFIER_INVALID');
      }
      validateApplicabilityAssertValue(
        value.value,
        definition.valueType,
        operator.valueShape,
        vocabulary.limits.maxSetValues,
      );
    }
    return;
  }
  if (value.type === 'and' || value.type === 'or') {
    exactKeys(value, ['type', 'children'], [], 'applicability AST group');
    array(value.children, 'APPLICABILITY_AST_CHILDREN_INVALID');
    if (
      value.children.length < 1 ||
      (vocabulary && value.children.length > vocabulary.limits.maxGroupChildren)
    ) {
      fail('APPLICABILITY_AST_CHILDREN_INVALID');
    }
    value.children.forEach((child) =>
      validateApplicabilityAstNode(child, vocabulary, depth + 1, budget),
    );
    return;
  }
  if (value.type === 'not') {
    exactKeys(value, ['type', 'child'], [], 'applicability AST not');
    validateApplicabilityAstNode(value.child, vocabulary, depth + 1, budget);
    return;
  }
  fail('APPLICABILITY_AST_TYPE_UNSUPPORTED');
}

function validateApplicabilityAssertValue(
  value,
  valueType,
  valueShape,
  maxSetValues,
) {
  if (valueShape === 'scalar_array') {
    array(value, 'APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    if (value.length < 1 || value.length > maxSetValues) {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    value.forEach((item) => validateApplicabilityScalar(item, valueType));
    if (
      new Set(value.map((item) => canonicalJson(item))).size !== value.length
    ) {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    return;
  }
  if (valueShape === 'min_max_object') {
    assertObject(value, 'applicability AST range');
    const keys = Object.keys(value).sort();
    if (keys.length < 1 || keys.some((key) => key !== 'min' && key !== 'max')) {
      fail('APPLICABILITY_AST_VALUE_SHAPE_INVALID');
    }
    if (Object.hasOwn(value, 'min')) {
      validateApplicabilityScalar(value.min, valueType);
    }
    if (Object.hasOwn(value, 'max')) {
      validateApplicabilityScalar(value.max, valueType);
    }
    if (
      Object.hasOwn(value, 'min') &&
      Object.hasOwn(value, 'max') &&
      value.min > value.max
    ) {
      fail('APPLICABILITY_AST_VALUE_RANGE_INVALID');
    }
    return;
  }
  validateApplicabilityScalar(value, valueType);
}

function validateApplicabilityScalar(value, valueType) {
  if (valueType === 'boolean' && typeof value === 'boolean') return;
  if (valueType === 'number' && Number.isFinite(value)) return;
  if (
    valueType === 'date' &&
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value)
  ) {
    return;
  }
  if (valueType === 'string' && typeof value === 'string' && value.trim()) {
    return;
  }
  fail('APPLICABILITY_AST_VALUE_TYPE_INVALID');
}

export function canonicalJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function sealResultEnvelope({
  task,
  modelOutput,
  provenance,
  sourceRefs = task?.sourceRefs,
  outputArtifactRefs = [],
  factsConsidered = [],
  warnings = [],
}) {
  validateTaskEnvelope(task);
  validateRuntimeProvenance(provenance);
  const serializedModelOutput =
    typeof modelOutput === 'string' ? modelOutput : canonicalJson(modelOutput);
  nonEmpty(serializedModelOutput, 'RESULT_ENVELOPE_MODEL_OUTPUT_REQUIRED');
  const envelope = {
    schemaVersion: RESULT_ENVELOPE_SCHEMA,
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: serializedModelOutput,
    outputArtifactRefs: structuredClone(outputArtifactRefs),
    sourceRefs: structuredClone(sourceRefs ?? []),
    factsConsidered: [...factsConsidered],
    missingInputs: [],
    conflicts: [],
    warnings: [...warnings],
    modelVersion: provenance.modelVersion,
    promptVersion: provenance.promptVersion,
    skillVersion: provenance.skillVersion,
    toolVersions: structuredClone(provenance.toolVersions),
    runMetrics: structuredClone(provenance.runMetrics),
    errorCode: null,
    errorDetail: null,
  };
  const sealed = { ...envelope, contentHash: canonicalSha256(envelope) };
  validateResultEnvelope(task, sealed);
  return sealed;
}

export function reviewCandidateArtifactRefs(task, candidate) {
  validateTaskEnvelope(task);
  const reviewTask = validateReviewTask(task.modelInput);
  validateReviewCandidate(reviewTask, candidate);
  const usedSourceRefIds = new Set(reviewCandidateSourceRefIds(reviewTask, candidate));
  const artifacts = new Map();
  for (const resource of reviewTask.resourceRefs) {
    if (!usedSourceRefIds.has(resource.sourceRefId)) continue;
    const existingSha256 = artifacts.get(resource.resourceArtifactRef);
    if (
      existingSha256 !== undefined &&
      existingSha256 !== resource.resourceArtifactSha256
    ) {
      fail('REVIEW_RESOURCE_ARTIFACT_BINDING_CONFLICT');
    }
    artifacts.set(
      resource.resourceArtifactRef,
      resource.resourceArtifactSha256,
    );
  }
  const artifactRefs = [...artifacts].map(([ref, sha256]) => ({
    ref,
    sha256,
  }));
  assertEnvelopeSourceSubset(task.sourceRefs, artifactRefs);
  return artifactRefs;
}

export function sealTranslationDeliveryResultEnvelope({
  taskBinding,
  modelOutput,
  provenance,
  factsConsidered = [],
  warnings = [],
}) {
  validateTranslationDeliveryTaskBinding(taskBinding);
  validateRuntimeProvenance(provenance);
  const serializedModelOutput =
    typeof modelOutput === 'string' ? modelOutput : canonicalJson(modelOutput);
  nonEmpty(serializedModelOutput, 'RESULT_ENVELOPE_MODEL_OUTPUT_REQUIRED');
  const envelope = {
    schemaVersion: RESULT_ENVELOPE_SCHEMA,
    actionAttemptId: taskBinding.actionAttemptId,
    operationRef: taskBinding.operationRef,
    taskType: taskBinding.taskType,
    workItemId: taskBinding.workItemId,
    baseRevision: taskBinding.baseRevision,
    status: 'SUCCEEDED',
    businessOutcome: 'CANDIDATE_READY',
    candidateStatus: null,
    modelOutput: serializedModelOutput,
    outputArtifactRefs: [],
    sourceRefs: [],
    factsConsidered: [...factsConsidered],
    missingInputs: [],
    conflicts: [],
    warnings: [...warnings],
    modelVersion: provenance.modelVersion,
    promptVersion: provenance.promptVersion,
    skillVersion: provenance.skillVersion,
    toolVersions: structuredClone(provenance.toolVersions),
    runMetrics: structuredClone(provenance.runMetrics),
    errorCode: null,
    errorDetail: null,
  };
  const sealed = { ...envelope, contentHash: canonicalSha256(envelope) };
  validateTranslationDeliveryResultEnvelope(taskBinding, sealed);
  return sealed;
}

export function sealWaitingInputResultEnvelope({ task, provenance }) {
  validateTaskEnvelope(task);
  validateRuntimeProvenance(provenance);
  if (task.hostResolvedMissingInputs.length === 0) {
    fail('RESULT_ENVELOPE_HOST_MISSING_INPUT_REQUIRED');
  }
  const envelope = {
    schemaVersion: RESULT_ENVELOPE_SCHEMA,
    actionAttemptId: task.actionAttemptId,
    operationRef: task.operationRef,
    taskType: task.taskType,
    workItemId: task.workItemId,
    baseRevision: task.baseRevision,
    status: 'WAITING_INPUT',
    businessOutcome: 'WAITING_INPUT',
    candidateStatus: 'WAITING_INPUT',
    modelOutput: null,
    outputArtifactRefs: [],
    sourceRefs: structuredClone(task.sourceRefs),
    factsConsidered: [],
    missingInputs: structuredClone(task.hostResolvedMissingInputs),
    conflicts: [],
    warnings: [],
    modelVersion: provenance.modelVersion,
    promptVersion: provenance.promptVersion,
    skillVersion: provenance.skillVersion,
    toolVersions: structuredClone(provenance.toolVersions),
    runMetrics: structuredClone(provenance.runMetrics),
    errorCode: null,
    errorDetail: null,
  };
  const sealed = { ...envelope, contentHash: canonicalSha256(envelope) };
  validateResultEnvelope(task, sealed);
  return sealed;
}

export function validateTaskEnvelope(value) {
  exactKeys(
    value,
    [
      'schemaVersion',
      'actionAttemptId',
      'operationRef',
      'taskType',
      'priority',
      'tenantId',
      'workItemId',
      'inputRevision',
      'baseRevision',
      'documentVersionId',
      'sourceRefs',
      'allowedConnectors',
      'hostResolvedMissingInputs',
      'modelInput',
      'deadline',
      'idempotencyKey',
      'inputHash',
    ],
    ['executionModel'],
    'task envelope',
  );
  equal(
    value.schemaVersion,
    TASK_ENVELOPE_SCHEMA,
    'TASK_ENVELOPE_SCHEMA_UNSUPPORTED',
  );
  nonEmpty(value.actionAttemptId, 'TASK_ENVELOPE_ATTEMPT_REQUIRED');
  nonEmpty(value.operationRef, 'TASK_ENVELOPE_OPERATION_REF_REQUIRED');
  if (!TASK_TYPES.has(value.taskType)) fail('TASK_ENVELOPE_TASK_TYPE_INVALID');
  integerInRange(value.priority, 0, 1_000, 'TASK_ENVELOPE_PRIORITY_INVALID');
  nonEmpty(value.tenantId, 'TASK_ENVELOPE_TENANT_REQUIRED');
  nonEmpty(value.workItemId, 'TASK_ENVELOPE_WORKITEM_REQUIRED');
  integerInRange(
    value.inputRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'TASK_ENVELOPE_INPUT_REVISION_INVALID',
  );
  integerInRange(
    value.baseRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'TASK_ENVELOPE_BASE_REVISION_INVALID',
  );
  nonEmpty(value.documentVersionId, 'TASK_ENVELOPE_DOCUMENT_VERSION_REQUIRED');
  validateEnvelopeRefs(value.sourceRefs, 'TASK_ENVELOPE_SOURCE_REFS_INVALID');
  arrayOfText(value.allowedConnectors, 'TASK_ENVELOPE_CONNECTORS_INVALID');
  validateEnvelopeMissingInputs(
    value.hostResolvedMissingInputs,
    'TASK_ENVELOPE_MISSING_INPUTS_INVALID',
  );
  assertObject(value.modelInput, 'task envelope model input');
  if (Object.hasOwn(value, 'executionModel')) validateExecutionModelSelection(value.executionModel);
  isoDate(value.deadline, 'TASK_ENVELOPE_DEADLINE_INVALID');
  nonEmpty(value.idempotencyKey, 'TASK_ENVELOPE_IDEMPOTENCY_KEY_REQUIRED');
  match(value.inputHash, BARE_SHA256, 'TASK_ENVELOPE_INPUT_HASH_INVALID');
  const { inputHash: _inputHash, ...unsealed } = value;
  equal(
    value.inputHash,
    canonicalSha256(unsealed),
    'TASK_ENVELOPE_INPUT_HASH_MISMATCH',
  );
  return value;
}

export function validateExecutionModelSelection(value) {
  exactKeys(value, ['modelRef', 'displayName', 'providerKind', 'settingsRevision', 'selectedAt'], [], 'execution model selection');
  match(value.modelRef, /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9/._:-]*$/u, 'TASK_EXECUTION_MODEL_INVALID');
  if (value.modelRef.length > 255) fail('TASK_EXECUTION_MODEL_INVALID');
  nonEmpty(value.displayName, 'TASK_EXECUTION_MODEL_INVALID');
  if (value.displayName.length > 120 || !['BUILT_IN', 'CUSTOM'].includes(value.providerKind)) fail('TASK_EXECUTION_MODEL_INVALID');
  integerInRange(value.settingsRevision, 0, Number.MAX_SAFE_INTEGER, 'TASK_EXECUTION_MODEL_INVALID');
  isoDate(value.selectedAt, 'TASK_EXECUTION_MODEL_INVALID');
  return value;
}

export function validateResultEnvelope(task, result) {
  validateTaskEnvelope(task);
  validateResultEnvelopeBinding(task, result);
  assertEnvelopeSourceSubset(task.sourceRefs, result.sourceRefs);
  const requiredMissing = new Set(
    task.hostResolvedMissingInputs.map(({ code }) => code),
  );
  const returnedMissing = new Set(result.missingInputs.map(({ code }) => code));
  if (requiredMissing.size > 0 && result.status !== 'WAITING_INPUT') {
    fail('RESULT_ENVELOPE_HOST_MISSING_INPUT_MUST_WAIT');
  }
  for (const code of requiredMissing) {
    if (!returnedMissing.has(code)) {
      fail('RESULT_ENVELOPE_HOST_MISSING_INPUT_DROPPED');
    }
  }
  return result;
}

export function validateTranslationDeliveryTaskBinding(value) {
  exactKeys(
    value,
    [
      'actionAttemptId',
      'operationRef',
      'taskType',
      'workItemId',
      'inputRevision',
      'baseRevision',
      'documentVersionId',
      'deadline',
      'inputHash',
      'sourceArtifactSha256',
    ],
    ['executionModel'],
    'translation delivery task binding',
  );
  nonEmpty(
    value.actionAttemptId,
    'TRANSLATION_DELIVERY_ACTION_ATTEMPT_REQUIRED',
  );
  nonEmpty(value.operationRef, 'TRANSLATION_DELIVERY_OPERATION_REF_REQUIRED');
  equal(
    value.taskType,
    'OPENCLAW_TRANSLATE',
    'TRANSLATION_DELIVERY_TASK_TYPE_INVALID',
  );
  nonEmpty(value.workItemId, 'TRANSLATION_DELIVERY_WORKITEM_REQUIRED');
  integerInRange(
    value.inputRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'TRANSLATION_DELIVERY_INPUT_REVISION_INVALID',
  );
  integerInRange(
    value.baseRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'TRANSLATION_DELIVERY_BASE_REVISION_INVALID',
  );
  nonEmpty(
    value.documentVersionId,
    'TRANSLATION_DELIVERY_DOCUMENT_VERSION_REQUIRED',
  );
  isoDate(value.deadline, 'TRANSLATION_DELIVERY_DEADLINE_INVALID');
  if (Object.hasOwn(value, 'executionModel')) validateExecutionModelSelection(value.executionModel);
  match(
    value.inputHash,
    BARE_SHA256,
    'TRANSLATION_DELIVERY_INPUT_HASH_INVALID',
  );
  arrayOfText(
    value.sourceArtifactSha256,
    'TRANSLATION_DELIVERY_SOURCE_ARTIFACT_SHA_INVALID',
  );
  value.sourceArtifactSha256.forEach((sha) =>
    match(sha, BARE_SHA256, 'TRANSLATION_DELIVERY_SOURCE_ARTIFACT_SHA_INVALID'),
  );
  return value;
}

export function validateTranslationDeliveryResultEnvelope(taskBinding, result) {
  validateTranslationDeliveryTaskBinding(taskBinding);
  validateResultEnvelopeBinding(taskBinding, result);
  if (
    result.sourceRefs.some(
      ({ sha256 }) => !taskBinding.sourceArtifactSha256.includes(sha256),
    )
  ) {
    fail('RESULT_ENVELOPE_SOURCE_REF_UNAUTHORIZED');
  }
  return result;
}

function validateResultEnvelopeBinding(task, result) {
  exactKeys(
    result,
    [
      'schemaVersion',
      'actionAttemptId',
      'operationRef',
      'taskType',
      'workItemId',
      'baseRevision',
      'status',
      'businessOutcome',
      'candidateStatus',
      'modelOutput',
      'outputArtifactRefs',
      'sourceRefs',
      'factsConsidered',
      'missingInputs',
      'conflicts',
      'warnings',
      'modelVersion',
      'promptVersion',
      'skillVersion',
      'toolVersions',
      'runMetrics',
      'contentHash',
      'errorCode',
      'errorDetail',
    ],
    [],
    'result envelope',
  );
  equal(
    result.schemaVersion,
    RESULT_ENVELOPE_SCHEMA,
    'RESULT_ENVELOPE_SCHEMA_UNSUPPORTED',
  );
  equal(
    result.actionAttemptId,
    task.actionAttemptId,
    'RESULT_ENVELOPE_ATTEMPT_MISMATCH',
  );
  equal(
    result.operationRef,
    task.operationRef,
    'RESULT_ENVELOPE_OPERATION_REF_MISMATCH',
  );
  equal(result.taskType, task.taskType, 'RESULT_ENVELOPE_TASK_TYPE_MISMATCH');
  equal(
    result.workItemId,
    task.workItemId,
    'RESULT_ENVELOPE_WORKITEM_MISMATCH',
  );
  equal(
    result.baseRevision,
    task.baseRevision,
    'RESULT_ENVELOPE_BASE_REVISION_MISMATCH',
  );
  if (!['SUCCEEDED', 'WAITING_INPUT', 'FAILED'].includes(result.status)) {
    fail('RESULT_ENVELOPE_STATUS_INVALID');
  }
  if (
    !['CANDIDATE_READY', 'UNKNOWN', 'WAITING_INPUT', 'NOT_PRODUCED'].includes(
      result.businessOutcome,
    )
  ) {
    fail('RESULT_ENVELOPE_BUSINESS_OUTCOME_INVALID');
  }
  if (
    result.candidateStatus !== null &&
    !['UNKNOWN', 'WAITING_INPUT'].includes(result.candidateStatus)
  ) {
    fail('RESULT_ENVELOPE_CANDIDATE_STATUS_INVALID');
  }
  validateEnvelopeRefs(
    result.outputArtifactRefs,
    'RESULT_ENVELOPE_OUTPUT_REFS_INVALID',
  );
  validateEnvelopeRefs(
    result.sourceRefs,
    'RESULT_ENVELOPE_SOURCE_REFS_INVALID',
  );
  arrayOfText(result.factsConsidered, 'RESULT_ENVELOPE_FACTS_INVALID');
  validateEnvelopeMissingInputs(
    result.missingInputs,
    'RESULT_ENVELOPE_MISSING_INPUTS_INVALID',
  );
  arrayOfText(result.conflicts, 'RESULT_ENVELOPE_CONFLICTS_INVALID');
  arrayOfText(result.warnings, 'RESULT_ENVELOPE_WARNINGS_INVALID');
  validateRuntimeProvenance({
    modelVersion: result.modelVersion,
    promptVersion: result.promptVersion,
    skillVersion: result.skillVersion,
    toolVersions: result.toolVersions,
    runMetrics: result.runMetrics,
  });
  nullableText(result.errorCode, 'RESULT_ENVELOPE_ERROR_CODE_INVALID');
  nullableText(result.errorDetail, 'RESULT_ENVELOPE_ERROR_DETAIL_INVALID');
  if (result.status === 'SUCCEEDED') {
    equal(
      result.businessOutcome,
      'CANDIDATE_READY',
      'RESULT_ENVELOPE_SUCCESS_SEMANTICS_INVALID',
    );
    equal(
      result.candidateStatus,
      null,
      'RESULT_ENVELOPE_SUCCESS_SEMANTICS_INVALID',
    );
    nonEmpty(result.modelOutput, 'RESULT_ENVELOPE_SUCCESS_SEMANTICS_INVALID');
    equal(result.errorCode, null, 'RESULT_ENVELOPE_SUCCESS_SEMANTICS_INVALID');
    equal(
      result.errorDetail,
      null,
      'RESULT_ENVELOPE_SUCCESS_SEMANTICS_INVALID',
    );
  } else if (result.status === 'WAITING_INPUT') {
    if (
      !['UNKNOWN', 'WAITING_INPUT'].includes(result.businessOutcome) ||
      !['UNKNOWN', 'WAITING_INPUT'].includes(result.candidateStatus) ||
      result.missingInputs.length === 0 ||
      result.modelOutput !== null ||
      result.outputArtifactRefs.length > 0 ||
      result.errorCode !== null ||
      result.errorDetail !== null
    ) {
      fail('RESULT_ENVELOPE_WAITING_INPUT_SEMANTICS_INVALID');
    }
  } else if (
    result.businessOutcome !== 'NOT_PRODUCED' ||
    result.modelOutput !== null ||
    typeof result.errorCode !== 'string' ||
    result.errorCode.trim() === ''
  ) {
    fail('RESULT_ENVELOPE_FAILURE_SEMANTICS_INVALID');
  }
  match(
    result.contentHash,
    BARE_SHA256,
    'RESULT_ENVELOPE_CONTENT_HASH_INVALID',
  );
  const { contentHash: _contentHash, ...unsealed } = result;
  equal(
    result.contentHash,
    canonicalSha256(unsealed),
    'RESULT_ENVELOPE_CONTENT_HASH_MISMATCH',
  );
  return result;
}

export function validateRuntimeProvenance(value) {
  exactKeys(
    value,
    [
      'modelVersion',
      'promptVersion',
      'skillVersion',
      'toolVersions',
      'runMetrics',
    ],
    [],
    'runtime provenance',
  );
  nonEmpty(value.modelVersion, 'RUNTIME_MODEL_PROVENANCE_REQUIRED');
  const normalizedModelVersion = value.modelVersion.trim().toLowerCase();
  if (
    normalizedModelVersion === 'fallback' ||
    normalizedModelVersion === 'unknown' ||
    normalizedModelVersion === WISELINK_MODEL_POLICY_REF
  ) {
    fail('RUNTIME_MODEL_PROVENANCE_UNREADABLE');
  }
  nonEmpty(value.promptVersion, 'RUNTIME_PROMPT_VERSION_REQUIRED');
  equal(
    value.skillVersion,
    WISELINK_SKILL_VERSION,
    'RUNTIME_SKILL_VERSION_POLICY_MISMATCH',
  );
  assertObject(value.toolVersions, 'runtime tool versions');
  for (const [name, version] of Object.entries(value.toolVersions)) {
    nonEmpty(name, 'RUNTIME_TOOL_NAME_INVALID');
    nonEmpty(version, 'RUNTIME_TOOL_VERSION_INVALID');
  }
  equal(
    value.toolVersions[WISELINK_HOST_MCP_NAME],
    WISELINK_HOST_MCP_VERSION,
    'RUNTIME_HOST_MCP_VERSION_POLICY_MISMATCH',
  );
  exactKeys(
    value.runMetrics,
    ['durationMs', 'inputUnits', 'outputUnits'],
    [],
    'runtime metrics',
  );
  for (const metric of Object.values(value.runMetrics)) {
    if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) {
      fail('RUNTIME_METRIC_INVALID');
    }
  }
  return value;
}

export function validateTranslationModelInput(input) {
  rejectAuthorityInput(input);
  exactKeys(
    input,
    ['schemaVersion', 'sourceUnits', 'rulePack', 'taskStartBinding'],
    [],
    'translation input',
  );
  equal(
    input.schemaVersion,
    'wiselink.3_1.translation_task.v0.candidate',
    'TRANSLATION_TASK_SCHEMA_UNSUPPORTED',
  );
  assertObject(input.rulePack, 'translation rule pack');
  assertObject(input.rulePack.meta, 'translation rule pack meta');
  assertObject(input.rulePack.deterministic, 'translation deterministic rules');
  nonEmpty(input.rulePack.meta.rulePackId, 'TRANSLATION_RULE_PACK_ID_REQUIRED');
  nonEmpty(
    input.rulePack.meta.rulePackVersion,
    'TRANSLATION_RULE_PACK_VERSION_REQUIRED',
  );
  boolean(
    input.rulePack.deterministic.numericFidelity,
    'TRANSLATION_NUMERIC_FIDELITY_RULE_INVALID',
  );
  boolean(
    input.rulePack.deterministic.preserveAtaChapterNumbers,
    'TRANSLATION_ATA_PRESERVATION_RULE_INVALID',
  );
  assertObject(input.taskStartBinding, 'translation task binding');
  array(input.sourceUnits, 'TRANSLATION_SOURCE_UNITS_INVALID');
  input.sourceUnits.forEach((source, index) => {
    assertObject(source, `translation source unit ${index}`);
    exactKeys(
      source,
      ['unitKey', 'kind', 'text', 'sourceRefIds'],
      [],
      `translation source unit ${index}`,
    );
    nonEmpty(source.unitKey, 'TRANSLATION_SOURCE_UNIT_KEY_REQUIRED');
    nonEmpty(source.kind, 'TRANSLATION_SOURCE_UNIT_KIND_REQUIRED');
    nonEmpty(source.text, 'TRANSLATION_SOURCE_TEXT_REQUIRED');
    uniqueTextArray(source.sourceRefIds, 'TRANSLATION_SOURCE_REFS_INVALID');
  });
  return input;
}

export function validateTranslationPair(input, output) {
  validateTranslationModelInput(input);
  rejectAuthorityInput(output);
  exactKeys(
    output,
    [
      'schemaVersion',
      'rulePackId',
      'rulePackVersion',
      'taskStartBinding',
      'candidateUnits',
    ],
    [],
    'translation output',
  );
  equal(
    output.schemaVersion,
    'wiselink.3_1.translation_result.v0.candidate',
    'TRANSLATION_RESULT_SCHEMA_UNSUPPORTED',
  );
  equal(
    output.rulePackId,
    input.rulePack.meta.rulePackId,
    'TRANSLATION_RULE_PACK_ID_MISMATCH',
  );
  equal(
    output.rulePackVersion,
    input.rulePack.meta.rulePackVersion,
    'TRANSLATION_RULE_PACK_VERSION_MISMATCH',
  );
  equal(
    canonicalJson(output.taskStartBinding),
    canonicalJson(input.taskStartBinding),
    'TRANSLATION_TASK_BINDING_MISMATCH',
  );
  array(output.candidateUnits, 'TRANSLATION_CANDIDATE_UNITS_INVALID');
  equal(
    output.candidateUnits.length,
    input.sourceUnits.length,
    'TRANSLATION_UNIT_COUNT_MISMATCH',
  );
  const sourceKeys = new Set();
  const fidelityFindings = [];
  input.sourceUnits.forEach((source, index) => {
    if (sourceKeys.has(source.unitKey))
      fail('TRANSLATION_SOURCE_UNIT_DUPLICATE');
    sourceKeys.add(source.unitKey);
    const candidate = output.candidateUnits[index];
    assertObject(candidate, `translation candidate unit ${index}`);
    exactKeys(
      candidate,
      ['unitKey', 'text', 'sourceRefIds', 'engineerRevision'],
      [],
      `translation candidate unit ${index}`,
    );
    equal(candidate.unitKey, source.unitKey, 'TRANSLATION_UNIT_ORDER_MISMATCH');
    nonEmpty(candidate.text, 'TRANSLATION_CANDIDATE_TEXT_REQUIRED');
    uniqueTextArray(
      candidate.sourceRefIds,
      'TRANSLATION_CANDIDATE_REFS_INVALID',
    );
    equal(
      canonicalJson(candidate.sourceRefIds),
      canonicalJson(source.sourceRefIds),
      'TRANSLATION_SOURCE_REF_MISMATCH',
    );
    fidelityFindings.push(
      ...translationFidelityFindings({
        unitKey: source.unitKey,
        sourceText: source.text,
        candidateText: candidate.text,
        rulePack: input.rulePack,
      }),
    );
    if (candidate.engineerRevision !== null) {
      assertObject(candidate.engineerRevision, 'translation engineer revision');
    }
  });
  if (fidelityFindings.length > 0) {
    fail(
      `TRANSLATION_RULE_PREFLIGHT_REJECTED:${canonicalJson({
        findingCount: fidelityFindings.length,
        findings: fidelityFindings,
      })}`,
    );
  }
  return output;
}

export function translationFidelityFindings({
  unitKey,
  sourceText,
  candidateText,
  rulePack,
}) {
  const findings = [];
  const deterministic = rulePack.deterministic;

  for (const term of rulePack.terms ?? []) {
    if (term.severity !== 'mandatory') continue;
    if (!sourceText.includes(term.sourceTerm)) continue;
    const rendered = (term.targetRenderings ?? []).some((rendering) =>
      candidateText.includes(rendering),
    );
    if (!rendered) {
      findings.push({
        ruleId: term.ruleId,
        code: 'TERM_MANDATORY_MISSING',
        unitKey,
        message: `mandatory term "${term.sourceTerm}" not rendered by any of [${(term.targetRenderings ?? []).join(', ')}]`,
      });
    }
  }

  for (const entry of rulePack.noTranslate ?? []) {
    if (!sourceText.includes(entry.token)) continue;
    if (!candidateText.includes(entry.token)) {
      findings.push({
        ruleId: entry.ruleId,
        code: 'NO_TRANSLATE_VIOLATED',
        unitKey,
        message: `no-translate token "${entry.token}" must be retained verbatim`,
      });
    }
  }

  for (const pattern of deterministic.preservedIdentifierPatterns ?? []) {
    let regex = null;
    try {
      regex = new RegExp(pattern, 'g');
    } catch {
      regex = null;
    }
    if (regex === null) {
      findings.push({
        ruleId: 'identifier.preserve',
        code: 'UNRECOGNIZED_RULES',
        unitKey,
        message: `identifier pattern is not a valid regex: ${pattern}`,
      });
      continue;
    }
    for (const identifier of sourceText.match(regex) ?? []) {
      if (!candidateText.includes(identifier)) {
        findings.push({
          ruleId: 'identifier.preserve',
          code: 'IDENTIFIER_NOT_PRESERVED',
          unitKey,
          message: `identifier "${identifier}" must be preserved verbatim`,
        });
      }
    }
  }

  if (deterministic.numericFidelity) {
    // Exact Host semantics: token occurrence multiset equality catches
    // missing, changed, extra, and wrongly duplicated numeric tokens.
    const sourceCounts = numberMultiset(sourceNumbers(sourceText));
    const targetCounts = numberMultiset(sourceNumbers(candidateText));
    for (const [token, sourceCount] of sourceCounts) {
      const targetCount = targetCounts.get(token) ?? 0;
      if (targetCount < sourceCount) {
        findings.push({
          ruleId: 'number.fidelity',
          code: 'NUMBER_NOT_PRESERVED',
          unitKey,
          message: `number "${token}" appears ${String(sourceCount)}x in the source but only ${String(targetCount)}x in the translation`,
        });
      }
    }
    for (const [token, targetCount] of targetCounts) {
      const sourceCount = sourceCounts.get(token) ?? 0;
      if (targetCount > sourceCount) {
        findings.push({
          ruleId: 'number.fidelity',
          code: 'NUMBER_NOT_PRESERVED',
          unitKey,
          message: `number "${token}" appears ${String(targetCount)}x in the translation but only ${String(sourceCount)}x in the source (extra/changed)`,
        });
      }
    }
  }

  for (const unit of deterministic.preservedUnits ?? []) {
    if (!containsPreservedUnit(sourceText, unit)) continue;
    if (!containsPreservedUnit(candidateText, unit)) {
      findings.push({
        ruleId: 'unit.preserve',
        code: 'UNIT_NOT_PRESERVED',
        unitKey,
        message: `unit "${unit}" must be preserved verbatim`,
      });
    }
  }

  if (deterministic.preserveAtaChapterNumbers) {
    const ataMatches = Array.from(sourceText.matchAll(ATA_CHAPTER_PATTERN),
      (match) => match[1]);
    for (const ata of ataMatches) {
      if (!candidateText.includes(ata)) {
        findings.push({
          ruleId: 'ata.preserve',
          code: 'ATA_CHAPTER_NOT_PRESERVED',
          unitKey,
          message: `ATA chapter "${ata}" must be preserved verbatim`,
        });
      }
    }
  }

  if (deterministic.preservePartNumbers) {
    for (const part of sourceText.match(PART_NUMBER_PATTERN) ?? []) {
      if (!candidateText.includes(part)) {
        findings.push({
          ruleId: 'part.preserve',
          code: 'PART_NUMBER_NOT_PRESERVED',
          unitKey,
          message: `part number "${part}" must be preserved verbatim`,
        });
      }
    }
  }

  if (deterministic.preserveCitations) {
    for (const citation of sourceText.match(CITATION_PATTERN) ?? []) {
      if (!candidateText.includes(citation)) {
        findings.push({
          ruleId: 'citation.preserve',
          code: 'CITATION_NOT_PRESERVED',
          unitKey,
          message: `citation "${citation}" must be preserved verbatim`,
        });
      }
    }
  }
  return findings;
}

function containsPreservedUnit(text, unit) {
  let offset = 0;
  while (offset <= text.length - unit.length) {
    const index = text.indexOf(unit, offset);
    if (index < 0) return false;
    const before = index === 0 ? '' : (text[index - 1] ?? '');
    const after = text[index + unit.length] ?? '';
    const leftBounded = !/^\p{L}/u.test(unit) || !/\p{L}/u.test(before);
    const rightBounded = !/\p{L}$/u.test(unit) || !/\p{L}/u.test(after);
    if (leftBounded && rightBounded) return true;
    offset = index + Math.max(unit.length, 1);
  }
  return false;
}

function sourceNumbers(text) {
  const tokens = [];
  const monthNumbers = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const englishMonth =
    '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|' +
    'Jul(?:y)?|Aug(?:ust)?|Sep(?:tember|t)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const dateBoundary = '(?<![A-Za-z0-9_/-])';
  const dateEnd = '(?![A-Za-z0-9_/-])';
  const recordDate = (full, yearText, monthText, dayText) => {
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    if (year < 1000 || month < 1 || month > 12 || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return full;
    tokens.push('date:' + year + '-' + String(month).padStart(2, '0') +
      '-' + String(day).padStart(2, '0'));
    return ' ';
  };
  // Compare complete, unambiguous calendar dates by value. A month name
  // becoming a month number is localization, not an added engineering value.
  // Identifier substrings and incomplete/invalid dates stay literal.
  let remaining = text.replace(
    new RegExp(dateBoundary + '(\\d{1,2})\\s+' + englishMonth +
      '\\.?[\\s,]+(\\d{4})' + dateEnd, 'gi'),
    (full, day, month, year) => recordDate(full, year,
      String(monthNumbers[month.slice(0, 3).toLowerCase()]), day),
  ).replace(
    new RegExp(dateBoundary + englishMonth +
      '\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s+(\\d{4})' + dateEnd, 'gi'),
    (full, month, day, year) => recordDate(full, year,
      String(monthNumbers[month.slice(0, 3).toLowerCase()]), day),
  );
  remaining = remaining.replace(
    new RegExp(dateBoundary + '(\\d{4})-(\\d{1,2})-(\\d{1,2})' + dateEnd, 'g'),
    (full, year, month, day) => recordDate(full, year, month, day),
  ).replace(
    new RegExp(dateBoundary + '(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日' + dateEnd, 'g'),
    (full, year, month, day) => recordDate(full, year, month, day),
  );
  for (const match of remaining.matchAll(/(?=[A-Za-z0-9_]*\d)[A-Za-z_][A-Za-z0-9_]*|[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu)) {
    const value = match[0];
    if (/^[A-Za-z_]/u.test(value)) {
      // A letter-glued identifier must not become a different token by
      // inserting whitespace or changing its numeric suffix.
      tokens.push('identifier:' + value);
      continue;
    }
    const before = remaining[match.index - 1] ?? '';
    // CJK text can touch a numeric value. In identifiers/ranges, a sign
    // following an ASCII word character is a connector, not a signed value.
    tokens.push(/^[+-]/u.test(value) && /[A-Za-z0-9_]/u.test(before)
      ? value.slice(1) : value);
  }
  return tokens;
}

function numberMultiset(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function validateReviewTask(value) {
  const isMatter = value?.schemaVersion === REVIEW_MATTER_TASK_SCHEMA;
  const isJobAid = value?.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA;
  exactKeys(
    value,
    [
      'schemaVersion',
      'mode',
      'reviewConversationRef',
      'reviewTurnRef',
      'requestId',
      'actorContextRef',
      'inputRevision',
      'selectedEvaluationItemId',
      'userMessage',
      'allowedOperations',
      'resourceRefs',
      'allowedEvaluationItemIds',
      'allowedAdoptedInputRefs',
      'attachmentRefs',
      'context',
      'executionPolicy',
      ...(isMatter ? ['matterContext'] : []),
      ...(isJobAid ? ['jobAidContext'] : []),
    ],
    [],
    'review task',
  );
  equal(
    value.schemaVersion,
    isJobAid ? REVIEW_JOBAID_TASK_SCHEMA : isMatter ? REVIEW_MATTER_TASK_SCHEMA : REVIEW_TASK_SCHEMA,
    'REVIEW_TASK_SCHEMA_UNSUPPORTED',
  );
  equal(value.mode, 'INTERACTIVE_REVIEW', 'REVIEW_TASK_MODE_INVALID');
  nonEmpty(value.reviewConversationRef, 'REVIEW_TASK_CONVERSATION_REQUIRED');
  nonEmpty(value.reviewTurnRef, 'REVIEW_TASK_TURN_REQUIRED');
  nonEmpty(value.requestId, 'REVIEW_TASK_REQUEST_REQUIRED');
  nonEmpty(value.actorContextRef, 'REVIEW_TASK_ACTOR_CONTEXT_REQUIRED');
  integerInRange(
    value.inputRevision,
    0,
    Number.MAX_SAFE_INTEGER,
    'REVIEW_TASK_REVISION_INVALID',
  );
  nullableText(
    value.selectedEvaluationItemId,
    'REVIEW_TASK_SELECTED_ITEM_INVALID',
  );
  nonEmpty(value.userMessage, 'REVIEW_TASK_USER_MESSAGE_REQUIRED');
  equal(
    canonicalJson(value.allowedOperations),
    canonicalJson(REVIEW_ALLOWED_OPERATIONS),
    'REVIEW_TASK_ALLOWED_OPERATIONS_INVALID',
  );
  uniqueTextArray(
    value.allowedEvaluationItemIds,
    'REVIEW_TASK_EVALUATION_ITEMS_INVALID',
  );
  uniqueTextArray(
    value.allowedAdoptedInputRefs,
    'REVIEW_TASK_ADOPTED_INPUTS_INVALID',
  );
  arrayOfText(value.attachmentRefs, 'REVIEW_TASK_ATTACHMENTS_INVALID');
  if (new Set(value.attachmentRefs).size !== value.attachmentRefs.length) {
    fail('REVIEW_TASK_ATTACHMENTS_DUPLICATE');
  }
  assertObject(value.context, 'review task context');
  array(value.resourceRefs, 'REVIEW_TASK_RESOURCE_REFS_INVALID');
  const resourceIds = new Set();
  value.resourceRefs.forEach((resource, index) => {
    assertObject(resource, `review resource ${index}`);
    exactKeys(
      resource,
      ['sourceRefId', 'resourceArtifactRef', 'resourceArtifactSha256', 'value'],
      [],
      `review resource ${index}`,
    );
    nonEmpty(resource.sourceRefId, 'REVIEW_TASK_RESOURCE_REF_ID_REQUIRED');
    if (resourceIds.has(resource.sourceRefId)) {
      fail('REVIEW_TASK_RESOURCE_REFS_DUPLICATE');
    }
    resourceIds.add(resource.sourceRefId);
    nonEmpty(
      resource.resourceArtifactRef,
      'REVIEW_TASK_RESOURCE_ARTIFACT_REQUIRED',
    );
    match(
      resource.resourceArtifactSha256,
      BARE_SHA256,
      'REVIEW_TASK_RESOURCE_HASH_INVALID',
    );
    assertObject(resource.value, 'review resource value');
    equal(
      resource.value.sourceRefId,
      resource.sourceRefId,
      'REVIEW_TASK_RESOURCE_BINDING_INVALID',
    );
  });
  assertSubsetOf(
    value.attachmentRefs,
    resourceIds,
    'REVIEW_TASK_ATTACHMENT_REF_NOT_ALLOWED',
  );
  if (isMatter) {
    validateFrozenMatterReviewContext(value.matterContext, resourceIds);
    if (value.selectedEvaluationItemId !== null || value.allowedEvaluationItemIds.length > 0) {
      fail('REVIEW_MATTER_EVALUATION_SCOPE_INVALID');
    }
  }
  if (isJobAid) validateFrozenJobAidReviewContext(value);
  exactKeys(
    value.executionPolicy,
    [
      'runtimeAppId',
      'profileRef',
      'modelPolicyRef',
      'skillPolicyRef',
      'toolPolicyRef',
    ],
    [],
    'review execution policy',
  );
  equal(
    value.executionPolicy.runtimeAppId,
    WISELINK_RUNTIME_APP_ID,
    'REVIEW_TASK_RUNTIME_POLICY_INVALID',
  );
  equal(
    value.executionPolicy.profileRef,
    WISELINK_PROFILE_REF,
    'REVIEW_TASK_PROFILE_POLICY_INVALID',
  );
  equal(
    value.executionPolicy.modelPolicyRef,
    WISELINK_MODEL_POLICY_REF,
    'REVIEW_TASK_MODEL_POLICY_INVALID',
  );
  equal(
    value.executionPolicy.skillPolicyRef,
    WISELINK_SKILL_COMPATIBILITY_REF,
    'REVIEW_TASK_SKILL_POLICY_INVALID',
  );
  equal(
    value.executionPolicy.toolPolicyRef,
    `${WISELINK_HOST_MCP_NAME}@${WISELINK_HOST_MCP_VERSION}#${isJobAid ? 'interactive-jobaid-review-c5' : isMatter ? 'interactive-matter-review-c4' : 'interactive-review-c3'}`,
    'REVIEW_TASK_TOOL_POLICY_INVALID',
  );
  return value;
}

export function validateReviewCandidate(task, candidate) {
  validateReviewTask(task);
  const isMatter = task.schemaVersion === REVIEW_MATTER_TASK_SCHEMA;
  const isJobAid = task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA;
  exactKeys(
    candidate,
    [
      'schemaVersion',
      'mode',
      'reviewConversationRef',
      'reviewTurnRef',
      'responseType',
      'answer',
      'sourceRefs',
      'missingInputs',
      'candidateEvidenceRefs',
      'reviewActionDraft',
      'affectedItemIds',
      'warnings',
      'runtime',
      ...(isMatter ? ['matterWorkingDelta'] : []),
      ...(isJobAid ? ['jobAidWorkingDelta'] : []),
    ],
    [],
    'review candidate',
  );
  equal(
    candidate.schemaVersion,
    isJobAid ? REVIEW_JOBAID_CANDIDATE_SCHEMA : isMatter ? REVIEW_MATTER_CANDIDATE_SCHEMA : REVIEW_CANDIDATE_SCHEMA,
    'REVIEW_CANDIDATE_SCHEMA_UNSUPPORTED',
  );
  equal(candidate.mode, 'INTERACTIVE_REVIEW', 'REVIEW_CANDIDATE_MODE_INVALID');
  equal(
    candidate.reviewConversationRef,
    task.reviewConversationRef,
    'REVIEW_CANDIDATE_CONVERSATION_MISMATCH',
  );
  equal(
    candidate.reviewTurnRef,
    task.reviewTurnRef,
    'REVIEW_CANDIDATE_TURN_MISMATCH',
  );
  if (!REVIEW_RESPONSE_TYPES.has(candidate.responseType) && !((isMatter || isJobAid) && candidate.responseType === 'RESYNTHESIS_RESULT')) {
    fail(isMatter ? 'REVIEW_CANDIDATE_RESPONSE_TYPE_UNSUPPORTED_BY_C4' : 'REVIEW_CANDIDATE_RESPONSE_TYPE_UNSUPPORTED_BY_C3');
  }
  nonEmpty(candidate.answer, 'REVIEW_CANDIDATE_ANSWER_REQUIRED');
  uniqueTextArray(candidate.sourceRefs, 'REVIEW_CANDIDATE_SOURCE_REFS_INVALID');
  if (
    candidate.responseType === 'SOURCE_LINK' &&
    candidate.sourceRefs.length === 0
  ) {
    fail('REVIEW_CANDIDATE_SOURCE_LINK_REF_REQUIRED');
  }
  uniqueTextArray(
    candidate.missingInputs,
    'REVIEW_CANDIDATE_MISSING_INPUTS_INVALID',
  );
  uniqueTextArray(
    candidate.candidateEvidenceRefs,
    'REVIEW_CANDIDATE_EVIDENCE_REFS_INVALID',
  );
  uniqueTextArray(
    candidate.affectedItemIds,
    'REVIEW_CANDIDATE_AFFECTED_ITEMS_INVALID',
  );
  uniqueTextArray(candidate.warnings, 'REVIEW_CANDIDATE_WARNINGS_INVALID');
  if (task.context.purpose === 'UPDATE_ASSESSMENT' &&
      ((isJobAid && candidate.jobAidWorkingDelta == null) || (isMatter && candidate.matterWorkingDelta == null))) {
    fail('REVIEW_UPDATE_WORKING_DELTA_REQUIRED');
  }
  if (task.context.purpose === 'CHAT' && (candidate.reviewActionDraft !== null || candidate.matterWorkingDelta != null || candidate.jobAidWorkingDelta != null || candidate.affectedItemIds.length > 0 || candidate.responseType === 'REVIEW_ACTION_DRAFT' || candidate.responseType === 'RESYNTHESIS_RESULT')) fail('REVIEW_CHAT_ASSESSMENT_MUTATION_FORBIDDEN');
  if (isMatter) {
    if (candidate.reviewActionDraft !== null) fail('REVIEW_MATTER_FORMAL_ACTION_FORBIDDEN');
    if (candidate.affectedItemIds.length > 0) fail('REVIEW_MATTER_AFFECTED_ITEMS_FORBIDDEN');
    validateMatterWorkingDelta(task, candidate.matterWorkingDelta);
  }
  if (isJobAid) {
    if (candidate.reviewActionDraft !== null || candidate.affectedItemIds.length > 0) fail('REVIEW_JOBAID_FORMAL_ACTION_FORBIDDEN');
    validateJobAidReviewDelta(task, candidate.jobAidWorkingDelta);
  }
  const allowedSources = new Set(valueIds(task.resourceRefs, 'sourceRefId'));
  const allowedItems = new Set(task.allowedEvaluationItemIds);
  const allowedAdopted = new Set(task.allowedAdoptedInputRefs);
  assertSubsetOf(
    candidate.sourceRefs,
    allowedSources,
    'REVIEW_CANDIDATE_SOURCE_REF_NOT_ALLOWED',
  );
  assertSubsetOf(
    candidate.candidateEvidenceRefs,
    allowedSources,
    'REVIEW_CANDIDATE_EVIDENCE_REF_NOT_ALLOWED',
  );
  assertSubsetOf(
    candidate.affectedItemIds,
    allowedItems,
    'REVIEW_CANDIDATE_AFFECTED_ITEM_NOT_ALLOWED',
  );
  const hasDraft = candidate.reviewActionDraft !== null;
  equal(
    candidate.responseType === 'REVIEW_ACTION_DRAFT',
    hasDraft,
    'REVIEW_CANDIDATE_DRAFT_RESPONSE_MISMATCH',
  );
  if (hasDraft) {
    const draft = candidate.reviewActionDraft;
    exactKeys(
      draft,
      [
        'baseRevision',
        'evaluationItemId',
        'proposedStatus',
        'resolvedGapRefs',
        'adoptedInputRefs',
        'sourceRefs',
        'assumptions',
        'affectedItemIds',
        'overallImpact',
        'uncertaintyDispositions',
        'decisionSnapshot',
      ],
      [],
      'review action draft',
    );
    equal(
      draft.baseRevision,
      task.inputRevision,
      'REVIEW_CANDIDATE_DRAFT_REVISION_MISMATCH',
    );
    nonEmpty(draft.evaluationItemId, 'REVIEW_CANDIDATE_DRAFT_ITEM_REQUIRED');
    nonEmpty(draft.proposedStatus, 'REVIEW_CANDIDATE_DRAFT_STATUS_REQUIRED');
    uniqueTextArray(
      draft.resolvedGapRefs,
      'REVIEW_CANDIDATE_DRAFT_GAP_REFS_INVALID',
    );
    uniqueTextArray(
      draft.adoptedInputRefs,
      'REVIEW_CANDIDATE_DRAFT_ADOPTED_REFS_INVALID',
    );
    uniqueTextArray(
      draft.sourceRefs,
      'REVIEW_CANDIDATE_DRAFT_SOURCE_REFS_INVALID',
    );
    uniqueTextArray(
      draft.assumptions,
      'REVIEW_CANDIDATE_DRAFT_ASSUMPTIONS_INVALID',
    );
    uniqueTextArray(
      draft.affectedItemIds,
      'REVIEW_CANDIDATE_DRAFT_AFFECTED_ITEMS_INVALID',
    );
    boolean(
      draft.overallImpact,
      'REVIEW_CANDIDATE_DRAFT_OVERALL_IMPACT_INVALID',
    );
    const dispositions = validateReviewUncertaintyDispositions(
      draft.uncertaintyDispositions,
    );
    const snapshot = validateReviewDecisionSnapshot(draft.decisionSnapshot);
    equal(
      canonicalJson(snapshot.uncertaintyDispositions),
      canonicalJson(dispositions),
      'REVIEW_CANDIDATE_DECISION_SNAPSHOT_DISPOSITIONS_MISMATCH',
    );
    assertSubsetOf(
      [draft.evaluationItemId, ...draft.affectedItemIds],
      allowedItems,
      'REVIEW_CANDIDATE_DRAFT_ITEM_NOT_ALLOWED',
    );
    assertSubsetOf(
      draft.sourceRefs,
      allowedSources,
      'REVIEW_CANDIDATE_DRAFT_SOURCE_REF_NOT_ALLOWED',
    );
    assertSubsetOf(
      draft.adoptedInputRefs,
      allowedAdopted,
      'REVIEW_CANDIDATE_DRAFT_ADOPTED_REF_NOT_ALLOWED',
    );
    if (!draft.affectedItemIds.includes(draft.evaluationItemId)) {
      fail('REVIEW_CANDIDATE_DRAFT_PRIMARY_ITEM_MISSING');
    }
    equal(
      canonicalJson(draft.affectedItemIds),
      canonicalJson(candidate.affectedItemIds),
      'REVIEW_CANDIDATE_DRAFT_AFFECTED_ITEMS_MISMATCH',
    );
    if (
      draft.resolvedGapRefs.length > 0 ||
      dispositions.length > 0 ||
      snapshot.decisionMaturity === 'CONFIRMABLE'
    ) {
      assertObject(task.context.evaluation, 'review evaluation context');
      assertObject(task.context.evaluation.gapLedger, 'review gap ledger');
      const gapLedger = task.context.evaluation.gapLedger;
      equal(
        gapLedger.inputRevision,
        task.inputRevision,
        'REVIEW_CANDIDATE_GAP_LEDGER_CURRENTNESS_INVALID',
      );
      equal(
        gapLedger.currentness,
        'CURRENT',
        'REVIEW_CANDIDATE_GAP_LEDGER_CURRENTNESS_INVALID',
      );
      equal(
        gapLedger.candidateOnly,
        true,
        'REVIEW_CANDIDATE_GAP_LEDGER_CURRENTNESS_INVALID',
      );
      array(gapLedger.gaps, 'REVIEW_CANDIDATE_GAP_LEDGER_INVALID');
      const gapsByRef = new Map();
      gapLedger.gaps.forEach((gap, index) => {
        assertObject(gap, `review gap ${index}`);
        nonEmpty(gap.gapRef, 'REVIEW_CANDIDATE_GAP_LEDGER_INVALID');
        if (gapsByRef.has(gap.gapRef)) {
          fail('REVIEW_CANDIDATE_GAP_LEDGER_INVALID');
        }
        gapsByRef.set(gap.gapRef, gap);
      });
      dispositions.forEach((disposition) => {
        const gap = gapsByRef.get(disposition.gapRef);
        if (!gap) fail('REVIEW_CANDIDATE_DRAFT_GAP_NOT_ALLOWED');
        assertObject(gap.authority, 'review gap authority');
        if (
          gap.authority.owner !== 'CANONICAL_HOST' ||
          gap.authority.modelMayClose !== false
        ) {
          fail('REVIEW_CANDIDATE_DRAFT_GAP_NOT_RESOLVABLE');
        }
        assertSubsetOf(
          disposition.evidenceRefs,
          allowedSources,
          'REVIEW_CANDIDATE_DISPOSITION_EVIDENCE_REF_NOT_ALLOWED',
        );
        equal(
          disposition.disposition === 'RESOLVED_BY_EVIDENCE',
          draft.resolvedGapRefs.includes(disposition.gapRef),
          'REVIEW_CANDIDATE_DISPOSITION_RESOLUTION_MISMATCH',
        );
      });
      const selectedGaps = draft.resolvedGapRefs.map((gapRef) => {
        const gap = gapsByRef.get(gapRef);
        if (!gap) fail('REVIEW_CANDIDATE_DRAFT_GAP_NOT_ALLOWED');
        assertObject(gap.authority, 'review gap authority');
        if (
          gap.queryability !== 'REVIEW_QUERYABLE' ||
          gap.resolutionStatus === 'RESOLVED_BY_ENGINEER_REVIEW' ||
          gap.authority.owner !== 'CANONICAL_HOST' ||
          gap.authority.modelMayClose !== false
        ) {
          fail('REVIEW_CANDIDATE_DRAFT_GAP_NOT_RESOLVABLE');
        }
        uniqueTextArray(
          gap.affectedCriterionIds,
          'REVIEW_CANDIDATE_GAP_LEDGER_INVALID',
        );
        return gap;
      });
      if (draft.resolvedGapRefs.length > 0) {
        const affectedFromGaps = [
          ...new Set(selectedGaps.flatMap((gap) => gap.affectedCriterionIds)),
        ].sort();
        const affectedFromDraft = [...draft.affectedItemIds].sort();
        equal(
          canonicalJson(affectedFromGaps),
          canonicalJson(affectedFromDraft),
          'REVIEW_CANDIDATE_DRAFT_GAP_AFFECTED_ITEMS_MISMATCH',
        );
        const hasAttachmentEvidence = draft.sourceRefs.some((sourceRef) =>
          task.attachmentRefs.includes(sourceRef),
        );
        if (draft.adoptedInputRefs.length === 0 && !hasAttachmentEvidence) {
          fail('REVIEW_CANDIDATE_DRAFT_GAP_EVIDENCE_REQUIRED');
        }
      }
      if (snapshot.decisionMaturity === 'CONFIRMABLE') {
        const dispositionByGap = new Map(
          dispositions.map((value) => [value.gapRef, value.disposition]),
        );
        const uncontrolled = gapLedger.gaps.some(
          (gap) =>
            ['P0_DECISION_CRITICAL', 'P1_ACTION_CRITICAL'].includes(
              gap.materiality,
            ) &&
            gap.resolutionStatus !== 'RESOLVED_BY_ENGINEER_REVIEW' &&
            (dispositionByGap.get(gap.gapRef) === undefined ||
              dispositionByGap.get(gap.gapRef) === 'RESOLVE_NOW'),
        );
        if (uncontrolled) {
          fail('REVIEW_CANDIDATE_DECISION_SNAPSHOT_NOT_CONFIRMABLE');
        }
      }
    }
  }
  exactKeys(
    candidate.runtime,
    ['runtimeAppId', 'profileRef'],
    [],
    'review candidate runtime',
  );
  equal(
    candidate.runtime.runtimeAppId,
    WISELINK_RUNTIME_APP_ID,
    'REVIEW_CANDIDATE_RUNTIME_INVALID',
  );
  equal(
    candidate.runtime.profileRef,
    WISELINK_PROFILE_REF,
    'REVIEW_CANDIDATE_PROFILE_INVALID',
  );
  return candidate;
}

/** Frozen Matter bindings stay with the driver; none are projected as model input. */
function validateFrozenMatterReviewContext(value, resourceIds) {
  exactKeys(value, ['scope', 'title', 'workingState', 'readingEvidence', 'evidenceSources'], [], 'review matter context');
  nonEmpty(value.title, 'REVIEW_MATTER_TITLE_REQUIRED');
  const scope = value.scope;
  exactKeys(scope, ['schemaVersion', 'kind', 'matterId', 'basedOnMatterRevisionId', 'expectedWorkingRevision', 'targetClaimId', 'inputs'], [], 'review matter scope');
  equal(scope.schemaVersion, 'wiselink.3_1.matter_review_scope.v1', 'REVIEW_MATTER_SCOPE_INVALID');
  equal(scope.kind, 'ENGINEERING_MATTER', 'REVIEW_MATTER_SCOPE_INVALID');
  nonEmpty(scope.matterId, 'REVIEW_MATTER_SCOPE_INVALID');
  nonEmpty(scope.basedOnMatterRevisionId, 'REVIEW_MATTER_SCOPE_INVALID');
  integerInRange(scope.expectedWorkingRevision, 0, Number.MAX_SAFE_INTEGER, 'REVIEW_MATTER_SCOPE_INVALID');
  nullableText(scope.targetClaimId, 'REVIEW_MATTER_SCOPE_INVALID');
  validateMatterInputBindings(scope.inputs);
  if (scope.inputs.length === 0) fail('REVIEW_MATTER_SCOPE_INPUTS_REQUIRED');
  const inputs = new Set(scope.inputs.map((item) => item.inputId));
  const evidence = validateMatterEvidenceList(value.readingEvidence);
  array(value.evidenceSources, 'REVIEW_MATTER_EVIDENCE_SOURCES_INVALID');
  const evidenceSources = new Set();
  for (const source of value.evidenceSources) {
    exactKeys(source, ['evidenceRef', 'sourceRefId', 'inputId'], [], 'review matter evidence source');
    if (!evidence.has(source.evidenceRef) || !inputs.has(source.inputId) || !resourceIds.has(source.sourceRefId)) {
      fail('REVIEW_MATTER_EVIDENCE_BINDING_INVALID');
    }
    if (evidenceSources.has(source.evidenceRef)) fail('REVIEW_MATTER_EVIDENCE_SOURCE_DUPLICATE');
    evidenceSources.add(source.evidenceRef);
  }
  if (value.workingState !== null) {
    const state = value.workingState;
    exactKeys(state, ['schemaVersion', 'focus', 'substantiveResult', 'openQuestions', 'reviewConditions', 'substantiveInputs', 'coverage'], ['problemWork'], 'review matter working state');
    equal(state.schemaVersion, 'wiselink.3_1.engineering_matter_working_state.v1', 'REVIEW_MATTER_WORKING_STATE_INVALID');
    validateMatterFocus(state.focus);
    validateMatterTextItems(state.openQuestions);
    validateMatterTextItems(state.reviewConditions);
    validateMatterInputBindings(state.substantiveInputs);
    array(state.coverage, 'REVIEW_MATTER_COVERAGE_INVALID');
    const coveredInputs = new Set();
    for (const item of state.coverage) {
      exactKeys(item, ['binding', 'checkedSourceRefIds', 'checkedScope', 'contribution', 'reason'], [], 'review matter stored coverage');
      validateMatterInputBindings([item.binding]);
      validateMatterCoverageFields(item);
      if (coveredInputs.has(item.binding.inputId)) fail('REVIEW_MATTER_INPUT_COVERAGE_DUPLICATE');
      coveredInputs.add(item.binding.inputId);
    }
    if (state.substantiveResult !== null) {
      const result = state.substantiveResult;
      exactKeys(result, ['resultRef', 'resultRevision', 'scope', 'content', 'evidence', 'candidateOnly'], [], 'review matter reading result');
      nonEmpty(result.resultRef, 'REVIEW_MATTER_RESULT_REF_INVALID');
      positiveInteger(result.resultRevision, 'REVIEW_MATTER_RESULT_REVISION_INVALID');
      exactKeys(result.scope, ['kind', 'matterId'], [], 'review matter result scope');
      equal(result.scope.kind, 'ENGINEERING_MATTER', 'REVIEW_MATTER_RESULT_SCOPE_INVALID');
      equal(result.scope.matterId, scope.matterId, 'REVIEW_MATTER_RESULT_SCOPE_INVALID');
      equal(result.candidateOnly, true, 'REVIEW_MATTER_RESULT_AUTHORITY_INVALID');
      equal(result.content?.schemaVersion, 'wiselink.3_1.assessment_reading.v1', 'REVIEW_MATTER_READING_SCHEMA_INVALID');
      validateEngineeringReadingSummary(result.content);
      const priorEvidence = validateMatterEvidenceList(result.evidence);
      assertMatterClaimEvidence(result.content.claims, priorEvidence);
    }
  }
  matterReviewEvidence(value); // Reject a reused evidenceRef whose actual carrier changed.
}

function validateMatterInputBindings(values) {
  array(values, 'REVIEW_MATTER_INPUTS_INVALID');
  const inputIds = new Set();
  const workItemIds = new Set();
  for (const binding of values) {
    exactKeys(binding, ['inputId', 'workItemId', 'workItemRevision', 'documentVersionId', 'resultRef', 'resultRevision'], [], 'review matter input binding');
    for (const key of ['inputId', 'workItemId', 'documentVersionId']) nonEmpty(binding[key], 'REVIEW_MATTER_INPUT_INVALID');
    integerInRange(binding.workItemRevision, 0, Number.MAX_SAFE_INTEGER, 'REVIEW_MATTER_INPUT_REVISION_INVALID');
    nullableText(binding.resultRef, 'REVIEW_MATTER_INPUT_RESULT_INVALID');
    if (binding.resultRevision !== null) integerInRange(binding.resultRevision, 0, Number.MAX_SAFE_INTEGER, 'REVIEW_MATTER_INPUT_RESULT_INVALID');
    if ((binding.resultRef === null) !== (binding.resultRevision === null)) fail('REVIEW_MATTER_INPUT_RESULT_INVALID');
    if (inputIds.has(binding.inputId) || workItemIds.has(binding.workItemId)) fail('REVIEW_MATTER_INPUT_DUPLICATE');
    inputIds.add(binding.inputId);
    workItemIds.add(binding.workItemId);
  }
}

function validateMatterEvidenceList(values) {
  array(values, 'REVIEW_MATTER_EVIDENCE_INVALID');
  const evidence = new Map();
  for (const item of values) {
    assertObject(item, 'review matter evidence');
    const specific = {
      DOCUMENT_PASSAGE: ['workItemId', 'documentVersionId', 'sourceRefId', 'locator'],
      HOST_FACT: ['workItemId', 'workItemRevision', 'factRef', 'recordedAt'],
      QUERY_RECEIPT: ['receiptRef', 'checkedScope', 'queriedAt', 'coverage'],
      PRIOR_RESULT: ['resultRef', 'resultRevision', 'originalEvidenceRefs'],
      ENGINEER_STATEMENT: item.origin === 'REVIEW_CONVERSATION'
        ? ['origin', 'reviewConversationId', 'reviewTurnId', 'engineerSuppliedInputId', 'recordedAt']
        : ['origin', 'workItemId', 'reviewRevision', 'sequence', 'sourceRefId', 'locator', 'recordedAt'],
    }[item.kind];
    if (!specific) fail('REVIEW_MATTER_EVIDENCE_KIND_INVALID');
    exactKeys(item, ['evidenceRef', 'kind', 'title', 'versionLabel', 'excerpt', ...specific], [], 'review matter evidence');
    for (const key of ['evidenceRef', 'title', 'excerpt', ...specific]) {
      if (['workItemRevision', 'reviewRevision', 'resultRevision', 'sequence'].includes(key)) {
        integerInRange(item[key], 0, Number.MAX_SAFE_INTEGER, 'REVIEW_MATTER_EVIDENCE_REVISION_INVALID');
      } else if (key === 'originalEvidenceRefs') uniqueTextArray(item[key], 'REVIEW_MATTER_EVIDENCE_REFS_INVALID');
      else nonEmpty(item[key], 'REVIEW_MATTER_EVIDENCE_INVALID');
    }
    nullableText(item.versionLabel, 'REVIEW_MATTER_EVIDENCE_VERSION_INVALID');
    if (item.kind === 'ENGINEER_STATEMENT' && !['REVIEW_CONVERSATION', 'ENGINEER_REVIEW_LEDGER'].includes(item.origin)) fail('REVIEW_MATTER_STATEMENT_ORIGIN_INVALID');
    if (item.kind === 'QUERY_RECEIPT' && !['COMPLETE', 'PARTIAL'].includes(item.coverage)) fail('REVIEW_MATTER_QUERY_COVERAGE_INVALID');
    if (evidence.has(item.evidenceRef)) fail('REVIEW_MATTER_EVIDENCE_DUPLICATE');
    evidence.set(item.evidenceRef, item);
  }
  return evidence;
}

function matterReviewEvidence(context) {
  const evidence = new Map((context.workingState?.problemWork?.evidence ?? context.workingState?.substantiveResult?.evidence ?? []).map((item) => [item.evidenceRef, item]));
  for (const item of context.readingEvidence) {
    const prior = evidence.get(item.evidenceRef);
    if (prior && canonicalJson(prior) !== canonicalJson(item)) fail('REVIEW_MATTER_EVIDENCE_IDENTITY_DRIFT');
    evidence.set(item.evidenceRef, item);
  }
  return evidence;
}

function validateMatterFocus(value) {
  exactKeys(value, ['question', 'targetRefs'], [], 'review matter focus');
  nonEmpty(value.question, 'REVIEW_MATTER_FOCUS_QUESTION_REQUIRED');
  uniqueTextArray(value.targetRefs, 'REVIEW_MATTER_FOCUS_REFS_INVALID');
}

function validateMatterTextItems(values) {
  array(values, 'REVIEW_MATTER_TEXT_ITEMS_INVALID');
  const ids = new Set();
  for (const item of values) {
    exactKeys(item, ['itemId', 'text', 'basisRefs'], [], 'review matter text item');
    nonEmpty(item.itemId, 'REVIEW_MATTER_TEXT_ITEM_ID_REQUIRED');
    nonEmpty(item.text, 'REVIEW_MATTER_TEXT_REQUIRED');
    uniqueTextArray(item.basisRefs, 'REVIEW_MATTER_TEXT_BASIS_INVALID');
    if (ids.has(item.itemId)) fail('REVIEW_MATTER_TEXT_ITEM_DUPLICATE');
    ids.add(item.itemId);
  }
}

function validateMatterCoverageFields(value) {
  uniqueTextArray(value.checkedSourceRefIds, 'REVIEW_MATTER_CHECKED_RANGE_INVALID');
  if (value.checkedSourceRefIds.length === 0) fail('REVIEW_MATTER_CHECKED_RANGE_REQUIRED');
  nonEmpty(value.checkedScope, 'REVIEW_MATTER_CHECKED_SCOPE_REQUIRED');
  nonEmpty(value.reason, 'REVIEW_MATTER_COVERAGE_REASON_REQUIRED');
  if (!['SUBSTANTIVE', 'NO_MATERIAL_CHANGE'].includes(value.contribution)) fail('REVIEW_MATTER_COVERAGE_INVALID');
}

function assertMatterClaimEvidence(claims, evidence) {
  for (const claim of claims) {
    for (const premise of claim.premises) if (!evidence.has(premise.evidenceRef)) fail('REVIEW_MATTER_PREMISE_NOT_ALLOWED');
  }
}

function validateMatterWorkingDelta(task, value) {
  if (value === null) return;
  exactKeys(value, ['updateKind', 'changeSummary', 'nextFocus', 'claimDelta', 'readingPresentation', 'openQuestionDelta', 'reviewConditionDelta', 'coverageUpdates'], ['problemWork'], 'review matter delta');
  if (!['INITIAL_SYNTHESIS', 'CORRECTION', 'MATERIAL_INCORPORATION'].includes(value.updateKind)) fail('REVIEW_MATTER_UPDATE_KIND_INVALID');
  nonEmpty(value.changeSummary, 'REVIEW_MATTER_CHANGE_SUMMARY_REQUIRED');
  const context = task.matterContext;
  const current = context.workingState;
  let nextClaims = null;
  if (value.nextFocus !== null) validateMatterFocus(value.nextFocus);
  if ((value.claimDelta === null) !== (value.readingPresentation === null)) fail('REVIEW_MATTER_PRESENTATION_DELTA_REQUIRED');
  if (current === null && (value.updateKind !== 'INITIAL_SYNTHESIS' || value.nextFocus === null || (value.claimDelta === null && value.problemWork === undefined))) {
    fail('REVIEW_MATTER_INITIAL_SYNTHESIS_REQUIRED');
  }
  if (current !== null && value.updateKind === 'INITIAL_SYNTHESIS') fail('REVIEW_MATTER_UPDATE_KIND_INVALID');
  if (value.claimDelta !== null) {
    const delta = value.claimDelta;
    exactKeys(delta, ['changedBecause', 'additions', 'replacements', 'retirements', 'explicitlyUnchangedClaimIds'], [], 'review matter claim delta');
    nonEmpty(delta.changedBecause, 'REVIEW_MATTER_CLAIM_CHANGE_REASON_REQUIRED');
    array(delta.additions, 'REVIEW_MATTER_CLAIM_ADDITIONS_INVALID');
    array(delta.replacements, 'REVIEW_MATTER_CLAIM_REPLACEMENTS_INVALID');
    [...delta.additions, ...delta.replacements].forEach((claim) => assertObject(claim, 'review matter claim'));
    const priorClaims = current?.substantiveResult?.content.claims ?? [];
    validateMatterDeltaPartition({
      priorIds: priorClaims.map((claim) => claim.claimId),
      additionIds: delta.additions.map((claim) => claim.claimId),
      replacementIds: delta.replacements.map((claim) => claim.claimId),
      retirements: delta.retirements, unchangedIds: delta.explicitlyUnchangedClaimIds, idKey: 'claimId',
    });
    const replacements = new Map(delta.replacements.map((claim) => [claim.claimId, claim]));
    const retired = new Set(delta.retirements.map((claim) => claim.claimId));
    const claims = [...priorClaims.filter((claim) => !retired.has(claim.claimId)).map((claim) => replacements.get(claim.claimId) ?? claim), ...delta.additions];
    nextClaims = claims;
    exactKeys(value.readingPresentation, ['headline', 'listBrief', 'lead', 'decisiveClaimIds'], [], 'review matter reading presentation');
    validateEngineeringReadingSummary({ schemaVersion: 'wiselink.3_1.assessment_reading.v1', ...value.readingPresentation, claims });
    assertMatterClaimEvidence(claims, matterReviewEvidence(context));
  }
  if (value.problemWork !== undefined) {
    if (value.claimDelta !== null || value.readingPresentation !== null) fail('REVIEW_MATTER_PROBLEM_DUPLICATE_READING');
    validateJobAidWorkDelta(value.problemWork, current?.problemWork ?? null, [...matterReviewEvidence(context).values()]);
    const issues = new Map((current?.problemWork?.issues ?? []).map((issue) => [issue.issueKey, issue]));
    for (const retired of value.problemWork.retiredIssues ?? []) issues.delete(retired.issueKey);
    for (const issue of value.problemWork.issues) issues.set(issue.issueKey, issue);
    nextClaims = [...issues.values()].flatMap((issue) => issue.statements);
  }
  for (const [key, priorKey] of [['openQuestionDelta', 'openQuestions'], ['reviewConditionDelta', 'reviewConditions']]) {
    const delta = value[key];
    if (delta === null) continue;
    exactKeys(delta, ['upserts', 'retirements', 'explicitlyUnchangedItemIds'], [], 'review matter text delta');
    validateMatterTextItems(delta.upserts);
    const priorIds = (current?.[priorKey] ?? []).map((item) => item.itemId);
    validateMatterDeltaPartition({
      priorIds,
      additionIds: delta.upserts.filter((item) => !priorIds.includes(item.itemId)).map((item) => item.itemId),
      replacementIds: delta.upserts.filter((item) => priorIds.includes(item.itemId)).map((item) => item.itemId),
      retirements: delta.retirements, unchangedIds: delta.explicitlyUnchangedItemIds, idKey: 'itemId',
    });
  }
  array(value.coverageUpdates, 'REVIEW_MATTER_COVERAGE_INVALID');
  const inputBindings = new Map(context.scope.inputs.map((binding, index) => ['matter-input:' + (index + 1), binding]));
  const sourceBindings = new Map(context.evidenceSources.map((item) => [item.sourceRefId, item]));
  const sourcesByEvidence = new Map(context.evidenceSources.map((item) => [item.evidenceRef, item]));
  const evidence = matterReviewEvidence(context);
  const usedEvidenceRefs = new Set(nextClaims?.flatMap((claim) => claim.premises.map((premise) => premise.evidenceRef)) ?? []);
  const nextEvidence = nextClaims === null ? null : [...evidence.values()].filter((item) => usedEvidenceRefs.has(item.evidenceRef));
  const resultEvidence = nextEvidence ?? current?.substantiveResult?.evidence ?? [];
  const coverageByInputId = new Map((current?.coverage ?? []).map((item) => [item.binding.inputId, item]));
  const covered = new Set();
  for (const item of value.coverageUpdates) {
    exactKeys(item, ['inputRef', 'checkedSourceRefIds', 'checkedScope', 'contribution', 'reason'], [], 'review matter coverage');
    validateMatterCoverageFields(item);
    const binding = inputBindings.get(item.inputRef);
    if (!binding) fail('REVIEW_MATTER_COVERAGE_INPUT_NOT_ALLOWED');
    if (covered.has(item.inputRef)) fail('REVIEW_MATTER_INPUT_COVERAGE_DUPLICATE');
    covered.add(item.inputRef);
    const checkedSourceRefIds = item.checkedSourceRefIds.map((sourceRefId) => {
      const source = sourceBindings.get(sourceRefId);
      if (source?.inputId !== binding.inputId) fail('REVIEW_MATTER_COVERAGE_SOURCE_NOT_ALLOWED');
      const carrier = evidence.get(source.evidenceRef);
      if (carrier?.kind !== 'DOCUMENT_PASSAGE') fail('REVIEW_MATTER_COVERAGE_DOCUMENT_REQUIRED');
      return carrier.sourceRefId;
    });
    if (item.contribution === 'SUBSTANTIVE' && !resultEvidence.some((carrier) =>
      sourcesByEvidence.get(carrier.evidenceRef)?.inputId === binding.inputId)) fail('REVIEW_MATTER_SUBSTANTIVE_INPUT_UNUSED');
    coverageByInputId.set(binding.inputId, { ...item, binding, checkedSourceRefIds });
  }
  if (nextEvidence !== null) {
    // Match Host materialization: resolving a passage and declaring the
    // result's checked coverage are separate. Retained claims also need their
    // original, document-bound coverage after a local correction.
    const contributingIds = new Set(nextEvidence.map((item) => sourcesByEvidence.get(item.evidenceRef)?.inputId));
    const substantiveInputs = context.scope.inputs.filter((binding) => contributingIds.has(binding.inputId));
    for (const binding of substantiveInputs) {
      const item = coverageByInputId.get(binding.inputId);
      if (!item || item.contribution !== 'SUBSTANTIVE' || canonicalJson(item.binding) !== canonicalJson(binding)) {
        fail('REVIEW_MATTER_SUBSTANTIVE_INPUT_NOT_COVERED');
      }
    }
    for (const carrier of nextEvidence) {
      if (carrier.kind !== 'DOCUMENT_PASSAGE') continue;
      const binding = substantiveInputs.find((item) => item.workItemId === carrier.workItemId && item.documentVersionId === carrier.documentVersionId);
      if (!binding) fail('REVIEW_MATTER_DOCUMENT_EVIDENCE_INPUT_MISSING');
      if (!coverageByInputId.get(binding.inputId).checkedSourceRefIds.includes(carrier.sourceRefId)) {
        fail('REVIEW_MATTER_DOCUMENT_EVIDENCE_NOT_CHECKED');
      }
    }
  }
}

function validateMatterDeltaPartition({ priorIds, additionIds, replacementIds, retirements, unchangedIds, idKey }) {
  array(retirements, 'REVIEW_MATTER_RETIREMENTS_INVALID');
  for (const item of retirements) {
    exactKeys(item, [idKey, 'reason'], [], 'review matter retirement');
    nonEmpty(item.reason, 'REVIEW_MATTER_RETIREMENT_REASON_REQUIRED');
  }
  const retirementIds = retirements.map((item) => item[idKey]);
  const partitions = [additionIds, replacementIds, retirementIds, unchangedIds];
  for (const ids of partitions) uniqueTextArray(ids, 'REVIEW_MATTER_DELTA_IDS_INVALID');
  const all = partitions.flat();
  if (new Set(all).size !== all.length) fail('REVIEW_MATTER_DELTA_OVERLAP');
  const prior = new Set(priorIds);
  if (additionIds.some((id) => prior.has(id))) fail('REVIEW_MATTER_ADDITION_EXISTS');
  if ([...replacementIds, ...retirementIds, ...unchangedIds].some((id) => !prior.has(id))) fail('REVIEW_MATTER_EXISTING_ID_REQUIRED');
  const retained = new Set([...replacementIds, ...retirementIds, ...unchangedIds]);
  if (priorIds.some((id) => !retained.has(id))) fail('REVIEW_MATTER_CARRY_FORWARD_INCOMPLETE');
}

function jobAidDeltaEvidenceRefs(delta) {
  return jobAidDeltaEvidenceEntries(delta).map((entry) => entry.evidenceRef);
}
function jobAidDeltaEvidenceEntries(delta) {
  const entries = [];
  const add = (path, evidenceRef) => entries.push({ path, evidenceRef });
  const refs = (path, values) => (values ?? []).forEach((ref, index) => add(`${path}[${index}]`, ref));
  (delta?.issues ?? []).forEach((issue, index) => {
    const path = `jobAidWorkingDelta.issues[${index}]`;
    refs(`${path}.sourceDependencies`, issue.sourceDependencies);
    refs(`${path}.premiseRefs`, issue.premiseRefs);
    (issue.statements ?? []).forEach((claim, ci) => (claim.premises ?? []).forEach((premise, pi) =>
      add(`${path}.statements[${ci}].premises[${pi}].evidenceRef`, premise.evidenceRef)));
    (issue.riskScenarios ?? []).forEach((risk, ri) => {
      for (const key of ['severity', 'likelihood', 'importantEvent'])
        refs(`${path}.riskScenarios[${ri}].${key}.basisRefs`, risk[key]?.basisRefs);
    });
    for (const key of ['measures', 'otherClassifications', 'requirementHandling']) {
      (issue[key] ?? []).forEach((item, ii) => {
        if (key === 'requirementHandling') add(`${path}.${key}[${ii}].methodRef`, item.methodRef);
        refs(`${path}.${key}[${ii}].basisRefs`, item.basisRefs);
      });
    }
  });
  return entries;
}
function validateFrozenJobAidReviewContext(task) {
  const jobAid = task.jobAidContext;
  assertObject(jobAid, 'REVIEW_JOBAID_CONTEXT_REQUIRED');
  equal(jobAid.schemaVersion, 'wiselink.jobaid-problem-task.v2', 'REVIEW_JOBAID_CONTEXT_INVALID');
  equal(jobAid.modelInput?.purpose, 'PROBLEM_REVIEW', 'REVIEW_JOBAID_CONTEXT_INVALID');
  equal(canonicalJson(task.context.problemAssessment), canonicalJson(jobAid.modelInput), 'REVIEW_JOBAID_MODEL_CONTEXT_DRIFT');
  if (task.selectedEvaluationItemId !== null || task.allowedEvaluationItemIds.length || task.allowedAdoptedInputRefs.length) fail('REVIEW_JOBAID_EVALUATION_SCOPE_INVALID');
  array(jobAid.sourceCatalog, 'REVIEW_JOBAID_SOURCE_CATALOG_REQUIRED');
  array(jobAid.sourceBindings, 'REVIEW_JOBAID_SOURCE_BINDINGS_REQUIRED');
  const refs = jobAid.sourceCatalog.map((item) => item.evidenceRef);
  uniqueTextArray(refs, 'REVIEW_JOBAID_SOURCE_CATALOG_INVALID');
  uniqueTextArray(jobAid.initiallyDeliveredRefs, 'REVIEW_JOBAID_DELIVERED_REFS_INVALID');
  assertSubsetOf(jobAid.initiallyDeliveredRefs, new Set(refs), 'REVIEW_JOBAID_DELIVERED_REF_NOT_REGISTERED');
  const delivered = jobAid.sourceCatalog.filter((item) => jobAid.initiallyDeliveredRefs.includes(item.evidenceRef)).map((item) => ({
    evidenceRef: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel, excerpt: item.excerpt, locator: item.locator ?? null,
  }));
  equal(canonicalJson(delivered), canonicalJson(jobAid.modelInput.deliveredEvidence), 'REVIEW_JOBAID_DELIVERED_EVIDENCE_DRIFT');
  for (const resource of task.resourceRefs) {
    const item = jobAid.sourceCatalog.find((entry) => entry.evidenceRef === resource.sourceRefId);
    if (!item || !['DOCUMENT_PASSAGE', 'ENGINEER_ATTACHMENT'].includes(item.kind)) fail('REVIEW_JOBAID_RESOURCE_BINDING_INVALID');
    const binding = item.kind === 'DOCUMENT_PASSAGE' ? jobAid.sourceBindings.find((entry) => entry.workItemId === item.workItemId) : item;
    if (!binding || resource.resourceArtifactRef !== binding.artifactRef || resource.resourceArtifactSha256 !== binding.artifactSha256) fail('REVIEW_JOBAID_RESOURCE_BINDING_INVALID');
    equal(canonicalJson(resource.value), canonicalJson({ evidenceRef: item.evidenceRef, kind: item.kind, title: item.title, versionLabel: item.versionLabel,
      excerpt: item.excerpt, locator: item.locator ?? null, sourceRefId: item.evidenceRef }), 'REVIEW_JOBAID_RESOURCE_BINDING_INVALID');
  }
}
function validateJobAidReviewDelta(task, delta) {
  if (delta === null) return;
  return validateJobAidWorkDelta(delta, task.jobAidContext.previousWork?.content ?? null, task.jobAidContext.sourceCatalog);
}

function validateJobAidWorkDelta(delta, previousContent, sourceCatalog) {
  assertObject(delta, 'REVIEW_JOBAID_DELTA_INVALID');
  equal(delta.schemaVersion, 'wiselink.jobaid-problem-work.v2', 'REVIEW_JOBAID_WORK_SCHEMA_INVALID');
  for (const key of ['headline', 'listBrief', 'understanding', 'completionReason', 'changeSummary', 'unchangedExplanation']) nonEmpty(delta[key], `REVIEW_JOBAID_${key.toUpperCase()}_REQUIRED`);
  array(delta.issues, 'REVIEW_JOBAID_ISSUES_REQUIRED');
  // Match Host's existing omission semantics, without normalizing a supplied
  // malformed collection or inferring which prior issues remain unchanged.
  const unchanged = delta.unchangedIssueKeys === undefined ? [] : delta.unchangedIssueKeys;
  const retired = delta.retiredIssues === undefined ? [] : delta.retiredIssues;
  uniqueTextArray(unchanged, 'REVIEW_JOBAID_UNCHANGED_INVALID');
  array(retired, 'REVIEW_JOBAID_RETIREMENTS_INVALID');
  const prior = previousContent?.issues.map((issue) => issue.issueKey) ?? [];
  const keys = [...delta.issues.map((issue) => issue.issueKey), ...unchanged, ...retired.map((issue) => issue.issueKey)];
  uniqueTextArray(keys, 'REVIEW_JOBAID_ISSUE_PARTITION_INVALID');
  if (prior.some((key) => !keys.includes(key)) || [...unchanged, ...retired.map((issue) => issue.issueKey)].some((key) => !prior.includes(key))) fail('REVIEW_JOBAID_PRIOR_ISSUE_OMITTED');
  const allowed = new Set(sourceCatalog.map((item) => item.evidenceRef));
  const invalid = jobAidDeltaEvidenceEntries(delta).filter((entry) => !allowed.has(entry.evidenceRef));
  if (invalid.length) {
    const error = new Error('REVIEW_JOBAID_EVIDENCE_NOT_REGISTERED');
    // Exact failing locations help the model correct copied identifiers. Never
    // infer a replacement or mutate the rejected candidate.
    error.invalidEvidenceRefs = invalid.slice(0, 32);
    error.invalidEvidenceRefCount = invalid.length;
    throw error;
  }
}

/** Source keys used by the candidate include changed Matter claims and checked ranges. */
export function reviewCandidateSourceRefIds(task, candidate) {
  const refs = [...candidate.sourceRefs, ...candidate.candidateEvidenceRefs, ...(candidate.reviewActionDraft?.sourceRefs ?? [])];
  if (task.schemaVersion === REVIEW_MATTER_TASK_SCHEMA && candidate.matterWorkingDelta !== null) {
    const delta = candidate.matterWorkingDelta;
    const evidence = matterReviewEvidence(task.matterContext);
    const sources = new Map(task.matterContext.evidenceSources.map((item) => [item.evidenceRef, item.sourceRefId]));
    for (const claim of [...(delta.claimDelta?.additions ?? []), ...(delta.claimDelta?.replacements ?? [])]) {
      for (const premise of claim.premises) {
        if (evidence.get(premise.evidenceRef)?.kind !== 'DOCUMENT_PASSAGE') continue;
        const sourceRefId = sources.get(premise.evidenceRef);
        if (!sourceRefId) fail('REVIEW_MATTER_CHANGED_CLAIM_SOURCE_NOT_AVAILABLE');
        refs.push(sourceRefId);
      }
    }
    if (delta.problemWork) {
      const previousReads = new Set(task.matterContext.workingState?.problemWork?.readSourceRefs ?? []);
      for (const ref of jobAidDeltaEvidenceRefs(delta.problemWork)) {
        if (evidence.get(ref)?.kind !== 'DOCUMENT_PASSAGE' || previousReads.has(ref)) continue;
        const sourceRef = sources.get(ref);
        if (!sourceRef) fail('REVIEW_MATTER_CHANGED_CLAIM_SOURCE_NOT_AVAILABLE');
        refs.push(sourceRef);
      }
    }
    refs.push(...delta.coverageUpdates.flatMap((item) => item.checkedSourceRefIds));
  }
  if (task.schemaVersion === REVIEW_JOBAID_TASK_SCHEMA && candidate.jobAidWorkingDelta) {
    const provided = new Set(task.jobAidContext.initiallyDeliveredRefs);
    const resources = new Set(task.resourceRefs.map((item) => item.sourceRefId));
    refs.push(...jobAidDeltaEvidenceRefs(candidate.jobAidWorkingDelta).filter((ref) => resources.has(ref) && !provided.has(ref)));
  }
  return [...new Set(refs)];
}

function validateReviewUncertaintyDispositions(value) {
  array(value, 'REVIEW_CANDIDATE_DISPOSITIONS_INVALID');
  const seen = new Set();
  value.forEach((item, index) => {
    assertObject(item, `review uncertainty disposition ${index}`);
    exactKeys(
      item,
      [
        'gapRef',
        'disposition',
        'rationale',
        'assumptions',
        'controlsAndMitigations',
        'evidenceRefs',
        'reviewBy',
        'reopenTriggers',
      ],
      [],
      `review uncertainty disposition ${index}`,
    );
    nonEmpty(item.gapRef, 'REVIEW_CANDIDATE_DISPOSITION_INVALID');
    if (seen.has(item.gapRef)) {
      fail('REVIEW_CANDIDATE_DISPOSITION_DUPLICATE');
    }
    seen.add(item.gapRef);
    if (!REVIEW_UNCERTAINTY_DISPOSITIONS.has(item.disposition)) {
      fail('REVIEW_CANDIDATE_DISPOSITION_INVALID');
    }
    nonEmpty(item.rationale, 'REVIEW_CANDIDATE_DISPOSITION_INVALID');
    uniqueTextArray(item.assumptions, 'REVIEW_CANDIDATE_DISPOSITION_INVALID');
    uniqueTextArray(
      item.controlsAndMitigations,
      'REVIEW_CANDIDATE_DISPOSITION_INVALID',
    );
    uniqueTextArray(
      item.evidenceRefs,
      'REVIEW_CANDIDATE_DISPOSITION_INVALID',
    );
    nullableIsoText(item.reviewBy, 'REVIEW_CANDIDATE_DISPOSITION_INVALID');
    uniqueTextArray(
      item.reopenTriggers,
      'REVIEW_CANDIDATE_DISPOSITION_INVALID',
    );
    if (
      (item.disposition === 'ACCEPT_WITH_ASSUMPTION' &&
        item.assumptions.length === 0) ||
      (['APPLY_CONSERVATIVE_BOUND', 'MITIGATE_AND_MONITOR'].includes(
        item.disposition,
      ) &&
        item.controlsAndMitigations.length === 0) ||
      (['MITIGATE_AND_MONITOR', 'DEFER_TO_REVIEW_DATE'].includes(
        item.disposition,
      ) &&
        item.reviewBy === null) ||
      (item.disposition === 'RESOLVED_BY_EVIDENCE' &&
        item.evidenceRefs.length === 0)
    ) {
      fail('REVIEW_CANDIDATE_DISPOSITION_INCOMPLETE');
    }
  });
  return value;
}

function validateReviewDecisionSnapshot(value) {
  assertObject(value, 'review decision snapshot');
  exactKeys(
    value,
    [
      'assessmentAsOf',
      'evidenceHorizon',
      'currentBestJudgment',
      'alternativeJudgments',
      'decisionMaturity',
      'decisiveFacts',
      'assumptions',
      'residualUncertainties',
      'uncertaintyDispositions',
      'controlsAndMitigations',
      'monitoringPlan',
      'validUntil',
      'reviewBy',
      'reopenTriggers',
      'whatWouldChangeDecision',
      'candidateOnly',
    ],
    [],
    'review decision snapshot',
  );
  isoText(value.assessmentAsOf, 'REVIEW_CANDIDATE_SNAPSHOT_AS_OF_INVALID');
  uniqueTextArray(
    value.evidenceHorizon,
    'REVIEW_CANDIDATE_SNAPSHOT_INVALID',
  );
  if (value.evidenceHorizon.some((item) => !REVIEW_EVIDENCE_HORIZONS.has(item))) {
    fail('REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  }
  nonEmpty(value.currentBestJudgment, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  uniqueTextArray(
    value.alternativeJudgments,
    'REVIEW_CANDIDATE_SNAPSHOT_INVALID',
  );
  if (!REVIEW_DECISION_MATURITIES.has(value.decisionMaturity)) {
    fail('REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  }
  uniqueTextArray(value.decisiveFacts, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  uniqueTextArray(value.assumptions, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  uniqueTextArray(
    value.residualUncertainties,
    'REVIEW_CANDIDATE_SNAPSHOT_INVALID',
  );
  validateReviewUncertaintyDispositions(value.uncertaintyDispositions);
  uniqueTextArray(
    value.controlsAndMitigations,
    'REVIEW_CANDIDATE_SNAPSHOT_INVALID',
  );
  nullableText(value.monitoringPlan, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  nullableIsoText(value.validUntil, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  nullableIsoText(value.reviewBy, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  uniqueTextArray(value.reopenTriggers, 'REVIEW_CANDIDATE_SNAPSHOT_INVALID');
  uniqueTextArray(
    value.whatWouldChangeDecision,
    'REVIEW_CANDIDATE_SNAPSHOT_INVALID',
  );
  equal(value.candidateOnly, true, 'REVIEW_CANDIDATE_SNAPSHOT_AUTHORITY_INVALID');
  return value;
}

function isoText(value, code) {
  nonEmpty(value, code);
  if (!Number.isFinite(Date.parse(value))) fail(code);
}

function nullableIsoText(value, code) {
  if (value === null) return;
  isoText(value, code);
}

function validateEnvelopeRefs(value, code) {
  array(value, code);
  const seen = new Set();
  value.forEach((ref) => {
    assertObject(ref, 'action envelope ref');
    exactKeys(ref, ['ref', 'sha256'], [], 'action envelope ref');
    nonEmpty(ref.ref, code);
    match(ref.sha256, BARE_SHA256, code);
    const identity = `${ref.ref}\n${ref.sha256}`;
    if (seen.has(identity)) fail(code);
    seen.add(identity);
  });
}

function validateEnvelopeMissingInputs(value, code) {
  array(value, code);
  value.forEach((item) => {
    assertObject(item, 'action envelope missing input');
    exactKeys(item, ['code', 'message'], [], 'action envelope missing input');
    nonEmpty(item.code, code);
    nonEmpty(item.message, code);
  });
}

function assertEnvelopeSourceSubset(allowedRefs, returnedRefs) {
  const allowed = new Map(allowedRefs.map(({ ref, sha256 }) => [ref, sha256]));
  for (const item of returnedRefs) {
    if (allowed.get(item.ref) !== item.sha256) {
      fail('RESULT_ENVELOPE_SOURCE_REF_UNAUTHORIZED');
    }
  }
}

function uniqueTextArray(value, code) {
  arrayOfText(value, code);
  if (new Set(value).size !== value.length) fail(code);
}

function assertSubsetOf(values, allowlist, code) {
  if (values.some((value) => !allowlist.has(value))) fail(code);
}

function valueIds(values, key) {
  return values.map((value) => value[key]);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function rejectAuthorityInput(value, path = '$') {
  if (typeof value === 'string') {
    if (/\bWI-[A-Za-z0-9-]+\b/u.test(value))
      fail(`FORBIDDEN_WORKITEM_VALUE:${path}`);
    if (
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/iu.test(value) ||
      /\bX-Api-Key\b/iu.test(value) ||
      /\bapi[_ -]?key\s*[:=]/iu.test(value) ||
      /\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value) ||
      /\bcookie\s*[:=]/iu.test(value)
    ) {
      fail(`FORBIDDEN_CREDENTIAL_VALUE:${path}`);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      rejectAuthorityInput(child, `${path}[${index}]`),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenAuthorityInputKey(key))
      fail(`FORBIDDEN_AUTHORITY_INPUT:${path}.${key}`);
    rejectAuthorityInput(child, `${path}.${key}`);
  }
}

export function normalizeAuthorityInputKey(key) {
  return String(key)
    .normalize('NFKC')
    .replace(/[^a-z0-9]/giu, '')
    .toLowerCase();
}

export function isForbiddenAuthorityInputKey(key) {
  return FORBIDDEN_INPUT_KEYS.has(normalizeAuthorityInputKey(key));
}

function rejectAuthoritativeNarrative(output) {
  const narratives = [
    output.overallCandidate,
    ...engineeringSummaryStatements(output.engineeringSummary).map(
      (statement) => statement.text,
    ),
    ...output.findings.flatMap((finding) => [
      finding.finding,
      finding.basis,
      finding.uncertainty,
      ...finding.assumptions,
    ]),
  ];
  if (narratives.some(overallAuthoritativeAssertion)) {
    fail('OVERALL_AUTHORITATIVE_NARRATIVE_FORBIDDEN');
  }
}

function overallAuthoritativeAssertion(narrative) {
  const clauses = narrative.split(/[。！？；;\n]|(?<=[a-z])\.(?:\s|$)|[,，]|\b(?:but|therefore|however|thus)\b|(?:但是|但|因此|所以|故而)/iu);
  for (const clause of clauses) {
    const assertions = clause.matchAll(/(?:已确认|确认)(?:该)?(?:机队)?(?:不)?适用|(?:已批准|批准执行|批准放行|可直接实施|可以直接实施|形成适航结论)|\b(?:approved|airworthiness conclusion|confirmed applicable|confirmed inapplicable|safe to release)\b/giu);
    for (const match of assertions) {
      const prefix = clause.slice(0, match.index).trimEnd();
      const negated = /(?:尚未|并未|从未|没有|不是|并非|不代表|不等于|不得|不能|不可|未|不|无法)(?:被|获|获得|经|视为|认为)?[“"'‘「]?$/u.test(prefix)
        || /\b(?:not|never|no longer)(?:\s+(?:yet|been|be|being|considered|deemed|formally|already))*\s*["'“‘]?$/iu.test(prefix)
        || /\b(?:cannot|can't|does not|doesn't)\s+(?:be\s+)?(?:mean|imply|constitute|establish)(?:\s+(?:an?|that|it\s+is))?\s*["'“‘]?$/iu.test(prefix);
      if (negated) continue;
      const sourceAttributed = /(?:厂家|制造商|波音|空客|商飞|Boeing|Airbus|COMAC)(?:在[^。；;]{0,60})?(?:的[^。；;]{0,30})?(?:称|表示|声明|说明|写明|报告|原文|立场)[^。；;]{0,80}$/iu.test(prefix)
        || /\b(?:Boeing|Airbus|COMAC|(?:the\s+)?manufacturer)\s+(?:states?|reports?|says?|notes?|describes?|wrote|said|stated)(?:\s+that)?[^.;]{0,80}$/iu.test(prefix)
        || /\baccording to\s+(?:Boeing|Airbus|COMAC|(?:the\s+)?manufacturer)[^.;]{0,80}$/iu.test(prefix);
      if (!sourceAttributed) return true;
    }
  }
  return false;
}

function officialHost(providerName, hostname) {
  const host = hostname.toLowerCase();
  if (providerName === 'BOEING')
    return host === 'boeing.com' || host.endsWith('.boeing.com');
  if (providerName === 'AIRBUS')
    return host === 'airbus.com' || host.endsWith('.airbus.com');
  if (providerName === 'COMAC')
    return host === 'comac.cc' || host.endsWith('.comac.cc');
  return false;
}

function provider(value) {
  if (!PROVIDERS.has(value)) fail('DISCOVERY_PROVIDER_INVALID');
}

function exactKeys(value, required, optional, label) {
  assertObject(value, label);
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      fail(`${label.toUpperCase().replaceAll(' ', '_')}_UNKNOWN_FIELD:${key}`);
  for (const key of required)
    if (!(key in value))
      fail(`${label.toUpperCase().replaceAll(' ', '_')}_MISSING_FIELD:${key}`);
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label.toUpperCase().replaceAll(' ', '_')}_INVALID`);
}
function array(value, code) {
  if (!Array.isArray(value)) fail(code);
}
function arrayOfText(value, code) {
  array(value, code);
  if (value.some((item) => typeof item !== 'string' || item.trim() === ''))
    fail(code);
}
function nonEmpty(value, code) {
  if (typeof value !== 'string' || value.trim() === '') fail(code);
}
function nullableText(value, code) {
  if (value !== null && (typeof value !== 'string' || value.trim() === ''))
    fail(code);
}
function boolean(value, code) {
  if (typeof value !== 'boolean') fail(code);
}
function positiveInteger(value, code) {
  integerInRange(value, 1, Number.MAX_SAFE_INTEGER, code);
}
function integerInRange(value, min, max, code) {
  if (!Number.isInteger(value) || value < min || value > max) fail(code);
}
function equal(actual, expected, code) {
  if (actual !== expected) fail(code);
}
function match(value, pattern, code) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(code);
}
function sha256(value, code) {
  match(value, SHA256, code);
}
function isoDate(value, code) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(code);
}
function httpsUrl(value, code) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      fail(code);
    return parsed;
  } catch {
    fail(code);
  }
}
function fail(code) {
  throw new Error(code);
}

async function main() {
  const [kind, path] = process.argv.slice(2);
  if (!kind || !path) {
    process.stderr.write('usage: validate-payload.mjs <kind> <json-file>\n');
    process.exitCode = 2;
    return;
  }
  const value = JSON.parse(await readFile(path, 'utf8'));
  validatePayload(kind, value);
  process.stdout.write(`VALID:${kind}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
