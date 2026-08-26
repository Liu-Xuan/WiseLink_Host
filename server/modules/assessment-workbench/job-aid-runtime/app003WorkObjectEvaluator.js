import {
  JOB_AID_EVALUATION_AVAILABILITY,
  classifyJobAidEvaluationAvailability,
} from './evaluationAvailability.js';

export const WISELINK_V3_1_APP003_METHOD_EVALUATION_SCHEMA =
  'wiselink.v3_1.jobaid.app003_work_object_evaluation.v1';

const APP003_CRITERION_ID = 'APP-003';
const APP003_METHOD_VERSION = '1.0.0';
const FIELD_PATHS = Object.freeze({
  AIRFRAME_SCOPE: 'coreFields.applicabilityRaw.value',
  WORK_INSTRUCTIONS: 'familyFields.workInstructionSteps.value[0]',
});
const COMPONENT_SCOPE_PATTERN =
  /\bspares?\s+affected\b|\bparts?\s+(?:number|modified|removed)\b|\breplace(?:d|ment)?\b|\bflight\s+management\s+computers?\b|\bFMCs?\b/iu;

export function buildApp003DiscoveryContext({ criterion, input } = {}) {
  if (criterion?.criterion_id !== APP003_CRITERION_ID) return {};
  const sourceScopeAvailable = [
    FIELD_PATHS.AIRFRAME_SCOPE,
    FIELD_PATHS.WORK_INSTRUCTIONS,
  ].some((path) => sourceBindingsFor(input, path).length > 0);
  return sourceScopeAvailable
    ? { work_scope: { object_level_unknown: true } }
    : {};
}

export function describeApp003EvaluationMethod({ criterion, input } = {}) {
  if (criterion?.criterion_id !== APP003_CRITERION_ID) return null;
  const airframeBindings = sourceBindingsFor(input, FIELD_PATHS.AIRFRAME_SCOPE);
  const workBindings = sourceBindingsFor(input, FIELD_PATHS.WORK_INSTRUCTIONS);
  const dataSourceConnected =
    airframeBindings.length > 0 && workBindings.length > 0;
  const missingInputs = dataSourceConnected
    ? []
    : [
        missingInput(
          'APP003_REQUIRED_WORK_OBJECT_SOURCE_ROUTE_INCOMPLETE',
          'Effectivity 与 Work Instructions/affected parts 的 frozen.2 SourceRef',
          `缺少${airframeBindings.length === 0 ? ' Effectivity' : ''}${
            workBindings.length === 0 ? ' Work Instructions/affected parts' : ''
          } 的来源绑定，不能选择机体或部件适用性分支。`,
          JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
        ),
      ];
  const availability = classifyJobAidEvaluationAvailability({
    dataSourceConnected,
  });

  return descriptor({
    criterion,
    state: dataSourceConnected ? 'READY_FOR_PREDICATE' : 'WAITING_INPUT',
    availability,
    missingInputs,
    sourceFacts: sourceFactsFor([...airframeBindings, ...workBindings]),
  });
}

