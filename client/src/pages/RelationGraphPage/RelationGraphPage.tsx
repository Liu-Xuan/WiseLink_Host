// RelationGraphPage - Main orchestration component
import React, { useState } from 'react';
import { GraphView } from './components/GraphView';
import { GraphPathTrail } from './components/GraphPathTrail';
import { PerspectiveSwitcher } from './components/PerspectiveSwitcher';
import { TimelinePanel } from './components/TimelinePanel';
import { KnowledgePanel } from './components/KnowledgePanel';
import { GraphErrorBoundary } from './components/GraphErrorBoundary';
import { GraphLoadingSkeleton } from './components/GraphLoadingSkeleton';
import { useGraphData } from './hooks/useGraphData';
import { useGraphPath } from './hooks/useGraphPath';
import type { PerspectiveType } from './types';
import type { RelationGraphNodeData } from './relation-graph-data';
import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';
import './RelationGraphPage.css';

export interface RelationGraphPageProps {
  /** Optional injected projection for testing/samples */
  injectedProjection?: CanonicalLibraryIndexReadResponse;
  /** Optional callback when a node is selected */
  onNodeSelect?: (node: RelationGraphNodeData) => void;
  /** Optional highlighted node ID for external control */
  highlightedNodeId?: string;
}

export function RelationGraphPage({
  injectedProjection,
  onNodeSelect,
  highlightedNodeId,
}: RelationGraphPageProps = {}) {
  const [perspective, setPerspective] = useState<PerspectiveType>('document');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { data, isLoading, error } = useGraphData(perspective);

  // Extract workItemId from URL path: /app/:workItemId/graph
  const workItemId = window.location.pathname.split('/')[2] || 'app_17bzc551rsg';

  const effectiveSelectedNodeId = highlightedNodeId || selectedNodeId;

  // Calculate path from MatterHub to selected node
  const path = useGraphPath(
    effectiveSelectedNodeId,
    data || { nodes: [], edges: [] }
  );

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (onNodeSelect && data) {
      const node = data.nodes.find(n => n.id === nodeId);
      if (node) {
        const nodeData = node.data;
        const title = 'title' in nodeData ? nodeData.title :
                     'heading' in nodeData ? nodeData.heading : '';
        onNodeSelect({
          id: node.id,
          title,
          label: title,
          detail: '',
          type: 'document',
        });
      }
    }
  };

  const handleTimelineEventClick = (artifactRef: string) => {
    // Timeline events reference artifacts; find matching node by artifactRef
    // For now, directly use artifactRef as nodeId for selection
    setSelectedNodeId(artifactRef);
  };

  const handlePathNodeClick = (nodeId: string) => {
    // Navigate to a node in the path
    setSelectedNodeId(nodeId);
  };

  if (error) {
    return (
      <div className="relation-graph-page">
        <div className="error-state">
          <h2>加载失败</h2>
          <p>{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relation-graph-page">
      <div className="graph-header">
        <h1>关系图谱</h1>
        <PerspectiveSwitcher current={perspective} onChange={setPerspective} />
      </div>

      <div className="graph-container">
        <TimelinePanel
          workItemId={workItemId}
          selectedNodeId={effectiveSelectedNodeId}
          onEventClick={handleTimelineEventClick}
        />

        <div className="graph-main">
          {isLoading ? (
            <GraphLoadingSkeleton />
          ) : data ? (
            <GraphErrorBoundary>
              <GraphView
                graphData={data}
                onNodeClick={handleNodeClick}
                selectedNodeId={effectiveSelectedNodeId}
                perspective={perspective}
                forceLayoutEnabled={true}
              />
              <GraphPathTrail
                path={path}
                onNodeClick={handlePathNodeClick}
              />
            </GraphErrorBoundary>
          ) : null}
        </div>

        <KnowledgePanel selectedNodeId={effectiveSelectedNodeId} />
      </div>
    </div>
  );
}
