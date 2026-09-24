/** Renderer controller: UI state, Electron bridge calls, and DOM event wiring. */

import { applyMarkdownTool as insertMarkdownTool } from './renderer/markdown-tools.mjs';
import { renderPreview as renderDocumentPreview, replaceWebSequenceDiagram, stepDiagramZoom } from './renderer/preview.mjs';
import { updateNoticeView } from './renderer/update-notice.mjs';

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
const categoryFilter = document.querySelector('#category-filter');
const documentOutline = document.querySelector('#document-outline');
const outlineList = document.querySelector('#outline-list');
const historyList = document.querySelector('#history-list');
const historyLabel = document.querySelector('#history-label');
const archiveCount = document.querySelector('#archive-count');
const globalOpenCount = document.querySelector('#global-open-count');
const previewEditButton = document.querySelector('#preview-edit-button');
const prepAgentButton = document.querySelector('#prep-agent-button');
const markdownHelper = document.querySelector('#markdown-helper');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const settingsDialog = document.querySelector('#settings-dialog');
const settingsButton = document.querySelector('#settings-button');
const settingsTheme = document.querySelector('#settings-theme');
const settingsView = document.querySelector('#settings-view');
const settingsOpenCount = document.querySelector('#settings-open-count');
const settingsCategories = document.querySelector('#settings-categories');
const settingsSaveCategories = document.querySelector('#settings-save-categories');
const settingsCategoriesHint = document.querySelector('#settings-categories-help');
const updateNotice = document.querySelector('#update-notice');
const updateTitle = document.querySelector('#update-title');
const updateMessage = document.querySelector('#update-message');
const updateProgress = document.querySelector('#update-progress');
const updateAction = document.querySelector('#update-action');
const updateDismiss = document.querySelector('#update-dismiss');
const diagramDialog = document.querySelector('#diagram-dialog');
const diagramStage = document.querySelector('#diagram-stage');
const diagramImage = document.querySelector('#diagram-image');
const diagramZoomOut = document.querySelector('#diagram-zoom-out');
const diagramZoomReset = document.querySelector('#diagram-zoom-reset');
const diagramZoomIn = document.querySelector('#diagram-zoom-in');
const diagramClose = document.querySelector('#diagram-close');

const TYPE_LABELS = { markdown: 'Markdown', text: 'Text', json: 'JSON' };

const state = {
  path: null,
  type: 'markdown',
  dirty: false,
  history: [],
  category: 'all',
  markdownOpenCount: 0,
  searchVersion: 0,
  renderQueued: false,
  diagramZoom: 1,
  update: { state: 'idle' },
  theme: localStorage.getItem('papertrail-theme') || 'light',
  view: VIEW_MODES.has(storedView) ? storedView : 'split'
};

/** Shows the expanded image at its natural resolution and updates zoom controls. */
function setDiagramZoom(zoom) {
  state.diagramZoom = zoom;
  diagramImage.style.width = diagramImage.naturalWidth ? `${Math.round(diagramImage.naturalWidth * zoom)}px` : '';
  diagramZoomReset.textContent = `${Math.round(zoom * 100)}%`;
  diagramZoomOut.disabled = zoom <= 0.25;
  diagramZoomIn.disabled = zoom >= 4;
}

/** Opens a rendered diagram in the large, scrollable viewer. */
function openDiagramViewer(image) {
  diagramImage.src = image.currentSrc || image.src;
  setDiagramZoom(1);
  diagramStage.scrollTo(0, 0);
  if (!diagramDialog.open) diagramDialog.showModal();
}

/** Displays actionable update states without interrupting document work. */
function showUpdateStatus(status) {
  state.update = status;
  const view = updateNoticeView(status);
  updateNotice.hidden = !view;
  if (!view) return;
  updateTitle.textContent = view.title;
  updateMessage.textContent = view.message;
  updateProgress.hidden = view.progress === null;
  updateProgress.value = view.progress || 0;
  updateAction.hidden = !view.action;
  updateAction.disabled = false;
  updateAction.textContent = view.action || '';
}

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
  prepAgentButton.disabled = !state.path || state.type !== 'markdown';
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

