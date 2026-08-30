import type { AeoContentBlock } from '../../../../shared/aeo-editor';

export const AEO_EDITING_KNOWLEDGE_VERSION =
  'wiselink.aeo_editing_knowledge.v0.candidate.2' as const;
export const AEO_DRAFT_ASSISTANCE_VERSION =
  'wiselink.aeo_draft_assistance.v0.candidate.2' as const;

export type AeoEditingCategory =
  | 'SOFTWARE_INSTALLATION_UPDATE'
  | 'HARDWARE_INSTALLATION_MODIFICATION'
  | 'VISUAL_INSPECTION_WITH_CONDITIONAL_CORRECTION'
  | 'ROUTINE_PARAMETER_REVISION_UPDATE'
  | 'FUTURE_CATEGORY';

export interface AeoEditingSourceRef {
  sourceId: string;
  locator: string;
}

export interface AeoEditingSourceIdentity {
  sourceId: string;
  role: string;
  artifactRef: string;
  actualBytes: number;
  sha256: string | null;
  observedIdentity: string | null;
  identityLocator: string | null;
}

export interface AeoEditingDocumentIdentity {
  aeoNumber: string;
  revision: string;
  title: string;
  category: AeoEditingCategory;
  actualBytes: number;
  primarySourceId: string;
  expectedHeader: string;
  observedHeader: string;
  identityLocator: string;
}

export interface AeoEditingInspectionDetail {
  area: Record<string, unknown>;
  method: Record<string, unknown>;
  referenceCondition: Record<string, unknown>;
  thresholdsAndLimits: unknown[];
  findingClassification: Record<string, unknown>;
  repeatInterval: Record<string, unknown>;
  ndt: Record<string, unknown>;
  recording: Record<string, unknown>;
  explicitAbsences: string[];
}

export interface AeoEditingBranch {
  when: string;
  then: string;
  sourceRefs: AeoEditingSourceRef[];
}

export interface AeoEditingActionUnit {
  unitId: string;
  sequence: number;
  phase: string;
  operation: string;
  object: string;
  bodyZh: string | null;
  bodyEn: string | null;
  parameters: unknown[];
  conditions: unknown[];
  dependencies: unknown[];
  branches: AeoEditingBranch[];
  sourceDisposition: string;
  sourceRefs: AeoEditingSourceRef[];
  performerRoles: string[];
  inspectorRoles: string[];
  signatureGranularity: string | null;
  verifications: unknown[];
  closeout: unknown[];
  safetyNotes: unknown[];
  inspectionDetail: AeoEditingInspectionDetail | null;
  reviewStatus: 'CANDIDATE' | 'REVIEW_REQUIRED';
}

export interface AeoEditingKnowledgeCandidate {
  schemaVersion: typeof AEO_EDITING_KNOWLEDGE_VERSION;
  lifecycleStatus: 'CANDIDATE_ONLY';
  documentState: 'CONTROLLED_OR_ISSUED_SAMPLE_APPROVAL_NOT_INDEPENDENTLY_VERIFIED';
  authority: 'EDITING_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE';
  documentIdentity: AeoEditingDocumentIdentity;
  knowledgeVersion: string;
  sources: AeoEditingSourceIdentity[];
  actionUnits: AeoEditingActionUnit[];
  structureSkeleton: {
    sectionKeys: string[];
    performerRolePlaceholders: string[];
    inspectorRolePlaceholders: string[];
    signatureGranularities: string[];
    safetyNoteUnitIds: string[];
    parameterizedUnitIds: string[];
  };
  applicableTemplateCandidateUnitIds: string[];
  companyStepCandidateUnitIds: string[];
  missingInputs: string[];
  conflicts: string[];
  producerEvidence: {
    sourceSelection: Record<string, unknown> | null;
    figureUnits: unknown[];
    reviewFlags: unknown[];
    companyAddedOrSpecializedControls: unknown[];
    sourceCandidatesRequiringDecision: unknown[];
    nonGeneralizable: string[];
  };
  sampleSupport: {
    sampleCount: number;
    inferenceRule: 'FREQUENCY_NEVER_ESTABLISHES_ENGINEERING_REQUIREMENT';
  };
  nonClaims: string[];
}

export interface AeoEditingValidationFinding {
  code: string;
  path: string;
  message: string;
}

export interface AeoEditingValidationResult {
  valid: boolean;
  findings: AeoEditingValidationFinding[];
}

