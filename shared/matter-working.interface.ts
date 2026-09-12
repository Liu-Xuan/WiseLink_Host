import type {
  AssessmentEvidence,
  AssessmentReadingClaim,
  AssessmentReadingResult,
} from './assessment-reading.interface';
import type { JobAidProblemWorkContent } from './jobaid-problem-assessment.interface';

export type EngineeringMatterWorkingUpdateKind =
  | 'INITIAL_SYNTHESIS'
  | 'CORRECTION'
  | 'MATERIAL_INCORPORATION';

export interface EngineeringMatterWorkingFocus {
  question: string;
  targetRefs: string[];
}

/** Exact Host-owned input identity observed for one Matter working revision. */
export interface EngineeringMatterWorkItemInputBinding {
  original?: EngineeringMatterOriginalInputBinding;
  /** Stable within the Matter. The first increment uses the WorkItem id. */
  inputId: string;
  workItemId: string;
  workItemRevision: number;
  documentVersionId: string;
  resultRef: string | null;
  resultRevision: number | null;
}

export interface EngineeringMatterDocumentInputBinding {
  original?: EngineeringMatterOriginalInputBinding;
  kind: 'DOCUMENT_VERSION';
  inputId: string;
  familyId: string;
  documentVersionId: string;
  workItemId: null;
  workItemRevision: null;
  resultRef: null;
  resultRevision: null;
}

export interface EngineeringMatterOriginalInputBinding {
  parseRunId: string;
  parseRevision: number;
}

export type EngineeringMatterWorkingInputBinding =
  | EngineeringMatterWorkItemInputBinding
  | EngineeringMatterDocumentInputBinding;

export interface EngineeringMatterWorkingTextItem {
  itemId: string;
  text: string;
  basisRefs: string[];
  /** Evaluated only for saved reviewConditions, never inferred from prose. */
  when?: { kind: 'DUE_AT'; at: string } | { kind: 'ORIGINAL_CHANGED'; inputId: string; afterParseRunId: string | null };
}

export interface EngineeringMatterWorkingCoverage {
  binding: EngineeringMatterWorkingInputBinding;
  contribution: 'SUBSTANTIVE' | 'NO_MATERIAL_CHANGE' | 'READ_ONLY';
  /** Exact source keys that the Host observed being read for this update. */
  checkedSourceRefIds: string[];
  /** Human-readable bounded scope; never implies full-document coverage. */
  checkedScope: string;
  reason: string;
}

/**
 * Host-owned short memory for continued Matter work. The substantive reading
 * remains the shared AssessmentReadingResult; claims and evidence are not
 * copied into a competing Matter-only shape.
 */
export interface EngineeringMatterWorkingState {
  schemaVersion: 'wiselink.3_1.engineering_matter_working_state.v1';
  focus: EngineeringMatterWorkingFocus;
  substantiveResult: AssessmentReadingResult | null;
  openQuestions: EngineeringMatterWorkingTextItem[];
  reviewConditions: EngineeringMatterWorkingTextItem[];
  substantiveInputs: EngineeringMatterWorkingInputBinding[];
  coverage: EngineeringMatterWorkingCoverage[];
  /** Complete saved investigation; absent only on historical summary-only work. */
  problemWork?: JobAidProblemWorkContent;
}

export interface EngineeringMatterWorkingClaimDelta {
  changedBecause: string;
  additions: AssessmentReadingClaim[];
  /** Replacement claims retain the claimId they replace. */
  replacements: AssessmentReadingClaim[];
  retirements: Array<{ claimId: string; reason: string }>;
  explicitlyUnchangedClaimIds: string[];
}

export interface EngineeringMatterWorkingTextItemDelta {
  upserts: EngineeringMatterWorkingTextItem[];
  retirements: Array<{ itemId: string; reason: string }>;
  explicitlyUnchangedItemIds: string[];
}

/**
 * Host-validated command. A null nextSubstantiveResult preserves the exact
 * previous result and its input bindings; coverage-only revisions are valid.
 */
