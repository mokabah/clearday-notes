// Optional desktop shell. The web app is complete on its own; this only gives it a native window.
// NOTE: written against the documented Electron API (>= 28) but NOT run in the development
// environment, which had no Electron available. See docs/QA_REPORT.md.
const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = /^(index\.html|sw\.js|manifest\.webmanifest|icons\/|src\/(ui|core)\/)/;

protocol.registerSchemesAsPrivileged([{ scheme: 'clearday-notes', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1100, height: 760, minWidth: 520, minHeight: 480, backgroundColor: '#f6f3ee', title: 'Clearday Notes',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadURL('clearday-notes://app/index.html');
  // Never navigate the app window away, and open external links in the system browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('clearday-notes://')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(() => {
    protocol.handle('clearday-notes', (request) => {
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !PUBLIC.test(rel)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString());
    });
    Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
