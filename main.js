'use strict';

// Main-process coordinator: native windows, trusted IPC, and app lifecycle.
const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const { pathToFileURL } = require('url');
const { Diagnostics } = require('./lib/diagnostics');
const { DocumentStore } = require('./lib/document-store');
const { DOCUMENT_FILTERS, documentPathFrom } = require('./lib/document-types');

let mainWindow;
let documents;
let rendererReady = false;
let pendingOpenPath = null;
let isDirty = false;
let nextConfirmationId = 0;
let updaterStarted = false;
let updatePhase = 'idle';
let updateInstallTimer;
let updateInstallWasDirty = false;
let updateStatus = { state: 'idle' };
let diagnostics;
const replacementConfirmations = new Map();
const appPageUrl = pathToFileURL(path.join(__dirname, 'index.html')).toString();
const UPDATE_CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const UPDATE_INSTALL_TIMEOUT = 30000;

/** Records a service message to the console and persistent in-app diagnostics. */
function serviceLog(level, service, ...values) {
  (console[level] || console.log)(`[${service}]`, ...values);
  const entry = diagnostics?.write(level, service, ...values);
  if (level === 'error' && mainWindow && rendererReady && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('diagnostics:open');
  }
  return entry;
}

/** Returns a readable message without dropping non-Error rejection values. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

/** Stores updater state and forwards it to the in-app notification when available. */
function sendUpdateStatus(status) {
  updateStatus = status;
  if (mainWindow && rendererReady && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
}

/** Checks the configured GitHub release feed without interrupting offline use. */
function checkForUpdates() {
  if (!app.isPackaged || updatePhase !== 'idle' || ['downloading', 'downloaded', 'installing'].includes(updateStatus.state)) return;
  updatePhase = 'check';
  serviceLog('info', 'updater', 'Checking for updates.');
  autoUpdater.checkForUpdates().catch((error) => {
    if (updatePhase === 'check') reportUpdateError(error, 'check');
  });
}

/** Surfaces updater failures regardless of whether they happen during check, download, or install. */
function reportUpdateError(error, phase = updatePhase) {
  clearTimeout(updateInstallTimer);
  if (phase === 'install') isDirty = updateInstallWasDirty;
  updateInstallWasDirty = false;
  updatePhase = 'idle';
  const message = errorMessage(error);
  serviceLog('error', 'updater', `${phase} failed:`, error instanceof Error ? error.stack || error.message : message);
  sendUpdateStatus({ state: 'error', phase, message, retryable: phase === 'download' });
}

/** Connects the packaged app to its GitHub release feed once per process. */
function startUpdater() {
  if (!app.isPackaged || updaterStarted) return;
  updaterStarted = true;
  autoUpdater.logger = {
    debug: (...values) => serviceLog('debug', 'updater', ...values),
    info: (...values) => serviceLog('info', 'updater', ...values),
    warn: (...values) => serviceLog('warn', 'updater', ...values),
    error: (...values) => serviceLog('error', 'updater', ...values)
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', ({ version }) => {
    updatePhase = 'idle';
    serviceLog('info', 'updater', `Update ${version} is available.`);
    sendUpdateStatus({ state: 'available', version });
  });
  autoUpdater.on('update-not-available', () => {
    updatePhase = 'idle';
    serviceLog('info', 'updater', 'No update is available.');
    sendUpdateStatus({ state: 'idle' });
  });
  autoUpdater.on('download-progress', ({ percent }) => sendUpdateStatus({ state: 'downloading', percent: Math.round(percent) }));
  autoUpdater.on('update-downloaded', ({ version }) => {
    updatePhase = 'ready';
    serviceLog('info', 'updater', `Update ${version} downloaded and ready to install.`);
    sendUpdateStatus({ state: 'downloaded', version });
  });
  autoUpdater.on('error', (error) => reportUpdateError(error));
  setTimeout(checkForUpdates, 1500);
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL).unref();
}

/** Shows a native discard prompt when the renderer is not ready to answer it. */
function confirmDiscardChangesNative(action) {
  if (!isDirty) return true;
  const choice = dialog.showMessageBoxSync(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Discard Changes'],
    defaultId: 0,
    cancelId: 0,
    message: 'Discard unsaved changes?',
    detail: `Save the document before ${action} to keep your edits.`
  });
  return choice !== 0;
}