export interface AeoDraftSuggestion {
  suggestionId: string;
  sourceUnitId: string;
  section: string;
  kind: 'APPLICABLE_TEMPLATE_CANDIDATE' | 'COMPANY_STEP_CANDIDATE';
  bodyZh: string | null;
  bodyEn: string | null;
  parameters: unknown[];
  conditions: unknown[];
  dependencies: unknown[];
  branches: AeoEditingBranch[];
  performerRoles: string[];
  inspectorRoles: string[];
  signatureGranularity: string | null;
  verifications: unknown[];
  closeout: unknown[];
  safetyNotes: unknown[];
  inspectionDetail: AeoEditingInspectionDetail | null;
  sourceRefs: AeoEditingSourceRef[];
  editable: true;
  reviewStatus:
    | 'PENDING_ENGINEER_REVIEW'
    | 'ACCEPTED_CANDIDATE'
    | 'MODIFIED_CANDIDATE'
    | 'REJECTED_CANDIDATE';
  engineerDecisionRef: string | null;
}

export interface AeoDraftAssistanceRequest {
  draftKey: string;
  title: string;
  knowledge: AeoEditingKnowledgeCandidate;
  selectedUnitIds: string[];
  currentSourceRefs: AeoEditingSourceRef[];
}

export interface AeoDraftRegenerationRequest extends AeoDraftAssistanceRequest {
  expectedGenerationRevision: number;
}

export interface AeoDraftFeedback {
  feedbackId: string;
  suggestionId: string;
  targetGenerationRevision: number;
  decision: 'ACCEPT' | 'MODIFY' | 'REJECT';
  engineerDecisionRef: string;
  note: string;
  revisedBodyZh: string | null;
  revisedBodyEn: string | null;
  revisionSourceRefs: AeoEditingSourceRef[];
  semanticTarget: {
    suggestionId: string;
    sourceUnitId: string;
    section: string;
    field: string;
  };
  before: AeoDraftFeedbackSuggestionSnapshot;
  after: AeoDraftFeedbackSuggestionSnapshot;
  reasonCode: AeoDraftFeedbackReasonCode;
  learningDisposition: AeoDraftFeedbackLearningDisposition;
}

export interface AeoDraftFeedbackSuggestionSnapshot {
  bodyZh: string | null;
  bodyEn: string | null;
  sourceRefs: AeoEditingSourceRef[];
  reviewStatus: AeoDraftSuggestion['reviewStatus'];
  engineerDecisionRef: string | null;
}

export type AeoDraftFeedbackReasonCode =
  | 'SOURCE_MISMATCH'
  | 'APPLICABILITY'
  | 'COMPANY_PROCESS'
  | 'EXECUTABILITY'
  | 'SAFETY'
  | 'DUPLICATE'
  | 'SUPERSEDED'
  | 'TERMINOLOGY'
  | 'LAYOUT'
  | 'ROLE'
  | 'TEST_OR_ACCEPTANCE'
  | 'RESTORATION'
  | 'OTHER';

export type AeoDraftFeedbackLearningDisposition =
  | 'THIS_DRAFT_ONLY'
  | 'SERIES_PATTERN_CANDIDATE'
  | 'CATEGORY_PATTERN_CANDIDATE'
  | 'DO_NOT_LEARN';

export interface AeoSupersededDraftFeedback {
  feedback: AeoDraftFeedback;
  sourceUnitId: string;
  activeThroughGenerationRevision: number;
  supersededAtGenerationRevision: number;
  reason: 'SELECTED_UNIT_REGENERATED';
}

export interface AeoDraftAssistanceCandidate {
  schemaVersion: typeof AEO_DRAFT_ASSISTANCE_VERSION;
  lifecycleStatus: 'CANDIDATE_ONLY';
  authority: 'EDITABLE_DRAFT_NOT_APPROVAL_NOT_RELEASE';
  draftKey: string;
  title: string;
  generationRevision: number;
  knowledgeDocumentIdentity: AeoEditingDocumentIdentity;
  knowledgeDocumentState: AeoEditingKnowledgeCandidate['documentState'];
  sources: AeoEditingSourceIdentity[];
  currentSourceRefs: AeoEditingSourceRef[];
  suggestions: AeoDraftSuggestion[];
  editorBlocks: AeoContentBlock[];
  missingInputs: string[];
  conflicts: string[];
  /** Feedback that is active for the current suggestion generations only. */
  feedback: AeoDraftFeedback[];
  /** Prior-generation feedback retained for audit, never active learning input. */
  supersededFeedback: AeoSupersededDraftFeedback[];
  regenerationHistory: Array<{
    generationRevision: number;
    regeneratedUnitIds: string[];
    reason: string;
  }>;
  nonClaims: string[];
}

