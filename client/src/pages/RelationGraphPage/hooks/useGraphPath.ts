// useGraphPath Hook - Phase 3.2: Path tracing from MatterHub to selected node
import { useMemo } from 'react';
import type { GraphNode, GraphEdge } from '../types';

export interface PathNode {
  id: string;
  title: string;
}

/**
 * Build an adjacency list from edges for efficient neighbor lookup
 * @param edges - All edges in the graph
 * @returns Map of node ID to array of neighbor IDs
 */
function buildAdjacencyList(edges: GraphEdge[]): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();

  edges.forEach((edge) => {
    // Add forward edge
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, []);
    }
    adjacency.get(edge.source)!.push(edge.target);

    // Add backward edge (undirected graph)
    if (!adjacency.has(edge.target)) {
      adjacency.set(edge.target, []);
    }
    adjacency.get(edge.target)!.push(edge.source);
  });

  return adjacency;
}

/**
 * Get the display title from a node
 * @param nodeId - The node ID to get the title for
 * @param nodes - All nodes in the graph
 * @returns The node's display title
 */
function getTitleFromNode(nodeId: string, nodes: GraphNode[]): string {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return nodeId;

  const { data } = node;

  // Extract title based on node type
  if ('title' in data) {
    return data.title;
  }
  if ('heading' in data) {
    return data.heading;
  }
  if ('count' in data && data.type === 'more') {
    return `+${data.count} more`;
  }

  return nodeId;
}

/**
 * Find the shortest path between two nodes using BFS
 * @param startId - Start node ID
 * @param endId - End node ID
 * @param edges - All edges in the graph
 * @param nodes - All nodes in the graph
 * @returns Array of path nodes from start to end, or null if no path exists
 */
function findShortestPath(
  startId: string,
  endId: string,
  edges: GraphEdge[],
  nodes: GraphNode[]
): PathNode[] | null {
  // Same node - return single-node path
  if (startId === endId) {
    return [{ id: startId, title: getTitleFromNode(startId, nodes) }];
  }

  // Build adjacency list for efficient neighbor lookup
  const adjacency = buildAdjacencyList(edges);

  // BFS queue: each element is a path (array of node IDs)
  const queue: string[][] = [[startId]];
  const visited = new Set<string>([startId]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    const neighbors = adjacency.get(current) || [];

    for (const neighbor of neighbors) {
      // Found the target - return the complete path
      if (neighbor === endId) {
        const fullPath = [...path, neighbor];
        return fullPath.map((id) => ({
          id,
          title: getTitleFromNode(id, nodes),
        }));
      }

      // Add unvisited neighbor to queue
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  // No path exists
  return null;
}

/**
 * Hook to calculate the shortest path from MatterHub to the selected node
 *
 * Uses BFS algorithm to find the shortest path in the graph. The path is
 * automatically recalculated when the selected node or graph data changes.
 *
 * @example
 * ```tsx
 * function GraphComponent({ selectedNodeId, graphData }) {
 *   const path = useGraphPath(selectedNodeId, graphData);
 *
 *   if (path) {
 *     // Render path: MatterHub → Intermediate → Selected
 *   }
 * }
 * ```
 */
export function useGraphPath(
  selectedNodeId: string | null,
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] }
): PathNode[] | null {
  return useMemo(() => {
    if (!selectedNodeId) return null;

    // Find the MatterHub node (center node)
    const hubNode = graphData.nodes.find((n) => n.type === 'matterHub');
    if (!hubNode) return null;

    // Don't show path if the selected node is the hub itself
    if (hubNode.id === selectedNodeId) return null;

    return findShortestPath(
      hubNode.id,
      selectedNodeId,
      graphData.edges,
      graphData.nodes
    );
  }, [selectedNodeId, graphData]);
}