/** Asks the renderer to confirm replacement and expires safely if it does not answer. */
function askRendererToConfirmReplacement(action) {
  return new Promise((resolve) => {
    const id = ++nextConfirmationId;
    const timer = setTimeout(() => {
      replacementConfirmations.delete(id);
      resolve(false);
    }, 10000);
    replacementConfirmations.set(id, { resolve, timer });
    mainWindow.webContents.send('document:confirm-replace', { id, action });
  });
}

/** Uses renderer confirmation when available so native file events respect unsaved browser state. */
async function confirmDiscardChanges(action) {
  if (rendererReady && mainWindow && !mainWindow.isDestroyed()) {
    return askRendererToConfirmReplacement(action);
  }
  return confirmDiscardChangesNative(action);
}

/** Resolves pending renderer confirmations when a window closes. */
function clearReplacementConfirmations() {
  for (const { resolve, timer } of replacementConfirmations.values()) {
    clearTimeout(timer);
    resolve(false);
  }
  replacementConfirmations.clear();
}

/** Opens a document and clears the main-process dirty guard after success. */
function openDocument(filePath) {
  const document = documents.open(filePath);
  isDirty = false;
  return document;
}

/** Saves a document and clears the main-process dirty guard after success. */
function saveDocument(filePath, text) {
  const document = documents.save(filePath, text);
  isDirty = false;
  return document;
}

/** Opens a native file picker after protecting any unsaved current source. */
async function chooseAndOpen() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: DOCUMENT_FILTERS
  });
  if (result.canceled || !await confirmDiscardChanges('opening another file')) return null;
  return openDocument(result.filePaths[0]);
}

/** Opens a native save dialog and delegates persistence to the document store. */
async function chooseAndSave(text) {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: documents.currentPath || 'Untitled.md',
    filters: DOCUMENT_FILTERS
  });
  return result.canceled ? null : saveDocument(result.filePath, text);
}

/** Delivers a document opened by native app events to the renderer. */
function sendDocument(document) {
  if (mainWindow && rendererReady && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('document:opened', document);
  }
}

/** Routes Finder, command-line, and single-instance file opens through one dirty-safe path. */
async function requestOpen(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = filePath;
    if (app.isReady()) createWindow();
    return;
  }
  if (!rendererReady) {
    pendingOpenPath = filePath;
    return;
  }
  if (!await confirmDiscardChanges('opening another file')) return;
  try {
    sendDocument(openDocument(filePath));
  } catch (error) {
    dialog.showErrorBox('Unable to open file', error.message);
  }
}

/** Forwards a native menu command to the current renderer window. */
function sendCommand(command) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:command', command);
}

/** Limits IPC requests to the bundled renderer page. */
function isTrustedSender(event) {
  return event.senderFrame?.url === appPageUrl;
}

/** Registers a trusted request/response IPC handler. */
function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Untrusted renderer request.');
    return listener(event, ...args);
  });
}

/** Installs the native app menu and forwards menu actions to the renderer. */
function createMenu() {
  const fileMenu = [
    { label: 'New', accelerator: 'CommandOrControl+N', click: () => sendCommand('new') },
    { label: 'Open…', accelerator: 'CommandOrControl+O', click: () => sendCommand('open') },
    { type: 'separator' },
    { label: 'Save', accelerator: 'CommandOrControl+S', click: () => sendCommand('save') },
    { label: 'Save As…', accelerator: 'CommandOrControl+Shift+S', click: () => sendCommand('save-as') },
    { type: 'separator' },
    { role: 'close' }
  ];
  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: fileMenu },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { label: 'Write', accelerator: 'CommandOrControl+1', click: () => sendCommand('view-write') },
        { label: 'Split', accelerator: 'CommandOrControl+2', click: () => sendCommand('view-split') },
        { label: 'Preview Only', accelerator: 'CommandOrControl+3', click: () => sendCommand('view-preview') },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => sendCommand('settings') },
        { label: 'Diagnostics…', click: () => sendCommand('diagnostics') },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Creates the secured Papertrail browser window and restores any queued file open. */
