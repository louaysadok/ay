/**
 * desktop/main.cjs — Electron wrapper for Port Ops Simulator (Windows/macOS/Linux).
 *
 * Fully offline: no network access is requested, nothing is sent anywhere.
 * The game is served from a private app:// scheme (file:// would block the ES
 * modules and fetch() the game uses). Saves live in the game's own
 * localStorage, which Electron keeps in the per-user app-data folder.
 *
 *   npm run bundle && npx electron desktop/main.cjs
 */
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

/** dist/www when bundled (packaged build), otherwise the repository root (dev). */
function webRoot() {
  const candidates = [
    path.join(__dirname, '..', 'dist', 'www'),
    path.join(__dirname, '..')
  ];
  return candidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) || candidates[1];
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#071726',
    title: 'Port Ops Simulator',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: true      // the game also pauses itself when hidden
    }
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  // F11 / Alt+Enter toggle full screen — only while the game window has focus
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  win.loadURL('app://game/index.html');

  // never navigate away or open external windows from inside the game
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  const root = webRoot();
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  createWindow();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
