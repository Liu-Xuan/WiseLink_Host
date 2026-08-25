import { Injectable } from '@nestjs/common';

import type { ControlledAilyHolisticDynamicInput } from './aily-holistic-assessment';

export const BASE_ONE_SHOT_PURPOSE =
  'ONE_SHOT_JOB_AID_DYNAMIC_N_CANDIDATE' as const;

export interface BaseOneShotCorrelation {
  transportId: string;
  workItemId: string;
  actionAttemptId: string;
  expectedRevision: number;
  documentVersionId: string;
}

export interface BaseOneShotAssessmentPacket {
  purpose: typeof BASE_ONE_SHOT_PURPOSE;
  correlation: BaseOneShotCorrelation;
  operatorInstruction: string[];
  subjectContext: {
    documentIdentity: Record<string, unknown>;
    assessmentAsOf: string;
    unifiedParsedPackage: Record<string, unknown>;
    parsedResult: Record<string, unknown>;
    controlledContext: Record<string, unknown>;
    sourceDerivation: Record<string, unknown>;
    publicPackageCoverage: {
      resultStatus: string;
      contentUnitCount: number;
      sourceRefCount: number;
      applicabilitySourceExpressions: unknown[];
    };
  };
  jobAidContext: {
    identity: Record<string, unknown>;
    currentAssessment: Record<string, any>;
    structuredAssessmentContext: unknown;
    resourceSummary: Record<string, number>;
    criterionTable: {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
      valueDictionaries?: Record<string, unknown[]>;
    };
    missingInformationProjection: {
      sourceColumn: 'missingInformation';
      projectedColumn: 'missingPredicateKeys';
      fullDescriptionsOwnedByCanonicalHost: true;
      modelMayInventMissingInputs: false;
    };
    resourceTable: Record<string, any>;
    sourceEvidenceCatalog: Record<string, any>;
    auxiliaryContext: Record<string, unknown>;
    authorityBoundary: Record<string, unknown>;
  };
  expectedSelfCheck: Record<string, unknown>;
  responseInstruction: Record<string, unknown>;
}

export interface BaseOneShotAssessmentResult {
  correlation: BaseOneShotCorrelation;
  authorityLevel: 'candidate_only';
  engineeringConclusion: null;
  applicabilityOverall: string;
  ruleResults: Array<Record<string, unknown>>;
  overallSelfCheck: Record<string, unknown>;
  nextRoundChecklist: unknown[];
  completionSelfCheck: Record<string, unknown>;
  criterionCount: number;
}

const SOURCE_CRITERION_COLUMNS = [
  'sequence',
  'criterionId',
  'question',
  'predicateResult',
  'normativeForce',
  'status',
  'candidateConclusion',
  'missingInformation',
  'sourceEvidenceCandidateIds',
  'engineerReview',
];

const PACKET_CRITERION_COLUMNS = SOURCE_CRITERION_COLUMNS.map((column) =>
  column === 'missingInformation' ? 'missingPredicateKeys' : column);

