// Graph Node Tooltip - Phase 3.4: Hover card with node details
import React, { useState, useEffect, useRef } from 'react';
import type { GraphNode } from '../types';

interface TooltipPosition {
  x: number;
  y: number;
}

interface GraphNodeTooltipProps {
  node: GraphNode | null;
  position: TooltipPosition | null;
  connectionCount: number;
}

/**
 * Tooltip component that displays node details on hover
 *
 * Features:
 * - Shows node title, type, and connection count
 * - Mouse-following positioning with smart boundary detection
 * - Delayed appearance (300ms) to avoid flicker
 * - Rich metadata display when available
 * - Type-specific icon and color
 */
export function GraphNodeTooltip({
  node,
  position,
  connectionCount
}: GraphNodeTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [adjustedPosition, setAdjustedPosition] = useState<TooltipPosition | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Show tooltip after delay
  useEffect(() => {
    if (node && position) {
      timeoutRef.current = setTimeout(() => {
        setIsVisible(true);
      }, 300); // 300ms delay to avoid flicker on quick hovers
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setIsVisible(false);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [node, position]);

  // Adjust position to stay within viewport
  useEffect(() => {
    if (!position || !tooltipRef.current || !isVisible) {
      setAdjustedPosition(null);
      return;
    }

    const tooltip = tooltipRef.current;
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = position.x + 12; // Offset from cursor
    let y = position.y + 12;

    // Adjust horizontal position
    if (x + tooltipRect.width > viewportWidth - 20) {
      x = position.x - tooltipRect.width - 12; // Show on left side
    }

    // Adjust vertical position
    if (y + tooltipRect.height > viewportHeight - 20) {
      y = position.y - tooltipRect.height - 12; // Show above cursor
    }

    setAdjustedPosition({ x, y });
  }, [position, isVisible]);

  if (!node || !isVisible || !adjustedPosition) {
    return null;
  }

  // Extract display information from node
  const getNodeTitle = (): string => {
    const { data } = node;
    if ('title' in data) return data.title;
    if ('heading' in data) return data.heading;
    if ('count' in data && data.type === 'more') return `+${data.count} more`;
    return node.id;
  };

  const getNodeSubtitle = (): string | null => {
    const { data } = node;
    if ('subtitle' in data && data.subtitle) return data.subtitle;
    if ('brief' in data) return data.brief;
    if ('count' in data && 'docs' in data) return `${data.count} documents`;
    if ('count' in data && data.type === 'cluster') return `${data.count} items`;
    return null;
  };

  const getNodeIcon = (): string => {
    switch (node.type) {
      case 'matterHub': return '📋';
      case 'cluster': return '🔵';
      case 'documentGroup': return '📁';
      case 'compact': return '📄';
      case 'more': return '⋯';
      default: return '•';
    }
  };

  const getNodeTypeLabel = (): string => {
    switch (node.type) {
      case 'matterHub': return 'Matter Hub';
      case 'cluster': return 'Cluster';
      case 'documentGroup': return 'Document Group';
      case 'compact': return 'Document';
      case 'more': return 'More Items';
      default: return node.type;
    }
  };

  const getMetadataEntries = (): Array<[string, string]> => {
    const { data } = node;
    const entries: Array<[string, string]> = [];

    const nodeData = data as { metadata?: Record<string, unknown> };
    if (nodeData.metadata) {
      Object.entries(nodeData.metadata).forEach(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'number') {
          entries.push([key, String(value)]);
        }
      });
    }

    return entries.slice(0, 5); // Limit to 5 metadata entries
  };

  const title = getNodeTitle();
  const subtitle = getNodeSubtitle();
  const icon = getNodeIcon();
  const typeLabel = getNodeTypeLabel();
  const metadataEntries = getMetadataEntries();

  return (
    <div
      ref={tooltipRef}
      className="graph-node-tooltip"
      style={{
        position: 'fixed',
        left: `${adjustedPosition.x}px`,
        top: `${adjustedPosition.y}px`,
        pointerEvents: 'none',
        zIndex: 10000
      }}
    >
      <div className="tooltip-header">
        <span className="tooltip-icon">{icon}</span>
        <div className="tooltip-title-block">
          <div className="tooltip-title">{title}</div>
          {subtitle && <div className="tooltip-subtitle">{subtitle}</div>}
        </div>
      </div>

      <div className="tooltip-meta">
        <div className="tooltip-meta-row">
          <span className="tooltip-meta-label">Type:</span>
          <span className="tooltip-meta-value">{typeLabel}</span>
        </div>
        <div className="tooltip-meta-row">
          <span className="tooltip-meta-label">ID:</span>
          <span className="tooltip-meta-value tooltip-id">{node.id}</span>
        </div>
        <div className="tooltip-meta-row">
          <span className="tooltip-meta-label">Connections:</span>
          <span className="tooltip-meta-value">{connectionCount}</span>
        </div>
      </div>

      {metadataEntries.length > 0 && (
        <div className="tooltip-metadata">
          <div className="tooltip-metadata-title">Metadata</div>
          {metadataEntries.map(([key, value]) => (
            <div key={key} className="tooltip-metadata-row">
              <span className="tooltip-metadata-key">{key}:</span>
              <span className="tooltip-metadata-value">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
