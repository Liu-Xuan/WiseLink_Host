import { createHash } from 'node:crypto';

import { ConflictException } from '@nestjs/common';

import type { EvaluationContextPackageResponse } from '@shared/assessment-host.interface';

export const AILY_HOLISTIC_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_holistic_input.v1' as const;
export const AILY_HOLISTIC_COMPACT_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_holistic_input.v2' as const;
export const AILY_HOLISTIC_SEMANTIC_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_holistic_input.v3' as const;
export const AILY_HOLISTIC_DYNAMIC_INPUT_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_holistic_input.v4' as const;
export const AILY_HOLISTIC_TABULAR_PROJECTION_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_tabular_projection.v1' as const;
export const AILY_HOLISTIC_SELF_CHECK_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_holistic_self_check.v1' as const;
export const AILY_HOLISTIC_DYNAMIC_SELF_CHECK_SCHEMA =
  'wiselink.v3_1.sb_job_aid.aily_holistic_self_check.v2' as const;
export const AILY_HOLISTIC_TEST_MESSAGE_HEADER =
  'WISELINK_CONTROLLED_EVALUATION_REQUEST_V1' as const;
const AILY_HOLISTIC_TEST_MESSAGE_JSON_BEGIN = 'BEGIN_CANONICAL_JSON';
const AILY_HOLISTIC_TEST_MESSAGE_JSON_END = 'END_CANONICAL_JSON';
export const AILY_HOLISTIC_SKILL_IDENTITY = Object.freeze({
  appId: 'spring_6bc16cad05__c',
  skillId: 'skill_1213a0a5ba3f',
  skillName: 'SB Job Aid 整体评估（受控验证）',
  lifecycleStatus: 'TEST_UNPUBLISHED' as const,
  inputField: 'evaluation_context_json',
  outputField: 'overall_assessment_text',
  configuredModel: 'Minimax-M2.7',
  editorVersion: '260420',
});

export interface AilyHolisticSelfCheck {
  schemaVersion:
    | typeof AILY_HOLISTIC_SELF_CHECK_SCHEMA
    | typeof AILY_HOLISTIC_DYNAMIC_SELF_CHECK_SCHEMA;
  contextId: string;
  contextHash: string;
  evaluationItemSetHash: string;
  assessmentPackageId: string;
  structuredParsePackageId: string;
  sourceUnitSetId: string | null;
  jobAidActiveVersion: string;
  jobAidTargetCandidateVersion: '0.3-candidate';
  criterionCardCount: number;
  resourceAssessmentCount: number;
  unresolvedCount: number;
  humanRequiredCount: number;
  resourceMissingCount: number;
  parsedWorkStepAvailability: 'AVAILABLE_CANDIDATE' | 'MISSING';
  parsedWorkStepIds: string[];
  applicabilityOverall: string;
  documentApplicabilityProvesFleetApplicability: false;
  authorityLevel: 'candidate_only';
}

export interface ControlledAilyHolisticInput {
  schemaVersion: typeof AILY_HOLISTIC_INPUT_SCHEMA;
  transportId: string;
  transportHash: string;
  skillIdentity: typeof AILY_HOLISTIC_SKILL_IDENTITY;
  operatorInstruction: string[];
  evaluationContext: Omit<
    EvaluationContextPackageResponse,
    'contextText' | 'latestOverallDraft'
  >;
  expectedSelfCheck: AilyHolisticSelfCheck;
}

type CriterionCard =
  EvaluationContextPackageResponse['criterionCards'][number];
type ResourceAssessment =
  EvaluationContextPackageResponse['resourceAssessments'][number];

export interface AilyTabularProjection {
  schemaVersion: typeof AILY_HOLISTIC_TABULAR_PROJECTION_SCHEMA;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  contentHash: string;
}

export interface ControlledAilyHolisticCompactInput {
  schemaVersion: typeof AILY_HOLISTIC_COMPACT_INPUT_SCHEMA;
  transportId: string;
  transportHash: string;
  skillIdentity: typeof AILY_HOLISTIC_SKILL_IDENTITY;
  operatorInstruction: string[];
  evaluationContext: Omit<
    EvaluationContextPackageResponse,
    | 'contextText'
    | 'latestOverallDraft'
    | 'criterionCards'
    | 'resourceAssessments'
  > & {
    criterionCardsTable: AilyTabularProjection;
    resourceAssessmentsTable: AilyTabularProjection;
  };
  expectedSelfCheck: AilyHolisticSelfCheck;
}

export interface AilySemanticTable {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  projectedContentHash: string;
  valueDictionaries?: Record<string, unknown[]>;
}

