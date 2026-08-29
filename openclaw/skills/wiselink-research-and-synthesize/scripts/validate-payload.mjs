#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const WISELINK_SKILL_VERSION = 'wiselink-research-and-synthesize@r09.c4';
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
const REVIEW_CANDIDATE_SCHEMA = 'wiselink.3_1.review_turn_candidate.v1.c2';
const APPLICABILITY_TASK_SCHEMA = 'wiselink.3_1.applicability_task.v1';
const APPLICABILITY_AST_CANDIDATE_SCHEMA =
  'wiselink.3_1.applicability_ast_candidate.v1';
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
/** Keep these two patterns aligned with the current Host ResultGate. */
const ATA_CHAPTER_PATTERN = /\b\d{2,3}(?:-\d{2,3})?\b/;
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
    [],
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
  const knownRefs = new Set(context.sourceRefs.map((item) => item.sourceRefId));
  for (const finding of output.findings) {
    for (const sourceRefId of finding.sourceRefIds) {
      if (!knownRefs.has(sourceRefId))
        fail(`OVERALL_UNKNOWN_SOURCE_REF:${sourceRefId}`);
    }
  }
  validateEngineeringSummaryBindings(
    output.engineeringSummary,
    knownRefs,
    new Set(context.currentDocumentSourceRefIds),
  );
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
      'baseRuleResult',
      'unifiedSourceContext',
      'adoptedDocumentVersions',
      'externalDiscoveryResults',
      'engineerReviewContext',
      'selectiveResynthesis',
    ],
    [],
    'synthesis input',
  );
  equal(
    input.operation,
    'SYNTHESIZE_OVERALL_CANDIDATE',
    'SYNTHESIS_OPERATION_INVALID',
  );
  nonEmpty(input.outputCorrelationRef, 'SYNTHESIS_CORRELATION_INVALID');
  validateBaseRuleResult(input.baseRuleResult);
  validateUnifiedSourceContext(input.unifiedSourceContext);
  validateAdoptedDocumentVersions(input.adoptedDocumentVersions);
  validateEngineerReviewContext(input.engineerReviewContext);
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
  sha256(context.artifactSha256, 'ENGINEER_REVIEW_ARTIFACT_SHA_INVALID');
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

