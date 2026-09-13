/** Browser-only Markdown and source-preview rendering. Raw HTML stays disabled. */

/** Escapes text before it is inserted into a preview HTML string. */
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

const markdown = window.markdownit({
  html: false,
  linkify: true,
  typographer: true,
  highlight(source, language) {
    const name = String(language || '').trim().toLocaleLowerCase().split(/\s+/)[0];
    const hasLanguage = Boolean(name && window.hljs.getLanguage(name));
    const code = hasLanguage
      ? window.hljs.highlight(source, { language: name, ignoreIllegals: true }).value
      : window.hljs.highlightAuto(source).value;
    return `<pre class="hljs"><code${hasLanguage ? ` class="language-${escapeHtml(name)}"` : ''}>${code}</code></pre>`;
  }
});

const renderFence = markdown.renderer.rules.fence;

/** Identifies the fenced Markdown syntax used by WebSequenceDiagrams. */
function isWebSequenceDiagram(token) {
  return String(token.info || '').trim().toLocaleLowerCase().split(/\s+/)[0] === 'wsd';
}

/** Builds the official direct-render URL for WebSequenceDiagrams source. */
export function webSequenceDiagramImageUrl(source) {
  return `https://www.websequencediagrams.com/cgi-bin/cdraw?s=modern-blue&m=${encodeURIComponent(source)}`;
}

/** Moves diagram zoom in quarter-size steps while keeping the viewer usable. */
export function stepDiagramZoom(zoom, direction) {
  return Math.min(4, Math.max(0.25, zoom + Math.sign(direction) * 0.25));
}

/** Renders `wsd` fences as diagrams with a source editor in the preview. */
markdown.renderer.rules.fence = (tokens, index, options, environment, renderer) => {
  const token = tokens[index];
  if (!isWebSequenceDiagram(token)) return renderFence(tokens, index, options, environment, renderer);

  const source = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content;
  const diagramIndex = environment.webSequenceDiagramIndex++;
  const rows = Math.min(14, Math.max(4, source.split('\n').length + 1));
  return `<figure class="wsd-diagram" data-wsd-index="${diagramIndex}">
    <div class="wsd-canvas"><button class="wsd-expand" type="button" aria-label="Expand sequence diagram">Expand</button><img src="${escapeHtml(webSequenceDiagramImageUrl(source))}" alt="WebSequenceDiagram" referrerpolicy="no-referrer" /></div>
    <p class="wsd-render-error" role="status">Could not render this diagram. Check your connection and source.</p>
    <figcaption><details><summary>Edit diagram source</summary><form class="wsd-editor"><textarea name="source" rows="${rows}" aria-label="WebSequenceDiagrams source" autocomplete="off" autocapitalize="off" spellcheck="false">${escapeHtml(source)}</textarea><button class="button" type="submit">Render changes</button></form></details></figcaption>
  </figure>`;
};

/** Replaces one top-level `wsd` fence body while preserving its fence and line endings. */
export function replaceWebSequenceDiagram(source, index, replacement) {
  if (!Number.isInteger(index) || index < 0) return null;
  let diagramIndex = -1;
  const token = markdown.parse(source, {}).find((candidate) => {
    if (!isWebSequenceDiagram(candidate)) return false;
    diagramIndex += 1;
    return diagramIndex === index;
  });
  if (!token?.map) return null;

  const starts = [0];
  for (let position = source.indexOf('\n'); position >= 0; position = source.indexOf('\n', position + 1)) starts.push(position + 1);
  const [firstLine, lastLine] = token.map;
  const contentStart = starts[firstLine + 1] ?? source.length;
  const opening = source.slice(starts[firstLine], contentStart);
  if (!opening.trimStart().startsWith(token.markup)) return null;

  const possibleClosingStart = starts[lastLine - 1] ?? source.length;
  const possibleClosingEnd = starts[lastLine] ?? source.length;
  const closing = source.slice(possibleClosingStart, possibleClosingEnd).trim();
  const hasClosingFence = closing.length >= token.markup.length && [...closing].every((character) => character === token.markup[0]);
  const contentEnd = hasClosingFence ? possibleClosingStart : source.length;
  const newline = opening.endsWith('\r\n') ? '\r\n' : '\n';
  const normalized = String(replacement).replace(/\r\n?/g, '\n').replace(/\n/g, newline);
  const body = normalized && !normalized.endsWith(newline) ? `${normalized}${newline}` : normalized;
  const missingOpeningNewline = contentStart === source.length && !opening.endsWith('\n') ? newline : '';
  return `${source.slice(0, contentStart)}${missingOpeningNewline}${body}${source.slice(contentEnd)}`;
}

/** Renders JSON or plain text as escaped, optionally syntax-highlighted source. */
function renderCodePreview(preview, source, language = '') {
  const hasLanguage = Boolean(language && window.hljs.getLanguage(language));
  const code = hasLanguage
    ? window.hljs.highlight(source, { language, ignoreIllegals: true }).value
    : escapeHtml(source);
  const languageClass = hasLanguage ? ` class="language-${escapeHtml(language)}"` : '';
  preview.innerHTML = `<pre class="hljs document-preview-code"><code${languageClass}>${code}</code></pre>`;
}

/** Extracts clickable heading metadata from the same tokens used by the preview. */
function documentOutline(tokens, source) {
  const starts = [0];
  for (let position = source.indexOf('\n'); position >= 0; position = source.indexOf('\n', position + 1)) starts.push(position + 1);
  let previewIndex = 0;
  return tokens.flatMap((token, index) => {
    if (token.type !== 'heading_open') return [];
    const currentPreviewIndex = previewIndex++;
    const text = (tokens[index + 1]?.children || []).map((child) => {
      if (['text', 'code_inline', 'image'].includes(child.type)) return child.content;
      return ['softbreak', 'hardbreak'].includes(child.type) ? ' ' : '';
    }).join('').trim();
    return text ? [{ text, level: Number(token.tag.slice(1)), offset: starts[token.map[0]] ?? 0, previewIndex: currentPreviewIndex }] : [];
  });
}

/** Renders Markdown, JSON, or plain text into the preview element. */
export function renderPreview(preview, type, source) {
  if (!source.trim()) {
    preview.innerHTML = '<div class="empty-preview"><strong>Your preview will appear here.</strong><span>Use the Markup helper for headings, lists, links, and code blocks.</span></div>';
    return [];
  }
  if (type === 'json') {
    renderCodePreview(preview, source, 'json');
    return [];
  }
  if (type === 'text') {
    renderCodePreview(preview, source);
    return [];
  }
  const environment = { webSequenceDiagramIndex: 0 };
  const tokens = markdown.parse(source, environment);
  preview.innerHTML = markdown.renderer.render(tokens, markdown.options, environment);
  return documentOutline(tokens, source);
}
