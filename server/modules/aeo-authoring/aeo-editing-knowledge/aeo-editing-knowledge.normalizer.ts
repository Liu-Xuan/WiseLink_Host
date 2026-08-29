import {
  AEO_EDITING_KNOWLEDGE_VERSION,
  type AeoEditingActionUnit,
  type AeoEditingBranch,
  type AeoEditingDocumentIdentity,
  type AeoEditingInspectionDetail,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingSourceIdentity,
  type AeoEditingSourceRef,
  type AeoEditingValidationFinding,
  type AeoEditingValidationResult,
} from './aeo-editing-knowledge.types';
import { validateAeoEditingInput } from './aeo-editing-knowledge.validator';
import {
  array,
  arrayOrEmpty,
  category,
  compactDefined,
  compactStrings,
  companyScopeMissing,
  dependencyMissingMessages,
  inspectionFallbackBody,
  knowledgeVersion,
  missingLike,
  nestedSourceRefs,
  normalizeCompactRefs,
  normalizeRefs,
  normalizeReviewMessages,
  normalizeStrings,
  object,
  positiveInteger,
  recoveryConflicts,
  safetyNotes,
  string,
  stringOrNull,
  structureSkeleton,
  unique,
  uniqueRefs,
} from './aeo-editing-knowledge.normalizer.utils';

const NON_CLAIMS: string[] = [
  'Historical samples and frequencies do not establish a current engineering requirement.',
  'This candidate does not create approval, signature, publication, release, airworthiness truth, or aircraft work authorization.',
  'This candidate is not a WiseLink V1 completion gate and is not connected to TDMS, AAmis, or Aily.',
];

export function normalizeAeoEditingKnowledge(
  value: unknown,
  provenance?: unknown,
): AeoEditingKnowledgeCandidate {
  const validation: AeoEditingValidationResult = validateAeoEditingInput(value);
  if (!validation.valid) {
    throw new Error(
      `AEO_EDITING_INPUT_INVALID: ${validation.findings
        .map((finding: AeoEditingValidationFinding) => finding.code)
        .join(', ')}`,
    );
  }
  const record: Record<string, unknown> = object(value, 'knowledge');
  const recordType: string = string(record.recordType, 'recordType');
  if (recordType === 'local-aeo-editing-knowledge') {
    return normalizeEditingV0(record);
  }
  if (recordType === 'local-aeo-inspection-editing-knowledge') {
    return normalizeInspection(record, object(provenance, 'provenance'));
  }
  throw new Error(`AEO_EDITING_KNOWLEDGE_UNSUPPORTED: ${recordType}`);
}

function normalizeEditingV0(
  record: Record<string, unknown>,
): AeoEditingKnowledgeCandidate {
  if (record.lifecycleStatus !== 'CANDIDATE_ONLY') {
    throw new Error('AEO_EDITING_INPUT_NOT_CANDIDATE_ONLY');
  }
  const identity: Record<string, unknown> = object(
    record.documentIdentity,
    'documentIdentity',
  );
  const target: Record<string, unknown> = object(
    record.targetIdentity,
    'targetIdentity',
  );
  const actions: AeoEditingActionUnit[] = array(record.actions, 'actions').map(
    (value: unknown, index: number) => normalizeV0Action(value, index),
  );
  const reviews: string[] = normalizeReviewMessages(record.reviews);
  const missingInputs: string[] = unique([
    ...reviews.filter((message: string) => missingLike(message)),
    ...actions.flatMap((action: AeoEditingActionUnit) =>
      dependencyMissingMessages(action.unitId, action.dependencies),
    ),
    ...(stringOrNull(target.applicabilityStatus) === 'UNESTABLISHED'
      ? ['Current company aircraft applicability is unestablished.']
      : []),
    ...companyScopeMissing(target),
  ]);
  const conflicts: string[] = unique([
    ...reviews.filter((message: string) => !missingLike(message)),
    ...recoveryConflicts(record),
  ]);
  const documentIdentity: AeoEditingDocumentIdentity = {
    aeoNumber: string(identity.aeoNumber, 'documentIdentity.aeoNumber'),
    revision: string(identity.revision, 'documentIdentity.revision'),
    title: string(identity.title, 'documentIdentity.title'),
    category: category(identity.category),
    actualBytes: positiveInteger(
      identity.actualBytes,
      'documentIdentity.actualBytes',
    ),
    primarySourceId: string(
      identity.primarySourceId,
      'documentIdentity.primarySourceId',
    ),
    expectedHeader: string(
      identity.expectedHeader,
      'documentIdentity.expectedHeader',
    ),
    observedHeader: string(
      identity.observedHeader,
      'documentIdentity.observedHeader',
    ),
    identityLocator: string(
      identity.identityLocator,
      'documentIdentity.identityLocator',
    ),
  };
  const candidate: AeoEditingKnowledgeCandidate = {
    schemaVersion: AEO_EDITING_KNOWLEDGE_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    documentState:
      'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED',
    authority: 'EDITING_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE',
    documentIdentity,
    knowledgeVersion: knowledgeVersion(documentIdentity),
    sources: array(record.sources, 'sources').map(
      (value: unknown, index: number) => normalizeV0Source(value, index),
    ),
    actionUnits: actions,
    structureSkeleton: structureSkeleton(actions),
    applicableTemplateCandidateUnitIds: actions
      .filter(
        (action: AeoEditingActionUnit) =>
          !action.sourceDisposition.includes('COMPANY'),
      )
      .map((action: AeoEditingActionUnit) => action.unitId),
    companyStepCandidateUnitIds: actions
      .filter((action: AeoEditingActionUnit) =>
        action.sourceDisposition.includes('COMPANY'),
      )
      .map((action: AeoEditingActionUnit) => action.unitId),
    missingInputs,
    conflicts,
    sampleSupport: {
      sampleCount: 1,
      inferenceRule: 'FREQUENCY_NEVER_ESTABLISHES_ENGINEERING_REQUIREMENT',
    },
    nonClaims: unique([...normalizeStrings(record.nonClaims), ...NON_CLAIMS]),
  };
  return candidate;
}

