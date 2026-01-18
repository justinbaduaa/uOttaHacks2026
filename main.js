const { app, BrowserWindow, ipcMain } = require("electron");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const path = require("path");

if (process.platform === "darwin") {
  app.name = "GlassBox";
}

const COGNITO_DOMAIN = "https://glassbox-846532307761-us-east-1.auth.us-east-1.amazoncognito.com";
const COGNITO_CLIENT_ID = "3pmncf4qmok3oa6e7otpk17j0e";
const COGNITO_REDIRECT_URI = "http://localhost:8787/callback";
const COGNITO_SCOPES = "openid email profile";
const API_BASE_URL = "https://58icbv6e7h.execute-api.us-east-1.amazonaws.com";
const API_TIMEOUT_MS = 15000;
const GATEWAY_BASE_URL = process.env.GATEWAY_BASE_URL || "http://13.218.40.115:8001";

let mainWindow;
let authWindow;
let authInFlight;
const gatewayStreams = new Map();

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
    icon: path.join(__dirname, "frontend", "public", "app icon.png"),
  });

  if (process.platform === "darwin") {
    app.dock.setIcon(path.join(__dirname, "frontend", "public", "app icon.png"));
  }

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

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

function buildGatewayStreamUrl(canvasId, nodeId, since) {
  const url = new URL("/stream", GATEWAY_BASE_URL);
  url.searchParams.set("canvasId", canvasId);
  url.searchParams.set("nodeId", nodeId);
  if (since) {
    url.searchParams.set("since", since);
  }
  return url;
}

function stopGatewayStream(streamKey) {
  const existing = gatewayStreams.get(streamKey);
  if (existing) {
    existing.request.destroy();
    gatewayStreams.delete(streamKey);
  }
}

function startGatewayStream({ canvasId, nodeId, token, since }) {
  if (!canvasId || !nodeId) {
    throw new Error("canvasId and nodeId are required");
  }
  const streamKey = `${canvasId}:${nodeId}`;
  stopGatewayStream(streamKey);

  const url = buildGatewayStreamUrl(canvasId, nodeId, since);
  const isSecure = url.protocol === "https:";
  const client = isSecure ? https : http;

  const headers = {
    Accept: "text/event-stream",
  };
  if (token) {
    headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }

  const request = client.request(
    url,
    {
      method: "GET",
      headers,
    },
    (response) => {
      response.setEncoding("utf8");
      let buffer = "";

      response.on("data", (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf("\n\n");
        while (index !== -1) {
          const raw = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = raw.split(/\r?\n/);
          let eventName = "";
          const dataLines = [];
          lines.forEach((line) => {
            if (line.startsWith("event:")) {
              eventName = line.slice(6).trim();
              return;
            }
            if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          });
          if (!dataLines.length) {
            index = buffer.indexOf("\n\n");
            return;
          }
          const dataRaw = dataLines.join("\n");
          let parsed = dataRaw;
          try {
            parsed = JSON.parse(dataRaw);
          } catch (error) {
            parsed = dataRaw;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("gateway-stream-event", {
              canvasId,
              nodeId,
              event: eventName || "message",
              data: parsed,
            });
          }
          index = buffer.indexOf("\n\n");
        }
      });

      response.on("end", () => {
        gatewayStreams.delete(streamKey);
      });

      response.on("error", (error) => {
        gatewayStreams.delete(streamKey);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("gateway-stream-error", {
            canvasId,
            nodeId,
            error: error.message || "Gateway stream error",
          });
        }
      });
    }
  );

  request.on("error", (error) => {
    gatewayStreams.delete(streamKey);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("gateway-stream-error", {
        canvasId,
        nodeId,
        error: error.message || "Gateway stream error",
      });
    }
  });

  request.end();
  gatewayStreams.set(streamKey, { request });
  return { ok: true, streamKey };
}

ipcMain.handle("api-list-canvases", async (event, token) => {
  return apiRequest({ path: "/canvases", method: "GET", token });
});

ipcMain.handle("api-get-canvas-evidence", async (event, { token, canvasId }) => {
  if (!canvasId) {
    throw new Error("Missing canvasId");
  }
  return apiRequest({ path: `/canvases/${canvasId}/evidence`, method: "GET", token });
});

