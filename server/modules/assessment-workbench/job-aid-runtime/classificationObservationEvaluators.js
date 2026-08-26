import {
  JOB_AID_EVALUATION_AVAILABILITY,
  classifyJobAidEvaluationAvailability,
} from './evaluationAvailability.js';

export const WISELINK_V3_1_CLASSIFICATION_OBSERVATION_METHOD_SCHEMA =
  'wiselink.v3_1.jobaid.classification_observation_evaluation.v1';

const SUPPORTED_CRITERION_IDS = new Set(['CLS-005', 'CLS-006']);
const FLAG_DEFINITIONS = Object.freeze([
  Object.freeze({
    flagId: 'ALERT_FLAG',
    pattern: /\balert\s+service\s+bulletin\b/iu,
  }),
  Object.freeze({
    flagId: 'AOT_FLAG',
    pattern: /\ball\s+operators\s+telex\b|\bAOT\b/iu,
  }),
  Object.freeze({
    flagId: 'SPECIAL_ATTENTION_FLAG',
    pattern: /\bspecial\s+attention\b/iu,
  }),
]);
const MANUFACTURER_STATEMENT_PATTERNS = Object.freeze([
  /\bno\s+compliance\s+time\s+is\s+given\b/iu,
  /\bboeing\s+recommends\s+this\s+service\s+bulletin\b/iu,
  /\brecommended\b/iu,
  /\bdesirable\b/iu,
  /\boptional\b/iu,
]);

export function describeClassificationObservationMethod({
  criterion,
  input,
} = {}) {
  const criterionId = String(criterion?.criterion_id ?? '');
  if (!SUPPORTED_CRITERION_IDS.has(criterionId)) return null;
  const pageSourceRefs = pageRefs(input);
  const coverageComplete = completeCoverage(input);
  const matchedStatementRefs =
    criterionId === 'CLS-006'
      ? matchingManufacturerStatementRefs(pageSourceRefs)
      : [];
  const dataSourceConnected =
    criterionId === 'CLS-005'
      ? coverageComplete && pageSourceRefs.length > 0
      : matchedStatementRefs.length > 0;
  const availability = classifyJobAidEvaluationAvailability({
    dataSourceConnected,
  });
  const missingInputs = dataSourceConnected
    ? []
    : criterionId === 'CLS-005'
      ? [
          missingInput(
            'CLS005_COMPLETE_PRESERVED_TEXT_COVERAGE_REQUIRED',
            '标题、编号、首页标识、首段建议以及完整 preserved-text 覆盖',
            'coverage 不完整时，未命中不能解释为未观察到 Alert/AOT/SPECIAL ATTENTION。',
            JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
          ),
        ]
      : [
          missingInput(
            'CLS006_MANUFACTURER_STATEMENT_SOURCE_NOT_CONNECTED',
            'Evaluation Table、Compliance、Reason、Summary 的 frozen.2 SourceRef',
            '没有来源绑定的 Compliance/Recommendation 原话，不能构造厂家推荐观察。',
            JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
          ),
        ];

  return descriptor({
    criterion,
    criterionId,
    availability,
    missingInputs,
    sourceFacts:
      criterionId === 'CLS-005'
        ? coverageFacts(input, pageSourceRefs)
        : statementFacts(matchedStatementRefs),
  });
}

export function executeClassificationObservationMethod({
  criterion,
  input,
  descriptor: base,
} = {}) {
  const criterionId = String(criterion?.criterion_id ?? '');
  if (!SUPPORTED_CRITERION_IDS.has(criterionId) || !base) return null;
  return criterionId === 'CLS-005'
    ? evaluateAlertFlags({ criterion, input, base })
    : evaluateManufacturerRecommendation({ criterion, input, base });
}

export function markClassificationPredicateOutcome(
  descriptorValue,
  applicable,
) {
  if (!descriptorValue) return null;
  const availability = classifyJobAidEvaluationAvailability({ applicable });
  return completeDescriptor(descriptorValue, {
    state:
      applicable === false ? 'NOT_RUN_PREDICATE_FALSE' : descriptorValue.state,
    availability,
    observations: descriptorValue.observations,
    missingInputs: descriptorValue.missingInputs,
    sourceFacts: descriptorValue.engineerPresentation.sourceFacts,
  });
}

