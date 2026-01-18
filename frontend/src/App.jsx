import React, { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import { getNode, getParentChain, getChildNodes } from './data';

function App() {
  const [currentPath, setCurrentPath] = useState([]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  const handleNodeSelect = useCallback((nodeId) => {
    setSelectedNodeId(nodeId);
    const node = getNode(nodeId);
    if (node) {
      const parentChain = getParentChain(nodeId);
      setCurrentPath([...parentChain.map(n => n.id), nodeId]);
    }
  }, []);

  const handleNodeClick = useCallback((nodeId) => {
    const node = getNode(nodeId);
    if (node && node.children && node.children.length > 0) {
      handleNodeSelect(nodeId);
    }
  }, [handleNodeSelect]);

  const handleBreadcrumbClick = useCallback((nodeId) => {
    if (nodeId === 'root') {
      setCurrentPath([]);
      setSelectedNodeId(null);
    } else {
      handleNodeSelect(nodeId);
    }
  }, [handleNodeSelect]);

  // Get current node for header
  const currentNode = currentPath.length > 0 
    ? getNode(currentPath[currentPath.length - 1]) 
    : null;

  return (
    <div className="app">
      <Sidebar 
        onNodeSelect={handleNodeSelect} 
        selectedNodeId={selectedNodeId}
      />
      
      <main className="main-content">
        {/* Header with breadcrumb */}
        <header className="main-header">
          <nav className="breadcrumb">
            <button 
              className={`breadcrumb-item ${currentPath.length === 0 ? 'active' : ''}`}
              onClick={() => handleBreadcrumbClick('root')}
            >
              Workspace
            </button>
            {currentPath.map((nodeId, index) => {
              const node = getNode(nodeId);
              const isLast = index === currentPath.length - 1;
              return (
                <React.Fragment key={nodeId}>
                  <span className="breadcrumb-separator">/</span>
                  <button 
                    className={`breadcrumb-item ${isLast ? 'active' : ''}`}
                    onClick={() => handleBreadcrumbClick(nodeId)}
                  >
                    {node?.name}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        </header>

        {/* Canvas */}
        <Canvas 
          currentPath={currentPath} 
          onNodeClick={handleNodeClick}
        />
      </main>
    </div>
  );
}

export default App;
