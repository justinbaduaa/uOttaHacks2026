const Sentry = require("@sentry/electron/main");
const { app, BrowserWindow } = require("electron");
const path = require("path");

// Initialize Sentry for error tracking in the main process
Sentry.init({
  dsn: "https://425bf24215fb0f2b15cf752b09a5d7ae@o4510728718909440.ingest.us.sentry.io/4510728772648960",
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    // Modern window appearance
    titleBarStyle: "hiddenInset",
    backgroundColor: "#F5F7FA",
  });

  // Load directly from frontend folder
  mainWindow.loadFile(path.join(__dirname, "frontend", "index.html"));

  // Open DevTools in development
  if (process.argv.includes("--dev")) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