export function executeApp003Evaluation({
  criterion,
  input,
  descriptor: base,
} = {}) {
  if (criterion?.criterion_id !== APP003_CRITERION_ID || !base) return null;
  const airframeBindings = sourceBindingsFor(input, FIELD_PATHS.AIRFRAME_SCOPE);
  const workBindings = sourceBindingsFor(input, FIELD_PATHS.WORK_INSTRUCTIONS);
  const allBindings = [...airframeBindings, ...workBindings];
  if (airframeBindings.length === 0 || workBindings.length === 0) {
    assertSourceBoundBindings(allBindings);
    const missingInputs = [
      missingInput(
        'APP003_REQUIRED_WORK_OBJECT_SOURCE_ROUTE_INCOMPLETE',
        'Effectivity 与 Work Instructions/affected parts 的 frozen.2 SourceRef',
        `缺少${airframeBindings.length === 0 ? ' Effectivity' : ''}${
          workBindings.length === 0 ? ' Work Instructions/affected parts' : ''
        } 的来源绑定，不能选择机体或部件适用性分支。`,
        JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
      ),
    ];
    return waitingResult({
      criterion,
      base,
      availability: JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
      missingInputs,
      observations: sourceObservations({ airframeBindings, workBindings }),
      sourceFacts: sourceFactsFor(allBindings),
    });
  }

  assertSourceBoundBindings(allBindings);
  const componentBindings = workBindings.filter((binding) =>
    COMPONENT_SCOPE_PATTERN.test(normalizeSourceText(binding.structuredValue)),
  );
  if (componentBindings.length === 0) {
    const missingInputs = [
      missingInput(
        'APP003_COMPONENT_SCOPE_NEGATIVE_REQUIRES_ENGINEER_CONFIRMATION',
        '受影响件号、拆装步骤和 Spares Affected',
        '当前来源只证明机体 Effectivity；未发现部件措辞不能自动证明不存在部件级条件。',
        JOB_AID_EVALUATION_AVAILABILITY.ENGINEER_DECISION_REQUIRED,
      ),
    ];
    return waitingResult({
      criterion,
      base,
      availability: JOB_AID_EVALUATION_AVAILABILITY.ENGINEER_DECISION_REQUIRED,
      missingInputs,
      observations: sourceObservations({ airframeBindings, workBindings }),
      sourceFacts: sourceFactsFor(allBindings),
    });
  }

  const missingInputs = [
    missingInput(
      'APP003_COMPONENT_APPLICABILITY_OWNER_RESULT_NOT_BOUND',
      '既有 APP-001/APP-002 与 FleetMasterData applicability owner 的同一 WorkItem/current 候选结果',
      'Job-Aid 已识别部件分支，但本 evaluator 不复制机队、部件或构型计算；必须消费既有 owner 结果。',
      JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
    ),
  ];
  const observations = sourceObservations({
    airframeBindings,
    workBindings: componentBindings,
  });
  const sourceFacts = sourceFactsFor(allBindings);
  return {
    status: '需补证据',
    decision: '信息不足',
    extracted_facts: {
      workObjectRoute: 'COMPONENT_APPLICABILITY_OWNER_REQUIRED',
      airframeScopeObserved: true,
      componentScopeObserved: true,
      requiredOwnerCriterionIds: ['APP-001', 'APP-002'],
      requiredOwner: 'FLEET_MASTER_DATA_APPLICABILITY',
      existingOwnerResultBound: false,
      sourceFacts,
    },
    rationale:
      '当前 frozen.2 来源同时显示飞机 Effectivity 与部件拆换工作；已确定必须进入既有部件适用性 owner，owner 结果未绑定前不输出适用/不适用结论。',
    confidence: null,
    blocking_condition_met: true,
    missing_inputs: missingInputs,
    method_execution: completeDescriptor(base, {
      state: 'COMPLETED_WAITING_FOR_EXISTING_OWNER',
      availability: JOB_AID_EVALUATION_AVAILABILITY.DATA_SOURCE_NOT_CONNECTED,
      observations,
      missingInputs,
      sourceFacts,
    }),
    evaluator_boundary: evaluatorBoundary(),
  };
}

export function markApp003PredicateOutcome(descriptorValue, applicable) {
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

function descriptor({
  criterion,
  state,
  availability,
  missingInputs,
  sourceFacts,
}) {
  return {
    schemaVersion: WISELINK_V3_1_APP003_METHOD_EVALUATION_SCHEMA,
    evaluatorId: 'jobaid-v0.2.APP-003.work-object-level',
    evaluatorVersion: APP003_METHOD_VERSION,
    criterionId: APP003_CRITERION_ID,
    state,
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
        phase: 'APPLICABILITY_DISCOVERY',
        state: availability,
      },
      requiredEvidence: {
        document: String(criterion.required_doc_evidence ?? ''),
        external: String(criterion.required_external_evidence ?? ''),
        ownerResult:
          'APP-001/APP-002 + FleetMasterData applicability candidate for the same WorkItem/current revision',
      },
      sourceFacts,
      specializedMethod: {
        pattern: 'WORK_OBJECT_LEVEL_CLASSIFICATION',
        steps: [
          '从来源绑定的 Effectivity 与 Work Instructions 发现工作对象和受影响件号/拆装动作。',
          '区分纯机体条件与可更换部件/软件条件；负观察不证明部件条件不存在。',
          '涉及部件时只路由到既有 APP-001/APP-002 与 FleetMasterData owner，不在 Job-Aid 内重算。',
        ],
      },
      authorityBoundary: {
        machine:
          '机器可识别工作对象层级、保留 SourceRef 并选择既有适用性 owner 路由；不能输出航空公司单机适用结论。',
        engineer:
          '工程师复核工作对象路由，并基于既有 APP-001/APP-002 与受控 FleetMasterData 结果确认后续判断。',
        candidateOnly: true,
        createsEngineerDecision: false,
        createsEvidenceRef: false,
      },
    },
  };
}

