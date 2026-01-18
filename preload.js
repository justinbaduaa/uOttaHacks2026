const { contextBridge, ipcRenderer } = require('electron');

// Initialize Sentry for renderer process
const Sentry = require('@sentry/electron/renderer');

Sentry.init({
  dsn: "https://425bf24215fb0f2b15cf752b09a5d7ae@o4510728718909440.ingest.us.sentry.io/4510728772648960",
});

console.log('Sentry initialized for renderer process');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('glassBox', {
  // API methods will be added here as we build features
  // Example: createNode, getNode, updateNode, deleteNode, etc.
  
  // Sentry integration - expose error capturing to renderer
  captureError: (error) => {
    Sentry.captureException(error);
  },
  captureMessage: (message) => {
    Sentry.captureMessage(message);
  }
});
