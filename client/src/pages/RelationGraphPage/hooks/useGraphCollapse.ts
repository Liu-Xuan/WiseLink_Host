// useGraphCollapse - Phase 3.7: Node collapse/expand state management
import { useState, useCallback, useMemo } from 'react';
import type { GraphNode, GraphEdge } from '../types';

interface CollapseState {
  [nodeId: string]: boolean; // true = expanded, false = collapsed
}

interface UseGraphCollapseOptions {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onLayoutUpdate?: () => void;
}

export interface GraphCollapseControls {
  collapseState: CollapseState;
  toggleCollapse: (nodeId: string) => void;
  expandNode: (nodeId: string) => void;
  collapseNode: (nodeId: string) => void;
  visibleNodes: GraphNode[];
  visibleEdges: GraphEdge[];
}

/**
 * Graph collapse/expand state management hook
 *
 * Features:
 * - Toggle cluster node collapse/expand
 * - Expand "More" nodes to show hidden nodes
 * - Calculate visible nodes and edges
 * - Trigger layout updates on state change
 *
 * @example
 * ```tsx
 * const collapseControls = useGraphCollapse({
 *   nodes: graphData.nodes,
 *   edges: graphData.edges,
 *   onLayoutUpdate: () => fitView()
 * });
 *
 * // Toggle cluster
 * collapseControls.toggleCollapse('cluster_1');
 *
 * // Expand More node
 * collapseControls.expandNode('more_1');
 * ```
 */
export function useGraphCollapse({
  nodes,
  edges,
  onLayoutUpdate
}: UseGraphCollapseOptions): GraphCollapseControls {
  const [collapseState, setCollapseState] = useState<CollapseState>({});

  /**
   * Toggle collapse state for a node
   */
  const toggleCollapse = useCallback((nodeId: string) => {
    setCollapseState(prev => ({
      ...prev,
      [nodeId]: !prev[nodeId]
    }));

    // Trigger layout update after state change
    setTimeout(() => {
      onLayoutUpdate?.();
    }, 50);
  }, [onLayoutUpdate]);

  /**
   * Expand a specific node
   */
  const expandNode = useCallback((nodeId: string) => {
    setCollapseState(prev => ({
      ...prev,
      [nodeId]: true
    }));

    setTimeout(() => {
      onLayoutUpdate?.();
    }, 50);
  }, [onLayoutUpdate]);

  /**
   * Collapse a specific node
   */
  const collapseNode = useCallback((nodeId: string) => {
    setCollapseState(prev => ({
      ...prev,
      [nodeId]: false
    }));

    setTimeout(() => {
      onLayoutUpdate?.();
    }, 50);
  }, [onLayoutUpdate]);

  /**
   * Calculate visible nodes based on collapse state
   */
  const visibleNodes = useMemo(() => {
    const hiddenNodeIds = new Set<string>();

    // Find all hidden nodes (children of collapsed clusters, hidden by More nodes)
    nodes.forEach(node => {
      const data = node.data;

      // Cluster nodes
      if (data.type === 'cluster' && collapseState[node.id] === false) {
        // Collapsed cluster: hide children
        if ('children' in data && data.children) {
          data.children.forEach((childId: string) => hiddenNodeIds.add(childId));
        }
      }

      // More nodes
      if (data.type === 'more' && collapseState[node.id] !== true) {
        // Unexpanded More node: hide hidden nodes
        if ('hiddenNodes' in data && data.hiddenNodes) {
          data.hiddenNodes.forEach((hiddenId: string) => hiddenNodeIds.add(hiddenId));
        }
      }

      // If More node is expanded, hide the More node itself
      if (data.type === 'more' && collapseState[node.id] === true) {
        hiddenNodeIds.add(node.id);
      }
    });

    // Filter out hidden nodes
    return nodes.filter(node => !hiddenNodeIds.has(node.id));
  }, [nodes, collapseState]);

  /**
   * Calculate visible edges (only connect visible nodes)
   */
  const visibleEdges = useMemo(() => {
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));

    return edges.filter(edge =>
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
    );
  }, [edges, visibleNodes]);

  return {
    collapseState,
    toggleCollapse,
    expandNode,
    collapseNode,
    visibleNodes,
    visibleEdges
  };
}