function waitingResult({
  criterion,
  base,
  availability,
  missingInputs,
  observations,
  sourceFacts,
}) {
  return {
    status: '需补证据',
    decision: '信息不足',
    extracted_facts: { observations, sourceFacts },
    rationale: missingInputs.map((entry) => entry.reason).join('；'),
    confidence: null,
    blocking_condition_met: true,
    missing_inputs: missingInputs,
    method_execution: completeDescriptor(base, {
      state: 'WAITING_INPUT',
      availability,
      observations,
      missingInputs,
      sourceFacts,
    }),
    evaluator_boundary: {
      ...evaluatorBoundary(),
      criterionId: criterion.criterion_id,
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

function sourceObservations({ airframeBindings, workBindings }) {
  return [
    ...(airframeBindings.length > 0
      ? [
          {
            observationId: 'AIRFRAME_SCOPE',
            state: 'OBSERVED_SOURCE_BOUND',
            value: true,
            sourceRefIds: sourceRefIdsFor(airframeBindings),
          },
        ]
      : []),
    ...(workBindings.length > 0
      ? [
          {
            observationId: 'COMPONENT_SCOPE',
            state: 'OBSERVED_SOURCE_BOUND',
            value: true,
            sourceRefIds: sourceRefIdsFor(workBindings),
          },
        ]
      : []),
  ];
}

function sourceFactsFor(bindings) {
  return bindings.map((binding) => ({
    fieldPath: binding.fieldPath,
    fact: excerpt(binding.structuredValue),
    sourceRefIds: sourceRefIdsFor([binding]),
    sourceBounded: true,
    authorityLevel: 'candidate_only',
  }));
}

function sourceBindingsFor(input, fieldPath) {
  const bindings = input?.upstreamBinding?.sourceBindings;
  if (!Array.isArray(bindings)) return [];
  return bindings.filter((binding) => binding?.fieldPath === fieldPath);
}

function assertSourceBoundBindings(bindings) {
  for (const binding of bindings) {
    if (
      binding?.sourceBounded !== true ||
      !Array.isArray(binding.sourceRefs) ||
      binding.sourceRefs.length === 0 ||
      !binding.sourceRefs.every(
        (sourceRef) =>
          typeof sourceRef?.sourceRefId === 'string' &&
          sourceRef.sourceRefId.length > 0,
      )
    ) {
      throw new Error('JOB_AID_APP003_SOURCE_BINDING_INVALID');
    }
  }
}

function sourceRefIdsFor(bindings) {
  return unique(
    bindings.flatMap((binding) =>
      binding.sourceRefs.map((sourceRef) => sourceRef.sourceRefId),
    ),
  );
}

function missingInput(code, requiredEvidence, reason, reasonCategory) {
  return { code, requiredEvidence, reason, reasonCategory };
}

function evaluatorBoundary() {
  return {
    criterionId: APP003_CRITERION_ID,
    candidateOnly: true,
    createsEngineerDecision: false,
    createsEvidenceRef: false,
    writesApplicabilityCurrent: false,
  };
}

function normalizeSourceText(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return String(raw ?? '')
    .normalize('NFKC')
    .replaceAll('\r\n', '\n')
    .replace(/[ \t]+/gu, ' ')
    .trim();
}

function excerpt(value) {
  const normalized = normalizeSourceText(value).replace(/\s+/gu, ' ');
  const componentIndex = normalized.search(COMPONENT_SCOPE_PATTERN);
  if (componentIndex >= 0) {
    const start = Math.max(0, componentIndex - 140);
    const end = Math.min(normalized.length, componentIndex + 360);
    return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${
      end < normalized.length ? '...' : ''
    }`;
  }
  return normalized.length > 360
    ? `${normalized.slice(0, 357)}...`
    : normalized;
}

function unique(values) {
  return [...new Set(values)];
}