export const BASE_ONE_SHOT_RULE_RESULT_FIELDS = [
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
const RULE_RESULT_FIELDS = BASE_ONE_SHOT_RULE_RESULT_FIELDS;

const BASE_ONE_SHOT_OUTPUT_MAX_UTF8_BYTES = 60_000;
const BASE_ONE_SHOT_RULE_RESULT_ROW_MAX_UTF8_BYTES = 400;
const BASE_ONE_SHOT_NEXT_ROUND_MAX_ITEMS = 12;
const BASE_ONE_SHOT_NEXT_ROUND_ITEM_MAX_UTF8_BYTES = 400;
const BASE_ONE_SHOT_OUTPUT_ENVELOPE_RESERVE_UTF8_BYTES = 6_000;

/**
 * Ordinary in-process adapter for one Feishu Base AI-field invocation. Base is
 * only the model-processing plane: the canonical host owns WorkItem state and
 * supplies the already fresh-read correlation.
 */
@Injectable()
export class BaseOneShotAssessmentProcessor {
  buildPacket(
    assessmentInput: Record<string, unknown>,
    input: ControlledAilyHolisticDynamicInput,
    correlation: BaseOneShotCorrelation,
  ): BaseOneShotAssessmentPacket {
    return buildBaseOneShotAssessmentPacket(
      assessmentInput,
      input,
      correlation,
    );
  }

  consumeResult(
    packet: BaseOneShotAssessmentPacket,
    output: string,
  ): BaseOneShotAssessmentResult {
    return consumeBaseOneShotAssessmentResult(packet, output);
  }
}

export function buildBaseOneShotAssessmentPacket(
  assessmentInput: Record<string, unknown>,
  input: ControlledAilyHolisticDynamicInput,
  correlation: BaseOneShotCorrelation,
): BaseOneShotAssessmentPacket {
  assertCorrelation(correlation);
  const subject = structuredClone(assessmentInput) as Record<string, any>;
  if (subject.schemaVersion !== 'wiselink.v3_1.sb_job_aid_assessment_input.v4') {
    throw new Error('BASE_ONE_SHOT_ASSESSMENT_INPUT_SCHEMA_INVALID');
  }
  if (subject.documentIdentity?.revisionId !== correlation.documentVersionId) {
    throw new Error('BASE_ONE_SHOT_DOCUMENT_VERSION_MISMATCH');
  }
  const observation = subject.publicPackageObservation;
  if (
    !observation ||
    !Number.isInteger(observation.contentUnitCount) ||
    observation.contentUnitCount < 1 ||
    observation.contentUnitIds?.length !== observation.contentUnitCount ||
    !Number.isInteger(observation.sourceRefCount) ||
    observation.sourceRefCount < 1 ||
    !Array.isArray(observation.pageSourceRefs) ||
    observation.pageSourceRefs.length < 1 ||
    !Array.isArray(observation.applicabilitySourceExpressions)
  ) {
    throw new Error('BASE_ONE_SHOT_ASSESSMENT_INPUT_COVERAGE_INVALID');
  }
  const context = input.evaluationContext;
  const criterionTable = context.criterionTable;
  const resourceTable = context.resourceTable;
  const criterionIndexes = SOURCE_CRITERION_COLUMNS.map((column) => {
    const index = criterionTable.columns.indexOf(column);
    if (index < 0) {
      throw new Error(`BASE_ONE_SHOT_CRITERION_COLUMN_MISSING:${column}`);
    }
    return index;
  });
  const missingInformationIndex = SOURCE_CRITERION_COLUMNS.indexOf(
    'missingInformation',
  );
  const criterionRows = criterionTable.rows.map((row) =>
    criterionIndexes.map((index, packetIndex) => {
      const value = row[index];
      return packetIndex === missingInformationIndex
        ? projectMissingPredicateKeys(value)
        : value;
    }));
  const expectedCount = context.manifest.jobAidRuleSet.criteriaCount;
  if (
    !Number.isInteger(expectedCount) ||
    expectedCount < 1 ||
    criterionRows.length !== expectedCount ||
    resourceTable.rows.length !== expectedCount
  ) {
    throw new Error(
      `BASE_ONE_SHOT_DYNAMIC_COUNT_MISMATCH:${criterionRows.length}:` +
      `${resourceTable.rows.length}:${expectedCount}`,
    );
  }
  const criterionIdIndex = PACKET_CRITERION_COLUMNS.indexOf('criterionId');
  const criterionIds = criterionRows.map((row) => String(row[criterionIdIndex]));
  if (new Set(criterionIds).size !== expectedCount) {
    throw new Error('BASE_ONE_SHOT_CRITERION_IDS_NOT_UNIQUE');
  }

  const manifest = context.manifest;
  const upstreamPackage = subject.upstreamBinding?.unifiedParsedPackage;
  if (!upstreamPackage || typeof upstreamPackage !== 'object') {
    throw new Error('BASE_ONE_SHOT_UNIFIED_PACKAGE_BINDING_REQUIRED');
  }
  const boundedUnifiedPackage = structuredClone(
    upstreamPackage,
  ) as Record<string, unknown>;
  delete boundedUnifiedPackage.readerReceipt;

  return {
    purpose: BASE_ONE_SHOT_PURPOSE,
    correlation: { ...correlation },
    operatorInstruction: [
      '只返回一个严格 JSON 对象；禁止 Markdown、代码围栏、示例、省略号或“其余同理”。',
      'responseInstruction 是本次输出形状的最高优先级要求；字段名区分大小写并须使用规定 lowerCamelCase。',
      'correlation 必须逐字复制输入 correlation；不得从 contextId、assessmentPackageId 或其他内部身份推导。',
      `ruleResults 必须按 COLUMNAR_ROWS 返回 columns+rows，columns 严格等于 ruleResultRequiredFields；rows 必须包含 criterionTable 的全部 ${expectedCount} 个 ruleId，每项恰好一次且顺序不变。`,
      `每个 ruleResults.rows 项都必须保留 ${RULE_RESULT_FIELDS.join('/')} 九项语义；只压缩表达和复用输入中的 ID，不得删除字段、规则、事实判断、规则适用分析、结论、来源、缺口或人工复核要求。`,
      `完整输出 UTF-8 必须不超过 ${BASE_ONE_SHOT_OUTPUT_MAX_UTF8_BYTES} 字节；每个 ruleResults row JSON 不超过 ${BASE_ONE_SHOT_RULE_RESULT_ROW_MAX_UTF8_BYTES} 字节，不复抄长问题原文、来源原文或重复模板。`,
      'subjectContext 只含已由 Unified/host 绑定的核心字段、包哈希、覆盖计数；sourceEvidenceCatalog 保留规则关联 locator。不得把未提供的逐页原文补造为事实，不得用 query 命中数替代 contentUnit/sourceRef 覆盖。',
      'criterionTable.missingPredicateKeys 是宿主从既有 missingInformation 机械投影的谓词键；missingInputs 只能复用这些键，完整补证描述由 canonical host 持有并在模型返回后机械合并。',
      '必须先读取每一行的 predicateResult/status/candidateConclusion、missingPredicateKeys 和 sourceEvidenceCandidateIds。已有 predicate、候选结论或来源候选时，必须保留其业务下界并给出该规则的事实、影响和条件性判断；不得把已知候选统一降级为 BLOCKED_MISSING_INPUT。',
      'BLOCKED_MISSING_INPUT 只能用于该规则确实没有任何可解释的事实下界且 missingInputs 明确非空的项；missingInputs 为空时不得使用该状态。predicateResult=FALSE 必须表达为不适用，predicateResult=TRUE 且已有来源候选时至少给出候选通过、候选不通过或条件性判断之一。',
      'UNKNOWN/WAITING_INPUT 只表示当前结论维度仍未知，不等于整条规则没有分析。即使需要补证，也必须说明已看到的事实、对工程工作的影响、改变判断所需的输入和建议下一步；不得对全部规则重复使用空事实和三句占位文本。',
      'Base 只执行固定 Job Aid 逐项候选判断、自检和缺口整理；禁止生成整体评估意见，禁止返回 overallAssessment。',
      '整体综合由托管 OpenClaw 基于 Base 的完整 N/N 结果和评估上下文另行完成；本次输出必须设置 holisticSynthesisDeferredToOpenClaw=true、overallOpinionProduced=false。',
      '必须区分受控事实、source-bounded parser candidate、历史意见、知识候选、AI 推断、假设和缺口；缺少受控资源时保留 UNKNOWN/WAITING_INPUT，不得补造。',
      '不得创建 EvidenceRef、FleetFact、工程师确认、ClosureDecision、批准、放行或适航结论。',
    ],
    subjectContext: {
      documentIdentity: subject.documentIdentity,
      assessmentAsOf: subject.assessmentAsOf,
      unifiedParsedPackage: boundedUnifiedPackage,
      parsedResult: subject.parsedResult,
      controlledContext: subject.controlledContext,
      sourceDerivation: subject.sourceDerivation,
      publicPackageCoverage: {
        resultStatus: observation.resultStatus,
        contentUnitCount: observation.contentUnitCount,
        sourceRefCount: observation.sourceRefCount,
        applicabilitySourceExpressions:
          observation.applicabilitySourceExpressions,
      },
    },
    jobAidContext: {
      identity: {
        documentId: manifest.documentId,
        documentVersionId: manifest.documentVersionId,
        documentFamily: manifest.documentFamily,
        assessmentPackageId: manifest.assessmentPackageId,
        structuredParsePackageId: manifest.structuredParsePackageId,
        criterionSet: manifest.jobAidRuleSet,
        sourceUnitSetId: manifest.sourceUnitSetId,
        contextId: context.sourceContextIdentity.contextId,
      },
      currentAssessment: context.currentAssessment,
      structuredAssessmentContext: context.structuredAssessmentContext,
      resourceSummary: context.resourceSummary,
      criterionTable: {
        columns: PACKET_CRITERION_COLUMNS,
        rows: criterionRows,
        rowCount: criterionRows.length,
        valueDictionaries: criterionTable.valueDictionaries,
      },
      missingInformationProjection: {
        sourceColumn: 'missingInformation',
        projectedColumn: 'missingPredicateKeys',
        fullDescriptionsOwnedByCanonicalHost: true,
        modelMayInventMissingInputs: false,
      },
      resourceTable,
      sourceEvidenceCatalog: context.sourceEvidenceCatalog,
      auxiliaryContext: {
        historical: context.historicalContext,
        similarCases: context.similarCaseContext,
        knowledge: context.knowledgeContext,
        latestInvestigation: context.latestInvestigation,
      },
      authorityBoundary: context.authorityBoundary,
    },
    expectedSelfCheck: {
      transportId: correlation.transportId,
      workItemId: correlation.workItemId,
      documentVersionId: correlation.documentVersionId,
      criterionSetId: manifest.jobAidRuleSet.criterionSetId,
      criterionCount: expectedCount,
      authorityLevel: 'candidate_only',
      engineeringConclusion: null,
      sourcePageCount: observation.pageSourceRefs.length,
      assessmentSelfCheck: input.expectedSelfCheck,
    },
    responseInstruction: {
      mode: 'ONE_SHOT_FULL_RULE_RESULTS_SELF_CHECK_AND_GAPS',
      exactJsonOnly: true,
      propertyNamesAreCaseSensitive: true,
      echoCorrelationExactly: true,
      doNotInferCorrelationFromContextIdOrAssessmentPackageId: true,
      expectedRuleCount: expectedCount,
      mustReturnEveryInputRuleExactlyOnce: true,
      omissionsExamplesOrEtcAreForbidden: true,
      ruleResultRequiredFields: RULE_RESULT_FIELDS,
      ruleResultsEncoding: {
        type: 'COLUMNAR_ROWS',
        columns: RULE_RESULT_FIELDS,
        maxRowUtf8Bytes: BASE_ONE_SHOT_RULE_RESULT_ROW_MAX_UTF8_BYTES,
      },
      outputBudget: {
        maxUtf8Bytes: BASE_ONE_SHOT_OUTPUT_MAX_UTF8_BYTES,
        ruleResultRowsMaxUtf8Bytes:
          expectedCount * BASE_ONE_SHOT_RULE_RESULT_ROW_MAX_UTF8_BYTES,
        reservedEnvelopeUtf8Bytes:
          BASE_ONE_SHOT_OUTPUT_ENVELOPE_RESERVE_UTF8_BYTES,
        maxNextRoundChecklistItems: BASE_ONE_SHOT_NEXT_ROUND_MAX_ITEMS,
        maxNextRoundChecklistItemUtf8Bytes:
          BASE_ONE_SHOT_NEXT_ROUND_ITEM_MAX_UTF8_BYTES,
      },
      requiredSections: [
        'correlation',
        'authorityLevel',
        'engineeringConclusion',
        'applicabilityOverall',
        'ruleResults',
        'overallSelfCheck',
        'nextRoundChecklist',
        'completionSelfCheck',
      ],
      forbiddenSections: ['overallAssessment'],
      overallSelfCheck: {
        required: true,
        requiredFields: [
          'ruleResultCount',
          'rulesWithMissingInputs',
          'humanReviewRequiredCount',
          'overallOpinionProduced',
          'holisticSynthesisDeferredToOpenClaw',
        ],
        overallOpinionProduced: false,
        holisticSynthesisDeferredToOpenClaw: true,
      },
      completionSelfCheck: {
        required: true,
        requiredFields: [
          'expectedRuleCount',
          'sourcePageCount',
          'allInputRulesReturned',
          'returnedRuleIdsMatchInputOrder',
          'returnedRuleIdsUnique',
        ],
        expectedRuleCount: expectedCount,
        sourcePageCount: observation.pageSourceRefs.length,
        allInputRulesReturned: true,
        returnedRuleIdsMustEqualInputRuleIds: true,
        returnedRuleIdsMustBeUnique: true,
      },
      nextRoundChecklist: {
        required: true,
        deduplicateMissingInputs: true,
        maxItems: BASE_ONE_SHOT_NEXT_ROUND_MAX_ITEMS,
        maxItemUtf8Bytes:
          BASE_ONE_SHOT_NEXT_ROUND_ITEM_MAX_UTF8_BYTES,
        requiredFields: [
          'missingInputId',
          'description',
          'affectedRuleIds',
          'requestedEvidenceOrFact',
          'priority',
          'blocking',
        ],
      },
      authorityLevel: 'candidate_only',
      engineeringConclusion: null,
    },
  };
}

export function consumeBaseOneShotAssessmentResult(
  packet: BaseOneShotAssessmentPacket,
  output: string,
): BaseOneShotAssessmentResult {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error('BASE_ONE_SHOT_OUTPUT_EMPTY');
  }
  const outputBudget = packet.responseInstruction.outputBudget as
    Record<string, any>;
  const maxOutputUtf8Bytes = outputBudget?.maxUtf8Bytes;
  if (!Number.isInteger(maxOutputUtf8Bytes) || maxOutputUtf8Bytes < 1) {
    throw new Error('BASE_ONE_SHOT_OUTPUT_BUDGET_INVALID');
  }
  const outputUtf8Bytes = Buffer.byteLength(output, 'utf8');
  if (outputUtf8Bytes > maxOutputUtf8Bytes) {
    throw new Error(
      `BASE_ONE_SHOT_OUTPUT_BUDGET_EXCEEDED:${outputUtf8Bytes}:` +
      maxOutputUtf8Bytes,
    );
  }
  let parsed: Record<string, any>;
  const normalizedOutput = normalizeBoundaryJsonFormatMarks(output);
  try {
    parsed = JSON.parse(normalizedOutput) as Record<string, any>;
  } catch {
    throw new Error('BASE_ONE_SHOT_OUTPUT_JSON_INVALID');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('BASE_ONE_SHOT_OUTPUT_OBJECT_REQUIRED');
  }
  const forbiddenSections = packet.responseInstruction.forbiddenSections;
  if (!Array.isArray(forbiddenSections)) {
    throw new Error('BASE_ONE_SHOT_FORBIDDEN_SECTIONS_INVALID');
  }
  for (const forbidden of forbiddenSections) {
    if (Object.prototype.hasOwnProperty.call(parsed, forbidden)) {
      throw new Error(`BASE_ONE_SHOT_FORBIDDEN_SECTION_PRESENT:${forbidden}`);
    }
  }
  if (!sameCorrelation(parsed.correlation, packet.correlation)) {
    throw new Error('BASE_ONE_SHOT_CORRELATION_IDENTITY_MISMATCH');
  }
  if (parsed.authorityLevel !== 'candidate_only') {
    throw new Error('BASE_ONE_SHOT_AUTHORITY_INVALID');
  }
  if (parsed.engineeringConclusion !== null) {
    throw new Error('BASE_ONE_SHOT_ENGINEERING_CONCLUSION_FORBIDDEN');
  }
  if (parsed.applicabilityOverall !==
      packet.jobAidContext.currentAssessment.applicabilityOverall) {
    throw new Error('BASE_ONE_SHOT_APPLICABILITY_BOUNDARY_CHANGED');
  }
  const expectedIds = criterionIds(packet);
  const ruleResults = decodeColumnarRuleResults(packet, parsed.ruleResults);
  if (ruleResults.length !== expectedIds.length) {
    throw new Error(
      `BASE_ONE_SHOT_RULE_COUNT_MISMATCH:${ruleResults.length}:` +
      expectedIds.length,
    );
  }
  const returnedIds: string[] = [];
  for (const result of ruleResults) {
    if (
      typeof result.ruleId !== 'string' ||
      typeof result.result !== 'string' ||
      !Array.isArray(result.factsConsidered) ||
      typeof result.ruleApplication !== 'string' ||
      typeof result.analysisSummary !== 'string' ||
      typeof result.conclusion !== 'string' ||
      !Array.isArray(result.sourceRefs) ||
      !Array.isArray(result.missingInputs) ||
      typeof result.humanReviewRequired !== 'boolean'
    ) {
      throw new Error('BASE_ONE_SHOT_RULE_RESULT_FIELD_TYPE_INVALID');
    }
    returnedIds.push(String(result.ruleId));
  }
  const identityBoundRuleResults = bindSingleDuplicatedResultCellRuleId(
    ruleResults,
    returnedIds,
    expectedIds,
  );
  const normalizedRuleResults = normalizePredicateBoundRuleResults(
    packet,
    identityBoundRuleResults,
  );
  validateRuleSemantics(packet, normalizedRuleResults);
  if (!Array.isArray(parsed.nextRoundChecklist)) {
    throw new Error('BASE_ONE_SHOT_NEXT_ROUND_CHECKLIST_REQUIRED');
  }
  const maxChecklistItems = outputBudget.maxNextRoundChecklistItems;
  const maxChecklistItemUtf8Bytes =
    outputBudget.maxNextRoundChecklistItemUtf8Bytes;
  if (
    !Number.isInteger(maxChecklistItems) ||
    !Number.isInteger(maxChecklistItemUtf8Bytes) ||
    parsed.nextRoundChecklist.length > maxChecklistItems
  ) {
    throw new Error('BASE_ONE_SHOT_NEXT_ROUND_CHECKLIST_BUDGET_INVALID');
  }
  parsed.nextRoundChecklist.forEach((item: unknown, index: number) => {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), 'utf8');
    if (itemBytes > maxChecklistItemUtf8Bytes) {
      throw new Error(
        `BASE_ONE_SHOT_NEXT_ROUND_ITEM_BUDGET_EXCEEDED:${index}:` +
        `${itemBytes}:${maxChecklistItemUtf8Bytes}`,
      );
    }
  });
  if (
    !parsed.completionSelfCheck ||
    typeof parsed.completionSelfCheck !== 'object' ||
    Array.isArray(parsed.completionSelfCheck)
  ) {
    throw new Error('BASE_ONE_SHOT_COMPLETION_SELF_CHECK_REQUIRED');
  }
  const completionInstruction =
    packet.responseInstruction.completionSelfCheck as Record<string, any>;
  if (
    parsed.completionSelfCheck.expectedRuleCount !== expectedIds.length ||
    parsed.completionSelfCheck.sourcePageCount !==
      completionInstruction.sourcePageCount ||
    parsed.completionSelfCheck.allInputRulesReturned !== true ||
    parsed.completionSelfCheck.returnedRuleIdsMatchInputOrder !== true ||
    parsed.completionSelfCheck.returnedRuleIdsUnique !== true
  ) {
    throw new Error('BASE_ONE_SHOT_COMPLETION_SELF_CHECK_MISMATCH');
  }
  const overallSelfCheck = normalizeOverallSelfCheck(
    parsed,
    normalizedRuleResults,
    expectedIds.length,
  );
  return {
    correlation: { ...packet.correlation },
    authorityLevel: 'candidate_only',
    engineeringConclusion: null,
    applicabilityOverall: parsed.applicabilityOverall,
    ruleResults: normalizedRuleResults,
    overallSelfCheck,
    nextRoundChecklist: parsed.nextRoundChecklist,
    completionSelfCheck: parsed.completionSelfCheck,
    criterionCount: expectedIds.length,
  };
}