function normalizeV0Source(
  value: unknown,
  index: number,
): AeoEditingSourceIdentity {
  const source: Record<string, unknown> = object(value, `sources[${index}]`);
  return {
    sourceId: string(source.sourceId, `sources[${index}].sourceId`),
    role: string(source.role, `sources[${index}].role`),
    artifactRef: string(source.location, `sources[${index}].location`),
    actualBytes: positiveInteger(
      source.actualBytes,
      `sources[${index}].actualBytes`,
    ),
    sha256: stringOrNull(source.sha256),
    observedIdentity: stringOrNull(source.observedIdentity),
    identityLocator: stringOrNull(source.identityLocator),
  };
}

function normalizeV0Action(
  value: unknown,
  index: number,
): AeoEditingActionUnit {
  const action: Record<string, unknown> = object(value, `actions[${index}]`);
  const text: Record<string, unknown> = object(
    action.text,
    `actions[${index}].text`,
  );
  const disposition: Record<string, unknown> = object(
    action.sourceDisposition,
    `actions[${index}].sourceDisposition`,
  );
  const execution: Record<string, unknown> = object(
    action.execution,
    `actions[${index}].execution`,
  );
  const parameters: unknown[] = arrayOrEmpty(action.parameters);
  const conditions: unknown[] = arrayOrEmpty(action.conditions);
  const branches: AeoEditingBranch[] = arrayOrEmpty(action.branches).map(
    (branch: unknown, branchIndex: number) =>
      normalizeV0Branch(branch, `actions[${index}].branches[${branchIndex}]`),
  );
  const dependencies: unknown[] = arrayOrEmpty(action.dependencies);
  const verifications: unknown[] = arrayOrEmpty(action.verifications);
  const closeout: unknown[] = arrayOrEmpty(action.closeout);
  return {
    unitId: string(action.unitId, `actions[${index}].unitId`),
    sequence: positiveInteger(action.sequence, `actions[${index}].sequence`),
    phase: string(action.phase, `actions[${index}].phase`),
    operation: string(action.operation, `actions[${index}].operation`),
    object: stringOrNull(action.object) ?? '',
    bodyZh: stringOrNull(text.zh),
    bodyEn: stringOrNull(text.en),
    parameters,
    conditions,
    dependencies,
    branches,
    sourceDisposition: string(
      disposition.decision,
      `actions[${index}].sourceDisposition.decision`,
    ),
    sourceRefs: uniqueRefs([
      ...normalizeRefs(disposition.sourceRefs),
      ...branches.flatMap((branch: AeoEditingBranch) => branch.sourceRefs),
      ...nestedSourceRefs(parameters),
      ...nestedSourceRefs(conditions),
      ...nestedSourceRefs(dependencies),
      ...nestedSourceRefs(verifications),
      ...nestedSourceRefs(closeout),
    ]),
    performerRoles: normalizeStrings(execution.performerRoles),
    inspectorRoles: normalizeStrings(execution.inspectorRoles),
    signatureGranularity: stringOrNull(execution.signatureGranularity),
    verifications,
    closeout,
    safetyNotes: safetyNotes(action, text),
    inspectionDetail: null,
    reviewStatus:
      stringOrNull(action.reviewStatus) === 'REVIEW_REQUIRED'
        ? 'REVIEW_REQUIRED'
        : 'CANDIDATE',
  };
}

