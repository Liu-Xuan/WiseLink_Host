// useNodeHighlight Hook - Phase 3.1: Focus Mode node dimming/highlighting
import { useEffect } from 'react';
import { useReactFlow } from 'reactflow';
import type { GraphEdge } from '../types';

interface UseNodeHighlightOptions {
  /** Currently selected node ID */
  selectedNodeId: string | null;
  /** Opacity for dimmed nodes (default 0.27) */
  dimOpacity?: number;
  /** Opacity for dimmed edges (default 0.15) */
  edgeDimOpacity?: number;
}

/**
 * Get all nodes connected to the given node (1-hop neighbors)
 * @param nodeId - The node to find connections for
 * @param edges - All edges in the graph
 * @returns Set of connected node IDs including the source node
 */
function getConnectedNodeIds(nodeId: string, edges: GraphEdge[]): Set<string> {
  const connected = new Set<string>([nodeId]);

  edges.forEach((edge) => {
    if (edge.source === nodeId) {
      connected.add(edge.target);
    }
    if (edge.target === nodeId) {
      connected.add(edge.source);
    }
  });

  return connected;
}

/**
 * Focus Mode: Highlight selected node and its neighbors, dim others
 *
 * When a node is selected:
 * - Selected node and its 1-hop neighbors remain at full opacity
 * - Other nodes are dimmed to dimOpacity (default 0.27)
 * - Edges connected to focused nodes remain visible
 * - Other edges are dimmed to edgeDimOpacity (default 0.15)
 *
 * When no node is selected, all nodes and edges restore to full opacity.
 *
 * @example
 * ```tsx
 * function GraphView({ selectedNodeId }) {
 *   useNodeHighlight({ selectedNodeId });
 *   // Node styles are automatically updated
 * }
 * ```
 */
export function useNodeHighlight({
  selectedNodeId,
  dimOpacity = 0.27,
  edgeDimOpacity = 0.15,
}: UseNodeHighlightOptions) {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow();

  useEffect(() => {
    const nodes = getNodes();
    const edges = getEdges() as GraphEdge[];

    if (!selectedNodeId) {
      // No selection: restore all nodes and edges to full opacity
      setNodes(
        nodes.map((n) => ({
          ...n,
          style: { ...n.style, opacity: 1 },
        }))
      );
      setEdges(
        edges.map((e) => ({
          ...e,
          style: { ...e.style, opacity: 1 },
        }))
      );
      return;
    }

    // Get all nodes connected to the selected node (1-hop)
    const relatedIds = getConnectedNodeIds(selectedNodeId, edges);

    // Dim unrelated nodes
    setNodes(
      nodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          opacity: relatedIds.has(node.id) ? 1 : dimOpacity,
        },
      }))
    );

    // Dim unrelated edges
    setEdges(
      edges.map((edge) => ({
        ...edge,
        style: {
          ...edge.style,
          opacity:
            relatedIds.has(edge.source) || relatedIds.has(edge.target)
              ? 1
              : edgeDimOpacity,
        },
      }))
    );
  }, [selectedNodeId, dimOpacity, edgeDimOpacity, setNodes, setEdges, getNodes, getEdges]);
}
