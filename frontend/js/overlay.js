const { ipcRenderer } = require('electron');

const dropZone = document.getElementById('dropZone');

// Drag Enter / Over - Expand the box
// We use 'dragenter' on the document to catch drags anywhere in the window
document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dropZone.classList.add('active');
});

document.addEventListener('dragover', (e) => {
    e.preventDefault();
    // Keep it active while dragging over
    if (!dropZone.classList.contains('active')) {
        dropZone.classList.add('active');
    }
});

// Drag Leave - Collapse if leaving the window
document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    
    // Only remove if we're actually leaving the window or the drop zone
    // simplistic check: if relatedTarget is null, we likely left the window
    if (e.clientX === 0 && e.clientY === 0) {
        dropZone.classList.remove('active');
    }
});

// Drop - Handle the file
document.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('active');

    const files = Array.from(e.dataTransfer.files);
    
    if (files.length > 0) {
        // Prepare file data to send
        const fileData = files.map(f => ({
            name: f.name,
            path: f.path,
            size: f.size,
            type: f.type,
            lastModified: f.lastModified
        }));

        // Send to main process
        ipcRenderer.send('overlay-file-dropped', fileData);
        
        // Visual feedback (optional flash or success state)
        console.log('Files dropped:', fileData);
    }
});
