'use strict';

// PenPlot Studio desktop shell. One window that serves the bundled static web app (desktop/app/, staged by
// prepare.mjs) from a privileged custom scheme, app://penplot/. file:// is avoided on purpose: fonts.js skips
// local fetch() on file: pages and IndexedDB is unreliable there.

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const APP_ID = 'com.joshuamontierth.penplotstudio';
const SCHEME = 'app';
const HOST = 'penplot';
const ORIGIN = `${SCHEME}://${HOST}`;
const APP_DIR = path.join(__dirname, 'app');
const ICON = path.join(__dirname, 'build', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');

// Must run before the app is ready. standard + secure give the page a real, stable origin (IndexedDB,
// localStorage, blob: downloads); supportFetchAPI + corsEnabled let fetch() read vendor/ fonts.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/** True for app://penplot and anything under it. (Not `new URL().origin`: that is "null" for custom schemes.) */
function isAppUrl(url) {
  return typeof url === 'string' && (url === ORIGIN || url.startsWith(`${ORIGIN}/`));
}

/** Map an app:// request URL to a file inside APP_DIR, or null if it points anywhere else. */
function resolveAppFile(requestUrl) {
  let url;
  let pathname;
  try {
    url = new URL(requestUrl);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:` || url.hostname !== HOST || pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';
  // Path traversal guard: whatever the encoding tricks (%2e%2e, %2f, backslashes on Windows), the resolved
  // file must still be inside APP_DIR.
  const file = path.resolve(APP_DIR, `.${pathname}`);
  const rel = path.relative(APP_DIR, file);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return file;
}

async function handleAppRequest(request) {
  const file = resolveAppFile(request.url);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await fs.readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function openExternal(url) {
  try {
    const { protocol: p } = new URL(url);
    if (p === 'http:' || p === 'https:') shell.openExternal(url);
  } catch {
    // not a URL: ignore
  }
}

// Only our own origin may ask for permissions, and only for these. Downloads (.gcode / .penplot.json / .svg) and
// <input type=file> pickers are not permission-gated. local-fonts is window.queryLocalFonts() (system fonts for
// the Text tab); fileSystem is the File System Access pickers; the clipboard ones are navigator.clipboard.
const ALLOWED_PERMISSIONS = new Set(['local-fonts', 'fileSystem', 'clipboard-sanitized-write', 'clipboard-read']);

function setupPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details && details.requestingUrl));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    return (
      ALLOWED_PERMISSIONS.has(permission) && (isAppUrl(requestingOrigin) || isAppUrl(details && details.requestingUrl))
    );
  });
}

// Saving. A blob download asks once per file, all dialogs at once, titled with the blob: address, and the page can't
// tell whether anything was saved. So the page hands its files over (preload.js): one file gets a Save dialog,
// several get one folder dialog, and the page hears back only once they are written. PP_TEST_SAVE_DIR (smoke test)
// skips the dialogs and saves there.
let lastSaveDir = null;

/** A plain file name: no folders, no characters Windows refuses. */
function safeName(name) {
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must go
  const BAD = /[<>:"/\\|?*\x00-\x1f]/g;
  const base = path
    .basename(String(name || ''))
    .replace(BAD, '_')
    .replace(/^[. ]+|[. ]+$/g, '');
  return base.slice(0, 200) || 'file';
}

async function saveFiles(event, files, opts) {
  if (!isAppUrl(event.senderFrame && event.senderFrame.url))
    throw new Error('Saving is only allowed for the app page.');
  if (!Array.isArray(files) || !files.length) return { canceled: true };
  const used = new Set();
  const items = files.map((f) => {
    let name = safeName(f && f.name);
    for (let n = 2; used.has(name.toLowerCase()); n++) name = safeName(f.name).replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(name.toLowerCase());
    return { name, data: typeof f.data === 'string' ? f.data : Buffer.from(f.data) };
  });
  const win = BrowserWindow.fromWebContents(event.sender);
  const title = opts && typeof opts.title === 'string' ? opts.title : '';
  const startDir = lastSaveDir || app.getPath('downloads');
  const testDir = process.env.PP_TEST_SAVE_DIR;

  if (items.length === 1) {
    const it = items[0];
    let file = testDir ? path.join(testDir, it.name) : null;
    if (!file) {
      const ext = path.extname(it.name).slice(1);
      const r = await dialog.showSaveDialog(win, {
        title: title || `Save ${it.name}`,
        defaultPath: path.join(startDir, it.name),
        filters: ext
          ? [
              { name: `${ext.toUpperCase()} file`, extensions: [ext] },
              { name: 'All files', extensions: ['*'] },
            ]
          : [],
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      file = r.filePath;
    }
    await fs.writeFile(file, it.data);
    lastSaveDir = path.dirname(file);
    return { saved: [file], dir: lastSaveDir };
  }

  let dir = testDir;
  if (!dir) {
    const r = await dialog.showOpenDialog(win, {
      title: title || `Choose a folder for the ${items.length} files`,
      defaultPath: startDir,
      buttonLabel: 'Save here',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    if (r.canceled || !r.filePaths.length) return { canceled: true };
    dir = r.filePaths[0];
    const existing = [];
    for (const it of items) {
      try {
        await fs.access(path.join(dir, it.name));
        existing.push(it.name);
      } catch {
        // not there yet
      }
    }
    if (existing.length) {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Replace', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        title: 'Replace files?',
        message: `${existing.length === 1 ? 'A file' : existing.length + ' files'} with the same name already exist in ${dir}. Replace?`,
        detail: existing.join('\n'),
      });
      if (response !== 0) return { canceled: true };
    }
  }
  await fs.mkdir(dir, { recursive: true });
  const saved = [];
  for (const it of items) {
    const file = path.join(dir, it.name);
    await fs.writeFile(file, it.data);
    saved.push(file);
  }
  lastSaveDir = dir;
  return { saved, dir };
}

// Links to the outside world open in the system browser; the window never leaves app://penplot/.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  const guard = (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
});

// Basic Edit and View menus only. The roles carry the usual accelerators (Ctrl+R, Ctrl+Shift+I, zoom, ...). The
// page sees keys first, so its own shortcuts (Ctrl+Z, Ctrl+C/V, Ctrl+0 ...) keep priority over these.
function buildMenu() {
  const template = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  if (process.platform === 'darwin') template.unshift({ role: 'appMenu' });
  return Menu.buildFromTemplate(template);
}

let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false, // shown on ready-to-show: no white flash before the dark UI paints
    backgroundColor: '#0e1115',
    title: 'PenPlot Studio', // replaced by the page's <title> as soon as it loads
    icon: process.platform === 'darwin' ? undefined : ICON,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false, // offline app: don't fetch dictionaries from the network
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`PenPlot Studio: failed to load ${url}: ${description} (${code})`);
    if (!win.isDestroyed()) win.show();
  });
  win.loadURL(`${ORIGIN}/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.enableSandbox();
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, handleAppRequest);
    setupPermissions();
    ipcMain.handle('pp:save-files', saveFiles);
    // anything still downloaded the browser way gets a readable Save dialog
    session.defaultSession.on('will-download', (_e, item) => {
      const name = safeName(item.getFilename());
      item.setSaveDialogOptions({
        title: `Save ${name}`,
        defaultPath: path.join(lastSaveDir || app.getPath('downloads'), name),
      });
    });
    Menu.setApplicationMenu(buildMenu());
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
