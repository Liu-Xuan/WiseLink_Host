// Relation Graph Data - Types and interfaces for graph node data
// This module provides types for the graph visualization

export interface RelationGraphNodeData {
  id: string;
  title: string;
  label?: string;
  detail?: string;
  type: 'document' | 'knowledge' | 'timeline' | 'people';
  metadata?: Record<string, unknown>;
}

export interface RelationGraphEdgeData {
  id: string;
  source: string;
  target: string;
  label?: string;
  type?: string;
}