function createWindow() {
  rendererReady = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#f5f6f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.on('close', (event) => {
    if (!confirmDiscardChangesNative('closing')) event.preventDefault();
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
    rendererReady = false;
    documents?.newDocument();
    isDirty = false;
    clearReplacementConfirmations();
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    startUpdater();
    if (updateStatus.state !== 'idle') sendUpdateStatus(updateStatus);
    if (pendingOpenPath) {
      const filePath = pendingOpenPath;
      pendingOpenPath = null;
      requestOpen(filePath);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', (_event, details) => serviceLog('error', 'renderer', `Renderer exited: ${details.reason} (${details.exitCode}).`));
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

handle('document:open', chooseAndOpen);
handle('document:new', () => {
  documents.newDocument();
  isDirty = false;
});
handle('document:save', (_event, text) => documents.currentPath ? saveDocument(documents.currentPath, text) : chooseAndSave(text));
handle('document:save-as', (_event, text) => chooseAndSave(text));
handle('document:copy-path', () => {
  if (!documents.currentPath) return null;
  clipboard.writeText(documents.currentPath);
  return documents.currentPath;
});
ipcMain.on('document:dirty', (event, dirty) => {
  if (!isTrustedSender(event)) return;
  isDirty = Boolean(dirty);
});
handle('history:list', () => documents.listHistory());
handle('history:stats', () => documents.historyStats());
handle('history:search', (_event, query) => documents.searchHistory(query));
handle('history:set-tags', (_event, filePath, tags) => documents.setTags(filePath, tags));
handle('history:open', async (_event, filePath) => {
  if (!documents.hasHistoryPath(filePath)) throw new Error('That file is not in the local archive.');
  if (!await confirmDiscardChanges('opening another file')) return null;
  return openDocument(filePath);
});
handle('document:confirm-replace', (_event, response) => {
  const request = replacementConfirmations.get(response?.id);
  if (!request) return;
  replacementConfirmations.delete(response.id);
  clearTimeout(request.timer);
  request.resolve(response.allowed === true);
});
handle('theme:set', (_event, theme) => {
  nativeTheme.themeSource = theme === 'dark' || theme === 'light' ? theme : 'system';
});
handle('diagnostics:list', () => ({
  entries: diagnostics?.list() || [],
  path: diagnostics?.filePath || '',
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch
}));
handle('diagnostics:copy', () => {
  const entries = diagnostics?.list() || [];
  clipboard.writeText(entries.join('\n'));
  return entries.length;
});
ipcMain.on('diagnostics:report', (event, message) => {
  if (!isTrustedSender(event) || typeof message !== 'string') return;
  serviceLog('error', 'renderer', message.slice(0, 20000));
});
handle('update:download', async () => {
  if (!app.isPackaged || (updateStatus.state !== 'available' && !(updateStatus.state === 'error' && updateStatus.retryable))) return false;
  updatePhase = 'download';
  serviceLog('info', 'updater', 'Starting update download.');
  sendUpdateStatus({ state: 'downloading', percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
    return true;
  } catch (error) {
    if (updatePhase === 'download') reportUpdateError(error, 'download');
    return false;
  }
});
handle('update:install', async () => {
  if (updateStatus.state !== 'downloaded' || !await confirmDiscardChanges('installing the update')) return false;
  updateInstallWasDirty = isDirty;
  isDirty = false;
  updatePhase = 'install';
  serviceLog('info', 'updater', `Installing update ${updateStatus.version || ''}.`);
  sendUpdateStatus({ state: 'installing', version: updateStatus.version });
  setImmediate(() => {
    updateInstallTimer = setTimeout(() => {
      if (updatePhase === 'install') reportUpdateError(new Error('Installation did not start within 30 seconds. On macOS, verify that both builds use the same Developer ID certificate.'), 'install');
    }, UPDATE_INSTALL_TIMEOUT);
    try {
      autoUpdater.quitAndInstall();
    } catch (error) {
      reportUpdateError(error, 'install');
    }
  });
  return true;
});
handle('link:open', async (_event, href) => {
  try {
    const url = new URL(href);
    if (['https:', 'http:', 'mailto:'].includes(url.protocol)) await shell.openExternal(url.toString());
  } catch {
    // Markdown-It rejects unsafe protocols; this is a final guard for external navigation.
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const filePath = documentPathFrom(argv);
    if (filePath) requestOpen(filePath);
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    requestOpen(filePath);
  });

  app.whenReady().then(() => {
    app.setName('Papertrail');
    diagnostics = new Diagnostics(path.join(app.getPath('userData'), 'logs', 'papertrail.log'));
    serviceLog('info', 'app', `Papertrail ${app.getVersion()} started on ${process.platform} ${process.arch}.`);
    documents = new DocumentStore(
      path.join(app.getPath('userData'), 'history.json'),
      (filePath) => app.addRecentDocument(filePath)
    );
    createMenu();
    createWindow();
    const initialFile = documentPathFrom(process.argv);
    if (initialFile) pendingOpenPath = initialFile;

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

process.on('uncaughtExceptionMonitor', (error) => serviceLog('error', 'main', error));
process.on('unhandledRejection', (reason) => serviceLog('error', 'main', reason));