export interface AilySemanticEvaluationContext {
  schemaVersion: 'wiselink.v3_1.sb_job_aid.aily_semantic_projection.v1';
  sourceContextIdentity: {
    contextId: string;
    contextHash: string;
    evaluationItemSetHash: string;
    criterionCardsContentHash: string;
    resourceAssessmentsContentHash: string;
    sourceEvidenceCandidatesContentHash: string;
    latestInvestigationRunHash: string | null;
  };
  manifest: EvaluationContextPackageResponse['manifest'];
  currentAssessment: EvaluationContextPackageResponse['currentAssessment'];
  parsedSourceContext?: EvaluationContextPackageResponse['parsedSourceContext'];
  structuredAssessmentContext: unknown;
  resourceSummary: EvaluationContextPackageResponse['resourceSummary'];
  criterionTable: AilySemanticTable & {
    evaluationItemIdTemplate: string;
  };
  resourceTable: AilySemanticTable & {
    requirementIdTemplate: string;
    resourceTypeDefault: string;
    validationStatusPolicy: Record<string, string>;
    missingReasonSource: string;
    missingPolicy: string;
    authorityBoundary: 'candidate_only';
  };
  sourceEvidenceCatalog: AilySemanticTable & {
    artifactRefs: string[];
    authorityBoundary: 'candidate_only';
    createsEvidenceRef: false;
  };
  historicalContext: EvaluationContextPackageResponse['historicalContext'];
  similarCaseContext: EvaluationContextPackageResponse['similarCaseContext'];
  knowledgeContext: EvaluationContextPackageResponse['knowledgeContext'];
  latestInvestigation: unknown;
  authorityBoundary: EvaluationContextPackageResponse['authorityBoundary'];
  projectionNotes: string[];
}

export interface ControlledAilyHolisticSemanticInput {
  schemaVersion: typeof AILY_HOLISTIC_SEMANTIC_INPUT_SCHEMA;
  transportId: string;
  transportHash: string;
  skillIdentity: typeof AILY_HOLISTIC_SKILL_IDENTITY;
  operatorInstruction: string[];
  evaluationContext: AilySemanticEvaluationContext;
  expectedSelfCheck: AilyHolisticSelfCheck;
}

export interface ControlledAilyHolisticDynamicInput
  extends Omit<ControlledAilyHolisticSemanticInput, 'schemaVersion'> {
  schemaVersion: typeof AILY_HOLISTIC_DYNAMIC_INPUT_SCHEMA;
}

type AnyControlledAilyHolisticInput =
  | ControlledAilyHolisticInput
  | ControlledAilyHolisticCompactInput
  | ControlledAilyHolisticSemanticInput
  | ControlledAilyHolisticDynamicInput;

export interface AilyHolisticOutputValidation {
  schemaVersion:
    'wiselink.v3_1.sb_job_aid.aily_holistic_output_validation.v1';
  status: 'PASS';
  transportId: string;
  transportHash: string;
  visibleOpinion: string;
  selfCheck: AilyHolisticSelfCheck;
}

export interface ValidateAilyHolisticOutputRequest {
  packageId: string;
  expectedTransportId: string;
  expectedTransportHash: string;
  overallAssessmentText: string;
}

const SELF_CHECK_PATTERN =
  /<!--\s*WISELINK_AILY_SELF_CHECK\s+(\{[\s\S]*\})\s*-->\s*$/u;
const WORK_STEP_ID_PATTERN = /\bWP\d+(?:\.\d+)+\b/gu;

export function buildControlledAilyHolisticInput(
  context: EvaluationContextPackageResponse,
): ControlledAilyHolisticInput {
  assertCompleteEvaluationContext(context, 150);
  const expectedSelfCheck = buildExpectedSelfCheck(context);
  const {
    contextText: _contextText,
    latestOverallDraft: _latestOverallDraft,
    ...evaluationContext
  } = context;
  const identity = {
    schemaVersion: AILY_HOLISTIC_INPUT_SCHEMA,
    skillIdentity: AILY_HOLISTIC_SKILL_IDENTITY,
    operatorInstruction: operatorInstruction(expectedSelfCheck),
    evaluationContext,
    expectedSelfCheck,
  };
  const transportHash = hashCanonical(identity);
  return {
    ...identity,
    transportId: `AHI-${digest(transportHash).slice(0, 24).toUpperCase()}`,
    transportHash,
  };
}

export function buildControlledAilyHolisticCompactInput(
  context: EvaluationContextPackageResponse,
): ControlledAilyHolisticCompactInput {
  assertCompleteEvaluationContext(context, 150);
  const expectedSelfCheck = buildExpectedSelfCheck(context);
  const {
    contextText: _contextText,
    latestOverallDraft: _latestOverallDraft,
    criterionCards,
    resourceAssessments,
    ...evaluationContext
  } = context;
  const identity = {
    schemaVersion: AILY_HOLISTIC_COMPACT_INPUT_SCHEMA,
    skillIdentity: AILY_HOLISTIC_SKILL_IDENTITY,
    operatorInstruction: operatorInstruction(expectedSelfCheck, {
      criterionTablePath: 'evaluationContext.criterionCardsTable',
      resourceTablePath: 'evaluationContext.resourceAssessmentsTable',
    }),
    evaluationContext: {
      ...evaluationContext,
      criterionCardsTable: projectUniformRows(criterionCards),
      resourceAssessmentsTable: projectUniformRows(resourceAssessments),
    },
    expectedSelfCheck,
  };
  const transportHash = hashCanonical(identity);
  const input: ControlledAilyHolisticCompactInput = {
    ...identity,
    transportId: `AHI-${digest(transportHash).slice(0, 24).toUpperCase()}`,
    transportHash,
  };
  assertTransportIdentity(input);
  return input;
}