function bindSingleDuplicatedResultCellRuleId(
  ruleResults: Array<Record<string, unknown>>,
  returnedIds: string[],
  expectedIds: string[],
): Array<Record<string, unknown>> {
  const mismatches = returnedIds
    .map((id, index) => id === expectedIds[index] ? -1 : index)
    .filter((index) => index >= 0);
  if (mismatches.length === 0) return ruleResults;
  const index = mismatches[0];
  const expectedIdSet = new Set(expectedIds);
  if (
    mismatches.length !== 1 ||
    new Set(returnedIds).size !== returnedIds.length ||
    expectedIdSet.has(returnedIds[index]) ||
    returnedIds[index] !== ruleResults[index].result
  ) {
    throw new Error('BASE_ONE_SHOT_RULE_MEMBERSHIP_OR_ORDER_MISMATCH');
  }
  return ruleResults.map((result, resultIndex) =>
    resultIndex === index ? { ...result, ruleId: expectedIds[index] } : result);
}

/**
 * Re-encodes host-normalized rows into the existing Base artifact envelope so
 * later dynamic/overall/readback consumers see the same predicate semantics.
 */
export function serializeNormalizedBaseOneShotOutput(
  output: string,
  result: BaseOneShotAssessmentResult,
): Uint8Array {
  const normalizedOutput = normalizeBoundaryJsonFormatMarks(output);
  const parsed = JSON.parse(normalizedOutput) as Record<string, any>;
  if (
    !parsed.ruleResults ||
    typeof parsed.ruleResults !== 'object' ||
    !Array.isArray(parsed.ruleResults.columns) ||
    !Array.isArray(parsed.ruleResults.rows)
  ) {
    return Buffer.from(normalizedOutput, 'utf8');
  }
  parsed.ruleResults = {
    columns: [...BASE_ONE_SHOT_RULE_RESULT_FIELDS],
    rows: result.ruleResults.map((rule) =>
      BASE_ONE_SHOT_RULE_RESULT_FIELDS.map((field) => rule[field]),
    ),
  };
  const rowBytes = parsed.ruleResults.rows.map((row: unknown[]) =>
    Buffer.byteLength(JSON.stringify(row), 'utf8'),
  );
  if (rowBytes.some((bytes: number) => bytes > BASE_ONE_SHOT_RULE_RESULT_ROW_MAX_UTF8_BYTES)) {
    throw new Error('BASE_ONE_SHOT_NORMALIZED_RULE_ROW_BUDGET_EXCEEDED');
  }
  parsed.overallSelfCheck = {
    ...(parsed.overallSelfCheck ?? {}),
    ...result.overallSelfCheck,
  };
  const bytes = Buffer.from(JSON.stringify(parsed), 'utf8');
  if (bytes.byteLength > BASE_ONE_SHOT_OUTPUT_MAX_UTF8_BYTES) {
    throw new Error('BASE_ONE_SHOT_NORMALIZED_OUTPUT_BUDGET_EXCEEDED');
  }
  return bytes;
}