function evaluateAlertFlags({ criterion, input, base }) {
  const sourceRefs = pageRefs(input);
  if (!completeCoverage(input) || sourceRefs.length === 0) {
    const missingInputs = [
      missingInput(
        'CLS005_COMPLETE_PRESERVED_TEXT_COVERAGE_REQUIRED',
        '标题、编号、首页标识、首段建议以及完整 preserved-text 覆盖',
        'coverage 不完整时，未命中不能解释为未观察到 Alert/AOT/SPECIAL ATTENTION。',
        JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
      ),
    ];
    return waitingResult({
      criterion,
      base,
      missingInputs,
      sourceFacts: coverageFacts(input, sourceRefs),
      observations: [
        {
          observationId: 'PRESERVED_TEXT_COVERAGE',
          state: 'COVERAGE_INCOMPLETE',
          value: coverageObservation(input, sourceRefs),
          sourceRefIds: sourceRefs.map((sourceRef) => sourceRef.sourceRefId),
        },
      ],
    });
  }

  const flags = FLAG_DEFINITIONS.map((definition) => {
    const matches = sourceRefs.filter((sourceRef) =>
      definition.pattern.test(String(sourceRef.quote ?? '')),
    );
    return {
      flagId: definition.flagId,
      observationState:
        matches.length > 0
          ? 'OBSERVED_SOURCE_BOUND'
          : 'NOT_OBSERVED_WITH_COMPLETE_PRESERVED_TEXT',
      sourceRefIds: matches.map((sourceRef) => sourceRef.sourceRefId),
      quoteExcerpts: matches.map((sourceRef) =>
        excerptAroundPattern(sourceRef.quote, definition.pattern),
      ),
    };
  });
  const observedFlagIds = flags
    .filter((flag) => flag.observationState === 'OBSERVED_SOURCE_BOUND')
    .map((flag) => flag.flagId);
  const inspectionSourceRefIds = unique(
    sourceRefs.map((sourceRef) => sourceRef.sourceRefId),
  );
  const sourceFacts = coverageFacts(input, sourceRefs);
  const observations = flags.map((flag) => ({
    observationId: flag.flagId,
    state: flag.observationState,
    value: flag.observationState === 'OBSERVED_SOURCE_BOUND',
    sourceRefIds: flag.sourceRefIds,
  }));

  return reviewResult({
    criterion,
    base,
    extractedFacts: {
      flags,
      observedFlagIds,
      coverage: {
        ...coverageObservation(input, sourceRefs),
        inspectionSourceRefIds,
      },
    },
    observations,
    sourceFacts,
    rationale:
      observedFlagIds.length > 0
        ? `来源观察到 ${observedFlagIds.join('、')}；其 DS093/OEM 工程语义仍需逐项复核。`
        : '完整 preserved-text coverage 中未观察到 Alert、AOT 或 SPECIAL ATTENTION；这是受限负观察，不是“不存在”、PASS 或执行结论。',
  });
}

function evaluateManufacturerRecommendation({ criterion, input, base }) {
  const matches = matchingManufacturerStatementRefs(pageRefs(input));
  if (matches.length === 0) {
    const missingInputs = [
      missingInput(
        'CLS006_MANUFACTURER_STATEMENT_SOURCE_NOT_CONNECTED',
        'Evaluation Table、Compliance、Reason、Summary 的 frozen.2 SourceRef',
        '没有来源绑定的 Compliance/Recommendation 原话，不能构造厂家推荐观察。',
        JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
      ),
    ];
    return waitingResult({
      criterion,
      base,
      missingInputs,
      sourceFacts: [],
      observations: [],
    });
  }

  const rawManufacturerStatements = unique(
    matches.map((sourceRef) =>
      excerptAroundPattern(
        sourceRef.quote,
        firstMatchingPattern(sourceRef.quote),
      ),
    ),
  );
  const allText = matches.map((sourceRef) => sourceRef.quote).join('\n');
  const normalizedObservation = {
    noComplianceTimeGiven: /\bno\s+compliance\s+time\s+is\s+given\b/iu.test(
      allText,
    ),
    recommendationTerms: ['recommended', 'desirable', 'optional'].filter(
      (term) => new RegExp(`\\b${term}\\b`, 'iu').test(allText),
    ),
    boeingRecommendationObserved:
      /\bboeing\s+recommends\s+this\s+service\s+bulletin\b/iu.test(allText),
  };
  const sourceFacts = statementFacts(matches);
  return reviewResult({
    criterion,
    base,
    extractedFacts: {
      rawManufacturerStatements,
      normalizedObservation,
      companyExecutionDecision: null,
    },
    observations: [
      {
        observationId: 'MANUFACTURER_RECOMMENDATION',
        state: 'OBSERVED_SOURCE_BOUND',
        value: normalizedObservation,
        sourceRefIds: matches.map((sourceRef) => sourceRef.sourceRefId),
      },
    ],
    sourceFacts,
    rationale:
      '已提取厂家 Compliance/Recommendation 原话并保留 SourceRef；该观察不是公司执行或不执行结论，仍需工程师结合其他受控证据决定。',
  });
}

