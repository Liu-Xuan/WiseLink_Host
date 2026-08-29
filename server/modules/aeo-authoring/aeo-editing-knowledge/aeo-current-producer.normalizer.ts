import {
  type AeoEditingActionUnit,
  type AeoEditingCategory,
  type AeoEditingDocumentIdentity,
  type AeoEditingKnowledgeCandidate,
  type AeoEditingSourceIdentity,
  type AeoEditingSourceRef,
  AEO_EDITING_KNOWLEDGE_VERSION,
} from './aeo-editing-knowledge.types';
import {
  array,
  arrayOrEmpty,
  category,
  compactDefined,
  compactStrings,
  isCompanyStepDisposition,
  knowledgeVersion,
  normalizeCompactRefs,
  normalizeStrings,
  object,
  positiveInteger,
  safetyNotes,
  string,
  stringOrNull,
  structureSkeleton,
  unique,
} from './aeo-editing-knowledge.normalizer.utils';

const CURRENT_PRODUCER_NON_CLAIMS: string[] = [
  'Current producer samples remain editing evidence and do not establish a current engineering requirement.',
  'This candidate does not create approval, signature, publication, release, airworthiness truth, or aircraft work authorization.',
  'This candidate is not connected to TDMS, AAmis, or Aily.',
];

export function normalizeAeoCurrentProducer(
  record: Record<string, unknown>,
  provenance: Record<string, unknown>,
): AeoEditingKnowledgeCandidate {
  if (
    record.status !== 'CANDIDATE_ONLY' ||
    provenance.status !== 'CANDIDATE_ONLY'
  ) {
    throw new Error('AEO_CURRENT_PRODUCER_NOT_CANDIDATE_ONLY');
  }
  const sample: Record<string, unknown> = object(
    provenance.sample,
    'provenance.sample',
  );
  const sources: AeoEditingSourceIdentity[] = array(
    provenance.sources,
    'provenance.sources',
  ).map((value: unknown, index: number) => normalizeSource(value, index));
  const primarySourceId: string = string(record.sampleRef, 'sampleRef');
  const primarySource: AeoEditingSourceIdentity | undefined = sources.find(
    (source: AeoEditingSourceIdentity) => source.sourceId === primarySourceId,
  );
  if (!primarySource) {
    throw new Error(`AEO_EDITING_PRIMARY_SOURCE_MISSING: ${primarySourceId}`);
  }
  const documentIdentity: AeoEditingDocumentIdentity = identity(
    sample,
    primarySource,
  );
  const actionValues: unknown[] = array(record.actions, 'actions');
  const actions: AeoEditingActionUnit[] = actionValues.map(
    (value: unknown, index: number) => normalizeAction(value, index),
  );
  const sourceCandidates: unknown[] = [
    ...arrayOrEmpty(record.sourceCandidatesNotIncludedInAeo),
    ...arrayOrEmpty(record.sourceCandidatesNotIncludedOrNotExplicitInAeo),
  ];
  const reviewFlags: unknown[] = arrayOrEmpty(record.reviewFlags);
  const actionReviewNotes: string[] = actionValues.flatMap((value: unknown) => {
    const action: Record<string, unknown> = object(value, 'action');
    const note: string | null = stringOrNull(action.reviewNote);
    return note ? [note] : [];
  });
  return {
    schemaVersion: AEO_EDITING_KNOWLEDGE_VERSION,
    lifecycleStatus: 'CANDIDATE_ONLY',
    documentState:
      'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED',
    authority: 'EDITING_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE',
    documentIdentity,
    knowledgeVersion: knowledgeVersion(documentIdentity),
    sources,
    actionUnits: actions,
    structureSkeleton: structureSkeleton(actions),
    applicableTemplateCandidateUnitIds: actions
      .filter(
        (action: AeoEditingActionUnit) =>
          !isCompanyStepDisposition(action.sourceDisposition),
      )
      .map((action: AeoEditingActionUnit) => action.unitId),
    companyStepCandidateUnitIds: actions
      .filter((action: AeoEditingActionUnit) =>
        isCompanyStepDisposition(action.sourceDisposition),
      )
      .map((action: AeoEditingActionUnit) => action.unitId),
    missingInputs: unique([
      ...messagesForKey(record.sourceSelection, 'requiredReview'),
      ...messagesForKey(sourceCandidates, 'requiredDecision'),
    ]),
    conflicts: unique([
      ...actionReviewNotes,
      ...reviewFlags.map((flag: unknown) => reviewFlagMessage(flag)),
    ]),
    producerEvidence: {
      sourceSelection: optionalRecord(record.sourceSelection),
      figureUnits: arrayOrEmpty(record.figureUnits),
      reviewFlags,
      companyAddedOrSpecializedControls: arrayOrEmpty(
        record.companyAddedOrSpecializedControls,
      ),
      sourceCandidatesRequiringDecision: sourceCandidates,
      nonGeneralizable: normalizeStrings(record.nonGeneralizable),
    },
    sampleSupport: {
      sampleCount: 1,
      inferenceRule: 'FREQUENCY_NEVER_ESTABLISHES_ENGINEERING_REQUIREMENT',
    },
    nonClaims: unique([
      ...normalizeStrings(provenance.nonClaims),
      ...CURRENT_PRODUCER_NON_CLAIMS,
    ]),
  };
}