export interface EngineeringMatterWorkingRevisionCommand {
  requestId: string;
  expectedWorkingRevision: number;
  basedOnMatterRevisionId: string;
  updateKind: EngineeringMatterWorkingUpdateKind;
  changeSummary: string;
  nextFocus: EngineeringMatterWorkingFocus | null;
  claimDelta: EngineeringMatterWorkingClaimDelta | null;
  openQuestionDelta: EngineeringMatterWorkingTextItemDelta | null;
  reviewConditionDelta: EngineeringMatterWorkingTextItemDelta | null;
  nextSubstantiveResult: AssessmentReadingResult | null;
  /** Member inputs used by the next result; may be empty for non-document premises. */
  substantiveInputs: EngineeringMatterWorkingInputBinding[];
  coverageUpdates: EngineeringMatterWorkingCoverage[];
  /** Host-materialized full investigation. Omission preserves prior saved work. */
  nextProblemWork?: JobAidProblemWorkContent;
}

export type EngineeringMatterWorkingRevisionSource =
  | { actionAttemptId: string; reviewTurnId: string }
  | { kind: 'ENGINEERING_MATTER'; actionAttemptId: string; reviewTurnId: null };

export interface EngineeringMatterWorkingRevisionChange {
  changedBecause: string | null;
  addedClaimIds: string[];
  replacedClaimIds: string[];
  retiredClaims: Array<{ claimId: string; reason: string }>;
  explicitlyUnchangedClaimIds: string[];
  openQuestionDelta: EngineeringMatterWorkingTextItemDelta | null;
  reviewConditionDelta: EngineeringMatterWorkingTextItemDelta | null;
  coverageUpdates: EngineeringMatterWorkingCoverage[];
}

export interface EngineeringMatterWorkingRevisionReadModel {
  matterWorkRevisionId: string;
  matterId: string;
  workingRevision: number;
  basedOnMatterRevisionId: string;
  updateKind: EngineeringMatterWorkingUpdateKind;
  changeSummary: string;
  substantiveResultRef: string | null;
  substantiveResultRevision: number | null;
  state: EngineeringMatterWorkingState;
  change: EngineeringMatterWorkingRevisionChange;
  source: EngineeringMatterWorkingRevisionSource | null;
  createdAt: string;
}

export type EngineeringMatterPendingInputReason =
  | 'NOT_COVERED'
  | 'READ_NOT_PROCESSED'
  | 'WORK_ITEM_REVISION_CHANGED'
  | 'DOCUMENT_VERSION_CHANGED'
  | 'DOCUMENT_ORIGINAL_CHANGED'
  | 'RESULT_CHANGED';

export interface EngineeringMatterPendingInput {
  inputId: string;
  current: EngineeringMatterWorkingInputBinding;
  covered: EngineeringMatterWorkingInputBinding | null;
  reasons: EngineeringMatterPendingInputReason[];
}

export interface EngineeringMatterWorkingReadModel {
  matterId: string;
  currentMatterRevisionId: string;
  currentWorkingRevision: number;
  current: EngineeringMatterWorkingRevisionReadModel | null;
  pendingInputs: EngineeringMatterPendingInput[];
}

export interface EngineeringMatterWorkingCommitResult {
  revision: EngineeringMatterWorkingRevisionReadModel;
  replayed: boolean;
  resultChanged: boolean;
  coverageChanged: boolean;
}

export interface EngineeringMatterWorkingExplanationResult {
  working: EngineeringMatterWorkingReadModel;
  mutated: false;
}

export interface EngineeringMatterWorkingMutationResult {
  working: EngineeringMatterWorkingReadModel;
  mutated: true;
  commit: EngineeringMatterWorkingCommitResult;
}

export type EngineeringMatterWorkingApplyResult =
  | EngineeringMatterWorkingExplanationResult
  | EngineeringMatterWorkingMutationResult;

/** Re-exported only as aliases for W1/W4 consumers; no duplicate definitions. */
export type EngineeringMatterWorkingClaim = AssessmentReadingClaim;
export type EngineeringMatterWorkingEvidence = AssessmentEvidence;