function normalizeV0Branch(value: unknown, path: string): AeoEditingBranch {
  const branch: Record<string, unknown> = object(value, path);
  return {
    when: string(branch.when, `${path}.when`),
    then: string(branch.then, `${path}.then`),
    sourceRefs: normalizeRefs(branch.sourceRefs),
  };
}

function normalizeInspection(
  record: Record<string, unknown>,
  provenance: Record<string, unknown>,
): AeoEditingKnowledgeCandidate {
  if (
    record.status !== 'CANDIDATE_ONLY' ||
    provenance.status !== 'CANDIDATE_ONLY'
  ) {
    throw new Error('AEO_EDITING_INSPECTION_NOT_CANDIDATE_ONLY');
  }
  const sample: Record<string, unknown> = object(
    provenance.sample,
    'provenance.sample',
  );
  const sources: AeoEditingSourceIdentity[] = array(
    provenance.sources,
    'provenance.sources',
  ).map((value: unknown, index: number) =>
    normalizeInspectionSource(value, index),
  );
  const primarySourceId: string = string(record.sampleRef, 'sampleRef');
  const primarySource: AeoEditingSourceIdentity | undefined = sources.find(
    (source: AeoEditingSourceIdentity) => source.sourceId === primarySourceId,
  );
  if (!primarySource) {
    throw new Error(`AEO_EDITING_PRIMARY_SOURCE_MISSING: ${primarySourceId}`);
  }
  const detail: AeoEditingInspectionDetail = inspectionDetail(record);
  const actions: AeoEditingActionUnit[] = array(
    record.actionUnits,
    'actionUnits',
  ).map((value: unknown, index: number) =>
    normalizeInspectionAction(value, index, detail),
  );
  const identity: AeoEditingDocumentIdentity = {
    aeoNumber: string(sample.aeoNo, 'provenance.sample.aeoNo'),
    revision: string(sample.revision, 'provenance.sample.revision'),
    title: string(sample.topic, 'provenance.sample.topic'),
    category: category(sample.category),
    actualBytes: primarySource.actualBytes,
    primarySourceId,
    expectedHeader: `${string(sample.aeoNo, 'sample.aeoNo')}-${string(
      sample.revision,
      'sample.revision',
    )}`,
    observedHeader: primarySource.observedIdentity ?? '',
    identityLocator: primarySource.identityLocator ?? '',
  };
  return {
    schemaVersion: AEO_EDITING_KNOWLEDGE_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    documentState:
      'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED',
    authority: 'EDITING_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE',
    documentIdentity: identity,
    knowledgeVersion: knowledgeVersion(identity),
    sources,
    actionUnits: actions,
    structureSkeleton: structureSkeleton(actions),
    applicableTemplateCandidateUnitIds: actions
      .filter(
        (action: AeoEditingActionUnit) =>
          !action.sourceDisposition.includes('COMPANY'),
      )
      .map((action: AeoEditingActionUnit) => action.unitId),
    companyStepCandidateUnitIds: actions
      .filter((action: AeoEditingActionUnit) =>
        action.sourceDisposition.includes('COMPANY'),
      )
      .map((action: AeoEditingActionUnit) => action.unitId),
    missingInputs: unique([
      ...normalizeStrings(record.requiredEngineerDecisions),
      ...detail.explicitAbsences.map(
        (field: string) =>
          `Inspection input is absent in the sample: ${field}.`,
      ),
    ]),
    conflicts: normalizeReviewMessages(
      record.manufacturerToCompanyTransformations,
    ),
    sampleSupport: {
      sampleCount: 1,
      inferenceRule: 'FREQUENCY_NEVER_ESTABLISHES_ENGINEERING_REQUIREMENT',
    },
    nonClaims: unique([
      ...normalizeStrings(provenance.nonClaims),
      ...NON_CLAIMS,
    ]),
  };
}

