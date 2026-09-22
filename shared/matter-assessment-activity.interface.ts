/** Read projection of existing receipts; never a new execution source of truth. */
export interface MatterAssessmentActivityQuery {
  attemptRef?: string;
  workRef?: string;
  cursor?: string;
  limit?: number;
}

export type MatterAssessmentActivityKind =
  | 'REGISTERED_SOURCES_READ'
  | 'SOURCE_PAGES_READ'
  | 'ORIGINAL_BOUND'
  | 'ORIGINAL_READ'
  | 'WORK_SAVED'
  | 'CORRECTION_STARTED'
  | 'CORRECTION_GENERATED'
  | 'CORRECTION_UNCHANGED';

export interface MatterAssessmentActivityItem {
  /** Original append-array position, one-based and local to this attempt. */
  sequence: number;
  kind: MatterAssessmentActivityKind;
  occurredAt: string | null;
  documentVersionId?: string;
  parseRunId?: string;
  pageStart?: number;
  pageEnd?: number;
  unitOffset?: number;
  unitCount?: number;
  sourceCount?: number;
  workRef?: string;
  requestId?: string;
}

export interface MatterAssessmentActivityPage {
  matterId: string;
  selection: 'CURRENT' | 'EXACT_ATTEMPT' | 'EXACT_WORK';
  workRef: string | null;
  candidateOnly: true;
  attempt: {
    attemptRef: string;
    status: string;
    active: boolean;
    matterRevisionId: string;
    baseWorkingRevision: number;
    /** Count from the frozen authorized task, not the current workspace. */
    inputCount: number;
  } | null;
  items: MatterAssessmentActivityItem[];
  /** Number of raw receipts before this page; those receipts are not displayed. */
  omittedEarlierCount: number;
  /** Unknown kinds in this page only. */
  unknownOmittedCount: number;
  malformedCount: number;
  duplicateOmittedCount: number;
  error: 'ACTIVITY_UNREADABLE' | 'ACTIVITY_ITEMS_UNREADABLE' | null;
  nextCursor: string | null;
  hasMore: boolean;
}

export const MATTER_ACTIVITY_ACTIVE_STATUSES = [
  'QUEUED',
  'RUNNING',
  'RETRY_SCHEDULED',
  'COMMITTING',
] as const;
