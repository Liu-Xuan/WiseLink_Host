// RelationGraphPage - Main orchestration component
import React, { useState, useCallback, useRef, useMemo } from 'react';
import GraphCanvas from './components/GraphCanvas';
import { GraphPathTrail } from './components/GraphPathTrail';
import { GraphSearchBar } from './components/GraphSearchBar';
import { GraphFilter } from './components/GraphFilter';
import { RelationshipLegend } from './components/RelationshipLegend';
import { PerspectiveSwitcher } from './components/PerspectiveSwitcher';
import { TimelinePanel } from './components/TimelinePanel';
import { KnowledgePanel } from './components/KnowledgePanel';
import { GraphErrorBoundary } from './components/GraphErrorBoundary';
import { GraphLoadingSkeleton } from './components/GraphLoadingSkeleton';
import { HistoryNavigation } from './components/HistoryNavigation';
import { useGraphData } from './hooks/useGraphData';
import { useGraphPath } from './hooks/useGraphPath';
import { useGraphFilter, getDefaultFilterConfig } from './hooks/useGraphFilter';
import { useGraphHistory } from './hooks/useGraphHistory';
import { getRelationshipTypes, getStrengthDistribution } from './hooks/useEdgeStyles';
import { DocumentListPanel } from './components/DocumentListPanel';
import { transformGraphDataToMatter } from './adapters/matterAdapter';
import type { DocumentItem } from './components/DocumentListPanel';
import type { PerspectiveType } from './types';
import type { RelationGraphNodeData } from './relation-graph-data';
import type { CanonicalLibraryIndexReadResponse } from '@shared/api.interface';
import type { FilterConfig } from './components/GraphFilter';
import './RelationGraphPage.css';
import './styles/graph.css';

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
  const [selectedDocGroup, setSelectedDocGroup] = useState<string | null>(null);
  const [filterConfig, setFilterConfig] = useState<FilterConfig>(getDefaultFilterConfig());
  const [legendVisible, setLegendVisible] = useState(false);
  const graphRef = useRef<any>(null);
  const { data, isLoading, error } = useGraphData(perspective);

  // Extract workItemId from URL path: /app/:workItemId/graph
  const workItemId = window.location.pathname.split('/')[2] || 'app_17bzc551rsg';

  const effectiveSelectedNodeId = highlightedNodeId || selectedNodeId;

  // History navigation callback
  const handleHistoryStateChange = useCallback((nodeId: string | null, newPerspective: PerspectiveType) => {
    setSelectedNodeId(nodeId);
    setPerspective(newPerspective);
  }, []);

  // History navigation hook
  const historyControls = useGraphHistory(
    effectiveSelectedNodeId,
    perspective,
    handleHistoryStateChange
  );

  // Apply filter to data before transformation
  const filteredData = useGraphFilter(
    data || { nodes: [], edges: [] },
    filterConfig
  );

  // Transform filtered GraphData to Matter format for Cytoscape (memoized)
  const matterData = useMemo(() => {
    return filteredData.nodes.length > 0
      ? transformGraphDataToMatter(filteredData, workItemId)
      : null;
  }, [filteredData, workItemId]);

  // Calculate edge statistics for legend (using filtered data)
  const relationshipTypes = filteredData.edges.length > 0 ? getRelationshipTypes(filteredData.edges) : undefined;
  const strengthDistribution = filteredData.edges.length > 0 ? getStrengthDistribution(filteredData.edges) : undefined;

  // Calculate path from MatterHub to selected node (using filtered data)
  const path = useGraphPath(
    effectiveSelectedNodeId,
    filteredData
  );

  const handleNodeClick = (nodeId: string) => {
    // Check if it's a documentGroup or more node
    const node = filteredData.nodes.find(n => n.id === nodeId);

    // Check if it's a documentGroup node
    if (node?.type === 'documentGroup') {
      setSelectedDocGroup(nodeId);
      return;
    }

    if (node?.data.type === 'more') {
      // TODO: Implement more node expansion logic
      console.log('More node clicked:', nodeId);
      return;
    }

    // Normal node selection - use history pushState
    historyControls.pushState(nodeId, perspective);

    if (onNodeSelect && data) {
      if (node) {
        const nodeData = node.data;
        let title = '';
        if ('title' in nodeData && typeof nodeData.title === 'string') {
          title = nodeData.title;
        } else if ('heading' in nodeData && typeof nodeData.heading === 'string') {
          title = nodeData.heading;
        }
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

  const handleSelect = (node: any, edge?: boolean) => {
    if (edge) {
      console.log('Edge selected:', node);
      return;
    }
    handleNodeClick(node.id);
  };

  const handleGroup = (key: string, id?: string) => {
    console.log('Group action:', key, id);
    // If id is provided, it means a hidden node was selected
    if (id) {
      historyControls.pushState(id, perspective);
    } else {
      // Group expansion - could show DocumentListPanel or expand group
      setSelectedDocGroup(key);
    }
  };

  const handlePerspectiveChange = (newPerspective: PerspectiveType) => {
    // Use history pushState to record perspective changes
    historyControls.pushState(effectiveSelectedNodeId, newPerspective);
  };

  const handleTimelineEventClick = (artifactRef: string) => {
    // Timeline events reference artifacts; find matching node by artifactRef
    // For now, directly use artifactRef as nodeId for selection
    historyControls.pushState(artifactRef, perspective);
  };

  const handlePathNodeClick = (nodeId: string) => {
    // Navigate to a node in the path
    historyControls.pushState(nodeId, perspective);
  };

  const handleSearchResultClick = (nodeId: string) => {
    // Focus on search result node
    historyControls.pushState(nodeId, perspective);
  };

  const handleFilterChange = (newFilterConfig: FilterConfig) => {
    setFilterConfig(newFilterConfig);
  };

  // DocumentListPanel helpers
  const getGroupTitle = (groupId: string): string => {
    const node = data?.nodes.find(n => n.id === groupId);
    if (node?.type === 'documentGroup') {
      return node.data.title;
    }
    return '文档组';
  };

  const getGroupDocuments = (groupId: string): DocumentItem[] => {
    const node = data?.nodes.find(n => n.id === groupId);
    if (node?.type === 'documentGroup') {
      return node.data.docs.map((doc, index) => ({
        id: `${groupId}_doc_${index}`,
        title: doc,
      }));
    }
    return [];
  };

  const getGroupCount = (groupId: string): number => {
    const node = data?.nodes.find(n => n.id === groupId);
    if (node?.type === 'documentGroup') {
      return node.data.count;
    }
    return 0;
  };

  const handleDocumentClick = (docId: string) => {
    console.log('Document clicked:', docId);
    // TODO: Implement document selection logic
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
        <div className="graph-header-controls">
          <HistoryNavigation controls={historyControls} compact={true} />
          <GraphSearchBar
            nodes={data?.nodes || []}
            onResultClick={handleSearchResultClick}
          />
          <GraphFilter
            filterConfig={filterConfig}
            onFilterChange={handleFilterChange}
            totalNodes={data?.nodes.length || 0}
            filteredNodes={filteredData.nodes.length}
          />
          <PerspectiveSwitcher current={perspective} onChange={handlePerspectiveChange} />
        </div>
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
          ) : matterData ? (
            <GraphErrorBoundary>
              <GraphCanvas
                matter={matterData}
                selected={effectiveSelectedNodeId}
                onSelect={handleSelect}
                onGroup={handleGroup}
                hidden={[]}
                graphRef={graphRef}
                compact={false}
                viewKey={perspective}
              />
              <GraphPathTrail
                path={path}
                onNodeClick={handlePathNodeClick}
              />
              <button
                className="legend-toggle"
                onClick={() => setLegendVisible(!legendVisible)}
                title={legendVisible ? '隐藏图例' : '显示图例'}
              >
                {legendVisible ? '✕' : 'ℹ️'}
              </button>
              {legendVisible && relationshipTypes && strengthDistribution && (
                <RelationshipLegend
                  relationshipTypes={relationshipTypes}
                  strengthDistribution={strengthDistribution}
                  onClose={() => setLegendVisible(false)}
                />
              )}
            </GraphErrorBoundary>
          ) : null}
        </div>

        {selectedDocGroup && (
          <DocumentListPanel
            groupTitle={getGroupTitle(selectedDocGroup)}
            documents={getGroupDocuments(selectedDocGroup)}
            totalCount={getGroupCount(selectedDocGroup)}
            onDocumentClick={handleDocumentClick}
            onClose={() => setSelectedDocGroup(null)}
          />
        )}

        <KnowledgePanel selectedNodeId={effectiveSelectedNodeId} />
      </div>
    </div>
  );
}