function validateEngineerReviewEntry(review, expectedSequence = undefined) {
  assertObject(review, 'engineer review entry');
  exactKeys(
    review,
    ['sequence', 'criterionId', 'decision', 'status', 'comment', 'recordedAt'],
    [],
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
  const expectedStatus = ['confirmed_pass', 'confirmed_fail'].includes(
    review.decision,
  )
    ? 'ENGINEER_CONFIRMED'
    : 'NEEDS_REVIEW';
  equal(review.status, expectedStatus, 'ENGINEER_REVIEW_STATUS_INVALID');
  nonEmpty(review.comment, 'ENGINEER_REVIEW_COMMENT_INVALID');
  isoDate(review.recordedAt, 'ENGINEER_REVIEW_RECORDED_AT_INVALID');
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
      match(sourceRefId, SOURCE_REF_ID, 'BASE_SOURCE_REF_INVALID');
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
      [],
      'source ref',
    );
    match(
      sourceRef.sourceRefId,
      SOURCE_REF_ID,
      'SOURCE_CONTEXT_REF_ID_INVALID',
    );
    if (seen.has(sourceRef.sourceRefId))
      fail(`SOURCE_CONTEXT_DUPLICATE_REF:${sourceRef.sourceRefId}`);
    seen.add(sourceRef.sourceRefId);
    nonEmpty(sourceRef.locator, 'SOURCE_CONTEXT_LOCATOR_INVALID');
    nullableText(sourceRef.excerpt, 'SOURCE_CONTEXT_EXCERPT_INVALID');
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
    sha256(
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
  equal(
    output.overallCandidate,
    output.engineeringSummary.conclusion.text,
    'OVERALL_CONCLUSION_CANDIDATE_MISMATCH',
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
      match(sourceRefId, SOURCE_REF_ID, 'OVERALL_SOURCE_REF_INVALID');
    arrayOfText(finding.assumptions, 'OVERALL_ASSUMPTIONS_INVALID');
    nonEmpty(finding.uncertainty, 'OVERALL_UNCERTAINTY_INVALID');
  }
  arrayOfText(output.missingInputs, 'OVERALL_MISSING_INPUTS_INVALID');
  if (
    !['UNKNOWN/WAITING_INPUT', 'CANDIDATE_REVIEW_REQUIRED'].includes(
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
    match(sourceRefId, SOURCE_REF_ID, `${code}_SOURCE_REF_INVALID`),
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
      'sourceExpressions',
      'bilingualSourceUnits',
      'runtimePolicy',
      'authority',
    ],
    [],
    'applicability input',
  );
  equal(
    input.schemaVersion,
    APPLICABILITY_TASK_SCHEMA,
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
  validateApplicabilitySourceExpressions(input.sourceExpressions);
  validateApplicabilityBilingualUnits(input.bilingualSourceUnits);
  validateApplicabilityRuntimePolicy(input.runtimePolicy);
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
    validateApplicabilityAstNode(expression.expressionAst);
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
    WISELINK_SKILL_VERSION,
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

function validateApplicabilityAstNode(value) {
  assertObject(value, 'applicability AST node');
  nonEmpty(value.type, 'APPLICABILITY_AST_TYPE_REQUIRED');
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
    return;
  }
  if (value.type === 'and' || value.type === 'or') {
    exactKeys(value, ['type', 'children'], [], 'applicability AST group');
    array(value.children, 'APPLICABILITY_AST_CHILDREN_INVALID');
    if (value.children.length < 1) fail('APPLICABILITY_AST_CHILDREN_INVALID');
    value.children.forEach(validateApplicabilityAstNode);
    return;
  }
  if (value.type === 'not') {
    exactKeys(value, ['type', 'child'], [], 'applicability AST not');
    validateApplicabilityAstNode(value.child);
    return;
  }
  fail('APPLICABILITY_AST_TYPE_UNSUPPORTED');
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
    [],
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
    [],
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
        deterministic: input.rulePack.deterministic,
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

function translationFidelityFindings({
  unitKey,
  sourceText,
  candidateText,
  deterministic,
}) {
  const findings = [];
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

  if (deterministic.preserveAtaChapterNumbers) {
    const ataMatches = sourceText.match(ATA_CHAPTER_PATTERN) ?? [];
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
  return findings;
}

function sourceNumbers(text) {
  // A sign is semantic only at a token boundary. In A-12 or 2026-08-28 the
  // hyphen is an identifier/date connector, so the following number is unsigned.
  return (
    text.match(
      /(?<![\p{L}\p{N}_])[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu,
    ) ?? []
  );
}

function numberMultiset(tokens) {
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function validateReviewTask(value) {
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
    ],
    [],
    'review task',
  );
  equal(
    value.schemaVersion,
    REVIEW_TASK_SCHEMA,
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
    WISELINK_SKILL_VERSION,
    'REVIEW_TASK_SKILL_POLICY_INVALID',
  );
  equal(
    value.executionPolicy.toolPolicyRef,
    `${WISELINK_HOST_MCP_NAME}@${WISELINK_HOST_MCP_VERSION}#interactive-review-c2`,
    'REVIEW_TASK_TOOL_POLICY_INVALID',
  );
  return value;
}

export function validateReviewCandidate(task, candidate) {
  validateReviewTask(task);
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
    ],
    [],
    'review candidate',
  );
  equal(
    candidate.schemaVersion,
    REVIEW_CANDIDATE_SCHEMA,
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
  if (!REVIEW_RESPONSE_TYPES.has(candidate.responseType)) {
    fail('REVIEW_CANDIDATE_RESPONSE_TYPE_UNSUPPORTED_BY_C2');
  }
  nonEmpty(candidate.answer, 'REVIEW_CANDIDATE_ANSWER_REQUIRED');
  uniqueTextArray(candidate.sourceRefs, 'REVIEW_CANDIDATE_SOURCE_REFS_INVALID');
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
        'adoptedInputRefs',
        'sourceRefs',
        'assumptions',
        'affectedItemIds',
        'overallImpact',
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
  const text = [
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
  ].join('\n');
  const forbidden = [
    /(?:已确认|确认)(?:该)?(?:机队)?适用/u,
    /(?:已确认|确认)(?:该)?(?:机队)?不适用/u,
    /(?:已批准|批准执行|批准放行|可直接实施|可以直接实施)/u,
    /形成适航结论/u,
    /\b(?:approved|airworthiness conclusion|confirmed applicable|confirmed inapplicable|safe to release)\b/iu,
  ];
  if (forbidden.some((pattern) => pattern.test(text))) {
    fail('OVERALL_AUTHORITATIVE_NARRATIVE_FORBIDDEN');
  }
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
