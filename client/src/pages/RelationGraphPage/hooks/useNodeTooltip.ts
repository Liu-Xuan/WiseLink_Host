// useNodeTooltip Hook - Phase 3.4: Manage tooltip state and mouse tracking
import { useState, useCallback, useEffect } from 'react';
import type { GraphNode, GraphEdge } from '../types';

interface TooltipState {
  node: GraphNode | null;
  position: { x: number; y: number } | null;
  connectionCount: number;
}

interface UseNodeTooltipOptions {
  enabled?: boolean;
  delay?: number;
}

/**
 * Hook to manage node tooltip state
 *
 * Features:
 * - Tracks mouse position for tooltip positioning
 * - Calculates connection count for hovered node
 * - Provides handlers for node mouse enter/leave
 * - Optional enable/disable control
 *
 * @example
 * ```tsx
 * function GraphView() {
 *   const { tooltipState, handleNodeMouseEnter, handleNodeMouseLeave } =
 *     useNodeTooltip(nodes, edges);
 *
 *   return (
 *     <>
 *       <Node onMouseEnter={handleNodeMouseEnter} onMouseLeave={handleNodeMouseLeave} />
 *       <GraphNodeTooltip {...tooltipState} />
 *     </>
 *   );
 * }
 * ```
 */
export function useNodeTooltip(
  nodes: GraphNode[],
  edges: GraphEdge[],
  options: UseNodeTooltipOptions = {}
): {
  tooltipState: TooltipState;
  handleNodeMouseEnter: (nodeId: string, event: React.MouseEvent) => void;
  handleNodeMouseLeave: () => void;
} {
  const { enabled = true } = options;
  const [tooltipState, setTooltipState] = useState<TooltipState>({
    node: null,
    position: null,
    connectionCount: 0
  });

  // Calculate connection count for a node
  const getConnectionCount = useCallback((nodeId: string): number => {
    return edges.filter(
      edge => edge.source === nodeId || edge.target === nodeId
    ).length;
  }, [edges]);

  // Handle node mouse enter
  const handleNodeMouseEnter = useCallback((nodeId: string, event: React.MouseEvent) => {
    if (!enabled) return;

    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const connectionCount = getConnectionCount(nodeId);

    setTooltipState({
      node,
      position: { x: event.clientX, y: event.clientY },
      connectionCount
    });
  }, [enabled, nodes, getConnectionCount]);

  // Handle node mouse leave
  const handleNodeMouseLeave = useCallback(() => {
    setTooltipState({
      node: null,
      position: null,
      connectionCount: 0
    });
  }, []);

  // Clear tooltip when nodes or edges change
  useEffect(() => {
    setTooltipState({
      node: null,
      position: null,
      connectionCount: 0
    });
  }, [nodes, edges]);

  return {
    tooltipState,
    handleNodeMouseEnter,
    handleNodeMouseLeave
  };
}

/**
 * Hook to track mouse position for tooltip following
 *
 * @example
 * ```tsx
 * function GraphView() {
 *   const mousePosition = useMousePosition();
 *
 *   return <Tooltip position={mousePosition} />;
 * }
 * ```
 */
export function useMousePosition(): { x: number; y: number } | null {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  return position;
}
