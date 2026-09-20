// Compact Document Node - Single document card for React Flow
import React from 'react';
import type { NodeProps } from 'reactflow';
import type { CompactDocumentData } from '../types';

export function CompactDocumentNode({ data }: NodeProps<CompactDocumentData>) {
  const toneColor = {
    blue: '#38BDF8',
    green: '#4ADE80',
    amber: '#FBBF24',
    red: '#F87171'
  }[data.tone || 'blue'];

  return (
    <div className="compact-node" style={{ borderLeftColor: toneColor }}>
      <div className="compact-title">{data.title}</div>
      <div className="compact-brief">{data.brief}</div>
    </div>
  );
}
