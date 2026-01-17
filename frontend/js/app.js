/**
 * Glass Box - Main Application Entry Point
 * A transparent workspace for exploring work execution
 */

// Application state
const state = {
  currentNode: null,
  nodes: [],
  canvas: {
    zoom: 1,
    panX: 0,
    panY: 0
  }
};

// Initialize the application
function init() {
  console.log('Glass Box initialized');
  // Application initialization will happen here
}

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', init);
