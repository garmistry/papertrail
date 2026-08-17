'use strict';

// Main-process coordinator: native windows, trusted IPC, and app lifecycle.
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const { DocumentStore } = require('./lib/document-store');
const { DOCUMENT_FILTERS, documentPathFrom } = require('./lib/document-types');

let mainWindow;
let documents;
let rendererReady = false;
let pendingOpenPath = null;
let isDirty = false;
let nextConfirmationId = 0;
const replacementConfirmations = new Map();
const appPageUrl = pathToFileURL(path.join(__dirname, 'index.html')).toString();

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
    backgroundColor: '#17181c',
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
    if (pendingOpenPath) {
      const filePath = pendingOpenPath;
      pendingOpenPath = null;
      requestOpen(filePath);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

handle('document:open', chooseAndOpen);
handle('document:new', () => {
  documents.newDocument();
  isDirty = false;
});
handle('document:save', (_event, text) => documents.currentPath ? saveDocument(documents.currentPath, text) : chooseAndSave(text));
handle('document:save-as', (_event, text) => chooseAndSave(text));
ipcMain.on('document:dirty', (event, dirty) => {
  if (!isTrustedSender(event)) return;
  isDirty = Boolean(dirty);
});
handle('history:list', () => documents.listHistory());
handle('history:stats', () => documents.historyStats());
handle('history:search', (_event, query) => documents.searchHistory(query));
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
