// RelationGraphPage TypeScript type definitions

export type PerspectiveType = 'document' | 'knowledge' | 'timeline' | 'people';

export type NodeType = 'documentGroup' | 'compact' | 'cluster' | 'matterHub' | 'more';

export interface DocumentGroupData {
  title: string;
  count: number;
  docs: string[];
  metadata?: Record<string, unknown>;
}

export interface CompactDocumentData {
  title: string;
  brief: string;
  type: 'document';
  tone?: 'blue' | 'green' | 'amber' | 'red';
  metadata?: Record<string, unknown>;
}

export interface ClusterData {
  heading: string;
  count: number;
  type: 'cluster';
  tone?: 'blue' | 'green' | 'amber' | 'red';
}

export interface MatterHubData {
  title: string;
  subtitle?: string;
  image?: string;
  type: 'matter';
  tone?: 'blue' | 'green' | 'amber' | 'red';
}

export interface MoreNodeData {
  count: number;
  parentId: string;
  type: 'more';
}

export type NodeData =
  | DocumentGroupData
  | CompactDocumentData
  | ClusterData
  | MatterHubData
  | MoreNodeData;

export interface GraphNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: NodeData;
  className?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  animated?: boolean;
  label?: string;
  type?: 'reference' | 'dependency' | 'relation';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: 'create' | 'update' | 'comment' | 'review';
  title: string;
  documentId?: string;
  personId?: string;
  description?: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  relatedNodes: string[];
  tags: string[];
}

export interface GraphContextValue {
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  perspective: PerspectiveType;
  setPerspective: (perspective: PerspectiveType) => void;
}
