/**
 * Glass Box - Canvas with Draggable Nodes
 * Pure vanilla JavaScript - no build step required
 */

const Canvas = {
  container: null,
  canvas: null,
  nodes: [],
  selectedNode: null,
  isDragging: false,
  isPanning: false,
  dragOffset: { x: 0, y: 0 },
  panStart: { x: 0, y: 0 },
  canvasOffset: { x: 0, y: 0 },
  scale: 1,
  currentPath: [],

  init() {
    this.container = document.getElementById('canvasContainer');
    this.canvas = document.getElementById('canvas');
    this.sidebarList = document.getElementById('sidebarBoxesList');
    this.breadcrumb = document.getElementById('breadcrumb');

    this.setupEventListeners();
    this.renderSidebar();
    this.renderNodes(GlassBoxData.getRootNodes());
    this.updateBreadcrumb();
  },

  setupEventListeners() {
    // Canvas panning
    this.container.addEventListener('mousedown', (e) => {
      if (e.target === this.container || e.target === this.canvas) {
        this.startPan(e);
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.pan(e);
      } else if (this.isDragging && this.selectedNode) {
        this.dragNode(e);
      }
    });

    document.addEventListener('mouseup', () => {
      this.stopPan();
      this.stopDrag();
    });

    // Zoom with scroll
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e);
    }, { passive: false });

    // Breadcrumb clicks
    this.breadcrumb.addEventListener('click', (e) => {
      const item = e.target.closest('.breadcrumb-item');
      if (item) {
        const id = item.dataset.id;
        if (id === 'root') {
          this.navigateToRoot();
        } else {
          // Navigate to specific node in path
          const index = this.currentPath.findIndex(n => n.id === id);
          if (index !== -1) {
            this.currentPath = this.currentPath.slice(0, index + 1);
            const node = this.currentPath[index];
            const children = GlassBoxData.getChildNodes(node.id);
            if (children.length > 0) {
              this.renderNodes(children);
            } else {
              this.renderNodes([node]);
            }
            this.updateBreadcrumb();
          }
        }
      }
    });
  },

  renderSidebar() {
    const rootNodes = GlassBoxData.getRootNodes();
    this.sidebarList.innerHTML = rootNodes.map(node => `
      <button class="box-item" data-id="${node.id}">
        ${this.escapeHtml(node.name)}
      </button>
    `).join('');

    this.sidebarList.querySelectorAll('.box-item').forEach(btn => {
      btn.addEventListener('click', () => {
        // Remove selected from all
        this.sidebarList.querySelectorAll('.box-item').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        
        const nodeId = btn.dataset.id;
        this.focusOnNode(nodeId);
      });
    });
  },

  renderNodes(nodeDataArray) {
    this.nodes = [];
    this.canvas.innerHTML = '';

    nodeDataArray.forEach((nodeData, index) => {
      const node = this.createNodeElement(nodeData, index);
      this.nodes.push(node);
      this.canvas.appendChild(node.element);
    });
  },

  createNodeElement(nodeData, index) {
    const element = document.createElement('div');
    element.className = 'glass-node';
    element.dataset.id = nodeData.id;

    // Calculate initial position in a grid layout
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 80 + col * 360;
    const y = 80 + row * 260;

    element.style.transform = `translate(${x}px, ${y}px)`;

    const evidenceCount = nodeData.evidence?.length || 0;
    const statusLabel = this.getStatusLabel(nodeData.status);
    const statusClass = this.getStatusClass(nodeData.status);

    element.innerHTML = `
      <div class="node-content">
        <h3 class="node-title">${this.escapeHtml(nodeData.name)}</h3>
        <p class="node-description">${this.escapeHtml(nodeData.goal)}</p>
        
        <div class="node-footer">
          <span class="status-badge ${statusClass}">${statusLabel}</span>
          <div class="node-avatar" title="${this.escapeHtml(nodeData.author.name)}">
            ${nodeData.author.initials}
          </div>
        </div>
        
        <div class="node-meta">
          <div class="meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span>${evidenceCount}</span>
          </div>
          ${nodeData.status === 'complete' ? `
            <div class="done-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <span>Done</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;

    // Drag listeners
    element.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.startDrag(e, element, x, y);
    });

    // Double-click to navigate into node
    element.addEventListener('dblclick', () => {
      this.navigateIntoNode(nodeData);
    });

    return { element, data: nodeData, x, y };
  },

  startDrag(e, element, currentX, currentY) {
    this.isDragging = true;
    this.selectedNode = this.nodes.find(n => n.element === element);
    
    const rect = element.getBoundingClientRect();
    this.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    element.classList.add('dragging');
  },

  dragNode(e) {
    if (!this.selectedNode) return;

    const containerRect = this.container.getBoundingClientRect();
    const newX = (e.clientX - containerRect.left - this.dragOffset.x - this.canvasOffset.x) / this.scale;
    const newY = (e.clientY - containerRect.top - this.dragOffset.y - this.canvasOffset.y) / this.scale;

    this.selectedNode.x = newX;
    this.selectedNode.y = newY;
    this.selectedNode.element.style.transform = `translate(${newX}px, ${newY}px)`;
  },

  stopDrag() {
    if (this.selectedNode) {
      this.selectedNode.element.classList.remove('dragging');
    }
    this.isDragging = false;
    this.selectedNode = null;
  },

  startPan(e) {
    this.isPanning = true;
    this.panStart = {
      x: e.clientX - this.canvasOffset.x,
      y: e.clientY - this.canvasOffset.y
    };
    this.container.style.cursor = 'grabbing';
  },

  pan(e) {
    this.canvasOffset = {
      x: e.clientX - this.panStart.x,
      y: e.clientY - this.panStart.y
    };
    this.updateCanvasTransform();
  },

  stopPan() {
    this.isPanning = false;
    this.container.style.cursor = '';
  },

  zoom(e) {
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(this.scale * delta, 0.3), 2);
    
    const rect = this.container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    this.canvasOffset.x = mouseX - (mouseX - this.canvasOffset.x) * (newScale / this.scale);
    this.canvasOffset.y = mouseY - (mouseY - this.canvasOffset.y) * (newScale / this.scale);
    
    this.scale = newScale;
    this.updateCanvasTransform();
  },

  updateCanvasTransform() {
    this.canvas.style.transform = `translate(${this.canvasOffset.x}px, ${this.canvasOffset.y}px) scale(${this.scale})`;
  },

  focusOnNode(nodeId) {
    const node = this.nodes.find(n => n.data.id === nodeId);
    if (!node) return;

    const containerRect = this.container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;

    this.canvasOffset = {
      x: centerX - (node.x + 160) * this.scale,
      y: centerY - (node.y + 100) * this.scale
    };
    this.updateCanvasTransform();

    // Highlight briefly
    node.element.classList.add('focused');
    setTimeout(() => node.element.classList.remove('focused'), 1000);
  },

  navigateIntoNode(nodeData) {
    const children = GlassBoxData.getChildNodes(nodeData.id);
    
    this.currentPath.push(nodeData);
    
    if (children.length > 0) {
      this.renderNodes(children);
    } else {
      this.renderNodes([nodeData]);
    }

    // Reset view
    this.canvasOffset = { x: 0, y: 0 };
    this.scale = 1;
    this.updateCanvasTransform();
    this.updateBreadcrumb();
  },

  navigateToRoot() {
    this.currentPath = [];
    this.renderNodes(GlassBoxData.getRootNodes());
    this.canvasOffset = { x: 0, y: 0 };
    this.scale = 1;
    this.updateCanvasTransform();
    this.updateBreadcrumb();
  },

  updateBreadcrumb() {
    let html = `
      <button class="breadcrumb-item ${this.currentPath.length === 0 ? 'active' : ''}" data-id="root">
        Workspace
      </button>
    `;

    this.currentPath.forEach((node, i) => {
      const isLast = i === this.currentPath.length - 1;
      html += `
        <span class="breadcrumb-separator">/</span>
        <button class="breadcrumb-item ${isLast ? 'active' : ''}" data-id="${node.id}">
          ${this.escapeHtml(node.name)}
        </button>
      `;
    });

    this.breadcrumb.innerHTML = html;
  },

  getStatusLabel(status) {
    switch (status) {
      case 'complete': return 'Done';
      case 'in-progress': return 'In Progress';
      default: return 'Planning';
    }
  },

  getStatusClass(status) {
    switch (status) {
      case 'complete': return 'status-done';
      case 'in-progress': return 'status-progress';
      default: return 'status-planning';
    }
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => Canvas.init());
