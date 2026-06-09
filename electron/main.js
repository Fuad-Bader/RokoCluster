// Electron main process. In development it loads the Vite dev server; in a
// packaged build it launches the bundled backend (which serves the built
// frontend) and points the window at it. The backend uses the user's local
// kubeconfig, so the desktop app manages whatever cluster `kubectl` would.
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

const isDev = process.env.ELECTRON_DEV === '1';
const PORT = Number(process.env.PORT || 4000);
const DEV_URL = 'http://localhost:5173';
const PROD_URL = `http://localhost:${PORT}`;

let backendProc = null;
let win = null;

function resourcePath(...p) {
  // In a packaged app, extraResources land under process.resourcesPath.
  return app.isPackaged
    ? path.join(process.resourcesPath, ...p)
    : path.join(__dirname, '..', ...p);
}

function startBackend() {
  const entry = resourcePath('backend', 'dist', 'index.js');
  backendProc = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(PORT),
      KUBE_AUTH: 'default',
      STATIC_DIR: resourcePath('frontend'),
      // Allow the Electron origin (file://) and localhost to call the API.
      CORS_ORIGINS: PROD_URL,
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'inherit',
  });
  backendProc.on('exit', (code) => console.log(`[roko] backend exited: ${code}`));
}

function waitForBackend(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const ping = () => {
      http
        .get(`${url}/api/health`, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (Date.now() > deadline) reject(new Error('backend did not start'));
          else setTimeout(ping, 400);
        });
    };
    ping();
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#0b0e14',
    title: 'RokoCluster',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the system browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    await win.loadURL(DEV_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    startBackend();
    try {
      await waitForBackend(PROD_URL);
    } catch (e) {
      console.error(e);
    }
    await win.loadURL(PROD_URL);
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('quit', () => {
  if (backendProc) backendProc.kill();
});
