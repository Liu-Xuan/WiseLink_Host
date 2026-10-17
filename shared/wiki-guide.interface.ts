import type { DerivedSummaryScopeSelection } from './derived-summary.interface';
import type { EngineeringIssueSearchHit } from './engineering-issue-search.interface';

/** Discovery pointers only. Every body still uses its existing exact reader. */
export interface WikiGuidePathSegment {
  summaryId: string;
  parentSummaryId: string | null;
  scope: DerivedSummaryScopeSelection;
  currentSummaryRef: string | null;
  currentRevision: number;
}

export interface WikiGuideNode extends WikiGuidePathSegment {
  wikiId: string;
  enabled: boolean;
  currentBodyStatus: 'AVAILABLE' | 'UPDATING_SCOPE';
  state: 'EMPTY' | 'CURRENT' | 'PENDING' | 'WAITING_UPSTREAM' | 'QUEUED' | 'RUNNING' | 'PARTIAL' | 'BLOCKED';
  /** Real registered ancestors, followed by this node. Never inferred from text. */
  path: WikiGuidePathSegment[];
}

export interface WikiGuideNavigationQuery {
  /** Fetch one exact registered node and its real path, including return-state restore. */
  summaryId?: string;
  /** Omit for registered fleet roots; otherwise returns this node's direct children. */
  parentSummaryId?: string;
  /** With search, limits chapter discovery to this real registered fleet root. */
  rootSummaryId?: string;
  search?: string;
  after?: string;
  /** Default 20, maximum 50. */
  limit?: number;
}

export interface WikiGuideNavigationPage {
  items: WikiGuideNode[];
  nextCursor: string | null;
}

export interface WikiGuideIssueQuery {
  search: string;
  rootSummaryId: string;
  chapterSummaryId?: string;
  scope?: 'CURRENT' | 'HISTORY';
  after?: string;
  /** Default 20, maximum 20. */
  limit?: number;
}

export interface WikiGuideIssueHit {
  subjectKind: EngineeringIssueSearchHit['subjectKind'];
  subjectId: string;
  workRef: string;
  workRevision: number;
  issueKey: string;
  question: string;
  documentVersionId: string | null;
  /** Exact confirmed membership paths, not a claim that a saved Wiki covers it. */
  paths: WikiGuidePathSegment[][];
}

export interface WikiGuideIssuePage {
  items: WikiGuideIssueHit[];
  nextCursor: string | null;
  coverage: 'CONFIRMED_WIKI_MEMBERS';
}
