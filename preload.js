'use strict';

// Secure renderer bridge: exposes only the IPC operations used by the UI.
const { contextBridge, ipcRenderer } = require('electron');

/** Subscribes to one main-process event and returns an unsubscribe function. */
function on(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('papertrail', {
  documents: {
    open: () => ipcRenderer.invoke('document:open'),
    new: () => ipcRenderer.invoke('document:new'),
    save: (text) => ipcRenderer.invoke('document:save', text),
    saveAs: (text) => ipcRenderer.invoke('document:save-as', text),
    copyPath: () => ipcRenderer.invoke('document:copy-path'),
    setDirty: (dirty) => ipcRenderer.send('document:dirty', dirty),
    confirmReplace: (id, allowed) => ipcRenderer.invoke('document:confirm-replace', { id, allowed })
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    stats: () => ipcRenderer.invoke('history:stats'),
    search: (query) => ipcRenderer.invoke('history:search', query),
    setTags: (filePath, tags) => ipcRenderer.invoke('history:set-tags', filePath, tags),
    open: (filePath) => ipcRenderer.invoke('history:open', filePath)
  },
  updates: {
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => on('update:status', callback)
  },
  diagnostics: {
    list: () => ipcRenderer.invoke('diagnostics:list'),
    copy: () => ipcRenderer.invoke('diagnostics:copy'),
    report: (message) => ipcRenderer.send('diagnostics:report', message),
    onOpen: (callback) => on('diagnostics:open', callback)
  },
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  openExternal: (href) => ipcRenderer.invoke('link:open', href),
  onCommand: (callback) => on('app:command', callback),
  onOpenedDocument: (callback) => on('document:opened', callback),
  onConfirmReplace: (callback) => on('document:confirm-replace', callback)
});
