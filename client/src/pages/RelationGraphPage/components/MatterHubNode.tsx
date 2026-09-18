// Matter Hub Node - Central hub node for React Flow
import React from 'react';
import type { NodeProps } from 'reactflow';
import type { MatterHubData } from '../types';

export function MatterHubNode({ data }: NodeProps<MatterHubData>) {
  const toneGradient = {
    blue: 'linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)',
    green: 'linear-gradient(135deg, #065F46 0%, #10B981 100%)',
    amber: 'linear-gradient(135deg, #92400E 0%, #F59E0B 100%)',
    red: 'linear-gradient(135deg, #991B1B 0%, #EF4444 100%)'
  }[data.tone || 'blue'];

  const toneGlow = {
    blue: 'rgba(56, 189, 248, 0.3)',
    green: 'rgba(74, 222, 128, 0.3)',
    amber: 'rgba(251, 191, 36, 0.3)',
    red: 'rgba(248, 113, 113, 0.3)'
  }[data.tone || 'blue'];

  return (
    <div
      className="matter-hub"
      style={{
        background: toneGradient,
        boxShadow: `0 0 0 11px ${toneGlow}, 0 12px 30px rgba(0, 0, 0, 0.4)`
      }}
    >
      {data.image ? (
        <div className="hub-portrait">
          <img src={data.image} alt={data.title} />
        </div>
      ) : (
        <div className="hub-icon">📋</div>
      )}
      <strong className="hub-title">{data.title}</strong>
      {data.subtitle && <small className="hub-subtitle">{data.subtitle}</small>}
    </div>
  );
}
