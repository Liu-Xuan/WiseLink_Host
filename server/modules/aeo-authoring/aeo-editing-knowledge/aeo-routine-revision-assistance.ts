import type {
  AeoEditingSourceIdentity,
  AeoRoutineRevisionReplayCandidate,
  AeoRoutineRevisionSlot,
  AeoRoutineRevisionSlotEdit,
} from './aeo-editing-knowledge.types';
import {
  AEO_ROUTINE_REVISION_SLOTS,
  aeoNumberFromIdentity,
  array,
  assertFiveSlotReplay,
  assertProjectionIdentity,
  feedbackReviewStatus,
  feedbackSlot,
  findBy,
  findCategoryPattern,
  integer,
  normalizeSlotEdits,
  normalizeSource,
  record,
  records,
  requiredSource,
  requiredText,
  revisionFromIdentity,
  text,
  texts,
  unique,
} from './aeo-routine-revision-assistance.utils';
const AUTO_FILLED_PARAMETER_KEYS: Set<string> = new Set([
  'msp',
  'lsp',
  'previousEcl',
]);

export function consumeAeoRoutineRevisionReplay(
  categoryProjectionValue: unknown,
  revisionPatternValue: unknown,
  provenanceValue: unknown,
  transitionId: string = 'R26_TO_R27',
): AeoRoutineRevisionReplayCandidate {
  const categoryProjection: Record<string, unknown> = record(
    categoryProjectionValue,
    'categoryProjection',
  );
  const pattern: Record<string, unknown> = record(
    revisionPatternValue,
    'revisionPattern',
  );
  const provenance: Record<string, unknown> = record(
    provenanceValue,
    'provenance',
  );
  assertProjectionIdentity(categoryProjection, pattern, provenance);
  const categoryPattern: Record<string, unknown> =
    findCategoryPattern(categoryProjection);
  const transition: Record<string, unknown> = findBy(
    records(pattern.transitions),
    'transitionId',
    transitionId,
  );
  const sourceRecords: Record<string, unknown>[] = records(provenance.sources);
  const sourceMap: Map<string, Record<string, unknown>> = new Map(
    sourceRecords.map((source: Record<string, unknown>) => [
      requiredText(source.sourceId, 'source.sourceId'),
      source,
    ]),
  );
  const baselineSourceId: string = requiredText(
    transition.baseline,
    'transition.baseline',
  );
  const targetSourceId: string = requiredText(
    transition.result,
    'transition.result',
  );
  const parameterSourceId: string = requiredText(
    transition.source,
    'transition.source',
  );
  const baselineSource: Record<string, unknown> = requiredSource(
    sourceMap,
    baselineSourceId,
  );
  const targetSource: Record<string, unknown> = requiredSource(
    sourceMap,
    targetSourceId,
  );
  const parameterSource: Record<string, unknown> = requiredSource(
    sourceMap,
    parameterSourceId,
  );
  const parameterMap: Record<string, unknown> = record(
    parameterSource.parameterMap,
    'parameterSource.parameterMap',
  );
  const baselineParameters: Record<string, unknown> = record(
    baselineSource.observedParameters,
    'baselineSource.observedParameters',
  );
  const targetParameters: Record<string, unknown> = record(
    targetSource.observedParameters,
    'targetSource.observedParameters',
  );
  const semanticLocators: Map<string, Record<string, unknown>> = new Map(
    records(pattern.semanticSlotLocators).map(
      (locator: Record<string, unknown>) => [
        requiredText(locator.slot, 'semanticSlotLocator.slot'),
        locator,
      ],
    ),
  );
  const slotEdits: AeoRoutineRevisionSlotEdit[] = normalizeSlotEdits(
    transition,
    semanticLocators,
    parameterSourceId,
    targetSourceId,
  );
  assertFiveSlotReplay(slotEdits, parameterMap, targetSource);
  const continuityCheck = {
    valid:
      text(parameterMap.previousEcl) === text(baselineParameters.newLsp) &&
      text(parameterMap.previousEcl) === text(targetParameters.oldLspToDelete),
    tnlPreviousEcl: requiredText(
      parameterMap.previousEcl,
      'parameterMap.previousEcl',
    ),
    baselineNewLsp: requiredText(
      baselineParameters.newLsp,
      'baselineSource.observedParameters.newLsp',
    ),
    candidateOldLsp: requiredText(
      targetParameters.oldLspToDelete,
      'targetSource.observedParameters.oldLspToDelete',
    ),
    boundary: 'MISMATCH_IS_REVIEW_STOP_NOT_AUTO_REPAIR' as const,
  };
  const unexpectedTextChanges: number = integer(
    transition.unexpectedTextChanges,
    'transition.unexpectedTextChanges',
  );
  const blockers: string[] = [
    ...(continuityCheck.valid ? [] : ['TNL Previous ECL continuity mismatch.']),
    ...(unexpectedTextChanges === 0
      ? []
      : ['Text changed outside the five observed semantic slots.']),
    ...(text(transition.approvalState) === 'NOT_ESTABLISHED' ||
    text(transition.evidenceState) === 'HISTORICAL_RELEASED_BY_USER_CONTEXT'
      ? []
      : ['Candidate approval state is not explicitly NOT_ESTABLISHED.']),
    ...(transitionId !== 'R26_TO_R27' ||
    (text(transition.evidenceState) === 'NON_ISSUED_CANDIDATE_REPLAY' &&
      text(targetSource.role) === 'NON_ISSUED_SECTION2_CANDIDATE_REPLAY' &&
      text(targetSource.issuedStatus) === 'NOT_ESTABLISHED')
      ? []
      : ['R27 source is not explicitly a non-issued candidate replay.']),
  ];
  const targetIdentity: string = requiredText(
    targetSource.observedIdentity,
    'targetSource.observedIdentity',
  );
  return {
    sourceProjectionVersion: requiredText(
      categoryProjection.projectionVersion,
      'categoryProjection.projectionVersion',
    ),
    lifecycleStatus: 'CANDIDATE_ONLY',
    documentState: 'CANDIDATE_REVISION',
    authority: 'ROUTINE_REVISION_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE',
    category: 'ROUTINE_PARAMETER_REVISION_UPDATE',
    sampleRef: requiredText(pattern.sampleRef, 'revisionPattern.sampleRef'),
    aeoNumber: aeoNumberFromIdentity(targetIdentity),
    transitionId,
    baselineSourceId,
    targetSourceId,
    parameterSourceId,
    targetRevision: revisionFromIdentity(targetIdentity),
    sources: sourceRecords.map(normalizeSource),
    categoryPattern: {
      sampleRefs: texts(categoryPattern.sampleRefs),
      observedSectionCandidate: texts(categoryPattern.observedSectionCandidate),
      ruleStrength: requiredText(
        categoryPattern.ruleStrength,
        'categoryPattern.ruleStrength',
      ),
    },
    stableCandidateSkeleton: array(pattern.stableCandidateSkeleton),
    slotEdits,
    activeReplaySlots: [...AEO_ROUTINE_REVISION_SLOTS],
    replayRevision: 1,
    replayHistory: [],
    continuityCheck,
    compatibilityReview: Object.entries(parameterMap).flatMap(
      ([field, value]: [string, unknown]) =>
        AUTO_FILLED_PARAMETER_KEYS.has(field)
          ? []
          : [
              {
                field,
                value,
                sourceRef: {
                  sourceId: parameterSourceId,
                  locator: `page 1, ${field} compatibility field`,
                },
                disposition: 'REVIEW_ONLY_NOT_AUTO_WRITTEN' as const,
              },
            ],
    ),
    unexpectedTextChanges,
    status: blockers.length === 0 ? 'READY_FOR_ENGINEER_REVIEW' : 'BLOCKED',
    blockers,
    feedbackEvents: [],
    nonClaims: unique([
      ...texts(pattern.nonGeneralizable),
      ...texts(provenance.nonClaims),
      'R27 remains a CANDIDATE_REVISION and cannot be used as approval or currentness truth.',
      'Compatibility fields are review evidence only and are not automatically written into the AEO.',
    ]),
  };
}

