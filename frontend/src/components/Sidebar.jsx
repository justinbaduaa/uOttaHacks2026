import React from 'react';
import { getRootNodes, getAllNodes } from '../data';

const Sidebar = ({ onNodeSelect, selectedNodeId }) => {
  const rootNodes = getRootNodes();
  const allNodes = getAllNodes();

  return (
    <aside className="sidebar">
      {/* Logo Section */}
      <div className="sidebar-header">
        <div className="window-controls">
          <span className="control control-close"></span>
          <span className="control control-minimize"></span>
          <span className="control control-maximize"></span>
        </div>
        <div className="logo">
          <img src="/glassbox logo.png" alt="glassbox" className="logo-icon" />
          <span className="logo-text">glassbox</span>
        </div>
      </div>

      {/* Project Selector */}
      <div className="project-selector">
        <div className="project-avatar">sb</div>
        <span className="project-name">secondbrain V1</span>
        <svg className="dropdown-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>

      {/* Separator */}
      <div className="sidebar-separator"></div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <a href="#" className="nav-item active">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>Explorer</span>
        </a>
        <a href="#" className="nav-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <span>My Boxes</span>
        </a>
      </nav>

      {/* Separator */}
      <div className="sidebar-separator"></div>

      {/* Glass Boxes Section */}
      <div className="sidebar-section">
        <div className="section-header">
          <span>GLASS BOXES</span>
          <button className="add-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </button>
        </div>
        <div className="glass-boxes-list">
          {rootNodes.map((node) => (
            <button
              key={node.id}
              className={`box-item ${selectedNodeId === node.id ? 'selected' : ''}`}
              onClick={() => onNodeSelect(node.id)}
            >
              <span className="box-name">{node.name}</span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