function descriptor({
  criterion,
  criterionId,
  availability,
  missingInputs,
  sourceFacts,
}) {
  return {
    schemaVersion: WISELINK_V3_1_CLASSIFICATION_OBSERVATION_METHOD_SCHEMA,
    evaluatorId: `jobaid-v0.2.${criterionId}.source-observation`,
    evaluatorVersion: '1.0.0',
    criterionId,
    state: missingInputs.length > 0 ? 'WAITING_INPUT' : 'READY_FOR_PREDICATE',
    availability,
    observations: [],
    missingInputs,
    sourceRefs: unique(sourceFacts.flatMap((fact) => fact.sourceRefIds)),
    sourceRefsAreEvidenceRefs: false,
    outputAuthorityLevel: 'candidate_only',
    engineerPresentation: {
      evaluationProblem: {
        question: String(criterion.evaluation_question),
      },
      lifecycle: {
        phase: 'DOCUMENT_CLASSIFICATION',
        state: availability,
      },
      requiredEvidence: {
        document: String(criterion.required_doc_evidence ?? ''),
        external: String(criterion.required_external_evidence ?? ''),
      },
      sourceFacts,
      specializedMethod: methodFor(criterionId),
      authorityBoundary: authorityBoundaryFor(criterionId),
    },
  };
}

function methodFor(criterionId) {
  if (criterionId === 'CLS-005') {
    return {
      pattern: 'EXHAUSTIVE_THREE_FLAG_SOURCE_INSPECTION',
      steps: [
        '验证 frozen.2 accountingComplete 与 contentPreserved，并取得每页 inspection SourceRef。',
        '分别检索 Alert Service Bulletin、All Operators Telex/AOT、SPECIAL ATTENTION。',
        '每个标志独立显示命中、完整覆盖下未观察到或覆盖不足；不合并成 PASS。',
      ],
    };
  }
  return {
    pattern: 'MANUFACTURER_RECOMMENDATION_SOURCE_EXTRACTION',
    steps: [
      '从 preserved page SourceRefs 定位 Compliance/Recommendation 原话。',
      '原文与规范化观察并存，不虚构厂家未提供的等级。',
      '厂家推荐只成为综合判断输入，不映射公司执行/不执行。',
    ],
  };
}

function authorityBoundaryFor(criterionId) {
  return {
    machine:
      criterionId === 'CLS-005'
        ? '机器只报告三个标志的来源命中或完整 coverage 下的负观察，不决定紧急级别。'
        : '机器只提取厂家 Compliance/Recommendation 原话和规范化观察，不生成公司执行决定。',
    engineer:
      criterionId === 'CLS-005'
        ? '工程师按 DS093/OEM 规则分别确认各标志是否需要提级；未观察到不等于不存在。'
        : '工程师结合风险、适用性、运行、成本与计划等受控证据决定公司行动。',
    candidateOnly: true,
    createsEngineerDecision: false,
    createsEvidenceRef: false,
    createsCompanyExecutionDecision: false,
  };
}

function reviewResult({
  criterion,
  base,
  extractedFacts,
  observations,
  sourceFacts,
  rationale,
}) {
  return {
    status: '需人工复核',
    decision: '需人工判断',
    extracted_facts: extractedFacts,
    rationale,
    confidence: null,
    blocking_condition_met: false,
    missing_inputs: [],
    method_execution: completeDescriptor(base, {
      state: 'COMPLETED_SOURCE_OBSERVATION_REVIEW_REQUIRED',
      availability: JOB_AID_EVALUATION_AVAILABILITY.ENGINEER_DECISION_REQUIRED,
      observations,
      missingInputs: [],
      sourceFacts,
    }),
    evaluator_boundary: {
      criterionId: criterion.criterion_id,
      candidateOnly: true,
      createsEngineerDecision: false,
      createsEvidenceRef: false,
      createsCompanyExecutionDecision: false,
    },
  };
}