export function replayAeoRoutineRevisionSlots(
  candidate: AeoRoutineRevisionReplayCandidate,
  slots: AeoRoutineRevisionSlot[],
  reason: string,
): AeoRoutineRevisionReplayCandidate {
  if (slots.length === 0 || !reason.trim()) {
    throw new Error(
      'AEO_ROUTINE_REVISION_REPLAY_SELECTION_AND_REASON_REQUIRED',
    );
  }
  const selected: Set<AeoRoutineRevisionSlot> = new Set(slots);
  if (
    [...selected].some(
      (slot: AeoRoutineRevisionSlot) =>
        !AEO_ROUTINE_REVISION_SLOTS.includes(slot),
    )
  ) {
    throw new Error('AEO_ROUTINE_REVISION_REPLAY_SLOT_UNSUPPORTED');
  }
  const replayRevision: number = candidate.replayRevision + 1;
  return {
    ...candidate,
    activeReplaySlots: AEO_ROUTINE_REVISION_SLOTS.filter(
      (slot: AeoRoutineRevisionSlot) => selected.has(slot),
    ),
    replayRevision,
    replayHistory: [
      ...candidate.replayHistory,
      {
        replayRevision,
        slots: AEO_ROUTINE_REVISION_SLOTS.filter(
          (slot: AeoRoutineRevisionSlot) => selected.has(slot),
        ),
        reason: reason.trim(),
      },
    ],
  };
}

