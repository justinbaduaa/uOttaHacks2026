import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import GlassBoxNode from './GlassBoxNode';
import { getRootNodes, getNode, getChildNodes } from '../data';

const nodeTypes = {
  glassBox: GlassBoxNode,
};

const Canvas = ({ currentPath, onNodeClick }) => {
  // Determine which nodes to show based on current path
  const displayNodes = useMemo(() => {
    if (currentPath.length === 0) {
      return getRootNodes();
    }
    const currentNodeId = currentPath[currentPath.length - 1];
    const children = getChildNodes(currentNodeId);
    if (children.length > 0) {
      return children;
    }
    // If no children, show the current node
    const currentNode = getNode(currentNodeId);
    return currentNode ? [currentNode] : [];
  }, [currentPath]);

  // Convert data nodes to React Flow nodes
  const initialNodes = useMemo(() => {
    return displayNodes.map((node, index) => ({
      id: node.id,
      type: 'glassBox',
      position: { 
        x: 400 + (index % 3) * 350, 
        y: 150 + Math.floor(index / 3) * 300 
      },
      data: node,
    }));
  }, [displayNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Update nodes when displayNodes changes
  React.useEffect(() => {
    const newNodes = displayNodes.map((node, index) => ({
      id: node.id,
      type: 'glassBox',
      position: { 
        x: 400 + (index % 3) * 350, 
        y: 150 + Math.floor(index / 3) * 300 
      },
      data: node,
    }));
    setNodes(newNodes);
  }, [displayNodes, setNodes]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onNodeDoubleClick = useCallback(
    (event, node) => {
      if (onNodeClick) {
        onNodeClick(node.id);
      }
    },
    [onNodeClick]
  );

  return (
    <div className="canvas-wrapper">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDoubleClick={onNodeDoubleClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background 
          color="#e2e8f0" 
          gap={24} 
          size={1}
          variant="dots"
        />
      </ReactFlow>
    </div>
  );
};

export default Canvas;
