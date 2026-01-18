const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('glassBox', {
  startAuth: () => ipcRenderer.invoke('start-auth'),
  api: {
    listCanvases: (token) => ipcRenderer.invoke('api-list-canvases', token),
    getCanvasEvidence: (token, canvasId) => ipcRenderer.invoke('api-get-canvas-evidence', { token, canvasId }),
    updateCanvasEvidence: (token, canvasId, evidence) => ipcRenderer.invoke('api-update-canvas-evidence', { token, canvasId, evidence }),
    createCanvas: (token, name) => ipcRenderer.invoke('api-create-canvas', { token, name }),
    listNodes: (token, canvasId, updatedSince) => ipcRenderer.invoke('api-list-nodes', { token, canvasId, updatedSince }),
    createNode: (token, payload) => ipcRenderer.invoke('api-create-node', { token, payload }),
    updateNode: (token, nodeId, payload) => ipcRenderer.invoke('api-update-node', { token, nodeId, payload }),
    deleteNode: (token, nodeId, canvasId) => ipcRenderer.invoke('api-delete-node', { token, nodeId, canvasId }),
    joinCanvas: (token, joinCode) => ipcRenderer.invoke('api-join-canvas', { token, joinCode }),
    presignFile: (token, payload) => ipcRenderer.invoke('api-presign-file', { token, payload }),
    completeFile: (token, payload) => ipcRenderer.invoke('api-complete-file', { token, payload }),
    downloadFile: (token, payload) => ipcRenderer.invoke('api-download-file', { token, payload }),
    executeNode: (token, nodeId, payload) => ipcRenderer.invoke('api-execute-node', { token, nodeId, payload }),
    approveNodeAction: (token, nodeId, payload) => ipcRenderer.invoke('api-approve-node-action', { token, nodeId, payload }),
    leavePresence: (token, canvasId) => ipcRenderer.invoke('api-leave-presence', { token, canvasId }),
    uploadToS3: (url, contentType, data) => ipcRenderer.invoke('api-upload-s3', { url, contentType, data }),
    startGatewayStream: (payload) => ipcRenderer.invoke('gateway-stream-start', payload),
    stopGatewayStream: (payload) => ipcRenderer.invoke('gateway-stream-stop', payload),
    onGatewayStreamEvent: (handler) => ipcRenderer.on('gateway-stream-event', (_event, data) => handler(data)),
    onGatewayStreamError: (handler) => ipcRenderer.on('gateway-stream-error', (_event, data) => handler(data)),
  },
});
