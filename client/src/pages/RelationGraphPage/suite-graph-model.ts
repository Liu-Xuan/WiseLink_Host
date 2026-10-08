export type SuiteGraphRelationMode = 'aggregated' | 'individual';

export interface SuiteGraphItem {
  id: string;
  title: string;
  subtitle?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface SuiteGraphGroup {
  key: string;
  title: string;
  items: SuiteGraphItem[];
  color?: string;
  columns?: 1 | 2;
  relation?: string;
}

export interface SuiteGraphRelation {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  /** Omitted on legacy edges; source declarations never imply Host adoption. */
  authority?: 'SOURCE_EXPLICIT' | 'CANDIDATE_ONLY' | 'HOST_RECORDED' | 'UNKNOWN';
  /** Host selection is not proof of the latest official source version. */
  currentness?: 'SELECTED_HOST_OBSERVATION' | 'HISTORICAL_HOST_OBSERVATION' | 'UNKNOWN';
}

export interface SuiteGraphMatter {
  id: string;
  title: string;
  rootKind: 'matter' | 'document' | 'display';
  code?: string;
  picture?: string;
  groups: SuiteGraphGroup[];
  relations: SuiteGraphRelation[];
}

export interface SuiteGraphPresentationOptions {
  hiddenGroups?: readonly string[];
  density?: number;
  relationMode?: SuiteGraphRelationMode;
  layoutMode?: 'reference' | 'force';
  page?: number;
  maxGroups?: number;
}

export interface CytoscapeSuiteNode {
  group: 'nodes';
  data: Record<string, unknown>;
  position: { x: number; y: number };
  classes?: string;
  grabbable?: boolean;
  selectable?: boolean;
}

export interface CytoscapeSuiteEdge {
  group: 'edges';
  data: Record<string, unknown>;
  classes?: string;
}

export type CytoscapeSuiteElement = CytoscapeSuiteNode | CytoscapeSuiteEdge;

export interface SuiteGraphGroupView {
  key: string;
  id: string;
  title: string;
  color?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  count: number;
  visible: number;
  overflow: number;
}

export interface SuiteGraphOverflow {
  page: number;
  pageSize: number;
  totalGroups: number;
  displayedGroups: number;
  omittedGroupKeys: string[];
  hasMore: boolean;
}

export interface SuiteGraphPresentation {
  elements: CytoscapeSuiteElement[];
  groups: SuiteGraphGroupView[];
  visibleIds: string[];
  visibleItemIds: string[];
  overflow: SuiteGraphOverflow;
  counts: {
    loaded: { groups: number; items: number; relationships: number };
    eligible: { groups: number; items: number };
    page: { index: number; size: number; count: number; pageCount: number };
    shown: { groups: number; items: number; cards: number };
    represented: { relationships: number; displayConnections?: number; businessRelationships?: number };
  };
  omittedRelationships: Array<{ id: string; reason: 'missingEndpoint' | 'hiddenGroup' | 'offPage' | 'cardOverflow' }>;
  bounds: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
}