function normalizeInspectionSource(
  value: unknown,
  index: number,
): AeoEditingSourceIdentity {
  const source: Record<string, unknown> = object(
    value,
    `provenance.sources[${index}]`,
  );
  return {
    sourceId: string(source.sourceId, `provenance.sources[${index}].sourceId`),
    role: string(source.role, `provenance.sources[${index}].role`),
    artifactRef: string(source.path, `provenance.sources[${index}].path`),
    actualBytes: positiveInteger(
      source.bytes,
      `provenance.sources[${index}].bytes`,
    ),
    sha256: stringOrNull(source.sha256),
    observedIdentity: stringOrNull(source.observedIdentity),
    identityLocator: stringOrNull(source.identityLocator),
  };
}

function normalizeInspectionAction(
  value: unknown,
  index: number,
  detail: AeoEditingInspectionDetail,
): AeoEditingActionUnit {
  const action: Record<string, unknown> = object(
    value,
    `actionUnits[${index}]`,
  );
  const refs: AeoEditingSourceRef[] = normalizeCompactRefs(action.sourceRefs);
  const branches: AeoEditingBranch[] = arrayOrEmpty(action.branches).map(
    (branch: unknown, branchIndex: number) => {
      const item: Record<string, unknown> = object(
        branch,
        `actionUnits[${index}].branches[${branchIndex}]`,
      );
      return {
        when: string(item.when, 'inspection branch.when'),
        then:
          stringOrNull(item.action) ??
          `Continue at ${string(item.next, 'inspection branch.next')}`,
        sourceRefs: refs,
      };
    },
  );
  const phase: string = string(action.phase, `actionUnits[${index}].phase`);
  const operation: string = string(
    action.operation,
    `actionUnits[${index}].operation`,
  );
  return {
    unitId: string(action.unitId, `actionUnits[${index}].unitId`),
    sequence: index + 1,
    phase,
    operation,
    object: stringOrNull(action.object) ?? '',
    bodyZh:
      stringOrNull(action.zh) ??
      inspectionFallbackBody(action, phase, operation),
    bodyEn: stringOrNull(action.en),
    parameters: compactDefined([
      action.location,
      action.condition,
      action.precondition,
      action.targetConfiguration,
      action.recordFields,
    ]),
    conditions: compactDefined([action.condition, action.precondition]),
    dependencies: [],
    branches,
    sourceDisposition: string(
      action.sourceDisposition,
      `actionUnits[${index}].sourceDisposition`,
    ),
    sourceRefs: refs,
    performerRoles: compactStrings([action.role]),
    inspectorRoles: compactStrings([action.inspectionRole]),
    signatureGranularity: action.role ? 'ROW' : null,
    verifications: compactDefined([action.missingExplicitVerification]),
    closeout: phase === 'CLOSEOUT' ? [operation] : [],
    safetyNotes: [],
    inspectionDetail:
      phase === 'INSPECTION' ||
      phase === 'FINDING_DISPOSITION' ||
      phase === 'CONDITIONAL_CORRECTION' ||
      phase === 'INSPECTION_RECORD'
        ? detail
        : null,
    reviewStatus: action.reviewNote ? 'REVIEW_REQUIRED' : 'CANDIDATE',
  };
}

function inspectionDetail(
  record: Record<string, unknown>,
): AeoEditingInspectionDetail {
  const definition: Record<string, unknown> = object(
    record.inspectionDefinition,
    'inspectionDefinition',
  );
  const explicitAbsences: string[] = arrayOrEmpty(
    record.inspectionSpecificFieldEvidence,
  ).flatMap((value: unknown) => {
    const item: Record<string, unknown> = object(
      value,
      'inspection field evidence',
    );
    return stringOrNull(item.status)?.includes('NOT_PRESENT')
      ? [string(item.field, 'inspection field')]
      : [];
  });
  return {
    area: object(definition.area, 'inspectionDefinition.area'),
    method: object(definition.method, 'inspectionDefinition.method'),
    referenceCondition: object(
      definition.referenceCondition,
      'inspectionDefinition.referenceCondition',
    ),
    thresholdsAndLimits: arrayOrEmpty(definition.thresholdsAndLimits),
    findingClassification: object(
      definition.findingClassification,
      'inspectionDefinition.findingClassification',
    ),
    repeatInterval: object(
      definition.repeatInterval,
      'inspectionDefinition.repeatInterval',
    ),
    ndt: object(definition.ndt, 'inspectionDefinition.ndt'),
    recording: object(definition.recording, 'inspectionDefinition.recording'),
    explicitAbsences,
  };
}