export interface AeoDraftFeedbackInput {
  feedbackId: string;
  suggestionId: string;
  expectedGenerationRevision: number;
  decision: AeoDraftFeedback['decision'];
  engineerDecisionRef: string;
  note: string;
  revisedBodyZh?: string | null;
  revisedBodyEn?: string | null;
  revisionSourceRefs?: AeoEditingSourceRef[];
  semanticField: string;
  reasonCode: AeoDraftFeedbackReasonCode;
  learningDisposition: AeoDraftFeedbackLearningDisposition;
}

export interface AeoDraftLearningInput {
  applicableTemplateFeedback: AeoDraftFeedback[];
  companyStepFeedback: AeoDraftFeedback[];
  accepted: AeoDraftFeedback[];
  modified: AeoDraftFeedback[];
  rejected: AeoDraftFeedback[];
  excludedFromLearning: AeoDraftFeedback[];
  boundary: 'FEEDBACK_INPUT_NOT_AUTOMATIC_RULE_NOT_AUTHORITY';
}

export interface AeoEditingKnowledgeVersionDiff {
  fromKnowledgeVersion: string;
  toKnowledgeVersion: string;
  sameMatter: boolean;
  changes: Array<{
    unitId: string;
    change: 'ADDED' | 'REMOVED' | 'CHANGED' | 'UNCHANGED';
    reasons: string[];
    fromSourceRefs: AeoEditingSourceRef[];
    toSourceRefs: AeoEditingSourceRef[];
  }>;
  boundary: 'DIFF_ASSISTANCE_NOT_ENGINEERING_CONCLUSION';
}

export type AeoRoutineRevisionSlot =
  | 'headerRevision'
  | 'step2Msp'
  | 'step2NewLsp'
  | 'step3NewLsp'
  | 'step4OldLsp';

export interface AeoRoutineRevisionSlotEdit {
  slot: AeoRoutineRevisionSlot;
  oldValue: string;
  sourceSuggestedValue: string;
  editableValue: string;
  semanticLocator: string;
  runEvidenceLocator: string;
  sourceRefs: AeoEditingSourceRef[];
  reviewStatus:
    | 'PENDING_ENGINEER_REVIEW'
    | 'ACCEPTED_CANDIDATE'
    | 'MODIFIED_CANDIDATE'
    | 'REJECTED_CANDIDATE';
  engineerFeedbackId: string | null;
  engineerRationale: string | null;
}

export interface AeoRoutineRevisionReplayCandidate {
  sourceProjectionVersion: string;
  lifecycleStatus: 'CANDIDATE_ONLY';
  documentState: 'CANDIDATE_REVISION';
  authority: 'ROUTINE_REVISION_ASSISTANCE_NOT_APPROVAL_NOT_RELEASE';
  category: 'ROUTINE_PARAMETER_REVISION_UPDATE';
  sampleRef: string;
  aeoNumber: string;
  transitionId: string;
  baselineSourceId: string;
  targetSourceId: string;
  parameterSourceId: string;
  targetRevision: string;
  sources: AeoEditingSourceIdentity[];
  categoryPattern: {
    sampleRefs: string[];
    observedSectionCandidate: string[];
    ruleStrength: string;
  };
  stableCandidateSkeleton: unknown[];
  slotEdits: AeoRoutineRevisionSlotEdit[];
  activeReplaySlots: AeoRoutineRevisionSlot[];
  replayRevision: number;
  replayHistory: Array<{
    replayRevision: number;
    slots: AeoRoutineRevisionSlot[];
    reason: string;
  }>;
  continuityCheck: {
    valid: boolean;
    tnlPreviousEcl: string;
    baselineNewLsp: string;
    candidateOldLsp: string;
    boundary: 'MISMATCH_IS_REVIEW_STOP_NOT_AUTO_REPAIR';
  };
  compatibilityReview: Array<{
    field: string;
    value: unknown;
    sourceRef: AeoEditingSourceRef;
    disposition: 'REVIEW_ONLY_NOT_AUTO_WRITTEN';
  }>;
  unexpectedTextChanges: number;
  status: 'READY_FOR_ENGINEER_REVIEW' | 'BLOCKED';
  blockers: string[];
  feedbackEvents: Array<Record<string, unknown>>;
  nonClaims: string[];
}
