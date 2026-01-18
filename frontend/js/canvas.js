/**
 * Glass Box - Canvas with Draggable Nodes
 * Pure vanilla JavaScript - no build step required
 */

const Auth = {
  token: null,
  refreshToken: null,
  tokenExpiresAt: null,
  refreshTimer: null,

  getStoredToken() {
    return localStorage.getItem('glassbox.authToken');
  },
  setStoredToken(token) {
    localStorage.setItem('glassbox.authToken', token);
  },
  getStoredRefreshToken() {
    return localStorage.getItem('glassbox.refreshToken');
  },
  setStoredRefreshToken(refreshToken) {
    if (refreshToken) {
      localStorage.setItem('glassbox.refreshToken', refreshToken);
    }
  },
  getStoredTokenExpiry() {
    const raw = localStorage.getItem('glassbox.tokenExpiresAt');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  },
  setStoredTokenExpiry(expiresAt) {
    if (expiresAt) {
      localStorage.setItem('glassbox.tokenExpiresAt', String(expiresAt));
    }
  },
  clearStoredAuth() {
    localStorage.removeItem('glassbox.authToken');
    localStorage.removeItem('glassbox.refreshToken');
    localStorage.removeItem('glassbox.tokenExpiresAt');
  },
  getRefreshToken() {
    return this.refreshToken || this.getStoredRefreshToken();
  },
  normalizeAuthResponse(response) {
    if (!response) return null;
    if (typeof response === 'string') {
      return { idToken: response };
    }
    if (typeof response === 'object') {
      return {
        idToken: response.idToken || response.id_token || response.token || '',
        refreshToken: response.refreshToken || response.refresh_token || '',
        expiresIn: response.expiresIn || response.expires_in || null,
      };
    }
    return null;
  },
  deriveExpiresAt(token, expiresIn) {
    const payload = token ? parseJwt(token) : null;
    if (payload && typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
    const numericExpiresIn = typeof expiresIn === 'string' ? Number(expiresIn) : expiresIn;
    if (typeof numericExpiresIn === 'number' && Number.isFinite(numericExpiresIn)) {
      return Date.now() + numericExpiresIn * 1000;
    }
    return null;
  },
  isTokenFresh(expiresAt) {
    if (!expiresAt) {
      return true;
    }
    const now = Date.now();
    return now < expiresAt - 60 * 1000;
  },
  scheduleRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (!this.refreshToken || !this.tokenExpiresAt) {
      return;
    }
    const now = Date.now();
    const refreshAt = this.tokenExpiresAt - 5 * 60 * 1000;
    const delay = Math.max(refreshAt - now, 30 * 1000);
    if (delay <= 0) {
      this.refreshAuth().catch(() => {});
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshAuth().catch(() => {});
    }, delay);
  },
  async refreshAuth() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return false;
    }
    if (!window.glassBox || !window.glassBox.refreshAuth) {
      console.warn('Refresh bridge not available. Cannot refresh token.');
      return false;
    }
    try {
      const response = await window.glassBox.refreshAuth(refreshToken);
      const normalized = this.normalizeAuthResponse(response);
      if (!normalized?.idToken) {
        throw new Error('Missing idToken in refresh response');
      }
      const expiresAt = this.deriveExpiresAt(normalized.idToken, normalized.expiresIn);
      const nextRefreshToken = normalized.refreshToken || refreshToken;
      this.setStoredToken(normalized.idToken);
      this.setStoredRefreshToken(nextRefreshToken);
      if (expiresAt) {
        this.setStoredTokenExpiry(expiresAt);
      }
      this.token = normalized.idToken;
      this.refreshToken = nextRefreshToken;
      this.tokenExpiresAt = expiresAt;
      this.scheduleRefresh();
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  },

  async ensureAuth() {
    const existing = this.getStoredToken();
    const refreshToken = this.getStoredRefreshToken();
    const storedExpiresAt = this.getStoredTokenExpiry();
    const inferredExpiresAt = existing
      ? storedExpiresAt || this.deriveExpiresAt(existing, null)
      : null;
    if (existing && this.isTokenFresh(inferredExpiresAt)) {
      this.token = existing;
      this.refreshToken = refreshToken;
      this.tokenExpiresAt = inferredExpiresAt;
      if (inferredExpiresAt && !storedExpiresAt) {
        this.setStoredTokenExpiry(inferredExpiresAt);
      }
      this.scheduleRefresh();
      return;
    }

    if (refreshToken) {
      const refreshed = await this.refreshAuth();
      if (refreshed) {
        return;
      }
    }

    if (!window.glassBox || !window.glassBox.startAuth) {
      console.warn('Auth bridge not available. Cannot start Hosted UI login.');
      return;
    }

    try {
      const response = await window.glassBox.startAuth();
      const normalized = this.normalizeAuthResponse(response);
      if (normalized?.idToken) {
        const expiresAtNext = this.deriveExpiresAt(normalized.idToken, normalized.expiresIn);
        this.setStoredToken(normalized.idToken);
        if (normalized.refreshToken) {
          this.setStoredRefreshToken(normalized.refreshToken);
        }
        if (expiresAtNext) {
          this.setStoredTokenExpiry(expiresAtNext);
        }
        this.token = normalized.idToken;
        this.refreshToken = normalized.refreshToken || refreshToken;
        this.tokenExpiresAt = expiresAtNext;
        this.scheduleRefresh();
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

  getCanvasEvidence(canvasId) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.getCanvasEvidence) {
      return window.glassBox.api.getCanvasEvidence(token, canvasId);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  updateCanvasEvidence(canvasId, evidence) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.updateCanvasEvidence) {
      return window.glassBox.api.updateCanvasEvidence(token, canvasId, evidence);
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

  joinCanvas(joinCode) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.joinCanvas) {
      return window.glassBox.api.joinCanvas(token, joinCode);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  presignFile(payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.presignFile) {
      return window.glassBox.api.presignFile(token, payload);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  completeFile(payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.completeFile) {
      return window.glassBox.api.completeFile(token, payload);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  downloadFile(payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.downloadFile) {
      return window.glassBox.api.downloadFile(token, payload);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  executeNode(nodeId, payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.executeNode) {
      const refreshToken = Auth.getRefreshToken();
      const body = { ...(payload || {}) };
      if (refreshToken) {
        body.refreshToken = refreshToken;
      }
      return window.glassBox.api.executeNode(token, nodeId, body);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  approveNodeAction(nodeId, payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.approveNodeAction) {
      return window.glassBox.api.approveNodeAction(token, nodeId, payload);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  leavePresence(canvasId) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.leavePresence) {
      return window.glassBox.api.leavePresence(token, canvasId);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },

  startGatewayStream(payload) {
    const token = this.getAuthToken();
    if (window.glassBox?.api?.startGatewayStream) {
      return window.glassBox.api.startGatewayStream({ token, ...payload });
    }
    return Promise.resolve(null);
  },

  stopGatewayStream(payload) {
    if (window.glassBox?.api?.stopGatewayStream) {
      return window.glassBox.api.stopGatewayStream(payload);
    }
    return Promise.resolve(null);
  },

  onGatewayStreamEvent(handler) {
    if (window.glassBox?.api?.onGatewayStreamEvent) {
      window.glassBox.api.onGatewayStreamEvent(handler);
    }
  },

  onGatewayStreamError(handler) {
    if (window.glassBox?.api?.onGatewayStreamError) {
      window.glassBox.api.onGatewayStreamError(handler);
    }
  },

  uploadToS3(url, contentType, data) {
    if (window.glassBox?.api?.uploadToS3) {
      return window.glassBox.api.uploadToS3(url, contentType, data);
    }
    return Promise.reject(new Error('API bridge unavailable'));
  },
};

const DEFAULT_AGENT_ID = 'GlassBoxOrchestrator';
const DEFAULT_AGENT_LABEL = 'Orchestrator';

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
  delegatePopover: null,
  activeDelegateNodeId: null,
  approvalPopover: null,
  activeApprovalNodeId: null,
  activeGatewayStreams: new Set(),
  state: {
    canvases: [],
    selectedCanvasId: null,
    nodes: [],
    nodesById: {},
    childrenByParent: {},
    lastSyncByCanvas: {},
    activeUsers: [],
    activeUsersKey: '',
    canvasEvidenceById: {},
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
  positionSyncInFlight: false,
  pendingPositionUpdates: new Map(),
  presenceMaxVisible: 5,
  pendingNodePosition: null,
  canvasEvidenceRequests: {},

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
    this.evidenceSidebar = document.getElementById('evidenceSidebar');
    this.evidenceList = document.getElementById('evidenceList');
    this.evidenceDropZone = document.getElementById('evidenceDropZone');
    this.evidenceNoteInput = document.getElementById('evidenceNoteInput');
    this.evidenceNoteSubmit = document.getElementById('evidenceNoteSubmit');
    this.evidenceEmpty = document.getElementById('evidenceEmpty');
    this.evidenceSubtitle = document.getElementById('evidenceSubtitle');

    this.setupEventListeners();
    this.setupEvidenceListeners();
    this.setupGlobalIconPopover();
    this.setupGlobalUserPicker();
    this.setupGlobalDelegatePopover();
    this.setupGlobalApprovalPopover();
    this.registerGatewayStreamHandlers();
    this.updateProfile();
    this.renderSidebar();
    this.updateBreadcrumb();
    this.loadCanvases();
  },

  startPolling() {
    this.stopPolling();
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  },

  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollInFlight = false; // Reset flight status
  },

  async poll() {
    // Strict check: if editing, do absolutely nothing.
    if (this.isNodeFieldEditing) {
      return;
    }

    const canvasId = this.state.selectedCanvasId;
    if (!canvasId || this.state.isLoadingNodes || this.pollInFlight) {
      return;
    }

    this.pollInFlight = true;
    const lastSync = this.state.lastSyncByCanvas[canvasId];

    try {
      const payload = await Api.listNodes(canvasId, lastSync);
      const { nodes, activeUsers } = this.normalizeNodesPayload(payload);
      
      // Update active users regardless of nodes
      this.setActiveUsers(activeUsers);

      if (nodes && nodes.length > 0) {
        // Merge updates
        const updates = nodes.filter(n => !n.deletedAt).map(n => this.normalizeNodeFromApi(n));
        const deletedIds = nodes.filter(n => n.deletedAt).map(n => n.nodeId);

        if (deletedIds.length > 0) {
          this.removeNodesFromState(deletedIds);
        }

        updates.forEach(updatedNode => {
           this.applyNodeUpdates(updatedNode.id, updatedNode, this.state.nodesById[updatedNode.id]);
           if (!this.state.nodesById[updatedNode.id]) {
             // New node
             this.state.nodes = [updatedNode, ...this.state.nodes];
           }
        });

        if (updates.length > 0 || deletedIds.length > 0) {
          this.buildNodeIndex();
          this.refreshCurrentView();
          
          // Update lastSync timestamp
          const latest = this.getLatestUpdatedAt(updates);
          if (latest) {
             this.state.lastSyncByCanvas[canvasId] = latest;
          }
        }
      }
    } catch (error) {
      console.warn('[Canvas] Poll failed', error);
    } finally {
      this.pollInFlight = false;
    }
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

  setupEvidenceListeners() {
    if (this.evidenceDropZone) {
      this.evidenceDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.evidenceDropZone.classList.add('drag-over');
      });
      this.evidenceDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.evidenceDropZone.classList.remove('drag-over');
      });
      this.evidenceDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.evidenceDropZone.classList.remove('drag-over');
        this.handleEvidenceDrop(e);
      });
    }

    if (this.evidenceNoteSubmit) {
      this.evidenceNoteSubmit.addEventListener('click', () => this.submitEvidenceNote());
    }
    if (this.evidenceNoteInput) {
      this.evidenceNoteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.submitEvidenceNote();
        }
      });
    }

    if (this.evidenceList) {
      this.evidenceList.addEventListener('click', (e) => {
        const linkItem = e.target.closest('.evidence-item[data-link-url]');
        if (linkItem) {
          const url = linkItem.dataset.linkUrl ? decodeURIComponent(linkItem.dataset.linkUrl) : '';
          if (url) {
            window.open(url, '_blank', 'noopener');
          }
          return;
        }

        const nodeItem = e.target.closest('.evidence-item[data-node-id]');
        if (nodeItem) {
          const nodeId = nodeItem.dataset.nodeId || '';
          const node = this.getNode(nodeId);
          if (node) {
            this.navigateIntoNode(node);
          }
          return;
        }

        const fileItem = e.target.closest('.evidence-item[data-file-id], .evidence-item[data-s3-key]');
        if (fileItem) {
          const fileId = fileItem.dataset.fileId || '';
          const s3Key = fileItem.dataset.s3Key || '';
          const context = this.getEvidenceContext();
          if (context.scope === 'canvas') {
            this.downloadCanvasFile({ fileId, s3Key });
          } else if (context.scope === 'node' && context.node) {
            this.downloadNodeFile(context.node, { fileId, s3Key });
          }
          return;
        }
      });

      this.evidenceList.addEventListener('focusin', (e) => {
        const note = e.target.closest('.evidence-note');
        if (!note) return;
        note.dataset.originalValue = note.textContent.trim();
      });

      this.evidenceList.addEventListener('keydown', (e) => {
        const note = e.target.closest('.evidence-note');
        if (!note) return;
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          note.blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          const original = note.dataset.originalValue || '';
          note.textContent = original;
          note.blur();
        }
      });

      this.evidenceList.addEventListener('focusout', (e) => {
        const note = e.target.closest('.evidence-note');
        if (!note) return;
        this.commitEvidenceNoteEdit(note);
      });
    }
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

    this.pendingNodePosition = { x, y };
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
    this.pendingNodePosition = null;
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
    if (this.pendingNodePosition) {
      payload.x = this.pendingNodePosition.x;
      payload.y = this.pendingNodePosition.y;
    }

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
      if (this.pendingNodePosition && !Number.isFinite(normalized.x) && !Number.isFinite(normalized.y)) {
        normalized.x = this.pendingNodePosition.x;
        normalized.y = this.pendingNodePosition.y;
      }
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
      this.updateEvidenceSidebar();
      return;
    }

    const currentNodeId = this.currentPath[this.currentPath.length - 1]?.id;
    const canonicalNode = currentNodeId ? this.getNode(currentNodeId) : null;
    if (!canonicalNode) {
      this.renderNodes([]);
      this.updateBreadcrumb();
      this.updateEvidenceSidebar();
      return;
    }

    const children = this.getChildNodes(currentNodeId);
    if (children.length > 0) {
      this.renderNodes(children);
    } else {
      this.renderNodes([]);
    }
    this.updateBreadcrumb();
    this.updateEvidenceSidebar();
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
        this.updateEvidenceSidebar();
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
    const previousCanvasId = this.state.selectedCanvasId;
    this.stopPolling();
    this.stopAllGatewayStreams();
    this.pendingPositionUpdates.clear();
    this.positionSyncInFlight = false;
    if (previousCanvasId) {
      Api.leavePresence(previousCanvasId).catch((error) => {
        console.warn('[Canvas] Failed to leave presence', error);
      });
    }
    this.state.selectedCanvasId = canvasId;
    this.currentPath = [];
    this.hideNodeCreatePopover();
    this.hideNodeDeletePopover();
    this.setActiveUsers([]);
    this.renderSidebar();
    this.updateBreadcrumb();
    this.updateCodePanel(); // Critical update
    this.updateEvidenceSidebar();
    this.fetchCanvasEvidence(canvasId);
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
      normalized.forEach((node) => {
        if (node.activeTaskId || node.status === 'in-progress') {
          this.ensureGatewayStream(node.id);
        }
      });
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
    if (this.canvasJoinError) {
      this.canvasJoinError.textContent = '';
      this.canvasJoinError.classList.remove('text-success');
    }
  },

  async submitJoinCanvas() {
    const rawCode = this.canvasJoinInput ? this.canvasJoinInput.value.trim() : '';
    if (!rawCode) {
      if (this.canvasJoinError) this.canvasJoinError.textContent = 'Enter a code.';
      return;
    }

    if (this.canvasJoinSubmit) this.canvasJoinSubmit.disabled = true;
    if (this.canvasJoinError) {
      this.canvasJoinError.textContent = 'Joining...';
      this.canvasJoinError.classList.add('text-success');
    }

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
        this.canvasJoinError.classList.remove('text-success');
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
    console.log('[Canvas] toggleCodePanel called', this.state.isShowingCode);
    if (!this.canvasCodePanel) return;
    if (this.state.isShowingCode) {
      this.closeCodePanel();
    } else {
      this.openCodePanel();
    }
  },

  openCodePanel() {
    console.log('[Canvas] openCodePanel');
    if (!this.canvasCodePanel) return;
    this.updateCodePanel();
    this.canvasCodePanel.hidden = false;
    this.state.isShowingCode = true;
  },

  closeCodePanel() {
    console.log('[Canvas] closeCodePanel');
    if (!this.canvasCodePanel) return;
    this.canvasCodePanel.hidden = true;
    this.state.isShowingCode = false;
  },

  updateCodePanel() {
    console.log('[Canvas] updateCodePanel', this.state.selectedCanvasId);
    if (!this.canvasCodeToggle || !this.canvasCodeValue || !this.canvasCodeHint) return;
    const selectedCanvas = this.state.canvases.find(c => c.id === this.state.selectedCanvasId);
    console.log('[Canvas] selectedCanvas for code:', selectedCanvas);

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
    if (this.state.isJoiningCanvas) {
      this.closeJoinCanvas();
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
        ownerSub: this.getCurrentUserSub(),
        joinCode: created.joinCode,
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
    const hasStoredPosition = Number.isFinite(nodeData.x) && Number.isFinite(nodeData.y);
    const x = hasStoredPosition ? nodeData.x : 80 + col * 360;
    const y = hasStoredPosition ? nodeData.y : 80 + row * 260;
    if (!hasStoredPosition) {
      nodeData.x = x;
      nodeData.y = y;
    }

    element.style.transform = `translate(${x}px, ${y}px)`;

    const iconName = nodeData.icon || 'box';
    const inputs = nodeData.inputs || [];
    const outputs = nodeData.outputs || [];
    const evidenceFiles = Array.isArray(nodeData?.evidence?.files)
      ? nodeData.evidence.files.filter(item => !item.type || item.type === 'file')
      : [];
    // If no inputs (new node), showing some mocks provided by user request or keep empty
    // The user request said "drop in it... add a number of resources... dropdown to view"
    // So we start empty or with existing data.

    const fileCount = inputs.length + evidenceFiles.length;
    const outputCount = outputs.length;
    const layerCount = this.getChildNodes(nodeData.id)?.length || 0;

    element.innerHTML = `
      <div class="node-content">
        <!-- Header -->
        <div class="node-header">
          <button class="node-icon-trigger" aria-label="Change Icon">
            <i data-lucide="${this.escapeHtml(iconName)}"></i>
          </button>
          <h3 class="node-title">${this.escapeHtml(nodeData.name || 'Untitled')}</h3>
          <button class="node-nav-entry" aria-label="Enter Box">
            <i data-lucide="arrow-right"></i>
          </button>
        </div>
        
        <!-- Description -->
        <p class="node-description">${this.escapeHtml(nodeData.goal || 'Description')}</p>
        
        <!-- Drop Zone & Input Section -->
        <div class="node-input">
          <div class="node-input-header">
            <span class="input-icon"><i data-lucide="inbox"></i></span>
            <span class="input-title">Input (${fileCount})</span>
            <button class="input-list-toggle" aria-label="Toggle Inputs" ${fileCount === 0 ? 'disabled' : ''}>
               <i data-lucide="chevron-down"></i>
            </button>
          </div>
          
          <div class="input-list-container" style="display: none;">
             <div class="input-list">
                ${inputs.map((input) => {
                  const type = input.type || 'file';
                  const icon = type === 'text'
                    ? 'message-square'
                    : type === 'link'
                      ? 'link-2'
                      : type === 'node'
                        ? 'layers'
                        : (input.icon || 'file');
                  const label = type === 'text'
                    ? (input.text || 'Text')
                    : type === 'link'
                      ? (input.title || input.url || 'Link')
                      : type === 'node'
                        ? (input.nodeId || 'Node')
                        : (input.filename || input.name || 'File');
                  const dataAttrs = type === 'file'
                    ? `data-file-id="${this.escapeHtml(input.fileId || '')}" data-s3-key="${this.escapeHtml(input.s3Key || '')}"`
                    : type === 'link'
                      ? `data-link-url="${encodeURIComponent(input.url || '')}"`
                      : type === 'node'
                        ? `data-node-id="${this.escapeHtml(input.nodeId || '')}"`
                        : '';
                  return `
                    <div class="input-item" data-type="${this.escapeHtml(type)}" ${dataAttrs}>
                      <span class="input-item-icon"><i data-lucide="${this.escapeHtml(icon)}"></i></span>
                      <span class="input-item-text">${this.escapeHtml(label)}</span>
                    </div>
                  `;
                }).join('')}
                ${evidenceFiles.map(file => `
                  <div class="input-item" data-file-id="${this.escapeHtml(file.fileId || '')}" data-s3-key="${this.escapeHtml(file.s3Key || '')}">
                     <span class="input-item-icon"><i data-lucide="file"></i></span>
                     <span class="input-item-text">${this.escapeHtml(file.filename || file.name || 'File')}</span>
                  </div>
                `).join('')}
             </div>
          </div>

          <div class="drop-zone">
             <i data-lucide="upload-cloud"></i>
             <span>Drop files here</span>
          </div>
        </div>
        
        <!-- Stats Footer -->
        <div class="node-stats-footer">
          <div class="stat-item files">
            <span class="stat-item-icon">
              <i data-lucide="files"></i>
            </span>
            <span class="file-count-text">${fileCount}</span>
          </div>
          <div class="stat-item layers">
            <span class="stat-item-icon">
              <i data-lucide="layers"></i>
            </span>
            <span>${layerCount}</span>
          </div>
          
          <div class="node-assignee">
            <button class="assignee-button" aria-label="Assign User">
              <span class="assignee-initials" style="display: none;">JB</span>
              <i data-lucide="user-plus" class="assignee-icon"></i>
            </button>
          </div>
        </div>

        <div class="node-actions">
          <button class="delegate-button" type="button">Delegate</button>
          <button class="approval-button" type="button">Approvals</button>
        </div>

        <!-- Start Output Toggle -->
        <button class="node-footer-toggle" aria-label="Toggle Output">
          <span class="adjust-text">Output</span>
          <i data-lucide="chevron-down"></i>
        </button>

        <!-- Output Section -->
        <div class="node-output">
          <div class="node-output-header">
            <span class="output-icon"><i data-lucide="layers"></i></span>
            <span class="output-title">Output (${outputCount})</span>
            <button class="output-list-toggle" aria-label="Toggle Outputs" ${outputCount === 0 ? 'disabled' : ''}>
              <i data-lucide="chevron-down"></i>
            </button>
          </div>
          <div class="output-list-container" style="display: none;">
            <div class="output-list">
              ${outputs.map((output) => {
                const type = output.type || 'file';
                const icon = type === 'text'
                  ? 'message-square'
                  : type === 'link'
                    ? 'link-2'
                    : type === 'node'
                      ? 'layers'
                      : 'file';
                const label = type === 'text'
                  ? (output.text || 'Text')
                  : type === 'link'
                    ? (output.title || output.url || 'Link')
                    : type === 'node'
                      ? (output.nodeId || 'Node')
                      : (output.filename || output.name || 'File');
                const dataAttrs = type === 'file'
                  ? `data-file-id="${this.escapeHtml(output.fileId || '')}" data-s3-key="${this.escapeHtml(output.s3Key || '')}"`
                  : type === 'link'
                    ? `data-link-url="${encodeURIComponent(output.url || '')}"`
                    : type === 'node'
                      ? `data-node-id="${this.escapeHtml(output.nodeId || '')}"`
                      : '';
                return `
                  <div class="input-item" data-type="${this.escapeHtml(type)}" ${dataAttrs}>
                    <span class="input-item-icon"><i data-lucide="${this.escapeHtml(icon)}"></i></span>
                    <span class="input-item-text">${this.escapeHtml(label)}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
          <div class="drop-zone output-drop-zone">
            <i data-lucide="upload-cloud"></i>
            <span>Drop files here</span>
          </div>
        </div>
      </div>
    `;

    this.attachNodeEditing(element, nodeData);
    this.applyAssigneeDisplay(nodeData, element);
    this.applyApprovalState(nodeData, element);

    // --- Event Listeners for New Features ---

    // 1. Icon Trigger
    const iconBtn = element.querySelector('.node-icon-trigger');
    if (iconBtn) {
       console.log('Attaching icon listener');
       iconBtn.addEventListener('mousedown', (e) => e.stopPropagation());
       iconBtn.addEventListener('click', (e) => {
         e.stopPropagation();
         e.preventDefault();
         this.toggleIconPicker(e, nodeData, iconBtn);
       });
    }

    // 2. Navigation Arrow
    const navBtn = element.querySelector('.node-nav-entry');
    if (navBtn) {
       navBtn.addEventListener('mousedown', (e) => e.stopPropagation());
       navBtn.addEventListener('click', (e) => {
         e.stopPropagation();
         this.navigateIntoNode(nodeData);
       });
       navBtn.addEventListener('dblclick', (e) => e.stopPropagation());
    }

    // 3. Drop Zone
    const dropZone = element.querySelector('.drop-zone');
    const inputListContainer = element.querySelector('.input-list-container');
    const inputList = element.querySelector('.input-list');
    const inputToggle = element.querySelector('.input-list-toggle');
    const inputTitle = element.querySelector('.input-title');
    const fileCountText = element.querySelector('.file-count-text');
    const outputListContainer = element.querySelector('.output-list-container');
    const outputList = element.querySelector('.output-list');
    const outputToggle = element.querySelector('.output-list-toggle');
    const outputTitle = element.querySelector('.output-title');
    const outputDropZone = element.querySelector('.output-drop-zone');

    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
      });
      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        this.handleNodeDrop(e, nodeData, inputList, inputToggle, inputTitle, fileCountText, 'inputs');
      });
       // Prevent drag start on the drop zone itself from moving the node
       dropZone.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    // 4. Input Toggle
    if (inputToggle) {
       inputToggle.addEventListener('mousedown', (e) => e.stopPropagation());
       inputToggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const isHidden = inputListContainer.style.display === 'none';
          inputListContainer.style.display = isHidden ? 'block' : 'none';
          inputToggle.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
       });
    }

    if (inputListContainer) {
      inputListContainer.addEventListener('click', (e) => {
        const item = e.target.closest('.input-item');
        if (!item) return;
        const type = item.dataset.type || 'file';
        if (type === 'file') {
          const fileId = item.dataset.fileId || '';
          const s3Key = item.dataset.s3Key || '';
          this.downloadNodeFile(nodeData, { fileId, s3Key });
          return;
        }
        if (type === 'link') {
          const url = item.dataset.linkUrl ? decodeURIComponent(item.dataset.linkUrl) : '';
          if (url) {
            window.open(url, '_blank', 'noopener');
          }
          return;
        }
        if (type === 'node') {
          const nodeId = item.dataset.nodeId || '';
          const target = this.getNode(nodeId);
          if (target) {
            this.navigateIntoNode(target);
          }
        }
      });
    }

    if (outputDropZone) {
      outputDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        outputDropZone.classList.add('drag-over');
      });
      outputDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        outputDropZone.classList.remove('drag-over');
      });
      outputDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        outputDropZone.classList.remove('drag-over');
        this.handleNodeDrop(e, nodeData, outputList, outputToggle, outputTitle, null, 'outputs');
      });
      outputDropZone.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    if (outputToggle && outputListContainer) {
      outputToggle.addEventListener('mousedown', (e) => e.stopPropagation());
      outputToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isHidden = outputListContainer.style.display === 'none';
        outputListContainer.style.display = isHidden ? 'block' : 'none';
        outputToggle.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
      });
    }

    if (outputList) {
      outputList.addEventListener('click', (e) => {
        const item = e.target.closest('.input-item');
        if (!item) return;
        const type = item.dataset.type || 'file';
        if (type === 'file') {
          const fileId = item.dataset.fileId || '';
          const s3Key = item.dataset.s3Key || '';
          this.downloadNodeFile(nodeData, { fileId, s3Key });
          return;
        }
        if (type === 'link') {
          const url = item.dataset.linkUrl ? decodeURIComponent(item.dataset.linkUrl) : '';
          if (url) {
            window.open(url, '_blank', 'noopener');
          }
          return;
        }
        if (type === 'node') {
          const nodeId = item.dataset.nodeId || '';
          const target = this.getNode(nodeId);
          if (target) {
            this.navigateIntoNode(target);
          }
        }
      });
    }



    // 5. Assignee Toggle
    const assigneeBtn = element.querySelector('.assignee-button');
    if (assigneeBtn) {
       assigneeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
       assigneeBtn.addEventListener('click', (e) => {
         e.stopPropagation();
         e.preventDefault();
         this.toggleUserPicker(e, nodeData, assigneeBtn);
       });
    }

    const delegateBtn = element.querySelector('.delegate-button');
    if (delegateBtn) {
      delegateBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      delegateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleDelegatePopover(e, nodeData, delegateBtn);
      });
    }

    const approvalBtn = element.querySelector('.approval-button');
    if (approvalBtn) {
      approvalBtn.addEventListener('mousedown', (e) => e.stopPropagation());
      approvalBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.toggleApprovalPopover(e, nodeData, approvalBtn);
      });
    }

    // Drag listeners (Target node-content but exclude interactive elements)
    element.addEventListener('mousedown', (e) => {
        if (
            (e.target.closest('.node-editable') && e.target.isContentEditable) || 
            e.target.closest('button') || 
            e.target.closest('.drop-zone') ||
            this.isNodeFieldEditing
        ) {
            return;
        }
        e.stopPropagation();
        this.startDrag(e, element, x, y);
    });

    // Double-click to navigate into node
    element.addEventListener('dblclick', (event) => {
      if (event.target.closest('.node-editable') || event.target.closest('button')) {
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
    
    const toggleBtn = element.querySelector('.node-footer-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('mousedown', (e) => e.stopPropagation());
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
        defaultValue: 'Title',
        value: nodeData.name || '',
      },
      {
        el: descriptionEl,
        field: 'description',
        placeholder: 'Describe what success looks like',
        allowEmpty: true,
        defaultValue: 'Description',
        value: nodeData.goal || '',
      },
    ];

    config.forEach(({ el, field, placeholder, allowEmpty, defaultValue, value }) => {
      if (!el) return;
      el.contentEditable = 'false'; // Default to false
      el.spellcheck = true;
      el.classList.add('node-editable');
      el.dataset.nodeId = nodeData.id;
      el.dataset.field = field;
      el.dataset.allowEmpty = allowEmpty ? 'true' : 'false';
      el.setAttribute('data-placeholder', placeholder);
      if (defaultValue) {
        el.dataset.defaultValue = defaultValue;
      }
      el.textContent = value;
      el.dataset.originalValue = this.getNodeFieldTextValue(el);
      this.updateEditablePlaceholderState(el);

      // Enable editing on double click
      el.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          el.contentEditable = 'true';
          el.focus();
      });

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
    this.stopPolling(); // KILL polling completely while editing
    this.activeEditableField = element;
    element.classList.remove('has-error');
    element.classList.remove('is-saving');
    element.dataset.originalValue = this.getNodeFieldTextValue(element);
    
    // Clear default value on focus to act like a placeholder
    const defaultValue = element.dataset.defaultValue;
    const currentValue = element.textContent.trim();
    
    // Only clear if it matches default EXACTLY
    if (defaultValue && currentValue === defaultValue) {
      element.textContent = '';
      this.updateEditablePlaceholderState(element);
    } else {
       element.setAttribute('data-placeholder-visible', 'false');
    }
    
    this.hideNodeCreatePopover(true);
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
    
    // Resume polling immediately
    this.isNodeFieldEditing = false;
    this.activeEditableField = null;
    element.contentEditable = 'false'; 
    this.startPolling();

    this.updateEditablePlaceholderState(element);
    
    // If empty and not allowed, OR if empty and has default value, revert to default/original
    const defaultValue = element.dataset.defaultValue;
    if (!newValue && defaultValue) {
        element.textContent = defaultValue;
        this.updateEditablePlaceholderState(element);
        // Do not save "Title" or "Description" to server if it was just a revert
        return; 
    }

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
    // Safety check: never apply updates to a node being edited
    if (this.isNodeFieldEditing && this.activeEditableField && this.activeEditableField.dataset.nodeId === nodeId) {
        return;
    }
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
    this.updateNodeCardIndicators(nodeId);
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
    this.selectedNode.data.x = newX;
    this.selectedNode.data.y = newY;
    this.selectedNode.element.style.transform = `translate(${newX}px, ${newY}px)`;
  },

  stopDrag() {
    if (this.selectedNode) {
      this.selectedNode.element.classList.remove('dragging');
      this.queuePositionUpdate(this.selectedNode.data.id, this.selectedNode.x, this.selectedNode.y);
      this.applyNodeUpdates(this.selectedNode.data.id, {
        x: this.selectedNode.x,
        y: this.selectedNode.y,
      }, this.selectedNode.data);
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
    setTimeout(() => node.element.classList.remove('focused'), 2000);
  },

  async handleNodeDrop(e, nodeData, listContainer, toggleBtn, titleEl, countEl, slot = 'inputs') {
    let files = [];
    if (e.dataTransfer.items) {
      files = [...e.dataTransfer.items].filter(item => item.kind === 'file').map(item => item.getAsFile());
    } else {
      files = [...e.dataTransfer.files];
    }

    if (files.length === 0) return;
    if (!this.state.selectedCanvasId || !nodeData?.id) {
      this.showCanvasToast('Select a canvas before uploading.', 'error');
      return;
    }

    if (toggleBtn) toggleBtn.disabled = true;
    if (titleEl) titleEl.textContent = `${slot === 'outputs' ? 'Output' : 'Input'} (uploading...)`;

    const canvasId = this.state.selectedCanvasId;
    const nodeId = nodeData.id;

    for (const file of files) {
      try {
        const contentType = file.type || 'application/octet-stream';
        const presigned = await Api.presignFile({
          canvasId,
          nodeId,
          slot,
          filename: file.name,
          contentType,
        });

        const buffer = await file.arrayBuffer();
        await Api.uploadToS3(presigned.uploadUrl, contentType, buffer);

        const updated = await Api.completeFile({
          canvasId,
          nodeId,
          slot,
          fileId: presigned.fileId,
          s3Key: presigned.s3Key,
          filename: file.name,
          contentType,
        });

        const normalized = this.normalizeNodeFromApi(updated);
        this.applyNodeUpdates(nodeId, normalized, nodeData);
      } catch (error) {
        console.error('[Canvas] File upload failed', error);
        this.showCanvasToast(error.message || 'Failed to upload file.', 'error');
      }
    }

    this.buildNodeIndex();
    this.refreshCurrentView();

    const updatedNode = this.getNode(nodeId);
    const evidenceFiles = Array.isArray(updatedNode?.evidence?.files) ? updatedNode.evidence.files : [];
    const inputTotal = (updatedNode?.inputs || []).length + evidenceFiles.length;
    const outputTotal = (updatedNode?.outputs || []).length || 0;
    if (titleEl) {
      titleEl.textContent = slot === 'outputs'
        ? `Output (${outputTotal})`
        : `Input (${inputTotal})`;
    }
    if (countEl) countEl.textContent = inputTotal;
    if (toggleBtn) toggleBtn.disabled = false;

    if (slot !== 'outputs') {
      if (listContainer && listContainer.parentElement) {
        listContainer.parentElement.style.display = 'block';
      }
      if (toggleBtn) toggleBtn.style.transform = 'rotate(180deg)';
    }
  },

  getEvidenceContext() {
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId) {
      return {
        scope: null,
        canvasId: null,
        node: null,
        evidence: null,
      };
    }

    if (this.currentPath && this.currentPath.length > 0) {
      const nodeId = this.currentPath[this.currentPath.length - 1]?.id || null;
      const node = nodeId ? this.getNode(nodeId) : null;
      if (node) {
        return {
          scope: 'node',
          canvasId,
          node,
          evidence: node.evidence || null,
        };
      }
      return {
        scope: 'canvas',
        canvasId,
        node: null,
        evidence: this.state.canvasEvidenceById[canvasId] || null,
      };
    }

    return {
      scope: 'canvas',
      canvasId,
      node: null,
      evidence: this.state.canvasEvidenceById[canvasId] || null,
    };
  },

  async fetchCanvasEvidence(canvasId, force = false) {
    if (!canvasId) return null;
    if (!force && this.state.canvasEvidenceById[canvasId]) {
      return this.state.canvasEvidenceById[canvasId];
    }
    if (this.canvasEvidenceRequests[canvasId]) {
      return this.canvasEvidenceRequests[canvasId];
    }

    this.canvasEvidenceRequests[canvasId] = (async () => {
      try {
        const payload = await Api.getCanvasEvidence(canvasId);
        const evidence = this.normalizeEvidencePayload(payload?.evidence || payload);
        this.state.canvasEvidenceById[canvasId] = evidence;
        return evidence;
      } catch (error) {
        console.error('[Canvas] Failed to load canvas evidence', error);
        this.showCanvasToast(error.message || 'Failed to load canvas evidence.', 'error');
        return this.state.canvasEvidenceById[canvasId] || { notes: [], files: [] };
      } finally {
        delete this.canvasEvidenceRequests[canvasId];
        this.updateEvidenceSidebar();
      }
    })();

    return this.canvasEvidenceRequests[canvasId];
  },

  normalizeEvidencePayload(evidence) {
    const notes = [];
    const files = [];

    if (Array.isArray(evidence)) {
      evidence.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
          return;
        }
        if (item.type === 'text') {
          const text = item.text || item.content || '';
          notes.push({
            noteId: item.noteId || item.id || `note-${index}`,
            text,
            createdAt: item.createdAt || item.timestamp || null,
          });
        } else {
          files.push(item);
        }
      });
      return { notes, files };
    }

    const legacyNotes = Array.isArray(evidence?.notes) ? evidence.notes : [];
    legacyNotes.forEach((item, index) => {
      if (typeof item === 'string') {
        notes.push({ noteId: `note-${index}`, text: item, createdAt: null });
        return;
      }
      const text = item.text || item.content || '';
      notes.push({
        noteId: item.noteId || item.id || `note-${index}`,
        text,
        createdAt: item.createdAt || item.timestamp || null,
      });
    });
    const legacyFiles = Array.isArray(evidence?.files) ? evidence.files : [];
    legacyFiles.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      if (!item.type) {
        files.push({ ...item, type: 'file' });
      } else {
        files.push(item);
      }
    });
    return { notes, files };
  },

  serializeEvidence(evidence) {
    const items = [];
    const notes = Array.isArray(evidence?.notes) ? evidence.notes : [];
    notes.forEach((note, index) => {
      if (typeof note === 'string') {
        items.push({ type: 'text', text: note });
        return;
      }
      const text = note.text || note.content || '';
      const entry = {
        type: 'text',
        text,
      };
      if (note.noteId || note.id) {
        entry.noteId = note.noteId || note.id;
      }
      if (note.createdAt || note.timestamp) {
        entry.createdAt = note.createdAt || note.timestamp;
      }
      items.push(entry);
    });

    const files = Array.isArray(evidence?.files) ? evidence.files : [];
    files.forEach((item) => {
      if (!item || typeof item !== 'object') {
        return;
      }
      if (!item.type) {
        items.push({ ...item, type: 'file' });
        return;
      }
      items.push(item);
    });

    return items;
  },

  async ensureCanvasEvidence(canvasId) {
    if (!canvasId) return { notes: [], files: [] };
    const existing = this.state.canvasEvidenceById[canvasId];
    if (existing) return existing;
    const loaded = await this.fetchCanvasEvidence(canvasId);
    return loaded || { notes: [], files: [] };
  },

  async handleEvidenceDrop(e) {
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId) {
      this.showCanvasToast('Select a canvas to add evidence.', 'error');
      return;
    }

    const context = this.getEvidenceContext();
    if (!context.scope) {
      this.showCanvasToast('Select a canvas to add evidence.', 'error');
      return;
    }
    if (context.scope === 'node' && !context.node) {
      this.showCanvasToast('Open a node to add evidence.', 'error');
      return;
    }
    if (context.scope === 'canvas') {
      await this.ensureCanvasEvidence(canvasId);
    }

    let files = [];
    if (e.dataTransfer.items) {
      files = [...e.dataTransfer.items].filter(item => item.kind === 'file').map(item => item.getAsFile());
    } else {
      files = [...e.dataTransfer.files];
    }

    if (files.length === 0) return;

    for (const file of files) {
      try {
        const contentType = file.type || 'application/octet-stream';
        const scope = context.scope;
        const nodeId = scope === 'node' ? context.node.id : undefined;
        const presigned = await Api.presignFile({
          canvasId,
          nodeId,
          slot: 'evidence',
          filename: file.name,
          contentType,
          scope,
        });

        const buffer = await file.arrayBuffer();
        await Api.uploadToS3(presigned.uploadUrl, contentType, buffer);

        const updated = await Api.completeFile({
          canvasId,
          nodeId,
          slot: 'evidence',
          fileId: presigned.fileId,
          s3Key: presigned.s3Key,
          filename: file.name,
          contentType,
          scope,
        });

        if (scope === 'canvas') {
          const updatedEvidence = this.normalizeEvidencePayload(updated?.evidence || updated);
          this.state.canvasEvidenceById[canvasId] = updatedEvidence;
        } else {
          const updatedEvidence = this.normalizeEvidencePayload(updated?.evidence || context.node.evidence);
          this.applyNodeUpdates(context.node.id, {
            evidence: updatedEvidence,
            updatedAt: updated?.updatedAt || context.node.updatedAt,
          }, context.node);
        }
      } catch (error) {
        console.error('[Canvas] Evidence upload failed', error);
        this.showCanvasToast(error.message || 'Failed to upload evidence file.', 'error');
      }
    }

    this.updateEvidenceSidebar();
  },

  submitEvidenceNote() {
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId || !this.evidenceNoteInput) {
      return;
    }
    const text = this.evidenceNoteInput.value.trim();
    if (!text) {
      return;
    }
    const now = new Date().toISOString();
    const note = {
      noteId: `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      createdAt: now,
    };
    this.evidenceNoteInput.value = '';
    const context = this.getEvidenceContext();
    if (context.scope === 'node' && context.node) {
      this.appendEvidenceNoteToNode(context.node, note);
    } else if (context.scope === 'canvas') {
      this.appendEvidenceNoteToCanvas(canvasId, note);
    }
  },

  async appendEvidenceNoteToNode(node, note) {
    const evidence = this.normalizeEvidencePayload(node?.evidence);
    evidence.notes.push(note);
    await this.saveEvidenceForNode(node, evidence);
  },

  async appendEvidenceNoteToCanvas(canvasId, note) {
    const existing = await this.ensureCanvasEvidence(canvasId);
    const evidence = {
      notes: [...existing.notes, note],
      files: [...existing.files],
    };
    await this.saveEvidenceForCanvas(canvasId, evidence);
  },

  async commitEvidenceNoteEdit(noteElement) {
    if (!noteElement) return;
    const noteId = noteElement.dataset.noteId;
    if (!noteId) return;
    const original = noteElement.dataset.originalValue || '';
    const updatedText = noteElement.textContent.trim();
    if (!updatedText) {
      noteElement.textContent = original;
      return;
    }
    if (updatedText === original) {
      return;
    }

    const context = this.getEvidenceContext();
    if (!context.scope) {
      return;
    }
    const evidenceSource = context.scope === 'canvas'
      ? await this.ensureCanvasEvidence(context.canvasId)
      : context.node?.evidence;
    const evidence = this.normalizeEvidencePayload(evidenceSource);
    const note = evidence.notes.find(item => (item.noteId || item.id) === noteId);
    if (!note) {
      return;
    }
    note.text = updatedText;
    if (context.scope === 'canvas') {
      await this.saveEvidenceForCanvas(context.canvasId, evidence, original);
    } else if (context.node) {
      await this.saveEvidenceForNode(context.node, evidence, original);
    }
  },

  async saveEvidenceForNode(node, evidence, fallbackText) {
    if (!node || !this.state.selectedCanvasId) {
      return;
    }
    try {
      const updated = await Api.updateNode(node.id, {
        canvasId: this.state.selectedCanvasId,
        evidence: this.serializeEvidence(evidence),
      });
      const updatedEvidence = this.normalizeEvidencePayload(updated?.evidence || evidence);
      this.applyNodeUpdates(node.id, {
        evidence: updatedEvidence,
        updatedAt: updated?.updatedAt || node.updatedAt,
      }, node);
      this.updateEvidenceSidebar();
    } catch (error) {
      console.error('[Canvas] Failed to save evidence', error);
      this.showCanvasToast(error.message || 'Failed to save evidence.', 'error');
      if (fallbackText !== undefined) {
        this.updateEvidenceSidebar();
      }
    }
  },

  async saveEvidenceForCanvas(canvasId, evidence, fallbackText) {
    if (!canvasId) {
      return;
    }
    try {
      const updated = await Api.updateCanvasEvidence(canvasId, this.serializeEvidence(evidence));
      const updatedEvidence = this.normalizeEvidencePayload(updated?.evidence || updated);
      this.state.canvasEvidenceById[canvasId] = updatedEvidence;
      this.updateEvidenceSidebar();
    } catch (error) {
      console.error('[Canvas] Failed to save canvas evidence', error);
      this.showCanvasToast(error.message || 'Failed to save evidence.', 'error');
      if (fallbackText !== undefined) {
        this.updateEvidenceSidebar();
      }
    }
  },

  updateEvidenceSidebar() {
    if (!this.evidenceList || !this.evidenceEmpty || !this.evidenceSubtitle) {
      return;
    }

    const canvasId = this.state.selectedCanvasId;
    if (!canvasId) {
      this.evidenceList.innerHTML = '';
      this.evidenceEmpty.textContent = 'Select a canvas to view evidence.';
      this.evidenceEmpty.style.display = 'block';
      this.evidenceSubtitle.textContent = 'Canvas log';
      if (this.evidenceNoteInput) this.evidenceNoteInput.disabled = true;
      if (this.evidenceNoteSubmit) this.evidenceNoteSubmit.disabled = true;
      if (this.evidenceDropZone) this.evidenceDropZone.classList.add('is-disabled');
      return;
    }

    const selectedCanvas = this.state.canvases.find(c => c.id === canvasId);
    if (this.evidenceNoteInput) this.evidenceNoteInput.disabled = false;
    if (this.evidenceNoteSubmit) this.evidenceNoteSubmit.disabled = false;
    if (this.evidenceDropZone) this.evidenceDropZone.classList.remove('is-disabled');

    const context = this.getEvidenceContext();
    if (context.scope === 'node' && context.node) {
      this.evidenceSubtitle.textContent = `${selectedCanvas?.name || 'Canvas'} - ${context.node.name || 'Node'}`;
      const fallbackTimestamp = context.node.updatedAt || context.node.createdAt || new Date().toISOString();
      this.renderEvidenceList(context.node.evidence, fallbackTimestamp);
      return;
    }

    this.evidenceSubtitle.textContent = `${selectedCanvas?.name || 'Canvas'} - Evidence`;
    if (!context.evidence) {
      this.evidenceList.innerHTML = '';
      this.evidenceEmpty.textContent = 'Loading evidence...';
      this.evidenceEmpty.style.display = 'block';
      this.fetchCanvasEvidence(canvasId);
      return;
    }
    this.renderEvidenceList(context.evidence, new Date().toISOString());
  },

  buildEvidenceEntries(evidence, fallbackTimestamp) {
    const entries = [];
    const notes = Array.isArray(evidence?.notes) ? evidence.notes : [];
    notes.forEach((note, index) => {
      if (typeof note === 'string') {
        entries.push({
          type: 'note',
          noteId: `note-${index}`,
          text: note,
          timestamp: fallbackTimestamp || '',
        });
        return;
      }
      const text = note.text || note.content || '';
      entries.push({
        type: 'note',
        noteId: note.noteId || note.id || `note-${index}`,
        text,
        timestamp: note.createdAt || note.timestamp || fallbackTimestamp || '',
      });
    });

    const files = Array.isArray(evidence?.files) ? evidence.files : [];
    files.forEach((file, index) => {
      const fileType = file.type || 'file';
      if (fileType === 'link') {
        entries.push({
          type: 'link',
          url: file.url || '',
          title: file.title || file.url || 'Link',
          timestamp: file.createdAt || fallbackTimestamp || '',
          id: `link-${index}`,
        });
        return;
      }
      if (fileType === 'node') {
        entries.push({
          type: 'node',
          nodeId: file.nodeId || '',
          title: file.title || file.nodeId || 'Node',
          timestamp: file.createdAt || fallbackTimestamp || '',
          id: `node-${index}`,
        });
        return;
      }
      if (fileType === 'text') {
        entries.push({
          type: 'note',
          noteId: `text-${index}`,
          text: file.text || file.content || '',
          timestamp: file.createdAt || fallbackTimestamp || '',
        });
        return;
      }
      entries.push({
        type: 'file',
        fileId: file.fileId,
        s3Key: file.s3Key,
        name: file.filename || file.name || file.fileId || 'File',
        fileType: file.contentType || '',
        timestamp: file.createdAt || fallbackTimestamp || '',
        id: `file-${index}`,
      });
    });

    return entries.sort((a, b) => {
      const aTime = a.timestamp ? Date.parse(a.timestamp) : 0;
      const bTime = b.timestamp ? Date.parse(b.timestamp) : 0;
      if (aTime === bTime) {
        return 0;
      }
      return aTime - bTime;
    });
  },

  renderEvidenceList(evidence, fallbackTimestamp) {
    if (!this.evidenceList || !this.evidenceEmpty || !evidence) {
      return;
    }
    const entries = this.buildEvidenceEntries(evidence, fallbackTimestamp);
    if (!entries || entries.length === 0) {
      this.evidenceList.innerHTML = '';
      this.evidenceEmpty.textContent = 'No evidence yet.';
      this.evidenceEmpty.style.display = 'block';
      return;
    }

    const items = entries.map(entry => this.renderEvidenceItem(entry)).join('');
    this.evidenceList.innerHTML = items;
    this.evidenceEmpty.style.display = 'none';
    if (window.lucide) window.lucide.createIcons();
  },

  renderEvidenceItem(entry) {
    const timestamp = this.formatTime(entry.timestamp);
    const entryType = entry.type || 'file';
    const isNote = entryType === 'note';
    const isLink = entryType === 'link';
    const isNode = entryType === 'node';
    const isFile = entryType === 'file';
    const isPdf = isFile && this.isPdfFile(entry);
    const text = isNote ? entry.text : (entry.title || entry.name || entry.url || entry.nodeId);
    let icon = '<i data-lucide="file"></i>';
    if (isNote) {
      icon = '<span class="evidence-bullet"></span>';
    } else if (isLink) {
      icon = '<i data-lucide="link-2"></i>';
    } else if (isNode) {
      icon = '<i data-lucide="layers"></i>';
    } else if (isPdf) {
      icon = '<i data-lucide="star"></i>';
    }

    const noteAttrs = isNote
      ? `contenteditable="true" class="evidence-text evidence-note" data-note-id="${this.escapeHtml(entry.noteId || '')}"`
      : 'class="evidence-text"';

    const fileAttrs = isFile
      ? `data-file-id="${this.escapeHtml(entry.fileId || '')}" data-s3-key="${this.escapeHtml(entry.s3Key || '')}"`
      : '';

    const linkAttrs = isLink
      ? `data-link-url="${encodeURIComponent(entry.url || '')}"`
      : '';

    const nodeAttrs = isNode
      ? `data-node-id="${this.escapeHtml(entry.nodeId || '')}"`
      : '';

    return `
      <div class="evidence-item" ${fileAttrs} ${linkAttrs} ${nodeAttrs}>
        <div class="evidence-icon">${icon}</div>
        <div class="evidence-body">
          <div ${noteAttrs}>${this.escapeHtml(text || 'Untitled')}</div>
          <div class="evidence-time">${this.escapeHtml(timestamp)}</div>
        </div>
      </div>
    `;
  },

  isPdfFile(entry) {
    if (entry.type && entry.type !== 'file') {
      return false;
    }
    const name = (entry?.name || '').toLowerCase();
    const type = (entry?.fileType || '').toLowerCase();
    return type.includes('pdf') || name.endsWith('.pdf');
  },

  async downloadNodeFile(nodeData, fileMeta) {
    if (!this.state.selectedCanvasId || !nodeData?.id) {
      return;
    }
    try {
      const payload = await Api.downloadFile({
        canvasId: this.state.selectedCanvasId,
        nodeId: nodeData.id,
        fileId: fileMeta?.fileId || undefined,
        s3Key: fileMeta?.s3Key || undefined,
      });
      const url = payload?.downloadUrl;
      if (!url) {
        throw new Error('Missing download URL');
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('[Canvas] File download failed', error);
      this.showCanvasToast(error.message || 'Failed to download file.', 'error');
    }
  },

  async downloadCanvasFile(fileMeta) {
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId) {
      return;
    }
    try {
      const payload = await Api.downloadFile({
        canvasId,
        scope: 'canvas',
        fileId: fileMeta?.fileId || undefined,
        s3Key: fileMeta?.s3Key || undefined,
      });
      const url = payload?.downloadUrl;
      if (!url) {
        throw new Error('Missing download URL');
      }
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      console.error('[Canvas] File download failed', error);
      this.showCanvasToast(error.message || 'Failed to download file.', 'error');
    }
  },

  setupGlobalIconPopover() {
    this.iconPopover = document.createElement('div');
    this.iconPopover.className = 'icon-picker-popover';
    this.iconPopover.innerHTML = `
      <div class="icon-grid">
         <!-- Icons will be injected here -->
      </div>
    `;
    document.body.appendChild(this.iconPopover);

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (this.iconPopover && 
          this.iconPopover.classList.contains('is-visible') && 
          !this.iconPopover.contains(e.target) && 
          !e.target.closest('.node-icon-trigger')) {
        this.iconPopover.classList.remove('is-visible');
      }
    });
  },

  toggleIconPicker(e, nodeData, triggerBtn) {
    if (!this.iconPopover) return;
    
    const isVisible = this.iconPopover.classList.contains('is-visible');
    
    if (isVisible && this.activeIconNodeId === nodeData.id) {
       this.iconPopover.classList.remove('is-visible');
       this.activeIconNodeId = null;
       return;
    }

    // Populate Icons (Simple set for now)
    const icons = ['box', 'layers', 'file', 'image', 'link', 'users', 'database', 'globe', 'settings', 'message-square', 'mail', 'calendar', 'check-square', 'list'];
    const grid = this.iconPopover.querySelector('.icon-grid');
    grid.innerHTML = icons.map(icon => `
      <button class="icon-option" data-icon="${icon}">
         <i data-lucide="${icon}"></i>
      </button>
    `).join('');
    
    if (window.lucide) window.lucide.createIcons({ root: grid });

    // Position
    const rect = triggerBtn.getBoundingClientRect();
    this.iconPopover.style.top = `${rect.bottom + 8}px`;
    this.iconPopover.style.left = `${rect.left}px`;
    
    this.iconPopover.classList.add('is-visible');
    this.activeIconNodeId = nodeData.id;

    // Handle Selection
    const buttons = grid.querySelectorAll('.icon-option');
    buttons.forEach(btn => {
      btn.onclick = (evt) => {
         evt.stopPropagation();
         const newIcon = btn.dataset.icon;
         this.updateNodeIcon(nodeData, newIcon);
         this.iconPopover.classList.remove('is-visible');
      };
    });
  },

  updateNodeIcon(nodeData, iconName) {
     nodeData.icon = iconName;
     // Find the node element
     const node = this.nodes.find(n => n.data.id === nodeData.id);
     if (node) {
        const triggerBtn = node.element.querySelector('.node-icon-trigger');
        if (triggerBtn) {
           // Re-create the <i> tag because Lucide replaces it with an <svg>
           triggerBtn.innerHTML = `<i data-lucide="${iconName}"></i>`;
           if (window.lucide) window.lucide.createIcons({ root: triggerBtn });
        }
     }
     // Optionally save to API here
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

  setupGlobalUserPicker() {
    this.userPickerPopover = document.createElement('div');
    this.userPickerPopover.className = 'user-picker-popover';
    this.userPickerPopover.innerHTML = `
      <div class="user-picker-content">
         <!-- Content injected dynamically -->
      </div>
    `;
    document.body.appendChild(this.userPickerPopover);

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (this.userPickerPopover && 
          this.userPickerPopover.classList.contains('is-visible') && 
          !this.userPickerPopover.contains(e.target) && 
          !e.target.closest('.assignee-button')) {
        this.userPickerPopover.classList.remove('is-visible');
      }
    });
  },

  setupGlobalDelegatePopover() {
    this.delegatePopover = document.createElement('div');
    this.delegatePopover.className = 'delegate-popover';
    this.delegatePopover.innerHTML = `
      <div class="delegate-popover-content"></div>
    `;
    document.body.appendChild(this.delegatePopover);

    document.addEventListener('click', (e) => {
      if (
        this.delegatePopover &&
        this.delegatePopover.classList.contains('is-visible') &&
        !this.delegatePopover.contains(e.target) &&
        !e.target.closest('.delegate-button')
      ) {
        this.delegatePopover.classList.remove('is-visible');
        this.activeDelegateNodeId = null;
      }
    });
  },

  setupGlobalApprovalPopover() {
    this.approvalPopover = document.createElement('div');
    this.approvalPopover.className = 'approval-popover';
    this.approvalPopover.innerHTML = `
      <div class="approval-popover-content"></div>
    `;
    document.body.appendChild(this.approvalPopover);

    document.addEventListener('click', (e) => {
      if (
        this.approvalPopover &&
        this.approvalPopover.classList.contains('is-visible') &&
        !this.approvalPopover.contains(e.target) &&
        !e.target.closest('.approval-button')
      ) {
        this.approvalPopover.classList.remove('is-visible');
        this.activeApprovalNodeId = null;
      }
    });
  },

  registerGatewayStreamHandlers() {
    Api.onGatewayStreamEvent((payload) => {
      this.handleGatewayStreamEvent(payload);
    });
    Api.onGatewayStreamError((payload) => {
      this.handleGatewayStreamError(payload);
    });
  },

  handleGatewayStreamEvent(payload) {
    if (!payload || !payload.nodeId) {
      return;
    }
    if (payload.canvasId && payload.canvasId !== this.state.selectedCanvasId) {
      return;
    }
    if (payload.event === 'activity_log' && payload.data?.entries) {
      const node = this.state.nodesById[payload.nodeId];
      if (node) {
        node.activityLog = payload.data.entries;
      }
    }
    this.pollNodes();
  },

  handleGatewayStreamError(payload) {
    if (!payload || payload.canvasId !== this.state.selectedCanvasId) {
      return;
    }
    const message = payload.error || payload.message || 'Gateway stream error';
    this.showCanvasToast(message, 'error');
  },

  async ensureGatewayStream(nodeId) {
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId || !nodeId) {
      return;
    }
    const key = `${canvasId}:${nodeId}`;
    if (this.activeGatewayStreams.has(key)) {
      return;
    }
    await Api.startGatewayStream({ canvasId, nodeId });
    this.activeGatewayStreams.add(key);
  },

  stopAllGatewayStreams() {
    this.activeGatewayStreams.forEach((key) => {
      const [canvasId, nodeId] = key.split(':');
      Api.stopGatewayStream({ canvasId, nodeId });
    });
    this.activeGatewayStreams.clear();
  },

  toggleUserPicker(e, nodeData, triggerBtn) {
    if (!this.userPickerPopover) return;
    
    // Toggle visibility if clicking same trigger
    const isVisible = this.userPickerPopover.classList.contains('is-visible');
    if (isVisible && this.activeUserPickerNodeId === nodeData.id) {
       this.userPickerPopover.classList.remove('is-visible');
       this.activeUserPickerNodeId = null;
       return;
    }

    // Prepare User List
    const content = this.userPickerPopover.querySelector('.user-picker-content');
    
    // 1. Agent Option
    let html = `
      <div class="user-picker-section">AI Agents</div>
      <button class="user-option" data-type="agent" data-id="${DEFAULT_AGENT_ID}" data-name="${DEFAULT_AGENT_LABEL}" data-color="#ec4899">
        <div class="user-option-avatar is-agent"><i data-lucide="bot"></i></div>
        <div class="user-option-info">
          <span class="user-option-name">${DEFAULT_AGENT_LABEL}</span>
          <span class="user-option-status">Always online</span>
        </div>
      </button>
    `;

    // 2. Active Users
    const activeUsers = this.state.activeUsers || [];
    const currentUser = this.getCurrentUserProfile();
    const usersList = [...activeUsers];
    if (!usersList.some(u => u.userId === currentUser.userId)) {
       usersList.unshift({
         userId: currentUser.userId,
         displayName: currentUser.displayName,
         initial: currentUser.initial,
       });
    }

    if (usersList.length > 0) {
       html += `<div class="user-picker-section">Active Users</div>`;
       usersList.forEach(user => {
         // Resolve Name
         let displayName = user.displayName || user.name || user.email;
         if (!displayName) {
            const suffix = (user.userId || user.sub || '').slice(-4);
            displayName = suffix ? `User ${suffix}` : 'Anonymous';
         }

         // Initials
         let initials = '?';
         if (displayName !== 'Anonymous') {
            initials = displayName.substring(0, 2).toUpperCase();
            if (displayName.includes(' ')) {
               const parts = displayName.split(' ');
               if (parts.length > 1) {
                  initials = (parts[0][0] + parts[1][0]).toUpperCase();
               }
            }
         }

         // Color
         let color = user.color || this.getUserColor(user.userId || user.sub || '');

         html += `
           <button class="user-option" data-type="human" data-id="${this.escapeHtml(user.userId || user.sub || '')}" data-name="${this.escapeHtml(displayName)}" data-initials="${initials}" data-color="${color}">
             <div class="user-option-avatar is-user" style="background: ${color}">
               ${initials}
               <span class="user-option-active"></span>
             </div>
             <div class="user-option-info">
               <span class="user-option-name">${this.escapeHtml(displayName)}</span>
               <span class="user-option-status">Active now</span>
             </div>
           </button>
         `;
       });
    }

    content.innerHTML = html;
    
    if (window.lucide) window.lucide.createIcons({ root: content });

    // Position
    const rect = triggerBtn.getBoundingClientRect();
    this.userPickerPopover.style.top = `${rect.bottom + 8}px`;
    // Align right edge of popover with right edge of button if close to edge, else left align
    const popoverWidth = 260;
    if (rect.left + popoverWidth > window.innerWidth - 20) {
       this.userPickerPopover.style.left = `${rect.right - popoverWidth}px`;
    } else {
       this.userPickerPopover.style.left = `${rect.left}px`;
    }
    
    this.userPickerPopover.classList.add('is-visible');
    this.activeUserPickerNodeId = nodeData.id;

    // Handle Selection
    const buttons = content.querySelectorAll('.user-option');
    buttons.forEach(btn => {
      btn.onclick = (evt) => {
         evt.stopPropagation();
         const type = btn.dataset.type;
         const name = btn.dataset.name;
         const color = btn.dataset.color || '#2563eb';
         const id = btn.dataset.id;
         const initials = btn.dataset.initials || '';
         
         this.updateNodeAssignee(nodeData, { type, id, name, color, initials });
         this.userPickerPopover.classList.remove('is-visible');
      };
    });
  },

  async updateNodeAssignee(nodeData, assignee) {
    if (!nodeData || !nodeData.id || !this.state.selectedCanvasId) {
      return;
    }
    const assignedTo = {
      type: assignee.type,
      id: assignee.id,
    };

    try {
      const updated = await Api.updateNode(nodeData.id, {
        canvasId: this.state.selectedCanvasId,
        assignedTo,
      });
      const normalized = this.normalizeNodeFromApi(updated);
      this.applyNodeUpdates(nodeData.id, normalized, nodeData);
      this.updateNodeCardIndicators(nodeData.id);
      this.showCanvasToast('Assignee updated.', 'success');
    } catch (error) {
      console.error('[Canvas] Failed to update assignee', error);
      this.showCanvasToast(error.message || 'Failed to update assignee.', 'error');
    }
  },

  resolveAssigneeDisplay(assignedTo) {
    if (!assignedTo || !assignedTo.type || !assignedTo.id) {
      return null;
    }
    if (assignedTo.type === 'agent') {
      return {
        type: 'agent',
        label: DEFAULT_AGENT_LABEL,
        initials: 'AI',
        color: '#ec4899',
      };
    }
    const userId = assignedTo.id;
    const activeUser = (this.state.activeUsers || []).find(user => user.userId === userId);
    const name = activeUser?.displayName || `User ${userId.slice(-4)}`;
    return {
      type: 'human',
      label: name,
      initials: this.getInitials(name),
      color: this.getUserColor(userId),
    };
  },

  getUserColor(userId) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#ef4444', '#6366f1'];
    const hash = String(userId || '')
      .split('')
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[hash % colors.length];
  },

  applyAssigneeDisplay(nodeData, element) {
    if (!element) {
      return;
    }
    const assigneeBtn = element.querySelector('.assignee-button');
    if (!assigneeBtn) {
      return;
    }
    const initialsEl = assigneeBtn.querySelector('.assignee-initials');
    const iconEl = assigneeBtn.querySelector('.assignee-icon');
    const display = this.resolveAssigneeDisplay(nodeData.assignedTo);

    if (!display) {
      assigneeBtn.classList.remove('assigned');
      assigneeBtn.style.removeProperty('--avatar-color');
      assigneeBtn.title = 'Assign User';
      if (initialsEl) {
        initialsEl.textContent = '';
        initialsEl.style.display = 'none';
      }
      if (iconEl) {
        iconEl.style.display = 'block';
      }
    } else {
      assigneeBtn.classList.add('assigned');
      assigneeBtn.style.setProperty('--avatar-color', display.color);
      assigneeBtn.title = display.label;
      if (initialsEl) {
        if (display.type === 'agent') {
          initialsEl.innerHTML = '<i data-lucide="bot"></i>';
        } else {
          initialsEl.textContent = display.initials || '?';
        }
        initialsEl.style.display = 'flex';
      }
      if (iconEl) {
        iconEl.style.display = 'none';
      }
      if (display.type === 'agent' && window.lucide && initialsEl) {
        window.lucide.createIcons({ root: initialsEl });
      }
    }

    const delegateBtn = element.querySelector('.delegate-button');
    if (delegateBtn) {
      const enabled = display && display.type === 'agent';
      delegateBtn.disabled = !enabled;
      delegateBtn.classList.toggle('is-hidden', !enabled);
    }
  },

  getPendingApprovals(nodeData) {
    const approvals = Array.isArray(nodeData?.approvalRequests) ? nodeData.approvalRequests : [];
    return approvals.filter(request => request.status === 'pending');
  },

  applyApprovalState(nodeData, element) {
    if (!element) {
      return;
    }
    const approvalBtn = element.querySelector('.approval-button');
    if (!approvalBtn) {
      return;
    }
    const pending = this.getPendingApprovals(nodeData);
    if (pending.length === 0) {
      approvalBtn.classList.add('is-hidden');
      approvalBtn.textContent = 'Approvals';
      return;
    }
    approvalBtn.classList.remove('is-hidden');
    approvalBtn.textContent = `Approvals (${pending.length})`;
  },

  updateNodeCardIndicators(nodeId) {
    const nodeEntry = this.nodes.find(node => node.data.id === nodeId);
    if (!nodeEntry) {
      return;
    }
    this.applyAssigneeDisplay(nodeEntry.data, nodeEntry.element);
    this.applyApprovalState(nodeEntry.data, nodeEntry.element);
  },

  toggleDelegatePopover(e, nodeData, triggerBtn) {
    if (!this.delegatePopover || !nodeData) {
      return;
    }
    const isVisible = this.delegatePopover.classList.contains('is-visible');
    if (isVisible && this.activeDelegateNodeId === nodeData.id) {
      this.delegatePopover.classList.remove('is-visible');
      this.activeDelegateNodeId = null;
      return;
    }

    const content = this.delegatePopover.querySelector('.delegate-popover-content');
    content.innerHTML = `
      <div class="delegate-section">
        <div class="delegate-title">Delegate Task</div>
        <div class="delegate-subtitle">Select approval mode</div>
      </div>
      <button class="delegate-option" data-mode="auto">
        <span class="delegate-option-title">Full access</span>
        <span class="delegate-option-subtitle">No approvals required</span>
      </button>
      <button class="delegate-option" data-mode="approve_nodes">
        <span class="delegate-option-title">Human-in-the-loop</span>
        <span class="delegate-option-subtitle">Approve subnodes + completion</span>
      </button>
      <button class="delegate-option" data-mode="approve_all">
        <span class="delegate-option-title">Full human loop</span>
        <span class="delegate-option-subtitle">Approve every action</span>
      </button>
    `;

    const rect = triggerBtn.getBoundingClientRect();
    this.delegatePopover.style.top = `${rect.bottom + 8}px`;
    this.delegatePopover.style.left = `${rect.left}px`;

    this.delegatePopover.classList.add('is-visible');
    this.activeDelegateNodeId = nodeData.id;

    content.querySelectorAll('.delegate-option').forEach((btn) => {
      btn.onclick = (evt) => {
        evt.stopPropagation();
        const mode = btn.dataset.mode;
        this.delegatePopover.classList.remove('is-visible');
        this.activeDelegateNodeId = null;
        this.delegateNode(nodeData, mode);
      };
    });
  },

  async delegateNode(nodeData, approvalMode) {
    if (!nodeData || !nodeData.id || !this.state.selectedCanvasId) {
      return;
    }
    if (nodeData.activeTaskId) {
      this.showCanvasToast('Task is already running.', 'error');
      return;
    }
    const assignedTo = nodeData.assignedTo || { type: 'agent', id: DEFAULT_AGENT_ID };
    if (!assignedTo || assignedTo.type !== 'agent') {
      this.showCanvasToast('Assign an agent before delegating.', 'error');
      return;
    }

    try {
      const updated = await Api.updateNode(nodeData.id, {
        canvasId: this.state.selectedCanvasId,
        assignedTo,
        approvalMode,
        status: 'ready',
      });
      const normalized = this.normalizeNodeFromApi(updated);
      this.applyNodeUpdates(nodeData.id, normalized, nodeData);
      this.updateNodeCardIndicators(nodeData.id);

      await Api.executeNode(nodeData.id, {
        canvasId: this.state.selectedCanvasId,
        approvalMode,
      });
      await this.ensureGatewayStream(nodeData.id);
      this.showCanvasToast('Delegation started.', 'success');
    } catch (error) {
      console.error('[Canvas] Delegate failed', error);
      this.showCanvasToast(error.message || 'Failed to delegate task.', 'error');
    }
  },

  toggleApprovalPopover(e, nodeData, triggerBtn) {
    if (!this.approvalPopover || !nodeData) {
      return;
    }
    const pending = this.getPendingApprovals(nodeData);
    if (pending.length === 0) {
      return;
    }

    const isVisible = this.approvalPopover.classList.contains('is-visible');
    if (isVisible && this.activeApprovalNodeId === nodeData.id) {
      this.approvalPopover.classList.remove('is-visible');
      this.activeApprovalNodeId = null;
      return;
    }

    const content = this.approvalPopover.querySelector('.approval-popover-content');
    content.innerHTML = pending.map((request) => {
      const rationale = request.rationale ? this.escapeHtml(request.rationale) : '';
      return `
        <div class="approval-item">
          <div class="approval-item-header">
            <span class="approval-item-title">${this.escapeHtml(request.type || 'approval')}</span>
            <span class="approval-item-status">pending</span>
          </div>
          ${rationale ? `<div class="approval-item-body">${rationale}</div>` : ''}
          <div class="approval-item-actions">
            <button class="approval-action" data-approval-id="${this.escapeHtml(request.approvalId || '')}" data-decision="approved">Approve</button>
            <button class="approval-action is-reject" data-approval-id="${this.escapeHtml(request.approvalId || '')}" data-decision="rejected">Reject</button>
          </div>
        </div>
      `;
    }).join('');

    const rect = triggerBtn.getBoundingClientRect();
    this.approvalPopover.style.top = `${rect.bottom + 8}px`;
    this.approvalPopover.style.left = `${rect.left}px`;

    this.approvalPopover.classList.add('is-visible');
    this.activeApprovalNodeId = nodeData.id;

    content.querySelectorAll('.approval-action').forEach((btn) => {
      btn.onclick = (evt) => {
        evt.stopPropagation();
        const approvalId = btn.dataset.approvalId;
        const decision = btn.dataset.decision;
        this.resolveApproval(nodeData, approvalId, decision);
      };
    });
  },

  async resolveApproval(nodeData, approvalId, decision) {
    if (!approvalId || !nodeData?.id || !this.state.selectedCanvasId) {
      return;
    }
    try {
      const updated = await Api.approveNodeAction(nodeData.id, {
        canvasId: this.state.selectedCanvasId,
        approvalId,
        decision,
      });
      const normalized = this.normalizeNodeFromApi(updated);
      this.applyNodeUpdates(nodeData.id, normalized, nodeData);
      this.updateNodeCardIndicators(nodeData.id);
      this.approvalPopover?.classList.remove('is-visible');
      this.activeApprovalNodeId = null;
      this.showCanvasToast('Approval updated.', 'success');
    } catch (error) {
      console.error('[Canvas] Approval failed', error);
      this.showCanvasToast(error.message || 'Failed to update approval.', 'error');
    }
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
    const evidence = this.normalizeEvidencePayload(node?.evidence);
    const evidenceCount = this.getEvidenceItemCount(evidence);
    const status = this.resolveNodeStatus(node, evidenceCount);
    const author = this.resolveAuthor(node.authorSub);
    const x = this.normalizeNumber(node.x);
    const y = this.normalizeNumber(node.y);

    const normalized = {
      id: node.nodeId,
      name: node.title || 'Untitled',
      goal: node.description || '',
      result: null,
      status,
      evidence,
      author,
      children: [],
      parent: node.parentNodeId === 'ROOT' ? null : node.parentNodeId,
      inputs: Array.isArray(node.inputs) ? node.inputs : [],
      outputs: Array.isArray(node.outputs) ? node.outputs : [],
      assignedTo: node.assignedTo || null,
      approvalMode: node.approvalMode || null,
      approvalRequests: Array.isArray(node.approvalRequests) ? node.approvalRequests : [],
      activityLog: Array.isArray(node.activityLog) ? node.activityLog : [],
      activeTaskId: node.activeTaskId || null,
      createdAt: node.createdAt || '',
      updatedAt: node.updatedAt || '',
    };
    if (Number.isFinite(x) && Number.isFinite(y)) {
      normalized.x = x;
      normalized.y = y;
    }
    return normalized;
  },

  normalizeEvidence(node) {
    const items = [];
    const timestamp = node.updatedAt || node.createdAt || new Date().toISOString();

    if (node.evidence && Array.isArray(node.evidence.notes)) {
      node.evidence.notes.forEach((note, index) => {
        if (typeof note === 'string') {
          items.push({
            id: `note-${node.nodeId}-${index}`,
            type: 'note',
            content: note,
            timestamp,
          });
          return;
        }
        const content = note.text || note.content || '';
        const noteTimestamp = note.createdAt || note.timestamp || timestamp;
        items.push({
          id: `note-${node.nodeId}-${note.noteId || note.id || index}`,
          type: 'note',
          content: String(content),
          timestamp: noteTimestamp,
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
          s3Key: file.s3Key,
          fileId: file.fileId,
          filename: file.filename,
          contentType: file.contentType,
        });
      });
    }

    return items;
  },

  getEvidenceItemCount(evidence) {
    if (!evidence || typeof evidence !== 'object') {
      return 0;
    }
    if (Array.isArray(evidence)) {
      return evidence.length;
    }
    const notesCount = Array.isArray(evidence.notes) ? evidence.notes.length : 0;
    const filesCount = Array.isArray(evidence.files) ? evidence.files.length : 0;
    return notesCount + filesCount;
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

  resolveNodeStatus(node, evidenceCount) {
    const backendStatus = node?.status;
    if (!backendStatus) {
      return this.deriveStatus(node, evidenceCount);
    }
    switch (backendStatus) {
      case 'completed':
        return 'complete';
      case 'in_progress':
        return 'in-progress';
      case 'failed':
        return 'failed';
      case 'blocked':
        return 'blocked';
      case 'ready':
      case 'draft':
      default:
        return 'planning';
    }
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

  formatTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '--';
    }
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  },

  getStatusLabel(status) {
    switch (status) {
      case 'complete': return 'Done';
      case 'in-progress': return 'In Progress';
      case 'failed': return 'Failed';
      case 'blocked': return 'Blocked';
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
      await this.flushPendingPositionUpdates();
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

  queuePositionUpdate(nodeId, x, y) {
    if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    this.pendingPositionUpdates.set(nodeId, { x, y });
  },

  async flushPendingPositionUpdates() {
    if (this.positionSyncInFlight || this.pendingPositionUpdates.size === 0) {
      return;
    }
    const canvasId = this.state.selectedCanvasId;
    if (!canvasId) {
      return;
    }
    this.positionSyncInFlight = true;
    const entries = Array.from(this.pendingPositionUpdates.entries());
    this.pendingPositionUpdates.clear();

    for (const [nodeId, position] of entries) {
      try {
        const updated = await Api.updateNode(nodeId, {
          canvasId,
          x: position.x,
          y: position.y,
        });
        const resolvedX = this.normalizeNumber(updated?.x);
        const resolvedY = this.normalizeNumber(updated?.y);
        this.applyNodeUpdates(
          nodeId,
          {
            x: Number.isFinite(resolvedX) ? resolvedX : position.x,
            y: Number.isFinite(resolvedY) ? resolvedY : position.y,
            updatedAt: updated?.updatedAt,
          },
          this.state.nodesById[nodeId]
        );
      } catch (error) {
        console.warn('[Canvas] Failed to sync node position', error);
        this.pendingPositionUpdates.set(nodeId, position);
      }
    }

    this.positionSyncInFlight = false;
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
        const existingEvidenceCount = this.getEvidenceItemCount(existing.evidence);
        const incomingEvidenceCount = this.getEvidenceItemCount(incoming.evidence);
        const existingInputsCount = Array.isArray(existing.inputs) ? existing.inputs.length : 0;
        const incomingInputsCount = Array.isArray(incoming.inputs) ? incoming.inputs.length : 0;
        const existingOutputsCount = Array.isArray(existing.outputs) ? existing.outputs.length : 0;
        const incomingOutputsCount = Array.isArray(incoming.outputs) ? incoming.outputs.length : 0;
        Object.assign(existing, incoming);
        const rendered = renderedById.get(incoming.id);
        if (rendered) {
          Object.assign(rendered.data, incoming);
          // Update title and description in DOM
          const titleEl = rendered.element.querySelector('.node-title');
          const descEl = rendered.element.querySelector('.node-description');
          if (titleEl) titleEl.textContent = incoming.name || 'Untitled';
          if (descEl) descEl.textContent = incoming.goal || 'Description';
          const hasPosition = Number.isFinite(incoming.x) && Number.isFinite(incoming.y);
          const isDraggingThis = this.isDragging && this.selectedNode?.data?.id === incoming.id;
          if (hasPosition && !isDraggingThis) {
            rendered.x = incoming.x;
            rendered.y = incoming.y;
            rendered.element.style.transform = `translate(${incoming.x}px, ${incoming.y}px)`;
          }
        }
        this.updateNodeCardIndicators(incoming.id);
        if (
          existingEvidenceCount !== incomingEvidenceCount ||
          existingInputsCount !== incomingInputsCount ||
          existingOutputsCount !== incomingOutputsCount
        ) {
          needsRefresh = true;
        }
        if (incoming.activeTaskId || incoming.status === 'in-progress') {
          this.ensureGatewayStream(incoming.id);
        }
      } else {
        // New node
        this.state.nodes.push(incoming);
        needsRefresh = true;
        if (incoming.activeTaskId || incoming.status === 'in-progress') {
          this.ensureGatewayStream(incoming.id);
        }
      }
    });

    if (needsRefresh) {
      this.buildNodeIndex();
      this.refreshCurrentView();
    }

    const currentNodeId = this.currentPath[this.currentPath.length - 1]?.id;
    if (currentNodeId && incomingNodes.some(node => node.id === currentNodeId)) {
      this.updateEvidenceSidebar();
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

  normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
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
