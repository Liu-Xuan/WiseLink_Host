import React from 'react';

/**
 * GraphLoadingSkeleton - Loading placeholder for graph view
 * Shows animated skeleton nodes while graph data is loading
 */
export function GraphLoadingSkeleton() {
  return (
    <div className="graph-skeleton">
      <div className="skeleton-node" />
      <div className="skeleton-edge" />
      <div className="skeleton-node" />
      <div className="skeleton-edge" />
      <div className="skeleton-node" />
    </div>
  );
}
