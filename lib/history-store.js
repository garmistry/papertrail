'use strict';

const fs = require('fs');
const path = require('path');
const { documentTypeFor, isMarkdownPath } = require('./document-types');

const HISTORY_LIMIT = 100;
const TAG_LIMIT = 12;
const TAG_LENGTH_LIMIT = 32;

/** Checks whether one persisted archive entry has the required fields. */
function validEntry(entry) {
  return entry
    && typeof entry.path === 'string'
    && typeof entry.title === 'string'
    && typeof entry.content === 'string'
    && typeof entry.updatedAt === 'string';
}

/** Normalizes the user-facing virtual categories stored with an archive entry. */
function normalizeTags(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).reduce((tags, rawTag) => {
    const tag = typeof rawTag === 'string' ? rawTag.trim().replace(/\s+/g, ' ').slice(0, TAG_LENGTH_LIMIT) : '';
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key) && tags.length < TAG_LIMIT) {
      seen.add(key);
      tags.push(tag);
    }
    return tags;
  }, []);
}

/** Validates persisted data and migrates missing fields to the current shape. */
function normalizeLibrary(value) {
  const entries = Array.isArray(value?.entries)
    ? value.entries.filter(validEntry).map((entry) => ({ ...entry, tags: normalizeTags(entry.tags) }))
    : [];
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
  const normalized = normalizeLibrary(library);
  const resolvedPath = path.resolve(filePath);
  const existing = normalized.entries.find((item) => item.path === resolvedPath);
  const entry = {
    path: resolvedPath,
    title: path.basename(filePath),
    content: String(content),
    updatedAt: new Date(now).toISOString(),
    tags: existing?.tags || []
  };
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

/** Replaces the virtual categories for one archived file without touching that file. */
function setEntryTags(library, filePath, tags) {
  const normalized = normalizeLibrary(library);
  const resolvedPath = path.resolve(filePath);
  let found = false;
  const entries = normalized.entries.map((entry) => {
    if (entry.path !== resolvedPath) return entry;
    found = true;
    return { ...entry, tags: normalizeTags(tags) };
  });
  if (!found) throw new Error('That file is not in the local archive.');
  return { ...normalized, entries };
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
    snippet: excerpt(entry.content, query),
    type: documentTypeFor(entry.path),
    tags: entry.tags
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
    .filter((entry) => `${entry.title}\n${entry.path}\n${entry.content}\n${entry.tags.join('\n')}`.toLocaleLowerCase().includes(query))
    .map((entry) => resultFor(entry, query));
}

module.exports = { HISTORY_LIMIT, listLibrary, readLibrary, recordOpenedDocument, searchLibrary, setEntryTags, upsertEntry, writeLibrary };