export function buildControlledAilyHolisticSemanticInput(
  context: EvaluationContextPackageResponse,
): ControlledAilyHolisticSemanticInput {
  assertCompleteEvaluationContext(context, 150);
  const expectedSelfCheck = buildExpectedSelfCheck(context);
  const identity = {
    schemaVersion: AILY_HOLISTIC_SEMANTIC_INPUT_SCHEMA,
    skillIdentity: AILY_HOLISTIC_SKILL_IDENTITY,
    operatorInstruction: operatorInstruction(expectedSelfCheck, {
      criterionTablePath: 'evaluationContext.criterionTable',
      resourceTablePath: 'evaluationContext.resourceTable',
    }),
    evaluationContext: projectSemanticEvaluationContext(context),
    expectedSelfCheck,
  };
  const transportHash = hashCanonical(identity);
  const input: ControlledAilyHolisticSemanticInput = {
    ...identity,
    transportId: `AHI-${digest(transportHash).slice(0, 24).toUpperCase()}`,
    transportHash,
  };
  assertTransportIdentity(input);
  return input;
}

export function buildControlledAilyHolisticDynamicInput(
  context: EvaluationContextPackageResponse,
): ControlledAilyHolisticDynamicInput {
  assertCompleteEvaluationContext(context);
  const expectedSelfCheck = buildExpectedSelfCheck(context, true);
  const identity = {
    schemaVersion: AILY_HOLISTIC_DYNAMIC_INPUT_SCHEMA,
    skillIdentity: AILY_HOLISTIC_SKILL_IDENTITY,
    operatorInstruction: operatorInstruction(
      expectedSelfCheck,
      {
        criterionTablePath: 'evaluationContext.criterionTable',
        resourceTablePath: 'evaluationContext.resourceTable',
      },
      collectEngineerActions(context),
    ),
    evaluationContext: projectSemanticEvaluationContext(context),
    expectedSelfCheck,
  };
  const transportHash = hashCanonical(identity);
  const input: ControlledAilyHolisticDynamicInput = {
    ...identity,
    transportId: `AHI-${digest(transportHash).slice(0, 24).toUpperCase()}`,
    transportHash,
  };
  assertTransportIdentity(input);
  return input;
}

export function serializeControlledAilyHolisticInput(
  input: AnyControlledAilyHolisticInput,
): string {
  assertTransportIdentity(input);
  return stableCanonical(input);
}

export function serializeControlledAilyHolisticTestMessage(
  input: AnyControlledAilyHolisticInput,
): string {
  const serialized = serializeControlledAilyHolisticInput(input);
  return [
    AILY_HOLISTIC_TEST_MESSAGE_HEADER,
    '下方 JSON 是完整且身份已校验的 EvaluationContextPackage，不是缺失输入。包内 MISSING/UNKNOWN 仅表示资源缺口：必须保留缺口并继续生成 candidate_only 综合草稿，不得只追问资料或停止。',
    '严格执行 JSON.operatorInstruction；正文只列 JSON.expectedSelfCheck.parsedWorkStepIds，末尾原样复制 expectedSelfCheck 为 WISELINK_AILY_SELF_CHECK 注释。',
    AILY_HOLISTIC_TEST_MESSAGE_JSON_BEGIN,
    serialized,
    AILY_HOLISTIC_TEST_MESSAGE_JSON_END,
  ].join('\n');
}

export function parseControlledAilyHolisticTestMessage(
  value: string,
): AnyControlledAilyHolisticInput {
  const prefix = `${AILY_HOLISTIC_TEST_MESSAGE_HEADER}\n`;
  const begin = `\n${AILY_HOLISTIC_TEST_MESSAGE_JSON_BEGIN}\n`;
  const end = `\n${AILY_HOLISTIC_TEST_MESSAGE_JSON_END}`;
  if (!value.startsWith(prefix) || !value.endsWith(end)) {
    throw new ConflictException('AILY_HOLISTIC_TEST_MESSAGE_SHAPE_INVALID');
  }
  const beginIndex = value.indexOf(begin, prefix.length);
  if (beginIndex < 0) {
    throw new ConflictException('AILY_HOLISTIC_TEST_MESSAGE_SHAPE_INVALID');
  }
  const jsonStart = beginIndex + begin.length;
  const jsonText = value.slice(jsonStart, -end.length);
  try {
    const parsed = JSON.parse(jsonText) as AnyControlledAilyHolisticInput;
    assertTransportIdentity(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof ConflictException) throw error;
    throw new ConflictException('AILY_HOLISTIC_TEST_MESSAGE_JSON_INVALID');
  }
}

export function renderAilySelfCheckMarker(
  selfCheck: AilyHolisticSelfCheck,
): string {
  return `<!-- WISELINK_AILY_SELF_CHECK ${stableCanonical(selfCheck)} -->`;
}