export function normalizeBoundaryJsonFormatMarks(value: string): string {
  return value.replace(/^[\s\uFEFF\u200B]+|[\s\uFEFF\u200B]+$/gu, '');
}

function normalizeOverallSelfCheck(
  parsed: Record<string, any>,
  ruleResults: Array<Record<string, unknown>>,
  expectedRuleCount: number,
): Record<string, unknown> {
  const rulesWithMissingInputs = ruleResults.filter(
    (result: Record<string, unknown>) =>
      Array.isArray(result.missingInputs) && result.missingInputs.length > 0,
  ).length;
  const humanReviewRequiredCount = ruleResults.filter(
    (result: Record<string, unknown>) => result.humanReviewRequired === true,
  ).length;
  const value = parsed.overallSelfCheck;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('BASE_ONE_SHOT_OVERALL_SELF_CHECK_REQUIRED');
  }
  if (
    value.ruleResultCount !== expectedRuleCount ||
    value.overallOpinionProduced !== false ||
    value.holisticSynthesisDeferredToOpenClaw !== true
  ) {
    throw new Error('BASE_ONE_SHOT_OVERALL_SELF_CHECK_MISMATCH');
  }
  return {
    ...value,
    rulesWithMissingInputs,
    humanReviewRequiredCount,
  };
}

