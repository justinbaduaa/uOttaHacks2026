const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('glassBox', {
  startAuth: () => ipcRenderer.invoke('start-auth'),
  api: {
    listCanvases: (token) => ipcRenderer.invoke('api-list-canvases', token),
    createCanvas: (token, name) => ipcRenderer.invoke('api-create-canvas', { token, name }),
    listNodes: (token, canvasId) => ipcRenderer.invoke('api-list-nodes', { token, canvasId }),
  },
});