export function validateControlledAilyHolisticOutput(
  input: AnyControlledAilyHolisticInput,
  output: string,
): AilyHolisticOutputValidation {
  assertTransportIdentity(input);
  if (typeof output !== 'string' || output.trim() === '') {
    throw new ConflictException('AILY_HOLISTIC_OUTPUT_EMPTY');
  }
  const match = output.match(SELF_CHECK_PATTERN);
  if (!match || match.index === undefined) {
    throw new ConflictException('AILY_HOLISTIC_SELF_CHECK_MISSING');
  }
  const visibleOpinion = output.slice(0, match.index).trim();
  if (!visibleOpinion) {
    throw new ConflictException('AILY_HOLISTIC_VISIBLE_OPINION_EMPTY');
  }
  const parsed = parseSelfCheck(match[1]);
  if (stableCanonical(parsed) !== stableCanonical(input.expectedSelfCheck)) {
    throw new ConflictException('AILY_HOLISTIC_SELF_CHECK_MISMATCH');
  }
  assertVisibleWorkStepIdentity(
    visibleOpinion,
    input.expectedSelfCheck.parsedWorkStepIds,
    input.expectedSelfCheck.parsedWorkStepAvailability,
  );
  return {
    schemaVersion:
      'wiselink.v3_1.sb_job_aid.aily_holistic_output_validation.v1',
    status: 'PASS',
    transportId: input.transportId,
    transportHash: input.transportHash,
    visibleOpinion,
    selfCheck: parsed,
  };
}

export function materializeAilyTabularProjection<T extends object>(
  table: AilyTabularProjection,
): T[] {
  if (
    table.schemaVersion !== AILY_HOLISTIC_TABULAR_PROJECTION_SCHEMA ||
    !Number.isInteger(table.rowCount) ||
    table.rowCount < 0 ||
    table.rowCount !== table.rows.length ||
    table.columns.length === 0 ||
    new Set(table.columns).size !== table.columns.length
  ) {
    throw new ConflictException('AILY_TABULAR_PROJECTION_SHAPE_INVALID');
  }
  const records = table.rows.map((row) => {
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      throw new ConflictException('AILY_TABULAR_PROJECTION_ROW_INVALID');
    }
    return Object.fromEntries(
      table.columns.map((column, index) => [column, row[index]]),
    ) as T;
  });
  if (hashCanonical(records) !== table.contentHash) {
    throw new ConflictException('AILY_TABULAR_PROJECTION_HASH_INVALID');
  }
  return records;
}

function assertCompleteEvaluationContext(
  context: EvaluationContextPackageResponse,
  legacyExpectedCount: number | null = null,
): void {
  if (context.schemaVersion !==
      'wiselink.v3_1.sb_job_aid.evaluation_context_package.v1') {
    throw new ConflictException('AILY_EVALUATION_CONTEXT_SCHEMA_INVALID');
  }
  const expectedCount = context.manifest.jobAidRuleSet.criteriaCount;
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new ConflictException('AILY_CRITERION_SET_COUNT_INVALID');
  }
  if (legacyExpectedCount !== null && expectedCount !== legacyExpectedCount) {
    throw new ConflictException(
      `AILY_LEGACY_CONTRACT_COUNT_INVALID:${expectedCount}:${legacyExpectedCount}`,
    );
  }
  if (context.criterionCards.length !== expectedCount) {
    throw new ConflictException(
      `AILY_CRITERION_CARD_COUNT_INVALID:${context.criterionCards.length}:${expectedCount}`,
    );
  }
  if (
    context.currentAssessment.counts.total !== expectedCount
  ) {
    throw new ConflictException('AILY_EVALUATION_CONTEXT_COUNT_IDENTITY_INVALID');
  }
  const sequences = context.criterionCards.map((card) => card.sequence);
  if (sequences.some((sequence, index) => sequence !== index + 1)) {
    throw new ConflictException('AILY_CRITERION_CARD_SEQUENCE_INVALID');
  }
  const criterionIds = new Set(
    context.criterionCards.map((card) => card.criterionId),
  );
  if (criterionIds.size !== expectedCount) {
    throw new ConflictException('AILY_CRITERION_CARD_IDENTITY_DUPLICATE');
  }
  const coveredCriterionIds = new Set<string>();
  const requirementIds = new Set<string>();
  for (const resource of context.resourceAssessments) {
    if (!criterionIds.has(resource.criterionId)) {
      throw new ConflictException(
        `AILY_RESOURCE_ASSESSMENT_CRITERION_OUTSIDE_SET:${resource.criterionId}`,
      );
    }
    if (requirementIds.has(resource.requirementId)) {
      throw new ConflictException(
        `AILY_RESOURCE_REQUIREMENT_DUPLICATE:${resource.requirementId}`,
      );
    }
    requirementIds.add(resource.requirementId);
    coveredCriterionIds.add(resource.criterionId);
  }
  if (coveredCriterionIds.size !== expectedCount) {
    throw new ConflictException('AILY_RESOURCE_REQUIREMENT_COVERAGE_INCOMPLETE');
  }
  if (legacyExpectedCount !== null
    && context.resourceAssessments.length !== legacyExpectedCount) {
    throw new ConflictException(
      `AILY_LEGACY_RESOURCE_COUNT_INVALID:${context.resourceAssessments.length}:${legacyExpectedCount}`,
    );
  }
  const workInstructions = context.structuredAssessmentContext.workInstructions;
  if (
    workInstructions.stepCount !== workInstructions.steps.length ||
    workInstructions.stepCount !== workInstructions.stepIds.length ||
    stableCanonical(workInstructions.stepIds) !==
      stableCanonical(workInstructions.steps.map((step) => step.stepId))
  ) {
    throw new ConflictException('AILY_WORK_STEP_IDENTITY_INVALID');
  }
}

