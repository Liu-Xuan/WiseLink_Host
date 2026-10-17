import type { CanonicalWorkItemProjection } from '@shared/api.interface';
import type { DocumentOriginalBinding } from '@shared/document-original.interface';
import type { DialogueContributionKind } from '@shared/dialogue.interface';
import type { JobAidWorkRevision } from '@shared/jobaid-problem-assessment.interface';
import type { OpenClawEngineerReviewItem } from './selective-overall-resynthesis';

export type JobAidTaskPurpose =
  | 'INITIAL_PROBLEM_ASSESSMENT'
  | 'OVERALL_CONSISTENCY'
  | 'PROBLEM_REVIEW';

/** Existing selection controls remain in the sealed Host task, never model authority. */
export interface JobAidPreparationScope {
  reviewConversationId?: string;
  beforeTurnNo?: number;
  includedDiscussionTurnIds?: string[];
  selectedContributionRefs?: string[];
}

export interface JobAidPendingEngineerInput {
  ref: string;
  revision: number;
  kind: DialogueContributionKind | 'REVIEW_INSTRUCTION';
  text: string;
  sourcePart: 'USER' | 'ASSISTANT';
  origin: 'PERSONAL_DIALOGUE' | 'REVIEW_CONVERSATION';
  recordedAt: string;
}

export interface JobAidSavedUpdate {
  status: 'APPLIED' | 'UNCHANGED';
  workRevisionRef: string | null;
  workRevision: number;
  affectedIssueKeys: string[];
  instruction: string;
}

export type JobAidHumanConfirmedDecision = Pick<
  OpenClawEngineerReviewItem,
  | 'sequence'
  | 'criterionId'
  | 'baseRuleRevision'
  | 'baseRuleArtifactSha256'
  | 'actionType'
  | 'decision'
  | 'status'
  | 'comment'
  | 'recordedAt'
  | 'correctedAnalysisDirection'
>;

export interface JobAidEngineerPreparationFacts {
  pendingEngineerInputs: JobAidPendingEngineerInput[];
  savedUpdates: JobAidSavedUpdate[];
  humanConfirmedDecisions: JobAidHumanConfirmedDecision[];
  humanConfirmationStatus: 'AVAILABLE' | 'NOT_RECORDED' | 'UNAVAILABLE';
  taskGoal?: { instruction: string; targetIssueKeys: string[] };
  limitations: string[];
}

export interface JobAidPreparationView {
  schemaVersion: 'wiselink.jobaid-preparation.v1';
  taskPurpose: JobAidTaskPurpose;
  goal: string;
  targetIssueKeys: string[];
  taskInputRevision: number;
  currentInputRevision: number;
  currentInputChanged: boolean;
  documentVersionId: string;
  originalBinding: DocumentOriginalBinding | null;
  lastSaved: {
    workRevisionRef: string;
    workRevision: number;
    basedOnInputRevision: number;
  } | null;
  currentIssues: Array<{ issueKey: string; question: string }>;
  unfinishedItems: Array<{
    issueKey: string | null;
    kind:
      | 'NO_SAVED_WORK'
      | 'ROUND_IN_PROGRESS'
      | 'OPEN_QUESTION'
      | 'UNRESOLVED_REQUIREMENT';
    description: string;
  }>;
  pendingEngineerInputs: JobAidPendingEngineerInput[];
  savedUpdates: JobAidSavedUpdate[];
  humanConfirmedDecisions: JobAidHumanConfirmedDecision[];
  humanConfirmationStatus: JobAidEngineerPreparationFacts['humanConfirmationStatus'];
  limitations: string[];
}

export function unavailableJobAidPreparationFacts(): JobAidEngineerPreparationFacts {
  return {
    pendingEngineerInputs: [],
    savedUpdates: [],
    humanConfirmedDecisions: [],
    humanConfirmationStatus: 'UNAVAILABLE',
    limitations: ['ENGINEER_PREPARATION_READER_UNAVAILABLE'],
  };
}

