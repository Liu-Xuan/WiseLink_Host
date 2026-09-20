// Force-directed layout hook for React Flow
import { useEffect, useCallback } from 'react';
import { useReactFlow, type Node, type Edge } from 'reactflow';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum
} from 'd3-force';
import type { PerspectiveType, NodeData } from '../types';

interface ForceNode extends SimulationNodeDatum {
  id: string;
  type: string;
  data: any;
}

interface ForceLink extends SimulationLinkDatum<ForceNode> {
  id: string;
  type?: string;
}

interface UseForceLayoutOptions {
  enabled?: boolean;
  centerStrength?: number;
  chargeStrength?: number;
  linkDistance?: number;
  collisionRadius?: number;
}

export function useForceLayout(
  nodes: Node<NodeData>[],
  edges: Edge[],
  perspective: PerspectiveType,
  options: UseForceLayoutOptions = {}
) {
  const { setNodes, fitView } = useReactFlow();

  const {
    enabled = true,
    centerStrength = 0.05,
    chargeStrength = -300,
    linkDistance = 150,
    collisionRadius = 80
  } = options;

  const updateNodePositions = useCallback((simulation: Simulation<ForceNode, ForceLink>) => {
    simulation.on('tick', () => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const simNode = simulation.nodes().find((n) => n.id === node.id);
          if (simNode && simNode.x !== undefined && simNode.y !== undefined) {
            return {
              ...node,
              position: { x: simNode.x, y: simNode.y }
            };
          }
          return node;
        })
      );
    });
  }, [setNodes]);

  useEffect(() => {
    if (!enabled || nodes.length === 0) {
      return;
    }

    // Convert React Flow nodes to d3-force nodes
    const forceNodes: ForceNode[] = nodes.map((node) => ({
      id: node.id,
      type: node.type,
      data: node.data,
      x: node.position.x,
      y: node.position.y
    }));

    // Convert React Flow edges to d3-force links
    const forceLinks: ForceLink[] = edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type
    }));

    // Create force simulation
    const simulation = forceSimulation<ForceNode>(forceNodes)
      .force(
        'link',
        forceLink<ForceNode, ForceLink>(forceLinks)
          .id((d) => d.id)
          .distance(linkDistance)
          .strength(0.5)
      )
      .force('charge', forceManyBody().strength(chargeStrength))
      .force(
        'center',
        forceCenter(window.innerWidth / 2, window.innerHeight / 2).strength(centerStrength)
      )
      .force('collide', forceCollide(collisionRadius).strength(0.7))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    // Apply special positioning for different node types
    simulation.force('position', (alpha) => {
      forceNodes.forEach((node) => {
        // MatterHub nodes: stronger pull to center
        if (node.type === 'matterHub') {
          const dx = window.innerWidth / 2 - (node.x || 0);
          const dy = window.innerHeight / 2 - (node.y || 0);
          node.vx = (node.vx || 0) + dx * alpha * 0.1;
          node.vy = (node.vy || 0) + dy * alpha * 0.1;
        }

        // Cluster nodes: slightly repel from center for better distribution
        if (node.type === 'cluster') {
          const dx = (node.x || 0) - window.innerWidth / 2;
          const dy = (node.y || 0) - window.innerHeight / 2;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 200) {
            node.vx = (node.vx || 0) + (dx / distance) * alpha * 50;
            node.vy = (node.vy || 0) + (dy / distance) * alpha * 50;
          }
        }
      });
    });

    // Update node positions on each tick
    updateNodePositions(simulation);

    // Fit view after simulation stabilizes
    simulation.on('end', () => {
      setTimeout(() => {
        fitView({ padding: 0.2, duration: 800 });
      }, 100);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [
    nodes,
    edges,
    perspective,
    enabled,
    centerStrength,
    chargeStrength,
    linkDistance,
    collisionRadius,
    updateNodePositions,
    fitView
  ]);

  return null;
}
