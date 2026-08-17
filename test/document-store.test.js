'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DocumentStore } = require('../lib/document-store');

test('document store tracks current files and counts only Markdown opens', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'papertrail-documents-'));
  const recentPaths = [];
  const store = new DocumentStore(path.join(directory, 'history.json'), (filePath) => recentPaths.push(filePath));
  const markdownPath = path.join(directory, 'note.md');
  const textPath = path.join(directory, 'note.txt');
  const jsonPath = path.join(directory, 'note.json');

  assert.equal(store.save(markdownPath, '# Note').type, 'markdown');
  assert.equal(store.historyStats().markdownOpenCount, 0);
  assert.equal(store.open(markdownPath).text, '# Note');
  assert.equal(store.save(textPath, 'Plain text').type, 'text');
  assert.equal(store.open(textPath).type, 'text');
  assert.equal(store.save(jsonPath, '{"ready": true}').type, 'json');
  assert.equal(store.open(jsonPath).type, 'json');
  assert.equal(store.historyStats().markdownOpenCount, 1);
  assert.equal(store.listHistory().length, 3);
  assert.equal(recentPaths.length, 6);

  store.newDocument();
  assert.equal(store.currentPath, null);
  fs.rmSync(directory, { recursive: true, force: true });
});
