// useGraphFilter Hook - Phase 3.3: Filter logic and node filtering
import { useMemo } from 'react';
import type { GraphNode, GraphEdge, NodeType, PerspectiveType } from '../types';
import type { FilterConfig } from '../components/GraphFilter';

interface FilteredGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hiddenNodeIds: Set<string>;
}

/**
 * Calculate node connections (degree)
 */
function getNodeDegree(nodeId: string, edges: GraphEdge[]): number {
  return edges.filter(edge => edge.source === nodeId || edge.target === nodeId).length;
}

/**
 * Apply filters to graph data
 *
 * Features:
 * - Node type filtering
 * - Perspective filtering (future: when nodes have perspective metadata)
 * - Connection count range filtering
 * - Edge visibility control
 * - Maintains graph connectivity (keeps edges between visible nodes)
 *
 * @example
 * ```tsx
 * function GraphPage() {
 *   const [filterConfig, setFilterConfig] = useState<FilterConfig>({
 *     nodeTypes: new Set(['matterHub', 'documentGroup']),
 *     perspectives: new Set(['document']),
 *     showEdges: true,
 *     minConnections: 2
 *   });
 *
 *   const { nodes, edges } = useGraphFilter(graphData, filterConfig);
 * }
 * ```
 */
export function useGraphFilter(
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] },
  filterConfig: FilterConfig
): FilteredGraphData {
  return useMemo(() => {
    const { nodeTypes, perspectives, showEdges, minConnections, maxConnections } = filterConfig;

    // Step 1: Filter nodes by type
    let filteredNodes = graphData.nodes.filter(node => {
      // Check node type
      if (!nodeTypes.has(node.type)) {
        return false;
      }

      // Check connection count
      if (minConnections !== undefined || maxConnections !== undefined) {
        const degree = getNodeDegree(node.id, graphData.edges);
        if (minConnections !== undefined && degree < minConnections) {
          return false;
        }
        if (maxConnections !== undefined && degree > maxConnections) {
          return false;
        }
      }

      // Note: Perspective filtering would go here when nodes have perspective metadata
      // For now, we keep all perspectives as nodes don't have this metadata yet

      return true;
    });

    // Create set of visible node IDs for edge filtering
    const visibleNodeIds = new Set(filteredNodes.map(n => n.id));
    const hiddenNodeIds = new Set(
      graphData.nodes.filter(n => !visibleNodeIds.has(n.id)).map(n => n.id)
    );

    // Step 2: Filter edges
    let filteredEdges = graphData.edges;

    if (!showEdges) {
      // Hide all edges
      filteredEdges = [];
    } else {
      // Keep edges between visible nodes only
      filteredEdges = graphData.edges.filter(
        edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
      );
    }

    return {
      nodes: filteredNodes,
      edges: filteredEdges,
      hiddenNodeIds
    };
  }, [graphData, filterConfig]);
}

/**
 * Default filter configuration (show all)
 */
export function getDefaultFilterConfig(): FilterConfig {
  return {
    nodeTypes: new Set<NodeType>(['matterHub', 'cluster', 'documentGroup', 'compact', 'more']),
    perspectives: new Set<PerspectiveType>(['document', 'knowledge', 'timeline', 'people']),
    showEdges: true,
    minConnections: undefined,
    maxConnections: undefined
  };
}

/**
 * Check if filter is active (not showing all)
 */
export function isFilterActive(filterConfig: FilterConfig): boolean {
  const defaultConfig = getDefaultFilterConfig();

  return (
    filterConfig.nodeTypes.size < defaultConfig.nodeTypes.size ||
    filterConfig.perspectives.size < defaultConfig.perspectives.size ||
    !filterConfig.showEdges ||
    filterConfig.minConnections !== undefined ||
    filterConfig.maxConnections !== undefined
  );
}

/**
 * Count filtered nodes
 */
export function getFilteredCount(
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] },
  filterConfig: FilterConfig
): { total: number; filtered: number; hidden: number } {
  // Apply the same filtering logic without using the hook
  const filteredNodes = graphData.nodes.filter(node => {
    // Node type filter
    if (!filterConfig.nodeTypes.has(node.type)) {
      return false;
    }

    // Connection count filter
    if (filterConfig.minConnections !== undefined || filterConfig.maxConnections !== undefined) {
      const connectionCount = graphData.edges.filter(
        edge => edge.source === node.id || edge.target === node.id
      ).length;

      if (filterConfig.minConnections !== undefined && connectionCount < filterConfig.minConnections) {
        return false;
      }

      if (filterConfig.maxConnections !== undefined && connectionCount > filterConfig.maxConnections) {
        return false;
      }
    }

    return true;
  });

  return {
    total: graphData.nodes.length,
    filtered: filteredNodes.length,
    hidden: graphData.nodes.length - filteredNodes.length
  };
}