/** Rebuilds the heading outline and wires each item to its source and preview location. */
function renderOutline(entries) {
  documentOutline.hidden = state.type !== 'markdown';
  outlineList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'outline-empty';
    empty.textContent = 'Add Markdown headings to navigate this document.';
    outlineList.append(empty);
    return;
  }
  const previewHeadings = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
  entries.forEach((entry) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'outline-item';
    item.dataset.level = entry.level;
    item.textContent = entry.text;
    item.title = entry.text;
    item.addEventListener('click', () => {
      if (state.view !== 'write') previewHeadings[entry.previewIndex]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (state.view !== 'preview') {
        editor.focus();
        editor.setSelectionRange(entry.offset, entry.offset);
      }
    });
    outlineList.append(item);
  });
}

/** Renders the current source and its Markdown heading outline. */
function renderCurrentPreview() {
  renderOutline(renderDocumentPreview(preview, state.type, editor.value));
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

/** Gives virtual category labels a case-insensitive comparison key. */
function categoryKey(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

/** Identifies whether an archive entry belongs to the active virtual category. */
function matchesCategory(entry) {
  if (state.category === 'all') return true;
  if (state.category === 'untagged') return !entry.tags.length;
  if (state.category.startsWith('type:')) return entry.type === state.category.slice(5);
  if (state.category.startsWith('tag:')) return entry.tags.some((tag) => categoryKey(tag) === state.category.slice(4));
  return true;
}

/** Filters archive or search results using the sidebar's selected category. */
function filteredEntries(entries) {
  return entries.filter(matchesCategory);
}

/** Rebuilds the compact category picker from automatic file types and saved labels. */
function renderCategoryFilter() {
  const categories = new Map();
  state.history.forEach((entry) => entry.tags.forEach((tag) => {
    const key = categoryKey(tag);
    if (!categories.has(key)) categories.set(key, tag);
  }));
  const option = (value, label, count) => {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = `${label} (${count})`;
    return element;
  };
  const options = [option('all', 'All seen files', state.history.length)];
  const untagged = state.history.filter((entry) => !entry.tags.length).length;
  options.push(option('untagged', 'Uncategorized', untagged));
  const types = Object.keys(TYPE_LABELS).filter((type) => state.history.some((entry) => entry.type === type));
  if (types.length) {
    const group = document.createElement('optgroup');
    group.label = 'File type';
    types.forEach((type) => group.append(option(`type:${type}`, TYPE_LABELS[type], state.history.filter((entry) => entry.type === type).length)));
    options.push(group);
  }
  if (categories.size) {
    const group = document.createElement('optgroup');
    group.label = 'Your categories';
    [...categories.entries()].sort(([, first], [, second]) => first.localeCompare(second)).forEach(([key, label]) => {
      group.append(option(`tag:${key}`, label, state.history.filter((entry) => entry.tags.some((tag) => categoryKey(tag) === key)).length));
    });
    options.push(group);
  }
  categoryFilter.replaceChildren(...options);
  if (![...categoryFilter.options].some((item) => item.value === state.category)) state.category = 'all';
  categoryFilter.value = state.category;
}

/** Updates the settings field for the current archived file's virtual categories. */
function syncCategoryEditor() {
  const entry = state.history.find((item) => item.path === state.path);
  const enabled = Boolean(entry);
  settingsCategories.disabled = !enabled;
  settingsSaveCategories.disabled = !enabled;
  settingsCategories.value = entry ? entry.tags.join(', ') : '';
  settingsCategoriesHint.textContent = enabled
    ? 'Virtual labels stay in Papertrail; your file stays where it is.'
    : 'Open or save a file before assigning virtual categories.';
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
  item.append(title, detail);
  if (entry.tags.length) {
    const categories = document.createElement('small');
    categories.textContent = entry.tags.join(' · ');
    item.append(categories);
  }
  item.append(date);
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
    empty.textContent = label === 'Search results' ? 'No matches in this category.' : state.category === 'all' ? 'Open a document to build your local archive.' : 'No files in this category yet.';
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
  renderCategoryFilter();
  syncCategoryEditor();
  if (searchInput.value.trim()) return searchHistory();
  showHistory(filteredEntries(state.history), 'Recent files');
}

/** Displays the latest search result while ignoring stale overlapping searches. */
async function searchHistory() {
  const query = searchInput.value.trim();
  const version = ++state.searchVersion;
  if (!query) {
    showHistory(filteredEntries(state.history), 'Recent files');
    return;
  }
  const results = await window.papertrail.history.search(query);
  if (version === state.searchVersion) showHistory(filteredEntries(results), 'Search results');
}

/** Applies every file-open result through one path so preview, chrome, and archive stay aligned. */
function acceptDocument(document) {
  state.path = document.path;
  state.type = document.type || 'markdown';
  editor.value = document.text;
  setDirty(false);
  updateChrome();
  renderCurrentPreview();
  syncCategoryEditor();
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

/** Copies the current Markdown file's absolute path for use in an agent prompt. */
async function prepForAgent() {
  try {
    const filePath = await window.papertrail.documents.copyPath();
    setStatus(filePath ? 'Copied full Markdown path for your agent.' : 'Save this Markdown file before copying its path.', filePath ? '' : 'error');
  } catch (error) {
    setStatus(error.message || 'Could not copy the file path.', 'error');
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
  syncCategoryEditor();
  if (!settingsDialog.open) settingsDialog.showModal();
}

/** Saves comma-separated virtual categories for the active archive entry. */
async function saveCategories() {
  const filePath = state.path;
  if (!filePath) return;
  try {
    const entry = await window.papertrail.history.setTags(filePath, settingsCategories.value.split(','));
    if (state.path === filePath) settingsCategories.value = entry.tags.join(', ');
    await refreshHistory();
    setStatus('Categories saved; file stays where it is.');
  } catch (error) {
    setStatus(error.message || 'Could not save categories.', 'error');
  }
}

document.querySelector('#new-button').addEventListener('click', newDocument);
document.querySelector('#open-button').addEventListener('click', openDocument);
document.querySelector('#save-button').addEventListener('click', () => saveDocument());
prepAgentButton.addEventListener('click', prepForAgent);
themeButton.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
settingsButton.addEventListener('click', openSettings);
settingsTheme.addEventListener('change', () => setTheme(settingsTheme.value));
settingsView.addEventListener('change', () => setView(settingsView.value));
settingsSaveCategories.addEventListener('click', () => saveCategories());
settingsCategories.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveCategories();
  }
});
updateAction.addEventListener('click', async () => {
  updateAction.disabled = true;
  try {
    if (state.update.state === 'downloaded') await window.papertrail.updates.install();
    else await window.papertrail.updates.download();
  } finally {
    if (!updateAction.hidden) updateAction.disabled = false;
  }
});
updateDismiss.addEventListener('click', () => { updateNotice.hidden = true; });
diagramImage.addEventListener('load', () => setDiagramZoom(state.diagramZoom));
diagramZoomOut.addEventListener('click', () => setDiagramZoom(stepDiagramZoom(state.diagramZoom, -1)));
diagramZoomReset.addEventListener('click', () => setDiagramZoom(1));
diagramZoomIn.addEventListener('click', () => setDiagramZoom(stepDiagramZoom(state.diagramZoom, 1)));
diagramClose.addEventListener('click', () => diagramDialog.close());
previewEditButton.addEventListener('click', editFromPreview);
viewButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-markdown-tool]').forEach((button) => {
  button.addEventListener('click', () => applyMarkdownTool(button.dataset.markdownTool));
});
searchInput.addEventListener('input', () => {
  searchHistory().catch((error) => setStatus(error.message || 'Could not search archive.', 'error'));
});
categoryFilter.addEventListener('change', () => {
  state.category = categoryFilter.value;
  searchHistory().catch((error) => setStatus(error.message || 'Could not search archive.', 'error'));
});
editor.addEventListener('input', changeEditor);
preview.addEventListener('submit', (event) => {
  const form = event.target.closest('.wsd-editor');
  if (!form) return;
  event.preventDefault();
  const diagram = form.closest('.wsd-diagram');
  const source = replaceWebSequenceDiagram(editor.value, Number(diagram.dataset.wsdIndex), form.elements.source.value);
  if (source === null) return setStatus('Could not locate that diagram in the Markdown source.', 'error');
  editor.value = source;
  changeEditor();
  setStatus('Sequence diagram updated.');
});
preview.addEventListener('error', (event) => {
  if (event.target.matches('.wsd-diagram img')) event.target.closest('.wsd-diagram').classList.add('render-error');
}, true);
preview.addEventListener('click', (event) => {
  const expand = event.target.closest('.wsd-expand, .wsd-canvas img');
  if (expand) {
    openDiagramViewer(expand.closest('.wsd-canvas').querySelector('img'));
    return;
  }
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
window.papertrail.updates.onStatus(showUpdateStatus);

setTheme(state.theme);
setView(state.view);
renderCurrentPreview();
updateChrome();
refreshHistory().catch((error) => setStatus(error.message || 'Could not load archive.', 'error'));
