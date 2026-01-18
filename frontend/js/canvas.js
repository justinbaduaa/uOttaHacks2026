/**
 * Glass Box - Canvas with Draggable Nodes
 * Pure vanilla JavaScript - no build step required
 */

const Auth = {
  token: null,

  getStoredToken() {
    return localStorage.getItem('glassbox.authToken');
  },

  setStoredToken(token) {
    localStorage.setItem('glassbox.authToken', token);
  },

  async ensureAuth() {
    const existing = this.getStoredToken();
    if (existing) {
      this.token = existing;
      return;
    }

    if (!window.glassBox || !window.glassBox.startAuth) {
      console.warn('Auth bridge not available. Cannot start Hosted UI login.');
      return;
    }

    try {
      const token = await window.glassBox.startAuth();
      if (token) {
        this.setStoredToken(token);
        this.token = token;
      }
    } catch (error) {
      console.error('Authentication failed:', error);
    }
  },
};

function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(payload.length + (4 - (payload.length % 4)) % 4, '=');
    const json = atob(padded);
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
}

const Api = {
  getAuthToken() {
    return Auth.token || localStorage.getItem('glassbox.authToken');
  },

  listCanvases() {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.listCanvases) {
      return window.glassBox.api.listCanvases(token);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  createCanvas(name) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.createCanvas) {
      return window.glassBox.api.createCanvas(token, name);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  listNodes(canvasId) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.listNodes) {
      return window.glassBox.api.listNodes(token, canvasId);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },
};

