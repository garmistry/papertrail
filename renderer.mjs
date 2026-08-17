/** Renderer controller: UI state, Electron bridge calls, and DOM event wiring. */

import { applyMarkdownTool as insertMarkdownTool } from './renderer/markdown-tools.mjs';
import { renderPreview as renderDocumentPreview } from './renderer/preview.mjs';

const VIEW_MODES = new Set(['write', 'split', 'preview']);
const storedView = localStorage.getItem('papertrail-view');

const editor = document.querySelector('#editor');
const preview = document.querySelector('#preview');
const workspace = document.querySelector('#workspace');
const documentName = document.querySelector('#document-name');
const status = document.querySelector('#status');
const stats = document.querySelector('#document-stats');
const themeButton = document.querySelector('#theme-button');
const highlightTheme = document.querySelector('#highlight-theme');
const searchInput = document.querySelector('#archive-search');
const historyList = document.querySelector('#history-list');
const historyLabel = document.querySelector('#history-label');
const archiveCount = document.querySelector('#archive-count');
const globalOpenCount = document.querySelector('#global-open-count');
const previewEditButton = document.querySelector('#preview-edit-button');
const markdownHelper = document.querySelector('#markdown-helper');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const settingsDialog = document.querySelector('#settings-dialog');
const settingsButton = document.querySelector('#settings-button');
const settingsTheme = document.querySelector('#settings-theme');
const settingsView = document.querySelector('#settings-view');
const settingsOpenCount = document.querySelector('#settings-open-count');

const state = {
  path: null,
  type: 'markdown',
  dirty: false,
  history: [],
  markdownOpenCount: 0,
  searchVersion: 0,
  renderQueued: false,
  theme: localStorage.getItem('papertrail-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  view: VIEW_MODES.has(storedView) ? storedView : 'split'
};

/** Shows a brief status message in the app footer. */
function setStatus(message, kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
}

/** Counts non-whitespace words for the current editor status. */
function wordCount(text) {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Updates the persistent Markdown-open metric in both visible locations. */
function updateCounter(count = state.markdownOpenCount) {
  state.markdownOpenCount = Number.isSafeInteger(count) && count >= 0 ? count : 0;
  const noun = state.markdownOpenCount === 1 ? 'open' : 'opens';
  globalOpenCount.textContent = `${state.markdownOpenCount.toLocaleString()} Markdown ${noun}`;
  settingsOpenCount.textContent = state.markdownOpenCount.toLocaleString();
}

/** Refreshes the title and word count after any document state change. */
function updateChrome() {
  const name = state.path ? state.path.split('/').pop() : 'New note';
  documentName.textContent = `${name}${state.dirty ? ' •' : ''}`;
  document.title = state.dirty ? `• ${name} — Papertrail` : `${name} — Papertrail`;
  const words = wordCount(editor.value);
  stats.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
}

/** Keeps the native close/open guard synchronized with renderer edits. */
function setDirty(dirty) {
  state.dirty = dirty;
  window.papertrail.documents.setDirty(dirty);
  updateChrome();
}

/** Applies and persists the selected light or dark application theme. */
function setTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem('papertrail-theme', state.theme);
  highlightTheme.href = state.theme === 'dark'
    ? './node_modules/@highlightjs/cdn-assets/styles/github-dark.min.css'
    : './node_modules/@highlightjs/cdn-assets/styles/github.min.css';
  themeButton.textContent = state.theme === 'dark' ? '☀' : '◐';
  themeButton.title = `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} mode`;
  settingsTheme.value = state.theme;
  window.papertrail.setTheme(state.theme);
}

/** Applies and persists the current Write, Split, or Preview layout. */
function setView(view) {
  state.view = VIEW_MODES.has(view) ? view : 'split';
  workspace.dataset.view = state.view;
  localStorage.setItem('papertrail-view', state.view);
  settingsView.value = state.view;
  viewButtons.forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

/** Renders the current source using the document-type-specific preview module. */
function renderCurrentPreview() {
  renderDocumentPreview(preview, state.type, editor.value);
}

/** Coalesces rapid editor input into one preview render per animation frame. */
function queueRender() {
  if (state.renderQueued) return;
  state.renderQueued = true;
  requestAnimationFrame(() => {
    state.renderQueued = false;
    renderCurrentPreview();
  });
}

/** Formats archive timestamps for the compact sidebar list. */
function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

/** Builds one clickable archive row and routes its open request through the bridge. */
function historyItem(entry) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'history-item';
  item.classList.toggle('active', entry.path === state.path);
  item.title = entry.path;

  const title = document.createElement('strong');
  title.textContent = entry.title;
  const detail = document.createElement('span');
  detail.textContent = entry.snippet || entry.path;
  const date = document.createElement('time');
  date.textContent = formatDate(entry.updatedAt);
  item.append(title, detail, date);
  item.addEventListener('click', async () => {
    try {
      const document = await window.papertrail.history.open(entry.path);
      if (!document) return;
      acceptDocument(document);
      setStatus(`Opened ${document.name}`);
    } catch (error) {
      setStatus(error.message || 'That file is no longer available.', 'error');
    }
  });
  return item;
}

/** Replaces the archive panel with the supplied recent files or search results. */
function showHistory(entries, label) {
  historyLabel.textContent = label;
  historyList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'history-empty';
    empty.textContent = label === 'Search results' ? 'No matches in previously seen files.' : 'Open a document to build your local archive.';
    historyList.append(empty);
    return;
  }
  entries.forEach((entry) => historyList.append(historyItem(entry)));
}

