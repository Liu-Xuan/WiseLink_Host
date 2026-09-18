// RelationGraphPage - Main orchestration component
import React, { useState } from 'react';
import { GraphView } from './components/GraphView';
import { PerspectiveSwitcher } from './components/PerspectiveSwitcher';
import { TimelinePanel } from './components/TimelinePanel';
import { KnowledgePanel } from './components/KnowledgePanel';
import { GraphErrorBoundary } from './components/GraphErrorBoundary';
import { GraphLoadingSkeleton } from './components/GraphLoadingSkeleton';
import { useGraphData } from './hooks/useGraphData';
import type { PerspectiveType } from './types';
import './RelationGraphPage.css';

export function RelationGraphPage() {
  const [perspective, setPerspective] = useState<PerspectiveType>('document');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const { data, isLoading, error } = useGraphData(perspective);

  const handleNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
  };

  const handleTimelineEventClick = (documentId: string) => {
    setSelectedNodeId(documentId);
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
          selectedNodeId={selectedNodeId}
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
                selectedNodeId={selectedNodeId}
                perspective={perspective}
                forceLayoutEnabled={true}
              />
            </GraphErrorBoundary>
          ) : null}
        </div>

        <KnowledgePanel selectedNodeId={selectedNodeId} />
      </div>
    </div>
  );
}