interface CriterionSemanticRow {
  predicateResult: string;
  candidateConclusion: string;
  missingPredicateKeys: string[];
  sourceEvidenceCandidateIds: string[];
}

/**
 * The criterion table is Host-owned applicability input. The model may explain
 * a candidate, but cannot change FALSE/UNKNOWN/TRUE semantics or invent gaps.
 */
function normalizePredicateBoundRuleResults(
  packet: BaseOneShotAssessmentPacket,
  ruleResults: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const table = packet.jobAidContext.criterionTable;
  const predicateIndex = table.columns.indexOf('predicateResult');
  if (predicateIndex < 0) return ruleResults;
  return ruleResults.map((result, index) => {
    const predicateResult = decodeCriterionTableValue(
      table,
      table.rows[index]?.[predicateIndex],
      'predicateResult',
    );
    if (predicateResult === 'FALSE') {
      return {
        ...result,
        result: 'NOT_APPLICABLE',
        conclusion: '不适用',
        sourceRefs: [],
        missingInputs: [],
        humanReviewRequired: false,
      };
    }
    if (predicateResult === 'UNKNOWN') {
      const missingPredicateKeys = predicateKeysForRow(packet, index);
      return {
        ...result,
        result: 'UNKNOWN/WAITING_INPUT',
        conclusion: '信息不足',
        missingInputs: missingPredicateKeys,
        humanReviewRequired: true,
      };
    }
    if (predicateResult === 'TRUE') {
      return { ...result, missingInputs: [] };
    }
    return result;
  });
}