function buildExpectedSelfCheck(
  context: EvaluationContextPackageResponse,
  dynamic = false,
): AilyHolisticSelfCheck {
  return {
    schemaVersion: dynamic
      ? AILY_HOLISTIC_DYNAMIC_SELF_CHECK_SCHEMA
      : AILY_HOLISTIC_SELF_CHECK_SCHEMA,
    contextId: context.contextId,
    contextHash: context.contextHash,
    evaluationItemSetHash: context.evaluationItemSetHash,
    assessmentPackageId: context.manifest.assessmentPackageId,
    structuredParsePackageId: context.manifest.structuredParsePackageId,
    sourceUnitSetId: context.manifest.sourceUnitSetId,
    jobAidActiveVersion: context.manifest.jobAidRuleSet.activeVersion,
    jobAidTargetCandidateVersion:
      context.manifest.jobAidRuleSet.targetCandidateVersion,
    criterionCardCount: context.criterionCards.length,
    resourceAssessmentCount: context.resourceAssessments.length,
    unresolvedCount: context.currentAssessment.counts.unresolved,
    humanRequiredCount: context.currentAssessment.counts.humanRequired,
    resourceMissingCount: context.resourceSummary.MISSING,
    parsedWorkStepAvailability:
      context.structuredAssessmentContext.workInstructions.availability,
    parsedWorkStepIds: [
      ...context.structuredAssessmentContext.workInstructions.stepIds,
    ],
    applicabilityOverall: context.currentAssessment.applicabilityOverall,
    documentApplicabilityProvesFleetApplicability: false,
    authorityLevel: 'candidate_only',
  };
}

function operatorInstruction(
  selfCheck: AilyHolisticSelfCheck,
  tabularPaths: {
    criterionTablePath: string;
    resourceTablePath: string;
  } | null = null,
  engineerActions: Array<{
    criterionId: string;
    decision: string;
    status: string;
    comment: string;
    updatedAt: string;
  }> = [],
): string[] {
  return [
    ...(tabularPaths
      ? [
        `${tabularPaths.criterionTablePath} 与 ${tabularPaths.resourceTablePath} 是无损列式 JSON：columns 定义每一列，rows 中每行按相同位置映射；必须逐行读取全部 ${selfCheck.criterionCardCount} 行，不得把列式表示误认为摘要。`,
      ]
      : []),
    `必须综合读取 evaluationContext 中全部 ${selfCheck.criterionCardCount} 张 criterionCards、${selfCheck.resourceAssessmentCount} 条 resourceAssessments、全部 parsedSourceContext 来源页、解析事实、历史意见、类似案例、知识候选与最新调查；不得只依据统计摘要。`,
    ...(engineerActions.length > 0
      ? [
        '本次上下文含工程师动作。必须在“工程师动作及其对整体判断的影响”独立章节逐项原样列出 criterionId、decision/status、完整评语、更新时间，并解释对综合倾向的影响；returned_for_rework/deferred 不等于工程确认或缺口闭合。',
        `必须逐项消费的工程师动作（JSON）：${stableCanonical(engineerActions)}`,
      ]
      : []),
    '必须区分“EvaluationContextPackage 传输缺失/身份冲突”和“完整包内资源为 MISSING/UNKNOWN”：只有前者可以停止；后者必须保留为缺口并继续生成有条件的 candidate_only 综合评估草稿，不得只追问资料。',
    '可以充分进行整体工程推理，但必须区分受控事实、source-bounded parser candidate、历史意见、知识候选、AI 推断、假设和缺口。',
    '文档 Applicability 原文不能证明目标机队适用；没有 FleetFacts/predicates 时必须保持当前待核实/UNKNOWN 边界。',
    '历史意见中的“全部/所有/全机队”只能作为旧意见记录的计划或意向范围；必须同句声明当前适用范围、实际执行与完成状态均未验证，且不得与当前 SB Effectivity 合并成一条依据。',
    '若提及 AEO-B737-46-0008，只能表述为历史意见记录“已发布 AEO，拟为全部 737MAX 飞机进行升级”；当前受控正文、正式适用清单、逐机执行记录和完成状态均未读回。',
    '不得创建 EvidenceRef、FleetFact、工程师确认、ClosureDecision、批准、放行或适航结论。',
    `必须在可见正文中逐一列出解析施工步骤 ID，且只能是：${selfCheck.parsedWorkStepIds.join(', ') || 'MISSING'}。`,
    '正文结束后必须原样追加 expectedSelfCheck 对应的 WISELINK_AILY_SELF_CHECK HTML 注释；不得修改任何字段。',
  ];
}

function collectEngineerActions(
  context: EvaluationContextPackageResponse,
): Array<{
  criterionId: string;
  decision: string;
  status: string;
  comment: string;
  updatedAt: string;
}> {
  return context.criterionCards.flatMap((card) => {
    if (!card.engineerReview) return [];
    return [{
      criterionId: card.criterionId,
      decision: card.engineerReview.decision,
      status: card.engineerReview.status,
      comment: card.engineerReview.comment,
      updatedAt: card.engineerReview.updatedAt,
    }];
  });
}

