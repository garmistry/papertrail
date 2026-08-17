'use strict';

const fs = require('fs');
const path = require('path');
const { documentTypeFor } = require('./document-types');
const {
  listLibrary,
  readLibrary,
  recordOpenedDocument,
  searchLibrary,
  upsertEntry,
  writeLibrary
} = require('./history-store');

/** Creates the renderer-safe shape returned after a document is read or saved. */
function documentPayload(filePath, text) {
  return {
    path: filePath,
    name: path.basename(filePath),
    text,
    type: documentTypeFor(filePath)
  };
}

/**
 * Owns the current document and its persisted local archive for one app session.
 * Electron-specific window behavior remains in main.js; this class only handles files and history.
 */
class DocumentStore {
  /** Loads the local archive and accepts the native recent-document callback. */
  constructor(historyPath, addRecentDocument = () => {}) {
    this.historyPath = historyPath;
    this.addRecentDocument = addRecentDocument;
    this.library = readLibrary(historyPath);
    this.currentPath = null;
  }

  /** Clears the current file while retaining the searchable archive. */
  newDocument() {
    this.currentPath = null;
  }

  /** Reads a document, records an open, and returns its renderer payload. */
  open(filePath) {
    const resolvedPath = path.resolve(filePath);
    try {
      const text = fs.readFileSync(resolvedPath, 'utf8');
      this.currentPath = resolvedPath;
      this._recordDocument(resolvedPath, text, true);
      return documentPayload(resolvedPath, text);
    } catch (error) {
      throw new Error(`Could not open ${path.basename(resolvedPath)}: ${error.message}`);
    }
  }

  /** Writes text to a document and refreshes its archive entry without counting an open. */
  save(filePath, text) {
    const resolvedPath = path.resolve(filePath);
    if (typeof text !== 'string') throw new Error('Document contents must be text.');
    try {
      fs.writeFileSync(resolvedPath, text, 'utf8');
      this.currentPath = resolvedPath;
      this._recordDocument(resolvedPath, text);
      return documentPayload(resolvedPath, text);
    } catch (error) {
      throw new Error(`Could not save ${path.basename(resolvedPath)}: ${error.message}`);
    }
  }

  /** Returns the renderer-safe recent-document list. */
  listHistory() {
    return listLibrary(this.library);
  }

  /** Returns the persistent Markdown-open count. */
  historyStats() {
    return { markdownOpenCount: this.library.markdownOpenCount };
  }

  /** Searches previously opened or saved document content. */
  searchHistory(query) {
    return searchLibrary(this.library, query);
  }

  /** Confirms that a renderer-selected path exists in the local archive. */
  hasHistoryPath(filePath) {
    return typeof filePath === 'string' && this.library.entries.some((entry) => entry.path === filePath);
  }

  /** Persists a history update; only opens advance the Markdown metric. */
  _recordDocument(filePath, text, opened = false) {
    const nextLibrary = opened
      ? recordOpenedDocument(this.library, filePath, text)
      : upsertEntry(this.library, filePath, text);
    try {
      writeLibrary(this.historyPath, nextLibrary);
      this.library = nextLibrary;
      this.addRecentDocument(filePath);
    } catch (error) {
      console.warn(`Could not update Papertrail history: ${error.message}`);
    }
  }
}

module.exports = { DocumentStore };