function identity(
  sample: Record<string, unknown>,
  primarySource: AeoEditingSourceIdentity,
): AeoEditingDocumentIdentity {
  const aeoNumber: string = string(sample.aeoNo, 'provenance.sample.aeoNo');
  const revision: string = string(
    sample.revision,
    'provenance.sample.revision',
  );
  return {
    aeoNumber,
    revision,
    title: string(sample.topic, 'provenance.sample.topic'),
    category: producerCategory(sample),
    actualBytes: primarySource.actualBytes,
    primarySourceId: primarySource.sourceId,
    expectedHeader: `${aeoNumber}-${revision}`,
    observedHeader: primarySource.observedIdentity ?? '',
    identityLocator: primarySource.identityLocator ?? '',
  };
}

function producerCategory(sample: Record<string, unknown>): AeoEditingCategory {
  const explicit: string | null = stringOrNull(sample.category);
  if (explicit) {
    return category(explicit);
  }
  const topic: string = string(sample.topic, 'provenance.sample.topic');
  if (/software|loadable|ldi\s+db/iu.test(topic)) {
    return 'SOFTWARE_INSTALLATION_UPDATE';
  }
  throw new Error('AEO_CURRENT_PRODUCER_CATEGORY_UNESTABLISHED');
}

function normalizeSource(
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

function normalizeAction(value: unknown, index: number): AeoEditingActionUnit {
  const action: Record<string, unknown> = object(value, `actions[${index}]`);
  const sequence: number = positiveInteger(
    action.item,
    `actions[${index}].item`,
  );
  const phase: string =
    stringOrNull(action.section) ??
    string(action.phase, `actions[${index}].phase`);
  const disposition: string = string(
    action.disposition,
    `actions[${index}].disposition`,
  );
  const refs: AeoEditingSourceRef[] = normalizeCompactRefs(action.sourceRefs);
  const body: Record<string, unknown> = {
    zh: action.zh,
    en: action.en,
  };
  return {
    unitId: `ACTION-${String(sequence).padStart(3, '0')}`,
    sequence,
    phase,
    operation:
      stringOrNull(action.operation) ??
      stringOrNull(action.executionRef) ??
      'EXECUTE_CANDIDATE_STEP',
    object: stringOrNull(action.object) ?? stringOrNull(action.target) ?? '',
    bodyZh: stringOrNull(action.zh),
    bodyEn: stringOrNull(action.en),
    parameters: compactDefined([
      namedValue('partNumber', action.partNumber),
      namedValue('target', action.target),
      namedValue('location', action.location),
      namedValue('executionRef', action.executionRef),
      namedValue('supersededPartNumbers', action.supersededPartNumbers),
    ]),
    conditions: [],
    dependencies: [],
    branches: [],
    sourceDisposition: disposition,
    sourceRefs: refs,
    performerRoles: compactStrings([action.role]),
    inspectorRoles: compactStrings([action.inspectionRole]),
    signatureGranularity: action.role ? 'ROW' : null,
    verifications: [],
    closeout:
      phase === 'CLOSEOUT'
        ? [{ kind: 'OBSERVED_CLOSEOUT_CANDIDATE', sourceRefs: refs }]
        : [],
    safetyNotes: safetyNotes(action, body),
    inspectionDetail: null,
    reviewStatus: action.reviewNote ? 'REVIEW_REQUIRED' : 'CANDIDATE',
  };
}

function namedValue(name: string, value: unknown): unknown {
  return value === undefined || value === null ? null : { name, value };
}

function messagesForKey(value: unknown, key: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => messagesForKey(item, key));
  }
  const record: Record<string, unknown> | null = optionalRecord(value);
  if (!record) {
    return [];
  }
  return Object.entries(record).flatMap(
    ([entryKey, child]: [string, unknown]) => {
      const own: string | null = entryKey === key ? stringOrNull(child) : null;
      return own ? [own] : messagesForKey(child, key);
    },
  );
}

function reviewFlagMessage(value: unknown): string {
  const flag: Record<string, unknown> = object(value, 'reviewFlag');
  return [
    stringOrNull(flag.severity),
    stringOrNull(flag.issue),
    stringOrNull(flag.requiredAction),
  ]
    .filter((item: string | null): item is string => Boolean(item))
    .join(': ');
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
