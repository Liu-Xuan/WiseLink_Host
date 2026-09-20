// Cluster Node - Cluster grouping node for React Flow
import React from 'react';
import type { NodeProps } from 'reactflow';
import type { ClusterData } from '../types';

export function ClusterNode({ data, selected }: NodeProps<ClusterData>) {
  const toneColor = {
    blue: 'rgba(56, 189, 248, 0.15)',
    green: 'rgba(74, 222, 128, 0.15)',
    amber: 'rgba(251, 191, 36, 0.15)',
    red: 'rgba(248, 113, 113, 0.15)'
  }[data.tone || 'blue'];

  const toneBorder = {
    blue: 'rgba(56, 189, 248, 0.4)',
    green: 'rgba(74, 222, 128, 0.4)',
    amber: 'rgba(251, 191, 36, 0.4)',
    red: 'rgba(248, 113, 113, 0.4)'
  }[data.tone || 'blue'];

  return (
    <div
      className={`cluster-halo ${selected ? 'selected' : ''}`}
      style={{
        background: `radial-gradient(circle, ${toneColor} 0%, transparent 70%)`,
        borderColor: toneBorder
      }}
    >
      <div className="cluster-label">
        <span className="cluster-heading">{data.heading}</span>
        <span className="cluster-count">{data.count}</span>
      </div>
    </div>
  );
}