const Canvas = {
  container: null,
  canvas: null,
  nodes: [],
  selectedNode: null,
  state: {
    canvases: [],
    selectedCanvasId: null,
    nodes: [],
    nodesById: {},
    childrenByParent: {},
    isLoadingCanvases: false,
    isLoadingNodes: false,
    isCreatingCanvas: false,
    createCanvasError: null,
    canvasesError: null,
  },
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
    this.profileButton = document.getElementById('userProfile');
    this.profileLetter = document.getElementById('userProfileLetter');
    this.canvasLoading = document.getElementById('canvasLoading');
    this.canvasCreate = document.getElementById('canvasCreate');
    this.canvasCreateToggle = document.getElementById('canvasCreateToggle');
    this.canvasCreateForm = document.getElementById('canvasCreateForm');
    this.canvasCreateInput = document.getElementById('canvasCreateInput');
    this.canvasCreateSubmit = document.getElementById('canvasCreateSubmit');
    this.canvasCreateCancel = document.getElementById('canvasCreateCancel');
    this.canvasCreateError = document.getElementById('canvasCreateError');

    this.setupEventListeners();
    this.updateProfile();
    this.renderSidebar();
    this.updateBreadcrumb();
    this.loadCanvases();
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
            const children = this.getChildNodes(node.id);
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

    this.sidebarList.addEventListener('click', (e) => {
      const item = e.target.closest('.box-item');
      if (!item || item.disabled) return;
      const canvasId = item.dataset.id;
      if (canvasId) {
        this.selectCanvas(canvasId);
      }
    });

    this.canvasCreateToggle.addEventListener('click', () => {
      this.openCreateCanvas();
    });

    this.canvasCreateSubmit.addEventListener('click', () => {
      this.submitCreateCanvas();
    });

    this.canvasCreateCancel.addEventListener('click', () => {
      this.closeCreateCanvas();
    });

    this.canvasCreateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submitCreateCanvas();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        this.closeCreateCanvas();
      }
    });

    document.addEventListener('click', (e) => {
      if (!this.state.isCreatingCanvas) return;
      if (this.canvasCreate && !this.canvasCreate.contains(e.target)) {
        this.closeCreateCanvas();
      }
    });
  },

  renderSidebar() {
    if (this.state.isLoadingCanvases) {
      this.sidebarList.innerHTML = `
        <div class="canvas-list-message">Loading canvases...</div>
      `;
      return;
    }

    if (this.state.canvasesError) {
      this.sidebarList.innerHTML = `
        <div class="canvas-list-message canvas-list-error">${this.escapeHtml(this.state.canvasesError)}</div>
      `;
      return;
    }

    if (this.state.canvases.length === 0) {
      this.sidebarList.innerHTML = `
        <div class="canvas-list-message">No canvases yet.</div>
      `;
      return;
    }

    this.sidebarList.innerHTML = this.state.canvases.map(canvas => {
      const selected = canvas.id === this.state.selectedCanvasId;
      return `
        <button class="box-item ${selected ? 'selected' : ''}" data-id="${canvas.id}">
          <span class="box-dot"></span>
          <span class="box-name">${this.escapeHtml(canvas.name)}</span>
          <span class="box-chevron">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 6 15 12 9 18"/>
            </svg>
          </span>
        </button>
      `;
    }).join('');
  },

  async loadCanvases() {
    this.state.isLoadingCanvases = true;
    this.state.canvasesError = null;
    this.renderSidebar();

    try {
      const canvases = await Api.listCanvases();
      const normalized = (canvases || []).map(canvas => ({
        id: canvas.canvasId,
        name: canvas.name || 'Untitled Canvas',
        joinedAt: canvas.joinedAt || canvas.createdAt || '',
      }));

      normalized.sort((a, b) => (b.joinedAt || '').localeCompare(a.joinedAt || ''));
      this.state.canvases = normalized;
      this.state.isLoadingCanvases = false;
      this.renderSidebar();

      if (normalized.length > 0) {
        await this.selectCanvas(normalized[0].id);
      } else {
        this.renderNodes([]);
      }
    } catch (error) {
      this.state.isLoadingCanvases = false;
      this.state.canvasesError = error.message || 'Failed to load canvases';
      this.renderSidebar();
    }
  },

  async selectCanvas(canvasId) {
    if (!canvasId || this.state.selectedCanvasId === canvasId) {
      return;
    }
    this.state.selectedCanvasId = canvasId;
    this.currentPath = [];
    this.renderSidebar();
    this.updateBreadcrumb();
    await this.loadNodesForCanvas(canvasId);
  },

  async loadNodesForCanvas(canvasId) {
    this.state.isLoadingNodes = true;
    this.setCanvasLoading(true);
    this.renderNodes([]);

    try {
      console.log('[Canvas] Loading nodes for canvas', canvasId);
      const nodes = await Api.listNodes(canvasId);
      console.log('[Canvas] Loaded nodes', Array.isArray(nodes) ? nodes.length : nodes);
      const normalized = (nodes || [])
        .filter(node => !node.deletedAt)
        .map(node => this.normalizeNodeFromApi(node));
      this.state.nodes = normalized;
      this.buildNodeIndex();
      this.renderNodes(this.getRootNodes());
    } catch (error) {
      console.error('[Canvas] Failed to load nodes', error);
      this.state.nodes = [];
      this.buildNodeIndex();
      this.renderNodes([]);
      this.canvas.innerHTML = `
        <div class="canvas-empty-state">Failed to load nodes.</div>
      `;
    } finally {
      this.state.isLoadingNodes = false;
      this.setCanvasLoading(false);
    }
  },

  openCreateCanvas() {
    if (this.state.isCreatingCanvas) {
      this.closeCreateCanvas();
      return;
    }
    this.state.isCreatingCanvas = true;
    this.canvasCreateForm.classList.add('is-open');
    this.canvasCreateError.textContent = '';
    this.canvasCreateInput.value = '';
    this.canvasCreateInput.focus();
  },

  closeCreateCanvas() {
    this.state.isCreatingCanvas = false;
    this.canvasCreateForm.classList.remove('is-open');
    this.canvasCreateError.textContent = '';
    this.canvasCreateInput.value = '';
  },

  async submitCreateCanvas() {
    if (!this.state.isCreatingCanvas) {
      this.openCreateCanvas();
      return;
    }

    const name = this.canvasCreateInput.value.trim();
    if (!name) {
      this.canvasCreateError.textContent = 'Canvas name cannot be empty.';
      return;
    }
    if (name.length > 40) {
      this.canvasCreateError.textContent = 'Canvas name must be 40 characters or less.';
      return;
    }

    this.canvasCreateError.textContent = '';
    this.canvasCreateSubmit.disabled = true;

    try {
      const created = await Api.createCanvas(name);
      const canvas = {
        id: created.canvasId,
        name: created.name || name,
        joinedAt: new Date().toISOString(),
      };
      this.state.canvases = [canvas, ...this.state.canvases];
      this.closeCreateCanvas();
      this.renderSidebar();
      this.selectCanvas(canvas.id);
    } catch (error) {
      this.canvasCreateError.textContent = error.message || 'Failed to create canvas.';
    } finally {
      this.canvasCreateSubmit.disabled = false;
    }
  },

  setCanvasLoading(isLoading) {
    if (this.canvasLoading) {
      this.canvasLoading.hidden = !isLoading;
      this.canvasLoading.style.display = isLoading ? 'flex' : 'none';
    }
  },

  renderNodes(nodeDataArray) {
    this.nodes = [];
    this.canvas.innerHTML = '';

    if (nodeDataArray.length === 0 && !this.state.isLoadingNodes) {
      this.canvas.innerHTML = `
        <div class="canvas-empty-state">No nodes yet. Create your first node.</div>
      `;
      return;
    }

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
    const createdLabel = nodeData.createdAt ? this.formatTimestamp(nodeData.createdAt) : '--';

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
          <div class="meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>${createdLabel}</span>
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
    const children = this.getChildNodes(nodeData.id);
    
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
    this.renderNodes(this.getRootNodes());
    this.canvasOffset = { x: 0, y: 0 };
    this.scale = 1;
    this.updateCanvasTransform();
    this.updateBreadcrumb();
  },

  updateBreadcrumb() {
    const selectedCanvas = this.state.canvases.find(
      (canvas) => canvas.id === this.state.selectedCanvasId
    );
    const rootLabel = selectedCanvas ? selectedCanvas.name : 'Workspace';
    let html = `
      <button class="breadcrumb-item ${this.currentPath.length === 0 ? 'active' : ''}" data-id="root">
        ${this.escapeHtml(rootLabel)}
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

  buildNodeIndex() {
    this.state.nodesById = {};
    this.state.childrenByParent = {};

    this.state.nodes.forEach((node) => {
      this.state.nodesById[node.id] = node;
      const parentId = node.parent || null;
      if (!this.state.childrenByParent[parentId]) {
        this.state.childrenByParent[parentId] = [];
      }
      this.state.childrenByParent[parentId].push(node);
    });
  },

  getNode(nodeId) {
    return this.state.nodesById[nodeId];
  },

  getRootNodes() {
    return this.state.childrenByParent[null] || [];
  },

  getChildNodes(parentId) {
    return this.state.childrenByParent[parentId] || [];
  },

  getAllNodes() {
    return Object.values(this.state.nodesById);
  },

  normalizeNodeFromApi(node) {
    const evidence = this.normalizeEvidence(node);
    const status = this.deriveStatus(node, evidence.length);
    const author = this.resolveAuthor(node.authorSub);

    return {
      id: node.nodeId,
      name: node.title || 'Untitled',
      goal: node.description || '',
      result: null,
      status,
      evidence,
      author,
      children: [],
      parent: node.parentNodeId === 'ROOT' ? null : node.parentNodeId,
      createdAt: node.createdAt || '',
      updatedAt: node.updatedAt || '',
    };
  },

  normalizeEvidence(node) {
    const items = [];
    const timestamp = node.updatedAt || node.createdAt || new Date().toISOString();

    if (node.evidence && Array.isArray(node.evidence.notes)) {
      node.evidence.notes.forEach((note, index) => {
        items.push({
          id: `note-${node.nodeId}-${index}`,
          type: 'note',
          content: String(note),
          timestamp,
        });
      });
    }

    if (node.evidence && Array.isArray(node.evidence.files)) {
      node.evidence.files.forEach((file, index) => {
        if (file.type === 'link') {
          items.push({
            id: `link-${node.nodeId}-${index}`,
            type: 'link',
            url: file.url || '',
            title: file.title || file.url || 'Link',
            timestamp,
          });
          return;
        }

        if (file.type === 'text') {
          items.push({
            id: `text-${node.nodeId}-${index}`,
            type: 'note',
            content: file.content || '',
            timestamp,
          });
          return;
        }

        items.push({
          id: `file-${node.nodeId}-${index}`,
          type: 'file',
          name: file.filename || file.s3Key || file.fileId || 'File',
          size: file.contentType || '',
          timestamp,
        });
      });
    }

    return items;
  },

  deriveStatus(node, evidenceCount) {
    if (node.outputs && node.outputs.length > 0) {
      return 'complete';
    }
    if ((node.inputs && node.inputs.length > 0) || evidenceCount > 0) {
      return 'in-progress';
    }
    return 'pending';
  },

  resolveAuthor(authorSub) {
    const payload = Auth.token ? parseJwt(Auth.token) : null;
    const currentSub = payload && payload.sub ? payload.sub : '';
    const currentEmail = payload && payload.email ? payload.email : '';

    if (authorSub && authorSub === currentSub && currentEmail) {
      return {
        name: currentEmail,
        initials: this.getInitials(currentEmail),
      };
    }

    const suffix = authorSub ? authorSub.slice(-4) : 'User';
    const name = authorSub ? `User ${suffix}` : 'Unknown';
    return {
      name,
      initials: this.getInitials(name),
    };
  },

  getInitials(name) {
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return '?';
    }
    if (parts.length === 1) {
      return parts[0][0].toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  },

  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '--';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  },

  updateProfile() {
    if (!this.profileLetter) return;
    const payload = Auth.token ? parseJwt(Auth.token) : null;
    const email = payload && payload.email ? String(payload.email) : '';
    const letter = email ? email[0].toUpperCase() : '?';
    this.profileLetter.textContent = letter;
    if (this.profileButton && email) {
      this.profileButton.title = email;
    }
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  await Auth.ensureAuth();
  Canvas.init();
});