function predicateKeysForRow(
  packet: BaseOneShotAssessmentPacket,
  rowIndex: number,
): string[] {
  const table = packet.jobAidContext.criterionTable;
  const index = table.columns.indexOf('missingPredicateKeys');
  if (index < 0) return [];
  const value = table.rows[rowIndex]?.[index];
  if (!Array.isArray(value)) return [];
  return value.filter((key): key is string =>
    typeof key === 'string' && key.trim() !== '',
  );
}

function decodeCriterionTableValue(
  table: BaseOneShotAssessmentPacket['jobAidContext']['criterionTable'],
  value: unknown,
  column: string,
): string | null {
  if (typeof value === 'string') return value;
  if (!Number.isInteger(value)) return null;
  const dictionary = table.valueDictionaries?.[column];
  const decoded = dictionary?.[Number(value)];
  return typeof decoded === 'string' ? decoded : null;
}

function validateRuleSemantics(
  packet: BaseOneShotAssessmentPacket,
  ruleResults: Array<Record<string, unknown>>,
): void {
  const semantics = criterionSemanticRows(packet);
  if (semantics === null) return;
  let genericRows = 0;
  const signatures = new Set<string>();
  ruleResults.forEach((result: Record<string, unknown>, index: number): void => {
    const expected = semantics[index];
    const missingInputs = stringArray(result.missingInputs, 'BASE_ONE_SHOT_MISSING_INPUTS_TYPE_INVALID');
    if (missingInputs.some((value: string): boolean => !expected.missingPredicateKeys.includes(value))) {
      throw new Error(`BASE_ONE_SHOT_MISSING_INPUT_NOT_BOUND:${index}`);
    }
    const resultStatus = String(result.result);
    const conclusion = String(result.conclusion);
    if (expected.predicateResult === 'TRUE' &&
        (resultStatus === 'BLOCKED_MISSING_INPUT' || missingInputs.length > 0)) {
      throw new Error(`BASE_ONE_SHOT_TRUE_PREDICATE_BLOCKED:${index}`);
    }
    if (resultStatus === 'BLOCKED_MISSING_INPUT' && missingInputs.length === 0) {
      throw new Error(`BASE_ONE_SHOT_BLOCKED_WITHOUT_MISSING_INPUT:${index}`);
    }
    if (expected.predicateResult === 'FALSE' &&
        /(?:PASS|FAIL|CONDITIONAL|通过|不通过)/iu.test(resultStatus)) {
      throw new Error(`BASE_ONE_SHOT_FALSE_PREDICATE_CONCLUSION_INVALID:${index}`);
    }
    if (expected.predicateResult === 'UNKNOWN' &&
        result.humanReviewRequired !== true) {
      throw new Error(`BASE_ONE_SHOT_UNKNOWN_REVIEW_REQUIRED:${index}`);
    }
    const hasSourceCandidate = expected.sourceEvidenceCandidateIds.length > 0;
    const facts = stringArray(result.factsConsidered, 'BASE_ONE_SHOT_FACTS_TYPE_INVALID');
    const sourceRefs = stringArray(result.sourceRefs, 'BASE_ONE_SHOT_SOURCE_REFS_TYPE_INVALID');
    if (sourceRefs.some((ref: string): boolean =>
      !expected.sourceEvidenceCandidateIds.includes(ref))) {
      throw new Error(`BASE_ONE_SHOT_SOURCE_REF_NOT_BOUND:${index}`);
    }
    if (hasSourceCandidate && expected.predicateResult !== 'FALSE' &&
        facts.length === 0 && sourceRefs.length === 0 &&
        /(?:UNKNOWN\/WAITING_INPUT|WAITING_INPUT|BLOCKED_MISSING_INPUT)/u.test(resultStatus)) {
      throw new Error(`BASE_ONE_SHOT_KNOWN_CANDIDATE_DOWNGRADED:${index}`);
    }
    const signature = JSON.stringify([
      result.ruleApplication,
      result.analysisSummary,
      result.conclusion,
      facts.length,
      sourceRefs.length,
    ]);
    signatures.add(signature);
    if (facts.length === 0 && sourceRefs.length === 0 &&
        result.ruleApplication === '按本条规则评估。' &&
        result.analysisSummary === '受控事实不足。' &&
        conclusion === 'UNKNOWN/WAITING_INPUT') {
      genericRows += 1;
    }
  });
  if (ruleResults.length >= 3 && genericRows === ruleResults.length && signatures.size === 1) {
    throw new Error('BASE_ONE_SHOT_SEMANTIC_OUTPUT_DEGRADED');
  }
}

