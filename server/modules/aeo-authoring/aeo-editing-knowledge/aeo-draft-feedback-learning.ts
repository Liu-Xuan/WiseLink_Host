import type {
  AeoDraftAssistanceCandidate,
  AeoDraftFeedback,
  AeoDraftFeedbackInput,
  AeoDraftFeedbackLearningDisposition,
  AeoDraftFeedbackReasonCode,
  AeoDraftFeedbackSuggestionSnapshot,
  AeoDraftLearningInput,
  AeoDraftSuggestion,
  AeoEditingSourceRef,
} from './aeo-editing-knowledge.types';

const REASON_CODES: AeoDraftFeedbackReasonCode[] = [
  'SOURCE_MISMATCH',
  'APPLICABILITY',
  'COMPANY_PROCESS',
  'EXECUTABILITY',
  'SAFETY',
  'DUPLICATE',
  'SUPERSEDED',
  'TERMINOLOGY',
  'LAYOUT',
  'ROLE',
  'TEST_OR_ACCEPTANCE',
  'RESTORATION',
  'OTHER',
];

const LEARNING_DISPOSITIONS: AeoDraftFeedbackLearningDisposition[] = [
  'THIS_DRAFT_ONLY',
  'SERIES_PATTERN_CANDIDATE',
  'CATEGORY_PATTERN_CANDIDATE',
  'DO_NOT_LEARN',
];

export function buildAeoDraftFeedbackEvent(
  beforeSuggestion: AeoDraftSuggestion,
  afterSuggestion: AeoDraftSuggestion,
  input: AeoDraftFeedbackInput,
  revisionSourceRefs: AeoEditingSourceRef[],
): AeoDraftFeedback {
  if (typeof input.semanticField !== 'string' || !input.semanticField.trim()) {
    throw new Error('AEO_DRAFT_FEEDBACK_SEMANTIC_TARGET_REQUIRED');
  }
  if (!REASON_CODES.includes(input.reasonCode)) {
    throw new Error('AEO_DRAFT_FEEDBACK_REASON_CODE_INVALID');
  }
  if (!LEARNING_DISPOSITIONS.includes(input.learningDisposition)) {
    throw new Error('AEO_DRAFT_FEEDBACK_LEARNING_DISPOSITION_INVALID');
  }
  return {
    feedbackId: input.feedbackId,
    suggestionId: input.suggestionId,
    decision: input.decision,
    engineerDecisionRef: input.engineerDecisionRef.trim(),
    note: input.note.trim(),
    revisedBodyZh: input.revisedBodyZh ?? null,
    revisedBodyEn: input.revisedBodyEn ?? null,
    revisionSourceRefs,
    semanticTarget: {
      suggestionId: beforeSuggestion.suggestionId,
      sourceUnitId: beforeSuggestion.sourceUnitId,
      section: beforeSuggestion.section,
      field: input.semanticField.trim(),
    },
    before: snapshot(beforeSuggestion),
    after: snapshot(afterSuggestion),
    reasonCode: input.reasonCode,
    learningDisposition: input.learningDisposition,
  };
}

export function buildAeoDraftLearningInput(
  draft: AeoDraftAssistanceCandidate,
): AeoDraftLearningInput {
  const eligible: AeoDraftFeedback[] = draft.feedback.filter(
    (feedback: AeoDraftFeedback) =>
      feedback.learningDisposition === 'SERIES_PATTERN_CANDIDATE' ||
      feedback.learningDisposition === 'CATEGORY_PATTERN_CANDIDATE',
  );
  const eligibleIds: Set<string> = new Set(
    eligible.map((feedback: AeoDraftFeedback) => feedback.feedbackId),
  );
  const byKind = (kind: AeoDraftSuggestion['kind']): AeoDraftFeedback[] => {
    const suggestionIds: Set<string> = new Set(
      draft.suggestions
        .filter((suggestion: AeoDraftSuggestion) => suggestion.kind === kind)
        .map((suggestion: AeoDraftSuggestion) => suggestion.suggestionId),
    );
    return eligible.filter((feedback: AeoDraftFeedback) =>
      suggestionIds.has(feedback.suggestionId),
    );
  };
  return {
    applicableTemplateFeedback: byKind('APPLICABLE_TEMPLATE_CANDIDATE'),
    companyStepFeedback: byKind('COMPANY_STEP_CANDIDATE'),
    accepted: eligible.filter(
      (feedback: AeoDraftFeedback) => feedback.decision === 'ACCEPT',
    ),
    modified: eligible.filter(
      (feedback: AeoDraftFeedback) => feedback.decision === 'MODIFY',
    ),
    rejected: eligible.filter(
      (feedback: AeoDraftFeedback) => feedback.decision === 'REJECT',
    ),
    excludedFromLearning: draft.feedback.filter(
      (feedback: AeoDraftFeedback) => !eligibleIds.has(feedback.feedbackId),
    ),
    boundary: 'FEEDBACK_INPUT_NOT_AUTOMATIC_RULE_NOT_AUTHORITY',
  };
}

function snapshot(
  suggestion: AeoDraftSuggestion,
): AeoDraftFeedbackSuggestionSnapshot {
  return {
    bodyZh: suggestion.bodyZh,
    bodyEn: suggestion.bodyEn,
    sourceRefs: suggestion.sourceRefs,
    reviewStatus: suggestion.reviewStatus,
    engineerDecisionRef: suggestion.engineerDecisionRef,
  };
}
