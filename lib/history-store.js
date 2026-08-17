'use strict';

const fs = require('fs');
const path = require('path');
const { isMarkdownPath } = require('./document-types');

const HISTORY_LIMIT = 100;

/** Checks whether one persisted archive entry has the required fields. */
function validEntry(entry) {
  return entry
    && typeof entry.path === 'string'
    && typeof entry.title === 'string'
    && typeof entry.content === 'string'
    && typeof entry.updatedAt === 'string';
}

/** Validates persisted data and migrates missing fields to the current shape. */
function normalizeLibrary(value) {
  const entries = Array.isArray(value?.entries) ? value.entries.filter(validEntry) : [];
  const markdownOpenCount = Number.isSafeInteger(value?.markdownOpenCount) && value.markdownOpenCount >= 0
    ? value.markdownOpenCount
    : 0;
  return { entries: entries.slice(0, HISTORY_LIMIT), markdownOpenCount };
}

/** Loads a local archive, falling back to an empty archive when it is absent or invalid. */
function readLibrary(filePath) {
  try {
    return normalizeLibrary(JSON.parse(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return { entries: [], markdownOpenCount: 0 };
  }
}

/** Atomically persists an archive by replacing the file only after a complete temporary write. */
function writeLibrary(filePath, library) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(normalizeLibrary(library), null, 2), 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

/** Creates or refreshes one archive entry without changing the open counter. */
function upsertEntry(library, filePath, content, now = new Date()) {
  const entry = {
    path: path.resolve(filePath),
    title: path.basename(filePath),
    content: String(content),
    updatedAt: new Date(now).toISOString()
  };
  const normalized = normalizeLibrary(library);
  const entries = normalized.entries.filter((item) => item.path !== entry.path);
  return { entries: [entry, ...entries].slice(0, HISTORY_LIMIT), markdownOpenCount: normalized.markdownOpenCount };
}

/** Records an open and advances the counter only for Markdown file extensions. */
function recordOpenedDocument(library, filePath, content, now = new Date()) {
  const updated = upsertEntry(library, filePath, content, now);
  return {
    ...updated,
    markdownOpenCount: updated.markdownOpenCount + Number(isMarkdownPath(filePath))
  };
}

/** Produces a compact content excerpt centered around an optional search query. */
function excerpt(content, query = '') {
  const compact = content.replace(/\s+/g, ' ').trim();
  const index = query ? compact.toLocaleLowerCase().indexOf(query) : 0;
  const start = Math.max(0, index - 56);
  const text = compact.slice(start, start + 180);
  return `${start ? '…' : ''}${text}${start + text.length < compact.length ? '…' : ''}`;
}

/** Redacts a full archive entry into the metadata returned to the renderer. */
function resultFor(entry, query) {
  return {
    path: entry.path,
    title: entry.title,
    updatedAt: entry.updatedAt,
    snippet: excerpt(entry.content, query)
  };
}

/** Returns redacted archive metadata suitable for the renderer. */
function listLibrary(library) {
  return normalizeLibrary(library).entries.map((entry) => resultFor(entry));
}

/** Searches archived paths, titles, and content without exposing full content in results. */
function searchLibrary(library, value) {
  const query = String(value || '').trim().toLocaleLowerCase();
  if (!query) return [];

  return normalizeLibrary(library).entries
    .filter((entry) => `${entry.title}\n${entry.path}\n${entry.content}`.toLocaleLowerCase().includes(query))
    .map((entry) => resultFor(entry, query));
}

module.exports = { HISTORY_LIMIT, listLibrary, readLibrary, recordOpenedDocument, searchLibrary, upsertEntry, writeLibrary };