function assertVisibleWorkStepIdentity(
  visibleOpinion: string,
  expectedIds: string[],
  availability: 'AVAILABLE_CANDIDATE' | 'MISSING',
): void {
  const observed = [...new Set(visibleOpinion.match(WORK_STEP_ID_PATTERN) ?? [])]
    .sort();
  const expected = [...expectedIds].sort();
  if (availability === 'MISSING') {
    if (observed.length > 0) {
      throw new ConflictException('AILY_VISIBLE_WORK_STEP_UNBOUND');
    }
    return;
  }
  if (stableCanonical(observed) !== stableCanonical(expected)) {
    throw new ConflictException('AILY_VISIBLE_WORK_STEP_IDENTITY_MISMATCH');
  }
}

function parseSelfCheck(value: string): AilyHolisticSelfCheck {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not object');
    }
    return parsed as AilyHolisticSelfCheck;
  } catch {
    throw new ConflictException('AILY_HOLISTIC_SELF_CHECK_JSON_INVALID');
  }
}

function assertTransportIdentity(input: AnyControlledAilyHolisticInput): void {
  if (input.schemaVersion === AILY_HOLISTIC_COMPACT_INPUT_SCHEMA) {
    const criterionCards =
      materializeAilyTabularProjection<CriterionCard>(
        input.evaluationContext.criterionCardsTable,
      );
    const resourceAssessments =
      materializeAilyTabularProjection<ResourceAssessment>(
        input.evaluationContext.resourceAssessmentsTable,
      );
    if (criterionCards.length !== 150 || resourceAssessments.length !== 150) {
      throw new ConflictException('AILY_TABULAR_PROJECTION_COUNT_INVALID');
    }
  }
  if (input.schemaVersion === AILY_HOLISTIC_SEMANTIC_INPUT_SCHEMA
    || input.schemaVersion === AILY_HOLISTIC_DYNAMIC_INPUT_SCHEMA) {
    const { criterionTable, resourceTable, sourceEvidenceCatalog } =
      input.evaluationContext;
    if (
      criterionTable.rowCount !== input.expectedSelfCheck.criterionCardCount ||
      resourceTable.rowCount !== input.expectedSelfCheck.resourceAssessmentCount ||
      criterionTable.rows.length !== input.expectedSelfCheck.criterionCardCount ||
      resourceTable.rows.length !== input.expectedSelfCheck.resourceAssessmentCount ||
      sourceEvidenceCatalog.rowCount !== sourceEvidenceCatalog.rows.length
    ) {
      throw new ConflictException('AILY_SEMANTIC_PROJECTION_COUNT_INVALID');
    }
    for (const table of [
      criterionTable,
      resourceTable,
      sourceEvidenceCatalog,
    ]) {
      if (
        table.rows.some((row) => row.length !== table.columns.length) ||
        hashCanonical(table.rows) !== table.projectedContentHash
      ) {
        throw new ConflictException('AILY_SEMANTIC_PROJECTION_HASH_INVALID');
      }
    }
  }
  const {
    transportId: _transportId,
    transportHash: _transportHash,
    ...identity
  } = input;
  const expectedHash = hashCanonical(identity);
  const expectedId = `AHI-${digest(expectedHash).slice(0, 24).toUpperCase()}`;
  if (
    input.transportHash !== expectedHash ||
    input.transportId !== expectedId
  ) {
    throw new ConflictException('AILY_HOLISTIC_TRANSPORT_IDENTITY_INVALID');
  }
}