function criterionSemanticRows(
  packet: BaseOneShotAssessmentPacket,
): CriterionSemanticRow[] | null {
  const table = packet.jobAidContext.criterionTable;
  const required = [
    'predicateResult',
    'candidateConclusion',
    'missingPredicateKeys',
    'sourceEvidenceCandidateIds',
  ];
  if (required.some((column: string): boolean => table.columns.indexOf(column) < 0)) {
    return null;
  }
  return table.rows.map((row: unknown[]): CriterionSemanticRow => ({
    predicateResult: dictionaryText(row[table.columns.indexOf('predicateResult')], table.valueDictionaries?.predicateResult),
    candidateConclusion: dictionaryText(row[table.columns.indexOf('candidateConclusion')], table.valueDictionaries?.candidateConclusion),
    missingPredicateKeys: stringArray(row[table.columns.indexOf('missingPredicateKeys')], 'BASE_ONE_SHOT_INPUT_MISSING_KEYS_INVALID'),
    sourceEvidenceCandidateIds: stringArray(
      dictionaryValue(row[table.columns.indexOf('sourceEvidenceCandidateIds')], table.valueDictionaries?.sourceEvidenceCandidateIds),
      'BASE_ONE_SHOT_INPUT_SOURCE_CANDIDATES_INVALID',
    ),
  }));
}