/** Pure projection: this view neither changes task qualification nor stores corrections. */
export function buildJobAidPreparationView(input: {
  taskPurpose: JobAidTaskPurpose;
  taskInputRevision: number;
  current: Pick<CanonicalWorkItemProjection, 'revision'> & {
    source: Pick<CanonicalWorkItemProjection['source'], 'documentVersionId'>;
  };
  documentVersionId: string;
  originalBinding: DocumentOriginalBinding | null;
  latestWork: JobAidWorkRevision | null;
  facts: JobAidEngineerPreparationFacts;
  sealedGoal?: Pick<JobAidPreparationView, 'goal' | 'targetIssueKeys'>;
}): JobAidPreparationView {
  const work = input.latestWork;
  const unfinished: JobAidPreparationView['unfinishedItems'] = [];
  if (!work)
    unfinished.push({
      issueKey: null,
      kind: 'NO_SAVED_WORK',
      description: '尚无已保存的问题工作。',
    });
  if (work?.content.roundCompletion === 'IN_PROGRESS')
    unfinished.push({
      issueKey: null,
      kind: 'ROUND_IN_PROGRESS',
      description: work.content.completionReason,
    });
  for (const issue of work?.content.issues ?? []) {
    unfinished.push(
      ...issue.openQuestions.map((question) => ({
        issueKey: issue.issueKey,
        kind: 'OPEN_QUESTION' as const,
        description: question.question,
      })),
    );
    unfinished.push(
      ...issue.requirementHandling
        .filter(
          (item) =>
            item.treatment === 'NOT_YET_ADDRESSED' ||
            item.treatment === 'CONDITIONS_UNCONFIRMED',
        )
        .map((item) => ({
          issueKey: issue.issueKey,
          kind: 'UNRESOLVED_REQUIREMENT' as const,
          description: `${item.requirement}：${item.explanation}`,
        })),
    );
  }
  const defaults: Record<JobAidTaskPurpose, string> = {
    INITIAL_PROBLEM_ASSESSMENT:
      '分析当前文档的问题、条件和证据，保存候选问题工作并保留未决事项。',
    OVERALL_CONSISTENCY:
      '基于准确已保存的问题工作核对整体一致性，保留未决事项并形成综合候选。',
    PROBLEM_REVIEW: '在本轮已选择的工程师输入范围内复核和修正问题工作。',
  };
  return {
    schemaVersion: 'wiselink.jobaid-preparation.v1',
    taskPurpose: input.taskPurpose,
    goal:
      input.sealedGoal?.goal ??
      input.facts.taskGoal?.instruction ??
      defaults[input.taskPurpose],
    targetIssueKeys: [
      ...(input.sealedGoal?.targetIssueKeys ??
        input.facts.taskGoal?.targetIssueKeys ??
        []),
    ],
    taskInputRevision: input.taskInputRevision,
    currentInputRevision: input.current.revision,
    currentInputChanged:
      input.taskInputRevision !== input.current.revision ||
      input.documentVersionId !== input.current.source.documentVersionId,
    documentVersionId: input.documentVersionId,
    originalBinding: structuredClone(input.originalBinding),
    lastSaved: work
      ? {
          workRevisionRef: work.workRevisionRef,
          workRevision: work.workRevision,
          basedOnInputRevision: work.basedOnWorkItemRevision,
        }
      : null,
    currentIssues: (work?.content.issues ?? []).map((issue) => ({
      issueKey: issue.issueKey,
      question: issue.question,
    })),
    unfinishedItems: unfinished,
    pendingEngineerInputs: structuredClone(input.facts.pendingEngineerInputs),
    savedUpdates: structuredClone(input.facts.savedUpdates),
    humanConfirmedDecisions: structuredClone(
      input.facts.humanConfirmedDecisions,
    ),
    humanConfirmationStatus: input.facts.humanConfirmationStatus,
    limitations: [...input.facts.limitations],
  };
}

/** The caller supplies an actual SAVE revision, never a model-supplied receipt. */
export function preparationAfterSavedWork(
  view: JobAidPreparationView,
  work: JobAidWorkRevision,
): JobAidPreparationView {
  const refreshed = buildJobAidPreparationView({
    taskPurpose: view.taskPurpose,
    taskInputRevision: view.taskInputRevision,
    current: {
      revision: view.currentInputRevision,
      source: { documentVersionId: view.documentVersionId },
    },
    documentVersionId: view.documentVersionId,
    originalBinding: view.originalBinding,
    latestWork: work,
    facts: {
      pendingEngineerInputs: view.pendingEngineerInputs,
      savedUpdates: view.savedUpdates,
      humanConfirmedDecisions: view.humanConfirmedDecisions,
      humanConfirmationStatus: view.humanConfirmationStatus,
      limitations: view.limitations,
    },
    sealedGoal: view,
  });
  return { ...refreshed, currentInputChanged: view.currentInputChanged };
}
