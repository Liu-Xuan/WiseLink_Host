/** Read-only view contracts. Authority, fetching and business transitions stay in Host. */
export type MonitorView = 'flow' | 'requests' | 'resources' | 'verification';
export type ReadState = 'current' | 'refreshing' | 'failed' | 'stale';
export type Axis = string | {
  label?: string;
  status?: string;
  tone?: 'good' | 'wait' | 'error';
};

export interface Reference {
  label: string;
  ref: string;
}

export interface RequestObservation {
  id: string;
  recordKind?: 'request' | 'attempt';
  /** Optional target inside the outer authorized scope, such as a WorkItem in a Matter. */
  subjectRef?: string;
  subjectLabel?: string;
  targetLabel?: string;
  /** Exact sealed execution mode when the authoritative read provides it. */
  executionMode?: string;
  status: Axis;
  artifact?: string;
  next?: string;
  navigationLabel?: string;
  owner?: string;
  /** Exact dynamic-attempt DB timestamps; not readiness, readability or ACK. */
  createdAt?: string;
  firstSavedAt?: string;
  completedAt?: string;
  queuedAt?: string;
  startedAt?: string;
  lastProgressAt?: string;
  waitingReason?: string;
}

export interface RuntimeNode {
  id: string;
  label: string;
  group: '来源' | '阅读交付' | '工程工作' | '公司与机队事实' | '知识积累';
  kind: 'task' | 'fact' | 'view' | 'action';
  execution: Axis;
  artifact: Axis;
  coverage: Axis;
  business: Axis;
  summary: string;
  /** Scope of the coverage statement, not a claim that every business source was read. */
  coverageScope?: string;
  /** Source/business observation time, when provided by that source; distinct from meta.observedAt. */
  sourceObservedAt?: string;
  requestCoverage?: string;
  /** Missing or empty requests never implies a complete collection. */
  requestCompleteness?: 'complete' | 'latest_only' | 'partial' | 'not_provided';
  requests: RequestObservation[];
  outputs: Reference[];
  inputRefs: Reference[];
}

export interface RuntimeEdge {
  /** A runtime relationship instance, not a task dependency or scheduler instruction. */
  id: string;
  templateId?: string;
  from: string;
  to: string;
  status: 'consumed' | 'pending' | 'unknown';
  label: string;
  refs: string[];
}

export interface RuntimeProjection {
  schemaVersion: 1;
  meta: {
    mode: 'demo' | 'snapshot' | 'live';
    /** Time the authoritative read occurred; never substitute the render time. */
    observedAt: string;
    environment: string;
    /** Changes with the authorized session/tenant/object scope. */
    scopeKey: string;
    /** Host reports read progress; the view does not infer freshness from elapsed time. */
    readState?: ReadState;
    readError?: string | null;
  };
  /** One authorized object. Environment-wide task lists need a separate read model. */
  scope: { id: string; label: string; model: string; kind?: 'work_item' | 'matter' | 'document' };
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  resources?: {
    scope: string;
    items: Array<{ label: string; value: string | number | null; detail: string }>;
  };
}

export interface CatalogRecord {
  id: string;
  [field: string]: unknown;
}

export interface VerificationEvidence {
  id: string;
  kind: 'source_review' | 'test' | 'deployment' | 'runtime';
  status: string;
  summary?: string;
  contractRevision?: string | null;
  sourceRevision?: string | null;
  environmentId?: string | null;
  observedAt?: string | null;
  /** Only explicit unit/contract evidence can be compared without an environment. */
  testLevel?: 'unit' | 'contract' | 'integration' | 'e2e' | '' | null;
  bindingIds?: string[];
  nodeIds?: string[];
  edgeIds?: string[];
  scenarioIds?: string[];
  reportRef?: string | null;
  [field: string]: unknown;
}

export interface VerificationGap {
  id: string;
  kind: VerificationEvidence['kind'];
  reason: string;
  nextAction: string;
}

export interface VerificationWorkPackage {
  id: string;
  label: string;
  bindingIds?: string[];
  scenarioIds?: string[];
  nextAction?: string;
  /** Bounded delivery summary; never contributes to exact-version evidence coverage. */
  progress?: {
    delivered: string;
    remaining: string;
    owner: string;
    acceptance: string;
    evidenceIds: string[];
  };
}

export interface VerificationBinding extends CatalogRecord {
  workPackageIds?: string[];
  gaps?: VerificationGap[];
}

export interface VerificationSnapshot {
  formatVersion: 1;
  snapshot: {
    dataMode: 'snapshot' | 'demo';
    workPackages?: VerificationWorkPackage[];
    generatedAt: string;
    contract: {
      version: string;
      source: string;
      sourceRevision: string;
      sourceRevisionType: 'sha256';
    };
    target: { sourceRevision: string | null; environmentId: string | null };
    [field: string]: unknown;
  };
  catalog: {
    nodes: CatalogRecord[];
    edges: CatalogRecord[];
    scenarios: CatalogRecord[];
    rules: CatalogRecord[];
  };
  bindings: VerificationBinding[];
  selection: {
    changedNodeIds: string[];
    changedEdgeIds: string[];
    scenarioIds: string[];
    reason: string;
  };
  evidence: VerificationEvidence[];
}

export interface NavigationRequest {
  kind: 'artifact' | 'source' | 'request';
  nodeId: string;
  requestId?: string;
  attemptId?: string;
  recordKind?: 'request' | 'attempt';
  ref?: string;
  /** The parent compares these to its current authorized selection before navigating. */
  scopeKey?: string;
  subjectRef?: string;
}

export interface MonitorInputs {
  runtime?: RuntimeProjection | null;
  verification?: VerificationSnapshot | null;
  view?: MonitorView;
  allowVerification?: boolean;
  /** Hosts without a read callback hide the refresh control. Omission preserves the element default. */
  allowRefresh?: boolean;
}

export interface WiseLinkMonitorElement extends HTMLElement {
  runtime: RuntimeProjection | null;
  verification: VerificationSnapshot | null;
  view: MonitorView;
  allowVerification: boolean;
  /** Apply a group of parent props with one render. */
  updateInputs(inputs: MonitorInputs): void;
  /** Select an existing item for read-only audit; does not change evidence or test selection. */
  focusVerification(category: 'binding' | 'node' | 'edge' | 'scenario', id: string): void;
}