function dictionaryValue(value: unknown, dictionary: unknown[] | undefined): unknown {
  if (!Number.isInteger(value) || !Array.isArray(dictionary)) return value;
  return dictionary[Number(value)];
}

function dictionaryText(value: unknown, dictionary: unknown[] | undefined): string {
  const decoded = dictionaryValue(value, dictionary);
  return typeof decoded === 'string' ? decoded : String(decoded ?? '');
}

function stringArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || value.some((item: unknown): boolean => typeof item !== 'string')) {
    throw new Error(code);
  }
  return value as string[];
}

function decodeColumnarRuleResults(
  packet: BaseOneShotAssessmentPacket,
  encoded: unknown,
): Array<Record<string, unknown>> {
  if (!encoded || typeof encoded !== 'object' || Array.isArray(encoded)) {
    throw new Error('BASE_ONE_SHOT_RULE_RESULTS_COLUMNAR_REQUIRED');
  }
  const value = encoded as Record<string, unknown>;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'columns' || keys[1] !== 'rows') {
    throw new Error('BASE_ONE_SHOT_RULE_RESULTS_COLUMNAR_SHAPE_INVALID');
  }
  const columns = value.columns;
  const rows = value.rows;
  const instruction = packet.responseInstruction.ruleResultsEncoding as
    Record<string, any>;
  const expectedColumns = instruction?.columns;
  const maxRowUtf8Bytes = instruction?.maxRowUtf8Bytes;
  if (
    instruction?.type !== 'COLUMNAR_ROWS' ||
    !Array.isArray(columns) ||
    !Array.isArray(expectedColumns) ||
    JSON.stringify(columns) !== JSON.stringify(RULE_RESULT_FIELDS) ||
    JSON.stringify(expectedColumns) !== JSON.stringify(RULE_RESULT_FIELDS) ||
    !Array.isArray(rows) ||
    !Number.isInteger(maxRowUtf8Bytes) ||
    maxRowUtf8Bytes < 1
  ) {
    throw new Error('BASE_ONE_SHOT_RULE_RESULTS_COLUMNAR_SCHEMA_INVALID');
  }
  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== RULE_RESULT_FIELDS.length) {
      throw new Error(`BASE_ONE_SHOT_RULE_RESULT_ROW_INVALID:${index}`);
    }
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (rowBytes > maxRowUtf8Bytes) {
      throw new Error(
        `BASE_ONE_SHOT_RULE_RESULT_ROW_BUDGET_EXCEEDED:${index}:` +
        `${rowBytes}:${maxRowUtf8Bytes}`,
      );
    }
    return Object.fromEntries(
      RULE_RESULT_FIELDS.map((field, fieldIndex) => [field, row[fieldIndex]]),
    );
  });
}

function criterionIds(packet: BaseOneShotAssessmentPacket): string[] {
  const table = packet.jobAidContext.criterionTable;
  const index = table.columns.indexOf('criterionId');
  if (index < 0) throw new Error('BASE_ONE_SHOT_CRITERION_ID_COLUMN_MISSING');
  return table.rows.map((row) => String(row[index]));
}

function projectMissingPredicateKeys(value: unknown): string[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  const firstLine = value.split('\n', 1)[0].trim();
  const prefix = '缺少谓词输入：';
  if (!firstLine.startsWith(prefix)) return [];
  return firstLine
    .slice(prefix.length)
    .split(/[、,，]/u)
    .map((key) => key.trim())
    .filter(Boolean);
}

function assertCorrelation(correlation: BaseOneShotCorrelation): void {
  for (const field of [
    'transportId',
    'workItemId',
    'actionAttemptId',
    'documentVersionId',
  ] as const) {
    if (typeof correlation[field] !== 'string' || !correlation[field].trim()) {
      throw new Error(`BASE_ONE_SHOT_CORRELATION_REQUIRED:${field}`);
    }
  }
  if (!Number.isInteger(correlation.expectedRevision) ||
      correlation.expectedRevision < 0) {
    throw new Error('BASE_ONE_SHOT_EXPECTED_REVISION_INVALID');
  }
}

function sameCorrelation(
  value: unknown,
  expected: BaseOneShotCorrelation,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  const keys = Object.keys(expected);
  return Object.keys(actual).length === keys.length &&
    keys.every((key) => actual[key] === expected[key as keyof BaseOneShotCorrelation]);
}