function waitingResult({
  criterion,
  base,
  missingInputs,
  sourceFacts,
  observations,
}) {
  return {
    status: '需补证据',
    decision: '信息不足',
    extracted_facts: observations.length > 0 ? { observations } : null,
    rationale: missingInputs.map((entry) => entry.reason).join('；'),
    confidence: null,
    blocking_condition_met: false,
    missing_inputs: missingInputs,
    method_execution: completeDescriptor(base, {
      state: 'WAITING_INPUT',
      availability: JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
      observations,
      missingInputs,
      sourceFacts,
    }),
    evaluator_boundary: {
      criterionId: criterion.criterion_id,
      candidateOnly: true,
      createsEngineerDecision: false,
      createsEvidenceRef: false,
      createsCompanyExecutionDecision: false,
    },
  };
}

function completeDescriptor(
  base,
  { state, availability, observations, missingInputs, sourceFacts },
) {
  return {
    ...base,
    state,
    availability,
    observations,
    missingInputs,
    sourceRefs: unique(sourceFacts.flatMap((fact) => fact.sourceRefIds)),
    engineerPresentation: {
      ...base.engineerPresentation,
      lifecycle: {
        ...base.engineerPresentation.lifecycle,
        state: availability,
      },
      sourceFacts,
    },
  };
}

function coverageFacts(input, sourceRefs) {
  return [
    {
      factType: 'PRESERVED_TEXT_COVERAGE',
      value: coverageObservation(input, sourceRefs),
      sourceRefIds: sourceRefs.map((sourceRef) => sourceRef.sourceRefId),
      sourceBounded: true,
      negativeObservationAnchorOnly: true,
      authorityLevel: 'candidate_only',
    },
  ];
}

function statementFacts(sourceRefs) {
  return sourceRefs.map((sourceRef) => ({
    factType: 'MANUFACTURER_COMPLIANCE_RECOMMENDATION',
    value: excerptAroundPattern(
      sourceRef.quote,
      firstMatchingPattern(sourceRef.quote),
    ),
    sourceRefIds: [sourceRef.sourceRefId],
    sourceBounded: true,
    authorityLevel: 'candidate_only',
  }));
}

function coverageObservation(input, sourceRefs) {
  const coverage = input?.publicPackageObservation?.sourceCoverage;
  return {
    accountingComplete: coverage?.accountingComplete === true,
    contentPreserved: coverage?.contentPreserved === true,
    pageSourceRefCount: sourceRefs.length,
  };
}

function completeCoverage(input) {
  const coverage = input?.publicPackageObservation?.sourceCoverage;
  return (
    coverage?.accountingComplete === true && coverage?.contentPreserved === true
  );
}

function pageRefs(input) {
  const refs = input?.publicPackageObservation?.pageSourceRefs;
  if (!Array.isArray(refs)) return [];
  return refs.filter(
    (ref) =>
      typeof ref?.sourceRefId === 'string' &&
      ref.sourceRefId.length > 0 &&
      typeof ref.quote === 'string',
  );
}

function matchingManufacturerStatementRefs(sourceRefs) {
  return sourceRefs.filter((sourceRef) => {
    const quote = String(sourceRef.quote ?? '');
    const exactManufacturerStatement = MANUFACTURER_STATEMENT_PATTERNS.slice(
      0,
      2,
    ).some((pattern) => pattern.test(quote));
    const complianceClassification =
      /\bcompliance\b/iu.test(quote) &&
      MANUFACTURER_STATEMENT_PATTERNS.slice(2).some((pattern) =>
        pattern.test(quote),
      );
    return exactManufacturerStatement || complianceClassification;
  });
}

function firstMatchingPattern(value) {
  return (
    MANUFACTURER_STATEMENT_PATTERNS.find((pattern) =>
      pattern.test(String(value ?? '')),
    ) ?? MANUFACTURER_STATEMENT_PATTERNS[0]
  );
}

function excerptAroundPattern(value, pattern) {
  const normalized = String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  const index = normalized.search(pattern);
  if (index < 0) return normalized.slice(0, 360);
  const start = Math.max(0, index - 120);
  const end = Math.min(normalized.length, index + 360);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${
    end < normalized.length ? '...' : ''
  }`;
}

function missingInput(code, requiredEvidence, reason, reasonCategory) {
  return { code, requiredEvidence, reason, reasonCategory };
}

function unique(values) {
  return [...new Set(values)];
}
