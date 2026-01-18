import React, { memo, useState, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';

const GlassBoxNode = memo(({ id, data }) => {
  const { name, goal, status, author, evidence, children } = data;
  const evidenceCount = evidence?.length || 0;

  const { setNodes } = useReactFlow();
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(name);

  // Sync title state if prop changes from outside
  React.useEffect(() => {
    setTitle(name);
  }, [name]);

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    setIsEditing(true);
  };

  const handleChange = (e) => {
    setTitle(e.target.value);
  };

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    if (title !== name) {
      setNodes((nodes) =>
        nodes.map((node) => {
          if (node.id === id) {
            return {
              ...node,
              data: { ...node.data, name: title },
            };
          }
          return node;
        })
      );
    }
  }, [id, name, title, setNodes]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleBlur();
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case 'complete':
        return 'Done';
      case 'in-progress':
        return 'In Progress';
      default:
        return 'Planning';
    }
  };

  const getStatusClass = () => {
    switch (status) {
      case 'complete':
        return 'status-done';
      case 'in-progress':
        return 'status-progress';
      default:
        return 'status-planning';
    }
  };

  return (
    <div className="glass-box-node">
      <div className="node-content">
        {isEditing ? (
          <input
            type="text"
            className="node-title-input nodrag"
            value={title}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <h3
            className="node-title"
            onDoubleClick={handleDoubleClick}
            title="Double-click to edit"
          >
            {name}
          </h3>
        )}
        <p className="node-description">{goal}</p>

        <div className="node-footer">
          <span className={`status-badge ${getStatusClass()}`}>
            {getStatusLabel()}
          </span>

          <div className="node-avatar" title={author?.name}>
            {author?.initials}
          </div>
        </div>

        <div className="node-meta">
          <div className="meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{evidenceCount}</span>
          </div>

          {status === 'complete' && (
            <div className="done-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Done</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

GlassBoxNode.displayName = 'GlassBoxNode';

export default GlassBoxNode;
