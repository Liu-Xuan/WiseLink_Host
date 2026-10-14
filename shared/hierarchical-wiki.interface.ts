import type {
  DerivedSummaryMember,
  DerivedSummaryScopeSelection,
} from './derived-summary.interface';

export interface HierarchicalWikiEnableRequest {
  fleetFamilyId: string;
  /** Null creates the family page; a concrete model is a separate scope. */
  fleetModelId: string | null;
  /** Legacy registration acknowledgement; automatic new tasks use current settings. */
  modelRef?: string;
}

export interface HierarchicalWikiStatus {
  wikiId: string;
  summaryId: string;
  parentSummaryId: string | null;
  scope: DerivedSummaryScopeSelection;
  enabled: boolean;
  state:
    | 'EMPTY'
    | 'CURRENT'
    | 'PENDING'
    | 'WAITING_UPSTREAM'
    | 'QUEUED'
    | 'RUNNING'
    | 'PARTIAL'
    | 'BLOCKED';
  desiredGeneration: number;
  completedGeneration: number;
  firstDirtyAt: string | null;
  dueAt: string | null;
  coveredMembers: DerivedSummaryMember[];
  waiting: Array<{
    kind: 'DOCUMENT' | 'MATTER' | 'SUMMARY';
    subjectId: string;
    requestId: string | null;
    documentVersionId: string | null;
    status: string;
  }>;
  errorCode: string | null;
  /** Current authorized Host classifications only; publisher currentness stays unknown. */
  coverage: 'AUTHORIZED_CLASSIFIED_HOST_MATERIAL';
  lastCheckedAt: string | null;
  inventoryComplete: boolean;
}

export interface HierarchicalWikiList {
  items: HierarchicalWikiStatus[];
  candidates: Array<{
    summaryId: string;
    memberKey: string;
    sourceKind: 'DOCUMENT' | 'MATTER';
    sourceId: string;
    documentVersionId: string | null;
    ata: string | null;
  }>;
  classifications: Array<
    HierarchicalWikiList['candidates'][number] & {
      title: string;
      status: 'CANDIDATE' | 'CONFIRMED' | 'EXCLUDED';
      automaticMatterUpdates: boolean;
    }
  >;
  nextClassificationCursor: string | null;
  sourceCurrentness: 'UNKNOWN';
}

export interface HierarchicalWikiClassificationRequest {
  sourceKind: 'DOCUMENT' | 'MATTER';
  sourceId: string;
  ata: string | null;
  included: boolean;
}
