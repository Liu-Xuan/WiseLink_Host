// GraphPathTrail - Phase 3.2: Display path from MatterHub to selected node
import React from 'react';
import type { PathNode } from '../hooks/useGraphPath';

interface GraphPathTrailProps {
  /** Array of nodes forming the path from hub to selected node */
  path: PathNode[] | null;
  /** Callback when a path node is clicked */
  onNodeClick?: (nodeId: string) => void;
}

/**
 * Bottom-fixed trail component showing the path from MatterHub to selected node
 *
 * Displays a breadcrumb-style path with arrows between nodes. Clicking a node
 * in the path allows jumping directly to that node.
 *
 * @example
 * ```tsx
 * <GraphPathTrail
 *   path={[
 *     { id: 'hub', title: 'Matter Hub' },
 *     { id: 'node-3', title: 'Documents' },
 *     { id: 'node-5', title: 'Selected Document' }
 *   ]}
 *   onNodeClick={(nodeId) => setSelectedNodeId(nodeId)}
 * />
 * ```
 */
export function GraphPathTrail({ path, onNodeClick }: GraphPathTrailProps) {
  if (!path || path.length === 0) {
    return null;
  }

  return (
    <div className="graph-path-trail">
      <div className="path-label">Path:</div>
      <div className="path-nodes">
        {path.map((node, index) => (
          <React.Fragment key={node.id}>
            <button
              className="path-node"
              onClick={() => onNodeClick?.(node.id)}
              title={`Navigate to ${node.title}`}
            >
              {node.title}
            </button>
            {index < path.length - 1 && (
              <span className="path-arrow">→</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