ipcMain.handle("api-update-canvas-evidence", async (event, { token, canvasId, evidence }) => {
  if (!canvasId) {
    throw new Error("Missing canvasId");
  }
  return apiRequest({
    path: `/canvases/${canvasId}/evidence`,
    method: "PATCH",
    token,
    body: { evidence },
  });
});

ipcMain.handle("api-create-canvas", async (event, { token, name }) => {
  return apiRequest({ path: "/canvases", method: "POST", token, body: { name } });
});

ipcMain.handle("api-list-nodes", async (event, { token, canvasId, updatedSince }) => {
  const params = new URLSearchParams({
    canvasId,
    includeAll: "true",
    includeDeleted: "false",
  });
  if (updatedSince) {
    params.append("updatedSince", updatedSince);
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
  if (payload?.x !== undefined && payload?.y !== undefined) {
    body.x = payload.x;
    body.y = payload.y;
  }
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
  if (payload.x !== undefined && payload.y !== undefined) {
    body.x = payload.x;
    body.y = payload.y;
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

ipcMain.handle("api-join-canvas", async (event, { token, joinCode }) => {
  if (!joinCode) {
    throw new Error("Missing joinCode");
  }
  return apiRequest({ path: "/canvases/join", method: "POST", token, body: { joinCode } });
});

ipcMain.handle("api-presign-file", async (event, { token, payload }) => {
  const body = {
    canvasId: payload?.canvasId,
    nodeId: payload?.nodeId,
    slot: payload?.slot,
    filename: payload?.filename,
    contentType: payload?.contentType,
    scope: payload?.scope,
  };
  return apiRequest({ path: "/files/presign", method: "POST", token, body });
});

ipcMain.handle("api-complete-file", async (event, { token, payload }) => {
  const body = {
    canvasId: payload?.canvasId,
    nodeId: payload?.nodeId,
    slot: payload?.slot,
    fileId: payload?.fileId,
    s3Key: payload?.s3Key,
    filename: payload?.filename,
    contentType: payload?.contentType,
    scope: payload?.scope,
  };
  return apiRequest({ path: "/files/complete", method: "POST", token, body });
});

ipcMain.handle("api-download-file", async (event, { token, payload }) => {
  const body = {
    canvasId: payload?.canvasId,
    nodeId: payload?.nodeId,
    fileId: payload?.fileId,
    s3Key: payload?.s3Key,
    scope: payload?.scope,
  };
  return apiRequest({ path: "/files/download", method: "POST", token, body });
});

ipcMain.handle("api-execute-node", async (event, { token, nodeId, payload }) => {
  if (!nodeId) {
    throw new Error("Missing nodeId");
  }
  if (!payload?.canvasId) {
    throw new Error("Missing canvasId");
  }
  const body = {
    canvasId: payload.canvasId,
  };
  if (payload.approvalMode) {
    body.approvalMode = payload.approvalMode;
  }
  return apiRequest({ path: `/nodes/${nodeId}/execute`, method: "POST", token, body });
});

ipcMain.handle("api-approve-node-action", async (event, { token, nodeId, payload }) => {
  if (!nodeId) {
    throw new Error("Missing nodeId");
  }
  if (!payload?.canvasId) {
    throw new Error("Missing canvasId");
  }
  const body = {
    canvasId: payload.canvasId,
    approvalId: payload.approvalId,
    decision: payload.decision,
  };
  if (payload.reason) {
    body.reason = payload.reason;
  }
  return apiRequest({ path: `/nodes/${nodeId}/approve`, method: "POST", token, body });
});

ipcMain.handle("api-leave-presence", async (event, { token, canvasId }) => {
  if (!canvasId) {
    throw new Error("Missing canvasId");
  }
  return apiRequest({ path: "/presence/leave", method: "POST", token, body: { canvasId } });
});

ipcMain.handle("api-upload-s3", async (event, { url, contentType, data }) => {
  if (!url) {
    throw new Error("Missing upload URL");
  }
  const body = Buffer.from(data || []);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`S3 upload failed (${response.status}) ${text}`.trim());
  }
  return { ok: true };
});

ipcMain.handle("gateway-stream-start", async (event, payload) => {
  return startGatewayStream(payload || {});
});

ipcMain.handle("gateway-stream-stop", async (event, payload) => {
  if (!payload?.canvasId || !payload?.nodeId) {
    return { ok: false };
  }
  const streamKey = `${payload.canvasId}:${payload.nodeId}`;
  stopGatewayStream(streamKey);
  return { ok: true };
});
