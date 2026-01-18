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

  joinCanvas(code) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.joinCanvas) {
      return window.glassBox.api.joinCanvas(token, code);
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
  state: {
    canvases: [],
    myCanvases: [],
    sharedCanvases: [],
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
    isJoiningCanvas: false,
    isShowingCode: false,
    createCanvasError: null,
    joinCanvasError: null,
    canvasesError: null,
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
    this.canvasLoading = document.getElementById('canvasLoading');
    this.canvasActions = document.querySelector('.canvas-actions');
    this.canvasCreateToggle = document.getElementById('canvasCreateToggle');
    this.canvasCreateForm = document.getElementById('canvasCreateForm');
    this.canvasCreateInput = document.getElementById('canvasCreateInput');
    this.canvasCreateSubmit = document.getElementById('canvasCreateSubmit');
    this.canvasCreateCancel = document.getElementById('canvasCreateCancel');
    this.canvasCreateError = document.getElementById('canvasCreateError');
    this.canvasJoinToggle = document.getElementById('canvasJoinToggle');
    this.canvasJoinForm = document.getElementById('canvasJoinForm');
    this.canvasJoinInput = document.getElementById('canvasJoinInput');
    this.canvasJoinSubmit = document.getElementById('canvasJoinSubmit');
    this.canvasJoinCancel = document.getElementById('canvasJoinCancel');
    this.canvasJoinError = document.getElementById('canvasJoinError');
    this.canvasCode = document.getElementById('canvasCode');
    this.canvasCodeToggle = document.getElementById('canvasCodeToggle');
    this.canvasCodePanel = document.getElementById('canvasCodePanel');
    this.canvasCodeValue = document.getElementById('canvasCodeValue');
    this.canvasCodeHint = document.getElementById('canvasCodeHint');

    if (this.canvasCodePanel) {
      this.canvasCodePanel.hidden = true;
      this.state.isShowingCode = false;
    }

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

    this.canvasJoinToggle.addEventListener('click', () => {
      this.openJoinCanvas();
    });

    this.canvasJoinSubmit.addEventListener('click', () => {
      this.submitJoinCanvas();
    });

    this.canvasJoinCancel.addEventListener('click', () => {
      this.closeJoinCanvas();
    });

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

    if (this.canvasCodeToggle) {
      this.canvasCodeToggle.addEventListener('click', () => {
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
    });

    window.addEventListener('beforeunload', () => {
      this.stopPolling();
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
  },

  renderCanvasSection(title, canvases, emptyMessage) {
    let items = canvases.map(canvas => {
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

    if (!items) {
      items = `<div class="canvas-list-message">${this.escapeHtml(emptyMessage)}</div>`;
    }

    return `
      <div class="canvas-list-section">
        <div class="canvas-list-header">${this.escapeHtml(title)}</div>
        <div class="canvas-list-group">
          ${items}
        </div>
      </div>
    `;
  },

  async loadCanvases() {
    this.state.isLoadingCanvases = true;
    this.state.canvasesError = null;
    this.renderSidebar();

    try {
      const canvases = await Api.listCanvases();
      const currentSub = this.getCurrentUserSub();
      const normalized = (canvases || []).map(canvas => ({
        id: canvas.canvasId,
        name: canvas.name || 'Untitled Canvas',
        joinedAt: this.normalizeIsoTimestamp(canvas.joinedAt || canvas.createdAt || ''),
        ownerSub: canvas.ownerSub || '',
        joinCode: canvas.joinCode || '',
        isShared: !!(currentSub && canvas.ownerSub && canvas.ownerSub !== currentSub),
      }));

      normalized.sort((a, b) => (b.joinedAt || '').localeCompare(a.joinedAt || ''));
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
    return payload && payload.sub ? payload.sub : '';
  },

  async selectCanvas(canvasId) {
    if (!canvasId || this.state.selectedCanvasId === canvasId) {
      return;
    }
    this.stopPolling();
    this.state.selectedCanvasId = canvasId;
    this.currentPath = [];
    this.renderSidebar();
    this.updateBreadcrumb();
    this.setActiveUsers([]);
    this.closeCodePanel();
    this.updateCodePanel();
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
      this.renderNodes(this.getRootNodes());
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

  openCreateCanvas() {
    if (this.state.isCreatingCanvas) {
      this.closeCreateCanvas();
      return;
    }
    if (this.state.isJoiningCanvas) {
      this.closeJoinCanvas();
    }
    this.state.isCreatingCanvas = true;
    this.canvasCreateForm.classList.add('is-open');
    if (this.canvasCreateToggle) {
      this.canvasCreateToggle.classList.add('is-active');
    }
    if (this.canvasJoinToggle) {
      this.canvasJoinToggle.classList.remove('is-active');
    }
    this.canvasCreateError.textContent = '';
    this.canvasCreateInput.value = '';
    this.canvasCreateInput.focus();
  },

  closeCreateCanvas() {
    this.state.isCreatingCanvas = false;
    this.canvasCreateForm.classList.remove('is-open');
    if (this.canvasCreateToggle) {
      this.canvasCreateToggle.classList.remove('is-active');
    }
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
        joinedAt: this.normalizeIsoTimestamp(new Date().toISOString()),
        ownerSub: this.getCurrentUserSub(),
        joinCode: created.joinCode || '',
        isShared: false,
      };
      this.state.canvases = [canvas, ...this.state.canvases];
      this.partitionCanvases();
      this.closeCreateCanvas();
      this.renderSidebar();
      this.selectCanvas(canvas.id);
    } catch (error) {
      this.canvasCreateError.textContent = error.message || 'Failed to create canvas.';
    } finally {
      this.canvasCreateSubmit.disabled = false;
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
    this.canvasJoinForm.classList.add('is-open');
    if (this.canvasJoinToggle) {
      this.canvasJoinToggle.classList.add('is-active');
    }
    if (this.canvasCreateToggle) {
      this.canvasCreateToggle.classList.remove('is-active');
    }
    this.canvasJoinError.textContent = '';
    this.canvasJoinInput.value = '';
    this.canvasJoinInput.focus();
  },

  closeJoinCanvas() {
    this.state.isJoiningCanvas = false;
    this.canvasJoinForm.classList.remove('is-open');
    if (this.canvasJoinToggle) {
      this.canvasJoinToggle.classList.remove('is-active');
    }
    this.canvasJoinError.textContent = '';
    this.canvasJoinInput.value = '';
  },

  async submitJoinCanvas() {
    if (!this.state.isJoiningCanvas) {
      this.openJoinCanvas();
      return;
    }

    const rawCode = this.canvasJoinInput.value.trim().toUpperCase();
    if (!rawCode) {
      this.canvasJoinError.textContent = 'Join code cannot be empty.';
      return;
    }

    if (!/^[A-Z0-9]{8,10}$/.test(rawCode)) {
      this.canvasJoinError.textContent = 'Enter a valid join code.';
      return;
    }

    this.canvasJoinError.textContent = '';
    this.canvasJoinSubmit.disabled = true;

    try {
      const joined = await Api.joinCanvas(rawCode);
      const existing = this.state.canvases.find((canvas) => canvas.id === joined.canvasId);
      if (!existing) {
        const canvas = {
          id: joined.canvasId,
          name: joined.name || 'Untitled Canvas',
          joinedAt: this.normalizeIsoTimestamp(new Date().toISOString()),
          ownerSub: '',
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
      if (message.toLowerCase().includes('not found')) {
        this.canvasJoinError.textContent = 'Invalid code.';
      } else if (message.toLowerCase().includes('already')) {
        this.canvasJoinError.textContent = 'Already joined.';
      } else {
        this.canvasJoinError.textContent = message;
      }
    } finally {
      this.canvasJoinSubmit.disabled = false;
    }
  },

  setCanvasLoading(isLoading) {
    if (this.canvasLoading) {
      this.canvasLoading.hidden = !isLoading;
      this.canvasLoading.style.display = isLoading ? 'flex' : 'none';
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
    const selectedCanvas = this.getCanvasById(this.state.selectedCanvasId);

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
  },

  startPolling() {
    this.stopPolling();
    if (!this.state.selectedCanvasId || !Api.getAuthToken()) {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.pollNodes();
    }, this.pollIntervalMs);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
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
      const payload = await Api.listNodes(canvasId, updatedSince);
      const { nodes, activeUsers } = this.normalizeNodesPayload(payload);
      this.setActiveUsers(activeUsers);
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return;
      }
      const normalized = (nodes || []).map(node => this.normalizeNodeFromApi(node));
      const latestUpdate = this.getLatestUpdatedAt(normalized);
      this.applyNodeUpdates(normalized);
      if (latestUpdate) {
        this.state.lastSyncByCanvas[canvasId] = latestUpdate;
      }
    } catch (error) {
      console.warn('[Canvas] Polling failed', error);
    } finally {
      this.pollInFlight = false;
    }
  },

  applyNodeUpdates(incomingNodes) {
    if (!incomingNodes || incomingNodes.length === 0) {
      return;
    }

    const prevView = this.getViewContext();
    const renderedById = new Map(this.nodes.map(node => [node.data.id, node]));
    const removedIds = new Set();
    const updatedIds = new Set();
    const newNodes = [];

    incomingNodes.forEach((incoming) => {
      if (incoming.deletedAt) {
        removedIds.add(incoming.id);
        this.state.nodes = this.state.nodes.filter(node => node.id !== incoming.id);
        return;
      }

      const existing = this.state.nodesById[incoming.id];
      if (existing) {
        this.updateNodeData(existing, incoming);
        updatedIds.add(incoming.id);
        return;
      }

      this.state.nodes.push(incoming);
      newNodes.push(incoming);
    });

    this.buildNodeIndex();
    this.syncCurrentPath();

    const nextView = this.getViewContext();
    const viewChanged =
      prevView.mode !== nextView.mode ||
      prevView.parentId !== nextView.parentId ||
      prevView.nodeId !== nextView.nodeId;

    if (viewChanged) {
      this.renderNodes(this.getCurrentViewNodes());
      this.updateBreadcrumb();
      return;
    }

    removedIds.forEach((id) => {
      const rendered = renderedById.get(id);
      if (rendered) {
        rendered.element.remove();
        this.nodes = this.nodes.filter(node => node.data.id !== id);
      }
    });

    updatedIds.forEach((id) => {
      const rendered = renderedById.get(id);
      if (rendered) {
        this.updateNodeElement(rendered);
      }
    });

    newNodes.forEach((node) => {
      if (this.isNodeVisibleInView(node, nextView)) {
        const entry = this.createNodeElement(node, this.nodes.length);
        this.nodes.push(entry);
        this.canvas.appendChild(entry.element);
      }
    });

    this.updateBreadcrumb();
  },

  updateNodeData(target, source) {
    Object.keys(source).forEach((key) => {
      target[key] = source[key];
    });
  },

  getViewContext() {
    if (this.currentPath.length === 0) {
      return { mode: 'children', parentId: null, nodeId: null };
    }

    const current = this.currentPath[this.currentPath.length - 1];
    const children = this.getChildNodes(current.id);
    if (children.length > 0) {
      return { mode: 'children', parentId: current.id, nodeId: null };
    }
    return { mode: 'single', parentId: null, nodeId: current.id };
  },

  getCurrentViewNodes() {
    const view = this.getViewContext();
    if (view.mode === 'children') {
      return this.getChildNodes(view.parentId);
    }
    const node = this.getNode(view.nodeId);
    return node ? [node] : [];
  },

  isNodeVisibleInView(node, view) {
    if (!node || !view) return false;
    if (view.mode === 'children') {
      return node.parent === view.parentId;
    }
    return node.id === view.nodeId;
  },

  syncCurrentPath() {
    if (this.currentPath.length === 0) return;
    const updatedPath = [];
    for (const node of this.currentPath) {
      const updated = this.state.nodesById[node.id];
      if (!updated) {
        this.currentPath = [];
        return;
      }
      updatedPath.push(updated);
    }
    this.currentPath = updatedPath;
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

    element.innerHTML = this.getNodeInnerHtml(nodeData);

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

  getNodeInnerHtml(nodeData) {
    const evidenceCount = nodeData.evidence?.length || 0;
    const statusLabel = this.getStatusLabel(nodeData.status);
    const statusClass = this.getStatusClass(nodeData.status);
    const createdLabel = nodeData.createdAt ? this.formatTimestamp(nodeData.createdAt) : '--';

    return `
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
  },

  updateNodeElement(nodeEntry) {
    if (!nodeEntry || !nodeEntry.element) return;
    nodeEntry.element.innerHTML = this.getNodeInnerHtml(nodeEntry.data);
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
    const selectedCanvas = this.getCanvasById(this.state.selectedCanvasId);
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

  getCanvasById(canvasId) {
    if (!canvasId) return null;
    return this.state.canvases.find((canvas) => canvas.id === canvasId) || null;
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
      createdAt: this.normalizeIsoTimestamp(node.createdAt || ''),
      updatedAt: this.normalizeIsoTimestamp(node.updatedAt || ''),
      deletedAt: node.deletedAt || '',
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
    this.renderPresence();
  }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  await Auth.ensureAuth();
  Canvas.init();
});
