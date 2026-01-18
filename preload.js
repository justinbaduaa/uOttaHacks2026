const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('glassBox', {
  startAuth: () => ipcRenderer.invoke('start-auth'),
  api: {
    listCanvases: (token) => ipcRenderer.invoke('api-list-canvases', token),
    createCanvas: (token, name) => ipcRenderer.invoke('api-create-canvas', { token, name }),
    listNodes: (token, canvasId) => ipcRenderer.invoke('api-list-nodes', { token, canvasId }),
    createNode: (token, payload) => ipcRenderer.invoke('api-create-node', { token, payload }),
    updateNode: (token, nodeId, payload) => ipcRenderer.invoke('api-update-node', { token, nodeId, payload }),
    deleteNode: (token, nodeId, canvasId) => ipcRenderer.invoke('api-delete-node', { token, nodeId, canvasId }),
  },
});
