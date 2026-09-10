/** Personal collaboration records; none of these operations adopts an assessment. */
export type DialogueOrigin = 'HOST' | 'FEISHU_EXCERPT';
export type DialogueMessagePurpose = 'CHAT' | 'CONTRIBUTION_ONLY';
export type DialogueContributionKind =
  | 'QUESTION'
  | 'HYPOTHESIS'
  | 'CORRECTION'
  | 'CONSTRAINT'
  | 'CLARIFICATION';

export interface DialogueWorkingContext {
  workItemId: string;
  documentVersionId: string;
  workItemRevision: number;
  workingRef: string | null;
  workingRevision: number | null;
  documentLabel: string;
  readAt: string;
  assessmentAsOf: string | null;
  summary: string;
  /** A concise projection, not a claim that the model read the entire document. */
  projection: 'CURRENT_WORKING_SUMMARY';
  openQuestions: string[];
  pendingContributions: Array<{
    contributionRef: string;
    kind: DialogueContributionKind;
    selectedText: string;
    sourceContext: Array<{
      messageRef: string;
      userText: string;
      assistantText: string | null;
      contextWorkItemIds: string[];
    }>;
  }>;
}

export interface DialogueQueryReadModel {
  queryRef: string;
  status: 'STARTING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  answer: string | null;
  error: string | null;
  incomplete: boolean;
}

export interface DialogueMessageReadModel {
  messageRef: string;
  threadRef: string;
  userText: string;
  origin: DialogueOrigin;
  provenance: 'HOST_USER_INPUT' | 'USER_SUBMITTED_EXCERPT';
  originDetails: {
    label?: string;
    sourceUrl?: string;
    sourceMessageId?: string;
  };
  focus: DialogueWorkingContext[];
  purpose: DialogueMessagePurpose;
  executor: 'AILY' | 'NONE';
  receivedAt: string;
  threadRevision: number;
  response: DialogueQueryReadModel | null;
}

export interface DialogueContributionReadModel {
  contributionRef: string;
  threadRef: string;
  messageRef: string;
  sourcePart: 'USER' | 'ASSISTANT';
  selectedText: string;
  workItemId: string;
  kind: DialogueContributionKind;
  revision: number;
  status: 'ACTIVE' | 'WITHDRAWN';
  supersedesRef: string | null;
  audience: 'PRIVATE';
  createdAt: string;
  usedBy: Array<{
    reviewTurnId: string;
    workItemId: string;
    workingRef: string | null;
  }>;
}

export interface DialogueThreadReadModel {
  threadRef: string;
  revision: number;
  audience: 'PRIVATE';
  focusWorkItemIds: string[];
  messages: DialogueMessageReadModel[];
  contributions: DialogueContributionReadModel[];
  aily: { available: boolean; reason?: string };
  nextMessageCursor: string | null;
}

export interface CreateDialogueRequest {
  requestId: string;
  workItemIds?: string[];
}

export interface AppendDialogueMessageRequest {
  requestId: string;
  expectedThreadRevision: number;
  userText: string;
  workItemIds?: string[];
  purpose?: DialogueMessagePurpose;
  origin?: DialogueOrigin;
  originDetails?: DialogueMessageReadModel['originDetails'];
}

export interface SaveDialogueContributionRequest {
  requestId: string;
  expectedThreadRevision: number;
  messageRef: string;
  sourcePart: 'USER' | 'ASSISTANT';
  selection: { start: number; end: number };
  workItemId: string;
  kind: DialogueContributionKind;
  supersedesContributionRef?: string;
}

export interface WithdrawDialogueContributionRequest {
  requestId: string;
  expectedRevision: number;
}

export interface RequestDialogueAssessment {
  requestId: string;
  workItemId: string;
  expectedWorkItemRevision: number;
  expectedWorkingRef: string | null;
  contributions: Array<{ contributionRef: string; expectedRevision: number }>;
  userMessage: string;
}

export interface DialogueAssessmentResponse {
  requestRef: string;
  workItemId: string;
  reviewConversationId: string;
  reviewTurnId: string;
  replayed: boolean;
}

export interface DialogueThreadSummary {
  threadRef: string;
  createdAt: string;
}