export function recordAeoRoutineRevisionFeedback(
  candidate: AeoRoutineRevisionReplayCandidate,
  feedbackProjectionValue: unknown,
  feedbackValue: unknown,
): AeoRoutineRevisionReplayCandidate {
  const projection: Record<string, unknown> = record(
    feedbackProjectionValue,
    'feedbackProjection',
  );
  const feedback: Record<string, unknown> = record(feedbackValue, 'feedback');
  if (
    projection.recordType !== 'aeo-editing-v0-engineer-feedback-projection' ||
    projection.status !== 'CANDIDATE_ONLY'
  ) {
    throw new Error('AEO_FEEDBACK_PROJECTION_UNSUPPORTED');
  }
  texts(projection.requiredFields).forEach((field: string) => {
    if (!(field in feedback)) {
      throw new Error(`AEO_FEEDBACK_REQUIRED_FIELD_MISSING: ${field}`);
    }
  });
  if (
    feedback.documentStateAtEdit !== 'CANDIDATE_REVISION' ||
    feedback.categoryAtEdit !== candidate.category
  ) {
    throw new Error('AEO_FEEDBACK_CANDIDATE_CONTEXT_MISMATCH');
  }
  const documentRef: Record<string, unknown> = record(
    feedback.documentRef,
    'feedback.documentRef',
  );
  if (
    documentRef.aeoNo !== candidate.aeoNumber ||
    documentRef.revisionCandidate !== candidate.targetRevision
  ) {
    throw new Error('AEO_FEEDBACK_DOCUMENT_IDENTITY_MISMATCH');
  }
  const after: Record<string, unknown> = record(
    feedback.after,
    'feedback.after',
  );
  if (after.state !== 'CANDIDATE_ONLY') {
    throw new Error('AEO_FEEDBACK_AFTER_NOT_CANDIDATE_ONLY');
  }
  const sourceIds: Set<string> = new Set(
    candidate.sources.map(
      (source: AeoEditingSourceIdentity) => source.sourceId,
    ),
  );
  records(feedback.sourceRefs).forEach((ref: Record<string, unknown>) => {
    if (
      !sourceIds.has(requiredText(ref.sourceId, 'feedback.sourceRef.sourceId'))
    ) {
      throw new Error('AEO_FEEDBACK_SOURCE_REF_UNKNOWN');
    }
  });
  const slot: AeoRoutineRevisionSlot = feedbackSlot(feedback.targetLocator);
  const feedbackId: string = requiredText(
    feedback.feedbackId,
    'feedback.feedbackId',
  );
  if (
    candidate.feedbackEvents.some(
      (event: Record<string, unknown>) => event.feedbackId === feedbackId,
    )
  ) {
    throw new Error(`AEO_FEEDBACK_ID_DUPLICATE: ${feedbackId}`);
  }
  const edit: AeoRoutineRevisionSlotEdit | undefined = candidate.slotEdits.find(
    (item: AeoRoutineRevisionSlotEdit) => item.slot === slot,
  );
  if (!edit) {
    throw new Error(`AEO_FEEDBACK_SLOT_NOT_FOUND: ${slot}`);
  }
  const before: Record<string, unknown> = record(
    feedback.before,
    'feedback.before',
  );
  if (requiredText(before.value, 'feedback.before.value') !== edit.oldValue) {
    throw new Error('AEO_FEEDBACK_BEFORE_VALUE_MISMATCH');
  }
  return {
    ...candidate,
    slotEdits: candidate.slotEdits.map((item: AeoRoutineRevisionSlotEdit) =>
      item.slot === slot
        ? {
            ...item,
            editableValue: requiredText(after.value, 'feedback.after.value'),
            reviewStatus: feedbackReviewStatus(feedback.changeKind),
            engineerFeedbackId: feedbackId,
            engineerRationale: requiredText(
              feedback.engineerRationale,
              'feedback.engineerRationale',
            ),
          }
        : item,
    ),
    feedbackEvents: [...candidate.feedbackEvents, feedback],
  };
}
