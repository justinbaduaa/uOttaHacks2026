const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('glassBox', {
  // API methods will be added here as we build features
  // Example: createNode, getNode, updateNode, deleteNode, etc.
});
