// useEdgeStyles Hook - Phase 3.5: Edge styling based on relationship strength
import { useMemo } from 'react';
import type { GraphEdge } from '../types';
import type { Edge } from 'reactflow';

/**
 * Relationship type configuration
 */
interface RelationshipTypeConfig {
  type: string;
  color: string;
  label: string;
}

/**
 * Edge strength levels
 */
export type EdgeStrength = 'weak' | 'medium' | 'strong';

/**
 * Styled edge with visual properties
 */
export interface StyledEdge extends GraphEdge {
  style?: React.CSSProperties;
  animated?: boolean;
  label?: string;
  labelStyle?: React.CSSProperties;
  labelBgStyle?: React.CSSProperties;
}

/**
 * Relationship type stats for legend
 */
export interface RelationshipTypeStats {
  type: string;
  count: number;
  color: string;
  label: string;
}

/**
 * Strength distribution stats for legend
 */
export interface StrengthDistributionStats {
  weak: number;
  medium: number;
  strong: number;
}

/**
 * Predefined relationship types with colors
 */
const RELATIONSHIP_TYPES: RelationshipTypeConfig[] = [
  { type: 'contains', color: '#38BDF8', label: '包含' },
  { type: 'references', color: '#22D3EE', label: '引用' },
  { type: 'derives', color: '#818CF8', label: '派生' },
  { type: 'clusters', color: '#A78BFA', label: '聚类' },
  { type: 'links', color: '#4FD1C5', label: '关联' },
];

/**
 * Calculate edge strength from metadata
 *
 * Strength is determined by:
 * - Connection weight (if available)
 * - Number of shared references
 * - Temporal proximity
 * - Node importance
 */
function calculateEdgeStrength(edge: GraphEdge): EdgeStrength {
  // Check for explicit weight in metadata
  const metadata = edge.data?.metadata as { weight?: number } | undefined;
  if (metadata?.weight !== undefined) {
    if (metadata.weight >= 0.7) return 'strong';
    if (metadata.weight >= 0.4) return 'medium';
    return 'weak';
  }

  // Default: medium strength for edges without metadata
  return 'medium';
}

/**
 * Get color for relationship type
 */
function getRelationshipColor(edge: GraphEdge): string {
  const edgeType = edge.data?.type || edge.type || 'links';
  const config = RELATIONSHIP_TYPES.find(r => r.type === edgeType);
  return config?.color || '#4FD1C5';
}

/**
 * Get stroke width based on strength
 */
function getStrokeWidth(strength: EdgeStrength): number {
  switch (strength) {
    case 'weak': return 1;
    case 'medium': return 2;
    case 'strong': return 3;
  }
}

/**
 * Get opacity based on strength
 */
function getOpacity(strength: EdgeStrength): number {
  switch (strength) {
    case 'weak': return 0.3;
    case 'medium': return 0.6;
    case 'strong': return 0.9;
  }
}

/**
 * Apply visual styles to edges based on relationship strength and type
 *
 * Features:
 * - Color coding by relationship type
 * - Stroke width based on strength (1-3px)
 * - Opacity based on strength (0.3-0.9)
 * - Animation for strong relationships
 * - Optional edge labels
 *
 * @example
 * ```tsx
 * function GraphView() {
 *   const [edges] = useEdgesState(rawEdges);
 *   const styledEdges = useEdgeStyles(edges);
 *
 *   return <ReactFlow edges={styledEdges} />;
 * }
 * ```
 */
export function useEdgeStyles(edges: GraphEdge[]): StyledEdge[] {
  return useMemo(() => {
    return edges.map(edge => {
      const strength = calculateEdgeStrength(edge);
      const color = getRelationshipColor(edge);
      const strokeWidth = getStrokeWidth(strength);
      const opacity = getOpacity(strength);

      const styledEdge: StyledEdge = {
        ...edge,
        style: {
          stroke: color,
          strokeWidth,
          opacity,
        },
        animated: strength === 'strong',
      };

      // Add label for strong edges if type is available
      if (strength === 'strong' && edge.data?.type) {
        const config = RELATIONSHIP_TYPES.find(r => r.type === edge.data?.type);
        if (config) {
          styledEdge.label = config.label;
          styledEdge.labelStyle = {
            fill: color,
            fontSize: 10,
            fontWeight: 600,
          };
          styledEdge.labelBgStyle = {
            fill: '#0F172A',
            fillOpacity: 0.8,
          };
        }
      }

      return styledEdge;
    });
  }, [edges]);
}

/**
 * Get relationship type statistics for legend
 */
export function getRelationshipTypes(edges: GraphEdge[]): RelationshipTypeStats[] {
  const typeCounts = new Map<string, number>();

  edges.forEach(edge => {
    const edgeType = edge.data?.type || edge.type || 'links';
    typeCounts.set(edgeType, (typeCounts.get(edgeType) || 0) + 1);
  });

  return Array.from(typeCounts.entries()).map(([type, count]) => {
    const config = RELATIONSHIP_TYPES.find(r => r.type === type);
    return {
      type,
      count,
      color: config?.color || '#4FD1C5',
      label: config?.label || type,
    };
  });
}

/**
 * Get strength distribution statistics for legend
 */
export function getStrengthDistribution(edges: GraphEdge[]): StrengthDistributionStats {
  const distribution = { weak: 0, medium: 0, strong: 0 };

  edges.forEach(edge => {
    const strength = calculateEdgeStrength(edge);
    distribution[strength]++;
  });

  return distribution;
}
