// Graph View component - React Flow wrapper
import React from 'react';
import ReactFlow, {
  Background,
  Controls,
  Panel,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  ReactFlowProvider
} from 'reactflow';
import 'reactflow/dist/style.css';
import { DocumentGroupNode } from './DocumentGroupNode';
import { CompactDocumentNode } from './CompactDocumentNode';
import { ClusterNode } from './ClusterNode';
import { MatterHubNode } from './MatterHubNode';
import { MoreNode } from './MoreNode';
import { useForceLayout } from '../hooks/useForceLayout';
import { useNodeHighlight } from '../hooks/useNodeHighlight';
import type { GraphData, PerspectiveType } from '../types';

const nodeTypes: NodeTypes = {
  documentGroup: DocumentGroupNode,
  compact: CompactDocumentNode,
  cluster: ClusterNode,
  matterHub: MatterHubNode,
  more: MoreNode
};

interface GraphViewProps {
  graphData: GraphData;
  onNodeClick?: (nodeId: string) => void;
  selectedNodeId?: string | null;
  perspective: PerspectiveType;
  forceLayoutEnabled?: boolean;
}

function GraphViewInner({ graphData, onNodeClick, selectedNodeId, perspective, forceLayoutEnabled = true }: GraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graphData.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graphData.edges);

  // Apply force-directed layout
  useForceLayout(nodes, edges, perspective, {
    enabled: forceLayoutEnabled,
    centerStrength: 0.05,
    chargeStrength: -300,
    linkDistance: 150,
    collisionRadius: 80
  });

  // Apply Focus Mode: highlight selected node and neighbors, dim others
  useNodeHighlight({
    selectedNodeId,
    dimOpacity: 0.27,
    edgeDimOpacity: 0.15
  });

  // Update nodes and edges when graphData changes
  React.useEffect(() => {
    setNodes(graphData.nodes);
    setEdges(graphData.edges);
  }, [graphData, setNodes, setEdges]);

  // Apply selected class to nodes based on selectedNodeId
  React.useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => ({
        ...node,
        className: node.id === selectedNodeId ? 'selected' : ''
      }))
    );
  }, [selectedNodeId, setNodes]);

  const handleNodeClick = React.useCallback(
    (_event: React.MouseEvent, node: any) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick]
  );

  return (
    <div className="graph-view">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={3}
        defaultEdgeOptions={{
          style: { stroke: '#cbd5e1', strokeWidth: 2 }
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#334155"
        />
        <Controls />
        <Panel position="top-right" className="graph-info-panel">
          <div className="graph-stats">
            Nodes: {nodes.length} | Edges: {edges.length}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function GraphView(props: GraphViewProps) {
  return (
    <ReactFlowProvider>
      <GraphViewInner {...props} />
    </ReactFlowProvider>
  );
}
