import type { JOBAID_CHECKLIST_RC1 } from './jobaid-checklist-rc1';

export type JobAidChecklistItemId = typeof JOBAID_CHECKLIST_RC1.items[number]['itemId'];
export type JobAidChecklistRuleId = typeof JOBAID_CHECKLIST_RC1.ruleCatalog[number]['ruleId'];
export type JobAidChecklistOutcome = 'ANSWERED' | 'OPEN' | 'CONFLICT' | 'DEFERRED';

/** Host seals this in the existing task. Candidate commands cannot submit it. */
export interface JobAidChecklistBinding {
  definitionId: 'wiselink.engineering-assessment';
  definitionVersion: '0.1.0-rc1';
  definitionContentHash: string;
  contractVersion: '0.1.0-rc1';
  definition: typeof JOBAID_CHECKLIST_RC1;
  goal: {
    purpose: 'INITIAL_PROBLEM_ASSESSMENT';
    workItemId: string;
    documentVersionId: string;
    basedOnWorkItemRevision: number;
    /** User wording and document scope remain in the original task, without reinterpretation. */
    contextRefs: ['documentOverview', 'discussion', 'contextPackage'];
    stageBoundary: 'CANDIDATE_ANALYSIS_ONLY';
  };
  selection: Array<{
    itemId: JobAidChecklistItemId;
    mode: 'INCLUDE' | 'WHEN_TRIGGERED' | 'EXCLUDE_OPTIONAL';
    reason: string;
  }>;
  acceptance: {
    allowedSavedOutcomes: JobAidChecklistOutcome[];
    allowedDeferredItemIds: JobAidChecklistItemId[];
    /** Item-specific permission for qualified completion; never inferred from outcome alone. */
    allowedCompletionWithOpenItemIds: JobAidChecklistItemId[];
    roundCompletionIsFormalAdoption: false;
  };
}

/** Browser display only. The task's goal and runtime/control context are excluded. */
export type JobAidChecklistDefinitionView = Pick<JobAidChecklistBinding,
  'definitionId' | 'definitionVersion' | 'definitionContentHash' | 'contractVersion' | 'definition'>;
export interface JobAidChecklistSnapshotView extends JobAidChecklistDefinitionView {
  selection: JobAidChecklistBinding['selection'];
  acceptance: JobAidChecklistBinding['acceptance'];
}

export interface JobAidChecklistTaskRead {
  status: 'AVAILABLE' | 'NOT_PREPARED' | 'NOT_BOUND' | 'UNSUPPORTED' | 'INVALID';
  snapshot: JobAidChecklistSnapshotView | null;
}

export interface JobAidChecklistDefinitionRead {
  schemaVersion: 'wiselink.checklist-definition-read.v1';
  source: 'HOST_RELEASE';
  management: 'READ_ONLY_RELEASE_MANAGED';
  current: JobAidChecklistDefinitionView;
}

export interface JobAidChecklistResult {
  itemId: JobAidChecklistItemId;
  itemApplicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNDETERMINED';
  outcome: JobAidChecklistOutcome;
  /** References resolve against the merged work, not array positions in a patch. */
  resultRefs: Array<{ issueKey: string; fieldPath: string }>;
  basisRefs: string[];
}

export interface JobAidMethodUsage {
  /** Exact delivered METHOD_CLAUSE evidenceRef, not its method category. */
  methodRef: string;
  usage: 'REFERENCE_ONLY' | 'APPLIED' | 'UNDETERMINED';
  basisRefs: string[];
}

export interface JobAidChecklistFeedback {
  contractVersion: '0.1.0-rc1';
  ruleset: {
    definitionId: string;
    definitionVersion: string;
    definitionContentHash: string;
    validatorBuildRef: string;
  };
  candidateBinding: {
    taskRef: string;
    taskBaselineHash: string;
    basedOnWorkItemRevision: number;
    /** SHA256 of the exact UTF-8 workJson checked; changing bytes requires another check. */
    candidateDigest: string;
  };
  checkPhase: 'PRECHECK';
  findings: Array<{
    code: string | null;
    ruleId: JobAidChecklistRuleId | null;
    itemId: JobAidChecklistItemId | null;
    fieldPath: string | null;
    reason: string;
    checkNature: 'DETERMINISTIC' | 'SEMANTIC_REVIEW';
    assessment: 'VIOLATED' | 'NOT_MACHINE_ASSESSED';
    disposition: 'BLOCK' | 'REVIEW';
    retryability: 'REPAIRABLE' | 'NONE';
    recoveryScope: 'CANDIDATE';
  }>;
  semanticNotAssessedByHost: true;
}
