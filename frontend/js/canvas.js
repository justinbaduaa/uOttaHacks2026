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

  createNode(payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.createNode) {
      return window.glassBox.api.createNode(token, payload);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  updateNode(nodeId, payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.updateNode) {
      return window.glassBox.api.updateNode(token, nodeId, payload);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  deleteNode(nodeId, canvasId) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.deleteNode) {
      return window.glassBox.api.deleteNode(token, nodeId, canvasId);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  listNodes(canvasId, updatedSince) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.listNodes) {
      return window.glassBox.api.listNodes(token, canvasId, updatedSince);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },
};

const Canvas = {
  container: null,
  canvas: null,
  nodes: [],
  selectedNode: null,
  nodeCreatePopover: null,
  nodeCreateConfirm: null,
  nodeCreateError: null,
  nodeCreateActionLabel: null,
  pendingNodeParentId: null,
  isNodeCreateVisible: false,
  isNodeFieldEditing: false,
  activeEditableField: null,
  nodeDeletePopover: null,
  nodeDeleteConfirm: null,
  nodeDeleteError: null,
  nodeDeleteLabel: null,
  pendingNodeDeleteId: null,
  isNodeDeleteVisible: false,
  canvasToast: null,
  canvasToastTimeout: null,
  state: {
    canvases: [],
    selectedCanvasId: null,
    nodes: [],
    nodesById: {},
    childrenByParent: {},
    lastSyncByCanvas: {},
    activeUsers: [],
    activeUsersKey: '',
    isLoadingCanvases: false,
    isLoadingNodes: false,
    isCreatingCanvas: false,
    createCanvasError: null,
    isJoiningCanvas: false,
    isShowingCode: false,
    myCanvases: [],
    sharedCanvases: [],
    canvasesError: null,
    isNodeCreateSubmitting: false,
    isNodeDeleteSubmitting: false,
  },
  isDragging: false,
  isPanning: false,
  dragOffset: { x: 0, y: 0 },
  panStart: { x: 0, y: 0 },
  canvasOffset: { x: 0, y: 0 },
  scale: 1,
  currentPath: [],
  pollIntervalMs: 7000,
  pollTimer: null,
  pollInFlight: false,
  presenceMaxVisible: 5,

  init() {
    this.container = document.getElementById('canvasContainer');
    this.canvas = document.getElementById('canvas');
    this.sidebarList = document.getElementById('sidebarBoxesList');
    this.breadcrumb = document.getElementById('breadcrumb');
    this.presenceStack = document.getElementById('presenceStack');
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
    this.nodeCreatePopover = document.getElementById('nodeCreatePopover');
    this.nodeCreateConfirm = document.getElementById('nodeCreateConfirm');
    this.nodeCreateError = document.getElementById('nodeCreateError');
    this.nodeCreateActionLabel = this.nodeCreateConfirm?.querySelector('.node-create-action-label');
    this.nodeDeletePopover = document.getElementById('nodeDeletePopover');
    this.nodeDeleteConfirm = document.getElementById('nodeDeleteConfirm');
    this.nodeDeleteError = document.getElementById('nodeDeleteError');
    this.nodeDeleteLabel = document.getElementById('nodeDeleteLabel');
    this.nodeDeleteLabel = document.getElementById('nodeDeleteLabel');
    this.canvasToast = document.getElementById('canvasToast');

    // Join Canvas Elements
    this.canvasJoinToggle = document.getElementById('canvasJoinToggle');
    this.canvasJoinForm = document.getElementById('canvasJoinForm');
    this.canvasJoinInput = document.getElementById('canvasJoinInput');
    this.canvasJoinSubmit = document.getElementById('canvasJoinSubmit');
    this.canvasJoinCancel = document.getElementById('canvasJoinCancel');
    this.canvasJoinError = document.getElementById('canvasJoinError');
    this.canvasActions = document.querySelector('.canvas-actions');

    // Canvas Code Elements
    this.canvasCode = document.getElementById('canvasCode');
    this.canvasCodeToggle = document.getElementById('canvasCodeToggle');
    this.canvasCodePanel = document.getElementById('canvasCodePanel');
    this.canvasCodeValue = document.getElementById('canvasCodeValue');
    this.canvasCodeHint = document.getElementById('canvasCodeHint');

    this.setupEventListeners();
    this.updateProfile();
    this.renderSidebar();
    this.updateBreadcrumb();
    this.loadCanvases();
  },

  setupEventListeners() {
    // Canvas panning
    this.container.addEventListener('mousedown', (e) => {
      if (e.detail > 1) {
        return;
      }
      if (e.target === this.container || e.target === this.canvas) {
        this.startPan(e);
      }
    });

    this.container.addEventListener('dblclick', (e) => {
      this.handleCanvasDoubleClick(e);
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
        this.hideNodeDeletePopover();
        const id = item.dataset.id;
        if (id === 'root') {
          this.navigateToRoot();
        } else {
          // Navigate to specific node in path
          const index = this.currentPath.findIndex(n => n.id === id);
          if (index !== -1) {
            this.currentPath = this.currentPath.slice(0, index + 1);
            this.refreshCurrentView();
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

    // Join Canvas Listeners
    if (this.canvasJoinToggle) {
      this.canvasJoinToggle.addEventListener('click', () => this.openJoinCanvas());
    }
    if (this.canvasJoinSubmit) {
      this.canvasJoinSubmit.addEventListener('click', () => this.submitJoinCanvas());
    }
    if (this.canvasJoinCancel) {
      this.canvasJoinCancel.addEventListener('click', () => this.closeJoinCanvas());
    }
    if (this.canvasJoinInput) {
      this.canvasJoinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submitJoinCanvas();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closeJoinCanvas();
        }
      });
    }

    // Canvas Code Listeners
    if (this.canvasCodeToggle) {
      this.canvasCodeToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleCodePanel();
      });
    }

    document.addEventListener('click', (e) => {
      if (this.state.isCreatingCanvas && this.canvasActions && !this.canvasActions.contains(e.target)) {
        this.closeCreateCanvas();
      }
      if (this.state.isJoiningCanvas && this.canvasActions && !this.canvasActions.contains(e.target)) {
        this.closeJoinCanvas();
      }
      if (this.state.isShowingCode && this.canvasCode && !this.canvasCode.contains(e.target)) {
        this.closeCodePanel();
      }
      if (!this.nodeCreatePopover || this.nodeCreatePopover.contains(e.target)) {
        return;
      }
      if (this.state.isNodeCreateSubmitting) {
        return;
      }
      this.hideNodeCreatePopover(true);
    });

    if (this.nodeCreateConfirm) {
      this.nodeCreateConfirm.addEventListener('click', (e) => {
        e.preventDefault();
        this.submitCreateNode();
      });
    }

    if (this.nodeDeleteConfirm) {
      this.nodeDeleteConfirm.addEventListener('click', (e) => {
        e.preventDefault();
        this.confirmNodeDelete();
      });
    }

    document.addEventListener('click', (e) => {
      if (!this.isNodeCreateVisible || !this.nodeCreatePopover) return;
      if (this.state.isNodeCreateSubmitting) return;
      if (this.nodeCreatePopover.contains(e.target)) {
        return;
      }
      this.hideNodeCreatePopover(true);
    });

    document.addEventListener('click', (e) => {
      if (!this.isNodeDeleteVisible || !this.nodeDeletePopover) return;
      if (this.state.isNodeDeleteSubmitting) return;
      if (this.nodeDeletePopover.contains(e.target)) {
        return;
      }
      this.hideNodeDeletePopover();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isNodeCreateVisible && !this.state.isNodeCreateSubmitting) {
        this.hideNodeCreatePopover();
      }
      if (e.key === 'Escape' && this.isNodeDeleteVisible && !this.state.isNodeDeleteSubmitting) {
        this.hideNodeDeletePopover();
      }
    });
  },

  handleCanvasDoubleClick(e) {
    if (
      !this.state.selectedCanvasId ||
      this.state.isLoadingNodes ||
      this.state.isNodeCreateSubmitting ||
      this.isNodeFieldEditing
    ) {
      return;
    }
    if (e.target.closest('.glass-node') || e.target.closest('.node-create-popover')) {
      return;
    }

    this.hideNodeDeletePopover(true);

    const rect = this.container.getBoundingClientRect();
    const margin = 90;
    const rawX = e.clientX - rect.left;
    const rawY = e.clientY - rect.top;
    const maxX = Math.max(margin, rect.width - margin);
    const maxY = Math.max(margin, rect.height - margin);
    const x = Math.min(Math.max(rawX, margin), maxX);
    const y = Math.min(Math.max(rawY, margin), maxY);

    this.pendingNodeParentId = this.currentPath.length > 0
      ? this.currentPath[this.currentPath.length - 1].id
      : null;

    this.showNodeCreatePopover(x, y);
  },

  showNodeCreatePopover(x, y) {
    if (!this.nodeCreatePopover) return;
    this.nodeCreatePopover.style.left = `${x}px`;
    this.nodeCreatePopover.style.top = `${y}px`;
    this.nodeCreatePopover.classList.add('is-visible');
    this.nodeCreatePopover.setAttribute('aria-hidden', 'false');
    this.isNodeCreateVisible = true;
    if (this.nodeCreateError) {
      this.nodeCreateError.textContent = '';
    }
  },

  hideNodeCreatePopover(force = false) {
    if (!this.nodeCreatePopover) return;
    if (!force && this.state.isNodeCreateSubmitting) {
      return;
    }
    this.nodeCreatePopover.classList.remove('is-visible');
    this.nodeCreatePopover.setAttribute('aria-hidden', 'true');
    this.isNodeCreateVisible = false;
    this.pendingNodeParentId = null;
    if (this.nodeCreateError) {
      this.nodeCreateError.textContent = '';
    }
    if (this.nodeCreateConfirm && (!this.state.isNodeCreateSubmitting || force)) {
      this.nodeCreateConfirm.disabled = false;
    }
    if (this.nodeCreateActionLabel && (!this.state.isNodeCreateSubmitting || force)) {
      this.nodeCreateActionLabel.textContent = 'Create new task';
    }
  },

  handleNodeContextMenu(event, nodeData) {
    if (!nodeData || this.state.isNodeDeleteSubmitting) {
      return;
    }
    if (event.target.closest('.node-editable')) {
      return;
    }
    if (this.isNodeFieldEditing) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = this.container.getBoundingClientRect();
    const margin = 70;
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const maxX = Math.max(margin, rect.width - margin);
    const maxY = Math.max(margin, rect.height - margin);
    const x = Math.min(Math.max(rawX, margin), maxX);
    const y = Math.min(Math.max(rawY, margin), maxY);

    this.pendingNodeDeleteId = nodeData.id;
    this.showNodeDeletePopover(x, y, nodeData);
  },

  showNodeDeletePopover(x, y, nodeData) {
    if (!this.nodeDeletePopover) return;
    this.hideNodeCreatePopover(true);
    this.nodeDeletePopover.style.left = `${x}px`;
    this.nodeDeletePopover.style.top = `${y}px`;
    if (this.nodeDeleteLabel) {
      const name = nodeData?.name ? `"${nodeData.name}"` : 'this task';
      this.nodeDeleteLabel.textContent = `Delete ${name}?`;
    }
    if (this.nodeDeleteError) {
      this.nodeDeleteError.textContent = '';
    }
    this.nodeDeletePopover.classList.add('is-visible');
    this.nodeDeletePopover.setAttribute('aria-hidden', 'false');
    this.isNodeDeleteVisible = true;
  },

  hideNodeDeletePopover(force = false) {
    if (!this.nodeDeletePopover) return;
    if (!force && this.state.isNodeDeleteSubmitting) {
      return;
    }
    this.nodeDeletePopover.classList.remove('is-visible');
    this.nodeDeletePopover.setAttribute('aria-hidden', 'true');
    this.isNodeDeleteVisible = false;
    this.pendingNodeDeleteId = null;
    if (this.nodeDeleteError) {
      this.nodeDeleteError.textContent = '';
    }
  },

  async submitCreateNode() {
    if (!this.nodeCreateConfirm || this.state.isNodeCreateSubmitting) {
      return;
    }
    if (!this.state.selectedCanvasId) {
      if (this.nodeCreateError) {
        this.nodeCreateError.textContent = 'Select a canvas first.';
      }
      return;
    }

    const parentNodeId = this.pendingNodeParentId !== null && this.pendingNodeParentId !== undefined
      ? this.pendingNodeParentId
      : (this.currentPath.length > 0 ? this.currentPath[this.currentPath.length - 1].id : null);

    const payload = {
      canvasId: this.state.selectedCanvasId,
      parentNodeId: parentNodeId || 'ROOT',
      title: 'Title',
      description: 'Description',
      inputs: [],
      outputs: [],
      evidence: { notes: [], files: [] },
    };

    this.state.isNodeCreateSubmitting = true;
    this.nodeCreateConfirm.disabled = true;
    const previousLabel = this.nodeCreateActionLabel
      ? this.nodeCreateActionLabel.textContent
      : null;
    if (this.nodeCreateActionLabel) {
      this.nodeCreateActionLabel.textContent = 'Creating...';
    }

    try {
      const created = await Api.createNode(payload);
      const normalized = this.normalizeNodeFromApi(created);
      this.state.nodes = [normalized, ...this.state.nodes];
      this.buildNodeIndex();
      this.refreshCurrentView();
      this.hideNodeCreatePopover();
      this.focusOnNode(normalized.id);
    } catch (error) {
      if (this.nodeCreateError) {
        this.nodeCreateError.textContent = error.message || 'Failed to create task.';
      }
    } finally {
      this.state.isNodeCreateSubmitting = false;
      this.nodeCreateConfirm.disabled = false;
      if (this.nodeCreateActionLabel && previousLabel) {
        this.nodeCreateActionLabel.textContent = previousLabel;
      }
    }
  },

  async confirmNodeDelete() {
    if (!this.pendingNodeDeleteId || !this.state.selectedCanvasId) {
      return;
    }
    if (this.state.isNodeDeleteSubmitting) {
      return;
    }
    const nodeId = this.pendingNodeDeleteId;
    const subtreeIds = this.collectSubtreeNodeIds(nodeId);
    if (subtreeIds.length === 0) {
      this.hideNodeDeletePopover(true);
      return;
    }

    const nodesSnapshot = this.state.nodes.slice();
    const pathSnapshot = this.currentPath.map((node) => node.id);

    this.state.isNodeDeleteSubmitting = true;
    if (this.nodeDeleteConfirm) {
      this.nodeDeleteConfirm.disabled = true;
    }
    if (this.nodeDeleteError) {
      this.nodeDeleteError.textContent = '';
    }

    this.removeNodesFromState(subtreeIds);
    this.hideNodeDeletePopover(true);

    try {
      await Api.deleteNode(nodeId, this.state.selectedCanvasId);
    } catch (error) {
      console.error('[Canvas] Failed to delete node', error);
      this.state.nodes = nodesSnapshot;
      this.buildNodeIndex();
      this.restorePathFromIds(pathSnapshot);
      this.refreshCurrentView();
      this.showCanvasToast(error.message || 'Failed to delete task.', 'error');
    } finally {
      this.state.isNodeDeleteSubmitting = false;
      if (this.nodeDeleteConfirm) {
        this.nodeDeleteConfirm.disabled = false;
      }
      this.pendingNodeDeleteId = null;
    }
  },

  refreshCurrentView() {
    if (this.currentPath.length === 0) {
      this.renderNodes(this.getRootNodes());
      this.updateBreadcrumb();
      return;
    }

    const currentNodeId = this.currentPath[this.currentPath.length - 1]?.id;
    const canonicalNode = currentNodeId ? this.getNode(currentNodeId) : null;
    if (!canonicalNode) {
      this.renderNodes([]);
      this.updateBreadcrumb();
      return;
    }

    const children = this.getChildNodes(currentNodeId);
    if (children.length > 0) {
      this.renderNodes(children);
    } else {
      this.renderNodes([]);
    }
    this.updateBreadcrumb();
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

    const mySection = this.renderCanvasSection(
      'My Canvases',
      this.state.myCanvases,
      'No canvases yet.'
    );
    const sharedSection = this.renderCanvasSection(
      'Shared Canvases',
      this.state.sharedCanvases,
      'No shared canvases yet.'
    );
    this.sidebarList.innerHTML = `${mySection}${sharedSection}`;
    // Re-render icons after DOM update
    if (window.lucide) window.lucide.createIcons();
  },

  renderCanvasSection(title, canvases, emptyMessage) {
    let items = '';
    if (canvases.length > 0) {
      items = canvases.map(canvas => {
        const selected = canvas.id === this.state.selectedCanvasId;
        return `
          <button class="box-item ${selected ? 'selected' : ''}" data-id="${canvas.id}">
            <span class="box-dot"></span>
            <span class="box-name">${this.escapeHtml(canvas.name)}</span>
            <span class="box-chevron">
              <i data-lucide="chevron-right" width="12" height="12"></i>
            </span>
          </button>
        `;
      }).join('');
    } else {
      items = `<div class="canvas-list-message">${this.escapeHtml(emptyMessage)}</div>`;
    }

    return `
      <div class="sidebar-section-title">${this.escapeHtml(title)}</div>
      <div class="canvas-list-group">
        ${items}
      </div>
    `;
  },
  async loadCanvases() {
    this.state.isLoadingCanvases = true;
    this.renderSidebar();

    try {
      const canvases = await Api.listCanvases();
      const normalized = (canvases || []).map(c => ({
        id: c.canvasId,
        name: c.name,
        joinedAt: c.joinedAt,
        ownerSub: c.ownerSub, // crucial for partitioning
        joinCode: c.joinCode,
        isShared: c.isShared,
      }));
      this.state.canvases = normalized;
      this.partitionCanvases();
      this.state.isLoadingCanvases = false;
      this.renderSidebar();
      this.updateCodePanel();

      if (normalized.length > 0) {
        const preferred = this.state.myCanvases[0] || this.state.sharedCanvases[0];
        if (preferred) {
          await this.selectCanvas(preferred.id);
        }
      } else {
        this.state.selectedCanvasId = null;
        this.stopPolling();
        this.updateBreadcrumb();
        this.closeCodePanel();
        this.updateCodePanel();
        this.renderNodes([]);
      }
    } catch (error) {
      this.state.isLoadingCanvases = false;
      this.state.canvasesError = error.message || 'Failed to load canvases';
      this.renderSidebar();
    }
  },

  partitionCanvases() {
    const currentSub = this.getCurrentUserSub();
    const myCanvases = [];
    const sharedCanvases = [];

    this.state.canvases.forEach((canvas) => {
      // It's shared if I'm not the owner
      const isShared = canvas.isShared || (!!currentSub && canvas.ownerSub && canvas.ownerSub !== currentSub);
      canvas.isShared = isShared;
      if (isShared) {
        sharedCanvases.push(canvas);
      } else {
        myCanvases.push(canvas);
      }
    });

    const sorter = (a, b) => (b.joinedAt || '').localeCompare(a.joinedAt || '');
    myCanvases.sort(sorter);
    sharedCanvases.sort(sorter);

    this.state.myCanvases = myCanvases;
    this.state.sharedCanvases = sharedCanvases;
  },

  getCurrentUserSub() {
    const payload = Auth.token ? parseJwt(Auth.token) : null;
    return payload ? (payload.sub || '') : '';
  },

  async selectCanvas(canvasId) {
    if (!canvasId || this.state.selectedCanvasId === canvasId) {
      return;
    }
    this.stopPolling();
    this.state.selectedCanvasId = canvasId;
    this.currentPath = [];
    this.hideNodeCreatePopover();
    this.hideNodeDeletePopover();
    this.setActiveUsers([]);
    this.renderSidebar();
    this.updateBreadcrumb();
    await this.loadNodesForCanvas(canvasId);
    if (this.state.selectedCanvasId === canvasId) {
      this.startPolling();
    }
  },

  async loadNodesForCanvas(canvasId) {
    this.state.isLoadingNodes = true;
    this.setCanvasLoading(true);
    this.renderNodes([]);

    try {
      console.log('[Canvas] Loading nodes for canvas', canvasId);
      const payload = await Api.listNodes(canvasId);
      const { nodes, activeUsers } = this.normalizeNodesPayload(payload);
      this.setActiveUsers(activeUsers);
      console.log('[Canvas] Loaded nodes', Array.isArray(nodes) ? nodes.length : nodes);
      const normalized = (nodes || [])
        .filter(node => !node.deletedAt)
        .map(node => this.normalizeNodeFromApi(node));
      this.state.nodes = normalized;
      const latestUpdate = this.getLatestUpdatedAt(normalized);
      if (latestUpdate) {
        this.state.lastSyncByCanvas[canvasId] = latestUpdate;
      }
      this.buildNodeIndex();
      this.refreshCurrentView();
    } catch (error) {
      console.error('[Canvas] Failed to load nodes', error);
      this.state.nodes = [];
      this.setActiveUsers([]);
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

  openJoinCanvas() {
    if (this.state.isJoiningCanvas) {
      this.closeJoinCanvas();
      return;
    }
    if (this.state.isCreatingCanvas) {
      this.closeCreateCanvas();
    }
    this.state.isJoiningCanvas = true;
    if (this.canvasJoinForm) this.canvasJoinForm.classList.add('is-open');
    if (this.canvasJoinInput) {
      this.canvasJoinInput.value = '';
      this.canvasJoinInput.focus();
    }
    if (this.canvasJoinError) this.canvasJoinError.textContent = '';
  },

  closeJoinCanvas() {
    this.state.isJoiningCanvas = false;
    if (this.canvasJoinForm) this.canvasJoinForm.classList.remove('is-open');
    if (this.canvasJoinError) this.canvasJoinError.textContent = '';
  },

  async submitJoinCanvas() {
    const rawCode = this.canvasJoinInput ? this.canvasJoinInput.value.trim() : '';
    if (!rawCode) {
      if (this.canvasJoinError) this.canvasJoinError.textContent = 'Enter a code.';
      return;
    }

    if (this.canvasJoinSubmit) this.canvasJoinSubmit.disabled = true;
    if (this.canvasJoinError) this.canvasJoinError.textContent = 'Joining...';

    try {
      const joined = await Api.joinCanvas(rawCode);
      const existing = this.state.canvases.find((c) => c.id === joined.canvasId);
      if (!existing) {
        const canvas = {
          id: joined.canvasId,
          name: joined.name || 'Untitled Canvas',
          joinedAt: new Date().toISOString(),
          ownerSub: '', // Unknown owner initially
          joinCode: '',
          isShared: true,
        };
        this.state.canvases = [canvas, ...this.state.canvases];
        this.partitionCanvases();
      }
      this.closeJoinCanvas();
      this.renderSidebar();
      this.selectCanvas(joined.canvasId);
    } catch (error) {
      const message = String(error.message || 'Failed to join canvas.');
      if (this.canvasJoinError) {
        if (message.toLowerCase().includes('not found')) {
          this.canvasJoinError.textContent = 'Invalid code.';
        } else if (message.toLowerCase().includes('already')) {
          this.canvasJoinError.textContent = 'Already joined.';
        } else {
          this.canvasJoinError.textContent = message;
        }
      }
    } finally {
      if (this.canvasJoinSubmit) this.canvasJoinSubmit.disabled = false;
    }
  },

  toggleCodePanel() {
    if (!this.canvasCodePanel) return;
    if (this.state.isShowingCode) {
      this.closeCodePanel();
    } else {
      this.openCodePanel();
    }
  },

  openCodePanel() {
    if (!this.canvasCodePanel) return;
    this.updateCodePanel();
    this.canvasCodePanel.hidden = false;
    this.state.isShowingCode = true;
  },

  closeCodePanel() {
    if (!this.canvasCodePanel) return;
    this.canvasCodePanel.hidden = true;
    this.state.isShowingCode = false;
  },

  updateCodePanel() {
    if (!this.canvasCodeToggle || !this.canvasCodeValue || !this.canvasCodeHint) return;
    const selectedCanvas = this.state.canvases.find(c => c.id === this.state.selectedCanvasId);

    if (!selectedCanvas) {
      this.canvasCodeToggle.disabled = true;
      this.canvasCodeValue.textContent = '--';
      this.canvasCodeHint.textContent = 'Select a canvas to view its code.';
      return;
    }

    this.canvasCodeToggle.disabled = false;

    if (selectedCanvas.joinCode) {
      this.canvasCodeValue.textContent = String(selectedCanvas.joinCode).toUpperCase();
      this.canvasCodeHint.textContent = 'Share to invite collaborators.';
      return;
    }

    if (selectedCanvas.isShared) {
      this.canvasCodeValue.textContent = '--';
      this.canvasCodeHint.textContent = 'Codes are only available for your canvases.';
      return;
    }

    this.canvasCodeValue.textContent = '--';
    this.canvasCodeHint.textContent = 'Code unavailable for this canvas.';
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
      return;
    }

    nodeDataArray.forEach((nodeData, index) => {
      const node = this.createNodeElement(nodeData, index);
      this.nodes.push(node);
      this.canvas.appendChild(node.element);
    });
    // Re-render icons for new nodes
    if (window.lucide) window.lucide.createIcons();
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

    const fileCount = nodeData.evidence?.length || 21;
    const layerCount = this.getChildNodes(nodeData.id)?.length || 3;

    element.innerHTML = `
      <div class="node-content">
        <!-- Header with icon, title (Cleaned up) -->
        <div class="node-header">
          <span class="node-icon">
            <i data-lucide="box"></i>
          </span>
          <h3 class="node-title">${this.escapeHtml(nodeData.name || 'Untitled')}</h3>
        </div>
        
        <!-- Description -->
        <p class="node-description">${this.escapeHtml(nodeData.goal || 'Description')}</p>
        

        
        </div>

        <!-- Input Section -->
        <div class="node-input">
          <div class="node-input-header">
            <span class="input-icon">
              <i data-lucide="inbox"></i>
            </span>
            <span class="input-title">Input</span>
          </div>
          <div class="node-input-list">
            <!-- Mock Inputs -->
            <div class="input-item">
              <span class="input-item-icon"><i data-lucide="file-text"></i></span>
              <span class="input-item-text">Project Requirements.pdf</span>
            </div>
            <div class="input-item">
              <span class="input-item-icon"><i data-lucide="link"></i></span>
              <span class="input-item-text">Figma Mockups</span>
            </div>
             <div class="input-item">
              <span class="input-item-icon"><i data-lucide="image"></i></span>
              <span class="input-item-text">Reference_Image.png</span>
            </div>
          </div>
        </div>
        
        <!-- Stats Footer -->
        <div class="node-stats-footer">
          <div class="stat-item files">
            <span class="stat-item-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </span>
            <span>${fileCount}</span>
          </div>
          <div class="stat-item layers">
            <span class="stat-item-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2"/>
                <path d="M2 12l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2"/>
              </svg>
            </span>
            <span>${layerCount}</span>
          </div>
          </div>
        </div>

        <!-- Start Output Toggle (Bottom of Card) -->
        <button class="node-footer-toggle" aria-label="Toggle Output">
          <span class="adjust-text">View Output</span>
          <i data-lucide="chevron-down"></i>
        </button>
        
        <!-- Output Section (expandable) -->
        <div class="node-output">
          <div class="node-output-header">
            <span class="output-icon">
              <i data-lucide="play" width="24" height="24"></i>
            </span>
            <span class="output-title">Output</span>
          </div>
          <p class="node-output-description">Create filtered views that you can save and share with others</p>
          <div class="node-output-actions">
            <button class="output-open-btn">Open views</button>
            <a class="output-learn-more">Learn more ›</a>
          </div>
        </div>
      </div>
    `;



    this.attachNodeEditing(element, nodeData);

    // Drag listeners
    element.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (this.isNodeFieldEditing || e.target.closest('.node-editable')) {
        return;
      }
      this.startDrag(e, element, x, y);
    });

    // Double-click to navigate into node
    element.addEventListener('dblclick', (event) => {
      if (event.target.closest('.node-editable')) {
        event.stopPropagation();
        return;
      }
      event.stopPropagation();
      this.navigateIntoNode(nodeData);
    });

    element.addEventListener('contextmenu', (event) => {
      this.handleNodeContextMenu(event, nodeData);
    });

    return { element, data: nodeData, x, y };
  },

  attachNodeEditing(element, nodeData) {
    if (!element || !nodeData) return;
    const titleEl = element.querySelector('.node-title');
    const descriptionEl = element.querySelector('.node-description');
    
    // Toggle Logic with new footer button
    const toggleBtn = element.querySelector('.node-footer-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('mousedown', (e) => e.stopPropagation()); // Prevent drag
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        element.classList.toggle('expanded');
      });
    }

    const config = [
      {
        el: titleEl,
        field: 'title',
        placeholder: 'Name this task',
        allowEmpty: false,
        value: nodeData.name || '',
      },
      {
        el: descriptionEl,
        field: 'description',
        placeholder: 'Describe what success looks like',
        allowEmpty: true,
        value: nodeData.goal || '',
      },
    ];

    config.forEach(({ el, field, placeholder, allowEmpty, value }) => {
      if (!el) return;
      el.contentEditable = 'true';
      el.spellcheck = true;
      el.classList.add('node-editable');
      el.dataset.nodeId = nodeData.id;
      el.dataset.field = field;
      el.dataset.allowEmpty = allowEmpty ? 'true' : 'false';
      el.setAttribute('data-placeholder', placeholder);
      el.textContent = value;
      el.dataset.originalValue = this.getNodeFieldTextValue(el);
      this.updateEditablePlaceholderState(el);

      el.addEventListener('focus', () => this.handleNodeFieldFocus(el));
      el.addEventListener('input', () => this.handleNodeFieldInput(el));
      el.addEventListener('keydown', (event) => this.handleNodeFieldKeydown(event, el));
      el.addEventListener('blur', () => this.handleNodeFieldBlur(el, nodeData));
    });
  },

  updateEditablePlaceholderState(element) {
    if (!element) return;
    const isEmpty = !element.textContent.trim();
    element.setAttribute('data-placeholder-visible', isEmpty ? 'true' : 'false');
  },

  getNodeFieldTextValue(element) {
    if (!element) return '';
    return element.textContent.trim();
  },

  handleNodeFieldFocus(element) {
    if (!element) return;
    this.isNodeFieldEditing = true;
    this.activeEditableField = element;
    element.classList.remove('has-error');
    element.classList.remove('is-saving');
    element.dataset.originalValue = this.getNodeFieldTextValue(element);
    this.hideNodeCreatePopover(true);
    element.setAttribute('data-placeholder-visible', 'false');
    setTimeout(() => this.placeCaretAtEnd(element), 0);
  },

  handleNodeFieldInput(element) {
    if (!element) return;
    if (!element.textContent.trim()) {
      element.textContent = '';
    }
    this.updateEditablePlaceholderState(element);
  },

  handleNodeFieldKeydown(event, element) {
    if (!element) return;
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      element.blur();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const original = element.dataset.originalValue || '';
      element.textContent = original;
      element.blur();
    }
  },

  handleNodeFieldBlur(element, nodeData) {
    if (!element) return;
    const originalValue = element.dataset.originalValue || '';
    const newValue = this.getNodeFieldTextValue(element);
    this.isNodeFieldEditing = false;
    this.activeEditableField = null;
    this.updateEditablePlaceholderState(element);

    if (newValue === originalValue) {
      element.textContent = originalValue;
      this.updateEditablePlaceholderState(element);
      return;
    }

    const allowEmpty = element.dataset.allowEmpty === 'true';
    if (!allowEmpty && !newValue) {
      element.textContent = originalValue;
      element.classList.add('has-error');
      setTimeout(() => element.classList.remove('has-error'), 1200);
      this.updateEditablePlaceholderState(element);
      return;
    }

    const updates = {};
    const apiUpdates = {};
    if (element.dataset.field === 'title') {
      updates.name = newValue;
      apiUpdates.title = newValue;
    } else {
      updates.goal = newValue;
      apiUpdates.description = newValue;
    }

    this.saveNodeField(nodeData, updates, apiUpdates, element, originalValue);
  },

  async saveNodeField(nodeData, updates, apiUpdates, element, fallbackValue) {
    if (!nodeData || !nodeData.id || !this.state.selectedCanvasId) {
      return;
    }
    element.classList.add('is-saving');
    element.classList.remove('has-error');

    try {
      const updated = await Api.updateNode(nodeData.id, {
        canvasId: this.state.selectedCanvasId,
        ...apiUpdates,
      });

      const resolvedUpdates = { ...updates };
      if (updates.name !== undefined && updated && Object.prototype.hasOwnProperty.call(updated, 'title')) {
        resolvedUpdates.name = updated.title || '';
      }
      if (updates.goal !== undefined && updated && Object.prototype.hasOwnProperty.call(updated, 'description')) {
        resolvedUpdates.goal = updated.description || '';
      }

      const finalValue = resolvedUpdates.name ?? resolvedUpdates.goal ?? '';
      element.dataset.originalValue = finalValue;
      element.textContent = finalValue;
      element.classList.remove('is-saving');
      element.classList.remove('has-error');
      this.updateEditablePlaceholderState(element);
      this.applyNodeUpdates(nodeData.id, {
        ...resolvedUpdates,
        updatedAt: updated?.updatedAt || nodeData.updatedAt,
      }, nodeData);
    } catch (error) {
      console.error('[Canvas] Failed to update node', error);
      element.classList.remove('is-saving');
      element.classList.add('has-error');
      element.textContent = fallbackValue;
      element.dataset.originalValue = fallbackValue;
      setTimeout(() => element.classList.remove('has-error'), 1200);
      this.updateEditablePlaceholderState(element);
    }
  },

  applyNodeUpdates(nodeId, updates, nodeData) {
    if (nodeData && nodeData.id === nodeId) {
      Object.assign(nodeData, updates);
    }
    if (this.state.nodesById[nodeId]) {
      Object.assign(this.state.nodesById[nodeId], updates);
    }
    this.nodes.forEach((nodeEntry) => {
      if (nodeEntry.data.id === nodeId) {
        Object.assign(nodeEntry.data, updates);
      }
    });
    this.currentPath = this.currentPath.map((node) => {
      if (node.id === nodeId) {
        return { ...node, ...updates };
      }
      return node;
    });
  },

  collectSubtreeNodeIds(nodeId) {
    if (!nodeId || !this.state.nodesById[nodeId]) {
      return [];
    }
    const ids = [];
    const stack = [nodeId];
    const seen = new Set();
    while (stack.length > 0) {
      const currentId = stack.pop();
      if (seen.has(currentId)) {
        continue;
      }
      seen.add(currentId);
      if (!this.state.nodesById[currentId]) {
        continue;
      }
      ids.push(currentId);
      const children = this.getChildNodes(currentId) || [];
      children.forEach((child) => stack.push(child.id));
    }
    return ids;
  },

  removeNodesFromState(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) {
      return;
    }
    const removalSet = new Set(nodeIds);
    this.state.nodes = this.state.nodes.filter((node) => !removalSet.has(node.id));
    this.buildNodeIndex();
    this.refreshCurrentView();
  },

  restorePathFromIds(pathIds) {
    if (!Array.isArray(pathIds) || pathIds.length === 0) {
      this.currentPath = [];
      return;
    }
    const newPath = [];
    pathIds.forEach((id) => {
      const node = this.getNode(id);
      if (node) {
        newPath.push(node);
      }
    });
    this.currentPath = newPath;
  },

  showCanvasToast(message, variant = 'neutral') {
    if (!this.canvasToast) return;
    this.canvasToast.textContent = message;
    this.canvasToast.classList.remove('is-error');
    if (variant === 'error') {
      this.canvasToast.classList.add('is-error');
    }
    this.canvasToast.classList.add('is-visible');
    if (this.canvasToastTimeout) {
      clearTimeout(this.canvasToastTimeout);
    }
    this.canvasToastTimeout = setTimeout(() => this.hideCanvasToast(), 3200);
  },

  hideCanvasToast() {
    if (!this.canvasToast) return;
    this.canvasToast.classList.remove('is-visible');
    this.canvasToast.classList.remove('is-error');
    if (this.canvasToastTimeout) {
      clearTimeout(this.canvasToastTimeout);
      this.canvasToastTimeout = null;
    }
  },

  placeCaretAtEnd(element) {
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  },

  startDrag(e, element, currentX, currentY) {
    this.hideNodeCreatePopover();
    this.hideNodeDeletePopover();
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
    this.hideNodeCreatePopover();
    this.hideNodeDeletePopover();
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
    this.hideNodeCreatePopover();
    this.hideNodeDeletePopover();
    this.currentPath.push(nodeData);
    
    // Reset view
    this.canvasOffset = { x: 0, y: 0 };
    this.scale = 1;
    this.updateCanvasTransform();
    this.refreshCurrentView();
  },

  navigateToRoot() {
    this.hideNodeCreatePopover();
    this.hideNodeDeletePopover();
    this.currentPath = [];
    this.canvasOffset = { x: 0, y: 0 };
    this.scale = 1;
    this.updateCanvasTransform();
    this.refreshCurrentView();
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

    this.currentPath = this.currentPath
      .map((node) => this.state.nodesById[node.id] || node)
      .filter(Boolean);
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
  },

  // ========== Collaborative Polling Functions ==========

  startPolling() {
    this.stopPolling();
    if (!this.state.selectedCanvasId || !Api.getAuthToken()) {
      return;
    }
    console.log('[Canvas] Starting polling every', this.pollIntervalMs, 'ms');
    this.pollTimer = setInterval(() => {
      this.pollNodes();
    }, this.pollIntervalMs);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[Canvas] Stopped polling');
    }
    this.pollInFlight = false;
  },

  async pollNodes() {
    if (this.pollInFlight) return;
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId || !Api.getAuthToken()) {
      this.stopPolling();
      return;
    }
    if (this.state.isLoadingNodes) {
      return;
    }

    this.pollInFlight = true;
    try {
      const updatedSince = this.getUpdatedSinceForPoll(canvasId);
      console.log('[Canvas] Polling nodes since:', updatedSince || '(initial)');
      const payload = await Api.listNodes(canvasId, updatedSince);
      const { nodes, activeUsers } = this.normalizeNodesPayload(payload);
      this.setActiveUsers(activeUsers);
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return;
      }
      const normalized = nodes.map(node => this.normalizeNodeFromApi(node));
      const latestUpdate = this.getLatestUpdatedAt(normalized);
      this.applyPolledNodeUpdates(normalized);
      if (latestUpdate) {
        this.state.lastSyncByCanvas[canvasId] = latestUpdate;
      }
    } catch (error) {
      console.warn('[Canvas] Polling failed', error);
    } finally {
      this.pollInFlight = false;
    }
  },

  normalizeNodesPayload(payload) {
    if (Array.isArray(payload)) {
      return { nodes: payload, activeUsers: [] };
    }
    if (payload && Array.isArray(payload.nodes)) {
      return {
        nodes: payload.nodes,
        activeUsers: payload.activeUsers || payload.presence || payload.active_users || [],
      };
    }
    return { nodes: [], activeUsers: [] };
  },

  applyPolledNodeUpdates(incomingNodes) {
    if (!incomingNodes || incomingNodes.length === 0) {
      return;
    }

    const renderedById = new Map(this.nodes.map(node => [node.data.id, node]));
    let needsRefresh = false;

    incomingNodes.forEach((incoming) => {
      if (incoming.deletedAt) {
        // Node was deleted
        const rendered = renderedById.get(incoming.id);
        if (rendered) {
          rendered.element.remove();
          this.nodes = this.nodes.filter(node => node.data.id !== incoming.id);
        }
        this.state.nodes = this.state.nodes.filter(node => node.id !== incoming.id);
        needsRefresh = true;
        return;
      }

      const existing = this.state.nodesById[incoming.id];
      if (existing) {
        // Update existing node
        Object.assign(existing, incoming);
        const rendered = renderedById.get(incoming.id);
        if (rendered) {
          Object.assign(rendered.data, incoming);
          // Update title and description in DOM
          const titleEl = rendered.element.querySelector('.node-title');
          const descEl = rendered.element.querySelector('.node-description');
          if (titleEl) titleEl.textContent = incoming.name || 'Untitled';
          if (descEl) descEl.textContent = incoming.goal || 'Description';
        }
      } else {
        // New node
        this.state.nodes.push(incoming);
        needsRefresh = true;
      }
    });

    if (needsRefresh) {
      this.buildNodeIndex();
      this.refreshCurrentView();
    }
  },

  getLatestUpdatedAt(nodes) {
    let latest = '';
    (nodes || []).forEach((node) => {
      const normalized = this.normalizeIsoTimestamp(node.updatedAt || '');
      if (normalized && (!latest || normalized > latest)) {
        latest = normalized;
      }
    });
    return latest;
  },

  normalizeIsoTimestamp(timestamp) {
    if (!timestamp || typeof timestamp !== 'string') {
      return '';
    }

    const match = timestamp.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
    );
    if (!match) {
      return timestamp;
    }

    const base = match[1];
    const fraction = match[2] ? match[2].slice(1) : '';
    const zone = match[3];
    const ms = fraction ? fraction.padEnd(3, '0').slice(0, 3) : '000';

    return `${base}.${ms}${zone}`;
  },

  getUpdatedSinceForPoll(canvasId) {
    const normalized = this.normalizeIsoTimestamp(this.state.lastSyncByCanvas[canvasId] || '');
    if (!normalized) {
      return '';
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return normalized;
    }
    parsed.setMilliseconds(parsed.getMilliseconds() - 1);
    return parsed.toISOString();
  },

  // ========== Active Users / Presence Functions ==========

  setActiveUsers(users) {
    const normalized = this.normalizeActiveUsers(users);
    const key = normalized.map(user => `${user.userId}:${user.displayName}:${user.lastActiveAt}`).join('|');
    if (key === this.state.activeUsersKey) {
      return;
    }
    this.state.activeUsers = normalized;
    this.state.activeUsersKey = key;
    this.renderPresence();
  },

  normalizeActiveUsers(users) {
    if (!Array.isArray(users)) {
      return [];
    }
    const currentUser = this.getCurrentUserProfile();
    const seen = new Set();
    const result = [];

    users.forEach((user) => {
      if (!user) return;
      const userId = String(user.userId || user.sub || user.id || '').trim();
      if (!userId || userId === currentUser.userId || seen.has(userId)) {
        return;
      }
      const displayName = String(
        user.displayName || user.name || user.email || `User ${userId.slice(-4)}`
      );
      const initial = String(user.initial || this.getInitials(displayName) || '?');
      const lastActiveAt = user.lastActiveAt || '';
      result.push({
        userId,
        displayName,
        initial,
        lastActiveAt,
      });
      seen.add(userId);
    });

    return result.sort((a, b) => {
      const aTime = a.lastActiveAt ? Date.parse(a.lastActiveAt) : 0;
      const bTime = b.lastActiveAt ? Date.parse(b.lastActiveAt) : 0;
      return aTime - bTime;
    });
  },

  renderPresence() {
    if (!this.presenceStack) return;
    const currentUser = this.getCurrentUserProfile();
    const maxVisible = Math.max(2, this.presenceMaxVisible);
    const maxOthers = maxVisible - 1;
    let visibleOthers = this.state.activeUsers.slice(0, maxOthers);
    let extraCount = this.state.activeUsers.length - maxOthers;

    if (extraCount > 0) {
      visibleOthers = this.state.activeUsers.slice(0, Math.max(1, maxOthers - 1));
      extraCount = this.state.activeUsers.length - visibleOthers.length;
    } else {
      extraCount = 0;
    }

    const displayUsers = [...visibleOthers];
    if (extraCount > 0) {
      displayUsers.push({ type: 'more', count: extraCount });
    }
    displayUsers.push({ ...currentUser, isMe: true });

    const fragment = document.createDocumentFragment();
    displayUsers.forEach((user, index) => {
      const isMore = user.type === 'more';
      const element = document.createElement(isMore ? 'div' : 'button');
      element.className = `profile-chip presence-avatar${isMore ? ' is-more' : ''}${user.isMe ? ' is-me' : ''}`;
      element.style.zIndex = String(index + 1);

      if (isMore) {
        element.textContent = `+${user.count}`;
        element.title = `${user.count} more collaborators`;
      } else {
        element.textContent = user.initial || '?';
        element.title = user.displayName || 'User';
        element.style.background = this.getAvatarGradient(user.userId, user.isMe);
      }

      if (element.tagName === 'BUTTON') {
        element.type = 'button';
        element.setAttribute('aria-label', element.title);
      }

      fragment.appendChild(element);
    });

    this.presenceStack.innerHTML = '';
    this.presenceStack.appendChild(fragment);
  },

  getCurrentUserProfile() {
    const payload = Auth.token ? parseJwt(Auth.token) : null;
    const userId = payload && payload.sub ? String(payload.sub) : 'me';
    const email = payload && payload.email ? String(payload.email) : '';
    const username = payload && (payload['cognito:username'] || payload.username)
      ? String(payload['cognito:username'] || payload.username)
      : '';
    const displayName = email || username || `User ${userId.slice(-4)}`;
    const initial = this.getInitials(displayName);

    return { userId, displayName, initial };
  },

  getAvatarGradient(userId, isMe) {
    if (isMe) {
      return 'linear-gradient(135deg, #8B5CF6, #EC4899)';
    }
    const gradients = [
      'linear-gradient(135deg, #22A47F, #6EE7B7)',
      'linear-gradient(135deg, #60A5FA, #38BDF8)',
      'linear-gradient(135deg, #F59E0B, #FBBF24)',
      'linear-gradient(135deg, #F472B6, #FB7185)',
      'linear-gradient(135deg, #A5B4FC, #818CF8)',
    ];
    let hash = 0;
    for (let i = 0; i < userId.length; i += 1) {
      hash = (hash * 31 + userId.charCodeAt(i)) % gradients.length;
    }
    return gradients[hash];
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  await Auth.ensureAuth();
  Canvas.init();
});
