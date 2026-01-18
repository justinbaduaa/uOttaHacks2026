const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const http = require("http");
const path = require("path");

const COGNITO_DOMAIN = "https://glassbox-244271315858-us-east-1.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "6260nb86n0snfo7ej0edmc1thj";
const COGNITO_REDIRECT_URI = "http://localhost:8787/callback";
const COGNITO_SCOPES = "openid email profile";
const API_BASE_URL = "https://jwsg89orxe.execute-api.us-east-1.amazonaws.com";

let mainWindow;
let authWindow;
let authInFlight;

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

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateCodeVerifier() {
  return base64UrlEncode(crypto.randomBytes(32));
}

function generateCodeChallenge(verifier) {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return base64UrlEncode(hash);
}

function startAuthServer(onCode) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400);
        res.end();
        return;
      }
      const url = new URL(req.url, "http://localhost:8787");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>Login complete. You can close this window.</body></html>");

      if (!code) {
        onCode(new Error("Missing code in callback"), null);
      } else {
        onCode(null, { code, state });
      }

      server.close();
    });

    server.on("error", (err) => reject(err));
    server.listen(8787, () => resolve(server));
  });
}

async function exchangeCodeForToken(code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: COGNITO_CLIENT_ID,
    code,
    redirect_uri: COGNITO_REDIRECT_URI,
    code_verifier: verifier,
  });

  const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload.error_description || payload.error || "Token exchange failed";
    throw new Error(message);
  }

  return payload.id_token;
}

async function startAuthFlow() {
  if (authInFlight) {
    return authInFlight;
  }

  authInFlight = new Promise(async (resolve, reject) => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = base64UrlEncode(crypto.randomBytes(16));

    try {
      await startAuthServer(async (err, result) => {
        if (err) {
          reject(err);
          return;
        }

        if (result.state && result.state !== state) {
          reject(new Error("State mismatch during authentication"));
          return;
        }

        try {
          const token = await exchangeCodeForToken(result.code, verifier);
          resolve(token);
        } catch (exchangeError) {
          reject(exchangeError);
        } finally {
          authInFlight = null;
          if (authWindow) {
            authWindow.close();
            authWindow = null;
          }
        }
      });

      const authUrl = new URL(`${COGNITO_DOMAIN}/login`);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("client_id", COGNITO_CLIENT_ID);
      authUrl.searchParams.set("redirect_uri", COGNITO_REDIRECT_URI);
      authUrl.searchParams.set("scope", COGNITO_SCOPES);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("state", state);

      authWindow = new BrowserWindow({
        width: 520,
        height: 720,
        resizable: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      authWindow.loadURL(authUrl.toString());
      authWindow.on("closed", () => {
        authWindow = null;
      });
    } catch (startError) {
      authInFlight = null;
      reject(startError);
    }
  });

  return authInFlight;
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

ipcMain.handle("start-auth", async () => startAuthFlow());

async function apiRequest({ path, method = "GET", body, token }) {
  if (!token) {
    throw new Error("Missing auth token");
  }

  const url = `${API_BASE_URL}${path}`;
  const startTime = Date.now();
  console.log(`[API] -> ${method} ${url}`);
  if (body) {
    console.log(`[API] payload: ${JSON.stringify(body)}`);
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    console.error(`[API] <- ${method} ${url} invalid JSON`);
    throw new Error("Invalid JSON response");
  }

  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.error?.message || payload?.message || "Request failed";
    console.error(`[API] <- ${method} ${url} ${response.status} ${message}`);
    console.error(`[API] response: ${JSON.stringify(payload)}`);
    throw new Error(message);
  }

  const durationMs = Date.now() - startTime;
  console.log(`[API] <- ${method} ${url} ${response.status} (${durationMs}ms)`);
  console.log(`[API] response: ${JSON.stringify(payload)}`);

  return payload.data;
}

ipcMain.handle("api-list-canvases", async (event, token) => {
  return apiRequest({ path: "/canvases", method: "GET", token });
});

ipcMain.handle("api-create-canvas", async (event, { token, name }) => {
  return apiRequest({ path: "/canvases", method: "POST", token, body: { name } });
});

ipcMain.handle("api-join-canvas", async (event, { token, code }) => {
  return apiRequest({
    path: "/canvases/join",
    method: "POST",
    token,
    body: { joinCode: code },
  });
});

ipcMain.handle("api-list-nodes", async (event, { token, canvasId, updatedSince, includeAll = true }) => {
  const params = new URLSearchParams({
    canvasId,
    includeAll: includeAll ? "true" : "false",
  });
  if (updatedSince) {
    params.set("updatedSince", updatedSince);
  }
  return apiRequest({ path: `/nodes?${params.toString()}`, method: "GET", token });
});

ipcMain.handle("api-create-node", async (event, { token, payload }) => {
  const body = {
    canvasId: payload?.canvasId,
    parentNodeId: payload?.parentNodeId || "ROOT",
    title: payload?.title,
    description: payload?.description,
    inputs: payload?.inputs || [],
    outputs: payload?.outputs || [],
    evidence: payload?.evidence,
  };
  return apiRequest({ path: "/nodes", method: "POST", token, body });
});

ipcMain.handle("api-update-node", async (event, { token, nodeId, payload }) => {
  if (!nodeId) {
    throw new Error("Missing nodeId");
  }
  if (!payload?.canvasId) {
    throw new Error("Missing canvasId");
  }
  const body = {
    canvasId: payload.canvasId,
  };
  if (payload.title !== undefined) {
    body.title = payload.title;
  }
  if (payload.description !== undefined) {
    body.description = payload.description;
  }
  if (payload.inputs !== undefined) {
    body.inputs = payload.inputs;
  }
  if (payload.outputs !== undefined) {
    body.outputs = payload.outputs;
  }
  if (payload.evidence !== undefined) {
    body.evidence = payload.evidence;
  }
  return apiRequest({ path: `/nodes/${nodeId}`, method: "PATCH", token, body });
});

ipcMain.handle("api-delete-node", async (event, { token, nodeId, canvasId }) => {
  if (!nodeId) {
    throw new Error("Missing nodeId");
  }
  if (!canvasId) {
    throw new Error("Missing canvasId");
  }
  const params = new URLSearchParams({ canvasId });
  return apiRequest({ path: `/nodes/${nodeId}?${params.toString()}`, method: "DELETE", token });
});
