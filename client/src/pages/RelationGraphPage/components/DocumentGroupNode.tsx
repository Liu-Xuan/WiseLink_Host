// Custom Document Group Node component for React Flow
import React from 'react';
import type { NodeProps } from 'reactflow';
import type { DocumentGroupData } from '../types';

export function DocumentGroupNode({ data }: NodeProps<DocumentGroupData>) {
  const handleDocClick = (doc: string) => {
    // Dispatch custom event for timeline integration
    window.dispatchEvent(new CustomEvent('doc-click', { detail: doc }));
  };

  return (
    <div className="cytoscape-html-card">
      <div className="card-header">
        <h3>{data.title}</h3>
        <span className="badge">{data.count}篇</span>
      </div>
      <div className="card-body">
        {data.docs.map((doc, index) => (
          <div
            key={index}
            className="doc-item"
            onClick={() => handleDocClick(doc)}
          >
            {doc}
          </div>
        ))}
        {data.count > data.docs.length && (
          <div className="more">+ {data.count - data.docs.length} more</div>
        )}
      </div>
    </div>
  );
}