function projectSemanticEvaluationContext(
  context: EvaluationContextPackageResponse,
): AilySemanticEvaluationContext {
  const sourceCandidates = new Map<string, CriterionCard['sourceEvidenceCandidates'][number]>();
  for (const card of context.criterionCards) {
    for (const candidate of card.sourceEvidenceCandidates) {
      const existing = sourceCandidates.get(candidate.candidateId);
      if (existing && stableCanonical(existing) !== stableCanonical(candidate)) {
        throw new ConflictException('AILY_SOURCE_CANDIDATE_ID_CONFLICT');
      }
      sourceCandidates.set(candidate.candidateId, candidate);
    }
  }
  const artifactRefs = [
    ...new Set(
      [...sourceCandidates.values()].flatMap((candidate) =>
        candidate.sourceRefs.map((sourceRef) => sourceRef.artifactRef),
      ),
    ),
  ].sort();
  const artifactIndexes = new Map(
    artifactRefs.map((artifactRef, index) => [artifactRef, index]),
  );

  const criterionColumns = [
    'sequence',
    'criterionId',
    'criterionVersionId',
    'criterionHash',
    'question',
    'predicateResult',
    'normativeForce',
    'status',
    'candidateConclusion',
    'missingInformation',
    'sourceEvidenceCandidateIds',
    'engineerReview',
  ];
  const criterionRows = context.criterionCards.map((card) => [
    card.sequence,
    card.criterionId,
    card.criterionVersionId,
    card.criterionHash,
    card.question,
    card.predicateResult,
    card.normativeForce,
    card.status,
    card.candidateConclusion,
    card.missingInformation,
    card.sourceEvidenceCandidates.map((candidate) => candidate.candidateId),
    card.engineerReview,
  ]);
  const encodedCriteria = encodeSemanticTableValues(
    criterionColumns,
    criterionRows,
    [
      'predicateResult',
      'normativeForce',
      'status',
      'candidateConclusion',
      'sourceEvidenceCandidateIds',
      'engineerReview',
    ],
  );
  const resourceColumns = ['criterionId', 'availabilityStatus'];
  const resourceRows = context.resourceAssessments.map((resource) => [
    resource.criterionId,
    resource.availabilityStatus,
  ]);
  const encodedResources = encodeSemanticTableValues(
    resourceColumns,
    resourceRows,
    ['availabilityStatus'],
  );
  const resourceTypes = [
    ...new Set(context.resourceAssessments.map((resource) => resource.resourceType)),
  ];
  if (resourceTypes.length !== 1) {
    throw new ConflictException('AILY_SEMANTIC_RESOURCE_TYPE_NOT_UNIFORM');
  }
  const sourceCandidateRows = [...sourceCandidates.values()]
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    .map((candidate) => [
      candidate.candidateId,
      candidate.fieldPath,
      candidate.sourceRefs.map((sourceRef) => [
        artifactIndexes.get(sourceRef.artifactRef),
        sourceRef.sourceUnitId,
        sourceRef.locator.pageStart,
        sourceRef.locator.pageEnd,
      ]),
    ]);
  const structured = context.structuredAssessmentContext;
  const summarizeSource = (
    source: typeof structured.applicability.source,
  ) => {
    if (source === null) return null;
    const firstSourceRef = source.sourceRefs[0];
    const locator = firstSourceRef?.locator;
    const locatorRecord =
      locator && typeof locator === 'object' && !Array.isArray(locator)
        ? locator as Record<string, unknown>
        : null;
    if (
      locator !== undefined &&
      (!locatorRecord ||
        typeof locatorRecord.pageStart !== 'number' ||
        (locatorRecord.pageEnd !== undefined &&
          typeof locatorRecord.pageEnd !== 'number'))
    ) {
      throw new ConflictException('AILY_STRUCTURED_SOURCE_LOCATOR_INVALID');
    }
    return {
      sourceUnitIds: source.sourceUnitIds,
      pageRange: locatorRecord
        ? {
          startPage: locatorRecord.pageStart,
          endPage: locatorRecord.pageEnd ?? locatorRecord.pageStart,
        }
        : null,
    };
  };
  const investigation = context.latestInvestigation;

  return {
    schemaVersion: 'wiselink.v3_1.sb_job_aid.aily_semantic_projection.v1',
    sourceContextIdentity: {
      contextId: context.contextId,
      contextHash: context.contextHash,
      evaluationItemSetHash: context.evaluationItemSetHash,
      criterionCardsContentHash: hashCanonical(context.criterionCards),
      resourceAssessmentsContentHash: hashCanonical(
        context.resourceAssessments,
      ),
      sourceEvidenceCandidatesContentHash: hashCanonical(
        [...sourceCandidates.values()].sort((left, right) =>
          left.candidateId.localeCompare(right.candidateId),
        ),
      ),
      latestInvestigationRunHash: investigation?.runHash ?? null,
    },
    manifest: context.manifest,
    currentAssessment: context.currentAssessment,
    ...(context.parsedSourceContext
      ? { parsedSourceContext: context.parsedSourceContext }
      : {}),
    structuredAssessmentContext: {
      schemaVersion: structured.schemaVersion,
      applicability: {
        availability: structured.applicability.availability,
        rawText: structured.applicability.rawText,
        source: summarizeSource(structured.applicability.source),
      },
      concurrentRequirements: {
        availability: structured.concurrentRequirements.availability,
        entries: structured.concurrentRequirements.entries.map((entry) => ({
          requirementState: entry.requirementState,
          normalizedPresence: entry.normalizedPresence,
          requirementsStructured: entry.requirementsStructured,
          documentRequirements: entry.documentRequirements,
          nonDocumentRequirements: entry.nonDocumentRequirements,
          retrievalEvaluationLoopRequired:
            entry.retrievalEvaluationLoopRequired,
          rawText: entry.rawText,
          source: summarizeSource(entry.source),
        })),
      },
      workInstructions: {
        availability: structured.workInstructions.availability,
        stepCount: structured.workInstructions.stepCount,
        stepIds: structured.workInstructions.stepIds,
        steps: structured.workInstructions.steps.map((step) => ({
          stepPath: step.stepPath,
          workPackageNumber: step.workPackageNumber,
          workPackageTitle: step.workPackageTitle,
          stepLabel: step.stepLabel,
          instructionText: step.instructionText,
          sourcePage: step.sourcePage,
          source: summarizeSource(step.source),
        })),
      },
      authorityBoundary: structured.authorityBoundary,
    },
    resourceSummary: context.resourceSummary,
    criterionTable: {
      columns: criterionColumns,
      rows: encodedCriteria.rows,
      rowCount: encodedCriteria.rows.length,
      projectedContentHash: hashCanonical(encodedCriteria.rows),
      valueDictionaries: encodedCriteria.valueDictionaries,
      evaluationItemIdTemplate: '{assessmentPackageId}:{criterionId}',
    },
    resourceTable: {
      columns: resourceColumns,
      rows: encodedResources.rows,
      rowCount: encodedResources.rows.length,
      projectedContentHash: hashCanonical(encodedResources.rows),
      valueDictionaries: encodedResources.valueDictionaries,
      requirementIdTemplate: '{criterionId}-R-COMPAT-001',
      resourceTypeDefault: resourceTypes[0],
      validationStatusPolicy: {
        AVAILABLE_VERIFIED: 'VERIFIED',
        AVAILABLE_CANDIDATE: 'CANDIDATE_ONLY',
        OTHERWISE: 'NOT_VALIDATED',
      },
      missingReasonSource:
        'criterionTable.missingInformation when availabilityStatus=MISSING',
      missingPolicy: '保持信息不足；可分析影响但不得补造事实，需补充受控资料或工程师判断。',
      authorityBoundary: 'candidate_only',
    },
    sourceEvidenceCatalog: {
      columns: [
        'candidateId',
        'fieldPath',
        'sourceRefs(artifactRefIndex,sourceUnitId,pageStart,pageEnd)',
      ],
      rows: sourceCandidateRows,
      rowCount: sourceCandidateRows.length,
      projectedContentHash: hashCanonical(sourceCandidateRows),
      artifactRefs,
      authorityBoundary: 'candidate_only',
      createsEvidenceRef: false,
    },
    historicalContext: context.historicalContext,
    similarCaseContext: context.similarCaseContext,
    knowledgeContext: context.knowledgeContext,
    latestInvestigation: investigation
      ? {
        runId: investigation.runId,
        runHash: investigation.runHash,
        status: investigation.status,
        stopReason: investigation.stopReason,
        modelIdentityStatus: investigation.modelIdentityStatus,
        questions: investigation.questions.map((question) => ({
          questionId: question.questionId,
          questionKey: question.questionKey,
          question: question.question,
          status: question.status,
          affectedCriterionIds: question.affectedCriterionIds,
          resolutionSummary: question.resolutionSummary,
          nextAction: question.nextAction,
          assumptions: question.assumptions,
        })),
        toolResults: investigation.toolSnapshots.map((toolSnapshot) => ({
          toolId: toolSnapshot.toolId,
          status: toolSnapshot.status,
          resultClassification: toolSnapshot.resultClassification,
          resultSummary: toolSnapshot.resultSummary,
          sourceVersions: toolSnapshot.sourceVersions,
          locatorCount: toolSnapshot.locators.length,
        })),
      }
      : null,
    authorityBoundary: context.authorityBoundary,
    projectionNotes: [
      `${context.criterionCards.length} 条 criterion、${context.resourceAssessments.length} 条 resource 均逐行保留；valueDictionaries[column][整数] 还原枚举/对象值。`,
      '41 个候选保留 candidateId、fieldPath、artifact/SourceUnit/页码；完整数组 hash 绑定 Base 真源。',
      '可重建字段及调查/locator 重复副本不重复传输；ECP、ItemSet、Resource、Candidate、Investigation hash 均保留。',
    ],
  };
}

