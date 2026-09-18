// More Node - Expansion node for React Flow
import React from 'react';
import type { NodeProps } from 'reactflow';
import type { MoreNodeData } from '../types';

export function MoreNode({ data }: NodeProps<MoreNodeData>) {
  return (
    <div className="node-more">
      <div className="more-icon">⋯</div>
      <div className="more-text">+{data.count} more</div>
    </div>
  );
}
