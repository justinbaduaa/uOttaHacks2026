/**
 * Glass Box - Main Application
 * A transparent workspace for exploring work execution
 */

// ============================================
// Application State
// ============================================

const App = {
  currentNodeId: null,
  navigationHistory: [],
  authToken: null,
  
  // DOM Elements
  elements: {},
  
  // ============================================
  // Initialization
  // ============================================
  
  async init() {
    this.cacheElements();
    this.setupEventListeners();
    await this.ensureAuth();
    this.renderRootNodes();
    this.populateTargetSelect();
    console.log('Glass Box initialized');
  },
  
  cacheElements() {
    this.elements = {
      canvas: document.getElementById('canvas'),
      canvasContainer: document.getElementById('canvasContainer'),
      breadcrumb: document.getElementById('breadcrumb'),
      detailPanel: document.getElementById('detailPanel'),
      detailName: document.getElementById('detailName'),
      detailAuthor: document.getElementById('detailAuthor'),
      detailGoal: document.getElementById('detailGoal'),
      detailResult: document.getElementById('detailResult'),
      evidenceList: document.getElementById('evidenceList'),
      nestedList: document.getElementById('nestedList'),
      backBtn: document.getElementById('backBtn'),
      captureBtn: document.getElementById('captureBtn'),
      captureModal: document.getElementById('captureModal'),
      closeCaptureModal: document.getElementById('closeCaptureModal'),
      dropZone: document.getElementById('dropZone'),
      noteInput: document.getElementById('noteInput'),
      noteSubmit: document.getElementById('noteSubmit'),
      targetSelect: document.getElementById('targetSelect')
    };
  },
  
  setupEventListeners() {
    // Back button
    this.elements.backBtn.addEventListener('click', () => this.navigateBack());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.elements.captureModal.classList.contains('open')) {
          this.closeCaptureModal();
        } else if (this.elements.detailPanel.classList.contains('open')) {
          this.closeDetailPanel();
        }
      }
    });
    
    // Capture modal
    this.elements.captureBtn.addEventListener('click', () => this.openCaptureModal());
    this.elements.closeCaptureModal.addEventListener('click', () => this.closeCaptureModal());
    this.elements.captureModal.addEventListener('click', (e) => {
      if (e.target === this.elements.captureModal) {
        this.closeCaptureModal();
      }
    });
    
    // Drop zone
    this.setupDropZone();
    
    // Note submit
    this.elements.noteSubmit.addEventListener('click', () => this.submitNote());
    this.elements.noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitNote();
    });
    
    // Breadcrumb clicks
    this.elements.breadcrumb.addEventListener('click', (e) => {
      const item = e.target.closest('.breadcrumb-item');
      if (item) {
        const id = item.dataset.id;
        if (id === 'root') {
          this.navigateToRoot();
        } else {
          this.navigateToNode(id);
        }
      }
    });
  },
  
  setupDropZone() {
    const dropZone = this.elements.dropZone;
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
      dropZone.addEventListener(event, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });
    
    ['dragenter', 'dragover'].forEach(event => {
      dropZone.addEventListener(event, () => dropZone.classList.add('dragover'));
    });
    
    ['dragleave', 'drop'].forEach(event => {
      dropZone.addEventListener(event, () => dropZone.classList.remove('dragover'));
    });
    
    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        console.log('Files dropped:', Array.from(files).map(f => f.name));
        // In production, would handle file upload here
      }
    });
  },
  
  // ============================================
  // Navigation
  // ============================================
  
  navigateToRoot() {
    this.currentNodeId = null;
    this.navigationHistory = [];
    this.updateBreadcrumb([]);
    this.closeDetailPanel();
    this.renderRootNodes();
  },
  
  navigateToNode(nodeId) {
    const node = GlassBoxData.getNode(nodeId);
    if (!node) return;
    
    if (this.currentNodeId) {
      this.navigationHistory.push(this.currentNodeId);
    }
    
    this.currentNodeId = nodeId;
    
    const parentChain = GlassBoxData.getParentChain(nodeId);
    this.updateBreadcrumb([...parentChain, node]);
    
    this.openDetailPanel(node);
    
    const children = GlassBoxData.getChildNodes(nodeId);
    if (children.length > 0) {
      this.renderNodes(children);
    } else {
      this.renderNodes([node]);
    }
  },
  
  navigateBack() {
    if (this.navigationHistory.length > 0) {
      const previousId = this.navigationHistory.pop();
      this.currentNodeId = previousId;
      const node = GlassBoxData.getNode(previousId);
      const parentChain = GlassBoxData.getParentChain(previousId);
      this.updateBreadcrumb([...parentChain, node]);
      this.openDetailPanel(node);
      
      const children = GlassBoxData.getChildNodes(previousId);
      if (children.length > 0) {
        this.renderNodes(children);
      } else {
        this.renderNodes([node]);
      }
    } else {
      this.navigateToRoot();
    }
  },
  
  // ============================================
  // Rendering
  // ============================================
  
  renderRootNodes() {
    const nodes = GlassBoxData.getRootNodes();
    this.renderNodes(nodes);
  },
  
  renderNodes(nodes) {
    this.elements.canvas.innerHTML = nodes.map(node => this.createNodeHTML(node)).join('');
    
    // Add click handlers
    this.elements.canvas.querySelectorAll('.glass-node').forEach(el => {
      el.addEventListener('click', () => {
        this.navigateToNode(el.dataset.id);
      });
    });
  },
  
  createNodeHTML(node) {
    const evidenceCount = node.evidence ? node.evidence.length : 0;
    const childCount = node.children ? node.children.length : 0;
    
    return `
      <article class="glass-node" data-id="${node.id}">
        <div class="node-header">
          <div class="node-title">
            <h3>${this.escapeHtml(node.name)}</h3>
            <span class="node-id">${node.id}</span>
          </div>
          <div class="node-avatar" title="${this.escapeHtml(node.author.name)}">
            ${node.author.initials}
          </div>
        </div>
        
        <p class="node-goal">${this.escapeHtml(node.goal)}</p>
        
        <div class="node-footer">
          <div class="node-stats">
            ${evidenceCount > 0 ? `
              <span class="node-stat evidence">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                ${evidenceCount}
              </span>
            ` : ''}
            ${childCount > 0 ? `
              <span class="node-stat children">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" opacity="0.4"/>
                  <rect x="7" y="7" width="10" height="10" rx="1" ry="1"/>
                </svg>
                ${childCount}
              </span>
            ` : ''}
          </div>
          ${this.createStatusBadge(node)}
        </div>
      </article>
    `;
  },
  
  createStatusBadge(node) {
    if (node.status === 'complete') {
      return `
        <div class="node-status complete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          Complete
        </div>
      `;
    } else if (node.status === 'in-progress') {
      return `
        <div class="node-status in-progress">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          In Progress
        </div>
      `;
    } else {
      return `
        <div class="node-status pending">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
          </svg>
          Pending
        </div>
      `;
    }
  },
  
  // ============================================
  // Breadcrumb
  // ============================================
  
  updateBreadcrumb(nodes) {
    let html = `
      <button class="breadcrumb-item ${nodes.length === 0 ? 'active' : ''}" data-id="root">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
        Workspace
      </button>
    `;
    
    nodes.forEach((node, i) => {
      const isLast = i === nodes.length - 1;
      html += `
        <span class="breadcrumb-separator">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </span>
        <button class="breadcrumb-item ${isLast ? 'active' : ''}" data-id="${node.id}">
          ${this.escapeHtml(node.name)}
        </button>
      `;
    });
    
    this.elements.breadcrumb.innerHTML = html;
  },
  
  // ============================================
  // Detail Panel
  // ============================================
  
  openDetailPanel(node) {
    this.elements.detailName.textContent = node.name;
    this.elements.detailAuthor.innerHTML = `
      <span class="avatar">${node.author.initials}</span>
      <span>${this.escapeHtml(node.author.name)}</span>
    `;
    this.elements.detailGoal.textContent = node.goal;
    
    if (node.result) {
      this.elements.detailResult.textContent = node.result;
      this.elements.detailResult.className = 'result-box';
    } else {
      this.elements.detailResult.textContent = 'Work in progress...';
      this.elements.detailResult.className = 'result-box pending';
    }
    
    this.renderEvidence(node.evidence || []);
    this.renderNestedBoxes(node.id);
    
    this.elements.detailPanel.classList.add('open');
  },
  
  closeDetailPanel() {
    this.elements.detailPanel.classList.remove('open');
  },
  
  renderEvidence(evidence) {
    if (evidence.length === 0) {
      this.elements.evidenceList.innerHTML = `
        <div class="empty-state">
          <p>No evidence recorded yet</p>
        </div>
      `;
      return;
    }
    
    this.elements.evidenceList.innerHTML = evidence.map(ev => this.createEvidenceHTML(ev)).join('');
    
    // Add click handlers for references
    this.elements.evidenceList.querySelectorAll('.evidence-item[data-node-id]').forEach(el => {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        this.navigateToNode(el.dataset.nodeId);
      });
    });
  },
  
  createEvidenceHTML(evidence) {
    const timestamp = GlassBoxData.formatTimestamp(evidence.timestamp);
    const icons = {
      note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>`,
      file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>`,
      link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
      </svg>`,
      reference: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" opacity="0.4"/>
        <rect x="7" y="7" width="10" height="10" rx="1" ry="1"/>
      </svg>`
    };
    
    let title, meta;
    const nodeIdAttr = evidence.type === 'reference' ? `data-node-id="${evidence.nodeId}"` : '';
    
    switch (evidence.type) {
      case 'note':
        title = evidence.content;
        meta = timestamp;
        break;
      case 'file':
        title = evidence.name;
        meta = `${evidence.size} • ${timestamp}`;
        break;
      case 'link':
        title = evidence.title;
        meta = timestamp;
        break;
      case 'reference':
        title = `→ ${evidence.nodeName}`;
        meta = `Reference • ${timestamp}`;
        break;
    }
    
    return `
      <div class="evidence-item" ${nodeIdAttr}>
        <div class="evidence-icon ${evidence.type}">
          ${icons[evidence.type]}
        </div>
        <div class="evidence-content">
          <div class="title">${this.escapeHtml(title)}</div>
          <div class="meta">${meta}</div>
        </div>
      </div>
    `;
  },
  
  renderNestedBoxes(parentId) {
    const children = GlassBoxData.getChildNodes(parentId);
    
    if (children.length === 0) {
      this.elements.nestedList.innerHTML = `
        <div class="empty-state">
          <p>No nested boxes</p>
        </div>
      `;
      return;
    }
    
    this.elements.nestedList.innerHTML = children.map(child => `
      <div class="nested-item" data-id="${child.id}">
        <div class="nested-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" opacity="0.4"/>
            <rect x="7" y="7" width="10" height="10" rx="1" ry="1"/>
          </svg>
        </div>
        <div class="nested-info">
          <div class="name">${this.escapeHtml(child.name)}</div>
          <div class="preview">${this.escapeHtml(child.goal.substring(0, 50))}${child.goal.length > 50 ? '...' : ''}</div>
        </div>
        <div class="nested-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
      </div>
    `).join('');
    
    this.elements.nestedList.querySelectorAll('.nested-item').forEach(el => {
      el.addEventListener('click', () => {
        this.navigateToNode(el.dataset.id);
      });
    });
  },
  

  
  // ============================================
  // Capture Modal
  // ============================================
  
  openCaptureModal() {
    this.elements.captureModal.classList.add('open');
  },
  
  closeCaptureModal() {
    this.elements.captureModal.classList.remove('open');
  },
  
  submitNote() {
    const note = this.elements.noteInput.value.trim();
    const targetId = this.elements.targetSelect.value;
    
    if (!note || !targetId) {
      console.log('Please enter a note and select a target');
      return;
    }
    
    console.log('Submitting note:', { note, targetId });
    // In production, would save to backend
    
    this.elements.noteInput.value = '';
    this.closeCaptureModal();
  },
  
  populateTargetSelect() {
    const nodes = GlassBoxData.getAllNodes();
    this.elements.targetSelect.innerHTML = `
      <option value="">Select target...</option>
      ${nodes.map(n => `<option value="${n.id}">${this.escapeHtml(n.name)}</option>`).join('')}
    `;
  },
  
  // ============================================
  // Utilities
  // ============================================

  getStoredToken() {
    return localStorage.getItem('glassbox.authToken');
  },

  setStoredToken(token) {
    localStorage.setItem('glassbox.authToken', token);
  },

  async ensureAuth() {
    const existing = this.getStoredToken();
    if (existing) {
      this.authToken = existing;
      return;
    }

    if (!window.glassBox || !window.glassBox.startAuth) {
      console.warn('Auth bridge not available. Cannot start Hosted UI login.');
      return;
    }

    try {
      const response = await window.glassBox.startAuth();
      const token =
        typeof response === 'string'
          ? response
          : response?.idToken || response?.id_token || response?.token || '';
      if (token) {
        this.setStoredToken(token);
        this.authToken = token;
      }
    } catch (error) {
      console.error('Authentication failed:', error);
    }
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
