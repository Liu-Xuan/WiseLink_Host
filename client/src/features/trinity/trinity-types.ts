export type TrinityLevel = 'macro' | 'focus';

export interface TrinityStageMeta {
  id: string;
  title: string;
  caption: string;
  purpose: string;
  output: string;
}

export interface TrinityKnowledgeStageMeta {
  id: string;
  title: string;
  purpose: string;
}

export interface TrinityMatter {
  id: string;
  code: string;
  title: string;
  fleet: string;
  ata: string;
  tag: string;
  status: string;
  brief: string;
  next: string;
  /** Null when the directory row does not expose enough saved-work detail to classify attention. */
  attention: boolean | null;
  activeStages: string[];
}

export interface TrinityEventItem {
  id: string;
  matter: string;
  date: string | null;
  title: string;
  kind: string;
}

export interface TrinityKnowledgeItem {
  id: string;
  matter: string;
  phase: string;
  title: string;
  version: string;
  status: string;
  reuse: string[];
  reuseCountKnown?: boolean;
}

export interface TrinityReviewConditionItem {
  itemId: string;
  text: string;
  basisRefs: string[];
  when?:
    | { kind: 'DUE_AT'; at: string }
    | { kind: 'ORIGINAL_CHANGED'; inputId: string; afterParseRunId: string | null };
  matterId: string;
  matterWorkRevisionId: string;
  workingRevision: number;
}

export interface TrinitySampleMeta {
  name: string;
  asOf: string;
  origin: string;
  currentHostVerified: boolean;
}

export type TrinityAvailability = 'loading' | 'failed' | 'denied' | 'partial' | 'complete';

export interface TrinityCoverage {
  /** Whether the authorized matter directory has been exhausted and de-duplicated. */
  matterTotal?: TrinityAvailability;
  matters?: TrinityAvailability;
  /** Whether lifecycle associations are complete for every matter in scope. */
  lifecycle?: TrinityAvailability;
  events?: TrinityAvailability;
  knowledge?: TrinityAvailability;
}

export interface TrinitySituationData {
  meta: TrinitySampleMeta;
  stages: TrinityStageMeta[];
  knowledgeStages: TrinityKnowledgeStageMeta[];
  matters: TrinityMatter[];
  events: TrinityEventItem[];
  knowledge: TrinityKnowledgeItem[];
  availability?: TrinityAvailability;
  coverage?: TrinityCoverage;
  /** Projected only for a focused matter with a current saved work revision.
   *  null means the focus loaded without any current saved work;
   *  undefined means no focus projection is in scope. */
  reviewConditions?: TrinityReviewConditionItem[] | null;
}

export interface TrinitySituationMetrics {
  visibleMatters: number | null;
  attention: number | null;
  knowledgeWorks: number | null;
  effectWatch: number | null;
}

export type TrinityNavigationTarget =
  | { type: 'view'; view: 'situation' | 'timeline' | 'graph' | 'library' }
  | { type: 'focus-matter'; matterId: string }
  | { type: 'matter-reading'; matterId: string }
  | { type: 'matter-work'; matterId: string; workRef: string }
  | { type: 'matter-timeline'; matterId: string }
  | { type: 'event'; eventId: string }
  | { type: 'knowledge-item'; knowledgeId: string }
  | { type: 'knowledge-view'; phase?: string }
  | { type: 'stage-library'; stageId: string }
  | { type: 'stage-knowledge'; stageId: string }
  | { type: 'agent' };
