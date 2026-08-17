'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listLibrary, readLibrary, recordOpenedDocument, searchLibrary, upsertEntry, writeLibrary } = require('../lib/history-store');

test('history persists one current entry per path and searches document text', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papertrail-history-'));
  const libraryPath = path.join(directory, 'history.json');
  const firstPath = path.join(directory, 'first.md');
  const secondPath = path.join(directory, 'second.md');
  let library = recordOpenedDocument({ entries: [] }, firstPath, '# First\nA lighthouse note', '2026-08-16T09:00:00.000Z');
  library = recordOpenedDocument(library, secondPath, '# Second\nSearchable amber fox', '2026-08-16T10:00:00.000Z');
  library = upsertEntry(library, firstPath, '# First revised\nA brighter lighthouse note', '2026-08-16T11:00:00.000Z');
  writeLibrary(libraryPath, library);

  const restored = readLibrary(libraryPath);
  assert.equal(restored.entries.length, 2);
  assert.equal(restored.markdownOpenCount, 2);
  assert.equal(restored.entries[0].title, 'first.md');
  assert.equal(searchLibrary(restored, 'amber')[0].title, 'second.md');
  assert.match(searchLibrary(restored, 'lighthouse')[0].snippet, /lighthouse/i);
  assert.equal(listLibrary(restored)[0].content, undefined);

  fs.rmSync(directory, { recursive: true, force: true });
});

test('invalid or absent history starts empty', () => {
  assert.deepEqual(readLibrary(path.join(os.tmpdir(), 'papertrail-no-such-history.json')), { entries: [], markdownOpenCount: 0 });
});

test('only Markdown opens increase the global counter', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papertrail-counter-'));
  const markdownPath = path.join(directory, 'note.md');
  const textPath = path.join(directory, 'note.txt');
  const jsonPath = path.join(directory, 'note.json');
  let library = recordOpenedDocument({ entries: [] }, markdownPath, '# Note');
  library = recordOpenedDocument(library, textPath, 'Plain text');
  library = recordOpenedDocument(library, jsonPath, '{"plain": "data"}');

  assert.equal(library.markdownOpenCount, 1);
  fs.rmSync(directory, { recursive: true, force: true });
});