function encodeSemanticTableValues(
  columns: string[],
  sourceRows: unknown[][],
  dictionaryColumns: string[],
): { rows: unknown[][]; valueDictionaries: Record<string, unknown[]> } {
  const rows = sourceRows.map((row) => [...row]);
  const valueDictionaries: Record<string, unknown[]> = {};
  for (const column of dictionaryColumns) {
    const columnIndex = columns.indexOf(column);
    if (columnIndex < 0) {
      throw new ConflictException('AILY_SEMANTIC_DICTIONARY_COLUMN_MISSING');
    }
    const values: unknown[] = [];
    const indexes = new Map<string, number>();
    for (const row of rows) {
      const key = stableCanonical(row[columnIndex]);
      let valueIndex = indexes.get(key);
      if (valueIndex === undefined) {
        valueIndex = values.length;
        indexes.set(key, valueIndex);
        values.push(row[columnIndex]);
      }
      row[columnIndex] = valueIndex;
    }
    valueDictionaries[column] = values;
  }
  return { rows, valueDictionaries };
}

function projectUniformRows<T extends object>(records: T[]): AilyTabularProjection {
  if (records.length === 0) {
    throw new ConflictException('AILY_TABULAR_PROJECTION_EMPTY');
  }
  const columns = Object.keys(records[0]).sort();
  const expectedColumns = stableCanonical(columns);
  const rows = records.map((record) => {
    const observedColumns = Object.keys(record).sort();
    if (stableCanonical(observedColumns) !== expectedColumns) {
      throw new ConflictException('AILY_TABULAR_PROJECTION_COLUMNS_MISMATCH');
    }
    const source = record as Record<string, unknown>;
    return columns.map((column) => source[column]);
  });
  return {
    schemaVersion: AILY_HOLISTIC_TABULAR_PROJECTION_SCHEMA,
    columns,
    rows,
    rowCount: rows.length,
    contentHash: hashCanonical(records),
  };
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256')
    .update(stableCanonical(value), 'utf8')
    .digest('hex')}`;
}

function digest(hash: string): string {
  return hash.replace(/^sha256:/u, '');
}

function stableCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableCanonical(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableCanonical(record[key])}`)
    .join(',')}}`;
}