/** Loads archive metadata and the matching global counter from the main process. */
async function refreshHistory() {
  const [entries, summary] = await Promise.all([
    window.papertrail.history.list(),
    window.papertrail.history.stats()
  ]);
  state.history = entries;
  updateCounter(summary?.markdownOpenCount);
  archiveCount.textContent = state.history.length ? String(state.history.length) : '';
  if (!searchInput.value.trim()) showHistory(state.history, 'Recent files');
}

/** Displays the latest search result while ignoring stale overlapping searches. */
async function searchHistory() {
  const query = searchInput.value.trim();
  const version = ++state.searchVersion;
  if (!query) {
    showHistory(state.history, 'Recent files');
    return;
  }
  const results = await window.papertrail.history.search(query);
  if (version === state.searchVersion) showHistory(results, 'Search results');
}

/** Applies every file-open result through one path so preview, chrome, and archive stay aligned. */
function acceptDocument(document) {
  state.path = document.path;
  state.type = document.type || 'markdown';
  editor.value = document.text;
  setDirty(false);
  updateChrome();
  renderCurrentPreview();
  refreshHistory().catch((error) => setStatus(error.message || 'Could not refresh archive.', 'error'));
}

/** Marks source changes and schedules a fresh preview. */
function changeEditor() {
  setDirty(true);
  queueRender();
  updateChrome();
}

/** Inserts the selected Markdown helper syntax into source without making preview HTML editable. */
function applyMarkdownTool(name) {
  if (state.view === 'preview') setView('split');
  editor.focus();
  if (!insertMarkdownTool(editor, name)) return;
  markdownHelper.open = false;
  changeEditor();
}

/** Opens a document through native UI and applies the returned payload. */
async function openDocument() {
  try {
    const document = await window.papertrail.documents.open();
    if (!document) return;
    acceptDocument(document);
    setStatus(`Opened ${document.name}`);
  } catch (error) {
    setStatus(error.message || 'Could not open file.', 'error');
  }
}

/** Saves the current source and preserves edits made while a native dialog is open. */
async function saveDocument(saveAs = false) {
  const savedText = editor.value;
  try {
    const document = saveAs
      ? await window.papertrail.documents.saveAs(savedText)
      : await window.papertrail.documents.save(savedText);
    if (!document) return;
    state.path = document.path;
    state.type = document.type || 'markdown';
    const hasNewerEdits = editor.value !== savedText;
    setDirty(hasNewerEdits);
    updateChrome();
    await refreshHistory();
    setStatus(hasNewerEdits ? `Saved ${document.name}; newer edits are unsaved.` : `Saved ${document.name}`);
  } catch (error) {
    setStatus(error.message || 'Could not save file.', 'error');
  }
}

/** Starts a blank Markdown document after confirming any unsaved source is discarded. */
async function newDocument() {
  if (state.dirty && !window.confirm('Discard unsaved changes?')) return;
  await window.papertrail.documents.new();
  state.path = null;
  state.type = 'markdown';
  editor.value = '';
  setDirty(false);
  renderCurrentPreview();
  setStatus('New note');
}

/** Leaves Preview-only mode and focuses source editing. */
function editFromPreview() {
  setView('split');
  editor.focus();
}

/** Synchronizes and opens the native settings dialog. */
function openSettings() {
  settingsTheme.value = state.theme;
  settingsView.value = state.view;
  updateCounter();
  if (!settingsDialog.open) settingsDialog.showModal();
}

document.querySelector('#new-button').addEventListener('click', newDocument);
document.querySelector('#open-button').addEventListener('click', openDocument);
document.querySelector('#save-button').addEventListener('click', () => saveDocument());
themeButton.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
settingsButton.addEventListener('click', openSettings);
settingsTheme.addEventListener('change', () => setTheme(settingsTheme.value));
settingsView.addEventListener('change', () => setView(settingsView.value));
previewEditButton.addEventListener('click', editFromPreview);
viewButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-markdown-tool]').forEach((button) => {
  button.addEventListener('click', () => applyMarkdownTool(button.dataset.markdownTool));
});
searchInput.addEventListener('input', () => {
  searchHistory().catch((error) => setStatus(error.message || 'Could not search archive.', 'error'));
});
editor.addEventListener('input', changeEditor);
preview.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (!link) return;
  event.preventDefault();
  window.papertrail.openExternal(link.href);
});
window.papertrail.onCommand((command) => {
  if (command === 'new') newDocument();
  if (command === 'open') openDocument();
  if (command === 'save') saveDocument();
  if (command === 'save-as') saveDocument(true);
  if (command === 'view-write') setView('write');
  if (command === 'view-split') setView('split');
  if (command === 'view-preview') setView('preview');
  if (command === 'settings') openSettings();
});
window.papertrail.onOpenedDocument((document) => {
  acceptDocument(document);
  setStatus(`Opened ${document.name}`);
});
window.papertrail.onConfirmReplace(({ id, action }) => {
  const allowed = !state.dirty || window.confirm(`Discard unsaved changes before ${action}?`);
  window.papertrail.documents.confirmReplace(id, allowed);
});

setTheme(state.theme);
setView(state.view);
renderCurrentPreview();
updateChrome();
refreshHistory().catch((error) => setStatus(error.message || 'Could not load archive.', 'error'));
